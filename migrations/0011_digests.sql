-- 0011: weekly digests of newly added resources (generated text plus the items it cites).
CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mode TEXT NOT NULL,            -- 'model' or 'extractive'
  model TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL          -- JSON: headline, overview, themes[{title, summary, items[]}], notable[]
);
CREATE INDEX IF NOT EXISTS digests_created ON digests(created_at);
