import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionController } from '../controller.js';
import { attachAutoDetection } from '../auto-detection.js';

function fixture() {
  let timer, opens = 0, panelOpen = false, rejectIncoming = false;
  const callbacks = new Map(), errors = [], openedRounds = [];
  const eventTypes = Object.fromEntries(['GENERATION_STARTED','CHARACTER_MESSAGE_RENDERED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED','CHAT_CHANGED'].map(t => [t, t]));
  const ctx = { chatId: 'demo', characterId: 0, chat: [{ mes: '他极其疲惫。', extra: {}, swipe_id: 0, swipes: ['他极其疲惫。'] }], chatMetadata: {}, extensionSettings: {}, streamingProcessor: { isFinished: false, isStopped: false }, eventTypes, eventSource: { on: (type, fn) => callbacks.set(type, fn) }, saveChat: async () => {}, saveSettingsDebounced() {} };
  const c = new RevisionController(() => ctx, async () => {});
  const ui = {
    onMainClosed: () => {},
    isMainOpen: () => panelOpen,
    async openDetected(round) { if (panelOpen && rejectIncoming) return false; opens++; openedRounds.push(round); panelOpen = true; return true; },
    say: e => errors.push(e),
    resetChat() { c.selectedId = null; panelOpen = false; },
  };
  attachAutoDetection(c, ui, { setTimeout(fn) { timer = fn; return 1; }, clearTimeout() { timer = null; } });
  return {
    ctx, c, errors, openedRounds, opens: () => opens,
    setPanelOpen(value) { panelOpen = value; },
    rejectIncoming(value) { rejectIncoming = value; },
    async closePanel() { panelOpen = false; await ui.onMainClosed(); },
    emit: (type, ...args) => callbacks.get(type)?.(...args),
    async flush() { const fn = timer; timer = null; await fn?.(); },
  };
}

test('reroll completion detects once and opens despite stale host state or missing generation-ended event', async () => {
  const f = fixture();
  f.emit('GENERATION_STARTED'); await f.flush(); assert.equal(f.c.history().length, 0);
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 1); assert.equal(f.opens(), 1);
  f.emit('GENERATION_ENDED'); f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 1); assert.equal(f.opens(), 1);
  await f.closePanel();
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
  await f.closePanel();
  f.c.settings().autoScan = false; f.ctx.chat[0].mes = '极其安静'; f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 1);
  f.c.settings().autoScan = true; f.ctx.chat[0].mes = '他睡着了。'; f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.current().count, 0); assert.equal(f.opens(), 1);
});

test('global plugin switch suppresses automatic detection', async () => {
  const f = fixture();
  f.c.settings().enabled = false;
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 0); assert.equal(f.opens(), 0);
  f.c.settings().enabled = true;
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.c.history().length, 1); assert.equal(f.opens(), 1);
});

test('fully automatic rules save quietly once, and a higher-priority review overlap remains visible', async () => {
  const f = fixture();
  let saves = 0;
  f.ctx.saveChat = async () => { saves++; };
  f.ctx.updateMessageBlock = () => {}; f.ctx.eventSource.emit = async () => {};
  f.c.settings().rules = [{ id: 'auto', kind: 'regex', find: '/极其/g', action: 'delete', remove: true, execution: 'auto' }];
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.ctx.chat[0].mes, '他疲惫。'); assert.equal(f.opens(), 0);
  assert.equal(f.c.current().reviewed, true); assert.equal(f.c.current().log.length, 1);
  assert.equal(saves, 1, 'automatic detection plus body changes must use one save');
  f.emit('GENERATION_ENDED'); await f.flush(); assert.equal(f.c.history().length, 1);
  f.ctx.chat[0].mes = '他极其紧张。';
  f.c.settings().rules.push({ id: 'conflict', kind: 'regex', find: '极其', action: 'review', values: [], priority: 10 });
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(f.ctx.chat[0].mes, '他极其紧张。'); assert.equal(f.opens(), 1); assert.deepEqual(f.errors, []);
  assert.equal(saves, 2, 'a review-only detection saves its record once');
});

test('automatic review opens before a slow record save and closing it cannot cause a late reopen', async () => {
  const f = fixture();
  let release, entered;
  const saving = new Promise(resolve => { entered = resolve; });
  f.ctx.saveChat = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  f.emit('CHARACTER_MESSAGE_RENDERED', 0);
  const pending = f.flush();
  await saving;
  assert.equal(f.opens(), 1);
  assert.equal(f.c.busy, false);
  await f.closePanel();
  release(); await pending;
  assert.equal(f.opens(), 1);
  assert.deepEqual(f.errors, []);
});

test('real generation cancels an active scan silently even when text and settings have not changed', async () => {
  const f = fixture(), text = f.ctx.chat[0].mes;
  f.emit('CHARACTER_MESSAGE_RENDERED', 0);
  const pending = f.flush();
  f.emit('GENERATION_STARTED', 'normal', {}, false);
  await pending;
  assert.equal(f.ctx.chat[0].mes, text);
  assert.equal(f.c.history().length, 0);
  assert.deepEqual(f.errors, []);
});

test('dry-run and quiet generation notifications do not cancel visible reply detection', async () => {
  for (const [type, dryRun] of [['normal', true], ['quiet', false]]) {
    const f = fixture();
    f.emit('CHARACTER_MESSAGE_RENDERED', 0);
    const pending = f.flush();
    f.emit('GENERATION_STARTED', type, {}, dryRun);
    await pending;
    assert.equal(f.c.history().length, 1);
    assert.equal(f.opens(), 1);
    assert.deepEqual(f.errors, []);
  }
});

test('an uncertain automatic save blocks retries until confirmation', async () => {
  const f = fixture();
  let saves = 0;
  f.ctx.saveChat = async () => { saves++; throw new Error('写入失败'); };
  f.ctx.updateMessageBlock = () => {}; f.ctx.eventSource.emit = async () => {};
  f.c.settings().rules = [{ id:'auto', kind:'regex', find:'极其', action:'delete', remove:true, execution:'auto' }];
  f.emit('CHARACTER_MESSAGE_RENDERED', 0); await f.flush();
  assert.equal(saves, 1);
  assert.equal(f.ctx.chat[0].mes, '他疲惫。');
  assert.equal(f.c.pendingSave.status, 'unconfirmed');
  assert.equal(f.c.current().log?.length ?? 0, 1);
  assert.equal(f.c.busy, false);
  assert.match(f.errors[0], /未能确认保存/);
  f.ctx.saveChat = async () => { saves++; };
  f.emit('GENERATION_ENDED'); await f.flush();
  assert.equal(saves, 1);
  assert.equal(f.ctx.chat[0].mes, '他疲惫。');
});

test('an open panel defers one latest reply until close, then reveals even a clean result once', async () => {
  const f = fixture();
  f.setPanelOpen(true);
  const text = '这是一条干净的新回复。';
  f.ctx.chat.push({ mes: text, extra: {}, swipe_id: 0, swipes: [text] });
  f.emit('CHARACTER_MESSAGE_RENDERED', 1, 'normal');
  f.emit('GENERATION_ENDED');
  await f.flush();
  assert.equal(f.c.history().length, 0);
  assert.equal(f.opens(), 0);
  await f.closePanel();
  await f.flush();
  assert.equal(f.c.history().length, 1);
  assert.equal(f.openedRounds[0].messageId, 1);
  assert.equal(f.openedRounds[0].count, 0);
  assert.equal(f.opens(), 1);
  await f.closePanel();
  f.emit('GENERATION_ENDED');
  await f.flush();
  assert.equal(f.opens(), 1, 'a repeated completion notification must not reopen the same result');
});

test('turning off automatic detection or changing chat discards the deferred reply', async () => {
  for (const cancel of [
    f => { f.c.settings().autoScan = false; },
    f => { f.ctx.chatId = 'other'; f.emit('CHAT_CHANGED'); },
  ]) {
    const f = fixture();
    f.setPanelOpen(true);
    const text = '他极其安静。';
    f.ctx.chat.push({ mes: text, extra: {}, swipe_id: 0, swipes: [text] });
    f.emit('CHARACTER_MESSAGE_RENDERED', 1, 'normal');
    cancel(f);
    await f.closePanel();
    await f.flush();
    assert.equal(f.c.history().length, 0);
    assert.equal(f.opens(), 0);
  }
});

test('historical renders do not scan, and deleting an earlier message keeps a deferred target by identity', async () => {
  const f = fixture();
  const latestText = '他极其安静。';
  f.ctx.chat.push({ mes: latestText, extra: {}, swipe_id: 0, swipes: [latestText] });
  f.emit('CHARACTER_MESSAGE_RENDERED', 0, 'normal');
  await f.flush();
  assert.equal(f.c.history().length, 0, 'a non-latest rendered message is history, not a completion target');
  f.setPanelOpen(true);
  f.emit('CHARACTER_MESSAGE_RENDERED', 1, 'normal');
  const target = f.ctx.chat[1];
  f.ctx.chat.shift();
  f.emit('MESSAGE_DELETED');
  await f.closePanel();
  await f.flush();
  assert.equal(f.c.history().length, 1);
  assert.equal(f.c.history()[0].messageId, 0);
  assert.equal(f.ctx.chat[0], target);
});

test('a manual panel opened during post-close detection is not overwritten, and the finished result is shown after it closes', async () => {
  const f = fixture();
  f.setPanelOpen(true);
  const text = '补检回复极其安静。';
  f.ctx.chat.push({ mes: text, extra: {}, swipe_id: 0, swipes: [text] });
  f.emit('CHARACTER_MESSAGE_RENDERED', 1, 'normal');
  await f.closePanel();
  let release;
  const detect = f.c.detect.bind(f.c);
  f.c.detect = async (...args) => { await new Promise(resolve => { release = resolve; }); return detect(...args); };
  const flushing = f.flush();
  await Promise.resolve();
  f.setPanelOpen(true);
  f.rejectIncoming(true);
  release();
  await flushing;
  assert.equal(f.opens(), 0);
  assert.equal(f.c.history().length, 1);
  await f.closePanel();
  assert.equal(f.opens(), 1);
  assert.equal(f.openedRounds[0].messageId, 1);
  assert.equal(f.c.history().length, 1, 'showing a retained result must not run or apply it again');
});
