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
    const roots = [home]
    if (process.platform === 'win32') {
      for (let i = 65; i <= 90; i++) {
        const d = String.fromCharCode(i) + ':\\'
        try { fs.accessSync(d, fs.constants.R_OK); roots.push(d) } catch {}
      }
    }
    return ok(res, { path: '', parent: null, dirs: roots.map(d => ({ name: d, fullPath: d })) })
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

router.post('/create', wrap(async (req, res) => {
  const { fileService } = require('../services/file-service')
  const p = guardRead(req.body && req.body.path)
  ok(res, await fileService.createFolder(p))
}))

module.exports = router