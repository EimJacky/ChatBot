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
