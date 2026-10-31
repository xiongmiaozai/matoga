/**
 * matoga - 首页引导：节点面板开关
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 index.html 的内联 <script type="module"> 抽出，逻辑未改。
 * 抽成外链 module 而非经典 script：原代码用了顶层 await 与 import。
 */

const btn = document.getElementById('nodePanelBtn')
const closeBtn = document.getElementById('nodeWindowClose')
if (btn) {
  btn.addEventListener('click', () => {
    document.body.classList.add('node-mode')
    btn.classList.add('active')
  })
}
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    document.body.classList.remove('node-mode')
    if (btn) btn.classList.remove('active')
  })
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('node-mode')) {
    document.body.classList.remove('node-mode')
    if (btn) btn.classList.remove('active')
  }
})
