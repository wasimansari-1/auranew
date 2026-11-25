/* Keno Vortex — the 3D ball machine (three.js 0.170.0, shared copy in ../_core/vendor), with a flat
 * 2D canvas fallback when WebGL is not available.
 *
 * A clear glass sphere on a gold pedestal holds the 40 numbered balls; a glass riser leaves the
 * sphere's upper-right shoulder and bends into a horizontal glass rail with ten numbered sockets.
 *
 * Motion (all analytic and time-based, so it is identical at any frame rate and never jerks):
 *   blow(on)   the blower ramps up (1.1 s smoothstep): every ball blends from its place in the resting
 *              pile into its own vortex orbit (radius, height, speed and bob of its own); off: the
 *              balls blend back down into the lowest free places of the pile.
 *   draw(i, n) ball n is sucked to the outlet and blown up the riser into socket i (1.2 s, one eased
 *              distance profile over the whole trip: speed 0 at the start, 0 at the socket; it rolls
 *              along the rail and turns its number to the viewer as it settles).
 *   back()     the rail empties: the balls roll back down the riser into the top of the pile, one
 *              after another (constant spacing, no overlap).
 *   mine(set)  numbers on the player's tickets: their balls get a gold ring + halo in the rail.
 * The scene renders only while something moves (battery); hooks: landed(i, n), whoosh(i).
 *
 * API: create(canvas, hooks) → Promise<{ resize(w, h, area), blow(on, instant), draw(i, n),
 *      place(balls), back(instant), mine(set), win(on), busy(), topColor, kind: 'webgl' | '2d' }>
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';

const TOP_COLOR = '#0f0724';
const R = 1.3, BR = 0.21;              // glass sphere, ball radius
const RAILY = 2.08, TX = 2.26;         // rail height, riser x
const SLOTX = (i) => -2.1 + 0.445 * i;
const FLY = 1.2, AIR_T = 1.1;          // s
const DEC = ['#7c3aed', '#f5a524', '#db2777', '#0ea5b7'];
const decColor = (n) => DEC[Math.floor((n - 1) / 10)];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (u) => u * u * (3 - 2 * u);
const now = () => performance.now() / 1000;

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ the resting pile (40 places)
function pilePlaces() {
  const rnd = mulberry(7), lim = R - BR - 0.015, pts = [];
  for (let i = 0; i < 40; i++) {
    let v;
    do { v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (v.length() > 1);
    pts.push(v.multiplyScalar(lim));
  }
  const push = new THREE.Vector3();
  for (let it = 0; it < 600; it++) {
    for (const p of pts) { p.y -= 0.012; if (p.length() > lim) p.setLength(lim); }
    for (let i = 0; i < 40; i++) for (let j = i + 1; j < 40; j++) {
      const d = pts[i].distanceTo(pts[j]), m = 2 * BR + 0.004;
      if (d < m && d > 1e-6) { push.copy(pts[j]).sub(pts[i]).setLength((m - d) / 2); pts[i].sub(push); pts[j].add(push); }
    }
  }
  return pts.sort((a, b) => a.y - b.y); // lowest first
}

// ------------------------------------------------------------------ textures
function ballTexture(n) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = decColor(n); g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(0, 0, 256, 11); g.fillRect(0, 117, 256, 11);
  for (const cx of [64, 192]) {
    g.beginPath(); g.arc(cx, 64, 32, 0, Math.PI * 2); g.fillStyle = '#fbf8ff'; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(20,10,40,.2)'; g.stroke();
    g.fillStyle = '#160b2e'; g.font = '800 ' + (n >= 10 ? 35 : 40) + 'px Outfit, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), cx, 66.5);
    if (n === 6 || n === 9) g.fillRect(cx - 7, 84, 14, 3);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function railPlateTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 150;
  const g = c.getContext('2d');
  g.beginPath(); g.roundRect(3, 3, 1018, 144, 70);
  const bg = g.createLinearGradient(0, 0, 0, 150); bg.addColorStop(0, '#1d0f3d'); bg.addColorStop(1, '#0b0619');
  g.fillStyle = bg; g.fill();
  const gl = g.createLinearGradient(0, 0, 1024, 0); gl.addColorStop(0, '#ffcf6b'); gl.addColorStop(0.5, '#a86b1f'); gl.addColorStop(1, '#ffcf6b');
  g.lineWidth = 4; g.strokeStyle = gl; g.stroke();
  const u = (x) => ((x + 2.5) / 5.0) * 1024;
  for (let i = 0; i < 10; i++) {
    const x = u(SLOTX(i));
    g.beginPath(); g.arc(x, 75, 46, 0, Math.PI * 2);
    const sg = g.createRadialGradient(x, 75, 10, x, 75, 46); sg.addColorStop(0, 'rgba(168,85,247,.1)'); sg.addColorStop(1, 'rgba(168,85,247,.28)');
    g.fillStyle = sg; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(216,180,254,.35)'; g.stroke();
    g.fillStyle = 'rgba(233,220,255,.42)'; g.font = '700 23px Outfit, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(i + 1), x, 76);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function plateTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#120927'; g.fillRect(0, 0, 1024, 160);
  const gl = g.createLinearGradient(0, 20, 0, 140); gl.addColorStop(0, '#fff3c9'); gl.addColorStop(0.5, '#ffcf6b'); gl.addColorStop(1, '#d98a17');
  g.fillStyle = gl; g.font = '900 92px Outfit, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '14px';
  g.fillText('KENO VORTEX', 512, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glowTexture(r, gc, b) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, `rgba(${r},${gc},${b},1)`); rg.addColorStop(0.45, `rgba(${r},${gc},${b},.35)`); rg.addColorStop(1, `rgba(${r},${gc},${b},0)`);
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function rimMaterial(color, power, strength) {
  return new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color) }, p: { value: power }, s: { value: strength } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-w.xyz); gl_Position = projectionMatrix*w; }',
    fragmentShader: `uniform vec3 c; uniform float p; uniform float s; varying vec3 vN; varying vec3 vV;
      void main(){ vec3 n = normalize(vN); float f = pow(1.-abs(dot(n,normalize(vV))), p);
        float hl = pow(max(dot(n, normalize(vec3(-.55,.62,.56))),0.), 80.)*1.1;
        gl_FragColor = vec4(c*f*s + vec3(1.)*hl, 1.); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
function glass(opacity) {
  return new THREE.MeshStandardMaterial({ color: 0xf4eeff, metalness: 0.1, roughness: 0.04, transparent: true, opacity, envMapIntensity: 1.6, depthWrite: false });
}

// ------------------------------------------------------------------ WebGL scene
function webgl(cv, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 80);

  // backdrop: deep violet studio with a glow behind the machine, two soft light shafts, faint bokeh
  const bgU = { sp: { value: new THREE.Vector2(0.5, 0.5) }, asp: { value: 1 }, rad: { value: 0.4 } };
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: bgU,
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, .9999, 1.); }',
    fragmentShader: `varying vec2 vU; uniform vec2 sp; uniform float asp; uniform float rad;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec3 col = mix(vec3(.003,.0015,.008), vec3(.016,.006,.042), smoothstep(0., 1., vU.y));
        vec2 d = (vU - sp) * vec2(asp, 1.);
        float r = length(d) / rad;
        col += vec3(.20,.05,.62) * .26 * exp(-r*r*1.5);
        col += vec3(1.,.55,.18) * .025 * exp(-pow(length((vU - vec2(sp.x, sp.y + rad*.95)) * vec2(asp*.45, 1.)) / rad, 2.) * 3.);
        for (int i = 0; i < 2; i++) { float s = i == 0 ? -1. : 1.; float x = (vU.x - sp.x) * asp - s * (1. - vU.y) * .35 - s*.18*rad;
          col += vec3(.3,.15,1.) * .022 * exp(-x*x/(rad*rad*.03)) * smoothstep(.15, 1., vU.y); }
        vec2 f = (vU - vec2(sp.x, sp.y - rad*1.25)) * vec2(asp*.55, 2.6);
        col += vec3(.25,.08,.7) * .1 * exp(-dot(f,f)/(rad*rad*.5));
        vec2 g = floor(vU * vec2(asp, 1.) * 26.); float b = h(g);
        vec2 gc = fract(vU * vec2(asp, 1.) * 26.) - .5;
        col += vec3(.5,.3,1.) * step(.94, b) * .03 * smoothstep(.45, 0., length(gc)) * smoothstep(.2, .9, vU.y);
        col *= 1. - .35 * pow(length((vU - .5) * vec2(1., 1.2)), 2.);
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
    depthWrite: false, depthTest: false,
  }));
  bg.frustumCulled = false; bg.renderOrder = -10; scene.add(bg);

  scene.add(new THREE.HemisphereLight(0xcdb8ff, 0x1a0b33, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-4, 6, 8); scene.add(key);
  const warm = new THREE.DirectionalLight(0xffc47a, 0.9); warm.position.set(5, 3, 4); scene.add(warm);
  const rimL = new THREE.PointLight(0xa855f7, 26, 9, 1.6); rimL.position.set(0, 0.5, -2.6); scene.add(rimL);

  const gold = new THREE.MeshStandardMaterial({ color: 0xf0b860, metalness: 1, roughness: 0.24, envMapIntensity: 1.6 });
  const goldDS = gold.clone(); goldDS.side = THREE.DoubleSide;
  const darkLac = new THREE.MeshStandardMaterial({ color: 0x1a0d36, metalness: 0.55, roughness: 0.28, envMapIntensity: 1.2 });
  const neon = new THREE.MeshBasicMaterial({ color: 0xc58cff });

  // machine
  const back = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), new THREE.MeshStandardMaterial({ color: 0x1a0a3a, roughness: 0.1, transparent: true, opacity: 0.4, side: THREE.BackSide, depthWrite: false, envMapIntensity: 0.6 }));
  back.renderOrder = 1; scene.add(back);
  const front = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), glass(0.06)); front.renderOrder = 5; scene.add(front);
  const rimS = new THREE.Mesh(new THREE.SphereGeometry(R * 1.001, 48, 32), rimMaterial(0xb98cff, 2.6, 0.95)); rimS.renderOrder = 6; scene.add(rimS);
  const eq = new THREE.Mesh(new THREE.TorusGeometry(R + 0.035, 0.04, 16, 128), gold); eq.rotation.x = Math.PI / 2; scene.add(eq);
  const eqGlow = new THREE.Mesh(new THREE.TorusGeometry(R + 0.035, 0.012, 6, 128), neon); eqGlow.rotation.x = Math.PI / 2; eqGlow.position.y = -0.055; scene.add(eqGlow);
  const neck = new THREE.LatheGeometry([[0, -1.2], [0.42, -1.2], [0.47, -1.3], [0.4, -1.42], [0.38, -1.56], [0.46, -1.68], [0.86, -1.86], [1.32, -1.98], [1.42, -2.06], [1.42, -2.12], [0, -2.12]].map(([x, y]) => new THREE.Vector2(x, y)), 64);
  scene.add(new THREE.Mesh(neck, gold));
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.46, 0.62, 64), darkLac); drum.position.y = -2.43; scene.add(drum);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.022, 6, 128), neon); ring.rotation.x = Math.PI / 2; ring.position.y = -2.14; scene.add(ring);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.372, 1.372, 0.2, 48, 1, true, -0.62, 1.24), new THREE.MeshStandardMaterial({ map: plateTexture(), metalness: 0.3, roughness: 0.35 }));
  plate.position.y = -2.41; scene.add(plate);
  const intake = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.05, 10, 48), gold); intake.rotation.x = Math.PI / 2; intake.position.y = -1.2; scene.add(intake);

  // riser + rail (one glass tube along one path)
  const outDir = new THREE.Vector3(Math.sin(0.8), Math.cos(0.8), 0);
  const p0 = outDir.clone().multiplyScalar(R);
  const path = new THREE.CurvePath();
  path.add(new THREE.CubicBezierCurve3(p0, p0.clone().multiplyScalar(1.3), new THREE.Vector3(TX, 0.95, 0), new THREE.Vector3(TX, 1.66, 0)));
  path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(TX, 1.66, 0), new THREE.Vector3(TX, RAILY, 0), new THREE.Vector3(TX - 0.42, RAILY, 0)));
  path.add(new THREE.LineCurve3(new THREE.Vector3(TX - 0.42, RAILY, 0), new THREE.Vector3(-2.36, RAILY, 0)));
  const segLen = path.curves.map((c) => c.getLength()), totalLen = segLen.reduce((a, b) => a + b, 0);
  const lenToSlot = (i) => segLen[0] + segLen[1] + (TX - 0.42 - SLOTX(i));
  const pointAtLen = (() => { // exact for the straight rail, arc-length table for the bends
    const N = 160, table = [];
    for (let k = 0; k <= N; k++) { const L = (k / N) * (segLen[0] + segLen[1]); table.push(path.getPointAt(L / totalLen)); }
    return (L, out) => {
      const bend = segLen[0] + segLen[1];
      if (L >= bend) return out.set(TX - 0.42 - (L - bend), RAILY, 0);
      const f = clamp(L / bend, 0, 1) * N, k = Math.floor(f), t = f - k;
      return out.copy(table[k]).lerp(table[Math.min(N, k + 1)], t);
    };
  })();
  // a quadratic Bézier walked by arc length (the trips into and out of the sphere: their tangent
  // at the outlet is the riser's, so a ball never turns a corner there)
  function bezier(a, c, b) {
    const N = 24, pts = [], acc = [0];
    for (let k = 0; k <= N; k++) { const t = k / N, u = 1 - t; pts.push(new THREE.Vector3().copy(a).multiplyScalar(u * u).addScaledVector(c, 2 * u * t).addScaledVector(b, t * t)); }
    for (let k = 1; k <= N; k++) acc.push(acc[k - 1] + pts[k].distanceTo(pts[k - 1]));
    const len = acc[N];
    return { len, at(sv, out) {
      if (sv <= 0) return out.copy(pts[0]);
      if (sv >= len) return out.copy(pts[N]);
      let k = 1; while (acc[k] < sv) k++;
      return out.copy(pts[k - 1]).lerp(pts[k], (sv - acc[k - 1]) / (acc[k] - acc[k - 1]));
    } };
  }
  const TR = 0.25;
  const tubeGeo = new THREE.TubeGeometry(path, 200, TR, 24, false);
  const tubeBack = new THREE.Mesh(tubeGeo, new THREE.MeshStandardMaterial({ color: 0x2a1356, transparent: true, opacity: 0.35, side: THREE.BackSide, depthWrite: false, roughness: 0.1 }));
  tubeBack.renderOrder = 1; scene.add(tubeBack);
  const tube = new THREE.Mesh(tubeGeo, glass(0.08)); tube.renderOrder = 5; scene.add(tube);
  const tubeRim = new THREE.Mesh(tubeGeo, rimMaterial(0xc9a2ff, 2.2, 0.7)); tubeRim.renderOrder = 6; scene.add(tubeRim);
  const collar = (pos, tan, r, len) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 40, 1, true), goldDS);
    m.position.copy(pos); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.clone().normalize()); scene.add(m);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 8, 40), gold);
    lip.position.copy(pos); lip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.clone().normalize()); scene.add(lip);
  };
  collar(p0, outDir, 0.3, 0.16);
  collar(new THREE.Vector3(TX, 1.42, 0), new THREE.Vector3(0, 1, 0), TR + 0.035, 0.12);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(TR + 0.03, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  cap.position.set(-2.36, RAILY, 0); cap.rotation.z = Math.PI / 2; scene.add(cap);
  const railPlate = new THREE.Mesh(new THREE.PlaneGeometry(5.0, (5.0 * 150) / 1024), new THREE.MeshBasicMaterial({ map: railPlateTexture(), transparent: true }));
  railPlate.position.set(0, RAILY, -0.34); scene.add(railPlate);

  // halos + rings for the player's numbers in the rail
  const haloTex = glowTexture(255, 200, 100);
  const halos = [], rings = [];
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.scale.setScalar(0.86); s.position.set(SLOTX(i), RAILY, -0.2); s.visible = false; scene.add(s); halos.push(s);
    const g = new THREE.Mesh(new THREE.TorusGeometry(BR + 0.035, 0.016, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
    g.position.set(SLOTX(i), RAILY, 0); g.visible = false; scene.add(g); rings.push(g);
  }
  const trailTex = glowTexture(200, 160, 255);

  // balls: each has its own vortex orbit that stays inside the glass on its own (no clamping, so
  // the motion is smooth everywhere): height band c ± A, radius within the sphere at that band
  function orbit(rnd) {
    const lim = R - BR - 0.05;
    const c = -0.5 + rnd() * 0.95;
    const A = Math.min(0.15 + rnd() * 0.25, lim - 0.12 - Math.abs(c));
    const ymax = Math.abs(c) + A, rmax = Math.sqrt(lim * lim - ymax * ymax);
    return { r: 0.2 + rnd() * Math.max(0.05, rmax - 0.2), c, A, w: (1.6 + rnd() * 2.2) * (rnd() < 0.85 ? 1 : -1), ph: rnd() * 6.3, f: 0.4 + rnd() * 0.6, ps: rnd() * 6.3 };
  }
  const geo = new THREE.SphereGeometry(BR, 32, 20);
  const pile = pilePlaces();
  const rnd = mulberry(40);
  const B = []; // index n (1..40)
  for (let n = 1; n <= 40; n++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ballTexture(n), roughness: 0.18, metalness: 0, envMapIntensity: 1.1 }));
    mesh.quaternion.setFromEuler(new THREE.Euler(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3));
    scene.add(mesh);
    const trail = new THREE.Sprite(new THREE.SpriteMaterial({ map: trailTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    trail.scale.setScalar(0.7); trail.visible = false; scene.add(trail);
    B[n] = {
      n, mesh, trail, mode: 'machine', slot: -1, place: 0,
      // own vortex orbit
      orb: orbit(rnd),
      spinAxis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spinW: 4 + rnd() * 7,
      fly: null,
    };
  }
  // places in the pile: everybody starts resting, the lowest places first
  for (let n = 1; n <= 40; n++) B[n].place = n - 1;

  // ---- state
  let air = 0, airTo = 0, airFrom = 0, airT0 = 0; // raw linear 0–1, a time-based ramp (AIR_T for 0→1)
  let W = 1, H = 1, area = { L: 0, T: 0, W: 1, H: 1 };
  let raf = 0, dirty = true, lastT = now(), winOn = false, winT = 0;
  const mineSet = new Set(), slots = new Array(10).fill(0); // slot → ball number (0 = empty)
  const faceQ = [];
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), qtmp = new THREE.Quaternion(), spinQ = new THREE.Quaternion();

  function swirl(b, t, out) {
    const o = b.orb, th = o.ph + o.w * t, y = o.c + o.A * Math.sin(o.ps + 6.283 * o.f * t);
    return out.set(o.r * Math.cos(th), y, o.r * Math.sin(th));
  }
  function machinePos(b, t, out) {
    const a = smooth(air);
    out.copy(pile[b.place]);
    if (a > 0) out.lerp(swirl(b, t, tmp2), a);
    return out;
  }

  function computeFaces() {
    for (let i = 0; i < 10; i++) {
      const o = new THREE.Object3D(); o.position.set(SLOTX(i), RAILY, 0); o.lookAt(camera.position);
      faceQ[i] = o.quaternion.clone();
      rings[i].quaternion.copy(o.quaternion);
    }
  }

  // the balls in the machine take the lowest places of the pile, by their current height (called
  // while the blower is still on, so nobody jumps); returns how many are in the machine
  function reassignPlaces() {
    const t = now(), inM = [];
    for (let n = 1; n <= 40; n++) if (B[n].mode === 'machine') inM.push({ b: B[n], y: machinePos(B[n], t, tmp).y });
    inM.sort((a, b) => a.y - b.y).forEach((e, k) => { e.b.place = k; });
    return inM.length;
  }
  function inMachine() { let c = 0; for (let n = 1; n <= 40; n++) if (B[n].mode === 'machine') c++; return c; }

  // ---- motion
  function update(t, dt, dtRaw) {
    let moving = false;
    // air: analytic in time (identical at any frame rate)
    if (air !== airTo) {
      const span = AIR_T * Math.abs(airTo - airFrom);
      const u = span > 0 ? clamp((t - airT0) / span, 0, 1) : 1;
      air = airFrom + (airTo - airFrom) * u;
      moving = true;
    }
    if (air > 0) moving = true;
    const a = smooth(air);
    for (let n = 1; n <= 40; n++) {
      const b = B[n], m = b.mesh;
      if (b.mode === 'machine') {
        machinePos(b, t, m.position);
        if (a > 0) { spinQ.setFromAxisAngle(b.spinAxis, b.spinW * a * dt); m.quaternion.premultiply(spinQ); }
      } else if (b.mode === 'fly' || b.mode === 'return') {
        moving = true;
        const f = b.fly, u = clamp((t - f.t0) / f.T, 0, 1);
        let s;
        if (b.mode === 'fly') s = f.D * smooth(u);
        else { // constant speed with short eased ends (equal spacing between the returning balls)
          const e = f.e, v = 1 / (1 - e);
          s = f.D * (u < e ? (v * u * u) / (2 * e) : u > 1 - e ? 1 - (v * (1 - u) * (1 - u)) / (2 * e) : v * (u - e / 2));
        }
        positionOnTrip(f, s, m.position);
        if (b.mode === 'fly' && u < 0.18) { // the first moments blend out of the ball's own vortex motion (no stop)
          const w = smooth(u / 0.18);
          machinePos(b, t, tmp).lerp(m.position, w); m.position.copy(tmp);
        }
        // spin while moving; the last 40 % of a draw turns the number to the viewer
        spinQ.setFromAxisAngle(b.spinAxis, b.spinW * 1.4 * dt * (1 - u * u));
        if (b.mode === 'fly') {
          if (u < 0.6) { m.quaternion.premultiply(spinQ); f.q0.copy(m.quaternion); }
          else { const k = smooth((u - 0.6) / 0.4); m.quaternion.slerpQuaternions(f.q0, faceQ[b.slot], k); }
          b.trail.visible = u > 0.02 && u < 0.97;
          if (b.trail.visible) { b.trail.position.copy(m.position); b.trail.material.opacity = 0.55 * Math.sin(Math.PI * u); }
        } else m.quaternion.premultiply(spinQ);
        if (u >= 1) finishTrip(b);
      }
    }
    // halos
    for (let i = 0; i < 10; i++) {
      const n = slots[i], on = n && B[n].mode === 'rail' && mineSet.has(n);
      const h = halos[i], g = rings[i];
      const target = on ? (winOn ? 0.75 + 0.2 * Math.sin((t - winT) * 2.4) : 0.8) : 0;
      if (Math.abs(h.material.opacity - target) > 0.002 || (on && winOn)) {
        const k = 1 - Math.exp(-dtRaw * 7);
        h.material.opacity += (target - h.material.opacity) * k;
        g.material.opacity += ((on ? 1 : 0) - g.material.opacity) * k;
        moving = true;
      }
      h.visible = h.material.opacity > 0.01; g.visible = g.material.opacity > 0.01;
    }
    return moving;
  }

  function positionOnTrip(f, s, out) {
    if (f.dir > 0) { // machine → (curving into) the outlet → along the path to the slot
      if (s <= f.d1) return f.bz.at(s, out);
      return pointAtLen(s - f.d1, out);
    }
    // return: slot → back along the path to the outlet → curving down into the pile place
    const L = f.Lslot - s;
    if (L >= 0) return pointAtLen(L, out);
    return f.bz.at(-L, out);
  }
  function finishTrip(b) {
    const f = b.fly;
    b.trail.visible = false;
    if (b.mode === 'fly') {
      b.mode = 'rail'; b.mesh.position.set(SLOTX(b.slot), RAILY, 0); b.mesh.quaternion.copy(faceQ[b.slot]);
      b.fly = null;
      if (hooks.landed) hooks.landed(b.slot, b.n);
    } else {
      b.mode = 'machine'; b.place = f.place; b.fly = null;
    }
  }

  // ---- render loop
  function frame() {
    raf = 0;
    const t = now(), dtRaw = Math.min(2, Math.max(0, t - lastT)), dt = Math.min(0.05, dtRaw);
    lastT = t;
    const moving = update(t, dt, dtRaw);
    renderer.render(scene, camera);
    dirty = false;
    if (moving || winOn) schedule();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
  function kick() { if (!raf) { lastT = now(); schedule(); } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastT = now(); dirty = true; kick(); } });

  // ---- API
  const api = {
    kind: 'webgl', topColor: TOP_COLOR,
    resize(w, h, A) {
      W = Math.max(1, w); H = Math.max(1, h); area = A;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, W < 900 ? 1.75 : 1.5));
      renderer.setSize(W, H, false);
      const yT = 2.42, yB = -1.62, wNeed = 5.55;
      const visH = Math.max(yT - yB, (wNeed * A.H) / Math.max(1, A.W));
      const dist = 17, fullH = (visH * H) / Math.max(1, A.H);
      camera.fov = (2 * Math.atan(fullH / 2 / dist) * 180) / Math.PI;
      camera.aspect = W / H;
      const yc = (yT + yB) / 2, xc = -0.04;
      camera.position.set(xc, yc + 1.7, dist);
      camera.lookAt(xc, yc, 0);
      camera.setViewOffset(W, H, W / 2 - (A.L + A.W / 2), H / 2 - (A.T + A.H / 2), W, H);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      computeFaces();
      for (let i = 0; i < 10; i++) { const n = slots[i]; if (n && B[n].mode === 'rail') B[n].mesh.quaternion.copy(faceQ[i]); }
      const sp = new THREE.Vector3(0, 0, 0).project(camera);
      bgU.sp.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5); bgU.asp.value = W / H; bgU.rad.value = (A.H / H) * 0.9;
      dirty = true; kick();
    },
    // the blower: on during the draw; instant for a snapshot (joined mid-round)
    blow(on, instant) {
      if (!on && airTo > 0) reassignPlaces();
      const to = on ? 1 : 0;
      if (to !== airTo || instant) { airFrom = air; airTo = to; airT0 = now(); }
      if (instant) { air = airFrom = airTo; }
      kick();
    },
    // ball n → slot i (0–9), blown up the riser (instant: already there)
    draw(i, n, instant) {
      const b = B[n];
      if (!b || slots[i] === n) return;
      if (slots[i] && slots[i] !== n) { const o = B[slots[i]]; o.mode = 'machine'; o.slot = -1; }
      slots[i] = n; b.slot = i;
      if (instant || b.mode === 'rail') {
        b.mode = 'rail'; b.fly = null; b.trail.visible = false;
        b.mesh.position.set(SLOTX(i), RAILY, 0); b.mesh.quaternion.copy(faceQ[i] || b.mesh.quaternion);
        dirty = true; kick(); return;
      }
      const start = b.mode === 'machine' ? machinePos(b, now(), new THREE.Vector3()) : b.mesh.position.clone();
      const bz = bezier(start, p0.clone().addScaledVector(outDir, -0.45), p0);
      const d1 = bz.len, outlet = p0;
      b.mode = 'fly';
      b.fly = { dir: 1, t0: now(), T: FLY, start, outlet, bz, d1, D: d1 + lenToSlot(i), q0: b.mesh.quaternion.clone() };
      if (hooks.whoosh) hooks.whoosh(i);
      kick();
    },
    // put a finished draw in the rail at once (page opened during the result) — balls 1..10
    place(balls) {
      for (let i = 0; i < 10; i++) if (slots[i] && balls[i] !== slots[i]) { B[slots[i]].mode = 'machine'; B[slots[i]].slot = -1; slots[i] = 0; }
      balls.forEach((n, i) => api.draw(i, n, true));
      reassignPlaces();
      dirty = true; kick();
    },
    // the rail empties back into the machine (the next round starts)
    back(instant) {
      const order = [];
      for (let i = 9; i >= 0; i--) if (slots[i]) order.push(i);
      if (!order.length) return;
      const inM = inMachine();
      let k = 0;
      const t0 = now();
      order.forEach((i) => {
        const b = B[slots[i]];
        slots[i] = 0; b.slot = -1;
        const place = inM + k;
        if (instant) { b.mode = 'machine'; b.place = place; b.fly = null; b.trail.visible = false; }
        else {
          const Lslot = lenToSlot(i), bz = bezier(p0, p0.clone().addScaledVector(outDir, -0.5), pile[place]), d1 = bz.len;
          const D = Lslot + d1, v = 5.2; // units/s
          b.mode = 'return';
          b.fly = { dir: -1, t0: t0 + k * 0.13, T: D / (v * (1 - 0.18)), e: 0.18, D, Lslot, d1, bz, place };
          b.mesh.quaternion.copy(faceQ[i]);
        }
        k++;
      });
      dirty = true; kick();
    },
    mine(set) { mineSet.clear(); (set || []).forEach((n) => mineSet.add(n)); dirty = true; kick(); },
    win(on) { winOn = !!on; winT = now(); kick(); },
    busy() { for (let n = 1; n <= 40; n++) if (B[n].mode === 'fly' || B[n].mode === 'return') return true; return false; },
    railBalls() { return slots.slice(); },
    snapshot() { renderer.render(scene, camera); },
    // where the glass sphere is on screen (stage px): the page puts the countdown beside it
    sphere() {
      const c = new THREE.Vector3(0, 0, 0).project(camera), e = new THREE.Vector3(R, 0, 0).project(camera);
      const x = (c.x + 1) / 2 * W, y = (1 - c.y) / 2 * H;
      return { x, y, r: Math.abs((e.x + 1) / 2 * W - x) };
    },
    // QA: advance the motion to time t (seconds, the page clock) without drawing
    tick(t) { lastT = t; return update(t, 1 / 60, 1 / 60); },
    // QA: every ball's position (x, y, z × 40) and the frame time
    positions() { const o = new Float32Array(121); o[0] = lastT; for (let n = 1; n <= 40; n++) { const p = B[n].mesh.position; o[n * 3 - 2] = p.x; o[n * 3 - 1] = p.y; o[n * 3] = p.z; } return o; },
  };
  return api;
}

// ------------------------------------------------------------------ 2D fallback (no WebGL)
function flat(cv, hooks) {
  const ctx = cv.getContext('2d');
  let W = 1, H = 1, A = { L: 0, T: 0, W: 1, H: 1 }, dpr = 1;
  const slots = new Array(10).fill(0), mine = new Set();
  let blowing = false, raf = 0;
  function ball(x, y, r, n, ring) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = decColor(n); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.fillStyle = '#fbf8ff'; ctx.fill();
    ctx.fillStyle = '#160b2e'; ctx.font = '800 ' + Math.round(r * 0.8) + 'px Outfit, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + 1);
    if (ring) { ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 2.5; ctx.stroke(); }
  }
  function draw() {
    raf = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#170a33'); g.addColorStop(1, '#060411');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const u = Math.min(A.W / 5.6, A.H / 4.1), cx = A.L + A.W / 2, cy = A.T + A.H * 0.58;
    const r = 0.21 * u;
    // rail
    const ry = cy - 2.08 * u;
    ctx.fillStyle = 'rgba(29,15,61,.9)'; ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(cx - 2.45 * u, ry - 0.3 * u, 4.9 * u, 0.6 * u, 0.3 * u); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const x = cx + (-2.1 + 0.445 * i) * u;
      if (slots[i]) ball(x, ry, r, slots[i], mine.has(slots[i]));
      else { ctx.beginPath(); ctx.arc(x, ry, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(216,180,254,.35)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    // sphere
    ctx.beginPath(); ctx.arc(cx, cy, 1.3 * u, 0, Math.PI * 2); ctx.fillStyle = 'rgba(60,30,120,.35)'; ctx.fill(); ctx.strokeStyle = 'rgba(200,160,255,.6)'; ctx.lineWidth = 2; ctx.stroke();
    const used = new Set(slots);
    let k = 0;
    for (let n = 1; n <= 40; n++) {
      if (used.has(n)) continue;
      const a = k * 2.399, rr = Math.sqrt(k / 40) * 1.0 * u;
      const t = blowing ? performance.now() / 600 : 0;
      ball(cx + rr * Math.cos(a + t), cy + (blowing ? rr * Math.sin(a + t) : 0.45 * u + rr * 0.55 * Math.sin(a)), r * 0.85, n, false);
      k++;
    }
    if (blowing) raf = requestAnimationFrame(draw);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  return {
    kind: '2d', topColor: TOP_COLOR,
    resize(w, h, area) { W = w; H = h; A = area; dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); kick(); },
    blow(on) { blowing = !!on; kick(); },
    draw(i, n) { slots[i] = n; kick(); setTimeout(() => hooks.landed && hooks.landed(i, n), 0); },
    place(balls) { balls.forEach((n, i) => { slots[i] = n; }); kick(); },
    back() { slots.fill(0); kick(); },
    mine(set) { mine.clear(); (set || []).forEach((n) => mine.add(n)); kick(); },
    win() { kick(); },
    busy() { return false; },
    railBalls() { return slots.slice(); },
    snapshot() { draw(); },
  };
}

export async function create(cv, hooks) {
  hooks = hooks || {};
  try { await Promise.race([document.fonts.load('800 40px Outfit'), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* system font */ }
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('no webgl');
    return webgl(cv, hooks);
  } catch (e) {
    return flat(cv, hooks);
  }
}
