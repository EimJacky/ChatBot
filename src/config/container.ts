import { readFileSync } from 'node:fs';
import { Client, GatewayIntentBits } from 'discord.js';
import { AIService } from '../services/ai/AIService.js';
import { PromptGuard } from '../services/ai/PromptGuard.js';
import type { AIProvider } from '../services/ai/providers/types.js';
import { resolveProvider } from '../services/ai/providers/resolveProvider.js';
import { ContextManager } from '../services/context/ContextManager.js';
import { Tokenizer } from '../services/context/Tokenizer.js';
import { StreamingMessageHandler } from '../services/discord/StreamingMessageHandler.js';
import { PromptAugmentor } from '../services/search/PromptAugmentor.js';
import { SearchService } from '../services/search/SearchService.js';
import type { SearchProvider } from '../services/search/SearchProvider.js';
import { TavilySearchProvider } from '../services/search/TavilySearchProvider.js';
import { ConversationCleaner } from '../services/maintenance/ConversationCleaner.js';
import { MetricsRecorder } from '../services/metrics/MetricsRecorder.js';
import {
  MemoryContextStore,
  MemoryPreferenceStore,
  MemoryRateLimitStore,
  MemoryUsageStore,
} from '../services/storage/MemoryStores.js';
import { MemoryStorageMonitor, SqliteStores } from '../services/storage/SqliteStores.js';
import type {
  ContextStore,
  PreferenceStore,
  RateLimitStore,
  StorageMonitor,
  UsageStore,
} from '../services/storage/interfaces.js';
import {
  BotRateLimiters,
  DailyCounterLimiter,
  FixedWindowRateLimiter,
} from '../services/rateLimit/RateLimiter.js';
import { ChatUseCase } from '../application/ChatUseCase.js';
import { createLogger, type AppLogger } from '../utils/logger.js';
import { loadEnv, type Env } from './env.js';
import { loadPromptGuardRules } from './promptGuardRules.js';

export interface Container {
  env: Env;
  logger: AppLogger;
  client: Client;
  tokenizer: Tokenizer;
  contextManager: ContextManager;
  contextStore: ContextStore;
  rateLimitStore: RateLimitStore;
  usageStore: UsageStore;
  preferenceStore: PreferenceStore;
  storageMonitor: StorageMonitor;
  rateLimiters: BotRateLimiters;
  promptGuard: PromptGuard;
  aiProvider: AIProvider;
  aiService: AIService;
  searchProvider?: SearchProvider;
  searchService: SearchService;
  promptAugmentor: PromptAugmentor;
  createStreamingMessageHandler: () => StreamingMessageHandler;
  chatUseCase: ChatUseCase;
  metrics: MetricsRecorder;
  conversationCleaner: ConversationCleaner;
  systemPrompt: string;
}

export async function createContainer(): Promise<Container> {
  const env = loadEnv();
  const logger = createLogger(env);
  const tokenizer = new Tokenizer();
  const systemPrompt = readFileSync('prompts/system.md', 'utf8');
  const promptGuard = new PromptGuard(loadPromptGuardRules(), logger);
  const resolvedProvider = resolveProvider(env);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageTyping,
    ],
  });

  const stores = env.storageDriver === 'sqlite'
    ? await SqliteStores.open({
        dbPath: env.sqliteDbPath,
        maxDbSizeMb: env.sqliteMaxDbSizeMb,
        logger,
      })
    : undefined;
  const contextStore = stores ?? new MemoryContextStore();
  const rateLimitStore = stores ?? new MemoryRateLimitStore();
  const usageStore = stores ?? new MemoryUsageStore();
  const preferenceStore = stores ?? new MemoryPreferenceStore();
  const storageMonitor = stores ?? new MemoryStorageMonitor();

  const contextManager = new ContextManager(tokenizer, {
    maxContextMessages: env.maxContextMessages,
    contextWindowTokens: env.aiContextWindowTokens,
    contextTtlHours: env.contextTtlHours,
    reserveOutputTokens: env.aiMaxTokens,
  }, contextStore);

  const rateLimiters = new BotRateLimiters(
    new FixedWindowRateLimiter({
      max: env.userRateLimitMax,
      windowMs: env.userRateLimitWindowMs,
    }, rateLimitStore, 'chat-user'),
    new FixedWindowRateLimiter({
      max: env.channelRateLimitMax,
      windowMs: env.channelRateLimitWindowMs,
    }, rateLimitStore, 'chat-channel'),
    new DailyCounterLimiter(env.mentionDailyLimit, rateLimitStore, 'mention-daily'),
  );

  const aiService = new AIService(env, logger, tokenizer, promptGuard, resolvedProvider.provider);
  const searchProvider = env.appSearch.provider === 'tavily' && env.appSearch.apiKey
    ? new TavilySearchProvider({ apiKey: env.appSearch.apiKey })
    : undefined;
  const promptAugmentor = new PromptAugmentor(tokenizer);
  const searchService = new SearchService(
    env,
    logger,
    searchProvider,
    promptAugmentor,
    new FixedWindowRateLimiter({
      max: env.appSearch.rateLimitMax,
      windowMs: env.appSearch.rateLimitWindowMs,
    }, rateLimitStore, 'search-user'),
    new DailyCounterLimiter(env.appSearch.dailyLimit, rateLimitStore, 'search-daily'),
    aiService.getChatCompletionsClient(),
  );
  const createStreamingMessageHandler = () => StreamingMessageHandler.createDefault();
  const metrics = new MetricsRecorder();

  // This hand-wired container is intentionally simple for v1.
  // If cross-service notifications grow, replace this wiring point with an event bus.
  const chatUseCase = new ChatUseCase(
    env,
    logger,
    aiService,
    contextManager,
    createStreamingMessageHandler,
    rateLimiters,
    searchService,
    promptAugmentor,
    systemPrompt,
    usageStore,
    tokenizer,
    metrics,
    preferenceStore,
  );
  const conversationCleaner = new ConversationCleaner(
    env,
    logger,
    contextManager,
    rateLimitStore,
    usageStore,
    storageMonitor,
  );

  const container: Container = {
    env,
    logger,
    client,
    tokenizer,
    contextManager,
    contextStore,
    rateLimitStore,
    usageStore,
    preferenceStore,
    storageMonitor,
    rateLimiters,
    promptGuard,
    aiProvider: resolvedProvider.provider,
    aiService,
    ...(searchProvider ? { searchProvider } : {}),
    searchService,
    promptAugmentor,
    createStreamingMessageHandler,
    chatUseCase,
    metrics,
    conversationCleaner,
    systemPrompt,
  };

  validateContainer(container);
  return container;
}

export function validateContainer(container: Partial<Container>): asserts container is Container {
  const required: Array<keyof Container> = [
    'env',
    'logger',
    'client',
    'tokenizer',
    'contextManager',
    'contextStore',
    'rateLimitStore',
    'usageStore',
    'preferenceStore',
    'storageMonitor',
    'rateLimiters',
    'promptGuard',
    'aiProvider',
    'aiService',
    'searchService',
    'promptAugmentor',
    'createStreamingMessageHandler',
    'chatUseCase',
    'metrics',
    'conversationCleaner',
    'systemPrompt',
  ];

  const missing = required.filter((key) => !container[key]);
  if (missing.length > 0) {
    throw new Error(`Container validation failed. Missing: ${missing.join(', ')}`);
  }
}
