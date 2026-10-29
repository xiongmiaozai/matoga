/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { t } from '../i18n.js'
import { getAsset, setPackTexs, setPackBrowse, getPackBrowse } from './state.js'
import { esc, viewEl, truncStr } from './parts.js'

export function renderPackTextures(a){
  if (!a.fetchTextures) return ''
  return `
    <div class="np-section np-pack-tex">
      <div class="np-section-title">${esc(t('asset.detailPackTextures'))}<span class="np-tex-count" data-np-texcount></span></div>
      <div class="np-tex-cats" data-np-texcats></div>
      <div class="np-tex-crumb" data-np-texcrumb hidden></div>
      <div class="np-tex-dirs" data-np-texdirs hidden></div>
      <div class="np-tex-grid" data-np-texgrid>
        <div class="np-tx-empty">${esc(t('asset.packTexLoading'))}</div>
      </div>
      <div class="np-tex-foot" data-np-texfoot></div>
      <div class="np-tex-hint">${esc(t('asset.packTexAdd'))}</div>
    </div>`
}

export function fillPackTextures(a){
  setPackTexs(null)
  setPackBrowse({ dir: null, files: [], filesTotal: 0, loading: false })
  loadPackPage(a, false)
}

export function browsePackTextures(a, dir){
  setPackTexs(null)
  setPackBrowse({ dir: dir || null, files: [], filesTotal: 0, loading: false })
  const box = viewEl()
  const grid = box && box.querySelector('[data-np-texgrid]')
  if (grid) grid.innerHTML = `<div class="np-tx-empty">${esc(t('asset.packTexLoading'))}</div>`
  loadPackPage(a, false)
}

function _paintTexChips(box, d){
  const catsEl = box.querySelector('[data-np-texcats]')
  if (catsEl){
    catsEl.innerHTML = ''
    if (d.dir === null || d.dir === undefined){
      const all = document.createElement('button')
      all.className = 'np-chip on'
      all.textContent = t('asset.packTexAll') + ' · ' + (d.total || 0)
      catsEl.appendChild(all)
      ;(d.categories || []).forEach(c => {
        const b = document.createElement('button')
        b.className = 'np-chip'
        b.setAttribute('data-np-nav', c.dir)
        b.textContent = c.name + ' · ' + c.count
        catsEl.appendChild(b)
      })
    } else {
      const back = document.createElement('button')
      back.className = 'np-chip'
      back.setAttribute('data-np-nav', 'ROOT')
      back.textContent = '↩ ' + t('asset.packTexAll')
      catsEl.appendChild(back)
    }
  }
  const crumbEl = box.querySelector('[data-np-texcrumb]')
  if (crumbEl){
    const crumbs = d.breadcrumbs || []
    if (d.dir && crumbs.length > 1){
      crumbEl.hidden = false
      crumbEl.innerHTML = ''
      crumbs.forEach((c, i) => {
        const b = document.createElement('button')
        b.className = 'np-crumb' + (i === crumbs.length - 1 ? ' on' : '')
        b.setAttribute('data-np-nav', c.dir === null ? 'ROOT' : (c.dir || 'ROOT'))
        b.textContent = c.name === 'root' ? t('asset.packTexAll') : c.name
        crumbEl.appendChild(b)
        if (i < crumbs.length - 1){
          const sep = document.createElement('span')
          sep.className = 'np-crumb-sep'
          sep.textContent = '›'
          crumbEl.appendChild(sep)
        }
      })
    } else {
      crumbEl.hidden = true
    }
  }
  const dirsEl = box.querySelector('[data-np-texdirs]')
  if (dirsEl){
    const dirs = d.dirs || []
    dirsEl.hidden = !dirs.length
    dirsEl.innerHTML = ''
    dirs.forEach(sub => {
      const b = document.createElement('button')
      b.className = 'np-chip dir'
      b.setAttribute('data-np-nav', sub.dir)
      b.textContent = '📁 ' + sub.name + ' · ' + sub.count
      dirsEl.appendChild(b)
    })
  }
}

export function loadPackPage(a, append){
  const box = viewEl()
  if (!box || !getAsset() || getAsset() !== a || typeof a.fetchTextures !== 'function') return
  const grid = box.querySelector('[data-np-texgrid]')
  if (!grid || getPackBrowse().loading) return
  if (append && getPackBrowse().files.length >= getPackBrowse().filesTotal) return
  getPackBrowse().loading = true
  const offset = append ? getPackBrowse().files.length : 0
  a.fetchTextures({ dir: getPackBrowse().dir, offset }, (d) => {
    getPackBrowse().loading = false
    if (!grid.isConnected || !getAsset() || getAsset() !== a) return
    if (!d || d.error){
      grid.innerHTML = `<div class="np-tx-empty">${esc(t('asset.loadFailed', { msg: (d && d.error) || '—' }))}</div>`
      return
    }
    if (!append) _paintTexChips(box, d)
    getPackBrowse().filesTotal = d.filesTotal || 0
    const files = d.files || []
    getPackBrowse().files = append ? getPackBrowse().files.concat(files) : files
    setPackTexs(getPackBrowse().files)
    const countEl = box.querySelector('[data-np-texcount]')
    if (countEl) countEl.textContent = ' · ' + (d.total || 0)
    grid.innerHTML = ''
    if (!getPackBrowse().files.length){
      setPackTexs(null)
      grid.innerHTML = `<div class="np-tx-empty">${esc(t('asset.packTexEmpty'))}</div>`
    }
    getPackBrowse().files.forEach((f, i) => {
      const cell = document.createElement('div')
      cell.className = 'np-tex-cell'
      cell.setAttribute('data-np-tex', String(i))
      cell.title = f.path
      cell.innerHTML = `<img loading="lazy" src="${esc(f.rawUrl)}" alt=""><span class="np-tex-name">${esc(truncStr(f.name, 18))}</span>`
      grid.appendChild(cell)
    })
    const foot = box.querySelector('[data-np-texfoot]')
    if (foot){
      foot.innerHTML = ''
      if (getPackBrowse().files.length < getPackBrowse().filesTotal){
        const btn = document.createElement('button')
        btn.className = 'np-btn np-tex-more-btn'
        btn.setAttribute('data-np-texmore', '1')
        btn.textContent = t('asset.packTexLoadMore') + `（${getPackBrowse().files.length}/${getPackBrowse().filesTotal}）`
        foot.appendChild(btn)
      } else if (getPackBrowse().files.length){
        const tip = document.createElement('div')
        tip.className = 'np-tex-more'
        tip.textContent = t('asset.packTexShownAll', { n: getPackBrowse().files.length })
        foot.appendChild(tip)
      }
    }
  })
}

/* ── 主渲染 ─────────────────────────────── */
