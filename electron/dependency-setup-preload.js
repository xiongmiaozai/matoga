/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 依赖安装弹窗的 preload：通过 IPC 从主进程取协议文案与下载地址，
 * 并把用户选择（auto / manual）回传给主进程。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__depSetup', {
  // 从主进程获取 { notice, label, url }，返回 Promise。
  init: () => ipcRenderer.invoke('dep-setup:init'),
  // 回传用户选择：'auto' | 'manual'
  send: action => ipcRenderer.send('dep-setup-choice', action)
})
