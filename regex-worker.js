import { textRanges, LIMITS } from './engine.js';
import { parseRegexes, replacementParts } from './regex-support.js';

export function collectRegex({ text, rules, scope }) {
  const result = {};
  let count = 0, outputLength = 0;
  for (const [start, end] of textRanges(text, scope).ranges) {
    const spanText = text.slice(start, end);
    for (const rule of rules) {
      const byRule = result[start] ??= {};
      const regexes = parseRegexes(rule.find, true), matches = byRule[rule.id] = [];
      const templates = rule.values.map(replacementParts), seen = new Set();
      for (const regex of regexes) {
        // Sticky replacement is branch-local so $1/$2 do not shift when
        // several visual lines belong to the same saved rule.
        const one = new RegExp(regex.source, regex.flags.replace(/[gy]/g, '') + 'y');
        const all = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
        for (const m of spanText.matchAll(all)) {
          if (!m[0].length) throw new Error(`正则 ${rule.find} 命中了空位置，请改为匹配实际文字。`);
          const key = `${m.index}:${m[0].length}:${m[0]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (++count > LIMITS.matches) throw new Error('正则检出超过 1000 处，请缩小规则范围。');
          const options = templates.map(parts => parts.map(part => {
            if (part.macro) return part;
            one.lastIndex = m.index;
            const value = spanText.replace(one, part.text.replace(/\$(\$|0(?!\d))/g, (match, token) => token === '0' ? '$&' : match));
            const suffixLength = spanText.length - m.index - m[0].length;
            const expanded = value.slice(m.index, value.length - suffixLength);
            outputLength += expanded.length;
            if (expanded.length > 8000 || outputLength > 4000000) throw new Error('正则替换内容过多，请缩小规则范围。');
            return { text: expanded };
          }));
          matches.push({ text: m[0], index: m.index, contextStart: start, contextEnd: end, options, captures: Object.fromEntries(m.slice(1).map((v, i) => [String(i + 1), v ?? ''])) });
          if (!regex.global) break;
        }
      }
      matches.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
    }
  }
  return result;
}

async function run(data, send) {
  const id = data?.id;
  try { send({ id, result: collectRegex(data) }); }
  catch (error) { send({ id, error: error.message }); }
}
if (typeof self !== 'undefined' && typeof document === 'undefined') self.onmessage = e => run(e.data, value => self.postMessage(value));
else if (globalThis.process?.versions?.node) {
  const { parentPort } = await import('node:worker_threads');
  parentPort?.on('message', data => run(data, value => parentPort.postMessage(value)));
}
