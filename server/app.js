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
const { WEB_ROOT } = require('./paths')

const ROOT = path.join(__dirname, '..')

function createApp() {
  const app = express()
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Matoga-Token')
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })

  app.use(express.json({ limit: '20mb' }))

  app.use('/api/health', require('./routes/health'))

  app.use('/api', auth)

  const api = express.Router()
  api.use('/fs', require('./routes/fs'))
  api.use('/compare', require('./routes/compare'))
  api.use('/file', require('./routes/file'))
  api.use('/hdri', require('./routes/hdri'))
  api.use('/config', require('./routes/config'))
  api.use('/workspace', require('./routes/workspace'))
  api.use('/asset', require('./routes/asset'))
  api.use('/lang', require('./routes/lang'))
  api.use('/craft-pack', require('./routes/craft-pack'))
  api.use('/craft-packs', require('./routes/craft-packs'))
  api.use('/pack-builder', require('./routes/pack-builder'))

  api.use('/mc-official', require('./routes/mc-official'))
  api.use('/mc-packs', require('./routes/mc-packs'))

  api.use('/node-projects', require('./routes/node-projects'))
  api.use('/shell', require('./routes/shell'))
  api.use('/upload', require('./routes/upload'))

  api.use('/imported-models', require('./routes/imported-models'))
  api.use('/custom-models', require('./routes/custom-models'))

  api.use('/cache', require('./routes/cache'))
  api.use('/panels', require('./routes/panels'))
  api.use('/themes', require('./routes/themes'))
  app.use('/api', api)

  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build')))
  app.use(
    '/vendor/golden-layout',
    express.static(path.join(ROOT, 'node_modules', 'golden-layout', 'dist', 'esm'), {
      extensions: ['js'],
      setHeaders: res => res.set('Cache-Control', 'no-store')
    })
  )
  app.use(
    '/vendor/golden-layout-css',
    express.static(path.join(ROOT, 'node_modules', 'golden-layout', 'dist', 'css'), {
      setHeaders: res => res.set('Cache-Control', 'no-store')
    })
  )
  app.use(
    '/vendor/img',
    express.static(path.join(ROOT, 'node_modules', 'golden-layout', 'dist', 'img'), {
      setHeaders: res => res.set('Cache-Control', 'no-store')
    })
  )

  app.use(
    express.static(WEB_ROOT, {
      index: 'index.html',
      setHeaders: res => res.set('Cache-Control', 'no-cache, must-revalidate')
    })
  )

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
  trust(cfg.officialPacksPath)
  trust(cfg.craftPacksPath)
  const uploadService = require('./services/upload-service')
  trust(uploadService.UPLOAD_DIR)
  const importedModelService = require('./services/imported-model-service')
  trust(importedModelService.importedDir())
  const nodeProjectStore = require('./config/node-project-store')
  trust(nodeProjectStore.getDir())

  return { trustedRoots: [cfg.hdriPresetPath, cfg.mcPacksPath, cfg.officialPacksPath, cfg.craftPacksPath] }
}

module.exports = { createApp }
