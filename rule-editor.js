import { validateRule, formatRuleValues, parseRuleValues } from './engine.js';
import { parseRegex } from './regex-support.js';
import { priorityLevel } from './rule-groups.js';

export function isLegacyRule(rule) {
  return rule && (rule.kind !== 'regex' || rule.captures && Object.keys(rule.captures).length
    || rule.punctuation === 'following-comma' || rule.reviewAtEnd
    || ['before', 'after', 'notBefore', 'exceptions'].some(key => rule[key]?.length));
}

// Keep old conditional/template rules intact instead of dropping their constraints.
export function createRuleDraft(rule) {
  if (isLegacyRule(rule)) throw new Error('旧规则已停用，请先备份规则，再改写为正则规则。');
  let find = rule?.find ?? '';
  if (rule && !rule.editorVersion) {
    const regex = parseRegex(find);
    find = regex.flags === 'g' && !/[,\r\n]/.test(regex.source) && !regex.source.startsWith('/') ? regex.source : regex.toString();
  }
  const wholeReplacement = rule?.replacementMode === 'text';
  let values = rule?.action === 'delete' ? [] : rule?.values ?? [];
  return { find, valuesText: wholeReplacement ? values.join('') : formatRuleValues(values), wholeReplacement,
    priorityLevel: priorityLevel(rule), groupId: rule?.groupId ?? '', sample: '' };
}

export function simpleRule(draft, old) {
  const values = draft.wholeReplacement ? (draft.valuesText.length ? [draft.valuesText] : []) : parseRuleValues(draft.valuesText);
  return validateRule({ id: old?.id, enabled: old?.enabled ?? true, kind: 'regex', editorVersion: 1,
    find: draft.find, values, action: values.length ? 'replace' : 'delete', remove: !values.length,
    replacementMode: draft.wholeReplacement ? 'text' : 'candidates', execution: 'inherit',
    priorityLevel: draft.priorityLevel ?? priorityLevel(old), groupId: draft.groupId ?? old?.groupId ?? null });
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
