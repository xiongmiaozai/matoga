/**
 * matoga - 节点画布属性控件：生成器控件
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 widgets.js 按职责搬出，逻辑未改。
 */
import { _labeledRow, colorWidget, numWidget, selectWidget } from './basic.js'

export function noiseWidget(node){
  if(node.props.gain===undefined) node.props.gain=0.5;
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.1,20,0.1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  box.appendChild(_labeledRow('层数', numWidget(node,'octaves',1,8,1)));
  box.appendChild(_labeledRow('增益', numWidget(node,'gain',0.4,0.95,0.05)));
  return box;
}
export function voronoiWidget(node){
  if(node.props.mode===undefined) node.props.mode='f1';
  if(node.props.jitter===undefined) node.props.jitter=1;
  if(node.props.smooth===undefined) node.props.smooth=0.5;
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.1,20,0.1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  box.appendChild(_labeledRow('模式', selectWidget(node,'mode',['f1','f2','f2-f1','smooth'])));
  box.appendChild(_labeledRow('抖动', numWidget(node,'jitter',0,1,0.05)));
  box.appendChild(_labeledRow('平滑', numWidget(node,'smooth',0,1,0.05)));
  return box;
}
export function whiteWidget(node){
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('密度', numWidget(node,'scale',1,256,1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  return box;
}
export function cellWidget(node){
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.5,32,0.5)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  return box;
}
export function pingpongWidget(node){
  if(node.props.gain===undefined) node.props.gain=0.5;
  if(node.props.strength===undefined) node.props.strength=2;
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.1,20,0.1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  box.appendChild(_labeledRow('层数', numWidget(node,'octaves',1,8,1)));
  box.appendChild(_labeledRow('增益', numWidget(node,'gain',0.4,0.95,0.05)));
  box.appendChild(_labeledRow('强度', numWidget(node,'strength',0.5,8,0.1)));
  return box;
}
export function voronoiseWidget(node){
  if(node.props.jitter===undefined) node.props.jitter=1;
  if(node.props.blend===undefined) node.props.blend=0.5;
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.1,20,0.1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  box.appendChild(_labeledRow('抖动', numWidget(node,'jitter',0,1,0.05)));
  box.appendChild(_labeledRow('插值', numWidget(node,'blend',0,1,0.05)));
  return box;
}
export function reactionWidget(node){
  if(node.props.iterations===undefined) node.props.iterations=120;
  if(node.props.preset===undefined) node.props.preset='coral';
  const box=document.createElement('div');
  box.className='w-multi';
  const hint=document.createElement('div');
  hint.style.cssText='font-size:10px;color:var(--text-dim);margin-bottom:4px;line-height:1.4;';
  hint.textContent='Gray-Scott 反应扩散：迭代涌现斑纹（珊瑚/迷宫/孤子）';
  box.appendChild(hint);
  box.appendChild(_labeledRow('形态', selectWidget(node,'preset',['coral','maze','soliton','waves','worm'])));
  box.appendChild(_labeledRow('迭代', numWidget(node,'iterations',40,300,10)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  return box;
}
export function lightningWidget(node){
  if(node.props.branches===undefined) node.props.branches=0.7;
  if(node.props.detail===undefined) node.props.detail=1;
  if(node.props.glow===undefined) node.props.glow=0.5;
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  box.appendChild(_labeledRow('分叉', numWidget(node,'branches',0,1,0.05)));
  box.appendChild(_labeledRow('细节', numWidget(node,'detail',0.2,2,0.1)));
  box.appendChild(_labeledRow('辉光', numWidget(node,'glow',0,1,0.05)));
  return box;
}
export function mandelWidget(node){
  if(node.props.fractal===undefined) node.props.fractal='mandel';
  if(node.props.zoom===undefined) node.props.zoom=1;
  if(node.props.iterations===undefined) node.props.iterations=96;
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('类型', selectWidget(node,'fractal',['mandel','julia'])));
  box.appendChild(_labeledRow('缩放', numWidget(node,'zoom',0.5,64,0.5)));
  box.appendChild(_labeledRow('迭代', numWidget(node,'iterations',32,256,8)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  return box;
}
export function paletteWidget(node){
  if(node.props.freq===undefined) node.props.freq=1;
  if(node.props.phase===undefined) node.props.phase=0;
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('预设', selectWidget(node,'preset',['rainbow','ocean','sunset','ember','fire','verdant'])));
  box.appendChild(_labeledRow('频率', numWidget(node,'freq',0.5,4,0.1)));
  box.appendChild(_labeledRow('相位', numWidget(node,'phase',0,1,0.05)));
  return box;
}
export function gradientWidget(node){
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('A', colorWidget(node,'colorA')));
  box.appendChild(_labeledRow('B', colorWidget(node,'colorB')));
  box.appendChild(_labeledRow('模式', selectWidget(node,'mode',['linear','smooth','ease'])));
  return box;
}
export function warpWidget(node){
  if(node.props.gain===undefined) node.props.gain=0.5;
  const box=document.createElement('div');
  box.className='w-multi';
  box.appendChild(_labeledRow('缩放', numWidget(node,'scale',0.1,20,0.1)));
  box.appendChild(_labeledRow('扭曲', numWidget(node,'amount',0,3,0.1)));
  box.appendChild(_labeledRow('种子', numWidget(node,'seed',0,100,1)));
  box.appendChild(_labeledRow('层数', numWidget(node,'octaves',1,8,1)));
  box.appendChild(_labeledRow('增益', numWidget(node,'gain',0.4,0.95,0.05)));
  return box;
}


