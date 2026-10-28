import { apiCall, makeAssert } from '../lib/client.mjs'

export async function run(ctx) {
  const { base } = ctx
  const { check, summary } = makeAssert('[upload] ')
  const j = (m, p, b) => apiCall(base, m, p, b)

  const up = await j('POST', '/api/upload/begin')
  check('begin 返回 uploadId+rootPath', up.ok && up.data.uploadId && up.data.rootPath, up)
  if (!up.ok) return summary()

  const raw = await fetch(base + '/api/upload/file?uploadId=' + up.data.uploadId + '&path=' + encodeURIComponent('nested/dir/f.txt'), {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'uploaded-content'
  })
  const rj = await raw.json()
  const end = await j('POST', '/api/upload/end?uploadId=' + up.data.uploadId)
  check('三段式写入并落盘', rj.ok && end.ok, { rj, end })

  const begin2 = await j('POST', '/api/upload/begin')
  const traverseRes = await fetch(base + '/api/upload/file?uploadId=' + begin2.data.uploadId + '&path=' + encodeURIComponent('..\\evil.txt'), {
    method: 'PUT', body: 'x'
  })
  const traverse = await traverseRes.json()
  check('路径穿越拒绝', !traverse.ok && (traverse.code === 'ERR_PATH_DENIED' || traverse.code === 'ERR_INVALID_PARAM'), traverse)

  return summary()
}