CREATE TABLE IF NOT EXISTS desk_sessions (
  hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS desk_sessions_expiry ON desk_sessions (expires_at);

CREATE TABLE IF NOT EXISTS desk_entries (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'note')),
  body TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);

CREATE INDEX IF NOT EXISTS desk_entries_by_day ON desk_entries (day, created_at, id) WHERE deleted = 0;
