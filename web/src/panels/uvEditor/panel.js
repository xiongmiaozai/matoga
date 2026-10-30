/**
 * matoga - UV 编辑器面板（独立 UV 工作区）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT.
 *
 * 由 panel-loader 动态加载，export init() 供加载器调用。
 * 画布 / 编辑 / 导出内核复用 uv-editor-core.js（与 UV 浮窗同源）。
 *
 * 模型来源（下拉选择）：
 *  - 「3D 视口当前模型」：与浮窗完全等价的联动模式（编辑实时写回视口模型 + 高亮联动）
 *  - 导入模型 / 自定义模型：离线打开（fetch JSON → buildMcLayout / buildBbLayout），
 *    编辑写回本地 JSON 副本，「保存」PUT 回模型库（im 新增覆盖更新接口，cm 复用已有 PUT）
 *
 * 离线模式的贴图：
 *  - bbmodel 内嵌贴图（dataURL）正常显示，替换后随保存写回 json.textures[].source
 *  - MC .json 引用包内贴图（无包上下文）：底图缺失红斜纹警示，UV 几何编辑不受影响
 */

import { showToast } from '../../core.js'
import { apiUrl } from '../../utils.js'
import { createUvEditor } from '../../uv-editor-core.js'
import {
  buildMcLayout,
  buildBbLayout,
  getLastModelLayout,
  getLastModelLayoutPair,
  updateModelFaceUv,
  updateModelFaceRotation,
  updateModelTexture,
  clearModelTexture,
  highlightModelFace,
  exportActiveModelJson,
  getActiveModelSource,
  texUrlToRef,
  writeMcTexRef,
  texPathForRef
} from '../../mc-model-viewer.js'
import { isCustomModelActive } from '../../material3d.js'
import { t, onLocaleChange } from '../../i18n.js'

const IM_API = '/api/imported-models'
const CM_API = '/api/custom-models'

let editor = null
let sel = null
let saveBtn = null
let hintEl = null

/* 当前编辑对象：viewport 联动模式或离线模式（持有 JSON 副本与 layout） */
let source = { mode: 'viewport' }

/* 模型列表缓存（选项 value → { kind, id, name }） */
let options = []

async function api(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
  return j.data
}

/* ── 数据源与钩子（按 source.mode 动态分派） ────────────────── */

function currentLayout() {
  if (source.mode === 'viewport') {
    return isCustomModelActive() ? getLastModelLayout() : null
  }
  return source.layout || null
}

function currentLayoutPair() {
  if (source.mode === 'viewport') {
    return isCustomModelActive() ? getLastModelLayoutPair() : null
  }
  return null
}

function offlineWriteFace(el, key, prop, val) {
  if (!el || !el.faces || typeof el.faces !== 'object' || !el.faces[key] || typeof el.faces[key] !== 'object') return
  el.faces[key][prop] = val
}

const hooks = {
  onFaceUv(el, key, uv) {
    if (source.mode === 'viewport') {
      try {
        updateModelFaceUv(el, key, uv)
      } catch {}
    } else {
      offlineWriteFace(el, key, 'uv', [...uv])
    }
  },
  onFaceRotation(el, key, rotation) {
    if (source.mode === 'viewport') {
      try {
        updateModelFaceRotation(el, key, rotation)
      } catch {}
    } else {
      offlineWriteFace(el, key, 'rotation', rotation)
    }
  },
  onTexture(texIndex, texUrl, layout, extra) {
    if (source.mode === 'viewport') {
      /* 空串 = 移除材质（面变纯色）；extra（材质球 normal/specular）→ 3D 视口 PBR 预览 */
      return texUrl === '' ? clearModelTexture(texIndex, layout) : updateModelTexture(texIndex, texUrl, layout, extra)
    }
    /* 离线：bbmodel 内嵌贴图写回本地 JSON 副本（保存时持久化）。
       贴图库 raw URL 无法直接内嵌（bbmodel 标准仅支持 dataURL）→ 异步 fetch 转 dataURL 写回；
       保存时 bakeTexUrls 兜底（此处转换失败/未完成的情况） */
    if (source.mode === 'offline' && source.isBb) {
      const origin = layout && Array.isArray(layout.texOrigin) ? layout.texOrigin : null
      const jsonTextures = Array.isArray(source.json.textures) ? source.json.textures : null
      if (!origin || !jsonTextures) return Promise.resolve()
      const writeBack = val => {
        for (let rawIdx = 0; rawIdx < origin.length; rawIdx++) {
          if (origin[rawIdx] === texIndex && jsonTextures[rawIdx]) jsonTextures[rawIdx].source = val
        }
      }
      const url = String(texUrl || '')
      if (url === '') {
        /* 移除材质：bbmodel 贴图 source 置空（保存时持久化） */
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
      source.mode === 'offline' &&
      !source.isBb &&
      source.json &&
      source.json.textures &&
      typeof source.json.textures === 'object'
    ) {
      const lay = layout || source.layout
      const oldPath = lay && Array.isArray(lay.texPaths) ? lay.texPaths[texIndex] : null
      if (typeof oldPath === 'string') {
        const ref = texUrlToRef(texUrl, null)
        if (ref != null) {
          writeMcTexRef(source.json.textures, oldPath, ref)
          lay.texPaths[texIndex] = texPathForRef(ref)
        }
      }
    }
    return Promise.resolve()
  },
  highlightFace(el, key, on) {
    if (source.mode !== 'viewport') return false
    try {
      return highlightModelFace(el, key, on)
    } catch {
      return false
    }
  },
  exportJson() {
    if (source.mode === 'viewport') {
      try {
        return exportActiveModelJson()
      } catch {
        return null
      }
    }
    if (source.mode !== 'offline' || !source.json) return null
    return { json: source.json, filename: (source.id || 'model') + (source.isBb ? '.bbmodel' : '.json') }
  }
}

/* ── 模型列表 ─────────────────────────────────── */

async function loadModelOptions() {
  const groups = [
    { key: 'im', api: IM_API, labelKey: 'uv.panelSourceIm' },
    { key: 'cm', api: CM_API, labelKey: 'uv.panelSourceCm' }
  ]
  const lists = await Promise.all(
    groups.map(g =>
      api('GET', g.api)
        .then(d => (d && d.models) || [])
        .catch(() => [])
    )
  )
  options = [{ kind: 'viewport', id: '', name: '' }]
  rebuildSelect(lists, groups)
}

function rebuildSelect(lists, groups) {
  if (!sel) return
  const prev = sel.value
  sel.innerHTML = ''

  const vpOpt = document.createElement('option')
  vpOpt.value = 'viewport'
  vpOpt.textContent = t('uv.panelSourceViewport')
  sel.appendChild(vpOpt)

  lists.forEach((models, gi) => {
    if (!models.length) return
    const g = groups[gi]
    const og = document.createElement('optgroup')
    og.label = t(g.labelKey)
    for (const m of models) {
      if (!m || !m.id) continue
      const opt = document.createElement('option')
      opt.value = g.key + ':' + m.id
      opt.textContent = m.name || m.id
      og.appendChild(opt)
      options.push({ kind: g.key, id: m.id, name: m.name || m.id })
    }
    sel.appendChild(og)
  })

  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev
}

/* ── 离线打开 ─────────────────────────────────── */

async function openOfflineModel(kind, id) {
  try {
    let json = null
    if (kind === 'im') {
      const d = await api('GET', IM_API + '/' + encodeURIComponent(id))
      json = d && d.json
    } else if (kind === 'cm') {
      json = await api('GET', CM_API + '/' + encodeURIComponent(id) + '/raw')
    }
    if (!json || typeof json !== 'object') throw new Error('bad model')

    const isBb = !!(json.meta && (json.meta.format === 'bbmodel' || json.meta.model_format))
    let layout = null
    if (isBb) {
      if (!Array.isArray(json.elements) || !json.elements.length) throw new Error('no elements')
      layout = buildBbLayout(json)
    } else {
      const elements = Array.isArray(json.elements) ? json.elements : []
      const textures = json.textures && typeof json.textures === 'object' ? json.textures : {}
      if (!elements.length) throw new Error('no elements')
      layout = buildMcLayout(elements, textures, undefined, undefined)
    }
    if (!layout || !layout.elements.length) throw new Error('empty layout')

    source = { mode: 'offline', kind, id, json, layout, isBb }
    updateHint()
    if (editor) editor.refresh()
  } catch (e) {
    console.error('[uv-editor-panel] open', e)
    showToast(t('uv.panelLoadFail'))
    if (sel) sel.value = 'viewport'
    source = { mode: 'viewport' }
    updateHint()
    if (editor) editor.refresh()
  }
}

/* ── 同步到 MC 资源包（使 Minecraft 可直接加载） ────────────────── */

async function syncToPack(kind, id, json) {
  let packs = []
  try {
    const data = await api('GET', '/api/mc-packs/list')
    const arr = (data && data.packs) || []
    packs = arr.map(p => (typeof p === 'string' ? p : p.name)).filter(Boolean)
  } catch {}
  if (!packs.length) return
  const isBb = !!(json && json.meta && (json.meta.format === 'bbmodel' || json.meta.model_format))
  if (isBb) {
    showToast(t('uv.panelSyncSkipBb'))
    return
  }
  for (const packName of packs) {
    try {
      if (kind === 'cm') {
        await api('POST', CM_API + '/' + encodeURIComponent(id) + '/sync-pack', { packName })
      } else if (kind === 'im') {
        const ns = inferNamespace(json) || 'minecraft'
        const name = id || 'model'
        const cat = inferModelCategory(json)
        const relPath = `assets/${ns}/models/${cat}/${name}.json`
        await api('POST', IM_API + '/' + encodeURIComponent(id) + '/sync-pack', { packName, relPath })
      }
    } catch (e) {
      console.warn('[uv-editor-panel] sync-pack', e)
    }
  }
}

function inferNamespace(json) {
  const tex = json && json.textures
  if (tex && typeof tex === 'object') {
    for (const k in tex) {
      const v = String(tex[k] || '')
      const m = v.match(/^([a-z0-9_]+):/)
      if (m) return m[1]
    }
  }
  return null
}

function inferModelCategory(json) {
  const parent = json && typeof json.parent === 'string' ? json.parent : ''
  if (/^item\//.test(parent)) return 'item'
  if (/^block\//.test(parent)) return 'block'
  const tex = json && json.textures
  if (tex && typeof tex === 'object') {
    for (const k in tex) {
      if (/^item\//.test(k)) return 'item'
      if (/^block\//.test(k)) return 'block'
    }
  }
  return 'block'
}

/* ── 保存（离线模式） ─────────────────────────────────── */

/* bbmodel 内嵌贴图烘焙：编辑中被替换为贴图库 raw URL 的槽位（layout.url ≠ json.source
   且非 dataURL）→ fetch 转 dataURL 写回（bbmodel 标准仅支持 dataURL 内嵌）；
   转换后回写 layout.url 保持一致，避免下次保存重复 fetch */
async function bakeTexUrls(json, layout) {
  if (!Array.isArray(json.textures) || !layout || !Array.isArray(layout.texOrigin)) return
  for (let rawIdx = 0; rawIdx < layout.texOrigin.length; rawIdx++) {
    const layIdx = layout.texOrigin[rawIdx]
    const raw = json.textures[rawIdx]
    const lay = layIdx >= 0 && layIdx < layout.textures.length ? layout.textures[layIdx] : null
    if (!raw || typeof raw.source !== 'string' || !lay || typeof lay.url !== 'string') continue
    if (lay.url === raw.source) continue
    if (lay.url.startsWith('data:') || /^https?:\/\//i.test(lay.url)) {
      raw.source = lay.url
      continue
    }
    if (!lay.url.startsWith('/')) continue
    try {
      const res = await fetch(apiUrl(lay.url))
      if (!res.ok) continue
      const blob = await res.blob()
      const dataUrl = await new Promise(resolve => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => resolve(null)
        r.readAsDataURL(blob)
      })
      if (dataUrl && dataUrl.startsWith('data:')) {
        raw.source = dataUrl
        lay.url = dataUrl
      }
    } catch {}
  }
}

async function saveOfflineModel() {
  let kind, id, json, layout
  if (source.mode === 'offline') {
    if (!source.json) return
    kind = source.kind
    id = source.id
    json = source.json
    layout = source.layout
  } else if (source.mode === 'viewport') {
    const ms = getActiveModelSource()
    if (!ms || !ms.id) return
    const exp = exportActiveModelJson()
    if (!exp || !exp.json) return
    kind = ms.kind
    id = ms.id
    json = exp.json
    layout = currentLayout()
  } else {
    return
  }
  saveBtn.disabled = true
  try {
    await bakeTexUrls(json, layout)
    if (kind === 'im') {
      await api('PUT', IM_API + '/' + encodeURIComponent(id), { data: JSON.stringify(json, null, 2) })
    } else if (kind === 'cm') {
      await api('PUT', CM_API + '/' + encodeURIComponent(id), { model: JSON.stringify(json) })
    } else {
      throw new Error('unsupported kind')
    }
    if (editor) editor.markClean()
    updateHint()
    showToast(t('uv.panelSaved'))
    syncToPack(kind, id, json).catch(() => {})
    loadModelOptions().catch(() => {})
  } catch (e) {
    console.error('[uv-editor-panel] save', e)
    showToast(t('uv.panelSaveFail'))
    updateSaveButton()
  }
}

/* ── 状态 UI ─────────────────────────────────── */

function canSave() {
  if (source.mode === 'offline') return !!source.json
  if (source.mode === 'viewport') {
    const ms = getActiveModelSource()
    return !!(ms && (ms.kind === 'im' || ms.kind === 'cm') && ms.id)
  }
  return false
}

function updateSaveButton() {
  if (!saveBtn) return
  const dirty = !!(editor && editor.isDirty())
  saveBtn.disabled = !(canSave() && dirty)
  saveBtn.classList.toggle('dirty', canSave() && dirty)
}

function updateHint() {
  if (!hintEl) return
  const dirty = !!(editor && editor.isDirty())
  if (source.mode === 'viewport') {
    const ms = getActiveModelSource()
    if (ms && ms.id) {
      hintEl.textContent = (ms.kind === 'cm' ? '自定义·' : '导入·') + ms.id
    } else {
      hintEl.textContent = t('uv.panelViewportHint')
    }
  } else {
    hintEl.textContent = (source.name || source.id || '') + (source.isBb ? ' · bbmodel' : ' · mc json')
  }
  hintEl.classList.toggle('dirty', dirty && canSave())
  updateSaveButton()
}

/* ── 初始化（panel-loader 调用，幂等） ─────────────────────────────────── */

let inited = false

export function init() {
  if (inited) return
  const host = document.getElementById('uvEditorHost')
  if (!host) return
  inited = true

  sel = document.getElementById('uvModelSel')
  saveBtn = document.getElementById('uvSaveBtn')
  hintEl = document.getElementById('uvPanelHint')
  const refreshBtn = document.getElementById('uvModelRefreshBtn')

  editor = createUvEditor({
    container: host,
    visible: () => host.isConnected && host.clientWidth > 0,
    getLayout: currentLayout,
    getLayoutPair: currentLayoutPair,
    hooks,
    onDirty: () => updateHint()
  })

  if (sel) {
    sel.value = 'viewport'
    sel.addEventListener('change', () => {
      const v = sel.value
      if (v === 'viewport' || !v) {
        source = { mode: 'viewport' }
        updateHint()
        if (editor) editor.refresh()
        return
      }
      const ci = v.indexOf(':')
      if (ci <= 0) return
      const kind = v.slice(0, ci)
      const id = v.slice(ci + 1)
      openOfflineModel(kind, id)
    })
  }
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadModelOptions().catch(() => {}))
  if (saveBtn) saveBtn.addEventListener('click', () => saveOfflineModel())

  onLocaleChange(() => {
    updateHint()
    loadModelOptions().catch(() => {})
  })

  loadModelOptions().catch(() => {})
}
