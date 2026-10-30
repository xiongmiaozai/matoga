/**
 * matoga - 节点编辑器：主题注入
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 node-editor.html 的内联 <script> 抽出，逻辑未改。
 * 使用经典 script（非 module）：需在主应用模块加载前同步注册 message 监听。
 */

window.addEventListener('message', function(e){
  if(!e.data||e.data.type!=='matoga-theme')return;
  try{
    var s=document.getElementById('theme-vars');
    if(!s){s=document.createElement('style');s.id='theme-vars';document.head.appendChild(s);}
    var tk=e.data.tokens||{};var keys=Object.keys(tk);var md=e.data.mode||'light';
    s.textContent=keys.length?(':root[data-theme="'+md+'"]{'+keys.map(function(k){return k+':'+tk[k]}).join(';')+'}'):'';
    document.documentElement.setAttribute('data-theme',md);
  }catch(err){}
});
