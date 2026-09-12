import { isReply } from './controller.js';

const BUTTON_CLASS = 'tr-message-scan';

export function messageIdFromElement(element) {
  const message = element?.closest?.('.mes');
  const messageId = Number(message?.getAttribute?.('mesid'));
  return Number.isInteger(messageId) && messageId >= 0 ? messageId : -1;
}

// Add one host-style action beside each rendered AI reply. Native host actions
// are <div class="mes_button"> slots, so the entry uses the same tag: themes
// that float, wrap or size toolbar children by tag keep treating it as one
// ordinary icon slot. A small observer is scoped to #chat so upward history
// loading and message redraws are covered without repeatedly scanning the page.
export function attachMessageButtons(c, ui, root = document) {
  let chat = null, chatObserver = null, waitingObserver = null;
  const syncState = action => {
    const disabled = c.settings().enabled === false;
    action.classList.toggle('is-disabled', disabled);
    action.toggleAttribute('aria-disabled', disabled);
  };
  const ensure = messageElement => {
    if (!messageElement?.matches?.('.mes')) return;
    const messageId = messageIdFromElement(messageElement), message = c.context().chat[messageId];
    const existing = messageElement.querySelector(`.${BUTTON_CLASS}`);
    if (c.settings().historyDetection === false) { existing?.remove(); return; }
    if (!isReply(message)) { existing?.remove(); return; }
    const edit = messageElement.querySelector('.mes_buttons .mes_edit');
    if (!edit) return;
    if (existing) { syncState(existing); return; }
    const action = root.createElement('div');
    action.className = `mes_button ${BUTTON_CLASS}`;
    action.setAttribute('role', 'button');
    action.tabIndex = 0;
    action.title = '检测本楼层';
    action.setAttribute('aria-label', '检测本楼层');
    action.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3l-9 9a2 2 0 0 1-.9.5l-2.9.9a.55.55 0 0 1-.6-.6l.9-2.9a2 2 0 0 1 .5-.9z"/></svg>';
    syncState(action);
    edit.before(action);
  };
  const scanNode = node => {
    if (node.nodeType !== 1) return;
    if (node.matches?.('.mes')) ensure(node);
    node.querySelectorAll?.('.mes').forEach(ensure);
  };
  const activate = action => {
    const messageId = messageIdFromElement(action), message = c.context().chat[messageId];
    if (!isReply(message)) { action.remove(); ui.say('这条回复已不存在或不可检测。', true); return; }
    if (c.settings().enabled === false) { ui.say('插件已停用，请先在设置中启用。', true); return; }
    ui.run(() => ui.open(messageId, { force: true }));
  };
  const attach = () => {
    const next = root.getElementById('chat');
    if (!next) return false;
    chat = next;
    chat.querySelectorAll('.mes').forEach(ensure);
    chat.addEventListener('click', event => {
      const action = event.target.closest?.(`.${BUTTON_CLASS}`);
      if (!action || !chat.contains(action)) return;
      event.preventDefault();
      event.stopPropagation();
      activate(action);
    });
    chat.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      const action = event.target.closest?.(`.${BUTTON_CLASS}`);
      if (!action || !chat.contains(action)) return;
      event.preventDefault();
      event.stopPropagation();
      activate(action);
    });
    chatObserver = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') ensure(record.target);
        else {
          ensure(record.target.closest?.('.mes'));
          record.addedNodes.forEach(scanNode);
        }
      }
    });
    chatObserver.observe(chat, { childList: true, subtree: true, attributes: true, attributeFilter: ['mesid', 'is_user'] });
    return true;
  };
  if (!attach()) {
    waitingObserver = new MutationObserver(() => { if (attach()) { waitingObserver.disconnect(); waitingObserver = null; } });
    waitingObserver.observe(root.body, { childList: true, subtree: true });
  }
  ui.onPluginAvailabilityChange = () => {
    if (!chat) return;
    if (c.settings().historyDetection === false) chat.querySelectorAll(`.${BUTTON_CLASS}`).forEach(action => action.remove());
    else chat.querySelectorAll('.mes').forEach(ensure);
  };
  return { ensure, disconnect() { chatObserver?.disconnect(); waitingObserver?.disconnect(); } };
}
