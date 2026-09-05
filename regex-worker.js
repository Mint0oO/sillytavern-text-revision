import { textRanges, LIMITS } from './engine.js';
import { sentenceSpans } from './sentences.js';
import { parseRegex, replacementParts } from './regex-support.js';

export function collectRegex({ text, rules, scope }) {
  const result = {};
  let count = 0, outputLength = 0;
  for (const [start, end] of textRanges(text, scope).ranges) {
    for (const sentence of sentenceSpans(text.slice(start, end))) {
      if (sentence.text.length > LIMITS.sentence) throw new Error('存在超过 8000 字的连续句子，请先分段。');
      const byRule = result[start + sentence.index] = {};
      for (const rule of rules) {
        const regex = parseRegex(rule.find), matches = byRule[rule.id] = [];
        const templates = rule.values.map(replacementParts);
        // sticky replacement on the original segment preserves lookaround and $1 semantics.
        const one = new RegExp(regex.source, regex.flags.replace(/[gy]/g, '') + 'y');
        const all = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
        for (const m of sentence.text.matchAll(all)) {
          if (!m[0].length) throw new Error(`正则 ${rule.find} 命中了空位置，请改为匹配实际文字。`);
          if (++count > LIMITS.matches) throw new Error('正则检出超过 1000 处，请缩小规则范围。');
          const options = templates.map(parts => parts.map(part => {
            if (part.macro) return part;
            one.lastIndex = m.index;
            const value = sentence.text.replace(one, part.text.replace(/\$(\$|0(?!\d))/g, (match, token) => token === '0' ? '$&' : match));
            const suffixLength = sentence.text.length - m.index - m[0].length;
            const expanded = value.slice(m.index, value.length - suffixLength);
            outputLength += expanded.length;
            if (expanded.length > 8000 || outputLength > 4000000) throw new Error('正则替换内容过多，请缩小规则范围。');
            return { text: expanded };
          }));
          matches.push({ text: m[0], index: m.index, options, captures: Object.fromEntries(m.slice(1).map((v, i) => [String(i + 1), v ?? ''])) });
          if (!regex.global) break;
        }
      }
    }
  }
  return result;
}

async function run(data, send) {
  try { send({ result: collectRegex(data) }); }
  catch (error) { send({ error: error.message }); }
}
if (typeof self !== 'undefined' && typeof document === 'undefined') self.onmessage = e => run(e.data, value => self.postMessage(value));
else if (globalThis.process?.versions?.node) {
  const { parentPort } = await import('node:worker_threads');
  parentPort?.on('message', data => run(data, value => parentPort.postMessage(value)));
}
