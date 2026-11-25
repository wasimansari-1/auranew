/* Spiral Derby — the marble track and the race playback (no three.js here).
 *
 * The engine (nexorng-engine/internal/tables/ballrace.go) draws the finishing order and computes the
 * whole race once; its "race" step carries keyframes (Step.Data): for each place, the ball number
 * and its position along the track (s) and across it (y) every 1/20 s. Every viewer plays those
 * same keyframes, so every device shows the identical race. Here: the SAME track centreline as the
 * engine (control points → Catmull-Rom → 2 cm arc-length table, frames and curvature), the
 * keyframe decoder, and a C1 Catmull-Rom interpolation between keyframes (smooth at any frame rate).
 *
 *   SDRace.track()                → { L, finish, rackEnd, sample(s), world(s, y), ... }
 *   SDRace.decode(base64)         → race { balls: [n…] (finish order), at(t) → [{ ball, s, y, v }] } | null
 *   SDRace.slotS(place), SDRace.gatePos(ball) → { s, y }
 *   SDRace.R / HALF / GATE_AT / WIN_AT / SLOT
 */
(function (root) {
  'use strict';
  var R = 0.1, HALF = 0.58, GATE_AT = 0.4, WIN_AT = 10.4, SLOT = 0.24;

  function controlPoints() {
    var p = [];
    function line(x0, z0, x1, z1, y0, y1) {
      var n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25));
      for (var i = 0; i < n; i++) { var u = i / n; p.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * u]); }
    }
    function arc(cx, cz, r, a0, a1, y0, y1) {
      var n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r / 0.22));
      for (var i = 0; i < n; i++) { var u = i / n, a = a0 + (a1 - a0) * u; p.push([cx + r * Math.cos(a), y0 + (y1 - y0) * u, cz + r * Math.sin(a)]); }
    }
    var d = Math.PI / 180;
    line(-3.2, -2.4, 2.4, -2.4, 6.7, 5.45);           // start ramp (gate top-left)
    arc(2.4, -1.5, 0.9, -90 * d, 90 * d, 5.45, 5.3);   // bumper U-turn
    line(2.4, -0.6, -1.4, -0.6, 5.3, 4.6);             // second ramp
    arc(-1.4, 0.4, 1.0, -90 * d, -630 * d, 4.6, 2.65); // spiral, 1.5 turns around the tower
    line(-1.4, 1.4, 1.6, 1.4, 2.65, 2.32);             // run-out
    arc(1.6, 2.2, 0.8, -90 * d, 90 * d, 2.32, 2.2);    // bumper turn to the front
    line(1.6, 3.0, -2.6, 3.0, 2.2, 2.08);              // home straight + finish rack
    p.push([-2.6, 2.08, 3.0]);
    return p;
  }

  var TRACK = null;
  function track() {
    if (TRACK) return TRACK;
    var cp = controlPoints(), pts = [], i, k, c;
    for (i = 0; i < cp.length - 1; i++) {
      var p0 = cp[Math.max(0, i - 1)], p1 = cp[i], p2 = cp[i + 1], p3 = cp[Math.min(cp.length - 1, i + 2)];
      for (k = 0; k < 6; k++) {
        var t = k / 6, t2 = t * t, t3 = t2 * t, q = [];
        for (c = 0; c < 3; c++) q.push(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
        pts.push(q);
      }
    }
    pts.push(cp[cp.length - 1]);
    var s = [0];
    for (i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    var L = s[s.length - 1], STEP = 0.02, n = Math.ceil(L / STEP) + 1, P = [], j = 0;
    for (i = 0; i < n; i++) {
      var si = Math.min(L, i * STEP);
      while (j < s.length - 2 && s[j + 1] < si) j++;
      var u = (si - s[j]) / (s[j + 1] - s[j] || 1), a = pts[j], b = pts[j + 1];
      P.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
    }
    var T = [], S = [], U = [], K = [];
    for (i = 0; i < n; i++) {
      var a2 = P[Math.max(0, i - 2)], b2 = P[Math.min(n - 1, i + 2)];
      var tx = b2[0] - a2[0], ty = b2[1] - a2[1], tz = b2[2] - a2[2], tl = Math.hypot(tx, ty, tz);
      tx /= tl; ty /= tl; tz /= tl;
      var sx = -tz, sz = tx, sl = Math.hypot(sx, sz); sx /= sl; sz /= sl;
      T.push([tx, ty, tz]); S.push([sx, 0, sz]); U.push([-sz * ty, sz * tx - sx * tz, sx * ty]);
    }
    for (i = 0; i < n; i++) {
      var ia = Math.max(0, i - 5), ib = Math.min(n - 1, i + 5), ta = T[ia], tb = T[ib];
      var dh = Math.atan2(tb[2], tb[0]) - Math.atan2(ta[2], ta[0]);
      while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      K.push(dh / (ib - ia) / STEP);
    }
    function lerp3(A, i, u) { var a = A[i], b = A[i + 1]; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
    function sample(sv) {
      var f = Math.max(0, Math.min(n - 1.001, sv / STEP)), i = Math.floor(f), u = f - i;
      return { p: lerp3(P, i, u), t: lerp3(T, i, u), side: lerp3(S, i, u), up: lerp3(U, i, u), k: K[i] * (1 - u) + K[i + 1] * u };
    }
    function lift(y) { var a = Math.abs(y); return a > 0.3 ? (a - 0.3) * (a - 0.3) * 2 : 0; }
    function world(sv, y) {
      var a = sample(sv), h = R + lift(y);
      return { p: [a.p[0] + a.side[0] * y + a.up[0] * h, a.p[1] + a.side[1] * y + a.up[1] * h, a.p[2] + a.side[2] * y + a.up[2] * h], side: a.side, t: a.t, up: a.up, k: a.k };
    }
    TRACK = { L: L, STEP: STEP, n: n, finish: L - 2.4, rackEnd: L - 0.04, gateS: 0.62, sample: sample, world: world, lift: lift };
    return TRACK;
  }

  // the rack slot (s) of a place (0 = winner)
  function slotS(place) { var t = track(); return t.rackEnd - R - place * SLOT; }
  // the start grid: ball n waits in row (n−1)/4, lane (n−1)%4 behind the gate (as the engine starts it)
  function gatePos(n) { return { s: 0.62 - 0.3 * ((n - 1) >> 2), y: (((n - 1) & 3) - 1.5) * 0.25 }; }

  function decode(b64) {
    var bin;
    try { bin = atob(b64); } catch (e) { return null; }
    if (bin.length < 5 || bin.charCodeAt(0) !== 1) return null;
    var hz = bin.charCodeAt(1), nb = bin.charCodeAt(2), ns = bin.charCodeAt(3) | (bin.charCodeAt(4) << 8);
    if (bin.length !== 5 + nb * (1 + ns * 4)) return null;
    function i16(o) { var v = bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8); return (v >= 32768 ? v - 65536 : v) / 1000; }
    var balls = [], S = [], Y = [], off = 5;
    for (var p = 0; p < nb; p++) {
      balls.push(bin.charCodeAt(off)); off++;
      var s = new Float32Array(ns), y = new Float32Array(ns);
      for (var i = 0; i < ns; i++) { s[i] = i16(off); y[i] = i16(off + 2); off += 4; }
      S.push(s); Y.push(y);
    }
    var dur = (ns - 1) / hz;
    // when each place crosses the line (ms of race time)
    var fin = track().finish, cross = [];
    for (var q = 0; q < nb; q++) {
      var c = dur * 1000;
      for (var k = 1; k < ns; k++) if (S[q][k] >= fin) { var a0 = S[q][k - 1], a1 = S[q][k]; c = ((k - 1) + (fin - a0) / Math.max(1e-6, a1 - a0)) / hz * 1000; break; }
      cross.push(c);
    }
    // Catmull-Rom (uniform) between keyframes: C1, passes through every keyframe
    function cr(A, f) {
      var i = Math.floor(f), u = f - i, a = A[Math.max(0, i - 1)], b = A[i], c = A[Math.min(ns - 1, i + 1)], d = A[Math.min(ns - 1, i + 2)];
      return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    }
    function crd(A, f) {
      var i = Math.floor(f), u = f - i, a = A[Math.max(0, i - 1)], b = A[i], c = A[Math.min(ns - 1, i + 1)], d = A[Math.min(ns - 1, i + 2)];
      return 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * u + 3 * (-a + 3 * b - 3 * c + d) * u * u) * hz;
    }
    return {
      balls: balls, hz: hz, duration: dur, cross: cross,
      at: function (t) { // race time t (s since the race step)
        var f = Math.max(0, Math.min(ns - 1.0001, t * hz)), out = [];
        for (var p = 0; p < nb; p++) {
          var sv = cr(S[p], f), last = S[p][ns - 1];
          if (sv > last) sv = last;
          out.push({ ball: balls[p], place: p, s: sv, y: cr(Y[p], f), v: t >= dur ? 0 : Math.max(0, crd(S[p], f)) });
        }
        return out;
      },
    };
  }

  root.SDRace = { R: R, HALF: HALF, GATE_AT: GATE_AT, WIN_AT: WIN_AT, SLOT: SLOT, track: track, slotS: slotS, gatePos: gatePos, decode: decode };
})(typeof window !== 'undefined' ? window : this);
