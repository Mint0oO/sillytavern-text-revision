// Offset-only sentence boundaries: punctuation is never removed or re-serialized.
const closing = /[”’」』）)\]］】〕〉》]/;
const letter = /[\p{L}\p{N}]/u;
function terminal(text, at) {
  const c = text[at];
  if (/[。！？!?]/.test(c)) return true;
  if (c === '…') return text[at - 1] === '…' || text[at + 1] === '…';
  if (c !== '.') return false;
  if (text[at - 1] === '.' || text[at + 1] === '.') return true;
  if (/\d/.test(text[at - 1] ?? '') && /\d/.test(text[at + 1] ?? '')) return false;
  const next = text.slice(at + 1);
  if (!/^(?:$|[\s”’」』）)\]］】〕〉》"'!?。！？.])/.test(next)) return false;
  // Common English titles and initials are not sentence endings before a name.
  if (/^\s+[A-Za-z]/.test(next) && /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|[A-Z])\.$/i.test(text.slice(0, at + 1))) return false;
  return true;
}

export function* sentenceSpans(text) {
  for (const line of text.matchAll(/[^\r\n]+/g)) {
    const value = line[0], quotes = new Set();
    let start = 0, i = 0;
    const quote = at => {
      const c = value[at];
      if (c !== '"' && c !== "'") return;
      // Apostrophes inside words (I'm), or unpaired possessives, are not open quotes.
      if (c === "'" && letter.test(value[at - 1] ?? '') && (letter.test(value[at + 1] ?? '') || !quotes.has(c))) return;
      if (quotes.has(c)) quotes.delete(c); else quotes.add(c);
    };
    while (i < value.length) {
      if (i === start) {
        // A closing mark left by a protected boundary or previous line stays outside
        // the next editable sentence. Its original bytes remain in round.base.
        while (/[ \t]/.test(value[i] ?? '') || closing.test(value[i] ?? '')) i++;
        start = i;
        if (i >= value.length) break;
      }
      if (!terminal(value, i)) { quote(i); i++; continue; }
      let end = i + 1;
      while (end < value.length && terminal(value, end)) end++;
      while (end < value.length) {
        let next = end;
        while (/[ \t]/.test(value[next] ?? '')) next++;
        const c = value[next];
        if (closing.test(c ?? '') || ((c === '"' || c === "'") && (quotes.has(c) || /^\s*$/.test(value.slice(next + 1))))) {
          quote(next); end = next + 1;
        } else break;
      }
      yield { index: line.index + start, text: value.slice(start, end) };
      start = i = end;
    }
    if (start < value.length) yield { index: line.index + start, text: value.slice(start) };
  }
}
