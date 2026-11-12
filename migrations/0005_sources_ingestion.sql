-- 0005: source registry fields and richer ingestion logging.
-- sources.feed_url is the discovery URL (feed, sitemap or API endpoint).
-- A source can only be enabled once review_status = 'verified'; the Worker enforces this.

ALTER TABLE sources ADD COLUMN source_type TEXT NOT NULL DEFAULT 'feed' CHECK (source_type IN ('feed','sitemap','api'));
ALTER TABLE sources ADD COLUMN site_url TEXT;
ALTER TABLE sources ADD COLUMN allowed_hosts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sources ADD COLUMN default_metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sources ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','verified','rejected'));
ALTER TABLE sources ADD COLUMN require_match INTEGER NOT NULL DEFAULT 1 CHECK (require_match IN (0,1));
ALTER TABLE sources ADD COLUMN last_success TEXT;
ALTER TABLE sources ADD COLUMN last_error_at TEXT;
ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN notes TEXT;
ALTER TABLE sources ADD COLUMN updated_at TEXT;

ALTER TABLE ingestion_log ADD COLUMN new_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_log ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_log ADD COLUMN flagged_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_log ADD COLUMN filtered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_log ADD COLUMN http_status INTEGER;
CREATE INDEX IF NOT EXISTS ingestion_log_source ON ingestion_log(source_id, started_at);
