/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 模型对比（纯函数模块，无 DOM 依赖）：
 * - isModelEntry：识别包内模型 JSON（assets/<ns>/models/** 与 1.21.4+ 物品定义 assets/<ns>/items/*.json）
 * - prettyModelJson / parseModelText：规范化文本（压缩 JSON 展开为 2 空格缩进，避免整文件一行无法比对）
 * - buildModelSummary：提取模型概要（parent / elements / textures / 物品定义）
 * - diffLines：行级 LCS 差异（same / del / add），超限返回 null 由上层退化为并排显示
 */

export const MODEL_PATH_RE = /^assets\/[^/]+\/(models\/[^/]+\/.+|items\/[^/]+)\.json$/i

export function isModelEntry(e) {
  return !!e && !e.isDirectory && typeof e.name === 'string' && MODEL_PATH_RE.test(e.name)
}

export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function prettyModelJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

export function parseModelText(text) {
  if (typeof text !== 'string') return { ok: false, obj: null, pretty: '' }
  try {
    const obj = JSON.parse(text)
    return { ok: true, obj, pretty: JSON.stringify(obj, null, 2) }
  } catch {
    return { ok: false, obj: null, pretty: text }
  }
}

export function buildModelSummary(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const itemRef = typeof obj.model_reference === 'string' ? obj.model_reference : null
  return {
    itemDef: itemRef !== null,
    itemRef,
    parent: typeof obj.parent === 'string' ? obj.parent : null,
    elements: Array.isArray(obj.elements) ? obj.elements.length : 0,
    textures: obj.textures && typeof obj.textures === 'object' ? Object.keys(obj.textures).length : 0
  }
}

const DIFF_CELL_LIMIT = 400000

export function diffLines(aLines, bLines) {
  const a = aLines || []
  const b = bLines || []
  const n = a.length, m = b.length
  if (n === m && a.every((l, i) => l === b[i])) return a.map(text => ({ type: 'same', text }))
  if (n * m > DIFF_CELL_LIMIT) return null
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++ }
    else { out.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}