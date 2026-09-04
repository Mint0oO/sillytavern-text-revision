// Bundled Jieba runs locally. No conversation text leaves this device.
let loading, analyzer;
export const CAPTURE_TYPES = { text: '任意文字', adjective: '单个形容词', noun: '单个名词', verb: '单个动词', adverb: '单个副词', word: '单个词', list: '仅指定词语' };
export async function ensureLanguage() {
  if (analyzer) return;
  loading ??= (async () => {
    const mod = await import('./vendor/jieba-wasm/jieba_rs_wasm.js');
    const url = new URL('./vendor/jieba-wasm/jieba_rs_wasm_bg.wasm', import.meta.url);
    const bytes = globalThis.process?.versions?.node
      ? await (await import('node:fs/promises')).readFile(url)
      : await (async () => {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })();
    await mod.default({ module_or_path: bytes });
    analyzer = mod.tag;
  })().catch(error => {
    loading = null;
    throw new Error('本地分词组件加载失败，请确认插件更新完整后重试。', { cause: error });
  });
  await loading;
}
export function analyzeWords(text) {
  if (!analyzer) throw new Error('词性规则需要先加载本地分词组件。');
  let offset = 0;
  // Disable unknown-word guessing: it can combine a pronoun with an adjective.
  const result = analyzer(text, false).map(({ word, tag }) => {
    const start = offset;
    offset += word.length; // JS UTF-16 offsets, including emoji and astral CJK.
    return { word, tag, start, end: offset };
  });
  if (result.map(t => t.word).join('') !== text) throw new Error('分词结果与原文不一致，已停止本次检测。');
  return result;
}
export function acceptsWord(token, condition) {
  if (condition.words.includes(token.word)) return true;
  const tag = token.tag;
  return condition.type === 'word' ? /[\p{L}\p{N}]/u.test(token.word)
    : condition.type === 'adjective' ? ['a', 'ad', 'an', 'ag'].includes(tag)
    : condition.type === 'noun' ? tag.startsWith('n')
    : condition.type === 'verb' ? tag.startsWith('v')
    : condition.type === 'adverb' ? ['d', 'dg'].includes(tag) : false;
}
