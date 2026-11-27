import { RevisionController, verifyChatSave } from './controller.js';
import { RevisionUI } from './ui.js';
import { attachAutoDetection } from './auto-detection.js';
import { attachMessageButtons } from './message-buttons.js';

function init() {
  if (document.getElementById('tr-root')) return;
  if (!globalThis.SillyTavern?.getContext) return;
  const getContext = () => SillyTavern.getContext();
  const c = new RevisionController(getContext, verifyChatSave);
  const ui = new RevisionUI(c);
  ui.autoDetection = attachAutoDetection(c, ui);
  attachMessageButtons(c, ui);

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

  // Native collapsible drawer in SillyTavern's extension settings panel.
  const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
  if (host && !document.getElementById('tr-extension-settings')) {
    const container = document.createElement('div');
    container.id = 'tr-extension-settings';
    container.className = 'tr-extension-settings';
    container.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>词句修订</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><div class="tr-drawer-body"><label class="checkbox_label tr-drawer-toggle" for="tr-drawer-enabled"><input id="tr-drawer-enabled" type="checkbox"><span>启用词句修订</span></label><button type="button" class="menu_button tr-drawer-open">打开词句修订面板</button></div></div></div>`;
    const toggle = container.querySelector('#tr-drawer-enabled');
    const syncDrawer = () => { if (toggle) toggle.checked = c.settings().enabled !== false; };
    syncDrawer();
    const prevAvailabilityChange = ui.onPluginAvailabilityChange;
    ui.onPluginAvailabilityChange = () => { prevAvailabilityChange(); syncDrawer(); };
    toggle.addEventListener('change', () => {
      c.settings().enabled = toggle.checked;
      c.detectionSequence++;
      if (!toggle.checked) ui.autoDetection?.cancel();
      ui.badge();
      ui.onPluginAvailabilityChange();
      c.saveSettings();
      if (ui.dialog.open) ui.render();
    });
    container.querySelector('.tr-drawer-open').addEventListener('click', () => ui.open());
    host.append(container);
  }
  if (getContext().SlashCommandParser && getContext().SlashCommand) {
    getContext().SlashCommandParser.addCommandObject(getContext().SlashCommand.fromProps({
      name: 'text-revision', callback: async () => { await ui.open(); return ''; }, helpString: '打开词句修订面板。',
    }));
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
