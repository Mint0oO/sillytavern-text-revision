import { escapeHTML as esc } from './engine.js';

function choiceField(field, label, options, value) {
  const selected = options.find(option => String(option.value) === String(value)) ?? options[0];
  return `<div class="tr-field"><span class="tr-rule-choice-label">${label}</span><details class="tr-rule-choice" data-rule-choice="${field}"><summary class="tr-rule-choice-summary" aria-label="${label}：${esc(selected.label)}"><span class="tr-rule-choice-current">${esc(selected.label)}</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><div class="tr-rule-choice-options" role="group" aria-label="${label}">${options.map(option => `<button type="button" class="tr-rule-choice-option" data-rule-choice-value="${esc(option.value)}" aria-label="${esc(option.label)}" aria-pressed="${String(option.value) === String(selected.value)}">${esc(option.label)}</button>`).join('')}</div></details></div>`;
}

export function renderRuleForm(draft, { canDelete = false, groups = [] } = {}) {
  const deleteButton = canDelete ? '<button type="button" class="tr-delete-rule" data-action="delete-current-rule">删除此规则</button>' : '<span></span>';
  return `<form id="tr-rule-form" class="tr-rule-editor">
    <label class="tr-field"><span class="tr-field-heading"><span>查找</span><span class="tr-meta">英文逗号或换行分项；每项可用正则</span></span><textarea id="tr-find" data-rule-field="find" required maxlength="8000" rows="2" spellcheck="false" autocapitalize="off" autocorrect="off">${esc(draft.find)}</textarea></label>
    <label class="tr-field"><span class="tr-field-heading"><span>替换为</span><span class="tr-meta">一行一个，或用英文逗号分隔；多个会随机选择</span></span><textarea data-rule-field="valuesText" rows="2" maxlength="100000" spellcheck="false" placeholder="留空为删除">${esc(draft.valuesText)}</textarea></label>
    <div class="tr-rule-options">${choiceField('priorityLevel', '优先级', [{ value: 1, label: '高' }, { value: 2, label: '中' }, { value: 3, label: '低' }], draft.priorityLevel)}${choiceField('groupId', '所属分组', [{ value: '', label: '未分组' }, ...groups.map(group => ({ value: group.id, label: group.name }))], draft.groupId)}</div>
    <details><summary>试一下</summary><textarea data-rule-field="sample" aria-label="测试文字" maxlength="8000" placeholder="输入一段文字，看看这条规则会改成什么。">${esc(draft.sample ?? '')}</textarea><button type="button" data-action="preview-rule">查看修改结果</button><div id="tr-rule-preview" aria-live="polite"></div></details>
    <div class="tr-form-actions tr-rule-form-actions">${deleteButton}<button type="submit" class="tr-primary">保存规则</button></div>
  </form>`;
}
