const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const healthRoute = require('../../server/routes/health')
const { createApp } = require('../../server/app')

test('buildHealthInfo: 返回完整健康信息结构', () => {
  const info = healthRoute.buildHealthInfo()
  assert.equal(info.status, 'ok')
  assert.equal(info.pid, process.pid)
  assert.equal(info.node, process.version)
  assert.equal(info.lan, false)
  assert.equal(typeof info.uptime, 'number')
  assert.ok(info.uptime >= 0)
  assert.equal(typeof info.ts, 'number')
  assert.ok(info.memory)
  assert.equal(typeof info.memory.rss, 'number')
  assert.equal(typeof info.memory.heapUsed, 'number')
  assert.equal(typeof info.memory.heapTotal, 'number')
})

test('GET /api/health: 返回 ok 响应且无需鉴权', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`)
    const json = await res.json()
    assert.equal(res.status, 200)
    assert.equal(json.ok, true)
    assert.equal(json.data.status, 'ok')
    assert.equal(json.data.pid, process.pid)
    assert.equal(json.data.lan, false)
  } finally {
    await new Promise((r) => server.close(r))
  }
})