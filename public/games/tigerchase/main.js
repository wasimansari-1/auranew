/* Tiger Chase 3D — renderer, scene assembly and the per-frame picture as a pure function of
 * (round time τ, crash time τc, wall clock for the idle life / wind / water). scene.js (classic script) loads
 * this module and forwards app.js's calls to it. The animals move with their Meshy clips, each shown at the
 * second the round clock says (the run in step with the prints; in the catch: the pounce, the landing, the
 * stand and the roar for the tiger, the knock-down for the stag — timeline.catchClips). */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { U, withFog, makeNoise } from './common.js';
import { loadAnimal } from './models.js';
import { buildSky, makeHeightTex, buildGround, buildGrass, buildFlora, buildWater, buildPuffs, buildShafts, buildStones } from './world.js';
import { setRound, tigerAt, stagAt, cameraAt, skyAt, puffsAt, setView, newPose, endPlan, catchClips, PL, S5, clamp, D2R, V as VMAX, T_T, groundAt, wrapX } from './timeline.js';

const QS = new URLSearchParams(location.search);
const BASE = new URL('./', import.meta.url).href;
const WHITE = new THREE.Color(1, 1, 1);

export async function createScene(canvas) {
  const QA = QS.has('qa');
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  // The quality ladder, richest first. Sharpness (the pixel ratio) is the LAST thing given up: first the grass
  // density (wider blades fill in) and the dust, then the pixel ratio (phones keep ≥ 1.5 unless truly struggling).
  const DEV = window.devicePixelRatio || 1, phone = coarse;
  const GRASS = phone ? 30000 : 46000;
  const R = [];
  const full = { grass: 1, wide: 1, puffs: 48, shafts: true, plants: 1 }, mid = { grass: 0.62, wide: 1.3, puffs: 40, shafts: true, plants: 0.7 }, lean = { grass: 0.36, wide: 1.75, puffs: 34, shafts: false, plants: 0.4 };
  if (phone && DEV >= 2.75) R.push({ ...full, pr: 2.5, up: true });       // high-end phones, only when frames allow
  R.push({ ...full, pr: Math.min(DEV, 2) });                              // the default (phones: DPR 2)
  R.push({ ...mid, pr: Math.min(DEV, 2) });
  R.push({ ...lean, pr: Math.min(DEV, 2) });
  R.push({ ...lean, pr: Math.min(DEV, 1.75) });
  R.push({ ...lean, pr: Math.min(DEV, 1.5) });                             // the phone floor
  R.push({ ...lean, pr: Math.min(DEV, 1.25), hard: true });                // only when truly struggling
  R.push({ ...lean, pr: 1, hard: true });
  for (let i = R.length - 1; i > 0; i--) if (R[i].pr === R[i - 1].pr && R[i].grass === R[i - 1].grass) R.splice(i, 1);
  const DEFAULT = R.findIndex((r) => !r.up);
  let rung = DEFAULT;
  if (QS.has('q')) { const q = clamp(+QS.get('q') || 0, 0, 2); rung = q === 2 ? DEFAULT : q === 1 ? R.findIndex((r) => r.grass < 0.5 && r.pr === R[DEFAULT].pr) : R.findIndex((r) => r.grass < 0.5 && r.pr <= 1.5); if (rung < 0) rung = R.length - 1; }
  let tier = rung;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: QA });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xc8b7a5, 1);
  const MAXA = renderer.capabilities.getMaxAnisotropy();

  U.uNoise.value = makeNoise(renderer);
  U.uHT.value = makeHeightTex();
  const texLoader = new THREE.TextureLoader();
  const loadTex = (f) => new Promise((res) => texLoader.load(BASE + 'assets/' + f, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAXA; res(t); }, undefined, () => res(U.uNoise.value)));
  const [grassTex, litter, rock, nx, flora, plate] = await Promise.all([loadTex('tex-grass.webp'), loadTex('tex-litter.webp'), loadTex('tex-rock.webp'), loadTex('brand-nx.webp'), loadTex('flora.webp'), loadTex('horizon.webp')]);
  nx.wrapS = nx.wrapT = THREE.ClampToEdgeWrapping;
  flora.wrapS = flora.wrapT = THREE.ClampToEdgeWrapping; flora.anisotropy = Math.min(4, MAXA);
  plate.wrapT = THREE.ClampToEdgeWrapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.25, 1400);
  const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5); scene.add(hemi);

  const sky = buildSky(plate); scene.add(sky);
  const ground = buildGround({ grass: grassTex, litter, rock }); scene.add(ground.main);
  const plants = buildFlora({ flora }, !phone); scene.add(plants.main);
  const stones = buildStones(nx, withFog); scene.add(stones.main);
  // the ridge tile, three times (it follows the camera in steps of P)
  const tiles = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    g.add(i ? ground.tile.clone() : ground.tile, i ? plants.tile.clone() : plants.tile, i ? stones.tile.clone() : stones.tile);
    g.traverse((o) => { o.frustumCulled = false; });
    scene.add(g); tiles.push(g);
  }
  const water = buildWater(); scene.add(water);
  const grass = buildGrass(GRASS); scene.add(grass);
  const shafts = buildShafts(); scene.add(shafts);
  const MAXP = 48, puffs = buildPuffs(MAXP); scene.add(puffs);
  const [tiger, stag] = await Promise.all([
    loadAnimal(BASE + 'assets/tiger.glb', { scale: 1.0, foot: 0.55, layer: 1, withFog }),
    loadAnimal(BASE + 'assets/stag.glb', { scale: 0.86, foot: 0.95, layer: 2, withFog, levelBones: ['neck_01', 'neck_02', 'neck1', 'neck2', 'head'] }),
  ]);
  scene.add(tiger, stag);

  // ------------------------------------------------------------ the animals' shadows: their silhouettes from the sun
  const shRT = new THREE.WebGLRenderTarget(512, 256, { depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  shRT.scissorTest = true;
  const shCam = new THREE.OrthographicCamera(-2.4, 2.4, 2.4, -2.4, 1, 80);
  const shMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  U.uShadow.value = shRT.texture;
  const v3 = new THREE.Vector3();
  function shadowPass() {
    const ov = scene.overrideMaterial, prevTone = renderer.toneMapping;
    scene.overrideMaterial = shMat; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    for (let i = 0; i < 2; i++) {
      const P = i ? PS : PT, off = i ? 0.15 : 0.2;
      v3.set(P.x + Math.cos(P.psi) * off, P.gy + 0.55, P.z + Math.sin(P.psi) * off);
      shCam.position.copy(v3).addScaledVector(U.uSunDir.value, 30); shCam.up.set(0, 1, 0); shCam.lookAt(v3);
      shCam.updateMatrixWorld(); shCam.layers.set(i + 1);
      (i ? U.uShB : U.uShA).value.multiplyMatrices(shCam.projectionMatrix, shCam.matrixWorldInverse);
      shRT.viewport.set(i * 256, 0, 256, 256); shRT.scissor.set(i * 256, 0, 256, 256);
      renderer.setRenderTarget(shRT); renderer.clear();
      renderer.render(scene, shCam);
    }
    renderer.setRenderTarget(null); renderer.setClearColor(0xc8b7a5, 1);
    scene.overrideMaterial = ov; renderer.toneMapping = prevTone;
  }

  // ------------------------------------------------------------ layout (play area → camera lens shift)
  let V = { W: 400, H: 400, TOP: 0, LEFT: 0, FULL_W: 400, FULL_H: 400, dpr: 1 }, bufRatio = 1, focal = 500;
  function resize(v) {
    if (v) V = v;
    const pr = QS.has('pr') ? clamp(+QS.get('pr') || 1, 0.5, 3) : R[rung].pr;
    const cw = Math.max(1, V.FULL_W), ch = Math.max(1, V.FULL_H);
    const bw = Math.max(1, Math.round(cw * pr)), bh = Math.max(1, Math.round(ch * pr));
    const cv = renderer.domElement; // same size: leave the canvas alone — sizing it clears it (a blink), and this runs every time a player joins
    if (cv.width !== bw || cv.height !== bh) { renderer.setPixelRatio(1); renderer.setSize(bw, bh, false); }
    bufRatio = bw / cw;
    const pw = Math.max(50, V.W), ph = Math.max(50, V.H), portrait = pw / ph < 1.15;
    const cx = V.LEFT + pw / 2, cy = V.TOP + ph * (portrait ? 0.66 : 0.64);
    const tanV = Math.max(Math.tan(12.5 * D2R), Math.tan(23.5 * D2R) * ph / pw);
    focal = (ph / 2) / tanV;
    setView((pw / 2) / focal, portrait);
    const Wv = 2 * Math.max(cx, V.FULL_W - cx), Hv = 2 * Math.max(cy, V.FULL_H - cy);
    camera.fov = 2 * Math.atan((Hv / 2) / focal) / D2R;
    camera.aspect = Wv / Hv;
    camera.setViewOffset(Wv, Hv, Wv / 2 - cx, Hv / 2 - cy, V.FULL_W, V.FULL_H);
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ one picture
  const PT = newPose(), PS = newPose(), CAM = {}, SKY = {};
  function setSunDir(out, el, az) { const ce = Math.cos(el * D2R); return out.set(ce * Math.cos(az * D2R), Math.sin(el * D2R), ce * Math.sin(az * D2R)); }
  // ------------------------------------------------------------ the animals: where they are + which movement clips show
  const TL = [], SL = [], HALF_PI = Math.PI / 2;
  const clip = (L, i, name, time, weight, once) => { const e = L[i] || (L[i] = [name, 0, 0, false]); e[0] = name; e[1] = time; e[2] = weight; e[3] = !!once; };
  function poseAnimals(tau, wall) {
    const T = tiger.userData, D = stag.userData, u = PT.u;
    const C = u >= 0 ? catchClips(u) : null;
    // the tiger: flat in the grass → the burst → the gallop (in step with its stride) → [the catch] the pounce,
    // the landing, standing over the stag, the roar
    const tg = PT.go, run = tg * (C ? C.run : 1);
    clip(TL, 0, 'leopard_cower', 0.9 + 0.25 * Math.sin(wall * 0.9), 1 - tg);
    clip(TL, 1, 'leopard_run_fight_forward', PT.phase * T.dur('leopard_run_fight_forward'), run);
    clip(TL, 2, 'leopard_jump_start', C ? C.jumpStartT : 0, C ? C.jumpStart : 0, true);
    clip(TL, 3, 'leopard_jump_end', C ? C.landT : 0, C ? C.land : 0, true);
    clip(TL, 4, 'leopard_idle_fight', wall, C ? C.stand : 0);
    clip(TL, 5, 'leopard_roar_skyward_loop', C ? C.roarT : 0, C ? C.roar : 0);
    clip(TL, 6, 'leopard_roar_skyward_end', C ? C.roarEndT : 0, C ? C.roarEnd : 0, true);
    T.set(TL);
    tiger.position.set(PT.x, PT.gy + PT.lift, PT.z); tiger.rotation.y = HALF_PI - PT.psi;
    T.tilt.rotation.x = -PT.pitch * 0.6 * run;
    // the stag: grazing → head up, alert → the bolt → the run (in step with its stride) → [the catch] knocked down
    const sg = PS.go, al = PS.alert * (1 - sg), fall = C ? C.fall : 0;
    clip(SL, 0, 'fawn_idle01', wall, (1 - PS.alert) * (1 - sg));
    clip(SL, 1, 'deer_idle', wall, al);
    clip(SL, 2, 'deer_run', PS.phase * D.dur('deer_run'), sg * (1 - fall));
    clip(SL, 3, 'leopard_dead', C ? C.fallT : 0, fall, true);
    D.set(SL, null, 0.8 * sg * (1 - fall));                       // running: the neck up, the head level, the face forward
    stag.position.set(PS.x, PS.gy, PS.z); stag.rotation.y = HALF_PI - PS.psi;
    D.tilt.rotation.x = -PS.pitch * 0.5 * sg * (1 - fall);
  }

  // st: { tau, tc (or null), wall (s) }
  function draw(st) {
    const tau = st.tau, tc = st.tc, wall = st.wall;
    U.uTime.value = wall;
    setRound(tau, tc);
    tigerAt(tau, wall, PT); stagAt(tau, wall, PS);
    poseAnimals(tau, wall);
    cameraAt(tau, tc, wall, CAM);
    camera.position.set(CAM.x, CAM.y, CAM.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(CAM.ax, CAM.ay, CAM.az);
    if (QA && st.cam) { // QA close-ups: a camera relative to one animal (world axes), or free
      const P = st.cam.who === 'stag' ? PS : st.cam.who === 'tiger' ? PT : null, ox = P ? P.x : 0, oy = P ? P.gy : 0, oz = P ? P.z : 0;
      camera.position.set(ox + st.cam.pos[0], oy + st.cam.pos[1], oz + st.cam.pos[2]);
      camera.lookAt(ox + st.cam.target[0], oy + st.cam.target[1], oz + st.cam.target[2]);
      if (st.cam.fov) { camera.clearViewOffset(); camera.fov = st.cam.fov; camera.aspect = V.FULL_W / V.FULL_H; camera.updateProjectionMatrix(); } // (the lobby pictures: a longer lens)
    }
    camera.updateMatrixWorld();
    // the light
    skyAt(tau, SKY);
    setSunDir(U.uSunDir.value, SKY.el, SKY.az);
    U.uZenith.value.fromArray(SKY.zen); U.uHorizon.value.fromArray(SKY.hor); U.uGlow.value.fromArray(SKY.glow);
    U.uGround.value.fromArray(SKY.ground); U.uFogSun.value.fromArray(SKY.fogSun); U.uWarm.value = SKY.warm;
    U.uFogDen.value = 0.0036 * SKY.haze;
    renderer.toneMappingExposure = SKY.exp;
    sun.color.fromArray(SKY.sun); sun.intensity = SKY.sunI;
    v3.set(CAM.fx, 0, CAM.fz);
    sun.position.copy(v3).addScaledVector(U.uSunDir.value, 100); sun.target.position.copy(v3);
    hemi.color.fromArray(SKY.hs); hemi.groundColor.fromArray(SKY.hg); hemi.intensity = 1.7;
    U.uSunCol.value.fromArray(SKY.sun).multiplyScalar(SKY.sunI / Math.PI);
    U.uAmbSky.value.fromArray(SKY.hs).multiplyScalar(1.7 / Math.PI); U.uAmbGnd.value.fromArray(SKY.hg).multiplyScalar(1.7 / Math.PI);
    // the world round the camera
    const K = Math.max(0, Math.floor((CAM.fx - PL.XR) / PL.P) - 1);
    for (let i = 0; i < 3; i++) tiles[i].position.x = (K + i) * PL.P;
    const far = CAM.fx > PL.XR + PL.P + 40;
    ground.main.visible = plants.main.visible = stones.main.visible = water.visible = !far;
    shafts.visible = R[rung].shafts && CAM.fx > 70 && CAM.fx < 230;
    sky.position.copy(camera.position);
    grass.material.uniforms.uCenter.value.set(CAM.fx + 0.34 * (CAM.x - CAM.fx) + 5, CAM.fz + 0.34 * (CAM.z - CAM.fz) - 3);
    U.uAnimA.value.set(PT.x, PT.z, Math.cos(PT.psi), Math.sin(PT.psi)); U.uAnimB.value.set(PS.x, PS.z, Math.cos(PS.psi), Math.sin(PS.psi));
    U.uAnimS.value.set(clamp(PT.speed / VMAX, 0, 1), clamp(PS.speed / VMAX, 0, 1), 1 - S5(T_T - 0.1, T_T + 0.4, tau), 0);
    U.uPlateK.value.set(CAM.fx / 2600, S5(232, 262, wrapX(CAM.fx)), 1.25, 0);
    puffs.geometry.instanceCount = Math.min(R[rung].puffs, puffsAt(tau, puffs.userData.data, MAXP));
    puffs.userData.buf.needsUpdate = true;
    shadowPass();
    renderer.render(scene, camera);
    if (QA && st.cam && st.cam.fov) resize();
  }
  // where the "Safe" tag goes: above the pair, in stage px
  function anchor(out) {
    v3.set(CAM.fx, CAM.ay + 1.55, CAM.fz).project(camera);
    out.x = (v3.x * 0.5 + 0.5) * V.FULL_W; out.y = (1 - (v3.y * 0.5 + 0.5)) * V.FULL_H;
    return out;
  }

  // ------------------------------------------------------------ warm-up: compile every shader, first frames
  resize();
  if (renderer.compileAsync) { try { await renderer.compileAsync(scene, camera); } catch (err) { renderer.compile(scene, camera); } } else renderer.compile(scene, camera);
  draw({ tau: 16.3, tc: 15.2, wall: 0 });   // the river + the catch's cloud + dust
  draw({ tau: 9, tc: null, wall: 0 });      // the forest
  draw({ tau: -5, tc: null, wall: 0 });

  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); }, false);
  canvas.addEventListener('webglcontextrestored', () => { U.uNoise.value = makeNoise(renderer); }, false);

  // ------------------------------------------------------------ the top colour (browser bar)
  function topColor() {
    if (!SKY.zen) return '#c8b7a5';
    const k = 0.75, ex = renderer.toneMappingExposure;
    const c = [0, 1, 2].map((i) => {
      let x = (SKY.hor[i] + (SKY.zen[i] - SKY.hor[i]) * k) * ex / 0.6;
      x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
      x = Math.max(0, Math.min(1, x));
      x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
      return Math.round(x * 255);
    });
    return '#' + c.map((v) => ('0' + v.toString(16)).slice(-2)).join('');
  }

  // ------------------------------------------------------------ adaptive quality: down only after ≥ 3 s of slow frames, back up when fast
  const RB = 1024, rT = new Float64Array(RB), rD = new Float64Array(RB);
  let rHead = 0, rN = 0, lastChange = 0, lastEval = 0;
  const backoff = new Float64Array(R.length), cool = new Float64Array(R.length).fill(15000);
  function avgSince(nowMs, span) {
    let sum = 0, n = 0; const from = Math.max(nowMs - span, lastChange);
    for (let k = 0; k < rN; k++) { const i = (rHead - 1 - k + RB) % RB; if (rT[i] < from) break; sum += rD[i]; n++; }
    return nowMs - from >= span * 0.98 && n >= 3 ? sum / n : -1;
  }
  function applyRung() {
    const r = R[rung]; tier = rung;
    grass.geometry.instanceCount = Math.floor(GRASS * r.grass);
    grass.material.uniforms.uWide.value = r.wide;
    plants.setDensity(r.plants);
    resize();
  }
  function perf(dtMs, nowMs) {
    if (QA) return;
    if (document.hidden || dtMs > 250) { lastChange = nowMs; return; }
    rT[rHead] = nowMs; rD[rHead] = dtMs; rHead = (rHead + 1) % RB; if (rN < RB) rN++;
    if (nowMs - lastEval < 500) return;
    lastEval = nowMs;
    const a3 = avgSince(nowMs, 3000);
    if (a3 > 24 && rung < R.length - 1 && (!R[rung + 1].hard || a3 > 40)) {
      cool[rung] = Math.min(cool[rung] * 2, 240000); backoff[rung] = nowMs + cool[rung];
      rung++; lastChange = nowMs; applyRung(); return;
    }
    const a6 = avgSince(nowMs, 6000);
    if (a6 > 0 && a6 < 18 && rung > 0 && nowMs >= backoff[rung - 1]) { rung--; lastChange = nowMs; applyRung(); }
  }
  applyRung();

  return {
    draw, resize, topColor, perf, anchor,
    poses: () => ({ tiger: PT, stag: PS, cam: CAM, end: endPlan() }),
    info: () => ({ tris: [tiger.userData.triangles, stag.userData.triangles], cards: plants.cards, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier, rungs: R.length, pr: bufRatio, buffer: [canvas.width, canvas.height] }),
    project: (x, y, z) => { v3.set(x, y, z).project(camera); return [(v3.x * 0.5 + 0.5) * V.FULL_W, (1 - (v3.y * 0.5 + 0.5)) * V.FULL_H, v3.z]; },
    groundAt,
  };
}
