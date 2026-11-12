// Generated from migrations/ by scripts/build-schema.mjs. Do not edit; run: node scripts/build-schema.mjs
export const MIGRATIONS = [
 {
  "name": "0001_init.sql",
  "statements": [
   "CREATE TABLE IF NOT EXISTS resources (\n id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, publisher TEXT NOT NULL,\n format TEXT NOT NULL DEFAULT 'Article', audience TEXT NOT NULL DEFAULT 'Everyone',\n collection_name TEXT NOT NULL DEFAULT 'Other', why TEXT, best_for TEXT, tags TEXT NOT NULL DEFAULT '[]',\n summary TEXT, summary_generated INTEGER NOT NULL DEFAULT 0 CHECK(summary_generated IN (0,1)),\n published_at TEXT, discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n status TEXT NOT NULL DEFAULT 'indexed' CHECK(status IN ('indexed','published','rejected')),\n source_id TEXT, verification TEXT, embedding_model TEXT, embedded_at TEXT,\n created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n)",
   "CREATE INDEX IF NOT EXISTS resources_status_date ON resources(status,published_at)",
   "CREATE INDEX IF NOT EXISTS resources_collection ON resources(collection_name,status)",
   "CREATE TABLE IF NOT EXISTS sources (\n id TEXT PRIMARY KEY, name TEXT NOT NULL, feed_url TEXT NOT NULL UNIQUE, publisher TEXT NOT NULL,\n enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),\n etag TEXT, modified TEXT, last_checked TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n)",
   "CREATE TABLE IF NOT EXISTS users (\n id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT,\n created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n)",
   "CREATE TABLE IF NOT EXISTS boards (\n id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),\n share_token TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n)",
   "CREATE INDEX IF NOT EXISTS boards_owner ON boards(owner_id)",
   "CREATE TABLE IF NOT EXISTS board_members (\n board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,\n user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n role TEXT NOT NULL CHECK(role IN ('viewer','editor')),\n created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(board_id,user_id)\n)",
   "CREATE TABLE IF NOT EXISTS board_items (\n board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,\n resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,\n note TEXT, added_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n PRIMARY KEY(board_id,resource_id)\n)",
   "CREATE TABLE IF NOT EXISTS ingestion_log (\n id TEXT PRIMARY KEY, source_id TEXT, started_at TEXT NOT NULL, finished_at TEXT,\n status TEXT NOT NULL, discovered_count INTEGER NOT NULL DEFAULT 0, error TEXT\n)"
  ]
 },
 {
  "name": "0002_resources_catalog.sql",
  "statements": [
   "ALTER TABLE resources ADD COLUMN canonical_url TEXT",
   "ALTER TABLE resources ADD COLUMN dup_key TEXT",
   "ALTER TABLE resources ADD COLUMN doi TEXT",
   "ALTER TABLE resources ADD COLUMN author TEXT",
   "ALTER TABLE resources ADD COLUMN language TEXT",
   "ALTER TABLE resources ADD COLUMN reading_minutes INTEGER",
   "ALTER TABLE resources ADD COLUMN evidence_type TEXT",
   "ALTER TABLE resources ADD COLUMN audiences TEXT NOT NULL DEFAULT '[]'",
   "ALTER TABLE resources ADD COLUMN collections TEXT NOT NULL DEFAULT '[]'",
   "ALTER TABLE resources ADD COLUMN grade_bands TEXT NOT NULL DEFAULT '[]'",
   "ALTER TABLE resources ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]'",
   "ALTER TABLE resources ADD COLUMN description TEXT",
   "ALTER TABLE resources ADD COLUMN editorial_note TEXT",
   "ALTER TABLE resources ADD COLUMN summary_approved INTEGER NOT NULL DEFAULT 0 CHECK (summary_approved IN (0,1))",
   "ALTER TABLE resources ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','checked','verified'))",
   "ALTER TABLE resources ADD COLUMN reviewed_at TEXT",
   "ALTER TABLE resources ADD COLUMN reviewed_by TEXT",
   "ALTER TABLE resources ADD COLUMN added_at TEXT",
   "ALTER TABLE resources ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1))",
   "ALTER TABLE resources ADD COLUMN editorial_priority INTEGER NOT NULL DEFAULT 0 CHECK (editorial_priority BETWEEN 0 AND 2)",
   "ALTER TABLE resources ADD COLUMN source_provenance TEXT",
   "ALTER TABLE resources ADD COLUMN source_item_id TEXT",
   "ALTER TABLE resources ADD COLUMN duplicate_of TEXT",
   "ALTER TABLE resources ADD COLUMN duplicate_reason TEXT",
   "ALTER TABLE resources ADD COLUMN duplicate_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_dismissed IN (0,1))",
   "ALTER TABLE resources ADD COLUMN rejected_reason TEXT",
   "ALTER TABLE resources ADD COLUMN embedding_version TEXT",
   "ALTER TABLE resources ADD COLUMN embedding_hash TEXT",
   "ALTER TABLE resources ADD COLUMN last_link_check TEXT",
   "ALTER TABLE resources ADD COLUMN link_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (link_status IN ('unchecked','ok','redirected','broken','blocked','error'))",
   "ALTER TABLE resources ADD COLUMN link_http_status INTEGER",
   "UPDATE resources SET discovered_at = replace(discovered_at, ' ', 'T') || 'Z' WHERE discovered_at NOT LIKE '%T%'",
   "UPDATE resources SET created_at = replace(created_at, ' ', 'T') || 'Z' WHERE created_at NOT LIKE '%T%'",
   "UPDATE resources SET updated_at = replace(updated_at, ' ', 'T') || 'Z' WHERE updated_at NOT LIKE '%T%'",
   "UPDATE resources SET audiences = json_array(audience)\n  WHERE audiences = '[]' AND audience IN ('Everyone','Teachers','Administrators','Families','Students')",
   "UPDATE resources SET collections = json_array(CASE collection_name\n    WHEN 'Start here' THEN 'start-here'\n    WHEN 'Learning & thinking' THEN 'learning-thinking'\n    WHEN 'Classroom' THEN 'inside-classroom'\n    WHEN 'Families' THEN 'for-families'\n    WHEN 'School decisions' THEN 'school-district-leadership'\n    WHEN 'Questions & risks' THEN 'questions-concerns'\n    WHEN 'Student views' THEN 'student-perspectives'\n    WHEN 'Research' THEN 'research-evidence' END)\n  WHERE collections = '[]' AND collection_name IN\n    ('Start here','Learning & thinking','Classroom','Families','School decisions','Questions & risks','Student views','Research')",
   "UPDATE resources SET added_at = discovered_at WHERE status = 'published' AND added_at IS NULL",
   "UPDATE resources SET verification_status = 'checked' WHERE verification = 'Publisher page opened'",
   "CREATE UNIQUE INDEX IF NOT EXISTS resources_canonical_url ON resources(canonical_url) WHERE canonical_url IS NOT NULL",
   "CREATE INDEX IF NOT EXISTS resources_dup_key ON resources(dup_key) WHERE dup_key IS NOT NULL",
   "CREATE INDEX IF NOT EXISTS resources_doi ON resources(doi) WHERE doi IS NOT NULL",
   "CREATE INDEX IF NOT EXISTS resources_added ON resources(status, added_at)",
   "CREATE INDEX IF NOT EXISTS resources_featured ON resources(status, featured)",
   "CREATE INDEX IF NOT EXISTS resources_link_check ON resources(status, last_link_check)",
   "CREATE INDEX IF NOT EXISTS resources_source ON resources(source_id, status)",
   "CREATE INDEX IF NOT EXISTS resources_embedding ON resources(status, embedding_version)"
  ]
 },
 {
  "name": "0003_taxonomy_relations.sql",
  "statements": [
   "CREATE TABLE IF NOT EXISTS collections (\n  slug TEXT PRIMARY KEY,\n  name TEXT NOT NULL UNIQUE,\n  position INTEGER NOT NULL\n)",
   "INSERT OR IGNORE INTO collections(slug, name, position) VALUES\n  ('start-here', 'Start here', 1),\n  ('ai-literacy', 'AI literacy', 2),\n  ('learning-thinking', 'Learning and thinking', 3),\n  ('inside-classroom', 'Inside the classroom', 4),\n  ('assessment-integrity', 'Assessment and academic integrity', 5),\n  ('for-families', 'For families', 6),\n  ('student-perspectives', 'Student perspectives', 7),\n  ('school-district-leadership', 'School and district leadership', 8),\n  ('privacy-security', 'Privacy and security', 9),\n  ('policy-governance', 'Policy and governance', 10),\n  ('professional-learning', 'Professional learning', 11),\n  ('equity-access', 'Equity and access', 12),\n  ('media-literacy', 'Media literacy and misinformation', 13),\n  ('elementary-education', 'Elementary education', 14),\n  ('research-evidence', 'Research and evidence', 15),\n  ('questions-concerns', 'Questions, concerns, and critical perspectives', 16)",
   "CREATE TABLE IF NOT EXISTS topics (\n  slug TEXT PRIMARY KEY,\n  name TEXT NOT NULL UNIQUE,\n  query TEXT NOT NULL,\n  position INTEGER NOT NULL\n)",
   "INSERT OR IGNORE INTO topics(slug, name, query, position) VALUES\n  ('ai-literacy', 'AI literacy', 'AI literacy', 1),\n  ('assessment', 'Assessment', 'assessment and AI', 2),\n  ('academic-integrity', 'Academic integrity', 'academic integrity and AI', 3),\n  ('privacy', 'Privacy', 'student data privacy and AI', 4),\n  ('student-agency', 'Student agency', 'student agency and AI', 5),\n  ('writing', 'Writing', 'AI and student writing', 6),\n  ('ai-detection', 'AI detection', 'AI detection tools', 7),\n  ('ai-tutoring', 'AI tutoring', 'AI tutoring', 8),\n  ('media-literacy', 'Media literacy', 'media literacy and AI', 9),\n  ('professional-learning', 'Professional learning', 'professional learning about AI for educators', 10)",
   "CREATE TABLE IF NOT EXISTS resource_relations (\n  id TEXT PRIMARY KEY,\n  from_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,\n  to_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,\n  relation TEXT NOT NULL CHECK (relation IN ('companion','practical_example','research','policy_context','newer','background','critical_perspective')),\n  note TEXT,\n  created_by TEXT,\n  created_at TEXT NOT NULL,\n  CHECK (from_id <> to_id),\n  UNIQUE (from_id, to_id, relation)\n)",
   "CREATE INDEX IF NOT EXISTS resource_relations_from ON resource_relations(from_id)",
   "CREATE INDEX IF NOT EXISTS resource_relations_to ON resource_relations(to_id)",
   "CREATE TABLE IF NOT EXISTS topic_pins (\n  topic_slug TEXT NOT NULL REFERENCES topics(slug) ON DELETE CASCADE,\n  section TEXT NOT NULL CHECK (section IN ('start','latest','classroom','research','leadership','students','concerns')),\n  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,\n  position INTEGER NOT NULL DEFAULT 0,\n  PRIMARY KEY (topic_slug, section, resource_id)\n)"
  ]
 },
 {
  "name": "0004_accounts_lists.sql",
  "statements": [
   "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','editor','admin'))",
   "ALTER TABLE boards ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1))",
   "CREATE UNIQUE INDEX IF NOT EXISTS boards_one_default ON boards(owner_id) WHERE is_default = 1",
   "CREATE INDEX IF NOT EXISTS board_members_user ON board_members(user_id)",
   "CREATE INDEX IF NOT EXISTS board_items_resource ON board_items(resource_id)",
   "CREATE TABLE IF NOT EXISTS user_resource_state (\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,\n  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),\n  read_at TEXT,\n  note TEXT,\n  updated_at TEXT NOT NULL,\n  PRIMARY KEY (user_id, resource_id)\n)",
   "CREATE TABLE IF NOT EXISTS audit_log (\n  id TEXT PRIMARY KEY,\n  at TEXT NOT NULL,\n  actor TEXT NOT NULL,\n  action TEXT NOT NULL,\n  entity TEXT NOT NULL,\n  entity_id TEXT,\n  detail TEXT\n)",
   "CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at)",
   "CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log(entity, entity_id)"
  ]
 },
 {
  "name": "0005_sources_ingestion.sql",
  "statements": [
   "ALTER TABLE sources ADD COLUMN source_type TEXT NOT NULL DEFAULT 'feed' CHECK (source_type IN ('feed','sitemap','api'))",
   "ALTER TABLE sources ADD COLUMN site_url TEXT",
   "ALTER TABLE sources ADD COLUMN allowed_hosts TEXT NOT NULL DEFAULT '[]'",
   "ALTER TABLE sources ADD COLUMN default_metadata TEXT NOT NULL DEFAULT '{}'",
   "ALTER TABLE sources ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','verified','rejected'))",
   "ALTER TABLE sources ADD COLUMN require_match INTEGER NOT NULL DEFAULT 1 CHECK (require_match IN (0,1))",
   "ALTER TABLE sources ADD COLUMN last_success TEXT",
   "ALTER TABLE sources ADD COLUMN last_error_at TEXT",
   "ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0",
   "ALTER TABLE sources ADD COLUMN notes TEXT",
   "ALTER TABLE sources ADD COLUMN updated_at TEXT",
   "ALTER TABLE ingestion_log ADD COLUMN new_count INTEGER NOT NULL DEFAULT 0",
   "ALTER TABLE ingestion_log ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 0",
   "ALTER TABLE ingestion_log ADD COLUMN flagged_count INTEGER NOT NULL DEFAULT 0",
   "ALTER TABLE ingestion_log ADD COLUMN filtered_count INTEGER NOT NULL DEFAULT 0",
   "ALTER TABLE ingestion_log ADD COLUMN http_status INTEGER",
   "CREATE INDEX IF NOT EXISTS ingestion_log_source ON ingestion_log(source_id, started_at)"
  ]
 },
 {
  "name": "0006_search_fts.sql",
  "statements": [
   "CREATE VIRTUAL TABLE IF NOT EXISTS resources_fts USING fts5(\n  id UNINDEXED, title, publisher, summary, why, best_for, editorial_note, tags, format, evidence_type,\n  tokenize = 'porter unicode61 remove_diacritics 2'\n)",
   "CREATE TRIGGER IF NOT EXISTS resources_fts_insert AFTER INSERT ON resources WHEN new.status = 'published'\nBEGIN\n  INSERT INTO resources_fts(id, title, publisher, summary, why, best_for, editorial_note, tags, format, evidence_type)\n  VALUES (new.id, new.title, new.publisher, CASE WHEN new.summary_approved = 1 THEN new.summary END,\n          new.why, new.best_for, new.editorial_note, new.tags, new.format, new.evidence_type);\nEND",
   "CREATE TRIGGER IF NOT EXISTS resources_fts_update\nAFTER UPDATE OF title, publisher, summary, summary_approved, why, best_for, editorial_note, tags, format, evidence_type, status ON resources\nWHEN old.status = 'published' OR new.status = 'published'\nBEGIN\n  DELETE FROM resources_fts WHERE id = old.id;\n  INSERT INTO resources_fts(id, title, publisher, summary, why, best_for, editorial_note, tags, format, evidence_type)\n  SELECT new.id, new.title, new.publisher, CASE WHEN new.summary_approved = 1 THEN new.summary END,\n         new.why, new.best_for, new.editorial_note, new.tags, new.format, new.evidence_type\n  WHERE new.status = 'published';\nEND",
   "CREATE TRIGGER IF NOT EXISTS resources_fts_delete AFTER DELETE ON resources WHEN old.status = 'published'\nBEGIN\n  DELETE FROM resources_fts WHERE id = old.id;\nEND",
   "INSERT INTO resources_fts(id, title, publisher, summary, why, best_for, editorial_note, tags, format, evidence_type)\nSELECT id, title, publisher, CASE WHEN summary_approved = 1 THEN summary END,\n       why, best_for, editorial_note, tags, format, evidence_type\nFROM resources WHERE status = 'published' AND id NOT IN (SELECT id FROM resources_fts)"
  ]
 },
 {
  "name": "0007_auto_triage.sql",
  "statements": [
   "ALTER TABLE resources ADD COLUMN auto_published INTEGER NOT NULL DEFAULT 0 CHECK (auto_published IN (0,1))",
   "ALTER TABLE resources ADD COLUMN auto_published_at TEXT",
   "ALTER TABLE resources ADD COLUMN auto_assessment TEXT",
   "ALTER TABLE resources ADD COLUMN auto_hold TEXT",
   "ALTER TABLE resources ADD COLUMN spot_checked_at TEXT",
   "ALTER TABLE sources ADD COLUMN auto_publish INTEGER NOT NULL DEFAULT 0 CHECK (auto_publish IN (0,1))",
   "CREATE INDEX IF NOT EXISTS resources_auto ON resources(status, auto_published)",
   "CREATE INDEX IF NOT EXISTS resources_triage ON resources(status, source_id, auto_assessment)"
  ]
 },
 {
  "name": "0008_vault.sql",
  "statements": [
   "CREATE TABLE IF NOT EXISTS vault_blobs (\n  id TEXT PRIMARY KEY,\n  token_hash TEXT NOT NULL,\n  data TEXT NOT NULL,\n  version INTEGER NOT NULL DEFAULT 1,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)"
  ]
 },
 {
  "name": "0009_source_archive.sql",
  "statements": [
   "ALTER TABLE sources ADD COLUMN archive_page INTEGER NOT NULL DEFAULT 0",
   "ALTER TABLE sources ADD COLUMN archive_done_at TEXT"
  ]
 },
 {
  "name": "0010_beyond_education.sql",
  "statements": [
   "INSERT OR IGNORE INTO collections(slug, name, position) VALUES ('ai-beyond-education', 'AI beyond education', 17)"
  ]
 },
 {
  "name": "0011_digests.sql",
  "statements": [
   "CREATE TABLE IF NOT EXISTS digests (\n  id TEXT PRIMARY KEY,\n  period_start TEXT NOT NULL,\n  period_end TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  mode TEXT NOT NULL,\n  model TEXT,\n  item_count INTEGER NOT NULL DEFAULT 0,\n  content TEXT NOT NULL\n)",
   "CREATE INDEX IF NOT EXISTS digests_created ON digests(created_at)"
  ]
 },
 {
  "name": "0012_briefs.sql",
  "statements": [
   "ALTER TABLE resources ADD COLUMN ai_brief TEXT",
   "ALTER TABLE resources ADD COLUMN ai_brief_basis TEXT",
   "ALTER TABLE resources ADD COLUMN ai_brief_model TEXT",
   "ALTER TABLE resources ADD COLUMN ai_brief_at TEXT"
  ]
 },
 {
  "name": "0013_topics_focus.sql",
  "statements": [
   "UPDATE topics SET name = 'Privacy and data' WHERE slug = 'privacy'",
   "UPDATE topics SET name = 'Student voice', query = 'student voice and AI' WHERE slug = 'student-agency'",
   "UPDATE topics SET name = 'Writing and reading' WHERE slug = 'writing'",
   "UPDATE topics SET name = 'Tutoring and personalized learning' WHERE slug = 'ai-tutoring'",
   "INSERT OR IGNORE INTO topics(slug, name, query, position) VALUES\n  ('policy-guidance', 'Policy and guidance', 'AI policy and guidance for schools', 11),\n  ('safety-wellbeing', 'Safety and wellbeing', 'AI chatbots, child safety and wellbeing', 12),\n  ('accessibility', 'Accessibility and special education', 'AI, accessibility and special education', 13),\n  ('equity', 'Equity and bias', 'AI equity and bias in education', 14),\n  ('teacher-practice', 'Classroom practice', 'using AI in the classroom', 15),\n  ('computer-science', 'Computer science', 'computer science education and AI', 16),\n  ('future-of-work', 'Jobs and the future of work', 'AI, jobs and careers', 17)",
   "ALTER TABLE resources ADD COLUMN topics_auto INTEGER NOT NULL DEFAULT 0 CHECK (topics_auto IN (0,1))",
   "ALTER TABLE resources ADD COLUMN status_checked_at TEXT"
  ]
 }
];
