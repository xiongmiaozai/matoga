/**
 * matoga - 自定义模型：几何元素构造
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 custom-model-service.js 搬出，逻辑未改。
 */


/* ── 几何辅助：生成 MC elements（0-16 空间） ── */
function face(uv, tex) { return { uv, texture: tex } }
const FULL = [0, 0, 16, 16]

function cubeAllEl(tex) {
  return {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: {
      north: face(FULL, tex), south: face(FULL, tex),
      east: face(FULL, tex), west: face(FULL, tex),
      up: face(FULL, tex), down: face(FULL, tex),
    },
  }
}
function cubeEl() {
  return {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: {
      north: face(FULL, '#north'), south: face(FULL, '#south'),
      east: face(FULL, '#east'), west: face(FULL, '#west'),
      up: face(FULL, '#up'), down: face(FULL, '#down'),
    },
  }
}
function columnEl(end, side) {
  return {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: {
      north: face(FULL, side), south: face(FULL, side),
      east: face(FULL, side), west: face(FULL, side),
      up: face(FULL, end), down: face(FULL, end),
    },
  }
}
function columnHEl(end, side) {
  return {
    from: [0, 0, 0], to: [16, 16, 16],
    faces: {
      north: face(FULL, end), south: face(FULL, end),
      east: face(FULL, side), west: face(FULL, side),
      up: face(FULL, side), down: face(FULL, side),
    },
  }
}
function slabEl(tex, y0, y1) {
  return {
    from: [0, y0, 0], to: [16, y1, 16],
    faces: {
      north: face(FULL, tex), south: face(FULL, tex),
      east: face(FULL, tex), west: face(FULL, tex),
      up: face(FULL, tex), down: face(FULL, tex),
    },
  }
}
function plateEl(tex) {
  return {
    from: [1, 0, 1], to: [15, 1, 15],
    faces: {
      north: face([1, 15, 15, 1], tex), south: face([1, 15, 15, 1], tex),
      east: face([1, 15, 15, 1], tex), west: face([1, 15, 15, 1], tex),
      up: face([1, 1, 15, 15], tex), down: face([1, 1, 15, 15], tex),
    },
  }
}
function buttonEl(tex) {
  return {
    from: [5, 0, 4], to: [11, 2, 12],
    faces: {
      north: face([5, 14, 11, 12], tex), south: face([5, 14, 11, 12], tex),
      east: face([4, 14, 12, 12], tex), west: face([4, 14, 12, 12], tex),
      up: face([5, 4, 11, 12], tex), down: face([5, 4, 11, 12], tex),
    },
  }
}
function postEl(tex) {
  return {
    from: [6, 0, 6], to: [10, 16, 10],
    faces: {
      north: face([6, 0, 10, 16], tex), south: face([6, 0, 10, 16], tex),
      east: face([6, 0, 10, 16], tex), west: face([6, 0, 10, 16], tex),
      up: face([6, 6, 10, 10], tex), down: face([6, 6, 10, 10], tex),
    },
  }
}
function slabElHalf(top, side) {
  return {
    from: [0, 0, 0], to: [16, 8, 16],
    faces: {
      north: face([0, 8, 16, 16], side), south: face([0, 8, 16, 16], side),
      east: face([0, 8, 16, 16], side), west: face([0, 8, 16, 16], side),
      up: face(FULL, top), down: face(FULL, top),
    },
  }
}
function stairsEls(top, side) {
  return [
    {
      from: [0, 0, 0], to: [16, 8, 16],
      faces: {
        north: face([0, 8, 16, 16], side), south: face([0, 8, 16, 16], side),
        east: face([0, 8, 16, 16], side), west: face([0, 8, 16, 16], side),
        up: face(FULL, top), down: face(FULL, top),
      },
    },
    {
      from: [0, 8, 0], to: [16, 16, 8],
      faces: {
        north: face([0, 0, 16, 8], side), south: face([0, 0, 16, 8], side),
        east: face([0, 0, 8, 8], side), west: face([0, 0, 8, 8], side),
        up: face([0, 0, 16, 8], top), down: face([0, 0, 16, 8], top),
      },
    },
  ]
}
function crossEls(tex) {
  const f = { north: face(FULL, tex), south: face(FULL, tex) }
  return [
    { from: [0, 0, 8], to: [16, 16, 8], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 }, faces: f },
    { from: [0, 0, 8], to: [16, 16, 8], rotation: { origin: [8, 8, 8], axis: 'y', angle: -45 }, faces: f },
  ]
}
function railEl(tex) {
  return {
    from: [0, 0, 0], to: [16, 1, 16],
    faces: { up: face(FULL, tex), down: face(FULL, tex) },
  }
}
function torchEl(tex) {
  return {
    from: [6, 0, 6], to: [10, 16, 10],
    faces: {
      north: face([6, 0, 10, 16], tex), south: face([6, 0, 10, 16], tex),
      east: face([6, 0, 10, 16], tex), west: face([6, 0, 10, 16], tex),
      up: face([6, 6, 10, 10], tex), down: face([6, 6, 10, 10], tex),
    },
  }
}

module.exports = { face, FULL, cubeAllEl, cubeEl, columnEl, columnHEl, slabEl, plateEl, buttonEl, postEl, slabElHalf, stairsEls, crossEls, railEl, torchEl }
