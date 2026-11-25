/* Tiger Chase 3D — shared shader pieces: the sky colour, the aerial-perspective haze (height haze + a warm
 * glow towards the sun), the animals' shadows (their silhouettes from the sun, one small target), the place
 * weights along X, and the tileable noise texture (made on the GPU at load). */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { PL } from './timeline.js';

// One set of uniforms, shared by reference by every material (updated once per frame).
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.6, 0.4, 0.4).normalize() },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() },
  uFogSun: { value: new THREE.Color() },
  uSunCol: { value: new THREE.Color() },   // sun colour × intensity
  uAmbSky: { value: new THREE.Color() },
  uAmbGnd: { value: new THREE.Color() },
  uFogDen: { value: 0.004 },    // haze density at the ground (1/m)
  uFogH: { value: 70 },         // haze scale height (m)
  uWarm: { value: 0 },          // 0 morning … 1 warm dusk
  uNoise: { value: null },
  uHT: { value: null },         // ground height (R) + grass factor (G)
  uShadow: { value: null },     // the two animals' silhouettes from the sun (left half: tiger, right half: stag)
  uShA: { value: new THREE.Matrix4() }, uShB: { value: new THREE.Matrix4() },
  uPlateK: { value: new THREE.Vector4(0, 0, 1, 0) },  // the horizon plates: u offset (parallax), hills → ridges 0..1, gain, -
  uAnimA: { value: new THREE.Vector4() }, uAnimB: { value: new THREE.Vector4() }, // tiger / stag: x, z, heading cos, sin
  uAnimS: { value: new THREE.Vector4() },             // tiger speed 0..1, stag speed 0..1, tiger lying low 0..1, -
};
export const HT = { x0: -64, w: 512, z0: -52, d: 96, nx: 1024, nz: 192 };

export const GLSL_SKY = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uGround;
vec3 skyColor(vec3 d) {
  float h = d.y, hp = max(h, 0.0);
  vec3 c = mix(uHorizon, uZenith, 1.0 - exp(-hp * 4.2));
  float sd = max(dot(d, uSunDir), 0.0);
  float band = exp(-hp * 5.0);
  c += uGlow * (0.14 * band * band + pow(sd, 3.0) * 0.4 * band + pow(sd, 24.0) * 0.4 + pow(sd, 300.0) * 1.2);
  return mix(c, uGround, smoothstep(0.0, -0.06, h));
}
`;
const GLSL_SKY_DECL = 'uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uGround;\n';
export const GLSL_FOG = /* glsl */`
uniform vec3 uFogSun; uniform float uFogDen; uniform float uFogH;
float fogAmount(vec3 wp) {
  vec3 d = wp - cameraPosition; float L = length(d);
  float y0 = max(cameraPosition.y, 0.0), y1 = max(wp.y, 0.0), dy = y1 - y0;
  float e0 = exp(-y0 / uFogH), e1 = exp(-y1 / uFogH);
  // height haze: ρ(y) = den·e^(−y/H) integrated along the ray = den·L·H·(e0 − e1)/dy (limit den·L·e0 when level)
  float od = abs(dy) > 0.5 ? uFogDen * L * uFogH * (e0 - e1) / dy : uFogDen * L * e0;
  return 1.0 - exp(-max(od, 0.0));
}
vec3 fogColor(vec3 wp) {
  vec3 v = normalize(wp - cameraPosition);
  float s = pow(max(dot(v, uSunDir), 0.0), 5.0);
  return mix(uHorizon, uFogSun, s);
}
vec3 applyFog(vec3 col, vec3 wp) { return mix(col, fogColor(wp), fogAmount(wp)); }
`;
export const GLSL_FOG_FULL = GLSL_SKY_DECL + GLSL_FOG;
export const FOGU = () => ({ uSunDir: U.uSunDir, uZenith: U.uZenith, uHorizon: U.uHorizon, uGlow: U.uGlow, uGround: U.uGround, uFogSun: U.uFogSun, uFogDen: U.uFogDen, uFogH: U.uFogH });

// the places along X (the ridge repeats every P metres), the ground-height texture, the shadows
export const GLSL_WORLD = /* glsl */`
uniform sampler2D uHT; uniform sampler2D uShadow; uniform mat4 uShA; uniform mat4 uShB;
float wrapX(float x) { return x > ${(PL.XR + PL.P).toFixed(1)} ? ${PL.XR.toFixed(1)} + mod(x - ${PL.XR.toFixed(1)}, ${PL.P.toFixed(1)}) : x; }
float forestK(float wx) { return smoothstep(84.0, 104.0, wx) * (1.0 - smoothstep(194.0, 208.0, wx)); }
float ridgeK(float wx) { return smoothstep(236.0, 276.0, wx); }
vec2 htUV(vec2 xz) { return vec2((wrapX(xz.x) - (${HT.x0.toFixed(1)})) / ${HT.w.toFixed(1)}, (xz.y - (${HT.z0.toFixed(1)})) / ${HT.d.toFixed(1)}); }
float s5(float a, float b, float x) { x = clamp((x - a) / (b - a), 0.0, 1.0); return x * x * x * (x * (x * 6.0 - 15.0) + 10.0); }
float animalShadow(vec3 wp) {
  float s = 0.0;
  vec4 a = uShA * vec4(wp, 1.0), b = uShB * vec4(wp, 1.0);
  vec2 ua = a.xy * 0.5 + 0.5, ub = b.xy * 0.5 + 0.5;
  if (ua.x > 0.01 && ua.x < 0.99 && ua.y > 0.01 && ua.y < 0.99) {
    vec2 q = vec2(ua.x * 0.5, ua.y), e = vec2(0.006, 0.012);
    s = max(s, 0.25 * (texture2D(uShadow, q + e * vec2(0.5, 0.5)).r + texture2D(uShadow, q + e * vec2(-0.5, 0.5)).r + texture2D(uShadow, q + e * vec2(0.5, -0.5)).r + texture2D(uShadow, q - e * 0.5).r));
  }
  if (ub.x > 0.01 && ub.x < 0.99 && ub.y > 0.01 && ub.y < 0.99) {
    vec2 q = vec2(0.5 + ub.x * 0.5, ub.y), e = vec2(0.006, 0.012);
    s = max(s, 0.25 * (texture2D(uShadow, q + e * vec2(0.5, 0.5)).r + texture2D(uShadow, q + e * vec2(-0.5, 0.5)).r + texture2D(uShadow, q + e * vec2(0.5, -0.5)).r + texture2D(uShadow, q - e * 0.5).r));
  }
  return s;
}
`;
export const WORLDU = () => ({ uHT: U.uHT, uShadow: U.uShadow, uShA: U.uShA, uShB: U.uShB });

// Patch a built-in material: our haze instead of three's fog.
export function withFog(mat) {
  mat.fog = false;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, FOGU());
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogW;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #ifdef USE_INSTANCING
          vFogW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogW;\n' + GLSL_FOG_FULL)
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);\n#include <tonemapping_fragment>')
      .replace('#include <fog_fragment>', '');
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.customProgramCacheKey = () => (key ? key() : '') + '|nxfog';
  return mat;
}

// ------------------------------------------------------------------ procedural noise texture (GPU, once)
export function makeNoise(renderer) {
  const size = 256;
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false });
  rt.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `precision highp float; varying vec2 vUv;
      float hash2(vec2 p, float per) { p = mod(p, per); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p, float per) {
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        float a = hash2(i, per), b = hash2(i + vec2(1, 0), per), c = hash2(i + vec2(0, 1), per), d = hash2(i + vec2(1, 1), per);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p, float per, int oct) {
        float s = 0.0, a = 0.5, n = 0.0;
        for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vnoise(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; }
        return s / n;
      }
      void main() {
        vec2 p = vUv;
        gl_FragColor = vec4(fbm(p * 4.0, 4.0, 6), fbm(p * 8.0 + 17.0, 8.0, 5), fbm(p * 16.0 + 41.0, 16.0, 4), fbm(p * 64.0 + 73.0, 64.0, 2));
      }`, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const sc = new THREE.Scene(); sc.add(quad);
  const prevTarget = renderer.getRenderTarget(), prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt); renderer.render(sc, new THREE.Camera()); renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  quad.geometry.dispose(); mat.dispose();
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt.texture;
}
