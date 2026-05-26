import type { ChatInputCommandInteraction } from 'discord.js';
import type { Container } from '../config/container.js';

export async function handleChatCommand(interaction: ChatInputCommandInteraction, container: Container) {
  const prompt = interaction.options.getString('prompt', true);
  await interaction.deferReply();
  await container.chatUseCase.handleInteraction(interaction, prompt);
}

export async function handleResetCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  container.contextManager.reset(interaction.channelId);
  await interaction.editReply('Context reset for this channel.');
}

export async function handleStatsCommand(interaction: ChatInputCommandInteraction, container: Container) {
  await interaction.deferReply({ ephemeral: true });
  const stats = container.contextManager.getStats(interaction.channelId);
  await interaction.editReply(
    [
      `Messages: ${stats.messages}`,
      `Estimated tokens: ${stats.estimatedTokens}`,
      `Active channels: ${stats.activeChannels}`,
      `Context window: ${stats.contextWindowTokens}`,
    ].join('\n'),
  );
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
    ].join('\n'),
  );
}
