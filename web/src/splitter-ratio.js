/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 分隔条比例计算纯函数（参考 Blender Action Zone 手势方向判定）。
 * 拆为独立模块以便单元测试，不依赖浏览器环境。
 */

/**
 * 根据相邻两个面板的矩形，判定分隔方向并计算占比。
 * 方向由两矩形质心差的主轴决定（|dx| vs |dy|），与 GL 类名解耦，
 * 避免 lm_horizontal / lm_vertical 命名歧义。
 *
 * @param {{left:number,top:number,width:number,height:number}} prevRect
 * @param {{left:number,top:number,width:number,height:number}} nextRect
 * @returns {{a:number,b:number,horizontal:boolean}} a+b=100，均为 0..100 整数
 */
export function computeSplitRatio(prevRect, nextRect) {
  const dx = Math.abs(prevRect.left + prevRect.width / 2 - (nextRect.left + nextRect.width / 2))
  const dy = Math.abs(prevRect.top + prevRect.height / 2 - (nextRect.top + nextRect.height / 2))
  const horizontal = dx >= dy
  const a = horizontal ? prevRect.width : prevRect.height
  const b = horizontal ? nextRect.width : nextRect.height
  const total = a + b
  if (total <= 0) return { a: 50, b: 50, horizontal }
  const aPct = Math.round((a / total) * 100)
  return { a: aPct, b: 100 - aPct, horizontal }
}
