import { initNodeRel } from '../../node-rel.js'

let inited = false
export function init() {
  if (inited) return
  const host = document.getElementById('nodeRelView')
  if (!host) return
  inited = true
  initNodeRel()
}