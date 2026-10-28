/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { state, showToast } from '../core.js'
import { joinPath } from '../utils.js'
import { t } from '../i18n.js'
import { uiConfirm } from '../ui-dialog.js'
import { pushHistory } from './history.js'
import { reloadAndCompare } from './load.js'
import { collectCopyPairs, executeCopy } from './copy.js'

export async function replaceWithExternalFile(currentPath) {
  const newFile = await window.api.selectFile()
  if (!newFile) return
  const bk = await window.api.backupFile(currentPath)
  if (!bk.success) { showToast(t('toast.backupFailCancel2')); return }
  const r = await window.api.copyFile(newFile, currentPath)
  if (r.success) { pushHistory([{ destPath: currentPath, backupPath: bk.backupPath }]); showToast(t('toast.replacedTex')); await reloadAndCompare() }
  else showToast(t('toast.replaceFail', { msg: r.error }))
}

export async function deleteTexture(filePath) {
  if (!await uiConfirm({ title: '确认操作', message: t('confirm.deleteTex'), danger: true })) return
  const bk = await window.api.backupFile(filePath)
  if (!bk.success) { showToast(t('toast.backupFailCancel2')); return }
  const r = await window.api.deleteFile(filePath)
  if (r.success) { pushHistory([{ destPath: filePath, backupPath: bk.backupPath }]); showToast(t('toast.deletedTex')); await reloadAndCompare() }
  else showToast(t('toast.deleteFailMsg', { msg: r.error }))
}

export async function copySingleToRight(srcPath, destPath) {
  if (!await uiConfirm({ title: t('common.batchCopy'), message: t('confirm.copySingleRight') })) return
  const r = await window.api.copyFile(srcPath, destPath)
  if (r.success) { pushHistory([{ destPath, backupPath: null }]); showToast(t('toast.replacedTex')); await reloadAndCompare() }
  else showToast(t('toast.replaceFail', { msg: r.error }))
}

export async function addTextureToRight(destPath) {
  const newFile = await window.api.selectFile()
  if (!newFile) return
  const r = await window.api.copyFile(newFile, destPath)
  if (r.success) { pushHistory([{ destPath, backupPath: null }]); showToast(t('toast.addedTex')); await reloadAndCompare() }
  else showToast(t('toast.replaceFail', { msg: r.error }))
}

export async function uploadModelToRight(g) {
  if (!state.rightPath) { showToast(t('toast.destNotSelected')); return }
  const newFile = await window.api.selectModelFile()
  if (!newFile) return
  const destPath = joinPath(state.rightPath, g.key)
  const lastSep = Math.max(destPath.lastIndexOf('/'), destPath.lastIndexOf('\\'))
  if (lastSep > 0) await window.api.createFolder(destPath.slice(0, lastSep))
  const re = g.right && (g.right.file || g.right.dir)
  let bkPath = null
  if (re && !re.isDirectory) {
    const bk = await window.api.backupFile(re.fullPath)
    if (!bk.success) { showToast(t('toast.backupFailCancel2')); return }
    bkPath = bk.backupPath
  }
  const r = await window.api.copyFile(newFile, destPath)
  if (r.success) { pushHistory([{ destPath, backupPath: bkPath }]); showToast(t('toast.addedModel')); await reloadAndCompare() }
  else showToast(t('toast.replaceFail', { msg: r.error }))
}

export function blankTexDataUrl(role) {
  const c = document.createElement('canvas')
  c.width = 16; c.height = 16
  const ctx = c.getContext('2d')
  ctx.fillStyle = role === 'normal' ? '#8080ff' : '#000000'
  ctx.fillRect(0, 0, 16, 16)
  return c.toDataURL('image/png')
}

export async function createBlankTextureToRight(g, role) {
  if (!state.rightPath) { showToast(t('toast.destNotSelected')); return }
  const mainEntry = (g.right && g.right.main) || (g.left && g.left.main)
  if (!mainEntry) { showToast(t('toast.noMainTex')); return }
  const dot = mainEntry.name.lastIndexOf('.')
  const ext = dot >= 0 ? mainEntry.name.slice(dot) : '.png'
  const suf = role === 'normal' ? '_n' : '_s'
  const destPath = joinPath(state.rightPath, g.key + suf + ext)
  const re = g.right && g.right[role]
  let bkPath = null
  if (re && !re.isDirectory) {
    const bk = await window.api.backupFile(re.fullPath)
    if (!bk.success) { showToast(t('toast.backupFailCancel2')); return }
    bkPath = bk.backupPath
  }
  const r = await window.api.writeFile(destPath, blankTexDataUrl(role))
  if (r.success) { pushHistory([{ destPath, backupPath: bkPath }]); showToast(t('toast.createdBlankTex')); await reloadAndCompare() }
  else showToast(t('toast.replaceFail', { msg: r.error }))
}

export async function batchCopyToSide(destSide) {
  const srcSide = destSide === 'right' ? 'left' : 'right'
  const destBase = destSide === 'right' ? state.rightPath : state.leftPath
  const srcBase = destSide === 'right' ? state.leftPath : state.rightPath
  if (!destBase) { showToast(t('toast.destNotSelected')); return }
  const allPairs = []
  for (const g of state.result) {
    if (g.kind === 'have') continue
    const pairs = collectCopyPairs(g, srcSide, destSide, srcBase, destBase)
    allPairs.push(...pairs)
  }
  if (!allPairs.length) { showToast(t('toast.noNeedReplace')); return }
  const willBackup = allPairs.filter(p => p.backup).length
  const backupMsg = willBackup ? t('confirm.hasBackup', { n: willBackup }) : t('confirm.noBackup')
  const msg = t('confirm.batchReplace', { n: allPairs.length, src: t('common.' + srcSide), dest: t('common.' + destSide), backup: backupMsg })
  if (!await uiConfirm({ title: t('common.batchCopy'), message: msg })) return
  const r = await executeCopy(allPairs)
  if (r.cancelled) showToast(t('toast.copyCancelled'))
  else showToast(r.fail ? t('toast.batchReplacedWithFail', { n: r.ok, fail: r.fail }) : t('toast.batchReplaced', { n: r.ok }))
  await reloadAndCompare()
}
