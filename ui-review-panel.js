// Body-review screen, shared inline revision row/editor, and body-review event handlers.
import { escapeHTML as esc, inlineHTML, proposal, ready } from './engine.js';
import { clone } from './controller.js';
import { button, glyph, icon, renderChangeLog } from './ui-primitives.js';

export function renderReviewPanel(ui) {
  ui.reviewSelection = null;
  if (ui.c.settings().enabled === false) { ui.body('<div class="tr-empty">插件已停用。可以在“设置”中重新启用。</div>'); return; }
  if (ui.detecting) { const floor = ui.targetFloor(); ui.body(`<div class="tr-empty">正在检测${floor === null ? '所选楼层' : ` ${floor}#`}……</div>`); return; }
  const r = ui.panelRound();
  if (!r) { ui.body(`<div class="tr-empty">${ui.panelTarget ? '尚未获得所选楼层的检测结果。' : '打开一条 AI 回复后开始检测。'}${button(ui.panelTarget ? '重新检测' : '检测最新回复', `data-action="${ui.panelTarget ? 'scan' : 'scan-latest'}"`)}</div>`); return; }
  const editable = ui.c.editable(r);
  const floor = ui.c.locateRound(r);
  const pending = ui.c.pendingSave && ui.c.pendingSave.chatKey === r.chatKey ? `<div class="tr-save-pending" role="alert"><span>${ui.c.pendingSave.status === 'diverged' ? '服务器正文发生冲突，请在酒馆中核对。' : '保存结果尚未确认，当前修改暂不能继续应用。'}</span>${button('重新确认', 'data-action="confirm-save"')}<details><summary>复制本地修改</summary><textarea readonly rows="4">${esc(ui.c.pendingSave.text)}</textarea></details></div>` : '';
  const stale = [...(ui.drafts?.values() ?? [])].filter(d => d.chatKey === r.chatKey && d.messageUid === r.messageUid && !ui.draftFor(r, d.groupId));
  const staleDrafts = stale.length ? `<details class="tr-stale-drafts"><summary>${stale.length} 份旧草稿需人工核对</summary>${stale.map(d => `<label>旧草稿<textarea readonly rows="3">${esc(d.text)}</textarea></label>`).join('')}</details>` : '';
  const recordFailure = ui.c.recordSaveError ? `<div class="tr-save-pending">检测记录尚未可靠保存。${button('重试保存记录', 'data-action="retry-record-save"')}</div>` : '';
  ui.body(`<div class="tr-review-bar"><span title="字段按可独立修订的句段计数">${r.count}处问题/${r.groups.length}字段${floor >= 0 ? `　${floor}#` : ''}</span>${ui.legend()}${button('重新检测', 'data-action="scan"')}</div>${pending}${recordFailure}${staleDrafts}${!editable ? `<p class="tr-meta">${floor < 0 ? '所选楼层已不存在或身份无法确认，请重新选择该楼层。' : '正文或检测范围已变化，请重新检测。'}</p>` : ''}<div class="tr-rows">${r.groups.map(g => ui.row(g, editable)).join('') || `<p class="tr-empty">${esc(r.notice || '未发现匹配的问题。')}</p>`}</div>`);
  if (r.log?.length) ui.dialog.querySelector('.tr-main').insertAdjacentHTML('beforeend', renderChangeLog(r.log));
  ui.reviewFooter(r, editable);
}

export function reviewSelectionState(ui, r) {
  if (ui.reviewSelection?.round !== r) {
    ui.reviewSelection = { round: r, rows: new Map(r.groups.filter(ready).map(g => [g.id, Boolean(g.selected)])) };
  }
  return ui.reviewSelection.rows;
}

export function renderReviewFooter(ui, r, editable) {
  const rows = reviewSelectionState(ui, r), n = [...rows.values()].filter(Boolean).length;
  ui.dialog.querySelector('.tr-foot').innerHTML = `<label class="tr-check"><input type="checkbox" data-all ${rows.size && rows.size === n ? 'checked' : ''} ${!editable || !rows.size ? 'disabled' : ''}>全选</label><div>${editable && !r.reviewed && !ui.edit ? button('完成审阅', 'data-action="finish-review"') : ''}${r.undo && editable ? button('撤销', 'data-action="undo"') : ''}${button(`应用所选 ${n}`, `class="tr-primary" data-action="apply" ${!editable || !n || ui.edit || ui.c.busy ? 'disabled' : ''}`)}</div>`;
}

export function renderReviewRow(ui, g, editable, options = {}) {
  const rowId = options.rowId ?? g.id;
  const editState = options.editState !== undefined ? options.editState : ui.edit;
  const editing = options.isEditing !== undefined ? options.isEditing : (ui.edit?.groupId === g.id && ui.edit.roundId === ui.panelRound()?.id && editable);
  const selected = g.selected && ready(g);
  const preview = editing ? inlineHTML({ ...g, kept: false, manual: true, draft: editState.text }) : inlineHTML(g);
  const state = !editing && (g.kept || g.matches.every(m => m.done) && !ready(g)) ? (g.kept ? '已保留' : '已应用') : '';
  const content = editable && ready(g) && !editing
    ? button(`<span class="tr-sentence">${preview}</span>`, `class="tr-row-toggle" data-toggle="${rowId}" aria-pressed="${selected}" aria-label="${selected ? '取消选择' : '选择'}第${rowId + 1}字段：${esc(proposal(g))}"`)
    : `<div class="tr-row-text ${editing ? 'tr-edit-preview' : ''}" ${editing ? `data-edit-preview="${rowId}"` : ''}><p class="tr-sentence">${preview}</p></div>`;
  let editor = '';
  if (editing) {
    const d = editState;
    editor = `<div class="tr-inline-editor"><label class="tr-edit-field"><span class="tr-label">修改后</span><textarea id="tr-edit" aria-label="编辑整句" rows="3">${esc(d.text)}</textarea></label><details class="tr-candidates" ${d.expanded ? 'open' : ''}><summary>替换候选</summary>${d.matches.filter(m => m.options.length || m.remove).map(m => `<div class="tr-candidate"><label for="tr-option-${m.id}">${esc(m.old)}</label><div class="tr-replace">${m.options.length ? `<select id="tr-option-${m.id}" data-option="${m.id}"><option value="" disabled ${m.value === null || m.value === '' ? 'selected' : ''}>替换为…</option>${m.options.map((v, i) => `<option value="${i}" ${m.value === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>${m.options.length > 1 ? button('换一个', `data-random="${m.id}"`) : ''}` : '<span class="tr-meta">未设置替换词</span>'}</div>${button('删除', `class="tr-delete" data-delete-match="${m.id}" aria-pressed="${m.value === ''}"`)}</div>`).join('') || '<p class="tr-meta">请直接编辑整句。</p>'}</details><div class="tr-edit-actions"><div>${button('不改这句', `data-keep="${rowId}"`)}${button('删除整句', 'class="tr-delete-sentence" data-action="delete-sentence"')}</div><div>${button('取消', 'data-action="cancel-edit"')}${button('完成', 'class="tr-primary" data-action="finish-edit"')}</div></div></div>`;
  }
  const actions = editable && !editing ? `<div class="tr-row-actions">${icon('pencil', `编辑第${rowId + 1}句`, `data-edit="${rowId}"`)}<button type="button" class="tr-icon tr-more" aria-label="展开第${rowId + 1}句快捷操作" aria-expanded="false" data-quick-toggle="${rowId}">${glyph('more')}</button><div class="tr-quick-menu" data-quick-menu="${rowId}" hidden><button type="button" data-quick="restore" data-quick-group="${rowId}">恢复</button><button type="button" class="tr-delete" data-quick="delete" data-quick-group="${rowId}">删除</button></div></div>` : '';
  return `<section data-group="${rowId}" class="tr-row ${selected ? 'tr-selected' : ''} ${editable ? 'tr-row-editable' : ''} ${editing ? 'tr-row-editing' : ''} ${state === '已应用' ? 'tr-state-applied' : state === '已保留' ? 'tr-state-kept' : ''}">${content}${state ? `<span class="tr-sr-only">${state}</span>` : ''}${actions}${editor}</section>`;
}

export function refreshReviewRows(ui, r, ids) {
  const editable = ui.c.editable(r), rows = reviewSelectionState(ui, r);
  for (const id of new Set(ids)) {
    const g = r.groups[id];
    if (!g) continue;
    if (ready(g)) rows.set(g.id, Boolean(g.selected)); else rows.delete(g.id);
    const row = ui.dialog.querySelector(`.tr-rows > [data-group="${CSS.escape(String(id))}"]`);
    if (row) row.outerHTML = ui.row(g, editable);
  }
  ui.reviewFooter(r, editable);
}

export function updateReviewSelection(ui, r, changed = r.groups) {
  const rows = reviewSelectionState(ui, r);
  for (const g of changed) {
    const eligible = ready(g), selected = Boolean(g.selected && eligible);
    if (eligible) rows.set(g.id, selected); else rows.delete(g.id);
    const control = ui.dialog.querySelector(`[data-toggle="${CSS.escape(String(g.id))}"]`);
    if (!control) continue;
    control.setAttribute('aria-pressed', String(selected));
    control.setAttribute('aria-label', `${selected ? '取消选择' : '选择'}第${g.id + 1}字段：${proposal(g)}`);
    control.closest('.tr-row')?.classList.toggle('tr-selected', selected);
  }
  const selected = [...rows.values()].filter(Boolean).length;
  const all = ui.dialog.querySelector('[data-all]');
  if (all) all.checked = Boolean(rows.size && rows.size === selected);
  const apply = ui.dialog.querySelector('[data-action="apply"]');
  if (apply) {
    apply.textContent = `应用所选 ${selected}`;
    apply.disabled = !selected || Boolean(ui.edit) || ui.c.busy;
  }
}

export function refreshReviewEditor(ui) {
  const g = ui.panelRound().groups[ui.edit.groupId];
  ui.edit.text = proposal({ ...g, kept: false, matches: ui.edit.matches, manual: false });
  ui.edit.expanded = true;
  ui.storeEdit();
  ui.refreshReviewRows(ui.panelRound(), [g.id]);
}

export async function finishReviewEdit(ui, text = ui.edit.text) {
  const r = ui.panelRound(); ui.c.target(r);
  const g = r.groups[ui.edit.groupId]; g.matches = clone(ui.edit.matches); g.manual = false; g.kept = false;
  g.manual = text !== proposal(g); g.draft = text; g.selected = ready(g);
  ui.drafts.delete(ui.edit.key); ui.saveDrafts(); ui.edit = null;
  ui.refreshReviewRows(r, [g.id]); ui.badge(); await ui.c.persistDraft();
}

export async function handleReviewClick(ui, data, b, e) {
  if (data.toggle !== undefined) {
    const r = ui.panelRound();
    ui.c.target(r);
    if (!ui.c.editable(r)) throw new Error('正文或检测范围已变化，请重新检测。');
    const g = r.groups[Number(data.toggle)];
    if (ready(g)) g.selected = !g.selected;
    ui.updateReviewSelection(r, [g]);
    if (e.detail === 0) b.focus({ preventScroll: true });
    return true;
  }
  if (data.quick !== undefined) {
    const r = ui.panelRound(), id = Number(data.quickGroup), g = r?.groups[id];
    ui.c.target(r); ui.c.assertIdle();
    if (!g || !ui.c.editable(r)) throw new Error('正文或检测范围已变化，请重新检测。');
    if (ui.edit && ui.edit.groupId !== id) throw new Error('请先完成或取消当前编辑。');
    if (data.quick === 'restore') { g.kept = true; g.manual = false; g.draft = null; g.selected = false; g.matches.forEach(m => { m.done = true; }); }
    else if (data.quick === 'delete') { g.kept = false; g.manual = true; g.draft = ''; g.selected = true; }
    ui.edit = null;
    ui.refreshReviewRows(r, [id]); ui.badge(); await ui.c.persistDraft();
    return true;
  }
  if (data.edit !== undefined) {
    const r = ui.panelRound(); ui.c.target(r); ui.c.assertIdle();
    const previousId = ui.edit?.groupId;
    const id = Number(data.edit), g = r.groups[id], key = `${r.id}:${id}`;
    const protectedFloors = new Set([...ui.drafts.values()].map(d => `${d.chatKey}:${d.messageUid}`));
    if (!ui.drafts.has(key) && !protectedFloors.has(`${r.chatKey}:${r.messageUid}`) && protectedFloors.size >= 10) throw new Error('已保护 10 个楼层的未完成草稿，请先完成或取消其中一个。');
    ui.edit = ui.draftFor(r, id) ?? { roundId: r.id, groupId: id, key, text: proposal(g), matches: clone(g.matches), expanded: false };
    ui.storeEdit(); ui.refreshReviewRows(r, [previousId, id]); ui.dialog.querySelector('#tr-edit').focus();
    return true;
  }
  if (data.random !== undefined || data.deleteMatch !== undefined) {
    const m = ui.edit.matches.find(item => item.id === Number(data.random ?? data.deleteMatch));
    if (data.deleteMatch !== undefined) m.value = m.value === '' ? null : '';
    else { const values = m.options.filter(v => v !== m.value); m.value = values[Math.floor(Math.random() * values.length)]; }
    ui.refreshEditor();
    return true;
  }
  if (data.keep !== undefined) {
    const r = ui.panelRound(), g = r.groups[Number(data.keep)];
    g.kept = true; g.selected = false; g.matches.forEach(m => { m.done = true; });
    ui.drafts.delete(ui.edit?.key); ui.saveDrafts(); ui.edit = null;
    ui.refreshReviewRows(r, [g.id]); ui.badge(); await ui.c.persistDraft();
    return true;
  }
  switch (data.action) {
    case 'retry-record-save': await ui.c.persistDraft(); ui.render(); ui.say('检测记录已重新提交保存。'); return true;
    case 'confirm-save': {
      const result = await ui.c.confirmPendingSave();
      ui.say(result === 'saved' ? '服务器已确认保存。' : '服务器仍是原文；本地建议已恢复，可重新应用。');
      return true;
    }
    case 'finish-review': await ui.c.finishReview(ui.panelRound()); ui.say('本轮已完成，未应用的内容保留，不再提醒。'); return true;
    case 'scan-latest': {
      const latest = ui.c.latestReply();
      if (latest < 0) throw new Error('当前没有可检测的 AI 回复。');
      ui.panelTarget = ui.c.captureTarget(latest); ui.panelRoundId = null; ui.edit = null;
      await ui.detectPanelTarget(); return true;
    }
    case 'scan': {
      if (!ui.panelTarget) throw new Error('本次面板没有可重新检测的楼层。');
      ui.edit = null; await ui.detectPanelTarget(); return true;
    }
    case 'cancel-edit': {
      const id = ui.edit.groupId;
      ui.drafts.delete(ui.edit.key); ui.saveDrafts(); ui.edit = null;
      ui.refreshReviewRows(ui.panelRound(), [id]); return true;
    }
    case 'delete-sentence': await ui.finishEdit(''); return true;
    case 'finish-edit': await ui.finishEdit(); return true;
    case 'apply': ui.say('正在应用并保存……'); await ui.c.commit(ui.panelRound()); ui.say('已应用并确认保存，后续上下文将使用修改稿。'); return true;
    case 'undo': ui.say('正在撤销并保存……'); await ui.c.commit(ui.panelRound(), { undo: true }); ui.say('已撤销上次应用并确认保存。'); return true;
    default: return false;
  }
}

export function handleReviewInput(ui, el) {
  if (el.id !== 'tr-edit' || !ui.edit) return false;
  ui.edit.text = el.value;
  ui.storeEdit();
  const g = ui.panelRound().groups[ui.edit.groupId];
  const preview = ui.dialog.querySelector(`[data-edit-preview="${g.id}"] .tr-sentence`);
  if (preview) preview.innerHTML = inlineHTML({ ...g, kept: false, manual: true, draft: ui.edit.text });
  return true;
}

export function handleReviewChange(ui, el) {
  if (el.hasAttribute('data-all')) {
    const r = ui.panelRound();
    r.groups.filter(ready).forEach(g => { g.selected = el.checked; });
    ui.updateReviewSelection(r);
    return true;
  }
  if (el.dataset.option !== undefined) {
    const m = ui.edit.matches.find(item => item.id === Number(el.dataset.option));
    m.value = m.options[Number(el.value)];
    ui.refreshEditor();
    return true;
  }
  return false;
}
