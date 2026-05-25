import { createServer, type Server } from 'node:http';
import type { Container } from '../config/container.js';

export function startHealthServer(container: Container): Server | undefined {
  if (container.env.healthCheckPort <= 0) {
    return undefined;
  }

  const server = createServer((request, response) => {
    if (request.url !== '/healthz') {
      response.writeHead(404);
      response.end('not found');
      return;
    }

    const stats = container.contextManager.getStats();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        uptime: process.uptime(),
        activeChannels: stats.activeChannels,
        contextMessages: stats.messages,
        estimatedTokens: stats.estimatedTokens,
      }),
    );
  });

  server.listen(container.env.healthCheckPort, '127.0.0.1', () => {
    container.logger.info({ port: container.env.healthCheckPort }, 'health server started');
  });

  return server;
}

