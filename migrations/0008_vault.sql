-- 0008: encrypted saves without accounts. The browser encrypts a visitor's saved resources and
-- notes before sending them; the server stores opaque ciphertext under a random id and only
-- checks a bearer secret derived from the same key (stored here as a SHA-256 hash). It cannot
-- read what anyone saved, or link two blobs to each other. Additive only.
CREATE TABLE IF NOT EXISTS vault_blobs (
  id TEXT PRIMARY KEY,            -- 64 hex characters, derived from the visitor's key
  token_hash TEXT NOT NULL,       -- hex SHA-256 of the bearer secret
  data TEXT NOT NULL,             -- base64url: 12-byte IV followed by AES-GCM ciphertext
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
