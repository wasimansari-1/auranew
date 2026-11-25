/* Andar Bahar — the bazaar behind the table, drawn on a canvas: a night sky, a lit colonnade of
 * market stalls, marigold garlands along the top, swaying lanterns, string lights and drifting
 * glow. The still parts are drawn once per size on one canvas; the lights move on a second one.
 *
 *   var bg = ABScene.create(baseCanvas, lightsCanvas);
 *   bg.resize({ w, h, dpr, horizon, k })  // stage size, felt edge y (px), table scale
 *   bg.draw(now) · ABScene.TOP_COLOUR
 */
(function () {
  'use strict';

  var TOP_COLOUR = '#24082f';
  var STALLS = ['#e2483d', '#ff9a1f', '#f0479a', '#1fa38a', '#ffd23f', '#7b4bd6'];

  function create(base, canvas) {
    var ctx = canvas.getContext('2d'), bctx = base.getContext('2d');
    var G = { w: 0, h: 0, dpr: 1, horizon: 0, k: 1 };
    var lanterns = [], bulbs = [], motes = [], glow = {};

    function sprite(rgb, r) { // a soft round glow, drawn once and stamped many times
      var key = rgb + r, c = glow[key];
      if (c) return c;
      c = glow[key] = document.createElement('canvas');
      c.width = c.height = Math.ceil(r * 2 * G.dpr);
      var g = c.getContext('2d'), m = c.width / 2;
      var gr = g.createRadialGradient(m, m, 0, m, m, m);
      gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.25, 'rgba(' + rgb + ',0.9)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.width);
      return c;
    }

    function rnd(a, b) { return a + Math.random() * (b - a); }

    function resize(g) {
      if (g.w === G.w && g.h === G.h && g.dpr === G.dpr && Math.abs(g.horizon - G.horizon) < 0.5 && Math.abs(g.k - G.k) < 1e-4) return;
      G = g;
      glow = {};
      base.width = canvas.width = Math.round(g.w * g.dpr);
      base.height = Math.round(g.h * g.dpr);
      // the lights all hang above the table: their canvas covers only that band (cheaper to update)
      var band = Math.max(1, Math.ceil(g.horizon));
      canvas.height = Math.round(band * g.dpr);
      canvas.style.height = band + 'px';
      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      bctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      var k = g.k, W = g.w;
      // lanterns hang from the top at a few places (fewer on phones)
      lanterns = [];
      var n = Math.max(3, Math.round(W / (240 * Math.max(0.6, k))));
      for (var i = 0; i < n; i++) {
        lanterns.push({
          x: (i + 0.5) / n * W + rnd(-20, 20) * k, len: g.horizon * rnd(0.18, 0.42), s: rnd(0.8, 1.15) * Math.max(0.55, k),
          c: STALLS[(i * 2 + 1) % STALLS.length], ph: rnd(0, 6), sp: rnd(2600, 3800),
        });
      }
      // string lights: two sagging wires across the scene
      bulbs = [];
      [[0.2, 0.12], [0.36, 0.1]].forEach(function (w, j) {
        var y0 = g.horizon * w[0], sag = g.horizon * w[1], step = Math.max(18, 30 * k);
        for (var x = -step / 2 + j * step / 2; x < W + step; x += step) {
          var u = x / W;
          bulbs.push({ x: x, y: y0 + sag * 4 * u * (1 - u) + Math.sin(u * 9 + j) * 4 * k, c: ['255,233,168', '255,179,92', '255,122,168', '157,240,216'][Math.floor(Math.random() * 4)], ph: rnd(0, 6), wire: j });
        }
      });
      motes = [];
      for (var m = 0; m < 22; m++) motes.push({ x: Math.random(), y: Math.random(), r: rnd(3, 11) * Math.max(0.6, k), v: rnd(0.004, 0.012), ph: rnd(0, 6), c: Math.random() < 0.5 ? '255,190,110' : '255,120,170' });
      drawBase();
      draw(performance.now()); // a resize clears the canvas: paint it again at once (no blank frame)
    }

    function drawBase() {
      var c = bctx, W = G.w, H = G.h, hz = G.horizon, k = Math.max(0.5, G.k);
      // night sky over the market
      var sky = c.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, TOP_COLOUR);
      sky.addColorStop(0.5, '#4a0f3e');
      sky.addColorStop(1, '#8c3328');
      c.fillStyle = sky;
      c.fillRect(0, 0, W, hz + 2);
      // a few stars
      c.fillStyle = 'rgba(255, 240, 220, 0.7)';
      for (var s = 0; s < 40; s++) { c.globalAlpha = Math.random() * 0.6 + 0.2; c.fillRect(Math.random() * W, Math.random() * hz * 0.35, 1.4, 1.4); }
      c.globalAlpha = 1;
      // skyline of domes and little towers
      var top = hz - 250 * k;
      c.fillStyle = '#300a2e';
      for (var x = -40; x < W + 80; x += 150 * k) {
        var dw = 46 * k, dx = x + 60 * k;
        c.beginPath();
        c.moveTo(dx - dw, top + 20 * k);
        c.quadraticCurveTo(dx - dw, top - 34 * k, dx, top - 52 * k);
        c.quadraticCurveTo(dx + dw, top - 34 * k, dx + dw, top + 20 * k);
        c.fill();
        c.fillRect(dx - 1.5 * k, top - 66 * k, 3 * k, 16 * k);
        c.fillRect(x + 118 * k, top - 40 * k, 12 * k, 70 * k);
        c.beginPath(); c.arc(x + 124 * k, top - 40 * k, 9 * k, Math.PI, 0); c.fill();
      }
      // the colonnade: a wall of stall arches glowing from inside
      var wallTop = hz - 210 * k;
      var wall = c.createLinearGradient(0, wallTop, 0, hz);
      wall.addColorStop(0, '#4b1236'); wall.addColorStop(1, '#2a0820');
      c.fillStyle = wall;
      c.fillRect(0, wallTop, W, hz - wallTop + 2);
      c.fillStyle = '#f3c35b';
      c.globalAlpha = 0.5;
      c.fillRect(0, wallTop, W, 3 * k);
      c.globalAlpha = 1;
      var aw = 118 * k, gap = 26 * k, ah = 160 * k;
      for (var i = 0, ax = -aw / 2; ax < W + aw; ax += aw + gap, i++) {
        var l = ax, r = ax + aw, b = hz, t = hz - ah, mid = ax + aw / 2;
        c.beginPath();
        c.moveTo(l, b); c.lineTo(l, t + aw * 0.42);
        c.quadraticCurveTo(l, t + 6 * k, mid, t - 14 * k);
        c.quadraticCurveTo(r, t + 6 * k, r, t + aw * 0.42);
        c.lineTo(r, b); c.closePath();
        var glow = c.createLinearGradient(0, t, 0, b);
        glow.addColorStop(0, '#ffcf7a'); glow.addColorStop(0.55, '#e8783a'); glow.addColorStop(1, '#8a2a24');
        c.fillStyle = glow;
        c.fill();
        c.strokeStyle = 'rgba(243, 195, 91, 0.55)';
        c.lineWidth = 2 * k;
        c.stroke();
        // goods inside: stacked fabric bolts and a striped awning
        c.save(); c.clip();
        for (var row = 0; row < 3; row++) for (var col = 0; col < 4; col++) {
          c.fillStyle = STALLS[(i + row * 3 + col) % STALLS.length];
          c.globalAlpha = 0.55;
          c.fillRect(l + 8 * k + col * (aw - 16 * k) / 4, b - 30 * k - row * 22 * k, (aw - 16 * k) / 4 - 4 * k, 18 * k);
        }
        c.globalAlpha = 0.9;
        var stripes = 6;
        for (var st = 0; st < stripes; st++) {
          c.fillStyle = st % 2 ? '#fff1d6' : STALLS[(i + 2) % STALLS.length];
          c.fillRect(l + st * aw / stripes, t + aw * 0.36, aw / stripes + 0.5, 20 * k);
        }
        c.fillStyle = 'rgba(40, 8, 28, 0.35)';
        for (var sc = 0; sc < stripes; sc++) { c.beginPath(); c.arc(l + (sc + 0.5) * aw / stripes, t + aw * 0.36 + 20 * k, aw / stripes / 2, 0, Math.PI); c.fill(); }
        c.restore();
        c.globalAlpha = 1;
      }
      // the floor below the table (only seen past its ends / under the results on wide screens)
      var floor = c.createLinearGradient(0, hz, 0, H);
      floor.addColorStop(0, '#3a0d26'); floor.addColorStop(1, '#1d0720');
      c.fillStyle = floor;
      c.fillRect(0, hz, W, H - hz);
      // marigold garlands (toran) along the top edge
      var sw = 120 * k, drop = 26 * k;
      for (var gx = -sw / 2; gx < W + sw; gx += sw) {
        for (var f = 0; f <= 14; f++) {
          var u = f / 14, fx = gx + u * sw, fy = 4 * k + drop * 4 * u * (1 - u);
          c.fillStyle = f % 3 === 1 ? '#ffd23f' : '#ff8c1a';
          c.beginPath(); c.arc(fx, fy, 5.2 * k, 0, Math.PI * 2); c.fill();
          c.fillStyle = 'rgba(160, 60, 0, 0.35)';
          c.beginPath(); c.arc(fx + 1.2 * k, fy + 1.2 * k, 2 * k, 0, Math.PI * 2); c.fill();
        }
        for (var hs = 0; hs < 3; hs++) { // hanging strands with a mango leaf
          var sx = gx + (hs === 1 ? sw : hs === 0 ? 0 : sw / 2), len = hs === 2 ? 30 * k : 52 * k, y0 = hs === 2 ? 4 * k + drop : 4 * k;
          for (var q = 0; q < 5; q++) { c.fillStyle = q % 2 ? '#ffd23f' : '#ff8c1a'; c.beginPath(); c.arc(sx, y0 + q * len / 5, 4.4 * k, 0, Math.PI * 2); c.fill(); }
          c.fillStyle = '#2f8f3a';
          c.beginPath(); c.moveTo(sx - 5 * k, y0 + len); c.quadraticCurveTo(sx, y0 + len + 18 * k, sx, y0 + len + 18 * k); c.quadraticCurveTo(sx, y0 + len + 18 * k, sx + 5 * k, y0 + len); c.closePath(); c.fill();
        }
      }
    }

    function draw(now) {
      var c = ctx, k = Math.max(0.5, G.k);
      c.clearRect(0, 0, G.w, G.horizon + 1);
      // drifting glow
      motes.forEach(function (m) {
        var y = ((m.y - now / 1000 * m.v) % 1 + 1) % 1;
        var x = m.x * G.w + Math.sin(now / 2000 + m.ph) * 14;
        c.globalAlpha = 0.14 + 0.1 * Math.sin(now / 900 + m.ph);
        c.drawImage(sprite(m.c, 12), x - m.r, y * G.horizon - m.r, m.r * 2, m.r * 2);
      });
      c.globalAlpha = 1;
      // string lights
      c.strokeStyle = 'rgba(20, 4, 16, 0.8)';
      c.lineWidth = 1.2;
      [0, 1].forEach(function (w) {
        c.beginPath();
        var first = true;
        bulbs.forEach(function (b) { if (b.wire !== w) return; if (first) { c.moveTo(b.x, b.y - 3); first = false; } else c.lineTo(b.x, b.y - 3); });
        c.stroke();
      });
      bulbs.forEach(function (b) {
        var tw = 0.65 + 0.35 * Math.sin(now / 420 + b.ph * 3);
        var r = 9 * k;
        c.globalAlpha = tw;
        c.drawImage(sprite(b.c, 9), b.x - r, b.y - r, r * 2, r * 2);
      });
      c.globalAlpha = 1;
      // lanterns, swaying on their strings
      lanterns.forEach(function (l) {
        var a = Math.sin(now / l.sp * Math.PI * 2 + l.ph) * 0.06;
        var px = l.x + Math.sin(a) * l.len, py = Math.cos(a) * l.len, s = l.s * 1.0;
        c.strokeStyle = 'rgba(30, 6, 20, 0.9)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(l.x, 0); c.lineTo(px, py); c.stroke();
        c.globalAlpha = 0.35;
        c.drawImage(sprite('255,190,100', 36), px - 70 * s, py - 40 * s, 140 * s, 140 * s);
        c.globalAlpha = 1;
        c.save();
        c.translate(px, py); c.rotate(-a); c.scale(s, s);
        c.fillStyle = '#c99a3a';
        c.beginPath(); c.moveTo(-9, 0); c.lineTo(9, 0); c.lineTo(13, 10); c.lineTo(-13, 10); c.closePath(); c.fill();
        if (!l.body) { // the glass, lit from inside (made once: it lives in the lantern's own units)
          l.body = c.createLinearGradient(-16, 0, 16, 0);
          l.body.addColorStop(0, l.c); l.body.addColorStop(0.5, '#fff1c8'); l.body.addColorStop(1, l.c);
        }
        c.fillStyle = l.body;
        c.beginPath(); c.moveTo(-13, 10); c.quadraticCurveTo(-22, 30, -12, 50); c.lineTo(12, 50); c.quadraticCurveTo(22, 30, 13, 10); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(120, 70, 10, 0.8)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(0, 10); c.lineTo(0, 50); c.moveTo(-7, 11); c.quadraticCurveTo(-11, 30, -6, 50); c.moveTo(7, 11); c.quadraticCurveTo(11, 30, 6, 50); c.stroke();
        c.fillStyle = '#c99a3a';
        c.beginPath(); c.moveTo(-12, 50); c.lineTo(12, 50); c.lineTo(5, 58); c.lineTo(-5, 58); c.closePath(); c.fill();
        c.fillStyle = l.c;
        c.beginPath(); c.arc(0, 64, 3, 0, Math.PI * 2); c.fill();
        c.restore();
      });
    }

    return { resize: resize, draw: draw };
  }

  window.ABScene = { create: create, TOP_COLOUR: TOP_COLOUR };
})();
