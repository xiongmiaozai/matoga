/**
 * matoga - 工作区模块状态
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 workspace.js 抽出（状态集中，避免各子模块 import 主文件）。
 */

/** 调后端 HTTP（window.matogaCore.call 的薄包装） */
export const call = (m, p, b) => window.matogaCore.call(m, p, b)

/* Golden-Layout 实例与容器 */
export let layout = null
export let layoutRoot = null
export let barEl = null
export let panelEls = null
export let cloneObservers = null

/* 预设 */
export let activePreset = null
export let userPresets = {}
export let saveTimer = null

/* GL 就绪 / 自动保存抑制 */
export let glReady = false
export let suppressAutoSave = false

/* 面板 ID 集合 / 面板归属原位置 */
export let ALL_PANEL_IDS = new Set()
export let panelHomes = null

export function setLayout(v) { layout = v }
export function setLayoutRoot(v) { layoutRoot = v }
export function setBarEl(v) { barEl = v }
export function setPanelEls(v) { panelEls = v }
export function setCloneObservers(v) { cloneObservers = v }
export function setActivePreset(v) { activePreset = v }
export function setUserPresets(v) { userPresets = v }
export function setSaveTimer(v) { saveTimer = v }
export function setGlReady(v) { glReady = v }
export function setSuppressAutoSave(v) { suppressAutoSave = v }
export function setAllPanelIds(v) { ALL_PANEL_IDS = v }
export function setPanelHomes(v) { panelHomes = v }
