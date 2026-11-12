-- 0002: catalog fields on resources. Additive only: no column is dropped or rewritten in place.
-- Legacy single-value columns (audience, collection_name) are kept and continue to hold the
-- primary value; the JSON array columns below are the full set used for filtering.
-- Values are JSON text: audiences/collections/grade_bands/subjects are arrays of strings,
-- tags holds topic tags.

ALTER TABLE resources ADD COLUMN canonical_url TEXT;
ALTER TABLE resources ADD COLUMN dup_key TEXT;
ALTER TABLE resources ADD COLUMN doi TEXT;
ALTER TABLE resources ADD COLUMN author TEXT;
ALTER TABLE resources ADD COLUMN language TEXT;
ALTER TABLE resources ADD COLUMN reading_minutes INTEGER;
ALTER TABLE resources ADD COLUMN evidence_type TEXT;
ALTER TABLE resources ADD COLUMN audiences TEXT NOT NULL DEFAULT '[]';
ALTER TABLE resources ADD COLUMN collections TEXT NOT NULL DEFAULT '[]';
ALTER TABLE resources ADD COLUMN grade_bands TEXT NOT NULL DEFAULT '[]';
ALTER TABLE resources ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]';
ALTER TABLE resources ADD COLUMN description TEXT;
ALTER TABLE resources ADD COLUMN editorial_note TEXT;
ALTER TABLE resources ADD COLUMN summary_approved INTEGER NOT NULL DEFAULT 0 CHECK (summary_approved IN (0,1));
ALTER TABLE resources ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','checked','verified'));
ALTER TABLE resources ADD COLUMN reviewed_at TEXT;
ALTER TABLE resources ADD COLUMN reviewed_by TEXT;
ALTER TABLE resources ADD COLUMN added_at TEXT;
ALTER TABLE resources ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1));
ALTER TABLE resources ADD COLUMN editorial_priority INTEGER NOT NULL DEFAULT 0 CHECK (editorial_priority BETWEEN 0 AND 2);
ALTER TABLE resources ADD COLUMN source_provenance TEXT;
ALTER TABLE resources ADD COLUMN source_item_id TEXT;
ALTER TABLE resources ADD COLUMN duplicate_of TEXT;
ALTER TABLE resources ADD COLUMN duplicate_reason TEXT;
ALTER TABLE resources ADD COLUMN duplicate_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_dismissed IN (0,1));
ALTER TABLE resources ADD COLUMN rejected_reason TEXT;
ALTER TABLE resources ADD COLUMN embedding_version TEXT;
ALTER TABLE resources ADD COLUMN embedding_hash TEXT;
ALTER TABLE resources ADD COLUMN last_link_check TEXT;
ALTER TABLE resources ADD COLUMN link_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (link_status IN ('unchecked','ok','redirected','broken','blocked','error'));
ALTER TABLE resources ADD COLUMN link_http_status INTEGER;

-- Timestamps written by 0001 defaults use "YYYY-MM-DD HH:MM:SS". Normalize to ISO 8601 so
-- text ordering is consistent with timestamps written by the Worker.
UPDATE resources SET discovered_at = replace(discovered_at, ' ', 'T') || 'Z' WHERE discovered_at NOT LIKE '%T%';
UPDATE resources SET created_at = replace(created_at, ' ', 'T') || 'Z' WHERE created_at NOT LIKE '%T%';
UPDATE resources SET updated_at = replace(updated_at, ' ', 'T') || 'Z' WHERE updated_at NOT LIKE '%T%';

-- Backfill the array columns from the legacy single-value columns.
UPDATE resources SET audiences = json_array(audience)
  WHERE audiences = '[]' AND audience IN ('Everyone','Teachers','Administrators','Families','Students');
UPDATE resources SET collections = json_array(CASE collection_name
    WHEN 'Start here' THEN 'start-here'
    WHEN 'Learning & thinking' THEN 'learning-thinking'
    WHEN 'Classroom' THEN 'inside-classroom'
    WHEN 'Families' THEN 'for-families'
    WHEN 'School decisions' THEN 'school-district-leadership'
    WHEN 'Questions & risks' THEN 'questions-concerns'
    WHEN 'Student views' THEN 'student-perspectives'
    WHEN 'Research' THEN 'research-evidence' END)
  WHERE collections = '[]' AND collection_name IN
    ('Start here','Learning & thinking','Classroom','Families','School decisions','Questions & risks','Student views','Research');

-- Date added to Signal: when a resource became public. Rows already published by the 0001 seed
-- were added at their recorded discovery time.
UPDATE resources SET added_at = discovered_at WHERE status = 'published' AND added_at IS NULL;

-- 0001 stored an editor's free-text note in "verification". Only the explicit
-- "Publisher page opened" note is promoted to a status; everything else stays unverified.
UPDATE resources SET verification_status = 'checked' WHERE verification = 'Publisher page opened';

CREATE UNIQUE INDEX IF NOT EXISTS resources_canonical_url ON resources(canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS resources_dup_key ON resources(dup_key) WHERE dup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS resources_doi ON resources(doi) WHERE doi IS NOT NULL;
CREATE INDEX IF NOT EXISTS resources_added ON resources(status, added_at);
CREATE INDEX IF NOT EXISTS resources_featured ON resources(status, featured);
CREATE INDEX IF NOT EXISTS resources_link_check ON resources(status, last_link_check);
CREATE INDEX IF NOT EXISTS resources_source ON resources(source_id, status);
CREATE INDEX IF NOT EXISTS resources_embedding ON resources(status, embedding_version);
