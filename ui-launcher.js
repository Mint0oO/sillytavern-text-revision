// Draggable floating launcher button, viewport clamping, theming, and badge counter.
import { glyph } from './ui-primitives.js';

const POSITION_KEY = 'text-revision-launcher-position';

export function createLauncher({ onOpen }) {
  const launcher = document.createElement('button');
  launcher.id = 'tr-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', '打开词句修订');
  launcher.innerHTML = `${glyph('pencil')}<small hidden></small>`;
  launcher.title = '词句修订 · 拖动可移动';

  let position = null;
  let suppressClick = false;
  try { position = JSON.parse(localStorage.getItem(POSITION_KEY)); } catch { /* Optional device-local preference. */ }

  const place = (x, y) => {
    const v = window.visualViewport, size = 36, pad = 8;
    const left = v?.offsetLeft ?? 0, top = v?.offsetTop ?? 0;
    x = Math.max(left + pad, Math.min(x, left + (v?.width ?? innerWidth) - size - pad));
    y = Math.max(top + pad, Math.min(y, top + (v?.height ?? innerHeight) - size - pad));
    Object.assign(launcher.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
    return { x, y };
  };
  const restore = () => {
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) place(position.x, position.y);
    else place((window.visualViewport?.width ?? innerWidth) - 46, 88);
  };

  launcher.addEventListener('click', e => {
    // Touch activation is handled on release, including browsers that omit click after capture.
    if (e.pointerType === 'touch') return;
    if (suppressClick && e.detail !== 0) { suppressClick = false; return; }
    onOpen();
  });

  let drag = null;
  launcher.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: rect.left, y: rect.top, moved: false };
    suppressClick = false;
    launcher.setPointerCapture(e.pointerId);
  });
  launcher.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    drag.moved ||= Math.hypot(dx, dy) > 6;
    if (!drag.moved) return;
    launcher.classList.add('tr-dragging');
    position = place(drag.x + dx, drag.y + dy);
  });
  const finish = e => {
    if (!drag || drag.id !== e.pointerId) return;
    const touchTap = e.type === 'pointerup' && e.pointerType === 'touch' && !drag.moved;
    suppressClick = drag.moved;
    if (drag.moved) {
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(position)); } catch { /* Dragging works without storage. */ }
    }
    drag = null;
    launcher.classList.remove('tr-dragging');
    if (touchTap) onOpen();
  };
  launcher.addEventListener('pointerup', finish);
  launcher.addEventListener('pointercancel', finish);
  launcher.addEventListener('lostpointercapture', finish);

  document.body.append(launcher);
  restore();
  window.addEventListener('resize', restore);
  window.visualViewport?.addEventListener('resize', restore);
  window.visualViewport?.addEventListener('scroll', restore);
  return launcher;
}

export function syncLauncherTheme(launcher, dialog, settings) {
  for (const el of [launcher, dialog?.querySelector('[data-launcher-preview]')].filter(Boolean)) {
    el.dataset.launcherColor = settings.launcherColor;
    el.style.opacity = String(1 - settings.launcherTransparency / 100);
  }
}

export function syncLauncherBadge(launcher, settings, count) {
  launcher.hidden = settings.enabled === false || !settings.showLauncher;
  const badge = launcher.querySelector('small');
  badge.hidden = !count;
  badge.textContent = String(count);
  launcher.setAttribute('aria-label', `打开词句修订${count ? `，${count} 处待处理` : ''}`);
}
