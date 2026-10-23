/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { state, compareBtn2, hashChk, exportBtn, exportHtmlBtn, batchRightBtn, batchLeftBtn, STATUS_ORDER, ROLES } from './core.js'
import { buildGroups, materialKind, singleKind, mainEntryOf, hasAny, leftRoles, rightRoles } from './utils.js'
import { isModelEntry } from './model-diff.js'
import { renderResult, renderSidebar } from './render.js'
import { t } from './i18n.js'

export function computeCounts() {
  const c = { have: 0, diff: 0, partial: 0, miss: 0, extra: 0, leftTex: 0, rightTex: 0, rightMatch: 0, pbrExtra: 0, leftModel: 0, rightModel: 0, modelMatch: 0 }
  for (const g of state.result) {
    c[g.kind]++
    if (g.isMaterial) {
      const lr = leftRoles(g), rr = rightRoles(g)
      c.leftTex += lr.length
      c.rightTex += rr.length
      for (const r of rr) {
        if (lr.includes(r)) c.rightMatch++
        else c.pbrExtra++
      }
    } else if (g.isModel) {
      const lHas = hasAny(g.left), rHas = hasAny(g.right)
      if (lHas) c.leftModel++
      if (rHas) c.rightModel++
      if (lHas && rHas) c.modelMatch++
    } else if (g.isFile) {
      const lHas = hasAny(g.left), rHas = hasAny(g.right)
      if (lHas) c.leftTex++
      if (rHas) c.rightTex++
      if (lHas && rHas) c.rightMatch++
    }
  }
  state.counts = c
}

export async function compare() {
  if (!state.leftPath || !state.rightPath) return
  try { window.matogaCore && window.matogaCore.clearHashCache() } catch {}
  const leftGroups = buildGroups(state.leftEntries)
  const rightGroups = buildGroups(state.rightEntries)
  const allKeys = new Set([...leftGroups.keys(), ...rightGroups.keys()])
  const result = []
  for (const key of allKeys) {
    const lg = leftGroups.get(key), rg = rightGroups.get(key)
    const isMaterial = (lg && (lg.main || lg.normal || lg.specular)) || (rg && (rg.main || rg.normal || rg.specular))
    const isDir = (lg && lg.dir) || (rg && rg.dir)
    const isModel = isModelEntry(lg && lg.file) || isModelEntry(rg && rg.file)
    let g
    if (isDir) g = { key, isDir: true, left: lg, right: rg, kind: singleKind(lg, rg) }
    else if (isMaterial) g = { key, isMaterial: true, left: lg, right: rg, kind: materialKind(lg, rg) }
    else if (isModel) g = { key, isModel: true, left: lg, right: rg, kind: singleKind(lg, rg) }
    else g = { key, isFile: true, left: lg, right: rg, kind: singleKind(lg, rg) }
    result.push(g)
  }
  state.result = result
  state.selected = null
  state.expandedKeys.clear()
  computeCounts()
  renderResult()
  renderSidebar()

  if (hashChk.checked) {
    const pairs = []
    for (const g of result) {
      if (g.kind !== 'have') continue
      if (g.isMaterial) {
        for (const role of ROLES) {
          const le = g.left && g.left[role], re = g.right && g.right[role]
          if (le && re) pairs.push([le, re, g])
        }
      } else if (!g.isDir) {
        const le = g.left && (g.left.file || g.left.dir), re = g.right && (g.right.file || g.right.dir)
        if (le && re && !le.isDirectory) pairs.push([le, re, g])
      }
    }
    if (pairs.length) {
      if (compareBtn2) { compareBtn2.disabled = true; compareBtn2.textContent = t('compare.comparing') }
      let idx = 0
      const N = Math.min(navigator.hardwareConcurrency || 4, 8)
      async function worker() {
        while (idx < pairs.length) {
          const [le, re, g] = pairs[idx++]
          const [h1, h2] = await Promise.all([window.api.hashFile(le.fullPath), window.api.hashFile(re.fullPath)])
          if (h1 && h2 && h1 !== h2) { g.kind = 'diff'; state.counts.have--; state.counts.diff++ }
        }
      }
      await Promise.all(Array.from({ length: N }, worker))
      if (compareBtn2) { compareBtn2.disabled = false; compareBtn2.textContent = t('compare.start') }
      renderResult()
      if (state.selected) renderSidebar()
    }
  }
  exportBtn.disabled = false
  exportHtmlBtn.disabled = false
  batchRightBtn.disabled = false
  batchLeftBtn.disabled = false
}

export function sortResult(arr) {
  const key = state.sortKey
  const dir = state.sortDir === 'asc' ? 1 : -1
  const n = arr.length
  const pairs = new Array(n)
  for (let i = 0; i < n; i++) {
    const g = arr[i]
    let v
    if (key === 'status') v = STATUS_ORDER[g.kind]
    else if (key === 'name') v = g.key
    else if (key === 'type') v = g.isMaterial ? 0 : g.isModel ? 1 : g.isDir ? 2 : 3
    else if (key === 'size') v = (mainEntryOf(g)?.size || 0)
    else if (key === 'mtime') v = (mainEntryOf(g)?.mtime || 0)
    else if (key === 'left') v = hasAny(g.left) ? 0 : 1
    else if (key === 'right') v = hasAny(g.right) ? 0 : 1
    else v = 0
    pairs[i] = [v, g]
  }
  const isStr = key === 'name'
  pairs.sort((a, b) => {
    let v
    if (isStr) v = a[0].localeCompare(b[0], 'zh')
    else v = a[0] - b[0]
    if (v === 0) v = a[1].key.localeCompare(b[1].key, 'zh')
    return v * dir
  })
  for (let i = 0; i < n; i++) arr[i] = pairs[i][1]
}