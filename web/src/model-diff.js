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

export const MODEL_PATH_RE = /^(?:assets\/[^/]+\/)?(?:models\/[^/]+\/.+|items\/[^/]+)\.(?:json|bbmodel)$/i

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

export function resolveTexPath(ref) {
  if (typeof ref !== 'string' || !ref) return null
  const colon = ref.indexOf(':')
  let ns, p
  if (colon >= 0) { ns = ref.slice(0, colon); p = ref.slice(colon + 1) }
  else { ns = 'minecraft'; p = ref }
  if (!p) return null
  return `assets/${ns}/textures/${p}.png`
}

export function extractTextureRefs(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  const tex = obj.textures
  if (!tex || typeof tex !== 'object') return []
  const refs = []
  for (const v of Object.values(tex)) {
    if (typeof v === 'string' && v[0] !== '#') refs.push(v)
  }
  return refs
}

/* 贴图扩展名变体：MC 引用标准补 .png，但社区包常存 .jpg/.webp 等。
   检测时精确匹配失败则尝试同 stem 不同图片扩展名，与后端 resolveDirFileFuzzy 行为对齐 */
const TEX_IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']
function hasTexPath(set, resolved) {
  if (!resolved) return false
  if (set.has(resolved)) return true
  const dot = resolved.lastIndexOf('.')
  if (dot < 0) return false
  const stem = resolved.slice(0, dot)
  const curExt = resolved.slice(dot + 1).toLowerCase()
  for (const ext of TEX_IMG_EXTS) {
    if (ext === curExt) continue
    if (set.has(stem + '.' + ext)) return true
  }
  return false
}

export function checkTexRefs(obj, existingPaths, vanillaPaths) {
  const refs = extractTextureRefs(obj)
  const set = existingPaths instanceof Set ? existingPaths : new Set(existingPaths || [])
  const vset = vanillaPaths instanceof Set ? vanillaPaths : new Set(vanillaPaths || [])
  const results = []
  for (const ref of refs) {
    const resolved = resolveTexPath(ref)
    const exists = hasTexPath(set, resolved)
    const vanilla = !exists && hasTexPath(vset, resolved)
    results.push({ ref, resolved, exists, vanilla })
  }
  return results
}

const DIFF_CELL_LIMIT = 400000

export function diffLines(aLines, bLines) {
  const a = aLines || []
  const b = bLines || []
  const n = a.length, m = b.length
  if (n === m && a.every((l, i) => l === b[i])) return a.map(text => ({ type: 'same', text }))
  if (n * m > DIFF_CELL_LIMIT) return null
  const stride = m + 1
  const dp = new Uint32Array((n + 1) * stride)
  for (let i = n - 1; i >= 0; i--) {
    const row = i * stride, next = row + stride, ai = a[i]
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] = ai === b[j] ? dp[next + j + 1] + 1 : Math.max(dp[next + j], dp[row + j + 1])
    }
  }
  const out = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (dp[(i + 1) * stride + j] >= dp[i * stride + j + 1]) { out.push({ type: 'del', text: a[i] }); i++ }
    else { out.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}