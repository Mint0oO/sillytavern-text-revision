import { escapeHTML as esc } from './engine.js';
import { isLegacyRule } from './rule-editor.js';
const button = (text, attrs) => `<button type="button" ${attrs}>${text}</button>`;
const hostIcon = (name, label, action) => button(`<i class="fa-solid fa-${name}" aria-hidden="true"></i>`, `class="tr-icon" data-action="${action}" aria-label="${label}" title="${label}"`);

// Keep collapsed rules readable on narrow screens. Regex groups often contain
// implementation details rather than words a reader needs while browsing.
export function summarizeRuleFind(find) {
  const source = String(find ?? '');
  let summary = '', replaced = false;
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
      summary += source.slice(i, end);
      i = end;
      continue;
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
    summary += '…';
    replaced = true;
    i = end;
    const quantifier = source.slice(i).match(/^(?:[?*+]|{\d+(?:,\d*)?\})\??/);
    if (quantifier) i += quantifier[0].length;
  }
  return replaced ? summary.replace(/…{2,}/g, '…') : source;
}

export function renderRulesView(all, f, ruleId, form, d, execution = 'review') {
  const rules = all.filter(r => !f.search || [r.find, ...(r.values ?? [])].join(' ').toLowerCase().includes(f.search.toLowerCase()));
  const row = r => {
    const expanded = ruleId === r.id;
    const visibleFind = expanded ? r.find : summarizeRuleFind(r.find);
    const action = r.action === 'delete' ? '删除' : r.action === 'review' ? '仅提示' : (r.values?.length > 1 ? '随机替换' : '替换');
    return `<section class="tr-rule-section"><div class="tr-rule-row">${button(`<span class="tr-rule-find" title="${esc(r.find)}">${esc(visibleFind)}</span><span class="tr-meta">${action} ${expanded ? '⌃' : '⌄'}</span>`, `class="tr-rule" data-rule="${esc(r.id)}" aria-expanded="${expanded}" aria-label="${expanded ? '收起' : '展开并编辑'}规则：${esc(r.find)}"`)}<label class="tr-select"><input type="checkbox" data-rule-enabled="${esc(r.id)}" aria-label="启用规则：${esc(r.find)}" ${r.enabled !== false ? 'checked' : ''}></label></div>${expanded ? form() : ''}</section>`;
  };
  const current = rules.filter(r => !isLegacyRule(r)), legacy = rules.filter(isLegacyRule);
  return `<div class="tr-bar"><span>${rules.length} / ${all.length} 条规则</span><div class="tr-rule-tools">${hostIcon('file-export', '导出 JSON 规则集', 'export-rules')}${hostIcon('file-import', '导入 JSON 规则集', 'import-rules')}${button('＋ 新建', 'data-action="new-rule"')}</div></div><input id="tr-rule-import-file" type="file" accept=".json,application/json" hidden>
    <label class="tr-field">新格式规则的处理方式<select id="tr-rule-execution"><option value="review" ${execution === 'review' ? 'selected' : ''}>先审阅，再应用</option><option value="auto" ${execution === 'auto' ? 'selected' : ''}>回复结束后自动应用</option></select></label>
    <input data-rule-filter="search" aria-label="搜索规则" placeholder="搜索查找或替换内容" value="${esc(f.search)}">
    ${current.map(row).join('')}
    ${legacy.length ? `<details class="tr-legacy-rules" ${legacy.some(r => r.id === ruleId) || f.search ? 'open' : ''}><summary>旧版条件规则 · ${legacy.length}</summary>${legacy.map(row).join('')}</details>` : ''}
    ${!rules.length ? '<p class="tr-meta">没有符合搜索的规则。</p>' : ''}
    <details class="tr-bulk"><summary>批量添加</summary><p class="tr-meta">每行一条。只填查找内容表示删除；替换用 Tab 分隔查找和替换，可粘贴表格两列。替换候选用英文逗号分隔。</p><textarea data-bulk-field="text" aria-label="批量规则" rows="4" placeholder="每行填写一条规则">${esc(d.text)}</textarea><button type="button" data-action="bulk-add">添加这些规则</button></details>`;
}
