/**
 * matoga - 总资产库：sections-model
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { addNodeAt, addTextureAt, loadPreset, saveNodeProject, loadNodeProject, serializeGraphData, loadCanvasPresetGraph } from '../node-canvas.js'
import { t, onLocaleChange } from '../i18n.js'
import { uiPrompt, uiConfirm } from '../ui-dialog.js'
import { ensureModelThumb, observeModelThumbs } from '../model-thumb.js'
import { openCreateModelDialog, previewCustomModel } from '../create-model-dialog.js'
import { el, shade, loadList, saveList } from './dom.js'
import { tryActivateModelViewport, viewMcModelAsset, viewImportedModelAsset } from './model-view.js'
import { S, BROWSE_CLICK_DELAY, refreshVia } from './store.js'
import { assetApiCall, persistFavorites, persistRecent } from './api.js'
import { hideDetail } from './detail.js'
import { buildSection, collapsedSet, modelCollapsedSet, saveCollapsed, saveModelCollapsed } from './collapse.js'
import { buildAssetGroup } from './sections-tex.js'
import { officialBadge } from './sections-official.js'
import { openPackBrowser } from './pack-browser.js'
import { sortItems } from './items.js'
import { makeCard } from './card.js'
import { MODEL_JSON_RE, hdriThumbUrl, mcRawUrl, packApiFor, userModelFilePath, IMPORT_API, CUSTOM_API } from './helpers.js'
import { splitGroupsByPrefix } from '../model-prefix.js'

/* 在系统文件管理器中打开某类模型的专属本地目录（imported / custom） */
function openModelDir(kind) {
  const dir = S.modelDirs[kind]
  if (!dir) { showToast(t('asset.openLocalDirUnavailable')); return }
  window.api.openPath(dir).then((err) => { if (err) showToast(t('asset.openLocalDirUnavailable')) })
}

function collectModelGroups() {
  const groups = []
  const byKey = new Map()
  const addGroup = (key, label) => {
    let g = byKey.get(key)
    if (!g) { g = { key, label, items: [] }; byKey.set(key, g); groups.push(g) }
    return g
  }

  /* 导入模型（data/imported-models，用户主动上传的 .bbmodel / MC .json，专属目录） */
  const imGroup = addGroup('im', t('asset.importedModelGroup'))
  imGroup.openDir = () => openModelDir('imported')
  for (const m of S.importedModels || []) {
    if (!m || !m.id) continue
    imGroup.items.push({
      key: 'model:im:' + m.id, name: m.name || m.id, thumb: null, icon: 'i-cube',
      color: '#e8993c', type: 'model', path: 'im:' + m.id, mtime: m.mtime || 0,
      role: 'model', badge: m.model_format || m.format || m.ext || null,
      modelThumb: { kind: 'im', id: m.id, path: 'im:' + m.id, mtime: m.mtime || 0 },
      modelFile: userModelFilePath(S.modelDirs.imported, m),
      modelDelete: { api: IMPORT_API, id: m.id },
      onAdd: () => viewImportedModelAsset(m.id, m.name || m.id),

    })
  }

  /* 自定义模型（data/custom-models，从模板创建，专属目录） */
  const cmGroup = addGroup('cm', t('asset.cmModelGroup'))
  cmGroup.openDir = () => openModelDir('custom')
  for (const m of S.customModels || []) {
    if (!m || !m.id) continue
    cmGroup.items.push({
      key: 'model:cm:' + m.id, name: m.name || m.id, thumb: null, icon: 'i-cube',
      color: '#5fd0a0', type: 'model', path: 'cm:' + m.id, mtime: m.mtime || 0,
      role: 'model', badge: m.template || null,
      modelFile: userModelFilePath(S.modelDirs.custom, m),
      modelDelete: { api: CUSTOM_API, id: m.id },
      onAdd: () => previewCustomModel(m.id, m.name || m.id),
    })
  }


  /* MC 材质包 + 官方包（/api/asset/model）：每包按 models/ 第一级类别分组 */
  for (const p of S.modelPacks || []) {
    for (const g of p.groups || []) {
      const gk = 'modelpack:' + p.source + ':' + p.name + '/' + g.key
      const label = g.key ? p.name + ' · ' + g.key : p.name
      const grp = addGroup(gk, label)
      for (const f of g.files || []) {
        /* 防御：仅 .json 扩展名才作为模型展示 */
        if (!f.name || !MODEL_JSON_RE.test(f.name)) continue
        const modelPath = 'packmodel:' + p.source + ':' + p.name + '/' + f.path
        grp.items.push({
          key: 'model:' + modelPath, name: f.name, thumb: null, icon: 'i-cube',
          color: '#6f9ff0', type: 'model', path: modelPath, mtime: f.mtime || 0,
          role: 'model', badge: g.key || null,
          modelThumb: { kind: 'mc', api: packApiFor(p.source), packName: p.name, rel: f.path, path: modelPath, mtime: f.mtime || 0 },
          onAdd: () => viewMcModelAsset(p.source, p.name, f.path, f.name),

        })
      }
    }
  }

  const pinOrder = ['im', 'cm']
  const pinned = groups.filter(g => pinOrder.includes(g.key)).sort((a, b) => pinOrder.indexOf(a.key) - pinOrder.indexOf(b.key))
  const rest = groups.filter(g => !pinOrder.includes(g.key)).sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  /* 每组内按名称前缀进一步细分（区分 oak/stone 等不同系列；全部同桶时保持原组） */
  const out = []
  for (const g of [...pinned, ...rest]) {
    if (!g.items.length) continue
    out.push(...splitGroupsByPrefix(g.key, g.label, g.items, t('asset.modelUngrouped')))
  }
  return out
}

async function uploadModelToLibrary() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,.bbmodel'
  input.onchange = async () => {
    const f = input.files && input.files[0]
    if (!f) return
    try {
      const text = await f.text()
      const name = f.name.replace(/\.(json|bbmodel)$/i, '')
      const ext = /\.bbmodel$/i.test(f.name) ? 'bbmodel' : 'json'
      await assetApiCall('POST', IMPORT_API, { name, data: text, ext })
      showToast(t('asset.toastModelImported', { name }))
      await refreshVia()
    } catch (e) {
      showToast(t('asset.toastModelUploadFail', { msg: e.message || '' }))
    }
  }
  input.click()
}

/* 删除用户模型（导入模型 / 自定义模型）：确认后调用 DELETE，清理收藏与最近记录并刷新 */
export async function deleteUserModel(item) {
  const d = item.modelDelete
  if (!d || !d.id) return
  if (!await uiConfirm({ title: t('asset.modelSection'), message: t('asset.modelDeleteConfirm', { name: item.name }), danger: true })) return
  try {
    await assetApiCall('DELETE', d.api + '/' + encodeURIComponent(d.id))
    S.favorites = S.favorites.filter(f => f.key !== item.key)
    S.recent = S.recent.filter(r => r.key !== item.key)
    persistFavorites()
    persistRecent()
    showToast(t('asset.toastModelDeleted', { name: item.name }))
    if (S.detailCurrent === item) hideDetail()
    await refreshVia()
  } catch (e) {
    showToast(t('asset.toastModelDeleteFail', { msg: e.message || '' }))
  }
}

export function buildModelSection() {
  const groups = collectModelGroups()
  const total = groups.reduce((s, g) => s + g.items.length, 0)
  const loading = S.modelPacks === null

  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'model'
  if (collapsedSet.has('model')) sec.classList.add('collapsed')
  const head = el('div', 'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.modelSection')}</span><span class="cnt">${total}</span>`)
  const uploadBtn = el('button', 'asset-lib-section-btn')
  uploadBtn.type = 'button'
  uploadBtn.title = t('asset.uploadModelTitle')
  uploadBtn.innerHTML = `<svg class="ico ico-sm"><use href="#i-plus"/></svg><span>${t('asset.uploadModel')}</span>`
  uploadBtn.addEventListener('click', (e) => { e.stopPropagation(); uploadModelToLibrary() })
  head.appendChild(uploadBtn)
  const newBtn = el('button', 'asset-lib-section-btn')
  newBtn.type = 'button'
  newBtn.title = t('asset.newModelTitle')
  newBtn.innerHTML = `<svg class="ico ico-sm"><use href="#i-cube"/></svg><span>${t('asset.newModel')}</span>`
  newBtn.addEventListener('click', (e) => { e.stopPropagation(); openCreateModelDialog({ onCreated: () => refreshVia() }) })
  head.appendChild(newBtn)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) { collapsedSet.add('model'); saveCollapsed(collapsedSet) }
    else { collapsedSet.delete('model'); saveCollapsed(collapsedSet) }
  })
  sec.appendChild(head)

  if (!total && loading) {
    const grid = el('div', 'asset-lib-grid')
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
    sec.appendChild(grid)
    return sec
  }
  if (!total && S.loadErrors.model) {
    const grid = el('div', 'asset-lib-grid')
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: S.loadErrors.model })))
    sec.appendChild(grid)
    return sec
  }
  if (!total) return null

  const wrap = el('div', 'asset-lib-groups')
  for (const g of groups) wrap.appendChild(buildAssetGroup(g, modelCollapsedSet, saveModelCollapsed))
  if (S.loadErrors.model) wrap.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: S.loadErrors.model })))
  observeModelThumbs(wrap)
  sec.appendChild(wrap)
  return sec
}

export function buildHdriSection() {
  const items = (S.hdriEntries || []).map(e => ({
    key: 'hdri:' + e.fullPath, name: e.name, thumb: hdriThumbUrl(e.fullPath),
    type: 'hdri', path: e.fullPath, mtime: e.mtime || 0, role: 'preset',
    onAdd: () => addNodeAt('hdr'),
  }))
  return buildSection('hdri', t('asset.hdriSection'), items, S.loadErrors.hdri, S.hdriEntries === null)
}

export function buildMcSection() {
  /* mc-packs 下每个资源包是一个「包媒体」：整包卡片储存，双击打开浏览包内贴图 */
  const items = (S.mcEntries || []).map(p => {
    const it = {
      key: 'mc:' + p.fullPath, name: p.name,
      thumb: p.firstTexture ? mcRawUrl(p.name, p.firstTexture) : null,
      type: 'mc', path: p.fullPath, mtime: p.mtime || 0,
      badge: officialBadge(p), pack: p,
      onAdd: () => { if (p.fullPath) window.api.showInFolder(p.fullPath) },
    }
    it.onBrowse = () => openPackBrowser(it)
    return it
  })
  const sorted = sortItems(items)
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'mc'
  if (collapsedSet.has('mc')) sec.classList.add('collapsed')
  const head = el('div', 'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.mcSection')}</span><span class="cnt">${sorted.length}</span>`)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) { collapsedSet.add('mc'); saveCollapsed(collapsedSet) }
    else { collapsedSet.delete('mc'); saveCollapsed(collapsedSet) }
  })
  sec.appendChild(head)

  const grid = el('div', 'asset-lib-grid')
  if (S.viewMode === 'list') grid.classList.add('list-view')
  if (S.mcEntries === null) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (S.loadErrors.mc) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: S.loadErrors.mc })))
  } else if (!sorted.length) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.mcEmpty')))
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

/* ── MC 官方材质包（pack.mcmeta 版本分析 / 包内贴图浏览 / 重命名）──── */

/* officialRawUrl / mcRawUrl / packRawUrl 已移至 asset-lib/helpers.js */

