/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const zlib = require('zlib')

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

function decodeHDR(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 0
  const readLine = () => {
    let s = ''
    while (pos < bytes.length && bytes[pos] !== 0x0a) { s += String.fromCharCode(bytes[pos]); pos++ }
    pos++
    return s
  }
  const first = readLine()
  if (!/^#\?(\S+)/.test(first)) throw new Error('HDR decode: bad magic')
  let width = 0, height = 0, format = ''
  while (pos < bytes.length) {
    const line = readLine()
    if (line === '') continue
    if (line.charAt(0) === '#') continue
    let m
    if ((m = line.match(/^\s*FORMAT=(\S+)\s*$/))) format = m[1]
    if ((m = line.match(/^\s*-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/))) { height = +m[1]; width = +m[2]; break }
  }
  if (!width || !height) throw new Error('HDR decode: missing dimensions')
  const RLE = (src, w, h) => {
    if (((w < 8) || (w > 0x7fff)) || ((2 !== src[0]) || (2 !== src[1]) || (src[2] & 0x80))) return src
    const out = new Uint8Array(4 * w * h)
    let off = 0, p = 0, ptrEnd = 4 * w
    const sl = new Uint8Array(ptrEnd), start = new Uint8Array(4)
    let num = h
    while ((num > 0) && (p < src.length)) {
      start[0] = src[p++]; start[1] = src[p++]; start[2] = src[p++]; start[3] = src[p++]
      let ptr = 0, count
      while ((ptr < ptrEnd) && (p < src.length)) {
        count = src[p++]; const enc = count > 128; if (enc) count -= 128
        if ((0 === count) || (ptr + count > ptrEnd)) throw new Error('HDR decode: bad scanline')
        if (enc) { const v = src[p++]; for (let i = 0; i < count; i++) sl[ptr++] = v }
        else { sl.set(src.subarray(p, p + count), ptr); ptr += count; p += count }
      }
      for (let i = 0; i < w; i++) {
        let o = 0
        out[off] = sl[i + o]; o += w
        out[off + 1] = sl[i + o]; o += w
        out[off + 2] = sl[i + o]; o += w
        out[off + 3] = sl[i + o]; off += 4
      }
      num--
    }
    return out
  }
  const rgba = RLE(bytes.subarray(pos), width, height)
  const data = new Float32Array(width * height * 4)
  for (let j = 0; j < width * height; j++) {
    const e = rgba[j * 4 + 3]; const scale = Math.pow(2, e - 128) / 255
    data[j * 4] = rgba[j * 4] * scale
    data[j * 4 + 1] = rgba[j * 4 + 1] * scale
    data[j * 4 + 2] = rgba[j * 4 + 2] * scale
    data[j * 4 + 3] = 1
  }
  return { width, height, data, format: 'HDR (RGBE)' }
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
    if (p >= src.length) throw new Error('EXR decode: truncated RLE data')
    const count = src[p++]
    if (count < 128) {
      if (p >= src.length) throw new Error('EXR decode: truncated RLE data')
      const val = src[p++]
      const n = count + 1
      for (let k = 0; k < n; k++) out[o++] = val
    } else {
      const n = 257 - count
      if (p + n > src.length) throw new Error('EXR decode: truncated RLE data')
      for (let k = 0; k < n; k++) out[o++] = src[p++]
    }
  }
  return { data: out, next: p }
}

function reversePrediction(buf, start, len) {
  for (let i = 1; i < len; i++) buf[start + i] = (buf[start + i] + buf[start + i - 1]) & 0xff
}

function decodeEXR(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== EXR_MAGIC) throw new Error('EXR decode: bad magic')
  const version = dv.getUint32(4, true)
  if (version & 0x200) throw new Error('EXR decode: tiled not supported')
  if (version & 0x4000) throw new Error('EXR decode: deep not supported')
  let pos = 8
  const attrs = {}
  while (true) {
    const { str: name, next: p1 } = readNullStr(dv, pos)
    pos = p1
    if (name === '') break
    const { str: type, next: p2 } = readNullStr(dv, pos)
    pos = p2
    const size = dv.getUint32(pos, true); pos += 4
    const start = pos
    if (type === 'int') attrs[name] = dv.getInt32(pos, true)
    else if (type === 'float') attrs[name] = dv.getFloat32(pos, true)
    else if (type === 'double') attrs[name] = dv.getFloat64(pos, true)
    else if (type === 'v2f') attrs[name] = [dv.getFloat32(pos, true), dv.getFloat32(pos + 4, true)]
    else if (type === 'v2i') attrs[name] = [dv.getInt32(pos, true), dv.getInt32(pos + 4, true)]
    else if (type === 'box2i') attrs[name] = [dv.getInt32(pos, true), dv.getInt32(pos + 4, true), dv.getInt32(pos + 8, true), dv.getInt32(pos + 12, true)]
    else if (type === 'lineOrder') attrs[name] = dv.getUint8(pos)
    else if (type === 'compression') attrs[name] = dv.getUint8(pos)
    else if (type === 'chlist') {
      const chs = []
      let cp = pos
      while (cp < start + size) {
        const { str: cn, next: cnp } = readNullStr(dv, cp)
        cp = cnp
        if (cn === '') break
        const pixelType = dv.getInt32(cp, true); cp += 4
        const pLinear = dv.getUint8(cp); cp += 1
        cp += 3
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
  if (compression == null) throw new Error('EXR decode: missing compression')
  if (compression > 3) throw new Error('EXR decode: compression ' + compression + ' not supported (use none/rle/zips/zip)')
  const dw = attrs.dataWindow
  if (!dw) throw new Error('EXR decode: missing dataWindow')
  const xMin = dw[0], yMin = dw[1], xMax = dw[2], yMax = dw[3]
  const width = xMax - xMin + 1
  const height = yMax - yMin + 1
  const channels = attrs.channels
  if (!channels || !channels.length) throw new Error('EXR decode: missing channels')
  const lineOrder = attrs.lineOrder || 0
  const linesPerBlock = compression === 3 ? 16 : 1
  const numBlocks = Math.ceil(height / linesPerBlock)
  const offsets = []
  for (let i = 0; i < numBlocks; i++) {
    const lo = dv.getUint32(pos, true); const hi = dv.getUint32(pos + 4, true)
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
  const data = new Float32Array(width * height * 4)
  const sampleBytes = (pt) => pt === 1 ? 2 : (pt === 2 ? 4 : 4)
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
      const inflated = zlib.inflateSync(Buffer.from(bytes.subarray(pstart, pstart + psize)))
      decoded = new Uint8Array(inflated)
      let off = 0
      for (const ch of channels) {
        const cl = sampleBytes(ch.pixelType) * width * rowsInBlock
        reversePrediction(decoded, off, cl)
        off += cl
      }
    }
    const ddv = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength)
    const ciFor = (name) => name === 'R' || name === 'r' ? 0 : name === 'G' || name === 'g' ? 1 : name === 'B' || name === 'b' ? 2 : name === 'A' || name === 'a' ? 3 : -1
    const readSample = (xo, pt) => pt === 1 ? halfToFloat(decoded[xo] | (decoded[xo + 1] << 8)) : pt === 2 ? ddv.getFloat32(xo, true) : ddv.getUint32(xo, true)
    if (compression === 1) {
      let off = 0
      for (let r = 0; r < rowsInBlock; r++) {
        const y = yCoord - yMin + r
        for (const ch of channels) {
          const sb = sampleBytes(ch.pixelType)
          const ci = ciFor(ch.name)
          if (ci >= 0) for (let x = 0; x < width; x++) data[(y * width + x) * 4 + ci] = readSample(off + x * sb, ch.pixelType)
          off += sb * width
        }
      }
    } else {
      let off = 0
      for (const ch of channels) {
        const sb = sampleBytes(ch.pixelType)
        const ci = ciFor(ch.name)
        if (ci >= 0) {
          for (let r = 0; r < rowsInBlock; r++) {
            const y = yCoord - yMin + r
            const rowOff = off + r * sb * width
            for (let x = 0; x < width; x++) data[(y * width + x) * 4 + ci] = readSample(rowOff + x * sb, ch.pixelType)
          }
        }
        off += sb * width * rowsInBlock
      }
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (chIdx.R < 0) data[i * 4] = 0
    if (chIdx.G < 0) data[i * 4 + 1] = 0
    if (chIdx.B < 0) data[i * 4 + 2] = 0
    if (chIdx.A < 0) data[i * 4 + 3] = 1
  }
  return { width, height, data, format: 'EXR' }
}

function decodeByExt(buffer, ext) {
  const e = (ext || '').toLowerCase()
  if (e === 'exr') return decodeEXR(buffer)
  return decodeHDR(buffer)
}

function detectAndDecode(buffer, filename) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 4 && bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01) return decodeEXR(buffer)
  if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x3f) return decodeHDR(buffer)
  const ext = (filename || '').split('.').pop().toLowerCase()
  return decodeByExt(buffer, ext)
}

module.exports = { decodeHDR, decodeEXR, decodeByExt, detectAndDecode, halfToFloat }