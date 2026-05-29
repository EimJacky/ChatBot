import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import { ChatUseCase } from '../src/application/ChatUseCase.js';
import {
  handleDebugCommand,
  handleLangCommand,
  handleModelsCommand,
  handlePersonaCommand,
  handlePingCommand,
  handleResetCommand,
  handleStatsCommand,
  handleUsageCommand,
} from '../src/commands/handlers.js';
import { createContainer, type Container, validateContainer } from '../src/config/container.js';
import { loadEnv } from '../src/config/env.js';
import { buildMentionPrompt } from '../src/events/messageCreate.js';
import { startHealthServer } from '../src/health/server.js';
import { ContextManager } from '../src/services/context/ContextManager.js';
import { Tokenizer } from '../src/services/context/Tokenizer.js';
import { MetricsRecorder } from '../src/services/metrics/MetricsRecorder.js';
import { BotRateLimiters, DailyCounterLimiter, FixedWindowRateLimiter } from '../src/services/rateLimit/RateLimiter.js';
import { PromptAugmentor } from '../src/services/search/PromptAugmentor.js';
import type { SearchService } from '../src/services/search/SearchService.js';
import {
  MemoryContextStore,
  MemoryPreferenceStore,
  MemoryRateLimitStore,
  MemoryUsageStore,
} from '../src/services/storage/MemoryStores.js';
import { createLogger, type AppLogger } from '../src/utils/logger.js';

const baseRawEnv = {
  DISCORD_TOKEN: 'discord-token',
  DISCORD_CLIENT_ID: 'client-id',
  AI_API_KEY: 'ai-key',
  AI_WEB_SEARCH_ENABLED: 'false',
  SEARCH_ENABLED: 'false',
};

function createEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return loadEnv({ ...baseRawEnv, ...overrides });
}

function createTestContainer() {
  const tokenizer = new Tokenizer();
  const contextStore = new MemoryContextStore();
  const rateLimitStore = new MemoryRateLimitStore();
  const usageStore = new MemoryUsageStore();
  const preferenceStore = new MemoryPreferenceStore();
  const metrics = new MetricsRecorder();
  const env = createEnv({ BOT_OWNER_ID: 'owner-id' });
  const contextManager = new ContextManager(tokenizer, {
    maxContextMessages: 10,
    contextWindowTokens: 1_000,
    contextTtlHours: 1,
    reserveOutputTokens: 100,
  }, contextStore);
  usageStore.recordUsage({
    id: 'usage-1',
    userId: 'owner-id',
    conversationKey: 'channel:channel-id',
    channelId: 'channel-id',
    model: 'model',
    inputTokens: 11,
    outputTokens: 7,
    searchPerformed: false,
    searchCacheHit: false,
    elapsedMs: 50,
    createdAt: Date.now(),
  });

  return {
    env,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    client: { isReady: () => true, ws: { ping: 12 } },
    tokenizer,
    contextManager,
    contextStore,
    rateLimitStore,
    usageStore,
    preferenceStore,
    storageMonitor: { check: () => ({ ok: true, driver: 'memory', elapsedMs: 0, degradedReasons: [] }) },
    rateLimiters: new BotRateLimiters(
      new FixedWindowRateLimiter({ max: 10, windowMs: 1_000 }, rateLimitStore, 'chat-user-test'),
      new FixedWindowRateLimiter({ max: 10, windowMs: 1_000 }, rateLimitStore, 'chat-channel-test'),
      new DailyCounterLimiter(10, rateLimitStore, 'mention-test'),
    ),
    aiProvider: { name: 'standard', getCapabilities: vi.fn(), getWebSearchStatus: vi.fn(), buildChatCompletionParams: vi.fn() },
    aiService: {
      getLastDiagnostics: () => ({ provider: 'standard', effectiveSearch: { status: 'disabled' } }),
      getDiagnosticsHistory: () => [],
    },
    searchService: { getDiagnostics: () => ({ dailyUsed: 0 }), getEffectiveMode: () => 'none' },
    promptAugmentor: new PromptAugmentor(tokenizer),
    createStreamingMessageHandler: vi.fn(),
    chatUseCase: {},
    metrics,
    conversationCleaner: { start: vi.fn(), stop: vi.fn() },
    systemPrompt: 'system',
  } as unknown as Container;
}

describe('Phase 2 command and health surfaces', () => {
  it('handles reset, stats, usage, and debug with conversation-aware state', async () => {
    const container = createTestContainer();
    container.contextManager.add('channel:channel-id', { role: 'user', content: 'hello', timestamp: Date.now() });

    const resetInteraction = createInteraction('owner-id');
    await handleResetCommand(resetInteraction, container);
    expect(resetInteraction.editReply).toHaveBeenCalledWith('Context reset for this conversation.');

    container.contextManager.add('channel:channel-id', { role: 'user', content: 'hello', timestamp: Date.now() });
    const statsInteraction = createInteraction('owner-id');
    await handleStatsCommand(statsInteraction, container);
    expect(String(statsInteraction.editReply.mock.calls[0]?.[0])).toContain('Conversation: channel:channel-id');

    const usageInteraction = createInteraction('owner-id');
    await handleUsageCommand(usageInteraction, container);
    expect(String(usageInteraction.editReply.mock.calls[0]?.[0])).toContain('7d: 1 replies');

    const debugInteraction = createInteraction('owner-id');
    await handleDebugCommand(debugInteraction, container);
    expect(String(debugInteraction.editReply.mock.calls[0]?.[0])).toContain('Storage health');

    const blockedDebug = createInteraction('other-id');
    await handleDebugCommand(blockedDebug, container);
    expect(blockedDebug.editReply).toHaveBeenCalledWith('This command is restricted to the bot owner.');

    const ping = createInteraction('owner-id');
    await handlePingCommand(ping);
    expect(String(ping.editReply.mock.calls[0]?.[0])).toContain('Pong');

    const models = createInteraction('owner-id');
    container.aiProvider.getCapabilities = vi.fn().mockReturnValue({
      supportsWebSearch: false,
      supportsThinking: false,
      supportsAnnotations: false,
    });
    await handleModelsCommand(models, container);
    expect(String(models.editReply.mock.calls[0]?.[0])).toContain('Provider');

    const persona = createInteraction('owner-id', { options: { getString: vi.fn().mockReturnValue('technical') } });
    await handlePersonaCommand(persona, container);
    expect(container.preferenceStore.getUserPreferences('owner-id')?.persona).toBe('technical');

    const lang = createInteraction('owner-id', { options: { getString: vi.fn().mockReturnValue('简体中文') } });
    await handleLangCommand(lang, container);
    expect(container.preferenceStore.getUserPreferences('owner-id')).toMatchObject({
      persona: 'technical',
      language: '简体中文',
    });

    const clearPersona = createInteraction('owner-id', { options: { getString: vi.fn().mockReturnValue('clear') } });
    await handlePersonaCommand(clearPersona, container);
    expect(container.preferenceStore.getUserPreferences('owner-id')).toMatchObject({ language: '简体中文' });
  });

  it('reports readiness and liveness separately', async () => {
    const port = await getOpenPort();
    const base = createTestContainer();
    const container = {
      ...base,
      env: { ...base.env, healthCheckPort: port },
      logger: base.logger,
    };
    const server = startHealthServer(container);

    try {
      await expect(fetch(`http://127.0.0.1:${port}/livez`).then((response) => response.json())).resolves.toEqual({
        ok: true,
      });
      const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
      expect(ready.status).toBe(200);
      await expect(ready.json()).resolves.toMatchObject({ ok: true, discordReady: true });
      const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(await metrics.text()).toContain('echomate_requests_total');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe('Phase 2 use case surfaces', () => {
  it('streams interaction replies through a thread conversation key', async () => {
    const env = createEnv();
    const tokenizer = new Tokenizer();
    const context = new ContextManager(tokenizer, {
      maxContextMessages: 10,
      contextWindowTokens: 1_000,
      contextTtlHours: 1,
      reserveOutputTokens: 100,
    });
    const stream = {
      start: vi.fn().mockResolvedValue(undefined),
      append: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn().mockResolvedValue(undefined),
    };
    const useCase = new ChatUseCase(
      env,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
      { complete: vi.fn().mockResolvedValue({ content: 'answer', model: 'model', estimatedPromptTokens: 12 }) } as never,
      context,
      () => stream as never,
      new BotRateLimiters(
        new FixedWindowRateLimiter({ max: 10, windowMs: 1_000 }),
        new FixedWindowRateLimiter({ max: 10, windowMs: 1_000 }),
        new DailyCounterLimiter(10),
      ),
      { search: vi.fn().mockResolvedValue({ searchPerformed: false, results: [], promptInjection: '', estimatedTokens: 0, cacheHit: false }) } as unknown as SearchService,
      new PromptAugmentor(tokenizer),
      'system',
      new MemoryUsageStore(),
      tokenizer,
      new MetricsRecorder(),
      new MemoryPreferenceStore(),
    );

    await useCase.handleInteraction(createInteraction('user-id', {
      channel: { id: 'thread-id', isThread: () => true },
      channelId: 'thread-id',
      guildId: 'guild-id',
    }), 'hello');

    expect(stream.start).toHaveBeenCalledOnce();
    expect(stream.finish).toHaveBeenCalledWith(expect.anything(), 'answer', { content: 'answer' });
    expect(context.get('thread:thread-id').map((message) => message.content)).toEqual(['hello', 'answer']);
  });

  it('blocks chat replies outside the configured channel allowlist', async () => {
    const env = createEnv({ CHANNEL_ALLOWLIST: 'allowed-channel' });
    const tokenizer = new Tokenizer();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;
    const ai = { complete: vi.fn() };
    const useCase = new ChatUseCase(
      env,
      logger,
      ai as never,
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
      { search: vi.fn() } as unknown as SearchService,
      new PromptAugmentor(tokenizer),
      'system',
    );

    await expect(useCase.run({
      traceId: 'trace',
      conversationKey: 'channel:blocked-channel',
      channelId: 'blocked-channel',
      userId: 'user-id',
      prompt: 'hello',
    })).rejects.toThrow(/not enabled/);
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('injects stored persona and language preferences into the system prompt', async () => {
    const env = createEnv();
    const tokenizer = new Tokenizer();
    const preferences = new MemoryPreferenceStore();
    preferences.setUserPreferences({
      userId: 'user-id',
      persona: 'technical',
      language: 'English',
      updatedAt: Date.now(),
    });
    const ai = {
      complete: vi.fn().mockResolvedValue({ content: 'answer', model: 'model', estimatedPromptTokens: 12 }),
    };
    const useCase = new ChatUseCase(
      env,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
      ai as never,
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
      { search: vi.fn().mockResolvedValue({ searchPerformed: false, results: [], promptInjection: '', estimatedTokens: 0, cacheHit: false }) } as unknown as SearchService,
      new PromptAugmentor(tokenizer),
      'system',
      undefined,
      tokenizer,
      undefined,
      preferences,
    );

    await useCase.run({
      traceId: 'trace',
      conversationKey: 'channel:c1',
      channelId: 'c1',
      userId: 'user-id',
      prompt: 'hello',
    });

    expect(ai.complete.mock.calls[0]?.[0].systemPrompt).toContain('Style/persona: technical');
    expect(ai.complete.mock.calls[0]?.[0].systemPrompt).toContain('Reply language: English');
  });

  it('edits mention replies and handles mention failures', async () => {
    const env = createEnv({ FEEDBACK_REACTIONS_ENABLED: 'true' });
    const tokenizer = new Tokenizer();
    const sent = {
      edit: vi.fn().mockResolvedValue(undefined),
      react: vi.fn().mockResolvedValue(undefined),
    };
    const useCase = new ChatUseCase(
      env,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
      { complete: vi.fn().mockResolvedValue({ content: 'answer', model: 'model', estimatedPromptTokens: 12 }) } as never,
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
      { search: vi.fn().mockResolvedValue({ searchPerformed: false, results: [], promptInjection: '', estimatedTokens: 0, cacheHit: false }) } as unknown as SearchService,
      new PromptAugmentor(tokenizer),
      'system',
    );

    await useCase.handleMention(createMessage(sent), 'hello');
    expect(sent.edit).toHaveBeenCalledWith({ content: 'answer' });
    expect(sent.react).toHaveBeenCalledWith('👍');
    expect(sent.react).toHaveBeenCalledWith('👎');
  });

  it('builds mention prompts with referenced bot messages', async () => {
    const prompt = await buildMentionPrompt(
      {
        id: 'message-id',
        reference: { messageId: 'referenced-id' },
        fetchReference: vi.fn().mockResolvedValue({
          author: { id: 'bot-id', bot: true },
          content: 'previous answer',
        }),
      } as unknown as Message,
      'bot-id',
      'tell me more',
      { env: createEnv(), logger: { warn: vi.fn() } as unknown as AppLogger },
    );

    expect(prompt).toContain('Referenced bot message:');
    expect(prompt).toContain('previous answer');
    expect(prompt).toContain('tell me more');
  });
});

describe('Phase 2 utility surfaces', () => {
  it('records metrics and builds production loggers', () => {
    const metrics = new MetricsRecorder();
    metrics.recordRequest(10);
    metrics.recordError();
    metrics.recordUsageWriteFailure();
    metrics.recordLlmLatency(20);
    metrics.recordStoreLatency(30);
    metrics.recordTokens(3, 4);
    expect(metrics.getSnapshot()).toMatchObject({
      requests: 1,
      errors: 1,
      usageWriteFailures: 1,
      llmLatencyMs: 20,
      storeLatencyMs: 30,
      inputTokens: 3,
      outputTokens: 4,
    });
    expect(metrics.toPrometheus()).toContain('echomate_tokens_total{direction="input"} 3');

    const logger = createLogger({ nodeEnv: 'production', logLevel: 'silent', logDestination: '' });
    expect(logger.level).toBe('silent');
  });

  it('creates the default container with memory stores', async () => {
    vi.stubEnv('DISCORD_TOKEN', 'discord-token');
    vi.stubEnv('DISCORD_CLIENT_ID', 'client-id');
    vi.stubEnv('AI_API_KEY', 'ai-key');
    vi.stubEnv('STORAGE_DRIVER', 'memory');
    const container = await createContainer();

    expect(container.env.storageDriver).toBe('memory');
    expect(() => validateContainer(container)).not.toThrow();
    container.conversationCleaner.stop();
  });
});

function createInteraction(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    user: { id: userId },
    client: { ws: { ping: 12 } },
    guildId: 'guild-id',
    channelId: 'channel-id',
    channel: { id: 'channel-id', isThread: () => false },
    id: 'interaction-id',
    options: { getString: vi.fn().mockReturnValue('hello') },
    ...overrides,
  } as unknown as ChatInputCommandInteraction & { editReply: ReturnType<typeof vi.fn> };
}

function createMessage(sent: { edit: ReturnType<typeof vi.fn> }): Message {
  return {
    guildId: 'guild-id',
    channelId: 'channel-id',
    id: 'message-id',
    author: { id: 'user-id' },
    channel: { id: 'channel-id', isThread: () => false, sendTyping: vi.fn().mockResolvedValue(undefined) },
    reply: vi.fn().mockResolvedValue(sent),
  } as unknown as Message;
}

async function getOpenPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}
