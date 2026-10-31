import { IMG_EXTS } from '../core.js'

/** 与主文件一致的 DOM 简写。本模块不需要跨模块共享状态，故本地定义。 */
const $ = (sel) => document.querySelector(sel)

/**
 * matoga - 节点画布：导入贴图对话框
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-canvas.js 原样搬出（L2567-2791），逻辑未改。
 */


/* 主文件注入：这些属于主文件状态机，注入以避免反向 import 形成循环 */
let _canvasWrap = null
let _screenToWorld = null
let _createNode = null
let _toast = null
export function setImportHooks(hooks) {
  /* canvasWrap / screenToWorld / createNode / toast 属主文件，注入避免反向依赖 */
  if (hooks && hooks.canvasWrap != null) _canvasWrap = hooks.canvasWrap
  if (hooks && hooks.screenToWorld != null) _screenToWorld = hooks.screenToWorld
  if (hooks && hooks.createNode != null) _createNode = hooks.createNode
  if (hooks && hooks.toast != null) _toast = hooks.toast
}

/* ── 导入贴图 ─────────────────────────────────── */
const importOverlay = $('#importOverlay')
const importBody = $('#importBody')
const importInfo = $('#importInfo')

const TEX_SUF_IMP = [
  ['_n', 'normal'],
  ['_s', 'specular']
]

export function buildTexGroups(entries) {
  const groups = new Map()
  for (const e of entries) {
    if (e.isDirectory) continue
    const name = e.name
    const dot = name.lastIndexOf('.')
    if (dot < 0) continue
    if (!IMG_EXTS.has(name.slice(dot + 1).toLowerCase())) continue
    const base = name.slice(0, dot)
    let key = base,
      role = 'main'
    for (const [suf, r] of TEX_SUF_IMP) {
      if (base.endsWith(suf)) {
        key = base.slice(0, -suf.length)
        role = r
        break
      }
    }
    if (!groups.has(key)) groups.set(key, {})
    groups.get(key)[role] = e
  }
  return groups
}

export function texUrl(fullPath) {
  return `/api/file/raw?path=${encodeURIComponent(fullPath)}`
}

export async function openImportDlg() {
  importOverlay.classList.add('open')
  importInfo.textContent = '加载中…'
  importBody.innerHTML = '<div class="import-loading">正在读取配置与扫描文件…</div>'
  try {
    const cfgRes = await fetch('/api/config').then(r => r.json())
    const cfg = (cfgRes && cfgRes.data) || {}
    const sides = []
    if (cfg.leftPath) sides.push({ side: 'left', label: cfg.leftPath, path: cfg.leftPath })
    if (cfg.rightPath) sides.push({ side: 'right', label: cfg.rightPath, path: cfg.rightPath })
    if (sides.length === 0) {
      importBody.innerHTML = '<div class="import-empty">未设置左右路径。请先在主页面选择左右文件夹后再来导入。</div>'
      importInfo.textContent = '无可用路径'
      return
    }
    importBody.innerHTML = ''

    for (const s of sides) {
      const sideEl = document.createElement('div')
      sideEl.className = 'import-side'
      const h4 = document.createElement('h4')
      h4.innerHTML = `<span class="caret">▾</span>${s.side === 'left' ? '◀ 左侧' : '▶ 右侧'} <span class="tag">${s.label}</span>`
      h4.addEventListener('click', () => sideEl.classList.toggle('collapsed'))
      sideEl.appendChild(h4)
      try {
        const scanRes = await fetch('/api/compare/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: s.path, recursive: true })
        }).then(r => r.json())
        const entries = (scanRes && scanRes.data && scanRes.data.entries) || []
        const groups = buildTexGroups(entries)
        if (groups.size === 0) {
          sideEl.insertAdjacentHTML('beforeend', '<div class="import-empty">未发现贴图文件</div>')
          importBody.appendChild(sideEl)
          continue
        }

        const grid = document.createElement('div')
        grid.className = 'import-grid'
        groups.forEach((g, key) => {
          const card = document.createElement('div')
          card.className = 'import-card'
          const previewEntry = g.main || g.normal || g.specular
          const roleTags = []
          if (g.main) roleTags.push('<span class="r main">M</span>')
          if (g.normal) roleTags.push('<span class="r normal">N</span>')
          if (g.specular) roleTags.push('<span class="r specular">S</span>')
          card.innerHTML = `<div class="thumb">${previewEntry ? `<img src="${texUrl(previewEntry.fullPath)}" alt="" loading="lazy">` : ''}</div><div class="nm" title="${key}">${key}</div><div class="roles">${roleTags.join('')}</div>`
          card._group = g
          card._key = key
          card.addEventListener('click', () => {
            card.classList.toggle('selected')
            updateImportInfo()
          })
          grid.appendChild(card)
        })
        sideEl.appendChild(grid)
      } catch (err) {
        sideEl.insertAdjacentHTML('beforeend', `<div class="import-empty">扫描失败：${err.message}</div>`)
      }
      importBody.appendChild(sideEl)
    }
    applyImportFilter()
  } catch (e) {
    importBody.innerHTML = `<div class="import-empty">加载失败：${e.message}</div>`
    importInfo.textContent = '加载失败'
  }
}

let importSearchTerm = ''
let importRoleFilter = 'all'
let importSort = 'name-asc'
export function applyImportFilter() {
  const term = importSearchTerm.trim().toLowerCase()
  const cards = importOverlay.querySelectorAll('.import-card')
  let visible = 0,
    total = 0
  cards.forEach(card => {
    total++
    const key = (card._key || '').toLowerCase()
    const g = card._group || {}
    let roleOk = true
    if (importRoleFilter === 'main') roleOk = !!g.main
    else if (importRoleFilter === 'normal') roleOk = !!g.normal
    else if (importRoleFilter === 'specular') roleOk = !!g.specular
    const searchOk = !term || key.includes(term)
    const show = roleOk && searchOk
    card.style.display = show ? '' : 'none'
    if (show) visible++
  })
  const desc = importSort === 'name-desc'
  importOverlay.querySelectorAll('.import-grid').forEach(grid => {
    const arr = [...grid.children]
    arr.sort((a, b) => {
      const r = (a._key || '').localeCompare(b._key || '', 'zh')
      return desc ? -r : r
    })
    arr.forEach(c => grid.appendChild(c))
  })
  const cnt = document.getElementById('importCount')
  if (cnt) cnt.textContent = total ? `共 ${total} 组 · 匹配 ${visible}` : ''
  updateImportInfo()
}

export function updateImportInfo() {
  const n = importOverlay.querySelectorAll('.import-card.selected').length
  importInfo.textContent =
    n > 0 ? `已选择 ${n} 个贴图组，点击"导入所选"创建节点。` : '点击贴图组卡片选择，再次点击取消。'
}

export function doImport() {
  const cards = importOverlay.querySelectorAll('.import-card.selected')
  if (cards.length === 0) return
  const r = _canvasWrap.getBoundingClientRect()
  const wp = _screenToWorld(r.left + r.width / 2, r.top + r.height / 2)
  let col = 0,
    row = 0,
    count = 0
  const COLS = Math.min(cards.length, 4)
  cards.forEach(card => {
    const g = card._group
    ;['main', 'normal', 'specular'].forEach(role => {
      if (!g[role]) return
      const entry = g[role]
      const node = _createNode('texture', wp.x - 100 + col * 230, wp.y - 30 + row * 180)
      if (node) {
        node.props.tex = texUrl(entry.fullPath)
        node.props._name = entry.name
        node.props._role = role
        const thumb = node.el.querySelector('.w-tex .thumb')
        const fn = node.el.querySelector('.w-tex .fn')
        if (thumb) thumb.innerHTML = `<img src="${node.props.tex}" alt="">`
        if (fn) fn.textContent = entry.name.slice(0, 20)
        count++
      }
    })
    col++
    if (col >= COLS) {
      col = 0
      row++
    }
  })
  importOverlay.classList.remove('open')
  if (count > 0) _toast(`已导入 ${count} 个贴图节点`)
}

document.getElementById('importSearch').addEventListener('input', e => {
  importSearchTerm = e.target.value
  applyImportFilter()
})
document.querySelectorAll('#importRoleSeg button').forEach(b =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#importRoleSeg button').forEach(x => x.classList.remove('active'))
    b.classList.add('active')
    importRoleFilter = b.dataset.role
    applyImportFilter()
  })
)
document.querySelectorAll('#importSortSeg button').forEach(b =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#importSortSeg button').forEach(x => x.classList.remove('active'))
    b.classList.add('active')
    importSort = b.dataset.sort
    applyImportFilter()
  })
)
document.getElementById('importSelectAll').addEventListener('click', () => {
  importOverlay.querySelectorAll('.import-card').forEach(c => {
    if (c.style.display !== 'none') c.classList.add('selected')
  })
  updateImportInfo()
})
document.getElementById('importClearAll').addEventListener('click', () => {
  importOverlay.querySelectorAll('.import-card.selected').forEach(c => c.classList.remove('selected'))
  updateImportInfo()
})
$('#btn-import').addEventListener('click', openImportDlg)
$('#importClose').addEventListener('click', () => importOverlay.classList.remove('open'))
$('#importCancel').addEventListener('click', () => importOverlay.classList.remove('open'))
$('#importOk').addEventListener('click', doImport)

// 点击遮罩区域关闭导入对话框
importOverlay.addEventListener('click', e => {
  if (e.target === importOverlay) importOverlay.classList.remove('open')
})

