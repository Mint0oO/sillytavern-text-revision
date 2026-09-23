import test from 'node:test';
import assert from 'node:assert/strict';
import { boundHistory, compactRound, migrateRounds, restoreBase, restoreUndoGroups, textKey, upsertRound, utf8Bytes } from '../history-store.js';

const record = (floor, version = 1, time = floor) => ({
  id: `${floor}-${version}-${time}`, messageUid: `floor-${floor}`, versionKey: `source-${version}`,
  version, time, touchedAt: time, count: 1, base: '原句', expected: '原句',
  groups: [{ id: 0, original: '原句', matches: [{ id: 0, old: '原', value: '新', options: Array(20).fill('很长的候选文本'), captures: { A: '原' } }] }],
  log: [{ before: '原', after: '新', operationId: `${floor}-${version}` }],
});

test('candidate collections are absent from persisted rounds and UTF-8 measures Chinese bytes', () => {
  const source = record(1), compact = compactRound(source);
  assert.deepEqual(compact.groups[0].matches[0].options, ['新']);
  assert.equal(compact.groups[0].matches[0].captures, undefined);
  assert.equal(compact.base, undefined);
  assert.equal(compact.expected, undefined);
  assert.equal(compact.baseKey, textKey('原句'));
  assert.equal(compact.expectedKey, textKey('原句'));
  assert.equal(source.groups[0].matches[0].options.length, 20);
  assert.ok(utf8Bytes(compact) < utf8Bytes(source) / 2);
  assert.equal(utf8Bytes('中'), 5);
});

test('the original reply is reconstructed only from a matching current body', () => {
  const base = '前文。甲乙。结尾。';
  const expected = '前文。甲乙丙。结尾。';
  const groups = [{ start: 3, end: 6, original: '甲乙。', applied: '甲乙丙。' }];
  assert.equal(restoreBase(expected, groups, textKey(base)), base);
  assert.equal(restoreBase('前文。外部修改。结尾。', groups, textKey(base)), null);
  assert.equal(restoreBase(expected, groups, textKey('另一条回复')), null);
});

test('undo persistence stores only changed match state and reconstructs it', () => {
  const source = record(1);
  source.groups[0].matches[0].done = true;
  source.groups[0].matches[0].appliedValue = '新';
  source.groups[0].applied = '新句';
  source.undo = { text: '原句', reviewed: false, groups: structuredClone(source.groups) };
  source.undo.groups[0].matches[0].done = false;
  source.undo.groups[0].matches[0].appliedValue = undefined;
  source.undo.groups[0].applied = null;
  const compact = compactRound(source);
  assert.equal(compact.undo.text, undefined);
  assert.equal(compact.undo.groups, undefined);
  assert.equal(compact.undo.patches.length, 1);
  const restored = restoreUndoGroups(compact.groups, compact.undo.patches);
  assert.equal(restored[0].applied, null);
  assert.equal(restored[0].matches[0].done, false);
});

test('eleventh floor becomes log only and the hundredth evicts the oldest floor', () => {
  const firstEleven = boundHistory(Array.from({ length: 11 }, (_, i) => record(i + 1)));
  assert.equal(firstEleven.filter(r => !r.logOnly).length, 10);
  assert.equal(firstEleven.find(r => r.messageUid === 'floor-1').groups.length, 0);
  assert.equal(firstEleven.find(r => r.messageUid === 'floor-1').log.length, 1);
  const hundred = boundHistory(Array.from({ length: 100 }, (_, i) => record(i + 1)));
  assert.equal(new Set(hundred.map(r => r.messageUid)).size, 99);
  assert.equal(hundred.some(r => r.messageUid === 'floor-1'), false);
});

test('two versions of one floor share quota and repeated detection keeps its edit log', () => {
  const prior = record(1, 1, 1), second = record(1, 2, 2);
  let history = boundHistory([prior, second, ...Array.from({ length: 9 }, (_, i) => record(i + 2, 1, i + 3))]);
  assert.equal(history.filter(r => r.messageUid === 'floor-1').length, 2);
  assert.equal(history.filter(r => r.logOnly).length, 0);
  const replacement = { ...record(1, 1, 12), log: [] };
  history = upsertRound(history, replacement);
  assert.equal(history.filter(r => r.messageUid === 'floor-1').length, 2);
  assert.deepEqual(history.find(r => r.versionKey === 'source-1' && r.messageUid === 'floor-1').log, prior.log);
});

test('legacy migration merges repeated runs without guessing identical independent edits', () => {
  const first = record(1, 1, 1), second = record(1, 1, 2);
  first.versionKey = second.versionKey = undefined;
  first.swipeId = second.swipeId = 0;
  second.log = [...first.log, { before: '新', after: '再新' }];
  const migrated = migrateRounds([first, second]);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].log.length, 2);
});
