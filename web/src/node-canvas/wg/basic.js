/**
 * matoga - 节点画布属性控件：基础控件
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 widgets.js 按职责搬出，逻辑未改。
 */
import { clamp } from '../algorithms.js'
import { uiPrompt } from '../../ui-dialog.js'
import { S, setWidgetHooks, evaluate, _markDirty, toast } from './state.js'
import { _scheduleEval } from './schedule.js'

export function numWidget(node, key, min, max, step){
  const box = document.createElement('div');
  box.className='w-num';
  const inp = document.createElement('input');
  inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=node.props[key];
  const val = document.createElement('span'); val.className='val';
  val.textContent = (+node.props[key]).toFixed(2);
  inp.addEventListener('input', ()=>{
    node.props[key] = +inp.value;
    val.textContent = (+inp.value).toFixed(2);
    _scheduleEval();
  });
  // 双击可输入
  val.addEventListener('dblclick', async ()=>{
    const v = await uiPrompt({ title:'输入数值', label:node.props[key]+'' , value:node.props[key]+'' });
    if(v!==null && !isNaN(+v)){ node.props[key]=clamp(+v,min,max); inp.value=node.props[key];
      val.textContent=(+node.props[key]).toFixed(2); evaluate(); _markDirty(); }
  });
  box.appendChild(inp); box.appendChild(val);
  return box;
}
export function colorWidget(node, key){
  const box = document.createElement('div');
  box.className='w-color';
  const inp = document.createElement('input');
  inp.type='color'; inp.value=node.props[key];
  const hex = document.createElement('span'); hex.className='hex'; hex.textContent=node.props[key];
  inp.addEventListener('input', ()=>{
    node.props[key]=inp.value; hex.textContent=inp.value; _scheduleEval();
  });
  box.appendChild(inp); box.appendChild(hex);
  return box;
}
export function vecWidget(node, keys, min, max, step){
  const box = document.createElement('div');
  keys.forEach(k=>{
    const row = document.createElement('div');
    row.className='w-num';
    row.style.marginBottom='4px';
    const lbl=document.createElement('span'); lbl.className='w-label';
    lbl.style.margin='0 6px 0 0'; lbl.textContent=k+':';
    lbl.style.textTransform='none'; lbl.style.letterSpacing='0';
    const inp=document.createElement('input'); inp.type='range';
    inp.min=min; inp.max=max; inp.step=step; inp.value=node.props[k];
    const val=document.createElement('span'); val.className='val';
    val.textContent=(+node.props[k]).toFixed(2);
    inp.addEventListener('input',()=>{node.props[k]=+inp.value; val.textContent=(+inp.value).toFixed(2); _scheduleEval();});
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(val);
    box.appendChild(row);
  });
  return box;
}
export function textureWidget(node, key){
  const box = document.createElement('div');
  box.className='w-tex';
  const thumb=document.createElement('div'); thumb.className='thumb';
  const info=document.createElement('div'); info.className='info';
  const fn=document.createElement('div'); fn.className='fn'; fn.textContent='未选择';
  const btn=document.createElement('div'); btn.className='btn'; btn.textContent='选择图片…';
  info.appendChild(fn); info.appendChild(btn);
  box.appendChild(thumb); box.appendChild(info);
  if(node.props[key]){
    thumb.innerHTML=`<img src="${node.props[key]}" alt="">`;
    fn.textContent = (node.props._name || node.props[key].split('/').pop()).slice(0,20);
  }
  btn.addEventListener('click', ()=>{
    const f = document.createElement('input'); f.type='file'; f.accept='image/*';
    f.addEventListener('change', ()=>{
      const file=f.files[0]; if(!file) return;
      const r=new FileReader();
      r.onload=()=>{ node.props[key]=r.result; node.props._name=file.name;
        thumb.innerHTML=`<img src="${r.result}" alt="">`;
        fn.textContent=file.name.slice(0,20); evaluate(); _markDirty(); };
      r.readAsDataURL(file);
    });
    f.click();
  });
  return box;
}

export function selectWidget(node, key, options){
  const box=document.createElement('div');
  const sel=document.createElement('select'); sel.className='w-select';
  options.forEach(o=>{
    const op=document.createElement('option'); op.value=o; op.textContent=o;
    if(o===node.props[key]) op.selected=true;
    sel.appendChild(op);
  });
  sel.addEventListener('change',()=>{node.props[key]=sel.value; evaluate(); _markDirty();});
  box.appendChild(sel);
  return box;
}
export function previewWidget(node, key){
  const box=document.createElement('div');
  box.className='w-preview';
  box.innerHTML=`<div class="pv-empty">无输入</div>`;
  box.dataset.preview = key;
  node._previewEl = box;
  return box;
}
export function _labeledRow(label, widgetEl){
  const row=document.createElement('div');
  row.className='w-row';
  row.style.display='flex'; row.style.alignItems='center'; row.style.gap='6px';
  row.style.marginBottom='4px';
  const lbl=document.createElement('span');
  lbl.style.fontSize='10px'; lbl.style.color='var(--text-dim)';
  lbl.style.minWidth='28px'; lbl.style.textTransform='none'; lbl.style.letterSpacing='0';
  lbl.textContent=label;
  row.appendChild(lbl); row.appendChild(widgetEl);
  widgetEl.style.flex='1';
  return row;
}
