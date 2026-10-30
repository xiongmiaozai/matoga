/**
 * matoga - 目录树选择器：样式表
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 folder-tree.js 原样搬出，逻辑未改。弹窗样式，首次打开时注入 <style>。
 */

export const CSS = `
  .mft-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 9998; display: none; align-items: center; justify-content: center; }
  .mft-mask.show { display: flex; }
  .mft-panel { background: var(--panel-bg, #fff); color: var(--text, #18243A); border: 1px solid var(--border, #E5E7EB); border-radius: 12px; width: 600px; max-width: 92vw; max-height: 82vh; display: flex; flex-direction: column; box-shadow: 0 18px 50px rgba(0,0,0,.25); overflow: hidden; }
  .mft-head { padding: 14px 18px; border-bottom: 1px solid var(--border-soft, #EFF1F4); font-weight: 600; font-size: 14px; }
  .mft-crumb { padding: 6px 18px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 12px; color: var(--text-muted, #8A92A6); border-bottom: 1px solid var(--border-soft, #EFF1F4); }
  .mft-cseg { cursor: pointer; padding: 2px 6px; border-radius: 4px; }
  .mft-cseg:hover { background: var(--primary-soft, #E8F0FE); color: var(--primary, #0A59F7); }
  .mft-csep { opacity: .5; }
  .mft-ccur { color: var(--text, #18243A); font-weight: 600; cursor: default; }
  .mft-ccur:hover { background: none; color: var(--text, #18243A); }
  .mft-quick { padding: 6px 18px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border-bottom: 1px solid var(--border-soft, #EFF1F4); max-height: 66px; overflow: auto; }
  .mft-quick:empty { display: none; }
  .mft-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; font-size: 12px; cursor: pointer; background: var(--primary-soft, #E8F0FE); color: var(--primary, #0A59F7); border: 1px solid transparent; max-width: 220px; }
  .mft-chip:hover { border-color: var(--primary, #0A59F7); }
  .mft-chip .mft-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mft-chip .mft-x { opacity: .6; padding: 0 4px; border-radius: 50%; }
  .mft-chip .mft-x:hover { opacity: 1; background: rgba(0,0,0,.12); }
  .mft-chip.rec { background: var(--border-soft, #EFF1F4); color: var(--text-muted, #8A92A6); }
  .mft-chiplabel { font-size: 11px; color: var(--text-muted, #8A92A6); margin-right: 2px; }
  .mft-pathrow { padding: 10px 18px 0; display: flex; gap: 8px; flex-wrap: wrap; }
  .mft-pathrow input { flex: 1; min-width: 120px; }
  .mft-searchrow { padding: 8px 18px 0; display: flex; gap: 8px; }
  .mft-searchrow input { flex: 1; }
  .mft-list { flex: 1; overflow: auto; margin: 10px 18px; border: 1px solid var(--border-soft, #EFF1F4); border-radius: 8px; min-height: 220px; position: relative; }
  .mft-item { padding: 7px 12px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-soft, #EFF1F4); user-select: none; }
  .mft-item:hover { background: var(--primary-soft, #E8F0FE); }
  .mft-item.active { background: var(--primary-soft, #E8F0FE); outline: 2px solid var(--primary, #0A59F7); outline-offset: -2px; }
  .mft-item.current { background: var(--primary-soft, #E8F0FE); font-weight: 600; }
  .mft-item svg { width: 15px; height: 15px; flex: none; color: var(--primary, #0A59F7); }
  .mft-item .mft-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mft-empty { padding: 24px; text-align: center; color: var(--text-muted, #8A92A6); font-size: 12px; }
  .mft-newrow { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border-soft, #EFF1F4); background: var(--primary-soft, #E8F0FE); }
  .mft-newrow input { flex: 1; }
  .mft-srhead { padding: 6px 12px; font-size: 11px; color: var(--text-muted, #8A92A6); background: var(--border-soft, #EFF1F4); display: flex; justify-content: space-between; align-items: center; }
  .mft-srhead .mft-clear { cursor: pointer; color: var(--primary, #0A59F7); }
  .mft-foot { padding: 12px 18px; border-top: 1px solid var(--border-soft, #EFF1F4); display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
  .mft-ctx { position: fixed; z-index: 9999; background: var(--panel-bg, #fff); border: 1px solid var(--border, #E5E7EB); border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,.18); padding: 4px 0; min-width: 130px; display: none; }
  .mft-ctx.show { display: block; }
  .mft-ctx-item { display: block; width: 100%; padding: 6px 14px; background: none; border: 0; text-align: left; cursor: pointer; font-size: 13px; color: var(--text, #18243A); }
  .mft-ctx-item:hover { background: var(--primary-soft, #E8F0FE); color: var(--primary, #0A59F7); }
`
