import { validateRule } from './engine.js';

export const RULE_SET_TYPE = 'henge-rule-set';
export const RULE_SET_FORMAT_VERSION = 1;
export const MAX_RULE_SET_BYTES = 25 * 1024 * 1024;

const execution = value => value === 'auto' ? 'auto' : 'review';
const signature = rule => {
  const { id, enabled, ...content } = validateRule(rule);
  return JSON.stringify(content);
};

export function createRuleSet(settings, now = new Date()) {
  return {
    type: RULE_SET_TYPE,
    formatVersion: RULE_SET_FORMAT_VERSION,
    exportedAt: new Date(now).toISOString(),
    ruleExecution: execution(settings?.ruleExecution),
    rules: (settings?.rules ?? []).map(rule => structuredClone(validateRule(rule))),
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
  if (data.formatVersion !== RULE_SET_FORMAT_VERSION) throw new Error(`不支持规则集格式版本 ${String(data.formatVersion)}。`);
  if (!Array.isArray(data.rules)) throw new Error('规则集缺少 rules 数组。');
  if (data.rules.length > 200) throw new Error('规则集最多包含 200 条规则。');
  const rules = data.rules.map((rule, index) => {
    try { return validateRule(rule); }
    catch (error) { throw new Error(`第 ${index + 1} 条规则无效：${error.message}`); }
  });
  return { ruleExecution: execution(data.ruleExecution), rules };
}

export function applyRuleSet(existing, imported, mode) {
  if (!['append', 'replace'].includes(mode)) throw new Error('未知的规则导入方式。');
  const base = mode === 'append' ? existing : [];
  const seen = new Set(base.map(signature));
  const added = [];
  let skipped = 0;
  for (const importedRule of imported.rules) {
    const key = signature(importedRule);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const fresh = structuredClone(importedRule);
    delete fresh.id;
    added.push(validateRule(fresh));
  }
  if (base.length + added.length > 200) throw new Error(`导入后会有 ${base.length + added.length} 条规则，超过 200 条上限。`);
  return {
    rules: [...base, ...added],
    ruleExecution: mode === 'replace' ? imported.ruleExecution : null,
    added: added.length,
    skipped,
  };
}
