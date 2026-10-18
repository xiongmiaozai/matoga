/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * WebSocket 服务：批量复制进度推送 + 取消。
 * 协议：
 *   client → server: {type:'sync', jobId, pairs:[{src,dest,backup,name}]}
 *   client → server: {type:'cancel', jobId}
 *   server → client: {type:'progress', jobId, current, total, ok, fail, name, status, backupPath?}
 *   server → client: {type:'done', jobId, ok, fail, cancelled}
 */

const { WebSocketServer } = require('ws')
const crypto = require('crypto')
const syncService = require('./services/sync-service')
const auth = require('./middleware/auth')
const { logger } = require('./middleware/logger')

function setup(server) {
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws, req) => {
    const expectedToken = auth.getToken()
    if (expectedToken) {
      const url = new URL(req.url, 'http://localhost')
      const token = url.searchParams.get('token')
      if (token !== expectedToken) { ws.close(1008, 'unauthorized'); return }
    }
    ws.on('message', (data) => {
      let msg
      try { msg = JSON.parse(data) } catch { return }
      if (msg.type === 'sync') {
        const jobId = msg.jobId || crypto.randomUUID()
        if (!Array.isArray(msg.pairs) || !msg.pairs.length) {
          ws.send(JSON.stringify({ type: 'done', jobId, ok: 0, fail: 0, cancelled: false, error: 'no pairs' }))
          return
        }
        logger.info('ws', `sync job ${jobId} started: ${msg.pairs.length} pairs`)
        syncService.execute(msg.pairs, jobId, (evt) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(evt))
        })
      } else if (msg.type === 'cancel') {
        syncService.cancel(msg.jobId)
      }
    })
  })
  logger.info('ws', 'WebSocket server attached')
  return wss
}

module.exports = { setup }