const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
const TWO_PI = Math.PI * 2

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstepEdge(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

function directionFromHorizon(altDeg, azDeg) {
  const alt = altDeg * DEG2RAD
  const az = azDeg * DEG2RAD
  return {
    x: Math.cos(alt) * Math.sin(az),
    y: Math.sin(alt),
    z: Math.cos(alt) * Math.cos(az)
  }
}

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date - start) / 86400000)
}

function declinationAndEqTimeFromDate(date) {
  const yearDay = dayOfYear(date)
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  const gamma = TWO_PI / 365 * (yearDay - 1 + (hour - 12) / 24)
  const eqTime = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  )
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma)
  return { declDeg: decl * RAD2DEG, eqTime }
}

export function noaaSunPosition(dateObj, latDeg, lonDeg, tzHours) {
  const { declDeg, eqTime } = declinationAndEqTimeFromDate(dateObj)
  const hour = dateObj.getHours() + dateObj.getMinutes() / 60 + dateObj.getSeconds() / 3600
  const timeOffset = eqTime + 4 * lonDeg - 60 * tzHours
  const trueSolarTime = hour * 60 + timeOffset
  const hourAngle = trueSolarTime / 4 - 180
  const latRad = latDeg * DEG2RAD
  const declRad = declDeg * DEG2RAD
  const haRad = hourAngle * DEG2RAD

  const cosZenith = Math.sin(latRad) * Math.sin(declRad)
    + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad)
  const zenithDeg = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * RAD2DEG
  const altDeg = 90 - zenithDeg

  const cosAz = (Math.sin(declRad) - Math.sin(altDeg * DEG2RAD) * Math.sin(latRad))
    / (Math.cos(altDeg * DEG2RAD) * Math.cos(latRad))
  let azDeg = Math.acos(Math.min(1, Math.max(-1, cosAz))) * RAD2DEG
  if (hourAngle > 0) azDeg = 360 - azDeg

  return { altitudeDeg: altDeg, azimuthDeg: azDeg, declinationDeg: declDeg, zenithDeg }
}

export function simpleSunPosition(dayTime, latDeg, declDeg) {
  const hourAngle = (dayTime * 24 - 12) * 15
  const latRad = latDeg * DEG2RAD
  const declRad = declDeg * DEG2RAD
  const haRad = hourAngle * DEG2RAD

  const sinAlt = Math.sin(latRad) * Math.sin(declRad)
    + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad)
  const altDeg = Math.asin(Math.min(1, Math.max(-1, sinAlt))) * RAD2DEG

  let azDeg = Math.atan2(
    Math.cos(declRad) * Math.sin(haRad),
    Math.cos(latRad) * Math.sin(declRad) - Math.sin(latRad) * Math.cos(declRad) * Math.cos(haRad)
  ) * RAD2DEG + 180
  if (azDeg > 360) azDeg -= 360
  if (azDeg < 0) azDeg += 360

  return { altitudeDeg: altDeg, azimuthDeg: azDeg, declinationDeg: declDeg }
}

// 近似季节赤纬（正弦近似年周期）
function approxDeclinationAsOf(dateObj) {
  const d = dayOfYear(dateObj)
  return 23.44 * Math.sin((2 * Math.PI / 365) * (d - 80))
}

function moonPosition(dayTime, latDeg, phase) {
  const lagHours = 12 * (1 - phase)
  const moonHour = (dayTime * 24 + lagHours) % 24
  const sun = simpleSunPosition(moonHour / 24, latDeg, approxDeclinationAsOf(new Date()))
  const altDeg = sun.altitudeDeg
  let azDeg = sun.azimuthDeg + 180
  if (azDeg > 360) azDeg -= 360
  return { altitudeDeg: altDeg, azimuthDeg: azDeg }
}


export class Astronomy {
  constructor(options = {}) {
    this.latitude = options.latitude ?? 30
    this.longitude = options.longitude ?? 120
    this.tzHours = options.tzHours ?? 8
    this.algorithm = options.algorithm ?? 'simple'
    this.moonPhase = options.moonPhase ?? 0.5
  }

  compute(dayTime, options = {}) {
    const t = clamp01(dayTime)
    const lat = options.latitude ?? this.latitude
    const lon = options.longitude ?? this.longitude
    const tz = options.tzHours ?? this.tzHours
    const algo = options.algorithm ?? this.algorithm
    const phase = options.moonPhase ?? this.moonPhase

    const dateObj = new Date()
    dateObj.setHours(0, 0, 0, 0)
    dateObj.setTime(dateObj.getTime() + t * 24 * 3600 * 1000)

    let sun
    if (algo === 'noaa') {
      sun = noaaSunPosition(dateObj, lat, lon, tz)
    } else {
      sun = simpleSunPosition(t, lat, approxDeclinationAsOf(new Date()))
    }

    const sunDir = normalize(directionFromHorizon(sun.altitudeDeg, sun.azimuthDeg))
    const sunZenithDeg = 90 - sun.altitudeDeg

    const moon = moonPosition(t, lat, phase)
    const moonDir = normalize(directionFromHorizon(moon.altitudeDeg, moon.azimuthDeg))

    const cosZenith = sunDir.y
    const dayFactor = smoothstepEdge(-0.15, 0.3, cosZenith)
    const nightFactor = smoothstepEdge(0.1, -0.25, cosZenith)

    return {
      dayTime: t,
      algorithm: algo,
      sunDir,
      moonDir,
      moonPhase: clamp01(phase),
      sunAltitudeDeg: sun.altitudeDeg,
      sunAzimuthDeg: sun.azimuthDeg,
      sunZenithDeg,
      declinationDeg: sun.declinationDeg,
      dayFactor,
      nightFactor
    }
  }
}