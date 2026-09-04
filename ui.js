import { escapeHTML as esc, inlineHTML, proposal, ready, processed, validateRule, normalizeScope, parseRuleValues, formatRuleValues } from './engine.js';
import { clone } from './controller.js';

const button = (text, attrs = '') => `<button type="button" ${attrs}>${text}</button>`;
const glyph = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${name === 'xmark' ? '<path d="m6 6 12 12M6 18 18 6"/>' : '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>'}</svg>`;
const icon = (name, label, attrs) => button(glyph(name), `aria-label="${label}" class="tr-icon" ${attrs}`);

export class RevisionUI {
  constructor(controller) {
    this.c = controller;
    this.screen = 'review';
    this.edit = null;
    this.drafts = new Map();
    this.ruleId = null;
    this.ruleDrafts = new Map();
    this.historical = null;
    this.scopeDraft = null;
    this.returnFocus = null;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'tr-root';
    this.dialog.setAttribute('aria-label', '词句修订');
    this.dialog.innerHTML = '<div class="tr-shell"><header class="tr-head"></header><main class="tr-main"></main><div class="tr-status" role="status" aria-live="polite"></div><footer class="tr-foot"></footer></div>';
    document.body.append(this.dialog);
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
    this.dialog.addEventListener('click', e => this.run(() => this.click(e)));
    this.dialog.addEventListener('input', e => this.input(e));
    this.dialog.addEventListener('change', e => this.run(() => this.change(e)));
    this.dialog.addEventListener('submit', e => { e.preventDefault(); this.run(() => this.submit(e)); });
    this.dialog.addEventListener('close', () => {
      this.scopeDraft = null;
      document.documentElement.style.overflow = this.scrollLock?.html ?? '';
      document.body.style.overflow = this.scrollLock?.body ?? '';
      this.returnFocus?.focus?.();
    });
    this.c.onChange = () => { if (this.edit && this.edit.roundId !== this.c.current()?.id) this.edit = null; this.badge(); if (this.dialog.open && !['extract', 'exclude'].includes(this.screen) && !(this.screen === 'rules' && this.ruleId !== null)) this.render(); };
    this.viewport = () => {
      this.dialog.style.setProperty('--tr-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
      this.dialog.style.setProperty('--tr-top', `${window.visualViewport?.offsetTop ?? 0}px`);
    };
    window.visualViewport?.addEventListener('resize', this.viewport);
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
    this.launcher.hidden = !this.c.settings().showLauncher;
    const round = this.c.current();
    const count = round ? round.count - processed(round) : 0;
    const badge = this.launcher.querySelector('small');
    badge.hidden = !count;
    badge.textContent = String(count);
    this.launcher.setAttribute('aria-label', `打开词句修订${count ? `，${count} 处待处理` : ''}`);
  }
  async open(messageId) {
    if (!this.dialog.open) {
      this.returnFocus = document.activeElement;
      this.scrollLock = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
      document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
      this.dialog.showModal();
    }
    this.viewport();
    this.screen = 'review';
    this.edit = null;
    this.say('');
    this.render();
    if (messageId !== undefined || !this.c.current()) await this.run(() => this.c.detect(messageId));
    this.render();
  }
  async openDetected(round) {
    // Do not replace text the user is actively typing in another settings page.
    if (this.dialog.open && this.screen !== 'review') return;
    this.c.selectedId = round.id;
    await this.open();
  }
  resetChat() { this.edit = null; this.drafts.clear(); this.historical = null; this.c.selectedId = null; this.screen = 'review'; this.c.onChange(); }
  theme() {
    const s = this.c.settings();
    this.dialog.dataset.theme = s.theme;
    this.dialog.dataset.palette = s.palette;
    this.dialog.style.setProperty('--tr-alpha', String(1 - s.transparency / 100));
    this.dialog.style.setProperty('--tr-fill', `${100 - s.transparency}%`);
    this.launcher.dataset.theme = s.theme;
    this.dialog.dataset.appearance = s.appearance;
    this.launcher.dataset.appearance = s.appearance;
    this.launcherTheme();
  }
  render() {
    const scroll = this.dialog.querySelector('.tr-main').scrollTop;
    this.theme();
    const title = { review: '词句修订', rules: '规则', settings: '设置', extract: '标签提取', exclude: '内容排除', history: '检测记录', snapshot: '检测详情' }[this.screen];
    const parent = this.screen === 'snapshot' ? ['history', '记录'] : ['extract', 'exclude'].includes(this.screen) ? ['settings', '设置'] : ['review', '修订'];
    const nav = this.screen === 'review' ? button('规则', 'data-screen="rules"') + button('记录', 'data-screen="history"') + button('设置', 'data-screen="settings"') : button(`‹ ${parent[1]}`, `data-screen="${parent[0]}"`);
    this.dialog.querySelector('.tr-head').innerHTML = `<h2>${title}</h2><nav>${nav}${icon('xmark', '关闭修订面板', 'data-action="close"')}</nav>`;
    this.dialog.querySelector('.tr-foot').innerHTML = '';
    const draw = { review: 'review', snapshot: 'review', rules: 'rulesView', settings: 'settingsView', extract: 'scopeView', exclude: 'scopeView', history: 'historyView' }[this.screen];
    this[draw]();
    if (this.c.busy) this.dialog.querySelectorAll('button:not([data-action="close"]), input, select, textarea').forEach(el => { el.disabled = true; });
    this.dialog.querySelector('.tr-main').scrollTop = scroll;
    this.badge();
  }
  body(html) { this.dialog.querySelector('.tr-main').innerHTML = html; }
  legend() { return '<div class="tr-legend"><del>删除</del><ins>新增</ins><mark>待改</mark></div>'; }
  review() {
    const history = this.screen === 'snapshot';
    const r = history ? this.c.history().find(r => r.id === this.historical) : this.c.current();
    if (!r) { this.body(`<div class="tr-empty">打开一条 AI 回复后开始检测。${button('检测最新回复', 'data-action="scan-latest"')}</div>`); return; }
    const editable = !history && this.c.editable(r);
    this.body(`<div class="tr-review-bar"><span title="字段按可独立修订的句段计数">${r.count}处问题/${r.groups.length}字段</span>${this.legend()}${history ? '' : button('重新检测', 'data-action="scan"')}</div>${!editable && !history ? '<p class="tr-meta">正文或检测范围已变化，请重新检测。</p>' : ''}<div class="tr-rows">${r.groups.map(g => this.row(g, editable)).join('') || `<p class="tr-empty">${esc(r.notice || '未发现匹配的问题。')}</p>`}</div>`);
    if (!history) {
      const eligible = r.groups.filter(ready), n = this.c.selectedCount(r);
      this.dialog.querySelector('.tr-foot').innerHTML = `<label class="tr-check"><input type="checkbox" data-all ${eligible.length && eligible.length === n ? 'checked' : ''} ${!editable || !eligible.length ? 'disabled' : ''}>全选</label><div>${r.undo && editable ? button('撤销', 'data-action="undo"') : ''}${button(`应用所选 ${n}`, `class="tr-primary" data-action="apply" ${!editable || !n || this.edit ? 'disabled' : ''}`)}</div>`;
    }
  }
  row(g, editable) {
    const editing = this.edit?.groupId === g.id && this.edit.roundId === this.c.current()?.id && editable;
    let body = `<p class="tr-sentence">${inlineHTML(g)}</p>`;
    if (editing) {
      const d = this.edit;
      body = `<textarea id="tr-edit" aria-label="编辑整句" rows="3">${esc(d.text)}</textarea><details class="tr-candidates" ${d.expanded ? 'open' : ''}><summary>替换候选</summary>${d.matches.filter(m => m.options.length || m.remove).map(m => `<div class="tr-candidate"><label for="tr-option-${m.id}">${esc(m.old)}</label><div class="tr-replace">${m.options.length ? `<select id="tr-option-${m.id}" data-option="${m.id}"><option value="" disabled ${m.value === null || m.value === '' ? 'selected' : ''}>替换为…</option>${m.options.map((v, i) => `<option value="${i}" ${m.value === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>${m.options.length > 1 ? button('换一个', `data-random="${m.id}"`) : ''}` : '<span class="tr-meta">未设置替换词</span>'}</div>${m.remove ? button('删除', `class="tr-delete" data-delete-match="${m.id}" aria-pressed="${m.value === ''}"`) : ''}</div>`).join('') || '<p class="tr-meta">请直接编辑整句。</p>'}</details><div class="tr-edit-actions">${button('不改这句', `data-keep="${g.id}"`)}<div>${button('取消', 'data-action="cancel-edit"')}${button('完成', 'class="tr-primary" data-action="finish-edit"')}</div></div>`;
    } else if (g.kept || g.matches.every(m => m.done) && !ready(g)) body += `<span class="tr-meta">${g.kept ? '已保留' : '已应用'}</span>`;
    if (editing) return `<section class="tr-row tr-row-editing">${body}</section>`;
    const selected = g.selected && ready(g);
    const content = editable && ready(g)
      ? button(`<span class="tr-sentence">${inlineHTML(g)}</span>`, `class="tr-row-toggle" data-toggle="${g.id}" aria-pressed="${selected}" aria-label="${selected ? '取消选择' : '选择'}第${g.id + 1}字段：${esc(proposal(g))}"`)
      : `<div class="tr-row-text">${body}</div>`;
    return `<section class="tr-row ${selected ? 'tr-selected' : ''} ${editable ? 'tr-row-editable' : ''}">${content}${editable ? icon('pencil', `编辑第${g.id + 1}句`, `data-edit="${g.id}"`) : ''}</section>`;
  }
  rulesView() {
    const rules = this.c.settings().rules;
    this.body(`<div class="tr-bar"><span>${rules.length} 条规则</span>${button('＋ 新建', 'data-action="new-rule"')}</div>${this.ruleId === 'new' ? this.ruleForm() : ''}${rules.map(r => `<section class="tr-rule-section"><div class="tr-rule-row">${button(`<span>${esc(r.find)}</span><span class="tr-meta">${r.values.length ? `${r.values.length} 个替换词` : r.remove ? '仅删除' : '仅检测'} ${this.ruleId === r.id ? '⌃' : '⌄'}</span>`, `class="tr-rule" data-rule="${esc(r.id)}" aria-expanded="${this.ruleId === r.id}"`)}<label class="tr-select"><input type="checkbox" data-rule-enabled="${esc(r.id)}" aria-label="启用规则：${esc(r.find)}" ${r.enabled ? 'checked' : ''}></label></div>${this.ruleId === r.id ? this.ruleForm() : ''}</section>`).join('')}`);
  }
  ruleForm() {
    if (!this.ruleDrafts.has(this.ruleId)) {
      const r = this.c.settings().rules.find(r => r.id === this.ruleId) ?? { find: '', values: [], kind: 'word', action: 'review', remove: false };
      this.ruleDrafts.set(this.ruleId, { ...clone(r), valuesText: formatRuleValues(r.values) });
    }
    const r = this.ruleDrafts.get(this.ruleId);
    return `<form id="tr-rule-form" class="tr-rule-editor"><label class="tr-field">识别内容<input id="tr-find" data-rule-field="find" required maxlength="256" value="${esc(r.find)}"></label><label class="tr-field"><span class="tr-field-heading">替换词 <span class="tr-meta">用英文逗号 , 分隔</span></span><textarea id="tr-values" data-rule-field="valuesText" rows="2" placeholder="十分, 非常">${esc(r.valuesText)}</textarea></label><label class="tr-check"><input id="tr-remove" data-rule-field="remove" type="checkbox" ${r.remove ? 'checked' : ''}>允许删除</label><label class="tr-field">默认处理<select id="tr-action" data-rule-field="action">${[['review', '仅标记待改'], ['delete', '删除'], ['replace', '随机选择替换词']].map(([value, text]) => `<option value="${value}" ${r.action === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label><details ${r.kind === 'pattern' ? 'open' : ''}><summary>句式设置</summary><label class="tr-field">匹配方式<select id="tr-kind" data-rule-field="kind"><option value="word" ${r.kind === 'word' ? 'selected' : ''}>固定词语</option><option value="pattern" ${r.kind === 'pattern' ? 'selected' : ''}>句式模板</option></select></label><p class="tr-meta">例如：识别「不是{A}，而是{B}」，替换为「{B}」。<br>「不是害怕，而是担心」会改为「担心」。<br>{A}、{B} 代表句中变化的内容；替换词写哪个，就保留哪部分。识别模板中，每个占位符只能出现一次。</p></details><div class="tr-form-actions">${button('取消', 'data-action="cancel-rule"')}<button type="submit" class="tr-primary">保存规则</button></div></form>`;
  }
  slider(id, label, value) {
    return `<label class="tr-mini-slider" for="${id}"><span>${label}<output id="${id}-value">${value}%</output></span><input type="range" id="${id}" min="0" max="100" step="5" value="${value}" style="--tr-range-fill:${value}%"></label>`;
  }
  settingsView() {
    const s = this.c.settings();
    this.body(`<label class="tr-field">界面美化<select id="tr-appearance">${[['minimal', '极简'], ['paper', '暖纸'], ['mist', '青雾'], ['lavender', '淡紫']].map(([v, t]) => `<option value="${v}" ${s.appearance === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><div class="tr-mode-row"><div><span class="tr-label">显示模式</span><div class="tr-themes">${button('日间', `data-theme="light" aria-pressed="${s.theme === 'light'}"`)}${button('夜间', `data-theme="dark" aria-pressed="${s.theme === 'dark'}"`)}</div></div>${this.slider('tr-opacity', '背景透明度', s.transparency)}</div><label class="tr-field">修订配色<select id="tr-palette">${[['classic', '经典'], ['soft', '柔和'], ['vivid', '鲜明']].map(([v, t]) => `<option value="${v}" ${s.palette === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${this.legend()}<p class="tr-sentence tr-preview">壁炉旁的空位<del>极具</del><ins>很有</ins>吸引力。<br>他的思绪<mark>像断了线的风筝一样</mark>。</p><label class="tr-check"><input type="checkbox" id="tr-auto" ${s.autoScan ? 'checked' : ''}>回复完成后自动检测</label><label class="tr-check"><input type="checkbox" id="tr-launcher-enabled" ${s.showLauncher ? 'checked' : ''}>显示悬浮球</label><div class="tr-launcher-settings"><label class="tr-launcher-color"><span class="tr-label">图标颜色</span><select id="tr-launcher-color">${[['theme', '跟随美化'], ['graphite', '石墨'], ['blue', '浅蓝'], ['sage', '鼠尾草'], ['lavender', '淡紫'], ['sand', '奶茶']].map(([v,t]) => `<option value="${v}" ${s.launcherColor === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${this.slider('tr-launcher-opacity', '图标透明度', s.launcherTransparency)}<span class="tr-launcher-preview" data-launcher-preview aria-label="悬浮球预览">${glyph('pencil')}</span></div><div class="tr-scope-entries">${button(`标签提取 <span>${s.extractEnabled && s.extractTags.length ? s.extractTags.length + ' 个' : '全文'} ›</span>`, 'data-scope="extract"')}${button(`内容排除 <span>${s.excludeEnabled ? s.excludeRules.length + ' 条' : '关闭'} ›</span>`, 'data-scope="exclude"')}</div>`);
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
    const extraction = this.screen === 'extract';
    const toggle = `<label class="tr-check tr-scope-toggle">${extraction ? '标签提取' : '内容排除'}<input role="switch" type="checkbox" data-scope-toggle="${extraction ? 'extractEnabled' : 'excludeEnabled'}" ${d[extraction ? 'extractEnabled' : 'excludeEnabled'] ? 'checked' : ''}></label>`;
    if (extraction) {
      this.body(`${toggle}<label class="tr-field">输入标签（逗号分隔）<textarea id="tr-extract-tags" rows="2" placeholder="content, maintext">${esc(d.extractTags)}</textarea></label><p class="tr-meta">只检测标签内的文字；关闭或留空则检测排除内容之外的全文。</p>`);
    } else {
      this.body(`${toggle}<p class="tr-meta">跳过开始到结束之间的内容，包含两端文字。标签提取留空或关闭时，会检测排除后剩余的文字。</p><div class="tr-exclusion-list">${d.excludeRules.map((pair, i) => `<div class="tr-exclusion-row"><input data-boundary="start" data-pair="${i}" aria-label="排除 ${i + 1}：开始文字" placeholder="开始文字" maxlength="256" value="${esc(pair.start)}"><span>到</span><input data-boundary="end" data-pair="${i}" aria-label="排除 ${i + 1}：结束文字" placeholder="结束文字" maxlength="256" value="${esc(pair.end)}">${icon('xmark', `删除排除 ${i + 1}`, `data-remove-pair="${i}"`)}</div>`).join('')}</div>${button('＋ 添加规则', 'class="tr-add-pair" data-action="add-pair"')}`);
    }
    this.dialog.querySelector('.tr-foot').innerHTML = `${button('取消', 'data-screen="settings"')}${button('保存', 'class="tr-primary" data-action="save-scope"')}`;
  }
  saveScope() {
    const d = this.scopeDraft;
    // Validate even disabled drafts, but retain names while their switch is off.
    const checked = normalizeScope({ ...d, extractEnabled: true, excludeEnabled: true });
    Object.assign(this.c.settings(), { extractTags: checked.extractTags, excludeRules: clone(d.excludeRules), extractEnabled: d.extractEnabled, excludeEnabled: d.excludeEnabled });
    this.c.saveSettings(); this.scopeDraft = null; this.edit = null; this.drafts.clear();
    this.screen = 'settings'; this.render(); this.say('已保存，重新检测后生效。');
  }
  historyView() {
    const history = this.c.history();
    this.body(`<p class="tr-meta">共检测 ${this.c.context().chatMetadata?.text_revision?.total ?? 0} 轮 · 保留最近 ${history.length} 轮</p>${history.slice().reverse().map(r => `<div class="tr-record"><div><span class="tr-round-number" aria-label="第 ${r.number} 轮">${r.number}</span><span class="tr-record-count">${r.count}处问题/${r.groups.length}字段</span>${button('查看', `data-round="${esc(r.id)}"`)}</div><span class="tr-meta">回复 #${r.messageId + 1} · ${new Date(r.time).toLocaleString()} · 已处理 ${processed(r)}/${r.count} 处</span></div>`).join('') || '<p class="tr-empty">还没有检测记录。</p>'}`);
  }
  async click(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.type === 'submit') return;
    const data = b.dataset;
    if (data.action === 'close') { this.dialog.close(); return; }
    if (this.c.busy) return;
    if (data.toggle !== undefined) {
      const r = this.c.current();
      this.c.target(r);
      if (!this.c.editable(r)) throw new Error('正文或检测范围已变化，请重新检测。');
      const g = r.groups[Number(data.toggle)];
      if (ready(g)) g.selected = !g.selected;
      this.render();
      this.dialog.querySelector(`[data-toggle="${g.id}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (data.screen) { this.scopeDraft = null; this.screen = data.screen; this.say(''); this.render(); return; }
    if (data.scope) {
      const s = this.c.settings();
      this.scopeDraft = { extractTags: s.extractTags.join(', '), extractEnabled: s.extractEnabled, excludeEnabled: s.excludeEnabled, excludeRules: clone(s.excludeRules) };
      this.screen = data.scope; this.say(''); this.render(); return;
    }
    if (data.removePair !== undefined) { this.scopeDraft.excludeRules.splice(Number(data.removePair), 1); this.render(); return; }
    if (data.theme) { this.c.settings().theme = data.theme; this.c.saveSettings(); this.render(); return; }
    if (data.rule) { this.ruleId = this.ruleId === data.rule ? null : data.rule; this.say(''); this.render(); return; }
    if (data.round) { this.historical = data.round; this.screen = 'snapshot'; this.render(); return; }
    if (data.edit !== undefined) {
      const r = this.c.current(); this.c.target(r); this.c.assertIdle();
      const id = Number(data.edit), g = r.groups[id], key = `${r.id}:${id}`;
      this.edit = this.drafts.get(key) ?? { roundId: r.id, groupId: id, key, text: proposal(g), matches: clone(g.matches), expanded: false };
      this.drafts.set(key, this.edit); this.render(); this.dialog.querySelector('#tr-edit').focus(); return;
    }
    if (data.random !== undefined || data.deleteMatch !== undefined) {
      const m = this.edit.matches.find(m => m.id === Number(data.random ?? data.deleteMatch));
      if (data.deleteMatch !== undefined) m.value = m.value === '' ? null : '';
      else { const values = m.options.filter(v => v !== m.value); m.value = values[Math.floor(Math.random() * values.length)]; }
      this.refreshEditor(); return;
    }
    if (data.keep !== undefined) {
      const g = this.c.current().groups[Number(data.keep)]; g.kept = true; g.selected = false; g.matches.forEach(m => { m.done = true; });
      this.drafts.delete(this.edit?.key); this.edit = null; this.render(); await this.c.persistDraft(); return;
    }
    switch (data.action) {
      case 'add-pair':
        if (this.scopeDraft.excludeRules.length >= 50) throw new Error('内容排除最多设置 50 条。');
        this.scopeDraft.excludeRules.push({ start: '', end: '' }); this.render();
        this.dialog.querySelector('.tr-exclusion-row:last-child input').focus(); break;
      case 'save-scope': this.saveScope(); break;
      case 'scan-latest': this.edit = null; await this.c.detect(); break;
      case 'scan': {
        const r = this.c.current(); const m = this.c.context().chat[r?.messageId];
        const id = m?.extra?.text_revision?.id === r?.messageUid ? r.messageId : undefined;
        this.edit = null; await this.c.detect(id); break;
      }
      case 'new-rule': this.ruleId = 'new'; this.screen = 'rules'; this.render(); this.dialog.querySelector('#tr-find').focus(); break;
      case 'cancel-rule': this.ruleDrafts.delete(this.ruleId); this.ruleId = null; this.render(); break;
      case 'cancel-edit': this.drafts.delete(this.edit.key); this.edit = null; this.render(); break;
      case 'finish-edit': {
        const r = this.c.current(); this.c.target(r);
        const g = r.groups[this.edit.groupId]; g.matches = clone(this.edit.matches); g.manual = false; g.kept = false;
        g.manual = this.edit.text !== proposal(g); g.draft = this.edit.text; g.selected = ready(g);
        this.drafts.delete(this.edit.key); this.edit = null; this.render(); await this.c.persistDraft(); break;
      }
      case 'apply': await this.c.commit(this.c.current()); this.say('已应用并确认保存，后续上下文将使用修改稿。'); break;
      case 'undo': await this.c.commit(this.c.current(), { undo: true }); this.say('已撤销上次应用并确认保存。'); break;
    }
  }
  input(e) {
    if (e.target.dataset.ruleField) this.ruleDrafts.get(this.ruleId)[e.target.dataset.ruleField] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.id === 'tr-extract-tags') this.scopeDraft.extractTags = e.target.value;
    if (e.target.dataset.boundary) this.scopeDraft.excludeRules[Number(e.target.dataset.pair)][e.target.dataset.boundary] = e.target.value;
    if (e.target.id === 'tr-edit' && this.edit) this.edit.text = e.target.value;
    if (['tr-opacity', 'tr-launcher-opacity'].includes(e.target.id)) {
      this.c.settings()[e.target.id === 'tr-opacity' ? 'transparency' : 'launcherTransparency'] = Number(e.target.value); this.theme();
      e.target.style.setProperty('--tr-range-fill', `${e.target.value}%`);
      this.dialog.querySelector(`#${e.target.id}-value`).textContent = `${e.target.value}%`;
      this.c.saveSettings();
    }
  }
  refreshEditor() {
    const g = this.c.current().groups[this.edit.groupId];
    this.edit.text = proposal({ ...g, kept: false, matches: this.edit.matches, manual: false });
    this.edit.expanded = true;
    this.render();
  }
  async change(e) {
    const el = e.target;
    if (el.dataset.ruleField) this.ruleDrafts.get(this.ruleId)[el.dataset.ruleField] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.id === 'tr-launcher-color') { this.c.settings().launcherColor = el.value; this.launcherTheme(); this.c.saveSettings(); }
    if (el.dataset.scopeToggle) this.scopeDraft[el.dataset.scopeToggle] = el.checked;
    if (el.id === 'tr-launcher-enabled') { this.c.settings().showLauncher = el.checked; this.badge(); this.c.saveSettings(); }
    if (el.id === 'tr-palette') { this.c.settings().palette = el.value; this.theme(); this.c.saveSettings(); }
    if (el.id === 'tr-auto') { this.c.settings().autoScan = el.checked; this.c.saveSettings(); }
    if (el.dataset.ruleEnabled) { this.c.settings().rules.find(r => r.id === el.dataset.ruleEnabled).enabled = el.checked; this.c.saveSettings(); }
    if (el.id === 'tr-appearance') { this.c.settings().appearance = el.value; this.theme(); this.c.saveSettings(); }
    if (el.hasAttribute('data-all')) { this.c.current().groups.filter(ready).forEach(g => { g.selected = el.checked; }); this.render(); }
    if (el.dataset.option !== undefined) { const m = this.edit.matches.find(m => m.id === Number(el.dataset.option)); m.value = m.options[Number(el.value)]; this.refreshEditor(); }
  }
  submit(e) {
    if (e.target.id !== 'tr-rule-form') return;
    const val = id => this.dialog.querySelector(`#${id}`).value;
    const old = this.c.settings().rules.find(r => r.id === this.ruleId);
    const rule = validateRule({ id: old?.id, find: val('tr-find'), values: parseRuleValues(val('tr-values')), kind: val('tr-kind'), action: val('tr-action'), remove: this.dialog.querySelector('#tr-remove').checked, enabled: old?.enabled ?? true });
    const rules = this.c.settings().rules;
    if (rules.some(r => r.id !== rule.id && r.find === rule.find && r.kind === rule.kind)) throw new Error('已经有相同的检测规则。');
    if (old) rules.splice(rules.indexOf(old), 1, rule);
    else { if (rules.length >= 200) throw new Error('最多保存 200 条规则。'); rules.push(rule); }
    this.c.saveSettings(); this.ruleDrafts.delete(this.ruleId); this.ruleId = null; this.screen = 'rules'; this.render(); this.say('规则已保存，下次检测生效。');
  }
}
