/**
 * matoga - 高度图通道规整
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 将高度图 R 通道复制到 G/B,A 强制为 255，
 * 供视差映射 shader 按 .r/.g/.b 任一通道采样均得到一致高度值。
 * 纯函数，无副作用，操作并返回传入的 imageData。
 */
export function normalizeHeightChannels(imageData) {
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i]
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
  return imageData
}