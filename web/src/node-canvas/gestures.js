/**
 * matoga - node canvas touch gestures
 * Copyright (c) 2026 芝世 (xiongmiaozai). MIT
 *
 * Multi-pointer tracking (pinch/pan bookkeeping) and the long-press gesture
 * that opens the node or canvas context menu on touch devices.
 *
 * Context-menu builders are injected by the editor via `setGestureHooks`.
 */

import { state } from './state.js'

let _hooks = {
  showNodeMenu: () => {},
  showCanvasMenu: () => {},
}

/** Inject editor callbacks. */
export function setGestureHooks(hooks) { _hooks = Object.assign(_hooks, hooks) }

const showNodeMenu = (...a) => _hooks.showNodeMenu(...a)
const showCanvasMenu = (...a) => _hooks.showCanvasMenu(...a)

export const pointers = new Map();
let pinch = null;

/**
 * Current pinch bookkeeping ({ dist0, zoom0, vx0, vy0 }) or null.
 * Exposed as a getter so callers read the live value; writes go through
 * `setPinch` because ESM import bindings are read-only.
 */
export function getPinch() { return pinch }
/** Replace the pinch bookkeeping object (null to end the gesture). */
export function setPinch(v) { pinch = v }

let longPressTimer = null;
let longPressStart = null;
export function clearLongPress(){ if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; } }
export function startLongPress(e){
  if(e.pointerType!=='touch') return;
  longPressStart={x:e.clientX, y:e.clientY, target:e.target};
  longPressTimer=setTimeout(()=>{
    longPressTimer=null;
    if(state.dragging) return;
    const nodeEl=longPressStart.target.closest('.node');
    const fe={clientX:longPressStart.x, clientY:longPressStart.y, preventDefault(){}};
    if(nodeEl) showNodeMenu(fe, nodeEl.dataset.id);
    else showCanvasMenu(fe);
  }, 500);
}
export function checkLongPressMove(e){
  if(!longPressTimer||!longPressStart) return;
  if(Math.hypot(e.clientX-longPressStart.x, e.clientY-longPressStart.y)>10) clearLongPress();
}
