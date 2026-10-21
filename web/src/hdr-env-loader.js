/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { HDRLoader } from './hdr-loader.js'
import { EXRLoader } from './exr-loader.js'
import {
  DataTexture,
  FloatType,
  RGBAFormat,
  LinearFilter,
  LinearSRGBColorSpace
} from 'three'

export function extFromUrl(url) {
  const m = (url || '').match(/\.([a-z0-9]+)(\?|$)/i)
  return m ? m[1].toLowerCase() : ''
}

export function detectExt(arrayBuffer, fallback) {
  const b = new Uint8Array(arrayBuffer)
  if (b.length >= 4 && b[0] === 0x76 && b[1] === 0x2f && b[2] === 0x31 && b[3] === 0x01) return 'exr'
  if (b.length >= 2 && b[0] === 0x23 && b[1] === 0x3f) return 'hdr'
  return (fallback || '').toLowerCase()
}

export async function parseEnvImage(arrayBuffer, ext) {
  const e = (ext || '').toLowerCase()
  if (e === 'exr') {
    const loader = new EXRLoader(); loader.setDataType(FloatType)
    return await loader.parse(arrayBuffer)
  }
  const loader = new HDRLoader(); loader.setDataType(FloatType)
  return loader.parse(arrayBuffer)
}

export async function loadEnvTexture(url, ext) {
  const resp = await fetch(url)
  const buf = await resp.arrayBuffer()
  const e = ext || detectExt(buf, extFromUrl(url))
  const parsed = await parseEnvImage(buf, e)
  const tex = new DataTexture(parsed.data, parsed.width, parsed.height, RGBAFormat, parsed.type)
  tex.colorSpace = parsed.colorSpace || LinearSRGBColorSpace
  tex.minFilter = parsed.minFilter || LinearFilter
  tex.magFilter = parsed.magFilter || LinearFilter
  tex.generateMipmaps = parsed.generateMipmaps || false
  tex.flipY = parsed.flipY !== undefined ? parsed.flipY : true
  tex.needsUpdate = true
  tex._srcFormat = parsed.srcFormat || (e === 'exr' ? 'EXR' : 'HDR (RGBE)')
  return tex
}

export async function parseEnvPixels(arrayBuffer, ext) {
  const parsed = await parseEnvImage(arrayBuffer, ext)
  return { width: parsed.width, height: parsed.height, data: parsed.data, format: parsed.srcFormat || (ext === 'exr' ? 'EXR' : 'HDR (RGBE)') }
}