const PERM = new Uint8Array(512)
{
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    const t = p[i]; p[i] = p[j]; p[j] = t
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
}
const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
])

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10) }
function lerp(a, b, t) { return a + (b - a) * t }

function grad3(hash, x, y, z) {
  const h = hash & 15
  const u = h < 8 ? x : y
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z)
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}

export function perlin3(x, y, z) {
  const X = Math.floor(x) & 255
  const Y = Math.floor(y) & 255
  const Z = Math.floor(z) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const zf = z - Math.floor(z)
  const u = fade(xf)
  const v = fade(yf)
  const w = fade(zf)

  const A = PERM[X] + Y
  const AA = PERM[A] + Z
  const AB = PERM[A + 1] + Z
  const B = PERM[X + 1] + Y
  const BA = PERM[B] + Z
  const BB = PERM[B + 1] + Z

  return lerp(
    lerp(
      lerp(grad3(PERM[AA], xf, yf, zf), grad3(PERM[BA], xf - 1, yf, zf), u),
      lerp(grad3(PERM[AB], xf, yf - 1, zf), grad3(PERM[BB], xf - 1, yf - 1, zf), u),
      v
    ),
    lerp(
      lerp(grad3(PERM[AA + 1], xf, yf, zf - 1), grad3(PERM[BA + 1], xf - 1, yf, zf - 1), u),
      lerp(grad3(PERM[AB + 1], xf, yf - 1, zf - 1), grad3(PERM[BB + 1], xf - 1, yf - 1, zf - 1), u),
      v
    ),
    w
  )
}

export function fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin3(x * freq, y * freq, z * freq)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}

const HASH = new Uint32Array(1024)
{
  let s = 0x9e3779b9
  for (let i = 0; i < 1024; i++) {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    HASH[i] = s
  }
}

function hash3(ix, iy, iz, seed = 0) {
  let h = HASH[(ix | 0) & 1023] ^ HASH[(iy + 41) & 1023] ^ HASH[(iz + 97) & 1023] ^ (seed * 0x9e3779b1 | 0)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return h >>> 0
}

function worleyDist(fx, fy, fz, frequency, jitter, seed) {
  const cx = Math.floor(fx * frequency)
  const cy = Math.floor(fy * frequency)
  const cz = Math.floor(fz * frequency)
  const lx = fx * frequency - cx
  const ly = fy * frequency - cy
  const lz = fz * frequency - cz
  let f1 = 1e9
  let f2 = 1e9
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const h = hash3(cx + dx, cy + dy, cz + dz, seed)
        const ox = ((h & 65535) / 65535 - 0.5) * jitter
        const oy = (((h >> 16) & 65535) / 65535 - 0.5) * jitter
        const oz = (((h >> 32) & 65535) / 65535 - 0.5) * jitter
        const px = lx - (dx + 0.5 + ox)
        const py = ly - (dy + 0.5 + oy)
        const pz = lz - (dz + 0.5 + oz)
        const d = Math.sqrt(px * px + py * py + pz * pz)
        if (d < f1) { f2 = f1; f1 = d }
        else if (d < f2) f2 = d
      }
  return { f1, f2 }
}

function remap(x, a, b, c, d) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return c + t * (d - c)
}

export function genBaseTexture(size = 64) {
  const data = new Uint8Array(size * size * size * 4)
  const norm = 1 / (size * 1.5)
  let idx = 0
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = x * norm
        const fy = y * norm
        const fz = z * norm

        const per = fbm3(fx, fy, fz, 3)
        const { f1: w1, f2: w2 } = worleyDist(fx, fy, fz, 2, 0.8, 7)
        const { f1: wHi } = worleyDist(fx, fy, fz, 5, 1.0, 13)
        const wLow = remap(w1, 0, 0.7, 1, 0)
        const wMid = remap(w2, 0, 0.6, 1, 0)
        const base = per * 0.5 + (wMid + wLow) * 0.5

        const p01 = per * 0.5 + 0.5
        data[idx++] = Math.round(clamp01(p01 * (0.25 + 0.75 * wLow)) * 255)
        data[idx++] = Math.round(clamp01(wMid) * 255)
        data[idx++] = Math.round(clamp01(wHi) * 255)
        data[idx++] = Math.round(clamp01(base) * 255)
      }
  return { data, size, channels: 4 }
}

export function genDetailTexture(size = 32) {
  const data = new Uint8Array(size * size * size * 3)
  const norm = 1 / (size * 2.5)
  let idx = 0
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = x * norm
        const fy = y * norm
        const fz = z * norm
        const { f1 } = worleyDist(fx, fy, fz, 5, 1.0, 31)
        const w = remap(f1, 0, 0.6, 1, 0)
        const n = fbm3(fx, fy, fz, 2) * 0.5 + 0.5
        data[idx++] = Math.round(w * 255)
        data[idx++] = Math.round((remap(f1, 0, 0.4, 1, 0)) * 255)
        data[idx++] = Math.round(n * 255)
      }
  return { data, size, channels: 3 }
}

export function genCurlTexture(size = 128) {
  const data = new Uint8Array(size * size * 3)
  const norm = 1 / size
  const scale = 3.7
  const step = 1 / size
  let idx = 0
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = x * norm * scale
      const fy = y * norm * scale
      const e = 0.15
      const n1 = fbm3(fx, fy, 0.2, 3)
      const n2 = fbm3(fx + e, fy, 0.2, 3)
      const n3 = fbm3(fx, fy + e, 0.2, 3)
      const dvx = (n2 - n1) / e
      const dvy = (n3 - n1) / e
      const curlX = dvy
      const curlY = -dvx
      const len = Math.hypot(curlX, curlY) || 1
      data[idx++] = Math.round((curlX / len * 0.5 + 0.5) * 255)
      data[idx++] = Math.round((curlY / len * 0.5 + 0.5) * 255)
      data[idx++] = 128
    }
  return { data, size, channels: 3 }
}

export function genWeatherMap(size = 256) {
  const data = new Uint8Array(size * size * 4)
  let idx = 0
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = x / size
      const fy = y / size
      const coverage = remap(fbm3(fx * 2.3 + 100, fy * 2.3, 0.5, 4), -0.45, 0.45, 0, 1)
      const type = remap(fbm3(fx * 1.7 - 40, fy * 1.7, 2.2, 3), -0.3, 0.3, 0, 1)
      const precip = remap(fbm3(fx * 3.1 + 30, fy * 3.1, 1.3, 3), -0.2, 0.3, 0, 1)
      const density = 0.75 + 0.25 * perlin3(fx * 5, fy * 5, 0.3)
      data[idx++] = Math.round(coverage * 255)
      data[idx++] = Math.round(type * 255)
      data[idx++] = Math.round(precip * 255)
      data[idx++] = Math.round(density * 255)
    }
  return { data, size, channels: 4 }
}

export function genStarTexture(size = 512) {
  const data = new Uint8Array(size * size * 4)
  const cells = 48
  const cell = size / cells
  let idx = 0
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell)
      const cy = Math.floor(y / cell)
      const h = hash3(cx, cy, 0, 101)
      const prob = (h & 65535) / 65535
      let v = 0
      if (prob > 0.985) {
        const sub = ((h >> 16) & 65535) / 65535
        const lx = (x % cell) / cell - 0.5
        const ly = (y % cell) / cell - 0.5
        const dist = Math.sqrt(lx * lx + ly * ly)
        v = Math.max(0, 1 - dist * 2.2) * (0.75 + 0.25 * sub)
      }
      const idx4 = idx
      data[idx4] = Math.round(v * 255)
      data[idx4 + 1] = Math.round(v * 255)
      data[idx4 + 2] = Math.round((v * 0.9 + 0.1 * v * 0.6) * 255)
      data[idx4 + 3] = Math.round(v * 255)
      idx += 4
    }
  return { data, size, channels: 4 }
}

export function genMilkyWay(size = 256) {
  const data = new Uint8Array(size * size * 4)
  let idx = 0
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = x / size
      const fy = y / size
      const angle = Math.atan2(fy - 0.5, fx - 0.5)
      const band = remap(Math.abs(Math.cos(angle * 2) - 0.5), 0, 0.4, 0, 1)
      const dust = fbm3(fx * 4, fy * 4, 0.9, 4) * 0.5 + 0.5
      const v = Math.max(0, band - 0.45) * clamp01(dust)
      const bright = clamp01(Math.max(0, band - 0.55))
      data[idx++] = Math.round(v * 255 * 0.9)
      data[idx++] = Math.round(v * 255 * 0.92)
      data[idx++] = Math.round(bright * 255)
      data[idx++] = Math.round(v * 255)

    }
  return { data, size, channels: 4 }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v }
export function genBlueNoise(size = 256) {
  const white = new Float32Array(size * size)
  for (let i = 0; i < white.length; i++) white[i] = Math.random()

  const blurred = new Float32Array(size * size)
  const r = 3
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, cnt = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const sx = (x + dx + size) % size
          const sy = (y + dy + size) % size
          sum += white[sy * size + sx]
          cnt++
        }
      }
      blurred[y * size + x] = sum / cnt
    }
  }

  const blue = new Float32Array(size * size)
  let minV = Infinity, maxV = -Infinity
  for (let i = 0; i < blue.length; i++) {
    blue[i] = white[i] - blurred[i]
    if (blue[i] < minV) minV = blue[i]
    if (blue[i] > maxV) maxV = blue[i]
  }
  const range = maxV - minV || 1

  const data = new Uint8Array(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(((blue[i] - minV) / range) * 255)
    data[i * 3] = v
    data[i * 3 + 1] = v
    data[i * 3 + 2] = v
  }
  return { data, size, channels: 3 }
}