/* Lucky 7 — the studio scene: our own game-show host "Lumi" (drawn in code, layered parts:
 * breathing, blinking, gaze, two-bone arms with hands), the bright show set (bulb arch, LED
 * columns, light beams), the table (felt, LED rail, chip float, shoe, discard tray) and the
 * dealt card (DOM, real CSS 3D slide + flip, held by the dealer's hand).
 *
 * World space: 1000 × 660 units (dealer centred, table at the bottom). app.js measures the play
 * area and calls fit(); everything outside the world box is still drawn (full-bleed set).
 *   L7Scene.init(stage) · fit(box) · deal(card, faceHtml) → Promise · showCard(card, faceHtml) · discard()
 *   gesture(name) · react(kind) · mode(name) · toScreen(x, y) · topColour()
 */
(function () {
  'use strict';

  var W0 = 1000, H0 = 660;
  var TRAY = { x: 500, y: 464 }, BOX = { x: 500, y: 548 }, SHOE = { x: 738, y: 486 }, DISCARD = { x: 236, y: 470 };
  var REST = { L: { x: 398, y: 480 }, R: { x: 602, y: 480 } };
  var SHOULDER = { L: { x: 410, y: 298 }, R: { x: 590, y: 298 } };
  var UPPER = 118, FORE = 110;

  var stage, back, bctx, front, fctx, world, cardEl, cardInner, cardFace;
  var dpr = 1, FULL_W = 0, FULL_H = 0, k = 1, ox = 0, oy = 0;
  var now = 0;

  // ---------------------------------------------------------------- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function depth(y) { return 1 + 0.55 * clamp((y - 430) / 230, 0, 1.3); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------- dealer state
  var hands = {
    L: { x: REST.L.x, y: REST.L.y, pose: 'flat', track: null },
    R: { x: REST.R.x, y: REST.R.y, pose: 'flat', track: null },
  };
  var gaze = { x: 500, y: 600, tx: 500, ty: 600, until: 0, hold: 0 };
  var face = { blink: 0, nextBlink: 1500, blinkAt: -1, talkUntil: 0, grin: 0, grinT: 0, brow: 0, browT: 0, nod: 0, nodAt: -1 };
  var set = { mode: 'idle', modeAt: 0, boxGlowT: 0, pile: 6 };
  var tasks = [];
  var confetti = [];
  var card = { on: false, x: SHOE.x, y: SHOE.y, flip: 0, lift: 0, spin: -12, alpha: 1, scale: 1, key: '' };
  var phaseLook = 'betting';

  // Hand tracks: keys [ms from start, x, y, pose] (x = 'rest' returns to the rest spot).
  function play(side, keys) {
    var h = hands[side];
    var t0 = now, list = [{ t: t0, x: h.x, y: h.y, pose: h.pose }];
    keys.forEach(function (kf) {
      var p = kf[1] === 'rest' ? REST[side] : { x: kf[1], y: kf[2] };
      list.push({ t: t0 + kf[0], x: p.x, y: p.y, pose: kf[3] || (kf[1] === 'rest' ? 'flat' : h.pose) });
    });
    h.track = list;
    return list[list.length - 1].t - t0;
  }
  function trackHand(h, side) {
    if (!h.track) {
      // idle: resting on the table edge, breathing with the body
      var r = REST[side], b = Math.sin(now / 1900 + (side === 'L' ? 0 : 1.3));
      h.x = lerp(h.x, r.x + b * 1.5, 0.12); h.y = lerp(h.y, r.y + Math.sin(now / 2600) * 1.2, 0.12);
      h.pose = 'flat';
      return;
    }
    var L = h.track, i = 1;
    while (i < L.length - 1 && now > L[i].t) i++;
    var a = L[i - 1], z = L[i];
    var p = z.t === a.t ? 1 : ease((now - a.t) / (z.t - a.t));
    h.x = lerp(a.x, z.x, p); h.y = lerp(a.y, z.y, p);
    h.pose = p < 0.5 ? a.pose : z.pose;
    if (now >= L[L.length - 1].t) h.track = null;
  }
  function task(delay, dur, fn, done) { tasks.push({ t: now + delay, d: dur, fn: fn, done: done }); }
  function look(x, y, ms) { gaze.tx = x; gaze.ty = y; gaze.hold = now + (ms || 1200); }
  function talk(ms) { face.talkUntil = Math.max(face.talkUntil, now + ms); }
  function smileBig(ms) { face.grinT = now + ms; }
  function brows(ms) { face.browT = now + ms; }

  // ---------------------------------------------------------------- public moments
  function gesture(name) {
    if (name === 'welcome') { // both palms open, presenting the table
      play('L', [[380, 452, 432, 'open'], [1150, 330, 410, 'open'], [1700, 'rest']]);
      play('R', [[380, 548, 432, 'open'], [1150, 670, 410, 'open'], [1700, 'rest']]);
      look(500, 270, 1600); talk(1300); brows(900);
    } else if (name === 'lastCall') { // two taps on the felt
      play('R', [[260, 610, 505, 'flat'], [420, 612, 520], [560, 610, 505], [700, 612, 520], [1100, 'rest']]);
      look(610, 520, 900); talk(700);
    } else if (name === 'noMore') { // palms-down wave over the table
      play('L', [[260, 470, 470, 'flat'], [700, 300, 482], [1000, 'rest']]);
      play('R', [[260, 530, 470, 'flat'], [700, 700, 482], [1000, 'rest']]);
      look(500, 270, 1100); talk(900);
    } else if (name === 'present') { // open palm toward the card
      play('L', [[420, 430, 520, 'open'], [1300, 432, 522, 'open'], [1800, 'rest']]);
      look(500, 260, 1500); talk(1200);
    } else if (name === 'sweep') { // collects the losing chips into the float
      play('L', [[360, 360, 600, 'flat'], [900, 430, 468, 'flat'], [1250, 'rest']]);
      look(400, 560, 900);
    } else if (name === 'pay') { // pushes winning chips from the float to the player
      play('R', [[320, 590, 462, 'grip'], [900, 560, 610, 'flat'], [1350, 'rest']]);
      look(560, 600, 1100);
    } else if (name === 'cheer') { // both hands up, big smile
      play('L', [[380, 372, 250, 'open'], [620, 360, 236, 'open'], [860, 372, 250, 'open'], [1100, 360, 236, 'open'], [1650, 'rest']]);
      play('R', [[380, 628, 250, 'open'], [620, 640, 236, 'open'], [860, 628, 250, 'open'], [1100, 640, 236, 'open'], [1650, 'rest']]);
      look(500, 250, 1600); smileBig(2200); brows(1600); talk(900);
    } else if (name === 'nod') {
      face.nodAt = now; smileBig(1200);
    }
  }

  function mode(name) { set.mode = name; set.modeAt = now; }
  function react(kind) { // 'seven' | 'bigwin' | 'win' | 'plain'
    if (kind === 'seven' || kind === 'bigwin') {
      gesture('cheer'); mode('party'); burst(kind === 'bigwin' ? 160 : 110);
    } else if (kind === 'win') {
      gesture('nod'); mode('flash');
    } else {
      mode('flash'); smileBig(700);
    }
  }

  // Deal: the right hand reaches the shoe, slides the card to the box and flips it.
  function deal(c, faceHtml) {
    return new Promise(function (resolve) {
      setFace(faceHtml, c);
      card.on = true; card.flip = 0; card.lift = 0; card.alpha = 0; card.spin = -14;
      card.x = SHOE.x - 6; card.y = SHOE.y + 8;
      play('R', [[380, SHOE.x, SHOE.y, 'flat'], [560, SHOE.x - 30, SHOE.y + 14, 'grip'], [1080, BOX.x + 10, BOX.y - 22, 'grip'],
        [1200, BOX.x + 58, BOX.y - 6, 'grip'], [1450, BOX.x + 10, BOX.y - 40, 'grip'], [1650, BOX.x - 54, BOX.y - 8, 'flat'], [2150, 'rest']]);
      look(SHOE.x, SHOE.y, 600);
      task(380, 180, function (p) { card.alpha = p; card.x = lerp(SHOE.x - 6, SHOE.x - 30, ease(p)); card.y = lerp(SHOE.y + 8, SHOE.y + 36, ease(p)); });
      task(560, 520, function (p) {
        var e = ease(p);
        card.x = lerp(SHOE.x - 30, BOX.x, e); card.y = lerp(SHOE.y + 36, BOX.y, e); card.spin = lerp(-14, 0, e);
        if (p > 0.4) look(BOX.x, BOX.y, 1400);
      });
      task(560, 0, function () { L7Audio.cue('slide'); });
      task(1200, 450, function (p) { card.flip = 180 * ease(p); card.lift = Math.sin(Math.PI * p) * 46; });
      task(1250, 0, function () { L7Audio.cue('flip'); });
      task(1650, 0, function () { set.boxGlowT = now + 2600; resolve(); });
      task(1700, 0, function () { look(500, 260, 1200); });
    });
  }
  function showCard(c, faceHtml) { // join mid-round / back from the background: face up at once
    setFace(faceHtml, c);
    card.on = true; card.flip = 180; card.lift = 0; card.alpha = 1; card.spin = 0; card.x = BOX.x; card.y = BOX.y; card.scale = 1;
  }
  function setFace(html, c) {
    if (card.key === c) return;
    card.key = c;
    cardFace.innerHTML = html;
  }
  function discard() { // the left hand slides the card off to the discard tray
    if (!card.on) return;
    play('L', [[420, BOX.x - 40, BOX.y - 10, 'grip'], [1100, DISCARD.x + 30, DISCARD.y + 4, 'grip'], [1500, 'rest']]);
    look(BOX.x, BOX.y, 800);
    task(420, 680, function (p) {
      var e = ease(p);
      card.x = lerp(BOX.x, DISCARD.x, e); card.y = lerp(BOX.y, DISCARD.y - 4, e); card.spin = lerp(0, 8, e);
      card.scale = lerp(1, 0.86, e);
      if (p > 0.85) card.alpha = 1 - (p - 0.85) / 0.15;
    }, function () { card.on = false; card.key = ''; set.pile = Math.min(set.pile + 1, 26); tableDirty = true; });
    task(420, 0, function () { L7Audio.cue('slide'); });
  }

  function burst(n) {
    var cols = ['#ffd34d', '#ff4f9a', '#3ee0ff', '#7dff8a', '#b388ff', '#ffffff'];
    for (var i = 0; i < n; i++) {
      confetti.push({
        x: rand(120, 880), y: rand(-80, 40), vx: rand(-0.08, 0.08), vy: rand(0.05, 0.22), r: rand(0, 6.3), vr: rand(-0.012, 0.012),
        w: rand(7, 13), h: rand(4, 7), c: cols[i % cols.length], born: now, life: rand(2200, 3400),
      });
    }
  }

  // ---------------------------------------------------------------- layout
  function init(stageEl) {
    stage = stageEl;
    back = stage.querySelector('#sceneBack'); bctx = back.getContext('2d');
    front = stage.querySelector('#sceneFront'); fctx = front.getContext('2d');
    world = stage.querySelector('#world');
    cardEl = world.querySelector('.card'); cardInner = cardEl.querySelector('.card__inner'); cardFace = cardEl.querySelector('.card__face');
    requestAnimationFrame(frame);
  }

  // box: { LEFT, TOP, W, H, FULL_W, FULL_H } in stage pixels (the play area and the whole stage)
  var fitKey = '';
  function fit(b) {
    var d = Math.min(window.devicePixelRatio || 1, 2);
    // Same place and size as before: nothing to do. This also runs when the bets list changes size
    // (every time a player joins), and sizing a canvas clears it — the table would blink.
    var key = [b.LEFT, b.TOP, b.W, b.H, b.FULL_W, b.FULL_H, d].join(',');
    if (key === fitKey) return;
    fitKey = key;
    dpr = d;
    FULL_W = b.FULL_W; FULL_H = b.FULL_H;
    k = Math.min(b.W / W0, b.H / H0, 1.3);
    ox = b.LEFT + (b.W - W0 * k) / 2;
    oy = b.TOP + b.H - H0 * k; // world bottom on the play area's bottom
    [back, front].forEach(function (c) { c.width = Math.round(FULL_W * dpr); c.height = Math.round(FULL_H * dpr); });
    setCache = cache(setCache); tableCache = cache(tableCache); setDirty = tableDirty = true;
    world.style.transform = 'translate(' + ox.toFixed(2) + 'px,' + oy.toFixed(2) + 'px) scale(' + k.toFixed(4) + ')';
  }
  function toScreen(x, y) { // world → viewport coordinates
    var r = stage.getBoundingClientRect();
    return { x: r.left + ox + x * k, y: r.top + oy + y * k, k: k };
  }
  // The parts of the set and the table that do not move are drawn once into caches (redrawn on
  // resize, or when the chip float / discard pile changes) and copied each frame.
  var setCache = null, tableCache = null, setDirty = true, tableDirty = true;
  function cache(cv) { cv = cv || document.createElement('canvas'); cv.width = back.width; cv.height = back.height; return cv; }
  function prep(cv) {
    var x = cv.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
    x.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    return x;
  }
  function worldView() { return { x0: -ox / k, y0: -oy / k, x1: (FULL_W - ox) / k, y1: (FULL_H - oy) / k }; }

  // ---------------------------------------------------------------- the set
  var TOP_COLOUR = '#1c0a45'; // the scene's top colour (browser bar)
  function topColour() { return TOP_COLOUR; }

  function glow(c, v, a) {
    var rg = c.createRadialGradient(500, 330, 20, 500, 330, 560);
    rg.addColorStop(0, 'rgba(255,190,90,' + (0.75 * a).toFixed(3) + ')');
    rg.addColorStop(0.35, 'rgba(255,92,160,' + (0.45 * a).toFixed(3) + ')');
    rg.addColorStop(1, 'rgba(120,40,200,0)');
    c.fillStyle = rg; c.fillRect(v.x0, v.y0, v.x1 - v.x0, 480 - v.y0);
  }
  function drawSetStatic(c, v) {
    var g = c.createLinearGradient(0, v.y0, 0, 470);
    g.addColorStop(0, TOP_COLOUR); g.addColorStop(0.5, '#3a1585'); g.addColorStop(1, '#6d24b3');
    c.fillStyle = g; c.fillRect(v.x0, v.y0, v.x1 - v.x0, 480 - v.y0);
    glow(c, v, 0.9); // warm glow behind the host
    // LED column housings
    LED_X.forEach(function (x) {
      if (x + 40 < v.x0 || x - 40 > v.x1) return;
      c.fillStyle = 'rgba(14,4,40,0.75)';
      roundRect(c, x - 24, 70, 48, 360, 14); c.fill();
    });
    // the arch: two neon rings and the dark track of the bulb ring
    var rings = [[438, 16, ['#3ee0ff', '#b388ff']], [302, 10, ['#ff4f9a', '#ffd34d']]];
    rings.forEach(function (r) {
      var lg = c.createLinearGradient(500 - r[0], 0, 500 + r[0], 0);
      lg.addColorStop(0, r[2][0]); lg.addColorStop(0.5, r[2][1]); lg.addColorStop(1, r[2][0]);
      c.strokeStyle = lg; c.globalAlpha = 0.28; c.lineWidth = r[1] * 2.4;
      c.beginPath(); c.arc(500, 470, r[0], Math.PI, 2 * Math.PI); c.stroke();
      c.globalAlpha = 1; c.lineWidth = r[1] * 0.55;
      c.beginPath(); c.arc(500, 470, r[0], Math.PI, 2 * Math.PI); c.stroke();
    });
    c.strokeStyle = 'rgba(30,8,60,0.85)'; c.lineWidth = 34;
    c.beginPath(); c.arc(500, 470, 370, Math.PI, 2 * Math.PI); c.stroke();
  }
  var LED_X = [70, 930, -170, 1170, -420, 1420, -680, 1680, -950, 1950];
  var BEAMS = null;

  function drawSetLive(c, v) {
    // flashes on a reveal / celebration
    var boost = set.mode === 'flash' || set.mode === 'party' ? 0.3 * Math.max(0, 1 - (now - set.modeAt) / 1600) : 0;
    if (boost > 0.01) glow(c, v, boost);

    // light beams from the rig (additive)
    c.save();
    c.globalCompositeOperation = 'lighter';
    if (!BEAMS || BEAMS.y0 !== v.y0) {
      BEAMS = [0, 1].map(function (i) {
        var bg = c.createLinearGradient(0, v.y0, 0, 440);
        bg.addColorStop(0, i ? 'rgba(120,220,255,0.16)' : 'rgba(255,140,220,0.16)');
        bg.addColorStop(1, 'rgba(255,255,255,0)');
        return bg;
      });
      BEAMS.y0 = v.y0;
    }
    for (var i = 0; i < 6; i++) {
      var bx = 500 + (i - 2.5) * 300, sway = Math.sin(now / 2600 + i * 1.7) * 0.22 + (i - 2.5) * -0.06;
      c.fillStyle = BEAMS[i % 2];
      c.beginPath();
      c.moveTo(bx - 14, v.y0 - 20); c.lineTo(bx + 14, v.y0 - 20);
      c.lineTo(bx + 110 + sway * 600, 440); c.lineTo(bx - 110 + sway * 600, 440); c.closePath(); c.fill();
    }
    c.restore();

    // LED columns (more of them appear on wide screens)
    LED_X.forEach(function (x, ci) {
      if (x + 40 < v.x0 || x - 40 > v.x1) return;
      for (var s = 0; s < 12; s++) {
        var y = 84 + s * 28.5, wave = 0.5 + 0.5 * Math.sin(now / 380 - s * 0.55 + ci);
        var hue = (now / 40 + s * 14 + ci * 40) % 360;
        if (set.mode === 'party') wave = 0.6 + 0.4 * Math.sin(now / 90 + s);
        c.fillStyle = 'hsla(' + hue.toFixed(0) + ',95%,' + (48 + 22 * wave).toFixed(0) + '%,' + (0.35 + 0.6 * wave).toFixed(2) + ')';
        c.fillRect(x - 15, y, 30, 20);
      }
    });

    // the chasing bulb ring
    var N = 29, speed = set.mode === 'party' ? 70 : set.mode === 'betting' ? 150 : 260;
    var step = Math.floor(now / speed);
    for (var b = 0; b < N; b++) {
      var a = Math.PI + (b + 0.5) / N * Math.PI;
      var x = 500 + Math.cos(a) * 370, y = 470 + Math.sin(a) * 370;
      var lit;
      if (set.mode === 'party') lit = (b + step) % 2 === 0 ? 1 : 0.3;
      else if (set.mode === 'flash') lit = Math.floor(now / 140) % 2 ? 1 : 0.45;
      else lit = (b + step) % 4 === 0 ? 1 : 0.32;
      c.fillStyle = 'rgba(255,214,120,' + (0.22 * lit).toFixed(3) + ')';
      c.beginPath(); c.arc(x, y, 13, 0, 7); c.fill();
      c.fillStyle = lit > 0.9 ? '#fff6d6' : '#c99a4a';
      c.beginPath(); c.arc(x, y, 6.2, 0, 7); c.fill();
    }
    if (set.mode === 'flash' && now - set.modeAt > 1800) set.mode = phaseLook === 'betting' ? 'betting' : 'idle';
    if (set.mode === 'party' && now - set.modeAt > 3200) set.mode = 'idle';
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ---------------------------------------------------------------- the host
  var SKIN = '#e9a47c', SKIN_HI = '#ffc9a3', SKIN_SH = '#c87a57', HAIR = '#2c0f2e', HAIR_HI = '#7d2f73', LIP = '#e23e63';
  var JACKET = '#ff3d8b', JACKET_SH = '#b3125a', GOLD = '#ffcf5a';

  function drawHost(c, breathe) {
    var by = breathe * 1.3, sl = breathe * 1.6;
    // back hair
    var gx = clamp((gaze.x - 500) / 420, -1, 1), gy = clamp((gaze.y - 200) / 380, -1, 1);
    var nod = face.nodAt >= 0 && now - face.nodAt < 700 ? Math.sin((now - face.nodAt) / 700 * Math.PI * 2) * 3 : 0;
    var hx = 500 + gx * 6, hy = 186 + by * 0.7 + gy * 4 + nod, rot = gx * 0.07 + Math.sin(now / 3100) * 0.02;

    // torso
    c.save();
    c.translate(0, by);
    var tg = c.createLinearGradient(360, 0, 640, 0);
    tg.addColorStop(0, JACKET_SH); tg.addColorStop(0.3, JACKET); tg.addColorStop(0.7, JACKET); tg.addColorStop(1, JACKET_SH);
    c.fillStyle = tg;
    c.beginPath();
    c.moveTo(366, 480); c.lineTo(364, 360);
    c.quadraticCurveTo(366, 302 - sl, 410, 291 - sl);
    c.quadraticCurveTo(452, 280, 478, 276); c.lineTo(522, 276);
    c.quadraticCurveTo(548, 280, 590, 291 - sl);
    c.quadraticCurveTo(634, 302 - sl, 636, 360); c.lineTo(634, 480); c.closePath(); c.fill();
    // soft top light
    var sh = c.createRadialGradient(500, 300, 10, 500, 330, 170);
    sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sh; c.fill();
    // blouse V + lapels
    c.fillStyle = '#fff4f8';
    c.beginPath(); c.moveTo(474, 276); c.lineTo(526, 276); c.lineTo(500, 372); c.closePath(); c.fill();
    c.fillStyle = JACKET_SH; c.strokeStyle = GOLD; c.lineWidth = 2.6;
    [-1, 1].forEach(function (s) {
      c.beginPath();
      c.moveTo(500 + s * 26, 276); c.lineTo(500 + s * 44, 300); c.lineTo(500 + s * 30, 318); c.lineTo(500 + s * 42, 330);
      c.lineTo(500 + s * 2, 380); c.lineTo(500 + s * 6, 372); c.closePath(); c.fill(); c.stroke();
    });
    // sequins twinkle
    for (var i = 0; i < 16; i++) {
      var sx = 380 + ((i * 73) % 240), sy = 318 + ((i * 47) % 140);
      if (Math.abs(sx - 500) < 46 && sy < 380) continue;
      var tw = Math.pow(Math.max(0, Math.sin(now / 420 + i * 1.9)), 10);
      if (tw < 0.05) continue;
      star(c, sx, sy, 2 + tw * 5, 'rgba(255,255,255,' + tw.toFixed(2) + ')');
    }
    c.restore();

    // neck
    c.save();
    c.translate(0, by * 0.85);
    c.fillStyle = SKIN;
    c.beginPath(); c.moveTo(484, 236); c.lineTo(516, 236); c.lineTo(520, 282); c.quadraticCurveTo(500, 292, 480, 282); c.closePath(); c.fill();
    c.fillStyle = 'rgba(150,70,40,0.35)';
    c.beginPath(); c.moveTo(484, 240); c.quadraticCurveTo(500, 262, 516, 240); c.lineTo(516, 250); c.quadraticCurveTo(500, 270, 484, 250); c.closePath(); c.fill();
    // necklace with our little 7
    c.strokeStyle = GOLD; c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(482, 278); c.quadraticCurveTo(500, 304, 518, 278); c.stroke();
    c.fillStyle = GOLD; c.font = '800 15px "Segoe UI", Roboto, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('7', 500, 300);
    c.restore();

    // head
    c.save();
    c.translate(hx, hy); c.rotate(rot);
    var hg = c.createLinearGradient(0, -90, 0, 70);
    hg.addColorStop(0, HAIR_HI); hg.addColorStop(0.35, HAIR); hg.addColorStop(1, '#1a0619');
    c.fillStyle = hg;
    c.beginPath();
    c.moveTo(-68, 34); c.bezierCurveTo(-82, -40, -62, -92, 0, -94); c.bezierCurveTo(62, -92, 82, -40, 68, 34);
    c.quadraticCurveTo(70, 62, 50, 66); c.lineTo(-50, 66); c.quadraticCurveTo(-70, 62, -68, 34); c.closePath(); c.fill();
    // ears + earrings
    var swing = Math.sin(now / 520) * 0.12 - rot * 2;
    [-1, 1].forEach(function (s) {
      c.fillStyle = SKIN_SH; c.beginPath(); c.ellipse(s * 50, 4, 9, 13, 0, 0, 7); c.fill();
      c.save(); c.translate(s * 51, 16); c.rotate(swing);
      c.strokeStyle = GOLD; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 9); c.stroke();
      c.fillStyle = GOLD; c.beginPath(); c.arc(0, 14, 5.5, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(-1.6, 12.4, 1.6, 0, 7); c.fill();
      c.restore();
    });
    // face
    var fg = c.createRadialGradient(-12, -22, 6, 0, 0, 72);
    fg.addColorStop(0, SKIN_HI); fg.addColorStop(0.55, SKIN); fg.addColorStop(1, SKIN_SH);
    c.fillStyle = fg;
    c.beginPath();
    c.moveTo(0, -66); c.bezierCurveTo(34, -66, 50, -40, 50, -6); c.bezierCurveTo(50, 30, 28, 62, 0, 64);
    c.bezierCurveTo(-28, 62, -50, 30, -50, -6); c.bezierCurveTo(-50, -40, -34, -66, 0, -66); c.closePath(); c.fill();
    var fy = gy * 3; // looking down shifts the features a little
    c.translate(gx * 3, fy);
    // blush
    c.fillStyle = 'rgba(255,96,120,0.25)';
    c.beginPath(); c.ellipse(-29, 22, 12, 6.5, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(29, 22, 12, 6.5, 0, 0, 7); c.fill();
    // eyes
    var open = 1 - face.blink;
    if (gy > 0.4) open *= 1 - (gy - 0.4) * 0.45; // lids lower when looking down at the table
    [-1, 1].forEach(function (s) { eye(c, s * 19, -2, open, gx, gy, s); });
    // brows
    var lift = face.browT > now ? Math.min(1, (face.browT - now) / 300) * 4 : 0;
    c.strokeStyle = HAIR; c.lineWidth = 3.4; c.lineCap = 'round';
    [-1, 1].forEach(function (s) {
      c.beginPath(); c.moveTo(s * 9, -18 - lift); c.quadraticCurveTo(s * 19, -25 - lift * 1.2, s * 30, -18 - lift * 0.6); c.stroke();
    });
    // nose
    c.strokeStyle = SKIN_SH; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(-4, 16); c.quadraticCurveTo(0, 19, 4, 16); c.stroke();
    c.strokeStyle = 'rgba(255,230,210,0.6)'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(1, -2); c.lineTo(1.5, 10); c.stroke();
    // mouth
    var talking = face.talkUntil > now ? Math.abs(Math.sin(now / 75)) * (0.55 + 0.45 * Math.sin(now / 190)) : 0;
    var grin = face.grinT > now ? Math.min(1, (face.grinT - now) / 300) : 0;
    face.grin = lerp(face.grin, grin, 0.15);
    mouth(c, 0, 35, Math.max(talking * 0.8, face.grin * 0.65), face.grin);
    c.translate(-gx * 3, -fy);
    // fringe, swept to one side
    c.fillStyle = hg;
    c.beginPath();
    c.moveTo(-60, 12); c.bezierCurveTo(-66, -52, -30, -88, 6, -88); c.bezierCurveTo(48, -88, 68, -56, 62, 10);
    c.bezierCurveTo(58, -26, 42, -46, 16, -52); c.bezierCurveTo(-4, -36, -30, -34, -46, -42);
    c.bezierCurveTo(-54, -28, -57, -10, -60, 12); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,150,230,0.35)'; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-34, -72); c.quadraticCurveTo(0, -86, 36, -70); c.stroke();
    // headset mic (game-show host)
    c.strokeStyle = '#1b1b25'; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(-50, 10); c.quadraticCurveTo(-46, 36, -24, 40); c.stroke();
    c.fillStyle = '#1b1b25'; c.beginPath(); c.ellipse(-22, 40, 4.4, 3.4, 0, 0, 7); c.fill();
    c.restore();
  }

  function eye(c, x, y, open, gx, gy, s) {
    c.save();
    c.translate(x, y);
    // shadow
    c.fillStyle = 'rgba(160,70,200,0.22)';
    c.beginPath(); c.ellipse(0, -5, 14, 7, 0, 0, 7); c.fill();
    var hgt = Math.max(0.06, open);
    c.save();
    c.beginPath();
    c.moveTo(-12, 0); c.quadraticCurveTo(0, -11 * hgt, 12, 0); c.quadraticCurveTo(0, 8 * hgt, -12, 0); c.closePath();
    c.fillStyle = '#fff'; c.fill();
    c.clip();
    var ix = gx * 4, iy = gy * 2.6 - 1;
    var ig = c.createRadialGradient(ix, iy, 1, ix, iy, 7);
    ig.addColorStop(0, '#8a4a1e'); ig.addColorStop(1, '#2a1206');
    c.fillStyle = ig; c.beginPath(); c.arc(ix, iy, 6.6, 0, 7); c.fill();
    c.fillStyle = '#120804'; c.beginPath(); c.arc(ix, iy, 3, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(ix + 2, iy - 2.2, 1.8, 0, 7); c.fill();
    c.restore();
    // upper lid + lash flick
    c.strokeStyle = '#25091c'; c.lineWidth = 2.8; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-12, 0); c.quadraticCurveTo(0, -11 * hgt, 12, 0); c.stroke();
    c.beginPath(); c.moveTo(s * 11, -1); c.lineTo(s * 16, -5); c.stroke();
    c.restore();
  }

  function mouth(c, x, y, o, grin) {
    var w = 13 + grin * 4;
    c.save(); c.translate(x, y);
    if (o < 0.08) {
      c.strokeStyle = LIP; c.lineWidth = 3.4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-w, -1); c.quadraticCurveTo(0, 8, w, -1); c.stroke();
      c.fillStyle = 'rgba(226,62,99,0.55)';
      c.beginPath(); c.moveTo(-7, 4); c.quadraticCurveTo(0, 9, 7, 4); c.quadraticCurveTo(0, 6, -7, 4); c.fill();
    } else {
      var d = 4 + o * 13;
      c.beginPath();
      c.moveTo(-w, -1); c.quadraticCurveTo(0, 3 - grin * 2, w, -1); c.quadraticCurveTo(0, d + 4, -w, -1); c.closePath();
      c.fillStyle = '#5a0f22'; c.fill();
      c.save(); c.clip();
      c.fillStyle = '#fff'; c.fillRect(-w, -2, w * 2, 4.4);
      c.fillStyle = '#e8687e'; c.beginPath(); c.ellipse(0, d + 1, 7, 4, 0, 0, 7); c.fill();
      c.restore();
      c.strokeStyle = LIP; c.lineWidth = 3; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-w, -1); c.quadraticCurveTo(0, 3 - grin * 2, w, -1); c.quadraticCurveTo(0, d + 4, -w, -1); c.stroke();
    }
    c.restore();
  }

  function star(c, x, y, r, col) {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(x, y - r); c.lineTo(x + r * 0.22, y - r * 0.22); c.lineTo(x + r, y); c.lineTo(x + r * 0.22, y + r * 0.22);
    c.lineTo(x, y + r); c.lineTo(x - r * 0.22, y + r * 0.22); c.lineTo(x - r, y); c.lineTo(x - r * 0.22, y - r * 0.22); c.closePath(); c.fill();
  }

  // ---------------------------------------------------------------- the table
  var trayLevels = [26, 30, 22, 28, 32, 24, 30, 26, 22, 28];
  var CHIPC = ['#2e8bff', '#ff4d6d', '#20c997', '#9b5cff', '#ffb020'];
  function drawTableLive(c) { // the card box lights up when the card lands
    var glow = set.boxGlowT > now ? Math.min(1, (set.boxGlowT - now) / 600) : 0;
    if (glow <= 0) return;
    c.beginPath();
    c.moveTo(BOX.x - 64, BOX.y - 54); c.lineTo(BOX.x + 64, BOX.y - 54); c.lineTo(BOX.x + 74, BOX.y + 54); c.lineTo(BOX.x - 74, BOX.y + 54); c.closePath();
    c.strokeStyle = 'rgba(255,224,130,' + (0.45 * glow).toFixed(3) + ')'; c.lineWidth = 12; c.stroke();
  }
  function drawTable(c) {
    // rim (glossy dark) with the LED rail along its top edge
    var rg = c.createLinearGradient(0, 418, 0, 480);
    rg.addColorStop(0, '#2a2f6e'); rg.addColorStop(1, '#0c0f33');
    c.fillStyle = rg;
    c.beginPath(); c.ellipse(500, 990, 1540, 572, 0, 0, Math.PI * 2); c.fill();
    var led = 0.9;
    [[18, 0.16], [7, 0.5], [2.4, 1]].forEach(function (l, i) {
      c.strokeStyle = i === 2 ? '#d8fdff' : 'rgba(70,232,255,' + (l[1] * led).toFixed(3) + ')';
      c.lineWidth = l[0];
      c.beginPath(); c.ellipse(500, 990, 1540, 572, 0, Math.PI * 1.06, Math.PI * 1.94); c.stroke();
    });
    // felt
    var fg = c.createRadialGradient(500, 560, 30, 500, 600, 760);
    fg.addColorStop(0, '#3a6ff0'); fg.addColorStop(0.45, '#1d43b6'); fg.addColorStop(1, '#0c2063');
    c.fillStyle = fg;
    c.beginPath(); c.ellipse(500, 1002, 1508, 548, 0, 0, Math.PI * 2); c.fill();
    // printed lines
    c.strokeStyle = 'rgba(255,207,110,0.5)'; c.lineWidth = 2.4;
    c.beginPath(); c.ellipse(500, 1010, 1380, 482, 0, Math.PI * 1.04, Math.PI * 1.96); c.stroke();
    c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(500, 1010, 1360, 470, 0, Math.PI * 1.04, Math.PI * 1.96); c.stroke();
    // card box (seen at an angle) + print
    c.save();
    c.beginPath();
    c.moveTo(BOX.x - 64, BOX.y - 54); c.lineTo(BOX.x + 64, BOX.y - 54); c.lineTo(BOX.x + 74, BOX.y + 54); c.lineTo(BOX.x - 74, BOX.y + 54); c.closePath();
    c.fillStyle = 'rgba(8,20,70,0.35)'; c.fill();
    c.strokeStyle = 'rgba(255,207,110,0.85)'; c.lineWidth = 2.4; c.setLineDash([10, 6]); c.stroke(); c.setLineDash([]);
    c.restore();
    c.fillStyle = 'rgba(255,215,130,0.55)'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'italic 900 34px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    c.fillText('LUCKY 7', 500, 630);
    c.font = '700 13px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    c.fillText('SEVEN PAYS 11 TO 1  ·  LOW & HIGH PAY 1 TO 1', 500, 656);
    // chip float
    c.fillStyle = 'rgba(10,14,48,0.9)';
    c.beginPath(); c.moveTo(TRAY.x - 168, TRAY.y - 20); c.lineTo(TRAY.x + 168, TRAY.y - 20); c.lineTo(TRAY.x + 178, TRAY.y + 22); c.lineTo(TRAY.x - 178, TRAY.y + 22); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(160,190,255,0.35)'; c.lineWidth = 1.5; c.stroke();
    for (var i = 0; i < 10; i++) {
      var x = TRAY.x - 152 + i * 33.8, h = trayLevels[i], base = TRAY.y + 14;
      var col = CHIPC[i % 5];
      c.fillStyle = col; c.fillRect(x - 13, base - h, 26, h);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (var s = 5; s < h; s += 6) c.fillRect(x - 13, base - s, 26, 1.2);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x + 6, base - h, 7, h);
      c.fillStyle = shade(col); c.beginPath(); c.ellipse(x, base - h, 13, 4.6, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
    }
    // shoe (smoked acrylic, cards inside)
    var sx = SHOE.x, sy = SHOE.y;
    c.fillStyle = 'rgba(20,16,40,0.92)';
    c.beginPath(); c.moveTo(sx - 18, sy - 34); c.lineTo(sx + 96, sy - 44); c.lineTo(sx + 104, sy + 6); c.lineTo(sx - 8, sy + 22); c.closePath(); c.fill();
    c.fillStyle = '#f3eefc';
    for (var j = 0; j < 7; j++) { c.fillRect(sx - 4 + j * 2, sy - 28 + j * 0.6, 92 - j * 3, 2.2); }
    c.fillStyle = 'rgba(120,100,200,0.35)';
    c.beginPath(); c.moveTo(sx - 18, sy - 34); c.lineTo(sx + 96, sy - 44); c.lineTo(sx + 96, sy - 36); c.lineTo(sx - 18, sy - 24); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,207,110,0.9)'; c.fillRect(sx - 10, sy + 10, 108, 3);
    c.fillStyle = '#4a1d96';
    c.beginPath(); c.moveTo(sx - 26, sy - 4); c.lineTo(sx + 2, sy - 8); c.lineTo(sx + 6, sy + 16); c.lineTo(sx - 22, sy + 22); c.closePath(); c.fill();
    // discard tray with face-down cards
    var dx = DISCARD.x, dy = DISCARD.y, ph = 4 + set.pile * 1.1;
    c.fillStyle = 'rgba(200,220,255,0.18)';
    c.beginPath(); c.moveTo(dx - 62, dy - 30); c.lineTo(dx + 60, dy - 30); c.lineTo(dx + 70, dy + 22); c.lineTo(dx - 72, dy + 22); c.closePath(); c.fill();
    c.fillStyle = '#3c1680';
    c.beginPath(); c.moveTo(dx - 52, dy + 14 - ph); c.lineTo(dx + 50, dy + 14 - ph); c.lineTo(dx + 56, dy + 14); c.lineTo(dx - 58, dy + 14); c.closePath(); c.fill();
    c.fillStyle = '#efe8ff';
    for (var q = 0; q < ph; q += 2.2) c.fillRect(dx - 56, dy + 13 - q, 112, 0.8);
    c.fillStyle = '#5b26b8';
    c.beginPath(); c.moveTo(dx - 52, dy + 14 - ph); c.lineTo(dx + 50, dy + 14 - ph); c.lineTo(dx + 44, dy - 16 - ph); c.lineTo(dx - 46, dy - 16 - ph); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,207,110,0.6)'; c.lineWidth = 1.4; c.stroke();
    c.strokeStyle = 'rgba(220,235,255,0.5)'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(dx - 62, dy - 30); c.lineTo(dx + 60, dy - 30); c.lineTo(dx + 70, dy + 22); c.lineTo(dx - 72, dy + 22); c.closePath(); c.stroke();
  }
  function shade(hex) { // a lighter top for chip stacks
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.min(255, r + 40) + ',' + Math.min(255, g + 40) + ',' + Math.min(255, b + 40) + ')';
  }

  // ---------------------------------------------------------------- arms and hands (front layer)
  function solve(S, T, l1, l2, side) {
    var dx = T.x - S.x, dy = T.y - S.y, d = Math.sqrt(dx * dx + dy * dy);
    d = clamp(d, Math.abs(l1 - l2) + 1, l1 + l2 - 0.5);
    var a = Math.atan2(dy, dx), b = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    // of the two elbow positions, take the one away from the body (hands down or raised)
    var e1 = { x: S.x + Math.cos(a + b) * l1, y: S.y + Math.sin(a + b) * l1 };
    var e2 = { x: S.x + Math.cos(a - b) * l1, y: S.y + Math.sin(a - b) * l1 };
    return (side === 'L' ? e1.x < e2.x : e1.x > e2.x) ? e1 : e2;
  }
  function limb(c, x1, y1, r1, x2, y2, r2, fill) {
    var a = Math.atan2(y2 - y1, x2 - x1), nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2);
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(x1 + nx * r1, y1 + ny * r1); c.lineTo(x2 + nx * r2, y2 + ny * r2);
    c.arc(x2, y2, r2, a + Math.PI / 2, a - Math.PI / 2, true);
    c.lineTo(x1 - nx * r1, y1 - ny * r1);
    c.arc(x1, y1, r1, a - Math.PI / 2, a + Math.PI / 2, true);
    c.closePath(); c.fill();
  }
  function drawArm(c, side, breathe) {
    var h = hands[side], S = { x: SHOULDER[side].x, y: SHOULDER[side].y + breathe * 1.3 - breathe * 1.6 };
    var dH = depth(h.y), l1 = UPPER * (1 + (dH - 1) * 0.45), l2 = FORE * (1 + (dH - 1) * 0.9);
    var E = solve(S, h, l1, l2, side), dE = depth(E.y);
    var a = Math.atan2(h.y - E.y, h.x - E.x);
    // wrist a little before the hand
    var wx = h.x - Math.cos(a) * 8 * dH, wy = h.y - Math.sin(a) * 8 * dH;
    limb(c, S.x, S.y, 23, E.x, E.y, 19 * dE, JACKET_SH);
    limb(c, S.x, S.y, 19, E.x, E.y, 15 * dE, JACKET);
    limb(c, E.x, E.y, 18 * dE, wx, wy, 13.5 * dH, JACKET);
    // cuff: blouse + gold band
    var cx = wx - Math.cos(a) * 12 * dH, cy = wy - Math.sin(a) * 12 * dH;
    limb(c, cx, cy, 14 * dH, wx, wy, 13.5 * dH, '#fff4f8');
    limb(c, wx - Math.cos(a) * 3 * dH, wy - Math.sin(a) * 3 * dH, 12 * dH, wx, wy, 12 * dH, GOLD);
    drawHand(c, h.x, h.y, a, dH, h.pose, side);
  }
  function drawHand(c, x, y, a, sc, pose, side) {
    c.save();
    c.translate(x, y); c.rotate(a - Math.PI / 2); c.scale(sc, sc);
    var s = side === 'L' ? 1 : -1; // thumb toward the body centre
    var open = pose === 'open', grip = pose === 'grip';
    var spread = open ? 1.5 : 1, len = grip ? 15 : open ? 25 : 22;
    // palm / back of the hand
    var pg = c.createLinearGradient(0, -6, 0, 26);
    pg.addColorStop(0, SKIN); pg.addColorStop(1, open ? SKIN_HI : SKIN_SH);
    c.fillStyle = pg;
    c.beginPath(); c.ellipse(0, 9, 14.5, 15, 0, 0, 7); c.fill();
    // fingers
    for (var f = 0; f < 4; f++) {
      var fx = (f - 1.5) * 6.2, ang = (f - 1.5) * 0.09 * spread, l = len - Math.abs(f - 1.3) * 2.2;
      var x2 = fx * spread + Math.sin(ang) * l, y2 = 20 + Math.cos(ang) * l;
      c.strokeStyle = f % 2 ? SKIN : SKIN_HI; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(fx, 18); c.lineTo(x2, y2); c.stroke();
      if (!open) { c.fillStyle = LIP; c.beginPath(); c.ellipse(x2, y2 - 0.6, 2.2, 2.6, ang, 0, 7); c.fill(); }
    }
    // thumb
    c.strokeStyle = SKIN; c.lineWidth = 6.6;
    c.beginPath(); c.moveTo(s * 11, 4); c.lineTo(s * (open ? 24 : 17), open ? 14 : 20); c.stroke();
    if (open) { // palm lines
      c.strokeStyle = 'rgba(160,80,50,0.35)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-8, 6); c.quadraticCurveTo(0, 12, 9, 8); c.stroke();
    } else { // knuckles
      c.strokeStyle = 'rgba(150,70,40,0.3)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-10, 16); c.quadraticCurveTo(0, 19, 10, 16); c.stroke();
    }
    c.restore();
  }

  // ---------------------------------------------------------------- card element
  var lastCardT = '';
  function placeCard() {
    if (!card.on) { if (!cardEl.hidden) cardEl.hidden = true; return; }
    if (cardEl.hidden) cardEl.hidden = false;
    var s = depth(card.y) * card.scale;
    var t = 'translate(' + (card.x - 50).toFixed(1) + 'px,' + (card.y - 70).toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
    var inner = 'rotateX(44deg) translateZ(' + card.lift.toFixed(1) + 'px) rotateZ(' + card.spin.toFixed(1) + 'deg) rotateY(' + card.flip.toFixed(1) + 'deg)';
    var key = t + inner + card.alpha.toFixed(2);
    if (key === lastCardT) return;
    lastCardT = key;
    cardEl.style.transform = t; cardEl.style.opacity = card.alpha.toFixed(2);
    cardInner.style.transform = inner;
  }

  // ---------------------------------------------------------------- frame
  var last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    now = t;
    var dt = last ? Math.min(50, t - last) : 16; last = t;
    if (!FULL_W) return;
    // timeline tasks
    for (var i = tasks.length - 1; i >= 0; i--) {
      var tk = tasks[i];
      if (now < tk.t) continue;
      var p = tk.d ? clamp((now - tk.t) / tk.d, 0, 1) : 1;
      tk.fn(p);
      if (p >= 1) { tasks.splice(i, 1); if (tk.done) tk.done(); }
    }
    trackHand(hands.L, 'L'); trackHand(hands.R, 'R');
    // gaze: forced targets hold, otherwise wander between the table and the camera
    if (now > gaze.hold && now > gaze.until) {
      var cam = Math.random() < (phaseLook === 'betting' ? 0.35 : 0.5);
      gaze.tx = cam ? 500 + rand(-30, 30) : rand(280, 720); gaze.ty = cam ? 250 : rand(520, 640);
      gaze.until = now + rand(1600, 3800);
    }
    gaze.x = lerp(gaze.x, gaze.tx, Math.min(1, dt / 160)); gaze.y = lerp(gaze.y, gaze.ty, Math.min(1, dt / 160));
    // blink
    if (face.blinkAt < 0 && now > face.nextBlink) face.blinkAt = now;
    if (face.blinkAt >= 0) {
      var bp = (now - face.blinkAt) / 150;
      face.blink = bp < 1 ? Math.sin(bp * Math.PI) : 0;
      if (bp >= 1) { face.blinkAt = -1; face.nextBlink = now + (Math.random() < 0.18 ? 220 : rand(2200, 5200)); }
    }
    var breathe = Math.sin(now / 3800 * Math.PI * 2);
    var v = worldView();

    if (setDirty) { setDirty = false; drawSetStatic(prep(setCache), v); }
    if (tableDirty) { tableDirty = false; drawTable(prep(tableCache)); }
    var c = bctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(setCache, 0, 0);
    c.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    drawSetLive(c, v);
    drawHost(c, breathe);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(tableCache, 0, 0);
    c.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    drawTableLive(c);

    var f = fctx;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, front.width, front.height);
    f.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    drawArm(f, 'L', breathe); drawArm(f, 'R', breathe);
    // confetti
    for (var ci = confetti.length - 1; ci >= 0; ci--) {
      var q = confetti[ci], age = now - q.born;
      if (age > q.life) { confetti.splice(ci, 1); continue; }
      q.vy += 0.00022 * dt; q.x += q.vx * dt + Math.sin(age / 300 + ci) * 0.3; q.y += q.vy * dt; q.r += q.vr * dt;
      f.save(); f.globalAlpha = Math.min(1, (q.life - age) / 500);
      f.translate(q.x, q.y); f.rotate(q.r); f.scale(1, Math.abs(Math.cos(age / 160 + ci)));
      f.fillStyle = q.c; f.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
      f.restore();
    }
    placeCard();
  }

  window.L7Scene = {
    init: init, fit: fit, deal: deal, showCard: showCard, discard: discard,
    gesture: gesture, react: react, toScreen: toScreen, topColour: topColour,
    cardOn: function () { return card.on; },
    phase: function (p) { phaseLook = p; if (p === 'betting' && set.mode !== 'party') mode('betting'); },
    collect: function () { for (var i = 0; i < trayLevels.length; i++) trayLevels[i] = Math.min(36, trayLevels[i] + (Math.random() < 0.5 ? 2 : 0)); tableDirty = true; },
    payOut: function () { for (var i = 0; i < trayLevels.length; i++) trayLevels[i] = Math.max(16, trayLevels[i] - (Math.random() < 0.5 ? 2 : 0)); tableDirty = true; },
  };
})();
