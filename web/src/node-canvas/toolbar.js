/* ── 工具栏 / 面板交互（导入即接线）───────────────
   从 node-canvas.js 原样搬出，逻辑未改。 */
import { state } from './state.js'
import { $ } from './dom.js'
import * as m3d from '../material3d.js'
import { canvasWrap, applyViewport, setZoom } from './viewport.js'
import { libraryEl } from './library.js'
import { renderEdges } from './edges.js'
import { updateStats } from './status.js'
import { evaluate } from './evaluate.js'
import { pushHistory } from './history.js'
import { fitView, autoLayout } from './layout.js'
import { saveGraph, loadGraph } from './graph-io.js'
import { showCanvasMenu } from './menus.js'
import { clearCurrentProject, rememberProject } from './project.js'
import { uiConfirm } from '../ui-dialog.js'

export function wireToolbar(){
  $('#btn-add').addEventListener('click', (e)=>{
    const r = canvasWrap.getBoundingClientRect();
    showCanvasMenu({clientX:r.left+40, clientY:r.top+60, preventDefault:()=>{}});
  });
  $('#btn-fit').addEventListener('click', fitView);
  $('#btn-clear').addEventListener('click', ()=>{
    if(state.nodes.size===0) return;
    (async()=>{
      if(!await uiConfirm({ title:'清空画布', message:'清空所有节点？', danger:true })) return;
      pushHistory();
      state.nodes.forEach(n=>n.el.remove());
      state.nodes.clear(); state.edges.clear(); state.selected.clear();
      clearCurrentProject();
      rememberProject(null);
      renderEdges(); updateStats(); evaluate();
    })();
  });
  $('#btn-layout').addEventListener('click', autoLayout);
  const _btnSave = $('#btn-save');
  if (_btnSave) _btnSave.addEventListener('click', saveGraph);
  const _btnLoad = $('#btn-load');
  if (_btnLoad) _btnLoad.addEventListener('click', loadGraph);
  $('#zoom-in').addEventListener('click', ()=>setZoom(state.viewport.zoom*1.2));
  $('#zoom-out').addEventListener('click', ()=>setZoom(state.viewport.zoom/1.2));
  $('#btn-lib').addEventListener('click', ()=>{
    libraryEl.classList.toggle('collapsed');
    canvasWrap.classList.toggle('library-collapsed');
    $('#statusbar').classList.toggle('library-collapsed');
    $('#btn-lib').textContent = libraryEl.classList.contains('collapsed') ? '节点库 ▶' : '◀ 节点库';
  });
  $('#library-close').addEventListener('click', ()=>$('#btn-lib').click());
  (()=>{
    const handle=$('#lib-resize'); let dragging=false, sx=0, sw=0;
    handle.addEventListener('pointerdown',(e)=>{
      dragging=true; sx=e.clientX;
      sw=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lib-w'))||208;
      document.documentElement.style.cursor='ew-resize'; e.preventDefault();
    });
    window.addEventListener('pointermove',(e)=>{
      if(!dragging) return;
      const w=Math.min(360,Math.max(160,sw+e.clientX-sx));
      document.documentElement.style.setProperty('--lib-w',w+'px');
    });
    window.addEventListener('pointerup',()=>{ if(dragging){ dragging=false; document.documentElement.style.cursor=''; } });
  })();
  $('#canvas-close').addEventListener('click', ()=>{
    const m = canvasWrap.classList.toggle('minimized');
    $('#canvas-close').textContent = m ? '▢' : '✕';
    $('#canvas-close').title = m ? '展开' : '最小化';
  });

  /* ── 预览面板交互（复用主页右栏 #sidebarRight）────────── */
  const sidebarRight = $('#sidebarRight');
  const _btnPreview = $('#btn-preview');
  if(_btnPreview) _btnPreview.addEventListener('click', ()=>{
    const hidden = sidebarRight ? sidebarRight.classList.toggle('collapsed') : false;
    _btnPreview.textContent = hidden ? '▶ 实时预览' : '◀ 实时预览';
    if(!hidden && m3d){
      const _c = document.getElementById('material3dContainer');
      if(_c && m3d.initMaterial3D && !m3d.isMaterial3DReady()) m3d.initMaterial3D(_c);
      setTimeout(()=>{ if(m3d.isMaterial3DReady && m3d.isMaterial3DReady()) evaluate(); }, 250);
    }
  });
}

