/* Orbit 36 — the 3D draw machine (three.js 0.170.0, shared copy in ../_core/vendor), with a flat 2D
 * fallback when WebGL is not available.
 *
 * A glass drum in a gold cage, two tilted gold orbit rings around it, on a lacquered pedestal with a
 * purple LED ring and the real NEXORNG NX mark. 36 numbered balls tumble inside; in front, a curved
 * gold rail with 6 cups and a separate bonus cup.
 *
 * Motion (all time-based and eased, so it is identical at any frame rate and never jumps):
 *   mix(level)    the tumble energy eases (critically damped, ~0.6 s) to 0–1; each ball moves on its
 *                 own loop inside the drum, blended with its resting place by the energy; the cage
 *                 and the orbit rings turn with it. Angles are integrated, so speed changes are smooth.
 *   draw(n, i)    ball n leaves the tumble: up through the top collar (0.34 s), out to the front as
 *                 a big "hero" ball facing the viewer (0.3 s), holds (0.32 s), then eases into cup i
 *                 (0.4 s; 6 = the bonus cup). Every segment is a cubic Bézier with smooth ease.
 *   place(list)   puts balls straight into their cups (joined mid-draw / missed steps).
 *   collect()     drawn balls fly back over the drum into the tumble (staggered, 0.9 s each).
 *   highlight(set, on)  gold rings + soft halos fade in (0.5 s) on the matched balls, others dim.
 * Hooks: landed(n, cup) when a ball settles in its cup.
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), mix, draw, place, collect, highlight,
 *      bonusAnchor(), drawn(), topColor, kind: 'webgl' | '2d' }>
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';

const TOP_COLOR = '#0b0620';
const BASE = new URL('.', import.meta.url).href;
const COLORS = ['#9d4cf0', '#2f7cf6', '#f5a524', '#ec4f86'];
export const colorOf = (n) => COLORS[Math.floor((n - 1) / 9)];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (u) => u * u * (3 - 2 * u);
const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
const now = () => performance.now() / 1000;

// flight (s): one arc up through the collar and out to the hero spot (rise + out), hold, into the cup
const T_RISE = 0.35, T_OUT = 0.3, T_HOLD = 0.28, T_CUP = 0.6;
const T_FLIGHT = T_RISE + T_OUT + T_HOLD + T_CUP;
const T_BACK = 0.9;

const DR = 1.5;                 // drum radius
const BR = 0.2;                 // ball radius in the drum
const RAIL_S = 1.45;            // ball scale in a cup (0.29)
const HERO_S = 2.9;             // ball scale at the hero spot (0.58)
const DC = new THREE.Vector3(0, 0.62 + DR - 0.05, 0);

async function fontsReady() {
  try { await Promise.race([Promise.all([document.fonts.load('900 80px Outfit'), document.fonts.load('800 20px Outfit')]), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* system font */ }
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function loadImage(src) { return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }

// a ball's surface: its range colour with two thin bands, a white number disc on the front (+z) and back
function ballCanvas(n) {
  const [c, g] = canvas(512, 256);
  g.fillStyle = colorOf(n); g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 74, 512, 9); g.fillRect(0, 173, 512, 9);
  for (const cx of [128, 384]) {
    g.beginPath(); g.arc(cx, 128, 66, 0, Math.PI * 2); g.fillStyle = '#fffdf8'; g.fill();
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.14)'; g.stroke();
    g.fillStyle = '#1a0b2e'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${n > 9 ? 74 : 84}px Outfit, system-ui, sans-serif`;
    g.fillText(String(n), cx, 133);
    if (n === 6 || n === 9) g.fillRect(cx - 15, 172, 30, 5); // tells 6 from 9
  }
  return c;
}
function radial(stops, size) {
  const [c, g] = canvas(size, size), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, size, size); return c;
}

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

// cup positions on the rail arc (world), wide or narrow spread
function cupSpots(narrow) {
  const R = 3.3, cz = -1.0;
  const angs = (narrow ? [-31, -21, -11, -1, 9, 19, 32] : [-38, -26, -14, -2, 10, 22, 37]).map((a) => a * Math.PI / 180);
  return angs.map((t) => new THREE.Vector3(Math.sin(t) * R, 0, Math.cos(t) * R + cz));
}

// ------------------------------------------------------------------ WebGL
async function createGL(cv, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
  const nxImg = await loadImage(new URL('../../logo.webp', BASE).href);

  scene.add(new THREE.HemisphereLight(0xcdb6ff, 0x12081f, 0.35));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2); key.position.set(-3, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb36bff, 2.4); rim.position.set(3, 3, -5); scene.add(rim);
  const under = new THREE.PointLight(0xffbb60, 6, 6, 2); under.position.set(0, 0.6, 1.4); scene.add(under);

  const gold = new THREE.MeshStandardMaterial({ color: 0xffc56e, metalness: 1, roughness: 0.22, envMapIntensity: 1.25 });
  const goldDark = new THREE.MeshStandardMaterial({ color: 0xc98b3a, metalness: 1, roughness: 0.35 });
  const lacquer = new THREE.MeshStandardMaterial({ color: 0x170a2e, metalness: 0.4, roughness: 0.22, envMapIntensity: 1.1 });
  const glowTex = tex(radial([[0, 'rgba(255,214,140,1)'], [0.35, 'rgba(255,187,96,.55)'], [1, 'rgba(255,187,96,0)']], 128));
  const halo = (s, op, color) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: color || 0xffffff, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.scale.set(s, s, 1); return m;
  };

  // floor glow
  {
    const [c, g] = canvas(512, 512), gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    gr.addColorStop(0, 'rgba(120,60,200,.55)'); gr.addColorStop(0.35, 'rgba(60,24,110,.45)'); gr.addColorStop(1, 'rgba(10,5,24,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(255,207,107,.22)'; g.lineWidth = 2;
    for (const r of [120, 170, 222]) { g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 96), new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.renderOrder = -1; scene.add(floor);
  }
  // pedestal + gold trims + LED ring + the NX mark
  {
    const pts = [[0, 0], [1.25, 0], [1.3, 0.05], [1.25, 0.16], [0.95, 0.2], [0.55, 0.32], [0.42, 0.42], [0.42, 0.5], [0.7, 0.62], [0.0, 0.62]].map(([x, y]) => new THREE.Vector2(x, y));
    scene.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 96), lacquer));
    const t1 = new THREE.Mesh(new THREE.TorusGeometry(1.27, 0.03, 16, 128), gold); t1.rotation.x = Math.PI / 2; t1.position.y = 0.1; scene.add(t1);
    const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.035, 16, 96), gold); t2.rotation.x = Math.PI / 2; t2.position.y = 0.62; scene.add(t2);
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.018, 12, 128), new THREE.MeshBasicMaterial({ color: 0xc58bff, toneMapped: false })); led.rotation.x = Math.PI / 2; led.position.y = 0.205; scene.add(led);
    if (nxImg) {
      const t = new THREE.Texture(nxImg); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.needsUpdate = true;
      const a = nxImg.width / nxImg.height;
      const plq = new THREE.Mesh(new THREE.PlaneGeometry(0.42 * a, 0.42), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      plq.position.set(0, 0.33, 0.66); plq.rotation.x = -0.62; scene.add(plq);
    }
  }
  // the drum: glass shells, gold cage, two orbit rings, the top collar
  const drum = new THREE.Group(); drum.position.copy(DC); scene.add(drum);
  const cage = new THREE.Group(); drum.add(cage);
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(DR + 0.005, 0.0075, 8, 140), goldDark); m.rotation.y = i * Math.PI / 6; cage.add(m); }
  { const eq = new THREE.Mesh(new THREE.TorusGeometry(DR + 0.01, 0.022, 12, 160), gold); eq.rotation.x = Math.PI / 2; cage.add(eq); }
  cage.rotation.z = 0.32;
  const fres = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { c1: { value: new THREE.Color(0xc89bff) }, c2: { value: new THREE.Color(0xffd79a) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: 'uniform vec3 c1; uniform vec3 c2; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.-abs(dot(vN,vV)),2.6); float top=smoothstep(-.2,1.2,vN.y); gl_FragColor=vec4(mix(c1,c2,top*.6)*f*0.95, f); }',
  });
  const shellGeo = new THREE.SphereGeometry(DR, 56, 36);
  const glassBack = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ color: 0x7b4fc9, roughness: 0.08, transparent: true, opacity: 0.1, side: THREE.BackSide, depthWrite: false }));
  const glassFront = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.08, envMapIntensity: 2.2, depthWrite: false }));
  const rimShell = new THREE.Mesh(new THREE.SphereGeometry(DR * 1.003, 56, 36), fres);
  glassBack.renderOrder = 1; glassFront.renderOrder = 3; rimShell.renderOrder = 4;
  drum.add(glassBack, glassFront, rimShell);
  const orbitA = new THREE.Group(), orbitB = new THREE.Group();
  orbitA.rotation.set(Math.PI / 2 - 0.42, 0.18, 0); orbitB.rotation.set(Math.PI / 2 + 0.3, -0.5, 0);
  drum.add(orbitA, orbitB);
  for (const [o, r, tube] of [[orbitA, DR + 0.22, 0.04], [orbitB, DR + 0.34, 0.026]]) {
    o.add(new THREE.Mesh(new THREE.TorusGeometry(r, tube, 16, 200), gold));
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), gold); bead.position.set(r, 0, 0); o.add(bead);
  }
  {
    const col = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 16, 64), gold); col.rotation.x = Math.PI / 2; col.position.y = DR - 0.03; drum.add(col);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    tube.position.y = DR + 0.08; tube.renderOrder = 3; drum.add(tube);
    const col2 = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 12, 64), gold); col2.rotation.x = Math.PI / 2; col2.position.y = DR + 0.19; drum.add(col2);
  }
  const backGlow = halo(5, 0.16, 0xb98cff); backGlow.position.set(0, 1.6, -1.4); scene.add(backGlow);

  // the rail: gold arc, 6 cups + the bonus cup (re-laid when the play area changes shape)
  const railGroup = new THREE.Group(); scene.add(railGroup);
  const cupGeo = new THREE.CylinderGeometry(0.34, 0.38, 0.16, 40), rimGeo = new THREE.TorusGeometry(0.33, 0.03, 12, 56), rimGeoB = new THREE.TorusGeometry(0.33, 0.045, 12, 56), rim2Geo = new THREE.TorusGeometry(0.4, 0.018, 10, 56);
  const cups = [];
  let narrow = null;
  function layRail(isNarrow) {
    if (narrow === isNarrow) return;
    narrow = isNarrow;
    railGroup.clear();
    const spots = cupSpots(isNarrow), a0 = isNarrow ? -37 : -44, a1 = -a0, R = 3.3, cz = -1.0, pts = [];
    for (let a = a0; a <= a1; a += 3) { const t = a * Math.PI / 180; pts.push(new THREE.Vector3(Math.sin(t) * R, 0.13, Math.cos(t) * R + cz)); }
    railGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 100, 0.035, 8, false), gold));
    railGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => p.clone().setY(0.05))), 100, 0.02, 6, false), goldDark));
    cups.length = 0;
    spots.forEach((p, i) => {
      const bonus = i === 6;
      const base = new THREE.Mesh(cupGeo, lacquer); base.position.copy(p).setY(0.08); railGroup.add(base);
      const r = new THREE.Mesh(bonus ? rimGeoB : rimGeo, gold); r.rotation.x = Math.PI / 2; r.position.copy(p).setY(0.165); railGroup.add(r);
      if (bonus) { const r2 = new THREE.Mesh(rim2Geo, gold); r2.rotation.x = Math.PI / 2; r2.position.copy(p).setY(0.12); railGroup.add(r2); }
      cups.push(p.clone().setY(0.165 + BR * RAIL_S * 0.82));
    });
    // balls already seated follow their cup
    balls.forEach((b) => { if (b.state === 'cup') { b.pos.copy(cups[b.cup]); placeDecor(b); } });
  }

  // the balls
  const ballGeo = new THREE.SphereGeometry(1, 32, 22); // ~1.4k triangles a ball (36 + glass + rail ≈ 100k in all)
  const ringGeo = new THREE.TorusGeometry(1.12, 0.1, 10, 48);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const balls = [];
  const rest = [];
  {
    for (let i = 0; i < 36; i++) rest.push(new THREE.Vector3(rnd() * 2 - 1, -rnd() * 0.95 + 0.2 * rnd(), rnd() * 2 - 1).multiplyScalar(0.8 * (DR - BR)));
    for (let it = 0; it < 220; it++) {
      for (let i = 0; i < 36; i++) {
        for (let j = i + 1; j < 36; j++) {
          const d = rest[i].distanceTo(rest[j]);
          if (d < 2 * BR + 0.01) { const push = rest[i].clone().sub(rest[j]).normalize().multiplyScalar((2 * BR + 0.01 - d) / 2); rest[i].add(push); rest[j].sub(push); }
        }
        rest[i].y -= 0.004;
        const L = rest[i].length(); if (L > DR - BR - 0.03) rest[i].multiplyScalar((DR - BR - 0.03) / L);
      }
    }
  }
  for (let n = 1; n <= 36; n++) {
    const i = n - 1;
    const mesh = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ map: tex(ballCanvas(n)), roughness: 0.36, metalness: 0, envMapIntensity: 0.55 }));
    mesh.scale.setScalar(BR); mesh.renderOrder = 2;
    mesh.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
    scene.add(mesh);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    ring.visible = false; ring.renderOrder = 6; scene.add(ring);
    const glow = halo(1, 0); glow.visible = false; glow.renderOrder = 0; scene.add(glow);
    const x = (rnd() * 2 - 1) * 0.85, rmax = Math.sqrt(Math.max(0.05, (DR - BR - 0.06) ** 2 - x * x));
    balls.push({
      n, mesh, ring, glow, state: 'drum', cup: -1,
      pos: rest[i].clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0).add(DC), // world
      loop: { x, r: rmax * (0.45 + 0.55 * rnd()), th: rnd() * Math.PI * 2, w: (1.4 + rnd() * 1.4) * (rnd() < 0.5 ? -1 : 1), bob: rnd() * 6, spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), sw: 2 + rnd() * 4 },
      fly: null, hi: 0, hiTo: 0, dim: 0, dimTo: 0,
    });
  }

  layRail(false); // cups exist before the first resize (a snapshot may place balls at once)

  // ---- state
  let W = 1, H = 1, area = null, energy = 0.35, energyTo = 0.35, energyV = 0, last = now();
  let cageA = 0, orbitAA = 0, orbitBA = 0;
  const camQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3(), tmpL = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
  const heroSpot = () => new THREE.Vector3(0, DC.y + 0.25, 2.35);

  function frame() {
    const cx = area.L + area.W / 2, cy = area.T + area.H / 2;
    const isNarrow = area.W / area.H < 1.25;
    layRail(isNarrow);
    const fitH = 4.55, fitW = isNarrow ? 4.55 : 5.1;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distH = (fitH / 2) / t * (H / Math.max(120, area.H));
    const distW = (fitW / 2) / (t * (W / H)) * (W / Math.max(160, area.W));
    const dist = Math.max(distH, distW);
    camera.position.set(0, 1.55 + dist * 0.135, dist); camera.lookAt(0, 1.62, 0);
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // the quaternion that turns a ball's number disc (+z) toward the camera at the hero spot
    tmpM.lookAt(camera.position, heroSpot(), new THREE.Vector3(0, 1, 0)); camQ.setFromRotationMatrix(tmpM);
    balls.forEach((b) => { if (b.state === 'cup') { faceQ(b.pos, b.mesh.quaternion); placeDecor(b); } }); // seated numbers face the (new) camera
  }
  function faceQ(p, out) { tmpM.lookAt(camera.position, p, new THREE.Vector3(0, 1, 0)); return out.setFromRotationMatrix(tmpM); }
  function placeDecor(b) {
    b.ring.position.copy(b.pos); faceQ(b.pos, b.ring.quaternion); b.ring.scale.setScalar(BR * RAIL_S);
    b.glow.position.copy(b.pos).add(new THREE.Vector3(0, 0, -0.25)); b.glow.scale.setScalar(1.3);
  }

  // cubic Bézier helper
  function bez(p0, p1, p2, p3, u, out) {
    const a = 1 - u;
    return out.set(0, 0, 0).addScaledVector(p0, a * a * a).addScaledVector(p1, 3 * a * a * u).addScaledVector(p2, 3 * a * u * u).addScaledVector(p3, u * u * u);
  }

  function drumPos(b, t, out) { // a ball's place in the tumble (world)
    const L = b.loop, r0 = rest[b.n - 1];
    const sx = L.x + 0.12 * Math.sin(t * 0.9 + L.bob);
    const loopP = tmpL.set(sx, L.r * Math.cos(L.th), L.r * Math.sin(L.th));
    const e = energy;
    out.set(r0.x + (loopP.x - r0.x) * e, r0.y + (loopP.y - r0.y) * e + 0.03 * Math.sin(t * 1.7 + L.bob) * (0.3 + e), r0.z + (loopP.z - r0.z) * e);
    const l = out.length(), max = DR - BR - 0.04; if (l > max) out.multiplyScalar(max / l);
    return out.add(DC);
  }

  function step(t, dt) {
    // energy: critically damped spring toward the target (no overshoot, smooth)
    const k = 14, c = 2 * Math.sqrt(k);
    energyV += (k * (energyTo - energy) - c * energyV) * dt; energy += energyV * dt;
    const spd = 0.35 + 0.65 * energy;
    cageA += (0.18 + 1.5 * energy) * dt; orbitAA += (0.12 + 0.55 * energy) * dt; orbitBA -= (0.09 + 0.4 * energy) * dt;
    cage.rotation.x = cageA; orbitA.rotation.z = orbitAA; orbitB.rotation.z = orbitBA;
    for (const b of balls) {
      const m = b.mesh;
      b.loop.th += b.loop.w * spd * dt; // every ball keeps its place in the tumble (a flight blends out of it)
      if (b.state === 'drum') {
                drumPos(b, t, b.pos);
        m.position.copy(b.pos);
        tmpQ.setFromAxisAngle(b.loop.spin, b.loop.sw * (0.25 + energy) * dt); m.quaternion.premultiply(tmpQ);
        m.scale.setScalar(BR);
      } else if (b.state === 'fly' || b.state === 'back') {
        const f = b.fly, s = t - f.t0;
        let p = tmpV, sc = BR;
        if (b.state === 'fly') {
          const TA = T_RISE + T_OUT;
          if (s < TA) { // one smooth arc: up through the collar, out and down to the hero spot
            const u = smoother(clamp(s / TA, 0, 1));
            bez(f.p0, f.c, f.c2, f.h, u, p);
            sc = BR + (BR * HERO_S - BR) * smooth(clamp((s / TA - 0.3) / 0.7, 0, 1));
            const w = 1 - smooth(clamp(s / 0.35, 0, 1)); // the tumble's own motion fades out (no jerk at the start)
            if (w > 0) p.addScaledVector(drumPos(b, t, tmpW).sub(f.p0), w);
          } else if (s < TA + T_HOLD) { const k = Math.sin((s - TA) / T_HOLD * Math.PI); p.copy(f.h); p.y += 0.025 * k * k; sc = BR * HERO_S; }
          else { const u = smoother(clamp((s - TA - T_HOLD) / T_CUP, 0, 1)); bez(f.h, f.h.clone().add(new THREE.Vector3(0, 0.1, 0.2)), f.e.clone().setY(f.e.y + 0.55), f.e, u, p); sc = BR * HERO_S + (BR * RAIL_S - BR * HERO_S) * u; }
          const turn = smooth(clamp(s / TA, 0, 1));
          faceQ(p, tmpQ); m.quaternion.copy(f.q0).slerp(tmpQ, turn);
          if (s >= T_FLIGHT) { b.state = 'cup'; b.pos.copy(f.e); p = b.pos; faceQ(p, m.quaternion); placeDecor(b); const cb = f.done; b.fly = null; if (cb) cb(); }
        } else {
          const u = smoother(clamp(s / T_BACK, 0, 1));
          const target = drumPos(b, t, new THREE.Vector3());
          const top = DC.clone().setY(DC.y + DR + 0.9);
          bez(f.p0, f.p0.clone().setY(f.p0.y + 1.6), top, target, u, p);
          sc = BR * RAIL_S + (BR - BR * RAIL_S) * u;
          if (s >= T_BACK) { b.state = 'drum'; b.fly = null; }
        }
        m.position.copy(p); m.scale.setScalar(sc);
        if (b.state === 'cup') { m.position.copy(b.pos); m.scale.setScalar(BR * RAIL_S); }
      }
      // highlight / dim fades (0.5 s)
      const fade = dt / 0.5;
      if (b.hi !== b.hiTo) b.hi = b.hiTo > b.hi ? Math.min(b.hiTo, b.hi + fade) : Math.max(b.hiTo, b.hi - fade);
      if (b.dim !== b.dimTo) b.dim = b.dimTo > b.dim ? Math.min(b.dimTo, b.dim + fade) : Math.max(b.dimTo, b.dim - fade);
      const h = smooth(b.hi);
      b.ring.visible = h > 0.002 && b.state === 'cup'; b.ring.material.opacity = h;
      b.glow.visible = b.ring.visible; b.glow.material.opacity = 0.85 * h;
      m.material.color.setScalar(1 - 0.42 * smooth(b.dim));
    }
  }

  let raf = 0, frames = 0, slowFrames = 0, dprCut = false;
  function loop() {
    raf = requestAnimationFrame(loop);
    const t = now(), dt = Math.min(0.05, t - last); last = t;
    if (!area) return;
    step(t, dt);
    // a slow device: drop the pixel ratio once (no visible change in motion). Before drawing: sizing the
    // canvas clears it — after the draw, this frame would show empty.
    if (!dprCut) { frames++; if (dt > 0.024) slowFrames++; if (frames === 120) { if (slowFrames > 40) { dprCut = true; renderer.setPixelRatio(1); renderer.setSize(W, H, false); } frames = 0; slowFrames = 0; } }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => { last = now(); });

  function ballOf(n) { return balls[n - 1]; }
  return {
    kind: 'webgl', topColor: TOP_COLOR,
    resize(w, h, a) {
      W = Math.max(1, w); H = Math.max(1, h); area = a;
      renderer.setPixelRatio(dprCut ? 1 : Math.min(window.devicePixelRatio || 1, W < 900 ? 1.75 : 1.5));
      renderer.setSize(W, H, false);
      frame();
    },
    mix(level) { energyTo = clamp(level, 0, 1); },
    draw(n, cup, done) {
      const b = ballOf(n); if (!b) return;
      if (b.state === 'cup' && b.cup === cup) { done && done(); return; }
      const t = now(), q0 = b.mesh.quaternion.clone();
      b.state = 'fly'; b.cup = cup;
      b.fly = { t0: t, p0: b.mesh.position.clone(), c: new THREE.Vector3(0, DC.y + DR + 0.3, 0), c2: new THREE.Vector3(0, DC.y + DR + 0.5, 1.7), h: heroSpot(), e: cups[cup].clone(), q0, done: () => { hooks.landed && hooks.landed(n, cup); done && done(); } };
    },
    place(list) { // [{n, cup}] straight into the cups
      list.forEach(({ n, cup }) => { const b = ballOf(n); if (!b) return; b.state = 'cup'; b.cup = cup; b.fly = null; b.pos.copy(cups[cup]); b.mesh.position.copy(b.pos); b.mesh.scale.setScalar(BR * RAIL_S); faceQ(b.pos, b.mesh.quaternion); placeDecor(b); });
    },
    collect() {
      let i = 0;
      balls.filter((b) => b.state === 'cup' || b.state === 'fly').sort((a, b) => a.cup - b.cup).forEach((b) => {
        b.hiTo = 0; b.dimTo = 0;
        b.state = 'back'; b.fly = { t0: now() + 0.07 * i++, p0: b.mesh.position.clone() };
        b.cup = -1;
      });
    },
    highlight(set, on) { // set: numbers to ring; others in the cups dim (on) — off clears all
      balls.forEach((b) => { const inCup = b.state === 'cup' || b.state === 'fly'; b.hiTo = on && inCup && set.has(b.n) ? 1 : 0; b.dimTo = on && inCup && set.size && !set.has(b.n) ? 1 : 0; });
    },
    ring(n) { const b = ballOf(n); if (b) b.hiTo = 1; },
    drawn() { return balls.filter((b) => b.state === 'cup' || b.state === 'fly').map((b) => ({ n: b.n, cup: b.cup })); },
    bonusAnchor() { // the bonus cup's foot on screen (stage px), for the BONUS label
      if (!cups[6]) return null;
      const v = cups[6].clone().setY(-0.02).project(camera);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    },
    debug: () => ({ energy, balls: balls.map((b) => b.state[0]).join(''), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, dpr: renderer.getPixelRatio() }),
    tick(t) { const dt = Math.max(0, Math.min(0.05, t - last)); last = t; step(t, dt); }, // QA: step the motion at a given time (frozen clock)
    positions() { const o = new Float32Array(36 * 4); balls.forEach((b, i) => { const m = b.mesh; o[i * 4] = m.position.x; o[i * 4 + 1] = m.position.y; o[i * 4 + 2] = m.position.z; o[i * 4 + 3] = m.scale.x; }); return o; }, // QA: motion log
  };
}

// ------------------------------------------------------------------ 2D fallback (no WebGL): a flat drum + the rail
function create2D(cv, hooks) {
  const g = cv.getContext('2d');
  let W = 1, H = 1, area = null, dpr = 1, energy = 0.35, energyTo = 0.35, last = now(), th = 0;
  const cupsN = []; // { n, cup, t0 }
  let hi = new Set(), hiOn = false;
  function draw() {
    requestAnimationFrame(draw);
    if (!area) return;
    const t = now(), dt = Math.min(0.05, t - last); last = t;
    energy += (energyTo - energy) * Math.min(1, dt * 3); th += (0.3 + 2 * energy) * dt;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const cx = area.L + area.W / 2, cy = area.T + area.H * 0.42, R = Math.min(area.W * 0.3, area.H * 0.36);
    g.strokeStyle = 'rgba(255,207,107,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(168,85,247,0.12)'; g.fill();
    for (let n = 1; n <= 36; n++) {
      if (cupsN.some((c) => c.n === n)) continue;
      const a = n * 2.4 + th * (n % 2 ? 1 : -0.8), rr = R * (0.25 + ((n * 37) % 60) / 100);
      ball2d(cx + Math.cos(a) * rr * 0.9, cy + R * 0.25 + Math.sin(a) * rr * 0.55, R * 0.11, n, 1);
    }
    const y = area.T + area.H * 0.86, step = Math.min(area.W / 8.5, 64);
    for (let i = 0; i < 7; i++) {
      const x = cx + (i - 3) * step + (i === 6 ? step * 0.35 : 0);
      g.strokeStyle = i === 6 ? '#ffd27a' : 'rgba(255,207,107,0.5)'; g.lineWidth = i === 6 ? 3 : 2;
      g.beginPath(); g.arc(x, y, step * 0.36, 0, Math.PI * 2); g.stroke();
      const c = cupsN.find((q) => q.cup === i);
      if (c) { const u = clamp((t - c.t0) / 0.5, 0, 1); ball2d(x, y - (1 - smooth(u)) * 40, step * 0.32, c.n, hiOn && hi.size && !hi.has(c.n) ? 0.55 : 1, hiOn && hi.has(c.n)); }
    }
  }
  function ball2d(x, y, r, n, light, ring) {
    g.globalAlpha = light; g.fillStyle = colorOf(n); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r * 0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a0b2e'; g.font = `800 ${Math.round(r * 0.75)}px Outfit, system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), x, y + 1);
    if (ring) { g.strokeStyle = '#ffd27a'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r * 1.18, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 1;
  }
  requestAnimationFrame(draw);
  return {
    kind: '2d', topColor: TOP_COLOR,
    resize(w, h, a) { W = w; H = h; area = a; dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); },
    mix(level) { energyTo = clamp(level, 0, 1); },
    draw(n, cup, done) { if (cupsN.some((c) => c.n === n)) { done && done(); return; } cupsN.push({ n, cup, t0: now() }); setTimeout(() => { hooks.landed && hooks.landed(n, cup); done && done(); }, T_FLIGHT * 1000); },
    place(list) { list.forEach(({ n, cup }) => { if (!cupsN.some((c) => c.n === n)) cupsN.push({ n, cup, t0: 0 }); }); },
    collect() { cupsN.length = 0; hi = new Set(); hiOn = false; },
    highlight(set, on) { hi = set; hiOn = on; },
    ring(n) { hi.add(n); hiOn = true; },
    drawn() { return cupsN.map((c) => ({ n: c.n, cup: c.cup })); },
    bonusAnchor() { if (!area) return null; const step = Math.min(area.W / 8.5, 64); return { x: area.L + area.W / 2 + 3.35 * step, y: area.T + area.H * 0.86 + step * 0.45 }; },
    debug: () => ({ energy }),
  };
}

export async function create(cv, hooks) {
  await fontsReady();
  hooks = hooks || {};
  if (hasWebGL() && !/[?&]flat=1/.test(location.search)) {
    try { return await createGL(cv, hooks); } catch (e) {
      console.warn('Orbit 36: WebGL failed, using 2D', e);
      const fresh = cv.cloneNode(false); cv.replaceWith(fresh); cv = fresh;
    }
  }
  return create2D(cv, hooks);
}
