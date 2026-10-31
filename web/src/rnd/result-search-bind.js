/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 render.js L113-L150 原样搬出（正文逐字未改）。
 * 段外本地符号经 setHooks 注入：renderResult
 */

import { state, $ } from '../core.js'
import { saveOptions } from '../actions.js'

/* 以下变量由主模块经 setHooks 注入。正文按裸标识符引用，故模块级声明。 */
let renderResult
export function setHooks(h) {
  renderResult = h.renderResult
}

export function bindResultSearch() {
  const input = $('resultSearch')
  if (!input) return
  if (input.value !== (state.resultSearchTerm || '')) input.value = state.resultSearchTerm || ''
  const clearBtn = $('resultSearchClear')
  if (clearBtn) clearBtn.classList.toggle('is-hidden', !input.value)
  if (input.dataset.bound) return
  input.dataset.bound = '1'
  let timer
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      state.resultSearchTerm = input.value
      state.renderLimit = 200
      saveOptions()
      renderResult()
    }, 180)
  })
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && input.value) {
      input.value = ''
      state.resultSearchTerm = ''
      state.renderLimit = 200
      saveOptions()
      renderResult()
    }
  })
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = ''
      state.resultSearchTerm = ''
      state.renderLimit = 200
      saveOptions()
      renderResult()
    })
  }
}
