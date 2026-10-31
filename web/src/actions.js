/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
  state,
  showToast,
  undoBtn,
  compareBtn2,
  swapBtn2,
  recursiveChk,
  hashChk,
  onlyMissingChk,
  ignoreChk,
  ignoreInput,
  leftPathEl,
  rightPathEl,
  KIND_TEXT,
  ROLES
} from './core.js'
import {
  formatSize,
  formatDate,
  isImageFile,
  fileUrl,
  hasAny,
  leftRoles,
  rightRoles,
  mainEntryOf,
  getIgnorePatterns,
  relPath,
  joinPath
} from './utils.js'
import { compare } from './compare.js'
import { modelDestKey } from './model-dest-key.js'
import { applyEntries, setLoading, renderResult, renderSidebar } from './render.js'
import { t, getLocale } from './i18n.js'
import { uiConfirm } from './ui-dialog.js'

export function pushHistory(entries) {
  state.history.push({ entries, time: Date.now() })
  if (state.history.length > 50) state.history.shift()
  updateUndoBtn()
}

export function updateUndoBtn() {
  if (undoBtn) undoBtn.disabled = state.history.length === 0
}

export async function undo() {
  if (state.history.length === 0) {
    showToast(t('toast.noUndo'))
    return
  }
  const last = state.history[state.history.length - 1]
  let ok = 0,
    fail = 0
  const errors = []
  for (const e of last.entries) {
    if (e.backupPath) {
      const r = await window.api.copyFile(e.backupPath, e.destPath)
      if (r.success) ok++
      else {
        fail++
        errors.push(r.error || t('toast.restoreFail'))
      }
    } else {
      const r = await window.api.deleteFile(e.destPath)
      if (r.success) ok++
      else {
        fail++
        errors.push(r.error || t('toast.deleteFail'))
      }
    }
  }
  if (ok > 0) {
    state.history.pop()
    updateUndoBtn()
    const savedKey = state.selected ? state.selected.key : null
    await reloadAndCompare()
    if (savedKey) {
      const g = state.result.find(r => r.key === savedKey)
      if (g) {
        state.selected = g
        renderResult()
        renderSidebar()
      }
    }
    showToast(fail ? t('toast.undoneWithFail', { n: ok, fail }) : t('toast.undone', { n: ok }))
  } else {
    showToast(t('toast.undoFail', { msg: errors[0] || t('toast.unknownError') }))
  }
}

export async function loadFromPath(side, folderPath, opts) {
  setLoading(side, true)
  const forceRecursive = !!(opts && opts.forceRecursive)
  if (forceRecursive && recursiveChk && !recursiveChk.checked) {
    recursiveChk.checked = true
    window.api.setConfig({ recursive: true })
  }
  const recursive = forceRecursive || recursiveChk.checked
  const ignore = getIgnorePatterns()
  const res = recursive
    ? await window.api.readRecursive(folderPath, ignore)
    : await window.api.readEntries(folderPath, ignore)
  setLoading(side, false)
  if (!res.success) {
    showToast(t('toast.readFail', { msg: res.error }))
    return
  }
  applyEntries(side, folderPath, res.entries)
  updateCompareButton()
  window.api.setConfig({ [side + 'Path']: folderPath })
}

export async function loadFolder(side) {
  const folderPath = await window.api.selectFolder(side)
  if (!folderPath) return
  await loadFromPath(side, folderPath)
}

export function updateCompareButton() {
  const enabled = !!(state.leftPath && state.rightPath)

  if (compareBtn2) compareBtn2.disabled = !enabled
}

export function saveOptions() {
  window.api.setConfig({
    recursive: recursiveChk.checked,
    hash: hashChk.checked,
    onlyMissing: onlyMissingChk.checked,
    ignoreSys: ignoreChk.checked,
    ignoreCustom: ignoreInput.value,
    viewMode: state.viewMode,
    sortKey: state.sortKey,
    sortDir: state.sortDir,

    hiddenKeys: [...state.hiddenKeys],
    categoryFilter: state.categoryFilter,
    resultSearchTerm: state.resultSearchTerm,
    customTags: state.customTags,
    modelGroupBy: state.modelGroupBy,
    modelGroupDir: state.modelGroupDir,
    modelGroupRules: state.modelGroupRules
  })
}

export function setGroupTag(g, tag) {
  if (!g || !tag) return
  state.customTags[g.key] = tag
  saveOptions()
  renderResult()
  if (state.selected && state.selected.key === g.key) renderSidebar()
  showToast(t('toast.tagSet', { name: g.key, tag }))
}

export function clearGroupTag(g) {
  if (!g) return
  delete state.customTags[g.key]
  saveOptions()
  renderResult()
  if (state.selected && state.selected.key === g.key) renderSidebar()
  showToast(t('toast.tagCleared', { name: g.key }))
}

export function handleAction(act, g) {
  const pickEntry = side => {
    const s = g[side]
    if (!s) return null
    return s.main || s.file || s.dir || s.normal || s.specular || null
  }
  const lt = pickEntry('left')
  const rt = pickEntry('right')
  if (act === 'open-left' && lt) window.api.openPath(lt.fullPath)
  else if (act === 'open-right' && rt) window.api.openPath(rt.fullPath)
  else if (act === 'loc-left' && lt) window.api.showInFolder(lt.fullPath)
  else if (act === 'loc-right' && rt) window.api.showInFolder(rt.fullPath)
  else if (act === 'copy') {
    navigator.clipboard
      .writeText(g.key)
      .then(() => showToast(t('toast.copiedName')))
      .catch(() => showToast(t('toast.copyFail')))
  } else if (act === 'copy-to-right') copyToSide(g, 'right')
  else if (act === 'copy-to-left') copyToSide(g, 'left')
  else if (act === 'upload-model-right') uploadModelToRight(g)
  else if (act === 'copy-model-right') copyLeftModelToRight(g)
}

export async function copyToSide(g, destSide) {
  const srcSide = destSide === 'right' ? 'left' : 'right'
  const destBase = destSide === 'right' ? state.rightPath : state.leftPath
  const srcBase = destSide === 'right' ? state.leftPath : state.rightPath
  if (!destBase) {
    showToast(t('toast.destNotSelected'))
    return
  }
  const pairs = collectCopyPairs(g, srcSide, destSide, srcBase, destBase)
  if (!pairs.length) {
    showToast(t('toast.noCopyFiles'))
    return
  }
  const willBackup = pairs.filter(p => p.backup).length
  const backupMsg = willBackup ? t('confirm.hasBackup', { n: willBackup }) : t('confirm.noBackup')
  const msg = t('confirm.replaceSingle', {
    n: pairs.length,
    src: t('common.' + srcSide),
    dest: t('common.' + destSide),
    backup: backupMsg
  })
  if (!(await uiConfirm({ title: '确认操作', message: msg }))) return
  const r = await executeCopy(pairs)
  if (r.cancelled) showToast(t('toast.copyCancelled'))
  else showToast(r.fail ? t('toast.replacedWithFail', { n: r.ok, fail: r.fail }) : t('toast.replaced', { n: r.ok }))
  await reloadAndCompare()
}

export function collectCopyPairs(g, srcSide, destSide, srcBase, destBase) {
  const pairs = []
  const addPair = (se, de) => {
    if (!se || se.isDirectory) return
    const rel = relPath(srcBase, se.fullPath)
    pairs.push({
      src: se.fullPath,
      dest: joinPath(destBase, rel),
      backup: de && !de.isDirectory ? de.fullPath : null,
      name: se.name
    })
  }
  if (g.isMaterial) {
    for (const role of ROLES) addPair(g[srcSide] && g[srcSide][role], g[destSide] && g[destSide][role])
  } else {
    addPair(g[srcSide] && (g[srcSide].file || g[srcSide].dir), g[destSide] && (g[destSide].file || g[destSide].dir))
  }
  return pairs
}

export async function executeCopy(pairs) {
  if (window.api.copyFilesBatch && pairs.length >= 2) {
    return await executeCopyBatch(pairs)
  }
  let ok = 0,
    fail = 0
  const hist = []
  for (const p of pairs) {
    let bkPath = null
    if (p.backup) {
      const bk = await window.api.backupFile(p.backup)
      if (!bk.success) {
        fail++
        continue
      }
      bkPath = bk.backupPath
    }
    const r = await window.api.copyFile(p.src, p.dest)
    if (r.success) {
      ok++
      hist.push({ destPath: p.dest, backupPath: bkPath })
    } else fail++
  }
  if (hist.length) pushHistory(hist)
  return { ok, fail }
}

async function executeCopyBatch(pairs) {
  const modal = document.getElementById('syncModal')
  const bar = document.getElementById('syncBar')
  const countEl = document.getElementById('syncCount')
  const okFailEl = document.getElementById('syncOkFail')
  const nameEl = document.getElementById('syncName')
  const cancelBtn = document.getElementById('syncCancel')
  const titleEl = document.getElementById('syncTitle')
  if (!modal) return executeCopySequential(pairs)

  titleEl.textContent = t('common.batchCopy') || '批量复制'
  cancelBtn.textContent = t('common.cancel') || '取消'
  cancelBtn.disabled = false
  bar.style.width = '0%'
  countEl.textContent = '0/' + pairs.length
  okFailEl.textContent = ''
  nameEl.textContent = ''
  modal.style.display = 'flex'

  const hist = []
  let cancelled = false
  const onProgress = msg => {
    bar.style.width = (msg.total ? (msg.current / msg.total) * 100 : 0) + '%'
    countEl.textContent = msg.current + '/' + msg.total
    okFailEl.textContent = '✓' + msg.ok + ' ✗' + msg.fail
    nameEl.textContent = msg.name || ''
    if (msg.status === 'ok') hist.push({ destPath: msg.dest, backupPath: msg.backupPath })
  }
  const onCancel = () => {
    cancelled = true
    cancelBtn.disabled = true
    if (jobCancel) jobCancel()
  }
  cancelBtn.addEventListener('click', onCancel, { once: true })

  let r
  let jobCancel = null
  try {
    const job = window.api.copyFilesBatch(pairs, onProgress)
    jobCancel = job.cancel
    r = await job.promise
  } catch (e) {
    r = { ok: 0, fail: pairs.length, error: e.message }
  }
  cancelBtn.removeEventListener('click', onCancel)
  modal.style.display = 'none'
  if (hist.length) pushHistory(hist)
  return { ok: r.ok || 0, fail: r.fail || 0, cancelled: cancelled || r.cancelled }
}

async function executeCopySequential(pairs) {
  let ok = 0,
    fail = 0
  const hist = []
  for (const p of pairs) {
    let bkPath = null
    if (p.backup) {
      const bk = await window.api.backupFile(p.backup)
      if (!bk.success) {
        fail++
        continue
      }
      bkPath = bk.backupPath
    }
    const r = await window.api.copyFile(p.src, p.dest)
    if (r.success) {
      ok++
      hist.push({ destPath: p.dest, backupPath: bkPath })
    } else fail++
  }
  if (hist.length) pushHistory(hist)
  return { ok, fail }
}

export async function reloadAndCompare() {
  const prevKey = state.selected && state.selected.key
  const savedExpanded = new Set(state.expandedKeys)
  if (state.leftPath) await loadFromPath('left', state.leftPath, { forceRecursive: true })
  if (state.rightPath) await loadFromPath('right', state.rightPath, { forceRecursive: true })
  if (state.leftPath && state.rightPath) await compare()
  if (prevKey) {
    const g = state.result.find(g => g.key === prevKey)
    if (g) {
      state.selected = g
      for (const k of savedExpanded) state.expandedKeys.add(k)
      renderResult()
      renderSidebar()
    } else {
      const fallback = state.result.find(r => r.isModel)
      if (fallback) {
        state.selected = fallback
        renderResult()
        renderSidebar()
      }
    }
  }
}

export async function replaceWithExternalFile(currentPath) {
  const newFile = await window.api.selectFile()
  if (!newFile) return
  const bk = await window.api.backupFile(currentPath)
  if (!bk.success) {
    showToast(t('toast.backupFailCancel2'))
    return
  }
  const r = await window.api.copyFile(newFile, currentPath)
  if (r.success) {
    pushHistory([{ destPath: currentPath, backupPath: bk.backupPath }])
    showToast(t('toast.replacedTex'))
    await reloadAndCompare()
  } else showToast(t('toast.replaceFail', { msg: r.error }))
}

export async function deleteTexture(filePath) {
  if (!(await uiConfirm({ title: '确认操作', message: t('confirm.deleteTex'), danger: true }))) return
  const bk = await window.api.backupFile(filePath)
  if (!bk.success) {
    showToast(t('toast.backupFailCancel2'))
    return
  }
  const r = await window.api.deleteFile(filePath)
  if (r.success) {
    pushHistory([{ destPath: filePath, backupPath: bk.backupPath }])
    showToast(t('toast.deletedTex'))
    await reloadAndCompare()
  } else showToast(t('toast.deleteFailMsg', { msg: r.error }))
}

export async function copySingleToRight(srcPath, destPath) {
  if (!(await uiConfirm({ title: t('common.batchCopy'), message: t('confirm.copySingleRight') }))) return
  const r = await window.api.copyFile(srcPath, destPath)
  if (r.success) {
    pushHistory([{ destPath, backupPath: null }])
    showToast(t('toast.replacedTex'))
    await reloadAndCompare()
  } else showToast(t('toast.replaceFail', { msg: r.error }))
}

export async function addTextureToRight(destPath) {
  const newFile = await window.api.selectFile()
  if (!newFile) return
  const r = await window.api.copyFile(newFile, destPath)
  if (r.success) {
    pushHistory([{ destPath, backupPath: null }])
    showToast(t('toast.addedTex'))
    await reloadAndCompare()
  } else showToast(t('toast.replaceFail', { msg: r.error }))
}


export async function uploadModelToRight(g) {
  if (!state.rightPath) {
    showToast(t('toast.destNotSelected'))
    return
  }
  const newFile = await window.api.selectModelFile()
  if (!newFile) return
  const destKey = modelDestKey(g.key, newFile)
  const destPath = joinPath(state.rightPath, destKey)
  const lastSep = Math.max(destPath.lastIndexOf('/'), destPath.lastIndexOf('\\'))
  if (lastSep > 0) await window.api.createFolder(destPath.slice(0, lastSep))
  const re = g.right && (g.right.file || g.right.dir)
  let bkPath = null
  if (re && !re.isDirectory) {
    const bk = await window.api.backupFile(re.fullPath)
    if (!bk.success) {
      showToast(t('toast.backupFailCancel2'))
      return
    }
    bkPath = bk.backupPath
  }
  const r = await window.api.copyFile(newFile, destPath)
  if (r.success) {
    pushHistory([{ destPath, backupPath: bkPath }])
    showToast(t('toast.addedModel'))
    await reloadAndCompare()
  } else showToast(t('toast.replaceFail', { msg: r.error }))
}

export async function copyLeftModelToRight(g) {
  if (!state.rightPath) {
    showToast(t('toast.destNotSelected'))
    return
  }
  const le = g && g.left && (g.left.file || g.left.dir)
  if (!le || le.isDirectory) {
    showToast(t('toast.noLeftModel'))
    return
  }
  const srcPath = le.fullPath
  const destPath = joinPath(state.rightPath, g.key)
  const lastSep = Math.max(destPath.lastIndexOf('/'), destPath.lastIndexOf('\\'))
  if (lastSep > 0) await window.api.createFolder(destPath.slice(0, lastSep))
  const re = g.right && (g.right.file || g.right.dir)
  let bkPath = null
  if (re && !re.isDirectory) {
    const bk = await window.api.backupFile(re.fullPath)
    if (!bk.success) {
      showToast(t('toast.backupFailCancel2'))
      return
    }
    bkPath = bk.backupPath
  }
  const r = await window.api.copyFile(srcPath, destPath)
  if (r.success) {
    pushHistory([{ destPath, backupPath: bkPath }])
    showToast(t('toast.copiedModel'))
    await reloadAndCompare()
  } else showToast(t('toast.replaceFail', { msg: r.error }))
}

export function blankTexDataUrl(role) {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const ctx = c.getContext('2d')
  const colors = { main: '#ffffff', normal: '#8080ff', specular: '#000000' }
  ctx.fillStyle = colors[role] || '#000000'
  ctx.fillRect(0, 0, 16, 16)
  return c.toDataURL('image/png')
}

export async function createBlankTextureToRight(g, role) {
  if (!state.rightPath) {
    showToast(t('toast.destNotSelected'))
    return
  }
  const mainEntry = (g.right && g.right.main) || (g.left && g.left.main)
  if (!mainEntry) {
    showToast(t('toast.noMainTex'))
    return
  }
  const dot = mainEntry.name.lastIndexOf('.')
  const ext = dot >= 0 ? mainEntry.name.slice(dot) : '.png'
  const suf = role === 'normal' ? '_n' : '_s'
  const destPath = joinPath(state.rightPath, g.key + suf + ext)
  const re = g.right && g.right[role]
  let bkPath = null
  if (re && !re.isDirectory) {
    const bk = await window.api.backupFile(re.fullPath)
    if (!bk.success) {
      showToast(t('toast.backupFailCancel2'))
      return
    }
    bkPath = bk.backupPath
  }
  const r = await window.api.writeFile(destPath, blankTexDataUrl(role))
  if (r.success) {
    pushHistory([{ destPath, backupPath: bkPath }])
    showToast(t('toast.createdBlankTex'))
    await reloadAndCompare()
  } else showToast(t('toast.replaceFail', { msg: r.error }))
}

const BLANK_SET_ROLES = [
  { role: 'main', suffix: '' },
  { role: 'normal', suffix: '_n' },
  { role: 'specular', suffix: '_s' }
]

export async function createBlankTextureSetToRight(g) {
  if (!state.rightPath) {
    showToast(t('toast.destNotSelected'))
    return
  }
  const mainEntry = (g.right && g.right.main) || (g.left && g.left.main)
  const dot = mainEntry ? mainEntry.name.lastIndexOf('.') : -1
  const ext = dot >= 0 ? mainEntry.name.slice(dot) : '.png'
  const history = []
  for (const { role, suffix } of BLANK_SET_ROLES) {
    const destPath = joinPath(state.rightPath, g.key + suffix + ext)
    const re = g.right && g.right[role]
    let bkPath = null
    if (re && !re.isDirectory) {
      const bk = await window.api.backupFile(re.fullPath)
      if (!bk.success) {
        showToast(t('toast.backupFailCancel2'))
        return
      }
      bkPath = bk.backupPath
    }
    const r = await window.api.writeFile(destPath, blankTexDataUrl(role))
    if (!r.success) {
      showToast(t('toast.replaceFail', { msg: r.error }))
      return
    }
    history.push({ destPath, backupPath: bkPath })
  }
  pushHistory(history)
  showToast(t('toast.createdBlankTexSet', { n: history.length }))
  await reloadAndCompare()
}

export async function batchCopyToSide(destSide) {
  const srcSide = destSide === 'right' ? 'left' : 'right'
  const destBase = destSide === 'right' ? state.rightPath : state.leftPath
  const srcBase = destSide === 'right' ? state.leftPath : state.rightPath
  if (!destBase) {
    showToast(t('toast.destNotSelected'))
    return
  }
  const allPairs = []
  for (const g of state.result) {
    if (g.kind === 'have') continue
    const pairs = collectCopyPairs(g, srcSide, destSide, srcBase, destBase)
    allPairs.push(...pairs)
  }
  if (!allPairs.length) {
    showToast(t('toast.noNeedReplace'))
    return
  }
  const willBackup = allPairs.filter(p => p.backup).length
  const backupMsg = willBackup ? t('confirm.hasBackup', { n: willBackup }) : t('confirm.noBackup')
  const msg = t('confirm.batchReplace', {
    n: allPairs.length,
    src: t('common.' + srcSide),
    dest: t('common.' + destSide),
    backup: backupMsg
  })
  if (!(await uiConfirm({ title: t('common.batchCopy'), message: msg }))) return
  const r = await executeCopy(allPairs)
  if (r.cancelled) showToast(t('toast.copyCancelled'))
  else
    showToast(
      r.fail ? t('toast.batchReplacedWithFail', { n: r.ok, fail: r.fail }) : t('toast.batchReplaced', { n: r.ok })
    )
  await reloadAndCompare()
}

export function exportResult() {
  if (state.result.length === 0) {
    showToast(t('toast.noExportData'))
    return
  }
  const lines = []
  lines.push(t('export.title'))
  lines.push(t('export.time', { time: new Date().toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US') }))
  lines.push(t('export.left', { path: state.leftPath }))
  lines.push(t('export.right', { path: state.rightPath }))
  lines.push('')
  lines.push(t('export.header'))
  lines.push('-'.repeat(70))
  for (const g of state.result) {
    const type = g.isMaterial
      ? t('type.material')
      : g.isModel
        ? t('type.model')
        : g.isDir
          ? t('type.folder')
          : t('type.file')
    const lc = g.isMaterial ? leftRoles(g).length : hasAny(g.left) ? 1 : 0
    const rc = g.isMaterial ? rightRoles(g).length : hasAny(g.right) ? 1 : 0
    lines.push([KIND_TEXT[g.kind], type, g.key, lc, rc].join('\t'))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = t('export.fileName', { ts: Date.now() })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast(t('toast.exported'))
}

export function exportHtml() {
  if (state.result.length === 0) {
    showToast(t('toast.noExportData'))
    return
  }
  const c = state.counts || {}
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const statusColor = { have: '#14ae67', diff: '#f7a600', partial: '#b8860b', miss: '#e5484d', extra: '#d97706' }
  const rows = []
  for (const g of state.result) {
    const type = g.isMaterial
      ? t('type.material')
      : g.isModel
        ? t('type.model')
        : g.isDir
          ? t('type.folder')
          : t('type.file')
    const color = statusColor[g.kind] || '#999'
    let leftThumb = '—',
      rightThumb = '—'
    const ml = g.isMaterial ? g.left && g.left.main : g.left && (g.left.file || g.left.dir)
    const mr = g.isMaterial ? g.right && g.right.main : g.right && (g.right.file || g.right.dir)
    if (ml && !ml.isDirectory && isImageFile(ml.name))
      leftThumb = `<img src="${fileUrl(ml.fullPath)}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;" />`
    if (mr && !mr.isDirectory && isImageFile(mr.name))
      rightThumb = `<img src="${fileUrl(mr.fullPath)}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;" />`
    rows.push(
      `<tr><td style="color:${color};font-weight:600;">${esc(KIND_TEXT[g.kind])}</td><td>${leftThumb}</td><td>${rightThumb}</td><td>${esc(g.key)}</td><td>${type}</td><td>${formatSize((ml || mr)?.size)}</td></tr>`
    )
  }
  const summary = t('export.htmlSummary', {
    left: esc(state.leftPath),
    right: esc(state.rightPath),
    have: c.have || 0,
    diff: c.diff || 0,
    partial: c.partial || 0,
    miss: c.miss || 0,
    extra: c.extra || 0
  })
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t('export.htmlTitle')}</title><style>body{font-family:system-serif;padding:20px;}h1{font-size:18px;}table{width:100%;border-collapse:collapse;font-size:13px;}th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left;}th{background:#f5f7fa;}.sum{margin:10px 0;padding:10px;background:#f5f7fa;border-radius:8px;}</style></head><body><h1>${t('export.htmlH1')}</h1><div class="sum">${summary}</div><table><thead><tr>${t('export.htmlHeader')}</tr></thead><tbody>${rows.join('')}</tbody></table></body></html>`
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = t('export.htmlFileName', { ts: Date.now() })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast(t('toast.exportedHtml'))
}

export function showPixelDiff(pairs, panel) {
  const btn = document.getElementById('pixelDiffBtn')
  if (btn) btn.disabled = true
  const existing = panel.querySelector('.pv-diff-result')
  if (existing) existing.remove()
  const container = document.createElement('div')
  container.className = 'pv-diff-result'
  container.innerHTML = `<div style="color:#ccc;font-size:12px;">${t('toast.computing')}</div>`
  panel.appendChild(container)

  Promise.all(
    pairs.map(
      ([le, re, label]) =>
        new Promise(resolve => {
          const imgL = new Image(),
            imgR = new Image()
          imgL.onload = imgR.onload = () => {
            if (imgL.complete && imgR.complete) resolve([imgL, imgR, label])
          }
          imgL.onerror = imgR.onerror = () => resolve(null)
          imgL.src = fileUrl(le.fullPath)
          imgR.src = fileUrl(re.fullPath)
          if (imgL.complete && imgR.complete) resolve([imgL, imgR, label])
        })
    )
  ).then(results => {
    container.innerHTML = ''
    const valid = results.filter(r => r)
    if (!valid.length) {
      container.innerHTML = `<div style="color:#ccc;font-size:12px;">${t('toast.cannotCompute')}</div>`
      if (btn) btn.disabled = false
      return
    }

    const toolbar = document.createElement('div')
    toolbar.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;'
    const modes = [
      ['diff', t('diff.modeDiff')],
      ['heat', t('diff.modeHeat')],
      ['channel', t('diff.modeChannel')],
      ['hist', t('diff.modeHist')]
    ]
    let currentMode = 'diff'
    modes.forEach(([key, label]) => {
      const mb = document.createElement('button')
      mb.className = 'pv-diff-mode-btn' + (key === 'diff' ? ' active' : '')
      mb.textContent = label
      mb.dataset.mode = key
      mb.style.cssText =
        'background:#2a3a5c;color:#a0b0d0;border:1px solid #3a4a6c;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;'
      toolbar.appendChild(mb)
    })
    container.appendChild(toolbar)

    const content = document.createElement('div')
    container.appendChild(content)

    const MAX_DIFF_DIM = 512
    const computed = valid.map(([imgL, imgR, label]) => {
      const ow = Math.max(imgL.naturalWidth, imgR.naturalWidth)
      const oh = Math.max(imgL.naturalHeight, imgR.naturalHeight)
      const sc = Math.min(1, MAX_DIFF_DIM / Math.max(ow, oh))
      const w = Math.max(1, Math.round(ow * sc)),
        h = Math.max(1, Math.round(oh * sc))
      const cL = document.createElement('canvas'),
        cR = document.createElement('canvas')
      cL.width = cR.width = w
      cL.height = cR.height = h
      const xL = cL.getContext('2d'),
        xR = cR.getContext('2d')
      xL.drawImage(imgL, 0, 0, w, h)
      xR.drawImage(imgR, 0, 0, w, h)
      const dL = xL.getImageData(0, 0, w, h),
        dR = xR.getImageData(0, 0, w, h)
      const diff = new Uint8ClampedArray(w * h)
      const histData = new Uint32Array(256)
      let totalDiff = 0
      const channelDiff = [0, 0, 0]
      for (let i = 0, p = 0; i < dL.data.length; i += 4, p++) {
        const dr = Math.abs(dL.data[i] - dR.data[i])
        const dg = Math.abs(dL.data[i + 1] - dR.data[i + 1])
        const db = Math.abs(dL.data[i + 2] - dR.data[i + 2])
        const d = (dr + dg + db) / 3
        totalDiff += d
        channelDiff[0] += dr
        channelDiff[1] += dg
        channelDiff[2] += db
        diff[p] = d
        histData[Math.min(255, Math.round(d))]++
      }
      return { w, h, ow, oh, dL, dR, diff, histData, totalDiff, channelDiff, label }
    })

    function render() {
      content.innerHTML = ''
      for (const c of computed) {
        const { w, h, ow, oh, dL, dR, diff, histData, totalDiff, channelDiff, label } = c
        const pct = ((totalDiff / (w * h * 255)) * 100).toFixed(2)
        const row = document.createElement('div')
        row.style.cssText = 'margin-bottom:12px;'
        const dimNote = w !== ow || h !== oh ? ` (${w}×${h})` : ''
        row.innerHTML = `<div style="color:#fff;font-size:11px;margin-bottom:4px;">${t('diff.rowLabel', { label, pct, r: ((channelDiff[0] / (w * h * 255)) * 100).toFixed(1), g: ((channelDiff[1] / (w * h * 255)) * 100).toFixed(1), b: ((channelDiff[2] / (w * h * 255)) * 100).toFixed(1) })}${dimNote}</div>`

        if (currentMode === 'hist') {
          const cH = document.createElement('canvas')
          cH.width = 260
          cH.height = 80
          const xH = cH.getContext('2d')
          const maxV = Math.max(...histData)
          xH.fillStyle = '#1a1a2e'
          xH.fillRect(0, 0, 260, 80)
          for (let i = 0; i < 256; i++) {
            const bh = maxV > 0 ? (histData[i] / maxV) * 75 : 0
            xH.fillStyle = `hsl(${240 - (i / 255) * 240}, 70%, 55%)`
            xH.fillRect(i + 2, 78 - bh, 1, bh)
          }
          xH.fillStyle = '#666'
          xH.font = '9px sans-serif'
          xH.fillText('0', 2, 80)
          xH.fillText('255', 248, 80)
          cH.style.cssText = 'border-radius:4px;background:#1a1a2e;'
          row.appendChild(cH)
        } else if (currentMode === 'channel') {
          const channels = [
            ['R', 0, '#ff4444'],
            ['G', 1, '#44ff44'],
            ['B', 2, '#4444ff'],
            ['A', 3, '#aaaaaa']
          ]
          const wrap = document.createElement('div')
          wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;'
          channels.forEach(([name, ci, color]) => {
            const cC = document.createElement('canvas')
            cC.width = w
            cC.height = h
            const xC = cC.getContext('2d')
            const dC = xC.createImageData(w, h)
            for (let i = 0; i < dL.data.length; i += 4) {
              const dv = Math.abs(dL.data[i + ci] - dR.data[i + ci])
              if (ci === 3) {
                dC.data[i] = dv
                dC.data[i + 1] = dv
                dC.data[i + 2] = dv
                dC.data[i + 3] = 255
              } else {
                dC.data[i] = ci === 0 ? dv : 0
                dC.data[i + 1] = ci === 1 ? dv : 0
                dC.data[i + 2] = ci === 2 ? dv : 0
                dC.data[i + 3] = 255
              }
            }
            xC.putImageData(dC, 0, 0)
            const sub = document.createElement('div')
            sub.style.cssText = `text-align:center;`
            sub.innerHTML = `<div style="color:${color};font-size:10px;margin-bottom:2px;">${name}</div>`
            cC.style.cssText = 'max-width:100px;border-radius:4px;background:#000;'
            sub.appendChild(cC)
            wrap.appendChild(sub)
          })
          row.appendChild(wrap)
        } else {
          const cL = document.createElement('canvas'),
            cR = document.createElement('canvas'),
            cD = document.createElement('canvas')
          cL.width = cR.width = cD.width = w
          cL.height = cR.height = cD.height = h
          cL.getContext('2d').putImageData(dL, 0, 0)
          cR.getContext('2d').putImageData(dR, 0, 0)
          const xD = cD.getContext('2d')
          const dD = xD.createImageData(w, h)
          for (let p = 0, i = 0; p < diff.length; p++, i += 4) {
            const d = diff[p]
            if (currentMode === 'diff') {
              dD.data[i] = d
              dD.data[i + 1] = d
              dD.data[i + 2] = d
              dD.data[i + 3] = 255
            } else {
              const tt = d / 255
              dD.data[i] = tt < 0.5 ? 0 : Math.round((tt - 0.5) * 510)
              dD.data[i + 1] = tt < 0.5 ? Math.round(tt * 510) : Math.round((1 - tt) * 510)
              dD.data[i + 2] = tt < 0.5 ? Math.round((0.5 - tt) * 510) : 0
              dD.data[i + 3] = 255
            }
          }
          xD.putImageData(dD, 0, 0)
          const canvases = document.createElement('div')
          canvases.style.cssText = 'display:flex;gap:6px;'
          cL.style.cssText = cR.style.cssText = cD.style.cssText = 'max-width:120px;border-radius:4px;background:#333;'
          canvases.appendChild(cL)
          canvases.appendChild(cR)
          canvases.appendChild(cD)
          row.appendChild(canvases)
        }
        content.appendChild(row)
      }
    }

    toolbar.querySelectorAll('button').forEach(mb => {
      mb.addEventListener('click', () => {
        toolbar.querySelectorAll('button').forEach(b => {
          b.classList.remove('active')
        })
        mb.classList.add('active')
        currentMode = mb.dataset.mode
        render()
      })
    })
    render()
    if (btn) btn.disabled = false
  })
}

export function swapFolders() {
  const tp = state.leftPath,
    te = state.leftEntries
  state.leftPath = state.rightPath
  state.leftEntries = state.rightEntries
  state.rightPath = tp
  state.rightEntries = te
  leftPathEl.textContent = state.leftPath || t('common.empty')
  rightPathEl.textContent = state.rightPath || t('common.empty')

  updateCompareButton()
  if (state.leftPath && state.rightPath) compare()
  showToast(t('toast.swapped'))
}
