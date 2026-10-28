/**
 * MC 动画贴图（.png.mcmeta）单测（mc-model-viewer 动画纯逻辑部分）：
 * - parseAnimMeta：帧尺寸 / 帧数 / 时间轴展开
 *   （campfire_fire 8 帧 frametime2 / campfire_log_lit 4 帧 interpolate /
 *    fire_0 自定义 frames 乱序 + {index,time} / width+height 非方形帧 / 非法输入）
 * - animFrameIndexAt：循环时间轴上的帧号（tick 域整边界 / 取模回绕 / 末帧兜底）
 * - applyTexAnimFrame：THREE.Texture repeat / offset（帧 0 = 贴图顶部，末帧 = 底部，越界 clamp）
 * 网络路径（mcmeta fetch / 贴图加载）与 uv-view 集成由浏览器运行时覆盖，此处不涉及。
 * 运行于 NR_M3D_STUB=1（material3d 替换为 no-op，three 从 node_modules 解析）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { register } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '../..')
process.env.NR_M3D_STUB = '1'
register('./helpers/frontend-resolve.mjs', pathToFileURL(__dirname + '/'))

test('setup: 加载 mc-model-viewer 动画函数（material3d stub 模式）', async () => {
  const m = await import('../../web/src/mc-model-viewer.js')
  globalThis.__mcm = m
  assert.equal(typeof m.parseAnimMeta, 'function')
  assert.equal(typeof m.animFrameIndexAt, 'function')
  assert.equal(typeof m.applyTexAnimFrame, 'function')
})

test('parseAnimMeta: campfire_fire 场景（16×128，frametime 2 → 8 帧）', () => {
  const { parseAnimMeta } = globalThis.__mcm
  const anim = parseAnimMeta({ animation: { frametime: 2 } }, 16, 128)
  assert.equal(anim.frameW, 16)
  assert.equal(anim.frameH, 16)
  assert.equal(anim.frameCount, 8)
  assert.equal(anim.timeline.length, 8)
  assert.deepEqual(anim.timeline.map(f => f.index), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.ok(anim.timeline.every(f => f.ticks === 2))
  assert.ok(Math.abs(anim.totalSec - 8 * 2 / 20) < 1e-12)
})

test('parseAnimMeta: campfire_log_lit 场景（16×64，interpolate + frametime 20 → 4 帧）', () => {
  const { parseAnimMeta } = globalThis.__mcm
  const anim = parseAnimMeta({ animation: { interpolate: true, frametime: 20 } }, 16, 64)
  assert.equal(anim.frameCount, 4)
  assert.equal(anim.timeline.length, 4)
  assert.ok(anim.timeline.every(f => f.ticks === 20))
  assert.ok(Math.abs(anim.totalSec - 4) < 1e-12)
})

test('parseAnimMeta: fire_0 场景（16×512，自定义 frames 乱序 + {index,time}）', () => {
  const { parseAnimMeta } = globalThis.__mcm
  const seq = [16, 17, { index: 3, time: 5 }, 0]
  const anim = parseAnimMeta({ animation: { frames: seq } }, 16, 512)
  assert.equal(anim.frameCount, 32)
  assert.equal(anim.timeline.length, 4)
  assert.deepEqual(anim.timeline.map(f => f.index), [16, 17, 3, 0])
  assert.deepEqual(anim.timeline.map(f => f.ticks), [1, 1, 5, 1])
  /* 越界帧号（>= frameCount）剔除，全部无效则回退顺序帧序 */
  const bad = parseAnimMeta({ animation: { frames: [99, -1, 'x'] } }, 16, 64)
  assert.deepEqual(bad.timeline.map(f => f.index), [0, 1, 2, 3])
})

test('parseAnimMeta: 非方形帧（width/height）与非动画输入', () => {
  const { parseAnimMeta } = globalThis.__mcm
  const a = parseAnimMeta({ animation: { width: 32, height: 32 } }, 32, 128)
  assert.equal(a.frameW, 32)
  assert.equal(a.frameH, 32)
  assert.equal(a.frameCount, 4)
  assert.equal(parseAnimMeta(null, 16, 128), null)
  assert.equal(parseAnimMeta({}, 16, 128), null)
  assert.equal(parseAnimMeta('x', 16, 128), null)
  assert.equal(parseAnimMeta({ animation: null }, 16, 128), null)
  assert.equal(parseAnimMeta({ animation: { frametime: 2 } }, 16, 16), null)   /* 单帧无动画 */
  assert.equal(parseAnimMeta({ animation: { frametime: 2 } }, 0, 128), null)   /* 非法尺寸 */
  assert.equal(parseAnimMeta({ animation: { frametime: 2 } }, 16, 0), null)
  assert.equal(parseAnimMeta({ animation: { width: 64 } }, 16, 128), null)     /* 帧宽超贴图宽 */
  assert.equal(parseAnimMeta({ animation: { height: 256 } }, 16, 128), null)   /* 帧高超贴图高 */
})

test('animFrameIndexAt: 循环时间轴帧号（tick 域整边界）', () => {
  const { parseAnimMeta, animFrameIndexAt } = globalThis.__mcm
  const anim = parseAnimMeta({ animation: { frametime: 2 } }, 16, 128)   /* 8 帧 × 0.1s */
  assert.equal(animFrameIndexAt(anim, 0), 0)
  assert.equal(animFrameIndexAt(anim, 0.05), 0)
  assert.equal(animFrameIndexAt(anim, 0.15), 1)
  assert.equal(animFrameIndexAt(anim, 0.7), 7)      /* t=0.7 → tick 14，精确帧边界 */
  assert.equal(animFrameIndexAt(anim, 0.75), 7)
  assert.equal(animFrameIndexAt(anim, 0.799), 7)
  assert.equal(animFrameIndexAt(anim, 0.8), 0)      /* 0.8 % 0.8 = 0：循环回起点 */
  assert.equal(animFrameIndexAt(anim, 1.65), 0)     /* 1.65 % 0.8 ≈ 0.05 → 帧 0 */
  assert.equal(animFrameIndexAt(null, 1), 0)        /* 无动画兜底 */
  /* 自定义帧序：timeline 顺序（而非帧号顺序）决定时段 */
  const seq = parseAnimMeta({ animation: { frames: [5, 2] } }, 16, 128)   /* 2 段各 0.05s */
  assert.equal(animFrameIndexAt(seq, 0), 5)
  assert.equal(animFrameIndexAt(seq, 0.06), 2)
  assert.equal(animFrameIndexAt(seq, 0.11), 5)      /* 0.11 % 0.1 = 0.01 → 段 0 */
})

test('applyTexAnimFrame: repeat / offset（帧 0 = 贴图顶部，末帧 = 底部）', () => {
  const { parseAnimMeta, applyTexAnimFrame } = globalThis.__mcm
  const THREE = require('three')
  const anim = parseAnimMeta({ animation: { frametime: 2 } }, 16, 128)
  const tex = new THREE.Texture()
  applyTexAnimFrame(tex, anim, 0)
  /* half-texel inset：repeat = 1 - 2·(0.5/16)，offset = 0 + 0.5/16（v 域） */
  assert.equal(tex.repeat.x, 1 - 1 / 16)
  assert.ok(Math.abs(tex.repeat.y - (0.125 - 1 / 128)) < 1e-12)
  assert.equal(tex.offset.x, 0.5 / 16)
  assert.ok(Math.abs(tex.offset.y - (0.875 + 0.5 / 128)) < 1e-12)
  /* 几何 v=1 采样帧 0 顶行（texel 127 中心 127.5）、v=0 采样帧 0 底行（texel 112 中心 112.5） */
  assert.ok(Math.abs((1 * tex.repeat.y + tex.offset.y) * 128 - 127.5) < 1e-9)
  assert.ok(Math.abs((0 * tex.repeat.y + tex.offset.y) * 128 - 112.5) < 1e-9)
  applyTexAnimFrame(tex, anim, 7)
  assert.ok(Math.abs(tex.offset.y - 0.5 / 128) < 1e-12)   /* 末帧接近贴图底部（内收半像素） */
  applyTexAnimFrame(tex, anim, 99)                        /* 越界 clamp 到末帧 */
  assert.ok(Math.abs(tex.offset.y - 0.5 / 128) < 1e-12)
  applyTexAnimFrame(tex, anim, -1)
  assert.ok(Math.abs(tex.offset.y - (0.875 + 0.5 / 128)) < 1e-12)   /* 负数 clamp 回帧 0 */
  /* 非方形帧：repeat 按帧宽/帧高占整图比例（含 inset） */
  const anim32 = parseAnimMeta({ animation: { width: 32, height: 32 } }, 32, 128)
  const tex2 = new THREE.Texture()
  applyTexAnimFrame(tex2, anim32, 1)
  assert.equal(tex2.repeat.x, 1 - 1 / 32)
  assert.ok(Math.abs(tex2.repeat.y - (0.25 - 1 / 128)) < 1e-12)
  assert.ok(Math.abs(tex2.offset.y - (0.5 + 0.5 / 128)) < 1e-12)
  /* 非法输入不抛错 */
  assert.equal(applyTexAnimFrame(null, anim, 0), null)
  assert.equal(applyTexAnimFrame(tex, null, 0), tex)
})

test('applyTexAnimFrame: 采样窗口永不触碰帧边界（防渗色线，任意帧号/贴图）', () => {
  const { parseAnimMeta, applyTexAnimFrame } = globalThis.__mcm
  const THREE = require('three')
  /* 幂帧数（16×128）+ 非幂帧数（16×80，5 帧：offset 1-(i+1)/5 float 不可精确表示）+ 非方形帧（32×128） */
  const cases = [
    parseAnimMeta({ animation: {} }, 16, 128),
    parseAnimMeta({ animation: { frametime: 2 } }, 16, 80),
    parseAnimMeta({ animation: { width: 32, height: 32 } }, 32, 128),
  ]
  for (const anim of cases) {
    const tex = new THREE.Texture()
    for (let i = 0; i < anim.frameCount; i++) {
      applyTexAnimFrame(tex, anim, i)
      const lo = tex.offset.y * anim.texH           /* 采样窗口下端（texel 域） */
      const hi = (tex.offset.y + tex.repeat.y) * anim.texH
      const frameBottom = (anim.frameCount - 1 - i) * anim.frameH   /* 帧 i 底边（THREE flipY：v 自底向上） */
      const frameTop = frameBottom + anim.frameH
      /* 窗口内收半像素：不触碰帧边界 → 浮点误差/RepeatWrapping 无法采到相邻帧边缘行 */
      assert.ok(lo - frameBottom >= 0.5 - 1e-9, `帧 ${i} 下端距帧边界 ≥ 半像素`)
      assert.ok(frameTop - hi >= 0.5 - 1e-9, `帧 ${i} 上端距帧边界 ≥ 半像素`)
      /* NearestFilter 取整后覆盖帧内全部行（视觉无损失） */
      assert.equal(Math.floor(lo), frameBottom)
      assert.equal(Math.floor(hi - 1e-9), frameTop - 1)
      /* u 方向同理（防竖向渗色线） */
      const uLo = tex.offset.x * anim.texW
      const uHi = (tex.offset.x + tex.repeat.x) * anim.texW
      assert.ok(uLo >= 0.5 - 1e-9, 'u 下端内收半像素')
      assert.ok(anim.frameW - uHi >= 0.5 - 1e-9, 'u 上端内收半像素')
      assert.equal(Math.floor(uLo), 0)
      assert.equal(Math.floor(uHi - 1e-9), anim.frameW - 1)
    }
  }
})
test('attachTextureAnimOnly / unloadTextureAnim: 动画注册、容错与移除', async () => {
  const { attachTextureAnimOnly, unloadTextureAnim } = globalThis.__mcm
  const THREE = require('three')
  const mkTex = (w, h) => { const t = new THREE.Texture(); t.image = { width: w, height: h }; return t }

  /* 动画贴图：返回 anim + 首帧采样矩阵已配置（repeat<1 / offset>0） */
  const tex = mkTex(16, 128)
  const anim = await attachTextureAnimOnly(tex, Promise.resolve({ animation: { frametime: 2 } }))
  assert.ok(anim, '动画贴图返回 anim')
  assert.equal(anim.frameCount, 8)
  assert.ok(tex.repeat.x < 1 && tex.repeat.y < 1, '首帧 repeat 已缩至单帧区域')
  assert.ok(tex.offset.y > 0, '首帧 offset 已平移到帧 0（贴图顶部）')

  /* 移除注册不抛错（幂等） */
  unloadTextureAnim(tex)
  unloadTextureAnim(tex)
  unloadTextureAnim(null)

  /* 非动画 meta（单帧 / null / 缺 animation）→ null，贴图采样矩阵不变 */
  const tex2 = mkTex(16, 16)
  const r2 = await attachTextureAnimOnly(tex2, Promise.resolve({ animation: { frametime: 2 } }))
  assert.equal(r2, null, '单帧贴图无动画')
  const tex2b = mkTex(16, 128)
  assert.equal(await attachTextureAnimOnly(tex2b, Promise.resolve(null)), null, 'null meta')
  assert.equal(await attachTextureAnimOnly(mkTex(16, 128), Promise.resolve({})), null, '缺 animation')

  /* metaPromise reject → null（网络失败容错，不抛错） */
  assert.equal(await attachTextureAnimOnly(mkTex(16, 128), Promise.reject(new Error('404'))), null)

  /* 无 image / null tex → null（不抛错） */
  assert.equal(await attachTextureAnimOnly(new THREE.Texture(), Promise.resolve({ animation: { frametime: 2 } })), null, '无 image')
  assert.equal(await attachTextureAnimOnly(null, Promise.resolve({ animation: { frametime: 2 } })), null, 'null tex')
})