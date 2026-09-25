// Pure text operations: no chat access, network requests, or DOM writes.
import { revisionSpans } from './sentences.js';
import { parseRegexes, replacementParts } from './regex-support.js';
import { priorityLevel } from './rule-groups.js';
export const ENGINE_VERSION = 10;
export const DEFAULT_RULES = [
  { id: 'very', find: '极其', kind: 'regex', editorVersion: 1, values: [], remove: true, action: 'delete', enabled: true, execution: 'inherit' },
  { id: 'possess', find: '极具', kind: 'regex', editorVersion: 1, values: ['很有', '有'], remove: false, action: 'replace', enabled: true, execution: 'inherit' },
  { id: 'extreme', find: '极度', kind: 'regex', editorVersion: 1, values: [], remove: true, action: 'delete', enabled: true, execution: 'inherit' },
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
  if (rule?.kind !== 'regex') throw new Error('旧版字词或占位模板规则已停用；请导出备份并改写为正则规则。');
  const find = String(rule.find ?? '').trim();
  if (!find || find.length > 8000) throw new Error('查找内容不能为空；正则最多 8000 字。');
  parseRegexes(find, rule.editorVersion === 1);
  if (rule.captures && Object.keys(rule.captures).length || ['before', 'after', 'notBefore', 'exceptions'].some(key => rule[key]?.length) || rule.punctuation === 'following-comma' || rule.reviewAtEnd) throw new Error('旧版词性或上下文条件无法转换，请改写为正则。');
  const values = [...new Set((Array.isArray(rule.values) ? rule.values : []).map(String).map(s => rule.editorVersion === 1 && rule.replacementMode === 'text' ? s : s.trim()).filter(s => s.length))];
  if (values.length > 100 || values.some(s => s.length > 1000)) throw new Error('每条规则最多 100 个候选，每个候选最多 1000 字。');
  values.forEach(replacementParts);
  const remove = Boolean(rule.remove);
  const action = ['delete', 'replace', 'review'].includes(rule.action) ? rule.action : remove ? 'delete' : values.length ? 'replace' : 'review';
  if (action === 'delete' && !remove) throw new Error('默认删除需要先开启“允许删除”。');
  if (action === 'replace' && !values.length) throw new Error('默认替换需要至少一个替换候选。');
  const level = priorityLevel(rule);
  const groupId = rule.groupId == null || rule.groupId === '' ? null : String(rule.groupId);
  if (groupId && groupId.length > 80) throw new Error('规则所属分组编号过长。');
  return { id: String(rule.id || newId()), find, kind: 'regex', values, remove, action, enabled: rule.enabled !== false,
    editorVersion: 1, replacementMode: rule.replacementMode === 'text' ? 'text' : 'candidates',
    execution: rule.editorVersion === 1 && rule.execution === 'inherit' ? 'inherit' : rule.execution === 'auto' && action !== 'review' ? 'auto' : 'review',
    priorityLevel: level, groupId };
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
  for (const edit of editOperations(group)) text = text.slice(0, edit.start) + edit.result + text.slice(edit.end);
  return text;
}
export const ready = g => !g.kept && proposal(g) !== (g.applied ?? g.original);
export const processed = round => round.groups.reduce((n, g) => n + g.matches.filter(m => m.done).length, 0);

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// Build edits from right to left so every offset continues to refer to the
// original sentence. Overlapping deletions are one compatible union.
function editOperations(group, includeUnresolved = false) {
  const edits = [];
  for (const match of [...group.matches].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const result = replacement(match);
    if (result === null && !includeUnresolved) continue;
    const previous = edits.at(-1);
    if (result === '' && previous?.result === '' && match.start < previous.end) {
      previous.end = Math.max(previous.end, match.end);
      previous.old = group.original.slice(previous.start, previous.end);
      previous.matches.push(match);
    } else edits.push({ start: match.start, end: match.end, old: group.original.slice(match.start, match.end), result, matches: [match] });
  }
  return edits.reverse();
}

function unresolvedOverlap(component, sentence) {
  const start = Math.min(...component.map(m => m.start));
  const end = Math.max(...component.map(m => m.end));
  return { ...component[0], start, end, coreEnd: end, old: sentence.slice(start, end), value: null, options: [], remove: false, action: 'review', reason: '多条规则重叠，请手动修改。', execution: 'review', trailing: '' };
}

function resolveOverlaps(found, sentence, random) {
  const ordered = [...found].sort((a, b) => a.start - b.start || b.end - a.end);
  const components = [];
  for (const match of ordered) {
    const current = components.at(-1);
    if (current && match.start < current.end) {
      current.matches.push(match);
      current.end = Math.max(current.end, match.end);
    } else components.push({ end: match.end, matches: [match] });
  }

  const resolved = [];
  for (const { matches: component } of components) {
    if (component.length === 1) { resolved.push(component[0]); continue; }
    // Review-only rules have no executable outcome, so keep their overlapping
    // component visible instead of silently discarding the warning.
    if (component.some(m => m.action === 'review' || m.value === null)) {
      resolved.push(unresolvedOverlap(component, sentence));
      continue;
    }

    // Lower level numbers win incompatible overlaps. Equal-level candidates
    // are shuffled once per scan; the resulting coherent set stays stable.
    const ranked = component.map(match => ({ match, tie: random() }))
      .sort((a, b) => a.match.priorityLevel - b.match.priorityLevel || a.tie - b.tie);
    const accepted = [];
    for (const { match } of ranked) {
      if (!accepted.some(other => overlaps(match, other) && !(match.action === 'delete' && other.action === 'delete'))) accepted.push(match);
    }

    // A containing deletion already performs the smaller deletion completely.
    for (const match of accepted) {
      if (match.action === 'delete' && accepted.some(other => other !== match && other.action === 'delete' && other.start <= match.start && other.end >= match.end && (other.start < match.start || other.end > match.end))) continue;
      resolved.push(match);
    }
  }
  return resolved.sort((a, b) => a.start - b.start || b.end - a.end);
}

export function scan(text, rules, { random = Math.random, id = newId(), time = Date.now(), scope, regexMatches } = {}) {
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
    for (const rule of compiled) {
      if (!regexMatches) throw new Error('正则规则需要使用独立检测任务。');
      const occurrences = (absoluteRegex[rule.id] ?? []).filter(m => m.index >= sentence.index && m.index + m.text.length <= sentence.index + sentence.text.length).map(m => Object.assign([m.text], m, { index: m.index - sentence.index }));
      for (const m of occurrences) {
        const values = m.options ?? rule.values;
        const choice = rule.action === 'delete' ? '' : rule.action === 'replace' ? values[Math.min(values.length - 1, Math.floor(random() * values.length))] : null;
        if (choice === m[0]) continue;
        const coreEnd = m.index + m[0].length;
        found.push({ start: m.index, end: coreEnd, coreEnd, old: m[0], trailing: '', reviewAtEnd: false, priorityLevel: rule.priorityLevel, ruleId: rule.id, ruleFind: rule.find, action: rule.action, execution: rule.execution, resolved: true, captures: m.captures ?? {}, options: values, remove: rule.remove, value: choice, generic: false, reason: '', done: false });
        if (found.length > LIMITS.matches) throw new Error('匹配过多，请缩小规则范围后重试。');
      }
    }
    const matches = resolveOverlaps(found, sentence.text, random);
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
  round.undo = { text: round.expected, groups: structuredClone(round.groups), reviewed: round.reviewed };
  round.log ??= [];
  const operationId = newId(), time = Date.now();
  for (const group of groups) {
    const before = group.applied ?? group.original;
    const changes = group.matches.filter(m => automatic ? !m.done && m.execution === 'auto' && replacement(m) !== null : replacement(m) !== null && replacement(m) !== (m.appliedValue ?? m.old));
    if (automatic) {
      // Keep original offsets and pending proposals; apply only automatic occurrences.
      group.applied = proposal({ ...group, matches: group.matches.map(m => m.done || changes.includes(m) ? m : { ...m, value: null }) });
    } else group.applied = proposal(group);
    if (group.manual) round.log.push({ before, after: group.applied, rule: '手动编辑整句', automatic: false, operationId, time });
    else for (const m of changes) if (replacement(m) !== (m.appliedValue ?? m.old)) round.log.push({ before: m.appliedValue ?? m.old, after: replacement(m), rule: m.ruleFind ?? m.ruleId, automatic, operationId, time });
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
  for (const edit of editOperations(group, true).reverse()) {
    result += escapeHTML(group.original.slice(cursor, edit.start));
    const m = edit.matches[0], next = edit.result;
    if (next === null) result += `<mark title="${escapeHTML(m.reason || '请手动修改或选择候选')}">${escapeHTML(edit.old)}</mark>`;
    else if (edit.matches.length === 1 && /^\{[A-Z]\}$/.test(m.value) && next && !m.trailing) {
      const at = m.value === '{A}' ? edit.old.indexOf(next) : edit.old.lastIndexOf(next);
      result += `<del>${escapeHTML(edit.old.slice(0, at))}</del>${escapeHTML(next)}<del>${escapeHTML(edit.old.slice(at + next.length))}</del>`;
    } else result += diffHTML(edit.old, next);
    cursor = edit.end;
  }
  return result + escapeHTML(group.original.slice(cursor));
}
