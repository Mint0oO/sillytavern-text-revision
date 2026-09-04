import { RevisionController, verifyChatSave, chatKey } from './controller.js';
import { RevisionUI } from './ui.js';

function init() {
  if (document.getElementById('tr-root')) return;
  if (!globalThis.SillyTavern?.getContext) return;
  const getContext = () => SillyTavern.getContext();
  const c = new RevisionController(getContext, verifyChatSave);
  const ui = new RevisionUI(c);
  const events = getContext().eventTypes ?? getContext().event_types;
  const source = getContext().eventSource;
  let timer, candidates = new Set();
  const on = (type, callback) => { if (events[type]) source.on(events[type], callback); };
  const schedule = id => {
    if (!c.settings().autoScan) return;
    if (Number.isInteger(Number(id))) candidates.add(Number(id));
    if (c.generating) return;
    clearTimeout(timer);
    const key = chatKey(getContext());
    timer = setTimeout(async () => {
      if (c.generating || c.busy || key !== chatKey(getContext())) return;
      const ids = [...candidates]; candidates.clear();
      for (const target of ids) {
        if (key !== chatKey(getContext()) || c.generating) break;
        try { await c.detect(target, { auto: true }); }
        catch (error) { ui.say(error.message, true); }
      }
    }, 180);
  };
  on('GENERATION_STARTED', () => { c.generating = true; c.onChange(); });
  on('CHARACTER_MESSAGE_RENDERED', id => schedule(id));
  on('GENERATION_ENDED', () => { c.generating = false; schedule(c.latestReply()); c.onChange(); });
  on('GENERATION_STOPPED', () => { c.generating = false; schedule(c.latestReply()); c.onChange(); });
  on('MESSAGE_SWIPED', id => schedule(id));
  on('MESSAGE_EDITED', () => { if (!c.busy) c.onChange(); });
  on('MESSAGE_DELETED', () => { candidates.clear(); c.onChange(); });
  on('CHAT_CHANGED', () => { clearTimeout(timer); candidates.clear(); c.generating = false; ui.resetChat(); });

  // Additional entry in the standard extension settings, using the host's icons.
  const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
  if (host) {
    const open = document.createElement('button'); open.type = 'button'; open.className = 'menu_button';
    open.textContent = '正文修订'; open.addEventListener('click', () => ui.open()); host.append(open);
  }
  if (getContext().SlashCommandParser && getContext().SlashCommand) {
    getContext().SlashCommandParser.addCommandObject(getContext().SlashCommand.fromProps({
      name: 'text-revision', callback: async () => { await ui.open(); return ''; }, helpString: '打开正文修订面板。',
    }));
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
