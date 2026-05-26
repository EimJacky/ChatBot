import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { Stream } from 'openai/streaming';
import type { Env } from '../../config/env.js';
import type { ChatMessage, StreamCallbacks } from '../../types/chat.js';
import { AppError, createHttpError, isHttpError } from '../../utils/errors.js';
import type { AppLogger } from '../../utils/logger.js';
import type { Tokenizer } from '../context/Tokenizer.js';
import type { PromptGuard } from './PromptGuard.js';
import type {
  AIProvider,
  BaseChatCompletionParams,
  EffectiveSearchConfig,
  ExtendedChatCompletionParams,
  ExtendedChatCompletionParamsNonStreaming,
  ExtendedChatCompletionParamsStreaming,
  ProviderCapabilities,
} from './providers/types.js';

export interface AICompletionInput {
  traceId: string;
  userId: string;
  channelId: string;
  systemPrompt: string;
  messages: ChatMessage[];
  prompt: string;
}

export interface AICompletionResult {
  content: string;
  model: string;
  estimatedPromptTokens: number;
}

interface AIProviderDiagnostics {
  provider: string;
  capabilities: ProviderCapabilities;
  effectiveSearch: EffectiveSearchConfig;
  lastWebSearchUsage?: unknown;
  lastAnnotationsCount: number;
  lastDowngradeReason?: string;
}

interface ProviderCompletionResult {
  content: string;
  model: string;
  effectiveSearch: EffectiveSearchConfig;
  annotations: SearchAnnotation[];
  webSearchUsage?: unknown;
  downgradeReason?: string;
}

export interface SearchAnnotation {
  title?: string;
  url?: string;
}

const DOWNGRADE_NOTICE =
  '*Search is temporarily unavailable, so I answered using local model knowledge.*';

export interface ExtendedChatCompletionsClient {
  create(
    params: ExtendedChatCompletionParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<ChatCompletion>;
  create(
    params: ExtendedChatCompletionParamsStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<Stream<ChatCompletionChunk>>;
}

export class AIService {
  private readonly client: OpenAI;
  private readonly chatCompletions: ExtendedChatCompletionsClient;
  // Last-completed request wins. This is intentionally diagnostic state for operations,
  // not precise monitoring; the object is replaced atomically so fields stay self-consistent.
  private lastDiagnostics: AIProviderDiagnostics;
  private readonly diagnosticsHistory: AIProviderDiagnostics[] = [];

  constructor(
    private readonly env: Env,
    private readonly logger: AppLogger,
    private readonly tokenizer: Tokenizer,
    private readonly promptGuard: PromptGuard,
    private readonly provider: AIProvider,
  ) {
    this.client = new OpenAI({
      apiKey: env.aiApiKey,
      baseURL: env.aiBaseUrl,
      timeout: env.aiStreamTimeoutMs,
      maxRetries: 0,
      ...(provider.name === 'mimo'
        ? {
            defaultHeaders: {
              'api-key': env.aiApiKey,
            },
          }
        : {}),
    });
    this.chatCompletions = this.client.chat.completions as unknown as ExtendedChatCompletionsClient;
    this.lastDiagnostics = this.createDiagnostics(env.aiModel, {
      requested: env.aiWebSearch.enabled,
      enabled: false,
      mode: env.aiWebSearch.mode,
      maxKeyword: env.aiWebSearch.maxKeyword,
      limit: env.aiWebSearch.limit,
      forceSearch: false,
      status: 'disabled',
      reason: 'no request completed yet',
    });
  }

  async complete(input: AICompletionInput, callbacks: StreamCallbacks = {}): Promise<AICompletionResult> {
    this.promptGuard.assertAllowed(input.prompt, input);

    const messages = this.toOpenAIMessages(input);
    const estimatedPromptTokens = this.tokenizer.countMessages([
      { role: 'system', content: input.systemPrompt, timestamp: Date.now() },
      ...input.messages,
      { role: 'user', content: input.prompt, timestamp: Date.now(), userId: input.userId },
    ]);

    const started = Date.now();
    const result = await this.tryModels(input.traceId, messages, callbacks);
    const content = this.postProcessContent(result);

    this.recordDiagnostics(this.createDiagnostics(result.model, result.effectiveSearch, {
      lastWebSearchUsage: result.webSearchUsage,
      lastAnnotationsCount: result.annotations.length,
      ...(result.downgradeReason ? { lastDowngradeReason: result.downgradeReason } : {}),
    }));

    this.logger.info(
      {
        traceId: input.traceId,
        model: result.model,
        provider: this.provider.name,
        webSearchEnabled: result.effectiveSearch.enabled,
        webSearchStatus: result.effectiveSearch.status,
        webSearchMode: result.effectiveSearch.mode,
        webSearchUsage: summarizeUsage(result.webSearchUsage),
        annotationsCount: result.annotations.length,
        downgradeReason: result.downgradeReason,
        elapsedMs: Date.now() - started,
        estimatedPromptTokens,
      },
      'ai completion finished',
    );

    return {
      content,
      model: result.model,
      estimatedPromptTokens,
    };
  }

  getLastDiagnostics(): AIProviderDiagnostics {
    return structuredClone(this.lastDiagnostics);
  }

  getDiagnosticsHistory(): AIProviderDiagnostics[] {
    return structuredClone(this.diagnosticsHistory);
  }

  getChatCompletionsClient(): ExtendedChatCompletionsClient {
    return this.chatCompletions;
  }

  private toOpenAIMessages(input: AICompletionInput): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: input.systemPrompt },
      ...input.messages.map((message) => ({
        role: message.role as 'user' | 'assistant' | 'system',
        content: message.content,
      })),
      { role: 'user', content: this.promptGuard.wrapUserContent(input.prompt) },
    ];
  }

  private async tryModels(
    traceId: string,
    messages: ChatCompletionMessageParam[],
    callbacks: StreamCallbacks,
  ) {
    const models = [this.env.aiModel, this.env.aiFallbackModel].filter(Boolean) as string[];
    let lastError: unknown;
    let disableSearchReason: string | undefined;

    for (const model of models) {
      try {
        return await this.completeWithRetry(traceId, model, messages, callbacks, disableSearchReason);
      } catch (error) {
        if (isSearchDowngradeFailure(error)) {
          disableSearchReason = error.downgradeReason;
          lastError = error.cause;
        } else {
          lastError = error;
        }
        this.logger.warn({ traceId, model, err: error }, 'ai model failed');
      }
    }

    throw this.normalizeAIError(lastError);
  }

  private async completeWithRetry(
    traceId: string,
    model: string,
    messages: ChatCompletionMessageParam[],
    callbacks: StreamCallbacks,
    disableWebSearchReason?: string,
  ) {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (this.env.aiStreamingEnabled) {
          return await this.completeStream(traceId, model, messages, callbacks, disableWebSearchReason);
        }

        return await this.completeOnce(model, messages, disableWebSearchReason);
      } catch (error) {
        if (!disableWebSearchReason && this.canDowngradeSearch(error)) {
          const downgradeReason = describeSearchDowngrade(error);
          const status = isHttpError(error) ? error.status : undefined;
          const message = error instanceof Error ? error.message : undefined;
          this.logger.warn(
            {
              traceId,
              model,
              provider: this.provider.name,
              status,
              message,
            },
            'web search failed, retrying without search',
          );
          try {
            return this.env.aiStreamingEnabled
              ? await this.completeStream(traceId, model, messages, callbacks, downgradeReason)
              : await this.completeOnce(model, messages, downgradeReason);
          } catch (downgradedError) {
            throw new SearchDowngradeFailure(downgradedError, downgradeReason);
          }
        }

        lastError = error;
        const status = isHttpError(error) ? error.status : undefined;
        const code = getErrorCode(error);
        const retryable = status === 429 || (status !== undefined && status >= 500) || code === 'ETIMEDOUT';

        if (!retryable || attempt === maxAttempts) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }

    throw lastError;
  }

  private async completeOnce(
    model: string,
    messages: ChatCompletionMessageParam[],
    downgradeReason?: string,
  ): Promise<ProviderCompletionResult> {
    const { params, effectiveSearch } = this.buildParams(model, messages, false, Boolean(downgradeReason));
    const requestParams = params as ExtendedChatCompletionParamsNonStreaming;
    if (this.shouldUseMimoRawSearch(requestParams)) {
      const response = await this.createMimoCompletionRaw(requestParams);
      return this.fromChatCompletion(model, response, effectiveSearch, downgradeReason);
    }

    const response = await this.chatCompletions.create(requestParams);
    return this.fromChatCompletion(model, response, effectiveSearch, downgradeReason);
  }

  private async completeStream(
    traceId: string,
    model: string,
    messages: ChatCompletionMessageParam[],
    callbacks: StreamCallbacks,
    downgradeReason?: string,
  ): Promise<ProviderCompletionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.env.aiStreamTimeoutMs);
    callbacks.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let content = '';
    let receivedToken = false;
    const { params, effectiveSearch } = this.buildParams(model, messages, true, Boolean(downgradeReason));

    try {
      const requestParams = params as ExtendedChatCompletionParamsStreaming;
      if (this.shouldUseMimoRawSearch(requestParams)) {
        const response = await this.createMimoCompletionRaw({ ...requestParams, stream: false });
        const result = this.fromChatCompletion(model, response, effectiveSearch, downgradeReason);
        if (result.content) {
          await callbacks.onToken?.(result.content);
        }
        return result;
      }

      const stream = await this.chatCompletions.create(requestParams, {
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        const token = getChunkContent(chunk);
        if (!token) {
          continue;
        }
        receivedToken = true;
        content += token;
        await callbacks.onToken?.(token);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('AI stream timed out.', 'AI_TIMEOUT', true, error);
      }

      this.logger.warn({ traceId, model, err: error }, 'stream failed, trying non-stream response');
      return this.completeOnce(model, messages, downgradeReason);
    } finally {
      clearTimeout(timeout);
    }

    if (!receivedToken) {
      throw new AppError('AI stream returned no content.', 'AI_TIMEOUT');
    }

    return {
      model,
      content,
      effectiveSearch,
      annotations: [],
      ...(downgradeReason ? { downgradeReason } : {}),
    };
  }

  private buildParams(
    model: string,
    messages: ChatCompletionMessageParam[],
    stream: boolean,
    disableWebSearch: boolean,
  ) {
    const baseParams: BaseChatCompletionParams = {
      model,
      messages,
      temperature: this.env.aiTemperature,
      max_tokens: this.env.aiMaxTokens,
      ...(stream ? { stream: true } : {}),
    };

    return this.provider.buildChatCompletionParams(baseParams, {
      model,
      baseUrl: this.env.aiBaseUrl,
      webSearch: this.env.aiWebSearch,
      thinkingType: this.env.aiThinkingType,
      disableWebSearch,
    });
  }

  private shouldUseMimoRawSearch(params: ExtendedChatCompletionParams): boolean {
    return (
      this.provider.name === 'mimo' &&
      Array.isArray(params.tools) &&
      params.tools.some((tool) => tool.type === 'web_search')
    );
  }

  private async createMimoCompletionRaw(
    params: ExtendedChatCompletionParamsNonStreaming,
  ): Promise<ChatCompletion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.env.aiStreamTimeoutMs);

    try {
      const response = await fetch(getChatCompletionsUrl(this.env.aiBaseUrl), {
        method: 'POST',
        headers: {
          'api-key': this.env.aiApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw createHttpStatusError(response.status, text);
      }

      return JSON.parse(text) as ChatCompletion;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AppError('AI request timed out.', 'AI_TIMEOUT', true, error);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private fromChatCompletion(
    model: string,
    response: ChatCompletion,
    effectiveSearch: EffectiveSearchConfig,
    downgradeReason?: string,
  ): ProviderCompletionResult {
    const message = response.choices[0]?.message;
    const annotations = extractAnnotations(message);

    return {
      model,
      content: message?.content ?? '',
      effectiveSearch,
      annotations,
      webSearchUsage: extractWebSearchUsage(response),
      ...(downgradeReason ? { downgradeReason } : {}),
    };
  }

  private normalizeAIError(error: unknown): AppError {
    const status = isHttpError(error) ? error.status : undefined;
    const code = getErrorCode(error);
    const message = error instanceof Error ? error.message : undefined;

    if (status === 401 || status === 403) {
      return new AppError('AI authentication failed.', 'AI_AUTH_ERROR', true, error);
    }

    if (status === 404 || status === 400) {
      return new AppError('AI model request failed.', 'AI_MODEL_ERROR', true, error);
    }

    if (code === 'AI_TIMEOUT') {
      return error as AppError;
    }

    return new AppError(message ?? 'AI request failed.', 'AI_REQUEST_FAILED', true, error);
  }

  private canDowngradeSearch(error: unknown): boolean {
    const status = isHttpError(error) ? error.status : undefined;
    return this.env.aiWebSearch.enabled && (status === 400 || status === 403);
  }

  private postProcessContent(result: ProviderCompletionResult): string {
    const parts = [result.content];

    if (this.env.aiShowSearchAnnotations && result.annotations.length > 0) {
      parts.push(formatAnnotations(result.annotations));
    }

    if (this.env.aiNotifySearchDowngrade && result.downgradeReason) {
      // Discord markdown convention in this project uses asterisks for italic status notes.
      parts.push(DOWNGRADE_NOTICE);
    }

    return parts.filter(Boolean).join('\n\n');
  }

  private createDiagnostics(
    model: string,
    effectiveSearch: EffectiveSearchConfig,
    extra: Partial<AIProviderDiagnostics> = {},
  ): AIProviderDiagnostics {
    return {
      provider: this.provider.name,
      capabilities: this.provider.getCapabilities(model),
      effectiveSearch,
      lastAnnotationsCount: 0,
      ...extra,
    };
  }

  private recordDiagnostics(diagnostics: AIProviderDiagnostics): void {
    this.lastDiagnostics = diagnostics;
    this.diagnosticsHistory.push(diagnostics);
    if (this.diagnosticsHistory.length > 20) {
      this.diagnosticsHistory.shift();
    }
  }
}

function getChunkContent(chunk: ChatCompletionChunk): string {
  return chunk.choices[0]?.delta?.content ?? '';
}

export function extractAnnotations(message: unknown): SearchAnnotation[] {
  // MiMo Web Search annotations are expected as url_citation objects; accept flat url/title too.
  const annotations = (message as { annotations?: unknown[] } | undefined)?.annotations;
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations
    .map<SearchAnnotation | undefined>((annotation) => {
      const record = annotation as Record<string, unknown>;
      const citation = (record.url_citation ?? record) as Record<string, unknown>;
      const url = typeof citation.url === 'string' ? citation.url : undefined;
      const title = typeof citation.title === 'string' ? citation.title : url;
      return url ? { ...(title ? { title } : {}), url } : undefined;
    })
    .filter((annotation): annotation is SearchAnnotation => Boolean(annotation));
}

function extractWebSearchUsage(response: ChatCompletion): unknown {
  const usage = response.usage as Record<string, unknown> | undefined;
  return usage?.web_search_usage ?? usage?.webSearchUsage;
}

function summarizeUsage(usage: unknown): unknown {
  if (!usage || typeof usage !== 'object') {
    return usage;
  }

  const record = usage as Record<string, unknown>;
  return {
    requestCount: record.request_count ?? record.requestCount,
    searchCount: record.search_count ?? record.searchCount,
    totalTokens: record.total_tokens ?? record.totalTokens,
  };
}

function formatAnnotations(annotations: SearchAnnotation[]): string {
  const lines = annotations.slice(0, 5).map((annotation, index) => {
    const title = annotation.title?.replace(/[\r\n]+/g, ' ').slice(0, 80) || annotation.url;
    return `[${index + 1}] [${title}](${annotation.url})`;
  });

  const text = `Sources:\n${lines.join('\n')}`;
  return text.length > 700 ? `${text.slice(0, 697)}...` : text;
}

function getChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

function createHttpStatusError(status: number, body: string) {
  const message = body.length > 500 ? `${body.slice(0, 500)}...` : body;
  return createHttpError(message || `HTTP ${status}`, status);
}

function describeSearchDowngrade(error: unknown): string {
  const status = isHttpError(error) ? error.status : undefined;
  const errorMessage = error instanceof Error ? error.message : '';
  const message = errorMessage.trim()
    ? errorMessage.replace(/\s+/g, ' ').slice(0, 240)
    : 'search request failed';

  return status ? `search request failed (${status}): ${message}` : message;
}

function getErrorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

class SearchDowngradeFailure extends Error {
  constructor(
    public readonly cause: unknown,
    public readonly downgradeReason: string,
  ) {
    super('Search downgrade retry failed');
    this.name = 'SearchDowngradeFailure';
  }
}

function isSearchDowngradeFailure(error: unknown): error is SearchDowngradeFailure {
  return error instanceof SearchDowngradeFailure;
}
