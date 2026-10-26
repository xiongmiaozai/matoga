/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Electron 主进程：以子进程方式启动 Express 本地服务，BrowserWindow 加载 localhost:5273。
 * server 在独立 Node 进程中运行，通过 stdout 通知实际监听端口，关闭时发 SIGTERM。
 */

const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')


let mainWindow = null
let serverProcess = null
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
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`server exited with code ${code}`))
      }
    })
  })
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 760,
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
}

app.whenReady().then(async () => {
  configurePaths()
  let port
  try {
    port = await startServer()
  } catch (e) {
    console.error('[matoga] server start failed:', e.message)
    app.quit()
    return
  }
  createWindow(port)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port)
  })
})

function shutdown() {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM') } catch {}
    serverProcess = null
  }
}

app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', shutdown)