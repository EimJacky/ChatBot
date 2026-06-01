import { randomUUID } from 'node:crypto';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import type { Env } from '../config/env.js';
import { resolveConversationIdentity } from '../services/conversation/conversationKey.js';
import type { MetricsRecorder } from '../services/metrics/MetricsRecorder.js';
import type { PreferenceStore, UsageStore } from '../services/storage/interfaces.js';
import type { ChatRequest, ChatResult, StreamCallbacks } from '../types/chat.js';
import { runWithTrace } from '../utils/trace.js';
import { AppError, userFacingError } from '../utils/errors.js';
import type { AppLogger } from '../utils/logger.js';
import { fitDiscordMessage } from '../utils/text.js';
import type { AIService } from '../services/ai/AIService.js';
import type { ContextManager } from '../services/context/ContextManager.js';
import type { Tokenizer } from '../services/context/Tokenizer.js';
import type { StreamingMessageHandler } from '../services/discord/StreamingMessageHandler.js';
import { buildErrorPresentation, buildResponsePresentation } from '../services/discord/ResponsePresentation.js';
import type { BotRateLimiters } from '../services/rateLimit/RateLimiter.js';
import type { PromptAugmentor } from '../services/search/PromptAugmentor.js';
import { appendSearchSkipReason, type SearchService } from '../services/search/SearchService.js';

const currentDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export class ChatUseCase {
  constructor(
    private readonly env: Env,
    private readonly logger: AppLogger,
    private readonly ai: AIService,
    private readonly context: ContextManager,
    private readonly createStream: () => StreamingMessageHandler,
    private readonly rateLimiters: BotRateLimiters,
    private readonly search: SearchService,
    private readonly promptAugmentor: PromptAugmentor,
    private readonly systemPrompt: string,
    private readonly usage?: UsageStore,
    private readonly tokenizer?: Tokenizer,
    private readonly metrics?: MetricsRecorder,
    private readonly preferences?: PreferenceStore,
  ) {}

  async handleInteraction(interaction: ChatInputCommandInteraction, prompt: string): Promise<void> {
    const traceId = randomUUID();
    const identity = resolveConversationIdentity({
      channelId: interaction.channelId,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channel: interaction.channel,
    });
    const stream = this.createStream();

    await runWithTrace({
      traceId,
      conversationKey: identity.conversationKey,
      userId: interaction.user.id,
      guildId: interaction.guildId ?? undefined,
      channelId: interaction.channelId,
      threadId: identity.threadId,
    }, async () => {
    try {
      await stream.start(interaction);
      const result = await this.run(
        {
          traceId,
          conversationKey: identity.conversationKey,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
          ...(identity.threadId ? { threadId: identity.threadId } : {}),
          prompt,
          messageId: interaction.id,
        },
        {
          onSearchStart: () =>
            this.env.appSearch.progressNotice ? stream.edit(interaction, 'Searching web...') : undefined,
          onToken: (token: string) => stream.append(interaction, token),
        },
      );

      await stream.finish(interaction, result.content, result.presentation);
      await this.addFeedbackReactions(await fetchInteractionReply(interaction), traceId);
    } catch (error) {
      this.metrics?.recordError();
      this.logger.error({ traceId, err: error }, 'chat interaction failed');
      await stream.edit(interaction, buildErrorPresentation(userFacingError(error), errorCode(error)));
    }
    });
  }

  async handleMention(message: Message, prompt: string): Promise<void> {
    const traceId = randomUUID();
    const identity = resolveConversationIdentity({
      channelId: message.channelId,
      userId: message.author.id,
      guildId: message.guildId,
      channel: message.channel,
    });
    let sent: Message | undefined;
    let typingTimer: NodeJS.Timeout | undefined;

    await runWithTrace({
      traceId,
      conversationKey: identity.conversationKey,
      userId: message.author.id,
      guildId: message.guildId ?? undefined,
      channelId: message.channelId,
      threadId: identity.threadId,
    }, async () => {
    try {
      this.rateLimiters.mentionDaily.check(message.guildId ?? message.channelId);
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }
      sent = await message.reply('Thinking...');
      const result = await this.run(
        {
          traceId,
          conversationKey: identity.conversationKey,
          channelId: message.channelId,
          userId: message.author.id,
          ...(message.guildId ? { guildId: message.guildId } : {}),
          ...(identity.threadId ? { threadId: identity.threadId } : {}),
          prompt,
          messageId: message.id,
        },
        {
          onSearchStart: () => {
            if (!this.env.appSearch.progressNotice || !('sendTyping' in message.channel)) {
              return;
            }

            typingTimer = setInterval(() => {
              if ('sendTyping' in message.channel) {
                void message.channel.sendTyping();
              }
            }, 7_000);
            typingTimer.unref();
          },
          onSearchEnd: () => {
            clearTypingTimer(typingTimer);
            typingTimer = undefined;
          },
        },
      );
      await sent.edit(result.presentation ?? fitDiscordMessage(result.content));
      await this.addFeedbackReactions(sent, traceId);
    } catch (error) {
      this.metrics?.recordError();
      clearTypingTimer(typingTimer);
      typingTimer = undefined;
      this.logger.error({ traceId, err: error }, 'mention chat failed');
      const errorMessage = fitDiscordMessage(userFacingError(error));
      if (sent) {
        await sent.edit(buildErrorPresentation(errorMessage, errorCode(error)));
        return;
      }

      await message.reply(buildErrorPresentation(errorMessage, errorCode(error)));
    } finally {
      clearTypingTimer(typingTimer);
    }
    });
  }

  async run(request: ChatRequest, streamCallbacks: StreamCallbacks = {}): Promise<ChatResult> {
    const started = Date.now();
    const prompt = request.prompt.trim();

    if (!prompt) {
      throw new AppError('Please include a message for me to answer.', 'EMPTY_INPUT');
    }

    if (prompt.length > this.env.maxUserPromptChars) {
      throw new AppError(
        `Prompt is too long. Please keep it under ${this.env.maxUserPromptChars} characters.`,
        'INPUT_TOO_LONG',
      );
    }

    this.assertChannelAllowed(request);
    const conversationKey = request.conversationKey ?? request.channelId;
    this.rateLimiters.checkChat(request.userId, conversationKey);

    const history = this.context.get(conversationKey);
    const searchRequest = {
      traceId: request.traceId,
      userId: request.userId,
      query: prompt,
      ...(streamCallbacks.onSearchStart ? { onSearchStart: streamCallbacks.onSearchStart } : {}),
      ...(streamCallbacks.onSearchEnd ? { onSearchEnd: streamCallbacks.onSearchEnd } : {}),
    };
    const searchResult = await this.search.search(searchRequest);
    const systemPrompt = this.applyUserPreferences(request.userId, this.promptAugmentor.augment(
      withCurrentDateContext(this.systemPrompt),
      searchResult.promptInjection,
    ));
    const llmStarted = Date.now();
    const result = await this.ai.complete(
      {
        ...request,
        systemPrompt,
        messages: history,
        prompt,
      },
      streamCallbacks,
    );
    this.metrics?.recordLlmLatency(Date.now() - llmStarted);
    const content = this.env.appSearch.showSkipReason
      ? appendSearchSkipReason(result.content, searchResult)
      : result.content;

    this.context.add(conversationKey, {
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      userId: request.userId,
      ...(request.messageId ? { messageId: request.messageId } : {}),
    });
    this.context.add(conversationKey, {
      role: 'assistant',
      content,
      timestamp: Date.now(),
      metadata: {
        model: result.model,
        estimatedPromptTokens: result.estimatedPromptTokens,
        searchPerformed: searchResult.searchPerformed,
        searchEstimatedTokens: searchResult.estimatedTokens,
        searchCacheHit: searchResult.cacheHit,
        ...(searchResult.skippedReason ? { searchSkippedReason: searchResult.skippedReason } : {}),
      },
    });
    this.recordUsage({ ...request, conversationKey }, result, searchResult, Date.now() - started);
    this.metrics?.recordRequest(Date.now() - started);

    return {
      ...result,
      content,
      presentation: buildResponsePresentation(content, searchResult),
    };
  }

  private recordUsage(
    request: ChatRequest,
    result: ChatResult,
    searchResult: Awaited<ReturnType<SearchService['search']>>,
    elapsedMs: number,
  ): void {
    if (!this.usage || !this.tokenizer) {
      return;
    }
    const outputTokens = this.tokenizer.countText(result.content);
    const conversationKey = request.conversationKey ?? request.channelId;
    try {
      this.usage.recordUsage({
        id: randomUUID(),
        userId: request.userId,
        conversationKey,
        ...(request.guildId ? { guildId: request.guildId } : {}),
        channelId: request.channelId,
        ...(request.threadId ? { threadId: request.threadId } : {}),
        model: result.model,
        inputTokens: result.estimatedPromptTokens,
        outputTokens,
        searchPerformed: searchResult.searchPerformed,
        searchCacheHit: searchResult.cacheHit,
        elapsedMs,
        createdAt: Date.now(),
      });
      this.metrics?.recordTokens(result.estimatedPromptTokens, outputTokens);
    } catch (error) {
      this.metrics?.recordUsageWriteFailure();
      this.logger.error(
        {
          err: error,
          traceId: request.traceId,
          conversationKey,
          userId: request.userId,
        },
        'usage write failed',
      );
    }
  }

  private assertChannelAllowed(request: ChatRequest): void {
    const candidates = [request.channelId, request.threadId, request.conversationKey].filter(
      (value): value is string => Boolean(value),
    );
    if (candidates.some((value) => this.env.channelBlocklist.has(value))) {
      throw new AppError('This channel is blocked for bot replies.', 'CHANNEL_NOT_ALLOWED');
    }
    if (this.env.channelAllowlist.size > 0 && !candidates.some((value) => this.env.channelAllowlist.has(value))) {
      throw new AppError('This channel is not enabled for bot replies.', 'CHANNEL_NOT_ALLOWED');
    }
  }

  private applyUserPreferences(userId: string, systemPrompt: string): string {
    const preferences = this.preferences?.getUserPreferences(userId);
    if (!preferences?.persona && !preferences?.language) {
      return systemPrompt;
    }

    const lines = ['User response preferences:'];
    if (preferences.persona) {
      lines.push(`- Style/persona: ${preferences.persona}`);
    }
    if (preferences.language) {
      lines.push(`- Reply language: ${preferences.language}`);
    }

    return `${systemPrompt}\n\n${lines.join('\n')}`;
  }

  private async addFeedbackReactions(target: unknown, traceId: string): Promise<void> {
    if (!this.env.feedbackReactionsEnabled || !isReactable(target)) {
      return;
    }

    try {
      await target.react('👍');
      await target.react('👎');
    } catch (error) {
      this.logger.warn({ traceId, err: error }, 'feedback reactions failed');
    }
  }
}

async function fetchInteractionReply(interaction: ChatInputCommandInteraction): Promise<unknown> {
  try {
    return await interaction.fetchReply();
  } catch {
    return undefined;
  }
}

function isReactable(value: unknown): value is { react: (emoji: string) => Promise<unknown> } {
  return Boolean(value && typeof value === 'object' && 'react' in value && typeof value.react === 'function');
}

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'CHAT_FAILED';
}

function clearTypingTimer(timer: NodeJS.Timeout | undefined): void {
  if (timer) {
    clearInterval(timer);
  }
}

function withCurrentDateContext(systemPrompt: string): string {
  return `${systemPrompt}\n\nCurrent date: ${currentDateFormatter.format(new Date())} (Asia/Shanghai).`;
}
