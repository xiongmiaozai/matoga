/**
 * matoga - 自定义模型：内置模型模板
 * Copyright (c) 2026 芝世 (xiongmiaozai). All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * 从 custom-model-service.js 搬出，逻辑未改。
 */

const { cubeAllEl, cubeEl, columnEl, columnHEl, slabEl, plateEl, buttonEl, postEl, slabElHalf, stairsEls, crossEls, railEl, torchEl } = require('./geometry')

/* ── 模板库：每个模板 generate(name, ns) 返回自包含 MC 模型 JSON ── */
/* 坐标 / UV 均为 0-16 像素空间；textures 引用 ns:block/<name> 约定 */
const TEMPLATES = [
  {
    id: 'cube_all', name: 'cube_all', category: 'block',
    description: '六面同贴图方块',
    generate: (n, ns) => ({
      textures: { all: `${ns}:block/${n}` },
      elements: [cubeAllEl('#all')],
    }),
  },
  {
    id: 'cube', name: 'cube', category: 'block',
    description: '标准方块（各面独立贴图）',
    generate: (n, ns) => ({
      textures: {
        particle: `${ns}:block/${n}`,
        north: `${ns}:block/${n}_front`, south: `${ns}:block/${n}_back`,
        east: `${ns}:block/${n}_side`, west: `${ns}:block/${n}_side`,
        up: `${ns}:block/${n}_top`, down: `${ns}:block/${n}_bottom`,
      },
      elements: [cubeEl()],
    }),
  },
  {
    id: 'cube_column', name: 'cube_column', category: 'block',
    description: '柱体（顶底 + 侧面）',
    generate: (n, ns) => ({
      textures: { end: `${ns}:block/${n}_top`, side: `${ns}:block/${n}_side` },
      elements: [columnEl('#end', '#side')],
    }),
  },
  {
    id: 'cube_column_horizontal', name: 'cube_column_horizontal', category: 'block',
    description: '水平柱体（两端 + 侧面）',
    generate: (n, ns) => ({
      textures: { end: `${ns}:block/${n}_top`, side: `${ns}:block/${n}_side` },
      elements: [columnHEl('#end', '#side')],
    }),
  },
  {
    id: 'carpet', name: 'carpet', category: 'block',
    description: '地毯（薄层）',
    generate: (n, ns) => ({
      textures: { wool: `${ns}:block/${n}` },
      elements: [slabEl('#wool', 0, 1)],
    }),
  },
  {
    id: 'pressure_plate', name: 'pressure_plate', category: 'block',
    description: '压力板',
    generate: (n, ns) => ({
      textures: { plate: `${ns}:block/${n}` },
      elements: [plateEl('#plate')],
    }),
  },
  {
    id: 'button', name: 'button', category: 'block',
    description: '按钮（贴墙）',
    generate: (n, ns) => ({
      textures: { texture: `${ns}:block/${n}` },
      elements: [buttonEl('#texture')],
    }),
  },
  {
    id: 'fence_post', name: 'fence_post', category: 'block',
    description: '栅栏柱',
    generate: (n, ns) => ({
      textures: { texture: `${ns}:block/${n}_side` },
      elements: [postEl('#texture')],
    }),
  },
  {
    id: 'slab', name: 'slab', category: 'block',
    description: '台阶（下半）',
    generate: (n, ns) => ({
      textures: { top: `${ns}:block/${n}_top`, side: `${ns}:block/${n}_side` },
      elements: [slabElHalf('#top', '#side')],
    }),
  },
  {
    id: 'stairs', name: 'stairs', category: 'block',
    description: '楼梯',
    generate: (n, ns) => ({
      textures: { top: `${ns}:block/${n}_top`, side: `${ns}:block/${n}_side` },
      elements: stairsEls('#top', '#side'),
    }),
  },
  {
    id: 'cross', name: 'cross', category: 'block',
    description: '植物交叉（两片旋转面）',
    generate: (n, ns) => ({
      textures: { cross: `${ns}:block/${n}` },
      elements: crossEls('#cross'),
    }),
  },
  {
    id: 'rail_flat', name: 'rail_flat', category: 'block',
    description: '平坦铁轨',
    generate: (n, ns) => ({
      textures: { rail: `${ns}:block/${n}` },
      elements: [railEl('#rail')],
    }),
  },
  {
    id: 'torch', name: 'torch', category: 'block',
    description: '火把（直立小柱）',
    generate: (n, ns) => ({
      textures: { torch: `${ns}:block/${n}` },
      elements: [torchEl('#torch')],
    }),
  },
  {
    id: 'item_generated', name: 'item/generated', category: 'item',
    description: '物品平面图标（generated）',
    generate: (n, ns) => ({
      parent: 'minecraft:item/generated',
      textures: { layer0: `${ns}:item/${n}` },
    }),
  },
  {
    id: 'item_handheld', name: 'item/handheld', category: 'item',
    description: '手持物品图标',
    generate: (n, ns) => ({
      parent: 'minecraft:item/handheld',
      textures: { layer0: `${ns}:item/${n}` },
    }),
  },
]

/* ── 几何辅助：生成 MC elements（0-16 空间） ── */

module.exports = { TEMPLATES }
