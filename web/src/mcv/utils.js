/**
 * matoga - 材质 3D 视口：utils
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */

import * as THREE from 'three'
import { isSpecialTexPath } from './tex-refs.js'

export function fileUrl(p) { return '/api/file/raw?path=' + encodeURIComponent(p) }
export function joinPath(base, rel) {
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  return b + '/' + r
}


export function apiUrl(p) {
  return (typeof window !== 'undefined' && window.matogaCore && window.matogaCore.url) ? window.matogaCore.url(p) : p
}

/* 资源 raw URL 构造：包模式走 /api/pack/<name>/raw?path=<rel>（any=1 放行 .mcmeta 等扩展）；
    文件根模式（对比结果等任意文件夹）走 /api/file/raw?path=<join(root,rel)>（file 接口直接读任意路径，无需 any）；
    扩展引用（data:/file:/URL）直接可加载，原样返回 */
export function rawUrl(api, packName, rel, fileRoot, any) {
  if (isSpecialTexPath(rel)) {
    if (/^file:/i.test(rel)) return fileUrl(rel.replace(/^file:/i, ''))
    return rel
  }
  if (fileRoot) return fileUrl(joinPath(fileRoot, rel))
  const q = any ? '&any=1' : ''
  return apiUrl(`${api}/${encodeURIComponent(packName)}/raw?path=${encodeURIComponent(rel)}${q}`)
}

/* 贴图缓存键：包模式与文件根模式命名空间隔离，避免对比场景与包场景贴图混缓存 */
export function texCacheKey(api, packName, texPath, fileRoot) {
  if (isSpecialTexPath(texPath)) return 'sp:' + texPath
  return fileRoot ? `file:${fileRoot}:${texPath}` : `${api}:${packName}:${texPath}`
}

export async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const j = await res.json()
  /* raw 接口失败响应为 200 + {ok:false} 包裹（fail() 不改状态码）：显式判定失败，
     否则错误对象被当作模型 JSON 使用 → parent 链静默丢失 elements/textures */
  if (j && j.ok === false) throw new Error((j && j.msg) || 'bad response')
  return j
}

export async function fetchOkData(path) {
  const res = await fetch(apiUrl(path))
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
  return j.data
}


