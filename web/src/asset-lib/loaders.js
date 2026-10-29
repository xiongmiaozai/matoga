/**
 * matoga - 总资产库：loaders
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { assetApiCall } from './api.js'
import { IMPORT_API, MC_PACKS_API } from './helpers.js'

export async function loadHdri() {
  try {
    const data = await assetApiCall('GET', '/api/hdri/list')
    S.hdriEntries = Array.isArray(data) ? data : ((data && data.entries) || [])
    S.loadErrors.hdri = null
  } catch (e) {
    S.loadErrors.hdri = e.message || '未知错误'
    if (S.hdriEntries === null) S.hdriEntries = []
  }
}

export async function loadMc() {
  try {
    const data = await assetApiCall('GET', MC_PACKS_API + '/list')
    S.mcEntries = (data && data.packs) || []
    S.loadErrors.mc = null
  } catch (e) {
    S.loadErrors.mc = e.message || '未知错误'
    if (S.mcEntries === null) S.mcEntries = []
  }
}


/* 总资产库贴图聚合：MC 材质包 + 官方包全部贴图（按包/类别分组） */
export async function loadTexPacks() {
  try {
    const data = await assetApiCall('GET', '/api/asset/tex')
    S.texPacks = (data && data.packs) || []
    S.loadErrors.tex = null
  } catch (e) {
    S.loadErrors.tex = e.message || '未知错误'
    if (S.texPacks === null) S.texPacks = []
  }
}

/* 总资产库模型聚合：包内 .json 模型（/api/asset/model）+ 导入模型 + 自定义模型 */
export async function loadModelAssets() {
  try {
    const data = await assetApiCall('GET', '/api/asset/model')
    S.modelPacks = (data && data.packs) || []
    S.loadErrors.model = null
  } catch (e) {
    S.loadErrors.model = e.message || '未知错误'
    if (S.modelPacks === null) S.modelPacks = []
  }
  try {
    const data = await assetApiCall('GET', IMPORT_API)
    S.importedModels = (data && data.models) || []
  } catch {
    S.importedModels = []
  }
  try {
    const data = await assetApiCall('GET', '/api/custom-models')
    S.customModels = (data && data.models) || []
  } catch {
    S.customModels = []
  }
  try {
    const loc = await assetApiCall('GET', IMPORT_API + '/location')
    S.modelDirs.imported = (loc && loc.dir) || ''
  } catch { S.modelDirs.imported = '' }
  try {
    const loc = await assetApiCall('GET', '/api/custom-models/location')
    S.modelDirs.custom = (loc && loc.dir) || ''
  } catch { S.modelDirs.custom = '' }
}

