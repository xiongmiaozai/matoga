/**
 * matoga - 对比结果搜索匹配纯逻辑
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 复用 assetSearchMatch + 中文名/拼音/反向映射，对对比结果 key 做文本搜索过滤。
 * 纯函数无副作用，便于单元测试。
 */

import { zhOfTexPath, zhOfTexName, pinyinOfItem, enCandidatesOfZh, baseNameOf } from './zh-names.js'
import { assetSearchMatch } from './asset-search.js'

export function zhOfKey(key) {
  if (!key) return ''
  const z = zhOfTexPath(key) || zhOfTexPath(key + '.png')
  if (z) return z
  const base = baseNameOf(String(key).split('/').pop())
  return zhOfTexName(base)
}

export function resultSearchFields(key) {
  const k = String(key || '')
  return {
    name: k.toLowerCase(),
    zh: zhOfKey(key),
    py: pinyinOfItem({ name: key, path: key })
  }
}

export function resultSearchMatch(key, term, cache, enCands) {
  const tm = (term || '').trim()
  if (!tm) return true
  let f = cache ? cache.get(key) : null
  if (!f) {
    f = resultSearchFields(key)
    if (cache) {
      if (cache.size > 4096) cache.clear()
      cache.set(key, f)
    }
  }
  if (!enCands) enCands = enCandidatesOfZh(tm.toLowerCase())
  return assetSearchMatch(f.name, f.zh, f.py, enCands, tm)
}

export function filterByResultSearch(arr, term, cache) {
  const tm = (term || '').trim()
  if (!tm) return arr
  const enCands = enCandidatesOfZh(tm.toLowerCase())
  const out = []
  for (const g of arr) {
    if (resultSearchMatch(g.key, tm, cache, enCands)) out.push(g)
  }
  return out
}
