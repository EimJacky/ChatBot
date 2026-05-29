import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs, { type Database } from 'sql.js';
import type { ChatMessage } from '../../types/chat.js';
import type { AppLogger } from '../../utils/logger.js';
import type {
  ContextStore,
  MigrationRecord,
  MigrationStore,
  PreferenceStore,
  RateLimitStore,
  StoredRateLimitBucket,
  StorageHealth,
  StorageMonitor,
  TopUsageUser,
  UsageRecord,
  UsageStore,
  UsageSummary,
  UserPreferences,
} from './interfaces.js';

const require = createRequire(import.meta.url);

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS context_messages (
  conversation_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  user_id TEXT,
  message_id TEXT,
  metadata_json TEXT,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_key, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_context_expires_at ON context_messages(expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  scope TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (scope, bucket_key)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_expires_at ON rate_limit_buckets(expires_at);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  thread_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  search_performed INTEGER NOT NULL,
  search_cache_hit INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_created_at ON usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_events(created_at);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  persona TEXT,
  language TEXT,
  updated_at INTEGER NOT NULL
);
`;

export interface SqliteStoresOptions {
  dbPath: string;
  maxDbSizeMb: number;
  logger: AppLogger;
}

export class SqliteStores implements ContextStore, RateLimitStore, UsageStore, PreferenceStore, MigrationStore, StorageMonitor {
  private inTransaction = false;

  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
    private readonly maxDbSizeMb: number,
    private readonly logger: AppLogger,
  ) {}

  static async open(options: SqliteStoresOptions): Promise<SqliteStores> {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });
    const db = existsSync(options.dbPath)
      ? new SQL.Database(readFileSync(options.dbPath))
      : new SQL.Database();
    const store = new SqliteStores(db, options.dbPath, options.maxDbSizeMb, options.logger);
    store.configure();
    store.runMigrations();
    store.integrityCheck();
    store.persist();
    return store;
  }

  getConversation(conversationKey: string, now = Date.now()): ChatMessage[] {
    this.deleteExpiredContext(now);
    const rows = this.all(
      'SELECT role, content, timestamp, user_id, message_id, metadata_json FROM context_messages WHERE conversation_key = ? AND expires_at > ? ORDER BY ordinal ASC',
      [conversationKey, now],
    );
    return rows.map(rowToChatMessage);
  }

  batchGetConversations(conversationKeys: string[], now = Date.now()): Map<string, ChatMessage[]> {
    const results = new Map<string, ChatMessage[]>(conversationKeys.map((key) => [key, []]));
    if (conversationKeys.length === 0) {
      return results;
    }
    this.deleteExpiredContext(now);
    const placeholders = conversationKeys.map(() => '?').join(',');
    const rows = this.all(
      `SELECT conversation_key, role, content, timestamp, user_id, message_id, metadata_json FROM context_messages WHERE conversation_key IN (${placeholders}) AND expires_at > ? ORDER BY conversation_key ASC, ordinal ASC`,
      [...conversationKeys, now],
    );
    for (const row of rows) {
      const key = String(row.conversation_key);
      results.set(key, [...(results.get(key) ?? []), rowToChatMessage(row)]);
    }
    return results;
  }

  setConversation(conversationKey: string, messages: ChatMessage[], expiresAt: number): void {
    this.withTransaction(() => {
      this.db.run('DELETE FROM context_messages WHERE conversation_key = ?', [conversationKey]);
      const statement = this.db.prepare(
        'INSERT INTO context_messages (conversation_key, ordinal, role, content, timestamp, user_id, message_id, metadata_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      try {
        messages.forEach((message, index) => {
          statement.run([
            conversationKey,
            index,
            message.role,
            message.content,
            message.timestamp,
            message.userId ?? null,
            message.messageId ?? null,
            message.metadata ? JSON.stringify(message.metadata) : null,
            expiresAt,
          ]);
        });
      } finally {
        statement.free();
      }
    });
  }

  batchSetConversations(entries: Array<{ conversationKey: string; messages: ChatMessage[]; expiresAt: number }>): void {
    this.withTransaction(() => {
      for (const entry of entries) {
        this.setConversation(entry.conversationKey, entry.messages, entry.expiresAt);
      }
    });
  }

  deleteConversation(conversationKey: string): void {
    this.db.run('DELETE FROM context_messages WHERE conversation_key = ?', [conversationKey]);
    this.persist();
  }

  listKeysByPrefix(prefix: string, limit = 100): string[] {
    return this.all(
      'SELECT DISTINCT conversation_key FROM context_messages WHERE conversation_key LIKE ? ORDER BY conversation_key ASC LIMIT ?',
      [`${prefix}%`, limit],
    ).map((row) => String(row.conversation_key));
  }

  countConversations(): number {
    return Number(this.get('SELECT COUNT(DISTINCT conversation_key) AS count FROM context_messages')?.count ?? 0);
  }

  cleanupExpired(now = Date.now()): number {
    return this.deleteExpiredContext(now);
  }

  getBucket(scope: string, key: string, now = Date.now()): StoredRateLimitBucket | undefined {
    const row = this.get(
      'SELECT count, reset_at, expires_at FROM rate_limit_buckets WHERE scope = ? AND bucket_key = ?',
      [scope, key],
    );
    if (!row) {
      return undefined;
    }
    if (Number(row.expires_at) <= now) {
      this.db.run('DELETE FROM rate_limit_buckets WHERE scope = ? AND bucket_key = ?', [scope, key]);
      this.persist();
      return undefined;
    }
    return {
      count: Number(row.count),
      resetAt: Number(row.reset_at),
      expiresAt: Number(row.expires_at),
    };
  }

  setBucket(scope: string, key: string, bucket: StoredRateLimitBucket): void {
    this.withRetry(() => {
      this.db.run(
        'INSERT OR REPLACE INTO rate_limit_buckets (scope, bucket_key, count, reset_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        [scope, key, bucket.count, bucket.resetAt, bucket.expiresAt],
      );
      this.persist();
    });
  }

  deleteExpired(now = Date.now()): number {
    const deleted = this.changes('DELETE FROM rate_limit_buckets WHERE expires_at <= ?', [now]);
    this.persist();
    return deleted;
  }

  countBuckets(scope?: string): number {
    const row = scope
      ? this.get('SELECT COUNT(*) AS count FROM rate_limit_buckets WHERE scope = ?', [scope])
      : this.get('SELECT COUNT(*) AS count FROM rate_limit_buckets');
    return Number(row?.count ?? 0);
  }

  recordUsage(record: UsageRecord): void {
    this.withRetry(() => {
      this.db.run(
        [
          'INSERT INTO usage_events',
          '(id, user_id, conversation_key, guild_id, channel_id, thread_id, model, input_tokens, output_tokens, search_performed, search_cache_hit, elapsed_ms, created_at)',
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join(' '),
        [
          record.id,
          record.userId,
          record.conversationKey,
          record.guildId ?? null,
          record.channelId ?? null,
          record.threadId ?? null,
          record.model,
          record.inputTokens,
          record.outputTokens,
          record.searchPerformed ? 1 : 0,
          record.searchCacheHit ? 1 : 0,
          record.elapsedMs,
          record.createdAt,
        ],
      );
      this.persist();
    });
  }

  summarizeUser(userId: string, since: number): UsageSummary {
    return summaryFromRow(this.get(summarySql('WHERE user_id = ? AND created_at >= ?'), [userId, since]));
  }

  summarizeGlobal(since: number): UsageSummary {
    return summaryFromRow(this.get(summarySql('WHERE created_at >= ?'), [since]));
  }

  topUsers(since: number, limit: number): TopUsageUser[] {
    return this.all(
      [
        'SELECT user_id, COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens',
        'FROM usage_events WHERE created_at >= ? GROUP BY user_id ORDER BY requests DESC LIMIT ?',
      ].join(' '),
      [since, limit],
    ).map((row) => ({
      userId: String(row.user_id),
      requests: Number(row.requests),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
    }));
  }

  cleanupOlderThan(cutoff: number): number {
    const deleted = this.changes('DELETE FROM usage_events WHERE created_at < ?', [cutoff]);
    this.persist();
    return deleted;
  }

  getUserPreferences(userId: string): UserPreferences | undefined {
    const row = this.get('SELECT user_id, persona, language, updated_at FROM user_preferences WHERE user_id = ?', [
      userId,
    ]);
    if (!row) {
      return undefined;
    }
    return {
      userId: String(row.user_id),
      ...(typeof row.persona === 'string' ? { persona: row.persona } : {}),
      ...(typeof row.language === 'string' ? { language: row.language } : {}),
      updatedAt: Number(row.updated_at),
    };
  }

  setUserPreferences(preferences: UserPreferences): void {
    this.db.run(
      'INSERT OR REPLACE INTO user_preferences (user_id, persona, language, updated_at) VALUES (?, ?, ?, ?)',
      [
        preferences.userId,
        preferences.persona ?? null,
        preferences.language ?? null,
        preferences.updatedAt,
      ],
    );
    this.persist();
  }

  clearUserPreferences(userId: string): void {
    this.db.run('DELETE FROM user_preferences WHERE user_id = ?', [userId]);
    this.persist();
  }

  listAppliedMigrations(): MigrationRecord[] {
    return this.all('SELECT version, filename, applied_at FROM schema_migrations ORDER BY version ASC').map((row) => ({
      version: Number(row.version),
      filename: String(row.filename),
      appliedAt: Number(row.applied_at),
    }));
  }

  recordMigration(record: MigrationRecord): void {
    this.db.run('INSERT INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)', [
      record.version,
      record.filename,
      record.appliedAt,
    ]);
  }

  withTransaction<T>(callback: () => T): T {
    if (this.inTransaction) {
      return callback();
    }
    this.inTransaction = true;
    this.db.run('BEGIN');
    try {
      const result = callback();
      this.db.run('COMMIT');
      this.persist();
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  check(): StorageHealth {
    const started = Date.now();
    const degradedReasons: string[] = [];
    const dbSizeBytes = this.getDbSizeBytes();
    if (dbSizeBytes > this.maxDbSizeMb * 1024 * 1024) {
      degradedReasons.push('sqlite-db-size-exceeded');
    }
    try {
      this.get('SELECT 1 AS ok');
      return {
        ok: true,
        driver: 'sqlite',
        elapsedMs: Date.now() - started,
        degradedReasons,
        dbSizeBytes,
      };
    } catch (error) {
      return {
        ok: false,
        driver: 'sqlite',
        elapsedMs: Date.now() - started,
        degradedReasons: [...degradedReasons, error instanceof Error ? error.message : 'sqlite-check-failed'],
        dbSizeBytes,
      };
    }
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  private configure(): void {
    this.db.run('PRAGMA foreign_keys=ON');
    this.db.run('PRAGMA synchronous=NORMAL');
    this.db.run('PRAGMA busy_timeout=5000');
    this.db.run('PRAGMA journal_mode=WAL');
  }

  private runMigrations(): void {
    this.db.run(INITIAL_SCHEMA);
    const migrations = loadMigrationFiles();
    const applied = new Set(this.listAppliedMigrations().map((migration) => migration.filename));
    let expectedVersion = 1;
    for (const migration of migrations) {
      if (migration.version !== expectedVersion) {
        throw new Error(`Migration sequence is not continuous at ${migration.filename}. Expected ${expectedVersion}.`);
      }
      expectedVersion += 1;

      if (migration.required && !applied.has(migration.required)) {
        throw new Error(`Migration ${migration.filename} requires ${migration.required}.`);
      }
      if (applied.has(migration.filename)) {
        continue;
      }
      this.withTransaction(() => {
        this.db.run(migration.sql);
        this.recordMigration({
          version: migration.version,
          filename: migration.filename,
          appliedAt: Date.now(),
        });
      });
      applied.add(migration.filename);
      this.logger.info({ migration: migration.filename }, 'sqlite migration applied');
    }
  }

  private integrityCheck(): void {
    const result = this.get('PRAGMA integrity_check');
    const value = Object.values(result ?? {})[0];
    if (value !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${String(value)}`);
    }
  }

  private deleteExpiredContext(now: number): number {
    const deleted = this.changes('DELETE FROM context_messages WHERE expires_at <= ?', [now]);
    if (deleted > 0) {
      this.persist();
    }
    return deleted;
  }

  private getDbSizeBytes(): number {
    const pageCount = Number(Object.values(this.get('PRAGMA page_count') ?? { page_count: 0 })[0] ?? 0);
    const pageSize = Number(Object.values(this.get('PRAGMA page_size') ?? { page_size: 0 })[0] ?? 0);
    return pageCount * pageSize;
  }

  private persist(): void {
    writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  private withRetry<T>(callback: () => T): T {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return callback();
      } catch (error) {
        lastError = error;
        if (!isBusyError(error) || attempt === 3) {
          throw error;
        }
        const waitUntil = Date.now() + attempt * 25;
        while (Date.now() < waitUntil) {
          // sql.js is synchronous; this tiny spin only runs for SQLITE_BUSY compatibility.
        }
      }
    }
    throw lastError;
  }

  private all(sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: Array<Record<string, unknown>> = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  private get(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
    return this.all(sql, params)[0];
  }

  private changes(sql: string, params: unknown[] = []): number {
    this.db.run(sql, params);
    const row = this.get('SELECT changes() AS changes');
    return Number(row?.changes ?? 0);
  }
}

export class MemoryStorageMonitor implements StorageMonitor {
  check(): StorageHealth {
    return {
      ok: true,
      driver: 'memory',
      elapsedMs: 0,
      degradedReasons: [],
    };
  }
}

function rowToChatMessage(row: Record<string, unknown>): ChatMessage {
  const metadataJson = typeof row.metadata_json === 'string' ? row.metadata_json : undefined;
  return {
    role: row.role as ChatMessage['role'],
    content: String(row.content),
    timestamp: Number(row.timestamp),
    ...(typeof row.user_id === 'string' ? { userId: row.user_id } : {}),
    ...(typeof row.message_id === 'string' ? { messageId: row.message_id } : {}),
    ...(metadataJson ? { metadata: JSON.parse(metadataJson) as Record<string, unknown> } : {}),
  };
}

function summarySql(whereClause: string): string {
  return [
    'SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens,',
    'COALESCE(SUM(search_performed), 0) AS search_requests, COALESCE(AVG(elapsed_ms), 0) AS average_elapsed_ms',
    `FROM usage_events ${whereClause}`,
  ].join(' ');
}

function summaryFromRow(row: Record<string, unknown> | undefined): UsageSummary {
  return {
    requests: Number(row?.requests ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    searchRequests: Number(row?.search_requests ?? 0),
    averageElapsedMs: Math.round(Number(row?.average_elapsed_ms ?? 0)),
  };
}

interface MigrationFile {
  version: number;
  filename: string;
  sql: string;
  required?: string;
}

function loadMigrationFiles(): MigrationFile[] {
  const dirs = [
    join(process.cwd(), 'src', 'db', 'migrations'),
    join(process.cwd(), 'dist', 'src', 'db', 'migrations'),
  ];
  const dir = dirs.find((candidate) => existsSync(candidate));
  if (!dir) {
    return [{ version: 1, filename: '0001_initial_schema.sql', sql: INITIAL_SCHEMA }];
  }

  return readdirSync(dir)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort()
    .map((filename) => {
      const path = join(dir, filename);
      const sql = readFileSync(path, 'utf8');
      const version = Number(filename.slice(0, filename.indexOf('_')));
      const required = /^--\s*require:\s*(\S+)/m.exec(sql)?.[1];
      statSync(path);
      return {
        version,
        filename,
        sql,
        ...(required ? { required } : {}),
      };
    });
}

function isBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_(BUSY|LOCKED)/i.test(message);
}
