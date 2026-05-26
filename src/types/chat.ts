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
  channelId: string;
  userId: string;
  prompt: string;
  messageId?: string;
}

export interface ChatResult {
  content: string;
  model: string;
  estimatedPromptTokens: number;
}

export interface StreamCallbacks {
  onToken?: (token: string) => Promise<void> | void;
  onSearchStart?: () => Promise<void> | void;
  onSearchEnd?: () => Promise<void> | void;
  signal?: AbortSignal;
}
