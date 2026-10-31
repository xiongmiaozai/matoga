/**
 * matoga - 中文译名映射前端缓存与查询
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 /api/lang/zh 加载「贴图名↔中文译名↔拼音」映射并缓存，提供按资产名/路径查询
 * 中文译名、拼音、反向英文候选的工具。各搜索/显示模块调用 zhOfItem / pinyinOfItem
 * / enCandidatesOfZh 参与中文、拼音、反向匹配与展示。
 */

import { apiUrl } from './url-utils.js'

let _maps = null
let _loading = null

/* 资产名常见扩展名（贴图/模型/贴图格式），查询中文译名时统一去除 */
const EXT_RE = /\.(png|tga|jpg|jpeg|json|bbmodel|glb|gltf|webp|bmp|psd|exr|hdr)$/i

export async function loadZhNames() {
  if (_maps) return _maps
  if (_loading) return _loading
  _loading = (async () => {
    try {
      const res = await fetch(apiUrl('/api/lang/zh'))
      const j = await res.json()
      _maps = j && j.ok ? j.data : null
    } catch {
      _maps = null
    }
    _loading = null
    return _maps
  })()
  return _loading
}

export function getZhMaps() {
  return _maps
}

/* 贴图变体名回退：按 _ 分段逐步缩短查映射表，命中即返回。
 * 如 crafting_table_top → crafting_table → "工作台"；log_top → log。
 * 仅当直接查不到时触发，避免对已有精确映射产生干扰。 */
function texNameFuzzy(name, table) {
  if (!table || !name) return ''
  const parts = String(name).split('_')
  for (let i = parts.length - 1; i >= 1; i--) {
    const cand = parts.slice(0, i).join('_')
    const v = table[cand]
    if (v) return v
  }
  return ''
}

export function zhOfTexName(name) {
  if (!_maps || !name) return ''
  return _maps.byTexName[name] || texNameFuzzy(name, _maps.byTexName)
}

export function pinyinOfTexName(name) {
  if (!_maps || !name) return ''
  const table = _maps.byTexPinyin || {}
  return table[name] || texNameFuzzy(name, table)
}

export function zhOfTexPath(texPath) {
  if (!_maps || !texPath) return ''
  const m = String(texPath).match(/textures\/(block|item)\/([^/.]+)\.png$/i)
  if (!m) return ''
  const cat = m[1].toLowerCase()
  const name = m[2].toLowerCase()
  return _maps.byTexKey[cat + '/' + name] || _maps.byTexName[name] || ''
}

export function baseNameOf(name) {
  return String(name).replace(EXT_RE, '')
}

export function zhOfItem(item) {
  if (!item) return ''
  if (item.path) {
    const z = zhOfTexPath(item.path)
    if (z) return z
  }
  if (item.name) {
    return zhOfTexName(baseNameOf(item.name))
  }
  return ''
}

export function pinyinOfItem(item) {
  if (!item || !_maps) return ''
  if (item.path) {
    const m = String(item.path).match(/textures\/(block|item)\/([^/.]+)\.png$/i)
    if (m) {
      const cat = m[1].toLowerCase()
      const name = m[2].toLowerCase()
      const key = cat + '/' + name
      if (_maps.byTexKey && _maps.byTexKey[key]) return pinyinOfTexName(name)
    }
  }
  if (item.name) {
    return pinyinOfTexName(baseNameOf(item.name))
  }
  return ''
}

/* 搜索匹配：text 为英文原文，返回其对应中文是否包含 term（term 视为中文片段） */
export function zhIncludes(text, term) {
  if (!_maps || !term) return false
  const z = zhOfTexName(text)
  return !!z && z.toLowerCase().includes(term)
}

/* 反向映射补全：中文片段 → 对应英文贴图名候选（中文译名包含 term 即纳入）。
 * 上限 cap 防止极端情况下候选过多拖慢客户端过滤。 */
export function enCandidatesOfZh(term, cap = 60) {
  if (!_maps || !term) return []
  const byZh = _maps.byZh
  if (!byZh) return []
  const out = []
  const lower = term.toLowerCase()
  for (const zh in byZh) {
    if (zh.toLowerCase().includes(lower)) {
      out.push(byZh[zh])
      if (out.length >= cap) break
    }
  }
  return out
}
