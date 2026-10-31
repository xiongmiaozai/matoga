/**
 * matoga - 节点画布：节点类型定义
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-canvas.js 原样搬出（节点类型定义 + 噪波纹理输出两段），逻辑未改。
 *
 * 两段必须同模块：NODE_DEFS 的 eval 调用 _noiseTexUrl，后者需要 state 与 evaluate。
 * 通过 setTexHooks 注入，避免子模块反向 import 主文件形成循环依赖。
 */

import { _psNode } from './ps-blend.js'
import {
  _noiseValue, _noisePvCache, _NOISE_TEX_SIZE, _noisePreviewUrl, _paletteRGB
} from './noise.js'
import {
  _texAvgColor, _texAlpha, _rgbaIn, _rgbaMerge, _rgbaSplit, _rgbAlphaSplit
} from './texture.js'
import { num, clamp, _texUrl, col, _smoothstep, _lerp } from './math.js'
import {
  numWidget, colorWidget, vecWidget, textureWidget, rgbaMergeWidget, rgbaSplitWidget,
  rgbAlphaSplitWidget, selectWidget, previewWidget, noiseWidget, voronoiWidget, whiteWidget,
  cellWidget, pingpongWidget, voronoiseWidget, reactionWidget, lightningWidget, mandelWidget,
  paletteWidget, gradientWidget, warpWidget
} from './widgets.js'

/* 主文件注入：state 与 evaluate 属于主文件状态机 */
let _state = { nodes: new Map() }
let _evaluate = () => {}
export function setTexHooks(hooks) {
  if (hooks && hooks.state) _state = hooks.state
  if (hooks && typeof hooks.evaluate === 'function') _evaluate = hooks.evaluate
}

/* ── 节点类型定义 ───────────────────────────── */
function _noiseNode(o) {
  const def = { title: o.title, group: o.group }
  if (o.subgroup !== undefined) def.subgroup = o.subgroup
  def.color = 'var(--type-number)'
  def.inputs = [{ n: 'uv', t: 'vector' }]
  def.outputs = [
    { n: 'out', t: 'number' },
    { n: 'tex', t: 'texture' }
  ]
  def.widget = n => o.widget(n)
  def.eval = (i, n) => {
    const uv = Array.isArray(i.uv) ? i.uv : [0.5, 0.5]
    return { out: _noiseValue(o.type, uv[0], uv[1], n.props), tex: _noiseTexUrl(n) }
  }
  return def
}
export const NODE_DEFS = {
  // 输入
  number: {
    title: '数值',
    group: '输入',
    color: 'var(--type-number)',
    inputs: [],
    outputs: [{ n: 'value', t: 'number' }],
    widget: n => numWidget(n, 'value', 0, 1, 0.01),
    eval: () => null
  },
  color: {
    title: '颜色',
    group: '输入',
    color: 'var(--type-color)',
    inputs: [],
    outputs: [{ n: 'color', t: 'color' }],
    widget: n => colorWidget(n, 'color'),
    eval: () => null
  },
  texture: {
    title: '纹理',
    group: '输入',
    color: 'var(--type-texture)',
    inputs: [],
    outputs: [{ n: 'tex', t: 'texture' }],
    widget: n => textureWidget(n, 'tex'),
    eval: () => null
  },
  vector2: {
    title: '向量2',
    group: '输入',
    color: 'var(--type-vector)',
    inputs: [],
    outputs: [{ n: 'v', t: 'vector' }],
    widget: n => vecWidget(n, ['x', 'y'], 0, 1, 0.01),
    eval: () => null
  },

  // 运算
  add: {
    title: '加法 (a+b)',
    group: '运算',
    color: 'var(--type-number)',
    inputs: [
      { n: 'a', t: 'number' },
      { n: 'b', t: 'number' }
    ],
    outputs: [{ n: 'out', t: 'number' }],
    eval: i => ({ out: num(i.a) + num(i.b) })
  },
  sub: {
    title: '减法 (a-b)',
    group: '运算',
    color: 'var(--type-number)',
    inputs: [
      { n: 'a', t: 'number' },
      { n: 'b', t: 'number' }
    ],
    outputs: [{ n: 'out', t: 'number' }],
    eval: i => ({ out: num(i.a) - num(i.b) })
  },
  mul: {
    title: '乘法 (a×b)',
    group: '运算',
    color: 'var(--type-number)',
    inputs: [
      { n: 'a', t: 'number' },
      { n: 'b', t: 'number' }
    ],
    outputs: [{ n: 'out', t: 'number' }],
    eval: i => ({ out: num(i.a) * num(i.b) })
  },
  div: {
    title: '除法 (a÷b)',
    group: '运算',
    color: 'var(--type-number)',
    inputs: [
      { n: 'a', t: 'number' },
      { n: 'b', t: 'number' }
    ],
    outputs: [{ n: 'out', t: 'number' }],
    eval: i => ({ out: num(i.b) === 0 ? 0 : num(i.a) / num(i.b) })
  },
  mix: {
    title: '混合 mix(a,b,t)',
    group: '运算',
    color: 'var(--type-number)',
    inputs: [
      { n: 'a', t: 'number' },
      { n: 'b', t: 'number' },
      { n: 't', t: 'number' }
    ],
    outputs: [{ n: 'out', t: 'number' }],
    eval: i => {
      const t = clamp(num(i.t), 0, 1)
      return { out: num(i.a) * (1 - t) + num(i.b) * t }
    }
  },
  clamp: {
    title: '钳制',
    group: '运算',
    color: 'var(--type-number)',
    inputs: [
      { n: 'v', t: 'number' },
      { n: 'min', t: 'number' },
      { n: 'max', t: 'number' }
    ],
    outputs: [{ n: 'out', t: 'number' }],
    eval: i => ({ out: clamp(num(i.v), num(i.min), num(i.max)) })
  },
  colorMix: {
    title: '颜色混合',
    group: '运算',
    color: 'var(--type-color)',
    inputs: [
      { n: 'a', t: 'color' },
      { n: 'b', t: 'color' },
      { n: 't', t: 'number' }
    ],
    outputs: [{ n: 'out', t: 'color' }],
    eval: i => {
      const t = clamp(num(i.t), 0, 1)
      const a = col(i.a),
        b = col(i.b)
      return { out: [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t] }
    }
  },

  // PS 混合模式（27 种，按 PS 官方分类拆为 6 子组：基础/变暗/变亮/对比度/比较/颜色）
  blendNormal: _psNode('正常', 'normal', '基础'),
  blendDissolve: _psNode('溶解', 'dissolve', '基础'),
  blendDarken: _psNode('变暗', 'darken', '变暗'),
  blendMultiply: _psNode('正片叠底', 'multiply', '变暗'),
  blendColorBurn: _psNode('颜色加深', 'colorBurn', '变暗'),
  blendLinearBurn: _psNode('线性加深', 'linearBurn', '变暗'),
  blendDarkerColor: _psNode('深色', 'darkerColor', '变暗'),
  blendLighten: _psNode('变亮', 'lighten', '变亮'),
  blendScreen: _psNode('滤色', 'screen', '变亮'),
  blendColorDodge: _psNode('颜色减淡', 'colorDodge', '变亮'),
  blendLinearDodge: _psNode('线性减淡', 'linearDodge', '变亮'),
  blendLighterColor: _psNode('浅色', 'lighterColor', '变亮'),
  blendOverlay: _psNode('叠加', 'overlay', '对比度'),
  blendSoftLight: _psNode('柔光', 'softLight', '对比度'),
  blendHardLight: _psNode('强光', 'hardLight', '对比度'),
  blendVividLight: _psNode('亮光', 'vividLight', '对比度'),
  blendLinearLight: _psNode('线性光', 'linearLight', '对比度'),
  blendPinLight: _psNode('点光', 'pinLight', '对比度'),
  blendHardMix: _psNode('实色混合', 'hardMix', '对比度'),
  blendDifference: _psNode('差值', 'difference', '比较'),
  blendExclusion: _psNode('排除', 'exclusion', '比较'),
  blendSubtract: _psNode('减去', 'subtract', '比较'),
  blendDivide: _psNode('划分', 'divide', '比较'),
  blendHue: _psNode('色相', 'hue', '颜色'),
  blendSaturation: _psNode('饱和度', 'saturation', '颜色'),
  blendColor: _psNode('颜色', 'blendColor', '颜色'),
  blendLuminosity: _psNode('明度', 'luminosity', '颜色'),

  // 材质
  mainTex: {
    title: '主图',
    group: '材质',
    subgroup: '采样',
    color: 'var(--type-texture)',
    inputs: [],
    outputs: [
      { n: 'color', t: 'color' },
      { n: 'alpha', t: 'number' },
      { n: 'tex', t: 'texture' }
    ],
    widget: n => textureWidget(n, 'tex'),
    eval: (i, n) => {
      const url = n.props.tex || ''
      return { color: url ? _texAvgColor(url) : [0.6, 0.6, 0.6], alpha: url ? _texAlpha(url) : 1, tex: url || null }
    }
  },

  sample: {
    title: '贴图采样',
    group: '材质',
    subgroup: '采样',
    color: 'var(--type-texture)',
    inputs: [
      { n: 'tex', t: 'texture' },
      { n: 'uv', t: 'vector' }
    ],
    outputs: [{ n: 'color', t: 'color' }],
    eval: i => {
      if (typeof i.tex === 'string' && i.tex) return { color: _texAvgColor(i.tex) }
      if (Array.isArray(i.tex) && i.tex.length >= 3) return { color: [i.tex[0], i.tex[1], i.tex[2]] }
      return { color: [0.5, 0.5, 0.5] }
    }
  },
  hdr: {
    title: 'HDR 环境',
    group: '材质',
    subgroup: '环境',
    color: 'var(--type-env)',
    inputs: [],
    outputs: [{ n: 'env', t: 'environment' }],
    widget: n => selectWidget(n, 'preset', ['studio', 'forest', 'sunset', 'night', 'courtyard']),
    eval: () => null
  },
  normalMap: {
    title: '法线生成',
    group: '材质',
    subgroup: '采样',
    color: 'var(--type-texture)',
    inputs: [
      { n: 'tex', t: 'texture' },
      { n: 'strength', t: 'number' }
    ],
    outputs: [{ n: 'normal', t: 'texture' }],
    eval: i => {
      const tex = i.tex || null
      const strength = clamp(num(i.strength), 0, 2)
      return { normal: tex ? { src: tex, strength } : null }
    }
  },
  rgbaMerge: {
    title: 'RGBA 合并',
    group: '材质',
    subgroup: '通道',
    color: 'var(--type-texture)',
    inputs: [
      { n: 'r', t: 'any' },
      { n: 'g', t: 'any' },
      { n: 'b', t: 'any' },
      { n: 'a', t: 'any' }
    ],
    outputs: [{ n: 'tex', t: 'texture' }],
    widget: n => rgbaMergeWidget(n),
    eval: (i, n) => {
      const size = Math.max(16, Math.round(+(n.props.size ?? 256) || 256))
      const rr = _rgbaIn(i.r, n.props.r, 0)
      const gg = _rgbaIn(i.g, n.props.g, 1)
      const bb = _rgbaIn(i.b, n.props.b, 2)
      const aa = _rgbaIn(i.a, n.props.a, 3)
      const url = _rgbaMerge(rr, gg, bb, aa, size)
      n._rgbaUrl = url || null
      return { tex: url || null }
    }
  },
  rgbaSplit: {
    title: 'RGBA 拆分',
    group: '材质',
    subgroup: '通道',
    color: 'var(--type-texture)',
    inputs: [{ n: 'tex', t: 'texture' }],
    outputs: [
      { n: 'r', t: 'texture' },
      { n: 'g', t: 'texture' },
      { n: 'b', t: 'texture' },
      { n: 'a', t: 'texture' }
    ],
    widget: n => rgbaSplitWidget(n),
    eval: (i, n) => {
      const url = _texUrl(i.tex)
      const parts = url ? _rgbaSplit(url) : null
      n._rgbaParts = parts || null
      return parts
        ? { r: parts.r || null, g: parts.g || null, b: parts.b || null, a: parts.a || null }
        : { r: null, g: null, b: null, a: null }
    }
  },
  rgbAlphaSplit: {
    title: 'RGB+A 拆分',
    group: '材质',
    subgroup: '通道',
    color: 'var(--type-texture)',
    inputs: [{ n: 'tex', t: 'texture' }],
    outputs: [
      { n: 'rgb', t: 'texture' },
      { n: 'alpha', t: 'texture' }
    ],
    widget: n => rgbAlphaSplitWidget(n),
    eval: (i, n) => {
      const url = _texUrl(i.tex)
      const parts = url ? _rgbAlphaSplit(url) : null
      n._rgbAlphaParts = parts || null
      return parts ? { rgb: parts.rgb || null, alpha: parts.alpha || null } : { rgb: null, alpha: null }
    }
  },

  // 程序化纹理
  noise: _noiseNode({ type: 'noise', title: '噪声 (Perlin)', group: '纹理', subgroup: '基础', widget: noiseWidget }),
  voronoi: _noiseNode({ type: 'voronoi', title: 'Voronoi', group: '纹理', subgroup: '其他', widget: voronoiWidget }),
  gradient: {
    title: '渐变',
    group: '纹理',
    subgroup: '其他',
    color: 'var(--type-color)',
    inputs: [
      { n: 'colorA', t: 'color' },
      { n: 'colorB', t: 'color' },
      { n: 't', t: 'number' }
    ],
    outputs: [{ n: 'out', t: 'color' }],
    widget: n => gradientWidget(n),
    eval: (i, n) => {
      const t = clamp(num(i.t), 0, 1)
      const mode = n.props.mode ?? 'linear'
      let tt = t
      if (mode === 'smooth') tt = _smoothstep(t)
      else if (mode === 'ease') tt = t * t * (3 - 2 * t)
      const a = col(i.colorA),
        b = col(i.colorB)
      return { out: [_lerp(a[0], b[0], tt), _lerp(a[1], b[1], tt), _lerp(a[2], b[2], tt)] }
    }
  },
  simplex: _noiseNode({ type: 'simplex', title: 'Simplex 噪声', group: '纹理', subgroup: '基础', widget: noiseWidget }),
  ridge: _noiseNode({ type: 'ridge', title: '山脊噪声', group: '纹理', subgroup: '分形', widget: noiseWidget }),
  warp: _noiseNode({ type: 'warp', title: '域扭曲', group: '纹理', subgroup: '扭曲', widget: warpWidget }),
  white: _noiseNode({ type: 'white', title: '白噪 (White)', group: '纹理', subgroup: '基础', widget: whiteWidget }),
  cell: _noiseNode({ type: 'cell', title: '格子 (Cell)', group: '纹理', subgroup: '其他', widget: cellWidget }),
  billow: _noiseNode({
    type: 'billow',
    title: '絮状噪声 (Billow)',
    group: '纹理',
    subgroup: '分形',
    widget: noiseWidget
  }),
  cubic: _noiseNode({ type: 'cubic', title: '三次值噪 (Cubic)', group: '纹理', subgroup: '基础', widget: noiseWidget }),
  pingpong: _noiseNode({
    type: 'pingpong',
    title: '乒乓噪声 (PingPong)',
    group: '纹理',
    subgroup: '分形',
    widget: pingpongWidget
  }),
  voronoise: _noiseNode({
    type: 'voronoise',
    title: '超模式 (Voronoise)',
    group: '纹理',
    subgroup: '分形',
    widget: voronoiseWidget
  }),
  reaction: _noiseNode({ type: 'reaction', title: '反应扩散 (Reaction)', group: '特效', widget: reactionWidget }),
  lightning: _noiseNode({ type: 'lightning', title: '闪电 (Lightning)', group: '特效', widget: lightningWidget }),
  mandel: _noiseNode({ type: 'mandel', title: '分形陷阱 (Mandel)', group: '特效', widget: mandelWidget }),
  palette: {
    title: '余弦调色板 (Palette)',
    group: '特效',
    color: 'var(--type-color)',
    inputs: [{ n: 't', t: 'number' }],
    outputs: [
      { n: 'color', t: 'color' },
      { n: 'tex', t: 'texture' }
    ],
    widget: n => paletteWidget(n),
    eval: (i, n) => {
      const t = i.t === undefined || i.t === null ? 0.5 : clamp(num(i.t), 0, 1)
      const rgb = _paletteRGB(t, n.props.preset, n.props.freq, n.props.phase)
      return { color: rgb, tex: _noiseTexUrl(n) }
    }
  },

  // 输出（hidden：不显示在节点库/添加菜单，仅供程序内部创建）
  preview: {
    title: '预览',
    group: '输出',
    color: 'var(--primary)',
    hidden: true,
    inputs: [{ n: 'in', t: 'any' }],
    outputs: [],
    widget: n => previewWidget(n, 'in'),
    eval: () => null
  },
  output: {
    title: '主输出',
    group: '输出',
    color: 'var(--primary)',
    hidden: true,
    inputs: [
      { n: 'baseColor', t: 'color' },
      { n: 'roughness', t: 'number' },
      { n: 'metallic', t: 'number' },
      { n: 'normal', t: 'texture' }
    ],
    outputs: [],
    widget: n => previewWidget(n, '__mat__'),
    eval: i => ({
      material: {
        baseColor: col(i.baseColor),
        roughness: clamp(num(i.roughness), 0, 1),
        metallic: clamp(num(i.metallic), 0, 1),
        normal: i.normal
      }
    })
  },
  outputLeft: {
    title: '左输出',
    group: '输出',
    color: '#2b6cff',
    hidden: true,
    inputs: [
      { n: 'baseColor', t: 'color' },
      { n: 'roughness', t: 'number' },
      { n: 'metallic', t: 'number' },
      { n: 'normal', t: 'texture' }
    ],
    outputs: [],
    widget: n => previewWidget(n, '__mat__'),
    eval: i => ({
      material: {
        baseColor: col(i.baseColor),
        roughness: clamp(num(i.roughness), 0, 1),
        metallic: clamp(num(i.metallic), 0, 1),
        normal: i.normal
      }
    })
  },
  outputRight: {
    title: '右输出',
    group: '输出',
    color: '#d97706',
    hidden: true,
    inputs: [
      { n: 'baseColor', t: 'color' },
      { n: 'roughness', t: 'number' },
      { n: 'metallic', t: 'number' },
      { n: 'normal', t: 'texture' }
    ],
    outputs: [],
    widget: n => previewWidget(n, '__mat__'),
    eval: i => ({
      material: {
        baseColor: col(i.baseColor),
        roughness: clamp(num(i.roughness), 0, 1),
        metallic: clamp(num(i.metallic), 0, 1),
        normal: i.normal
      }
    })
  },

  // 贴图输出节点（可从节点库添加；左/右对应 3D 预览两个球，直接驱动对应材质槽）
  // 输入端口 tex 接收 texture/mainTex/rgbaMerge/normalMap 节点的贴图链接（PNG dataURL，含 RGBA 通道）
  mainTexOutLeft: {
    title: '主贴图输出 (左)',
    group: '输出',
    color: '#2b6cff',
    inputs: [{ n: 'tex', t: 'texture' }],
    outputs: [],
    widget: n => previewWidget(n, 'tex'),
    eval: i => ({ mainTextureUrl: _texUrl(i.tex) })
  },
  mainTexOutRight: {
    title: '主贴图输出 (右)',
    group: '输出',
    color: '#d97706',
    inputs: [{ n: 'tex', t: 'texture' }],
    outputs: [],
    widget: n => previewWidget(n, 'tex'),
    eval: i => ({ mainTextureUrl: _texUrl(i.tex) })
  },
  normalOutLeft: {
    title: '法线输出 -n (左)',
    group: '输出',
    color: '#2b6cff',
    inputs: [{ n: 'tex', t: 'texture' }],
    outputs: [],
    widget: n => previewWidget(n, 'tex'),
    eval: i => {
      const out = { normalMapUrl: _texUrl(i.tex) }
      if (i.tex && typeof i.tex === 'object' && typeof i.tex.strength === 'number') out.normalScale = i.tex.strength
      return out
    }
  },
  normalOutRight: {
    title: '法线输出 -n (右)',
    group: '输出',
    color: '#d97706',
    inputs: [{ n: 'tex', t: 'texture' }],
    outputs: [],
    widget: n => previewWidget(n, 'tex'),
    eval: i => {
      const out = { normalMapUrl: _texUrl(i.tex) }
      if (i.tex && typeof i.tex === 'object' && typeof i.tex.strength === 'number') out.normalScale = i.tex.strength
      return out
    }
  },
  specOutLeft: {
    title: '高光输出 -s (左)',
    group: '输出',
    color: '#2b6cff',
    inputs: [{ n: 'tex', t: 'texture' }],
    outputs: [],
    widget: n => previewWidget(n, 'tex'),
    eval: i => ({ specTextureUrl: _texUrl(i.tex) })
  },
  specOutRight: {
    title: '高光输出 -s (右)',
    group: '输出',
    color: '#d97706',
    inputs: [{ n: 'tex', t: 'texture' }],
    outputs: [],
    widget: n => previewWidget(n, 'tex'),
    eval: i => ({ specTextureUrl: _texUrl(i.tex) })
  }
}


/* ── 噪波纹理输出（异步生成）────────────────
   eval 调用时不做 512² 采样+PNG 编码（~46ms 同步阻塞）：缓存命中或上次成功 URL 立即返回，
   miss 时入队（同节点去重，只保留最新 props），每帧后台处理一个，完成后 evaluate 刷新下游收敛。 */
const _texQueue = new Map()
let _texQueueRunning = false
export function _noiseTexUrl(node) {
  const key = JSON.stringify([node.type, node.props, _NOISE_TEX_SIZE])
  if (_noisePvCache.has(key)) {
    const hit = _noisePvCache.get(key)
    if (typeof hit === 'string' && hit) node._lastTexUrl = hit
    _texQueue.delete(node.id)
    return typeof hit === 'string' && hit ? hit : (node._lastTexUrl ?? null)
  }
  _texQueue.set(node.id, { node, props: node.props })
  _drainTexQueue()
  return node._lastTexUrl ?? null
}
function _drainTexQueue() {
  if (_texQueueRunning || _texQueue.size === 0) return
  _texQueueRunning = true
  const tick = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(f, 0)
  tick(() => {
    _texQueueRunning = false
    const first = _texQueue.entries().next().value
    if (!first) return
    _texQueue.delete(first[0])
    const job = first[1]
    const node = _state.nodes.get(first[0])
    if (node && node.props === job.props) _noisePreviewUrl(node, _NOISE_TEX_SIZE)
    if (_texQueue.size > 0) _drainTexQueue()
    _evaluate()
  })
}
