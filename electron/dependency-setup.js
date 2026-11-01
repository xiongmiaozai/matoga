/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 首次启动依赖检查：找不到 Go 后端二进制时，弹窗让用户选择
 * 「自行安装」或「自动安装」；自动安装需勾选同意第三方依赖下载与许可协议。
 *
 * 视觉与项目本体一致（web/css/mc-theme/）：直角、2px 黑边、
 * grass 绿主按钮、Press Start 2P 标题 + Inter 正文。
 */

const { BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const { targetPath, officialUrl } = require('./install-backend')
const { listSources, buildUrl } = require('./download-sources')
const { THIRD_PARTY_NOTICE, AGREEMENT_LABEL, buildNotice } = require('./third-party-notice')
const { DEFAULT_THREADS, MIN_THREADS, MAX_THREADS } = require('./multi-download')

const DEP_INIT = 'dep-setup:init'
const DEP_CHOICE = 'dep-setup-choice'

// 后端已就位。返回解析出的二进制路径。
function backendReadyPath() {
  const p = targetPath()
  try {
    if (fs.existsSync(p)) return p
  } catch {}
  return null
}

// 实际会尝试的下载地址清单（加速节点 + 官方兜底），协议里如实披露。
function downloadAddressList() {
  const raw = officialUrl()
  if (!raw) return []
  return listSources().map(s => buildUrl(s.prefix, raw))
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>matoga - 首次启动依赖检查</title>
<style>
  :root {
    color-scheme: dark;
    --mc-grass: #7cbd56;
    --mc-grass-dark: #5a9a3e;
    --mc-stone: #828282;
    --mc-stone-dark: #6a6a6a;
    --mc-diamond: #5bcefa;
    --mc-dark: #1a1a1e;
    --mc-darker: #121214;
    --mc-border-light: rgba(255, 255, 255, 0.15);
    --mc-border-dark: rgba(0, 0, 0, 0.5);
    --panel-bg: #2a2a2e;
    --text: #e8e8e8;
    --text-muted: #9a9a9a;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--mc-dark); color: var(--text);
    font-family: 'Inter', system-ui, 'Microsoft YaHei', sans-serif;
    font-size: 13.5px; line-height: 1.6;
    padding: 18px 20px; user-select: none;
  }
  h1 {
    font-family: 'Press Start 2P', 'Courier New', monospace;
    font-size: 12.5px; color: var(--mc-grass);
    margin-bottom: 12px; text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);
  }
  p.lead { color: var(--text-muted); font-size: 12.5px; margin-bottom: 10px; }
  .panel {
    background: var(--panel-bg); border: 2px solid #000;
    box-shadow: inset 2px 2px 0 0 var(--mc-border-light), inset -2px -2px 0 0 var(--mc-border-dark);
    padding: 12px 14px;
  }
  .notice {
    height: 268px; overflow: auto; background: var(--mc-darker);
    border: 2px solid #000; padding: 10px 12px;
    font-family: 'Courier New', monospace; font-size: 11.5px; line-height: 1.6;
    color: var(--text-muted); white-space: pre-wrap; word-break: break-word;
    user-select: text;
  }
  .agree { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0 8px; }
  .agree input { margin-top: 3px; width: 15px; height: 15px; accent-color: var(--mc-grass); }
  .agree span { font-size: 12.5px; }
  .field { display: flex; align-items: center; gap: 10px; margin: 10px 0 4px; font-size: 12.5px; }
  .field input[type=number] {
    width: 78px; padding: 6px 8px; background: var(--mc-darker); color: var(--text);
    border: 2px solid #000; box-shadow: inset 2px 2px 0 0 var(--mc-border-dark);
    font-family: 'Courier New', monospace; font-size: 12.5px; border-radius: 0;
  }
  .field .hint { color: var(--text-muted); font-size: 11.5px; }
  .urls { margin-top: 6px; font-size: 11.5px; color: var(--text-muted); }
  .urls b { color: var(--text); }
  .urls ul { margin: 4px 0 0 16px; }
  .urls li { word-break: break-all; font-family: 'Courier New', monospace; }
  .row { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; }
  button {
    font-family: 'Inter', system-ui, 'Microsoft YaHei', sans-serif;
    font-size: 13px; color: var(--text); background: var(--mc-stone);
    border: 2px solid #000; border-radius: 0; padding: 8px 14px; cursor: pointer;
    box-shadow: inset 2px 2px 0 0 var(--mc-border-light), inset -2px -2px 0 0 var(--mc-border-dark);
  }
  button:hover:not(:disabled) { background: var(--mc-grass); }
  button:active:not(:disabled) {
    box-shadow: inset -2px -2px 0 0 var(--mc-border-light), inset 2px 2px 0 0 var(--mc-border-dark);
  }
  button.primary { background: var(--mc-grass); }
  button.primary:hover:not(:disabled) { background: var(--mc-grass-dark); }
  button:disabled { color: #6a6a6a; background: var(--mc-stone-dark); cursor: not-allowed; }
</style>
</head>
<body>
  <h1>MATOGA 首次启动依赖检查</h1>
  <p class="lead">未检测到后端二进制。请选择安装方式：</p>

  <div class="panel">
    <div class="notice" id="notice"></div>
    <label class="agree">
      <input type="checkbox" id="agree">
      <span id="label"></span>
    </label>
    <div class="field">
      <span>下载线程数</span>
      <input type="number" id="threads" min="1" max="64" step="1">
      <span class="hint">默认 24，范围 1–64。线程越多通常越快，但可能被节点限速。</span>
    </div>
    <div class="urls">
      <b>自动安装会依次尝试下列下载地址（多节点测速，按快慢排序，失败自动回退）：</b>
      <ul id="urls"></ul>
    </div>
  </div>

  <div class="row">
    <button id="manual">自行安装</button>
    <button id="auto" class="primary" disabled>自动安装</button>
  </div>

  <script>
    const $ = id => document.getElementById(id)
    window.__depSetup.init().then(cfg => {
      $('notice').textContent = cfg.notice
      $('label').textContent = cfg.label
      $('threads').value = cfg.defaultThreads
      $('threads').min = cfg.minThreads
      $('threads').max = cfg.maxThreads
      $('urls').innerHTML = cfg.urls.map(u => '<li>' + escapeHtml(u) + '</li>').join('')
    })
    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
    }
    function clampThreads() {
      const el = $('threads')
      let n = parseInt(el.value, 10)
      if (!isFinite(n)) n = 24
      n = Math.max(1, Math.min(64, n))
      el.value = n
      return n
    }
    const agree = $('agree')
    const autoBtn = $('auto')
    agree.addEventListener('change', () => { autoBtn.disabled = !agree.checked })
    $('threads').addEventListener('blur', clampThreads)
    autoBtn.addEventListener('click', () => window.__depSetup.send({ action: 'auto', threads: clampThreads() }))
    $('manual').addEventListener('click', () => window.__depSetup.send({ action: 'manual', threads: 0 }))
  </script>
</body>
</html>`

/**
 * 弹出「依赖安装」选择窗。
 *
 * @returns {Promise<{ action: 'auto' | 'manual' | 'quit', threads: number }>}
 *  - auto   用户选了自动安装（且已勾选同意协议），threads 为所选线程数
 *  - manual 用户选了自行安装
 *  - quit   用户取消/关闭（调用方应退出应用）
 */
async function promptDependencySetup(parentWindow) {
  const win = new BrowserWindow({
    parent: parentWindow || undefined,
    modal: !!parentWindow,
    width: 660,
    height: 700,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'matoga - 首次启动依赖检查',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'dependency-setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const addresses = downloadAddressList()
  const initPayload = {
    // 协议正文必须写明真实下载地址（含各加速节点），供用户知情同意。
    notice: buildNotice(addresses) || THIRD_PARTY_NOTICE,
    label: AGREEMENT_LABEL,
    urls: addresses,
    defaultThreads: DEFAULT_THREADS,
    minThreads: MIN_THREADS,
    maxThreads: MAX_THREADS
  }

  ipcMain.handle(DEP_INIT, () => initPayload)

  return new Promise(resolve => {
    let settled = false
    const done = result => {
      if (settled) return
      settled = true
      ipcMain.removeHandler(DEP_INIT)
      ipcMain.removeListener(DEP_CHOICE, handler)
      if (!win.isDestroyed()) win.close()
      resolve(result)
    }
    const handler = (_event, payload) => {
      const action = payload && payload.action
      const threads = payload && Number(payload.threads)
      if (action === 'auto') return done({ action: 'auto', threads })
      if (action === 'manual') return done({ action: 'manual', threads: 0 })
      done({ action: 'quit', threads: 0 })
    }
    ipcMain.on(DEP_CHOICE, handler)
    win.once('closed', () => done({ action: 'quit', threads: 0 }))

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML))
    win.once('ready-to-show', () => win.show())
  })
}

// 「自行安装」：打开 Release 页，用户可自行下载二进制。
function openManualInstallGuide() {
  shell.openExternal('https://github.com/xiongmiaozai/matoga/releases/latest')
}

module.exports = { promptDependencySetup, backendReadyPath, openManualInstallGuide, downloadAddressList }
