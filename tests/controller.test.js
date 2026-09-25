import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionController, KEY, SaveConflictError, verifyChatSave } from '../controller.js';
import { DEFAULT_RULES, ENGINE_VERSION, validateRule } from '../engine.js';
import { createRuleDraft, simpleRule } from '../rule-editor.js';

function fixture() {
  let disk, fails = false, renders = 0;
  const ctx = { chatId: 'sample', characterId: 0, groupId: null, chat: [{ is_user: false, mes: '你极其疲惫。空位极具吸引力。', swipe_id: 1, swipes: ['另一个版本。', '你极其疲惫。空位极具吸引力。'], extra: { token_count: 42 } }], chatMetadata: {}, extensionSettings: {}, eventTypes: { MESSAGE_EDITED: 'edited', MESSAGE_UPDATED: 'updated' }, eventSource: { async emit() {} }, updateMessageBlock() { renders++; }, saveSettingsDebounced() {}, async saveChat() { if (!fails) disk = structuredClone(ctx.chat); } };
  const ctl = new RevisionController(() => ctx, async (c, r, text) => { assert.equal(disk[r.messageId].mes, text, 'server did not persist content'); });
  return { ctx, ctl, disk: () => disk, fail: () => { fails = true; }, renders: () => renders };
}

test('fresh settings use simple regex rules without legacy template controls', () => {
  const settings = fixture().ctl.settings();
  assert.equal(settings.enabled, true);
  assert.equal(settings.ruleExecution, 'review');
  assert.equal(settings.historyDetection, true);
  assert.ok(settings.rules.length > 0);
  assert.ok(settings.rules.every(r => r.editorVersion === 1 && r.kind === 'regex' && r.execution === 'inherit'));
});

test('group switch excludes its rules and reopening restores individual rule choices', async () => {
  const f = fixture(), settings = f.ctl.settings();
  settings.rules = [validateRule({ id: 'grouped', kind: 'regex', find: '极其', remove: true, action: 'delete', groupId: 'g', enabled: true })];
  settings.ruleGroups = [{ id: 'g', name: '措辞', enabled: false }];
  const closed = await f.ctl.detect();
  assert.equal(closed.count, 0);
  assert.equal(settings.rules[0].enabled, true);
  settings.ruleGroups[0].enabled = true;
  const open = await f.ctl.detect();
  assert.equal(open.count, 1);
  assert.equal(f.ctl.editable(closed), false);
});

test('old numeric priorities migrate to three levels with a visible notice for collapsed ranks', () => {
  const f = fixture();
  f.ctx.extensionSettings.text_revision = { rules: [
    { id: 'a', kind: 'regex', find: '极其', values: [], remove: true, priority: 20 },
    { id: 'b', kind: 'regex', find: '极度', values: [], remove: true, priority: 10 },
    { id: 'c', kind: 'regex', find: '极具', values: [], remove: true, priority: 0 },
  ] };
  const settings = f.ctl.settings();
  assert.deepEqual(settings.rules.map(rule => rule.priorityLevel), [1, 1, 2]);
  assert.ok(settings.rules.every(rule => !('priority' in rule)));
  assert.deepEqual(settings.priorityMigrationNotice.values, [20, 10]);
  assert.deepEqual(settings.priorityMigrationNotice.rules.map(rule => rule.find), ['极其', '极度']);
});

test('global plugin switch stops detection and invalidates pending review results', async () => {
  const f = fixture(), round = await f.ctl.detect();
  f.ctl.settings().enabled = false;
  assert.equal(f.ctl.editable(round), false);
  await assert.rejects(f.ctl.detect(), /插件已停用/);
  await assert.rejects(f.ctl.commit(round), /已过期/);
});

test('shared execution changes invalidate old suggestions and automatic saves survive reload and undo', async () => {
  const f = fixture();
  f.ctl.settings().rules = [simpleRule({ ...createRuleDraft(), find: '极其', valuesText: '十分, 很' })];
  const first = await f.ctl.detect();
  f.ctl.settings().ruleExecution = 'auto';
  assert.equal(f.ctl.editable(first), false);
  await assert.rejects(f.ctl.commit(first));
  const round = await f.ctl.detect(0, { auto: true });
  await f.ctl.commit(round, { automatic: true });
  assert.match(f.disk()[0].mes, /^你(?:十分|很)疲惫/);
  assert.equal(round.log[0].automatic, true);
  const reload = new RevisionController(() => f.ctx, f.ctl.verifySave);
  await reload.commit(reload.current(), { undo: true });
  assert.equal(f.disk()[0].mes, '你极其疲惫。空位极具吸引力。');
});

test('a shared execution change during matching rejects the stale scan', async () => {
  const f = fixture();
  const pending = f.ctl.detect();
  f.ctl.settings().ruleExecution = 'auto';
  await assert.rejects(pending, /已变化/);
  assert.equal(f.ctl.history().length, 0);
});
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
test('a detected floor follows a preceding deletion by unique identity and never falls back after target deletion', async () => {
  const f = fixture();
  const target = f.ctx.chat[0];
  f.ctx.chat.unshift({ is_user: true, mes: '前一楼', extra: {} });
  const round = await f.ctl.detect(1);
  assert.equal(round.messageId, 1);
  f.ctx.chat.shift();
  assert.equal(f.ctl.target(round), target);
  assert.equal(round.messageId, 0);
  f.ctx.chat.shift();
  await assert.rejects(f.ctl.commit(round), /已不存在|身份无法确认/);
});
test('an uncertain save holds local edits and blocks another write until server state is confirmed', async () => {
  const f = fixture(); const r = await f.ctl.detect(); const original = f.ctx.chat[0].mes; f.fail();
  await assert.rejects(f.ctl.commit(r), /未能确认保存/);
  assert.notEqual(f.ctx.chat[0].mes, original); assert.equal(f.ctl.pendingSave.status, 'unconfirmed');
  await assert.rejects(f.ctl.commit(r), /尚未确认/);
  f.ctl.verifySave = async () => { throw new SaveConflictError('old', '服务器仍为原文'); };
  assert.equal(await f.ctl.confirmPendingSave(), 'old');
  assert.equal(f.ctx.chat[0].mes, original); assert.ok(r.groups[0].selected);
});
test('round counts survive apply/rescan; auto events deduplicate and old rounds are read-only', async () => {
  const f = fixture(); const first = await f.ctl.detect();
  assert.equal(await f.ctl.detect(0, { auto: true }), null);
  await f.ctl.commit(first);
  const second = await f.ctl.detect();
  assert.equal(first.count, 2); assert.equal(second.count, 0); assert.equal(second.number, 2);
  assert.equal(f.ctl.editable(first), false);
  assert.equal(f.ctx.chatMetadata[KEY].rounds.length, 1);
  // Returning to an already-detected swipe selects that result without another round.
  const m = f.ctx.chat[0]; m.swipe_id = 0; m.mes = m.swipes[0];
  await f.ctl.detect(0, { auto: true });
  m.swipe_id = 1; m.mes = m.swipes[1];
  assert.equal(await f.ctl.detect(0, { auto: true }), null);
  assert.equal(f.ctl.current().id, second.id); assert.equal(f.ctl.history().length, 2);
});
test('a stale host streaming processor cannot lock completed text; changed source still prevents applying', async () => {
  const f = fixture(); f.ctx.streamingProcessor = { isFinished: false, isStopped: false };
  const r = await f.ctl.detect();
  await f.ctl.commit(r); assert.equal(f.ctx.chat[0].mes.includes('极其'), false);
  f.ctx.chat[0].mes += '新内容';
  await assert.rejects(f.ctl.commit(r), /过期|已变化/);
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
  t.mock.method(globalThis, 'fetch', async (url, opts) => { calls.push([url, JSON.parse(opts.body)]); return { ok: true, json: async () => [{ chat_metadata: structuredClone(f.ctx.chatMetadata) }, ...f.disk()] }; });
  await verifyChatSave(f.ctx, r, f.ctx.chat[0].mes);
  assert.equal(calls[0][0], '/api/chats/get'); assert.equal(calls[0][1].avatar_url, 'sample.png');
  f.ctx.groupId = 'group1'; await verifyChatSave(f.ctx, r, f.ctx.chat[0].mes);
  assert.deepEqual(calls[1], ['/api/chats/group/get', { id: 'sample' }]);
});


test('old rules are preserved for backup but blocked from execution', async () => {
  const f = fixture();
  f.ctx.extensionSettings[KEY] = { rules: [
    { id: 'wolf', find: '像{A}的孤狼一样', kind: 'pattern' },
    { id: 'custom', find: '像{A}一样', kind: 'pattern' },
  ] };
  const s = f.ctl.settings();
  assert.deepEqual(s.rules.map(r => r.id), ['wolf', 'custom']);
  await assert.rejects(f.ctl.detect(), /旧版/);
  assert.equal(s.launcherTransparency, 0);
  assert.equal(s.launcherColor, 'theme');
  s.launcherColor = 'blue'; s.launcherTransparency = 45;
  assert.equal(f.ctl.settings().launcherColor, 'blue');
  assert.equal(f.ctl.settings().launcherTransparency, 45);
});

test('new defaults are regex rules and an intentionally empty list stays empty', () => {
  const f = fixture();
  assert.ok(f.ctl.settings().rules.every(rule => rule.kind === 'regex'));
  f.ctx.extensionSettings[KEY] = { rules: [] };
  assert.deepEqual(f.ctl.settings().rules, []);
});

test('old engine results require fresh detection', async () => {
  const good = fixture(), r = await good.ctl.detect();
  assert.equal(r.engineVersion, ENGINE_VERSION); delete r.engineVersion;
  assert.equal(good.ctl.editable(r), false);
  const fresh = await good.ctl.detect(0, { auto: true });
  assert.ok(fresh); assert.equal(fresh.engineVersion, ENGINE_VERSION);
});

test('regex sentence revisions persist through apply, reload and undo', async () => {
  const f = fixture(), source = '他死死地抓住她。';
  f.ctl.settings().rules = [validateRule({ kind: 'regex', find: '/死死地?/g', remove: true, action: 'delete' })];
  f.ctx.chat[0].mes = source; f.ctx.chat[0].swipes[1] = source;
  const r = await f.ctl.detect(); await f.ctl.commit(r);
  assert.equal(f.disk()[0].mes, '他抓住她。');
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
  assert.equal(f.disk()[0].mes, source); assert.equal(reloaded.current().log.at(-1).rule, '撤销上次应用');
  await reloaded.commit(reloaded.current(), { automatic: true });
  await reloaded.commit(reloaded.current());
  assert.equal(f.disk()[0].mes, '他抓住她，紧张。'); assert.equal(reloaded.current().reviewed, true);
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

test('an empty manual draft deletes the complete detected sentence and undo restores it', async () => {
  const f = fixture(), r = await f.ctl.detect(), group = r.groups[0];
  r.groups.slice(1).forEach(g => { g.selected = false; });
  group.manual = true; group.draft = ''; group.selected = true;
  await f.ctl.commit(r);
  assert.equal(f.disk()[0].mes, '空位极具吸引力。');
  assert.deepEqual({ before: r.log.at(-1).before, after: r.log.at(-1).after, rule: r.log.at(-1).rule, automatic: r.log.at(-1).automatic }, { before: '你极其疲惫。', after: '', rule: '手动编辑整句', automatic: false });
  assert.ok(r.log.at(-1).operationId && r.log.at(-1).time);
  await f.ctl.commit(r, { undo: true });
  assert.equal(f.disk()[0].mes, '你极其疲惫。空位极具吸引力。');
});

test('uncertain automatic save remains pending without silently rolling back', async () => {
  const f = fixture(); f.ctl.settings().rules[0].execution = 'auto';
  const r = await f.ctl.detect(); f.fail();
  await assert.rejects(f.ctl.commit(r, { automatic: true }), /未能确认保存/);
  assert.notEqual(r.expected, r.base); assert.equal(f.ctl.pendingSave.status, 'unconfirmed');
  assert.equal(r.log.length, 1);
});

test('server readback requires persisted completion metadata, even when text is unchanged', async t => {
  const f = fixture(), r = await f.ctl.detect();
  f.ctx.characters = [{ name: '测试', avatar: 'demo.png' }]; f.ctx.getRequestHeaders = () => ({});
  let metadata = structuredClone(f.ctx.chatMetadata);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [{ chat_metadata: metadata }, ...f.disk()] }));
  r.reviewed = true;
  await assert.rejects(verifyChatSave(f.ctx, r, r.expected), /审阅/);
  f.ctl.syncRound(r);
  metadata = structuredClone(f.ctx.chatMetadata);
  await verifyChatSave(f.ctx, r, r.expected);
});

test('server readback separates an old body, a third-party body, and an unknown network result', async t => {
  const f = fixture(), r = await f.ctl.detect(), before = f.ctx.chat[0].mes, proposed = before.replace('极其', '');
  f.ctx.characters = [{ name: '测试', avatar: 'demo.png' }]; f.ctx.getRequestHeaders = () => ({});
  let body = before;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [{ chat_metadata: structuredClone(f.ctx.chatMetadata) }, { ...f.disk()[0], mes: body, swipes: ['另一个版本。', body] }] }));
  await assert.rejects(verifyChatSave(f.ctx, r, proposed, before), error => error instanceof SaveConflictError && error.status === 'old');
  body = '第三方编辑';
  await assert.rejects(verifyChatSave(f.ctx, r, proposed, before), error => error instanceof SaveConflictError && error.status === 'diverged');
  body = proposed;
  await verifyChatSave(f.ctx, r, proposed, before);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('回读超时'); });
  await assert.rejects(verifyChatSave(f.ctx, r, proposed, before), /回读超时/);
});

test('one floor holds stable swipe versions while repeated detection updates its version', async () => {
  const f = fixture(), m = f.ctx.chat[0];
  m.swipe_info = [{ gen_started: 'generation-A' }, { gen_started: 'generation-B' }];
  const first = await f.ctl.detect(0, { persist: false });
  const again = await f.ctl.detect(0, { persist: false });
  assert.equal(first.version, 1); assert.equal(again.version, 1);
  assert.equal(f.ctl.history().length, 1);
  m.swipe_id = 0; m.mes = m.swipes[0];
  const other = await f.ctl.detect(0, { persist: false });
  assert.equal(other.version, 2);
  m.swipe_id = 1; m.mes = m.swipes[1];
  m.swipe_info[1].gen_started = 'generation-C';
  const reused = await f.ctl.detect(0, { persist: false });
  assert.equal(reused.version, 3);
  assert.deepEqual(f.ctl.history().map(item => item.version), [1, 2, 3]);
  assert.equal(new Set(f.ctl.history().map(item => item.messageUid)).size, 1);
});
