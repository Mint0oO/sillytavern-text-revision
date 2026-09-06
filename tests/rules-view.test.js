import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRulesView, summarizeRuleFind } from '../rules-view.js';

test('collapsed rule summaries hide regex group internals and preserve literal parentheses', () => {
  assert.equal(summarizeRuleFind('不是([^，。！？]+)，而是([^。！？]+)'), '不是…，而是…');
  assert.equal(summarizeRuleFind('甲(?:乙(丙)|丁)+戊'), '甲…戊');
  assert.equal(summarizeRuleFind(String.raw`甲\(乙\)丙`), String.raw`甲\(乙\)丙`);
  assert.equal(summarizeRuleFind('甲[()]乙'), '甲[()]乙');
  assert.equal(summarizeRuleFind('甲([)])乙'), '甲…乙');
  assert.equal(summarizeRuleFind('甲(未闭合'), '甲(未闭合');
});

test('rules show a compact summary until their editor is expanded', () => {
  const find = '不是([^，。！？]+)，而是([^。！？]+)';
  const rule = { id: 'sentence', kind: 'regex', editorVersion: 1, find, values: ['$2'], action: 'replace' };
  const collapsed = renderRulesView([rule], { search: '' }, null, () => '<form></form>', { text: '' });
  assert.match(collapsed, />不是…，而是…</);
  assert.match(collapsed, new RegExp(`title="${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.doesNotMatch(collapsed, />不是\(\[\^/);

  const expanded = renderRulesView([rule], { search: '' }, 'sentence', () => '<form>完整表单</form>', { text: '' });
  assert.match(expanded, />不是\(\[\^，。！？\]\+\)，而是/);
  assert.match(expanded, /完整表单/);
});
