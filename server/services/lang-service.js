/**
 * matoga - 中文译名映射服务
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 优先加载内置 server/assets/zh_cn.json（随仓库分发），再扫描 official-packs / mc-packs
 * 下各包的 assets/minecraft/lang/zh_cn.json 覆盖（用户自定义包优先），
 * 构建「贴图名 ↔ 中文译名」映射，供前端搜索/显示使用。
 * 映射在首次调用时懒加载并缓存，clearCache() 可强制重建。
 */

const fs = require('fs')
const path = require('path')

/* 拼音转换（纯 JS 依赖，缺失时降级为空映射，不影响其余功能） */
let toPinyin = null
try {
  const pp = require('pinyin-pro')
  if (typeof pp.pinyin === 'function') {
    toPinyin = text => pp.pinyin(text, { toneType: 'none', type: 'array', nonZh: 'spaced' }).join('')
  }
} catch {
  toPinyin = null
}

/* 内置汉化表（入库分发，避免依赖被 .gitignore 忽略的 official-packs/） */
const BUILTIN_ZH = path.join(__dirname, '..', 'assets', 'zh_cn.json')

/* block.minecraft.stone / item.minecraft.iron_ingot / tile.minecraft.stone.name（旧版） */
const KEY_RE = /^(block|item|tile)\.minecraft\.([a-z0-9_]+)(?:\.name)?$/

let _cache = null

function buildMaps(zhJson) {
  const byTexName = {}
  const byTexKey = {}
  const byZh = {}
  const byTexPinyin = {}
  for (const [k, v] of Object.entries(zhJson)) {
    if (typeof v !== 'string' || !v) continue
    const m = k.match(KEY_RE)
    if (!m) continue
    let cat = m[1]
    if (cat === 'tile') cat = 'block'
    const name = m[2]
    const key = cat + '/' + name
    if (!(key in byTexKey)) byTexKey[key] = v
    if (!(name in byTexName)) byTexName[name] = v
    if (!(v in byZh)) byZh[v] = name
    if (toPinyin && !(name in byTexPinyin)) {
      const py = toPinyin(v)
      if (py) byTexPinyin[name] = py
    }
  }
  return { byTexName, byTexKey, byZh, byTexPinyin }
}

async function loadLangFile(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function collectLangFiles(root) {
  if (!root || typeof root !== 'string') return []
  let names
  try {
    names = await fs.promises.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const d of names) {
    if (d.name.startsWith('.') || !d.isDirectory()) continue
    files.push(path.join(root, d.name, 'assets', 'minecraft', 'lang', 'zh_cn.json'))
  }
  return files
}

/**
 * 构建并返回映射表。roots 顺序决定合并优先级：靠后的根覆盖靠前的（mc-packs 覆盖 official）。
 * @param {string[]} roots - 包根目录列表（如 [officialPacksPath, mcPacksPath]）
 * @returns {Promise<{byTexName:Object,byTexKey:Object,byZh:Object,count:number}>}
 */
async function getMaps(roots) {
  if (_cache) return _cache
  const files = [BUILTIN_ZH]
  for (const r of roots || []) {
    for (const f of await collectLangFiles(r)) files.push(f)
  }
  let merged = {}
  for (const f of files) {
    const j = await loadLangFile(f)
    if (j && typeof j === 'object') Object.assign(merged, j)
  }
  const maps = buildMaps(merged)
  _cache = Object.assign({}, maps, { count: Object.keys(maps.byTexName).length })
  return _cache
}

function clearCache() {
  _cache = null
}

function stats() {
  return { loaded: _cache !== null, count: _cache ? _cache.count || 0 : 0 }
}

module.exports = { getMaps, clearCache, stats, buildMaps }
