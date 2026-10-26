/**
 * matoga - 材质 3D 视口：charts
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 原样搬出，逻辑未改。
 */
import {
  state, $, ROLE_LABEL, KIND_TEXT, STATUS_ORDER,
  leftBtn, rightBtn, onlyMissingChk, summaryEl, resultBody,
  leftPathEl, rightPathEl
} from '../core.js'
import {
  formatSize, formatDate, isImageFile, fileUrl, escAttr,
  folderOf, mainEntryOf, hasAny, leftRoles, rightRoles, subKind,
  openPreview, relPath, joinPath, modelTypeOf, modelBaseNameOf,
  groupTypeOf, groupContentKind, groupTagOf
} from '../utils.js'
import { t, onLocaleChange } from '../i18n.js'

export function updateSortIndicators() {
  document.querySelectorAll('.result-table th[data-key]').forEach(th => {
    th.classList.remove('asc', 'desc')
    if (th.dataset.key === state.sortKey) th.classList.add(state.sortDir)
  })
}

export function initViewTabs() {
  const tabs = document.querySelectorAll('.view-tab')
  const tableView = $('tableView')
  const chartView = $('chartView')
  const tableToolbar = $('tableToolbar')
  const statsDashboard = $('statsDashboard')
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const view = tab.dataset.view
      if (tableView) tableView.classList.toggle('active', view === 'table')
      if (chartView) chartView.classList.toggle('active', view === 'chart')
      if (tableToolbar) tableToolbar.style.display = view === 'table' ? '' : 'none'
      if (statsDashboard) statsDashboard.style.display = view === 'table' ? '' : 'none'
      if (view === 'chart') renderChart()
    })
  })
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === '1' || e.key === '2' || e.key === '3')) {
      if (e.key === '1') { if (tabs[0]) tabs[0].click() }
      else if (e.key === '2') { document.dispatchEvent(new CustomEvent('workspace:focus-panel', { detail: { id: 'modelCategory' } })) }
      else { if (tabs[1]) tabs[1].click() }
      e.preventDefault()
    }
  })
}

export function donutChart(segments) {
  const size = 180, r = 65, sw = 26
  const C = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) return ''
  let offset = 0
  const circles = segments.filter(s => s.value > 0).map(seg => {
    const len = (seg.value / total) * C
    const dash = `${len} ${C - len}`
    const circle = `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size/2} ${size/2})"/>`
    offset += len
    return circle
  }).join('')
  return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg">` +
    `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}"/>` +
    circles +
    `<text x="${size/2}" y="${size/2}" text-anchor="middle" dy="-2" class="chart-donut-num">${total}</text>` +
    `<text x="${size/2}" y="${size/2}" text-anchor="middle" dy="16" class="chart-donut-label">${t('render.totalGroups')}</text></svg>`
}

export function gaugeChart(pct, label, color) {
  const size = 180, r = 65, sw = 26
  const C = 2 * Math.PI * r
  const len = (Math.min(pct, 100) / 100) * C
  return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg">` +
    `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}"/>` +
    `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${len} ${C - len}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>` +
    `<text x="${size/2}" y="${size/2}" text-anchor="middle" dy="-2" class="chart-donut-num">${pct.toFixed(1)}%</text>` +
    `<text x="${size/2}" y="${size/2}" text-anchor="middle" dy="16" class="chart-donut-label">${label}</text></svg>`
}

export function barChart(items) {
  const max = Math.max(...items.map(i => i.value), 1)
  return items.map(item => {
    const pct = (item.value / max) * 100
    return `<div class="bar-row"><span class="bar-label">${item.label}</span>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${item.color}"></div></div>` +
      `<span class="bar-val">${item.value}</span></div>`
  }).join('')
}

export function renderChart() {
  const el = $('chartContent')
  if (!el) return
  const c = state.counts || { have: 0, diff: 0, partial: 0, miss: 0, extra: 0, leftTex: 0, rightTex: 0, rightMatch: 0, pbrExtra: 0 }
  const total = c.have + c.diff + c.partial + c.miss + c.extra
  const leftGroups = c.have + c.diff + c.partial + c.miss
  if (total === 0) {
    el.innerHTML = `<div class="chart-empty"><svg class="ico"><use href="#i-pie"/></svg><p>${t('render.chartEmpty')}</p></div>`
    return
  }
  const cov = c.leftTex > 0 ? c.rightMatch / c.leftTex * 100 : 0
  const consist = leftGroups > 0 ? c.have / leftGroups * 100 : 0
  const missRate = leftGroups > 0 ? c.miss / leftGroups * 100 : 0
  const diffRate = leftGroups > 0 ? c.diff / leftGroups * 100 : 0
  const extraRate = total > 0 ? c.extra / total * 100 : 0

  const sh = t('status.haveShort'), sd = t('status.diffShort'), sp = t('status.partialShort'), sm = t('status.missShort'), se = t('status.extraShort')

  const donut = donutChart([
    { value: c.have, color: 'var(--accent)', label: sh },
    { value: c.diff, color: 'var(--warn)', label: sd },
    { value: c.partial, color: 'var(--partial)', label: sp },
    { value: c.miss, color: 'var(--danger)', label: sm },
    { value: c.extra, color: 'var(--text-dim)', label: se },
  ])

  const legend = [
    { label: sh, value: c.have, color: 'var(--accent)' },
    { label: sd, value: c.diff, color: 'var(--warn)' },
    { label: sp, value: c.partial, color: 'var(--partial)' },
    { label: sm, value: c.miss, color: 'var(--danger)' },
    { label: se, value: c.extra, color: 'var(--text-dim)' },
  ].map(l => `<div class="legend-item"><span class="legend-dot" style="background:${l.color}"></span>${l.label} <b>${l.value}</b></div>`).join('')

  const bars = barChart([
    { label: sh, value: c.have, color: 'var(--accent)' },
    { label: sd, value: c.diff, color: 'var(--warn)' },
    { label: t('status.partialFull'), value: c.partial, color: 'var(--partial)' },
    { label: sm, value: c.miss, color: 'var(--danger)' },
    { label: se, value: c.extra, color: 'var(--text-dim)' },
  ])

  const texBars = barChart([
    { label: t('render.leftTex'), value: c.leftTex, color: 'var(--primary)' },
    { label: t('render.rightTex'), value: c.rightTex, color: 'var(--accent)' },
    { label: t('render.matchTex'), value: c.rightMatch, color: 'var(--accent)' },
    { label: t('render.pbrTitle'), value: c.pbrExtra, color: 'var(--partial)' },
    ...(c.leftModel ? [
      { label: t('render.leftModel'), value: c.leftModel, color: 'var(--primary)' },
      { label: t('render.rightModel'), value: c.rightModel, color: 'var(--accent)' },
      { label: t('render.matchModel'), value: c.modelMatch, color: 'var(--accent)' },
    ] : []),
  ])

  const rateCards = [
    { label: t('render.covTitle'), val: cov, sub: t('render.covSub', { match: c.rightMatch, total: c.leftTex }), color: 'var(--primary)' },
    { label: t('render.consistTitle'), val: consist, sub: t('render.consistSub', { have: c.have, total: leftGroups }), color: 'var(--accent)' },
    { label: t('render.missTitle'), val: missRate, sub: t('render.missSub', { n: c.miss }), color: 'var(--danger)' },
    { label: t('render.diffTitle'), val: diffRate, sub: t('render.diffSub', { n: c.diff }), color: 'var(--warn)' },
    { label: t('render.redundancyTitle'), val: extraRate, sub: t('render.extraSub', { n: c.extra }), color: 'var(--text-dim)' },
  ].map(r => `<div class="rate-card" style="--rc:${r.color}"><div class="rate-label">${r.label}</div>` +
    `<div class="rate-val">${r.val.toFixed(1)}<span class="rate-unit">%</span></div>` +
    `<div class="rate-bar"><div class="rate-fill" style="width:${Math.min(r.val,100)}%"></div></div>` +
    `<div class="rate-sub">${r.sub}</div></div>`).join('')

  const funnelData = [
    { label: t('render.leftTotalGroups'), value: leftGroups, color: 'var(--primary)' },
    { label: t('render.rightExist'), value: leftGroups - c.miss, color: 'var(--accent)' },
    { label: t('render.consistPartial'), value: c.have + c.partial, color: 'var(--partial)' },
    { label: t('render.fullConsist'), value: c.have, color: 'var(--accent)' },
  ]
  const funnelMax = funnelData[0].value || 1
  const funnel = funnelData.map((f, i) => {
    const pct = (f.value / funnelMax) * 100
    const rate = i > 0 && funnelData[i - 1].value > 0 ? (f.value / funnelData[i - 1].value * 100).toFixed(0) : '100'
    return `<div class="funnel-row" style="width:${Math.max(pct, 8)}%;background:${f.color}">` +
      `<span class="funnel-label">${f.label}</span>` +
      `<span class="funnel-value">${f.value}</span>` +
      `<span class="funnel-rate">${rate}%</span></div>`
  }).join('')

  const stackColors = { have: 'var(--accent)', diff: 'var(--warn)', partial: 'var(--partial)', miss: 'var(--danger)', extra: 'var(--text-dim)' }
  const stackLabels = { have: sh, diff: sd, partial: sp, miss: sm, extra: se }
  const folderMap = new Map()
  for (const g of state.result) {
    const f = folderOf(g)
    if (!folderMap.has(f)) folderMap.set(f, { have: 0, diff: 0, partial: 0, miss: 0, extra: 0, total: 0 })
    const fs = folderMap.get(f)
    fs[g.kind]++
    fs.total++
  }
  const topFolders = [...folderMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 12)
  const folderBars = topFolders.map(([folder, fs]) => {
    const segs = ['have', 'diff', 'partial', 'miss', 'extra'].map(k =>
      fs[k] > 0 ? `<div class="stack-seg" style="flex:${fs[k]};background:${stackColors[k]}" title="${stackLabels[k]}: ${fs[k]}"></div>` : ''
    ).join('')
    return `<div class="stack-row"><span class="stack-label" title="${folder}">${folder}</span>` +
      `<div class="stack-track">${segs}</div><span class="stack-val">${fs.total}</span></div>`
  }).join('')

  const heatFolders = topFolders.slice(0, 10)
  const heatMax = Math.max(...heatFolders.flatMap(([, fs]) => [fs.have, fs.diff, fs.partial, fs.miss, fs.extra]), 1)
  const heatHeader = `<div class="heat-row heat-head"><span class="heat-label">${t('render.heatFolder')}</span>` +
    [sh, sd, sp, sm, se].map(l => `<div class="heat-cell">${l}</div>`).join('') + `</div>`
  const heatRows = heatFolders.map(([folder, fs]) => {
    const cells = ['have', 'diff', 'partial', 'miss', 'extra'].map(k => {
      const v = fs[k]
      const intensity = v / heatMax
      const bgAlpha = v > 0 ? 0.12 + intensity * 0.88 : 0
      return `<div class="heat-cell" title="${stackLabels[k]}: ${v}">` +
        (v > 0 ? `<div class="heat-bg" style="opacity:${bgAlpha};background:${stackColors[k]}"></div><span>${v}</span>` : '') +
        `</div>`
    }).join('')
    return `<div class="heat-row"><span class="heat-label" title="${folder}">${folder}</span>${cells}</div>`
  }).join('')

  const typeMap = new Map()
  for (const g of state.result) {
    const e = mainEntryOf(g)
    if (e && e.name) {
      const dot = e.name.lastIndexOf('.')
      const ext = dot >= 0 ? e.name.slice(dot + 1).toLowerCase() : 'other'
      typeMap.set(ext, (typeMap.get(ext) || 0) + 1)
    }
  }
  const typeColors = ['var(--primary)', 'var(--accent)', 'var(--warn)', 'var(--partial)', 'var(--danger)', 'var(--extra)', 'var(--text-dim)']
  const typeSegs = [...typeMap.entries()].sort((a, b) => b[1] - a[1]).map(([ext, count], i) =>
    ({ value: count, color: typeColors[i % typeColors.length], label: ext })
  )
  const typeDonut = donutChart(typeSegs)
  const typeLegend = typeSegs.map(s =>
    `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>.${s.label} <b>${s.value}</b></div>`
  ).join('')

  const sizeBuckets = [
    { label: '<1KB', min: 0, max: 1024, count: 0 },
    { label: '1-10KB', min: 1024, max: 10240, count: 0 },
    { label: '10-100KB', min: 10240, max: 102400, count: 0 },
    { label: '100KB-1MB', min: 102400, max: 1048576, count: 0 },
    { label: '1-10MB', min: 1048576, max: 10485760, count: 0 },
    { label: '>10MB', min: 10485760, max: Infinity, count: 0 },
  ]
  for (const g of state.result) {
    const e = mainEntryOf(g)
    if (e && e.size != null) {
      for (const b of sizeBuckets) { if (e.size >= b.min && e.size < b.max) { b.count++; break } }
    }
  }
  const sizeBars = barChart(sizeBuckets.map(b =>
    ({ label: b.label, value: b.count, color: 'var(--primary)' })
  ))

  el.innerHTML = `<div class="chart-grid">` +
    `<div class="chart-card"><div class="chart-card-title">${t('render.chartStatusDist')}</div><div class="chart-donut-wrap">${donut}</div><div class="chart-legend">${legend}</div></div>` +
    `<div class="chart-card"><div class="chart-card-title">${t('render.chartCovGauge')}</div><div class="chart-donut-wrap">${gaugeChart(cov, t('render.covTitle'), 'var(--primary)')}</div></div>` +
    `<div class="chart-card chart-wide"><div class="chart-card-title">${t('render.chartCategoryCount')}</div><div class="chart-bars">${bars}</div></div>` +
    `<div class="chart-card chart-wide"><div class="chart-card-title">${t('render.chartTexCompare')}</div><div class="chart-bars">${texBars}</div></div>` +
    `<div class="chart-card chart-full"><div class="chart-card-title">${t('render.chartMetrics')}</div><div class="rate-cards">${rateCards}</div></div>` +
    `<div class="chart-card"><div class="chart-card-title">${t('render.chartTypeDist')}</div><div class="chart-donut-wrap">${typeDonut}</div><div class="chart-legend">${typeLegend}</div></div>` +
    `<div class="chart-card"><div class="chart-card-title">${t('render.chartSizeDist')}</div><div class="chart-bars">${sizeBars}</div></div>` +
    `<div class="chart-card chart-full"><div class="chart-card-title">${t('render.chartFunnel')}</div><div class="chart-funnel">${funnel}</div></div>` +
    `<div class="chart-card chart-full"><div class="chart-card-title">${t('render.chartFolderDist')}</div><div class="chart-stacks">${folderBars}</div></div>` +
    `<div class="chart-card chart-full"><div class="chart-card-title">${t('render.chartHeatmap')}</div><div class="chart-heat">${heatHeader}${heatRows}</div></div>` +
    `</div>`

}
