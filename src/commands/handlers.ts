import type { ChatInputCommandInteraction } from 'discord.js';
import type { Container } from '../config/container.js';

export async function handleChatCommand(interaction: ChatInputCommandInteraction, container: Container) {
  const prompt = interaction.options.getString('prompt', true);
  await interaction.deferReply();
  await container.chatUseCase.handleInteraction(interaction, prompt);
}

export async function handleResetCommand(interaction: ChatInputCommandInteraction, container: Container) {
  container.contextManager.reset(interaction.channelId);
  await interaction.reply({ content: 'Context reset for this channel.', ephemeral: true });
}

export async function handleStatsCommand(interaction: ChatInputCommandInteraction, container: Container) {
  const stats = container.contextManager.getStats(interaction.channelId);
  await interaction.reply({
    content: [
      `Messages: ${stats.messages}`,
      `Estimated tokens: ${stats.estimatedTokens}`,
      `Active channels: ${stats.activeChannels}`,
      `Context window: ${stats.contextWindowTokens}`,
    ].join('\n'),
    ephemeral: true,
  });
}

export async function handlePingCommand(interaction: ChatInputCommandInteraction) {
  await interaction.reply({ content: `Pong. WebSocket ping: ${interaction.client.ws.ping}ms`, ephemeral: true });
}

export async function handleModelsCommand(interaction: ChatInputCommandInteraction, container: Container) {
  const env = container.env;
  const diagnostics = container.aiService.getLastDiagnostics();
  const capabilities = container.aiProvider.getCapabilities(env.aiModel);
  await interaction.reply({
    content: [
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
    ephemeral: true,
  });
}

export async function handleDebugCommand(interaction: ChatInputCommandInteraction, container: Container) {
  if (!container.env.botOwnerIds.has(interaction.user.id)) {
    await interaction.reply({ content: 'This command is restricted to the bot owner.', ephemeral: true });
    return;
  }

  const memory = process.memoryUsage();
  const contextStats = container.contextManager.getStats();
  const limiterStats = container.rateLimiters.getStats();
  const diagnostics = container.aiService.getLastDiagnostics();

  await interaction.reply({
    content: [
      `Memory RSS MB: ${(memory.rss / 1024 / 1024).toFixed(1)}`,
      `Heap used MB: ${(memory.heapUsed / 1024 / 1024).toFixed(1)}`,
      `Active channels: ${contextStats.activeChannels}`,
      `Context messages: ${contextStats.messages}`,
      `Context tokens: ${contextStats.estimatedTokens}`,
      `User limiter keys: ${limiterStats.user.keys}`,
      `Channel limiter keys: ${limiterStats.channel.keys}`,
      `Mention limiter keys: ${limiterStats.mentionDaily.keys}`,
      `Provider: ${diagnostics.provider}`,
      `Provider capabilities: ${JSON.stringify(diagnostics.capabilities)}`,
      `Effective search: ${JSON.stringify(diagnostics.effectiveSearch)}`,
      `Last annotations count: ${diagnostics.lastAnnotationsCount}`,
      `Last downgrade reason: ${diagnostics.lastDowngradeReason ?? 'none'}`,
    ].join('\n'),
    ephemeral: true,
  });
}
