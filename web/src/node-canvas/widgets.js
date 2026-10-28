/**
 * matoga - node canvas widgets
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 *
 * In-node property controls (number/colour/vector/texture sliders, selects,
 * preview boxes) and per-node generator widgets.
 *
 * Widgets need to trigger graph re-evaluation and a dirty flag; the editor
 * injects those via `setWidgetHooks` instead of this module importing it back.
 */

import { clamp } from './algorithms.js'
import { uiPrompt } from '../ui-dialog.js'
import { S, setWidgetHooks, evaluate, _markDirty, toast } from './wg/state.js'

/* ── widgets ───────────────────────────────── */
/* 滑条/取色 input 高频触发的求值合并到下一帧（rAF）：拖动时每帧至多一次 evaluate，
   避免 input 事件栈内同步执行整图求值+纹理生成导致掉帧 */

// 公共门面：子模块的导出在此重新导出，保持既有导入路径（'./widgets.js'）可用
export { setWidgetHooks, evaluate, _markDirty, toast } from './wg/state.js'
export { _scheduleEval } from './wg/schedule.js'
export { _labeledRow, numWidget, colorWidget, vecWidget, textureWidget, selectWidget, previewWidget } from './wg/basic.js'
export { rgbaMergeWidget, rgbaSplitWidget, rgbAlphaSplitWidget } from './wg/rgba.js'
export { noiseWidget, voronoiWidget, whiteWidget, cellWidget, pingpongWidget, voronoiseWidget, reactionWidget, lightningWidget, mandelWidget, paletteWidget, gradientWidget, warpWidget } from './wg/noise.js'

