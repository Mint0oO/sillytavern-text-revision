import { DEFAULT_RULES, DEFAULT_EXCLUDE_TAGS, ENGINE_VERSION, needsLanguage, applySelected, ready, newId, normalizeScope, scopeKey } from './engine.js';
import { ensureLanguage } from './language.js';
import { scanPrepared } from './scanner.js';
import { createRuleDraft, simpleRule } from './rule-editor.js';

export const KEY = 'text_revision';
export const clone = value => structuredClone(value);
export const chatKey = c => JSON.stringify([c.groupId ?? null, c.characterId ?? null, c.chatId ?? c.getCurrentChatId?.()]);
export const swipeId = m => m.swipe_id ?? 0;
export const isReply = m => m && !m.is_user && !m.is_system && typeof m.mes === 'string' && m.mes.trim();
const rulesKey = settings => JSON.stringify([settings.ruleExecution ?? 'review', settings.rules]);

export class RevisionController {
  constructor(getContext, verifySave, prepareLanguage = ensureLanguage) {
    this.context = getContext;
    this.verifySave = verifySave;
    this.busy = false;
    this.onChange = () => {};
    this.selectedId = null;
    this.prepareLanguage = prepareLanguage;
    this.detectionSequence = 0;
  }
  settings() {
    const c = this.context();
    c.extensionSettings[KEY] ??= {};
    const s = c.extensionSettings[KEY];
    if (s.rules == null) {
      s.rules = DEFAULT_RULES.filter(rule => rule.kind === 'word').map(rule => simpleRule(createRuleDraft(rule), rule));
      s.ruleDefaultsVersion = 2;
    }
    if (!s.ruleDefaultsVersion) {
      s.rules = s.rules.filter(r => !(r.kind === 'pattern' && r.find === '像{A}的孤狼一样'));
      s.ruleDefaultsVersion = 1;
    }
    if (s.ruleDefaultsVersion < 2) {
      // Upgrade only recognizable built-ins; keep user-written rules and disabled states.
      const simile = s.rules.find(r => r.id === 'simile' && r.kind === 'pattern' && r.find === '像{A}一样' && r.remove && r.action === 'delete' && !r.values?.length);
      if (simile) { simile.punctuation ??= 'following-comma'; simile.boundary ??= 'clause'; }
      if (s.rules.some(r => ['very', 'simile', 'extreme', 'contrast'].includes(r.id)) && !s.rules.some(r => r.find === '{A}极了')) {
        s.rules.push(clone(DEFAULT_RULES.find(r => r.id === 'word-extreme')));
      }
      s.ruleDefaultsVersion = 2;
    }
    s.theme ??= 'light';
    s.appearance ??= 'minimal';
    s.appearanceEnabled ??= true;
    s.palette ??= 'soft';
    s.transparency ??= 0;
    s.autoScan ??= true;
    s.ruleExecution ??= 'review';
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
  history() { return this.context().chatMetadata?.[KEY]?.rounds ?? []; }
  current() { return this.history().find(r => r.id === this.selectedId) ?? this.history().at(-1); }
  latestReply() { return this.context().chat.findLastIndex(isReply); }
  assertIdle() {
    if (this.busy) throw new Error('正在保存，请稍候。');
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
    try { this.target(round); return round.engineVersion === ENGINE_VERSION && round.rulesKey === rulesKey(this.settings()) && round.scope !== undefined && scopeKey(round.scope) === scopeKey(this.settings()) && !this.history().some(r => r !== round && r.number > round.number && r.messageUid === round.messageUid && r.swipeId === round.swipeId); }
    catch { return false; }
  }
  async detect(messageId = this.latestReply(), { auto = false } = {}) {
    this.assertIdle();
    const c = this.context(), m = c.chat[messageId];
    if (!c.chatId && !c.getCurrentChatId?.()) throw new Error('请先打开并保存一个聊天。');
    if (!isReply(m)) throw new Error('当前没有可检测的 AI 回复。');
    const sequence = ++this.detectionSequence;
    const settings = this.settings(), rules = clone(settings.rules), scope = normalizeScope(settings);
    const snapshot = { key: chatKey(c), text: m.mes, swipe: swipeId(m), rules: rulesKey(settings), history: c.chatMetadata[KEY] };
    const history = this.history();
    const previous = history.findLast(r => r.messageUid === m.extra?.[KEY]?.id && r.swipeId === swipeId(m));
    if (auto && previous?.engineVersion === ENGINE_VERSION && previous.rulesKey === snapshot.rules && previous?.scope && scopeKey(previous.scope) === scopeKey(scope) && previous.expected === m.mes) {
      if (this.selectedId !== previous.id) { this.selectedId = previous.id; this.onChange(); }
      return null;
    }
    if (needsLanguage(rules)) await this.prepareLanguage();
    const round = await scanPrepared(snapshot.text, rules, { scope, context: c, executionDefault: settings.ruleExecution });
    const now = this.context();
    if (sequence !== this.detectionSequence || chatKey(now) !== snapshot.key || now.chat[messageId] !== m || m.mes !== snapshot.text || swipeId(m) !== snapshot.swipe || scopeKey(this.settings()) !== scopeKey(scope) || rulesKey(this.settings()) !== snapshot.rules || now.chatMetadata[KEY] !== snapshot.history) {
      throw new Error('检测期间正文或设置已变化，请重新检测。');
    }
    this.assertIdle();
    m.extra ??= {};
    m.extra[KEY] ??= { id: newId() };
    Object.assign(round, { rulesKey: snapshot.rules, chatKey: chatKey(c), messageId, messageUid: m.extra[KEY].id, swipeId: swipeId(m), number: (c.chatMetadata[KEY]?.total ?? 0) + 1 });
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
  async finishReview(round) {
    this.assertIdle();
    if (!this.editable(round)) throw new Error('这轮结果已过期，请重新检测。');
    const c = this.context(), previous = round.reviewed, selections = round.groups.map(g => g.selected);
    this.busy = true; round.reviewed = true; round.groups.forEach(g => { g.selected = false; }); this.onChange();
    try { await c.saveChat(); await this.verifySave(c, round, round.expected); }
    catch (error) { round.reviewed = previous; round.groups.forEach((g, i) => { g.selected = selections[i]; }); throw new Error(`未能确认审阅状态已保存。${error.message}`); }
    finally { this.busy = false; this.onChange(); }
  }
  async commit(round, { undo = false, automatic = false } = {}) {
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
      copy.reviewed = copy.undo.reviewed;
      copy.log = copy.undo.log ?? [];
      copy.undo = null;
      changed = 1;
    } else {
      changed = applySelected(copy, { automatic });
      copy.reviewed = automatic ? !copy.groups.some(g => !g.kept && g.matches.some(m => !m.done)) : true;
    }
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
        for (const key of Object.keys(round)) if (!Object.hasOwn(originalRound, key)) delete round[key];
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
  if (round.reviewed) {
    const metadata = saved.find?.(item => item.chat_metadata)?.chat_metadata;
    if (!metadata?.[KEY]?.rounds?.some(r => r.id === round.id && r.reviewed)) throw new Error('酒馆尚未保存完成审阅的状态，请重试。');
  }
}
