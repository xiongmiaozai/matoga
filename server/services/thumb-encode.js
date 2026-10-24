/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const zlib = require('zlib')

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8
  ihdrData[9] = 6
  ihdrData[10] = 0
  ihdrData[11] = 0
  ihdrData[12] = 0
  const ihdr = chunk('IHDR', ihdrData)
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    if (Buffer.isBuffer(rgba)) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
    else raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 6 }))
  const iend = chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([sig, ihdr, idat, iend])
}

function aces(c) {
  const v = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function srgbEncode(c) {
  if (c < 0) c = 0; else if (c > 1) c = 1
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function tonemapToRGBA(width, height, data, exposure) {
  const out = Buffer.alloc(width * height * 4)
  let logSum = 0, logCount = 0
  for (let i = 0; i < width * height; i++) {
    const lum = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
    if (lum > 1e-6) { logSum += Math.log(lum); logCount++ }
  }
  const logAvg = logCount > 0 ? logSum / logCount : 0
  const exp = (exposure == null ? Math.exp(-logAvg) * 0.18 : exposure)
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = Math.round(srgbEncode(aces(data[i * 4] * exp)) * 255)
    out[i * 4 + 1] = Math.round(srgbEncode(aces(data[i * 4 + 1] * exp)) * 255)
    out[i * 4 + 2] = Math.round(srgbEncode(aces(data[i * 4 + 2] * exp)) * 255)
    out[i * 4 + 3] = 255
  }
  return out
}

function downsample(srcW, srcH, data, dstW, dstH) {
  const out = new Float32Array(dstW * dstH * 4)
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * srcW / dstW)
      const sx1 = Math.max(sx0 + 1, Math.min(srcW, Math.floor((dx + 1) * srcW / dstW)))
      const sy0 = Math.floor(dy * srcH / dstH)
      const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.floor((dy + 1) * srcH / dstH)))
      let r = 0, g = 0, b = 0, a = 0
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const si = (yy * srcW + xx) * 4
          r += data[si]; g += data[si + 1]; b += data[si + 2]; a += data[si + 3]
        }
      }
      const n = (sy1 - sy0) * (sx1 - sx0)
      const di = (dy * dstW + dx) * 4
      out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = a / n
    }
  }
  return out
}

const BLUR_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

function encode83(n, len) { let s = ''; for (let i = 1; i <= len; i++) { s = BLUR_CHARS[n % 83] + s; n = Math.floor(n / 83) } return s }
function sRGBToLinear(v) { v = Math.max(0, Math.min(1, v)); return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
function linearTosRGB(v) { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055 }
function encodeDC(v) { return Math.round(linearTosRGB(v) * 255) }
function encodeAC(v) { return Math.max(0, Math.min(18, Math.round(9 + 9 * Math.sign(v) * Math.pow(Math.abs(v), 0.5)))) }

function rgbaDownsample(srcW, srcH, rgba, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4)
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      let r = 0, g = 0, b = 0, n = 0
      const sx0 = Math.floor(dx * srcW / dstW), sx1 = Math.max(sx0 + 1, Math.min(srcW, Math.floor((dx + 1) * srcW / dstW)))
      const sy0 = Math.floor(dy * srcH / dstH), sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.floor((dy + 1) * srcH / dstH)))
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        const idx = (yy * srcW + xx) * 4; r += rgba[idx]; g += rgba[idx + 1]; b += rgba[idx + 2]; n++
      }
      const di = (dy * dstW + dx) * 4
      out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = 255
    }
  }
  return out
}

function encodeBlurhash(rgba, width, height, cx, cy) {
  cx = cx || 4; cy = cy || 3
  const factor = (x, y) => {
    let r = 0, g = 0, b = 0
    const nx = x === 0 ? 1 : 2, ny = y === 0 ? 1 : 2
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const c = Math.cos(Math.PI * x * i / width) * Math.cos(Math.PI * y * j / height)
        const idx = (j * width + i) * 4
        r += c * sRGBToLinear(rgba[idx] / 255)
        g += c * sRGBToLinear(rgba[idx + 1] / 255)
        b += c * sRGBToLinear(rgba[idx + 2] / 255)
      }
    }
    const s = nx * ny / (width * height)
    return [r * s, g * s, b * s]
  }
  let hash = encode83((cx - 1) + ((cy - 1) << 4), 1)
  const dc = factor(0, 0)
  hash += encode83((encodeDC(dc[0]) << 16) | (encodeDC(dc[1]) << 8) | encodeDC(dc[2]), 4)
  for (let y = 0; y < cy; y++) {
    for (let x = 0; x < cx; x++) {
      if (x === 0 && y === 0) continue
      const f = factor(x, y)
      hash += encode83(encodeAC(f[0]) * 361 + encodeAC(f[1]) * 19 + encodeAC(f[2]), 2)
    }
  }
  return hash
}

function generateThumb(buffer, ext, maxW, maxH) {
  const decoded = require('./hdr-decode').decodeByExt(buffer, ext)
  const ratio = Math.min(maxW / decoded.width, maxH / decoded.height, 1)
  let tw = Math.max(1, Math.round(decoded.width * ratio))
  let th = Math.max(1, Math.round(decoded.height * ratio))
  const sampled = (tw === decoded.width && th === decoded.height) ? decoded.data : downsample(decoded.width, decoded.height, decoded.data, tw, th)
  const rgba = tonemapToRGBA(tw, th, sampled)
  const bhRgba = rgbaDownsample(tw, th, rgba, 32, 16)
  const blurhash = encodeBlurhash(bhRgba, 32, 16, 4, 3)
  return { png: encodePNG(tw, th, rgba), blurhash, width: tw, height: th, srcWidth: decoded.width, srcHeight: decoded.height, format: decoded.format }
}

module.exports = { encodePNG, tonemapToRGBA, downsample, generateThumb, encodeBlurhash, aces, srgbEncode }