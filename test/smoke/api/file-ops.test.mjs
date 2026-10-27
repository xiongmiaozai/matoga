import { join } from 'node:path'
import { apiCall, call, makeAssert } from '../lib/client.mjs'

const WIN = process.platform === 'win32'
const SYS_EVIL_COPY = WIN ? 'C:\\Windows\\Temp\\evil.png' : '/var/tmp/matoga-evil.png'
const SYS_EVIL_DEL = WIN ? 'C:\\Windows\\notepad.exe' : '/usr/bin/sudo'

export async function run(ctx) {
  const { base, smoke } = ctx
  const { check, summary } = makeAssert('[file-ops] ')
  const j = (m, p, b) => apiCall(base, m, p, b)

  const hash = await j('POST', '/api/file/hash', { path: join(smoke, 'a.png') })
  check('hash 返回 md5 hex', hash.ok && typeof hash.data.hash === 'string' && hash.data.hash.length === 32, hash)

  const copy = await j('POST', '/api/file/copy', { src: join(smoke, 'a.png'), dest: join(smoke, 'sub', 'a_copy.png') })
  check('copy（trusted 内）成功', copy.ok && copy.data.success === true, copy)

  const evil = await j('POST', '/api/file/copy', { src: join(smoke, 'a.png'), dest: SYS_EVIL_COPY })
  check('白名单拒绝（copy 到未登记目录）', !evil.ok && evil.code === 'ERR_PATH_DENIED', evil)

  const backup = await j('POST', '/api/file/backup', { path: join(smoke, 'b.txt') })
  check('backup 返回 backupPath', backup.ok && backup.data.success && typeof backup.data.backupPath === 'string', backup)

  const del = await j('POST', '/api/file/delete', { path: join(smoke, 'sub', 'a_copy.png') })
  check('delete（trusted 内）成功', del.ok && del.data.success === true, del)

  const delDenied = await j('POST', '/api/file/delete', { path: SYS_EVIL_DEL })
  check('白名单拒绝（delete 系统文件）', !delDenied.ok && delDenied.code === 'ERR_PATH_DENIED', delDenied)

  const raw = await call(base, 'GET', '/api/file/raw?path=' + encodeURIComponent(join(smoke, 'a.png')))
  check('raw 文件流返回内容', raw.status === 200 && String(raw.text).startsWith('hello-matoga'), raw.status)

  const nf = await call(base, 'GET', '/api/file/raw?path=' + encodeURIComponent(join(smoke, 'no-such.png')))
  check('raw 不存在返回 404', nf.status === 404, nf.status)

  return summary()
}