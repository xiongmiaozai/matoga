import {
  state, $, ROLE_LABEL, KIND_TEXT,
  leftBtn, rightBtn, onlyMissingChk, summaryEl, resultBody,
  leftPathEl, rightPathEl, leftStatEl, rightStatEl, leftListEl, rightListEl
} from './core.js'
import {
  typeIcon, formatSize, formatDate, isImageFile, fileUrl,
  folderOf, mainEntryOf, hasAny, leftRoles, rightRoles, subKind,
  openPreview
} from './utils.js'
import { sortResult } from './compare.js'
import { copySingleFile, replaceWithExternalFile, deleteTexture, handleAction, showPixelDiff } from './actions.js'
import { initMaterial3D, updateMaterial3D } from './material3d.js'
import { enhancePreview } from './preview2d.js'

export function renderEntryList(container, entries) {
  container.innerHTML = ''
  if (entries.length === 0) {
    container.innerHTML = '<div class="entry-item" style="color:var(--text-muted);justify-content:center;">（空文件夹）</div>'
    return
  }
  const sorted = entries.slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
  const frag = document.createDocumentFragment()
  for (const e of sorted) {
    const div = document.createElement('div')
    div.className = 'entry-item' + (e.isDirectory ? ' dir' : '')
    div.innerHTML = `<span class="ico">${typeIcon(e.isDirectory)}</span><span class="nm" title="${e.name}">${e.name}</span>`
    frag.appendChild(div)
  }
  container.appendChild(frag)
}

export function renderStat(el, entries, pathLabel) {
  if (!pathLabel) { el.textContent = ''; return }
  const dirs = entries.filter(e => e.isDirectory).length
  const files = entries.length - dirs
  el.textContent = `共 ${entries.length} 项（夹 ${dirs}，文件 ${files}）`
}

export function setLoading(side, on) {
  const stat = side === 'left' ? leftStatEl : rightStatEl
  const btn = side === 'left' ? leftBtn : rightBtn
  stat.textContent = on ? '读取中…' : ''
  btn.disabled = on
}

export function applyEntries(side, folderPath, entries) {
  if (side === 'left') {
    state.leftPath = folderPath; state.leftEntries = entries
    leftPathEl.textContent = folderPath
    renderStat(leftStatEl, entries, folderPath)
    renderEntryList(leftListEl, entries)
  } else {
    state.rightPath = folderPath; state.rightEntries = entries
    rightPathEl.textContent = folderPath
    renderStat(rightStatEl, entries, folderPath)
    renderEntryList(rightListEl, entries)
  }
}

export function statusBadge(kind) {
  return `<span class="status-badge status-${kind}">${KIND_TEXT[kind]}</span>`
}

export function renderThumbPair(le, re) {
  const isImgE = (e) => e && !e.isDirectory && isImageFile(e.name)
  if (!isImgE(le) && !isImgE(re)) return '<span class="cell-empty">—</span>'
  const lu = isImgE(le) ? fileUrl(le.fullPath) : ''
  const ru = isImgE(re) ? fileUrl(re.fullPath) : ''
  const lt = lu ? `<img class="thumb thumb-left" src="${lu}" loading="lazy" />` : '<span class="thumb-ph thumb-left-ph">L</span>'
  const rt = ru ? `<img class="thumb thumb-right" src="${ru}" loading="lazy" />` : '<span class="thumb-ph thumb-right-ph">R</span>'
  return `<div class="thumb-pair">${lt}${rt}</div>`
}

export function appendGroupRows(frag, g) {
  const tr = document.createElement('tr')
  tr.className = 'row-' + g.kind
  if (state.selected && state.selected.key === g.key) tr.classList.add('row-selected')

  const roleCount = (g.isMaterial ? leftRoles(g).length + rightRoles(g).length : 0)
  const expandable = g.isMaterial && roleCount > 1
  const expanded = state.expandedKeys.has(g.key)

  let mainLeft, mainRight
  if (g.isMaterial) { mainLeft = g.left && g.left.main; mainRight = g.right && g.right.main }
  else { mainLeft = g.left && (g.left.file || g.left.dir); mainRight = g.right && (g.right.file || g.right.dir) }

  const previewCell = renderThumbPair(mainLeft, mainRight)
  const arrow = expandable ? `<span class="expand-arrow">${expanded ? '▾' : '▸'}</span>` : ''
  const folder = folderOf(g)
  const displayName = state.viewMode === 'byFolder' && folder !== '（根目录）' ? g.key.slice(folder.length + 1) : g.key
  const nameHtml = `${arrow}<span class="cell-name" title="${g.key}">${displayName || g.key}</span>`
  const typeHtml = g.isMaterial ? '<span class="type-mat">🎨 材质</span>' : g.isDir ? '<span class="type-dir">📁 文件夹</span>' : '<span class="type-file">📄 文件</span>'
  const me = mainLeft || mainRight
  const sizeHtml = (g.kind === 'diff' && mainLeft && mainRight && mainLeft.size !== mainRight.size)
    ? `<span class="size-diff" title="左 ${formatSize(mainLeft.size)} / 右 ${formatSize(mainRight.size)}">${formatSize(mainLeft.size)} ≠ ${formatSize(mainRight.size)}</span>`
    : formatSize(me ? me.size : 0)
  const mtimeHtml = formatDate(me ? me.mtime : 0)
  const leftCell = hasAny(g.left) ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'
  const rightCell = hasAny(g.right) ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'

  tr.innerHTML = `<td>${statusBadge(g.kind)}</td><td class="preview-cell">${previewCell}</td><td>${nameHtml}</td><td>${typeHtml}</td><td>${sizeHtml}</td><td>${mtimeHtml}</td><td>${leftCell}</td><td>${rightCell}</td>`
  tr.addEventListener('click', () => selectGroup(g))
  tr.addEventListener('dblclick', (ev) => {
    const e = mainEntryOf(g)
    if (!e) return
    if (ev.metaKey || ev.ctrlKey) window.api.showInFolder(e.fullPath)
    else window.api.openPath(e.fullPath)
  })
  frag.appendChild(tr)

  if (g.isMaterial && expanded) {
    for (const role of ['main', 'normal', 'specular']) {
      const le = g.left && g.left[role], re = g.right && g.right[role]
      if (!le && !re) continue
      const sub = document.createElement('tr')
      const sk = subKind(le, re)
      sub.className = 'sub-row row-' + sk
      const subName = `<span class="sub-name">${ROLE_LABEL[role]}</span>`
      const se = le || re
      const actionTd = document.createElement('td')
      actionTd.className = 'sub-actions'
      if (le && !le.isDirectory && state.rightPath) {
        const rel = le.fullPath.slice(state.leftPath.length + 1)
        const dest = state.rightPath + '/' + rel
        const btn = document.createElement('button')
        btn.className = 'sub-replace-btn'
        btn.textContent = '→右'
        btn.addEventListener('click', (ev) => { ev.stopPropagation(); copySingleFile(le.fullPath, dest, re && !re.isDirectory ? re.fullPath : null) })
        actionTd.appendChild(btn)
      }
      if (re && !re.isDirectory && state.leftPath) {
        const rel = re.fullPath.slice(state.rightPath.length + 1)
        const dest = state.leftPath + '/' + rel
        const btn = document.createElement('button')
        btn.className = 'sub-replace-btn'
        btn.textContent = '→左'
        btn.addEventListener('click', (ev) => { ev.stopPropagation(); copySingleFile(re.fullPath, dest, le && !le.isDirectory ? le.fullPath : null) })
        actionTd.appendChild(btn)
      }
      sub.innerHTML = `<td>${statusBadge(sk)}</td><td class="preview-cell">${renderThumbPair(le, re)}</td><td>${subName}</td><td></td><td>${formatSize(se.size)}</td><td>${formatDate(se.mtime)}</td><td>${le ? '<span class="cell-yes">✓</span>' : '<span class="cell-empty">—</span>'}</td><td>${re ? '<span class="cell-yes">✓</span>' : '<span class="cell-no">✗</span>'}</td>`
      const emptyTd = sub.children[3]
      emptyTd.replaceWith(actionTd)
      sub.addEventListener('click', () => { state.selected = g; renderResult(); renderSidebar() })
      frag.appendChild(sub)
    }
  }
}

export function renderResult() {
  const result = state.result
  const onlyDiff = onlyMissingChk.checked
  let filtered = onlyDiff ? result.filter(g => g.kind !== 'have') : result.slice()
  const sf = state.statusFilter
  if (sf === 'missing') filtered = filtered.filter(g => g.kind === 'miss' || g.kind === 'partial')
  else if (sf === 'diff') filtered = filtered.filter(g => g.kind === 'diff')
  else if (sf === 'extra') filtered = filtered.filter(g => g.kind === 'extra')
  const q = state.searchText.trim().toLowerCase()
  if (q) filtered = filtered.filter(g => g.key.toLowerCase().includes(q))
  sortResult(filtered)

  const counts = state.counts || { have: 0, diff: 0, partial: 0, miss: 0, extra: 0 }
  summaryEl.innerHTML = `
    <span class="s-item">左 <span class="s-num">${state.leftEntries.length}</span></span>
    <span class="s-item">右 <span class="s-num">${state.rightEntries.length}</span></span>
    <span class="s-item s-have">✓ 一致 <span class="s-num">${counts.have}</span></span>
    <span class="s-item s-diff">≈ 不同 <span class="s-num">${counts.diff}</span></span>
    <span class="s-item s-partial">◐ 部分 <span class="s-num">${counts.partial}</span></span>
    <span class="s-item s-miss">✗ 缺失 <span class="s-num">${counts.miss}</span></span>
    <span class="s-item">＋ 多余 <span class="s-num">${counts.extra}</span></span>
  `

  if (filtered.length === 0) {
    const msg = !state.leftPath || !state.rightPath
      ? '拖拽文件夹到左侧卡片，或点击「选择」开始对比'
      : result.length === 0 ? '两侧均为空'
      : q ? '没有匹配的材质/文件'
      : (onlyDiff ? '全部一致，无不一致项 🎉' : '无数据')
    resultBody.innerHTML = `<tr class="empty-row"><td colspan="8">${msg}</td></tr>`
    return
  }

  const frag = document.createDocumentFragment()
  const limit = state.renderLimit
  let rendered = 0
  let truncated = false

  if (state.viewMode === 'byFolder') {
    const folderMap = new Map()
    for (const g of filtered) {
      const f = folderOf(g)
      if (!folderMap.has(f)) folderMap.set(f, [])
      folderMap.get(f).push(g)
    }
    const folders = [...folderMap.keys()].sort((a, b) => a.localeCompare(b, 'zh'))
    for (const f of folders) {
      if (rendered >= limit) { truncated = true; break }
      const items = folderMap.get(f)
      const collapsed = state.collapsedFolders.has(f)
      const fc = { have: 0, diff: 0, partial: 0, miss: 0, extra: 0 }
      for (const g of items) fc[g.kind]++
      const sp = []
      if (fc.have) sp.push(`<span class="fc fc-have">✓${fc.have}</span>`)
      if (fc.diff) sp.push(`<span class="fc fc-diff">≈${fc.diff}</span>`)
      if (fc.partial) sp.push(`<span class="fc fc-partial">◐${fc.partial}</span>`)
      if (fc.miss) sp.push(`<span class="fc fc-miss">✗${fc.miss}</span>`)
      if (fc.extra) sp.push(`<span class="fc fc-extra">＋${fc.extra}</span>`)
      const ftr = document.createElement('tr')
      ftr.className = 'folder-group-row'
      ftr.innerHTML = `<td colspan="8"><span class="folder-arrow">${collapsed ? '▸' : '▾'}</span><span class="folder-ico">📁</span><span class="folder-name">${f}</span><span class="folder-count">${items.length} 项</span><span class="folder-summary">${sp.join(' ')}</span></td>`
      ftr.addEventListener('click', () => {
        if (state.collapsedFolders.has(f)) state.collapsedFolders.delete(f)
        else state.collapsedFolders.add(f)
        renderResult()
      })
      frag.appendChild(ftr)
      if (collapsed) continue
      for (const g of items) { if (rendered >= limit) { truncated = true; break }; appendGroupRows(frag, g); rendered++ }
    }
  } else {
    for (const g of filtered) { if (rendered >= limit) { truncated = true; break }; appendGroupRows(frag, g); rendered++ }
  }

  if (truncated) {
    const moreRow = document.createElement('tr')
    moreRow.className = 'show-more-row'
    moreRow.innerHTML = `<td colspan="8" style="text-align:center;padding:8px;"><button class="btn btn-ghost btn-sm">显示更多（${rendered}/${filtered.length}）</button></td>`
    moreRow.querySelector('button').addEventListener('click', () => { state.renderLimit += 200; renderResult() })
    frag.appendChild(moreRow)
  }

  resultBody.innerHTML = ''
  resultBody.appendChild(frag)
}

export function selectGroup(g) {
  state.selected = g
  if (g.isMaterial) {
    if (state.expandedKeys.has(g.key)) state.expandedKeys.delete(g.key)
    else state.expandedKeys.add(g.key)
  }
  renderResult()
  renderSidebar()
}

function pvCell(entry, side) {
  if (!entry) return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">该侧无</span></div>`
  if (entry.isDirectory || !isImageFile(entry.name)) return `<div class="pv-cell"><span class="pv-tag">${side}</span><span class="pv-empty">非图片</span></div>`
  const url = fileUrl(entry.fullPath)
  return `<div class="pv-cell"><span class="pv-tag">${side}</span><img src="${url}" data-name="${entry.name}" data-path="${entry.fullPath}" alt="" /></div>`
}

export function renderSidebar() {
  const g = state.selected
  const panel = $('previewPanel')
  const detail = $('detailPanel')
  const action = $('actionPanel')
  const mat3dContainer = $('material3dContainer')

  if (mat3dContainer) initMaterial3D(mat3dContainer)

  if (!g) {
    panel.innerHTML = '<div class="pv-hint">点击表格中的材质查看预览</div>'
    detail.innerHTML = '<div class="detail-hint">未选中</div>'
    action.innerHTML = ''
    updateMaterial3D(null)
    return
  }

  updateMaterial3D(g.isMaterial ? g : null)

  let html = ''
  const diffPairs = []
  if (g.isMaterial) {
    for (const role of ['main', 'normal', 'specular']) {
      const le = g.left && g.left[role], re = g.right && g.right[role]
      if (!le && !re) continue
      html += `<div class="pv-row"><span class="pv-role">${ROLE_LABEL[role]}</span>${pvCell(le, '左')}${pvCell(re, '右')}</div>`
      if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
        diffPairs.push([le, re, ROLE_LABEL[role]])
    }
  } else if (g.isDir) {
    html = '<div class="pv-hint">📁 文件夹</div>'
  } else {
    const le = g.left && (g.left.file || g.left.dir), re = g.right && (g.right.file || g.right.dir)
    html = `<div class="pv-row"><span class="pv-role">文件</span>${pvCell(le, '左')}${pvCell(re, '右')}</div>`
    if (le && re && !le.isDirectory && !re.isDirectory && isImageFile(le.name) && isImageFile(re.name))
      diffPairs.push([le, re, '文件'])
  }
  if (diffPairs.length) {
    html += `<div class="pv-diff-btn-bar"><button class="btn btn-ghost btn-sm" id="pixelDiffBtn">🔍 像素差异对比</button></div>`
  }
  panel.innerHTML = html
  panel.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => openPreview(img.src, img.dataset.name || ''))
    const cell = img.parentElement
    const btn = document.createElement('button')
    btn.className = 'pv-replace-btn'
    btn.textContent = '替换'
    btn.title = '选择外部文件替换此贴图'
    btn.addEventListener('click', (e) => { e.stopPropagation(); replaceWithExternalFile(img.dataset.path) })
    cell.appendChild(btn)
    const delBtn = document.createElement('button')
    delBtn.className = 'pv-delete-btn'
    delBtn.textContent = '删除'
    delBtn.title = '删除此贴图（可撤回）'
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTexture(img.dataset.path) })
    cell.appendChild(delBtn)
  })
  const diffBtn = $('pixelDiffBtn')
  if (diffBtn) diffBtn.addEventListener('click', () => showPixelDiff(diffPairs, panel))

  const dRow = (label, val) => `<div class="detail-row"><span class="detail-label">${label}</span><span>${val}</span></div>`
  let dh = `<div class="detail-title" title="${g.key}">${g.key}</div>`
  dh += dRow('状态', KIND_TEXT[g.kind])
  if (g.isMaterial) {
    dh += dRow('类型', '材质')
    dh += dRow('贴图数', `左 ${leftRoles(g).length} / 右 ${rightRoles(g).length}`)
    const m = mainEntryOf(g)
    if (m) { dh += dRow('主贴图大小', formatSize(m.size)); dh += dRow('主贴图时间', formatDate(m.mtime)) }
  } else if (g.isDir) {
    dh += dRow('类型', '文件夹')
  } else {
    dh += dRow('类型', '文件')
    const e = mainEntryOf(g)
    if (e) { dh += dRow('大小', formatSize(e.size)); dh += dRow('时间', formatDate(e.mtime)) }
  }
  detail.innerHTML = dh

  const target = mainEntryOf(g)
  let btns = ''
  if (g.left && target) btns += '<button class="btn btn-sm" data-act="open-left">打开左侧</button><button class="btn btn-ghost btn-sm" data-act="loc-left">定位左侧文件夹</button>'
  if (g.right && target) btns += '<button class="btn btn-sm" data-act="open-right">打开右侧</button><button class="btn btn-ghost btn-sm" data-act="loc-right">定位右侧文件夹</button>'
  if (g.left && hasAny(g.left) && state.rightPath) btns += '<button class="btn btn-accent btn-sm" data-act="copy-to-right">复制到右侧</button>'
  if (g.right && hasAny(g.right) && state.leftPath) btns += '<button class="btn btn-accent btn-sm" data-act="copy-to-left">复制到左侧</button>'
  btns += '<button class="btn btn-ghost btn-sm" data-act="copy">复制名称</button>'
  action.innerHTML = btns
  action.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => handleAction(b.dataset.act, g))
  })
  enhancePreview()
}

export function updateSortIndicators() {
  document.querySelectorAll('.result-table th[data-key]').forEach(th => {
    th.classList.remove('asc', 'desc')
    if (th.dataset.key === state.sortKey) th.classList.add(state.sortDir)
  })
}