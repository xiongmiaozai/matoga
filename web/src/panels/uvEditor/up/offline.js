/**
 * matoga - UV 编辑器面板：离线模型读写
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 panel.js 按职责搬出，逻辑未改。
 */
import { showToast } from '../../../core.js'
import { apiUrl } from '../../../utils.js'
import {
  buildMcLayout, buildBbLayout,
  getLastModelLayout,
  updateModelFaceUv, updateModelFaceRotation, updateModelTexture, clearModelTexture,
  highlightModelFace, exportActiveModelJson,
  texUrlToRef, writeMcTexRef, texPathForRef,
} from '../../../mc-model-viewer.js'
import { t, onLocaleChange } from '../../../i18n.js'
import { S } from './state.js'
import { CM_API, IM_API, api } from './context.js'
import { updateHint, updateSaveButton } from './status.js'

export async function loadModelOptions() {
  const groups = [
    { key: 'im', api: IM_API, labelKey: 'uv.panelSourceIm' },
    { key: 'cm', api: CM_API, labelKey: 'uv.panelSourceCm' },

  ]
  const lists = await Promise.all(groups.map(g => api('GET', g.api).then(d => (d && d.models) || []).catch(() => [])))
  S.options = [{ kind: 'viewport', id: '', name: '' }]
  rebuildSelect(lists, groups)
}

export function rebuildSelect(lists, groups) {
  if (!S.sel) return
  const prev = S.sel.value
  S.sel.innerHTML = ''

  const vpOpt = document.createElement('option')
  vpOpt.value = 'viewport'
  vpOpt.textContent = t('uv.panelSourceViewport')
  S.sel.appendChild(vpOpt)

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
      S.options.push({ kind: g.key, id: m.id, name: m.name || m.id })
    }
    S.sel.appendChild(og)
  })

  if (prev && [...sel.options].some(o => o.value === prev)) S.sel.value = prev
}

/* ── 离线打开 ─────────────────────────────────── */

export async function openOfflineModel(kind, id) {
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
      const textures = (json.textures && typeof json.textures === 'object') ? json.textures : {}
      if (!elements.length) throw new Error('no elements')
      layout = buildMcLayout(elements, textures, undefined, undefined)
    }
    if (!layout || !layout.elements.length) throw new Error('empty layout')

    S.source = { mode: 'offline', kind, id, json, layout, isBb }
    updateHint()
    if (S.editor) S.editor.refresh()
  } catch (e) {
    console.error('[uv-S.editor-panel] open', e)
    showToast(t('uv.panelLoadFail'))
    if (S.sel) S.sel.value = 'viewport'
    S.source = { mode: 'viewport' }
    updateHint()
    if (S.editor) S.editor.refresh()
  }
}

/* ── 保存（离线模式） ─────────────────────────────────── */

/* bbmodel 内嵌贴图烘焙：编辑中被替换为贴图库 raw URL 的槽位（layout.url ≠ json.source
   且非 dataURL）→ fetch 转 dataURL 写回（bbmodel 标准仅支持 dataURL 内嵌）；
   转换后回写 layout.url 保持一致，避免下次保存重复 fetch */
export async function bakeTexUrls(json, layout) {
  if (!Array.isArray(json.textures) || !layout || !Array.isArray(layout.texOrigin)) return
  for (let rawIdx = 0; rawIdx < layout.texOrigin.length; rawIdx++) {
    const layIdx = layout.texOrigin[rawIdx]
    const raw = json.textures[rawIdx]
    const lay = (layIdx >= 0 && layIdx < layout.textures.length) ? layout.textures[layIdx] : null
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
      const dataUrl = await new Promise((resolve) => {
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

export async function saveOfflineModel() {
  if (S.source.mode !== 'offline' || !S.source.json) return
  const { kind, id, json, layout } = S.source
  S.saveBtn.disabled = true
  try {
    await bakeTexUrls(json, layout)
    if (kind === 'im') {
      await api('PUT', IM_API + '/' + encodeURIComponent(id), { data: JSON.stringify(json, null, 2) })

    } else if (kind === 'cm') {
      await api('PUT', CM_API + '/' + encodeURIComponent(id), { model: JSON.stringify(json) })
    } else {
      throw new Error('unsupported kind')
    }
    if (S.editor) S.editor.markClean()
    updateHint()
    showToast(t('uv.panelSaved'))
    loadModelOptions().catch(() => {})
  } catch (e) {
    console.error('[uv-S.editor-panel] save', e)
    showToast(t('uv.panelSaveFail'))
    updateSaveButton()
  }
}

/* ── 状态 UI ─────────────────────────────────── */

