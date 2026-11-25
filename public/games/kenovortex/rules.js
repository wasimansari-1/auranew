/* Keno Vortex (88.0094) — the game's rules for the shared table client (demo play + provably-fair
 * verify), the SAME as the engine's nexorng-engine/internal/tables/keno40.go: 10 different numbers
 * of 1–40 per round, a partial Fisher–Yates over 1..40 (j = i + intn(40 − i), i = 0..9), one "ball"
 * step every 0.85 s from 0.3 s. A ticket "k:3,8,14" (1–10 numbers, ascending) returns
 * KENO_PAYS[picks][hits] × the stake. Checked against internal/tables/testdata/draw-keno40.json.
 * Load after ../_core/table-client.js and before NXTable.start.
 */
(function () {
  'use strict';
  var PAYS = [
    [],
    [0, 3.85],
    [0, 1, 10],
    [0, 0, 3, 45],
    [0, 0, 2, 8, 95],
    [0, 0, 1, 4, 25, 330],
    [0, 0, 0, 3, 12, 110, 1500],
    [0, 0, 0, 1.5, 6, 45, 400, 4000],
    [0, 0, 0, 1, 3, 20, 160, 1200, 10000],
    [0, 0, 0, 0, 3, 12, 70, 500, 2500, 7500],
    [0, 0, 0, 0, 2.5, 6, 30, 200, 1000, 5000, 10000],
  ];
  function ticket(spot) {
    if (typeof spot !== 'string' || spot.slice(0, 2) !== 'k:') return null;
    var list = spot.slice(2);
    if (!list) return null;
    var parts = list.split(','), out = [];
    if (parts.length > 10) return null;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!/^[1-9][0-9]?$/.test(p)) return null;
      var n = Number(p);
      if (n < 1 || n > 40 || (out.length && n <= out[out.length - 1])) return null;
      out.push(n);
    }
    return out;
  }
  function hits(balls, t) {
    var h = 0;
    for (var i = 0; i < t.length; i++) if (balls.indexOf(t[i]) >= 0) h++;
    return h;
  }
  var rules = {
    deal: function (src) {
      var a = [], steps = [];
      for (var i = 0; i < 40; i++) a.push(i + 1);
      for (i = 0; i < 10; i++) {
        var j = i + src.intn(40 - i), x = a[i];
        a[i] = a[j]; a[j] = x;
        steps.push({ at: 300 + i * 850, kind: 'ball', value: a[i] });
      }
      return { outcome: { balls: a.slice(0, 10) }, steps: steps };
    },
    validSpot: function (s) { return ticket(s) !== null; },
    pay: function (o, spot) {
      var t = ticket(spot);
      if (!t || !o || !o.balls || o.balls.length !== 10) return 0;
      return PAYS[t.length][hits(o.balls, t)] || 0;
    },
    dealMs: function () { return 9300; },
  };
  NXTable.registerRules('keno40', rules);
  // shared with the game's scripts (board paytable, hit counting)
  window.KENO = { PAYS: PAYS, ticket: ticket, hits: hits };
})();
