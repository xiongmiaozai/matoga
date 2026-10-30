/**
 * matoga - 前端模块引用审计
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 静态检查 web/ 下所有 ESM 文件：函数体内用到、但在本文件既未 import 也
 * 未声明的标识符。专治「拆分后子模块漏 import，单测不覆盖、只有浏览器
 * 运行到该路径才报 ReferenceError」的问题。
 *
 * 用法：node scripts/audit-web-refs.mjs [--verbose]
 */

import fs from 'node:fs'
import path from 'node:path'

const VERBOSE = process.argv.includes('--verbose')

// JS 内置全局 + 浏览器 API（不在本清单里的自由标识符才算可疑）
const GLOBALS = new Set([
  'console', 'Math', 'Array', 'Object', 'String', 'Number', 'Boolean', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'Date', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'RegExp', 'parseInt',
  'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'queueMicrotask', 'structuredClone', 'document', 'window', 'globalThis', 'self',
  'fetch', 'Image', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FileList', 'FormData', 'Headers',
  'Request', 'Response', 'AbortController', 'AbortSignal', 'WebSocket', 'Worker', 'SharedWorker',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'PerformanceObserver', 'HTMLElement', 'Element',
  'Node', 'NodeList', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent',
  'WheelEvent', 'DragEvent', 'TouchEvent', 'InputEvent', 'FocusEvent', 'CompositionEvent', 'ClipboardEvent',
  'HTMLCanvasElement', 'HTMLImageElement', 'HTMLInputElement', 'HTMLDivElement', 'HTMLSpanElement',
  'HTMLButtonElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLAnchorElement', 'HTMLTemplateElement',
  'CanvasRenderingContext2D', 'ImageData', 'ImageBitmap', 'Path2D', 'OffscreenCanvas', 'createImageBitmap',
  'WebGLRenderingContext', 'NaN', 'Infinity', 'undefined', 'null', 'true', 'false', 'NaN',
  'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'BigInt', 'Symbol', 'Proxy', 'Reflect', 'Intl',
  'atob', 'btoa', 'alert', 'confirm', 'prompt', 'performance', 'navigator', 'location', 'history', 'crypto',
  'localStorage', 'sessionStorage', 'indexedDB', 'matchMedia', 'getComputedStyle', 'TextEncoder', 'TextDecoder',
  'CSS', 'DOMParser', 'XMLSerializer', 'Audio', 'AudioContext', 'btoa', 'escape', 'unescape', 'reportError',
  'process', 'module', 'exports', 'require', '__dirname', '__filename', 'Buffer', 'AggregateError',
  'FinalizationRegistry', 'WeakRef', 'Atomics', 'SharedArrayBuffer', 'WebAssembly', 'importScripts',
  'THREE', 'GoldenLayout', 'LayoutConfig', 'PowerGlitch',
])

const ROOT = 'web'

const files = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'css', '.git'].includes(e.name)) continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) files.push(p)
  }
}
walk(ROOT)

// 全仓导出索引：name -> 定义文件（用于区分"别处有定义"与"根本不存在"）
const exported = new Map()
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  for (const m of t.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) exported.set(m[1], f)
  for (const m of t.matchAll(/^export\s*\{([^}]+)\}/gm)) for (const r of m[1].split(',')) { const n = r.trim().split(/\s+as\s+/).pop().trim(); if (n) exported.set(n, f) }
  for (const m of t.matchAll(/^export default\s+([A-Za-z_$][\w$]*)/gm)) exported.set(m[1], f)
}

const problems = []
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
  // 1) 收集 import 绑定
  const imported = new Set()
  for (const m of raw.matchAll(/^import\s+(?:\*\s+as\s+)?(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))/gm)) {
    if (m[1]) for (const r of m[1].split(',')) { const n = r.trim().split(/\s+as\s+/).pop().trim(); if (n) imported.add(n) }
    if (m[2]) imported.add(m[2])
  }
  for (const m of raw.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from/gm)) imported.add(m[1])

  // 2) 去注释与字符串内容（避免 'toast.xxx' 之类误报）
  const code = raw
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' ')      // 模板字符串整体替换
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')

  // 3) 本地声明
  const local = new Set()
  for (const m of code.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1])
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) for (const s of m[1].split(',')) { const n = s.trim().split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) local.add(n) }
  for (const m of code.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) local.add(m[1])
  for (const m of code.matchAll(/function\s*\w*\s*\(([^)]*)\)/g)) for (const s of m[1].split(',')) { const n = s.trim().split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) local.add(n) }
  for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) local.add(m[1])
  for (const m of code.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1])
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=/g)) for (const s of m[1].split(',')) { const n = s.trim().split(':')[0].split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) local.add(n) }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:function|\()/g)) local.add(m[1])  // 对象字面量方法

  // 4) 被当作函数/属性访问的标识符
  const used = new Set()
  for (const m of code.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*[.(]/g)) used.add(m[2])

  const missing = [...used].filter(u =>
    !imported.has(u) && !local.has(u) && !GLOBALS.has(u) && exported.has(u)
  )
  if (missing.length) problems.push({ file: f, missing: missing.sort() })
}

if (!problems.length) {
  console.log('>>> 未发现跨模块缺失引用 <<<')
  process.exit(0)
}
console.log(`发现 ${problems.length} 个文件存在跨模块缺失引用：\n`)
for (const p of problems) {
  console.log(`  ${p.file}`)
  console.log(`    ${p.missing.join(', ')}`)
  if (VERBOSE) for (const n of p.missing) console.log(`      ${n} 定义于 ${exported.get(n)}`)
}
process.exit(1)
