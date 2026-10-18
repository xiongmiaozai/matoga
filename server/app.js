/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const express = require('express')
const path = require('path')
const { middleware: auth } = require('./middleware/auth')
const { fail } = require('./middleware/errors')
const configStore = require('./config/config-store')
const { trust } = require('./middleware/validate')

const ROOT = path.join(__dirname, '..')

function createApp() {
  const app = express()
  app.disable('x-powered-by')

  app.use(express.json({ limit: '12mb' }))

  app.use('/api', auth)

  const api = express.Router()
  api.use('/fs', require('./routes/fs'))
  api.use('/compare', require('./routes/compare'))
  api.use('/file', require('./routes/file'))
  api.use('/hdri', require('./routes/hdri'))
  api.use('/config', require('./routes/config'))
  api.use('/shell', require('./routes/shell'))
  api.use('/upload', require('./routes/upload'))
  app.use('/api', api)


  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build')))
  app.use(express.static(path.join(ROOT, 'web'), { index: 'index.html' }))

  app.use('/api', (req, res) => fail(res, 'ERR_INVALID_PARAM', 'unknown API endpoint'))
  app.use((req, res) => res.status(404).send('Not Found'))

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    const isParse = err && err.type && String(err.type).indexOf('entity.parse.failed') >= 0
    res.status(isParse ? 400 : 500).json({
      ok: false,
      code: isParse ? 'ERR_INVALID_PARAM' : 'ERR_UNKNOWN',
      msg: err.message || 'internal error'
    })
  })

  initTrustedRoots()
  return app
}

function initTrustedRoots() {
  const cfg = configStore.get()
  trust(cfg.hdriPresetPath)
  trust(cfg.mcPacksPath)
  const uploadService = require('./services/upload-service')
  trust(uploadService.UPLOAD_DIR)
  return { trustedRoots: [cfg.hdriPresetPath, cfg.mcPacksPath] }
}

module.exports = { createApp }