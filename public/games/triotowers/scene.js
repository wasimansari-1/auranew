/* Trio Towers — the real-time 3D scene (three.js r170, the shared copy in _core/vendor).
 *
 * A dark purple studio stage with a gold arch and three tall glass towers. Each tower holds ten
 * numbered balls (0–9) floating in a calm air vortex: two balls per level, five levels, each level
 * orbiting at its own pace — spaced so balls never touch. When the engine draws a tower's ball, that
 * ball glides to the gate, rolls down the glass chute and seats in the gold cradle in front of the
 * tower, turning to face the player. Next round the cradle ball melts away and the tower's ball
 * grows back into its place.
 *
 * Built for cheap phones: no shadows, no post-processing, no glass transmission (a fresnel shell +
 * one transparent layer), standard materials, one environment map made once, pixel ratio capped at
 * 1.5 and lowered automatically if frames run slow; nothing renders while the page is hidden.
 *
 *   var s = createScene(canvas, {maxPR});  s.resize(w, h, A)  (A = play area {L,T,W,H} in px)
 *   s.mixing(on) · s.drop(i, digit) · s.place(i, digit) · s.glow(on) · s.reset() · s.anchor() · s.hooks
 */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { RoomEnvironment } from '../_core/vendor/three-0.170.0/addons/RoomEnvironment.js';

var X = [-1.5, 0, 1.5], GLASS_Y0 = 0.62, GLASS_H = 2.45, R_GLASS = 0.56, R_BALL = 0.2, SHOW = 1.5, CHUTE = 1.12;
var CROWN_Y = GLASS_Y0 + GLASS_H;
var WORLD = { y0: -0.22, y1: 3.95, w: 4.75 };
var DROP = { glide: 0.5, roll: 0.72, settle: 0.42 }; // seconds (1.64 s from release to seated)

function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeIn(t) { return t * t; }
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

export function createScene(canvas, opts) {
  opts = opts || {};
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  var maxPR = opts.maxPR || Math.min(window.devicePixelRatio || 1, 1.5), pr = maxPR;
  renderer.setPixelRatio(pr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color('#060411');
  var pmrem = new THREE.PMREMGenerator(renderer);
  var env = new RoomEnvironment();
  scene.environment = pmrem.fromScene(env, 0.04).texture;
  scene.environmentIntensity = 0.55;
  env.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  pmrem.dispose();
  var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  var gold = new THREE.MeshStandardMaterial({ color: '#f2b25a', metalness: 1, roughness: 0.26, envMapIntensity: 1.5 });
  var darkMetal = new THREE.MeshStandardMaterial({ color: '#1d0f3a', metalness: 0.75, roughness: 0.32 });
  var lacquer = new THREE.MeshStandardMaterial({ color: '#150a2c', metalness: 0.45, roughness: 0.22 });

  function radialTex(stops) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); }); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  var glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]);
  var shadowTex = radialTex([[0, 'rgba(0,0,0,.85)'], [0.6, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']]);
  var VS_UV = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }';
  var time = { value: 0 };

  // ---------------------------------------------------------------- the studio
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.ShaderMaterial({
    depthWrite: false, vertexShader: VS_UV,
    fragmentShader: 'varying vec2 vUv; void main(){' +
      'vec3 base = mix(vec3(.024,.016,.067), vec3(.045,.022,.10), smoothstep(.0,.42,vUv.y));' +
      'base = mix(base, vec3(.018,.01,.045), smoothstep(.45,.62,vUv.y));' +
      'float g = exp(-pow(distance(vUv*vec2(2.,1.), vec2(1.,.40))*7.5, 2.));' +
      'vec3 col = base + vec3(.36,.13,.62)*g*.42 + vec3(1.,.73,.38)*exp(-pow(distance(vUv*vec2(2.,1.), vec2(1.,.33))*14.,2.))*.06;' +
      'gl_FragColor = vec4(col,1.);\n#include <colorspace_fragment>\n}',
  })).translateZ(-9).translateY(4));
  var floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexShader: VS_UV,
    fragmentShader: 'varying vec2 vUv; void main(){ float d = distance(vUv, vec2(.5));' +
      'vec3 c = mix(vec3(.13,.06,.27), vec3(.024,.016,.067), smoothstep(.0,.42,d));' +
      'float ring = smoothstep(.006,.0,abs(d-.19))*.5 + smoothstep(.004,.0,abs(d-.24))*.3;' +
      'c += vec3(1.,.73,.38)*ring*.35; gl_FragColor = vec4(c, 1.-smoothstep(.4,.5,d));\n#include <colorspace_fragment>\n}',
  }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.62; scene.add(floor);
  var st1 = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.25, 0.28, 96), lacquer); st1.position.y = -0.48; scene.add(st1);
  var st2 = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.9, 0.22, 96), lacquer); st2.position.y = -0.23; scene.add(st2);
  [[3.05, -0.34], [2.75, -0.12]].forEach(function (a) { var t = new THREE.Mesh(new THREE.TorusGeometry(a[0], 0.025, 8, 128), gold); t.rotation.x = Math.PI / 2; t.position.y = a[1]; scene.add(t); });
  var arch = new THREE.Mesh(new THREE.TorusGeometry(3.35, 0.045, 10, 120, Math.PI), gold); arch.position.set(0, 0.05, -1.9); scene.add(arch);
  var neonMat = new THREE.MeshBasicMaterial({ color: '#b26bff' });
  var neon = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.03, 8, 120, Math.PI), neonMat); neon.position.set(0, 0.05, -2.0); scene.add(neon);
  var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#7c3aed', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(8, 6, 1); halo.position.set(0, 2.2, -2.6); scene.add(halo);
  var beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: VS_UV,
    uniforms: { k: { value: 0.09 } },
    fragmentShader: 'uniform float k; varying vec2 vUv; void main(){ float a = smoothstep(0.,.55,vUv.y) * smoothstep(1.,.6,vUv.y) * pow(1.-abs(vUv.x-.5)*2., 1.5); gl_FragColor = vec4(vec3(.62,.42,1.)*a*k, 1.); }',
  });
  // dust motes drifting slowly (moved in the vertex shader: no per-frame CPU work)
  (function () {
    var n = 90, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), seed = new Float32Array(n);
    var cg = new THREE.Color('#ffcf6b'), cp = new THREE.Color('#a855f7');
    for (var i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 11; pos[i * 3 + 1] = Math.random() * 5 - 0.3; pos[i * 3 + 2] = -1.2 - Math.random() * 3;
      var c = Math.random() < 0.3 ? cg : cp; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; seed[i] = Math.random() * 100;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    var m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { time: time, map: { value: glowTex }, scale: { value: 300 } },
      vertexShader: 'uniform float time; uniform float scale; attribute float seed; attribute vec3 color; varying vec3 vC; varying float vA;' +
        'void main(){ vec3 p = position; p.y = mod(position.y + .3 + time*.06 + seed, 5.) - .3; p.x += sin(time*.2 + seed)*.15;' +
        'vA = smoothstep(-.3,.6,p.y) * (1.-smoothstep(3.8,4.7,p.y)); vC = color; vec4 mv = modelViewMatrix*vec4(p,1.); gl_PointSize = .05*scale/-mv.z; gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(vC * texture2D(map, gl_PointCoord).a * vA * .8, 1.); }',
    });
    var pts = new THREE.Points(g, m); scene.add(pts);
    scene.userData.motes = m;
  })();

  // ---------------------------------------------------------------- numbered balls
  var ballCanvases = [], ballMats = [];
  function paintBall(d, font) {
    var c = ballCanvases[d], x = c.getContext('2d');
    x.fillStyle = '#f4efe6'; x.fillRect(0, 0, 512, 256);
    [128, 384].forEach(function (cx) {
      x.beginPath(); x.arc(cx, 128, 70, 0, Math.PI * 2); x.fillStyle = '#e2a94e'; x.fill();
      x.beginPath(); x.arc(cx, 128, 63, 0, Math.PI * 2); x.fillStyle = '#5b21b6'; x.fill();
      x.fillStyle = '#ffffff'; x.font = '900 96px ' + font; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(d), cx, 134);
    });
  }
  for (var d = 0; d < 10; d++) {
    var c = document.createElement('canvas'); c.width = 512; c.height = 256; ballCanvases.push(c);
    paintBall(d, 'system-ui, sans-serif');
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    ballMats.push(new THREE.MeshStandardMaterial({ map: t, roughness: 0.16, metalness: 0, envMapIntensity: 1.15 }));
  }
  if (document.fonts && document.fonts.load) {
    document.fonts.load('900 96px Outfit').then(function (f) {
      if (!f || !f.length) return;
      for (var d = 0; d < 10; d++) { paintBall(d, 'Outfit, system-ui, sans-serif'); ballMats[d].map.needsUpdate = true; }
    }).catch(function () {});
  }
  function labelMesh(text, w, h) {
    var c = document.createElement('canvas'); c.width = 256; c.height = 64;
    var tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    function paint(font) {
      var x = c.getContext('2d'); x.clearRect(0, 0, 256, 64);
      x.font = '800 38px ' + font; x.textAlign = 'center'; x.textBaseline = 'middle';
      var g = x.createLinearGradient(0, 10, 0, 54); g.addColorStop(0, '#fff1c9'); g.addColorStop(0.5, '#ffcf6b'); g.addColorStop(1, '#e59a2f');
      x.fillStyle = g; if ('letterSpacing' in x) x.letterSpacing = '6px'; x.fillText(text, 128, 34); tex.needsUpdate = true;
    }
    paint('system-ui, sans-serif');
    if (document.fonts && document.fonts.load) document.fonts.load('800 38px Outfit').then(function (f) { if (f && f.length) paint('Outfit, system-ui, sans-serif'); }).catch(function () {});
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  }

  var fresnel = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.-abs(dot(normalize(vN), normalize(vV))), 2.6); gl_FragColor = vec4(mix(vec3(.55,.36,.95), vec3(1.,.95,1.), f)*(f*.85+.035), 1.); }',
  });
  var glass = new THREE.MeshStandardMaterial({ color: '#efe6ff', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.1, envMapIntensity: 2.2, depthWrite: false });
  var streak = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: VS_UV,
    fragmentShader: 'varying vec2 vUv; void main(){ float a = (1.-abs(vUv.x-.5)*2.) * smoothstep(0.,.15,vUv.y) * smoothstep(1.,.8,vUv.y); gl_FragColor = vec4(vec3(1.)*a*.32,1.); }',
  });
  var ballGeo = new THREE.SphereGeometry(R_BALL, 20, 14), showGeo = new THREE.SphereGeometry(R_BALL, 36, 24);
  var cyl = new THREE.CylinderGeometry(R_GLASS, R_GLASS, GLASS_H, 64, 1, true);
  var FRONT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.14, 0, 0));
  var LEVEL_W = [0.42, -0.36, 0.5, -0.4, 0.34];

  var towers = X.map(function (x, i) {
    var grp = new THREE.Group(); scene.add(grp);
    var ped = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.74, 0.62, 64), darkMetal); ped.position.set(x, 0.31, 0); grp.add(ped);
    [0.02, 0.6].forEach(function (y) { var tt = new THREE.Mesh(new THREE.TorusGeometry(y < 0.3 ? 0.735 : 0.665, 0.03, 6, 56), gold); tt.rotation.x = Math.PI / 2; tt.position.set(x, y, 0); grp.add(tt); });
    var cradle = new THREE.Vector3(x, 0.2, 1.02);
    var curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 0.86, 0.12), new THREE.Vector3(x, 0.74, 0.62), new THREE.Vector3(x, 0.52, 0.9), cradle.clone().add(new THREE.Vector3(0, 0.22, 0))]);
    var tube = new THREE.TubeGeometry(curve, 32, 0.235, 16, false);
    grp.add(new THREE.Mesh(tube, fresnel)); grp.add(new THREE.Mesh(tube, glass));
    [0.32, 0.98].forEach(function (u) { var p = curve.getPointAt(u), tg = curve.getTangentAt(u); var r = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 6, 32), gold); r.position.copy(p); r.lookAt(p.clone().add(tg)); grp.add(r); });
    var cup = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 12, 48), gold); cup.rotation.x = Math.PI / 2; cup.position.set(x, cradle.y - 0.2, cradle.z); grp.add(cup);
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, 0.36, 24), gold); stem.position.set(x, cradle.y - 0.4, cradle.z); grp.add(stem);
    var sh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.7 }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(x, -0.115, cradle.z); grp.add(sh);
    var g1 = new THREE.Mesh(cyl, glass); g1.position.set(x, GLASS_Y0 + GLASS_H / 2, 0); g1.renderOrder = 2; grp.add(g1);
    var g2 = new THREE.Mesh(cyl, fresnel); g2.position.copy(g1.position); g2.renderOrder = 3; grp.add(g2);
    var s1 = new THREE.Mesh(new THREE.PlaneGeometry(0.09, GLASS_H * 0.92), streak); s1.position.set(x - 0.33, g1.position.y, 0.45); s1.renderOrder = 4; grp.add(s1);
    var s2 = new THREE.Mesh(new THREE.PlaneGeometry(0.04, GLASS_H * 0.85), streak); s2.position.set(x + 0.36, g1.position.y, 0.43); s2.renderOrder = 4; grp.add(s2);
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.64, 0.2, 64), darkMetal); cap.position.set(x, CROWN_Y + 0.1, 0); grp.add(cap);
    [CROWN_Y, CROWN_Y + 0.2].forEach(function (y) { var tt = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.028, 6, 56), gold); tt.rotation.x = Math.PI / 2; tt.position.set(x, y, 0); grp.add(tt); });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2), darkMetal); dome.scale.y = 0.45; dome.position.set(x, CROWN_Y + 0.2, 0); grp.add(dome);
    var fin = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), gold); fin.position.set(x, CROWN_Y + 0.42, 0); grp.add(fin);
    var lab = labelMesh('BALL ' + (i + 1), 0.92, 0.23); lab.position.set(x, CROWN_Y + 0.66, 0.1); grp.add(lab);
    var beam = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 6), beamMat); beam.position.set(x, 2.6, -0.9); grp.add(beam);

    // ten balls: digit order shuffled per tower; slot k → level k>>1, side k&1
    var order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort(function () { return Math.random() - 0.5; });
    var balls = order.map(function (digit, k) {
      var m = new THREE.Mesh(ballGeo, ballMats[digit]);
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      grp.add(m);
      return { mesh: m, digit: digit, level: k >> 1, side: k & 1, spin: (Math.random() - 0.5) * 1.2, grow: 1 };
    });
    // the drawn ball (rides the chute, sits in the cradle) + its glow and gold ring
    var show = new THREE.Mesh(showGeo, ballMats[0]); show.visible = false; grp.add(show);
    var glowMat = new THREE.SpriteMaterial({ map: glowTex, color: '#c084fc', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    var glow = new THREE.Sprite(glowMat); glow.scale.set(1.35, 1.35, 1); glow.position.set(x, cradle.y + 0.05, cradle.z - 0.25); grp.add(glow);
    var ringMat = new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0 });
    var ring = new THREE.Mesh(new THREE.TorusGeometry(R_BALL * SHOW + 0.07, 0.018, 8, 64), ringMat); ring.position.set(x, cradle.y + 0.05, cradle.z); ring.visible = false; grp.add(ring);
    var len = curve.getLength();
    return { x: x, i: i, balls: balls, show: show, glow: glow, glowMat: glowMat, ring: ring, ringMat: ringMat, curve: curve, len: len, cradle: cradle,
      drawn: null /* {digit, ball, t0, from, q0, fired} */, leaving: null, glowTo: 0, goldTo: 0, gold: 0 };
  });

  var key = new THREE.DirectionalLight('#fff1dd', 2.1); key.position.set(1.5, 5, 6); scene.add(key);
  scene.add(new THREE.HemisphereLight('#cdb6ff', '#12062a', 0.55));
  var warm = new THREE.PointLight('#ffbb60', 3, 5, 1.8); warm.position.set(0, 1.0, 2.4); scene.add(warm);

  // ---------------------------------------------------------------- motion
  var hooks = {}, mix = 0, mixTo = 0, clockT = 0, last = performance.now();
  var tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), rollQ = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0);

  // both balls of a level stay opposite each other: one angle per level (integrated, so a change of
  // pace never jumps), levels 0.47 apart with a small bob — balls never touch
  towers.forEach(function (T) {
    T.ang = [0, 1, 2, 3, 4].map(function (L) { return T.i * 1.1 + L * 2.3; });
    T.bob = [0, 1, 2, 3, 4].map(function (L) { return L * 1.7 + T.i; });
  });
  function slotPos(T, b, out) {
    var ang = T.ang[b.level] + b.side * Math.PI;
    var r = 0.28 + 0.025 * Math.sin(0.7 * clockT + b.level * 1.3);
    var y = GLASS_Y0 + 0.24 + b.level * 0.47 + (0.03 + 0.012 * mix) * Math.sin(T.bob[b.level]);
    return out.set(T.x + Math.cos(ang) * r, y, Math.sin(ang) * r);
  }

  function updateTower(T, now, dt) {
    for (var L = 0; L < 5; L++) { T.ang[L] += LEVEL_W[L] * (1 + 1.8 * mix) * dt; T.bob[L] += (1.1 + 0.9 * mix) * dt; }
    T.balls.forEach(function (b) {
      if (T.drawn && T.drawn.ball === b) return;
      slotPos(T, b, b.mesh.position);
      b.mesh.rotation.y += b.spin * dt * (1 + mix);
      b.mesh.rotation.x += b.spin * 0.4 * dt * (1 + mix);
      if (b.grow < 1) { b.grow = Math.min(1, b.grow + dt / 0.55); b.mesh.scale.setScalar(Math.max(0.001, easeOut(b.grow))); }
    });
    var D = T.drawn;
    if (D) {
      var t = (now - D.t0) / 1000, s = T.show;
      if (t < DROP.glide) { // glide from the vortex to the gate
        var k = ease(clamp01(t / DROP.glide)), gate = T.curve.getPointAt(0);
        s.position.lerpVectors(D.from, gate, k);
        s.position.y += Math.sin(k * Math.PI) * 0.06;
        rollQ.setFromAxisAngle(AX, -T.len / (R_BALL * SHOW * 0.85)); tmpQ.copy(FRONT).multiply(rollQ);
        s.quaternion.slerpQuaternions(D.q0, tmpQ, k);
        s.scale.setScalar(1);
      } else if (t < DROP.glide + DROP.roll) { // roll down the glass chute (accelerating), growing to show size
        if (!D.rolled) { D.rolled = true; if (hooks.roll) hooks.roll(T.i); }
        var u = easeIn(clamp01((t - DROP.glide) / DROP.roll));
        T.curve.getPointAt(u, s.position);
        s.scale.setScalar(1 + (CHUTE - 1) * u);
        rollQ.setFromAxisAngle(AX, -(1 - u) * T.len / (R_BALL * SHOW * 0.85)); s.quaternion.copy(FRONT).multiply(rollQ);
      } else { // settle in the cradle: one small bounce, then still
        var v = clamp01((t - DROP.glide - DROP.roll) / DROP.settle);
        if (!D.landed) { D.landed = true; T.glowTo = 0.5; if (hooks.land) hooks.land(T.i, D.digit); }
        var bounce = v < 0.55 ? Math.sin(v / 0.55 * Math.PI) * 0.05 : Math.sin((v - 0.55) / 0.45 * Math.PI) * 0.012;
        var top = T.cradle.clone().add(tmpV.set(0, 0.22, 0)), seat = T.cradle.clone().add(tmpV.set(0, 0.05, 0));
        s.position.lerpVectors(top, seat, easeOut(Math.min(1, v * 2))); s.position.y += bounce;
        s.scale.setScalar(CHUTE + (SHOW - CHUTE) * easeOut(Math.min(1, v * 2))); s.quaternion.copy(FRONT);
      }
    }
    var L = T.leaving;
    if (L) { // last round's ball melts into the cradle
      var lt = clamp01((now - L.t0) / 450);
      T.show.scale.setScalar(Math.max(0.001, SHOW * (1 - easeIn(lt))));
      T.show.position.y = T.cradle.y + 0.05 - 0.12 * easeIn(lt);
      if (lt >= 1) { T.show.visible = false; T.leaving = null; }
    }
    // glow + gold ring ease (no flashing)
    var gTo = T.goldTo ? 0.85 : T.glowTo, go = T.glowMat.opacity;
    T.glowMat.opacity = go + (gTo - go) * Math.min(1, dt * 5);
    T.gold += ((T.goldTo ? 1 : 0) - T.gold) * Math.min(1, dt * 5);
    T.glowMat.color.setRGB(0.75 + 0.25 * T.gold, 0.52 + 0.29 * T.gold, 0.99 - 0.57 * T.gold);
    T.ringMat.opacity = T.gold; T.ring.visible = T.gold > 0.01;
    T.ring.scale.setScalar(0.85 + 0.15 * easeOut(T.gold));
  }

  // ---------------------------------------------------------------- api
  function drop(i, digit, instant) {
    var T = towers[i];
    if (!T || (T.drawn && T.drawn.digit === digit)) return;
    var b = T.balls.filter(function (x) { return x.digit === digit; })[0];
    if (!b) return;
    finishLeave(T);
    if (T.drawn) { T.drawn.ball.mesh.visible = true; T.drawn.ball.grow = 0; } // a missed reset
    var now = performance.now();
    T.show.material = ballMats[digit];
    T.show.visible = true;
    T.show.position.copy(b.mesh.position); T.show.quaternion.copy(b.mesh.quaternion); T.show.scale.setScalar(1);
    b.mesh.visible = false;
    T.drawn = { digit: digit, ball: b, t0: instant ? now - 10000 : now, from: b.mesh.position.clone(), q0: b.mesh.quaternion.clone(), landed: !!instant, rolled: !!instant };
    if (instant) { T.glowTo = 0.5; updateTower(T, now, 0); }
    else if (hooks.release) hooks.release(i);
  }
  function finishLeave(T) { if (T.leaving) { T.show.visible = false; T.leaving = null; } }
  function reset() { // new round: drawn balls go back into their towers
    var now = performance.now();
    towers.forEach(function (T) {
      T.glowTo = 0; T.goldTo = 0;
      var D = T.drawn;
      if (!D) return;
      T.drawn = null;
      T.leaving = { t0: now };
      D.ball.mesh.visible = true; D.ball.grow = 0; D.ball.mesh.scale.setScalar(0.001);
    });
  }

  var W = 1, H = 1, A = { L: 0, T: 0, W: 1, H: 1 }, phone = true;
  function resize(w, h, area) {
    W = Math.max(1, Math.round(w)); H = Math.max(1, Math.round(h)); A = area; phone = w < 900;
    renderer.setSize(W, H, false);
    var top = phone ? 50 : 12;
    var f = { x: A.L, y: A.T + top, w: A.W, h: Math.max(80, A.H - top) };
    var cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    var fw = 2 * Math.max(cx, W - cx), fh = 2 * Math.max(cy, H - cy);
    var tp = Math.tan(THREE.MathUtils.degToRad(13));
    var hw = WORLD.y1 - WORLD.y0, dist = Math.max(hw / 2, WORLD.w / 2 / (f.w / f.h)) / tp;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tp * fh / f.h));
    camera.aspect = fw / fh;
    var mid = (WORLD.y0 + WORLD.y1) / 2;
    camera.position.set(0, mid + dist * Math.tan(THREE.MathUtils.degToRad(7)), dist + 0.9);
    camera.lookAt(0, mid, 0.9);
    camera.setViewOffset(fw, fh, fw / 2 - cx, fh / 2 - cy, W, H);
    camera.updateProjectionMatrix();
    moteScale();
    render(true);
  }
  function moteScale() { scene.userData.motes.uniforms.scale.value = camera.projectionMatrix.elements[5] * H * pr / 2; }
  function project(x, y, z) {
    var p = tmpV.set(x, y, z).project(camera);
    return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
  }

  // ---------------------------------------------------------------- loop (adaptive resolution)
  var slow = 0, frames = 0, acc = 0, running = true;
  function render(force) {
    var now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!force) {
      frames++; acc += dt;
      if (frames >= 90) { // ~1.5 s window: under ~45 fps → lower the pixel ratio a step (never raised again)
        if (acc / frames > 0.022 && pr > 1) { pr = Math.max(1, pr - 0.25); renderer.setPixelRatio(pr); renderer.setSize(W, H, false); moteScale(); }
        frames = 0; acc = 0;
      }
    }
    clockT += dt;
    time.value = clockT;
    mix += (mixTo - mix) * Math.min(1, dt * 1.6);
    beamMat.uniforms.k.value = 0.09 + 0.05 * mix;
    towers.forEach(function (T) { updateTower(T, now, dt); });
    var mid = performance.now();
    renderer.render(scene, camera);
    var cost = performance.now() - now;
    perf.n++; perf.ms += cost; perf.upd += mid - now; if (cost > perf.max) perf.max = cost;
  }
  var perf = { n: 0, ms: 0, upd: 0, max: 0 };
  function loop() { if (running) { render(false); requestAnimationFrame(loop); } }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) running = false;
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
  });
  requestAnimationFrame(loop);

  return {
    resize: resize,
    mixing: function (on) { mixTo = on ? 1 : 0; },
    drop: function (i, digit) { drop(i, digit, false); },
    place: function (i, digit) { drop(i, digit, true); },
    glow: function (on) { towers.forEach(function (T) { T.goldTo = on && T.drawn ? 1 : 0; }); },
    reset: reset,
    seated: function (i) { var T = towers[i]; return !!(T && T.drawn && T.drawn.landed); },
    anchor: function () { return { plate: project(0, CROWN_Y + 0.42, 0.3), cradle: project(0, 0.2, 1.02) }; },
    // frame cost on the main thread (update + render submission), for QA; reset on read
    stats: function () { var o = { pr: pr, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, frames: perf.n, avgMs: perf.n ? perf.ms / perf.n : 0, updMs: perf.n ? perf.upd / perf.n : 0, maxMs: perf.max }; perf = { n: 0, ms: 0, upd: 0, max: 0 }; return o; },
    hooks: hooks,
    topColor: '#0b0720',
  };
}
