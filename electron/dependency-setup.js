/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 首次启动依赖检查：找不到 Go 后端二进制时，弹窗让用户选择
 * 「自行安装」或「自动安装」；自动安装需勾选同意第三方依赖下载与许可协议。
 */

const { BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const { targetPath, downloadUrl } = require('./install-backend')
const { THIRD_PARTY_NOTICE, AGREEMENT_LABEL } = require('./third-party-notice')

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

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>首次启动依赖检查</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 20px 24px;
    background: #1e1e1e; color: #e6e6e6;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px; line-height: 1.6;
    user-select: none;
  }
  h1 { font-size: 17px; margin: 0 0 8px; }
  p { margin: 6px 0; }
  .notice {
    background: #141414; border: 1px solid #3a3a3a; border-radius: 6px;
    padding: 12px 14px; height: 300px; overflow: auto;
    font-size: 12.5px; white-space: pre-wrap; word-break: break-word;
    user-select: text;
  }
  .agree { display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 4px; }
  .agree input { margin-top: 3px; }
  .row { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; }
  button {
    border: 1px solid #4a4a4a; border-radius: 6px; padding: 8px 16px;
    background: #2b2b2b; color: #e6e6e6; font-size: 14px; cursor: pointer;
  }
  button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
  button.primary:disabled { background: #2b3a55; border-color: #2b3a55; color: #889; cursor: not-allowed; }
  button:hover:not(:disabled) { filter: brightness(1.15); }
  .hint { font-size: 12px; color: #9a9a9a; margin-top: 8px; word-break: break-all; }
</style>
</head>
<body>
  <h1>首次启动需要安装后端组件</h1>
  <p>未检测到 matoga 后端二进制。你可以选择：</p>
  <div class="notice" id="notice"></div>
  <label class="agree">
    <input type="checkbox" id="agree">
    <span id="label"></span>
  </label>
  <p class="hint">自动安装将从此处下载官方预编译二进制：<br><span id="url"></span></p>
  <div class="row">
    <button id="manual">自行安装</button>
    <button id="auto" class="primary" disabled>自动安装</button>
  </div>
  <script>
    window.__depSetup.init().then(({ notice, label, url }) => {
      document.getElementById('notice').textContent = notice
      document.getElementById('label').textContent = label
      document.getElementById('url').textContent = url
    })
    const agree = document.getElementById('agree')
    const autoBtn = document.getElementById('auto')
    const manualBtn = document.getElementById('manual')
    agree.addEventListener('change', () => { autoBtn.disabled = !agree.checked })
    autoBtn.addEventListener('click', () => window.__depSetup.send('auto'))
    manualBtn.addEventListener('click', () => window.__depSetup.send('manual'))
  </script>
</body>
</html>`

/**
 * 弹出「依赖安装」选择窗。
 *
 * @returns {Promise<'auto' | 'manual' | 'quit'>}
 *  - auto   用户选了自动安装（且已勾选同意协议）
 *  - manual 用户选了自行安装
 *  - quit   用户取消/关闭（调用方应退出应用）
 */
async function promptDependencySetup(parentWindow) {
  const win = new BrowserWindow({
    parent: parentWindow || undefined,
    modal: !!parentWindow,
    width: 620,
    height: 680,
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

  const notice = THIRD_PARTY_NOTICE
  const label = AGREEMENT_LABEL
  const urlText = downloadUrl() || ''

  ipcMain.handle(DEP_INIT, () => ({ notice, label, url: urlText }))

  return new Promise(resolve => {
    let settled = false
    const done = action => {
      if (settled) return
      settled = true
      ipcMain.removeHandler(DEP_INIT)
      ipcMain.removeListener(DEP_CHOICE, handler)
      if (!win.isDestroyed()) win.close()
      resolve(action)
    }
    const handler = (_event, action) => done(action === 'auto' ? 'auto' : action === 'manual' ? 'manual' : 'quit')
    ipcMain.on(DEP_CHOICE, handler)
    win.once('closed', () => done('quit'))

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML))
    win.once('ready-to-show', () => win.show())
  })
}

// 「自行安装」：打开 Release 页，用户可自行下载二进制。
function openManualInstallGuide() {
  shell.openExternal('https://github.com/xiongmiaozai/matoga/releases/latest')
}

module.exports = { promptDependencySetup, backendReadyPath, openManualInstallGuide }
