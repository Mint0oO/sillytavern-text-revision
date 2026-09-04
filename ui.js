import { escapeHTML as esc, inlineHTML, proposal, ready, processed, validateRule, normalizeScope } from './engine.js';
import { clone } from './controller.js';

const button = (text, attrs = '') => `<button type="button" ${attrs}>${text}</button>`;
const icon = (name, label, attrs) => button(`<i class="fa-solid fa-${name}" aria-hidden="true"></i>`, `aria-label="${label}" class="tr-icon" ${attrs}`);

export class RevisionUI {
  constructor(controller) {
    this.c = controller;
    this.screen = 'review';
    this.edit = null;
    this.drafts = new Map();
    this.ruleId = null;
    this.historical = null;
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
    this.launcher.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>修订</span><small hidden></small>';
    this.launcher.addEventListener('click', () => this.open());
    document.body.append(this.launcher);
    this.dialog.addEventListener('click', e => this.run(() => this.click(e)));
    this.dialog.addEventListener('input', e => this.input(e));
    this.dialog.addEventListener('change', e => this.run(() => this.change(e)));
    this.dialog.addEventListener('submit', e => { e.preventDefault(); this.run(() => this.submit(e)); });
    this.dialog.addEventListener('close', () => {
      document.documentElement.style.overflow = this.scrollLock?.html ?? '';
      document.body.style.overflow = this.scrollLock?.body ?? '';
      this.returnFocus?.focus?.();
    });
    this.c.onChange = () => { if (this.edit && this.edit.roundId !== this.c.current()?.id) this.edit = null; this.badge(); if (this.dialog.open) this.render(); };
    this.viewport = () => {
      this.dialog.style.setProperty('--tr-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
      this.dialog.style.setProperty('--tr-top', `${window.visualViewport?.offsetTop ?? 0}px`);
    };
    window.visualViewport?.addEventListener('resize', this.viewport);
    this.viewport();
    this.badge();
  }
  async run(action) { try { await action(); } catch (error) { this.say(error.message, true); } }
  say(text, error = false) {
    const el = this.dialog.querySelector('.tr-status');
    el.textContent = text;
    el.classList.toggle('tr-error', error);
  }
  badge() {
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
  resetChat() { this.edit = null; this.drafts.clear(); this.historical = null; this.c.selectedId = null; this.screen = 'review'; this.c.onChange(); }
  theme() {
    const s = this.c.settings();
    this.dialog.dataset.theme = s.theme;
    this.dialog.dataset.palette = s.palette;
    this.dialog.style.setProperty('--tr-alpha', String(1 - s.transparency / 100));
    this.dialog.style.setProperty('--tr-fill', `${100 - s.transparency}%`);
    this.launcher.dataset.theme = s.theme;
  }
  render() {
    const scroll = this.dialog.querySelector('.tr-main').scrollTop;
    this.theme();
    const title = { review: '词句修订', rules: '规则', rule: this.ruleId ? '编辑规则' : '新建规则', settings: '设置', history: '检测记录', snapshot: '检测详情' }[this.screen];
    const nav = this.screen === 'review' ? button('规则', 'data-screen="rules"') + button('记录', 'data-screen="history"') + button('设置', 'data-screen="settings"') : button(this.screen === 'rule' ? '‹ 规则' : this.screen === 'snapshot' ? '‹ 记录' : '‹ 修订', `data-screen="${this.screen === 'rule' ? 'rules' : this.screen === 'snapshot' ? 'history' : 'review'}"`);
    this.dialog.querySelector('.tr-head').innerHTML = `<h2>${title}</h2><nav>${nav}${icon('xmark', '关闭修订面板', 'data-action="close"')}</nav>`;
    this.dialog.querySelector('.tr-foot').innerHTML = '';
    const draw = { review: 'review', snapshot: 'review', rules: 'rulesView', rule: 'ruleView', settings: 'settingsView', history: 'historyView' }[this.screen];
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
    this.body(`<div class="tr-bar"><span>第 ${r.number} 轮 · ${r.count} 处问题 / ${r.groups.length} ${r.segmented ? '句段' : '句'}</span>${history ? '' : button('重新检测', 'data-action="scan"')}</div><div class="tr-meta">回复 #${r.messageId + 1} · 版本 ${r.swipeId + 1}${this.c.generating ? ' · 正在生成' : ''}</div>${this.legend()}${!editable && !history ? '<p class="tr-meta">正文、回复版本或检测范围已变化，请重新检测。</p>' : ''}<div class="tr-rows">${r.groups.map(g => this.row(g, editable)).join('') || `<p class="tr-empty">${esc(r.notice || '本轮未发现匹配的问题。')}</p>`}</div>`);
    if (!history) {
      const eligible = r.groups.filter(ready), n = this.c.selectedCount(r);
      this.dialog.querySelector('.tr-foot').innerHTML = `<label class="tr-check"><input type="checkbox" data-all ${eligible.length && eligible.length === n ? 'checked' : ''} ${!editable || !eligible.length ? 'disabled' : ''}>全选</label><div>${r.undo && editable ? button('撤销', 'data-action="undo"') : ''}${button(`应用所选 ${n}`, `class="tr-primary" data-action="apply" ${!editable || !n || this.edit || this.c.generating ? 'disabled' : ''}`)}</div>`;
    }
  }
  row(g, editable) {
    const editing = this.edit?.groupId === g.id && this.edit.roundId === this.c.current()?.id && editable;
    let body = `<p class="tr-sentence">${inlineHTML(g)}</p>`;
    if (editing) {
      const d = this.edit;
      body = `<textarea id="tr-edit" aria-label="编辑整句" rows="3">${esc(d.text)}</textarea><details class="tr-candidates" ${d.expanded ? 'open' : ''}><summary>替换候选</summary>${d.matches.filter(m => m.options.length || m.remove).map(m => `<div class="tr-candidate"><label for="tr-option-${m.id}">${esc(m.old)}</label><div class="tr-replace">${m.options.length ? `<select id="tr-option-${m.id}" data-option="${m.id}"><option value="" disabled ${m.value === null || m.value === '' ? 'selected' : ''}>替换为…</option>${m.options.map((v, i) => `<option value="${i}" ${m.value === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>${m.options.length > 1 ? button('换一个', `data-random="${m.id}"`) : ''}` : '<span class="tr-meta">未设置替换词</span>'}</div>${m.remove ? button('删除', `class="tr-delete" data-delete-match="${m.id}" aria-pressed="${m.value === ''}"`) : ''}</div>`).join('') || '<p class="tr-meta">请直接编辑整句。</p>'}</details><div class="tr-edit-actions">${button('不改这句', `data-keep="${g.id}"`)}<div>${button('取消', 'data-action="cancel-edit"')}${button('完成', 'class="tr-primary" data-action="finish-edit"')}</div></div>`;
    } else if (g.kept || g.matches.every(m => m.done) && !ready(g)) body += `<span class="tr-meta">${g.kept ? '已保留' : '已应用'}</span>`;
    return `<section class="tr-row"><div>${body}</div>${editable ? `<div class="tr-row-controls">${editing ? '' : icon('pencil', `编辑第${g.id + 1}句`, `data-edit="${g.id}"`)}<label class="tr-select"><input type="checkbox" data-select="${g.id}" aria-label="选择第${g.id + 1}句" ${g.selected && ready(g) ? 'checked' : ''} ${!ready(g) || this.c.generating ? 'disabled' : ''}></label></div>` : ''}</section>`;
  }
  rulesView() {
    const rules = this.c.settings().rules;
    this.body(`<div class="tr-bar"><span>${rules.length} 条规则</span>${button('＋ 新建', 'data-action="new-rule"')}</div>${rules.map(r => `<div class="tr-rule-row"><label class="tr-select"><input type="checkbox" data-rule-enabled="${esc(r.id)}" aria-label="启用规则：${esc(r.find)}" ${r.enabled ? 'checked' : ''}></label>${button(`<span>${esc(r.find)}</span><span class="tr-meta">${r.values.length ? `${r.values.length} 个替换词` : r.remove ? '仅删除' : '仅检测'} ›</span>`, `class="tr-rule" data-rule="${esc(r.id)}"`)}</div>`).join('')}`);
  }
  ruleView() {
    const r = this.c.settings().rules.find(r => r.id === this.ruleId) ?? { find: '', values: [], kind: 'word', action: 'review' };
    this.body(`<form id="tr-rule-form"><label class="tr-field">识别内容<input id="tr-find" required maxlength="256" value="${esc(r.find)}"></label><label class="tr-field">替换词 <span class="tr-meta">每行一个</span><textarea id="tr-values" rows="5">${esc(r.values.join('\n'))}</textarea></label><label class="tr-check"><input id="tr-remove" type="checkbox" ${r.remove ? 'checked' : ''}>允许删除</label><label class="tr-field">默认处理<select id="tr-action">${[['review', '仅标记待改'], ['delete', '删除'], ['replace', '随机选择替换词']].map(([value, text]) => `<option value="${value}" ${r.action === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label><details><summary>句式设置</summary><label class="tr-field">匹配方式<select id="tr-kind"><option value="word" ${r.kind === 'word' ? 'selected' : ''}>固定词语</option><option value="pattern" ${r.kind === 'pattern' ? 'selected' : ''}>句式模板</option></select></label><p class="tr-meta">例如：像{A}的孤狼一样 → {A}。{A}、{B} 表示需要保留的内容；每个占位符只能出现一次。</p></details><div class="tr-form-actions"><button type="submit" class="tr-primary">保存规则</button></div></form>`);
  }
  settingsView() {
    const s = this.c.settings();
    this.body(`<div class="tr-settings-row"><div><span class="tr-label">显示模式</span><div class="tr-themes">${button('日间', `data-theme="light" aria-pressed="${s.theme === 'light'}"`)}${button('夜间', `data-theme="dark" aria-pressed="${s.theme === 'dark'}"`)}</div></div><div><div class="tr-label"><label for="tr-opacity">背景透明度</label><output id="tr-opacity-value">${s.transparency}%</output></div><input type="range" id="tr-opacity" min="0" max="100" step="5" value="${s.transparency}"></div><label class="tr-palette"><span class="tr-label">修订配色</span><select id="tr-palette">${[['classic', '经典'], ['soft', '柔和'], ['vivid', '鲜明']].map(([v, t]) => `<option value="${v}" ${s.palette === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>${this.legend()}<p class="tr-sentence tr-preview">壁炉旁的空位<del>极具</del><ins>很有</ins>吸引力。<br>他的思绪<mark>像断了线的风筝一样</mark>。</p><label class="tr-check"><input type="checkbox" id="tr-auto" ${s.autoScan ? 'checked' : ''}>回复完成后自动检测</label><form id="tr-scope-form"><label class="tr-field">提取标签<textarea id="tr-extract-tags" rows="2" placeholder="content" aria-describedby="tr-extract-help">${esc(s.extractTags.join('\n'))}</textarea></label><p class="tr-meta" id="tr-extract-help">每行一个标签名。留空检测整条回复；填写后只检测这些标签内部。</p><label class="tr-field">排除标签<textarea id="tr-exclude-tags" rows="3" placeholder="status&#10;options" aria-describedby="tr-exclude-help">${esc(s.excludeTags.join('\n'))}</textarea></label><p class="tr-meta" id="tr-exclude-help">跳过标签及其中全部内容。排除优先于提取。</p><div class="tr-form-actions"><button class="tr-primary" type="submit">保存检测范围</button></div></form>`);
  }
  historyView() {
    const history = this.c.history();
    this.body(`<p class="tr-meta">共检测 ${this.c.context().chatMetadata?.text_revision?.total ?? 0} 轮 · 保留最近 ${history.length} 轮</p>${history.slice().reverse().map(r => `<div class="tr-record"><div>第 ${r.number} 轮 · ${r.count} 处 / ${r.groups.length} ${r.segmented ? '句段' : '句'}${button('查看', `data-round="${esc(r.id)}"`)}</div><span class="tr-meta">回复 #${r.messageId + 1} · ${new Date(r.time).toLocaleString()} · 已处理 ${processed(r)}/${r.count} 处</span></div>`).join('') || '<p class="tr-empty">还没有检测记录。</p>'}`);
  }
  async click(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.type === 'submit') return;
    const data = b.dataset;
    if (data.action === 'close') { this.dialog.close(); return; }
    if (this.c.busy) return;
    if (data.screen) { this.screen = data.screen; this.say(''); this.render(); return; }
    if (data.theme) { this.c.settings().theme = data.theme; this.c.saveSettings(); this.render(); return; }
    if (data.rule) { this.ruleId = data.rule; this.screen = 'rule'; this.render(); return; }
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
      case 'scan-latest': this.edit = null; await this.c.detect(); break;
      case 'scan': {
        const r = this.c.current(); const m = this.c.context().chat[r?.messageId];
        const id = m?.extra?.text_revision?.id === r?.messageUid ? r.messageId : undefined;
        this.edit = null; await this.c.detect(id); break;
      }
      case 'new-rule': this.ruleId = null; this.screen = 'rule'; this.render(); break;
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
    if (e.target.id === 'tr-edit' && this.edit) this.edit.text = e.target.value;
    if (e.target.id === 'tr-opacity') {
      this.c.settings().transparency = Number(e.target.value); this.theme();
      this.dialog.querySelector('#tr-opacity-value').textContent = `${e.target.value}%`;
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
    if (el.id === 'tr-palette') { this.c.settings().palette = el.value; this.theme(); this.c.saveSettings(); }
    if (el.id === 'tr-auto') { this.c.settings().autoScan = el.checked; this.c.saveSettings(); }
    if (el.dataset.ruleEnabled) { this.c.settings().rules.find(r => r.id === el.dataset.ruleEnabled).enabled = el.checked; this.c.saveSettings(); }
    if (el.dataset.select !== undefined) { this.c.current().groups[Number(el.dataset.select)].selected = el.checked; this.render(); }
    if (el.hasAttribute('data-all')) { this.c.current().groups.filter(ready).forEach(g => { g.selected = el.checked; }); this.render(); }
    if (el.dataset.option !== undefined) { const m = this.edit.matches.find(m => m.id === Number(el.dataset.option)); m.value = m.options[Number(el.value)]; this.refreshEditor(); }
  }
  submit(e) {
    if (e.target.id === 'tr-scope-form') {
      const scope = normalizeScope({ extractTags: this.dialog.querySelector('#tr-extract-tags').value, excludeTags: this.dialog.querySelector('#tr-exclude-tags').value });
      Object.assign(this.c.settings(), scope);
      this.c.saveSettings(); this.edit = null; this.drafts.clear(); this.render();
      this.say('检测范围已保存，返回修订后重新检测即可。');
      return;
    }
    if (e.target.id !== 'tr-rule-form') return;
    const val = id => this.dialog.querySelector(`#${id}`).value;
    const old = this.c.settings().rules.find(r => r.id === this.ruleId);
    const rule = validateRule({ id: this.ruleId, find: val('tr-find'), values: val('tr-values').split(/\r?\n/), kind: val('tr-kind'), action: val('tr-action'), remove: this.dialog.querySelector('#tr-remove').checked, enabled: old?.enabled ?? true });
    const rules = this.c.settings().rules;
    if (rules.some(r => r.id !== rule.id && r.find === rule.find && r.kind === rule.kind)) throw new Error('已经有相同的检测规则。');
    if (old) rules.splice(rules.indexOf(old), 1, rule);
    else { if (rules.length >= 200) throw new Error('最多保存 200 条规则。'); rules.push(rule); }
    this.c.saveSettings(); this.screen = 'rules'; this.render(); this.say('规则已保存，下次检测生效。');
  }
}
