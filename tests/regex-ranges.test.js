import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleDraft, simpleRule } from '../rule-editor.js';
import { scanPrepared } from '../scanner.js';
import { applySelected } from '../engine.js';

const rule = (find, valuesText = '') => simpleRule({ ...createRuleDraft(), find, valuesText });
test('new regex matches across sentences/lines; anchors refer to the full editable range', async () => {
  const r = await scanPrepared('甲。乙\n丙。丁。', [rule('甲。乙\\n丙', '新')]);
  applySelected(r); assert.equal(r.expected, '新。丁。');
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].original, '甲。乙\n丙。');
  const anchored = await scanPrepared('甲。乙。', [rule('^甲。乙。$', '新')]);
  applySelected(anchored); assert.equal(anchored.expected, '新');
  const first = await scanPrepared('甲。甲。', [rule('/甲/', '乙')]);
  applySelected(first); assert.equal(first.expected, '乙。甲。');
});

test('whitespace matches retain offsets without overwriting adjacent sentences', async () => {
  const r = await scanPrepared('甲。\n\n乙。', [rule('\\n+')]); applySelected(r);
  assert.equal(r.expected, '甲。乙。');
  const spaces = simpleRule({ ...createRuleDraft(), find: '\\n+', valuesText: ' ', wholeReplacement: true });
  const s = await scanPrepared('甲。\n\n乙。', [spaces]); applySelected(s);
  assert.equal(s.expected, '甲。 乙。');
});

test('cross-sentence regex never crosses protected tags, code, or exclusions', async () => {
  const code = String.fromCharCode(96) + '乙' + String.fromCharCode(96);
  const text = '<think>甲。乙</think><content>甲。乙<status>甲。乙</status>甲<em>乙</em>甲' + code + '乙</content>';
  const r = await scanPrepared(text, [rule('甲[\\s\\S]*?乙', '新')], { scope: { extractTags: ['content'], excludeTags: ['think', 'status'] } });
  applySelected(r);
  assert.equal(r.expected, '<think>甲。乙</think><content>新<status>甲。乙</status>甲<em>乙</em>甲' + code + '乙</content>');
});

test('mixed old/new matches share coherent groups and overlapping edits remain reviewable', async () => {
  const old = { kind: 'regex', find: '/乙/g', action: 'replace', values: ['二'] };
  const r = await scanPrepared('甲。乙。丙。', [rule('甲。乙', '一'), old]);
  assert.equal(r.groups.length, 1); assert.equal(r.groups[0].matches[0].value, null);
  applySelected(r); assert.equal(r.expected, '甲。乙。丙。');
  const separate = await scanPrepared('甲。乙。丙。', [rule('甲。乙', '一'), { ...old, find: '/丙/g' }]);
  applySelected(separate); assert.equal(separate.expected, '一。二。');
});

test('shared execution applies to inherited rules while preserving old per-rule choices', async () => {
  const r = await scanPrepared('甲。乙。', [rule('甲', '一'), { kind: 'regex', find: '/乙/g', action: 'replace', values: ['二'], execution: 'review' }], { executionDefault: 'auto' });
  applySelected(r, { automatic: true });
  assert.equal(r.expected, '一。乙。');
  assert.equal(r.log[0].automatic, true);
});
