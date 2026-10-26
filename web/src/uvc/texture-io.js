/**
 * matoga - UV 编辑器自定义贴图（上传 / 拖放 / 移除 / 贴图库选择）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出，逻辑未改。
 */

import { readAsDataURL } from './utils.js'
import { loadTexImage } from './tex-cache.js'

/**
 * 创建自定义贴图控制器。
 * @param {object} o
 * @param {object} o.state            uv 编辑器 state
 * @param {object} o.hooks            宿主钩子
 * @param {Function} o.t              i18n
 * @param {Function} o.isUsableTexUrl 判断 URL 是否可用作贴图
 * @param {Function} o.rebuildChips   重建贴图槽芯片
 * @param {Function} o.requestDraw    节流重绘
 * @param {Function} o.draw           立即重绘
 * @param {Function} o.updateStatus   刷新状态栏
 * @param {Function} o.notifyDirty    脏状态通知
 * @param {Function} o.flashNotice    状态栏短提示
 */
export function createTextureIO(o) {
  const {
    state, hooks, t, isUsableTexUrl, rebuildChips,
    requestDraw, draw, updateStatus, notifyDirty, flashNotice,
  } = o

  async function handleTextureFiles(files) {
    const list = Array.from(files || []).filter(f => f && /^image\//.test(String(f.type || '')))
    if (!list.length || !state.layout) return
    const start = state.activeTex
    let replaced = 0
    for (let i = 0; i < list.length; i++) {
      const texIndex = start + i
      if (texIndex >= state.layout.textures.length) break
      try {
        const dataUrl = await readAsDataURL(list[i])
        applyCustomTexture(dataUrl, list[i].name, texIndex)
        replaced++
      } catch {}
    }
    if (replaced > 1) flashNotice(t('uv.replacedN', { n: replaced }))
  }

  function applyCustomTexture(dataUrl, filename, texIndex) {
    const layout = state.layout
    if (!layout || !isUsableTexUrl(dataUrl)) return
    const i = (texIndex != null && Number.isFinite(+texIndex)) ? +texIndex : state.activeTex
    const tex = layout.textures[i]
    if (!tex) return
    tex.url = dataUrl
    tex.mcmetaUrl = null   /* 自定义贴图无动画元数据 */
    if (filename) tex.name = String(filename).replace(/\.[^.]+$/, '')
    state.customTex.add(i)
    rebuildChips()
    loadTexImage(dataUrl, requestDraw)   /* 预载 → onload 后重绘 */
    if (typeof hooks.onTexture === 'function') {
      try { Promise.resolve(hooks.onTexture(i, dataUrl, layout)).catch(() => {}) } catch {}
    }
    updateStatus()
    draw()
    notifyDirty()
  }

  /* 移除材质：清空贴图槽位引用（face.tex 索引保持不变，不删除槽位本身）；
     UV 画布仅剩棋盘底 + 面矩形，3D 视口面变纯色（onTexture 空串 → 宿主清除材质）；
     重新上传 / 拖入 / 贴图库选择即可恢复 */
  function removeTexture(texIndex) {
    const layout = state.layout
    if (!layout) return
    const i = (texIndex != null && Number.isFinite(+texIndex)) ? +texIndex : state.activeTex
    const tex = layout.textures[i]
    if (!tex || !tex.url) return
    tex.url = ''
    tex.mcmetaUrl = null
    state.customTex.add(i)
    rebuildChips()
    updateStatus()
    draw()
    notifyDirty()
    if (typeof hooks.onTexture === 'function') {
      try { Promise.resolve(hooks.onTexture(i, '', layout)).catch(() => {}) } catch {}
    }
  }

  /* 贴图库选择：hooks.pickTexture 可覆盖（返回 Promise<{name,url}|null>）；
     默认动态加载 uv-tex-picker 浮窗（总资产库贴图 → raw URL） */
  async function pickLibraryTexture() {
    if (!state.layout) return
    let picked = null
    try {
      if (typeof hooks.pickTexture === 'function') {
        picked = await hooks.pickTexture()
      } else {
        const m = await import('../uv-tex-picker.js')
        picked = await m.openTexPicker()
      }
    } catch (e) { console.error('[uv-editor] tex-picker', e) }
    if (picked && isUsableTexUrl(picked.url)) {
      applyCustomTexture(picked.url, picked.name || null)
    }
  }

  return { handleTextureFiles, applyCustomTexture, removeTexture, pickLibraryTexture }
}
