/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Electron 主进程：以子进程方式启动 Express 本地服务，BrowserWindow 加载 localhost:5273。
 * server 在独立 Node 进程中运行，通过 stdout 通知实际监听端口，关闭时发 SIGTERM。
 */

const { app, BrowserWindow, shell, screen, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { promptDependencySetup, openManualInstallGuide } = require('./dependency-setup')
const { downloadBackend } = require('./install-backend')


let mainWindow = null
let serverProcess = null
let currentPort = null
const PREFERRED_PORT = 5273
const START_TIMEOUT_MS = 15000

async function configurePaths() {
  const projectRoot = path.join(__dirname, '..')
  const resRoot = app.isPackaged ? process.resourcesPath : projectRoot
  const dataRoot = app.getPath('userData')
  const presetRoot = app.isPackaged ? process.resourcesPath : projectRoot
  process.env.MATOGA_RES_ROOT = resRoot
  process.env.MATOGA_DATA_ROOT = dataRoot
  process.env.MATOGA_PRESET_ROOT = presetRoot
  return seedBuiltinData(resRoot, dataRoot)
}

async function seedBuiltinData(srcRoot, dataRoot) {
  const src = path.join(srcRoot, 'data')
  const dest = path.join(dataRoot, 'data')
  if (!fs.existsSync(dest) && fs.existsSync(src)) {
    await fs.promises.cp(src, dest, { recursive: true })
  }
}

/**
 * 解析 Go 后端二进制的路径。
 *
 * 候选顺序（先打包态、后开发态）：
 *   1. <resources>/matoga-backend(.exe)          打包后由 extraResources 放置
 *   2. <userData>/bin/matoga-backend(.exe)      自动安装下载的落盘位置
 *   3. <projectRoot>/backend/matoga-backend(.exe) 本地构建产物
 *   4. <projectRoot>/dist-go/matoga-backend(.exe) 构建脚本默认输出目录
 *
 * 返回存在的第一个路径；都不存在返回 null（调用方回退到 Node 服务）。
 */
function resolveGoBackend() {
  const exe = process.platform === 'win32' ? 'matoga-backend.exe' : 'matoga-backend'
  const roots = []
  if (app.isPackaged) roots.push(process.resourcesPath)
  roots.push(path.join(app.getPath('userData'), 'bin'))
  roots.push(path.join(__dirname, '..', 'backend'))
  roots.push(path.join(__dirname, '..', 'dist-go'))
  for (const r of roots) {
    const p = path.join(r, exe)
    try {
      if (fs.existsSync(p)) return p
    } catch { /* 忽略不可读目录 */ }
  }
  return null
}

/**
 * 确保 Go 后端可用：找不到时按场景处理。
 *
 * - 打包态：弹「依赖安装」窗让用户选择；自动安装勾选协议后从 Release 下载，
 *   下载成功返回二进制路径；失败弹错误后退出。用户取消也退出（无 Node 回退）。
 * - 开发态：不弹窗，返回 null，调用方回退到 Node 服务。
 *
 * @returns {Promise<string | null>} 后端二进制路径；null 表示回退 Node。
 */
async function ensureGoBackend() {
  const existing = resolveGoBackend()
  if (existing) return existing

  if (!app.isPackaged) return null

  const choice = await promptDependencySetup(null)
  if (choice === 'manual') {
    openManualInstallGuide()
    return null // 用户自装后本次退出；下次启动会重新检测。
  }
  if (choice === 'quit') {
    return null
  }

  // 自动安装：从 Release 下载，带进度提示。
  let lastPct = -1
  try {
    const bin = await downloadBackend((received, total) => {
      if (total) {
        const pct = Math.floor((received / total) * 100)
        if (pct >= lastPct + 10) {
          lastPct = pct
          console.log(`[main] 下载后端进度: ${pct}%`)
        }
      }
    })
    console.log('[main] 后端下载完成:', bin)
    return bin
  } catch (e) {
    console.error('[main] 后端下载失败:', e.message)
    dialog.showErrorBox(
      '后端下载失败',
      `自动下载后端失败：${e.message}\n\n你可重新启动后选择「自行安装」，或手动下载二进制放到应用数据目录的 bin/ 下。`
    )
    return null
  }
}

/**
 * 启动后端服务。
 *
 * 打包态下先 ensureGoBackend()：找不到 Go 会弹窗引导安装（不再静默回退 Node）。
 * 开发态下找不到 Go 则回退 Node 服务，避免开发机每台都要先构建二进制。
 *
 * 两种后端都按同一协议报告就绪：stdout 输出 `MATOGA_LISTENING:<port>`。
 */
async function startServer() {
  const goBin = await ensureGoBackend()
  if (goBin) {
    console.log('[main] 启动 Go 后端:', goBin)
    return startWithError(goBin, ['-port', String(PREFERRED_PORT)], {
      ...process.env,
      MATOGA_SPAWNED: '1'
    }).catch((e) => {
      console.error('[main] Go 后端启动失败，回退到 Node:', e.message)
      return startNodeServer()
    })
  }
  if (app.isPackaged) {
    // 打包态下用户未完成安装：不再回退 Node，直接退出，下次启动重新引导。
    throw new Error('后端未安装')
  }
  console.log('[main] 未找到 Go 后端，使用 Node 服务')
  return startNodeServer()
}

// 启动 Node 服务（原有实现，作为 Go 不可用时的回退路径）。
function startNodeServer() {
  const serverEntry = path.join(__dirname, '..', 'server', 'index.js')
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    MATOGA_SPAWNED: '1'
  }
  return startWithError(process.execPath, [serverEntry, '--port', String(PREFERRED_PORT)], env)
}

/**
 * 通用启动器：spawn 子进程并等待 MATOGA_LISTENING 就绪行。
 *
 * @param {string} cmd 可执行文件
 * @param {string[]} args 参数
 * @param {object} env 环境变量
 */
function startWithError(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    serverProcess = child

    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error('server start timeout'))
      }
    }, START_TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        if (line.startsWith('MATOGA_LISTENING:')) {
          const port = parseInt(line.slice('MATOGA_LISTENING:'.length).trim(), 10)
          if (!resolved && Number.isInteger(port)) {
            resolved = true
            clearTimeout(timeout)
            resolve(port)
          }
        }
      }
    })

    child.stderr.on('data', (data) => {
      console.error('[server]', data.toString().trim())
    })

    child.on('error', (e) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(e)
      }
    })

    child.on('exit', (code) => {
      serverProcess = null
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`server exited with code ${code}`))
      }
    })
  })
}

async function createWindow(port) {
  const savedBounds = await loadWindowBounds()
  mainWindow = new BrowserWindow({
    width: savedBounds?.width || 1600,
    height: savedBounds?.height || 1000,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 768,
    minHeight: 500,
    title: 'matoga - 材质贴图对比工具',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (savedBounds?.maximized) {
    mainWindow.maximize()
  }

  mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  if (!app.isPackaged || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${port}`)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('resize', debounceSaveWindowBounds)
  mainWindow.on('move', debounceSaveWindowBounds)
  mainWindow.on('maximize', () => saveWindowBounds(true))
  mainWindow.on('unmaximize', () => saveWindowBounds(false))
}

function getWindowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

async function loadWindowBounds() {
  try {
    const file = getWindowStateFile()
    const data = JSON.parse(await fs.promises.readFile(file, 'utf-8'))
    if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
    if (typeof data.x !== 'number' || typeof data.y !== 'number') return null
    const display = screen.getPrimaryDisplay()
    const workArea = display.workArea
    if (data.x + data.width < 0 || data.x > workArea.width || data.y + data.height < 0 || data.y > workArea.height) {
      return null
    }
    return data
  } catch {
    return null
  }
}

async function saveWindowBounds(maximized) {
  if (!mainWindow) return
  try {
    const bounds = mainWindow.getBounds()
    const state = {
      ...bounds,
      maximized: maximized !== undefined ? maximized : mainWindow.isMaximized()
    }
    await fs.promises.writeFile(getWindowStateFile(), JSON.stringify(state))
  } catch {}
}

let boundsTimer = null
function debounceSaveWindowBounds() {
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => saveWindowBounds(), 500)
}

app.whenReady().then(async () => {
  // configurePaths 同步设置 env 并返回 seed promise；seed 与 server 启动并行，
  // server 启动（子进程）通常更慢，seed 在等待期间完成，不增加总启动时间。
  const seedPromise = configurePaths()
  try {
    currentPort = await startServer()
  } catch (e) {
    console.error('[matoga] server start failed:', e.message)
    app.quit()
    return
  }
  await seedPromise
  await createWindow(currentPort)
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (!serverProcess) {
      try {
        currentPort = await startServer()
      } catch (e) {
        console.error('[matoga] server restart failed:', e.message)
        app.quit()
        return
      }
    }
    await createWindow(currentPort)
  }
})

function shutdown() {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM') } catch {}
    serverProcess = null
  }
}

app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', shutdown)