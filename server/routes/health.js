/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const auth = require('../middleware/auth')

const router = express.Router()

function buildHealthInfo() {
  const m = process.memoryUsage()
  return {
    status: 'ok',
    uptime: process.uptime(),
    pid: process.pid,
    node: process.version,
    lan: auth.getToken() != null,
    memory: { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal },
    ts: Date.now()
  }
}

router.get('/', (req, res) => {
  res.json({ ok: true, data: buildHealthInfo() })
})

module.exports = router
module.exports.buildHealthInfo = buildHealthInfo