/**
 * matoga - 资产搜索匹配纯逻辑
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 支持空格多关键词、子序列模糊回退、拼音、反向映射英文候选的客户端过滤匹配。
 * 纯函数无副作用，便于单元测试。
 */

/* 子序列匹配：needle 的字符按顺序出现在 hay 中（含 includes 场景） */
export function subseq(hay, needle) {
  if (!needle) return true
  let i = 0
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++
  }
  return i === needle.length
}

/* 单 token 对多字段命中：先 includes，不中且 token 长度≥2 再子序列回退 */
export function tokenMatches(fields, tok) {
  for (const f of fields) {
    if (f && f.includes(tok)) return true
  }
  if (tok.length >= 2) {
    for (const f of fields) {
      if (f && subseq(f, tok)) return true
    }
  }
  return false
}

/* 资产搜索匹配：支持空格多关键词（每词都需命中）、子序列模糊、拼音、反向映射英文候选。
 * name/zh/pinyin 已由调用方 lowerCase；rawTerm 原样传入，内部归一化。 */
export function assetSearchMatch(name, zh, pinyin, enCands, rawTerm) {
  const term = (rawTerm || '').trim().toLowerCase()
  if (!term) return true
  const tokens = term.split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const fields = [name, zh, pinyin]
  if (enCands && enCands.length) fields.push(...enCands)
  return tokens.every(tok => tokenMatches(fields, tok))
}
