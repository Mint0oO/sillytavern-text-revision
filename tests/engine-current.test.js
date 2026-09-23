import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, applySelected, inlineHTML, parseRuleValues, formatRuleValues, proposal, validateRule } from '../engine.js';
import { scanFixture } from './scan-fixture.js';

const rule = (id, find, values = []) => validateRule({ id, kind: 'regex', editorVersion: 1, find, values, remove: !values.length, action: values.length ? 'replace' : 'delete' });

test('regex defaults preserve source order and unchecked fields through partial application', () => {
  const source = '你极其疲惫。\n\n空位极具吸引力。\n他极度不安，极其僵硬。';
  const round = scanFixture(source, DEFAULT_RULES, { random: () => 0 });
  assert.equal(round.count, 4);
  round.groups[1].selected = false;
  assert.equal(applySelected(round), 2);
  assert.equal(round.expected, '你疲惫。\n\n空位极具吸引力。\n他不安，僵硬。');
});

test('manual sentence editing cannot change neighboring text', () => {
  const round = scanFixture('他极其疲惫。\n天空放晴了。', DEFAULT_RULES);
  Object.assign(round.groups[0], { manual: true, draft: '他睡着了。', selected: true });
  applySelected(round);
  assert.equal(round.expected, '他睡着了。\n天空放晴了。');
});

test('overlapping regex deletions combine and replacement conflicts use priority', () => {
  let round = scanFixture('甲乙丙。', [rule('outer', '甲乙'), rule('inner', '乙')]);
  assert.equal(proposal(round.groups[0]), '丙。');
  round = scanFixture('甲乙。', [rule('remove', '甲乙'), { ...rule('replace', '乙', ['新']), priority: 10 }], { random: () => 0 });
  assert.equal(proposal(round.groups[0]), '甲新。');
});

test('candidate choice is stable within a round and HTML preview is escaped', () => {
  const round = scanFixture('测试。', [rule('replace', '测试', ['<img src=x>', '替换'])], { random: () => 0 });
  assert.equal(proposal(round.groups[0]), '<img src=x>。');
  assert.match(inlineHTML(round.groups[0]), /&lt;img src=x&gt;/);
  assert.equal(proposal(round.groups[0]), '<img src=x>。');
});

test('legacy rule shapes are rejected while capture replacement and priority remain supported', () => {
  assert.throws(() => validateRule({ kind: 'pattern', find: '像{A}一样' }), /旧版/);
  assert.throws(() => validateRule({ kind: 'regex', find: '极其', before: ['不'] }), /旧版/);
  assert.equal(validateRule({ kind: 'regex', find: '/(冷)冷/g', values: ['$1'], action: 'replace', priority: 10 }).priority, 10);
});

test('CSV candidate quoting stays lossless', () => {
  const values = ['甲,乙', '普通', 'A"B'];
  assert.deepEqual(parseRuleValues(formatRuleValues(values)), values);
});
