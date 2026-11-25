/* Lucky 20 — the LED draw board in real-time 3D (three.js 0.170, shared copy in _core/vendor).
 *
 *   const scene = await L20Scene(canvas);
 *   scene.resize(cssW, cssH, { cx, cy, w })    board centre + width in canvas CSS px
 *   scene.setDrawn(balls, { latest })          snap to a state (no animation)
 *   scene.draw(ball, index)                    a ball lands: its tile lifts and flips to its lit face
 *   scene.result(outcome)                      the draw is complete: first ball ring, leading colour
 *   scene.reset()                              new round: every lit tile flips back (a soft wave)
 *   scene.pick(x, y) → number | 0              tile under a canvas point (exact-number bets)
 *   scene.tilePoint(n, corner) → {x, y}        canvas CSS point of a tile (centre or top-right)
 *   scene.topColor, scene.stats, scene.frame(now)   one frame at once (smoothness checks)
 *
 * Smooth on cheap phones: the 80 tiles are ONE instanced body + two instanced faces (numbers from one
 * texture atlas, cell per instance) + one instanced glow — ~30 draw calls for the whole studio, no
 * post-processing, pixel ratio capped, and frames are rendered only while something moves (an idle
 * board costs nothing).
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';

const TILE = 1, GAP = 0.13, COLS = 10, ROWS = 8;
const GW = COLS * TILE + (COLS - 1) * GAP, GH = ROWS * TILE + (ROWS - 1) * GAP;
const PAD = 0.62;
const BW = GW + PAD * 2, BH = GH + PAD * 2;
export const BOARD_RATIO = BW / (BH + 0.5); // width / height incl. the logo plate under the frame

const SECT = [ // 1–20, 21–40, 41–60, 61–80
  { c: '#b26bff', hi: '#e2c6ff', lo: '#6d28d9' },
  { c: '#ffc455', hi: '#fff0c4', lo: '#d98a1c' },
  { c: '#2fd9c4', hi: '#c8fff6', lo: '#0f8a7c' },
  { c: '#ff5d8f', hi: '#ffd2df', lo: '#c0164e' },
];
const sectOf = (n) => Math.floor((n - 1) / 20);
const ease = {
  io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  lin: (t) => t,
};

function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}

// ---------------------------------------------------------------- number atlas: 16 × 16 cells of 128 px
// cells 0–79: unlit n · 80–159: lit n · 160–239: lit n with the "1ST" tag
const CELL = 128, PER = 16;
function buildAtlas() {
  const cv = document.createElement('canvas'); cv.width = cv.height = CELL * PER;
  const g = cv.getContext('2d');
  const draw = (cell, n, lit, first) => {
    const ox = (cell % PER) * CELL, oy = Math.floor(cell / PER) * CELL, s = SECT[sectOf(n)];
    const m = 3, w = CELL - 2 * m, r = 17;
    g.save(); g.translate(ox + m, oy + m);
    rrPath(g, 0, 0, w, w, r); g.save(); g.clip();
    if (lit) {
      const gr = g.createLinearGradient(0, 0, 0, w); gr.addColorStop(0, s.hi); gr.addColorStop(0.42, s.c); gr.addColorStop(1, s.lo);
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
      const sh = g.createLinearGradient(0, 0, 0, w * 0.5); sh.addColorStop(0, 'rgba(255,255,255,.55)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; rrPath(g, 6, 5, w - 12, w * 0.42, 12); g.fill();
    } else {
      const gr = g.createLinearGradient(0, 0, 0, w); gr.addColorStop(0, '#1d1436'); gr.addColorStop(1, '#0c0719');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
      g.fillStyle = 'rgba(255,255,255,.04)';
      for (let y = 7; y < w; y += 8) for (let x = 7; x < w; x += 8) { g.beginPath(); g.arc(x, y, 1.5, 0, 7); g.fill(); }
    }
    g.restore();
    g.lineWidth = lit ? 3.5 : 3; g.strokeStyle = lit ? 'rgba(255,255,255,.75)' : s.c + '88';
    rrPath(g, 1.5, 1.5, w - 3, w - 3, r - 1); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${n > 9 ? 64 : 68}px Outfit, system-ui, sans-serif`;
    if (lit) { g.fillStyle = '#1a0836'; g.fillText(String(n), w / 2, w / 2 + 5); }
    else { g.globalAlpha = 0.74; g.fillStyle = s.c; g.fillText(String(n), w / 2, w / 2 + 5); g.globalAlpha = 1; }
    if (first) {
      g.fillStyle = '#1a0836'; rrPath(g, w - 50, 6, 44, 22, 8); g.fill();
      g.fillStyle = '#ffcf6b'; g.font = '900 17px Outfit, system-ui, sans-serif'; g.fillText('1ST', w - 28, 18);
    }
    g.restore();
  };
  for (let n = 1; n <= 80; n++) { draw(n - 1, n, false); draw(80 + n - 1, n, true); draw(160 + n - 1, n, true, true); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}
function radialTex(size = 64) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function atlasMaterial(atlas) {
  const m = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, toneMapped: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aCell;\n' + sh.vertexShader.replace('#include <uv_vertex>',
      '#include <uv_vertex>\n  vMapUv = (uv + vec2(mod(aCell, 16.0), 15.0 - floor(aCell / 16.0))) / 16.0;');
  };
  return m;
}

export async function L20Scene(canvas) {
  if (document.fonts && document.fonts.load) {
    await Promise.race([Promise.all([document.fonts.load('900 64px Outfit'), document.fonts.load('900 17px Outfit')]), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#060411');
  const GLOW = radialTex();
  const additive = (opts) => new THREE.MeshBasicMaterial(Object.assign({ map: GLOW, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }, opts));

  // environment for the metals: a tiny studio of glowing panels (computed once)
  {
    const env = new THREE.Scene(); env.background = new THREE.Color('#0b0620');
    const panel = (c, w, h, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; env.add(m); };
    panel('#ffffff', 6, 2, 0, 6, 2); panel('#c084fc', 4, 8, -7, 1, 0, Math.PI / 2); panel('#ffcf6b', 4, 8, 7, 1, 0, -Math.PI / 2);
    panel('#6d28d9', 16, 4, 0, -5, 0); panel('#ffe2a8', 10, 1.2, 0, 3, -7);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.02).texture;
    pm.dispose();
  }

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 400);

  // ---- studio: backdrop, light fins, bokeh, floor, pillars
  {
    const bd = new THREE.Mesh(new THREE.PlaneGeometry(220, 120), new THREE.ShaderMaterial({
      depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `varying vec2 vUv;
        void main(){
          vec2 p = (vUv - vec2(0.5)) * vec2(220., 120.) + vec2(0., 6.);
          vec3 c = vec3(0.022, 0.014, 0.060);
          float r = length(p * vec2(0.55, 0.8));
          c += vec3(0.24, 0.08, 0.46) * exp(-r * r / 260.) * 0.75;
          c += vec3(0.30, 0.17, 0.05) * exp(-pow(length(p - vec2(0., 22.)), 2.) / 300.) * 0.35;
          float slat = smoothstep(0.46, 0.5, abs(fract(p.x * 0.5) - 0.5)) * exp(-r * r / 900.) * 0.05;
          c += vec3(0.6, 0.35, 1.0) * slat;
          gl_FragColor = vec4(c, 1.);
        }`,
    }));
    bd.position.set(0, 6, -40); scene.add(bd);
    // light fins
    const finTex = (() => {
      const cv = document.createElement('canvas'); cv.width = 32; cv.height = 256; const g = cv.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.45, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 256);
      const hx = g.createLinearGradient(0, 0, 32, 0); hx.addColorStop(0, 'rgba(0,0,0,1)'); hx.addColorStop(0.5, 'rgba(0,0,0,0)'); hx.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = hx; g.fillRect(0, 0, 32, 256);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const fins = [[-15, '#a855f7', 0.55], [-19.5, '#ffbb60', 0.35], [-24, '#7c3aed', 0.4], [15, '#a855f7', 0.55], [19.5, '#ffbb60', 0.35], [24, '#7c3aed', 0.4], [-30, '#a855f7', 0.3], [30, '#a855f7', 0.3]];
    const finMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 34), additive({ map: finTex }), fins.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    fins.forEach(([x, c, o], i) => { m4.makeTranslation(x, 3, -22); finMesh.setMatrixAt(i, m4); finMesh.setColorAt(i, col.set(c).multiplyScalar(o)); });
    scene.add(finMesh);
    // bokeh
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dots = [];
    for (let i = 0; i < 60 && dots.length < 40; i++) {
      const c = rnd() < 0.6 ? '#a855f7' : '#ffcf6b', o = 0.1 + rnd() * 0.16, x = (rnd() - 0.5) * 90, y = -8 + rnd() * 34, z = -30 + rnd() * 6, s = 1 + rnd() * 2.6;
      if (Math.abs(x) < 9 && y < 8) continue;
      dots.push([x, y, z, s, c, o]);
    }
    const bok = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), additive({}), dots.length);
    dots.forEach(([x, y, z, s, c, o], i) => { m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, s, 1)); bok.setMatrixAt(i, m4); bok.setColorAt(i, col.set(c).multiplyScalar(o)); });
    scene.add(bok);
    // floor + glow pool
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), new THREE.MeshBasicMaterial({ color: '#0a0618' }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -BH / 2 - 1.6; scene.add(floor);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), additive({ color: new THREE.Color('#7c3aed').multiplyScalar(0.55) }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, floor.position.y + 0.02, 1.5); scene.add(pool);
    // pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#120a24', metalness: 0.8, roughness: 0.3 });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcf6b', metalness: 1, roughness: 0.25 });
    for (const sx of [-1, 1]) {
      const x = sx * (BW / 2 + 5.2);
      const colm = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 26, 32), pillarMat); colm.position.set(x, 4, -4); scene.add(colm);
      for (const yy of [-BH / 2 - 1.2, 10]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.09, 10, 40), goldMat); rim.rotation.x = Math.PI / 2; rim.position.set(x, yy, -4); scene.add(rim);
      }
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 15, 0.1), new THREE.MeshBasicMaterial({ color: '#c084fc', toneMapped: false })); strip.position.set(x - sx * 0.2, 1.5, -3.06); scene.add(strip);
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 17), additive({ color: new THREE.Color('#a855f7').multiplyScalar(0.5) })); sg.position.set(x - sx * 0.2, 1.5, -3); scene.add(sg);
    }
  }
  scene.add(new THREE.HemisphereLight('#cbb6ff', '#140a2a', 0.5));
  { const k = new THREE.DirectionalLight('#ffffff', 1.4); k.position.set(4, 9, 12); scene.add(k); }
  { const r = new THREE.PointLight('#a855f7', 40, 40); r.position.set(-10, 2, 6); scene.add(r); }
  { const r = new THREE.PointLight('#ffbb60', 22, 40); r.position.set(10, 7, 4); scene.add(r); }

  // ---- board cabinet
  const board = new THREE.Group(); board.rotation.x = -0.05; scene.add(board);
  const stripMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 2 * TILE + GAP - 0.1, 0.06), new THREE.MeshBasicMaterial({ toneMapped: false }), 8);
  const stripGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, (2 * TILE + GAP) * 1.1), additive({}), 8);
  const stripLevel = [1, 1, 1, 1];
  {
    const back = new THREE.Mesh(new THREE.ExtrudeGeometry(rrShape(BW, BH, 0.55), { depth: 0.5, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 3, curveSegments: 10 }),
      new THREE.MeshStandardMaterial({ color: '#150d2a', metalness: 0.75, roughness: 0.34 }));
    back.position.z = -0.75; board.add(back);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(GW + 0.34, GH + 0.34), new THREE.MeshStandardMaterial({ color: '#07040f', metalness: 0.2, roughness: 0.8 }));
    inner.position.z = -0.12; board.add(inner);
    const ring = rrShape(GW + 0.62, GH + 0.62, 0.36); ring.holes.push(rrShape(GW + 0.34, GH + 0.34, 0.24));
    const trim = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 8 }),
      new THREE.MeshStandardMaterial({ color: '#ffcf6b', metalness: 1, roughness: 0.26 }));
    trim.position.z = -0.14; board.add(trim);
    const curve = new THREE.CatmullRomCurve3(rrShape(BW + 0.16, BH + 0.16, 0.62).getPoints(24).map((p) => new THREE.Vector3(p.x, p.y, -0.1)), true);
    board.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 220, 0.055, 6, true), new THREE.MeshBasicMaterial({ color: '#d8b4fe', toneMapped: false })));
    board.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 220, 0.2, 6, true), new THREE.MeshBasicMaterial({ color: '#a855f7', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    const m4 = new THREE.Matrix4();
    for (let s = 0; s < 4; s++) {
      const h = 2 * TILE + GAP, yTop = GH / 2 - s * 2 * (TILE + GAP);
      [-1, 1].forEach((sx, k) => {
        m4.makeTranslation(sx * (GW / 2 + 0.43), yTop - h / 2, 0.02); stripMesh.setMatrixAt(s * 2 + k, m4);
        m4.makeTranslation(sx * (GW / 2 + 0.43), yTop - h / 2, 0.07); stripGlow.setMatrixAt(s * 2 + k, m4);
      });
    }
    board.add(stripMesh, stripGlow);
    const div = new THREE.Mesh(new THREE.BoxGeometry(GW + 0.2, 0.035, 0.04), new THREE.MeshBasicMaterial({ color: '#ffe2a8', toneMapped: false }));
    div.position.z = 0.06; board.add(div);
    // NEXORNG wordmark plate (the real logo2.webp, cropped to the wordmark)
    const plateShape = rrShape(3.3, 0.78, 0.39);
    const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(plateShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2 }),
      new THREE.MeshStandardMaterial({ color: '#0b0618', metalness: 0.6, roughness: 0.3 }));
    plate.position.set(0, -BH / 2 + 0.02, 0); board.add(plate);
    const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(plateShape.getPoints(20).map((p) => new THREE.Vector3(p.x, p.y, 0.17)), true), 100, 0.025, 6, true),
      new THREE.MeshStandardMaterial({ color: '#ffcf6b', metalness: 1, roughness: 0.25 }));
    rim.position.copy(plate.position); board.add(rim);
    const wm = new THREE.TextureLoader().load(new URL('../../logo2.webp', import.meta.url).href, () => requestRender());
    wm.colorSpace = THREE.SRGBColorSpace; wm.repeat.set(0.84, 0.19); wm.offset.set(0.08, 1 - 0.585);
    const wmMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8 * (0.19 / 0.84)), new THREE.MeshBasicMaterial({ map: wm, transparent: true, toneMapped: false }));
    wmMesh.position.set(0, plate.position.y, 0.19); board.add(wmMesh);
  }

  // ---- tiles: instanced body + front (unlit) + back (lit) faces + glow
  const atlas = buildAtlas();
  const body = new THREE.ExtrudeGeometry(rrShape(TILE * 0.96, TILE * 0.96, 0.14), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 5 });
  body.translate(0, 0, -0.06);
  const bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: '#1a1130', metalness: 0.5, roughness: 0.4 }), 80);
  const faceMat = atlasMaterial(atlas);
  const mkFaces = () => {
    const geo = new THREE.PlaneGeometry(TILE * 0.985, TILE * 0.985);
    const cells = new THREE.InstancedBufferAttribute(new Float32Array(80), 1);
    geo.setAttribute('aCell', cells);
    return [new THREE.InstancedMesh(geo, faceMat, 80), cells];
  };
  const [fronts, frontCells] = mkFaces();
  const [backs, backCells] = mkFaces();
  const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), additive({}), 80);
  glows.renderOrder = 1;
  for (let i = 0; i < 80; i++) { frontCells.array[i] = i; backCells.array[i] = 80 + i; }
  board.add(bodies, fronts, backs, glows);
  [bodies, fronts, backs, glows].forEach((m) => { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; });

  const T = []; // per tile state
  for (let n = 1; n <= 80; n++) {
    const r = Math.floor((n - 1) / COLS), c = (n - 1) % COLS;
    T.push({ n, x: -GW / 2 + TILE / 2 + c * (TILE + GAP), y: GH / 2 - TILE / 2 - r * (TILE + GAP), flip: 0, lift: 0, glow: 0, sect: sectOf(n) });
  }
  // latest-ball light frame + first-ball gold ring
  const frameCurve = new THREE.CatmullRomCurve3(rrShape(TILE * 1.12, TILE * 1.12, 0.2).getPoints(10).map((p) => new THREE.Vector3(p.x, p.y, 0)), true);
  const frame = new THREE.Mesh(new THREE.TubeGeometry(frameCurve, 80, 0.035, 6, true), new THREE.MeshBasicMaterial({ color: '#fff1c9', transparent: true, opacity: 0, toneMapped: false }));
  const frameGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.9), additive({ color: new THREE.Color('#fff1c9'), opacity: 0 }));
  const firstRing = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.035, 8, 48), new THREE.MeshBasicMaterial({ color: '#ffcf6b', transparent: true, opacity: 0, toneMapped: false }));
  frame.visible = frameGlow.visible = firstRing.visible = false;
  board.add(frameGlow, frame, firstRing);
  let latest = 0, firstBall = 0;
  const fx = { frame: 0, ring: 0 };

  const m4 = new THREE.Matrix4(), mf = new THREE.Matrix4(), mb = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const vp = new THREE.Vector3(), vs = new THREE.Vector3(), col = new THREE.Color();
  const FRONT = new THREE.Matrix4().makeTranslation(0, 0, 0.1);
  const BACK = new THREE.Matrix4().makeTranslation(0, 0, -0.1).multiply(new THREE.Matrix4().makeRotationX(Math.PI));
  function writeTile(t) {
    const i = t.n - 1, s = 1 + 0.16 * t.lift;
    e.set(-Math.PI * t.flip, 0, 0); q.setFromEuler(e);
    vp.set(t.x, t.y, 0.5 * t.lift); vs.set(s, s, s);
    m4.compose(vp, q, vs);
    bodies.setMatrixAt(i, m4);
    fronts.setMatrixAt(i, mf.multiplyMatrices(m4, FRONT));
    backs.setMatrixAt(i, mb.multiplyMatrices(m4, BACK));
    const gs = 2.1 * (0.6 + 0.4 * t.glow) * (t.glow > 0.001 ? 1 : 0);
    m4.compose(vp.set(t.x, t.y, -0.05 + 0.5 * t.lift), q.identity(), vs.set(gs, gs, 1));
    glows.setMatrixAt(i, m4);
    glows.setColorAt(i, col.set(SECT[t.sect].c).multiplyScalar(0.5 * t.glow));
  }
  function writeStrips() {
    for (let s = 0; s < 4; s++) for (let k = 0; k < 2; k++) {
      stripMesh.setColorAt(s * 2 + k, col.set(SECT[s].c).multiplyScalar(0.55 + 0.45 * stripLevel[s]));
      stripGlow.setColorAt(s * 2 + k, col.set(SECT[s].c).multiplyScalar(0.55 * stripLevel[s] * stripLevel[s]));
    }
    stripMesh.instanceColor.needsUpdate = stripGlow.instanceColor.needsUpdate = true;
  }
  function writeFx() {
    const t = latest ? T[latest - 1] : null;
    frame.visible = frameGlow.visible = !!t && fx.frame > 0.01;
    if (t) {
      const s = 1 + 0.16 * t.lift;
      frame.position.set(t.x, t.y, 0.5 * t.lift + 0.2); frame.scale.setScalar(s);
      frameGlow.position.set(t.x, t.y, 0.5 * t.lift - 0.1);
      frame.material.opacity = fx.frame; frameGlow.material.opacity = 0.75 * fx.frame;
    }
    const f = firstBall ? T[firstBall - 1] : null;
    firstRing.visible = !!f && fx.ring > 0.01;
    if (f) { firstRing.position.set(f.x, f.y, 0.5 * f.lift + 0.16); firstRing.material.opacity = fx.ring; }
  }
  function writeAll() {
    T.forEach(writeTile);
    [bodies, fronts, backs, glows].forEach((m) => { m.instanceMatrix.needsUpdate = true; });
    glows.instanceColor.needsUpdate = true;
    frontCells.needsUpdate = backCells.needsUpdate = true;
    writeStrips(); writeFx();
  }
  writeAll();

  // ---- tweens + render on demand
  const tweens = [];
  function tween(obj, key, to, dur, delay = 0, fn = ease.io, onDone) {
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].obj === obj && tweens[i].key === key) tweens.splice(i, 1);
    tweens.push({ obj, key, from: obj[key], to, dur, t0: performance.now() + delay, fn, onDone });
    requestRender();
  }
  let raf = 0, dirty = false;
  const stats = { frames: 0, renderMs: 0, updateMs: 0, jsMs: [], calls: 0 }; // jsMs: per-frame main-thread cost (QA)
  function requestRender() { dirty = true; if (!raf) raf = requestAnimationFrame(frameFn); }
  function frameFn(now) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const f0 = performance.now();
    let tilesMoved = false, stripsMoved = false;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      if (now < tw.t0) { dirty = true; continue; }
      const p = Math.min(1, (now - tw.t0) / tw.dur);
      tw.obj[tw.key] = tw.from + (tw.to - tw.from) * tw.fn(p);
      if (tw.obj.n) tilesMoved = true; else if (tw.obj === stripLevel) stripsMoved = true;
      if (p >= 1) { tweens.splice(i, 1); if (tw.onDone) tw.onDone(); }
    }
    if (tilesMoved) {
      T.forEach(writeTile);
      [bodies, fronts, backs, glows].forEach((m) => { m.instanceMatrix.needsUpdate = true; });
      glows.instanceColor.needsUpdate = true;
    }
    if (stripsMoved) writeStrips();
    writeFx();
    const t0 = performance.now();
    stats.updateMs = t0 - f0;
    renderer.render(scene, camera);
    stats.renderMs = performance.now() - t0; stats.frames++; stats.calls = renderer.info.render.calls;
    if (stats.jsMs.length >= 600) stats.jsMs.shift();
    stats.jsMs.push(performance.now() - f0);
    dirty = false;
    if (tweens.length) raf = requestAnimationFrame(frameFn);
  }

  // ---- layout: the board fills { cx, cy, w } (CSS px) of the canvas
  let W = 1, H = 1, rect = { cx: 0.5, cy: 0.5, w: 1 }, centres = [];
  function resize(cssW, cssH, r) {
    W = Math.max(1, cssW); H = Math.max(1, cssH); rect = r;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cssW < 900 ? 2 : 1.5));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const pxPerUnit = r.w / BW;
    const D = H / (pxPerUnit * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.position.set(0, -0.9, D); camera.lookAt(0, 0, 0);
    camera.setViewOffset(W, H, W / 2 - r.cx, H / 2 - r.cy, W, H);
    camera.updateProjectionMatrix();
    board.updateMatrixWorld(true);
    centres = T.map((t) => project(t.x, t.y, 0.1));
    dirty = true; frameFn(performance.now());
  }
  const pv = new THREE.Vector3();
  function project(x, y, z) {
    pv.set(x, y, z).applyMatrix4(board.matrixWorld).project(camera);
    return { x: (pv.x + 1) / 2 * W, y: (1 - pv.y) / 2 * H };
  }

  // ---- state changes
  function setDrawn(balls, opts = {}) {
    tweens.length = 0;
    drawnNow.clear(); balls.forEach((n) => drawnNow.add(n));
    T.forEach((t) => { t.flip = 0; t.lift = 0; t.glow = 0; backCells.array[t.n - 1] = 80 + t.n - 1; });
    balls.forEach((n) => { const t = T[n - 1]; t.flip = 1; t.glow = 1; });
    firstBall = balls[0] || 0;
    if (firstBall) backCells.array[firstBall - 1] = 160 + firstBall - 1;
    latest = opts.latest ? balls[balls.length - 1] || 0 : 0;
    if (latest) T[latest - 1].lift = 0.7;
    fx.frame = latest ? 1 : 0;
    fx.ring = opts.complete && firstBall ? 1 : 0;
    const lead = opts.leader == null ? -1 : opts.leader;
    for (let s = 0; s < 4; s++) stripLevel[s] = lead < 0 ? 1 : s === lead ? 1.8 : 0.6;
    writeAll(); requestRender();
  }
  const drawnNow = new Set(); // balls drawn this round (a draw is animated once)
  function draw(n, index) {
    const t = T[n - 1];
    if (!t || drawnNow.has(n)) return;
    drawnNow.add(n);
    if (index === 0) { firstBall = n; backCells.array[n - 1] = 160 + n - 1; backCells.needsUpdate = true; }
    if (latest && latest !== n) tween(T[latest - 1], 'lift', 0, 260, 0, ease.out);
    latest = n;
    fx.frame = 0; tween(fx, 'frame', 1, 220, 60, ease.out);
    tween(t, 'lift', 0.7, 300, 0, ease.out);
    tween(t, 'flip', 1, 340, 20, ease.io);
    tween(t, 'glow', 1, 260, 200, ease.out);
  }
  function result(o) {
    const balls = (o && o.balls) || [];
    if (latest) tween(T[latest - 1], 'lift', 0, 300, 0, ease.out);
    tween(fx, 'frame', 0, 300, 0, ease.out);
    firstBall = balls[0] || firstBall;
    if (firstBall) { backCells.array[firstBall - 1] = 160 + firstBall - 1; backCells.needsUpdate = true; tween(T[firstBall - 1], 'lift', 0.35, 420, 120, ease.out); }
    tween(fx, 'ring', 1, 500, 150, ease.out);
    const lead = o && o.leader != null ? o.leader : -1;
    for (let s = 0; s < 4; s++) tween(stripLevel, s, lead < 0 ? 1 : s === lead ? 1.8 : 0.6, 600, 100, ease.out);
  }
  function reset() {
    drawnNow.clear();
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].obj.n) tweens.splice(i, 1); // no tile keeps a pending flip
    tween(fx, 'frame', 0, 200, 0, ease.out);
    tween(fx, 'ring', 0, 300, 0, ease.out);
    for (let s = 0; s < 4; s++) tween(stripLevel, s, 1, 500, 0, ease.out);
    let k = 0;
    T.forEach((t) => {
      if (t.flip < 0.001 && t.lift < 0.001 && t.glow < 0.001) return;
      const d = ((t.n - 1) % COLS) * 26 + Math.floor((t.n - 1) / COLS) * 34; // a soft diagonal wave
      tween(t, 'lift', 0, 260, d, ease.out);
      tween(t, 'glow', 0, 220, d, ease.out);
      tween(t, 'flip', 0, 380, d, ease.io, () => { if (backCells.array[t.n - 1] >= 160) { backCells.array[t.n - 1] = 80 + t.n - 1; backCells.needsUpdate = true; } });
      k++;
    });
    latest = 0;
    setTimeout(() => { if (!drawnNow.size) firstBall = 0; }, 400);
    return k;
  }
  function pick(x, y) {
    if (!centres.length) return 0;
    const a = centres[0], b = centres[1], c = centres[COLS];
    const half = Math.min(Math.abs(b.x - a.x), Math.abs(c.y - a.y)) * 0.55;
    let best = 0, bd = half * half;
    centres.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = i + 1; } });
    return best;
  }
  function tilePoint(n, corner) {
    const t = T[n - 1];
    return corner ? project(t.x + 0.36, t.y + 0.36, 0.2) : centres[n - 1];
  }
  function tileSize() { return centres.length ? Math.abs(centres[1].x - centres[0].x) : 0; }

  return { resize, setDrawn, draw, result, reset, pick, tilePoint, tileSize, requestRender, stats, topColor: '#0b0620', frame: frameFn };
}
