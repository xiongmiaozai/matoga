/**
 * matoga - 材质贴图对比工具
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 */

// 资产详情与包内贴图两组共用的模块级状态。
// ESM 导入是只读绑定，跨模块共享可变状态统一走访问器（同 gestures.js 的 getPinch/setPinch）。

let _mode = 'node'        // 'node' 节点详情 | 'asset' 资产详情（原资产详情窗口并入）
let _asset = null         // 资产详情数据
let _packTexs = null
let _packBrowse = { dir: null, files: [], filesTotal: 0, loading: false }

export function getMode(){ return _mode }
export function setMode(v){ _mode = v }
export function getAsset(){ return _asset }
export function setAsset(v){ _asset = v }
export function getPackTexs(){ return _packTexs }
export function setPackTexs(v){ _packTexs = v }
export function getPackBrowse(){ return _packBrowse }
export function setPackBrowse(v){ _packBrowse = v }
