import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionController, KEY, verifyChatSave } from '../controller.js';
import { DEFAULT_RULES, ENGINE_VERSION, validateRule } from '../engine.js';

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
  // Returning to an already-detected swipe selects that result without another round.
  const m = f.ctx.chat[0]; m.swipe_id = 0; m.mes = m.swipes[0];
  await f.ctl.detect(0, { auto: true });
  m.swipe_id = 1; m.mes = m.swipes[1];
  assert.equal(await f.ctl.detect(0, { auto: true }), null);
  assert.equal(f.ctl.current().id, second.id); assert.equal(f.ctl.history().length, 3);
});
test('a stale host streaming processor cannot lock completed text; changed source still prevents applying', async () => {
  const f = fixture(); f.ctx.streamingProcessor = { isFinished: false, isStopped: false };
  const r = await f.ctl.detect();
  await f.ctl.commit(r); assert.equal(f.ctx.chat[0].mes.includes('极其'), false);
  f.ctx.chat[0].mes += '新内容';
  await assert.rejects(f.ctl.commit(r), /过期/);
});

test('old tag settings migrate into editable exclusion pairs without changing their meaning', () => {
  const f = fixture();
  f.ctx.extensionSettings[KEY] = { extractTags: ['content'], excludeTags: ['status', 'think'], autoScan: false };
  const s = f.ctl.settings();
  assert.deepEqual(s.excludeRules, [{ start: '<status>', end: '</status>' }, { start: '<think>', end: '</think>' }]);
  assert.equal(s.showLauncher, false); assert.equal(s.autoScan, false);
});
test('changing extraction scope invalidates earlier suggestions and permits a fresh automatic scan', async () => {
  const f = fixture(); const r = await f.ctl.detect();
  f.ctl.settings().extractTags = ['content'];
  assert.equal(f.ctl.editable(r), false); await assert.rejects(f.ctl.commit(r), /过期/);
  const second = await f.ctl.detect(0, { auto: true });
  assert.equal(second.count, 0); assert.match(second.notice, /未找到提取标签/);
});

test('default exclusions narrow once while customized pairs and later edits are preserved', () => {
  const pairs = names => names.map(name => ({ start: `<${name}>`, end: `</${name}>` }));
  const defaults = pairs(['think', 'thinking']);
  const old = pairs(['think', 'thinking', 'reasoning', 'script', 'style']);
  const fresh = fixture();
  assert.deepEqual(fresh.ctl.settings().excludeRules, defaults);
  const upgraded = fixture();
  upgraded.ctx.extensionSettings[KEY] = { excludeRules: structuredClone(old) };
  assert.deepEqual(upgraded.ctl.settings().excludeRules, defaults);
  upgraded.ctl.settings().excludeRules = structuredClone(old);
  assert.deepEqual(upgraded.ctl.settings().excludeRules, old);
  const custom = fixture(), customPairs = [...old, { start: 'image###', end: '###' }];
  custom.ctx.extensionSettings[KEY] = { excludeRules: structuredClone(customPairs) };
  assert.deepEqual(custom.ctl.settings().excludeRules, customPairs);
});
test('v0.1.0 unscoped results stay readable but require rescanning before applying', async () => {
  const f = fixture(); const r = await f.ctl.detect(); delete r.scope;
  assert.equal(f.ctl.current().count, 2); assert.equal(f.ctl.editable(r), false);
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


test('removes the retired template once, preserves other rules and keeps launcher defaults', () => {
  const f = fixture();
  f.ctx.extensionSettings[KEY] = { rules: [
    { id: 'wolf', find: '像{A}的孤狼一样', kind: 'pattern' },
    { id: 'custom', find: '像{A}一样', kind: 'pattern' },
  ] };
  const s = f.ctl.settings();
  assert.deepEqual(s.rules.map(r => r.id), ['custom']);
  assert.equal(s.launcherTransparency, 0);
  assert.equal(s.launcherColor, 'theme');
  s.launcherColor = 'blue'; s.launcherTransparency = 45;
  assert.equal(f.ctl.settings().launcherColor, 'blue');
  assert.equal(f.ctl.settings().launcherTransparency, 45);
});

test('default rule upgrade adds word segmentation once and preserves customized/disabled rules', () => {
  const f = fixture();
  const old = structuredClone(DEFAULT_RULES.slice(0, -1));
  delete old[3].punctuation; delete old[3].boundary; old[3].enabled = false;
  f.ctx.extensionSettings[KEY] = { rules: old, ruleDefaultsVersion: 1 };
  let settings = f.ctl.settings();
  assert.equal(settings.rules[3].punctuation, 'following-comma');
  assert.equal(settings.rules[3].enabled, false);
  assert.equal(settings.rules.at(-1).find, '{A}极了');
  settings.rules.pop();
  assert.equal(f.ctl.settings().rules.length, 5);
  const customized = fixture();
  old[3].values = ['小心地']; delete old[3].punctuation;
  customized.ctx.extensionSettings[KEY] = { rules: old, ruleDefaultsVersion: 1 };
  assert.equal(customized.ctl.settings().rules[3].punctuation, undefined);
});

test('language initialization cannot attach a stale scan after chat, text, swipe or settings changes', async () => {
  for (const mutate of [
    f => { f.ctx.chatId = 'other'; }, f => { f.ctx.chat[0].mes = '新的回复'; },
    f => { f.ctx.chat[0].swipe_id = 0; }, f => { f.ctl.settings().rules[0].enabled = false; },
  ]) {
    const f = fixture(); let release;
    f.ctl.prepareLanguage = () => new Promise(resolve => { release = resolve; });
    const pending = f.ctl.detect(); mutate(f); release();
    await assert.rejects(pending, /已变化/);
    assert.equal(f.ctl.history().length, 0);
  }
});

test('language load failure preserves chat and old engine rounds require fresh detection', async () => {
  const f = fixture(), before = structuredClone(f.ctx.chat);
  f.ctl.prepareLanguage = async () => { throw new Error('加载失败'); };
  await assert.rejects(f.ctl.detect(), /加载失败/);
  assert.deepEqual(f.ctx.chat, before);
  const good = fixture(), r = await good.ctl.detect();
  assert.equal(r.engineVersion, ENGINE_VERSION); delete r.engineVersion;
  assert.equal(good.ctl.editable(r), false);
  const fresh = await good.ctl.detect(0, { auto: true });
  assert.ok(fresh); assert.equal(fresh.engineVersion, ENGINE_VERSION);
});

test('word and comma revisions persist through apply, reload and undo', async () => {
  const f = fixture(), source = '他高兴极了。然后像个新兵一样，贴着墙根走。';
  f.ctx.chat[0].mes = source; f.ctx.chat[0].swipes[1] = source;
  const r = await f.ctl.detect(); await f.ctl.commit(r);
  assert.equal(f.disk()[0].mes, '他很高兴。然后贴着墙根走。');
  const reloaded = new RevisionController(() => f.ctx, f.ctl.verifySave);
  await reloaded.commit(reloaded.current(), { undo: true });
  assert.equal(f.disk()[0].mes, source);
});

test('new rule settings trigger automatic redetection even when the original text did not change', async () => {
  const f = fixture(), first = await f.ctl.detect();
  f.ctl.settings().rules[0].enabled = false;
  const second = await f.ctl.detect(0, { auto: true });
  assert.equal(first.count, 2); assert.equal(second.count, 1);
});

test('automatic regex commit saves only allowed changes, with log, reload and undo', async () => {
  const f = fixture(), source = '他死死地抓住她，极其紧张。';
  f.ctx.chat[0].mes = source; f.ctx.chat[0].swipes[1] = source;
  f.ctl.settings().rules = [validateRule({ kind: 'regex', find: '/死死地?/g', action: 'delete', remove: true, execution: 'auto' }), DEFAULT_RULES[0]];
  const r = await f.ctl.detect(); await f.ctl.commit(r, { automatic: true });
  assert.equal(f.disk()[0].mes, '他抓住她，极其紧张。');
  assert.equal(r.reviewed, false); assert.equal(r.log[0].before, '死死地');
  const reloaded = new RevisionController(() => f.ctx, f.ctl.verifySave);
  await reloaded.commit(reloaded.current(), { undo: true });
  assert.equal(f.disk()[0].mes, source); assert.equal(r.log.length, 0);
  await f.ctl.commit(r, { automatic: true });
  await f.ctl.commit(r);
  assert.equal(f.disk()[0].mes, '他抓住她，紧张。'); assert.equal(r.reviewed, true);
  assert.equal(await f.ctl.detect(0, { auto: true }), null);
});

test('manual apply dismisses remaining suggestions while all-kept review writes no text', async () => {
  const f = fixture(), r = await f.ctl.detect(); r.groups[1].selected = false;
  await f.ctl.commit(r); assert.equal(r.reviewed, true); assert.equal(r.groups[1].matches[0].done, false);
  await f.ctl.commit(r, { undo: true }); assert.notEqual(r.reviewed, true);
  const before = f.ctx.chat[0].mes; await f.ctl.finishReview(r);
  assert.equal(r.reviewed, true); assert.equal(f.ctx.chat[0].mes, before);
  const fresh = await f.ctl.detect(); assert.notEqual(fresh.reviewed, true);
});

test('failed automatic save retains the original, retryable proposal and unread status', async () => {
  const f = fixture(); f.ctl.settings().rules[0].execution = 'auto';
  const r = await f.ctl.detect(); f.fail();
  await assert.rejects(f.ctl.commit(r, { automatic: true }), /未能确认保存/);
  assert.equal(r.expected, r.base); assert.notEqual(r.reviewed, true);
  assert.equal(r.log, undefined); assert.equal(r.groups[0].matches[0].done, false);
});

test('server readback requires persisted completion metadata, even when text is unchanged', async t => {
  const f = fixture(), r = await f.ctl.detect();
  f.ctx.characters = [{ name: '测试', avatar: 'demo.png' }]; f.ctx.getRequestHeaders = () => ({});
  let metadata = structuredClone(f.ctx.chatMetadata);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [{ chat_metadata: metadata }, ...f.disk()] }));
  r.reviewed = true;
  await assert.rejects(verifyChatSave(f.ctx, r, r.expected), /审阅/);
  metadata = structuredClone(f.ctx.chatMetadata);
  await verifyChatSave(f.ctx, r, r.expected);
});
