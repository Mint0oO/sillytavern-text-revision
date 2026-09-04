import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionController, KEY, verifyChatSave } from '../controller.js';

function fixture() {
  let disk, fails = false, renders = 0;
  const ctx = { chatId: 'sample', characterId: 0, groupId: null, chat: [{ is_user: false, mes: '你极其疲惫。空位极具吸引力。', swipe_id: 1, swipes: ['另一个版本。', '你极其疲惫。空位极具吸引力。'], extra: { token_count: 42 } }], chatMetadata: {}, extensionSettings: {}, eventTypes: { MESSAGE_EDITED: 'edited', MESSAGE_UPDATED: 'updated' }, eventSource: { async emit() {} }, updateMessageBlock() { renders++; }, saveSettingsDebounced() {}, async saveChat() { if (!fails) disk = structuredClone(ctx.chat); } };
  const ctl = new RevisionController(() => ctx, async (c, r, text) => { assert.equal(disk[r.messageId].mes, text, 'server did not persist content'); });
  return { ctx, ctl, disk: () => disk, fail: () => { fails = true; }, renders: () => renders };
}
test('confirmed changes write saved chat and selected swipe; reload and undo retain original text', async () => {
  const f = fixture(); const r = await f.ctl.detect();
  r.groups[1].selected = false;
  await f.ctl.commit(r);
  assert.equal(f.ctx.chat[0].mes, '你疲惫。空位极具吸引力。');
  assert.equal(f.disk()[0].mes, f.ctx.chat[0].mes);
  assert.deepEqual(f.ctx.chat[0].swipes, ['另一个版本。', f.ctx.chat[0].mes]);
  assert.equal(f.ctx.chat[0].extra.token_count, undefined);
  const reload = new RevisionController(() => f.ctx, async () => {});
  assert.equal(reload.current().count, 2);
  await f.ctl.commit(r, { undo: true });
  assert.equal(f.disk()[0].mes, '你极其疲惫。空位极具吸引力。');
  assert.equal(r.undo, null);
});
test('external edit, switched swipe and switched chat are rejected before writes', async () => {
  for (const change of [f => { f.ctx.chat[0].mes = '手动改过'; }, f => { f.ctx.chat[0].swipe_id = 0; }, f => { f.ctx.chatId = 'other'; }]) {
    const f = fixture(); const r = await f.ctl.detect(); change(f); const before = structuredClone(f.ctx.chat);
    await assert.rejects(f.ctl.commit(r)); assert.deepEqual(f.ctx.chat, before); assert.equal(f.renders(), 0);
  }
});
test('save failure cannot report success and keeps proposed edits available for retry', async () => {
  const f = fixture(); const r = await f.ctl.detect(); const original = f.ctx.chat[0].mes; f.fail();
  await assert.rejects(f.ctl.commit(r), /未能确认保存/);
  assert.equal(f.ctx.chat[0].mes, original); assert.equal(r.expected, original);
  assert.ok(r.groups[0].selected); assert.equal(f.ctl.busy, false);
});
test('round counts survive apply/rescan; auto events deduplicate and old rounds are read-only', async () => {
  const f = fixture(); const first = await f.ctl.detect();
  assert.equal(await f.ctl.detect(0, { auto: true }), null);
  await f.ctl.commit(first);
  const second = await f.ctl.detect();
  assert.equal(first.count, 2); assert.equal(second.count, 0); assert.equal(second.number, 2);
  assert.equal(f.ctl.editable(first), false);
  assert.equal(f.ctx.chatMetadata[KEY].rounds.length, 2);
});
test('in-flight generation cannot scan or apply', async () => {
  const f = fixture(); const r = await f.ctl.detect(); f.ctl.generating = true;
  await assert.rejects(f.ctl.detect(), /输出结束/); await assert.rejects(f.ctl.commit(r), /输出结束/);
});
test('server readback distinguishes group and character chats and checks swipe body', async t => {
  const f = fixture(); const r = await f.ctl.detect();
  f.ctx.characters = [{ name: '测试角色', avatar: 'sample.png' }]; f.ctx.getRequestHeaders = () => ({ 'Content-Type': 'application/json' });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => { calls.push([url, JSON.parse(opts.body)]); return { ok: true, json: async () => [{ chat_metadata: {} }, ...f.disk()] }; });
  await verifyChatSave(f.ctx, r, f.ctx.chat[0].mes);
  assert.equal(calls[0][0], '/api/chats/get'); assert.equal(calls[0][1].avatar_url, 'sample.png');
  f.ctx.groupId = 'group1'; await verifyChatSave(f.ctx, r, f.ctx.chat[0].mes);
  assert.deepEqual(calls[1], ['/api/chats/group/get', { id: 'sample' }]);
});
