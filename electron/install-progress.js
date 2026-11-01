/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 依赖下载/安装进度窗。视觉完全对齐项目本体的 MC 主题
 * （web/css/mc-theme/）：直角、2px 黑边、grass 绿进度条、
 * Press Start 2P 标题 + Inter 正文。
 *
 * 主进程通过 push(event) 推送阶段事件；渲染层只负责展示，
 * 不发起任何网络或文件操作。
 */

const { BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')

const PROGRESS_PRELOAD = 'install-progress-preload.js'

// 与 mc-theme 完全一致的令牌，内联以免依赖打包后的 CSS 文件。
const THEME = `
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
    --panel-2: #333338;
    --border: #4a4a52;
    --text: #e8e8e8;
    --text-muted: #9a9a9a;
    --warn: #f5a623;
    --danger: #c63a3a;
  }
`

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>matoga - 依赖安装</title>
<style>
${THEME}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--mc-dark);
  color: var(--text);
  font-family: 'Inter', system-ui, 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  padding: 18px 20px;
  user-select: none;
}
h1 {
  font-family: 'Press Start 2P', 'Courier New', monospace;
  font-size: 13px;
  letter-spacing: 0.5px;
  color: var(--mc-grass);
  margin-bottom: 14px;
  text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);
}
.panel {
  background: var(--panel-bg);
  border: 2px solid #000;
  box-shadow: inset 2px 2px 0 0 var(--mc-border-light), inset -2px -2px 0 0 var(--mc-border-dark);
  padding: 14px;
  margin-bottom: 12px;
}
.phase {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Press Start 2P', 'Courier New', monospace;
  font-size: 10px;
  color: var(--mc-diamond);
  margin-bottom: 10px;
}
.phase .dot {
  width: 8px; height: 8px; background: var(--mc-diamond);
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink { 50% { opacity: 0.25; } }
.phase.done .dot { animation: none; background: var(--mc-grass); }
.phase.done { color: var(--mc-grass); }
.phase.error .dot { animation: none; background: var(--danger); }
.phase.error { color: var(--danger); }

.text { font-size: 12.5px; color: var(--text); word-break: break-all; min-height: 18px; }
.sub { font-size: 11.5px; color: var(--text-muted); margin-top: 6px; word-break: break-all; }

.bar-wrap {
  height: 22px;
  background: var(--mc-darker);
  border: 2px solid #000;
  box-shadow: inset 2px 2px 0 0 var(--mc-border-dark);
  margin: 12px 0 6px;
  position: relative;
  overflow: hidden;
}
.bar {
  height: 100%;
  width: 0%;
  background: repeating-linear-gradient(45deg, var(--mc-grass) 0 8px, var(--mc-grass-dark) 8px 16px);
  transition: width 0.18s linear;
}
.bar.indet {
  width: 100% !important;
  background: repeating-linear-gradient(45deg, var(--mc-grass) 0 8px, var(--mc-grass-dark) 8px 16px);
  animation: slide 0.7s linear infinite;
  background-size: 32px 100%;
  opacity: 0.55;
}
@keyframes slide { from { background-position: 0 0; } to { background-position: 32px 0; } }

.meta { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--text-muted); }
.meta b { color: var(--text); font-weight: 600; }
.speed { color: var(--mc-grass); font-weight: 600; }

.log {
  height: 76px; overflow: auto; margin-top: 10px;
  background: var(--mc-darker); border: 2px solid #000;
  padding: 8px 10px;
  font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.55;
  color: var(--text-muted); user-select: text;
}
.log div { white-space: pre-wrap; word-break: break-all; }
.log .ok { color: var(--mc-grass); }
.log .bad { color: var(--warn); }

.row { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
button {
  font-family: 'Inter', system-ui, 'Microsoft YaHei', sans-serif;
  font-size: 12.5px;
  color: var(--text);
  background: var(--mc-stone);
  border: 2px solid #000;
  border-radius: 0;
  padding: 8px 14px;
  cursor: pointer;
  box-shadow: inset 2px 2px 0 0 var(--mc-border-light), inset -2px -2px 0 0 var(--mc-border-dark);
}
button:hover:not(:disabled) { background: var(--mc-grass); }
button:active:not(:disabled) {
  box-shadow: inset -2px -2px 0 0 var(--mc-border-light), inset 2px 2px 0 0 var(--mc-border-dark);
}
button:disabled { color: #6a6a6a; background: var(--mc-stone-dark); cursor: not-allowed; }
button.primary { background: var(--mc-grass); }
button.primary:hover:not(:disabled) { background: var(--mc-grass-dark); }
</style>
</head>
<body>
  <h1>MATOGA 后端安装</h1>

  <div class="panel">
    <div class="phase" id="phase"><span class="dot"></span><span id="phaseText">准备中</span></div>
    <div class="text" id="text">正在初始化…</div>
    <div class="bar-wrap"><div class="bar" id="bar"></div></div>
    <div class="meta">
      <span id="bytes">0 B / —</span>
      <span class="speed" id="speed">0 B/s</span>
    </div>
    <div class="sub" id="source"></div>
    <div class="log" id="log"></div>
  </div>

  <div class="row">
    <button id="cancel">取消</button>
    <button id="manual" class="primary" style="display:none">手动下载</button>
  </div>

  <script>
    const $ = id => document.getElementById(id)
    const SPEED_LOG = 24
    let logs = []

    function renderLog(line, cls) {
      logs.push({ line, cls })
      if (logs.length > SPEED_LOG) logs = logs.slice(-SPEED_LOG)
      $('log').innerHTML = logs.map(l => '<div class="' + (l.cls || '') + '">' + escapeHtml(l.line) + '</div>').join('')
      $('log').scrollTop = $('log').scrollHeight
    }
    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
    }
    function fmt(n) {
      if (!isFinite(n) || n <= 0) return '0 B'
      const u = ['B','KB','MB','GB']; let v = n, i = 0
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
      return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
    }

    window.__installProgress.onEvent(evt => {
      if (!evt) return
      const phaseEl = $('phase')
      if (evt.kind === 'phase') {
        phaseEl.className = 'phase' + (evt.state === 'done' ? ' done' : evt.state === 'error' ? ' error' : '')
        $('phaseText').textContent = evt.title || ''
        const bar = $('bar')
        if (evt.state === 'done') { bar.classList.remove('indet'); bar.style.width = '100%' }
        else if (evt.indeterminate) { bar.classList.add('indet') }
        else { bar.classList.remove('indet') }
      } else if (evt.kind === 'progress') {
        const bar = $('bar')
        bar.classList.remove('indet')
        bar.style.width = (evt.percent != null ? evt.percent.toFixed(1) : '0') + '%'
        $('bytes').textContent = fmt(evt.received) + ' / ' + (evt.total ? fmt(evt.total) : '—')
        $('speed').textContent = fmt(evt.speed) + '/s'
        $('text').textContent = evt.text || ''
        $('source').textContent = evt.source ? '下载源：' + evt.source + ' · 线程 ' + evt.threads : ''
      } else if (evt.kind === 'log') {
        renderLog(evt.text || '', evt.level === 'ok' ? 'ok' : evt.level === 'warn' ? 'bad' : '')
      } else if (evt.kind === 'finish') {
        $('cancel').style.display = 'none'
        $('manual').style.display = evt.ok ? 'none' : 'inline-block'
        if (evt.ok) setTimeout(() => window.__installProgress.close(), 700)
      }
    })

    $('cancel').addEventListener('click', () => window.__installProgress.cancel())
    $('manual').addEventListener('click', () => window.__installProgress.manual())
  </script>
</body>
</html>`

/**
 * 创建进度窗。
 *
 * @param {BrowserWindow} [parentWindow]
 * @returns {{ win: BrowserWindow, push: (evt: object) => void, close: () => void,
 *            onCancel: (cb: () => void) => void, onManual: (cb: () => void) => void }}
 */
function createProgressWindow(parentWindow) {
  const win = new BrowserWindow({
    parent: parentWindow || undefined,
    modal: !!parentWindow,
    width: 620,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'matoga - 依赖安装',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, PROGRESS_PRELOAD),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const cancelCbs = []
  const manualCbs = []
  const onCancelCh = 'install-progress:cancel'
  const onManualCh = 'install-progress:manual'
  const onCloseCh = 'install-progress:close'

  const cancelHandler = () => cancelCbs.forEach(cb => cb())
  const manualHandler = () => manualCbs.forEach(cb => cb())
  // 完成后的自动关闭：只关窗，绝不当作「用户取消」。
  const closeHandler = () => {
    cleanup()
    if (!win.isDestroyed()) win.close()
  }
  ipcMain.on(onCancelCh, cancelHandler)
  ipcMain.on(onManualCh, manualHandler)
  ipcMain.on(onCloseCh, closeHandler)

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML))
  win.once('ready-to-show', () => win.show())

  const cleanup = () => {
    ipcMain.removeListener(onCancelCh, cancelHandler)
    ipcMain.removeListener(onManualCh, manualHandler)
    ipcMain.removeListener(onCloseCh, closeHandler)
  }

  return {
    win,
    push(evt) {
      if (win.isDestroyed()) return
      try {
        win.webContents.send('install-progress:event', evt)
      } catch {}
    },
    close() {
      cleanup()
      if (!win.isDestroyed()) win.close()
    },
    onCancel(cb) {
      cancelCbs.push(cb)
    },
    onManual(cb) {
      manualCbs.push(cb)
    }
  }
}

// 打开 Release 页，供用户手动下载后端二进制。
function openManualDownloadPage() {
  return shell.openExternal('https://github.com/xiongmiaozai/matoga/releases/latest')
}

module.exports = { createProgressWindow, openManualDownloadPage }
