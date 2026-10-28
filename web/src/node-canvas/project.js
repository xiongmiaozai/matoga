/* ── 节点项目管理 + 自动保存 ─────────────────────
   从 node-canvas.js 原样搬出，逻辑未改：
   - 项目保存 / 加载（.mtgp 自包含工程）
   - 项目指示器 + 脏标记 + 防抖自动保存
   S.currentProject 由本模块独占持有，外部只能通过
   getCurrentProject / setCurrentProject / clearCurrentProject 访问。 */
import { state } from './state.js'
import { _NOISE_PV_TYPES, _noisePreviewUrl } from './algorithms.js'
import { apiUrl } from '../utils.js'
import { fitView } from './layout.js'
import { toast } from './status.js'
import { _loadImg } from './tex-utils.js'
import { S } from './proj/state.js'

import { _collectProjectTextures, _generateProjectThumb, _rawTexUrl, _texRef } from './proj/texture.js'
import { resetSavedState } from './proj/autosave.js'

/* 对外接口：原文件即从本模块导出，保持导入路径不变。 */
export { _collectProjectTextures, _generateProjectThumb } from './proj/texture.js'
export { markDirty, resetSavedState } from './proj/autosave.js'
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

export function getCurrentProject(){ return S.currentProject ? { ...S.currentProject } : null; }
export function setCurrentProject(v){ S.currentProject = v ? { id: v.id, name: v.name } : null; }
export function setAutoSaveSuspended(v){ S.suspendAutoSave = !!v; }
export function clearCurrentProject(){ S.currentProject = null; }

export async function saveNodeProject(name, id, opts){
  if(state.nodes.size===0) throw new Error('画布为空');
  const graph = S.graphToComfy();
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
  S.currentProject = { id: j.data.id, name };
  rememberProject(j.data.id);
  resetSavedState();
  try{ document.dispatchEvent(new CustomEvent('nodeproject:saved', { detail:{ id:S.currentProject.id, name:S.currentProject.name } })); }catch(e){}
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
  S.loadGraphJSON(json);
  S.currentProject = { id: data.id || id, name: data.name || id };
  rememberProject(data.id || id);
  resetSavedState();
  setTimeout(fitView, 80);
  return data;
}

/* S.graphToComfy 由主文件注入（它依赖编辑器内部状态），避免循环引用 */

export function setProjectHooks(h){
  if(h && h.graphToComfy) S.graphToComfy = h.graphToComfy;
  if(h && h.loadGraphJSON) S.loadGraphJSON = h.loadGraphJSON;
}
