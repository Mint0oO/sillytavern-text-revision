import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureLanguage, analyzeWords } from '../language.js';
import { DEFAULT_RULES, scan, proposal, applySelected, inlineHTML, validateRule } from '../engine.js';

await ensureLanguage();
const revise = (text, rules = DEFAULT_RULES, options) => {
  const round = scan(text, rules, options); applySelected(round); return round.expected;
};
const pattern = (find, captures, value = '很{A}', extra = {}) => ({ find, kind: 'pattern', captures, values: [value], action: 'replace', ...extra });

test('real bundled Jieba separates subjects, accepts ordinary words, and preserves Unicode offsets', () => {
  for (const [source, result] of [
    ['他高兴极了。', '他很高兴。'], ['她开心极了。', '她很开心。'],
    ['他累极了。', '他很累。'], ['这个地方漂亮极了。', '这个地方很漂亮。'],
    ['😀他高兴极了。', '😀他很高兴。'], ['他喜欢极了。', '他很喜欢。'],
  ]) assert.equal(revise(source), result);
  const group = scan('😀他高兴极了。', DEFAULT_RULES).groups[0];
  assert.deepEqual(group.matches[0].captures, { '{A}': '高兴' });
  assert.equal(group.matches[0].old, '高兴极了');
  const words = analyzeWords('😀他高兴极了。');
  for (const w of words) assert.equal('😀他高兴极了。'.slice(w.start, w.end), w.word);
});

test('optional POS filters and explicit supplements use the actual dictionary instead of invented tags', () => {
  const rule = pattern('{A}极了', { A: { type: 'adjective' } });
  assert.equal(revise('他漂亮极了。她喜欢极了。', [rule]), '他很漂亮。她喜欢极了。');
  assert.equal(revise('他高兴极了。', [rule]), '他高兴极了。'); // upstream tags 高兴 as b
  rule.captures.A.words = ['高兴'];
  assert.equal(revise('他高兴极了。', [rule]), '他很高兴。');
  const noun = pattern('拿起{A}', { A: { type: 'noun' } }, '{A}');
  assert.equal(revise('他拿起书包。', [noun]), '他书包。'); // author chooses semantics
  const verb = pattern('极度{A}', { A: { type: 'verb' } }, '{A}');
  assert.equal(revise('他极度渴望。', [verb]), '他渴望。');
  const adv = pattern('{A}走', { A: { type: 'adverb', words: ['悄悄'] } }, '走');
  assert.equal(revise('他悄悄走。', [adv]), '他走。');
});

test('extreme default preserves complete words and skips configurable negation/degree exceptions', () => {
  for (const s of ['积极回应，极限，极光，南极。', '他高兴极了不起。', '他不高兴极了。', '他很高兴极了。']) assert.equal(revise(s), s);
  const rule = { ...DEFAULT_RULES.at(-1), notBefore: [] };
  assert.equal(revise('他不高兴极了。', [rule]), '他不很高兴。');
});

test('comma deletion is part of preview and apply; replacement and pending choices retain punctuation', () => {
  const source = '然后像个犯了错的新兵一样，贴着墙根往旁边挪。';
  const r = scan(source, DEFAULT_RULES), g = r.groups[0];
  assert.equal(proposal(g), '然后贴着墙根往旁边挪。');
  assert.match(inlineHTML(g), /<del>像个犯了错的新兵一样，<\/del>/);
  assert.equal(revise('他，像个新兵一样，贴着墙根走。'), '他，贴着墙根走。');
  assert.equal(revise('然后像个新兵一样 ,  贴着墙根走。'), '然后贴着墙根走。');
  const rule = { ...DEFAULT_RULES[3], values: ['小心地'], action: 'replace' };
  const changed = scan(source, [rule]).groups[0];
  assert.equal(proposal(changed), '然后小心地，贴着墙根往旁边挪。');
  changed.matches[0].value = ''; assert.equal(proposal(changed), '然后贴着墙根往旁边挪。');
  changed.matches[0].value = null; assert.equal(proposal(changed), source);
  applySelected(r); assert.equal(r.expected, '然后贴着墙根往旁边挪。'); assert.equal(r.undo.text, source);
});

test('punctuation never crosses protected markup, sentence ends, or lines', () => {
  for (const s of ['他像新兵一样。下一句。', '他像新兵一样\n，下一行。', '他像新兵一样<span>，下一段。</span>']) assert.equal(revise(s), s);
  const source = '<think>他高兴极了。</think><content>😀他高兴极了。</content><status>他高兴极了。</status>';
  assert.equal(revise(source, DEFAULT_RULES, { scope: { extractTags: ['content'] } }), '<think>他高兴极了。</think><content>😀他很高兴。</content><status>他高兴极了。</status>');
  assert.equal(revise('像风一样。', [{ ...DEFAULT_RULES[3], reviewAtEnd: false }]), '。');
});

test('context filters and priority let specific rules win without applying the fallback again', () => {
  const fallback = { find: '极度', values: ['很'], action: 'replace' };
  const targeted = { find: '极度', after: ['渴望', '恐惧'], values: ['深深地'], action: 'replace', priority: 10 };
  assert.equal(revise('他极度渴望休息，极度疲惫。', [fallback, targeted]), '他深深地渴望休息，很疲惫。');
  assert.equal(revise('他极度渴望。她极度渴望。', [{ ...targeted, before: ['他'] }]), '他深深地渴望。她极度渴望。');
  const ex = { ...fallback, exceptions: ['极度疲惫'] };
  assert.equal(revise('极度疲惫，极度兴奋。', [ex]), '极度疲惫，很兴奋。');
  const overlap = scan('极度渴望。', [fallback, { ...targeted, priority: 0 }]);
  assert.equal(overlap.groups[0].selected, false);
});

test('A/B/C captures can be retained or reordered; explicit word lists need no analyzer', () => {
  const rule = pattern('{A}对{B}说{C}', { A: { type: 'list', words: ['他'] }, B: { type: 'list', words: ['她'] }, C: { type: 'text' } }, '{B}听{A}说{C}');
  const round = scan('他对她说你好。', [rule], { analyze: () => { throw new Error('should not analyze'); } });
  assert.equal(proposal(round.groups[0]), '她听他说你好。');
  assert.throws(() => validateRule(pattern('{A}极了', {})), /开头的占位符/);
  assert.throws(() => validateRule(pattern('{A}极了', { A: { type: 'list' } })), /允许词/);
  assert.throws(() => validateRule({ find: '词', priority: -1 }), /优先级/);
});
