/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 磁盘缓存目录统计与清理工具，供 thumb / model-thumb / hdri / analyze 服务复用。
 */

const fs = require('fs')
const path = require('path')

async function dirStats(dir) {
  let files = 0,
    bytes = 0
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        const sub = await dirStats(full)
        files += sub.files
        bytes += sub.bytes
      } else if (e.isFile()) {
        files++
        try {
          bytes += (await fs.promises.stat(full)).size
        } catch {}
      }
    }
  } catch {}
  return { files, bytes }
}

async function clearDir(dir) {
  let removed = 0
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    await Promise.all(
      entries.map(async e => {
        try {
          await fs.promises.rm(path.join(dir, e.name), { recursive: true, force: true })
          removed++
        } catch {}
      })
    )
  } catch {}
  return { removed }
}

module.exports = { dirStats, clearDir }
