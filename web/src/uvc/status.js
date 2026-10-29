/**
 * matoga - UV 编辑器状态栏文本
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 uv-editor-core.js 的 updateStatus() 中抽出文本组装部分，逻辑未改。
 */

import { fmtUvNum } from './utils.js'
import { t } from '../i18n.js'

/**
 * 组装状态栏文本。
 * @param {object} p
 * @param {object} p.t           i18n 函数
 * @param {object} p.layout      当前 layout
 * @param {number} p.activeTex   当前贴图槽位
 * @param {string|null} p.notice 临时提示（优先显示）
 * @param {boolean} p.isCustom   当前贴图是否被自定义替换
 * @param {object|null} p.drag   拖拽态 { rc: { elIdx, key, face, moved } }
 * @param {object|null} p.hover  悬停态 { el, key, face }
 * @param {object|null} p.selected 选中态 { el, key, elIdx, face }
 * @param {boolean} p.edit       是否编辑模式
 * @param {object|null} p.rec    imgCache 记录 { ok, done, img }
 * @param {object|null} p.animInfo { frames }
 * @returns {string}
 */
export function buildStatusText({
  t, layout, activeTex, notice, isCustom, drag, hover, selected, edit, rec, animInfo,
}) {
  if (!layout) return notice || ''
  const tex = layout.textures[activeTex]
  if (!tex) return notice || ''
  if (notice) return notice

  let faceCount = 0
  layout.elements.forEach(el => {
    for (const key in el.faces) if (el.faces[key].tex === activeTex) faceCount++
  })

  const failed = rec && rec.done && !rec.ok
  const sizeStr = rec && rec.ok && rec.img ? `${rec.img.naturalWidth}×${rec.img.naturalHeight}` : ''
  const animStr = animInfo ? ` · ${t('uv.animFrames', { n: animInfo.frames })}` : ''
  const removedStr = !tex.url ? ` · ${t('uv.removed')}` : ''
  const customStr = (!tex.url || !isCustom) ? '' : ` · ${t('uv.custom')}`
  let text = (tex.name || '') + (sizeStr ? ` · ${sizeStr}` : '') + animStr + customStr + removedStr +
    (failed ? ` · ${t('uv.missing')}` : '') + ` · ${t('uv.faces', { n: faceCount })}`

  if (drag && drag.moved) {
    const f = drag.rc.face
    text += '  ·  ' + `${t('uv.el')} ${drag.rc.elIdx} ${drag.rc.key} · uv [${f.uv.map(fmtUvNum).join(', ')}]`
  } else if (hover) {
    const f = hover.face
    const parts = [`${t('uv.el')} ${layout.elements.indexOf(hover.el)}`, hover.key]
    if (f.rotation) parts.push(`${t('uv.rot')} ${f.rotation}°`)
    if (f.mirror) parts.push(t('uv.mirror'))
    text += '  ·  ' + parts.join(' · ')
  } else if (edit && selected) {
    const f = selected.face
    text += '  ·  ' + `${t('uv.el')} ${selected.elIdx} ${selected.key} · uv [${f.uv.map(fmtUvNum).join(', ')}]`
  }
  return text
}
