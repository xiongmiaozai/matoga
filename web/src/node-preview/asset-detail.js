/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { t } from '../i18n.js'
import { getAsset, setPackTexs, getPackTexs } from './state.js'
import { esc, viewEl, truncStr } from './parts.js'
import { renderPackTextures, fillPackTextures, browsePackTextures, loadPackPage } from './pack-textures.js'

function renderAssetHead(a){
  return `
    <div class="np-head">
      <span class="np-head-accent" style="background:${esc(a.color || 'var(--primary)')}"></span>
      <div class="np-head-main">
        <div class="np-head-title">${esc(truncStr(a.name, 24))}</div>
        <div class="np-head-sub">
          <span class="np-badge">${esc(a.type)}</span>
          ${a.roleLabel ? `<span class="np-group">${esc(a.roleLabel)}</span>` : ''}
          <span class="np-id" title="${esc(a.typeLabel)}">${esc(a.typeLabel)}</span>
        </div>
      </div>
    </div>`
}

function renderAssetStage(a){
  let inner = ''
  if (a.thumb){
    inner = `
      <img class="np-img" src="${esc(a.thumb)}" alt="${esc(a.name)}"
           loading="lazy" title="${t('np.openImage')}"
           data-np-act="open-image">`
  } else if (a.color){
    inner = `<div class="np-color" data-np-act="none" style="background:linear-gradient(135deg, ${esc(a.color)}, ${esc(a.color2 || a.color)})"></div>`
  } else {
    inner = `<div class="np-none">${t('np.noPreview')}</div>`
  }
  return `<div class="np-stage">${inner}</div>`
}

function renderAssetMeta(a){
  const rows = []
  rows.push([t('asset.detailType'), a.typeLabel])
  if (a.roleLabel) rows.push([t('asset.detailRole'), a.roleLabel])
  if (a.type === 'project'){
    rows.push([t('asset.detailNodes'), String(a.nodeCount ?? '—')])
    rows.push([t('asset.detailTextures'), String(a.textureCount ?? '—')])
  }
  if (Array.isArray(a.metaRows)){
    for (const r of a.metaRows) rows.push(r)
  }
  rows.push([t('asset.detailPath'), a.path || t('asset.detailNoPath')])
  rows.push([t('asset.detailSize'), `<span data-np-info="size">${esc(a.sizeLabel || t('asset.detailLoading'))}</span>`])
  rows.push([t('asset.detailMtime'), `<span data-np-info="mtime">${esc(a.mtimeLabel || '—')}</span>`])
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.props')}</div>
      <table class="np-table">
        ${rows.map(([k, v]) => `<tr><td class="np-k">${esc(k)}</td><td class="np-v" style="word-break:break-all">${v}</td></tr>`).join('')}
      </table>
    </div>`
}

function renderAssetActions(a){
  const btns = []
  btns.push(`<button class="np-btn primary" data-np-asset-act="add">${esc(t(a.type === 'model' ? 'asset.detailViewViewport' : 'asset.detailAddCanvas'))}</button>`)
  btns.push(`<button class="np-btn" data-np-asset-act="fav">${esc(t(a.fav ? 'asset.detailUnfav' : 'asset.detailFav'))}</button>`)

  if (a.path){
    btns.push(`<button class="np-btn" data-np-asset-act="locate">${esc(t('asset.detailLocate'))}</button>`)
    btns.push(`<button class="np-btn" data-np-asset-act="copyPath">${esc(t('asset.detailCopyPath'))}</button>`)
  }
  btns.push(`<button class="np-btn" data-np-asset-act="copyName">${esc(t('asset.detailCopyName'))}</button>`)
  if (a.onRename){
    btns.push(`<button class="np-btn" data-np-asset-act="rename">${esc(t('asset.detailRename'))}</button>`)
  }
  if (a.onDelete){
    btns.push(`<button class="np-btn danger" data-np-asset-act="delete">${esc(t('asset.detailDeleteModel'))}</button>`)
  }
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.actions')}</div>
      <div class="np-actions">${btns.join('')}</div>
    </div>`
}

export function renderAsset(){
  const box = viewEl()
  if (!box || !getAsset()) return
  setPackTexs(null)
  box.innerHTML = `
    ${renderAssetHead(getAsset())}
    ${renderAssetStage(getAsset())}
    <div class="np-scroll">
      ${renderAssetMeta(getAsset())}
      ${renderPackTextures(getAsset())}
      ${renderAssetActions(getAsset())}
    </div>`
  if (getAsset().fetchInfo){
    const a = getAsset()
    getAsset().fetchInfo((info) => {
      if (getAsset() !== a) return
      const sv = box.querySelector('[data-np-info="size"]')
      const mv = box.querySelector('[data-np-info="mtime"]')
      if (!sv.isConnected || !box.isConnected) return
      if (sv && info && info.sizeLabel) sv.textContent = info.sizeLabel
      else if (sv && info && !info.exists) sv.textContent = t('asset.detailNotFound')
      else if (sv && !info) sv.textContent = '—'
      if (mv && info && info.mtimeLabel) mv.textContent = info.mtimeLabel
    })
  }
  fillPackTextures(getAsset())
}

export function onAssetAction(e){
  const texCell = e.target.closest('[data-np-tex]')
  if (texCell && getAsset() && Array.isArray(getPackTexs()) && typeof getAsset().onTextureAdd === 'function'){
    const idx = +texCell.getAttribute('data-np-tex')
    const tex = getPackTexs()[idx]
    if (tex){ try{ getAsset().onTextureAdd(tex) }catch(err){} }
    return
  }
  const nav = e.target.closest('[data-np-nav]')
  if (nav && getAsset()){
    const dir = nav.getAttribute('data-np-nav') || ''
    browsePackTextures(getAsset(), dir === 'ROOT' ? null : dir)
    return
  }
  const more = e.target.closest('[data-np-texmore]')
  if (more && getAsset()){ loadPackPage(getAsset(), true); return }
  const btn = e.target.closest('[data-np-asset-act]')
  if (!btn || !getAsset()) return
  const act = btn.getAttribute('data-np-asset-act')
  const fn = getAsset()['on' + act.charAt(0).toUpperCase() + act.slice(1)]
  if (typeof fn === 'function'){ try{ fn() }catch(err){} }
}

/* ── 官方材质包包内贴图：类别 + 层级 + 分页浏览 ── */
