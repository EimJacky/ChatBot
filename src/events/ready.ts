import { Events } from 'discord.js';
import type { Client } from 'discord.js';
import type { Container } from '../config/container.js';

export function registerReadyEvent(client: Client, container: Container) {
  client.on(Events.Debug, (message) => {
    container.logger.debug({ message }, 'discord client debug');
  });

  client.on(Events.Warn, (message) => {
    container.logger.warn({ message }, 'discord client warning');
  });

  client.on(Events.Error, (error) => {
    container.logger.error({ err: error }, 'discord client error');
  });

  client.on(Events.ShardError, (error, shardId) => {
    container.logger.error({ err: error, shardId }, 'discord shard error');
  });

  client.on(Events.ShardDisconnect, (event, shardId) => {
    container.logger.warn(
      { shardId, code: event.code, reason: event.reason },
      'discord shard disconnected',
    );
  });

  client.on(Events.ShardReady, (shardId, unavailableGuilds) => {
    container.logger.info({ shardId, unavailableGuilds }, 'discord shard ready');
  });

  client.once(Events.ClientReady, async (readyClient) => {
    const application = await readyClient.application.fetch().catch((error: unknown) => {
      container.logger.warn({ err: error }, 'failed to fetch application info');
      return undefined;
    });

    container.logger.info(
      {
        user: readyClient.user.tag,
        botUserId: readyClient.user.id,
        applicationId: application?.id ?? readyClient.application.id,
        configuredClientId: container.env.discordClientId,
        clientIdMatchesTokenApplication:
          (application?.id ?? readyClient.application.id) === container.env.discordClientId,
        guilds: readyClient.guilds.cache.map((guild) => ({
          id: guild.id,
          name: guild.name,
        })),
      },
      'discord bot is ready',
    );
  });
}
