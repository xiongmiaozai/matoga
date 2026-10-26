/* ── 初始化示例场景 ───────────────────────────── */
/* 从 node-canvas.js 原样搬出，逻辑未改。 */
import { state } from './state.js'
import { canvasWrap, applyViewport } from './viewport.js'
import { renderNode, createNode } from './nodes.js'
import { renderEdges } from './edges.js'
import { updateStats } from './status.js'
import { evaluate } from './evaluate.js'
import { fitView } from './layout.js'

export function initExample(){
  const r = canvasWrap.getBoundingClientRect();
  state.viewport.x = r.width/2 - 200;
  state.viewport.y = r.height/2 - 100;
  applyViewport();

  const num1 = createNode('number', -380, -120);
  num1.props.value = 0.8;
  const num2 = createNode('number', -380, 60);
  num2.props.value = 0.3;
  const color1 = createNode('color', -380, 220);
  color1.props.color = '#7cbd56';
  const mix = createNode('mix', -100, 0);

  // 重新渲染以应用 props
  [num1,num2,color1,mix].forEach(n=>{ n.el.remove(); renderNode(n); });

  // 连线
  function conn(fn,fp,tn,tp){
    const eid='e'+Math.random().toString(36).slice(2,9);
    state.edges.set(eid,{id:eid,from:{node:fn,port:fp},to:{node:tn,port:tp}});
  }
  conn(num1.id,'value',mix.id,'a');
  conn(num2.id,'value',mix.id,'b');
  conn(num1.id,'value',mix.id,'t');

  renderEdges(); updateStats(); evaluate();
  setTimeout(fitView, 100);
}
