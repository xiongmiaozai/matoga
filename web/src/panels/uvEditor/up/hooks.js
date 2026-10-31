/**
 * matoga - UV 编辑器面板：编辑器钩子
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 按职责搬出，逻辑未改。
 */
import { apiUrl } from '../../../utils.js'
import {
  buildMcLayout,
  buildBbLayout,
  getLastModelLayout,
  updateModelFaceUv,
  updateModelFaceRotation,
  updateModelTexture,
  clearModelTexture,
  highlightModelFace,
  exportActiveModelJson,
  texUrlToRef,
  writeMcTexRef,
  texPathForRef
} from '../../../mc-model-viewer.js'
import { S } from './state.js'
import { offlineWriteFace } from './context.js'

export const hooks = {
  onFaceUv(el, key, uv) {
    if (S.source.mode === 'viewport') {
      try {
        updateModelFaceUv(el, key, uv)
      } catch {}
    } else {
      offlineWriteFace(el, key, 'uv', [...uv])
    }
  },
  onFaceRotation(el, key, rotation) {
    if (S.source.mode === 'viewport') {
      try {
        updateModelFaceRotation(el, key, rotation)
      } catch {}
    } else {
      offlineWriteFace(el, key, 'rotation', rotation)
    }
  },
  onTexture(texIndex, texUrl, layout, extra) {
    if (S.source.mode === 'viewport') {
      /* 空串 = 移除材质（面变纯色）；extra（材质球 normal/specular）→ 3D 视口 PBR 预览 */
      return texUrl === '' ? clearModelTexture(texIndex, layout) : updateModelTexture(texIndex, texUrl, layout, extra)
    }
    /* 离线：bbmodel 内嵌贴图写回本地 JSON 副本（保存时持久化）。
       贴图库 raw URL 无法直接内嵌（bbmodel 标准仅支持 dataURL）→ 异步 fetch 转 dataURL 写回；
       保存时 bakeTexUrls 兜底（此处转换失败/未完成的情况） */
    if (S.source.mode === 'offline' && S.source.isBb) {
      const origin = layout && Array.isArray(layout.texOrigin) ? layout.texOrigin : null
      const jsonTextures = Array.isArray(S.source.json.textures) ? S.source.json.textures : null
      if (!origin || !jsonTextures) return Promise.resolve()
      const writeBack = val => {
        for (let rawIdx = 0; rawIdx < origin.length; rawIdx++) {
          if (origin[rawIdx] === texIndex && jsonTextures[rawIdx]) jsonTextures[rawIdx].source = val
        }
      }
      const url = String(texUrl || '')
      if (url === '') {
        /* 移除材质：bbmodel 贴图 S.source 置空（保存时持久化） */
        writeBack('')
        return Promise.resolve()
      }
      if (url.startsWith('data:')) {
        writeBack(url)
        return Promise.resolve()
      }
      if (url.startsWith('/')) {
        return fetch(apiUrl(url))
          .then(r => (r.ok ? r.blob() : null))
          .then(blob =>
            blob
              ? new Promise(resolve => {
                  const rd = new FileReader()
                  rd.onload = () => resolve(String(rd.result))
                  rd.onerror = () => resolve(null)
                  rd.readAsDataURL(blob)
                })
              : null
          )
          .then(dataUrl => {
            if (dataUrl) writeBack(dataUrl)
          })
          .catch(() => {})
      }
    }
    /* 离线：MC .json（im/cm）贴图引用写回（保存时持久化，重新打开自动加载）。
       无包上下文 → 一律扩展引用形式（data: 内嵌 / file: 磁盘路径 / 站内 URL） */
    if (
      S.source.mode === 'offline' &&
      !S.source.isBb &&
      S.source.json &&
      S.source.json.textures &&
      typeof S.source.json.textures === 'object'
    ) {
      const lay = layout || S.source.layout
      const oldPath = lay && Array.isArray(lay.texPaths) ? lay.texPaths[texIndex] : null
      if (typeof oldPath === 'string') {
        const ref = texUrlToRef(texUrl, null)
        if (ref != null) {
          writeMcTexRef(S.source.json.textures, oldPath, ref)
          lay.texPaths[texIndex] = texPathForRef(ref)
        }
      }
    }
    return Promise.resolve()
  },
  highlightFace(el, key, on) {
    if (S.source.mode !== 'viewport') return false
    try {
      return highlightModelFace(el, key, on)
    } catch {
      return false
    }
  },
  exportJson() {
    if (S.source.mode === 'viewport') {
      try {
        return exportActiveModelJson()
      } catch {
        return null
      }
    }
    if (S.source.mode !== 'offline' || !S.source.json) return null
    return { json: S.source.json, filename: (S.source.id || 'model') + (S.source.isBb ? '.bbmodel' : '.json') }
  }
}

/* ── 模型列表 ─────────────────────────────────── */
