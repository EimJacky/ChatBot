import { LRUCache } from 'lru-cache';
import type { Env } from '../../config/env.js';
import type { AppLogger } from '../../utils/logger.js';
import type { ExtendedChatCompletionsClient } from '../ai/AIService.js';
import type { DailyCounterLimiter, FixedWindowRateLimiter } from '../rateLimit/RateLimiter.js';
import type { PromptAugmentor } from './PromptAugmentor.js';
import type { SearchProvider, SearchResult } from './SearchProvider.js';
import { needsWebSearch, normalizeSearchQuery } from './queryDetection.js';

export interface SearchServiceRequest {
  traceId: string;
  userId: string;
  query: string;
  onSearchStart?: () => Promise<void> | void;
  onSearchEnd?: () => Promise<void> | void;
}

export interface SearchServiceResult {
  searchPerformed: boolean;
  results: SearchResult[];
  promptInjection: string;
  estimatedTokens: number;
  cacheHit: boolean;
  skippedReason?: string;
}

export interface SearchDiagnostics {
  lastReason?: string;
  cacheEntries: number;
  searchCacheEntries: number;
  intentCacheEntries: number;
  dailyUsed: number;
  dailyLimit: number;
  successCount: number;
  failureCount: number;
  averageElapsedMs: number;
}

interface SearchCacheValue {
  results: SearchResult[];
  promptInjection: string;
  estimatedTokens: number;
}

export class SearchService {
  private readonly searchCache: LRUCache<string, SearchCacheValue>;
  private readonly intentCache: LRUCache<string, boolean>;
  private successCount = 0;
  private failureCount = 0;
  private elapsedTotalMs = 0;
  private lastReason: string | undefined;
  private dailyUsed = 0;
  private warnedDaily = false;

  constructor(
    private readonly env: Env,
    private readonly logger: AppLogger,
    private readonly provider: SearchProvider | undefined,
    private readonly promptAugmentor: PromptAugmentor,
    private readonly userLimiter: FixedWindowRateLimiter,
    private readonly dailyLimiter: DailyCounterLimiter,
    private readonly intentClient?: ExtendedChatCompletionsClient,
  ) {
    this.searchCache = new LRUCache<string, SearchCacheValue>({
      max: 500,
      ttl: env.appSearch.cacheTtlMs,
      ttlAutopurge: true,
      updateAgeOnGet: true,
    });
    this.intentCache = new LRUCache<string, boolean>({
      max: 2_000,
      ttl: 60_000,
      ttlAutopurge: true,
      updateAgeOnGet: true,
    });
  }

  async search(request: SearchServiceRequest): Promise<SearchServiceResult> {
    const started = Date.now();
    const config = this.env.appSearch;
    const normalizedQuery = normalizeSearchQuery(request.query);

    if (!config.enabled) {
      return this.skip('disabled');
    }

    if (this.env.aiWebSearch.enabled) {
      return this.skip('mimo-native-active');
    }

    if (!this.provider || !config.apiKey) {
      return this.skip('no-provider');
    }

    const searchable = await needsWebSearch(
      request.query,
      {
        enabled: config.llmIntentEnabled,
        ...(this.intentClient ? { client: this.intentClient } : {}),
        model: this.env.aiModel,
        timeoutMs: 5_000,
      },
      this.intentCacheAdapter(),
    );

    if (!searchable) {
      return this.skip('query-not-searchable');
    }

    const cached = this.searchCache.get(normalizedQuery);
    if (cached) {
      this.lastReason = 'cache-hit';
      return {
        searchPerformed: cached.results.length > 0,
        results: cached.results,
        promptInjection: cached.promptInjection,
        estimatedTokens: cached.estimatedTokens,
        cacheHit: true,
      };
    }

    try {
      this.userLimiter.check(request.userId, 'search');
    } catch {
      return this.skip('rate-limited');
    }

    try {
      this.dailyLimiter.check('__global__');
      this.dailyUsed += 1;
      this.warnIfDailyBudgetHigh();
    } catch {
      return this.skip('daily-limit-reached', true);
    }

    try {
      await request.onSearchStart?.();
      const response = await this.provider.search(request.query, config.resultLimit);
      const augmentation = this.promptAugmentor.formatSearchResults(response.results);
      const result: SearchServiceResult = {
        searchPerformed: augmentation.results.length > 0,
        results: augmentation.results,
        promptInjection: augmentation.promptInjection,
        estimatedTokens: augmentation.estimatedTokens,
        cacheHit: false,
        ...(augmentation.results.length === 0 ? { skippedReason: 'empty-results' } : {}),
      };

      if (result.searchPerformed) {
        this.searchCache.set(normalizedQuery, {
          results: result.results,
          promptInjection: result.promptInjection,
          estimatedTokens: result.estimatedTokens,
        });
      }
      this.successCount += 1;
      this.elapsedTotalMs += Date.now() - started;
      this.lastReason = result.skippedReason ?? 'searched';
      this.logger.info(
        {
          traceId: request.traceId,
          provider: response.provider,
          query: normalizedQuery,
          resultCount: result.results.length,
          estimatedTokens: result.estimatedTokens,
          elapsedMs: Date.now() - started,
        },
        'search completed',
      );
      return result;
    } catch (error) {
      this.failureCount += 1;
      this.lastReason = 'search-error';
      this.logger.warn(
        {
          traceId: request.traceId,
          provider: this.provider.name,
          elapsedMs: Date.now() - started,
          err: error,
        },
        'search failed',
      );
      return this.skip('search-error');
    } finally {
      await request.onSearchEnd?.();
    }
  }

  getDiagnostics(): SearchDiagnostics {
    return {
      ...(this.lastReason ? { lastReason: this.lastReason } : {}),
      cacheEntries: this.searchCache.size,
      searchCacheEntries: this.searchCache.size,
      intentCacheEntries: this.intentCache.size,
      dailyUsed: this.dailyUsed,
      dailyLimit: this.env.appSearch.dailyLimit,
      successCount: this.successCount,
      failureCount: this.failureCount,
      averageElapsedMs: this.successCount > 0 ? Math.round(this.elapsedTotalMs / this.successCount) : 0,
    };
  }

  getEffectiveMode(): 'app-side' | 'mimo-native' | 'none' {
    if (this.env.aiWebSearch.enabled) {
      return 'mimo-native';
    }

    return this.env.appSearch.enabled ? 'app-side' : 'none';
  }

  private skip(reason: string, countFailure = false): SearchServiceResult {
    this.lastReason = reason;
    if (countFailure) {
      this.failureCount += 1;
    }

    return {
      searchPerformed: false,
      results: [],
      promptInjection: '',
      estimatedTokens: 0,
      cacheHit: false,
      skippedReason: reason,
    };
  }

  private warnIfDailyBudgetHigh(): void {
    const ratio = this.dailyUsed / this.env.appSearch.dailyLimit;
    if (!this.warnedDaily && ratio >= this.env.appSearch.dailyWarningRatio) {
      this.warnedDaily = true;
      this.logger.warn(
        {
          dailyUsed: this.dailyUsed,
          dailyLimit: this.env.appSearch.dailyLimit,
          ratio,
        },
        'search daily budget warning threshold reached',
      );
    }
  }

  private intentCacheAdapter() {
    return {
      get: (key: string) => {
        return this.intentCache.get(key);
      },
      set: (key: string, value: boolean) => this.intentCache.set(key, value),
    };
  }
}

export function appendSearchSkipReason(content: string, result: SearchServiceResult): string {
  if (!result.skippedReason || result.skippedReason === 'query-not-searchable' || result.skippedReason === 'disabled') {
    return content;
  }

  return `${content}\n\n*Search skipped: ${result.skippedReason}.*`;
}
