import { validateRule, formatRuleValues, parseRuleValues, parseConditionWords } from './engine.js';

// Keep old settings in the draft so a simple edit never silently removes them.
export function createRuleDraft(rule) {
  const draft = rule ? structuredClone(rule) : { find: '', values: [], action: 'delete', boundary: 'clause', remove: true };
  draft.valuesText = rule?.kind === 'regex' ? (draft.values ?? []).join('\n') : formatRuleValues(draft.values ?? []);
  if (rule) draft.punctuation ??= 'none';
  if (rule?.kind === 'word') draft.literalFind = rule.find;
  draft.mode = rule?.kind === 'regex' ? 'regex' : 'text';
  syncRuleDraft(draft);
  return draft;
}

export function syncRuleDraft(draft) {
  draft.kind = draft.mode === 'regex' ? 'regex' : draft.find === draft.literalFind ? 'word' : /\{[A-Z]\}/.test(draft.find) ? 'pattern' : 'word';
  draft.captures ??= {};
  for (const key of draft.find.match(/\{[A-Z]\}/g) ?? []) {
    draft.captures[key[1]] ??= { type: draft.find.startsWith(key) ? 'word' : 'text', words: [] };
  }
}

// TSV keeps regex alternation pipes and commas inside replacements intact.
export function bulkRules(text, { mode = 'text', action = 'delete', category = 'word', execution = 'review' } = {}) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || lines.length > 200) throw new Error('请填写 1–200 行规则。');
  return lines.map((line, i) => {
    const [find, value, ...extra] = line.split('\t');
    if (extra.length || action === 'replace' && !value?.trim()) throw new Error(`第 ${i + 1} 行请用一个 Tab 分隔查找与替换内容。`);
    if (action !== 'replace' && value !== undefined) throw new Error(`第 ${i + 1} 行只需填写查找内容。`);
    const draft = createRuleDraft(); Object.assign(draft, { find, mode, action, category, execution });
    const rule = simpleRule({ ...draft, valuesText: mode === 'regex' ? value ?? '' : value ? formatRuleValues([value]) : '' });
    return validateRule(rule);
  });
}

export function simpleRule(draft, old) {
  const copy = structuredClone(draft);
  syncRuleDraft(copy);
  return validateRule({ ...copy, id: old?.id, enabled: old?.enabled ?? true,
    remove: copy.action === 'delete' || Boolean(copy.remove),
    // Deleting a sentence fragment also removes its following comma by default.
    punctuation: copy.punctuation ?? (copy.kind === 'pattern' ? 'following-comma' : 'none'),
    values: copy.kind === 'regex' ? (copy.valuesText.trim() ? [copy.valuesText.trim()] : []) : parseRuleValues(copy.valuesText),
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
