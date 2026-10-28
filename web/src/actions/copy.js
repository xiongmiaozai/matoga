/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { state, showToast, ROLES } from '../core.js'
import { relPath, joinPath } from '../utils.js'
import { t } from '../i18n.js'
import { uiConfirm } from '../ui-dialog.js'
import { pushHistory } from './history.js'
import { reloadAndCompare } from './load.js'

export async function copyToSide(g, destSide) {
  const srcSide = destSide === 'right' ? 'left' : 'right'
  const destBase = destSide === 'right' ? state.rightPath : state.leftPath
  const srcBase = destSide === 'right' ? state.leftPath : state.rightPath
  if (!destBase) { showToast(t('toast.destNotSelected')); return }
  const pairs = collectCopyPairs(g, srcSide, destSide, srcBase, destBase)
  if (!pairs.length) { showToast(t('toast.noCopyFiles')); return }
  const willBackup = pairs.filter(p => p.backup).length
  const backupMsg = willBackup ? t('confirm.hasBackup', { n: willBackup }) : t('confirm.noBackup')
  const msg = t('confirm.replaceSingle', { n: pairs.length, src: t('common.' + srcSide), dest: t('common.' + destSide), backup: backupMsg })
  if (!await uiConfirm({ title: '确认操作', message: msg })) return
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
    pairs.push({ src: se.fullPath, dest: joinPath(destBase, rel), backup: de && !de.isDirectory ? de.fullPath : null, name: se.name })
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
  let ok = 0, fail = 0
  const hist = []
  for (const p of pairs) {
    let bkPath = null
    if (p.backup) { const bk = await window.api.backupFile(p.backup); if (!bk.success) { fail++; continue } bkPath = bk.backupPath }
    const r = await window.api.copyFile(p.src, p.dest)
    if (r.success) { ok++; hist.push({ destPath: p.dest, backupPath: bkPath }) } else fail++
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
  const onProgress = (msg) => {
    bar.style.width = (msg.total ? (msg.current / msg.total * 100) : 0) + '%'
    countEl.textContent = msg.current + '/' + msg.total
    okFailEl.textContent = '✓' + msg.ok + ' ✗' + msg.fail
    nameEl.textContent = msg.name || ''
    if (msg.status === 'ok') hist.push({ destPath: msg.dest, backupPath: msg.backupPath })
  }
  const onCancel = () => { cancelled = true; cancelBtn.disabled = true; if (window.__matogaCancelSync) window.__matogaCancelSync() }
  cancelBtn.addEventListener('click', onCancel, { once: true })

  let r
  try {
    r = await window.api.copyFilesBatch(pairs, onProgress)
  } catch (e) {
    r = { ok: 0, fail: pairs.length, error: e.message }
  }
  cancelBtn.removeEventListener('click', onCancel)
  modal.style.display = 'none'
  if (hist.length) pushHistory(hist)
  return { ok: r.ok || 0, fail: r.fail || 0, cancelled: cancelled || r.cancelled }
}

async function executeCopySequential(pairs) {
  let ok = 0, fail = 0
  const hist = []
  for (const p of pairs) {
    let bkPath = null
    if (p.backup) { const bk = await window.api.backupFile(p.backup); if (!bk.success) { fail++; continue } bkPath = bk.backupPath }
    const r = await window.api.copyFile(p.src, p.dest)
    if (r.success) { ok++; hist.push({ destPath: p.dest, backupPath: bkPath }) } else fail++
  }
  if (hist.length) pushHistory(hist)
  return { ok, fail }
}
