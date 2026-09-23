import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionController, isDetectionCancelled } from '../controller.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture() {
  const started = deferred(), gate = deferred();
  const writes = [];
  const ctx = {
    chatId:'queue', chat:[{mes:'他极其疲惫。',extra:{}},{mes:'她极其紧张。',extra:{}}],
    chatMetadata:{},extensionSettings:{},
    eventTypes:{MESSAGE_EDITED:'edited',MESSAGE_UPDATED:'updated'},eventSource:{async emit(){}},updateMessageBlock(){},
    async saveChat() { writes.push(ctx.chat.map(m=>m.mes)); if (writes.length === 1) { started.resolve(); await gate.promise; } },
  };
  const c = new RevisionController(()=>ctx, async (context, round, text)=>assert.equal(writes.at(-1)[round.messageId], text));
  return {ctx,c,writes,started,gate};
}

test('applying while a record save is pending queues one body write and blocks duplicate apply', async () => {
  const f = fixture(), detection = f.c.detect(0);
  await f.started.promise;
  assert.equal(f.c.busy, false);
  const applying = f.c.commit(f.c.current());
  assert.equal(f.c.busy, true);
  await assert.rejects(f.c.commit(f.c.current()), /正在保存/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.ctx.chat[0].mes,'他极其疲惫。');
  f.gate.resolve(); await detection; await applying;
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1][0], '他疲惫。');
  assert.equal(f.c.busy, false);
});

test('queued apply revalidates the message and never rolls back an external edit equal to its proposal', async () => {
  const f = fixture(), detection = f.c.detect(0);
  await f.started.promise;
  const applying = f.c.commit(f.c.current());
  const rejected = assert.rejects(applying, /已变化/);
  f.ctx.chat[0].mes = '他疲惫。';
  f.ctx.chat[0].extra.external = true;
  f.gate.resolve(); await detection; await rejected;
  assert.equal(f.writes.length, 1);
  assert.equal(f.ctx.chat[0].mes,'他疲惫。');
  assert.equal(f.ctx.chat[0].extra.external,true);
  assert.equal(f.c.busy, false);
});

test('queued writes cannot save to a different chat after a switch', async () => {
  const f = fixture(), first = f.c.persistDraft();
  await f.started.promise;
  const queued = f.c.persistDraft(), rejected = assert.rejects(queued,isDetectionCancelled);
  f.ctx.chatId = 'another';
  f.gate.resolve(); await assert.rejects(first, isDetectionCancelled); await rejected;
  assert.equal(f.writes.length,1);
});

test('a failed record save does not poison the next write', async () => {
  const f = fixture(), first = f.c.persistDraft(), failed = assert.rejects(first,/记录保存失败/);
  await f.started.promise;
  const next = f.c.persistDraft();
  f.gate.reject(new Error('记录保存失败'));
  await failed; await next;
  assert.equal(f.writes.length,2);
});

test('parallel detections for separate floors retain both records', async () => {
  const f = fixture();
  const rounds = await Promise.all([f.c.detect(0,{persist:false}), f.c.detect(1,{persist:false})]);
  assert.equal(f.c.history().length,2);
  assert.deepEqual(f.c.history().map(r=>r.number),[1,2]);
  assert.deepEqual(new Set(rounds.map(r=>r.messageId)),new Set([0,1]));
});

test('a newer scan of the same floor silently supersedes the older scan', async () => {
  const f = fixture();
  const old = f.c.detect(0,{persist:false}), cancelled = assert.rejects(old,isDetectionCancelled);
  const newer = f.c.detect(0,{persist:false});
  await cancelled; await newer;
  assert.equal(f.c.history().length,1);
});

test('canceling one floor scan does not cancel another floor', async () => {
  const f = fixture(), controller = new AbortController();
  const first = f.c.detect(0,{persist:false,signal:controller.signal}), cancelled = assert.rejects(first,isDetectionCancelled);
  const other = f.c.detect(1,{persist:false});
  controller.abort();
  await cancelled; const round = await other;
  assert.equal(round.messageId,1);
  assert.equal(f.c.history().length,1);
});
