/* Gold Digger — the scene and the sounds. window.GameScene / window.GameAudio are used by app.js.
 *
 * A photoreal miner (the keyed green-screen clips of miner.js) works a gold vein in one of four
 * places (tunnel, crystal cave, open pit, gold vault), picked at random on each visit and never
 * the same as the last one. He is the hero: about 4/5 of the play area tall, boots near its bottom.
 *
 * Betting: he stands ready on the vein. Running: he drills DOWN — a hole opens under the jackhammer
 * and grows wider and deeper with the multiplier, he sinks into it (masked at the hole's front rim),
 * rubble piles up around the rim, and the camera follows him down (the place rises, the dug-out
 * ground comes into view); the hole's rock walls scroll past as he goes deeper, their gold veins
 * richer and glowing; above 5x gold flakes drift down. Cash-out: nuggets burst out of the hole with
 * real physics (arc, spin, bounce, settle, glint) in a golden flash. Bust: a cave-in synced with
 * his clip (he looks up, crouches, then the rocks hit) — rocks of all sizes fall, bounce and pile
 * into the hole on top of him, a dust cloud billows and settles, a short hard shake, darkness.
 * Back to betting: the last frame dissolves into the fresh scene (no pops, no dark frames).
 *
 * Same view on every screen: everything is sized from the play area (right of the bets list,
 * above the results row); wider screens only show more of the place. */
(function () {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6d2b79f5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // The places: photo, the spot where the miner stands (fractions of the photo), top colour, the
  // tint that gives the (neutrally shot) miner the place's warm light, the floor colour.
  var PLACES = {
    tunnel: { sx: 0.46, sy: 0.87, top: '#3a2a18', tint: [1, 0.9, 0.74], floor: [58, 42, 24] },
    cave: { sx: 0.48, sy: 0.86, top: '#51463c', tint: [0.95, 0.95, 0.92], floor: [81, 70, 60] },
    pit: { sx: 0.47, sy: 0.80, top: '#8d6343', tint: [1, 0.91, 0.78], floor: [141, 99, 67] },
    vault: { sx: 0.51, sy: 0.86, top: '#5c4022', tint: [1, 0.88, 0.7], floor: [92, 64, 34] },
  };
  function pickPlace() { // random each visit, never the previous one (?place=… to choose)
    var names = Object.keys(PLACES), want = new URLSearchParams(location.search).get('place'), last = null;
    if (PLACES[want]) return want;
    try { last = localStorage.getItem('golddigger-place'); } catch (e) { /* private mode */ }
    var pool = names.filter(function (n) { return n !== last; }), pick = pool[Math.floor(Math.random() * pool.length)];
    try { localStorage.setItem('golddigger-place', pick); } catch (e) { /* private mode */ }
    return pick;
  }

  // Sprite atlases cut from the design sheets (x, y, w, h).
  var NUGGETS = [[3, 3, 101, 115], [107, 3, 110, 101], [220, 3, 90, 101], [313, 3, 68, 100], [384, 3, 101, 99], [488, 3, 104, 73], [3, 121, 67, 73], [73, 121, 63, 67], [139, 121, 65, 67], [207, 121, 58, 64], [268, 121, 53, 55], [324, 121, 77, 55], [404, 121, 48, 50], [455, 121, 54, 46], [512, 121, 44, 43]];
  var ROCKS = [[3, 3, 103, 109], [109, 3, 105, 107], [217, 3, 93, 107], [313, 3, 108, 104], [3, 115, 124, 103], [130, 115, 73, 100], [206, 115, 144, 96], [353, 115, 93, 91], [3, 221, 99, 86], [105, 221, 100, 86], [208, 221, 69, 77], [280, 221, 78, 76], [361, 221, 66, 68], [430, 221, 55, 66], [3, 310, 56, 63], [62, 310, 58, 62], [123, 310, 61, 49]];

  var BOOTS_Y = 0.965;   // boots at rest: this far down the play area
  var PHOTO_H = 1.5;     // the place photo's height / play-area height (framed tight around him)
  var MAX_PARTS = 240;
  var BUST_HIT = 1.55;   // s after the bust: the rocks hit (he has crouched by then in his clip)
  var BUST_DONE = 3.0;   // s after the bust: the cave-in has settled
  var DIP_OUT = 0.25, DIP_IN = 0.35; // s: back to betting through a warm dust-dark dip (the swap is hidden)

  function loadImage(src) {
    return new Promise(function (res) { var i = new Image(); i.decoding = 'async'; i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; });
  }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function sprite(size, paint) { var c = canvas(size, size); paint(c.getContext('2d'), size); return c; }
  function radial(rgb, stops) {
    return function (g, n) {
      var r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      stops.forEach(function (s) { r.addColorStop(s[0], 'rgba(' + rgb + ',' + s[1] + ')'); });
      g.fillStyle = r; g.fillRect(0, 0, n, n);
    };
  }
  // recolour a picture to a target colour keeping its light/shade (for textures and rocks)
  function recolor(img, rgb, gain) {
    var c = canvas(img.naturalWidth || img.width, img.naturalHeight || img.height), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var d = g.getImageData(0, 0, c.width, c.height), p = d.data, sum = 0, n = 0, i;
    for (i = 0; i < p.length; i += 4) if (p[i + 3] > 128) { sum += p[i] + p[i + 1] + p[i + 2]; n++; }
    var mean = sum / Math.max(1, n) / 3;
    for (i = 0; i < p.length; i += 4) {
      var l = (p[i] + p[i + 1] + p[i + 2]) / 3 / mean * gain;
      p[i] = Math.min(255, rgb[0] * l); p[i + 1] = Math.min(255, rgb[1] * l); p[i + 2] = Math.min(255, rgb[2] * l);
    }
    g.putImageData(d, 0, 0);
    return c;
  }
  // pre-rendered soft sprites (drawn scaled; no gradients built per frame)
  var LIGHT = sprite(128, radial('255,226,160', [[0, 1], [0.35, 0.45], [1, 0]]));
  var SHADOW = sprite(64, radial('0,0,0', [[0, 0.75], [0.5, 0.35], [1, 0]]));
  var DUST = sprite(64, radial('196,168,128', [[0, 0.6], [0.55, 0.25], [1, 0]]));
  var SPARK = sprite(32, function (g, n) {
    radial('255,214,110', [[0, 1], [0.25, 0.6], [1, 0]])(g, n);
    g.strokeStyle = 'rgba(255,250,220,0.95)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(1, n / 2); g.lineTo(n - 1, n / 2); g.moveTo(n / 2, 1); g.lineTo(n / 2, n - 1); g.stroke();
  });
  // the inside of the hole: shadow under the back rim, darker sides, black depth at the bottom
  var HOLE_SHADE = (function () {
    var c = canvas(256, 160), g = c.getContext('2d'), l = g.createLinearGradient(0, 0, 0, 160);
    l.addColorStop(0, 'rgba(0,0,0,0.7)'); l.addColorStop(0.16, 'rgba(0,0,0,0.12)'); l.addColorStop(0.5, 'rgba(0,0,0,0.3)'); l.addColorStop(0.85, 'rgba(0,0,0,0.85)'); l.addColorStop(1, 'rgba(0,0,0,0.95)');
    g.fillStyle = l; g.fillRect(0, 0, 256, 160);
    var s = g.createLinearGradient(0, 0, 256, 0);
    s.addColorStop(0, 'rgba(0,0,0,0.75)'); s.addColorStop(0.25, 'rgba(0,0,0,0.1)'); s.addColorStop(0.75, 'rgba(0,0,0,0.1)'); s.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = s; g.fillRect(0, 0, 256, 160);
    return c;
  })();

  // ---------------------------------------------------------------- scene
  function create(cv, opts) {
    opts = opts || {};
    var ctx = cv.getContext('2d');
    var base = location.pathname.replace(/[^/]*$/, '');
    var placeName = pickPlace(), place = PLACES[placeName];
    var bg = null, nug = null, rocks = null, rockTex = null, goldTex = null, isReady = false;
    var photo = null, blur = null, vignette = null, floorPat = null, wallPat = null, goldPat = null;
    var miner = window.MinerLayer.create(base, { tint: place.tint });
    var audio = window.GameAudio;

    // first screen: the chosen place + the miner still; the rest right after "ready"
    Promise.all([loadImage(base + 'assets/bg-' + placeName + '.webp'), miner.loaded]).then(function (r) {
      bg = r[0]; isReady = true; prerender(); if (opts.onLoad) opts.onLoad();
    });
    var late = false;
    function loadLate() {
      if (late) return; late = true;
      miner.preload();
      loadImage(base + 'assets/nuggets.webp').then(function (i) { nug = i; });
      loadImage(base + 'assets/rocks.webp').then(function (i) { if (i) rocks = recolor(i, place.floor.map(function (v) { return v * 1.15 + 18; }), 1); });
      Promise.all([loadImage(base + 'assets/rock.webp'), loadImage(base + 'assets/gold.webp')]).then(function (r) {
        if (r[0]) rockTex = recolor(r[0], place.floor.map(function (v) { return v * 1.25 + 12; }), 1);
        goldTex = r[1];
        patterns();
      });
    }
    window.addEventListener('nexorng:ready', loadLate);

    var V = { W: 1, H: 1, TOP: 0, LEFT: 0, FULL_W: 1, FULL_H: 1, dpr: 1 };
    var G = {}; // layout: play box (PX, PW, PH), photo (bx, by, bw, bh), spot (x, y), miner height (hf)
    var sizeKey = '';
    function resize(v) {
      var key = [v.W, v.H, v.TOP, v.LEFT, v.FULL_W, v.FULL_H, v.dpr, v.TEXT_BOTTOM].join(',');
      V = v;
      if (key === sizeKey) return; // nothing changed: keep every pre-rendered canvas
      sizeKey = key;
      prerender();
    }
    function layout() {
      var PX = V.LEFT, PW = V.W, PH = V.TOP + V.H, ar = bg ? bg.naturalWidth / bg.naturalHeight : 1600 / 893;
      var wide = window.innerWidth >= 900;
      var hf = PH * (wide ? 0.78 : 0.82); // the miner: as tall as fits under the multiplier text block
      if (V.TEXT_BOTTOM) hf = Math.min(hf, PH * BOOTS_Y - V.TEXT_BOTTOM - PH * 0.015);
      var bh = PH * PHOTO_H, bw = bh * ar;
      var bx = bw >= PW ? clamp(PX + PW / 2 - place.sx * bw, PX + PW - bw, PX) : PX + PW / 2 - place.sx * bw;
      var by = clamp(PH * BOOTS_Y - place.sy * bh, PH - bh, 0);
      G = { PX: PX, PW: PW, PH: PH, bx: bx, by: by, bw: bw, bh: bh, x: bx + place.sx * bw, y: by + place.sy * bh, hf: hf };
    }
    function prerender() {
      layout();
      var dpr = V.dpr;
      if (bg) {
        // the photo at its on-screen size (one high-quality resample, no shimmer), its bottom edge
        // feathered into the dug-out ground that appears when the camera goes down
        photo = canvas(G.bw * dpr, G.bh * dpr);
        var p = photo.getContext('2d');
        p.imageSmoothingQuality = 'high';
        p.drawImage(bg, 0, 0, photo.width, photo.height);
        p.globalCompositeOperation = 'destination-out';
        var f = p.createLinearGradient(0, photo.height * 0.93, 0, photo.height);
        f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(1, 'rgba(0,0,0,1)');
        p.fillStyle = f; p.fillRect(0, photo.height * 0.93, photo.width, photo.height * 0.07);
        var w = Math.max(8, Math.round(V.FULL_W / 8)), h = Math.max(8, Math.round(V.FULL_H / 8));
        blur = canvas(w, h);
        var b = blur.getContext('2d'), k = Math.max(w / bg.naturalWidth, h / bg.naturalHeight) * 1.08;
        if ('filter' in b) b.filter = 'blur(2px)';
        b.drawImage(bg, (w - bg.naturalWidth * k) / 2, (h - bg.naturalHeight * k) / 2, bg.naturalWidth * k, bg.naturalHeight * k);
        b.filter = 'none'; b.fillStyle = 'rgba(0,0,0,0.32)'; b.fillRect(0, 0, w, h);
      }
      var vw = Math.max(8, Math.round(V.FULL_W / 8)), vh = Math.max(8, Math.round(V.FULL_H / 8));
      vignette = canvas(vw, vh);
      var vg = vignette.getContext('2d'), cx = (G.PX + G.PW / 2) / 8, cy = G.PH * 0.6 / 8, R = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy));
      var gr = vg.createRadialGradient(cx, cy, R * 0.25, cx, cy, R);
      gr.addColorStop(0, 'rgba(40,0,0,0)'); gr.addColorStop(1, 'rgba(70,4,0,0.85)');
      vg.fillStyle = gr; vg.fillRect(0, 0, vw, vh);
      patterns();
    }
    function patterns() { // rock textures as patterns at the scene's scale (tile ≈ half the miner)
      if (!rockTex || !G.hf) return;
      function pat(src, gain, size) {
        var T = Math.round(G.hf * size * V.dpr), c = canvas(T, T), g = c.getContext('2d');
        g.drawImage(src, 0, 0, T, T);
        if (gain < 1) { g.fillStyle = 'rgba(0,0,0,' + (1 - gain) + ')'; g.fillRect(0, 0, T, T); }
        return ctx.createPattern(c, 'repeat');
      }
      floorPat = pat(rockTex, 0.8, 0.95);
      wallPat = pat(rockTex, 1, 0.5);
      goldPat = goldTex ? pat(goldTex, 0.85, 0.5) : null;
    }
    function fillPattern(pat, x, y, w, h, ox, oy) { // a pattern locked to the world (ox, oy), drawn at device scale
      ctx.save(); ctx.translate(ox, oy); ctx.scale(1 / V.dpr, 1 / V.dpr);
      ctx.fillStyle = pat; ctx.fillRect((x - ox) * V.dpr, (y - oy) * V.dpr, w * V.dpr, h * V.dpr);
      ctx.restore();
    }

    // ------------------------------------------------------------ round state
    var st = { phase: 'idle', mult: 1 }, parts = [], rubble = [], pile = null;
    var startAt = 0, winAt = 0, bustAt = 0, dip = null, q = 0, hk = 0, heat = 0, hitDone = false, collapse = 0;
    var shakes = []; // damped shakes: { at, amp, f, tau }
    var acc = { chip: 0, dust: 0, spark: 0, glint: 0, flake: 0, grit: 0 };
    var W = {}; // this frame's world geometry: hole (cx, cy, rx, ry), boots (bx, by), camera (cam, z)
    var bit = { x: 0, y: 0 }, lastNow = 0, clinkAt = 0, thudAt = 0;

    function add(p, force) { if (force || parts.length < MAX_PARTS) parts.push(p); }

    function newRubble(seed) { // the dug-out rocks around the rim, revealed as the hole grows
      var r = rng(seed), list = [];
      for (var i = 0; i < 28; i++) {
        var side = r(), th = side < 0.36 ? rand(0.15, 0.95) * Math.PI : side < 0.68 ? Math.PI + rand(-0.35, 0.3) : rand(-0.3, 0.35); // front, left, right
        if (r() < 0.3) th = -rand(0.15, 0.85) * Math.PI; // some behind
        list.push({ th: th, rr: 1.05 + r() * 0.4, s: 0.035 + r() * r() * 0.09, a: 0.03 + r() * 0.85, rot: r() * 6, f: ROCKS[(r() * ROCKS.length) | 0] });
      }
      return list.sort(function (a, b) { return a.a - b.a; });
    }

    function onStart(now) {
      if (bustAt || winAt || (dip && !dip.swapped)) swap(now); // a new round: the old one goes at once (under the dip)
      startAt = now; winAt = 0; bustAt = 0; hitDone = false; collapse = 0;
      rubble = newRubble(now | 0); pile = null;
    }
    function onWin(now) {
      winAt = now;
      var h = W;
      for (var i = 0; i < 38; i++) {
        var a = -Math.PI / 2 + rand(-0.95, 0.95), sp = G.PH * rand(1.0, 1.75), s = G.hf * rand(0.035, 0.075);
        var x0 = h.cx + rand(-0.5, 0.5) * h.rx;
        add({ kind: 'nugget', x: x0, y: h.cy + h.ry * 0.2, vx: Math.cos(a) * sp * 0.75, vy: Math.sin(a) * sp, s: s, rot: rand(0, 6), vr: rand(-9, 9), f: NUGGETS[i % NUGGETS.length], life: 99, delay: i * 0.012, bounces: 0, rest: false, glintAt: rand(0.4, 1.4) }, true);
      }
      for (var j = 0; j < 14; j++) {
        var b = -Math.PI / 2 + rand(-1.2, 1.2), v = G.PH * rand(0.6, 1.4);
        add({ kind: 'spark', x: h.cx + rand(-0.4, 0.4) * h.rx, y: h.cy, vx: Math.cos(b) * v, vy: Math.sin(b) * v, s: G.hf * rand(0.025, 0.05), life: rand(0.4, 0.9) }, true);
      }
    }
    function onBust(now) {
      bustAt = now;
      shakes.push({ at: now, amp: 0.006, f: 11, tau: 1.1 }); // the first rumble
    }
    function cavein() { // the rocks fall (timed so they hit just after he has crouched)
      var h = W, bins = 28, span = Math.max(h.rx * 1.1, G.hf * 0.32); // over him, whatever the hole's size
      pile = { x0: G.x - span * 1.5, w: span * 3, n: bins, hgt: new Float32Array(bins) };
      var top = W.top; // world y of the screen's top edge
      for (var i = 0; i < 30; i++) {
        var big = i < 6, s = G.hf * (big ? rand(0.14, 0.22) : rand(0.04, 0.12));
        var x = G.x + rand(-1, 1) * span * (big ? 0.6 : 1);
        add({ kind: 'rock', x: x, y: top - s - G.PH * rand(0, 0.35), vx: rand(-0.05, 0.05) * G.PH, vy: G.PH * rand(0.2, 0.5), s: s, rot: rand(0, 6), vr: rand(-5, 5), f: ROCKS[i % ROCKS.length], life: 99, delay: (big ? 0.1 : 0) + rand(0, 0.55), bounced: 0, rest: false }, true);
      }
    }
    function impact(now, p) { // a rock lands: the first ones shake the ground and raise the dust
      if (!hitDone) {
        hitDone = true;
        shakes.push({ at: now, amp: 0.03, f: 17, tau: 0.22 });
        var h = W;
        for (var j = 0; j < 14; j++) { // the dust cloud: billows out and up, then sinks and clears
          add({ kind: 'dust', x: h.cx + rand(-1.4, 1.4) * h.rx, y: h.cy - G.hf * rand(0, 0.3), s: G.hf * rand(0.05, 0.1), grow: G.hf * rand(0.14, 0.3), vx: rand(-0.16, 0.16) * G.PH, vy: -G.PH * rand(0.04, 0.12), a: 0.42, life: rand(1.8, 2.6), delay: rand(0, 0.3), settle: true }, true);
        }
      }
      if (now - thudAt > 90) { thudAt = now; audio.thud(clamp(p.s / (G.hf * 0.2), 0.25, 1)); }
    }

    // back to betting: a quick dip into warm dust-dark (the round's scene), the world is reset
    // while fully covered (one miner only, never two), then the fresh scene comes up out of it
    function beginReset(now, quick) {
      if (dip) return;
      dip = { at: now, out: quick ? 0.15 : DIP_OUT, swapped: false };
    }
    function swap(now) {
      parts = []; rubble = []; pile = null; shakes = [];
      winAt = 0; bustAt = 0; startAt = 0; q = 0; hk = 0; heat = 0; hitDone = false; collapse = 0;
      miner.setState('idle', true);
      if (dip) { dip.swapped = true; dip.at = now; }
    }
    function dipCover(now) { // 0..1 cover of the dip; does the swap at full cover
      if (!dip) return 0;
      var t = (now - dip.at) / 1000;
      if (!dip.swapped) { if (t >= dip.out) { swap(now); return 1; } return smooth(t / dip.out); }
      if (t >= DIP_IN) { dip = null; return 0; }
      return 1 - smooth(t / DIP_IN);
    }

    // ------------------------------------------------------------ geometry of this frame
    function geometry() {
      var hf = G.hf;
      var rx = hf * (0.12 * hk + 0.17 * q) * (1 - 0.15 * collapse);
      var ry = rx * 0.3; // the floor's perspective in the photos
      var dep = hf * (0.05 * hk + 0.7 * Math.pow(q, 0.65));
      var cam = 0.6 * dep, z = 1 + 0.06 * q;
      W = { cx: G.x + hf * 0.06, cy: G.y - hf * 0.005, rx: rx, ry: ry, dep: dep, cam: cam, z: z, bx: G.x, by: G.y + dep, top: G.y + cam - G.y / z };
      W.bottom = G.y + cam + (V.FULL_H - G.y) / z;
      return W;
    }
    function frontArc(x) { // the hole's front rim at x (world), or null outside it
      var u = (x - W.cx) / W.rx;
      return Math.abs(u) < 1 ? W.cy + W.ry * Math.sqrt(1 - u * u) : null;
    }

    // ------------------------------------------------------------ particles
    function spawn(dt, drilling) {
      var s = dt / 1000, h = W;
      function every(k, rate, make) { acc[k] += rate * s; while (acc[k] >= 1) { acc[k] -= 1; make(); } }
      every('glint', drilling ? 3 + 26 * heat : 1.5, function () { // twinkles on the vein and the hole's rim
        var onRim = drilling && Math.random() < 0.6, t = rand(0, Math.PI * 2);
        add({ kind: 'glint', x: onRim ? h.cx + Math.cos(t) * h.rx * rand(0.7, 1) : G.x + rand(-0.9, 0.9) * G.hf * 0.7, y: onRim ? h.cy + Math.sin(t) * h.ry * rand(0.7, 1) : G.y + rand(-0.02, 0.08) * G.hf, s: G.hf * rand(0.02, 0.04) * (1 + 0.6 * heat), life: rand(0.4, 0.9) });
      });
      if (bustAt) { // grit trickling from the roof while it rumbles
        var bt = (lastNow - bustAt) / 1000;
        if (bt < BUST_HIT + 0.3) every('grit', 26, function () { add({ kind: 'grit', x: h.cx + rand(-1.6, 1.6) * h.rx, y: h.top, vx: 0, vy: G.PH * rand(0.1, 0.3), s: G.hf * rand(0.004, 0.012), life: rand(0.8, 1.4) }); });
        return;
      }
      if (!drilling) return;
      var ox = bit.x, oy = bit.y, fa = frontArc(ox);
      if (fa != null && oy > fa - G.hf * 0.01) oy = fa - G.hf * 0.01; // the bit is down in the hole: debris flies out over the rim
      every('chip', 30, function () {
        var a = -Math.PI / 2 + rand(-1.2, 1.2), sp = G.PH * rand(0.3, 0.65), fy = frontArc(ox + Math.cos(a) * sp * 0.3);
        add({ kind: 'chip', x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: G.hf * rand(0.008, 0.02), rot: rand(0, 6), vr: rand(-12, 12), f: ROCKS[(Math.random() * ROCKS.length) | 0], life: rand(0.5, 0.9), floor: (fy != null ? fy : h.cy) + G.hf * rand(0, 0.04) });
      });
      every('dust', 8, function () {
        add({ kind: 'dust', x: ox + rand(-0.04, 0.04) * G.hf, y: oy, s: G.hf * rand(0.05, 0.08), grow: G.hf * rand(0.1, 0.2), vx: rand(-0.12, 0.12) * G.PH, vy: -G.PH * rand(0.03, 0.09), a: 0.4, life: rand(0.8, 1.3) });
      });
      every('spark', 8 + 34 * heat, function () {
        var a = -Math.PI / 2 + rand(-1.1, 1.1), sp = G.PH * rand(0.35, 0.9);
        add({ kind: 'spark', x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: G.hf * rand(0.012, 0.026), life: rand(0.25, 0.55) });
      });
      if (st.mult >= 5 && nug) every('flake', 1 + 6 * Math.log(st.mult / 5 + 1), function () { // gold drifting down above 5x
        var x = G.x + rand(-0.6, 0.6) * G.PW, fy = frontArc(x);
        add({ kind: 'flake', x: x, y: h.top - G.PH * 0.03, vx: 0, vy: G.PH * rand(0.16, 0.3), s: G.hf * rand(0.018, 0.04), rot: rand(0, 6), vr: rand(-2, 2), f: NUGGETS[(Math.random() * NUGGETS.length) | 0], life: 12, sway: rand(0, 6), floor: fy != null ? fy + G.hf * 0.02 : h.cy + rand(-0.5, 1.4) * h.ry });
      });
    }

    function drawAtlas(img, f, x, y, s, rot, alpha) {
      var k = s / Math.max(f[2], f[3]);
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
      ctx.drawImage(img, f[0], f[1], f[2], f[3], -f[2] * k / 2, -f[3] * k / 2, f[2] * k, f[3] * k);
      ctx.restore();
    }
    function soft(img, x, y, w, h, alpha) { if (alpha <= 0.003) return; ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(img, x - w / 2, y - h / 2, w, h); ctx.globalAlpha = 1; }

    function landY(x) { // where a nugget lands: on the front lip over the hole, else on the floor around it
      var fa = frontArc(x);
      return fa != null ? fa + G.hf * rand(0.005, 0.05) : W.cy + rand(-0.4, 1.1) * W.ry + G.hf * 0.01;
    }
    function pileAt(x) { if (!pile) return 0; var i = Math.floor((x - pile.x0) / pile.w * pile.n); return i >= 0 && i < pile.n ? pile.hgt[i] : 0; }
    function pileAdd(x, s) {
      if (!pile) return;
      var i0 = Math.floor((x - s * 0.5 - pile.x0) / pile.w * pile.n), i1 = Math.floor((x + s * 0.5 - pile.x0) / pile.w * pile.n);
      for (var i = Math.max(0, i0); i <= Math.min(pile.n - 1, i1); i++) pile.hgt[i] = Math.max(pile.hgt[i], pileAt(x) + s * 0.65);
    }

    function stepParts(dt, now) {
      var s = dt / 1000, grav = G.PH * 2.6;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.delay > 0) { p.delay -= s; continue; }
        p.t = (p.t || 0) + s;
        if (p.kind === 'chip' || p.kind === 'spark' || p.kind === 'grit') {
          p.vy += grav * (p.kind === 'chip' ? 1 : 0.7) * s; p.x += p.vx * s; p.y += p.vy * s;
          if (p.floor && p.y > p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; p.vr = (p.vr || 0) * 0.5; }
          if (p.vr) p.rot += p.vr * s;
        } else if (p.kind === 'nugget') {
          if (p.rest) { p.glintAt -= s; if (p.glintAt <= 0) { p.glintAt = rand(0.7, 1.8); add({ kind: 'glint', x: p.x + rand(-0.3, 0.3) * p.s, y: p.y - p.s * 0.3, s: p.s * 1.4, life: 0.5 }); } continue; }
          if (p.floor == null && p.vy > 0 && p.t > 0.05) p.floor = landY(p.x);
          p.vy += grav * s; p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s;
          if (p.floor != null && p.y > p.floor) {
            p.y = p.floor; p.bounces++;
            if (now - clinkAt > 45) { clinkAt = now; audio.clink(clamp(p.vy / G.PH, 0.15, 1)); }
            p.vy *= -0.38; p.vx *= 0.65; p.vr *= 0.55;
            if (p.bounces >= 3 || Math.abs(p.vy) < G.PH * 0.08) { p.rest = true; p.vy = 0; p.vx = 0; p.vr = 0; }
          }
        } else if (p.kind === 'rock') {
          if (p.rest) continue;
          if (p.base == null) p.base = frontArc(p.x) != null ? frontArc(p.x) + G.hf * 0.02 : W.cy + rand(-0.3, 0.9) * W.ry;
          p.floor = p.base - pileAt(p.x) - p.s * 0.3; // rocks pile up on the ones already down
          p.vy += G.PH * 3.2 * s; p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s;
          if (p.y >= p.floor && p.vy > 0) {
            p.y = p.floor;
            if (!p.bounced) { impact(now, p); p.bounced = 1; p.vy *= -0.22; p.vx += rand(-0.08, 0.08) * G.PH; p.vr *= 0.5; }
            else { p.rest = true; p.vy = 0; p.vx = 0; p.vr = 0; pileAdd(p.x, p.s); }
          }
        } else if (p.kind === 'dust') {
          p.x += p.vx * s; p.y += p.vy * s; p.vx *= 1 - 0.8 * s;
          if (p.settle) p.vy = lerp(p.vy, G.PH * 0.02, Math.min(1, s * 0.8)); // billows up, then sinks
        } else if (p.kind === 'flake') {
          if (p.y < p.floor) { p.y += p.vy * s; p.x += Math.sin(p.t * 1.6 + p.sway) * G.PH * 0.02 * s; p.rot += p.vr * s; } else if (p.life > p.t + 1.2) p.life = p.t + 1.2;
        }
      }
      parts = parts.filter(function (p) { return !(p.t > p.life); });
    }
    function drawDust() {
      for (var i = 0; i < parts.length; i++) {
        var d = parts[i];
        if (d.kind !== 'dust' || d.delay > 0 || !d.t) continue;
        var k = d.t / d.life, r = d.s + d.grow * ease(k * 1.6);
        soft(DUST, d.x, d.y, r * 2, r * 1.5, d.a * Math.min(1, d.t * 5) * (1 - k * k));
      }
    }
    function drawSolid(kinds) {
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.delay > 0 || !p.t || kinds.indexOf(p.kind) < 0) continue;
        var k = p.t / p.life;
        if (p.kind === 'chip' && rocks) drawAtlas(rocks, p.f, p.x, p.y, p.s, p.rot, 1 - k * k);
        else if (p.kind === 'grit') { ctx.globalAlpha = 0.8 * (1 - k); ctx.fillStyle = '#2a1d12'; ctx.fillRect(p.x, p.y, p.s, p.s * 1.6); ctx.globalAlpha = 1; }
        else if (p.kind === 'nugget' && nug) drawAtlas(nug, p.f, p.x, p.y, p.s, p.rot, Math.min(1, p.t * 8));
        else if (p.kind === 'flake' && nug) drawAtlas(nug, p.f, p.x, p.y, p.s, p.rot, Math.min(1, p.t * 3, (p.life - p.t) / 1.2));
        else if (p.kind === 'rock' && rocks) drawAtlas(rocks, p.f, p.x, p.y, p.s, p.rot, 1);
      }
    }
    function drawGlow() { // additive: sparks, twinkles, the light on flying nuggets
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.delay > 0 || !p.t) continue;
        var k = p.t / p.life;
        if (p.kind === 'spark') soft(SPARK, p.x, p.y, p.s, p.s, 1 - k);
        else if (p.kind === 'glint') { var tw = Math.sin(k * Math.PI); soft(SPARK, p.x, p.y, p.s * tw, p.s * tw, tw); }
        else if (p.kind === 'nugget' && !p.rest) soft(LIGHT, p.x, p.y, p.s * 2, p.s * 2, 0.14);
      }
    }

    // ------------------------------------------------------------ the world
    function edges() { // the blurred copy, only where the photo doesn't reach
      var Wd = V.FULL_W, H = V.FULL_H, x1 = G.bx + G.bw, ox = -20, oy = -20, kx = blur.width / (Wd + 40), ky = blur.height / (H + 40);
      function strip(x, y, w, h) { if (w > 0 && h > 0) ctx.drawImage(blur, (x - ox) * kx, (y - oy) * ky, w * kx, h * ky, x, y, w + 1, h + 1); }
      strip(ox, oy, G.bx - ox, H + 40);
      strip(x1 - 1, oy, Wd + 20 - x1, H + 40);
      strip(G.bx, oy, G.bw, G.by - oy);
    }
    function drawHole(now) {
      var h = W;
      if (h.rx < 1) return;
      var vis = smooth(hk * 1.4);
      // the disturbed ground around the hole
      soft(SHADOW, h.cx, h.cy + h.ry * 0.1, h.rx * 2.9, h.ry * 3.4, 0.55 * vis);
      soft(DUST, h.cx, h.cy + h.ry * 0.3, h.rx * 3.2, h.ry * 3, 0.35 * vis);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(h.cx, h.cy, h.rx, h.ry, 0, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = vis;
      ctx.fillStyle = '#120c07'; ctx.fillRect(h.cx - h.rx, h.cy - h.ry, h.rx * 2, h.ry * 2);
      // the walls scroll up as he digs deeper (locked to his depth), the gold in them grows richer
      if (wallPat) fillPattern(wallPat, h.cx - h.rx, h.cy - h.ry, h.rx * 2, h.ry * 2, h.cx, h.cy - h.dep * 1.6);
      if (goldPat) { ctx.globalAlpha = vis * (0.12 + 0.6 * q); fillPattern(goldPat, h.cx - h.rx, h.cy - h.ry, h.rx * 2, h.ry * 2, h.cx + G.hf * 0.2, h.cy - h.dep * 1.6); }
      ctx.globalAlpha = vis;
      ctx.drawImage(HOLE_SHADE, h.cx - h.rx, h.cy - h.ry, h.rx * 2, h.ry * 2);
      ctx.globalCompositeOperation = 'screen'; // the veins glow, pulsing with the multiplier
      soft(LIGHT, h.cx, h.cy - h.ry * 0.2, h.rx * 1.6, h.ry * 1.5, vis * (0.06 + 0.4 * q) * (0.75 + 0.25 * Math.sin(now / 230)));
      ctx.restore();
      // the rim: lit back edge, dark front lip
      ctx.globalAlpha = vis;
      ctx.lineWidth = Math.max(1.5, G.hf * 0.006);
      ctx.strokeStyle = 'rgba(255,226,180,0.35)'; ctx.beginPath(); ctx.ellipse(h.cx, h.cy, h.rx, h.ry, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.strokeStyle = 'rgba(16,10,5,0.75)'; ctx.lineWidth = Math.max(2, G.hf * 0.012); ctx.beginPath(); ctx.ellipse(h.cx, h.cy, h.rx, h.ry, 0, 0.05 * Math.PI, 0.95 * Math.PI); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    function drawRubble(front) {
      if (!rocks) return;
      for (var i = 0; i < rubble.length; i++) {
        var r = rubble[i], f = Math.sin(r.th) > 0;
        if (f !== front) continue;
        var k = ease((q - r.a) / 0.12);
        if (k <= 0) continue;
        var s = G.hf * r.s * (0.4 + 0.6 * k);
        drawAtlas(rocks, r.f, W.cx + Math.cos(r.th) * W.rx * r.rr, W.cy + Math.sin(r.th) * W.ry * r.rr - s * 0.3, s, r.rot, Math.min(1, k * 2));
      }
    }
    function maskMiner() { // everything below the ground in front of him is hidden (the hole's front rim)
      var h = W, B = 1e5;
      ctx.beginPath();
      ctx.moveTo(-B, -B); ctx.lineTo(B, -B); ctx.lineTo(B, h.cy); ctx.lineTo(h.cx + h.rx, h.cy);
      ctx.ellipse(h.cx, h.cy, h.rx, h.ry, 0, 0, Math.PI, false);
      ctx.lineTo(-B, h.cy); ctx.closePath();
      ctx.clip();
    }

    function shakeOffset(now) {
      var x = 0, y = 0;
      shakes = shakes.filter(function (s) { return now - s.at < s.tau * 5000; });
      shakes.forEach(function (s) {
        var t = (now - s.at) / 1000, a = s.amp * G.PH * Math.exp(-t / s.tau);
        x += a * Math.sin(t * s.f * 6.283); y += a * 0.8 * Math.sin(t * s.f * 6.283 * 1.3 + 1.7);
      });
      return [x, y];
    }

    // ------------------------------------------------------------ frame
    function frame(now, dt, s) {
      st = s; lastNow = now;
      var drilling = s.phase === 'running' && !!s.startedAt;
      var inRound = drilling || winAt || bustAt;
      // back to betting: once the result has been shown (a cave-in plays out first)
      if (s.phase === 'idle' && (winAt || (bustAt && now - bustAt > BUST_DONE * 1000))) beginReset(now);
      if ((s.phase === 'starting' || s.phase === 'launch') && (winAt || bustAt)) beginReset(now, true);
      var cover = dipCover(now);
      // progression 0..1 with the multiplier: the hole, the camera, the glow
      var target = inRound && !bustAt ? clamp(Math.log(Math.max(1, s.mult)) / Math.log(20), 0, 1) : q;
      if (!winAt && !bustAt) q = lerp(q, target, 1 - Math.exp(-dt / 220));
      hk = startAt ? ease((now - startAt) / 900) : 0;
      heat = lerp(heat, drilling ? q : winAt ? Math.max(heat, q) : heat, 1 - Math.exp(-dt / 200));
      if (bustAt) collapse = smooth(((now - bustAt) / 1000 - BUST_HIT) / 0.6);
      if (bustAt && !pile && (now - bustAt) / 1000 > BUST_HIT - 0.75) cavein();
      miner.setState(drilling ? 'drill' : winAt ? 'cash' : bustAt ? 'bust' : 'idle');

      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      if (!bg || !photo) { ctx.fillStyle = '#2a1a0e'; ctx.fillRect(0, 0, V.FULL_W, V.FULL_H); return; }
      geometry();
      var sh = shakeOffset(now);
      // camera: follows him down (cam) with a slight push-in (z) toward the hole
      ctx.translate(sh[0], sh[1]);
      ctx.translate(G.x, G.y); ctx.scale(W.z, W.z); ctx.translate(-G.x, -G.y - W.cam);
      ctx.fillStyle = '#1b120a'; ctx.fillRect(-V.FULL_W, W.top - 50, V.FULL_W * 3, W.bottom - W.top + 100);
      if (G.bx > 0 || G.by > W.top || G.bx + G.bw < V.FULL_W) edges();
      // the dug-out ground in front of the hole (seen when the camera goes down), then the place
      var photoBottom = G.by + G.bh;
      if (floorPat && W.bottom > photoBottom - G.bh * 0.07) {
        fillPattern(floorPat, -V.FULL_W * 0.5, photoBottom - G.bh * 0.07, V.FULL_W * 2, W.bottom - photoBottom + G.bh * 0.07 + 40, G.x, G.y);
        var dg = ctx.createLinearGradient(0, photoBottom - G.bh * 0.07, 0, W.bottom); // the near ground falls into shadow
        dg.addColorStop(0, 'rgba(0,0,0,0)'); dg.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = dg; ctx.fillRect(-V.FULL_W * 0.5, photoBottom - G.bh * 0.07, V.FULL_W * 2, W.bottom - photoBottom + G.bh * 0.07 + 40);
      }
      ctx.drawImage(photo, G.bx, G.by, G.bw, G.bh);

      var hf = G.hf, pulse = 0.5 + 0.5 * Math.sin(now / 260);
      ctx.globalCompositeOperation = 'screen'; // the vein glows brighter as the multiplier climbs
      soft(LIGHT, G.x, G.y + hf * 0.03, hf * (1.1 + 1.0 * heat), hf * (0.2 + 0.2 * heat), 0.08 + 0.4 * heat + 0.1 * heat * pulse);
      ctx.globalCompositeOperation = 'source-over';
      soft(SHADOW, G.x + hf * 0.03, G.y + hf * 0.005, hf * 0.42, hf * 0.07, 0.8 * (1 - smooth(hk * 2))); // contact shadow at rest

      drawHole(now);
      drawRubble(false);
      ctx.globalCompositeOperation = 'screen'; // all the big warm light is BEHIND him: he never washes out
      if (heat > 0.02 && !bustAt) soft(LIGHT, G.x, W.cy - hf * 0.6, G.PH * 1.4, G.PH * 1.3, heat * (0.1 + 0.12 * pulse));
      if (winAt) { // the golden moment: a flash that builds and fades, a column of light out of the hole
        var wk0 = (now - winAt) / 1000, env0 = wk0 < 0.3 ? smooth(wk0 / 0.3) : Math.exp(-(wk0 - 0.3) / 0.6);
        soft(LIGHT, G.x, W.cy - hf * 0.5, G.PW * 1.8, G.PH * 2, 0.45 * env0 + 0.12 * smooth(wk0 / 0.6));
        soft(LIGHT, W.cx, W.cy - hf * 0.5, W.rx * 2.4, hf * 1.5, 0.45 * env0 + 0.15 * smooth(wk0 / 0.4));
      }
      ctx.globalCompositeOperation = 'source-over';

      // the miner, sunk into the hole (masked at its front rim); the jackhammer's vibration on top
      var jx = 0, jy = 0;
      if (drilling) { var tt = now / 1000, jk = miner.video() ? 0.5 : 1; jx = (Math.sin(tt * 144) + 0.5 * Math.sin(tt * 233)) * hf * 0.0012 * jk; jy = Math.sin(tt * 181) * hf * 0.0012 * jk; }
      ctx.save();
      if (W.rx > 1) maskMiner();
      var pts = miner.draw(ctx, W.bx + jx, W.by + jy, hf, now);
      ctx.restore();
      bit = pts.bit;

      ctx.globalCompositeOperation = 'screen'; // headlamp, and its beam into the hole while drilling
      soft(LIGHT, pts.lamp.x, pts.lamp.y, hf * 0.22, hf * 0.22, bustAt ? 0.25 : 0.45);
      if (drilling) {
        var fy = frontArc(bit.x), by = fy != null ? Math.min(bit.y, fy) : bit.y;
        soft(LIGHT, lerp(pts.lamp.x, bit.x, 0.55), lerp(pts.lamp.y, by, 0.55), hf * 0.26, hf * 0.6, 0.12);
        soft(LIGHT, bit.x, by, hf * 0.4, hf * 0.12, 0.4 + 0.15 * Math.sin(now / 37));
      }
      ctx.globalCompositeOperation = 'source-over';

      drawRubble(true);
      spawn(dt, drilling);
      stepParts(dt, now);
      drawSolid(['chip', 'nugget', 'flake', 'grit']);
      drawDust();
      drawSolid(['rock']);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow();
      ctx.globalCompositeOperation = 'source-over';

      // screen-space light / colour over everything
      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      if (bustAt) { // darkness and a red vignette once the rocks have hit
        var bk = smooth(((now - bustAt) / 1000 - BUST_HIT + 0.2) / 0.9);
        ctx.globalAlpha = 0.3 * bk; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, V.FULL_W, V.FULL_H);
        ctx.globalAlpha = bk; ctx.drawImage(vignette, 0, 0, V.FULL_W, V.FULL_H); ctx.globalAlpha = 1;
      }
      if (cover > 0) { // the dip: warm dark with a soft dusty glow, never pure black
        ctx.globalAlpha = cover; ctx.fillStyle = '#20150c'; ctx.fillRect(0, 0, V.FULL_W, V.FULL_H);
        ctx.globalAlpha = 1;
        soft(DUST, G.x, G.PH * 0.6, G.PW * 1.4, G.PH * 1.1, 0.35 * cover);
      }
    }

    function topColor() { return place.top; } // the browser bar: the colour at the top of the photo

    return { resize: resize, frame: frame, topColor: topColor, onStart: onStart, onWin: onWin, onBust: onBust, ready: function () { return isReady; }, caveIn: function () { return !!bustAt; } };
  }

  window.GameScene = { create: create };

  // ---------------------------------------------------------------- sounds + music (WebAudio)
  var A = null, sfx = null, music = null, soundOn = true, musicOn = true, drill = null, scheduler = 0, nextNote = 0, step = 0;
  function ac() {
    if (A) return A;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    A = new C();
    var master = A.createGain(); master.gain.value = 0.9; master.connect(A.destination);
    sfx = A.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
    music = A.createGain(); music.gain.value = musicOn ? 0.55 : 0; music.connect(master);
    return A;
  }
  function noise(sec) {
    var b = A.createBuffer(1, Math.max(1, Math.floor(A.sampleRate * sec)), A.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var s = A.createBufferSource(); s.buffer = b; return s;
  }
  function tone(type, f, t, dur, vol, out, glideTo) {
    var o = A.createOscillator(), g = A.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  function burst(t, dur, vol, type, freq, q, out) {
    var n = noise(dur), f = A.createBiquadFilter(), g = A.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(out || sfx); n.start(t); n.stop(t + dur);
  }

  // cheerful folk loop: bass + plucked pentatonic melody + soft shaker (104 bpm)
  var MEL = [0, 2, 4, 7, 9, 7, 4, 2, 0, 4, 7, 12, 9, 7, 4, 2];
  var BASS = [48, 48, 55, 55, 57, 57, 53, 55];
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function schedule() {
    if (!A || !musicOn) return;
    var spb = 60 / 104 / 2; // eighth notes
    while (nextNote < A.currentTime + 0.25) {
      var t = nextNote, bar = Math.floor(step / 8) % 8;
      if (step % 4 === 0) tone('triangle', midi(BASS[bar]), t, spb * 3.6, 0.16, music);
      if (step % 2 === 0 || Math.random() < 0.35) tone('square', midi(72 + MEL[(step + bar * 3) % 16]), t, spb * 0.9, 0.035, music);
      if (step % 2 === 1) burst(t, 0.05, 0.03, 'highpass', 6000, 0.7, music);
      nextNote += spb; step++;
    }
  }

  window.GameAudio = {
    unlock: function () {
      if (!ac()) return;
      if (A.state === 'suspended') A.resume().catch(function () {});
      if (musicOn && !scheduler) { nextNote = A.currentTime + 0.05; scheduler = setInterval(schedule, 90); }
    },
    pause: function (hidden) { if (!A) return; if (hidden) A.suspend().catch(function () {}); else A.resume().catch(function () {}); },
    setSound: function (on) { soundOn = on; if (sfx) sfx.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.05); },
    setMusic: function (on) {
      musicOn = on;
      if (!A) return;
      music.gain.setTargetAtTime(on ? 0.55 : 0, A.currentTime, 0.2);
      if (on && !scheduler) { nextNote = A.currentTime + 0.05; scheduler = setInterval(schedule, 90); }
      if (!on && scheduler) { clearInterval(scheduler); scheduler = 0; }
    },
    click: function () { if (!ac() || !soundOn) return; tone('square', 1150, A.currentTime, 0.04, 0.05); },
    start: function () { // clank + the drill spinning up
      if (!ac() || !soundOn) return;
      var t = A.currentTime;
      burst(t, 0.09, 0.35, 'bandpass', 2200, 2); tone('triangle', 180, t, 0.18, 0.3, null, 90); tone('sine', 900, t + 0.02, 0.12, 0.08);
    },
    loop: function (on, mult) { // the jackhammer: pitch and chatter rise with the multiplier
      if (!A) return;
      if (!drill) {
        var o1 = A.createOscillator(), o2 = A.createOscillator(), f = A.createBiquadFilter(), g = A.createGain(), lfo = A.createOscillator(), lg = A.createGain();
        o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = 0;
        lfo.frequency.value = 22; lg.gain.value = 0.025; lfo.connect(lg); lg.connect(g.gain);
        o1.connect(f); o2.connect(f); f.connect(g); g.connect(sfx); o1.start(); o2.start(); lfo.start();
        drill = { o1: o1, o2: o2, g: g, f: f, lfo: lfo };
      }
      var t = A.currentTime, f0 = 52 + 26 * Math.log(Math.max(1, mult));
      drill.o1.frequency.setTargetAtTime(f0, t, 0.08); drill.o2.frequency.setTargetAtTime(f0 * 2.01, t, 0.08);
      drill.lfo.frequency.setTargetAtTime(20 + 6 * Math.log(Math.max(1, mult)), t, 0.1);
      drill.g.gain.setTargetAtTime(on && soundOn ? 0.045 : 0, t, 0.06);
    },
    win: function () { // cha-ching
      if (!ac() || !soundOn) return;
      var t = A.currentTime;
      [1046, 1318, 1568, 2093].forEach(function (f, i) { tone('triangle', f, t + i * 0.06, 0.25, 0.12); });
      tone('sine', 2637, t + 0.26, 0.7, 0.08); burst(t + 0.24, 0.25, 0.08, 'highpass', 7000, 0.7);
    },
    bust: function () { // the rumble of the cave-in building up (the rocks' impacts come from thud())
      if (!ac() || !soundOn) return;
      var t = A.currentTime, n = noise(3.4), f = A.createBiquadFilter(), g = A.createGain();
      f.type = 'lowpass'; f.frequency.setValueAtTime(160, t); f.frequency.linearRampToValueAtTime(700, t + 1.5); f.frequency.exponentialRampToValueAtTime(120, t + 3.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
      n.connect(f); f.connect(g); g.connect(sfx); n.start(t); n.stop(t + 3.4);
      tone('sine', 48, t, 1.6, 0.2, null, 40);
    },
    thud: function (v) { // a rock hitting the ground
      if (!ac() || !soundOn) return;
      var t = A.currentTime;
      tone('sine', 70, t, 0.5, 0.55 * v, null, 32);
      burst(t, 0.28, 0.5 * v, 'lowpass', 520, 0.8);
      burst(t + 0.03, 0.05, 0.16 * v, 'highpass', 1800 + Math.random() * 1200, 1);
    },
    clink: function (v) { // a gold nugget bouncing
      if (!ac() || !soundOn) return;
      var t = A.currentTime, f = 2300 + Math.random() * 1300;
      tone('triangle', f, t, 0.09, 0.07 * v); tone('sine', f * 1.9, t, 0.06, 0.03 * v);
    },
  };
})();
