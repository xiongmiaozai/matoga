/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const { spawn } = require('child_process')
const express = require('express')
const { ok, wrap } = require('../middleware/errors')
const { guardRead } = require('../middleware/validate')
const { requireLocal } = require('../middleware/auth')

const router = express.Router()

function openWith(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.on('error', reject)
    child.on('spawn', () => { child.unref(); resolve() })
  })
}

function openPath(p) {
  if (process.platform === 'win32') return openWith('cmd', ['/c', 'start', '', p])
  if (process.platform === 'darwin') return openWith('open', [p])
  return openWith('xdg-open', [p])
}

function revealInFolder(p) {
  if (process.platform === 'win32') return openWith('explorer', ['/select,', p])
  if (process.platform === 'darwin') return openWith('open', ['-R', p])
  return openWith('xdg-open', [require('path').dirname(p)])
}

router.use(requireLocal)

router.post('/open', wrap(async (req, res) => {
  const p = guardRead(req.body && req.body.path)
  await openPath(p)
  ok(res, {})
}))

router.post('/reveal', wrap(async (req, res) => {
  const p = guardRead(req.body && req.body.path)
  await revealInFolder(p)
  ok(res, {})
}))

module.exports = router