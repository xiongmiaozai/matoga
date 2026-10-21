/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 快速选包：folder-card-head 中左右两侧的「选择」旁下拉入口，
 * 分组列出 mc-packs（MC 资产包）与 official-packs（官方包）目录下的包，
 * 点击即以该包路径作为该侧对比目录加载（loadFromPath）。
 * 数据复用 /api/mc-packs/list 与 /api/mc-official/list（同构 { root, exists, packs }）。
 */

import { showToast } from './core.js'
import { loadFromPath } from './actions.js'
import { t, onLocaleChange } from './i18n.js'

const GROUPS = [
  { key: 'mc',       api: '/api/mc-packs/list',    labelKey: 'sidebar.mcPacksGroup',   emptyKey: 'sidebar.quickMcEmpty' },
  { key: 'official', api: '/api/mc-official/list', labelKey: 'sidebar.officialGroup',  emptyKey: 'sidebar.quickOfficialEmpty' },
]

const CACHE_TTL = 30_000
const cache = new Map()

let menuEl = null
let openSide = null
let openBtn = null
let seq = 0

function apiUrl(p) {
  return (window.matogaCore && window.matogaCore.url) ? window.matogaCore.url(p) : p
}

async function fetchGroup(group) {
  const hit = cache.get(group.key)
  if (hit && Date.now() - hit.time < CACHE_TTL) return hit.data
  const res = await fetch(apiUrl(group.api))
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || (j && j.code) || 'bad response')
  const data = { root: j.data && j.data.root, packs: (j.data && j.data.packs) || [] }
  cache.set(group.key, { time: Date.now(), data })
  return data
}

function clearCache() { cache.clear() }

function ensureMenu() {
  if (menuEl) return menuEl
  menuEl = document.createElement('div')
  menuEl.className = 'pack-menu'
  menuEl.style.display = 'none'
  document.body.appendChild(menuEl)
  document.addEventListener('pointerdown', (e) => {
    if (menuEl.style.display === 'none') return
    if (menuEl.contains(e.target) || (openBtn && openBtn.contains(e.target))) return
    closeMenu()
  }, true)
  window.addEventListener('resize', closeMenu)
  onLocaleChange(() => { if (openSide) { const s = openSide; closeMenu(); openMenu(s) } })
  return menuEl
}

function closeMenu() {
  if (menuEl) menuEl.style.display = 'none'
  if (openBtn) openBtn.classList.remove('active')
  openSide = null
  openBtn = null
  seq++
}

function positionMenu(btn) {
  const r = btn.getBoundingClientRect()
  menuEl.style.display = 'block'
  const w = Math.max(300, Math.min(380, window.innerWidth - r.left - 16))
  menuEl.style.width = w + 'px'
  menuEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px'
  const h = menuEl.offsetHeight
  const below = window.innerHeight - r.bottom
  if (below < Math.min(h + 12, 300) && r.top > below) {
    menuEl.style.top = ''
    menuEl.style.bottom = (window.innerHeight - r.top + 4) + 'px'
    menuEl.style.maxHeight = Math.min(r.top - 12, 420) + 'px'
  } else {
    menuEl.style.bottom = ''
    menuEl.style.top = (r.bottom + 4) + 'px'
    menuEl.style.maxHeight = Math.min(below - 12, 420) + 'px'
  }
}

function itemNode(side, pack) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'pack-menu-item' + (pack.kind === 'zip' ? ' is-zip' : '')
  const name = document.createElement('span')
  name.className = 'pack-menu-name'
  name.textContent = pack.name
  const meta = document.createElement('span')
  meta.className = 'pack-menu-meta'
  const bits = []
  if (pack.formatLabel) bits.push(pack.formatLabel)
  else if (pack.formatRange) bits.push(pack.formatRange)
  if (pack.textureCount) bits.push(t('sidebar.quickTexCount', { n: pack.textureCount }))
  meta.textContent = bits.join(' · ')
  btn.appendChild(name)
  btn.appendChild(meta)
  btn.title = pack.fullPath || pack.name
  if (pack.kind === 'zip') {
    btn.disabled = true
    btn.title = t('sidebar.quickZipHint')
  } else {
    btn.addEventListener('click', async () => {
      closeMenu()
      if (!pack.fullPath) return
      await loadFromPath(side, pack.fullPath)
    })
  }
  return btn
}

function emptyNode(key) {
  const div = document.createElement('div')
  div.className = 'pack-menu-empty'
  div.textContent = t(key)
  return div
}

function groupNode(label) {
  const div = document.createElement('div')
  div.className = 'pack-menu-group'
  div.textContent = label
  return div
}

async function openMenu(side) {
  const btn = document.getElementById(side === 'left' ? 'leftPackBtn' : 'rightPackBtn')
  if (!btn) return
  ensureMenu()
  const mySeq = ++seq
  openSide = side
  openBtn = btn
  btn.classList.add('active')

  menuEl.innerHTML = ''
  const loading = document.createElement('div')
  loading.className = 'pack-menu-empty'
  loading.textContent = t('sidebar.quickLoading')
  menuEl.appendChild(loading)
  positionMenu(btn)

  const frag = document.createDocumentFragment()
  let failCount = 0
  const results = await Promise.all(GROUPS.map(g => fetchGroup(g).catch(() => null)))
  if (mySeq !== seq) return
  results.forEach((data, i) => {
    const group = GROUPS[i]
    frag.appendChild(groupNode(t(group.labelKey)))
    if (!data) {
      failCount++
      frag.appendChild(emptyNode('sidebar.quickLoadErr'))
      return
    }
    const packs = (data.packs || []).filter(p => p && p.name)
    if (!packs.length) {
      frag.appendChild(emptyNode(group.emptyKey))
      return
    }
    for (const pack of packs) frag.appendChild(itemNode(side, pack))
  })
  const foot = document.createElement('div')
  foot.className = 'pack-menu-foot'
  foot.textContent = t('sidebar.quickFoot')
  frag.appendChild(foot)
  menuEl.innerHTML = ''
  menuEl.appendChild(frag)
  positionMenu(btn)
  if (failCount === GROUPS.length) showToast(t('sidebar.quickLoadErr'))
}

export function initPackPickers() {
  const left = document.getElementById('leftPackBtn')
  const right = document.getElementById('rightPackBtn')
  if (left) left.addEventListener('click', () => {
    if (openSide === 'left') closeMenu()
    else openMenu('left')
  })
  if (right) right.addEventListener('click', () => {
    if (openSide === 'right') closeMenu()
    else openMenu('right')
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuEl && menuEl.style.display !== 'none') closeMenu()
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeMenu() })

}