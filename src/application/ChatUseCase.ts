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

export class ChatUseCase {
  constructor(
    private readonly env: Env,
    private readonly logger: AppLogger,
    private readonly ai: AIService,
    private readonly context: ContextManager,
    private readonly stream: StreamingMessageHandler,
    private readonly rateLimiters: BotRateLimiters,
    private readonly systemPrompt: string,
  ) {}

  async handleInteraction(interaction: ChatInputCommandInteraction, prompt: string): Promise<void> {
    const traceId = randomUUID();

    try {
      await this.stream.start(interaction);
      const result = await this.run(
        {
          traceId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          prompt,
          messageId: interaction.id,
        },
        {
          onToken: (token: string) => this.stream.append(interaction, token),
        },
      );

      await this.stream.finish(interaction, result.content);
    } catch (error) {
      this.logger.error({ traceId, err: error }, 'chat interaction failed');
      await this.stream.edit(interaction, userFacingError(error));
    }
  }

  async handleMention(message: Message, prompt: string): Promise<void> {
    const traceId = randomUUID();

    try {
      this.rateLimiters.mentionDaily.check(message.guildId ?? message.channelId);
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }
      const sent = await message.reply('Thinking...');
      const result = await this.run({
        traceId,
        channelId: message.channelId,
        userId: message.author.id,
        prompt,
        messageId: message.id,
      });
      await sent.edit(fitDiscordMessage(result.content));
    } catch (error) {
      this.logger.error({ traceId, err: error }, 'mention chat failed');
      await message.reply(fitDiscordMessage(userFacingError(error)));
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
    const result = await this.ai.complete(
      {
        ...request,
        systemPrompt: this.systemPrompt,
        messages: history,
        prompt,
      },
      streamCallbacks,
    );

    this.context.add(request.channelId, {
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      userId: request.userId,
      ...(request.messageId ? { messageId: request.messageId } : {}),
    });
    this.context.add(request.channelId, {
      role: 'assistant',
      content: result.content,
      timestamp: Date.now(),
      metadata: {
        model: result.model,
        estimatedPromptTokens: result.estimatedPromptTokens,
      },
    });

    return result;
  }
}
