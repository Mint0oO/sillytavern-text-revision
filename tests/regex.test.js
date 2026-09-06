import test from 'node:test';
import assert from 'node:assert/strict';
import { scanPrepared } from '../scanner.js';
import { proposal, applySelected, validateRule } from '../engine.js';
import { createRuleDraft, simpleRule, bulkRules } from '../rule-editor.js';
import { renderRuleForm } from '../rule-form.js';

const rule = (find, values = [], extra = {}) => validateRule({ kind: 'regex', find, values, remove: true, action: values.length ? 'replace' : 'delete', ...extra });

test('optional suffixes, alternatives, captures and lookarounds use standard RegExp semantics', async () => {
  let r = await scanPrepared('他死死地抓住她，又死死盯着那些花。', [rule('/死死地?/g'), rule('/这些|那些/g', ['花园里的'])]);
  assert.equal(proposal(r.groups[0]), '他抓住她，又盯着花园里的花。');
  r = await scanPrepared('她如同小猫一样靠近，像鸟一样离开。', [rule('/(?:像|如同)([^，。]+?)一样/g', ['$1般'])]);
  assert.equal(proposal(r.groups[0]), '她小猫般靠近，鸟般离开。');
  r = await scanPrepared('积极回应，他极冷。', [rule('/(?<!积)极(?=冷)/g')]);
  assert.equal(proposal(r.groups[0]), '积极回应，他冷。');
  r = await scanPrepared('他冷冷地笑。', [rule('/(?<word>冷冷)地/g', ['$<word>/$1/$0/{{match}}/$$'])]);
  assert.equal(proposal(r.groups[0]), '他冷冷/冷冷/冷冷地/冷冷地/$笑。');
});

test('regex respects scope, HTML, sentences, emoji offsets and explicit first-only flags', async () => {
  const source = '<think>死死地</think><content>😀死死地握住，死死盯住。<status>死死地</status>死死地。</content>';
  const r = await scanPrepared(source, [rule('/死死地?/')], { scope: { extractTags: ['content'], excludeTags: ['think', 'status'] } });
  applySelected(r);
  assert.equal(r.expected, '<think>死死地</think><content>😀握住，死死盯住。<status>死死地</status>。</content>');
  assert.equal((await scanPrepared('像猫。像狗一样。', [rule('/像.*一样/gs')])).groups[0].original, '像狗一样。');
  assert.equal((await scanPrepared('像<em>猫</em>一样。', [rule('/像.*一样/gs')])).count, 0);
});

test('configured macros reuse the host once per occurrence and captured text cannot invoke macros', async () => {
  const calls = [], context = { substituteParamsExtended(macro) { calls.push(macro); return macro.startsWith('{{random') ? '缓缓' : '小明'; } };
  const r = await scanPrepared('他死死地抓住。', [rule('/死死地?/g', ['{{random::轻轻::缓缓}}'])], { context });
  assert.equal(proposal(r.groups[0]), '他缓缓抓住。'); applySelected(r);
  assert.equal(r.expected, '他缓缓抓住。'); assert.equal(calls.length, 1);
  const captured = await scanPrepared('他{{setvar::x::1}}地笑。', [rule('/(\{\{.*?\}\})地/g', ['$1{{user}}'])], { context });
  assert.equal(proposal(captured.groups[0]), '他{{setvar::x::1}}小明笑。');
  assert.deepEqual(calls, ['{{random::轻轻::缓缓}}', '{{user}}']);
  await assert.rejects(scanPrepared('死死地', [rule('死死地', ['{{char}}'])]), /未提供宏解析/);
  assert.throws(() => rule('死死地', ['{{setvar::x::1}}']), /替换宏支持/);
});

test('empty matches, invalid syntax and pathological regex are rejected without partial changes', async () => {
  assert.throws(() => rule('/[/g'), /正则表达式无效/);
  await assert.rejects(scanPrepared('你好。', [rule('/^/g')]), /空位置/);
  await assert.rejects(scanPrepared('a'.repeat(150) + '!', [rule('/(a+)+$/g')], { timeout: 250 }), /超时/);
  assert.equal((await scanPrepared('死死地', [rule('死死地')])).count, 1);
});

test('auto edits only eligible occurrences and a chosen overlap applies without yellow conflict', async () => {
  const rules = [rule('死死地?', [], { execution: 'auto' }), rule('极其', ['很'])];
  const r = await scanPrepared('他死死地抓住她，极其紧张。', rules);
  assert.equal(applySelected(r, { automatic: true }), 1);
  assert.equal(r.expected, '他抓住她，极其紧张。');
  assert.equal(r.groups[0].matches[0].done, true);
  assert.equal(r.groups[0].matches[1].done, false);
  assert.equal(r.log.length, 1); assert.equal(r.log[0].automatic, true);
  applySelected(r); assert.equal(r.expected, '他抓住她，很紧张。');
  assert.equal(r.log.length, 2); assert.equal(r.log[1].automatic, false);
  const conflict = await scanPrepared('他死死地抓住。', [rule('死死地?', [], { execution: 'auto' }), rule('死死地', ['紧紧'])], { random: () => 0 });
  assert.equal(applySelected(conflict, { automatic: true }), 1);
  assert.equal(conflict.expected, '他抓住。');
});

test('editor preserves old punctuation and batches support random candidates', () => {
  const original = rule('/死死地?/g', ['轻轻, 缓缓{{char}}'], { execution: 'auto', category: 'sentence' });
  assert.deepEqual(simpleRule(createRuleDraft(original), original).values, original.values);
  const batch = bulkRules('/这些|那些/g\t花园里的, 那些\n/死死地?/g\t{{random::轻轻::缓缓}}', { mode: 'regex', action: 'replace' });
  assert.equal(batch.length, 2); assert.deepEqual(batch[0].values, ['花园里的', '那些']);
  assert.throws(() => bulkRules('甲\t乙\n[', { action: 'replace' }), /第 2 行/);
  const draft = createRuleDraft(); draft.find = '死死地?';
  const saved = simpleRule(draft), html = renderRuleForm(createRuleDraft(saved));
  assert.match(html, /替换为/); assert.doesNotMatch(html, /附加条件/);
});

test('logs use the last applied text when a saved occurrence is edited again', async () => {
  const r = await scanPrepared('他死死地抓住。', [rule('死死地', ['紧紧'])]);
  applySelected(r);
  const g = r.groups[0]; g.matches[0].value = '轻轻'; g.selected = true;
  applySelected(r); assert.equal(r.log[1].before, '紧紧'); assert.equal(r.log[1].after, '轻轻');
  g.manual = true; g.draft = '他松开手。'; g.selected = true;
  applySelected(r); assert.equal(r.log[2].before, '他轻轻抓住。');
});
