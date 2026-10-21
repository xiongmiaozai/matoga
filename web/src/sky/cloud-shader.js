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
uniform float uMoonPhase;
uniform float uDayFactor;
uniform float uNightFactor;

uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uHorizonColor;
uniform vec3 uZenithTint;

uniform vec3 uCloudLayerBottom;   // xyz=相机位置(带层次基准)
uniform vec3 uCloudLayer;         // x=bottom y=top z=thickness
uniform float uCloudCoverage;
uniform float uCloudType;
uniform float uPrecipitation;
uniform vec2 uWindDir;
uniform vec2 uWindOffset;

uniform float uCloudAbsorption;
uniform float uCloudG;
uniform float uCloudPowder;
uniform float uCloudAmbient;
uniform float uMoonBrightness;
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
uniform bool uHalfResCloud;

uniform sampler3D uTexBase;
uniform sampler3D uTexDetail;
uniform sampler2D uTexCurl;
uniform sampler2D uTexWeather;
uniform sampler2D uTexStars;
uniform sampler2D uTexMilky;

varying vec3 vWorldPos;

const float PI = 3.14159265;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

#define clamp01(x) clamp(x, 0.0, 1.0)

float remap01(float x, float a, float b, float c, float d) {
  return c + clamp01((x - a) / (b - a)) * (d - c);
}

vec3 clampVec(vec3 v) { return max(v, vec3(0.0)); }

// ---------- 大气（选项A解析近似，无LUT） ----------
float rayleighPhase(float c) { return 0.0596831 * (1.0 + c * c); }
float miePhase(float c, float g) {
  float g2 = g * g;
  return 0.0795775 * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

vec3 atmosphereSimple(vec3 rd) {
  // 简化双散射解析：高度/天顶角驱动的颜色
  float cosTheta = clamp(dot(rd, normalize(uSunDir)), -1.0, 1.0);
  float up = clamp(rd.y, 0.0, 1.0);

  vec3 rayleigh = vec3(0.55, 0.75, 1.0);
  vec3 mie = vec3(0.82, 0.80, 0.78);

  // 天顶→地平线亮度递推（类似光学厚度 exp(-secθ)）
  float height  = clamp01(up);
  float horizon = (1.0 - height);
  float hb = pow(horizon, 1.6);

  vec3 skyGradient = mix(uHorizonColor, vec3(0.12, 0.32, 0.75), pow(height, 0.7));
  skyGradient += uZenithTint * (1.0 - height) * 0.12;

  // 太阳圆盘光晕
  float sundisc = pow(max(cosTheta, 0.0), 800.0) * 1200.0;
  float halo = pow(max(cosTheta, 0.0), 12.0);
  vec3 sunGlow = uSunColor * (sundisc + halo * 0.12) * uSunIntensity;

  // 散射叠加
  vec3 scattered = rayleigh * rayleighPhase(cosTheta) * 0.8
                 + mie * miePhase(cosTheta, 0.79);
  vec3 color = skyGradient * (0.55 + 0.45 * scattered)
             + sunGlow * exp(-2.0 * hb);

  // 夜晚：蓝色夜空
  color += vec3(0.006, 0.012, 0.04) * uNightFactor;
  return color;
}

// ---------- 云密度 ----------
float heightGradient(float hf, float cloudType) {
  float peak = mix(0.25, 0.55, smoothstep(0.0, 2.0, cloudType));
  float amp  = mix(0.85, 1.30, smoothstep(0.0, 2.0, cloudType));
  float baseF = 1.0 - smoothstep(0.05, peak, hf);
  float topF  = smoothstep(0.35, 1.0, hf * amp);
  return clamp(baseF * topF + 0.12, 0.0, 1.0);
}

float cloudDensity(vec3 wp, vec2 windOffset, float coverage, float cloudType, int lod, vec2 uvJitter) {
  float hf = clamp((wp.y - uCloudLayer.x) / (uCloudLayer.z), 0.0, 1.0);
  float hg = heightGradient(hf, cloudType);

  float coverageW = 1.0;
  coverageW = texture(uTexWeather, uvJitter).r;

  float effCoverage = clamp01(coverage * coverageW);

  vec3 baseUV = wp * uNoiseBaseScale + vec3(windOffset * 0.4, 0.0);
  vec4 base = texture(uTexBase, baseUV);
  float lowFreq = base.r;
  float wLow = base.g;
  float wHigh = base.b;

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

// ---------- 云光照（Beer-Lambert × HG × Powder，锥形6次采样） ----------
float HGPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5) * 4.0 * PI);
}

vec3 cloudLighting(vec3 samplePos, float density, vec2 windOffset,
                   float coverage, float cloudType,
                   vec3 lightDir, vec3 lightColor, float absorption, float g,
                   vec2 uvJitter) {
  float sumDensity = 0.0;
  if (uSingleLightSample) {
    vec3 o = lightDir * 140.0;
    sumDensity = cloudDensity(samplePos + o * 0.8, windOffset, coverage, cloudType, 1, uvJitter);
  } else {
    float stepBase = 60.0;
    float stepInc = 110.0;
    for (int i = 0; i < 6; i++) {
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
  float transmittance = exp(-absorption * sumDensity * (uSingleLightSample ? 0.5 : 1.0));

  float cosTheta = dot(normalize(samplePos), lightDir);
  float phase = mix(HGPhase(cosTheta, g), HGPhase(cosTheta, -0.2), 0.1);
  float powder = uEnablePowder ? (1.0 + uCloudPowder * exp(-density * 2.0)) : 1.0;

  vec3 energy = lightColor * transmittance * phase * powder;
  energy += uCloudAmbient * vec3(0.3, 0.35, 0.42) * (1.0 - transmittance * 0.5);
  return energy;
}

// ---------- 卷云（高层2D滚动噪声，不做光线步进） ----------
vec3 cirrus(vec3 rd, vec2 windOffset) {
  vec2 uv = rd.xz / (rd.y + 0.3) * 0.5 + 0.5;
  uv += windOffset * 0.02;
  float n1 = texture(uTexWeather, uv * 4.0).a;
  float n2 = texture(uTexWeather, uv * 8.0 + 0.3).a;
  float dens = remap01(n1, 1.0 - 0.5, 1.0, 0.0, 1.0) * 0.5
             + remap01(n2, 0.5, 1.0, 0.0, 0.3);
  float cosTheta = dot(rd, normalize(uSunDir));
  float illum = HGPhase(cosTheta, 0.35) * 0.5 * uDayFactor;
  vec3 col = vec3(0.85, 0.87, 0.95) * dens * illum;
  return col * step(0.02, rd.y);
}

// ---------- 星空天体 ----------
mat3 rotY(float a) {
  float c = cos(a); float s = sin(a);
  return mat3(c, 0, s, 0, 1, 0, -s, 0, c);
}

vec3 stars(vec3 rd) {
  vec3 dir = normalize(rotY(uTime * 0.003) * rd);
  vec2 uv = dir.xz / (abs(dir.y) + 0.35) * 0.4 + 0.5;
  float star = texture(uTexStars, fract(uv)).r;

  vec2 g = floor(uv * 96.0);
  vec2 f = fract(uv * 96.0);
  float rnd = hash12(g);
  float point = smoothstep(0.985, 1.0, rnd);
  point *= step(0.992, hash12(g + 7.0));
  star += point * 0.9;

  float milky = texture(uTexMilky, fract(dir.xz * 0.5 + 0.5)).r * 0.8;
  vec3 col = vec3(star) * vec3(0.9, 0.95, 1.0) + milky * vec3(0.75, 0.78, 0.95);
  return col * uNightFactor;
}

vec3 moon(vec3 rd) {
  float c = clamp(dot(rd, normalize(uMoonDir)), 0.0, 1.0);
  float disk = smoothstep(0.9955, 0.9982, c);
  // 月相：0=新月(暗), 0.5=弦月(半), 1=满月(亮)
  float phase = clamp(uMoonPhase * 2.0 - 1.0, -1.0, 1.0);
  float illum = pow(max(phase, 0.0), 1.8);
  vec3 col = vec3(0.82, 0.84, 0.9) * disk * clamp(phase * 1.5, 0.0, 1.0);
  return col * uNightFactor;
}

// ---------- 云层射线相交（返回 vec2(t0,t1)，无效时 x<0） ----------
vec2 intersectCloudLayer(vec3 ro, vec3 rd) {
  vec3 r = rd;
  if (abs(r.y) < 1e-4) r.y = 1e-4;
  float a = (uCloudLayer.x - ro.y) / r.y;
  float b = (uCloudLayer.y - ro.y) / r.y;
  float t0 = min(a, b);
  float t1 = max(a, b);
  t0 = max(t0, 0.0);
  if (t1 <= t0) return vec2(-1.0, -1.0);
  return vec2(t0, t1);
}

// ---------- 两级 LOD Ray-March 主循环 ----------
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

  float jitter = hash12(gl_FragCoord.xy + uTime * 17.0) * uJitterAmp * 200.0;
  t0 += jitter;
  if (t0 > t1) return result;

  const float STEP_BIG = 520.0;
  const float STEP_SMALL = 64.0;
  const float DENSITY_BIAS = 0.018;

  float t = t0;
  float step = STEP_BIG;
  bool inCloud = false;
  int emptyStreak = 0;
  float trans = 1.0;

  for (int i = 0; i < 128; i++) {
    if (i >= maxSteps) break;
    if (result.alpha >= 0.99 || t > t1 - 0.5) break;

    vec3 pos = ro + rd * t;
    float densLow = cloudDensity(pos, windOffset, coverage, cloudType, 0, uvJitter);

    if (densLow <= DENSITY_BIAS) {
      if (inCloud && ++emptyStreak > 2) { inCloud = false; step = STEP_BIG; emptyStreak = 0; }
      t += step;
      continue;
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
      vec3 light = cloudLighting(pos, dens, windOffset, coverage, cloudType,
                                 normalize(uSunDir), uSunColor * uDayFactor,
                                 absorption, uCloudG, uvJitter);
      light += cloudLighting(pos, dens, windOffset, coverage, cloudType,
                             normalize(uMoonDir), vec3(0.7, 0.75, 0.95) * uMoonBrightness,
                             0.6, uMoonG, uvJitter);

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

// ---------- 主入口 ----------
void main() {
  vec3 ro = uCloudLayerBottom;
  vec3 rd = normalize(vWorldPos - uCloudLayerBottom);

  vec2 weatherUV = ro.xz * 0.00015 + uWindOffset * 0.02;

  // 1. 大气底色
  vec3 color = atmosphereSimple(rd);
  // 地面雾
  float fog = 1.0 - exp(-max(-rd.y, 0.0) * 4.0);
  color = mix(color, uHorizonColor * 0.6 + vec3(0.3), fog * uPrecipitation * 0.4);

  // hub：仅当视线向上且未入睡夜时才渲染云
  if (rd.y > -0.08) {
    float coverage = uCloudCoverage;
    float cloudType = uCloudType;

    vec2 wuv = vec2(
      mod((vWorldPos.x + uWindOffset.x * 40.0) * 0.00008, 1.0),
      mod((vWorldPos.z + uWindOffset.y * 40.0) * 0.00008, 1.0)
    );
    CloudResult cloud = raymarchClouds(uCloudLayerBottom, rd, uWindOffset,
                                       coverage, cloudType, wuv);

    color = mix(color, cloud.color, cloud.alpha * step(0.02, rd.y));
  }

  // 3. 卷云（高层，不做光线步进）
  color += cirrus(rd, uWindOffset) * uDayFactor;

  // 4. 星空天体（仅夜晚）
  if (uNightFactor > 0.001 && rd.y > -0.05) {
    color += moon(rd);
    color += stars(rd);
  }

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class CloudSkyMaterial extends THREE.ShaderMaterial {
  constructor(renderer, params = {}) {
    const uniforms = {
      uSunDir: { value: new THREE.Vector3(0.0, 1.0, 0.0) },
      uMoonDir: { value: new THREE.Vector3(-0.5, 0.2, -0.8) },
      uMoonPhase: { value: 0.8 },
      uDayFactor: { value: 1.0 },
      uNightFactor: { value: 0.0 },

      uSunColor: { value: new THREE.Color(1.0, 0.93, 0.85) },
      uSunIntensity: { value: 1.2 },
      uHorizonColor: { value: new THREE.Color(0.85, 0.68, 0.55) },
      uZenithTint: { value: new THREE.Color(0.15, 0.3, 0.6) },

      uCloudLayerBottom: { value: new THREE.Vector3(0, 0, 0) },
      uCloudLayer: { value: new THREE.Vector3(1500, 4000, 2500) },
      uCloudCoverage: { value: 0.55 },
      uCloudType: { value: 1.2 },
      uPrecipitation: { value: 0.0 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uWindOffset: { value: new THREE.Vector2() },

      uCloudAbsorption: { value: 1.6 },
      uCloudG: { value: 0.42 },
      uCloudPowder: { value: 1.0 },
      uCloudAmbient: { value: 0.25 },
      uMoonBrightness: { value: 0.12 },
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
      uHalfResCloud: { value: params.halfResCloud ?? false },

      uTexBase: { value: null },
      uTexDetail: { value: null },
      uTexCurl: { value: null },
      uTexWeather: { value: null },
      uTexStars: { value: null },
      uTexMilky: { value: null }
    }

    super({
      name: 'CloudSkyMaterial',
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: false,
      blending: THREE.NoBlending
    })
    this.isCloudSky = true
  }
}