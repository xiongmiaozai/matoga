/**
 * matoga - MC 模型：贴图通道提取
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 material3d.js 按领域搬出。
 * 职责：从位图抽取 RGBA 通道、粗糙度、金属度、自发光图。
 * 通道/粗糙度/金属度提取走 OffscreenCanvas Worker（v3.3.1 起），
 * 自发光图（extractEmissive）依赖双图合成，仍主线程同步执行。
 */
import * as THREE from 'three'

/* ── 像素处理 Worker：通道提取等重像素遍历移出主线程，避免 4K 贴图处理时卡顿 UI ── */
let m3dWorker = null
let m3dWorkerSeq = 0
const m3dWorkerPending = new Map()

function getM3dWorker() {
  if (m3dWorker) return m3dWorker
  m3dWorker = new Worker(new URL('../material3d-worker.js', import.meta.url), { type: 'module' })
  m3dWorker.onmessage = e => {
    const { id, bitmap } = e.data
    const resolve = m3dWorkerPending.get(id)
    if (resolve) {
      m3dWorkerPending.delete(id)
      resolve(bitmap)
    }
  }
  return m3dWorker
}

async function runPixelOp(op, image, params) {
  const bitmap = await createImageBitmap(image)
  const id = ++m3dWorkerSeq
  const w = getM3dWorker()
  return new Promise(resolve => {
    m3dWorkerPending.set(id, resolve)
    w.postMessage({ id, op, bitmap, params }, [bitmap])
  })
}

function bitmapToTexture(bitmap) {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export async function extractChannel(image, channelIndex, invert) {
  const bitmap = await runPixelOp('extractChannel', image, { channelIndex, invert })
  return bitmapToTexture(bitmap)
}

export async function extractRoughness(image) {
  const bitmap = await runPixelOp('extractRoughness', image, {})
  return bitmapToTexture(bitmap)
}

export async function extractMetalness(image) {
  const bitmap = await runPixelOp('extractMetalness', image, {})
  return bitmapToTexture(bitmap)
}

export function extractEmissive(specImage, mainImage) {
  const w = specImage.naturalWidth,
    h = specImage.naturalHeight
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(specImage, 0, 0)
  const specData = ctx.getImageData(0, 0, w, h).data
  let mainData = null
  if (mainImage) {
    const mc = document.createElement('canvas')
    mc.width = w
    mc.height = h
    const mctx = mc.getContext('2d', { willReadFrequently: true })
    mctx.drawImage(mainImage, 0, 0, w, h)
    mainData = mctx.getImageData(0, 0, w, h).data
  }
  const imageData = ctx.createImageData(w, h),
    d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    let a = specData[i + 3]
    if (a === 255) a = 0
    const mask = a / 254
    if (mainData) {
      d[i] = Math.round(mainData[i] * mask)
      d[i + 1] = Math.round(mainData[i + 1] * mask)
      d[i + 2] = Math.round(mainData[i + 2] * mask)
    } else {
      d[i] = d[i + 1] = d[i + 2] = Math.round(255 * mask)
    }
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}
