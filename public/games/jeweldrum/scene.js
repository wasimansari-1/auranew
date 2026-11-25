/* Jewel Drum — the 3D drum (three.js 0.170.0, shared copy in ../_core/vendor), with a 2D canvas
 * fallback when WebGL is not available.
 *
 * A gold-rimmed lacquer drum with 20 jewel faces turns on a horizontal axle between two purple
 * posts (the NX mark on the posts, the NEXORNG wordmark on the plinth); a gold bezel with two
 * pointers frames the face that counts. Each jewel is real 3D geometry (coin, faceted gem, star,
 * crown, orb, NX medallion) rendered ONCE into the face textures and the page's icons, so the
 * drum itself is only 20 textured faces (cheap on phones); the winning jewel rises from its face
 * as a live 3D model.
 *
 * Motion (analytic, identical at any frame rate — never jerks):
 *   spin()     speeds up from rest (smoothstep over 1 s) to VMAX (~0.95 turns/s) and keeps rolling;
 *              above ~2.5 rad/s the faces cross-fade into motion-streak copies (no strobing).
 *   land(i)    from the current angle and speed it slows down onto face i with
 *              v(u) = v0·(1 − 3u² + 2u³): speed and acceleration both reach 0 exactly on the face.
 *              From rest (joined mid-draw) it eases in and out.
 *   win(on,i)  the landed face cross-fades to its lit version, the bezel warms, a soft halo, and
 *              the 3D jewel rises out of the face and turns slowly. 0.6 s fades, nothing blinks.
 * Renders only while something moves. Hooks: click(speed 0–1) per face passing the pointer.
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), show(i), spin(), land(i, opts),
 *      onLanded(cb), spinning(), win(on, i), icons: { id: dataURL }, topColor, kind }>
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../_core/vendor/three-0.170.0/addons/RoundedBoxGeometry.js';

const R = window.JDRules;
const N = 20, STEP = (2 * Math.PI) / N;
const VMAX = 6.0;           // rad/s at full roll (~0.95 turns per second, 19 faces/s)
const SPINUP = 1.0;         // s
const TOP_COLOR = '#0d0622';
const BASE = new URL('.', import.meta.url).href;
const COL = {
  violet: { hex: 0x9b4dff, ui: '#b06cff', name: 'Violet' },
  gold: { hex: 0xff9f1a, ui: '#ffc35a', name: 'Gold' },
  emerald: { hex: 0x12c486, ui: '#2fd59a', name: 'Emerald' },
  ruby: { hex: 0xf0204f, ui: '#ff4d73', name: 'Ruby' },
};
export const NAMES = {};
R.DRUM.forEach((s) => { NAMES[s.id] = s.id === 'nx' ? 'NX Emblem' : COL[s.colour].name + ' ' + s.family[0].toUpperCase() + s.family.slice(1); });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mod = (a, m) => ((a % m) + m) % m;
const smooth = (u) => u * u * (3 - 2 * u);

// ------------------------------------------------------------------ motion (shared by both renderers)
function motion() {
  let ph = { kind: 'still', a0: 0, t0: 0 };
  const now = () => performance.now() / 1000;
  function at(t) {
    const p = ph, s = t - p.t0;
    if (p.kind === 'still') return [p.a0, 0];
    if (p.kind === 'spin') {
      if (s < SPINUP) { const u = s / SPINUP; return [p.a0 + VMAX * SPINUP * (u * u * u - u * u * u * u / 2), VMAX * smooth(u)]; }
      return [p.a0 + VMAX * SPINUP / 2 + VMAX * (s - SPINUP), VMAX];
    }
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
      ph = v > VMAX * 0.8 ? { kind: 'spin', a0: a - VMAX * SPINUP / 2, t0: t - SPINUP } : { kind: 'spin', a0: a, t0: t };
    },
    land(i, opts) {
      const t = now(), [a, v] = at(t), target = i * STEP;
      const delta = mod(target - a, 2 * Math.PI);
      if (v > 0.5) {
        // T = 2D/v; whole extra turns move T in steps of 4π/v (~2.1 s at full speed): pick the
        // landing closest to `seconds` inside [min, max] (max keeps it before the result arrives)
        const ideal = (opts && opts.seconds) || 3.0, lo = (opts && opts.min) || ideal * 0.62, hi = (opts && opts.max) || ideal * 1.34;
        let best = null;
        for (let k = 0; k < 12; k++) {
          const D = delta + 2 * Math.PI * k, T = (2 * D) / v;
          if (T < lo) continue;
          if (T > hi) break;
          if (!best || Math.abs(T - ideal) < Math.abs(best.T - ideal)) best = { D, T };
        }
        if (!best) best = { D: delta, T: (2 * delta) / v };
        ph = { kind: 'land', a0: a, t0: t, v0: v, T: best.T, D: best.D, target: i };
      } else {
        const D = delta + 2 * Math.PI * ((opts && opts.turns) != null ? opts.turns : 1);
        ph = { kind: 'land', a0: a, t0: t, v0: 0, T: (opts && opts.seconds) || 2.4, D, target: i };
      }
      return ph.T;
    },
    phase: () => ph,
    done() {
      if (ph.kind === 'land' && now() - ph.t0 >= ph.T) { ph = { kind: 'still', a0: ph.target * STEP, t0: now(), landed: ph.target }; return true; }
      return false;
    },
  };
}

// ------------------------------------------------------------------ fonts + canvases
let FONT = '"Outfit", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
let BODY = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
async function fontsReady() {
  try {
    await Promise.race([Promise.all([document.fonts.load('900 120px Outfit'), document.fonts.load('700 30px "Plus Jakarta Sans"')]), new Promise((r) => setTimeout(r, 2500))]);
    if (!document.fonts.check('900 120px Outfit')) FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    if (!document.fonts.check('700 30px "Plus Jakarta Sans"')) BODY = FONT;
  } catch (e) { /* keep the stacks */ }
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function loadImage(src) { return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }

const FACE_W = 3.6, R_IN = 2.2, FACE_H = 2 * R_IN * Math.tan(Math.PI / N) * 0.97; // the faces of a 20-gon
const TEX_W = 1024, TEX_H = Math.round(TEX_W * FACE_H / FACE_W);
const ICON_X = 0.25; // the jewel sits at 25 % of the face width

// one face: dark lacquer, colour bands, the jewel icon, name and the pay. mode: normal | streak | lit
function faceCanvas(s, icon, mode) {
  const [c, g] = canvas(TEX_W, TEX_H), w = TEX_W, h = TEX_H;
  const lit = mode === 'lit';
  const bg = g.createLinearGradient(0, 0, 0, h);
  if (lit) { bg.addColorStop(0, '#7a45c2'); bg.addColorStop(0.5, '#4f2590'); bg.addColorStop(1, '#7a45c2'); }
  else if (s.id === 'nx') { bg.addColorStop(0, '#3d1b63'); bg.addColorStop(0.5, '#251041'); bg.addColorStop(1, '#3d1b63'); }
  else { bg.addColorStop(0, '#26123f'); bg.addColorStop(0.5, '#160a2b'); bg.addColorStop(1, '#26123f'); }
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = COL[s.colour].ui; g.fillRect(0, 0, 18, h); g.fillRect(w - 18, 0, 18, h);
  g.strokeStyle = lit || s.id === 'nx' ? '#ffcf6b' : 'rgba(255,207,107,.5)'; g.lineWidth = lit ? 12 : s.id === 'nx' ? 6 : 3;
  g.strokeRect(26, 8, w - 52, h - 16);
  const cx = w * ICON_X, cy = h / 2;
  const pr = g.createRadialGradient(cx, cy, 6, cx, cy, h * 0.75);
  pr.addColorStop(0, lit ? 'rgba(255,214,140,.35)' : 'rgba(255,255,255,.10)'); pr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pr; g.fillRect(cx - h, 0, h * 2, h);
  const name = NAMES[s.id].toUpperCase(), pay = '×' + s.pay;
  const draw = (dy, alpha) => {
    g.globalAlpha = alpha;
    if (icon) { const sz = h * 1.02; g.drawImage(icon, cx - sz / 2, cy - sz / 2 + dy, sz, sz); }
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '700 ' + Math.round(h * 0.17) + 'px ' + BODY; g.fillStyle = lit ? '#ffe9c4' : '#cdbdf0';
    if ('letterSpacing' in g) g.letterSpacing = '4px';
    g.fillText(name, w * 0.45, h * 0.27 + dy);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.font = '900 ' + Math.round(h * 0.56) + 'px ' + FONT;
    const xg = g.createLinearGradient(0, h * 0.42 + dy, 0, h * 0.95 + dy);
    xg.addColorStop(0, '#fff3d0'); xg.addColorStop(0.5, '#ffcf6b'); xg.addColorStop(1, '#e8962c');
    g.fillStyle = xg; g.fillText(pay, w * 0.445, h * 0.66 + dy);
  };
  if (mode === 'streak') { // smeared along the roll; the panel stays, the content blurs
    for (let k = -6; k <= 6; k++) draw(k * h * 0.06, 0.15 * (1 - Math.abs(k) / 7));
  } else draw(0, 1);
  g.globalAlpha = 1;
  return c;
}

// 2D jewel icons (the no-WebGL fallback): simple shaded shapes in the same colours
function icon2D(s, size, nxImg) {
  const [c, g] = canvas(size, size), m = size / 2, col = COL[s.colour].ui;
  const shade = (r0, r1) => { const gr = g.createRadialGradient(m - size * 0.12, m - size * 0.14, size * 0.04, m, m, size * 0.48); gr.addColorStop(0, '#ffffff'); gr.addColorStop(r0, col); gr.addColorStop(1, r1); return gr; };
  g.lineJoin = 'round';
  if (s.id === 'nx') {
    g.fillStyle = shade(0.25, '#8a5a10'); g.beginPath(); g.arc(m, m, size * 0.44, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a0838'; g.beginPath(); g.arc(m, m, size * 0.36, 0, Math.PI * 2); g.fill();
    if (nxImg) g.drawImage(nxImg, 160, 200, 720, 420, m - size * 0.3, m - size * 0.18, size * 0.6, size * 0.35);
  } else if (s.family === 'coin') {
    g.fillStyle = shade(0.3, '#2a1050'); g.beginPath(); g.arc(m, m, size * 0.42, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffd98a'; g.lineWidth = size * 0.05; g.beginPath(); g.arc(m, m, size * 0.36, 0, Math.PI * 2); g.stroke();
    star(g, m, m, size * 0.2, size * 0.08, 4); g.fillStyle = '#ffe3a3'; g.fill();
  } else if (s.family === 'gem') {
    g.fillStyle = shade(0.35, '#1a0a30'); g.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(m + Math.cos(a) * size * 0.42, m + Math.sin(a) * size * 0.36); }
    g.closePath(); g.fill(); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.stroke();
  } else if (s.family === 'star') {
    star(g, m, m + size * 0.03, size * 0.46, size * 0.2, 5); g.fillStyle = shade(0.35, '#2a1050'); g.fill();
  } else if (s.family === 'crown') {
    g.fillStyle = shade(0.4, '#2a1050'); g.beginPath();
    g.moveTo(m - size * 0.4, m + size * 0.26); g.lineTo(m + size * 0.4, m + size * 0.26); g.lineTo(m + size * 0.44, m - size * 0.2);
    g.lineTo(m + size * 0.2, m); g.lineTo(m, m - size * 0.3); g.lineTo(m - size * 0.2, m); g.lineTo(m - size * 0.44, m - size * 0.2); g.closePath(); g.fill();
    g.fillStyle = '#ffe3a3'; g.fillRect(m - size * 0.4, m + size * 0.18, size * 0.8, size * 0.1);
  } else {
    g.fillStyle = shade(0.35, '#1a0a30'); g.beginPath(); g.arc(m, m + size * 0.05, size * 0.34, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffd98a'; g.lineWidth = size * 0.045; g.beginPath(); g.ellipse(m, m + size * 0.05, size * 0.34, size * 0.08, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffd98a'; g.fillRect(m - size * 0.025, m - size * 0.42, size * 0.05, size * 0.16); g.fillRect(m - size * 0.08, m - size * 0.37, size * 0.16, size * 0.05);
  }
  return c;
}
function star(g, x, y, ro, ri, n) {
  g.beginPath();
  for (let i = 0; i <= n * 2; i++) { const r = i % 2 ? ri : ro, a = -Math.PI / 2 + (i * Math.PI) / n; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  g.closePath();
}

function backdrop() {
  const [c, g] = canvas(1024, 1024);
  const lg = g.createLinearGradient(0, 0, 0, 1024);
  lg.addColorStop(0, '#0d0622'); lg.addColorStop(0.55, '#120830'); lg.addColorStop(1, '#060411');
  g.fillStyle = lg; g.fillRect(0, 0, 1024, 1024);
  const r = g.createRadialGradient(512, 500, 20, 512, 500, 520);
  r.addColorStop(0, 'rgba(120,52,214,.42)'); r.addColorStop(0.5, 'rgba(80,28,160,.16)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 1024, 1024);
  for (let i = -3; i <= 3; i++) {
    const x = 512 + i * 150, gg = g.createLinearGradient(0, 120, 0, 900);
    gg.addColorStop(0, 'rgba(255,207,107,0)'); gg.addColorStop(0.5, 'rgba(255,207,107,.07)'); gg.addColorStop(1, 'rgba(255,207,107,0)');
    g.fillStyle = gg; g.fillRect(x - 2, 120, 4, 780);
  }
  g.strokeStyle = 'rgba(255,207,107,.24)'; g.lineWidth = 3; g.beginPath(); g.arc(512, 540, 400, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
  g.strokeStyle = 'rgba(168,85,247,.3)'; g.lineWidth = 2; g.beginPath(); g.arc(512, 540, 432, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
  let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    const x = rnd() * 1024, y = 60 + rnd() * 620, rr = 5 + rnd() * 18;
    const b = g.createRadialGradient(x, y, 0, x, y, rr);
    b.addColorStop(0, rnd() > 0.65 ? 'rgba(255,207,107,.13)' : 'rgba(168,85,247,.15)'); b.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = b; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  return c;
}
function radial(stops, size) {
  const [c, g] = canvas(size || 256, size || 256), s = (size || 256) / 2;
  const r = g.createRadialGradient(s, s, 0, s, s, s);
  stops.forEach(([o, col]) => r.addColorStop(o, col));
  g.fillStyle = r; g.fillRect(0, 0, s * 2, s * 2);
  return c;
}

// ------------------------------------------------------------------ 3D jewels (original designs)
function jewels(nxTex) {
  const metal = (hex, rough) => new THREE.MeshStandardMaterial({ color: hex, metalness: 1, roughness: rough == null ? 0.26 : rough, envMapIntensity: 1.25 });
  const gold = metal(0xf2c15a, 0.22), pale = metal(0xffe3a3, 0.2);
  const gemMat = (hex) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex).multiplyScalar(0.42), metalness: 0.15, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05,
    envMapIntensity: 0.6, flatShading: true, emissive: hex, emissiveIntensity: 0.36, specularIntensity: 0.45 });
  const shape = (ro, ri, n) => {
    const s = new THREE.Shape();
    for (let i = 0; i <= n * 2; i++) { const r = i % 2 ? ri : ro, a = Math.PI / 2 + (i * Math.PI) / n; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
    return s;
  };
  const brilliant = (r) => {
    const pts = [new THREE.Vector2(0, -1.04 * r), new THREE.Vector2(r * 0.98, -0.02), new THREE.Vector2(r, 0.04), new THREE.Vector2(r * 0.66, 0.3 * r), new THREE.Vector2(0.001, 0.3 * r)];
    const g = new THREE.LatheGeometry(pts, 10); g.computeVertexNormals(); return g;
  };
  return function make(s) {
    const g = new THREE.Group(), c = COL[s.colour].hex, body = s.colour === 'gold' ? gold : metal(c, 0.24), trim = s.colour === 'gold' ? pale : gold;
    if (s.id === 'nx') {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.16, 64), gold); disc.rotation.x = Math.PI / 2; g.add(disc);
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.055, 16, 64), pale));
      const enamel = new THREE.Mesh(new THREE.CircleGeometry(0.47, 64), new THREE.MeshPhysicalMaterial({ color: 0x1a0838, roughness: 0.15, clearcoat: 1, envMapIntensity: 0.8 }));
      enamel.position.z = 0.083; g.add(enamel);
      if (nxTex) {
        const pg = new THREE.PlaneGeometry(0.78, 0.43), uv = pg.attributes.uv.array;
        for (let k = 0; k < uv.length; k += 2) { uv[k] = 0.14 + uv[k] * 0.74; uv[k + 1] = 0.40 + uv[k + 1] * 0.41; } // the NX monogram of logo.webp
        const mark = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: nxTex, transparent: true, toneMapped: false }));
        mark.position.z = 0.09; g.add(mark);
      }
      for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), pale); const a = (i / 12) * Math.PI * 2; b.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.02); g.add(b); }
    } else if (s.family === 'coin') {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.11, 56), body); d.rotation.x = Math.PI / 2; g.add(d);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.045, 12, 56), trim); rim.position.z = 0.04; g.add(rim);
      const em = new THREE.Mesh(new THREE.ExtrudeGeometry(shape(0.26, 0.11, 4), { depth: 0.04, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2 }), trim);
      em.position.z = 0.05; g.add(em); g.rotation.y = -0.35;
    } else if (s.family === 'gem') {
      const m = new THREE.Mesh(brilliant(0.5), gemMat(c)); m.rotation.x = 1.05; m.scale.setScalar(1.05); g.add(m);
    } else if (s.family === 'star') {
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape(0.52, 0.23, 5), { depth: 0.08, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.08, bevelSegments: 3 }), body);
      m.position.z = -0.04; g.add(m);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), pale); core.position.z = 0.15; g.add(core); g.rotation.y = 0.3;
    } else if (s.family === 'crown') {
      const sh = new THREE.Shape();
      sh.moveTo(-0.46, -0.3); sh.lineTo(0.46, -0.3); sh.lineTo(0.5, 0.26); sh.lineTo(0.25, 0.04); sh.lineTo(0, 0.36); sh.lineTo(-0.25, 0.04); sh.lineTo(-0.5, 0.26); sh.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 2 }), body); m.position.z = -0.06; g.add(m);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.12, 0.22), trim); band.position.set(0, -0.26, 0.02); g.add(band);
      for (const [x, y] of [[-0.5, 0.29], [0, 0.4], [0.5, 0.29]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), pale); b.position.set(x, y, 0.03); g.add(b); }
      const jewel = new THREE.Mesh(brilliant(0.11), gemMat(s.colour === 'gold' ? 0xd81b60 : 0xffffff)); jewel.rotation.x = Math.PI / 2; jewel.position.set(0, -0.02, 0.11); g.add(jewel);
    } else {
      const o = new THREE.Mesh(new THREE.SphereGeometry(0.38, 40, 28), gemMat(c)); o.material.flatShading = false; o.position.y = -0.06; g.add(o);
      const b1 = new THREE.Mesh(new THREE.TorusGeometry(0.385, 0.035, 10, 48), gold); b1.rotation.x = Math.PI / 2; b1.position.y = -0.06; g.add(b1);
      const b2 = new THREE.Mesh(new THREE.TorusGeometry(0.385, 0.03, 10, 48, Math.PI), gold); b2.position.y = -0.06; g.add(b2);
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), gold); c1.position.y = 0.42; g.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), gold); c2.position.y = 0.45; g.add(c2);
      g.rotation.x = 0.12;
    }
    return g;
  };
}

// ------------------------------------------------------------------ WebGL drum
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

async function createGL(cv, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  pmrem.dispose();
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t; };
  const [nxImg, wordImg] = await Promise.all([loadImage(new URL('../../logo.webp', BASE).href), loadImage(new URL('../../logo2.webp', BASE).href)]);
  const nxTex = nxImg ? tex(nxImg) : null, wordTex = wordImg ? tex(wordImg) : null;
  const makeJewel = jewels(nxTex);

  // ---- the jewels, rendered once (icons for the faces and the page)
  const ICON = 256, icons = {}, iconCanvas = {};
  {
    const sc = new THREE.Scene(); sc.environment = env;
    sc.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xfff2d6, 2.4); dl.position.set(2, 3, 4); sc.add(dl);
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 20); cam.position.set(0, 0, 3.3);
    renderer.setPixelRatio(1); renderer.setSize(ICON, ICON, false); renderer.setClearColor(0x000000, 0);
    for (const s of R.DRUM) {
      const j = makeJewel(s); sc.add(j); renderer.render(sc, cam); sc.remove(j);
      const [c, g] = canvas(ICON, ICON); g.drawImage(cv, 0, 0, ICON, ICON);
      iconCanvas[s.id] = c;
      const [ic, ig] = canvas(128, 128); ig.imageSmoothingQuality = 'high'; ig.drawImage(c, 0, 0, 128, 128);
      icons[s.id] = ic.toDataURL('image/png');
    }
  }
  renderer.setClearColor(0x060411, 1);

  const scene = new THREE.Scene();
  scene.environment = env;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

  const bg = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), new THREE.MeshBasicMaterial({ map: tex(backdrop()), depthWrite: false, toneMapped: false }));
  bg.position.set(0, 1.2, -14); scene.add(bg);

  // ---- the drum: 20 faces = panel (normal) + streak copy; a lit overlay for the winner
  const R_OUT = R_IN / Math.cos(Math.PI / N);
  const drum = new THREE.Group(); scene.add(drum);
  const faceGeo = new THREE.PlaneGeometry(FACE_W, FACE_H);
  const faces = [];
  R.DRUM.forEach((s, i) => {
    const a = i * STEP, holder = new THREE.Group();
    holder.position.set(0, R_IN * Math.sin(a), R_IN * Math.cos(a)); holder.rotation.x = -a; drum.add(holder);
    const map = tex(faceCanvas(s, iconCanvas[s.id], 'normal'));
    const panel = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.62, metalness: 0.02, envMapIntensity: 0.12 }));
    const streak = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: tex(faceCanvas(s, iconCanvas[s.id], 'streak')), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    streak.position.z = 0.004; streak.renderOrder = 1; streak.visible = false;
    holder.add(panel, streak);
    faces.push({ s, panel, streak, holder });
  });
  const lit = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  lit.position.z = 0.008; lit.renderOrder = 2; lit.visible = false;
  const litTex = {};

  const goldMetal = new THREE.MeshStandardMaterial({ color: 0xffc46b, metalness: 1, roughness: 0.22 });
  const violetMetal = new THREE.MeshStandardMaterial({ color: 0x2a1257, metalness: 0.7, roughness: 0.28 });
  const lacquer = new THREE.MeshStandardMaterial({ color: 0x1c0c3a, metalness: 0.4, roughness: 0.35 });
  const barGeo = new THREE.CylinderGeometry(0.025, 0.025, FACE_W + 0.02, 10);
  for (let i = 0; i < N; i++) {
    const a = (i + 0.5) * STEP, bar = new THREE.Mesh(barGeo, goldMetal);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, R_OUT * Math.sin(a), R_OUT * Math.cos(a)); drum.add(bar);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(R_IN - 0.06, R_IN - 0.06, FACE_W - 0.02, 40), lacquer); core.rotation.z = Math.PI / 2; drum.add(core);
  for (const sx of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R_OUT + 0.04, 0.085, 16, 96), goldMetal);
    rim.rotation.y = Math.PI / 2; rim.position.x = sx * (FACE_W / 2 + 0.05); drum.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R_OUT + 0.02, 64), violetMetal);
    disc.rotation.y = sx * Math.PI / 2; disc.position.x = sx * (FACE_W / 2 + 0.06); drum.add(disc);
  }

  // ---- cradle: posts with the NX mark, hubs, plinth with the wordmark, bezel + pointers
  const cradle = new THREE.Group(); scene.add(cradle);
  const PX = FACE_W / 2 + 0.42;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new RoundedBoxGeometry(0.5, 3.6, 0.9, 4, 0.1), violetMetal); post.position.set(sx * PX, -1.85, 0); cradle.add(post);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.0, 0.04), new THREE.MeshBasicMaterial({ color: 0xc084fc })); trim.position.set(sx * PX, -2.0, 0.46); cradle.add(trim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 48), goldMetal); hub.rotation.z = Math.PI / 2; hub.position.set(sx * PX, 0, 0); cradle.add(hub);
    if (nxTex) {
      const g = new THREE.CircleGeometry(0.2, 40), uv = g.attributes.uv.array;
      for (let k = 0; k < uv.length; k += 2) { uv[k] = 0.18 + uv[k] * 0.64; uv[k + 1] = 0.36 + uv[k + 1] * 0.5; }
      const base = new THREE.Mesh(new THREE.CircleGeometry(0.21, 40), new THREE.MeshBasicMaterial({ color: 0x1a0838 })); base.position.set(sx * PX, -1.15, 0.452); cradle.add(base);
      const nx = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: nxTex, transparent: true, toneMapped: false })); nx.position.set(sx * PX, -1.15, 0.456); cradle.add(nx);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.022, 10, 40), goldMetal); ring.position.set(sx * PX, -1.15, 0.452); cradle.add(ring);
    }
  }
  const plinth = new THREE.Mesh(new RoundedBoxGeometry(FACE_W + 2.0, 0.56, 1.6, 4, 0.12), violetMetal); plinth.position.set(0, -3.6, 0.15); cradle.add(plinth);
  const plTrim = new THREE.Mesh(new RoundedBoxGeometry(FACE_W + 2.04, 0.07, 0.07, 2, 0.03), goldMetal); plTrim.position.set(0, -3.33, 0.95); cradle.add(plTrim);
  if (wordTex) {
    const g = new THREE.PlaneGeometry(1.9, 0.6), uv = g.attributes.uv.array;
    for (let k = 1; k < uv.length; k += 2) uv[k] = 0.36 + uv[k] * 0.3; // the wordmark band of logo2.webp
    const plate = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: wordTex, transparent: true, toneMapped: false })); plate.position.set(0, -3.6, 0.955); cradle.add(plate);
  }
  const zf = R_IN + 0.16, bw = FACE_W + 0.36, bh = FACE_H + 0.12;
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0xffc46b, metalness: 1, roughness: 0.2, emissive: 0xffa640, emissiveIntensity: 0 });
  for (const sy of [-1, 1]) { const b = new THREE.Mesh(new RoundedBoxGeometry(bw, 0.07, 0.08, 2, 0.025), bezelMat); b.position.set(0, sy * bh / 2, zf); cradle.add(b); }
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(0, 0.15); sh.lineTo(0, -0.15); sh.lineTo(-sx * 0.22, 0); sh.closePath();
    const p = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 }), bezelMat);
    p.position.set(sx * (bw / 2 + 0.2), 0, zf - 0.03); cradle.add(p);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(radial([[0, 'rgba(255,196,110,0.85)'], [0.45, 'rgba(255,160,70,0.25)'], [1, 'rgba(0,0,0,0)']])), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  halo.scale.set(9, 5.2, 1); halo.position.set(0, 0, -1.6); scene.add(halo);
  // the winning jewel, live 3D, rising out of its face
  const hero = new THREE.Group(); hero.position.set(-FACE_W / 2 + FACE_W * ICON_X, 0, zf + 0.25); hero.visible = false; scene.add(hero);
  const heroLight = new THREE.PointLight(0xffd9a0, 0, 4); heroLight.position.set(-0.6, 0.6, zf + 1.4); scene.add(heroLight);
  let heroId = '';

  scene.add(new THREE.HemisphereLight(0xcdb6ff, 0x160830, 0.5));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.6); key.position.set(6, 3, 6); scene.add(key);
  const rimL = new THREE.PointLight(0xa855f7, 30, 14); rimL.position.set(-5, 2.5, -1.5);
  const rimR = new THREE.PointLight(0xa855f7, 30, 14); rimR.position.set(5, 2.5, -1.5); scene.add(rimL, rimR);
  const purple = new THREE.Color(0xa855f7), amber = new THREE.Color(0xffb050);

  // ---- state + loop
  const M = motion();
  let W = 1, H = 1, area = null, dirty = true, raf = 0, lastFace = -1;
  let glow = 0, glowTo = 0, glowT = performance.now(), litIdx = -1, landedCb = null, heroT = 0;

  function frame() {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), wide = W >= 900;
    const needH = wide ? 4.35 : 4.15, needW = FACE_W + 2.3;
    camera.aspect = W / H;
    const d = Math.max(needH / (2 * t * (Math.max(120, area.H) / H)), needW / (2 * t * camera.aspect * (Math.max(160, area.W) / W)));
    camera.position.set(0, 0.32, d); camera.lookAt(0, 0.02, 0);
    const cx = area.L + area.W / 2, cy = area.T + area.H / 2;
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
  }
  function shade(rot, speed) {
    const blur = clamp((speed - 2.5) / 2.5, 0, 1);
    for (let i = 0; i < N; i++) {
      const k = Math.pow(Math.max(0, Math.cos(i * STEP - rot)), 12), f = faces[i];
      f.panel.material.emissiveIntensity = 0.05 + 0.55 * k;
      f.panel.material.color.setScalar(0.25 + 0.75 * k);
      f.streak.visible = blur > 0.001;
      f.streak.material.opacity = blur;
      f.streak.material.color.setScalar(0.3 + 0.7 * k);
    }
  }
  function loop() {
    raf = 0;
    const [rot, speed] = M.angle();
    if (M.done()) {
      const i = M.phase().landed; render(i * STEP, 0);
      if (landedCb) { const cb = landedCb; landedCb = null; cb(i); }
      return schedule();
    }
    render(rot, speed);
    const face = Math.floor(mod(rot + STEP / 2, 2 * Math.PI) / STEP);
    if (face !== lastFace) { if (lastFace >= 0 && speed > 0.2) hooks.click && hooks.click(speed / VMAX); lastFace = face; }
    schedule();
  }
  function moving() { return M.phase().kind !== 'still' || glow !== glowTo || glow > 0.001; }
  function schedule() { if (!raf && (moving() || dirty)) raf = requestAnimationFrame(loop); }
  function render(rot, speed) {
    drum.rotation.x = rot;
    shade(rot, speed);
    const t = performance.now(), dt = Math.min(0.1, (t - glowT) / 1000); glowT = t;
    if (glow !== glowTo) glow = glowTo > glow ? Math.min(glowTo, glow + dt / 0.6) : Math.max(glowTo, glow - dt / 0.45);
    const e = smooth(glow);
    lit.visible = e > 0.001; lit.material.opacity = e;
    bezelMat.emissiveIntensity = 0.75 * e; halo.material.opacity = 0.7 * e;
    rimL.color.copy(purple).lerp(amber, e * 0.8); rimR.color.copy(purple).lerp(amber, e * 0.8);
    hero.visible = e > 0.001;
    if (hero.visible) {
      const age = (t - heroT) / 1000, up = smooth(clamp(age / 0.7, 0, 1));
      hero.scale.setScalar(FACE_H * (0.72 + 0.4 * up) * Math.max(0.001, e));
      hero.position.z = zf + 0.05 + 0.35 * up;
      hero.rotation.y = Math.sin(age * 0.9) * 0.35;
      heroLight.intensity = 5 * e;
    } else heroLight.intensity = 0;
    renderer.render(scene, camera);
    dirty = false;
  }

  return {
    kind: 'webgl', topColor: TOP_COLOR, icons,
    angle: () => M.angle(), // QA: [angle, speed]
    resize(w, h, a) {
      W = Math.max(1, w); H = Math.max(1, h); area = a;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, W < 900 ? 1.75 : 1.5));
      renderer.setSize(W, H, false);
      frame(); dirty = true; schedule();
    },
    show(i) { M.still(i * STEP); dirty = true; schedule(); },
    spin() { glowTo = 0; M.spin(); schedule(); },
    land(i, opts) { const T = M.land(i, opts); schedule(); return T; },
    onLanded(cb) { landedCb = cb; },
    spinning() { return M.phase().kind !== 'still'; },
    win(on, i) {
      if (on && i != null && i !== litIdx) {
        const s = R.DRUM[i];
        if (!litTex[i]) litTex[i] = tex(faceCanvas(s, null, 'lit'));
        lit.material.map = litTex[i]; lit.material.needsUpdate = true;
        lit.removeFromParent(); faces[i].holder.add(lit); litIdx = i;
      }
      if (on && i != null && R.DRUM[i].id !== heroId) {
        while (hero.children.length) hero.remove(hero.children[0]);
        hero.add(makeJewel(R.DRUM[i])); heroId = R.DRUM[i].id;
      }
      if (on && glowTo !== 1) heroT = performance.now();
      glowTo = on ? 1 : 0; glowT = performance.now(); schedule();
    },
  };
}

// ------------------------------------------------------------------ 2D fallback (no WebGL)
async function create2D(cv, hooks) {
  const g = cv.getContext('2d'), M = motion();
  const nxImg = await loadImage(new URL('../../logo.webp', BASE).href);
  const icons = {}, faceC = [], litC = [];
  R.DRUM.forEach((s) => {
    const ic = icon2D(s, 256, nxImg);
    const [c, x] = canvas(128, 128); x.drawImage(ic, 0, 0, 128, 128); icons[s.id] = c.toDataURL('image/png');
    faceC.push(faceCanvas(s, ic, 'normal'));
  });
  let W = 1, H = 1, area = null, dpr = 1, raf = 0, dirty = true, glow = 0, glowTo = 0, glowT = performance.now(), litIdx = -1, landedCb = null, lastFace = -1;
  const bg = backdrop();
  function draw(rot, speed) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg, 0, 0, W, H);
    const cx = area.L + area.W / 2, cy = area.T + area.H / 2, fw = Math.min(area.W * 0.84, area.H * 1.5), fh = fw * FACE_H / FACE_W, Rr = fh / (2 * Math.tan(Math.PI / N));
    const t = performance.now(), dt = Math.min(0.1, (t - glowT) / 1000); glowT = t;
    if (glow !== glowTo) glow = glowTo > glow ? Math.min(glowTo, glow + dt / 0.6) : Math.max(glowTo, glow - dt / 0.45);
    for (let i = 0; i < N; i++) {
      const a = mod(i * STEP - rot + Math.PI, 2 * Math.PI) - Math.PI;
      if (Math.abs(a) > 1.35) continue;
      const y = cy - Math.sin(a) * Rr, h = fh * Math.cos(a), k = Math.pow(Math.cos(a), 6);
      g.globalAlpha = 0.25 + 0.75 * k;
      g.drawImage(faceC[i], cx - fw / 2, y - h / 2, fw, h);
      if (i === litIdx && glow > 0) {
        if (!litC[i]) litC[i] = faceCanvas(R.DRUM[i], null, 'lit');
        g.globalAlpha = smooth(glow) * (0.25 + 0.75 * k); g.drawImage(litC[i], cx - fw / 2, y - h / 2, fw, h);
      }
    }
    g.globalAlpha = 1;
    g.strokeStyle = glow > 0 ? '#ffd28a' : '#ffc46b'; g.lineWidth = 4;
    g.strokeRect(cx - fw / 2 - 8, cy - fh / 2 - 5, fw + 16, fh + 10);
  }
  function loop() {
    raf = 0;
    const [rot, speed] = M.angle();
    if (M.done()) { const i = M.phase().landed; draw(i * STEP, 0); if (landedCb) { const cb = landedCb; landedCb = null; cb(i); } return schedule(); }
    draw(rot, speed); dirty = false;
    const face = Math.floor(mod(rot + STEP / 2, 2 * Math.PI) / STEP);
    if (face !== lastFace) { if (lastFace >= 0 && speed > 0.2) hooks.click && hooks.click(speed / VMAX); lastFace = face; }
    schedule();
  }
  function schedule() { if (!raf && (M.phase().kind !== 'still' || glow !== glowTo || dirty)) raf = requestAnimationFrame(loop); }
  return {
    kind: '2d', topColor: TOP_COLOR, icons,
    angle: () => M.angle(),
    resize(w, h, a) { W = w; H = h; area = a; dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); dirty = true; schedule(); },
    show(i) { M.still(i * STEP); dirty = true; schedule(); },
    spin() { glowTo = 0; M.spin(); schedule(); },
    land(i, opts) { const T = M.land(i, opts); schedule(); return T; },
    onLanded(cb) { landedCb = cb; },
    spinning() { return M.phase().kind !== 'still'; },
    win(on, i) { if (i != null) litIdx = i; glowTo = on ? 1 : 0; glowT = performance.now(); dirty = true; schedule(); },
  };
}

export async function create(cv, hooks) {
  await fontsReady();
  hooks = hooks || {};
  if (hasWebGL() && !/[?&]flat=1/.test(location.search)) {
    try { return await createGL(cv, hooks); } catch (e) {
      console.warn('Jewel Drum: WebGL failed, using 2D', e);
      const fresh = cv.cloneNode(false); cv.replaceWith(fresh); cv = fresh;
    }
  }
  return create2D(cv, hooks);
}
