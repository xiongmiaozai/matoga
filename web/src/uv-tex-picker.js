/**
 * matoga - UV 贴图库选择器（浮动窗口）—— 材质球模式
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT.
 *
 * 供 UV 编辑器（uv-editor-core）「贴图库」按钮调用：
 *   openTexPicker() → Promise<{ name, url, normal, specular } | null>
 *   - name：材质名（主图去扩展名 + 后缀剥离后的 groupKey）
 *   - url：主图 raw URL（写入 UV 槽位）
 *   - normal：法线贴图（-n/_n）raw URL，无则空串（3D 视口 PBR 预览）
 *   - specular：高光贴图（-s/_s）raw URL，无则空串（3D 视口 PBR 预览）
 * 数据源：/api/asset/tex（MC 材质包 + 官方包贴图聚合，每包按类别分组）。
 * raw URL 构造与 asset-library 一致：
 *   zip 包  → /api/mc-official|mc-packs/<name>/raw?path=<rel>
 *   dir 包  → /api/file/raw?path=<root>/<rel>
 * URL 经 apiUrl() 包装（LAN 模式自动附加 token）。
 * 展示：按文件名后缀（_n/-n/_s/-s/_h/-h/_e/-e）聚合为材质组（材质球），
 *   以主图为缩略图，角标标识配套法线(N)/高光(S)/高度(H)/自发光(E)；
 *   仅展示含主图的材质组（材质球以主图为代表）。
 * 交互：包下拉 + 名称搜索（前端过滤）+ 缩略图网格 + 分页加载（每页 80），
 * 点击材质组即 resolve 并关窗。
 */

import { createFloatingWindow } from './floating-window.js'
import { apiUrl, setTexDragData, parseTexGroup } from './utils.js'
import { t, onLocaleChange } from './i18n.js'
import { loadZhNames, zhOfTexName } from './zh-names.js'

const PAGE_SIZE = 80
const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga'])
/* 角标角色顺序（与展示优先级一致） */
const BADGE_ROLES = [
  ['normal', 'n'],
  ['specular', 's'],
  ['height', 'h'],
  ['emissive', 'e']
]

const state = {
  packs: [] /* [{ source, name, kind, root, label, materials: [材质组] }] */,
  packIdx: 0,
  searchText: '',
  shown: 0 /* 当前渲染条数（分页） */,
  filtered: [] /* 当前包 + 搜索过滤后的材质组列表 */,
  loadError: null,
  resolve: null /* 本次打开的 Promise resolve */
}

let win = null
let packSel = null
let searchInput = null
let gridEl = null
let moreBtn = null
let emptyEl = null
let statusEl = null

/* ── raw URL 构造（与 asset-library packRawUrl 一致） ────────── */

function packTexRawUrl(pack, relPath) {
  if (pack.kind === 'dir' && pack.root) {
    return apiUrl('/api/file/raw?path=' + encodeURIComponent(pack.root.replace(/\/+$/, '') + '/' + relPath))
  }
  const api = pack.source === 'mc' ? '/api/mc-packs' : '/api/mc-official'
  return apiUrl(api + '/' + encodeURIComponent(pack.name) + '/raw?path=' + encodeURIComponent(relPath))
}

/* 解析贴图角色：parseTexGroup 对非 core.IMG_EXTS 扩展（如 tga）返回 role='file'，
     此处统一当作 main（groupKey 去扩展名），确保 tga 等也能作为主图聚合 */
function texRoleOf(name) {
  const p = parseTexGroup(name)
  if (p.role === 'file') {
    const dot = name.lastIndexOf('.')
    return { groupKey: dot > 0 ? name.slice(0, dot) : name, role: 'main' }
  }
  return p
}

/* 把包内扁平贴图文件聚合为材质组（按 目录+groupKey 聚合，避免跨目录同名合并）：
     材质组 = { key, name, main, normal, specular, height, emissive }，各角色为 { name, path, url } */
function buildMaterials(files) {
  const map = new Map()
  for (const f of files) {
    const p = texRoleOf(f.name)
    const slash = f.path.lastIndexOf('/')
    const dir = slash >= 0 ? f.path.slice(0, slash) : ''
    const key = dir ? dir + '/' + p.groupKey : p.groupKey
    let g = map.get(key)
    if (!g) {
      g = { key, name: p.groupKey }
      map.set(key, g)
    }
    g[p.role] = f
  }
  /* 仅展示含主图的材质组（材质球以主图为代表） */
  return [...map.values()].filter(g => g.main)
}

/* ── 数据加载（/api/asset/tex，一次拉全量包结构，聚合为材质组） ────────── */

async function loadPacks() {
  if (state.packs.length || state.loadError) return
  try {
    await loadZhNames()
    const res = await fetch(apiUrl('/api/asset/tex'))
    const j = await res.json()
    if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
    const packs = (j.data && j.data.packs) || []
    state.packs = packs
      .map(p => {
        const files = []
        for (const g of p.groups || []) {
          for (const f of g.files || []) {
            if (!f || !f.path) continue
            const ext = (
              String(f.name || f.path)
                .split('.')
                .pop() || ''
            ).toLowerCase()
            if (!IMG_EXTS.has(ext)) continue
            files.push({ name: f.name, path: f.path, url: packTexRawUrl(p, f.path) })
          }
        }
        const materials = buildMaterials(files)
        return {
          source: p.source,
          name: p.name,
          kind: p.kind,
          root: p.root,
          label: p.name + '（' + materials.length + '）',
          materials
        }
      })
      .filter(p => p.materials.length)
    if (!state.packs.length) state.loadError = 'empty'
  } catch (e) {
    state.loadError = e.message || 'load fail'
  }
}

/* ── 渲染 ─────────────────────────────────── */

function applyFilter() {
  const pack = state.packs[state.packIdx]
  const q = state.searchText.trim().toLowerCase()
  state.filtered = pack
    ? pack.materials.filter(m => {
        if (!q) return true
        if (String(m.name).toLowerCase().includes(q) || String(m.key).toLowerCase().includes(q)) return true
        const z = zhOfTexName(String(m.name).replace(/\.png$/i, ''))
        return !!z && z.toLowerCase().includes(q)
      })
    : []
  state.shown = 0
  renderGrid()
}

/* 材质组 → resolve 值（主图 url + 配套法线/高光 url，空则空串） */
function materialPickValue(m) {
  return {
    name: m.name,
    url: m.main.url,
    normal: (m.normal && m.normal.url) || '',
    specular: (m.specular && m.specular.url) || ''
  }
}

function renderGrid() {
  if (!gridEl) return
  if (state.shown === 0) gridEl.innerHTML = ''
  const slice = state.filtered.slice(state.shown, state.shown + PAGE_SIZE)
  for (const m of slice) {
    const cell = document.createElement('button')
    cell.className = 'uvp-cell'
    cell.title = m.main.path
    cell.draggable = true
    const img = document.createElement('img')
    img.alt = ''
    img.loading = 'lazy'
    img.draggable = false
    img.src = m.main.url
    cell.appendChild(img)
    /* 角标：标识材质球配套的 PBR 贴图（N=法线 S=高光 H=高度 E=自发光） */
    const badges = BADGE_ROLES.filter(([r]) => m[r]).map(([, b]) => {
      const span = document.createElement('span')
      span.className = 'uvp-badge ' + b
      span.textContent = b.toUpperCase()
      return span
    })
    if (badges.length) {
      const wrap = document.createElement('span')
      wrap.className = 'uvp-badges'
      for (const b of badges) wrap.appendChild(b)
      cell.appendChild(wrap)
    }
    const name = document.createElement('span')
    name.className = 'uvp-name'
    name.textContent = m.name
    cell.appendChild(name)
    /* 拖拽到 UV 编辑器画布 = 直接替换贴图（与点击选择等价，带 PBR 配套） */
    cell.addEventListener('dragstart', e => {
      const v = materialPickValue(m)
      if (
        setTexDragData(e.dataTransfer, {
          name: v.name,
          url: v.url,
          path: m.main.path,
          normal: v.normal,
          specular: v.specular
        })
      ) {
        e.dataTransfer.effectAllowed = 'copy'
      } else {
        e.preventDefault()
      }
    })
    cell.addEventListener('click', () => {
      if (state.resolve) {
        try {
          state.resolve(materialPickValue(m))
        } catch {}
        state.resolve = null
      }
      win.close()
    })
    gridEl.appendChild(cell)
  }
  state.shown += slice.length
  if (moreBtn) moreBtn.style.display = state.shown < state.filtered.length ? '' : 'none'
  if (emptyEl) {
    emptyEl.style.display = state.filtered.length ? 'none' : ''
    emptyEl.textContent = state.loadError === 'empty' ? t('uv.pickerEmpty') : t('uv.pickerNoMatch')
  }
  if (statusEl)
    statusEl.textContent = state.filtered.length
      ? t('uv.pickerCount', { n: state.shown + '/' + state.filtered.length })
      : state.loadError === 'empty'
        ? t('uv.pickerEmpty')
        : t('uv.pickerNoMatch')
}

function rebuildPackSelect() {
  if (!packSel) return
  packSel.innerHTML = ''
  state.packs.forEach((p, i) => {
    const opt = document.createElement('option')
    opt.value = String(i)
    opt.textContent = p.label
    packSel.appendChild(opt)
  })
  if (state.packIdx >= state.packs.length) state.packIdx = 0
  packSel.value = String(state.packIdx)
}

async function refreshView() {
  await loadPacks()
  rebuildPackSelect()
  applyFilter()
}

/* ── 浮窗构建（幂等单例） ─────────────────────────────────── */

function initPicker() {
  if (win) return win

  win = createFloatingWindow({
    id: 'uvTexPicker',
    title: t('uv.pickerTitle'),
    icon: 'i-image',
    x: 320,
    y: 120,
    w: 620,
    h: 520,
    open: false
  })

  const wrap = document.createElement('div')
  wrap.className = 'uvp-wrap'

  const toolbar = document.createElement('div')
  toolbar.className = 'uvp-toolbar'
  packSel = document.createElement('select')
  packSel.className = 'uvp-pack-sel'
  packSel.title = t('uv.pickerPackTitle')
  packSel.addEventListener('change', () => {
    state.packIdx = +packSel.value || 0
    applyFilter()
  })
  toolbar.appendChild(packSel)
  searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.className = 'uvp-search'
  searchInput.placeholder = t('uv.pickerSearch')
  searchInput.addEventListener('input', () => {
    state.searchText = searchInput.value || ''
    applyFilter()
  })
  toolbar.appendChild(searchInput)
  statusEl = document.createElement('span')
  statusEl.className = 'uvp-status'
  toolbar.appendChild(statusEl)
  wrap.appendChild(toolbar)

  const gridWrap = document.createElement('div')
  gridWrap.className = 'uvp-grid-wrap'
  gridEl = document.createElement('div')
  gridEl.className = 'uvp-grid'
  gridWrap.appendChild(gridEl)
  emptyEl = document.createElement('div')
  emptyEl.className = 'uvp-empty'
  emptyEl.textContent = t('uv.pickerNoMatch')
  gridWrap.appendChild(emptyEl)
  moreBtn = document.createElement('button')
  moreBtn.className = 'uvp-more'
  moreBtn.textContent = t('uv.pickerMore')
  moreBtn.style.display = 'none'
  moreBtn.addEventListener('click', () => renderGrid())
  gridWrap.appendChild(moreBtn)
  wrap.appendChild(gridWrap)

  win.body.appendChild(wrap)

  win.onToggle = open => {
    if (!open && state.resolve) {
      try {
        state.resolve(null)
      } catch {}
      state.resolve = null
    }
  }

  onLocaleChange(() => {
    if (!win) return
    win.setTitle(t('uv.pickerTitle'))
    if (searchInput) searchInput.placeholder = t('uv.pickerSearch')
    if (moreBtn) moreBtn.textContent = t('uv.pickerMore')
    if (packSel) packSel.title = t('uv.pickerPackTitle')
  })

  return win
}

/* ── 入口：打开选择器，选择材质组 resolve { name, url, normal, specular }；关闭未选 resolve null ── */

export async function openTexPicker() {
  initPicker()

  state.searchText = ''
  if (searchInput) searchInput.value = ''
  win.open()
  await refreshView()
  return new Promise(resolve => {
    state.resolve = resolve
  })
}
