/* Baaz 3D — renderer, scene assembly and the per-frame picture as a pure function of
 * (round time τ, crash time τc, wall clock for idle life, ret = the falcon comes home this betting).
 * scene.js (classic script) loads this module and forwards app.js's calls to it. */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { U, makeNoise, withFog } from './common.js';
import { loadFalcon, FU } from './falcon.js';
import { loadFalconer } from './falconer.js';
import { buildStreaks, buildFeathers, buildGlare, fxAt } from './fx.js';
import { buildSky, buildDunes, buildOasis, buildCanyon, buildClouds, buildCloudSea, buildDip } from './world.js';
import { falconAt, cameraAt, skyAt, newFalcon, pathPoint, SEA, S5, clamp, GLOVE } from './timeline.js';

const D2R = Math.PI / 180;
const QS = new URLSearchParams(location.search);
const BASE = new URL('./', import.meta.url).href;

export async function createScene(canvas) {
  const QA = QS.has('qa');
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let tier = QS.has('q') ? clamp(+QS.get('q') || 0, 0, 2) : coarse ? 1 : 2;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: QA });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x9cc2ea, 1);
  renderer.shadowMap.enabled = tier === 2;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  U.uNoise.value = makeNoise(renderer);
  const texLoader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loadTex = (f, srgb, clampEdge) => new Promise((res) => texLoader.load(BASE + 'assets/' + f, (t) => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.anisotropy = aniso; res(t); }, undefined, () => res(null)));
  const [sandC, sandN, rockC, rockN, puffTex, featherTex, falcon, falconer] = await Promise.all([loadTex('sand-col.webp', true), loadTex('sand-nor.webp'), loadTex('rock-col.webp', true), loadTex('rock-nor.webp'), loadTex('clouds.webp', false, true), loadTex('feather.webp', true, true),
    loadFalcon(BASE), loadFalconer(BASE, withFog)]);
  const tex = { sandC: sandC || U.uNoise.value, sandN: sandN || U.uNoise.value, rockC, rockN };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 12000);

  // lights: the low sun (shadows of the falcon on itself, the glove and the arm: high tier), sky fill, our sky's reflections
  const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun, sun.target);
  sun.castShadow = tier === 2;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.004; sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.5, far: 12 });
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8); scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xffe6d2, 0.9); scene.add(fill, fill.target); // a soft key from the camera side (the low sun is often behind the falcon)

  const sky = buildSky(); scene.add(sky);
  const sky0 = skyAt(-1, {});
  const bakeSun = new THREE.Vector3(); setSunDir(bakeSun, sky0.el, sky0.az);
  const dunes = buildDunes(tier, tex, bakeSun); scene.add(dunes);
  const oasis = buildOasis(tier); scene.add(oasis);
  const canyon = buildCanyon(tier, tex); scene.add(canyon);
  const clouds = buildClouds(tier, puffTex); scene.add(clouds);
  const sea = buildCloudSea(); scene.add(sea);
  scene.add(falconer);
  scene.add(falcon);
  falcon.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = tier === 2; } });
  let tris0 = falcon.userData.triangles + falconer.userData.triangles;
  const dip = buildDip(); scene.add(dip);
  const streaks = buildStreaks(tier === 0 ? 36 : 60); scene.add(streaks);
  const feathers = buildFeathers(featherTex); scene.add(feathers);
  const glare = buildGlare(); scene.add(glare); // (not on the lowest quality tier)

  // ------------------------------------------------------------ environment map from our sky (reflections: eyes, foil, leather)
  const envScene = new THREE.Scene(); envScene.add(buildSky());
  const cubeRT = new THREE.WebGLCubeRenderTarget(tier === 2 ? 128 : 64, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(1, 2000, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, envKey = -1, envAt = -1e9;
  function bakeEnv(force, wall) {
    const k = U.uZenith.value.r * 3 + U.uHorizon.value.g * 5 + U.uGlow.value.r * 7 + U.uGround.value.b * 11 + U.uSunDir.value.y * 13;
    if (!force && (Math.abs(k - envKey) < 0.004 || wall - envAt < [1.0, 0.5, 0.3][tier])) return;
    envKey = k; envAt = wall;
    const prev = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    cubeCam.update(renderer, envScene);
    renderer.toneMapping = prev;
    envRT = pmrem.fromCubemap(cubeRT.texture, envRT);
    scene.environment = envRT.texture;
  }

  // ------------------------------------------------------------ layout: the falcon in the middle of the play area (lens shift)
  let V = { W: 400, H: 400, TOP: 0, LEFT: 0, FULL_W: 400, FULL_H: 400, dpr: 1 }, zoomK = 1;
  function pixelRatio() { const d = window.devicePixelRatio || 1; return Math.min(d, tier === 2 ? 2 : tier === 1 ? 1.5 : 1); }
  function resize(v) {
    if (v) V = v;
    const pr = QA && V.dpr ? V.dpr : pixelRatio();
    const fw = Math.max(1, Math.round(V.FULL_W)), fh = Math.max(1, Math.round(V.FULL_H)), cv = renderer.domElement;
    // same size: leave the canvas alone — sizing it clears it (a blink), and this runs every time a player joins
    if (renderer.getPixelRatio() !== pr || cv.width !== Math.floor(fw * pr) || cv.height !== Math.floor(fh * pr)) { renderer.setPixelRatio(pr); renderer.setSize(fw, fh, false); }
    const pw = Math.max(50, V.W), ph = Math.max(50, V.H);
    const cx = V.LEFT + pw / 2, cy = V.TOP + ph * (V.FULL_W >= 900 ? 0.58 : 0.6);
    const tanV = Math.max(Math.tan(15 * D2R), Math.tan(26 * D2R) * ph / pw);
    const focal = (ph / 2) / tanV;
    const Wv = 2 * Math.max(cx, V.FULL_W - cx), Hv = 2 * Math.max(cy, V.FULL_H - cy);
    camera.fov = 2 * Math.atan((Hv / 2) / focal) / D2R;
    camera.aspect = Wv / Hv;
    camera.setViewOffset(Wv, Hv, Wv / 2 - cx, Hv / 2 - cy, V.FULL_W, V.FULL_H);
    camera.updateProjectionMatrix();
    // portrait play areas: the camera comes closer (the falcon keeps its size on a narrow screen)
    zoomK = clamp(0.62 + 0.38 * (pw / ph) / 1.35, 0.68, 1);
  }

  // ------------------------------------------------------------ one picture
  const TMPC = new THREE.Color(), JW = newFalcon(), J = newFalcon(), JB = newFalcon(), PB = {}, FX = {}, C = {}, SKY = {}, v3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), FP = new THREE.Vector3();
  const DIP_TINT = new THREE.Color(1, 0.9, 0.78);
  function setSunDir(out, el, az) { const ce = Math.cos(el * D2R); return out.set(ce * Math.cos(az * D2R), Math.sin(el * D2R), ce * Math.sin(az * D2R)); }
  // st: { tau, tc (or null), wall (s), ret (bool), dip (0..1) }
  function draw(st) {
    const tau = st.tau, tc = st.tc, w = st.wall;
    U.uTime.value = w;
    // the falcon
    falconAt(tau, tc, w, !!st.ret, J);
    if (st.wingTau != null) { // QA / lobby pictures: the wings and tail of another moment on this body
      falconAt(st.wingTau, null, w, false, JW);
      for (const k of ['e', 's', 'f', 'tw', 'sp', 'h']) { J.wL[k] = JW.wL[k]; J.wR[k] = JW.wR[k]; }
      J.tailSp = JW.tailSp; J.tailPitch = JW.tailPitch;
    }
    falcon.userData.pose(J);
    falcon.visible = !st.hide;
    FP.set(J.x, J.y, J.z);
    // the camera
    cameraAt(tau, tc, w, !!st.ret, C);
    camera.position.set(C.ax + (C.x - C.ax) * zoomK, C.ay + (C.y - C.ay) * zoomK, C.az + (C.z - C.az) * zoomK);
    camera.up.copy(up);
    camera.lookAt(C.ax, C.ay, C.az);
    camera.rotateZ(C.roll || 0);
    if (st.cam) { // QA: a free camera (offsets from the falcon)
      const f = FP;
      camera.position.set(f.x + st.cam[0], f.y + st.cam[1], f.z + st.cam[2]); camera.up.copy(up); camera.lookAt(f.x + (st.cam[3] || 0), f.y + (st.cam[4] || 0), f.z + (st.cam[5] || 0));
    }
    camera.updateMatrixWorld();
    // the falconer: posed only while the camera is near him (the flight soon leaves him far behind)
    falconer.visible = camera.position.distanceTo(falconer.position) < 70;
    if (falconer.visible) falconer.userData.pose(tau, tc, !!st.ret, w, FP);
    // the sky band (it stays as it was when the round ended)
    skyAt(tc != null ? Math.min(tau, tc + 1) : tau, SKY);
    setSunDir(U.uSunDir.value, SKY.el, SKY.az);
    U.uZenith.value.fromArray(SKY.zen); U.uHorizon.value.fromArray(SKY.hor); U.uGlow.value.fromArray(SKY.glow);
    U.uGround.value.fromArray(SKY.ground); U.uFogSun.value.fromArray(SKY.fogSun);
    U.uSunCol.value.fromArray(SKY.sun).multiplyScalar(SKY.sunI);
    U.uAmbSky.value.fromArray(SKY.hs).multiplyScalar(0.55); U.uAmbGnd.value.fromArray(SKY.hg).multiplyScalar(0.35);
    U.uCloudLit.value.fromArray(SKY.lit); U.uCloudShade.value.fromArray(SKY.shade);
    U.uFogDen.value = 5.5e-4 * SKY.haze;
    renderer.toneMappingExposure = SKY.exp;
    sun.color.fromArray(SKY.sun); sun.intensity = SKY.sunI;
    sun.position.copy(FP).addScaledVector(U.uSunDir.value, 6); sun.target.position.copy(FP);
    hemi.color.fromArray(SKY.hs); hemi.groundColor.fromArray(SKY.hg); hemi.intensity = 1.1;
    fill.position.copy(camera.position).add(v3.set(0, 0.6, 0)); fill.target.position.copy(FP);
    fill.intensity = 0.55 + 0.5 * Math.min(1, SKY.sunI / 3.4);
    FU.uSunView.value.copy(U.uSunDir.value).transformDirection(camera.matrixWorldInverse);
    FU.uSunCol.value.fromArray(SKY.sun).multiplyScalar(SKY.sunI * 0.5);
    // the places: ground, canyon, oasis under the cloud sea from its crossing on; the sea from just below it
    const cy = camera.position.y;
    const groundVis = 1 - S5(SEA + 5, SEA + 40, cy);
    dunes.userData.mat.uniforms.uVis.value = groundVis;
    dunes.visible = oasis.visible = canyon.visible = groundVis > 0.001;
    const dy = Math.abs(cy - SEA);
    // through the sea's top the sea plane gives way to the mist (and so does the sky), so its surface
    // never flips from under to over (or the sky snaps in) in one frame
    U.uVeil.value = 1 - S5(0.5, 7, dy);
    sea.material.uniforms.uVis.value = S5(SEA - 75, SEA - 20, cy) * (1 - U.uVeil.value);
    sea.visible = sea.material.uniforms.uVis.value > 0.001;
    sea.position.set(Math.round(camera.position.x / 100) * 100, SEA, Math.round(camera.position.z / 100) * 100);
    clouds.material.uniforms.uSeaVis.value = S5(SEA - 40, SEA - 5, cy);
    clouds.material.uniforms.uWrapC.value.copy(camera.position);
    U.uMist.value = 0.85 * (1 - S5(3, 22, dy));
    U.uMistCol.value.copy(U.uCloudLit.value).lerp(U.uCloudShade.value, 0.35);
    clouds.userData.sort(camera.position);
    sky.position.copy(camera.position);
    // the dip (the way home)
    dip.visible = st.dip > 0.001;
    dip.material.uniforms.uA.value = st.dip || 0;
    dip.material.uniforms.uCol.value.copy(U.uHorizon.value).lerp(DIP_TINT, 0.55);
    // effects (pure functions of τ): wind streaks, feathers, the sun's glare
    fxAt(tau, tc, FX);
    streaks.matrix.copy(camera.matrixWorld); streaks.matrixWorldNeedsUpdate = true;
    const su = streaks.material.uniforms; su.uT.value = tau; su.uAmt.value = FX.streak * (st.hide || st.noFx ? 0 : 1); su.uLen.value = FX.len; su.uAspect.value = Math.max(0.6, camera.aspect);
    su.uCol.value.fromArray(SKY.lit).multiplyScalar(0.55);
    streaks.visible = FX.streak > 0.002;
    const fu = feathers.material.uniforms;
    fu.uA.value.set(GLOVE[0], GLOVE[1] + 0.12, GLOVE[2], st.hide ? -1 : FX.featA);
    if (FX.featB >= 0) { falconAt(tc, null, w, !!st.ret, JB); pathPoint(tc, PB); fu.uB.value.set(JB.x, JB.y, JB.z, FX.featB); fu.uBV.value.set(Math.cos(PB.psi) * PB.vh, PB.vy, Math.sin(PB.psi) * PB.vh).multiplyScalar(0.12); }
    else fu.uB.value.w = -1;
    fu.uLight.value.fromArray(SKY.hs).multiplyScalar(0.25 / 0.9).add(TMPC.fromArray(SKY.sun)).multiplyScalar(0.9);
    feathers.visible = FX.featA >= 0 || FX.featB >= 0;
    v3.copy(camera.position).addScaledVector(U.uSunDir.value, 1000).project(camera);
    const onScr = v3.z < 1 ? (1 - S5(0.9, 1.25, Math.abs(v3.x))) * (1 - S5(0.9, 1.25, Math.abs(v3.y))) : 0;
    const gu = glare.material.uniforms; gu.uSun.value.set(v3.x, v3.y); gu.uAspect.value = camera.aspect;
    gu.uAmt.value = onScr * S5(24, 30, tc != null ? Math.min(tau, tc) : tau) * 0.45 * (1 - U.uMist.value);
    glare.visible = gu.uAmt.value > 0.002 && tier > 0;
    if (st.only) { const O = { sky, dunes, oasis, canyon, clouds, sea, falconer, falcon }; for (const k in O) O[k].visible = O[k].visible && st.only.indexOf(k) >= 0; } // QA
    else { sky.visible = clouds.visible = true; }
    bakeEnv(false, w);
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ warm-up: compile every shader, bake, first frames
  resize();
  bakeEnv(true, 0);
  dip.visible = streaks.visible = feathers.visible = glare.visible = true;
  if (renderer.compileAsync) { try { await renderer.compileAsync(scene, camera); } catch (err) { renderer.compile(scene, camera); } } else renderer.compile(scene, camera);
  draw({ tau: 31, tc: null, wall: 0, ret: false, dip: 0 });  // above the cloud sea
  draw({ tau: 16, tc: null, wall: 0, ret: false, dip: 0 });  // the canyon
  draw({ tau: 3, tc: null, wall: 0, ret: false, dip: 0.5 });
  draw({ tau: -2, tc: null, wall: 0, ret: false, dip: 0 });

  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); }, false);
  canvas.addEventListener('webglcontextrestored', () => { U.uNoise.value = makeNoise(renderer); envKey = -1; bakeEnv(true, 0); }, false);

  // ------------------------------------------------------------ the top colour (browser bar): the sky at the top of the picture
  function topColor() {
    const k = Math.pow(0.6, 0.4), ex = renderer.toneMappingExposure;
    const c = [0, 1, 2].map((i) => {
      let x = (SKY.hor[i] + (SKY.zen[i] - SKY.hor[i]) * k) * ex / 0.6;
      x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
      x = Math.max(0, Math.min(1, x));
      x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
      return Math.round(x * 255);
    });
    return '#' + c.map((v) => ('0' + v.toString(16)).slice(-2)).join('');
  }

  // ------------------------------------------------------------ quality tiers: step down if frames are slow (> 20 ms)
  let slowFrames = 0, frames = 0, lastDrop = 0;
  function perf(dtMs, nowMs) {
    if (QA || document.hidden) return;
    frames++;
    if (dtMs > 20.5 && dtMs < 200) slowFrames++;
    if (frames >= 90) {
      if (slowFrames > 45 && tier > 0 && nowMs - lastDrop > 3000) {
        tier--; lastDrop = nowMs;
        if (tier < 2) { sun.castShadow = false; renderer.shadowMap.enabled = false; }
        resize();
      }
      frames = 0; slowFrames = 0;
    }
  }
  // where the falcon is on the screen (css px), for the cash-out feather
  function falconScreen(out) {
    v3.copy(FP).project(camera);
    out.x = (v3.x * 0.5 + 0.5) * V.FULL_W; out.y = (-v3.y * 0.5 + 0.5) * V.FULL_H; out.vis = v3.z < 1;
    return out;
  }

  return {
    draw, resize, topColor, perf, falconScreen,
    tier: () => tier,
    renderer, camera, scene, falcon,
    info: () => ({ tris: tris0, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier, pr: renderer.getPixelRatio() }),
  };
}
