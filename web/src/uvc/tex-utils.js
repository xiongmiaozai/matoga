/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 原样搬出的纯工具函数（不引用任何闭包状态）。
 * 正文逐字搬运，未改写逻辑。
 */

/* 读取本地文件为 DataURL（上传贴图用） */
export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('read fail'))
      reader.readAsDataURL(file)
    } catch (e) {
      reject(e)
    }
  })
}

/* 贴图 URL 是否可直接给 <img> / canvas 使用 */
export function isUsableTexUrl(url) {
  return (
    typeof url === 'string' &&
    (url.startsWith('data:') || /^https?:\/\//i.test(url) || url.startsWith('/'))
  )
}
