/**
 * matoga - 新建模型对话框（从模板创建 MC 模型）
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * openCreateModelDialog({ onCreated }) → 弹出模态框：选择模板 + 命名 + 命名空间，
 * 调用 POST /api/custom-models 创建，随后在 3D 视口预览并派发 'custom-model:created' 事件。
 * previewCustomModel(id) → 获取官方包后用 viewCustomModelInViewport 展示。
 */

import { showToast } from './core.js'
import { t } from './i18n.js'
import { apiUrl } from './utils.js'
import { viewCustomModelInViewport, isViewportVisible } from './mc-model-viewer.js'

const CUSTOM_API = '/api/custom-models'
const Z_BASE = 91000



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

/* 获取官方材质包（用于解析 parent 链 + 加载贴图）；无则返回空 */
async function getOfficialPack() {
  try {
    const data = await apiCall('GET', '/api/mc-official/list')
    const packs = Array.isArray(data) ? data : (data && data.packs) || []
    if (packs.length && packs[0].name) return { api: '/api/mc-official', packName: packs[0].name }
  } catch {}
  return { api: undefined, packName: undefined }
}

/* 在 3D 视口预览自定义模型；视口不可见时尝试激活预览面板 3D tab */
export async function previewCustomModel(id, name) {
  try {
    const { api, packName } = await getOfficialPack()
    let r = await viewCustomModelInViewport({ id, api, packName })
    if (!r.shown && !isViewportVisible()) {
      const pvBtn = document.querySelector('.pv-tabs button[data-pv-tab="3d"]')
      if (pvBtn) pvBtn.click()
      r = await viewCustomModelInViewport({ id, api, packName })
    }
    if (r.shown) showToast(t('cm.toastPreviewed', { name: name || id }))
    else showToast(t('cm.toastPreviewNoView'))
  } catch (e) {
    showToast(t('cm.toastPreviewFail') + ': ' + (e.message || e))
  }
}

/* 激活 3D 视口（预览面板 3D tab 或独立视口） */
function tryActivate3D() {
  if (isViewportVisible()) return true
  const pvBtn = document.querySelector('.pv-tabs button[data-pv-tab="3d"]')
  if (pvBtn) { pvBtn.click(); return true }
  return false
}

/* ── 模态框构建（内联样式，与 ui-dialog.js 风格一致） ── */
function backdrop(z) {
  const el = document.createElement('div')
  el.className = 'cm-dialog-backdrop'
  el.style.cssText = `position:fixed;inset:0;z-index:${z};background:rgba(0,0,0,.5);` +
    'display:flex;align-items:center;justify-content:center;font-family:inherit;'
  return el
}

function card() {
  const c = document.createElement('div')
  c.className = 'cm-dialog'
  c.style.cssText = 'width:min(560px,calc(100vw - 48px));max-height:calc(100vh - 80px);overflow:auto;' +
    'border-radius:10px;background:var(--bg2,#1c1f26);color:var(--text,#e8e8e8);border:1px solid var(--border,#333);' +
    'box-shadow:0 12px 40px rgba(0,0,0,.5);padding:16px 18px;box-sizing:border-box;'
  return c
}

function sectionLabel(text) {
  const l = document.createElement('div')
  l.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:.5px;opacity:.85;margin:12px 0 6px;'
  l.textContent = text
  return l
}

function templateTile(tpl, selected, onPick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 10px;' +
    'border-radius:8px;cursor:pointer;text-align:left;border:1px solid var(--border,#333);' +
    'background:var(--bg,#12141a);color:var(--text,#e8e8e8);transition:border-color .15s,background .15s;'
  const nm = document.createElement('span')
  nm.style.cssText = 'font-size:12px;font-weight:600;'
  nm.textContent = tpl.name
  const ds = document.createElement('span')
  ds.style.cssText = 'font-size:10px;opacity:.65;'
  ds.textContent = tpl.description || ''
  const ct = document.createElement('span')
  ct.style.cssText = 'font-size:9px;opacity:.5;align-self:flex-end;'
  ct.textContent = tpl.category || ''
  b.appendChild(nm); b.appendChild(ds); b.appendChild(ct)
  const applySel = () => {
    b.style.borderColor = 'var(--primary,#2b6cff)'
    b.style.background = 'rgba(43,108,255,.12)'
  }
  const clearSel = () => {
    b.style.borderColor = 'var(--border,#333)'
    b.style.background = 'var(--bg,#12141a)'
  }
  if (selected) applySel()
  b.addEventListener('click', () => { clearSel(); applySel(); onPick(tpl) })
  b._clear = clearSel
  return b
}

export async function openCreateModelDialog(opts = {}) {
  const onCreated = opts.onCreated
  let templates = []
  try {
    const data = await apiCall('GET', CUSTOM_API + '/templates')
    templates = (data && data.templates) || []
  } catch (e) {
    showToast(t('cm.toastLoadTplFail') + ': ' + (e.message || e))
    return null
  }
  if (!templates.length) { showToast(t('cm.toastNoTemplates')); return null }

  return new Promise(resolve => {
    const z = Z_BASE
    const bd = backdrop(z)
    const c = card()

    const h = document.createElement('div')
    h.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:4px;'
    h.textContent = t('cm.title')
    c.appendChild(h)

    let selectedTpl = templates[0]
    const onPick = (tpl) => { selectedTpl = tpl }
    const blocks = templates.filter(x => x.category !== 'item')
    const items = templates.filter(x => x.category === 'item')

    c.appendChild(sectionLabel(t('cm.blockTemplates')))
    const grid1 = document.createElement('div')
    grid1.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;'
    blocks.forEach(tpl => grid1.appendChild(templateTile(tpl, tpl === selectedTpl, onPick)))
    c.appendChild(grid1)

    if (items.length) {
      c.appendChild(sectionLabel(t('cm.itemTemplates')))
      const grid2 = document.createElement('div')
      grid2.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;'
      items.forEach(tpl => grid2.appendChild(templateTile(tpl, tpl === selectedTpl, onPick)))
      c.appendChild(grid2)
    }

    c.appendChild(sectionLabel(t('cm.nameLabel')))
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.value = 'my_model'
    nameInput.placeholder = t('cm.namePh')
    nameInput.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;font-size:12px;border-radius:6px;' +
      'border:1px solid var(--border,#333);background:var(--bg,#12141a);color:var(--text,#e8e8e8);outline:none;'
    c.appendChild(nameInput)

    c.appendChild(sectionLabel(t('cm.nsLabel')))
    const nsInput = document.createElement('input')
    nsInput.type = 'text'
    nsInput.value = 'minecraft'
    nsInput.placeholder = 'minecraft'
    nsInput.style.cssText = nameInput.style.cssText
    c.appendChild(nsInput)

    const row = document.createElement('div')
    row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;'
    const mkBtn = (text, primary) => {
      const b = document.createElement('button')
      b.textContent = text
      b.style.cssText = 'padding:6px 18px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid var(--border,#333);' +
        (primary
          ? 'background:var(--primary,#2b6cff);border-color:var(--primary,#2b6cff);color:#fff;'
          : 'background:var(--bg,#12141a);color:var(--text,#e8e8e8);')
      return b
    }
    const cancelBtn = mkBtn(t('cm.cancel'), false)
    const createBtn = mkBtn(t('cm.create'), true)
    row.appendChild(cancelBtn); row.appendChild(createBtn)
    c.appendChild(row)
    bd.appendChild(c)

    let done = false
    function finish(v) { if (done) return; done = true; document.removeEventListener('keydown', esc, true); bd.remove(); resolve(v) }
    const esc = e => { if (e.key === 'Escape') finish(null) }
    document.addEventListener('keydown', esc, true)
    cancelBtn.addEventListener('click', () => finish(null))
    bd.addEventListener('pointerdown', e => { if (e.target === bd) finish(null) })

    createBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim()
      if (!name) { showToast(t('cm.toastNameEmpty')); nameInput.focus(); return }
      const ns = nsInput.value.trim() || 'minecraft'
      createBtn.disabled = true
      createBtn.textContent = t('cm.creating')
      try {
        const r = await apiCall('POST', CUSTOM_API, { template: selectedTpl.id, name, namespace: ns })
        showToast(t('cm.toastCreated', { name: r.name }))
        document.dispatchEvent(new CustomEvent('custom-model:created', { detail: r }))
        if (onCreated) try { await onCreated(r) } catch {}
        tryActivate3D()
        await previewCustomModel(r.id, r.name)
        finish(r)
      } catch (e) {
        showToast(t('cm.toastCreateFail') + ': ' + (e.message || e))
        createBtn.disabled = false
        createBtn.textContent = t('cm.create')
      }
    })

    document.body.appendChild(bd)
    nameInput.focus()
    nameInput.select()
  })
}