import { DEFAULT_RULES, DEFAULT_EXCLUDE_TAGS, ENGINE_VERSION, applySelected, rebuild, ready, newId, normalizeScope, scopeKey } from './engine.js';
import { scanPrepared } from './scanner.js';
import { HISTORY_FORMAT_VERSION, compactRound, boundHistory, migrateRounds, upsertRound, restoreBase, restoreUndoGroups, textKey } from './history-store.js';
import { effectiveRules, legacyPriorityValues, legacyPriorityRules, migrateRulePriorities } from './rule-groups.js';

export const KEY = 'text_revision';
export const clone = value => structuredClone(value);
export const chatKey = c => JSON.stringify([c.groupId ?? null, c.characterId ?? null, c.chatId ?? c.getCurrentChatId?.()]);
export const swipeId = m => m.swipe_id ?? 0;
export const isReply = m => m && !m.is_user && !m.is_system && typeof m.mes === 'string' && m.mes.trim();
const rulesKey = settings => {
  const input = JSON.stringify([settings.enabled !== false, settings.ruleExecution ?? 'review', settings.rules, settings.ruleGroups]);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(input.charCodeAt(i))) * 0x100000001b3n);
  return `${input.length}:${hash.toString(16)}`;
};
export class DetectionCancelledError extends Error {
  constructor() { super('检测任务已取消。'); this.name = 'DetectionCancelledError'; }
}
export const isDetectionCancelled = error => error?.name === 'DetectionCancelledError';
export class SaveConflictError extends Error {
  constructor(status, message) { super(message); this.name = 'SaveConflictError'; this.status = status; }
}

export class RevisionController {
  constructor(getContext, verifySave) {
    this.context = getContext;
    this.verifySave = verifySave;
    this.busy = false;
    this.onChange = () => {};
    this.selectedId = null;
    this.detectionSequence = 0;
    this.detectionTasks = new WeakMap();
    this.writeTail = Promise.resolve();
    this.pendingSave = this.loadPendingState();
    this.runtimeRounds = new Map();
    this.recordSaveError = null;
  }
  settings() {
    const c = this.context();
    c.extensionSettings[KEY] ??= {};
    const s = c.extensionSettings[KEY];
    if (s.rules == null) {
      s.rules = clone(DEFAULT_RULES);
    }
    s.ruleGroups ??= [];
    if (!s.priorityLevelVersion) {
      const legacy = legacyPriorityValues(s.rules);
      const affected = legacyPriorityRules(s.rules);
      s.rules = migrateRulePriorities(s.rules);
      s.priorityLevelVersion = 1;
      if (legacy.length > 1) s.priorityMigrationNotice = { values: legacy, rules: affected };
      c.saveSettingsDebounced?.();
    }
    s.theme ??= 'light';
    s.appearance ??= 'minimal';
    s.enabled ??= true;
    s.palette ??= 'soft';
    s.transparency = Math.max(0, Math.min(100, Number(s.transparency) || 0));
    s.autoScan ??= true;
    s.ruleExecution ??= 'review';
    s.historyDetection ??= true;
    s.showLauncher ??= false;
    s.launcherTransparency ??= 0;
    s.launcherColor ??= 'theme';
    s.extractTags ??= [];
    s.excludeTags ??= clone(DEFAULT_EXCLUDE_TAGS);
    s.extractEnabled ??= true;
    s.excludeEnabled ??= true;
    s.excludeRules ??= s.excludeTags.map(name => ({ start: `<${name}>`, end: `</${name}>` }));
    // Only replace the unchanged former defaults; preserve custom exclusions.
    if (!s.exclusionDefaultsVersion) {
      const old = ['think', 'thinking', 'reasoning', 'script', 'style'];
      if (s.excludeRules.length === old.length && old.every(name => s.excludeRules.some(p => p.start === `<${name}>` && p.end === `</${name}>`))) {
        s.excludeTags = clone(DEFAULT_EXCLUDE_TAGS);
        s.excludeRules = s.excludeTags.map(name => ({ start: `<${name}>`, end: `</${name}>` }));
      }
      s.exclusionDefaultsVersion = 1;
    }
    return s;
  }
  history() {
    const metadata = this.context().chatMetadata?.[KEY];
    if (!metadata) return [];
    if (metadata.formatVersion !== HISTORY_FORMAT_VERSION) {
      const legacy = metadata.rounds ?? [];
      metadata.legacyBackup ??= clone(legacy);
      metadata.rounds = migrateRounds(legacy);
      metadata.formatVersion = HISTORY_FORMAT_VERSION;
    }
    return (metadata.rounds ?? []).map(record => {
      const runtime = this.runtimeRounds.get(record.id);
      if (record.logOnly) return record;
      if (runtime && (textKey(runtime.expected) !== record.expectedKey || runtime.reviewed !== record.reviewed || (runtime.log?.length ?? 0) !== (record.log?.length ?? 0))) {
        this.runtimeRounds.delete(record.id);
      }
      if (this.runtimeRounds.has(record.id)) return runtime;
      const matches = this.context().chat.filter(message => message?.extra?.[KEY]?.id === record.messageUid);
      const message = matches.length === 1 ? matches[0] : null;
      const marker = message?.swipe_info?.[record.swipeId]?.gen_started ?? message?.swipe_info?.[record.swipeId]?.send_date ?? null;
      if (!message || swipeId(message) !== record.swipeId || JSON.stringify([record.swipeId, marker]) !== record.versionKey || textKey(message.mes) !== record.expectedKey) return record;
      const base = restoreBase(message.mes, record.groups, record.baseKey);
      if (base === null) return record;
      const hydrated = { ...record, base, expected: message.mes };
      if (hydrated.undo) {
        const groups = hydrated.undo.groups ?? restoreUndoGroups(hydrated.groups, hydrated.undo.patches);
        if (!groups) return record;
        hydrated.undo = { ...hydrated.undo, groups, text: rebuild({ base, groups }) };
      }
      this.runtimeRounds.set(record.id, hydrated);
      return hydrated;
    });
  }
  syncRound(round, touched = false) {
    const metadata = this.context().chatMetadata?.[KEY];
    if (!metadata?.rounds?.some(item => item.id === round.id)) return;
    if (touched) round.touchedAt = Date.now();
    metadata.rounds = boundHistory(metadata.rounds.map(item => item.id === round.id ? compactRound(round) : item));
    this.runtimeRounds.set(round.id, round);
    for (const item of metadata.rounds) if (item.logOnly) this.runtimeRounds.delete(item.id);
  }
  loadPendingState() {
    try {
      const value = JSON.parse(sessionStorage.getItem('henge-pending-save-v1') || 'null');
      return value?.chatKey && typeof value.text === 'string' ? value : null;
    } catch { return null; }
  }
  savePendingState() {
    try {
      if (!this.pendingSave) sessionStorage.removeItem('henge-pending-save-v1');
      else {
        const { chatKey, text, before, status, round } = this.pendingSave;
        const identity = round ? { id: round.id, messageUid: round.messageUid, messageId: round.messageId, swipeId: round.swipeId, reviewed: round.reviewed } : this.pendingSave.identity;
        sessionStorage.setItem('henge-pending-save-v1', JSON.stringify({ chatKey, text, before, status, identity }));
      }
    } catch { /* In-memory guard still protects the active page. */ }
  }
  current() { return this.history().find(r => r.id === this.selectedId) ?? this.history().at(-1); }
  latestReply() { return this.context().chat.findLastIndex(isReply); }
  captureTarget(messageId) {
    const c = this.context(), message = c.chat[messageId];
    if (!isReply(message)) throw new Error('所选楼层不是可检测的 AI 回复。');
    return { chatKey: chatKey(c), message, messageUid: message.extra?.[KEY]?.id ?? null };
  }
  resolveTarget(target) {
    const c = this.context();
    if (!target || target.chatKey !== chatKey(c)) throw new Error('聊天已切换，所选楼层已失效。');
    let messageId = c.chat.indexOf(target.message);
    if (messageId < 0 && target.messageUid) {
      const matches = c.chat.map((message, id) => message?.extra?.[KEY]?.id === target.messageUid ? id : -1).filter(id => id >= 0);
      if (matches.length === 1) messageId = matches[0];
    }
    const message = c.chat[messageId];
    if (!isReply(message) || target.messageUid && message.extra?.[KEY]?.id !== target.messageUid) {
      throw new Error('所选楼层已不存在或身份无法确认，请重新选择该楼层。');
    }
    target.message = message;
    target.messageUid ??= message.extra?.[KEY]?.id ?? null;
    return messageId;
  }
  locateRound(round) {
    const c = this.context();
    if (!round || round.chatKey !== chatKey(c) || !round.messageUid) return -1;
    const matches = c.chat.map((message, id) => message?.extra?.[KEY]?.id === round.messageUid ? id : -1).filter(id => id >= 0);
    if (matches.length !== 1 || !isReply(c.chat[matches[0]])) return -1;
    round.messageId = matches[0];
    return matches[0];
  }
  sameTarget(left, right) {
    if (!left || !right || left.chatKey !== right.chatKey) return false;
    if (left.messageUid && right.messageUid) return left.messageUid === right.messageUid;
    return left.message === right.message;
  }
  freshRound(target) {
    let messageId;
    try { messageId = this.resolveTarget(target); } catch { return null; }
    const message = this.context().chat[messageId], uid = message.extra?.[KEY]?.id;
    if (!uid) return null;
    const round = this.history().findLast(item => item.messageUid === uid && item.swipeId === swipeId(message) && item.expected === message.mes);
    return round && this.editable(round) ? round : null;
  }
  assertIdle() {
    if (this.busy) throw new Error('正在保存，请稍候。');
    if (this.pendingSave) throw new Error('上一笔保存尚未确认，请返回对应聊天并重新确认保存状态。');
  }
  target(round, expected = round?.expected) {
    const c = this.context();
    if (!round || chatKey(c) !== round.chatKey) throw new Error('聊天已切换，请重新检测当前回复。');
    const messageId = this.locateRound(round), m = c.chat[messageId];
    if (messageId < 0) throw new Error('所选楼层已不存在或身份无法确认，请重新选择该楼层。');
    if (swipeId(m) !== round.swipeId || m.mes !== expected) {
      throw new Error('正文或回复版本已变化，请重新检测，避免覆盖你的修改。');
    }
    return m;
  }
  editable(round) {
    try { this.target(round); return !round.logOnly && this.history().some(r => r.id === round.id) && this.settings().enabled !== false && round.engineVersion === ENGINE_VERSION && round.rulesKey === rulesKey(this.settings()) && round.scope !== undefined && scopeKey(round.scope) === scopeKey(this.settings()) && !this.history().some(r => r.id !== round.id && r.number > round.number && r.messageUid === round.messageUid && r.versionKey === round.versionKey); }
    catch { return false; }
  }
  async detect(messageId = this.latestReply(), { auto = false, persist = true, signal, onReady = () => {} } = {}) {
    this.assertIdle();
    if (this.settings().enabled === false) throw new Error('插件已停用，请先在设置中启用。');
    const c = this.context(), m = c.chat[messageId];
    if (!c.chatId && !c.getCurrentChatId?.()) throw new Error('请先打开并保存一个聊天。');
    if (!isReply(m)) throw new Error('当前没有可检测的 AI 回复。');
    const sequence = this.detectionSequence, task = {};
    this.detectionTasks.set(m, task);
    const checkCancelled = () => {
      if (signal?.aborted || sequence !== this.detectionSequence || this.detectionTasks.get(m) !== task) throw new DetectionCancelledError();
    };
    checkCancelled();
    const settings = this.settings(), rules = clone(effectiveRules(settings.rules, settings.ruleGroups)), scope = normalizeScope(settings);
    const snapshot = { key: chatKey(c), target: this.captureTarget(messageId), text: m.mes, swipe: swipeId(m), rules: rulesKey(settings) };
    const history = this.history();
    const previous = history.findLast(r => r.messageUid === m.extra?.[KEY]?.id && r.swipeId === swipeId(m));
    if (auto && previous?.engineVersion === ENGINE_VERSION && previous.rulesKey === snapshot.rules && previous?.scope && scopeKey(previous.scope) === scopeKey(scope) && previous.expected === m.mes) {
      if (this.selectedId !== previous.id) { this.selectedId = previous.id; this.onChange(); }
      return null;
    }
    const round = await scanPrepared(snapshot.text, rules, { scope, context: c, executionDefault: settings.ruleExecution });
    checkCancelled();
    const now = this.context();
    let currentMessageId = -1;
    try { currentMessageId = this.resolveTarget(snapshot.target); } catch { /* Report the common stale-detection error below. */ }
    const currentMessage = now.chat[currentMessageId];
    if (chatKey(now) !== snapshot.key || !currentMessage || currentMessage.mes !== snapshot.text || swipeId(currentMessage) !== snapshot.swipe || scopeKey(this.settings()) !== scopeKey(scope) || rulesKey(this.settings()) !== snapshot.rules) {
      throw new Error('检测期间正文或设置已变化，请重新检测。');
    }
    if (this.busy) throw new DetectionCancelledError();
    currentMessage.extra ??= {};
    currentMessage.extra[KEY] ??= { id: newId() };
    const prior = this.history(), uid = currentMessage.extra[KEY].id;
    const marker = currentMessage.swipe_info?.[snapshot.swipe]?.gen_started ?? currentMessage.swipe_info?.[snapshot.swipe]?.send_date ?? null;
    const versionKey = JSON.stringify([snapshot.swipe, marker]);
    const priorVersion = prior.findLast(item => item.messageUid === uid && item.versionKey === versionKey);
    round.log = clone(priorVersion?.log ?? []);
    Object.assign(round, { rulesKey: snapshot.rules, chatKey: chatKey(now), messageId: currentMessageId, messageUid: uid, swipeId: swipeId(currentMessage), versionKey, version: priorVersion?.version ?? 1 + Math.max(0, ...prior.filter(item => item.messageUid === uid).map(item => item.version ?? 1)), number: (now.chatMetadata[KEY]?.total ?? 0) + 1 });
    const stored = upsertRound(now.chatMetadata[KEY]?.rounds ?? [], round);
    now.chatMetadata[KEY] = { ...now.chatMetadata[KEY], formatVersion: HISTORY_FORMAT_VERSION, total: round.number, rounds: stored };
    this.runtimeRounds.set(round.id, round);
    const retained = new Set(stored.filter(item => !item.logOnly).map(item => item.id));
    for (const id of this.runtimeRounds.keys()) if (!retained.has(id)) this.runtimeRounds.delete(id);
    this.selectedId = round.id;
    // Record persistence never locks reading, selection or draft editing.
    onReady(round);
    this.onChange({ type: 'detection', round });
    if (persist) await this.persistDraft();
    return round;
  }
  saveSettings() { this.context().saveSettingsDebounced(); }
  enqueueWrite(operation, key = chatKey(this.context())) {
    const next = this.writeTail.then(() => {
      if (chatKey(this.context()) !== key) throw new DetectionCancelledError();
      return operation();
    });
    this.writeTail = next.catch(() => {});
    return next;
  }
  async persistDraft() {
    if (this.pendingSave) throw new Error('上一笔保存尚未确认，暂不保存记录以免覆盖服务器正文。');
    for (const round of this.runtimeRounds.values()) this.syncRound(round);
    try {
      const key = chatKey(this.context());
      await this.enqueueWrite(async () => {
        const c = this.context(), latest = this.history().at(-1);
        await c.saveChat();
        if (chatKey(this.context()) !== key) throw new DetectionCancelledError();
        if (latest) await this.verifySave(c, latest, latest.expected, undefined, true);
      }, key);
      this.recordSaveError = null;
    } catch (error) {
      if (isDetectionCancelled(error)) throw error;
      this.recordSaveError = error.message;
      this.onChange({ type: 'record-save-failed' });
      throw new Error(`检测记录尚未可靠保存：${error.message}`);
    }
  }
  async confirmPendingSave() {
    const pending = this.pendingSave;
    if (!pending || pending.chatKey !== chatKey(this.context())) throw new Error('当前聊天没有待确认的保存。');
    pending.round ??= this.history().find(item => item.id === pending.identity?.id) ?? { chatKey: pending.chatKey, ...pending.identity };
    try {
      await this.verifySave(this.context(), pending.round, pending.text, pending.before);
      this.pendingSave = null;
      this.savePendingState();
      this.onChange();
      return 'saved';
    } catch (error) {
      if (error instanceof SaveConflictError && error.status === 'old') {
        pending.restore?.();
        this.syncRound(pending.round);
        this.pendingSave = null;
        this.savePendingState();
        this.onChange();
        return 'old';
      }
      if (error instanceof SaveConflictError && error.status === 'diverged') {
        pending.status = 'diverged';
        this.savePendingState();
        this.onChange();
        throw new Error('服务器正文与本地修改均不同。请复制当前建议并在酒馆中核对，插件不会继续覆盖。');
      }
      throw new Error(`仍无法确认服务器状态：${error.message}`);
    }
  }
  async finishReview(round) {
    this.assertIdle();
    this.target(round);
    if (!this.editable(round)) throw new Error('这轮结果已过期，请重新检测。');
    const c = this.context(), previous = round.reviewed, selections = round.groups.map(g => g.selected);
    let marked = false;
    this.busy = true; this.onChange({ type: 'busy' });
    try { await this.enqueueWrite(async () => {
      this.target(round);
      if (!this.editable(round)) throw new Error('这轮结果已过期，请重新检测。');
      round.reviewed = true; round.groups.forEach(g => { g.selected = false; });
      marked = true;
      this.syncRound(round, true);
      await c.saveChat(); await this.verifySave(c, round, round.expected);
    }, round.chatKey); }
    catch (error) {
      if (marked && error instanceof SaveConflictError && error.status === 'old') { round.reviewed = previous; round.groups.forEach((g, i) => { g.selected = selections[i]; }); this.syncRound(round); }
      else if (marked) { this.pendingSave = { chatKey: round.chatKey, round, text: round.expected, status: 'unconfirmed', restore: () => { round.reviewed = previous; round.groups.forEach((g, i) => { g.selected = selections[i]; }); } }; this.savePendingState(); }
      if (isDetectionCancelled(error)) throw error;
      throw new Error(`未能确认审阅状态已保存。${error.message}`);
    }
    finally { this.busy = false; this.onChange(); }
  }
  async commit(round, { undo = false, automatic = false, signal } = {}) {
    this.assertIdle();
    this.target(round);
    if (!this.editable(round)) throw new Error('这轮结果已过期，请重新检测后再应用。');
    const m = this.target(round), c = this.context(), before = m.mes, originalRound = clone(round), copy = clone(round);
    if (typeof document !== 'undefined' && document.querySelector(`.mes[mesid="${round.messageId}"] .edit_textarea`)) throw new Error('这条消息正在酒馆正文中编辑，请先完成或取消编辑。');
    const oldSwipes = clone(m.swipes), oldExtra = clone(m.extra), oldSwipeInfo = clone(m.swipe_info);
    let changed;
    if (undo) {
      if (!copy.undo) throw new Error('没有可以撤销的修改。');
      const operationId = newId(), time = Date.now();
      const reversals = copy.groups.flatMap((group, index) => {
        const previous = copy.undo.groups[index];
        const before = group.applied ?? group.original, after = previous?.applied ?? previous?.original;
        return before === after ? [] : [{ before, after, rule: '撤销上次应用', automatic: false, operationId, time }];
      });
      copy.expected = copy.undo.text;
      copy.groups = copy.undo.groups;
      copy.reviewed = copy.undo.reviewed;
      copy.log = [...(copy.log ?? []), ...reversals];
      copy.undo = null;
      changed = 1;
    } else {
      changed = applySelected(copy, { automatic });
      copy.reviewed = automatic ? !copy.groups.some(g => !g.kept && g.matches.some(m => !m.done)) : true;
    }
    if (!changed) return 0;
    this.busy = true;
    this.onChange({ type: 'busy' });
    try { return await this.enqueueWrite(async () => {
      let wroteBody = false, saveStarted = false;
      try {
        if (signal?.aborted) throw new DetectionCancelledError();
        if (this.target(round, before) !== m) throw new Error('正文身份已变化，请重新检测。');
        if (!this.editable(round)) throw new Error('这轮结果已过期，请重新检测。');
        m.mes = copy.expected;
        wroteBody = true;
        if (Array.isArray(m.swipes)) m.swipes[round.swipeId] = m.mes;
        delete m.extra.token_count;
        if (m.swipe_info?.[round.swipeId]?.extra) delete m.swipe_info[round.swipeId].extra.token_count;
        c.chatMetadata.tainted = true;
        Object.assign(round, copy);
        this.syncRound(round, true);
        c.updateMessageBlock(round.messageId, m);
        // Emit the same edit/update events used by the built-in editor (cache invalidation).
        await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, round.messageId);
        if (chatKey(this.context()) !== round.chatKey || m.mes !== copy.expected) throw new Error('保存期间正文发生变化，请重新检测。');
        if (c.eventTypes.MESSAGE_UPDATED) await c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED, round.messageId);
        if (chatKey(this.context()) !== round.chatKey || m.mes !== copy.expected) throw new Error('保存期间正文发生变化，请重新检测。');
        saveStarted = true;
        await c.saveChat();
        // saveChat can swallow network failures; read back the current chat to verify.
        await this.verifySave(c, round, m.mes, before);
        return changed;
      } catch (error) {
        if (isDetectionCancelled(error)) throw error;
        // Preserve the proposed draft and roll back only our own still-current text.
        const restore = () => {
          if (m.mes !== copy.expected || chatKey(this.context()) !== round.chatKey) return;
          m.mes = before;
          if (oldSwipes === undefined) delete m.swipes; else m.swipes = oldSwipes;
          m.extra = oldExtra;
          if (oldSwipeInfo === undefined) delete m.swipe_info; else m.swipe_info = oldSwipeInfo;
          for (const key of Object.keys(round)) if (!Object.hasOwn(originalRound, key)) delete round[key];
          Object.assign(round, originalRound);
          c.updateMessageBlock(round.messageId, m);
        };
        if (wroteBody && (!saveStarted || error instanceof SaveConflictError && error.status === 'old')) { restore(); this.syncRound(round); }
        else if (wroteBody) { this.pendingSave = { chatKey: round.chatKey, round, text: copy.expected, before, status: error instanceof SaveConflictError && error.status === 'diverged' ? 'diverged' : 'unconfirmed', restore }; this.savePendingState(); }
        throw new Error(`未能确认保存成功，修改建议仍保留。${error.message}`);
      }
    }, round.chatKey); } finally { this.busy = false; this.onChange(); }
  }
  selectedCount(round) { return round?.groups.filter(g => g.selected && ready(g)).length ?? 0; }
}

export async function verifyChatSave(c, round, text, before, requireRecord = false) {
  const group = c.groupId !== undefined && c.groupId !== null && c.groupId !== false;
  const character = c.characters?.[c.characterId];
  const body = group ? { id: c.chatId } : { ch_name: character?.name, file_name: c.chatId, avatar_url: character?.avatar };
  const response = await fetch(group ? '/api/chats/group/get' : '/api/chats/get', {
    method: 'POST', headers: c.getRequestHeaders(), cache: 'no-store', body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('无法读取已保存的聊天，请检查网络。');
  const saved = await response.json();
  const metadata = saved.find?.(item => item.chat_metadata)?.chat_metadata;
  const expectedRecord = c.chatMetadata?.[KEY]?.rounds?.find(item => item.id === round.id);
  const savedRecord = metadata?.[KEY]?.rounds?.find(item => item.id === round.id);
  const recordMatches = expectedRecord && savedRecord &&
    JSON.stringify(savedRecord) === JSON.stringify(expectedRecord) &&
    JSON.stringify(expectedRecord) === JSON.stringify(compactRound(round)) &&
    JSON.stringify(metadata[KEY]) === JSON.stringify(c.chatMetadata[KEY]);
  if (requireRecord) {
    if (!recordMatches) throw new SaveConflictError('old', '服务器尚未保存这次检测记录或草稿状态。');
    return;
  }
  const messages = Array.isArray(saved) ? saved.filter(m => typeof m.mes === 'string') : [];
  const m = messages[round.messageId];
  if (!m || m.extra?.[KEY]?.id !== round.messageUid || swipeId(m) !== round.swipeId) throw new SaveConflictError('diverged', '服务器消息身份或回复版本已变化。');
  if (m.mes !== text || Array.isArray(m.swipes) && m.swipes[round.swipeId] !== text) throw new SaveConflictError(m.mes === before ? 'old' : 'diverged', '服务器仍是另一版正文。');
  if (!recordMatches) throw new SaveConflictError('old', '服务器尚未保存这次操作记录或审阅状态。');
}
