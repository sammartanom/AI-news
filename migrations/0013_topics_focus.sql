-- 0013: a fuller topic list for browsing, a marker for topics assigned by rules rather than
-- an editor, and the date a law or tracker's status was last checked.
UPDATE topics SET name = 'Privacy and data' WHERE slug = 'privacy';
UPDATE topics SET name = 'Student voice', query = 'student voice and AI' WHERE slug = 'student-agency';
UPDATE topics SET name = 'Writing and reading' WHERE slug = 'writing';
UPDATE topics SET name = 'Tutoring and personalized learning' WHERE slug = 'ai-tutoring';
INSERT OR IGNORE INTO topics(slug, name, query, position) VALUES
  ('policy-guidance', 'Policy and guidance', 'AI policy and guidance for schools', 11),
  ('safety-wellbeing', 'Safety and wellbeing', 'AI chatbots, child safety and wellbeing', 12),
  ('accessibility', 'Accessibility and special education', 'AI, accessibility and special education', 13),
  ('equity', 'Equity and bias', 'AI equity and bias in education', 14),
  ('teacher-practice', 'Classroom practice', 'using AI in the classroom', 15),
  ('computer-science', 'Computer science', 'computer science education and AI', 16),
  ('future-of-work', 'Jobs and the future of work', 'AI, jobs and careers', 17);

-- 1 when the topics in "tags" were assigned by src/lib/autotopics.mjs. Rules may refresh those;
-- topics an editor chose (0) are never changed automatically.
ALTER TABLE resources ADD COLUMN topics_auto INTEGER NOT NULL DEFAULT 0 CHECK (topics_auto IN (0,1));

-- For laws and trackers: the date their status was last confirmed against the official source.
ALTER TABLE resources ADD COLUMN status_checked_at TEXT;
