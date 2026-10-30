/**
 * matoga - 模型分组维度提取
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 模型分类面板多维度分组的纯函数：命名空间 / 格式 / 贴图数桶 / 动画标记 / 自定义规则。
 * 无 DOM 依赖，可独立单测。
 */

/* 模型命名空间：assets/<ns>/... → <ns>；自定义/导入模型键（bb:/im:/cm:）回退 'custom' */
export function modelNsOf(g) {
  const m = g.key.match(/^assets\/([^/]+)\//)
  return m ? m[1] : 'custom'
}

/* 模型格式：bbmodel / custom / json */
export function modelFormatOf(g) {
  const k = g.key
  if (k.startsWith('bb:') || /\.bbmodel$/i.test(k)) return 'bbmodel'
  if (k.startsWith('cm:')) return 'custom'
  return 'json'
}

/* 贴图引用数分桶：0 / 1 / 2-4 / 5+（从元数据映射读取，缺省 'unknown'） */
export function modelTexBucketOf(g, metaMap) {
  const m = metaMap && metaMap.get(g.key)
  return m ? m.texBucket : 'unknown'
}

/* 是否动画模型（从元数据映射读取） */
export function modelAnimatedOf(g, metaMap) {
  const m = metaMap && metaMap.get(g.key)
  return !!(m && m.animated)
}

/* 自定义分组规则匹配：rules = [{ name, pattern }]，pattern 为正则字符串 */
export function modelCustomGroupOf(g, rules) {
  if (!Array.isArray(rules) || !rules.length) return null
  for (const rule of rules) {
    if (!rule || !rule.pattern) continue
    try {
      if (new RegExp(rule.pattern).test(g.key)) return rule.name
    } catch {
      continue
    }
  }
  return null
}
/* 模型基础名：取路径最后一段，去 .json/.bbmodel 扩展名 */
export function modelBaseNameOf(g) {
  const k = g.key
  const idx = k.lastIndexOf('/')
  const base = idx >= 0 ? k.slice(idx + 1) : k
  return base.replace(/\.(json|bbmodel)$/i, '')
}

/* 按名称首字母分桶：A-Z 大写字母；非字母归 '#' */
export function modelNameBucketOf(g) {
  const name = modelBaseNameOf(g)
  if (!name) return '#'
  const ch = name[0].toUpperCase()
  return ch >= 'A' && ch <= 'Z' ? ch : '#'
}
/* 前缀切分核心：按第一个 _ / - / 空格取首段小写；无分隔符返回 null */
export function prefixOfBaseName(base) {
  if (!base) return null
  const i = base.search(/[_\-\s]/)
  if (i <= 0) return null
  return base.slice(0, i).toLowerCase()
}
/* 按名称前缀分桶：去扩展名后按第一个 _ / - / 空格切分取首段小写；无分隔符归 '#' */
export function modelPrefixBucketOf(g) {
  return prefixOfBaseName(modelBaseNameOf(g)) ?? '#'
}
