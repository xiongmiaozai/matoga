/**
 * matoga - 目录树选择器：弹窗骨架
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 folder-tree.js 原样搬出，逻辑未改。面板的静态 HTML 骨架，仅标题需要 i18n。
 */

/**
 * 返回目录选择弹窗的面板 HTML。
 * @param {(k: string) => string} t i18n 取词
 * @returns {string}
 */
export function panelHtml(t) {
  return `
        <div class="mft-panel">
          <div class="mft-head">${t('title')}</div>
          <div class="mft-crumb"></div>
          <div class="mft-quick"></div>
          <div class="mft-pathrow">
            <input type="text" class="input-text mft-path" spellcheck="false" />
            <button class="btn btn-ghost btn-sm mft-home"></button>
            <button class="btn btn-ghost btn-sm mft-up"></button>
            <button class="btn btn-ghost btn-sm mft-new"></button>
            <button class="btn btn-ghost btn-sm mft-addfav"></button>
          </div>
          <div class="mft-searchrow">
            <input type="text" class="input-text mft-filter" spellcheck="false" />
            <input type="text" class="input-text mft-search" spellcheck="false" />
          </div>
          <div class="mft-list"></div>
          <div class="mft-foot">
            <button class="btn btn-ghost btn-sm mft-cancel"></button>
            <button class="btn btn-primary btn-sm mft-select"></button>
          </div>
        </div>`
}
