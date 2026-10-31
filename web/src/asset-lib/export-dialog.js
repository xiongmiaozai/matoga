/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 资产库：资源包导出
 *
 * 从 asset-library.js 的「包内容浏览」段原样搬出，逻辑未改。
 * 只依赖 showToast / apiUrl 两个外部符号，均为直接 import，无需 hooks 注入。
 */

import { showToast } from '../core.js'
import { apiUrl } from '../utils.js'

/**
 * 下载后端生成的 zip。
 *
 * @param {string} url 接口路径
 * @param {object} body 请求体
 * @param {string} loadingMsg 开始时的提示
 * @param {string} successPrefix 成功前缀（后面拼文件名）
 */
export async function doDownloadZip(url, body, loadingMsg, successPrefix) {
  try {
    showToast(loadingMsg)
    const res = await fetch(apiUrl(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') || ''
    let fileName = 'export.zip'
    const m = cd.match(/filename="?([^"]+)"?/)
    if (m) {
      try {
        fileName = decodeURIComponent(m[1])
      } catch {}
    }
    const u = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = u
    a.download = fileName
    a.click()
    URL.revokeObjectURL(u)
    showToast(successPrefix + fileName)
  } catch (e) {
    showToast('导出失败：' + (e.message || e))
  }
}

/**
 * 打开导出对话框，返回 { names, skipPackPng, noCompress } 或 null（取消）。
 *
 * @param {object} opts
 * @param {Array} opts.packs 资源包列表（含 name）
 * @param {boolean} opts.isBatch 是否批量导出
 */
export function openExportDialog({ packs, isBatch }) {
  return new Promise(resolve => {
    const bd = document.createElement('div')
    bd.style.cssText =
      'position:fixed;inset:0;z-index:92001;background:rgba(0,0,0,.5);' +
      'display:flex;align-items:center;justify-content:center;font-family:inherit;'
    const c = document.createElement('div')
    c.style.cssText =
      'width:min(480px,calc(100vw - 48px));border-radius:10px;' +
      'background:var(--bg2,#1c1f26);color:var(--text,#e8e8e8);border:1px solid var(--border,#333);' +
      'box-shadow:0 12px 40px rgba(0,0,0,.5);padding:16px 18px;box-sizing:border-box;'
    const h = document.createElement('div')
    h.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:10px;'
    h.textContent = isBatch ? '批量导出为 zip' : '导出为 zip'
    c.appendChild(h)

    const selected = new Set(packs.map(p => p.name))
    if (isBatch) {
      const hint = document.createElement('div')
      hint.style.cssText = 'font-size:11px;opacity:.6;margin-bottom:8px;'
      hint.textContent = '勾选要导出的资源包（' + packs.length + ' 个）'
      c.appendChild(hint)
      const list = document.createElement('div')
      list.style.cssText =
        'max-height:200px;overflow:auto;margin-bottom:10px;border:1px solid var(--border,#333);' +
        'border-radius:6px;padding:6px;background:var(--bg,#12141a);'
      for (const p of packs) {
        const row = document.createElement('label')
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;cursor:pointer;'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = true
        cb.addEventListener('change', () => {
          cb.checked ? selected.add(p.name) : selected.delete(p.name)
        })
        row.appendChild(cb)
        row.appendChild(document.createTextNode(p.name))
        list.appendChild(row)
      }
      c.appendChild(list)
    }

    const pngLabel = document.createElement('label')
    pngLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:6px;cursor:pointer;'
    const pngCb = document.createElement('input')
    pngCb.type = 'checkbox'
    pngCb.checked = true
    pngLabel.appendChild(pngCb)
    pngLabel.appendChild(document.createTextNode('包含 pack.png 缩略图'))
    c.appendChild(pngLabel)

    const cmpLabel = document.createElement('label')
    cmpLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:12px;cursor:pointer;'
    const cmpCb = document.createElement('input')
    cmpCb.type = 'checkbox'
    cmpCb.checked = true
    cmpLabel.appendChild(cmpCb)
    cmpLabel.appendChild(document.createTextNode('压缩文件（deflate，取消则为 store 直存）'))
    c.appendChild(cmpLabel)

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;'
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    cancelBtn.style.cssText =
      'padding:6px 18px;border-radius:6px;font-size:12px;cursor:pointer;' +
      'border:1px solid var(--border,#333);background:var(--bg,#12141a);color:var(--text,#e8e8e8);'
    const exportBtn = document.createElement('button')
    exportBtn.textContent = '导出'
    exportBtn.style.cssText =
      'padding:6px 18px;border-radius:6px;font-size:12px;cursor:pointer;' +
      'border:1px solid var(--primary,#2b6cff);background:var(--primary,#2b6cff);color:#fff;'
    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(exportBtn)
    c.appendChild(btnRow)
    bd.appendChild(c)

    let done = false
    function finish(v) {
      if (done) return
      done = true
      bd.remove()
      resolve(v)
    }
    cancelBtn.addEventListener('click', () => finish(null))
    bd.addEventListener('pointerdown', e => {
      if (e.target === bd) finish(null)
    })
    exportBtn.addEventListener('click', () => {
      const names = isBatch ? [...selected] : [packs[0].name]
      if (!names.length) {
        showToast('请至少选择一个资源包')
        return
      }
      finish({ names, skipPackPng: !pngCb.checked, noCompress: !cmpCb.checked })
    })
    document.body.appendChild(bd)
  })
}
