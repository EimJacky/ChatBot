import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const baseEnv = {
  DISCORD_TOKEN: 'discord-token',
  DISCORD_CLIENT_ID: 'client-id',
  AI_API_KEY: 'ai-key',
};

describe('loadEnv', () => {
  it('loads defaults and model-derived token limits', () => {
    const env = loadEnv(baseEnv);

    expect(env.aiModel).toBe('gpt-4o-mini');
    expect(env.aiContextWindowTokens).toBeGreaterThan(100_000);
    expect(env.aiMaxTokens).toBeGreaterThan(1_000);
  });

  it('allows env overrides', () => {
    const env = loadEnv({
      ...baseEnv,
      AI_MODEL: 'deepseek-chat',
      AI_CONTEXT_WINDOW_TOKENS: '4096',
      BOT_OWNER_ID: '1, 2',
    });

    expect(env.aiModel).toBe('deepseek-chat');
    expect(env.aiContextWindowTokens).toBe(4096);
    expect(env.botOwnerIds.has('1')).toBe(true);
    expect(env.botOwnerIds.has('2')).toBe(true);
  });

  it('loads provider and web search settings', () => {
    const env = loadEnv({
      ...baseEnv,
      AI_PROVIDER: 'mimo',
      AI_WEB_SEARCH_MODE: 'force',
      AI_WEB_SEARCH_MAX_KEYWORD: '5',
      AI_WEB_SEARCH_LIMIT: '3',
      AI_SHOW_SEARCH_ANNOTATIONS: 'true',
    });

    expect(env.aiProvider).toBe('mimo');
    expect(env.aiWebSearch).toEqual({
      enabled: true,
      mode: 'force',
      maxKeyword: 5,
      limit: 3,
    });
    expect(env.aiShowSearchAnnotations).toBe(true);
  });

  it('rejects invalid search numeric settings', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        AI_WEB_SEARCH_MAX_KEYWORD: '0',
      }),
    ).toThrow();
  });
});
