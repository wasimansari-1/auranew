/* Jhandi Munda — the real-time 3D table (three.js 0.170.0, shared copy in ../_core/vendor), with a
 * plain 2D fallback when WebGL is not available.
 *
 * A carved rosewood table with a brass-rimmed tray of deep red velvet (a gold rangoli printed on it)
 * stands in a sunlit Rajasthani palace courtyard decorated for a mela (backdrop.webp: a Gemini
 * picture), marigold garlands round the table edge and festive bunting over it. Six ivory dice carry
 * the six symbols (drawn in code, always sharp): heart, spade, diamond, club, flag (jhandi) and crown
 * (munda). A brass cup gathers the dice, shakes, tips and throws them.
 *
 * The throw is a real rigid-body simulation: throws.bin holds 16 throws precomputed offline with a
 * physics engine (cannon-es: gravity, friction, bounces, dice knocking each other off the tray wall),
 * each kept only if all six dice come to rest flat, apart and well inside the tray. A round's throw
 * is chosen from the round number (every viewer sees the same throw). The engine's six faces are put
 * on top by turning each die's whole trajectory by one constant cube symmetry C (one of the 24
 * rotations that map a cube onto itself — the die's shape is unchanged, so the physics stay exactly
 * the same): rendered orientation = flatten · q_sim(t) · C, where C carries the required symbol's
 * face onto the face that ended up on top in the simulation; of the four such C the one that leaves
 * the symbol upright for the camera is used. So the dice END on exactly the engine's faces, and a
 * viewer who joins mid-throw seeks into the same trajectory.
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), rest(dice, round), gather(), shaking(),
 *   throwDice(dice, round, elapsedMs) → ms until the dice rest, highlight(dice|null), view('table'|'result'),
 *   topFaces() (QA: the symbol value on top of each die, read from the rendered transforms),
 *   topColor, kind: 'webgl' | '2d' }>
 * hooks: rattle(), impact(strength 0–1), settled(), tip()
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../_core/vendor/three-0.170.0/addons/RoundedBoxGeometry.js';

const BASE = new URL('.', import.meta.url).href;
const TOP_COLOR = '#c08a52';
export const SYMBOLS = ['heart', 'spade', 'diamond', 'club', 'flag', 'crown'];
export const SYMBOL_NAMES = { heart: ['Heart', 'Paan'], spade: ['Spade', 'Hukum'], diamond: ['Diamond', 'Eent'], club: ['Club', 'Chidi'], flag: ['Flag', 'Jhandi'], crown: ['Crown', 'Munda'] };
export const SYMBOL_COLORS = { heart: '#d0112b', spade: '#17171f', diamond: '#d0112b', club: '#17171f', flag: '#0f8a43', crown: '#e3a414' };

// throws.bin (sim/sim.mjs): Int16 per variant × frame × die: px py pz (×1000) qx qy qz qw (×32767)
const FPS = 60, FRAMES = 181, DIE = 1.0;
const TIP_MS = 300, OUT_MS = 230;           // the cup tips; the dice leave its mouth OUT_MS after the step
const GATHER_MS = 950;
const REST_POS = new THREE.Vector3(5.2, 0, -6.4);     // the cup waits upright behind the tray, right
const SHAKE_POS = new THREE.Vector3(1.3, 2.3, -3.7);  // upright, shaking over the tray
const TIP_POS = new THREE.Vector3(1.3, 5.25, -5.55);  // tipped 120° toward the camera: mouth ≈ the dice's start
const TIP_ANGLE = (120 * Math.PI) / 180;
const CUP_H = 3.05;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (u) => u * u * (3 - 2 * u);
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const now = () => performance.now();

// ------------------------------------------------------------------ the six symbols (canvas paths)
// in a -1…1 box, y down
function symbolPath(s) {
  const p = new Path2D();
  switch (s) {
    case 'heart':
      p.moveTo(0, 0.92);
      p.bezierCurveTo(-0.25, 0.64, -1, 0.22, -1, -0.3);
      p.bezierCurveTo(-1, -0.72, -0.64, -0.96, -0.32, -0.96);
      p.bezierCurveTo(-0.13, -0.96, 0, -0.84, 0, -0.64);
      p.bezierCurveTo(0, -0.84, 0.13, -0.96, 0.32, -0.96);
      p.bezierCurveTo(0.64, -0.96, 1, -0.72, 1, -0.3);
      p.bezierCurveTo(1, 0.22, 0.25, 0.64, 0, 0.92);
      p.closePath();
      break;
    case 'spade':
      p.moveTo(0, -0.98);
      p.bezierCurveTo(0.26, -0.66, 0.96, -0.28, 0.96, 0.16);
      p.bezierCurveTo(0.96, 0.56, 0.62, 0.74, 0.34, 0.74);
      p.bezierCurveTo(0.2, 0.74, 0.1, 0.68, 0.05, 0.6);
      p.quadraticCurveTo(0.08, 0.86, 0.3, 0.98);
      p.lineTo(-0.3, 0.98);
      p.quadraticCurveTo(-0.08, 0.86, -0.05, 0.6);
      p.bezierCurveTo(-0.1, 0.68, -0.2, 0.74, -0.34, 0.74);
      p.bezierCurveTo(-0.62, 0.74, -0.96, 0.56, -0.96, 0.16);
      p.bezierCurveTo(-0.96, -0.28, -0.26, -0.66, 0, -0.98);
      p.closePath();
      break;
    case 'diamond':
      p.moveTo(0, -1);
      p.quadraticCurveTo(0.34, -0.42, 0.74, 0);
      p.quadraticCurveTo(0.34, 0.42, 0, 1);
      p.quadraticCurveTo(-0.34, 0.42, -0.74, 0);
      p.quadraticCurveTo(-0.34, -0.42, 0, -1);
      p.closePath();
      break;
    case 'club':
      p.arc(0, -0.5, 0.37, 0, Math.PI * 2);
      p.moveTo(-0.11, 0.12); p.arc(-0.48, 0.12, 0.37, 0, Math.PI * 2);
      p.moveTo(0.85, 0.12); p.arc(0.48, 0.12, 0.37, 0, Math.PI * 2);
      p.moveTo(0.22, 0); p.arc(0, 0, 0.22, 0, Math.PI * 2);
      p.moveTo(0.06, 0.1);
      p.quadraticCurveTo(0.08, 0.84, 0.3, 0.98);
      p.lineTo(-0.3, 0.98);
      p.quadraticCurveTo(-0.08, 0.84, -0.06, 0.1);
      p.closePath();
      break;
  }
  return p;
}
// draw symbol s centred at (cx, cy) with half-size r on a 2D context (faces, board icons, cards)
export function drawSymbol(g, s, cx, cy, r) {
  g.save(); g.translate(cx, cy); g.scale(r, r);
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (s === 'flag') {
    // pole, gold finial, a waving green pennant with a saffron border, the base
    g.fillStyle = '#4a2a12'; g.fillRect(-0.66, -0.86, 0.13, 1.74);
    g.fillStyle = '#2f1a0b'; g.beginPath(); g.ellipse(-0.6, 0.9, 0.34, 0.09, 0, 0, Math.PI * 2); g.fill();
    const fl = new Path2D();
    fl.moveTo(-0.53, -0.84);
    fl.bezierCurveTo(-0.15, -0.98, 0.22, -0.66, 0.96, -0.6);
    fl.bezierCurveTo(0.5, -0.36, 0.3, -0.06, 0.62, 0.16);
    fl.bezierCurveTo(0.12, 0.2, -0.2, 0.0, -0.53, 0.12);
    fl.closePath();
    g.fillStyle = '#ff8a12'; g.fill(fl);
    g.save(); g.clip(fl);
    g.fillStyle = '#0f8a43'; g.translate(-0.02, 0.0); g.scale(0.88, 0.8); g.translate(0.03, -0.1); g.fill(fl);
    g.restore();
    g.lineWidth = 0.05; g.strokeStyle = '#7a3c00'; g.stroke(fl);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0.05, -0.38, 0.11, 0, Math.PI * 2); g.fill(); // a white star-dot (chakra-like)
    const knob = g.createRadialGradient(-0.63, -0.94, 0.02, -0.6, -0.9, 0.14);
    knob.addColorStop(0, '#fff3c0'); knob.addColorStop(1, '#c98a10');
    g.fillStyle = knob; g.beginPath(); g.arc(-0.595, -0.9, 0.13, 0, Math.PI * 2); g.fill();
  } else if (s === 'crown') {
    const c = new Path2D();
    c.moveTo(-0.84, 0.5);
    c.lineTo(-0.94, -0.42); c.lineTo(-0.46, -0.02); c.lineTo(0, -0.7);
    c.lineTo(0.46, -0.02); c.lineTo(0.94, -0.42); c.lineTo(0.84, 0.5);
    c.closePath();
    const gr = g.createLinearGradient(0, -0.8, 0, 0.8);
    gr.addColorStop(0, '#ffe27a'); gr.addColorStop(0.55, '#f0a818'); gr.addColorStop(1, '#c47800');
    g.fillStyle = gr; g.fill(c);
    g.lineWidth = 0.07; g.strokeStyle = '#6b3a00'; g.stroke(c);
    const band = new Path2D(); band.rect(-0.88, 0.5, 1.76, 0.3);
    g.fill(band); g.stroke(band);
    for (const [x, y] of [[-0.94, -0.44], [0, -0.74], [0.94, -0.44]]) {
      g.beginPath(); g.arc(x, y, 0.13, 0, Math.PI * 2); g.fillStyle = '#ffe27a'; g.fill(); g.stroke();
    }
    g.fillStyle = '#d0112b'; g.beginPath(); g.arc(0, 0.65, 0.1, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1f6fd0'; for (const x of [-0.5, 0.5]) { g.beginPath(); g.arc(x, 0.65, 0.075, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#0f8a43'; g.beginPath(); g.moveTo(0, 0.02); g.lineTo(0.12, 0.2); g.lineTo(0, 0.38); g.lineTo(-0.12, 0.2); g.closePath(); g.fill();
  } else {
    const p = symbolPath(s), col = SYMBOL_COLORS[s];
    const gr = g.createLinearGradient(0, -1, 0, 1);
    if (col === '#d0112b') { gr.addColorStop(0, '#f0303f'); gr.addColorStop(1, '#a8001c'); } else { gr.addColorStop(0, '#3a3b48'); gr.addColorStop(1, '#0b0b10'); }
    g.fillStyle = gr; g.fill(p, 'nonzero');
    g.globalAlpha = 0.25; g.lineWidth = 0.04; g.strokeStyle = '#000'; g.stroke(p); g.globalAlpha = 1;
  }
  g.restore();
}
// a symbol tile as a data URL (the board's icons use the same drawing as the dice)
export function symbolImage(s, px, tile) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d');
  if (tile) faceBackground(g, 0, 0, px);
  drawSymbol(g, s, px / 2, px / 2, px * (tile ? 0.33 : 0.46));
  return c.toDataURL('image/png');
}
function faceBackground(g, x, y, n) {
  const bg = g.createRadialGradient(x + n * 0.45, y + n * 0.4, n * 0.1, x + n / 2, y + n / 2, n * 0.75);
  bg.addColorStop(0, '#fffdf6'); bg.addColorStop(0.7, '#fbf1dc'); bg.addColorStop(1, '#eedcb6');
  g.fillStyle = bg; g.fillRect(x, y, n, n);
  g.strokeStyle = 'rgba(176, 120, 40, 0.55)'; g.lineWidth = n * 0.018;
  const m = n * 0.15, rr = n * 0.08;
  g.beginPath(); g.roundRect(x + m, y + m, n - 2 * m, n - 2 * m, rr); g.stroke();
}

// ------------------------------------------------------------------ textures
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function loadImage(src) { return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }
const CELL = 256;
function atlasTexture() { // 3 × 2 cells: heart spade diamond / club flag crown
  const [c, g] = canvas(CELL * 3, CELL * 2);
  SYMBOLS.forEach((s, i) => {
    const x = (i % 3) * CELL, y = Math.floor(i / 3) * CELL;
    faceBackground(g, x, y, CELL);
    drawSymbol(g, s, x + CELL / 2, y + CELL / 2, CELL * 0.29);
  });
  return c;
}
function feltTexture() { // deep red velvet with a gold rangoli / mandala
  const n = 1024, [c, g] = canvas(n, n), m = n / 2;
  const bg = g.createRadialGradient(m, m, 40, m, m, m);
  bg.addColorStop(0, '#a3132a'); bg.addColorStop(0.75, '#7c0a1e'); bg.addColorStop(1, '#5a0615');
  g.fillStyle = bg; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.035})`; g.fillRect(Math.random() * n, Math.random() * n, 2, 2); }
  g.translate(m, m);
  g.strokeStyle = 'rgba(255, 200, 90, 0.42)'; g.fillStyle = 'rgba(255, 196, 80, 0.16)'; g.lineWidth = 3;
  for (const r of [470, 452]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
  for (let k = 0; k < 24; k++) { // outer petals
    g.save(); g.rotate((k / 24) * Math.PI * 2);
    g.beginPath(); g.moveTo(0, -330); g.quadraticCurveTo(40, -390, 0, -440); g.quadraticCurveTo(-40, -390, 0, -330); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, -300, 7, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.beginPath(); g.arc(0, 0, 300, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 12; k++) { // inner lotus
    g.save(); g.rotate((k / 12) * Math.PI * 2 + 0.26);
    g.beginPath(); g.moveTo(0, -60); g.bezierCurveTo(70, -120, 50, -200, 0, -230); g.bezierCurveTo(-50, -200, -70, -120, 0, -60); g.fill(); g.stroke();
    g.restore();
  }
  for (const r of [56, 40]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
  return c;
}
function woodTexture() {
  const [c, g] = canvas(512, 512); // dark polished rosewood, fine grain
  g.fillStyle = '#3a1709'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = `rgba(${Math.random() < 0.55 ? '112,46,20' : '22,8,3'},${0.18 + Math.random() * 0.3})`; g.lineWidth = 0.6 + Math.random() * 1.6;
    const y = Math.random() * 512; g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x / 90 + i * 0.37) * 5 + Math.sin(x / 23 + i) * 1.2);
    g.stroke();
  }
  return c;
}
function glowTexture() {
  const [c, g] = canvas(256, 256), r = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  r.addColorStop(0, 'rgba(255,236,170,1)'); r.addColorStop(0.35, 'rgba(255,196,70,0.75)'); r.addColorStop(0.7, 'rgba(255,150,30,0.22)'); r.addColorStop(1, 'rgba(255,140,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  return c;
}
function shadowTexture() {
  const [c, g] = canvas(128, 128), r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, 'rgba(0,0,0,0.55)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return c;
}

// ------------------------------------------------------------------ cube symmetries + face frames
const AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
// BoxGeometry face order: +x −x +y −y +z −z. The symbol (value 1–6) on each face:
const FACE_SYMBOL = [2, 5, 1, 6, 3, 4]; // +x spade, −x flag, +y heart, −y crown, +z diamond, −z club (opposites: heart–crown, spade–flag, diamond–club)
const SYMBOL_FACE = [];
FACE_SYMBOL.forEach((v, f) => { SYMBOL_FACE[v] = f; });
const CUBE_ROT = (() => { // the 24 rotations of the cube (signed permutation matrices, det +1)
  const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const m = new THREE.Matrix3(), e = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 3; r++) e[r * 3 + p[r]] = (s >> r) & 1 ? -1 : 1; // row-major
    m.set(...e);
    if (Math.abs(m.determinant() - 1) < 1e-6) out.push(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(m)));
  }
  return out;
})();

// ------------------------------------------------------------------ the throws
async function loadThrows() {
  const r = await fetch(BASE + 'throws.bin');
  if (!r.ok) throw new Error('throws.bin ' + r.status);
  const a = new Int16Array(await r.arrayBuffer()), per = FRAMES * 6 * 7, V = Math.floor(a.length / per);
  const throws = [];
  for (let v = 0; v < V; v++) {
    const pos = new Float32Array(FRAMES * 6 * 3), quat = new Float32Array(FRAMES * 6 * 4);
    for (let f = 0; f < FRAMES; f++) for (let d = 0; d < 6; d++) {
      const o = v * per + (f * 6 + d) * 7, k = f * 6 + d;
      pos[k * 3] = a[o] / 1000; pos[k * 3 + 1] = a[o + 1] / 1000; pos[k * 3 + 2] = a[o + 2] / 1000;
      let x = a[o + 3] / 32767, y = a[o + 4] / 32767, z = a[o + 5] / 32767, w = a[o + 6] / 32767;
      const n = Math.hypot(x, y, z, w) || 1; quat[k * 4] = x / n; quat[k * 4 + 1] = y / n; quat[k * 4 + 2] = z / n; quat[k * 4 + 3] = w / n;
    }
    // when each die stops moving, and the bounces (for the sound): vertical speed turning from falling to rising
    let rest = 0;
    const impacts = [];
    for (let f = 2; f < FRAMES; f++) for (let d = 0; d < 6; d++) {
      const k0 = ((f - 2) * 6 + d) * 3, k1 = ((f - 1) * 6 + d) * 3, k2 = (f * 6 + d) * 3;
      const v1 = (pos[k1 + 1] - pos[k0 + 1]) * FPS, v2 = (pos[k2 + 1] - pos[k1 + 1]) * FPS;
      const sp = Math.hypot(pos[k2] - pos[k1], pos[k2 + 1] - pos[k1 + 1], pos[k2 + 2] - pos[k1 + 2]) * FPS;
      if (sp > 0.05) rest = f / FPS;
      if (v1 < -2.2 && v2 > v1 * 0.2) impacts.push({ t: (f - 1) / FPS, s: clamp(-v1 / 14, 0.15, 1) });
    }
    impacts.sort((x, y) => x.t - y.t);
    throws.push({ pos, quat, rest, impacts });
  }
  return throws;
}

// ------------------------------------------------------------------ WebGL scene
export async function create(cv, hooks) {
  hooks = hooks || {};
  let gl = null;
  try { gl = cv.getContext('webgl2', { antialias: true }) || cv.getContext('webgl', { antialias: true }); } catch (e) { gl = null; }
  if (!gl) return create2D(cv, hooks);
  try { return await create3D(cv, hooks); } catch (e) { console.warn('3D table unavailable', e); return create2D(cv, hooks); }
}

async function create3D(cv, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0xc08a52, 1);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (c, rep) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); } return t; };
  const [throws, backImg] = await Promise.all([loadThrows(), loadImage(BASE + 'backdrop.webp')]);

  // ---- courtyard: the backdrop picture behind the table (scene background, fitted on resize)
  let backTex = null;
  if (backImg) {
    backTex = new THREE.Texture(backImg); backTex.colorSpace = THREE.SRGBColorSpace; backTex.needsUpdate = true;
    backTex.generateMipmaps = false; backTex.minFilter = THREE.LinearFilter;
    scene.background = backTex;
  }
  function fitBackdrop() { // the picture spans the canvas width, its top at the canvas top (wide canvases: cropped)
    if (!backTex) return;
    const ia = backImg.width / backImg.height, h = (W / ia) / H, T = window.__jmTune || {};
    if (h <= 1) { backTex.repeat.set(1, 1 / h); backTex.offset.set(0, -(1 - h) / h); }
    else { const ry = 1 / h; backTex.repeat.set(1, ry); backTex.offset.set(0, (1 - ry) * (T.bgy != null ? T.bgy : 0.55)); }
    backTex.updateMatrix();
  }

  // ---- table, tray, velvet
  const wood = new THREE.MeshStandardMaterial({ map: tex(woodTexture(), 2), color: 0xd09a78, roughness: 0.38, metalness: 0.05 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xf0b23a, metalness: 1, roughness: 0.28, envMapIntensity: 1.25 });
  const TABLE_R = 10.4;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.5, 96), wood); top.position.y = -0.25; top.receiveShadow = true; scene.add(top);
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R - 0.2, TABLE_R - 0.9, 2.4, 64, 1, true), wood); apron.position.y = -1.7; scene.add(apron);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R, 0.16, 12, 128), brass); edge.rotation.x = Math.PI / 2; edge.position.y = -0.02; scene.add(edge);
  const felt = new THREE.Mesh(new THREE.CircleGeometry(5.42, 96), new THREE.MeshLambertMaterial({ map: tex(feltTexture()) }));
  felt.rotation.x = -Math.PI / 2; felt.position.y = 0.004; felt.receiveShadow = true; scene.add(felt);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(5.62, 5.62, 1.4, 96, 1, true), brass); wall.position.y = 0.7; wall.castShadow = false; scene.add(wall);
  const wallIn = new THREE.Mesh(new THREE.CylinderGeometry(5.44, 5.44, 1.38, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x6a0a18, roughness: 0.9, side: THREE.BackSide })); wallIn.position.y = 0.69; scene.add(wallIn);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(5.53, 0.13, 12, 128), brass); lip.rotation.x = Math.PI / 2; lip.position.y = 1.4; scene.add(lip);
  const foot = new THREE.Mesh(new THREE.TorusGeometry(5.66, 0.1, 10, 128), brass); foot.rotation.x = Math.PI / 2; foot.position.y = 0.08; scene.add(foot);
  // brass studs round the rim
  const studs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 12, 8), brass, 36);
  const M = new THREE.Matrix4();
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; M.makeTranslation(Math.cos(a) * 5.66, 0.72, Math.sin(a) * 5.66); studs.setMatrixAt(i, M); }
  scene.add(studs);

  // ---- marigold garland: swags hanging from the table edge (instanced flowers)
  {
    const N = 340, geo = new THREE.IcosahedronGeometry(0.24, 1);
    const mats = [new THREE.MeshLambertMaterial({ color: 0xff8a00 }), new THREE.MeshLambertMaterial({ color: 0xffc21a })];
    const per = [Math.ceil(N / 2), Math.floor(N / 2)].map((n, k) => new THREE.InstancedMesh(geo, mats[k], n));
    const idx = [0, 0], swags = 22;
    for (let i = 0; i < N; i++) {
      const u = i / N, a = u * Math.PI * 2, sw = (u * swags) % 1, sag = Math.sin(sw * Math.PI) * 0.9;
      const r = TABLE_R + 0.18, k = Math.floor(i / 6) % 2;
      M.makeTranslation(Math.cos(a) * r, -0.12 - sag, Math.sin(a) * r);
      per[k].setMatrixAt(idx[k]++, M);
    }
    per.forEach((m) => scene.add(m));
  }

  // ---- bunting over the courtyard (two strings of pennants, gently swaying)
  const flagCols = [0xff7a00, 0xe8177d, 0x12a150, 0x18b6c4, 0xf5c21b, 0x7b2fd0];
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.45, 0, 0, 0.45, 0, 0, 0, -1.05, 0], 3));
  flagGeo.computeVertexNormals();
  const strings = [];
  function bunting(from, to, sag, n) {
    const mesh = new THREE.InstancedMesh(flagGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), n);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, p = new THREE.Vector3().lerpVectors(from, to, u); p.y -= Math.sin(u * Math.PI) * sag;
      pts.push(p); mesh.setColorAt(i, new THREE.Color(flagCols[i % flagCols.length]));
    }
    const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from.clone(), ...pts, to.clone()]), 64, 0.03, 4), new THREE.MeshBasicMaterial({ color: 0x6b4a2a }));
    scene.add(mesh, cord);
    strings.push({ mesh, pts, dir: new THREE.Vector3().subVectors(to, from).normalize() });
  }
  bunting(new THREE.Vector3(-24, 11, -15), new THREE.Vector3(24, 13, -15), 3.2, 30);
  bunting(new THREE.Vector3(-26, 14, -6), new THREE.Vector3(22, 10.5, -8), 2.6, 32);
  const Q = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), E = new THREE.Euler();
  function swayBunting(t) {
    strings.forEach((s, si) => {
      s.pts.forEach((p, i) => {
        E.set(Math.sin(t * 1.3 + i * 0.7 + si) * 0.28, Math.atan2(-s.dir.z, s.dir.x), Math.sin(t * 0.9 + i) * 0.05);
        Q.setFromEuler(E); M.compose(p, Q, S1); s.mesh.setMatrixAt(i, M);
      });
      s.mesh.instanceMatrix.needsUpdate = true;
    });
  }
  swayBunting(0);

  // ---- the brass cup
  const cupProfile = [[0, 0], [1.46, 0], [1.54, 0.06], [1.6, 0.5], [1.74, 1.9], [1.9, 2.9], [1.96, 3.02], [1.9, 3.06], [1.8, 2.94], [1.64, 1.9], [1.48, 0.52], [1.4, 0.16], [0, 0.16]].map(([x, y]) => new THREE.Vector2(x, y));
  const cup = new THREE.Group(); scene.add(cup);
  const cupBody = new THREE.Mesh(new THREE.LatheGeometry(cupProfile, 48), new THREE.MeshStandardMaterial({ color: 0xf2b640, metalness: 1, roughness: 0.24, side: THREE.DoubleSide, envMapIntensity: 1.3 }));
  cupBody.castShadow = true; cup.add(cupBody);
  for (const [y, r] of [[0.62, 1.62], [2.5, 1.86]]) { const b = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 8, 64), new THREE.MeshStandardMaterial({ color: 0xa8641a, metalness: 1, roughness: 0.35 })); b.rotation.x = Math.PI / 2; b.position.y = y; cup.add(b); }
  const cupShadow = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: tex(shadowTexture()), transparent: true, depthWrite: false }));
  cupShadow.rotation.x = -Math.PI / 2; cupShadow.position.y = 0.01; scene.add(cupShadow);

  // ---- six dice
  const atlas = tex(atlasTexture());
  atlas.generateMipmaps = true;
  const dieGeo = new RoundedBoxGeometry(DIE, DIE, DIE, 4, 0.1);
  { // map each face onto its symbol's atlas cell; find each face's "symbol up" direction (+v of its uvs)
    const uv = dieGeo.attributes.uv, pos = dieGeo.attributes.position, per = uv.count / 6;
    for (let f = 0; f < 6; f++) {
      const s = FACE_SYMBOL[f] - 1, col = s % 3, row = Math.floor(s / 3);
      const pm = new THREE.Vector3(), up = new THREE.Vector3(), p = new THREE.Vector3();
      let vm = 0;
      for (let i = f * per; i < (f + 1) * per; i++) vm += uv.getY(i);
      vm /= per;
      for (let i = f * per; i < (f + 1) * per; i++) pm.add(p.fromBufferAttribute(pos, i));
      pm.divideScalar(per);
      for (let i = f * per; i < (f + 1) * per; i++) up.addScaledVector(p.fromBufferAttribute(pos, i).sub(pm), uv.getY(i) - vm);
      up.addScaledVector(AX[f], -up.dot(AX[f])).normalize();
      FACE_UP[f] = new THREE.Vector3(Math.round(up.x), Math.round(up.y), Math.round(up.z));
      for (let i = f * per; i < (f + 1) * per; i++) {
        uv.setXY(i, (col + 0.004 + uv.getX(i) * 0.992) / 3, (1 - row + 0.004 + uv.getY(i) * 0.992) / 2);
      }
    }
    uv.needsUpdate = true;
  }
  const glowTex = tex(glowTexture()), shTex = tex(shadowTexture());
  const dice = [];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.28, metalness: 0, emissive: 0xffb02a, emissiveIntensity: 0, emissiveMap: atlas });
    const mesh = new THREE.Mesh(dieGeo, mat); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }));
    halo.rotation.x = -Math.PI / 2; halo.visible = false; halo.renderOrder = 1; scene.add(halo);
    const soft = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0.5 }));
    soft.rotation.x = -Math.PI / 2; soft.renderOrder = 0; scene.add(soft);
    dice.push({ mesh, mat, halo, soft, C: new THREE.Quaternion(), F: new THREE.Quaternion(), win: 0, winTo: 0, dim: 0, dimTo: 0, value: 0 });
  }

  // ---- light: the sun (shadows of the dice and cup), sky fill
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xd29a5a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(-7, 16, 9); sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 4, far: 40 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // ------------------------------------------------------------------ state
  // mode: rest (dice lying in the tray) | gather (cup collects them) | shake | throw
  let mode = 'rest', modeAt = now(), variant = 0, throwT0 = 0, settledSent = true, impactIdx = 0, lastRattle = 0;
  let gatherFrom = [], cupFrom = { pos: REST_POS.clone(), rot: 0 }, highlightOn = false;
  let W = 1, H = 1, area = { L: 0, T: 0, W: 1, H: 1 }, sizeKey = '', raf = 0, lastFrame = 0, viewName = 'table', resultCenter = new THREE.Vector3(), resultSpan = 3;
  const camPos = new THREE.Vector3(0, 12, 14), camTgt = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantTgt = new THREE.Vector3();
  let camSnap = true, lastArgs = null, wantOff = 0, curOff = 0;
  const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), AWAY = new THREE.Vector3(0, 0, -1);

  function variantOf(round) { return ((Math.abs(round | 0) * 7919 + 13) % throws.length + throws.length) % throws.length; }
  function sample(v, t, d, outP, outQ) { // die d of throw v at sim time t (s): position + raw orientation
    const T = throws[v], f = clamp(t * FPS, 0, FRAMES - 1), i0 = Math.floor(f), i1 = Math.min(FRAMES - 1, i0 + 1), a = f - i0;
    const k0 = i0 * 6 + d, k1 = i1 * 6 + d;
    outP.set(T.pos[k0 * 3] + (T.pos[k1 * 3] - T.pos[k0 * 3]) * a, T.pos[k0 * 3 + 1] + (T.pos[k1 * 3 + 1] - T.pos[k0 * 3 + 1]) * a, T.pos[k0 * 3 + 2] + (T.pos[k1 * 3 + 2] - T.pos[k0 * 3 + 2]) * a);
    tmpQ.set(T.quat[k0 * 4], T.quat[k0 * 4 + 1], T.quat[k0 * 4 + 2], T.quat[k0 * 4 + 3]);
    tmpQ2.set(T.quat[k1 * 4], T.quat[k1 * 4 + 1], T.quat[k1 * 4 + 2], T.quat[k1 * 4 + 3]);
    outQ.slerpQuaternions(tmpQ, tmpQ2, a);
  }
  // the constant corrections that put symbol `value` on top of die d at the end of throw v
  function corrections(v, values) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    values.forEach((value, d) => {
      const D = dice[d];
      sample(v, (FRAMES - 1) / FPS, d, p, q);
      let best = -2, fSim = 0;
      for (let f = 0; f < 6; f++) { const y = tmpV.copy(AX[f]).applyQuaternion(q).y; if (y > best) { best = y; fSim = f; } }
      D.F.setFromUnitVectors(tmpV.copy(AX[fSim]).applyQuaternion(q).normalize(), UP); // flatten the tiny resting tilt
      const qEnd = new THREE.Quaternion().multiplyQuaternions(D.F, q), fReq = SYMBOL_FACE[value];
      let bestUp = -2;
      for (const C of CUBE_ROT) {
        if (tmpV.copy(AX[fReq]).applyQuaternion(C).distanceTo(AX[fSim]) > 1e-3) continue;
        const u = tmpV.copy(FACE_UP[fReq]).applyQuaternion(C).applyQuaternion(qEnd).dot(AWAY);
        if (u > bestUp) { bestUp = u; D.C.copy(C); }
      }
      D.value = value;
    });
  }
  function placeDice(v, t) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    dice.forEach((D, d) => {
      sample(v, t, d, p, q);
      D.mesh.position.copy(p);
      D.mesh.quaternion.multiplyQuaternions(D.F, q).multiply(D.C);
      D.mesh.visible = true;
    });
  }
  function placeShadows() {
    dice.forEach((D) => {
      const p = D.mesh.position, h = clamp((p.y - 0.5) / 3, 0, 1);
      D.soft.visible = D.mesh.visible && Math.hypot(p.x, p.z) < 5.3;
      D.soft.position.set(p.x + 0.12, 0.012, p.z + 0.08); D.soft.scale.setScalar(1 + h * 0.8); D.soft.material.opacity = (shadowsOn ? 0.26 : 0.5) * (1 - h * 0.7);
      D.halo.position.set(p.x, 0.016, p.z);
    });
  }
  function cupAt(pos, rot) {
    cup.position.copy(pos); cup.rotation.set(rot, 0, 0);
    const h = clamp((pos.y - 0) / 6, 0, 1);
    cupShadow.position.set(pos.x + 0.4 + h * 0.6, pos.y > 0.5 ? 0.02 : -10, pos.z + 0.3); cupShadow.scale.setScalar(1 + h); cupShadow.material.opacity = 0.5 * (1 - h * 0.6);
  }
  cupAt(REST_POS, 0);
  // resting layout before any round: throw 0's end, faces 1–6
  corrections(0, [1, 2, 3, 4, 5, 6]); placeDice(0, (FRAMES - 1) / FPS);

  // ------------------------------------------------------------------ quality
  // ?hq=1 keeps full quality (card captures); window.__jmTune overrides the table framing (QA / card captures)
  let shadowsOn = true, perfN = /[?&]hq=1/.test(location.search) ? -1 : 0, perfSum = 0, lowQ = false;
  function lowQuality() {
    if (lowQ) return;
    lowQ = true; shadowsOn = false;
    renderer.shadowMap.enabled = false; sun.castShadow = false;
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    sizeKey = ''; lastArgs && api.resize(...lastArgs);
  }

  // ------------------------------------------------------------------ camera framing
  function frame(name) {
    const a = area;
    // the result view keeps clear of the result tokens above and the win banner below (px of the play area)
    const top = name === 'result' ? (a.W < 700 ? 96 : 58) : 0, bottom = name === 'result' && a.W < 700 ? 64 : 0;
    const aH = Math.max(80, a.H - top - bottom), aspect = a.W / aH;
    const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (aH / Math.max(1, H)); // tan of half the view's vertical angle
    let el, tgt, hw, hh;
    if (name === 'result') { // nearly straight down, so every die's top face reads clearly
      el = 72; tgt = tmpV.copy(resultCenter); hw = resultSpan + 0.5; hh = resultSpan + 0.3;
    } else {
      const T = window.__jmTune || {}, ph = a.W / Math.max(1, a.H) < 1.25;
      el = T.el != null ? T.el : (ph ? 32 : 34); tgt = tmpV.set(0, 0, T.tz != null ? T.tz : (ph ? -3 : -1.6)); hw = T.hw || (ph ? 7.3 : 7); hh = T.hh || (ph ? 5.6 : 5.4);
    }
    const dist = Math.max(hh / vt, hw / (vt * aspect));
    const r = THREE.MathUtils.degToRad(el);
    wantTgt.copy(tgt);
    wantPos.set(tgt.x, tgt.y + Math.sin(r) * dist, tgt.z + Math.cos(r) * dist);
    wantOff = (top - bottom) / 2;
  }
  function applyCamera() {
    camera.position.copy(camPos); camera.lookAt(camTgt);
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - (area.L + area.W / 2), H / 2 - (area.T + area.H / 2 + curOff), W, H);
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ loop
  function loop() {
    raf = requestAnimationFrame(loop);
    const t = now(), dt = Math.min(0.1, (t - (lastFrame || t)) / 1000);
    const busy = perfN >= 0 || mode !== 'rest' || highlightOn || camPos.distanceToSquared(wantPos) > 1e-4 || Math.abs(curOff - wantOff) > 0.3 || dice.some((D) => D.win !== D.winTo || D.dim !== D.dimTo);
    if (!busy && t - lastFrame < 45 && !camSnap) return; // idle: ~20 fps is enough for the bunting
    if (perfN >= 0 && lastFrame) { // the first ~2 s: if the device is slow, drop shadows + resolution once
      perfSum += t - lastFrame; perfN++;
      if (perfN === 40) {
        if (perfSum / perfN > 34) lowQuality();
        perfN = -1;
      }
    }
    lastFrame = t;
    const el = (t - modeAt) / 1000;
    if (mode === 'gather') {
      const u = clamp((t - modeAt) / GATHER_MS, 0, 1), cu = ease(clamp(u / 0.55, 0, 1));
      tmpV.lerpVectors(cupFrom.pos, SHAKE_POS, cu); tmpV.y += Math.sin(cu * Math.PI) * 1.4; // lifted over the tray's rim
      cupAt(tmpV, cupFrom.rot * (1 - cu));
      const mouth = new THREE.Vector3(SHAKE_POS.x, SHAKE_POS.y + CUP_H, SHAKE_POS.z);
      dice.forEach((D, i) => {
        const g = gatherFrom[i], k = clamp((u - 0.25 - i * 0.05) / 0.45, 0, 1), e = ease(k);
        if (k >= 1) { D.mesh.visible = false; return; }
        D.mesh.visible = true;
        D.mesh.position.lerpVectors(g.p, mouth, e); D.mesh.position.y += Math.sin(k * Math.PI) * 2.4;
        D.mesh.quaternion.copy(g.q); D.mesh.rotateX(e * 4 + i); D.mesh.rotateZ(e * 3);
      });
      if (u >= 1) { mode = 'shake'; modeAt = t; }
    } else if (mode === 'shake') {
      const s = Math.sin(el * 2 * Math.PI * 6.5), s2 = Math.sin(el * 2 * Math.PI * 3.25 + 1);
      cupAt(tmpV.set(SHAKE_POS.x + s * 0.32, SHAKE_POS.y + Math.abs(s2) * 0.28, SHAKE_POS.z + s2 * 0.12), s2 * 0.08);
      cup.rotation.z = s * 0.11;
      dice.forEach((D) => { D.mesh.visible = false; });
      if (t - lastRattle > 150) { lastRattle = t; hooks.rattle && hooks.rattle(); }
    } else if (mode === 'throw') {
      const te = t - throwT0;
      // the cup: tips over (TIP_MS), then rights itself and goes back to its place
      if (te < TIP_MS) {
        const u = ease(clamp(te / TIP_MS, 0, 1));
        cupAt(tmpV.lerpVectors(cupFrom.pos, TIP_POS, u), cupFrom.rot + (TIP_ANGLE - cupFrom.rot) * u);
      } else {
        const u = ease(clamp((te - TIP_MS - 250) / 1300, 0, 1));
        cupAt(tmpV.lerpVectors(TIP_POS, REST_POS, u).setY(TIP_POS.y + (REST_POS.y - TIP_POS.y) * u + Math.sin(u * Math.PI) * 1.6), TIP_ANGLE * (1 - u));
      }
      const ts = (te - OUT_MS) / 1000;
      if (ts < 0) dice.forEach((D) => { D.mesh.visible = false; });
      else {
        placeDice(variant, ts);
        const im = throws[variant].impacts;
        while (impactIdx < im.length && im[impactIdx].t <= ts) { if (ts - im[impactIdx].t < 0.12 && hooks.impact) hooks.impact(im[impactIdx].s); impactIdx++; }
        if (!settledSent && ts >= throws[variant].rest + 0.12) { settledSent = true; hooks.settled && hooks.settled(); }
        if (ts >= (FRAMES - 1) / FPS && te > TIP_MS + 1600) { mode = 'rest'; placeDice(variant, (FRAMES - 1) / FPS); cupAt(REST_POS, 0); }
      }
    }
    // highlight: winning dice glow and get a halo; the others dim
    const pulse = 0.5 + 0.5 * Math.sin(t / 260);
    dice.forEach((D) => {
      if (D.win !== D.winTo) D.win = D.winTo > D.win ? Math.min(D.winTo, D.win + dt / 0.5) : Math.max(D.winTo, D.win - dt / 0.4);
      if (D.dim !== D.dimTo) D.dim = D.dimTo > D.dim ? Math.min(D.dimTo, D.dim + dt / 0.5) : Math.max(D.dimTo, D.dim - dt / 0.4);
      const w = smooth(D.win);
      D.mat.emissiveIntensity = w * (0.16 + 0.12 * pulse);
      D.mat.color.setScalar(1 - 0.38 * smooth(D.dim));
      D.halo.visible = w > 0.01; D.halo.material.opacity = w * (0.55 + 0.3 * pulse); D.halo.scale.setScalar(0.9 + 0.12 * pulse);
    });
    placeShadows();
    swayBunting(t / 1000);
    // camera eases to its framing
    if (camSnap) { camPos.copy(wantPos); camTgt.copy(wantTgt); curOff = wantOff; camSnap = false; }
    else { const k = 1 - Math.exp(-dt * 2.6); camPos.lerp(wantPos, k); camTgt.lerp(wantTgt, k); curOff += (wantOff - curOff) * k; }
    applyCamera();
    renderer.render(scene, camera);
  }

  function setRestFromDice() { // dice positions now → the gather start
    gatherFrom = dice.map((D) => ({ p: D.mesh.position.clone(), q: D.mesh.quaternion.clone() }));
  }

  const api = {
    kind: 'webgl', topColor: TOP_COLOR, renderer,
    resize(w, h, a) {
      lastArgs = [w, h, a];
      const dpr = lowQ ? 1 : Math.min(window.devicePixelRatio || 1, w < 900 ? 1.5 : 1.75);
      const key = [Math.round(w), Math.round(h), Math.round(a.L), Math.round(a.T), Math.round(a.W), Math.round(a.H), dpr].join(',');
      if (key === sizeKey) return; // same place and size: nothing to do (a same-size resize would blink)
      sizeKey = key;
      W = Math.max(1, Math.round(w)); H = Math.max(1, Math.round(h)); area = a;
      // one drawing-buffer change, and only when the pixel size really changes (a same-size set blinks)
      const cur = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (cur.x !== Math.floor(W * dpr) || cur.y !== Math.floor(H * dpr) || renderer.getPixelRatio() !== dpr) renderer.setDrawingBufferSize(W, H, dpr);
      fitBackdrop(); frame(viewName); camSnap = true;
      lastFrame = 0;
    },
    // the dice lie in the tray showing `values` (the last result), as thrown in round `round`
    rest(values, round) {
      if (mode === 'throw' || mode === 'gather' || mode === 'shake') return;
      variant = variantOf(round || 0);
      corrections(variant, values && values.length === 6 ? values : [1, 2, 3, 4, 5, 6]);
      placeDice(variant, (FRAMES - 1) / FPS); cupAt(REST_POS, 0); mode = 'rest';
    },
    // no more bets: the cup collects the dice and starts shaking (until throwDice)
    gather() {
      if (mode === 'gather' || mode === 'shake') return;
      api.highlight(null);
      setRestFromDice();
      cupFrom = { pos: cup.position.clone(), rot: cup.rotation.x };
      mode = 'gather'; modeAt = now();
    },
    shaking() { return mode === 'gather' || mode === 'shake'; },
    // the dice step: throw so the dice end on `values`; elapsedMs = how long ago the step was (a late joiner seeks in)
    throwDice(values, round, elapsedMs) {
      api.highlight(null);
      variant = variantOf(round);
      corrections(variant, values);
      const e = Math.max(0, elapsedMs || 0);
      if (mode !== 'shake' && mode !== 'gather') cupFrom = { pos: e > 0 ? REST_POS.clone() : cup.position.clone(), rot: cup.rotation.x };
      else cupFrom = { pos: cup.position.clone(), rot: cup.rotation.x };
      cup.rotation.z = 0;
      throwT0 = now() - e; mode = 'throw';
      const ts = (e - OUT_MS) / 1000;
      settledSent = ts >= throws[variant].rest + 0.12;
      impactIdx = 0;
      const im = throws[variant].impacts; while (impactIdx < im.length && im[impactIdx].t < ts) impactIdx++;
      if (e > TIP_MS) cupFrom = { pos: SHAKE_POS.clone(), rot: 0 };
      if (hooks.tip && e < TIP_MS) hooks.tip();
      return Math.max(0, OUT_MS + (throws[variant].rest + 0.12) * 1000 - e);
    },
    // light the dice of the winning symbols (values with 2+ dice); null = all plain
    highlight(values) {
      highlightOn = !!values;
      if (!values) { dice.forEach((D) => { D.winTo = 0; D.dimTo = 0; }); api.view('table'); return; }
      const count = {}; values.forEach((v) => { count[v] = (count[v] || 0) + 1; });
      dice.forEach((D) => { const w = count[D.value] >= 2; D.winTo = w ? 1 : 0; D.dimTo = w ? 0 : 1; });
      // the result view: centred on the dice
      const c = new THREE.Vector3(); dice.forEach((D) => c.add(D.mesh.position)); c.divideScalar(6); c.y = 0.5;
      let span = 0; dice.forEach((D) => { span = Math.max(span, Math.hypot(D.mesh.position.x - c.x, (D.mesh.position.z - c.z) * 1.2)); });
      resultCenter.copy(c); resultSpan = clamp(span + 0.7, 2.2, 5);
      api.view('result');
    },
    view(name) { viewName = name; frame(name); },
    // QA: the symbol value on top of each die, read back from the rendered transforms
    topFaces() {
      return dice.map((D) => {
        let best = -2, f = 0;
        for (let k = 0; k < 6; k++) { const y = tmpV.copy(AX[k]).applyQuaternion(D.mesh.quaternion).y; if (y > best) { best = y; f = k; } }
        return { value: FACE_SYMBOL[f], up: +best.toFixed(4), visible: D.mesh.visible, x: +D.mesh.position.x.toFixed(2), z: +D.mesh.position.z.toFixed(2) };
      });
    },
    retune() { sizeKey = ''; fitBackdrop(); frame(viewName); camSnap = true; lastFrame = 0; },
    debug: () => ({ mode, variant, variants: throws.length, lowQ, rest: throws.map((t) => t.rest) }),
  };
  raf = requestAnimationFrame(loop);
  return api;
}
const FACE_UP = [];

// ------------------------------------------------------------------ 2D fallback (no WebGL): the six dice as tiles
function create2D(cv, hooks) {
  const g = cv.getContext('2d');
  let W = 1, H = 1, area = { L: 0, T: 0, W: 1, H: 1 }, vals = [1, 2, 3, 4, 5, 6], win = null, shake = false, sizeKey = '', settleT = 0;
  function draw() {
    const dpr = cv.width / Math.max(1, W);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#c08a52'); bg.addColorStop(1, '#5a0615');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const s = Math.min(area.W / 3.6, area.H / 2.6, 110), x0 = area.L + area.W / 2 - s * 1.65, y0 = area.T + area.H / 2 - s * 1.1;
    const count = {}; vals.forEach((v) => { count[v] = (count[v] || 0) + 1; });
    vals.forEach((v, i) => {
      const x = x0 + (i % 3) * s * 1.15, y = y0 + Math.floor(i / 3) * s * 1.15 + (shake ? Math.sin(performance.now() / 40 + i) * 4 : 0);
      g.save(); g.globalAlpha = win && count[v] < 2 ? 0.55 : 1;
      faceBackground(g, x, y, s);
      if (!shake) drawSymbol(g, SYMBOLS[v - 1], x + s / 2, y + s / 2, s * 0.3);
      if (win && count[v] >= 2) { g.strokeStyle = '#ffc23a'; g.lineWidth = 4; g.strokeRect(x - 2, y - 2, s + 4, s + 4); }
      g.restore();
    });
    if (shake) requestAnimationFrame(draw);
  }
  return {
    kind: '2d', topColor: TOP_COLOR,
    resize(w, h, a) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), key = [w, h, a.L, a.T, a.W, a.H, dpr].join(',');
      if (key === sizeKey) return;
      sizeKey = key; W = w; H = h; area = a;
      const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (cv.width !== cw) cv.width = cw;
      if (cv.height !== ch) cv.height = ch;
      draw();
    },
    rest(v) { if (v && v.length === 6) vals = v.slice(); shake = false; draw(); },
    gather() { win = null; shake = true; draw(); },
    shaking() { return shake; },
    throwDice(v, round, e) { vals = v.slice(); shake = false; draw(); clearTimeout(settleT); const ms = Math.max(0, 1200 - (e || 0)); settleT = setTimeout(() => hooks.settled && hooks.settled(), ms); return ms; },
    highlight(v) { win = v; draw(); },
    view() {},
    topFaces() { return vals.map((v) => ({ value: v, up: 1, visible: true })); },
    debug: () => ({ mode: shake ? 'shake' : 'rest' }),
  };
}
