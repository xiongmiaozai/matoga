/**
 * matoga - MC 模型：AssetCollect
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：收集分组与分区构建（贴图/模型分组、分区渲染）
 */

import { state, IMG_EXTS } from '../core.js'
import { t } from '../i18n.js'
import { addTextureAt } from '../node-canvas.js'
import { escAttr } from '../utils.js'
import { observeModelThumbs } from '../model-thumb.js'
import { previewCustomModel, openCreateModelDialog } from '../create-model-dialog.js'
import { splitGroupsByPrefix } from '../model-prefix.js'

/* 主文件函数（注入） */
let _isImg = (...a) => undefined
let _thumbUrl = (...a) => undefined
let _classifyByRole = (...a) => undefined
let _packTexThumbUrl = (...a) => undefined
let _addPackTextureToCanvas = (...a) => undefined
let _el = (...a) => undefined
let _sortItems = (...a) => undefined
let _makeCard = (...a) => undefined
let _applyFilter = (...a) => undefined
let _saveTexCollapsed = (...a) => undefined
let _saveCollapsed = (...a) => undefined
let _openModelDir = (...a) => undefined
let _userModelFilePath = (...a) => undefined
let _viewImportedModelAsset = (...a) => undefined
let _packApiFor = (...a) => undefined
let _viewMcModelAsset = (...a) => undefined
let _uploadModelToLibrary = (...a) => undefined
let _refreshAssetLibrary = (...a) => undefined
let _saveModelCollapsed = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get_collapsedSet = () => undefined
let _get_TEX_GROUP_PAGE = () => undefined
let _get_texCollapsedSet = () => undefined
let _get_loadErrors = () => undefined
let _get_importedModels = () => undefined
let _get_modelDirs = () => undefined
let _get_IMPORT_API = () => undefined
let _get_customModels = () => undefined
let _get_CUSTOM_API = () => undefined
let _get_MODEL_JSON_RE = () => undefined
let _get_modelCollapsedSet = () => undefined
let _get_texPacks = () => undefined
let _set_texPacks = () => {}
let _get_viewMode = () => undefined
let _set_viewMode = () => {}
let _get_modelPacks = () => undefined
let _set_modelPacks = () => {}

export function setHooks(h) {
  if (h.isImg) _isImg = h.isImg
  if (h.thumbUrl) _thumbUrl = h.thumbUrl
  if (h.classifyByRole) _classifyByRole = h.classifyByRole
  if (h.packTexThumbUrl) _packTexThumbUrl = h.packTexThumbUrl
  if (h.addPackTextureToCanvas) _addPackTextureToCanvas = h.addPackTextureToCanvas
  if (h.el) _el = h.el
  if (h.sortItems) _sortItems = h.sortItems
  if (h.makeCard) _makeCard = h.makeCard
  if (h.applyFilter) _applyFilter = h.applyFilter
  if (h.saveTexCollapsed) _saveTexCollapsed = h.saveTexCollapsed
  if (h.saveCollapsed) _saveCollapsed = h.saveCollapsed
  if (h.openModelDir) _openModelDir = h.openModelDir
  if (h.userModelFilePath) _userModelFilePath = h.userModelFilePath
  if (h.viewImportedModelAsset) _viewImportedModelAsset = h.viewImportedModelAsset
  if (h.packApiFor) _packApiFor = h.packApiFor
  if (h.viewMcModelAsset) _viewMcModelAsset = h.viewMcModelAsset
  if (h.uploadModelToLibrary) _uploadModelToLibrary = h.uploadModelToLibrary
  if (h.refreshAssetLibrary) _refreshAssetLibrary = h.refreshAssetLibrary
  if (h.saveModelCollapsed) _saveModelCollapsed = h.saveModelCollapsed
  if (h.get_collapsedSet) _get_collapsedSet = h.get_collapsedSet
  if (h.get_TEX_GROUP_PAGE) _get_TEX_GROUP_PAGE = h.get_TEX_GROUP_PAGE
  if (h.get_texCollapsedSet) _get_texCollapsedSet = h.get_texCollapsedSet
  if (h.get_loadErrors) _get_loadErrors = h.get_loadErrors
  if (h.get_importedModels) _get_importedModels = h.get_importedModels
  if (h.get_modelDirs) _get_modelDirs = h.get_modelDirs
  if (h.get_IMPORT_API) _get_IMPORT_API = h.get_IMPORT_API
  if (h.get_customModels) _get_customModels = h.get_customModels
  if (h.get_CUSTOM_API) _get_CUSTOM_API = h.get_CUSTOM_API
  if (h.get_MODEL_JSON_RE) _get_MODEL_JSON_RE = h.get_MODEL_JSON_RE
  if (h.get_modelCollapsedSet) _get_modelCollapsedSet = h.get_modelCollapsedSet
  if (h.get_texPacks) _get_texPacks = h.get_texPacks
  if (h.set_texPacks) _set_texPacks = h.set_texPacks
  if (h.get_viewMode) _get_viewMode = h.get_viewMode
  if (h.set_viewMode) _set_viewMode = h.set_viewMode
  if (h.get_modelPacks) _get_modelPacks = h.get_modelPacks
  if (h.set_modelPacks) _set_modelPacks = h.set_modelPacks
}

export function collectTexGroups() {
  const groups = []
  const byKey = new Map()
  const seen = new Set()
  const addGroup = (key, label) => {
    let g = byKey.get(key)
    if (!g) {
      g = { key, label, items: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    return g
  }

  /* 左右已选对比目录：按相对父目录分组（根级文件归目录名组） */
  for (const side of ['left', 'right']) {
    const root = side === 'left' ? state.leftPath : state.rightPath
    const entries = side === 'left' ? state.leftEntries : state.rightEntries
    if (!entries) continue
    const rootName = root ? String(root).replace(/\/+$/, '').split('/').pop() : ''
    for (const e of entries) {
      if (!_isImg(e) || seen.has(e.fullPath)) continue
      seen.add(e.fullPath)
      let rel = e.name
      if (root && e.fullPath && e.fullPath.startsWith(root + '/')) rel = e.fullPath.slice(root.length + 1)
      const si = rel.lastIndexOf('/')
      const dirRel = si >= 0 ? rel.slice(0, si) : ''
      const gk = 'dir:' + (root ? root + '/' + dirRel : dirRel || 'root')
      const label = root ? (dirRel ? rootName + ' · ' + dirRel : rootName) : dirRel || t('asset.texRootDir')
      addGroup(gk, label).items.push({
        key: 'tex:' + e.fullPath,
        name: e.name,
        thumb: _thumbUrl(e.fullPath),
        type: 'tex',
        path: e.fullPath,
        mtime: e.mtime || 0,
        role: _classifyByRole(e.name),
        onAdd: () => addTextureAt(e.fullPath, e.name)
      })
    }
  }

  /* MC 材质包 + 官方包（/api/asset/tex）：每包按 textures/ 第一级类别分组；
     dir 包有磁盘绝对路径（可直接引用），zip 包走包媒体 raw 接口 */
  for (const p of _get_texPacks() || []) {
    for (const g of p.groups || []) {
      const gk = 'pack:' + p.source + ':' + p.name + '/' + g.key
      const label = g.key ? p.name + ' · ' + g.key : p.name
      const grp = addGroup(gk, label)
      for (const f of g.files || []) {
        /* 防御：仅图片扩展名（png/jpg 等）才作为贴图展示，mcmeta/json 排除 */
        if (!IMG_EXTS.has((f.name.split('.').pop() || '').toLowerCase())) continue
        if (p.kind === 'dir' && p.root) {
          const fp = p.root + '/' + f.path
          if (seen.has(fp)) continue
          seen.add(fp)
          grp.items.push({
            key: 'tex:' + fp,
            name: f.name,
            thumb: _thumbUrl(fp),
            type: 'tex',
            path: fp,
            mtime: f.mtime || 0,
            role: _classifyByRole(f.name),
            onAdd: () => addTextureAt(fp, f.name)
          })
        } else {
          const packPath = 'pack:' + p.source + ':' + p.name + '/' + f.path
          grp.items.push({
            key: 'tex:' + packPath,
            name: f.name,
            thumb: _packTexThumbUrl(p.source, p.name, f.path),
            type: 'tex',
            path: packPath,
            mtime: 0,
            role: _classifyByRole(f.name),
            onAdd: () => _addPackTextureToCanvas({ type: p.source }, { name: p.name }, { path: f.path, name: f.name })
          })
        }
      }
    }
  }

  const dirGroups = groups.filter(g => g.key.startsWith('dir:')).sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  const packGroups = groups.filter(g => !g.key.startsWith('dir:'))
  return [...dirGroups, ...packGroups]
}

export function buildAssetGroup(g, collapsedSet, saveFn) {
  const grp = _el('div', 'asset-lib-group')
  grp.dataset.group = g.key
  if (collapsedSet.has(g.key)) grp.classList.add('collapsed')
  const head = _el(
    'div',
    'asset-lib-group-head',
    `<span class="caret">▾</span><span class="gl" title="${escAttr(g.label)}">${escAttr(g.label)}</span><span class="cnt">${g.items.length}</span>`
  )
  if (typeof g.openDir === 'function') {
    const locBtn = _el('button', 'asset-lib-group-btn')
    locBtn.type = 'button'
    locBtn.title = t('asset.openLocalDir')
    locBtn.innerHTML = '<svg class="ico ico-sm"><use href="#i-folder"/></svg>'
    locBtn.addEventListener('click', e => {
      e.stopPropagation()
      g.openDir()
    })
    head.appendChild(locBtn)
  }
  head.addEventListener('click', () => {
    grp.classList.toggle('collapsed')
    if (grp.classList.contains('collapsed')) {
      collapsedSet.add(g.key)
      saveFn(collapsedSet)
    } else {
      collapsedSet.delete(g.key)
      saveFn(collapsedSet)
    }
  })
  grp.appendChild(head)

  const grid = _el('div', 'asset-lib-grid')
  if (_get_viewMode() === 'list') grid.classList.add('list-view')
  const sorted = _sortItems(g.items)
  const shown = sorted.slice(0, _get_TEX_GROUP_PAGE())
  for (const it of shown) grid.appendChild(_makeCard(it))
  if (sorted.length > shown.length) {
    const more = _el('button', 'asset-lib-more', t('asset.texShowMore', { n: String(sorted.length - shown.length) }))
    more.addEventListener('click', () => {
      more.remove()
      for (const it of sorted.slice(_get_TEX_GROUP_PAGE())) grid.appendChild(_makeCard(it))
      observeModelThumbs(grid)
      _applyFilter()
    })
    grid.appendChild(more)
  }
  grp.appendChild(grid)
  return grp
}

export function buildTexGroup(g) {
  return buildAssetGroup(g, _get_texCollapsedSet(), _saveTexCollapsed)
}

export function buildTexSection() {
  const groups = collectTexGroups()
  const total = groups.reduce((s, g) => s + g.items.length, 0)
  const loading = _get_texPacks() === null

  const sec = _el('div', 'asset-lib-section')
  sec.dataset.cat = 'tex'
  if (_get_collapsedSet().has('tex')) sec.classList.add('collapsed')
  const head = _el(
    'div',
    'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.texSection')}</span><span class="cnt">${total}</span>`
  )
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) {
      _get_collapsedSet().add('tex')
      _saveCollapsed(_get_collapsedSet())
    } else {
      _get_collapsedSet().delete('tex')
      _saveCollapsed(_get_collapsedSet())
    }
  })
  sec.appendChild(head)

  if (!total && loading) {
    const grid = _el('div', 'asset-lib-grid')
    grid.appendChild(_el('div', 'asset-lib-hint', t('asset.loading')))
    sec.appendChild(grid)
    return sec
  }
  if (!total && _get_loadErrors().tex) {
    const grid = _el('div', 'asset-lib-grid')
    grid.appendChild(_el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: _get_loadErrors().tex })))
    sec.appendChild(grid)
    return sec
  }
  if (!total) return null

  const wrap = _el('div', 'asset-lib-groups')
  for (const g of groups) wrap.appendChild(buildTexGroup(g))
  if (_get_loadErrors().tex)
    wrap.appendChild(_el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: _get_loadErrors().tex })))
  sec.appendChild(wrap)
  return sec
}

export function collectModelGroups() {
  const groups = []
  const byKey = new Map()
  const addGroup = (key, label) => {
    let g = byKey.get(key)
    if (!g) {
      g = { key, label, items: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    return g
  }

  /* 导入模型（data/imported-models，用户主动上传的 .bbmodel / MC .json，专属目录） */
  const imGroup = addGroup('im', t('asset.importedModelGroup'))
  imGroup.openDir = () => _openModelDir('imported')
  for (const m of _get_importedModels() || []) {
    if (!m || !m.id) continue
    imGroup.items.push({
      key: 'model:im:' + m.id,
      name: m.name || m.id,
      thumb: null,
      icon: 'i-cube',
      color: '#e8993c',
      type: 'model',
      path: 'im:' + m.id,
      mtime: m.mtime || 0,
      role: 'model',
      badge: m.model_format || m.format || m.ext || null,
      modelThumb: { kind: 'im', id: m.id, path: 'im:' + m.id, mtime: m.mtime || 0 },
      modelFile: _userModelFilePath(_get_modelDirs().imported, m),
      modelDelete: { api: _get_IMPORT_API(), id: m.id },
      onAdd: () => _viewImportedModelAsset(m.id, m.name || m.id)
    })
  }

  /* 自定义模型（data/custom-models，从模板创建，专属目录） */
  const cmGroup = addGroup('cm', t('asset.cmModelGroup'))
  cmGroup.openDir = () => _openModelDir('custom')
  for (const m of _get_customModels() || []) {
    if (!m || !m.id) continue
    cmGroup.items.push({
      key: 'model:cm:' + m.id,
      name: m.name || m.id,
      thumb: null,
      icon: 'i-cube',
      color: '#5fd0a0',
      type: 'model',
      path: 'cm:' + m.id,
      mtime: m.mtime || 0,
      role: 'model',
      badge: m.template || null,
      modelFile: _userModelFilePath(_get_modelDirs().custom, m),
      modelDelete: { api: _get_CUSTOM_API(), id: m.id },
      onAdd: () => previewCustomModel(m.id, m.name || m.id)
    })
  }

  /* MC 材质包 + 官方包（/api/asset/model）：每包按 models/ 第一级类别分组 */
  for (const p of _get_modelPacks() || []) {
    for (const g of p.groups || []) {
      const gk = 'modelpack:' + p.source + ':' + p.name + '/' + g.key
      const label = g.key ? p.name + ' · ' + g.key : p.name
      const grp = addGroup(gk, label)
      for (const f of g.files || []) {
        /* 防御：仅 .json 扩展名才作为模型展示 */
        if (!f.name || !_get_MODEL_JSON_RE().test(f.name)) continue
        const modelPath = 'packmodel:' + p.source + ':' + p.name + '/' + f.path
        grp.items.push({
          key: 'model:' + modelPath,
          name: f.name,
          thumb: null,
          icon: 'i-cube',
          color: '#6f9ff0',
          type: 'model',
          path: modelPath,
          mtime: f.mtime || 0,
          role: 'model',
          badge: g.key || null,
          modelThumb: {
            kind: 'mc',
            api: _packApiFor(p.source),
            packName: p.name,
            rel: f.path,
            path: modelPath,
            mtime: f.mtime || 0
          },
          onAdd: () => _viewMcModelAsset(p.source, p.name, f.path, f.name)
        })
      }
    }
  }

  const pinOrder = ['im', 'cm']
  const pinned = groups
    .filter(g => pinOrder.includes(g.key))
    .sort((a, b) => pinOrder.indexOf(a.key) - pinOrder.indexOf(b.key))
  const rest = groups.filter(g => !pinOrder.includes(g.key)).sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  /* 每组内按名称前缀进一步细分（区分 oak/stone 等不同系列；全部同桶时保持原组） */
  const out = []
  for (const g of [...pinned, ...rest]) {
    if (!g.items.length) continue
    out.push(...splitGroupsByPrefix(g.key, g.label, g.items, t('asset.modelUngrouped')))
  }
  return out
}

export function texRefToAssetPath(ref) {
  if (typeof ref !== 'string' || !ref) return null
  if (/^(data:|file:|https?:\/\/|\/)/i.test(ref)) return null
  let ns = 'minecraft',
    rest = ref
  const ci = ref.indexOf(':')
  if (ci >= 0) {
    ns = ref.slice(0, ci)
    rest = ref.slice(ci + 1)
  }
  if (!rest) return null
  const hasExt = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i.test(rest)
  return `assets/${ns}/textures/${hasExt ? rest : rest + '.png'}`
}

export function collectModelTexturePaths(json) {
  if (!json || typeof json !== 'object') return []
  const textures = json.textures && typeof json.textures === 'object' ? json.textures : {}
  const seen = new Set()
  const out = []
  const resolve = ref => {
    if (typeof ref !== 'string' || !ref) return
    if (ref.startsWith('#')) {
      resolve(textures[ref.slice(1)])
      return
    }
    const p = texRefToAssetPath(ref)
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  for (const k in textures) resolve(textures[k])
  return out
}

export function matchTexturesToPaths(files, neededPaths) {
  const map = {}
  const byBasename = {}
  for (const f of files) {
    const name = f.name.replace(/\.[^.]+$/, '')
    if (!byBasename[name]) byBasename[name] = f
  }
  for (const p of neededPaths) {
    const base = p
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, '')
    const f = byBasename[base]
    if (f) map[p] = f
  }
  return map
}

export function buildModelSection() {
  const groups = collectModelGroups()
  const total = groups.reduce((s, g) => s + g.items.length, 0)
  const loading = _get_modelPacks() === null

  const sec = _el('div', 'asset-lib-section')
  sec.dataset.cat = 'model'
  if (_get_collapsedSet().has('model')) sec.classList.add('collapsed')
  const head = _el(
    'div',
    'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.modelSection')}</span><span class="cnt">${total}</span>`
  )
  const uploadBtn = _el('button', 'asset-lib-section-btn')
  uploadBtn.type = 'button'
  uploadBtn.title = t('asset.uploadModelTitle')
  uploadBtn.innerHTML = `<svg class="ico ico-sm"><use href="#i-plus"/></svg><span>${t('asset.uploadModel')}</span>`
  uploadBtn.addEventListener('click', e => {
    e.stopPropagation()
    _uploadModelToLibrary()
  })
  head.appendChild(uploadBtn)
  const newBtn = _el('button', 'asset-lib-section-btn')
  newBtn.type = 'button'
  newBtn.title = t('asset.newModelTitle')
  newBtn.innerHTML = `<svg class="ico ico-sm"><use href="#i-cube"/></svg><span>${t('asset.newModel')}</span>`
  newBtn.addEventListener('click', e => {
    e.stopPropagation()
    openCreateModelDialog({ onCreated: () => _refreshAssetLibrary() })
  })
  head.appendChild(newBtn)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) {
      _get_collapsedSet().add('model')
      _saveCollapsed(_get_collapsedSet())
    } else {
      _get_collapsedSet().delete('model')
      _saveCollapsed(_get_collapsedSet())
    }
  })
  sec.appendChild(head)

  if (!total && loading) {
    const grid = _el('div', 'asset-lib-grid')
    grid.appendChild(_el('div', 'asset-lib-hint', t('asset.loading')))
    sec.appendChild(grid)
    return sec
  }
  if (!total && _get_loadErrors().model) {
    const grid = _el('div', 'asset-lib-grid')
    grid.appendChild(_el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: _get_loadErrors().model })))
    sec.appendChild(grid)
    return sec
  }
  if (!total) return null

  const wrap = _el('div', 'asset-lib-groups')
  for (const g of groups) wrap.appendChild(buildAssetGroup(g, _get_modelCollapsedSet(), _saveModelCollapsed))
  if (_get_loadErrors().model)
    wrap.appendChild(_el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: _get_loadErrors().model })))
  observeModelThumbs(wrap)
  sec.appendChild(wrap)
  return sec
}
