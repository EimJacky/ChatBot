import { randomUUID } from 'node:crypto';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import type { Env } from '../config/env.js';
import type { ChatRequest, ChatResult, StreamCallbacks } from '../types/chat.js';
import { AppError, userFacingError } from '../utils/errors.js';
import type { AppLogger } from '../utils/logger.js';
import { fitDiscordMessage } from '../utils/text.js';
import type { AIService } from '../services/ai/AIService.js';
import type { ContextManager } from '../services/context/ContextManager.js';
import type { StreamingMessageHandler } from '../services/discord/StreamingMessageHandler.js';
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
  ) {}

  async handleInteraction(interaction: ChatInputCommandInteraction, prompt: string): Promise<void> {
    const traceId = randomUUID();
    const stream = this.createStream();

    try {
      await stream.start(interaction);
      const result = await this.run(
        {
          traceId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          prompt,
          messageId: interaction.id,
        },
        {
          onSearchStart: () =>
            this.env.appSearch.progressNotice ? stream.edit(interaction, 'Searching web...') : undefined,
          onToken: (token: string) => stream.append(interaction, token),
        },
      );

      await stream.finish(interaction, result.content);
    } catch (error) {
      this.logger.error({ traceId, err: error }, 'chat interaction failed');
      await stream.edit(interaction, userFacingError(error));
    }
  }

  async handleMention(message: Message, prompt: string): Promise<void> {
    const traceId = randomUUID();
    let sent: Message | undefined;
    let typingTimer: NodeJS.Timeout | undefined;

    try {
      this.rateLimiters.mentionDaily.check(message.guildId ?? message.channelId);
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }
      sent = await message.reply('Thinking...');
      const result = await this.run(
        {
          traceId,
          channelId: message.channelId,
          userId: message.author.id,
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
      await sent.edit(fitDiscordMessage(result.content));
    } catch (error) {
      clearTypingTimer(typingTimer);
      typingTimer = undefined;
      this.logger.error({ traceId, err: error }, 'mention chat failed');
      const errorMessage = fitDiscordMessage(userFacingError(error));
      if (sent) {
        await sent.edit(errorMessage);
        return;
      }

      await message.reply(errorMessage);
    } finally {
      clearTypingTimer(typingTimer);
    }
  }

  async run(request: ChatRequest, streamCallbacks: StreamCallbacks = {}): Promise<ChatResult> {
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

    this.rateLimiters.checkChat(request.userId, request.channelId);

    const history = this.context.get(request.channelId);
    const searchRequest = {
      traceId: request.traceId,
      userId: request.userId,
      query: prompt,
      ...(streamCallbacks.onSearchStart ? { onSearchStart: streamCallbacks.onSearchStart } : {}),
      ...(streamCallbacks.onSearchEnd ? { onSearchEnd: streamCallbacks.onSearchEnd } : {}),
    };
    const searchResult = await this.search.search(searchRequest);
    const systemPrompt = this.promptAugmentor.augment(
      withCurrentDateContext(this.systemPrompt),
      searchResult.promptInjection,
    );
    const result = await this.ai.complete(
      {
        ...request,
        systemPrompt,
        messages: history,
        prompt,
      },
      streamCallbacks,
    );
    const content = this.env.appSearch.showSkipReason
      ? appendSearchSkipReason(result.content, searchResult)
      : result.content;

    this.context.add(request.channelId, {
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      userId: request.userId,
      ...(request.messageId ? { messageId: request.messageId } : {}),
    });
    this.context.add(request.channelId, {
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

    return { ...result, content };
  }
}

function clearTypingTimer(timer: NodeJS.Timeout | undefined): void {
  if (timer) {
    clearInterval(timer);
  }
}

function withCurrentDateContext(systemPrompt: string): string {
  return `${systemPrompt}\n\nCurrent date: ${currentDateFormatter.format(new Date())} (Asia/Shanghai).`;
}
