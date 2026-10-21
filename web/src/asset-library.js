/**
 * matoga - 总资产库面板
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 聚合四类资产到 #assetLibraryBody：
 *  1. 材质贴图（来自左右已选目录 state.leftEntries/rightEntries）
 *  2. HDRI 预设（/api/hdri/list）
 *  3. MC 材质包（config.mcPacksPath + /api/compare/scan）
 *  4. 内置节点预设（金属/塑料/玻璃/织物/自发光）
 * 收藏夹与最近使用通过后端 /api/asset 持久化，localStorage 作为离线回退。
 * 单击卡片打开详情面板（大图预览 + 元数据），拖拽或详情面板按钮添加到画布。
 */

import { state, IMG_EXTS, showToast } from './core.js'
import { fileUrl, formatSize, formatDate } from './utils.js'
import { addNodeAt, addTextureAt, loadPreset } from './node-canvas.js'
import { t, onLocaleChange } from './i18n.js'

const PRESETS = [
  { id: 'metal',     color: '#c8c8d0' },
  { id: 'plastic',   color: '#e0e0e0' },
  { id: 'glass',     color: '#e0eef5' },
  { id: 'fabric',    color: '#b39880' },
  { id: 'emissive',  color: '#fff3c0' },
]

const ALL_TYPES = ['tex', 'hdri', 'mc', 'preset']
const MAX_RECENT = 50
const HDRI_EXTS = new Set(['hdr', 'exr'])

const ROLE_PATTERNS = [
  { role: 'normal',   re: /(_|-|^)(normal|nrm|nor|n)(\.|_|-|$)/i },
  { role: 'specular', re: /(_|-|^)(specular|spec|spc|s)(\.|_|-|$)/i },
  { role: 'main',     re: /(_|-|^)(diffuse|diff|albedo|base|color|col|c|main|d)(\.|_|-|$)/i },
]

const TYPE_LABEL_KEYS = {
  tex: 'asset.catTex', hdri: 'asset.catHdri', mc: 'asset.catMc', preset: 'asset.catPreset',
}

function detectTypeFromPath(p) {
  if (!p || typeof p !== 'string') return null
  const ext = (p.split('.').pop() || '').toLowerCase()
  if (HDRI_EXTS.has(ext)) return 'hdri'
  if (IMG_EXTS.has(ext)) return 'tex'
  return null
}

function classifyByRole(name) {
  if (!name || typeof name !== 'string') return null
  for (const { role, re } of ROLE_PATTERNS) {
    if (re.test(name)) return role
  }
  return null
}

function isValidAssetKey(key) {
  if (typeof key !== 'string' || !key) return false
  const idx = key.indexOf(':')
  if (idx <= 0) return false
  return ALL_TYPES.includes(key.slice(0, idx))
}

function categoryLabel(type) {
  const k = TYPE_LABEL_KEYS[type]
  return k ? t(k) : type
}

let searchTerm = ''
let categoryFilter = 'all'
let sortKey = 'name'
let sortDir = 'asc'
let viewMode = 'grid'

let mcEntries = null
let hdriEntries = null
let lastTexSig = ''
let loadErrors = { hdri: null, mc: null }

let favorites = loadList('matoga:assetFav')
let recent = loadList('matoga:assetRecent')
let serverSynced = false

let ctxMenu = null
let pollTimer = null
let detailCurrent = null

function presetName(id) {
  return t('m3d.preset' + id.charAt(0).toUpperCase() + id.slice(1))
}

function roleText(role) {
  const keys = { preset: 'asset.rolePreset', main: 'asset.roleMain', normal: 'asset.roleNormal', specular: 'asset.roleSpecular' }
  return keys[role] ? t(keys[role]) : role
}

function isImg(e) { return e && !e.isDirectory && IMG_EXTS.has((e.name.split('.').pop() || '').toLowerCase()) }
function thumbUrl(p) { return fileUrl(p) }
function hdriThumbUrl(p) { return '/api/hdri/thumb?path=' + encodeURIComponent(p) }

function el(tag, cls, html) {
  const d = document.createElement(tag)
  if (cls) d.className = cls
  if (html != null) d.innerHTML = html
  return d
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b))
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

function loadList(key) {
  try { return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] }
}
function saveList(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)) } catch {}
}

function assetApiUrl(p) {
  return (window.matogaCore && window.matogaCore.url) ? window.matogaCore.url(p) : p
}

async function assetApiCall(method, path, body) {
  const res = await fetch(assetApiUrl(path), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
  return j.data
}

async function loadAssetStore() {
  try {
    const data = await assetApiCall('GET', '/api/asset')
    if (Array.isArray(data.favorites)) {
      favorites = data.favorites
      saveList('matoga:assetFav', favorites)
    }
    if (Array.isArray(data.recent)) {
      recent = data.recent
      saveList('matoga:assetRecent', recent)
    }
    serverSynced = true
  } catch {
    serverSynced = false
  }
  rebuild()
}

function persistFavorites() {
  saveList('matoga:assetFav', favorites)
  if (serverSynced) assetApiCall('PUT', '/api/asset/favorites', { items: favorites }).catch(() => {})
}

function persistRecent() {
  saveList('matoga:assetRecent', recent)
  if (serverSynced) assetApiCall('PUT', '/api/asset/recent', { items: recent }).catch(() => {})
}

function sortItems(items) {
  const arr = items.slice()
  arr.sort((a, b) => {
    let cmp
    if (sortKey === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0)
    else cmp = String(a.name).localeCompare(String(b.name), 'zh')
    return sortDir === 'asc' ? cmp : -cmp
  })
  return arr
}

function itemFromStored(s) {
  let onAdd, name = s.name
  if (s.type === 'preset') {
    const id = s.key.slice(8)
    onAdd = () => loadPreset(id)
    name = presetName(id)
  } else if (s.type === 'hdri') {
    onAdd = () => addNodeAt('hdr')
  } else {
    onAdd = () => addTextureAt(s.path, s.name)
  }
  return { key: s.key, name, thumb: s.thumb, type: s.type, path: s.path, mtime: s.mtime || 0, role: s.role, color: s.color, onAdd }
}

function storeFromItem(it) {
  return { key: it.key, name: it.name, thumb: it.thumb, type: it.type, path: it.path, mtime: it.mtime || 0, role: it.role, color: it.color }
}

function isFav(item) { return favorites.some(f => f.key === item.key) }

function toggleFav(item) {
  if (!isValidAssetKey(item.key)) return
  if (isFav(item)) {
    favorites = favorites.filter(f => f.key !== item.key)
    showToast(t('asset.toastFavRemoved'))
  } else {
    favorites.unshift(storeFromItem(item))
    showToast(t('asset.toastFavAdded'))
  }
  persistFavorites()
  rebuild()
  refreshDetailFav()
}

function pushRecent(item) {
  if (!isValidAssetKey(item.key)) return
  recent = recent.filter(r => r.key !== item.key)
  recent.unshift(storeFromItem(item))
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT)
  persistRecent()
  if (categoryFilter === 'recent') rebuild()
}

function makeCard(item) {
  const card = el('div', 'asset-card')
  card.draggable = true
  card.dataset.name = item.name
  card.dataset.type = item.type
  card.dataset.key = item.key

  const th = el('div', 'ac-thumb')
  if (item.color) {
    th.style.background = `linear-gradient(135deg, ${item.color}, ${shade(item.color, -30)})`
  } else if (item.thumb) {
    const img = el('img')
    img.loading = 'lazy'
    img.alt = ''
    img.src = item.thumb
    img.addEventListener('error', () => {
      th.innerHTML = ''
      th.appendChild(el('span', 'ac-icon', '<svg class="ico"><use href="#i-image"/></svg>'))
    })
    th.appendChild(img)
  } else {
    th.appendChild(el('span', 'ac-icon', '<svg class="ico"><use href="#i-image"/></svg>'))
  }
  card.appendChild(th)
  card.appendChild(el('div', 'ac-name', item.name))
  if (item.role) card.appendChild(el('div', 'ac-role ' + item.role, roleText(item.role)))

  const star = el('button', 'ac-star', isFav(item) ? '★' : '☆')
  star.title = isFav(item) ? t('asset.favOff') : t('asset.favOn')
  star.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(item) })
  card.appendChild(star)

  const add = () => { pushRecent(item); item.onAdd() }
  card.addEventListener('click', () => showDetail(item))
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', item.name)
    e.dataTransfer.effectAllowed = 'copy'
    card.classList.add('dragging')
  })
  card.addEventListener('dragend', (e) => {
    card.classList.remove('dragging')
    if (droppedOnCanvas(e)) add()
  })
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtxMenu(e, item) })
  return card
}

function droppedOnCanvas(e) {
  const c = document.getElementById('canvas-wrap')
  if (!c) return false
  const r = c.getBoundingClientRect()
  return r.width > 0 && r.height > 0 &&
    e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
}

function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem('matoga:assetCollapsed')) || []) } catch { return new Set() }
}
function saveCollapsed(set) {
  try { localStorage.setItem('matoga:assetCollapsed', JSON.stringify([...set])) } catch {}
}
let collapsedSet = loadCollapsed()

function buildSection(catKey, title, items, errMsg, loading) {
  const sorted = sortItems(items)
  const count = sorted.length
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = catKey
  if (collapsedSet.has(catKey)) sec.classList.add('collapsed')
  const head = el('div', 'asset-lib-section-head',
    `<span class="caret">▾</span><span>${title}</span><span class="cnt">${count}</span>`)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) { collapsedSet.add(catKey); saveCollapsed(collapsedSet) }
    else { collapsedSet.delete(catKey); saveCollapsed(collapsedSet) }
  })
  sec.appendChild(head)
  const grid = el('div', 'asset-lib-grid')
  if (viewMode === 'list') grid.classList.add('list-view')
  if (loading && !count) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (errMsg && !count) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: errMsg })))
  } else if (!count) {
    return null
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

function buildPresetSection() {
  const items = PRESETS.map(p => ({
    key: 'preset:' + p.id, name: presetName(p.id), color: p.color, type: 'preset', path: null, mtime: 0, role: 'preset',
    onAdd: () => loadPreset(p.id),
  }))
  return buildSection('preset', t('asset.presetSection'), items, null, false)
}

function buildTexSection() {
  const seen = new Set()
  const items = []
  for (const side of ['left', 'right']) {
    const entries = side === 'left' ? state.leftEntries : state.rightEntries
    if (!entries) continue
    for (const e of entries) {
      if (!isImg(e) || seen.has(e.fullPath)) continue
      seen.add(e.fullPath)
      items.push({
        key: 'tex:' + e.fullPath, name: e.name, thumb: thumbUrl(e.fullPath),
        type: 'tex', path: e.fullPath, mtime: e.mtime || 0, role: classifyByRole(e.name),
        onAdd: () => addTextureAt(e.fullPath, e.name),
      })
    }
  }
  return buildSection('tex', t('asset.texSection'), items, null, false)
}

function buildHdriSection() {
  const items = (hdriEntries || []).map(e => ({
    key: 'hdri:' + e.fullPath, name: e.name, thumb: hdriThumbUrl(e.fullPath),
    type: 'hdri', path: e.fullPath, mtime: e.mtime || 0, role: 'preset',
    onAdd: () => addNodeAt('hdr'),
  }))
  return buildSection('hdri', t('asset.hdriSection'), items, loadErrors.hdri, hdriEntries === null)
}

function buildMcSection() {
  const items = (mcEntries || []).map(e => ({
    key: 'mc:' + e.fullPath, name: e.name, thumb: thumbUrl(e.fullPath),
    type: 'mc', path: e.fullPath, mtime: e.mtime || 0,
    onAdd: () => addTextureAt(e.fullPath, e.name),
  }))
  return buildSection('mc', t('asset.mcSection'), items, loadErrors.mc, mcEntries === null)
}

function buildFavSection() {
  if (!favorites.length) return null
  return buildSection('fav', t('asset.favSection'), favorites.map(itemFromStored), null, false)
}

function buildRecentSection() {
  if (!recent.length) return null
  return buildSection('recent', t('asset.recentSection'), recent.map(itemFromStored), null, false)
}

function rebuild() {
  const body = document.getElementById('assetLibraryBody')
  if (!body) return
  const scrollTop = body.scrollTop
  body.innerHTML = ''
  const sections = [
    buildFavSection(),
    buildRecentSection(),
    buildPresetSection(),
    buildTexSection(),
    buildHdriSection(),
    buildMcSection(),
  ].filter(Boolean)
  for (const s of sections) body.appendChild(s)
  body.scrollTop = scrollTop
  applyFilter()
}

function applyFilter() {
  const body = document.getElementById('assetLibraryBody')
  if (!body) return
  const term = searchTerm.toLowerCase()
  body.querySelectorAll('.asset-card').forEach(c => {
    c.style.display = (!term || c.dataset.name.toLowerCase().includes(term)) ? '' : 'none'
  })
  let visible = 0
  body.querySelectorAll('.asset-lib-section').forEach(sec => {
    const catOk = categoryFilter === 'all' ? ALL_TYPES.includes(sec.dataset.cat) : sec.dataset.cat === categoryFilter
    if (!catOk) { sec.style.display = 'none'; return }
    const hint = sec.querySelector('.asset-lib-hint')
    const anyCard = sec.querySelector('.asset-card:not([style*="none"])')
    sec.style.display = (hint || anyCard) ? '' : 'none'
    if (anyCard) visible += sec.querySelectorAll('.asset-card:not([style*="none"])').length
  })
  updateStat(visible)
  const hasVisibleHint = !!body.querySelector('.asset-lib-section:not([style*="none"]) .asset-lib-hint')
  let empty = body.querySelector('.asset-lib-empty')
  if (visible === 0 && !hasVisibleHint) {
    if (!empty) { empty = el('div', 'asset-lib-empty'); body.appendChild(empty) }
    let msg
    if (term) msg = t('asset.emptyFiltered')
    else if (categoryFilter !== 'all') msg = t('asset.emptyCategory', { cat: categoryLabel(categoryFilter) })
    else msg = t('asset.empty')
    empty.textContent = msg
    empty.style.display = ''
  } else if (empty) {
    empty.style.display = 'none'
  }
}

function updateStat(n) {
  const stat = document.querySelector('.asset-lib-stat')
  if (stat) stat.textContent = t('asset.statTotal', { n })
}

function showCtxMenu(e, item) {
  hideCtxMenu()
  ctxMenu = el('div', 'asset-ctx-menu')
  const opts = []
  if (item.path) {
    opts.push({ label: t('asset.ctxLocate'), fn: () => window.api.showInFolder(item.path) })
    opts.push({ label: t('asset.ctxCopyPath'), fn: () => copyText(item.path) })
  }
  opts.push({ label: t('asset.ctxCopyName'), fn: () => copyText(item.name) })
  opts.push({ label: isFav(item) ? t('asset.ctxUnfav') : t('asset.ctxFav'), fn: () => toggleFav(item) })
  opts.push({ label: t('asset.ctxSendCanvas'), fn: () => { pushRecent(item); item.onAdd() } })
  for (const it of opts) {
    const mi = el('div', 'asset-ctx-item', it.label)
    mi.addEventListener('click', () => { hideCtxMenu(); it.fn() })
    ctxMenu.appendChild(mi)
  }
  document.body.appendChild(ctxMenu)
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px'
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px'
}

function hideCtxMenu() {
  if (ctxMenu) { ctxMenu.remove(); ctxMenu = null }
}

async function copyText(s) {
  try { await navigator.clipboard.writeText(s); showToast(t('asset.toastCopied')) }
  catch { showToast(t('asset.toastCopyFail')) }
}

async function loadHdri() {
  try {
    const data = await assetApiCall('GET', '/api/hdri/list')
    hdriEntries = (data && data.entries) || []
    loadErrors.hdri = null
  } catch (e) {
    loadErrors.hdri = e.message || '未知错误'
    if (hdriEntries === null) hdriEntries = []
  }
}

async function loadMc() {
  try {
    const cfg = await window.api.getConfig()
    const p = cfg && cfg.mcPacksPath
    if (!p) { mcEntries = []; loadErrors.mc = null; return }
    const data = await assetApiCall('POST', '/api/compare/scan', { path: p, recursive: true })
    const entries = (data && data.entries) || []
    const seen = new Set()
    mcEntries = entries.filter(e => isImg(e) && !seen.has(e.fullPath) && seen.add(e.fullPath)).slice(0, 200)
    loadErrors.mc = null
  } catch (e) {
    loadErrors.mc = e.message || '未知错误'
    if (mcEntries === null) mcEntries = []
  }
}

export async function refreshAssetLibrary() {
  await Promise.all([loadHdri(), loadMc()])
  rebuild()
}

function sigEntries() {
  let s = 0
  for (const e of state.leftEntries || []) s += (e.mtime || 0)
  for (const e of state.rightEntries || []) s += (e.mtime || 0)
  return (state.leftEntries?.length || 0) + ':' + (state.rightEntries?.length || 0) + ':' + s
}

function startPoll() {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    const sig = sigEntries()
    if (sig !== lastTexSig) { lastTexSig = sig; rebuild() }
  }, 1500)
}

function buildToolbar() {
  const bar = document.getElementById('assetLibToolbar')
  if (!bar) return
  bar.innerHTML = ''

  const cats = [['all', t('asset.catAll')], ['tex', t('asset.catTex')], ['hdri', t('asset.catHdri')], ['mc', t('asset.catMc')], ['preset', t('asset.catPreset')], ['fav', t('asset.catFav')], ['recent', t('asset.catRecent')]]
  const catGroup = el('div', 'asset-lib-tags')
  for (const [v, label] of cats) {
    const btn = el('button', 'asset-lib-tag' + (categoryFilter === v ? ' active' : ''), label)
    btn.dataset.cat = v
    btn.addEventListener('click', () => {
      categoryFilter = v
      catGroup.querySelectorAll('.asset-lib-tag').forEach(b => b.classList.toggle('active', b.dataset.cat === v))
      rebuild()
    })
    catGroup.appendChild(btn)
  }
  bar.appendChild(catGroup)

  const right = el('div', 'asset-lib-toolbar-right')
  const sort = el('select', 'asset-lib-sel')
  for (const [v, label] of [['name', t('asset.sortName')], ['mtime', t('asset.sortMtime')]]) {
    const o = el('option'); o.value = v; o.textContent = label; sort.appendChild(o)
  }
  sort.value = sortKey
  sort.addEventListener('change', () => { sortKey = sort.value; rebuild() })
  right.appendChild(sort)

  const dirBtn = el('button', 'asset-lib-btn', sortDir === 'asc' ? '↑' : '↓')
  dirBtn.title = t('asset.sortDirTitle')
  dirBtn.addEventListener('click', () => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    dirBtn.textContent = sortDir === 'asc' ? '↑' : '↓'
    rebuild()
  })
  right.appendChild(dirBtn)

  const viewBtn = el('button', 'asset-lib-btn', viewMode === 'grid' ? '▦' : '☰')
  viewBtn.title = t('asset.viewToggleTitle')
  viewBtn.addEventListener('click', () => {
    viewMode = viewMode === 'grid' ? 'list' : 'grid'
    viewBtn.textContent = viewMode === 'grid' ? '▦' : '☰'
    rebuild()
  })
  right.appendChild(viewBtn)

  right.appendChild(el('div', 'asset-lib-stat', ''))
  bar.appendChild(right)
}

function detailRow(label, value) {
  const row = el('div', 'asset-detail-row')
  row.appendChild(el('div', 'asset-detail-label', label))
  const val = el('div', 'asset-detail-value')
  val.textContent = value
  row.appendChild(val)
  return row
}

function showDetail(item) {
  const panel = document.getElementById('assetDetailPanel')
  const body = document.getElementById('assetDetailBody')
  if (!panel || !body) return
  body.innerHTML = ''

  const preview = el('div', 'asset-detail-preview')
  if (item.color) {
    preview.style.background = `linear-gradient(135deg, ${item.color}, ${shade(item.color, -30)})`
  } else if (item.thumb) {
    const img = el('img')
    img.alt = ''
    img.src = item.thumb
    img.addEventListener('error', () => {
      preview.innerHTML = ''
      preview.appendChild(el('span', 'ac-icon', '<svg class="ico"><use href="#i-image"/></svg>'))
    })
    preview.appendChild(img)
  } else {
    preview.appendChild(el('span', 'ac-icon', '<svg class="ico"><use href="#i-image"/></svg>'))
  }
  body.appendChild(preview)

  const nameEl = el('div', 'asset-detail-name')
  nameEl.textContent = item.name
  body.appendChild(nameEl)

  const meta = el('div', 'asset-detail-meta')
  const typeKeys = { tex: 'asset.typeTex', hdri: 'asset.typeHdri', mc: 'asset.typeMc', preset: 'asset.typePreset' }
  meta.appendChild(detailRow(t('asset.detailType'), t(typeKeys[item.type] || item.type)))
  if (item.role) meta.appendChild(detailRow(t('asset.detailRole'), roleText(item.role)))
  meta.appendChild(detailRow(t('asset.detailPath'), item.path || t('asset.detailNoPath')))
  const sizeRow = detailRow(t('asset.detailSize'), t('asset.detailLoading'))
  const mtimeRow = detailRow(t('asset.detailMtime'), item.mtime ? formatDate(item.mtime) : '—')
  meta.appendChild(sizeRow)
  meta.appendChild(mtimeRow)
  body.appendChild(meta)

  if (item.path && item.type !== 'preset') {
    assetApiCall('GET', '/api/asset/info?path=' + encodeURIComponent(item.path))
      .then(info => {
        const sv = sizeRow.querySelector('.asset-detail-value')
        const mv = mtimeRow.querySelector('.asset-detail-value')
        if (info.exists) {
          sv.textContent = formatSize(info.size)
          if (info.mtime) mv.textContent = formatDate(info.mtime)
        } else {
          sv.textContent = t('asset.detailNotFound')
        }
      })
      .catch(() => { sizeRow.querySelector('.asset-detail-value').textContent = '—' })
  } else {
    sizeRow.querySelector('.asset-detail-value').textContent = '—'
  }

  const actions = el('div', 'asset-detail-actions')
  const addBtn = el('button', 'asset-detail-btn primary', t('asset.detailAddCanvas'))
  addBtn.addEventListener('click', () => { pushRecent(item); item.onAdd() })
  actions.appendChild(addBtn)

  const favBtn = el('button', 'asset-detail-btn', t(isFav(item) ? 'asset.detailUnfav' : 'asset.detailFav'))
  favBtn.dataset.act = 'fav'
  favBtn.addEventListener('click', () => { toggleFav(item) })
  actions.appendChild(favBtn)

  if (item.path) {
    const locBtn = el('button', 'asset-detail-btn', t('asset.detailLocate'))
    locBtn.addEventListener('click', () => window.api.showInFolder(item.path))
    actions.appendChild(locBtn)

    const cpBtn = el('button', 'asset-detail-btn', t('asset.detailCopyPath'))
    cpBtn.addEventListener('click', () => copyText(item.path))
    actions.appendChild(cpBtn)
  }

  const cnBtn = el('button', 'asset-detail-btn', t('asset.detailCopyName'))
  cnBtn.addEventListener('click', () => copyText(item.name))
  actions.appendChild(cnBtn)
  body.appendChild(actions)

  panel.classList.add('show')
  detailCurrent = item
}

function refreshDetailFav() {
  const body = document.getElementById('assetDetailBody')
  if (!body || !detailCurrent) return
  const favBtn = body.querySelector('.asset-detail-btn[data-act="fav"]')
  if (favBtn) favBtn.textContent = t(isFav(detailCurrent) ? 'asset.detailUnfav' : 'asset.detailFav')
}

function hideDetail() {
  const panel = document.getElementById('assetDetailPanel')
  if (panel) panel.classList.remove('show')
  detailCurrent = null
}

export function initAssetLibrary() {
  const search = document.getElementById('assetLibSearch')
  if (search) search.addEventListener('input', () => { searchTerm = search.value; applyFilter() })
  buildToolbar()
  const refreshBtn = document.getElementById('assetLibRefresh')
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshAssetLibrary())
  const detailClose = document.getElementById('assetDetailClose')
  if (detailClose) detailClose.addEventListener('click', hideDetail)
  document.addEventListener('click', hideCtxMenu)
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('.asset-card')) hideCtxMenu() })
  onLocaleChange(() => {
    buildToolbar()
    rebuild()
    if (detailCurrent) showDetail(detailCurrent)
  })
  lastTexSig = sigEntries()
  rebuild()
  loadAssetStore()
  refreshAssetLibrary()
  startPoll()
}