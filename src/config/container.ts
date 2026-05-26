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
  rateLimiters: BotRateLimiters;
  promptGuard: PromptGuard;
  aiProvider: AIProvider;
  aiService: AIService;
  searchProvider?: SearchProvider;
  searchService: SearchService;
  promptAugmentor: PromptAugmentor;
  createStreamingMessageHandler: () => StreamingMessageHandler;
  chatUseCase: ChatUseCase;
  systemPrompt: string;
}

export function createContainer(): Container {
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

  const contextManager = new ContextManager(tokenizer, {
    maxContextMessages: env.maxContextMessages,
    contextWindowTokens: env.aiContextWindowTokens,
    contextTtlHours: env.contextTtlHours,
    reserveOutputTokens: env.aiMaxTokens,
  });

  const rateLimiters = new BotRateLimiters(
    new FixedWindowRateLimiter({
      max: env.userRateLimitMax,
      windowMs: env.userRateLimitWindowMs,
    }),
    new FixedWindowRateLimiter({
      max: env.channelRateLimitMax,
      windowMs: env.channelRateLimitWindowMs,
    }),
    new DailyCounterLimiter(env.mentionDailyLimit),
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
    }),
    new DailyCounterLimiter(env.appSearch.dailyLimit),
    aiService.getChatCompletionsClient(),
  );
  const createStreamingMessageHandler = () => StreamingMessageHandler.createDefault();

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
  );

  const container: Container = {
    env,
    logger,
    client,
    tokenizer,
    contextManager,
    rateLimiters,
    promptGuard,
    aiProvider: resolvedProvider.provider,
    aiService,
    ...(searchProvider ? { searchProvider } : {}),
    searchService,
    promptAugmentor,
    createStreamingMessageHandler,
    chatUseCase,
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
    'rateLimiters',
    'promptGuard',
    'aiProvider',
    'aiService',
    'searchService',
    'promptAugmentor',
    'createStreamingMessageHandler',
    'chatUseCase',
    'systemPrompt',
  ];

  const missing = required.filter((key) => !container[key]);
  if (missing.length > 0) {
    throw new Error(`Container validation failed. Missing: ${missing.join(', ')}`);
  }
}
