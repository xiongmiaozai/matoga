import { initNodePreview } from '../../node-preview.js'

let inited = false
export function init() {
  if (inited) return
  const host = document.getElementById('nodePreviewView')
  if (!host) return
  inited = true
  initNodePreview()
}