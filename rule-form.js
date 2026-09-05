import { escapeHTML as esc } from './engine.js';

export function renderRuleForm(draft) {
  if (draft.legacy) return `<div class="tr-rule-editor"><p class="tr-meta">这条旧规则带有模板或附加条件，继续按原效果运行。可在列表停用，再新建正则规则替代；不会自动丢弃原有条件。</p><label class="tr-field">原查找内容<textarea readonly>${esc(draft.find)}</textarea></label><label class="tr-field">原替换候选<textarea readonly>${esc(draft.valuesText)}</textarea></label><p class="tr-meta">${draft.action === 'delete' ? '原处理方式：删除' : draft.action === 'review' ? '原处理方式：仅提示' : '原处理方式：替换'} · ${draft.execution === 'auto' ? '自动应用' : '审阅后应用'}</p><button type="button" data-action="cancel-rule">收起</button></div>`;
  return `<form id="tr-rule-form" class="tr-rule-editor">
    <label class="tr-field">查找<textarea id="tr-find" data-rule-field="find" required maxlength="8000" rows="2" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="极其, 极致&#10;或：死死地?">${esc(draft.find)}</textarea></label>
    <label class="tr-field">替换为<textarea data-rule-field="valuesText" rows="2" maxlength="100000" spellcheck="false" placeholder="十分, 很&#10;留空就是删除">${esc(draft.valuesText)}</textarea></label>
    <label class="tr-check"><input type="checkbox" data-rule-field="wholeReplacement" ${draft.wholeReplacement ? 'checked' : ''}>整段替换（不拆分候选）</label>
    <details><summary>写法示例</summary><p class="tr-meta">死死地? → 留空：删除“死死”和“死死地”。<br>不是([^，。！？]+)，而是([^。！？]+) → $2：保留后半段。<br>$1、$2 保留对应括号中的内容；{{match}} 保留命中原文。<br>复杂正则用 | 表示“或者”，其中的逗号不拆分；完整 /表达式/标志 也可直接粘贴。<br>正则在允许处理的连续正文中执行，不跨标签、代码或排除内容。</p></details>
    <details><summary>试一下</summary><label class="tr-field">测试文字<textarea data-rule-field="sample" maxlength="8000" placeholder="输入一段文字，检查会改成什么。">${esc(draft.sample ?? '')}</textarea></label><button type="button" data-action="preview-rule">查看修改结果</button><div id="tr-rule-preview" aria-live="polite"></div></details>
    <div class="tr-form-actions"><button type="button" data-action="cancel-rule">取消</button><button type="submit" class="tr-primary">保存规则</button></div>
  </form>`;
}
