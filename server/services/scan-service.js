/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const path = require('path')
const { AppError } = require('../../core/errors')

const STAT_BATCH = 32

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

async function statBatch(fullPaths) {
  const out = []
  for (let i = 0; i < fullPaths.length; i += STAT_BATCH) {
    const slice = fullPaths.slice(i, i + STAT_BATCH)
    out.push(...await Promise.all(slice.map(p =>
      fs.promises.stat(p).then(s => ({ p, s })).catch(() => ({ p, s: null }))
    )))
  }
  return out
}

function toEntry(fullPath, relName, stat) {
  const baseName = path.basename(fullPath)
  if (!stat) return { name: relName, baseName, fullPath, isDirectory: false, size: 0, mtime: 0, error: true }
  return {
    name: relName, baseName, fullPath,
    isDirectory: stat.isDirectory(),
    size: stat.isDirectory() ? 0 : stat.size,
    mtime: stat.mtimeMs
  }
}

async function scan(folderPath, ignorePatterns, recursive) {
  const entries = []
  if (!recursive) {
    let names
    try { names = await fs.promises.readdir(folderPath) } catch (e) {
      throw new AppError('ERR_FS_NOT_FOUND', e.message)
    }
    const filtered = names.filter(n => !shouldIgnore(n, ignorePatterns))
    const statted = await statBatch(filtered.map(n => path.join(folderPath, n)))
    for (const { p, s } of statted) entries.push(toEntry(p, path.basename(p), s))
    return entries
  }
  async function walk(dir, relBase) {
    let names
    try { names = await fs.promises.readdir(dir) } catch { return }
    const filtered = names.filter(n => !shouldIgnore(n, ignorePatterns))
    const statted = await statBatch(filtered.map(n => path.join(dir, n)))
    const subdirs = []
    for (const { p, s } of statted) {
      const base = path.basename(p)
      const rel = relBase ? relBase + '/' + base : base
      entries.push(toEntry(p, rel, s))
      if (s && s.isDirectory()) subdirs.push([p, rel])
    }
    await Promise.all(subdirs.map(([p, rel]) => walk(p, rel)))
  }
  await walk(folderPath, '')
  return entries
}

module.exports = { scan, shouldIgnore }
