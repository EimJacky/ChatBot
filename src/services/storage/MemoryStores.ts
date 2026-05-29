import { LRUCache } from 'lru-cache';
import type { ChatMessage } from '../../types/chat.js';
import type {
  ContextStore,
  PreferenceStore,
  RateLimitStore,
  StoredRateLimitBucket,
  TopUsageUser,
  UsageRecord,
  UsageStore,
  UsageSummary,
  UserPreferences,
} from './interfaces.js';

interface ContextEntry {
  messages: ChatMessage[];
  expiresAt: number;
}

const emptySummary = (): UsageSummary => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  searchRequests: 0,
  averageElapsedMs: 0,
});

export class MemoryContextStore implements ContextStore {
  private readonly cache = new LRUCache<string, ContextEntry>({
    max: 10_000,
    ttlAutopurge: true,
  });

  getConversation(conversationKey: string, now = Date.now()): ChatMessage[] {
    const entry = this.cache.get(conversationKey);
    if (!entry) {
      return [];
    }
    if (entry.expiresAt <= now) {
      this.cache.delete(conversationKey);
      return [];
    }
    return structuredClone(entry.messages);
  }

  batchGetConversations(conversationKeys: string[], now = Date.now()): Map<string, ChatMessage[]> {
    return new Map(conversationKeys.map((key) => [key, this.getConversation(key, now)]));
  }

  setConversation(conversationKey: string, messages: ChatMessage[], expiresAt: number): void {
    this.cache.set(
      conversationKey,
      { messages: structuredClone(messages), expiresAt },
      { ttl: Math.max(1, expiresAt - Date.now()) },
    );
  }

  batchSetConversations(entries: Array<{ conversationKey: string; messages: ChatMessage[]; expiresAt: number }>): void {
    for (const entry of entries) {
      this.setConversation(entry.conversationKey, entry.messages, entry.expiresAt);
    }
  }

  deleteConversation(conversationKey: string): void {
    this.cache.delete(conversationKey);
  }

  listKeysByPrefix(prefix: string, limit = 100): string[] {
    return Array.from(this.cache.keys()).filter((key) => key.startsWith(prefix)).slice(0, limit);
  }

  countConversations(): number {
    this.cache.purgeStale();
    return this.cache.size;
  }

  cleanupExpired(now = Date.now()): number {
    let deleted = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  withTransaction<T>(callback: () => T): T {
    return callback();
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new LRUCache<string, StoredRateLimitBucket>({
    max: 100_000,
    ttlAutopurge: true,
  });

  getBucket(scope: string, key: string, now = Date.now()): StoredRateLimitBucket | undefined {
    const bucketKey = this.bucketKey(scope, key);
    const bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      return undefined;
    }
    if (bucket.expiresAt <= now) {
      this.buckets.delete(bucketKey);
      return undefined;
    }
    return { ...bucket };
  }

  setBucket(scope: string, key: string, bucket: StoredRateLimitBucket): void {
    this.buckets.set(this.bucketKey(scope, key), { ...bucket }, { ttl: Math.max(1, bucket.expiresAt - Date.now()) });
  }

  deleteExpired(now = Date.now()): number {
    let deleted = 0;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.expiresAt <= now) {
        this.buckets.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  countBuckets(scope?: string): number {
    this.buckets.purgeStale();
    if (!scope) {
      return this.buckets.size;
    }
    return Array.from(this.buckets.keys()).filter((key) => key.startsWith(`${scope}:`)).length;
  }

  withTransaction<T>(callback: () => T): T {
    return callback();
  }

  private bucketKey(scope: string, key: string): string {
    return `${scope}:${key}`;
  }
}

export class MemoryUsageStore implements UsageStore {
  private readonly records: UsageRecord[] = [];

  recordUsage(record: UsageRecord): void {
    this.records.push({ ...record });
  }

  summarizeUser(userId: string, since: number): UsageSummary {
    return summarize(this.records.filter((record) => record.userId === userId && record.createdAt >= since));
  }

  summarizeGlobal(since: number): UsageSummary {
    return summarize(this.records.filter((record) => record.createdAt >= since));
  }

  topUsers(since: number, limit: number): TopUsageUser[] {
    const totals = new Map<string, TopUsageUser>();
    for (const record of this.records) {
      if (record.createdAt < since) {
        continue;
      }
      const total = totals.get(record.userId) ?? {
        userId: record.userId,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      total.requests += 1;
      total.inputTokens += record.inputTokens;
      total.outputTokens += record.outputTokens;
      totals.set(record.userId, total);
    }
    return Array.from(totals.values()).sort((a, b) => b.requests - a.requests).slice(0, limit);
  }

  cleanupOlderThan(cutoff: number): number {
    const before = this.records.length;
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if ((this.records[index]?.createdAt ?? 0) < cutoff) {
        this.records.splice(index, 1);
      }
    }
    return before - this.records.length;
  }

  withTransaction<T>(callback: () => T): T {
    return callback();
  }
}

export class MemoryPreferenceStore implements PreferenceStore {
  private readonly preferences = new Map<string, UserPreferences>();

  getUserPreferences(userId: string): UserPreferences | undefined {
    const preferences = this.preferences.get(userId);
    return preferences ? { ...preferences } : undefined;
  }

  setUserPreferences(preferences: UserPreferences): void {
    this.preferences.set(preferences.userId, { ...preferences });
  }

  clearUserPreferences(userId: string): void {
    this.preferences.delete(userId);
  }

  withTransaction<T>(callback: () => T): T {
    return callback();
  }
}

function summarize(records: UsageRecord[]): UsageSummary {
  if (records.length === 0) {
    return emptySummary();
  }
  const totalElapsed = records.reduce((sum, record) => sum + record.elapsedMs, 0);
  return {
    requests: records.length,
    inputTokens: records.reduce((sum, record) => sum + record.inputTokens, 0),
    outputTokens: records.reduce((sum, record) => sum + record.outputTokens, 0),
    searchRequests: records.filter((record) => record.searchPerformed).length,
    averageElapsedMs: Math.round(totalElapsed / records.length),
  };
}
