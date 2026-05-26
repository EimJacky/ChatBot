import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { loadEnv } from '../src/config/env.js';
import { PromptAugmentor } from '../src/services/search/PromptAugmentor.js';
import { SearchService } from '../src/services/search/SearchService.js';
import type { SearchProvider } from '../src/services/search/SearchProvider.js';
import { Tokenizer } from '../src/services/context/Tokenizer.js';
import { DailyCounterLimiter, FixedWindowRateLimiter } from '../src/services/rateLimit/RateLimiter.js';
import type { ExtendedChatCompletionsClient } from '../src/services/ai/AIService.js';
import type { AppLogger } from '../src/utils/logger.js';

const baseRawEnv = {
  DISCORD_TOKEN: 'discord-token',
  DISCORD_CLIENT_ID: 'client-id',
  AI_API_KEY: 'ai-key',
  AI_BASE_URL: 'https://api.xiaomimimo.com/v1',
  AI_MODEL: 'mimo-v2.5-pro',
  AI_WEB_SEARCH_ENABLED: 'false',
};

function createEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    ...baseRawEnv,
    SEARCH_ENABLED: 'true',
    SEARCH_API_KEY: 'search-key',
    ...overrides,
  });
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as AppLogger;
}

function createProvider(search = vi.fn()): SearchProvider {
  return {
    name: 'tavily',
    search,
  };
}

function createService(options: {
  env?: Env;
  provider?: SearchProvider;
  userMax?: number;
  dailyMax?: number;
  logger?: AppLogger;
  intentClient?: ExtendedChatCompletionsClient;
} = {}) {
  const env = options.env ?? createEnv();
  return new SearchService(
    env,
    options.logger ?? createLogger(),
    options.provider,
    new PromptAugmentor(new Tokenizer()),
    new FixedWindowRateLimiter({
      max: options.userMax ?? env.appSearch.rateLimitMax,
      windowMs: env.appSearch.rateLimitWindowMs,
    }),
    new DailyCounterLimiter(options.dailyMax ?? env.appSearch.dailyLimit),
    options.intentClient,
  );
}

describe('SearchService', () => {
  it('skips when disabled, MiMo native active, or no provider exists', async () => {
    await expect(createService({ env: createEnv({ SEARCH_ENABLED: 'false' }) }).search({
      traceId: 'trace',
      userId: 'user',
      query: '今天有什么 AI 新闻？',
    })).resolves.toMatchObject({ skippedReason: 'disabled' });

    await expect(createService({ env: createEnv({ AI_WEB_SEARCH_ENABLED: 'true' }) }).search({
      traceId: 'trace',
      userId: 'user',
      query: '今天有什么 AI 新闻？',
    })).resolves.toMatchObject({ skippedReason: 'mimo-native-active' });

    await expect(createService().search({
      traceId: 'trace',
      userId: 'user',
      query: '今天有什么 AI 新闻？',
    })).resolves.toMatchObject({ skippedReason: 'no-provider' });
  });

  it('skips non-searchable queries', async () => {
    const service = createService({ provider: createProvider() });

    await expect(service.search({
      traceId: 'trace',
      userId: 'user',
      query: '解释一下什么是递归',
    })).resolves.toMatchObject({ skippedReason: 'query-not-searchable' });
  });

  it('searches, caches before limits, and tracks diagnostics', async () => {
    const search = vi.fn().mockResolvedValue({
      provider: 'tavily',
      query: '今天有什么 AI 新闻？',
      results: [
        {
          title: 'AI News',
          snippet: 'This is a sufficiently long current AI news summary.',
          url: 'https://example.com/news',
        },
      ],
    });
    const service = createService({ provider: createProvider(search), userMax: 1, dailyMax: 1 });

    const first = await service.search({ traceId: 'trace', userId: 'user', query: '今天有什么 AI 新闻？' });
    const second = await service.search({ traceId: 'trace', userId: 'other-user', query: '今天有什么 AI 新闻？' });

    expect(first).toMatchObject({ searchPerformed: true, cacheHit: false });
    expect(second).toMatchObject({ searchPerformed: true, cacheHit: true });
    expect(search).toHaveBeenCalledOnce();
    expect(service.getDiagnostics()).toMatchObject({
      cacheEntries: 1,
      dailyUsed: 1,
      successCount: 1,
    });
  });

  it('skips when user search rate limit or daily budget is reached', async () => {
    const search = vi.fn().mockResolvedValue({
      provider: 'tavily',
      query: 'query',
      results: [
        {
          title: 'AI News',
          snippet: 'This is a sufficiently long current AI news summary.',
          url: 'https://example.com/news',
        },
      ],
    });
    const service = createService({ provider: createProvider(search), userMax: 1, dailyMax: 2 });

    await service.search({ traceId: 'trace', userId: 'user', query: '今天有什么 AI 新闻？' });
    await expect(service.search({
      traceId: 'trace',
      userId: 'user',
      query: '最新 Node.js 版本是什么？',
    })).resolves.toMatchObject({ skippedReason: 'rate-limited' });

    const dailyService = createService({ provider: createProvider(search), dailyMax: 1 });
    await dailyService.search({ traceId: 'trace', userId: 'a', query: '今天有什么 AI 新闻？' });
    await expect(dailyService.search({
      traceId: 'trace',
      userId: 'b',
      query: '最新 Node.js 版本是什么？',
    })).resolves.toMatchObject({ skippedReason: 'daily-limit-reached' });
  });

  it('warns at the daily budget threshold and downgrades API errors', async () => {
    const logger = createLogger();
    const service = createService({
      env: createEnv({ SEARCH_DAILY_LIMIT: '2', SEARCH_DAILY_WARNING_RATIO: '0.5' }),
      logger,
      provider: createProvider(vi.fn().mockRejectedValue(new Error('provider down'))),
    });

    const result = await service.search({
      traceId: 'trace',
      userId: 'user',
      query: '今天有什么 AI 新闻？',
    });

    expect(result).toMatchObject({ skippedReason: 'search-error' });
    expect(logger.warn).toHaveBeenCalledWith(expect.any(Object), 'search daily budget warning threshold reached');
    expect(service.getDiagnostics()).toMatchObject({ failureCount: 1, lastReason: 'search-error' });
  });

  it('keeps intent and search caches separate in diagnostics', async () => {
    const intentClient = {
      create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: '{"needsSearch": true}' } }],
      }),
    } as unknown as ExtendedChatCompletionsClient;
    const provider = createProvider(
      vi.fn().mockResolvedValue({
        provider: 'tavily',
        query: 'niche package maintenance status',
        results: [
          {
            title: 'Package status',
            snippet: 'This is a sufficiently long package maintenance status summary.',
            url: 'https://example.com/package',
          },
        ],
      }),
    );
    const service = createService({
      env: createEnv({ SEARCH_LLM_INTENT_ENABLED: 'true' }),
      provider,
      intentClient,
    });

    await service.search({
      traceId: 'trace',
      userId: 'user',
      query: 'Tell me whether package xyzzq is still maintained',
    });

    expect(service.getDiagnostics()).toMatchObject({
      searchCacheEntries: 1,
      intentCacheEntries: 1,
    });
  });
});
