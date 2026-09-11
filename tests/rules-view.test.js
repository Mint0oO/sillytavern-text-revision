import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRulesView, summarizeRuleFind, ruleCountText, ruleExecutionStatus } from '../rules-view.js';

test('collapsed rule summaries hide regex group internals and preserve literal parentheses', () => {
  assert.equal(summarizeRuleFind('不是([^，。！？]+)，而是([^。！？]+)'), '不是*，而是*');
  assert.equal(summarizeRuleFind('甲(?:乙(丙)|丁)+戊'), '甲*戊');
  assert.equal(summarizeRuleFind('像.*?一样'), '像*一样');
  assert.equal(summarizeRuleFind('从[^。]+到达'), '从*到达');
  assert.equal(summarizeRuleFind('甲[\\s\\S]*?乙'), '甲*乙');
  assert.equal(summarizeRuleFind('极其\n极致'), '极其, 极致');
  assert.equal(summarizeRuleFind(String.raw`甲\(乙\)丙`), String.raw`甲\(乙\)丙`);
  assert.equal(summarizeRuleFind('甲[()]乙'), '甲[()]乙');
  assert.equal(summarizeRuleFind('甲([)])乙'), '甲*乙');
  assert.equal(summarizeRuleFind('甲(未闭合'), '甲(未闭合');
});

test('rules stay compact and expose modal editing controls', () => {
  const find = '不是([^，。！？]+)，而是([^。！？]+)';
  const rule = { id: 'sentence', kind: 'regex', editorVersion: 1, find, values: ['$2'], action: 'replace' };
  const collapsed = renderRulesView([rule], { search: '' }, 'review');
  assert.match(collapsed, />不是\*，而是\*</);
  assert.match(collapsed, /data-action="export-rules"/);
  assert.match(collapsed, /data-action="import-rules"/);
  assert.match(collapsed, /fa-file-export/);
  assert.match(collapsed, /fa-file-import/);
  assert.match(collapsed, /id="tr-rule-import-file"/);
  assert.ok(collapsed.indexOf('data-action="begin-rule-delete"') < collapsed.indexOf('data-action="new-rule"'));
  assert.ok(collapsed.indexOf('data-action="new-rule"') < collapsed.indexOf('data-action="import-rules"'));
  assert.ok(collapsed.indexOf('data-action="import-rules"') < collapsed.indexOf('data-action="export-rules"'));
  assert.match(collapsed, />新增</);
  assert.doesNotMatch(collapsed, /＋ 新增/);
  assert.match(collapsed, /自动检测，人工审查/);
  assert.doesNotMatch(collapsed, /data-screen="settings"|处理方式：/);
  assert.doesNotMatch(collapsed, /<select/);
  assert.doesNotMatch(collapsed, /已启用 1 \/ 1/);
  assert.equal(ruleCountText([rule]), '已启用 1 / 1');
  assert.match(collapsed, /placeholder="搜索"/);
  assert.match(collapsed, new RegExp(`title="${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.doesNotMatch(collapsed, />不是\(\[\^/);
  assert.doesNotMatch(collapsed, /完整表单|批量添加|新格式规则的处理方式/);
});

test('rule deletion is a separate multi-select confirmation mode', () => {
  const rules = [
    { id: 'one', kind: 'regex', editorVersion: 1, find: '极其', values: [], action: 'delete' },
    { id: 'two', kind: 'regex', editorVersion: 1, find: '极具', values: ['很有'], action: 'replace' },
  ];
  const html = renderRulesView(rules, { search: '' }, 'review', { active: true, selectedIds: new Set(['two']) });
  assert.doesNotMatch(html, /data-action="cancel-rule-delete"|data-action="confirm-rule-delete"/);
  assert.match(html, /data-rule-delete="two" aria-pressed="true"/);
  assert.match(html, /data-rule-delete-check="two"[^>]*checked/);
  assert.doesNotMatch(html, /data-action="new-rule"|data-rule-enabled=/);
});

test('rule counter reports enabled rules rather than search matches', () => {
  const rules = [
    { id: 'one', kind: 'regex', editorVersion: 1, find: '极其', values: [], action: 'delete', enabled: false },
    { id: 'two', kind: 'regex', editorVersion: 1, find: '极具', values: ['很有'], action: 'replace', enabled: true },
  ];
  renderRulesView(rules, { search: '极其' }, 'review');
  assert.equal(ruleCountText(rules), '已启用 1 / 2');
});

test('rules status distinguishes automatic triggering, execution and disabled plugin', () => {
  assert.equal(ruleExecutionStatus('review'), '自动检测，人工审查');
  assert.equal(ruleExecutionStatus('auto'), '自动检测并应用');
  assert.equal(ruleExecutionStatus('auto', { autoScan: false }), '已关闭自动检测，可手动检测');
  assert.equal(ruleExecutionStatus('review', { enabled: false, autoScan: false }), '插件已停用');
});
