const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { close: closeLogger, logger } = require('../../server/middleware/logger')
const syncService = require('../../server/services/sync-service')

test('logger.close: 可安全重复调用', () => {
  logger.info('test', 'trigger stream creation')
  closeLogger()
  closeLogger()
  assert.ok(true)
})

test('syncService.cancelAll: 标记所有进行中任务为取消', () => {
  const jobs = syncService.jobs
  jobs.set('ca-1', { cancelled: false })
  jobs.set('ca-2', { cancelled: false })
  const count = syncService.cancelAll()
  assert.equal(count, 2)
  assert.equal(jobs.get('ca-1').cancelled, true)
  assert.equal(jobs.get('ca-2').cancelled, true)
  jobs.delete('ca-1')
  jobs.delete('ca-2')
})

test('gracefulShutdown: 关闭 wss 与 server 并清理资源（exit:false）', async () => {
  const { gracefulShutdown, isShuttingDown } = require('../../server/shutdown')
  const server = http.createServer((req, res) => res.end())
  await new Promise((r) => server.listen(0, r))
  let wssClosed = false
  const wss = { close: () => { wssClosed = true } }
  gracefulShutdown({ server, wss, exit: false, timeoutMs: 1000 })
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(wssClosed, true)
  assert.equal(isShuttingDown(), true)
  assert.equal(server.listening, false)
})