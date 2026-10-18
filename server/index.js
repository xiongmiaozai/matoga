/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const http = require('http')
const os = require('os')
const { createApp } = require('./app')
const auth = require('./middleware/auth')
const uploadService = require('./services/upload-service')
const wsSetup = require('./ws')
const { logger } = require('./middleware/logger')
const { PKG } = require('./paths')

const args = process.argv.slice(2)
const lan = args.includes('--lan')
const portArgIdx = args.indexOf('--port')
const requestedPort = portArgIdx >= 0 ? parseInt(args[portArgIdx + 1], 10) : 5273
const maxAttempts = 10

function localIp() {
  const ifs = os.networkInterfaces()
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
  }
  return 'localhost'
}

function listen(server, port, host, attempt) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && attempt < maxAttempts) {
        logger.warn('server', `port ${port} in use, trying ${port + 1}`)
        resolve(listen(server, port + 1, host, attempt + 1))
      } else {
        reject(e)
      }
    })
    server.listen(port, host, () => resolve(port))
  })
}

async function main() {
  const host = lan ? '0.0.0.0' : '127.0.0.1'
  let token = null
  if (lan) {
    token = auth.init()
    logger.info('server', `LAN mode enabled, access token: ${token}`)
  }
  uploadService.cleanup()

  const server = http.createServer(createApp())
  const port = await listen(server, requestedPort, host, 0)
  wsSetup.setup(server)
  const display = lan ? localIp() : 'localhost'
  const url = `http://${display}:${port}/${token ? '?token=' + token : ''}`
  console.log('')
  console.log('  matoga Web 服务已启动')
  console.log(`  ${url}`)
  if (lan) console.log('  （LAN 模式：请将含 token 的完整地址发给局域网内其他设备）')
  console.log('')
  if (PKG) openBrowser(url)
}

function openBrowser(url) {
  try {
    const { spawn } = require('child_process')
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
  } catch (e) {
    logger.warn('server', 'open browser failed: ' + e.message)
  }
}

main().catch((e) => {
  logger.error('server', `startup failed: ${e.message}`)
  process.exit(1)
})