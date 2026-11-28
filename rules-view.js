import { escapeHTML as esc } from './engine.js';
import { isLegacyRule } from './rule-editor.js';
import { effectiveRules, PRIORITY_LABELS } from './rule-groups.js';
import { bodyRuleOverrideState } from './character-scan.js';
const button = (text, attrs) => `<button type="button" ${attrs}>${text}</button>`;
const hostIcon = (name, label, action) => button(`<i class="fa-solid fa-${name}" aria-hidden="true"></i>`, `class="tr-icon" data-action="${action}" aria-label="${label}" title="${label}"`);
const chevronIcon = closed => `<svg class="tr-group-chevron ${closed ? 'tr-chevron-closed' : ''}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

// Keep collapsed rules readable on narrow screens. Regex groups often contain
// implementation details rather than words a reader needs while browsing.
export function summarizeRuleFind(find) {
  const original = String(find ?? '');
  const source = original.replace(/\r?\n+/g, ', ');
  let summary = '', replaced = source !== original;
  for (let i = 0; i < source.length;) {
    if (source[i] === '\\') {
      summary += source.slice(i, i + 2);
      i += Math.min(2, source.length - i);
      continue;
    }
    if (source[i] === '[') {
      let end = i + 1;
      for (; end < source.length; end++) {
        if (source[end] === '\\') end++;
        else if (source[end] === ']') { end++; break; }
      }
      const characterClass = source.slice(i, end);
      const quantifier = source.slice(end).match(/^(?:[*+]|{\d+(?:,\d*)?})\??/);
      if (quantifier && (characterClass.startsWith('[^') || characterClass === '[\\s\\S]')) {
        summary += '*';
        replaced = true;
        end += quantifier[0].length;
      } else summary += characterClass;
      i = end;
      continue;
    }
    if (source[i] === '.') {
      const quantifier = source.slice(i + 1).match(/^[*+]\??/);
      if (quantifier) {
        summary += '*';
        replaced = true;
        i += 1 + quantifier[0].length;
        continue;
      }
    }
    if (source[i] !== '(') {
      summary += source[i++];
      continue;
    }
    let depth = 1, inClass = false, end = i + 1;
    for (; end < source.length && depth; end++) {
      const char = source[end];
      if (char === '\\') { end++; continue; }
      if (char === '[') inClass = true;
      else if (char === ']' && inClass) inClass = false;
      else if (!inClass && char === '(') depth++;
      else if (!inClass && char === ')') depth--;
    }
    if (depth) {
      summary += source[i++];
      continue;
    }
    summary += '*';
    replaced = true;
    i = end;
    const quantifier = source.slice(i).match(/^(?:[?*+]|{\d+(?:,\d*)?\})\??/);
    if (quantifier) i += quantifier[0].length;
  }
  return replaced ? summary.replace(/\*{2,}/g, '*') : source;
}

export const ruleCountText = (rules, groups = [], ungroupedEnabled = true) => `生效 ${effectiveRules(rules, groups, ungroupedEnabled).length} / ${rules.length}`;

export function characterRuleCountText(settings = {}) {
  const charRules = settings.characterRules ?? [];
  const charGroups = settings.characterRuleGroups ?? [];
  const charActive = effectiveRules(charRules, charGroups, settings.characterUngroupedEnabled !== false).length;
  const bodyState = bodyRuleOverrideState(settings);
  if (bodyState.includeBody) {
    return `角色 ${charActive}/${charRules.length} · 正文 ${bodyState.effectiveCount}`;
  }
  return `生效 ${charActive} / ${charRules.length}`;
}

export function ruleExecutionStatus(execution, { enabled = true, autoScan = true } = {}) {
  if (!enabled) return '插件已停用';
  if (!autoScan) return '已关闭自动检测，可手动检测';
  return execution === 'auto' ? '自动检测并应用' : '自动检测，人工审查';
}

export function renderRulesView(all, f, execution = 'review', deletion = {}, settings = {}) {
  const isCharacterMode = settings.mode === 'character';
  const searchTerm = (f.search ?? '').toLowerCase();
  const matchesSearch = r => !searchTerm || [r.find, ...(r.values ?? [])].join(' ').toLowerCase().includes(searchTerm);
  const rules = all.filter(matchesSearch);
  const groups = settings.ruleGroups ?? [];
  const groupIds = new Set(groups.map(group => group.id));
  const ungroupedEnabled = settings.ungroupedEnabled !== false;
  const collapsed = settings.collapsedRuleGroups ?? new Set();
  const expandedBodyGroups = settings.expandedBodyMirrorGroups ?? new Set();
  const deleteMode = Boolean(deletion.active), selectedIds = deletion.selectedIds instanceof Set ? deletion.selectedIds : new Set(deletion.selectedIds ?? []);

  const row = r => {
    const visibleFind = summarizeRuleFind(r.find);
    const action = r.action === 'delete' ? '删除' : r.action === 'review' ? '仅提示' : (r.values?.length > 1 ? '随机替换' : '替换');
    const override = isCharacterMode ? '' : (r.execution === 'auto' ? '自动' : r.execution === 'review' ? '审查' : '');
    const priority = PRIORITY_LABELS[r.priorityLevel ?? (Number(r.priority ?? 0) > 0 ? 1 : 2)] ?? '中';
    const selected = selectedIds.has(r.id);
    const rowAction = deleteMode
      ? `class="tr-rule" data-rule-delete="${esc(r.id)}" aria-pressed="${selected}" aria-label="${selected ? '取消选择' : '选择'}要删除的规则：${esc(r.find)}"`
      : `class="tr-rule" data-rule="${esc(r.id)}" aria-label="编辑规则：${esc(r.find)}"`;
    const rowControl = deleteMode
      ? `<label class="tr-select tr-rule-delete-check"><input type="checkbox" data-rule-delete-check="${esc(r.id)}" aria-label="选择要删除的规则：${esc(r.find)}" ${selected ? 'checked' : ''}></label>`
      : `<label class="tr-select"><input type="checkbox" data-rule-enabled="${esc(r.id)}" aria-label="启用规则：${esc(r.find)}" ${r.enabled !== false ? 'checked' : ''}></label>`;
    return `<section class="tr-rule-section ${selected ? 'tr-rule-delete-selected' : ''}"><div class="tr-rule-row">${button(`<span class="tr-rule-find" title="${esc(r.find)}">${esc(visibleFind)}</span><span class="tr-meta">${deleteMode ? (selected ? '已选择' : '选择') : `${priority} · ${override}${action} ›`}</span>`, rowAction)}${rowControl}</div></section>`;
  };
  const unsupported = rules.filter(isLegacyRule);
  const executionStatus = isCharacterMode
    ? `<div class="tr-execution-status"><span>角色检测仅手动触发并人工审查</span></div>`
    : `<div class="tr-execution-status"><span>${ruleExecutionStatus(execution, settings)}</span><span class="tr-execution-hint" aria-hidden="true">可前往设置修改</span></div>`;
  const ruleTools = deleteMode
    ? ''
    : `${button('删除', `data-action="begin-rule-delete" ${all.length ? '' : 'disabled'}`)}${button('新增', 'data-action="new-rule"')}${hostIcon('file-import', '导入 JSON 规则集', 'import-rules')}${unsupported.length ? button('备份旧规则', 'data-action="export-rules-raw"') : hostIcon('file-export', '导出 JSON 规则集', 'export-rules')}`;

  const renderBodyMirrorGroup = () => {
    if (!isCharacterMode) return '';
    const bodyAll = settings.bodyRules ?? [];
    const bodyGroups = settings.bodyRuleGroups ?? [];
    const bodyGroupIds = new Set(bodyGroups.map(g => g.id));
    const bodyState = bodyRuleOverrideState({
      ...settings,
      rules: bodyAll,
      ruleGroups: bodyGroups,
      ungroupedEnabled: settings.bodyUngroupedEnabled !== false,
    });
    const filteredBody = bodyAll.filter(matchesSearch);
    if (searchTerm && !filteredBody.length) return '';
    const closed = !searchTerm && collapsed.has('__body__');
    const controls = deleteMode
      ? ''
      : `<label class="tr-select tr-group-switch" title="同时启用正文规则"><input type="checkbox" data-char-include-body aria-label="同时启用正文规则" ${bodyState.includeBody ? 'checked' : ''}></label>`;

    const renderBodySubgroup = group => {
      const id = group?.id ?? '';
      const allMembers = bodyAll.filter(r => group ? r.groupId === id : (!r.groupId || !bodyGroupIds.has(r.groupId)));
      const members = filteredBody.filter(r => group ? r.groupId === id : (!r.groupId || !bodyGroupIds.has(r.groupId)));
      if (searchTerm && !members.length) return '';
      if (!group && !allMembers.length) return '';
      const enabled = bodyState.groupEnabled(id);
      const activeCount = allMembers.filter(r => bodyState.isRuleEffective(r)).length;
      const subOpen = Boolean(searchTerm) || expandedBodyGroups.has(id);
      const name = group?.name ?? '未分组';
      const subControl = deleteMode
        ? ''
        : `<label class="tr-select tr-group-switch" title="在角色检测中启用正文「${esc(name)}」分组"><input type="checkbox" data-char-body-group="${esc(id)}" aria-label="在角色检测中启用正文${esc(name)}分组" ${enabled ? 'checked' : ''}></label>`;
      const memberRows = members.map(r => {
        const visibleFind = summarizeRuleFind(r.find);
        const action = r.action === 'delete' ? '删除' : r.action === 'review' ? '仅提示' : (r.values?.length > 1 ? '随机替换' : '替换');
        const priority = PRIORITY_LABELS[r.priorityLevel ?? (Number(r.priority ?? 0) > 0 ? 1 : 2)] ?? '中';
        const checked = bodyState.ruleEnabled(r);
        const active = bodyState.isRuleEffective(r);
        const ruleControl = deleteMode
          ? ''
          : `<label class="tr-select"><input type="checkbox" data-char-body-rule="${esc(r.id)}" aria-label="在角色检测中启用正文规则：${esc(r.find)}" ${checked ? 'checked' : ''}></label>`;
        return `<section class="tr-rule-section"><div class="tr-rule-row tr-rule-readonly ${active ? '' : 'tr-rule-inactive'}"><div class="tr-rule tr-rule-static"><span class="tr-rule-find" title="${esc(r.find)}">${esc(visibleFind)}</span><span class="tr-meta">${priority} · ${action}</span></div>${ruleControl}</div></section>`;
      }).join('');
      return `<section class="tr-body-subgroup ${enabled ? '' : 'tr-group-disabled'}"><div class="tr-body-subgroup-head">${button(`${chevronIcon(!subOpen)}<span class="tr-body-subgroup-name">${esc(name)}</span><span class="tr-meta">生效 ${activeCount} / ${allMembers.length}</span>`, `class="tr-group-collapse" data-body-group-collapse="${esc(id)}" aria-expanded="${subOpen}" aria-label="${subOpen ? '收起' : '展开'}正文${esc(name)}分组" ${searchTerm ? 'disabled' : ''}`)}${subControl}</div>${subOpen ? `<div class="tr-body-subgroup-members">${memberRows || '<p class="tr-meta tr-group-empty">分组中还没有规则。</p>'}</div>` : ''}</section>`;
    };

    const subgroupsHtml = [renderBodySubgroup(null), ...bodyGroups.map(renderBodySubgroup)].join('');
    const toolbar = deleteMode
      ? ''
      : `<div class="tr-body-mirror-bar"><span class="tr-meta">勾选仅影响角色检测，不改动正文规则。</span>${button('正文规则恢复默认', `class="tr-body-reset-btn" data-action="char-reset-body-rules" ${bodyState.hasOverrides ? '' : 'disabled'}`)}</div>`;

    return `<section class="tr-rule-group tr-body-mirror-group ${bodyState.includeBody ? '' : 'tr-group-disabled'}"><div class="tr-group-heading">${button(`${chevronIcon(closed)}<strong>正文规则</strong><span class="tr-meta">生效 ${bodyState.effectiveCount} / ${bodyState.totalCount}${bodyState.hasOverrides ? ' · 已调整' : ''}</span>`, `class="tr-group-collapse" data-group-collapse="__body__" aria-expanded="${!closed}" aria-label="${closed ? '展开' : '收起'}正文规则" ${searchTerm ? 'disabled' : ''}`)}${controls}</div>${closed ? '' : `<div class="tr-group-members">${toolbar}${subgroupsHtml || '<p class="tr-meta tr-group-empty">正文规则为空。</p>'}</div>`}</section>`;
  };

  const renderGroup = group => {
    const id = group?.id ?? '';
    const members = rules.filter(rule => group ? rule.groupId === id : !rule.groupId || !groupIds.has(rule.groupId));
    if (searchTerm && !members.length) return '';
    const groupMembersAll = all.filter(rule => group ? rule.groupId === id : !rule.groupId || !groupIds.has(rule.groupId));
    const total = groupMembersAll.length;
    const isGroupEnabled = group ? group.enabled !== false : ungroupedEnabled;
    const active = isGroupEnabled ? groupMembersAll.filter(r => r.enabled !== false).length : 0;
    const closed = !searchTerm && collapsed.has(id);
    const name = group?.name ?? '未分组';
    const groupMode = isCharacterMode ? '' : (group?.execution === 'auto' ? '自动 · ' : group?.execution === 'review' ? '审查 · ' : '');
    const controls = deleteMode
      ? ''
      : group
        ? `<label class="tr-select tr-group-switch" title="${esc(name)}分组开关"><input type="checkbox" data-group-enabled="${esc(id)}" aria-label="启用${esc(name)}分组" ${isGroupEnabled ? 'checked' : ''}></label>${button('编辑', `class="tr-group-small" data-action="edit-group" data-group-id="${esc(id)}"`)}${button('删除', `class="tr-group-small" data-action="delete-group" data-group-id="${esc(id)}"`)}`
        : `<label class="tr-select tr-group-switch" title="未分组开关"><input type="checkbox" data-ungrouped-enabled aria-label="启用未分组规则" ${isGroupEnabled ? 'checked' : ''}></label>`;
    return `<section class="tr-rule-group ${isGroupEnabled ? '' : 'tr-group-disabled'}"><div class="tr-group-heading">${button(`${chevronIcon(closed)}<strong>${esc(name)}</strong><span class="tr-meta">${groupMode}生效 ${active} / ${total}</span>`, `class="tr-group-collapse" data-group-collapse="${esc(id)}" aria-expanded="${!closed}" aria-label="${closed ? '展开' : '收起'}${esc(name)}分组" ${searchTerm ? 'disabled' : ''}`)}${controls}</div>${closed ? '' : `<div class="tr-group-members">${members.map(row).join('') || '<p class="tr-meta tr-group-empty">分组中还没有规则。</p>'}</div>`}</section>`;
  };
  const migration = isCharacterMode ? null : settings.priorityMigrationNotice;
  const notice = migration?.values?.length ? `<div class="tr-save-pending">旧规则中的 ${migration.values.join('、')} 等数字优先级已归为“高”；不同旧数字之间的顺序可能变化。受影响规则：${migration.rules.slice(0, 5).map(rule => esc(rule.find)).join('、')}${migration.rules.length > 5 ? `等 ${migration.rules.length} 条` : ''}。${button('知道了', 'data-action="dismiss-priority-notice"')}</div>` : '';
  const bodyMirrorHtml = renderBodyMirrorGroup();
  const hasSearchHits = rules.length > 0 || Boolean(bodyMirrorHtml);
  return `<div class="tr-bar ${deleteMode ? 'tr-rule-delete-bar' : ''}"><div class="tr-rule-search"><input data-rule-filter="search" aria-label="搜索规则" placeholder="搜索" value="${esc(f.search)}">${button('×', `class="tr-search-clear" data-action="clear-rule-search" aria-label="清空搜索" title="清空搜索" ${f.search ? '' : 'disabled'}`)}</div>${deleteMode ? '' : `<div class="tr-group-create">${button('<span class="tr-group-long">＋ 新建分组</span><span class="tr-group-short">＋ 分组</span>', 'data-action="new-group" aria-label="新建分组"')}</div>`}<div class="tr-rule-tools">${ruleTools}</div></div>${executionStatus}<input id="tr-rule-import-file" type="file" accept=".json,application/json" hidden>
    ${unsupported.length ? `<p class="tr-meta">检测到 ${unsupported.length} 条旧规则，当前引擎不再执行。请先备份规则，再删除或改写为正则。</p>` : ''}
    ${notice}
    ${bodyMirrorHtml}${renderGroup(null)}${groups.map(renderGroup).join('')}
    ${searchTerm && !hasSearchHits ? '<p class="tr-meta">没有符合搜索的规则。</p>' : ''}
    `;
}
