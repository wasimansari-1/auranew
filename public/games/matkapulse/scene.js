/* Matka Pulse — the 3D draw (three.js 0.170.0, shared copy in ../_core/vendor), with a 2D canvas
 * fallback when WebGL is not available.
 *
 * Two glass matka pots on onyx plinths (OPEN glows purple, CLOSE glows gold), ten numbered balls in
 * each; a brass rack in front of each pot (three digit tiles = the panna, a coin = the single); the
 * gold JODI coin floats between the pots (the NX mark while betting, the jodi after the draw).
 *
 * Choreography (all motion is an analytic function of time, so it is identical at any frame rate):
 *   startPot(side)   the pot's balls lift off the floor into a slow tumble (smoothstep ramp 0.8 s)
 *   digit(i, v)      draw i (0–2 open, 3–5 close) of digit v: ball v rises out of the neck and turns its
 *                    number to the camera (0.55 s), hovers, its rack tile flips in (0.8 s), the ball
 *                    sinks back into the pot (to 1.15 s). After a pot's third digit its tiles slide into
 *                    panna order (1.05 s), its single coin flips (1.5 s); after the close pot the jodi
 *                    coin flips (1.6 s → revealed at 2.15 s). The open pot settles as the close pot starts.
 *   show(digits)     jump straight to a state (joining mid-round, a missed draw): 0–6 digits drawn
 *   reset()          new round: tiles and coins flip back, glow off
 *   glow(on)         the result glow
 * Hooks: pop(i) (a ball reaches the top), tile(i), sorted(side), revealed(). The scene renders only
 * while something moves (battery); it lowers its pixel ratio by itself if frames are slow.
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), startPot, digit, show, reset, glow,
 *      busy(), topColor, kind: 'webgl' | '2d' }>
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';

const TOP_COLOR = '#0b0620';
const BASE = new URL('.', import.meta.url).href;
const POTX = 1.55;
const RISE = 0.55, HOLD = 0.8, BACK = 1.15, SORT_AT = 1.05, SORT_T = 0.45, COIN_AT = 1.5, COIN_T = 0.4, JODI_AT = 1.6, JODI_T = 0.55;
const RAMP_UP = 0.8, RAMP_DOWN = 1.0;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const smoother = (u) => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
const easeOut = (u) => { u = clamp(u, 0, 1); return 1 - Math.pow(1 - u, 3); };
const key = (d) => (d === 0 ? 10 : d);

// draw order → sorted slot (stable): the tiles slide into matka order
function sortSlots(ds) {
  const idx = [0, 1, 2].sort((a, b) => key(ds[a]) - key(ds[b]) || a - b);
  const slot = [0, 0, 0];
  idx.forEach((i, s) => { slot[i] = s; });
  return slot;
}
function single(ds) { return (ds[0] + ds[1] + ds[2]) % 10; }

// ------------------------------------------------------------------ textures
let FONT = '"Outfit", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
async function fontsReady() {
  try {
    await Promise.race([document.fonts.load('800 200px Outfit'), new Promise((r) => setTimeout(r, 2500))]);
    if (!document.fonts.check('800 200px Outfit')) FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  } catch (e) { /* keep the stack */ }
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function radial(stops, size) {
  const s = size || 256, [c, g] = canvas(s, s), h = s / 2;
  const r = g.createRadialGradient(h, h, 0, h, h, h);
  stops.forEach(([o, col]) => r.addColorStop(o, col));
  g.fillStyle = r; g.fillRect(0, 0, s, s);
  return c;
}
function ballTexture(d, band) {
  const [c, g] = canvas(384, 192);
  g.fillStyle = '#f7f2ea'; g.fillRect(0, 0, 384, 192);
  g.fillStyle = band; g.fillRect(0, 58, 384, 76);
  for (const cx of [96, 288]) {
    g.fillStyle = '#fffdf8'; g.beginPath(); g.arc(cx, 96, 44, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#160b2a'; g.font = '800 66px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(d), cx, 100);
    if (d === 6 || d === 9) g.fillRect(cx - 14, 132, 28, 5);
  }
  return c;
}
function tileTexture(d) { // a rack tile: dark glass, gold frame, the digit (null = blank)
  const [c, g] = canvas(170, 190);
  const tg = g.createLinearGradient(0, 0, 0, 190); tg.addColorStop(0, '#2c1a52'); tg.addColorStop(1, '#160b2e');
  g.fillStyle = tg; rr(g, 3, 3, 164, 184, 20); g.fill();
  const fg = g.createLinearGradient(0, 0, 0, 190); fg.addColorStop(0, '#ffe7ae'); fg.addColorStop(0.5, '#d89a3e'); fg.addColorStop(1, '#ffd98a');
  g.strokeStyle = fg; g.lineWidth = 5; rr(g, 4, 4, 162, 182, 19); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.07)'; rr(g, 10, 10, 150, 70, 14); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (d == null) { g.fillStyle = 'rgba(255,255,255,.2)'; g.font = '800 96px ' + FONT; g.fillText('–', 85, 100); }
  else {
    const dg = g.createLinearGradient(0, 40, 0, 160); dg.addColorStop(0, '#ffffff'); dg.addColorStop(1, '#ecdfff');
    g.fillStyle = dg; g.font = '800 136px ' + FONT; g.fillText(String(d), 85, 104);
  }
  return c;
}
function coinFace(kind) { // single coin: '?' (front) or the digit in gold (back)
  const [c, g] = canvas(256, 256), m = 128;
  if (kind === '?') {
    g.fillStyle = '#170c30'; g.beginPath(); g.arc(m, m, 124, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,207,107,.6)'; g.lineWidth = 6; g.setLineDash([16, 14]); g.beginPath(); g.arc(m, m, 108, 0, 7); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,.28)'; g.font = '800 120px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', m, m + 8);
  } else {
    const cg = g.createRadialGradient(m - 34, m - 44, 10, m, m, 128);
    cg.addColorStop(0, '#fff3cf'); cg.addColorStop(0.55, '#ffc65e'); cg.addColorStop(1, '#b06e1c');
    g.fillStyle = cg; g.beginPath(); g.arc(m, m, 126, 0, 7); g.fill();
    g.strokeStyle = '#fff0c8'; g.lineWidth = 6; g.beginPath(); g.arc(m, m, 110, 0, 7); g.stroke();
    g.fillStyle = '#2a1504'; g.font = '900 150px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(kind), m, m + 10);
  }
  return c;
}
function plaqueTexture(side) { // the brass plaque: the pot's name, three tile wells, "=", the single's well
  const [c, g] = canvas(1024, 300), isO = side === 'open';
  const pg = g.createLinearGradient(0, 0, 0, 300); pg.addColorStop(0, '#1d1036'); pg.addColorStop(1, '#0b061c');
  g.fillStyle = pg; rr(g, 4, 4, 1016, 292, 44); g.fill();
  const bg = g.createLinearGradient(0, 0, 1024, 0); bg.addColorStop(0, '#9a6220'); bg.addColorStop(0.5, '#ffe3a3'); bg.addColorStop(1, '#9a6220');
  g.strokeStyle = bg; g.lineWidth = 7; rr(g, 8, 8, 1008, 284, 41); g.stroke();
  g.fillStyle = isO ? '#c9a2ff' : '#ffc46e'; g.font = '800 44px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.letterSpacing = '10px'; g.fillText(isO ? 'OPEN' : 'CLOSE', 44, 48); g.letterSpacing = '0px';
  g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '700 22px ' + FONT; g.textAlign = 'center'; g.letterSpacing = '6px'; g.fillText('SINGLE', 830, 50); g.letterSpacing = '0px';
  for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(0,0,0,.45)'; rr(g, 40 + i * 190, 82, 170, 190, 22); g.fill(); }
  g.fillStyle = 'rgba(255,207,107,.7)'; g.font = '700 70px ' + FONT; g.fillText('=', 640, 180);
  g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(830, 168, 100, 0, 7); g.fill();
  return c;
}
function jodiFace(text, logo) {
  const [c, g] = canvas(512, 512), m = 256;
  const rg = g.createRadialGradient(m - 60, m - 80, 20, m, m, m);
  rg.addColorStop(0, '#2c1656'); rg.addColorStop(1, '#0f0722');
  g.fillStyle = rg; g.beginPath(); g.arc(m, m, m, 0, 7); g.fill();
  g.strokeStyle = '#ffd78a'; g.lineWidth = 14; g.beginPath(); g.arc(m, m, m - 22, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(255,215,138,.4)'; g.lineWidth = 3; g.beginPath(); g.arc(m, m, m - 44, 0, 7); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (logo) { // the real NX mark of logo.webp (cropped), never redrawn
    const sx = 150, sy = 205, sw = 740, sh = 400, dw = 330, dh = dw * sh / sw;
    g.drawImage(logo, sx, sy, sw, sh, m - dw / 2, m - dh / 2 - 26, dw, dh);
    g.fillStyle = '#ffd78a'; g.font = '800 38px ' + FONT; g.letterSpacing = '10px'; g.fillText('JODI', m + 5, m + 128); g.letterSpacing = '0px';
  } else {
    g.fillStyle = '#ffd78a'; g.font = '800 40px ' + FONT; g.letterSpacing = '12px'; g.fillText('JODI', m + 6, 150); g.letterSpacing = '0px';
    const fg = g.createLinearGradient(0, 180, 0, 380); fg.addColorStop(0, '#fff7e0'); fg.addColorStop(1, '#ffc65e');
    g.fillStyle = fg; g.font = '900 230px ' + FONT; g.fillText(text, m, m + 50);
  }
  return c;
}
function backdrop() {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#0b0620'; g.fillRect(0, 0, 1024, 1024);
  const r = g.createRadialGradient(512, 560, 20, 512, 560, 620);
  r.addColorStop(0, '#3d1680'); r.addColorStop(0.32, '#25105a'); r.addColorStop(0.65, '#120731'); r.addColorStop(1, '#0b0620');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  const r2 = g.createRadialGradient(512, 760, 10, 512, 760, 300);
  r2.addColorStop(0, 'rgba(255,187,96,.10)'); r2.addColorStop(1, 'rgba(255,187,96,0)');
  g.fillStyle = r2; g.fillRect(0, 0, 1024, 1024);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 60; i++) {
    const x = rnd() * 1024, y = 80 + rnd() * 620, rad = 4 + rnd() * 18, a = 0.04 + rnd() * 0.1;
    const b = g.createRadialGradient(x, y, 0, x, y, rad);
    b.addColorStop(0, `rgba(${rnd() > 0.7 ? '255,190,110' : '190,140,255'},${a})`); b.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}
function floorTexture() {
  const [c, g] = canvas(1024, 1024), m = 512;
  const r = g.createRadialGradient(m, m, 0, m, m, m);
  r.addColorStop(0, 'rgba(40,20,78,1)'); r.addColorStop(0.42, 'rgba(24,12,48,.95)'); r.addColorStop(0.75, 'rgba(14,7,30,.6)'); r.addColorStop(1, 'rgba(11,6,32,0)');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(255,196,110,.38)'; g.lineWidth = 3;
  for (const k of [0.30, 0.315]) { g.beginPath(); g.arc(m, m, 1024 * k, 0, 7); g.stroke(); }
  g.strokeStyle = 'rgba(168,85,247,.25)'; g.lineWidth = 2; g.beginPath(); g.arc(m, m, 1024 * 0.4, 0, 7); g.stroke();
  return c;
}
function loadImage(src) { return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }

// ------------------------------------------------------------------ the round timeline (shared by both renderers)
// Everything visible is derived from a list of timed events, so a frame at any time is exact.
function timeline() {
  const T = {
    digits: [],          // drawn digits so far (draw order)
    at: [],              // when each was drawn (s, performance clock); -1e9 = instantly
    potOn: { open: null, close: null },   // tumble start time (null = resting)
    potOff: { open: null, close: null },  // tumble stop time
    resetAt: -1e9,       // last reset (tiles/coins flip back)
    glowTo: 0, glowAt: -1e9, glowFrom: 0,
  };
  return T;
}

// ------------------------------------------------------------------ WebGL
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

async function createGL(cv, hooks) {
  let qaClock = null; // QA only (frameAt): a frozen clock, so every render shows exactly that moment
  const now = () => (qaClock != null ? qaClock : performance.now() / 1000);
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0b0620, 1);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
  const logo = await loadImage(new URL('../../logo.webp', BASE).href);

  // backdrop + floor
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(44, 26), new THREE.MeshBasicMaterial({ map: tex(backdrop()), depthWrite: false, toneMapped: false }));
  bg.position.set(0, 2.5, -12); scene.add(bg);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 96), new THREE.MeshStandardMaterial({ map: tex(floorTexture()), transparent: true, metalness: 0.5, roughness: 0.32, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.renderOrder = 1; scene.add(floor);

  scene.add(new THREE.HemisphereLight(0xcdb8ff, 0x1a0b2e, 0.55));
  const keyL = new THREE.DirectionalLight(0xfff1dc, 1.6); keyL.position.set(2.5, 6, 5); scene.add(keyL);
  const rimL = new THREE.DirectionalLight(0xb48cff, 1.1); rimL.position.set(-4, 3, -5); scene.add(rimL);

  const gold = new THREE.MeshStandardMaterial({ color: 0xffc46e, metalness: 1, roughness: 0.22, envMapIntensity: 1.25 });
  const darkGold = new THREE.MeshStandardMaterial({ color: 0x8a5a1c, metalness: 1, roughness: 0.35 });
  const onyx = new THREE.MeshStandardMaterial({ color: 0x120a22, metalness: 0.4, roughness: 0.28, envMapIntensity: 0.9 });
  const glowTex = tex(radial([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]));
  const sprite = (color, opacity, sx, sy) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(sx, sy || sx, 1); return s;
  };

  // ---- pots
  const profile = [[0.0, 0.00], [0.42, 0.00], [0.48, 0.05], [0.44, 0.12], [0.62, 0.30], [0.84, 0.55], [0.93, 0.80], [0.92, 1.02], [0.82, 1.26], [0.62, 1.48], [0.44, 1.62], [0.40, 1.74], [0.44, 1.84], [0.56, 1.92], [0.60, 1.95]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const potGeo = new THREE.LatheGeometry(profile, 72);
  const ballGeo = new THREE.SphereGeometry(0.17, 32, 20);
  const REST = [[0, 0.17, 0], [0.3, 0.2, 0.05], [-0.28, 0.2, 0.1], [0.1, 0.2, 0.3], [-0.12, 0.2, -0.3], [0.22, 0.22, -0.24], [-0.33, 0.24, -0.12], [0.05, 0.47, 0.1], [-0.15, 0.48, -0.08], [0.2, 0.49, -0.02]];
  function makePot(side, x, tint, band, glowCol) {
    const grp = new THREE.Group(); grp.position.x = x; scene.add(grp);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.16, 48), onyx); ped.position.y = 0.08; grp.add(ped);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.80, 0.022, 10, 72), gold); ring.rotation.x = Math.PI / 2; ring.position.y = 0.16; grp.add(ring);
    const neon = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.012, 6, 72), new THREE.MeshBasicMaterial({ color: glowCol })); neon.rotation.x = Math.PI / 2; neon.position.y = 0.02; grp.add(neon);
    const body = new THREE.Group(); body.position.y = 0.16; grp.add(body);
    const back = new THREE.Mesh(potGeo, new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.06, transparent: true, opacity: 0.13, side: THREE.BackSide, envMapIntensity: 1.2, depthWrite: false }));
    const front = new THREE.Mesh(potGeo, new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.11, envMapIntensity: 1.7, depthWrite: false }));
    back.renderOrder = 2; front.renderOrder = 5; body.add(back, front);
    for (const [r, y, t] of [[0.47, 0.05, 0.03], [0.925, 0.86, 0.022], [0.41, 1.66, 0.03], [0.60, 1.95, 0.035]]) {
      const b = new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 72), gold); b.rotation.x = Math.PI / 2; b.position.y = y; body.add(b);
    }
    const light = new THREE.PointLight(glowCol, 2.2, 2.6, 2); light.position.y = 0.9; body.add(light);
    const halo = sprite(glowCol, 0.5, 2.6); halo.position.y = 0.85; halo.renderOrder = 3; body.add(halo);
    const balls = [];
    for (let d = 0; d < 10; d++) {
      const m = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ map: tex(ballTexture(d, band)), roughness: 0.3, metalness: 0, envMapIntensity: 0.9 }));
      m.renderOrder = 4; body.add(m);
      let s = 11 + d * 7 + (side === 'close' ? 101 : 0); const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const rest = new THREE.Vector3(...REST[d]), restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6));
      // tumble path: three incommensurate sines inside the belly
      const path = { ax: 0.34 + rnd() * 0.14, az: 0.32 + rnd() * 0.14, ay: 0.26 + rnd() * 0.14, wx: 2.1 + rnd() * 1.4, wz: 2.3 + rnd() * 1.4, wy: 2.8 + rnd() * 1.6, px: rnd() * 6.28, pz: rnd() * 6.28, py: rnd() * 6.28, rx: 2 + rnd() * 3, ry: 1.5 + rnd() * 3 };
      balls.push({ mesh: m, rest, restQ, path, d, show: null });
    }
    const showGlow = sprite(0xffd08a, 0, 2.1); showGlow.position.set(0, 2.58, 0.05); showGlow.renderOrder = 6; body.add(showGlow);
    return { side, grp, body, balls, light, halo, showGlow, baseLight: 2.2 };
  }
  const pots = { open: makePot('open', -POTX, 0xc9a2ff, '#7c3aed', 0xa855f7), close: makePot('close', POTX, 0xffd9a0, '#e09a35', 0xffb24f) };

  // ---- racks: plaque + three flipping tiles + the single coin
  const tileTex = [], tileGeo = new THREE.PlaneGeometry(0.34, 0.38);
  for (let d = 0; d <= 9; d++) tileTex[d] = tex(tileTexture(d));
  const blankTex = tex(tileTexture(null));
  const coinQ = tex(coinFace('?')), coinD = [];
  for (let d = 0; d <= 9; d++) coinD[d] = tex(coinFace(d));
  const SLOT_X = [-0.775, -0.395, -0.016];
  function makeRack(side, x) {
    const g = new THREE.Group(); g.position.set(x * 1.05, 0.38, 1.95); g.rotation.x = -0.42; g.scale.setScalar(1.1); scene.add(g);
    const ptex = tex(plaqueTexture(side));
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.6, 0.07), [darkGold, darkGold, darkGold, darkGold,
      new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.7, metalness: 0, envMapIntensity: 0.25, emissive: 0xffffff, emissiveMap: ptex, emissiveIntensity: 0.7 }), onyx]);
    g.add(plaque);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.08, 0.34), onyx); stand.position.set(x * 1.05, 0.05, 1.9); scene.add(stand);
    const tiles = [];
    for (let i = 0; i < 3; i++) {
      const piv = new THREE.Group(); piv.position.set(SLOT_X[i], -0.054, 0.045); g.add(piv);
      const m = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ map: blankTex, toneMapped: false, transparent: true }));
      piv.add(m); tiles.push({ piv, mesh: m, shown: -2 });
    }
    const coin = new THREE.Group(); coin.position.set(0.637, -0.036, 0.05); g.add(coin);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 40), gold); rim.rotation.x = Math.PI / 2; coin.add(rim);
    const cf = new THREE.Mesh(new THREE.CircleGeometry(0.19, 40), new THREE.MeshBasicMaterial({ map: coinQ, toneMapped: false }));
    cf.position.z = 0.016; coin.add(cf);
    const cb = new THREE.Mesh(new THREE.CircleGeometry(0.19, 40), new THREE.MeshBasicMaterial({ map: coinD[0], toneMapped: false }));
    cb.position.z = -0.016; cb.rotation.y = Math.PI; coin.add(cb);
    const glow = sprite(0xffc46e, 0, 3.2, 1.3); glow.position.set(x * 1.04, 0.42, 1.75); scene.add(glow);
    return { g, tiles, coin, coinBack: cb, glow, coinShown: -1 };
  }
  const racks = { open: makeRack('open', -POTX), close: makeRack('close', POTX) };

  // ---- the jodi coin
  const jodi = new THREE.Group(); jodi.position.set(0, 1.42, 0.35); scene.add(jodi);
  const jtilt = new THREE.Group(); jtilt.rotation.x = -0.12; jodi.add(jtilt);
  const jflip = new THREE.Group(); jtilt.add(jflip);
  { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.09, 72), gold); c.rotation.x = Math.PI / 2; jflip.add(c);
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.625, 0.03, 10, 72), gold); jflip.add(t); }
  const jFront = new THREE.Mesh(new THREE.CircleGeometry(0.6, 72), new THREE.MeshStandardMaterial({ map: tex(jodiFace('', logo)), metalness: 0.3, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.55 }));
  jFront.material.emissiveMap = jFront.material.map; jFront.position.z = 0.047; jflip.add(jFront);
  const jBackCanvas = jodiFace('00', null), jBackTex = tex(jBackCanvas);
  const jBack = new THREE.Mesh(new THREE.CircleGeometry(0.6, 72), new THREE.MeshStandardMaterial({ map: jBackTex, emissiveMap: jBackTex, metalness: 0.3, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.55 }));
  jBack.position.z = -0.047; jBack.rotation.y = Math.PI; jflip.add(jBack);
  const jGlow = sprite(0xffb24f, 0.28, 2.6); jGlow.position.set(0, 1.42, 0.2); scene.add(jGlow);
  let jShown = '';
  function setJodiText(t) {
    if (t === jShown) return;
    jShown = t;
    const fresh = jodiFace(t, null), g = jBackCanvas.getContext('2d');
    g.clearRect(0, 0, 512, 512); g.drawImage(fresh, 0, 0); jBackTex.needsUpdate = true;
  }

  // ---- state + timeline
  const T = timeline();
  let W = 1, H = 1, area = null, dirty = true, raf = 0, dpr = 1, dprCap = 1.75, slow = 0, frames = 0, lastT = 0;
  const fired = {};   // hook keys already fired
  function fire(k, fn) { if (!fired[k]) { fired[k] = true; fn && fn(); } }

  // preallocated temporaries (no allocation per frame: no GC hitches on cheap phones)
  const vHome = new THREE.Vector3(), vPos = new THREE.Vector3(), vA = new THREE.Vector3(), vB = new THREE.Vector3();
  const qSpin = new THREE.Quaternion(), qHome = new THREE.Quaternion(), qOut = new THREE.Quaternion(), eSpin = new THREE.Euler();
  const faceQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0));
  const TOP = new THREE.Vector3(0, 2.58, 0.25), NECK = new THREE.Vector3(0, 1.9, 0.05);
  const spin = { open: 0, close: 0 };   // accumulated tumble spin (rad), grows with the tumble
  let spinT = 0;
  function tumbleAmp(side, t) {
    const on = T.potOn[side], off = T.potOff[side];
    if (on == null) return 0;
    let a = smooth((t - on) / RAMP_UP);
    if (off != null && t >= off) a *= 1 - smooth((t - off) / RAMP_DOWN);
    return a;
  }
  // the pot's inner radius at height y (body space), from the lathe profile
  function innerR(y) {
    for (let k = 1; k < profile.length; k++) {
      const p0 = profile[k - 1], p1 = profile[k];
      if (y <= p1.y) return p0.x + (p1.x - p0.x) * clamp((y - p0.y) / Math.max(1e-6, p1.y - p0.y), 0, 1);
    }
    return 0.4;
  }
  function ballHome(b, a, t, out) { // where ball b is (resting ↔ tumbling), kept inside the glass
    const p = b.path;
    out.set(Math.sin(p.wx * t + p.px) * p.ax, 0.8 + Math.sin(p.wy * t + p.py) * p.ay, Math.sin(p.wz * t + p.pz) * p.az);
    const lim = innerR(out.y) - 0.2, r = Math.hypot(out.x, out.z);
    if (r > lim) { out.x *= lim / r; out.z *= lim / r; }
    return out.lerp(b.rest, 1 - a);
  }
  function frameCamera() {
    const target = new THREE.Vector3(0, 1.05, 0);
    camera.fov = 30;
    camera.aspect = area.W / Math.max(1, area.H);
    const needW = 6.95, needH = 3.4, vf = THREE.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const d = Math.max(needW / 2 / Math.tan(hf / 2), needH / 2 / Math.tan(vf / 2)) + 0.9;
    const dir = new THREE.Vector3(0, 0.3, 1).normalize();
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.setViewOffset(area.W, area.H, -area.L, -area.T, W, H);
    camera.updateProjectionMatrix();
  }

  // the whole scene at time t; returns true while something still moves
  function pose(t) {
    let moving = false;
    const dtS = spinT ? clamp(t - spinT, 0, 0.1) : 0; spinT = t;
    for (const side of ['open', 'close']) {
      const P = pots[side], amp = tumbleAmp(side, t);
      if (amp > 0) moving = true;
      spin[side] += amp * dtS;
      P.light.intensity = P.baseLight * (1 + 0.6 * amp);
      let showA = 0;
      for (const b of P.balls) {
        ballHome(b, amp, t, vHome);
        eSpin.set(b.path.rx * spin[side], b.path.ry * spin[side], 0);
        qSpin.setFromEuler(eSpin);
        qHome.copy(b.restQ).multiply(qSpin);
        vPos.copy(vHome); qOut.copy(qHome);
        let scale = 1;
        for (let i = side === 'open' ? 0 : 3, e = i + 3; i < e && i < T.digits.length; i++) { // this ball's draws
          if (T.digits[i] !== b.d) continue;
          const s = t - T.at[i];
          if (s < 0 || s > BACK) continue;
          moving = true;
          if (s <= RISE) { // rise from its place through the neck to the top
            const u = smoother(s / RISE);
            vA.copy(vPos).lerp(NECK, u); vB.copy(NECK).lerp(TOP, u); vPos.copy(vA).lerp(vB, u);
            scale += (2.6 - scale) * u; // from wherever it is (a ball drawn again while it still hovers)
            qOut.slerp(faceQ, easeOut(s / RISE));
          } else if (s <= HOLD) { // hover, number to the camera
            vPos.copy(TOP); vPos.y += Math.sin((s - RISE) / (HOLD - RISE) * Math.PI) * 0.03;
            scale = 2.6; qOut.copy(faceQ);
          } else { // sink back into the pot, onto its moving place
            const u = smoother((s - HOLD) / (BACK - HOLD));
            vA.copy(TOP).lerp(NECK, u); vB.copy(NECK).lerp(vPos, u); vPos.copy(vA).lerp(vB, u);
            scale = 2.6 - 1.6 * u; qOut.copy(faceQ).slerp(qHome, u);
          }
          const a = s < RISE ? smooth(s / RISE) : s < HOLD ? 1 : 1 - smooth((s - HOLD) / (BACK - HOLD));
          showA = 1 - (1 - showA) * (1 - a); // overlapping draws (a late step) blend smoothly
          if (s >= RISE) fire('pop' + i, () => hooks.pop && hooks.pop(i));
        }
        b.mesh.position.copy(vPos); b.mesh.quaternion.copy(qOut); b.mesh.scale.setScalar(scale);
      }
      P.showGlow.material.opacity = 0.85 * showA;
    }
    // racks: tiles flip in at HOLD after their draw; sort after the pot's third; coin flips
    for (const side of ['open', 'close']) {
      const R = racks[side], base = side === 'open' ? 0 : 3, ds = T.digits.slice(base, base + 3);
      const resetU = clamp((t - T.resetAt) / 0.45, 0, 1); // tiles flip back to blank on a reset
      const full = ds.length === 3, slots = full ? sortSlots(ds) : [0, 1, 2], sortT = full ? T.at[base + 2] + SORT_AT : 1e9;
      const su = smoother((t - sortT) / SORT_T);
      if (su > 0 && su < 1) moving = true;
      for (let i = 0; i < 3; i++) {
        const tl = R.tiles[i], drawn = i < ds.length;
        let ang = 0;
        if (drawn) {
          const s = t - (T.at[base + i] + HOLD), u = clamp(s / 0.35, 0, 1);
          if (u < 1 && s > -0.0001) moving = true;
          // one continuous half turn (smootherstep 0 → 180°): the blank face turns away, the digit
          // face (swapped in edge-on at 90°) turns in — same speed on both sides of the swap
          const phi = Math.PI * smoother(u), want = phi >= Math.PI / 2 ? ds[i] : -1;
          if (tl.shown !== want) { tl.shown = want; tl.mesh.material.map = want >= 0 ? tileTex[want] : blankTex; tl.mesh.material.needsUpdate = true; }
          ang = phi <= Math.PI / 2 ? phi : Math.PI - phi;
          if (s >= 0) fire('tile' + (base + i), () => hooks.tile && hooks.tile(base + i));
        } else if (tl.back) { // flip back to blank after a reset: digit turns away, blank turns in
          const phi = Math.PI * smoother((t - T.resetAt) / 0.45);
          if (phi >= Math.PI / 2 && tl.shown !== -1) { tl.shown = -1; tl.mesh.material.map = blankTex; tl.mesh.material.needsUpdate = true; }
          ang = phi <= Math.PI / 2 ? phi : Math.PI - phi;
          if (resetU >= 1) tl.back = false;
          moving = true;
        }
        tl.piv.rotation.x = -ang;
        const x0 = SLOT_X[i], x1 = SLOT_X[slots[i]];
        tl.piv.position.x = x0 + (x1 - x0) * su;
        tl.piv.position.z = 0.045 + Math.sin(su * Math.PI) * 0.09 * (slots[i] !== i ? 1 : 0);
      }
      if (full && su >= 1) fire('sorted' + side, () => hooks.sorted && hooks.sorted(side));
      // single coin
      let cAng = 0;
      if (full) {
        const s = t - (T.at[base + 2] + COIN_AT), u = smoother(s / COIN_T);
        if (u > 0 && u < 1) moving = true;
        const sd = single(ds);
        if (R.coinShown !== sd) { R.coinShown = sd; R.coinBack.material.map = coinD[sd]; R.coinBack.material.needsUpdate = true; }
        cAng = Math.PI * u;
      } else {
        const u = smoother((t - T.resetAt) / COIN_T);
        if (u < 1) moving = true;
        cAng = R.coinWas != null ? R.coinWas * (1 - u) : 0;
      }
      R.coin.rotation.y = cAng;
      R.coinAng = cAng;
    }
    // jodi coin
    let jAng = 0;
    if (T.digits.length === 6) {
      const s = t - (T.at[5] + JODI_AT), u = smoother(s / JODI_T);
      if (u > 0 && u < 1) moving = true;
      setJodiText('' + single(T.digits.slice(0, 3)) + single(T.digits.slice(3)));
      jAng = Math.PI * u;
      if (u >= 1) fire('revealed', () => hooks.revealed && hooks.revealed());
    } else {
      const u = smoother((t - T.resetAt) / JODI_T);
      if (u < 1) moving = true;
      jAng = (T.jodiWas || 0) * (1 - u);
    }
    jflip.rotation.y = jAng;
    T.jodiAng = jAng;
    // result glow
    const g = T.glowFrom + (T.glowTo - T.glowFrom) * smooth((t - T.glowAt) / 0.5);
    if (g !== T.glowTo) moving = true;
    racks.open.glow.material.opacity = 0.38 * g; racks.close.glow.material.opacity = 0.38 * g;
    jGlow.material.opacity = 0.28 + 0.5 * g;
    T.glowNow = g;
    return moving;
  }

  function loop() {
    raf = 0;
    const t = now();
    const moving = pose(t);
    renderer.render(scene, camera);
    dirty = false;
    // adaptive quality: average frame interval while moving; slow → lower the pixel ratio once or twice
    if (moving && lastT) {
      const dt = t - lastT;
      if (dt < 0.25) { frames++; slow += dt > 1 / 40 ? 1 : 0; }
      if (frames >= 90) {
        if (slow > 45 && dpr > 1.01) { dprCap = Math.max(1, dpr - 0.35); applySize(); }
        frames = 0; slow = 0;
      }
    }
    lastT = moving ? t : 0;
    if (moving || dirty) raf = requestAnimationFrame(loop);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(loop); }
  function applySize() {
    dpr = Math.min(window.devicePixelRatio || 1, dprCap, W >= 900 ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    dirty = true;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { dirty = true; schedule(); } });

  return {
    kind: 'webgl', topColor: TOP_COLOR,
    resize(w, h, a) { W = Math.max(1, w); H = Math.max(1, h); area = a; applySize(); frameCamera(); schedule(); },
    startPot(side, at) { const t = at != null ? at : now(); if (T.potOn[side] == null || T.potOff[side] != null) { T.potOn[side] = t; T.potOff[side] = null; } schedule(); },
    digit(i, v, at) {
      if (i !== T.digits.length) return; // out of order / repeated: ignored (show() resyncs)
      const t = at != null ? at : now();
      T.digits.push(v); T.at.push(t);
      const side = i < 3 ? 'open' : 'close';
      if (T.potOn[side] == null) { T.potOn[side] = t; T.potOff[side] = null; }
      if (i === 2) { T.potOff.open = t + BACK; T.potOn.close = t + 1.0; T.potOff.close = null; }
      if (i === 5) T.potOff.close = t + BACK;
      schedule();
    },
    // jump to a state: `digits` drawn so far (0–6); the current pot tumbles if the draw is running
    show(digits, opts) {
      const t = now(), past = t - 60;
      T.digits = digits.slice(0, 6); T.at = T.digits.map(() => past);
      for (const k of Object.keys(fired)) delete fired[k];
      ['pop', 'tile'].forEach((p) => { for (let i = 0; i < T.digits.length; i++) fired[p + i] = true; });
      if (T.digits.length >= 3) fired.sortedopen = true;
      if (T.digits.length === 6) { fired.sortedclose = true; }
      T.potOn.open = T.potOn.close = null; T.potOff.open = T.potOff.close = null;
      const drawing = opts && opts.drawing;
      if (drawing && T.digits.length < 3) T.potOn.open = past;
      if (drawing && T.digits.length >= 3 && T.digits.length < 6) T.potOn.close = past;
      T.resetAt = past; racks.open.coinWas = racks.close.coinWas = 0; T.jodiWas = 0;
      for (const side of ['open', 'close']) for (let i = 0; i < 3; i++) {
        const tl = racks[side].tiles[i], k = (side === 'open' ? 0 : 3) + i;
        tl.back = false;
        if (k >= T.digits.length && tl.shown !== -1) { tl.shown = -1; tl.mesh.material.map = blankTex; tl.mesh.material.needsUpdate = true; }
      }
      dirty = true; schedule();
      if (T.digits.length === 6) { fire('revealed', () => {}); }
    },
    reset(at) {
      const t = at != null ? at : now();
      racks.open.coinWas = racks.open.coinAng || 0; racks.close.coinWas = racks.close.coinAng || 0; T.jodiWas = T.jodiAng || 0;
      for (const side of ['open', 'close']) for (const tl of racks[side].tiles) tl.back = tl.shown >= 0;
      T.digits = []; T.at = []; T.resetAt = t;
      T.potOn.open = T.potOn.close = null; T.potOff.open = T.potOff.close = null;
      T.glowFrom = T.glowNow || 0; T.glowTo = 0; T.glowAt = t;
      for (const k of Object.keys(fired)) delete fired[k];
      schedule();
    },
    glow(on, at) { const t = at != null ? at : now(); T.glowFrom = T.glowNow || 0; T.glowTo = on ? 1 : 0; T.glowAt = t; schedule(); },
    busy() { return T.digits.length > 0 && T.digits.length < 6; },
    drawn() { return T.digits.slice(); },
    // QA: the scene's moving parts at time t (s, performance clock) as numbers — checked for
    // jumps frame by frame by the QA script (positions, scales, angles, opacities)
    frameAt(t) { qaClock = t; pose(t); renderer.render(scene, camera); dirty = true; schedule(); }, // QA: freeze the clock at t
    probe(t) {
      pose(t);
      const out = [];
      for (const side of ['open', 'close']) {
        for (const b of pots[side].balls) out.push(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z, b.mesh.scale.x);
        out.push(pots[side].showGlow.material.opacity, pots[side].light.intensity);
        for (const tl of racks[side].tiles) out.push(tl.piv.rotation.x, tl.piv.position.x, tl.piv.position.z);
        out.push(racks[side].coin.rotation.y, racks[side].glow.material.opacity);
      }
      out.push(jflip.rotation.y, jGlow.material.opacity);
      return out;
    },
  };
}

// ------------------------------------------------------------------ 2D fallback (no WebGL): flat pots, racks and the jodi
function create2D(cv, hooks) {
  const g = cv.getContext('2d');
  let W = 1, H = 1, area = null, dpr = 1, digits = [], drawingSide = null, glow = 0, raf = 0;
  const bg = backdrop();
  function panna(ds) { return ds.slice().sort((a, b) => key(a) - key(b)); }
  function draw() {
    raf = 0;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg, 0, 0, W, H);
    const cx = area.L + area.W / 2, cy = area.T + area.H * 0.46, s = Math.min(area.W / 7, area.H / 4.2);
    for (const [i, side] of [[-1, 'open'], [1, 'close']]) {
      const x = cx + i * s * 1.65, ds = digits.slice(side === 'open' ? 0 : 3, side === 'open' ? 3 : 6);
      g.fillStyle = side === 'open' ? 'rgba(168,85,247,.22)' : 'rgba(255,187,96,.18)';
      g.beginPath(); g.ellipse(x, cy - s * 0.4, s * 0.9, s * 0.95, 0, 0, 7); g.fill();
      g.strokeStyle = '#ffc46e'; g.lineWidth = 2; g.stroke();
      if (drawingSide === side) { g.fillStyle = '#fff'; g.font = `800 ${s * 0.5}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('···', x, cy - s * 0.4); }
      const shown = ds.length === 3 ? panna(ds) : ds;
      for (let k = 0; k < 3; k++) {
        const tx = x - s * 0.75 + k * s * 0.5, ty = cy + s * 0.75;
        g.fillStyle = '#1d1036'; g.fillRect(tx, ty, s * 0.44, s * 0.5);
        g.strokeStyle = glow ? '#ffe3a3' : '#d89a3e'; g.strokeRect(tx, ty, s * 0.44, s * 0.5);
        g.fillStyle = '#fff'; g.font = `800 ${s * 0.36}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(k < shown.length ? String(shown[k]) : '–', tx + s * 0.22, ty + s * 0.27);
      }
      if (ds.length === 3) { g.fillStyle = '#ffc65e'; g.beginPath(); g.arc(x + s * 0.95, cy + s, s * 0.22, 0, 7); g.fill(); g.fillStyle = '#2a1504'; g.fillText(String(single(ds)), x + s * 0.95, cy + s + 1); }
    }
    g.fillStyle = '#170c30'; g.beginPath(); g.arc(cx, cy - s * 0.9, s * 0.5, 0, 7); g.fill(); g.strokeStyle = '#ffd78a'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#ffd78a'; g.font = `900 ${s * 0.42}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(digits.length === 6 ? '' + single(digits.slice(0, 3)) + single(digits.slice(3)) : 'JODI', cx, cy - s * 0.88);
  }
  function schedule() { if (!raf && area) raf = requestAnimationFrame(draw); }
  return {
    kind: '2d', topColor: TOP_COLOR,
    resize(w, h, a) { W = w; H = h; area = a; dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); schedule(); },
    startPot(side) { drawingSide = side; schedule(); },
    digit(i, v) {
      if (i !== digits.length) return;
      digits.push(v); drawingSide = digits.length < 3 ? 'open' : digits.length < 6 ? 'close' : null;
      hooks.pop && hooks.pop(i); hooks.tile && hooks.tile(i);
      if (i === 2) hooks.sorted && hooks.sorted('open');
      if (i === 5) { hooks.sorted && hooks.sorted('close'); setTimeout(() => hooks.revealed && hooks.revealed(), 600); }
      schedule();
    },
    show(ds, opts) { digits = ds.slice(0, 6); drawingSide = opts && opts.drawing ? (digits.length < 3 ? 'open' : digits.length < 6 ? 'close' : null) : null; schedule(); },
    reset() { digits = []; drawingSide = null; glow = 0; schedule(); },
    glow(on) { glow = on ? 1 : 0; schedule(); },
    busy() { return digits.length > 0 && digits.length < 6; },
    drawn() { return digits.slice(); },
  };
}

export async function create(cv, hooks) {
  await fontsReady();
  hooks = hooks || {};
  if (hasWebGL() && !/[?&]flat=1/.test(location.search)) {
    try { return await createGL(cv, hooks); } catch (e) {
      console.warn('Matka Pulse: WebGL failed, using 2D', e);
      const fresh = cv.cloneNode(false); cv.replaceWith(fresh); cv = fresh;
    }
  }
  return create2D(cv, hooks);
}
