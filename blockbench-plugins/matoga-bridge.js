/**
 * matoga Bridge — Blockbench 插件
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 把 Blockbench 当前项目一键推送到 matoga（材质贴图对比工具），
 * 或从 matoga 已导入模型拉取贴图到 Blockbench 画板。
 *
 * 依赖 matoga 本地服务（默认 http://127.0.0.1:5273）：
 *   POST /api/imported-models        { name, data, ext, textures? }
 *   GET  /api/imported-models        → { models: [...] }
 *   GET  /api/imported-models/:id/textures → { textures: [...] }
 *
 * 安装：把本文件拖入 Blockbench，或放入插件目录后从「插件」菜单加载。
 */

const STORAGE_KEY = 'matoga_bridge_host'
const DEFAULT_HOST = 'http://127.0.0.1:5273'

function getHost() {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_HOST
  } catch {
    return DEFAULT_HOST
  }
}

function setHost(h) {
  try {
    localStorage.setItem(STORAGE_KEY, h)
  } catch {}
}

function toast(text, color) {
  try {
    Blockbench.showToast({ text, color: color || 'info' })
  } catch {
    console.log('[matoga-bridge]', text)
  }
}

async function api(path, opts) {
  const url = getHost().replace(/\/+$/, '') + path
  const res = await fetch(url, opts)
  const ct = res.headers.get('content-type') || ''
  const body = ct.includes('json') ? await res.json() : await res.text()
  if (!res.ok) {
    const msg = (body && body.msg) || res.statusText || 'request failed'
    throw new Error(msg)
  }
  return body
}

function texturesToDataUrlMap() {
  const out = {}
  const texs = (typeof Texture !== 'undefined' && Texture.all) || []
  texs.forEach((t, i) => {
    try {
      const dataUrl = t.getDataURL ? t.getDataURL() : t.source
      if (!dataUrl || typeof dataUrl !== 'string') return
      const ns = (Project && Project.geometry_name && String(Project.geometry_name).split(':')[0]) || 'matoga'
      const name = (t.name || 'texture_' + i).replace(/[^\w.-]+/g, '_')
      const rel = 'assets/' + ns + '/textures/' + name + '.png'
      out[rel] = dataUrl
    } catch {}
  })
  return out
}

async function pushToMatoga() {
  let bbmodel
  try {
    bbmodel = Codecs.bbmodel.compile({ compressed: false })
  } catch (e) {
    toast('编译 .bbmodel 失败: ' + e.message, 'error')
    return
  }
  const name = (Project && Project.name) || 'model'
  toast('正在推送到 matoga…')
  try {
    const textures = texturesToDataUrlMap()
    const r = await api('/api/imported-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: bbmodel, ext: 'bbmodel', textures })
    })
    toast('已推送: ' + (r.id || name), 'success')
  } catch (e) {
    toast('推送失败: ' + e.message + '（matoga 是否已启动？）', 'error')
  }
}

async function pullTextures() {
  let list
  try {
    list = await api('/api/imported-models')
  } catch (e) {
    toast('拉取模型列表失败: ' + e.message, 'error')
    return
  }
  const models = list.models || []
  if (!models.length) {
    toast('matoga 中暂无已导入模型', 'info')
    return
  }
  let form
  try {
    form = await new Promise((resolve) => {
      new Dialog('matoga_pick_model', {
        title: '从 matoga 拉取贴图',
        form: {
          model: {
            type: 'select',
            label: '模型',
            options: Object.fromEntries(models.map((m) => [m.id, m.id + ' (' + (m.ext || '?') + ')']))
          }
        },
        onConfirm: (f) => resolve(f),
        onCancel: () => resolve(null)
      }).show()
    })
  } catch {
    form = null
  }
  if (!form || !form.model) return
  let texRes
  try {
    texRes = await api('/api/imported-models/' + encodeURIComponent(form.model) + '/textures')
  } catch (e) {
    toast('拉取贴图列表失败: ' + e.message, 'error')
    return
  }
  const texs = texRes.textures || []
  if (!texs.length) {
    toast('该模型无贴图', 'info')
    return
  }
  let pick
  try {
    pick = await new Promise((resolve) => {
      new Dialog('matoga_pick_texture', {
        title: '选择贴图',
        form: {
          tex: {
            type: 'select',
            label: '贴图',
            options: Object.fromEntries(texs.map((t) => [t.path, t.path + ' (' + Math.round(t.size / 1024) + 'KB)']))
          }
        },
        onConfirm: (f) => resolve(f),
        onCancel: () => resolve(null)
      }).show()
    })
  } catch {
    pick = null
  }
  if (!pick || !pick.tex) return
  let dataUrl
  try {
    const url = getHost().replace(/\/+$/, '') + '/api/imported-models/' + encodeURIComponent(form.model) + '/textures/' + encodeURIComponent(pick.tex)
    const res = await fetch(url)
    if (!res.ok) throw new Error('http ' + res.status)
    const buf = await res.arrayBuffer()
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
    dataUrl = 'data:image/png;base64,' + b64
  } catch (e) {
    toast('下载贴图失败: ' + e.message, 'error')
    return
  }
  try {
    const tex = new Texture({ name: pick.tex.split('/').pop(), mode: 'bitmap' })
    tex.fromDataURL(dataUrl)
    tex.add()
    toast('已加载贴图: ' + tex.name, 'success')
  } catch (e) {
    toast('加载到画板失败: ' + e.message, 'error')
  }
}

function configureHost() {
  let form
  try {
    form = new Dialog('matoga_host_config', {
      title: 'matoga 服务地址',
      form: { host: { type: 'text', label: 'Host', value: getHost() } },
      onConfirm: (f) => setHost(f.host)
    })
    form.show()
  } catch {
    const h = prompt('matoga 服务地址', getHost())
    if (h) setHost(h)
  }
}

let actions = []
Plugin.register('matoga_bridge', {
  title: 'matoga Bridge',
  author: 'matoga',
  description: '把 Blockbench 模型推送到 matoga，或从 matoga 拉取贴图到画板。',
  icon: 'sync',
  version: '0.1.0',
  variant: 'both',
  tags: ['Minecraft'],
  onload() {
    actions = [
      new Action('matoga_push', {
        name: 'Push to matoga',
        description: '把当前项目作为 .bbmodel 推送到 matoga',
        icon: 'file_upload',
        click: pushToMatoga
      }),
      new Action('matoga_pull_tex', {
        name: 'Pull Texture from matoga',
        description: '从 matoga 已导入模型拉取贴图到画板',
        icon: 'texture',
        click: pullTextures
      }),
      new Action('matoga_config', {
        name: 'matoga Host…',
        description: '配置 matoga 服务地址',
        icon: 'settings',
        click: configureHost
      })
    ]
    const fileMenu = MenuBar.menus && MenuBar.menus.file
    if (fileMenu) {
      actions.forEach((a) => fileMenu.addAction(a))
    } else {
      actions.forEach((a) => MenuBar.menus.tools.addAction(a))
    }
  },
  onunload() {
    actions.forEach((a) => a.delete())
    actions = []
  }
})