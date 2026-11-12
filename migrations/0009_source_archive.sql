-- 0009: walking a source's back catalogue. A feed shows only its newest items; sources whose
-- archive can be paged (WordPress and Blogger feeds, Substack's archive listing) are read one
-- page per run until the end. Additive only.
ALTER TABLE sources ADD COLUMN archive_page INTEGER NOT NULL DEFAULT 0;  -- next archive page to read
ALTER TABLE sources ADD COLUMN archive_done_at TEXT;                      -- set when the archive is exhausted
