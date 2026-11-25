/* Sixer Sky 3D — renderer, scene assembly and the per-frame picture as a pure function of the round
 * time (timeline.js). scene.js (classic script) loads this module and forwards app.js's calls to it.
 * Two camera set-ups share the one stadium:
 *   'play'   the crease (batsman, wicketkeeper, the delivery, the six) and the ball's flight
 *   'catch'  the end: a fielder on the boundary takes the ball out of the sky */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { U, makeNoise, makePuffs, withFog } from './common.js';
import { buildSky, buildStadium, buildClouds, buildCloudSea, buildBall, buildDip } from './world.js';
import { loadActor } from './models.js';
import { ballAt, cameraAt, skyAt, SEA, S5, clamp, HIT, PITCH } from './timeline.js';

const D2R = Math.PI / 180;
const QS = new URLSearchParams(location.search);
const BASE = new URL('./', import.meta.url).href;

// the batsman's shot clip: the bat meets the ball T_CONTACT seconds in; from T_HOLD he holds the finish
export const T_CONTACT = 1.08, T_HOLD = 1.75, T_BLEND = 0.4;
// the fielder's clip starts CATCH_FROM seconds in when the catch shot opens; the ball reaches his hands at CATCH_AT
export const CATCH_FROM = 2.3, CATCH_AT = 3.75;
const FIELDER = [9, 0, PITCH / 2 + 58];                       // on the boundary at long-on (inside the rope)

export async function createScene(canvas) {
  const QA = QS.has('qa');
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let tier = QS.has('q') ? clamp(+QS.get('q') || 0, 0, 2) : coarse ? 1 : 2;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: QA });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xbfdcf2, 1);
  renderer.shadowMap.enabled = tier === 2;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  U.uNoise.value = makeNoise(renderer);
  const puffTex = makePuffs(renderer);
  const [word, nx] = await Promise.all([loadImg(BASE + 'assets/nexorng.webp'), loadImg(BASE + 'assets/brand-nx.webp')]);
  const brand = { word, nx };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 12000);
  const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun, sun.target);
  sun.castShadow = tier === 2;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 60 });
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1); scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); scene.add(fill, fill.target);

  const sky = buildSky(); scene.add(sky);
  const stadium = buildStadium(tier, brand); scene.add(stadium);
  const clouds = buildClouds(tier, puffTex); scene.add(clouds);
  const sea = buildCloudSea(); scene.add(sea);
  const ball = buildBall(brand); scene.add(ball);
  const dip = buildDip(); scene.add(dip);

  // ------------------------------------------------------------ the players
  const [batsman, keeper, fielder] = await Promise.all([
    loadActor(BASE + 'assets/batsman.glb', { withFog, base: 'stance', clips: { shot: BASE + 'assets/batsman-shot.glb' } }),
    loadActor(BASE + 'assets/keeper.glb', { withFog, base: 'crouch' }),
    loadActor(BASE + 'assets/fielder.glb', { withFog, base: 'catch' }),
  ]);
  scene.add(batsman, keeper, fielder);
  batsman.rotation.y = -Math.PI / 2;                           // a right-hander: chest to the off side, the shot goes down the pitch (+Z)
  keeper.position.set(-0.35, 0, -2.3);                         // behind the stumps, a little to the off side, facing the bowler
  fielder.position.set(FIELDER[0], FIELDER[1], FIELDER[2]); fielder.rotation.y = Math.PI; // facing the pitch

  // the bat: built here, held along the forearms (the hands grip the handle)
  const bat = buildBat(nx); scene.add(bat);
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vD = new THREE.Vector3(), bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(), mB = new THREE.Matrix4();
  const HITDIR = new THREE.Vector3(0, 0, 1);
  function holdBat() {
    const b = batsman.userData.bones;
    batsman.updateMatrixWorld(true);
    b.RightHand.getWorldPosition(vA); b.LeftHand.getWorldPosition(vB); b.RightForeArm.getWorldPosition(vC); b.LeftForeArm.getWorldPosition(vD);
    by.copy(vA).sub(vC).normalize().add(bz.copy(vB).sub(vD).normalize()).normalize();   // down the blade: along both forearms
    bat.position.copy(vA).add(vB).multiplyScalar(0.5).addScaledVector(by, 0.03);
    by.negate();                                                                          // the bat's own +Y points up the handle
    bz.copy(HITDIR).addScaledVector(by, -HITDIR.dot(by));
    if (bz.lengthSq() < 1e-4) bz.set(1, 0, 0).addScaledVector(by, -by.x);
    bz.normalize(); bx.crossVectors(by, bz);
    bat.quaternion.setFromRotationMatrix(mB.makeBasis(bx, by, bz));
  }
  const BT = [], KT = [], FT = [];
  const clip = (L, i, name, time, weight, once) => { const e = L[i] || (L[i] = [name, 0, 0, false]); e[0] = name; e[1] = time; e[2] = weight; e[3] = !!once; };
  function poseBatsman(tau, wall) {
    const k = S5(-T_CONTACT - T_BLEND, -T_CONTACT, tau);       // stance → the shot's own first frame
    clip(BT, 0, 'stance', wall, 1 - k);
    clip(BT, 1, 'shot', Math.min(tau + T_CONTACT, T_HOLD), k, true);
    batsman.userData.set(BT);
    holdBat();
  }
  // Where his bat meets the ball: the model decides. Stand him so that the middle of the blade is on the
  // line of the stumps at contact, and tell the timeline (the delivery ends there, the six starts there).
  batsman.position.set(0, 0, 0);
  poseBatsman(0, 0);
  vA.set(0, -0.5, 0).applyQuaternion(bat.quaternion).add(bat.position);                  // the middle of the blade
  batsman.position.set(0.04 - vA.x, 0, 1.05 - vA.z);
  HIT[0] = 0.04; HIT[1] = clamp(vA.y, 0.45, 1.25); HIT[2] = 1.05;
  // Where the fielder's hands take the ball
  const CATCH = new THREE.Vector3();
  function poseFielder(te) {
    clip(FT, 0, 'catch', Math.min(CATCH_FROM + te, fielder.userData.dur('catch') - 0.05), 1, true);
    fielder.userData.set(FT);
  }
  function handsOf(actor, out) { const b = actor.userData.bones; actor.updateMatrixWorld(true); b.RightHand.getWorldPosition(out); b.LeftHand.getWorldPosition(vB); return out.add(vB).multiplyScalar(0.5); }
  poseFielder(CATCH_AT - CATCH_FROM); handsOf(fielder, CATCH);

  // ------------------------------------------------------------ environment map from our sky (the ball's shine, the helmets)
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

  // ------------------------------------------------------------ layout: the subject in the middle of the play area (lens shift)
  let V = { W: 400, H: 400, TOP: 0, LEFT: 0, FULL_W: 400, FULL_H: 400, dpr: 1 }, portrait = 0, tanStage = 0.4;
  function pixelRatio() { const d = window.devicePixelRatio || 1; return Math.min(d, tier === 2 ? 2 : tier === 1 ? 1.5 : 1); }
  function resize(v) {
    if (v) V = v;
    const pr = QA && V.dpr ? V.dpr : pixelRatio();
    const fw = Math.max(1, Math.round(V.FULL_W)), fh = Math.max(1, Math.round(V.FULL_H)), cv = renderer.domElement;
    // same size: leave the canvas alone — sizing it clears it (a blink), and this runs every time a player joins
    if (renderer.getPixelRatio() !== pr || cv.width !== Math.floor(fw * pr) || cv.height !== Math.floor(fh * pr)) { renderer.setPixelRatio(pr); renderer.setSize(fw, fh, false); }
    const pw = Math.max(50, V.W), ph = Math.max(50, V.H);
    const cx = V.LEFT + pw / 2, cy = V.TOP + ph * 0.56;
    const tanV = Math.max(Math.tan(14 * D2R), Math.tan(24 * D2R) * ph / pw);
    const focal = (ph / 2) / tanV;
    tanStage = tanV;                                           // half the play area's height at distance 1
    const Wv = 2 * Math.max(cx, V.FULL_W - cx), Hv = 2 * Math.max(cy, V.FULL_H - cy);
    camera.fov = 2 * Math.atan((Hv / 2) / focal) / D2R;
    camera.aspect = Wv / Hv;
    camera.setViewOffset(Wv, Hv, Wv / 2 - cx, Hv / 2 - cy, V.FULL_W, V.FULL_H);
    camera.updateProjectionMatrix();
    portrait = clamp(1 - (pw / ph - 0.75) / 0.75, 0, 1);       // 1 on a tall phone stage, 0 on a wide one
  }

  // ------------------------------------------------------------ one picture
  const B = {}, C = {}, SKY = {}, up = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3();
  const DIP_TINT = new THREE.Color(1, 0.96, 0.88);
  function setSunDir(out, el, az) { const ce = Math.cos(el * D2R); return out.set(ce * Math.cos(az * D2R), Math.sin(el * D2R), ce * Math.sin(az * D2R)); }
  // st: { tau, tc (or null), wall (s), dip (0..1), shot: 'play' | 'catch', te (s into the catch shot) }
  function draw(st) {
    const tau = st.tau, tc = st.tc, w = st.wall, isCatch = st.shot === 'catch';
    U.uTime.value = w;
    let skyT = tc != null ? Math.min(tau, tc + 1) : tau, focus = v3;
    if (!isCatch) {
      ballAt(tau, tc, B);
      ball.position.set(B.x, B.y, B.z); ball.visible = B.vis > 0.01;
      ball.rotation.set(-B.spin, 0.5, 0.35);
      cameraAt(tau, tc, w, C);
      // a tall stage: the crease camera steps back and a little higher so the batsman and the keeper both fit
      const back = portrait * (1 - S5(0.1, 1.2, tau)) * 1.1;
      camera.position.set(C.x - 0.38 * back, C.y + 0.16 * back, C.z + back);
      camera.up.copy(up);
      // in the flight the ball sits a little under the middle of the play area, whatever the picture's shape
      const kb = S5(0.7, 2.4, tau);
      if (kb > 0) { const d = camera.position.distanceTo(ball.position); C.ax += (B.x - C.ax) * kb; C.az += (B.z - C.az) * kb; C.ay += (B.y + d * 0.22 * tanStage - C.ay) * kb; }
      camera.lookAt(C.ax, C.ay, C.az); camera.rotateZ(C.roll || 0);
      const near = tau < 4.5;
      batsman.visible = keeper.visible = bat.visible = near; fielder.visible = false;
      if (near) {
        poseBatsman(tau, w);
        clip(KT, 0, 'crouch', w, 1); keeper.userData.set(KT);
      }
      focus = tau < 1 ? v3.set(batsman.position.x, 1, batsman.position.z) : v3.set(B.x, B.y, B.z);
    } else {
      // the boundary: the ball drops out of the sky into his hands; he keeps it
      const te = st.te, dt = CATCH_AT - CATCH_FROM - te;
      poseFielder(te);
      if (dt > 0) ball.position.set(CATCH.x + 0.2 * dt, CATCH.y + 7 * dt + 5 * dt * dt, CATCH.z - 0.9 * dt);
      else handsOf(fielder, ball.position);
      ball.visible = true; ball.rotation.set(te * 7, 0.5, 0.35);
      batsman.visible = keeper.visible = bat.visible = false; fielder.visible = true;
      // the camera stays with him (he shuffles back under the ball): his hips in the middle of the picture
      fielder.userData.bones.Hips.getWorldPosition(vC);
      const sway = Math.sin(w * 0.33) * 0.04, dist = 1.95 / tanStage;                       // he fills about half the play area's height
      camera.position.set(vC.x - 0.25 * dist + sway, 1.5 + Math.sin(w * 0.27) * 0.025, vC.z - dist);
      camera.up.copy(up);
      camera.lookAt(vC.x, 1.3, vC.z);
      skyT = -99; focus = v3.set(vC.x, 1.2, vC.z);
    }
    if (st.cam) { camera.position.set(st.cam[0], st.cam[1], st.cam[2]); camera.up.copy(up); camera.lookAt(st.cam[3], st.cam[4], st.cam[5]); } // QA: a free camera
    camera.updateMatrixWorld();
    // the light of the hour
    skyAt(skyT, SKY);
    setSunDir(U.uSunDir.value, SKY.el, SKY.az);
    U.uZenith.value.fromArray(SKY.zen); U.uHorizon.value.fromArray(SKY.hor); U.uGlow.value.fromArray(SKY.glow);
    U.uGround.value.fromArray(SKY.ground); U.uFogSun.value.fromArray(SKY.fogSun);
    U.uSunCol.value.fromArray(SKY.sun).multiplyScalar(SKY.sunI);
    U.uAmbSky.value.fromArray(SKY.hs).multiplyScalar(0.55); U.uAmbGnd.value.fromArray(SKY.hg).multiplyScalar(0.35);
    U.uCloudLit.value.fromArray(SKY.lit); U.uCloudShade.value.fromArray(SKY.shade);
    U.uFogDen.value = 3.2e-4 * SKY.haze;
    renderer.toneMappingExposure = SKY.exp;
    sun.color.fromArray(SKY.sun); sun.intensity = SKY.sunI;
    sun.position.copy(focus).addScaledVector(U.uSunDir.value, 30); sun.target.position.copy(focus);
    hemi.color.fromArray(SKY.hs); hemi.groundColor.fromArray(SKY.hg); hemi.intensity = 1.15;
    fill.position.copy(camera.position).add(v3.set(0, 1.5, 0)); fill.target.position.copy(focus); fill.intensity = 0.5;
    // the ground under the cloud sea; the sea from just below it (as the ball goes through)
    const cy = camera.position.y;
    stadium.visible = cy < SEA + 60;
    const dy = Math.abs(cy - SEA);
    U.uVeil.value = 1 - S5(0.5, 7, dy);
    sea.material.uniforms.uVis.value = S5(SEA - 75, SEA - 20, cy) * (1 - U.uVeil.value);
    sea.visible = sea.material.uniforms.uVis.value > 0.001;
    sea.position.set(Math.round(camera.position.x / 100) * 100, SEA, Math.round(camera.position.z / 100) * 100);
    clouds.material.uniforms.uSeaVis.value = S5(SEA - 40, SEA - 5, cy);
    clouds.material.uniforms.uWrapC.value.copy(camera.position);
    U.uMist.value = 0.85 * (1 - S5(4, 40, dy));
    U.uMistCol.value.copy(U.uCloudLit.value).lerp(U.uCloudShade.value, 0.35);
    clouds.userData.sort(camera.position);
    sky.position.copy(camera.position);
    dip.visible = st.dip > 0.001;
    dip.material.uniforms.uA.value = st.dip || 0;
    dip.material.uniforms.uCol.value.copy(U.uHorizon.value).lerp(DIP_TINT, 0.6);
    bakeEnv(false, w);
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ warm-up: compile every shader, first frames of each place
  resize();
  skyAt(-99, SKY); setSunDir(U.uSunDir.value, SKY.el, SKY.az);
  bakeEnv(true, 0);
  dip.visible = true;
  if (renderer.compileAsync) { try { await renderer.compileAsync(scene, camera); } catch (err) { renderer.compile(scene, camera); } } else renderer.compile(scene, camera);
  draw({ tau: 34, tc: null, wall: 0, dip: 0, shot: 'play' });      // above the cloud sea
  draw({ tau: 12, tc: null, wall: 0, dip: 0.5, shot: 'play' });    // over the town
  draw({ tau: 0, tc: null, wall: 0, dip: 0, shot: 'catch', te: 1 });
  draw({ tau: -3, tc: null, wall: 0, dip: 0, shot: 'play' });

  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); }, false);
  canvas.addEventListener('webglcontextrestored', () => { U.uNoise.value = makeNoise(renderer); envKey = -1; bakeEnv(true, 0); }, false);

  // the top colour (browser bar): the sky at the top of the picture
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

  // quality: step down if frames are slow (> 20 ms)
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
  // where the ball is on the screen (css px), for the cash-out chip
  function ballScreen(out) {
    v3.copy(ball.position).project(camera);
    out.x = (v3.x * 0.5 + 0.5) * V.FULL_W; out.y = (-v3.y * 0.5 + 0.5) * V.FULL_H; out.vis = v3.z < 1 && ball.visible;
    return out;
  }

  return {
    draw, resize, topColor, perf, ballScreen,
    tier: () => tier,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier, pr: renderer.getPixelRatio(), hit: HIT.slice(), batsman: batsman.position.toArray(), catchAt: CATCH.toArray() }),
  };
}

// The bat: willow blade (flat face forward, a spine on the back), a taped rubber grip, our NX mark as the sticker.
// Its origin is the middle of the grip; the blade runs down −Y; +Z is the face that meets the ball.
function buildBat(nxImg) {
  const g = new THREE.Group();
  const willow = withFog(new THREE.MeshStandardMaterial({ color: 0xe6cf9c, roughness: 0.55 }));
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.56, 0.034), willow); blade.position.set(0, -0.44, 0); g.add(blade);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 3, 1), willow); spine.rotation.y = Math.PI; spine.scale.set(1.5, 1, 0.75); spine.position.set(0, -0.45, -0.022); g.add(spine);
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.054, 0.05, 12), willow); shoulder.scale.z = 0.62; shoulder.position.set(0, -0.14, 0); g.add(shoulder);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.27, 14), withFog(new THREE.MeshStandardMaterial({ color: 0x4a1fa8, roughness: 0.8 }))); grip.position.set(0, 0.02, 0); g.add(grip);
  if (nxImg) {
    const t = new THREE.Texture(nxImg); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.anisotropy = 8;
    const w = 0.085, h = w * nxImg.naturalHeight / nxImg.naturalWidth;
    const sticker = new THREE.Mesh(new THREE.PlaneGeometry(w, h), withFog(new THREE.MeshBasicMaterial({ map: t, transparent: true })));
    sticker.position.set(0, -0.26, 0.0176); g.add(sticker);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

function loadImg(src) {
  return new Promise((res) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
