import { apiCall, makeAssert } from '../lib/client.mjs'

export async function run(ctx) {
  const { base, smoke } = ctx
  const { check, summary } = makeAssert('[scan] ')
  const j = (m, p, b) => apiCall(base, m, p, b)

  const scan = await j('POST', '/api/compare/scan', { path: smoke, recursive: true, ignore: [] })
  check('scan（递归）登记 trusted root 并返回 entries', scan.ok && scan.data.entries.length >= 4, scan)

  const root = await j('GET', '/api/fs/browse')
  check('browse 根视图返回盘符/主目录', root.ok && root.data.dirs.length > 0 && root.data.parent === null, root)

  const sub = await j('GET', '/api/fs/browse?path=' + encodeURIComponent(smoke))
  check('browse 子目录含 sub', sub.ok && sub.data.dirs.some(d => d.name === 'sub') && sub.data.parent !== null, sub)

  return summary()
}