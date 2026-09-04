import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, scan, proposal, applySelected, validateRule, inlineHTML, parseRuleValues, formatRuleValues } from '../engine.js';
const detect = text => scan(text, DEFAULT_RULES, { random: () => 0 });

test('groups follow source order; partial application preserves unchecked sentences and whitespace', () => {
  const source = '你极其疲惫。\n\n空位极具吸引力。\n中间没有问题。\n他极度不安，极其僵硬。';
  const r = detect(source);
  assert.equal(r.count, 4); assert.equal(r.groups.length, 3);
  r.groups[1].selected = false;
  assert.equal(applySelected(r), 2);
  assert.equal(r.expected, '你疲惫。\n\n空位极具吸引力。\n中间没有问题。\n他不安，僵硬。');
  assert.equal(r.count, 4);
  r.groups[1].selected = true; applySelected(r);
  assert.equal(r.expected, source.replaceAll('极其', '').replace('极度', '').replace('极具', '很有'));
});
test('bounded metaphor templates retain configured content, unresolved predicates stay untouched', () => {
  assert.equal(proposal(detect('悲伤像洪水一样把他淹没了。').groups[0]), '悲伤把他淹没了。');
  const contrast = detect('不是害怕，而是担心。');
  assert.equal(proposal(contrast.groups[0]), '担心。');
  const kite = detect('他的思绪像断了线的风筝一样。');
  assert.equal(kite.groups[0].matches[0].value, null); assert.equal(kite.groups[0].selected, false);
});
test('manual sentence replacement retains neighboring text and enables unresolved sentences', () => {
  const r = detect('他的思绪像断了线的风筝一样。\n天空放晴了。');
  Object.assign(r.groups[0], { manual: true, draft: '他的思绪飘远了。', selected: true });
  applySelected(r); assert.equal(r.expected, '他的思绪飘远了。\n天空放晴了。');
});
test('code, reasoning, links and markup attributes are excluded; rendered text is escaped', () => {
  const r = detect('```\n极其疲惫。\n```\n<think>极度不安。</think>\n[链接](https://x.test/极其)\n<span title="极其">极其疲惫。</span>');
  assert.equal(r.count, 1);
  assert.ok(!inlineHTML(r.groups[0]).includes('<span title='));
  assert.ok(!r.groups[0].original.includes('<span'));
  const injected = scan('测试。', [{ find: '测试', values: ['<img src=x onerror=alert(1)>'], action: 'replace' }]);
  assert.ok(inlineHTML(injected.groups[0]).includes('&lt;img'));
});
test('overlapping rules flag a single unresolved span without duplicate deletion', () => {
  const a = validateRule({ find: '极其疲惫', remove: true, action: 'delete' });
  const r = scan('你极其疲惫。', [DEFAULT_RULES[0], a]);
  assert.equal(r.count, 1); assert.equal(proposal(r.groups[0]), '你极其疲惫。');
});
test('invalid capture templates and unknown replacement captures cannot be saved', () => {
  for (const find of ['{A}', '像{A}{B}一样', '像{A}的{A}一样']) assert.throws(() => validateRule({ find, kind: 'pattern' }));
  assert.throws(() => validateRule({ find: '像{A}一样', kind: 'pattern', values: ['{B}'], action: 'replace' }));
  assert.throws(() => validateRule({ find: '极其', action: 'delete', remove: false }));
});
test('fixed words are literal; random candidates are stable until a new scan or choice', () => {
  const r = scan('a+b。', [{ find: 'a+b', values: ['X', 'Y'], action: 'replace' }], { random: () => .99 });
  assert.equal(proposal(r.groups[0]), 'Y。'); assert.equal(proposal(r.groups[0]), 'Y。');
  assert.equal(scan('aaab。', [{ find: 'a+b', values: ['X'] }]).count, 0);
});


test('comma-separated candidates preserve quoted commas, Chinese punctuation and legacy newlines', () => {
  assert.deepEqual(parseRuleValues('十分, 非常,, 很\n特别'), ['十分', '非常', '很', '特别']);
  const values = ['{B}', '并非{A}，只是{B}', '轻声, 细语', '轻声说"你好"', '第一行\n第二行'];
  assert.deepEqual(parseRuleValues(formatRuleValues(values)), values);
  assert.throws(() => parseRuleValues('"轻声, 细语'), /未闭合/);
  assert.throws(() => parseRuleValues('"你好"多余文字'), /英文逗号/);
});
