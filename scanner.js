import { scan, validateRule, LIMITS } from './engine.js';
import { resolveParts } from './regex-support.js';

export async function regexMatches(text, rules, scope, { timeout = 3000 } = {}) {
  const url = new URL('./regex-worker.js', import.meta.url);
  const node = Boolean(globalThis.process?.versions?.node);
  const WorkerClass = node ? (await import('node:worker_threads')).Worker : globalThis.Worker;
  if (!WorkerClass) throw new Error('此浏览器不支持独立正则任务，请更新浏览器。');
  return new Promise((resolve, reject) => {
    const worker = new WorkerClass(url, { type: 'module' });
    const finish = (error, result) => { clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('正则检测超时，已停止；请简化表达式后重试。')), timeout);
    const receive = value => value.error ? finish(new Error(value.error)) : finish(null, value.result);
    if (node) { worker.once('message', receive); worker.once('error', error => finish(error)); }
    else { worker.onmessage = e => receive(e.data); worker.onerror = () => finish(new Error('正则任务加载失败，请确认插件更新完整。')); }
    worker.postMessage({ text, rules, scope });
  });
}

export async function scanPrepared(text, rules, options = {}) {
  if (typeof text !== 'string' || text.length > LIMITS.text) throw new Error('单条回复超过 20 万字，暂不检测。');
  if (rules.length > LIMITS.rules) throw new Error('最多启用 200 条规则。');
  rules = rules.map(validateRule);
  const regexRules = rules.filter(r => r.enabled && r.kind === 'regex');
  const found = regexRules.length ? await regexMatches(text, regexRules, options.scope, options) : {};
  let expandedLength = 0;
  for (const byRule of Object.values(found)) for (const matches of Object.values(byRule)) for (const m of matches) {
    m.options = m.options.map(parts => resolveParts(parts, options.context));
    expandedLength += m.options.reduce((n, v) => n + v.length, 0);
    if (m.options.some(v => v.length > 8000) || expandedLength > 4000000) throw new Error('宏展开后的替换内容过多，请缩小范围。');
  }
  return scan(text, rules, { ...options, regexMatches: found });
}
