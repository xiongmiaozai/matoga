/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 上传模型目标 key 计算（纯函数）：
 * 保留 g.key 的目录与主名，扩展名改用上传文件的原扩展名，
 * 避免 .bbmodel 内容写入 .json 路径导致 3D 预览解析失败。
 */

export function modelDestKey(gKey, uploadFilePath) {
  const sDot = uploadFilePath.lastIndexOf('.')
  const kDot = gKey.lastIndexOf('.')
  const srcExt = sDot > 0 ? uploadFilePath.slice(sDot + 1).toLowerCase() : ''
  const keyExt = kDot > 0 ? gKey.slice(kDot + 1).toLowerCase() : ''
  if (!srcExt || srcExt === keyExt) return gKey
  return kDot > 0 ? gKey.slice(0, kDot + 1) + srcExt : gKey + '.' + srcExt
}