import { Events } from 'discord.js';
import type { Client, Interaction } from 'discord.js';
import type { Container } from '../config/container.js';
import {
  handleChatCommand,
  handleDebugCommand,
  handleLangCommand,
  handleModelsCommand,
  handlePersonaCommand,
  handlePingCommand,
  handleResetCommand,
  handleStatsCommand,
  handleUsageCommand,
} from '../commands/handlers.js';
import { createTraceId, runWithTrace } from '../utils/trace.js';

export function registerInteractionCreateEvent(client: Client, container: Container) {
  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    void handleInteraction(interaction, container).catch((error: unknown) =>
      handleInteractionError(interaction, container, error),
    );
  });
}

async function handleInteraction(interaction: Interaction, container: Container) {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  await runWithTrace({
    traceId: createTraceId(),
    userId: interaction.user.id,
    guildId: interaction.guildId ?? undefined,
    channelId: interaction.channelId,
  }, async () => {
  container.logger.info(
    {
      commandName: interaction.commandName,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
    },
    'received slash command',
  );

  switch (interaction.commandName) {
    case 'chat':
      await handleChatCommand(interaction, container);
      break;
    case 'reset':
      await handleResetCommand(interaction, container);
      break;
    case 'stats':
      await handleStatsCommand(interaction, container);
      break;
    case 'usage':
      await handleUsageCommand(interaction, container);
      break;
    case 'persona':
      await handlePersonaCommand(interaction, container);
      break;
    case 'lang':
      await handleLangCommand(interaction, container);
      break;
    case 'ping':
      await handlePingCommand(interaction);
      break;
    case 'models':
      await handleModelsCommand(interaction, container);
      break;
    case 'debug':
      await handleDebugCommand(interaction, container);
      break;
    default:
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
  }
  });
}

async function handleInteractionError(
  interaction: Interaction,
  container: Container,
  error: unknown,
) {
  container.logger.error({ err: error }, 'interaction handler failed');

  if (!interaction.isRepliable()) {
    return;
  }

  const content = 'Command failed before it could finish. Check the bot logs.';

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (replyError) {
    container.logger.error({ err: replyError }, 'failed to send interaction error response');
  }
}
