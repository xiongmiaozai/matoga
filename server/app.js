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
const fs = require('fs')

const ROOT = path.join(__dirname, '..')

function createApp() {
  const app = express()
  app.disable('x-powered-by')

  app.use(express.json({ limit: '12mb' }))

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
  api.use('/mc-official', require('./routes/mc-official'))
  api.use('/mc-packs', require('./routes/mc-packs'))
  api.use('/node-projects', require('./routes/node-projects'))
  api.use('/shell', require('./routes/shell'))
  api.use('/upload', require('./routes/upload'))
  api.use('/blockbench', require('./routes/blockbench'))
  api.use('/panels', require('./routes/panels'))
  app.use('/api', api)


  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build')))
  app.use('/vendor/golden-layout', express.static(path.join(ROOT, 'node_modules', 'golden-layout', 'dist', 'esm'), { extensions: ['js'], setHeaders: (res) => res.set('Cache-Control', 'no-store') }))
  app.use('/vendor/golden-layout-css', express.static(path.join(ROOT, 'node_modules', 'golden-layout', 'dist', 'css'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }))

  // Blockbench 模型开发板块：自托管 Web 产物 + 桥接插件 + 占位回退
  const bbSvc = require('./services/blockbench-service')
  app.use('/blockbench/plugins', express.static(path.join(ROOT, 'web', 'blockbench-plugins'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }))
  app.use('/blockbench', express.static(bbSvc.BB_WEB_DIR, { index: 'index.html', setHeaders: (res) => res.set('Cache-Control', 'no-store') }))
  app.use('/blockbench', (req, res, next) => {
    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
      if (!fs.existsSync(path.join(bbSvc.BB_WEB_DIR, 'index.html'))) {
        return res.sendFile(path.join(ROOT, 'web', 'blockbench-placeholder.html'))
      }
    }
    next()
  })

  app.use(express.static(path.join(ROOT, 'web'), {
    index: 'index.html',
    setHeaders: (res) => res.set('Cache-Control', 'no-store')
  }))

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
  const uploadService = require('./services/upload-service')
  trust(uploadService.UPLOAD_DIR)
  const nodeProjectStore = require('./config/node-project-store')
  trust(nodeProjectStore.DIR)
  return { trustedRoots: [cfg.hdriPresetPath, cfg.mcPacksPath, cfg.officialPacksPath] }
}

module.exports = { createApp }