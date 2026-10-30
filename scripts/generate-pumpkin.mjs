import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'data', 'custom-models')
const OUT_FILE = join(OUT_DIR, 'pumpkin.json')

const TAU = Math.PI * 2

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function pumpkinPoint(theta, phi, opts) {
  const { radius = 1, flatten = 0.72, lobes = 8, lobeDepth = 0.12, topDent = 0.18, bottomDent = 0.12 } = opts
  const lobe = 1 - lobeDepth * (0.5 + 0.5 * Math.cos(lobes * theta))
  const r = radius * lobe
  const sp = Math.sin(phi)
  const cp = Math.cos(phi)
  let y = r * cp
  const dent = (1 - Math.abs(sp))
  if (cp > 0) y -= topDent * dent * radius
  else y += bottomDent * dent * radius
  y *= flatten
  const x = r * sp * Math.cos(theta)
  const z = r * sp * Math.sin(theta)
  return [x, y, z]
}

function buildBody(segT, segP, opts) {
  const positions = []
  const uvs = []
  const indices = []
  for (let j = 0; j <= segP; j++) {
    const phi = (j / segP) * Math.PI
    for (let i = 0; i <= segT; i++) {
      const theta = (i / segT) * TAU
      const [x, y, z] = pumpkinPoint(theta, phi, opts)
      positions.push(x, y, z)
      uvs.push(i / segT, j / segP)
    }
  }
  const stride = segT + 1
  for (let j = 0; j < segP; j++) {
    for (let i = 0; i < segT; i++) {
      const a = j * stride + i
      const b = j * stride + i + 1
      const c = (j + 1) * stride + i + 1
      const d = (j + 1) * stride + i
      indices.push(a, b, c, a, c, d)
    }
  }
  return { positions, uvs, indices }
}

function buildStem(opts) {
  const { stemHeight = 0.28, stemRadius = 0.11, stemX = 0, stemZ = 0, stemYBase = 0.62, seg = 16, rings = 6 } = opts
  const positions = []
  const uvs = []
  const indices = []
  const bend = 0.05
  for (let j = 0; j <= rings; j++) {
    const t = j / rings
    const y = stemYBase + t * stemHeight
    const r = stemRadius * (1 - 0.35 * t)
    const ox = stemX + bend * Math.sin(t * Math.PI)
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU
      positions.push(ox + r * Math.cos(a), y, stemZ + r * Math.sin(a))
      uvs.push(i / seg, t)
    }
  }
  const stride = seg + 1
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * stride + i
      const b = j * stride + i + 1
      const c = (j + 1) * stride + i + 1
      const d = (j + 1) * stride + i
      indices.push(a, b, c, a, c, d)
    }
  }
  const capCenter = positions.length / 3
  positions.push(stemX + bend, stemYBase + stemHeight, stemZ)
  uvs.push(0.5, 0.5)
  for (let i = 0; i < seg; i++) {
    const a = rings * stride + i
    const b = rings * stride + i + 1
    indices.push(a, b, capCenter)
  }
  return { positions, uvs, indices }
}

function computeNormals(positions, indices) {
  const n = positions.length / 3
  const normals = new Float32Array(positions.length)
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k]
    const b = indices[k + 1]
    const c = indices[k + 2]
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2]
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    normals[a * 3] += nx; normals[a * 3 + 1] += ny; normals[a * 3 + 2] += nz
    normals[b * 3] += nx; normals[b * 3 + 1] += ny; normals[b * 3 + 2] += nz
    normals[c * 3] += nx; normals[c * 3 + 1] += ny; normals[c * 3 + 2] += nz
  }
  for (let i = 0; i < n; i++) {
    let nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2]
    const len = Math.hypot(nx, ny, nz) || 1
    normals[i * 3] = nx / len
    normals[i * 3 + 1] = ny / len
    normals[i * 3 + 2] = nz / len
  }
  return Array.from(normals)
}

function bodyColor(yNorm, phiNorm, lobeShade) {
  const r = lerp(0.85, 0.55, clamp(yNorm, 0, 1))
  const g = lerp(0.45, 0.18, clamp(yNorm, 0, 1))
  const b = lerp(0.08, 0.04, clamp(yNorm, 0, 1))
  const shade = 0.85 + 0.15 * lobeShade
  const groove = 1 - 0.25 * Math.pow(1 - lobeShade, 2)
  return [r * shade * groove, g * shade * groove, b * shade * groove]
}

function stemColor(t) {
  const r = lerp(0.32, 0.22, t)
  const g = lerp(0.42, 0.30, t)
  const b = lerp(0.18, 0.12, t)
  return [r, g, b]
}

function buildGeometry() {
  const bodyOpts = { radius: 1, flatten: 0.72, lobes: 8, lobeDepth: 0.14, topDent: 0.16, bottomDent: 0.10 }
  const body = buildBody(96, 64, bodyOpts)

  const bodyNormals = computeNormals(body.positions, body.indices)
  const bodyColors = []
  for (let j = 0; j <= 64; j++) {
    const phi = (j / 64) * Math.PI
    const yNorm = 1 - phi / Math.PI
    for (let i = 0; i <= 96; i++) {
      const theta = (i / 96) * TAU
      const lobeShade = 0.5 + 0.5 * Math.cos(8 * theta)
      const c = bodyColor(yNorm, phi / Math.PI, lobeShade)
      bodyColors.push(...c)
    }
  }

  const stemOpts = { stemHeight: 0.30, stemRadius: 0.12, stemYBase: 0.60, seg: 20, rings: 8 }
  const stem = buildStem(stemOpts)
  const stemNormals = computeNormals(stem.positions, stem.indices)
  const stemColors = []
  for (let j = 0; j <= stemOpts.rings; j++) {
    const t = j / stemOpts.rings
    for (let i = 0; i <= stemOpts.seg; i++) {
      stemColors.push(...stemColor(t))
    }
  }
  stemColors.push(...stemColor(1))

  const bodyOffset = 0
  const stemOffset = body.positions.length / 3
  const allPositions = body.positions.concat(stem.positions.map((v, idx) => {
    if (idx % 3 === 1) return v
    return v
  }))
  const allNormals = bodyNormals.concat(stemNormals)
  const allUvs = body.uvs.concat(stem.uvs)
  const allColors = bodyColors.concat(stemColors)
  const allIndices = body.indices.concat(stem.indices.map((idx) => idx + stemOffset))

  return {
    positions: allPositions,
    normals: allNormals,
    uvs: allUvs,
    colors: allColors,
    indices: allIndices,
  }
}

function toBufferGeometryJSON(geo) {
  return {
    metadata: { version: 4.5, type: 'BufferGeometry', generator: 'matoga-pumpkin' },
    uuid: uuid(),
    type: 'BufferGeometry',
    data: {
      attributes: {
        position: { itemSize: 3, type: 'Float32Array', array: Float32Array.from(geo.positions), normalized: false },
        normal: { itemSize: 3, type: 'Float32Array', array: Float32Array.from(geo.normals), normalized: false },
        uv: { itemSize: 2, type: 'Float32Array', array: Float32Array.from(geo.uvs), normalized: false },
        color: { itemSize: 3, type: 'Float32Array', array: Float32Array.from(geo.colors), normalized: false },
      },
      index: { itemSize: 3, type: 'Uint32Array', array: Uint32Array.from(geo.indices), normalized: false },
      groups: [{ start: 0, count: geo.indices.length, materialIndex: 0 }],
    },
  }
}

function toObjectJSON(geo) {
  const geom = toBufferGeometryJSON(geo)
  return {
    metadata: { version: 4.5, type: 'Object', generator: 'matoga-pumpkin' },
    object: {
      uuid: uuid(),
      type: 'Group',
      name: 'Pumpkin',
      layers: { mask: 1 },
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      children: [
        {
          uuid: uuid(),
          type: 'Mesh',
          name: 'PumpkinBody',
          geometry: geom.uuid,
          material: uuid(),
          layers: { mask: 1 },
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      ],
      geometries: [geom],
      materials: [
        {
          uuid: uuid(),
          type: 'MeshStandardMaterial',
          name: 'PumpkinSkin',
          roughness: 0.65,
          metalness: 0.0,
          vertexColors: true,
          map: null,
          normalMap: null,
        },
      ],
    },
  }
}

const geo = buildGeometry()
const json = toObjectJSON(geo)
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(json), 'utf8')

const sizeKB = (JSON.stringify(json).length / 1024).toFixed(1)
console.log(`南瓜模型已生成: ${OUT_FILE}`)
console.log(`顶点数: ${geo.positions.length / 3}, 三角面: ${geo.indices.length / 3}, 大小: ${sizeKB} KB`)