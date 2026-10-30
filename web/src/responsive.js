/**
 * matoga - 自适应工具模块
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 设备检测、断点管理、布局自适应切换。
 * 提供 ResponsiveManager 单例，监听窗口尺寸变化并分发事件。
 */

const BREAKPOINTS = {
  xs: 480,
  sm: 768,
  md: 1024,
  lg: 1280,
  xl: 1600,
  xxl: 1920
}

const BREAKPOINT_LABELS = {
  xs: '极小屏',
  sm: '小屏',
  md: '中屏',
  lg: '标准屏',
  xl: '宽屏',
  xxl: '超宽屏'
}

function detectTouch() {
  if (typeof window === 'undefined') return false
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints > 0 && navigator.maxTouchPoints !== undefined)
  )
}

function detectDPR() {
  if (typeof window === 'undefined') return 1
  return window.devicePixelRatio || 1
}

function detectOrientation() {
  if (typeof window === 'undefined') return 'landscape'
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
}

function getBreakpoint(width) {
  if (width < BREAKPOINTS.xs) return 'xs'
  if (width < BREAKPOINTS.sm) return 'sm'
  if (width < BREAKPOINTS.md) return 'md'
  if (width < BREAKPOINTS.lg) return 'lg'
  if (width < BREAKPOINTS.xl) return 'xl'
  if (width < BREAKPOINTS.xxl) return 'xxl'
  return 'xxl'
}

function getCompactMode(breakpoint) {
  return breakpoint === 'xs' || breakpoint === 'sm' || breakpoint === 'md'
}

function getSidebarBehavior(breakpoint) {
  if (breakpoint === 'xs' || breakpoint === 'sm') return 'overlay'
  if (breakpoint === 'md') return 'collapsed'
  return 'normal'
}

function getLayoutMode(breakpoint) {
  if (breakpoint === 'xs') return 'single'
  if (breakpoint === 'sm') return 'stacked'
  if (breakpoint === 'md') return 'compact'
  return 'normal'
}

function getRecommendedSidebarWidth(breakpoint, side) {
  const widths = {
    xs: { left: 0, right: 0 },
    sm: { left: 240, right: 280 },
    md: { left: 280, right: 340 },
    lg: { left: 320, right: 400 },
    xl: { left: 360, right: 460 },
    xxl: { left: 400, right: 520 }
  }
  const w = widths[breakpoint] || widths.lg
  return side === 'left' ? w.left : w.right
}

class ResponsiveManager {
  constructor() {
    this._width = 0
    this._height = 0
    this._breakpoint = 'lg'
    this._prevBreakpoint = 'lg'
    this._dpr = 1
    this._touch = false
    this._orientation = 'landscape'
    this._listeners = new Set()
    this._resizeTimer = null
    this._initialized = false
  }

  init() {
    if (this._initialized) return
    this._initialized = true
    this._update()
    window.addEventListener('resize', this._onResize.bind(this), { passive: true })
    window.addEventListener('orientationchange', this._onOrientationChange.bind(this), { passive: true })
    if (window.matchMedia) {
      const mq = window.matchMedia('(pointer: coarse)')
      mq.addEventListener?.('change', this._onPointerChange.bind(this))
    }
  }

  _update() {
    this._width = window.innerWidth
    this._height = window.innerHeight
    this._prevBreakpoint = this._breakpoint
    this._breakpoint = getBreakpoint(this._width)
    this._dpr = detectDPR()
    this._touch = detectTouch()
    this._orientation = detectOrientation()
  }

  _onResize() {
    if (this._resizeTimer) clearTimeout(this._resizeTimer)
    this._resizeTimer = setTimeout(() => {
      const prev = this._breakpoint
      this._update()
      if (prev !== this._breakpoint) {
        this._dispatch('breakpoint-change', {
          from: prev,
          to: this._breakpoint,
          width: this._width,
          height: this._height
        })
      }
      this._dispatch('resize', {
        width: this._width,
        height: this._height,
        breakpoint: this._breakpoint
      })
    }, 100)
  }

  _onOrientationChange() {
    this._update()
    this._dispatch('orientation-change', {
      orientation: this._orientation,
      width: this._width,
      height: this._height
    })
  }

  _onPointerChange(e) {
    this._touch = e.matches
    this._dispatch('pointer-change', { touch: this._touch })
  }

  _dispatch(type, detail) {
    const event = new CustomEvent('responsive:' + type, { detail })
    window.dispatchEvent(event)
    for (const fn of this._listeners) {
      try {
        fn(type, detail)
      } catch (err) {
        console.error('[responsive] listener error', err)
      }
    }
  }

  onChange(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  get width() { return this._width }
  get height() { return this._height }
  get breakpoint() { return this._breakpoint }
  get prevBreakpoint() { return this._prevBreakpoint }
  get dpr() { return this._dpr }
  get touch() { return this._touch }
  get orientation() { return this._orientation }
  get compact() { return getCompactMode(this._breakpoint) }
  get sidebarBehavior() { return getSidebarBehavior(this._breakpoint) }
  get layoutMode() { return getLayoutMode(this._breakpoint) }

  getSidebarWidth(side) {
    return getRecommendedSidebarWidth(this._breakpoint, side)
  }

  getBreakpointLabel() {
    return BREAKPOINT_LABELS[this._breakpoint] || '未知'
  }

  shouldAutoCollapseSidebar() {
    return this._breakpoint === 'xs' || this._breakpoint === 'sm' || this._breakpoint === 'md'
  }

  shouldStackPanels() {
    return this._breakpoint === 'xs' || this._breakpoint === 'sm'
  }

  shouldHideResizers() {
    return this._breakpoint === 'xs' || this._breakpoint === 'sm'
  }

  shouldUseCompactHeader() {
    return this._breakpoint === 'xs' || this._breakpoint === 'sm'
  }

  shouldScaleFont() {
    return this._breakpoint === 'xs' || this._breakpoint === 'sm'
  }

  applyBodyClasses() {
    const classes = [
      'bp-' + this._breakpoint,
      'layout-' + this.layoutMode,
      this.compact ? 'compact-mode' : '',
      this.touch ? 'touch-device' : 'mouse-device',
      'orient-' + this._orientation,
      'dpr-' + (this._dpr >= 2 ? 'high' : this._dpr >= 1.5 ? 'mid' : 'std')
    ].filter(Boolean)
    const removePattern = /\b(bp-\w+|layout-\w+|compact-mode|touch-device|mouse-device|orient-\w+|dpr-\w+)\b/g
    document.body.className = document.body.className.replace(removePattern, '').trim()
    for (const cls of classes) {
      if (!document.body.classList.contains(cls)) {
        document.body.classList.add(cls)
      }
    }
  }
}

const responsive = new ResponsiveManager()

export {
  responsive,
  ResponsiveManager,
  BREAKPOINTS,
  BREAKPOINT_LABELS,
  detectTouch,
  detectDPR,
  detectOrientation,
  getBreakpoint,
  getCompactMode,
  getSidebarBehavior,
  getLayoutMode,
  getRecommendedSidebarWidth
}