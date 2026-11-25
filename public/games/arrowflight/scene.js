/* Arrow Flight — the scene and the sounds (all drawn / generated in code; our own art).
 * An enchanted arrow is loosed from a floating bow and flies through a magical forest at night —
 * ancient glowing trees, stone ruins with runes, moonlit lakes, fireflies — dusk turns to a starry
 * night and then an aurora as the multiplier climbs. Bust = it strikes a giant tree trunk (thud,
 * sparks). Cash-out = it bursts into stars. window.GameScene / window.GameAudio are used by app.js. */
(function () {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function mix(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function rgb(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')'; }
  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join(''); }
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // sky by stage (0 dusk → 0.5 night → 1 aurora): [top, horizon]
  var SKY = [
    [[64, 44, 118], [236, 136, 124]],
    [[12, 16, 44], [44, 44, 104]],
    [[6, 12, 32], [18, 58, 78]],
  ];
  function skyAt(k, i) {
    var a = k < 0.5 ? 0 : 1, kk = k < 0.5 ? k / 0.5 : (k - 0.5) / 0.5;
    return mix(SKY[a][i], SKY[a + 1][i], kk);
  }

  function create(canvas) {
    var ctx = canvas.getContext('2d');
    var V = { W: 1, H: 1, TOP: 0, LEFT: 0, FULL_W: 1, FULL_H: 1, dpr: 1 };
    var dist = 0, stageK = 0, trail = [], parts = [];
    var startAt = 0, winAt = 0, bustAt = 0, launchAt = 0, shakeUntil = 0;
    var arrowAt = { x: 0, y: 0, a: 0 }, bustPos = null;
    var flies = [], stars = [];
    for (var i = 0; i < 46; i++) flies.push({ x: Math.random(), y: 0.25 + Math.random() * 0.65, p: 0.6 + Math.random() * 0.7, ph: Math.random() * 6 });
    for (var j = 0; j < 90; j++) stars.push({ x: Math.random(), y: Math.random() * 0.6, r: 0.5 + Math.random() * 1.4, t: Math.random() * 6 });

    function resize(v) { V = v; }
    function onStart(now) { startAt = now; winAt = 0; bustAt = 0; bustPos = null; trail = []; }
    function onWin(now) {
      winAt = now;
      for (var i = 0; i < 70; i++) {
        var a = Math.random() * Math.PI * 2, sp = V.H * (0.25 + Math.random() * 0.8);
        parts.push({ kind: 'star', x: arrowAt.x, y: arrowAt.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.9 + Math.random() * 0.6, gold: Math.random() < 0.4, r: V.H * (0.006 + Math.random() * 0.01) });
      }
    }
    function onBust(now) {
      bustAt = now; shakeUntil = now + 320;
      bustPos = { x: arrowAt.x, y: arrowAt.y, a: arrowAt.a };
      var r = rng(now | 0);
      for (var i = 0; i < 36; i++) {
        var a = Math.PI + (r() - 0.5) * 2.4, sp = V.H * (0.4 + r() * 1.1);
        parts.push({ kind: r() < 0.7 ? 'spark' : 'chip', x: bustPos.x, y: bustPos.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - V.H * 0.2, t: 0, life: 0.35 + r() * 0.55, r: V.H * (0.004 + r() * 0.008), delay: r() * 0.25 });
      }
    }

    // ------------------------------------------------------------ the world
    function layerSegments(par, segW, fn) { // seeded items along the world at a parallax
      var off = dist * par, x0 = -V.LEFT, s0 = Math.floor((off + x0) / segW) - 1, s1 = Math.ceil((off + V.W) / segW) + 1;
      for (var s = s0; s <= s1; s++) fn(s * segW - off, s, rng(s * 2654435761 + Math.round(par * 1000)));
    }

    function drawSky(now) {
      var top = skyAt(stageK, 0), hor = skyAt(stageK, 1), groundY = V.H * 0.86;
      var g = ctx.createLinearGradient(0, -V.TOP, 0, groundY);
      g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(hor));
      ctx.fillStyle = g; ctx.fillRect(-V.LEFT, -V.TOP, V.FULL_W, V.FULL_H);
      var starA = clamp((stageK - 0.12) / 0.3, 0, 1);
      if (starA > 0) stars.forEach(function (s) {
        ctx.globalAlpha = starA * (0.45 + 0.55 * Math.sin(now / 500 + s.t));
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-V.LEFT + s.x * V.FULL_W, -V.TOP + s.y * V.FULL_H, s.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      // the moon (rises with the night)
      var mx = V.W * 0.8, my = lerp(V.H * 0.34, V.H * 0.14, clamp(stageK * 2, 0, 1)), mr = V.H * 0.07;
      var mg = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
      mg.addColorStop(0, 'rgba(255,246,220,0.35)'); mg.addColorStop(1, 'rgba(255,246,220,0)');
      ctx.fillStyle = mg; ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
      ctx.fillStyle = '#fff6de'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(210,200,180,0.35)'; ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, Math.PI * 2); ctx.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.15, 0, Math.PI * 2); ctx.fill();
      // aurora curtains
      var aur = clamp((stageK - 0.45) / 0.35, 0, 1);
      if (aur > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        [[110, 255, 190], [90, 200, 255], [190, 120, 255]].forEach(function (c, i) {
          for (var x = -V.LEFT; x < V.W; x += 6) {
            var y = V.H * (0.12 + 0.08 * i) + Math.sin(x / V.W * 4 + now / 1600 + i * 2) * V.H * 0.06;
            var hgt = V.H * (0.18 + 0.08 * Math.sin(x / 70 + now / 900 + i));
            var ag = ctx.createLinearGradient(0, y - hgt, 0, y);
            ag.addColorStop(0, rgb(c, 0)); ag.addColorStop(1, rgb(c, 0.1 * aur));
            ctx.fillStyle = ag; ctx.fillRect(x, y - hgt, 7, hgt);
          }
        });
        ctx.restore();
      }
    }

    function drawMountains() {
      var groundY = V.H * 0.86, col = mix([92, 70, 140], [22, 26, 62], clamp(stageK * 1.6, 0, 1));
      ctx.fillStyle = rgb(col); ctx.beginPath(); ctx.moveTo(-V.LEFT, groundY);
      for (var x = -V.LEFT; x <= V.W + 12; x += 12) {
        var wx = x + dist * 0.06;
        ctx.lineTo(x, groundY - V.H * (0.26 + 0.1 * Math.sin(wx / 160) + 0.06 * Math.sin(wx / 63 + 1.3)));
      }
      ctx.lineTo(V.W + 12, groundY); ctx.closePath(); ctx.fill();
      // far pine line
      var pc = mix([60, 46, 96], [12, 18, 40], clamp(stageK * 1.6, 0, 1));
      ctx.fillStyle = rgb(pc);
      layerSegments(0.2, 26, function (x, s, r) {
        var h = V.H * (0.1 + r() * 0.09), base = groundY + 2;
        ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x + 13, base - h); ctx.lineTo(x + 26, base); ctx.closePath(); ctx.fill();
      });
    }

    function drawGround(now) {
      var groundY = V.H * 0.86, seg = V.W * 0.9;
      layerSegments(1, seg, function (x, s, r) {
        var lake = r() < 0.38;
        if (lake) { // moonlit water with ripples and the moon's streak
          var lg = ctx.createLinearGradient(0, groundY, 0, V.FULL_H);
          lg.addColorStop(0, rgb(mix(skyAt(stageK, 1), [20, 30, 70], 0.4))); lg.addColorStop(1, rgb([8, 12, 32]));
          ctx.fillStyle = lg; ctx.fillRect(x, groundY, seg + 1, V.FULL_H);
          ctx.fillStyle = 'rgba(255,246,220,0.25)';
          for (var k = 0; k < 6; k++) { var yy = groundY + 6 + k * 9, ww = seg * (0.12 + 0.05 * Math.sin(now / 400 + k)); ctx.fillRect(x + seg * 0.55 - ww / 2, yy, ww, 2); }
          ctx.strokeStyle = 'rgba(180,230,255,0.25)'; ctx.lineWidth = 1;
          for (var q = 0; q < 4; q++) { var ry = groundY + 10 + q * 12; ctx.beginPath(); ctx.ellipse(x + seg * (0.2 + 0.2 * q), ry, 18 + 6 * Math.sin(now / 500 + q), 3, 0, 0, Math.PI * 2); ctx.stroke(); }
        } else { // mossy forest floor
          var fg = ctx.createLinearGradient(0, groundY, 0, V.FULL_H);
          fg.addColorStop(0, rgb(mix([40, 70, 62], [14, 34, 34], clamp(stageK * 1.5, 0, 1)))); fg.addColorStop(1, '#070d18');
          ctx.fillStyle = fg; ctx.fillRect(x, groundY, seg + 1, V.FULL_H);
        }
      });
      // mist over the ground
      var mg = ctx.createLinearGradient(0, groundY - V.H * 0.08, 0, groundY + V.H * 0.04);
      mg.addColorStop(0, 'rgba(200,220,255,0)'); mg.addColorStop(0.6, 'rgba(200,220,255,0.12)'); mg.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.fillStyle = mg; ctx.fillRect(-V.LEFT, groundY - V.H * 0.08, V.FULL_W, V.H * 0.12);
    }

    function ancientTree(x, base, h, r, now) {
      var w = h * 0.12, glow = 0.5 + 0.5 * Math.sin(now / 900 + x * 0.01);
      ctx.fillStyle = '#1a1730'; ctx.beginPath(); ctx.moveTo(x - w, base); ctx.quadraticCurveTo(x - w * 0.5, base - h * 0.5, x - w * 0.35, base - h); ctx.lineTo(x + w * 0.35, base - h); ctx.quadraticCurveTo(x + w * 0.5, base - h * 0.5, x + w, base); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#16233a';
      for (var b = 0; b < 5; b++) { ctx.beginPath(); ctx.ellipse(x + (b - 2) * w * 1.2, base - h * (0.95 + (b % 2) * 0.08), w * (1.8 + r() * 0.6), h * 0.14, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; // glowing runes in the bark
      ctx.strokeStyle = 'rgba(120,255,220,' + 0.45 * glow + ')'; ctx.lineWidth = 2;
      for (var k = 0; k < 3; k++) { var yy = base - h * (0.25 + k * 0.18); ctx.beginPath(); ctx.moveTo(x - w * 0.3, yy); ctx.lineTo(x, yy - 8); ctx.lineTo(x + w * 0.3, yy); ctx.stroke(); }
      ctx.restore();
    }

    function ruin(x, base, h) {
      ctx.fillStyle = '#2a2a48';
      ctx.fillRect(x - h * 0.3, base - h, h * 0.12, h); ctx.fillRect(x + h * 0.18, base - h, h * 0.12, h);
      ctx.beginPath(); ctx.arc(x, base - h, h * 0.3, Math.PI, 0); ctx.lineTo(x + h * 0.18, base - h); ctx.arc(x, base - h, h * 0.18, 0, Math.PI, true); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(150,200,255,0.45)'; ctx.beginPath(); ctx.arc(x, base - h * 1.12, h * 0.03, 0, Math.PI * 2); ctx.fill();
    }

    function drawMidground(now) {
      var base = V.H * 0.88;
      layerSegments(0.55, V.W * 0.55, function (x, s, r) {
        var kind = r();
        if (kind < 0.55) ancientTree(x + r() * 40, base, V.H * (0.55 + r() * 0.25), r, now);
        else if (kind < 0.8 && stageK > 0.12) ruin(x + 30, base, V.H * (0.28 + r() * 0.12));
      });
    }

    function drawForeground(now) {
      var base = V.H * 0.95;
      layerSegments(1.15, 70, function (x, s, r) {
        if (r() < 0.5) { // glowing mushrooms
          var h = V.H * (0.03 + r() * 0.04), cap = h * 0.9, c = r() < 0.5 ? [120, 230, 255] : [200, 140, 255];
          ctx.fillStyle = '#d8d0e8'; ctx.fillRect(x - h * 0.12, base - h, h * 0.24, h);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          var g = ctx.createRadialGradient(x, base - h, 0, x, base - h, cap * 2.2); g.addColorStop(0, rgb(c, 0.5)); g.addColorStop(1, rgb(c, 0));
          ctx.fillStyle = g; ctx.fillRect(x - cap * 2.2, base - h - cap * 2.2, cap * 4.4, cap * 4.4); ctx.restore();
          ctx.fillStyle = rgb(c); ctx.beginPath(); ctx.arc(x, base - h, cap, Math.PI, 0); ctx.fill();
        } else { // fern
          ctx.strokeStyle = '#1d3b3a'; ctx.lineWidth = 2;
          for (var f = -2; f <= 2; f++) { ctx.beginPath(); ctx.moveTo(x, base); ctx.quadraticCurveTo(x + f * 8, base - 20, x + f * 16, base - 26 - Math.abs(f) * 3); ctx.stroke(); }
        }
      });
    }

    function drawFireflies(now) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      flies.forEach(function (f) {
        var span = V.FULL_W + 40, x = ((f.x * span - dist * f.p * 0.6) % span + span) % span - V.LEFT - 20;
        var y = V.H * f.y + Math.sin(now / 700 + f.ph) * V.H * 0.02, a = 0.5 + 0.5 * Math.sin(now / 300 + f.ph * 3);
        var g = ctx.createRadialGradient(x, y, 0, x, y, 9); g.addColorStop(0, 'rgba(240,255,170,' + 0.9 * a + ')'); g.addColorStop(1, 'rgba(240,255,170,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 9, y - 9, 18, 18);
      });
      ctx.restore();
    }

    // ------------------------------------------------------------ bow + arrow
    function arrowShape(x, y, a, len, alpha) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.globalAlpha = alpha;
      // tip glow
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, len * 0.3); g.addColorStop(0, 'rgba(180,250,255,0.9)'); g.addColorStop(1, 'rgba(87,227,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-len * 0.3, -len * 0.3, len * 0.6, len * 0.6); ctx.restore();
      // shaft with runes
      ctx.fillStyle = '#c9a36a'; ctx.fillRect(-len, -len * 0.018, len * 0.92, len * 0.036);
      ctx.fillStyle = 'rgba(120,255,230,0.9)'; for (var k = 0; k < 4; k++) ctx.fillRect(-len * (0.7 - k * 0.12), -len * 0.012, len * 0.03, len * 0.024);
      // head
      ctx.fillStyle = '#e8fbff'; ctx.beginPath(); ctx.moveTo(len * 0.02, 0); ctx.lineTo(-len * 0.12, -len * 0.06); ctx.lineTo(-len * 0.09, 0); ctx.lineTo(-len * 0.12, len * 0.06); ctx.closePath(); ctx.fill();
      // fletching
      ctx.fillStyle = '#57e3ff'; ctx.beginPath(); ctx.moveTo(-len * 0.82, 0); ctx.lineTo(-len * 1.0, -len * 0.075); ctx.lineTo(-len * 0.94, 0); ctx.lineTo(-len * 1.0, len * 0.075); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-len * 0.86, 0); ctx.lineTo(-len * 0.97, -len * 0.04); ctx.lineTo(-len * 0.92, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    function bow(x, y, pull, alpha, len) {
      var h = len * 0.85;
      ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.8); g.addColorStop(0, 'rgba(87,227,255,0.25)'); g.addColorStop(1, 'rgba(87,227,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-h, -h, h * 2, h * 2); ctx.restore();
      ctx.strokeStyle = '#d9b56e'; ctx.lineWidth = Math.max(3, len * 0.035); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-h * 0.08, -h * 0.5); ctx.quadraticCurveTo(h * 0.32, 0, -h * 0.08, h * 0.5); ctx.stroke();
      ctx.strokeStyle = '#57e3ff'; ctx.lineWidth = 1.5; // the string, drawn back by `pull`
      ctx.beginPath(); ctx.moveTo(-h * 0.08, -h * 0.5); ctx.lineTo(-pull, 0); ctx.lineTo(-h * 0.08, h * 0.5); ctx.stroke();
      ctx.restore();
    }

    function drawTrail(now) {
      if (trail.length < 2) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var i = 1; i < trail.length; i++) {
        var p = trail[i], q = trail[i - 1], k = i / trail.length;
        ctx.strokeStyle = 'rgba(120,235,255,' + 0.5 * k + ')'; ctx.lineWidth = Math.max(1, V.H * 0.018 * k);
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.restore();
    }

    function drawParts(dt) {
      var s = dt / 1000;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      parts = parts.filter(function (p) {
        if (p.delay > 0) { p.delay -= s; return true; }
        p.t += s; if (p.t > p.life) return false;
        var k = p.t / p.life;
        if (p.kind === 'chip') p.vy += V.H * 2.2 * s; else p.vy += V.H * 0.6 * s;
        p.x += p.vx * s; p.y += p.vy * s;
        if (p.kind === 'spark') { ctx.strokeStyle = 'rgba(255,200,90,' + (1 - k) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke(); }
        else if (p.kind === 'chip') { ctx.fillStyle = 'rgba(150,110,70,' + (1 - k) + ')'; ctx.fillRect(p.x, p.y, p.r * 2, p.r); }
        else { var c = p.gold ? '255,220,120' : '160,245,255'; ctx.fillStyle = 'rgba(' + c + ',' + (1 - k) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.3 - k), 0, Math.PI * 2); ctx.fill(); }
        return true;
      });
      ctx.restore();
    }

    function trunk(x, alpha) { // the giant tree the arrow strikes
      var w = V.W * 0.32;
      ctx.save(); ctx.globalAlpha = alpha;
      var g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#5a4128'); g.addColorStop(0.4, '#3d2b1a'); g.addColorStop(1, '#22170d');
      ctx.fillStyle = g; ctx.fillRect(x, -V.TOP, w + V.LEFT + V.W, V.FULL_H);
      ctx.strokeStyle = 'rgba(20,12,6,0.6)'; ctx.lineWidth = 3;
      for (var k = 0; k < 7; k++) { var xx = x + w * (0.1 + k * 0.13); ctx.beginPath(); ctx.moveTo(xx, -V.TOP); ctx.bezierCurveTo(xx + 10, V.H * 0.3, xx - 10, V.H * 0.6, xx + 6, V.FULL_H); ctx.stroke(); }
      ctx.fillStyle = 'rgba(110,220,150,0.35)'; ctx.beginPath(); ctx.ellipse(x + w * 0.2, V.H * 0.2, w * 0.15, V.H * 0.05, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ------------------------------------------------------------ frame
    function frame(now, dt, st) {
      var running = st.phase === 'running' && st.startedAt;
      var target = running || st.phase === 'busted' || st.phase === 'cashed' ? clamp(Math.log(Math.max(1, st.mult)) / Math.log(30), 0, 1) : 0;
      stageK = lerp(stageK, target, Math.min(1, dt / (st.phase === 'idle' ? 900 : 300)));
      var speed = running ? V.H * (0.5 + 0.6 * Math.log(Math.max(1, st.mult))) : st.phase === 'busted' ? 0 : V.H * 0.05;
      dist += speed * dt / 1000;
      if (st.phase === 'launch' && !launchAt) launchAt = now;
      if (st.phase !== 'launch') launchAt = 0;
      if (st.phase === 'idle') { startAt = 0; winAt = 0; bustAt = 0; bustPos = null; trail = []; }

      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      ctx.clearRect(0, 0, V.FULL_W, V.FULL_H);
      ctx.translate(V.LEFT, V.TOP);
      if (now < shakeUntil) { var sh = (shakeUntil - now) / 320 * V.H * 0.015; ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh); }
      drawSky(now); drawMountains(); drawMidground(now); drawGround(now); drawFireflies(now);

      var len = Math.min(V.W * 0.36, V.H * 0.5), restX = V.W * 0.28, restY = V.H * 0.46;
      var cruiseX = V.W * 0.42, cruiseY = V.H * 0.44 + Math.sin(now / 520) * V.H * 0.035, cruiseA = Math.cos(now / 520) * 0.08;
      if (st.phase === 'idle' || st.phase === 'starting' || st.phase === 'launch') {
        var bob = Math.sin(now / 800) * V.H * 0.012;
        var pull = st.phase === 'launch' ? ease((now - launchAt) / 380) * len * 0.22 : st.phase === 'starting' ? len * 0.06 : 0;
        bow(restX + len * 0.1, restY + bob, pull + len * 0.02, 1, len);
        arrowAt = { x: restX + len * 0.95 - pull, y: restY + bob, a: 0 };
        arrowShape(arrowAt.x, arrowAt.y, 0, len, 1);
      } else if (running) {
        var t = now - startAt, k = ease(t / 450);
        if (t < 900) bow(restX + len * 0.1 - ease(t / 900) * len * 0.8, restY, len * 0.02, 1 - ease(t / 900), len);
        arrowAt = { x: lerp(restX + len * 0.95, cruiseX + len * 0.5, k), y: lerp(restY, cruiseY, k), a: cruiseA * k };
        trail.push({ x: arrowAt.x - len, y: arrowAt.y });
        trail.forEach(function (p) { p.x -= speed * dt / 1000 * 0.9; });
        if (trail.length > 26) trail.shift();
        drawTrail(now);
        arrowShape(arrowAt.x, arrowAt.y, arrowAt.a, len, 1);
        if (Math.random() < 0.5) parts.push({ kind: 'star', x: arrowAt.x - len * (0.2 + Math.random() * 0.8), y: arrowAt.y + (Math.random() - 0.5) * 6, vx: -speed * 0.4, vy: (Math.random() - 0.5) * 30, t: 0, life: 0.5, r: V.H * 0.004, gold: false });
      } else if (st.phase === 'busted' && bustPos) {
        var bt = now - bustAt, slide = ease(bt / 220);
        trunk(lerp(V.W + V.LEFT, bustPos.x - len * 0.02, slide), 1);
        var wob = Math.sin(bt / 1000 * 45) * 0.14 * Math.max(0, 1 - bt / 800);
        arrowShape(bustPos.x, bustPos.y, bustPos.a + wob, len, 1);
        var flash = Math.max(0, 1 - bt / 500);
        if (flash) { ctx.fillStyle = 'rgba(255,60,60,' + 0.25 * flash + ')'; ctx.fillRect(-V.LEFT, -V.TOP, V.FULL_W, V.FULL_H); }
      } else if (st.phase === 'cashed') {
        var ct = now - winAt;
        if (ct < 420) arrowShape(arrowAt.x + ct * 0.3, arrowAt.y, arrowAt.a, len, 1 - ct / 420);
      }
      drawForeground(now);
      drawParts(dt);
    }

    function topColor() { return hex(skyAt(stageK, 0)); }

    return { resize: resize, frame: frame, topColor: topColor, onStart: onStart, onWin: onWin, onBust: onBust };
  }

  window.GameScene = { create: create };

  // ---------------------------------------------------------------- sounds + music (WebAudio)
  var A = null, sfx = null, music = null, soundOn = true, musicOn = true, wind = null, scheduler = 0, nextBeat = 0, beat = 0;
  function ac() {
    if (A) return A;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    A = new C();
    var master = A.createGain(); master.gain.value = 0.9; master.connect(A.destination);
    sfx = A.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
    music = A.createGain(); music.gain.value = musicOn ? 0.5 : 0;
    var delay = A.createDelay(1), fb = A.createGain(), wet = A.createGain(); // a soft echo for the music
    delay.delayTime.value = 0.33; fb.gain.value = 0.35; wet.gain.value = 0.35;
    music.connect(master); music.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
    return A;
  }
  function noise(sec, loop) {
    var b = A.createBuffer(1, Math.max(1, Math.floor(A.sampleRate * sec)), A.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var s = A.createBufferSource(); s.buffer = b; s.loop = !!loop; return s;
  }
  function tone(type, f, t, dur, vol, out, glideTo, attack) {
    var o = A.createOscillator(), g = A.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  function burst(t, dur, vol, type, freq, out) {
    var n = noise(dur), f = A.createBiquadFilter(), g = A.createGain();
    f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(out || sfx); n.start(t); n.stop(t + dur);
  }
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  // airy pads + bells (76 bpm): Am – F – C – G, two bars each
  var CHORDS = [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]];
  function schedule() {
    if (!A || !musicOn) return;
    var spb = 60 / 76;
    while (nextBeat < A.currentTime + 0.3) {
      var t = nextBeat, chord = CHORDS[Math.floor(beat / 8) % 4];
      if (beat % 8 === 0) chord.forEach(function (n) { tone('sine', midi(n), t, spb * 8.4, 0.045, music, null, 1.2); tone('triangle', midi(n) * 1.003, t, spb * 8.4, 0.02, music, null, 1.4); });
      if (Math.random() < 0.7) tone('sine', midi(chord[Math.floor(Math.random() * 3)] + 24), t + (Math.random() < 0.5 ? 0 : spb / 2), 1.4, 0.03, music);
      nextBeat += spb; beat++;
    }
  }

  window.GameAudio = {
    unlock: function () {
      if (!ac()) return;
      if (A.state === 'suspended') A.resume().catch(function () {});
      if (musicOn && !scheduler) { nextBeat = A.currentTime + 0.05; scheduler = setInterval(schedule, 120); }
    },
    pause: function (hidden) { if (!A) return; if (hidden) A.suspend().catch(function () {}); else A.resume().catch(function () {}); },
    setSound: function (on) { soundOn = on; if (sfx) sfx.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.05); },
    setMusic: function (on) {
      musicOn = on;
      if (!A) return;
      music.gain.setTargetAtTime(on ? 0.5 : 0, A.currentTime, 0.25);
      if (on && !scheduler) { nextBeat = A.currentTime + 0.05; scheduler = setInterval(schedule, 120); }
      if (!on && scheduler) { clearInterval(scheduler); scheduler = 0; }
    },
    click: function () { if (!ac() || !soundOn) return; tone('sine', 880, A.currentTime, 0.06, 0.05); },
    start: function () { // the bow's twang + a whoosh (as long as the release, ~0.45 s)
      if (!ac() || !soundOn) return;
      var t = A.currentTime;
      tone('sawtooth', 196, t, 0.45, 0.12, null, 150); tone('triangle', 392, t, 0.3, 0.06, null, 300);
      burst(t + 0.03, 0.4, 0.1, 'highpass', 2500);
    },
    loop: function (on, mult) { // the wind of the flight: brighter as it speeds up
      if (!A) return;
      if (!wind) {
        var n = noise(2, true), f = A.createBiquadFilter(), g = A.createGain();
        f.type = 'bandpass'; f.Q.value = 0.8; f.frequency.value = 500; g.gain.value = 0;
        n.connect(f); f.connect(g); g.connect(sfx); n.start();
        wind = { f: f, g: g };
      }
      var t = A.currentTime;
      wind.f.frequency.setTargetAtTime(450 + 260 * Math.log(Math.max(1, mult)), t, 0.2);
      wind.g.gain.setTargetAtTime(on && soundOn ? 0.06 : 0, t, 0.15);
    },
    win: function () { // a cascade of chimes (~0.8 s, as long as the star burst)
      if (!ac() || !soundOn) return;
      var t = A.currentTime;
      [76, 79, 83, 86, 88, 91].forEach(function (n, i) { tone('sine', midi(n), t + i * 0.07, 0.8, 0.07); });
      burst(t + 0.05, 0.6, 0.04, 'highpass', 8000);
    },
    bust: function () { // thud into the trunk + crack + sparks crackling (~0.9 s)
      if (!ac() || !soundOn) return;
      var t = A.currentTime;
      tone('sine', 120, t, 0.45, 0.6, null, 42); burst(t, 0.25, 0.4, 'lowpass', 320); burst(t, 0.06, 0.25, 'highpass', 3000);
      for (var i = 0; i < 8; i++) burst(t + 0.08 + Math.random() * 0.8, 0.03, 0.12, 'highpass', 4000 + Math.random() * 3000);
    },
  };
})();
