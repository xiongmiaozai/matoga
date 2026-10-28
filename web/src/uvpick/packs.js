/**
 * matoga - UV 贴图库选择器：包与材质组
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-tex-picker.js 按职责搬出，逻辑未改。
 */
import { apiUrl, setTexDragData, parseTexGroup } from '../utils.js'
import { S } from './state.js'
import { IMG_EXTS } from './consts.js'

export function packTexRawUrl(pack, relPath) {
  if (pack.kind === 'dir' && pack.root) {
    return apiUrl('/api/file/raw?path=' + encodeURIComponent(pack.root.replace(/\/+$/, '') + '/' + relPath))
  }
  const api = pack.source === 'mc' ? '/api/mc-packs' : '/api/mc-official'
  return apiUrl(api + '/' + encodeURIComponent(pack.name) + '/raw?path=' + encodeURIComponent(relPath))
}

/* 解析贴图角色：parseTexGroup 对非 core.IMG_EXTS 扩展（如 tga）返回 role='file'，
     此处统一当作 main（groupKey 去扩展名），确保 tga 等也能作为主图聚合 */
export function texRoleOf(name) {
  const p = parseTexGroup(name)
  if (p.role === 'file') {
    const dot = name.lastIndexOf('.')
    return { groupKey: dot > 0 ? name.slice(0, dot) : name, role: 'main' }
  }
  return p
}

/* 把包内扁平贴图文件聚合为材质组（按 目录+groupKey 聚合，避免跨目录同名合并）：
     材质组 = { key, name, main, normal, specular, height, emissive }，各角色为 { name, path, url } */
export function buildMaterials(files) {
  const map = new Map()
  for (const f of files) {
    const p = texRoleOf(f.name)
    const slash = f.path.lastIndexOf('/')
    const dir = slash >= 0 ? f.path.slice(0, slash) : ''
    const key = dir ? dir + '/' + p.groupKey : p.groupKey
    let g = map.get(key)
    if (!g) { g = { key, name: p.groupKey }; map.set(key, g) }
    g[p.role] = f
  }
  /* 仅展示含主图的材质组（材质球以主图为代表） */
  return [...map.values()].filter(g => g.main)
}

/* ── 数据加载（/api/asset/tex，一次拉全量包结构，聚合为材质组） ────────── */

export async function loadPacks() {
  if (S.packs.length || S.loadError) return
  try {
    const res = await fetch(apiUrl('/api/asset/tex'))
    const j = await res.json()
    if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
    const packs = (j.data && j.data.packs) || []
    S.packs = packs.map(p => {
      const files = []
      for (const g of (p.groups || [])) {
        for (const f of (g.files || [])) {
          if (!f || !f.path) continue
          const ext = (String(f.name || f.path).split('.').pop() || '').toLowerCase()
          if (!IMG_EXTS.has(ext)) continue
          files.push({ name: f.name, path: f.path, url: packTexRawUrl(p, f.path) })
        }
      }
      const materials = buildMaterials(files)
      return { source: p.source, name: p.name, kind: p.kind, root: p.root, label: p.name + '（' + materials.length + '）', materials }
    }).filter(p => p.materials.length)
    if (!S.packs.length) S.loadError = 'empty'
  } catch (e) {
    S.loadError = e.message || 'load fail'
  }
}

/* ── 渲染 ─────────────────────────────────── */


export function rebuildPackSelect() {
  if (!S.packSel) return
  S.packSel.innerHTML = ''
  S.packs.forEach((p, i) => {
    const opt = document.createElement('option')
    opt.value = String(i)
    opt.textContent = p.label
    S.packSel.appendChild(opt)
  })
  if (S.packIdx >= S.packs.length) S.packIdx = 0
  S.packSel.value = String(S.packIdx)
}

