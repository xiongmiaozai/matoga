/**
 * 贴图缩略图缓存服务回归测试（server/services/thumb-service.js）：
 * - thumbInfo：无缓存 → exists=false；saveThumb 后 → not stale
 * - 旧格式缓存（jpg 存在但无 sidecar）→ stale（版本迁移）
 * - 旧版本 sidecar → stale（算法升级强制重生）
 * - 源 mtime 更新 → stale
 * - saveThumb 拒绝非 dataUrl / 超大数据
 * - invalidate 后 → exists=false
 * 隔离：test-unit- 前缀路径，teardown 清理 jpg + sidecar。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')

const svc = require('../../server/services/thumb-service')

const TMP = path.join(os.tmpdir(), 'matoga-ut-thumb-' + process.pid)
const SRC = path.join(TMP, 'src.png')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const DATA_URL = 'data:image/jpeg;base64,' + JPG.toString('base64')

function setup() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  fs.writeFileSync(SRC, Buffer.alloc(64))
  try { fs.unlinkSync(svc.thumbPathFor(SRC)) } catch {}
  try { fs.unlinkSync(svc.metaPathFor(SRC)) } catch {}
}

test('thumbInfo: 无缓存 → exists=false / stale=true', async () => {
  setup()
  const r = await svc.thumbInfo(SRC)
  assert.equal(r.exists, false)
  assert.equal(r.stale, true)
  assert.equal(r.version, svc.THUMB_VERSION)
})

test('saveThumb → thumbInfo 同版本 → not stale', async () => {
  setup()
  const s = await svc.saveThumb(SRC, DATA_URL)
  assert.equal(s.success, true)
  assert.ok(fs.existsSync(svc.thumbPathFor(SRC)))
  assert.ok(fs.existsSync(svc.metaPathFor(SRC)))
  const meta = JSON.parse(fs.readFileSync(svc.metaPathFor(SRC), 'utf8'))
  assert.equal(meta.version, svc.THUMB_VERSION)

  const r = await svc.thumbInfo(SRC)
  assert.equal(r.exists, true)
  assert.equal(r.stale, false)
})

test('thumbInfo: 旧格式缓存（jpg 存在无 sidecar）→ stale（版本迁移）', async () => {
  setup()
  await svc.saveThumb(SRC, DATA_URL)
  fs.unlinkSync(svc.metaPathFor(SRC))
  const r = await svc.thumbInfo(SRC)
  assert.equal(r.exists, true)
  assert.equal(r.stale, true, '无 sidecar 视为旧格式，强制重新生成')
})

test('thumbInfo: 旧版本 sidecar → stale（算法升级）', async () => {
  setup()
  await svc.saveThumb(SRC, DATA_URL)
  fs.writeFileSync(svc.metaPathFor(SRC), JSON.stringify({ version: 0, mtime: Date.now() }))
  const r = await svc.thumbInfo(SRC)
  assert.equal(r.exists, true)
  assert.equal(r.stale, true, '旧版本号强制过期')
})

test('thumbInfo: 源文件更新后 → stale', async () => {
  setup()
  await svc.saveThumb(SRC, DATA_URL)
  await new Promise((r) => setTimeout(r, 20))
  fs.writeFileSync(SRC, Buffer.alloc(64))
  fs.utimesSync(SRC, new Date(), new Date(Date.now() + 5000))
  const r = await svc.thumbInfo(SRC)
  assert.equal(r.exists, true)
  assert.equal(r.stale, true)
})

test('saveThumb: 拒绝空 dataUrl', async () => {
  setup()
  assert.equal((await svc.saveThumb(SRC, '')).success, false)
  assert.equal((await svc.saveThumb(SRC, 'data:image/jpeg;base64,')).success, false)
})

test('invalidate: 删除后 → exists=false', async () => {
  setup()
  await svc.saveThumb(SRC, DATA_URL)
  svc.invalidate(SRC)
  await new Promise((r) => setTimeout(r, 50))
  const r = await svc.thumbInfo(SRC)
  assert.equal(r.exists, false)
})

test('cleanup', () => {
  fs.rmSync(TMP, { recursive: true, force: true })
  try { fs.unlinkSync(svc.thumbPathFor(SRC)) } catch {}
  try { fs.unlinkSync(svc.metaPathFor(SRC)) } catch {}
})