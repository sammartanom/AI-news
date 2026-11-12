PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS resources (
 id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, publisher TEXT NOT NULL,
 format TEXT NOT NULL DEFAULT 'Article', audience TEXT NOT NULL DEFAULT 'Everyone',
 collection_name TEXT NOT NULL DEFAULT 'Other', why TEXT, best_for TEXT, tags TEXT NOT NULL DEFAULT '[]',
 summary TEXT, summary_generated INTEGER NOT NULL DEFAULT 0 CHECK(summary_generated IN (0,1)),
 published_at TEXT, discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 status TEXT NOT NULL DEFAULT 'indexed' CHECK(status IN ('indexed','published','rejected')),
 source_id TEXT, verification TEXT, embedding_model TEXT, embedded_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS resources_status_date ON resources(status,published_at);
CREATE INDEX IF NOT EXISTS resources_collection ON resources(collection_name,status);
CREATE TABLE IF NOT EXISTS sources (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, feed_url TEXT NOT NULL UNIQUE, publisher TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 etag TEXT, modified TEXT, last_checked TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS boards (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
 share_token TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS boards_owner ON boards(owner_id);
CREATE TABLE IF NOT EXISTS board_members (
 board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(board_id,user_id)
);
CREATE TABLE IF NOT EXISTS board_items (
 board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
 resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 note TEXT, added_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(board_id,resource_id)
);
CREATE TABLE IF NOT EXISTS ingestion_log (
 id TEXT PRIMARY KEY, source_id TEXT, started_at TEXT NOT NULL, finished_at TEXT,
 status TEXT NOT NULL, discovered_count INTEGER NOT NULL DEFAULT 0, error TEXT
);
