/**
 * matoga - 对比结果表列宽拖拽与持久化
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 renderer.js 的内联 IIFE 抽出，逻辑未改。
 */
import { $ } from './core.js'

export function initTableColumnResize() {
  const table = $('resultTable')
  if (!table) return
  const ths = table.querySelectorAll('thead th')
  const COL_MIN = 40, COL_MAX = 600
  const colKey = (th) => th.dataset.key || (th.className.match(/col-(\w+)/) || [])[1] || th.cellIndex
  const saveWidths = async () => {
    const widths = {}
    ths.forEach(th => { const k = colKey(th); if (k) widths[k] = th.offsetWidth })
    await window.api.setConfig({ tableColWidths: widths })
  }
  ths.forEach((th, i) => {
    if (i === ths.length - 1) return
    const handle = document.createElement('div')
    handle.className = 'col-resize-handle'
    th.appendChild(handle)
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation()
      const startX = e.clientX, startW = th.offsetWidth
      handle.classList.add('dragging'); table.classList.add('resizing')
      const onMove = (ev) => { th.style.width = Math.max(COL_MIN, Math.min(COL_MAX, startW + ev.clientX - startX)) + 'px' }
      const onUp = () => {
        handle.classList.remove('dragging'); table.classList.remove('resizing')
        document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
        saveWidths()
      }
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    })
    handle.addEventListener('dblclick', () => {
      const ci = i + 1
      const prevW = th.style.width
      th.style.width = 'auto'
      void table.offsetWidth
      const naturalW = th.offsetWidth
      th.style.width = Math.max(COL_MIN, Math.min(COL_MAX, naturalW)) + 'px'
      saveWidths()
    })
  })
  window.api.getConfig().then(cfg => {
    if (!cfg.tableColWidths) return
    ths.forEach(th => { const k = colKey(th); if (k && cfg.tableColWidths[k]) th.style.width = cfg.tableColWidths[k] + 'px' })
  })

}
