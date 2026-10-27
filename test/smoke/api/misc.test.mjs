import { apiCall, makeAssert } from '../lib/client.mjs'

export async function run(ctx) {
  const { base } = ctx
  const { check, summary } = makeAssert('[misc] ')
  const j = (m, p, b) => apiCall(base, m, p, b)

  const health = await j('GET', '/api/health')
  check('health 返回 ok 状态', health.ok && health.data.status === 'ok' && typeof health.data.uptime === 'number' && typeof health.data.pid === 'number', health)

  const hdri = await j('GET', '/api/hdri/list')
  check('hdri list 返回结构', hdri.ok && Array.isArray(hdri.data.entries) && hdri.data.dir, hdri)

  const badJsonRes = await fetch(base + '/api/compare/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid-json'
  })
  const badJson = await badJsonRes.json()
  check('bad-json unified error', badJson && badJson.ok === false && badJson.code === 'ERR_INVALID_PARAM', badJson)

  return summary()
}