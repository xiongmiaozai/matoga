/**
 * 冒烟测试数据准备辅助：统一使用 os.tmpdir() + fs.promises，避免同步阻塞。
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export function tmpRoot(tag) {
  return path.join(os.tmpdir(), `matoga-smoke-${tag}-${process.pid}`)
}

export async function cleanDir(dir) {
  try { await fs.rm(dir, { recursive: true, force: true }) } catch {}
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

export async function writeFiles(base, files) {
  await ensureDir(base)
  for (const [rel, content] of files) {
    const full = path.join(base, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content)
  }
}

export async function writeFile(full, content) {
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content)
}

export async function listDir(dir) {
  try { return await fs.readdir(dir) } catch { return [] }
}