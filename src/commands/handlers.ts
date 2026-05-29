import type { ChatInputCommandInteraction } from 'discord.js';
import type { Container } from '../config/container.js';
import { resolveConversationIdentity } from '../services/conversation/conversationKey.js';

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
  await interaction.editReply(
    [
      `Conversation: ${identity.conversationKey}`,
      `Messages: ${stats.messages}`,
      `Estimated tokens: ${stats.estimatedTokens}`,
      `Active channels: ${stats.activeChannels}`,
      `Context window: ${stats.contextWindowTokens}`,
    ].join('\n'),
  );
}

export async function handleUsageCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  const now = Date.now();
  const windows = [7, 30, 90];
  const lines = [`Usage for <@${interaction.user.id}>`];

  for (const days of windows) {
    const summary = container.usageStore.summarizeUser(
      interaction.user.id,
      now - days * 24 * 60 * 60 * 1_000,
    );
    lines.push(
      `${days}d: ${summary.requests} replies, ${summary.inputTokens} input tokens, ${summary.outputTokens} output tokens, ${summary.searchRequests} searches, avg ${summary.averageElapsedMs}ms`,
    );
  }

  if (container.env.botOwnerIds.has(interaction.user.id)) {
    const global = container.usageStore.summarizeGlobal(now - 30 * 24 * 60 * 60 * 1_000);
    const top = container.usageStore.topUsers(now - 30 * 24 * 60 * 60 * 1_000, 5);
    lines.push('');
    lines.push(`Global 30d: ${global.requests} replies, ${global.inputTokens + global.outputTokens} tokens`);
    lines.push(
      `Top users: ${top.length > 0 ? top.map((user) => `${user.userId}:${user.requests}`).join(', ') : 'none'}`,
    );
  }

  await interaction.editReply(lines.join('\n'));
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
  await interaction.editReply(
    [
      `Provider: ${diagnostics.provider}`,
      `Model: ${env.aiModel}`,
      `Fallback: ${env.aiFallbackModel ?? 'none'}`,
      `Temperature: ${env.aiTemperature}`,
      `Max tokens: ${env.aiMaxTokens}`,
      `Context window: ${env.aiContextWindowTokens}`,
      `Streaming: ${env.aiStreamingEnabled}`,
      `Web search: ${diagnostics.effectiveSearch.status}`,
      `Search mode: ${env.aiWebSearch.mode}`,
      `Search max_keyword: ${env.aiWebSearch.maxKeyword}`,
      `Search limit: ${env.aiWebSearch.limit}`,
      `Supports web search: ${capabilities.supportsWebSearch}`,
      `Supports thinking: ${capabilities.supportsThinking}`,
      `Supports annotations: ${capabilities.supportsAnnotations}`,
    ].join('\n'),
  );
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

  await interaction.editReply(
    [
      `Memory RSS MB: ${(memory.rss / 1024 / 1024).toFixed(1)}`,
      `Heap used MB: ${(memory.heapUsed / 1024 / 1024).toFixed(1)}`,
      `Active channels: ${contextStats.activeChannels}`,
      `Context messages: ${contextStats.messages}`,
      `Context tokens: ${contextStats.estimatedTokens}`,
      `User limiter keys: ${limiterStats.user.keys}`,
      `Channel limiter keys: ${limiterStats.channel.keys}`,
      `Mention limiter keys: ${limiterStats.mentionDaily.keys}`,
      `Provider: ${diagnostics.provider}`,
      `AI diagnostics count: ${container.aiService.getDiagnosticsHistory().length}`,
      `Web search status: ${diagnostics.effectiveSearch.status}`,
      `Last AI reason: ${diagnostics.lastDowngradeReason ?? 'none'}`,
      `App search mode: ${container.searchService.getEffectiveMode()}`,
      `App search diagnostics: ${JSON.stringify(searchDiagnostics)}`,
      `Storage health: ${JSON.stringify(storageHealth)}`,
      `Metrics: ${JSON.stringify(metrics)}`,
    ].join('\n'),
  );
}
