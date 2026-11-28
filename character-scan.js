// Character card, bound World Info, and User Persona scanning & safe writeback.
import { applySelected, ready, validateRule, newId, LIMITS } from './engine.js';
import { scanPrepared } from './scanner.js';
import { effectiveRules } from './rule-groups.js';

export const CHARACTER_SCAN_SCOPE = Object.freeze({
  extractEnabled: false,
  extractTags: [],
  excludeEnabled: true,
  excludeTags: ['style', 'script'],
  excludeRules: [
    { start: '<style>', end: '</style>' },
    { start: '<script>', end: '</script>' },
  ],
});

const FALLBACK_CHARACTER_SCOPE = Object.freeze({
  extractEnabled: false,
  extractTags: [],
  excludeEnabled: false,
  excludeTags: [],
  excludeRules: [],
});

const readField = (ch, topKey, v2Key = topKey) => {
  if (typeof ch?.[topKey] === 'string') return ch[topKey];
  if (typeof ch?.data?.[v2Key] === 'string') return ch.data[v2Key];
  return '';
};

const writeDualField = (topKey, v2Key = topKey) => (ch, value, patch) => {
  ch[topKey] = value;
  ch.data ??= {};
  ch.data[v2Key] = value;
  patch[topKey] = value;
  patch.data ??= {};
  patch.data[v2Key] = value;
};

const writeV2Field = v2Key => (ch, value, patch) => {
  ch.data ??= {};
  ch.data[v2Key] = value;
  patch.data ??= {};
  patch.data[v2Key] = value;
};

export const PROFILE_FIELDS = [
  { key: 'description', label: '角色描述', shortLabel: '描述', domId: 'description_textarea', read: ch => readField(ch, 'description'), write: writeDualField('description') },
  { key: 'personality', label: '性格', shortLabel: '性格', domId: 'personality_textarea', read: ch => readField(ch, 'personality'), write: writeDualField('personality') },
  { key: 'scenario', label: '情景', shortLabel: '情景', domId: 'scenario_pole', read: ch => readField(ch, 'scenario'), write: writeDualField('scenario') },
  { key: 'first_mes', label: '开场白', shortLabel: '开场白', domId: 'firstmessage_textarea', read: ch => readField(ch, 'first_mes'), write: writeDualField('first_mes') },
  { key: 'mes_example', label: '对话示例', shortLabel: '对话示例', domId: 'mes_example_textarea', read: ch => readField(ch, 'mes_example'), write: writeDualField('mes_example') },
];

export const META_FIELDS = [
  { key: 'system_prompt', label: '系统提示词', shortLabel: '系统提示词', domId: 'system_prompt_textarea', read: ch => typeof ch?.data?.system_prompt === 'string' ? ch.data.system_prompt : '', write: writeV2Field('system_prompt') },
  { key: 'post_history_instructions', label: '历史后指令', shortLabel: '历史后指令', domId: 'post_history_instructions_textarea', read: ch => typeof ch?.data?.post_history_instructions === 'string' ? ch.data.post_history_instructions : '', write: writeV2Field('post_history_instructions') },
  {
    key: 'depth_prompt',
    label: '深度提示词',
    shortLabel: '深度提示词',
    domId: 'depth_prompt_prompt',
    read: ch => typeof ch?.data?.extensions?.depth_prompt?.prompt === 'string' ? ch.data.extensions.depth_prompt.prompt : '',
    write: (ch, value, patch) => {
      ch.data ??= {};
      ch.data.extensions ??= {};
      const existing = ch.data.extensions.depth_prompt ?? {};
      const depth = existing.depth ?? 4;
      const role = existing.role ?? 'system';
      ch.data.extensions.depth_prompt = { ...existing, prompt: value, depth, role };
      patch.data ??= {};
      patch.data.extensions ??= {};
      patch.data.extensions.depth_prompt = { prompt: value, depth, role };
    },
  },
  {
    key: 'creator_notes',
    label: '创作者备注',
    shortLabel: '创作者备注',
    domId: 'creator_notes_textarea',
    read: ch => typeof ch?.data?.creator_notes === 'string' ? ch.data.creator_notes : (typeof ch?.creatorcomment === 'string' ? ch.creatorcomment : ''),
    write: writeDualField('creatorcomment', 'creator_notes'),
  },
];

const FIELD_MAP = new Map([...PROFILE_FIELDS, ...META_FIELDS].map(field => [field.key, field]));

export const isGroupChat = context => context?.groupId !== undefined && context?.groupId !== null && context?.groupId !== false;

export function currentPersonaAvatar() {
  if (typeof document === 'undefined') return null;
  return document.querySelector('#user_avatar_block .avatar-container.selected')?.getAttribute('data-avatar-id') ?? null;
}

export function entryLight(entry) {
  if (entry?.constant === true) return 'blue';
  if (entry?.vectorized === true || entry?.extensions?.vectorized === true) return 'vector';
  return 'green';
}

export function entryDisplayName(entry) {
  const comment = typeof entry?.comment === 'string' ? entry.comment.trim() : '';
  if (comment) return comment;
  const keys = Array.isArray(entry?.key) ? entry.key.map(k => String(k ?? '').trim()).filter(Boolean) : [];
  if (keys.length) return keys.slice(0, 3).join('、');
  return `条目 #${entry?.uid ?? '?'}`;
}

export function extractWorldEntries(worldData) {
  const entries = Object.values(worldData?.entries ?? {});
  return entries
    .filter(entry => entry && typeof entry.content === 'string' && entry.content.trim().length > 0)
    .sort((a, b) => Number(a.displayIndex ?? a.uid ?? 0) - Number(b.displayIndex ?? b.uid ?? 0))
    .map(entry => ({
      uid: String(entry.uid),
      rawUid: entry.uid,
      title: entryDisplayName(entry),
      light: entryLight(entry),
      enabled: !entry.disable,
      text: entry.content,
    }));
}

// Generic category item selection helpers (for profile & meta categories).
export function categorySelectionState(items = [], selectedIds = new Set()) {
  const total = items.length;
  const selectedCount = items.filter(item => selectedIds.has(item.id)).length;
  return {
    total,
    selectedCount,
    active: selectedCount > 0,
    allChecked: total > 0 && selectedCount === total,
    indeterminate: selectedCount > 0 && selectedCount < total,
  };
}

export function toggleCategoryAll(items, selectedIds, checked) {
  selectedIds.clear();
  if (checked) for (const item of items) selectedIds.add(item.id);
  return selectedIds;
}

export function toggleCategoryItem(selectedIds, id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  return selectedIds;
}

// World Info filter state (Mode A): orthogonal light checkboxes + enabledOnly filter.
export function createWorldSelection(entries = []) {
  return {
    selectedUids: new Set(entries.map(entry => entry.uid)),
    enabledOnly: false,
  };
}

const matchesEnabled = (entry, enabledOnly) => !enabledOnly || entry.enabled;
const lightPool = (entries, light, enabledOnly) => entries.filter(e => e.light === light && matchesEnabled(e, enabledOnly));
const eligiblePool = (entries, enabledOnly) => entries.filter(e => matchesEnabled(e, enabledOnly));

export function worldSelectionState(entries = [], selection = createWorldSelection(entries)) {
  const { selectedUids, enabledOnly } = selection;
  const total = entries.length;
  const selectedCount = entries.filter(e => selectedUids.has(e.uid)).length;
  const allPool = eligiblePool(entries, enabledOnly);
  const lights = {};
  for (const light of ['blue', 'green', 'vector']) {
    const pool = lightPool(entries, light, enabledOnly);
    lights[light] = {
      present: entries.some(e => e.light === light),
      count: pool.length,
      total: entries.filter(e => e.light === light).length,
      disabled: pool.length === 0,
      checked: pool.length > 0 && pool.every(e => selectedUids.has(e.uid)),
    };
  }
  return {
    total,
    selectedCount,
    enabledOnly,
    allChecked: allPool.length > 0 && allPool.every(e => selectedUids.has(e.uid)),
    allDisabled: allPool.length === 0,
    lights,
    hasVector: lights.vector.present,
    active: selectedCount > 0,
    indeterminate: selectedCount > 0 && selectedCount < total,
  };
}

export function toggleWorldAll(entries, selection, checked) {
  if (!checked) {
    selection.selectedUids.clear();
    return selection;
  }
  let pool = eligiblePool(entries, selection.enabledOnly);
  if (!pool.length && selection.enabledOnly) {
    selection.enabledOnly = false;
    pool = entries;
  }
  selection.selectedUids = new Set(pool.map(e => e.uid));
  return selection;
}

export function toggleWorldLight(entries, selection, light, checked) {
  if (checked) {
    for (const entry of lightPool(entries, light, selection.enabledOnly)) selection.selectedUids.add(entry.uid);
  } else {
    for (const entry of entries) if (entry.light === light) selection.selectedUids.delete(entry.uid);
  }
  return selection;
}

export function toggleWorldEnabledOnly(entries, selection, enabledOnly) {
  const next = Boolean(enabledOnly);
  if (next === selection.enabledOnly) return selection;
  if (next) {
    selection.enabledOnly = true;
    for (const entry of entries) if (!entry.enabled) selection.selectedUids.delete(entry.uid);
    return selection;
  }
  const previous = worldSelectionState(entries, selection);
  selection.enabledOnly = false;
  for (const light of ['blue', 'green', 'vector']) {
    if (previous.lights[light].checked) {
      for (const entry of entries) if (entry.light === light && !entry.enabled) selection.selectedUids.add(entry.uid);
    }
  }
  return selection;
}

export function toggleWorldEntry(entries, selection, uid, checked) {
  const key = String(uid);
  const entry = entries.find(e => e.uid === key);
  if (!entry) return selection;
  if (checked) {
    selection.selectedUids.add(key);
    if (!entry.enabled) selection.enabledOnly = false;
  } else {
    selection.selectedUids.delete(key);
  }
  return selection;
}

// Body-rule mirror override state for character rule management.
export function ensureBodyOverrides(settings) {
  settings.characterBodyOverrides ??= { groups: {}, rules: {} };
  settings.characterBodyOverrides.groups ??= {};
  settings.characterBodyOverrides.rules ??= {};
  return settings.characterBodyOverrides;
}

export function bodyRuleOverrideState(settings = {}) {
  const bodyRules = settings.rules ?? [];
  const bodyGroups = settings.ruleGroups ?? [];
  const bodyGroupIds = new Set(bodyGroups.map(g => g.id));
  const bodyGroupMap = new Map(bodyGroups.map(g => [g.id, g]));
  const bodyUngrouped = settings.ungroupedEnabled !== false;
  const ov = settings.characterBodyOverrides ?? { groups: {}, rules: {} };
  const ovGroups = ov.groups ?? {};
  const ovRules = ov.rules ?? {};
  const includeBody = settings.characterIncludeBodyRules !== false;

  const groupEnabled = groupId => {
    const key = groupId ?? '';
    if (Object.hasOwn(ovGroups, key)) return Boolean(ovGroups[key]);
    if (!key) return bodyUngrouped;
    const group = bodyGroupMap.get(key);
    return group ? group.enabled !== false : bodyUngrouped;
  };
  const ruleEnabled = rule => {
    if (Object.hasOwn(ovRules, rule.id)) return Boolean(ovRules[rule.id]);
    return rule.enabled !== false;
  };
  const isRuleEffective = rule => {
    if (!ruleEnabled(rule)) return false;
    const key = rule.groupId && bodyGroupIds.has(rule.groupId) ? rule.groupId : '';
    return groupEnabled(key);
  };
  const activeRules = bodyRules.filter(isRuleEffective);
  const effectiveIds = new Set(activeRules.map(r => r.id));

  // Prune stale override keys when computing whether overrides differ from body defaults.
  let hasOverrides = !includeBody;
  if (!hasOverrides) {
    for (const [key, val] of Object.entries(ovGroups)) {
      if (key === '') {
        if (Boolean(val) !== bodyUngrouped) { hasOverrides = true; break; }
      } else if (bodyGroupMap.has(key) && Boolean(val) !== (bodyGroupMap.get(key).enabled !== false)) {
        hasOverrides = true; break;
      }
    }
  }
  if (!hasOverrides) {
    const ruleMap = new Map(bodyRules.map(r => [r.id, r]));
    for (const [id, val] of Object.entries(ovRules)) {
      if (ruleMap.has(id) && Boolean(val) !== (ruleMap.get(id).enabled !== false)) {
        hasOverrides = true; break;
      }
    }
  }

  return {
    includeBody,
    hasOverrides,
    groupEnabled,
    ruleEnabled,
    isRuleEffective,
    activeRules: includeBody ? activeRules : [],
    effectiveIds,
    effectiveCount: activeRules.length,
    totalCount: bodyRules.length,
  };
}

export function setCharacterBodyGroupOverride(settings, groupId, enabled) {
  const ov = ensureBodyOverrides(settings);
  const key = groupId ?? '';
  const bodyGroups = settings.ruleGroups ?? [];
  const defaultEnabled = !key
    ? settings.ungroupedEnabled !== false
    : (bodyGroups.find(g => g.id === key)?.enabled !== false);
  if (Boolean(enabled) === defaultEnabled) delete ov.groups[key];
  else ov.groups[key] = Boolean(enabled);
}

export function setCharacterBodyRuleOverride(settings, ruleId, enabled) {
  const ov = ensureBodyOverrides(settings);
  const bodyRule = (settings.rules ?? []).find(r => r.id === ruleId);
  if (!bodyRule) return;
  const defaultEnabled = bodyRule.enabled !== false;
  if (Boolean(enabled) === defaultEnabled) delete ov.rules[ruleId];
  else ov.rules[ruleId] = Boolean(enabled);
}

export function resetCharacterBodyRules(settings) {
  settings.characterIncludeBodyRules = true;
  settings.characterBodyOverrides = { groups: {}, rules: {} };
}

export async function inspectCharacterContext(context) {
  if (!context) return { status: 'no-character', reason: '请先打开一个角色聊天。' };
  if (isGroupChat(context)) return { status: 'group', reason: '暂不支持群聊角色检测，请打开单人角色聊天后再试。' };
  const characterId = context.characterId;
  if (characterId === undefined || characterId === null || characterId === '' || !context.characters?.[characterId]) {
    return { status: 'no-character', reason: '请先打开一个角色聊天。' };
  }
  if (typeof context.unshallowCharacter === 'function') {
    try { await context.unshallowCharacter(characterId); } catch { /* Best effort for already-loaded characters. */ }
  }
  const character = context.characters[characterId];
  if (!character) return { status: 'no-character', reason: '请先打开一个角色聊天。' };

  const profileItems = [];
  const profileSummary = [];
  for (const field of PROFILE_FIELDS) {
    const text = field.read(character);
    if (text.trim()) {
      profileItems.push({ id: `card:${field.key}`, category: 'profile', kind: 'character-field', fieldKey: field.key, label: field.label, text });
      profileSummary.push(field.shortLabel);
    }
  }
  const greetings = Array.isArray(character.data?.alternate_greetings) ? character.data.alternate_greetings : [];
  let altCount = 0;
  greetings.forEach((value, index) => {
    if (typeof value === 'string' && value.trim()) {
      altCount++;
      profileItems.push({ id: `card:alt:${index}`, category: 'profile', kind: 'alternate-greeting', index, label: `备用开场白 #${index + 1}`, text: value });
    }
  });
  if (altCount > 0) profileSummary.push(altCount > 1 ? `备用开场白 (${altCount})` : '备用开场白');

  const metaItems = [];
  const metaSummary = [];
  for (const field of META_FIELDS) {
    const text = field.read(character);
    if (text.trim()) {
      metaItems.push({ id: `card:${field.key}`, category: 'meta', kind: 'character-field', fieldKey: field.key, label: field.label, text });
      metaSummary.push(field.shortLabel);
    }
  }

  const worldName = typeof character.data?.extensions?.world === 'string' ? character.data.extensions.world.trim() : '';
  let worldEntries = [];
  let worldError = '';
  if (worldName) {
    if (typeof context.loadWorldInfo !== 'function') {
      worldError = '当前酒馆版本不支持读取世界书。';
    } else {
      try {
        const data = await context.loadWorldInfo(worldName);
        worldEntries = extractWorldEntries(data);
      } catch (error) {
        worldError = error?.message || '读取世界书失败。';
      }
    }
  }

  const personaText = typeof context.powerUserSettings?.persona_description === 'string' ? context.powerUserSettings.persona_description : '';
  const personaName = typeof context.name1 === 'string' && context.name1.trim() ? context.name1.trim() : 'User';
  const personaAvatar = currentPersonaAvatar();
  const personaAvailable = personaText.trim().length > 0;

  return {
    status: 'ready',
    characterId,
    avatar: character.avatar,
    characterName: character.name || '当前角色',
    personaName,
    personaAvatar,
    categories: {
      profile: {
        available: profileItems.length > 0,
        items: profileItems,
        summary: profileSummary.join('、'),
      },
      world: {
        bound: Boolean(worldName),
        worldName,
        available: Boolean(worldName) && !worldError && worldEntries.length > 0,
        entries: worldEntries,
        error: worldError,
      },
      meta: {
        available: metaItems.length > 0,
        items: metaItems,
        summary: metaSummary.join('、'),
      },
      persona: {
        available: personaAvailable,
        name: personaName,
        avatar: personaAvatar,
        items: personaAvailable ? [{ id: 'persona', category: 'persona', kind: 'persona', label: `User 人设 · ${personaName}`, text: personaText }] : [],
      },
    },
  };
}

export function createInitialCharacterSelection(snapshot) {
  if (snapshot?.status !== 'ready') return null;
  const { categories } = snapshot;
  return {
    profileIds: new Set(categories.profile.items.map(item => item.id)),
    profileExpanded: false,
    world: createWorldSelection(categories.world.entries),
    worldExpanded: false,
    metaIds: new Set(categories.meta.items.map(item => item.id)),
    metaExpanded: false,
    persona: false,
  };
}

export function reconcileCharacterSelection(snapshot, previous, previousSnapshot = null) {
  if (snapshot?.status !== 'ready') return null;
  if (!previous) return createInitialCharacterSelection(snapshot);
  const { categories } = snapshot;

  const reconcileIds = (items, prevIds) => {
    const valid = new Set(items.map(item => item.id));
    if (prevIds instanceof Set) return new Set([...prevIds].filter(id => valid.has(id)));
    return new Set(items.map(item => item.id));
  };

  const sameWorld = Boolean(
    categories.world.available &&
    previousSnapshot?.categories?.world?.worldName === categories.world.worldName &&
    previous.world
  );
  let worldSelection;
  if (sameWorld) {
    const validUids = new Set(categories.world.entries.map(e => e.uid));
    const kept = new Set([...previous.world.selectedUids].filter(uid => validUids.has(uid)));
    worldSelection = { selectedUids: kept, enabledOnly: Boolean(previous.world.enabledOnly) };
  } else {
    worldSelection = createWorldSelection(categories.world.entries);
  }
  return {
    profileIds: reconcileIds(categories.profile.items, previous.profileIds),
    profileExpanded: categories.profile.available ? Boolean(previous.profileExpanded) : false,
    world: worldSelection,
    worldExpanded: sameWorld ? Boolean(previous.worldExpanded) : false,
    metaIds: reconcileIds(categories.meta.items, previous.metaIds),
    metaExpanded: categories.meta.available ? Boolean(previous.metaExpanded) : false,
    persona: categories.persona.available ? Boolean(previous.persona) : false,
  };
}

export function findSnapshotTarget(snapshot, targetId) {
  if (snapshot?.status !== 'ready' || !targetId) return null;
  const { categories } = snapshot;
  for (const item of categories.profile.items) if (item.id === targetId) return { ...item, modalTitle: `角色设定 · ${item.label}` };
  for (const item of categories.meta.items) if (item.id === targetId) return { ...item, modalTitle: `指令与元信息 · ${item.label}` };
  if (targetId === 'persona' && categories.persona.items[0]) {
    const item = categories.persona.items[0];
    return { ...item, modalTitle: item.label };
  }
  if (targetId.startsWith('world:')) {
    const uid = targetId.slice(6);
    const entry = categories.world.entries.find(e => e.uid === uid);
    if (entry) {
      return {
        id: targetId,
        category: 'world',
        kind: 'world-entry',
        worldName: categories.world.worldName,
        uid: entry.uid,
        rawUid: entry.rawUid,
        enabled: entry.enabled,
        light: entry.light,
        label: `世界书 · ${entry.title}${entry.enabled ? '' : '（已停用）'}`,
        modalTitle: `世界书 · ${entry.title}${entry.enabled ? '' : '（已停用）'}`,
        text: entry.text,
      };
    }
  }
  return null;
}

const ruleSignature = rule => {
  const { id, enabled, execution, groupId, priorityLevel, ...content } = validateRule(rule);
  return JSON.stringify(content);
};

export function collectCharacterRules(settings) {
  const charActive = effectiveRules(
    settings.characterRules ?? [],
    settings.characterRuleGroups ?? [],
    settings.characterUngroupedEnabled !== false,
  );
  const bodyState = bodyRuleOverrideState(settings);
  const bodyActive = bodyState.activeRules;
  const merged = [];
  const seen = new Set();
  for (const rule of [...charActive, ...bodyActive]) {
    const validated = validateRule({ ...rule, execution: 'review' });
    const sig = ruleSignature(validated);
    if (seen.has(sig)) continue;
    seen.add(sig);
    merged.push({ ...validated, id: `${merged.length}:${validated.id}`, execution: 'review' });
  }
  if (merged.length > LIMITS.rules) throw new Error(`生效规则共 ${merged.length} 条，超过 ${LIMITS.rules} 条上限，请精简规则或关闭部分分组。`);
  return {
    rules: merged,
    charCount: charActive.length,
    bodyCount: bodyActive.length,
    includeBody: bodyState.includeBody,
  };
}

export function selectedTargetsFromPlan(snapshot, selection) {
  if (snapshot?.status !== 'ready' || !selection) return [];
  const targets = [];
  const { categories } = snapshot;
  if (categories.profile.available) {
    for (const item of categories.profile.items) {
      if (selection.profileIds?.has(item.id)) targets.push(item);
    }
  }
  if (categories.world.available) {
    for (const entry of categories.world.entries) {
      if (!selection.world.selectedUids.has(entry.uid)) continue;
      targets.push({
        id: `world:${entry.uid}`,
        category: 'world',
        kind: 'world-entry',
        worldName: categories.world.worldName,
        uid: entry.uid,
        rawUid: entry.rawUid,
        enabled: entry.enabled,
        light: entry.light,
        label: `世界书 · ${entry.title}${entry.enabled ? '' : '（已停用）'}`,
        text: entry.text,
      });
    }
  }
  if (categories.meta.available) {
    for (const item of categories.meta.items) {
      if (selection.metaIds?.has(item.id)) targets.push(item);
    }
  }
  if (selection.persona && categories.persona.available) targets.push(...categories.persona.items);
  return targets;
}

async function scanFieldText(text, rules, context) {
  try {
    return await scanPrepared(text, rules, { scope: CHARACTER_SCAN_SCOPE, context, executionDefault: 'review', groups: [] });
  } catch (error) {
    // Malformed <style>/<script> tags inside a card should degrade gracefully instead of blocking the whole card scan.
    if (/标签\s*<(?:style|script)>\s*未正确配对|标签\s*<(?:style|script)>\s*没有闭合|内容排除未找到结束文字/.test(error?.message ?? '')) {
      return await scanPrepared(text, rules, { scope: FALLBACK_CHARACTER_SCOPE, context, executionDefault: 'review', groups: [] });
    }
    throw error;
  }
}

export async function scanCharacterTargets(context, snapshot, selection, settings, { signal } = {}) {
  if (settings?.enabled === false) throw new Error('插件已停用，请先在设置中启用。');
  if (snapshot?.status !== 'ready') throw new Error(snapshot?.reason || '请先打开一个角色聊天。');
  const targets = selectedTargetsFromPlan(snapshot, selection);
  if (!targets.length) throw new Error('请至少勾选一项有内容的检测范围。');
  const { rules, charCount, bodyCount, includeBody } = collectCharacterRules(settings);
  if (!rules.length) throw new Error('当前没有生效的角色规则；请先在「角色规则」中添加规则或开启「正文规则」。');

  const sections = [];
  let reviewId = 0;
  let totalCount = 0;
  for (const target of targets) {
    if (signal?.aborted) {
      const error = new Error('检测任务已取消。');
      error.name = 'DetectionCancelledError';
      throw error;
    }
    const round = await scanFieldText(target.text, rules, context);
    if (signal?.aborted) {
      const error = new Error('检测任务已取消。');
      error.name = 'DetectionCancelledError';
      throw error;
    }
    if (!round.groups.length) continue;
    for (const group of round.groups) {
      group.reviewId = reviewId++;
      group.sectionId = target.id;
    }
    totalCount += round.count;
    sections.push({
      id: target.id,
      category: target.category,
      kind: target.kind,
      label: target.label,
      fieldKey: target.fieldKey,
      index: target.index,
      worldName: target.worldName,
      uid: target.uid,
      rawUid: target.rawUid,
      base: round.base,
      expected: round.expected,
      groups: round.groups,
      count: round.count,
      log: [],
      undo: null,
    });
  }

  return {
    id: newId(),
    time: Date.now(),
    characterId: snapshot.characterId,
    avatar: snapshot.avatar,
    characterName: snapshot.characterName,
    worldName: snapshot.categories.world.worldName,
    personaName: snapshot.personaName,
    personaAvatar: snapshot.personaAvatar,
    targetCount: targets.length,
    ruleSummary: { total: rules.length, charCount, bodyCount, includeBody },
    sections,
    count: totalCount,
    undoBatch: null,
  };
}

export function allCharacterGroups(scanResult) {
  return (scanResult?.sections ?? []).flatMap(section => section.groups);
}

export function locateCharacterGroup(scanResult, reviewId) {
  const id = Number(reviewId);
  for (const section of scanResult?.sections ?? []) {
    const group = section.groups.find(item => item.reviewId === id);
    if (group) return { section, group };
  }
  return null;
}

export function sectionSelectionState(section) {
  const eligible = (section?.groups ?? []).filter(ready);
  const selected = eligible.filter(g => g.selected).length;
  return {
    eligible: eligible.length,
    selected,
    disabled: eligible.length === 0,
    checked: eligible.length > 0 && selected === eligible.length,
    indeterminate: selected > 0 && selected < eligible.length,
  };
}

export function characterSelectedCount(scanResult) {
  return allCharacterGroups(scanResult).filter(group => group.selected && ready(group)).length;
}

function findWorldEntry(worldData, uid) {
  const entries = worldData?.entries;
  if (!entries) return null;
  if (Object.hasOwn(entries, uid)) return entries[uid];
  return Object.values(entries).find(item => String(item?.uid) === String(uid)) ?? null;
}

function readCurrentTargetText(context, characterId, section, worldData) {
  if (section.kind === 'character-field') {
    const ch = context.characters?.[characterId];
    const field = FIELD_MAP.get(section.fieldKey);
    return field && ch ? field.read(ch) : null;
  }
  if (section.kind === 'alternate-greeting') {
    const ch = context.characters?.[characterId];
    const list = ch?.data?.alternate_greetings;
    return Array.isArray(list) && typeof list[section.index] === 'string' ? list[section.index] : null;
  }
  if (section.kind === 'world-entry') {
    const entry = findWorldEntry(worldData, section.uid);
    return typeof entry?.content === 'string' ? entry.content : null;
  }
  if (section.kind === 'persona') {
    return typeof context.powerUserSettings?.persona_description === 'string' ? context.powerUserSettings.persona_description : null;
  }
  return null;
}

function syncCharacterDom(character, touchedFields) {
  if (typeof document === 'undefined') return;
  const activeAvatar = document.getElementById('avatar_url_pole')?.value;
  if (!activeAvatar || activeAvatar !== character.avatar) return;
  for (const fieldKey of touchedFields) {
    const field = FIELD_MAP.get(fieldKey);
    if (!field?.domId) continue;
    const el = document.getElementById(field.domId);
    if (el && 'value' in el) el.value = field.read(character);
  }
}

function syncPersonaValue(context, value) {
  if (context.powerUserSettings) context.powerUserSettings.persona_description = value;
  const el = typeof document !== 'undefined' ? document.getElementById('persona_description') : null;
  if (el && 'value' in el) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (context.powerUserSettings) context.powerUserSettings.persona_description = value;
  } else {
    context.saveSettingsDebounced?.();
  }
}

async function saveCharacterPatch(context, patch) {
  const response = await fetch('/api/characters/merge-attributes', {
    method: 'POST',
    headers: context.getRequestHeaders(),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`角色卡保存失败（HTTP ${response.status}）。`);
}

async function writeTargetChanges(context, meta, items, { saveCharacter = saveCharacterPatch } = {}) {
  if (isGroupChat(context)) throw new Error('当前已切换到群聊，无法应用修改。');
  const ch = context.characters?.[meta.characterId];
  if (!ch || ch.avatar !== meta.avatar || context.characterId !== meta.characterId) {
    throw new Error('角色已切换，请重新检测当前角色。');
  }

  const needsWorld = items.some(item => item.target.kind === 'world-entry');
  const needsPersona = items.some(item => item.target.kind === 'persona');
  if (needsPersona) {
    const activeAvatar = currentPersonaAvatar();
    if (meta.personaAvatar && activeAvatar && activeAvatar !== meta.personaAvatar) {
      throw new Error('当前 User 人设已切换，请重新打开后再保存。');
    }
    const currentName = typeof context.name1 === 'string' && context.name1.trim() ? context.name1.trim() : 'User';
    if (currentName !== meta.personaName) {
      throw new Error('当前 User 人设名称已变化，请重新打开后再保存。');
    }
  }

  let worldData = null;
  if (needsWorld) {
    if (typeof context.loadWorldInfo !== 'function' || typeof context.saveWorldInfo !== 'function') {
      throw new Error('当前酒馆环境不支持保存世界书。');
    }
    worldData = await context.loadWorldInfo(meta.worldName);
    if (!worldData?.entries) throw new Error(`未能读取世界书“${meta.worldName}”。`);
  }

  for (const item of items) {
    const live = readCurrentTargetText(context, meta.characterId, item.target, worldData);
    if (live !== item.prevText) {
      throw new Error(`“${item.target.label}”内容已在别处被修改，请刷新后再试以免覆盖。`);
    }
  }

  const cardItems = items.filter(item => item.target.kind === 'character-field' || item.target.kind === 'alternate-greeting');
  if (cardItems.length) {
    const patch = { avatar: ch.avatar };
    const touchedFields = new Set();
    const clonedCh = structuredClone(ch);
    let nextGreetings = null;
    for (const item of cardItems) {
      if (item.target.kind === 'character-field') {
        const field = FIELD_MAP.get(item.target.fieldKey);
        field.write(clonedCh, item.nextText, patch);
        touchedFields.add(item.target.fieldKey);
      } else {
        nextGreetings ??= Array.isArray(clonedCh.data?.alternate_greetings) ? [...clonedCh.data.alternate_greetings] : [];
        nextGreetings[item.target.index] = item.nextText;
      }
    }
    if (nextGreetings) {
      clonedCh.data ??= {};
      clonedCh.data.alternate_greetings = nextGreetings;
      patch.data ??= {};
      patch.data.alternate_greetings = nextGreetings;
    }
    await saveCharacter(context, patch);
    for (const item of cardItems) {
      if (item.target.kind === 'character-field') {
        FIELD_MAP.get(item.target.fieldKey).write(ch, item.nextText, {});
      }
    }
    if (nextGreetings) {
      ch.data ??= {};
      ch.data.alternate_greetings = nextGreetings;
    }
    syncCharacterDom(ch, touchedFields);
  }

  const worldItems = items.filter(item => item.target.kind === 'world-entry');
  if (worldItems.length) {
    const previousEntries = worldItems.map(item => [findWorldEntry(worldData, item.target.uid), item.prevText]);
    for (const item of worldItems) {
      const entry = findWorldEntry(worldData, item.target.uid);
      if (entry) entry.content = item.nextText;
    }
    try {
      await context.saveWorldInfo(meta.worldName, worldData, true);
    } catch (error) {
      for (const [entry, oldText] of previousEntries) if (entry) entry.content = oldText;
      throw new Error(`世界书保存失败：${error?.message || '请检查酒馆连接。'}`);
    }
    context.reloadWorldInfoEditor?.(meta.worldName, false);
  }

  const personaItem = items.find(item => item.target.kind === 'persona');
  if (personaItem) {
    syncPersonaValue(context, personaItem.nextText);
  }
}

export async function saveSingleCharacterTarget(context, snapshot, targetId, nextText, { saveCharacter = saveCharacterPatch } = {}) {
  const target = findSnapshotTarget(snapshot, targetId);
  if (!target) throw new Error('未找到对应的原文条目。');
  if (typeof nextText !== 'string') throw new Error('原文内容格式无效。');
  if (nextText === target.text) return false;
  await writeTargetChanges(context, {
    characterId: snapshot.characterId,
    avatar: snapshot.avatar,
    worldName: snapshot.categories.world.worldName,
    personaName: snapshot.personaName,
    personaAvatar: snapshot.personaAvatar,
  }, [{ target, prevText: target.text, nextText }], { saveCharacter });
  return true;
}

export async function commitCharacterScan(context, scanResult, { undo = false, saveCharacter = saveCharacterPatch } = {}) {
  if (!scanResult) throw new Error('当前没有可应用的角色检测结果。');
  let pendingSections = [];
  if (undo) {
    if (!scanResult.undoBatch?.sections?.length) throw new Error('没有可以撤销的修改。');
    pendingSections = scanResult.undoBatch.sections.map(snapshot => {
      const section = scanResult.sections.find(item => item.id === snapshot.id);
      if (!section) throw new Error('撤销目标已失效，请重新检测。');
      return { section, target: section, nextText: snapshot.text, nextGroups: structuredClone(snapshot.groups), prevText: section.expected };
    });
  } else {
    for (const section of scanResult.sections) {
      if (!section.groups.some(g => g.selected && ready(g))) continue;
      const copy = structuredClone(section);
      const changed = applySelected(copy, { automatic: false });
      if (!changed) continue;
      pendingSections.push({ section, target: section, copy, nextText: copy.expected, prevText: section.expected, changed });
    }
    if (!pendingSections.length) return 0;
  }

  const undoSnapshot = undo ? null : {
    sections: pendingSections.map(({ section }) => ({
      id: section.id,
      text: section.expected,
      groups: structuredClone(section.groups),
    })),
  };

  await writeTargetChanges(context, scanResult, pendingSections, { saveCharacter });

  let totalChanged = 0;
  for (const item of pendingSections) {
    if (undo) {
      item.section.expected = item.nextText;
      item.section.groups = item.nextGroups;
      totalChanged++;
    } else {
      item.section.expected = item.copy.expected;
      item.section.groups = item.copy.groups;
      item.section.log = item.copy.log;
      totalChanged += item.changed;
    }
  }
  scanResult.undoBatch = undo ? null : undoSnapshot;
  return totalChanged;
}
