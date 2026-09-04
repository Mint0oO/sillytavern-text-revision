import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleDraft, syncRuleDraft, simpleRule, clearExtraConditions } from '../rule-editor.js';
import { DEFAULT_RULES, scan, proposal, validateRule } from '../engine.js';
import { ensureLanguage } from '../language.js';

test('new deletion needs only matching text and retains the comma fix', () => {
  const draft = createRuleDraft(); draft.find = '像{A}一样';
  const rule = simpleRule(draft);
  assert.equal(rule.action, 'delete'); assert.equal(rule.kind, 'pattern');
  assert.equal(proposal(scan('然后像新兵一样，贴墙走。', [rule]).groups[0]), '然后贴墙走。');
});

test('a leading placeholder defaults to one word without requiring POS or a matching mode', async () => {
  await ensureLanguage();
  const draft = createRuleDraft(); draft.find = '{A}极了'; syncRuleDraft(draft);
  draft.action = 'replace'; draft.valuesText = '很{A}';
  const rule = simpleRule(draft);
  assert.equal(rule.captures.A.type, 'word');
  assert.equal(proposal(scan('他高兴极了。', [rule]).groups[0]), '他很高兴。');
});

test('simple edits preserve old candidates, POS and extra conditions without rewriting settings', () => {
  const old = validateRule({ id: 'custom', find: '极度{A}', kind: 'pattern', captures: { A: { type: 'verb', words: ['疲惫'] } }, values: ['{A}', '十分{A}'], action: 'replace', before: ['他'], after: ['。'], notBefore: ['不是'], exceptions: ['极度疲惫'], punctuation: 'none', boundary: 'sentence', priority: 42, enabled: false });
  const draft = createRuleDraft(old);
  assert.deepEqual(simpleRule(draft, old), old);
  draft.action = 'delete';
  const saved = simpleRule(draft, old);
  assert.equal(saved.remove, true); assert.deepEqual(saved.values, old.values);
  assert.equal(saved.priority, 42); assert.deepEqual(saved.captures, old.captures);
  clearExtraConditions(draft);
  const cleared = simpleRule(draft, old);
  assert.equal(cleared.priority, 0); assert.deepEqual(cleared.before, []);
  assert.equal(old.priority, 42);
});

test('literal old rules remain literal, and default rules round-trip through the simple editor', () => {
  const old = validateRule({ id: 'literal', find: '{A}', kind: 'word', values: ['甲'], action: 'replace' });
  assert.deepEqual(simpleRule(createRuleDraft(old), old), old);
  for (const rule of DEFAULT_RULES) assert.deepEqual(simpleRule(createRuleDraft(rule), rule), validateRule(rule));
});
