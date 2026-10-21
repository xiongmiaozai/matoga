/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace
} from '/vendor/three/three.module.js'

const EXR_MAGIC = 20000630

function halfToFloat(h) {
  const s = (h >> 15) & 0x1
  const e = (h >> 10) & 0x1f
  const m = h & 0x3ff
  if (e === 0) {
    if (m === 0) return s ? -0 : 0
    return (s ? -1 : 1) * Math.pow(2, -14) * (m / 1024)
  }
  if (e === 31) return m ? NaN : (s ? -Infinity : Infinity)
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + m / 1024)
}

async function inflate(src) {
  if (typeof DecompressionStream === 'undefined') throw new Error('EXRLoader: DecompressionStream unavailable')
  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  writer.write(new Uint8Array(src)); writer.close()
  const reader = ds.readable.getReader()
  const chunks = []; let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value); total += value.length
  }
  const out = new Uint8Array(total); let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

function readNullStr(dv, pos) {
  let s = ''
  while (dv.getUint8(pos) !== 0) { s += String.fromCharCode(dv.getUint8(pos)); pos++ }
  return { str: s, next: pos + 1 }
}

function rleDecodeTo(src, p, targetLen) {
  const out = new Uint8Array(targetLen)
  let o = 0
  while (o < targetLen) {
    const count = src[p++]
    if (count < 128) {
      const val = src[p++]; const n = count + 1
      for (let k = 0; k < n; k++) out[o++] = val
    } else {
      const n = 257 - count
      for (let k = 0; k < n; k++) out[o++] = src[p++]
    }
  }
  return { data: out, next: p }
}

function reversePrediction(buf, start, len) {
  for (let i = 1; i < len; i++) buf[start + i] = (buf[start + i] + buf[start + i - 1]) & 0xff
}

class EXRLoader {
  constructor() { this.type = FloatType }
  setDataType(t) { this.type = t; return this }

  async parse(buffer) {
    const dv = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    if (dv.getUint32(0, true) !== EXR_MAGIC) throw new Error('EXRLoader: bad magic')
    const version = dv.getUint32(4, true)
    if (version & 0x200) throw new Error('EXRLoader: tiled not supported')
    if (version & 0x4000) throw new Error('EXRLoader: deep not supported')
    let pos = 8
    const attrs = {}
    while (true) {
      const { str: name, next: p1 } = readNullStr(dv, pos); pos = p1
      if (name === '') break
      const { str: type, next: p2 } = readNullStr(dv, pos); pos = p2
      const size = dv.getUint32(pos, true); pos += 4
      const start = pos
      if (type === 'int') attrs[name] = dv.getInt32(pos, true)
      else if (type === 'float') attrs[name] = dv.getFloat32(pos, true)
      else if (type === 'box2i') attrs[name] = [dv.getInt32(pos, true), dv.getInt32(pos + 4, true), dv.getInt32(pos + 8, true), dv.getInt32(pos + 12, true)]
      else if (type === 'lineOrder') attrs[name] = dv.getUint8(pos)
      else if (type === 'compression') attrs[name] = dv.getUint8(pos)
      else if (type === 'chlist') {
        const chs = []; let cp = pos
        while (cp < start + size) {
          const { str: cn, next: cnp } = readNullStr(dv, cp); cp = cnp
          if (cn === '') break
          const pixelType = dv.getInt32(cp, true); cp += 4
          const pLinear = dv.getUint8(cp); cp += 1; cp += 3
          const xSampling = dv.getInt32(cp, true); cp += 4
          const ySampling = dv.getInt32(cp, true); cp += 4
          chs.push({ name: cn, pixelType, pLinear, xSampling, ySampling })
        }
        chs.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        attrs[name] = chs
      }
      pos = start + size
    }
    const compression = attrs.compression
    if (compression == null) throw new Error('EXRLoader: missing compression')
    if (compression > 3) throw new Error('EXRLoader: compression ' + compression + ' not supported (use none/rle/zips/zip)')
    const dw = attrs.dataWindow
    if (!dw) throw new Error('EXRLoader: missing dataWindow')
    const xMin = dw[0], yMin = dw[1], xMax = dw[2], yMax = dw[3]
    const width = xMax - xMin + 1, height = yMax - yMin + 1
    const channels = attrs.channels
    if (!channels || !channels.length) throw new Error('EXRLoader: missing channels')
    const linesPerBlock = compression === 3 ? 16 : 1
    const numBlocks = Math.ceil(height / linesPerBlock)
    const offsets = []
    for (let i = 0; i < numBlocks; i++) {
      const lo = dv.getUint32(pos, true), hi = dv.getUint32(pos + 4, true)
      offsets.push(hi * 0x100000000 + lo); pos += 8
    }
    const chIdx = { R: -1, G: -1, B: -1, A: -1 }
    for (let i = 0; i < channels.length; i++) {
      const n = channels[i].name
      if (n === 'R' || n === 'r') chIdx.R = i
      else if (n === 'G' || n === 'g') chIdx.G = i
      else if (n === 'B' || n === 'b') chIdx.B = i
      else if (n === 'A' || n === 'a') chIdx.A = i
    }
    const sampleBytes = (pt) => pt === 1 ? 2 : 4
    const ciFor = (name) => name === 'R' || name === 'r' ? 0 : name === 'G' || name === 'g' ? 1 : name === 'B' || name === 'b' ? 2 : name === 'A' || name === 'a' ? 3 : -1
    const floatData = new Float32Array(width * height * 4)
    for (let b = 0; b < numBlocks; b++) {
      let bp = offsets[b]
      const yCoord = dv.getInt32(bp, true); bp += 4
      const psize = dv.getInt32(bp, true); bp += 4
      const pstart = bp
      const rowsInBlock = Math.min(linesPerBlock, yMax - yCoord + 1)
      let decoded
      if (compression === 0) {
        decoded = bytes.subarray(pstart, pstart + psize)
      } else if (compression === 1) {
        const totalBytes = channels.reduce((s, ch) => s + sampleBytes(ch.pixelType) * width * rowsInBlock, 0)
        decoded = new Uint8Array(totalBytes)
        let dp = pstart, off = 0
        for (let r = 0; r < rowsInBlock; r++) {
          for (const ch of channels) {
            const tlen = sampleBytes(ch.pixelType) * width
            const { data: d, next } = rleDecodeTo(bytes, dp, tlen)
            decoded.set(d, off); off += tlen; dp = next
          }
        }
      } else {
        decoded = await inflate(bytes.subarray(pstart, pstart + psize))
        let off = 0
        for (const ch of channels) {
          const cl = sampleBytes(ch.pixelType) * width * rowsInBlock
          reversePrediction(decoded, off, cl)
          off += cl
        }
      }
      const ddv = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength)
      const readSample = (xo, pt) => pt === 1 ? halfToFloat(decoded[xo] | (decoded[xo + 1] << 8)) : ddv.getFloat32(xo, true)
      if (compression === 1) {
        let off = 0
        for (let r = 0; r < rowsInBlock; r++) {
          const y = yCoord - yMin + r
          for (const ch of channels) {
            const sb = sampleBytes(ch.pixelType), ci = ciFor(ch.name)
            if (ci >= 0) for (let x = 0; x < width; x++) floatData[(y * width + x) * 4 + ci] = readSample(off + x * sb, ch.pixelType)
            off += sb * width
          }
        }
      } else {
        let off = 0
        for (const ch of channels) {
          const sb = sampleBytes(ch.pixelType), ci = ciFor(ch.name)
          if (ci >= 0) {
            for (let r = 0; r < rowsInBlock; r++) {
              const y = yCoord - yMin + r, rowOff = off + r * sb * width
              for (let x = 0; x < width; x++) floatData[(y * width + x) * 4 + ci] = readSample(rowOff + x * sb, ch.pixelType)
            }
          }
          off += sb * width * rowsInBlock
        }
      }
    }
    for (let i = 0; i < width * height; i++) {
      if (chIdx.R < 0) floatData[i * 4] = 0
      if (chIdx.G < 0) floatData[i * 4 + 1] = 0
      if (chIdx.B < 0) floatData[i * 4 + 2] = 0
      if (chIdx.A < 0) floatData[i * 4 + 3] = 1
    }
    let data, type
    if (this.type === HalfFloatType) {
      data = new Uint16Array(width * height * 4)
      for (let i = 0; i < width * height * 4; i++) data[i] = toHalfFloat(floatData[i])
      type = HalfFloatType
    } else {
      data = floatData; type = FloatType
    }
    return { width, height, data, type, colorSpace: LinearSRGBColorSpace, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, flipY: true, srcFormat: 'EXR' }
  }
}

function toHalfFloat(f) {
  if (f === 0) return 0
  const s = f < 0 ? 1 : 0
  let m = Math.abs(f)
  if (m > 65504) return s ? 0xfc00 : 0x7c00
  if (m < 1 / 1024 / 1024) {
    const v = m * 1024 * 1024 * 1024
    return (s << 15) | Math.round(v)
  }
  let e = 0
  while (m >= 2) { m /= 2; e++ }
  while (m < 1) { m *= 2; e-- }
  m -= 1; e += 14
  return (s << 15) | (e << 10) | Math.round(m * 1024)
}

export { EXRLoader }