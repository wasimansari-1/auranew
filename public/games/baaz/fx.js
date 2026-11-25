/* Baaz 3D — effects, every one a pure function of the round time (a joining player sees the same):
 *   wind streaks  thin bright lines rushing past the camera in flight (more and longer as the multiplier
 *                 grows); a hard burst as the falcon tucks into the stoop at the end
 *   feathers      a few loose down feathers drifting from the glove at the launch; a burst of feathers
 *                 spinning off where the falcon tucks at the end
 *   sun glare     a soft starburst and lens ghosts when the sun is in the picture (above the clouds)
 * All drawn by shaders from a handful of uniforms: no per-frame buffers. */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { S5 } from './timeline.js';

// ------------------------------------------------------------------ wind streaks (camera space)
export function buildStreaks(n) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, 1, 0, 1, -1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const a = (i * 2.399963) % (Math.PI * 2), r = 0.35 + 0.65 * ((i * 0.618034) % 1); seed[i * 4] = a; seed[i * 4 + 1] = r; seed[i * 4 + 2] = (i * 0.7548777) % 1; seed[i * 4 + 3] = 0.7 + 0.6 * ((i * 0.5698403) % 1); }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uAmt: { value: 0 }, uLen: { value: 1 }, uCol: { value: new THREE.Color(1, 1, 1) }, uAspect: { value: 1 } },
    vertexShader: `
      attribute vec4 aSeed; uniform float uT; uniform float uAmt; uniform float uLen; uniform float uAspect;
      varying float vA; varying vec2 vQ;
      void main() {
        // each streak flies from far ahead (z −40) to just behind the camera, on its own ring position
        float ph = fract(uT * 0.55 * aSeed.w + aSeed.z);
        float z = mix(-40.0, 1.5, ph);
        float R = mix(2.2, 9.0, aSeed.y);
        vec3 c = vec3(cos(aSeed.x) * R * uAspect, sin(aSeed.x) * R, z);
        float L = uLen * (2.0 + 6.0 * ph);
        vec3 dir = normalize(vec3(0.0, 0.0, 1.0));
        vec3 side = normalize(vec3(-sin(aSeed.x), cos(aSeed.x), 0.0));
        vec3 p = c + dir * position.x * L + side * position.y * 0.012 * (1.0 + 2.0 * ph);
        vA = uAmt * smoothstep(0.0, 0.25, ph) * smoothstep(1.0, 0.85, ph) * step(0.5, aSeed.w * 1.4 - (1.0 - uAmt));
        vQ = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uCol; varying float vA; varying vec2 vQ;
      void main() {
        float a = vA * (1.0 - abs(vQ.y)) * smoothstep(0.0, 0.3, vQ.x) * smoothstep(1.0, 0.5, vQ.x);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uCol * a, a);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = 60; m.matrixAutoUpdate = false;
  return m;
}

// ------------------------------------------------------------------ feathers (world space, billboards)
// group A: the launch (from the glove), group B: the stoop (from where the falcon tucked)
export function buildFeathers(tex) {
  const N = 11, geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -1, 0, 0.5, -1, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const s = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { s[i * 4] = i < 4 ? 0 : 1; s[i * 4 + 1] = (i * 0.618034) % 1; s[i * 4 + 2] = (i * 0.7548777 + 0.3) % 1; s[i * 4 + 3] = (i * 0.5698403 + 0.1) % 1; }
  geo.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uA: { value: new THREE.Vector4(0, 0, 0, -1) }, uB: { value: new THREE.Vector4(0, 0, 0, -1) }, uBV: { value: new THREE.Vector3() }, uLight: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: `
      attribute vec4 aS; uniform vec4 uA; uniform vec4 uB; uniform vec3 uBV;
      varying vec2 vUv; varying float vAl;
      void main() {
        bool b = aS.x > 0.5; vec4 O = b ? uB : uA; float t = O.w;
        vAl = 0.0; vUv = position.xy * vec2(1.0, 0.5) + 0.5;
        if (t < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float a = aS.y * 6.2832;
        vec3 spread = vec3(cos(a), 0.0, sin(a)) * (b ? 1.6 : 0.35) * (0.4 + 0.6 * aS.z);
        // out, then a slow fall with a sway (drag: the spread settles)
        float dr = 1.0 - exp(-t * 2.2);
        vec3 p = O.xyz + spread * dr + (b ? uBV * 0.35 * dr : vec3(0.0)) + vec3(0.0, (b ? 0.8 : 0.25) * dr - (b ? 0.55 : 0.18) * t, 0.0);
        p.x += sin(t * 2.3 + aS.w * 6.0) * 0.12 * (b ? 2.0 : 1.0); p.z += cos(t * 1.9 + aS.y * 5.0) * 0.1;
        float life = b ? 3.2 : 4.0;
        vAl = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(life - 1.0, life, t));
        float size = (b ? 0.09 : 0.045) * (0.7 + 0.5 * aS.z);
        float rot = t * (1.5 + 2.5 * aS.w) * (aS.y > 0.5 ? 1.0 : -1.0) + aS.w * 6.0;
        vec2 q = position.xy * vec2(0.7, 1.0) * size; q = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); mv.xy += q;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uLight; varying vec2 vUv; varying float vAl;
      void main() {
        vec4 c = texture2D(uMap, vec2(vUv.x, vUv.y));
        float a = c.a * vAl; if (a < 0.05) discard;
        float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
        gl_FragColor = vec4(uLight * (0.25 + 0.9 * l) * vec3(0.8, 0.82, 0.88), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.renderOrder = 8;
  return m;
}

// ------------------------------------------------------------------ sun glare (screen space)
export function buildGlare() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector2() }, uAmt: { value: 0 }, uAspect: { value: 1 }, uCol: { value: new THREE.Color(1, 0.95, 0.85) } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform vec2 uSun; uniform float uAmt; uniform float uAspect; uniform vec3 uCol; varying vec2 vP;
      float ghost(vec2 p, vec2 c, float r, float soft) { return smoothstep(r, r * soft, length((p - c) * vec2(uAspect, 1.0))); }
      void main() {
        if (uAmt < 0.002) discard;
        vec2 p = vP, d = (p - uSun) * vec2(uAspect, 1.0);
        float r = length(d), ang = atan(d.y, d.x);
        float halo = exp(-r * 4.5) * 0.22 + exp(-r * 16.0) * 0.35;
        float rays = pow(abs(cos(ang * 6.0 + 0.4)), 30.0) * exp(-r * 7.0) * 0.28 + pow(abs(cos(ang * 4.0)), 60.0) * exp(-r * 5.0) * 0.2;
        // ghosts along the line from the sun through the centre
        vec2 axis = -uSun;
        float g = ghost(p, uSun + axis * 0.6, 0.06, 0.4) * 0.12 + ghost(p, uSun + axis * 1.25, 0.11, 0.7) * 0.08 + ghost(p, uSun + axis * 1.7, 0.035, 0.2) * 0.14 + ghost(p, uSun + axis * 2.1, 0.18, 0.85) * 0.05;
        vec3 col = uCol * (halo + rays) + vec3(0.75, 0.9, 1.0) * g;
        col *= uAmt;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false; m.renderOrder = 90;
  return m;
}

// ------------------------------------------------------------------ the amounts at τ (pure)
// st: { tau, tc }; out: { streak, len, featA (age, −1 none), featB (age) }
export function fxAt(tau, tc, out) {
  const s = tc != null && tau > tc ? tau - tc : -1;
  const fly = tau > 0 ? S5(2.5, 7, tau) * (0.35 + 0.65 * S5(8, 45, tau)) : 0;
  let streak = s < 0 ? fly : fly * (1 - S5(0, 1.2, s));
  let len = 1 + 0.8 * S5(10, 50, tau);
  if (s >= 0) { const burst = S5(0, 0.12, s) * (1 - S5(0.5, 1.6, s)); streak = Math.max(streak, burst); len = Math.max(len, 1 + 2.2 * burst); }
  out.streak = streak; out.len = len;
  out.featA = tau > -0.05 && tau < 4 ? tau + 0.05 : -1;
  out.featB = s >= 0 && s < 3.3 ? s : -1;
  return out;
}
