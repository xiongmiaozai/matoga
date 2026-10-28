/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { t } from '../i18n.js'
import { esc, truncStr, fmtVal } from './parts.js'

export function renderHead(d){
  return `
    <div class="np-head">
      <span class="np-head-accent" style="background:${esc(d.def.color)}"></span>
      <div class="np-head-main">
        <div class="np-head-title">${esc(truncStr(d.title, 24))}</div>
        <div class="np-head-sub">
          <span class="np-badge">${esc(d.type)}</span>
          ${d.def.group ? `<span class="np-group">${esc(d.def.group)}</span>` : ''}
          <span class="np-id" title="${esc(d.id)}">${esc(d.id)}</span>
        </div>
      </div>
    </div>`
}

export function renderStage(d){
  const kind = d.previewKind
  let inner = ''
  if (kind === 'image' && d.previewUrl){
    inner = `
      <img class="np-img" src="${esc(d.previewUrl)}" alt="${esc(d.title)}"
           loading="lazy" title="${t('np.openImage')}"
           data-np-act="open-image">`
  } else if (kind === 'color' && d.props.color){
    inner = `
      <div class="np-color" data-np-act="none" style="background:${esc(d.props.color)}"></div>
      <div class="np-color-hex">${esc(d.props.color)}</div>`
  } else if (kind === 'value' && typeof d.props.value === 'number'){
    inner = `<div class="np-value">${fmtVal(d.props.value)}</div>`
  } else {
    inner = `<div class="np-none">${t('np.noPreview')}</div>`
  }
  return `<div class="np-stage">${inner}</div>`
}

export function renderProps(d){
  const keys = Object.keys(d.props).filter(k => !k.startsWith('_') && k !== 'tex' && k !== 'color' && k !== 'value')
  const rows = []
  if (d.previewKind === 'image' && d.props.tex) rows.push(['tex', truncStr(decodeURIComponent(String(d.props.tex)), 56)])
  if (typeof d.props.value === 'number' && d.previewKind !== 'value') rows.push(['value', fmtVal(d.props.value)])
  if (d.props.color && d.previewKind !== 'color') rows.push(['color', d.props.color])
  keys.forEach(k => rows.push([k, fmtVal(d.props[k])]))
  if (!rows.length) return ''
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.props')}</div>
      <table class="np-table">
        ${rows.map(([k, v]) => `
          <tr><td class="np-k">${esc(k)}</td><td class="np-v">${esc(v)}</td></tr>`).join('')}
      </table>
    </div>`
}

export function renderPorts(d){
  const inRows = d.def.inputs.map(p => {
    const c = d.connections.inputs.find(x => x.port === p.n)
    return `<tr>
      <td class="np-k">${esc(p.n)}</td>
      <td class="np-v"><span class="np-type" data-type="${esc(p.t)}">${esc(p.t)}</span>
        ${c ? `<span class="np-conn" title="${esc(c.fromTitle)} · ${esc(c.fromPort)}">← ${esc(truncStr(c.fromTitle, 14))} · ${esc(c.fromPort)}</span>` : `<span class="np-unconn">${t('np.unconnected')}</span>`}
      </td></tr>`
  })
  const outRows = d.def.outputs.map(p => {
    const cs = d.connections.outputs.filter(x => x.port === p.n)
    return `<tr>
      <td class="np-k">${esc(p.n)}</td>
      <td class="np-v"><span class="np-type" data-type="${esc(p.t)}">${esc(p.t)}</span>
        ${cs.length
          ? cs.map(c => `<span class="np-conn" title="${esc(c.toTitle)} · ${esc(c.toPort)}">→ ${esc(truncStr(c.toTitle, 14))} · ${esc(c.toPort)}</span>`).join(' ')
          : `<span class="np-unconn">${t('np.unconnected')}</span>`}
      </td></tr>`
  })
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.ports')}</div>
      <div class="np-ports-cols">
        <div>
          <div class="np-ports-sub">${t('np.inputs')}</div>
          <table class="np-table">${inRows.join('') || `<tr><td class="np-unconn" colspan="2">—</td></tr>`}</table>
        </div>
        <div>
          <div class="np-ports-sub">${t('np.outputs')}</div>
          <table class="np-table">${outRows.join('') || `<tr><td class="np-unconn" colspan="2">—</td></tr>`}</table>
        </div>
      </div>
    </div>`
}

export function renderEvalOut(d){
  const keys = Object.keys(d.evalOut)
  if (!keys.length) return ''
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.evalOut')}</div>
      <table class="np-table">
        ${keys.map(k => `<tr><td class="np-k">${esc(k)}</td><td class="np-v">${esc(fmtVal(d.evalOut[k]))}</td></tr>`).join('')}
      </table>
    </div>`
}

/* ── 资产详情（原「资产详情」窗口并入）──────── */
