import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionController } from '../controller.js';
import { RevisionUI } from '../ui.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const entered = deferred(), saved = deferred();
  const ctx = {
    chatId: 'slow-save', chat: [{ is_user: false, mes: '他极其疲惫。', extra: {} }],
    chatMetadata: {}, extensionSettings: {},
    async saveChat() { entered.resolve(); await saved.promise; },
  };
  const ctl = new RevisionController(() => ctx, async () => {});
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    c: ctl, screen: 'review', panelEpoch: 1, panelTarget: ctl.captureTarget(0),
    panelRoundId: null, detecting: false, edit: null, drafts: new Map(),
    dialog: { open: true }, html: '', status: '',
    say(text) { this.status = text; },
    body(html) { this.html = html; },
    render() { this.review(); }, reviewFooter() {},
  });
  ctl.onChange = () => { if (ui.dialog.open) ui.render(); };
  return { ctx, ctl, ui, entered, saved };
}

test('manual results render before storage finishes and writes stay locked until it settles', async () => {
  const f = fixture(), pending = f.ui.detectPanelTarget();
  await f.entered.promise;
  assert.match(f.ui.html, /1处问题/);
  assert.doesNotMatch(f.ui.html, /正在检测/);
  assert.match(f.ui.status, /正在保存记录/);
  assert.equal(f.ui.detecting, false);
  assert.equal(f.ctl.busy, true);
  await assert.rejects(f.ctl.commit(f.ui.panelRound()), /正在保存/);
  await assert.rejects(f.ui.detectPanelTarget(), /正在保存/);
  await assert.rejects(f.ctl.finishReview(f.ui.panelRound()), /正在保存/);
  assert.match(f.ui.html, /1处问题/, 'a second scan cannot clear the visible result');
  f.saved.resolve();
  const round = await pending;
  assert.equal(f.ctl.busy, false);
  assert.equal(f.ui.status, '');
  assert.equal(f.ui.panelRound(), round);
  assert.equal(f.ctl.editable(round), true);
});

test('a rejected detection save keeps suggestions, reports the error and releases the lock', async () => {
  const f = fixture(), pending = f.ui.run(() => f.ui.detectPanelTarget());
  await f.entered.promise;
  f.saved.reject(new Error('模拟保存失败'));
  await pending;
  assert.equal(f.ctl.busy, false);
  assert.equal(f.ui.detecting, false);
  assert.match(f.ui.html, /1处问题/);
  assert.equal(f.ui.status, '模拟保存失败');
});

test('closing and reopening during storage cannot rebind the old panel session', async () => {
  const f = fixture(), pending = f.ui.detectPanelTarget();
  await f.entered.promise;
  f.ui.endPanelSession();
  f.ui.dialog.open = true;
  f.ui.panelTarget = f.ctl.captureTarget(0);
  f.ui.status = '新面板';
  f.saved.resolve();
  assert.equal(await pending, null);
  assert.equal(f.ctl.busy, false);
  assert.equal(f.ui.panelRoundId, null);
  assert.equal(f.ui.status, '新面板');
});

test('closing before matching completes discards the result without saving or reopening', async () => {
  const f = fixture(), pending = f.ui.detectPanelTarget();
  f.ui.endPanelSession();
  f.ui.dialog.open = false;
  assert.equal(await pending, null);
  assert.equal(f.ctl.history().length, 0);
  assert.equal(f.ui.panelRoundId, null);
  assert.equal(f.ctl.busy, false);
});

test('automatic detection still awaits storage before returning its result', async () => {
  const f = fixture();
  let returned = false;
  const pending = f.ctl.detect(0, { auto: true }).then(round => { returned = true; return round; });
  await f.entered.promise;
  assert.equal(returned, false);
  assert.equal(f.ctl.busy, true);
  f.saved.resolve();
  assert.equal((await pending).count, 1);
  assert.equal(f.ctl.busy, false);
});
