import { accessSync, constants, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Container } from './container.js';

export function validateStartup(container: Container): void {
  const fatal: string[] = [];
  const warnings: string[] = [];

  if (container.env.storageDriver === 'sqlite') {
    try {
      mkdirSync(dirname(container.env.sqliteDbPath), { recursive: true });
      accessSync(dirname(container.env.sqliteDbPath), constants.W_OK);
    } catch (error) {
      fatal.push(`SQLite data directory is not writable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const storageHealth = container.storageMonitor.check();
  if (!storageHealth.ok) {
    fatal.push(`Storage health check failed: ${storageHealth.degradedReasons.join(', ')}`);
  }
  if (storageHealth.degradedReasons.length > 0) {
    warnings.push(`Storage degraded: ${storageHealth.degradedReasons.join(', ')}`);
  }

  if (container.env.storageDriver === 'memory' && container.env.nodeEnv === 'production') {
    warnings.push('Production is using in-memory storage; SQLite is recommended for long-running deployments.');
  }

  for (const warning of warnings) {
    container.logger.warn({ warning }, 'startup validation warning');
  }
  if (fatal.length > 0) {
    throw new Error(`Startup validation failed: ${fatal.join('; ')}`);
  }
}
