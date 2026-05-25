import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';

export type ProviderConfigName = 'auto' | 'mimo' | 'openai-compatible' | 'standard';
export type ProviderName = Exclude<ProviderConfigName, 'auto'>;
export type WebSearchMode = 'auto' | 'force';

export interface ProviderCapabilities {
  supportsWebSearch: boolean;
  supportsThinking: boolean;
  supportsAnnotations: boolean;
  serverManagedWebSearch: boolean;
  recommended: boolean;
}

export interface WebSearchConfig {
  enabled: boolean;
  mode: WebSearchMode;
  maxKeyword: number;
  limit: number;
}

export type EffectiveSearchStatus =
  | 'enabled'
  | 'disabled'
  | 'unsupported'
  | 'unsupported-model'
  | 'ignored';

export interface EffectiveSearchConfig {
  requested: boolean;
  enabled: boolean;
  mode: WebSearchMode;
  maxKeyword: number;
  limit: number;
  forceSearch: boolean;
  status: EffectiveSearchStatus;
  reason?: string;
}

export interface ProviderExtensionParams {
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  thinking?: Record<string, unknown>;
}

export interface ExtendedChatCompletionParamsNonStreaming
  extends Omit<ChatCompletionCreateParamsNonStreaming, 'tools' | 'tool_choice'>,
    ProviderExtensionParams {
  stream?: false | null;
}

export interface ExtendedChatCompletionParamsStreaming
  extends Omit<ChatCompletionCreateParamsStreaming, 'tools' | 'tool_choice'>,
    ProviderExtensionParams {
  stream: true;
}

export type ExtendedChatCompletionParams =
  | ExtendedChatCompletionParamsNonStreaming
  | ExtendedChatCompletionParamsStreaming;

export type BaseChatCompletionParams = ExtendedChatCompletionParams;

export interface ProviderBuildContext {
  baseUrl: string;
  model: string;
  webSearch: WebSearchConfig;
  thinkingType: string;
  disableWebSearch?: boolean;
}

export interface ProviderBuildResult {
  params: ExtendedChatCompletionParams;
  effectiveSearch: EffectiveSearchConfig;
}

export interface AIProvider {
  readonly name: ProviderName;
  getCapabilities(model: string): ProviderCapabilities;
  getWebSearchStatus(model: string, webSearch: WebSearchConfig): EffectiveSearchConfig;
  buildChatCompletionParams(
    baseParams: BaseChatCompletionParams,
    context: ProviderBuildContext,
  ): ProviderBuildResult;
  processToolResult?(result: unknown): unknown;
}

export function disabledSearchConfig(
  webSearch: WebSearchConfig,
  status: EffectiveSearchStatus,
  reason?: string,
): EffectiveSearchConfig {
  return {
    requested: webSearch.enabled,
    enabled: false,
    mode: webSearch.mode,
    maxKeyword: webSearch.maxKeyword,
    limit: webSearch.limit,
    forceSearch: false,
    status,
    ...(reason ? { reason } : {}),
  };
}
