/**
 * matoga - 模型导出工具（保存到本地）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 「保存到本地」链路的公共工具（uv-editor 导出 / 面板保存共用）：
 *  - zipStore(files)：手写 store-only zip writer（零依赖；CRC32 + local header +
 *    central directory + EOCD，UTF-8 文件名；与 server/services/mcmeta-service.js
 *    的最小 zip 解析器互为镜像，产物可直接被其读回）
 *  - urlToBytes(url)：贴图数据获取（dataURL 解码 / 站内与外部 URL fetch）
 *  - bytesToDataUrl / mimeFromUrl：bbmodel 内嵌贴图烘焙（dataURL）
 *  - bakeBbTexSources(json, layout)：bbmodel textures[].source 的站内 URL →
 *    dataURL 写回（uv-editor-panel 保存与导出共用，含 layout.url 回写）
 *  - sanitizeTexName(name)：资源包贴图名合法化（[a-z0-9/_-]，MC 资源路径规范）
 *  - downloadBlob(blob, filename)：浏览器下载（Blob → a.click）
 */

/* ── CRC32（zip 规范多项式 0xedb88320，查表法）────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concatBytes(chunks) {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Uint8Array(len)
  let p = 0
  for (const c of chunks) { out.set(c, p); p += c.length }
  return out
}

/* ── store-only zip writer ──────────────────────────
    files: [{ name, data: Uint8Array }] → Uint8Array（zip 字节流）
    PNG 等贴图本身已压缩，store（method 0）不二次压缩，体积与速度最优 */

export function zipStore(files) {
  const list = (Array.isArray(files) ? files : []).filter(f => f && typeof f.name === 'string')
  const encoder = new TextEncoder()
  const d = new Date()
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const dosDate = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const chunks = []
  const central = []
  let offset = 0
  for (const f of list) {
    const name = encoder.encode(f.name)
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data || [])
    const crc = crc32(data)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)      /* local file header sig */
    lh.setUint16(4, 20, true)              /* version needed */
    lh.setUint16(6, 0x0800, true)          /* flags: UTF-8 文件名 */
    lh.setUint16(8, 0, true)               /* method: store */
    lh.setUint16(10, dosTime, true)
    lh.setUint16(12, dosDate, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, data.length, true)    /* csize */
    lh.setUint32(22, data.length, true)    /* usize */
    lh.setUint16(26, name.length, true)
    lh.setUint16(28, 0, true)              /* extra len */
    chunks.push(new Uint8Array(lh.buffer), name, data)
    central.push({ name, crc, size: data.length, offset })
    offset += 30 + name.length + data.length
  }
  const cdStart = offset
  for (const c of central) {
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)      /* central directory sig */
    ch.setUint16(4, 20, true)              /* version made by */
    ch.setUint16(6, 20, true)              /* version needed */
    ch.setUint16(8, 0x0800, true)          /* flags: UTF-8 */
    ch.setUint16(10, 0, true)              /* method: store */
    ch.setUint16(12, dosTime, true)
    ch.setUint16(14, dosDate, true)
    ch.setUint32(16, c.crc, true)
    ch.setUint32(20, c.size, true)
    ch.setUint32(24, c.size, true)
    ch.setUint16(28, c.name.length, true)
    ch.setUint16(30, 0, true)              /* extra len */
    ch.setUint16(32, 0, true)              /* comment len */
    ch.setUint16(34, 0, true)              /* disk start */
    ch.setUint16(36, 0, true)              /* internal attrs */
    ch.setUint32(38, 0, true)              /* external attrs */
    ch.setUint32(42, c.offset, true)       /* local header offset */
    chunks.push(new Uint8Array(ch.buffer), c.name)
    offset += 46 + c.name.length
  }
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true)      /* EOCD sig */
  eocd.setUint16(4, 0, true)
  eocd.setUint16(6, 0, true)
  eocd.setUint16(8, central.length, true)  /* 本卷条目数 */
  eocd.setUint16(10, central.length, true) /* 总条目数 */
  eocd.setUint32(12, offset - cdStart, true)
  eocd.setUint32(16, cdStart, true)
  eocd.setUint16(20, 0, true)              /* comment len */
  chunks.push(new Uint8Array(eocd.buffer))
  return concatBytes(chunks)
}

/* ── 贴图数据获取 / dataURL 转换 ────────────────────────── */

function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/* 贴图字节获取：dataURL 直接解码（base64 / 百分号编码）；http(s)/站内 URL fetch；失败返回 null */
export async function urlToBytes(url) {
  if (typeof url !== 'string' || !url) return null
  if (/^data:/i.test(url)) {
    const m = url.match(/^data:[^;,]*(;base64)?,([\s\S]*)$/i)
    if (!m) return null
    try {
      if (m[1]) return base64ToBytes(m[2])
      return new TextEncoder().encode(decodeURIComponent(m[2]))
    } catch { return null }
  }
  try {
    const res = await fetch(url)
    if (!res || !res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch { return null }
}

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
}

export function mimeFromUrl(url) {
  const m = String(url || '').split('?')[0].match(/\.([a-z0-9]+)$/i)
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'image/png'
}

export function bytesToDataUrl(bytes, mime) {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)))
  }
  return 'data:' + (mime || 'image/png') + ';base64,' + btoa(bin)
}

/* ── bbmodel 内嵌贴图烘焙：textures[].source 非 dataURL 的槽位
    （站内 URL）→ fetch 转 dataURL 写回；转换后回写 layout.url 保持一致，
    避免下次重复 fetch（与导出/保存共用；data: 与外部 http 原样直写） ── */

export async function bakeBbTexSources(json, layout) {
  if (!json || !Array.isArray(json.textures) || !layout || !Array.isArray(layout.texOrigin)) return
  for (let rawIdx = 0; rawIdx < layout.texOrigin.length; rawIdx++) {
    const layIdx = layout.texOrigin[rawIdx]
    const raw = json.textures[rawIdx]
    const lay = (layIdx >= 0 && layIdx < layout.textures.length) ? layout.textures[layIdx] : null
    if (!raw || typeof raw.source !== 'string' || !lay || typeof lay.url !== 'string') continue
    if (lay.url === raw.source) continue
    if (lay.url.startsWith('data:') || /^https?:\/\//i.test(lay.url)) {
      raw.source = lay.url
      continue
    }
    if (!lay.url.startsWith('/')) continue
    try {
      const bytes = await urlToBytes(lay.url)
      if (bytes && bytes.length) {
        const dataUrl = bytesToDataUrl(bytes, mimeFromUrl(lay.url))
        raw.source = dataUrl
        lay.url = dataUrl
      }
    } catch {}
  }
}

/* ── 资源包贴图名合法化：小写 [a-z0-9/_-]，非法字符折叠为 _ ── */

export function sanitizeTexName(name) {
  const s = String(name || '')
    .replace(/\.(png|jpe?g|webp|gif|bmp)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '_')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-_/]+|[-_/]+$/g, '')
  return s || 'texture'
}

/* ── 浏览器下载（Blob → objectURL → a.click，4s 后 revoke） ── */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 4000)
}