const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { scan, shouldIgnore } = require('../../server/services/scan-service')

const TMP = path.join(os.tmpdir(), 'matoga-ut-scan-' + process.pid)

function setupTmp(tree) {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  const walk = (base, t) => {
    for (const [k, v] of Object.entries(t)) {
      const p = path.join(base, k)
      if (typeof v === 'string') { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, v) }
      else { fs.mkdirSync(p, { recursive: true }); walk(p, v) }
    }
  }
  walk(TMP, tree)
}

test('shouldIgnore: 空模式不过滤', () => {
  assert.equal(shouldIgnore('foo.txt', []), false)
  assert.equal(shouldIgnore('foo.txt', null), false)
})

test('shouldIgnore: 精确名匹配（大小写不敏感）', () => {
  assert.equal(shouldIgnore('Thumbs.db', ['thumbs.db']), true)
  assert.equal(shouldIgnore('thumbs.db', ['Thumbs.db']), true)
  assert.equal(shouldIgnore('foo.txt', ['bar.txt']), false)
})

test('shouldIgnore: *.ext 通配', () => {
  assert.equal(shouldIgnore('a.log', ['*.log']), true)
  assert.equal(shouldIgnore('A.LOG', ['*.log']), true)
  assert.equal(shouldIgnore('a.txt', ['*.log']), false)
})

test('shouldIgnore: 含 * 的 glob', () => {
  assert.equal(shouldIgnore('backup_2024.txt', ['backup_*']), true)
  assert.equal(shouldIgnore('backup_2024.txt', ['*_2024.*']), true)
  assert.equal(shouldIgnore('restore.txt', ['backup_*']), false)
})

test('shouldIgnore: 含正则特殊字符的 pattern 不崩溃', () => {
  assert.equal(shouldIgnore('a(xb', ['a(*b']), true)
  assert.equal(shouldIgnore('a[xb', ['a[*b']), true)
  assert.equal(shouldIgnore('normal.txt', ['a(*b']), false)
})

test('scan: 非递归读取目录', async () => {
  setupTmp({ 'a.txt': '', 'b.png': '', 'sub': {} })
  const entries = await scan(TMP, [], false)
  assert.equal(entries.length, 3)
  const names = entries.map(e => e.name).sort()
  assert.deepEqual(names, ['a.txt', 'b.png', 'sub'])
  const sub = entries.find(e => e.name === 'sub')
  assert.equal(sub.isDirectory, true)
  assert.equal(sub.size, 0)
  const a = entries.find(e => e.name === 'a.txt')
  assert.equal(a.isDirectory, false)
  assert.equal(a.size, 0)
  assert.ok(a.mtime >= 0)
})

test('scan: 递归读取目录', async () => {
  setupTmp({ 'a.txt': '', 'sub': { 'c.jpg': '', 'deep': { 'd.txt': '' } } })
  const entries = await scan(TMP, [], true)
  const rels = entries.map(e => e.name).sort()
  assert.deepEqual(rels, ['a.txt', 'sub', 'sub/c.jpg', 'sub/deep', 'sub/deep/d.txt'])
})

test('scan: 忽略模式生效', async () => {
  setupTmp({ 'a.txt': '', 'b.log': '', 'Thumbs.db': '', 'sub': { 'c.log': '' } })
  const entries = await scan(TMP, ['*.log', 'thumbs.db'], false)
  const names = entries.map(e => e.name).sort()
  assert.deepEqual(names, ['a.txt', 'sub'])
})

test('scan: 递归 + 忽略组合', async () => {
  setupTmp({ 'a.txt': '', 'b.log': '', 'sub': { 'c.txt': '', 'd.log': '' } })
  const entries = await scan(TMP, ['*.log'], true)
  const rels = entries.map(e => e.name).sort()
  assert.deepEqual(rels, ['a.txt', 'sub', 'sub/c.txt'])
})

test('scan: 不存在的目录抛 ERR_FS_NOT_FOUND', async () => {
  await assert.rejects(
    () => scan(path.join(TMP, 'nope'), [], false),
    (e) => e.code === 'ERR_FS_NOT_FOUND'
  )
})

test('scan: entry 字段完整', async () => {
  setupTmp({ 'file.txt': 'hello' })
  const [e] = await scan(TMP, [], false)
  assert.equal(e.name, 'file.txt')
  assert.equal(e.baseName, 'file.txt')
  assert.ok(e.fullPath.endsWith('file.txt'))
  assert.equal(e.isDirectory, false)
  assert.equal(e.size, 5)
  assert.ok(typeof e.mtime === 'number')
  assert.equal(e.error, undefined)
})

test('cleanup', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })