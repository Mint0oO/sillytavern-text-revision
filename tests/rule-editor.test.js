import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleDraft, simpleRule, isLegacyRule, bulkRules } from '../rule-editor.js';
import { validateRule, applySelected } from '../engine.js';
import { scanPrepared } from '../scanner.js';
import { parseRegex, parseRegexes, splitRegexBranches } from '../regex-support.js';
import { renderRuleForm } from '../rule-form.js';

const make = (find, valuesText = '', extra = {}) => simpleRule({ ...createRuleDraft(), find, valuesText, ...extra });
const revise = async (text, rule, options) => {
  const round = await scanPrepared(text, [rule], options); applySelected(round); return round;
};

test('bare optional suffix and plain word list delete all matches, longest first', async () => {
  const text = '他死死地抓住，又死死盯着。';
  for (const find of ['死死地?', '死死, 死死地', '死死\n死死地', '/死死地?/g']) {
    const round = await revise(text, make(find));
    assert.equal(round.expected, '他抓住，又盯着。');
    assert.equal(round.log.length, 2);
  }
  assert.equal((await revise('死死地', make('死死'))).expected, '地');
});

test('candidate lists select independently per occurrence and log the actual chosen result', async () => {
  const choices = [0, 0.99];
  const round = await revise('极其安静，极致温柔。', make('极其, 极致', '十分, 很'), { random: () => choices.shift() });
  assert.equal(round.expected, '十分安静，很温柔。');
  assert.deepEqual(round.log.map(m => m.after), ['十分', '很']);
  assert.deepEqual(round.log.map(m => m.before), ['极其', '极致']);
  assert.deepEqual(make('词', '十分\n很').values, ['十分', '很']);
});

test('English commas and physical newlines create equivalent regex branches', async () => {
  const source = '他死死地抓住杯子，语气极其冷淡。';
  for (const find of ['死死地?, 极其', '死死地?\n极其']) {
    const round = await revise(source, make(find));
    assert.equal(round.expected, '他抓住杯子，语气冷淡。');
    assert.deepEqual(parseRegexes(find, true).map(regex => regex.source), ['死死地?', '极其']);
  }
  const captures = await revise('不是害怕。并非担心。', make('不是([^。]+)\n并非([^。]+)', '$1'));
  assert.equal(captures.expected, '害怕。担心。');
});

test('regex punctuation is never split; word-list shortcut can be bypassed with a regex literal', async () => {
  for (const find of ['a{1,3}', '[a,b]+', '(a,b)', 'a\\,b', '/a,b/g', '甲，乙']) {
    assert.equal(parseRegex(find, true).source, parseRegex(find).source);
  }
  assert.equal((await revise('a,b a b', make('/a,b/g', '词'))).expected, '词 a b');
  assert.equal((await revise('甲，乙', make('甲，乙', '丙'))).expected, '丙');
  assert.deepEqual(splitRegexBranches(String.raw`a\,b`), [String.raw`a\,b`]);
  assert.deepEqual(splitRegexBranches('a{1,3}, [a,b]+, (a,b), 末尾'), ['a{1,3}', '[a,b]+', '(a,b)', '末尾']);
  assert.equal(parseRegex('/a,b/g', true).source, 'a,b');
  assert.throws(() => parseRegexes('/a,b/z', true), /正则表达式无效/);
});

test('complete regex branches may be separated by commas or newlines without swallowing later rules', async () => {
  for (const separator of [', ', '\n', '\r\n']) {
    const find = `/不是([^。]+)/g${separator}/并非([^。]+)/g`;
    assert.equal((await revise('不是害怕。并非担心。', make(find, '$1'))).expected, '害怕。担心。');
    assert.deepEqual(parseRegexes(`/极其/g${separator}/极致/g`, true).map(String), ['/极其/g', '/极致/g']);
  }
  assert.equal((await revise('AAA 极其', make('/aaa/gi\n极其'))).expected, ' ');
  for (const find of ['/a,b/g', '/a\\/b/g', '/[/,]+/g', '/https:\\/\\/example\\.com/g']) {
    assert.equal(parseRegexes(find, true).length, 1);
    assert.equal(parseRegexes(find, true)[0].source, parseRegex(find).source);
  }
  assert.throws(() => parseRegexes('/甲/g\n/乙/z', true), /正则表达式无效/);
});

test('separators inside regex structures preserve the expression', () => {
  for (const find of ['(甲\n乙)', '[甲\n乙]', '/甲\n乙/g', '(?:甲,乙)', String.raw`甲\,乙`]) {
    assert.deepEqual(parseRegexes(find, true).map(r => r.source), [parseRegex(find).source]);
  }
});

test('sentence captures and comma-description patterns operate on actual text', async () => {
  assert.equal((await revise('他不是害怕，而是担心她。', make('不是([^，。！？]+)，而是([^。！？]+)', '$2'))).expected, '他担心她。');
  const find = '，(?:仿佛|像在|就像|像是|尾音|声音|带着|甚至带|指节|指尖|骨节)[^，。？！：（…—]*|，[^，。：；\\n”」…]*(?:指节|指关节|不易察|微不可|几不可|不容置|带着一)[^，。：；—\\n“？「]*';
  assert.equal((await revise('他停下脚步，仿佛在等人。他握住杯子，苍白的指节微微发白。', make(find))).expected, '他停下脚步。他握住杯子。');
});

test('whole replacement preserves commas, spaces and newlines, including a single space', async () => {
  const rule = make('(旧)', ' $1, 新\n ', { wholeReplacement: true });
  assert.equal((await revise('旧', rule)).expected, ' 旧, 新\n ');
  assert.deepEqual(simpleRule(createRuleDraft(rule), rule), rule);
  assert.equal((await revise('甲旧乙', make('旧', ' ', { wholeReplacement: true }))).expected, '甲 乙');
  assert.equal(make('旧', '', { wholeReplacement: true }).action, 'delete');
  assert.deepEqual(make('旧', '"轻轻, 缓缓", 低声').values, ['轻轻, 缓缓', '低声']);
});

test('retired rules cannot be silently edited into a different regex', () => {
  const old = { id: 'old', find: '{A}极了', kind: 'pattern', captures: { A: { type: 'word' } }, values: ['很{A}'] };
  assert.equal(isLegacyRule(old), true);
  assert.throws(() => createRuleDraft(old), /旧规则已停用/);
  const current = validateRule({ kind: 'regex', find: '甲,乙', values: ['轻轻, 缓缓'], action: 'replace', enabled: false, priority: 10 });
  const saved = simpleRule(createRuleDraft(current), current);
  assert.equal(saved.enabled, false);
  assert.equal(saved.priorityLevel, 1);
  assert.deepEqual(saved.values, ['轻轻, 缓缓']);
});

test('bulk infers deletion or replacement per line and rejects invalid rows atomically', () => {
  const rules = bulkRules('死死地?\n极其, 极致\t十分, 很\n不是(.+)，而是(.+)\t$2');
  assert.equal(rules[0].action, 'delete');
  assert.deepEqual(rules[1].values, ['十分', '很']);
  assert.deepEqual(rules[2].values, ['$2']);
  assert.throws(() => bulkRules('死死\n[\t很'), /第 2 行/);
  assert.throws(() => bulkRules('死死\n甲\t乙\t丙'), /第 2 行/);
});

test('form has always-visible find/replacement without template or action settings', () => {
  const html = renderRuleForm(createRuleDraft());
  assert.match(html, /data-rule-field="find"/);
  assert.match(html, /data-rule-field="valuesText"/);
  assert.match(html, /data-rule-choice="priorityLevel"/);
  assert.match(html, /data-rule-choice="groupId"/);
  assert.match(html, /data-rule-choice-value="2" aria-label="中" aria-pressed="true">中<\/button>/);
  assert.match(html, /tr-rule-choice-options/);
  assert.doesNotMatch(html, /data-rule-field="(?:mode|action|category|execution|captures|before|boundary|punctuation)"/);
  assert.doesNotMatch(html, /单个形容词|附加条件|句式助手|wholeReplacement|整段替换|写法示例|>测试文字</);
  assert.match(html, /留空为删除/);
  assert.doesNotMatch(html, /data-action="cancel-rule"|删除此规则/);
  assert.match(renderRuleForm(createRuleDraft(), { canDelete: true }), /data-action="delete-current-rule"/);
});

test('whole-text replacements remain editable as current regex rules', () => {
  const old = make('旧', ' $&, 保留 ', { wholeReplacement: true });
  assert.equal(isLegacyRule(old), false);
  const html = renderRuleForm(createRuleDraft(old));
  assert.match(html, /data-rule-field="valuesText"/);
});
