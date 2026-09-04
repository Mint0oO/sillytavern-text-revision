// Pure text operations: no chat access, network requests, or DOM writes.
export const DEFAULT_RULES = [
  { id: 'very', find: '极其', kind: 'word', values: ['十分', '非常'], remove: true, action: 'delete', enabled: true },
  { id: 'possess', find: '极具', kind: 'word', values: ['很有', '有'], remove: false, action: 'replace', enabled: true },
  { id: 'extreme', find: '极度', kind: 'word', values: ['十分'], remove: true, action: 'delete', enabled: true },
  { id: 'simile', find: '像{A}一样', kind: 'pattern', values: [], remove: true, action: 'delete', enabled: true },
  { id: 'contrast', find: '不是{A}，而是{B}', kind: 'pattern', values: ['{B}', '并非{A}，只是{B}'], remove: false, action: 'replace', enabled: true },
  { id: 'wolf', find: '像{A}的孤狼一样', kind: 'pattern', values: ['{A}'], remove: false, action: 'replace', enabled: true },
];
export const LIMITS = { text: 200000, sentence: 8000, rules: 200, matches: 1000 };
// Phones may access a LAN tavern over HTTP, where crypto.randomUUID is absent.
export const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const escapeRE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function validateRule(rule) {
  const find = String(rule.find ?? '').trim();
  if (!find || find.length > 256) throw new Error('识别内容需要 1–256 个字符。');
  const kind = rule.kind === 'pattern' ? 'pattern' : 'word';
  const keys = kind === 'pattern' ? find.match(/\{[AB]\}/g) ?? [] : [];
  if (new Set(keys).size !== keys.length || /\{[AB]\}$/.test(find) && find === keys[0]) throw new Error('句式需要固定文字，{A} 和 {B} 各只能出现一次。');
  if (kind === 'pattern' && /\{[AB]\}\{[AB]\}/.test(find)) throw new Error('两个占位符之间需要固定文字。');
  if (kind === 'pattern' && /^\{[AB]\}/.test(find)) throw new Error('句式开头需要固定文字，例如“像{A}一样”。');
  const values = [...new Set((Array.isArray(rule.values) ? rule.values : []).map(String).map(s => s.trim()).filter(Boolean))];
  if (values.length > 100 || values.some(s => s.length > 1000)) throw new Error('每条规则最多 100 个候选，每个候选最多 1000 字。');
  if (kind === 'pattern' && values.some(v => (v.match(/\{[AB]\}/g) ?? []).some(k => !keys.includes(k)))) throw new Error('替换候选使用了识别句式中不存在的占位符。');
  const remove = Boolean(rule.remove);
  const action = ['delete', 'replace', 'review'].includes(rule.action) ? rule.action : remove ? 'delete' : values.length ? 'replace' : 'review';
  if (action === 'delete' && !remove) throw new Error('默认删除需要先开启“允许删除”。');
  if (action === 'replace' && !values.length) throw new Error('默认替换需要至少一个替换候选。');
  return { id: String(rule.id || newId()), find, kind, values, remove, action, enabled: rule.enabled !== false };
}

function compile(rule) {
  const keys = [];
  const bits = rule.kind === 'pattern' ? rule.find.split(/(\{[AB]\})/g) : [rule.find];
  const regex = new RegExp(bits.map((part, i) => {
    if (rule.kind !== 'pattern' || !/^\{[AB]\}$/.test(part)) return escapeRE(part);
    keys.push(part);
    // Bounded captures cannot cross a sentence or line. No user-supplied regex executes.
    return i === bits.length - 2 && bits.at(-1) === '' ? '([^。！？!?；;\n]{1,200})' : '([^。！？!?；;\n]{1,200}?)';
  }).join(''), 'g');
  return { regex, keys };
}

function protectedRanges(text) {
  const spans = [];
  // Protect code, markup attributes, Markdown destinations and common reasoning blocks.
  const patterns = [/```[^]*?(?:```|$)/g, /~~~[^]*?(?:~~~|$)/g, /`[^`\n]*`/g, /<(think|thinking|reasoning|script|style)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, /<[^>\n]+>/g, /\]\([^\n)]*\)/g, /https?:\/\/[^\s<>]+/g];
  for (const regex of patterns) for (const m of text.matchAll(regex)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

export function replacement(match) {
  return match.value === null ? null : match.value.replace(/\{[AB]\}/g, k => match.captures[k] ?? k);
}
export function proposal(group) {
  if (group.kept) return group.applied ?? group.original;
  if (group.manual) return group.draft;
  let text = group.original;
  for (const match of [...group.matches].reverse()) {
    const result = replacement(match);
    if (result !== null) text = text.slice(0, match.start) + result + text.slice(match.end);
  }
  return text;
}
export const ready = g => !g.kept && proposal(g) !== (g.applied ?? g.original);
export const processed = round => round.groups.reduce((n, g) => n + g.matches.filter(m => m.done).length, 0);
export function scan(text, rules, { random = Math.random, id = newId(), time = Date.now() } = {}) {
  if (typeof text !== 'string' || text.length > LIMITS.text) throw new Error('单条回复超过 20 万字，暂不检测。');
  if (rules.length > LIMITS.rules) throw new Error('最多启用 200 条规则。');
  const compiled = rules.map(validateRule).filter(r => r.enabled).map(r => ({ ...r, ...compile(r) }));
  const protectedText = protectedRanges(text), groups = [];
  let count = 0;
  for (const sentence of text.matchAll(/[^。！？!?\n]+[。！？!?]?/g)) {
    if (sentence[0].length > LIMITS.sentence) throw new Error('存在超过 8000 字的连续句子，请先分段。');
    let found = [];
    for (const rule of compiled) {
      for (const m of sentence[0].matchAll(rule.regex)) {
        const start = sentence.index + m.index, end = start + m[0].length;
        if (protectedText.some(([a, b]) => start < b && end > a)) continue;
        const choice = rule.action === 'delete' ? '' : rule.action === 'replace' ? rule.values[Math.min(rule.values.length - 1, Math.floor(random() * rule.values.length))] : null;
        const generic = rule.kind === 'pattern' && rule.find === '像{A}一样';
        const atEnd = generic && !sentence[0].slice(m.index + m[0].length).replace(/[，,。！？!?；;\s”’」』）)]/g, '');
        found.push({ start: m.index, end: m.index + m[0].length, old: m[0], ruleId: rule.id, captures: Object.fromEntries(rule.keys.map((k, i) => [k, m[i + 1]])), options: rule.values, remove: rule.remove, value: atEnd ? null : choice, generic, reason: atEnd ? '句式删除后可能不完整，请手动修改。' : '', done: false });
        if (found.length > LIMITS.matches) throw new Error('匹配过多，请缩小规则范围后重试。');
      }
    }
    // A specific template wins over the generic template covering the same span.
    found = found.filter(m => !m.generic || !found.some(n => !n.generic && n.start === m.start && n.end === m.end));
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const matches = [];
    for (const match of found) {
      const previous = matches.at(-1);
      if (previous && match.start < previous.end) {
        previous.end = Math.max(previous.end, match.end);
        previous.old = sentence[0].slice(previous.start, previous.end);
        previous.value = null;
        previous.options = [];
        previous.remove = false;
        previous.reason = '多条规则重叠，请手动修改。';
      } else matches.push(match);
    }
    if (!matches.length) continue;
    matches.forEach((m, i) => { m.id = i; });
    const group = { id: groups.length, start: sentence.index, end: sentence.index + sentence[0].length, original: sentence[0], matches, manual: false, draft: '', applied: null, kept: false, selected: true };
    if (/^(?:他|她|它|我|你|我们|你们|他们)?[。！？!?]?$/.test(proposal(group).trim())) matches.forEach(m => { m.value = null; m.reason = '删除后句子可能不完整，请手动修改。'; });
    group.selected = ready(group);
    groups.push(group);
    count += matches.length;
    if (count > LIMITS.matches) throw new Error('检出超过 1000 处，请缩小规则范围后重试。');
  }
  return { id, time, base: text, expected: text, groups, count, undo: null };
}

export function rebuild(round) {
  let text = round.base;
  for (const group of [...round.groups].reverse()) if (group.applied !== null) text = text.slice(0, group.start) + group.applied + text.slice(group.end);
  return text;
}
export function applySelected(round) {
  const groups = round.groups.filter(g => g.selected && ready(g));
  if (!groups.length) return 0;
  round.undo = { text: round.expected, groups: structuredClone(round.groups) };
  for (const group of groups) {
    group.applied = proposal(group);
    group.selected = false;
    for (const m of group.matches) if (group.manual || replacement(m) !== null) m.done = true;
  }
  round.expected = rebuild(round);
  return groups.length;
}

export function diffHTML(a, b) {
  if (a === b) return escapeHTML(a);
  if (a.length * b.length > 250000) return `<del>${escapeHTML(a)}</del><ins>${escapeHTML(b)}</ins>`;
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, output = '', buffer = '', kind = '';
  const push = (type, c) => { if (kind !== type) { output += kind === 'same' ? escapeHTML(buffer) : kind ? `<${kind}>${escapeHTML(buffer)}</${kind}>` : ''; buffer = ''; kind = type; } buffer += c; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { push('same', a[i++]); j++; }
    else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1])) push('del', a[i++]);
    else push('ins', b[j++]);
  }
  push('end', '');
  return output;
}
export function inlineHTML(group) {
  if (group.kept) return escapeHTML(group.applied ?? group.original);
  if (group.manual) return diffHTML(group.original, group.draft);
  let result = '', cursor = 0;
  for (const m of group.matches) {
    result += escapeHTML(group.original.slice(cursor, m.start));
    const next = replacement(m);
    if (next === null) result += `<mark title="${escapeHTML(m.reason || '请手动修改或选择候选')}">${escapeHTML(m.old)}</mark>`;
    else if ((m.value === '{A}' || m.value === '{B}') && next) {
      const at = m.value === '{A}' ? m.old.indexOf(next) : m.old.lastIndexOf(next);
      result += `<del>${escapeHTML(m.old.slice(0, at))}</del>${escapeHTML(next)}<del>${escapeHTML(m.old.slice(at + next.length))}</del>`;
    } else result += diffHTML(m.old, next);
    cursor = m.end;
  }
  return result + escapeHTML(group.original.slice(cursor));
}
