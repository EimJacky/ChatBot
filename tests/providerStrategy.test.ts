import { describe, expect, it } from 'vitest';
import { resolveProvider } from '../src/services/ai/providers/resolveProvider.js';
import { MimoProvider } from '../src/services/ai/providers/MimoProvider.js';
import { OpenAICompatibleProvider } from '../src/services/ai/providers/OpenAICompatibleProvider.js';
import { StandardProvider } from '../src/services/ai/providers/StandardProvider.js';
import type { BaseChatCompletionParams, WebSearchConfig } from '../src/services/ai/providers/types.js';

const baseParams: BaseChatCompletionParams = {
  model: 'mimo-v2.5-pro',
  messages: [{ role: 'user', content: 'latest news?' }],
  temperature: 0.7,
  max_tokens: 1000,
};

const webSearch: WebSearchConfig = {
  enabled: true,
  mode: 'force',
  maxKeyword: 5,
  limit: 3,
};

describe('provider strategy', () => {
  it('auto-detects MiMo by base URL', () => {
    const resolved = resolveProvider({
      aiProvider: 'auto',
      aiBaseUrl: 'https://api.xiaomimimo.com/v1',
    });

    expect(resolved.provider.name).toBe('mimo');
    expect(resolved.autoDetected).toBe(true);
  });

  it('auto-detects MiMo for any xiaomimimo.com subdomain', () => {
    const resolved = resolveProvider({
      aiProvider: 'auto',
      aiBaseUrl: 'https://new-region.xiaomimimo.com/v1',
    });

    expect(resolved.provider.name).toBe('mimo');
  });

  it('auto-detects standard OpenAI-compatible providers otherwise', () => {
    const resolved = resolveProvider({
      aiProvider: 'auto',
      aiBaseUrl: 'https://api.openai.com/v1',
    });

    expect(resolved.provider.name).toBe('openai-compatible');
  });

  it('builds MiMo web search params in force mode', () => {
    const provider = new MimoProvider();
    const result = provider.buildChatCompletionParams(baseParams, {
      model: 'mimo-v2.5-pro',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      webSearch,
      thinkingType: 'disabled',
    });

    expect(result.effectiveSearch).toMatchObject({
      enabled: true,
      forceSearch: true,
      status: 'enabled',
    });
    expect(result.params.tools).toEqual([
      {
        type: 'web_search',
        max_keyword: 5,
        force_search: true,
        limit: 3,
      },
    ]);
    expect(result.params.tool_choice).toBeUndefined();
    expect(result.params.max_tokens).toBeUndefined();
    expect(result.params.max_completion_tokens).toBe(1000);
    expect(result.params.thinking).toEqual({ type: 'disabled' });
  });

  it('downgrades unsupported MiMo models to no-search params', () => {
    const provider = new MimoProvider();
    const result = provider.buildChatCompletionParams(
      { ...baseParams, model: 'unknown-model' },
      {
        model: 'unknown-model',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        webSearch,
        thinkingType: 'disabled',
      },
    );

    expect(result.effectiveSearch.status).toBe('unsupported-model');
    expect(result.params.tools).toBeUndefined();
  });

  it('does not inject extensions for OpenAI-compatible or standard providers', () => {
    const openai = new OpenAICompatibleProvider().buildChatCompletionParams(baseParams, {
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      webSearch,
      thinkingType: 'disabled',
    });
    const standard = new StandardProvider().buildChatCompletionParams(baseParams, {
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      webSearch,
      thinkingType: 'disabled',
    });

    expect(openai.effectiveSearch.status).toBe('unsupported');
    expect(openai.params.tools).toBeUndefined();
    expect(standard.effectiveSearch.status).toBe('ignored');
    expect(standard.params.tools).toBeUndefined();
  });

  it('reports provider capabilities explicitly', () => {
    expect(new OpenAICompatibleProvider().getCapabilities('gpt-4o-mini')).toMatchObject({
      supportsWebSearch: false,
      supportsThinking: false,
    });
    expect(new StandardProvider().getCapabilities('gpt-4o-mini')).toEqual({
      supportsWebSearch: false,
      supportsThinking: false,
      supportsAnnotations: false,
      serverManagedWebSearch: false,
      recommended: false,
    });
    expect(new MimoProvider().getCapabilities('mimo-v2.5-pro')).toMatchObject({
      supportsWebSearch: true,
      supportsThinking: true,
      supportsAnnotations: true,
    });
    expect(new MimoProvider().getCapabilities('unknown-model')).toMatchObject({
      supportsWebSearch: false,
    });
  });
});
