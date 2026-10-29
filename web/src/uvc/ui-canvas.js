/**
 * matoga - UV 编辑器 UI：画布区构建
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 ui-build.js 按职责搬出，逻辑未改。
 * 构建 canvasWrap / canvas / 隐藏上传 input / 空态与状态栏，并绑定拖放上传。
 * el 由调用方创建并传入；返回的 canvas 供调用方取 2d context。
 */

/**
 * 构建 UV 编辑器画布区。
 * @param {object} p
 * @param {object}   p.el       元素引用集合（就地写入）
 * @param {object}   p.state    uv state
 * @param {HTMLElement} p.wrap  外层容器
 * @param {Function} p.getTexDragData
 * @param {Function} p.isUsableTexUrl
 * @param {Function} p.applyCustomTexture
 * @param {Function} p.handleTextureFiles
 * @returns {{canvasWrap: HTMLElement, canvas: HTMLCanvasElement, fileInput: HTMLInputElement}}
 */
export function buildCanvasArea(p) {
  const { el, state, wrap, getTexDragData, isUsableTexUrl, applyCustomTexture, handleTextureFiles } = p

  /* 画布区 */
  const canvasWrap = document.createElement('div')
  canvasWrap.className = 'uvv-canvas-wrap'
  el.canvasWrap = canvasWrap
  const canvas = document.createElement('canvas')
  canvas.className = 'uvv-canvas'
  el.canvas = canvas
  canvasWrap.appendChild(canvas)

  /* 自定义贴图上传（隐藏 input 挂 wrap 尾部，保持 canvasWrap 子结构不变；拖放目标为画布区） */
  const fileInput = document.createElement('input')
  el.fileInput = fileInput
  fileInput.type = 'file'
  fileInput.multiple = true
  fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'
  fileInput.style.display = 'none'
  fileInput.addEventListener('change', () => {
    handleTextureFiles(fileInput.files)
    try { fileInput.value = '' } catch {}
  })

  canvasWrap.addEventListener('dragover', (e) => {
    if (!state.layout) return
    e.preventDefault()
    canvasWrap.classList.add('uvv-drop-active')
  })
  canvasWrap.addEventListener('dragleave', () => canvasWrap.classList.remove('uvv-drop-active'))
  canvasWrap.addEventListener('drop', (e) => {
    e.preventDefault()
    canvasWrap.classList.remove('uvv-drop-active')
    /* 资产库贴图卡片拖入：raw URL 直接替换当前贴图槽位（材质球带 normal/specular → PBR 预览） */
    const tex = getTexDragData(e.dataTransfer)
    if (tex) {
      if (state.layout && isUsableTexUrl(tex.url)) {
        const extra = (tex.normal || tex.specular) ? { normal: tex.normal || '', specular: tex.specular || '' } : undefined
        applyCustomTexture(tex.url, tex.name || null, null, extra)
      }
      return
    }
    const files = e.dataTransfer && e.dataTransfer.files
    handleTextureFiles(files)
  })

  el.emptyEl = document.createElement('div')
  el.emptyEl.className = 'uvv-empty'
  canvasWrap.appendChild(el.emptyEl)
  wrap.appendChild(canvasWrap)

  /* 状态栏 */
  el.statusEl = document.createElement('div')
  el.statusEl.className = 'uvv-status'
  wrap.appendChild(el.statusEl)
  wrap.appendChild(fileInput)   /* 隐藏上传 input（尾部，不占结构索引） */

  return { canvasWrap, canvas, fileInput }
}
