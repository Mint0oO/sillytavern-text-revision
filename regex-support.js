// Use the platform RegExp implementation and SillyTavern's macro resolver.
// Only configured, read-only macros are expanded; captured chat text is never evaluated.
function parseSingleRegex(find) {
  let source = find, flags = 'g';
  if (find.startsWith('/')) {
    const end = find.lastIndexOf('/');
    if (end < 1) throw new Error('正则请写成 /表达式/g，或直接填写表达式。');
    source = find.slice(1, end); flags = find.slice(end + 1);
  }
  try { return new RegExp(source, flags); }
  catch (error) { throw new Error(`正则表达式无效：${error.message}`); }
}

function explicitRegex(find) {
  if (!find.startsWith('/')) return false;
  return find.lastIndexOf('/') > 0;
}

// English commas at the top level and physical newlines are visual separators.
// Commas inside groups, character classes and quantifiers retain regex meaning;
// escaped commas and an explicit /expression/flags form bypass visual splitting.
export function splitRegexBranches(find) {
  const source = String(find ?? '').trim();
  if (!source || explicitRegex(source)) return source ? [source] : [];
  const branches = [];
  let part = '', escaped = false, inClass = false, parens = 0, braces = 0;
  const push = () => {
    const value = part.trim();
    if (value && !branches.includes(value)) branches.push(value);
    part = '';
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (escaped) { part += char; escaped = false; continue; }
    if (char === '\\') { part += char; escaped = true; continue; }
    if (char === '[' && !inClass) { inClass = true; part += char; continue; }
    if (char === ']' && inClass) { inClass = false; part += char; continue; }
    if (!inClass) {
      if (char === '(') parens++;
      else if (char === ')' && parens) parens--;
      else if (char === '{') braces++;
      else if (char === '}' && braces) braces--;
      if (char === '\n' || char === '\r') {
        push();
        if (char === '\r' && source[i + 1] === '\n') i++;
        continue;
      }
      if (char === ',' && parens === 0 && braces === 0) { push(); continue; }
    }
    part += char;
  }
  push();
  return branches;
}

export function parseRegexes(find, simple = false) {
  const branches = simple ? splitRegexBranches(find) : [String(find ?? '').trim()];
  if (!branches.length) throw new Error('请填写要查找的内容。');
  return branches.map(parseSingleRegex);
}

export function parseRegex(find, simple = false) {
  const regexes = parseRegexes(find, simple);
  if (regexes.length === 1) return regexes[0];
  if (!regexes.every(regex => regex.flags === regexes[0].flags)) throw new Error('同一条可视化规则的正则标志需要保持一致。');
  return new RegExp(regexes.map(regex => `(?:${regex.source})`).join('|'), regexes[0].flags);
}

export function replacementParts(template) {
  const parts = [], macros = /\{\{[\s\S]*?\}\}/g;
  let cursor = 0;
  for (const m of template.matchAll(macros)) {
    if (m.index > cursor) parts.push({ text: template.slice(cursor, m.index) });
    if (/^\{\{match\}\}$/i.test(m[0])) parts.push({ text: '$&' });
    else if (/^\{\{(?:user|char)\}\}$/i.test(m[0]) || /^\{\{random::[^{}]+\}\}$/i.test(m[0])) parts.push({ macro: m[0] });
    else throw new Error('替换宏支持 {{match}}、{{user}}、{{char}} 和 {{random::候选1::候选2}}。');
    cursor = m.index + m[0].length;
  }
  if (cursor < template.length) parts.push({ text: template.slice(cursor) });
  return parts;
}

export function resolveParts(parts, context) {
  return parts.map(part => {
    if (part.text !== undefined) return part.text;
    if (typeof context?.substituteParamsExtended !== 'function') throw new Error('当前酒馆未提供宏解析接口，无法预览或应用这条宏规则。');
    const result = context.substituteParamsExtended(part.macro);
    if (typeof result !== 'string' || result === part.macro) throw new Error(`酒馆未能解析宏 ${part.macro}`);
    return result;
  }).join('');
}
