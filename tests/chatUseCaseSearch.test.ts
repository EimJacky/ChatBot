import { describe, expect, it, vi } from 'vitest';
import { ChatUseCase } from '../src/application/ChatUseCase.js';
import type { Env } from '../src/config/env.js';
import { loadEnv } from '../src/config/env.js';
import { ContextManager } from '../src/services/context/ContextManager.js';
import { Tokenizer } from '../src/services/context/Tokenizer.js';
import { BotRateLimiters, DailyCounterLimiter, FixedWindowRateLimiter } from '../src/services/rateLimit/RateLimiter.js';
import { PromptAugmentor } from '../src/services/search/PromptAugmentor.js';
import type { SearchService } from '../src/services/search/SearchService.js';
import type { AppLogger } from '../src/utils/logger.js';

function createEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    DISCORD_TOKEN: 'discord-token',
    DISCORD_CLIENT_ID: 'client-id',
    AI_API_KEY: 'ai-key',
    AI_BASE_URL: 'https://api.xiaomimimo.com/v1',
    AI_MODEL: 'mimo-v2.5-pro',
    AI_WEB_SEARCH_ENABLED: 'false',
    SEARCH_ENABLED: 'true',
    ...overrides,
  });
}

describe('ChatUseCase search integration', () => {
  it('injects search prompt for the AI call without storing search results in context', async () => {
    const env = createEnv();
    const tokenizer = new Tokenizer();
    const context = new ContextManager(tokenizer, {
      maxContextMessages: 10,
      contextWindowTokens: 1_000,
      contextTtlHours: 1,
      reserveOutputTokens: 100,
    });
    const ai = {
      complete: vi.fn().mockResolvedValue({
        content: 'answer',
        model: 'mimo-v2.5-pro',
        estimatedPromptTokens: 42,
      }),
    };
    const search = {
      search: vi.fn().mockResolvedValue({
        searchPerformed: true,
        results: [],
        promptInjection: '[Web Search Results]\nSource: https://example.com\n[/Web Search Results]',
        estimatedTokens: 10,
        cacheHit: false,
      }),
    };
    const useCase = new ChatUseCase(
      env,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
      ai as never,
      context,
      {} as never,
      new BotRateLimiters(
        new FixedWindowRateLimiter({ max: 10, windowMs: 1_000 }),
        new FixedWindowRateLimiter({ max: 10, windowMs: 1_000 }),
        new DailyCounterLimiter(10),
      ),
      search as unknown as SearchService,
      new PromptAugmentor(tokenizer),
      'system',
    );

    const result = await useCase.run({
      traceId: 'trace',
      channelId: 'channel',
      userId: 'user',
      prompt: '今天有什么 AI 新闻？',
    });

    expect(result.content).toBe('answer');
    expect(ai.complete.mock.calls[0]?.[0].systemPrompt).toContain('[Web Search Results]');
    expect(context.get('channel').map((message) => message.content)).toEqual([
      '今天有什么 AI 新闻？',
      'answer',
    ]);
  });

  it('triggers search progress callbacks', async () => {
    const env = createEnv();
    const tokenizer = new Tokenizer();
    const onSearchStart = vi.fn();
    const onSearchEnd = vi.fn();
    const search = {
      search: vi.fn(async (request) => {
        await request.onSearchStart?.();
        await request.onSearchEnd?.();
        return {
          searchPerformed: false,
          results: [],
          promptInjection: '',
          estimatedTokens: 0,
          cacheHit: false,
          skippedReason: 'disabled',
        };
      }),
    };
    const useCase = new ChatUseCase(
      env,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
      {
        complete: vi.fn().mockResolvedValue({
          content: 'answer',
          model: 'mimo-v2.5-pro',
          estimatedPromptTokens: 42,
        }),
      } as never,
      new ContextManager(tokenizer, {
        maxContextMessages: 10,
        contextWindowTokens: 1_000,
        contextTtlHours: 1,
        reserveOutputTokens: 100,
      }),
      {} as never,
      new BotRateLimiters(
        new FixedWindowRateLimiter({ max: 10, windowMs: 1_000 }),
        new FixedWindowRateLimiter({ max: 10, windowMs: 1_000 }),
        new DailyCounterLimiter(10),
      ),
      search as unknown as SearchService,
      new PromptAugmentor(tokenizer),
      'system',
    );

    await useCase.run(
      {
        traceId: 'trace',
        channelId: 'channel',
        userId: 'user',
        prompt: '今天有什么 AI 新闻？',
      },
      { onSearchStart, onSearchEnd },
    );

    expect(onSearchStart).toHaveBeenCalledOnce();
    expect(onSearchEnd).toHaveBeenCalledOnce();
  });
});

