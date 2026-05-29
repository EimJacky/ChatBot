import { createServer, type Server } from 'node:http';
import type { Container } from '../config/container.js';
import { createTraceId, runWithTrace } from '../utils/trace.js';

export function startHealthServer(container: Container): Server | undefined {
  if (!container.env || container.env.healthCheckPort <= 0) {
    return undefined;
  }

  const server = createServer((request, response) => {
    runWithTrace({ traceId: createTraceId() }, () => {
    if (request.url === '/livez' || request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url === '/readyz') {
      const readiness = getReadiness(container);
      response.writeHead(readiness.ok ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify(readiness));
      return;
    }

    if (request.url === '/metrics') {
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      response.end(container.metrics.toPrometheus());
      return;
    }

      response.writeHead(404);
      response.end('not found');
    });
  });

  server.listen(container.env.healthCheckPort, '127.0.0.1', () => {
    container.logger.info({ port: container.env.healthCheckPort }, 'health server started');
  });

  return server;
}

function getReadiness(container: Container) {
  const memory = process.memoryUsage();
  const storage = container.storageMonitor?.check?.() ?? {
    ok: true,
    driver: 'unknown',
    elapsedMs: 0,
    degradedReasons: [],
  };
  const discordReady = container.client?.isReady?.() ?? false;
  const ok = storage.ok && discordReady;

  return {
    ok,
    discordReady,
    storage,
    memory: {
      rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
      heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
    },
  };
}
