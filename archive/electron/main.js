/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

let mainWindow = null

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch { return {} }
}

function saveConfig(c) {
  try { fs.writeFileSync(configPath(), JSON.stringify(c)) } catch {}
}

function defaultPaths() {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return {
    hdriPresetPath: path.join(base, 'hdri-presets'),
    mcPacksPath: path.join(base, 'mc-packs')
  }
}

function ensureDefaultPaths() {
  for (const p of Object.values(defaultPaths())) {
    try { fs.mkdirSync(p, { recursive: true }) } catch {}
  }
}

function createWindow() {
  const cfg = loadConfig()
  const bounds = cfg.windowBounds || {}
  mainWindow = new BrowserWindow({
    width: bounds.width > 1600 ? bounds.width : 1600,
    height: bounds.height > 1000 ? bounds.height : 1000,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1180,
    minHeight: 760,
    title: '材质贴图对比工具',
    backgroundColor: '#f1f3f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  let saveTimer = null
  const saveBounds = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!mainWindow) return
      const c = loadConfig()
      c.windowBounds = mainWindow.getBounds()
      saveConfig(c)
    }, 500)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`)
  })
  mainWindow.loadFile('electron.html')
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  ensureDefaultPaths()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('dialog:selectFolder', async (event, side) => {
  const cfg = loadConfig()
  const defaultPath = cfg[side + 'Path'] || cfg.lastPath || undefined
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const p = result.filePaths[0]
  cfg[side + 'Path'] = p
  cfg.lastPath = p
  saveConfig(cfg)
  return p
})


function shouldIgnore(name, patterns) {
  if (!patterns || !patterns.length) return false
  const lower = name.toLowerCase()
  for (const p of patterns) {
    if (p.startsWith('*.')) { if (lower.endsWith(p.slice(1).toLowerCase())) return true }
    else if (p.includes('*')) { if (new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i').test(name)) return true }
    else if (lower === p.toLowerCase()) return true
  }
  return false
}

async function readEntriesAsync(folderPath, ignorePatterns) {
  const names = await fs.promises.readdir(folderPath)
  const entries = []
  for (const name of names) {
    if (shouldIgnore(name, ignorePatterns)) continue
    const fullPath = path.join(folderPath, name)
    try {
      const stat = await fs.promises.stat(fullPath)
      entries.push({
        name, fullPath,
        isDirectory: stat.isDirectory(),
        size: stat.isDirectory() ? 0 : stat.size,
        mtime: stat.mtimeMs
      })
    } catch (e) {
      entries.push({ name, fullPath, isDirectory: false, size: 0, mtime: 0, error: true })
    }
  }
  return entries
}

async function readRecursiveAsync(folderPath, ignorePatterns) {
  const result = []
  async function walk(dir, relBase) {
    let names
    try { names = await fs.promises.readdir(dir) } catch { return }
    for (const name of names) {
      if (shouldIgnore(name, ignorePatterns)) continue
      const fullPath = path.join(dir, name)
      const rel = relBase ? relBase + '/' + name : name
      try {
        const stat = await fs.promises.stat(fullPath)
        result.push({
          name: rel, baseName: name, fullPath,
          isDirectory: stat.isDirectory(),
          size: stat.isDirectory() ? 0 : stat.size,
          mtime: stat.mtimeMs
        })
        if (stat.isDirectory()) await walk(fullPath, rel)
      } catch (e) {
        result.push({ name: rel, baseName: name, fullPath, isDirectory: false, size: 0, mtime: 0, error: true })
      }
    }
  }
  await walk(folderPath, '')
  return result
}

ipcMain.handle('folder:readEntries', async (e, p, ignore) => {
  try { return { success: true, entries: await readEntriesAsync(p, ignore) } }
  catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('folder:readRecursive', async (e, p, ignore) => {
  try { return { success: true, entries: await readRecursiveAsync(p, ignore) } }
  catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('file:hash', async (e, p) => {
  return new Promise((resolve) => {
    const hash = crypto.createHash('md5')
    const stream = fs.createReadStream(p)
    stream.on('data', d => hash.update(d))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', () => resolve(null))
  })
})

ipcMain.handle('shell:openPath', (e, p) => shell.openPath(p))
ipcMain.handle('shell:showInFolder', (e, p) => shell.showItemInFolder(p))
ipcMain.handle('config:get', () => {
  const cfg = loadConfig()
  const dp = defaultPaths()
  if (!cfg.hdriPresetPath) cfg.hdriPresetPath = dp.hdriPresetPath
  if (!cfg.mcPacksPath) cfg.mcPacksPath = dp.mcPacksPath
  return cfg
})
ipcMain.handle('config:set', (e, patch) => {
  const cfg = loadConfig()
  Object.assign(cfg, patch)
  saveConfig(cfg)
})
ipcMain.handle('config:clear', () => { saveConfig({}) })

ipcMain.handle('dialog:selectFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'avif'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:selectHDR', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'HDR 环境贴图', extensions: ['hdr', 'exr'] }, { name: '所有文件', extensions: ['*'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:pickFolder', async () => {
  const cfg = loadConfig()
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: cfg.lastPath || undefined
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('folder:create', async (e, p) => {
  try {
    await fs.promises.mkdir(p, { recursive: true })
    return { success: true }
  } catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('file:copy', async (e, src, dest) => {
  try {
    const dir = path.dirname(dest)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.copyFile(src, dest)
    return { success: true }
  } catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('file:delete', async (e, p) => {
  try { await fs.promises.unlink(p); return { success: true } }
  catch (err) { return { success: false, error: err.message } }
})

ipcMain.handle('file:backup', async (e, filePath) => {
  try {
    const dir = path.dirname(filePath)
    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext)
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = path.join(dir, `${base}_backup_${ts}${ext}`)
    await fs.promises.copyFile(filePath, backupPath)
    return { success: true, backupPath }
  } catch (err) { return { success: false, error: err.message } }
})
function hdriThumbDir() {
  return path.join(app.getPath('userData'), 'hdri-thumbs')
}

function hdriThumbPathFor(filePath) {
  const base = path.basename(filePath, path.extname(filePath))
  return path.join(hdriThumbDir(), base + '.jpg')
}

ipcMain.handle('hdri:list', async () => {
  try {
    const cfg = loadConfig()
    const dp = defaultPaths()
    const dir = cfg.hdriPresetPath || dp.hdriPresetPath
    const names = await fs.promises.readdir(dir)
    const entries = []
    for (const name of names) {
      const ext = path.extname(name).toLowerCase()
      if (ext !== '.hdr' && ext !== '.exr') continue
      const fullPath = path.join(dir, name)
      try {
        const stat = await fs.promises.stat(fullPath)
        if (stat.isFile()) entries.push({ name, fullPath, size: stat.size, mtime: stat.mtimeMs })
      } catch {}
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    return { success: true, dir, entries }
  } catch (err) { return { success: false, error: err.message, entries: [] } }
})

ipcMain.handle('hdri:thumbInfo', async (e, fullPath) => {
  try {
    const thumbPath = hdriThumbPathFor(fullPath)
    const hdrStat = await fs.promises.stat(fullPath)
    let exists = false, stale = true, mtime = 0
    try {
      const tStat = await fs.promises.stat(thumbPath)
      exists = true
      mtime = tStat.mtimeMs
      stale = tStat.mtimeMs < hdrStat.mtimeMs
    } catch {}
    const thumbUrl = 'file://' + thumbPath.replace(/\\/g, '/')
    return { exists, stale, thumbUrl, mtime }
  } catch (err) { return { exists: false, stale: true, thumbUrl: null, error: err.message } }
})

ipcMain.handle('hdri:saveThumb', async (e, fullPath, dataUrl) => {
  try {
    const dir = hdriThumbDir()
    await fs.promises.mkdir(dir, { recursive: true })
    const thumbPath = hdriThumbPathFor(fullPath)
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    await fs.promises.writeFile(thumbPath, Buffer.from(base64, 'base64'))
    const thumbUrl = 'file://' + thumbPath.replace(/\\/g, '/')
    return { success: true, thumbUrl }
  } catch (err) { return { success: false, error: err.message } }
})