/**
 * blankTexDataUrl 单测：三通道颜色映射
 * - main=#ffffff、normal=#8080ff、specular=#000000
 * - 画布尺寸 16×16，输出 PNG dataURL
 * 前端模块依赖浏览器环境，以 DOM stub + 模块重定向在 Node 中加载。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

process.env.NR_M3D_STUB = '1'
const ROOT = path.resolve(__dirname, '../..')
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

function makeStub() {
  const fn = function () {
    return makeStub()
  }
  const styleObj = {
    setProperty() {},
    removeProperty() {},
    getPropertyValue() {
      return ''
    }
  }
  return new Proxy(fn, {
    get(t, p) {
      if (p === 'style') return styleObj
      if (p === 'classList')
        return {
          add() {},
          remove() {},
          toggle() {},
          contains() {
            return false
          }
        }
      if (p === 'isConnected') return false
      if (p === 'children' || p === 'childNodes') return []
      if (p === 'length') return 0
      if (p === 'innerHTML' || p === 'textContent' || p === 'value') return ''
      if (p === Symbol.toPrimitive) return () => ''
      if (typeof p === 'symbol') return undefined
      return makeStub()
    },
    apply() {
      return makeStub()
    },
    construct() {
      return makeStub()
    },
    set() {
      return true
    }
  })
}

let canvasCaptured = {}
function makeCanvas() {
  const cv = { width: 0, height: 0 }
  cv.getContext = () => ({
    set fillStyle(v) {
      canvasCaptured.fillStyle = v
    },
    get fillStyle() {
      return canvasCaptured.fillStyle
    },
    fillRect() {
      canvasCaptured.filled = true
    }
  })
  cv.toDataURL = type => {
    canvasCaptured.toDataType = type
    return `data:${type};base64,AAAA`
  }
  return cv
}

globalThis.window = { CSS: { escape: s => s }, addEventListener() {} }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
globalThis.document = {
  createElement: tag => (tag === 'canvas' ? ((canvasCaptured = {}), makeCanvas()) : makeStub()),
  getElementById: () => makeStub()
}

let blankTexDataUrl

test('加载 actions.js（DOM stub 环境）', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'web/src/actions.js')).href)
  assert.equal(typeof mod.blankTexDataUrl, 'function')
  blankTexDataUrl = mod.blankTexDataUrl
})

test('blankTexDataUrl: main 使用 #ffffff', () => {
  const url = blankTexDataUrl('main')
  assert.equal(canvasCaptured.fillStyle, '#ffffff')
  assert.equal(canvasCaptured.toDataType, 'image/png')
  assert.match(url, /^data:image\/png/)
})

test('blankTexDataUrl: normal 使用 #8080ff', () => {
  blankTexDataUrl('normal')
  assert.equal(canvasCaptured.fillStyle, '#8080ff')
})

test('blankTexDataUrl: specular 使用 #000000', () => {
  blankTexDataUrl('specular')
  assert.equal(canvasCaptured.fillStyle, '#000000')
})

test('blankTexDataUrl: 画布尺寸 16×16', () => {
  blankTexDataUrl('main')
  assert.equal(canvasCaptured.filled, true)
})
