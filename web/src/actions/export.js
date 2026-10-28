/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { state, showToast, KIND_TEXT } from '../core.js'
import { formatSize, isImageFile, fileUrl, hasAny, leftRoles, rightRoles } from '../utils.js'
import { t, getLocale } from '../i18n.js'

export function exportResult() {
  if (state.result.length === 0) { showToast(t('toast.noExportData')); return }
  const lines = []
  lines.push(t('export.title'))
  lines.push(t('export.time', { time: new Date().toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US') }))
  lines.push(t('export.left', { path: state.leftPath }))
  lines.push(t('export.right', { path: state.rightPath }))
  lines.push('')
  lines.push(t('export.header'))
  lines.push('-'.repeat(70))
  for (const g of state.result) {
    const type = g.isMaterial ? t('type.material') : g.isModel ? t('type.model') : g.isDir ? t('type.folder') : t('type.file')
    const lc = g.isMaterial ? leftRoles(g).length : (hasAny(g.left) ? 1 : 0)
    const rc = g.isMaterial ? rightRoles(g).length : (hasAny(g.right) ? 1 : 0)
    lines.push([KIND_TEXT[g.kind], type, g.key, lc, rc].join('\t'))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = t('export.fileName', { ts: Date.now() })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast(t('toast.exported'))
}

export function exportHtml() {
  if (state.result.length === 0) { showToast(t('toast.noExportData')); return }
  const c = state.counts || {}
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const statusColor = { have: '#14ae67', diff: '#f7a600', partial: '#b8860b', miss: '#e5484d', extra: '#d97706' }
  const rows = []
  for (const g of state.result) {
    const type = g.isMaterial ? t('type.material') : g.isModel ? t('type.model') : g.isDir ? t('type.folder') : t('type.file')
    const color = statusColor[g.kind] || '#999'
    let leftThumb = '—', rightThumb = '—'
    const ml = g.isMaterial ? (g.left && g.left.main) : (g.left && (g.left.file || g.left.dir))
    const mr = g.isMaterial ? (g.right && g.right.main) : (g.right && (g.right.file || g.right.dir))
    if (ml && !ml.isDirectory && isImageFile(ml.name)) leftThumb = `<img src="${fileUrl(ml.fullPath)}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;" />`
    if (mr && !mr.isDirectory && isImageFile(mr.name)) rightThumb = `<img src="${fileUrl(mr.fullPath)}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;" />`
    rows.push(`<tr><td style="color:${color};font-weight:600;">${esc(KIND_TEXT[g.kind])}</td><td>${leftThumb}</td><td>${rightThumb}</td><td>${esc(g.key)}</td><td>${type}</td><td>${formatSize((ml || mr)?.size)}</td></tr>`)
  }
  const summary = t('export.htmlSummary', { left: esc(state.leftPath), right: esc(state.rightPath), have: c.have||0, diff: c.diff||0, partial: c.partial||0, miss: c.miss||0, extra: c.extra||0 })
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t('export.htmlTitle')}</title><style>body{font-family:system-serif;padding:20px;}h1{font-size:18px;}table{width:100%;border-collapse:collapse;font-size:13px;}th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left;}th{background:#f5f7fa;}.sum{margin:10px 0;padding:10px;background:#f5f7fa;border-radius:8px;}</style></head><body><h1>${t('export.htmlH1')}</h1><div class="sum">${summary}</div><table><thead><tr>${t('export.htmlHeader')}</tr></thead><tbody>${rows.join('')}</tbody></table></body></html>`
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = t('export.htmlFileName', { ts: Date.now() })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast(t('toast.exportedHtml'))
}
