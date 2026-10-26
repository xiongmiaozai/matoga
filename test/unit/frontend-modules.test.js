/**
 * 前端模块图完整性测试
 *
 * 目的：拆分/重构后，任何前端模块出现
 *  - 引用未声明的标识符（ReferenceError）
 *  - import 了源模块未导出的符号（SyntaxError: does not provide an export）
 *  - 语法错误
 * 都会在这里立即失败。
 *
 * 为什么需要：服务端单测（node --test test/unit）不加载 web/src，模块级错误
 * 无法被覆盖；HTTP 200 只证明文件能服务出去，不证明它在浏览器里能跑。
 *
 * 前端模块依赖浏览器环境，此处用 DOM stub + 模块重定向在 Node 中加载。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
const SRC = path.join(ROOT, 'web/src')

register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

/* 万能 DOM stub：让模块顶层副作用与常见 DOM 访问安全执行 */
function makeStub() {
  const fn = function () { return makeStub() }
  const styleObj = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
  return new Proxy(fn, {
    get(t, p) {
      if (p === 'style') return styleObj
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false } }
      if (p === 'isConnected') return false
      if (p === 'children' || p === 'childNodes') return []
      if (p === 'length') return 0
      if (p === 'innerHTML' || p === 'textContent' || p === 'value') return ''
      if (p === 'tagName') return 'DIV'
      if (p === 'dataset') return {}
      if (p === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 })
      if (p === 'querySelectorAll') return () => []
      if (p === 'matches') return () => false
      if (p === 'closest') return () => null
      if (p === Symbol.toPrimitive) return () => ''
      if (typeof p === 'symbol') return undefined
      return makeStub()
    },
    apply() { return makeStub() },
    construct() { return makeStub() },
    set() { return true },
  })
}

globalThis.document = makeStub()
globalThis.self = globalThis
globalThis.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '', hash: '' }
globalThis.window = { CSS: { escape: s => s }, addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/' } }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = id => clearTimeout(id)
globalThis.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null },
  setItem(k, v) { this._d[k] = String(v) },
  removeItem(k) { delete this._d[k] },
}
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ ok: false }), text: async () => '' })
globalThis.Element = class {}
globalThis.HTMLElement = class {}
globalThis.Image = class { constructor() { this.style = {} } }
globalThis.FileReader = class { readAsDataURL() {} }
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o) } }
globalThis.Blob = class { constructor() {} }
globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}

/* web/src 顶层的所有 ESM 模块（含子目录） */
function collectModules(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) collectModules(full, acc)
    else if (ent.isFile() && ent.name.endsWith('.js')) acc.push(full)
  }
  return acc
}

const modules = collectModules(SRC).sort()

test('web/src 下存在前端模块（清单非空）', () => {
  assert.ok(modules.length > 0, '未发现任何前端模块')
})

test('web/src 全部模块可被导入（无 ReferenceError / 缺导出 / 语法错误）', async () => {
  const failures = []
  for (const file of modules) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    try {
      await import(pathToFileURL(file).href)
    } catch (e) {
      /* 缺第三方依赖（node_modules 未装）不算前端代码缺陷，跳过 */
      if (e && (e.code === 'MODULE_NOT_FOUND' || e.code === 'ENOENT')) continue
      failures.push(`${rel}: ${e && e.constructor ? e.constructor.name : 'Error'}: ${e && e.message}`)
    }
  }
  assert.deepEqual(failures, [], `以下模块导入失败：\n${failures.join('\n')}`)
})
