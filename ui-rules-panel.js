// Rules & character-rules screens, rule/group/import modals, and their event handlers.
import { escapeHTML as esc, inlineHTML, validateRule, newId } from './engine.js';
import { clone } from './controller.js';
import { createRuleDraft, simpleRule } from './rule-editor.js';
import { renderRulesView } from './rules-view.js';
import { renderRuleForm } from './rule-form.js';
import { scanPrepared } from './scanner.js';
import { stringifyRuleSet, parseRuleSet, applyRuleSet, MAX_RULE_SET_BYTES } from './rule-transfer.js';
import { normalizeRuleGroups } from './rule-groups.js';
import { setCharacterBodyGroupOverride, setCharacterBodyRuleOverride, resetCharacterBodyRules } from './character-scan.js';
import { button } from './ui-primitives.js';

export function activeRuleScope(ui) {
  return ui.screen === 'character-rules' ? 'character' : 'body';
}

export function ruleStore(ui, scope = activeRuleScope(ui)) {
  const s = ui.c.settings();
  if (scope === 'character') {
    s.characterRules ??= [];
    s.characterRuleGroups ??= [];
    ui.characterRuleFilters ??= { search: '' };
    ui.collapsedCharacterRuleGroups ??= new Set(['__body__']);
    return {
      scope: 'character',
      screen: 'character-rules',
      rules: s.characterRules,
      groups: s.characterRuleGroups,
      ungroupedEnabled: s.characterUngroupedEnabled !== false,
      setRules: next => { s.characterRules = next; },
      setGroups: next => { s.characterRuleGroups = next; },
      setUngroupedEnabled: value => { s.characterUngroupedEnabled = Boolean(value); },
      filters: ui.characterRuleFilters,
      collapsed: ui.collapsedCharacterRuleGroups,
      showExecution: false,
      exportPrefix: '词句修订-角色规则',
    };
  }
  return {
    scope: 'body',
    screen: 'rules',
    rules: s.rules,
    groups: s.ruleGroups,
    ungroupedEnabled: s.ungroupedEnabled !== false,
    setRules: next => { s.rules = next; },
    setGroups: next => { s.ruleGroups = next; },
    setUngroupedEnabled: value => { s.ungroupedEnabled = Boolean(value); },
    filters: ui.ruleFilters,
    collapsed: ui.collapsedRuleGroups,
    showExecution: true,
    exportPrefix: '词句修订-规则',
  };
}

export function renderRulesPanel(ui) {
  const settings = ui.c.settings();
  const store = ruleStore(ui);
  ui.expandedBodyMirrorGroups ??= new Set();
  ui.body(renderRulesView(store.rules, store.filters, settings.ruleExecution, { active: ui.ruleDeleteMode, selectedIds: ui.ruleDeleteIds }, {
    ...settings,
    mode: store.scope,
    ruleGroups: store.groups,
    ungroupedEnabled: store.ungroupedEnabled,
    collapsedRuleGroups: store.collapsed,
    expandedBodyMirrorGroups: ui.expandedBodyMirrorGroups,
    bodyRules: settings.rules,
    bodyRuleGroups: settings.ruleGroups,
    bodyUngroupedEnabled: settings.ungroupedEnabled !== false,
  }));
  if (ui.ruleDeleteMode) {
    const count = ui.ruleDeleteIds.size;
    ui.dialog.querySelector('.tr-foot').innerHTML = `<span class="tr-meta">${count ? `已选择 ${count} 条规则` : '请选择一条或多条规则'}</span><div>${button('取消', 'data-action="cancel-rule-delete"')}${button(`确定删除${count ? ` ${count}` : ''}`, `data-action="confirm-rule-delete" ${count ? '' : 'disabled'}`)}</div>`;
  }
}

export function exportRules(ui) {
  const store = ruleStore(ui);
  const payload = store.scope === 'character'
    ? { rules: store.rules, ruleGroups: store.groups, ruleExecution: 'review' }
    : ui.c.settings();
  const text = stringifyRuleSet(payload);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${store.exportPrefix}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  ui.say(`已导出 ${store.rules.length} 条规则。文件不包含聊天、记录或其他设置。`);
}

export function exportRawRules(ui) {
  const store = ruleStore(ui);
  const data = { type: 'henge-legacy-rule-backup', exportedAt: new Date().toISOString(), rules: clone(store.rules) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${store.exportPrefix}-旧规则备份-${Date.now()}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  ui.say('已发起旧规则原始备份下载；该备份仅用于保留资料，不能作为新版规则集导入。');
}

export async function openRuleImport(ui, file) {
  if (file.size > MAX_RULE_SET_BYTES) throw new Error('JSON 文件超过 25 MB，无法导入。');
  const imported = parseRuleSet(await file.text());
  const store = ruleStore(ui);
  ui.ruleScope = store.scope;
  ui.ruleImport = imported;
  const mode = store.showExecution ? (imported.ruleExecution === 'auto' ? '自动应用' : '人工审查') : '人工审查';
  const examples = imported.rules.slice(0, 5).map(rule => `<li>${esc(rule.find)}</li>`).join('');
  const migration = imported.priorityMigration.length > 1 ? `<div class="tr-save-pending">旧规则中的 ${imported.priorityMigration.join('、')} 等数字优先级会归为“高”，不同旧数字之间的顺序可能变化。受影响规则：${imported.priorityMigrationRules.slice(0, 5).map(rule => esc(rule.find)).join('、')}${imported.priorityMigrationRules.length > 5 ? `等 ${imported.priorityMigrationRules.length} 条` : ''}。导入后可逐条调整。</div>` : '';
  const scopeHint = store.showExecution
    ? '追加：保留现有规则、分组开关和当前处理方式，同名分组会合并，跳过重复规则。<br>替换全部：清除现有规则和分组，并采用文件中的处理方式。'
    : '追加：保留现有角色规则与分组，同名分组会合并，跳过重复规则。<br>替换全部：清除现有角色规则和分组（不影响正文规则）。所有导入规则统一采用人工审查。';
  ui.importModal.querySelector('.tr-modal-body').innerHTML = `<p><strong>${esc(file.name)}</strong></p><p>共 ${imported.rules.length} 条规则、${imported.groups.length} 个分组 · 处理方式：${mode}</p>${migration}${examples ? `<ul class="tr-import-list">${examples}</ul>${imported.rules.length > 5 ? `<p class="tr-meta">另有 ${imported.rules.length - 5} 条规则未在这里展开。</p>` : ''}` : '<p class="tr-meta">这是一个空规则集。</p>'}<p class="tr-meta">${scopeHint}</p><div class="tr-form-actions"><button type="button" data-action="cancel-import">取消</button><button type="button" data-action="import-append" ${imported.rules.length || imported.groups.length ? '' : 'disabled'}>追加</button><button type="button" class="tr-primary" data-action="import-replace">替换全部</button></div>`;
  if (!ui.importModal.open) ui.importModal.showModal();
}

export function importRules(ui, mode) {
  if (!ui.ruleImport) throw new Error('请重新选择要导入的 JSON 文件。');
  const settings = ui.c.settings();
  const store = ruleStore(ui, ui.ruleScope ?? activeRuleScope(ui));
  const result = applyRuleSet(store.rules, ui.ruleImport, mode, store.groups, { forceReview: !store.showExecution });
  store.setRules(result.rules);
  store.setGroups(result.groups);
  if (store.showExecution && result.ruleExecution) settings.ruleExecution = result.ruleExecution;
  ui.c.saveSettings();
  ui.ruleId = null;
  ui.ruleDrafts.clear();
  ui.importModal.close();
  ui.render();
  const skipped = result.skipped ? `，跳过 ${result.skipped} 条重复规则` : '';
  ui.say(`${mode === 'append' ? '已追加' : '已替换'} ${result.added} 条规则${skipped}。重新检测后生效。`);
}

export function openRuleModal(ui, ruleId = 'new') {
  const store = ruleStore(ui);
  ui.ruleScope = store.scope;
  ui.ruleId = ruleId;
  if (!ui.ruleDrafts.has(ruleId)) ui.ruleDrafts.set(ruleId, createRuleDraft(store.rules.find(r => r.id === ruleId)));
  const draft = ui.ruleDrafts.get(ruleId);
  ui.ruleOriginal = JSON.stringify(draft);
  ui.ruleModal.querySelector('h3').textContent = ruleId === 'new' ? '新建规则' : '编辑规则';
  ui.ruleModal.querySelector('.tr-modal-body').innerHTML = renderRuleForm(draft, { canDelete: ruleId !== 'new', groups: store.groups, showExecution: store.showExecution });
  if (!ui.ruleModal.open) ui.ruleModal.showModal();
  // Do not summon the phone keyboard just by opening an existing rule.
  const focus = matchMedia('(pointer:coarse)').matches ? '[data-action="cancel-rule"]' : '#tr-find';
  ui.ruleModal.querySelector(focus)?.focus({ preventScroll: true });
}

export function closeRuleModal(ui, force = false) {
  const draft = ui.ruleDrafts.get(ui.ruleId);
  const changed = draft && ui.ruleOriginal !== null && JSON.stringify(draft) !== ui.ruleOriginal;
  if (!force && changed && !globalThis.confirm('这条规则还有未保存的修改，确定放弃吗？')) return;
  ui.ruleModal.close();
}

export function openGroupModal(ui, groupId = null) {
  const store = ruleStore(ui);
  ui.ruleScope = store.scope;
  ui.groupId = groupId;
  const group = store.groups.find(item => item.id === groupId);
  const execution = group?.execution ?? 'inherit';
  const executionControl = store.showExecution
    ? `<label class="tr-field">处理方式<span class="tr-setting-select"><select id="tr-group-execution"><option value="inherit" ${execution === 'inherit' ? 'selected' : ''}>跟随全局</option><option value="auto" ${execution === 'auto' ? 'selected' : ''}>自动应用</option><option value="review" ${execution === 'review' ? 'selected' : ''}>人工审查</option></select><svg class="tr-select-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="m2 4 4 4 4-4"/></svg></span></label>`
    : '';
  ui.groupModal.querySelector('h3').textContent = group ? '编辑分组' : '新建分组';
  ui.groupModal.querySelector('.tr-modal-body').innerHTML = `<form id="tr-group-form" class="tr-rule-editor"><label class="tr-field">分组名称<input id="tr-group-name" required maxlength="40" value="${esc(group?.name ?? '')}" autocomplete="off"></label>${executionControl}<div class="tr-form-actions">${button('取消', 'data-action="cancel-group"')}<button type="submit" class="tr-primary">保存分组</button></div></form>`;
  if (!ui.groupModal.open) ui.groupModal.showModal();
  ui.groupModal.querySelector('#tr-group-name')?.focus({ preventScroll: true });
}

export function draftRule(ui) {
  const store = ruleStore(ui, ui.ruleScope ?? activeRuleScope(ui));
  const rule = simpleRule(ui.ruleDrafts.get(ui.ruleId), store.rules.find(r => r.id === ui.ruleId));
  if (!store.showExecution) rule.execution = 'review';
  return rule;
}

export async function previewRule(ui) {
  const draft = ui.ruleDrafts.get(ui.ruleId), sample = draft.sample ?? '';
  if (!sample.trim()) throw new Error('请先填写测试文字。');
  if (sample.length > 8000) throw new Error('测试文字最多 8000 字。');
  const target = ui.dialog.querySelector('#tr-rule-preview');
  const inputSnapshot = JSON.stringify(draft), previewId = ui.previewId = (ui.previewId ?? 0) + 1;
  target.textContent = '正在检测…';
  try {
    const rule = { ...draftRule(ui), enabled: true };
    const round = await scanPrepared(sample, [rule], { context: ui.c.context() });
    if (!target.isConnected || !ui.ruleModal.open || ui.previewId !== previewId || JSON.stringify(draft) !== inputSnapshot) return;
    target.innerHTML = round.groups.map(g => `<p class="tr-sentence">${inlineHTML(g)}</p><p class="tr-meta">${g.matches.map(m => Object.entries(m.captures).map(([key, value]) => `${esc(key)} = ${esc(value)}`).join('；')).filter(Boolean).join('<br>')}</p>`).join('') || '<p class="tr-meta">没有命中这条规则。</p>';
  } catch (error) {
    if (target.isConnected && ui.ruleModal.open && ui.previewId === previewId && JSON.stringify(draft) === inputSnapshot) target.textContent = error.message;
  }
}

export function handleRuleChoiceSummaryClick(ui, e) {
  const choiceSummary = e.target.closest('.tr-rule-choice-summary');
  if (!choiceSummary?.classList?.contains('tr-rule-choice-summary')) return false;
  e.preventDefault();
  const selectedChoice = choiceSummary.parentElement;
  const opening = !selectedChoice.open;
  ui.ruleModal.querySelectorAll('.tr-rule-choice[open]').forEach(choice => { choice.open = false; });
  selectedChoice.classList.remove('tr-choice-up');
  selectedChoice.open = opening;
  if (opening) {
    const boundary = selectedChoice.closest('.tr-modal-body').getBoundingClientRect();
    const trigger = choiceSummary.getBoundingClientRect();
    const below = boundary.bottom - trigger.bottom, above = trigger.top - boundary.top;
    const menu = selectedChoice.querySelector('.tr-rule-choice-options');
    const openUp = below + 8 < menu.getBoundingClientRect().height && above > below;
    if (openUp) selectedChoice.classList.add('tr-choice-up');
    selectedChoice.style.setProperty('--tr-choice-space', `${Math.max(44, Math.floor((openUp ? above : below) + 2))}px`);
  }
  return true;
}

export async function handleRulesClick(ui, data, b) {
  if (data.ruleChoiceValue !== undefined) {
    const choice = b.closest('[data-rule-choice]');
    if (!choice || !ui.ruleDrafts.has(ui.ruleId)) return true;
    const field = choice.dataset.ruleChoice;
    ui.ruleDrafts.get(ui.ruleId)[field] = field === 'priorityLevel' ? Number(data.ruleChoiceValue) : data.ruleChoiceValue;
    choice.querySelectorAll('[data-rule-choice-value]').forEach(option => option.setAttribute('aria-pressed', String(option === b)));
    const summary = choice.querySelector('summary');
    summary.querySelector('.tr-rule-choice-current').textContent = b.textContent;
    summary.setAttribute('aria-label', `${choice.parentElement.querySelector('.tr-rule-choice-label').textContent}：${b.textContent}`);
    choice.open = false;
    summary.focus({ preventScroll: true });
    const preview = ui.ruleModal.querySelector('#tr-rule-preview');
    if (preview) preview.textContent = '';
    return true;
  }
  if (data.action === 'clear-rule-search') {
    const filters = ui.screen === 'character-rules' ? (ui.characterRuleFilters ??= { search: '' }) : ui.ruleFilters;
    filters.search = ''; ui.render();
    ui.dialog.querySelector('[data-rule-filter="search"]')?.focus({ preventScroll: true });
    return true;
  }
  if (data.groupCollapse !== undefined) {
    const collapsed = ui.screen === 'character-rules' ? (ui.collapsedCharacterRuleGroups ??= new Set(['__body__'])) : ui.collapsedRuleGroups;
    if (collapsed.has(data.groupCollapse)) collapsed.delete(data.groupCollapse);
    else collapsed.add(data.groupCollapse);
    ui.render();
    ui.dialog.querySelector(`[data-group-collapse="${CSS.escape(data.groupCollapse)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (data.bodyGroupCollapse !== undefined) {
    ui.expandedBodyMirrorGroups ??= new Set();
    if (ui.expandedBodyMirrorGroups.has(data.bodyGroupCollapse)) ui.expandedBodyMirrorGroups.delete(data.bodyGroupCollapse);
    else ui.expandedBodyMirrorGroups.add(data.bodyGroupCollapse);
    ui.render();
    ui.dialog.querySelector(`[data-body-group-collapse="${CSS.escape(data.bodyGroupCollapse)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (data.ruleDelete !== undefined) {
    if (ui.ruleDeleteIds.has(data.ruleDelete)) ui.ruleDeleteIds.delete(data.ruleDelete);
    else ui.ruleDeleteIds.add(data.ruleDelete);
    ui.render();
    return true;
  }
  if (data.rule) { ui.say(''); ui.openRuleModal(data.rule); return true; }

  switch (data.action) {
    case 'char-reset-body-rules':
      resetCharacterBodyRules(ui.c.settings());
      ui.c.saveSettings(); ui.render();
      ui.say('正文规则已恢复默认，与正文修订保持同步。');
      return true;
    case 'new-group':
      if (ruleStore(ui).groups.length >= 50) throw new Error('分组最多 50 个。');
      ui.openGroupModal(); return true;
    case 'edit-group': ui.openGroupModal(data.groupId); return true;
    case 'delete-group': {
      const store = ruleStore(ui), group = store.groups.find(item => item.id === data.groupId);
      if (!group || !globalThis.confirm(`删除分组“${group.name}”？组内规则会移到“未分组”。`)) return true;
      store.setRules(store.rules.map(rule => rule.groupId === group.id ? { ...rule, groupId: null } : rule));
      store.setGroups(store.groups.filter(item => item.id !== group.id));
      store.collapsed.delete(group.id);
      ui.c.saveSettings(); ui.render(); ui.say('分组已删除，组内规则已移到“未分组”。重新检测后生效。');
      return true;
    }
    case 'dismiss-priority-notice': delete ui.c.settings().priorityMigrationNotice; ui.c.saveSettings(); ui.render(); return true;
    case 'begin-rule-delete': ui.ruleDeleteMode = true; ui.ruleDeleteIds.clear(); ui.say(''); ui.render(); return true;
    case 'cancel-rule-delete': ui.ruleDeleteMode = false; ui.ruleDeleteIds.clear(); ui.say(''); ui.render(); return true;
    case 'confirm-rule-delete': {
      if (!ui.ruleDeleteIds.size) return true;
      const store = ruleStore(ui), count = ui.ruleDeleteIds.size;
      store.setRules(store.rules.filter(rule => !ui.ruleDeleteIds.has(rule.id)));
      ui.ruleDeleteIds.forEach(id => ui.ruleDrafts.delete(id));
      ui.ruleDeleteMode = false; ui.ruleDeleteIds.clear();
      ui.c.saveSettings(); ui.render(); ui.say(`已删除 ${count} 条规则，重新检测后生效。`);
      return true;
    }
    case 'export-rules': exportRules(ui); return true;
    case 'export-rules-raw': exportRawRules(ui); return true;
    case 'import-rules': ui.dialog.querySelector('#tr-rule-import-file')?.click(); return true;
    case 'import-append': importRules(ui, 'append'); return true;
    case 'import-replace': importRules(ui, 'replace'); return true;
    case 'preview-rule': await previewRule(ui); return true;
    case 'new-rule': ui.openRuleModal(); return true;
    case 'cancel-rule':
      if (ui.ruleModal.open) ui.closeRuleModal();
      else { ui.ruleDrafts.delete(ui.ruleId); ui.ruleId = null; ui.render(); }
      return true;
    case 'delete-current-rule': {
      const store = ruleStore(ui, ui.ruleScope ?? activeRuleScope(ui));
      const rule = store.rules.find(r => r.id === ui.ruleId);
      if (!rule || !globalThis.confirm('确定删除这条规则吗？此操作无法撤销。')) return true;
      store.setRules(store.rules.filter(r => r.id !== rule.id));
      ui.c.saveSettings(); ui.ruleDrafts.delete(rule.id); ui.ruleId = null; ui.ruleOriginal = null;
      ui.ruleModal.close(); ui.render(); ui.say('已删除此规则，重新检测后生效。');
      return true;
    }
    default: return false;
  }
}

export function handleRulesInput(ui, el) {
  if (el.dataset.ruleFilter) {
    const key = el.dataset.ruleFilter, position = el.selectionStart;
    const filters = ui.screen === 'character-rules' ? (ui.characterRuleFilters ??= { search: '' }) : ui.ruleFilters;
    filters[key] = el.value; ui.render();
    const input = ui.dialog.querySelector(`[data-rule-filter="${key}"]`); input?.focus();
    if (key === 'search') input.setSelectionRange(position, position);
    return true;
  }
  if (el.dataset.ruleField) {
    ui.ruleDrafts.get(ui.ruleId)[el.dataset.ruleField] = el.type === 'checkbox' ? el.checked : el.value;
    const preview = ui.dialog.querySelector('#tr-rule-preview');
    if (preview) preview.textContent = '';
    return true;
  }
  return false;
}

export async function handleRulesChange(ui, el) {
  if (el.id === 'tr-rule-import-file') {
    const file = el.files?.[0];
    el.value = '';
    if (file) await openRuleImport(ui, file);
    return true;
  }
  if (el.dataset.ruleField || el.dataset.ruleFilter) {
    handleRulesInput(ui, el);
    return true;
  }
  if (el.dataset.charIncludeBody !== undefined) {
    ui.c.settings().characterIncludeBodyRules = el.checked;
    ui.c.saveSettings(); ui.render();
    ui.dialog.querySelector('[data-char-include-body]')?.focus({ preventScroll: true });
    return true;
  }
  if (el.dataset.charBodyGroup !== undefined) {
    setCharacterBodyGroupOverride(ui.c.settings(), el.dataset.charBodyGroup, el.checked);
    ui.c.saveSettings(); ui.render();
    ui.dialog.querySelector(`[data-char-body-group="${CSS.escape(el.dataset.charBodyGroup)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (el.dataset.charBodyRule !== undefined) {
    setCharacterBodyRuleOverride(ui.c.settings(), el.dataset.charBodyRule, el.checked);
    ui.c.saveSettings(); ui.render();
    ui.dialog.querySelector(`[data-char-body-rule="${CSS.escape(el.dataset.charBodyRule)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (el.hasAttribute('data-ungrouped-enabled')) {
    const store = ruleStore(ui);
    store.setUngroupedEnabled(el.checked);
    ui.c.saveSettings(); ui.render();
    ui.dialog.querySelector('[data-ungrouped-enabled]')?.focus({ preventScroll: true });
    return true;
  }
  if (el.dataset.ruleDeleteCheck !== undefined) {
    if (el.checked) ui.ruleDeleteIds.add(el.dataset.ruleDeleteCheck);
    else ui.ruleDeleteIds.delete(el.dataset.ruleDeleteCheck);
    ui.render();
    return true;
  }
  if (el.dataset.ruleEnabled) {
    const store = ruleStore(ui);
    store.rules.find(r => r.id === el.dataset.ruleEnabled).enabled = el.checked;
    ui.c.saveSettings(); ui.render();
    ui.dialog.querySelector(`[data-rule-enabled="${CSS.escape(el.dataset.ruleEnabled)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  if (el.dataset.groupEnabled !== undefined) {
    const store = ruleStore(ui);
    const group = store.groups.find(item => item.id === el.dataset.groupEnabled);
    if (!group) throw new Error('分组已不存在，请重新打开规则页。');
    group.enabled = el.checked;
    ui.c.saveSettings(); ui.render();
    ui.dialog.querySelector(`[data-group-enabled="${CSS.escape(group.id)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  return false;
}

export function handleRulesSubmit(ui, form) {
  if (form.id === 'tr-group-form') {
    const store = ruleStore(ui, ui.ruleScope ?? activeRuleScope(ui));
    const name = ui.groupModal.querySelector('#tr-group-name')?.value.trim();
    const execution = store.showExecution ? (ui.groupModal.querySelector('#tr-group-execution')?.value ?? 'inherit') : 'review';
    const current = store.groups.find(item => item.id === ui.groupId);
    const updated = current ? store.groups.map(item => item.id === current.id ? { ...item, name, execution } : item)
      : [...store.groups, { id: newId(), name, enabled: true, execution }];
    store.setGroups(normalizeRuleGroups(updated));
    ui.c.saveSettings(); ui.groupModal.close(); ui.render(); ui.say('分组已保存，重新检测后生效。');
    return true;
  }
  if (form.id !== 'tr-rule-form') return false;
  const store = ruleStore(ui, ui.ruleScope ?? activeRuleScope(ui));
  const old = store.rules.find(r => r.id === ui.ruleId);
  const rule = draftRule(ui);
  if (rule.groupId && !store.groups.some(group => group.id === rule.groupId)) throw new Error('所属分组已不存在，请重新选择。');
  const rules = store.rules;
  const signature = r => { const { id, enabled, ...content } = validateRule(r); return JSON.stringify(content); };
  if (rules.some(r => r.id !== rule.id && signature(r) === signature(rule))) throw new Error('已经有完全相同的规则。');
  if (old) rules.splice(rules.indexOf(old), 1, rule);
  else { if (rules.length >= 200) throw new Error('最多保存 200 条规则。'); rules.push(rule); }
  const inModal = ui.ruleModal.open;
  ui.c.saveSettings(); ui.ruleDrafts.delete(ui.ruleId); ui.ruleId = null; ui.ruleOriginal = null; ui.screen = store.screen;
  if (inModal) ui.ruleModal.close();
  ui.render(); ui.say('规则已保存，下次检测生效。');
  return true;
}
