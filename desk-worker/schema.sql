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

CREATE TABLE IF NOT EXISTS desk_journal (
  day TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  weather TEXT NOT NULL,
  mood TEXT NOT NULL,
  events TEXT NOT NULL,
  reflection TEXT NOT NULL,
  goal_status TEXT NOT NULL,
  goal TEXT NOT NULL,
  exercise TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS blog_comments (
  id TEXT PRIMARY KEY,
  article TEXT NOT NULL,
  parent_id TEXT REFERENCES blog_comments(id),
  root_id TEXT REFERENCES blog_comments(id),
  nickname TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  website TEXT NOT NULL,
  message TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);

CREATE INDEX IF NOT EXISTS blog_comments_article ON blog_comments (article, root_id);
CREATE INDEX IF NOT EXISTS blog_comments_parent ON blog_comments (parent_id);

CREATE TABLE IF NOT EXISTS blog_comment_likes (
  comment_id TEXT NOT NULL REFERENCES blog_comments(id),
  visitor TEXT NOT NULL,
  PRIMARY KEY (comment_id, visitor)
);
