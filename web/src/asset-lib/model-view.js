/**
 * matoga - 总资产库：模型 3D 视口查看
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { showToast } from '../core.js'
import { t } from '../i18n.js'
import { viewMcModelInViewport, viewImportedModelInViewport, isViewportVisible } from '../mc-model-viewer.js'
import { activateMaterial3DHost } from '../material3d.js'
import { packApiFor } from './helpers.js'

/* 3D 视口未激活（用户尚未打开过「3D 视口」面板或预览 3D tab）时自动激活：
   优先点击预览面板 3D tab（等价用户点击，含 tab 切换），回退独立视口面板宿主。
   返回 true 表示视口已就绪，可重试模型展示 */
export function tryActivateModelViewport() {
  if (isViewportVisible()) return true
  const pvBtn = document.querySelector('.pv-tabs button[data-pv-tab="3d"]')
  if (pvBtn) { pvBtn.click(); return true }
  const host = document.getElementById('material3dStandaloneHost')
  if (host) { activateMaterial3DHost(host); return true }
  return false
}

/* 3D 视口查看 MC 包内 .json 模型（models/ 路径或 items/ 物品定义；parent 链 + elements + 包内贴图） */
export async function viewMcModelAsset(source, packName, rel, name) {
  try {
    let r = await viewMcModelInViewport({ api: packApiFor(source), packName, rel })
    if (!r.shown && tryActivateModelViewport()) {
      r = await viewMcModelInViewport({ api: packApiFor(source), packName, rel })
    }
    if (r.shown) showToast(t('asset.toastModelViewport', { name }))
    else showToast(t('asset.toastModelViewportNoView'))
  } catch (e) {
    showToast(t('asset.toastModelOpenFail') + ': ' + (e.message || e))
  }
}

/* 3D 视口查看导入模型（data/imported-models，.bbmodel / MC .json） */
export async function viewImportedModelAsset(id, name) {
  try {
    let r = await viewImportedModelInViewport({ id })
    if (!r.shown && tryActivateModelViewport()) {
      r = await viewImportedModelInViewport({ id })
    }
    if (r.shown) showToast(t('asset.toastModelViewport', { name }))
    else showToast(t('asset.toastModelViewportNoView'))
  } catch (e) {
    showToast(t('asset.toastModelOpenFail') + ': ' + (e.message || e))
  }
}
