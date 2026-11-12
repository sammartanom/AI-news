-- 0004: roles, per-user reading state and notes, audit log.

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','editor','admin'));
ALTER TABLE boards ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1));
CREATE UNIQUE INDEX IF NOT EXISTS boards_one_default ON boards(owner_id) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS board_members_user ON board_members(user_id);
CREATE INDEX IF NOT EXISTS board_items_resource ON board_items(resource_id);

-- Private, per-user state. Never exposed to other users and never indexed.
-- board_items.note from 0001 is not used: notes belong to a user, not a list.
CREATE TABLE IF NOT EXISTS user_resource_state (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  read_at TEXT,
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, resource_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log(entity, entity_id);
