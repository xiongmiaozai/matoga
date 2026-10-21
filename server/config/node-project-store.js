/**
 * matoga - 节点项目管理存储
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 默认储存位置：data/node-projects/
 * 特殊保存格式：每个项目是一个 <id>.mtgp/ 文件夹：
 *   <id>.mtgp/
 *     project.json    工程（meta + 使用节点数据 graph，贴图以 @tex/<file> 引用）
 *     thumbnail.png   资产图（画布合成缩略图）
 *     textures/       使用贴图（打包副本，保证工程自包含）
 * 原子写入 + 串行化队列，与 asset-store 一致。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { logger } = require('../middleware/logger')
const { DATA_ROOT } = require('../paths')

const DIR = path.join(DATA_ROOT, 'data', 'node-projects')
const FORMAT = 'matoga-node-project'
const VERSION = 1
const MAX_NAME = 100
const MAX_PROJECTS = 500
const MAX_THUMB_BYTES = 4 * 1024 * 1024
const MAX_TEXTURE_BYTES = 24 * 1024 * 1024

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const IMG_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|svg|ico)$/i

let writeQueue = Promise.resolve()

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

function sanitizeName(name) {
  if (typeof name !== 'string') return null
  const s = name.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ')
  if (!s || s === '.' || s === '..' || s.length > MAX_NAME) return null
  return s
}

function safeTextureName(name, i) {
  const base = typeof name === 'string' && name.trim()
    ? name.trim().replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 64)
    : ''
  const ext = base && IMG_EXT_RE.test(base) ? '' : '.png'
  const safe = base || ('texture_' + i)
  return i + '-' + safe + ext
}

function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null
  const m = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length || buf.length > MAX_TEXTURE_BYTES) return null
  return { mime: m[1], buf }
}

function projectDir(id) {
  return path.join(DIR, id + '.mtgp')
}

function projectFile(id) {
  return path.join(projectDir(id), 'project.json')
}

function newId() {
  return 'p' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
}

function readProjectMeta(id) {
  try {
    const raw = JSON.parse(fs.readFileSync(projectFile(id), 'utf8'))
    if (raw && raw.format === FORMAT && raw.meta && Array.isArray(raw.graph && raw.graph.nodes)) {
      return {
        id,
        name: typeof raw.meta.name === 'string' ? raw.meta.name : id,
        createdAt: raw.meta.createdAt || 0,
        updatedAt: raw.meta.updatedAt || 0,
        nodeCount: Array.isArray(raw.graph.nodes) ? raw.graph.nodes.length : 0,
        edgeCount: Array.isArray(raw.graph.links) ? raw.graph.links.length : 0,
        textureCount: Array.isArray(raw.textures) ? raw.textures.length : 0,
        hasThumb: fs.existsSync(path.join(projectDir(id), 'thumbnail.png')),
        dir: projectDir(id),
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') logger.warn('node-projects', 'bad project ' + id + ': ' + e.message)
  }
  return null
}

function list() {
  fs.mkdirSync(DIR, { recursive: true })
  const out = []
  let entries
  try { entries = fs.readdirSync(DIR, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.endsWith('.mtgp')) continue
    const id = e.name.slice(0, -5)
    if (!ID_RE.test(id)) continue
    const meta = readProjectMeta(id)
    if (meta) out.push(meta)
    if (out.length >= MAX_PROJECTS) break
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return out
}

function exists(id) {
  return ID_RE.test(id) && fs.existsSync(projectDir(id))
}

function sanitizeGraph(graph) {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes)) return null
  return {
    nodes: graph.nodes,
    links: Array.isArray(graph.links) ? graph.links : (Array.isArray(graph.edges) ? graph.edges : []),
  }
}

function sanitizeTextures(items) {
  if (!Array.isArray(items)) return []
  const out = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    if (it.dataUrl !== undefined && it.dataUrl !== null) {
      const d = decodeDataUrl(it.dataUrl)
      if (d) out.push({ name: it.name, mime: d.mime, buf: d.buf, source: 'embedded' })
    } else if (typeof it.path === 'string' && path.isAbsolute(path.normalize(it.path))) {
      out.push({ name: it.name, sourcePath: path.normalize(it.path), source: 'file' })
    }
    if (out.length >= 64) break
  }
  return out
}

async function save({ id, name, graph, thumbnail, textures }) {
  const cleanName = sanitizeName(name)
  const cleanGraph = sanitizeGraph(graph)
  if (!cleanName) { const e = new Error('invalid project name'); e.code = 'ERR_INVALID_PARAM'; throw e }
  if (!cleanGraph) { const e = new Error('invalid graph'); e.code = 'ERR_INVALID_PARAM'; throw e }

  const isUpdate = id !== undefined && id !== null && id !== ''
  if (isUpdate && !ID_RE.test(id)) { const e = new Error('invalid project id'); e.code = 'ERR_INVALID_PARAM'; throw e }
  if (isUpdate && !exists(id)) { const e = new Error('project not found'); e.code = 'ERR_NOT_FOUND'; throw e }

  const finalId = isUpdate ? id : newId()
  const dir = projectDir(finalId)
  const texDir = path.join(dir, 'textures')
  const prev = isUpdate ? readProjectMeta(finalId) : null
  const now = Date.now()

  const cleanTextures = sanitizeTextures(textures)

  const run = async () => {
    fs.rmSync(texDir, { recursive: true, force: true })
    fs.mkdirSync(texDir, { recursive: true })

    const texMeta = []
    for (let i = 0; i < cleanTextures.length; i++) {
      const t = cleanTextures[i]
      const file = safeTextureName(t.name, i)
      const dest = path.join(texDir, file)
      if (t.source === 'file') {
        try {
          await fs.promises.copyFile(t.sourcePath, dest)
          texMeta.push({ file, name: t.name || file, source: t.sourcePath })
        } catch (e) {
          logger.warn('node-projects', 'copy texture failed: ' + e.message)
        }
      } else {
        fs.writeFileSync(dest, t.buf)
        texMeta.push({ file, name: t.name || file, source: 'embedded' })
      }
    }

    if (typeof thumbnail === 'string') {
      const d = decodeDataUrl(thumbnail)
      if (d && d.buf.length <= MAX_THUMB_BYTES) {
        fs.writeFileSync(path.join(dir, 'thumbnail.png'), d.buf)
      }
    }

    const doc = {
      format: FORMAT,
      version: VERSION,
      meta: {
        id: finalId,
        name: cleanName,
        createdAt: (prev && prev.createdAt) || now,
        updatedAt: now,
        nodeCount: cleanGraph.nodes.length,
        edgeCount: cleanGraph.links.length,
        textureCount: texMeta.length,
      },
      graph: cleanGraph,
      textures: texMeta,
    }
    atomicWrite(projectFile(finalId), JSON.stringify(doc, null, 2))
    return finalId
  }

  writeQueue = writeQueue.then(run, run)
  const finalIdOut = await writeQueue
  return finalIdOut
}

function load(id) {
  if (!ID_RE.test(id) || !exists(id)) {
    const e = new Error('project not found'); e.code = 'ERR_NOT_FOUND'; throw e
  }
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(projectFile(id), 'utf8'))
  } catch (e) {
    const err = new Error('bad project file: ' + e.message); err.code = 'ERR_UNKNOWN'; throw err
  }
  if (!doc || doc.format !== FORMAT || !doc.meta || !doc.graph) {
    const e = new Error('bad project file'); e.code = 'ERR_UNKNOWN'; throw e
  }
  const texDir = path.join(projectDir(id), 'textures')
  const textures = (Array.isArray(doc.textures) ? doc.textures : [])
    .filter(t => t && typeof t.file === 'string')
    .map(t => {
      const fullPath = path.join(texDir, t.file)
      let size = 0
      try { size = fs.statSync(fullPath).size } catch {}
      return { file: t.file, name: t.name || t.file, source: t.source || null, fullPath, size, exists: size > 0 }
    })
  return {
    id,
    name: doc.meta.name || id,
    createdAt: doc.meta.createdAt || 0,
    updatedAt: doc.meta.updatedAt || 0,
    graph: doc.graph,
    textures,
    hasThumb: fs.existsSync(path.join(projectDir(id), 'thumbnail.png')),
    dir: projectDir(id),
  }
}

function remove(id) {
  if (!ID_RE.test(id) || !exists(id)) {
    const e = new Error('project not found'); e.code = 'ERR_NOT_FOUND'; throw e
  }
  const dir = projectDir(id)
  const run = () => { fs.rmSync(dir, { recursive: true, force: true }) }
  writeQueue = writeQueue.then(run, run)
  return writeQueue
}

function rename(id, name) {
  const cleanName = sanitizeName(name)
  if (!cleanName) { const e = new Error('invalid project name'); e.code = 'ERR_INVALID_PARAM'; throw e }
  const doc = load(id)
  const run = () => {
    const file = projectFile(id)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    raw.meta = raw.meta || {}
    raw.meta.name = cleanName
    raw.meta.updatedAt = Date.now()
    atomicWrite(file, JSON.stringify(raw, null, 2))
  }
  writeQueue = writeQueue.then(run, run)
  return writeQueue.then(() => ({ id, name: cleanName }))
}

function thumbPath(id) {
  return path.join(projectDir(id), 'thumbnail.png')
}

module.exports = {
  DIR, FORMAT, VERSION,
  list, save, load, remove, rename, exists, thumbPath,
  sanitizeName, projectDir,
}