import { LRUCache } from 'lru-cache';
import type { ChatMessage } from '../../types/chat.js';
import type { Tokenizer } from './Tokenizer.js';

export interface ContextManagerOptions {
  maxContextMessages: number;
  contextWindowTokens: number;
  contextTtlHours: number;
  reserveOutputTokens: number;
}

export interface ContextStats {
  activeChannels: number;
  channelId?: string;
  messages: number;
  estimatedTokens: number;
  maxContextMessages: number;
  contextWindowTokens: number;
}

export class ContextManager {
  private readonly cache: LRUCache<string, ChatMessage[]>;

  constructor(
    private readonly tokenizer: Tokenizer,
    private readonly options: ContextManagerOptions,
  ) {
    this.cache = new LRUCache<string, ChatMessage[]>({
      max: 1_000,
      ttl: options.contextTtlHours * 60 * 60 * 1_000,
      ttlAutopurge: true,
      updateAgeOnGet: true,
    });
  }

  get(channelId: string): ChatMessage[] {
    return [...(this.cache.get(channelId) ?? [])];
  }

  add(channelId: string, message: ChatMessage): ChatMessage[] {
    const next = [...this.get(channelId), message];
    const trimmed = this.trim(next);
    this.cache.set(channelId, trimmed);
    return trimmed;
  }

  reset(channelId: string): void {
    this.cache.delete(channelId);
  }

  compress(messages: ChatMessage[], keepLast = this.options.maxContextMessages): ChatMessage[] {
    return messages.slice(-keepLast);
  }

  getStats(channelId?: string): ContextStats {
    const messages = channelId ? this.get(channelId) : Array.from(this.cache.values()).flat();

    return {
      activeChannels: this.cache.size,
      ...(channelId ? { channelId } : {}),
      messages: messages.length,
      estimatedTokens: this.tokenizer.countMessages(messages),
      maxContextMessages: this.options.maxContextMessages,
      contextWindowTokens: this.options.contextWindowTokens,
    };
  }

  trim(messages: ChatMessage[]): ChatMessage[] {
    const budget = Math.max(0, this.options.contextWindowTokens - this.options.reserveOutputTokens);
    let totalTokens = 0;
    let cutIndex = messages.length;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }

      const messageTokens = this.tokenizer.countText(`${message.role}: ${message.content}`) + 4;
      if (totalTokens + messageTokens > budget) {
        break;
      }

      totalTokens += messageTokens;
      cutIndex = index;
    }

    let trimmed = messages.slice(cutIndex);

    if (trimmed.length > this.options.maxContextMessages) {
      trimmed = trimmed.slice(-this.options.maxContextMessages);
    }

    return trimmed;
  }
}
