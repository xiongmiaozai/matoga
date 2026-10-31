/**
 * matoga - 导入资源包对话框（可视化）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * openImportPackDialog({ onImported }) → 弹出模态框：
 *  拖入或选择 .zip/.mcpack/.resourcepack 文件，或选择目录，
 *  调用 POST /api/mc-packs/import（zip 以 base64 内联直传；目录以文件列表内联），
 *  成功后回调 onImported(result) 并 showToast。
 */

import { showToast } from './core.js'
import { apiUrl } from './utils.js'

const IMPORT_API = '/api/mc-packs/import'
const Z_BASE = 92001

async function apiCall(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const j = await res.json()
  if (!j || !j.ok) throw new Error((j && j.msg) || 'bad response')
  return j.data
}

function backdrop(z) {
  const el = document.createElement('div')
  el.className = 'ipb-dialog-backdrop'
  el.style.cssText = `position:fixed;inset:0;z-index:${z};background:rgba(0,0,0,.5);` +
    'display:flex;align-items:center;justify-content:center;font-family:inherit;'
  return el
}

function card() {
  const c = document.createElement('div')
  c.className = 'ipb-dialog'
  c.style.cssText = 'width:min(560px,calc(100vw - 48px));max-height:calc(100vh - 80px);overflow:auto;' +
    'border-radius:10px;background:var(--bg2,#1c1f26);color:var(--text,#e8e8e8);border:1px solid var(--border,#333);' +
    'box-shadow:0 12px 40px rgba(0,0,0,.5);padding:16px 18px;box-sizing:border-box;'
  return c
}

function label(text) {
  const l = document.createElement('div')
  l.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:.5px;opacity:.85;margin:12px 0 6px;'
  l.textContent = text
  return l
}

function inputStyle() {
  return 'width:100%;box-sizing:border-box;padding:6px 10px;font-size:12px;border-radius:6px;' +
    'border:1px solid var(--border,#333);background:var(--bg,#12141a);color:var(--text,#e8e8e8);outline:none;'
}

function mkBtn(text, primary) {
  const b = document.createElement('button')
  b.textContent = text
  b.style.cssText = 'padding:6px 18px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid var(--border,#333);' +
    (primary
      ? 'background:var(--primary,#2b6cff);border-color:var(--primary,#2b6cff);color:#fff;'
      : 'background:var(--bg,#12141a);color:var(--text,#e8e8e8);')
  return b
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const s = String(fr.result)
      const ci = s.indexOf(',')
      resolve(ci >= 0 ? s.slice(ci + 1) : s)
    }
    fr.onerror = () => reject(new Error('读取文件失败'))
    fr.readAsDataURL(file)
  })
}

const ZIP_EXTS = new Set(['zip', 'mcpack', 'resourcepack'])

export async function openImportPackDialog(opts = {}) {
  const onImported = opts.onImported

  return new Promise(resolve => {
    const bd = backdrop(Z_BASE)
    const c = card()

    const h = document.createElement('div')
    h.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:4px;'
    h.textContent = '导入资源包'
    c.appendChild(h)

    const sub = document.createElement('div')
    sub.style.cssText = 'font-size:11px;opacity:.6;margin-bottom:8px;'
    sub.textContent = '导入 .zip/.mcpack 资源包或目录到 MC 资源包媒体库'
    c.appendChild(sub)

    /* 名称 */
    c.appendChild(label('包名称（留空则自动推断）'))
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.placeholder = '从 pack.mcmeta 描述推断'
    nameInput.style.cssText = inputStyle()
    c.appendChild(nameInput)

    /* 覆盖选项 */
    const overwriteRow = document.createElement('div')
    overwriteRow.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:11px;margin-top:8px;'
    const overwriteCheck = document.createElement('input')
    overwriteCheck.type = 'checkbox'
    overwriteCheck.id = 'ipbOverwrite'
    const overwriteLabel = document.createElement('label')
    overwriteLabel.htmlFor = 'ipbOverwrite'
    overwriteLabel.textContent = '同名覆盖（否则自动追加 -2/-3 去重）'
    overwriteRow.appendChild(overwriteCheck)
    overwriteRow.appendChild(overwriteLabel)
    c.appendChild(overwriteRow)

    /* 文件选择区 */
    c.appendChild(label('资源包文件（拖入或点击选择 .zip / 目录）'))
    const fileZone = document.createElement('div')
    fileZone.style.cssText = 'border:1px dashed var(--border,#333);border-radius:8px;padding:16px;' +
      'text-align:center;font-size:11px;opacity:.7;cursor:pointer;background:var(--bg,#12141a);'
    fileZone.textContent = '点击选择 .zip 文件或目录，或拖拽到此区域'
    c.appendChild(fileZone)

    const fileList = document.createElement('div')
    fileList.style.cssText = 'margin-top:6px;max-height:140px;overflow:auto;'
    c.appendChild(fileList)

    let importMode = null
    let importPayload = null

    function setZipFile(file) {
      importMode = 'zip'
      importPayload = file
      fileList.innerHTML = ''
      const row = document.createElement('div')
      row.style.cssText = 'padding:4px 6px;font-size:11px;border-radius:4px;' +
        'background:rgba(255,255,255,.04);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;'
      const nm = document.createElement('span')
      nm.textContent = file.name + '  (' + Math.round(file.size / 1024) + ' KB)'
      const del = document.createElement('button')
      del.textContent = '✕'
      del.style.cssText = 'background:none;border:none;color:var(--text,#e8e8e8);cursor:pointer;font-size:12px;'
      del.addEventListener('click', () => { importMode = null; importPayload = null; fileList.innerHTML = '' })
      row.appendChild(nm)
      row.appendChild(del)
      fileList.appendChild(row)
    }

    function setDirFiles(fileObjs) {
      importMode = 'dir'
      importPayload = fileObjs
      fileList.innerHTML = ''
      const row = document.createElement('div')
      row.style.cssText = 'padding:4px 6px;font-size:11px;border-radius:4px;' +
        'background:rgba(255,255,255,.04);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;'
      const nm = document.createElement('span')
      nm.textContent = '目录：' + (fileObjs[0].webkitRelativePath || '').split('/')[0] + '  (' + fileObjs.length + ' 个文件)'
      const del = document.createElement('button')
      del.textContent = '✕'
      del.style.cssText = 'background:none;border:none;color:var(--text,#e8e8e8);cursor:pointer;font-size:12px;'
      del.addEventListener('click', () => { importMode = null; importPayload = null; fileList.innerHTML = '' })
      row.appendChild(nm)
      row.appendChild(del)
      fileList.appendChild(row)
    }

    function pickZip() {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.zip,.mcpack,.resourcepack'
      input.onchange = () => {
        if (input.files && input.files.length) setZipFile(input.files[0])
      }
      input.click()
    }

    function pickDir() {
      const input = document.createElement('input')
      input.type = 'file'
      input.webkitdirectory = true
      input.onchange = () => {
        if (input.files && input.files.length) setDirFiles([...input.files])
      }
      input.click()
    }

    /* 双按钮：选择 zip / 选择目录 */
    const pickRow = document.createElement('div')
    pickRow.style.cssText = 'display:flex;gap:8px;margin-top:6px;'
    const zipBtn = mkBtn('选择 zip 文件', false)
    zipBtn.style.padding = '4px 12px'
    const dirBtn = mkBtn('选择目录', false)
    dirBtn.style.padding = '4px 12px'
    zipBtn.addEventListener('click', pickZip)
    dirBtn.addEventListener('click', pickDir)
    pickRow.appendChild(zipBtn)
    pickRow.appendChild(dirBtn)
    c.appendChild(pickRow)

    fileZone.addEventListener('click', pickZip)
    fileZone.addEventListener('dragover', e => { e.preventDefault(); fileZone.style.opacity = '1' })
    fileZone.addEventListener('dragleave', () => { fileZone.style.opacity = '.7' })
    fileZone.addEventListener('drop', e => {
      e.preventDefault()
      fileZone.style.opacity = '.7'
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        const f = e.dataTransfer.files[0]
        const ext = (f.name.split('.').pop() || '').toLowerCase()
        if (ZIP_EXTS.has(ext)) setZipFile(f)
        else showToast('请拖入 .zip/.mcpack/.resourcepack 文件')
      }
    })

    /* 操作按钮 */
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;'
    const cancelBtn = mkBtn('取消', false)
    const importBtn = mkBtn('导入', true)
    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(importBtn)
    c.appendChild(btnRow)
    bd.appendChild(c)

    let done = false
    function finish(v) { if (done) return; done = true; document.removeEventListener('keydown', esc, true); bd.remove(); resolve(v) }
    const esc = e => { if (e.key === 'Escape') finish(null) }
    document.addEventListener('keydown', esc, true)
    cancelBtn.addEventListener('click', () => finish(null))
    bd.addEventListener('pointerdown', e => { if (e.target === bd) finish(null) })

    importBtn.addEventListener('click', async () => {
      if (!importMode || !importPayload) { showToast('请先选择要导入的文件或目录'); return }

      const name = nameInput.value.trim() || undefined
      const overwrite = overwriteCheck.checked

      importBtn.disabled = true
      importBtn.textContent = '导入中…'
      try {
        let body
        if (importMode === 'zip') {
          const zipData = await readFileAsBase64(importPayload)
          body = { zipData, name, overwrite }
        } else {
          const files = []
          for (const f of importPayload) {
            const rel = f.webkitRelativePath || f.name
            const data = await readFileAsBase64(f)
            files.push({ path: rel, data })
          }
          body = { files, name, overwrite }
        }

        const r = await apiCall('POST', IMPORT_API, body)
        const entry = r.entry || {}
        showToast('已导入：' + r.name + (entry.valid ? '（pack_format ' + (entry.format != null ? entry.format : '?') + '）' : ''))
        if (onImported) try { await onImported(r) } catch {}
        finish(r)
      } catch (e) {
        showToast('导入失败：' + (e.message || e))
        importBtn.disabled = false
        importBtn.textContent = '导入'
      }
    })

    document.body.appendChild(bd)
  })
}