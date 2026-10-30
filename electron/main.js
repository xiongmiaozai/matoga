/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Electron 主进程：以子进程方式启动 Express 本地服务，BrowserWindow 加载 localhost:5273。
 * server 在独立 Node 进程中运行，通过 stdout 通知实际监听端口，关闭时发 SIGTERM。
 */

const { app, BrowserWindow, shell, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')


let mainWindow = null
let serverProcess = null
let currentPort = null
const PREFERRED_PORT = 5273
const START_TIMEOUT_MS = 15000

function configurePaths() {
  const projectRoot = path.join(__dirname, '..')
  const resRoot = app.isPackaged ? process.resourcesPath : projectRoot
  const dataRoot = app.getPath('userData')
  const presetRoot = app.isPackaged ? process.resourcesPath : projectRoot
  process.env.MATOGA_RES_ROOT = resRoot
  process.env.MATOGA_DATA_ROOT = dataRoot
  process.env.MATOGA_PRESET_ROOT = presetRoot
  seedBuiltinData(resRoot, dataRoot)
}

function seedBuiltinData(srcRoot, dataRoot) {
  const src = path.join(srcRoot, 'data')
  const dest = path.join(dataRoot, 'data')
  if (!fs.existsSync(dest) && fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true })
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, '..', 'server', 'index.js')
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MATOGA_SPAWNED: '1'
    }
    const child = spawn(process.execPath, [serverEntry, '--port', String(PREFERRED_PORT)], {
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

function createWindow(port) {
  const savedBounds = loadWindowBounds()
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

function loadWindowBounds() {
  try {
    const file = getWindowStateFile()
    if (!fs.existsSync(file)) return null
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
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

function saveWindowBounds(maximized) {
  if (!mainWindow) return
  try {
    const bounds = mainWindow.getBounds()
    const state = {
      ...bounds,
      maximized: maximized !== undefined ? maximized : mainWindow.isMaximized()
    }
    fs.writeFileSync(getWindowStateFile(), JSON.stringify(state))
  } catch {}
}

let boundsTimer = null
function debounceSaveWindowBounds() {
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => saveWindowBounds(), 500)
}

app.whenReady().then(async () => {
  configurePaths()
  try {
    currentPort = await startServer()
  } catch (e) {
    console.error('[matoga] server start failed:', e.message)
    app.quit()
    return
  }
  createWindow(currentPort)
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
    createWindow(currentPort)
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