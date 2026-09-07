import { escapeHTML as esc } from './engine.js';

export function renderRuleForm(draft, { canDelete = false } = {}) {
  const deleteButton = canDelete ? '<button type="button" class="tr-delete-rule" data-action="delete-current-rule">删除此规则</button>' : '<span></span>';
  if (draft.legacy) return `<div class="tr-rule-editor"><p class="tr-meta">这条兼容规则含有旧版条件或整段替换设置，会继续按原效果运行。为了避免编辑时丢失原有含义，这里只供查看；可以在列表停用，再新建一条规则替代。</p><label class="tr-field">原查找内容<textarea readonly>${esc(draft.find)}</textarea></label><label class="tr-field">原替换候选<textarea readonly>${esc(draft.valuesText)}</textarea></label><p class="tr-meta">${draft.action === 'delete' ? '原处理方式：删除' : draft.action === 'review' ? '原处理方式：仅提示' : '原处理方式：替换'} · ${draft.execution === 'auto' ? '自动应用' : '人工审查'}</p><div class="tr-form-actions tr-rule-form-actions">${deleteButton}</div></div>`;
  return `<form id="tr-rule-form" class="tr-rule-editor">
    <label class="tr-field"><span class="tr-field-heading"><span>查找</span><span class="tr-meta">英文逗号或换行分隔</span></span><textarea id="tr-find" data-rule-field="find" required maxlength="8000" rows="2" spellcheck="false" autocapitalize="off" autocorrect="off">${esc(draft.find)}</textarea></label>
    <label class="tr-field"><span class="tr-field-heading"><span>替换为</span><span class="tr-meta">一行一个，或用英文逗号分隔；多个会随机选择</span></span><textarea data-rule-field="valuesText" rows="2" maxlength="100000" spellcheck="false" placeholder="留空为删除">${esc(draft.valuesText)}</textarea></label>
    <details><summary>试一下</summary><textarea data-rule-field="sample" aria-label="测试文字" maxlength="8000" placeholder="输入一段文字，看看这条规则会改成什么。">${esc(draft.sample ?? '')}</textarea><button type="button" data-action="preview-rule">查看修改结果</button><div id="tr-rule-preview" aria-live="polite"></div></details>
    <div class="tr-form-actions tr-rule-form-actions">${deleteButton}<button type="submit" class="tr-primary">保存规则</button></div>
  </form>`;
}
