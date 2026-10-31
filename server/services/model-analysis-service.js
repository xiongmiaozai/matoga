/**
 * matoga - 模型多维度分析服务
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 在 mcmeta-service.listPackModelGroups 基础上为每个模型文件附加元数据：
 *   ns        命名空间（assets/<ns>/...）
 *   format    模型格式：json / bbmodel / custom
 *   texRefs   引用的贴图数量（解析 textures 对象去重计数）
 *   animated  是否动画模型（bbmodel 含 animations 数组 / json 含 animation 字段）
 * 并提供多包交叉对比：对一组包按模型相对路径聚合，标注每个包中是否存在及大小差异。
 */

const fs = require('fs')
const path = require('path')

const mcmeta = require('./mcmeta-service')
const { AppError } = require('../lib/errors')

const BBMODEL_EXT_RE = /\.bbmodel$/i

/* 解析模型 JSON / bbmodel 文本，提取贴图引用数与动画标记 */
function parseModelMeta(text, format) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return { texRefs: 0, animated: false }
  }
  let texRefs = 0
  if (raw && typeof raw.textures === 'object' && !Array.isArray(raw.textures)) {
    const refs = new Set()
    for (const v of Object.values(raw.textures)) {
      if (typeof v === 'string' && v) refs.add(v)
    }
    texRefs = refs.size
  }
  let animated = false
  if (format === 'bbmodel') {
    animated = Array.isArray(raw && raw.animations) && raw.animations.length > 0
  } else {
    animated = !!(raw && raw.animation && typeof raw.animation === 'object')
  }
  return { texRefs, animated }
}

/* 贴图引用数分桶：0 / 1 / 2-4 / 5+ */
function texCountBucket(n) {
  if (n <= 0) return '0'
  if (n === 1) return '1'
  if (n <= 4) return '2-4'
  return '5+'
}

/* 从模型路径提取命名空间 */
function nsOfPath(p) {
  const m = /^assets\/([^/]+)\//.exec(p)
  return m ? m[1] : ''
}

/* 从模型路径 / 自定义键提取格式 */
function formatOfPath(p) {
  if (typeof p !== 'string') return 'json'
  if (p.startsWith('bb:') || BBMODEL_EXT_RE.test(p)) return 'bbmodel'
  if (p.startsWith('cm:')) return 'custom'
  return 'json'
}

/* 读取目录包内单个模型文件文本 */
async function readDirModelText(packRoot, rel) {
  try {
    return await fs.promises.readFile(path.join(packRoot, rel), 'utf8')
  } catch {
    return null
  }
}

/* 为 listPackModelGroups 的结果附加每文件元数据 */
async function enrichModelGroups(root, name) {
  const st = await mcmeta.statPack(root, name)
  const full = path.join(root, name)
  let packRoot = null
  let models = []
  let zipBuf = null
  let zipEntries = null

  if (st.isDirectory()) {
    const r = await mcmeta.resolveDirPack(full)
    packRoot = r ? r.root : full
    models = await mcmeta.walkDirModels(packRoot)
  } else {
    zipBuf = await fs.promises.readFile(full)
    zipEntries = mcmeta.parseZipCentralDirectory(zipBuf)
    models = mcmeta.zipModelEntries(zipEntries)
  }

  // 目录包：分批并行预加载模型文本（32 并发，避免 fd 耗尽），替代逐文件串行 await
  const dirTexts = new Map()
  if (st.isDirectory()) {
    const CONCURRENCY = 32
    for (let i = 0; i < models.length; i += CONCURRENCY) {
      const batch = models.slice(i, i + CONCURRENCY)
      const texts = await Promise.all(batch.map((t) => readDirModelText(packRoot, t.path)))
      for (let j = 0; j < batch.length; j++) dirTexts.set(batch[j].path, texts[j])
    }
  }

  const groups = new Map()
  for (const t of models) {
    const p = mcmeta.parseModelPath(t.path)
    if (!p) continue
    const key = p.kind === 'item' ? 'items' : p.rest.split('/').length >= 2 ? p.rest.split('/')[0] : ''
    let g = groups.get(key)
    if (!g) {
      g = { key, count: 0, files: [] }
      groups.set(key, g)
    }
    g.count++

    const format = formatOfPath(t.path)
    let texRefs = 0
    let animated = false
    let text = null
    if (st.isDirectory()) {
      text = dirTexts.get(t.path) || null
    } else if (zipBuf && zipEntries) {
      text = readZipEntryText(zipBuf, zipEntries, t.path)
    }    if (text) {
      const meta = parseModelMeta(text, format)
      texRefs = meta.texRefs
      animated = meta.animated
    }
    g.files.push({
      path: t.path,
      name: t.path.split('/').pop(),
      size: t.size || 0,
      mtime: t.mtime || 0,
      ns: p.ns,
      format,
      texRefs,
      texBucket: texCountBucket(texRefs),
      animated
    })
  }
  const sorted = [...groups.values()].sort(
    (a, b) => (a.key === '' ? -1 : b.key === '' ? 1 : b.count - a.count) || a.key.localeCompare(b.key)
  )
  return { name, kind: st.isDirectory() ? 'dir' : 'zip', root: packRoot, total: models.length, groups: sorted }
}

/* 读取 zip 条目文本（复用 mcmeta 的 findZipEntry + readZipEntry，失败返回 null） */
function readZipEntryText(buf, entries, rel) {
  const entry = mcmeta.findZipEntry(entries, rel)
  if (!entry) return null
  try { return mcmeta.readZipEntry(buf, entry).toString('utf8') } catch { return null }
}

/* ── 多包交叉对比：按模型相对路径聚合，标注每个包的存在性与大小 ── */

async function crossCompareModels(root, names) {
  if (!Array.isArray(names) || !names.length) {
    throw new AppError('ERR_INVALID_PARAM', 'packs list is empty')
  }
  if (names.length > 20) {
    throw new AppError('ERR_INVALID_PARAM', 'too many packs (max 20)')
  }
  const pathMap = new Map()
  const packMeta = []
  for (const name of names) {
    const st = await mcmeta.statPack(root, name)
    const full = path.join(root, name)
    let models = []
    if (st.isDirectory()) {
      const r = await mcmeta.resolveDirPack(full)
      const pr = r ? r.root : full
      models = await mcmeta.walkDirModels(pr)
    } else {
      const buf = await fs.promises.readFile(full)
      models = mcmeta.zipModelEntries(mcmeta.parseZipCentralDirectory(buf))
    }
    packMeta.push({ name, count: models.length })
    for (const m of models) {
      let rec = pathMap.get(m.path)
      if (!rec) {
        rec = { path: m.path, packs: {} }
        pathMap.set(m.path, rec)
      }
      rec.packs[name] = { size: m.size || 0, exists: true }
    }
  }
  const allPaths = [...pathMap.values()].sort((a, b) => a.path.localeCompare(b.path))
  for (const rec of allPaths) {
    for (const pm of packMeta) {
      if (!rec.packs[pm.name]) rec.packs[pm.name] = { size: 0, exists: false }
    }
    rec.presentIn = Object.keys(rec.packs).filter(k => rec.packs[k].exists)
    rec.absentIn = Object.keys(rec.packs).filter(k => !rec.packs[k].exists)
    const sizes = Object.values(rec.packs)
      .filter(v => v.exists)
      .map(v => v.size)
    rec.sizeVariants = new Set(sizes).size > 1
  }
  const summary = {
    totalModels: allPaths.length,
    commonToAll: allPaths.filter(r => r.absentIn.length === 0).length,
    partial: allPaths.filter(r => r.absentIn.length > 0 && r.presentIn.length > 0).length,
    sizeDiff: allPaths.filter(r => r.sizeVariants).length
  }
  return { packs: packMeta, models: allPaths, summary }
}

module.exports = {
  enrichModelGroups,
  crossCompareModels,
  parseModelMeta,
  texCountBucket,
  nsOfPath,
  formatOfPath
}
