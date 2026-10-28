/**
 * matoga - 资源包元数据：单个包分析
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mcmeta-service.js 按职责搬出，逻辑未改。
 */

const { readDirNamespaces } = require('./shared')

const fs = require('fs')
const path = require('path')
const { MCMETA_NAME, IMG_EXT_RE, TEX_DIR_RE, MAX_TEX_WALK } = require('./consts')
const { tryReadVersionJson } = require('./mcmeta')
const { normalizeZipTexName } = require('./zip')

async function resolveDirPack(dir) {
  const tryRead = async (base) => {
    let text = null
    try { text = await fs.promises.readFile(path.join(base, MCMETA_NAME), 'utf8') } catch {}
    return text
  }
  const direct = await tryRead(dir)
  if (direct !== null) return { root: dir, text: direct, namespaces: await readDirNamespaces(dir) }
  const names = (await fs.promises.readdir(dir, { withFileTypes: true }))
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  if (names.length === 1) {
    const sub = path.join(dir, names[0].name)
    const subText = await tryRead(sub)
    if (subText !== null) return { root: sub, text: subText, namespaces: await readDirNamespaces(sub) }
    // 唯一子目录含 assets（无 mcmeta）：以子目录为包根
    try {
      await fs.promises.access(path.join(sub, 'assets'))
      return { root: sub, text: null, namespaces: await readDirNamespaces(sub), versionInfo: await tryReadVersionJson(sub) }
    } catch {}
  }
  try {
    await fs.promises.access(path.join(dir, 'assets'))
    return { root: dir, text: null, namespaces: await readDirNamespaces(dir), versionInfo: await tryReadVersionJson(dir) }
  } catch {}
  return null
}

/* 递归收集包内贴图（相对包根的 assets/... 路径，带上限防大包卡死） */

/* 递归收集包内贴图（相对包根的 assets/... 路径，带上限防大包卡死） */
async function walkDirTextures(packRoot) {
  const found = []
  async function walk(abs, rel) {
    if (found.length >= MAX_TEX_WALK) return
    let ents
    try { ents = await fs.promises.readdir(abs, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) await walk(path.join(abs, e.name), r)
      else if (TEX_DIR_RE.test(r) && IMG_EXT_RE.test(e.name)) {
        found.push({ path: r, size: 0 })
        if (found.length >= MAX_TEX_WALK) return
      }
    }
  }
  await walk(packRoot, '')
  return found
}

/* zip 包内贴图条目：路径限定 assets/<ns>/textures/ 且扩展名为图片（排除 .png.mcmeta / .json 等非贴图） */

/* zip 包内贴图条目：路径限定 assets/<ns>/textures/ 且扩展名为图片（排除 .png.mcmeta / .json 等非贴图） */
function zipTextureEntries(entries) {
  const out = []
  for (const e of entries) {
    const p = normalizeZipTexName(e.name)
    if (p && IMG_EXT_RE.test(e.name)) out.push({ path: p, size: e.usize })
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/* ── 包内模型（assets/<ns>/models/** 与 1.21.4+ 物品定义 assets/<ns>/items/*.json）── */

/* zip 条目名 → 归一化模型路径：容忍包内容套一层根文件夹（<root>/assets/...） */

module.exports = { resolveDirPack, walkDirTextures, zipTextureEntries }
