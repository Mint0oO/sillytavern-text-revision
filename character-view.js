import { escapeHTML as esc } from './engine.js';
import { categorySelectionState, worldSelectionState, sectionSelectionState } from './character-scan.js';

const button = (text, attrs = '') => `<button type="button" ${attrs}>${text}</button>`;

const chevronSvg = closed => `<svg class="tr-group-chevron ${closed ? 'tr-chevron-closed' : ''}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

const LIGHT_LABELS = { blue: '蓝灯', green: '绿灯', vector: '向量' };
const charCountLabel = text => `${String(text ?? '').length} 字`;

function renderItemsDrawer(categoryKey, items, selectedIds) {
  const rows = items.map(item => {
    const checked = selectedIds.has(item.id);
    return `<div class="tr-char-entry">
      <label class="tr-select tr-char-entry-check"><input type="checkbox" data-char-item="${esc(item.id)}" data-char-item-category="${categoryKey}" aria-label="选择${esc(item.label)}" ${checked ? 'checked' : ''}></label>
      <button type="button" class="tr-char-entry-open" data-char-preview="${esc(item.id)}" aria-label="查看或编辑${esc(item.label)}原文">
        <span class="tr-char-entry-title" title="${esc(item.label)}">${esc(item.label)}</span>
        <span class="tr-char-entry-meta">${charCountLabel(item.text)}</span>
      </button>
    </div>`;
  }).join('');
  return `<div class="tr-char-drawer"><div class="tr-char-entry-list">${rows}</div></div>`;
}

function renderWorldDrawer(world, worldSelection) {
  const state = worldSelectionState(world.entries, worldSelection);
  const lightChecks = ['blue', 'green', ...(state.hasVector ? ['vector'] : [])].map(light => {
    const info = state.lights[light];
    return `<label class="tr-char-filter-chip ${info.disabled ? 'tr-is-disabled' : ''}"><input type="checkbox" data-world-light="${light}" ${info.checked ? 'checked' : ''} ${info.disabled ? 'disabled' : ''}><span class="tr-world-dot tr-world-dot-${light}" aria-hidden="true"></span><span>${LIGHT_LABELS[light]}</span></label>`;
  }).join('');

  const rows = world.entries.map(entry => {
    const checked = worldSelection.selectedUids.has(entry.uid);
    const previewId = `world:${entry.uid}`;
    return `<div class="tr-char-entry ${entry.enabled ? '' : 'tr-world-entry-disabled'}">
      <label class="tr-select tr-char-entry-check"><input type="checkbox" data-world-entry="${esc(entry.uid)}" aria-label="选择世界书条目：${esc(entry.title)}" ${checked ? 'checked' : ''}></label>
      <button type="button" class="tr-char-entry-open" data-char-preview="${esc(previewId)}" aria-label="查看或编辑世界书条目：${esc(entry.title)}">
        <span class="tr-world-dot tr-world-dot-${entry.light}" aria-hidden="true" title="${LIGHT_LABELS[entry.light]}"></span>
        <span class="tr-char-entry-title" title="${esc(entry.title)}">${esc(entry.title)}</span>
        ${entry.enabled ? '' : '<span class="tr-world-entry-badge">已停用</span>'}
        <span class="tr-char-entry-meta">${charCountLabel(entry.text)}</span>
      </button>
    </div>`;
  }).join('');

  return `<div class="tr-char-drawer tr-world-drawer">
    <div class="tr-world-filters" role="group" aria-label="世界书条目快捷筛选">
      <div class="tr-world-filter-lights">
        <label class="tr-char-filter-chip ${state.allDisabled ? 'tr-is-disabled' : ''}"><input type="checkbox" data-world-all ${state.allChecked ? 'checked' : ''} ${state.allDisabled ? 'disabled' : ''}><span>全部</span></label>
        ${lightChecks}
      </div>
      <label class="tr-char-filter-chip tr-world-enabled-only"><input type="checkbox" data-world-enabled-only ${state.enabledOnly ? 'checked' : ''}><span>仅已启用</span></label>
    </div>
    <div class="tr-world-list">${rows}</div>
  </div>`;
}

export function renderCharacterSetup({ snapshot, selection, loading = false, error = '', ruleSummary = { total: 0, charCount: 0, bodyCount: 0, includeBody: true } }) {
  if (loading) return '<div class="tr-empty">正在读取当前角色信息……</div>';
  if (error) return `<div class="tr-empty">${esc(error)}${button('重试', 'data-action="char-refresh"')}</div>`;
  if (!snapshot || snapshot.status !== 'ready') {
    return `<div class="tr-empty">${esc(snapshot?.reason || '请先打开一个角色聊天。')}</div>`;
  }

  const { categories } = snapshot;
  const profileState = categories.profile.available ? categorySelectionState(categories.profile.items, selection.profileIds) : null;
  const worldState = categories.world.available ? worldSelectionState(categories.world.entries, selection.world) : null;
  const metaState = categories.meta.available ? categorySelectionState(categories.meta.items, selection.metaIds) : null;

  const profileSub = !categories.profile.available
    ? '未检测出内容'
    : profileState.selectedCount === profileState.total
      ? categories.profile.summary
      : `${categories.profile.summary} · 已选 ${profileState.selectedCount}/${profileState.total}`;
  const worldSub = !categories.world.bound
    ? '未绑定'
    : categories.world.error
      ? categories.world.error
      : !categories.world.available
        ? '未检测出内容'
        : worldState.selectedCount === worldState.total
          ? `《${categories.world.worldName}》 · 共 ${worldState.total} 条`
          : `《${categories.world.worldName}》 · 已选 ${worldState.selectedCount}/${worldState.total} 条`;
  const metaSub = !categories.meta.available
    ? '未检测出内容'
    : metaState.selectedCount === metaState.total
      ? categories.meta.summary
      : `${categories.meta.summary} · 已选 ${metaState.selectedCount}/${metaState.total}`;
  const personaSub = categories.persona.available ? categories.persona.name : '未检测出内容';

  const anySelected = Boolean(
    (profileState?.active) ||
    (worldState?.active) ||
    (metaState?.active) ||
    (selection.persona && categories.persona.available)
  );
  const canScan = anySelected && ruleSummary.total > 0;

  const ruleBtnLabel = ruleSummary.total > 0
    ? (ruleSummary.includeBody && ruleSummary.bodyCount > 0
      ? `角色规则 · 生效 ${ruleSummary.total} 条（角色 ${ruleSummary.charCount} · 正文 ${ruleSummary.bodyCount}）`
      : `角色规则 · 生效 ${ruleSummary.total} 条`)
    : '角色规则 · 暂无生效规则';

  const row = ({ key, title, sub, available, checked, expanded = false, previewId = '', drawer = '' }) => {
    const body = available
      ? (previewId
        ? `<button type="button" class="tr-char-scope-toggle" data-char-preview="${esc(previewId)}" aria-label="查看或编辑${esc(title)}原文"><strong>${esc(title)}</strong><span class="tr-meta tr-char-scope-sub" title="${esc(sub)}">${esc(sub)}</span></button>`
        : `<button type="button" class="tr-char-scope-toggle" data-char-expand="${key}" aria-expanded="${expanded}" aria-label="${expanded ? '收起' : '展开'}${esc(title)}"><strong>${esc(title)}</strong><span class="tr-meta tr-char-scope-sub" title="${esc(sub)}">${esc(sub)}</span></button>`)
      : `<div class="tr-char-scope-static"><strong>${esc(title)}</strong><span class="tr-meta tr-char-scope-sub" title="${esc(sub)}">${esc(sub)}</span></div>`;
    return `<section class="tr-char-scope-item ${available ? '' : 'tr-char-scope-empty'}">
      <div class="tr-char-scope-head">
        <label class="tr-select tr-char-scope-check"><input type="checkbox" data-char-category="${key}" aria-label="选择${esc(title)}" ${available && checked ? 'checked' : ''} ${available ? '' : 'disabled'}></label>
        ${body}
      </div>
      ${drawer}
    </section>`;
  };

  return `<div class="tr-char-setup">
    <div class="tr-char-context">
      <span class="tr-char-name">当前角色：<strong>${esc(snapshot.characterName)}</strong></span>
      <span class="tr-meta">勾选框控制检测范围；点击类目展开条目，点击条目名可查看或编辑原文。</span>
    </div>
    <div class="tr-char-scope-list">
      ${row({ key: 'profile', title: '角色设定', sub: profileSub, available: categories.profile.available, checked: Boolean(profileState?.active), expanded: selection.profileExpanded, drawer: categories.profile.available && selection.profileExpanded ? renderItemsDrawer('profile', categories.profile.items, selection.profileIds) : '' })}
      ${row({ key: 'world', title: '世界书', sub: worldSub, available: categories.world.available, checked: Boolean(worldState?.active), expanded: selection.worldExpanded, drawer: categories.world.available && selection.worldExpanded ? renderWorldDrawer(categories.world, selection.world) : '' })}
      ${row({ key: 'meta', title: '指令与元信息', sub: metaSub, available: categories.meta.available, checked: Boolean(metaState?.active), expanded: selection.metaExpanded, drawer: categories.meta.available && selection.metaExpanded ? renderItemsDrawer('meta', categories.meta.items, selection.metaIds) : '' })}
      ${row({ key: 'persona', title: 'User 人设', sub: personaSub, available: categories.persona.available, checked: selection.persona, previewId: 'persona' })}
    </div>
    <div class="tr-char-actions">
      ${button(`<span class="tr-char-rules-label">${esc(ruleBtnLabel)}</span><span class="tr-char-rules-arrow" aria-hidden="true">›</span>`, 'class="tr-char-rules-entry" data-screen="character-rules"')}
      ${button('开始检测', `class="tr-primary" data-action="char-scan" ${canScan ? '' : 'disabled'}`)}
    </div>
  </div>`;
}

export function renderCharacterReview({ scanResult, detecting = false, collapsedSections = new Set(), legend, renderRow }) {
  if (detecting) return '<div class="tr-empty">正在检测所选角色内容……</div>';
  if (!scanResult) return '';
  const totalFields = scanResult.sections.reduce((sum, s) => sum + s.groups.length, 0);
  const bar = `<div class="tr-review-bar">
    <span title="字段按可独立修订的句段计数">${scanResult.count}处问题/${totalFields}字段　${esc(scanResult.characterName)}</span>
    ${legend()}
    ${button('重新检测', 'data-action="char-scan"')}
  </div>`;

  if (!scanResult.sections.length) {
    return `${bar}<div class="tr-empty">已检测 ${scanResult.targetCount} 项内容，未发现匹配的问题。</div>`;
  }

  const sectionsHtml = scanResult.sections.map(section => {
    const closed = collapsedSections.has(section.id);
    const secState = sectionSelectionState(section);
    return `<section class="tr-char-section ${closed ? 'tr-char-section-collapsed' : ''}" data-char-section="${esc(section.id)}">
      <header class="tr-char-section-head">
        <button type="button" class="tr-char-section-toggle" data-char-section-collapse="${esc(section.id)}" aria-expanded="${!closed}" aria-label="${closed ? '展开' : '收起'}${esc(section.label)}">
          ${chevronSvg(closed)}
          <h3>${esc(section.label)}</h3>
          <span class="tr-meta">${section.count} 处</span>
        </button>
        <label class="tr-select tr-char-section-check" title="全选或取消全选${esc(section.label)}">
          <input type="checkbox" data-char-section-all="${esc(section.id)}" aria-label="全选${esc(section.label)}" ${secState.checked ? 'checked' : ''} ${secState.disabled ? 'disabled' : ''}>
        </label>
      </header>
      ${closed ? '' : `<div class="tr-rows">${section.groups.map(group => renderRow(group, true)).join('')}</div>`}
    </section>`;
  }).join('');

  return `${bar}<div class="tr-char-results">${sectionsHtml}</div>`;
}
