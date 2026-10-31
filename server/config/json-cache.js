/**
 * matoga - JSON 文件 mtime 缓存读取
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 单文件 JSON 读取缓存：首次 readFileSync + JSON.parse，后续仅 statSync 比对 mtime，
 * 未变则返回缓存。写入（rename）后 mtime 改变，下次自动重读，无需手动失效。
 */

const fs = require('fs')

const _cache = new Map() // file -> { raw, mtime }

function readJsonMtu(file) {
  const st = fs.statSync(file)
  const c = _cache.get(file)
  if (c && st.mtimeMs === c.mtime) return c.raw
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  _cache.set(file, { raw, mtime: st.mtimeMs })
  return raw
}

function invalidate(file) {
  _cache.delete(file)
}

module.exports = { readJsonMtu, invalidate }