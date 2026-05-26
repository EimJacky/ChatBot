import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Container } from '../src/config/container.js';
import { handleDebugCommand } from '../src/commands/handlers.js';
import { startHealthServer } from '../src/health/server.js';

describe('health and debug surfaces', () => {
  it('returns only minimal health status', async () => {
    const port = await getOpenPort();
    const server = startHealthServer({
      env: { healthCheckPort: port },
      logger: { info: vi.fn() },
    } as unknown as Container);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('allows disabling the owner debug command and writes an audit log', async () => {
    const interaction = createInteraction('owner-id');
    const logger = { warn: vi.fn() };

    await handleDebugCommand(
      interaction,
      {
        env: {
          debugCommandEnabled: false,
          botOwnerIds: new Set(['owner-id']),
        },
        logger,
      } as unknown as Container,
    );

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith('Debug command is disabled.');
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-id' }), 'debug command requested');
  });
});

function createInteraction(userId: string): ChatInputCommandInteraction {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    user: { id: userId },
    guildId: 'guild-id',
    channelId: 'channel-id',
  } as unknown as ChatInputCommandInteraction;
}

async function getOpenPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}
