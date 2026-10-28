/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { fileUrl } from '../utils.js'
import { t } from '../i18n.js'

export function showPixelDiff(pairs, panel) {
  const btn = document.getElementById('pixelDiffBtn')
  if (btn) btn.disabled = true
  const existing = panel.querySelector('.pv-diff-result')
  if (existing) existing.remove()
  const container = document.createElement('div')
  container.className = 'pv-diff-result'
  container.innerHTML = `<div style="color:#ccc;font-size:12px;">${t('toast.computing')}</div>`
  panel.appendChild(container)

  Promise.all(pairs.map(([le, re, label]) => new Promise((resolve) => {
    const imgL = new Image(), imgR = new Image()
    imgL.onload = imgR.onload = () => { if (imgL.complete && imgR.complete) resolve([imgL, imgR, label]) }
    imgL.onerror = imgR.onerror = () => resolve(null)
    imgL.src = fileUrl(le.fullPath)
    imgR.src = fileUrl(re.fullPath)
    if (imgL.complete && imgR.complete) resolve([imgL, imgR, label])
  }))).then(results => {
    container.innerHTML = ''
    const valid = results.filter(r => r)
    if (!valid.length) { container.innerHTML = `<div style="color:#ccc;font-size:12px;">${t('toast.cannotCompute')}</div>`; if (btn) btn.disabled = false; return }

    const toolbar = document.createElement('div')
    toolbar.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;'
    const modes = [['diff', t('diff.modeDiff')], ['heat', t('diff.modeHeat')], ['channel', t('diff.modeChannel')], ['hist', t('diff.modeHist')]]
    let currentMode = 'diff'
    modes.forEach(([key, label]) => {
      const mb = document.createElement('button')
      mb.className = 'pv-diff-mode-btn' + (key === 'diff' ? ' active' : '')
      mb.textContent = label
      mb.dataset.mode = key
      mb.style.cssText = 'background:#2a3a5c;color:#a0b0d0;border:1px solid #3a4a6c;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;'
      toolbar.appendChild(mb)
    })
    container.appendChild(toolbar)

    const content = document.createElement('div')
    container.appendChild(content)

    const MAX_DIFF_DIM = 512
    const computed = valid.map(([imgL, imgR, label]) => {
      const ow = Math.max(imgL.naturalWidth, imgR.naturalWidth)
      const oh = Math.max(imgL.naturalHeight, imgR.naturalHeight)
      const sc = Math.min(1, MAX_DIFF_DIM / Math.max(ow, oh))
      const w = Math.max(1, Math.round(ow * sc)), h = Math.max(1, Math.round(oh * sc))
      const cL = document.createElement('canvas'), cR = document.createElement('canvas')
      cL.width = cR.width = w; cL.height = cR.height = h
      const xL = cL.getContext('2d'), xR = cR.getContext('2d')
      xL.drawImage(imgL, 0, 0, w, h); xR.drawImage(imgR, 0, 0, w, h)
      const dL = xL.getImageData(0, 0, w, h), dR = xR.getImageData(0, 0, w, h)
      const diff = new Uint8ClampedArray(w * h)
      const histData = new Uint32Array(256)
      let totalDiff = 0
      const channelDiff = [0, 0, 0]
      for (let i = 0, p = 0; i < dL.data.length; i += 4, p++) {
        const dr = Math.abs(dL.data[i] - dR.data[i])
        const dg = Math.abs(dL.data[i + 1] - dR.data[i + 1])
        const db = Math.abs(dL.data[i + 2] - dR.data[i + 2])
        const d = (dr + dg + db) / 3
        totalDiff += d; channelDiff[0] += dr; channelDiff[1] += dg; channelDiff[2] += db
        diff[p] = d; histData[Math.min(255, Math.round(d))]++
      }
      return { w, h, ow, oh, dL, dR, diff, histData, totalDiff, channelDiff, label }
    })

    function render() {
      content.innerHTML = ''
      for (const c of computed) {
        const { w, h, ow, oh, dL, dR, diff, histData, totalDiff, channelDiff, label } = c
        const pct = (totalDiff / (w * h * 255) * 100).toFixed(2)
        const row = document.createElement('div')
        row.style.cssText = 'margin-bottom:12px;'
        const dimNote = (w !== ow || h !== oh) ? ` (${w}×${h})` : ''
        row.innerHTML = `<div style="color:#fff;font-size:11px;margin-bottom:4px;">${t('diff.rowLabel', { label, pct, r: (channelDiff[0]/(w*h*255)*100).toFixed(1), g: (channelDiff[1]/(w*h*255)*100).toFixed(1), b: (channelDiff[2]/(w*h*255)*100).toFixed(1) })}${dimNote}</div>`

        if (currentMode === 'hist') {
          const cH = document.createElement('canvas')
          cH.width = 260; cH.height = 80
          const xH = cH.getContext('2d')
          const maxV = Math.max(...histData)
          xH.fillStyle = '#1a1a2e'; xH.fillRect(0, 0, 260, 80)
          for (let i = 0; i < 256; i++) {
            const bh = maxV > 0 ? (histData[i] / maxV) * 75 : 0
            xH.fillStyle = `hsl(${240 - (i / 255) * 240}, 70%, 55%)`
            xH.fillRect(i + 2, 78 - bh, 1, bh)
          }
          xH.fillStyle = '#666'; xH.font = '9px sans-serif'
          xH.fillText('0', 2, 80); xH.fillText('255', 248, 80)
          cH.style.cssText = 'border-radius:4px;background:#1a1a2e;'
          row.appendChild(cH)
        } else if (currentMode === 'channel') {
          const channels = [['R', 0, '#ff4444'], ['G', 1, '#44ff44'], ['B', 2, '#4444ff']]
          const wrap = document.createElement('div')
          wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;'
          channels.forEach(([name, ci, color]) => {
            const cC = document.createElement('canvas')
            cC.width = w; cC.height = h
            const xC = cC.getContext('2d')
            const dC = xC.createImageData(w, h)
            for (let i = 0; i < dL.data.length; i += 4) {
              const dv = Math.abs(dL.data[i + ci] - dR.data[i + ci])
              dC.data[i] = ci === 0 ? dv : 0; dC.data[i + 1] = ci === 1 ? dv : 0; dC.data[i + 2] = ci === 2 ? dv : 0; dC.data[i + 3] = 255
            }
            xC.putImageData(dC, 0, 0)
            const sub = document.createElement('div')
            sub.style.cssText = `text-align:center;`
            sub.innerHTML = `<div style="color:${color};font-size:10px;margin-bottom:2px;">${name}</div>`
            cC.style.cssText = 'max-width:100px;border-radius:4px;background:#000;'
            sub.appendChild(cC); wrap.appendChild(sub)
          })
          row.appendChild(wrap)
        } else {
          const cL = document.createElement('canvas'), cR = document.createElement('canvas'), cD = document.createElement('canvas')
          cL.width = cR.width = cD.width = w; cL.height = cR.height = cD.height = h
          cL.getContext('2d').putImageData(dL, 0, 0); cR.getContext('2d').putImageData(dR, 0, 0)
          const xD = cD.getContext('2d')
          const dD = xD.createImageData(w, h)
          for (let p = 0, i = 0; p < diff.length; p++, i += 4) {
            const d = diff[p]
            if (currentMode === 'diff') { dD.data[i] = d; dD.data[i + 1] = d; dD.data[i + 2] = d; dD.data[i + 3] = 255 }
            else {
              const tt = d / 255
              dD.data[i] = tt < 0.5 ? 0 : Math.round((tt - 0.5) * 510)
              dD.data[i + 1] = tt < 0.5 ? Math.round(tt * 510) : Math.round((1 - tt) * 510)
              dD.data[i + 2] = tt < 0.5 ? Math.round((0.5 - tt) * 510) : 0
              dD.data[i + 3] = 255
            }
          }
          xD.putImageData(dD, 0, 0)
          const canvases = document.createElement('div')
          canvases.style.cssText = 'display:flex;gap:6px;'
          cL.style.cssText = cR.style.cssText = cD.style.cssText = 'max-width:120px;border-radius:4px;background:#333;'
          canvases.appendChild(cL); canvases.appendChild(cR); canvases.appendChild(cD)
          row.appendChild(canvases)
        }
        content.appendChild(row)
      }
    }

    toolbar.querySelectorAll('button').forEach(mb => {
      mb.addEventListener('click', () => {
        toolbar.querySelectorAll('button').forEach(b => { b.classList.remove('active') })
        mb.classList.add('active')
        currentMode = mb.dataset.mode; render()
      })
    })
    render()
    if (btn) btn.disabled = false
  })
}
