import { DEFAULT_RULES, DEFAULT_EXCLUDE_TAGS, scan, applySelected, ready, newId, normalizeScope, scopeKey } from './engine.js';

export const KEY = 'text_revision';
export const clone = value => structuredClone(value);
export const chatKey = c => JSON.stringify([c.groupId ?? null, c.characterId ?? null, c.chatId ?? c.getCurrentChatId?.()]);
export const swipeId = m => m.swipe_id ?? 0;
export const isReply = m => m && !m.is_user && !m.is_system && typeof m.mes === 'string' && m.mes.trim();

export class RevisionController {
  constructor(getContext, verifySave) {
    this.context = getContext;
    this.verifySave = verifySave;
    this.busy = false;
    this.generating = false;
    this.onChange = () => {};
    this.selectedId = null;
  }
  settings() {
    const c = this.context();
    c.extensionSettings[KEY] ??= {};
    const s = c.extensionSettings[KEY];
    s.rules ??= clone(DEFAULT_RULES);
    s.theme ??= 'light';
    s.palette ??= 'soft';
    s.transparency ??= 0;
    s.autoScan ??= true;
    s.extractTags ??= [];
    s.excludeTags ??= clone(DEFAULT_EXCLUDE_TAGS);
    return s;
  }
  history() { return this.context().chatMetadata?.[KEY]?.rounds ?? []; }
  current() { return this.history().find(r => r.id === this.selectedId) ?? this.history().at(-1); }
  latestReply() { return this.context().chat.findLastIndex(isReply); }
  assertIdle() {
    if (this.busy) throw new Error('正在保存，请稍候。');
    const p = this.context().streamingProcessor;
    if (this.generating || p && !p.isFinished && !p.isStopped) throw new Error('请等本轮回复输出结束后再修改。');
  }
  target(round, expected = round?.expected) {
    const c = this.context();
    if (!round || chatKey(c) !== round.chatKey) throw new Error('聊天已切换，请重新检测当前回复。');
    const m = c.chat[round.messageId];
    if (!isReply(m) || m.extra?.[KEY]?.id !== round.messageUid || swipeId(m) !== round.swipeId || m.mes !== expected) {
      throw new Error('正文或回复版本已变化，请重新检测，避免覆盖你的修改。');
    }
    return m;
  }
  editable(round) {
    try { this.target(round); return round.scope !== undefined && scopeKey(round.scope) === scopeKey(this.settings()) && !this.history().some(r => r !== round && r.number > round.number && r.messageUid === round.messageUid && r.swipeId === round.swipeId); }
    catch { return false; }
  }
  async detect(messageId = this.latestReply(), { auto = false } = {}) {
    this.assertIdle();
    const c = this.context(), m = c.chat[messageId];
    if (!c.chatId && !c.getCurrentChatId?.()) throw new Error('请先打开并保存一个聊天。');
    if (!isReply(m)) throw new Error('当前没有可检测的 AI 回复。');
    const history = this.history();
    const scope = normalizeScope(this.settings());
    const previous = history.findLast(r => r.messageUid === m.extra?.[KEY]?.id && r.swipeId === swipeId(m));
    if (auto && previous?.scope && scopeKey(previous.scope) === scopeKey(scope) && previous.expected === m.mes) return null;
    const round = scan(m.mes, this.settings().rules, { scope });
    m.extra ??= {};
    m.extra[KEY] ??= { id: newId() };
    Object.assign(round, { chatKey: chatKey(c), messageId, messageUid: m.extra[KEY].id, swipeId: swipeId(m), number: (c.chatMetadata[KEY]?.total ?? 0) + 1 });
    const rounds = [...history, round];
    // Keep the complete latest round and bounded historical snapshots per chat.
    while (rounds.length > 30 || rounds.length > 1 && JSON.stringify(rounds).length > 4000000) rounds.shift();
    c.chatMetadata[KEY] = { total: round.number, rounds };
    this.selectedId = round.id;
    this.onChange();
    await c.saveChat();
    return round;
  }
  saveSettings() { this.context().saveSettingsDebounced(); }
  async persistDraft() { await this.context().saveChat(); }
  async commit(round, { undo = false } = {}) {
    this.assertIdle();
    if (!this.editable(round)) throw new Error('这轮结果已过期，请重新检测后再应用。');
    const m = this.target(round), c = this.context(), before = m.mes, originalRound = clone(round), copy = clone(round);
    if (typeof document !== 'undefined' && document.querySelector(`.mes[mesid="${round.messageId}"] .edit_textarea`)) throw new Error('这条消息正在酒馆正文中编辑，请先完成或取消编辑。');
    const oldSwipes = clone(m.swipes), oldExtra = clone(m.extra), oldSwipeInfo = clone(m.swipe_info);
    let changed;
    if (undo) {
      if (!copy.undo) throw new Error('没有可以撤销的修改。');
      copy.expected = copy.undo.text;
      copy.groups = copy.undo.groups;
      copy.undo = null;
      changed = 1;
    } else changed = applySelected(copy);
    if (!changed) return 0;
    this.busy = true;
    this.onChange();
    try {
      this.target(round, before);
      m.mes = copy.expected;
      if (Array.isArray(m.swipes)) m.swipes[round.swipeId] = m.mes;
      delete m.extra.token_count;
      if (m.swipe_info?.[round.swipeId]?.extra) delete m.swipe_info[round.swipeId].extra.token_count;
      c.chatMetadata.tainted = true;
      Object.assign(round, copy);
      c.updateMessageBlock(round.messageId, m);
      // Emit the same edit/update events used by the built-in editor (cache invalidation).
      await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, round.messageId);
      if (chatKey(this.context()) !== round.chatKey || m.mes !== copy.expected) throw new Error('保存期间正文发生变化，请重新检测。');
      if (c.eventTypes.MESSAGE_UPDATED) await c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED, round.messageId);
      if (chatKey(this.context()) !== round.chatKey || m.mes !== copy.expected) throw new Error('保存期间正文发生变化，请重新检测。');
      await c.saveChat();
      // saveChat can swallow network failures; read back the current chat to verify.
      await this.verifySave(c, round, m.mes);
      return changed;
    } catch (error) {
      // Preserve the proposed draft and roll back only our own still-current text.
      if (m.mes === copy.expected) {
        m.mes = before;
        if (oldSwipes === undefined) delete m.swipes; else m.swipes = oldSwipes;
        m.extra = oldExtra;
        if (oldSwipeInfo === undefined) delete m.swipe_info; else m.swipe_info = oldSwipeInfo;
        Object.assign(round, originalRound);
        if (chatKey(this.context()) === round.chatKey) c.updateMessageBlock(round.messageId, m);
      }
      throw new Error(`未能确认保存成功，修改建议仍保留。${error.message}`);
    } finally { this.busy = false; this.onChange(); }
  }
  selectedCount(round) { return round?.groups.filter(g => g.selected && ready(g)).length ?? 0; }
}

export async function verifyChatSave(c, round, text) {
  const group = c.groupId !== undefined && c.groupId !== null && c.groupId !== false;
  const character = c.characters?.[c.characterId];
  const body = group ? { id: c.chatId } : { ch_name: character?.name, file_name: c.chatId, avatar_url: character?.avatar };
  const response = await fetch(group ? '/api/chats/group/get' : '/api/chats/get', {
    method: 'POST', headers: c.getRequestHeaders(), cache: 'no-store', body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('无法读取已保存的聊天，请检查网络。');
  const saved = await response.json();
  const messages = Array.isArray(saved) ? saved.filter(m => typeof m.mes === 'string') : [];
  const m = messages[round.messageId];
  if (!m || m.extra?.[KEY]?.id !== round.messageUid || m.mes !== text || swipeId(m) !== round.swipeId || Array.isArray(m.swipes) && m.swipes[round.swipeId] !== text) {
    throw new Error('酒馆尚未保存这版正文，请重试。');
  }
}
