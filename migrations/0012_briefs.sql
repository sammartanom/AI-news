-- 0012: a short AI-written description of each resource, made once from its page (or, when the
-- page cannot be read, from its listing) and shown at the top of the resource dialog.
ALTER TABLE resources ADD COLUMN ai_brief TEXT;
ALTER TABLE resources ADD COLUMN ai_brief_basis TEXT;   -- 'page', 'listing' or 'failed'
ALTER TABLE resources ADD COLUMN ai_brief_model TEXT;
ALTER TABLE resources ADD COLUMN ai_brief_at TEXT;
