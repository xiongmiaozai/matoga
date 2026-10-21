import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:5273'
const HERE = fileURLToPath(new URL('.', import.meta.url))
const SMOKE = join(HERE, '..', '..', 'data', 'tmp', 'smoke', 'src')
const WIN = process.platform === 'win32'
const SYS_EVIL_COPY = WIN ? 'C:\\Windows\\Temp\\evil.png' : '/var/tmp/matoga-evil.png'
const SYS_EVIL_DEL = WIN ? 'C:\\Windows\\notepad.exe' : '/usr/bin/sudo'

async function ensureSmokeData() {
  await mkdir(join(SMOKE, 'sub'), { recursive: true })
  await writeFile(join(SMOKE, 'a.png'), 'hello-matoga-png-fake')
  await writeFile(join(SMOKE, 'b.txt'), 'hello-b')
  await writeFile(join(SMOKE, 'c.png'), 'fake-c')
  await writeFile(join(SMOKE, 'd.png'), 'fake-d')
}

let pass = 0, failCount = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { failCount++; console.log(`  FAIL  ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`) }
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return { status: res.status, json: await res.json() }
  return { status: res.status, text: await res.text() }
}

async function main() {
  await ensureSmokeData()
  const j = async (m, p, b) => (await call(m, p, b)).json

  const cfg = await j('GET', '/api/config')
  check('config get 返回 schema 默认值', cfg.ok && cfg.data.locale === 'zh' && cfg.data.theme === 'light', cfg)

  const health = await j('GET', '/api/health')
  check('health 返回 ok 状态', health.ok && health.data.status === 'ok' && typeof health.data.uptime === 'number' && typeof health.data.pid === 'number', health)

  const hash = await j('POST', '/api/file/hash', { path: join(SMOKE, 'a.png') })
  check('hash 返回 md5 hex', hash.ok && typeof hash.data.hash === 'string' && hash.data.hash.length === 32, hash)

  const scan = await j('POST', '/api/compare/scan', { path: SMOKE, recursive: true, ignore: [] })
  check('scan（递归）登记 trusted root 并返回 entries', scan.ok && scan.data.entries.length >= 4, scan)

  const copy = await j('POST', '/api/file/copy', { src: join(SMOKE, 'a.png'), dest: join(SMOKE, 'sub', 'a_copy.png') })
  check('copy（trusted 内）成功', copy.ok && copy.data.success === true, copy)

  const evil = await j('POST', '/api/file/copy', { src: join(SMOKE, 'a.png'), dest: SYS_EVIL_COPY })
  check('白名单拒绝（copy 到未登记目录）', !evil.ok && evil.code === 'ERR_PATH_DENIED', evil)

  const backup = await j('POST', '/api/file/backup', { path: join(SMOKE, 'b.txt') })
  check('backup 返回 backupPath', backup.ok && backup.data.success && typeof backup.data.backupPath === 'string', backup)

  const del = await j('POST', '/api/file/delete', { path: join(SMOKE, 'sub', 'a_copy.png') })
  check('delete（trusted 内）成功', del.ok && del.data.success === true, del)

  const delDenied = await j('POST', '/api/file/delete', { path: SYS_EVIL_DEL })
  check('白名单拒绝（delete 系统文件）', !delDenied.ok && delDenied.code === 'ERR_PATH_DENIED', delDenied)

  const root = await j('GET', '/api/fs/browse')
  check('browse 根视图返回盘符/主目录', root.ok && root.data.dirs.length > 0 && root.data.parent === null, root)

  const sub = await j('GET', '/api/fs/browse?path=' + encodeURIComponent(SMOKE))
  check('browse 子目录含 sub', sub.ok && sub.data.dirs.some(d => d.name === 'sub') && sub.data.parent !== null, sub)

  const put = await j('PUT', '/api/config', { sortKey: 'name' })
  const cfg2 = await j('GET', '/api/config')
  check('config put 后 get 读回', put.ok && cfg2.ok && cfg2.data.sortKey === 'name', cfg2)

  const hdri = await j('GET', '/api/hdri/list')
  check('hdri list 返回结构', hdri.ok && Array.isArray(hdri.data.entries) && hdri.data.dir, hdri)

  const badJson = await fetch(BASE + '/api/compare/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid-json'
  }).then(r => r.json())
  check('bad-json unified error', badJson && badJson.ok === false && badJson.code === 'ERR_INVALID_PARAM', badJson)

  const up = await j('POST', '/api/upload/begin')
  check('upload begin 返回 uploadId+rootPath', up.ok && up.data.uploadId && up.data.rootPath, up)
  if (up.ok) {
    const raw = await fetch(BASE + '/api/upload/file?uploadId=' + up.data.uploadId + '&path=' + encodeURIComponent('nested/dir/f.txt'), {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: 'uploaded-content'
    })
    const rj = await raw.json()
    const end = await j('POST', '/api/upload/end?uploadId=' + up.data.uploadId)
    check('upload 三段式写入并落盘', rj.ok && end.ok, { rj, end })
    const traverse = await j('POST', '/api/upload/begin').then(b => fetch(BASE + '/api/upload/file?uploadId=' + b.data.uploadId + '&path=' + encodeURIComponent('..\\evil.txt'), { method: 'PUT', body: 'x' }).then(r => r.json()))
    check('upload 路径穿越拒绝', !traverse.ok && (traverse.code === 'ERR_PATH_DENIED' || traverse.code === 'ERR_INVALID_PARAM'), traverse)
  }

  const raw = await call('GET', '/api/file/raw?path=' + encodeURIComponent(join(SMOKE, 'a.png')))
  check('raw 文件流返回内容', raw.status === 200 && String(raw.text).startsWith('hello-matoga'), raw.status)

  const nf = await call('GET', '/api/file/raw?path=' + encodeURIComponent(join(SMOKE, 'no-such.png')))
  check('raw 不存在返回 404 JSON', nf.status === 404, nf.status)

  console.log(`\n冒烟结果: ${pass} 通过, ${failCount} 失败`)
  process.exit(failCount ? 1 : 0)
}

main().catch(e => { console.error('冒烟脚本异常:', e.message); process.exit(1) })