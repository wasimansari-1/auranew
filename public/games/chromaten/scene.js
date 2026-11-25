/* Chroma Ten — the 3D colour drum (three.js 0.170.0, shared copy in ../_core/vendor), with a 2D
 * canvas fallback when WebGL is not available.
 *
 * A gold-rimmed drum of ten glossy enamel tiles (one per digit, in its colour: green 1 3 7 9,
 * red 2 4 6 8, split green/violet 5 and red/violet 0) turns on a horizontal axle between two gold
 * arms on a round pedestal; two gold pointers mark the tile that counts.
 *
 * Motion (analytic, so it is identical at any frame rate and never jerks):
 *   spin()     the drum speeds up from rest (smoothstep over 1.0 s) to VMAX and keeps rolling;
 *              above ~4 rad/s every tile cross-fades into a motion-streak copy of itself.
 *   land(d)    from the current angle and speed it slows down onto digit d with the velocity
 *              profile v(u) = v0·(1 − 3u² + 2u³): speed and acceleration both reach 0 exactly when d
 *              faces the camera (no bounce, no snap). From rest it eases in and out.
 *   win(on, d) a neon outline in the digit's colour hugs the winning tile, the halo and rings take
 *              its colour, the other tiles dim (0.5 s cross-fade).
 * The scene renders only while something moves (battery); hooks: tick(speed 0–1) per tile passing
 * the pointers.
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), show(d), spin(), land(d, opts) → s,
 *      onLanded(cb), spinning(), win(on, d), topColor, kind: 'webgl' | '2d' }>
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../_core/vendor/three-0.170.0/addons/RoundedBoxGeometry.js';

const N = 10, STEP = (2 * Math.PI) / N;
const VMAX = 12.5;           // rad/s at full roll (~2 turns per second)
const SPINUP = 1.0;          // s
const TOP_COLOR = '#12072a';
const BASE = new URL('.', import.meta.url).href;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mod = (a, m) => ((a % m) + m) % m;
const smooth = (u) => u * u * (3 - 2 * u);

// the colours of a digit: [main, second] (second = violet for the split digits 0 and 5)
export const KIND = (d) => (d === 0 ? ['r', 'v'] : d === 5 ? ['g', 'v'] : d % 2 ? ['g'] : ['r']);
const PAL = { g: ['#2fd08a', '#059150', '#04432c'], r: ['#ff5a77', '#d3123f', '#6b0a24'], v: ['#c58cff', '#8132e6', '#3a0d80'] };
const GLOW = { g: 0x2bff8e, r: 0xff3d6b, v: 0xb76bff };
const NAMES = { g: 'GREEN', r: 'RED', v: 'VIOLET' };

// ------------------------------------------------------------------ motion (shared by both renderers)
function motion() {
  let ph = { kind: 'still', a0: 0, t0: 0 };
  const now = () => performance.now() / 1000;
  function at(t) { // angle and speed at time t
    const p = ph, s = t - p.t0;
    if (p.kind === 'still') return [p.a0, 0];
    if (p.kind === 'spin') {
      if (s < SPINUP) { const u = s / SPINUP; return [p.a0 + VMAX * SPINUP * (u * u * u - u * u * u * u / 2), VMAX * smooth(u)]; }
      return [p.a0 + VMAX * SPINUP / 2 + VMAX * (s - SPINUP), VMAX];
    }
    const u = clamp(s / p.T, 0, 1);
    if (p.kind === 'blend') { // cubic Hermite from (a0, v0) to (a0 + D, 0): no jump in angle or speed
      const h = u * u * (3 - 2 * u), g = u - 2 * u * u + u * u * u, dh = 6 * u * (1 - u), dg = 1 - 4 * u + 3 * u * u;
      return [p.a0 + p.D * h + p.v0 * p.T * g, (p.D * dh) / p.T + p.v0 * dg];
    }
    if (p.v0 > 0.5) return [p.a0 + p.v0 * p.T * (u - u * u * u + u * u * u * u / 2), p.v0 * (1 - 3 * u * u + 2 * u * u * u)];
    const e = u * u * u * (u * (u * 6 - 15) + 10), de = 30 * u * u * (u - 1) * (u - 1) / p.T;
    return [p.a0 + p.D * e, p.D * de];
  }
  return {
    angle: () => at(now()),
    still: (a) => { ph = { kind: 'still', a0: a, t0: now() }; },
    spin() {
      const t = now(), [a, v] = at(t);
      if (ph.kind === 'spin') return;
      ph = v > VMAX * 0.8 ? { kind: 'spin', a0: a - VMAX * SPINUP / 2, t0: t - SPINUP } : { kind: 'spin', a0: a, t0: t };
    },
    land(d, opts) {
      const t = now(), [a, v] = at(t), target = d * STEP;
      const delta = mod(target - a, 2 * Math.PI);
      if (v > 0.5 && v < VMAX * 0.8) { // still speeding up (a late start): blend into the landing over `ideal`
        const T = (opts && opts.seconds) || 3;
        let D = delta;
        while (D < v * T * 0.6 + Math.PI) D += 2 * Math.PI;
        ph = { kind: 'blend', a0: a, t0: t, v0: v, T, D, target: d };
      } else if (v > 0.5) { // keep rolling: distance D = v0·T/2, T as close to `ideal` as the digit allows
        const ideal = (opts && opts.seconds) || 3;
        let best = null;
        for (let k = 0; k < 12; k++) {
          const D = delta + 2 * Math.PI * k, T = (2 * D) / v;
          if (T < ideal * 0.75) continue;
          if (!best || Math.abs(T - ideal) < Math.abs(best.T - ideal)) best = { D, T };
          if (T > ideal * 1.4) break;
        }
        if (!best) best = { D: delta, T: (2 * delta) / v };
        ph = { kind: 'land', a0: a, t0: t, v0: v, T: best.T, D: best.D, target: d };
      } else { // from rest (joined mid-draw): ease in and out over one extra turn
        const D = delta + 2 * Math.PI * ((opts && opts.turns) != null ? opts.turns : 1);
        ph = { kind: 'land', a0: a, t0: t, v0: 0, T: (opts && opts.seconds) || 2.2, D, target: d };
      }
      return ph.T;
    },
    phase: () => ph,
    done() {
      if ((ph.kind === 'land' || ph.kind === 'blend') && now() - ph.t0 >= ph.T) { ph = { kind: 'still', a0: ph.target * STEP, t0: now(), landed: ph.target }; return true; }
      return false;
    },
  };
}

// ------------------------------------------------------------------ textures
let FONT = '"Outfit", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
async function fontsReady() {
  try {
    await Promise.race([Promise.all([document.fonts.load('900 200px Outfit'), document.fonts.load('800 30px Outfit')]), new Promise((r) => setTimeout(r, 2500))]);
    if (!document.fonts.check('900 200px Outfit')) FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  } catch (e) { /* keep the stack */ }
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
const FW = 640, FH = 256; // face texture (the tile is 2.5 × 1.0)
function faceBack(x, d) {
  const k = KIND(d);
  const grad = (cols) => { const g = x.createLinearGradient(0, 0, 0, FH); g.addColorStop(0, cols[0]); g.addColorStop(0.5, cols[1]); g.addColorStop(1, cols[2]); return g; };
  x.fillStyle = grad(PAL[k[0]]); x.fillRect(0, 0, FW, FH);
  if (k.length > 1) {
    x.save(); x.beginPath(); x.moveTo(380, 0); x.lineTo(FW, 0); x.lineTo(FW, FH); x.lineTo(260, FH); x.closePath(); x.clip();
    x.fillStyle = grad(PAL.v); x.fillRect(0, 0, FW, FH); x.restore();
    x.strokeStyle = '#ffe29a'; x.lineWidth = 5; x.beginPath(); x.moveTo(380, 0); x.lineTo(260, FH); x.stroke();
  }
  const gl = x.createLinearGradient(0, 0, 0, FH);
  gl.addColorStop(0, 'rgba(255,255,255,.22)'); gl.addColorStop(0.42, 'rgba(255,255,255,.03)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.18)');
  x.fillStyle = gl; x.fillRect(0, 0, FW, FH);
  x.strokeStyle = 'rgba(255,226,154,.85)'; x.lineWidth = 6; x.beginPath(); x.roundRect(14, 14, FW - 28, FH - 28, 26); x.stroke();
}
function faceInk(x, d, dy) {
  const k = KIND(d);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '900 200px ' + FONT; x.fillStyle = '#ffffff';
  x.fillText(String(d), FW / 2, FH / 2 + 10 + dy);
  x.font = '800 28px ' + FONT; x.fillStyle = 'rgba(255,255,255,.92)';
  x.textAlign = 'left';
  k.forEach((kk, i) => x.fillText(NAMES[kk], 44, (k.length === 1 ? FH / 2 : FH / 2 - 22 + i * 44) + dy));
  x.textAlign = 'right'; x.fillText(d >= 5 ? 'BIG' : 'SMALL', FW - 44, FH / 2 + dy);
}
function faceTexture(d) {
  const [c, x] = canvas(FW, FH);
  faceBack(x, d);
  x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 14; x.shadowOffsetY = 8;
  faceInk(x, d, 0);
  return c;
}
function streakTexture(d) { // smeared along the roll
  const [c, x] = canvas(FW, FH);
  faceBack(x, d);
  for (let k = -6; k <= 6; k++) { x.globalAlpha = 0.17 * (1 - Math.abs(k) / 7); faceInk(x, d, k * 9); }
  x.globalAlpha = 1;
  return c;
}
function radial(stops, size) {
  const [c, g] = canvas(size || 256, size || 256), s = (size || 256) / 2;
  const r = g.createRadialGradient(s, s, 0, s, s, s);
  stops.forEach(([o, col]) => r.addColorStop(o, col));
  g.fillStyle = r; g.fillRect(0, 0, s * 2, s * 2);
  return c;
}
function frameTexture() { // a neon outline hugging the tile edge (tile = inner 80 % × 70 %)
  const [c, x] = canvas(512, 256);
  x.shadowColor = '#fff'; x.strokeStyle = '#fff';
  for (const [blur, lw, a] of [[28, 14, 0.55], [10, 6, 0.9], [0, 3, 1]]) {
    x.shadowBlur = blur; x.lineWidth = lw; x.globalAlpha = a;
    x.beginPath(); x.roundRect(512 * 0.1, 256 * 0.15, 512 * 0.8, 256 * 0.7, 22); x.stroke();
  }
  return c;
}
function backdrop() {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#060411'; g.fillRect(0, 0, 1024, 1024);
  const r = g.createRadialGradient(512, 440, 20, 512, 440, 600);
  r.addColorStop(0, '#3b1580'); r.addColorStop(0.32, '#240c55'); r.addColorStop(0.66, '#110630'); r.addColorStop(1, '#060411');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) { // soft stage beams
    const x = 512 + (i - 2.5) * 170, lg = g.createLinearGradient(0, 0, 0, 860);
    lg.addColorStop(0, 'rgba(168,85,247,0.13)'); lg.addColorStop(1, 'rgba(168,85,247,0)');
    g.fillStyle = lg; g.beginPath(); g.moveTo(x - 16, 0); g.lineTo(x + 16, 0); g.lineTo(x + (i - 2.5) * 40 + 70, 860); g.lineTo(x + (i - 2.5) * 40 - 70, 860); g.fill();
  }
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 80; i++) { // bokeh in the three colours and gold
    const x = rnd() * 1024, y = rnd() * 720, rr = 4 + rnd() * 18, a = 0.05 + rnd() * 0.12, q = rnd();
    const col = q < 0.25 ? '52,211,153' : q < 0.5 ? '251,113,133' : q < 0.8 ? '192,132,252' : '255,190,110';
    const b = g.createRadialGradient(x, y, 0, x, y, rr);
    b.addColorStop(0, `rgba(${col},${a})`); b.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = b; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  return c;
}
function floorTexture() {
  const [c, g] = canvas(1024, 1024);
  const r = g.createRadialGradient(512, 512, 0, 512, 512, 512);
  r.addColorStop(0, 'rgba(120,60,220,0.5)'); r.addColorStop(0.45, 'rgba(60,20,130,0.3)'); r.addColorStop(1, 'rgba(6,4,17,0)');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  return c;
}
function loadImage(src) {
  return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}

// ------------------------------------------------------------------ WebGL drum
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

async function createGL(cv, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x060411, 1);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t; };

  const [nxImg, wordImg] = await Promise.all([loadImage(new URL('../../logo.webp', BASE).href), loadImage(new URL('../../logo2.webp', BASE).href)]);

  // backdrop + floor glow
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: tex(backdrop()), depthWrite: false }));
  bg.position.set(0, 1.5, -12); scene.add(bg);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: tex(floorTexture()), transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.27; scene.add(floor);

  // ---- the drum: ten extruded enamel tiles + a streak overlay each
  const TW = 2.5, TH = 0.96, TD = 0.16, R = 1.6;
  const shape = new THREE.Shape(), w = TW / 2, h = TH / 2, rr = 0.12;
  shape.moveTo(-w + rr, -h); shape.lineTo(w - rr, -h); shape.quadraticCurveTo(w, -h, w, -h + rr); shape.lineTo(w, h - rr); shape.quadraticCurveTo(w, h, w - rr, h);
  shape.lineTo(-w + rr, h); shape.quadraticCurveTo(-w, h, -w, h - rr); shape.lineTo(-w, -h + rr); shape.quadraticCurveTo(-w, -h, -w + rr, -h);
  const tileGeo = new THREE.ExtrudeGeometry(shape, { depth: TD, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 3, curveSegments: 6 });
  { const pos = tileGeo.attributes.position, uv = tileGeo.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w) / TW, (pos.getY(i) + h) / TH); }
  const streakGeo = new THREE.PlaneGeometry(TW, TH);
  const goldMetal = new THREE.MeshStandardMaterial({ color: 0xffc46b, metalness: 1, roughness: 0.28 });
  const drum = new THREE.Group(); scene.add(drum);
  const tiles = [];
  for (let i = 0; i < N; i++) {
    const face = new THREE.MeshStandardMaterial({ map: tex(faceTexture(i)), roughness: 0.34, metalness: 0.05, emissive: 0xffffff, emissiveIntensity: 0.05 });
    face.emissiveMap = face.map;
    const mesh = new THREE.Mesh(tileGeo, [face, goldMetal]);
    mesh.position.z = R - TD;
    const streak = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({ map: tex(streakTexture(i)), transparent: true, opacity: 0, depthWrite: false }));
    streak.position.z = R + 0.045; streak.visible = false;
    const pivot = new THREE.Group(); pivot.rotation.x = -i * STEP; pivot.add(mesh, streak); drum.add(pivot);
    tiles.push({ face, streak });
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.12, R - 0.12, TW - 0.1, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x1a0b3a, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }));
  core.rotation.z = Math.PI / 2; drum.add(core);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a0f5c, metalness: 0.35, roughness: 0.22 });
  for (const sx of [-1, 1]) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.16, R + 0.16, 0.14, 64), wheelMat);
    disc.rotation.z = Math.PI / 2; disc.position.x = sx * (TW / 2 + 0.13); drum.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.16, 0.06, 16, 96), goldMetal);
    rim.rotation.y = Math.PI / 2; rim.position.x = sx * (TW / 2 + 0.2); drum.add(rim);
  }

  // ---- the stand (does not turn): hubs with the NX mark, arms, pointers, pedestal with the wordmark
  const stand = new THREE.Group(); scene.add(stand);
  const nxTex = nxImg ? tex(nxImg) : null, wordTex = wordImg ? tex(wordImg) : null;
  const capMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x6d28d9, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1 });
  const pointerMat = new THREE.MeshStandardMaterial({ color: 0xffc46b, metalness: 1, roughness: 0.2, emissive: 0xffa640, emissiveIntensity: 0 });
  for (const sx of [-1, 1]) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.3, 40), goldMetal);
    hub.rotation.z = Math.PI / 2; hub.position.x = sx * (TW / 2 + 0.38); stand.add(hub);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16), capMat);
    cap.position.x = sx * (TW / 2 + 0.56); stand.add(cap);
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.18, 2.05, 0.34, 3, 0.05), goldMetal);
    arm.position.set(sx * (TW / 2 + 0.38), -1.05, 0); stand.add(arm);
    const ptr = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 4), pointerMat);
    ptr.rotation.z = sx * Math.PI / 2; ptr.position.set(sx * (TW / 2 + 0.85), 0, R - 0.1); stand.add(ptr);
  }
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.5, 0.36, 72), new THREE.MeshStandardMaterial({ color: 0x12072a, metalness: 0.3, roughness: 0.3, envMapIntensity: 0.5 }));
  ped.position.y = -2.1; stand.add(ped);
  const pedRim = new THREE.Mesh(new THREE.TorusGeometry(2.42, 0.035, 12, 120), goldMetal);
  pedRim.rotation.x = Math.PI / 2; pedRim.position.y = -1.92; stand.add(pedRim);
  if (wordTex) { // the NEXO RNG wordmark on the pedestal's front
    const g = new THREE.PlaneGeometry(1.3, 0.19), uv = g.attributes.uv.array; // the wordmark band of logo2.webp
    for (let k = 0; k < uv.length; k += 2) { uv[k] = 0.08 + uv[k] * 0.84; uv[k + 1] = 0.49 + uv[k + 1] * 0.12; }
    const plate = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: wordTex, transparent: true, opacity: 0.9 }));
    plate.position.set(0, -2.1, 2.45); stand.add(plate);
  }
  if (nxTex) { // the NX mark on the hub caps' outer faces, seen from the side views
    for (const sx of [-1, 1]) {
      const g = new THREE.CircleGeometry(0.19, 40), uv = g.attributes.uv.array;
      for (let k = 0; k < uv.length; k += 2) { uv[k] = 0.18 + uv[k] * 0.64; uv[k + 1] = 0.36 + uv[k + 1] * 0.5; }
      const nx = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: nxTex, transparent: true }));
      nx.rotation.y = sx * Math.PI / 2; nx.position.set(sx * (TW / 2 + 0.765), 0, 0); stand.add(nx);
    }
  }

  // ---- glow: rings + halo behind the drum, the win outline, motes
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.025, 8, 160), ringMat); ring.position.z = -1.6; scene.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring2.position.z = -1.7; scene.add(ring2);
  const glowTex = tex(radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.45)'], [0.6, 'rgba(255,255,255,.08)'], [1, 'rgba(255,255,255,0)']]));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x7c3aed, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(8, 6, 1); halo.position.z = -2.2; scene.add(halo);
  const floorGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xa855f7, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  floorGlow.scale.set(7, 1.2, 1); floorGlow.position.set(0, -2.0, 0.4); scene.add(floorGlow);
  const frameGlow = new THREE.Mesh(new THREE.PlaneGeometry((TW + 0.07) / 0.8, (TH + 0.07) / 0.7), new THREE.MeshBasicMaterial({ map: tex(frameTexture()), color: GLOW.g, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  frameGlow.position.z = R + 0.06; frameGlow.visible = false; scene.add(frameGlow);
  { // dust motes (static)
    const g = new THREE.BufferGeometry(), n = 70, a = new Float32Array(n * 3);
    let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) { a[i * 3] = (rnd() - 0.5) * 12; a[i * 3 + 1] = (rnd() - 0.5) * 7; a[i * 3 + 2] = -3 - rnd() * 3; }
    g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, size: 0.12, color: 0xd8b4fe, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })));
  }
  scene.add(new THREE.AmbientLight(0x6d4ca8, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 4, 6); scene.add(key);
  const rimL = new THREE.PointLight(0xa855f7, 18, 12); rimL.position.set(-4, 1.5, 2); scene.add(rimL);
  const rimR = new THREE.PointLight(0xffbb60, 14, 12); rimR.position.set(4, 1.2, 2); scene.add(rimR);
  const winLight = new THREE.PointLight(0x22c55e, 0, 6); winLight.position.set(0, 0, R + 1.2); scene.add(winLight);
  const C_IDLE_HALO = new THREE.Color(0x7c3aed), C_IDLE_RING = new THREE.Color(0xa855f7), C_IDLE_FLOOR = new THREE.Color(0xa855f7);
  const cWin = new THREE.Color(), cTmp = new THREE.Color();

  // ---- state + loop
  const M = motion();
  let W = 1, H = 1, area = null, dirty = true, raf = 0, lastFace = -1, landedCb = null;
  let glow = 0, glowTo = 0, glowT = performance.now(), winDigit = -1;

  function frame() {
    const cx = area.L + area.W / 2, wide = W >= 900;
    const fitH = wide ? 5.0 : 5.45;                      // world units the play-area height shows
    const cy = area.T + area.H * (wide ? 0.5 : 0.5);
    const dist = (fitH / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (H / Math.max(120, area.H));
    camera.position.set(0, 0.5, dist); camera.lookAt(0, -0.22, 0);
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
  }
  function shade(rot, speed, e) {
    const blur = clamp((speed - 4) / 6, 0, 1);
    for (let i = 0; i < N; i++) {
      const k = Math.pow(Math.max(0, Math.cos(i * STEP - rot)), 6), t = tiles[i];
      const lose = i === winDigit ? 0 : e;          // the other tiles dim while a winner shows
      const lit = (0.32 + 0.68 * k) * (1 - 0.55 * lose);
      t.face.color.setScalar(lit);
      t.face.emissiveIntensity = (0.02 + 0.06 * k) * (1 - lose) + (i === winDigit ? 0.32 * e : 0);
      t.streak.visible = blur > 0.001; t.streak.material.opacity = blur; t.streak.material.color.setScalar(lit);
    }
  }
  // adaptive sharpness: if the device can't keep up while the drum moves (avg frame > 24 ms over 45
  // frames), render at a lower pixel ratio (at most twice, never below 1) — smooth beats sharp.
  let dprCap = 2, slowN = 0, slowSum = 0, lastT = 0;
  function watchFps(t) {
    if (lastT && t - lastT < 200) { slowN++; slowSum += t - lastT; }
    lastT = t;
    if (slowN >= 45) {
      const avg = slowSum / slowN; slowN = 0; slowSum = 0;
      const cur = renderer.getPixelRatio();
      if (avg > 24 && cur > 1.01 && dprCap > 1.01) { dprCap = Math.max(1, cur - 0.5); renderer.setPixelRatio(dprCap); renderer.setSize(W, H, false); }
    }
  }
  function loop(t) {
    raf = 0;
    if (M.phase().kind !== 'still') watchFps(t || performance.now()); else lastT = 0;
    const [rot, speed] = M.angle();
    if (M.done()) {
      const d = M.phase().landed; render(d * STEP, 0);
      if (landedCb) { const cb = landedCb; landedCb = null; cb(d); }
      return schedule();
    }
    render(rot, speed);
    const face = Math.floor(mod(rot + STEP / 2, 2 * Math.PI) / STEP);
    if (face !== lastFace) { if (lastFace >= 0 && speed > 0.2) hooks.tick && hooks.tick(speed / VMAX); lastFace = face; }
    schedule();
  }
  function moving() { return M.phase().kind !== 'still' || glow !== glowTo; }
  function schedule() { if (!raf && (moving() || dirty)) raf = requestAnimationFrame(loop); }
  function render(rot, speed) {
    drum.rotation.x = rot;
    const t = performance.now(), dt = Math.min(0.1, (t - glowT) / 1000); glowT = t;
    if (glow !== glowTo) glow = glowTo > glow ? Math.min(glowTo, glow + dt / 0.5) : Math.max(glowTo, glow - dt / 0.5);
    const e = smooth(glow);
    shade(rot, speed, e);
    frameGlow.visible = e > 0.001; frameGlow.material.opacity = 0.85 * e;
    ringMat.color.copy(C_IDLE_RING).lerp(cWin, e); ringMat.opacity = 0.55 + 0.35 * e;
    halo.material.color.copy(C_IDLE_HALO).lerp(cWin, e); halo.material.opacity = 0.5 + 0.35 * e;
    floorGlow.material.color.copy(C_IDLE_FLOOR).lerp(cWin, e);
    winLight.intensity = 8 * e; pointerMat.emissiveIntensity = 0.8 * e;
    const c0 = performance.now();
    renderer.render(scene, camera);
    cpu.push(performance.now() - c0); if (cpu.length > 240) cpu.shift();
    dirty = false;
  }
  const cpu = []; // main-thread ms per rendered frame (QA: debug().cpu)
  // compile every shader now (the streak copies and the win outline appear only later): no hitch
  // the first time the drum rolls or a winner lights up
  tiles.forEach((t) => { t.streak.visible = true; });
  frameGlow.visible = true;
  renderer.compile(scene, camera);
  tiles.forEach((t) => { t.streak.visible = false; });
  frameGlow.visible = false;

  return {
    kind: 'webgl', topColor: TOP_COLOR,
    debug: () => ({ angle: M.angle(), phase: M.phase().kind, glow, glowTo, winDigit, dpr: renderer.getPixelRatio(), calls: renderer.info.render.calls, cpu: cpu.slice() }),
    resize(w2, h2, a) {
      W = Math.max(1, w2); H = Math.max(1, h2); area = a;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, W < 900 ? 1.75 : 2, dprCap));
      renderer.setSize(W, H, false);
      frame(); dirty = true; schedule();
    },
    show(d) { M.still(d * STEP); dirty = true; schedule(); },
    spin() { glowTo = 0; glowT = performance.now(); M.spin(); schedule(); },
    land(d, opts) { const T = M.land(d, opts); schedule(); return T; },
    onLanded(cb) { landedCb = cb; },
    spinning() { return M.phase().kind !== 'still'; },
    win(on, d) {
      if (on && d != null) {
        winDigit = d;
        const k = KIND(d);
        cWin.setHex(GLOW[k[0]]);
        frameGlow.material.color.setHex(GLOW[k[0]]);
        winLight.color.setHex(GLOW[k[0]]);
        if (k[1]) ring2.material.color.copy(cTmp.setHex(GLOW.v)); else ring2.material.color.setHex(0xffcf6b);
      } else if (!on) ring2.material.color.setHex(0xffcf6b);
      glowTo = on ? 1 : 0; glowT = performance.now(); dirty = true; schedule();
    },
  };
}

// ------------------------------------------------------------------ 2D fallback (no WebGL)
function create2D(cv, hooks) {
  const g = cv.getContext('2d'), M = motion();
  let W = 1, H = 1, area = null, dpr = 1, raf = 0, dirty = true, glow = 0, glowTo = 0, glowT = performance.now(), winDigit = -1, landedCb = null, lastFace = -1;
  const bg = backdrop(), faces = [];
  for (let i = 0; i < N; i++) faces.push(faceTexture(i));
  function draw(rot) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg, 0, 0, W, H);
    const cx = area.L + area.W / 2, cy = area.T + area.H / 2, fh = Math.min(area.H * 0.2, area.W * 0.16), fw = fh * 2.5;
    const t = performance.now(), dt = Math.min(0.1, (t - glowT) / 1000); glowT = t;
    if (glow !== glowTo) glow = glowTo > glow ? Math.min(glowTo, glow + dt / 0.5) : Math.max(glowTo, glow - dt / 0.5);
    const e = smooth(glow);
    for (let i = 0; i < N; i++) {
      const a = mod(i * STEP - rot + Math.PI, 2 * Math.PI) - Math.PI;
      if (Math.abs(a) > 1.35) continue;
      const y = cy - Math.sin(a) * fh * 1.6, h = fh * Math.cos(a), k = Math.pow(Math.cos(a), 4);
      g.globalAlpha = (0.35 + 0.65 * k) * (i === winDigit ? 1 : 1 - 0.5 * e);
      g.drawImage(faces[i], cx - fw / 2, y - h / 2, fw, h);
    }
    g.globalAlpha = 1;
    if (e > 0 && winDigit >= 0) { g.strokeStyle = KIND(winDigit)[0] === 'g' ? '#2bff8e' : '#ff3d6b'; g.globalAlpha = e; g.lineWidth = 4; g.strokeRect(cx - fw / 2 - 4, cy - fh / 2 - 4, fw + 8, fh + 8); g.globalAlpha = 1; }
    g.fillStyle = '#ffc46b';
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * (fw / 2 + 8), cy); g.lineTo(cx + s * (fw / 2 + 26), cy - 10); g.lineTo(cx + s * (fw / 2 + 26), cy + 10); g.fill(); }
  }
  function loop() {
    raf = 0;
    const [rot, speed] = M.angle();
    if (M.done()) { const d = M.phase().landed; draw(d * STEP); if (landedCb) { const cb = landedCb; landedCb = null; cb(d); } return schedule(); }
    draw(rot); dirty = false;
    const face = Math.floor(mod(rot + STEP / 2, 2 * Math.PI) / STEP);
    if (face !== lastFace) { if (lastFace >= 0 && speed > 0.2) hooks.tick && hooks.tick(speed / VMAX); lastFace = face; }
    schedule();
  }
  function schedule() { if (!raf && (M.phase().kind !== 'still' || glow !== glowTo || dirty)) raf = requestAnimationFrame(loop); }
  return {
    kind: '2d', topColor: TOP_COLOR,
    debug: () => ({ angle: M.angle(), phase: M.phase().kind, glow, glowTo, winDigit }),
    resize(w, h, a) { W = w; H = h; area = a; dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); dirty = true; schedule(); },
    show(d) { M.still(d * STEP); dirty = true; schedule(); },
    spin() { glowTo = 0; M.spin(); schedule(); },
    land(d, opts) { const T = M.land(d, opts); schedule(); return T; },
    onLanded(cb) { landedCb = cb; },
    spinning() { return M.phase().kind !== 'still'; },
    win(on, d) { if (d != null) winDigit = d; glowTo = on ? 1 : 0; glowT = performance.now(); dirty = true; schedule(); },
  };
}

export async function create(cv, hooks) {
  await fontsReady();
  hooks = hooks || {};
  if (hasWebGL() && !/[?&]flat=1/.test(location.search)) {
    try { return await createGL(cv, hooks); } catch (e) {
      console.warn('Chroma Ten: WebGL failed, using 2D', e);
      const fresh = cv.cloneNode(false); cv.replaceWith(fresh); cv = fresh;
    }
  }
  return create2D(cv, hooks);
}
