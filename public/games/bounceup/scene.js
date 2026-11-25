/* Bounce Up — an original NEXORNG arcade game. A cute frog sits on a lily pad in a pond;
 * when the round starts it leaps up and bounces from floating pad to pad, higher and higher —
 * past the trees, clouds, birds, a rainbow, the sunset and up to the moon — as the multiplier
 * rises. Cash out and it celebrates on its pad; bust and it misses a pad and splashes down.
 * Everything is drawn in code (canvas) and every sound is generated (WebAudio). */
(function () {
  'use strict';

  var TAKEOFF_MS = 650; // the leap from the pond (its sound lasts exactly as long)
  var FALL_MS = 1100; // a missed pad: the fall back down to the pond, then the splash
  var SPLASH_MS = 700;

  var SKY = [ // [top, bottom] by height: day → golden hour → night
    [[79, 184, 255], [201, 241, 255]],
    [[255, 138, 154], [255, 214, 160]],
    [[11, 18, 56], [46, 42, 110]],
  ];

  function mix(a, b, k) { return Math.round(a + (b - a) * k); }
  function skyCol(i, alt) {
    var st = alt < 0.5 ? 0 : 1, k = alt < 0.5 ? alt / 0.5 : (alt - 0.5) / 0.5;
    var c0 = SKY[st][i], c1 = SKY[st + 1][i];
    return [mix(c0[0], c1[0], k), mix(c0[1], c1[1], k), mix(c0[2], c1[2], k)];
  }
  function rgb(c, a) { return a == null ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + a + ')'; }
  function hex(c) { return '#' + c.map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join(''); }
  function ease(t) { t = Math.min(1, Math.max(0, t)); return 1 - Math.pow(1 - t, 3); }
  function bell(x, c, w) { return Math.max(0, 1 - Math.abs(x - c) / w); }
  function rnd(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  // fixed scenery (generated once, same every visit)
  var r = rnd(7);
  var clouds = [], birds = [], stars = [], pondPads = [], reeds = [];
  for (var i = 0; i < 14; i++) clouds.push({ x: r(), y: 0.15 + r() * 3.2, s: 0.6 + r() * 0.9, v: 0.2 + r() * 0.6 });
  for (i = 0; i < 9; i++) birds.push({ x: r(), y: 0.5 + r() * 1.3, s: 0.7 + r() * 0.5, v: 0.03 + r() * 0.04, p: r() * 6 });
  for (i = 0; i < 90; i++) stars.push({ x: r(), y: r() * 0.8, r: 0.6 + r() * 1.5, t: r() * 6 });
  for (i = 0; i < 7; i++) pondPads.push({ x: r() * 1.4 - 0.2, y: 0.86 + r() * 0.1, s: 0.5 + r() * 0.5, rot: r() * 6.28, flower: r() < 0.35 });
  for (i = 0; i < 22; i++) reeds.push({ x: i < 11 ? r() * 0.18 - 0.05 : 0.87 + r() * 0.18, h: 0.1 + r() * 0.12, p: r() * 6 });

  var sc = { phase: 0, lastIdx: -1, padX: [0, 0], particles: [], splashAt: 0, celebrateAt: 0, wind: 0 };

  // ---------------------------------------------------------------- drawing helpers
  function ellipse(ctx, x, y, rx, ry, rot, fill) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  }

  function lilyPad(ctx, x, y, w, rot, flower, night) {
    var g = ctx.createRadialGradient(x - w * 0.15, y - w * 0.05, w * 0.05, x, y, w * 0.55);
    g.addColorStop(0, night ? '#3f8f5a' : '#7be36a'); g.addColorStop(1, night ? '#1d5a35' : '#2f9e4a');
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.38);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, w * 0.5, rot + 0.32, rot + Math.PI * 2 - 0.02); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,60,20,0.35)'; ctx.lineWidth = 2;
    for (var k = 0; k < 6; k++) { var a = rot + 0.5 + k * 0.95; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * w * 0.42, Math.sin(a) * w * 0.42); ctx.stroke(); }
    ctx.restore();
    if (flower) {
      for (var p = 0; p < 6; p++) {
        var a2 = p * Math.PI / 3;
        ellipse(ctx, x + w * 0.2 + Math.cos(a2) * w * 0.07, y - w * 0.06 + Math.sin(a2) * w * 0.035, w * 0.07, w * 0.035, a2, '#ff9ccd');
      }
      ellipse(ctx, x + w * 0.2, y - w * 0.07, w * 0.04, w * 0.03, 0, '#ffe066');
    }
  }

  // the frog: (x, feet y), size s; pose: squash (≤1 flat, ≥1 tall), tilt, eyes, legs, arm
  function frog(ctx, x, y, s, o) {
    var sq = o.squash || 1, sx = 1 / Math.sqrt(sq);
    ctx.save(); ctx.translate(x, y); ctx.rotate(o.tilt || 0); ctx.scale(sx, sq);
    var body = '#46c96a', dark = '#1f8f47', belly = '#d8f7b0';
    // back legs
    if (o.legs === 'jump') {
      ellipse(ctx, -s * 0.28, s * 0.05, s * 0.12, s * 0.34, 0.35, dark);
      ellipse(ctx, s * 0.28, s * 0.05, s * 0.12, s * 0.34, -0.35, dark);
      ellipse(ctx, -s * 0.36, s * 0.36, s * 0.16, s * 0.07, 0.2, '#ffb347');
      ellipse(ctx, s * 0.36, s * 0.36, s * 0.16, s * 0.07, -0.2, '#ffb347');
    } else {
      ellipse(ctx, -s * 0.42, -s * 0.16, s * 0.24, s * 0.18, -0.3, dark);
      ellipse(ctx, s * 0.42, -s * 0.16, s * 0.24, s * 0.18, 0.3, dark);
      ellipse(ctx, -s * 0.5, -s * 0.02, s * 0.2, s * 0.07, 0, '#ffb347');
      ellipse(ctx, s * 0.5, -s * 0.02, s * 0.2, s * 0.07, 0, '#ffb347');
    }
    // body
    var g = ctx.createRadialGradient(-s * 0.15, -s * 0.6, s * 0.1, 0, -s * 0.4, s * 0.7);
    g.addColorStop(0, '#7be36a'); g.addColorStop(1, body);
    ellipse(ctx, 0, -s * 0.42, s * 0.52, s * 0.42, 0, g);
    ellipse(ctx, 0, -s * 0.3, s * 0.34, s * 0.25, 0, belly);
    // front arms (one waves when it celebrates)
    ellipse(ctx, -s * 0.22, -s * 0.06, s * 0.08, s * 0.14, 0.2, body);
    if (o.armUp) ellipse(ctx, s * 0.42, -s * 0.62, s * 0.08, s * 0.18, 0.7 + Math.sin(o.t / 90) * 0.25, body);
    else ellipse(ctx, s * 0.22, -s * 0.06, s * 0.08, s * 0.14, -0.2, body);
    // eyes
    [-1, 1].forEach(function (side) {
      var ex = side * s * 0.25, ey = -s * 0.8;
      ellipse(ctx, ex, ey, s * 0.2, s * 0.2, 0, body);
      if (o.eyes === 'blink') { ctx.strokeStyle = '#0d3b1e'; ctx.lineWidth = s * 0.05; ctx.beginPath(); ctx.moveTo(ex - s * 0.1, ey); ctx.lineTo(ex + s * 0.1, ey); ctx.stroke(); return; }
      if (o.eyes === 'happy') { ctx.strokeStyle = '#0d3b1e'; ctx.lineWidth = s * 0.05; ctx.beginPath(); ctx.arc(ex, ey + s * 0.04, s * 0.09, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); return; }
      ellipse(ctx, ex, ey, s * 0.14, s * 0.14, 0, '#fff');
      var py = o.eyes === 'sad' ? s * 0.05 : (o.look || 0) * s * 0.04;
      ellipse(ctx, ex + side * s * 0.01, ey + py, s * 0.075, s * 0.085, 0, '#13261a');
      ellipse(ctx, ex - s * 0.03, ey + py - s * 0.04, s * 0.025, s * 0.025, 0, '#fff');
    });
    // cheeks + mouth
    ellipse(ctx, -s * 0.33, -s * 0.48, s * 0.07, s * 0.045, 0, 'rgba(255,120,150,0.55)');
    ellipse(ctx, s * 0.33, -s * 0.48, s * 0.07, s * 0.045, 0, 'rgba(255,120,150,0.55)');
    ctx.strokeStyle = '#0d3b1e'; ctx.lineWidth = s * 0.045; ctx.lineCap = 'round';
    ctx.beginPath();
    if (o.eyes === 'sad') ctx.arc(0, -s * 0.36, s * 0.12, Math.PI * 1.15, Math.PI * 1.85);
    else ctx.arc(0, -s * 0.56, s * (o.eyes === 'happy' ? 0.2 : 0.15), Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();
  }

  function cloud(ctx, x, y, s, alpha, night) {
    ctx.save(); ctx.globalAlpha = alpha;
    var c = night ? '#c9c8f0' : '#ffffff';
    [[0, 0, 1], [-0.55, 0.12, 0.72], [0.55, 0.1, 0.78], [-0.22, -0.28, 0.66], [0.26, -0.22, 0.62]].forEach(function (b) {
      ellipse(ctx, x + b[0] * 60 * s, y + b[1] * 30 * s, 44 * s * b[2], 26 * s * b[2], 0, c);
    });
    ctx.globalAlpha = alpha * 0.18;
    ellipse(ctx, x, y + 14 * s, 70 * s, 10 * s, 0, '#5a6fa8');
    ctx.restore();
  }

  function bird(ctx, x, y, s, flap, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 2.2 * s; ctx.lineCap = 'round';
    var w = Math.sin(flap) * 6 * s;
    ctx.beginPath(); ctx.moveTo(x - 10 * s, y - w); ctx.quadraticCurveTo(x - 4 * s, y - 2 * s, x, y); ctx.quadraticCurveTo(x + 4 * s, y - 2 * s, x + 10 * s, y - w); ctx.stroke();
  }

  // ---------------------------------------------------------------- the world
  function world(ctx, v) {
    var W = v.W, H = v.H, A = v.alt * H * 3.2, L = v.LEFT, T = v.TOP, FW = v.FULL_W, FH = v.FULL_H;
    var night = Math.max(0, Math.min(1, (v.alt - 0.62) / 0.3));
    // sky
    var g = ctx.createLinearGradient(0, -T, 0, H);
    g.addColorStop(0, rgb(skyCol(0, v.alt))); g.addColorStop(1, rgb(skyCol(1, v.alt)));
    ctx.fillStyle = g; ctx.fillRect(-L, -T, FW, FH);
    // stars + moon
    if (night > 0) {
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.45 + 0.55 * Math.sin(v.now / 520 + st.t));
        ellipse(ctx, st.x * FW - L, st.y * FH - T, st.r, st.r, 0, '#fff');
      });
      ctx.globalAlpha = night;
      var mx = W * 0.8, my = H * 0.16, mr = Math.min(W, H) * 0.08;
      var mg = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 3);
      mg.addColorStop(0, 'rgba(255,248,214,0.55)'); mg.addColorStop(1, 'rgba(255,248,214,0)');
      ctx.fillStyle = mg; ctx.fillRect(mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
      ellipse(ctx, mx, my, mr, mr, 0, '#fff4cf');
      ellipse(ctx, mx - mr * 0.3, my - mr * 0.2, mr * 0.18, mr * 0.18, 0, 'rgba(210,196,150,0.6)');
      ellipse(ctx, mx + mr * 0.25, my + mr * 0.3, mr * 0.12, mr * 0.12, 0, 'rgba(210,196,150,0.6)');
      ctx.globalAlpha = 1;
    }
    // rainbow (around the middle of the climb)
    var rb = bell(v.alt, 0.42, 0.2);
    if (rb > 0) {
      var cols = ['#ff5a5a', '#ffa84a', '#ffe14a', '#5ad26a', '#4aa8ff', '#9a6aff'];
      var rr = Math.max(W, H) * 0.72, cx = W * 0.5, cy = H * 1.05 + (0.42 - v.alt) * H * 0.8;
      ctx.lineWidth = rr * 0.035;
      cols.forEach(function (c, k) { ctx.globalAlpha = rb * 0.6; ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(cx, cy, rr - k * rr * 0.035, Math.PI, 0); ctx.stroke(); });
      ctx.globalAlpha = 1;
    }
    // far hills (slow)
    var hy = H * 0.74 + A * 0.45;
    if (hy < H + 40) {
      ctx.fillStyle = rgb([mix(120, 40, v.alt), mix(200, 70, v.alt), mix(150, 90, v.alt)]);
      ctx.beginPath(); ctx.moveTo(-L, FH);
      for (var x = -L; x <= W + 20; x += 20) ctx.lineTo(x, hy - Math.sin(x / 90) * 18 - Math.sin(x / 37) * 8);
      ctx.lineTo(W + 20, FH); ctx.closePath(); ctx.fill();
    }
    // clouds (in the sky above; drift with the wind)
    clouds.forEach(function (c) {
      var span = FW * 1.6;
      var cx2 = (((c.x * span + v.now * 0.004 * c.v) % span) + span) % span - FW * 0.3 - L;
      var cy2 = H * 0.55 - c.y * H + A * 0.9;
      if (cy2 > -T - 60 && cy2 < H + 60) cloud(ctx, cx2, cy2, c.s * (H / 380), 0.92, night > 0.5);
    });
    // birds
    if (v.alt > 0.08 && v.alt < 0.75) {
      birds.forEach(function (b) {
        var bx = (((b.x + v.now * 0.00002 * b.v * 60) % 1.3) - 0.15) * FW - L, by = H * 0.6 - b.y * H + A * 0.95;
        if (by > -T && by < H) bird(ctx, bx, by, b.s, v.now / 120 + b.p, night > 0.4 ? '#e8e4ff' : '#2b3a55');
      });
    }
    // trees on the banks
    var ty = H * 0.84 + A;
    if (ty < H + H * 0.6) {
      [[-0.02, 0.26, 1], [0.1, 0.2, 0.8], [0.92, 0.24, 1], [1.04, 0.3, 1.1]].forEach(function (t) {
        var tx = t[0] * W, th = t[1] * H, ts = t[2];
        ctx.fillStyle = '#6b4a2b'; ctx.fillRect(tx - 6 * ts, ty - th * 0.5, 12 * ts, th * 0.5);
        var tc = night > 0.3 ? '#1f5a3a' : '#2fa84f';
        ellipse(ctx, tx, ty - th * 0.62, th * 0.36, th * 0.3, 0, tc);
        ellipse(ctx, tx - th * 0.2, ty - th * 0.5, th * 0.24, th * 0.2, 0, tc);
        ellipse(ctx, tx + th * 0.2, ty - th * 0.48, th * 0.24, th * 0.2, 0, tc);
        ellipse(ctx, tx - th * 0.08, ty - th * 0.72, th * 0.16, th * 0.12, 0, 'rgba(255,255,255,0.12)');
      });
      // pond
      var py = H * 0.82 + A;
      var pg = ctx.createLinearGradient(0, py, 0, py + H * 0.3);
      pg.addColorStop(0, night > 0.3 ? '#1b4a6a' : '#3fb8d8'); pg.addColorStop(1, night > 0.3 ? '#0c2a40' : '#1a7fa8');
      ctx.fillStyle = pg; ctx.fillRect(-L, py, FW, FH);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      for (var k = 0; k < 6; k++) {
        var rx = ((k * 0.19 + v.now * 0.00003) % 1.2 - 0.1) * W, ry = py + H * (0.03 + k * 0.025);
        ctx.beginPath(); ctx.ellipse(rx, ry, 18 + k * 3, 3, 0, 0, Math.PI * 2); ctx.stroke();
      }
      pondPads.forEach(function (p) { lilyPad(ctx, p.x * W, py + (p.y - 0.82) * H, H * 0.12 * p.s, p.rot, p.flower, night > 0.3); });
      reeds.forEach(function (rd) {
        var rx2 = rd.x * W, sway = Math.sin(v.now / 700 + rd.p) * 4;
        ctx.strokeStyle = '#2d7a3a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(rx2, py + 6); ctx.quadraticCurveTo(rx2 + sway * 0.5, py - rd.h * H * 0.5, rx2 + sway, py - rd.h * H); ctx.stroke();
        ellipse(ctx, rx2 + sway, py - rd.h * H + 6, 4, 10, 0, '#7a4a2a');
      });
    }
  }

  // ---------------------------------------------------------------- the frog through a round
  function pondPad(v) { return { x: v.W * 0.5, y: v.H * 0.83 + v.alt * v.H * 3.2 }; }

  function particles(ctx, v) {
    sc.particles = sc.particles.filter(function (p) { return v.now - p.t0 < p.life; });
    sc.particles.forEach(function (p) {
      var t = (v.now - p.t0) / 1000;
      var x = p.x + p.vx * t, y = p.y + p.vy * t + 380 * t * t * p.g;
      ctx.globalAlpha = 1 - (v.now - p.t0) / p.life;
      if (p.star) {
        ctx.fillStyle = p.c; ctx.beginPath();
        for (var k = 0; k < 10; k++) { var a = k * Math.PI / 5 + t * 4, rr = k % 2 ? p.r * 0.45 : p.r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        ctx.fill();
      } else ellipse(ctx, x, y, p.r, p.r, 0, p.c);
    });
    ctx.globalAlpha = 1;
  }

  function burst(x, y, n, opts) {
    for (var k = 0; k < n; k++) {
      var a = Math.random() * Math.PI * 2, sp = (opts.speed || 160) * (0.4 + Math.random());
      sc.particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up || 0), r: (opts.r || 4) * (0.6 + Math.random()), c: opts.colors[k % opts.colors.length], t0: performance.now(), life: opts.life || 900, g: opts.gravity == null ? 1 : opts.gravity, star: opts.star });
    }
  }

  function drawRound(ctx, v) {
    var W = v.W, H = v.H, s = Math.min(H * 0.13, W * 0.14);
    var cruiseY = H * 0.6, padW = s * 1.9;
    var t = v.startAt ? v.now - v.startAt : 0;
    var blink = Math.sin(v.now / 1300) > 0.985 ? 'blink' : 'open';

    if (v.phase === 'idle' || v.phase === 'starting' || (v.phase !== 'running' && !v.startAt)) {
      var pp = pondPad(v);
      var crouch = v.phase === 'starting' ? 0.82 : 1 + Math.sin(v.now / 500) * 0.02;
      lilyPad(ctx, pp.x, pp.y + s * 0.02, padW, 0.4, false, false); // its own pad
      frog(ctx, pp.x, pp.y - s * 0.05, s, { squash: crouch, eyes: blink, legs: 'sit', t: v.now, look: Math.sin(v.now / 1800) });
      return;
    }

    // the bounce loop: pads come down from above, the frog lands on each one
    var period = Math.max(430, 720 - v.alt * 300);
    if (v.phase === 'running') sc.phase += v.dt / period;
    var idx = Math.floor(sc.phase), frac = sc.phase - idx;
    function padXFor(n) { return W * 0.5 + Math.sin(n * 2.4) * W * 0.12; }
    var gap = H * 0.42;

    if (v.phase === 'running' && t < TAKEOFF_MS) { // the leap from the pond pad to the first floating pad
      var k = ease(t / TAKEOFF_MS), from = pondPad(v);
      var fx = from.x + (padXFor(0) - from.x) * k, fy = from.y + (cruiseY - from.y) * k - Math.sin(Math.PI * k) * H * 0.18;
      lilyPad(ctx, padXFor(0), cruiseY - (1 - k) * gap * 0.6, padW, 0.4, false, false);
      frog(ctx, fx, fy, s, { squash: 1.15, eyes: 'open', legs: 'jump', t: v.now, tilt: -0.15 });
      sc.phase = 0;
      return;
    }

    var curX = padXFor(idx), nextX = padXFor(idx + 1);
    if (v.phase === 'busted') {
      var bt = v.now - v.endAt;
      // the next pad slips away sideways; the frog falls back down to the pond and splashes
      lilyPad(ctx, curX, cruiseY + Math.min(1, frac + bt / 600) * gap, padW, 0.4, false, false);
      lilyPad(ctx, nextX + bt * 0.9 * (nextX > curX ? 1 : -1), cruiseY - (1 - frac) * gap, padW, 0.4, false, false);
      var target = pondPad(v), k2 = Math.min(1, bt / FALL_MS);
      if (bt < FALL_MS) {
        var startY = cruiseY - Math.sin(Math.PI * frac) * H * 0.2;
        frog(ctx, curX + (nextX - curX) * frac, startY + (target.y - startY) * k2 * k2, s, { squash: 1.1, eyes: 'sad', legs: 'jump', t: v.now, tilt: k2 * 5 });
      } else {
        if (!sc.splashAt) { sc.splashAt = v.now; burst(target.x, target.y, 26, { colors: ['#bfefff', '#ffffff', '#7fd6f5'], speed: 200, up: 140, r: 4, life: SPLASH_MS }); }
        var st2 = v.now - sc.splashAt;
        ctx.strokeStyle = 'rgba(255,255,255,' + Math.max(0, 1 - st2 / SPLASH_MS) + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(target.x, target.y + 6, 10 + st2 * 0.12, 3 + st2 * 0.03, 0, 0, Math.PI * 2); ctx.stroke();
        if (st2 > SPLASH_MS) { // it pops back up on its pond pad
          lilyPad(ctx, target.x, target.y + s * 0.02, padW, 0.4, false, false);
          frog(ctx, target.x, target.y - s * 0.05, s, { squash: 1, eyes: 'sad', legs: 'sit', t: v.now });
        }
      }
      return;
    }
    sc.splashAt = 0;

    if (v.phase === 'cashed') { // it lands and celebrates on its pad
      if (!sc.celebrateAt) {
        sc.celebrateAt = v.now;
        burst(curX, cruiseY - s * 0.6, 30, { colors: ['#ffe14a', '#ff9ccd', '#7be36a', '#4aa8ff'], speed: 220, up: 120, r: 7, life: 1300, gravity: 0.6, star: true });
      }
      lilyPad(ctx, curX, cruiseY + s * 0.02, padW, 0.4, false, false);
      var hop = Math.abs(Math.sin((v.now - sc.celebrateAt) / 260)) * H * 0.04;
      frog(ctx, curX, cruiseY - s * 0.05 - hop, s, { squash: 1, eyes: 'happy', legs: 'sit', armUp: true, t: v.now });
      return;
    }
    sc.celebrateAt = 0;

    // running
    lilyPad(ctx, curX, cruiseY + frac * gap, padW, 0.4, false, false); // the pad it left, dropping away
    lilyPad(ctx, nextX, cruiseY - (1 - frac) * gap, padW, 0.4, false, false); // the next pad coming down
    var jumpH = H * (0.18 + v.alt * 0.06);
    var fy2 = cruiseY - Math.sin(Math.PI * frac) * jumpH;
    var land = frac < 0.1 || frac > 0.95;
    frog(ctx, curX + (nextX - curX) * frac, fy2, s, { squash: land ? 0.86 : 1.12, eyes: 'open', legs: land ? 'sit' : 'jump', t: v.now, tilt: (nextX - curX) / W * 0.8, look: -1 });
    if (idx !== sc.lastIdx) { sc.lastIdx = idx; sc.landed = true; }
  }

  // ---------------------------------------------------------------- music (cheerful plucks)
  var MEL = [0, 4, 7, 9, 7, 4, 2, 4, 0, 4, 7, 12, 9, 7, 4, 2, 5, 9, 12, 9, 7, 4, 2, 0, 2, 4, 7, 4, 2, 0, -3, 0];
  var BASS = [0, 0, 5, 5, 7, 7, 5, 4];
  function note(n) { return 261.63 * Math.pow(2, n / 12); }

  window.Scene = {
    event: '88.0018',
    code: 'bounceup',
    betLabel: 'Jump!',
    stepDur: 0.2,
    draw: function (ctx, v) {
      world(ctx, v);
      drawRound(ctx, v);
      particles(ctx, v);
    },
    topColour: function (v) { return hex(skyCol(0, v.alt)); },
    tick: function (v, synth) {
      if (sc.landed) { // a boing on every landing, a little higher as it climbs
        sc.landed = false;
        if (v.phase === 'running' && v.now - v.startAt > TAKEOFF_MS + 50) synth.tone({ type: 'sine', freq: 300 + v.alt * 260, freqEnd: 620 + v.alt * 420, dur: 0.18, gain: 0.22 });
      }
    },
    onSignal: function (name, v, synth) {
      if (name === 'start') { // the leap: its sound lasts as long as the take-off animation
        sc.phase = 0; sc.lastIdx = 0;
        synth.tone({ type: 'sine', freq: 200, freqEnd: 720, dur: TAKEOFF_MS / 1000, gain: 0.26, attack: 0.03 });
        synth.tone({ type: 'triangle', freq: 400, freqEnd: 1100, dur: TAKEOFF_MS / 1000, gain: 0.08, attack: 0.05 });
      }
      if (name === 'bust') { // a falling "whoops", then the splash exactly when it hits the water
        synth.tone({ type: 'sine', freq: 700, freqEnd: 140, dur: FALL_MS / 1000, gain: 0.2, attack: 0.02 });
        synth.noise({ at: FALL_MS / 1000, dur: SPLASH_MS / 1000, gain: 0.35, filter: 'lowpass', freq: 2400, freqEnd: 300, attack: 0.005 });
        synth.tone({ at: FALL_MS / 1000 + 0.05, type: 'sine', freq: 180, freqEnd: 90, dur: 0.35, gain: 0.22 });
      }
      if (name === 'win') {
        [0, 4, 7, 12].forEach(function (n, k) { synth.tone({ at: k * 0.08, type: 'triangle', freq: note(n + 12), dur: 0.35, gain: 0.18 }); });
        synth.tone({ at: 0.36, type: 'square', freq: 220, freqEnd: 180, dur: 0.08, gain: 0.06 }); // ribbit
        synth.tone({ at: 0.46, type: 'square', freq: 240, freqEnd: 170, dur: 0.1, gain: 0.06 });
      }
    },
    musicStep: function (synth, step, time) {
      var m = MEL[step % MEL.length];
      if (step % 2 === 0 || m % 2 === 0) synth.tone({ time: time, type: 'triangle', freq: note(m + 12), dur: 0.18, gain: 0.07, bus: 'music' });
      if (step % 4 === 0) synth.tone({ time: time, type: 'sine', freq: note(BASS[(step / 4) % BASS.length] - 12), dur: 0.38, gain: 0.12, bus: 'music' });
      if (step % 8 === 4) synth.noise({ time: time, dur: 0.06, gain: 0.03, filter: 'highpass', freq: 6000, bus: 'music' });
    },
  };
})();
