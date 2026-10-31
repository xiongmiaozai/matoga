/**
 * matoga - MC 模型：路径与网络工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 原样搬出（正文逐字未改）。
 * 职责：原始资源 URL、缩略图缓存键、JSON/二进制拉取、父模型路径推断。
 */

import { fileUrl, joinPath, apiUrl } from '../url-utils.js'

/* isSpecialTexPath 由主文件注入（它依赖模型特有路径规则，反向 import 会成环） */
let _isSpecialTexPath = () => false

export function setHooks(h) {
  if (h.isSpecialTexPath) _isSpecialTexPath = h.isSpecialTexPath
}

export function rawUrl(api, packName, rel, fileRoot, any) {
  if (_isSpecialTexPath(rel)) {
    if (/^file:/i.test(rel)) return fileUrl(rel.replace(/^file:/i, ''))
    return rel
  }
  if (fileRoot) return fileUrl(joinPath(fileRoot, rel))
  const q = any ? '&any=1' : ''
  return apiUrl(`${api}/${encodeURIComponent(packName)}/raw?path=${encodeURIComponent(rel)}${q}`)
}

export function texCacheKey(api, packName, texPath, fileRoot) {
  if (_isSpecialTexPath(texPath)) return 'sp:' + texPath
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

export function parentModelPath(parent) {
  if (typeof parent !== 'string' || !parent) return null
  let ns = 'minecraft',
    rest = parent
  const ci = parent.indexOf(':')
  if (ci >= 0) {
    ns = parent.slice(0, ci)
    rest = parent.slice(ci + 1)
  }
  if (!rest) return null
  return `assets/${ns}/models/${rest}.json`
}
