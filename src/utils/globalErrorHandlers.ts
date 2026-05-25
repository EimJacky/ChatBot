import type { Client } from 'discord.js';
import type { Server } from 'node:http';
import type { AppLogger } from './logger.js';

export function installGlobalErrorHandlers(options: {
  logger: AppLogger;
  client?: Client;
  healthServer?: Server;
}) {
  const shutdown = async (reason: string, error?: unknown) => {
    options.logger.fatal({ err: error, reason }, 'shutting down');

    void options.healthServer?.close();
    void options.client?.destroy();

    process.exitCode = 1;
    setTimeout(() => process.exit(1), 250).unref();
  };

  process.on('unhandledRejection', (reason) => {
    void shutdown('unhandledRejection', reason);
  });

  process.on('uncaughtException', (error) => {
    void shutdown('uncaughtException', error);
  });

  process.on('SIGINT', () => {
    options.logger.info('received SIGINT');
    void options.healthServer?.close();
    void options.client?.destroy();
    void process.exit(0);
  });

  process.on('SIGTERM', () => {
    options.logger.info('received SIGTERM');
    void options.healthServer?.close();
    void options.client?.destroy();
    void process.exit(0);
  });
}
