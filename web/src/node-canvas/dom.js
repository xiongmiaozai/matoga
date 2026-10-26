/* DOM 与 SVG 命名空间的小工具。
   原 node-canvas.js 顶部两个 const，抽出来供各子模块共用。 */

export const $ = (s) => document.querySelector(s);
export const NS = 'http://www.w3.org/2000/svg';
