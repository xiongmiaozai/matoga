/**
 * matoga - 节点关系窗口
 * 以父子层级树（树状图）呈现节点画布中的节点关系：
 *   - 默认「数据流」方向：源节点为父，下游消费节点为子
 *   - 可切换「构成」方向：输出节点为父，上游提供节点为子
 * DAG 中的共享子节点以「引用」节点表示（虚线），避免重复展开。
 */

import { getGraphInfo, focusNodeInCanvas } from './node-canvas.js'
import { t, onLocaleChange } from './i18n.js'


import { S } from './nrel/state.js'
import { actCollapseAll, actExpandAll, actFit, actToggleDir } from './nrel/actions.js'
import { bindInteractions, fitView } from './nrel/interact.js'
import { render } from './nrel/render.js'
import { viewEl } from './nrel/consts.js'

/* 父子森林构建与布局：原文件即以此方式对外暴露（测试与关系树渲染依赖）。 */
export { buildForest } from './nrel/forest.js'
export { layoutForest } from './nrel/layout.js'

export function initNodeRel(){
  if (S.initialized) return
  S.initialized = true

  const dirBtn = document.getElementById('nrDirBtn')
  const expandBtn = document.getElementById('nrExpandBtn')
  const collapseBtn = document.getElementById('nrCollapseBtn')
  const fitBtn = document.getElementById('nrFitBtn')
  if (dirBtn) dirBtn.addEventListener('click', actToggleDir)
  if (expandBtn) expandBtn.addEventListener('click', actExpandAll)
  if (collapseBtn) collapseBtn.addEventListener('click', actCollapseAll)
  if (fitBtn) fitBtn.addEventListener('click', actFit)

  bindInteractions()
  render()
  requestAnimationFrame(() => fitView())

  // 画布结构变化 → 防抖刷新
  document.addEventListener('nodegraph:changed', () => {
    clearTimeout(S.refreshTimer)
    S.refreshTimer = setTimeout(() => {
      render()
    }, 160)
  })

  // 语言切换 → 状态栏重渲染
  onLocaleChange(() => {
    render()
  })

  // 面板尺寸变化（首次进入布局 / 窗口缩放）→ 自适应
  if (window.ResizeObserver){
    const box = viewEl()
    if (box) {
      let first = true
      const ro = new ResizeObserver(() => {
        if (first) { first = false; fitView() }
      })
      ro.observe(box)
    }
  }
}
