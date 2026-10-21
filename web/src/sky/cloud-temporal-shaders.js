import * as THREE from 'three'

const REPROJ_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const REPROJ_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uTexNew;
uniform sampler2D uTexHistory;
uniform mat3 uCurrViewRot;
uniform mat3 uPrevViewRotInv;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uTemporalAlpha;
uniform float uGhostingSuppression;

varying vec2 vUv;

void main() {
  vec4 newVal = texture(uTexNew, vUv);

  if (newVal.a >= 0.0) {
    vec4 hist = texture(uTexHistory, vUv);
    float alphaDiff = abs(newVal.a - hist.a);
    float motionWeight = 1.0 - smoothstep(0.0, uGhostingSuppression, alphaDiff);
    float finalBlend = uTemporalAlpha + (1.0 - uTemporalAlpha) * (1.0 - motionWeight);
    gl_FragColor = mix(hist, newVal, clamp(finalBlend, uTemporalAlpha, 1.0));
    return;
  }

  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rayCam = vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0);
  vec3 rayWorld = uCurrViewRot * rayCam;
  vec3 rayPrevCam = uPrevViewRotInv * rayWorld;

  if (rayPrevCam.z >= -0.001) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec2 prevNdc;
  prevNdc.x = rayPrevCam.x / -rayPrevCam.z / (uAspect * uTanHalfFov);
  prevNdc.y = rayPrevCam.y / -rayPrevCam.z / uTanHalfFov;
  vec2 prevUv = prevNdc * 0.5 + 0.5;

  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  gl_FragColor = texture(uTexHistory, prevUv);
}
`

const UPSAMPLE_VERT = REPROJ_VERT

const UPSAMPLE_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uTexCloud;
uniform vec2 uLowRes;

varying vec2 vUv;

void main() {
  vec2 texel = 1.0 / uLowRes;
  vec2 uv = vUv;

  vec4 c = texture(uTexCloud, uv);
  float w = 1.0;

  vec4 n = texture(uTexCloud, uv + vec2(0.0, texel.y));
  vec4 s = texture(uTexCloud, uv - vec2(0.0, texel.y));
  vec4 e = texture(uTexCloud, uv + vec2(texel.x, 0.0));
  vec4 w4 = texture(uTexCloud, uv - vec2(texel.x, 0.0));

  float wn = exp(-abs(n.a - c.a) * 8.0);
  float ws = exp(-abs(s.a - c.a) * 8.0);
  float we = exp(-abs(e.a - c.a) * 8.0);
  float ww = exp(-abs(w4.a - c.a) * 8.0);

  vec4 result = c * w + n * wn + s * ws + e * we + w4 * ww;
  result /= w + wn + ws + we + ww;

  gl_FragColor = result;
}
`

export class ReprojectMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      name: 'ReprojectMaterial',
      uniforms: {
        uTexNew: { value: null },
        uTexHistory: { value: null },
        uCurrViewRot: { value: new THREE.Matrix3() },
        uPrevViewRotInv: { value: new THREE.Matrix3() },
        uTanHalfFov: { value: 0.577 },
        uAspect: { value: 1.0 },
        uTemporalAlpha: { value: 0.15 },
        uGhostingSuppression: { value: 0.3 }
      },
      vertexShader: REPROJ_VERT,
      fragmentShader: REPROJ_FRAG,
      depthTest: false,
      depthWrite: false
    })
  }
}

export class UpsampleMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      name: 'UpsampleMaterial',
      uniforms: {
        uTexCloud: { value: null },
        uLowRes: { value: new THREE.Vector2(1, 1) }
      },
      vertexShader: UPSAMPLE_VERT,
      fragmentShader: UPSAMPLE_FRAG,
      depthTest: false,
      depthWrite: false
    })
  }
}
const GODRAYS_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uTexCloud;
uniform vec2 uSunScreenPos;
uniform vec3 uSunColor;
uniform float uIntensity;
uniform float uDecay;
uniform float uDensity;
uniform vec2 uResolution;

varying vec2 vUv;

void main() {
  const int NUM_SAMPLES = 64;
  vec2 deltaTexCoord = vUv - uSunScreenPos;
  deltaTexCoord *= 1.0 / float(NUM_SAMPLES) * uDensity;

  vec2 texCoord = vUv;
  float illuminationDecay = 1.0;
  vec3 color = vec3(0.0);

  for (int i = 0; i < 64; i++) {
    texCoord -= deltaTexCoord;
    vec2 clampedUV = clamp(texCoord, vec2(0.0), vec2(1.0));
    float sampleAlpha = texture(uTexCloud, clampedUV).a;
    float transmittance = 1.0 - sampleAlpha;
    color += uSunColor * transmittance * illuminationDecay;
    illuminationDecay *= uDecay;
  }

  color *= uIntensity / float(NUM_SAMPLES);
  gl_FragColor = vec4(color, 1.0);
}
`

export class GodRaysMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      name: 'GodRaysMaterial',
      uniforms: {
        uTexCloud: { value: null },
        uSunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
        uSunColor: { value: new THREE.Color(1.0, 0.93, 0.85) },
        uIntensity: { value: 1.5 },
        uDecay: { value: 0.95 },
        uDensity: { value: 0.8 },
        uResolution: { value: new THREE.Vector2(1, 1) }
      },
      vertexShader: REPROJ_VERT,
      fragmentShader: GODRAYS_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true
    })
  }
}