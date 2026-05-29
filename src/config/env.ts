import 'dotenv/config';
import { z } from 'zod';
import { getModelDefaults } from './models.js';

const numberFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? defaultValue : Number(value)))
    .pipe(z.number().finite());

const optionalNumberFromString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : Number(value)))
  .pipe(z.number().finite().optional());

const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') {
        return defaultValue;
      }
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const positiveIntegerFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? defaultValue : Number(value)))
    .pipe(z.number().int().positive());

const ratioFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? defaultValue : Number(value)))
    .pipe(z.number().min(0).max(1));

const stringSetFromCsv = z
  .string()
  .optional()
  .default('')
  .transform((value) => new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional().default(''),
  BOT_OWNER_ID: z.string().optional().default(''),
  AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_API_KEY: z.string().min(1),
  AI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  AI_FALLBACK_MODEL: z.string().optional().default(''),
  AI_TEMPERATURE: numberFromString(0.7),
  AI_MAX_TOKENS: optionalNumberFromString,
  AI_CONTEXT_WINDOW_TOKENS: optionalNumberFromString,
  AI_STREAMING_ENABLED: booleanFromString(true),
  AI_STREAM_TIMEOUT_MS: numberFromString(60_000),
  AI_PROVIDER: z.enum(['auto', 'mimo', 'openai-compatible', 'standard']).default('auto'),
  AI_WEB_SEARCH_ENABLED: booleanFromString(true),
  AI_WEB_SEARCH_MODE: z.enum(['auto', 'force']).default('auto'),
  AI_WEB_SEARCH_MAX_KEYWORD: positiveIntegerFromString(5),
  AI_WEB_SEARCH_LIMIT: positiveIntegerFromString(3),
  AI_THINKING_TYPE: z.string().default('disabled'),
  AI_SHOW_SEARCH_ANNOTATIONS: booleanFromString(false),
  AI_NOTIFY_SEARCH_DOWNGRADE: booleanFromString(true),
  SEARCH_ENABLED: booleanFromString(false),
  SEARCH_PROVIDER: z.enum(['tavily']).default('tavily'),
  SEARCH_API_KEY: z.string().optional().default(''),
  SEARCH_RESULT_LIMIT: positiveIntegerFromString(2),
  SEARCH_CACHE_TTL_MS: positiveIntegerFromString(300_000),
  SEARCH_RATE_LIMIT_MAX: positiveIntegerFromString(10),
  SEARCH_RATE_LIMIT_WINDOW_MS: positiveIntegerFromString(60_000),
  SEARCH_DAILY_LIMIT: positiveIntegerFromString(100),
  SEARCH_DAILY_WARNING_RATIO: ratioFromString(0.8),
  SEARCH_LLM_INTENT_ENABLED: booleanFromString(false),
  SEARCH_SHOW_SKIP_REASON: booleanFromString(false),
  SEARCH_PROGRESS_NOTICE: booleanFromString(true),
  STORAGE_DRIVER: z.enum(['memory', 'sqlite']).default('memory'),
  SQLITE_DB_PATH: z.string().default('data/echomate.sqlite'),
  SQLITE_MAX_DB_SIZE_MB: positiveIntegerFromString(512),
  USAGE_RETENTION_DAYS: positiveIntegerFromString(90),
  USAGE_OWNER_DETAIL_ENABLED: booleanFromString(false),
  CONVERSATION_CLEANUP_ENABLED: booleanFromString(true),
  CONVERSATION_CLEANUP_INTERVAL_MS: positiveIntegerFromString(3_600_000),
  MAX_CONVERSATIONS_PER_USER: positiveIntegerFromString(1_000),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: positiveIntegerFromString(30_000),
  CHANNEL_ALLOWLIST: stringSetFromCsv,
  CHANNEL_BLOCKLIST: stringSetFromCsv,
  MESSAGE_REFERENCE_ENABLED: booleanFromString(true),
  FEEDBACK_REACTIONS_ENABLED: booleanFromString(false),
  ENABLE_MENTION_TRIGGER: booleanFromString(true),
  MENTION_DAILY_LIMIT: numberFromString(100),
  MAX_CONTEXT_MESSAGES: numberFromString(30),
  CONTEXT_TTL_HOURS: numberFromString(12),
  MAX_USER_PROMPT_CHARS: numberFromString(4_000),
  USER_RATE_LIMIT_MAX: numberFromString(5),
  USER_RATE_LIMIT_WINDOW_MS: numberFromString(60_000),
  CHANNEL_RATE_LIMIT_MAX: numberFromString(20),
  CHANNEL_RATE_LIMIT_WINDOW_MS: numberFromString(60_000),
  LOG_LEVEL: z.string().default('info'),
  LOG_DESTINATION: z.string().optional().default(''),
  HEALTH_CHECK_PORT: numberFromString(0),
  DEBUG_COMMAND_ENABLED: booleanFromString(true),
});

export type Env = ReturnType<typeof loadEnv>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(raw);
  const modelDefaults = getModelDefaults(parsed.AI_MODEL);

  return {
    nodeEnv: parsed.NODE_ENV,
    discordToken: parsed.DISCORD_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    botOwnerIds: new Set(parsed.BOT_OWNER_ID.split(',').map((id) => id.trim()).filter(Boolean)),
    aiBaseUrl: parsed.AI_BASE_URL,
    aiApiKey: parsed.AI_API_KEY,
    aiModel: parsed.AI_MODEL,
    aiFallbackModel: parsed.AI_FALLBACK_MODEL || undefined,
    aiTemperature: parsed.AI_TEMPERATURE,
    aiMaxTokens: parsed.AI_MAX_TOKENS ?? modelDefaults.maxOutputTokens,
    aiContextWindowTokens: parsed.AI_CONTEXT_WINDOW_TOKENS ?? modelDefaults.contextWindowTokens,
    aiStreamingEnabled: parsed.AI_STREAMING_ENABLED,
    aiStreamTimeoutMs: parsed.AI_STREAM_TIMEOUT_MS,
    aiProvider: parsed.AI_PROVIDER,
    aiWebSearch: {
      enabled: parsed.AI_WEB_SEARCH_ENABLED,
      mode: parsed.AI_WEB_SEARCH_MODE,
      maxKeyword: parsed.AI_WEB_SEARCH_MAX_KEYWORD,
      limit: parsed.AI_WEB_SEARCH_LIMIT,
    },
    aiThinkingType: parsed.AI_THINKING_TYPE,
    aiShowSearchAnnotations: parsed.AI_SHOW_SEARCH_ANNOTATIONS,
    aiNotifySearchDowngrade: parsed.AI_NOTIFY_SEARCH_DOWNGRADE,
    appSearch: {
      enabled: parsed.SEARCH_ENABLED,
      provider: parsed.SEARCH_PROVIDER,
      apiKey: parsed.SEARCH_API_KEY,
      resultLimit: parsed.SEARCH_RESULT_LIMIT,
      cacheTtlMs: parsed.SEARCH_CACHE_TTL_MS,
      rateLimitMax: parsed.SEARCH_RATE_LIMIT_MAX,
      rateLimitWindowMs: parsed.SEARCH_RATE_LIMIT_WINDOW_MS,
      dailyLimit: parsed.SEARCH_DAILY_LIMIT,
      dailyWarningRatio: parsed.SEARCH_DAILY_WARNING_RATIO,
      llmIntentEnabled: parsed.SEARCH_LLM_INTENT_ENABLED,
      showSkipReason: parsed.SEARCH_SHOW_SKIP_REASON,
      progressNotice: parsed.SEARCH_PROGRESS_NOTICE,
    },
    storageDriver: parsed.STORAGE_DRIVER,
    sqliteDbPath: parsed.SQLITE_DB_PATH,
    sqliteMaxDbSizeMb: parsed.SQLITE_MAX_DB_SIZE_MB,
    usageRetentionDays: parsed.USAGE_RETENTION_DAYS,
    usageOwnerDetailEnabled: parsed.USAGE_OWNER_DETAIL_ENABLED,
    conversationCleanupEnabled: parsed.CONVERSATION_CLEANUP_ENABLED,
    conversationCleanupIntervalMs: parsed.CONVERSATION_CLEANUP_INTERVAL_MS,
    maxConversationsPerUser: parsed.MAX_CONVERSATIONS_PER_USER,
    gracefulShutdownTimeoutMs: parsed.GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    channelAllowlist: parsed.CHANNEL_ALLOWLIST,
    channelBlocklist: parsed.CHANNEL_BLOCKLIST,
    messageReferenceEnabled: parsed.MESSAGE_REFERENCE_ENABLED,
    feedbackReactionsEnabled: parsed.FEEDBACK_REACTIONS_ENABLED,
    enableMentionTrigger: parsed.ENABLE_MENTION_TRIGGER,
    mentionDailyLimit: parsed.MENTION_DAILY_LIMIT,
    maxContextMessages: parsed.MAX_CONTEXT_MESSAGES,
    contextTtlHours: parsed.CONTEXT_TTL_HOURS,
    maxUserPromptChars: parsed.MAX_USER_PROMPT_CHARS,
    userRateLimitMax: parsed.USER_RATE_LIMIT_MAX,
    userRateLimitWindowMs: parsed.USER_RATE_LIMIT_WINDOW_MS,
    channelRateLimitMax: parsed.CHANNEL_RATE_LIMIT_MAX,
    channelRateLimitWindowMs: parsed.CHANNEL_RATE_LIMIT_WINDOW_MS,
    logLevel: parsed.LOG_LEVEL,
    logDestination: parsed.LOG_DESTINATION,
    healthCheckPort: parsed.HEALTH_CHECK_PORT,
    debugCommandEnabled: parsed.DEBUG_COMMAND_ENABLED,
  };
}
