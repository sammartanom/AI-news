import test from 'node:test';
import assert from 'node:assert/strict';
import { rrf, applySignals, diversify, WEIGHTS, RRF_K } from '../../src/search/rank.mjs';
import { parseIntent } from '../../src/search/intent.mjs';

test('rrf: score is the sum of weight / (k + rank) across lists', () => {
  const fused = rrf([
    { name: 'keyword', ids: ['a', 'b', 'c'] },
    { name: 'semantic', ids: ['c', 'a', 'd'] }
  ]);
  const byId = Object.fromEntries(fused.map((f) => [f.id, f]));
  assert.ok(Math.abs(byId.a.score - (1 / (RRF_K + 1) + 1 / (RRF_K + 2))) < 1e-12);
  assert.ok(Math.abs(byId.c.score - (1 / (RRF_K + 3) + 1 / (RRF_K + 1))) < 1e-12);
  assert.deepEqual(byId.a.ranks, { keyword: 1, semantic: 2 });
  assert.equal(byId.d.ranks.keyword, undefined);
  // a (ranks 1,2) beats c (ranks 3,1); items in both lists beat items in one.
  assert.deepEqual(fused.map((f) => f.id), ['a', 'c', 'b', 'd']);
});

test('rrf: list weights change the order', () => {
  const lists = (wk, ws) => [{ name: 'keyword', ids: ['k'], weight: wk }, { name: 'semantic', ids: ['s'], weight: ws }];
  assert.equal(rrf(lists(1, 1))[0].id, 'k'); // tie broken by id
  assert.equal(rrf(lists(1, 3))[0].id, 's');
});

const row = (o) => ({ audiences: '["Everyone"]', collections: '[]', grade_bands: '[]', featured: 0, editorial_priority: 0, publisher: 'P', published_at: null, evidence_type: null, ...o });

test('applySignals: audience lens promotes matching audience and demotes mismatches', () => {
  const rows = new Map([['f', row({ audiences: '["Families"]' })], ['a', row({ audiences: '["Administrators"]' })], ['e', row({})]]);
  const items = [{ id: 'a', score: 0.02, ranks: {} }, { id: 'e', score: 0.02, ranks: {} }, { id: 'f', score: 0.02, ranks: {} }];
  const fam = applySignals(items, rows, { audience: 'Families' }).map((i) => i.id);
  assert.deepEqual(fam, ['f', 'e', 'a']);
  const adm = applySignals(items, rows, { audience: 'Administrators' }).map((i) => i.id);
  assert.deepEqual(adm, ['a', 'e', 'f']);
  const none = applySignals(items, rows, { audience: 'Everyone' }).map((i) => i.id);
  assert.deepEqual(none, ['a', 'e', 'f'].sort()); // no lens: no audience signal, id order on ties
});

test('applySignals: editorial signals are small and separate from relevance', () => {
  const rows = new Map([['x', row({ featured: 1, editorial_priority: 2 })], ['y', row({})]]);
  const items = [{ id: 'y', score: 0.03, ranks: {} }, { id: 'x', score: 0.02, ranks: {} }];
  const out = applySignals(items, rows, {});
  // Relevance 1.0 vs 0.667 normalized; featured+priority add 0.11, which does not overturn a clear relevance gap.
  assert.equal(out[0].id, 'y');
  const near = applySignals([{ id: 'y', score: 0.03, ranks: {} }, { id: 'x', score: 0.0295, ranks: {} }], rows, {});
  assert.equal(near[0].id, 'x'); // but breaks near-ties
});

test('applySignals: freshness applies only when asked for and only to known dates', () => {
  const now = Date.parse('2026-10-26');
  const rows = new Map([['new', row({ published_at: '2026-09-01' })], ['old', row({ published_at: '2020-01-01' })], ['unk', row({ published_at: null })]]);
  const items = ['old', 'unk', 'new'].map((id) => ({ id, score: 0.03, ranks: {} }));
  const recent = applySignals(items, rows, { intent: parseIntent('latest resources on AI policy'), now });
  assert.equal(recent[0].id, 'new');
  const unknown = recent.find((i) => i.id === 'unk');
  assert.equal(unknown.signals.some((s) => s.type === 'freshness'), false); // unknown date: no boost, no penalty
  const plain = applySignals(items, rows, { intent: parseIntent('AI policy'), now });
  assert.equal(plain.some((i) => i.signals.some((s) => s.type === 'freshness')), false);
});

test('diversify: repeated publishers are discounted, order otherwise preserved', () => {
  const rows = new Map(['a1', 'a2', 'a3', 'b1'].map((id) => [id, row({ publisher: id[0] === 'a' ? 'Alpha' : 'Beta' })]));
  const items = [{ id: 'a1', score: 1 }, { id: 'a2', score: 0.95 }, { id: 'a3', score: 0.9 }, { id: 'b1', score: 0.85 }];
  const out = diversify(items, rows).map((i) => i.id);
  // a2 (0.95 x 0.85 = 0.81) drops below b1 (0.85); a3 stays last.
  assert.deepEqual(out, ['a1', 'b1', 'a2', 'a3']);
  assert.ok(WEIGHTS.publisherDecay < 1);
});

test('intent: maps example questions to soft hints', () => {
  const t = (q) => parseIntent(q);
  assert.ok(t('What should parents know about AI and children?').audiences.includes('Families'));
  assert.ok(t('What should a superintendent read first?').audiences.includes('Administrators'));
  assert.ok(t('What should a superintendent read first?').collections.includes('start-here'));
  assert.ok(t('Show me research about AI tutoring').collections.includes('research-evidence'));
  assert.ok(t('Show resources skeptical of AI use in schools').collections.includes('questions-concerns'));
  assert.ok(t('What are students saying about AI?').collections.includes('student-perspectives'));
  assert.ok(t('What are the strongest concerns about AI detection?').collections.includes('questions-concerns'));
  assert.ok(t('Give me classroom examples without product marketing').evidence.includes('classroom_example'));
  assert.equal(t("I'm new to AI").wantsRecent, false);
  assert.equal(t('latest AI policy updates').wantsRecent, true);
});
