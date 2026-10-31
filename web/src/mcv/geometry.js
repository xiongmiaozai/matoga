/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * MC 模型查看器：几何与 item 定义解析
 *
 * 从 mc-model-viewer.js 原样搬出，逻辑未改。均为纯函数，无 DOM / three 依赖。
 */

export const MAX_ITEM_DEF_DEPTH = 12

export function defaultFaceUv(key, from, to, uvScale = 16) {
  if (!Array.isArray(from) || !Array.isArray(to)) return null
  const fx = +from[0],
    fy = +from[1],
    fz = +from[2]
  const tx = +to[0],
    ty = +to[1],
    tz = +to[2]
  if (![fx, fy, fz, tx, ty, tz].every(Number.isFinite)) return null
  let uv
  switch (key) {
    case 'up':
      uv = [fx, fz, tx, tz]
      break
    case 'down':
      uv = [fx, 16 - tz, tx, 16 - fz]
      break
    case 'north':
      uv = [16 - tx, 16 - ty, 16 - fx, 16 - fy]
      break
    case 'south':
      uv = [fx, 16 - ty, tx, 16 - fy]
      break
    case 'east':
      uv = [16 - tz, 16 - ty, 16 - fz, 16 - fy]
      break
    case 'west':
      uv = [fz, 16 - ty, tz, 16 - fy]
      break
    default:
      return null
  }
  if (uvScale && uvScale !== 16) {
    const s = uvScale / 16
    uv = uv.map(v => v * s)
  }
  return uv
}

export function resolveItemDefRefs(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_ITEM_DEF_DEPTH) return out
  const type = typeof node.type === 'string' ? node.type.replace(/^[^:]*:/, '') : ''
  switch (type) {
    case 'model':
      if (typeof node.model === 'string' && node.model) {
        out.push({
          model: node.model,
          transformation: node.transformation || null,
          tints: Array.isArray(node.tints) ? node.tints : null
        })
      }
      break
    case 'condition':
      resolveItemDefRefs(node.on_false, out, depth + 1)
      break
    case 'select':
    case 'range_dispatch':
      resolveItemDefRefs(node.fallback, out, depth + 1)
      break
    case 'composite':
      for (const m of Array.isArray(node.models) ? node.models : []) {
        resolveItemDefRefs(m, out, depth + 1)
      }
      break
    case 'special':
      /* shulker_box 内嵌渲染器：构造虚拟 cube 使用实体贴图（entity/shulker/<texture>），
         替换 base（base 仅含 particle 纯色贴图，非真实外观） */
      if (node.model && typeof node.model === 'object') {
        const innerType = typeof node.model.type === 'string' ? node.model.type.replace(/^[^:]*:/, '') : ''
        if (innerType === 'shulker_box' && typeof node.model.texture === 'string' && node.model.texture) {
          out.push({ shulkerBox: node.model.texture, transformation: node.transformation || null })
          break
        }
      }
      if (typeof node.base === 'string' && node.base) {
        out.push({ model: node.base, transformation: node.transformation || null })
      }
      break
    default:
      break
  }
  return out
}
