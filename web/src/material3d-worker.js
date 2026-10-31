/**
 * matoga - material3d 像素处理 Worker
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 在 OffscreenCanvas 上执行通道提取等像素遍历，避免阻塞主线程。
 * 主线程传入 ImageBitmap（transferable），处理完毕返回新的 ImageBitmap。
 */

self.onmessage = async e => {
  const { id, op, bitmap, params } = e.data
  const w = bitmap.width
  const h = bitmap.height
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, w, h)
  const d = imageData.data

  if (op === 'extractChannel') {
    const { channelIndex, invert } = params
    for (let i = 0; i < d.length; i += 4) {
      let v = d[i + channelIndex]
      if (invert) v = 255 - v
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v
      d[i + 3] = 255
    }
  } else if (op === 'extractRoughness') {
    for (let i = 0; i < d.length; i += 4) {
      const r = 255 - d[i]
      d[i] = r
      d[i + 1] = r
      d[i + 2] = r
      d[i + 3] = 255
    }
  } else if (op === 'extractMetalness') {
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i + 1]
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v
      d[i + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  bitmap.close()
  const out = canvas.transferToImageBitmap()
  self.postMessage({ id, bitmap: out }, [out])
}
