import pino from 'pino';
import type { Env } from '../config/env.js';
import { getTraceContext } from './trace.js';

export function createLogger(env: Pick<Env, 'nodeEnv' | 'logLevel' | 'logDestination'>) {
  const baseOptions: pino.LoggerOptions = {
    level: env.logLevel,
    redact: {
      paths: ['DISCORD_TOKEN', 'AI_API_KEY', '*.apiKey', '*.token', 'req.headers.authorization'],
      censor: '[redacted]',
    },
    mixin() {
      return getTraceContext() ?? {};
    },
  };

  if (env.nodeEnv === 'development' && !env.logDestination) {
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  if (env.logDestination) {
    return pino(baseOptions, pino.destination({ dest: env.logDestination, sync: false }));
  }

  return pino(baseOptions);
}

export type AppLogger = ReturnType<typeof createLogger>;
