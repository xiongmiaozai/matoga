/**
 * matoga - 节点预览窗口
 * 检测节点画布 / 节点关系窗口中被点击（选中）的节点，
 * 展示其内容预览图（纹理 / 噪波 / 颜色 / 数值）与详情
 * （属性、端口、连接关系、计算输出）。
 */

import { getNodeDetail } from './node-canvas.js'
import { t, onLocaleChange } from './i18n.js'


let _initialized = false
let _activeId = null      // 当前展示的节点 id
let _activeCount = 0      // 触发选中时的选中数量（多选提示）
let _selTimer = null
let _chgTimer = null
let _mode = 'node'        // 'node' 节点详情 | 'asset' 资产详情（原资产详情窗口并入）
let _asset = null         // 资产详情数据

function viewEl(){ return document.getElementById('nodePreviewView') }

/* ── 工具 ───────────────────────────────── */
function truncStr(v, n){
  const s = String(v)
  const arr = Array.from(s)
  return arr.length <= n ? s : arr.slice(0, n - 1).join('') + '…'
}
function fmtVal(v){
  if (typeof v === 'number') return (Math.round(v * 1e4) / 1e4).toString()
  if (Array.isArray(v)) return '[' + v.map(fmtVal).join(', ') + ']'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return truncStr(v, 48)
}
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
}

/* ── 各区块渲染 ─────────────────────────── */
function renderHead(d){
  return `
    <div class="np-head">
      <span class="np-head-accent" style="background:${esc(d.def.color)}"></span>
      <div class="np-head-main">
        <div class="np-head-title">${esc(truncStr(d.title, 24))}</div>
        <div class="np-head-sub">
          <span class="np-badge">${esc(d.type)}</span>
          ${d.def.group ? `<span class="np-group">${esc(d.def.group)}</span>` : ''}
          <span class="np-id" title="${esc(d.id)}">${esc(d.id)}</span>
        </div>
      </div>
    </div>`
}

function renderStage(d){
  const kind = d.previewKind
  let inner = ''
  if (kind === 'image' && d.previewUrl){
    inner = `
      <img class="np-img" src="${esc(d.previewUrl)}" alt="${esc(d.title)}"
           loading="lazy" title="${t('np.openImage')}"
           data-np-act="open-image">`
  } else if (kind === 'color' && d.props.color){
    inner = `
      <div class="np-color" data-np-act="none" style="background:${esc(d.props.color)}"></div>
      <div class="np-color-hex">${esc(d.props.color)}</div>`
  } else if (kind === 'value' && typeof d.props.value === 'number'){
    inner = `<div class="np-value">${fmtVal(d.props.value)}</div>`
  } else {
    inner = `<div class="np-none">${t('np.noPreview')}</div>`
  }
  return `<div class="np-stage">${inner}</div>`
}

function renderProps(d){
  const keys = Object.keys(d.props).filter(k => !k.startsWith('_') && k !== 'tex' && k !== 'color' && k !== 'value')
  const rows = []
  if (d.previewKind === 'image' && d.props.tex) rows.push(['tex', truncStr(decodeURIComponent(String(d.props.tex)), 56)])
  if (typeof d.props.value === 'number' && d.previewKind !== 'value') rows.push(['value', fmtVal(d.props.value)])
  if (d.props.color && d.previewKind !== 'color') rows.push(['color', d.props.color])
  keys.forEach(k => rows.push([k, fmtVal(d.props[k])]))
  if (!rows.length) return ''
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.props')}</div>
      <table class="np-table">
        ${rows.map(([k, v]) => `
          <tr><td class="np-k">${esc(k)}</td><td class="np-v">${esc(v)}</td></tr>`).join('')}
      </table>
    </div>`
}

function renderPorts(d){
  const inRows = d.def.inputs.map(p => {
    const c = d.connections.inputs.find(x => x.port === p.n)
    return `<tr>
      <td class="np-k">${esc(p.n)}</td>
      <td class="np-v"><span class="np-type" data-type="${esc(p.t)}">${esc(p.t)}</span>
        ${c ? `<span class="np-conn" title="${esc(c.fromTitle)} · ${esc(c.fromPort)}">← ${esc(truncStr(c.fromTitle, 14))} · ${esc(c.fromPort)}</span>` : `<span class="np-unconn">${t('np.unconnected')}</span>`}
      </td></tr>`
  })
  const outRows = d.def.outputs.map(p => {
    const cs = d.connections.outputs.filter(x => x.port === p.n)
    return `<tr>
      <td class="np-k">${esc(p.n)}</td>
      <td class="np-v"><span class="np-type" data-type="${esc(p.t)}">${esc(p.t)}</span>
        ${cs.length
          ? cs.map(c => `<span class="np-conn" title="${esc(c.toTitle)} · ${esc(c.toPort)}">→ ${esc(truncStr(c.toTitle, 14))} · ${esc(c.toPort)}</span>`).join(' ')
          : `<span class="np-unconn">${t('np.unconnected')}</span>`}
      </td></tr>`
  })
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.ports')}</div>
      <div class="np-ports-cols">
        <div>
          <div class="np-ports-sub">${t('np.inputs')}</div>
          <table class="np-table">${inRows.join('') || `<tr><td class="np-unconn" colspan="2">—</td></tr>`}</table>
        </div>
        <div>
          <div class="np-ports-sub">${t('np.outputs')}</div>
          <table class="np-table">${outRows.join('') || `<tr><td class="np-unconn" colspan="2">—</td></tr>`}</table>
        </div>
      </div>
    </div>`
}

function renderEvalOut(d){
  const keys = Object.keys(d.evalOut)
  if (!keys.length) return ''
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.evalOut')}</div>
      <table class="np-table">
        ${keys.map(k => `<tr><td class="np-k">${esc(k)}</td><td class="np-v">${esc(fmtVal(d.evalOut[k]))}</td></tr>`).join('')}
      </table>
    </div>`
}

/* ── 资产详情（原「资产详情」窗口并入）──────── */
function renderAssetHead(a){
  return `
    <div class="np-head">
      <span class="np-head-accent" style="background:${esc(a.color || 'var(--primary)')}"></span>
      <div class="np-head-main">
        <div class="np-head-title">${esc(truncStr(a.name, 24))}</div>
        <div class="np-head-sub">
          <span class="np-badge">${esc(a.type)}</span>
          ${a.roleLabel ? `<span class="np-group">${esc(a.roleLabel)}</span>` : ''}
          <span class="np-id" title="${esc(a.typeLabel)}">${esc(a.typeLabel)}</span>
        </div>
      </div>
    </div>`
}

function renderAssetStage(a){
  let inner = ''
  if (a.thumb){
    inner = `
      <img class="np-img" src="${esc(a.thumb)}" alt="${esc(a.name)}"
           loading="lazy" title="${t('np.openImage')}"
           data-np-act="open-image">`
  } else if (a.color){
    inner = `<div class="np-color" data-np-act="none" style="background:linear-gradient(135deg, ${esc(a.color)}, ${esc(a.color2 || a.color)})"></div>`
  } else {
    inner = `<div class="np-none">${t('np.noPreview')}</div>`
  }
  return `<div class="np-stage">${inner}</div>`
}

function renderAssetMeta(a){
  const rows = []
  rows.push([t('asset.detailType'), a.typeLabel])
  if (a.roleLabel) rows.push([t('asset.detailRole'), a.roleLabel])
  if (a.type === 'project'){
    rows.push([t('asset.detailNodes'), String(a.nodeCount ?? '—')])
    rows.push([t('asset.detailTextures'), String(a.textureCount ?? '—')])
  }
  if (Array.isArray(a.metaRows)){
    for (const r of a.metaRows) rows.push(r)
  }
  rows.push([t('asset.detailPath'), a.path || t('asset.detailNoPath')])
  rows.push([t('asset.detailSize'), `<span data-np-info="size">${esc(a.sizeLabel || t('asset.detailLoading'))}</span>`])
  rows.push([t('asset.detailMtime'), `<span data-np-info="mtime">${esc(a.mtimeLabel || '—')}</span>`])
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.props')}</div>
      <table class="np-table">
        ${rows.map(([k, v]) => `<tr><td class="np-k">${esc(k)}</td><td class="np-v" style="word-break:break-all">${v}</td></tr>`).join('')}
      </table>
    </div>`
}

function renderAssetActions(a){
  const btns = []
  btns.push(`<button class="np-btn primary" data-np-asset-act="add">${esc(t(a.type === 'model' ? 'asset.detailViewViewport' : 'asset.detailAddCanvas'))}</button>`)
  btns.push(`<button class="np-btn" data-np-asset-act="fav">${esc(t(a.fav ? 'asset.detailUnfav' : 'asset.detailFav'))}</button>`)

  if (a.path){
    btns.push(`<button class="np-btn" data-np-asset-act="locate">${esc(t('asset.detailLocate'))}</button>`)
    btns.push(`<button class="np-btn" data-np-asset-act="copyPath">${esc(t('asset.detailCopyPath'))}</button>`)
  }
  btns.push(`<button class="np-btn" data-np-asset-act="copyName">${esc(t('asset.detailCopyName'))}</button>`)
  if (a.onRename){
    btns.push(`<button class="np-btn" data-np-asset-act="rename">${esc(t('asset.detailRename'))}</button>`)
  }
  if (a.onDelete){
    btns.push(`<button class="np-btn danger" data-np-asset-act="delete">${esc(t('asset.detailDeleteModel'))}</button>`)
  }
  return `
    <div class="np-section">
      <div class="np-section-title">${t('np.actions')}</div>
      <div class="np-actions">${btns.join('')}</div>
    </div>`
}

function renderAsset(){
  const box = viewEl()
  if (!box || !_asset) return
  _packTexs = null
  box.innerHTML = `
    ${renderAssetHead(_asset)}
    ${renderAssetStage(_asset)}
    <div class="np-scroll">
      ${renderAssetMeta(_asset)}
      ${renderPackTextures(_asset)}
      ${renderAssetActions(_asset)}
    </div>`
  if (_asset.fetchInfo){
    const a = _asset
    _asset.fetchInfo((info) => {
      if (_asset !== a) return
      const sv = box.querySelector('[data-np-info="size"]')
      const mv = box.querySelector('[data-np-info="mtime"]')
      if (!sv.isConnected || !box.isConnected) return
      if (sv && info && info.sizeLabel) sv.textContent = info.sizeLabel
      else if (sv && info && !info.exists) sv.textContent = t('asset.detailNotFound')
      else if (sv && !info) sv.textContent = '—'
      if (mv && info && info.mtimeLabel) mv.textContent = info.mtimeLabel
    })
  }
  fillPackTextures(_asset)
}

function onAssetAction(e){
  const texCell = e.target.closest('[data-np-tex]')
  if (texCell && _asset && Array.isArray(_packTexs) && typeof _asset.onTextureAdd === 'function'){
    const idx = +texCell.getAttribute('data-np-tex')
    const tex = _packTexs[idx]
    if (tex){ try{ _asset.onTextureAdd(tex) }catch(err){} }
    return
  }
  const nav = e.target.closest('[data-np-nav]')
  if (nav && _asset){
    const dir = nav.getAttribute('data-np-nav') || ''
    browsePackTextures(_asset, dir === 'ROOT' ? null : dir)
    return
  }
  const more = e.target.closest('[data-np-texmore]')
  if (more && _asset){ loadPackPage(_asset, true); return }
  const btn = e.target.closest('[data-np-asset-act]')
  if (!btn || !_asset) return
  const act = btn.getAttribute('data-np-asset-act')
  const fn = _asset['on' + act.charAt(0).toUpperCase() + act.slice(1)]
  if (typeof fn === 'function'){ try{ fn() }catch(err){} }
}

/* ── 官方材质包包内贴图：类别 + 层级 + 分页浏览 ── */
let _packTexs = null
let _packBrowse = { dir: null, files: [], filesTotal: 0, loading: false }

function renderPackTextures(a){
  if (!a.fetchTextures) return ''
  return `
    <div class="np-section np-pack-tex">
      <div class="np-section-title">${esc(t('asset.detailPackTextures'))}<span class="np-tex-count" data-np-texcount></span></div>
      <div class="np-tex-cats" data-np-texcats></div>
      <div class="np-tex-crumb" data-np-texcrumb hidden></div>
      <div class="np-tex-dirs" data-np-texdirs hidden></div>
      <div class="np-tex-grid" data-np-texgrid>
        <div class="np-tx-empty">${esc(t('asset.packTexLoading'))}</div>
      </div>
      <div class="np-tex-foot" data-np-texfoot></div>
      <div class="np-tex-hint">${esc(t('asset.packTexAdd'))}</div>
    </div>`
}

function fillPackTextures(a){
  _packTexs = null
  _packBrowse = { dir: null, files: [], filesTotal: 0, loading: false }
  loadPackPage(a, false)
}

function browsePackTextures(a, dir){
  _packTexs = null
  _packBrowse = { dir: dir || null, files: [], filesTotal: 0, loading: false }
  const box = viewEl()
  const grid = box && box.querySelector('[data-np-texgrid]')
  if (grid) grid.innerHTML = `<div class="np-tx-empty">${esc(t('asset.packTexLoading'))}</div>`
  loadPackPage(a, false)
}

function _paintTexChips(box, d){
  const catsEl = box.querySelector('[data-np-texcats]')
  if (catsEl){
    catsEl.innerHTML = ''
    if (d.dir === null || d.dir === undefined){
      const all = document.createElement('button')
      all.className = 'np-chip on'
      all.textContent = t('asset.packTexAll') + ' · ' + (d.total || 0)
      catsEl.appendChild(all)
      ;(d.categories || []).forEach(c => {
        const b = document.createElement('button')
        b.className = 'np-chip'
        b.setAttribute('data-np-nav', c.dir)
        b.textContent = c.name + ' · ' + c.count
        catsEl.appendChild(b)
      })
    } else {
      const back = document.createElement('button')
      back.className = 'np-chip'
      back.setAttribute('data-np-nav', 'ROOT')
      back.textContent = '↩ ' + t('asset.packTexAll')
      catsEl.appendChild(back)
    }
  }
  const crumbEl = box.querySelector('[data-np-texcrumb]')
  if (crumbEl){
    const crumbs = d.breadcrumbs || []
    if (d.dir && crumbs.length > 1){
      crumbEl.hidden = false
      crumbEl.innerHTML = ''
      crumbs.forEach((c, i) => {
        const b = document.createElement('button')
        b.className = 'np-crumb' + (i === crumbs.length - 1 ? ' on' : '')
        b.setAttribute('data-np-nav', c.dir === null ? 'ROOT' : (c.dir || 'ROOT'))
        b.textContent = c.name === 'root' ? t('asset.packTexAll') : c.name
        crumbEl.appendChild(b)
        if (i < crumbs.length - 1){
          const sep = document.createElement('span')
          sep.className = 'np-crumb-sep'
          sep.textContent = '›'
          crumbEl.appendChild(sep)
        }
      })
    } else {
      crumbEl.hidden = true
    }
  }
  const dirsEl = box.querySelector('[data-np-texdirs]')
  if (dirsEl){
    const dirs = d.dirs || []
    dirsEl.hidden = !dirs.length
    dirsEl.innerHTML = ''
    dirs.forEach(sub => {
      const b = document.createElement('button')
      b.className = 'np-chip dir'
      b.setAttribute('data-np-nav', sub.dir)
      b.textContent = '📁 ' + sub.name + ' · ' + sub.count
      dirsEl.appendChild(b)
    })
  }
}

function loadPackPage(a, append){
  const box = viewEl()
  if (!box || !_asset || _asset !== a || typeof a.fetchTextures !== 'function') return
  const grid = box.querySelector('[data-np-texgrid]')
  if (!grid || _packBrowse.loading) return
  if (append && _packBrowse.files.length >= _packBrowse.filesTotal) return
  _packBrowse.loading = true
  const offset = append ? _packBrowse.files.length : 0
  a.fetchTextures({ dir: _packBrowse.dir, offset }, (d) => {
    _packBrowse.loading = false
    if (!grid.isConnected || !_asset || _asset !== a) return
    if (!d || d.error){
      grid.innerHTML = `<div class="np-tx-empty">${esc(t('asset.loadFailed', { msg: (d && d.error) || '—' }))}</div>`
      return
    }
    if (!append) _paintTexChips(box, d)
    _packBrowse.filesTotal = d.filesTotal || 0
    const files = d.files || []
    _packBrowse.files = append ? _packBrowse.files.concat(files) : files
    _packTexs = _packBrowse.files
    const countEl = box.querySelector('[data-np-texcount]')
    if (countEl) countEl.textContent = ' · ' + (d.total || 0)
    grid.innerHTML = ''
    if (!_packBrowse.files.length){
      _packTexs = null
      grid.innerHTML = `<div class="np-tx-empty">${esc(t('asset.packTexEmpty'))}</div>`
    }
    _packBrowse.files.forEach((f, i) => {
      const cell = document.createElement('div')
      cell.className = 'np-tex-cell'
      cell.setAttribute('data-np-tex', String(i))
      cell.title = f.path
      cell.innerHTML = `<img loading="lazy" src="${esc(f.rawUrl)}" alt=""><span class="np-tex-name">${esc(truncStr(f.name, 18))}</span>`
      grid.appendChild(cell)
    })
    const foot = box.querySelector('[data-np-texfoot]')
    if (foot){
      foot.innerHTML = ''
      if (_packBrowse.files.length < _packBrowse.filesTotal){
        const btn = document.createElement('button')
        btn.className = 'np-btn np-tex-more-btn'
        btn.setAttribute('data-np-texmore', '1')
        btn.textContent = t('asset.packTexLoadMore') + `（${_packBrowse.files.length}/${_packBrowse.filesTotal}）`
        foot.appendChild(btn)
      } else if (_packBrowse.files.length){
        const tip = document.createElement('div')
        tip.className = 'np-tex-more'
        tip.textContent = t('asset.packTexShownAll', { n: _packBrowse.files.length })
        foot.appendChild(tip)
      }
    }
  })
}

/* ── 主渲染 ─────────────────────────────── */
function render(){
  if (_mode === 'asset'){ renderAsset(); return }
  const box = viewEl()
  if (!box) return
  const d = _activeId ? getNodeDetail(_activeId) : null
  if (!d){
    _activeId = null
    box.innerHTML = `<div class="np-empty">${t('np.empty')}</div>`
    return
  }
  const multi = _activeCount > 1
    ? `<div class="np-multi">${t('np.multiSelected', { n: _activeCount })}</div>`
    : ''
  box.innerHTML = `
    ${multi}
    ${renderHead(d)}
    ${renderStage(d)}
    <div class="np-scroll">
      ${renderProps(d)}
      ${renderPorts(d)}
      ${renderEvalOut(d)}
    </div>`
}

/* ── 交互 ───────────────────────────────── */
function onStageClick(e){
  const img = e.target.closest('[data-np-act="open-image"]')
  if (img && img.src){
    try{ window.open(img.src, '_blank', 'noopener') }catch(err){}
  }
}

/* ── 初始化 ─────────────────────────────── */
export { render as renderNodePreview }

export function initNodePreview(){
  if (_initialized) return
  _initialized = true

  const view = document.getElementById('nodePreviewView')
  if (!view) return
  view.addEventListener('click', (e) => { onStageClick(e); onAssetAction(e) })

  // 资产详情（资产库点击卡片，原「资产详情」窗口并入此处展示）
  document.addEventListener('nodepreview:show-asset', (e) => {
    _asset = e.detail || null
    _mode = 'asset'
    render()
  })
  document.addEventListener('nodepreview:hide-asset', () => {
    _asset = null
    _mode = 'node'
    render()
  })

  // 节点选中（画布点击 / 关系树点击 / 上下游选择）→ 切换预览目标
  document.addEventListener('nodegraph:selected', (e) => {
    clearTimeout(_selTimer)
    _selTimer = setTimeout(() => {
      const detail = e.detail || {}
      _activeId = detail.id || null
      _activeCount = detail.count || 0
      if (_activeId) _mode = 'node'
      render()
    }, 80)
  })

  // 图结构 / 属性变化 → 刷新详情；节点被删除则回到空状态
  document.addEventListener('nodegraph:changed', () => {
    clearTimeout(_chgTimer)
    _chgTimer = setTimeout(() => {
      if (_activeId && !getNodeDetail(_activeId)) _activeId = null
      render()
    }, 160)
  })

  onLocaleChange(() => {
    render()
  })
  render()
}
