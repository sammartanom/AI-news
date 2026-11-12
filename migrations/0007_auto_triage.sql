-- 0007: automated triage. Resources found by a trusted source can be published automatically as
-- "indexed" (public, labelled as not reviewed by an editor). A human still decides what is
-- curated and featured. Additive only.
--
-- curation level, computed:
--   featured  = published, featured = 1
--   curated   = published, auto_published = 0   (an editor published it, or it was seeded as curated)
--   indexed   = published, auto_published = 1   (published by the triage job)

ALTER TABLE resources ADD COLUMN auto_published INTEGER NOT NULL DEFAULT 0 CHECK (auto_published IN (0,1));
ALTER TABLE resources ADD COLUMN auto_published_at TEXT;
ALTER TABLE resources ADD COLUMN auto_assessment TEXT;   -- JSON: how and why triage decided
ALTER TABLE resources ADD COLUMN auto_hold TEXT;         -- set when triage pulled it back; triage skips it
ALTER TABLE resources ADD COLUMN spot_checked_at TEXT;   -- an editor looked at this automatic item and left it

ALTER TABLE sources ADD COLUMN auto_publish INTEGER NOT NULL DEFAULT 0 CHECK (auto_publish IN (0,1));

CREATE INDEX IF NOT EXISTS resources_auto ON resources(status, auto_published);
CREATE INDEX IF NOT EXISTS resources_triage ON resources(status, source_id, auto_assessment);
