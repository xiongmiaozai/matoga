/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 依赖安装弹窗的 preload：通过 IPC 从主进程取协议文案、下载地址与
 * 线程数范围，并把用户选择回传主进程。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__depSetup', {
  // 从主进程获取 { notice, label, urls, defaultThreads, minThreads, maxThreads }。
  init: () => ipcRenderer.invoke('dep-setup:init'),
  // 回传用户选择：{ action: 'auto' | 'manual', threads: number }
  send: payload => {
    const action = payload && payload.action
    const threads = payload && Number(payload.threads)
    ipcRenderer.send('dep-setup-choice', {
      action: action === 'auto' || action === 'manual' ? action : 'quit',
      threads: Number.isFinite(threads) ? threads : 0
    })
  }
})
