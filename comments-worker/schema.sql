CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  article TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  author_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS comments_by_article ON comments (article, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS comments_by_author ON comments (author_key, created_at DESC);
