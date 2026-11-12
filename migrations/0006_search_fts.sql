-- 0006: keyword index. Holds published resources only, so unpublished text is never searchable.
-- An unapproved summary is not indexed. The id column is the join key to resources.
-- allow-destructive: the DELETE statements below only maintain resources_fts, a derived index.
-- Note: D1 export may not support databases that contain virtual tables such as FTS5. Check the
-- current D1 documentation before relying on export; D1 Time Travel is the backup path.

CREATE VIRTUAL TABLE IF NOT EXISTS resources_fts USING fts5(
  id UNINDEXED, title, publisher, summary, why, best_for, editorial_note, tags, format, evidence_type,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS resources_fts_insert AFTER INSERT ON resources WHEN new.status = 'published'
BEGIN
  INSERT INTO resources_fts(id, title, publisher, summary, why, best_for, editorial_note, tags, format, evidence_type)
  VALUES (new.id, new.title, new.publisher, CASE WHEN new.summary_approved = 1 THEN new.summary END,
          new.why, new.best_for, new.editorial_note, new.tags, new.format, new.evidence_type);
END;

CREATE TRIGGER IF NOT EXISTS resources_fts_update
AFTER UPDATE OF title, publisher, summary, summary_approved, why, best_for, editorial_note, tags, format, evidence_type, status ON resources
WHEN old.status = 'published' OR new.status = 'published'
BEGIN
  DELETE FROM resources_fts WHERE id = old.id;
  INSERT INTO resources_fts(id, title, publisher, summary, why, best_for, editorial_note, tags, format, evidence_type)
  SELECT new.id, new.title, new.publisher, CASE WHEN new.summary_approved = 1 THEN new.summary END,
         new.why, new.best_for, new.editorial_note, new.tags, new.format, new.evidence_type
  WHERE new.status = 'published';
END;

CREATE TRIGGER IF NOT EXISTS resources_fts_delete AFTER DELETE ON resources WHEN old.status = 'published'
BEGIN
  DELETE FROM resources_fts WHERE id = old.id;
END;

INSERT INTO resources_fts(id, title, publisher, summary, why, best_for, editorial_note, tags, format, evidence_type)
SELECT id, title, publisher, CASE WHEN summary_approved = 1 THEN summary END,
       why, best_for, editorial_note, tags, format, evidence_type
FROM resources WHERE status = 'published' AND id NOT IN (SELECT id FROM resources_fts);
