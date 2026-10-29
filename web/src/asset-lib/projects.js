/**
 * matoga - 总资产库：projects
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 asset-library.js 原样搬出，逻辑未改。
 */
import { state, IMG_EXTS, showToast } from '../core.js'
import { fileUrl, formatSize, formatDate, escAttr, apiUrl, setTexDragData, contentKindOfPath } from '../utils.js'
import { addNodeAt, addTextureAt, loadPreset, saveNodeProject, loadNodeProject, serializeGraphData, loadCanvasPresetGraph } from '../node-canvas.js'
import { t, onLocaleChange } from '../i18n.js'
import { uiPrompt, uiConfirm } from '../ui-dialog.js'
import { el, shade, loadList, saveList } from './dom.js'
import { S, BROWSE_CLICK_DELAY } from './store.js'
import { assetApiCall, persistFavorites, persistRecent } from './api.js'
import { rebuild } from './filters.js'
import { sortItems } from './items.js'
import { collapsedSet, saveCollapsed } from './collapse.js'
import { makeCard } from './card.js'
import { PROJECTS_API } from './helpers.js'

export async function loadProjects() {
  try {
    const data = await assetApiCall('GET', PROJECTS_API)
    S.projectEntries = (data && data.projects) || []
    S.loadErrors.project = null
  } catch (e) {
    S.loadErrors.project = e.message || '未知错误'
    if (S.projectEntries === null) S.projectEntries = []
  }
}

function projectThumbUrl(id) {
  return apiUrl(PROJECTS_API + '/' + encodeURIComponent(id) + '/thumb')
}

export async function refreshProjectsQuiet() {
  await loadProjects()
  rebuild()
}

async function saveProjectAs() {
  const name = await uiPrompt({ title: t('asset.projectSaveTitle'), label: t('asset.projectNamePrompt') })
  if (name === null) return
  const n = name.trim()
  if (!n) { showToast(t('asset.projectNameEmpty')); return }
  try {
    await saveNodeProject(n)
    showToast(t('asset.toastProjectSaved'))
    refreshProjectsQuiet()
  } catch (e) {
    showToast(t('asset.toastProjectSaveFail') + ': ' + e.message)
  }
}

export async function updateProjectWithCanvas(p) {
  if (!await uiConfirm({ title: t('asset.projectSection'), message: t('asset.projectUpdateConfirm', { name: p.name }) })) return
  try {
    await saveNodeProject(p.name, p.id)
    showToast(t('asset.toastProjectSaved'))
    refreshProjectsQuiet()
  } catch (e) {
    showToast(t('asset.toastProjectSaveFail') + ': ' + e.message)
  }
}

export async function deleteProjectAsset(p) {
  if (!await uiConfirm({ title: t('asset.projectSection'), message: t('asset.projectDeleteConfirm', { name: p.name }), danger: true })) return
  try {
    await assetApiCall('DELETE', PROJECTS_API + '/' + encodeURIComponent(p.id))
    showToast(t('asset.toastProjectDeleted'))
    S.favorites = S.favorites.filter(f => f.key !== 'project:' + p.id)
    S.recent = S.recent.filter(r => r.key !== 'project:' + p.id)
    persistFavorites()
    persistRecent()
    try { await assetApiCall('DELETE', '/api/craft-pack/items/' + encodeURIComponent('project:' + p.id)) } catch {}

    refreshProjectsQuiet()
  } catch (e) {
    showToast(t('asset.toastProjectDeleteFail') + ': ' + e.message)
  }
}

export async function renameProjectAsset(p) {
  const name = await uiPrompt({ title: t('asset.projectRenamePrompt'), label: t('asset.projectNamePrompt'), value: p.name })
  if (name === null) return
  const n = name.trim()
  if (!n || n === p.name) return
  try {
    await assetApiCall('PUT', PROJECTS_API + '/' + encodeURIComponent(p.id) + '/rename', { name: n })
    S.favorites.forEach(f => { if (f.key === 'project:' + p.id) f.name = n })
    S.recent.forEach(r => { if (r.key === 'project:' + p.id) r.name = n })
    persistFavorites()
    persistRecent()
    showToast(t('asset.toastProjectRenamed'))
    refreshProjectsQuiet()
  } catch (e) {
    showToast(t('asset.toastProjectRenameFail') + ': ' + e.message)
  }
}

export function buildProjectSection() {
  const items = (S.projectEntries || []).map(p => ({
    key: 'project:' + p.id, name: p.name, thumb: projectThumbUrl(p.id),
    type: 'project', path: p.dir || null, mtime: p.updatedAt || 0, role: 'project',
    id: p.id, nodeCount: p.nodeCount || 0, textureCount: p.textureCount || 0,
    onAdd: () => loadNodeProject(p.id).catch(e => showToast(t('asset.toastProjectLoadFail') + ': ' + e.message)),
  }))
  const sorted = sortItems(items)
  const sec = el('div', 'asset-lib-section')
  sec.dataset.cat = 'project'
  if (collapsedSet.has('project')) sec.classList.add('collapsed')
  const head = el('div', 'asset-lib-section-head',
    `<span class="caret">▾</span><span>${t('asset.projectSection')}</span><span class="cnt">${sorted.length}</span>`)
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed')
    if (sec.classList.contains('collapsed')) { collapsedSet.add('project'); saveCollapsed(collapsedSet) }
    else { collapsedSet.delete('project'); saveCollapsed(collapsedSet) }
  })
  sec.appendChild(head)

  const actions = el('div', 'asset-lib-sec-actions')
  const saveBtn = el('button', 'asset-lib-sec-btn', t('asset.projectSave'))
  saveBtn.title = t('asset.projectSaveTitle')
  saveBtn.addEventListener('click', (e) => { e.stopPropagation(); saveProjectAs() })
  actions.appendChild(saveBtn)
  sec.appendChild(actions)

  const grid = el('div', 'asset-lib-grid')
  if (S.viewMode === 'list') grid.classList.add('list-view')
  if (S.projectEntries === null) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.loading')))
  } else if (S.loadErrors.project) {
    grid.appendChild(el('div', 'asset-lib-hint error', t('asset.loadFailed', { msg: S.loadErrors.project })))
  } else if (!sorted.length) {
    grid.appendChild(el('div', 'asset-lib-hint', t('asset.projectEmpty')))
  } else {
    for (const it of sorted) grid.appendChild(makeCard(it))
  }
  sec.appendChild(grid)
  return sec
}

