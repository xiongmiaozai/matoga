/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const BLUR_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

function decode83(str, start, end) {
  let v = 0
  for (let i = start; i < end; i++) v = v * 83 + BLUR_CHARS.indexOf(str[i])
  return v
}

function sRGBToLinear(v) { v = Math.max(0, Math.min(1, v)); return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
function linearTosRGB(v) { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055 }
function decodeAC(v) { const a = (v - 9) / 9; return a * a * Math.sign(a) }

export function decodeBlurhash(blurhash, width, height, punch) {
  punch = punch || 1
  const sizeFlag = decode83(blurhash, 0, 1)
  const cx = (sizeFlag % 9) + 1
  const cy = Math.floor(sizeFlag / 9) + 1
  const dcV = decode83(blurhash, 1, 5)
  const dc = [sRGBToLinear((dcV >> 16) / 255), sRGBToLinear(((dcV >> 8) & 255) / 255), sRGBToLinear((dcV & 255) / 255)]
  const ac = []
  let i = 5
  for (let y = 0; y < cy; y++) {
    for (let x = 0; x < cx; x++) {
      if (x === 0 && y === 0) continue
      const v = decode83(blurhash, i, i + 2)
      ac.push([decodeAC(v % 19) * punch, decodeAC(Math.floor(v / 19) % 19) * punch, decodeAC(Math.floor(v / 361)) * punch])
      i += 2
    }
  }
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = dc[0], g = dc[1], b = dc[2]
      let acI = 0
      for (let fy = 0; fy < cy; fy++) {
        for (let fx = 0; fx < cx; fx++) {
          if (fx === 0 && fy === 0) continue
          const c = Math.cos(Math.PI * fx * x / width) * Math.cos(Math.PI * fy * y / height)
          const f = ac[acI++]
          r += f[0] * c; g += f[1] * c; b += f[2] * c
        }
      }
      const idx = (y * width + x) * 4
      out[idx] = Math.round(linearTosRGB(r) * 255)
      out[idx + 1] = Math.round(linearTosRGB(g) * 255)
      out[idx + 2] = Math.round(linearTosRGB(b) * 255)
      out[idx + 3] = 255
    }
  }
  return out
}

export function blurhashToDataUrl(blurhash, w, h) {
  if (!blurhash) return null
  try {
    const rgba = decodeBlurhash(blurhash, w, h)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.putImageData(new ImageData(rgba, w, h), 0, 0)
    return canvas.toDataURL('image/png')
  } catch { return null }
}