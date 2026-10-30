/**
 * matoga - 模型名称前缀分组
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 资产库模型（MC 包内 .json + Blockbench .bbmodel）按名称前缀细分分组，
 * 用于区分不同系列模型（如 oak_planks / oak_log / oak_leaves 归入「oak」）：
 *  - 前缀 = 名称（去 .json/.bbmodel 扩展名）按第一个 _ / - / 空格 切分出的第一段（小写归一）
 *  - 无分隔符的名称（如 stone）归入「未分组」桶，排在最后
 *  - 全部条目落入同一桶时不细分（保持原组 key/label），避免小组冗余
 */

const NAME_EXT_RE = /\.(json|bbmodel)$/i
import { prefixOfBaseName } from './model-group-dims.js'

/* 提取名称前缀：无分隔符（或以分隔符开头）返回 null（归入未分组） */
export function modelPrefixOf(name) {
  return prefixOfBaseName(String(name || '').replace(NAME_EXT_RE, '').trim())
}

/**
 * 将一组模型条目按名称前缀拆分为子组列表。
 * @param {string} parentKey 父组 key（子组 key = parentKey + '#' + 前缀；未分组桶为 parentKey + '#'）
 * @param {string} parentLabel 父组 label（子组 label = parentLabel + ' · ' + 前缀）
 * @param {Array<{name:string}>} items 模型条目（读取 name 字段）
 * @param {string} ungroupedLabel 未分组桶的展示名（i18n 文案）
 * @returns {Array<{key:string,label:string,items:Array}>} 子组列表（前缀组按名称排序，未分组排最后）
 */
export function splitGroupsByPrefix(parentKey, parentLabel, items, ungroupedLabel) {
  const list = items || []
  const buckets = new Map()
  const ungrouped = []
  for (const it of list) {
    const pfx = modelPrefixOf(it && it.name)
    if (pfx == null) ungrouped.push(it)
    else {
      let b = buckets.get(pfx)
      if (!b) { b = []; buckets.set(pfx, b) }
      b.push(it)
    }
  }
  /* 单桶（含空组）：保持原组，不加前缀层级 */
  if (buckets.size + (ungrouped.length ? 1 : 0) <= 1) {
    return [{ key: parentKey, label: parentLabel, items: list }]
  }
  const out = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([pfx, its]) => ({ key: parentKey + '#' + pfx, label: parentLabel + ' · ' + pfx, items: its }))
  if (ungrouped.length) out.push({ key: parentKey + '#', label: parentLabel + ' · ' + ungroupedLabel, items: ungrouped })
  return out
}