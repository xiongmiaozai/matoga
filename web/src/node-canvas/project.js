/* ── 节点项目管理 + 自动保存 ─────────────────────
   从 node-canvas.js 原样搬出，逻辑未改：
   - 项目保存 / 加载（.mtgp 自包含工程）
   - 项目指示器 + 脏标记 + 防抖自动保存
   _currentProject 由本模块独占持有，外部只能通过
   getCurrentProject / setCurrentProject / clearCurrentProject 访问。 */
import { state } from './state.js'
import { _NOISE_PV_TYPES, _noisePreviewUrl } from './algorithms.js'
import { apiUrl } from '../utils.js'
import { fitView } from './layout.js'
import { toast } from './status.js'
import { _loadImg } from './tex-utils.js'

/* ── 节点项目管理：保存 / 加载（.mtgp 特殊格式，自包含工程）── */
const _TEX_REF_PREFIX = '@tex/';
function _safeTexName(name, i){
  const base = (typeof name==='string' && name.trim())
    ? name.trim().replace(/[\\/:*?"<>|\s]/g,'_').slice(0,64) : '';
  const ext = base && /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|svg|ico)$/i.test(base) ? '' : '.png';
  const safe = base || ('texture_'+i);
  return i+'-'+safe+ext;
}
function _texRef(file){ return _TEX_REF_PREFIX+file; }
function _rawTexUrl(absPath){ return '/api/file/raw?path='+encodeURIComponent(absPath); }

export function _collectProjectTextures(graph){
  const textures = [];
  const nodeTex = new Map();
  state.nodes.forEach(node=>{
    if((node.type==='texture'||node.type==='mainTex') && node.props.tex) nodeTex.set(node.id, node.props);
  });
  let i = 0;
  graph.nodes.forEach(nd=>{
    const p = nodeTex.get(nd.id);
    if(!p) return;
    const src = p.tex;
    let name = p._name || '';
    let entry = null;
    if(src.startsWith('data:')){
      entry = { name, dataUrl: src };
    } else {
      const m = /[?&]path=([^&]+)/.exec(src);
      if(m){
        try {
          const abs = decodeURIComponent(m[1]);
          if(!name) name = abs.split(/[\\/]/).pop() || '';
          entry = { name, path: abs };
        } catch(e){}
      }
    }
    if(!entry) return;
    const file = _safeTexName(entry.name, i);
    nd.widgets_values = nd.widgets_values && typeof nd.widgets_values==='object' ? JSON.parse(JSON.stringify(nd.widgets_values)) : {};
    nd.widgets_values.tex = _texRef(file);
    textures.push({ name: entry.name, path: entry.path, dataUrl: entry.dataUrl });
    i++;
  });
  return textures;
}

export function _generateProjectThumb(){
  return new Promise(resolve=>{
    const S = 256, CELL = 3;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    const sources = [];
    state.nodes.forEach(node=>{
      if((node.type==='texture'||node.type==='mainTex') && node.props.tex){
        sources.push({kind:'img', src: node.props.tex});
      } else if(_NOISE_PV_TYPES.has(node.type)){
        const u = _noisePreviewUrl(node);
        if(u) sources.push({kind:'img', src: u});
      } else if(node.type==='color' && node.props.color){
        sources.push({kind:'color', color: node.props.color});
      }
    });
    const picked = sources.slice(0, CELL*CELL);
    const done = ()=>{
      if(!picked.length){
        const g = ctx.createLinearGradient(0,0,S,S);
        g.addColorStop(0,'#1c2230'); g.addColorStop(1,'#2a3348');
        ctx.fillStyle = g; ctx.fillRect(0,0,S,S);
        ctx.fillStyle = '#7cbd56';
        ctx.font = 'bold 28px ui-monospace,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(state.nodes.size+' 节点', S/2, S/2);
      }
      resolve(c.toDataURL('image/png'));
    };
    if(!picked.length){ done(); return; }
    const imgs = picked.map(p=> p.kind==='img' ? _loadImg(p.src) : Promise.resolve(null));
    Promise.all(imgs).then(loaded=>{
      const n = picked.length;
      const grid = Math.ceil(Math.sqrt(n));
      const cellW = S/grid, cellH = S/Math.ceil(n/grid);
      picked.forEach((p, idx)=>{
        const x = (idx%grid)*cellW, y = Math.floor(idx/grid)*cellH;
        const im = loaded[idx];
        if(p.kind==='color' || !im){
          ctx.fillStyle = p.kind==='color' ? p.color : '#262b38';
          ctx.fillRect(x+1, y+1, cellW-2, cellH-2);
        } else {
          const r = Math.min(cellW/im.naturalWidth, cellH/im.naturalHeight);
          const w = im.naturalWidth*r, h = im.naturalHeight*r;
          ctx.drawImage(im, x+(cellW-w)/2, y+(cellH-h)/2, w, h);
        }
      });
      done();
    }).catch(done);
  });
}


/* 记忆最近一次打开/保存的项目 id（config.lastNodeProject），供启动时自动恢复 */
export function rememberProject(id){
  try{ if(window.api && window.api.setConfig) window.api.setConfig({ lastNodeProject: id || null }); }catch(e){}
}

/* 启动恢复：读取 lastNodeProject 并静默加载；无记忆/加载失败时回退示例图 */
export async function restoreLastProject(){
  let lastId = null
  try{
    const cfg = await window.api.getConfig()
    lastId = cfg && cfg.lastNodeProject
  }catch(e){}
  if(!lastId) return false
  try{
    const data = await loadNodeProject(lastId)
    toast('已恢复上次项目「' + (data && data.name ? data.name : lastId) + '」')
    return true
  }catch(e){ return false }
}

/* ── 当前节点项目（Ctrl+S / 保存按钮的目标地址：data/node-projects/<id>.mtgp/）── */
let _currentProject = null;
export function getCurrentProject(){ return _currentProject ? { ..._currentProject } : null; }
export function setCurrentProject(v){ _currentProject = v ? { id: v.id, name: v.name } : null; }
export function setAutoSaveSuspended(v){ _suspendAutoSave = !!v; }
export function clearCurrentProject(){ _currentProject = null; }

const AUTOSAVE_DELAY = 2500;
let _dirty = false;
let _autoSaveTimer = null;
let _suspendAutoSave = false;
let _saving = false;
let _lastSavedSig = null;

function _graphSignature(){
  const nodes = [];
  state.nodes.forEach(n=>{
    nodes.push([n.id, n.type, Math.round(n.x), Math.round(n.y), n.title||null, !!n.collapsed, JSON.stringify(n.props)]);
  });
  const edges = [];
  state.edges.forEach(e=>{
    edges.push([e.id, e.from.node, e.from.port, e.to.node, e.to.port]);
  });
  return JSON.stringify([nodes, edges]);
}

function _updateProjectIndicator(){
  const badge = document.getElementById('ncProject');
  const stat = document.getElementById('stat-project');
  const name = _currentProject ? _currentProject.name : null;
  if(badge){
    const nm = badge.querySelector('.nc-project-name');
    if(nm) nm.textContent = name ? name : '未关联项目';
    badge.classList.toggle('linked', !!name);
    badge.classList.toggle('dirty', !!name && _dirty);
    badge.title = name
      ? `当前节点项目：${name}（${_currentProject.id}）· ${_dirty ? '有未保存更改' : '已保存'}`
      : '当前节点项目：未关联（Ctrl+S 保存后自动关联）';
  }
  if(stat){
    stat.textContent = name ? name : '—';
    stat.parentElement && (stat.parentElement.title = name
      ? `当前打开的节点项目：${name}` : '未关联节点项目');
  }
}

function _setAutoSaveState(kind, text){
  const seg = document.getElementById('seg-autosave');
  const b = document.getElementById('stat-autosave');
  if(b) b.textContent = text;
  if(seg){
    seg.classList.remove('saving','saved','error');
    if(kind) seg.classList.add(kind);
  }
}

export function markDirty(){
  if(_suspendAutoSave) return;
  if(!_dirty){ _dirty = true; _updateProjectIndicator(); }
  if(!_currentProject) return;
  if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(()=>{ _autoSaveTimer=null; _autoSave(); }, AUTOSAVE_DELAY);
}

export function resetSavedState(){
  _dirty = false;
  if(_autoSaveTimer){ clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
  try { _lastSavedSig = state.nodes.size ? _graphSignature() : null; } catch(e){ _lastSavedSig = null; }
  if(_currentProject) _setAutoSaveState('saved', '已就绪');
  else _setAutoSaveState(null, '—');
  _updateProjectIndicator();
}

async function _autoSave(force, opts){
  if(!_currentProject || !_dirty || _saving || _suspendAutoSave) return;
  if(state.nodes.size === 0) return;
  let sig = null;
  try { sig = _graphSignature(); } catch(e){}
  if(sig !== null && sig === _lastSavedSig){
    _dirty = false;
    _setAutoSaveState('saved', '已保存');
    _updateProjectIndicator();
    return;
  }
  _saving = true;
  _setAutoSaveState('saving', '自动保存中…');
  _updateProjectIndicator();
  const proj = { ..._currentProject };
  try {
    await saveNodeProject(proj.name, proj.id, { keepalive: !!(opts && opts.keepalive) });
    if(_currentProject && _currentProject.id === proj.id){
      _dirty = false;
      _lastSavedSig = sig;
      const t = new Date();
      const hh = String(t.getHours()).padStart(2,'0');
      const mm = String(t.getMinutes()).padStart(2,'0');
      const ss = String(t.getSeconds()).padStart(2,'0');
      _setAutoSaveState('saved', `已保存 ${hh}:${mm}:${ss}`);
    }
  } catch(e){
    if(_currentProject && _currentProject.id === proj.id){
      _setAutoSaveState('error', '失败·稍后重试');
      if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
      _autoSaveTimer = setTimeout(()=>{ _autoSaveTimer=null; _autoSave(); }, 10000);
    }
  } finally {
    _saving = false;
    _updateProjectIndicator();
  }
}

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden' && _currentProject && _dirty) _autoSave(true);
});
window.addEventListener('beforeunload', (e)=>{
  if(_currentProject && _dirty && state.nodes.size > 0){
    _autoSave(true, { keepalive: true });
    e.preventDefault();
    e.returnValue = '';
  }
});

export async function saveNodeProject(name, id, opts){
  if(state.nodes.size===0) throw new Error('画布为空');
  const graph = _graphToComfy();
  const textures = _collectProjectTextures(graph);
  const thumbnail = await _generateProjectThumb();
  const res = await fetch(apiUrl('/api/node-projects'), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: id||undefined, name, graph, thumbnail, textures }),
    ...(opts && opts.keepalive ? { keepalive: true } : {})
  });
  const j = await res.json();
  if(!j || !j.ok) throw new Error((j && j.msg) || '保存失败');
  _currentProject = { id: j.data.id, name };
  rememberProject(j.data.id);
  resetSavedState();
  try{ document.dispatchEvent(new CustomEvent('nodeproject:saved', { detail:{ id:_currentProject.id, name:_currentProject.name } })); }catch(e){}
  return j.data;
}

export async function loadNodeProject(id){
  const res = await fetch(apiUrl('/api/node-projects/'+encodeURIComponent(id)));
  const j = await res.json();
  if(!j || !j.ok) throw new Error((j && j.msg) || '加载失败');
  const data = j.data;
  const graph = JSON.parse(JSON.stringify(data.graph));
  const urlByFile = new Map();
  (data.textures||[]).forEach(t=>{ if(t.exists) urlByFile.set(t.file, _rawTexUrl(t.fullPath)); });
  let json = JSON.stringify(graph);
  urlByFile.forEach((url, file)=>{
    json = json.split(JSON.stringify(_texRef(file))).join(JSON.stringify(url));
  });
  loadGraphJSON(json);
  _currentProject = { id: data.id || id, name: data.name || id };
  rememberProject(data.id || id);
  resetSavedState();
  setTimeout(fitView, 80);
  return data;
}

/* _graphToComfy 由主文件注入（它依赖编辑器内部状态），避免循环引用 */
let _graphToComfy = () => ({ nodes: [], edges: [] });
let loadGraphJSON = () => {};
export function setProjectHooks(h){
  if(h && h.graphToComfy) _graphToComfy = h.graphToComfy;
  if(h && h.loadGraphJSON) loadGraphJSON = h.loadGraphJSON;
}
