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

uniform vec3 uRayleighCoeff;
uniform vec3 uMieCoeff;
uniform vec3 uOzoneCoeff;
uniform float uRayleighScaleHeight;
uniform float uMieScaleHeight;
uniform float uAtmosphereRadius;
uniform float uPlanetRadius;
uniform vec3 uPlanetCenter;

uniform vec2 uWindOffset;
uniform float uCloudG;
uniform float uPrecipitation;
uniform float uTime;

uniform sampler2D uTexWeather;
uniform sampler2D uTexStars;
uniform sampler2D uTexMilky;

uniform sampler2D uTexCloud;
uniform sampler2D uTexGodRays;

varying vec3 vWorldPos;

const float PI = 3.14159265;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

#define clamp01(x) clamp(x, 0.0, 1.0)

float remap01(float x, float a, float b, float c, float d) {
  return c + clamp01((x - a) / (b - a)) * (d - c);
}

vec2 hitSphere(vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 oc = ro - center;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

vec3 getLightTransmittance(vec3 position, vec3 lightDir) {
  float altitude = length(position - uPlanetCenter) - uPlanetRadius;
  if (altitude > (uAtmosphereRadius - uPlanetRadius)) return vec3(1.0);

  vec2 planetHit = hitSphere(position, lightDir, uPlanetCenter, uPlanetRadius - 100.0);
  if (planetHit.x > 0.0) return vec3(0.0);

  float rawCos = dot(normalize(position - uPlanetCenter), lightDir);
  float cosTheta = clamp(rawCos, -1.0, 1.0);

  float airMass = 1.0 / (max(cosTheta, 0.0) + 0.015 * pow(93.885 - acos(max(cosTheta, 0.0)) * 57.2957795, -1.253));

  float densR = exp(-max(0.0, altitude) / uRayleighScaleHeight);
  float densM = exp(-max(0.0, altitude) / uMieScaleHeight);
  float densO = max(0.0, 1.0 - abs(altitude - 25000.0) / 15000.0);

  vec3 opticalDepth = (uRayleighCoeff * densR * uRayleighScaleHeight
                      + uMieCoeff * densM * uMieScaleHeight
                      + uOzoneCoeff * densO * 15000.0) * airMass;
  return exp(-opticalDepth);
}

vec3 GetAtmosphere(vec3 rayStart, vec3 rayDir, float rayLength) {
  vec2 atmosHit = hitSphere(rayStart, rayDir, uPlanetCenter, uAtmosphereRadius);
  if (atmosHit.y < 0.0) return vec3(0.0);

  float tMin = max(0.0, atmosHit.x);
  float tMax = min(rayLength, atmosHit.y);

  vec2 planetHit = hitSphere(rayStart, rayDir, uPlanetCenter, uPlanetRadius);
  if (planetHit.x > 0.0 && planetHit.x < tMax) tMax = planetHit.x;

  if (tMax <= tMin) return vec3(0.0);

  const int NUM_STEPS = 16;
  float stepSize = (tMax - tMin) / float(NUM_STEPS);
  float t = tMin + stepSize * 0.5;

  vec3 totalScattering = vec3(0.0);
  vec3 totalTransmittance = vec3(1.0);

  float costh = dot(rayDir, normalize(uSunDir));
  float phaseR = (3.0 / (16.0 * PI)) * (1.0 + costh * costh);
  float g = 0.85;
  float phaseM = (3.0 / (8.0 * PI)) * ((1.0 - g*g) * (1.0 + costh*costh)) / ((2.0 + g*g) * pow(1.0 + g*g - 2.0*g*costh, 1.5));

  for (int i = 0; i < 16; i++) {
    vec3 p = rayStart + rayDir * t;
    float height = max(0.0, length(p - uPlanetCenter) - uPlanetRadius);

    float dR = exp(-height / uRayleighScaleHeight);
    float dM = exp(-height / uMieScaleHeight);
    float dO = max(0.0, 1.0 - abs(height - 25000.0) / 15000.0);

    vec3 sigmaExt = uRayleighCoeff * dR + uMieCoeff * dM * 1.1 + uOzoneCoeff * dO;
    vec3 sigmaScat = uRayleighCoeff * dR * phaseR + uMieCoeff * dM * phaseM;

    vec3 stepTrans = exp(-sigmaExt * stepSize);
    vec3 sunTrans = getLightTransmittance(p, normalize(uSunDir));

    totalScattering += sigmaScat * sunTrans * totalTransmittance * stepSize;
    totalTransmittance *= stepTrans;
    t += stepSize;
  }
  return totalScattering * uSunIntensity;
}

vec3 GetSunDisc(vec3 rayDir) {
  float costh = dot(rayDir, normalize(uSunDir));
  float core = smoothstep(0.99985, 0.99995, costh);
  float glow = pow(max(costh, 0.0), 9000.0) * 0.5;
  return (vec3(core) + vec3(glow)) * uSunColor * 10.0;
}

float HGPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5) * 4.0 * PI);
}

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
  float phase = clamp(uMoonPhase * 2.0 - 1.0, -1.0, 1.0);
  float illum = pow(max(phase, 0.0), 1.8);
  vec3 col = vec3(0.82, 0.84, 0.9) * disk * clamp(phase * 1.5, 0.0, 1.0);
  return col * uNightFactor;
}

float terrainHeight(vec2 p) {
  float h = 0.0;
  h += sin(p.x * 0.003 + 1.3) * cos(p.y * 0.0025) * 1200.0;
  h += sin(p.x * 0.007 - 0.7) * cos(p.y * 0.006 + 2.1) * 500.0;
  h += sin(p.x * 0.015 + 3.0) * cos(p.y * 0.013 - 1.0) * 200.0;
  h += sin(length(p) * 0.004) * 300.0;
  return h;
}

void main() {
  vec3 ro = uPlanetCenter + vec3(0.0, uPlanetRadius, 0.0);
  vec3 rd = normalize(vWorldPos - ro);

  vec3 color = GetAtmosphere(ro, rd, 1e20);
  color += GetSunDisc(rd);

  color += vec3(0.006, 0.012, 0.04) * uNightFactor;

  float fog = 1.0 - exp(-max(-rd.y, 0.0) * 4.0);
  color = mix(color, uHorizonColor * 0.6 + vec3(0.3), fog * uPrecipitation * 0.4);

  vec4 cloud = texture(uTexCloud, gl_FragCoord.xy / vec2(textureSize(uTexCloud, 0)));
  color = mix(color, cloud.rgb, cloud.a * step(0.02, rd.y));

  if (rd.y > 0.0) {
    vec3 godRays = texture(uTexGodRays, gl_FragCoord.xy / vec2(textureSize(uTexGodRays, 0))).rgb;
    color += godRays * step(0.02, rd.y) * uDayFactor;
  }

  color += cirrus(rd, uWindOffset) * uDayFactor;

  if (rd.y < 0.0) {
    float t = -ro.y / rd.y;
    vec2 groundPos = ro.xz + rd.xz * t;
    float h = terrainHeight(groundPos);
    if (h > -200.0) {
      vec3 groundColor = mix(vec3(0.15, 0.22, 0.08), vec3(0.35, 0.32, 0.28), smoothstep(0.0, 800.0, h));
      groundColor = mix(groundColor, vec3(0.9, 0.92, 0.95), smoothstep(900.0, 1300.0, h));
      float dist = length(groundPos);
      float haze = 1.0 - exp(-dist * 0.00003);
      vec3 horizonHaze = mix(vec3(0.5, 0.6, 0.8), color, 0.3);
      groundColor = mix(groundColor, horizonHaze, haze);
      float lightAmt = max(dot(vec3(0.0, 1.0, 0.0), normalize(uSunDir)), 0.0);
      groundColor *= 0.3 + 0.7 * lightAmt;
      color = groundColor;
    }
  }

  if (uNightFactor > 0.001 && rd.y > -0.05) {
    color += moon(rd);
    color += stars(rd);
  }

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class SkyCompositeMaterial extends THREE.ShaderMaterial {
  constructor(params = {}) {
    const uniforms = {
      uSunDir: { value: new THREE.Vector3(0.0, 1.0, 0.0) },
      uMoonDir: { value: new THREE.Vector3(-0.5, 0.2, -0.8) },
      uMoonPhase: { value: 0.8 },
      uDayFactor: { value: 1.0 },
      uNightFactor: { value: 0.0 },

      uSunColor: { value: new THREE.Color(1.0, 0.93, 0.85) },
      uSunIntensity: { value: 20.0 },
      uHorizonColor: { value: new THREE.Color(0.85, 0.68, 0.55) },
      uZenithTint: { value: new THREE.Color(0.15, 0.3, 0.6) },

      uRayleighCoeff: { value: new THREE.Vector3(5.802e-6, 13.558e-6, 33.100e-6) },
      uMieCoeff: { value: new THREE.Vector3(3.996e-6, 3.996e-6, 3.996e-6) },
      uOzoneCoeff: { value: new THREE.Vector3(0.650e-6, 1.881e-6, 0.085e-6) },
      uRayleighScaleHeight: { value: 8000.0 },
      uMieScaleHeight: { value: 1200.0 },
      uAtmosphereRadius: { value: 6471000.0 },
      uPlanetRadius: { value: 6371000.0 },
      uPlanetCenter: { value: new THREE.Vector3(0.0, -6371000.0, 0.0) },

      uWindOffset: { value: new THREE.Vector2() },
      uCloudG: { value: 0.6 },
      uPrecipitation: { value: 0.0 },
      uTime: { value: 0 },

      uMoonBrightness: { value: 0.12 },
      uCloudLayerBottom: { value: new THREE.Vector3(0, 0, 0) },
      uCloudLayer: { value: new THREE.Vector3(1500, 4000, 2500) },
      uCloudCoverage: { value: 0.55 },
      uCloudType: { value: 1.2 },

      uCloudAbsorption: { value: 2.0 },
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
      uJitterAmp: { value: 1.0 },

      uEnablePowder: { value: params.enablePowder ?? true },
      uSingleLightSample: { value: params.singleLightSample ?? false },
      uHalfMaxSteps: { value: params.halfMaxSteps ?? false },

      uTexWeather: { value: null },
      uTexStars: { value: null },
      uTexMilky: { value: null },
      uTexCloud: { value: null },
      uTexGodRays: { value: null }
    }

    super({
      name: 'SkyCompositeMaterial',
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: false,
      blending: THREE.NoBlending
    })
    this.isSkyComposite = true
  }
}