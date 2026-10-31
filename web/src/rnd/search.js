/**
 * matoga - MC 模型：RenderSearch
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 mc-model-viewer.js 按领域搬出（正文逐字未改）。
 * 职责：结果搜索框绑定与中文名解析
 */

import { zhOfTexPath, zhOfTexName } from '../zh-names.js'
import { filterByResultSearch } from '../result-search.js'
import { state, $ } from '../core.js'
import { saveOptions } from '../actions.js'

/* 主文件函数（注入） */
let _renderResult = (...a) => undefined

/* 模块状态：只读用 getter；可写用 get/set 成对（§2.2） */
let _get__searchFieldCache = () => undefined

export function setHooks(h) {
  if (h.renderResult) _renderResult = h.renderResult
  if (h.get__searchFieldCache) _get__searchFieldCache = h.get__searchFieldCache
}

export function zhOfKey(key) {
  if (!key) return ''
  const z = zhOfTexPath(key) || zhOfTexPath(key + '.png')
  if (z) return z
  const base = String(key)
    .split('/')
    .pop()
    .replace(/\.png$/i, '')
  return zhOfTexName(base)
}

export function applyResultSearch(arr) {
  return filterByResultSearch(arr, state.resultSearchTerm, _get__searchFieldCache())
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
      _renderResult()
    }, 180)
  })
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && input.value) {
      input.value = ''
      state.resultSearchTerm = ''
      state.renderLimit = 200
      saveOptions()
      _renderResult()
    }
  })
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = ''
      state.resultSearchTerm = ''
      state.renderLimit = 200
      saveOptions()
      _renderResult()
    })
  }
}
