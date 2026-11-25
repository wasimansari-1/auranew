/* Domino Cascade — the 3D scene (three.js r149, vendor/) and the sounds.
 * window.DominoScene / window.DominoAudio are used by app.js.
 *
 * A line of ivory dominoes (gold pips; every tenth one black lacquer with the gold NX mark) runs
 * across a walnut parquet floor in a grand hall. When the round starts the first tile is pushed and
 * the cascade runs at a fixed rhythm (TILE_RATE tiles a second): the multiplier climbs with it.
 * The round ends when one tile takes the push and stays standing.
 *
 * Everything is scripted (no physics): tile i of the main line starts to fall at i / TILE_RATE
 * seconds; its angle eases in and is limited by the tile it leans on, so the line settles into a
 * neat shingle. The path is built from the round number (same line for every player), with set
 * pieces at the milestones: a spiral branch (2x), a split into two lanes (5x), the NX mark drawn
 * on the floor and seen from above (10x) and a marble stair onto a long marble table (25x).
 * Light: afternoon → golden hour → evening as the multiplier climbs (three hall backdrops).
 *
 * Performance: instanced tiles (one draw per tile look), tiles recycled in rings, only the tiles
 * that move get new matrices, pixel ratio capped, quality tiers (shadows / pixel ratio) that step
 * down automatically if frames are slow.
 */
(function () {
  'use strict';
  var THREE = window.THREE;

  // ---------------------------------------------------------------- constants
  var TILE_RATE = 7;          // main-line tiles falling per second
  var H = 1.0, W = 0.5, T = 0.17, GAP = 0.6; // tile height, width, thickness; spacing centre to centre
  var THETA_LEAN = Math.asin((GAP - T) / H);  // leaning on a standing tile
  var THETA_DOWN = 1.22;                       // settled in the shingle
  var FALL_S = (1 / TILE_RATE) / Math.sqrt(THETA_LEAN / THETA_DOWN); // reaches the next tile exactly in time
  var RISE_S = 0.42;
  var LN = Math.log;
  function secondsAt(m) { return LN(m) / 0.06; } // the engine: x = e^(0.00006·ms)
  var N_SPIRAL = Math.round(secondsAt(2) * TILE_RATE) - 16;
  var N_SPLIT = Math.round(secondsAt(5) * TILE_RATE) - 10, SPLIT_LEN = 52;
  var N_GLYPH = Math.round(secondsAt(10) * TILE_RATE) - 20;
  var N_STAIR = Math.round(secondsAt(25) * TILE_RATE) - 12, STEPS = 5, STEP_TILES = 4, RISE = 0.3;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var BASE = location.pathname.replace(/[^/]*$/, '');
  function loadImage(src) { return new Promise(function (res) { var i = new Image(); i.decoding = 'async'; i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }

  // ---------------------------------------------------------------- the path
  // Tiles: x, z (base centre), y (base height), a (heading: direction (sin a, cos a)), t (seconds
  // after the push when it starts to fall), nx (index of the tile it falls onto, or -1),
  // kind (0..3 ivory looks, 4 black NX, 5 the starter), main (main-line number or -1).
  function Path(seed) {
    var rnd = mulberry(seed * 2654435761 >>> 0 || 7);
    this.tiles = [];
    this.mainIdx = [];      // main-line number → tile index (the left lane during the split)
    this.steps = [];        // stair boxes {x, z, a, len, h}
    this.platformFrom = -1; // main number where the marble table starts
    this.glyph = null;      // {cx, cz, a, w, h} for the crane camera
    this.st = { x: 0, z: 0, a: rnd() * Math.PI * 2, n: 0, y: 0 };
    this.k1 = 0.045 + rnd() * 0.03; this.p1 = 46 + rnd() * 16; this.f1 = rnd() * 6.28;
    this.k2 = 0.02 + rnd() * 0.025; this.p2 = 22 + rnd() * 9; this.f2 = rnd() * 6.28;
    this.lastMain = -1; this.lastLane = [-1, -1];
    this.queue = []; // planned glyph moves (straights / arcs)
  }
  Path.prototype.curv = function (n) {
    if (n >= N_SPLIT - 6 && n < N_SPLIT + SPLIT_LEN + 6) return 0;
    if (n >= N_STAIR - 6 && n < N_STAIR + STEPS * STEP_TILES + 4) return 0;
    var k = this.k1 * Math.sin(n / this.p1 * 6.283 + this.f1) + this.k2 * Math.sin(n / this.p2 * 6.283 + this.f2);
    if (n > N_SPIRAL && n < N_SPIRAL + 70) k = -Math.abs(k) * 0.7; // bend away from the spiral
    if (n < 12) k *= n / 12; // the first tiles: straight out of the starter
    return k;
  };
  Path.prototype.push = function (x, z, y, a, t, kind, main) {
    var i = this.tiles.length;
    this.tiles.push({ x: x, z: z, y: y, a: a, t: t, nx: -1, kind: kind, main: main, gold: false });
    return i;
  };
  Path.prototype.kindFor = function (n) { return n === 0 ? 5 : n % 10 === 9 ? 4 : (n * 7 + 3) % 4; };
  // build the main line (and its branches) up to main number upto
  Path.prototype.grow = function (upto) {
    var st = this.st;
    while (st.n <= upto) {
      var n = st.n, t = n / TILE_RATE, kind = this.kindFor(n);
      // glyph: from N_GLYPH the turtle follows planned moves instead of the S-curves
      if (n === N_GLYPH && !this.glyph) { this.drawGlyph(); continue; }
      // stair heights
      var y = 0;
      if (n >= N_STAIR) {
        var step = Math.floor((n - N_STAIR) / STEP_TILES);
        y = Math.min(STEPS, step + 1) * RISE;
        if (n - N_STAIR < STEPS * STEP_TILES && (n - N_STAIR) % STEP_TILES === 0) this.steps.push({ x: st.x, z: st.z, a: st.a, len: STEP_TILES * GAP, h: (step + 1) * RISE, top: step === STEPS - 1 });
        if (n === N_STAIR + STEPS * STEP_TILES) this.platformFrom = n;
      }
      st.y = y;
      if (n >= N_SPLIT && n < N_SPLIT + SPLIT_LEN) { // two lanes side by side
        var u = n - N_SPLIT, off = 0.42 * smooth(u / 8) * smooth((SPLIT_LEN - 1 - u) / 8);
        var rx = Math.cos(st.a), rz = -Math.sin(st.a); // right of the heading
        var L = this.push(st.x - rx * off, st.z - rz * off, y, st.a, t, kind, n);
        var R = this.push(st.x + rx * off, st.z + rz * off, y, st.a, t, (kind + 1) % 4 === 0 && kind !== 4 ? 1 : kind, -1);
        if (this.lastLane[0] >= 0) { this.tiles[this.lastLane[0]].nx = L; this.tiles[this.lastLane[1]].nx = R; }
        else if (this.lastMain >= 0) this.tiles[this.lastMain].nx = L;
        this.lastLane = [L, R]; this.mainIdx[n] = L; this.lastMain = L;
      } else {
        var i = this.push(st.x, st.z, y, st.a, t, kind, n);
        if (this.lastLane[0] >= 0) { this.tiles[this.lastLane[1]].nx = -2; this.lastLane = [-1, -1]; } // right lane ends against the merge
        if (this.lastMain >= 0) this.tiles[this.lastMain].nx = i;
        this.lastMain = i; this.mainIdx[n] = i;
      }
      if (n === N_SPIRAL) this.spiral(st.x, st.z, st.a, t);
      // advance
      var k;
      if (this.queue.length) {
        var mv = this.queue[0];
        k = mv.k; mv.left -= GAP;
        if (mv.left <= 1e-6) this.queue.shift();
      } else k = this.curv(n);
      st.a += k * GAP;
      st.x += Math.sin(st.a) * GAP; st.z += Math.cos(st.a) * GAP;
      st.n++;
    }
  };
  // 2x: a branch walks out to the left, then curls inward into a spiral (falls beside the main line)
  Path.prototype.spiral = function (x0, z0, a0, t0) {
    var lx = Math.cos(a0), lz = -Math.sin(a0); // to the right of the line, running alongside it, then curling
    var a = a0 + 0.42, x = x0 + lx * 0.7, z = z0 + lz * 0.7, t = t0 + 0.05, prev = -1;
    var straight = 13, r0 = 3.4, r1 = 1.0, turns = 1.9, len = Math.PI * (r0 + r1) * turns, s = 0, i = 0, sx = 0, sz = 0, sn = 0;
    while (true) {
      var k = 0;
      if (i >= straight) { if (s > len) break; var r = lerp(r0, r1, s / len); k = 1 / r; s += GAP; }
      var idx = this.push(x, z, 0, a, t, i % 10 === 9 ? 4 : (i * 3 + 1) % 4, -1);
      if (i >= straight) { sx += x; sz += z; sn++; }
      if (prev >= 0) this.tiles[prev].nx = idx; else this.tiles[this.lastMain] && (this.spiralFirst = idx);
      prev = idx; t += 1 / TILE_RATE; i++;
      a += k * GAP; x += Math.sin(a) * GAP; z += Math.cos(a) * GAP;
    }
    this.spiralC = { x: sx / Math.max(1, sn), z: sz / Math.max(1, sn) };
  };
  // 10x: the main line draws the NX mark on the floor, seen from above. Tiles sit exactly on the
  // letters' strokes; at the corners their heading turns smoothly. The X's other diagonal is a
  // branch from the crossing point, both ways.
  Path.prototype.drawGlyph = function () {
    var st = this.st, u = 1.55, a0 = st.a, ox = st.x, oz = st.z;
    var f = [Math.sin(a0), Math.cos(a0)], r = [-Math.cos(a0), Math.sin(a0)];
    function P(gx, gy) { return [ox + r[0] * gx * u + f[0] * gy * u, oz + r[1] * gx * u + f[1] * gy * u]; }
    var pts = [P(0, 0), P(0, 5), P(3.2, 0), P(3.2, 5), P(4.6, 5), P(8, 0)];
    var segs = [], total = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], L = Math.hypot(dx, dz);
      segs.push({ x: pts[i][0], z: pts[i][1], dx: dx / L, dz: dz / L, L: L, a: Math.atan2(dx, dz), s0: total }); total += L;
    }
    var c = [(pts[4][0] + pts[5][0]) / 2, (pts[4][1] + pts[5][1]) / 2], sCross = segs[4].s0 + segs[4].L / 2;
    var rc = 0.5, n = st.n, crossT = null;
    for (var s = 0; s <= total + 1e-6; s += GAP) {
      var k = 0; while (k < segs.length - 1 && s > segs[k].s0 + segs[k].L) k++;
      var sg = segs[k], d = s - sg.s0, h = sg.a;
      if (k > 0 && d < rc) h = sg.a + wrap(segs[k - 1].a - sg.a) * 0.5 * (1 - d / rc);
      else if (k < segs.length - 1 && sg.L - d < rc) h = sg.a + wrap(segs[k + 1].a - sg.a) * 0.5 * (1 - (sg.L - d) / rc);
      var t = n / TILE_RATE;
      var idx = this.push(sg.x + sg.dx * d, sg.z + sg.dz * d, 0, h, t, 4, n);
      if (this.lastMain >= 0) this.tiles[this.lastMain].nx = idx;
      this.lastMain = idx; this.mainIdx[n] = idx;
      if (crossT == null && s >= sCross) crossT = t;
      n++;
    }
    var last = segs[segs.length - 1], endS = total - (n - 1 - st.n) * GAP;
    st.n = n; st.a = last.a;
    st.x = last.x + last.dx * (last.L - endS + GAP); st.z = last.z + last.dz * (last.L - endS + GAP);
    // leave the mark, then turn back to the line's first heading
    var back = wrap(a0 - st.a);
    this.queue = [{ k: 0, left: 2.4 }, { k: Math.sign(back) / 2.6, left: Math.abs(back) * 2.6 }, { k: 0, left: 4 }];
    this.glyph = { cx: (P(4, 2.5))[0], cz: (P(4, 2.5))[1], a: a0, w: 8 * u, h: 5 * u, x0: P(4.6, 0), x1: P(8, 5), c: c };
    this.glyphBranch(crossT || n / TILE_RATE);
  };
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  Path.prototype.glyphBranch = function (t0) {
    var g = this.glyph, self = this;
    [g.x0, g.x1].forEach(function (end) {
      var dx = end[0] - g.c[0], dz = end[1] - g.c[1], d = Math.hypot(dx, dz), a = Math.atan2(dx, dz), prev = -1;
      for (var s = 0.75, i = 0; s < d; s += GAP, i++) {
        var idx = self.push(g.c[0] + dx / d * s, g.c[1] + dz / d * s, 0, a, t0 + i / TILE_RATE + 0.1, 4, -1);
        if (prev >= 0) self.tiles[prev].nx = idx;
        prev = idx;
      }
    });
  };

  // ---------------------------------------------------------------- textures drawn in code
  function canvasTex(w, h, paint) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    var tx = new THREE.CanvasTexture(c); tx.encoding = THREE.sRGBEncoding; tx.anisotropy = 4;
    return tx;
  }
  var PIPS = { 1: [[0.5, 0.5]], 2: [[0.28, 0.25], [0.72, 0.75]], 3: [[0.28, 0.25], [0.5, 0.5], [0.72, 0.75]], 4: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.75], [0.72, 0.75]],
    5: [[0.28, 0.25], [0.72, 0.25], [0.5, 0.5], [0.28, 0.75], [0.72, 0.75]], 6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]] };
  function faceTex(top, bottom, black, metal) {
    return canvasTex(256, 512, function (g, w, h) {
      if (metal) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
      else {
        var gr = g.createLinearGradient(0, 0, w, h);
        if (black) { gr.addColorStop(0, '#191512'); gr.addColorStop(1, '#0c0a08'); } else { gr.addColorStop(0, '#fbf4e6'); gr.addColorStop(1, '#ece0c8'); }
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }
      var gold = metal ? '#fff' : '#d8ad52';
      g.fillStyle = gold; g.fillRect(w * 0.16, h * 0.497, w * 0.68, h * 0.012);
      [[top, 0], [bottom, 0.5]].forEach(function (half) {
        (PIPS[half[0]] || []).forEach(function (p) {
          var x = p[0] * w, y = (half[1] + p[1] * 0.5) * h, r = w * 0.075;
          if (metal) { g.fillStyle = '#fff'; } else { var pg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); pg.addColorStop(0, '#fff1c2'); pg.addColorStop(0.5, '#d9ad55'); pg.addColorStop(1, '#8c6522'); g.fillStyle = pg; }
          g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        });
      });
    });
  }
  function goldMark(src, sx, sy, sw, sh) { // the real logo, as a gold inlay (its shape, gold colour)
    var c = document.createElement('canvas'); c.width = sw; c.height = sh;
    var g = c.getContext('2d'); g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    g.globalCompositeOperation = 'source-in';
    var gr = g.createLinearGradient(0, 0, sw, sh); gr.addColorStop(0, '#fff0bf'); gr.addColorStop(0.45, '#e2b75c'); gr.addColorStop(1, '#a3772c');
    g.fillStyle = gr; g.fillRect(0, 0, sw, sh);
    return c;
  }
  function logoFace(nxMark, word, black, metal) {
    return canvasTex(256, 512, function (g, w, h) {
      if (metal) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
      else { var gr = g.createLinearGradient(0, 0, w, h); if (black) { gr.addColorStop(0, '#1b1613'); gr.addColorStop(1, '#0b0908'); } else { gr.addColorStop(0, '#fbf4e6'); gr.addColorStop(1, '#ece0c8'); } g.fillStyle = gr; g.fillRect(0, 0, w, h); }
      if (nxMark) {
        var mw = w * 0.8, mh = mw * nxMark.height / nxMark.width;
        if (metal) { g.globalCompositeOperation = 'source-over'; g.drawImage(whiten(nxMark), (w - mw) / 2, h * (word ? 0.26 : 0.38), mw, mh); }
        else g.drawImage(nxMark, (w - mw) / 2, h * (word ? 0.26 : 0.38), mw, mh);
      }
      if (word) {
        var ww = w * 0.84, wh = ww * word.height / word.width;
        if (metal) g.drawImage(whiten(word), (w - ww) / 2, h * 0.62, ww, wh); else g.drawImage(word, (w - ww) / 2, h * 0.62, ww, wh);
        g.fillStyle = metal ? '#fff' : '#d8ad52'; g.fillRect(w * 0.2, h * 0.58, w * 0.6, h * 0.008);
      }
    });
  }
  function whiten(src) { var c = document.createElement('canvas'); c.width = src.width; c.height = src.height; var g = c.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); return c; }

  // ---------------------------------------------------------------- create
  function create(cv, opts) {
    opts = opts || {};
    var V = { W: 1, H: 1, TOP: 0, LEFT: 0, FULL_W: 1, FULL_H: 1, dpr: 1, wide: false, TEXT_BOTTOM: 0 };
    var audio = window.DominoAudio;
    // quality tiers: 2 high (pixel ratio ≤ 2, shadows), 1 mid (≤ 1.5, shadows), 0 low (1, no shadows, plain tiles)
    var tier = window.innerWidth < 900 ? 1 : 2, slowFrames = 0, tierAt = 0;
    var qq = new URLSearchParams(location.search).get('quality');
    if (qq === 'low') tier = 0; else if (qq === 'high') tier = 2;
    var lite = tier === 0;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !lite, powerPreference: 'high-performance', alpha: false });
    } catch (e) { renderer = null; }
    if (!renderer) { if (opts.onLoad) opts.onLoad(); return fallback(cv); }
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    function applyTier() {
      var cap = [1, 1.5, 2][tier];
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
      renderer.shadowMap.enabled = tier > 0;
      sun.castShadow = tier > 0;
      if (V.FULL_W > 1) renderer.setSize(V.FULL_W, V.FULL_H, false);
      materials.forEach(function (m) { m.needsUpdate = true; });
    }

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 140);
    scene.add(camera);
    var FOG = new THREE.Color('#6b5038');
    scene.fog = new THREE.Fog(FOG, 22, 62);
    scene.background = FOG.clone();

    // lights
    var hemi = new THREE.HemisphereLight(0xfff1dc, 0x3a2614, 0.75);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffe2b0, 1.6);
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -11; sun.shadow.camera.right = 11; sun.shadow.camera.top = 11; sun.shadow.camera.bottom = -11;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 60; sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);

    var materials = [];
    var loader = new THREE.TextureLoader();
    function tex(name, srgb) { var t = loader.load(BASE + 'assets/' + name); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; }

    // floor: CC0 parquet, follows the camera, its texture stays put in the world
    var FLOOR = 240, TILE_UV = 2.2;
    var parquet = tex('parquet.webp', true), parquetR = tex('parquet-rough.webp');
    [parquet, parquetR].forEach(function (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(FLOOR / TILE_UV, FLOOR / TILE_UV); });
    var floorMat = new THREE.MeshStandardMaterial({ map: parquet, roughnessMap: parquetR, roughness: 0.5, metalness: 0, color: 0x553926, envMapIntensity: 0.6 });
    materials.push(floorMat);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR, FLOOR), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);

    // marble (stair + table at 25x)
    var marble = tex('marble.webp', true); marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
    var marbleMat = new THREE.MeshStandardMaterial({ map: marble, roughness: 0.22, metalness: 0, color: 0xf2ece4, envMapIntensity: 0.9 });
    materials.push(marbleMat);
    var world = new THREE.Group(); scene.add(world); // stair + table meshes of the current line

    // hall backdrops (three lights): on a yaw-only rig around the camera, far away; the image
    // scrolls with the camera's heading (mirrored repeat: the arcade continues)
    var rig = new THREE.Group(); scene.add(rig);
    var BD_DIST = 64, BD_H = 30;
    var backdrops = ['hall-day.webp', 'hall-gold.webp', 'hall-eve.webp'].map(function (n, i) {
      var t = new THREE.Texture(); t.encoding = THREE.sRGBEncoding; t.wrapS = THREE.MirroredRepeatWrapping; t.repeat.set(3, 1); t.anisotropy = 4;
      var m = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: i ? 0 : 1, fog: false, depthWrite: false, visible: false });
      loadImage(BASE + 'assets/' + n).then(function (img) { // the bottom of the wall melts into the floor's haze
        if (!img) return;
        var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        var g = c.getContext('2d'); g.drawImage(img, 0, 0);
        g.globalCompositeOperation = 'destination-out';
        var gr = g.createLinearGradient(0, c.height * 0.7, 0, c.height); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
        g.fillStyle = gr; g.fillRect(0, c.height * 0.7, c.width, c.height * 0.3);
        t.image = c; t.needsUpdate = true; m.visible = true;
      });
      var w = BD_H * 2.72 * 3;
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, BD_H), m);
      mesh.position.set(0, BD_H / 2 - 0.4, -BD_DIST); mesh.renderOrder = -10 + i;
      rig.add(mesh);
      return { mesh: mesh, mat: m, tex: t };
    });

    // fade plane for the change of line between rounds
    var fadeMat = new THREE.MeshBasicMaterial({ color: 0x1a120b, transparent: true, opacity: 0, depthTest: false, fog: false });
    var fade = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), fadeMat); fade.position.z = -0.5; fade.renderOrder = 100;
    camera.add(fade);

    // ---------------------------------------------------------------- tiles
    var shape = new THREE.Shape(), rr = 0.07, hw = W / 2 - 0.02, hh = H / 2 - 0.02;
    shape.moveTo(-hw + rr, -hh); shape.lineTo(hw - rr, -hh); shape.quadraticCurveTo(hw, -hh, hw, -hh + rr); shape.lineTo(hw, hh - rr);
    shape.quadraticCurveTo(hw, hh, hw - rr, hh); shape.lineTo(-hw + rr, hh); shape.quadraticCurveTo(-hw, hh, -hw, hh - rr); shape.lineTo(-hw, -hh + rr); shape.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
    var geo = new THREE.ExtrudeGeometry(shape, lite ? { depth: T, bevelEnabled: false, curveSegments: 1 } : { depth: T - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 3 });
    if (lite) geo.translate(0, 0, -0.02);
    geo.translate(0, 0, -(T - 0.04) / 2);
    // caps: shape coordinates → 0..1 texture coordinates
    var uv = geo.attributes.uv, gp = geo.attributes.position;
    // the back cap (seen from behind the line, where the camera is) reads the right way round
    for (var ui = 0; ui < uv.count; ui++) { var u0 = uv.getX(ui) / W + 0.5; if (gp.getZ(ui) < -(T / 2 - 0.03)) u0 = 1 - u0; uv.setXY(ui, u0, uv.getY(ui) / H + 0.5); }
    geo.computeBoundingSphere();

    var LOOKS = [[6, 5], [3, 4], [2, 6], [5, 1]];
    var ivorySide = new THREE.MeshStandardMaterial({ color: 0xf1e7d2, roughness: 0.3, metalness: 0, envMapIntensity: 0.8 });
    var blackSide = new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 0.18, metalness: 0, envMapIntensity: 1.0 });
    materials.push(ivorySide, blackSide);
    var RING = [170, 170, 170, 170, 160, 1]; // instances per look (recycled: tiles far behind the front give their slot to new ones)
    var meshes = [];
    function faceMat(map, metalMap, black) {
      var m = new THREE.MeshStandardMaterial({ map: map, metalnessMap: metalMap, metalness: 1, roughness: black ? 0.2 : 0.3, envMapIntensity: 0.9 });
      materials.push(m); return m;
    }
    LOOKS.forEach(function (lk, i) {
      var mats = [faceMat(faceTex(lk[0], lk[1], false, false), faceTex(lk[0], lk[1], false, true), false), ivorySide];
      meshes[i] = makeMesh(mats, RING[i]);
    });
    var logoReady = Promise.all([loadImage(BASE + 'assets/nx-logo.webp'), loadImage(BASE + 'assets/nx-wordmark.webp')]).then(function (im) {
      var nx = im[0] ? goldMark(im[0], 150, 212, 760, 380) : null, word = im[1] ? goldMark(im[1], 64, 390, 876, 190) : null;
      meshes[4] = makeMesh([faceMat(logoFace(nx, null, true, false), logoFace(nx, null, true, true), true), blackSide], RING[4]);
      meshes[5] = makeMesh([faceMat(logoFace(nx, word, false, false), logoFace(nx, word, false, true), false), ivorySide], RING[5]);
    });
    function makeMesh(mats, n) {
      var m = new THREE.InstancedMesh(geo, mats, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      world.add(m);
      return m;
    }

    // ---------------------------------------------------------------- the round's state
    var path = null, seed = 1, phase = 'waiting', pushAt = 0, endAt = -1, endT = Infinity, betAt = 0, lineAt = 0;
    var slots = [], ringUse = [0, 0, 0, 0, 0, 0], built = 0;
    var tag = null;
    var light = { gold: 0, eve: 0 }, lightFrom = null;
    var cam = { pos: new THREE.Vector3(0, 3, 6), look: new THREE.Vector3(), init: false };
    var lastFront = 0, lastClack = 0, crane = 0, craneSoft = 0, standIdx = -1;
    var mat4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(0, 0, 0, 'YXZ'), v4 = new THREE.Vector3(), s4 = new THREE.Vector3(1, 1, 1);
    var isReady = false;

    function newLine(round) {
      seed = (round || 1) >>> 0;
      path = new Path(seed);
      // clear old tiles
      meshes.forEach(function (m) { if (m) { m.count = 0; for (var i = 0; i < m.instanceColor.count; i++) m.instanceColor.setXYZ(i, 1, 1, 1); m.instanceColor.needsUpdate = true; } });
      ringUse = [0, 0, 0, 0, 0, 0]; slots = []; built = 0; tag = null; standIdx = -1;
      for (var c = world.children.length - 1; c >= 0; c--) { var ch = world.children[c]; if (!ch.isInstancedMesh) { world.remove(ch); ch.geometry.dispose(); } }
      stepsBuilt = 0; tableBuilt = -1;
      ensure(140);
      cam.init = false;
    }
    // build tiles up to main number n (and place them)
    var stepsBuilt = 0, tableBuilt = -1;
    function ensure(n) {
      if (!path) return;
      path.grow(n);
      var tl = path.tiles;
      for (; built < tl.length; built++) {
        var tt = tl[built], m = meshes[tt.kind];
        if (!m) { // logo looks not loaded yet: use an ivory look meanwhile
          tt.kind = tt.kind === 5 ? 0 : 1; m = meshes[tt.kind];
        }
        var slot = ringUse[tt.kind] % RING[tt.kind]; ringUse[tt.kind]++;
        slots[built] = slot;
        m.count = Math.min(RING[tt.kind], ringUse[tt.kind]);
        m.instanceColor.setXYZ(slot, 1, 1, 1); m.instanceColor.needsUpdate = true;
        place(built, 0, 1);
      }
      while (stepsBuilt < path.steps.length) addStep(path.steps[stepsBuilt++]);
      if (path.platformFrom >= 0) buildTable();
    }
    function addStep(s) {
      var g = new THREE.BoxGeometry(3.2, s.h, s.len + (s.top ? 0 : 0.02));
      var uvs = g.attributes.uv; for (var i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 1.5, uvs.getY(i) * 1.5);
      var b = new THREE.Mesh(g, marbleMat);
      b.position.set(s.x + Math.sin(s.a) * (s.len / 2 - GAP / 2), s.h / 2, s.z + Math.cos(s.a) * (s.len / 2 - GAP / 2));
      b.rotation.y = s.a; b.receiveShadow = true; b.castShadow = tier > 0;
      world.add(b);
    }
    // the marble table: a ribbon along the main line from the top of the stair, built in chunks
    function buildTable() {
      var from = Math.max(path.platformFrom, tableBuilt), to = path.st.n - 1;
      if (to - from < 40 && tableBuilt >= 0) return;
      var pts = [];
      for (var n = from; n <= to; n++) { var t = path.tiles[path.mainIdx[n]]; if (t) pts.push(t); }
      if (pts.length < 2) return;
      var hwid = 1.6, top = STEPS * RISE, pos = [], uvs = [], idx = [], s = 0;
      pts.forEach(function (t, i) {
        var rx = Math.cos(t.a), rz = -Math.sin(t.a);
        pos.push(t.x - rx * hwid, top, t.z - rz * hwid, t.x + rx * hwid, top, t.z + rz * hwid, t.x - rx * hwid, 0, t.z - rz * hwid, t.x + rx * hwid, 0, t.z + rz * hwid);
        uvs.push(0, s / 3.2, 1, s / 3.2, 0, s / 3.2, 1, s / 3.2);
        if (i) { var b = (i - 1) * 4, c = i * 4; idx.push(b, c, b + 1, b + 1, c, c + 1, b + 2, b, c + 2, c + 2, b, c, b + 1, b + 3, c + 1, c + 1, b + 3, c + 3); }
        s += GAP;
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
      var mesh = new THREE.Mesh(g, marbleMat); mesh.receiveShadow = true; world.add(mesh);
      tableBuilt = to;
    }
    // a tile's matrix: falls about its bottom front edge by angle th; risen k (0..1)
    function place(i, th, rise) {
      var t = path.tiles[i], m = meshes[t.kind]; if (!m) return;
      var sa = Math.sin(t.a), ca = Math.cos(t.a);
      var dy = -(1 - (rise == null ? 1 : rise)) * (H + 0.05);
      // pivot = base + dir * T/2; centre = pivot + R(th) · (0, H/2, -T/2)
      var cy = H / 2 * Math.cos(th) + T / 2 * Math.sin(th), cf = H / 2 * Math.sin(th) - T / 2 * Math.cos(th);
      v4.set(t.x + sa * (T / 2 + cf), t.y + cy + dy, t.z + ca * (T / 2 + cf));
      e4.set(th, t.a, 0); q4.setFromEuler(e4);
      mat4.compose(v4, q4, s4);
      m.setMatrixAt(slots[i], mat4);
      m.instanceMatrix.needsUpdate = true;
    }

    // ---------------------------------------------------------------- engine moments
    function onBetting(now, round) {
      phase = 'betting'; betAt = now; endAt = -1; endT = Infinity;
      lightFrom = { gold: light.gold, eve: light.eve, at: now };
      lineAt = now + 520; // fade out, then the new line rises
      pendingRound = round;
    }
    var pendingRound = null;
    var deferred = [];
    function onStart(now, mid, round, elapsedMs) {
      if (!isReady) { deferred = [['start', now, mid, round, elapsedMs]]; return; }
      if (!path || (round && seed !== (round >>> 0))) newLine(round);
      phase = 'flying'; pushAt = now - (elapsedMs || 0); endAt = -1; endT = Infinity; lightFrom = null; lineAt = 0; fadeMat.opacity = 0;
      if (mid) { settleTo((elapsedMs || 0) / 1000); cam.init = false; }
    }
    function settleTo(sec) { // joined mid-round: everything already fallen lies in the shingle
      ensure(Math.ceil(sec * TILE_RATE) + 140);
      var tl = path.tiles;
      for (var i = 0; i < tl.length; i++) if (tl[i].t < sec - FALL_S * 3) place(i, tl[i].nx === -1 ? Math.PI / 2 - 0.02 : THETA_DOWN, 1);
    }
    function onCrash(now, elapsedMs) {
      if (!isReady || !path) { phase = 'crashed'; endAt = now; endT = (elapsedMs || 0) / 1000; deferred = []; return; }
      phase = 'crashed'; endAt = now;
      endT = (elapsedMs != null ? elapsedMs : now - pushAt) / 1000;
      // the main tile that takes the push and stands
      var n = Math.ceil(endT * TILE_RATE + 1e-6);
      ensure(n + 20);
      standIdx = path.mainIdx[n];
      if (audio) setTimeout(function () { audio.stand(); }, 200);
    }
    function onWin(now, text, elapsedMs) {
      if (!path) return;
      var sec = (elapsedMs != null ? elapsedMs : now - pushAt) / 1000, n = Math.floor(sec * TILE_RATE);
      var i = path.mainIdx[n];
      if (i == null) return;
      var m = meshes[path.tiles[i].kind];
      if (m) { m.instanceColor.setXYZ(slots[i], 1.0, 0.8, 0.42); m.instanceColor.needsUpdate = true; }
      tag = { i: i, text: text, at: now };
      if (audio) audio.cash();
    }

    // ---------------------------------------------------------------- per frame
    function natural(t, sec) {
      if (t.t > endT) return 0; // after the end: still standing
      var u = (sec - t.t) / FALL_S;
      if (u <= 0) return 0;
      var free = t.nx === -1 ? Math.PI / 2 - 0.02 : THETA_DOWN;
      return Math.min(free, THETA_DOWN * u * u);
    }
    function leanOn(aNext) { return THETA_LEAN + (THETA_DOWN - THETA_LEAN) * clamp(aNext / THETA_DOWN, 0, 1); }
    var angles = new Float32Array(0);
    function animateTiles(now, sec) {
      var tl = path.tiles, n = tl.length;
      if (angles.length < n) { var na = new Float32Array(Math.max(n, angles.length * 2 || 512)); na.set(angles); angles = na; }
      // window: tiles whose fall started within the last second (+ the stander and the leaning one)
      var lo = 0, hi = n - 1;
      // walk backwards so a tile's "next" (always later in the list) is computed first
      for (var i = hi; i >= lo; i--) {
        var t = tl[i];
        if (t.t > sec + 0.02 && i !== standIdx) continue;
        if (t.t < sec - 1.2 && !t.dirty) continue; // long settled
        var a = natural(t, sec);
        if (t.nx >= 0 && a > THETA_LEAN * 0.5) a = Math.min(a, leanOn(angles[t.nx]));
        if (t.nx === -2) a = Math.min(a, THETA_LEAN + 0.25);
        if (i === standIdx && endAt >= 0) { // takes the push, rocks, stays
          var tau = sec - endT - 0.05;
          a = tau > 0 ? 0.085 * Math.exp(-tau * 2.2) * Math.abs(Math.sin(tau * 7)) : 0;
        }
        if (Math.abs(a - angles[i]) > 1e-4 || t.dirty) { angles[i] = a; place(i, a, 1); t.dirty = false; }
      }
    }
    function lightTarget(m) {
      var u = LN(Math.max(1, m));
      return { gold: smooth((u - LN(1.7)) / (LN(3.2) - LN(1.7))), eve: smooth((u - LN(6.5)) / (LN(16) - LN(6.5))) };
    }
    var colDay = { sun: new THREE.Color(0xffe2b0), hemi: new THREE.Color(0xfff1dc), fog: new THREE.Color('#5a4230'), sunI: 1.15, hemiI: 0.42 };
    var colGold = { sun: new THREE.Color(0xffb35c), hemi: new THREE.Color(0xffd7a0), fog: new THREE.Color('#5c3a1e'), sunI: 1.3, hemiI: 0.38 };
    var colEve = { sun: new THREE.Color(0xffd29a), hemi: new THREE.Color(0x9aa8d8), fog: new THREE.Color('#2a2129'), sunI: 0.6, hemiI: 0.32 };
    var cTmp = new THREE.Color(), cTmp2 = new THREE.Color();
    function mixCol(key, out) { out.copy(colDay[key]).lerp(colGold[key], light.gold).lerp(colEve[key], light.eve); return out; }
    function applyLight() {
      sun.color.copy(mixCol('sun', cTmp)); hemi.color.copy(mixCol('hemi', cTmp));
      sun.intensity = lerp(lerp(colDay.sunI, colGold.sunI, light.gold), colEve.sunI, light.eve);
      hemi.intensity = lerp(lerp(colDay.hemiI, colGold.hemiI, light.gold), colEve.hemiI, light.eve);
      mixCol('fog', cTmp2); scene.fog.color.copy(cTmp2); scene.background.copy(cTmp2);
      backdrops[1].mat.opacity = light.gold * (1 - light.eve); backdrops[2].mat.opacity = light.eve;
      backdrops[0].mat.opacity = 1;
    }

    var tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3();
    function cameraGoal(now, sec, out, look) {
      var tl = path.tiles, nF = clamp(Math.floor((phase === 'crashed' ? Math.min(sec, endT) : sec) * TILE_RATE), 0, path.st.n - 1);
      if (phase === 'betting' || phase === 'waiting' || sec <= 0) nF = 0;
      var f = tl[path.mainIdx[Math.min(nF + 2, path.st.n - 1)]] || tl[0];
      var ahead = tl[path.mainIdx[Math.min(nF + 9, path.st.n - 1)]] || f;
      // follow: behind and to the right of the falling front, looking a little ahead
      var dx = ahead.x - f.x, dz = ahead.z - f.z, d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      var rx = dz, rz = -dx; // right
      // a three-quarter view from the side of the front: fallen tiles trail one way, standing ones the other
      var dist = V.wide ? 2.6 : 3.4, hgt = V.wide ? 2.3 : 2.5, side = V.wide ? 5.2 : 3.9, ahead2 = 0.9;
      var ending = (phase === 'crashed' || (phase === 'betting' && lineAt)) && standIdx >= 0;
      if (ending) { f = tl[standIdx]; dist = V.wide ? 3.0 : 3.2; hgt = V.wide ? 2.0 : 2.1; side = V.wide ? 5.0 : 3.6; ahead2 = -0.3; } // a step back: the last fallen tile stays in the picture
      else if (phase === 'betting' || phase === 'waiting') { f = tl[path.mainIdx[2]]; dist = 4.2; hgt = 1.5; side = 1.8; ahead2 = 2.6; }
      look.set(f.x + dx * ahead2, f.y + 0.55, f.z + dz * ahead2);
      out.set(f.x - dx * dist + rx * side, f.y + hgt, f.z - dz * dist + rz * side);
      // 10x: crane up over the NX mark while it is being drawn
      var cr = 0, sc = path.spiralC, csp = 0;
      if (sc && phase !== 'betting' && phase !== 'waiting') {
        csp = smooth((nF - (N_SPIRAL + 4)) / 11) * (1 - smooth((nF - (N_SPIRAL + 48)) / 12));
        if (phase === 'crashed') csp *= 1 - smooth((now - endAt - 600) / 1800);
        if (csp > 0) {
          var bx = sc.x - f.x, bz = sc.z - f.z, bl = Math.hypot(bx, bz) || 1; // from the line towards the spiral
          var aspect0 = V.W / Math.max(1, V.H), span0 = 9.5 / Math.max(0.5, Math.min(1.2, aspect0));
          var h0 = span0 / (2 * Math.tan(20 * Math.PI / 180));
          tmpV.set(sc.x - bx / bl * h0 * 0.5, h0 * 0.85, sc.z - bz / bl * h0 * 0.5); tmpL.set(sc.x, 0, sc.z);
          out.lerp(tmpV, csp); look.lerp(tmpL, csp);
        }
      }
      var g = path.glyph;
      if (g && phase !== 'betting') {
        var n0 = N_GLYPH - 6, n1 = N_GLYPH + 64;
        cr = smooth((nF - n0) / 14) * (1 - smooth((nF - n1) / 16));
        if (phase === 'crashed') cr *= 1 - smooth((now - endAt - 600) / 1800);
        if (cr > 0) {
          var fx = Math.sin(g.a), fz = Math.cos(g.a), aspect = V.W / Math.max(1, V.H);
          var span = Math.max(g.h * 1.35, g.w * 1.25 / Math.max(0.45, aspect));
          var hTop = span / (2 * Math.tan(20 * Math.PI / 180));
          tmpV.set(g.cx - fx * 0.6, hTop, g.cz - fz * 0.6); tmpL.set(g.cx, 0, g.cz);
          out.lerp(tmpV, cr); look.lerp(tmpL, cr);
        }
      }
      crane = cr; craneSoft = Math.max(cr, csp);
      return f;
    }
    var upTop = new THREE.Vector3();
    function updateCamera(now, dt, sec) {
      var goal = tmpV2, look = tmpL2;
      cameraGoal(now, sec, goal, look);
      if (!cam.init) { cam.pos.copy(goal); cam.look.copy(look); cam.init = true; }
      // calm: critically damped follow (no jerks), slower for the big moves
      var tau = phase === 'crashed' ? 1.1 : craneSoft > 0.01 ? 0.9 : 0.55;
      var k = 1 - Math.exp(-dt / 1000 / tau);
      cam.pos.lerp(goal, k); cam.look.lerp(look, k);
      camera.position.copy(cam.pos);
      // the crane looks straight down with "up" = the glyph's forward, so the mark reads
      if (crane > 0.01 && path.glyph) { upTop.set(Math.sin(path.glyph.a), 0, Math.cos(path.glyph.a)); camera.up.set(0, 1, 0).lerp(upTop, crane).normalize(); }
      else camera.up.set(0, 1, 0);
      camera.lookAt(cam.look);
      // floor + backdrop + sun follow
      floor.position.x = cam.look.x; floor.position.z = cam.look.z;
      parquet.offset.set(cam.look.x / TILE_UV, -cam.look.z / TILE_UV); parquetR.offset.copy(parquet.offset);
      rig.position.set(camera.position.x, 0, camera.position.z);
      var yaw = Math.atan2(cam.look.x - camera.position.x, cam.look.z - camera.position.z);
      rig.rotation.y = yaw + Math.PI;
      backdrops.forEach(function (b) { b.tex.offset.x = -yaw / (Math.PI * 2) * 2.2; });
      sun.position.set(cam.look.x - 9, 16, cam.look.z - 6); sun.target.position.copy(cam.look);
    }
    var tmpV2 = new THREE.Vector3(), tmpL2 = new THREE.Vector3();

    function frame(now, dt, st) {
      if (!isReady) return;
      if (!path) newLine(st.round || 1);
      if (deferred.length) { var d0 = deferred[0]; deferred = []; if (d0[0] === 'start' && st.phase === 'flying') onStart(now, true, d0[3], st.elapsed); }
      var mult = st.mult || 1;
      // the change of line between rounds: fade out, new line, fade in (tiles rise)
      if (phase === 'betting' && lineAt) {
        var fk = (now - betAt) / 520;
        if (now < lineAt) fadeMat.opacity = smooth(fk) * 0.92;
        else { newLine(pendingRound || seed + 1); lineAt = 0; betAt = now; light.gold = 0; light.eve = 0; lightFrom = null; }
      } else if (fadeMat.opacity > 0) fadeMat.opacity = Math.max(0, fadeMat.opacity - dt / 600);
      // light
      if (phase === 'flying') { var lt = lightTarget(mult); light.gold = lt.gold; light.eve = lt.eve; }
      else if (lightFrom) { light.gold = lightFrom.gold; light.eve = lightFrom.eve; } // the end keeps its light until the new line
      applyLight();
      // time along the cascade
      var sec = phase === 'flying' ? (st.elapsed != null ? st.elapsed / 1000 : (now - pushAt) / 1000) : phase === 'crashed' ? endT + (now - endAt) / 1000 : -1;
      if (phase === 'crashed') sec = Math.min(sec, endT + 4);
      ensure(Math.max(0, Math.floor(Math.max(0, sec) * TILE_RATE)) + 140);
      if (phase === 'betting' && !lineAt) riseLine(now);
      else if (phase === 'flying' || phase === 'crashed') animateTiles(now, sec);
      // sounds: a soft clack for every tile that starts falling (thinned)
      if (phase === 'flying') {
        var front = Math.floor(sec * TILE_RATE);
        if (front > lastFront) { if (audio && now - lastClack > 120) { audio.clack(front); lastClack = now; } if (front % 10 === 0 && audio && [70, 180, 260, 370].indexOf(front) >= 0) audio.bell(); }
        lastFront = front;
      } else lastFront = -1;
      updateCamera(now, dt, Math.max(0, sec));
      // view: the multiplier sits at the top of the play area; push the picture's centre down a bit
      watchSpeed(now, dt); // before drawing: a quality change sizes the canvas, which clears it — after the draw, this frame would show empty
      renderer.render(scene, camera);
    }
    function riseLine(now) { // the new line rises from the floor, a wave from the starter outwards
      var k = (now - betAt) / 1000, tl = path.tiles;
      for (var i = 0; i < Math.min(tl.length, 160); i++) {
        var t0 = i * 0.018, r = smooth((k - t0) / RISE_S);
        if (r !== tl[i].risen) { tl[i].risen = r; place(i, 0, r); }
      }
    }
    // performance watch: step the quality down if frames are slow (never back up in a visit)
    function watchSpeed(now, dt) {
      if (!tierAt) tierAt = now + 2500;
      if (now < tierAt || tier === 0) return;
      if (dt > 24) slowFrames++; else slowFrames = Math.max(0, slowFrames - 0.5);
      if (slowFrames > 40) { tier--; slowFrames = 0; tierAt = now + 3000; applyTier(); }
    }

    function resize(v) {
      V = v;
      // same size: leave the canvas alone — sizing it clears it (a blink), and this runs every time a player joins
      var pr = renderer.getPixelRatio();
      if (cv.width !== Math.floor(v.FULL_W * pr) || cv.height !== Math.floor(v.FULL_H * pr)) renderer.setSize(v.FULL_W, v.FULL_H, false);
      camera.aspect = v.FULL_W / Math.max(1, v.FULL_H);
      // the play area's centre becomes the picture's centre (lens shift), so the line sits under the texts
      var cx = v.LEFT + v.W / 2, cy = v.TOP + v.H * 0.58;
      camera.setViewOffset(v.FULL_W, v.FULL_H, v.FULL_W / 2 - cx, v.FULL_H / 2 - cy, v.FULL_W, v.FULL_H);
      camera.updateProjectionMatrix();
      fade.scale.set(4, 4, 1);
    }

    // environment for reflections: the day hall
    var envReady = loadImage(BASE + 'assets/hall-day.webp').then(function (img) {
      if (!img) return;
      var t = new THREE.Texture(img); t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding; t.needsUpdate = true;
      var pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromEquirectangular(t).texture;
      pm.dispose();
    });
    Promise.all([logoReady, envReady]).then(function () {
      applyTier();
      isReady = true; if (opts.onLoad) opts.onLoad();
    });

    // screen position of my gold tile (for the win tag), or null
    var pv = new THREE.Vector3();
    function tagPos(now) {
      if (!tag || now - tag.at > 2600 || !path) return null;
      var t = path.tiles[tag.i]; pv.set(t.x, t.y + 1.25, t.z).project(camera);
      return { x: (pv.x * 0.5 + 0.5) * V.FULL_W, y: (-pv.y * 0.5 + 0.5) * V.FULL_H, text: tag.text, k: (now - tag.at) / 2600 };
    }
    function topColor() {
      var c = scene.background, hx = function (v) { return ('0' + Math.round(clamp(v, 0, 1) * 255).toString(16)).slice(-2); };
      var top = cTmp.copy(c).lerp(new THREE.Color(0xd9c1a0), 0.25 * (1 - light.eve));
      return '#' + hx(top.r) + hx(top.g) + hx(top.b);
    }
    return {
      resize: resize, frame: frame, onBetting: onBetting, onStart: onStart, onCrash: onCrash, onWin: onWin,
      ready: function () { return isReady; }, topColor: topColor, tagPos: tagPos,
      holding: function () { return phase === 'crashed' || (phase === 'betting' && !!lineAt); },
      endPhrase: pickEnd,
    };
  }

  var ENDS = ['One tile stood firm', 'The cascade rests', 'Standing strong', 'The line holds', 'A tile said no', 'Still standing', 'The run is over', 'Perfectly balanced'];
  var lastEnd = '';
  function pickEnd() { var p = ENDS.filter(function (x) { return x !== lastEnd; }); lastEnd = p[Math.floor(Math.random() * p.length)]; return lastEnd; }

  function fallback(cv) { // no WebGL: a calm still of the hall
    var g = cv.getContext && cv.getContext('2d');
    var img = new Image(); img.src = BASE + 'assets/hall-day.webp';
    var V = null;
    return {
      resize: function (v) {
        V = v;
        var w = Math.round(v.FULL_W * v.dpr), h = Math.round(v.FULL_H * v.dpr);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      },
      frame: function () { if (g && V && img.complete) { g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); var s = Math.max(V.FULL_W / img.width, V.FULL_H / img.height); g.drawImage(img, (V.FULL_W - img.width * s) / 2, 0, img.width * s, img.height * s); } },
      onBetting: function () {}, onStart: function () {}, onCrash: function () {}, onWin: function () {},
      ready: function () { return true; }, topColor: function () { return '#6b5038'; }, tagPos: function () { return null; },
      holding: function () { return false; }, endPhrase: pickEnd,
    };
  }

  window.DominoScene = { create: create };

  // ---------------------------------------------------------------- sounds + music
  // CC0 recordings (LICENSES.txt) in WebAudio: soft ivory clacks as the tiles fall (pitch spread,
  // thinned so it stays calm), the last tile settling, a bell at the set pieces, a chime + coins
  // for my cash-out, keys; the music streams from an <audio> element.
  var A = null, sfx = null, buf = {}, soundOn = true, musicOn = true, music = null, unlocked = false;
  var SB = BASE + 'sounds/';
  var FILES = { c1: 'clack1.mp3', c2: 'clack2.mp3', c3: 'clack3.mp3', c4: 'clack4.mp3', c5: 'clack5.mp3', stand: 'stand.mp3', chime: 'chime.mp3', bell: 'bell.mp3', click: 'click.mp3', cash: 'cash.mp3' };
  function ac() {
    if (A) return A;
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    A = new C(); sfx = A.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(A.destination);
    Object.keys(FILES).forEach(function (n) {
      fetch(SB + FILES[n]).then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .then(function (b) { return b && new Promise(function (res) { A.decodeAudioData(b, res, function () { res(null); }); }); })
        .then(function (d) { if (d) buf[n] = d; }).catch(function () {});
    });
    return A;
  }
  function one(name, vol, rate) {
    if (!A || !soundOn || !buf[name] || A.state !== 'running') return;
    var s = A.createBufferSource(), g = A.createGain();
    s.buffer = buf[name]; s.playbackRate.value = rate || 1; g.gain.value = vol; s.connect(g); g.connect(sfx); s.start();
  }
  function syncMusic() {
    if (!music) { music = new Audio(SB + 'music.mp3'); music.loop = true; music.volume = 0.3; music.preload = 'auto'; }
    if (musicOn && unlocked && !document.hidden) { var p = music.play(); if (p && p.catch) p.catch(function () { unlocked = false; }); } else music.pause();
  }
  window.DominoAudio = {
    unlock: function (gesture) { unlocked = true; syncMusic(); if (!gesture && !A) return; if (!ac()) return; if (A.state === 'suspended') A.resume().catch(function () {}); },
    pause: function (hidden) { if (A) { if (hidden) A.suspend().catch(function () {}); else A.resume().catch(function () {}); } if (music) { if (hidden) music.pause(); else syncMusic(); } },
    setSound: function (on) { soundOn = on; if (sfx) sfx.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.05); },
    setMusic: function (on) { musicOn = on; if (music || on) syncMusic(); },
    click: function () { one('click', 0.45); },
    clack: function (n) { one('c' + (1 + (n * 7) % 5), 0.22, 0.9 + ((n * 13) % 7) * 0.035); },
    stand: function () { one('stand', 0.5, 1); },
    bell: function () { one('bell', 0.35, 1); },
    cash: function () { one('chime', 0.45, 1); one('cash', 0.45, 1); },
  };
})();
