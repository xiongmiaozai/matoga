/**
 * MC 资源包导入功能单测（POST /api/mc-packs/import）：
 * - zip 导入：base64 内联 zip → 解压到 mcPacksPath → /list 可见
 * - 目录导入：files 列表 → 写入 mcPacksPath → /list 可见
 * - 同名去重：不覆盖时自动追加 -2
 * - 同名覆盖：overwrite=true 替换已有
 * - Zip Slip 防护：含 ../ 的条目被拒绝
 * 隔离方式：monkey-patch configStore.get（内存注入 mcPacksPath，零磁盘污染）。
 * zip 为零依赖手工构造（store 方式，CRC 填 0）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { createApp } = require('../../server/app')
const configStore = require('../../server/config/config-store')
const { trust } = require('../../server/middleware/validate')

/* ── 最小 zip 构造（method 0 stored）── */
function buildZip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8)
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28)
    locals.push(lh, nameBuf, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8)
    ch.writeUInt32LE(0, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(0, 38)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cdBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cdBuf, eocd])
}

const MCMETA = JSON.stringify({ pack: { pack_format: 34, description: 'Imported Pack' } })
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

let ROOT = ''

const origGet = configStore.get.bind(configStore)
const origPut = configStore.put.bind(configStore)
let injected = {}

test('setup: 注入临时 mcPacksPath 配置', async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpacks-import-'))
  injected = { ...origGet(), mcPacksPath: ROOT }
  configStore.get = () => injected
  configStore.put = (patch) => { Object.assign(injected, patch || {}); return Promise.resolve() }
  trust(ROOT)
  assert.equal(configStore.get().mcPacksPath, ROOT)
})

test('导入 zip: base64 内联 zip 解压到 mcPacksPath', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const zipBuf = buildZip([
      { name: 'pack.mcmeta', data: MCMETA },
      { name: 'pack.png', data: PNG },
      { name: 'assets/minecraft/textures/block/stone.png', data: PNG },
    ])
    const res = await (await fetch(base + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipData: zipBuf.toString('base64'), name: 'TestImport' }),
    })).json()
    assert.equal(res.ok, true)
    assert.equal(res.data.name, 'TestImport')
    assert.equal(res.data.entry.valid, true)
    assert.equal(res.data.entry.format, 34)
    assert.equal(res.data.entry.description, 'Imported Pack')
    assert.ok(fs.existsSync(path.join(ROOT, 'TestImport', 'pack.mcmeta')))
    assert.ok(fs.existsSync(path.join(ROOT, 'TestImport', 'assets/minecraft/textures/block/stone.png')))

    const list = await (await fetch(base + '/list')).json()
    assert.ok(list.data.packs.some(p => p.name === 'TestImport'))
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('导入 zip: 留空名称时从 pack.mcmeta 描述推断', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const zipBuf = buildZip([
      { name: 'pack.mcmeta', data: MCMETA },
    ])
    const res = await (await fetch(base + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipData: zipBuf.toString('base64') }),
    })).json()
    assert.equal(res.ok, true)
    assert.equal(res.data.name, 'Imported Pack')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('导入 zip: 同名去重（不覆盖时追加 -2）', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const zipBuf = buildZip([{ name: 'pack.mcmeta', data: MCMETA }])
    const res = await (await fetch(base + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipData: zipBuf.toString('base64'), name: 'Imported Pack' }),
    })).json()
    assert.equal(res.ok, true)
    assert.equal(res.data.name, 'Imported Pack-2')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('导入 zip: overwrite=true 替换已有', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const zipBuf = buildZip([
      { name: 'pack.mcmeta', data: JSON.stringify({ pack: { pack_format: 42, description: 'Overwritten' } }) },
    ])
    const res = await (await fetch(base + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipData: zipBuf.toString('base64'), name: 'TestImport', overwrite: true }),
    })).json()
    assert.equal(res.ok, true)
    assert.equal(res.data.name, 'TestImport')
    assert.equal(res.data.entry.format, 42)
    assert.equal(res.data.entry.description, 'Overwritten')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('导入目录: files 列表写入 mcPacksPath', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const files = [
      { path: 'pack.mcmeta', data: Buffer.from(MCMETA).toString('base64') },
      { path: 'assets/minecraft/textures/block/dirt.png', data: PNG.toString('base64') },
    ]
    const res = await (await fetch(base + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, name: 'DirImport' }),
    })).json()
    assert.equal(res.ok, true)
    assert.equal(res.data.name, 'DirImport')
    assert.equal(res.data.entry.valid, true)
    assert.ok(fs.existsSync(path.join(ROOT, 'DirImport', 'pack.mcmeta')))
    assert.ok(fs.existsSync(path.join(ROOT, 'DirImport', 'assets/minecraft/textures/block/dirt.png')))
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('导入 zip: Zip Slip 防护（含 ../ 的条目被拒绝）', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const zipBuf = buildZip([
      { name: 'pack.mcmeta', data: MCMETA },
      { name: '../evil.txt', data: Buffer.from('pwned') },
    ])
    const res = await (await fetch(base + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipData: zipBuf.toString('base64'), name: 'SlipTest' }),
    })).json()
    assert.equal(res.ok, false)
    assert.equal(res.code, 'ERR_PATH_DENIED')
    assert.ok(!fs.existsSync(path.join(ROOT, 'SlipTest')))
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('导入: 缺 zipData 和 files 时报参数错误', async () => {
  const server = http.createServer(createApp())
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/mc-packs`
  try {
    const res = await (await fetch(base + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Empty' }),
    })).json()
    assert.equal(res.ok, false)
    assert.equal(res.code, 'ERR_INVALID_PARAM')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('teardown: 清理临时目录并恢复 configStore', async () => {
  configStore.get = origGet
  configStore.put = origPut
  fs.rmSync(ROOT, { recursive: true, force: true })
})