/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 依赖安装进度窗的 preload。只暴露三个只读通道，渲染层拿不到 ipcRenderer 本体。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__installProgress', {
  // 订阅主进程推来的阶段/进度/日志事件。
  onEvent(cb) {
    if (typeof cb !== 'function') return
    ipcRenderer.on('install-progress:event', (_e, evt) => cb(evt))
  },
  // 用户点「取消」。
  cancel() {
    ipcRenderer.send('install-progress:cancel')
  },
  // 用户点「手动下载」。
  manual() {
    ipcRenderer.send('install-progress:manual')
  },
  // 完成后请求关闭窗口（不触发「取消」回调）。
  close() {
    ipcRenderer.send('install-progress:close')
  }
})
