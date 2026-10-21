const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('url')
const path = require('path')

async function loadMjs(rel) {
  const abs = path.join(__dirname, '..', '..', 'web', 'src', 'sky', rel)
  return import(pathToFileURL(abs).href)
}

test('Astronomy: 正午 dayFactor→1，夜晚 nightFactor→1', async () => {
  const { Astronomy } = await loadMjs('astronomy.mjs')
  const a = new Astronomy({ latitude: 30, tzHours: 8 })

  const noon = a.compute(0.5, { algorithm: 'simple' })
  assert.ok(noon.dayFactor > 0.9, `dayFactor=${noon.dayFactor}`)
  assert.ok(noon.nightFactor < 0.05, `nightFactor=${noon.nightFactor}`)
  assert.ok(Math.abs(noon.sunDir.y) > 0.5, `sunAlt=${noon.sunAltitudeDeg}`)

  const midnight = a.compute(0.0, { algorithm: 'simple' })
  assert.ok(midnight.nightFactor > 0.9, `nightFactor=${midnight.nightFactor}`)
  assert.ok(midnight.dayFactor < 0.05, `dayFactor=${midnight.dayFactor}`)
})

test('Astronomy: sunDir 归一化 & 天顶角范围合法', async () => {
  const { Astronomy } = await loadMjs('astronomy.mjs')
  const a = new Astronomy({ latitude: 40, tzHours: 8 })
  for (let t = 0; t <= 1; t += 0.125) {
    const s = a.compute(t)
    const len = Math.hypot(s.sunDir.x, s.sunDir.y, s.sunDir.z)
    assert.ok(Math.abs(len - 1) < 1e-6, `sunDir normalized at t=${t}, len=${len}`)
    assert.ok(s.sunZenithDeg >= 0 && s.sunZenithDeg <= 180.01, `zenith=${s.sunZenithDeg}`)
    assert.ok(s.sunAltitudeDeg >= -90 && s.sunAltitudeDeg <= 90.01, `alt=${s.sunAltitudeDeg}`)
    assert.ok(s.moonPhase >= 0 && s.moonPhase <= 1)
  }
})

test('Astronomy: NOAA 与 Simple 输出量级一致（同一时刻天顶角接近）', async () => {
  const { Astronomy } = await loadMjs('astronomy.mjs')
  const a = new Astronomy({ latitude: 30, longitude: 120, tzHours: 8 })
  const s = a.compute(0.45, { algorithm: 'simple' })
  const n = a.compute(0.45, { algorithm: 'noaa' })
  // 简化球面模型与真实太阳轨道在 30°N 偏差允许 ±12°（简化模型无年周期精细修正）
  const diff = Math.abs(s.sunZenithDeg - n.sunZenithDeg)
  assert.ok(diff < 12, `zenith diff = ${diff}`)
})

test('Astronomy: 算法切换即时生效', async () => {
  const { Astronomy } = await loadMjs('astronomy.mjs')
  const a = new Astronomy()
  assert.equal(a.compute(0.4, { algorithm: 'noaa' }).algorithm, 'noaa')
  assert.equal(a.compute(0.4, { algorithm: 'simple' }).algorithm, 'simple')
})

test('WeatherManager: setWeather 平滑插值无跳变', async () => {
  const { WeatherManager } = await loadMjs('weather.mjs')
  const w = new WeatherManager({ preset: 'clear', blendSec: 2, randomDrift: false })
  w.setWeather('storm', 2)

  const s0 = w.snapshot()
  assert.ok(Math.abs(s0.coverage - 0.06) < 1e-6)
  assert.ok(s0.precipitation < 0.01)

  // 长时间推进应足够接近 storm 目标
  for (let i = 0; i < 600; i++) w.update(1 / 60)
  const s1 = w.snapshot()
  assert.ok(Math.abs(s1.coverage - 0.96) < 0.05, `coverage=${s1.coverage}`)
  assert.ok(Math.abs(s1.precipitation - 0.92) < 0.05, `precip=${s1.precipitation}`)
})

test('WeatherManager: override 立即生效并锁定目标', async () => {
  const { WeatherManager } = await loadMjs('weather.mjs')
  const w = new WeatherManager({ preset: 'cloudy', randomDrift: false })
  w.override({ coverage: 0.3, precipitation: 0.0 })
  const s = w.snapshot()
  assert.equal(s.coverage, 0.3)
  assert.equal(s.precipitation, 0)
  // drift 禁用下 target 即 current
  assert.equal(w.target.coverage, 0.3)
})

test('WeatherManager: 未知天气类型抛错', async () => {
  const { WeatherManager } = await loadMjs('weather.mjs')
  const w = new WeatherManager()
  assert.throws(() => w.setWeather('blizzard'), /unknown weather/)
})

test('WeatherManager: 风向归一化 & windOffset 随时间推进', async () => {
  const { WeatherManager } = await loadMjs('weather.mjs')
  const w = new WeatherManager({ preset: 'cloudy', randomDrift: false })
  w.override({ windDir: { x: 3, y: 4 } })
  const d = w.snapshot()
  const dirLen = Math.hypot(d.windDirX, d.windDirY)
  assert.ok(Math.abs(dirLen - 1) < 1e-6, `dirLen=${dirLen}`)

  const o0 = { ...w.snapshot() }
  for (let i = 0; i < 120; i++) w.update(1 / 60)
  const o1 = w.snapshot()
  assert.ok(Math.abs(o1.windOffsetX - o0.windOffsetX) > 0.001, 'windOffset 应随 dt 推进')
})

test('WeatherManager: 控制信号驱动（过场动画）', async () => {
  const { WeatherManager } = await loadMjs('weather.mjs')
  const w = new WeatherManager({ preset: 'clear', blendSec: 1, randomDrift: false })
  w.setControlSignals({ coverage: 0.9, precipitation: 0.8, windSpeed: 0.7, cloudType: 0.75 })
  for (let i = 0; i < 300; i++) w.update(1 / 30)
  const s = w.snapshot()
  assert.ok(s.coverage > 0.75, `coverage=${s.coverage}`)
  assert.ok(s.precipitation > 0.7, `precip=${s.precipitation}`)
})