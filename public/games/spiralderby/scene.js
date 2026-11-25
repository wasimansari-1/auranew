/* Spiral Derby — the 3D marble machine (three.js 0.170.0, shared copy in ../_core/vendor).
 *
 * A smoked-violet acrylic gutter track with gold rails runs from the start gate (NEXORNG wordmark
 * sign) down a ramp, round a bumper U-turn, down a second ramp, 1.5 turns around the spiral tower
 * (NX mark on top), along a run-out, round a bumper hairpin and down the home straight through the
 * FINISH arch into the rack (1ST … 8TH pads). A glass lift carries the marbles back to the gate.
 *
 * Everything moves analytically from a clock (never per-frame increments), so motion is the same
 * at any frame rate:
 *   race     the engine's keyframes (race.js decode → Catmull-Rom), rolled by distance;
 *   lift     each marble rides a smooth path rack → lift → gate (smootherstep, staggered);
 *   camera   a critically damped spring follows a target pose (overview → gate → pack → rack).
 * Numbers are on the roll-axis poles (they face the side of the track); the roll is corrected over
 * the last metres so every number stands upright in the rack.
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), idle(), gateIn(msLeft), race(r, t0),
 *      parked(order, glow), lift(order, t0), raceTime(), kind, topColor, debug() }>
 * hooks: bump(level), clack(level), roll(level 0–1), cross(place); cameraPose() → [[x,y,z],[x,y,z]] (stills only)
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';

const SD = window.SDRace;
const R = SD.R, HALF = SD.HALF;
const TOP_COLOR = '#140830';
const COL = { 1: '#e8344a', 2: '#ff8a1f', 3: '#ffd23a', 4: '#5fd35a', 5: '#22c7e0', 6: '#3b6cff', 7: '#a855f7', 8: '#ff4fb3' };
const PLACE = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'];
const LIFT_S = 3.1, LIFT_GAP = 0.22;

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const smoother = (u) => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
const now = () => performance.now() / 1000;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function textTex(text, w, h, o = {}) {
  return canvasTex(w, h, (x) => {
    if (o.bg) { x.fillStyle = o.bg; x.fillRect(0, 0, w, h); }
    x.font = o.font || `900 ${Math.round(h * 0.62)}px Outfit, system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (o.gold) { const g = x.createLinearGradient(0, h * 0.2, 0, h * 0.8); g.addColorStop(0, '#fff3cf'); g.addColorStop(0.55, '#ffcf6b'); g.addColorStop(1, '#e59a2f'); x.fillStyle = g; } else x.fillStyle = o.color || '#fff';
    x.fillText(text, w / 2, h / 2 + (o.dy || 0));
  });
}
function loadImage(src) { return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }
function cropTex(img, sx, sy, sw, sh, w, h, bg) {
  return canvasTex(w, h, (x) => { if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); } if (img) x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h); });
}
function hasWebGL() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }

export async function create(cv, hooks) {
  hooks = hooks || {};
  try { await Promise.race([Promise.all([document.fonts.load('900 40px Outfit'), document.fonts.load('800 40px Outfit')]), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* system font */ }
  if (!hasWebGL()) return create2D(cv);
  const trk = SD.track();
  const phone = () => window.innerWidth < 900;
  const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 || /Mobi|Android/i.test(navigator.userAgent);

  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;
  scene.background = canvasTex(4, 512, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1a0b38'); g.addColorStop(0.45, '#120728'); g.addColorStop(1, '#060411'); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  scene.fog = new THREE.Fog(0x0b0520, 16, 36);
  scene.add(new THREE.HemisphereLight(0xcdb6ff, 0x1a0b2e, 0.65));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.0); key.position.set(4, 12, 7); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb784ff, 1.4); rim.position.set(-6, 5, -6); scene.add(rim);
  const warm = new THREE.PointLight(0xffbb60, 6, 9, 1.6); warm.position.set(-1.9, 3.4, 4.4); scene.add(warm);

  // ---------------------------------------------------------------- track
  const lift = (y) => trk.lift(y);
  function atS(s, y, h) { const a = trk.sample(s); return V(a.p).addScaledVector(V(a.side), y).addScaledVector(V(a.up), h); }
  {
    const NY = 18, prof = []; for (let i = 0; i <= NY; i++) prof.push(-HALF + 2 * HALF * i / NY);
    const pos = [], uv = [], idx = []; let rows = 0;
    for (let s = 0; s <= trk.L + 1e-6; s += 0.06) {
      for (const y of prof) { const p = atS(Math.min(s, trk.L), y, lift(y)); pos.push(p.x, p.y, p.z); uv.push(s / 2, (y + HALF) / (2 * HALF)); }
      rows++;
    }
    const n = prof.length;
    for (let r = 0; r < rows - 1; r++) for (let i = 0; i < n - 1; i++) { const a = r * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const t = canvasTex(64, 256, (x, w, h) => {
      const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a1c6e'); gr.addColorStop(0.25, '#241048'); gr.addColorStop(0.5, '#1d0d3c'); gr.addColorStop(0.75, '#241048'); gr.addColorStop(1, '#3a1c6e');
      x.fillStyle = gr; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(255,207,107,.55)'; x.fillRect(0, 2, w, 3); x.fillRect(0, h - 5, w, 3);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    scene.add(new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.3, metalness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 0.6, side: THREE.DoubleSide, emissive: 0x2a0f55, emissiveIntensity: 0.25 })));
  }
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc56e, metalness: 1, roughness: 0.22 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xb47aff });
  function tubeAlong(y, h, r, mat, step = 0.25) {
    const pts = []; for (let s = 0; s <= trk.L + 1e-6; s += step) pts.push(atS(Math.min(s, trk.L), y, h));
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, r, 8, false), mat); scene.add(m); return m;
  }
  for (const sg of [-1, 1]) { tubeAlong(sg * (HALF + 0.015), lift(HALF) + 0.02, 0.028, gold); tubeAlong(sg * (HALF - 0.02), -0.035, 0.012, glow); }
  { // supports (skipped where a lower track runs underneath), merged into one mesh
    const geos = [];
    for (let s = 1.2; s < trk.L - 0.3; s += 2.1) {
      const p = trk.sample(s).p; let clear = true;
      for (let s2 = 0; s2 < trk.L; s2 += 0.1) { const q = trk.sample(s2).p; if (q[1] < p[1] - 0.3 && Math.hypot(q[0] - p[0], q[2] - p[2]) < 0.75) { clear = false; break; } }
      if (!clear) continue;
      const h = p[1] - 0.06, g = new THREE.CylinderGeometry(0.035, 0.05, h, 10); g.translate(p[0], h / 2, p[2]); geos.push(g);
    }
    scene.add(new THREE.Mesh(mergeGeos(geos), new THREE.MeshStandardMaterial({ color: 0x8c7aa8, metalness: 1, roughness: 0.28 })));
  }
  { // base platform and floor
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.6, 0.24, 96), new THREE.MeshPhysicalMaterial({ color: 0x0c0519, roughness: 0.45, metalness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.12 }));
    base.position.set(0, -0.12, 0.4); scene.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.45, 0.035, 8, 160), gold); ring.rotation.x = Math.PI / 2; ring.position.set(0, 0, 0.4); scene.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(5.9, 0.012, 6, 160), glow); ring2.rotation.x = Math.PI / 2; ring2.position.set(0, 0.01, 0.4); scene.add(ring2);
    const ft = canvasTex(256, 256, (x) => { const g = x.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, '#2a1350'); g.addColorStop(0.5, '#120827'); g.addColorStop(1, '#060411'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: ft })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.25; scene.add(floor);
  }
  const [logoImg, wordImg] = await Promise.all([loadImage('/logo.webp'), loadImage('/logo2.webp')]);
  { // spiral tower with the NX mark
    const cx = -1.4, cz = 0.4;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 4.9, 48, 1, true), new THREE.MeshPhysicalMaterial({ color: 0x2a1458, roughness: 0.1, metalness: 0.1, clearcoat: 1, emissive: 0x3b1680, emissiveIntensity: 0.3, transparent: true, opacity: 0.42, depthWrite: false }));
    tower.position.set(cx, 2.45, cz); scene.add(tower);
    const rings = []; for (let y = 0.5; y < 4.9; y += 0.55) { const g = new THREE.TorusGeometry(0.535, 0.012, 6, 64); g.rotateX(Math.PI / 2); g.translate(cx, y, cz); rings.push(g); }
    scene.add(new THREE.Mesh(mergeGeos(rings), glow));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 48), gold); cap.position.set(cx, 4.94, cz); scene.add(cap);
    if (logoImg) {
      const nx = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshBasicMaterial({ map: cropTex(logoImg, 140, 205, 780, 390, 512, 256), transparent: true, toneMapped: false }));
      nx.position.set(cx, 5.72, cz + 0.05); nx.lookAt(cx + 0.8, 5.9, 12); scene.add(nx);
    }
  }
  // start gate: posts, gold bar (lifts), header sign with the NEXORNG wordmark
  const gateS = trk.gateS + 0.14;
  let gateBar, gateBarY0;
  {
    for (const sg of [-1, 1]) { const p = atS(gateS, sg * (HALF + 0.08), 0); const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 12), gold); post.position.copy(p).add(new THREE.Vector3(0, 0.5, 0)); scene.add(post); }
    const pa = atS(gateS, -(HALF + 0.08), 0), pb = atS(gateS, HALF + 0.08, 0), mid = pa.clone().add(pb).multiplyScalar(0.5);
    gateBar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, pa.distanceTo(pb), 12), new THREE.MeshStandardMaterial({ color: 0xffd27a, metalness: 1, roughness: 0.18, emissive: 0x5a3500, emissiveIntensity: 0.4 }));
    gateBar.position.copy(mid); gateBarY0 = mid.y + 0.22; gateBar.position.y = gateBarY0;
    gateBar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize()); scene.add(gateBar);
    if (wordImg) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.36), new THREE.MeshBasicMaterial({ map: cropTex(wordImg, 85, 395, 845, 185, 512, 112, '#140a2c'), toneMapped: false }));
      sign.position.copy(mid).add(new THREE.Vector3(0, 1.22, 0)); scene.add(sign);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.63, 0.43, 0.04), gold); frame.position.copy(sign.position).add(new THREE.Vector3(0, 0, -0.025)); scene.add(frame);
    }
  }
  { // finish arch + checker strip
    const s = trk.finish, pa = atS(s, -(HALF + 0.1), 0), pb = atS(s, HALF + 0.1, 0), mid = pa.clone().add(pb).multiplyScalar(0.5);
    { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 12), gold); post.position.copy(pb).add(new THREE.Vector3(0, 0.48, 0)); scene.add(post); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, pa.distanceTo(pb) + 0.12), new THREE.MeshStandardMaterial({ color: 0x2a1252, metalness: 0.4, roughness: 0.35 }));
    beam.position.copy(mid).add(new THREE.Vector3(0, 0.98, 0)); scene.add(beam);
    const ft = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.22), new THREE.MeshBasicMaterial({ map: textTex('FINISH', 512, 96, { gold: true, bg: '#2a1252' }), toneMapped: false }));
    ft.position.copy(mid).add(new THREE.Vector3(0.045, 0.98, 0)); ft.rotation.y = Math.PI / 2; scene.add(ft);
    const ct = canvasTex(256, 32, (x) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#f6eedd' : '#1a0f30'; x.fillRect(i * 16, j * 16, 16, 16); } });
    const pos = [], uv = [], idx = [], NY = 16;
    for (let r = 0; r < 2; r++) for (let i = 0; i <= NY; i++) { const y = -HALF + 2 * HALF * i / NY, p = atS(s - 0.06 + r * 0.12, y, lift(y) + 0.004); pos.push(p.x, p.y, p.z); uv.push(i / NY, r); }
    for (let i = 0; i < NY; i++) idx.push(i, i + NY + 1, i + 1, i + 1, i + NY + 1, i + NY + 2);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: ct, roughness: 0.5, side: THREE.DoubleSide })));
  }
  // rack: place labels on the front wall, pads (the winner's turns gold)
  const pads = [];
  for (let k = 0; k < 8; k++) {
    const s = SD.slotS(k);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.09), new THREE.MeshBasicMaterial({ map: textTex(PLACE[k], 128, 56, { gold: k === 0, color: k < 3 ? '#ffe3a1' : '#cdb6ff', font: '800 34px Outfit, system-ui, sans-serif' }), transparent: true, toneMapped: false }));
    const p = atS(s, -(HALF + 0.03), lift(HALF) - 0.12); lab.position.copy(p); lab.lookAt(p.clone().add(new THREE.Vector3(0, 0.25, 1))); scene.add(lab);
    const m = new THREE.MeshBasicMaterial({ color: k === 0 ? 0xffbb60 : 0xa855f7, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.105, 32), m); pad.position.copy(atS(s, 0, 0.006)); pad.rotation.x = -Math.PI / 2; scene.add(pad);
    pads.push(m);
  }
  { const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 2 * HALF + 0.1), gold); e.position.copy(atS(trk.L, 0, 0.13)); scene.add(e); }
  // bumpers on the outer wall of the two hairpins
  const bumpers = [];
  {
    const ring = new THREE.MeshStandardMaterial({ color: 0xffc56e, metalness: 1, roughness: 0.25 });
    for (let s = 0; s < trk.finish - 0.5; s += 0.05) {
      const k = trk.sample(s).k; if (Math.abs(k) < 0.9 || (s > 13 && s < 22.9)) continue;
      if (bumpers.length && s - bumpers[bumpers.length - 1].s < 0.62) continue;
      const p = atS(s, -Math.sign(k) * (HALF + 0.07), lift(HALF) - 0.08);
      const m = new THREE.MeshStandardMaterial({ color: 0x2b0f55, emissive: 0xc084fc, emissiveIntensity: 0.35, roughness: 0.3 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 24), m); b.position.copy(p); scene.add(b);
      const top = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 32), ring); top.rotation.x = Math.PI / 2; top.position.copy(p).add(new THREE.Vector3(0, 0.15, 0)); scene.add(top);
      bumpers.push({ s, m, glow: 0, hit: false });
    }
  }
  // the glass lift: rack end → up the left side → the top of the start ramp
  const liftPath = (() => {
    const e = atS(trk.L - 0.02, 0, R), top = atS(0.0, 0, R);
    return [e, new THREE.Vector3(-3.55, e.y + 0.15, 3.0), new THREE.Vector3(-3.6, 4.6, 0.3), new THREE.Vector3(-3.55, top.y + 0.25, -2.4), new THREE.Vector3(top.x - 0.12, top.y + 0.05, top.z)];
  })();
  {
    const curve = new THREE.CatmullRomCurve3(liftPath, false, 'centripetal');
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.15, 16, false), new THREE.MeshPhysicalMaterial({ color: 0xd8c8ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide })));
    const bands = []; for (let u = 0.04; u < 1; u += 0.07) { const p = curve.getPointAt(u), t = curve.getTangentAt(u), g = new THREE.TorusGeometry(0.152, 0.01, 6, 28); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t)); g.translate(p.x, p.y, p.z); bands.push(g); }
    scene.add(new THREE.Mesh(mergeGeos(bands), gold));
  }

  // ---------------------------------------------------------------- balls (+ soft contact shadows)
  function ballTex(n) {
    const t = canvasTex(512, 256, (x, w, h) => {
      x.fillStyle = COL[n]; x.fillRect(0, 0, w, h);
      for (const cx of [128, 384]) {
        x.beginPath(); x.arc(cx, h / 2, 50, 0, 7); x.fillStyle = '#fbf8ff'; x.fill();
        x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,.18)'; x.stroke();
        x.fillStyle = '#1a1030'; x.font = '900 62px Outfit, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), cx, h / 2 + 2);
        if (n === 6 || n === 9) x.fillRect(cx - 15, h / 2 + 30, 30, 5); // pool-ball underline
      }
    });
    t.wrapS = THREE.RepeatWrapping; t.offset.x = 0.25; t.anisotropy = 8; return t;
  }
  const ballGeo = new THREE.SphereGeometry(R, lowEnd ? 32 : 44, lowEnd ? 22 : 30);
  const blobTex = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  const blobGeo = new THREE.PlaneGeometry(R * 2.6, R * 2.6);
  const balls = {};
  for (let n = 1; n <= 8; n++) {
    const m = new THREE.Mesh(ballGeo, new THREE.MeshPhysicalMaterial({ map: ballTex(n), roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 }));
    const sh = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    scene.add(m); scene.add(sh);
    balls[n] = { m, sh, roll: 0 };
  }
  const halo = new THREE.Mesh(new THREE.RingGeometry(R * 1.25, R * 1.75, 48), new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  scene.add(halo);
  const tmpQ = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), M4 = new THREE.Matrix4();
  // orient: local X = roll axis (track side), rotated about it by the rolled angle; shadow under it
  function placeOnTrack(n, s, y, roll) {
    const w = trk.world(s, y), side = V(w.side).normalize(), t = V(w.t).normalize();
    const up = new THREE.Vector3().crossVectors(side, t).normalize(), fwd = new THREE.Vector3().crossVectors(side, up).normalize();
    const b = balls[n];
    b.m.position.set(w.p[0], w.p[1], w.p[2]);
    b.m.quaternion.setFromRotationMatrix(M4.makeBasis(side, up, fwd)).multiply(tmpQ.setFromAxisAngle(X, roll));
    b.sh.position.set(w.p[0] - up.x * (R - 0.004), w.p[1] - up.y * (R - 0.004), w.p[2] - up.z * (R - 0.004));
    b.sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    b.sh.visible = true;
  }
  function placeFree(n, p, q) { const b = balls[n]; b.m.position.copy(p); b.m.quaternion.copy(q); b.sh.visible = false; }

  // ---------------------------------------------------------------- state
  let mode = 'gate', raceObj = null, raceT0 = 0, raceStartRoll = {}, parkOrder = null, parkGlow = 0, glowTo = 0;
  let liftOrder = null, liftT0 = 0, gateEnds = 0, lastPositions = null, crossed = 0, rackRoll = {};
  const gateQ = {};
  function gateBallPose(n) { const g = SD.gatePos(n); return g; }
  function liftPose(n, place, u) {
    // rack slot → rack end → lift → top of the ramp → its grid slot
    const g = SD.gatePos(n), slot = atS(SD.slotS(place), 0, R), dst = atS(g.s, g.y, R + lift(g.y));
    const entry = atS(0.05, g.y * 0.4, R);
    const pts = [slot].concat(liftPath.slice(0), [entry, dst]);
    if (!liftPose.cache) liftPose.cache = {};
    const key = n + ':' + place;
    let curve = liftPose.cache[key];
    if (!curve) { curve = liftPose.cache[key] = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); }
    const v = smoother(u);
    return Number.isFinite(v) ? curve.getPointAt(Math.min(1, Math.max(0, v))) : curve.getPointAt(0);
  }

  function setBallsGate() { for (let n = 1; n <= 8; n++) { const g = gateBallPose(n); placeOnTrack(n, g.s, g.y, 0); } }
  function setBallsParked(order) { order.forEach((n, p) => placeOnTrack(n, SD.slotS(p), 0, 0)); }
  setBallsGate();

  // ---------------------------------------------------------------- camera
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 90);
  let W = 1, H = 1, area = { L: 0, T: 0, W: 1, H: 1 };
  const camPos = new THREE.Vector3(1.0, 8.3, 16.8), camLook = new THREE.Vector3(0, 4.4, 0.3), camVel = new THREE.Vector3(), lookVel = new THREE.Vector3();
  let camInit = false, shot = { key: '', from: null, t0: 0, dur: 1 };
  const CAM_KEYS = [[0, [-0.45, 1.2, 2.5]], [2.0, [0.2, 1.3, 2.7]], [4.6, [0.9, 1.5, 2.9]], [6.8, [1.4, 1.6, 2.8]], [9.4, [0.6, 1.5, 3.0]], [11.8, [0.3, 1.4, 3.0]],
    [23.0, [0.3, 1.3, 3.0]], [25.9, [1.3, 1.4, 2.6]], [27.6, [0.3, 1.2, 2.8]], [29.4, [0.2, 1.1, 2.6]], [40, [0.2, 1.1, 2.6]]];
  function offsetAt(s, target) {
    let a = CAM_KEYS[0], b = CAM_KEYS[CAM_KEYS.length - 1];
    for (let i = 0; i < CAM_KEYS.length - 1; i++) if (s >= CAM_KEYS[i][0] && s <= CAM_KEYS[i + 1][0]) { a = CAM_KEYS[i]; b = CAM_KEYS[i + 1]; break; }
    const u = smooth((s - a[0]) / Math.max(1e-6, b[0] - a[0]));
    const off = new THREE.Vector3(...a[1]).lerp(new THREE.Vector3(...b[1]), u);
    // around the spiral: orbit with the pack, outside the tower
    const h = smooth((s - 11.6) / 1.2) * (1 - smooth((s - 21.4) / 1.2));
    if (h > 0) off.lerp(new THREE.Vector3(-1.4 + 0.5 - target.x, 1.6, 0.4 + 4.8 - target.z), h); // in front of the spiral
    if (phone()) off.multiplyScalar(1.28).add(new THREE.Vector3(0, 0.35, 0));
    return off;
  }
  function overviewPose(t) {
    const p = phone(), dx = Math.sin(t * 0.26) * 0.6, dy = Math.sin(t * 0.19) * 0.25;
    return p ? [new THREE.Vector3(1.5 + dx, 9.0 + dy, 17.0), new THREE.Vector3(0.15, 4.0, 0.4)] : [new THREE.Vector3(1.0 + dx, 9.8 + dy, 20.4), new THREE.Vector3(0, 4.9, 0.3)];
  }
  function gatePose() {
    const g = atS(0.5, 0, 0.1), off = offsetAt(0.5, g);
    return [g.clone().add(off), g];
  }
  function rackPose() {
    const a = atS((SD.slotS(0) + SD.slotS(7)) / 2, 0, 0), p = phone(), d = p ? 3.6 : 2.8, el = 14 * Math.PI / 180;
    const look = a.clone().add(new THREE.Vector3(0, p ? 0.42 : 0.18, 0));
    return [look.clone().add(new THREE.Vector3(0, d * Math.sin(el), d * Math.cos(el))), look];
  }
  function packPose(pos) {
    let sMax = -1e9; for (const b of pos) sMax = Math.max(sMax, b.s);
    const target = new THREE.Vector3(); let sw = 0;
    for (const b of pos) { const w = Math.exp((b.s - sMax) / 0.9); target.addScaledVector(V(trk.world(b.s, b.y).p), w); sw += w; }
    target.multiplyScalar(1 / sw);
    const lead = { s: sMax }, tg = V(trk.sample(sMax).t);
    target.addScaledVector(tg, 0.3);
    return [target.clone().add(offsetAt(lead.s, target)), target];
  }

  function frame() {
    cam.aspect = W / H; cam.fov = phone() ? 40 : 34;
    const cx = area.L + area.W / 2, cy = area.T + area.H / 2;
    cam.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    cam.updateProjectionMatrix();
  }
  function springTo(pos, look, dt, omega) {
    const step = (x, v, target) => { // critically damped, exact for constant target
      const d = x.clone().sub(target), e = Math.exp(-omega * dt);
      const tmp = v.clone().add(d.clone().multiplyScalar(omega)).multiplyScalar(dt);
      const nx = target.clone().add(d.clone().add(tmp).multiplyScalar(e));
      v.sub(tmp.clone().multiplyScalar(omega)).multiplyScalar(e);
      x.copy(nx);
    };
    step(camPos, camVel, pos); step(camLook, lookVel, look);
  }

  // ---------------------------------------------------------------- per frame
  let raf = 0, lastT = now(), rollLevel = 0;
  function update() {
    const t = now(), dt = clamp(t - lastT, 0, 0.5); lastT = t; // the spring is exact for any step
    let pose, omega = 2.6, shotKey = 'overview', shotDur = 2.0;
    if (mode === 'race' && raceObj) {
      const rt = t - raceT0, pos = raceObj.at(rt);
      // gate bar lifts at 0.15–0.4 s
      gateBar.position.y = gateBarY0 + 0.7 * smooth((rt - 0.1) / 0.35);
      let speed = 0, moving = 0;
      for (const b of pos) {
        const p0 = raceStartRoll[b.ball] || 0, slotS = SD.slotS(b.place);
        let roll = -(b.s - raceObj.s0[b.ball]) / R + p0;
        // upright in the rack: over the last part, ease the roll to a multiple of 2π
        const finalRoll = -(slotS - raceObj.s0[b.ball]) / R + p0;
        const fix = -(((finalRoll % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
        roll += fix * smooth((b.s - trk.finish) / Math.max(0.3, slotS - trk.finish));
        placeOnTrack(b.ball, b.s, b.y, roll);
        if (b.v > 0.05) { speed += b.v; moving++; }
      }
      // sounds: rolling level, close passes (clack), bumpers, crossings
      rollLevel = moving ? clamp(speed / moving / 3.2, 0, 1) * clamp(moving / 4, 0.35, 1) : 0;
      if (hooks.roll) hooks.roll(rollLevel);
      if (lastPositions) {
        for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
          const a = balls[pos[i].ball].m.position, c = balls[pos[j].ball].m.position, d = a.distanceTo(c);
          const key = i * 8 + j, was = lastPositions.near[key];
          if (d < 2 * R + 0.012 && !was) { lastPositions.near[key] = true; if (hooks.clack) hooks.clack(clamp((pos[i].v + pos[j].v) / 6, 0.2, 1)); }
          else if (d > 2 * R + 0.05 && was) lastPositions.near[key] = false;
        }
      } else lastPositions = { near: {} };
      while (crossed < 8 && rt * 1000 >= raceObj.cross[crossed]) { if (hooks.cross) hooks.cross(crossed); crossed++; }
      for (const bp of bumpers) {
        let near = 9; for (const b of pos) near = Math.min(near, Math.abs(b.s - bp.s));
        const g = clamp(1 - near / 0.45, 0, 1);
        if (g > 0.75 && !bp.hit) { bp.hit = true; if (hooks.bump) hooks.bump(0.6); } else if (g < 0.2) bp.hit = false;
        bp.glow += (g - bp.glow) * clamp(dt * 10, 0, 1);
        bp.m.emissiveIntensity = 0.35 + 1.2 * bp.glow;
      }
      if (rt < 0.45) { pose = gatePose(); shotKey = 'gate'; }
      else if (rt < raceObj.winAt + 0.35) { pose = packPose(pos); shotKey = 'pack'; shotDur = 1.3; }
      else { pose = rackPose(); shotKey = 'rack'; shotDur = 1.8; }
      halo.material.opacity = 0;
    } else {
      if (hooks.roll) hooks.roll(0);
      for (const bp of bumpers) { bp.glow += (0 - bp.glow) * clamp(dt * 4, 0, 1); bp.m.emissiveIntensity = 0.35 + 1.2 * bp.glow; }
      if (mode === 'lift' && liftOrder) {
        const lt = t - liftT0; let all = true;
        gateBar.position.y = gateBarY0 + 0.7 * (1 - smooth((lt - 1.2) / 0.6));
        liftOrder.forEach((n, p) => {
          const u = (lt - p * LIFT_GAP) / LIFT_S;
          if (u >= 1) { const g = SD.gatePos(n); placeOnTrack(n, g.s, g.y, 0); return; }
          all = false;
          if (u <= 0) { placeOnTrack(n, SD.slotS(p), 0, 0); return; }
          const p3 = liftPose(n, p, u);
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2); // number to the front
          placeFree(n, p3, q);
        });
        if (all) mode = 'gate';
        pose = overviewPose(t); shotDur = 2.4;
      } else if (mode === 'parked') {
        pose = rackPose(); shotKey = 'rack'; shotDur = 1.8;
      } else { // at the gate, bets open: overview, gliding to the gate in the last seconds
        gateBar.position.y = gateBarY0;
        const left = gateEnds ? gateEnds - t : 99;
        if (left < 4.2) { const [p1, l1] = overviewPose(t), [p2, l2] = gatePose(), u = smoother((4.2 - left) / 3.2); pose = [p1.lerp(p2, u), l1.lerp(l2, u)]; shotKey = 'glide'; shotDur = 1.0; }
        else pose = overviewPose(t);
      }
      // winner halo + gold pad in the rack
      parkGlow += (glowTo - parkGlow) * clamp(dt * 3, 0, 1);
      if (mode === 'parked' && parkOrder) {
        const w = balls[parkOrder[0]].m.position;
        halo.position.set(w.x, w.y - R + 0.008, w.z); halo.rotation.set(-Math.PI / 2, 0, 0);
        halo.material.opacity = 0.75 * parkGlow;
      } else halo.material.opacity = 0;
    }
    pads.forEach((m, k) => { m.opacity = k === 0 ? 0.08 + 0.5 * parkGlow : 0.08 + 0.08 * parkGlow; });
    if (hooks.cameraPose) { const o = hooks.cameraPose(); if (o) { pose = [V(o[0]), V(o[1])]; shotKey = 'fixed'; shotDur = 0.001; } } // stills / lobby card
    if (!camInit) { camPos.copy(pose[0]); camLook.copy(pose[1]); camInit = true; shot = { key: shotKey, from: [pose[0].clone(), pose[1].clone()], t0: t, dur: 0.001 }; }
    // a change of shot blends from where the camera is with smootherstep (no jolt at either end);
    // a light spring then irons out small target moves (the leader changing)
    if (shotKey !== shot.key) shot = { key: shotKey, from: [camPos.clone(), camLook.clone()], t0: t, dur: shotDur };
    const u = smoother((t - shot.t0) / shot.dur);
    springTo(shot.from[0].clone().lerp(pose[0], u), shot.from[1].clone().lerp(pose[1], u), dt, shotKey === 'pack' ? 3.2 : 7);
    cam.position.copy(camPos); cam.lookAt(camLook);
  }
  function loop() { raf = requestAnimationFrame(loop); update(); renderer.render(scene, cam); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { lastT = now(); loop(); } });

  return {
    kind: 'webgl', topColor: TOP_COLOR,
    resize(w, h, a) {
      W = Math.max(1, w); H = Math.max(1, h); area = a || { L: 0, T: 0, W, H };
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone() ? (lowEnd ? 1.5 : 1.75) : 2));
      renderer.setSize(W, H, false);
      frame();
      if (!raf) loop();
    },
    // bets open, balls at the gate (msLeft: until betting closes)
    idle(endsAtPerf) { if (mode !== 'lift') mode = 'gate'; raceObj = null; glowTo = 0; gateEnds = endsAtPerf || 0; if (mode === 'gate') setBallsGate(); },
    setGateEnds(endsAtPerf) { gateEnds = endsAtPerf || 0; },
    // play a race: r = SDRace.decode(...) with the step times; t0 = perf seconds of race time 0
    race(r, t0, crossMs) {
      if (raceObj === r) return;
      raceObj = r; raceT0 = t0; mode = 'race'; crossed = 0; lastPositions = null; glowTo = 0;
      if (crossMs) r.cross = crossMs; if (!r.cross) r.cross = r.balls.map(() => 1e9); r.winAt = (r.cross[0] || 10400) / 1000;
      r.s0 = {}; const p0 = r.at(0); p0.forEach((b) => { r.s0[b.ball] = b.s; raceStartRoll[b.ball] = 0; });
      while (crossed < 8 && (now() - t0) * 1000 >= r.cross[crossed]) crossed++; // joined late: no sounds for the past
    },
    raceTime() { return mode === 'race' ? now() - raceT0 : -1; },
    racing() { return mode === 'race'; },
    parked(order, glowOn) { mode = 'parked'; raceObj = null; parkOrder = order; setBallsParked(order); glowTo = glowOn ? 1 : 0; gateBar.position.y = gateBarY0 + 0.7; },
    glow(on) { glowTo = on ? 1 : 0; },
    lift(order, t0) { liftOrder = order; liftT0 = t0; parkOrder = null; glowTo = 0; mode = 'lift'; raceObj = null; },
    mode() { return mode; },
    debug() { return { mode, raceT: mode === 'race' ? now() - raceT0 : null, cam: camPos.toArray().map((v) => +v.toFixed(2)) }; },
  };
}

// merge simple indexed geometries (position/normal/uv) into one
function mergeGeos(list) {
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  for (const g0 of list) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

// ------------------------------------------------------------------ no WebGL: a flat result board
function create2D(cv) {
  const g = cv.getContext('2d');
  let W = 1, H = 1, order = null, dpr = 1;
  function draw() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1a0b38'); gr.addColorStop(1, '#060411'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const list = order || [1, 2, 3, 4, 5, 6, 7, 8], r = Math.min(W / 22, 26);
    list.forEach((n, i) => {
      const x = W / 2 + (i - 3.5) * r * 2.4, y = H * 0.55;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = COL[n]; g.fill();
      g.beginPath(); g.arc(x, y, r * 0.55, 0, 7); g.fillStyle = '#fff'; g.fill();
      g.fillStyle = '#1a1030'; g.font = `900 ${Math.round(r * 0.8)}px Outfit, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), x, y + 1);
    });
  }
  return Promise.resolve({
    kind: '2d', topColor: TOP_COLOR,
    resize(w, h) { W = w; H = h; dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); draw(); },
    idle() { order = null; draw(); }, setGateEnds() {},
    race(r) { order = r.balls; draw(); }, raceTime() { return -1; }, racing() { return false; },
    parked(o) { order = o; draw(); }, glow() {}, lift() { order = null; draw(); }, mode() { return '2d'; }, debug() { return {}; },
  });
}
