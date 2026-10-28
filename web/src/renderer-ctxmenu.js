/**
 * matoga - 对比结果右键菜单
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 renderer.js 抽出，逻辑未改。
 */
import { state, showToast } from './core.js'
import { t } from './i18n.js'
import { selectGroup, renderResult } from './render.js'
import { uiPrompt } from './ui-dialog.js'
import { saveOptions, setGroupTag, clearGroupTag, handleAction } from './actions.js'

export function initCtxMenu() {
  const menu = $('ctxMenu')
  const tbody = $('resultBody')
  if (!menu || !tbody) return
  tbody.addEventListener('contextmenu', (ev) => {
    const tr = ev.target.closest('tr')
    if (!tr || !tr._group) return
    ev.preventDefault()
    const g = tr._group
    state.selected = g
    selectGroup(g)
    menu.style.display = 'block'
    const mx = Math.min(ev.clientX, window.innerWidth - 180)
    const my = Math.min(ev.clientY, window.innerHeight - 260)
    menu.style.left = mx + 'px'
    menu.style.top = my + 'px'
    menu.querySelectorAll('.ctx-item').forEach(item => {
      const act = item.dataset.act
      const pickEntry = (side) => { const s = g[side]; if (!s) return null; return s.main || s.file || s.dir || s.normal || s.specular || null }
      let enabled = true
      if (act === 'open-left' || act === 'loc-left') enabled = !!pickEntry('left')
      else if (act === 'open-right' || act === 'loc-right') enabled = !!pickEntry('right')
      else if (act === 'copy-to-right') enabled = !!(g.left && state.rightPath)
      else if (act === 'copy-to-left') enabled = !!(g.right && state.leftPath)
      else if (act === 'copy-source') enabled = !!(g.left || g.right)
      else if (act === 'paste-source') enabled = !!state.copySource
      else if (act === 'hide') enabled = !state.hiddenKeys.has(g.key)
      else if (act === 'unhide') enabled = state.hiddenKeys.has(g.key)
      else if (act === 'set-tag') enabled = true
      else if (act === 'clear-tag') enabled = !!state.customTags[g.key]
      item.classList.toggle('disabled', !enabled)
      item.onclick = enabled ? () => {
        if (act === 'hide') {
          state.hiddenKeys.add(g.key)
          saveOptions()
          renderResult()
        } else if (act === 'unhide') {
          state.hiddenKeys.delete(g.key)
          saveOptions()
          renderResult()
        } else if (act === 'set-tag') {
          uiPrompt({ title: t('ctx.setTag'), label: t('ctx.setTagLabel'), value: state.customTags[g.key] || '', placeholder: t('ctx.setTagPh'), okText: t('common.confirm'), cancelText: t('common.cancel') }).then(tag => {
            if (tag != null && tag.trim()) setGroupTag(g, tag.trim())
          })
        } else if (act === 'clear-tag') {
          clearGroupTag(g)
        } else if (act === 'copy-source') {
          const side = g.left ? 'left' : 'right'
          state.copySource = { key: g.key, side }
          showToast(t('toast.copySourceSet', { name: g.key, dest: t('common.' + (side === 'left' ? 'right' : 'left')) }))
        } else if (act === 'paste-source') {
          const src = state.copySource
          if (!src) { showToast(t('toast.noCopySource')); return }
          const fresh = state.result.find(r => r.key === src.key)
          if (!fresh) { showToast(t('toast.noCopySource')); return }
          const destSide = src.side === 'left' ? 'right' : 'left'
          handleAction(destSide === 'right' ? 'copy-to-right' : 'copy-to-left', fresh)
        } else {
          handleAction(act, g)
        }
        menu.style.display = 'none'
      } : null
    })
  })
  document.addEventListener('click', () => { menu.style.display = 'none' })
  document.addEventListener('contextmenu', (ev) => {
    if (!ev.target.closest('tr')) menu.style.display = 'none'
  })
}
