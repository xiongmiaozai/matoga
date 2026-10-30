const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { hashFile, invalidateHash, hashCacheStats, computeAHash, computeDHash, hammingDistance, canonicalizeJson } = require('../../server/services/file-service')

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
function makeRGBA(w, h, fn) {
  const buf = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, [r, g, b, a] = fn(x, y)
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a
  }
  return buf
}

test('computeAHash: 相同图像返回相同哈希', () => {
  const rgba = makeRGBA(16, 16, (x, y) => [x * 16, y * 16, 128, 255])
  const h1 = computeAHash(rgba, 16, 16)
  const h2 = computeAHash(rgba, 16, 16)
  assert.equal(h1, h2)
  assert.equal(h1.length, 16)
})

test('computeAHash: 不同图像返回不同哈希', () => {
  const rgba1 = makeRGBA(16, 16, (x) => [x * 16, 0, 0, 255])
  const rgba2 = makeRGBA(16, 16, (x) => [(15 - x) * 16, 0, 0, 255])
  assert.notEqual(computeAHash(rgba1, 16, 16), computeAHash(rgba2, 16, 16))
})

test('computeDHash: 相同图像返回相同哈希', () => {
  const rgba = makeRGBA(16, 16, (x, y) => [x * 16, y * 16, 128, 255])
  const h1 = computeDHash(rgba, 16, 16)
  const h2 = computeDHash(rgba, 16, 16)
  assert.equal(h1, h2)
  assert.equal(h1.length, 16)
})

test('hammingDistance: 相同哈希距离为 0', () => {
  const h = 'abcdef0123456789'
  assert.equal(hammingDistance(h, h), 0)
})

test('hammingDistance: 不同哈希距离 > 0', () => {
  assert.ok(hammingDistance('0000000000000000', 'ffffffffffffffff') > 0)
})

test('hammingDistance: 长度不同返回 -1', () => {
  assert.equal(hammingDistance('abc', 'abcd'), -1)
})

test('hammingDistance: 相似图像汉明距离小', () => {
  const base = makeRGBA(16, 16, (x, y) => [x * 16, y * 16, 128, 255])
  const similar = makeRGBA(16, 16, (x, y) => [x * 16 + 1, y * 16, 128, 255])
  const different = makeRGBA(16, 16, () => [255, 255, 255, 255])
  const hBase = computeDHash(base, 16, 16)
  const hSimilar = computeDHash(similar, 16, 16)
  const hDiff = computeDHash(different, 16, 16)
  assert.ok(hammingDistance(hBase, hSimilar) <= hammingDistance(hBase, hDiff))
})
test('canonicalizeJson: 对象 key 按字典序排序', () => {
  const input = { c: 1, a: 2, b: 3 }
  const out = canonicalizeJson(input)
  assert.deepEqual(Object.keys(out), ['a', 'b', 'c'])
})

test('canonicalizeJson: 递归排序嵌套对象', () => {
  const input = { z: { y: 1, x: 2 }, a: { b: 3, a: 4 } }
  const out = canonicalizeJson(input)
  assert.deepEqual(Object.keys(out), ['a', 'z'])
  assert.deepEqual(Object.keys(out.a), ['a', 'b'])
  assert.deepEqual(Object.keys(out.z), ['x', 'y'])
})

test('canonicalizeJson: 数组保持顺序但元素递归排序', () => {
  const input = [{ b: 1, a: 2 }, { d: 3, c: 4 }]
  const out = canonicalizeJson(input)
  assert.ok(Array.isArray(out))
  assert.deepEqual(Object.keys(out[0]), ['a', 'b'])
  assert.deepEqual(Object.keys(out[1]), ['c', 'd'])
})

test('hashFile canonical: 字段顺序不同但内容相同的 JSON 哈希一致', async () => {
  setupTmp()
  invalidateHash()
  const f1 = path.join(TMP, 'm1.json')
  const f2 = path.join(TMP, 'm2.json')
  fs.writeFileSync(f1, JSON.stringify({ parent: 'block/cube', textures: { all: 'block/stone' }, elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] }))
  fs.writeFileSync(f2, JSON.stringify({ elements: [{ to: [1, 1, 1], from: [0, 0, 0] }], textures: { all: 'block/stone' }, parent: 'block/cube' }))
  const h1 = await hashFile(f1, true)
  const h2 = await hashFile(f2, true)
  assert.equal(h1, h2, '字段顺序不同的等价 JSON 规范化哈希应一致')
})

test('hashFile canonical: 内容不同的 JSON 哈希不同', async () => {
  setupTmp()
  invalidateHash()
  const f1 = path.join(TMP, 'a.json')
  const f2 = path.join(TMP, 'b.json')
  fs.writeFileSync(f1, JSON.stringify({ parent: 'block/cube' }))
  fs.writeFileSync(f2, JSON.stringify({ parent: 'block/slab' }))
  const h1 = await hashFile(f1, true)
  const h2 = await hashFile(f2, true)
  assert.notEqual(h1, h2)
})

test('hashFile canonical: 非 JSON 文件回退到普通哈希', async () => {
  setupTmp()
  invalidateHash()
  const f = path.join(TMP, 'not-json.txt')
  fs.writeFileSync(f, 'plain text content')
  const hCanonical = await hashFile(f, true)
  const hNormal = await hashFile(f, false)
  assert.equal(hCanonical, hNormal, '非 JSON 文件 canonical 应回退到普通哈希')
})

test('hashFile canonical: 损坏 JSON 回退到普通哈希', async () => {
  setupTmp()
  invalidateHash()
  const f = path.join(TMP, 'broken.json')
  fs.writeFileSync(f, '{ invalid json !!!')
  const hCanonical = await hashFile(f, true)
  const hNormal = await hashFile(f, false)
  assert.equal(hCanonical, hNormal, 'JSON 解析失败应回退到普通哈希')
})

test('hashFile canonical: 命中缓存', async () => {
  setupTmp()
  invalidateHash()
  const f = path.join(TMP, 'cached.json')
  fs.writeFileSync(f, JSON.stringify({ b: 1, a: 2 }))
  const h1 = await hashFile(f, true)
  const before = hashCacheStats().size
  const h2 = await hashFile(f, true)
  const after = hashCacheStats().size
  assert.equal(h1, h2)
  assert.equal(before, after, '缓存命中不应增长条目数')
})