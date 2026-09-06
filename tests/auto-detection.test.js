import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionController } from '../controller.js';
import { attachAutoDetection } from '../auto-detection.js';

function fixture() {
  let timer, opens = 0;
  const callbacks = new Map(), errors = [];
  const eventTypes = Object.fromEntries(['GENERATION_STARTED','CHARACTER_MESSAGE_RENDERED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED','CHAT_CHANGED'].map(t => [t, t]));
  const ctx = { chatId: 'demo', characterId: 0, chat: [{ mes: '他极其疲惫。', extra: {}, swipe_id: 0, swipes: ['他极其疲惫。'] }], chatMetadata: {}, extensionSettings: {}, streamingProcessor: { isFinished: false, isStopped: false }, eventTypes, eventSource: { on: (type, fn) => callbacks.set(type, fn) }, saveChat: async () => {}, saveSettingsDebounced() {} };
  const c = new RevisionController(() => ctx, async () => {});
  const ui = { async openDetected() { opens++; }, say: e => errors.push(e), resetChat() { c.selectedId = null; } };
  attachAutoDetection(c, ui, { setTimeout(fn) { timer = fn; return 1; }, clearTimeout() { timer = null; } });
  return { ctx, c, errors, opens: () => opens, emit: (type, ...args) => callbacks.get(type)?.(...args), async flush() { const fn = timer; timer = null; await fn?.(); } };
}

test('reroll completion detects once and opens despite stale host state or missing generation-ended event', async () => {
  const f = fixture();
  f.emit('GENERATION_STARTED'); await f.flush(); assert.equal(f.c.history().length, 0);
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 1); assert.equal(f.opens(), 1);
  f.emit('GENERATION_ENDED'); f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 1); assert.equal(f.opens(), 1);
  f.emit('GENERATION_STARTED');
  Object.assign(f.ctx.chat[0], { mes: '他极其安静。', swipe_id: 1, swipes: ['他极其疲惫。', '他极其安静。'] });
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 2); assert.equal(f.opens(), 2); assert.deepEqual(f.errors, []);
});

test('new generation cancels pending scans and new unsaved swipe waits for completion', async () => {
  const f = fixture(); f.emit('CHARACTER_MESSAGE_RENDERED', 0); f.emit('GENERATION_STARTED'); await f.flush();
  assert.equal(f.c.history().length, 0);
  f.ctx.chat[0].swipe_id = 1; f.emit('MESSAGE_SWIPED', 0); await f.flush();
  assert.equal(f.c.history().length, 0);
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush(); assert.equal(f.c.history().length, 1);
});

test('chat changes and source changes cancel queued snapshots', async () => {
  const f = fixture(); f.emit('CHARACTER_MESSAGE_RENDERED', 0); f.ctx.chatId = 'other'; f.emit('CHAT_CHANGED'); await f.flush();
  assert.equal(f.opens(), 0); assert.equal(f.c.history().length, 0);
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); f.ctx.chat[0].mes += '仍在变化'; await f.flush();
  assert.equal(f.c.history().length, 0);
});

test('busy saves defer a scan; disabled auto-scan and clean output do not open the panel', async () => {
  const f = fixture(); f.c.busy = true; f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 0); f.c.busy = false; await f.flush(); assert.equal(f.opens(), 1);
  f.c.settings().autoScan = false; f.ctx.chat[0].mes = '极其安静'; f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 1);
  f.c.settings().autoScan = true; f.ctx.chat[0].mes = '他睡着了。'; f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.current().count, 0); assert.equal(f.opens(), 1);
});

test('fully automatic rules save quietly once, and a higher-priority review overlap remains visible', async () => {
  const f = fixture();
  f.ctx.updateMessageBlock = () => {}; f.ctx.eventSource.emit = async () => {};
  f.c.settings().rules = [{ id: 'auto', kind: 'regex', find: '/极其/g', action: 'delete', remove: true, execution: 'auto' }];
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.ctx.chat[0].mes, '他疲惫。'); assert.equal(f.opens(), 0);
  assert.equal(f.c.current().reviewed, true); assert.equal(f.c.current().log.length, 1);
  f.emit('GENERATION_ENDED'); await f.flush(); assert.equal(f.c.history().length, 1);
  f.ctx.chat[0].mes = '他极其紧张。';
  f.c.settings().rules.push({ id: 'conflict', kind: 'word', find: '极其', action: 'replace', values: ['很'], priority: 10 });
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.ctx.chat[0].mes, '他极其紧张。'); assert.equal(f.opens(), 1); assert.deepEqual(f.errors, []);
});
