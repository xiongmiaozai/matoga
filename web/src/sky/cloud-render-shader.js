import * as THREE from 'three'

const VERT = /* glsl */`
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}
`

const FRAG = /* glsl */`
precision highp float;

uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uDayFactor;
uniform float uNightFactor;

uniform vec3 uSunColor;
uniform float uMoonBrightness;

uniform vec3 uCloudLayerBottom;
uniform vec3 uCloudLayer;
uniform float uCloudCoverage;
uniform float uCloudType;
uniform float uPrecipitation;
uniform vec2 uWindOffset;

uniform float uCloudAbsorption;
uniform float uCloudG;
uniform float uCloudPowder;
uniform float uCloudAmbient;
uniform float uMoonG;

uniform float uNoiseBaseScale;
uniform float uNoiseDetailScale;
uniform float uNoiseDetailStrength;
uniform float uNoiseCurlScale;
uniform float uNoiseCurlAmp;

uniform float uMaxStepsHorizon;
uniform float uMaxStepsTop;
uniform float uSkyRatioPenalty;
uniform float uTime;
uniform float uJitterAmp;

uniform bool uEnablePowder;
uniform bool uSingleLightSample;
uniform bool uHalfMaxSteps;

uniform int uBlockFrame;
uniform vec2 uResolution;

uniform sampler3D uTexBase;
uniform sampler3D uTexDetail;
uniform sampler2D uTexCurl;
uniform sampler2D uTexWeather;
uniform sampler2D uTexBlueNoise;
uniform vec2 uBlueNoiseOffset;

varying vec3 vWorldPos;

const float PI = 3.14159265;
const float EARTH_RADIUS = 6371000.0;
const vec3 EARTH_CENTER = vec3(0.0, -EARTH_RADIUS, 0.0);

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

#define clamp01(x) clamp(x, 0.0, 1.0)

float remap01(float x, float a, float b, float c, float d) {
  return c + clamp01((x - a) / (b - a)) * (d - c);
}

float heightGradient(float hf, float cloudType) {
  float peak = mix(0.25, 0.55, smoothstep(0.0, 2.0, cloudType));
  float amp  = mix(0.85, 1.30, smoothstep(0.0, 2.0, cloudType));
  float baseF = 1.0 - smoothstep(0.05, peak, hf);
  float topF  = smoothstep(0.35, 1.0, hf * amp);
  return clamp(baseF * topF + 0.12, 0.0, 1.0);
}

float cloudDensity(vec3 wp, vec2 windOffset, float coverage, float cloudType, int lod, vec2 uvJitter) {
  float altitude = length(wp - EARTH_CENTER) - EARTH_RADIUS;
  float hf = clamp((altitude - uCloudLayer.x) / (uCloudLayer.z), 0.0, 1.0);
  float hg = heightGradient(hf, cloudType);

  float coverageW = 1.0;
  coverageW = texture(uTexWeather, uvJitter).r;

  float effCoverage = clamp01(coverage * coverageW);

  vec3 baseUV = wp * uNoiseBaseScale + vec3(windOffset * 0.4, 0.0);
  vec4 base = texture(uTexBase, baseUV);
  float lowFreq = base.r;
  float wLow = base.g;

  float baseCloud = remap01(lowFreq, 1.0 - effCoverage * hg, 1.0, 0.0, 1.0) * hg;
  baseCloud += wLow * 0.2;

  if (lod == 0) return max(baseCloud, 0.0);

  float bottomFade = 1.0 - smoothstep(0.0, 0.06, hf);
  baseCloud = mix(baseCloud, baseCloud * 0.35, bottomFade);

  vec2 curlUV = wp.xz * uNoiseCurlScale + windOffset * 1.5;
  vec2 curl = texture(uTexCurl, fract(curlUV)).xy * 2.0 - 1.0;
  vec3 perturb = vec3(curl, 0.0) * uNoiseCurlAmp;

  vec3 detailUV = wp * uNoiseDetailScale + perturb;
  vec4 detail = texture(uTexDetail, detailUV);
  float erosion = detail.r;
  float finalDen = remap01(baseCloud, 1.0 - erosion * uNoiseDetailStrength, 1.0, 0.0, 1.0);

  return max(finalDen, 0.0);
}

float HGPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5) * 4.0 * PI);
}

float beersLaw(float density, float absorption) {
  return exp(-absorption * density);
}

float dualLobeHG(float cosTheta, float g, float K) {
  return mix(HGPhase(cosTheta, g), HGPhase(cosTheta, -g), K);
}

float multipleScattering(float depth, float g, float cosTheta, float K) {
  int octaves = 4;
  float attenuation = 0.5;
  float contribution = 0.5;
  float phaseAttenuation = 0.1;

  float luminance = 0.0;
  float a = 1.0;
  float b = 1.0;
  float c = 1.0;

  for (int i = 0; i < octaves; i++) {
    float beer = beersLaw(depth, a);
    float phase = dualLobeHG(cosTheta, g * c, K);
    luminance += b * phase * beer;
    a *= attenuation;
    b *= contribution;
    c *= (1.0 - phaseAttenuation);
  }
  return luminance;
}

vec3 cloudLighting(vec3 samplePos, float density, vec2 windOffset,
                   float coverage, float cloudType,
                   vec3 lightDir, vec3 lightColor, float absorption, float g,
                   vec2 uvJitter, bool cheap) {
  float sumDensity = 0.0;
  int lightSteps = 6;
  if (uSingleLightSample) lightSteps = 1;
  else if (cheap) lightSteps = 3;

  if (lightSteps == 1) {
    vec3 o = lightDir * 140.0;
    sumDensity = cloudDensity(samplePos + o * 0.8, windOffset, coverage, cloudType, 1, uvJitter);
  } else {
    float stepBase = cheap ? 100.0 : 60.0;
    float stepInc = cheap ? 180.0 : 110.0;
    for (int i = 0; i < 6; i++) {
      if (i >= lightSteps) break;
      float d = stepBase + float(i) * stepInc;
      vec3 o = lightDir * d;
      float cone = 10.0 + 30.0 * float(i);
      vec2 perp = vec2(cos(float(i) * 7.31), sin(float(i) * 7.31)) * cone;
      vec3 off = cross(lightDir, vec3(0.0, 1.0, 0.0)) * perp.x
               + cross(lightDir, vec3(1.0, 0.0, 0.0)) * perp.y;
      float ld = cloudDensity(samplePos + o + off, windOffset, coverage, cloudType, 1, uvJitter);
      sumDensity += ld;
    }
  }
  float transmittance = exp(-absorption * sumDensity * (lightSteps == 1 ? 0.5 : 1.0));

  float cosTheta = dot(normalize(samplePos), lightDir);
  float powder = uEnablePowder ? (1.0 + uCloudPowder * exp(-density * 2.0)) : 1.0;

  float msLuminance = multipleScattering(sumDensity * absorption, g, cosTheta, 0.2);
  vec3 energy = lightColor * msLuminance * powder;
  energy += uCloudAmbient * vec3(0.3, 0.35, 0.42) * (1.0 - transmittance * 0.5);
  return energy;
}

vec2 intersectCloudLayer(vec3 ro, vec3 rd) {
  float Rinner = EARTH_RADIUS + uCloudLayer.x;
  float Router = EARTH_RADIUS + uCloudLayer.y;

  vec3 oc = ro - EARTH_CENTER;
  float b = dot(oc, rd);
  float oc2 = dot(oc, oc);

  float c_outer = oc2 - Router * Router;
  float disc_outer = b * b - c_outer;
  if (disc_outer < 0.0) return vec2(-1.0, -1.0);

  float sq_outer = sqrt(disc_outer);
  float t_outer_near = -b - sq_outer;
  float t_outer_far = -b + sq_outer;

  float c_inner = oc2 - Rinner * Rinner;
  float disc_inner = b * b - c_inner;

  if (disc_inner < 0.0) {
    float t0 = max(t_outer_near, 0.0);
    if (t_outer_far <= t0) return vec2(-1.0, -1.0);
    return vec2(t0, t_outer_far);
  }

  float sq_inner = sqrt(disc_inner);
  float t_inner_near = -b - sq_inner;
  float t_inner_far = -b + sq_inner;

  float t0a = max(t_outer_near, 0.0);
  float t1a = t_inner_near;
  float t0b = max(t_inner_far, 0.0);
  float t1b = t_outer_far;

  if (t1a > t0a && t0a >= 0.0) return vec2(t0a, t1a);
  if (t1b > t0b && t0b >= 0.0) return vec2(t0b, t1b);

  return vec2(-1.0, -1.0);
}

struct CloudResult { vec3 color; float alpha; };

CloudResult raymarchClouds(vec3 ro, vec3 rd, vec2 windOffset, float coverage, float cloudType, vec2 uvJitter) {
  CloudResult result; result.color = vec3(0.0); result.alpha = 0.0;

  vec2 hit = intersectCloudLayer(ro, rd);
  if (hit.x < 0.0) return result;
  float t0 = hit.x;
  float t1 = hit.y;

  float viewUp = clamp(dot(rd, vec3(0.0, 1.0, 0.0)), -1.0, 1.0);
  int maxSteps = int(mix(uMaxStepsHorizon, uMaxStepsTop, pow(clamp(viewUp, 0.0, 1.0), 0.8)));
  if (uHalfMaxSteps) maxSteps /= 2;
  maxSteps = int(float(maxSteps) * (1.0 - uSkyRatioPenalty));

  float blueNoise = texture(uTexBlueNoise, gl_FragCoord.xy / 256.0 + uBlueNoiseOffset).r;
  float jitter = blueNoise * uJitterAmp * 200.0;
  t0 += jitter;
  if (t0 > t1) return result;

  const float INITIAL_STEP = 150.0;
  const float STEP_GROWTH = 1.25;
  const float MAX_STEP = 2000.0;
  const float SPACE_SKIP = 1.5;
  const float CLOUD_STEP = 80.0;
  const float DENSITY_BIAS = 0.018;

  float t = t0;
  float step = INITIAL_STEP;
  bool inCloud = false;
  int emptyStreak = 0;
  float trans = 1.0;

  for (int i = 0; i < 128; i++) {
    if (i >= maxSteps) break;
    if (result.alpha >= 0.99 || t > t1 - 0.5) break;

    vec3 pos = ro + rd * t;
    float densLow = cloudDensity(pos, windOffset, coverage, cloudType, 0, uvJitter);

    if (densLow <= DENSITY_BIAS) {
      if (inCloud && ++emptyStreak > 2) { inCloud = false; emptyStreak = 0; }
      t += step * SPACE_SKIP;
      step = min(step * STEP_GROWTH, MAX_STEP);
      continue;
    }

    float dens = cloudDensity(pos, windOffset, coverage, cloudType, 1, uvJitter);
    if (dens > DENSITY_BIAS) {
      inCloud = true;
      float cloudStep = min(step, CLOUD_STEP);
      float absorption = uCloudAbsorption * (1.0 + uPrecipitation * 2.0);
      bool cheap = result.alpha > 0.3;
      vec3 light = cloudLighting(pos, dens, windOffset, coverage, cloudType,
                                 normalize(uSunDir), uSunColor * uDayFactor,
                                 absorption, uCloudG, uvJitter, cheap);
      light += cloudLighting(pos, dens, windOffset, coverage, cloudType,
                             normalize(uMoonDir), vec3(0.7, 0.75, 0.95) * uMoonBrightness,
                             0.6, uMoonG, uvJitter, cheap);

      float alpha_i = 1.0 - exp(-uCloudAbsorption * dens * cloudStep);
      result.color += light * alpha_i * trans;
      result.alpha += alpha_i * (1.0 - result.alpha);
      trans *= exp(-uCloudAbsorption * dens * cloudStep);
      emptyStreak = 0;
      t += cloudStep;
    } else {
      if (++emptyStreak > 3) { inCloud = false; emptyStreak = 0; }
      t += step * SPACE_SKIP;
      step = min(step * STEP_GROWTH, MAX_STEP);
    }
  }
  return result;
}

    if (!inCloud) {
      inCloud = true;
      emptyStreak = 0;
      t -= step;
      step = STEP_SMALL;
      continue;
    }

    float dens = cloudDensity(pos, windOffset, coverage, cloudType, 1, uvJitter);
    if (dens > DENSITY_BIAS) {
      float absorption = uCloudAbsorption * (1.0 + uPrecipitation * 2.0);
      bool cheap = result.alpha > 0.3;
      vec3 light = cloudLighting(pos, dens, windOffset, coverage, cloudType,
                                 normalize(uSunDir), uSunColor * uDayFactor,
                                 absorption, uCloudG, uvJitter, cheap);
      light += cloudLighting(pos, dens, windOffset, coverage, cloudType,
                             normalize(uMoonDir), vec3(0.7, 0.75, 0.95) * uMoonBrightness,
                             0.6, uMoonG, uvJitter, cheap);

      float alpha_i = 1.0 - exp(-uCloudAbsorption * dens * step);
      result.color += light * alpha_i * trans;
      result.alpha += alpha_i * (1.0 - result.alpha);
      trans *= exp(-uCloudAbsorption * dens * step);
      emptyStreak = 0;
    } else if (++emptyStreak > 3) {
      inCloud = false;
      step = STEP_BIG;
      emptyStreak = 0;
    }
    t += step;
  }
  return result;
}

void main() {
  vec3 ro = uCloudLayerBottom;
  vec3 rd = normalize(vWorldPos - uCloudLayerBottom);

  ivec2 frag = ivec2(gl_FragCoord.xy);
  int blockX = frag.x % 2;
  int blockY = frag.y % 2;
  int activeIdx = uBlockFrame % 4;
  int activeX = activeIdx % 2;
  int activeY = activeIdx / 2;

  if (blockX != activeX || blockY != activeY || rd.y <= -0.08) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, -1.0);
    return;
  }

  float coverage = uCloudCoverage;
  float cloudType = uCloudType;

  vec2 wuv = vec2(
    mod((vWorldPos.x + uWindOffset.x * 40.0) * 0.00008, 1.0),
    mod((vWorldPos.z + uWindOffset.y * 40.0) * 0.00008, 1.0)
  );
  CloudResult cloud = raymarchClouds(uCloudLayerBottom, rd, uWindOffset,
                                     coverage, cloudType, wuv);

  gl_FragColor = vec4(cloud.color, cloud.alpha);
}
`

export class CloudRenderMaterial extends THREE.ShaderMaterial {
  constructor(params = {}) {
    const uniforms = {
      uSunDir: { value: new THREE.Vector3(0.0, 1.0, 0.0) },
      uMoonDir: { value: new THREE.Vector3(-0.5, 0.2, -0.8) },
      uDayFactor: { value: 1.0 },
      uNightFactor: { value: 0.0 },

      uSunColor: { value: new THREE.Color(1.0, 0.93, 0.85) },
      uMoonBrightness: { value: 0.12 },

      uCloudLayerBottom: { value: new THREE.Vector3(0, 0, 0) },
      uCloudLayer: { value: new THREE.Vector3(1500, 4000, 2500) },
      uCloudCoverage: { value: 0.55 },
      uCloudType: { value: 1.2 },
      uPrecipitation: { value: 0.0 },
      uWindOffset: { value: new THREE.Vector2() },

      uCloudAbsorption: { value: 2.0 },
      uCloudG: { value: 0.6 },
      uCloudPowder: { value: 1.5 },
      uCloudAmbient: { value: 0.15 },
      uMoonG: { value: 0.3 },

      uNoiseBaseScale: { value: 0.00038 },
      uNoiseDetailScale: { value: 0.0016 },
      uNoiseDetailStrength: { value: 0.62 },
      uNoiseCurlScale: { value: 0.0006 },
      uNoiseCurlAmp: { value: 12.0 },

      uMaxStepsHorizon: { value: 128 },
      uMaxStepsTop: { value: 64 },
      uSkyRatioPenalty: { value: 0.0 },
      uTime: { value: 0 },
      uJitterAmp: { value: 1.0 },

      uEnablePowder: { value: params.enablePowder ?? true },
      uSingleLightSample: { value: params.singleLightSample ?? false },
      uHalfMaxSteps: { value: params.halfMaxSteps ?? false },

      uBlockFrame: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },

      uTexBase: { value: null },
      uTexDetail: { value: null },
      uTexCurl: { value: null },
      uTexWeather: { value: null },
      uTexBlueNoise: { value: null },
      uBlueNoiseOffset: { value: new THREE.Vector2() }
    }

    super({
      name: 'CloudRenderMaterial',
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: false,
      blending: THREE.NoBlending
    })
    this.isCloudRender = true
  }
}