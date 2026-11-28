export const PRIORITY_LABELS = { 1: '高', 2: '中', 3: '低' };
export const EXECUTION_LABELS = { inherit: '跟随', auto: '自动应用', review: '人工审查' };

export function normalizeExecution(value, fallback = 'inherit') {
  if (value == null || value === '') return fallback;
  if (value === 'inherit' || value === 'auto' || value === 'review') return value;
  throw new Error('处理方式请选择跟随、自动应用或人工审查。');
}

export function resolveRuleExecution(rule, groups = [], globalExecution = 'review') {
  if (rule?.action === 'review') return 'review';
  if (rule?.execution === 'auto' || rule?.execution === 'review') return rule.execution;
  const group = rule?.groupId ? groups.find(item => item.id === rule.groupId) : null;
  if (group?.execution === 'auto' || group?.execution === 'review') return group.execution;
  return globalExecution === 'auto' ? 'auto' : 'review';
}

export function priorityLevel(rule = {}) {
  if (rule.priorityLevel != null) {
    const level = Number(rule.priorityLevel);
    if (!Number.isInteger(level) || level < 1 || level > 3) throw new Error('优先级请选择高、中或低。');
    return level;
  }
  // Older rule sets used 0–100, with every positive value ahead of default 0.
  const legacy = Number(rule.priority ?? 0);
  if (!Number.isInteger(legacy) || legacy < 0 || legacy > 100) throw new Error('旧优先级需要是 0–100 的整数。');
  return legacy > 0 ? 1 : 2;
}

export function legacyPriorityValues(rules = []) {
  return [...new Set(rules.filter(rule => rule?.priorityLevel == null).map(rule => Number(rule?.priority ?? 0)).filter(value => value > 0))].sort((a, b) => b - a);
}

export function legacyPriorityRules(rules = []) {
  return rules.filter(rule => rule?.priorityLevel == null && Number(rule?.priority ?? 0) > 0)
    .map(rule => ({ find: String(rule.find ?? ''), priority: Number(rule.priority) }));
}

export function migrateRulePriorities(rules = []) {
  return rules.map(rule => {
    if (rule?.kind !== 'regex') return rule;
    const migrated = { ...rule, priorityLevel: priorityLevel(rule) };
    delete migrated.priority;
    return migrated;
  });
}

export function normalizeRuleGroups(groups = []) {
  if (!Array.isArray(groups) || groups.length > 50) throw new Error('分组最多 50 个。');
  const ids = new Set(), names = new Set();
  return groups.map(group => {
    const id = String(group?.id ?? ''), name = String(group?.name ?? '').trim();
    if (!id || id.length > 80 || !name || name.length > 40) throw new Error('分组名称需要 1–40 字。');
    if (ids.has(id) || names.has(name.toLocaleLowerCase())) throw new Error('分组名称或编号重复。');
    ids.add(id); names.add(name.toLocaleLowerCase());
    return { id, name, enabled: group.enabled !== false, execution: normalizeExecution(group.execution, 'inherit') };
  });
}

export function effectiveRules(rules = [], groups = [], ungroupedEnabled = true) {
  const groupIds = new Set(groups.map(group => group.id));
  const disabled = new Set(groups.filter(group => group.enabled === false).map(group => group.id));
  return rules.filter(rule => {
    if (rule.enabled === false) return false;
    const inGroup = Boolean(rule.groupId && groupIds.has(rule.groupId));
    if (!inGroup) return ungroupedEnabled !== false;
    return !disabled.has(rule.groupId);
  });
}
