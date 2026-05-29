import type { ChatMessage } from '../../types/chat.js';

export interface StoredRateLimitBucket {
  count: number;
  resetAt: number;
  expiresAt: number;
}

export interface ContextStore {
  getConversation(conversationKey: string, now?: number): ChatMessage[];
  batchGetConversations(conversationKeys: string[], now?: number): Map<string, ChatMessage[]>;
  setConversation(conversationKey: string, messages: ChatMessage[], expiresAt: number): void;
  batchSetConversations(entries: Array<{ conversationKey: string; messages: ChatMessage[]; expiresAt: number }>): void;
  deleteConversation(conversationKey: string): void;
  listKeysByPrefix(prefix: string, limit?: number): string[];
  countConversations(): number;
  cleanupExpired(now?: number): number;
  withTransaction<T>(callback: () => T): T;
  close?(): void;
}

export interface RateLimitStore {
  getBucket(scope: string, key: string, now?: number): StoredRateLimitBucket | undefined;
  setBucket(scope: string, key: string, bucket: StoredRateLimitBucket): void;
  deleteExpired(now?: number): number;
  countBuckets(scope?: string): number;
  withTransaction<T>(callback: () => T): T;
  close?(): void;
}

export interface UsageRecord {
  id: string;
  userId: string;
  conversationKey: string;
  guildId?: string;
  channelId?: string;
  threadId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  searchPerformed: boolean;
  searchCacheHit: boolean;
  elapsedMs: number;
  createdAt: number;
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  searchRequests: number;
  averageElapsedMs: number;
}

export interface TopUsageUser {
  userId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStore {
  recordUsage(record: UsageRecord): void;
  summarizeUser(userId: string, since: number): UsageSummary;
  summarizeGlobal(since: number): UsageSummary;
  topUsers(since: number, limit: number): TopUsageUser[];
  cleanupOlderThan(cutoff: number): number;
  withTransaction<T>(callback: () => T): T;
  close?(): void;
}

export interface UserPreferences {
  userId: string;
  persona?: string;
  language?: string;
  updatedAt: number;
}

export interface PreferenceStore {
  getUserPreferences(userId: string): UserPreferences | undefined;
  setUserPreferences(preferences: UserPreferences): void;
  clearUserPreferences(userId: string): void;
  withTransaction<T>(callback: () => T): T;
  close?(): void;
}

export interface MigrationRecord {
  version: number;
  filename: string;
  appliedAt: number;
}

export interface MigrationStore {
  listAppliedMigrations(): MigrationRecord[];
  recordMigration(record: MigrationRecord): void;
  withTransaction<T>(callback: () => T): T;
  close?(): void;
}

export interface StorageHealth {
  ok: boolean;
  driver: string;
  elapsedMs: number;
  degradedReasons: string[];
  dbSizeBytes?: number;
}

export interface StorageMonitor {
  check(): StorageHealth;
}
