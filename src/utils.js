/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import { $, IMG_EXTS, TEX_SUFFIXES, ROLES, ignoreChk, ignoreInput } from './core.js'
import { t } from './i18n.js'

export function formatSize(bytes) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0, n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + units[i]
}

export function formatDate(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function typeIcon(isDir) { return isDir ? '📁' : '📄' }

export function isImageFile(name) {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return IMG_EXTS.has(name.slice(dot + 1).toLowerCase())
}

export function fileUrl(p) {
  let s = p.replace(/\\/g, '/')
  if (!s.startsWith('/')) s = '/' + s
  return 'file://' + s
}

export function openPreview(src, name) {
  $('previewImg').src = src
  $('previewCaption').textContent = name || ''
  $('previewModal').classList.add('show')
}

export function closePreview() {
  $('previewModal').classList.remove('show')
  $('previewImg').src = ''
}

export function parseTexGroup(name) {
  if (!isImageFile(name)) return { groupKey: name, role: 'file' }
  const dot = name.lastIndexOf('.')
  const base = name.slice(0, dot)
  for (const [suf, role] of TEX_SUFFIXES) {
    if (base.endsWith(suf)) return { groupKey: base.slice(0, -suf.length), role }
  }
  return { groupKey: base, role: 'main' }
}

export function buildGroups(entries) {
  const groups = new Map()
  for (const e of entries) {
    let key, role
    if (e.isDirectory) { key = e.name; role = 'dir' }
    else { const p = parseTexGroup(e.name); key = p.groupKey; role = p.role }
    if (!groups.has(key)) groups.set(key, {})
    groups.get(key)[role] = e
  }
  return groups
}

export function groupRoles(g) { return ROLES.filter(r => g && g[r]) }
export function hasAny(g) { return !!(g && (g.main || g.normal || g.specular || g.file || g.dir)) }

export function leftRoles(g) { return g._lr || (g._lr = groupRoles(g.left)) }
export function rightRoles(g) { return g._rr || (g._rr = groupRoles(g.right)) }

export function materialKind(lg, rg) {
  const lr = groupRoles(lg), rr = groupRoles(rg)
  if (lr.length && !rr.length) return 'miss'
  if (!lr.length && rr.length) return 'extra'
  let miss = false, diff = false
  for (const r of ROLES) {
    const le = lg && lg[r], re = rg && rg[r]
    if (le && !re) miss = true
    else if (le && re && le.size !== re.size) diff = true
  }
  if (miss) return 'partial'
  if (diff) return 'diff'
  return 'have'
}

export function singleKind(lg, rg) {
  const le = lg && (lg.file || lg.dir)
  const re = rg && (rg.file || rg.dir)
  if (le && !re) return 'miss'
  if (!le && re) return 'extra'
  if (le && re) return le.size !== re.size ? 'diff' : 'have'
  return 'have'
}

export function subKind(le, re) {
  if (le && !re) return 'miss'
  if (!le && re) return 'extra'
  if (le && re) return le.size !== re.size ? 'diff' : 'have'
  return 'have'
}

export function mainEntryOf(g) {
  if (g.isMaterial) return (g.left && g.left.main) || (g.right && g.right.main)
  return (g.left && (g.left.file || g.left.dir)) || (g.right && (g.right.file || g.right.dir))
}

export function folderOf(g) {
  if (g._folder !== undefined) return g._folder
  const idx = g.key.lastIndexOf('/')
  return (g._folder = idx >= 0 ? g.key.slice(0, idx) : t('render.rootFolder'))
}

export function getIgnorePatterns() {
  const patterns = []
  if (ignoreChk.checked) patterns.push('.DS_Store', 'Thumbs.db', 'desktop.ini', '.git', 'node_modules', '__pycache__', '*_backup_*')
  const custom = ignoreInput.value.trim()
  if (custom) patterns.push(...custom.split(',').map(s => s.trim()).filter(Boolean))
  return patterns.length ? patterns : null
}