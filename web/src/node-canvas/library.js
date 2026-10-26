/* ── 节点库面板 ─────────────────────────────── */
/* 从 node-canvas.js 原样搬出，逻辑未改。 */
import { $ } from './dom.js'
import { NODE_DEFS } from './defs.js'
import { escapeHtml, nodesLayer, createNode, defaultProps } from './nodes.js'
import { canvasWrap, screenToWorld } from './viewport.js'
import { clamp, _psBlendApply, _NOISE_PV_TYPES, _noisePreviewUrl } from './algorithms.js'

export const libraryEl = $('#library');
export const libraryBody = $('#library-body');
export const LIB_GLYPHS = {
  number:'#', color:'◑', texture:'▦', vector2:'↗',
  add:'+', sub:'−', mul:'×', div:'÷', mix:'↔', clamp:'⌐', colorMix:'◐',
  mainTex:'▦', sample:'◎', hdr:'☀', normalMap:'⊥', rgbaMerge:'⊞', rgbaSplit:'⊟', rgbAlphaSplit:'⊟',
  noise:'〰', voronoi:'◈', gradient:'▮', simplex:'∼', ridge:'∧', warp:'↭',
  white:'▫', cell:'▦', billow:'☁', cubic:'∿', pingpong:'↕', voronoise:'◈',
  reaction:'⊙', lightning:'⚡', mandel:'∞', palette:'◑',
  mainTexOutLeft:'→', mainTexOutRight:'→', normalOutLeft:'↥', normalOutRight:'↥',
  specOutLeft:'↥', specOutRight:'↥',
};
export const LIB_GROUP_SHAPE = { '输入':'circle','运算':'diamond','混合':'rounded','材质':'square','纹理':'square','特效':'hex','输出':'rounded' };
export const LIB_GROUP_GLYPH = { '输入':'◆','运算':'◇','混合':'⊕','材质':'▦','纹理':'〰','特效':'✦','输出':'→' };
export const _libCollapsed = new Set();
export const _libSubCollapsed = new Set();
export let _libSearchInput = null;
export function _libIconHTML(type, def){
  const shape = LIB_GROUP_SHAPE[def.group] || 'square';
  const glyph = LIB_GLYPHS[type] || LIB_GROUP_GLYPH[def.group] || '◆';
  return `<span class="ic ic-${shape}" style="background:${def.color}">${glyph}</span>`;
}
/* ── 节点库条目预览（常驻缩略图）──────────────
    对各节点类型用默认参数生成预览：噪波/渐变/调色板→图像；颜色→色块；
    数值→刻度条；向量→坐标点；PS 混合→双渐变混合示例；其余回退图标。
    按 type 缓存，搜索重建时零开销。 */
export const _libPvCache = new Map();
export const _LIB_PV_SIZE = 40;
export const _BLEND_MODE_OF = {
  blendNormal:'normal', blendDissolve:'dissolve', blendDarken:'darken',
  blendMultiply:'multiply', blendColorBurn:'colorBurn', blendLinearBurn:'linearBurn',
  blendDarkerColor:'darkerColor', blendLighten:'lighten', blendScreen:'screen',
  blendColorDodge:'colorDodge', blendLinearDodge:'linearDodge', blendLighterColor:'lighterColor',
  blendOverlay:'overlay', blendSoftLight:'softLight', blendHardLight:'hardLight',
  blendVividLight:'vividLight', blendLinearLight:'linearLight', blendPinLight:'pinLight',
  blendHardMix:'hardMix', blendDifference:'difference', blendExclusion:'exclusion',
  blendSubtract:'subtract', blendDivide:'divide', blendHue:'hue',
  blendSaturation:'saturation', blendColor:'blendColor', blendLuminosity:'luminosity',
};
export function _blendPreviewUrl(mode){
  const key = 'b:'+mode;
  if(_libPvCache.has(key)) return _libPvCache.get(key);
  const S = _LIB_PV_SIZE;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for(let py = 0; py < S; py++){
    for(let px = 0; px < S; px++){
      const u = px / S, v = py / S;
      const a = [u, 0.5, 1 - u];
      const b = [1 - v, v, 0.5];
      const o = _psBlendApply(mode, a, b, 1);
      const j = (py * S + px) * 4;
      d[j]     = clamp(o[0], 0, 1) * 255;
      d[j + 1] = clamp(o[1], 0, 1) * 255;
      d[j + 2] = clamp(o[2], 0, 1) * 255;
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  let url = null;
  try { url = c.toDataURL('image/png'); } catch(e){ url = null; }
  _libPvCache.set(key, url);
  return url;
}
export function _genLibPreview(type, def){
  try {
    if(_NOISE_PV_TYPES.has(type)){
      const url = _noisePreviewUrl({ type, props: defaultProps(type) }, _LIB_PV_SIZE);
      if(url) return `<span class="pv pv-img" style="background-image:url('${url}')"></span>`;
    } else if(type === 'gradient'){
      const p = defaultProps(type);
      return `<span class="pv pv-grad" style="background:linear-gradient(135deg, ${p.colorA}, ${p.colorB})"></span>`;
    } else if(type === 'color'){
      const p = defaultProps(type);
      return `<span class="pv pv-color" style="background:${p.color}"></span>`;
    } else if(type === 'colorMix'){
      return `<span class="pv pv-grad" style="background:linear-gradient(135deg, #7cbd56, #c084fc)"></span>`;
    } else if(type === 'number'){
      return `<span class="pv pv-num"><i class="mark" style="left:50%"></i></span>`;
    } else if(type === 'vector2'){
      return `<span class="pv pv-vec"><i class="dot" style="left:50%;top:50%"></i></span>`;
    } else if(_BLEND_MODE_OF[type]){
      const url = _blendPreviewUrl(_BLEND_MODE_OF[type]);
      if(url) return `<span class="pv pv-img" style="background-image:url('${url}')"></span>`;
    }
  } catch(e){}
  return _libIconHTML(type, def);
}
export function _libPreviewHTML(type, def){
  if(_libPvCache.has(type)) return _libPvCache.get(type);
  const html = _genLibPreview(type, def);
  _libPvCache.set(type, html);
  return html;
}
export function buildLibrary(){
  const searchBox=document.createElement('div');
  searchBox.className='lib-search';
  searchBox.innerHTML=`<span class="lib-search-ico">⌕</span><input type="text" id="lib-search-input" placeholder="搜索节点…" autocomplete="off" spellcheck="false"><button class="lib-search-clear" id="lib-search-clear" title="清除" type="button">✕</button>`;
  libraryBody.appendChild(searchBox);
  _libSearchInput = searchBox.querySelector('input');
  const clearBtn=searchBox.querySelector('#lib-search-clear');
  _libSearchInput.addEventListener('input',()=>{
    clearBtn.hidden = !_libSearchInput.value;
    filterLibrary(_libSearchInput.value);
  });
  clearBtn.addEventListener('click',()=>{ _libSearchInput.value=''; clearBtn.hidden=true; filterLibrary(''); _libSearchInput.focus(); });
  filterLibrary('');
  _enableLibDrop();
}
export function _highlight(text, term){
  if(!term) return escapeHtml(text);
  const t = term.toLowerCase(), low = text.toLowerCase();
  const idx = low.indexOf(t);
  if(idx < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0,idx)) + '<mark>' + escapeHtml(text.slice(idx, idx+t.length)) + '</mark>' + escapeHtml(text.slice(idx+t.length));
}
export let _libDragType = null, _ghostEl = null;
export function _updateGhost(e){
  if(!_libDragType) return;
  const def = NODE_DEFS[_libDragType];
  if(!def) return;
  if(!_ghostEl){
    _ghostEl = document.createElement('div');
    _ghostEl.className = 'node ghost';
    _ghostEl.innerHTML = `<div class="node-head"><span class="badge" style="background:${def.color}"></span><span class="title">${escapeHtml(def.title)}</span></div>`;
    nodesLayer.appendChild(_ghostEl);
  }
  _ghostEl.style.setProperty('--node-color', def.color);
  const wp = screenToWorld(e.clientX, e.clientY);
  _ghostEl.style.left = (wp.x - 100) + 'px';
  _ghostEl.style.top = (wp.y - 14) + 'px';
}
export function _clearGhost(){ if(_ghostEl){ _ghostEl.remove(); _ghostEl = null; } }
export function _libItemEl(k,d){
  const it=document.createElement('div'); it.className='lib-item';
  it.draggable=true; it.dataset.type=k;
  it.innerHTML=`${_libPreviewHTML(k,d)}<span class="nm">${d.title}</span><span class="ports">${d.inputs.length||'·'}→${d.outputs.length||'·'}</span>`;
  it.addEventListener('click', ()=>{
    const r = canvasWrap.getBoundingClientRect();
    const wp = screenToWorld(r.left+r.width/2, r.top+r.height/2);
    createNode(k, wp.x-100, wp.y-30);
  });
  it.addEventListener('dragstart',(e)=>{
    e.dataTransfer.setData('text/node-type', k);
    e.dataTransfer.effectAllowed='copy';
    _libDragType = k;
    canvasWrap.classList.add('lib-drop-target');
  });
  it.addEventListener('dragend',()=>{ canvasWrap.classList.remove('lib-drop-target'); _libDragType = null; _clearGhost(); });
  return it;
}
export function filterLibrary(term){
  term=(term||'').trim().toLowerCase();
  const existing=libraryBody.querySelectorAll('.lib-group');
  existing.forEach(el=>el.remove());
  const groups = {};
  Object.entries(NODE_DEFS).forEach(([k,d])=>{
    if(d.hidden) return;
    if(term && !d.title.toLowerCase().includes(term) && !k.toLowerCase().includes(term)
       && !d.group.toLowerCase().includes(term) && !(d.subgroup&&d.subgroup.toLowerCase().includes(term))) return;
    (groups[d.group]=groups[d.group]||[]).push([k,d]);
  });
  const wrap=document.createElement('div'); wrap.className='lib-group';
  Object.entries(groups).forEach(([g,items])=>{
    const collapsed = _libCollapsed.has(g);
    const gh=document.createElement('div'); gh.className='lib-group-head'+(collapsed?' collapsed':'');
    gh.innerHTML=`<span class="lib-arrow">${collapsed?'▸':'▾'}</span><span class="lib-gname">${g}</span><span class="lib-count">${items.length}</span>`;
    gh.addEventListener('click',()=>{
      if(_libCollapsed.has(g)) _libCollapsed.delete(g); else _libCollapsed.add(g);
      filterLibrary(_libSearchInput ? _libSearchInput.value : '');
    });
    wrap.appendChild(gh);
    const itemsWrap=document.createElement('div'); itemsWrap.className='lib-group-items';
    if(collapsed) itemsWrap.style.display='none';
    const hasSub = items.some(([,d])=>d.subgroup);
    if(hasSub){
      const subs = {};
      items.forEach(([k,d])=>{ const sg=d.subgroup||'其他'; (subs[sg]=subs[sg]||[]).push([k,d]); });
      Object.entries(subs).forEach(([sg,subItems])=>{
        const subKey=g+'>'+sg;
        const subCollapsed=_libSubCollapsed.has(subKey);
        const sh=document.createElement('div'); sh.className='lib-sub-head'+(subCollapsed?' collapsed':'');
        sh.innerHTML=`<span class="lib-sub-arrow">${subCollapsed?'▸':'▾'}</span><span class="lib-sub-name">${sg}</span><span class="lib-sub-count">${subItems.length}</span>`;
        sh.addEventListener('click',()=>{
          if(_libSubCollapsed.has(subKey)) _libSubCollapsed.delete(subKey); else _libSubCollapsed.add(subKey);
          filterLibrary(_libSearchInput ? _libSearchInput.value : '');
        });
        itemsWrap.appendChild(sh);
        const subWrap=document.createElement('div'); subWrap.className='lib-sub-items';
        if(subCollapsed) subWrap.style.display='none';
        subItems.forEach(([k,d])=>{ const it=_libItemEl(k,d); if(term && d.title.toLowerCase().includes(term)){ it.querySelector('.nm').innerHTML=_highlight(d.title, term); } subWrap.appendChild(it); });
        itemsWrap.appendChild(subWrap);
      });
    } else {
      items.forEach(([k,d])=>{ const it=_libItemEl(k,d); if(term && d.title.toLowerCase().includes(term)){ it.querySelector('.nm').innerHTML=_highlight(d.title, term); } itemsWrap.appendChild(it); });
    }
    wrap.appendChild(itemsWrap);
  });
  if(Object.keys(groups).length===0){
    const empty=document.createElement('div');
    empty.className='lib-empty';
    empty.innerHTML=`<span class="lib-empty-ico">⌕</span><span>未找到匹配节点</span>`;
    wrap.appendChild(empty);
  }
  libraryBody.appendChild(wrap);
}
export let _libDropEnabled=false;
export function _enableLibDrop(){
  if(_libDropEnabled) return; _libDropEnabled=true;
  canvasWrap.addEventListener('dragover',(e)=>{
    if(e.dataTransfer.types.includes('text/node-type')){ e.preventDefault(); e.dataTransfer.dropEffect='copy'; _updateGhost(e); }
  });
  canvasWrap.addEventListener('dragleave',(e)=>{
    if(!canvasWrap.contains(e.relatedTarget)) _clearGhost();
  });
  canvasWrap.addEventListener('drop',(e)=>{
    const k=e.dataTransfer.getData('text/node-type');
    if(!k) return;
    e.preventDefault();
    const wp=screenToWorld(e.clientX, e.clientY);
    createNode(k, wp.x-100, wp.y-30);
    _clearGhost();
  });
}
