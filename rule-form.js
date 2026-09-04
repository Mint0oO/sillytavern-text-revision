import { escapeHTML as esc } from './engine.js';
import { CAPTURE_TYPES } from './language.js';
import { hasExtraConditions } from './rule-editor.js';

export function renderCaptureFields(draft) {
  if (draft.kind !== 'pattern') return '';
  const keys = [...new Set((draft.find.match(/\{[A-Z]\}/g) ?? []).map(key => key[1]))];
  return keys.map(key => {
    const c = draft.captures[key], options = [['text', '一段文字'], ['word', '一个词'], ['list', '指定词语']];
    if (!options.some(([type]) => type === c.type)) options.push([c.type, `原有：${CAPTURE_TYPES[c.type] ?? c.type}`]);
    const words = Array.isArray(c.words) ? c.words.join('，') : c.words ?? '';
    return `<div class="tr-capture"><label class="tr-field">${key} 取什么<select data-capture-key="${key}" data-capture-field="type">${options.map(([value, label]) => `<option value="${esc(value)}" ${c.type === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>${c.type === 'list' || words ? `<label class="tr-field">${key} 的指定词语<input data-capture-key="${key}" data-capture-field="words" value="${esc(words)}" placeholder="例如：高兴，开心"></label>` : ''}</div>`;
  }).join('');
}

export function renderRuleForm(draft) {
  return `<form id="tr-rule-form" class="tr-rule-editor">
    <label class="tr-field">识别内容<input id="tr-find" data-rule-field="find" required maxlength="256" value="${esc(draft.find)}" placeholder="例如：极其，或 像{A}一样"></label>
    <label class="tr-field">怎么处理<select id="tr-action" data-rule-field="action">${[['delete', '删除'], ['replace', '替换'], ['review', '仅提示']].map(([value, label]) => `<option value="${value}" ${draft.action === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <div id="tr-replacements" ${draft.action !== 'replace' ? 'hidden' : ''}><label class="tr-field">替换内容<textarea id="tr-values" data-rule-field="valuesText" rows="2" placeholder="例如：很{A}">${esc(draft.valuesText)}</textarea></label><p class="tr-meta">多个候选用英文逗号分隔。</p></div>
    <div id="tr-captures">${renderCaptureFields(draft)}</div>
    <p class="tr-meta">变化的部分写 {A}；替换时写 {A} 就保留它。</p>
    ${hasExtraConditions(draft) ? '<p class="tr-meta">沿用这条旧规则的附加限制。<button type="button" data-action="clear-rule-conditions">清除附加限制</button></p>' : ''}
    <details><summary>试一下</summary><label class="tr-field">测试文字<textarea data-rule-field="sample" maxlength="8000" placeholder="他高兴极了。">${esc(draft.sample ?? '')}</textarea></label><button type="button" data-action="preview-rule">查看修改结果</button><div id="tr-rule-preview" aria-live="polite"></div></details>
    <div class="tr-form-actions"><button type="button" data-action="cancel-rule">取消</button><button type="submit" class="tr-primary">保存规则</button></div>
  </form>`;
}
