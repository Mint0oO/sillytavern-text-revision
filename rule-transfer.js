import { validateRule, newId } from './engine.js';
import { legacyPriorityValues, legacyPriorityRules, normalizeRuleGroups } from './rule-groups.js';

export const RULE_SET_TYPE = 'henge-rule-set';
export const RULE_SET_FORMAT_VERSION = 3;
export const MAX_RULE_SET_BYTES = 25 * 1024 * 1024;

const execution = value => value === 'auto' ? 'auto' : 'review';
const signature = rule => {
  const { id, enabled, ...content } = validateRule(rule);
  return JSON.stringify(content);
};

export function createRuleSet(settings, now = new Date()) {
  const groups = normalizeRuleGroups(settings?.ruleGroups ?? []);
  const groupIds = new Set(groups.map(group => group.id));
  const rules = (settings?.rules ?? []).map(rule => structuredClone(validateRule(rule)));
  if (rules.some(rule => rule.groupId && !groupIds.has(rule.groupId))) throw new Error('有规则指向不存在的分组，请先调整所属分组。');
  return {
    type: RULE_SET_TYPE,
    formatVersion: RULE_SET_FORMAT_VERSION,
    exportedAt: new Date(now).toISOString(),
    ruleExecution: execution(settings?.ruleExecution),
    groups,
    rules,
  };
}

export function stringifyRuleSet(settings, now) {
  return JSON.stringify(createRuleSet(settings, now), null, 2) + '\n';
}

export function parseRuleSet(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('JSON 文件是空的。');
  if (new Blob([text]).size > MAX_RULE_SET_BYTES) throw new Error('JSON 文件超过 25 MB，无法导入。');
  let data;
  try { data = JSON.parse(text); }
  catch (error) { throw new Error(`JSON 格式无效：${error.message}`); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('这不是 Henge 规则集对象。');
  if (data.type !== RULE_SET_TYPE) throw new Error('这不是 Henge 导出的规则集。');
  if (![1, 2, RULE_SET_FORMAT_VERSION].includes(data.formatVersion)) throw new Error(`不支持规则集格式版本 ${String(data.formatVersion)}。`);
  if (!Array.isArray(data.rules)) throw new Error('规则集缺少 rules 数组。');
  if (data.rules.length > 200) throw new Error('规则集最多包含 200 条规则。');
  if (data.formatVersion === 3 && !Array.isArray(data.groups)) throw new Error('规则集缺少 groups 数组。');
  const groups = normalizeRuleGroups(data.formatVersion === 3 ? data.groups : []);
  const groupIds = new Set(groups.map(group => group.id));
  const priorityMigration = legacyPriorityValues(data.rules);
  const priorityMigrationRules = legacyPriorityRules(data.rules);
  const rules = data.rules.map((rule, index) => {
    if (rule?.kind !== 'regex') throw new Error(`第 ${index + 1} 条是旧版字词或占位模板规则；已停止整次导入，请先改写为正则。`);
    try {
      const normalized = validateRule(rule);
      if (normalized.groupId && !groupIds.has(normalized.groupId)) throw new Error('所属分组不存在。');
      return normalized;
    }
    catch (error) { throw new Error(`第 ${index + 1} 条规则无效：${error.message}`); }
  });
  return { ruleExecution: execution(data.ruleExecution), groups, rules, priorityMigration, priorityMigrationRules };
}

export function applyRuleSet(existing, imported, mode, existingGroups = []) {
  if (!['append', 'replace'].includes(mode)) throw new Error('未知的规则导入方式。');
  const base = mode === 'append' ? existing : [];
  const groups = mode === 'append' ? normalizeRuleGroups(existingGroups) : [];
  const groupIds = new Map();
  for (const group of normalizeRuleGroups(imported.groups ?? [])) {
    const sameName = groups.find(current => current.name.toLocaleLowerCase() === group.name.toLocaleLowerCase());
    if (sameName) groupIds.set(group.id, sameName.id);
    else {
      const id = mode === 'append' && groups.some(current => current.id === group.id) ? newId() : group.id;
      groups.push({ ...group, id });
      groupIds.set(group.id, id);
    }
  }
  if (groups.length > 50) throw new Error('导入后分组超过 50 个。');
  const seen = new Set(base.map(signature));
  const added = [];
  let skipped = 0;
  for (const importedRule of imported.rules) {
    const mapped = { ...importedRule, groupId: importedRule.groupId ? groupIds.get(importedRule.groupId) : null };
    if (importedRule.groupId && !mapped.groupId) throw new Error('导入规则所属分组不存在。');
    const key = signature(mapped);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const fresh = structuredClone(mapped);
    delete fresh.id;
    added.push(validateRule(fresh));
  }
  if (base.length + added.length > 200) throw new Error(`导入后会有 ${base.length + added.length} 条规则，超过 200 条上限。`);
  return {
    rules: [...base, ...added],
    groups,
    ruleExecution: mode === 'replace' ? imported.ruleExecution : null,
    added: added.length,
    skipped,
  };
}
