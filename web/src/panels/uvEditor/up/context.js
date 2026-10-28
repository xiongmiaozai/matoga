/**
 * matoga - UV 编辑器面板：编辑器上下文
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 按职责搬出，逻辑未改。
 */


import { apiUrl } from '../../../utils.js'
import {
  buildMcLayout, buildBbLayout,
  getLastModelLayout,
  updateModelFaceUv, updateModelFaceRotation, updateModelTexture, clearModelTexture,
  highlightModelFace, exportActiveModelJson,
  texUrlToRef, writeMcTexRef, texPathForRef,
} from '../../../mc-model-viewer.js'
import { isCustomModelActive } from '../../../material3d.js'
import { S } from './state.js'

export const IM_API = '/api/imported-models'
export const CM_API = '/api/custom-models'







/* 当前编辑对象：viewport 联动模式或离线模式（持有 JSON 副本与 layout） */


/* 模型列表缓存（选项 value → { kind, id, name }） */


export async function api(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
  return j.data
}

/* ── 数据源与钩子（按 S.source.mode 动态分派） ────────────────── */

export function currentLayout() {
  if (S.source.mode === 'viewport') {
    return (typeof isCustomModelActive === 'function' && isCustomModelActive()) ? getLastModelLayout() : null
  }
  return S.source.layout || null
}

export function offlineWriteFace(el, key, prop, val) {
  if (!el || !el.faces || typeof el.faces !== 'object' || !el.faces[key] || typeof el.faces[key] !== 'object') return
  el.faces[key][prop] = val
}

