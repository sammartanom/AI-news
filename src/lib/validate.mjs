import { HttpError } from './http.mjs';
import { stripHtml, parseDateLoose } from './text.mjs';
import { AUDIENCES, GRADE_BANDS, EVIDENCE_TYPES, collectionSlugs, VERIFICATION_STATUSES, LINK_STATUSES } from './taxonomy.mjs';
import { assertPublicHttpsUrl, UnsafeUrlError } from './url.mjs';

const evidenceSlugs = new Set(EVIDENCE_TYPES.map((e) => e.slug));

function str(v, name, max, { required = false } = {}) {
  if (v === undefined) return undefined;
  if (v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`, { field: name });
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be text`, { field: name });
  const s = stripHtml(v, max + 1);
  if (s.length > max) throw new HttpError(400, `${name} must be ${max} characters or fewer`, { field: name });
  if (required && !s) throw new HttpError(400, `${name} is required`, { field: name });
  return s || null;
}

function list(v, name, { allowed, max = 12, itemMax = 60, lower = false } = {}) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new HttpError(400, `${name} must be a list`, { field: name });
  if (v.length > max) throw new HttpError(400, `${name} has too many items`, { field: name });
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') throw new HttpError(400, `${name} must contain text`, { field: name });
    let s = stripHtml(item, itemMax + 1);
    if (lower) s = s.toLowerCase();
    if (!s) continue;
    if (s.length > itemMax) throw new HttpError(400, `${name} item too long`, { field: name });
    if (allowed && !allowed.has(s)) throw new HttpError(400, `${name}: "${s}" is not allowed`, { field: name });
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

const bool = (v, name) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new HttpError(400, `${name} must be true or false`, { field: name });
  return v;
};

// Validates and normalizes editor input. Returns only the fields that were supplied.
export function cleanResourceInput(body, { now = Date.now() } = {}) {
  const o = {};
  const set = (k, v) => { if (v !== undefined) o[k] = v; };
  set('title', str(body.title, 'title', 300));
  if (body.title !== undefined && !o.title) throw new HttpError(400, 'title is required', { field: 'title' });
  set('publisher', str(body.publisher, 'publisher', 200));
  if (body.publisher !== undefined && !o.publisher) throw new HttpError(400, 'publisher is required', { field: 'publisher' });
  set('author', str(body.author, 'author', 200));
  set('format', str(body.format, 'format', 40));
  if (body.format !== undefined && !o.format) throw new HttpError(400, 'format is required', { field: 'format' });
  if (body.evidence_type !== undefined) {
    if (body.evidence_type !== null && body.evidence_type !== '' && !evidenceSlugs.has(body.evidence_type)) throw new HttpError(400, 'evidence_type is not allowed', { field: 'evidence_type' });
    o.evidence_type = body.evidence_type || null;
  }
  set('audiences', list(body.audiences, 'audiences', { allowed: new Set(AUDIENCES) }));
  set('collections', list(body.collections, 'collections', { allowed: collectionSlugs }));
  set('topics', list(body.topics, 'topics', { lower: true, max: 20 }));
  set('grade_bands', list(body.grade_bands, 'grade_bands', { allowed: new Set(GRADE_BANDS) }));
  set('subjects', list(body.subjects, 'subjects', { lower: true }));
  set('why', str(body.why, 'why', 300));
  set('best_for', str(body.best_for, 'best_for', 200));
  set('editorial_note', str(body.editorial_note, 'editorial_note', 1200));
  set('description', str(body.description, 'description', 600));
  set('summary', str(body.summary, 'summary', 1500));
  set('verification', str(body.verification, 'verification', 300));
  set('language', str(body.language, 'language', 20));
  if (o.language && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(o.language)) throw new HttpError(400, 'language must be a language code such as en or es', { field: 'language' });
  set('rejected_reason', str(body.rejected_reason, 'rejected_reason', 300));
  set('summary_generated', bool(body.summary_generated, 'summary_generated'));
  set('summary_approved', bool(body.summary_approved, 'summary_approved'));
  set('featured', bool(body.featured, 'featured'));
  set('duplicate_dismissed', bool(body.duplicate_dismissed, 'duplicate_dismissed'));
  if (body.verification_status !== undefined) {
    if (!VERIFICATION_STATUSES.includes(body.verification_status)) throw new HttpError(400, 'verification_status is not allowed', { field: 'verification_status' });
    o.verification_status = body.verification_status;
  }
  if (body.link_status !== undefined) {
    if (!LINK_STATUSES.includes(body.link_status)) throw new HttpError(400, 'link_status is not allowed', { field: 'link_status' });
    o.link_status = body.link_status;
  }
  if (body.editorial_priority !== undefined) {
    if (![0, 1, 2].includes(body.editorial_priority)) throw new HttpError(400, 'editorial_priority must be 0, 1 or 2', { field: 'editorial_priority' });
    o.editorial_priority = body.editorial_priority;
  }
  if (body.reading_minutes !== undefined) {
    if (body.reading_minutes !== null && (!Number.isInteger(body.reading_minutes) || body.reading_minutes < 1 || body.reading_minutes > 1000)) throw new HttpError(400, 'reading_minutes must be a whole number of minutes', { field: 'reading_minutes' });
    o.reading_minutes = body.reading_minutes;
  }
  if (body.published_at !== undefined) {
    if (body.published_at === null || body.published_at === '') o.published_at = null;
    else {
      const raw = String(body.published_at);
      if (/^\d{4}(-\d{2})?$/.test(raw)) {
        const [y, m] = raw.split('-').map(Number);
        if (y < 1990 || y > new Date(now).getUTCFullYear() || (m !== undefined && (m < 1 || m > 12))) throw new HttpError(400, 'published_at is not a plausible date', { field: 'published_at' });
        o.published_at = raw;
      } else {
        const d = parseDateLoose(raw, now);
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpError(400, 'published_at must be YYYY, YYYY-MM or YYYY-MM-DD and not in the future', { field: 'published_at' });
        o.published_at = d;
      }
    }
  }
  if (body.status_checked_at !== undefined) {
    if (body.status_checked_at === null || body.status_checked_at === '') o.status_checked_at = null;
    else {
      const raw = String(body.status_checked_at);
      const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseDateLoose(raw, now) : null;
      if (!d) throw new HttpError(400, 'status_checked_at must be YYYY-MM-DD and not in the future', { field: 'status_checked_at' });
      o.status_checked_at = d;
    }
  }
  if (body.url !== undefined) {
    try { o.url = assertPublicHttpsUrl(body.url).href; } catch (e) {
      if (e instanceof UnsafeUrlError) throw new HttpError(400, `url: ${e.message}`, { field: 'url' });
      throw e;
    }
  }
  return o;
}

export function requirePublishable(row) {
  const problems = [];
  if (!row.title) problems.push('title');
  if (!row.publisher) problems.push('publisher');
  if (!row.why) problems.push('why included');
  const aud = JSON.parse(row.audiences || '[]');
  if (!aud.length) problems.push('audience');
  if (problems.length) throw new HttpError(422, `Cannot publish: missing ${problems.join(', ')}`, { missing: problems });
}
