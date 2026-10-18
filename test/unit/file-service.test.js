const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { hashFile, invalidateHash, hashCacheStats } = require('../../server/services/file-service')

const TMP = path.join(os.tmpdir(), 'matoga-ut-hash-' + process.pid)

function setupTmp() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
}

function md5OfFile(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')
}

test('hashFile: 返回正确 MD5', async () => {
  setupTmp()
  const f = path.join(TMP, 'a.txt')
  fs.writeFileSync(f, 'hello world')
  assert.equal(await hashFile(f), md5OfFile(f))
})

test('hashFile: 不存在文件返回 null', async () => {
  setupTmp()
  assert.equal(await hashFile(path.join(TMP, 'nope.png')), null)
})

test('hashFile: 第二次命中缓存', async () => {
  setupTmp()
  invalidateHash()
  const f = path.join(TMP, 'b.png')
  fs.writeFileSync(f, Buffer.alloc(2048, 7))
  const h1 = await hashFile(f)
  const before = hashCacheStats().size
  const h2 = await hashFile(f)
  const after = hashCacheStats().size
  assert.equal(h1, h2)
  assert.equal(before, after, '缓存条目数不应增长（命中缓存）')
})

test('hashFile: 文件内容改变后重算', async () => {
  setupTmp()
  invalidateHash()
  const f = path.join(TMP, 'c.png')
  fs.writeFileSync(f, 'v1')
  const h1 = await hashFile(f)
  fs.writeFileSync(f, 'v2-changed')
  const h2 = await hashFile(f)
  assert.notEqual(h1, h2, '内容变后 hash 应不同')
  assert.equal(h2, md5OfFile(f))
})

test('invalidateHash: 清除指定路径缓存', async () => {
  setupTmp()
  invalidateHash()
  const f = path.join(TMP, 'd.png')
  fs.writeFileSync(f, 'x')
  await hashFile(f)
  assert.ok(hashCacheStats().size >= 1)
  invalidateHash(f)
  assert.equal(hashCacheStats().size, 0)
})

test('cleanup', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })