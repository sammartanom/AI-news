-- 0003: editorial collections, topics, curated relationships, topic overrides.

CREATE TABLE IF NOT EXISTS collections (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL
);
INSERT OR IGNORE INTO collections(slug, name, position) VALUES
  ('start-here', 'Start here', 1),
  ('ai-literacy', 'AI literacy', 2),
  ('learning-thinking', 'Learning and thinking', 3),
  ('inside-classroom', 'Inside the classroom', 4),
  ('assessment-integrity', 'Assessment and academic integrity', 5),
  ('for-families', 'For families', 6),
  ('student-perspectives', 'Student perspectives', 7),
  ('school-district-leadership', 'School and district leadership', 8),
  ('privacy-security', 'Privacy and security', 9),
  ('policy-governance', 'Policy and governance', 10),
  ('professional-learning', 'Professional learning', 11),
  ('equity-access', 'Equity and access', 12),
  ('media-literacy', 'Media literacy and misinformation', 13),
  ('elementary-education', 'Elementary education', 14),
  ('research-evidence', 'Research and evidence', 15),
  ('questions-concerns', 'Questions, concerns, and critical perspectives', 16);

-- A topic is a named tag plus the query used to build its page. Resource tags that equal a
-- topic slug are treated as editor assignments.
CREATE TABLE IF NOT EXISTS topics (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL,
  position INTEGER NOT NULL
);
INSERT OR IGNORE INTO topics(slug, name, query, position) VALUES
  ('ai-literacy', 'AI literacy', 'AI literacy', 1),
  ('assessment', 'Assessment', 'assessment and AI', 2),
  ('academic-integrity', 'Academic integrity', 'academic integrity and AI', 3),
  ('privacy', 'Privacy', 'student data privacy and AI', 4),
  ('student-agency', 'Student agency', 'student agency and AI', 5),
  ('writing', 'Writing', 'AI and student writing', 6),
  ('ai-detection', 'AI detection', 'AI detection tools', 7),
  ('ai-tutoring', 'AI tutoring', 'AI tutoring', 8),
  ('media-literacy', 'Media literacy', 'media literacy and AI', 9),
  ('professional-learning', 'Professional learning', 'professional learning about AI for educators', 10);

-- Editor-selected relationships ("Read with this"). Never inferred.
CREATE TABLE IF NOT EXISTS resource_relations (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('companion','practical_example','research','policy_context','newer','background','critical_perspective')),
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  CHECK (from_id <> to_id),
  UNIQUE (from_id, to_id, relation)
);
CREATE INDEX IF NOT EXISTS resource_relations_from ON resource_relations(from_id);
CREATE INDEX IF NOT EXISTS resource_relations_to ON resource_relations(to_id);

-- Optional editorial overrides for generated topic pages.
CREATE TABLE IF NOT EXISTS topic_pins (
  topic_slug TEXT NOT NULL REFERENCES topics(slug) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('start','latest','classroom','research','leadership','students','concerns')),
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (topic_slug, section, resource_id)
);
