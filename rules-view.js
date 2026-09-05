import { escapeHTML as esc } from './engine.js';
import { isLegacyRule } from './rule-editor.js';
const button = (text, attrs) => `<button type="button" ${attrs}>${text}</button>`;

export function renderRulesView(all, f, ruleId, form, d, execution = 'review') {
  const rules = all.filter(r => !f.search || [r.find, ...(r.values ?? [])].join(' ').toLowerCase().includes(f.search.toLowerCase()));
  const row = r => `<section class="tr-rule-section"><div class="tr-rule-row">${button(`<span>${esc(r.find)}</span><span class="tr-meta">${r.action === 'delete' ? '删除' : r.action === 'review' ? '仅提示' : (r.values?.length > 1 ? '随机替换' : '替换')} ${ruleId === r.id ? '⌃' : '⌄'}</span>`, `class="tr-rule" data-rule="${esc(r.id)}" aria-expanded="${ruleId === r.id}"`)}<label class="tr-select"><input type="checkbox" data-rule-enabled="${esc(r.id)}" aria-label="启用规则：${esc(r.find)}" ${r.enabled !== false ? 'checked' : ''}></label></div>${ruleId === r.id ? form() : ''}</section>`;
  const current = rules.filter(r => !isLegacyRule(r)), legacy = rules.filter(isLegacyRule);
  return `<div class="tr-bar"><span>${rules.length} / ${all.length} 条规则</span>${button('＋ 新建', 'data-action="new-rule"')}</div>
    <label class="tr-field">新格式规则的处理方式<select id="tr-rule-execution"><option value="review" ${execution === 'review' ? 'selected' : ''}>先审阅，再应用</option><option value="auto" ${execution === 'auto' ? 'selected' : ''}>回复结束后自动应用</option></select></label>
    <input data-rule-filter="search" aria-label="搜索规则" placeholder="搜索查找或替换内容" value="${esc(f.search)}">
    ${current.map(row).join('')}
    ${legacy.length ? `<details class="tr-legacy-rules" ${legacy.some(r => r.id === ruleId) || f.search ? 'open' : ''}><summary>旧版条件规则 · ${legacy.length}</summary>${legacy.map(row).join('')}</details>` : ''}
    ${!rules.length ? '<p class="tr-meta">没有符合搜索的规则。</p>' : ''}
    <details class="tr-bulk"><summary>批量添加</summary><p class="tr-meta">每行一条。只填查找内容表示删除；替换用 Tab 分隔查找和替换，可粘贴表格两列。替换候选用英文逗号分隔。</p><textarea data-bulk-field="text" aria-label="批量规则" rows="4" placeholder="每行填写一条规则">${esc(d.text)}</textarea><button type="button" data-action="bulk-add">添加这些规则</button></details>`;
}
