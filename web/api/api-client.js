/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * B/S 适配层：实现与 preload.js 同名的 window.api 接口，
 * 内部经统一 REST 契约（{ok, data|code, msg}）解包，返回形状与 Electron 版一致。
 */

;(() => {
  const token = () => {
    try { return new URLSearchParams(window.location.search).get('token') } catch { return null }
  }

  const hashCache = new Map()

  function clearHashCache() { hashCache.clear() }

  function url(path) {
    const t = token()
    if (!t) return path
    return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t)
  }

  async function call(method, path, body) {
    const res = await fetch(url(path), {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    let j
    try { j = await res.json() } catch { throw new Error('ERR_UNKNOWN: bad response') }
    if (!j || !j.ok) {
      const e = new Error((j && j.msg) || (j && j.code) || 'ERR_UNKNOWN')
      e.code = j && j.code
      throw e
    }
    return j.data
  }

  function wrapFs(fn) {
    return fn().then(d => ({ success: true, ...(d || {}) })).catch(e => ({ success: false, error: e.message }))
  }

  const matogaUpload = {
    async pickFile(acceptExts) {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        if (acceptExts && acceptExts.length) input.accept = '.' + acceptExts.join(',.')
        input.onchange = async () => {
          const f = input.files && input.files[0]
          if (!f) return resolve(null)
          try {
            const begin = await call('POST', '/api/upload/begin')
            await putRaw(begin.uploadId, f.name, f)
            const end = await call('POST', '/api/upload/end?uploadId=' + begin.uploadId)
            resolve(end.rootPath)
          } catch { resolve(null) }
        }
        input.click()
      })
    },

    async dropToTemp(dataTransfer) {
      try {
        const begin = await call('POST', '/api/upload/begin')
        const items = dataTransfer.items
        const entries = []
        if (items) {
          for (const it of items) {
            const e = it.webkitGetAsEntry && it.webkitGetAsEntry()
            if (e) entries.push(e)
          }
        }
        if (entries.length) {
          for (const e of entries) {
            await walkEntry(e, '', begin.uploadId)
          }
          const end = await call('POST', '/api/upload/end?uploadId=' + begin.uploadId)
          return end.rootPath
        }
        const files = dataTransfer.files
        if (files && files.length) {
          for (const f of files) await putRaw(begin.uploadId, f.name, f)
          const end = await call('POST', '/api/upload/end?uploadId=' + begin.uploadId)
          return end.rootPath
        }
        return null
      } catch { return null }
    }
  }

  async function walkEntry(entry, relBase, uploadId) {
    if (entry.isFile) {
      const f = await new Promise((r) => entry.file(r, () => r(null)))
      if (f) await putRaw(uploadId, relBase ? relBase + '/' + entry.name : entry.name, f)
      return
    }
    if (entry.isDirectory) {
      const reader = entry.createReader()
      const rel = relBase ? relBase + '/' + entry.name : entry.name
      let batch
      do {
        batch = await new Promise((r) => reader.readEntries(r, () => r([])))
        for (const child of batch) await walkEntry(child, rel, uploadId)
      } while (batch.length)
    }
  }

  async function putRaw(uploadId, rel, fileOrBlob) {
    const raw = await fetch(url('/api/upload/file?uploadId=' + uploadId + '&path=' + encodeURIComponent(rel)), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileOrBlob
    })
    const rj = await raw.json()
    if (!rj || !rj.ok) throw new Error(rj.msg || 'upload failed')
  }

  window.api = {
    selectFolder: (side) => window.matogaFolderTree.pick(side),

    readEntries: (p, ignore) => wrapFs(() => call('POST', '/api/compare/scan', { path: p, recursive: false, ignore })),
    readRecursive: (p, ignore) => wrapFs(() => call('POST', '/api/compare/scan', { path: p, recursive: true, ignore })),

    hashFile: async (p) => {
      const cached = hashCache.get(p)
      if (cached !== undefined) return cached
      try {
        const d = await call('POST', '/api/file/hash', { path: p })
        const h = d ? d.hash : null
        if (h) hashCache.set(p, h)
        return h
      } catch { return null }
    },

    openPath: async (p) => {
      try { await call('POST', '/api/shell/open', { path: p }); return '' } catch (e) { return e.message }
    },
    showInFolder: (p) => call('POST', '/api/shell/reveal', { path: p }).then(() => {}).catch(() => {}),

    getConfig: () => call('GET', '/api/config'),
    setConfig: (patch) => call('PUT', '/api/config', patch).then(() => {}).catch(() => {}),
    clearConfig: () => call('DELETE', '/api/config').then(() => {}).catch(() => {}),

    copyFile: (src, dest) => wrapFs(() => call('POST', '/api/file/copy', { src, dest })).then(r => { if (r.success) { hashCache.delete(dest); hashCache.delete(src) } return r }),
    backupFile: async (p) => {
      try {
        const d = await call('POST', '/api/file/backup', { path: p })
        return { success: true, backupPath: d.backupPath }
      } catch (e) { return { success: false, error: e.message } }
    },
    deleteFile: (p) => wrapFs(() => call('POST', '/api/file/delete', { path: p })).then(r => { if (r.success) hashCache.delete(p); return r }),

    getPathForFile: () => null,

    selectFile: () => matogaUpload.pickFile(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'avif']),
    selectHDRFile: () => matogaUpload.pickFile(['hdr', 'exr']),
    pickFolder: () => window.matogaFolderTree.pick(null),
    createFolder: (p) => wrapFs(() => call('POST', '/api/fs/create', { path: p })),

    listHdrPresets: () => call('GET', '/api/hdri/list')
      .then(d => ({ success: true, dir: d.dir, entries: d.entries }))
      .catch(e => ({ success: false, error: e.message, entries: [] })),
    hdrThumbInfo: (fullPath) => call('GET', '/api/hdri/thumb-info?path=' + encodeURIComponent(fullPath))
      .catch(e => ({ exists: false, stale: true, thumbUrl: null, error: e.message })),
    saveHdrThumb: async (fullPath, dataUrl) => {
      try {
        const d = await call('POST', '/api/hdri/thumb', { path: fullPath, dataUrl })
        return { success: true, thumbUrl: d.thumbUrl }
      } catch (e) { return { success: false, error: e.message } }
    },

    thumbInfo: (fullPath) => call('GET', '/api/file/thumb-info?path=' + encodeURIComponent(fullPath))
      .catch(e => ({ exists: false, stale: true, thumbUrl: null, error: e.message })),
    saveThumb: async (fullPath, dataUrl) => {
      try {
        const d = await call('POST', '/api/file/thumb', { path: fullPath, dataUrl })
        return { success: true, thumbUrl: d.thumbUrl }
      } catch (e) { return { success: false, error: e.message } }
    },

    copyFilesBatch: (pairs, onProgress) => {
      return new Promise((resolve) => {
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = wsProto + '//' + location.host + '/ws' + (token() ? '?token=' + token() : '')
        const ws = new WebSocket(wsUrl)
        const jobId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random()
        let settled = false
        const finish = (r) => { if (settled) return; settled = true; try { ws.close() } catch {}; resolve(r) }
        ws.onopen = () => {
          try { ws.send(JSON.stringify({ type: 'sync', jobId, pairs })) } catch (e) { finish({ ok: 0, fail: pairs.length, error: e.message }) }
        }
        ws.onmessage = (e) => {
          let msg
          try { msg = JSON.parse(e.data) } catch { return }
          if (msg.type === 'progress' && onProgress) { try { onProgress(msg) } catch {} }
          if (msg.type === 'done') { if (msg.ok) clearHashCache(); finish({ ok: msg.ok || 0, fail: msg.fail || 0, cancelled: !!msg.cancelled }) }
        }
        ws.onerror = () => finish({ ok: 0, fail: pairs.length, error: 'ws_error' })
        ws.onclose = () => finish({ ok: 0, fail: pairs.length, error: 'ws_closed' })
        window.__matogaCancelSync = () => { try { ws.send(JSON.stringify({ type: 'cancel', jobId })) } catch {} }
      })
    }
  }

  window.matogaUpload = matogaUpload
  window.matogaCore = { call, url, clearHashCache }
})()