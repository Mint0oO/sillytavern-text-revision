import { scan, validateRule, LIMITS } from './engine.js';
import { resolveParts } from './regex-support.js';
import { resolveRuleExecution } from './rule-groups.js';

let workerState = null;
let workerQueue = Promise.resolve();
let requestSequence = 0;

async function ensureWorker() {
  if (workerState) return workerState;
  const url = new URL('./regex-worker.js', import.meta.url);
  const node = Boolean(globalThis.process?.versions?.node);
  const WorkerClass = node ? (await import('node:worker_threads')).Worker : globalThis.Worker;
  if (!WorkerClass) throw new Error('此浏览器不支持独立正则任务，请更新浏览器。');
  const worker = new WorkerClass(url, { type: 'module' });
  const state = { worker, node, pending: null };
  const failActive = error => {
    const current = state.pending;
    state.pending = null;
    if (workerState === state) workerState = null;
    worker.terminate();
    if (current) {
      clearTimeout(current.timer);
      current.reject(error);
    }
  };
  const receive = value => {
    const current = state.pending;
    if (!current || value?.id !== current.id) return;
    state.pending = null;
    clearTimeout(current.timer);
    if (node) worker.unref?.();
    if (value.error) current.reject(new Error(value.error));
    else current.resolve(value.result);
  };
  if (node) {
    worker.on('message', receive);
    worker.on('error', error => failActive(error));
    worker.on('exit', code => {
      if (state.pending) failActive(new Error(`正则任务意外结束（${code}）。`));
      else if (workerState === state) workerState = null;
    });
    worker.unref?.();
  } else {
    worker.onmessage = e => receive(e.data);
    worker.onerror = () => failActive(new Error('正则任务加载失败，请确认插件更新完整。'));
  }
  workerState = state;
  return state;
}

export function disposeRegexWorker() {
  if (!workerState) return;
  const state = workerState;
  workerState = null;
  if (state.pending) {
    clearTimeout(state.pending.timer);
    state.pending.reject(new Error('正则任务已停止。'));
    state.pending = null;
  }
  state.worker.terminate();
}

function runOnWorker(payload, timeout) {
  return new Promise(async (resolve, reject) => {
    let state;
    try { state = await ensureWorker(); }
    catch (error) { reject(error); return; }
    const id = ++requestSequence;
    if (state.node) state.worker.ref?.();
    const timer = setTimeout(() => {
      if (state.pending?.id !== id) return;
      state.pending = null;
      if (workerState === state) workerState = null;
      state.worker.terminate();
      reject(new Error('正则检测超时，已停止；请简化表达式后重试。'));
    }, timeout);
    state.pending = { id, resolve, reject, timer };
    try {
      state.worker.postMessage({ id, ...payload });
    } catch (error) {
      clearTimeout(timer);
      state.pending = null;
      if (state.node) state.worker.unref?.();
      reject(error);
    }
  });
}

export function regexMatches(text, rules, scope, { timeout = 3000 } = {}) {
  const next = workerQueue.then(() => runOnWorker({ text, rules, scope }, timeout));
  workerQueue = next.catch(() => {});
  return next;
}

export async function scanPrepared(text, rules, options = {}) {
  if (typeof text !== 'string' || text.length > LIMITS.text) throw new Error('单条回复超过 20 万字，暂不检测。');
  if (rules.length > LIMITS.rules) throw new Error('最多启用 200 条规则。');
  rules = rules.map(validateRule).map(rule => ({
    ...rule,
    execution: resolveRuleExecution(rule, options.groups, options.executionDefault),
  }));
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
