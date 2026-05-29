CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  persona TEXT,
  language TEXT,
  updated_at INTEGER NOT NULL
);
