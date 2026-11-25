/* Digit Drum — the 3D drum (three.js 0.170.0, shared copy in ../_core/vendor), with a 2D canvas
 * fallback when WebGL is not available.
 *
 * A gold-rimmed purple drum with ten digit panels turns on a horizontal axle in a purple cradle
 * (the NEXORNG wordmark on the base, the NX mark on the hubs); a gold window with two pointers
 * frames the digit that counts. Only the window digit is bright; the panels rolling away dim.
 *
 * Motion (all analytic, so it is identical at any frame rate and never jerks):
 *   spin()     the drum speeds up from rest (smoothstep over 1.2 s) to VMAX and keeps rolling;
 *              above ~4 rad/s the digits cross-fade into motion-streak copies.
 *   land(d)    from the current angle and speed, it slows down onto digit d with a velocity
 *              profile v(u) = v0·(1 − 3u² + 2u³) — the speed and the acceleration both reach 0
 *              exactly when d is in the window (no bounce, no snap). From rest it eases in and out.
 *   win(on)    the landed panel turns gold (cross-fade), the window and a ring glow, gold motes.
 * The scene renders only while something moves (battery); hooks: click(speed 0–1) per digit
 * passing the pointer, landed(d).
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), show(d), spin(), land(d, opts),
 *      spinning(), win(on), topColor, kind: 'webgl' | '2d' }>
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../_core/vendor/three-0.170.0/addons/RoundedBoxGeometry.js';

const N = 10, STEP = (2 * Math.PI) / N;
const VMAX = 13.5;          // rad/s at full roll (~2.15 turns per second)
const SPINUP = 1.2;         // s
const TOP_COLOR = '#12072a';
const BASE = new URL('.', import.meta.url).href;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mod = (a, m) => ((a % m) + m) % m;
const smooth = (u) => u * u * (3 - 2 * u);

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
    // land: v(u) = v0 (1 − 3u² + 2u³) [+ from rest: smootherstep]; u = s / T
    const u = clamp(s / p.T, 0, 1);
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
      // already rolling (e.g. a landing interrupted): continue at full speed; from rest: speed up
      ph = v > VMAX * 0.8 ? { kind: 'spin', a0: a - VMAX * SPINUP / 2, t0: t - SPINUP } : { kind: 'spin', a0: a, t0: t };
    },
    land(d, opts) {
      const t = now(), [a, v] = at(t), target = d * STEP;
      let delta = mod(target - a, 2 * Math.PI);
      if (v > 0.5) { // keep rolling: the distance D = v0·T/2, T as close to `ideal` as the digit allows
        const ideal = (opts && opts.seconds) || 3.2;
        let best = null;
        for (let k = 0; k < 12; k++) {
          const D = delta + 2 * Math.PI * k, T = (2 * D) / v;
          if (T < ideal * 0.75) continue;
          if (!best || Math.abs(T - ideal) < Math.abs(best.T - ideal)) best = { D, T };
          if (T > ideal * 1.4) break;
        }
        if (!best) best = { D: delta, T: (2 * delta) / v };
        ph = { kind: 'land', a0: a, t0: t, v0: v, T: best.T, D: best.D, target: d };
      } else { // from rest (joined mid-draw): ease in and out over 1–2 turns
        const D = delta + 2 * Math.PI * ((opts && opts.turns) != null ? opts.turns : 1);
        ph = { kind: 'land', a0: a, t0: t, v0: 0, T: (opts && opts.seconds) || 2.4, D, target: d };
      }
      return ph.T;
    },
    phase: () => ph,
    done() { // the landing has finished: settle exactly on the digit
      if (ph.kind === 'land' && now() - ph.t0 >= ph.T) { ph = { kind: 'still', a0: ph.target * STEP, t0: now(), landed: ph.target }; return true; }
      return false;
    },
  };
}

// ------------------------------------------------------------------ textures
let FONT = '"Outfit", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
async function fontsReady() {
  try {
    await Promise.race([document.fonts.load('800 200px Outfit'), new Promise((r) => setTimeout(r, 2500))]);
    if (!document.fonts.check('800 200px Outfit')) FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  } catch (e) { /* keep the stack */ }
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function panelTexture(gold) {
  const [c, g] = canvas(512, 352);
  const lg = g.createLinearGradient(0, 0, 0, 352);
  if (gold) { lg.addColorStop(0, '#fff0c8'); lg.addColorStop(0.5, '#ffc062'); lg.addColorStop(1, '#d9822a'); }
  else { lg.addColorStop(0, '#3a1b78'); lg.addColorStop(0.5, '#22104d'); lg.addColorStop(1, '#140832'); }
  g.fillStyle = lg; g.fillRect(0, 0, 512, 352);
  g.strokeStyle = gold ? 'rgba(120,60,0,.45)' : 'rgba(255,187,96,.55)'; g.lineWidth = 6;
  g.beginPath(); g.roundRect(22, 18, 468, 316, 28); g.stroke();
  const gl = g.createLinearGradient(0, 0, 0, 176); gl.addColorStop(0, 'rgba(255,255,255,.16)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl; g.beginPath(); g.roundRect(26, 22, 460, 150, 24); g.fill();
  return c;
}
function digitTexture(d, mode) { // mode: sharp | streak | gold (the gold panel with a dark digit)
  const [c, g] = mode === 'gold' ? [panelTexture(true), null] : canvas(512, 352);
  const ctx = g || c.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 270px ' + FONT;
  if (mode === 'gold') { ctx.fillStyle = '#2a1300'; ctx.fillText(String(d), 256, 192); return c; }
  ctx.fillStyle = '#ffffff';
  if (mode === 'streak') { // smeared along the roll
    for (let k = -7; k <= 7; k++) { ctx.globalAlpha = 0.16 * (1 - Math.abs(k) / 8); ctx.fillText(String(d), 256, 192 + k * 9); }
    return c;
  }
  ctx.shadowColor = 'rgba(168,85,247,.95)'; ctx.shadowBlur = 40;
  ctx.fillText(String(d), 256, 192);
  ctx.shadowBlur = 0; ctx.fillText(String(d), 256, 192);
  return c;
}
function radial(stops, size) {
  const [c, g] = canvas(size || 256, size || 256), s = (size || 256) / 2;
  const r = g.createRadialGradient(s, s, 0, s, s, s);
  stops.forEach(([o, col]) => r.addColorStop(o, col));
  g.fillStyle = r; g.fillRect(0, 0, s * 2, s * 2);
  return c;
}
function backdrop() {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#060411'; g.fillRect(0, 0, 1024, 1024);
  const r = g.createRadialGradient(512, 470, 20, 512, 470, 560);
  r.addColorStop(0, '#4a1d96'); r.addColorStop(0.35, '#2a0f5e'); r.addColorStop(0.7, '#120630'); r.addColorStop(1, '#060411');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const x = 512 + (i - 3) * 150, lg = g.createLinearGradient(0, 0, 0, 900);
    lg.addColorStop(0, 'rgba(168,85,247,0.16)'); lg.addColorStop(1, 'rgba(168,85,247,0)');
    g.fillStyle = lg; g.beginPath(); g.moveTo(x - 18, 0); g.lineTo(x + 18, 0); g.lineTo(x + (70 * (i - 3)) / 3 + 60, 900); g.lineTo(x + (70 * (i - 3)) / 3 - 60, 900); g.fill();
  }
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 1024, y = rnd() * 700, rr = 4 + rnd() * 16, a = 0.05 + rnd() * 0.12;
    const b = g.createRadialGradient(x, y, 0, x, y, rr);
    b.addColorStop(0, `rgba(${rnd() > 0.7 ? '255,190,110' : '190,140,255'},${a})`); b.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = b; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  return c;
}
function floorRing() {
  const [c, g] = canvas(1024, 1024);
  const r = g.createRadialGradient(512, 512, 0, 512, 512, 512);
  r.addColorStop(0, 'rgba(120,60,220,0.55)'); r.addColorStop(0.42, 'rgba(60,20,130,0.35)'); r.addColorStop(1, 'rgba(6,4,17,0)');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(255,187,96,0.85)'; g.lineWidth = 6; g.shadowColor = '#ffbb60'; g.shadowBlur = 30;
  g.beginPath(); g.arc(512, 512, 300, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(168,85,247,0.7)'; g.lineWidth = 3; g.shadowColor = '#a855f7';
  g.beginPath(); g.arc(512, 512, 360, 0, Math.PI * 2); g.stroke();
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
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x060411, 1);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t; };

  const [nxImg, wordImg] = await Promise.all([loadImage(new URL('../../logo.webp', BASE).href), loadImage(new URL('../../logo2.webp', BASE).href)]);

  // backdrop + floor
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: tex(backdrop()), depthWrite: false }));
  bg.position.set(0, 1.2, -12); scene.add(bg);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: tex(floorRing()), transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.32; scene.add(floor);

  // the drum: ten panels, each = panel + sharp digit + streak digit
  const FACE_H = 1.0, FACE_W = 1.5, R_IN = FACE_H / (2 * Math.tan(Math.PI / N)), R_OUT = R_IN / Math.cos(Math.PI / N);
  const drum = new THREE.Group(); scene.add(drum);
  const panelTex = tex(panelTexture(false));
  const faces = [];
  const faceGeo = new THREE.PlaneGeometry(FACE_W, FACE_H);
  for (let i = 0; i < N; i++) {
    const a = i * STEP, holder = new THREE.Group();
    holder.position.set(0, R_IN * Math.sin(a), R_IN * Math.cos(a)); holder.rotation.x = -a; drum.add(holder);
    const panel = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map: panelTex, emissiveMap: panelTex, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.15 }));
    const sharp = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: tex(digitTexture(i, 'sharp')), transparent: true, depthWrite: false, toneMapped: false }));
    const streak = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: tex(digitTexture(i, 'streak')), transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    sharp.position.z = 0.004; streak.position.z = 0.006; sharp.renderOrder = 1; streak.renderOrder = 2;
    holder.add(panel, sharp, streak);
    faces.push({ panel, sharp, streak, holder });
  }
  // the gold panel of the winning digit (cross-faded in)
  const goldTex = [];
  const gold = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  gold.position.z = 0.008; gold.renderOrder = 3; gold.visible = false;

  const goldMetal = new THREE.MeshStandardMaterial({ color: 0xffc46b, metalness: 1, roughness: 0.22 });
  const violetMetal = new THREE.MeshStandardMaterial({ color: 0x2a1257, metalness: 0.7, roughness: 0.28 });
  const barGeo = new THREE.CylinderGeometry(0.03, 0.03, FACE_W + 0.02, 12);
  for (let i = 0; i < N; i++) {
    const a = (i + 0.5) * STEP, bar = new THREE.Mesh(barGeo, goldMetal);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, R_OUT * Math.sin(a), R_OUT * Math.cos(a)); drum.add(bar);
  }
  for (const s of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R_OUT + 0.09, R_OUT + 0.09, 0.12, 64), goldMetal);
    rim.rotation.z = Math.PI / 2; rim.position.x = s * (FACE_W / 2 + 0.06); drum.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R_OUT + 0.02, 64), violetMetal);
    disc.rotation.y = s * Math.PI / 2; disc.position.x = s * (FACE_W / 2 + 0.125); drum.add(disc);
  }
  // cradle (does not turn): posts, hubs with the NX mark, base with the wordmark, window bezel
  const cradle = new THREE.Group(); scene.add(cradle);
  const nxTex = nxImg ? tex(nxImg) : null, wordTex = wordImg ? tex(wordImg) : null;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new RoundedBoxGeometry(0.34, 2.9, 0.9, 4, 0.1), violetMetal);
    post.position.set(s * (FACE_W / 2 + 0.42), -0.85, 0); cradle.add(post);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.5, 0.04), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
    trim.position.set(s * (FACE_W / 2 + 0.42), -0.9, 0.46); cradle.add(trim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 48), goldMetal);
    hub.rotation.z = Math.PI / 2; hub.position.set(s * (FACE_W / 2 + 0.64), 0, 0); cradle.add(hub);
    if (nxTex) {
      const g = new THREE.CircleGeometry(0.3, 48), uv = g.attributes.uv.array;
      for (let k = 0; k < uv.length; k += 2) { uv[k] = 0.18 + uv[k] * 0.64; uv[k + 1] = 0.36 + uv[k + 1] * 0.5; } // the NX monogram of logo.webp
      const nx = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: nxTex, transparent: true }));
      nx.rotation.y = s * Math.PI / 2; nx.position.set(s * (FACE_W / 2 + 0.7), 0, 0); cradle.add(nx);
    }
  }
  const base = new THREE.Mesh(new RoundedBoxGeometry(3.3, 0.5, 1.5, 4, 0.12), violetMetal);
  base.position.set(0, -2.07, 0); cradle.add(base);
  const baseTrim = new THREE.Mesh(new RoundedBoxGeometry(3.34, 0.07, 0.07, 2, 0.03), goldMetal);
  baseTrim.position.set(0, -1.83, 0.74); cradle.add(baseTrim);
  const neon = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.025, 0.02), new THREE.MeshBasicMaterial({ color: 0xc084fc }));
  neon.position.set(0, -2.27, 0.76); cradle.add(neon);
  if (wordTex) {
    const g = new THREE.PlaneGeometry(1.5, 0.5), uv = g.attributes.uv.array;
    for (let k = 1; k < uv.length; k += 2) uv[k] = 0.36 + uv[k] * 0.3; // the wordmark band of logo2.webp
    const plate = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: wordTex, transparent: true }));
    plate.position.set(0, -2.07, 0.755); cradle.add(plate);
  }
  const bw = FACE_W + 0.32, bh = FACE_H + 0.16, bt = 0.07, zf = R_IN + 0.14;
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0xffc46b, metalness: 1, roughness: 0.2, emissive: 0xffa640, emissiveIntensity: 0 });
  for (const [w, h, x, y] of [[bw, bt, 0, bh / 2], [bw, bt, 0, -bh / 2], [bt, bh + bt, -bw / 2, 0], [bt, bh + bt, bw / 2, 0]]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.08, 2, 0.025), bezelMat); b.position.set(x, y, zf); cradle.add(b);
  }
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape(); shape.moveTo(0, 0.16); shape.lineTo(0, -0.16); shape.lineTo(-s * 0.2, 0); shape.closePath();
    const p = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 }), bezelMat);
    p.position.set(s * (bw / 2 + 0.22), 0, zf - 0.03); cradle.add(p);
  }
  // win glow: halo behind the drum, a gold ring around the window, gold motes
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(radial([[0, 'rgba(255,190,100,0.9)'], [1, 'rgba(0,0,0,0)']])), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  halo.scale.set(7.5, 6, 1); halo.position.set(0, -0.1, -2.2); scene.add(halo);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.035, 96), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  ring.position.set(0, 0, zf + 0.05); scene.add(ring);
  const moteGeo = new THREE.BufferGeometry(), mp = [];
  { let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 90; i++) { const a = rnd() * Math.PI * 2, rr = 1.2 + rnd() * 1.6; mp.push(Math.cos(a) * rr, Math.sin(a) * rr * 0.75, zf - 0.4 + rnd() * 0.8); } }
  moteGeo.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xffd28a, size: 0.05, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(motes);
  scene.add(new THREE.AmbientLight(0x6b4bb0, 0.35));
  const key = new THREE.SpotLight(0xffffff, 60, 20, 0.6, 0.6); key.position.set(1.5, 5, 7); scene.add(key, key.target);
  const rimL = new THREE.PointLight(0xa855f7, 25, 12); rimL.position.set(-3.5, 1.5, -1.5);
  const rimR = new THREE.PointLight(0xa855f7, 25, 12); rimR.position.set(3.5, 1.5, -1.5); scene.add(rimL, rimR);
  const winLight = new THREE.PointLight(0xffb050, 0, 6); winLight.position.set(0, 0, zf + 1.2); scene.add(winLight);
  const purple = new THREE.Color(0xa855f7), amber = new THREE.Color(0xffb050);

  // ---- state + loop
  const M = motion();
  let W = 1, H = 1, area = null, dirty = true, raf = 0, lastFace = -1;
  let glow = 0, glowTo = 0, glowT = performance.now(), goldDigit = -1, landedCb = null;

  function frame() {
    const cx = area.L + area.W / 2, cy = area.T + area.H / 2, wide = W >= 900;
    const fitH = wide ? 4.35 : 4.75;
    const dist = (fitH / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (H / Math.max(120, area.H));
    camera.position.set(0, 0.35, dist); camera.lookAt(0, -0.25, 0);
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
  }
  function shade(rot, speed) {
    const blur = clamp((speed - 4) / 7, 0, 1);
    for (let i = 0; i < N; i++) {
      const k = Math.pow(Math.max(0, Math.cos(i * STEP - rot)), 10), f = faces[i];
      f.panel.material.emissiveIntensity = 0.02 + 0.6 * k;
      f.panel.material.color.setScalar(0.16 + 0.84 * k);
      f.panel.material.envMapIntensity = 0.25 + 0.75 * k;
      const c = 0.2 + 0.8 * k;
      f.sharp.material.color.setScalar(c); f.streak.material.color.setScalar(c);
      f.sharp.material.opacity = 1 - blur; f.streak.material.opacity = blur;
    }
  }
  function loop() {
    raf = 0;
    const [rot, speed] = M.angle();
    if (M.done()) { const d = M.phase().landed; render(d * STEP, 0); if (landedCb) { const cb = landedCb; landedCb = null; cb(d); } hooks.landed && hooks.landed(d); return schedule(); }
    render(rot, speed);
    const face = Math.floor(mod(rot + STEP / 2, 2 * Math.PI) / STEP);
    if (face !== lastFace) { if (lastFace >= 0 && speed > 0.2) hooks.click && hooks.click(speed / VMAX); lastFace = face; }
    schedule();
  }
  function moving() { return M.phase().kind !== 'still' || glow !== glowTo || glow > 0; }
  function schedule() { if (!raf && (moving() || dirty)) raf = requestAnimationFrame(loop); }
  function render(rot, speed) {
    drum.rotation.x = rot;
    shade(rot, speed);
    // win glow (cross-fade 0.5 s)
    const t = performance.now(), dt = (t - glowT) / 1000; glowT = t;
    if (glow !== glowTo) glow = glowTo > glow ? Math.min(glowTo, glow + dt / 0.5) : Math.max(glowTo, glow - dt / 0.5);
    const e = smooth(glow);
    gold.visible = e > 0.001; gold.material.opacity = e;
    bezelMat.emissiveIntensity = 0.9 * e; halo.material.opacity = 0.85 * e; ring.material.opacity = 0.9 * e;
    ring.scale.setScalar(1.45 + 0.1 * e); motes.material.opacity = 0.9 * e; winLight.intensity = 6 * e;
    rimL.color.copy(purple).lerp(amber, e); rimR.color.copy(purple).lerp(amber, e);
    if (e > 0) { motes.rotation.z = t / 9000; motes.position.y = Math.sin(t / 1400) * 0.05; }
    renderer.render(scene, camera);
    dirty = false;
  }

  return {
    kind: 'webgl', topColor: TOP_COLOR,
    debug: () => ({ angle: M.angle(), phase: M.phase().kind, glow, glowTo, goldDigit }),
    resize(w, h, a) {
      W = Math.max(1, w); H = Math.max(1, h); area = a;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, W < 900 ? 1.75 : 2));
      renderer.setSize(W, H, false);
      frame(); dirty = true; schedule();
    },
    show(d) { M.still(d * STEP); dirty = true; schedule(); },
    spin() { glowTo = 0; M.spin(); schedule(); },
    land(d, opts) { const T = M.land(d, opts); schedule(); return T; },
    onLanded(cb) { landedCb = cb; },
    spinning() { return M.phase().kind !== 'still'; },
    win(on, d) {
      if (on && d != null && d !== goldDigit) {
        if (!goldTex[d]) goldTex[d] = tex(digitTexture(d, 'gold'));
        gold.material.map = goldTex[d]; gold.material.needsUpdate = true;
        gold.removeFromParent(); faces[d].holder.add(gold); goldDigit = d;
      }
      glowTo = on ? 1 : 0; glowT = performance.now(); schedule();
    },
  };
}

// ------------------------------------------------------------------ 2D fallback (no WebGL)
function create2D(cv, hooks) {
  const g = cv.getContext('2d'), M = motion();
  let W = 1, H = 1, area = null, dpr = 1, raf = 0, dirty = true, glow = 0, glowTo = 0, glowT = performance.now(), goldDigit = -1, landedCb = null, lastFace = -1;
  const bg = backdrop();
  function draw(rot, speed) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg, 0, 0, W, H);
    const cx = area.L + area.W / 2, cy = area.T + area.H / 2, fh = Math.min(area.H * 0.26, area.W * 0.2), fw = fh * 1.5;
    g.save(); g.beginPath(); g.rect(cx - fw / 2, cy - fh * 1.9, fw, fh * 3.8); g.clip();
    const t = performance.now(), dt = (t - glowT) / 1000; glowT = t;
    if (glow !== glowTo) glow = glowTo > glow ? Math.min(glowTo, glow + dt / 0.5) : Math.max(glowTo, glow - dt / 0.5);
    for (let i = 0; i < N; i++) {
      const a = mod(i * STEP - rot + Math.PI, 2 * Math.PI) - Math.PI; // −π…π, 0 = window
      if (Math.abs(a) > 1.4) continue;
      const y = cy + Math.sin(a) * fh * 1.6 * -1, h = fh * Math.cos(a), k = Math.pow(Math.cos(a), 6);
      g.globalAlpha = 0.25 + 0.75 * k;
      const lg = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      const isGold = i === goldDigit && glow > 0;
      lg.addColorStop(0, '#3a1b78'); lg.addColorStop(1, '#140832');
      g.fillStyle = lg; g.fillRect(cx - fw / 2, y - h / 2, fw, h);
      if (isGold) { g.globalAlpha = smooth(glow); const gg = g.createLinearGradient(0, y - h / 2, 0, y + h / 2); gg.addColorStop(0, '#fff0c8'); gg.addColorStop(1, '#d9822a'); g.fillStyle = gg; g.fillRect(cx - fw / 2, y - h / 2, fw, h); g.globalAlpha = 0.25 + 0.75 * k; }
      g.fillStyle = isGold && glow > 0.5 ? '#2a1300' : '#fff';
      g.font = `800 ${Math.round(h * 0.75)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (speed > 4) { g.globalAlpha *= 0.6; }
      g.fillText(String(i), cx, y + h * 0.05);
      g.strokeStyle = '#ffc46b'; g.lineWidth = 2; g.strokeRect(cx - fw / 2, y - h / 2, fw, h);
    }
    g.restore(); g.globalAlpha = 1;
    g.strokeStyle = glow > 0 ? '#ffd28a' : '#ffc46b'; g.lineWidth = 5; g.strokeRect(cx - fw / 2 - 8, cy - fh / 2 - 6, fw + 16, fh + 12);
  }
  function loop() {
    raf = 0;
    const [rot, speed] = M.angle();
    if (M.done()) { const d = M.phase().landed; draw(d * STEP, 0); if (landedCb) { const cb = landedCb; landedCb = null; cb(d); } hooks.landed && hooks.landed(d); return schedule(); }
    draw(rot, speed); dirty = false;
    const face = Math.floor(mod(rot + STEP / 2, 2 * Math.PI) / STEP);
    if (face !== lastFace) { if (lastFace >= 0 && speed > 0.2) hooks.click && hooks.click(speed / VMAX); lastFace = face; }
    schedule();
  }
  function schedule() { if (!raf && (M.phase().kind !== 'still' || glow !== glowTo || dirty)) raf = requestAnimationFrame(loop); }
  return {
    kind: '2d', topColor: TOP_COLOR,
    debug: () => ({ angle: M.angle(), phase: M.phase().kind, glow, glowTo, goldDigit }),
    resize(w, h, a) { W = w; H = h; area = a; dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); dirty = true; schedule(); },
    show(d) { M.still(d * STEP); dirty = true; schedule(); },
    spin() { glowTo = 0; M.spin(); schedule(); },
    land(d, opts) { const T = M.land(d, opts); schedule(); return T; },
    onLanded(cb) { landedCb = cb; },
    spinning() { return M.phase().kind !== 'still'; },
    win(on, d) { if (d != null) goldDigit = d; glowTo = on ? 1 : 0; glowT = performance.now(); dirty = true; schedule(); },
  };
}

export async function create(cv, hooks) {
  await fontsReady();
  hooks = hooks || {};
  if (hasWebGL() && !/[?&]flat=1/.test(location.search)) {
    try { return await createGL(cv, hooks); } catch (e) {
      console.warn('Digit Drum: WebGL failed, using 2D', e);
      const fresh = cv.cloneNode(false); cv.replaceWith(fresh); cv = fresh; // a canvas with a WebGL context cannot give a 2D one
    }
  }
  return create2D(cv, hooks);
}
