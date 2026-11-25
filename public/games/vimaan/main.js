/* Vimaan 3D — renderer, scene assembly and the per-frame picture as a pure function of
 * (round time τ, crash time τc, my cash-outs, wall clock for blinking lights / waves).
 * scene.js (classic script) loads this module and forwards app.js's calls to it. */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { U, withFog, makeNoise, makePuffs } from './common.js';
import { buildJet, RIM } from './jet.js';
import { buildSky, buildGround, buildCity, buildHills, buildDeck, buildPuffs, lightMaterial, buildRunwayLights, buildChute, buildDip, runwayNumbers, buildSigns, CL, SH, GT } from './world.js';
import { jetAt, cameraAt, chuteAt, skyAt, setPortrait, AXLE, DECK, TL, S5, clamp } from './timeline.js';

const D2R = Math.PI / 180;
const WHITE = new THREE.Color(1, 1, 1), DIP_TINT = new THREE.Color(1, 0.93, 0.85);
const QS = new URLSearchParams(location.search);
const BASE = new URL('./', import.meta.url).href;

export async function createScene(canvas, hooks) {
  hooks = hooks || {};
  const QA = QS.has('qa');
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  // The quality ladder, richest first. Sharpness (the pixel ratio) is the LAST thing given up: first the
  // shadows, then clouds / city / ground detail, then the pixel ratio (phones keep ≥ 1.5 unless truly struggling).
  const DEV = window.devicePixelRatio || 1, phone = coarse;
  const R = [];
  const full = { shadow: !phone, ground: 1, cheap: 0, clouds: 1, city: 1, env: 0.3 };
  const lean = { shadow: false, ground: 0, cheap: 1, clouds: 0.6, city: 0.6, env: 0.8 };
  if (phone && DEV >= 2.75) R.push({ ...full, pr: 2.5, up: true });       // high-end phones, only when frames allow
  R.push({ ...full, pr: Math.min(DEV, 2) });                              // the default (phones: DPR 2)
  if (!phone) R.push({ ...full, shadow: false, pr: Math.min(DEV, 2) });
  R.push({ ...lean, pr: Math.min(DEV, 2) });
  R.push({ ...lean, pr: Math.min(DEV, 1.75) });
  R.push({ ...lean, pr: Math.min(DEV, 1.5) });                             // the phone floor
  R.push({ ...lean, pr: Math.min(DEV, 1.25), hard: true });                // only when truly struggling
  R.push({ ...lean, pr: 1, hard: true });
  for (let i = R.length - 1; i > 0; i--) if (R[i].pr === R[i - 1].pr && R[i].shadow === R[i - 1].shadow && R[i].cheap === R[i - 1].cheap) R.splice(i, 1);
  const DEFAULT = R.findIndex((r) => !r.up);
  let rung = DEFAULT;
  if (QS.has('q')) { const q = clamp(+QS.get('q') || 0, 0, 2); rung = q === 2 ? DEFAULT : q === 1 ? R.findIndex((r) => r.cheap && r.pr === R[DEFAULT].pr) : R.findIndex((r) => r.pr <= 1.5) ; if (rung < 0) rung = DEFAULT; }
  let tier = rung; // (reported in the ?fps=1 overlay)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: QA });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x2a2030, 1);
  renderer.autoClear = true;
  renderer.shadowMap.enabled = !phone; // desktop: the jet shadows itself (wings, tail, engines) in the low sun
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  U.uNoise.value = makeNoise(renderer);
  const texLoader = new THREE.TextureLoader();
  const loadTex = (f, rep) => new Promise((res) => texLoader.load(BASE + 'assets/' + f, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); res(t); }, undefined, () => res(U.uNoise.value)));
  const groundTex = Promise.all([loadTex('tex-asphalt.webp'), loadTex('tex-grass.webp')]);
  GT.asph.value = U.uNoise.value; GT.grass.value = U.uNoise.value; GT.num.value = runwayNumbers(); GT.num.value.anisotropy = renderer.capabilities.getMaxAnisotropy();
  CL.puffs.value = makePuffs(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1.0, 90000);

  // lights: the low sun, sky/ground fill, reflections from our own sky (PMREM)
  const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun, sun.target);
  sun.castShadow = R[rung].shadow;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 220 });
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xffe2cc, 1.0); scene.add(fill, fill.target); // soft key from the camera side (the low sun is often behind the jet)

  const sky = buildSky(false); scene.add(sky);
  const ground = buildGround(); scene.add(ground);
  scene.add(buildSigns(withFog));
  const hills = buildHills(); scene.add(hills);
  const city = buildCity(false); scene.add(city);
  const deck = buildDeck(); scene.add(deck);
  const sunDir0 = new THREE.Vector3();
  setSunDir(sunDir0, 12, -38);
  const puffs = buildPuffs(false, sunDir0); scene.add(puffs);
  const rwyMat = lightMaterial(); const rwyLights = buildRunwayLights(rwyMat); scene.add(rwyLights);

  // brand textures: our own logo files (cropped + tinted in a canvas, never redrawn as text)
  [GT.asph.value, GT.grass.value] = await groundTex;
  const [mark, word] = await Promise.all([loadImg(BASE + 'assets/brand-nx.webp'), loadImg(BASE + 'assets/brand-wordmark.webp')]);
  const markTex = mark ? logoTexture(mark, 'mark') : null;
  const wordTex = word ? logoTexture(word, 'word') : null;
  const jetLightMat = lightMaterial();
  const jet = buildJet({ lightMaterial: jetLightMat, mark: markTex && markTex.tex, wordmark: wordTex && wordTex.tex, wordmarkAspect: wordTex ? wordTex.aspect : 6.7 });
  scene.add(jet);
  [markTex, wordTex].forEach((t) => { if (t) t.tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); });
  jet.traverse((o) => { if (o.isMesh) { o.layers.enable(1); o.castShadow = true; o.receiveShadow = !(o.material && o.material.transparent); } });

  const chutes = [buildChute(withFog), buildChute(withFog)];
  chutes.forEach((c) => scene.add(c));
  const dip = buildDip(); scene.add(dip);

  // ------------------------------------------------------------ environment map from our sky
  const envScene = new THREE.Scene(); envScene.add(buildSky(true));
  const cubeRT = new THREE.WebGLCubeRenderTarget(phone ? 64 : 128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(1, 10, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, envKey = -1, envAt = -1e9;
  function bakeEnv(force, wall) {
    const k = U.uZenith.value.r * 3 + U.uHorizon.value.g * 5 + U.uGlow.value.r * 7 + U.uGround.value.b * 11 + U.uSunDir.value.y * 13;
    if (!force && (Math.abs(k - envKey) < 0.004 || wall - envAt < R[rung].env)) return;
    envKey = k; envAt = wall;
    const prev = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    cubeCam.update(renderer, envScene);
    renderer.toneMapping = prev;
    envRT = pmrem.fromCubemap(cubeRT.texture, envRT);
    scene.environment = envRT.texture;
  }

  // ------------------------------------------------------------ the jet's shadow on the ground (its silhouette from the sun)
  const shRT = new THREE.WebGLRenderTarget(384, 384, { depthBuffer: true, generateMipmaps: false });
  const shCam = new THREE.OrthographicCamera(-17, 17, 17, -17, 1, 200);
  shCam.layers.set(1);
  const shMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  SH.tex.value = shRT.texture;
  const shProj = new THREE.Matrix4();
  function shadowPass(J) {
    const on = R[rung].ground ? 1 - S5(25, 90, J.alt) : 0;
    SH.on.value = on;
    if (on <= 0) return;
    shCam.position.set(jet.position.x + U.uSunDir.value.x * 80, jet.position.y + U.uSunDir.value.y * 80, jet.position.z + U.uSunDir.value.z * 80);
    shCam.lookAt(jet.position);
    shCam.updateMatrixWorld(); shCam.updateProjectionMatrix();
    shProj.multiplyMatrices(shCam.projectionMatrix, shCam.matrixWorldInverse);
    SH.mat.value.copy(shProj);

    const bg = scene.background, ov = scene.overrideMaterial, prevTone = renderer.toneMapping;
    scene.overrideMaterial = shMat; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(shRT); renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(scene, shCam);
    renderer.setRenderTarget(null); renderer.setClearColor(0x2a2030, 1);
    scene.overrideMaterial = ov; scene.background = bg; renderer.toneMapping = prevTone;
  }

  // ------------------------------------------------------------ layout (play area → camera lens shift)
  let V = { W: 400, H: 400, TOP: 0, LEFT: 0, FULL_W: 400, FULL_H: 400, dpr: 1 }, focal = 500;
  let bufRatio = 1;
  function resize(v) {
    if (v) V = v;
    // the drawing buffer = CSS size × the chosen ratio, exactly (the canvas is never upscaled by CSS)
    const pr = QS.has('pr') ? clamp(+QS.get('pr') || 1, 0.5, 3) : R[rung].pr;
    const cw = Math.max(1, V.FULL_W), ch = Math.max(1, V.FULL_H);
    const bw = Math.max(1, Math.round(cw * pr)), bh = Math.max(1, Math.round(ch * pr));
    const cv = renderer.domElement; // same size: leave the canvas alone — sizing it clears it (a blink), and this runs every time a player joins
    if (cv.width !== bw || cv.height !== bh) { renderer.setPixelRatio(1); renderer.setSize(bw, bh, false); }
    bufRatio = bw / cw;
    const pw = Math.max(50, V.W), ph = Math.max(50, V.H);
    setPortrait(pw / ph < 1.1); // phones: tighter framing (timeline.js)
    const cx = V.LEFT + pw / 2, cy = V.TOP + ph * (V.FULL_W >= 900 ? 0.6 : 0.62);
    const tanV = Math.max(Math.tan(12.5 * D2R), Math.tan(23.5 * D2R) * ph / pw);
    focal = (ph / 2) / tanV;
    const Wv = 2 * Math.max(cx, V.FULL_W - cx), Hv = 2 * Math.max(cy, V.FULL_H - cy);
    camera.fov = 2 * Math.atan((Hv / 2) / focal) / D2R;
    camera.aspect = Wv / Hv;
    camera.setViewOffset(Wv, Hv, Wv / 2 - cx, Hv / 2 - cy, V.FULL_W, V.FULL_H);
    camera.updateProjectionMatrix();
    rwyMat.uniforms.uPx.value = focal * bufRatio; jetLightMat.uniforms.uPx.value = focal * bufRatio;
  }

  // ------------------------------------------------------------ one picture
  const J = {}, CAMS = {}, SKY = {}, CH = {}, e = new THREE.Euler(0, 0, 0, 'YZX'), v3 = new THREE.Vector3(), q = new THREE.Quaternion();
  const axle = new THREE.Vector3();
  function setSunDir(out, el, az) { const ce = Math.cos(el * D2R); return out.set(ce * Math.cos(az * D2R), Math.sin(el * D2R), ce * Math.sin(az * D2R)); }
  // st: { tau, tc (or null), wins: [{tw, slot}], wall (s), dip (0..1) }
  function draw(st) {
    const tau = st.tau, tc = st.tc;
    U.uTime.value = st.wall;
    // the jet
    jetAt(tau, tc, J);
    e.set(J.phi, -J.psi, J.theta); jet.quaternion.setFromEuler(e);
    axle.set(AXLE[0], AXLE[1] - J.oleo, AXLE[2]).applyQuaternion(jet.quaternion);
    jet.position.set(J.x - axle.x, J.y - axle.y, J.z - axle.z);
    J.thrust = tau > 0;
    jet.userData.pose(J, st.wall);
    // the camera
    cameraAt(tau, tc, CAMS);
    camera.position.set(CAMS.x, CAMS.y, CAMS.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(CAMS.ax, CAMS.ay, CAMS.az);
    camera.rotateZ(CAMS.roll);
    if (QA && st.camLocal) { // QA close-ups: a camera given in the jet's own coordinates
      jet.updateMatrixWorld();
      camera.position.fromArray(st.camLocal.pos).applyMatrix4(jet.matrixWorld);
      v3.fromArray(st.camLocal.target).applyMatrix4(jet.matrixWorld);
      camera.up.set(0, 1, 0); camera.lookAt(v3);
    }
    camera.updateMatrixWorld();
    // the sky band
    skyAt(tc != null ? Math.min(tau, tc + 1) : tau, SKY);
    setSunDir(U.uSunDir.value, SKY.el, SKY.az);
    U.uZenith.value.fromArray(SKY.zen); U.uHorizon.value.fromArray(SKY.hor); U.uGlow.value.fromArray(SKY.glow);
    U.uGround.value.fromArray(SKY.ground); U.uFogSun.value.fromArray(SKY.fogSun);
    U.uDusk.value = SKY.dusk;
    U.uFogDen.value = 1.25e-4 * SKY.haze;
    renderer.toneMappingExposure = SKY.exp;
    sun.color.fromArray(SKY.sun); sun.intensity = SKY.sunI;
    sun.position.copy(jet.position).addScaledVector(U.uSunDir.value, 100); sun.target.position.copy(jet.position);
    hemi.color.fromArray(SKY.hs); hemi.groundColor.fromArray(SKY.hg); hemi.intensity = 0.9;
    fill.position.copy(camera.position).add(v3.set(0, 6, 0)); fill.target.position.copy(jet.position);
    fill.intensity = 0.25 + 1.0 * Math.min(1, SKY.sunI / 3.6); fill.color.fromArray(SKY.sun).lerp(WHITE, 0.55);
    const sc = ground.material.uniforms.uSunCol.value.fromArray(SKY.sun).multiplyScalar(SKY.sunI * 0.55);
    const amb = ground.material.uniforms.uAmb.value.fromArray(SKY.hs).multiplyScalar(0.32);
    city.material.uniforms.uSunCol.value.copy(sc); city.material.uniforms.uAmb.value.copy(amb);
    hills.material.uniforms.uAmb.value.copy(amb);
    CL.lit.value.fromArray(SKY.lit); CL.shade.value.fromArray(SKY.shade);
    CL.coverage.value = SKY.coverage;
    // in the cloud: mist around the deck altitude
    const dy = Math.abs(CAMS.y - DECK);
    U.uMist.value = 0.7 * (1 - S5(10, 70, dy));
    U.uMistCol.value.copy(CL.lit.value).lerp(CL.shade.value, 0.25);
    rwyMat.uniforms.uLevel.value = 0.55 + 0.5 * SKY.dusk;
    jetLightMat.uniforms.uLevel.value = 0.7 + 0.5 * SKY.dusk;
    RIM.value.copy(U.uHorizon.value).multiplyScalar(0.28);
    // keep the big planes under the camera (their look comes from world position, so moving them changes nothing)
    ground.position.set(Math.round(CAMS.x / 1000) * 1000, 0, Math.round(CAMS.z / 1000) * 1000);
    deck.position.set(Math.round(CAMS.x / 1000) * 1000, DECK, Math.round(CAMS.z / 1000) * 1000);
    sky.position.copy(camera.position);
    // my cash-outs: parachutes
    for (let i = 0; i < chutes.length; i++) {
      const c = chutes[i], w = st.wins && st.wins[i];
      if (!w || tau - w.tw > 4.3 || tau < w.tw) { c.visible = false; continue; }
      chuteAt(tau, w.tw, tc, CH);
      c.visible = true;
      c.position.set(CH.x, CH.y, CH.z);
      c.rotation.set(CH.sway, -CH.psi, CH.sway * 0.6);
      const o = 0.15 + 0.85 * CH.open;
      c.userData.canopy.scale.set(o, 0.35 + 0.65 * CH.open, o);
      if (c.userData.text !== w.text) { c.userData.text = w.text; c.userData.setText(w.text); }
      const mats = c.userData.mats; for (let k = 0; k < mats.length; k++) mats[k].opacity = CH.alpha * (mats[k].isLineBasicMaterial ? 0.8 : 1);
      const ts = 0.075 * (0.4 + 0.6 * S5(0.2, 0.6, tau - w.tw));
      c.userData.tag.scale.set(ts * 4, ts, 1);
    }
    // contact shading under the jet while it is on (or just above) the runway
    GT.jet.value.set(J.x, J.z, J.psi, 1 - S5(0, 7, J.alt));
    SH.c.value.set(J.x, 0, J.z);
    // the dip back to the runway
    dip.visible = st.dip > 0.001;
    dip.material.uniforms.uA.value = st.dip;
    dip.material.uniforms.uCol.value.copy(U.uHorizon.value).multiplyScalar(0.85).lerp(DIP_TINT, 0.65);
    // env + shadow, then the frame
    bakeEnv(false, st.wall);
    shadowPass(J);
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ warm-up: compile every shader, bake, first frame
  resize();
  bakeEnv(true, 0);
  chutes.forEach((c) => { c.visible = true; c.userData.setText('+€0.00'); });
  dip.visible = true;
  if (renderer.compileAsync) { try { await renderer.compileAsync(scene, camera); } catch (err) { renderer.compile(scene, camera); } } else renderer.compile(scene, camera);
  draw({ tau: 19, tc: null, wins: [], wall: 0, dip: 0 });   // in the clouds
  draw({ tau: 6.5, tc: null, wins: [], wall: 0, dip: 0 });  // gear retracting (shadow pass)
  draw({ tau: -6, tc: null, wins: [], wall: 0, dip: 0 });

  // a phone may drop the GPU context (backgrounded, memory): the procedural textures are made again on restore
  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    U.uNoise.value = makeNoise(renderer); CL.puffs.value = makePuffs(renderer);
    envKey = -1; bakeEnv(true, 0);
  }, false);

  // ------------------------------------------------------------ the top colour (browser bar)
  function topColor() {
    const k = Math.pow(0.57, 0.42), ex = renderer.toneMappingExposure;
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
  function avgSince(nowMs, span) { // mean frame time over the last `span` ms (only since the last change)
    let sum = 0, n = 0, from = Math.max(nowMs - span, lastChange);
    for (let k = 0; k < rN; k++) { const i = (rHead - 1 - k + RB) % RB; if (rT[i] < from) break; sum += rD[i]; n++; }
    return nowMs - from >= span * 0.98 && n >= 3 ? sum / n : -1;
  }
  function applyRung() {
    const r = R[rung]; tier = rung;
    if (sun.castShadow !== r.shadow) sun.castShadow = r.shadow;
    puffs.geometry.instanceCount = Math.floor(puffs.userData.count * r.clouds);
    city.count = Math.floor(city.userData.total * r.city);
    GT.cheap.value = r.cheap;
    resize();
  }
  function perf(dtMs, nowMs) {
    if (QA) return;
    if (document.hidden || dtMs > 250) { lastChange = nowMs; return; } // a tab switch / hitch says nothing about the GPU
    rT[rHead] = nowMs; rD[rHead] = dtMs; rHead = (rHead + 1) % RB; if (rN < RB) rN++;
    if (nowMs - lastEval < 500) return;
    lastEval = nowMs;
    const a3 = avgSince(nowMs, 3000);
    if (a3 > 24 && rung < R.length - 1 && (!R[rung + 1].hard || a3 > 40)) {
      cool[rung] = Math.min(cool[rung] * 2, 240000); backoff[rung] = nowMs + cool[rung]; // don't come straight back to this rung
      rung++; lastChange = nowMs; applyRung(); return;
    }
    const a6 = avgSince(nowMs, 6000);
    if (a6 > 0 && a6 < 18 && rung > 0 && nowMs >= backoff[rung - 1]) { rung--; lastChange = nowMs; applyRung(); }
  }
  applyRung();

  return {
    draw, resize, topColor, perf,
    tier: () => tier,
    renderer, camera, scene, jet,
    info: () => ({ tris: jet.userData.triangles, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier, rungs: R.length, pr: bufRatio, buffer: [canvas.width, canvas.height] }),
  };
}

function loadImg(src) {
  return new Promise((res) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
// Our logo files, as textures: power-of-two canvas, a soft lift so the purple NX reads on the purple fin,
// the white letters of the wordmark turned royal purple for the white fuselage (shapes untouched).
const NX_STYLE = new URLSearchParams(location.search).get('nx') === 'b' ? 'b' : 'a'; // fin mark: a = badge (default), b = white + gold
function logoTexture(img, kind) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const W = kind === 'word' ? 2048 : 1024, H = kind === 'word' ? 256 : 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const pad = kind === 'mark' ? 64 : 16;
  const s = Math.min((W - pad) / w, (H - pad) / h), dw = w * s, dh = h * s, dx = (W - dw) / 2, dy = (H - dh) / 2;
  if (kind === 'mark' && NX_STYLE === 'b') {
    // option B: the NX shape in white with a thin gold edge (monochrome, reads on the purple fin)
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high';
    tg.drawImage(img, dx, dy, dw, dh); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#d9ad52'; tg.fillRect(0, 0, W, H);
    for (const [ox, oy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, 2], [-2, 2], [2, -2]]) g.drawImage(t, ox, oy);
    const u = document.createElement('canvas'); u.width = W; u.height = H;
    const ug = u.getContext('2d'); ug.imageSmoothingQuality = 'high';
    ug.drawImage(img, dx, dy, dw, dh); ug.globalCompositeOperation = 'source-in'; ug.fillStyle = '#ffffff'; ug.fillRect(0, 0, W, H);
    g.drawImage(u, 0, 0);
  } else {
    if (kind === 'mark') { // option A: our NX in its own colours, ringed by a clean white outline so the purple N reads on the purple fin
      const t = document.createElement('canvas'); t.width = W; t.height = H;
      const tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high';
      tg.drawImage(img, dx, dy, dw, dh); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#ffffff'; tg.fillRect(0, 0, W, H);
      for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; g.drawImage(t, Math.cos(a) * 7, Math.sin(a) * 7); }
    }
    g.drawImage(img, dx, dy, dw, dh);
  }
  if (kind === 'word') {
    const d = g.getImageData(0, 0, W, H), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 0) continue;
      const r = p[i], gg = p[i + 1], b = p[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0, l = mx / 255;
      if (sat < 0.25 && l > 0.35) { // silver letters → royal purple, keeping their shading
        const k = 0.55 + 0.45 * l;
        p[i] = 58 * k; p[i + 1] = 22 * k; p[i + 2] = 118 * k;
      }
    }
    g.putImageData(d, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, aspect: (W / H) }; // the decal spans the whole canvas (the logo fits inside it)
}
