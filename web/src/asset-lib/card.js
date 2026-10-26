/**
 * matoga - 总资产库：card
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { fileUrl, formatSize, formatDate, escAttr, apiUrl, setTexDragData, contentKindOfPath } from '../utils.js'
import { t, onLocaleChange } from '../i18n.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { isFav, pushRecent, toggleFav } from './items.js'
import { openDetail } from './detail.js'
import { showCtxMenu } from './ctx-menu.js'

export function makeCard(item) {
  const card = el('div', 'asset-card')
  card.draggable = true
  card.dataset.name = item.name
  card.dataset.type = item.type
  card.dataset.key = item.key
  card.dataset.kind = contentKindOfPath(item.path) || ''

  const th = el('div', 'ac-thumb')
  if (item.thumb) {
    const img = el('img')
    img.loading = 'lazy'
    img.alt = ''
    img.src = item.thumb
    img.addEventListener('error', () => {
      th.innerHTML = ''
      th.appendChild(el('span', 'ac-icon', '<svg class="ico"><use href="#i-image"/></svg>'))
    })
    th.appendChild(img)
  } else if (item.color && !item.icon) {
    th.style.background = `linear-gradient(135deg, ${item.color}, ${shade(item.color, -30)})`
    if (item.modelThumb) { th.classList.add('ac-thumb-3d'); th._modelThumbItem = item }
  } else {
    if (item.color) th.style.background = `linear-gradient(135deg, ${item.color}, ${shade(item.color, -30)})`
    th.appendChild(el('span', 'ac-icon', `<svg class="ico"><use href="#${item.icon || 'i-image'}"/></svg>`))
    if (item.modelThumb) { th.classList.add('ac-thumb-3d'); th._modelThumbItem = item }
  }
  card.appendChild(th)
  card.appendChild(el('div', 'ac-name', item.name))
  if (item.role) card.appendChild(el('div', 'ac-role ' + item.role, roleText(item.role)))
  else if (item.badge) card.appendChild(el('div', 'ac-role official', item.badge))

  const star = el('button', 'ac-star', isFav(item) ? '★' : '☆')
  star.title = isFav(item) ? t('asset.favOff') : t('asset.favOn')
  star.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(item) })
  card.appendChild(star)

  const add = () => { pushRecent(item); item.onAdd() }
  /* 可浏览（文件夹型）资产：单击延迟触发详情，双击直接进入包内容浏览 */
  let clickTimer = null
  card.addEventListener('click', () => {
    if (item.onBrowse) {
      if (clickTimer) clearTimeout(clickTimer)
      clickTimer = setTimeout(() => { clickTimer = null; openDetail(item) }, BROWSE_CLICK_DELAY)
    } else {
      openDetail(item)
    }
  })
  card.addEventListener('dblclick', (e) => {
    if (!item.onBrowse) return
    e.preventDefault()
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
    item.onBrowse()
  })
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', item.name)
    /* 贴图卡片：附带可加载的 raw URL，供 UV 编辑器等接收方拖放直接使用 */
    if (item.type === 'tex' && item.thumb) setTexDragData(e.dataTransfer, { name: item.name, url: item.thumb, path: item.path })
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
  if (!(r.width > 0 && r.height > 0 &&
    e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) return false
  /* 已投放到 UV 编辑器画布（浮窗可能覆盖节点画布上方）→ 不再视为添加到节点画布 */
  for (const uv of document.querySelectorAll('.uvv-canvas-wrap')) {
    const u = uv.getBoundingClientRect()
    if (u.width > 0 && u.height > 0 &&
      e.clientX >= u.left && e.clientX <= u.right && e.clientY >= u.top && e.clientY <= u.bottom) return false
  }
  return true
}

