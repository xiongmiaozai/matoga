/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { HDRLoader } from './hdr-loader.js'
import { EXRLoader } from './exr-loader.js'
import { FloatType } from '/vendor/three/three.module.js'

async function parsePixels(buffer, ext) {
  if (ext === 'exr') {
    const loader = new EXRLoader(); loader.setDataType(FloatType)
    return await loader.parse(buffer)
  }
  const loader = new HDRLoader(); loader.setDataType(FloatType)
  return loader.parse(buffer)
}

self.onmessage = async (e) => {
  const { id, buffer, ext } = e.data
  try {
    const result = await parsePixels(buffer, ext)
    const data = result.data
    const transfer = data.buffer
    self.postMessage({ id, ok: true, data: transfer, width: result.width, height: result.height, format: result.srcFormat || (ext === 'exr' ? 'EXR' : 'HDR (RGBE)') }, [transfer])
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message })
  }
}