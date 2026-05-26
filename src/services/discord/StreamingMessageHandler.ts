import Bottleneck from 'bottleneck';
import type { ChatInputCommandInteraction, InteractionEditReplyOptions, Message } from 'discord.js';
import { fitDiscordMessage } from '../../utils/text.js';

interface EditableReply {
  editReply(options: string | InteractionEditReplyOptions): Promise<Message | unknown>;
}

export class StreamingMessageHandler {
  private buffer = '';
  private lastFlushAt = 0;
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly limiter: Bottleneck,
    private readonly intervalMs = 1_000,
  ) {}

  static createDefault(intervalMs = 1_000) {
    return new StreamingMessageHandler(
      new Bottleneck({
        minTime: 250,
        maxConcurrent: 1,
      }),
      intervalMs,
    );
  }

  async start(interaction: ChatInputCommandInteraction, text = 'Thinking...'): Promise<void> {
    await this.scheduleEdit(interaction, text);
  }

  async append(reply: EditableReply, token: string): Promise<void> {
    this.buffer += token;
    const now = Date.now();

    if (now - this.lastFlushAt >= this.intervalMs) {
      await this.flush(reply);
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.flush(reply);
      }, this.intervalMs - (now - this.lastFlushAt));
      this.flushTimer.unref();
    }
  }

  async finish(reply: EditableReply, finalText: string): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.buffer = finalText;
    await this.flush(reply);
  }

  async edit(reply: EditableReply, text: string): Promise<void> {
    this.buffer = text;
    await this.flush(reply);
  }

  private async flush(reply: EditableReply): Promise<void> {
    this.lastFlushAt = Date.now();
    await this.scheduleEdit(reply, fitDiscordMessage(this.buffer || 'Thinking...'));
  }

  private async scheduleEdit(reply: EditableReply, text: string): Promise<void> {
    await this.limiter.schedule(() => reply.editReply(text));
  }
}
