import { escapeHTML as esc } from './engine.js';

export function renderRuleForm(draft, { canDelete = false } = {}) {
  const deleteButton = canDelete ? '<button type="button" class="tr-delete-rule" data-action="delete-current-rule">删除此规则</button>' : '<span></span>';
  return `<form id="tr-rule-form" class="tr-rule-editor">
    <label class="tr-field"><span class="tr-field-heading"><span>查找</span><span class="tr-meta">英文逗号或换行分项；每项可用正则</span></span><textarea id="tr-find" data-rule-field="find" required maxlength="8000" rows="2" spellcheck="false" autocapitalize="off" autocorrect="off">${esc(draft.find)}</textarea></label>
    <label class="tr-field"><span class="tr-field-heading"><span>替换为</span><span class="tr-meta">一行一个，或用英文逗号分隔；多个会随机选择</span></span><textarea data-rule-field="valuesText" rows="2" maxlength="100000" spellcheck="false" placeholder="留空为删除">${esc(draft.valuesText)}</textarea></label>
    <details><summary>试一下</summary><textarea data-rule-field="sample" aria-label="测试文字" maxlength="8000" placeholder="输入一段文字，看看这条规则会改成什么。">${esc(draft.sample ?? '')}</textarea><button type="button" data-action="preview-rule">查看修改结果</button><div id="tr-rule-preview" aria-live="polite"></div></details>
    <div class="tr-form-actions tr-rule-form-actions">${deleteButton}<button type="submit" class="tr-primary">保存规则</button></div>
  </form>`;
}
