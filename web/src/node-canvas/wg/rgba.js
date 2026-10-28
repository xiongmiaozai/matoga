/**
 * matoga - 节点画布属性控件：RGBA 合成/拆分控件
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 widgets.js 按职责搬出，逻辑未改。
 */
import { S, setWidgetHooks, evaluate, _markDirty, toast } from './state.js'
import { _labeledRow, numWidget } from './basic.js'

export function rgbaMergeWidget(node){
  const box = document.createElement('div');
  box.className='w-multi';
  const hint = document.createElement('div');
  hint.style.cssText='font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;';
  hint.textContent='连线贴图 / 噪波 tex 输入时取图像通道，常量仅作未连线兜底';
  box.appendChild(hint);
  box.appendChild(_labeledRow('R 常量', numWidget(node,'r',0,1,0.01)));
  box.appendChild(_labeledRow('G 常量', numWidget(node,'g',0,1,0.01)));
  box.appendChild(_labeledRow('B 常量', numWidget(node,'b',0,1,0.01)));
  box.appendChild(_labeledRow('A 常量', numWidget(node,'a',0,1,0.01)));
  const sizeInp = document.createElement('input');
  sizeInp.type='number'; sizeInp.className='w-text';
  sizeInp.min=16; sizeInp.step=64; sizeInp.placeholder='自动/自定义';
  sizeInp.value = node.props.size ?? '';
  sizeInp.title = '留空=自动（取输入纹理尺寸）；可输入任意值，如 4096';
  sizeInp.addEventListener('change', ()=>{
    const raw = sizeInp.value.trim();
    if(raw===''){ node.props.size = null; }
    else {
      const v = Math.max(16, Math.round(+raw));
      if(!isFinite(v)){ sizeInp.value=''; node.props.size = null; return; }
      node.props.size = v; sizeInp.value = v;
    }
    evaluate();
    _markDirty();
  });
  box.appendChild(_labeledRow('尺寸', sizeInp));
  const actions = document.createElement('div');
  actions.className='w-tex';
  actions.style.marginTop='4px';
  const info = document.createElement('div'); info.className='info';
  const btn=document.createElement('div'); btn.className='btn'; btn.textContent='保存 PNG';
  info.appendChild(btn); actions.appendChild(info);
  box.appendChild(actions);
  btn.addEventListener('click', ()=>{
    const url = node._rgbaUrl;
    if(!url){ toast('RGBA 尚未合成（等待输入或常量求值）'); return; }
    const a=document.createElement('a');
    a.href=url; a.download='matoga-rgba.png';
    a.click();
  });
  return box;
}
export function rgbaSplitWidget(node){
  const box = document.createElement('div');
  box.className='w-multi';
  const hint = document.createElement('div');
  hint.style.cssText='font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;';
  hint.textContent='各通道输出为灰度图（通道值写入 RGB），可接回 RGBA 合并还原原图';
  box.appendChild(hint);
  const actions = document.createElement('div');
  actions.className='w-tex';
  actions.style.marginTop='4px';
  const info = document.createElement('div'); info.className='info';
  info.style.cssText='display:flex;gap:10px;flex-wrap:wrap;';
  ['r','g','b','a'].forEach(ch=>{
    const btn=document.createElement('div'); btn.className='btn'; btn.textContent='存 '+ch.toUpperCase();
    btn.addEventListener('click', ()=>{
      const url = node._rgbaParts && node._rgbaParts[ch];
      if(!url){ toast('通道尚未拆分（等待输入求值）'); return; }
      const a=document.createElement('a');
      a.href=url; a.download='matoga-rgba-'+ch+'.png';
      a.click();
    });
    info.appendChild(btn);
  });
  actions.appendChild(info);
  box.appendChild(actions);
  return box;
}
export function rgbAlphaSplitWidget(node){
  const box = document.createElement('div');
  box.className='w-multi';
  const hint = document.createElement('div');
  hint.style.cssText='font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;';
  hint.textContent='rgb 输出不透明原图颜色（alpha=255），alpha 输出灰度遮罩；两路可接回 RGBA 合并的 rgb 常量与 a 通道';
  box.appendChild(hint);
  const actions = document.createElement('div');
  actions.className='w-tex';
  actions.style.marginTop='4px';
  const info = document.createElement('div'); info.className='info';
  info.style.cssText='display:flex;gap:10px;flex-wrap:wrap;';
  [['rgb','RGB'],['alpha','A']].forEach(([key, label])=>{
    const btn=document.createElement('div'); btn.className='btn'; btn.textContent='存 '+label;
    btn.addEventListener('click', ()=>{
      const url = node._rgbAlphaParts && node._rgbAlphaParts[key];
      if(!url){ toast('通道尚未拆分（等待输入求值）'); return; }
      const a=document.createElement('a');
      a.href=url; a.download='matoga-rgbsplit-'+key+'.png';
      a.click();
    });
    info.appendChild(btn);
  });
  actions.appendChild(info);
  box.appendChild(actions);
  return box;
}
