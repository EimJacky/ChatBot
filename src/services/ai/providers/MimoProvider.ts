import { getModelCapabilities } from '../../../config/models.js';
import type {
  AIProvider,
  BaseChatCompletionParams,
  ExtendedChatCompletionParams,
  EffectiveSearchConfig,
  ProviderBuildContext,
  ProviderBuildResult,
  ProviderCapabilities,
  WebSearchConfig,
} from './types.js';
import { disabledSearchConfig } from './types.js';

export class MimoProvider implements AIProvider {
  readonly name = 'mimo' as const;

  getCapabilities(model: string): ProviderCapabilities {
    const capabilities = getModelCapabilities(model);

    return {
      ...capabilities,
      serverManagedWebSearch: capabilities.supportsWebSearch,
    };
  }

  getWebSearchStatus(model: string, webSearch: WebSearchConfig): EffectiveSearchConfig {
    if (!webSearch.enabled) {
      return disabledSearchConfig(webSearch, 'disabled', 'web search disabled by config');
    }

    const capabilities = this.getCapabilities(model);
    if (!capabilities.supportsWebSearch) {
      return disabledSearchConfig(webSearch, 'unsupported-model', `${model} does not support MiMo web search`);
    }

    return {
      requested: true,
      enabled: true,
      mode: webSearch.mode,
      maxKeyword: webSearch.maxKeyword,
      limit: webSearch.limit,
      forceSearch: webSearch.mode === 'force',
      status: 'enabled',
    };
  }

  buildChatCompletionParams(
    baseParams: BaseChatCompletionParams,
    context: ProviderBuildContext,
  ): ProviderBuildResult {
    const effectiveSearch = context.disableWebSearch
      ? disabledSearchConfig(context.webSearch, 'disabled', 'web search disabled for retry')
      : this.getWebSearchStatus(context.model, context.webSearch);

    if (!effectiveSearch.enabled) {
      return { params: { ...baseParams }, effectiveSearch };
    }

    const existingTools = Array.isArray(baseParams.tools) ? baseParams.tools : [];

    const { max_tokens: maxCompletionTokens, ...mimoBaseParams } = baseParams;
    const providerExtension = {
      tools: [
        ...existingTools,
        {
          type: 'web_search',
          max_keyword: effectiveSearch.maxKeyword,
          force_search: effectiveSearch.forceSearch,
          limit: effectiveSearch.limit,
        },
      ],
      thinking: {
        type: context.thinkingType,
      },
    } satisfies Pick<ExtendedChatCompletionParams, 'tools' | 'thinking'>;

    return {
      effectiveSearch,
      params: {
        ...mimoBaseParams,
        ...(maxCompletionTokens === undefined
          ? {}
          : { max_completion_tokens: maxCompletionTokens }),
        ...providerExtension,
      },
    };
  }
}
