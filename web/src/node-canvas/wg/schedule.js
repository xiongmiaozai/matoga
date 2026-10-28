/**
 * matoga - 节点画布属性控件：求值调度
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 widgets.js 按职责搬出，逻辑未改。
 */
import { S, setWidgetHooks, evaluate, _markDirty, toast } from './state.js'

export function _scheduleEval(){
  if(S.evalScheduled) return;
  S.evalScheduled = true;
  const tick = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (f => setTimeout(f, 0));
  tick(()=>{
    S.evalScheduled = false;
    evaluate();
    _markDirty();
  });
}
