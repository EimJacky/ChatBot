import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { resolveConversationIdentity } from '../src/services/conversation/conversationKey.js';
import { ConversationCleaner } from '../src/services/maintenance/ConversationCleaner.js';
import { MemoryContextStore, MemoryRateLimitStore, MemoryUsageStore } from '../src/services/storage/MemoryStores.js';
import { SqliteStores } from '../src/services/storage/SqliteStores.js';
import { ContextManager } from '../src/services/context/ContextManager.js';
import { Tokenizer } from '../src/services/context/Tokenizer.js';
import { loadEnv } from '../src/config/env.js';
import type { AppLogger } from '../src/utils/logger.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as AppLogger;

describe('Phase 2 storage and conversation behavior', () => {
  it('persists context, rate limits, and usage in SQLite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echomate-sqlite-'));
    const dbPath = join(dir, 'echomate.sqlite');

    try {
      const first = await SqliteStores.open({ dbPath, maxDbSizeMb: 512, logger });
      first.setConversation('channel:c1', [{
        role: 'user',
        content: 'hello',
        timestamp: 1,
        userId: 'u1',
        messageId: 'm1',
        metadata: { mood: 'ok' },
      }], Date.now() + 60_000);
      first.batchSetConversations([
        { conversationKey: 'channel:c2', messages: [{ role: 'assistant', content: 'batch', timestamp: 2 }], expiresAt: Date.now() + 60_000 },
      ]);
      first.setBucket('scope', 'key', { count: 2, resetAt: Date.now() + 10_000, expiresAt: Date.now() + 20_000 });
      first.setBucket('scope', 'expired', { count: 1, resetAt: Date.now() - 1, expiresAt: Date.now() - 1 });
      first.setUserPreferences({
        userId: 'u1',
        persona: 'friendly',
        language: 'English',
        updatedAt: Date.now(),
      });
      first.recordUsage({
        id: 'usage-1',
        userId: 'u1',
        conversationKey: 'channel:c1',
        channelId: 'c1',
        model: 'model',
        inputTokens: 10,
        outputTokens: 5,
        searchPerformed: true,
        searchCacheHit: false,
        elapsedMs: 100,
        createdAt: Date.now(),
      });
      first.close();

      const second = await SqliteStores.open({ dbPath, maxDbSizeMb: 512, logger });
      expect(second.getConversation('channel:c1').map((message) => message.content)).toEqual(['hello']);
      expect(second.getConversation('channel:c1')[0]?.metadata).toEqual({ mood: 'ok' });
      expect(second.batchGetConversations([]).size).toBe(0);
      expect(second.batchGetConversations(['channel:c1', 'channel:c2']).get('channel:c2')?.[0]?.content).toBe('batch');
      expect(second.listKeysByPrefix('channel:')).toContain('channel:c1');
      expect(second.countConversations()).toBeGreaterThanOrEqual(2);
      expect(second.getBucket('scope', 'key')?.count).toBe(2);
      expect(second.getUserPreferences('u1')).toMatchObject({
        persona: 'friendly',
        language: 'English',
      });
      second.clearUserPreferences('u1');
      expect(second.getUserPreferences('u1')).toBeUndefined();
      expect(second.getBucket('scope', 'expired')).toBeUndefined();
      expect(second.countBuckets()).toBe(1);
      expect(second.countBuckets('scope')).toBe(1);
      expect(second.summarizeUser('u1', Date.now() - 1_000)).toMatchObject({
        requests: 1,
        inputTokens: 10,
        outputTokens: 5,
        searchRequests: 1,
      });
      expect(second.summarizeGlobal(Date.now() - 1_000).requests).toBe(1);
      expect(second.topUsers(Date.now() - 1_000, 1)).toEqual([{
        userId: 'u1',
        requests: 1,
        inputTokens: 10,
        outputTokens: 5,
      }]);
      expect(second.cleanupOlderThan(Date.now() + 1)).toBe(1);
      expect(second.check()).toMatchObject({ ok: true, driver: 'sqlite' });
      second.deleteConversation('channel:c2');
      expect(second.getConversation('channel:c2')).toEqual([]);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back SQLite transactions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echomate-sqlite-'));
    const dbPath = join(dir, 'echomate.sqlite');

    try {
      const store = await SqliteStores.open({ dbPath, maxDbSizeMb: 512, logger });
      expect(() =>
        store.withTransaction(() => {
          store.setConversation('channel:c1', [{ role: 'user', content: 'nope', timestamp: 1 }], Date.now() + 60_000);
          throw new Error('rollback');
        }),
      ).toThrow(/rollback/);
      expect(store.getConversation('channel:c1')).toEqual([]);
      store.withTransaction(() => {
        store.withTransaction(() => {
          store.setConversation('channel:c2', [{ role: 'user', content: 'nested', timestamp: 1 }], Date.now() + 60_000);
        });
      });
      expect(store.getConversation('channel:c2')[0]?.content).toBe('nested');
      const degraded = await SqliteStores.open({ dbPath: join(dir, 'tiny.sqlite'), maxDbSizeMb: 1, logger });
      degraded.setConversation('channel:large', [{ role: 'user', content: 'x'.repeat(2_000_000), timestamp: 1 }], Date.now() + 60_000);
      expect(degraded.check().degradedReasons).toContain('sqlite-db-size-exceeded');
      degraded.close();
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves thread, channel, and DM conversation keys', () => {
    expect(resolveConversationIdentity({
      channelId: 'thread-id',
      userId: 'user-id',
      guildId: 'guild-id',
      channel: { id: 'thread-id', isThread: () => true },
    })).toEqual({ conversationKey: 'thread:thread-id', threadId: 'thread-id' });

    expect(resolveConversationIdentity({
      channelId: 'channel-id',
      userId: 'user-id',
      guildId: 'guild-id',
    })).toEqual({ conversationKey: 'channel:channel-id' });

    expect(resolveConversationIdentity({
      channelId: 'dm-channel',
      userId: 'user-id',
      guildId: null,
    })).toEqual({ conversationKey: 'dm:user-id' });
  });

  it('cleaner removes expired data without overlapping runs', async () => {
    const env = loadEnv({
      DISCORD_TOKEN: 'discord-token',
      DISCORD_CLIENT_ID: 'client-id',
      AI_API_KEY: 'ai-key',
      CONTEXT_TTL_HOURS: '1',
      CONVERSATION_CLEANUP_INTERVAL_MS: '1000',
    });
    const contextStore = new MemoryContextStore();
    const rateLimitStore = new MemoryRateLimitStore();
    const usageStore = new MemoryUsageStore();
    const context = new ContextManager(new Tokenizer(), {
      maxContextMessages: 10,
      contextWindowTokens: 1_000,
      contextTtlHours: 1,
      reserveOutputTokens: 100,
    }, contextStore);
    const now = Date.now();
    contextStore.setConversation('channel:expired', [{ role: 'user', content: 'old', timestamp: now }], now - 1);
    rateLimitStore.setBucket('scope', 'key', { count: 1, resetAt: now - 1, expiresAt: now - 1 });
    usageStore.recordUsage({
      id: 'usage-old',
      userId: 'u1',
      conversationKey: 'channel:c1',
      channelId: 'c1',
      model: 'model',
      inputTokens: 1,
      outputTokens: 1,
      searchPerformed: false,
      searchCacheHit: false,
      elapsedMs: 1,
      createdAt: now - 91 * 24 * 60 * 60 * 1_000,
    });
    const cleaner = new ConversationCleaner(env, logger, context, rateLimitStore, usageStore, {
      check: () => ({ ok: true, driver: 'memory', elapsedMs: 0, degradedReasons: [] }),
    });

    await cleaner.runOnce();

    expect(contextStore.getConversation('channel:expired')).toEqual([]);
    expect(rateLimitStore.countBuckets()).toBe(0);
    expect(usageStore.summarizeGlobal(0).requests).toBe(0);
    cleaner.start();
    cleaner.start();
    cleaner.stop();
  });
});
