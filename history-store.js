// History is grouped by message identity and source version. A detection run is
// not a new history slot, and candidate arrays never belong in persisted data.
export const HISTORY_FORMAT_VERSION = 2;
export const utf8Bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
export function textKey(input) {
  if (typeof input !== 'string') return null;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(input.charCodeAt(i))) * 0x100000001b3n);
  return `${input.length}:${hash.toString(16)}`;
}

export function restoreBase(expected, groups, baseKey) {
  let cursor = 0, offset = 0, base = '';
  for (const group of [...(groups ?? [])].sort((a, b) => a.start - b.start)) {
    const start = group.start + offset;
    const replacement = group.applied == null ? group.original : group.applied;
    if (start < cursor || expected.slice(start, start + replacement.length) !== replacement) return null;
    base += expected.slice(cursor, start) + group.original;
    cursor = start + replacement.length;
    offset += replacement.length - (group.end - group.start);
  }
  base += expected.slice(cursor);
  return !baseKey || textKey(base) === baseKey ? base : null;
}

export function compactRound(round) {
  const copy = structuredClone(round);
  if (typeof copy.base === 'string') copy.baseKey = textKey(copy.base);
  if (typeof copy.expected === 'string') copy.expectedKey = textKey(copy.expected);
  delete copy.base;
  delete copy.expected;
  if (copy.undo?.groups) {
    copy.undo.patches = copy.undo.groups.flatMap((previous, index) => {
      const current = copy.groups?.[index];
      if (!current || previous.applied === current.applied && previous.selected === current.selected &&
        previous.matches.length === current.matches.length && previous.matches.every((match, i) =>
          match.done === current.matches[i].done && match.appliedValue === current.matches[i].appliedValue)) return [];
      return [{ index, applied: previous.applied, selected: previous.selected,
        matches: previous.matches.map(match => ({ done: match.done, appliedValue: match.appliedValue })) }];
    });
    delete copy.undo.groups;
  }
  delete copy.undo?.text;
  const trim = groups => {
    for (const group of groups ?? []) for (const match of group.matches ?? []) {
      match.options = match.value == null ? [] : [match.value];
      delete match.captures;
      delete match.ruleFind;
    }
  };
  trim(copy.groups);
  delete copy.segmented;
  return copy;
}

export function restoreUndoGroups(groups, patches) {
  const previous = structuredClone(groups);
  for (const patch of patches ?? []) {
    const group = previous[patch.index];
    if (!group || group.matches.length !== patch.matches.length) return null;
    group.applied = patch.applied;
    group.selected = patch.selected;
    group.matches.forEach((match, index) => {
      match.done = patch.matches[index].done;
      match.appliedValue = patch.matches[index].appliedValue;
    });
  }
  return previous;
}

const floorKey = round => round.messageUid || `missing:${round.id}`;
const newest = (a, b) => (b.touchedAt ?? b.time ?? 0) - (a.touchedAt ?? a.time ?? 0);

export function boundHistory(rounds) {
  const floors = new Map();
  for (const round of rounds) {
    const key = floorKey(round);
    if (!floors.has(key)) floors.set(key, []);
    floors.get(key).push(round);
  }
  const ordered = [...floors.values()].sort((a, b) => newest(a.slice().sort(newest)[0], b.slice().sort(newest)[0]));
  const keep = new Set(ordered.slice(0, 99).flat());
  const full = new Set(ordered.slice(0, 10).flat());
  return rounds.filter(round => keep.has(round)).map(round => {
    const copy = compactRound(round);
    if (!full.has(round)) {
      copy.summary = { count: copy.count, fields: copy.groups?.length ?? copy.summary?.fields ?? 0 };
      copy.groups = [];
      copy.logOnly = true;
      delete copy.undo;
      delete copy.rulesKey;
      delete copy.scope;
    }
    return copy;
  });
}

export function migrateRounds(legacy = []) {
  const records = [];
  for (const old of legacy) {
    const key = floorKey(old), versionKey = old.versionKey ?? JSON.stringify([old.swipeId ?? 0, null]);
    const index = records.findIndex(item => floorKey(item) === key && item.versionKey === versionKey);
    const next = compactRound({ ...old, versionKey, version: old.version ?? 1, touchedAt: old.touchedAt ?? old.time ?? Date.now() });
    if (index < 0) { records.push(next); continue; }
    const previous = records[index];
    const priorLog = previous.log ?? [], laterLog = next.log ?? [];
    const inherited = priorLog.length <= laterLog.length && priorLog.every((entry, i) => JSON.stringify(entry) === JSON.stringify(laterLog[i]));
    next.log = inherited ? laterLog : [...priorLog, ...laterLog];
    next.version = previous.version;
    records[index] = next;
  }
  return boundHistory(records);
}

export function upsertRound(rounds, round) {
  const oldIndex = rounds.findIndex(item => floorKey(item) === floorKey(round) && item.versionKey === round.versionKey);
  const previous = rounds[oldIndex];
  const next = { ...round, log: previous?.log ? structuredClone(previous.log) : round.log, touchedAt: Date.now() };
  const output = [...rounds];
  if (oldIndex >= 0) output.splice(oldIndex, 1);
  output.push(next);
  return boundHistory(output);
}
