// Use the platform RegExp implementation and SillyTavern's macro resolver.
// Only configured, read-only macros are expanded; captured chat text is never evaluated.
export function parseRegex(find, simple = false) {
  let source = find, flags = 'g';
  if (find.startsWith('/')) {
    const end = find.lastIndexOf('/');
    if (end < 1) throw new Error('正则请写成 /表达式/g，或直接填写表达式。');
    source = find.slice(1, end); flags = find.slice(end + 1);
  } else if (simple && /[,\r\n]/.test(find) && !/[\\^$.*+?()[\]{}|]/.test(find)) {
    // Only plain word lists get this shortcut; regex punctuation stays intact.
    const words = [...new Set(find.split(/[,\r\n]+/).map(v => v.trim()).filter(Boolean))];
    if (!words.length) throw new Error('请填写要查找的内容。');
    source = words.sort((a, b) => b.length - a.length).join('|');
  }
  try { return new RegExp(source, flags); }
  catch (error) { throw new Error(`正则表达式无效：${error.message}`); }
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
