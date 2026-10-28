import { apiCall, makeAssert } from '../lib/client.mjs'

export async function run(ctx) {
  const { base } = ctx
  const { check, summary } = makeAssert('[config] ')
  const j = (m, p, b) => apiCall(base, m, p, b)

  const cfg = await j('GET', '/api/config')
  check('get 返回 schema 默认值', cfg.ok && cfg.data.locale === 'zh' && cfg.data.theme === 'light', cfg)

  const put = await j('PUT', '/api/config', { sortKey: 'name' })
  const cfg2 = await j('GET', '/api/config')
  check('put 后 get 读回', put.ok && cfg2.ok && cfg2.data.sortKey === 'name', cfg2)

  return summary()
}