import type { ChatInputCommandInteraction } from 'discord.js';
import type { Container } from '../config/container.js';
import { resolveConversationIdentity } from '../services/conversation/conversationKey.js';
import {
  buildDebugDashboard,
  buildModelsDashboard,
  buildStatsDashboard,
  buildUsageDashboard,
} from '../services/discord/ResponsePresentation.js';

export async function handleChatCommand(interaction: ChatInputCommandInteraction, container: Container) {
  const prompt = interaction.options.getString('prompt', true);
  await interaction.deferReply();
  await container.chatUseCase.handleInteraction(interaction, prompt);
}

export async function handleResetCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  const identity = resolveConversationIdentity({
    channelId: interaction.channelId,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channel: interaction.channel,
  });
  container.contextManager.reset(identity.conversationKey);
  await interaction.editReply('Context reset for this conversation.');
}

export async function handleStatsCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  const identity = resolveConversationIdentity({
    channelId: interaction.channelId,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channel: interaction.channel,
  });
  const stats = container.contextManager.getStats(identity.conversationKey);
  await interaction.editReply(buildStatsDashboard({
    conversationKey: identity.conversationKey,
    messages: stats.messages,
    estimatedTokens: stats.estimatedTokens,
    activeChannels: stats.activeChannels,
    contextWindowTokens: stats.contextWindowTokens,
  }));
}

export async function handleUsageCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  const now = Date.now();
  const windows = [7, 30, 90];
  const summaries = [];

  for (const days of windows) {
    const summary = container.usageStore.summarizeUser(
      interaction.user.id,
      now - days * 24 * 60 * 60 * 1_000,
    );
    summaries.push({ days, summary });
  }

  let owner: Parameters<typeof buildUsageDashboard>[0]['owner'] | undefined;
  if (container.env.botOwnerIds.has(interaction.user.id)) {
    const global = container.usageStore.summarizeGlobal(now - 30 * 24 * 60 * 60 * 1_000);
    const top = container.usageStore.topUsers(now - 30 * 24 * 60 * 60 * 1_000, 5);
    owner = {
      global30d: global,
      topUsers: top,
      detailEnabled: container.env.usageOwnerDetailEnabled,
    };
  }

  await interaction.editReply(buildUsageDashboard({
    userId: interaction.user.id,
    windows: summaries,
    ...(owner ? { owner } : {}),
  }));
}

export async function handlePersonaCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  const style = interaction.options.getString('style', true);
  const existing = container.preferenceStore.getUserPreferences(interaction.user.id);

  if (style === 'clear') {
    if (existing?.language) {
      container.preferenceStore.setUserPreferences({
        userId: interaction.user.id,
        language: existing.language,
        updatedAt: Date.now(),
      });
    } else {
      container.preferenceStore.clearUserPreferences(interaction.user.id);
    }
    await interaction.editReply('Persona preference cleared.');
    return;
  }

  container.preferenceStore.setUserPreferences({
    userId: interaction.user.id,
    ...(existing?.language ? { language: existing.language } : {}),
    persona: style,
    updatedAt: Date.now(),
  });
  await interaction.editReply(`Persona preference set to ${style}.`);
}

export async function handleLangCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  const language = interaction.options.getString('language', true);
  const existing = container.preferenceStore.getUserPreferences(interaction.user.id);

  if (language === 'clear') {
    if (existing?.persona) {
      container.preferenceStore.setUserPreferences({
        userId: interaction.user.id,
        persona: existing.persona,
        updatedAt: Date.now(),
      });
    } else {
      container.preferenceStore.clearUserPreferences(interaction.user.id);
    }
    await interaction.editReply('Language preference cleared.');
    return;
  }

  container.preferenceStore.setUserPreferences({
    userId: interaction.user.id,
    ...(existing?.persona ? { persona: existing.persona } : {}),
    language,
    updatedAt: Date.now(),
  });
  await interaction.editReply(`Language preference set to ${language}.`);
}

export async function handlePingCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply(`Pong. WebSocket ping: ${interaction.client.ws.ping}ms`);
}

export async function handleModelsCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  const env = container.env;
  const diagnostics = container.aiService.getLastDiagnostics();
  const capabilities = container.aiProvider.getCapabilities(env.aiModel);
  await interaction.editReply(buildModelsDashboard({
    provider: diagnostics.provider,
    model: env.aiModel,
    fallback: env.aiFallbackModel ?? 'none',
    temperature: env.aiTemperature,
    maxTokens: env.aiMaxTokens,
    contextWindowTokens: env.aiContextWindowTokens,
    streaming: env.aiStreamingEnabled,
    webSearchStatus: diagnostics.effectiveSearch.status,
    searchMode: env.aiWebSearch.mode,
    searchLimit: env.aiWebSearch.limit,
    supportsWebSearch: capabilities.supportsWebSearch,
    supportsThinking: capabilities.supportsThinking,
    supportsAnnotations: capabilities.supportsAnnotations,
  }));
}

export async function handleDebugCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  container.logger.warn(
    {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    },
    'debug command requested',
  );

  if (!container.env.debugCommandEnabled) {
    await interaction.editReply('Debug command is disabled.');
    return;
  }

  if (!container.env.botOwnerIds.has(interaction.user.id)) {
    await interaction.editReply('This command is restricted to the bot owner.');
    return;
  }

  const memory = process.memoryUsage();
  const contextStats = container.contextManager.getStats();
  const limiterStats = container.rateLimiters.getStats();
  const diagnostics = container.aiService.getLastDiagnostics();
  const searchDiagnostics = container.searchService.getDiagnostics();
  const metrics = container.metrics.getSnapshot();
  const storageHealth = container.storageMonitor.check();

  await interaction.editReply(buildDebugDashboard({
    memoryRssMb: (memory.rss / 1024 / 1024).toFixed(1),
    heapUsedMb: (memory.heapUsed / 1024 / 1024).toFixed(1),
    activeChannels: contextStats.activeChannels,
    contextMessages: contextStats.messages,
    contextTokens: contextStats.estimatedTokens,
    userLimiterKeys: limiterStats.user.keys,
    channelLimiterKeys: limiterStats.channel.keys,
    mentionLimiterKeys: limiterStats.mentionDaily.keys,
    provider: diagnostics.provider,
    diagnosticsCount: container.aiService.getDiagnosticsHistory().length,
    webSearchStatus: diagnostics.effectiveSearch.status,
    lastAiReason: diagnostics.lastDowngradeReason ?? 'none',
    appSearchMode: container.searchService.getEffectiveMode(),
    searchDiagnostics,
    storageHealth,
    metrics,
  }));
}
