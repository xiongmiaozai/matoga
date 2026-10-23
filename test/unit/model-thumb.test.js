/**
 * 模型缩略图缓存服务单测（server/services/model-thumb-service.js）：
 * - saveThumb：sidecar 记录 renderer 版本；thumbInfo 同版本 + mtime 一致 → not stale
 * - 旧格式缓存（sidecar 仅 mtime，v1 渲染器产物）→ stale（UV 修复后强制重渲染）
 * - 缓存 mtime 早于源 mtime → stale；无缓存 → exists=false
 * - saveThumb 拒绝非 dataUrl / 超大数据
 * 隔离：使用 test-unit- 前缀专属 key（md5 与真实用户 key 撞击概率忽略不计），teardown 清理。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const svc = require('../../server/services/model-thumb-service')

const KEY = 'test-unit-model-thumb:cake'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const DATA_URL = 'data:image/png;base64,' + PNG.toString('base64')

test('setup: 清理测试残留', () => {
  try { fs.unlinkSync(svc.pngPathFor(KEY)) } catch {}
  try { fs.unlinkSync(svc.metaPathFor(KEY)) } catch {}
})

test('thumbInfo: 无缓存 → exists=false / stale=true', async () => {
  const info = await svc.thumbInfo(KEY, 1000)
  assert.equal(info.exists, false)
  assert.equal(info.stale, true)
  assert.equal(info.cachedMtime, 0)
  assert.equal(info.renderer, svc.RENDERER_VERSION)
  assert.ok(info.thumbUrl.includes(encodeURIComponent(KEY)))
})

test('saveThumb: 写入后同版本 + mtime 一致 → not stale', async () => {
  const r = await svc.saveThumb(KEY, 1000, DATA_URL)
  assert.equal(r.success, true)
  assert.ok(fs.existsSync(svc.pngPathFor(KEY)))
  const meta = JSON.parse(fs.readFileSync(svc.metaPathFor(KEY), 'utf8'))
  assert.equal(meta.renderer, svc.RENDERER_VERSION)
  assert.equal(meta.mtime, 1000)

  const info = await svc.thumbInfo(KEY, 1000)
  assert.equal(info.exists, true)
  assert.equal(info.stale, false, '同版本同 mtime → 缓存有效')
})

test('thumbInfo: 缓存 mtime 早于源 mtime → stale', async () => {
  const info = await svc.thumbInfo(KEY, 2000)
  assert.equal(info.exists, true)
  assert.equal(info.stale, true)
})

test('thumbInfo: v1 旧格式缓存（无 renderer 字段）→ stale（UV 修复强制重渲染）', async () => {
  /* 模拟修复前生成的旧缓存：sidecar 仅含 mtime */
  fs.writeFileSync(svc.metaPathFor(KEY), JSON.stringify({ mtime: 2000 }))
  const info = await svc.thumbInfo(KEY, 2000)
  assert.equal(info.exists, true)
  assert.equal(info.stale, true, '旧渲染器产物即使 mtime 最新也判定过期')
})

test('thumbInfo: 落后版本号（renderer < 当前）→ stale', async () => {
  fs.writeFileSync(svc.metaPathFor(KEY), JSON.stringify({ mtime: 2000, renderer: 1 }))
  const info = await svc.thumbInfo(KEY, 2000)
  assert.equal(info.stale, true)
  /* 未来更高版本（前端降级场景）→ 不因版本过期 */
  fs.writeFileSync(svc.metaPathFor(KEY), JSON.stringify({ mtime: 2000, renderer: svc.RENDERER_VERSION + 1 }))
  const info2 = await svc.thumbInfo(KEY, 2000)
  assert.equal(info2.stale, false)
})

test('thumbInfo: v2 渲染器缓存 → 升级后 stale（事件驱动等待 / 取景 / DPI 算法升级强制重渲染）', async () => {
  fs.writeFileSync(svc.metaPathFor(KEY), JSON.stringify({ mtime: 2000, renderer: 2 }))
  const info = await svc.thumbInfo(KEY, 2000)
  assert.equal(info.exists, true)
  assert.equal(info.stale, true, '旧轮询算法产物即使 mtime 最新也判定过期')
})

test('saveThumb: 多帧写入 + thumbInfo 返回 frameCount / frameDelay + 帧数减少清理', async () => {
  const KEY2 = 'test-unit-model-thumb:anim'
  try { fs.unlinkSync(svc.pngPathFor(KEY2, 0)); fs.unlinkSync(svc.metaPathFor(KEY2)) } catch {}
  const frames = []
  for (let i = 0; i < 4; i++) frames.push({ dataUrl: DATA_URL, delay: i ? 0 : 100 })
  const r = await svc.saveThumb(KEY2, 3000, { frames })
  assert.equal(r.success, true)
  assert.equal(r.frameCount, 4)
  assert.equal(r.frameDelay, 100)
  /* 帧 0 = <md5>.png（单帧路径兼容），帧 i≥1 = <md5>.f<i>.png */
  assert.ok(fs.existsSync(svc.pngPathFor(KEY2, 0)))
  assert.ok(fs.existsSync(svc.pngPathFor(KEY2, 3)))
  assert.ok(!fs.existsSync(svc.pngPathFor(KEY2, 4)))

  const info = await svc.thumbInfo(KEY2, 3000)
  assert.equal(info.exists, true)
  assert.equal(info.stale, false)
  assert.equal(info.frameCount, 4, '多帧 sidecar 帧数')
  assert.equal(info.frameDelay, 100)

  /* 帧数减少（4 → 2）时清除多余旧帧文件 */
  const r2 = await svc.saveThumb(KEY2, 3000, { frames: frames.slice(0, 2) })
  assert.equal(r2.frameCount, 2)
  assert.ok(fs.existsSync(svc.pngPathFor(KEY2, 1)))
  assert.ok(!fs.existsSync(svc.pngPathFor(KEY2, 2)), '多余旧帧已清理')
  assert.ok(!fs.existsSync(svc.pngPathFor(KEY2, 3)))
  try { fs.unlinkSync(svc.pngPathFor(KEY2, 0)); fs.unlinkSync(svc.pngPathFor(KEY2, 1)) } catch {}
  try { fs.unlinkSync(svc.metaPathFor(KEY2)) } catch {}
})

test('saveThumb: 单帧字符串 dataUrl 兼容（旧行为不破坏）', async () => {
  const KEY3 = 'test-unit-model-thumb:single'
  try { fs.unlinkSync(svc.pngPathFor(KEY3, 0)); fs.unlinkSync(svc.metaPathFor(KEY3)) } catch {}
  const r = await svc.saveThumb(KEY3, 100, DATA_URL)
  assert.equal(r.success, true)
  assert.equal(r.frameCount, 1)
  const info = await svc.thumbInfo(KEY3, 100)
  assert.equal(info.frameCount, 1)
  assert.equal(info.frameDelay, 0)
  try { fs.unlinkSync(svc.pngPathFor(KEY3, 0)) } catch {}
})

test('thumbInfo: v3 渲染器缓存 → v4 升级后 stale（多帧动图 + 基类回退算法变更）', async () => {
  fs.writeFileSync(svc.metaPathFor(KEY), JSON.stringify({ mtime: 2000, renderer: 3, frameCount: 4, frameDelay: 100 }))
  const info = await svc.thumbInfo(KEY, 2000)
  assert.equal(info.exists, true)
  assert.equal(info.stale, true, '旧随机相位单帧产物强制重渲染')
  /* 旧缓存的 frameCount 仍可读（前端降级轮播） */
  assert.equal(info.frameCount, 4)
})

test('saveThumb: 拒绝非 dataUrl 与超大数据', async () => {
  const r1 = await svc.saveThumb(KEY, 1, 'http://example.com/a.png')
  assert.equal(r1.success, false)
  const r2 = await svc.saveThumb(KEY, 1, 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024))
  assert.equal(r2.success, false)
})

test('teardown: 清理测试文件', () => {
  try { fs.unlinkSync(svc.pngPathFor(KEY)) } catch {}
  for (let i = 1; i < 8; i++) { try { fs.unlinkSync(svc.pngPathFor(KEY, i)) } catch {} }
  try { fs.unlinkSync(svc.metaPathFor(KEY)) } catch {}
})