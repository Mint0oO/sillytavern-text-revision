import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleDraft, simpleRule, isLegacyRule, bulkRules } from '../rule-editor.js';
import { validateRule, applySelected } from '../engine.js';
import { scanPrepared } from '../scanner.js';
import { parseRegex } from '../regex-support.js';
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

test('regex punctuation is never split; word-list shortcut can be bypassed with a regex literal', async () => {
  for (const find of ['a{1,3}', '[a,b]+', '(a,b)', 'a\\,b', '/a,b/g', '甲，乙']) {
    assert.equal(parseRegex(find, true).source, parseRegex(find).source);
  }
  assert.equal((await revise('a,b a b', make('/a,b/g', '词'))).expected, '词 a b');
  assert.equal((await revise('甲，乙', make('甲，乙', '丙'))).expected, '丙');
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

test('legacy conditions remain intact and old literal/regex inputs retain their meaning on edit', async () => {
  const legacy = validateRule({ id: 'old', find: '{A}极了', kind: 'pattern', captures: { A: { type: 'word' } }, values: ['很{A}'], action: 'replace', notBefore: ['不'], priority: 10, enabled: false });
  const snapshot = structuredClone(legacy), draft = createRuleDraft(legacy);
  assert.equal(isLegacyRule(legacy), true);
  assert.deepEqual(simpleRule(draft, legacy), legacy);
  assert.deepEqual(legacy, snapshot);
  assert.match(renderRuleForm(draft), /readonly/);
  for (const [kind, find] of [['word', 'a.b'], ['word', '{A}'], ['regex', '甲,乙']]) {
    const old = validateRule({ id: 'original', kind, find, values: ['轻轻, 缓缓'], action: 'replace', enabled: false });
    const saved = simpleRule(createRuleDraft(old), old);
    assert.deepEqual(saved.values, ['轻轻, 缓缓']);
    assert.equal(saved.enabled, false);
    saved.enabled = true;
    assert.equal((await revise(find, saved)).expected, '轻轻, 缓缓');
    if (kind === 'word' && find === 'a.b') assert.equal((await revise('axb', saved)).expected, 'axb');
  }
  const dollar = validateRule({ kind: 'word', find: '旧', values: ['$&'], action: 'replace' });
  assert.equal((await revise('旧', simpleRule(createRuleDraft(dollar), dollar))).expected, '$&');
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
  assert.doesNotMatch(html, /data-rule-field="(?:mode|action|category|priority|execution|captures|before|boundary|punctuation)"/);
  assert.doesNotMatch(html, /单个形容词|附加条件|句式助手/);
});
