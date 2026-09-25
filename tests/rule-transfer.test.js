import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRule } from '../engine.js';
import { createRuleSet, stringifyRuleSet, parseRuleSet, applyRuleSet, RULE_SET_TYPE } from '../rule-transfer.js';

const regexRule = (find = '极其', values = ['很']) => validateRule({ kind: 'regex', editorVersion: 1, find, values, action: values.length ? 'replace' : 'delete', remove: !values.length, replacementMode: 'candidates', execution: 'inherit' });

test('rule-set JSON contains only portable rules and their shared execution mode', () => {
  const settings = { ruleExecution: 'auto', rules: [regexRule()], theme: 'dark', extractTags: ['content'], secret: 'never export' };
  const data = createRuleSet(settings, new Date('2026-09-06T00:00:00.000Z'));
  assert.deepEqual(Object.keys(data), ['type', 'formatVersion', 'exportedAt', 'ruleExecution', 'groups', 'rules']);
  assert.equal(data.type, RULE_SET_TYPE);
  assert.equal(data.ruleExecution, 'auto');
  assert.equal(data.exportedAt, '2026-09-06T00:00:00.000Z');
  assert.equal(JSON.stringify(data).includes('never export'), false);
  assert.deepEqual(parseRuleSet(stringifyRuleSet(settings, new Date('2026-09-06T00:00:00.000Z'))), { ruleExecution: 'auto', groups: [], rules: data.rules, priorityMigration: [], priorityMigrationRules: [] });
});

test('invalid, foreign, future and oversized rule sets fail before changing settings', () => {
  assert.throws(() => parseRuleSet(''), /空/);
  assert.throws(() => parseRuleSet('{'), /JSON 格式无效/);
  assert.throws(() => parseRuleSet('{"type":"other","formatVersion":1,"rules":[]}'), /不是 Henge/);
  assert.throws(() => parseRuleSet('{"type":"henge-rule-set","formatVersion":4,"rules":[]}'), /不支持/);
  assert.throws(() => parseRuleSet('{"type":"henge-rule-set","formatVersion":1,"rules":[{"kind":"pattern","find":"像{A}一样"}]}'), /旧版/);
  assert.equal(parseRuleSet(JSON.stringify({ type: RULE_SET_TYPE, formatVersion: 1, rules: [regexRule()] })).rules.length, 1);
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

test('groups and levels survive export; append merges names and preserves existing switches', () => {
  const existingGroups = [{ id: 'local', name: '描写', enabled: false }];
  const importedGroups = [{ id: 'foreign', name: '描写', enabled: true }, { id: 'other', name: '动作', enabled: true }];
  const incoming = [
    { ...regexRule('极其'), groupId: 'foreign', priorityLevel: 1 },
    { ...regexRule('极度'), groupId: 'other', priorityLevel: 3 },
  ];
  const parsed = parseRuleSet(stringifyRuleSet({ rules: incoming, ruleGroups: importedGroups }));
  assert.deepEqual(parsed.groups, importedGroups);
  assert.deepEqual(parsed.rules.map(rule => rule.priorityLevel), [1, 3]);
  const result = applyRuleSet([], parsed, 'append', existingGroups);
  assert.deepEqual(result.groups.map(group => [group.name, group.enabled]), [['描写', false], ['动作', true]]);
  assert.equal(result.rules[0].groupId, 'local');
  assert.equal(result.rules[1].groupId, 'other');
  assert.throws(() => parseRuleSet(JSON.stringify({ type: RULE_SET_TYPE, formatVersion: 3, groups: [], rules: incoming })), /所属分组不存在/);
});

test('legacy numeric priorities convert with a warning when distinct values collapse', () => {
  const legacy = [
    { ...regexRule('甲'), priority: 20 },
    { ...regexRule('乙'), priority: 10 },
    { ...regexRule('丙'), priority: 0 },
  ].map(({ priorityLevel, groupId, ...rule }) => rule);
  const imported = parseRuleSet(JSON.stringify({ type: RULE_SET_TYPE, formatVersion: 2, rules: legacy }));
  assert.deepEqual(imported.rules.map(rule => rule.priorityLevel), [1, 1, 2]);
  assert.deepEqual(imported.priorityMigration, [20, 10]);
  assert.deepEqual(imported.priorityMigrationRules.map(rule => rule.find), ['甲', '乙']);
});
