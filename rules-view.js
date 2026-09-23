import { escapeHTML as esc } from './engine.js';
import { isLegacyRule } from './rule-editor.js';
const button = (text, attrs) => `<button type="button" ${attrs}>${text}</button>`;
const hostIcon = (name, label, action) => button(`<i class="fa-solid fa-${name}" aria-hidden="true"></i>`, `class="tr-icon" data-action="${action}" aria-label="${label}" title="${label}"`);

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

export const ruleCountText = rules => `已启用 ${rules.filter(rule => rule.enabled !== false).length} / ${rules.length}`;

export function ruleExecutionStatus(execution, { enabled = true, autoScan = true } = {}) {
  if (!enabled) return '插件已停用';
  if (!autoScan) return '已关闭自动检测，可手动检测';
  return execution === 'auto' ? '自动检测并应用' : '自动检测，人工审查';
}

export function renderRulesView(all, f, execution = 'review', deletion = {}, settings = {}) {
  const rules = all.filter(r => !f.search || [r.find, ...(r.values ?? [])].join(' ').toLowerCase().includes(f.search.toLowerCase()));
  const deleteMode = Boolean(deletion.active), selectedIds = deletion.selectedIds instanceof Set ? deletion.selectedIds : new Set(deletion.selectedIds ?? []);
  const row = r => {
    const visibleFind = summarizeRuleFind(r.find);
    const action = r.action === 'delete' ? '删除' : r.action === 'review' ? '仅提示' : (r.values?.length > 1 ? '随机替换' : '替换');
    const selected = selectedIds.has(r.id);
    const rowAction = deleteMode
      ? `class="tr-rule" data-rule-delete="${esc(r.id)}" aria-pressed="${selected}" aria-label="${selected ? '取消选择' : '选择'}要删除的规则：${esc(r.find)}"`
      : `class="tr-rule" data-rule="${esc(r.id)}" aria-label="编辑规则：${esc(r.find)}"`;
    const rowControl = deleteMode
      ? `<label class="tr-select tr-rule-delete-check"><input type="checkbox" data-rule-delete-check="${esc(r.id)}" aria-label="选择要删除的规则：${esc(r.find)}" ${selected ? 'checked' : ''}></label>`
      : `<label class="tr-select"><input type="checkbox" data-rule-enabled="${esc(r.id)}" aria-label="启用规则：${esc(r.find)}" ${r.enabled !== false ? 'checked' : ''}></label>`;
    return `<section class="tr-rule-section ${selected ? 'tr-rule-delete-selected' : ''}"><div class="tr-rule-row">${button(`<span class="tr-rule-find" title="${esc(r.find)}">${esc(visibleFind)}</span><span class="tr-meta">${deleteMode ? (selected ? '已选择' : '选择') : `${action} ›`}</span>`, rowAction)}${rowControl}</div></section>`;
  };
  const unsupported = rules.filter(isLegacyRule);
  const executionStatus = `<div class="tr-execution-status"><span>${ruleExecutionStatus(execution, settings)}</span><span class="tr-execution-hint" aria-hidden="true">可前往设置修改</span></div>`;
  const ruleTools = deleteMode
    ? ''
    : `${button('删除', `data-action="begin-rule-delete" ${all.length ? '' : 'disabled'}`)}${button('新增', 'data-action="new-rule"')}${hostIcon('file-import', '导入 JSON 规则集', 'import-rules')}${unsupported.length ? button('备份旧规则', 'data-action="export-rules-raw"') : hostIcon('file-export', '导出 JSON 规则集', 'export-rules')}`;
  return `<div class="tr-bar ${deleteMode ? 'tr-rule-delete-bar' : ''}"><div class="tr-rule-search"><input data-rule-filter="search" aria-label="搜索规则" placeholder="搜索" value="${esc(f.search)}">${button('×', `class="tr-search-clear" data-action="clear-rule-search" aria-label="清空搜索" title="清空搜索" ${f.search ? '' : 'disabled'}`)}</div><div class="tr-rule-tools">${ruleTools}</div></div>${executionStatus}<input id="tr-rule-import-file" type="file" accept=".json,application/json" hidden>
    ${unsupported.length ? `<p class="tr-meta">检测到 ${unsupported.length} 条旧规则，当前引擎不再执行。请先备份规则，再删除或改写为正则。</p>` : ''}
    ${rules.map(row).join('')}
    ${!rules.length ? '<p class="tr-meta">没有符合搜索的规则。</p>' : ''}
    `;
}
