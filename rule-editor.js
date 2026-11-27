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
    priorityLevel: priorityLevel(rule), groupId: rule?.groupId ?? '',
    execution: rule?.execution === 'auto' || rule?.execution === 'review' ? rule.execution : 'inherit', sample: '' };
}

export function simpleRule(draft, old) {
  const values = draft.wholeReplacement ? (draft.valuesText.length ? [draft.valuesText] : []) : parseRuleValues(draft.valuesText);
  return validateRule({ id: old?.id, enabled: old?.enabled ?? true, kind: 'regex', editorVersion: 1,
    find: draft.find, values, action: values.length ? 'replace' : 'delete', remove: !values.length,
    replacementMode: draft.wholeReplacement ? 'text' : 'candidates',
    execution: draft.execution ?? old?.execution ?? 'inherit',
    priorityLevel: draft.priorityLevel ?? priorityLevel(old), groupId: draft.groupId ?? old?.groupId ?? null });
}
