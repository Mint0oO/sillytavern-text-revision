import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionUI, renderChangeLog } from '../ui.js';
import { messageIdFromElement } from '../message-buttons.js';
// IDs in these DOM doubles are numeric; browsers provide the native CSS API.
globalThis.CSS ??= { escape: String };

test('dismissal remains available while saving, but editing actions stay blocked', async () => {
  const closed = [];
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    c: { busy: true }, ruleModal: { open: true },
    closeRuleModal() { closed.push('rule'); },
    importModal: { close() { closed.push('import'); } },
    scopeModal: { close() { closed.push('scope'); } },
    openRuleModal() { assert.fail('must not start editing while saving'); },
  });
  for (const action of ['cancel-rule', 'cancel-import', 'cancel-scope', 'new-rule']) {
    await ui.click({ target: { closest: () => ({ type: 'button', dataset: { action } }) } });
  }
  assert.deepEqual(closed, ['rule', 'import', 'scope']);
});

test('single selection updates only that row and cannot enable Apply during editing', () => {
  const updated = [], apply = {}, all = {};
  const groups = Array.from({ length: 200 }, (_, id) => ({ id, manual: true, original: '旧', draft: '新', selected: true }));
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    edit: { groupId: 0 }, c: { busy: false },
    dialog: { querySelector(selector) {
      if (selector === '[data-all]') return all;
      if (selector === '[data-action="apply"]') return apply;
      updated.push(selector);
      return { setAttribute() {}, closest: () => ({ classList: { toggle() {} } }) };
    } },
  });
  ui.updateReviewSelection({ groups }, [groups[1]]);
  assert.equal(updated.length, 1, 'a tap must not rewrite 200 rows');
  assert.equal(apply.disabled, true, 'pending inline edits must keep Apply disabled');
  assert.equal(all.checked, true);
});

test('close pointerdown retains input focus until click without suppressing other controls', () => {
  let prevented = 0;
  const ui = Object.create(RevisionUI.prototype);
  for (const action of ['cancel-rule', 'preview-rule']) {
    ui.pointerDown({ button: 0, target: { closest: () => ({ dataset: { action } }) }, preventDefault() { prevented++; } });
  }
  assert.equal(prevented, 1);
});

test('canceling the discard prompt retains the open editor and its unsaved draft', () => {
  const previousConfirm = globalThis.confirm;
  let closed = false;
  const draft = { find: '未保存' };
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    ruleId: 'one', ruleOriginal: JSON.stringify({ find: '原规则' }),
    ruleDrafts: new Map([['one', draft]]), ruleModal: { close() { closed = true; } },
  });
  try {
    globalThis.confirm = () => false;
    ui.closeRuleModal();
    assert.equal(closed, false);
    assert.equal(ui.ruleDrafts.get('one'), draft);
    globalThis.confirm = () => true;
    ui.closeRuleModal();
    assert.equal(closed, true);
  } finally {
    if (previousConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = previousConfirm;
  }
});

test('execution mode changes preserve the independent trigger and existing settings', async () => {
  const settings = { autoScan: false, enabled: true, ruleExecution: 'review', rules: [{ id: 'existing' }], theme: 'dark' };
  const originalRules = settings.rules, help = {};
  let saves = 0;
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    c: { settings: () => settings, saveSettings() { saves++; } },
    dialog: { querySelector: () => help },
  });
  await ui.change({ target: { id: 'tr-rule-execution', value: 'auto', dataset: {}, hasAttribute: () => false } });
  assert.equal(settings.ruleExecution, 'auto');
  assert.equal(settings.autoScan, false);
  assert.equal(settings.enabled, true);
  assert.equal(settings.rules, originalRules);
  assert.equal(settings.theme, 'dark');
  assert.equal(saves, 1);
  assert.match(help.textContent, /手动检测先展示结果/);
});

test('history detection switch changes only per-floor entry visibility', async () => {
  const settings = { autoScan: true, enabled: true, historyDetection: true, ruleExecution: 'review' };
  let syncs = 0, saves = 0;
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    c: { settings: () => settings, saveSettings() { saves++; } },
    onPluginAvailabilityChange() { syncs++; },
  });
  await ui.change({ target: { id: 'tr-history-detection', checked: false, dataset: {}, hasAttribute: () => false } });
  assert.equal(settings.historyDetection, false);
  assert.equal(settings.enabled, true);
  assert.equal(settings.autoScan, true);
  assert.equal(settings.ruleExecution, 'review');
  assert.equal(syncs, 1);
  assert.equal(saves, 1);
});

test('clearing search restores all rules without changing delete selections', async () => {
  const selection = new Set(['keep']);
  let rendered = 0, focused = false;
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    c: { busy: false }, ruleFilters: { search: '极其' }, ruleDeleteIds: selection,
    render() { rendered++; },
    dialog: { querySelector: () => ({ focus() { focused = true; } }) },
  });
  await ui.click({ target: { closest: () => ({ type: 'button', dataset: { action: 'clear-rule-search' } }) } });
  assert.equal(ui.ruleFilters.search, '');
  assert.equal(rendered, 1);
  assert.equal(focused, true);
  assert.deepEqual([...selection], ['keep']);
});

test('compact logs group changed text, escape markup and preserve the stored originals', () => {
  const log = [
    { before: '他极其冷漠。', after: '他冷漠。', rule: 'very-long-regex', automatic: false },
    { before: '她极具魅力。', after: '她很有魅力。', rule: 'another-regex', automatic: true },
    { before: '😀', after: '😁' },
    { before: '<x>', after: '' },
    { before: '原样', after: '原样' },
  ];
  const original = JSON.stringify(log), html = renderChangeLog(log);
  assert.match(html, /^<details class="tr-change-log tr-change-log-root"><summary>修改日志 · 4 处<\/summary><div class="tr-change-log-groups">/);
  assert.match(html, /删除 · 2 处/);
  assert.match(html, /替换 · 2 处/);
  assert.match(html, /<del>极其<\/del>/);
  assert.match(html, /<del>极具<\/del> → <ins>很有<\/ins>/);
  assert.match(html, /<del>😀<\/del> → <ins>😁<\/ins>/);
  assert.match(html, /&lt;x&gt;/);
  assert.doesNotMatch(html, /详情|very-long-regex|another-regex/);
  assert.doesNotMatch(html, /<p class="tr-sentence">他|<p class="tr-sentence">她|原样/);
  assert.equal(JSON.stringify(log), original);
  assert.equal(renderChangeLog([]), '');
});

test('the panel reads its own round instead of a background-selected round and clears it on main close', () => {
  const rounds = [{ id: 'floor-9' }, { id: 'background-latest' }];
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    c: { history: () => rounds, selectedId: 'background-latest', detectionSequence: 3 },
    panelRoundId: 'floor-9', panelTarget: { id: 9 }, panelEpoch: 4, detecting: true, panelDetection: new AbortController(),
    drafts: new Map([['draft', {}]]), edit: { roundId: 'floor-9' }, reviewSelection: {},
  });
  assert.equal(ui.panelRound(), rounds[0]);
  ui.endPanelSession();
  assert.equal(ui.panelRoundId, null);
  assert.equal(ui.panelTarget, null);
  assert.equal(ui.detecting, false);
  assert.equal(ui.drafts.size, 1, 'closing keeps the unfinished draft');
  assert.equal(ui.c.detectionSequence, 3, 'closing the panel must not cancel background detection');
  assert.equal(ui.panelDetection.signal.aborted, true);
});

test('review statistics show the host floor id and never borrow the controller current round', () => {
  const target = { id: 'target', count: 2, groups: [], reviewed: false };
  const background = { id: 'background', count: 99, groups: [] };
  let html = '';
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    screen: 'review', detecting: false, panelRoundId: target.id, reviewSelection: null,
    c: { settings: () => ({ enabled: true }), history: () => [target, background], current: () => background, editable: () => true, locateRound: () => 9 },
    body(value) { html = value; }, legend: () => '', row: () => '', reviewFooter() {},
    dialog: { querySelector: () => ({ insertAdjacentHTML() {} }) },
  });
  ui.review();
  assert.match(html, /2处问题\/0字段　9#/);
  assert.doesNotMatch(html, /99处/);
});

test('editable rows expose one-line pencil actions and an adjacent restore/delete menu', () => {
  const ui = Object.assign(Object.create(RevisionUI.prototype), { edit: null, panelRound: () => ({ id: 'round' }) });
  const group = { id: 0, original: '原句', matches: [{ id: 1, old: '原', value: '新', options: [], done: false }], selected: true, kept: false, manual: false };
  const html = ui.row(group, true);
  assert.match(html, /class="tr-row-actions"/);
  assert.match(html, /data-edit="0"/);
  assert.match(html, /data-quick-toggle="0"/);
  assert.match(html, /data-quick="restore"/);
  assert.match(html, />恢复<\/button>/);
  assert.match(html, /data-quick="delete"/);
  assert.match(html, />删除<\/button>/);
});

test('completed rows use right-edge states without a visible status badge', () => {
  const ui = Object.assign(Object.create(RevisionUI.prototype), { edit: null, panelRound: () => ({ id: 'round' }) });
  const group = { id: 0, original: '原句', applied: '新句', matches: [{ id: 1, start: 0, end: 1, old: '原', value: '新', options: [], done: true }], selected: false, kept: false, manual: false };
  const applied = ui.row(group, false), kept = ui.row({ ...group, kept: true }, false);
  assert.match(applied, /tr-state-applied/);
  assert.match(kept, /tr-state-kept/);
  assert.match(applied, /class="tr-sr-only">已应用<\/span>/);
  assert.doesNotMatch(applied + kept, /tr-row-state|tr-row-has-state/);
});

test('quick restore and delete actions update the pending group and persist the draft', async () => {
  const group = id => ({ id, original: '原句', matches: [{ id: 1, old: '原', value: '新', options: [], done: false }], selected: true, kept: false, manual: false });
  const round = { id: 'round', groups: [group(0), group(1)] };
  const saved = [];
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    edit: null, panelRound: () => round, badge() {}, refreshReviewRows(r, ids) { saved.push(['refresh', r, ids]); },
    c: { target() {}, assertIdle() {}, editable() { return true; }, async persistDraft() { saved.push(['persist']); } },
  });
  await ui.click({ target: { closest: () => ({ type: 'button', dataset: { quick: 'restore', quickGroup: '0' } }) } });
  assert.equal(round.groups[0].kept, true);
  assert.equal(round.groups[0].selected, false);
  await ui.click({ target: { closest: () => ({ type: 'button', dataset: { quick: 'delete', quickGroup: '1' } }) } });
  assert.equal(round.groups[1].manual, true);
  assert.equal(round.groups[1].draft, '');
  assert.equal(round.groups[1].selected, true);
  assert.equal(ui.edit, null);
  assert.equal(saved.filter(([kind]) => kind === 'persist').length, 2);
});

test('a background result cannot replace another floor that is already open', async () => {
  let opened = 0;
  const active = { chatKey: 'chat', message: {} }, incoming = { chatKey: 'chat', message: {} };
  const ui = Object.assign(Object.create(RevisionUI.prototype), {
    dialog: { open: true }, screen: 'review', panelTarget: active,
    c: { settings: () => ({ enabled: true }), sameTarget: (left, right) => left === right },
    targetForRound: () => incoming,
    async open() { opened++; },
  });
  assert.equal(await ui.openDetected({ id: 'incoming' }), false);
  assert.equal(opened, 0);
});

test('message toolbar ids are read again from the owning host message', () => {
  const message = { getAttribute: name => name === 'mesid' ? '109' : null };
  assert.equal(messageIdFromElement({ closest: selector => selector === '.mes' ? message : null }), 109);
  assert.equal(messageIdFromElement({ closest: () => ({ getAttribute: () => 'not-a-number' }) }), -1);
});
