/**
 * 内容分类（block / item）判定单测（web/src/utils.js）：
 * - contentKindOfPath：路径级判定——textures|models 下的 block/item 目录、
 *   1.21.4+ 物品定义 assets/<ns>/items/；兼容磁盘绝对路径、pack:/packmodel: 虚拟前缀路径
 * - 边界：entity / blockentity / gui 等其他类别 → null（路径段边界，blockentity 不误判）
 * 前端模块依赖浏览器环境，此处以 DOM stub 在 Node 中加载（借鉴 fxnodes.test.js）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')

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

let mod
test('加载 utils 前端模块（DOM stub 环境）', async () => {
  mod = await import(pathToFileURL(path.join(ROOT, 'web/src/utils.js')).href)
  assert.equal(typeof mod.contentKindOfPath, 'function')

})

test('contentKindOfPath: textures 贴图目录判定', () => {
  assert.equal(mod.contentKindOfPath('textures/block/stone.png'), 'block')
  assert.equal(mod.contentKindOfPath('textures/item/apple.png'), 'item')
  assert.equal(mod.contentKindOfPath('assets/minecraft/textures/block/oak_planks.png'), 'block')
  assert.equal(mod.contentKindOfPath('assets/minecraft/textures/item/diamond_sword.png'), 'item')
})

test('contentKindOfPath: 模型与 1.21.4+ 物品定义判定', () => {
  assert.equal(mod.contentKindOfPath('assets/minecraft/models/block/cube_all.json'), 'block')
  assert.equal(mod.contentKindOfPath('assets/minecraft/models/item/generated.json'), 'item')
  assert.equal(mod.contentKindOfPath('assets/minecraft/items/stone.json'), 'item')
})

test('contentKindOfPath: 各类路径形式（磁盘绝对路径 / pack 虚拟前缀）', () => {
  assert.equal(mod.contentKindOfPath('/Users/x/pack/assets/mc/textures/item/apple.png'), 'item', '磁盘绝对路径')
  assert.equal(mod.contentKindOfPath('pack:mc:mypack/assets/mc/textures/block/stone.png'), 'block', 'zip 包贴图虚拟路径')
  assert.equal(mod.contentKindOfPath('packmodel:mc:mypack/assets/mc/models/item/bow.json'), 'item', '包模型虚拟路径')
  assert.equal(mod.contentKindOfPath('packmodel:official:p/assets/mc/items/bow.json'), 'item', '1.21.4+ 物品定义虚拟路径')
})

test('contentKindOfPath: 其他类别与脏数据 → null', () => {
  assert.equal(mod.contentKindOfPath('textures/entity/creeper.png'), null)
  assert.equal(mod.contentKindOfPath('textures/blockentity/chest.png'), null, 'blockentity 不误判为 block')
  assert.equal(mod.contentKindOfPath('textures/gui/buttons.png'), null)
  assert.equal(mod.contentKindOfPath('assets/minecraft/models/entity/custom.json'), null)
  assert.equal(mod.contentKindOfPath('oak_planks.png'), null, '根级文件无目录')
  assert.equal(mod.contentKindOfPath('block'), null, '目录名本身（无路径段边界）不判定')
  assert.equal(mod.contentKindOfPath('textures/block'), null, '目录（无尾斜杠）不判定')
  assert.equal(mod.contentKindOfPath(''), null)
  assert.equal(mod.contentKindOfPath(null), null)
  assert.equal(mod.contentKindOfPath(undefined), null)
  assert.equal(mod.contentKindOfPath(123), null)
})