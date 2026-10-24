const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const syncService = require('../../server/services/sync-service')

test('sync progress: error 分支写入 error 字段而非 dest', async () => {
  const msgs = []
  await new Promise((resolve) => {
    syncService.execute(
      [{ name: 'nope.png', src: path.resolve('__matoga_nope_src__.png'), dest: path.resolve('__matoga_nope_dest__.png'), backup: null }],
      'job-progress-test',
      (m) => { msgs.push(m); if (m.type === 'done') resolve() }
    )
  })
  const errMsg = msgs.find((m) => m.type === 'progress' && m.status === 'error')
  assert.ok(errMsg, '应产生 error 进度消息')
  assert.equal(errMsg.error, 'ERR_PATH_DENIED', 'error 字段应携带错误码')
  assert.equal(errMsg.dest, null, 'dest 不应被错误码污染')
})