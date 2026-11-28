// Settings view, detection scope modal, history records view, and their event handlers.
import { escapeHTML as esc, normalizeScope } from './engine.js';
import { clone, chatKey } from './controller.js';
import { renderSettingsView, executionDescription } from './settings-view.js';
import { button, glyph, icon, renderChangeLog } from './ui-primitives.js';

export function renderSlider(id, label, value, max = 100) {
  const normalized = Math.max(0, Math.min(max, Number(value) || 0));
  return `<div class="tr-setting tr-setting-range"><label for="${id}">${label}</label><div class="tr-setting-control tr-mini-slider"><output id="${id}-value" for="${id}">${normalized}%</output><input type="range" id="${id}" min="0" max="${max}" step="5" value="${normalized}" style="--tr-range-fill:${normalized / max * 100}%"></div></div>`;
}

export function renderSettingsPanel(ui) {
  ui.body(renderSettingsView(ui.c.settings(), {
    legend: () => ui.legend(),
    slider: renderSlider,
    glyph,
  }));
  ui.launcherTheme();
}

export function renderScopeModal(ui) {
  const d = ui.scopeDraft;
  const extraction = ui.scopeMode === 'extract';
  const toggle = `<label class="tr-check tr-scope-toggle">${extraction ? '标签提取' : '内容排除'}<input role="switch" type="checkbox" data-scope-toggle="${extraction ? 'extractEnabled' : 'excludeEnabled'}" ${d[extraction ? 'extractEnabled' : 'excludeEnabled'] ? 'checked' : ''}></label>`;
  let content;
  if (extraction) {
    content = `${toggle}<label class="tr-field">输入标签（逗号分隔）<textarea id="tr-extract-tags" rows="2" placeholder="content, maintext">${esc(d.extractTags)}</textarea></label><p class="tr-meta">只检测标签内的文字；关闭或留空则检测排除内容之外的全文。</p>`;
  } else {
    content = `${toggle}<p class="tr-meta">跳过开始到结束之间的内容，包含两端文字。标签提取留空或关闭时，会检测排除后剩余的文字。</p><div class="tr-exclusion-list">${d.excludeRules.map((pair, i) => `<div class="tr-exclusion-row"><input data-boundary="start" data-pair="${i}" aria-label="排除 ${i + 1}：开始文字" placeholder="开始文字" maxlength="256" value="${esc(pair.start)}"><span>到</span><input data-boundary="end" data-pair="${i}" aria-label="排除 ${i + 1}：结束文字" placeholder="结束文字" maxlength="256" value="${esc(pair.end)}">${icon('xmark', `删除排除 ${i + 1}`, `data-remove-pair="${i}"`)}</div>`).join('')}</div>${button('＋ 添加规则', 'class="tr-add-pair" data-action="add-pair"')}`;
  }
  ui.scopeModal.querySelector('h3').textContent = extraction ? '标签提取' : '内容排除';
  ui.scopeModal.querySelector('.tr-modal-body').innerHTML = `${content}<div class="tr-form-actions"><button type="button" data-action="cancel-scope">取消</button><button type="button" class="tr-primary" data-action="save-scope">保存</button></div>`;
}

export function saveScope(ui) {
  const d = ui.scopeDraft;
  // Validate even disabled drafts, but retain names while their switch is off.
  const checked = normalizeScope({ ...d, extractEnabled: true, excludeEnabled: true });
  Object.assign(ui.c.settings(), { extractTags: checked.extractTags, excludeRules: clone(d.excludeRules), extractEnabled: d.extractEnabled, excludeEnabled: d.excludeEnabled });
  ui.c.saveSettings(); ui.edit = null;
  ui.scopeModal.close(); ui.render(); ui.say('已保存，重新检测后生效。');
}

export function renderHistoryPanel(ui) {
  const history = ui.c.history();
  const records = history.slice().reverse().map(r => {
    const expanded = ui.expandedRoundId === r.id;
    const floor = ui.c.locateRound(r);
    const label = `${floor >= 0 ? floor : r.messageId ?? '?'}# ${r.version ?? 1}`;
    const count = r.summary?.count ?? r.count, fields = r.summary?.fields ?? r.groups.length;
    const detail = expanded ? `<div class="tr-record-detail"><p class="tr-meta">${new Date(r.time).toLocaleString()}${r.reviewed ? ' · 已完成审阅' : ''}${r.logOnly ? ' · 仅保留修改日志' : ''}${floor < 0 ? ' · 原消息已失效' : ''}</p>${r.logOnly ? '<p class="tr-meta">句段详情已按记录保留策略清理。</p>' : `<div class="tr-rows">${r.groups.map(g => ui.row(g, false)).join('') || `<p class="tr-empty">${esc(r.notice || '未发现匹配的问题。')}</p>`}</div>`}${r.log?.length ? renderChangeLog(r.log) : '<p class="tr-meta">无修改日志</p>'}</div>` : '';
    return `<section class="tr-record"><button type="button" class="tr-record-summary" data-round="${esc(r.id)}" aria-expanded="${expanded}" aria-label="${expanded ? '收起' : '展开'}${label} 检测记录"><span class="tr-record-number">${label}</span><span class="tr-record-reply">${floor >= 0 ? '回复版本' : '已失效'}</span><span class="tr-record-count">${count}处/${fields}字段</span><span class="tr-record-progress">${r.log?.length ?? 0} 条修改</span><span class="tr-record-chevron">${glyph('chevron-down')}</span></button>${detail}</section>`;
  }).join('');
  const floors = new Set(history.map(r => r.messageUid)).size;
  const legacy = ui.c.context().chatMetadata?.text_revision?.legacyBackup;
  const backup = legacy?.length ? `<div class="tr-history-backup"><p class="tr-meta">旧记录仍保留在聊天中。请先导出备份，再清理旧副本以完成瘦身。</p>${button('导出旧记录备份', 'data-action="export-history-backup"')}${ui.historyBackupExported === chatKey(ui.c.context()) ? button('清理已备份的旧副本', 'data-action="clear-history-backup"') : ''}</div>` : '';
  ui.body(`<p class="tr-meta tr-history-meta">累计检测 ${ui.c.context().chatMetadata?.text_revision?.total ?? 0} 次 · 保留 ${floors} 层／${history.length} 个内容版本</p>${backup}${records || '<p class="tr-empty">还没有检测记录。</p>'}`);
}

export async function handleSettingsHistoryClick(ui, data) {
  if (data.scope) {
    const s = ui.c.settings();
    ui.scopeDraft = { extractTags: s.extractTags.join(', '), extractEnabled: s.extractEnabled, excludeEnabled: s.excludeEnabled, excludeRules: clone(s.excludeRules) };
    ui.scopeMode = data.scope; ui.say(''); renderScopeModal(ui);
    if (!ui.scopeModal.open) ui.scopeModal.showModal();
    ui.scopeModal.querySelector('textarea, input')?.focus();
    return true;
  }
  if (data.removePair !== undefined) { ui.scopeDraft.excludeRules.splice(Number(data.removePair), 1); renderScopeModal(ui); return true; }
  if (data.theme) { ui.c.settings().theme = data.theme; ui.c.saveSettings(); ui.render(); return true; }
  if (data.round) {
    ui.expandedRoundId = ui.expandedRoundId === data.round ? null : data.round;
    ui.render();
    ui.dialog.querySelector(`[data-round="${CSS.escape(data.round)}"]`)?.focus({ preventScroll: true });
    return true;
  }
  switch (data.action) {
    case 'add-pair':
      if (ui.scopeDraft.excludeRules.length >= 50) throw new Error('内容排除最多设置 50 条。');
      ui.scopeDraft.excludeRules.push({ start: '', end: '' }); renderScopeModal(ui);
      ui.scopeModal.querySelector('.tr-exclusion-row:last-child input').focus();
      return true;
    case 'save-scope': saveScope(ui); return true;
    case 'export-history-backup': {
      const legacy = ui.c.context().chatMetadata?.text_revision?.legacyBackup;
      if (!legacy?.length) throw new Error('当前聊天没有待导出的旧记录。');
      const blob = new Blob([JSON.stringify({ type: 'henge-history-backup', exportedAt: new Date().toISOString(), chat: ui.c.context().chatId, rounds: legacy }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `词句修订-旧记录备份-${Date.now()}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      ui.historyBackupExported = chatKey(ui.c.context()); ui.render(); ui.say('已发起本地备份下载。请确认文件已保存后，再清理旧副本。');
      return true;
    }
    case 'clear-history-backup': {
      if (ui.historyBackupExported !== chatKey(ui.c.context())) throw new Error('请先导出当前聊天的旧记录备份。');
      const metadata = ui.c.context().chatMetadata.text_revision, backup = metadata.legacyBackup;
      delete metadata.legacyBackup;
      try { await ui.c.persistDraft(); }
      catch (error) { metadata.legacyBackup = backup; throw error; }
      ui.render(); ui.say('旧副本已清理并保存。');
      return true;
    }
    default: return false;
  }
}

export function handleSettingsHistoryInput(ui, el) {
  if (el.id === 'tr-extract-tags') { ui.scopeDraft.extractTags = el.value; return true; }
  if (el.dataset.boundary) { ui.scopeDraft.excludeRules[Number(el.dataset.pair)][el.dataset.boundary] = el.value; return true; }
  if (['tr-opacity', 'tr-launcher-opacity'].includes(el.id)) {
    ui.c.settings()[el.id === 'tr-opacity' ? 'transparency' : 'launcherTransparency'] = Number(el.value);
    ui.theme();
    el.style.setProperty('--tr-range-fill', `${Number(el.value) / Number(el.max || 100) * 100}%`);
    ui.dialog.querySelector(`#${el.id}-value`).textContent = `${el.value}%`;
    ui.c.saveSettings();
    return true;
  }
  return false;
}

export function handleSettingsHistoryChange(ui, el) {
  if (el.id === 'tr-launcher-color') { ui.c.settings().launcherColor = el.value; ui.launcherTheme(); ui.c.saveSettings(); return true; }
  if (el.dataset.scopeToggle) { ui.scopeDraft[el.dataset.scopeToggle] = el.checked; return true; }
  if (el.id === 'tr-launcher-enabled') { ui.c.settings().showLauncher = el.checked; ui.badge(); ui.c.saveSettings(); ui.render(); return true; }
  if (el.id === 'tr-plugin-enabled') { ui.c.settings().enabled = el.checked; ui.c.detectionSequence++; if (!el.checked) ui.autoDetection?.cancel(); ui.badge(); ui.onPluginAvailabilityChange(); ui.c.saveSettings(); ui.render(); return true; }
  if (el.id === 'tr-palette') { ui.c.settings().palette = el.value; ui.theme(); ui.c.saveSettings(); return true; }
  if (el.id === 'tr-auto') { ui.c.settings().autoScan = el.checked; if (!el.checked) ui.autoDetection?.cancel(); ui.c.saveSettings(); return true; }
  if (el.id === 'tr-character-revision') {
    ui.c.settings().characterRevisionEnabled = el.checked;
    if (!el.checked) ui.resetCharacterSession();
    ui.c.saveSettings(); ui.render();
    return true;
  }
  if (el.id === 'tr-history-detection') { ui.c.settings().historyDetection = el.checked; ui.onPluginAvailabilityChange(); ui.c.saveSettings(); return true; }
  if (el.id === 'tr-rule-execution') {
    ui.c.settings().ruleExecution = el.value; ui.c.saveSettings();
    const help = ui.dialog.querySelector('#tr-execution-help');
    if (help) help.textContent = executionDescription(el.value);
    return true;
  }
  if (el.id === 'tr-appearance') { ui.c.settings().appearance = el.value; ui.theme(); ui.c.saveSettings(); return true; }
  return false;
}
