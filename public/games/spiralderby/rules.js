/* Spiral Derby (88.0095, engine rules "ballrace") — the game's rules for the shared table client
 * (demo play + provably-fair verify), the SAME as nexorng-engine/internal/tables/ballrace.go:
 *   the finishing order of the 8 marbles is a Fisher–Yates permutation of 1..8 (intn(i+1) for
 *   i = 7..1), then ONE more draw intn(2^30) seeds the race animation (drawn and only used for the
 *   finish-time steps here; the race keyframes themselves come from the engine in the "race" step).
 *   Steps: {at 0, kind 'race'} then one {kind 'ball', value} per finisher at its crossing time.
 * Spots (return multipliers): win:N ×7.70 · top2:A-B (A<B) ×27 · exacta:A-B ×54 · top3:A-B-C
 * (A<B<C) ×54 · odd / even (the winner) ×1.93 · colour:fire|citrus|ocean|royal ×3.86.
 * Checked against the engine's vectors (internal/tables/testdata/draw-ballrace.json).
 * Load after ../_core/table-client.js and before NXTable.start.
 */
(function () {
  'use strict';
  var COLOURS = { fire: [1, 2], citrus: [3, 4], ocean: [5, 6], royal: [7, 8] };
  var PAYS = { win: 7.7, top2: 27, exacta: 54, top3: 54, odd: 1.93, even: 1.93, colour: 3.86 };
  var WIN_AT = 10.4;

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function finishTimes(seed) {
    var rnd = mulberry32(seed ^ 0x9E3779B9), T = [WIN_AT];
    for (var p = 1; p < 8; p++) T.push(T[p - 1] + 0.12 + rnd() * (0.12 + p * 0.02));
    return T;
  }
  // spot → { kind, n: [balls] } or null
  function parse(spot) {
    if (spot === 'odd' || spot === 'even') return { kind: spot, n: [] };
    var m = /^(win|top2|exacta|top3|colour):(.+)$/.exec(spot);
    if (!m) return null;
    if (m[1] === 'colour') return COLOURS.hasOwnProperty(m[2]) ? { kind: 'colour', n: COLOURS[m[2]].slice(), group: m[2] } : null;
    var want = { win: 1, top2: 2, exacta: 2, top3: 3 }[m[1]], parts = m[2].split('-');
    if (parts.length !== want) return null;
    var n = [];
    for (var i = 0; i < parts.length; i++) { if (!/^[1-8]$/.test(parts[i])) return null; n.push(+parts[i]); }
    if (m[1] === 'top2' && !(n[0] < n[1])) return null;
    if (m[1] === 'top3' && !(n[0] < n[1] && n[1] < n[2])) return null;
    if (m[1] === 'exacta' && n[0] === n[1]) return null;
    return { kind: m[1], n: n };
  }
  function pay(o, spot) {
    var b = o && o.balls, s = parse(spot);
    if (!b || b.length !== 8 || !s) return 0;
    var w = b[0], first = function (k) { return b.slice(0, k); };
    var all = function (k) { var f = first(k); return s.n.every(function (x) { return f.indexOf(x) >= 0; }); };
    switch (s.kind) {
      case 'win': return w === s.n[0] ? 7.7 : 0;
      case 'top2': return all(2) ? 27 : 0;
      case 'exacta': return b[0] === s.n[0] && b[1] === s.n[1] ? 54 : 0;
      case 'top3': return all(3) ? 54 : 0;
      case 'odd': return w % 2 === 1 ? 1.93 : 0;
      case 'even': return w % 2 === 0 ? 1.93 : 0;
      case 'colour': return s.n.indexOf(w) >= 0 ? 3.86 : 0;
    }
    return 0;
  }
  NXTable.registerRules('ballrace', {
    deal: function (src) {
      var o = [1, 2, 3, 4, 5, 6, 7, 8];
      for (var i = 7; i >= 1; i--) { var j = src.intn(i + 1), t = o[i]; o[i] = o[j]; o[j] = t; }
      var fin = finishTimes(src.intn(1073741824)); // the 8th draw: the race-animation seed
      var steps = [{ at: 0, kind: 'race' }];
      o.forEach(function (b, p) { steps.push({ at: Math.round(fin[p] * 1000), kind: 'ball', value: b }); });
      return { outcome: { balls: o }, steps: steps };
    },
    validSpot: function (s) { return !!parse(s); },
    pay: pay,
    dealMs: function () { return 13500; },
  });
  if (typeof window !== 'undefined') window.SDRules = { parse: parse, pay: pay, PAYS: PAYS, COLOURS: COLOURS };
})();
