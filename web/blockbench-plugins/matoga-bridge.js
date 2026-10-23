/**
 * matoga 桥接插件 (Blockbench Plugin)
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 双向联动:
 *  - 工具菜单「发送模型到 matoga」: 导出 .bbmodel → POST /api/blockbench/models
 *  - 工具菜单「拉取 matoga 材质」: GET /api/blockbench/inbox → 应用纹理 → 清除
 *  - 监听 postMessage {type:'matoga-texture', name, dataUrl}: 父页面实时推送材质
 *  - 监听 postMessage {type:'matoga-open-model', data}: 父页面打开模型（.bbmodel / MC .json）
 * 同源部署，API 用绝对路径 /api/blockbench/*；LAN 模式 token 经 URL 参数传递。
 */

let sendAction, pullAction
const API = '/api/blockbench'

function getToken() {
  try {
    let t = new URLSearchParams(location.search).get('matoga-token')
    if (!t && window.parent && window.parent !== window) t = new URLSearchParams(window.parent.location.search).get('token')
    return t || ''
  } catch { return '' }
}

async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' }
  const t = getToken()
  if (t) headers['x-matoga-token'] = t
  const res = await fetch(API + url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return res.json()
}

function applyTexture(name, dataUrl) {
  try {
    const tex = new Texture({ name: name || 'matoga_texture', fromDataUrl: dataUrl })
    tex.add().then(() => {}).catch(() => {})
    return true
  } catch { return false }
}

/* 打开 matoga 推送的模型：.bbmodel 走 bbmodel 编解码，MC .json 模型走 java_block（Java 方块/物品） */
function openModelData(data) {
  try {
    const isBb = data && data.meta && typeof data.meta === 'object' &&
      (data.meta.format === 'bbmodel' || data.meta.model_format)
    const text = JSON.stringify(data)
    if (isBb && Codecs.bbmodel) Codecs.bbmodel.parse(text)
    else if (!isBb && Codecs.java_block) Codecs.java_block.parse(text)
    else return Blockbench.showStatusMessage('不支持的模型格式', 3000)
    Blockbench.showStatusMessage('已打开 matoga 模型', 2000)
  } catch (e) {
    Blockbench.showStatusMessage('打开模型失败: ' + e.message, 3000)
  }
}

function registerPlugin() {
Plugin.register('matoga_bridge', {
  title: 'matoga 桥接',
  author: 'matoga',
  icon: 'crop_free',
  description: '与 matoga 材质工具双向联动：发送模型 / 拉取材质',
  version: '1.0.0',
  variant: 'both',
  onload() {
    sendAction = new Action('matoga_send_model', {
      name: '发送模型到 matoga',
      description: '将当前模型导出并发送到 matoga',
      icon: 'upload',
      click: async () => {
        try {
          const data = Codecs.bbmodel.compile({ raw: true })
          const name = (Project && Project.name) || 'model'
          const r = await api('POST', '/models', { name, data })
          if (r && r.ok) Blockbench.showStatusMessage('已发送到 matoga', 2000)
          else Blockbench.showStatusMessage('发送失败: ' + (r && r.msg), 3000)
        } catch (e) { Blockbench.showStatusMessage('发送失败: ' + e.message, 3000) }
      }
    })
    pullAction = new Action('matoga_pull_textures', {
      name: '拉取 matoga 材质',
      description: '从 matoga 收件箱拉取推送来的材质并应用',
      icon: 'download',
      click: async () => {
        try {
          const r = await api('GET', '/inbox')
          if (!r || !r.ok) return Blockbench.showStatusMessage('拉取失败', 3000)
          const items = (r.data && r.data.items) || []
          if (!items.length) return Blockbench.showStatusMessage('收件箱为空', 2000)
          let applied = 0
          for (const it of items) {
            if (applyTexture(it.name, it.dataUrl)) applied++
            try { await api('DELETE', '/inbox/' + it.id) } catch {}
          }
          Blockbench.showStatusMessage('已应用 ' + applied + ' 个材质', 2000)
        } catch (e) { Blockbench.showStatusMessage('拉取失败: ' + e.message, 3000) }
      }
    })
    MenuBar.menus.tools.addAction(sendAction)
    MenuBar.menus.tools.addAction(pullAction)

    window.addEventListener('message', (e) => {
      const d = e.data
      if (!d || typeof d !== 'object') return
      if (d.type === 'matoga-texture') {
        if (applyTexture(d.name, d.dataUrl)) Blockbench.showStatusMessage('已接收材质: ' + (d.name || ''), 1500)
      } else if (d.type === 'matoga-open-model' && d.data) {
        openModelData(d.data)
      }
    })

    /* 插件就绪信号：父页面据此补投加载期间丢失的模型消息 */
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'matoga-bridge-ready' }, '*')
    } catch {}
  },
  onunload() {
    if (sendAction) sendAction.delete()
    if (pullAction) pullAction.delete()
  }
})}

if (typeof Plugin !== 'undefined' && Plugin.register) {
  registerPlugin()
} else {
  let _tries = 0
  const _wait = setInterval(() => {
    _tries++
    if (typeof Plugin !== 'undefined' && Plugin.register) {
      clearInterval(_wait)
      registerPlugin()
    } else if (_tries > 400) {
      clearInterval(_wait)
      console.warn('[matoga-bridge] Blockbench Plugin API 未就绪，已放弃')
    }
  }, 50)
}