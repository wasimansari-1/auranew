/* Bingo Orbit — the 3D draw machine (three.js r170): a gold armillary cage that tumbles the 75 balls,
 * a glass chute and the call cup where every drawn ball rests, big and readable.
 *
 *   const scene = createScene(canvas, { phone })
 *   scene.resize(cssW, cssH, { x, y, w, h })   the play area inside the canvas (the machine is fitted
 *                                               into it and centred on it; the backdrop fills the rest)
 *   scene.setRound(drawnList, { dim })          snap: these balls are out (the last one in the cup)
 *   scene.draw(n)                                animate ball n: cage gate → chute → cup (≈ 520 ms)
 *   scene.energy(0|1)                            idle sway / full tumble (eased)
 *   scene.win(on)                                warm gold light on the cup (eased)
 *   scene.topColor                               the backdrop's top colour (browser bar)
 *   scene.onFrame(fn)                            called every frame with the frame time (ms)
 *   scene.freeze(on) · scene.stats                QA: hold one drawn frame · per-frame CPU time
 * One continuous render loop, paused while the page is hidden. No shadow maps, no transmission:
 * baked contact shadows and an environment map keep it cheap on phones.
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';

// one geometry from many non-indexed ones (position + normal + uv): the static parts in few draw calls
function mergeGeometries(list) {
  const names = ['position', 'normal', 'uv'], out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    const arr = new Float32Array(list.reduce((t, g) => t + g.attributes[name].array.length, 0));
    let o = 0;
    for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

const COLS = ['B', 'I', 'N', 'G', 'O'];
export const BALL_COLORS = ['#8b5cf6', '#e056c8', '#ffbb60', '#2fcfb6', '#5aa7ff'];
const colOf = (n) => Math.floor((n - 1) / 15);
const TOP = '#140830';

function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeIn(t) { return t * t; }
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function createScene(canvas, opts = {}) {
  const phone = !!opts.phone;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environmentIntensity = 0.85;

  // ---------------------------------------------------------------- backdrop
  scene.background = canvasTex(256, 256, (g, w, h) => {
    const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, TOP); lg.addColorStop(0.55, '#0b0520'); lg.addColorStop(1, '#060411');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    const rg = g.createRadialGradient(w * 0.5, h * 0.38, 4, w * 0.5, h * 0.38, w * 0.55); rg.addColorStop(0, 'rgba(140,70,255,.26)'); rg.addColorStop(1, 'rgba(140,70,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
  });
  const glowTex = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
  const shadowTex = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(0,0,0,.85)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
  const floorTex = canvasTex(256, 256, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, '#1d0c3f'); r.addColorStop(0.45, '#120729'); r.addColorStop(0.8, 'rgba(8,4,22,.6)'); r.addColorStop(1, 'rgba(6,4,17,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });

  const world = new THREE.Group(); scene.add(world);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.62; world.add(floor);
  function flat(tex, color, size, op, x, y, z, additive) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: op, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); world.add(m); return m;
  }
  flat(glowTex, 0x8b3dff, 6.5, 0.5, 0, -1.61, 0, true);
  flat(shadowTex, 0xffffff, 2.6, 1, 0, -1.605, 0);
  flat(shadowTex, 0xffffff, 1.2, 1, 2.05, -1.605, 0.36);
  { // soft bokeh far behind: one draw call (additive points; the colour carries the opacity)
    const bk = rng(9), pos = [], col = [], c = new THREE.Color();
    for (let i = 0; i < 22; i++) {
      pos.push((bk() - 0.5) * 16, -0.5 + bk() * 5, -6 - bk() * 4);
      c.set(bk() < 0.55 ? 0xa855f7 : 0xffbb60).multiplyScalar(0.1 + bk() * 0.16);
      col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    world.add(new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, size: 3.2, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  }

  // ---------------------------------------------------------------- materials
  const gold = new THREE.MeshStandardMaterial({ color: 0xffbf6a, metalness: 1, roughness: 0.24 });
  const goldDark = new THREE.MeshStandardMaterial({ color: 0xc98a3a, metalness: 1, roughness: 0.35 });
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x2b0f57, metalness: 0.2, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xe9d5ff, roughness: 0.05, transparent: true, opacity: 0.2, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });

  // merge static parts per material: a handful of draw calls for the whole machine
  const parts = { gold: [], goldDark: [], lacquer: [] };
  function part(mat, geo, pos, rot) {
    const m = new THREE.Object3D();
    if (pos) m.position.copy(pos);
    if (rot) m.rotation.copy(rot);
    m.updateMatrix(); geo.applyMatrix4(m.matrix);
    parts[mat].push(geo.index ? geo.toNonIndexed() : geo);
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z), E = (x, y, z) => new THREE.Euler(x, y, z);

  // stand: lacquered plinth, gold trims, neck, yoke holding the axle
  part('lacquer', new THREE.CylinderGeometry(0.95, 1.08, 0.28, 48), V(0, -1.48, 0));
  part('gold', new THREE.TorusGeometry(1.0, 0.025, 10, 80), V(0, -1.34, 0), E(Math.PI / 2, 0, 0));
  part('goldDark', new THREE.TorusGeometry(1.075, 0.02, 10, 80), V(0, -1.61, 0), E(Math.PI / 2, 0, 0));
  part('gold', new THREE.CylinderGeometry(0.16, 0.3, 0.5, 32), V(0, -1.1, 0));
  part('gold', new THREE.TorusGeometry(1.24, 0.045, 14, 80, Math.PI), V(0, 0.2, 0), E(0, 0, Math.PI));
  for (const s of [-1, 1]) {
    part('goldDark', new THREE.CylinderGeometry(0.09, 0.09, 0.16, 20), V(s * 1.24, 0.2, 0), E(0, 0, Math.PI / 2));
    part('gold', new THREE.SphereGeometry(0.07, 16, 10), V(s * 1.33, 0.2, 0));
  }
  // exit gate + chute rings
  const gate = new THREE.CylinderGeometry(0.15, 0.17, 0.18, 28, 1, true);
  part('gold', gate, V(0, 1.28, 0));
  const chute = new THREE.CatmullRomCurve3([V(0, 1.32, 0), V(0.35, 1.62, 0.05), V(1.15, 1.6, 0.18), V(1.85, 1.15, 0.32), V(2.05, 0.4, 0.36)]);
  for (const t of [0.02, 0.35, 0.7, 0.98]) {
    const p = chute.getPointAt(t), tg = chute.getTangentAt(t);
    const o = new THREE.Object3D(); o.position.copy(p); o.lookAt(p.clone().add(tg));
    part('gold', new THREE.TorusGeometry(0.165, 0.018, 8, 32), p, o.rotation);
  }
  // call cup on its column
  const cupX = 2.05, cupZ = 0.36, cupY = 0.28;
  part('lacquer', new THREE.CylinderGeometry(0.1, 0.22, 1.5, 28), V(cupX, -0.86, cupZ));
  part('lacquer', new THREE.CylinderGeometry(0.36, 0.42, 0.14, 40), V(cupX, -1.55, cupZ));
  part('gold', new THREE.TorusGeometry(0.37, 0.018, 8, 56), V(cupX, -1.48, cupZ), E(Math.PI / 2, 0, 0));
  part('gold', new THREE.TorusGeometry(0.3, 0.05, 14, 56), V(cupX, -0.1, cupZ), E(Math.PI / 2, 0, 0));
  part('goldDark', new THREE.CylinderGeometry(0.3, 0.12, 0.12, 40), V(cupX, -0.15, cupZ));
  for (const k of Object.keys(parts)) world.add(new THREE.Mesh(mergeGeometries(parts[k]), { gold, goldDark, lacquer }[k]));
  world.add(new THREE.Mesh(new THREE.TubeGeometry(chute, 64, 0.16, 16, false), glass));

  // the cage: wires merged into one mesh, turning on its horizontal axle
  const cage = new THREE.Group(); cage.position.y = 0.2; world.add(cage);
  const wires = [];
  const wire = 0.014;
  for (let k = 0; k < 12; k++) { const g = new THREE.TorusGeometry(1, wire, 6, 96); g.rotateY(k * Math.PI / 12); wires.push(g.toNonIndexed()); }
  for (const y of [-0.82, -0.5, 0, 0.5, 0.82]) { const g = new THREE.TorusGeometry(Math.sqrt(1 - y * y), y === 0 ? 0.03 : wire, 6, 96); g.rotateX(Math.PI / 2); g.translate(0, y, 0); wires.push(g.toNonIndexed()); }
  { const g = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 10); g.rotateZ(Math.PI / 2); wires.push(g.toNonIndexed()); }
  cage.add(new THREE.Mesh(mergeGeometries(wires), gold));
  // the two orbit bands (the game's motif) glide around the cage on their own
  const beadMat = new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0x7c3aed, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.2 });
  const orbits = [];
  for (const [tilt, yaw, a] of [[-0.42, 0.35, 0.6], [0.42, -0.35, 2.6]]) {
    const holder = new THREE.Group(); holder.position.y = 0.2; holder.rotation.set(Math.PI / 2 + tilt, yaw, 0); world.add(holder);
    const band = new THREE.Group(); holder.add(band);
    band.add(new THREE.Mesh(new THREE.TorusGeometry(1.13, 0.032, 12, 128), gold));
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10), beadMat); bead.position.set(Math.cos(a) * 1.13, Math.sin(a) * 1.13, 0); band.add(bead);
    orbits.push(band);
  }

  // ---------------------------------------------------------------- lights
  scene.add(new THREE.HemisphereLight(0xb69cff, 0x14062a, 0.35));
  const key = new THREE.SpotLight(0xffe2b0, 60, 20, 0.5, 0.6); key.position.set(2.5, 6, 5); key.target.position.set(0.6, 0, 0); scene.add(key, key.target);
  const rim = new THREE.PointLight(0xa855f7, 25, 12); rim.position.set(-2.5, 1.5, -2.5); scene.add(rim);
  const rim2 = new THREE.PointLight(0xff9d4d, 8, 8); rim2.position.set(3.5, 0.5, -2); scene.add(rim2);
  const winLight = new THREE.PointLight(0xffc46b, 0, 5); winLight.position.set(cupX, 0.9, cupZ + 0.8); scene.add(winLight);
  const cupGlow = flat(glowTex, 0xa855f7, 1.6, 0.0, cupX, -0.08, cupZ, true);
  const cupGlowGold = flat(glowTex, 0xffbb60, 1.7, 0.0, cupX, -0.079, cupZ, true);

  // ---------------------------------------------------------------- numbered balls (textures made on demand)
  const texCache = new Map();
  function ballTex(n) {
    let t = texCache.get(n);
    if (t) return t;
    t = canvasTex(512, 256, (g, w, h) => {
      const c = BALL_COLORS[colOf(n)];
      g.fillStyle = c; g.fillRect(0, 0, w, h);
      const band = g.createLinearGradient(0, 0, 0, h); band.addColorStop(0, 'rgba(0,0,0,.18)'); band.addColorStop(0.5, 'rgba(255,255,255,.06)'); band.addColorStop(1, 'rgba(0,0,0,.22)');
      g.fillStyle = band; g.fillRect(0, 0, w, h);
      for (const cx of [w * 0.25, w * 0.75]) {
        g.save(); g.translate(cx, h / 2);
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, 54, 56, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = c; g.lineWidth = 5; g.beginPath(); g.ellipse(0, 0, 47, 49, 0, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#1b1033'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '800 15px Outfit, "Plus Jakarta Sans", sans-serif'; g.fillText(COLS[colOf(n)], 0, -33);
        g.font = `900 ${n > 9 ? 54 : 60}px Outfit, "Plus Jakarta Sans", sans-serif`; g.fillText(String(n), 0, 9);
        g.restore();
      }
    });
    texCache.set(n, t);
    return t;
  }
  // two numbered balls are enough: the one travelling, the one in the cup (they swap roles)
  const bigGeo = new THREE.SphereGeometry(0.4, 48, 24);
  function numbered() { const m = new THREE.Mesh(bigGeo, new THREE.MeshPhysicalMaterial({ roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 })); m.visible = false; world.add(m); return m; }
  const numberedBalls = [numbered(), numbered()];
  let cupBall = null;
  function setBall(mesh, n, dim) {
    mesh.material.map = ballTex(n); mesh.material.color.set(dim ? 0x8a7aa8 : 0xffffff); mesh.material.needsUpdate = true;
  }
  const FACE = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.35, 0.04)); // number towards the camera

  // ---------------------------------------------------------------- the 75 balls in the cage
  const BR = 0.112, IN = 0.86;
  const balls = [];
  const rr = rng(5);
  const rest = [];
  let guard = 0;
  while (rest.length < 75 && guard++ < 400000) { // a loose pile in the lower half (non-overlapping)
    const p = new THREE.Vector3(rr() * 2 - 1, rr() * 2 - 1, rr() * 2 - 1).multiplyScalar(IN);
    if (p.length() > IN - BR) continue;
    if (p.y > -0.05 && rr() > 0.2 * (1 - (p.y + 0.05))) continue;
    if (rest.some((q) => q.distanceTo(p) < BR * 2.02)) continue;
    rest.push(p);
  }
  while (rest.length < 75) rest.push(new THREE.Vector3((rr() - 0.5) * 0.6, -0.4 + rr() * 0.3, (rr() - 0.5) * 0.6));
  const order = Array.from({ length: 75 }, (_, i) => i + 1).sort(() => rr() - 0.5); // which number sits where
  for (let i = 0; i < 75; i++) {
    const n = order[i];
    const x = (rr() - 0.5) * 1.1;
    const rmax = Math.sqrt(Math.max(0.05, (IN - BR - 0.02) ** 2 - x * x));
    balls[n] = {
      n, rest: rest[i], x, r: rmax * (0.82 + rr() * 0.18), s: rr(), k: 0.75 + rr() * 0.5,
      top: (-15 + rr() * 70) * Math.PI / 180, spin: new THREE.Euler(rr() * 6, rr() * 6, 0),
      out: false, scale: 1, pos: new THREE.Vector3(),
    };
  }
  const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(BR, 18, 12), new THREE.MeshPhysicalMaterial({ roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }), 75);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const tc = new THREE.Color();
  for (let n = 1; n <= 75; n++) inst.setColorAt(n - 1, tc.set(BALL_COLORS[colOf(n)]));
  inst.frustumCulled = false;
  const tumble = new THREE.Group(); tumble.position.y = 0.2; world.add(tumble);
  tumble.add(inst);

  // ---------------------------------------------------------------- state + animation
  let energy = 0, energyTarget = 0, winAmt = 0, winTarget = 0, cageAngle = 0, tPrev = 0, last = 0;
  const flights = []; // balls being drawn
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), tmp = new THREE.Vector3();
  const gateLocal = new THREE.Vector3(0, 1.0, 0); // the exit inside the cage (tumble-group coords)

  function loopPos(b, out) {
    // carried up the wall on the turning side, then a fall back to the bottom
    const s = b.s % 1, carry = 0.58;
    let y, z;
    if (s < carry) {
      const a = -Math.PI / 2 + (b.top + Math.PI / 2) * ease(s / carry);
      y = b.r * Math.sin(a); z = b.r * Math.cos(a);
    } else {
      const u = (s - carry) / (1 - carry);
      const a1 = b.top, y1 = b.r * Math.sin(a1), z1 = b.r * Math.cos(a1);
      const y0 = -b.r * 0.97, z0 = b.r * 0.2;
      z = z1 + (z0 - z1) * u; y = y1 + (y0 - y1) * easeIn(u);
    }
    return out.set(b.x, y, z);
  }

  function updateBalls(dt, now) {
    const f = 0.06 + 0.8 * energy; // loops per second
    const sway = 0.08 * (1 - energy);
    for (let n = 1; n <= 75; n++) {
      const b = balls[n];
      b.s += dt * b.k * f;
      if (b.out && b.scale <= 0) { m4.makeScale(0, 0, 0); inst.setMatrixAt(n - 1, m4); continue; }
      // rest pile (rocking gently with the cage) blended with the tumble loop
      const ang = sway * Math.sin(now * 0.0011 + b.x * 3);
      const ry = b.rest.y * Math.cos(ang) - b.rest.z * Math.sin(ang), rz = b.rest.y * Math.sin(ang) + b.rest.z * Math.cos(ang);
      loopPos(b, tmp);
      b.pos.set(b.rest.x + (tmp.x - b.rest.x) * energy, ry + (tmp.y - ry) * energy, rz + (tmp.z - rz) * energy);
      b.spin.x += dt * (0.4 + 3 * energy) * b.k;
      q.setFromEuler(b.spin);
      sc.setScalar(b.scale);
      m4.compose(b.pos, q, sc);
      inst.setMatrixAt(n - 1, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
  }

  // ---- a drawn ball: picked up to the gate, down the chute, popped into the cup
  const PICK = 110, ROLL = 250, POP = 130; // ms: 490 in all — done before the next ball (every 500 ms)
  function settle(f) { // put a flight's ball straight into the cup (a new ball comes before it finished)
    if (f.old && f.old !== f.mesh) f.old.visible = false;
    f.b.scale = 0;
    f.mesh.visible = true; f.mesh.scale.setScalar(1); f.mesh.position.set(cupX, cupY, cupZ); f.mesh.quaternion.copy(FACE);
    cupBall = f.mesh;
  }
  function draw(n) {
    const b = balls[n];
    if (!b || b.out) return;
    flights.splice(0).forEach(settle);
    b.out = true;
    const mesh = numberedBalls[0] === cupBall ? numberedBalls[1] : numberedBalls[0];
    setBall(mesh, n, false);
    flights.push({ n, b, mesh, t0: performance.now(), from: b.pos.clone(), old: cupBall, oldFrom: cupBall ? cupBall.position.clone() : null });
  }
  const rollQ = new THREE.Quaternion(), axis = new THREE.Vector3();
  function updateFlights(now) {
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i], t = now - f.t0;
      if (t < PICK) { // the small ball rises to the gate inside the cage
        const u = easeIn(t / PICK);
        f.b.pos.lerpVectors(f.from, gateLocal, u);
        q.setFromEuler(f.b.spin); sc.setScalar(1); m4.compose(f.b.pos, q, sc); inst.setMatrixAt(f.n - 1, m4);
        f.b.scale = 1;
        continue;
      }
      f.b.scale = 0;
      const m = f.mesh;
      m.visible = true; // (also after a long frame that skipped the roll)
      if (t < PICK + ROLL) { // rolling down the chute (small)
        const u = ease((t - PICK) / ROLL);
        m.position.copy(chute.getPointAt(Math.min(0.999, u)));
        m.scale.setScalar(0.32);
        axis.copy(chute.getTangentAt(Math.min(0.999, u))).cross(new THREE.Vector3(0, 1, 0)).normalize();
        rollQ.setFromAxisAngle(axis, -u * 9);
        m.quaternion.copy(rollQ);
      } else { // pop into the cup, turning its number to the camera
        const u = clamp01((t - PICK - ROLL) / POP), e = easeOut(u);
        const endP = chute.getPointAt(0.999);
        m.position.set(endP.x + (cupX - endP.x) * e, endP.y + (cupY - endP.y) * e + Math.sin(u * Math.PI) * 0.06, endP.z + (cupZ - endP.z) * e);
        m.scale.setScalar(0.32 + 0.68 * (u < 1 ? 1 - Math.pow(1 - u, 2) * (1 - 0.15 * Math.sin(u * Math.PI)) : 1));
        m.quaternion.copy(rollQ).slerp(FACE, e);
        if (u >= 1) { m.scale.setScalar(1); m.position.set(cupX, cupY, cupZ); m.quaternion.copy(FACE); }
      }
      // the previous cup ball sinks into the cup as the new one arrives
      if (f.old && f.old !== m) {
        const u = clamp01((t - PICK - ROLL + 120) / 220);
        f.old.position.set(cupX, cupY - 0.32 * easeIn(u), cupZ);
        f.old.scale.setScalar(Math.max(0.001, 1 - easeIn(u)));
        if (u >= 1) f.old.visible = false;
      }
      if (t >= PICK + ROLL + POP) {
        if (f.old && f.old !== m) f.old.visible = false;
        cupBall = m; flights.splice(i, 1);
      }
    }
  }

  function setRound(drawn, o = {}) {
    flights.length = 0;
    const out = new Set(drawn);
    for (let n = 1; n <= 75; n++) { balls[n].out = out.has(n); balls[n].scale = out.has(n) ? 0 : 1; }
    numberedBalls.forEach((m) => { m.visible = false; });
    cupBall = null;
    const lastN = o.cup || drawn[drawn.length - 1];
    if (lastN) {
      cupBall = numberedBalls[0];
      setBall(cupBall, lastN, !!o.dim);
      cupBall.visible = true; cupBall.position.set(cupX, cupY, cupZ); cupBall.scale.setScalar(1); cupBall.quaternion.copy(FACE);
    }
  }
  // betting: all balls back in the cage, last round's ball dimmed in the cup
  function refill(lastBall) {
    setRound([], { cup: lastBall, dim: true });
  }

  // ---------------------------------------------------------------- camera fit (play area)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const content = { w: 3.9, h: 3.45, cx: 0.48, cy: 0.06 };
  let W = 1, H = 1;
  function resize(cssW, cssH, play) {
    W = Math.max(1, cssW); H = Math.max(1, cssH);
    const dpr = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const P = play || { x: 0, y: 0, w: W, h: H };
    const margin = phone ? 0.94 : 0.86;
    const k = Math.max(content.h / (margin * Math.max(40, P.h)), content.w / (margin * Math.max(40, P.w)));
    const dist = k * H / (2 * Math.tan(THREE.MathUtils.degToRad(15)));
    const look = new THREE.Vector3(content.cx, content.cy, 0);
    camera.position.set(look.x, look.y + dist * 0.16, dist); camera.lookAt(look);
    const pcx = P.x + P.w / 2, pcy = P.y + P.h / 2 + (phone ? 4 : 10);
    camera.setViewOffset(W, H, W / 2 - pcx, H / 2 - pcy, W, H);
    camera.updateProjectionMatrix();
    render(performance.now());
  }

  // ---------------------------------------------------------------- loop
  const frameFns = [];
  const stats = { n: 0, ms: 0, max: 0, upd: 0 }; // CPU ms: whole frame / the update part (QA)
  function render(now) {
    const t0 = performance.now();
    const dt = tPrev ? Math.min(0.05, (now - tPrev) / 1000) : 0.016;
    tPrev = now;
    energy += (energyTarget - energy) * Math.min(1, dt * 1.6);
    winAmt += (winTarget - winAmt) * Math.min(1, dt * 2.2);
    cageAngle += dt * (0.25 + 2.4 * energy);
    cage.rotation.x = cageAngle;
    orbits[0].rotation.z += dt * (0.12 + 0.5 * energy);
    orbits[1].rotation.z -= dt * (0.1 + 0.45 * energy);
    updateBalls(dt, now);
    updateFlights(now);
    winLight.intensity = 10 * winAmt;
    cupGlow.material.opacity = 0.7 * (cupBall ? 1 : 0.35) * (1 - winAmt);
    cupGlowGold.material.opacity = 0.9 * winAmt;
    const t1 = performance.now();
    renderer.render(scene, camera);
    const t2 = performance.now();
    for (const fn of frameFns) fn(now);
    stats.upd += t1 - t0 + (performance.now() - t2);
    const ms = performance.now() - t0;
    stats.n++; stats.ms += ms; if (ms > stats.max) stats.max = ms;
  }
  let raf = 0, frozen = false, lastDraw = 0;
  const minGap = opts.maxFps ? 1000 / opts.maxFps : 0; // QA on a software GPU: fewer frames
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (frozen || (minGap && now - lastDraw < minGap)) return;
    lastDraw = now; render(now);
  }
  function play() { if (!raf) { tPrev = 0; raf = requestAnimationFrame(tick); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else play(); });
  play();
  // warm the textures the draw will need, a few per idle moment (no hitch when a ball comes out)
  let warm = 1;
  (function warmUp() {
    if (warm > 75) return;
    for (let i = 0; i < 6 && warm <= 75; i++) ballTex(warm++);
    setTimeout(warmUp, 60);
  })();

  return {
    resize, setRound, refill, draw,
    energy(v) { energyTarget = v; },
    win(on) { winTarget = on ? 1 : 0; },
    freeze(on) { frozen = !!on; if (on) render(performance.now()); }, // QA: hold one fully drawn frame
    topColor: TOP,
    stats,
    onFrame(fn) { frameFns.push(fn); },
    renderer,
  };
}
