import { escapeHTML as esc } from './engine.js';
import { CAPTURE_TYPES } from './language.js';

const options = (items, selected) => items.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
const words = value => Array.isArray(value) ? value.join('，') : value ?? '';

export function renderCaptureFields(draft) {
  if (draft.kind !== 'pattern') return '';
  const keys = [...new Set((draft.find.match(/\{[A-Z]\}/g) ?? []).map(key => key[1]))];
  return keys.map(key => {
    const c = draft.captures[key];
    return `<div class="tr-capture"><label class="tr-field">${key} 取什么<select data-capture-key="${key}" data-capture-field="type">${options(Object.entries(CAPTURE_TYPES), c.type)}</select></label>${c.type === 'list' || words(c.words) ? `<label class="tr-field">${key} 的指定词语<input data-capture-key="${key}" data-capture-field="words" value="${esc(words(c.words))}" placeholder="例如：高兴，开心"></label>` : ''}</div>`;
  }).join('');
}

export function renderRuleForm(draft) {
  const regex = draft.kind === 'regex';
  return `<form id="tr-rule-form" class="tr-rule-editor">
    <div class="tr-form-grid"><label class="tr-field">匹配方式<select data-rule-field="mode">${options([['text', '普通文字 / {A} 句式'], ['regex', '正则表达式']], draft.mode)}</select></label><label class="tr-field">分类<select data-rule-field="category">${options([['word', '字词'], ['sentence', '句式']], draft.category ?? (draft.kind === 'pattern' ? 'sentence' : 'word'))}</select></label></div>
    <label class="tr-field">识别内容<input id="tr-find" data-rule-field="find" required maxlength="256" value="${esc(draft.find)}" placeholder="${regex ? '/死死地?/g' : '例如：极其，或 像{A}一样'}"></label>
    <div class="tr-form-grid"><label class="tr-field">怎么处理<select data-rule-field="action">${options([['delete', '删除'], ['replace', '替换'], ['review', '仅提示']], draft.action)}</select></label><label class="tr-field">何时应用<select data-rule-field="execution">${options([['review', '审阅后应用'], ['auto', '回复结束后自动应用']], draft.execution ?? 'review')}</select></label></div>
    <div id="tr-replacements" ${draft.action !== 'replace' ? 'hidden' : ''}><label class="tr-field">替换内容<textarea data-rule-field="valuesText" rows="2" placeholder="${regex ? '$1 或 {{random::轻轻::缓缓}}' : '例如：很{A}'}">${esc(draft.valuesText)}</textarea></label><p class="tr-meta">${regex ? '整框是一份替换内容；逗号按原文保留。$1 保留第一组，{{match}} 保留命中原文。支持 {{user}}、{{char}}、{{random::候选1::候选2}}。' : '多个候选用英文逗号分隔。变化的部分写 {A}，替换中写 {A} 就保留它。'}</p></div>
    <p class="tr-meta">${regex ? '用 | 合并写法，用 ? 表示可有可无；/表达式/g 匹配每个句段中的全部命中。不跨句段、标签或排除内容。' : '填写 {A} 后，可在附加条件中指定取词范围或词性。'}仅提示和重叠冲突需要审阅。</p>
    <details class="tr-advanced"><summary>附加条件 · 取词与词性</summary><div id="tr-captures">${renderCaptureFields(draft)}</div>
      ${[['before', '前面紧接'], ['after', '后面紧接'], ['notBefore', '前面不能是'], ['exceptions', '跳过包含这些词的命中']].map(([key, label]) => `<label class="tr-field">${label}<input data-rule-field="${key}" value="${esc(words(draft[key]))}" placeholder="多个词用逗号分隔，留空不限制"></label>`).join('')}
      <label class="tr-field">优先级<input type="number" min="0" max="100" data-rule-field="priority" value="${draft.priority ?? 0}"></label>
      <label class="tr-field">删除时的标点<select data-rule-field="punctuation">${options([['none', '保留周围标点'], ['following-comma', '带走后面紧接的逗号']], draft.punctuation ?? (draft.kind === 'pattern' ? 'following-comma' : 'none'))}</select></label>
      <label class="tr-field">模板中一段文字的范围<select data-rule-field="boundary">${options([['clause', '不跨逗号'], ['sentence', '可跨逗号，不跨句末']], draft.boundary ?? 'clause')}</select></label>
      <button type="button" data-action="clear-rule-conditions">清除前后条件和优先级</button>
    </details>
    <details><summary>试一下</summary><label class="tr-field">测试文字<textarea data-rule-field="sample" maxlength="8000" placeholder="他死死地抓住扶手，又死死盯着门。">${esc(draft.sample ?? '')}</textarea></label><button type="button" data-action="preview-rule">查看修改结果</button><div id="tr-rule-preview" aria-live="polite"></div></details>
    <div class="tr-form-actions"><button type="button" data-action="cancel-rule">取消</button><button type="submit" class="tr-primary">保存规则</button></div>
  </form>`;
}
