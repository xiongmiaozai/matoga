/**
 * 模型缩略图按类型分离专属目录单测（server/services/model-thumb-service.js）：
 * - kindFor/dirFor：im:→imported、cm:→custom、packmodel:→mc、其余→misc
 * - 各类模型缓存目录互不相同
 * - saveThumb 按类型落入对应专属子目录
 * 隔离：MATOGA_DATA_ROOT 指向临时目录。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'matoga-thumbdirs-'))
process.env.MATOGA_DATA_ROOT = TMP

const svc = require('../../server/services/model-thumb-service')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const DATA_URL = 'data:image/png;base64,' + PNG.toString('base64')

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }) })

test('kindFor: 按 key 前缀区分模型类型', () => {
  assert.equal(svc.kindFor('im:abc'), 'imported')
  assert.equal(svc.kindFor('cm:abc'), 'custom')
  assert.equal(svc.kindFor('packmodel:mc:pack/assets/x/models/y.json'), 'mc')
  assert.equal(svc.kindFor('other-unknown'), 'misc')
})

test('dirFor: 各类型使用互不相同的专属子目录', () => {
  const keys = ['im:x', 'cm:x', 'packmodel:mc:p/r.json']
  const dirs = new Set(keys.map(k => svc.dirFor(k)))
  assert.equal(dirs.size, 3, '三类模型目录互不相同')
  assert.ok(svc.dirFor('im:x').endsWith(path.join('model-thumbs', 'imported')))
  assert.ok(svc.dirFor('cm:x').endsWith(path.join('model-thumbs', 'custom')))
  assert.ok(svc.dirFor('packmodel:mc:p/r.json').endsWith(path.join('model-thumbs', 'mc')))
})

test('saveThumb: 按模型类型落入专属缓存目录', async () => {
  const key = 'im:test-unit-dir'
  const r = await svc.saveThumb(key, 1, DATA_URL)
  assert.equal(r.success, true)
  assert.ok(fs.existsSync(svc.pngPathFor(key)))
  assert.ok(svc.pngPathFor(key).includes(path.join('model-thumbs', 'imported')), '导入模型缩略图落在 imported 专属目录')
  const info = await svc.thumbInfo(key, 1)
  assert.equal(info.exists, true)
  svc.invalidate(key)
  // invalidate 内部是 fire-and-forget 的 fs.promises.unlink，不保证同步完成，
  // 固定 sleep 会偶发失败（实测单跑约 1/3 概率）。改为轮询等待文件真正消失。
  const gone = await waitUntil(() => !fs.existsSync(svc.pngPathFor(key)), 1000)
  assert.ok(gone, 'invalidate 后缩略图文件应被删除')
})

/**
 * 轮询等待条件成立。
 * @param {() => boolean} fn
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitUntil(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return fn()
}