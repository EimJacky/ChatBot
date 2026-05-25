import type {
  AIProvider,
  BaseChatCompletionParams,
  ProviderBuildContext,
  ProviderBuildResult,
  ProviderCapabilities,
  WebSearchConfig,
} from './types.js';
import { disabledSearchConfig } from './types.js';

export class StandardProvider implements AIProvider {
  readonly name = 'standard' as const;

  getCapabilities(_model?: string): ProviderCapabilities {
    void _model;
    return {
      supportsWebSearch: false,
      supportsThinking: false,
      supportsAnnotations: false,
      serverManagedWebSearch: false,
      recommended: false,
    };
  }

  getWebSearchStatus(_model: string, webSearch: WebSearchConfig) {
    return disabledSearchConfig(
      webSearch,
      webSearch.enabled ? 'ignored' : 'disabled',
      webSearch.enabled ? 'standard provider ignores all extensions' : 'web search disabled by config',
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
