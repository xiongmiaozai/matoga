export const WEATHER_PRESETS = {
  clear: {
    coverage: 0.06,
    cloudType: 0.4,
    precipitation: 0.0,
    windSpeed: 0.2,
    windDir: { x: 1, y: 0 }
  },
  cloudy: {
    coverage: 0.55,
    cloudType: 1.4,
    precipitation: 0.0,
    windSpeed: 0.4,
    windDir: { x: 0.9, y: 0.2 }
  },
  overcast: {
    coverage: 0.88,
    cloudType: 1.0,
    precipitation: 0.12,
    windSpeed: 0.5,
    windDir: { x: 0.7, y: 0.5 }
  },
  storm: {
    coverage: 0.96,
    cloudType: 2.0,
    precipitation: 0.92,
    windSpeed: 0.9,
    windDir: { x: 0.5, y: 0.8 }
  }
}

export const WEATHER_KEYS = Object.keys(WEATHER_PRESETS)

function lerp(a, b, k) {
  return a + (b - a) * k
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function norm2(v) {
  const len = Math.hypot(v.x, v.y) || 1
  return { x: v.x / len, y: v.y / len }
}

export class WeatherManager {
  constructor(options = {}) {
    const p = { ...WEATHER_PRESETS[options.preset ?? 'cloudy'] }
    this.current = {
      coverage: p.coverage,
      cloudType: p.cloudType,
      precipitation: p.precipitation,
      windSpeed: p.windSpeed,
      windDir: { ...p.windDir },
      windOffsetX: 0,
      windOffsetY: 0
    }
    this.target = { ...this.current }
    this.blendSec = options.blendSec ?? 8
    this.randomDrift = options.randomDrift ?? true
    this.controlSignals = null
    this._driftTimer = 0
  }

  setWeather(typeName, blendSec = 8) {
    const p = WEATHER_PRESETS[typeName]
    if (!p) throw new Error(`unknown weather type: ${typeName}`)
    this.target = {
      coverage: p.coverage,
      cloudType: p.cloudType,
      precipitation: p.precipitation,
      windSpeed: p.windSpeed,
      windDir: { ...p.windDir }
    }
    this.blendSec = Math.max(0.05, blendSec)
  }

  override(partial = {}) {
    if ('coverage' in partial) this.current.coverage = clamp01(partial.coverage)
    if ('cloudType' in partial) this.current.cloudType = Math.max(0, Math.min(2, partial.cloudType))
    if ('precipitation' in partial) this.current.precipitation = clamp01(partial.precipitation)
    if ('windSpeed' in partial) this.current.windSpeed = clamp01(partial.windSpeed)
    if ('windDir' in partial) this.current.windDir = norm2({ ...this.current.windDir, ...partial.windDir })
    this.target = { ...this.current }
  }

  setControlSignals(signals) {
    this.controlSignals = signals
  }

  clearControlSignals() {
    this.controlSignals = null
  }

  update(dt) {
    const k = 1 - Math.exp(-dt / Math.max(this.blendSec, 0.05))

    if (this.controlSignals) {
      const s = this.controlSignals
      const p = WEATHER_PRESETS[WEATHER_KEYS[Math.round(clamp01(s.cloudType) * (WEATHER_KEYS.length - 1))]]
      this.target.coverage = clamp01(s.coverage)
      this.target.cloudType = clamp01(s.cloudType) // 0=clear..1=storm 映射到 type 0~2
      this.target.precipitation = clamp01(s.precipitation)
      this.target.windSpeed = clamp01(s.windSpeed)
      this.target.windDir = norm2({ x: s.windDirX ?? 1, y: s.windDirY ?? 0 })
    } else if (this.randomDrift) {
      this._driftTimer += dt
      if (this._driftTimer > 120) {
        this._driftTimer = 0
        const base = this.target.coverage
        this.target.coverage = clamp01(base + (Math.random() - 0.5) * 0.1)
      }
    }

    for (const key of ['coverage', 'cloudType', 'precipitation', 'windSpeed']) {
      this.current[key] = lerp(this.current[key], this.target[key], k)
    }
    const d = norm2({
      x: lerp(this.current.windDir.x, this.target.windDir.x, k),
      y: lerp(this.current.windDir.y, this.target.windDir.y, k)
    })
    this.current.windDir = d
    this.current.windOffsetX += d.x * this.current.windSpeed * dt * 0.02
    this.current.windOffsetY += d.y * this.current.windSpeed * dt * 0.02

    return this.snapshot()
  }

  snapshot() {
    return {
      coverage: this.current.coverage,
      cloudType: this.current.cloudType,
      precipitation: this.current.precipitation,
      windSpeed: this.current.windSpeed,
      windDirX: this.current.windDir.x,
      windDirY: this.current.windDir.y,
      windOffsetX: this.current.windOffsetX,
      windOffsetY: this.current.windOffsetY
    }
  }
}