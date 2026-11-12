import { runIngestion } from './ingest/pipeline.mjs';
import { runArchive } from './ingest/archive.mjs';
import { runLinkChecks } from './ingest/linkcheck.mjs';
import { runTriage, expireQueue } from './ingest/triage.mjs';
import { backfill, reconcileRemovals } from './search/embedding.mjs';
import { backfillBriefs } from './discovery/brief.mjs';
import { tagUntagged } from './discovery/tagging.mjs';
import { backfillKeys } from './repo/maintenance.mjs';
import { ensureDigest } from './discovery/digest.mjs';

// Keep in sync with triggers.crons in wrangler.jsonc.
export const CRON_INGEST = '17 */2 * * *';
export const CRON_DAILY = '43 3 * * *';
// Briefs read pages, so they get a run (and a 50-fetch budget) of their own, on the odd hours.
export const CRON_BRIEFS = '47 1-23/2 * * *';

/**
 * Scheduled work. Each step is isolated so one failure does not stop the others.
 * Ingestion only queues items for review; nothing is published here.
 */
export async function runScheduled(env, cron) {
  const out = {};
  const step = async (name, fn) => {
    try { out[name] = await fn(); } catch (e) { out[name] = { error: String(e?.message ?? e).slice(0, 200) }; console.error(`scheduled step ${name} failed:`, e); }
  };
  if (cron === CRON_BRIEFS) {
    await step('briefs', () => backfillBriefs(env, { limit: 18 }));
    await step('topics', () => tagUntagged(env));
    console.log('scheduled', cron, JSON.stringify(out));
    return out;
  }
  await step('keys', () => backfillKeys(env));
  // Kept small enough for the Workers Free plan: 50 fetches and 1,000 calls to D1 and AI per run.
  if (cron !== CRON_DAILY) await step('ingest', async () => (await runIngestion(env, { limit: 8 })).map((r) => ({ source: r.source, status: r.status, new: r.new, flagged: r.flagged, error: r.error })));
  if (cron !== CRON_DAILY) await step('archive', async () => (await runArchive(env, { pages: 6, maxNew: 40 })).map((r) => ({ source: r.source, page: r.page, new: r.new, done: r.done, error: r.error })));
  await step('triage', () => runTriage(env, { limit: 50 }));
  if (cron !== CRON_INGEST) await step('expire', () => expireQueue(env));
  if (cron !== CRON_INGEST) await step('links', () => runLinkChecks(env, { limit: 40 }));
  await step('topics', () => tagUntagged(env));
  await step('reconcile', () => reconcileRemovals(env));
  await step('backfill', () => backfill(env, { limit: 100 }));
  if (cron !== CRON_INGEST) await step('digest', () => ensureDigest(env));
  console.log('scheduled', cron, JSON.stringify(out));
  return out;
}
