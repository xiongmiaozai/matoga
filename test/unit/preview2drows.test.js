/**
 * 2D 预览面板行构建（buildPreview2DRows）单测：
 * - 面板仅承载主贴图 / 法线 / 高光三种材质槽位（按此顺序）
 * - 仅输出接口节点产生行：贴图输出节点（texOut，null 显式清除）；材质输出节点 normal → 法线
 * - texture 等普通节点不再隐式回退进入预览（必须经输出接口）
 * - 基础色不再产生行（在输出节点预览中查看）；空输入返回空数组（面板显示占位提示）
 * 前端模块依赖浏览器环境，此处以 DOM stub + 模块重定向在 Node 中加载。
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
      if (p === 'style') return styleObj
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false } }
      if (p === 'isConnected') return false
      if (p === 'children' || p === 'childNodes') return []
      if (p === 'length') return 0
      if (p === 'innerHTML' || p === 'textContent' || p === 'value') return ''
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
globalThis.window = { CSS: { escape: s => s }, addEventListener() {} }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)

const URL = 'data:image/png;base64,AAAA'
const URL2 = 'data:image/png;base64,BBBB'

let buildPreview2DRows

test('加载 node-canvas 前端模块（DOM stub 环境）', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)
  assert.equal(typeof mod.buildPreview2DRows, 'function')
  buildPreview2DRows = mod.buildPreview2DRows
})

test('空输入：返回空数组（面板显示占位提示）', () => {
  assert.deepEqual(buildPreview2DRows({}), [])
})

test('仅三种材质槽位产生行，且顺序固定：主贴图→法线→高光', () => {
  const rows = buildPreview2DRows({
    texOutL: { main: URL, normal: URL, spec: URL },
  })
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(r => r.role), ['主贴图 (Albedo)', '法线 (Normal)', '高光 (-s)'])
})

test('主贴图：仅主贴图输出节点产生行（texture 候选不再隐式回退）', () => {
  const rows = buildPreview2DRows({ mainTex: URL })
  assert.deepEqual(rows, [], '未放置输出节点时 texture 候选不进入预览')

  const rows2 = buildPreview2DRows({ texOutR: { main: URL2 } })
  assert.equal(rows2.length, 1)
  assert.equal(rows2[0].left, null, '左侧无输出节点 → 空槽')
  assert.equal(rows2[0].right.img, URL2, '右侧输出节点生效')
})

test('法线：材质输出 normal 与法线输出节点槽位；高光：仅输出节点槽位', () => {
  const rows = buildPreview2DRows({ mat: { normal: { src: URL } }, texOutR: { normal: URL2, spec: URL } })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].role, '法线 (Normal)')
  assert.equal(rows[0].left.img, URL, '材质输出节点 normal 生效')
  assert.equal(rows[0].right.img, URL2, '法线输出节点优先')
  assert.equal(rows[1].role, '高光 (-s)')
  assert.equal(rows[1].left, null, '左侧无高光 → 空槽')
  assert.equal(rows[1].right.img, URL)
})

test('输出节点 null 显式清除槽位（不再回退）', () => {
  const rows = buildPreview2DRows({ texOutL: { main: null }, texOutR: { main: URL } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].left, null, '左侧被显式清除')
  assert.equal(rows[0].right.img, URL, '右侧输出节点生效')
})

test('基础色不再产生 2D 行（在输出节点预览中查看）', () => {
  const rows = buildPreview2DRows({ mat: { baseColor: [1, 0, 0], roughness: 0.5, metallic: 0.2 } })
  assert.deepEqual(rows, [], '纯颜色材质不应出现在 2D 预览面板')
})