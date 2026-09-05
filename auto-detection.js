import { chatKey, isReply, swipeId } from './controller.js';

// Completion signals are debounced, never kept as a persistent editing lock.
export function attachAutoDetection(c, ui, clock = { setTimeout: (fn, delay) => setTimeout(fn, delay), clearTimeout: id => clearTimeout(id) }) {
  const ctx = c.context(), types = ctx.eventTypes ?? ctx.event_types;
  let timer, epoch = 0, running = false;
  const pending = new Map();
  const on = (type, callback) => { if (types[type]) ctx.eventSource.on(types[type], callback); };
  const clear = () => { epoch++; c.detectionSequence++; clock.clearTimeout(timer); pending.clear(); };
  const arm = () => {
    clock.clearTimeout(timer);
    timer = clock.setTimeout(flush, 250);
  };
  const schedule = id => {
    const context = c.context(), m = context.chat[id];
    if (!c.settings().autoScan || !isReply(m)) return;
    pending.set(Number(id), { key: chatKey(context), message: m, text: m.mes, swipe: swipeId(m), epoch });
    arm();
  };
  async function flush() {
    if (!c.settings().autoScan) { clear(); return; }
    if (c.busy || running) { arm(); return; }
    running = true;
    try {
      const entries = [...pending]; pending.clear();
      for (const [id, snapshot] of entries) {
        const context = c.context(), m = context.chat[id];
        if (snapshot.epoch !== epoch || snapshot.key !== chatKey(context) || m !== snapshot.message || m.mes !== snapshot.text || swipeId(m) !== snapshot.swipe) continue;
        try {
          const round = await c.detect(id, { auto: true });
          if (snapshot.epoch === epoch && snapshot.key === chatKey(c.context()) && round?.count && c.editable(round)) {
            await c.commit(round, { automatic: true });
            if (snapshot.epoch === epoch && snapshot.key === chatKey(c.context()) && !round.reviewed && c.editable(round)) await ui.openDetected(round);
          }
        } catch (error) { if (snapshot.epoch === epoch) ui.say(error.message, true); }
      }
    } finally { running = false; if (pending.size) arm(); }
  }
  on('GENERATION_STARTED', clear);
  on('CHARACTER_MESSAGE_RENDERED', schedule);
  on('GENERATION_ENDED', () => schedule(c.latestReply()));
  on('GENERATION_STOPPED', () => schedule(c.latestReply()));
  on('MESSAGE_SWIPED', id => {
    const m = c.context().chat[id];
    // A new swipe has no saved text yet. Wait for its completion event.
    if (isReply(m) && m.swipes?.[swipeId(m)] === m.mes) schedule(id);
    c.onChange();
  });
  on('MESSAGE_EDITED', () => { if (!c.busy) c.onChange(); });
  on('MESSAGE_DELETED', () => { clear(); c.onChange(); });
  on('CHAT_CHANGED', () => { clear(); ui.resetChat(); });
  return { cancel: clear };
}
