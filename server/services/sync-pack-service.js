/**
 * matoga - 资源包同步服务
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 把模型 JSON + 贴图写入 MC 资源包目录（mcPacksPath/<pack>/assets/<ns>/models/...），
 * 使 Minecraft 可直接加载。
 */

const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const configStore = require('../config/config-store')

function assertSafeRel(rel) {
  const p = String(rel || '').replace(/\\/g, '/')
  if (!p.startsWith('assets/')) throw new Error('relPath must start with assets/')
  if (p.includes('..')) throw new Error('relPath must not contain ..')
  return p
}

async function syncModelJson({ packName, relPath, json }) {
  const cfg = configStore.get()
  const root = cfg.mcPacksPath
  if (!root) throw new Error('mcPacksPath not configured')
  const safe = assertSafeRel(relPath)
  if (!safe.endsWith('.json')) throw new Error('relPath must end with .json')
  const packDir = path.join(root, String(packName))
  const dest = path.join(packDir, safe)
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const content = typeof json === 'string' ? json : JSON.stringify(json, null, 2)
  await fsp.writeFile(dest, content, 'utf8')
  return { dest, size: content.length }
}


module.exports = { syncModelJson }