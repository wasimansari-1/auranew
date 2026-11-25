/* Kite Flyer — an original NEXORNG arcade game. A colourful kite rests on a festival rooftop
 * by the sea; when the round starts a gust lifts it and it climbs on the wind — past gulls,
 * clouds and hot-air balloons, through the sunset into a night of stars and sky lanterns — as
 * the multiplier rises. Cash out and it steadies with a burst of confetti; bust and the string
 * snaps and the kite tumbles away. All art is drawn in code (canvas); all sound is generated. */
(function () {
  'use strict';

  var TAKEOFF_MS = 700; // the gust that lifts the kite (its sound lasts exactly as long)
  var TUMBLE_MS = 1600; // the snapped kite tumbling away (the flutter sound lasts as long)

  var SKY = [ // [top, bottom]: beach day → sunset → festival night
    [[111, 203, 255], [255, 233, 201]],
    [[255, 122, 138], [255, 195, 107]],
    [[18, 15, 58], [74, 47, 122]],
  ];
  function mix(a, b, k) { return Math.round(a + (b - a) * k); }
  function skyCol(i, alt) {
    var st = alt < 0.5 ? 0 : 1, k = alt < 0.5 ? alt / 0.5 : (alt - 0.5) / 0.5;
    var c0 = SKY[st][i], c1 = SKY[st + 1][i];
    return [mix(c0[0], c1[0], k), mix(c0[1], c1[1], k), mix(c0[2], c1[2], k)];
  }
  function rgb(c) { return 'rgb(' + c.join(',') + ')'; }
  function hex(c) { return '#' + c.map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join(''); }
  function ease(t) { t = Math.min(1, Math.max(0, t)); return 1 - Math.pow(1 - t, 3); }
  function bell(x, c, w) { return Math.max(0, 1 - Math.abs(x - c) / w); }
  function rnd(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  var r = rnd(11);
  var clouds = [], gulls = [], stars = [], balloons = [], lanterns = [], flags = [];
  for (var i = 0; i < 12; i++) clouds.push({ x: r(), y: 0.3 + r() * 3, s: 0.6 + r() * 0.9, v: 0.3 + r() * 0.7 });
  for (i = 0; i < 8; i++) gulls.push({ x: r(), y: 0.4 + r() * 1.1, s: 0.8 + r() * 0.5, v: 0.6 + r() * 0.6, p: r() * 6 });
  for (i = 0; i < 90; i++) stars.push({ x: r(), y: r() * 0.75, r: 0.6 + r() * 1.5, t: r() * 6 });
  var BAL = [['#ff5a7a', '#ffd23f'], ['#3ec7ff', '#ffffff'], ['#7a5cff', '#ff9a3c'], ['#24c98a', '#fff3a0']];
  for (i = 0; i < 5; i++) balloons.push({ x: r(), y: 1.1 + r() * 1.8, s: 0.6 + r() * 0.6, c: BAL[i % BAL.length], p: r() * 6, v: 0.15 + r() * 0.3 });
  for (i = 0; i < 16; i++) lanterns.push({ x: r(), y: r(), s: 0.6 + r() * 0.6, p: r() * 6, v: 0.6 + r() * 0.8 });
  var FLAG = ['#ff4f9a', '#ffd23f', '#3ec7ff', '#7a5cff', '#24c98a', '#ff9a3c'];
  for (i = 0; i < 24; i++) flags.push(FLAG[i % FLAG.length]);

  var sc = { particles: [], snapAt: 0, confettiAt: 0 };

  // ---------------------------------------------------------------- drawing helpers
  function ellipse(ctx, x, y, rx, ry, rot, fill) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  }
  function cloud(ctx, x, y, s, a, night) {
    ctx.save(); ctx.globalAlpha = a;
    var c = night ? '#bdb6ea' : '#fffaf4';
    [[0, 0, 1], [-0.6, 0.15, 0.7], [0.6, 0.12, 0.75], [-0.25, -0.3, 0.6], [0.28, -0.24, 0.62]].forEach(function (b) {
      ellipse(ctx, x + b[0] * 62 * s, y + b[1] * 30 * s, 46 * s * b[2], 24 * s * b[2], 0, c);
    });
    ctx.restore();
  }
  function gull(ctx, x, y, s, flap, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 2.4 * s; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var w = Math.sin(flap) * 7 * s;
    ctx.beginPath(); ctx.moveTo(x - 13 * s, y - 2 - w); ctx.quadraticCurveTo(x - 6 * s, y - 6 * s, x, y); ctx.quadraticCurveTo(x + 6 * s, y - 6 * s, x + 13 * s, y - 2 - w); ctx.stroke();
  }
  function balloon(ctx, x, y, s, c, t) {
    var R = 34 * s;
    ctx.save();
    ctx.translate(x, y + Math.sin(t) * 4 * s);
    for (var k = 0; k < 6; k++) { // striped envelope
      ctx.beginPath();
      ctx.moveTo(0, R * 1.15);
      ctx.bezierCurveTo(-R * 1.3 + k * R * 0.52, R * 0.6, -R * 1.15 + k * R * 0.46, -R * 1.2, 0, -R);
      ctx.bezierCurveTo(-R * 1.15 + (k + 1) * R * 0.46, -R * 1.2, -R * 1.3 + (k + 1) * R * 0.52, R * 0.6, 0, R * 1.15);
      ctx.fillStyle = c[k % 2]; ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,30,20,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-R * 0.3, R * 1.1); ctx.lineTo(-R * 0.22, R * 1.5); ctx.moveTo(R * 0.3, R * 1.1); ctx.lineTo(R * 0.22, R * 1.5); ctx.stroke();
    ctx.fillStyle = '#8a5a2a'; ctx.fillRect(-R * 0.25, R * 1.5, R * 0.5, R * 0.35);
    ctx.restore();
  }
  function lantern(ctx, x, y, s, glow) {
    var g = ctx.createRadialGradient(x, y, 1, x, y, 26 * s);
    g.addColorStop(0, 'rgba(255,190,90,' + 0.5 * glow + ')'); g.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 26 * s, y - 26 * s, 52 * s, 52 * s);
    ctx.fillStyle = 'rgba(255,170,70,' + glow + ')';
    ctx.beginPath(); ctx.moveTo(x - 6 * s, y - 9 * s); ctx.lineTo(x + 6 * s, y - 9 * s); ctx.lineTo(x + 4.5 * s, y + 8 * s); ctx.lineTo(x - 4.5 * s, y + 8 * s); ctx.closePath(); ctx.fill();
  }

  // the kite: centre (x, y), size s, rotation; the tail waves from its lower tip
  function kite(ctx, x, y, s, rot, t, tailLen) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    // tail: a ribbon with bows, waving in the wind
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, s * 0.62);
    var pts = [];
    for (var k = 1; k <= 10; k++) {
      var px = Math.sin(t / 260 + k * 0.8) * s * 0.12 * k * 0.35 - k * s * 0.05, py = s * 0.62 + k * s * 0.17 * (tailLen || 1);
      ctx.lineTo(px, py); pts.push([px, py]);
    }
    ctx.stroke();
    pts.forEach(function (p, k) {
      if (k % 2) return;
      ctx.fillStyle = FLAG[k % FLAG.length];
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] - s * 0.08, p[1] - s * 0.05); ctx.lineTo(p[0] - s * 0.08, p[1] + s * 0.05); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + s * 0.08, p[1] - s * 0.05); ctx.lineTo(p[0] + s * 0.08, p[1] + s * 0.05); ctx.closePath(); ctx.fill();
    });
    // sail: four coloured panels with a soft shine
    var top = [0, -s * 0.62], rt = [s * 0.42, -s * 0.08], bot = [0, s * 0.62], lf = [-s * 0.42, -s * 0.08], mid = [0, -s * 0.08];
    [[top, rt, '#ffd23f'], [rt, bot, '#7a5cff'], [bot, lf, '#3ec7ff'], [lf, top, '#ff4f9a']].forEach(function (q) {
      ctx.beginPath(); ctx.moveTo(mid[0], mid[1]); ctx.lineTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.closePath(); ctx.fillStyle = q[2]; ctx.fill();
    });
    var sh = ctx.createLinearGradient(-s * 0.4, -s * 0.6, s * 0.4, s * 0.6);
    sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(rt[0], rt[1]); ctx.lineTo(bot[0], bot[1]); ctx.lineTo(lf[0], lf[1]); ctx.closePath(); ctx.fillStyle = sh; ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,60,0.8)'; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(bot[0], bot[1]); ctx.moveTo(lf[0], lf[1]); ctx.lineTo(rt[0], rt[1]); ctx.stroke();
    // a smiling sun badge in the middle
    ellipse(ctx, 0, -s * 0.08, s * 0.1, s * 0.1, 0, '#fff4c2');
    ctx.strokeStyle = '#a0522d'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, -s * 0.07, s * 0.05, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.restore();
  }

  function burst(x, y, n, colors, speed, life) {
    for (var k = 0; k < n; k++) {
      var a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random());
      sc.particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, w: 4 + Math.random() * 5, c: colors[k % colors.length], t0: performance.now(), life: life, spin: Math.random() * 10 });
    }
  }
  function particles(ctx, v) {
    sc.particles = sc.particles.filter(function (p) { return v.now - p.t0 < p.life; });
    sc.particles.forEach(function (p) {
      var t = (v.now - p.t0) / 1000;
      ctx.save();
      ctx.globalAlpha = 1 - (v.now - p.t0) / p.life;
      ctx.translate(p.x + p.vx * t, p.y + p.vy * t + 260 * t * t);
      ctx.rotate(p.spin * t);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
      ctx.restore();
    });
  }

  // ---------------------------------------------------------------- the world
  function roofY(v) { return v.H * 0.86 + v.alt * v.H * 3.2; }

  function world(ctx, v) {
    var W = v.W, H = v.H, A = v.alt * H * 3.2, L = v.LEFT, T = v.TOP, FW = v.FULL_W, FH = v.FULL_H;
    var night = Math.max(0, Math.min(1, (v.alt - 0.6) / 0.3));
    var g = ctx.createLinearGradient(0, -T, 0, H);
    g.addColorStop(0, rgb(skyCol(0, v.alt))); g.addColorStop(1, rgb(skyCol(1, v.alt)));
    ctx.fillStyle = g; ctx.fillRect(-L, -T, FW, FH);
    if (night > 0) {
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.45 + 0.55 * Math.sin(v.now / 480 + st.t));
        ellipse(ctx, st.x * FW - L, st.y * FH - T, st.r, st.r, 0, '#fff');
      });
      ctx.globalAlpha = night;
      var mx = W * 0.2, my = H * 0.15, mr = Math.min(W, H) * 0.07;
      ellipse(ctx, mx, my, mr, mr, 0, '#fff3d0');
      ellipse(ctx, mx + mr * 0.35, my - mr * 0.15, mr * 0.85, mr * 0.85, 0, rgb(skyCol(0, v.alt))); // a crescent
      ctx.globalAlpha = 1;
    }
    // the setting sun over the sea
    var sunA = bell(v.alt, 0.42, 0.35);
    var hy = H * 0.68 + A * 0.55;
    if (sunA > 0 && hy < H + 80) {
      var sy = hy - H * 0.08 + v.alt * H * 0.1, sr = Math.min(W, H) * 0.11;
      var sg = ctx.createRadialGradient(W * 0.72, sy, sr * 0.3, W * 0.72, sy, sr * 3);
      sg.addColorStop(0, 'rgba(255,220,140,' + 0.6 * sunA + ')'); sg.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = sg; ctx.fillRect(-L, sy - sr * 3, FW, sr * 6);
      ctx.globalAlpha = sunA; ellipse(ctx, W * 0.72, sy, sr, sr, 0, '#ffe08a'); ctx.globalAlpha = 1;
    }
    // sea
    if (hy < H + 60) {
      var sea = ctx.createLinearGradient(0, hy, 0, hy + H * 0.4);
      sea.addColorStop(0, night > 0.4 ? '#24306a' : v.alt > 0.3 ? '#e08a7a' : '#2bb5d8');
      sea.addColorStop(1, night > 0.4 ? '#121a40' : '#0f6f9a');
      ctx.fillStyle = sea; ctx.fillRect(-L, hy, FW, FH);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
      for (var k = 0; k < 9; k++) {
        var wx = ((k * 0.13 + v.now * 0.00004 * (1 + k % 3)) % 1.2 - 0.1) * W - L * 0.2, wy = hy + H * (0.015 + k * 0.018);
        ctx.beginPath(); ctx.moveTo(wx - 14, wy); ctx.quadraticCurveTo(wx, wy - 4, wx + 14, wy); ctx.stroke();
      }
      // a little sailboat on the horizon
      var bx = ((v.now * 0.000012) % 1.3 - 0.15) * W;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(bx, hy - 2); ctx.lineTo(bx, hy - 22); ctx.lineTo(bx + 14, hy - 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7a4a2a'; ctx.fillRect(bx - 8, hy - 3, 24, 4);
    }
    // clouds
    clouds.forEach(function (c) {
      var span = FW * 1.6, cx = (((c.x * span + v.now * 0.005 * c.v) % span) + span) % span - FW * 0.3 - L;
      var cy = H * 0.5 - c.y * H + A * 0.9;
      if (cy > -T - 60 && cy < H + 60) cloud(ctx, cx, cy, c.s * (H / 380), 0.9, night > 0.5);
    });
    // hot-air balloons (drifting slowly, the higher part of the climb)
    balloons.forEach(function (b) {
      var bx2 = (((b.x + v.now * 0.000006 * b.v) % 1.2) - 0.1) * W, by = H * 0.5 - b.y * H + A * 0.85;
      if (by > -T - 80 && by < H + 80) balloon(ctx, bx2, by, b.s * (H / 420), b.c, v.now / 900 + b.p);
    });
    // gulls (low)
    if (v.alt < 0.55) gulls.forEach(function (gl) {
      var gx = (((gl.x + v.now * 0.00003 * gl.v) % 1.3) - 0.15) * FW - L, gy = H * 0.55 - gl.y * H + A * 0.95;
      if (gy > -T && gy < H) gull(ctx, gx, gy, gl.s, v.now / 130 + gl.p, night > 0.4 ? '#dcd6ff' : '#ffffff');
    });
    // sky lanterns rising at night
    if (night > 0) lanterns.forEach(function (ln) {
      var lx = ln.x * FW - L + Math.sin(v.now / 1500 + ln.p) * 10, ly = H - ((ln.y * H + v.now * 0.012 * ln.v) % (H + T + 60)) + 30;
      lantern(ctx, lx, ly, ln.s * (H / 420), night * (0.7 + 0.3 * Math.sin(v.now / 300 + ln.p)));
    });
    // the festival rooftop (foreground)
    var ry = roofY(v);
    if (ry < H + H * 0.7) {
      // bunting across the roof
      ctx.strokeStyle = 'rgba(60,30,40,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-L, ry - H * 0.2); ctx.quadraticCurveTo(W * 0.5, ry - H * 0.1, W + 10, ry - H * 0.22); ctx.stroke();
      for (k = 0; k < 24; k++) {
        var f = k / 23, fx = -L + (W + 10 + L) * f, fy = (1 - f) * (1 - f) * (ry - H * 0.2) + 2 * (1 - f) * f * (ry - H * 0.1) + f * f * (ry - H * 0.22);
        ctx.fillStyle = flags[k]; ctx.beginPath(); ctx.moveTo(fx - 7, fy); ctx.lineTo(fx + 7, fy); ctx.lineTo(fx, fy + 14 + Math.sin(v.now / 300 + k) * 2); ctx.closePath(); ctx.fill();
      }
      // paper lanterns on the roof (glow at dusk/night)
      [0.08, 0.86].forEach(function (lx2) {
        var lx3 = lx2 * W, ly2 = ry - H * 0.08;
        ctx.strokeStyle = '#3a2030'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx3, ly2 - 24); ctx.lineTo(lx3, ly2 - 12); ctx.stroke();
        ellipse(ctx, lx3, ly2, 12, 14, 0, '#ff5a5a');
        if (v.alt > 0.3) { ctx.globalAlpha = 0.35; ellipse(ctx, lx3, ly2, 26, 26, 0, '#ffb36b'); ctx.globalAlpha = 1; }
      });
      // roof deck + railing
      var dg = ctx.createLinearGradient(0, ry, 0, ry + H * 0.2);
      dg.addColorStop(0, '#c4744a'); dg.addColorStop(1, '#8a4a2e');
      ctx.fillStyle = dg; ctx.fillRect(-L, ry, FW, FH);
      ctx.fillStyle = '#5a2e1e'; ctx.fillRect(-L, ry - 4, FW, 6);
      ctx.strokeStyle = '#f4e1c8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-L, ry - H * 0.07); ctx.lineTo(W + 10, ry - H * 0.07); ctx.stroke();
      for (var p2 = -L; p2 < W + 10; p2 += 22) { ctx.beginPath(); ctx.moveTo(p2, ry - H * 0.07); ctx.lineTo(p2, ry); ctx.stroke(); }
      // the reel the string is tied to
      ellipse(ctx, W * 0.16, ry - 10, 12, 12, 0, '#6b3a1e');
      ellipse(ctx, W * 0.16, ry - 10, 6, 6, 0, '#f4e1c8');
    }
  }

  function reel(v) { return { x: v.W * 0.16, y: roofY(v) - 10 }; }
  function flightPos(v) {
    return { x: v.W * 0.6 + Math.sin(v.now / 900) * v.W * 0.05, y: v.H * 0.34 + Math.sin(v.now / 650) * v.H * 0.025, rot: Math.sin(v.now / 700) * 0.12 };
  }
  function restPos(v) { var rr = reel(v); return { x: v.W * 0.28, y: rr.y - v.H * 0.07, rot: -0.6 + Math.sin(v.now / 800) * 0.04 }; }

  function string(ctx, a, b, sag, alpha) {
    ctx.strokeStyle = 'rgba(255,255,255,' + (alpha == null ? 0.85 : alpha) + ')'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2 + sag * 0.3, (a.y + b.y) / 2 + sag, b.x, b.y); ctx.stroke();
  }

  function drawRound(ctx, v) {
    var W = v.W, H = v.H, s = Math.min(H * 0.17, W * 0.2);
    var t = v.startAt ? v.now - v.startAt : 0, rr = reel(v);
    if (v.phase === 'idle' || v.phase === 'starting' || (v.phase !== 'running' && !v.startAt)) {
      var p0 = restPos(v), lift = v.phase === 'starting' ? Math.sin(v.now / 60) * 3 - 6 : 0;
      string(ctx, rr, { x: p0.x, y: p0.y + s * 0.5 + lift }, 18);
      kite(ctx, p0.x, p0.y + lift, s * 0.9, p0.rot, v.now, 0.45);
      return;
    }
    var fp = flightPos(v);
    if (v.phase === 'running' && t < TAKEOFF_MS) { // the gust lifts it from the roof
      var k = ease(t / TAKEOFF_MS), p1 = restPos(v);
      var cur = { x: p1.x + (fp.x - p1.x) * k, y: p1.y + (fp.y - p1.y) * k, rot: p1.rot + (fp.rot - p1.rot) * k };
      string(ctx, rr, { x: cur.x, y: cur.y + s * 0.5 }, 30 * (1 - k) + 8);
      kite(ctx, cur.x, cur.y, s, cur.rot, v.now, 0.45 + 0.55 * k);
      return;
    }
    if (v.phase === 'busted') { // the string snaps: the kite tumbles away, the loose string falls
      var bt = v.now - v.endAt, kb = Math.min(1, bt / TUMBLE_MS);
      var tail = { x: fp.x, y: fp.y + s * 0.5 };
      string(ctx, rr, { x: rr.x + (tail.x - rr.x) * 0.5, y: rr.y + (tail.y - rr.y) * 0.5 + kb * H * 0.35 }, 20 + kb * 60, 0.85 * (1 - kb));
      if (bt < TUMBLE_MS + 200) {
        var kx = fp.x + kb * kb * W * 0.6 + Math.sin(bt / 90) * 10, ky = fp.y - kb * H * 0.55 + Math.sin(bt / 140) * 12;
        kite(ctx, kx, ky, s * (1 - kb * 0.55), fp.rot + kb * 9, v.now, 1);
        string(ctx, { x: kx, y: ky + s * 0.5 * (1 - kb * 0.55) }, { x: kx - 30, y: ky + H * 0.2 }, 30, 0.7 * (1 - kb));
      }
      return;
    }
    if (v.phase === 'cashed') {
      if (!sc.confettiAt) { sc.confettiAt = v.now; burst(fp.x, fp.y, 40, FLAG, 260, 1400); }
      var glow = ctx.createRadialGradient(fp.x, fp.y, s * 0.2, fp.x, fp.y, s * 1.4);
      glow.addColorStop(0, 'rgba(255,240,160,0.45)'); glow.addColorStop(1, 'rgba(255,240,160,0)');
      ctx.fillStyle = glow; ctx.fillRect(fp.x - s * 1.4, fp.y - s * 1.4, s * 2.8, s * 2.8);
    } else sc.confettiAt = 0;
    string(ctx, rr, { x: fp.x, y: fp.y + s * 0.5 }, 16 + Math.sin(v.now / 500) * 6);
    kite(ctx, fp.x, fp.y, s, fp.rot, v.now, 1);
  }

  // ---------------------------------------------------------------- music (breezy plucks)
  var MEL = [7, 9, 12, 9, 7, 4, 7, 9, 5, 7, 9, 12, 14, 12, 9, 7, 7, 9, 12, 16, 14, 12, 9, 12, 5, 4, 2, 4, 7, 4, 2, 0];
  var CH = [0, 0, 5, 5, -3, -3, 7, 7];
  function note(n) { return 293.66 * Math.pow(2, n / 12); }
  var wind = null;

  window.Scene = {
    event: '88.0028',
    code: 'kiteflyer',
    betLabel: 'Fly!',
    stepDur: 0.22,
    draw: function (ctx, v) {
      world(ctx, v);
      drawRound(ctx, v);
      particles(ctx, v);
    },
    topColour: function (v) { return hex(skyCol(0, v.alt)); },
    tick: function (v, synth) {
      if (v.phase === 'running' && !wind && synth.ctx) wind = synth.loop({ filter: 'bandpass', freq: 500, q: 0.7, gain: 0.22 });
      if (wind) {
        if (v.phase === 'running') wind.set(0.35 + v.alt * 0.65, 400 + v.alt * 900);
        else { wind.stop(v.phase === 'busted' ? 0.15 : 0.6); wind = null; }
      }
    },
    onSignal: function (name, v, synth) {
      if (name === 'start') { // the gust: as long as the lift animation
        synth.noise({ dur: TAKEOFF_MS / 1000, gain: 0.3, filter: 'bandpass', freq: 300, freqEnd: 1600, q: 0.8, attack: 0.15 });
        synth.tone({ type: 'sine', freq: 330, freqEnd: 660, dur: TAKEOFF_MS / 1000, gain: 0.08, attack: 0.1 });
      }
      if (name === 'bust') { // the snap, then the flutter for as long as the kite tumbles away
        synth.noise({ dur: 0.08, gain: 0.5, filter: 'highpass', freq: 3000, attack: 0.002 });
        synth.tone({ type: 'square', freq: 1800, freqEnd: 300, dur: 0.14, gain: 0.08, attack: 0.002 });
        for (var k = 0; k < 14; k++) synth.noise({ at: 0.1 + k * (TUMBLE_MS / 1000 - 0.1) / 14, dur: 0.07, gain: 0.12 * (1 - k / 14), filter: 'bandpass', freq: 900 + (k % 2) * 400, q: 2 });
      }
      if (name === 'win') {
        [0, 4, 7, 11, 14].forEach(function (n, k) { synth.tone({ at: k * 0.07, type: 'sine', freq: note(n + 12), dur: 0.45, gain: 0.15 }); });
        synth.noise({ dur: 0.5, gain: 0.08, filter: 'highpass', freq: 5000, attack: 0.02 });
      }
    },
    musicStep: function (synth, step, time) {
      var m = MEL[step % MEL.length];
      if (step % 3 !== 2) synth.tone({ time: time, type: 'triangle', freq: note(m), dur: 0.16, gain: 0.07, bus: 'music' });
      if (step % 4 === 0) {
        var c = CH[(step / 4) % CH.length];
        [0, 4, 7].forEach(function (n) { synth.tone({ time: time, type: 'sine', freq: note(c + n - 12), dur: 0.8, gain: 0.03, attack: 0.08, bus: 'music' }); });
      }
    },
  };
})();
