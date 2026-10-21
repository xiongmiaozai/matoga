/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Electron 主进程：启动现有 Express 本地服务，BrowserWindow 加载 localhost:5273。
 * 前端 web/ 与后端 server/ 完全复用，不引入 ipc 通道。
 */

const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const http = require('http')
const net = require('net')

let mainWindow = null
let server = null
let wss = null
const PREFERRED_PORT = 5273
const MAX_ATTEMPTS = 10

function configurePaths() {
  const projectRoot = path.join(__dirname, '..')
  const resRoot = app.isPackaged ? process.resourcesPath : projectRoot
  const dataRoot = app.getPath('userData')
  const presetRoot = app.isPackaged ? process.resourcesPath : projectRoot
  process.env.MATOGA_RES_ROOT = resRoot
  process.env.MATOGA_DATA_ROOT = dataRoot
  process.env.MATOGA_PRESET_ROOT = presetRoot
}

function listen(server, port, attempt) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && attempt < MAX_ATTEMPTS) {
        resolve(listen(server, port + 1, attempt + 1))
      } else {
        reject(e)
      }
    })
    server.listen(port, '127.0.0.1', () => resolve(port))
  })
}

async function startServer() {
  const { createApp } = require('../server/app')
  const wsSetup = require('../server/ws')
  const uploadService = require('../server/services/upload-service')
  const { logger } = require('../server/middleware/logger')
  uploadService.cleanup()
  server = http.createServer(createApp())
  const port = await listen(server, PREFERRED_PORT, 0)
  wss = wsSetup.setup(server)
  logger.info('electron', `local server on http://127.0.0.1:${port}`)
  return port
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 760,
    title: 'matoga - 材质贴图对比工具',
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
  if (!server && !wss) return
  const { gracefulShutdown } = require('../server/shutdown')
  gracefulShutdown({ server, wss, exit: false })
  server = null
  wss = null
}

app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', shutdown)