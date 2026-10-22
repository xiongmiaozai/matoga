/**
 * matoga - 面板清单 API
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 运行时扫描 web/src/panels/<id>/manifest.json，返回可用面板清单。
 * 前端 panel-loader 据此动态加载每个面板的 HTML / CSS / JS。
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()

const ROOT = path.join(__dirname, '..', '..')
const PANELS_DIR = path.join(ROOT, 'web', 'src', 'panels')

router.get('/', (req, res) => {
  const panels = []
  let entries = []
  try { entries = fs.readdirSync(PANELS_DIR, { withFileTypes: true }) } catch (e) { /* dir 缺失 → 空清单 */ }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const mfPath = path.join(PANELS_DIR, ent.name, 'manifest.json')
    if (!fs.existsSync(mfPath)) continue
    try {
      const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'))
      const base = `/src/panels/${ent.name}`
      panels.push({
        id: mf.id || ent.name,
        title: mf.title || ent.name,
        icon: mf.icon || '',
        htmlUrl: mf.html ? `${base}/${mf.html}` : null,
        jsUrl: mf.js ? `${base}/${mf.js}` : null,
        cssUrl: mf.css ? `${base}/${mf.css}` : null,
        mount: mf.mount || 'body',
        order: typeof mf.order === 'number' ? mf.order : 999,
        dynamic: !!mf.dynamic,
        deps: Array.isArray(mf.deps) ? mf.deps : [],
      })
    } catch (e) { /* 损坏的 manifest 跳过 */ }
  }

  panels.sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(b.id))

  res.json({ ok: true, panels })
})

module.exports = router