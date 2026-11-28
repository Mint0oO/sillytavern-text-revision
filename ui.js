// Main revision dialog shell, panel lifecycle, theming, and thin event routing.
import { processed } from './engine.js';
import { isDetectionCancelled } from './controller.js';
import { ruleCountText, characterRuleCountText } from './rules-view.js';
import { button, icon, dismissActions, createSubmodal, renderChangeLog } from './ui-primitives.js';
import { createLauncher, syncLauncherTheme, syncLauncherBadge } from './ui-launcher.js';
import { DRAFT_STORAGE_KEY, loadReviewDrafts, saveReviewDrafts, matchDraftForRound, storeEditDraft } from './ui-drafts.js';
import {
  renderReviewPanel, reviewSelectionState, renderReviewFooter, renderReviewRow,
  refreshReviewRows, updateReviewSelection, refreshReviewEditor, finishReviewEdit,
  handleReviewClick, handleReviewInput, handleReviewChange,
} from './ui-review-panel.js';
import {
  activeRuleScope, ruleStore, renderRulesPanel, exportRules, exportRawRules, openRuleImport, importRules,
  openRuleModal, closeRuleModal, openGroupModal, draftRule, previewRule,
  handleRuleChoiceSummaryClick, handleRulesClick, handleRulesInput, handleRulesChange, handleRulesSubmit,
} from './ui-rules-panel.js';
import {
  resetCharacterSession, characterRuleSummary, loadCharacterSnapshot, detectCharacter,
  characterSelectionState, characterFooter, syncCharacterSectionCheckboxes, renderCharacterPanel,
  refreshCharacterRows, updateCharacterSelection, openSourceModal, closeSourceModal, saveSourceModal,
  returnToCharacterSetup, refreshCharacterEditor, finishCharacterEdit, applyCharacterChanges,
  handleCharacterClick, handleCharacterInput, handleCharacterChange,
} from './ui-character-panel.js';
import {
  renderSlider, renderSettingsPanel, renderScopeModal, saveScope, renderHistoryPanel,
  handleSettingsHistoryClick, handleSettingsHistoryInput, handleSettingsHistoryChange,
} from './ui-settings-history.js';

export { renderChangeLog };

export class RevisionUI {
  constructor(controller) {
    this.c = controller;
    this.screen = 'review';
    this.edit = null;
    this.draftStorageKey = DRAFT_STORAGE_KEY;
    this.drafts = new Map();
    this.loadDrafts();
    this.ruleId = null;
    this.ruleFilters = { search: '' };
    this.ruleDeleteMode = false;
    this.ruleDeleteIds = new Set();
    this.collapsedRuleGroups = new Set();
    this.groupId = null;
    this.ruleDrafts = new Map();
    this.ruleOriginal = null;
    this.expandedRoundId = null;
    this.scopeDraft = null;
    this.scopeMode = null;
    this.ruleImport = null;
    this.returnFocus = null;
    this.panelTarget = null;
    this.panelRoundId = null;
    this.panelEpoch = 0;
    this.detecting = false;
    this.characterSnapshot = null;
    this.characterSelection = null;
    this.characterLoading = false;
    this.characterError = '';
    this.characterScan = null;
    this.characterDetecting = false;
    this.characterDetection = null;
    this.characterEdit = null;
    this.characterSelectionMap = null;
    this.collapsedCharacterSections = new Set();
    this.characterEpoch = 0;
    this.characterBusy = false;
    this.collapsedCharacterRuleGroups = new Set(['__body__']);
    this.expandedBodyMirrorGroups = new Set();
    this.characterRuleFilters = { search: '' };
    this.ruleScope = 'body';
    this.sourceDraft = null;
    this.onMainClosed = () => {};
    this.onPluginAvailabilityChange = () => {};

    this.dialog = document.createElement('dialog');
    this.dialog.id = 'tr-root';
    this.dialog.setAttribute('aria-label', '词句修订');
    this.dialog.innerHTML = '<div class="tr-shell"><header class="tr-head"></header><main class="tr-main"></main><div class="tr-status" role="status" aria-live="polite"></div><footer class="tr-foot"></footer></div>';
    document.body.append(this.dialog);

    const onEvent = {
      click: e => this.run(() => this.click(e)),
      input: e => this.input(e),
      change: e => this.run(() => this.change(e)),
      submit: e => this.run(() => this.submit(e)),
    };
    this.ruleModal = createSubmodal(this.dialog, {
      id: 'tr-rule-modal', title: '规则', closeLabel: '关闭规则编辑', closeAction: 'cancel-rule', onEvent,
      onClose: () => { if (this.ruleId !== null) { this.ruleDrafts.delete(this.ruleId); this.ruleId = null; } this.ruleOriginal = null; },
      onCancel: e => { e.preventDefault(); this.run(() => this.closeRuleModal()); },
    });
    this.ruleModal.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const openChoice = this.ruleModal.querySelector('.tr-rule-choice[open]');
      if (!openChoice) return;
      e.preventDefault(); e.stopPropagation();
      openChoice.open = false;
      openChoice.querySelector('summary')?.focus({ preventScroll: true });
    });
    this.groupModal = createSubmodal(this.dialog, {
      id: 'tr-group-modal', title: '分组', closeLabel: '关闭分组编辑', closeAction: 'cancel-group', onEvent,
      onClose: () => { this.groupId = null; },
      onCancel: e => { e.preventDefault(); this.groupModal.close(); },
    });
    this.importModal = createSubmodal(this.dialog, {
      id: 'tr-import-modal', title: '导入规则集', closeLabel: '关闭导入规则集', closeAction: 'cancel-import', onEvent,
      onClose: () => { this.ruleImport = null; },
    });
    this.scopeModal = createSubmodal(this.dialog, {
      id: 'tr-scope-modal', title: '检测范围', closeLabel: '关闭检测范围设置', closeAction: 'cancel-scope', onEvent,
      onClose: () => { this.scopeDraft = null; this.scopeMode = null; },
      onCancel: e => { e.preventDefault(); this.scopeModal.close(); },
    });
    this.sourceModal = createSubmodal(this.dialog, {
      id: 'tr-source-modal', title: '查看原文', closeLabel: '关闭原文编辑', closeAction: 'cancel-source', onEvent,
      onClose: () => { this.sourceDraft = null; },
      onCancel: e => { e.preventDefault(); this.run(() => this.closeSourceModal()); },
    });

    this.launcher = createLauncher({ onOpen: () => this.run(() => this.open()) });

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

    this.c.onChange = event => {
      if (event?.type === 'busy') { this.updateBusyControls(); return; }
      if (event?.type === 'record-save-failed') {
        this.say('检测记录尚未可靠保存，可重试。', true);
        if (this.dialog.open && this.screen === 'review' && !this.dialog.querySelector('[data-action="retry-record-save"]')) {
          this.dialog.querySelector('.tr-main')?.insertAdjacentHTML('afterbegin', `<div class="tr-save-pending">检测记录尚未可靠保存。${button('重试保存记录', 'data-action="retry-record-save"')}</div>`);
        }
        return;
      }
      this.badge();
      if (event?.type === 'detection' && this.panelRound()?.id !== event.round.id) return;
      if (this.edit && this.edit.roundId !== this.panelRound()?.id) this.edit = null;
      if (this.dialog.open && !['extract', 'exclude'].includes(this.screen) && !(['rules', 'character-rules'].includes(this.screen) && this.ruleId !== null) && !(this.screen === 'character' && this.characterEdit)) this.render();
    };

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

  async run(action) { try { await action(); } catch (error) { if (!isDetectionCancelled(error)) this.say(error.message, true); } }
  say(text, error = false) {
    const el = this.dialog.querySelector('.tr-status');
    el.textContent = text;
    el.classList.toggle('tr-error', error);
    if (error && !this.dialog.open) globalThis.toastr?.warning(text, '词句修订');
  }
  badge() {
    const round = this.c.current();
    const count = round && !round.reviewed && this.c.editable(round) ? round.count - processed(round) : 0;
    syncLauncherBadge(this.launcher, this.c.settings(), count);
  }
  launcherTheme() { syncLauncherTheme(this.launcher, this.dialog, this.c.settings()); }
  isMainOpen() { return Boolean(this.dialog.open); }

  loadDrafts() { this.drafts = loadReviewDrafts(this.draftStorageKey); }
  saveDrafts() { saveReviewDrafts(this.drafts, this.draftStorageKey, msg => this.say(msg, true)); }
  draftFor(round, groupId) { return matchDraftForRound(this.drafts, round, groupId); }
  storeEdit() { storeEditDraft(this.drafts, this.panelRound(), this.edit, this.draftStorageKey, msg => this.say(msg, true)); }

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
    this.panelDetection?.abort();
    this.panelTarget = null;
    this.panelRoundId = null;
    this.detecting = false;
    this.edit = null;
    this.reviewSelection = null;
    this.resetCharacterSession();
  }
  resetChat() { this.endPanelSession(); this.say(''); this.expandedRoundId = null; this.c.selectedId = null; this.screen = 'review'; this.c.onChange(); }

  async detectPanelTarget() {
    this.c.assertIdle();
    if (this.edit || this.panelRound()?.groups.some(g => this.draftFor(this.panelRound(), g.id))) throw new Error('这句还有未完成的编辑，请先完成或取消编辑，再重新检测。');
    this.panelDetection?.abort();
    const detection = new AbortController();
    this.panelDetection = detection;
    const epoch = this.panelEpoch, target = this.panelTarget;
    const messageId = this.c.resolveTarget(target);
    this.detecting = true;
    this.panelRoundId = null;
    this.edit = null;
    this.render();
    try {
      const round = await this.c.detect(messageId, { signal: detection.signal, onReady: readyRound => {
        if (epoch !== this.panelEpoch || !this.dialog.open || !this.c.sameTarget(target, this.panelTarget)) return;
        this.panelTarget = this.targetForRound(readyRound);
        this.panelRoundId = readyRound.id;
        this.detecting = false;
      } });
      if (epoch !== this.panelEpoch || !this.dialog.open || !this.c.sameTarget(target, this.panelTarget)) return null;
      return round;
    } catch (error) {
      if (isDetectionCancelled(error) || epoch !== this.panelEpoch || !this.dialog.open) return null;
      throw error;
    } finally {
      if (epoch === this.panelEpoch && this.panelDetection === detection && this.detecting) { this.detecting = false; if (this.dialog.open) this.render(); }
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
    if (!force && this.panelRound()) {
      const draft = this.panelRound().groups.map(g => this.draftFor(this.panelRound(), g.id)).find(Boolean);
      if (draft) { this.edit = draft; this.render(); }
    }
    if (this.c.settings().enabled !== false && this.panelTarget && (force || !this.panelRound())) await this.detectPanelTarget();
  }
  async openDetected(round) {
    if (this.c.settings().enabled === false) return false;
    const target = this.targetForRound(round);
    // A result finishing in the background must not replace another active floor or settings draft.
    if (this.dialog.open && (this.screen !== 'review' || !this.c.sameTarget(target, this.panelTarget))) return false;
    await this.open(undefined, { force: false, round });
    return true;
  }

  theme() {
    const s = this.c.settings();
    this.dialog.dataset.theme = s.theme;
    this.dialog.dataset.palette = s.palette;
    const transparency = Math.max(0, Math.min(100, Number(s.transparency ?? 5) || 0));
    this.dialog.style.setProperty('--tr-alpha', String(1 - transparency / 100));
    this.launcher.dataset.theme = s.theme;
    if (s.appearance) { this.dialog.dataset.appearance = s.appearance; this.launcher.dataset.appearance = s.appearance; }
    else { delete this.dialog.dataset.appearance; delete this.launcher.dataset.appearance; }
    this.launcherTheme();
  }
  render() {
    const scroll = this.dialog.querySelector('.tr-main').scrollTop;
    const worldScroll = this.dialog.querySelector('.tr-world-list')?.scrollTop ?? 0;
    this.theme();
    const s = this.c.settings();
    const title = { review: '词句修订', character: '角色', 'character-rules': '角色规则', rules: '规则', settings: '设置', extract: '标签提取', exclude: '内容排除', history: '检测记录' }[this.screen];
    const parent = ['extract', 'exclude'].includes(this.screen) ? ['settings', '设置'] : this.screen === 'character-rules' ? ['character', '角色'] : ['review', '修订'];
    const showCharacter = s.characterRevisionEnabled !== false;
    const inCharacterResult = this.screen === 'character' && (this.characterDetecting || this.characterScan);
    const nav = this.screen === 'review'
      ? (showCharacter ? button('角色', 'data-screen="character"') : '') + button('规则', 'data-screen="rules"') + button('记录', 'data-screen="history"') + button('设置', 'data-screen="settings"')
      : inCharacterResult
        ? button('‹ 角色', 'data-action="char-back-setup"')
        : button(`‹ ${parent[1]}`, `data-screen="${parent[0]}"`);
    const count = this.screen === 'rules'
      ? `<span class="tr-head-count">${ruleCountText(s.rules, s.ruleGroups, s.ungroupedEnabled !== false)}</span>`
      : this.screen === 'character-rules'
        ? `<span class="tr-head-count">${characterRuleCountText(s)}</span>`
        : '';
    this.dialog.querySelector('.tr-head').innerHTML = `<div class="tr-head-title"><h2>${title}</h2>${count}</div><nav>${nav}${icon('xmark', '关闭修订面板', 'data-action="close"')}</nav>`;
    this.dialog.querySelector('.tr-foot').innerHTML = '';
    const draw = { review: 'review', character: 'characterView', 'character-rules': 'rulesView', rules: 'rulesView', settings: 'settingsView', extract: 'scopeView', exclude: 'scopeView', history: 'historyView' }[this.screen];
    this[draw]();
    this.updateBusyControls();
    this.dialog.querySelector('.tr-main').scrollTop = scroll;
    const worldList = this.dialog.querySelector('.tr-world-list');
    if (worldList) worldList.scrollTop = worldScroll;
    this.badge();
  }
  body(html) { this.dialog.querySelector('.tr-main').innerHTML = html; }
  updateBusyControls() {
    this.savingControls ??= new Map();
    for (const [el, disabled] of this.savingControls) { el.disabled = disabled; el.removeAttribute('data-tr-saving'); }
    this.savingControls.clear();
    if (!this.c.busy && !this.characterBusy) return;
    this.dialog.querySelectorAll('button, input, select, textarea').forEach(el => {
      if (dismissActions.has(el.dataset.action) || el.dataset.screen) return;
      this.savingControls.set(el, el.disabled);
      if (!el.disabled) el.setAttribute('data-tr-saving', '');
      el.disabled = true;
    });
  }
  legend() { return '<div class="tr-legend"><del>删除</del><ins>新增</ins><mark>待改</mark></div>'; }

  // Panel delegations (thin prototype facade for external callers & unit tests).
  review() { renderReviewPanel(this); }
  selectionState(r) { return reviewSelectionState(this, r); }
  reviewFooter(r, editable) { renderReviewFooter(this, r, editable); }
  row(g, editable, options) { return renderReviewRow(this, g, editable, options); }
  refreshReviewRows(r, ids) { refreshReviewRows(this, r, ids); }
  updateReviewSelection(r, changed) { updateReviewSelection(this, r, changed); }
  refreshEditor() { refreshReviewEditor(this); }
  finishEdit(text) { return finishReviewEdit(this, text); }

  resetCharacterSession() { resetCharacterSession(this); }
  characterRuleSummary() { return characterRuleSummary(this); }
  loadCharacterSnapshot() { return loadCharacterSnapshot(this); }
  detectCharacter() { return detectCharacter(this); }
  characterSelectionState(scan) { return characterSelectionState(this, scan); }
  characterFooter(scan) { characterFooter(this, scan); }
  syncCharacterSectionCheckboxes(scan) { syncCharacterSectionCheckboxes(this, scan); }
  characterView() { renderCharacterPanel(this); }
  refreshCharacterRows(ids) { refreshCharacterRows(this, ids); }
  updateCharacterSelection(changed) { updateCharacterSelection(this, changed); }
  openSourceModal(targetId) { openSourceModal(this, targetId); }
  closeSourceModal(force) { closeSourceModal(this, force); }
  saveSourceModal() { return saveSourceModal(this); }
  returnToCharacterSetup() { return returnToCharacterSetup(this); }
  refreshCharacterEditor() { refreshCharacterEditor(this); }
  finishCharacterEdit(text) { finishCharacterEdit(this, text); }
  applyCharacterChanges(undo) { return applyCharacterChanges(this, undo); }

  activeRuleScope() { return activeRuleScope(this); }
  ruleStore(scope) { return ruleStore(this, scope); }
  rulesView() { renderRulesPanel(this); }
  exportRules() { exportRules(this); }
  exportRawRules() { exportRawRules(this); }
  openRuleImport(file) { return openRuleImport(this, file); }
  importRules(mode) { importRules(this, mode); }
  openRuleModal(ruleId) { openRuleModal(this, ruleId); }
  closeRuleModal(force) { closeRuleModal(this, force); }
  openGroupModal(groupId) { openGroupModal(this, groupId); }
  draftRule() { return draftRule(this); }
  previewRule() { return previewRule(this); }

  slider(id, label, value, max) { return renderSlider(id, label, value, max); }
  settingsView() { renderSettingsPanel(this); }
  scopeView() { renderScopeModal(this); }
  saveScope() { saveScope(this); }
  historyView() { renderHistoryPanel(this); }

  // Thin event dispatchers.
  pointerDown(e) {
    const b = e.target.closest?.('button');
    // Blurring an input can hide the keyboard and move a centered dialog
    // between pointerdown and pointerup, so the release misses the close button.
    // Retain focus until the normal click closes it (including discard checks).
    if (e.button === 0 && (dismissActions.has(b?.dataset.action) || b?.dataset.action === 'clear-rule-search')) e.preventDefault();
  }
  async click(e) {
    if (handleRuleChoiceSummaryClick(this, e)) return;
    const b = e.target.closest('button');
    if (!b || b.disabled || b.type === 'submit') return;
    const data = b.dataset;

    if (data.action === 'close') { this.dialog.close(); return; }
    if (data.action === 'cancel-rule' && this.ruleModal?.open) { this.closeRuleModal(); return; }
    if (data.action === 'cancel-group' && this.groupModal?.open) { this.groupModal.close(); return; }
    if (data.action === 'cancel-import') { this.importModal.close(); return; }
    if (data.action === 'cancel-scope') { this.scopeModal.close(); return; }
    if (data.action === 'cancel-source' && this.sourceModal?.open) { this.closeSourceModal(); return; }
    if ((this.c.busy || this.characterBusy) && !data.screen) return;

    if (data.quickToggle !== undefined) {
      const row = b.closest('.tr-row'), menu = row?.querySelector(`[data-quick-menu="${CSS.escape(String(data.quickToggle))}"]`);
      if (!menu) return;
      this.dialog.querySelectorAll('.tr-quick-menu:not([hidden])').forEach(other => {
        if (other === menu) return;
        other.hidden = true;
        other.closest('.tr-row')?.querySelector('[data-quick-toggle]')?.setAttribute('aria-expanded', 'false');
      });
      menu.hidden = !menu.hidden;
      b.setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    if (data.screen) {
      const previousScreen = this.screen;
      this.scopeDraft = null;
      if (!['rules', 'character-rules'].includes(data.screen)) { this.ruleDeleteMode = false; this.ruleDeleteIds.clear(); }
      this.screen = data.screen; this.say('');
      if (data.screen === 'character' && (previousScreen !== 'character-rules' || !this.characterSnapshot)) await this.loadCharacterSnapshot();
      else this.render();
      this.dialog.querySelector('.tr-main').scrollTop = 0;
      return;
    }

    if (await handleCharacterClick(this, data, b, e)) return;
    if (await handleRulesClick(this, data, b)) return;
    if (await handleSettingsHistoryClick(this, data)) return;
    await handleReviewClick(this, data, b, e);
  }
  input(e) {
    const el = e.target;
    if (handleRulesInput(this, el)) return;
    if (handleCharacterInput(this, el)) return;
    if (handleSettingsHistoryInput(this, el)) return;
    handleReviewInput(this, el);
  }
  async change(e) {
    const el = e.target;
    if (await handleRulesChange(this, el)) return;
    if (handleCharacterChange(this, el)) return;
    if (handleSettingsHistoryChange(this, el)) return;
    handleReviewChange(this, el);
  }
  submit(e) {
    handleRulesSubmit(this, e.target);
  }
}
