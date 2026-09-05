// Pure text operations: no chat access, network requests, or DOM writes.
import { analyzeWords, acceptsWord, CAPTURE_TYPES } from './language.js';
import { sentenceSpans, revisionSpans } from './sentences.js';
import { parseRegex, replacementParts } from './regex-support.js';
export const ENGINE_VERSION = 5;
export const DEFAULT_RULES = [
  { id: 'very', find: '极其', kind: 'word', values: ['十分', '非常'], remove: true, action: 'delete', enabled: true },
  { id: 'possess', find: '极具', kind: 'word', values: ['很有', '有'], remove: false, action: 'replace', enabled: true },
  { id: 'extreme', find: '极度', kind: 'word', values: ['十分'], remove: true, action: 'delete', enabled: true },
  { id: 'simile', find: '像{A}一样', kind: 'pattern', values: [], remove: true, action: 'delete', enabled: true, punctuation: 'following-comma', boundary: 'clause' },
  { id: 'contrast', find: '不是{A}，而是{B}', kind: 'pattern', values: ['{B}', '并非{A}，只是{B}'], remove: false, action: 'replace', enabled: true },
  { id: 'word-extreme', find: '{A}极了', kind: 'pattern', captures: { A: { type: 'word', words: [] } }, values: ['很{A}'], remove: false, action: 'replace', enabled: true, priority: 10, notBefore: ['不', '没', '没有', '很', '非常', '太', '更', '最'] },
];
export const LIMITS = { text: 200000, sentence: 8000, rules: 200, matches: 1000 };
// Phones may access a LAN tavern over HTTP, where crypto.randomUUID is absent.
export const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const escapeRE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Comma-separated candidates; quote candidates containing literal commas or quotes.
export const formatRuleValues = values => values.map(v => /[,"\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v).join(', ');
export function parseRuleValues(text) {
  const values = [];
  let value = '', quoted = false, closed = false;
  const push = () => { if (value.trim()) values.push(value.trim()); value = ''; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else value += c;
    } else if (c === ',' || c === '\n' || c === '\r') push();
    else if (closed) { if (!/\s/.test(c)) throw new Error('带引号的替换词后请使用英文逗号分隔。'); }
    else if (c === '"' && !value.trim()) { value = ''; quoted = true; }
    else value += c;
  }
  if (quoted) throw new Error('替换词的英文双引号未闭合。');
  push();
  return values;
}

export function validateRule(rule) {
  const find = String(rule.find ?? '').trim();
  if (!find || find.length > (rule.kind === 'regex' ? 8000 : 256)) throw new Error('查找内容不能为空；正则最多 8000 字，旧模板最多 256 字。');
  const kind = ['pattern', 'regex'].includes(rule.kind) ? rule.kind : 'word';
  if (kind === 'regex') parseRegex(find, rule.editorVersion === 1);
  const keys = kind === 'pattern' ? find.match(/\{[A-Z]\}/g) ?? [] : [];
  if (new Set(keys).size !== keys.length || find === keys[0] || keys.length > 4) throw new Error('句式需要固定文字，最多使用 4 个不重复的占位符（{A} 到 {Z}）。');
  if (kind === 'pattern' && /\{[A-Z]\}\{[A-Z]\}/.test(find)) throw new Error('两个占位符之间需要固定文字。');
  const captures = {};
  for (const key of keys) {
    const name = key[1], input = rule.captures?.[name] ?? {};
    const type = Object.hasOwn(CAPTURE_TYPES, input.type) ? input.type : 'text';
    const words = parseConditionWords(input.words);
    if (type === 'list' && !words.length) throw new Error(`${name} 选择了“仅指定词语”，请填写允许词。`);
    captures[name] = { type, words };
  }
  if (keys.filter(key => captures[key[1]].type === 'text').length > 2) throw new Error('任意文字占位符最多使用两个，其他占位符请设置词性或指定词语。');
  if (kind === 'pattern' && /^\{[A-Z]\}/.test(find) && captures[find[1]].type === 'text') throw new Error('开头的占位符需要指定词性或词语，以免把主语一起替换。');
  const values = [...new Set((Array.isArray(rule.values) ? rule.values : []).map(String).map(s => rule.editorVersion === 1 && rule.replacementMode === 'text' ? s : s.trim()).filter(s => s.length))];
  if (values.length > 100 || values.some(s => s.length > 1000)) throw new Error('每条规则最多 100 个候选，每个候选最多 1000 字。');
  if (kind === 'regex') values.forEach(replacementParts);
  if (kind === 'pattern' && values.some(v => (v.match(/\{[A-Z]\}/g) ?? []).some(k => !keys.includes(k)))) throw new Error('替换候选使用了识别句式中不存在的占位符。');
  const remove = Boolean(rule.remove);
  const action = ['delete', 'replace', 'review'].includes(rule.action) ? rule.action : remove ? 'delete' : values.length ? 'replace' : 'review';
  if (action === 'delete' && !remove) throw new Error('默认删除需要先开启“允许删除”。');
  if (action === 'replace' && !values.length) throw new Error('默认替换需要至少一个替换候选。');
  const priority = Number(rule.priority ?? 0);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new Error('优先级需要是 0–100 的整数，数字越大越优先。');
  return { id: String(rule.id || newId()), find, kind, values, remove, action, enabled: rule.enabled !== false, captures,
    ...(rule.editorVersion === 1 && kind === 'regex' ? { editorVersion: 1, replacementMode: rule.replacementMode === 'text' ? 'text' : 'candidates' } : {}),
    category: ['word', 'sentence'].includes(rule.category) ? rule.category : kind === 'pattern' ? 'sentence' : 'word',
    execution: rule.editorVersion === 1 && rule.execution === 'inherit' ? 'inherit' : rule.execution === 'auto' && action !== 'review' ? 'auto' : 'review',
    punctuation: rule.punctuation === 'following-comma' ? rule.punctuation : 'none',
    boundary: rule.boundary === 'clause' ? 'clause' : 'sentence', priority,
    before: parseConditionWords(rule.before), after: parseConditionWords(rule.after), notBefore: parseConditionWords(rule.notBefore), exceptions: parseConditionWords(rule.exceptions),
    reviewAtEnd: rule.reviewAtEnd === undefined ? kind === 'pattern' && find === '像{A}一样' : Boolean(rule.reviewAtEnd) };
}

export function parseConditionWords(value = []) {
  const words = [...new Set((Array.isArray(value) ? value : String(value).split(/[\n,，]/)).map(String).map(s => s.trim()).filter(Boolean))];
  if (words.length > 100 || words.some(w => w.length > 100)) throw new Error('条件词最多 100 个，每个最多 100 字。');
  return words;
}
export const needsLanguage = rules => rules.some(r => r.enabled !== false && r.kind === 'pattern' && Object.values(r.captures ?? {}).some(c => !['text', 'list'].includes(c.type) && c.type));

function compile(rule, tokens) {
  const keys = [];
  const bits = rule.kind === 'pattern' ? rule.find.split(/(\{[A-Z]\})/g) : [rule.find];
  const regex = new RegExp(bits.map((part, i) => {
    if (rule.kind !== 'pattern' || !/^\{[A-Z]\}$/.test(part)) return escapeRE(part);
    keys.push(part);
    const condition = rule.captures[part[1]];
    if (condition.type !== 'text') {
      const words = condition.type === 'list' ? condition.words : tokens.filter(t => acceptsWord(t, condition)).map(t => t.word);
      const alternatives = [...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRE);
      return alternatives.length ? `(${alternatives.join('|')})` : '((?!))';
    }
    // Bounded captures cannot cross a sentence or line. No user-supplied regex executes.
    const chars = rule.boundary === 'clause' ? '[^，,。！？!?；;\n]' : '[^。！？!?；;\n]';
    return `(${chars}{1,200}${i === bits.length - 2 && bits.at(-1) === '' ? '' : '?'})`;
  }).join(''), 'gd');
  return { regex, keys };
}

export const DEFAULT_EXCLUDE_TAGS = ['think', 'thinking'];
export function normalizeScope({ extractTags = [], excludeTags = DEFAULT_EXCLUDE_TAGS, extractEnabled = true, excludeEnabled = true, excludeRules, excludeRanges = [] } = {}) {
  const names = value => {
    const input = Array.isArray(value) ? value.join('\n') : String(value ?? '');
    if (input.length > 5000) throw new Error('标签设置过长，请减少标签数量。');
    const list = input.split(/[\r\n,，]+/).map(s => s.trim()).filter(Boolean).map(s => {
      const match = s.match(/^(?:<\/?([\p{L}_][\p{L}\p{N}_.: -]*?)\/?\s*>|([\p{L}_][\p{L}\p{N}_.: -]*))$/u);
      if (!match || s.length > 80) throw new Error('请填写标签名，例如 content 或 <content>，每行一个，不填写属性。');
      return (match[1] ?? match[2]).trim().toLowerCase();
    });
    if (list.length > 50) throw new Error('提取和排除标签各最多填写 50 个。');
    return [...new Set(list)].sort();
  };
  let tags = names(excludeTags), ranges = [];
  const pairs = excludeRules ?? excludeRanges;
  if (!Array.isArray(pairs) || pairs.length > 50) throw new Error('内容排除最多设置 50 条。');
  if (excludeRules !== undefined) tags = [];
  for (const pair of pairs) {
    const start = String(pair.start ?? ''), end = String(pair.end ?? '');
    if (!start.trim() || !end.trim() || start.length > 256 || end.length > 256) throw new Error('每条排除规则都需要开始和结束文字，各不超过 256 字。');
    const tag = start.match(/^<([\p{L}_][\p{L}\p{N}_.: -]*)>$/u);
    if (tag && end.toLowerCase() === `</${tag[1].toLowerCase()}>`) tags.push(tag[1].toLowerCase());
    else ranges.push({ start, end });
  }
  ranges = [...new Map(ranges.map(pair => [JSON.stringify(pair), pair])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { extractTags: extractEnabled ? names(extractTags) : [], excludeTags: excludeEnabled ? names(tags) : [], excludeRanges: excludeEnabled ? ranges : [] };
}
export const scopeKey = scope => JSON.stringify(normalizeScope(scope));

function protectedRanges(text) {
  const spans = [];
  const patterns = [/```[^]*?(?:```|$)/g, /~~~[^]*?(?:~~~|$)/g, /`[^`\n]*`/g, /<!--[^]*?(?:-->|$)/g, /<!\[CDATA\[[^]*?(?:\]\]>|$)/g, /<\?[^]*?(?:\?>|$)/g, /<![^>]*>/g, /\]\([^\n)]*\)/g, /https?:\/\/[^\s<>]+/g];
  for (const regex of patterns) for (const m of text.matchAll(regex)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function mergeRanges(ranges) {
  const result = [];
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1])) {
    if (end <= start) continue;
    const previous = result.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}

export function textRanges(text, config) {
  const scope = normalizeScope(config), protectedSpans = mergeRanges(protectedRanges(text));
  const literalSpans = [];
  for (const pair of scope.excludeRanges) {
    let cursor = 0, start;
    while ((start = text.indexOf(pair.start, cursor)) !== -1) {
      const protectedSpan = protectedSpans.find(([a, b]) => a <= start && start < b);
      if (protectedSpan) { cursor = protectedSpan[1]; continue; }
      let end = text.indexOf(pair.end, start + pair.start.length);
      if (end < 0) throw new Error(`内容排除未找到结束文字：${pair.end}`);
      // Nested literal delimiters are paired from the inside out.
      if (pair.start !== pair.end) {
        let next = start + pair.start.length;
        while ((next = text.indexOf(pair.start, next)) !== -1 && next < end) {
          end = text.indexOf(pair.end, end + pair.end.length);
          if (end < 0) throw new Error(`内容排除未找到结束文字：${pair.end}`);
          next += pair.start.length;
        }
      }
      cursor = end + pair.end.length;
      literalSpans.push([start, cursor]);
    }
  }
  const ignored = mergeRanges([...protectedSpans, ...literalSpans]);
  const extract = new Set(scope.extractTags), exclude = new Set(scope.excludeTags);
  const tracked = new Set([...extract, ...exclude]);
  const compoundNames = [...tracked].filter(name => name.includes(' ')).sort((a, b) => b.length - a.length).map(name => ({ name, pattern: new RegExp(`^<\\/?${escapeRE(name)}(?=[\\s/>])`, 'iu') }));
  const tags = [], included = [], excluded = [], stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  // Tokenize offsets only. Never parse/re-serialize HTML, which changes source formatting.
  const tokens = /<(\/?)([\p{L}_][\p{L}\p{N}_.:-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gu;
  let matchedExtraction = false, tokenCount = 0, ignoredIndex = 0;
  for (const m of text.matchAll(tokens)) {
    if (++tokenCount > 10000) throw new Error('标签过多，请缩短本条回复后重试。');
    const start = m.index, end = start + m[0].length, name = compoundNames.find(({ pattern }) => pattern.test(m[0]))?.name ?? m[2].toLowerCase();
    while (ignored[ignoredIndex]?.[1] <= start) ignoredIndex++;
    if (ignored[ignoredIndex] && ignored[ignoredIndex][0] <= start) continue;
    tags.push([start, end]);
    if (!tracked.has(name)) continue;
    // Everything inside an excluded block is opaque, except same-name nesting.
    // Literal examples such as "<content>" inside <script> are not body wrappers.
    if (stack.length && exclude.has(stack.at(-1).name) && name !== stack.at(-1).name) continue;
    if (!m[1] && (/\/\s*>$/.test(m[0]) || voidTags.has(name))) {
      if (extract.has(name)) matchedExtraction = true;
      continue;
    }
    if (!m[1]) { stack.push({ name, start, contentStart: end }); continue; }
    const opening = stack.at(-1);
    if (!opening || opening.name !== name) throw new Error(`标签 <${name}> 未正确配对，请先检查回复中的标签。`);
    stack.pop();
    if (extract.has(name)) { included.push([opening.contentStart, start]); matchedExtraction = true; }
    if (exclude.has(name)) excluded.push([opening.start, end]);
  }
  if (stack.length) throw new Error(`标签 <${stack.at(-1).name}> 没有闭合，请先补全标签后再检测。`);
  // Also keep malformed tag-like markup out of the editable text.
  for (const m of text.matchAll(/<\/?[\p{L}_][^<>\n]*(?:>|$)/gu)) tags.push([m.index, m.index + m[0].length]);
  const allowed = extract.size ? mergeRanges(included) : [[0, text.length]];
  const blocked = mergeRanges([...ignored, ...tags, ...excluded]);
  const ranges = [];
  let j = 0;
  for (const [start, end] of allowed) {
    let cursor = start;
    while (blocked[j]?.[1] <= cursor) j++;
    let k = j;
    while (blocked[k] && blocked[k][0] < end) {
      const [a, b] = blocked[k++];
      if (a > cursor) ranges.push([cursor, Math.min(a, end)]);
      cursor = Math.max(cursor, b);
      if (cursor >= end) break;
    }
    if (cursor < end) ranges.push([cursor, end]);
  }
  return { ranges, scope, notice: extract.size && !matchedExtraction ? `未找到提取标签（${scope.extractTags.join('、')}），未检测其他内容。` : '', segmented: tags.length > 0 };
}

export function replacement(match) {
  if (match.value === null) return null;
  const result = match.resolved ? match.value : match.value.replace(/\{[A-Z]\}/g, k => match.captures[k] ?? k);
  return result === '' ? '' : result + (match.trailing ?? '');
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
export function scan(text, rules, { random = Math.random, id = newId(), time = Date.now(), scope, analyze = analyzeWords, regexMatches } = {}) {
  if (typeof text !== 'string' || text.length > LIMITS.text) throw new Error('单条回复超过 20 万字，暂不检测。');
  if (rules.length > LIMITS.rules) throw new Error('最多启用 200 条规则。');
  const compiled = rules.map(validateRule).filter(r => r.enabled);
  const selection = textRanges(text, scope), groups = [];
  const absoluteRegex = {};
  for (const [base, byRule] of Object.entries(regexMatches ?? {})) for (const [ruleId, matches] of Object.entries(byRule)) {
    (absoluteRegex[ruleId] ??= []).push(...matches.map(m => ({ ...m, index: Number(base) + m.index })));
  }
  const regexSpans = Object.values(absoluteRegex).flat();
  let count = 0;
  for (const [rangeStart, rangeEnd] of selection.ranges) {
  for (const sentence of revisionSpans(text, rangeStart, rangeEnd, regexSpans)) {
    if (sentence.text.length > LIMITS.sentence) throw new Error('单个修订片段超过 8000 字，请缩小匹配范围或先分段。');
    let found = [];
    let tokens;
    for (const rule of compiled) {
      if (rule.kind === 'regex' && !regexMatches) throw new Error('正则规则需要使用独立检测任务。');
      const literals = rule.kind === 'regex' ? [] : rule.kind === 'pattern' ? rule.find.split(/\{[A-Z]\}/).filter(Boolean) : [rule.find];
      if (!literals.every(s => sentence.text.includes(s))) continue;
      const linguistic = needsLanguage([rule]);
      if (linguistic) tokens ??= analyze(sentence.text);
      const { regex, keys } = rule.kind === 'regex' ? { keys: [] } : compile(rule, tokens ?? []);
      const occurrences = rule.kind === 'regex'
        ? (absoluteRegex[rule.id] ?? []).filter(m => m.index >= sentence.index && m.index + m.text.length <= sentence.index + sentence.text.length).map(m => Object.assign([m.text], m, { index: m.index - sentence.index }))
        : [...sentenceSpans(sentence.text)].flatMap(span => [...span.text.matchAll(regex)].map(m => {
          m.index += span.index;
          m.indices = m.indices.map(pair => pair?.map(at => at + span.index));
          m.contextStart = sentence.index + span.index; m.contextEnd = m.contextStart + span.text.length;
          return m;
        }));
      for (const m of occurrences) {
        if (linguistic && (!tokens.some(t => t.start === m.index) || !tokens.some(t => t.end === m.index + m[0].length))) continue;
        if (keys.some((key, i) => {
          const condition = rule.captures[key[1]], [start, end] = m.indices[i + 1];
          return !['text', 'list'].includes(condition.type) && !tokens.some(t => t.start === start && t.end === end && acceptsWord(t, condition));
        })) continue;
        const prefix = text.slice(m.contextStart ?? sentence.index, sentence.index + m.index), suffix = text.slice(sentence.index + m.index + m[0].length, m.contextEnd ?? sentence.index + sentence.text.length);
        if (rule.before.length && !rule.before.some(w => prefix.endsWith(w)) || rule.after.length && !rule.after.some(w => suffix.startsWith(w))) continue;
        if (rule.notBefore.some(w => prefix.endsWith(w))) continue;
        // Only exceptions intersecting this occurrence suppress it, not the whole sentence.
        if (rule.exceptions.some(w => {
          let at = sentence.text.indexOf(w, Math.max(0, m.index - w.length + 1));
          return at >= 0 && at < m.index + m[0].length;
        })) continue;
        const values = m.options ?? rule.values;
        const choice = rule.action === 'delete' ? '' : rule.action === 'replace' ? values[Math.min(values.length - 1, Math.floor(random() * values.length))] : null;
        if (rule.kind === 'regex' && choice === m[0]) continue;
        const generic = rule.kind === 'pattern' && rule.find === '像{A}一样';
        const atEnd = rule.reviewAtEnd && /^[\s，,。.!！？?；;…"'”’」』）)\]］】〕〉》]*$/u.test(suffix);
        const trailing = rule.remove && rule.punctuation === 'following-comma' ? suffix.match(/^[ \t]*[，,][ \t]*/)?.[0] ?? '' : '';
        const coreEnd = m.index + m[0].length;
        found.push({ start: m.index, end: coreEnd + trailing.length, coreEnd, old: m[0] + trailing, trailing, reviewAtEnd: rule.reviewAtEnd, priority: rule.priority, ruleId: rule.id, ruleFind: rule.find, execution: rule.execution, resolved: rule.kind === 'regex', captures: m.captures ?? Object.fromEntries(keys.map((k, i) => [k, m[i + 1]])), options: values, remove: rule.remove, value: atEnd && choice === '' ? null : choice, generic, reason: atEnd && choice === '' ? '句式删除后可能不完整，请手动修改。' : '', done: false });
        if (found.length > LIMITS.matches) throw new Error('匹配过多，请缩小规则范围后重试。');
      }
    }
    // A specific template wins over the generic template covering the same span.
    found = found.filter(m => !m.generic || !found.some(n => !n.generic && n.priority >= m.priority && n.start === m.start && n.end === m.end));
    // Resolve priority before merging conflicts. Equal-priority overlaps remain reviewable.
    const preferred = [];
    for (const match of [...found].sort((a, b) => b.priority - a.priority)) {
      if (!preferred.some(m => m.priority > match.priority && m.start < match.end && match.start < m.end)) preferred.push(match);
    }
    found = preferred;
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const matches = [];
    for (const match of found) {
      const previous = matches.at(-1);
      if (previous && match.start < previous.end) {
        previous.end = Math.max(previous.end, match.end);
        previous.old = sentence.text.slice(previous.start, previous.end);
        previous.value = null;
        previous.options = [];
        previous.remove = false;
        previous.reason = '多条规则重叠，请手动修改。';
        previous.execution = 'review';
        previous.trailing = '';
      } else matches.push(match);
    }
    if (!matches.length) continue;
    matches.forEach((m, i) => { m.id = i; });
    const group = { id: groups.length, start: sentence.index, end: sentence.index + sentence.text.length, original: sentence.text, matches, manual: false, draft: '', applied: null, kept: false, selected: true };
    if (matches.some(m => m.reviewAtEnd && m.value === '') && /^(?:他|她|它|我|你|我们|你们|他们)?[。！？!?]?$/.test(proposal(group).trim())) matches.forEach(m => { m.value = null; m.reason = '删除后句子可能不完整，请手动修改。'; });
    group.selected = ready(group);
    groups.push(group);
    count += matches.length;
    if (count > LIMITS.matches) throw new Error('检出超过 1000 处，请缩小规则范围后重试。');
  }
  }
  return { id, time, engineVersion: ENGINE_VERSION, base: text, expected: text, groups, count, undo: null, scope: selection.scope, notice: selection.notice, segmented: selection.segmented };
}

export function rebuild(round) {
  let text = round.base;
  for (const group of [...round.groups].reverse()) if (group.applied !== null) text = text.slice(0, group.start) + group.applied + text.slice(group.end);
  return text;
}
export function applySelected(round, { automatic = false } = {}) {
  const eligible = g => !g.kept && !g.manual && g.matches.some(m => !m.done && m.execution === 'auto' && replacement(m) !== null && replacement(m) !== m.old);
  const groups = round.groups.filter(g => automatic ? eligible(g) : g.selected && ready(g));
  if (!groups.length) return 0;
  round.undo = { text: round.expected, groups: structuredClone(round.groups), reviewed: round.reviewed, log: structuredClone(round.log ?? []) };
  round.log ??= [];
  for (const group of groups) {
    const before = group.applied ?? group.original;
    const changes = group.matches.filter(m => automatic ? !m.done && m.execution === 'auto' && replacement(m) !== null : replacement(m) !== null && replacement(m) !== (m.appliedValue ?? m.old));
    if (automatic) {
      // Keep original offsets and pending proposals; apply only automatic occurrences.
      group.applied = proposal({ ...group, matches: group.matches.map(m => m.done || changes.includes(m) ? m : { ...m, value: null }) });
    } else group.applied = proposal(group);
    if (group.manual) round.log.push({ before, after: group.applied, rule: '手动编辑整句', automatic: false });
    else for (const m of changes) if (replacement(m) !== (m.appliedValue ?? m.old)) round.log.push({ before: m.appliedValue ?? m.old, after: replacement(m), rule: m.ruleFind ?? m.ruleId, automatic });
    group.selected = false;
    for (const m of group.matches) if (group.manual || changes.includes(m)) { m.done = true; m.appliedValue = replacement(m); }
    if (automatic) group.selected = ready(group);
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
    else if (/^\{[A-Z]\}$/.test(m.value) && next && !m.trailing) {
      const at = m.value === '{A}' ? m.old.indexOf(next) : m.old.lastIndexOf(next);
      result += `<del>${escapeHTML(m.old.slice(0, at))}</del>${escapeHTML(next)}<del>${escapeHTML(m.old.slice(at + next.length))}</del>`;
    } else result += diffHTML(m.old, next);
    cursor = m.end;
  }
  return result + escapeHTML(group.original.slice(cursor));
}
