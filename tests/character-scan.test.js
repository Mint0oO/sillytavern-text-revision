import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectCharacterContext, createInitialCharacterSelection, collectCharacterRules,
  scanCharacterTargets, commitCharacterScan, allCharacterGroups,
  categorySelectionState, toggleCategoryAll, toggleCategoryItem, sectionSelectionState,
  findSnapshotTarget, saveSingleCharacterTarget, bodyRuleOverrideState,
  setCharacterBodyGroupOverride, setCharacterBodyRuleOverride, resetCharacterBodyRules,
  createWorldSelection, worldSelectionState, toggleWorldAll, toggleWorldLight,
  toggleWorldEnabledOnly, toggleWorldEntry,
} from '../character-scan.js';
import { renderCharacterSetup, renderCharacterReview } from '../character-view.js';
import { renderRulesView, characterRuleCountText, ruleCountText } from '../rules-view.js';
import { renderRuleForm } from '../rule-form.js';
import { renderSettingsView } from '../settings-view.js';
import { applyRuleSet } from '../rule-transfer.js';
import { effectiveRules } from '../rule-groups.js';
import { RevisionUI } from '../ui.js';

globalThis.CSS ??= { escape: String };

function makeContext(overrides = {}) {
  const worldBook = overrides.worldBook ?? {
    entries: {
      '1': { uid: 1, displayIndex: 0, comment: '核心设定', key: ['皇宫'], constant: true, disable: false, content: '他死死盯着窗外。' },
      '2': { uid: 2, displayIndex: 1, comment: '日常触发', key: ['茶室'], constant: false, disable: false, content: '茶水极其烫口。' },
      '3': { uid: 3, displayIndex: 2, comment: '废弃设定', key: ['旧稿'], constant: false, disable: true, content: '旧稿极其冗长。' },
      '4': { uid: 4, displayIndex: 3, comment: '空分隔条', key: [], constant: true, disable: false, content: '   ' },
    },
  };
  const savedWorlds = [];
  const reloadedWorlds = [];
  let settingsSaves = 0;
  const character = overrides.character ?? {
    name: '元曜',
    avatar: 'yuanyao.png',
    description: '他死死握着玉佩。',
    personality: '极其冷漠。',
    scenario: '',
    first_mes: '<style>.card { content: "极其"; }</style>{{char}}死死盯着{{user}}。',
    mes_example: '',
    creatorcomment: '作者备注：极其重要。',
    data: {
      name: '元曜',
      description: '他死死握着玉佩。',
      personality: '极其冷漠。',
      scenario: '',
      first_mes: '<style>.card { content: "极其"; }</style>{{char}}死死盯着{{user}}。',
      alternate_greetings: ['   ', '第二条开场白极其冷清。'],
      mes_example: '',
      system_prompt: '系统提示词：不要死死。',
      post_history_instructions: '',
      creator_notes: '作者备注：极其重要。',
      extensions: {
        world: '后宫设定',
        depth_prompt: { prompt: '', depth: 4, role: 'system' },
        regex_scripts: [{ findRegex: '极其', replaceString: '' }],
      },
    },
  };
  const context = {
    characterId: 0,
    groupId: null,
    name1: '陈再',
    characters: [character],
    powerUserSettings: { persona_description: '陈再的眼底极其平静。' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    substituteParams: text => String(text).replaceAll('{{char}}', character.name).replaceAll('{{user}}', '陈再'),
    saveSettingsDebounced() { settingsSaves++; },
    async unshallowCharacter() {},
    async loadWorldInfo(name) {
      if (name !== '后宫设定') return null;
      return worldBook;
    },
    async saveWorldInfo(name, data, immediately) {
      savedWorlds.push({ name, data: structuredClone(data), immediately });
    },
    reloadWorldInfoEditor(name, loadIfNotSelected) {
      reloadedWorlds.push({ name, loadIfNotSelected });
    },
    ...overrides.context,
  };
  return { context, character, worldBook, savedWorlds, reloadedWorlds, getSettingsSaves: () => settingsSaves };
}

function makeSettings(overrides = {}) {
  return {
    enabled: true,
    characterRevisionEnabled: true,
    ruleExecution: 'auto',
    ungroupedEnabled: true,
    extractEnabled: true,
    extractTags: ['content'],
    rules: [
      { id: 'b1', find: '极其', kind: 'regex', editorVersion: 1, values: [], remove: true, action: 'delete', enabled: true, execution: 'auto', priorityLevel: 2, groupId: 'bg1' },
      { id: 'b2', find: '死死', kind: 'regex', editorVersion: 1, values: [], remove: true, action: 'delete', enabled: true, execution: 'auto', priorityLevel: 2, groupId: null },
    ],
    ruleGroups: [
      { id: 'bg1', name: '程度词', enabled: true, execution: 'inherit' },
    ],
    characterRules: [
      { id: 'c1', find: '死死', kind: 'regex', editorVersion: 1, values: [], remove: true, action: 'delete', enabled: true, execution: 'review', priorityLevel: 1, groupId: null },
    ],
    characterRuleGroups: [],
    characterUngroupedEnabled: true,
    characterIncludeBodyRules: true,
    characterBodyOverrides: { groups: {}, rules: {} },
    ...overrides,
  };
}

test('inspectCharacterContext rejects group chats and empty character states cleanly', async () => {
  const groupRes = await inspectCharacterContext({ groupId: 'g1', characters: [] });
  assert.equal(groupRes.status, 'group');
  assert.match(groupRes.reason, /群聊/);

  const emptyRes = await inspectCharacterContext({ groupId: null, characterId: undefined, characters: [] });
  assert.equal(emptyRes.status, 'no-character');
});

test('inspectCharacterContext initializes item-level selections for profile, world, and meta while keeping persona unchecked', async () => {
  const { context } = makeContext();
  const snapshot = await inspectCharacterContext(context);
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.categories.profile.available, true);
  assert.equal(snapshot.categories.profile.summary, '描述、性格、开场白、备用开场白');
  assert.equal(snapshot.categories.meta.available, true);
  assert.equal(snapshot.categories.meta.summary, '系统提示词、创作者备注');
  assert.equal(snapshot.categories.world.available, true);
  assert.equal(snapshot.categories.world.entries.length, 3, 'blank separator entry must be filtered out');
  assert.equal(snapshot.categories.persona.available, true);

  const selection = createInitialCharacterSelection(snapshot);
  assert.equal(selection.profileIds.size, 4);
  assert.equal(selection.profileExpanded, false);
  assert.equal(selection.metaIds.size, 2);
  assert.equal(selection.metaExpanded, false);
  assert.equal(selection.persona, false);
  assert.equal(selection.world.selectedUids.size, 3);
  assert.equal(selection.worldExpanded, false);

  // Toggling individual profile items updates indeterminate state accurately.
  toggleCategoryItem(selection.profileIds, 'card:description', false);
  const st = categorySelectionState(snapshot.categories.profile.items, selection.profileIds);
  assert.equal(st.selectedCount, 3);
  assert.equal(st.indeterminate, true);
  assert.equal(st.active, true);
  toggleCategoryAll(snapshot.categories.profile.items, selection.profileIds, false);
  assert.equal(categorySelectionState(snapshot.categories.profile.items, selection.profileIds).active, false);
});

test('character setup uses single-line rows, 世界书 label, bottom rules entry, and expands profile/meta/world cleanly', async () => {
  const { context } = makeContext();
  const snapshot = await inspectCharacterContext(context);
  const selection = createInitialCharacterSelection(snapshot);
  selection.profileExpanded = true;
  selection.metaExpanded = true;
  const html = renderCharacterSetup({ snapshot, selection, ruleSummary: { total: 2, charCount: 1, bodyCount: 1, includeBody: true } });
  assert.match(html, />世界书</);
  assert.doesNotMatch(html, /绑定世界书/);
  assert.doesNotMatch(html, /tr-char-world-expand/);
  assert.match(html, /data-char-expand="profile"/);
  assert.match(html, /data-char-expand="world"/);
  assert.match(html, /data-char-expand="meta"/);
  assert.match(html, /data-char-preview="persona"/);
  assert.match(html, /data-char-preview="card:description"/);
  assert.match(html, /data-char-preview="card:system_prompt"/);
  assert.match(html, /data-screen="character-rules"/);
  assert.match(html, /角色规则 · 生效 2 条/);
});

test('empty character categories render disabled with 未检测出内容 or 未绑定', async () => {
  const emptyChar = {
    name: '空卡',
    avatar: 'empty.png',
    description: '  ',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    data: { alternate_greetings: [], extensions: { world: '' } },
  };
  const { context } = makeContext({
    character: emptyChar,
    context: { powerUserSettings: { persona_description: '   ' } },
  });
  const snapshot = await inspectCharacterContext(context);
  const selection = createInitialCharacterSelection(snapshot);
  const html = renderCharacterSetup({ snapshot, selection, ruleSummary: { total: 2, charCount: 1, bodyCount: 1, includeBody: true } });
  assert.match(html, /未检测出内容/);
  assert.match(html, /未绑定/);
  assert.match(html, /data-action="char-scan" disabled/);
});

test('world entry Mode A filters coordinate lights, all, enabled-only, and single entry toggles without conflicts', () => {
  const entries = [
    { uid: '1', title: '蓝开', light: 'blue', enabled: true },
    { uid: '2', title: '蓝关', light: 'blue', enabled: false },
    { uid: '3', title: '绿开', light: 'green', enabled: true },
    { uid: '4', title: '绿关', light: 'green', enabled: false },
  ];
  const sel = createWorldSelection(entries);
  let st = worldSelectionState(entries, sel);
  assert.equal(st.allChecked, true);
  assert.equal(st.lights.blue.checked, true);
  assert.equal(st.lights.green.checked, true);
  assert.equal(st.hasVector, false);
  assert.equal(st.enabledOnly, false);

  toggleWorldLight(entries, sel, 'green', false);
  st = worldSelectionState(entries, sel);
  assert.equal(st.allChecked, false);
  assert.equal(st.lights.green.checked, false);
  assert.equal(st.lights.blue.checked, true);
  assert.deepEqual([...sel.selectedUids].sort(), ['1', '2']);
  assert.equal(st.indeterminate, true);

  toggleWorldEnabledOnly(entries, sel, true);
  st = worldSelectionState(entries, sel);
  assert.equal(st.enabledOnly, true);
  assert.equal(st.lights.blue.checked, true);
  assert.equal(st.lights.green.checked, false);
  assert.deepEqual([...sel.selectedUids], ['1']);

  toggleWorldEnabledOnly(entries, sel, false);
  assert.deepEqual([...sel.selectedUids].sort(), ['1', '2']);

  toggleWorldEnabledOnly(entries, sel, true);
  toggleWorldEntry(entries, sel, '4', true);
  st = worldSelectionState(entries, sel);
  assert.equal(st.enabledOnly, false);
  assert.deepEqual([...sel.selectedUids].sort(), ['1', '4']);

  toggleWorldAll(entries, sel, false);
  st = worldSelectionState(entries, sel);
  assert.equal(st.allChecked, false);
  assert.equal(st.lights.blue.checked, false);
  assert.equal(st.lights.green.checked, false);
  assert.equal(st.selectedCount, 0);
  assert.equal(st.active, false);
});

test('ungrouped toggle controls ungrouped rules without altering individual switches', () => {
  const settings = makeSettings();
  assert.equal(effectiveRules(settings.rules, settings.ruleGroups, true).length, 2);
  assert.equal(effectiveRules(settings.rules, settings.ruleGroups, false).length, 1);
  assert.equal(ruleCountText(settings.rules, settings.ruleGroups, false), '生效 1 / 2');
  const html = renderRulesView(settings.rules, { search: '' }, 'review', {}, { ruleGroups: settings.ruleGroups, ungroupedEnabled: false });
  assert.match(html, /data-ungrouped-enabled/);
  assert.match(html, /生效 0 \/ 1/);
});

test('character body-rule overrides allow toggling body groups/rules independently and resetting to default', () => {
  const settings = makeSettings();
  assert.equal(bodyRuleOverrideState(settings).hasOverrides, false);
  assert.equal(collectCharacterRules(settings).rules.length, 2);

  // Disable body group "程度词" (bg1) inside character rules -> body rule itself stays untouched!
  setCharacterBodyGroupOverride(settings, 'bg1', false);
  assert.equal(settings.ruleGroups[0].enabled, true, 'must not mutate body group state');
  assert.equal(bodyRuleOverrideState(settings).hasOverrides, true);
  assert.equal(bodyRuleOverrideState(settings).effectiveCount, 1);
  assert.equal(collectCharacterRules(settings).rules.length, 1, 'only 死死 remains effective');

  // Toggle single body rule override back and forth.
  setCharacterBodyRuleOverride(settings, 'b2', false);
  assert.equal(settings.rules[1].enabled, true, 'must not mutate body rule state');
  assert.equal(bodyRuleOverrideState(settings).effectiveCount, 0);

  // Reset restores exact sync with body rules.
  resetCharacterBodyRules(settings);
  assert.equal(bodyRuleOverrideState(settings).hasOverrides, false);
  assert.equal(bodyRuleOverrideState(settings).effectiveCount, 2);
  assert.equal(collectCharacterRules(settings).rules.length, 2);
});

test('character rules view renders grouped body rules with reset button and hides execution selectors', () => {
  const settings = makeSettings();
  setCharacterBodyGroupOverride(settings, 'bg1', false);
  const html = renderRulesView(settings.characterRules, { search: '' }, 'auto', {}, {
    ...settings,
    mode: 'character',
    ruleGroups: settings.characterRuleGroups,
    ungroupedEnabled: settings.characterUngroupedEnabled,
    collapsedRuleGroups: new Set(),
    expandedBodyMirrorGroups: new Set(['bg1']),
    bodyRules: settings.rules,
    bodyRuleGroups: settings.ruleGroups,
    bodyUngroupedEnabled: settings.ungroupedEnabled,
  });
  assert.match(html, /正文规则/);
  assert.match(html, /data-char-include-body/);
  assert.match(html, /正文规则恢复默认/);
  assert.match(html, /data-char-body-group="bg1"/);
  assert.match(html, /data-char-body-rule="b1"/);
  assert.match(html, /data-ungrouped-enabled/);
  assert.match(html, /已调整/);
  assert.doesNotMatch(html, /自动检测并应用/);
  assert.equal(characterRuleCountText(settings), '角色 1/1 · 正文 1');

  const formHtml = renderRuleForm({ find: '极其', valuesText: '', priorityLevel: 2, groupId: '', execution: 'review' }, { showExecution: false });
  assert.doesNotMatch(formHtml, /处理方式/);

  const imported = applyRuleSet([], {
    ruleExecution: 'auto',
    groups: [{ id: 'g1', name: '词', enabled: true, execution: 'auto' }],
    rules: [{ id: 'r1', find: '极度', kind: 'regex', editorVersion: 1, values: [], remove: true, action: 'delete', enabled: true, execution: 'auto', groupId: 'g1', priorityLevel: 2 }],
  }, 'replace', [], { forceReview: true });
  assert.equal(imported.ruleExecution, null);
  assert.equal(imported.groups[0].execution, 'review');
  assert.equal(imported.rules[0].execution, 'review');
});

test('settings view places 启用角色修订 directly above 显示逐楼层检测入口', () => {
  const html = renderSettingsView({
    enabled: true, autoScan: true, characterRevisionEnabled: true, historyDetection: true,
    ruleExecution: 'review', extractEnabled: false, extractTags: [], excludeEnabled: true, excludeRules: [],
    appearance: 'minimal', theme: 'light', transparency: 0, palette: 'soft', showLauncher: false,
  }, { legend: () => '', slider: () => '', glyph: () => '' });
  const charIndex = html.indexOf('id="tr-character-revision"');
  const histIndex = html.indexOf('id="tr-history-detection"');
  assert.ok(charIndex > 0 && histIndex > charIndex, '启用角色修订 must appear above 显示逐楼层检测入口');
  assert.match(html, /启用角色修订/);
});

test('scanCharacterTargets ignores body extractTags, skips <style> contents, keeps macros intact, and scans disabled world entries', async () => {
  const { context } = makeContext();
  const settings = makeSettings({
    characterRules: [
      { id: 'c1', find: '死死', kind: 'regex', editorVersion: 1, values: [], remove: true, action: 'delete', enabled: true, execution: 'review', priorityLevel: 2, groupId: null },
      { id: 'c2', find: '(\\{\\{char\\}\\})死死盯着(\\{\\{user\\}\\})', kind: 'regex', editorVersion: 1, values: ['$1看着$2'], remove: false, action: 'replace', enabled: true, execution: 'review', priorityLevel: 1, groupId: null },
    ],
  });
  const snapshot = await inspectCharacterContext(context);
  const selection = createInitialCharacterSelection(snapshot);
  selection.persona = true;

  const result = await scanCharacterTargets(context, snapshot, selection, settings);
  const byId = Object.fromEntries(result.sections.map(s => [s.id, s]));

  assert.ok(byId['card:description']);
  assert.ok(byId['card:personality']);
  assert.ok(byId['card:first_mes']);
  assert.ok(byId['card:alt:1']);
  assert.ok(byId['world:1']);
  assert.ok(byId['world:2']);
  assert.ok(byId['world:3']);
  assert.match(byId['world:3'].label, /已停用/);
  assert.ok(byId['card:system_prompt']);
  assert.ok(byId['card:creator_notes']);
  assert.ok(byId['persona']);

  assert.equal(byId['card:first_mes'].groups.some(g => g.original.includes('.card')), false);
  const firstMesGroup = byId['card:first_mes'].groups.find(g => g.original.includes('{{char}}死死盯着{{user}}'));
  assert.ok(firstMesGroup);
  assert.ok(firstMesGroup.matches.some(m => m.value === '{{char}}看着{{user}}'));
});

test('scanCharacterTargets degrades gracefully when a card contains an unclosed <style> tag', async () => {
  const { context, character } = makeContext();
  character.description = '<style>.broken { color: red; } 他死死握着玉佩。';
  character.data.description = character.description;
  const snapshot = await inspectCharacterContext(context);
  const selection = createInitialCharacterSelection(snapshot);
  toggleCategoryAll(snapshot.categories.meta.items, selection.metaIds, false);
  toggleWorldAll(snapshot.categories.world.entries, selection.world, false);
  const result = await scanCharacterTargets(context, snapshot, selection, makeSettings());
  assert.ok(result.sections.some(s => s.id === 'card:description'));
});

test('saveSingleCharacterTarget edits one target directly and rejects stale external edits', async () => {
  const { context, character, worldBook, savedWorlds } = makeContext();
  const snapshot = await inspectCharacterContext(context);
  const patches = [];
  const saveCharacter = async (_ctx, patch) => { patches.push(structuredClone(patch)); };

  assert.equal(findSnapshotTarget(snapshot, 'card:system_prompt').modalTitle, '指令与元信息 · 系统提示词');
  const savedCard = await saveSingleCharacterTarget(context, snapshot, 'card:system_prompt', '系统提示词：保持克制。', { saveCharacter });
  assert.equal(savedCard, true);
  assert.equal(patches.length, 1);
  assert.equal(character.data.system_prompt, '系统提示词：保持克制。');

  const savedWorld = await saveSingleCharacterTarget(context, snapshot, 'world:1', '他静静望着窗外。', { saveCharacter });
  assert.equal(savedWorld, true);
  assert.equal(savedWorlds.length, 1);
  assert.equal(worldBook.entries['1'].content, '他静静望着窗外。');

  const savedPersona = await saveSingleCharacterTarget(context, snapshot, 'persona', '陈再神色平静。', { saveCharacter });
  assert.equal(savedPersona, true);
  assert.equal(context.powerUserSettings.persona_description, '陈再神色平静。');

  // Re-editing with stale snapshot text must fail safely.
  await assert.rejects(() => saveSingleCharacterTarget(context, snapshot, 'card:system_prompt', '覆盖', { saveCharacter }), /已在别处被修改/);
});

test('commitCharacterScan writes card fields, alternate greetings, world book, and persona atomically and supports undo + conflict detection', async () => {
  const { context, character, worldBook, savedWorlds, reloadedWorlds, getSettingsSaves } = makeContext();
  const settings = makeSettings();
  const snapshot = await inspectCharacterContext(context);
  const selection = createInitialCharacterSelection(snapshot);
  selection.persona = true;
  const result = await scanCharacterTargets(context, snapshot, selection, settings);

  const patches = [];
  const saveCharacter = async (_ctx, patch) => { patches.push(structuredClone(patch)); };

  const changed = await commitCharacterScan(context, result, { saveCharacter });
  assert.ok(changed > 0);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].avatar, 'yuanyao.png');
  assert.equal(character.description, '他握着玉佩。');
  assert.equal(character.data.description, '他握着玉佩。');
  assert.equal(character.data.alternate_greetings[1], '第二条开场白冷清。');
  assert.equal(character.data.first_mes, '<style>.card { content: "极其"; }</style>{{char}}盯着{{user}}。');
  assert.equal(savedWorlds.length, 1);
  assert.equal(savedWorlds[0].immediately, true);
  assert.equal(worldBook.entries['1'].content, '他盯着窗外。');
  assert.equal(worldBook.entries['3'].content, '旧稿冗长。');
  assert.equal(reloadedWorlds.length, 1);
  assert.equal(context.powerUserSettings.persona_description, '陈再的眼底平静。');
  assert.equal(getSettingsSaves(), 1);
  assert.ok(result.undoBatch);

  const undone = await commitCharacterScan(context, result, { undo: true, saveCharacter });
  assert.ok(undone > 0);
  assert.equal(character.description, '他死死握着玉佩。');
  assert.equal(character.data.alternate_greetings[1], '第二条开场白极其冷清。');
  assert.equal(worldBook.entries['1'].content, '他死死盯着窗外。');
  assert.equal(context.powerUserSettings.persona_description, '陈再的眼底极其平静。');
  assert.equal(result.undoBatch, null);

  const fresh = await scanCharacterTargets(context, snapshot, selection, settings);
  character.description = '外部已手动修改';
  character.data.description = '外部已手动修改';
  await assert.rejects(() => commitCharacterScan(context, fresh, { saveCharacter }), /已在别处被修改/);
});

test('character review omits 调整范围, supports section collapse + section select-all, and uses ‹ 角色 back navigation', async () => {
  const { context } = makeContext();
  const settings = makeSettings();
  const snapshot = await inspectCharacterContext(context);
  const selection = createInitialCharacterSelection(snapshot);
  const scan = await scanCharacterTargets(context, snapshot, selection, settings);
  const firstSection = scan.sections[0];

  const html = renderCharacterReview({
    scanResult: scan,
    collapsedSections: new Set(),
    legend: () => '',
    renderRow: (g, editable) => RevisionUI.prototype.row.call({ edit: null, panelRound: () => null }, g, editable, { rowId: g.reviewId, editState: null, isEditing: false }),
  });
  assert.doesNotMatch(html, /调整范围/);
  assert.match(html, /data-char-section-collapse="/);
  assert.match(html, /data-char-section-all="/);

  const collapsedHtml = renderCharacterReview({
    scanResult: scan,
    collapsedSections: new Set([firstSection.id]),
    legend: () => '',
    renderRow: () => '<div class="sentinel"></div>',
  });
  assert.match(collapsedHtml, /tr-char-section-collapsed/);

  let updated = 0;
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    screen: 'character',
    c: { busy: false },
    characterBusy: false,
    characterEdit: null,
    characterScan: scan,
    collapsedCharacterSections: new Set(),
    dialog: { querySelector: () => null },
    render() { updated++; },
    updateCharacterSelection() { updated++; },
  });
  await ui.change({ target: { dataset: { charSectionAll: firstSection.id }, checked: false, hasAttribute: () => false } });
  assert.equal(sectionSelectionState(firstSection).selected, 0);
  await ui.click({ target: { closest: () => ({ type: 'button', dataset: { charSectionCollapse: firstSection.id } }) } });
  assert.equal(ui.collapsedCharacterSections.has(firstSection.id), true);
  assert.ok(updated >= 2);
});

test('character revision toggle hides 角色 entry, setup top nav drops 规则, and result top nav returns via ‹ 角色', async () => {
  const { context } = makeContext();
  const settings = makeSettings();
  let headHtml = '';
  const main = { scrollTop: 0, innerHTML: '' };
  const head = { set innerHTML(v) { headHtml = v; } };
  const foot = { innerHTML: '' };
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    screen: 'review',
    dialog: {
      open: true,
      querySelector(sel) {
        if (sel === '.tr-head') return head;
        if (sel === '.tr-main') return main;
        if (sel === '.tr-foot') return foot;
        return null;
      },
      querySelectorAll: () => [],
    },
    c: {
      busy: false,
      context: () => context,
      settings: () => settings,
      saveSettings() {},
      history: () => [],
    },
    panelRound: () => null,
    ruleFilters: { search: '' },
    ruleDeleteIds: new Set(),
    collapsedRuleGroups: new Set(),
    theme() {},
    badge() {},
    say() {},
  });

  // When characterRevisionEnabled=true -> 角色 appears left of 规则.
  ui.render();
  assert.ok(headHtml.indexOf('data-screen="character"') > 0);
  assert.ok(headHtml.indexOf('data-screen="character"') < headHtml.indexOf('data-screen="rules"'));

  // Disabling 启用角色修订 hides 角色 from top nav.
  await ui.change({ target: { id: 'tr-character-revision', checked: false, dataset: {}, hasAttribute: () => false } });
  assert.equal(settings.characterRevisionEnabled, false);
  assert.doesNotMatch(headHtml, /data-screen="character"/);

  // Re-enable and enter character setup -> top nav has ‹ 修订 only (no top 规则 button).
  settings.characterRevisionEnabled = true;
  await ui.click({ target: { closest: () => ({ type: 'button', dataset: { screen: 'character' } }) } });
  assert.equal(ui.screen, 'character');
  assert.doesNotMatch(headHtml, /data-screen="character-rules"/);
  assert.match(headHtml, /‹ 修订/);
  assert.match(main.innerHTML, /data-screen="character-rules"/);

  // Run scan -> top nav switches to ‹ 角色 (char-back-setup), clicking it returns to setup preserving selections.
  ui.characterSelection.persona = true;
  await ui.detectCharacter();
  assert.match(headHtml, /data-action="char-back-setup"/);
  assert.match(headHtml, /‹ 角色/);

  await ui.click({ target: { closest: () => ({ type: 'button', dataset: { action: 'char-back-setup' } }) } });
  assert.equal(ui.characterScan, null);
  assert.equal(ui.characterSelection.persona, true);
  assert.match(headHtml, /‹ 修订/);
});

test('re-detecting after applying character edits refreshes live text instead of rescanning stale snapshots', async () => {
  const { context } = makeContext();
  const settings = makeSettings();
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    screen: 'character',
    dialog: { open: true, querySelector: () => null, querySelectorAll: () => [] },
    c: { busy: false, context: () => context, settings: () => settings },
    characterEpoch: 1,
    characterBusy: false,
    characterEdit: null,
    collapsedCharacterSections: new Set(),
    render() {},
    say() {},
  });
  await ui.loadCharacterSnapshot();
  ui.characterSelection.persona = true;
  const first = await ui.detectCharacter();
  assert.ok(first.count > 0);
  await commitCharacterScan(context, first, { saveCharacter: async () => {} });

  const second = await ui.detectCharacter();
  assert.equal(second.count, 0);
  assert.equal(ui.characterSelection.persona, true);
});

test('fresh settings default background transparency to 5 while preserving explicit 0', async () => {
  const { RevisionController } = await import('../controller.js');
  const { readFileSync } = await import('node:fs');
  const ext = {};
  const ctl = new RevisionController(() => ({ extensionSettings: ext, saveSettingsDebounced() {} }), async () => {});
  assert.equal(ctl.settings().transparency, 5);
  ctl.settings().transparency = 0;
  assert.equal(ctl.settings().transparency, 0);
  ctl.settings().transparency = 55;
  assert.equal(ctl.settings().transparency, 55);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /#tr-root\[data-appearance\]:not\(\[data-appearance=minimal\]\) \.tr-rows>\.tr-row\.tr-selected\{/);
});
