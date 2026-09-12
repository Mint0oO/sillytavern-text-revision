export const executionDescription = execution => execution === 'auto'
  ? '自动触发时应用修改并保存；手动检测先展示结果。仅提示项、冲突项仍需审阅，兼容规则沿用原处理方式。'
  : '检测后先展示结果，由你选择并应用。兼容规则沿用原处理方式。';

export function renderSettingsView(s, { legend, slider, glyph }) {
  const select = (id, options, value, attrs = '') => `<span class="tr-setting-select"><select id="${id}" ${attrs}>${options.map(([v, text]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${text}</option>`).join('')}</select><svg class="tr-select-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="m2 4 4 4 4-4"/></svg></span>`;
  const field = (id, label, control, description = '', className = '') => `<div class="tr-setting ${className}"><label for="${id}">${label}</label><div class="tr-setting-control">${control}</div>${description ? `<p class="tr-meta tr-setting-help">${description}</p>` : ''}</div>`;
  const toggle = (id, label, checked, description = '') => `<div class="tr-setting-block"><label class="tr-setting tr-setting-toggle tr-plugin-switch"><span>${label}</span><span class="tr-setting-control"><input type="checkbox" role="switch" id="${id}" ${checked ? 'checked' : ''}></span></label>${description ? `<p class="tr-meta tr-setting-help">${description}</p>` : ''}</div>`;
  return `<div class="tr-settings">
    <section class="tr-settings-section" aria-labelledby="tr-running-title">
      <h3 id="tr-running-title" tabindex="-1">运行设置</h3>
      ${toggle('tr-plugin-enabled', '启用插件', s.enabled !== false)}
      ${toggle('tr-auto', '自动检测', s.autoScan, '开启后，在 AI 回复完成时执行规则；关闭后仍可手动检测。')}
      ${toggle('tr-history-detection', '历史检测', s.historyDetection !== false, '开启后显示每层检测图标；关闭后隐藏，不影响自动检测。')}
      ${field('tr-rule-execution', '处理方式', select('tr-rule-execution', [['review', '人工审查'], ['auto', '自动应用']], s.ruleExecution ?? 'review', 'aria-describedby="tr-execution-help"'), `<span id="tr-execution-help" role="status">${executionDescription(s.ruleExecution)}</span>`, 'tr-setting-execution')}
    </section>
    <section class="tr-settings-section" aria-labelledby="tr-scope-title">
      <h3 id="tr-scope-title">检测范围</h3>
      <div class="tr-scope-entries">
        <button type="button" data-scope="extract">标签提取 <span>${s.extractEnabled && s.extractTags.length ? s.extractTags.length + ' 个' : '全文'} ›</span></button>
        <button type="button" data-scope="exclude">内容排除 <span>${s.excludeEnabled ? s.excludeRules.length + ' 条' : '关闭'} ›</span></button>
      </div>
    </section>
    <section class="tr-settings-section" aria-labelledby="tr-appearance-title">
      <h3 id="tr-appearance-title">界面外观</h3>
      ${field('tr-appearance', '界面美化', select('tr-appearance', [['minimal', '极简'], ['paper', '暖纸'], ['mist', '青雾'], ['lavender', '淡紫']], s.appearance))}
      <div class="tr-setting"><span id="tr-theme-label">显示模式</span><div class="tr-setting-control tr-themes" role="group" aria-labelledby="tr-theme-label">${[['light', '日间'], ['dark', '夜间']].map(([value, text]) => `<button type="button" data-theme="${value}" aria-pressed="${s.theme === value}">${text}</button>`).join('')}</div></div>
      ${slider('tr-opacity', '背景透明度', s.transparency)}
      <p class="tr-meta tr-setting-help">透明度只影响外层背景；文字、输入框和内容区域保持清晰。</p>
      ${field('tr-palette', '修订配色', select('tr-palette', [['classic', '经典'], ['soft', '柔和'], ['vivid', '鲜明']], s.palette))}
      <div class="tr-palette-preview" aria-label="修订配色预览">${legend()}<p class="tr-sentence">他的神情<del>极其</del><ins>十分</ins>冷漠。<br>他<mark>像丢了魂一样</mark>愣在原地。</p></div>
      <div class="tr-launcher-group">
        ${toggle('tr-launcher-enabled', '显示悬浮球', s.showLauncher)}
        ${field('tr-launcher-color', '图标颜色', `${select('tr-launcher-color', [['theme', '跟随美化'], ['graphite', '石墨'], ['blue', '浅蓝'], ['sage', '鼠尾草'], ['lavender', '淡紫'], ['sand', '奶茶']], s.launcherColor)}<span class="tr-launcher-preview" data-launcher-preview aria-label="悬浮球预览">${glyph('pencil')}</span>`, '', 'tr-setting-launcher-color')}
        ${slider('tr-launcher-opacity', '图标透明度', s.launcherTransparency)}
      </div>
    </section>
  </div>`;
}
