import type { ChatMessage } from '../../types/chat.js';
import { MemoryContextStore } from '../storage/MemoryStores.js';
import type { ContextStore } from '../storage/interfaces.js';
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
  private readonly store: ContextStore;

  constructor(
    private readonly tokenizer: Tokenizer,
    private readonly options: ContextManagerOptions,
    store?: ContextStore,
  ) {
    this.store = store ?? new MemoryContextStore();
  }

  get(conversationKey: string): ChatMessage[] {
    return this.store.getConversation(conversationKey);
  }

  add(conversationKey: string, message: ChatMessage): ChatMessage[] {
    const next = [...this.get(conversationKey), message];
    const trimmed = this.trim(next);
    this.store.setConversation(conversationKey, trimmed, this.expiresAt());
    return trimmed;
  }

  reset(conversationKey: string): void {
    this.store.deleteConversation(conversationKey);
  }

  compress(messages: ChatMessage[], keepLast = this.options.maxContextMessages): ChatMessage[] {
    return messages.slice(-keepLast);
  }

  getStats(channelId?: string): ContextStats {
    const messages = channelId ? this.get(channelId) : [];

    return {
      activeChannels: this.store.countConversations(),
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

  cleanupExpired(now = Date.now()): number {
    return this.store.cleanupExpired(now);
  }

  private expiresAt(): number {
    return Date.now() + this.options.contextTtlHours * 60 * 60 * 1_000;
  }
}
