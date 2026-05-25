import type { Env } from '../../../config/env.js';
import type { AIProvider, ProviderName } from './types.js';
import { MimoProvider } from './MimoProvider.js';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import { StandardProvider } from './StandardProvider.js';

const MIMO_PROVIDER_HOST_SUFFIX = '.xiaomimimo.com';
const MIMO_PROVIDER_ROOT_HOST = 'xiaomimimo.com';

export interface ResolvedProvider {
  provider: AIProvider;
  providerName: ProviderName;
  autoDetected: boolean;
}

export function resolveProvider(env: Pick<Env, 'aiProvider' | 'aiBaseUrl'>): ResolvedProvider {
  const providerName = env.aiProvider === 'auto' ? detectProvider(env.aiBaseUrl) : env.aiProvider;

  return {
    providerName,
    autoDetected: env.aiProvider === 'auto',
    provider: createProvider(providerName),
  };
}

function detectProvider(baseUrl: string): ProviderName {
  const hostname = new URL(baseUrl).hostname.toLowerCase();

  if (hostname === MIMO_PROVIDER_ROOT_HOST || hostname.endsWith(MIMO_PROVIDER_HOST_SUFFIX)) {
    return 'mimo';
  }

  return 'openai-compatible';
}

function createProvider(providerName: ProviderName): AIProvider {
  switch (providerName) {
    case 'mimo':
      return new MimoProvider();
    case 'standard':
      return new StandardProvider();
    case 'openai-compatible':
      return new OpenAICompatibleProvider();
  }
}
