/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const { guardRead } = require('../middleware/validate')
const { shouldIgnore } = require('../services/scan-service')

const router = express.Router()

router.get('/browse', wrap(async (req, res) => {

  const p = req.query.path ? guardRead(req.query.path) : ''
  if (!p) {
    const home = os.homedir()
    const roots = [{ name: home, fullPath: home }]
    if (process.platform === 'win32') {
      for (let i = 65; i <= 90; i++) {
        const d = String.fromCharCode(i) + ':\\'
        try { fs.accessSync(d, fs.constants.R_OK); roots.push({ name: d, fullPath: d }) } catch {}
      }
    } else if (process.platform === 'darwin') {
      roots.push({ name: '/', fullPath: '/' })
      try {
        for (const e of fs.readdirSync('/Volumes', { withFileTypes: true })) {
          if (!e.isDirectory() || e.name === 'Macintosh HD') continue
          const d = path.join('/Volumes', e.name)
          try { fs.accessSync(d, fs.constants.R_OK); roots.push({ name: e.name, fullPath: d }) } catch {}
        }
      } catch {}
    } else {
      roots.push({ name: '/', fullPath: '/' })
    }
    return ok(res, { path: '', parent: null, dirs: roots })
  }
  const entries = await fs.promises.readdir(p, { withFileTypes: true })
  const skip = ['.git', 'node_modules', 'System Volume Information', '$RECYCLE.BIN']
  const dirs = entries
    .filter(e => e.isDirectory() && !shouldIgnore(e.name, skip))
    .map(e => ({ name: e.name, fullPath: path.join(p, e.name) }))
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  const parent = path.dirname(p)
  ok(res, { path: p, parent: parent === p ? null : parent, dirs })
}))

router.get('/search', wrap(async (req, res) => {
  const root = guardRead(req.query.path)
  const q = String(req.query.q || '').trim().toLowerCase()
  const maxDepth = Math.min(parseInt(req.query.depth) || 3, 6)
  const limit = Math.min(parseInt(req.query.limit) || 200, 500)
  if (!q) return ok(res, { results: [] })
  const skip = new Set(['.git', 'node_modules', '.Trash', 'System Volume Information', '$RECYCLE.BIN'])
  const results = []
  async function walk(dir, depth) {
    if (depth > maxDepth || results.length >= limit) return
    let entries
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    const subs = []
    for (const e of entries) {
      if (!e.isDirectory() || skip.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.name.toLowerCase().includes(q)) {
        results.push({ name: e.name, fullPath: full })
        if (results.length >= limit) return
      }
      subs.push(full)
    }
    await Promise.all(subs.map(s => walk(s, depth + 1)))
  }
  await walk(root, 0)
  ok(res, { results: results.slice(0, limit) })
}))

router.post('/create', wrap(async (req, res) => {
  const { fileService } = require('../services/file-service')
  const p = guardRead(req.body && req.body.path)
  ok(res, await fileService.createFolder(p))
}))

module.exports = router