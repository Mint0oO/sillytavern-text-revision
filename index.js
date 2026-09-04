import { RevisionController, verifyChatSave } from './controller.js';
import { RevisionUI } from './ui.js';
import { attachAutoDetection } from './auto-detection.js';

function init() {
  if (document.getElementById('tr-root')) return;
  if (!globalThis.SillyTavern?.getContext) return;
  const getContext = () => SillyTavern.getContext();
  const c = new RevisionController(getContext, verifyChatSave);
  const ui = new RevisionUI(c);
  attachAutoDetection(c, ui);

  const addWandEntry = () => {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById('tr-wand-entry')) return true;
    const entry = document.createElement('button');
    entry.id = 'tr-wand-entry'; entry.type = 'button'; entry.className = 'list-group-item flex-container flexGap5';
    entry.innerHTML = '<i class="fa-solid fa-pen-to-square extensionsMenuExtensionButton" aria-hidden="true"></i><span>词句修订</span>';
    entry.addEventListener('click', () => ui.open());
    menu.append(entry);
    return true;
  };
  if (!addWandEntry()) {
    const observer = new MutationObserver(() => { if (addWandEntry()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Additional entry in the standard extension settings, using the host's icons.
  const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
  if (host) {
    const open = document.createElement('button'); open.type = 'button'; open.className = 'menu_button';
    open.textContent = '词句修订'; open.addEventListener('click', () => ui.open()); host.append(open);
  }
  if (getContext().SlashCommandParser && getContext().SlashCommand) {
    getContext().SlashCommandParser.addCommandObject(getContext().SlashCommand.fromProps({
      name: 'text-revision', callback: async () => { await ui.open(); return ''; }, helpString: '打开词句修订面板。',
    }));
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
