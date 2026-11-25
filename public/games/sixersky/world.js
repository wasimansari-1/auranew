/* Sixer Sky 3D — the world: the sky (a bright afternoon → gold above the clouds; never night), the
 * cricket ground (mown outfield, the pitch with its creases, stumps, boundary rope, LED boards with
 * our wordmark, sightscreens, two tiers of stands full of people, the roof, the light towers), the
 * town round it, the clouds (soft lit puffs, sorted back-to-front), the cloud sea, the ball, and the
 * dip (a soft veil between camera angles). */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { U, GLSL_SKY, GLSL_FOG, GLSL_FOG_FULL, withFog } from './common.js';
import { pathPoint, SEA, S5, PITCH, FIELD_R, BALL_R } from './timeline.js';

const D2R = Math.PI / 180;
function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
const FOGU = () => ({ uSunDir: U.uSunDir, uZenith: U.uZenith, uHorizon: U.uHorizon, uGlow: U.uGlow, uGround: U.uGround, uFogSun: U.uFogSun, uFogDen: U.uFogDen, uFogH: U.uFogH, uMist: U.uMist, uMistCol: U.uMistCol });

// ------------------------------------------------------------------ sky
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

function canvasTex(w, h, draw, srgb) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
  return t;
}
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
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

function fn(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vn2(x, y) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy); const a = fn(ix, iy), b = fn(ix + 1, iy), c = fn(ix, iy + 1), d = fn(ix + 1, iy + 1); return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy; }
function fbm2(x, y, o) { let s = 0, a = 0.5, n = 0; for (let i = 0; i < o; i++) { s += a * vn2(x, y); n += a; x *= 2.03; y *= 2.03; a *= 0.5; } return s / n; }
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
  // far cumulus all round the horizon
  for (let i = 0; i < 26; i++) {
    const a = R() * 360 * D2R, r = 1300 + R() * 1600;
    list.push([Math.cos(a) * r, 180 + R() * 260, 300 + Math.sin(a) * r, 140 + R() * 160, Math.floor(R() * 4), 0.9, 0]);
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
        vec3 w = c + (r * position.x * 1.6 + u * position.y) * s * 0.5;
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
        vec3 col = mix(uShade, uLit, clamp(t.r * 0.75 + sunSide * 0.45 - 0.1, 0.0, 1.0));
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
        vec3 n = normalize(vec3((h0 - hx) * 70.0, 1.0, (h0 - hz) * 70.0));
        bool below = cameraPosition.y < vW.y;
        float l = clamp(dot(n, uSunDir) * 1.6 + 0.35, 0.0, 1.0);
        vec3 col = mix(uShade, uLit, l * (0.55 + 0.45 * h0));
        vec3 V = normalize(vW - cameraPosition);
        col += uSunCol * pow(max(dot(V, uSunDir), 0.0), 6.0) * (1.0 - h0) * 0.5;
        if (below) col = mix(uShade, uLit, 0.25) * (0.75 + 0.25 * h0);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, uVis);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: true, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), mat);
  m.position.y = SEA; m.frustumCulled = false; m.renderOrder = 4;
  return m;
}

// ------------------------------------------------------------------ the falconer's arm: purple leather gauntlet, NX foil
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

// ------------------------------------------------------------------ the cricket ground
// Everything is built round the pitch's centre C = (0, 0, PITCH / 2). Sizes are real: a 68 m boundary,
// a 20.12 m pitch, 71 cm stumps. brand: { word: <img NEXORNG wordmark>, nx: <img NX mark> } (may be null).
const CZ = PITCH / 2;
function stdMat(o) { return withFog(new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o))); }
function grassTex() { // fine blades, tiled every 2 m
  const R = rnd(5);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5d9a3c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const x = R() * w, y = R() * h, l = 2 + R() * 5, v = R();
      g.strokeStyle = v < 0.5 ? 'rgba(52,110,34,0.55)' : v < 0.85 ? 'rgba(126,178,70,0.5)' : 'rgba(170,196,96,0.4)';
      g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 2, y - l); g.stroke();
    }
  });
}
function pitchTex() { // the strip: rolled clay, worn at the creases, the white lines (1 px = 1 cm across)
  const R = rnd(9), W = 305, H = 2256;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#c9b184'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5200; i++) { g.fillStyle = `rgba(${150 + R() * 70 | 0},${128 + R() * 60 | 0},${86 + R() * 40 | 0},${0.05 + R() * 0.1})`; g.fillRect(R() * W, R() * H, 2 + R() * 14, 1 + R() * 5); }
    for (const z0 of [122, H - 122]) { // the worn, darker ground round each crease
      const gr = g.createRadialGradient(W / 2, z0, 10, W / 2, z0, 210); gr.addColorStop(0, 'rgba(120,96,60,0.5)'); gr.addColorStop(1, 'rgba(120,96,60,0)');
      g.fillStyle = gr; g.fillRect(0, z0 - 230, W, 460);
    }
    g.fillStyle = '#f4f1e6';
    for (const [stump, dir] of [[122, 1], [H - 122, -1]]) {
      g.fillRect(20, stump - 2, W - 40, 5);                  // the bowling crease (through the stumps)
      g.fillRect(0, stump + dir * 122 - 2, W, 5);            // the popping crease, 1.22 m in front
      g.fillRect(20, Math.min(stump - dir * 60, stump + dir * 122), 5, 182); g.fillRect(W - 25, Math.min(stump - dir * 60, stump + dir * 122), 5, 182); // return creases
    }
  });
}
function crowdTex() { // rows of people in the seats: heads, shoulders, shirts in many colours, flags of our purple
  const R = rnd(21), W = 1024, H = 256, ROWS = 26;
  const shirts = ['#f2f2f2', '#e8e0d0', '#d94a3a', '#2f6fd0', '#f0c53a', '#3a9a55', '#7a3fd0', '#222a3a', '#e88a2a', '#c8d4e8', '#8a2f8a', '#f4f4f4'];
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#3a3344'; g.fillRect(0, 0, W, H);
    const rh = H / ROWS;
    for (let r = 0; r < ROWS; r++) {
      g.fillStyle = r % 2 ? '#463d52' : '#40384c'; g.fillRect(0, r * rh, W, rh);
      for (let x = 0; x < W; x += 7) {
        if (R() < 0.07) continue;                                // an empty seat
        const cx = x + 3.5 + (R() - 0.5) * 1.5, y = r * rh;
        g.fillStyle = shirts[R() * shirts.length | 0]; g.fillRect(cx - 3, y + rh * 0.42, 6, rh * 0.6);
        const skin = 150 + R() * 80 | 0; g.fillStyle = `rgb(${skin},${skin * 0.78 | 0},${skin * 0.62 | 0})`;
        g.beginPath(); g.arc(cx, y + rh * 0.3, 2.3, 0, 7); g.fill();
        if (R() < 0.35) { g.fillStyle = R() < 0.5 ? '#2a2018' : '#f4f4f4'; g.fillRect(cx - 2.4, y + rh * 0.12, 4.8, 2); } // hair / a cap
      }
    }
  });
}
function boardTex(brand) { // the LED boards: our purple, the wordmark and the NX mark in turn
  return canvasTex(2048, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6a2fd6'); gr.addColorStop(1, '#3a1590');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const x0 = i * w / 4;
      g.fillStyle = i % 2 ? '#2a0f6e' : '#7d3cf0'; g.fillRect(x0, 0, w / 4, h);
      const img = brand && (i % 2 ? brand.nx : brand.word);
      if (img) { const ih = h * (i % 2 ? 0.8 : 0.56), iw = ih * img.naturalWidth / img.naturalHeight; g.drawImage(img, x0 + (w / 4 - iw) / 2, (h - ih) / 2, iw, ih); }
      else { g.fillStyle = '#fff'; g.font = '700 70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(i % 2 ? 'NX' : 'NEXO RNG', x0 + w / 8, h / 2); }
    }
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, w, 3);
  });
}
function townTex() { // blocks, roads, parks and playing fields, seen from far above (tiles every 900 m)
  const R = rnd(33), W = 1024;
  return canvasTex(W, W, (g) => {
    g.fillStyle = '#9aa58a'; g.fillRect(0, 0, W, W);
    const N = 16, cell = W / N;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const v = R(), x = i * cell, y = j * cell;
      if (v < 0.22) { g.fillStyle = ['#7fae5c', '#6f9f52', '#8bb466'][R() * 3 | 0]; g.fillRect(x + 3, y + 3, cell - 6, cell - 6); continue; }
      g.fillStyle = '#b9b3a6'; g.fillRect(x + 3, y + 3, cell - 6, cell - 6);
      for (let k = 0; k < 9; k++) {
        const bw = 8 + R() * 16, bh = 8 + R() * 16, bx = x + 5 + R() * (cell - 12 - bw), by = y + 5 + R() * (cell - 12 - bh);
        g.fillStyle = ['#d8d2c4', '#c96f52', '#e6e0d4', '#a8b0b8', '#cdb89a', '#b85a44'][R() * 6 | 0]; g.fillRect(bx, by, bw, bh);
        g.fillStyle = 'rgba(40,40,60,0.22)'; g.fillRect(bx + 2, by + bh, bw, 3);
      }
      if (R() < 0.3) { g.fillStyle = '#4f8a3a'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + R() * cell, y + R() * cell, 3 + R() * 3, 0, 7); g.fill(); } }
    }
    g.fillStyle = '#6f6f76'; for (let i = 0; i <= N; i++) { g.fillRect(i * cell - 2, 0, 4, W); g.fillRect(0, i * cell - 2, W, 4); }
    g.fillStyle = '#5c5c64'; g.fillRect(W / 2 - 5, 0, 10, W); g.fillRect(0, W / 4 - 5, W, 10);
  });
}

export function buildStadium(tier, brand) {
  const G = new THREE.Group(); G.position.set(0, 0, CZ);
  const aniso = tier === 0 ? 2 : 8;
  // ---- the outfield: fine grass + the mower's stripes (bands 6 m wide, and a ring pattern near the rope)
  const gt = grassTex(); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(80, 80); gt.anisotropy = aniso;
  const fieldMat = new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95 });
  fieldMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 q = vFogW.xz - vec2(0.0, ${CZ.toFixed(2)}); float r = length(q);
        float stripe = step(0.5, fract(q.x / 12.0)) * 2.0 - 1.0;
        float ring = step(0.5, fract(r / 12.0)) * 2.0 - 1.0;
        float m = mix(stripe, ring * stripe, smoothstep(38.0, 46.0, r));
        diffuseColor.rgb *= 1.0 + 0.085 * m;
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.93, 0.9, 0.8), smoothstep(11.0, 4.0, r) * 0.25); // the square: drier grass
      }`);
  };
  fieldMat.customProgramCacheKey = () => 'field';
  const field = new THREE.Mesh(new THREE.CircleGeometry(FIELD_R + 6.5, 96).rotateX(-Math.PI / 2), withFog(fieldMat));
  field.receiveShadow = true; G.add(field);
  // ---- the pitch
  const pt = pitchTex(); pt.anisotropy = aniso;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 22.56).rotateX(-Math.PI / 2), stdMat({ map: pt, roughness: 0.86 }));
  pitch.position.y = 0.012; pitch.receiveShadow = true; G.add(pitch);
  // ---- stumps + bails at both ends
  const wood = stdMat({ color: 0xe9d6a8, roughness: 0.5 }), parts = [];
  for (const z of [-CZ, CZ]) {
    for (const x of [-0.114, 0, 0.114]) parts.push(new THREE.CylinderGeometry(0.019, 0.019, 0.711, 12).translate(x, 0.3555, z));
    for (const x of [-0.057, 0.057]) parts.push(new THREE.CylinderGeometry(0.011, 0.011, 0.11, 8).rotateZ(Math.PI / 2).translate(x, 0.72, z));
  }
  const stumps = new THREE.Mesh(mergeGeos(parts), wood); stumps.castShadow = true; G.add(stumps);
  // ---- the rope, the LED boards, the sightscreens
  const rope = new THREE.Mesh(new THREE.TorusGeometry(FIELD_R, 0.1, 8, 160).rotateX(Math.PI / 2), stdMat({ color: 0xf2f2ee, roughness: 0.7 }));
  rope.position.y = 0.09; G.add(rope);
  const bt = boardTex(brand); bt.wrapS = THREE.RepeatWrapping; bt.repeat.set(-9, 1); bt.anisotropy = aniso; // (seen from inside the ring: mirrored back to readable)
  const boards = new THREE.Mesh(new THREE.CylinderGeometry(FIELD_R + 3.2, FIELD_R + 3.2, 1.15, 128, 1, true),
    withFog(new THREE.MeshStandardMaterial({ map: bt, emissiveMap: bt, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4, side: THREE.BackSide })));
  boards.position.y = 0.575; G.add(boards);
  const screenMat = stdMat({ color: 0x17131f, roughness: 0.85 });
  for (const sgn of [-1, 1]) {
    const sc = new THREE.Mesh(new THREE.BoxGeometry(16, 6.5, 0.4), screenMat); sc.position.set(0, 3.9, sgn * (FIELD_R + 2.2)); G.add(sc);
    if (brand && brand.nx) {
      const lt = new THREE.Texture(brand.nx); lt.colorSpace = THREE.SRGBColorSpace; lt.needsUpdate = true; lt.anisotropy = aniso;
      const lw = 3.4, lh = lw * brand.nx.naturalHeight / brand.nx.naturalWidth;
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), withFog(new THREE.MeshBasicMaterial({ map: lt, transparent: true })));
      logo.position.set(sgn * 5.2, 5.3, sgn * (FIELD_R + 2.2) - sgn * 0.22); logo.rotation.y = sgn > 0 ? Math.PI : 0; G.add(logo);
    }
  }
  // ---- the stands: a lower and an upper tier full of people, concrete fronts in our purple, the roof
  const ct = crowdTex(); ct.wrapS = THREE.RepeatWrapping; ct.repeat.set(26, 1); ct.anisotropy = aniso;
  const crowdMat = stdMat({ map: ct, roughness: 1 });
  const r0 = FIELD_R + 6.5, SEG = tier === 0 ? 96 : 160;
  const lathe = (pts, mat, phi0, phiL) => { const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), SEG, phi0 || 0, phiL || Math.PI * 2), mat); G.add(m); return m; };
  const concrete = stdMat({ color: 0xcfc9d6, roughness: 0.95, side: THREE.DoubleSide }), purple = stdMat({ color: 0x4a1fa8, roughness: 0.7, side: THREE.DoubleSide });
  lathe([[r0, 0], [r0, 2.6]], purple);                                   // the front wall
  lathe([[r0, 2.6], [r0 + 21, 13.5]], Object.assign(crowdMat.clone(), {})).material.side = THREE.DoubleSide;
  lathe([[r0 + 21, 13.5], [r0 + 21, 17.2]], purple);                     // the upper tier's front (a band of boxes)
  lathe([[r0 + 21, 17.2], [r0 + 39, 29.5]], crowdMat).material.side = THREE.DoubleSide;
  lathe([[r0 + 39, 29.5], [r0 + 39, 34], [r0 + 40.5, 34], [r0 + 40.5, 0]], concrete); // the back wall, down to the street
  lathe([[r0 + 17, 39], [r0 + 41.5, 36.2], [r0 + 41.5, 35.2], [r0 + 17, 38.4]], stdMat({ color: 0xf4f2ee, roughness: 0.6, side: THREE.DoubleSide, emissive: 0xdfe6f2, emissiveIntensity: 0.42 })); // the roof (its underside is lit by the bright bowl below)
  // roof columns + four light towers
  const cols = [], NC = tier === 0 ? 24 : 48;
  for (let i = 0; i < NC; i++) { const a = (i + 0.5) / NC * Math.PI * 2; cols.push(new THREE.CylinderGeometry(0.35, 0.35, 8, 6).translate(Math.cos(a) * (r0 + 39.6), 33, Math.sin(a) * (r0 + 39.6))); }
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * Math.PI / 2, x = Math.cos(a) * (r0 + 46), z = Math.sin(a) * (r0 + 46);
    cols.push(new THREE.CylinderGeometry(0.9, 1.4, 58, 8).translate(x, 29, z));
    cols.push(new THREE.BoxGeometry(11, 7, 1.2).rotateY(-a + Math.PI / 2).translate(x, 60, z));
  }
  G.add(new THREE.Mesh(mergeGeos(cols), stdMat({ color: 0xd9d9de, roughness: 0.6 })));
  // ---- the town round the ground (to the haze), with a paved apron under the stands
  const tt = townTex(); tt.wrapS = tt.wrapT = THREE.RepeatWrapping; tt.repeat.set(14, 14); tt.anisotropy = aniso;
  const town = new THREE.Mesh(new THREE.RingGeometry(r0 + 40, 6300, 96, 1).rotateX(-Math.PI / 2), stdMat({ map: tt, roughness: 1 }));
  // RingGeometry's uv is the unit square over the outer diameter: 14 tiles over 12.6 km = 900 m each
  town.position.y = -0.05; G.add(town);
  G.userData = { field, boards };
  return G;
}

// ------------------------------------------------------------------ the ball: red leather, the white seam with its stitches, our NX stamp in gold
export function buildBall(brand) {
  const R = rnd(3);
  const tex = canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#b3161b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '70,6,10' : '220,60,60'},${0.03 + R() * 0.05})`; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3); }
    // the seam runs round the equator (v = 0.5): a raised band, six rows of stitches
    g.fillStyle = '#8f0f14'; g.fillRect(0, h * 0.5 - 26, w, 52);
    g.fillStyle = '#efe9da';
    for (const dy of [-21, -13, -5, 5, 13, 21]) for (let x = 0; x < w; x += 9) { g.save(); g.translate(x + (dy % 2 ? 4 : 0), h * 0.5 + dy); g.rotate(dy < 0 ? 0.5 : -0.5); g.fillRect(-3.2, -1.1, 6.4, 2.2); g.restore(); }
    g.fillStyle = '#6e0a0e'; g.fillRect(0, h * 0.5 - 1, w, 2);
    if (brand && brand.nx) { // the maker's stamp on both halves
      g.globalAlpha = 0.9;
      for (const [u, v] of [[0.25, 0.27], [0.75, 0.73]]) { const iw = 150, ih = iw * brand.nx.naturalHeight / brand.nx.naturalWidth; g.drawImage(brand.nx, u * w - iw / 2, v * h - ih / 2, iw, ih); }
      g.globalAlpha = 1;
    }
  });
  tex.anisotropy = 8;
  const mat = withFog(new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 }));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 32), mat);
  ball.castShadow = true;
  return ball;
}
