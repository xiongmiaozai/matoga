/**
 * UV 贴图视图（uv-view.js）单测（DOM stub 模式）：
 * - 窗口创建/幂等/结构（toolbar + 画布区 + 状态栏）
 * - 空态（视口无模型）：emptyEl 显示、chips 为空
 * - 有模型：chips 构建/切换、fit 缩放画布尺寸、面矩形绘制调用、状态栏文本
 * - mcmodel:shown 事件 → 窗口打开时自动刷新
 * - mousemove 悬停命中 → 状态栏显示元素/面信息
 * 依赖经 helpers/uv-view-resolve.mjs stub（floating-window 真实实现 + RecEl DOM stub）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
register('./helpers/uv-view-resolve.mjs', pathToFileURL(__dirname + '/'))

/* ── DOM stub（借鉴 floating-window.test.js 的 RecEl；classList/querySelectorAll 真实实现） ── */
function makeClassList(el) {
  const read = () => new Set(String(el.className || '').split(/\s+/).filter(Boolean))
  const write = set => { el.className = [...set].join(' ') }
  return {
    add(...cs) { const s = read(); cs.forEach(c => s.add(c)); write(s) },
    remove(...cs) { const s = read(); cs.forEach(c => s.delete(c)); write(s) },
    toggle(c, force) { const s = read(); const on = force !== undefined ? !!force : !s.has(c); on ? s.add(c) : s.delete(c); write(s) },
    contains(c) { return read().has(c) },
  }
}

class RecEl {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.attributes = {}
    this._text = ''
    this.style = {}
    this.dataset = {}
    this.listeners = {}
    this._cw = null; this._ch = null
    this.classList = makeClassList(this)
  }
  set id(v) { this._id = v }
  get id() { return this._id || '' }
  setAttribute(k, v) { this.attributes[k] = String(v) }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null }
  appendChild(c) { this.children.push(c); return c }
  insertBefore(el, ref) {
    const i = ref ? this.children.indexOf(ref) : -1
    if (i >= 0) this.children.splice(i, 0, el)
    else this.children.push(el)
    return el
  }
  remove() {}
  _descendants(out) {
    out = out || []
    for (const c of this.children) { out.push(c); c._descendants(out) }
    return out
  }
  querySelectorAll(sel) {
    if (typeof sel !== 'string') return []
    if (sel === 'button') return this._descendants().filter(d => d.tagName === 'button')
    if (sel[0] === '.') {
      const cls = sel.slice(1)
      return this._descendants().filter(d => String(d.className || '').split(/\s+/).includes(cls))
    }
    return []
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  removeEventListener() {}
  getContext() { return null }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 } }
  get clientWidth() { return this._cw != null ? this._cw : 300 }
  set clientWidth(v) { this._cw = v }
  get clientHeight() { return this._ch != null ? this._ch : 200 }
  set clientHeight(v) { this._ch = v }
  set innerHTML(v) { this.children = []; this._html = v }
  get innerHTML() { return this._html || '' }
  set textContent(v) { this._text = String(v) }
  get textContent() { return this._text }
  set className(v) { this.attributes.class = String(v) }
  get className() { return this.attributes.class || '' }
  setPointerCapture() {}
  closest() { return null }
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this, stopPropagation() {} })) }
}

const ctxCalls = { drawImage: 0, fillRect: 0, strokeRect: 0 }
const drawImageArgs = []   /* 记录 drawImage 实参（断言动画贴图首帧源区域） */
const fakeCtx = new Proxy({}, {
  get(_t, p) {
    if (p === 'measureText') return () => ({ width: 10 })
    if (typeof p === 'symbol') return undefined
    if (p === 'canvas') return null
    return (...args) => {
      if (p === 'drawImage') { ctxCalls.drawImage++; drawImageArgs.push(args) }
      else if (p in ctxCalls) ctxCalls[p]++
    }
  },
  set() { return true },
})

const bodyEl = new RecEl('body')
globalThis.document = {
  createElement(tag) {
    const e = new RecEl(tag)
    if (tag === 'canvas') e.getContext = () => fakeCtx
    return e
  },
  createElementNS(ns, tag) {
    const e = new RecEl(tag)
    if (String(tag).includes('canvas')) e.getContext = () => fakeCtx
    return e
  },
  body: bodyEl,
  getElementById() { return null },
}

const winListeners = new Map()
globalThis.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  addEventListener(type, fn) { winListeners.set(type, [...(winListeners.get(type) || []), fn]) },
  removeEventListener() {},
  dispatchEvent(ev) { for (const fn of winListeners.get(ev.type) || []) fn(ev); return true },
}
const _ls = new Map()
globalThis.localStorage = {
  getItem: k => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: k => _ls.delete(k),
}
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
const imgSizes = new Map()   /* url → { w, h }（动画贴图用例注入非方形尺寸） */
globalThis.Image = class {
  constructor() { this.naturalWidth = 16; this.naturalHeight = 16 }
  set src(v) {
    this._src = v
    setTimeout(() => {
      const s = imgSizes.get(v)
      if (s) { this.naturalWidth = s.w; this.naturalHeight = s.h }
      this.onload && this.onload()
    }, 0)
  }
  get src() { return this._src || '' }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
let uv = null
let fw = null
let fwMod = null
let utils = null

const LAYOUT = {
  type: 'mc', uvScale: 16,
  textures: [
    { name: 'block/oak', url: 'http://test/oak.png' },
    { name: 'block/stone', url: 'http://test/stone.png' },
  ],
  elements: [
    { faces: {
      north: { tex: 0, uv: [0, 0, 8, 8], rotation: 0, mirror: false },
      up: { tex: 1, uv: [0, 0, 16, 16], rotation: 90, mirror: true },
    } },
  ],
}

function parts() {
  const wrap = fw.body.children[0]
  return {
    wrap,
    toolbar: wrap.children[0],
    canvasWrap: wrap.children[1],
    status: wrap.children[2],
    chips: wrap.children[0].children[0],
  }
}

test('setup: 加载 uv-view（依赖 stub 模式）', async () => {
  uv = await import(pathToFileURL(path.join(ROOT, 'web/src/uv-view.js')).href)
  fwMod = await import(pathToFileURL(path.join(ROOT, 'web/src/floating-window.js')).href)
  utils = await import(pathToFileURL(path.join(ROOT, 'web/src/utils.js')).href)
  assert.equal(typeof uv.initUvView, 'function')
  assert.equal(typeof uv.toggleUvView, 'function')
  assert.equal(typeof uv.refreshUvView, 'function')
  assert.equal(typeof fwMod.getWindow, 'function')
})

test('initUvView: 窗口创建挂载 body 且幂等', () => {
  fw = uv.initUvView()
  assert.ok(fw, '窗口创建')
  assert.ok(bodyEl.children.includes(fw.win), '挂载 body')
  assert.equal(fw.win.dataset.fwId, 'uvView')
  assert.equal(uv.initUvView(), fw, '幂等：重复 init 返回同一窗口')
  assert.equal(fw.isOpen(), false, '初始不显示（open:false）')
  assert.equal(fw.titleEl && fw.titleEl.textContent || '', '', 'floating-window 标题（t stub 无关紧要）')
})

test('空态：视口无模型 → emptyEl 显示 / chips 为空 / 状态栏空', async () => {
  delete globalThis.__uvTestActive
  delete globalThis.__uvTestLayout
  fw.open()
  uv.refreshUvView()
  await sleep(30)
  const { chips, canvasWrap, status } = parts()
  const emptyEl = canvasWrap.children[1]
  assert.equal(emptyEl.style.display, '', '空态块显示（窗口打开时）')
  assert.equal(chips.children.length, 0)
  assert.equal(status.textContent, '')
})

test('有模型：refresh 构建 chips（2 贴图，首个 active）', () => {
  globalThis.__uvTestActive = true
  globalThis.__uvTestLayout = LAYOUT
  uv.refreshUvView()
  const { chips } = parts()
  assert.equal(chips.children.length, 2)
  assert.equal(chips.children[0].textContent, 'block/oak')
  assert.equal(chips.children[1].textContent, 'block/stone')
  assert.match(chips.children[0].className, /active/)
  assert.ok(!/active/.test(chips.children[1].className))
})

test('open 后 draw：fit 缩放画布 + 底图绘制 + 状态栏文本', async () => {
  fw.open()
  await sleep(30)
  const { canvasWrap, status } = parts()
  const canvas = canvasWrap.children[0]
  /* clientWidth 300 / clientHeight 200 → avail 284×184 → fit floor(11.5)=11 → 16×11=176 */
  assert.equal(canvas.style.width, '176px', 'fit 缩放（16px 贴图 × 11）')
  assert.equal(canvas.style.height, '176px')
  assert.equal(canvas.width, 176, 'dpr=1 物理像素一致')
  assert.ok(ctxCalls.drawImage >= 1, '贴图底图绘制')
  /* oak 面数 1（north）→ uv.faces:1；16×16 尺寸 */
  assert.match(status.textContent, /block\/oak/)
  assert.match(status.textContent, /16×16/)
  assert.match(status.textContent, /uv\.faces:1/)
})

test('chip 切换贴图 → activeTex 更新 + 状态栏切换', async () => {
  const { chips, status } = parts()
  ctxCalls.drawImage = 0
  chips.children[1].click()
  await sleep(30)
  assert.match(chips.children[1].className, /active/)
  assert.ok(!/active/.test(chips.children[0].className))
  assert.match(status.textContent, /block\/stone/)
  assert.match(status.textContent, /uv\.faces:1/)
})

test('mousemove 悬停命中 → 状态栏显示元素/面/旋转/镜像', async () => {
  const { chips, canvasWrap, status } = parts()
  chips.children[0].click()
  await sleep(30)
  const canvas = canvasWrap.children[0]
  /* oak 布局面 north uv[0,0,8,8] → rect (0,0,88,88)（px=11）→ 命中 (10,10) */
  ;(canvas.listeners.mousemove || []).forEach(fn => fn({ clientX: 10, clientY: 10 }))
  await sleep(30)
  assert.match(status.textContent, /uv\.el 0/)
  assert.match(status.textContent, /north/)
  assert.ok(!/uv\.rot/.test(status.textContent), 'rotation 0 不显示')
  /* 移出 → 清除悬停 */
  ;(canvas.listeners.mouseleave || []).forEach(fn => fn())
  await sleep(30)
  assert.ok(!/uv\.el/.test(status.textContent), '移出后悬停清除')
})

test('动画贴图：mcmeta 加载后仅显示首帧 + 状态栏帧数（campfire_fire 场景）', async () => {
  const realFetch = globalThis.fetch
  const fetchUrls = []
  globalThis.fetch = url => {
    fetchUrls.push(String(url))
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ animation: { frametime: 2 } }) })
  }
  imgSizes.set('http://test/campfire_fire.png', { w: 16, h: 128 })   /* 8 帧竖长条 */
  const ANIM_LAYOUT = {
    type: 'mc', uvScale: 16,
    textures: [{
      name: 'block/campfire_fire',
      url: 'http://test/campfire_fire.png',
      mcmetaUrl: 'http://test/campfire_fire.png.mcmeta',
    }],
    elements: [{ faces: { north: { tex: 0, uv: [0, 0, 16, 16], rotation: 0, mirror: false } } }],
  }
  globalThis.__uvTestLayout = ANIM_LAYOUT
  fw.open()
  uv.refreshUvView()
  await sleep(50)
  const { canvasWrap, status } = parts()
  const canvas = canvasWrap.children[0]
  /* 首帧 16×16：fit 缩放 11px → 176×176（而非整图 16×128 被压扁/超长显示） */
  assert.equal(canvas.style.width, '176px', '画布按首帧尺寸缩放')
  assert.equal(canvas.style.height, '176px')
  assert.ok(fetchUrls.includes('http://test/campfire_fire.png.mcmeta'), '请求贴图 mcmeta')
  assert.match(status.textContent, /16×128/, '状态栏显示原始整图尺寸')
  assert.match(status.textContent, /uv\.animFrames:8/, '状态栏显示帧数（i18n stub）')
  /* drawImage 源区域为首帧（16×128 贴图取顶部 16×16，9 参形式 sx,sy,sw,sh） */
  const last = drawImageArgs[drawImageArgs.length - 1]
  assert.equal(last.length, 9, '源区域形式的 drawImage')
  assert.equal(last[2], 0); assert.equal(last[3], 16, '源高 = 帧高（而非整图 128）')
  globalThis.fetch = realFetch
})

test('mcmodel:shown 事件 → 打开的窗口自动刷新（新布局 chips 重建）', async () => {
  const NEW_LAYOUT = {
    type: 'mc', uvScale: 16,
    textures: [
      { name: 'a', url: 'http://test/a.png' },
      { name: 'b', url: 'http://test/b.png' },
      { name: 'c', url: 'http://test/c.png' },
    ],
    elements: [{ faces: { north: { tex: 0, uv: [0, 0, 16, 16], rotation: 0, mirror: false } } }],
  }
  globalThis.__uvTestLayout = NEW_LAYOUT
  window.dispatchEvent(new CustomEvent('mcmodel:shown', { detail: { layout: NEW_LAYOUT } }))
  await sleep(30)
  const { chips } = parts()
  assert.equal(chips.children.length, 3, '贴图 chips 重建为 3')
  assert.equal(chips.children[0].textContent, 'a')
})

test('关闭后 mcmodel:shown 不触发刷新（窗口关闭态）', async () => {
  fw.close()
  globalThis.__uvTestLayout = LAYOUT
  window.dispatchEvent(new CustomEvent('mcmodel:shown', { detail: { layout: LAYOUT } }))
  await sleep(30)
  const { chips } = parts()
  assert.equal(chips.children.length, 3, '关闭态不刷新（保持 3 chips）')
})
/* ════════════════ 编辑模式（拖拽 / 手柄 / 撤销 / 贴图替换 / 导出） ════════════════ */

function freshEditLayout() {
  const srcEl = { from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: '#side', uv: [0, 0, 8, 8] } } }
  const layout = {
    type: 'mc', uvScale: 16,
    textures: [{ name: 'edit', url: 'http://test/edit.png' }],
    elements: [{ faces: { north: { tex: 0, uv: [0, 0, 8, 8], rotation: 0, mirror: false } }, el: srcEl }],
  }
  return { srcEl, layout }
}

async function setupEdit() {
  const { srcEl, layout } = freshEditLayout()
  globalThis.__uvTestActive = true
  globalThis.__uvTestLayout = layout
  globalThis.__uvEditCalls = []
  globalThis.__uvHlCalls = []
  uv.refreshUvView()
  fw.open()
  await sleep(30)
  const wrap = fw.body.children[0]
  const toolbar = wrap.children[0]
  const canvasWrap = wrap.children[1]
  const canvas = canvasWrap.children[0]
  /* toolbar: 0 chips / 1 zoomSeg / 2 grid / 3 edit / 4 upload / 5 library / 6 export / 7 template / 8 editBar */
  const editBtn = toolbar.children[3]
  const exportBtn = toolbar.children[6]
  const templateBtn = toolbar.children[7]
  const editBar = toolbar.children[8]
  if (/active/.test(editBtn.className)) editBtn.click()   /* 归位：确保从关到开 */
  await sleep(10)
  if (!/active/.test(editBtn.className)) editBtn.click()
  await sleep(30)
  return { srcEl, layout, wrap, toolbar, canvasWrap, canvas, editBtn, exportBtn, templateBtn, editBar }
}

function fire(el, type, ev) {
  ;(el.listeners[type] || []).forEach(fn => fn(ev))
}

test('编辑模式：开启 → editBar 显示 + crosshair 光标', async () => {
  const { canvas, editBar } = await setupEdit()
  assert.match(editBar.className, /show/, '编辑工具条显示')
  assert.equal(canvas.style.cursor, 'crosshair', '编辑光标')
})

test('编辑：拖拽移动 UV → face.uv 更新 + 3D 联动调用 + element 写回', async () => {
  const { srcEl, layout, canvas } = await setupEdit()
  /* north uv [0,0,8,8] px=11 → rect (0,0,88,88)：down(10,10) → move(21,21) = +1 贴图像素 */
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointermove', { pointerId: 1, clientX: 21, clientY: 21, altKey: false })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 21, clientY: 21 })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [1, 1, 9, 9], 'layout face UV 平移')
  assert.deepEqual(srcEl.faces.north.uv, [1, 1, 9, 9], '原始 element 同步写回（引用共享）')
  const call = (globalThis.__uvEditCalls || []).find(c => c.fn === 'uv')
  assert.ok(call, '3D 联动函数被调用')
  assert.equal(call.el, srcEl)
  assert.equal(call.key, 'north')
  assert.deepEqual(call.uv, [1, 1, 9, 9])
})

test('编辑：se 手柄缩放 → UV 边界调整', async () => {
  const { layout, canvas } = await setupEdit()
  /* 选中面：down/up（无移动）→ draw 填充手柄；se 手柄 (88,88) → 拖到 (99,99) */
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 })
  await sleep(30)
  fire(canvas, 'pointerdown', { pointerId: 2, clientX: 88, clientY: 88 })
  fire(canvas, 'pointermove', { pointerId: 2, clientX: 99, clientY: 99, altKey: false })
  fire(canvas, 'pointerup', { pointerId: 2, clientX: 99, clientY: 99 })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [0, 0, 9, 9], '右下角扩到 9×9')
})

test('编辑：旋转 / 镜像按钮 → face 更新 + 3D 联动', async () => {
  const { srcEl, layout, canvas, editBar } = await setupEdit()
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 })
  await sleep(30)
  /* editBar: 0 label / 1-4 uv 输入 / 5 旋转 / 6 镜像 / 7 重制 / 8 撤销 / 9 重做 / 10 重置 / 11 提示 */
  const rotBtn = editBar.children[5]
  const mirrorBtn = editBar.children[6]
  rotBtn.click()
  await sleep(10)
  assert.equal(layout.elements[0].faces.north.rotation, 90, '旋转 +90°')
  assert.equal(srcEl.faces.north.rotation, 90, 'element 写回')
  assert.ok((globalThis.__uvEditCalls || []).some(c => c.fn === 'rot' && c.rotation === 90), '3D 旋转联动')
  mirrorBtn.click()
  await sleep(10)
  assert.deepEqual(layout.elements[0].faces.north.uv, [8, 0, 0, 8], '水平镜像（u1↔u2）')
  assert.equal(layout.elements[0].faces.north.mirror, true, 'mirror 标记')
})

test('编辑：Ctrl+Z 撤销 → 恢复编辑前 UV', async () => {
  const { layout, canvas } = await setupEdit()
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointermove', { pointerId: 1, clientX: 21, clientY: 21, altKey: false })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 21, clientY: 21 })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [1, 1, 9, 9])
  ;(winListeners.get('keydown') || []).forEach(fn => fn({ ctrlKey: true, key: 'z', target: { tagName: 'CANVAS' }, preventDefault() {} }))
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [0, 0, 8, 8], '撤销恢复原始 UV')
  assert.deepEqual(freshEditLayout().srcEl.faces.north.uv, [0, 0, 8, 8], '（对照）新构造不受影响')
})

test('编辑：拖放图片 → 自定义贴图替换（dataURL + 3D 换图调用）', async () => {
  const realFileReader = globalThis.FileReader
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = 'data:image/png;base64,TEST'
      setTimeout(() => this.onload && this.onload({ target: { result: this.result } }), 0)
    }
  }
  const { layout, canvasWrap } = await setupEdit()
  fire(canvasWrap, 'drop', { preventDefault() {}, dataTransfer: { files: [{ name: 'my.png', type: 'image/png' }] } })
  await sleep(30)
  assert.equal(layout.textures[0].url, 'data:image/png;base64,TEST', '贴图 URL 替换为 dataURL')
  assert.equal(layout.textures[0].name, 'my', '名称取文件名（去扩展）')
  assert.ok(!layout.textures[0].mcmetaUrl, 'mcmeta 引用清除')
  assert.ok((globalThis.__uvEditCalls || []).some(c => c.fn === 'tex' && c.texIndex === 0 && c.dataUrl === 'data:image/png;base64,TEST'), '3D 贴图替换调用')
  globalThis.FileReader = realFileReader
})

test('编辑：资产库贴图拖入 → raw URL 直接替换当前槽位（3D 换图联动）', async () => {
  const { layout, canvasWrap } = await setupEdit()
  const rawUrl = '/api/file/raw?path=/packs/stone.png'
  fire(canvasWrap, 'drop', {
    preventDefault() {},
    dataTransfer: {
      getData: (type) => type === 'text/matoga-tex'
        ? JSON.stringify({ name: 'stone.png', url: rawUrl, path: '/packs/stone.png' })
        : '',
    },
  })
  await sleep(30)
  assert.equal(layout.textures[0].url, rawUrl, '贴图 URL 替换为资产库 raw URL')
  assert.equal(layout.textures[0].name, 'stone', '名称取贴图文件名（去扩展）')
  assert.ok(!layout.textures[0].mcmetaUrl, 'mcmeta 引用清除')
  assert.ok((globalThis.__uvEditCalls || []).some(c => c.fn === 'tex' && c.texIndex === 0 && c.dataUrl === rawUrl), '3D 贴图替换调用（raw URL 形式）')
})

test('编辑：右键贴图 chip → 移除材质（URL 清空 + 3D 清除材质调用 + 槽位索引不变）', async () => {
  const { layout, toolbar } = await setupEdit()
  const chips = toolbar.children[0]
  fire(chips.children[0], 'contextmenu', { preventDefault() {} })
  await sleep(30)
  assert.equal(layout.textures[0].url, '', '贴图槽位 URL 清空')
  assert.ok(!layout.textures[0].mcmetaUrl, 'mcmeta 引用清除')
  assert.equal(layout.textures.length, 1, '槽位本身不删除（face.tex 索引不变）')
  assert.ok((globalThis.__uvEditCalls || []).some(c => c.fn === 'clear' && c.texIndex === 0), '3D 材质清除调用（空串 → clearModelTexture）')
  const rebuilt = toolbar.children[0]
  assert.match(rebuilt.children[0].textContent, /⊘/, 'chip 显示移除标记 ⊘')
})

test('编辑：移除材质后拖入贴图 → 槽位恢复（再上传/贴图库选择同理）', async () => {
  const { layout, toolbar, canvasWrap } = await setupEdit()
  fire(toolbar.children[0].children[0], 'contextmenu', { preventDefault() {} })
  await sleep(30)
  assert.equal(layout.textures[0].url, '', '移除后 URL 为空')
  const rawUrl = '/api/mc-packs/vanilla/raw?path=stone.png'
  fire(canvasWrap, 'drop', {
    preventDefault() {},
    dataTransfer: {
      getData: (type) => type === 'text/matoga-tex'
        ? JSON.stringify({ name: 'stone.png', url: rawUrl })
        : '',
    },
  })
  await sleep(30)
  assert.equal(layout.textures[0].url, rawUrl, '拖入贴图恢复槽位 URL')
  assert.equal(layout.textures[0].name, 'stone', '名称恢复')
  assert.ok((globalThis.__uvEditCalls || []).some(c => c.fn === 'tex' && c.texIndex === 0 && c.dataUrl === rawUrl), '恢复触发 3D 换图')
  assert.ok(!/⊘/.test(toolbar.children[0].children[0].textContent), 'chip 移除标记消失')
})

test('贴图拖拽工具：setTexDragData / getTexDragData 往返 + 容错', () => {
  const mkDt = () => {
    const store = new Map()
    return {
      setData: (k, v) => store.set(k, String(v)),
      getData: (k) => store.has(k) ? store.get(k) : '',
    }
  }
  const dt = mkDt()
  assert.equal(utils.setTexDragData(dt, { name: 'a.png', url: '/api/x.png', path: 'p' }), true, '写入成功')
  assert.deepEqual(utils.getTexDragData(dt), { name: 'a.png', url: '/api/x.png', path: 'p', normal: '', specular: '' }, '读回一致')
  assert.equal(utils.setTexDragData(null, { url: '/x' }), false, '无 dataTransfer 安全返回')
  assert.equal(utils.setTexDragData(dt, { name: 'x' }), false, '无 url 不写入')
  assert.equal(utils.getTexDragData(dt).name, 'a.png', '无效写入不覆盖既有数据')
  assert.equal(utils.getTexDragData({ getData: () => 'not json' }), null, '损坏 JSON → null')
  assert.equal(utils.getTexDragData({ getData: () => JSON.stringify({ name: 'x' }) }), null, '缺 url → null')
  assert.equal(utils.getTexDragData({ getData: () => '' }), null, '空数据 → null')
  assert.equal(utils.getTexDragData(null), null, '无 dataTransfer → null')
})

test('编辑：拖放多张图片 → 从当前贴图槽位起顺序替换（超出槽位忽略）', async () => {
  const realFileReader = globalThis.FileReader
  let seq = 0
  globalThis.FileReader = class {
    readAsDataURL() {
      seq++
      this.result = 'data:image/png;base64,M' + seq
      setTimeout(() => this.onload && this.onload({ target: { result: this.result } }), 0)
    }
  }
  const layout = {
    type: 'mc', uvScale: 16,
    textures: [
      { name: 'a', url: 'http://test/a.png' },
      { name: 'b', url: 'http://test/b.png' },
      { name: 'c', url: 'http://test/c.png' },
    ],
    elements: [
      { faces: { north: { tex: 0, uv: [0, 0, 8, 8], rotation: 0, mirror: false } } },
      { faces: { up: { tex: 2, uv: [0, 0, 16, 16], rotation: 0, mirror: false } } },
    ],
  }
  globalThis.__uvTestActive = true
  globalThis.__uvTestLayout = layout
  globalThis.__uvEditCalls = []
  uv.refreshUvView()
  fw.open()
  await sleep(30)
  const wrap = fw.body.children[0]
  const canvasWrap = wrap.children[1]
  fire(canvasWrap, 'drop', { preventDefault() {}, dataTransfer: { files: [
    { name: 'x.png', type: 'image/png' },
    { name: 'y.png', type: 'image/png' },
    { name: 'z.png', type: 'image/png' },
    { name: 'extra.png', type: 'image/png' },
    { name: 'skip.txt', type: 'text/plain' },
  ] } })
  await sleep(80)
  assert.equal(layout.textures[0].url, 'data:image/png;base64,M1', '槽位 0 替换')
  assert.equal(layout.textures[1].url, 'data:image/png;base64,M2', '槽位 1 替换')
  assert.equal(layout.textures[2].url, 'data:image/png;base64,M3', '槽位 2 替换')
  assert.equal(layout.textures.length, 3, '不新增贴图槽位')
  assert.equal(layout.textures[0].name, 'x', '名称取文件名（去扩展）')
  const texCalls = (globalThis.__uvEditCalls || []).filter(c => c.fn === 'tex')
  assert.equal(texCalls.length, 3, '3D 换图联动 3 次（extra 超槽位 / txt 非图片被忽略）')
  assert.ok(texCalls.some(c => c.texIndex === 1 && c.dataUrl === 'data:image/png;base64,M2'), '槽位索引正确传递')
  globalThis.FileReader = realFileReader
})

test('贴图库按钮 → 选择器浮窗 → 选择贴图替换当前槽位（raw URL + 3D 联动）', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        packs: [{
          source: 'official', name: 'vanilla', kind: 'zip',
          groups: [{ key: 'block', files: [{ name: 'stone.png', path: 'block/stone.png' }] }],
        }],
      },
    }),
  })
  const { layout, toolbar } = await setupEdit()
  const libraryBtn = toolbar.children[5]
  assert.ok(libraryBtn, '贴图库按钮存在（upload 之后）')
  assert.match(libraryBtn.textContent, /贴图库|library|uv\.library/i)
  libraryBtn.click()
  await sleep(120)   /* 动态 import uv-tex-picker + fetch 贴图包 + 渲染网格 */

  const pickerDom = bodyEl.children.find(c => c.dataset && c.dataset.fwId === 'uvTexPicker')
  assert.ok(pickerDom, '选择器浮窗创建并挂载 body')
  const pickerWin = fwMod.getWindow('uvTexPicker')
  assert.ok(pickerWin, '选择器浮窗 api 可获取')
  const pwrap = pickerWin.body.children[0]
  const gridWrap = pwrap.children[1]           /* 0 toolbar / 1 gridWrap */
  const cells = gridWrap.children[0].children  /* gridWrap: 0 gridEl / 1 empty / 2 moreBtn */
  assert.equal(cells.length, 1, '包内 1 张贴图渲染')
  cells[0].click()
  await sleep(30)

  assert.equal(layout.textures[0].url, '/api/mc-official/vanilla/raw?path=' + encodeURIComponent('block/stone.png'), '槽位替换为贴图库 raw URL')
  assert.equal(layout.textures[0].name, 'stone', '名称取贴图名（去扩展）')
  assert.ok(!layout.textures[0].mcmetaUrl, 'mcmeta 引用清除')
  assert.ok((globalThis.__uvEditCalls || []).some(c => c.fn === 'tex' && c.texIndex === 0 && c.dataUrl === layout.textures[0].url), '3D 换图联动调用（URL 形式）')
  globalThis.fetch = realFetch
})

test('编辑：导出按钮 → Blob 下载（URL.createObjectURL 调用）', async () => {
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  let created = 0
  URL.createObjectURL = () => { created++; return 'blob:test' }
  URL.revokeObjectURL = () => {}
  globalThis.__uvExportModel = { filename: 'x.json', json: { elements: [{ faces: {} }] } }
  const { exportBtn } = await setupEdit()
  exportBtn.click()
  await sleep(10)
  assert.equal(created, 1, '导出触发 Blob 下载')
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
  delete globalThis.__uvExportModel
})

test('编辑：sprite 布局 → 编辑模式拒绝（状态栏提示）', async () => {
  const SPRITE_LAYOUT = {
    type: 'mc', uvScale: 16, sprite: true,
    textures: [{ name: 'item/x', url: 'http://test/x.png' }],
    elements: [{ faces: { sprite: { tex: 0, uv: [0, 0, 16, 16], rotation: 0, mirror: false } }, el: null }],
  }
  globalThis.__uvTestActive = true
  globalThis.__uvTestLayout = SPRITE_LAYOUT
  uv.refreshUvView()
  fw.open()
  await sleep(30)
  const toolbar = fw.body.children[0].children[0]
  const editBtn = toolbar.children[3]
  const status = fw.body.children[0].children[2]
  if (/active/.test(editBtn.className)) editBtn.click()   /* 归位：关闭上个测试遗留的编辑态 */
  await sleep(10)
  editBtn.click()
  await sleep(10)
  assert.ok(!/active/.test(editBtn.className), 'sprite 不进入编辑模式')
  assert.match(status.textContent, /uv\.spriteNoEdit/, '状态栏提示')
})
/* ════════════════ 重做 / 重制 / 线框模板 ════════════════ */

function keydown(ev) {
  ;(winListeners.get('keydown') || []).forEach(fn => fn(Object.assign({ target: { tagName: 'CANVAS' }, preventDefault() {} }, ev)))
}

test('编辑：Ctrl+Shift+Z 重做 → 撤销后恢复编辑值', async () => {
  const { layout, canvas, editBar } = await setupEdit()
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointermove', { pointerId: 1, clientX: 21, clientY: 21, altKey: false })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 21, clientY: 21 })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [1, 1, 9, 9])
  const redoBtn = editBar.children[9]
  assert.equal(redoBtn.disabled, true, '初始重做禁用')
  keydown({ ctrlKey: true, key: 'z' })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [0, 0, 8, 8], '撤销')
  assert.equal(redoBtn.disabled, false, '撤销后重做可用')
  keydown({ ctrlKey: true, shiftKey: true, key: 'Z' })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [1, 1, 9, 9], 'Ctrl+Shift+Z 重做恢复')
  /* Ctrl+Y 等价：先撤销再重做 */
  keydown({ ctrlKey: true, key: 'z' })
  await sleep(30)
  keydown({ ctrlKey: true, key: 'y' })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [1, 1, 9, 9], 'Ctrl+Y 重做等价')
})

test('编辑：重做分叉 → 撤销后新编辑清空重做栈', async () => {
  const { layout, canvas, editBar } = await setupEdit()
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointermove', { pointerId: 1, clientX: 21, clientY: 21, altKey: false })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 21, clientY: 21 })
  await sleep(30)
  keydown({ ctrlKey: true, key: 'z' })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [0, 0, 8, 8])
  /* 撤销后做不同的编辑 → 重做历史失效 */
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointermove', { pointerId: 1, clientX: 32, clientY: 10, altKey: false })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 32, clientY: 10 })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [2, 0, 10, 8], '新编辑（+2, 0）')
  const redoBtn = editBar.children[9]
  assert.equal(redoBtn.disabled, true, '新编辑清空重做栈')
  keydown({ ctrlKey: true, shiftKey: true, key: 'Z' })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [2, 0, 10, 8], '重做无效果（栈已空）')
})

test('编辑：重制（Remake）→ 按元素尺寸重算默认 UV', async () => {
  const srcEl = { from: [2, 2, 2], to: [12, 12, 12], faces: { north: { texture: '#side', uv: [0, 0, 8, 8] } } }
  const layout = {
    type: 'mc', uvScale: 16,
    textures: [{ name: 'edit', url: 'http://test/edit.png' }],
    elements: [{ faces: { north: { tex: 0, uv: [0, 0, 8, 8], rotation: 0, mirror: false } }, el: srcEl }],
  }
  globalThis.__uvTestActive = true
  globalThis.__uvTestLayout = layout
  globalThis.__uvEditCalls = []
  uv.refreshUvView()
  fw.open()
  await sleep(30)
  const toolbar = fw.body.children[0].children[0]
  const editBtn = toolbar.children[3]
  const editBar = toolbar.children[8]
  if (/active/.test(editBtn.className)) editBtn.click()
  await sleep(10)
  if (!/active/.test(editBtn.className)) editBtn.click()
  await sleep(30)
  const canvas = fw.body.children[0].children[1].children[0]
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 })
  await sleep(30)
  const remakeBtn = editBar.children[7]
  remakeBtn.click()
  await sleep(10)
  /* north 默认 UV = [16-tx, 16-ty, 16-fx, 16-fy] = [4,4,14,14] */
  assert.deepEqual(layout.elements[0].faces.north.uv, [4, 4, 14, 14], 'vanilla 默认 UV 重算')
  assert.deepEqual(srcEl.faces.north.uv, [4, 4, 14, 14], '原始 element 写回')
  assert.ok((globalThis.__uvEditCalls || []).some(c => c.fn === 'uv' && JSON.stringify(c.uv) === JSON.stringify([4, 4, 14, 14])), '3D 联动调用')
  /* 重制可撤销 */
  keydown({ ctrlKey: true, key: 'z' })
  await sleep(30)
  assert.deepEqual(layout.elements[0].faces.north.uv, [0, 0, 8, 8], '重制可撤销')
})

test('编辑：重制兜底（无元素引用 / 面名不适用）→ 全幅 UV', async () => {
  const layout = {
    type: 'mc', uvScale: 16,
    textures: [{ name: 'edit', url: 'http://test/edit.png' }],
    elements: [{ faces: { north: { tex: 0, uv: [2, 2, 6, 6], rotation: 0, mirror: false } }, el: null }],
  }
  globalThis.__uvTestActive = true
  globalThis.__uvTestLayout = layout
  uv.refreshUvView()
  fw.open()
  await sleep(30)
  const toolbar = fw.body.children[0].children[0]
  const editBtn = toolbar.children[3]
  const editBar = toolbar.children[8]
  if (/active/.test(editBtn.className)) editBtn.click()
  await sleep(10)
  if (!/active/.test(editBtn.className)) editBtn.click()
  await sleep(30)
  const canvas = fw.body.children[0].children[1].children[0]
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 30, clientY: 30 })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 30, clientY: 30 })
  await sleep(30)
  const remakeBtn = editBar.children[7]
  remakeBtn.click()
  await sleep(10)
  assert.deepEqual(layout.elements[0].faces.north.uv, [0, 0, 16, 16], '无引用 → 全幅兜底')
})

test('UV 线框模板导出：toBlob 生成 PNG 下载', async () => {
  const realCreate = globalThis.document.createElement
  const blobs = []
  globalThis.document.createElement = (tag) => {
    const e = realCreate.call(globalThis.document, tag)
    if (tag === 'canvas') {
      e.toBlob = (cb) => { blobs.push('png'); cb({ size: 42 }) }
    }
    return e
  }
  const realCreateURL = URL.createObjectURL
  URL.createObjectURL = () => 'blob:tpl'
  URL.revokeObjectURL = () => {}
  const { templateBtn } = await setupEdit()
  templateBtn.click()
  await sleep(20)
  assert.equal(blobs.length, 1, '离屏画布 toBlob 调用（PNG）')
  globalThis.document.createElement = realCreate
  URL.createObjectURL = realCreateURL
})

test('编辑：撤销/重做按钮禁用态随历史同步', async () => {
  const { canvas, editBar } = await setupEdit()
  const undoBtn = editBar.children[8]
  const redoBtn = editBar.children[9]
  assert.equal(undoBtn.disabled, true, '初始撤销禁用')
  assert.equal(redoBtn.disabled, true, '初始重做禁用')
  fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
  fire(canvas, 'pointermove', { pointerId: 1, clientX: 21, clientY: 21, altKey: false })
  fire(canvas, 'pointerup', { pointerId: 1, clientX: 21, clientY: 21 })
  await sleep(30)
  assert.equal(undoBtn.disabled, false, '编辑后撤销可用')
  keydown({ ctrlKey: true, key: 'z' })
  await sleep(30)
  assert.equal(undoBtn.disabled, true, '撤销后撤销禁用')
  assert.equal(redoBtn.disabled, false, '撤销后重做可用')
  keydown({ ctrlKey: true, shiftKey: true, key: 'Z' })
  await sleep(30)
  assert.equal(undoBtn.disabled, false, '重做后撤销可用')
  assert.equal(redoBtn.disabled, true, '重做后重做禁用')
})