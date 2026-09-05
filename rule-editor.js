import { validateRule, formatRuleValues, parseRuleValues, parseConditionWords, escapeRE } from './engine.js';
import { parseRegex } from './regex-support.js';

export function isLegacyRule(rule) {
  return rule && (rule.kind === 'pattern' || rule.action === 'review' || rule.reviewAtEnd
    || rule.kind === 'word' && (rule.values ?? []).some(value => value.includes('{{'))
    || rule.punctuation === 'following-comma' || Number(rule.priority ?? 0) !== 0
    || ['before', 'after', 'notBefore', 'exceptions'].some(key => parseConditionWords(rule[key]).length));
}

// Keep old conditional/template rules intact instead of dropping their constraints.
export function createRuleDraft(rule) {
  if (isLegacyRule(rule)) return { ...structuredClone(rule), legacy: true, valuesText: formatRuleValues(rule.values ?? []), sample: '' };
  let find = rule?.find ?? '';
  if (rule && !rule.editorVersion) {
    const regex = rule.kind === 'regex' ? parseRegex(find) : new RegExp(escapeRE(find), 'g');
    find = regex.flags === 'g' && !/[,\r\n]/.test(regex.source) && !regex.source.startsWith('/') ? regex.source : regex.toString();
  }
  const wholeReplacement = rule?.replacementMode === 'text';
  let values = rule?.action === 'delete' ? [] : rule?.values ?? [];
  if (rule && rule.kind !== 'regex') values = values.map(value => value.replaceAll('$', () => '$$'));
  return { find, valuesText: wholeReplacement ? values.join('') : formatRuleValues(values), wholeReplacement, sample: '' };
}

export function simpleRule(draft, old) {
  if (draft.legacy) return validateRule(old ?? draft);
  const values = draft.wholeReplacement ? (draft.valuesText.length ? [draft.valuesText] : []) : parseRuleValues(draft.valuesText);
  return validateRule({ id: old?.id, enabled: old?.enabled ?? true, kind: 'regex', editorVersion: 1,
    find: draft.find, values, action: values.length ? 'replace' : 'delete', remove: !values.length,
    replacementMode: draft.wholeReplacement ? 'text' : 'candidates', execution: 'inherit' });
}

// One column deletes; a second column supplies replacement candidates.
export function bulkRules(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || lines.length > 200) throw new Error('请填写 1–200 行规则。');
  return lines.map((line, i) => {
    const [find, valuesText = '', ...extra] = line.split('\t');
    if (extra.length) throw new Error('第 ' + (i + 1) + ' 行只需查找和替换两列，请用一个 Tab 分隔。');
    try { return simpleRule({ ...createRuleDraft(), find, valuesText }); }
    catch (error) { throw new Error('第 ' + (i + 1) + ' 行：' + error.message); }
  });
}
