/**
 * matoga - 资源包元数据：包内贴图浏览与读取
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const { statPack } = require('./shared')

const fs = require('fs')
const path = require('path')
const { AppError } = require('../../lib/errors')
const { resolveDirPack, walkDirTextures, zipTextureEntries } = require('./analyze')
const { parseZipCentralDirectory } = require('./zip')

/* ── 包内贴图：分类浏览与读取 ─────────────────── */

const TEX_PAGE_DEFAULT = 120

const TEX_PAGE_MAX = 400

/* 浏览目录：assets/<ns>/textures[/<子目录>…] 形态，禁止穿越 */

/* 浏览目录：assets/<ns>/textures[/<子目录>…] 形态，禁止穿越 */
function assertBrowseDir(dir) {
  if (typeof dir !== 'string' || !dir) return null
  if (dir.startsWith('/') || dir.endsWith('/') || dir.includes('\\') || dir.includes('..') || dir.includes('\0')) {
    throw new AppError('ERR_INVALID_PARAM', 'invalid browse dir')
  }
  const m = /^assets\/([^/]+)(\/textures(\/[^/]+)*)?$/.exec(dir)
  if (!m) throw new AppError('ERR_INVALID_PARAM', 'browse dir must be under assets/<ns>/textures')
  if (m[2]) return dir
  return null // assets/<ns> 本身不是浏览层
}

function parseTexPath(p) {
  const m = /^assets\/([^/]+)\/textures\/(.+)$/.exec(p)
  return m ? { ns: m[1], rest: m[2] } : null
}

function parentBrowseDir(dir) {
  const seg = dir.split('/')
  const up = seg.slice(0, -1).join('/')
  // assets/<ns>/textures 的上级 → 回根（类别）视图
  return /^assets\/[^/]+\/textures$/.test(up) ? null : up
}

async function listPackTextures(root, name, opts = {}) {
  const st = await statPack(root, name)
  const full = path.join(root, name)
  let kind = 'dir'
  let texs = []
  if (st.isDirectory()) {
    const r = await resolveDirPack(full)
    texs = await walkDirTextures(r ? r.root : full)
  } else {
    kind = 'zip'
    const buf = await fs.promises.readFile(full)
    texs = zipTextureEntries(parseZipCentralDirectory(buf))
  }
  const total = texs.length

  const dir = assertBrowseDir(opts.dir)
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0)
  const limit = Math.min(TEX_PAGE_MAX, Math.max(1, parseInt(opts.limit, 10) || TEX_PAGE_DEFAULT))

  /* 命名空间与类别（textures/ 第一级目录，跨 ns 去重合并） */
  const namespaces = [...new Set(texs.map(t => { const p = parseTexPath(t.path); return p && p.ns }).filter(Boolean))]
  const catMap = new Map()
  for (const t of texs) {
    const p = parseTexPath(t.path)
    if (!p) continue
    const seg = p.rest.split('/')
    if (seg.length >= 2) {
      const key = p.ns + '/' + seg[0]
      const c = catMap.get(key) || { name: seg[0], dir: `assets/${p.ns}/textures/${seg[0]}`, count: 0 }
      c.count++
      catMap.set(key, c)
    }
  }
  const categories = [...catMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  let parent = null
  let dirs = []
  let files = []
  let filesTotal = 0
  let breadcrumbs = [{ name: 'root', dir: null }]
  if (dir) {
    parent = parentBrowseDir(dir)
    const sub = new Map()
    const fl = []
    for (const t of texs) {
      if (!t.path.startsWith(dir + '/')) continue
      const rest = t.path.slice(dir.length + 1)
      const seg = rest.split('/')
      if (seg.length >= 2) {
        const d = sub.get(seg[0]) || { name: seg[0], dir: dir + '/' + seg[0], count: 0 }
        d.count++
        sub.set(seg[0], d)
      } else {
        fl.push({ path: t.path, name: seg[0], size: t.size || 0 })
      }
    }
    dirs = [...sub.values()].sort((a, b) => a.name.localeCompare(b.name))
    fl.sort((a, b) => a.name.localeCompare(b.name))
    filesTotal = fl.length
    files = fl.slice(offset, offset + limit)
    // 面包屑：block › doors（root + textures/ 下每级目录；assets/<ns>/textures 层并入根）
    const dirSegs = dir.split('/')
    dirSegs.forEach((s, i) => {
      if (i < 3) return // assets / <ns> / textures
      breadcrumbs.push({ name: s, dir: dirSegs.slice(0, i + 1).join('/') })
    })
  } else {
    // 根视图：全部贴图平铺分页
    const fl = texs
      .map(t => ({ path: t.path, name: t.path.split('/').pop(), size: t.size || 0 }))
      .sort((a, b) => a.path.localeCompare(b.path))
    filesTotal = total
    files = fl.slice(offset, offset + limit)
  }

  return { name, kind, dir, parent, namespaces, categories, dirs, breadcrumbs, files, filesTotal, total, offset, limit }
}

/* ── 总资产库贴图聚合：包内全部贴图按类别（textures/ 第一级目录）分组，无分页 ── */

/* 目录包补齐 size / mtime（分批 stat，避免大包一次性打满线程池） */

module.exports = { TEX_PAGE_DEFAULT, TEX_PAGE_MAX, assertBrowseDir, parseTexPath, parentBrowseDir, listPackTextures }
