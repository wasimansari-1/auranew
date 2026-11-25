/* Trio Rollers — the 3D number machine (three.js 0.170.0, shared copy in ../_core/vendor), with a 2D
 * canvas fallback when WebGL is not available.
 *
 * A purple glass-metal cabinet with gold trim on a pedestal holds three mechanical number rollers
 * (odometer drums, digits 0–9 around each). A gold frame marks the reading line; the digits above
 * and below it are shaded. Each roller has a 1ST / 2ND / 3RD plate and a lock lamp; a locked
 * roller's digit turns gold. The NX mark (logo.webp) sits on the crest.
 *
 * Motion (analytic per roller, identical at any frame rate, never jerks):
 *   spin()        every roller speeds up from rest (smoothstep, staggered 0 / 0.12 / 0.24 s) to VMAX
 *                 and keeps rolling; above ~4 rad/s the digits cross-fade into motion-streak copies.
 *   land(i, d)    roller i slows down onto digit d with v(u) = v0·(1 − 3u² + 2u³): speed and
 *                 acceleration both reach 0 exactly on the digit (no bounce, no snap); from rest it
 *                 eases in and out. When it stops, it locks (gold digit, lamp) — landed(i, d).
 *   win(on)       the reading line glows (gold frame, glow card, warm rim light).
 * The scene renders only while something moves (battery). Hooks: tick(speed 0–1) per digit passing
 * the reading line, landed(i, d).
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), show(digits, locked[]), spin(which[]), land(i, d, opts),
 *      spinning(i?), unlock(), win(on), topColor, kind: 'webgl' | '2d' }>
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../_core/vendor/three-0.170.0/addons/RoundedBoxGeometry.js';

const N = 10, STEP = (2 * Math.PI) / N;
const VMAX = 13.5;          // rad/s at full roll (~21 digits per second)
const SPINUP = 1.0;         // s
const STAGGER = 0.12;       // s between the rollers starting
const TOP_COLOR = '#130a29';
const BASE = new URL('.', import.meta.url).href;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mod = (a, m) => ((a % m) + m) % m;
const smooth = (u) => u * u * (3 - 2 * u);
const nowS = () => performance.now() / 1000;

// ------------------------------------------------------------------ motion of one roller
function motion() {
  let ph = { kind: 'still', a0: 0, t0: 0 };
  function at(t) { // angle and speed at time t
    const p = ph, s = t - p.t0;
    if (p.kind === 'still') return [p.a0, 0];
    if (p.kind === 'spin') {
      if (s <= 0) return [p.a0, 0];
      if (s < SPINUP) { const u = s / SPINUP; return [p.a0 + VMAX * SPINUP * (u * u * u - (u * u * u * u) / 2), VMAX * smooth(u)]; }
      return [p.a0 + (VMAX * SPINUP) / 2 + VMAX * (s - SPINUP), VMAX];
    }
    const u = clamp(s / p.T, 0, 1);
    if (p.v0 > 0.5) return [p.a0 + p.v0 * p.T * (u - u * u * u + (u * u * u * u) / 2), p.v0 * (1 - 3 * u * u + 2 * u * u * u)];
    const e = u * u * u * (u * (u * 6 - 15) + 10), de = (30 * u * u * (u - 1) * (u - 1)) / p.T;
    return [p.a0 + p.D * e, p.D * de];
  }
  return {
    angle: () => at(nowS()),
    phase: () => ph,
    still(a) { ph = { kind: 'still', a0: a, t0: nowS() }; },
    spin(delay) {
      const t = nowS(), [a, v] = at(t);
      if (ph.kind === 'spin') return;
      ph = v > VMAX * 0.8 ? { kind: 'spin', a0: a - (VMAX * SPINUP) / 2, t0: t - SPINUP } : { kind: 'spin', a0: a, t0: t + (delay || 0) };
    },
    land(d, opts) {
      const t = nowS(), [a, v] = at(t), target = d * STEP;
      const delta = mod(target - a, 2 * Math.PI), ideal = (opts && opts.seconds) || 1.4;
      if (v > 0.5) { // keep rolling: distance D = v0·T/2, T as close to `ideal` as the digit allows
        let best = null;
        for (let k = 0; k < 14; k++) {
          const D = delta + 2 * Math.PI * k, T = (2 * D) / v;
          if (T < ideal * 0.75) continue;
          if (!best || Math.abs(T - ideal) < Math.abs(best.T - ideal)) best = { D, T };
          if (T > ideal * 1.4) break;
        }
        if (!best) best = { D: delta, T: Math.max(0.2, (2 * delta) / v) };
        ph = { kind: 'land', a0: a, t0: t, v0: v, T: best.T, D: best.D, target: d };
      } else { // from rest (joined mid-draw): ease in and out over one turn and a bit
        const D = delta + 2 * Math.PI * ((opts && opts.turns) != null ? opts.turns : 1);
        ph = { kind: 'land', a0: a, t0: t, v0: 0, T: ideal, D, target: d };
      }
      return ph.T;
    },
    done() {
      if (ph.kind === 'land' && nowS() - ph.t0 >= ph.T) { ph = { kind: 'still', a0: ph.target * STEP, t0: nowS(), landed: ph.target }; return true; }
      return false;
    },
  };
}

// ------------------------------------------------------------------ textures
let FONT = '"Outfit", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BODY_FONT = '"Plus Jakarta Sans", "Outfit", system-ui, sans-serif';
async function fontsReady() {
  try {
    await Promise.race([Promise.all([document.fonts.load('800 200px Outfit'), document.fonts.load('700 40px "Plus Jakarta Sans"')]), new Promise((r) => setTimeout(r, 2500))]);
    if (!document.fonts.check('800 200px Outfit')) FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  } catch (e) { /* keep the stack */ }
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function loadImage(src) { return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }

// roller geometry (world units)
const R = 1.2, DRUM_W = 1.04, GAP = 1.24, DZ = -0.2;
const CELL = 256, CELL_H = Math.round((CELL * DRUM_W) / ((2 * Math.PI * R) / N)); // keeps the glyphs unsquashed

// the canvas x axis runs around the drum (u); draw each digit rotated so it stands upright on screen
function drawDigit(g, d, cx, color, alpha) {
  g.save(); g.globalAlpha = alpha == null ? 1 : alpha; g.translate(cx, CELL_H / 2); g.rotate(Math.PI / 2);
  g.font = `800 ${CELL * 0.92}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.fillText(String(d), 0, CELL * 0.05); g.restore();
}
function drumBackTexture() {
  const [c, g] = canvas(CELL * N, CELL_H);
  for (let i = 0; i < N; i++) {
    const x = i * CELL, bg = g.createLinearGradient(x, 0, x + CELL, 0);
    bg.addColorStop(0, '#120a24'); bg.addColorStop(0.5, '#25133f'); bg.addColorStop(1, '#120a24');
    g.fillStyle = bg; g.fillRect(x, 0, CELL, CELL_H);
    g.fillStyle = 'rgba(255,187,96,0.55)'; g.fillRect(x, 0, 3, CELL_H); // separator between digits
  }
  return c;
}
function digitsTexture(mode) { // sharp | streak (transparent background)
  const [c, g] = canvas(CELL * N, CELL_H);
  for (let i = 0; i < N; i++) {
    if (mode === 'streak') for (let k = -5; k <= 5; k++) drawDigit(g, i, i * CELL + CELL / 2 + k * 11, '#efe6ff', 0.16 - Math.abs(k) * 0.022);
    else drawDigit(g, i, i * CELL + CELL / 2, '#ffffff');
  }
  return c;
}
function labelTexture(text) {
  const [c, g] = canvas(256, 96);
  g.font = `700 46px ${BODY_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.fillText(text, 128, 50);
  return c;
}
function wallTexture() {
  const [c, g] = canvas(1024, 512), w = 1024, h = 512;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#130a29'); bg.addColorStop(0.55, '#1c0f3a'); bg.addColorStop(1, '#0b0619');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const r = g.createRadialGradient(w / 2, h * 0.52, 10, w / 2, h * 0.52, w * 0.46);
  r.addColorStop(0, 'rgba(168,85,247,0.55)'); r.addColorStop(0.45, 'rgba(109,40,217,0.22)'); r.addColorStop(1, 'rgba(10,6,24,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) { // soft, out-of-focus light columns
    const x = w * (0.06 + i * 0.11), lg = g.createLinearGradient(x - 26, 0, x + 26, 0);
    lg.addColorStop(0, 'rgba(255,187,96,0)'); lg.addColorStop(0.5, i % 2 ? 'rgba(168,85,247,0.10)' : 'rgba(255,187,96,0.07)'); lg.addColorStop(1, 'rgba(255,187,96,0)');
    g.fillStyle = lg; g.fillRect(x - 26, 0, 52, h);
  }
  const hz = g.createLinearGradient(0, h * 0.48, 0, h * 0.69); // melt into the floor at the horizon
  hz.addColorStop(0, 'rgba(23,12,50,0)'); hz.addColorStop(1, 'rgba(23,12,50,1)');
  g.fillStyle = hz; g.fillRect(0, h * 0.48, w, h * 0.21); g.fillStyle = '#170c32'; g.fillRect(0, h * 0.69, w, h * 0.31);
  return c;
}
function floorTexture() {
  const [c, g] = canvas(512, 512);
  const r = g.createRadialGradient(256, 256, 4, 256, 256, 256);
  r.addColorStop(0, '#3a1d6e'); r.addColorStop(0.22, '#22114a'); r.addColorStop(0.55, '#150b2e'); r.addColorStop(1, '#170c32');
  g.fillStyle = r; g.fillRect(0, 0, 512, 512);
  return c;
}
function shadeTexture() { // darkens the drums above / below the reading line
  const [c, g] = canvas(16, 256), l = g.createLinearGradient(0, 0, 0, 256);
  l.addColorStop(0, 'rgba(6,4,17,0.92)'); l.addColorStop(0.33, 'rgba(6,4,17,0.25)'); l.addColorStop(0.42, 'rgba(6,4,17,0)');
  l.addColorStop(0.58, 'rgba(6,4,17,0)'); l.addColorStop(0.67, 'rgba(6,4,17,0.25)'); l.addColorStop(1, 'rgba(6,4,17,0.92)');
  g.fillStyle = l; g.fillRect(0, 0, 16, 256);
  return c;
}
function glowTexture() {
  const [c, g] = canvas(512, 256), r = g.createRadialGradient(256, 128, 10, 256, 128, 256);
  r.addColorStop(0, 'rgba(255,187,96,0.9)'); r.addColorStop(0.4, 'rgba(255,170,80,0.35)'); r.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = r; g.fillRect(0, 0, 512, 256);
  return c;
}

// ------------------------------------------------------------------ WebGL machine
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

async function createGL(cv, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0a0618, 1);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (c, wrap) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; if (wrap) t.wrapS = THREE.RepeatWrapping; return t; };
  const nxImg = await loadImage(new URL('../../logo.webp', BASE).href);

  // backdrop + floor
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({ map: tex(wallTexture()), depthWrite: false }));
  wall.position.set(0, 2.2, -6); scene.add(wall);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshBasicMaterial({ map: tex(floorTexture()) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.55; scene.add(floor);

  const purpleMetal = new THREE.MeshPhysicalMaterial({ color: 0x2a1352, metalness: 0.75, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x120a22, metalness: 0.6, roughness: 0.42 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffbb60, metalness: 1, roughness: 0.26, envMapIntensity: 1.3 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffbb60, metalness: 1, roughness: 0.3, emissive: 0xffa640, emissiveIntensity: 0 });

  // three rollers: an opaque drum + sharp digits + streak digits (cross-faded with the speed)
  const backTex = tex(drumBackTexture(), true), sharpTex = tex(digitsTexture('sharp'), true), streakTex = tex(digitsTexture('streak'), true);
  const drumGeo = new THREE.CylinderGeometry(R, R, DRUM_W, 96, 1, true);
  const sharpGeo = new THREE.CylinderGeometry(R * 1.002, R * 1.002, DRUM_W, 96, 1, true);
  const streakGeo = new THREE.CylinderGeometry(R * 1.004, R * 1.004, DRUM_W, 96, 1, true);
  const rimGeo = new THREE.TorusGeometry(R * 1.005, 0.045, 16, 96), capGeo = new THREE.CircleGeometry(R, 64);
  const machine = new THREE.Group(); scene.add(machine);
  const rollers = [];
  const white = new THREE.Color(0xffffff), goldC = new THREE.Color(0xffcf6b);
  for (let i = 0; i < 3; i++) {
    const grp = new THREE.Group(); grp.position.x = (i - 1) * GAP; machine.add(grp);
    const spin = new THREE.Group(); spin.position.z = DZ; grp.add(spin);
    const drum = new THREE.Mesh(drumGeo, new THREE.MeshPhysicalMaterial({ map: backTex, roughness: 0.34, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 0.3 }));
    const sharp = new THREE.Mesh(sharpGeo, new THREE.MeshBasicMaterial({ map: sharpTex, transparent: true, depthWrite: false, toneMapped: false }));
    const streak = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    for (const m of [drum, sharp, streak]) { m.rotation.z = Math.PI / 2; spin.add(m); }
    sharp.renderOrder = 1; streak.renderOrder = 2;
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(rimGeo, gold); rim.rotation.y = Math.PI / 2; rim.position.set((s * DRUM_W) / 2, 0, DZ); grp.add(rim);
      const cap = new THREE.Mesh(capGeo, darkMetal); cap.rotation.y = (s * Math.PI) / 2; cap.position.set(s * (DRUM_W / 2 + 0.001), 0, DZ); grp.add(cap);
    }
    rollers.push({ spin, sharp, streak, M: motion(), lock: 0, lockTo: 0, lastFace: -1, landedCb: null });
  }

  // cabinet: body, bezels above / below the reading window, pillars, dividers
  const body = new THREE.Mesh(new RoundedBoxGeometry(4.6, 3.0, 1.6, 6, 0.22), purpleMetal); body.position.set(0, 0, -0.62); machine.add(body);
  const bezelGeo = new RoundedBoxGeometry(4.36, 0.62, 0.5, 4, 0.12);
  const bezelTop = new THREE.Mesh(bezelGeo, purpleMetal); bezelTop.position.set(0, 0.98, 0.62); machine.add(bezelTop);
  const bezelBot = new THREE.Mesh(bezelGeo, purpleMetal); bezelBot.position.set(0, -0.98, 0.62); machine.add(bezelBot);
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new RoundedBoxGeometry(0.34, 2.58, 0.6, 4, 0.1), purpleMetal); pillar.position.set(s * 2.0, 0, 0.62); machine.add(pillar);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.2, 0.04), gold); strip.position.set(s * 2.0, 0, 0.94); machine.add(strip);
  }
  for (const s of [-0.5, 0.5]) { const div = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.4, 0.4), darkMetal); div.position.set(s * GAP, 0, 0.62); machine.add(div); }
  for (const y of [1.26, -1.26]) { const t = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.035, 0.03), gold); t.position.set(0, y, 0.88); machine.add(t); }
  // the reading line: shade over the drums, the gold frame, the win glow card
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 1.36), new THREE.MeshBasicMaterial({ map: tex(shadeTexture()), transparent: true, depthWrite: false }));
  shade.position.set(0, 0, 1.005); shade.renderOrder = 3; machine.add(shade);
  const FW = 3.66, FH = 0.88, T = 0.05, frame = new THREE.Group(); frame.position.z = 1.02; machine.add(frame);
  for (const [x, y, w, h] of [[0, FH / 2, FW + T, T], [0, -FH / 2, FW + T, T], [-FW / 2, 0, T, FH], [FW / 2, 0, T, FH]]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.07, 2, 0.02), frameMat); b.position.set(x, y, 0); frame.add(b);
  }
  for (const s of [-0.5, 0.5]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, FH, 0.05), frameMat); b.position.set(s * GAP, 0, 0); frame.add(b); }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.2), new THREE.MeshBasicMaterial({ map: tex(glowTexture()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
  glow.position.set(0, 0, 1.08); glow.renderOrder = 4; glow.visible = false; machine.add(glow);
  // position plates + lock lamps
  const lamps = [], plates = [], dimPlate = new THREE.Color(0x8f7ab8), lampOff = new THREE.Color(0x3b2466);
  ['1ST', '2ND', '3RD'].forEach((t, i) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), new THREE.MeshBasicMaterial({ map: tex(labelTexture(t)), transparent: true, toneMapped: false, color: dimPlate }));
    p.position.set((i - 1) * GAP - 0.16, -0.98, 0.875); machine.add(p); plates.push(p);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 16), new THREE.MeshStandardMaterial({ color: 0x3b2466, emissive: 0xffbb60, emissiveIntensity: 0, roughness: 0.3 }));
    lamp.position.set((i - 1) * GAP + 0.25, -0.98, 0.88); machine.add(lamp); lamps.push(lamp);
  });
  if (nxImg) { // crest: the NX monogram of logo.webp
    const g = new THREE.PlaneGeometry(0.62, 0.48), uv = g.attributes.uv.array;
    for (let k = 0; k < uv.length; k += 2) { uv[k] = 0.16 + uv[k] * 0.68; uv[k + 1] = 0.4 + uv[k + 1] * 0.5; }
    const crest = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex(nxImg), transparent: true, toneMapped: false }));
    crest.position.set(0, 1.0, 0.875); machine.add(crest);
  }
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 0.34, 64), darkMetal); ped.position.y = -1.42; machine.add(ped);
  const pedRing = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.03, 12, 96), gold); pedRing.rotation.x = Math.PI / 2; pedRing.position.y = -1.25; machine.add(pedRing);

  scene.add(new THREE.HemisphereLight(0xb58cff, 0x120820, 0.55));
  const key = new THREE.SpotLight(0xfff1dc, 26, 20, 0.5, 0.6, 1.4); key.position.set(1.5, 4.5, 6); scene.add(key, key.target);
  const rimL = new THREE.PointLight(0xa855f7, 16, 10, 1.6); rimL.position.set(-3.6, 1.6, 1.4); scene.add(rimL);
  const rimR = new THREE.PointLight(0xffbb60, 10, 10, 1.6); rimR.position.set(3.6, 1.2, 1.6); scene.add(rimR);

  // ---- state + loop
  let W = 1, H = 1, area = null, dirty = true, raf = 0, winV = 0, winTo = 0, lastT = performance.now();
  function frameCamera() {
    const aspect = area.W / Math.max(1, area.H), fit = Math.max(5.25 / aspect, 3.3); // the whole cabinet + pedestal, with a margin
    const dist = ((fit / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (H / Math.max(120, area.H));
    camera.position.set(0, 0.55, dist + 1.0); camera.lookAt(0, 0.02, 0);
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - (area.L + area.W / 2), H / 2 - (area.T + area.H / 2), W, H);
    camera.updateProjectionMatrix();
  }
  function animating() {
    return rollers.some((r) => r.M.phase().kind !== 'still' || r.lock !== r.lockTo) || winV !== winTo;
  }
  function schedule() { if (!raf && (animating() || dirty)) raf = requestAnimationFrame(loop); }
  function loop() {
    raf = 0;
    const t = performance.now(), dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    const landedNow = [];
    rollers.forEach((r, i) => {
      if (r.M.done()) { r.lockTo = 1; landedNow.push([i, r.M.phase().landed]); }
      const [a, v] = r.M.angle();
      r.spin.rotation.x = a + STEP / 2;
      const blur = clamp((v - 4) / 7, 0, 1);
      r.sharp.material.opacity = 1 - blur; r.streak.material.opacity = blur;
      if (r.lock !== r.lockTo) r.lock = r.lockTo > r.lock ? Math.min(r.lockTo, r.lock + dt / 0.35) : Math.max(r.lockTo, r.lock - dt / 0.35);
      const e = smooth(r.lock);
      r.sharp.material.color.copy(white).lerp(goldC, e);
      lamps[i].material.emissiveIntensity = 1.1 * e; lamps[i].material.color.copy(lampOff).lerp(goldC, e);
      plates[i].material.color.copy(dimPlate).lerp(goldC, e);
      const face = Math.floor(mod(a + STEP / 2, 2 * Math.PI) / STEP);
      if (face !== r.lastFace) { if (r.lastFace >= 0 && v > 0.2 && hooks.tick) hooks.tick(v / VMAX); r.lastFace = face; }
    });
    if (winV !== winTo) winV = winTo > winV ? Math.min(winTo, winV + dt / 0.6) : Math.max(winTo, winV - dt / 0.6);
    const w = smooth(winV);
    glow.visible = w > 0.001; glow.material.opacity = 0.55 * w;
    frameMat.emissiveIntensity = 0.55 * w; rimR.intensity = 10 + 8 * w;
    renderer.render(scene, camera);
    dirty = false;
    landedNow.forEach(([i, d]) => { const r = rollers[i]; if (r.landedCb) { const cb = r.landedCb; r.landedCb = null; cb(i, d); } hooks.landed && hooks.landed(i, d); });
    schedule();
  }

  return {
    kind: 'webgl', topColor: TOP_COLOR,
    debug: () => ({ rollers: rollers.map((r) => ({ angle: r.M.angle(), phase: r.M.phase().kind, lock: r.lock })), winV, winTo }),
    resize(w, h, a) {
      W = Math.max(1, w); H = Math.max(1, h); area = a;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, W < 900 ? 1.75 : 2));
      renderer.setSize(W, H, false);
      frameCamera(); dirty = true; schedule();
    },
    show(digits, locked) {
      rollers.forEach((r, i) => { if (digits[i] == null) return; r.M.still(digits[i] * STEP); r.lock = r.lockTo = (Array.isArray(locked) ? locked[i] : locked) ? 1 : 0; r.landedCb = null; });
      dirty = true; schedule();
    },
    spin(which) { winTo = 0; rollers.forEach((r, i) => { if (which && which.indexOf(i) < 0) return; r.lockTo = 0; r.landedCb = null; r.M.spin(which ? 0 : i * STAGGER); }); schedule(); },
    land(i, d, opts) { const T = rollers[i].M.land(d, opts); schedule(); return T; },
    onLanded(i, cb) { rollers[i].landedCb = cb; },
    spinning(i) { return i == null ? rollers.some((r) => r.M.phase().kind !== 'still') : rollers[i].M.phase().kind !== 'still'; },
    unlock() { rollers.forEach((r) => { r.lockTo = 0; }); schedule(); },
    win(on) { winTo = on ? 1 : 0; schedule(); },
  };
}

// ------------------------------------------------------------------ 2D fallback (no WebGL)
function create2D(cv, hooks) {
  const g = cv.getContext('2d');
  const rollers = [0, 1, 2].map(() => ({ M: motion(), lock: 0, lockTo: 0, lastFace: -1, landedCb: null }));
  let W = 1, H = 1, area = null, dpr = 1, raf = 0, dirty = true, winV = 0, winTo = 0, lastT = performance.now();
  const wall = wallTexture();
  function draw() {
    if (!area) return; // not sized yet
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(wall, 0, 0, W, H);
    const cx = area.L + area.W / 2, cy = area.T + area.H / 2, cw = Math.min(area.W * 0.26, area.H * 0.36), ch = cw * 0.86, gap = cw * 1.12;
    g.fillStyle = '#2a1352'; g.beginPath(); g.roundRect(cx - gap * 1.5 - 18, cy - ch * 1.3, gap * 3 + 36, ch * 2.6, 22); g.fill();
    rollers.forEach((r, i) => {
      const [a, v] = r.M.angle(), x = cx + (i - 1) * gap;
      g.save(); g.beginPath(); g.rect(x - cw / 2, cy - ch * 1.05, cw, ch * 2.1); g.clip();
      g.fillStyle = '#1a0d36'; g.fillRect(x - cw / 2, cy - ch * 1.05, cw, ch * 2.1);
      const pos = a / STEP;
      for (let k = -2; k <= 2; k++) {
        const d = mod(Math.round(pos) + k, N), off = (Math.round(pos) + k - pos) * ch, y = cy + off;
        g.globalAlpha = Math.max(0, 1 - Math.abs(off) / (ch * 1.3)) * (v > 4 ? 0.55 : 1);
        g.fillStyle = r.lock > 0.5 && k === 0 ? '#ffcf6b' : '#ffffff';
        g.font = `800 ${Math.round(ch * 0.78)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(d), x, y + ch * 0.05);
      }
      g.restore(); g.globalAlpha = 1;
    });
    g.strokeStyle = winV > 0 ? '#ffe0a0' : '#ffbb60'; g.lineWidth = 4;
    g.strokeRect(cx - gap * 1.5, cy - ch / 2, gap * 3, ch);
  }
  function loop() {
    raf = 0;
    const t = performance.now(), dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    const landedNow = [];
    rollers.forEach((r, i) => {
      if (r.M.done()) { r.lockTo = 1; landedNow.push([i, r.M.phase().landed]); }
      if (r.lock !== r.lockTo) r.lock = r.lockTo > r.lock ? Math.min(1, r.lock + dt / 0.35) : Math.max(0, r.lock - dt / 0.35);
      const [a, v] = r.M.angle(), face = Math.floor(mod(a + STEP / 2, 2 * Math.PI) / STEP);
      if (face !== r.lastFace) { if (r.lastFace >= 0 && v > 0.2 && hooks.tick) hooks.tick(v / VMAX); r.lastFace = face; }
    });
    if (winV !== winTo) winV = winTo > winV ? Math.min(1, winV + dt / 0.6) : Math.max(0, winV - dt / 0.6);
    draw(); dirty = false;
    landedNow.forEach(([i, d]) => { const r = rollers[i]; if (r.landedCb) { const cb = r.landedCb; r.landedCb = null; cb(i, d); } hooks.landed && hooks.landed(i, d); });
    schedule();
  }
  function schedule() { if (!raf && (dirty || winV !== winTo || rollers.some((r) => r.M.phase().kind !== 'still' || r.lock !== r.lockTo))) raf = requestAnimationFrame(loop); }
  return {
    kind: '2d', topColor: TOP_COLOR,
    debug: () => ({ rollers: rollers.map((r) => ({ angle: r.M.angle(), phase: r.M.phase().kind, lock: r.lock })), winV, winTo }),
    resize(w, h, a) { W = w; H = h; area = a; dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); dirty = true; schedule(); },
    show(digits, locked) { rollers.forEach((r, i) => { if (digits[i] == null) return; r.M.still(digits[i] * STEP); r.lock = r.lockTo = (Array.isArray(locked) ? locked[i] : locked) ? 1 : 0; r.landedCb = null; }); dirty = true; schedule(); },
    spin(which) { winTo = 0; rollers.forEach((r, i) => { if (which && which.indexOf(i) < 0) return; r.lockTo = 0; r.landedCb = null; r.M.spin(which ? 0 : i * STAGGER); }); schedule(); },
    land(i, d, opts) { const T = rollers[i].M.land(d, opts); schedule(); return T; },
    onLanded(i, cb) { rollers[i].landedCb = cb; },
    spinning(i) { return i == null ? rollers.some((r) => r.M.phase().kind !== 'still') : rollers[i].M.phase().kind !== 'still'; },
    unlock() { rollers.forEach((r) => { r.lockTo = 0; }); schedule(); },
    win(on) { winTo = on ? 1 : 0; schedule(); },
  };
}

export async function create(cv, hooks) {
  await fontsReady();
  hooks = hooks || {};
  if (hasWebGL() && !/[?&]flat=1/.test(location.search)) {
    try { return await createGL(cv, hooks); } catch (e) {
      console.warn('Trio Rollers: WebGL failed, using 2D', e);
      const fresh = cv.cloneNode(false); cv.replaceWith(fresh); cv = fresh;
    }
  }
  return create2D(cv, hooks);
}
