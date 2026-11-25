/* Baaz 3D — the world in bright daylight (never night): the sky (a high sun, the sun's disc), the dunes (static
 * mesh of timeline.groundAt with wind ripples and sun shadows baked per vertex), the oasis (water fading into
 * its shallows, palms, reeds), the canyon cliffs (layered sandstone along the flight path, a photo texture),
 * the clouds (photographed cumulus sprites, lit and sorted back-to-front) and the cloud sea, and the dip (a
 * soft veil for the way home). The falconer and the falcon are Meshy characters (falconer.js, falcon.js). */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { U, GLSL_SKY, GLSL_FOG, GLSL_FOG_FULL, withFog } from './common.js';
import { groundAt, pathPoint, OASIS, SEA, S5 } from './timeline.js';

const D2R = Math.PI / 180;
function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
const FOGU = () => ({ uSunDir: U.uSunDir, uZenith: U.uZenith, uHorizon: U.uHorizon, uGlow: U.uGlow, uGround: U.uGround, uFogSun: U.uFogSun, uFogDen: U.uFogDen, uFogH: U.uFogH, uMist: U.uMist, uMistCol: U.uMistCol });

// ------------------------------------------------------------------ sky (sunrise → golden dusk; never night)
export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), { uSunCol: U.uSunCol, uVeil: U.uVeil }),
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uSunCol; uniform float uVeil; varying vec3 vDir;
      ${GLSL_SKY}
      ${GLSL_FOG}
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float sd = max(dot(d, uSunDir), 0.0);
        c += uSunCol * smoothstep(0.99985, 0.99993, sd) * 22.0 * smoothstep(-0.02, 0.01, d.y); // the sun's disc
        c = mix(c, fogColor(cameraPosition + d), uVeil); // crossing the cloud sea's top: the same mist as the sea's
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ------------------------------------------------------------------ dunes
// The flight area (a fine grid) + the far desert (a coarse ring, a little lower, under it).
export function buildDunes(tier, tex, bakeSun) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), {
      uSunCol: U.uSunCol, uAmbSky: U.uAmbSky, uAmbGnd: U.uAmbGnd, uTime: U.uTime,
      uSandC: { value: tex.sandC }, uSandN: { value: tex.sandN }, uNoise: U.uNoise,
      uOasis: { value: new THREE.Vector3(OASIS[0], 0, OASIS[2]) }, uVis: { value: 1 },
    }),
    vertexShader: `
      attribute float aSh;
      varying vec3 vW; varying vec3 vN; varying float vSh;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vSh = aSh; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uSunCol; uniform vec3 uAmbSky; uniform vec3 uAmbGnd; uniform sampler2D uSandC; uniform sampler2D uSandN; uniform sampler2D uNoise; uniform vec3 uOasis; uniform float uVis;
      varying vec3 vW; varying vec3 vN; varying float vSh;
      ${GLSL_FOG_FULL}
      void main() {
        if (uVis < 0.002) discard;
        vec3 n = normalize(vN);
        float dist = length(vW - cameraPosition);
        // detail: the sand photo at two scales + large tone variation
        vec3 s1 = texture2D(uSandC, vW.xz / 1.8).rgb, s2 = texture2D(uSandC, vW.xz / 9.0 + 0.3).rgb;
        vec4 nz = texture2D(uNoise, vW.xz / 600.0);
        vec3 base = vec3(0.68, 0.47, 0.28);
        vec3 alb = base * mix(vec3(1.0), (s1 * 0.6 + s2 * 0.4) / 0.42, 0.55 * exp(-dist / 120.0) + 0.15);
        alb *= 0.88 + 0.24 * nz.r;
        // wind ripples (close up) + the sand photo's relief
        float near = exp(-dist / 30.0);
        vec2 rw = vec2(dot(vW.xz, vec2(0.866, 0.5)), dot(vW.xz, vec2(-0.5, 0.866)));
        float ph = rw.x / 0.32 + 0.6 * sin(rw.y / 1.3) + 1.2 * nz.g;
        float rip = cos(ph * 6.2832);
        vec3 tn = texture2D(uSandN, vW.xz / 1.8).xyz * 2.0 - 1.0;
        vec3 pert = vec3(0.866, 0.0, 0.5) * rip * 0.15 * near + vec3(tn.x, 0.0, tn.y) * 0.25 * exp(-dist / 20.0);
        n = normalize(n - pert * (1.0 - abs(n.y - 1.0)));
        // the oasis: damp dark sand and a green fringe
        float dO = length(vW.xz - uOasis.xz);
        alb = mix(alb, alb * vec3(0.55, 0.5, 0.42), smoothstep(30.0, 22.0, dO));
        alb = mix(alb, vec3(0.3, 0.32, 0.14), smoothstep(26.0, 23.0, dO) * smoothstep(18.0, 20.5, dO) * smoothstep(0.45, 0.7, nz.b) * 0.8);
        float nl = dot(n, uSunDir);
        float lit = smoothstep(-0.03, 0.12, nl) * max(nl, 0.0) * 1.0 + 0.0;
        lit *= vSh;
        vec3 amb = mix(uAmbGnd, uAmbSky, n.y * 0.5 + 0.5);
        vec3 V = normalize(cameraPosition - vW);
        float sheen = pow(max(dot(reflect(-uSunDir, n), V), 0.0), 18.0) * 0.18 * vSh;
        vec3 col = alb * (uSunCol * lit + amb) + uSunCol * sheen;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  function grid(x0, x1, z0, z1, nx, nz, drop, warp) {
    const g = new THREE.BufferGeometry(), P = [], I = [], SH = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      let u = i / nx, v = j / nz;
      if (warp) { u = 0.5 + 0.5 * Math.sign(u - 0.5) * Math.pow(Math.abs(2 * u - 1), warp); v = 0.5 + 0.5 * Math.sign(v - 0.5) * Math.pow(Math.abs(2 * v - 1), warp); }
      const x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * v;
      P.push(x, groundAt(x, z) - drop, z);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + nx + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
    // long shadows: march towards the (sunrise) sun over the height field, per vertex
    const pos = g.attributes.position;
    const sx = bakeSun.x, sy = bakeSun.y, sz = bakeSun.z, hl = Math.hypot(sx, sz), dx = sx / hl, dz = sz / hl, slope = sy / hl;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k), y = pos.getY(k) + drop + 0.25;
      let sh = 1;
      for (let s = 1; s <= 34; s++) {
        const d = s * s * 0.35 + s * 2.0;
        const hgt = groundAt(x + dx * d, z + dz * d) - (y + slope * d);
        if (hgt > 0) { sh = Math.min(sh, 1 - Math.min(1, hgt / (0.6 + d * 0.03))); if (sh <= 0) break; }
      }
      SH.push(Math.max(0, sh));
    }
    g.setAttribute('aSh', new THREE.Float32BufferAttribute(SH, 1));
    return g;
  }
  const n = tier === 0 ? 120 : tier === 1 ? 170 : 210;
  const fine = new THREE.Mesh(grid(-260, 660, -470, 250, n, Math.round(n * 0.78), 0, 0), mat);
  const far = new THREE.Mesh(grid(-5200, 5800, -5600, 5200, 90, 90, 2.5, 2.2), mat);
  fine.frustumCulled = false; far.frustumCulled = false;
  group.add(far, fine);
  group.userData.mat = mat;
  return group;
}

// ------------------------------------------------------------------ the oasis: water, palms, reeds
function canvasTex(w, h, draw, srgb) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
  return t;
}
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function buildOasis(tier) {
  const group = new THREE.Group();
  const gy = groundAt(OASIS[0], OASIS[2]);
  // water: an irregular pool
  // (rings: the shore fades into the damp sand)
  const N = 96, RINGS = [0, 0.2, 0.38, 0.52, 0.64, 0.74, 0.82, 0.89, 0.95, 1], P = [], E = [], I = [];
  for (let k = 0; k < RINGS.length; k++) for (let i = 0; i < N; i++) {
    const a = i / N * 2 * Math.PI, r = (19 + 2.4 * Math.sin(a * 2 + 1) + 1.2 * Math.sin(a * 5 + 2) + 0.6 * Math.sin(a * 11)) * RINGS[k];
    const x = OASIS[0] + Math.cos(a) * r * 1.25, z = OASIS[2] + Math.sin(a) * r;
    P.push(x, Math.max(gy + 0.12, groundAt(x, z) + 0.1), z); E.push(RINGS[k]); // (the shore lies on the sand)
  }
  for (let k = 0; k < RINGS.length - 1; k++) for (let i = 0; i < N; i++) { const a = k * N + i, b = k * N + (i + 1) % N, c = a + N, d = b + N; I.push(a, b, c, b, d, c); }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); wg.setAttribute('aE', new THREE.Float32BufferAttribute(E, 1)); wg.setIndex(I);
  const water = new THREE.Mesh(wg, new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), { uNoise: U.uNoise, uTime: U.uTime, uSunCol: U.uSunCol }),
    vertexShader: 'attribute float aE; varying float vE; varying vec3 vW; void main(){ vE = aE; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunCol; varying vec3 vW; varying float vE;
      ${GLSL_SKY}
      ${GLSL_FOG}
      void main() {
        vec2 p = vW.xz;
        float a = texture2D(uNoise, p / 23.0 + vec2(uTime * 0.004, 0.0)).g, b = texture2D(uNoise, p / 9.0 - vec2(0.0, uTime * 0.006)).b;
        vec3 n = normalize(vec3((a - 0.5) * 0.3 + (b - 0.5) * 0.2, 1.0, (b - 0.5) * 0.3 + (a - 0.5) * 0.1));
        vec3 V = normalize(vW - cameraPosition);
        vec3 r = reflect(V, n); r.y = abs(r.y);
        float fr = 0.03 + 0.97 * pow(1.0 - max(dot(-V, n), 0.0), 5.0);
        vec3 deep = vec3(0.02, 0.11, 0.13);
        deep = mix(deep, vec3(0.22, 0.3, 0.2), smoothstep(0.35, 0.9, vE));          // shallows
        vec3 col = mix(deep, skyColor(r) * 0.85, max(fr, 0.22)) + uSunCol * pow(max(dot(r, uSunDir), 0.0), 220.0) * 4.0;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0 - smoothstep(0.6, 1.0, vE));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  }));
  water.renderOrder = 1;
  group.add(water);

  // palms: curved, ringed trunks + crowns of drooping fronds (one geometry each, instanced)
  const frondTex = canvasTex(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) { // leaflets along the rib, both sides, drooping towards the tip
      const u = 0.05 + i / 46 * 0.93, x = u * w, len = h * 0.48 * Math.sin(Math.PI * Math.min(1, u * 1.15)) + 3;
      g.strokeStyle = `rgb(${46 + (i % 3) * 6},${78 + (i % 5) * 5},${30 + (i % 4) * 3})`; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x + len * 0.55, h / 2 - len); g.stroke();
      g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x + len * 0.55, h / 2 + len); g.stroke();
    }
    g.strokeStyle = '#6b6a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  const trunkTex = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#5a4632'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 7) { g.fillStyle = 'rgba(30,20,12,0.55)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(140,110,80,0.25)'; g.fillRect(0, y + 3, w, 2); }
  });
  trunkTex.wrapS = trunkTex.wrapT = THREE.RepeatWrapping;
  const trunkG = new THREE.CylinderGeometry(0.17, 0.26, 1, 7, 10, true); trunkG.translate(0, 0.5, 0);
  { const p = trunkG.attributes.position, uv = trunkG.attributes.uv; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + 0.9 * y * y); uv.setY(i, y * 4); } }
  trunkG.scale(1, 9, 1); trunkG.computeVertexNormals();
  const crownG = (() => {
    const P = [], UV = [], I = []; const top = [0.9 * 1 * 1, 9, 0];
    for (let f = 0; f < 13; f++) {
      const az = f / 13 * Math.PI * 2 + (f % 2) * 0.2, up = (f % 3 === 0 ? 0.35 : f % 3 === 1 ? 0.0 : -0.3);
      const L = 3.6 + (f % 4) * 0.35, base = P.length / 3;
      for (let s = 0; s <= 6; s++) {
        const u = s / 6, out = L * u, droop = -L * 0.55 * u * u + up * L * u;
        const cx = top[0] + Math.cos(az) * out, cy = top[1] + droop, cz = top[2] + Math.sin(az) * out;
        const wv = 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.1)) + 0.08, sxv = -Math.sin(az) * wv, szv = Math.cos(az) * wv;
        P.push(cx + sxv, cy, cz + szv, cx - sxv, cy, cz - szv); UV.push(u, 0, u, 1);
      }
      for (let s = 0; s < 6; s++) { const a = base + s * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals();
    return g;
  })();
  const R = rnd(7), palms = [];
  for (let i = 0; i < 24; i++) {
    const a = R() * Math.PI * 2, r = 22 + R() * 12;
    const x = OASIS[0] + Math.cos(a) * r * 1.25, z = OASIS[2] + Math.sin(a) * r;
    palms.push([x, groundAt(x, z) - 0.2, z, R() * Math.PI * 2, 0.75 + R() * 0.5]);
  }
  const trunks = new THREE.InstancedMesh(trunkG, withFog(new THREE.MeshStandardMaterial({ map: trunkTex, roughness: 0.95 }), 'trunk'), palms.length);
  const crowns = new THREE.InstancedMesh(crownG, withFog(new THREE.MeshStandardMaterial({ map: frondTex, roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true }), 'frond'), palms.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  palms.forEach((p, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p[3]); sc.setScalar(p[4]); ps.set(p[0], p[1], p[2]); m4.compose(ps, q, sc); trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4); });
  group.add(trunks, crowns);
  // reeds / grass tufts round the water and a few desert shrubs (crossed cards)
  const tuftTex = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const x = w * (0.2 + 0.6 * (i / 26)), l = h * (0.5 + 0.45 * ((i * 37) % 11) / 11); g.strokeStyle = `rgb(${70 + (i % 4) * 12},${92 + (i % 3) * 10},${38})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(w / 2, h); g.quadraticCurveTo(x, h - l * 0.6, x + (x - w / 2) * 0.5, h - l); g.stroke(); }
  });
  const tg = new THREE.PlaneGeometry(1, 1, 1, 1); tg.translate(0, 0.5, 0);
  const tg2 = tg.clone().rotateY(Math.PI / 2);
  const tuftG = mergeGeos([tg, tg2]);
  const nT = tier === 0 ? 90 : 220, tufts = new THREE.InstancedMesh(tuftG, withFog(new THREE.MeshStandardMaterial({ map: tuftTex, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.4, alphaToCoverage: true }), 'tuft'), nT);
  for (let i = 0; i < nT; i++) {
    const shrub = i > nT * 0.6;
    const a = R() * Math.PI * 2, r = shrub ? 40 + R() * 420 : 19 + R() * 9;
    const x = shrub ? -100 + R() * 650 : OASIS[0] + Math.cos(a) * r * 1.25, z = shrub ? -380 + R() * 500 : OASIS[2] + Math.sin(a) * r;
    if (shrub && Math.hypot(x, z) < 12) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 3); sc.set(shrub ? 1.3 : 1.6, (shrub ? 0.8 : 1.5) * (0.6 + R() * 0.7), shrub ? 1.3 : 1.6);
    ps.set(x, groundAt(x, z) - 0.05, z); m4.compose(ps, q, sc); tufts.setMatrixAt(i, m4);
  }
  group.add(tufts);
  [trunks, crowns, tufts].forEach((o) => { o.frustumCulled = false; });
  return group;
}
function mergeGeos(list) {
  const P = [], N = [], UV = [], I = []; let off = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); UV.push(uv.getX(i), uv.getY(i)); }
    const ix = g.index.array; for (let i = 0; i < ix.length; i++) I.push(ix[i] + off);
    off += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
  return g;
}

// ------------------------------------------------------------------ the canyon: layered sandstone walls along the flight
function fn(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vn2(x, y) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy); const a = fn(ix, iy), b = fn(ix + 1, iy), c = fn(ix, iy + 1), d = fn(ix + 1, iy + 1); return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy; }
function fbm2(x, y, o) { let s = 0, a = 0.5, n = 0; for (let i = 0; i < o; i++) { s += a * vn2(x, y); n += a; x *= 2.03; y *= 2.03; a *= 0.5; } return s / n; }
export const CANYON = { t0: 12.0, t1: 36, rim: 96 };
export function buildCanyon(tier, tex) {
  const T0 = CANYON.t0, T1 = CANYON.t1, DT = tier === 0 ? 0.16 : 0.09;
  const NV = tier === 0 ? 22 : 34, EXTRA = 5, R = NV + 1 + EXTRA, P = [], UV = [], CO = [], I = [];
  const pt = {};
  for (const side of [1, -1]) {
    const base = P.length / 3; let arc = 0, prev = null, cols = 0;
    for (let t = T0; t <= T1 + 1e-6; t += DT) {
      pathPoint(t, pt);
      const nx = -Math.sin(pt.psi) * side, nz = Math.cos(pt.psi) * side; // outward
      const hw = 40 + 9 * Math.sin(t * 0.55 + 0.7) + 5 * Math.sin(t * 1.7);
      const rise = S5(T0, T0 + 3.5, t);
      const rim = CANYON.rim * (0.12 + 0.88 * rise) + 8 * Math.sin(t * 0.9) * rise;
      const cx = pt.x + nx * hw, cz = pt.z + nz * hw;
      if (prev) arc += Math.hypot(cx - prev[0], cz - prev[1]);
      prev = [cx, cz];
      const gy = groundAt(cx, cz) - 6;
      // the cross-section: the cliff face (sandstone ledges every ~8 m), the mesa top, the outer slope
      for (let j = 0; j < R; j++) {
        let off, y, ao;
        if (j <= NV) {
          const v = j / NV; y = gy + (rim - gy) * v;
          const layer = (((y / 8.3) % 1) + 1) % 1, ledge = (layer < 0.2 ? layer / 0.2 : 1 - (layer - 0.2) / 0.8);
          off = 9 * (fbm2(arc / 38, y / 45 + side * 7, 3) - 0.5) + 2.2 * ledge + 1.4 * (fbm2(arc / 7, y / 6, 2) - 0.5) - (1 - v) * 4 - v * v * 6;
          ao = 0.55 + 0.45 * Math.min(1, (y - gy) / 25) * (0.75 + 0.25 * ledge);
        } else {
          const k = j - NV, o = [5, 26, 48, 62, 84][k - 1], dy = [0.5, 1.5, 0.5, -0.42, -1][k - 1];
          off = -6 + o + 6 * (fbm2(arc / 40, k * 3, 2) - 0.5);
          const gOut = groundAt(cx + nx * o, cz + nz * o) - 3;
          y = dy >= 0 ? rim + dy + 3 * (fbm2(arc / 30, k, 2) - 0.5) : (dy > -0.5 ? rim + (gOut - rim) * 0.42 : gOut);
          ao = 0.95;
        }
        P.push(cx + nx * off, y, cz + nz * off); UV.push(arc / 30, j <= NV ? y / 30 : (rim + off) / 30); CO.push(ao, ao, ao);
      }
      cols++;
    }
    for (let c = 0; c < cols - 1; c++) for (let j = 0; j < R - 1; j++) {
      const a = base + c * R + j, b = a + R;
      if (side > 0) I.push(a, a + 1, b, b, a + 1, b + 1); else I.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(CO, 3));
  g.setIndex(I); g.computeVertexNormals();
  const mat = withFog(new THREE.MeshStandardMaterial({ map: tex.rockC, normalMap: tex.rockN, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true, color: lin('#ffffff'), roughness: 0.95, side: THREE.DoubleSide }), 'rock');
  // a second, larger scale of the same photo breaks the repetition
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 sdc = texture2D( map, vMapUv ) * 0.7 + texture2D( map, vMapUv * 0.37 + vec2(0.37, 0.11) ) * 0.3;
        float lum = dot(sdc.rgb, vec3(0.3, 0.59, 0.11));
        sdc.rgb = mix(vec3(lum), sdc.rgb, 0.95) * vec3(0.86, 0.74, 0.64);        // layered orange-ochre sandstone
        diffuseColor *= sdc;
      #endif`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ clouds: soft lit puffs (instanced billboards, sorted)
export function buildClouds(tier, puffTex) {
  const R = rnd(11), list = [];
  const pt = {};
  // the golden clouds round the climb (some close enough to fly through as wisps)
  for (let i = 0; i < (tier === 0 ? 70 : 120); i++) {
    const t = 17 + R() * 17; pathPoint(t, pt);
    const near = R() < 0.18, side = (R() < 0.5 ? -1 : 1) * (near ? R() * 12 : 22 + R() * 150);
    const nx = -Math.sin(pt.psi), nz = Math.cos(pt.psi);
    const y = near ? pt.y + (R() - 0.5) * 10 : 70 + R() * 150;
    list.push([pt.x + nx * side + (R() - 0.5) * 30, y, pt.z + nz * side + (R() - 0.5) * 30, near ? 14 + R() * 14 : 26 + R() * 46, Math.floor(R() * 4), near ? 0.55 : 1, 0]);
  }
  // far cumulus on the sunrise horizon
  for (let i = 0; i < 26; i++) {
    const a = (-150 + R() * 300) * D2R, r = 1300 + R() * 1600;
    list.push([150 + Math.cos(a) * r, 180 + R() * 260, -120 + Math.sin(a) * r, 140 + R() * 160, Math.floor(R() * 4), 0.9, 0]);
  }
  // the cloud sea's tops: wrapped round the camera (seamless for any length of round)
  for (let i = 0; i < (tier === 0 ? 70 : 140); i++) {
    list.push([(R() - 0.5) * 1400, SEA - 6 + R() * 20, (R() - 0.5) * 1400, 40 + R() * 60, Math.floor(R() * 4), 1, 1]);
  }
  const n = list.length;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); // xyz, size
  const aQ = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); // cell, opacity, wrap, seed
  aP.setUsage(THREE.DynamicDrawUsage); aQ.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aP', aP); geo.setAttribute('aQ', aQ);
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), { uPuffs: { value: puffTex }, uLit: U.uCloudLit, uShade: U.uCloudShade, uSunCol: U.uSunCol, uWrapC: { value: new THREE.Vector3() }, uSeaVis: { value: 0 }, uBandVis: { value: 1 } }),
    vertexShader: `
      attribute vec4 aP; attribute vec4 aQ;
      uniform vec3 uWrapC; uniform float uSeaVis; uniform float uBandVis;
      varying vec2 vUv; varying vec3 vW; varying float vA; varying vec3 vC;
      void main() {
        vec3 c = aP.xyz;
        if (aQ.z > 0.5) { c.xz = uWrapC.xz + mod(c.xz - uWrapC.xz + 700.0, 1400.0) - 700.0; }
        vec3 toCam = cameraPosition - c; float dist = length(toCam);
        vec3 f = toCam / dist;
        vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f)), u = cross(f, r);
        float s = aP.w;
        vec3 w = c + (r * position.x * 1.35 + u * position.y) * s * 0.5;
        vW = w; vC = c;
        float cell = aQ.x; vUv = (vec2(mod(cell, 2.0), floor(cell / 2.0)) + position.xy * 0.5 + 0.5) * 0.5;
        float edge = aQ.z > 0.5 ? smoothstep(700.0, 520.0, max(abs(c.x - uWrapC.x), abs(c.z - uWrapC.z))) * uSeaVis : uBandVis;
        vA = aQ.y * edge * smoothstep(s * 0.25, s * 0.9, dist); // flying through: it thins away round the camera
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uPuffs; uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uSunCol; varying vec2 vUv; varying vec3 vW; varying float vA; varying vec3 vC;
      ${GLSL_FOG_FULL}
      void main() {
        vec4 t = texture2D(uPuffs, vUv);
        float a = t.a * vA; if (a < 0.004) discard;
        vec3 V = normalize(vW - cameraPosition);
        float toward = pow(max(dot(V, uSunDir), 0.0), 3.0);
        float sunSide = clamp(dot(normalize(vW - vC + vec3(0.0, 4.0, 0.0)), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uShade, uLit, clamp(t.r * 0.95 + sunSide * 0.2 - 0.05, 0.0, 1.0));
        col += uSunCol * toward * (1.0 - t.a) * 0.9;           // silver lining towards the sun
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  // back-to-front every frame (no allocation): insertion sort of an index list, then rewrite the buffers
  const order = new Uint16Array(n), dist = new Float32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  mesh.userData.sort = (cam) => {
    const cx = cam.x, cy = cam.y, cz = cam.z, wx = mat.uniforms.uWrapC.value.x, wz = mat.uniforms.uWrapC.value.z;
    for (let i = 0; i < n; i++) {
      const L = list[i]; let x = L[0], z = L[2];
      if (L[6]) { x = wx + (((x - wx + 700) % 1400) + 1400) % 1400 - 700; z = wz + (((z - wz + 700) % 1400) + 1400) % 1400 - 700; }
      dist[i] = (x - cx) * (x - cx) + (L[1] - cy) * (L[1] - cy) + (z - cz) * (z - cz);
    }
    for (let i = 1; i < n; i++) { const o = order[i], d = dist[o]; let j = i - 1; while (j >= 0 && dist[order[j]] < d) { order[j + 1] = order[j]; j--; } order[j + 1] = o; }
    const p = aP.array, qq = aQ.array;
    for (let i = 0; i < n; i++) { const L = list[order[i]]; p[i * 4] = L[0]; p[i * 4 + 1] = L[1]; p[i * 4 + 2] = L[2]; p[i * 4 + 3] = L[3]; qq[i * 4] = L[4]; qq[i * 4 + 1] = L[5]; qq[i * 4 + 2] = L[6]; qq[i * 4 + 3] = 0; }
    aP.needsUpdate = true; aQ.needsUpdate = true;
  };
  mesh.userData.sort(new THREE.Vector3());
  return mesh;
}

// the cloud sea: a lumpy, lit cumulus top that follows the camera (its look comes from world position)
export function buildCloudSea() {
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(FOGU(), { uNoise: U.uNoise, uLit: U.uCloudLit, uShade: U.uCloudShade, uSunCol: U.uSunCol, uTime: U.uTime, uVis: { value: 0 } }),
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform sampler2D uNoise; uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uSunCol; uniform float uTime; uniform float uVis; varying vec3 vW;
      ${GLSL_FOG_FULL}
      float hgt(vec2 p) {
        vec4 a = texture2D(uNoise, p / 900.0 + vec2(uTime * 0.0004, 0.0));
        vec4 b = texture2D(uNoise, p / 260.0 + vec2(0.3, uTime * 0.0007));
        vec4 c = texture2D(uNoise, p / 70.0);
        float h = a.r * 0.55 + b.g * 0.35 + c.b * 0.1;
        return smoothstep(0.25, 0.85, h);
      }
      void main() {
        if (uVis < 0.002) discard;
        vec2 p = vW.xz; float e = 6.0;
        float h0 = hgt(p), hx = hgt(p + vec2(e, 0.0)), hz = hgt(p + vec2(0.0, e));
        vec3 n = normalize(vec3((h0 - hx) * 150.0, 1.0, (h0 - hz) * 150.0));
        bool below = cameraPosition.y < vW.y;
        float l = clamp(dot(n, uSunDir) * 1.4 + 0.25, 0.0, 1.0);
        vec3 col = mix(uShade * 0.92, uLit, l * (0.45 + 0.55 * h0));
        vec3 V = normalize(vW - cameraPosition);
        col += uSunCol * pow(max(dot(V, uSunDir), 0.0), 6.0) * (1.0 - h0) * 0.5;
        if (below) col = mix(uShade, uLit, 0.25) * (0.75 + 0.25 * h0);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, uVis);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), mat);
  m.position.y = SEA; m.frustumCulled = false; m.renderOrder = 4;
  return m;
}

// ------------------------------------------------------------------ the dip: a soft veil over the whole picture
export function buildDip() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uCol: { value: new THREE.Color(1, 0.9, 0.8) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform float uA; uniform vec3 uCol; varying vec2 vUv;
      void main(){ float r = length(vUv - vec2(0.5, 0.42)); gl_FragColor = vec4(uCol * (1.06 - 0.12 * r), uA * (0.9 + 0.1 * smoothstep(0.0, 0.7, r)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  }));
  m.frustumCulled = false; m.renderOrder = 100;
  return m;
}
