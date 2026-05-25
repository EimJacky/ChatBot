import { ProxyAgent, setGlobalDispatcher } from 'undici';
import type { AppLogger } from './logger.js';

export function configureGlobalProxy(logger?: Pick<AppLogger, 'info'>): string | undefined {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  if (!proxyUrl) {
    return undefined;
  }

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  logger?.info({ proxyUrl }, 'configured global HTTP proxy');
  return proxyUrl;
}

