import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionUI } from '../ui.js';
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
