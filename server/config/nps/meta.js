/**
 * matoga - 节点项目存储：元信息读取与净化
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-project-store.js 按职责搬出，逻辑未改。
 */
const fs = require('fs'), path = require('path')
const { DIR, MAX_PROJECTS, ID_RE, FORMAT } = require('./consts')
const { projectDir, projectFile, decodeDataUrl } = require('./fs-utils')

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

module.exports = { readProjectMeta, list, exists, sanitizeGraph, sanitizeTextures }
