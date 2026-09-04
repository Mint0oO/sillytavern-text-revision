import { validateRule, formatRuleValues, parseRuleValues, parseConditionWords } from './engine.js';

// Keep old settings in the draft so a simple edit never silently removes them.
export function createRuleDraft(rule) {
  const draft = rule ? structuredClone(rule) : { find: '', values: [], action: 'delete', boundary: 'clause', remove: true };
  draft.valuesText = formatRuleValues(draft.values ?? []);
  if (rule) draft.punctuation ??= 'none';
  if (rule?.kind === 'word') draft.literalFind = rule.find;
  syncRuleDraft(draft);
  return draft;
}

export function syncRuleDraft(draft) {
  draft.kind = draft.find === draft.literalFind ? 'word' : /\{[A-Z]\}/.test(draft.find) ? 'pattern' : 'word';
  draft.captures ??= {};
  for (const key of draft.find.match(/\{[A-Z]\}/g) ?? []) {
    draft.captures[key[1]] ??= { type: draft.find.startsWith(key) ? 'word' : 'text', words: [] };
  }
}

export function simpleRule(draft, old) {
  const copy = structuredClone(draft);
  syncRuleDraft(copy);
  return validateRule({ ...copy, id: old?.id, enabled: old?.enabled ?? true,
    remove: copy.action === 'delete' || Boolean(copy.remove),
    // Deleting a sentence fragment also removes its following comma by default.
    punctuation: copy.punctuation ?? (copy.kind === 'pattern' ? 'following-comma' : 'none'),
    values: parseRuleValues(copy.valuesText),
  });
}

export function hasExtraConditions(draft) {
  return ['before', 'after', 'exceptions'].some(key => parseConditionWords(draft[key]).length)
    || (draft.id !== 'word-extreme' && (parseConditionWords(draft.notBefore).length || Number(draft.priority ?? 0) !== 0));
}

export function clearExtraConditions(draft) {
  for (const key of ['before', 'after', 'exceptions', 'notBefore']) draft[key] = [];
  draft.priority = 0;
}
