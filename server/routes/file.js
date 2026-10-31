/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const { ok, fail, wrap } = require('../middleware/errors')
const { guardRead, guardWrite } = require('../middleware/validate')
const fileService = require('../services/file-service')
const thumbService = require('../services/thumb-service')

const router = express.Router()

/* 贴图扩展名变体兜底：精确路径不存在时，对 assets/.../textures/** 下的图片引用
   尝试同 stem 不同图片扩展名（.png↔.jpg↔.webp…），对齐 mcmeta resolveDirFileFuzzy 行为，
   使对比场景 3D 预览与侧栏检测能容忍社区包贴图扩展名不一致 */
const TEX_VARIANTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']
const TEX_FUZZY_RE = /^(.+\/textures\/.+)\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i
function tryFuzzyTexPath(p) {
  /* 分隔符归一：Windows 下 path.join 产出反斜杠，而正则只认正斜杠。
     \ → / 是一对一替换、长度不变，因此可用同一长度在原始路径上切出 stem，
     后续拼候选路径时仍保留原分隔符。 */
  const m = TEX_FUZZY_RE.exec(p.replace(/\\/g, '/'))
  if (!m) return null
  const stem = p.slice(0, m[1].length)
  const curExt = p.slice(stem.length + 1).toLowerCase()
  for (const ext of TEX_VARIANTS) {
    if (ext === curExt) continue
    const candidate = stem + '.' + ext
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return null
}

router.post(
  '/hash',
  wrap(async (req, res) => {
    const p = guardRead(req.body && req.body.path)
    const canonical = !!(req.body && req.body.canonical)
    ok(res, { hash: await fileService.hashFile(p, canonical) })
  })
)

router.post(
  '/copy',
  wrap(async (req, res) => {
    const { src, dest } = req.body || {}
    const s = guardRead(src)
    const d = guardWrite(dest)
    const r = await fileService.copyFile(s, d)
    fileService.invalidateHash(d)
    ok(res, r)
  })
)

router.post(
  '/backup',
  wrap(async (req, res) => {
    const p = guardWrite(req.body && req.body.path)
    ok(res, await fileService.backupFile(p))
  })
)

router.post(
  '/delete',
  wrap(async (req, res) => {
    const p = guardWrite(req.body && req.body.path)
    const r = await fileService.deleteFile(p)
    fileService.invalidateHash(p)
    ok(res, r)
  })
)

router.get(
  '/raw',
  wrap(async (req, res) => {
    const p = guardRead(req.query.path)
    res.sendFile(p, { dotfiles: 'allow' }, err => {
      if (err && !res.headersSent) {
        const fuzzy = tryFuzzyTexPath(p)
        if (fuzzy) {
          res.sendFile(fuzzy, { dotfiles: 'allow' }, err2 => {
            if (err2 && !res.headersSent)
              res.status(404).json({ ok: false, code: 'ERR_FS_NOT_FOUND', msg: err.message })
          })
        } else {
          res.status(404).json({ ok: false, code: 'ERR_FS_NOT_FOUND', msg: err.message })
        }
      }
    })
  })
)

router.get(
  '/thumb-info',
  wrap(async (req, res) => {
    const p = guardRead(req.query.path)
    try {
      ok(res, await thumbService.thumbInfo(p))
    } catch (e) {
      fail(res, 'ERR_FS_NOT_FOUND', e.message)
    }
  })
)

router.post(
  '/thumb-info-batch',
  wrap(async (req, res) => {
    const paths = req.body && req.body.paths
    if (!Array.isArray(paths)) return fail(res, 'ERR_INVALID_PARAM', 'paths must be array')
    if (paths.length > 256) return fail(res, 'ERR_INVALID_PARAM', 'too many paths (max 256)')
    const out = {}
    await Promise.all(
      paths.map(async p => {
        try {
          out[p] = await thumbService.thumbInfo(guardRead(p))
        } catch (e) {
          out[p] = { exists: false, stale: true, thumbUrl: null, error: e.message }
        }
      })
    )
    ok(res, out)
  })
)

router.get(
  '/thumb',
  wrap(async (req, res) => {
    const p = guardRead(req.query.path)
    const thumbPath = thumbService.thumbPathFor(p)
    try {
      await fs.promises.access(thumbPath)
    } catch {
      return fail(res, 'ERR_FS_NOT_FOUND', 'thumbnail not generated yet')
    }
    res.set('Cache-Control', 'public, max-age=3600')
    res.sendFile(thumbPath)
  })
)

router.post(
  '/thumb',
  wrap(async (req, res) => {
    const p = guardRead(req.body && req.body.path)
    const dataUrl = req.body && req.body.dataUrl
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return fail(res, 'ERR_INVALID_PARAM', 'invalid dataUrl')
    }
    ok(res, await thumbService.saveThumb(p, dataUrl))
  })
)

router.post(
  '/write',
  wrap(async (req, res) => {
    const p = guardWrite(req.body && req.body.path)
    const dataUrl = req.body && req.body.dataUrl
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return fail(res, 'ERR_INVALID_PARAM', 'invalid dataUrl')
    }
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    if (!base64) return fail(res, 'ERR_INVALID_PARAM', 'empty image data')
    const buf = Buffer.from(base64, 'base64')
    await fs.promises.mkdir(path.dirname(p), { recursive: true })
    await fs.promises.writeFile(p, buf)
    fileService.invalidateHash(p)
    ok(res, { path: p, size: buf.length })
  })
)

module.exports = router
