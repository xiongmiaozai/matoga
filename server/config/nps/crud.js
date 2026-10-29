/**
 * matoga - 节点项目存储：项目读写
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-project-store.js 按职责搬出，逻辑未改。
 */
const fs = require('fs'), path = require('path')
const { DIR, FORMAT, VERSION, MAX_NAME, MAX_THUMB_BYTES, ID_RE } = require('./consts')
const { atomicWrite, sanitizeName, safeTextureName, decodeDataUrl, projectDir, projectFile, newId, enqueue } = require('./fs-utils')
const { readProjectMeta, exists, sanitizeGraph, sanitizeTextures } = require('./meta')
const { logger } = require('../../middleware/logger')
const { AppError } = require('../../lib/errors')

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
    // 加载工程后 props.tex 是工程内 /api/file/raw URL，再次保存时该贴图的 sourcePath 会指向
    // 当前 texDir；若先 rmSync(texDir) 再 copyFile 会因源文件已删而失败，导致贴图丢失。
    // 故 rmSync 前把指向 texDir 内的 file source 读入内存转为 embedded。
    for (const t of cleanTextures) {
      if (t.source === 'file' && t.sourcePath) {
        const sp = path.normalize(t.sourcePath)
        const td = path.normalize(texDir)
        if (sp === td || sp.startsWith(td + path.sep)) {
          try {
            t.buf = await fs.promises.readFile(sp)
            t.source = 'embedded'
            delete t.sourcePath
          } catch (e) { logger.warn('node-projects', 'in-project texture read failed: ' + e.message) }
        }
      }
    }

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

  enqueue(run)
  const finalIdOut = await enqueue(run)
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
  return enqueue(run)
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
  enqueue(run)
  return enqueue(run).then(() => ({ id, name: cleanName }))
}

function thumbPath(id) {
  if (!ID_RE.test(id)) throw new AppError('ERR_INVALID_PARAM', 'bad id')
  return path.join(projectDir(id), 'thumbnail.png')
}

module.exports = { save, load, remove, rename, thumbPath }
