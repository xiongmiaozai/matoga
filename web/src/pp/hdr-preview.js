/**
 * matoga - 预览面板：HDR 预览弹窗
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 preview-panel.js 原样搬出，逻辑未改。弹窗的开关、曝光联动与 hdr:preview 事件。
 */

import { $ } from '../core.js'
import { openHdrPreview, disposeHdrPreview } from '../hdri-preset.js'

/** 初始化 HDR 预览弹窗（元素缺失时直接跳过）。 */
export function bindHdrPreviewModal() {
  ;(() => {
    const modal = $('hdrPreviewModal'), canvas = $('hdrPreviewCanvas'), closeBtn = $('hdrPreviewClose')
    const expSlider = $('hdrPreviewExposure'), expVal = $('hdrPreviewExposureVal'), infoEl = $('hdrPreviewInfo')
    if (!modal || !canvas || !closeBtn) return
    const closePreview = () => { modal.classList.remove('show'); disposeHdrPreview() }
    closeBtn.addEventListener('click', closePreview)
    modal.addEventListener('click', (e) => { if (e.target === modal) closePreview() })
    expSlider.addEventListener('input', (e) => { const v = parseFloat(e.target.value); expVal.textContent = v.toFixed(1); openHdrPreview(null, v) })
    window.addEventListener('hdr:preview', (e) => { const { url, name, info } = e.detail; openHdrPreview({ url, name, info, canvas, modal, expSlider, expVal, infoEl }) })
  })()
}
