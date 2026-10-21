/**
 * 「保存到节点项目」单测（#btn-save / Ctrl+S 目标地址改为 data/node-projects/）：
 * - saveNodeProject：POST /api/node-projects，成功后记录当前项目并派发 nodeproject:saved
 * - loadNodeProject：GET 成功后当前项目跟随（在 loadGraphJSON 之后设置，不被其清空）
 * - _debugSaveGraph：有当前项目 → 以其 id/name 更新保存；空画布 → 不发请求
 * - loadGraphJSON（本地 JSON 导入）→ 脱离当前项目（下次保存另存新项目）
 * 前端模块依赖浏览器环境，此处以 DOM stub + fetch stub 在 Node 中加载。
 * 注：stub 的 get 对 'then' 返回 undefined，避免 Promise.resolve(stub) 被 thenable 吸收永久挂起
 *     （_generateProjectThumb 在无 canvas 环境下 resolve 出 stub 对象）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

function makeStub() {
  const fn = function () { return makeStub() }
  const styleObj = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
  return new Proxy(fn, {
    get(t, p) {
      if (Reflect.has(t, p)) return Reflect.get(t, p)
      if (p === 'style') return styleObj
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false } }
      if (p === 'isConnected') return false
      if (p === 'children' || p === 'childNodes') return []
      if (p === 'length') return 0
      if (p === 'innerHTML' || p === 'textContent' || p === 'value') return ''
      if (p === 'then') return undefined
      if (p === Symbol.toPrimitive) return () => ''
      if (typeof p === 'symbol') return undefined
      return makeStub()
    },
    apply() { return makeStub() },
    construct() { return makeStub() },
    set(t, p, v) { Reflect.set(t, p, v); return true },
  })
}
globalThis.document = makeStub()
globalThis.window = { CSS: { escape: s => s }, addEventListener() {} }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)

/* fetch stub：记录请求，按路由返回 */
const calls = []
function stubFetch(route) {
  calls.length = 0
  globalThis.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null
    calls.push({ url: String(url), method: opts ? opts.method : 'GET', body })
    const hit = route.find(r => String(url).includes(r.match) && (!opts || !opts.method || opts.method === r.method))
    const payload = hit ? hit.data : { ok: false, msg: 'no route' }
    return { json: async () => payload }
  }
}

let mod

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href
    + '?t=' + Date.now()) // 独立实例：避免与其他测试文件的模块状态串扰
  assert.equal(typeof mod.saveNodeProject, 'function')
  assert.equal(typeof mod.getCurrentProject, 'function')
  assert.equal(typeof mod._debugSaveGraph, 'function')
  assert.equal(typeof mod._debugLoadGraphJSON, 'function')
})

test('saveNodeProject：POST 保存 → 当前项目记录 + 派发 nodeproject:saved', async () => {
  stubFetch([
    { match: '/api/node-projects', method: 'POST', data: { ok: true, data: { id: 'p2', dir: '/data/node-projects/p2.mtgp' } } },
  ])
  mod.createNode('number', 10, 10)
  let evt = null
  document.dispatchEvent = (ev) => { if (ev && ev.type === 'nodeproject:saved') evt = 'seen' }
  const data = await mod.saveNodeProject('我的项目')
  assert.equal(data.id, 'p2')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].body.name, '我的项目')
  assert.ok(!('id' in calls[0].body), '新建保存 body 不应携带 id')
  assert.ok(calls[0].body.graph && Array.isArray(calls[0].body.graph.nodes), 'body 应含 graph')
  assert.deepEqual(mod.getCurrentProject(), { id: 'p2', name: '我的项目' })
  assert.equal(evt, 'seen')
})

test('_debugSaveGraph：有当前项目 → 直接更新该 id', async () => {
  stubFetch([
    { match: '/api/node-projects', method: 'POST', data: { ok: true, data: { id: 'p2', dir: '/data/node-projects/p2.mtgp' } } },
  ])
  await mod._debugSaveGraph()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.id, 'p2', '应携带当前项目 id 原地更新')
  assert.equal(calls[0].body.name, '我的项目')
  assert.deepEqual(mod.getCurrentProject(), { id: 'p2', name: '我的项目' })
})

test('loadNodeProject：GET 加载 → 当前项目跟随（不被 loadGraphJSON 清空）', async () => {
  stubFetch([
    { match: '/api/node-projects/p1', method: 'GET', data: { ok: true, data: {
      id: 'p1', name: '已有工程',
      graph: { nodes: [{ id: 'a', type: 'number', x: 0, y: 0, props: { value: 0.5 } }], links: [] },
      textures: [],
    } } },
  ])
  const data = await mod.loadNodeProject('p1')
  assert.equal(data.name, '已有工程')
  assert.deepEqual(mod.getCurrentProject(), { id: 'p1', name: '已有工程' }, '加载后当前项目应记录，且在 loadGraphJSON 之后设置')
})

test('loadGraphJSON（本地 JSON 导入）→ 脱离当前项目', () => {
  mod._debugLoadGraphJSON(JSON.stringify({ nodes: [{ id: 'b', type: 'number', x: 0, y: 0, props: { value: 1 } }], edges: [] }))
  assert.equal(mod.getCurrentProject(), null, '本地导入后应清空当前项目，下次保存另存新项目')
})

test('空画布 _debugSaveGraph：不发任何请求', async () => {
  stubFetch([])
  mod._debugLoadGraphJSON(JSON.stringify({ nodes: [], edges: [] }))
  await mod._debugSaveGraph()
  assert.equal(calls.length, 0, '画布为空时不应发起保存请求')
})