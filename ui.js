import { escapeHTML as esc, inlineHTML, proposal, ready, processed, validateRule, normalizeScope, needsLanguage } from './engine.js';
import { clone } from './controller.js';
import { ensureLanguage } from './language.js';
import { createRuleDraft, simpleRule } from './rule-editor.js';
import { renderRulesView, ruleCountText } from './rules-view.js';
import { scanPrepared } from './scanner.js';
import { renderRuleForm } from './rule-form.js';
import { renderSettingsView, executionDescription } from './settings-view.js';
import { stringifyRuleSet, parseRuleSet, applyRuleSet, MAX_RULE_SET_BYTES } from './rule-transfer.js';

const button = (text, attrs = '') => `<button type="button" ${attrs}>${text}</button>`;
const glyph = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${name === 'xmark' ? '<path d="m6 6 12 12M6 18 18 6"/>' : name === 'chevron-down' ? '<path d="m6 9 6 6 6-6"/>' : '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>'}</svg>`;
const icon = (name, label, attrs) => button(glyph(name), `aria-label="${label}" class="tr-icon" ${attrs}`);
const dismissActions = new Set(['close', 'cancel-rule', 'cancel-import', 'cancel-scope']);

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
    if (!newText) deleted.push(`<p class="tr-sentence"><del>${esc(oldText)}</del></p>`);
    else replaced.push(`<p class="tr-sentence">${oldText ? `<del>${esc(oldText)}</del> → ` : ''}<ins>${esc(newText)}</ins></p>`);
  }
  if (!deleted.length && !replaced.length) return '';
  return `<details class="tr-change-log tr-change-log-root"><summary>修改日志 · ${deleted.length + replaced.length} 处</summary><div class="tr-change-log-groups">${[['删除', deleted], ['替换', replaced]].map(([label, rows]) => `<details class="tr-change-log"><summary>${label} · ${rows.length} 处</summary>${rows.join('') || '<p class="tr-meta">暂无记录</p>'}</details>`).join('')}</div></details>`;
}

export class RevisionUI {
  constructor(controller) {
    this.c = controller;
    this.screen = 'review';
    this.edit = null;
    this.drafts = new Map();
    this.ruleId = null;
    this.ruleFilters = { search: '' };
    this.ruleDeleteMode = false;
    this.ruleDeleteIds = new Set();
    this.ruleDrafts = new Map();
    this.ruleOriginal = null;
    this.historical = null;
    this.expandedRoundId = null;
    this.scopeDraft = null;
    this.scopeMode = null;
    this.ruleImport = null;
    this.returnFocus = null;
    this.panelTarget = null;
    this.panelRoundId = null;
    this.panelEpoch = 0;
    this.detecting = false;
    this.onMainClosed = () => {};
    this.onPluginAvailabilityChange = () => {};
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'tr-root';
    this.dialog.setAttribute('aria-label', '词句修订');
    this.dialog.innerHTML = '<div class="tr-shell"><header class="tr-head"></header><main class="tr-main"></main><div class="tr-status" role="status" aria-live="polite"></div><footer class="tr-foot"></footer></div>';
    document.body.append(this.dialog);
    // Rule editing lives in its own nested modal instead of stretching the list.
    this.ruleModal = document.createElement('dialog');
    this.ruleModal.id = 'tr-rule-modal';
    this.ruleModal.className = 'tr-submodal';
    this.ruleModal.innerHTML = `<div class="tr-modal-shell"><header class="tr-modal-head"><h3>规则</h3>${icon('xmark', '关闭规则编辑', 'data-action="cancel-rule"')}</header><div class="tr-modal-body"></div></div>`;
    this.dialog.append(this.ruleModal);
    this.ruleModal.addEventListener('close', () => {
      this.ruleModal.querySelector('.tr-modal-body').innerHTML = '';
      if (this.ruleId !== null) { this.ruleDrafts.delete(this.ruleId); this.ruleId = null; }
      this.ruleOriginal = null;
    });
    this.ruleModal.addEventListener('cancel', e => { e.preventDefault(); this.run(() => this.closeRuleModal()); });
    this.importModal = document.createElement('dialog');
    this.importModal.id = 'tr-import-modal';
    this.importModal.className = 'tr-submodal';
    this.importModal.innerHTML = `<div class="tr-modal-shell"><header class="tr-modal-head"><h3>导入规则集</h3>${icon('xmark', '关闭导入规则集', 'data-action="cancel-import"')}</header><div class="tr-modal-body"></div></div>`;
    this.dialog.append(this.importModal);
    this.importModal.addEventListener('close', () => {
      this.importModal.querySelector('.tr-modal-body').innerHTML = '';
      this.ruleImport = null;
    });
    this.scopeModal = document.createElement('dialog');
    this.scopeModal.id = 'tr-scope-modal';
    this.scopeModal.className = 'tr-submodal';
    this.scopeModal.innerHTML = `<div class="tr-modal-shell"><header class="tr-modal-head"><h3>检测范围</h3>${icon('xmark', '关闭检测范围设置', 'data-action="cancel-scope"')}</header><div class="tr-modal-body"></div></div>`;
    this.dialog.append(this.scopeModal);
    this.scopeModal.addEventListener('close', () => {
      this.scopeModal.querySelector('.tr-modal-body').innerHTML = '';
      this.scopeDraft = null;
      this.scopeMode = null;
    });
    this.scopeModal.addEventListener('cancel', e => { e.preventDefault(); this.scopeModal.close(); });
    // Keep subdialog controls scoped to their own event handler.
    for (const modal of [this.ruleModal, this.importModal, this.scopeModal]) {
      modal.addEventListener('click', e => { e.stopPropagation(); this.run(() => this.click(e)); });
      modal.addEventListener('input', e => { e.stopPropagation(); this.input(e); });
      modal.addEventListener('change', e => { e.stopPropagation(); this.run(() => this.change(e)); });
      modal.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); this.run(() => this.submit(e)); });
    }
    this.launcher = document.createElement('button');
    this.launcher.id = 'tr-launcher';
    this.launcher.type = 'button';
    this.launcher.setAttribute('aria-label', '打开词句修订');
    this.launcher.innerHTML = `${glyph('pencil')}<small hidden></small>`;
    this.launcher.title = '词句修订 · 拖动可移动';
    this.launcher.addEventListener('click', e => {
      // Touch activation is handled on release, including browsers that omit click after capture.
      if (e.pointerType === 'touch') return;
      if (this.suppressLauncherClick && e.detail !== 0) { this.suppressLauncherClick = false; return; }
      this.run(() => this.open());
    });
    document.body.append(this.launcher);
    this.attachLauncherDrag();
    this.dialog.addEventListener('pointerdown', e => this.pointerDown(e));
    this.dialog.addEventListener('click', e => this.run(() => this.click(e)));
    this.dialog.addEventListener('input', e => this.input(e));
    this.dialog.addEventListener('change', e => this.run(() => this.change(e)));
    this.dialog.addEventListener('submit', e => { e.preventDefault(); this.run(() => this.submit(e)); });
    this.dialog.addEventListener('close', () => {
      this.scopeDraft = null;
      this.endPanelSession();
      document.documentElement.style.overflow = this.scrollLock?.html ?? '';
      document.body.style.overflow = this.scrollLock?.body ?? '';
      this.returnFocus?.focus?.();
      this.onMainClosed();
    });
    this.c.onChange = () => { if (this.edit && this.edit.roundId !== this.panelRound()?.id) this.edit = null; this.badge(); if (this.dialog.open && !['extract', 'exclude'].includes(this.screen) && !(this.screen === 'rules' && this.ruleId !== null)) this.render(); };
    this.viewport = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      const top = window.visualViewport?.offsetTop ?? 0;
      this.dialog.style.setProperty('--tr-height', `${height}px`);
      this.dialog.style.setProperty('--tr-top', `${top}px`);
      this.dialog.style.setProperty('--tr-modal-top', `${top + height / 2}px`);
      this.dialog.style.setProperty('--tr-modal-height', `${Math.max(1, height - 32)}px`);
    };
    window.visualViewport?.addEventListener('resize', this.viewport);
    window.visualViewport?.addEventListener('scroll', this.viewport);
    this.viewport();
    this.theme();
    this.badge();
  }
  attachLauncherDrag() {
    try { this.launcherPosition = JSON.parse(localStorage.getItem('text-revision-launcher-position')); } catch { /* Optional device-local preference. */ }
    const place = (x, y) => {
      const v = window.visualViewport, size = 36, pad = 8;
      const left = v?.offsetLeft ?? 0, top = v?.offsetTop ?? 0;
      x = Math.max(left + pad, Math.min(x, left + (v?.width ?? innerWidth) - size - pad));
      y = Math.max(top + pad, Math.min(y, top + (v?.height ?? innerHeight) - size - pad));
      Object.assign(this.launcher.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
      return { x, y };
    };
    const restore = () => {
      const p = this.launcherPosition;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) place(p.x, p.y);
      else place((window.visualViewport?.width ?? innerWidth) - 46, 88);
    };
    restore();
    window.addEventListener('resize', restore);
    window.visualViewport?.addEventListener('resize', restore);
    window.visualViewport?.addEventListener('scroll', restore);
    let drag = null;
    this.launcher.addEventListener('pointerdown', e => {
      if (!e.isPrimary || e.button !== 0) return;
      const rect = this.launcher.getBoundingClientRect();
      drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: rect.left, y: rect.top, moved: false };
      this.suppressLauncherClick = false;
      this.launcher.setPointerCapture(e.pointerId);
    });
    this.launcher.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      drag.moved ||= Math.hypot(dx, dy) > 6;
      if (!drag.moved) return;
      this.launcher.classList.add('tr-dragging');
      this.launcherPosition = place(drag.x + dx, drag.y + dy);
    });
    const finish = e => {
      if (!drag || drag.id !== e.pointerId) return;
      const touchTap = e.type === 'pointerup' && e.pointerType === 'touch' && !drag.moved;
      this.suppressLauncherClick = drag.moved;
      if (drag.moved) {
        try { localStorage.setItem('text-revision-launcher-position', JSON.stringify(this.launcherPosition)); } catch { /* Dragging works without storage. */ }
      }
      drag = null;
      this.launcher.classList.remove('tr-dragging');
      if (touchTap) this.run(() => this.open());
    };
    this.launcher.addEventListener('pointerup', finish);
    this.launcher.addEventListener('pointercancel', finish);
    this.launcher.addEventListener('lostpointercapture', finish);
  }
  async run(action) { try { await action(); } catch (error) { this.say(error.message, true); } }
  say(text, error = false) {
    const el = this.dialog.querySelector('.tr-status');
    el.textContent = text;
    el.classList.toggle('tr-error', error);
    if (error && !this.dialog.open) globalThis.toastr?.warning(text, '词句修订');
  }
  badge() {
    this.launcher.hidden = this.c.settings().enabled === false || !this.c.settings().showLauncher;
    const round = this.c.current();
    const count = round && !round.reviewed && this.c.editable(round) ? round.count - processed(round) : 0;
    const badge = this.launcher.querySelector('small');
    badge.hidden = !count;
    badge.textContent = String(count);
    this.launcher.setAttribute('aria-label', `打开词句修订${count ? `，${count} 处待处理` : ''}`);
  }
  isMainOpen() { return Boolean(this.dialog.open); }
  panelRound() { return this.c.history().find(round => round.id === this.panelRoundId) ?? null; }
  targetFloor() {
    try { return this.panelTarget ? this.c.resolveTarget(this.panelTarget) : null; }
    catch { return null; }
  }
  targetForRound(round) {
    const messageId = this.c.locateRound(round);
    if (messageId < 0) throw new Error('检测结果对应的楼层已不存在。');
    return this.c.captureTarget(messageId);
  }
  endPanelSession() {
    this.panelEpoch++;
    this.c.detectionSequence++;
    this.panelTarget = null;
    this.panelRoundId = null;
    this.detecting = false;
    this.edit = null;
    this.drafts.clear();
    this.reviewSelection = null;
  }
  async detectPanelTarget() {
    this.c.assertIdle();
    const epoch = this.panelEpoch, target = this.panelTarget;
    const messageId = this.c.resolveTarget(target);
    this.detecting = true;
    this.panelRoundId = null;
    this.edit = null;
    this.render();
    try {
      const round = await this.c.detect(messageId, { onReady: ready => {
        if (epoch !== this.panelEpoch || !this.dialog.open || !this.c.sameTarget(target, this.panelTarget)) return;
        this.panelTarget = this.targetForRound(ready);
        this.panelRoundId = ready.id;
        this.detecting = false;
        this.say('检测完成，正在保存记录……');
      } });
      if (epoch !== this.panelEpoch || !this.dialog.open || !this.c.sameTarget(target, this.panelTarget)) return null;
      this.say('');
      return round;
    } catch (error) {
      if (epoch !== this.panelEpoch || !this.dialog.open) return null;
      throw error;
    } finally {
      if (epoch === this.panelEpoch) { this.detecting = false; if (this.dialog.open) this.render(); }
    }
  }
  async open(messageId, { force = messageId !== undefined, round = null } = {}) {
    const opening = !this.dialog.open;
    if (opening) {
      this.panelEpoch++;
      this.panelTarget = null;
      this.panelRoundId = null;
      this.returnFocus = document.activeElement;
      this.scrollLock = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
      document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
      this.dialog.showModal();
    }
    this.viewport();
    this.screen = this.c.settings().enabled === false ? 'settings' : 'review';
    this.edit = null;
    this.say('');
    if (this.c.settings().enabled !== false) {
      if (round) {
        this.panelTarget = this.targetForRound(round);
        this.panelRoundId = round.id;
        this.c.selectedId = round.id;
      } else if (messageId !== undefined) {
        this.panelTarget = this.c.captureTarget(messageId);
        this.panelRoundId = null;
      } else if (opening || !this.panelTarget) {
        const latest = this.c.latestReply();
        if (latest >= 0) {
          this.panelTarget = this.c.captureTarget(latest);
          const reusable = this.c.freshRound(this.panelTarget);
          if (reusable) { this.panelRoundId = reusable.id; this.c.selectedId = reusable.id; }
        }
      }
    }
    this.render();
    if (this.c.settings().enabled !== false && this.panelTarget && (force || !this.panelRound())) await this.detectPanelTarget();
    this.render();
  }
  async openDetected(round) {
    if (this.c.settings().enabled === false) return false;
    const target = this.targetForRound(round);
    // A result finishing in the background must not replace another active floor or settings draft.
    if (this.dialog.open && (this.screen !== 'review' || !this.c.sameTarget(target, this.panelTarget))) return false;
    await this.open(undefined, { force: false, round });
    return true;
  }
  resetChat() { this.endPanelSession(); this.historical = null; this.expandedRoundId = null; this.c.selectedId = null; this.screen = 'review'; this.c.onChange(); }
  theme() {
    const s = this.c.settings();
    this.dialog.dataset.theme = s.theme;
    this.dialog.dataset.palette = s.palette;
    const transparency = Math.max(0, Math.min(100, Number(s.transparency) || 0));
    this.dialog.style.setProperty('--tr-alpha', String(1 - transparency / 100));
    this.launcher.dataset.theme = s.theme;
    const appearance = s.appearance;
    if (appearance) { this.dialog.dataset.appearance = appearance; this.launcher.dataset.appearance = appearance; }
    else { delete this.dialog.dataset.appearance; delete this.launcher.dataset.appearance; }
    this.launcherTheme();
  }
  render() {
    const scroll = this.dialog.querySelector('.tr-main').scrollTop;
    this.theme();
    const title = { review: '词句修订', rules: '规则', settings: '设置', extract: '标签提取', exclude: '内容排除', history: '检测记录', snapshot: '检测详情' }[this.screen];
    const parent = this.screen === 'snapshot' ? ['history', '记录'] : ['extract', 'exclude'].includes(this.screen) ? ['settings', '设置'] : ['review', '修订'];
    const nav = this.screen === 'review' ? button('规则', 'data-screen="rules"') + button('记录', 'data-screen="history"') + button('设置', 'data-screen="settings"') : button(`‹ ${parent[1]}`, `data-screen="${parent[0]}"`);
    const count = this.screen === 'rules' ? `<span class="tr-head-count">${ruleCountText(this.c.settings().rules)}</span>` : '';
    this.dialog.querySelector('.tr-head').innerHTML = `<div class="tr-head-title"><h2>${title}</h2>${count}</div><nav>${nav}${icon('xmark', '关闭修订面板', 'data-action="close"')}</nav>`;
    this.dialog.querySelector('.tr-foot').innerHTML = '';
    const draw = { review: 'review', snapshot: 'review', rules: 'rulesView', settings: 'settingsView', extract: 'scopeView', exclude: 'scopeView', history: 'historyView' }[this.screen];
    this[draw]();
    if (this.c.busy) this.dialog.querySelectorAll('button, input, select, textarea').forEach(el => { if (!dismissActions.has(el.dataset.action)) el.disabled = true; });
    this.dialog.querySelector('.tr-main').scrollTop = scroll;
    this.badge();
  }
  body(html) { this.dialog.querySelector('.tr-main').innerHTML = html; }
  legend() { return '<div class="tr-legend"><del>删除</del><ins>新增</ins><mark>待改</mark></div>'; }
  review() {
    this.reviewSelection = null;
    if (this.c.settings().enabled === false) { this.body('<div class="tr-empty">插件已停用。可以在“设置”中重新启用。</div>'); return; }
    const history = this.screen === 'snapshot';
    if (!history && this.detecting) { const floor = this.targetFloor(); this.body(`<div class="tr-empty">正在检测${floor === null ? '所选楼层' : ` ${floor}#`}……</div>`); return; }
    const r = history ? this.c.history().find(r => r.id === this.historical) : this.panelRound();
    if (!r) { this.body(`<div class="tr-empty">${this.panelTarget ? '尚未获得所选楼层的检测结果。' : '打开一条 AI 回复后开始检测。'}${button(this.panelTarget ? '重新检测' : '检测最新回复', `data-action="${this.panelTarget ? 'scan' : 'scan-latest'}"`)}</div>`); return; }
    const editable = !history && this.c.editable(r);
    const floor = this.c.locateRound(r);
    this.body(`<div class="tr-review-bar"><span title="字段按可独立修订的句段计数">${r.count}处问题/${r.groups.length}字段${floor >= 0 ? `　${floor}#` : ''}</span>${this.legend()}${history ? '' : button('重新检测', 'data-action="scan"')}</div>${r.reviewed ? '<p class="tr-meta">本轮已完成审阅，保留项不再提醒。</p>' : ''}${!editable && !history ? `<p class="tr-meta">${floor < 0 ? '所选楼层已不存在或身份无法确认，请重新选择该楼层。' : '正文或检测范围已变化，请重新检测。'}</p>` : ''}<div class="tr-rows">${r.groups.map(g => this.row(g, editable)).join('') || `<p class="tr-empty">${esc(r.notice || '未发现匹配的问题。')}</p>`}</div>`);
    if (r.log?.length) this.dialog.querySelector('.tr-main').insertAdjacentHTML('beforeend', renderChangeLog(r.log));
    if (!history) this.reviewFooter(r, editable);
  }
  selectionState(r) {
    if (this.reviewSelection?.round !== r) {
      this.reviewSelection = { round: r, rows: new Map(r.groups.filter(ready).map(g => [g.id, Boolean(g.selected)])) };
    }
    return this.reviewSelection.rows;
  }
  reviewFooter(r, editable) {
    const rows = this.selectionState(r), n = [...rows.values()].filter(Boolean).length;
    this.dialog.querySelector('.tr-foot').innerHTML = `<label class="tr-check"><input type="checkbox" data-all ${rows.size && rows.size === n ? 'checked' : ''} ${!editable || !rows.size ? 'disabled' : ''}>全选</label><div>${editable && !r.reviewed && !this.edit ? button('完成审阅', 'data-action="finish-review"') : ''}${r.undo && editable ? button('撤销', 'data-action="undo"') : ''}${button(`应用所选 ${n}`, `class="tr-primary" data-action="apply" ${!editable || !n || this.edit || this.c.busy ? 'disabled' : ''}`)}</div>`;
  }
  row(g, editable) {
    const editing = this.edit?.groupId === g.id && this.edit.roundId === this.panelRound()?.id && editable;
    const selected = g.selected && ready(g);
    const preview = editing ? inlineHTML({ ...g, kept: false, manual: true, draft: this.edit.text }) : inlineHTML(g);
    const state = !editing && (g.kept || g.matches.every(m => m.done) && !ready(g)) ? `<span class="tr-row-state">${g.kept ? '已保留' : '已应用'}</span>` : '';
    const content = editable && ready(g) && !editing
      ? button(`<span class="tr-sentence">${preview}</span>`, `class="tr-row-toggle" data-toggle="${g.id}" aria-pressed="${selected}" aria-label="${selected ? '取消选择' : '选择'}第${g.id + 1}字段：${esc(proposal(g))}"`)
      : `<div class="tr-row-text ${editing ? 'tr-edit-preview' : ''}" ${editing ? `data-edit-preview="${g.id}"` : ''}><p class="tr-sentence">${preview}</p></div>`;
    let editor = '';
    if (editing) {
      const d = this.edit;
      editor = `<div class="tr-inline-editor"><label class="tr-edit-field"><span class="tr-label">修改后</span><textarea id="tr-edit" aria-label="编辑整句" rows="3">${esc(d.text)}</textarea></label><details class="tr-candidates" ${d.expanded ? 'open' : ''}><summary>替换候选</summary>${d.matches.filter(m => m.options.length || m.remove).map(m => `<div class="tr-candidate"><label for="tr-option-${m.id}">${esc(m.old)}</label><div class="tr-replace">${m.options.length ? `<select id="tr-option-${m.id}" data-option="${m.id}"><option value="" disabled ${m.value === null || m.value === '' ? 'selected' : ''}>替换为…</option>${m.options.map((v, i) => `<option value="${i}" ${m.value === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>${m.options.length > 1 ? button('换一个', `data-random="${m.id}"`) : ''}` : '<span class="tr-meta">未设置替换词</span>'}</div>${button('删除', `class="tr-delete" data-delete-match="${m.id}" aria-pressed="${m.value === ''}"`)}</div>`).join('') || '<p class="tr-meta">请直接编辑整句。</p>'}</details><div class="tr-edit-actions"><div>${button('不改这句', `data-keep="${g.id}"`)}${button('删除整句', 'class="tr-delete-sentence" data-action="delete-sentence"')}</div><div>${button('取消', 'data-action="cancel-edit"')}${button('完成', 'class="tr-primary" data-action="finish-edit"')}</div></div></div>`;
    }
    return `<section data-group="${g.id}" class="tr-row ${selected ? 'tr-selected' : ''} ${editable ? 'tr-row-editable' : ''} ${editing ? 'tr-row-editing' : ''} ${state ? 'tr-row-has-state' : ''}">${content}${state}${editable ? icon('pencil', `编辑第${g.id + 1}句`, `data-edit="${g.id}"`) : ''}${editor}</section>`;
  }
  refreshReviewRows(r, ids) {
    const editable = this.c.editable(r), rows = this.selectionState(r);
    for (const id of new Set(ids)) {
      const g = r.groups[id];
      if (!g) continue;
      if (ready(g)) rows.set(g.id, Boolean(g.selected)); else rows.delete(g.id);
      const row = this.dialog.querySelector(`.tr-rows > [data-group="${CSS.escape(String(id))}"]`);
      if (row) row.outerHTML = this.row(g, editable);
    }
    this.reviewFooter(r, editable);
  }
  updateReviewSelection(r, changed = r.groups) {
    const rows = this.selectionState(r);
    for (const g of changed) {
      const eligible = ready(g), selected = Boolean(g.selected && eligible);
      if (eligible) rows.set(g.id, selected); else rows.delete(g.id);
      const control = this.dialog.querySelector(`[data-toggle="${CSS.escape(String(g.id))}"]`);
      if (!control) continue;
      control.setAttribute('aria-pressed', String(selected));
      control.setAttribute('aria-label', `${selected ? '取消选择' : '选择'}第${g.id + 1}字段：${proposal(g)}`);
      control.closest('.tr-row')?.classList.toggle('tr-selected', selected);
    }
    const selected = [...rows.values()].filter(Boolean).length;
    const all = this.dialog.querySelector('[data-all]');
    if (all) all.checked = Boolean(rows.size && rows.size === selected);
    const apply = this.dialog.querySelector('[data-action="apply"]');
    if (apply) {
      apply.textContent = `应用所选 ${selected}`;
      apply.disabled = !selected || Boolean(this.edit) || this.c.busy;
    }
  }
  rulesView() {
    this.body(renderRulesView(this.c.settings().rules, this.ruleFilters, this.c.settings().ruleExecution, { active: this.ruleDeleteMode, selectedIds: this.ruleDeleteIds }, this.c.settings()));
    if (this.ruleDeleteMode) {
      const count = this.ruleDeleteIds.size;
      this.dialog.querySelector('.tr-foot').innerHTML = `<span class="tr-meta">${count ? `已选择 ${count} 条规则` : '请选择一条或多条规则'}</span><div>${button('取消', 'data-action="cancel-rule-delete"')}${button(`确定删除${count ? ` ${count}` : ''}`, `data-action="confirm-rule-delete" ${count ? '' : 'disabled'}`)}</div>`;
    }
  }
  exportRules() {
    const text = stringifyRuleSet(this.c.settings());
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `henge-rules-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    this.say(`已导出 ${this.c.settings().rules.length} 条规则。文件不包含聊天、记录或其他设置。`);
  }
  async openRuleImport(file) {
    if (file.size > MAX_RULE_SET_BYTES) throw new Error('JSON 文件超过 25 MB，无法导入。');
    const imported = parseRuleSet(await file.text());
    this.ruleImport = imported;
    const mode = imported.ruleExecution === 'auto' ? '自动应用' : '人工审查';
    const examples = imported.rules.slice(0, 5).map(rule => `<li>${esc(rule.find)}</li>`).join('');
    this.importModal.querySelector('.tr-modal-body').innerHTML = `<p><strong>${esc(file.name)}</strong></p><p>共 ${imported.rules.length} 条规则 · 处理方式：${mode}</p>${examples ? `<ul class="tr-import-list">${examples}</ul>${imported.rules.length > 5 ? `<p class="tr-meta">另有 ${imported.rules.length - 5} 条规则未在这里展开。</p>` : ''}` : '<p class="tr-meta">这是一个空规则集。</p>'}<p class="tr-meta">追加：保留现有规则和当前处理方式，跳过重复规则。<br>替换全部：清除现有规则，并采用文件中的处理方式。</p><div class="tr-form-actions"><button type="button" data-action="cancel-import">取消</button><button type="button" data-action="import-append" ${imported.rules.length ? '' : 'disabled'}>追加</button><button type="button" class="tr-primary" data-action="import-replace">替换全部</button></div>`;
    if (!this.importModal.open) this.importModal.showModal();
  }
  importRules(mode) {
    if (!this.ruleImport) throw new Error('请重新选择要导入的 JSON 文件。');
    const settings = this.c.settings();
    const result = applyRuleSet(settings.rules, this.ruleImport, mode);
    settings.rules = result.rules;
    if (result.ruleExecution) settings.ruleExecution = result.ruleExecution;
    this.c.saveSettings();
    this.ruleId = null;
    this.ruleDrafts.clear();
    this.importModal.close();
    this.render();
    const skipped = result.skipped ? `，跳过 ${result.skipped} 条重复规则` : '';
    this.say(`${mode === 'append' ? '已追加' : '已替换'} ${result.added} 条规则${skipped}。重新检测后生效。`);
  }
  ruleForm() {
    if (!this.ruleDrafts.has(this.ruleId)) this.ruleDrafts.set(this.ruleId, createRuleDraft(this.c.settings().rules.find(r => r.id === this.ruleId)));
    return renderRuleForm(this.ruleDrafts.get(this.ruleId), { canDelete: this.ruleId !== 'new' });
  }
  openRuleModal(ruleId = 'new') {
    this.ruleId = ruleId;
    if (!this.ruleDrafts.has(ruleId)) this.ruleDrafts.set(ruleId, createRuleDraft(this.c.settings().rules.find(r => r.id === ruleId)));
    const draft = this.ruleDrafts.get(ruleId);
    this.ruleOriginal = JSON.stringify(draft);
    this.ruleModal.querySelector('h3').textContent = ruleId === 'new' ? '新建规则' : draft.legacy ? '查看兼容规则' : '编辑规则';
    this.ruleModal.querySelector('.tr-modal-body').innerHTML = renderRuleForm(draft, { canDelete: ruleId !== 'new' });
    if (!this.ruleModal.open) this.ruleModal.showModal();
    // Do not summon the phone keyboard just by opening an existing rule.
    const focus = matchMedia('(pointer:coarse)').matches ? '[data-action="cancel-rule"]' : '#tr-find';
    this.ruleModal.querySelector(focus)?.focus({ preventScroll: true });
  }
  closeRuleModal(force = false) {
    const draft = this.ruleDrafts.get(this.ruleId);
    const changed = draft && this.ruleOriginal !== null && JSON.stringify(draft) !== this.ruleOriginal;
    if (!force && changed && !globalThis.confirm('这条规则还有未保存的修改，确定放弃吗？')) return;
    this.ruleModal.close();
  }
  draftRule() {
    return simpleRule(this.ruleDrafts.get(this.ruleId), this.c.settings().rules.find(r => r.id === this.ruleId));
  }
  async previewRule() {
    const draft = this.ruleDrafts.get(this.ruleId), sample = draft.sample ?? '';
    if (!sample.trim()) throw new Error('请先填写测试文字。');
    if (sample.length > 8000) throw new Error('测试文字最多 8000 字。');
    const target = this.dialog.querySelector('#tr-rule-preview');
    const inputSnapshot = JSON.stringify(draft);
    target.textContent = '正在检测…';
    try {
      const rule = this.draftRule();
      if (needsLanguage([rule])) await ensureLanguage();
      const round = await scanPrepared(sample, [rule], { context: this.c.context() });
      if (!target.isConnected || JSON.stringify(draft) !== inputSnapshot) return;
      target.innerHTML = round.groups.map(g => `<p class="tr-sentence">${inlineHTML(g)}</p><p class="tr-meta">${g.matches.map(m => Object.entries(m.captures).map(([key, value]) => `${esc(key)} = ${esc(value)}`).join('；')).filter(Boolean).join('<br>')}</p>`).join('') || '<p class="tr-meta">没有命中这条规则。</p>';
    } catch (error) { target.textContent = error.message; }
  }
  slider(id, label, value, max = 100) {
    const normalized = Math.max(0, Math.min(max, Number(value) || 0));
    return `<div class="tr-setting tr-setting-range"><label for="${id}">${label}</label><div class="tr-setting-control tr-mini-slider"><output id="${id}-value" for="${id}">${normalized}%</output><input type="range" id="${id}" min="0" max="${max}" step="5" value="${normalized}" style="--tr-range-fill:${normalized / max * 100}%"></div></div>`;
  }
  settingsView() {
    this.body(renderSettingsView(this.c.settings(), {
      legend: () => this.legend(), slider: (...args) => this.slider(...args), glyph,
    }));
    this.launcherTheme();
  }
  launcherTheme() {
    const s = this.c.settings();
    for (const el of [this.launcher, this.dialog.querySelector('[data-launcher-preview]')].filter(Boolean)) {
      el.dataset.launcherColor = s.launcherColor;
      el.style.opacity = String(1 - s.launcherTransparency / 100);
    }
  }
  scopeView() {
    const d = this.scopeDraft;
    const extraction = this.scopeMode === 'extract';
    const toggle = `<label class="tr-check tr-scope-toggle">${extraction ? '标签提取' : '内容排除'}<input role="switch" type="checkbox" data-scope-toggle="${extraction ? 'extractEnabled' : 'excludeEnabled'}" ${d[extraction ? 'extractEnabled' : 'excludeEnabled'] ? 'checked' : ''}></label>`;
    let content;
    if (extraction) {
      content = `${toggle}<label class="tr-field">输入标签（逗号分隔）<textarea id="tr-extract-tags" rows="2" placeholder="content, maintext">${esc(d.extractTags)}</textarea></label><p class="tr-meta">只检测标签内的文字；关闭或留空则检测排除内容之外的全文。</p>`;
    } else {
      content = `${toggle}<p class="tr-meta">跳过开始到结束之间的内容，包含两端文字。标签提取留空或关闭时，会检测排除后剩余的文字。</p><div class="tr-exclusion-list">${d.excludeRules.map((pair, i) => `<div class="tr-exclusion-row"><input data-boundary="start" data-pair="${i}" aria-label="排除 ${i + 1}：开始文字" placeholder="开始文字" maxlength="256" value="${esc(pair.start)}"><span>到</span><input data-boundary="end" data-pair="${i}" aria-label="排除 ${i + 1}：结束文字" placeholder="结束文字" maxlength="256" value="${esc(pair.end)}">${icon('xmark', `删除排除 ${i + 1}`, `data-remove-pair="${i}"`)}</div>`).join('')}</div>${button('＋ 添加规则', 'class="tr-add-pair" data-action="add-pair"')}`;
    }
    this.scopeModal.querySelector('h3').textContent = extraction ? '标签提取' : '内容排除';
    this.scopeModal.querySelector('.tr-modal-body').innerHTML = `${content}<div class="tr-form-actions"><button type="button" data-action="cancel-scope">取消</button><button type="button" class="tr-primary" data-action="save-scope">保存</button></div>`;
  }
  saveScope() {
    const d = this.scopeDraft;
    // Validate even disabled drafts, but retain names while their switch is off.
    const checked = normalizeScope({ ...d, extractEnabled: true, excludeEnabled: true });
    Object.assign(this.c.settings(), { extractTags: checked.extractTags, excludeRules: clone(d.excludeRules), extractEnabled: d.extractEnabled, excludeEnabled: d.excludeEnabled });
    this.c.saveSettings(); this.edit = null; this.drafts.clear();
    this.scopeModal.close(); this.render(); this.say('已保存，重新检测后生效。');
  }
  historyView() {
    const history = this.c.history();
    const records = history.slice().reverse().map(r => {
      const expanded = this.expandedRoundId === r.id;
      const floor = this.c.locateRound(r);
      const detail = expanded ? `<div class="tr-record-detail"><p class="tr-meta">${new Date(r.time).toLocaleString()}${r.reviewed ? ' · 已完成审阅' : ''}</p><div class="tr-rows">${r.groups.map(g => this.row(g, false)).join('') || `<p class="tr-empty">${esc(r.notice || '未发现匹配的问题。')}</p>`}</div>${r.log?.length ? renderChangeLog(r.log) : ''}</div>` : '';
      return `<section class="tr-record"><button type="button" class="tr-record-summary" data-round="${esc(r.id)}" aria-expanded="${expanded}" aria-label="${expanded ? '收起' : '展开'}第 ${r.number} 轮检测详情"><span class="tr-record-number">第 ${r.number} 轮</span><span class="tr-record-reply">回复 ${floor >= 0 ? `${floor}#` : '已失效'}</span><span class="tr-record-count">${r.count}处/${r.groups.length}字段</span><span class="tr-record-progress">${processed(r)}/${r.count} 已处理</span><span class="tr-record-chevron">${glyph('chevron-down')}</span></button>${detail}</section>`;
    }).join('');
    this.body(`<p class="tr-meta tr-history-meta">共检测 ${this.c.context().chatMetadata?.text_revision?.total ?? 0} 轮 · 保留最近 ${history.length} 轮</p>${records || '<p class="tr-empty">还没有检测记录。</p>'}`);
  }
  pointerDown(e) {
    const b = e.target.closest?.('button');
    // Blurring an input can hide the keyboard and move a centered dialog
    // between pointerdown and pointerup, so the release misses the close button.
    // Retain focus until the normal click closes it (including discard checks).
    if (e.button === 0 && (dismissActions.has(b?.dataset.action) || b?.dataset.action === 'clear-rule-search')) e.preventDefault();
  }
  async click(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.type === 'submit') return;
    const data = b.dataset;
    if (data.action === 'close') { this.dialog.close(); return; }
    if (data.action === 'cancel-rule' && this.ruleModal.open) { this.closeRuleModal(); return; }
    if (data.action === 'cancel-import') { this.importModal.close(); return; }
    if (data.action === 'cancel-scope') { this.scopeModal.close(); return; }
    if (this.c.busy) return;
    if (data.action === 'clear-rule-search') {
      this.ruleFilters.search = ''; this.render();
      this.dialog.querySelector('[data-rule-filter="search"]')?.focus({ preventScroll: true });
      return;
    }
    if (data.toggle !== undefined) {
      const r = this.panelRound();
      this.c.target(r);
      if (!this.c.editable(r)) throw new Error('正文或检测范围已变化，请重新检测。');
      const g = r.groups[Number(data.toggle)];
      if (ready(g)) g.selected = !g.selected;
      this.updateReviewSelection(r, [g]);
      if (e.detail === 0) b.focus({ preventScroll: true });
      return;
    }
    if (data.screen) {
      this.scopeDraft = null;
      if (data.screen !== 'rules') { this.ruleDeleteMode = false; this.ruleDeleteIds.clear(); }
      this.screen = data.screen; this.say(''); this.render();
      this.dialog.querySelector('.tr-main').scrollTop = 0;
      return;
    }
    if (data.scope) {
      const s = this.c.settings();
      this.scopeDraft = { extractTags: s.extractTags.join(', '), extractEnabled: s.extractEnabled, excludeEnabled: s.excludeEnabled, excludeRules: clone(s.excludeRules) };
      this.scopeMode = data.scope; this.say(''); this.scopeView();
      if (!this.scopeModal.open) this.scopeModal.showModal();
      this.scopeModal.querySelector('textarea, input')?.focus(); return;
    }
    if (data.removePair !== undefined) { this.scopeDraft.excludeRules.splice(Number(data.removePair), 1); this.scopeView(); return; }
    if (data.theme) { this.c.settings().theme = data.theme; this.c.saveSettings(); this.render(); return; }
    if (data.ruleDelete !== undefined) {
      if (this.ruleDeleteIds.has(data.ruleDelete)) this.ruleDeleteIds.delete(data.ruleDelete);
      else this.ruleDeleteIds.add(data.ruleDelete);
      this.render(); return;
    }
    if (data.rule) { this.say(''); this.openRuleModal(data.rule); return; }
    if (data.round) {
      this.expandedRoundId = this.expandedRoundId === data.round ? null : data.round;
      this.render();
      this.dialog.querySelector(`[data-round="${CSS.escape(data.round)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (data.edit !== undefined) {
      const r = this.panelRound(); this.c.target(r); this.c.assertIdle();
      const previousId = this.edit?.groupId;
      const id = Number(data.edit), g = r.groups[id], key = `${r.id}:${id}`;
      this.edit = this.drafts.get(key) ?? { roundId: r.id, groupId: id, key, text: proposal(g), matches: clone(g.matches), expanded: false };
      this.drafts.set(key, this.edit); this.refreshReviewRows(r, [previousId, id]); this.dialog.querySelector('#tr-edit').focus(); return;
    }
    if (data.random !== undefined || data.deleteMatch !== undefined) {
      const m = this.edit.matches.find(m => m.id === Number(data.random ?? data.deleteMatch));
      if (data.deleteMatch !== undefined) m.value = m.value === '' ? null : '';
      else { const values = m.options.filter(v => v !== m.value); m.value = values[Math.floor(Math.random() * values.length)]; }
      this.refreshEditor(); return;
    }
    if (data.keep !== undefined) {
      const r = this.panelRound(), g = r.groups[Number(data.keep)]; g.kept = true; g.selected = false; g.matches.forEach(m => { m.done = true; });
      this.drafts.delete(this.edit?.key); this.edit = null; this.refreshReviewRows(r, [g.id]); this.badge(); await this.c.persistDraft(); return;
    }
    switch (data.action) {
      case 'finish-review': await this.c.finishReview(this.panelRound()); this.say('本轮已完成，未应用的内容保留，不再提醒。'); break;
      case 'begin-rule-delete': this.ruleDeleteMode = true; this.ruleDeleteIds.clear(); this.say(''); this.render(); break;
      case 'cancel-rule-delete': this.ruleDeleteMode = false; this.ruleDeleteIds.clear(); this.say(''); this.render(); break;
      case 'confirm-rule-delete': {
        if (!this.ruleDeleteIds.size) break;
        const settings = this.c.settings(), count = this.ruleDeleteIds.size;
        settings.rules = settings.rules.filter(rule => !this.ruleDeleteIds.has(rule.id));
        this.ruleDeleteIds.forEach(id => this.ruleDrafts.delete(id));
        this.ruleDeleteMode = false; this.ruleDeleteIds.clear();
        this.c.saveSettings(); this.render(); this.say(`已删除 ${count} 条规则，重新检测后生效。`); break;
      }
      case 'export-rules': this.exportRules(); break;
      case 'import-rules': this.dialog.querySelector('#tr-rule-import-file')?.click(); break;
      case 'import-append': this.importRules('append'); break;
      case 'import-replace': this.importRules('replace'); break;
      case 'preview-rule': await this.previewRule(); break;
      case 'add-pair':
        if (this.scopeDraft.excludeRules.length >= 50) throw new Error('内容排除最多设置 50 条。');
        this.scopeDraft.excludeRules.push({ start: '', end: '' }); this.scopeView();
        this.scopeModal.querySelector('.tr-exclusion-row:last-child input').focus(); break;
      case 'save-scope': this.saveScope(); break;
      case 'scan-latest': {
        const latest = this.c.latestReply();
        if (latest < 0) throw new Error('当前没有可检测的 AI 回复。');
        this.panelTarget = this.c.captureTarget(latest); this.panelRoundId = null; this.edit = null;
        await this.detectPanelTarget(); break;
      }
      case 'scan': {
        if (!this.panelTarget) throw new Error('本次面板没有可重新检测的楼层。');
        this.edit = null; await this.detectPanelTarget(); break;
      }
      case 'new-rule': this.openRuleModal(); break;
      case 'cancel-rule': {
        if (this.ruleModal.open) this.closeRuleModal();
        else { this.ruleDrafts.delete(this.ruleId); this.ruleId = null; this.render(); }
        break;
      }
      case 'delete-current-rule': {
        const rule = this.c.settings().rules.find(r => r.id === this.ruleId);
        if (!rule || !globalThis.confirm('确定删除这条规则吗？此操作无法撤销。')) break;
        this.c.settings().rules = this.c.settings().rules.filter(r => r.id !== rule.id);
        this.c.saveSettings(); this.ruleDrafts.delete(rule.id); this.ruleId = null; this.ruleOriginal = null;
        this.ruleModal.close(); this.render(); this.say('已删除此规则，重新检测后生效。');
        break;
      }
      case 'cancel-edit': {
        const id = this.edit.groupId;
        this.drafts.delete(this.edit.key); this.edit = null;
        this.refreshReviewRows(this.panelRound(), [id]); break;
      }
      case 'delete-sentence': await this.finishEdit(''); break;
      case 'finish-edit': await this.finishEdit(); break;
      case 'apply': await this.c.commit(this.panelRound()); this.say('已应用并确认保存，后续上下文将使用修改稿。'); break;
      case 'undo': await this.c.commit(this.panelRound(), { undo: true }); this.say('已撤销上次应用并确认保存。'); break;
    }
  }
  input(e) {
    if (e.target.dataset.ruleFilter) {
      const key = e.target.dataset.ruleFilter, position = e.target.selectionStart;
      this.ruleFilters[key] = e.target.value; this.render();
      const input = this.dialog.querySelector(`[data-rule-filter="${key}"]`); input?.focus();
      if (key === 'search') input.setSelectionRange(position, position);
      return;
    }
    if (e.target.dataset.ruleField) this.ruleDrafts.get(this.ruleId)[e.target.dataset.ruleField] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.dataset.ruleField) { const preview = this.dialog.querySelector('#tr-rule-preview'); if (preview) preview.textContent = ''; }
    if (e.target.id === 'tr-extract-tags') this.scopeDraft.extractTags = e.target.value;
    if (e.target.dataset.boundary) this.scopeDraft.excludeRules[Number(e.target.dataset.pair)][e.target.dataset.boundary] = e.target.value;
    if (e.target.id === 'tr-edit' && this.edit) {
      this.edit.text = e.target.value;
      const g = this.panelRound().groups[this.edit.groupId];
      const preview = this.dialog.querySelector(`[data-edit-preview="${g.id}"] .tr-sentence`);
      if (preview) preview.innerHTML = inlineHTML({ ...g, kept: false, manual: true, draft: this.edit.text });
    }
    if (['tr-opacity', 'tr-launcher-opacity'].includes(e.target.id)) {
      this.c.settings()[e.target.id === 'tr-opacity' ? 'transparency' : 'launcherTransparency'] = Number(e.target.value); this.theme();
      e.target.style.setProperty('--tr-range-fill', `${Number(e.target.value) / Number(e.target.max || 100) * 100}%`);
      this.dialog.querySelector(`#${e.target.id}-value`).textContent = `${e.target.value}%`;
      this.c.saveSettings();
    }
  }
  refreshEditor() {
    const g = this.panelRound().groups[this.edit.groupId];
    this.edit.text = proposal({ ...g, kept: false, matches: this.edit.matches, manual: false });
    this.edit.expanded = true;
    this.refreshReviewRows(this.panelRound(), [g.id]);
  }
  async finishEdit(text = this.edit.text) {
    const r = this.panelRound(); this.c.target(r);
    const g = r.groups[this.edit.groupId]; g.matches = clone(this.edit.matches); g.manual = false; g.kept = false;
    g.manual = text !== proposal(g); g.draft = text; g.selected = ready(g);
    this.drafts.delete(this.edit.key); this.edit = null; this.refreshReviewRows(r, [g.id]); this.badge(); await this.c.persistDraft();
  }
  async change(e) {
    const el = e.target;
    if (el.id === 'tr-rule-import-file') {
      const file = el.files?.[0];
      el.value = '';
      if (file) await this.openRuleImport(file);
      return;
    }
    if (el.dataset.ruleField || el.dataset.ruleFilter) this.input(e);
    if (el.dataset.ruleField) this.ruleDrafts.get(this.ruleId)[el.dataset.ruleField] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.id === 'tr-launcher-color') { this.c.settings().launcherColor = el.value; this.launcherTheme(); this.c.saveSettings(); }
    if (el.dataset.scopeToggle) this.scopeDraft[el.dataset.scopeToggle] = el.checked;
    if (el.id === 'tr-launcher-enabled') { this.c.settings().showLauncher = el.checked; this.badge(); this.c.saveSettings(); }
    if (el.id === 'tr-plugin-enabled') { this.c.settings().enabled = el.checked; this.c.detectionSequence++; if (!el.checked) this.autoDetection?.cancel(); this.badge(); this.onPluginAvailabilityChange(); this.c.saveSettings(); this.render(); }
    if (el.id === 'tr-palette') { this.c.settings().palette = el.value; this.theme(); this.c.saveSettings(); }
    if (el.id === 'tr-auto') { this.c.settings().autoScan = el.checked; if (!el.checked) this.autoDetection?.cancel(); this.c.saveSettings(); }
    if (el.id === 'tr-history-detection') { this.c.settings().historyDetection = el.checked; this.onPluginAvailabilityChange(); this.c.saveSettings(); }
    if (el.id === 'tr-rule-execution') {
      this.c.settings().ruleExecution = el.value; this.c.saveSettings();
      const help = this.dialog.querySelector('#tr-execution-help');
      if (help) help.textContent = executionDescription(el.value);
    }
    if (el.dataset.ruleDeleteCheck !== undefined) {
      if (el.checked) this.ruleDeleteIds.add(el.dataset.ruleDeleteCheck);
      else this.ruleDeleteIds.delete(el.dataset.ruleDeleteCheck);
      this.render();
    }
    if (el.dataset.ruleEnabled) {
      this.c.settings().rules.find(r => r.id === el.dataset.ruleEnabled).enabled = el.checked;
      this.c.saveSettings(); this.render();
      this.dialog.querySelector(`[data-rule-enabled="${CSS.escape(el.dataset.ruleEnabled)}"]`)?.focus({ preventScroll: true });
    }
    if (el.id === 'tr-appearance') { this.c.settings().appearance = el.value; this.theme(); this.c.saveSettings(); }
    if (el.hasAttribute('data-all')) {
      const r = this.panelRound();
      r.groups.filter(ready).forEach(g => { g.selected = el.checked; });
      this.updateReviewSelection(r);
    }
    if (el.dataset.option !== undefined) { const m = this.edit.matches.find(m => m.id === Number(el.dataset.option)); m.value = m.options[Number(el.value)]; this.refreshEditor(); }
  }
  submit(e) {
    if (e.target.id !== 'tr-rule-form') return;
    const old = this.c.settings().rules.find(r => r.id === this.ruleId);
    const rule = this.draftRule();
    const rules = this.c.settings().rules;
    const signature = r => { const { id, enabled, ...content } = validateRule(r); return JSON.stringify(content); };
    if (rules.some(r => r.id !== rule.id && signature(r) === signature(rule))) throw new Error('已经有完全相同的规则。');
    if (old) rules.splice(rules.indexOf(old), 1, rule);
    else { if (rules.length >= 200) throw new Error('最多保存 200 条规则。'); rules.push(rule); }
    const inModal = this.ruleModal.open;
    this.c.saveSettings(); this.ruleDrafts.delete(this.ruleId); this.ruleId = null; this.ruleOriginal = null; this.screen = 'rules';
    if (inModal) this.ruleModal.close();
    this.render(); this.say('规则已保存，下次检测生效。');
  }
}
