import { scan } from '../engine.js';
import { parseRegexes } from '../regex-support.js';

// Synchronous fixture matching is limited to small, controlled test patterns.
// Production matching always runs in the isolated worker with a timeout.
export function scanFixture(text, rules, options = {}) {
  const byRule = {};
  for (const rule of rules) {
    const matches = [];
    for (const expression of parseRegexes(rule.find, rule.editorVersion === 1)) {
      for (const match of text.matchAll(expression.global ? expression : new RegExp(expression.source, expression.flags + 'g'))) {
        if (!match[0]) continue;
        matches.push({ index: match.index, text: match[0], options: rule.values ?? [], captures: {} });
      }
    }
    byRule[rule.id] = matches;
  }
  return scan(text, rules, { ...options, regexMatches: { 0: byRule } });
}
