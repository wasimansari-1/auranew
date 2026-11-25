/* Tiger Chase 3D — the world: the sky with its far horizon (hills / sandstone ridges, two painted plates that
 * wrap round), the ground (golden meadow → sal forest → river → rocky ridge; the ridge a tile that repeats), the
 * tall grass (instanced blades that sway and part round the animals), the trees, bushes and the old shrine
 * (photographic cut-outs on camera-facing cards, all of them one instanced draw), rocks, the river, the dust,
 * the grass bits and the big cloud of the catch, the NEXORNG way-stones. Procedural or CC0 / our own pictures
 * (LICENSES.txt). */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { U, HT, GLSL_SKY, GLSL_FOG, GLSL_FOG_FULL, GLSL_WORLD, FOGU, WORLDU } from './common.js';
import { baseGround, pathZ, riverDist, PL, wrapX } from './timeline.js';

function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const END = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

// ------------------------------------------------------------------ sky + the far horizon
// The horizon plates (horizon.webp: top half the forested hills, bottom half the sandstone ridges) are painted
// into the sky dome itself: a band from just under the horizon up to PLATE_TOP degrees, three repeats round
// the circle, sliding a little with the camera (far parallax), fading from hills to ridges as the place changes.
const PLATE_LO = -0.4, PLATE_TOP = 10.5;
export function buildSky(plate) {
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), { uSunCol: U.uSunCol, uNoise: U.uNoise, uTime: U.uTime, uWarm: U.uWarm, uPlate: { value: plate }, uPlateK: U.uPlateK }),
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uSunCol; uniform sampler2D uNoise, uPlate; uniform float uTime; uniform float uWarm; uniform vec4 uPlateK; varying vec3 vDir;
      ${GLSL_SKY}
      vec4 plateAt(float u, float k, float half_) { return texture2D(uPlate, vec2(u, half_ + 0.5 * clamp(k, 0.004, 0.996))); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float sd = max(dot(d, uSunDir), 0.0);
        c += uSunCol * smoothstep(0.9996, 0.99985, sd) * 9.0 * smoothstep(-0.02, 0.01, d.y);     // the sun's disc
        // fair-weather clouds: soft, bright, high
        vec2 q = d.xz / (d.y + 0.16) * vec2(0.09, 0.16) + vec2(uTime * 0.0012, 0.0);
        float cl = smoothstep(0.52, 0.8, texture2D(uNoise, q).r * 0.7 + texture2D(uNoise, q * 2.7).g * 0.3) * smoothstep(0.03, 0.22, d.y);
        vec3 cc = mix(vec3(1.0, 0.99, 0.96), vec3(1.0, 0.8, 0.6), uWarm) * (0.8 + 0.5 * pow(sd, 4.0));
        c = mix(c, cc, cl * 0.6);
        // the far horizon
        float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
        float k = (el - (${PLATE_LO.toFixed(2)})) / ${(PLATE_TOP - PLATE_LO).toFixed(2)};
        if (k < 1.0) {
          float u = atan(d.x, -d.z) / 2.0943951 + uPlateK.x;
          vec4 h = plateAt(u, k, 0.5), r = plateAt(u + 0.37, k, 0.0);
          vec4 p = mix(h, r, uPlateK.y);
          float a = k < 0.0 ? 1.0 : p.a;
          vec3 pc = p.rgb * uPlateK.z * mix(vec3(1.0), vec3(1.08, 0.97, 0.86), uWarm);
          pc = mix(pc, uHorizon, 0.12 + 0.2 * k);                         // aerial haze
          c = mix(c, pc, a);
        }
        gl_FragColor = vec4(c, 1.0);${END}
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ------------------------------------------------------------------ the ground-height texture (R height, G grass factor)
export function makeHeightTex() {
  const { nx, nz, x0, w, z0, d } = HT, a = new Uint16Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) / nx * w, z = z0 + (j + 0.5) / nz * d;
    const h = baseGround(x, z);
    // grass: tall in the meadow, a grazed lane where the chase runs (wider on the camera's side, so the feet show),
    // thin and short under the sal trees, none in the river, dry tufts on the ridge
    const pz = pathZ(x), dz = z - pz;
    const lane = dz > 0 ? 1 - THREE.MathUtils.smootherstep(dz, 4.5, 11) : 1 - THREE.MathUtils.smootherstep(-dz, 1.4, 4.2);
    const stalk = 1 - THREE.MathUtils.smootherstep(x, 3.5, 9.5);       // where the tiger lies: tall all round
    let g = 1 - lane * (0.66 - 0.5 * stalk);
    const wx = wrapX(x), fk = THREE.MathUtils.smoothstep(wx, 84, 104) * (1 - THREE.MathUtils.smoothstep(wx, 194, 208)), rk = THREE.MathUtils.smoothstep(wx, 236, 276);
    g *= 1 - 0.55 * fk; g *= 1 - 0.6 * rk;
    g *= THREE.MathUtils.smoothstep(riverDist(x, z), PL.riverHalf + 0.5, PL.riverHalf + 5);
    if (z < -45 || z > 23) g = 0;
    g *= THREE.MathUtils.smoothstep(z, -45, -39) * (1 - THREE.MathUtils.smoothstep(z, 17, 23));
    a[(j * nx + i) * 2] = THREE.DataUtils.toHalfFloat(h); a[(j * nx + i) * 2 + 1] = THREE.DataUtils.toHalfFloat(g);
  }
  const t = new THREE.DataTexture(a, nx, nz, THREE.RGFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ the ground
const GROUND_FRAG = /* glsl */`
uniform sampler2D uTexM, uTexF, uTexR, uNoise; uniform vec3 uSunCol, uAmbSky, uAmbGnd; uniform float uTime, uWarm;
varying vec3 vW; varying vec3 vN;
${GLSL_FOG_FULL}
${GLSL_WORLD}
void main() {
  float wx = wrapX(vW.x), fk = forestK(wx), rk = ridgeK(wx);
  vec2 uv = vec2(wx, vW.z);
  float nA = texture2D(uNoise, uv / 67.0).r, nB = texture2D(uNoise, uv / 19.0).g, nC = texture2D(uNoise, uv / 7.0).b;
  float dist = length(vW - cameraPosition), farK = smoothstep(25.0, 140.0, dist);
  // two scales of each texture (no visible repeat), the far one from a coarse mip
  vec3 m = mix(texture2D(uTexM, uv / 2.2).rgb * 0.6 + texture2D(uTexM, uv / 7.3 + 0.37).rgb * 0.4, texture2D(uTexM, uv / 7.3, 6.0).rgb, farK);
  m *= mix(vec3(1.18, 1.04, 0.6), vec3(1.0, 1.08, 0.66), nA);                    // golden-green, patchy
  vec3 f = mix(texture2D(uTexF, uv / 2.6).rgb * 0.65 + texture2D(uTexF, uv / 8.1 + 0.21).rgb * 0.35, texture2D(uTexF, uv / 8.1, 6.0).rgb, farK) * vec3(1.05, 0.95, 0.82);
  vec3 r = mix(texture2D(uTexR, uv / 4.0).rgb, texture2D(uTexR, uv / 4.0, 6.0).rgb, farK * 0.8) * vec3(1.2, 1.0, 0.8);
  vec3 col = mix(m, f, fk);
  float rockMask = smoothstep(0.42, 0.58, nB + 0.3 * nA);
  col = mix(col, mix(m * vec3(1.4, 1.08, 0.7), r * vec3(1.05, 0.86, 0.66), rockMask), rk);
  // the game trail the chase runs on: reddish earth, trodden, with grass in its middle
  float dz = vW.z - ${'${PATHZ}'};
  float trail = (1.0 - smoothstep(0.7, 1.9 + 0.6 * nB, abs(dz + 0.15))) * (1.0 - 0.45 * fk) * (1.0 - smoothstep(0.0, 6.0, -wx));
  vec3 earth = vec3(0.42, 0.27, 0.15) * (0.7 + 0.5 * nC) * mix(vec3(1.0), vec3(0.85, 0.82, 0.8), fk);
  col = mix(col, earth, trail * (0.55 + 0.3 * smoothstep(0.3, 0.7, nC)) * (1.0 - smoothstep(0.0, 0.35, 0.12 - abs(abs(dz + 0.15) - 0.55)) * 0.5));
  float bank = 1.0 - smoothstep(8.0, 13.5, abs(wx - ${PL.river.toFixed(1)} - 3.0 * sin(vW.z / 19.0)));
  col = mix(col, vec3(0.36, 0.28, 0.18) * (0.6 + 0.8 * nB), bank * 0.9);
  col = mix(col, col * vec3(0.5, 0.48, 0.44), bank * (1.0 - smoothstep(${(PL.water - 0.02).toFixed(2)}, ${(PL.water + 0.14).toFixed(2)}, vW.y)));  // wet at the water's edge
  col *= 0.8 + 0.4 * nA;
  // far hills: forested slopes
  float hill = smoothstep(3.0, 12.0, vW.y - 4.0 * rk) * smoothstep(-40.0, -90.0, vW.z);
  col = mix(col, mix(vec3(0.1, 0.15, 0.06), vec3(0.3, 0.24, 0.12), rk) * (0.7 + 0.6 * nB), hill * 0.85);
  vec3 N = normalize(vN);
  float ndl = max(dot(N, uSunDir), 0.0);
  float sh = animalShadow(vW);
  float dap = mix(1.0, 0.25 + 0.75 * smoothstep(0.4, 0.6, texture2D(uNoise, uv / 26.0 + uSunDir.xz * 0.2).r + 0.25 * texture2D(uNoise, uv / 5.0).b - 0.12), fk);
  vec3 light = uSunCol * ndl * dap * (1.0 - 0.85 * sh) + mix(uAmbGnd, uAmbSky, N.y * 0.5 + 0.5) * (1.0 - 0.3 * sh);
  col *= light;
  gl_FragColor = vec4(applyFog(col, vW), 1.0);${END}
}`;
const GROUND_VERT = /* glsl */`
varying vec3 vW; varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normal; vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
function gridGeo(x0, x1, dx, zs) {
  const nx = Math.round((x1 - x0) / dx) + 1, nz = zs.length, pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * dx, z = zs[j], k = (j * nx + i) * 3, e = 0.5;
    pos[k] = x; pos[k + 1] = baseGround(x, z); pos[k + 2] = z;
    const nxv = baseGround(x - e, z) - baseGround(x + e, z), nzv = baseGround(x, z - e) - baseGround(x, z + e), l = Math.hypot(nxv, 2 * e, nzv);
    nor[k] = nxv / l; nor[k + 1] = 2 * e / l; nor[k + 2] = nzv / l;
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}
// the path's z in GLSL (timeline.js pathZ: S5(4, 34, x)·(1.7 sin(W1 x + 0.4) + 0.6 sin(3 W1 x + 2)), W1 = 2π/P)
const W1 = (2 * Math.PI / PL.P).toFixed(6);
const PATHZ_GLSL = `(s5(4.0, 34.0, vW.x) * (1.7 * sin(${W1} * vW.x + 0.4) + 0.6 * sin(${(3 * 2 * Math.PI / PL.P).toFixed(6)} * vW.x + 2.0)))`;
export function buildGround(tex) {
  const zs = [-430, -350, -280, -225, -180, -145, -118, -96, -78, -64, -54];
  for (let z = -46; z < -20; z += 2) zs.push(z);
  for (let z = -20; z <= 24; z += 1) zs.push(z);
  zs.push(27, 31, 38, 50, 70, 100);
  const uniforms = Object.assign(FOGU(), WORLDU(), { uTexM: { value: tex.grass }, uTexF: { value: tex.litter }, uTexR: { value: tex.rock }, uNoise: U.uNoise,
    uSunCol: U.uSunCol, uAmbSky: U.uAmbSky, uAmbGnd: U.uAmbGnd, uTime: U.uTime, uWarm: U.uWarm });
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG.replace('${PATHZ}', PATHZ_GLSL) });
  const main = new THREE.Mesh(gridGeo(-80, PL.XR, 1, zs), mat); main.frustumCulled = false;
  const tile = new THREE.Mesh(gridGeo(PL.XR, PL.XR + PL.P, 1, zs), mat); tile.frustumCulled = false;
  return { main, tile };
}

// ------------------------------------------------------------------ grass
// One instance = a tuft of three blades. The field is a square round a centre that follows the picture; every
// tuft keeps its own place in the world (wrapped), its height comes from the ground texture's grass factor.
export function buildGrass(count) {
  const blade = [], bidx = [];
  const SEG = 3;
  for (let b = 0; b < 3; b++) {
    const base = blade.length / 4, ang = b * 2.1 + 0.4, ox = Math.cos(ang) * 0.07 * (b ? 1 : 0), oz = Math.sin(ang) * 0.07 * (b ? 1 : 0);
    for (let s = 0; s <= SEG; s++) {
      const y = s / SEG;
      if (s < SEG) { blade.push(-1 + ox * 0, y, b, ox + oz * 10); blade.push(1, y, b, ox + oz * 10); } else blade.push(0, 1, b, ox + oz * 10);
    }
    for (let s = 0; s < SEG - 1; s++) { const a = base + s * 2; bidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const a = base + (SEG - 1) * 2; bidx.push(a, a + 1, a + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(blade.length / 4 * 3), 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 4));
  g.setIndex(bidx);
  const seeds = new Float32Array(count * 4), r = rnd(77);
  for (let i = 0; i < count; i++) { seeds[i * 4] = r(); seeds[i * 4 + 1] = r(); seeds[i * 4 + 2] = r(); seeds[i * 4 + 3] = r(); }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), WORLDU(), { uCenter: { value: new THREE.Vector2() }, uField: { value: 46 }, uTime: U.uTime, uSunCol: U.uSunCol, uAmbSky: U.uAmbSky, uAmbGnd: U.uAmbGnd,
      uAnimA: U.uAnimA, uAnimB: U.uAnimB, uAnimS: U.uAnimS, uWarm: U.uWarm, uNoise: U.uNoise, uWide: { value: 1 } }),
    vertexShader: /* glsl */`
      attribute vec4 aBlade; attribute vec4 aSeed;
      uniform vec2 uCenter; uniform float uField, uTime, uWarm, uWide; uniform vec4 uAnimA, uAnimB, uAnimS; uniform sampler2D uNoise;
      varying vec3 vW; varying vec3 vCol; varying float vY; varying vec3 vBase;
      ${GLSL_WORLD}
      float part(vec2 w, vec4 A, float sp, out vec2 push) { // how much this animal flattens a tuft at w, and which way
        vec2 d = w - A.xy, dir = A.zw; float al = dot(d, dir); vec2 pp = d - dir * al;
        float back = clamp(al, -4.0 * sp - 0.6, 0.9);
        float dd = length(d - dir * back);
        float s = (1.0 - smoothstep(0.28, 0.95, dd)) * (al < 0.0 ? exp(al * 0.45) : 1.0);
        float l = length(pp); push = l > 1e-3 ? pp / l : vec2(-dir.y, dir.x);
        return s;
      }
      void main() {
        float S = uField;
        vec2 w = mod(aSeed.xy * S - uCenter + S * 0.5, S) - S * 0.5 + uCenter;
        vec2 rel = w - uCenter;
        vec4 ht = texture2D(uHT, htUV(w));
        float wx = wrapX(w.x), fk = forestK(wx), rk = ridgeK(wx);
        float g = ht.g;
        float keep = step(aSeed.z * 0.55 + 0.02, g);
        keep *= step(aSeed.w, 1.0 - 0.45 * fk - 0.5 * rk);
        float fade = 1.0 - smoothstep(S * 0.5 - 6.0, S * 0.5 - 1.0, max(abs(rel.x), abs(rel.y)));
        float H = (0.34 + 0.66 * aSeed.z) * (0.3 + 0.72 * g) * mix(1.0, 0.75, rk) * fade * keep;
        vec2 pA, pB; float sA = part(w, uAnimA, uAnimS.x, pA), sB = part(w, uAnimB, uAnimS.y, pB);
        sA *= 1.0 - 0.75 * uAnimS.z;                                    // lying low: the grass stands round the tiger
        float flat_ = max(sA, sB); vec2 push = sA > sB ? pA : pB;
        H *= 1.0 - 0.55 * flat_;
        float b = aBlade.z, y = aBlade.y;
        float yaw = aSeed.w * 6.283 + b * 2.2;
        vec2 fd = vec2(cos(yaw), sin(yaw)), sd = vec2(-fd.y, fd.x);
        vec3 camTo = cameraPosition - vec3(w.x, ht.r, w.y); float cd = length(camTo);
        float width = (0.011 + 0.008 * aSeed.z) * (1.0 + cd * 0.07) * uWide * (1.0 - 0.72 * y);
        float hb = H * (0.75 + 0.25 * fract(aSeed.w * 7.0 + b * 0.37));
        float lean = (0.1 + 0.25 * fract(aSeed.z * 5.0 + b * 0.61)) * hb;
        float gust = texture2D(uNoise, w * 0.012 + vec2(uTime * 0.035, uTime * 0.012)).r;
        float wind = (sin(uTime * 1.9 + w.x * 0.45 + w.y * 0.3 + aSeed.w * 2.0) * 0.5 + (gust - 0.4) * 2.2) * 0.1 * hb;
        vec2 off = sd * (b - 1.0) * 0.06;
        vec2 xz = w + off + sd * aBlade.x * width + fd * lean * y * y + vec2(0.86, 0.5) * wind * y * y + push * flat_ * 0.5 * hb * y;
        vec3 p = vec3(xz.x, ht.r + hb * y * (1.0 - 0.12 * y * abs(wind) / max(hb, 0.05)), xz.y);
        vW = p; vY = y; vBase = vec3(w.x, ht.r, w.y);
        // colour: olive at the root, straw-green tips; drier towards the ridge, greener under the trees
        float n = fract(aSeed.w * 13.0 + aSeed.z * 7.0);
        vec3 root = mix(vec3(0.07, 0.1, 0.025), vec3(0.12, 0.095, 0.035), rk);
        vec3 tip = mix(mix(vec3(0.34, 0.42, 0.09), vec3(0.62, 0.5, 0.16), n), vec3(0.66, 0.5, 0.22), max(rk, 0.3 * n));
        tip = mix(tip, vec3(0.22, 0.34, 0.08), fk * 0.6);
        vCol = mix(root, tip, pow(y, 0.8)) * (0.8 + 0.4 * gust);
        gl_Position = keep * fade > 0.0 ? projectionMatrix * viewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunCol, uAmbSky, uAmbGnd; uniform sampler2D uNoise; uniform float uWarm;
      varying vec3 vW; varying vec3 vCol; varying float vY; varying vec3 vBase;
      ${GLSL_FOG_FULL}
      ${GLSL_WORLD}
      void main() {
        vec3 v = normalize(cameraPosition - vW);
        float back = pow(max(dot(-v, uSunDir), 0.0), 3.0);                 // blades glow against the sun
        float sh = animalShadow(vBase + vec3(0.0, 0.0, 0.0));
        float wx = wrapX(vW.x), fk = forestK(wx);
        float dap = mix(1.0, 0.22 + 0.78 * smoothstep(0.4, 0.6, texture2D(uNoise, vec2(wx, vW.z) / 26.0 + uSunDir.xz * 0.2).r + 0.25 * texture2D(uNoise, vec2(wx, vW.z) / 5.0).b - 0.12), fk);
        float sun = (0.55 + 0.45 * uSunDir.y + 0.9 * back * vY) * dap * (1.0 - 0.8 * sh);
        vec3 col = vCol * (uSunCol * sun + mix(uAmbGnd, uAmbSky, 0.35 + 0.5 * vY) * (0.55 + 0.45 * vY));
        gl_FragColor = vec4(applyFog(col, vW), 1.0);${END}
      }`,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false;
  m.userData.count = count;
  return m;
}

// ------------------------------------------------------------------ trees, bushes, the shrine: photographic cut-outs on camera-facing cards
// flora.webp (one atlas) — rects: u0, v0 (from the top), w, h (0..1), aspect w/h. One instanced draw for a whole set.
const FLORA = {"sal":[0,0,0.15137,0.32568,0.4648],"sal2":[0.1543,0,0.17041,0.32568,0.5232],"banyan":[0.32764,0,0.3833,0.2998,1.2785],"palash":[0.71387,0,0.20898,0.2998,0.6971],"mahua":[0,0.32861,0.22412,0.26563,0.8438],"bamboo":[0.22705,0.32861,0.19824,0.26563,0.7463],"kusum":[0.42822,0.32861,0.25391,0.26563,0.9559],"deadtree":[0.68506,0.32861,0.16504,0.21436,0.7699],"salyoung":[0.85303,0.32861,0.12939,0.21436,0.6036],"lantana":[0,0.59717,0.12793,0.09863,1.297],"elephantgrass":[0.13086,0.59717,0.09766,0.09863,0.9901],"fern":[0.23145,0.59717,0.13086,0.09863,1.3267],"thorn":[0.36523,0.59717,0.13965,0.09863,1.4158],"drygrass":[0.50781,0.59717,0.0918,0.09863,0.9307],"broadleaf":[0.60254,0.59717,0.12939,0.09863,1.3119],"yellowflower":[0.73486,0.59717,0.13428,0.09863,1.3614],"mossrock":[0,0.69873,0.18359,0.09863,1.8614],"ruin":[0.18652,0.69873,0.20313,0.21436,0.9476]};
const SWAY = { bamboo: 1.6, elephantgrass: 2.2, drygrass: 2.0, fern: 1.2, sal: 0.6, sal2: 0.6, salyoung: 1.0, deadtree: 0.1, mossrock: 0, ruin: 0 };
function cardSet(map, list) { // list: [name, x, z, height, tint, flip]
  const n = list.length, P = new Float32Array(n * 4), S = new Float32Array(n * 4), Rr = new Float32Array(n * 4);
  list.forEach((t, i) => {
    const [name, x, z, h, tint, flip] = t, r = FLORA[name];
    P[i * 4] = x; P[i * 4 + 1] = baseGround(x, z) - 0.04 * h; P[i * 4 + 2] = z; P[i * 4 + 3] = (x * 0.37 + z * 0.11) % 1;
    S[i * 4] = h * r[4] * (flip ? -1 : 1); S[i * 4 + 1] = h; S[i * 4 + 2] = tint; S[i * 4 + 3] = SWAY[name] == null ? 0.8 : SWAY[name];
    Rr[i * 4] = r[0]; Rr[i * 4 + 1] = r[1]; Rr[i * 4 + 2] = r[2]; Rr[i * 4 + 3] = r[3];
  });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 4)); g.setAttribute('aS', new THREE.InstancedBufferAttribute(S, 4)); g.setAttribute('aR', new THREE.InstancedBufferAttribute(Rr, 4));
  g.instanceCount = n;
  const m = new THREE.Mesh(g, cardMat(map)); m.frustumCulled = false;
  return m;
}
let CARD_MAT = null;
function cardMat(map) {
  if (CARD_MAT) return CARD_MAT;
  CARD_MAT = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), WORLDU(), { uMap: { value: map }, uTime: U.uTime, uSunCol: U.uSunCol, uAmbSky: U.uAmbSky, uAmbGnd: U.uAmbGnd, uWarm: U.uWarm }),
    vertexShader: /* glsl */`
      attribute vec4 aP, aS, aR; uniform float uTime; varying vec2 vUv; varying vec3 vW; varying float vY, vTint;
      void main() {
        vec3 base = (modelMatrix * vec4(aP.xyz, 1.0)).xyz;
        vec3 to = cameraPosition - base; to.y = 0.0; vec3 fw = normalize(to + vec3(1e-4, 0.0, 0.0)), rt = vec3(fw.z, 0.0, -fw.x);
        float qy = position.y, w = aS.x, h = aS.y * smoothstep(3.0, 5.0, length(to));   // never a plant right in front of the lens
        float sway = (sin(uTime * 1.3 + aP.w * 6.283 + base.x * 0.07) * 0.7 + sin(uTime * 2.1 + aP.w * 17.0) * 0.3) * aS.w * qy * qy * 0.018 * h;
        vec3 p = base + rt * (position.x * w * h / aS.y + sway) + vec3(0.0, qy * h, 0.0) - fw * qy * h * 0.08;   // a slight lean back: less of a flat card
        vUv = vec2(aR.x + (position.x + 0.5) * aR.z, 1.0 - aR.y - aR.w + qy * aR.w);
        vW = p; vY = qy; vTint = aS.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uSunCol, uAmbSky, uAmbGnd; uniform float uWarm; varying vec2 vUv; varying vec3 vW; varying float vY, vTint;
      ${GLSL_FOG_FULL}
      ${GLSL_WORLD}
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float a = clamp((t.a - 0.5) / max(fwidth(t.a), 1e-3) + 0.5, 0.0, 1.0);   // crisp cut-out edges (alpha to coverage)
        if (a < 0.02) discard;
        float wx = wrapX(vW.x), fk = forestK(wx);
        vec3 col = t.rgb * vTint;
        col = mix(col, col * vec3(1.06, 0.98, 0.86), uWarm * 0.6);
        float ao = mix(0.55, 1.0, smoothstep(0.0, 0.35, vY));                     // darker low in the foliage
        vec3 light = (uSunCol * 0.5 * mix(1.0, 0.75, fk) + mix(uAmbGnd, uAmbSky, 0.55) * 0.75) * ao * (1.0 - 0.6 * animalShadow(vW));
        gl_FragColor = vec4(applyFog(col * light, vW), a);${END}
      }`,
    alphaToCoverage: true, side: THREE.DoubleSide,
  });
  return CARD_MAT;
}
// Where everything stands. dz = z − path: the lane (|dz| < 3.5) stays clear; on the camera's side (dz > 0) only low
// plants, so nothing tall ever comes between the camera and the animals; tall trees stand on the far side.
export function buildFlora(tex, rich) {
  const r = rnd(1234), main = [], tile = [], lowM = [], lowT = [];   // low*: the small plants (a leaner quality step draws part of them)
  const dzOf = (x, z) => z - pathZ(x);
  const pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const near = (list, x, z, d) => list.some((t) => Math.hypot(t[1] - x, t[2] - z) < d);
  const tint = () => 0.86 + 0.22 * r();
  // --- the meadow (x < 92): lone big trees, a ruined shrine, flowering bushes, tall grass clumps
  const meadowTrees = ['banyan', 'mahua', 'palash', 'kusum', 'banyan', 'palash', 'mahua'];
  for (let i = 0; i < 900 && main.length < 34; i++) {
    const x = -70 + r() * 165, z = -12 - r() * 70, dz = dzOf(x, z);
    if (dz > -10 || near(main, x, z, 13)) continue;
    main.push([pick(meadowTrees), x, z, 9 + r() * 7, tint(), r() < 0.5]);
  }
  main.push(['ruin', 52, pathZ(52) - 15, 7.2, 1.0, false]);
  main.push(['banyan', 58, pathZ(58) - 21, 15, 0.95, true]);
  // --- the sal forest (92–208): tall sal, young sal, bamboo; ferns and broad leaves on the floor
  for (let i = 0; i < 3000 && main.length < (rich ? 260 : 200); i++) {
    const x = 84 + r() * 128, z = -6 - r() * 90, dz = dzOf(x, z);
    const edge = Math.min(1, (x - 84) / 18, (210 - x) / 10);
    if (dz > -5 || r() > edge || riverDist(x, z) < 14 || near(main, x, z, 3.6)) continue;
    const k = r();
    main.push([k < 0.42 ? 'sal' : k < 0.78 ? 'sal2' : k < 0.9 ? 'salyoung' : 'bamboo', x, z, k < 0.78 ? 17 + r() * 8 : k < 0.9 ? 9 + r() * 4 : 8 + r() * 3, tint(), r() < 0.5]);
  }
  // --- the far tree line, all along (it hides the ground's end and joins the painted horizon)
  for (let x = -80; x < PL.XR; x += 6 + r() * 6) for (let row = 0; row < 2; row++) {
    const z = -150 - row * 45 - r() * 30, rk = x > 236 ? 1 : 0;
    main.push([rk ? pick(['kusum', 'deadtree', 'mahua']) : pick(['sal', 'sal2', 'mahua', 'banyan', 'kusum']), x, z, 12 + r() * 7, 0.85 + 0.15 * r(), r() < 0.5]);
  }
  // --- low plants along the lane, both sides (camera side: low only, and not right in front of the animals).
  const low = ['lantana', 'elephantgrass', 'yellowflower', 'broadleaf', 'thorn', 'drygrass', 'lantana', 'elephantgrass'];
  const forestLow = ['fern', 'broadleaf', 'fern', 'thorn'];
  for (let i = 0; i < 5000; i++) {
    const x = -40 + r() * (PL.XR + 40), dz = r() < 0.55 ? -(3.6 + r() * 22) : 4.0 + r() * 14, z = pathZ(x) + dz;
    if (riverDist(x, z) < 9.5 || (x > 236)) continue;
    if (near(main, x, z, 2.2) || near(lowM, x, z, 2.2)) continue;
    const fk = x > 90 && x < 206;
    const name = fk ? pick(forestLow) : pick(low);
    const h = (dz > 0 ? 0.55 + 0.45 * r() : 0.7 + 0.9 * r()) * (name === 'elephantgrass' ? 1.6 : 1);
    lowM.push([name, x, z, h, tint(), r() < 0.5]);
    if (main.length + lowM.length > (rich ? 1150 : 850)) break;
  }
  // --- the ridge tile (repeats every P): dry trees, mossy rocks, dry grass clumps
  for (let i = 0; i < 1200 && tile.length < 40; i++) {
    const x = PL.XR + r() * PL.P, z = -10 - r() * 70, dz = dzOf(x, z);
    if (dz > -6 || near(tile, x, z, 8)) continue;
    tile.push([pick(['kusum', 'deadtree', 'palash', 'mahua', 'deadtree']), x, z, 7 + r() * 6, tint(), r() < 0.5]);
  }
  for (let x = PL.XR; x < PL.XR + PL.P; x += 6 + r() * 6) tile.push([pick(['kusum', 'deadtree', 'mahua', 'palash']), x, -150 - r() * 60, 11 + r() * 6, 0.85 + 0.15 * r(), r() < 0.5]);
  for (let i = 0; i < 2000 && tile.length + lowT.length < 200; i++) {
    const x = PL.XR + r() * PL.P, dz = r() < 0.55 ? -(3.6 + r() * 20) : 4.0 + r() * 12, z = pathZ(x) + dz;
    if (near(tile, x, z, 2.0) || near(lowT, x, z, 2.0)) continue;
    const name = pick(['drygrass', 'drygrass', 'thorn', 'mossrock', 'elephantgrass', 'lantana']);
    lowT.push([name, x, z, (dz > 0 ? 0.55 + 0.4 * r() : 0.7 + 0.8 * r()) * (name === 'mossrock' ? 0.9 : 1), tint(), r() < 0.5]);
  }
  // mossy boulders by the river and on the ridge (off the lane)
  for (let i = 0; i < 400; i++) {
    const z = -30 + r() * 40, side = r() < 0.5 ? -1 : 1, x = PL.river + 3 * Math.sin(z / 19) + side * (8.6 + r() * 5), dz = dzOf(x, z);
    if (dz > -3.4 && dz < 3.4) continue;
    main.push(['mossrock', x, z, dz > 0 ? 0.45 + 0.3 * r() : 0.6 + 1.0 * r(), tint(), r() < 0.5]);
    if (i > 40) break;
  }
  for (let i = 0; i < 600; i++) {
    const x = PL.XR + r() * PL.P, z = pathZ(x) - 4 - r() * 50;
    if (near(tile, x, z, 3) || near(lowT, x, z, 3)) continue;
    tile.push(['mossrock', x, z, 0.6 + r() * r() * 2.4, 0.85 + 0.2 * r(), r() < 0.5]);
    if (i > 70) break;
  }
  const gMain = new THREE.Group(), gTile = new THREE.Group(), cm = cardSet(tex.flora, main.concat(lowM)), ct = cardSet(tex.flora, tile.concat(lowT));
  gMain.add(cm); gTile.add(ct);
  // k: 0..1 — the share of the small plants drawn (the quality ladder; the trees always)
  function setDensity(k) { cm.geometry.instanceCount = main.length + Math.round(lowM.length * k); ct.geometry.instanceCount = tile.length + Math.round(lowT.length * k); }
  return { main: gMain, tile: gTile, cards: main.length + tile.length + lowM.length + lowT.length, setDensity };
}

// ------------------------------------------------------------------ the river
export function buildWater() {
  const pos = [], dep = [], idx = [], X0 = PL.river - 16, NX = 33, NZ = 60, Z0 = -230;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const z = Z0 + j * 5, x = X0 + i + 3 * Math.sin(z / 19);
    pos.push(x, PL.water, z); dep.push(PL.water - baseGround(x, z));
  }
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1)); g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), WORLDU(), { uNoise: U.uNoise, uTime: U.uTime, uSunCol: U.uSunCol, uAnimA: U.uAnimA, uAnimB: U.uAnimB }),
    vertexShader: 'attribute float aDepth; varying vec3 vW; varying float vD; void main(){ vW = position; vD = aDepth; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunCol; uniform vec4 uAnimA, uAnimB;
      varying vec3 vW; varying float vD;
      ${GLSL_SKY}
      ${GLSL_FOG}
      ${GLSL_WORLD}
      void main() {
        if (vD < 0.0) discard;
        vec2 uv = vW.xz;
        vec2 f1 = uv * 0.21 + vec2(0.0, uTime * 0.16), f2 = uv * 0.5 + vec2(0.3, uTime * 0.29);
        vec2 n = (texture2D(uNoise, f1).rg - 0.5) * 0.9 + (texture2D(uNoise, f2).gb - 0.5) * 0.6;
        // rings round the animals' legs
        vec2 da = uv - uAnimA.xy, db = uv - uAnimB.xy; float la = length(da), lb = length(db);
        n += da / max(la, 0.05) * sin(la * 9.0 - uTime * 11.0) * exp(-la * 0.9) * 0.5 + db / max(lb, 0.05) * sin(lb * 10.0 - uTime * 11.0) * exp(-lb * 1.0) * 0.4;
        vec3 N = normalize(vec3(n.x * 0.22, 1.0, n.y * 0.22));
        vec3 v = normalize(cameraPosition - vW), rf = reflect(-v, N);
        float fr = 0.04 + 0.96 * pow(1.0 - max(dot(v, N), 0.0), 5.0);
        vec3 sky = skyColor(normalize(vec3(rf.x, abs(rf.y) + 0.02, rf.z)));
        float glit = pow(max(dot(rf, uSunDir), 0.0), 180.0);
        vec3 bed = mix(vec3(0.22, 0.2, 0.12), vec3(0.04, 0.11, 0.1), smoothstep(0.0, 0.3, vD)) * (uSunCol * 0.7 + 0.25);
        vec3 col = mix(bed, sky * vec3(0.8, 0.9, 0.95), clamp(fr * 0.9 + 0.08, 0.0, 0.85)) + uSunCol * glit * 6.0;
        float foam = smoothstep(0.035, 0.0, vD + (n.x) * 0.02) * 0.5;
        col = mix(col, vec3(0.9, 0.86, 0.78) * (uSunCol * 0.6 + 0.3), foam);
        col *= 1.0 - 0.55 * animalShadow(vW);
        float a = smoothstep(0.0, 0.05, vD);
        gl_FragColor = vec4(applyFog(col, vW), a);${END}
      }`,
    transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 2;
  return m;
}

// ------------------------------------------------------------------ dust, splashes, the catch's cloud and grass bits (camera-facing soft puffs)
// kinds: 0 a footfall's dust, 1 water, 2 the big cloud of the catch (rolls out and hangs ~2 s), 3 bits of grass and earth (flung)
export function buildPuffs(max) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const data = new Float32Array(max * 6);
  const ib = new THREE.InstancedInterleavedBuffer(data, 6); ib.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aP', new THREE.InterleavedBufferAttribute(ib, 4, 0)); g.setAttribute('aK', new THREE.InterleavedBufferAttribute(ib, 2, 4));
  g.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), { uNoise: U.uNoise, uSunCol: U.uSunCol, uAmbSky: U.uAmbSky, uDust: { value: new THREE.Color(0.56, 0.45, 0.32) } }),
    vertexShader: /* glsl */`
      attribute vec4 aP; attribute vec2 aK; varying vec2 vUv; varying float vA; varying float vKind; varying vec3 vW; varying float vSeed;
      float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
      void main() {
        float age = aP.w, kind = aK.x, sz = aK.y;
        vec3 c = aP.xyz; float r = 0.1, a = 0.0; vec2 stretch = vec2(1.0);
        if (kind < 0.5) {               // a footfall: a low puff that drifts back
          float u = clamp(age / 1.25, 0.0, 1.0); r = sz * (0.14 + 0.62 * sqrt(u));
          c += vec3(-0.25 * u, 0.1 + 0.45 * u * sz, 0.0); a = (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.06, u) * 0.5; stretch = vec2(1.0, 0.8);
        } else if (kind < 1.5) {        // water
          float u = clamp(age / 0.55, 0.0, 1.0); r = sz * (0.12 + 0.5 * u);
          c.y += (1.5 * u - 2.6 * u * u) * 0.9 * sz + 0.05; a = (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.06, u) * 0.85; stretch = vec2(1.0, 1.5);
        } else if (kind < 2.5) {        // the catch's cloud: bursts out fast, then hangs and thins
          float grow = 1.0 - exp(-age * 6.0);
          r = sz * (0.3 + 0.5 * grow + 0.12 * age);
          float ang = sz * 9.1 + aP.x * 3.0;
          c += vec3(cos(ang) * 1.1, 0.0, sin(ang) * 0.5) * grow * 0.7 + vec3(0.0, 0.25 + 0.6 * r * 0.6 + 0.15 * age, 0.0);
          a = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.2, 1.25, age)) * 0.8; stretch = vec2(1.2, 0.8);
        } else {                        // a bit of grass / earth: flung, falling, tumbling
          float n = sz, vx = (h1(n) - 0.5) * 6.0, vz = (h1(n + 3.1) - 0.5) * 3.0 + 1.0, vy = 1.8 + 2.6 * h1(n + 7.7);
          float t = min(age, 1.4);
          c += vec3(vx * t + 2.0 * t, max(-c.y + aP.y, vy * t - 4.9 * t * t), vz * t);
          r = 0.045 + 0.05 * h1(n + 1.3); a = smoothstep(0.0, 0.02, age) * (1.0 - smoothstep(0.9, 1.3, age));
          float rot = age * (6.0 + 8.0 * h1(n + 5.0)); stretch = vec2(abs(cos(rot)) * 1.6 + 0.3, 0.45);
        }
        vec4 mv = viewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * r * stretch;
        vUv = position.xy; vKind = kind; vSeed = sz * 7.3 + aP.x;
        vA = a; vW = c;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform vec3 uSunCol, uAmbSky, uDust; varying vec2 vUv; varying float vA; varying float vKind; varying vec3 vW; varying float vSeed;
      ${GLSL_FOG_FULL}
      void main() {
        float d = length(vUv);
        vec3 lit = uSunCol * 0.75 + uAmbSky * 0.9;
        if (vKind > 2.5) {             // a grass bit: a solid little blade / clod
          float a = smoothstep(1.0, 0.7, d) * vA; if (a < 0.05) discard;
          vec3 col = mix(vec3(0.2, 0.26, 0.07), vec3(0.3, 0.2, 0.1), step(0.6, fract(vSeed * 3.7))) * lit;
          gl_FragColor = vec4(applyFog(col, vW), a); ${END} return;
        }
        float n = texture2D(uNoise, vUv * 0.23 + vSeed * 0.071).r, n2 = texture2D(uNoise, vUv * 0.6 + vSeed * 0.13).g;
        float a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.7) * vA;
        if (vKind > 0.5 && vKind < 1.5) a *= smoothstep(0.35, 0.6, texture2D(uNoise, vUv * vec2(0.9, 0.35) + vSeed * 0.13).g + 0.25 * (1.0 - d));   // spray: broken into drops
        float shade = vKind > 1.5 ? 0.72 + 0.4 * n2 + 0.25 * vUv.y : 1.0;      // the cloud: lit top, billowy
        vec3 col = mix(uDust, vec3(0.92, 0.95, 1.0), vKind > 0.5 && vKind < 1.5 ? 1.0 : 0.0) * lit * shade;
        gl_FragColor = vec4(applyFog(col, vW), a);${END}
      }`,
    transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 5;
  m.userData.data = data; m.userData.buf = ib;
  return m;
}

// ------------------------------------------------------------------ light shafts under the sal trees
export function buildShafts() {
  const r = rnd(99), pos = [], uv = [], idx = [];
  for (let i = 0; i < 16; i++) {
    const x = 100 + r() * 96, z = -6 - r() * 26, w = 1.2 + r() * 2.2, h = 15, y = baseGround(x, z), b = pos.length / 3;
    pos.push(x - w, y, z, x + w, y, z, x + w, y + h, z, x - w, y + h, z); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), { uSunCol: U.uSunCol, uNoise: U.uNoise }),
    vertexShader: /* glsl */`uniform vec3 uSunDir; varying vec2 vUv; varying vec3 vW;
      void main(){ vUv = uv; vec3 p = position; float up = uv.y * 15.0; p.xz += uSunDir.xz / max(uSunDir.y, 0.2) * up * 0.55; vW = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uSunCol; uniform sampler2D uNoise; varying vec2 vUv; varying vec3 vW;
      ${GLSL_FOG_FULL}
      void main(){
        float e = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float st = 0.55 + 0.45 * texture2D(uNoise, vec2(vUv.x * 0.6 + vW.x * 0.05, 0.3)).r;
        float a = e * st * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.45, vUv.y) * 0.16 * (1.0 - fogAmount(vW));
        gl_FragColor = vec4(uSunCol * 1.1, a);${END}
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 4;
  return m;
}

// ------------------------------------------------------------------ NEXORNG way-stones (the real NX mark)
export function buildStones(nxTex, withFogFn) {
  const stone = new THREE.BoxGeometry(0.34, 1.05, 0.2); stone.translate(0, 0.525, 0);
  const cap = new THREE.BoxGeometry(0.36, 0.16, 0.22); cap.translate(0, 1.05, 0);
  const plate = new THREE.PlaneGeometry(0.29, 0.29); plate.translate(0, 0.78, 0.102);
  const mS = withFogFn(new THREE.MeshLambertMaterial({ color: 0xe9e2d0 })), mC = withFogFn(new THREE.MeshLambertMaterial({ color: 0xd9a52c }));
  const mP = withFogFn(new THREE.MeshLambertMaterial({ map: nxTex, transparent: true, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -2 }));
  const make = (x, dz, ry) => {
    const g = new THREE.Group(), z = pathZ(x) + dz;
    g.add(new THREE.Mesh(stone, mS), new THREE.Mesh(cap, mC), new THREE.Mesh(plate, mP));
    g.position.set(x, baseGround(x, z) - 0.06, z); g.rotation.y = ry;
    return g;
  };
  const main = new THREE.Group(), tile = new THREE.Group();
  main.add(make(6.4, -2.6, -0.55), make(74, -3.2, -0.5), make(204, -3.6, -0.5), make(250, -3.4, -0.5));
  tile.add(make(PL.XR + 30, -3.6, -0.5), make(PL.XR + 90, -3.8, -0.5));
  return { main, tile };
}
