import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceSpans } from '../sentences.js';
import { scan, DEFAULT_RULES, applySelected, proposal } from '../engine.js';

const screenshotSentence = 'Mint两条腿在他胸前乱蹬，企图挣脱那条像铁条一样箍着她双腿的胳膊，“Let me go, you big idiot, I\'m tired!”';
test('screenshot reproduction attaches preceding bracket and final quotation mark to their own sentences', () => {
  const source = '（前一句。） ' + screenshotSentence;
  const r = scan(source, DEFAULT_RULES);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].original, screenshotSentence);
  assert.equal(source.slice(r.groups[0].start, r.groups[0].end), screenshotSentence);
  applySelected(r);
  assert.equal(r.expected, source.replace('像铁条一样', ''));
  assert.equal(r.undo.text, source);
});

test('nested closing marks, repeated punctuation and spaces stay with the preceding sentence', () => {
  const cases = [
    ['（“极其疲惫？！”）  他极其担心。', ['（“极其疲惫？！”）', '他极其担心。']],
    ['(极其疲惫! ) 他极其担心。', ['(极其疲惫! )', '他极其担心。']],
    ['「极其疲惫。」『极其不安。』', ['「极其疲惫。」', '『极其不安。』']],
    ['"极其疲惫!" "极其担心?"', ['"极其疲惫!"', '"极其担心?"']],
    ["'I\'m 极其 tired!' 他极其担心。", ["'I\'m 极其 tired!'", '他极其担心。']],
    ['前一句。"他极其疲惫。"', ['前一句。', '"他极其疲惫。"']],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual([...sentenceSpans(source)].map(s => s.text), expected);
    const r = scan(source, DEFAULT_RULES); applySelected(r);
    assert.equal(r.expected, source.replaceAll('极其', ''));
  }
});

test('English periods and ellipses split sentences without splitting decimals or common titles', () => {
  const source = 'Dr. Smith很累。数值3.14极其准确。"I am 极其 tired." Next极其简短...好了。';
  assert.deepEqual([...sentenceSpans(source)].map(s => s.text), ['Dr. Smith很累。', '数值3.14极其准确。', '"I am 极其 tired."', 'Next极其简短...', '好了。']);
  assert.deepEqual([...sentenceSpans('极其疲惫……下一句。')].map(s => s.text), ['极其疲惫……', '下一句。']);
  assert.equal(proposal(scan('他像风一样."', DEFAULT_RULES).groups[0]), '他像风一样."');
});

test('orphan closers and whitespace remain untouched outside editable segments', () => {
  for (const source of ['） 他极其疲惫。', '前一句。\n） 他极其疲惫。”', '<content>） 他极其疲惫。</content>']) {
    const r = scan(source, DEFAULT_RULES);
    assert.ok(!r.groups[0].original.startsWith('）'));
    applySelected(r); assert.equal(r.expected, source.replace('极其', ''));
  }
  const source = '<content>（前一句。） <status>别改！</status>他说：“极其疲惫！”</content>';
  const r = scan(source, DEFAULT_RULES, { scope: { extractTags: ['content'], excludeTags: ['status'] } });
  assert.equal(r.groups[0].original, '他说：“极其疲惫！”');
  Object.assign(r.groups[0], { manual: true, draft: '他说：“很累！”', selected: true });
  applySelected(r);
  assert.equal(r.expected, '<content>（前一句。） <status>别改！</status>他说：“很累！”</content>');
});

test('editing one quoted sentence preserves every neighboring byte and closing mark', () => {
  const source = '(之前。) "他极其疲惫!"  「她极其担心？」';
  const r = scan(source, DEFAULT_RULES);
  assert.deepEqual(r.groups.map(g => g.original), ['"他极其疲惫!"', '「她极其担心？」']);
  r.groups[0].selected = false;
  Object.assign(r.groups[1], { manual: true, draft: '「她很担心？」', selected: true });
  applySelected(r);
  assert.equal(r.expected, '(之前。) "他极其疲惫!"  「她很担心？」');
});
