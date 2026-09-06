import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRule } from '../engine.js';
import { createRuleSet, stringifyRuleSet, parseRuleSet, applyRuleSet, RULE_SET_TYPE } from '../rule-transfer.js';

const regexRule = (find = '极其', values = ['很']) => validateRule({ kind: 'regex', editorVersion: 1, find, values, action: values.length ? 'replace' : 'delete', remove: !values.length, replacementMode: 'candidates', execution: 'inherit' });

test('rule-set JSON contains only portable rules and their shared execution mode', () => {
  const legacy = validateRule({ kind: 'pattern', find: '不是{A}，而是{B}', captures: { A: { type: 'text' }, B: { type: 'text' } }, values: ['{B}'], action: 'replace' });
  const settings = { ruleExecution: 'auto', rules: [regexRule(), legacy], theme: 'dark', extractTags: ['content'], secret: 'never export' };
  const data = createRuleSet(settings, new Date('2026-09-06T00:00:00.000Z'));
  assert.deepEqual(Object.keys(data), ['type', 'formatVersion', 'exportedAt', 'ruleExecution', 'rules']);
  assert.equal(data.type, RULE_SET_TYPE);
  assert.equal(data.ruleExecution, 'auto');
  assert.equal(data.exportedAt, '2026-09-06T00:00:00.000Z');
  assert.equal(JSON.stringify(data).includes('never export'), false);
  assert.deepEqual(parseRuleSet(stringifyRuleSet(settings, new Date('2026-09-06T00:00:00.000Z'))), { ruleExecution: 'auto', rules: data.rules });
});

test('invalid, foreign, future and oversized rule sets fail before changing settings', () => {
  assert.throws(() => parseRuleSet(''), /空/);
  assert.throws(() => parseRuleSet('{'), /JSON 格式无效/);
  assert.throws(() => parseRuleSet('{"type":"other","formatVersion":1,"rules":[]}'), /不是 Henge/);
  assert.throws(() => parseRuleSet('{"type":"henge-rule-set","formatVersion":2,"rules":[]}'), /不支持/);
  const tooMany = JSON.stringify({ type: RULE_SET_TYPE, formatVersion: 1, rules: Array.from({ length: 201 }, () => regexRule()) });
  assert.throws(() => parseRuleSet(tooMany), /最多包含 200/);
  assert.throws(() => parseRuleSet(JSON.stringify({ type: RULE_SET_TYPE, formatVersion: 1, rules: [{ kind: 'regex', find: '[', values: [] }] })), /第 1 条规则无效/);
});

test('append deduplicates without changing execution; replace adopts the imported mode', () => {
  const existing = [regexRule('极其', ['很'])];
  const imported = { ruleExecution: 'auto', rules: [structuredClone(existing[0]), regexRule('死死地?', [])] };
  const appended = applyRuleSet(existing, imported, 'append');
  assert.equal(appended.rules.length, 2);
  assert.equal(appended.added, 1);
  assert.equal(appended.skipped, 1);
  assert.equal(appended.ruleExecution, null);
  assert.notEqual(appended.rules[1].id, imported.rules[1].id);

  const replaced = applyRuleSet(existing, imported, 'replace');
  assert.equal(replaced.rules.length, 2);
  assert.equal(replaced.ruleExecution, 'auto');
  assert.ok(replaced.rules.every((rule, index) => rule.id !== imported.rules[index].id));
  assert.throws(() => applyRuleSet(Array.from({ length: 200 }, (_, i) => regexRule(`词${i}`)), { ruleExecution: 'review', rules: [regexRule('新增')] }, 'append'), /超过 200/);
});
