/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js L583-L649 原样搬出（正文逐字未改）。
 */

import { computeSplitRatio } from '../splitter-ratio.js'

export function setHooks(h) {}

export function bindSplitterDragTip(splitter) {
  if (splitter.dataset.wsTipBound) return
  splitter.dataset.wsTipBound = '1'
  let tip = null
  let raf = 0
  let tipTimer = 0
  const neighbours = () => {
    const prev = splitter.previousElementSibling
    const next = splitter.nextElementSibling
    return prev && next ? [prev, next] : null
  }
  const doUpdate = () => {
    const pair = neighbours()
    if (!pair) return
    const [prev, next] = pair
    const pr = prev.getBoundingClientRect()
    const nr = next.getBoundingClientRect()
    if (pr.width === 0 && pr.height === 0) return
    const sr = splitter.getBoundingClientRect()
    const { a, b } = computeSplitRatio(pr, nr)
    if (!tip) {
      tip = document.createElement('div')
      tip.className = 'lm-splitter-tip'
      document.body.appendChild(tip)
      requestAnimationFrame(() => tip && tip.classList.add('lm-show'))
    }
    tip.textContent = a + ' : ' + b
    tip.style.left = sr.left + sr.width / 2 + 'px'
    tip.style.top = sr.top + sr.height / 2 + 'px'
    window.dispatchEvent(new Event('resize'))
  }
  const update = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      doUpdate()
    })
  }
  const end = () => {
    splitter.removeEventListener('pointermove', update)
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const pair = neighbours()
    if (pair) pair.forEach(el => el.classList.remove('lm-split-active'))

    window.dispatchEvent(new Event('resize'))
    if (tip) {
      tip.classList.remove('lm-show')
      const old = tip
      clearTimeout(tipTimer)
      tipTimer = setTimeout(() => old.remove(), 130)
      tip = null
    }
  }
  splitter.addEventListener('pointerdown', () => {
    const pair = neighbours()
    if (pair) pair.forEach(el => el.classList.add('lm-split-active'))

    doUpdate()
    splitter.addEventListener('pointermove', update)
    splitter.addEventListener('pointerup', end, { once: true })
    document.addEventListener('pointerup', end, { once: true })
  })
}
