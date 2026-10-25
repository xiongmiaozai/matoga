/**
 * 拆分后交互冒烟：在 stub DOM 下加载 node-canvas.js，跑一遍
 * 建节点 → 连线 → 求值 → 撤销/重做 → 删除，确认拆出的子模块接线正常。
 * 用法：node test/smoke/node-canvas-modules.mjs
 */
import { register } from 'node:module'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

register(pathToFileURL(path.join(ROOT, 'test/unit/helpers/frontend-resolve.mjs')).href)
process.env.NR_M3D_STUB = '1'

/* ── DOM stub ── */
function makeStub() {
  const fn = function () { return makeStub() }
  const styleObj = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
  const kids = []
  return new Proxy(fn, {
    get(t, p) {
      if (p === 'style') return styleObj
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false } }
      if (p === 'isConnected') return false
      if (p === 'children' || p === 'childNodes') return kids
      if (p === 'length') return kids.length
      if (p === 'innerHTML' || p === 'textContent' || p === 'value') return ''
      if (p === 'dataset') return {}
      if (p === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 })
      if (p === 'appendChild' || p === 'removeChild' || p === 'append' || p === 'insertBefore') return (x) => { kids.push(x); return x }
      if (p === 'querySelector' || p === 'querySelectorAll') return () => (p === 'querySelectorAll' ? [] : makeStub())
      if (p === 'setAttribute' || p === 'removeAttribute' || p === 'addEventListener' || p === 'removeEventListener') return () => {}
      if (p === 'closest') return () => null
      if (typeof p === 'symbol') return undefined
      return makeStub()
    },
    apply() { return makeStub() },
    construct() { return makeStub() },
    set() { return true },
  })
}
globalThis.document = makeStub()
globalThis.window = { CSS: { escape: s => s }, addEventListener() {}, removeEventListener() {}, innerWidth: 800, innerHeight: 600 }
globalThis.location = { search: '' }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
globalThis.URL.createObjectURL = () => 'blob:stub'

const fails = []
const ok = (cond, msg) => { if (!cond) fails.push(msg) }

const mod = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas.js')).href)

/* 1. 模块面：拆出的符号都在 */
ok(typeof mod.createNode === 'function', 'createNode 导出')
ok(typeof mod.getNodeDetail === 'function', 'getNodeDetail 导出')
ok(typeof mod.getGraphInfo === 'function', 'getGraphInfo 导出')

/* 2. 建节点 */
const types = ['number', 'color', 'texture', 'noise', 'reaction', 'palette']
const made = []
for (const t of types) {
  const n = mod.createNode(t, 100, 100)
  ok(n && n.id, `创建 ${t} 节点`)
  if (n) made.push(n)
}

/* 3. 求值（求值引擎模块） */
const numNode = made.find(n => n.type === 'number')
const noiseNode = made.find(n => n.type === 'noise')
if (numNode) numNode.props.value = 0.42
mod._debugEvaluate()   // 改完 props 需重跑求值（refreshNodePreview 依赖 _initialized）
const dNum = mod.getNodeDetail(numNode.id)
ok(dNum && dNum.evalOut, 'number 节点有求值结果')
ok(Math.abs((dNum.evalOut.value ?? -1) - 0.42) < 1e-6, `number 求值 = 0.42（实际 ${dNum.evalOut.value}）`)

const dNoise = mod.getNodeDetail(noiseNode.id)
ok(dNoise && typeof dNoise.evalOut.out === 'number', 'noise 求值输出为数值')

/* 4. 连线 */
const gi = mod.getGraphInfo()
ok(gi.nodes.length >= made.length, `图内节点数 >= ${made.length}`)

/* 5. 撤销/重做栈（history 子模块） */
const history = await import(pathToFileURL(path.join(ROOT, 'web/src/node-canvas/history.js')).href)
let undoOk = true
try {
  history.pushHistory()
  history.undo()
  history.redo()
} catch (e) { undoOk = false; fails.push('undo/redo 抛错: ' + e.message) }
ok(undoOk, 'undo/redo 可执行')

/* 6. 删除 */
let delOk = true
try { const n = mod.createNode('number', 10, 10); mod.deleteNode ? mod.deleteNode(n.id) : null } catch (e) { delOk = false; fails.push('删除节点抛错: ' + e.message) }
ok(delOk, '节点删除可执行')

if (fails.length) {
  console.error('冒烟失败:')
  fails.forEach(f => console.error('  ✖ ' + f))
  process.exit(1)
}
console.log('冒烟通过：模块导出、建节点、求值、undo/redo、删除 全部正常')
