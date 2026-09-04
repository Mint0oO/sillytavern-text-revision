import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, applySelected, DEFAULT_RULES, normalizeScope, proposal } from '../engine.js';
const run = (text, scope) => scan(text, DEFAULT_RULES, { scope, random: () => 0 });
const scope = { extractTags: ['content'], excludeTags: ['status', 'think'] };

test('extracts every matching body block and excludes nested content, with exact source preservation', () => {
  const text = '<think>极其谨慎。</think>\n<content id="1">你极其疲惫。<status>他极度紧张。</status>空位极具吸引力。</content>\n<aside>极其安静。</aside>\n<content>她极其简短。</content>';
  const r = run(text, scope);
  assert.equal(r.count, 3);
  assert.deepEqual(r.groups.map(g => g.original), ['你极其疲惫。', '空位极具吸引力。', '她极其简短。']);
  applySelected(r);
  assert.equal(r.expected, text.replace('你极其疲惫', '你疲惫').replace('空位极具', '空位很有').replace('她极其简短', '她简短'));
});
test('manual edits cannot include tag boundaries or excluded text', () => {
  const text = '<content>他极其疲惫<status value="极其">极度紧张</status>，她极其担忧。</content>';
  const r = run(text, scope);
  assert.deepEqual(r.groups.map(g => g.original), ['他极其疲惫', '，她极其担忧。']);
  Object.assign(r.groups[0], { manual: true, draft: '他已经睡着', selected: true });
  r.groups[1].selected = false; applySelected(r);
  assert.equal(r.expected, '<content>他已经睡着<status value="极其">极度紧张</status>，她极其担忧。</content>');
});
test('same-name nested tags are paired once and exclusion has priority over extraction', () => {
  const text = '<content>极其疲惫。<content>极其不安。</content><status>极其安静。<status>极其简短。</status></status></content>';
  const r = run(text, scope); assert.equal(r.count, 2);
  assert.equal(run(text, { extractTags: ['content'], excludeTags: ['content'] }).count, 0);
  assert.equal(run('<status><content>极其疲惫。</content></status>', scope).count, 0);
});
test('multiple extraction tag names, case-insensitive tags, attributes, comments and code samples', () => {
  const text = '```\n<content>极其疲惫。</content>\n```\n<!-- <content>极其简短。</content> -->\n<CONTENT data-x=">" href="https://example.test">极其不安。</CONTENT><正文>极具吸引力。</正文>';
  const r = run(text, { extractTags: ['content', '正文'], excludeTags: [] });
  assert.equal(r.count, 2); applySelected(r);
  assert.ok(r.expected.includes('<!-- <content>极其简短。</content> -->'));
  assert.ok(r.expected.includes('<CONTENT data-x=">" href="https://example.test">不安。</CONTENT>'));
  assert.ok(r.expected.includes('<正文>很有吸引力。</正文>'));
});
test('missing body tags never fall back to full-message scanning; empty extraction permits full message', () => {
  const r = run('极其疲惫。', scope);
  assert.equal(r.count, 0); assert.match(r.notice, /未找到提取标签/); assert.equal(applySelected(r), 0);
  assert.equal(run('极其疲惫。<status>极其不安。</status>', { extractTags: [], excludeTags: ['status'] }).count, 1);
});
test('malformed configured tags fail closed instead of producing unsafe proposals', () => {
  for (const text of ['<content>极其疲惫。', '<content><status>极其疲惫。</content></status>', '<content>极其疲惫。</status></content>']) assert.throws(() => run(text, scope), /标签/);
});
test('self-closing tags and inline markup remain outside matches and manual edits', () => {
  const text = '<content>极其疲惫。<status/><br/>极其不安。<b>极其简短。</b></content>';
  const r = run(text, scope); assert.equal(r.count, 3); applySelected(r);
  assert.equal(r.expected, '<content>疲惫。<status/><br/>不安。<b>简短。</b></content>');
});
test('configured tags normalize names, wrappers and duplicates but reject attributes', () => {
  assert.deepEqual(normalizeScope({ extractTags: 'content\n<CONTENT>\n</content>', excludeTags: 'status，options' }), { extractTags: ['content'], excludeTags: ['options', 'status'] });
  assert.throws(() => normalizeScope({ extractTags: '<content id="x">' }), /标签名/);
});
test('sentence templates cannot match across excluded sections or markup', () => {
  const r = run('<content>悲伤像洪水<status>极其</status>一样把他淹没了。</content>', scope);
  assert.equal(r.count, 0);
  const normal = run('<content>悲伤像洪水一样把他淹没了。</content>', scope);
  assert.equal(proposal(normal.groups[0]), '悲伤把他淹没了。');
});
test('tag examples inside excluded blocks are opaque and cannot open extraction scopes', () => {
  const r = run('<script>const s="<content>极其疲惫。";</script><content>极其疲惫。</content>', { extractTags: ['content'], excludeTags: ['script'] });
  assert.equal(r.count, 1); applySelected(r);
  assert.equal(r.expected, '<script>const s="<content>极其疲惫。";</script><content>疲惫。</content>');
});
