/**
 * CORS 中间件单测：
 * - 所有 /api 响应携带 Access-Control-Allow-Origin: *
 * - OPTIONS 预检返回 204 且带 Allow-Methods / Allow-Headers
 * - 普通请求仍正常放行（GET /api/health 200）
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createApp } = require('../../server/app')

async function withServer(fn) {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

test('CORS: GET 响应携带 Access-Control-Allow-Origin: *', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  })
})

test('CORS: OPTIONS 预检返回 204 并带 Allow-Methods/Allow-Headers', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/api/imported-models', { method: 'OPTIONS' })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    const methods = res.headers.get('access-control-allow-methods') || ''
    assert.ok(methods.includes('POST'))
    assert.ok(methods.includes('DELETE'))
    const headers = res.headers.get('access-control-allow-headers') || ''
    assert.ok(headers.includes('Content-Type'))
    assert.ok(headers.includes('X-Matoga-Token'))
  })
})