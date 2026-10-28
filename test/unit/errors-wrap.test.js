const test = require('node:test')
const assert = require('node:assert/strict')
const loggerMod = require('../../server/middleware/logger')
loggerMod.logger.error = () => {}
const { wrap } = require('../../server/middleware/errors')

function makeRes() {
  return { out: null, status() { return this }, json(x) { this.out = x } }
}

test('wrap: 普通 Error 携带合法 code 时保留该 code', async () => {
  const res = makeRes()
  await wrap(async () => { throw Object.assign(new Error('bad param'), { code: 'ERR_INVALID_PARAM' }) })({ method: 'GET', originalUrl: '/api/x' }, res)
  assert.deepEqual(res.out, { ok: false, code: 'ERR_INVALID_PARAM', msg: 'bad param' })
})

test('wrap: 非法 code（如 fs ENOENT）归一为 ERR_UNKNOWN', async () => {
  const res = makeRes()
  await wrap(async () => { throw Object.assign(new Error('boom'), { code: 'ENOENT' }) })({ method: 'GET', originalUrl: '/api/x' }, res)
  assert.equal(res.out.ok, false)
  assert.equal(res.out.code, 'ERR_UNKNOWN')
})