import { createContainer } from './config/container.js';
import { registerInteractionCreateEvent } from './events/interactionCreate.js';
import { registerMessageCreateEvent } from './events/messageCreate.js';
import { registerReadyEvent } from './events/ready.js';
import { startHealthServer } from './health/server.js';
import { installGlobalErrorHandlers } from './utils/globalErrorHandlers.js';
import { configureGlobalProxy } from './utils/proxy.js';

const container = createContainer();
configureGlobalProxy(container.logger);
container.logger.info(
  {
    aiBaseUrl: container.env.aiBaseUrl,
    aiModel: container.env.aiModel,
    aiFallbackModel: container.env.aiFallbackModel ?? 'none',
    aiProvider: container.aiProvider.name,
    webSearch: container.aiService.getLastDiagnostics().effectiveSearch,
    search: {
      appSearchEnabled: container.env.appSearch.enabled,
      mimoNativeSearchEnabled: container.env.aiWebSearch.enabled,
      effectiveSearchMode: container.searchService.getEffectiveMode(),
      provider: container.env.appSearch.provider,
      resultLimit: container.env.appSearch.resultLimit,
      cacheTtlMs: container.env.appSearch.cacheTtlMs,
      dailyLimit: container.env.appSearch.dailyLimit,
      dailyWarningRatio: container.env.appSearch.dailyWarningRatio,
      llmIntentEnabled: container.env.appSearch.llmIntentEnabled,
      progressNotice: container.env.appSearch.progressNotice,
    },
  },
  'runtime AI configuration',
);
const healthServer = startHealthServer(container);

installGlobalErrorHandlers({
  logger: container.logger,
  client: container.client,
  ...(healthServer ? { healthServer } : {}),
});

registerReadyEvent(container.client, container);
registerInteractionCreateEvent(container.client, container);
registerMessageCreateEvent(container.client, container);

setInterval(() => {
  const memory = process.memoryUsage();
  container.logger.info(
    {
      rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
      heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
    },
    'memory usage',
  );
}, 60 * 60 * 1_000).unref();

await container.client.login(container.env.discordToken);
