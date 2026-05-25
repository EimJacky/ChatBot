import { getModelCapabilities } from '../../../config/models.js';
import type {
  AIProvider,
  BaseChatCompletionParams,
  ProviderBuildContext,
  ProviderBuildResult,
  ProviderCapabilities,
  WebSearchConfig,
} from './types.js';
import { disabledSearchConfig } from './types.js';

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible' as const;

  getCapabilities(model: string): ProviderCapabilities {
    const capabilities = getModelCapabilities(model);

    return {
      supportsWebSearch: false,
      supportsThinking: false,
      supportsAnnotations: capabilities.supportsAnnotations,
      serverManagedWebSearch: false,
      recommended: capabilities.recommended,
    };
  }

  getWebSearchStatus(_model: string, webSearch: WebSearchConfig) {
    return disabledSearchConfig(
      webSearch,
      webSearch.enabled ? 'unsupported' : 'disabled',
      webSearch.enabled ? 'provider does not support web search extensions' : 'web search disabled by config',
    );
  }

  buildChatCompletionParams(
    baseParams: BaseChatCompletionParams,
    context: ProviderBuildContext,
  ): ProviderBuildResult {
    return {
      params: { ...baseParams },
      effectiveSearch: this.getWebSearchStatus(context.model, context.webSearch),
    };
  }
}
