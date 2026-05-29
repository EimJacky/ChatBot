import type { Client } from 'discord.js';
import type { Server } from 'node:http';
import type { AppLogger } from './logger.js';

export function installGlobalErrorHandlers(options: {
  logger: AppLogger;
  client?: Client;
  healthServer?: Server;
  shutdownTimeoutMs?: number;
  onShutdown?: () => Promise<void> | void;
}) {
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number, error?: unknown) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    const log = exitCode === 0 ? options.logger.info.bind(options.logger) : options.logger.fatal.bind(options.logger);
    log({ err: error, reason }, 'shutting down');

    const timeout = setTimeout(() => process.exit(exitCode), options.shutdownTimeoutMs ?? 30_000);
    timeout.unref();

    try {
      await options.onShutdown?.();
      await new Promise<void>((resolve) => options.healthServer?.close(() => resolve()) ?? resolve());
      void options.client?.destroy();
    } finally {
      clearTimeout(timeout);
      process.exit(exitCode);
    }
  };

  process.on('unhandledRejection', (reason) => {
    void shutdown('unhandledRejection', 1, reason);
  });

  process.on('uncaughtException', (error) => {
    void shutdown('uncaughtException', 1, error);
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT', 0);
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM', 0);
  });
}
