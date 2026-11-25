/* Bingo Orbit — the round rules, identical to the engine's (nexorng-engine internal/tables/bingoorbit.go).
 *
 * A round draws 30 of the 75 balls: a partial Fisher–Yates over 1..75 driven by the round's
 * provably-fair stream (j = i + intn(75 − i)), one deal step every 500 ms. A bet spot is one card:
 * "c" + its 24 numbers as two digits, row by row, the free centre left out. B 1–15, I 16–30,
 * N 31–45, G 46–60, O 61–75, all different. Each card pays its HIGHEST pattern (return multiplier
 * of the card price): Four Lines ×1500 · Big X ×250 · Two Lines ×20 · Four Corners ×10 · Line ×3.
 * Lines: 5 rows, 5 columns, 2 diagonals (the free centre counts as daubed). RTP 96.32 % (exact).
 *
 *   BORules.evaluate(card25, drawnSet) → { hit, done, best, togo, want }
 *   BORules.spot(card25) / BORules.parse(spot) → card25 (0 = free centre) or null
 *   registered with the table client as the shared game "bingoorbit"
 */
(function () {
  'use strict';

  var PAY = { four: 1500, bigx: 250, two: 20, corners: 10, line: 3 };
  var ORDER = ['four', 'bigx', 'two', 'corners', 'line'];
  var NAMES = { four: 'Four Lines', bigx: 'Big X', two: 'Two Lines', corners: 'Four Corners', line: 'Line' };
  var SHORT = { four: '4 Lines', bigx: 'Big X', two: '2 Lines', corners: 'Corners', line: 'Line' };
  var BALLS = 30, STEP_MS = 500, FIRST_MS = 500;

  var LINES = [];
  (function () {
    var r, c;
    for (r = 0; r < 5; r++) LINES.push([0, 1, 2, 3, 4].map(function (k) { return r * 5 + k; }));
    for (c = 0; c < 5; c++) LINES.push([0, 1, 2, 3, 4].map(function (k) { return k * 5 + c; }));
    LINES.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  })();
  var CORNERS = [0, 4, 20, 24];

  // the highest pattern of a card (25 cells, centre 0) for a set of drawn numbers ({n: true})
  function evaluate(card, drawn) {
    var hit = card.map(function (n) { return n === 0 || !!drawn[n]; });
    var done = [], togo = 9, want = [];
    LINES.forEach(function (l, i) {
      var miss = l.filter(function (k) { return !hit[k]; });
      if (!miss.length) done.push(i);
      else if (miss.length < togo) { togo = miss.length; want = miss; }
    });
    var best = null;
    if (done.length >= 4) best = 'four';
    else if (done.indexOf(10) >= 0 && done.indexOf(11) >= 0) best = 'bigx';
    else if (done.length >= 2) best = 'two';
    else if (CORNERS.every(function (k) { return hit[k]; })) best = 'corners';
    else if (done.length === 1) best = 'line';
    return { hit: hit, done: done, best: best, togo: togo, want: want };
  }

  function colOk(n, cell) { var c = cell % 5; return n >= c * 15 + 1 && n <= c * 15 + 15; }

  function spot(card) {
    var s = 'c';
    for (var i = 0; i < 25; i++) if (i !== 12) s += (card[i] < 10 ? '0' : '') + card[i];
    return s;
  }
  function parse(s) {
    if (typeof s !== 'string' || !/^c\d{48}$/.test(s)) return null;
    var card = [], seen = {}, k = 1;
    for (var i = 0; i < 25; i++) {
      if (i === 12) { card.push(0); continue; }
      var n = +s.substr(k, 2); k += 2;
      if (!colOk(n, i) || seen[n]) return null;
      seen[n] = true; card.push(n);
    }
    return card;
  }

  function drawnOf(outcome) {
    var d = {};
    ((outcome && outcome.balls) || []).forEach(function (n) { d[n] = true; });
    return d;
  }

  var rules = {
    deal: function (src) {
      var pool = [], balls = [], steps = [];
      for (var n = 1; n <= 75; n++) pool.push(n);
      for (var i = 0; i < BALLS; i++) {
        var j = i + src.intn(75 - i), t = pool[i];
        pool[i] = pool[j]; pool[j] = t;
        balls.push(pool[i]);
        steps.push({ at: FIRST_MS + i * STEP_MS, kind: 'ball', value: pool[i] });
      }
      return { outcome: { balls: balls }, steps: steps };
    },
    validSpot: function (s) { return parse(s) !== null; },
    pay: function (o, s) {
      var card = parse(s);
      if (!card) return 0;
      var best = evaluate(card, drawnOf(o)).best;
      return best ? PAY[best] : 0;
    },
    dealMs: function () { return FIRST_MS + (BALLS - 1) * STEP_MS + 300; },
  };

  // a fresh card from crypto randomness (5 different numbers per column)
  function newCard() {
    var card = new Array(25), buf = new Uint32Array(1);
    for (var c = 0; c < 5; c++) {
      var pool = [];
      for (var n = 1; n <= 15; n++) pool.push(c * 15 + n);
      for (var r = 0; r < 5; r++) {
        crypto.getRandomValues(buf);
        var limit = Math.floor(4294967296 / pool.length) * pool.length;
        while (buf[0] >= limit) crypto.getRandomValues(buf);
        card[r * 5 + c] = pool.splice(buf[0] % pool.length, 1)[0];
      }
    }
    card[12] = 0;
    return card;
  }

  window.BORules = {
    rules: rules, evaluate: evaluate, spot: spot, parse: parse, drawnOf: drawnOf, newCard: newCard,
    PAY: PAY, ORDER: ORDER, NAMES: NAMES, SHORT: SHORT, LINES: LINES, CORNERS: CORNERS, BALLS: BALLS,
  };
  NXTable.registerRules('bingoorbit', rules); // the table client's plug-in (engine: tables/bingoorbit.go)
})();
