import type { InteractionEditReplyOptions } from 'discord.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: number;
  userId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatRequest {
  traceId: string;
  conversationKey?: string;
  channelId: string;
  userId: string;
  prompt: string;
  guildId?: string;
  threadId?: string;
  messageId?: string;
}

export interface ChatResult {
  content: string;
  model: string;
  estimatedPromptTokens: number;
  presentation?: InteractionEditReplyOptions;
}

export interface StreamCallbacks {
  onToken?: (token: string) => Promise<void> | void;
  onSearchStart?: () => Promise<void> | void;
  onSearchEnd?: () => Promise<void> | void;
  signal?: AbortSignal;
}
