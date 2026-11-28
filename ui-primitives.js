// Shared UI markup helpers, icons, submodal shell, and compact change log rendering.
import { escapeHTML as esc } from './engine.js';

export const button = (text, attrs = '') => `<button type="button" ${attrs}>${text}</button>`;

export const glyph = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${
  name === 'xmark' ? '<path d="m6 6 12 12M6 18 18 6"/>'
    : name === 'chevron-down' ? '<path d="m6 9 6 6 6-6"/>'
      : name === 'more' ? '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>'
        : '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>'
}</svg>`;

export const icon = (name, label, attrs) => button(glyph(name), `aria-label="${label}" class="tr-icon" ${attrs}`);

export const dismissActions = new Set(['close', 'cancel-rule', 'cancel-import', 'cancel-scope', 'cancel-group', 'cancel-source']);

export function createSubmodal(parent, { id, title, closeLabel, closeAction, onClose, onCancel, onEvent }) {
  const modal = document.createElement('dialog');
  modal.id = id;
  modal.className = 'tr-submodal';
  modal.innerHTML = `<div class="tr-modal-shell"><header class="tr-modal-head"><h3>${title}</h3>${icon('xmark', closeLabel, `data-action="${closeAction}"`)}</header><div class="tr-modal-body"></div></div>`;
  parent.append(modal);
  modal.addEventListener('close', () => {
    modal.querySelector('.tr-modal-body').innerHTML = '';
    onClose?.();
  });
  if (onCancel) modal.addEventListener('cancel', onCancel);
  // Keep subdialog controls scoped to their own event handler.
  modal.addEventListener('click', e => { e.stopPropagation(); onEvent.click(e); });
  modal.addEventListener('input', e => { e.stopPropagation(); onEvent.input(e); });
  modal.addEventListener('change', e => { e.stopPropagation(); onEvent.change(e); });
  modal.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); onEvent.submit(e); });
  return modal;
}

export function renderChangeLog(log = []) {
  const deleted = [], replaced = [];
  for (const entry of log) {
    // Log storage and undo retain full originals; only the display is shortened.
    const before = Array.from(entry.before ?? ''), after = Array.from(entry.after ?? '');
    let start = 0, endBefore = before.length, endAfter = after.length;
    while (start < endBefore && start < endAfter && before[start] === after[start]) start++;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
    const oldText = before.slice(start, endBefore).join(''), newText = after.slice(start, endAfter).join('');
    if (!oldText && !newText) continue;
    if (!newText) deleted.push(`<div><p class="tr-sentence"><del>${esc(oldText)}</del></p></div>`);
    else replaced.push(`<div><p class="tr-sentence">${oldText ? `<del>${esc(oldText)}</del> → ` : ''}<ins>${esc(newText)}</ins></p></div>`);
  }
  if (!deleted.length && !replaced.length) return '';
  return `<details class="tr-change-log tr-change-log-root"><summary>修改日志 · ${deleted.length + replaced.length} 处</summary><div class="tr-change-log-groups">${[['删除', deleted], ['替换', replaced]].map(([label, rows]) => `<details class="tr-change-log"><summary>${label} · ${rows.length} 处</summary>${rows.join('') || '<p class="tr-meta">暂无记录</p>'}</details>`).join('')}</div></details>`;
}
