/* Vimaan 3D — shared shader pieces: the sky colour function, the aerial-perspective fog (height
 * haze + sun-side glow + in-cloud mist), and the procedural textures (made on the GPU at load). */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';

// One set of uniforms, shared by reference by every material (updated once per frame).
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.8, 0.2, 0.5).normalize() },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() },
  uFogSun: { value: new THREE.Color() },
  uFogDen: { value: 1.2e-4 },   // haze density at sea level (1/m)
  uFogH: { value: 700 },        // haze scale height (m)
  uMist: { value: 0 },          // inside a cloud: 0..1
  uMistCol: { value: new THREE.Color(1, 0.9, 0.8) },
  uDusk: { value: 0 },   // 0 golden … 0.5 soft dusk (window lights, lamps)
  uNoise: { value: null },
};

export const GLSL_SKY = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uGround;
vec3 skyColor(vec3 d) {
  float h = d.y, hp = max(h, 0.0);
  vec3 c = mix(uHorizon, uZenith, 1.0 - exp(-hp * 6.5));
  float sd = max(dot(d, uSunDir), 0.0);
  float band = exp(-hp * 5.0);
  c += uGlow * (0.18 * band * band + pow(sd, 3.0) * 0.5 * band + pow(sd, 30.0) * 0.45 + pow(sd, 400.0) * 1.4);
  return mix(c, uGround, smoothstep(0.0, -0.05, h));
}
`;

export const GLSL_FOG = /* glsl */`
uniform vec3 uFogSun; uniform float uFogDen; uniform float uFogH; uniform float uMist; uniform vec3 uMistCol;
float fogAmount(vec3 wp) {
  vec3 d = wp - cameraPosition; float L = length(d);
  float y0 = max(cameraPosition.y, 0.0), y1 = max(wp.y, 0.0), dy = y1 - y0;
  float e0 = exp(-y0 / uFogH), e1 = exp(-y1 / uFogH);
  // height haze: ρ(y) = den·e^(−y/H) integrated along the ray = den·L·H·(e0 − e1)/dy (limit den·L·e0 when level)
  float od = abs(dy) > 0.5 ? uFogDen * L * uFogH * (e0 - e1) / dy : uFogDen * L * e0;
  float f = 1.0 - exp(-max(od, 0.0));
  float m = 1.0 - exp(-L * uMist * 0.045);
  return max(f, m);
}
vec3 fogColor(vec3 wp) {
  vec3 v = normalize(wp - cameraPosition);
  float s = pow(max(dot(v, uSunDir), 0.0), 6.0);
  vec3 c = mix(uHorizon, uFogSun, s);
  return mix(c, uMistCol, uMist);
}
vec3 applyFog(vec3 col, vec3 wp) { return mix(col, fogColor(wp), fogAmount(wp)); }
`;

// Patch a built-in material: our fog instead of three's (all built-in materials of the scene use this).
export function withFog(mat) {
  mat.fog = false;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, { uSunDir: U.uSunDir, uZenith: U.uZenith, uHorizon: U.uHorizon, uGlow: U.uGlow, uGround: U.uGround, uFogSun: U.uFogSun, uFogDen: U.uFogDen, uFogH: U.uFogH, uMist: U.uMist, uMistCol: U.uMistCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogW;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        #ifdef USE_INSTANCING
          vFogW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogW;\n' + GLSL_SKY_DECL + GLSL_FOG)
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);\n#include <tonemapping_fragment>')
      .replace('#include <fog_fragment>', '');
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.customProgramCacheKey = () => (key ? key() : '') + '|nxfog';
  return mat;
}
// the sky uniforms without the function (fog needs uHorizon only)
const GLSL_SKY_DECL = 'uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uGround;\n';

// ------------------------------------------------------------------ procedural textures (GPU, once)
function renderToTexture(renderer, size, frag, opts) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: opts && opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
    wrapT: opts && opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
    depthBuffer: false,
  });
  rt.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const sc = new THREE.Scene(); sc.add(quad);
  const cam = new THREE.Camera();
  const prevTarget = renderer.getRenderTarget(), prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt); renderer.render(sc, cam); renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  quad.geometry.dispose(); mat.dispose();
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt.texture;
}

const GLSL_NOISE = /* glsl */`
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
`;

// RGBA tileable fbm noise (each channel a different scale / seed)
export function makeNoise(renderer) {
  return renderToTexture(renderer, 256, 'precision highp float; varying vec2 vUv;' + GLSL_NOISE + `
    void main() {
      vec2 p = vUv;
      float r = fbm(p * 4.0, 4.0, 6);
      float g = fbm(p * 8.0 + 17.0, 8.0, 5);
      float b = fbm(p * 16.0 + 41.0, 16.0, 4);
      float a = fbm(p * 32.0 + 73.0, 32.0, 3);
      gl_FragColor = vec4(r, g, b, a);
    }`);
}

// Cloud atlas: 2×2 cumulus chunks (flat base, domed and bumpy top, eroded edges).
// R = light (top and sun-side brighter, core darker), A = density.
export function makePuffs(renderer) {
  return renderToTexture(renderer, 512, 'precision highp float; varying vec2 vUv;' + GLSL_NOISE + `
    float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
    void main() {
      vec2 cell = floor(vUv * 2.0), p = fract(vUv * 2.0) * 2.0 - 1.0; // -1..1 inside one chunk
      float seed = cell.x + cell.y * 2.0 + 1.0;
      float d = -1.0;
      for (int i = 0; i < 9; i++) {
        float fi = float(i);
        float x = -0.62 + 1.24 * (fi / 8.0) + (h1(fi + seed * 7.0) - 0.5) * 0.18;
        float top = 1.0 - abs(x) * 1.15;                      // taller in the middle
        float r = (0.2 + 0.2 * h1(fi * 3.1 + seed)) * (0.7 + 0.5 * top);
        float y = -0.3 + r * 0.85 + top * 0.16 * h1(fi * 5.3 + seed * 2.0);
        d = max(d, 1.0 - length(vec2(p.x - x, (p.y - y) * 1.05)) / r);
      }
      float base = smoothstep(-0.52, -0.3, p.y);               // flat bottom
      float n = fbm(vUv * 8.0 + seed, 8.0, 5), n2 = fbm(vUv * 24.0 + seed * 3.0, 24.0, 3);
      float edge = d + (n - 0.5) * 0.7 + (n2 - 0.5) * 0.25;
      float dens = smoothstep(0.0, 0.5, edge) * base;
      dens *= smoothstep(1.0, 0.86, abs(p.x)) * smoothstep(1.0, 0.86, abs(p.y));
      float up = clamp((p.y + 0.4) / 1.0, 0.0, 1.0);
      float light = clamp(0.3 + 0.6 * up + (n - 0.5) * 0.6 + (1.0 - smoothstep(0.0, 0.45, edge)) * 0.25, 0.0, 1.0);
      gl_FragColor = vec4(light, 0.0, 0.0, dens);
    }`, { clamp: true });
}
