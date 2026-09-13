import { chatKey, isReply, swipeId, isDetectionCancelled } from './controller.js';

// Completion signals are debounced. While the main panel is open, one latest
// completed reply is retained and processed only after that panel closes.
export function attachAutoDetection(c, ui, clock = { setTimeout: (fn, delay) => setTimeout(fn, delay), clearTimeout: id => clearTimeout(id) }) {
  const ctx = c.context(), types = ctx.eventTypes ?? ctx.event_types;
  let timer, epoch = 0, running = false, pending = null, deferred = null, readyToShow = null, handled = null;
  let activeDetection = null;
  const on = (type, callback) => { if (types[type]) ctx.eventSource.on(types[type], callback); };
  const enabled = () => c.settings().enabled !== false && c.settings().autoScan;
  const sameSnapshot = (left, right) => Boolean(left && right && left.key === right.key && left.message === right.message && left.text === right.text && left.swipe === right.swipe);
  const clearTimer = () => { clock.clearTimeout(timer); timer = null; };
  const clear = () => {
    epoch++;
    activeDetection?.abort();
    clearTimer();
    pending = null;
    deferred = null;
    readyToShow = null;
    handled = null;
  };
  const arm = () => {
    clearTimer();
    timer = clock.setTimeout(flush, 250);
  };
  const snapshotFor = id => {
    const context = c.context(), messageId = Number(id), message = context.chat[messageId];
    if (!enabled() || messageId !== c.latestReply() || !isReply(message)) return null;
    return { key: chatKey(context), target: c.captureTarget(messageId), message, text: message.mes, swipe: swipeId(message), epoch };
  };
  const liveId = snapshot => {
    if (!snapshot || snapshot.epoch !== epoch || snapshot.key !== chatKey(c.context()) || !enabled()) return -1;
    let messageId;
    try { messageId = c.resolveTarget(snapshot.target); } catch { return -1; }
    const message = c.context().chat[messageId];
    return messageId === c.latestReply() && message.mes === snapshot.text && swipeId(message) === snapshot.swipe ? messageId : -1;
  };
  const markHandled = snapshot => {
    let messageId = -1;
    try { messageId = c.resolveTarget(snapshot.target); } catch { /* The result will not be scheduled again once its target is gone. */ }
    const message = c.context().chat[messageId];
    handled = message ? { ...snapshot, message, target: c.captureTarget(messageId), text: message.mes, swipe: swipeId(message) } : snapshot;
  };
  const schedule = (id, type) => {
    // A first greeting can be rendered while a chat is merely loading; it is not a newly completed generation.
    if (type === 'first_message') return;
    const snapshot = snapshotFor(id);
    if (!snapshot || sameSnapshot(snapshot, handled)) return;
    if (ui.isMainOpen()) {
      deferred = { ...snapshot, reveal: true };
      pending = null;
      clearTimer();
      return;
    }
    pending = { ...snapshot, reveal: false };
    arm();
  };
  async function showOrRetain(round, snapshot) {
    if (!round || !enabled()) return;
    if (!await ui.openDetected(round)) readyToShow = { round, snapshot };
  }
  async function flush() {
    timer = null;
    if (!enabled()) { clear(); return; }
    if (c.busy || running) { if (pending) arm(); return; }
    const snapshot = pending;
    pending = null;
    const messageId = liveId(snapshot);
    if (messageId < 0) return;
    if (ui.isMainOpen()) { deferred = { ...snapshot, reveal: true }; return; }
    running = true;
    activeDetection = new AbortController();
    try {
      let round = await c.detect(messageId, { auto: true, persist: false, signal: activeDetection.signal });
      round ??= c.freshRound(snapshot.target);
      if (snapshot.epoch !== epoch || snapshot.key !== chatKey(c.context()) || !round || !enabled()) return;
      // An actual automatic edit saves the new body, log and detection together.
      const changed = round.count && c.editable(round) ? await c.commit(round, { automatic: true, signal: activeDetection.signal }) : 0;
      if (snapshot.epoch !== epoch || snapshot.key !== chatKey(c.context()) || !enabled() || !c.editable(round)) return;
      markHandled(snapshot);
      if (snapshot.reveal || round.count && !round.reviewed) await showOrRetain(round, snapshot);
      // Review-only results are visible and interactive before record persistence.
      if (!changed) await c.persistDraft();
    } catch (error) {
      if (snapshot.epoch === epoch && !isDetectionCancelled(error)) { handled = null; ui.say(error.message, true); }
    } finally {
      activeDetection = null;
      running = false;
      if (pending) arm();
    }
  }
  async function afterPanelClose() {
    if (!enabled()) { pending = deferred = readyToShow = null; return; }
    if (readyToShow) {
      const item = readyToShow;
      readyToShow = null;
      if (item.snapshot.epoch === epoch && item.snapshot.key === chatKey(c.context()) && c.editable(item.round)) await showOrRetain(item.round, item.snapshot);
      return;
    }
    if (!deferred) return;
    const snapshot = deferred;
    deferred = null;
    if (liveId(snapshot) < 0 || sameSnapshot(snapshot, handled)) return;
    pending = { ...snapshot, reveal: true };
    arm();
  }

  ui.onMainClosed = () => afterPanelClose().catch(error => ui.say(error.message, true));
  on('GENERATION_STARTED', (type, options, dryRun) => {
    if (dryRun || type === 'quiet') return;
    clear();
  });
  on('CHARACTER_MESSAGE_RENDERED', schedule);
  on('GENERATION_ENDED', () => schedule(c.latestReply()));
  on('GENERATION_STOPPED', () => schedule(c.latestReply()));
  on('MESSAGE_SWIPED', id => {
    const message = c.context().chat[id];
    // A new swipe has no saved text yet. Wait for its completion event.
    if (isReply(message) && message.swipes?.[swipeId(message)] === message.mes) schedule(id);
    c.onChange();
  });
  on('MESSAGE_EDITED', () => { if (!c.busy) c.onChange(); });
  on('MESSAGE_DELETED', () => {
    if (pending && liveId(pending) < 0) pending = null;
    if (deferred && liveId(deferred) < 0) deferred = null;
    if (readyToShow && c.locateRound(readyToShow.round) < 0) readyToShow = null;
    c.onChange();
  });
  on('CHAT_CHANGED', () => { clear(); ui.resetChat(); });
  return { cancel: clear, flush, afterPanelClose };
}
