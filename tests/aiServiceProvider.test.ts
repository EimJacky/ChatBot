import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { loadEnv } from '../src/config/env.js';
import { AIService } from '../src/services/ai/AIService.js';
import { MimoProvider } from '../src/services/ai/providers/MimoProvider.js';
import { Tokenizer } from '../src/services/context/Tokenizer.js';
import type { AppLogger } from '../src/utils/logger.js';
import type { ExtendedChatCompletionParams } from '../src/services/ai/providers/types.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as AppLogger;

const promptGuard = {
  assertAllowed: vi.fn(),
  wrapUserContent: (input: string) => input,
};

function createEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    DISCORD_TOKEN: 'discord-token',
    DISCORD_CLIENT_ID: 'client-id',
    AI_API_KEY: 'ai-key',
    AI_BASE_URL: 'https://api.xiaomimimo.com/v1',
    AI_MODEL: 'mimo-v2.5-pro',
    AI_STREAMING_ENABLED: 'false',
    ...overrides,
  });
}

function setCompletionsCreate(service: AIService, create: (params: ExtendedChatCompletionParams) => Promise<unknown>) {
  (
    service as unknown as {
      chatCompletions: {
        create: (params: ExtendedChatCompletionParams) => Promise<unknown>;
      };
    }
  ).chatCompletions = { create };
}

describe('AIService provider integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downgrades search failures and notifies the user', async () => {
    const service = new AIService(
      createEnv(),
      logger,
      new Tokenizer(),
      promptGuard as never,
      new MimoProvider(),
    );
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('plugin disabled'),
    });
    vi.stubGlobal('fetch', fetchMock);
    const create = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content: 'fallback answer' } }],
      usage: {},
    });

    setCompletionsCreate(service, create);

    const result = await service.complete({
      traceId: 'trace',
      userId: 'user',
      channelId: 'channel',
      systemPrompt: 'system',
      messages: [],
      prompt: 'latest news?',
    });

    expect(result.content).toContain('fallback answer');
    expect(result.content).toContain('Search is temporarily unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'api-key': 'ai-key',
        'content-type': 'application/json',
      },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(service.getLastDiagnostics().lastDowngradeReason).toBe(
      'search request failed (403): plugin disabled',
    );
  });

  it('adds compact markdown annotations when enabled', async () => {
    const service = new AIService(
      createEnv({ AI_SHOW_SEARCH_ANNOTATIONS: 'true' }),
      logger,
      new Tokenizer(),
      promptGuard as never,
      new MimoProvider(),
    );
    const create = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: 'answer with sources',
                    annotations: [
                      {
                        url_citation: {
                          title: 'Example Source',
                          url: 'https://example.com/article',
                        },
                      },
                    ],
                  },
                },
              ],
              usage: { web_search_usage: { search_count: 1 } },
            }),
          ),
      }),
    );

    setCompletionsCreate(service, create);

    const result = await service.complete({
      traceId: 'trace',
      userId: 'user',
      channelId: 'channel',
      systemPrompt: 'system',
      messages: [],
      prompt: 'latest news?',
    });

    expect(result.content).toContain('Sources:');
    expect(result.content).toContain('[Example Source](https://example.com/article)');
    expect(service.getLastDiagnostics().lastAnnotationsCount).toBe(1);
  });

  it('keeps last diagnostics self-consistent under concurrent completions', async () => {
    const service = new AIService(
      createEnv({ AI_SHOW_SEARCH_ANNOTATIONS: 'true' }),
      logger,
      new Tokenizer(),
      promptGuard as never,
      new MimoProvider(),
    );
    const create = vi.fn(async (params: ExtendedChatCompletionParams) => {
      const lastMessage = params.messages.at(-1);
      const content = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
      const hasSearchTool = Array.isArray(params.tools);

      if (content.includes('fast') && hasSearchTool) {
        throw Object.assign(new Error('plugin disabled'), { status: 403 });
      }

      if (content.includes('slow')) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          choices: [
            {
              message: {
                content: 'slow answer',
                annotations: [
                  {
                    url_citation: {
                      title: 'Slow Source',
                      url: 'https://example.com/slow',
                    },
                  },
                ],
              },
            },
          ],
          usage: { web_search_usage: { search_count: 1 } },
        };
      }

      return {
        choices: [{ message: { content: 'fast fallback' } }],
        usage: {},
      };
    });
    setCompletionsCreate(service, create);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        if (body.includes('fast')) {
          return {
            ok: false,
            status: 403,
            text: () => Promise.resolve('plugin disabled'),
          };
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: 'slow answer',
                      annotations: [
                        {
                          url_citation: {
                            title: 'Slow Source',
                            url: 'https://example.com/slow',
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: { web_search_usage: { search_count: 1 } },
              }),
            ),
        };
      }),
    );

    await Promise.all([
      service.complete({
        traceId: 'slow-trace',
        userId: 'user',
        channelId: 'channel',
        systemPrompt: 'system',
        messages: [],
        prompt: 'slow latest news',
      }),
      service.complete({
        traceId: 'fast-trace',
        userId: 'user',
        channelId: 'channel',
        systemPrompt: 'system',
        messages: [],
        prompt: 'fast latest news',
      }),
    ]);

    const diagnostics = service.getLastDiagnostics();
    expect(diagnostics.lastAnnotationsCount).toBe(1);
    expect(diagnostics.lastDowngradeReason).toBeUndefined();
  });

  it('skips search for fallback models after a failed downgrade retry', async () => {
    const service = new AIService(
      createEnv({ AI_FALLBACK_MODEL: 'mimo-v2.5-pro' }),
      logger,
      new Tokenizer(),
      promptGuard as never,
      new MimoProvider(),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('plugin disabled'),
      }),
    );
    const create = vi.fn(async (params: ExtendedChatCompletionParams) => {
      if (create.mock.calls.length === 1 && !Array.isArray(params.tools)) {
        throw Object.assign(new Error('no-search retry failed'), { status: 500 });
      }

      if (create.mock.calls.length === 2 && Array.isArray(params.tools)) {
        throw new Error('fallback should skip search');
      }

      return {
        choices: [{ message: { content: 'fallback without search' } }],
        usage: {},
      };
    });
    setCompletionsCreate(service, create);

    const result = await service.complete({
      traceId: 'trace',
      userId: 'user',
      channelId: 'channel',
      systemPrompt: 'system',
      messages: [],
      prompt: 'latest news?',
    });

    expect(result.content).toContain('fallback without search');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0].tools).toBeUndefined();
    expect(service.getLastDiagnostics().effectiveSearch.enabled).toBe(false);
  });

  it('truncates long annotation source lists with an ellipsis', async () => {
    const service = new AIService(
      createEnv({ AI_SHOW_SEARCH_ANNOTATIONS: 'true' }),
      logger,
      new Tokenizer(),
      promptGuard as never,
      new MimoProvider(),
    );
    const create = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: 'answer with long sources',
                    annotations: Array.from({ length: 5 }, (_, index) => ({
                      url_citation: {
                        title: `Very Long Source Title ${index} ${'x'.repeat(120)}`,
                        url: `https://example.com/${index}/${'y'.repeat(120)}`,
                      },
                    })),
                  },
                },
              ],
              usage: {},
            }),
          ),
      }),
    );
    setCompletionsCreate(service, create);

    const result = await service.complete({
      traceId: 'trace',
      userId: 'user',
      channelId: 'channel',
      systemPrompt: 'system',
      messages: [],
      prompt: 'latest news?',
    });

    expect(result.content).toContain('Sources:');
    expect(result.content.endsWith('...')).toBe(true);
  });
});
