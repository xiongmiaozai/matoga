/**
 * matoga - 创建材质包对话框（可视化）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * openCreatePackDialog({ onCreated }) → 弹出模态框：
 *  填写名称/描述/pack_format/命名空间/输出形式，拖入或选择本地贴图/模型文件，
 *  调用 POST /api/pack-builder/build（文件以 base64 内联直传，无需上传端点），
 *  成功后回调 onCreated(result) 并 showToast。
 */

import { showToast } from './core.js'
import { apiUrl } from './utils.js'

const BUILDER_API = '/api/pack-builder'
const Z_BASE = 92000

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
  el.className = 'cpb-dialog-backdrop'
  el.style.cssText = `position:fixed;inset:0;z-index:${z};background:rgba(0,0,0,.5);` +
    'display:flex;align-items:center;justify-content:center;font-family:inherit;'
  return el
}

function card() {
  const c = document.createElement('div')
  c.className = 'cpb-dialog'
  c.style.cssText = 'width:min(620px,calc(100vw - 48px));max-height:calc(100vh - 80px);overflow:auto;' +
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

export async function openCreatePackDialog(opts = {}) {
  const onCreated = opts.onCreated

  let formats = []
  try {
    const data = await apiCall('GET', BUILDER_API + '/formats')
    formats = (data && data.formats) || []
  } catch {}

  return new Promise(resolve => {
    const bd = backdrop(Z_BASE)
    const c = card()

    const h = document.createElement('div')
    h.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:4px;'
    h.textContent = '创建材质包'
    c.appendChild(h)

    const sub = document.createElement('div')
    sub.style.cssText = 'font-size:11px;opacity:.6;margin-bottom:8px;'
    sub.textContent = '按 Minecraft 资源包规范生成 pack.mcmeta + pack.png + 资产文件'
    c.appendChild(sub)

    /* 名称 */
    c.appendChild(label('包名称'))
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.value = '我的材质包'
    nameInput.style.cssText = inputStyle()
    c.appendChild(nameInput)

    /* 描述 */
    c.appendChild(label('描述（可选）'))
    const descInput = document.createElement('input')
    descInput.type = 'text'
    descInput.placeholder = '默认：<包名> · matoga'
    descInput.style.cssText = inputStyle()
    c.appendChild(descInput)

    /* MC 版本范围：最小 / 最大 pack_format，实时预览生成写法 */
    c.appendChild(label('MC 版本范围（pack_format）'))
    const fmtRow = document.createElement('div')
    fmtRow.style.cssText = 'display:flex;gap:8px;align-items:center;'
    const fmtMap = new Map(formats.map(f => [f.format, f.versions]))
    function buildFmtSelect() {
      const sel = document.createElement('select')
      sel.style.cssText = inputStyle() + 'flex:1;'
      const def = formats.find(f => f.format === 64) || formats[0]
      for (const f of formats) {
        const opt = document.createElement('option')
        opt.value = String(f.format)
        opt.textContent = f.format + '  (' + f.versions + ')'
        if (def && f.format === def.format) opt.selected = true
        sel.appendChild(opt)
      }
      return sel
    }
    const minSelect = buildFmtSelect('最小')
    const maxSelect = buildFmtSelect('最大')
    const arrow = document.createElement('span')
    arrow.style.cssText = 'opacity:.6;font-size:12px;'
    arrow.textContent = '→'
    fmtRow.appendChild(minSelect)
    fmtRow.appendChild(arrow)
    fmtRow.appendChild(maxSelect)
    c.appendChild(fmtRow)

    const fmtPreview = document.createElement('div')
    fmtPreview.style.cssText = 'font-size:10px;opacity:.7;margin-top:6px;padding:6px 8px;border-radius:5px;' +
      'background:rgba(255,255,255,.05);border:1px solid var(--border,#333);font-family:monospace;white-space:pre-wrap;'
    c.appendChild(fmtPreview)

    function fmtVersionsLabel(v) { return fmtMap.get(v) || '' }
    function updateFmtPreview() {
      const lo = Number(minSelect.value)
      const hi = Number(maxSelect.value)
      const loV = fmtVersionsLabel(lo)
      const hiV = fmtVersionsLabel(hi)
      const useSingle = lo === hi && lo <= 64
      if (useSingle) {
        fmtPreview.textContent = 'pack.mcmeta →  "pack_format": ' + lo +
          '\n兼容：' + loV + '（单一格式，旧写法，兼容性好）'
      } else {
        fmtPreview.textContent = 'pack.mcmeta →  "min_format": ' + lo + ', "max_format": ' + hi +
          '\n兼容：' + loV + ' ～ ' + hiV + '（范围写法，1.20.2+ 支持）'
      }
    }
    minSelect.addEventListener('change', updateFmtPreview)
    maxSelect.addEventListener('change', updateFmtPreview)
    updateFmtPreview()

    /* 完整版本对照表（可折叠） */
    const tableToggle = document.createElement('button')
    tableToggle.type = 'button'
    tableToggle.textContent = '▸ 查看完整版本对照表（' + formats.length + ' 个）'
    tableToggle.style.cssText = 'margin-top:6px;background:none;border:none;cursor:pointer;' +
      'font-size:11px;color:var(--primary,#2b6cff);padding:0;'
    c.appendChild(tableToggle)
    const tableBox = document.createElement('div')
    tableBox.style.cssText = 'margin-top:4px;max-height:180px;overflow:auto;font-size:10px;' +
      'border-radius:5px;border:1px solid var(--border,#333);background:var(--bg,#12141a);padding:6px 8px;display:none;'
    for (const f of formats) {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:1px 0;' +
        'border-bottom:1px solid rgba(255,255,255,.04);'
      const v = document.createElement('span')
      v.style.cssText = 'font-weight:600;min-width:36px;'
      v.textContent = String(f.format)
      const ver = document.createElement('span')
      ver.style.opacity = '.85'
      ver.textContent = f.versions
      const note = document.createElement('span')
      note.style.cssText = 'opacity:.5;font-size:9px;white-space:nowrap;'
      note.textContent = f.format > 64 ? 'min/max' : 'pack_format'
      row.appendChild(v)
      row.appendChild(ver)
      row.appendChild(note)
      tableBox.appendChild(row)
    }
    c.appendChild(tableBox)
    let tableOpen = false
    tableToggle.addEventListener('click', () => {
      tableOpen = !tableOpen
      tableBox.style.display = tableOpen ? 'block' : 'none'
      tableToggle.textContent = (tableOpen ? '▾' : '▸') + ' 查看完整版本对照表（' + formats.length + ' 个）'
    })

    /* 命名空间 */
    c.appendChild(label('命名空间'))
    const nsInput = document.createElement('input')
    nsInput.type = 'text'
    nsInput.value = 'minecraft'
    nsInput.placeholder = '小写字母/数字/_/-'
    nsInput.style.cssText = inputStyle()
    c.appendChild(nsInput)

    /* 输出形式 */
    c.appendChild(label('输出形式'))
    const outRow = document.createElement('div')
    outRow.style.cssText = 'display:flex;gap:12px;font-size:12px;'
    const dirRadio = document.createElement('input')
    dirRadio.type = 'radio'; dirRadio.name = 'cpbOut'; dirRadio.value = 'dir'; dirRadio.checked = true
    const zipRadio = document.createElement('input')
    zipRadio.type = 'radio'; zipRadio.name = 'cpbOut'; zipRadio.value = 'zip'
    outRow.appendChild(dirRadio)
    outRow.appendChild(document.createTextNode('目录（可直接放入 resourcepacks）'))
    outRow.appendChild(zipRadio)
    outRow.appendChild(document.createTextNode('ZIP 压缩包（便于分发）'))
    c.appendChild(outRow)

    /* 文件选择（项目惯用模式：直接 click，不 append 到 DOM）+ 可编辑包内路径 */
    c.appendChild(label('贴图/模型文件（拖入或点击选择）'))
    const fileZone = document.createElement('div')
    fileZone.style.cssText = 'border:1px dashed var(--border,#333);border-radius:8px;padding:12px;' +
      'text-align:center;font-size:11px;opacity:.7;cursor:pointer;background:var(--bg,#12141a);'
    fileZone.textContent = '点击选择文件，或拖拽到此区域'
    c.appendChild(fileZone)

    const fileList = document.createElement('div')
    fileList.style.cssText = 'margin-top:6px;max-height:160px;overflow:auto;'
    c.appendChild(fileList)

    const selectedFiles = []
    const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga', 'tif', 'tiff'])
    const MODEL_EXTS = new Set(['json', 'bbmodel'])

    function autoDest(fileName, ns) {
      const ext = (fileName.split('.').pop() || '').toLowerCase()
      if (IMG_EXTS.has(ext)) return 'assets/' + ns + '/textures/' + fileName
      if (MODEL_EXTS.has(ext)) return 'assets/' + ns + '/models/' + fileName
      return 'assets/' + ns + '/' + fileName
    }

    async function addFiles(fileObjs) {
      const ns = nsInput.value.trim() || 'matoga'
      for (const file of fileObjs) {
        try {
          const data = await readFileAsBase64(file)
          selectedFiles.push({ name: file.name, data, size: file.size, dest: autoDest(file.name, ns) })
        } catch {
          showToast('读取 ' + file.name + ' 失败')
        }
      }
      renderFileList()
    }

    function renderFileList() {
      fileList.innerHTML = ''
      selectedFiles.forEach((f, i) => {
        const row = document.createElement('div')
        row.style.cssText = 'padding:4px 6px;font-size:11px;border-radius:4px;' +
          'background:rgba(255,255,255,.04);margin-bottom:4px;'
        const head = document.createElement('div')
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;'
        const nm = document.createElement('span')
        nm.textContent = f.name + '  (' + Math.round(f.size / 1024) + ' KB)'
        const del = document.createElement('button')
        del.textContent = '✕'
        del.style.cssText = 'background:none;border:none;color:var(--text,#e8e8e8);cursor:pointer;font-size:12px;'
        del.addEventListener('click', () => { selectedFiles.splice(i, 1); renderFileList() })
        head.appendChild(nm)
        head.appendChild(del)
        row.appendChild(head)
        const destLabel = document.createElement('div')
        destLabel.style.cssText = 'font-size:9px;opacity:.5;margin-bottom:2px;'
        destLabel.textContent = '包内路径'
        row.appendChild(destLabel)
        const destInput = document.createElement('input')
        destInput.type = 'text'
        destInput.value = f.dest
        destInput.style.cssText = 'width:100%;box-sizing:border-box;padding:3px 6px;font-size:10px;' +
          'border-radius:4px;border:1px solid var(--border,#333);background:var(--bg,#12141a);' +
          'color:var(--text,#e8e8e8);outline:none;font-family:monospace;'
        destInput.addEventListener('change', () => { selectedFiles[i].dest = destInput.value.trim() })
        row.appendChild(destInput)
        fileList.appendChild(row)
      })
    }

    function pickFiles() {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.onchange = () => { if (input.files && input.files.length) addFiles([...input.files]) }
      input.click()
    }
    fileZone.addEventListener('click', pickFiles)
    fileZone.addEventListener('dragover', e => { e.preventDefault(); fileZone.style.opacity = '1' })
    fileZone.addEventListener('dragleave', () => { fileZone.style.opacity = '.7' })
    fileZone.addEventListener('drop', e => {
      e.preventDefault()
      fileZone.style.opacity = '.7'
      if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files])
    })

    /* pack.png 可选 */
    c.appendChild(label('pack.png 缩略图（可选，省略则自动绘制草方块图标）'))
    const pngRow = document.createElement('div')
    pngRow.style.cssText = 'display:flex;gap:8px;align-items:center;'
    const pngBtn = document.createElement('button')
    pngBtn.type = 'button'
    pngBtn.textContent = '选择图片…'
    pngBtn.style.cssText = mkBtn('', false).style.cssText + 'padding:4px 12px;'
    const pngName = document.createElement('span')
    pngName.style.cssText = 'font-size:11px;opacity:.7;'
    pngRow.appendChild(pngBtn)
    pngRow.appendChild(pngName)
    c.appendChild(pngRow)

    let pngData = null
    pngBtn.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/png'
      input.onchange = async () => {
        if (!input.files || !input.files.length) return
        try { pngData = await readFileAsBase64(input.files[0]); pngName.textContent = input.files[0].name } catch { showToast('读取缩略图失败') }
      }
      input.click()
    })

    /* 操作按钮 */
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;'
    const cancelBtn = mkBtn('取消', false)
    const createBtn = mkBtn('创建', true)
    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(createBtn)
    c.appendChild(btnRow)
    bd.appendChild(c)

    let done = false
    function finish(v) { if (done) return; done = true; document.removeEventListener('keydown', esc, true); bd.remove(); resolve(v) }
    const esc = e => { if (e.key === 'Escape') finish(null) }
    document.addEventListener('keydown', esc, true)
    cancelBtn.addEventListener('click', () => finish(null))
    bd.addEventListener('pointerdown', e => { if (e.target === bd) finish(null) })

    createBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim()
      if (!name) { showToast('请填写包名称'); nameInput.focus(); return }
      if (!selectedFiles.length) { showToast('请至少添加一个贴图/模型文件'); return }

      const lo = Number(minSelect.value)
      const hi = Number(maxSelect.value)
      const body = {
        name,
        description: descInput.value.trim() || undefined,
        namespace: nsInput.value.trim() || 'matoga',
        output: zipRadio.checked ? 'zip' : 'dir',
        files: selectedFiles.map(f => ({ data: f.data, name: f.name, dest: f.dest })),
      }
      if (lo === hi && lo <= 64) { body.packFormat = lo }
      else { body.minFormat = Math.min(lo, hi); body.maxFormat = Math.max(lo, hi) }
      if (pngData) body.packPngData = pngData

      createBtn.disabled = true
      createBtn.textContent = '创建中…'
      try {
        const r = await apiCall('POST', BUILDER_API + '/build', body)

        showToast('已创建：' + r.name + '（' + r.written + ' 个文件）' + (r.skipped ? '，跳过 ' + r.skipped : ''))
        if (onCreated) try { await onCreated(r) } catch {}
        finish(r)
      } catch (e) {
        showToast('创建失败：' + (e.message || e))
        createBtn.disabled = false
        createBtn.textContent = '创建'
      }
    })

    document.body.appendChild(bd)
    nameInput.focus()
    nameInput.select()
  })
}