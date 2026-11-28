// Character inspection/review screen, source text editor modal, and their event handlers.
import { escapeHTML as esc, inlineHTML, proposal, ready } from './engine.js';
import { clone, isDetectionCancelled } from './controller.js';
import { effectiveRules } from './rule-groups.js';
import {
  inspectCharacterContext, createInitialCharacterSelection, reconcileCharacterSelection, collectCharacterRules,
  scanCharacterTargets, commitCharacterScan, allCharacterGroups, locateCharacterGroup,
  categorySelectionState, toggleCategoryAll, toggleCategoryItem, sectionSelectionState,
  findSnapshotTarget, saveSingleCharacterTarget, bodyRuleOverrideState,
  worldSelectionState, toggleWorldAll, toggleWorldLight, toggleWorldEnabledOnly, toggleWorldEntry,
} from './character-scan.js';
import { renderCharacterSetup, renderCharacterReview } from './character-view.js';
import { button } from './ui-primitives.js';

export function resetCharacterSession(ui) {
  ui.characterEpoch = (ui.characterEpoch ?? 0) + 1;
  ui.characterDetection?.abort();
  ui.characterDetection = null;
  ui.characterSnapshot = null;
  ui.characterSelection = null;
  ui.characterLoading = false;
  ui.characterError = '';
  ui.characterScan = null;
  ui.characterDetecting = false;
  ui.characterEdit = null;
  ui.characterSelectionMap = null;
  ui.collapsedCharacterSections?.clear();
  ui.characterBusy = false;
  ui.sourceDraft = null;
  if (ui.sourceModal?.open) ui.sourceModal.close();
}

export function characterRuleSummary(ui) {
  const settings = ui.c.settings();
  try {
    const { rules, charCount, bodyCount, includeBody } = collectCharacterRules(settings);
    return { total: rules.length, charCount, bodyCount, includeBody };
  } catch {
    const charCount = effectiveRules(settings.characterRules ?? [], settings.characterRuleGroups ?? [], settings.characterUngroupedEnabled !== false).length;
    const bodyState = bodyRuleOverrideState(settings);
    const bodyCount = bodyState.includeBody ? bodyState.effectiveCount : 0;
    return { total: charCount + bodyCount, charCount, bodyCount, includeBody: bodyState.includeBody };
  }
}

export async function loadCharacterSnapshot(ui) {
  ui.characterEpoch = (ui.characterEpoch ?? 0) + 1;
  const epoch = ui.characterEpoch;
  ui.characterDetection?.abort();
  ui.characterDetection = null;
  ui.characterScan = null;
  ui.characterEdit = null;
  ui.characterSelectionMap = null;
  ui.collapsedCharacterSections?.clear();
  ui.characterDetecting = false;
  ui.characterLoading = true;
  ui.characterError = '';
  if (ui.dialog.open && ui.screen === 'character') ui.render();
  try {
    const snapshot = await inspectCharacterContext(ui.c.context());
    if (epoch !== ui.characterEpoch || !ui.dialog.open) return;
    ui.characterSnapshot = snapshot;
    ui.characterSelection = createInitialCharacterSelection(snapshot);
  } catch (error) {
    if (epoch !== ui.characterEpoch || !ui.dialog.open) return;
    ui.characterError = error?.message || '读取当前角色信息失败。';
  } finally {
    if (epoch === ui.characterEpoch) {
      ui.characterLoading = false;
      if (ui.dialog.open && ui.screen === 'character') ui.render();
    }
  }
}

export async function detectCharacter(ui) {
  if (ui.characterBusy) throw new Error('正在保存角色修改，请稍候。');
  if (ui.characterEdit) throw new Error('这句还有未完成的编辑，请先完成或取消编辑，再重新检测。');
  ui.characterDetection?.abort();
  const detection = new AbortController();
  ui.characterDetection = detection;
  const epoch = ui.characterEpoch;
  const prevSnapshot = ui.characterSnapshot;
  const prevSelection = ui.characterSelection;
  ui.characterDetecting = true;
  ui.characterScan = null;
  ui.characterEdit = null;
  ui.characterSelectionMap = null;
  ui.say('');
  ui.render();
  try {
    const liveSnapshot = await inspectCharacterContext(ui.c.context());
    if (detection.signal.aborted || epoch !== ui.characterEpoch || !ui.dialog.open) return null;
    const sameCharacter = prevSnapshot?.status === 'ready' && liveSnapshot?.status === 'ready' && prevSnapshot.avatar === liveSnapshot.avatar && prevSnapshot.characterId === liveSnapshot.characterId;
    ui.characterSnapshot = liveSnapshot;
    ui.characterSelection = sameCharacter
      ? reconcileCharacterSelection(liveSnapshot, prevSelection, prevSnapshot)
      : createInitialCharacterSelection(liveSnapshot);
    const result = await scanCharacterTargets(ui.c.context(), ui.characterSnapshot, ui.characterSelection, ui.c.settings(), { signal: detection.signal });
    if (epoch !== ui.characterEpoch || !ui.dialog.open) return null;
    ui.collapsedCharacterSections?.clear();
    ui.characterScan = result;
    ui.characterDetecting = false;
    ui.render();
    return result;
  } catch (error) {
    if (isDetectionCancelled(error) || epoch !== ui.characterEpoch || !ui.dialog.open) return null;
    throw error;
  } finally {
    if (epoch === ui.characterEpoch && ui.characterDetection === detection && ui.characterDetecting) {
      ui.characterDetecting = false;
      if (ui.dialog.open && ui.screen === 'character') ui.render();
    }
  }
}

export function characterSelectionState(ui, scan = ui.characterScan) {
  if (ui.characterSelectionMap?.scan !== scan) {
    ui.characterSelectionMap = { scan, rows: new Map(allCharacterGroups(scan).filter(ready).map(g => [g.reviewId, Boolean(g.selected)])) };
  }
  return ui.characterSelectionMap.rows;
}

export function characterFooter(ui, scan = ui.characterScan) {
  const rows = characterSelectionState(ui, scan), n = [...rows.values()].filter(Boolean).length;
  ui.dialog.querySelector('.tr-foot').innerHTML = `<label class="tr-check"><input type="checkbox" data-all ${rows.size && rows.size === n ? 'checked' : ''} ${!rows.size ? 'disabled' : ''}>全选</label><div>${scan?.undoBatch ? button('撤销', 'data-action="char-undo"') : ''}${button(`应用所选 ${n}`, `class="tr-primary" data-action="char-apply" ${!n || ui.characterEdit || ui.characterBusy ? 'disabled' : ''}`)}</div>`;
}

export function syncCharacterSectionCheckboxes(ui, scan = ui.characterScan) {
  if (!scan) return;
  for (const section of scan.sections) {
    const box = ui.dialog.querySelector(`[data-char-section-all="${CSS.escape(section.id)}"]`);
    if (!box) continue;
    const st = sectionSelectionState(section);
    box.checked = st.checked;
    box.indeterminate = st.indeterminate;
    box.disabled = st.disabled;
  }
}

export function renderCharacterPanel(ui) {
  ui.characterSelectionMap = null;
  if (ui.c.settings().enabled === false) { ui.body('<div class="tr-empty">插件已停用。可以在“设置”中重新启用。</div>'); return; }
  if (ui.characterDetecting || ui.characterScan) {
    ui.collapsedCharacterSections ??= new Set();
    ui.body(renderCharacterReview({
      scanResult: ui.characterScan,
      detecting: ui.characterDetecting,
      collapsedSections: ui.collapsedCharacterSections,
      legend: () => ui.legend(),
      renderRow: (g, editable) => ui.row(g, editable, { rowId: g.reviewId, editState: ui.characterEdit, isEditing: ui.characterEdit?.reviewId === g.reviewId && editable }),
    }));
    if (ui.characterScan && !ui.characterDetecting) {
      syncCharacterSectionCheckboxes(ui, ui.characterScan);
      characterFooter(ui, ui.characterScan);
    }
    return;
  }
  ui.body(renderCharacterSetup({
    snapshot: ui.characterSnapshot,
    selection: ui.characterSelection,
    loading: ui.characterLoading,
    error: ui.characterError,
    ruleSummary: characterRuleSummary(ui),
  }));
  if (ui.characterSnapshot?.status === 'ready' && ui.characterSelection) {
    const { categories } = ui.characterSnapshot;
    if (categories.profile.available) {
      const el = ui.dialog.querySelector('[data-char-category="profile"]');
      if (el) el.indeterminate = categorySelectionState(categories.profile.items, ui.characterSelection.profileIds).indeterminate;
    }
    if (categories.world.available) {
      const el = ui.dialog.querySelector('[data-char-category="world"]');
      if (el) el.indeterminate = worldSelectionState(categories.world.entries, ui.characterSelection.world).indeterminate;
    }
    if (categories.meta.available) {
      const el = ui.dialog.querySelector('[data-char-category="meta"]');
      if (el) el.indeterminate = categorySelectionState(categories.meta.items, ui.characterSelection.metaIds).indeterminate;
    }
  }
}

export function refreshCharacterRows(ui, ids) {
  const scan = ui.characterScan;
  if (!scan) return;
  const rows = characterSelectionState(ui, scan);
  for (const id of new Set(ids)) {
    if (id === undefined || id === null) continue;
    const found = locateCharacterGroup(scan, id);
    if (!found) continue;
    const { group } = found;
    if (ready(group)) rows.set(group.reviewId, Boolean(group.selected)); else rows.delete(group.reviewId);
    const row = ui.dialog.querySelector(`.tr-rows > [data-group="${CSS.escape(String(id))}"]`);
    if (row) row.outerHTML = ui.row(group, true, { rowId: group.reviewId, editState: ui.characterEdit, isEditing: ui.characterEdit?.reviewId === group.reviewId });
  }
  syncCharacterSectionCheckboxes(ui, scan);
  characterFooter(ui, scan);
}

export function updateCharacterSelection(ui, changed = allCharacterGroups(ui.characterScan)) {
  const scan = ui.characterScan;
  if (!scan) return;
  const rows = characterSelectionState(ui, scan);
  for (const g of changed) {
    const eligible = ready(g), selected = Boolean(g.selected && eligible);
    if (eligible) rows.set(g.reviewId, selected); else rows.delete(g.reviewId);
    const control = ui.dialog.querySelector(`[data-toggle="${CSS.escape(String(g.reviewId))}"]`);
    if (!control) continue;
    control.setAttribute('aria-pressed', String(selected));
    control.setAttribute('aria-label', `${selected ? '取消选择' : '选择'}第${g.reviewId + 1}字段：${proposal(g)}`);
    control.closest('.tr-row')?.classList.toggle('tr-selected', selected);
  }
  syncCharacterSectionCheckboxes(ui, scan);
  const selected = [...rows.values()].filter(Boolean).length;
  const all = ui.dialog.querySelector('[data-all]');
  if (all) all.checked = Boolean(rows.size && rows.size === selected);
  const apply = ui.dialog.querySelector('[data-action="char-apply"]');
  if (apply) {
    apply.textContent = `应用所选 ${selected}`;
    apply.disabled = !selected || Boolean(ui.characterEdit) || ui.characterBusy;
  }
}

export function openSourceModal(ui, targetId) {
  if (ui.characterBusy) throw new Error('正在保存角色修改，请稍候。');
  const target = findSnapshotTarget(ui.characterSnapshot, targetId);
  if (!target) throw new Error('未找到对应的原文条目。');
  ui.sourceDraft = { targetId, title: target.modalTitle, original: target.text, text: target.text };
  ui.sourceModal.querySelector('h3').textContent = target.modalTitle;
  ui.sourceModal.querySelector('.tr-modal-body').innerHTML = `<div class="tr-source-editor">
    <textarea id="tr-source-editor" aria-label="${esc(target.modalTitle)}原文" rows="12">${esc(target.text)}</textarea>
    <div class="tr-source-foot">
      <span class="tr-meta" id="tr-source-count">${target.text.length} 字</span>
      <div class="tr-form-actions">${button('取消', 'data-action="cancel-source"')}${button('保存修改', 'class="tr-primary" data-action="save-source" disabled')}</div>
    </div>
  </div>`;
  if (!ui.sourceModal.open) ui.sourceModal.showModal();
  const focus = matchMedia('(pointer:coarse)').matches ? '[data-action="cancel-source"]' : '#tr-source-editor';
  ui.sourceModal.querySelector(focus)?.focus({ preventScroll: true });
}

export function closeSourceModal(ui, force = false) {
  const changed = ui.sourceDraft && ui.sourceDraft.text !== ui.sourceDraft.original;
  if (!force && changed && !globalThis.confirm('原文还有未保存的修改，确定放弃吗？')) return;
  ui.sourceModal.close();
}

export async function saveSourceModal(ui) {
  if (!ui.sourceDraft || ui.characterBusy) return;
  const { targetId, title, text, original } = ui.sourceDraft;
  if (text === original) { ui.sourceModal.close(); return; }
  ui.characterBusy = true;
  ui.updateBusyControls();
  ui.say(`正在保存“${title}”……`);
  try {
    const prevSnapshot = ui.characterSnapshot;
    const prevSelection = ui.characterSelection;
    await saveSingleCharacterTarget(ui.c.context(), prevSnapshot, targetId, text);
    const liveSnapshot = await inspectCharacterContext(ui.c.context());
    ui.characterSnapshot = liveSnapshot;
    ui.characterSelection = reconcileCharacterSelection(liveSnapshot, prevSelection, prevSnapshot);
    ui.sourceDraft = null;
    if (ui.sourceModal.open) ui.sourceModal.close();
    ui.say(`已保存“${title}”的修改。`);
  } finally {
    ui.characterBusy = false;
    if (ui.dialog.open) ui.render();
  }
}

export async function returnToCharacterSetup(ui) {
  if (ui.characterBusy) throw new Error('正在保存角色修改，请稍候。');
  if (ui.characterEdit) throw new Error('这句还有未完成的编辑，请先完成或取消编辑。');
  ui.characterDetection?.abort();
  ui.characterDetection = null;
  ui.characterScan = null;
  ui.characterEdit = null;
  ui.characterSelectionMap = null;
  ui.collapsedCharacterSections?.clear();
  ui.characterDetecting = false;
  ui.say('');
  const prevSnapshot = ui.characterSnapshot;
  const prevSelection = ui.characterSelection;
  try {
    const liveSnapshot = await inspectCharacterContext(ui.c.context());
    const sameCharacter = prevSnapshot?.status === 'ready' && liveSnapshot?.status === 'ready' && prevSnapshot.avatar === liveSnapshot.avatar && prevSnapshot.characterId === liveSnapshot.characterId;
    ui.characterSnapshot = liveSnapshot;
    ui.characterSelection = sameCharacter
      ? reconcileCharacterSelection(liveSnapshot, prevSelection, prevSnapshot)
      : createInitialCharacterSelection(liveSnapshot);
  } catch { /* Keep previous snapshot if refresh fails transiently. */ }
  if (ui.dialog.open && ui.screen === 'character') ui.render();
}

export function refreshCharacterEditor(ui) {
  const found = locateCharacterGroup(ui.characterScan, ui.characterEdit.reviewId);
  if (!found) return;
  const { group } = found;
  ui.characterEdit.text = proposal({ ...group, kept: false, matches: ui.characterEdit.matches, manual: false });
  ui.characterEdit.expanded = true;
  ui.refreshCharacterRows([group.reviewId]);
}

export function finishCharacterEdit(ui, text = ui.characterEdit.text) {
  const found = locateCharacterGroup(ui.characterScan, ui.characterEdit.reviewId);
  if (!found) return;
  const { group } = found;
  group.matches = clone(ui.characterEdit.matches);
  group.manual = false;
  group.kept = false;
  group.manual = text !== proposal(group);
  group.draft = text;
  group.selected = ready(group);
  ui.characterEdit = null;
  ui.refreshCharacterRows([group.reviewId]);
}

export async function applyCharacterChanges(ui, undo = false) {
  if (ui.characterBusy) throw new Error('正在保存角色修改，请稍候。');
  if (ui.characterEdit) throw new Error('请先完成或取消当前编辑。');
  ui.characterBusy = true;
  ui.updateBusyControls();
  ui.say(undo ? '正在撤销角色修改并保存……' : '正在应用角色修改并保存……');
  try {
    const changed = await commitCharacterScan(ui.c.context(), ui.characterScan, { undo });
    if (!changed) { ui.say('没有需要应用的修改。'); return; }
    ui.say(undo ? '已撤销上次角色修改并保存。' : '已应用所选角色修改并保存。');
  } finally {
    ui.characterBusy = false;
    if (ui.dialog.open) ui.render();
  }
}

export async function handleCharacterClick(ui, data, b, e) {
  if (data.charExpand !== undefined && ui.characterSelection) {
    const prop = `${data.charExpand}Expanded`;
    ui.characterSelection[prop] = !ui.characterSelection[prop];
    ui.render();
    ui.dialog.querySelector(`[data-char-expand="${CSS.escape(data.charExpand)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (data.charPreview !== undefined) {
    openSourceModal(ui, data.charPreview);
    return true;
  }
  if (data.charSectionCollapse !== undefined) {
    ui.collapsedCharacterSections ??= new Set();
    if (ui.collapsedCharacterSections.has(data.charSectionCollapse)) ui.collapsedCharacterSections.delete(data.charSectionCollapse);
    else ui.collapsedCharacterSections.add(data.charSectionCollapse);
    ui.render();
    ui.dialog.querySelector(`[data-char-section-collapse="${CSS.escape(data.charSectionCollapse)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (ui.screen === 'character') {
    if (data.toggle !== undefined) {
      const found = locateCharacterGroup(ui.characterScan, data.toggle);
      if (!found) return true;
      if (ready(found.group)) found.group.selected = !found.group.selected;
      ui.updateCharacterSelection([found.group]);
      if (e.detail === 0) b.focus({ preventScroll: true });
      return true;
    }
    if (data.quick !== undefined) {
      if (ui.characterBusy) throw new Error('正在保存角色修改，请稍候。');
      const id = Number(data.quickGroup), found = locateCharacterGroup(ui.characterScan, id);
      if (!found) return true;
      if (ui.characterEdit && ui.characterEdit.reviewId !== id) throw new Error('请先完成或取消当前编辑。');
      const g = found.group;
      if (data.quick === 'restore') {
        g.kept = true; g.manual = false; g.draft = null; g.selected = false;
        g.matches.forEach(m => { m.done = true; });
      } else if (data.quick === 'delete') {
        g.kept = false; g.manual = true; g.draft = ''; g.selected = true;
      }
      ui.characterEdit = null;
      ui.refreshCharacterRows([id]);
      return true;
    }
    if (data.edit !== undefined) {
      if (ui.characterBusy) throw new Error('正在保存角色修改，请稍候。');
      const id = Number(data.edit), found = locateCharacterGroup(ui.characterScan, id);
      if (!found) return true;
      const previousId = ui.characterEdit?.reviewId;
      ui.characterEdit = { reviewId: id, sectionId: found.section.id, text: proposal(found.group), matches: clone(found.group.matches), expanded: false };
      ui.refreshCharacterRows([previousId, id]);
      ui.dialog.querySelector('#tr-edit')?.focus();
      return true;
    }
    if (data.random !== undefined || data.deleteMatch !== undefined) {
      const m = ui.characterEdit.matches.find(item => item.id === Number(data.random ?? data.deleteMatch));
      if (data.deleteMatch !== undefined) m.value = m.value === '' ? null : '';
      else { const values = m.options.filter(v => v !== m.value); m.value = values[Math.floor(Math.random() * values.length)]; }
      refreshCharacterEditor(ui);
      return true;
    }
    if (data.keep !== undefined) {
      const found = locateCharacterGroup(ui.characterScan, data.keep);
      if (!found) return true;
      const g = found.group;
      g.kept = true; g.selected = false; g.matches.forEach(m => { m.done = true; });
      ui.characterEdit = null;
      ui.refreshCharacterRows([g.reviewId]);
      return true;
    }
    if (data.action === 'cancel-edit' && ui.characterEdit) {
      const id = ui.characterEdit.reviewId;
      ui.characterEdit = null;
      ui.refreshCharacterRows([id]);
      return true;
    }
    if (data.action === 'delete-sentence' && ui.characterEdit) { finishCharacterEdit(ui, ''); return true; }
    if (data.action === 'finish-edit' && ui.characterEdit) { finishCharacterEdit(ui); return true; }
  }
  switch (data.action) {
    case 'save-source': await saveSourceModal(ui); return true;
    case 'char-refresh': await loadCharacterSnapshot(ui); return true;
    case 'char-scan': await detectCharacter(ui); return true;
    case 'char-back-setup': await returnToCharacterSetup(ui); return true;
    case 'char-apply': await applyCharacterChanges(ui, false); return true;
    case 'char-undo': await applyCharacterChanges(ui, true); return true;
    default: return false;
  }
}

export function handleCharacterInput(ui, el) {
  if (el.id === 'tr-source-editor' && ui.sourceDraft) {
    ui.sourceDraft.text = el.value;
    const count = ui.sourceModal.querySelector('#tr-source-count');
    if (count) count.textContent = `${ui.sourceDraft.text.length} 字`;
    const saveBtn = ui.sourceModal.querySelector('[data-action="save-source"]');
    if (saveBtn) saveBtn.disabled = ui.sourceDraft.text === ui.sourceDraft.original;
    return true;
  }
  if (el.id === 'tr-edit' && ui.screen === 'character' && ui.characterEdit) {
    ui.characterEdit.text = el.value;
    const found = locateCharacterGroup(ui.characterScan, ui.characterEdit.reviewId);
    const preview = found && ui.dialog.querySelector(`[data-edit-preview="${found.group.reviewId}"] .tr-sentence`);
    if (preview) preview.innerHTML = inlineHTML({ ...found.group, kept: false, manual: true, draft: ui.characterEdit.text });
    return true;
  }
  return false;
}

export function handleCharacterChange(ui, el) {
  if (el.dataset.charCategory !== undefined && ui.characterSelection && ui.characterSnapshot?.status === 'ready') {
    const key = el.dataset.charCategory;
    const { categories } = ui.characterSnapshot;
    if (key === 'world') toggleWorldAll(categories.world.entries, ui.characterSelection.world, el.checked);
    else if (key === 'profile') toggleCategoryAll(categories.profile.items, ui.characterSelection.profileIds, el.checked);
    else if (key === 'meta') toggleCategoryAll(categories.meta.items, ui.characterSelection.metaIds, el.checked);
    else ui.characterSelection[key] = el.checked;
    ui.render();
    ui.dialog.querySelector(`[data-char-category="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (el.dataset.charItem !== undefined && ui.characterSelection && ui.characterSnapshot?.status === 'ready') {
    const cat = el.dataset.charItemCategory;
    const ids = cat === 'meta' ? ui.characterSelection.metaIds : ui.characterSelection.profileIds;
    toggleCategoryItem(ids, el.dataset.charItem, el.checked);
    ui.render();
    ui.dialog.querySelector(`[data-char-item="${CSS.escape(el.dataset.charItem)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (el.hasAttribute('data-world-all') && ui.characterSelection && ui.characterSnapshot?.status === 'ready') {
    toggleWorldAll(ui.characterSnapshot.categories.world.entries, ui.characterSelection.world, el.checked);
    ui.render();
    ui.dialog.querySelector('[data-world-all]')?.focus({ preventScroll: true });
    return true;
  }
  if (el.dataset.worldLight !== undefined && ui.characterSelection && ui.characterSnapshot?.status === 'ready') {
    toggleWorldLight(ui.characterSnapshot.categories.world.entries, ui.characterSelection.world, el.dataset.worldLight, el.checked);
    ui.render();
    ui.dialog.querySelector(`[data-world-light="${CSS.escape(el.dataset.worldLight)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (el.hasAttribute('data-world-enabled-only') && ui.characterSelection && ui.characterSnapshot?.status === 'ready') {
    toggleWorldEnabledOnly(ui.characterSnapshot.categories.world.entries, ui.characterSelection.world, el.checked);
    ui.render();
    ui.dialog.querySelector('[data-world-enabled-only]')?.focus({ preventScroll: true });
    return true;
  }
  if (el.dataset.worldEntry !== undefined && ui.characterSelection && ui.characterSnapshot?.status === 'ready') {
    toggleWorldEntry(ui.characterSnapshot.categories.world.entries, ui.characterSelection.world, el.dataset.worldEntry, el.checked);
    ui.render();
    ui.dialog.querySelector(`[data-world-entry="${CSS.escape(el.dataset.worldEntry)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (el.dataset.charSectionAll !== undefined && ui.characterScan) {
    const section = ui.characterScan.sections.find(s => s.id === el.dataset.charSectionAll);
    if (section) {
      section.groups.filter(ready).forEach(g => { g.selected = el.checked; });
      ui.updateCharacterSelection(section.groups);
    }
    return true;
  }
  if (ui.screen === 'character') {
    if (el.hasAttribute('data-all')) {
      allCharacterGroups(ui.characterScan).filter(ready).forEach(g => { g.selected = el.checked; });
      ui.updateCharacterSelection();
      return true;
    }
    if (el.dataset.option !== undefined && ui.characterEdit) {
      const m = ui.characterEdit.matches.find(item => item.id === Number(el.dataset.option));
      m.value = m.options[Number(el.value)];
      refreshCharacterEditor(ui);
      return true;
    }
  }
  return false;
}
