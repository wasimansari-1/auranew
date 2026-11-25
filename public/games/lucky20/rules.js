/* Lucky 20 — the draw and the pays (the SAME rules as the engine's tables/lucky20.go).
 *
 * Every round 20 different numbers of 1–80 are drawn, in order: a partial Fisher–Yates over 1..80
 * with the round's provably fair source (j = i + intn(80 − i) for i = 0..19, swap, keep a[0..19]);
 * balls[0] is the FIRST BALL. Deal steps: one "ball" step per number at 400 + i·450 ms (the last at
 * 8 950 ms), the deal is over at 9 300 ms — with the engine's 15 s betting window, 0.3 s start,
 * 0.4 s result delay and 5 s pause, one round is exactly 30 s.
 *
 * Spots (pay = RETURN multiplier of the stake, stake included; every bet 96.25–96.57 % RTP):
 *   over / under               sum of the 20 numbers ≥ 811 / ≤ 809 (810 exactly: both lose)  ×1.94
 *   odd / even                 11+ of the 20 numbers odd / even                                 ×2.42
 *   oddeven:draw               exactly 10 odd and 10 even                                       ×4.75
 *   top / bottom               11+ numbers in 1–40 / in 41–80                                   ×2.42
 *   topbottom:draw             exactly 10 in each half                                          ×4.75
 *   colour:purple|gold|teal|rose  that colour (1–20 | 21–40 | 41–60 | 61–80) ALONE has the most
 *                              numbers (a tie for the most: every colour bet loses)             ×4.95
 *   firstrange:1..8            the first ball is in that decade (1 = 1–10 … 8 = 71–80)          ×7.7
 *   first:1..80                the first ball is that number                                    ×77
 * Exact RTPs and the 1 000 000-round simulation: scratchpad draw10/lucky20/math.
 *
 * Plugs into the shared table client (NXTable.registerRules when the core has it).
 */
(function () {
  'use strict';
  var COLOURS = ['purple', 'gold', 'teal', 'rose'];
  var PAYS = { over: 1.94, under: 1.94, odd: 2.42, even: 2.42, 'oddeven:draw': 4.75, top: 2.42, bottom: 2.42, 'topbottom:draw': 4.75, colour: 4.95, firstrange: 7.7, first: 77 };
  var LINE = 810, FIRST_AT = 400, GAP_MS = 450, DEAL_MS = 9300;

  function deal(src) {
    var a = [];
    for (var n = 1; n <= 80; n++) a.push(n);
    var steps = [];
    for (var i = 0; i < 20; i++) {
      var j = i + src.intn(80 - i), t = a[i];
      a[i] = a[j]; a[j] = t;
      steps.push({ at: FIRST_AT + i * GAP_MS, kind: 'ball', value: a[i] });
    }
    var balls = a.slice(0, 20), total = 0;
    balls.forEach(function (v) { total += v; });
    return { outcome: { balls: balls, total: total }, steps: steps };
  }

  // stats of a (partial or full) draw: sum, odd count, numbers in 1–40, per-colour counts, the
  // colour with the most (−1 = a tie for the most / none yet)
  function stats(balls) {
    var s = { n: balls.length, sum: 0, odd: 0, top: 0, colours: [0, 0, 0, 0], leader: -1, first: balls[0] || 0 };
    balls.forEach(function (v) {
      s.sum += v;
      if (v % 2) s.odd++;
      if (v <= 40) s.top++;
      s.colours[Math.floor((v - 1) / 20)]++;
    });
    s.even = s.n - s.odd; s.bottom = s.n - s.top;
    var max = Math.max.apply(null, s.colours), k = s.colours.filter(function (c) { return c === max; }).length;
    s.leader = max > 0 && k === 1 ? s.colours.indexOf(max) : -1;
    return s;
  }

  function arg(spot, prefix) {
    if (spot.indexOf(prefix) !== 0) return null;
    var t = spot.slice(prefix.length);
    return /^[1-9][0-9]?$/.test(t) ? +t : null;
  }
  function validSpot(s) {
    if (PAYS[s] && s !== 'colour' && s !== 'firstrange' && s !== 'first') return true;
    if (s.indexOf('colour:') === 0) return COLOURS.indexOf(s.slice(7)) >= 0;
    var n = arg(s, 'firstrange:');
    if (n !== null) return n >= 1 && n <= 8;
    n = arg(s, 'first:');
    return n !== null && n >= 1 && n <= 80;
  }
  function pay(o, spot) {
    var b = o.balls || [], st = stats(b), t = o.total != null ? o.total : st.sum, n;
    switch (spot) {
      case 'over': return t > LINE ? PAYS.over : 0;
      case 'under': return t < LINE ? PAYS.under : 0;
      case 'odd': return st.odd >= 11 ? PAYS.odd : 0;
      case 'even': return st.even >= 11 ? PAYS.even : 0;
      case 'oddeven:draw': return st.odd === 10 ? PAYS['oddeven:draw'] : 0;
      case 'top': return st.top >= 11 ? PAYS.top : 0;
      case 'bottom': return st.bottom >= 11 ? PAYS.bottom : 0;
      case 'topbottom:draw': return st.top === 10 ? PAYS['topbottom:draw'] : 0;
    }
    if (spot.indexOf('colour:') === 0) return st.leader >= 0 && COLOURS[st.leader] === spot.slice(7) ? PAYS.colour : 0;
    if ((n = arg(spot, 'firstrange:')) !== null) return Math.floor((b[0] - 1) / 10) + 1 === n ? PAYS.firstrange : 0;
    if ((n = arg(spot, 'first:')) !== null) return b[0] === n ? PAYS.first : 0;
    return 0;
  }

  var rules = {
    deal: deal, validSpot: validSpot, pay: pay, dealMs: function () { return DEAL_MS; },
    stats: stats, COLOURS: COLOURS, PAYS: PAYS, LINE: LINE, FIRST_AT: FIRST_AT, GAP_MS: GAP_MS,
  };
  window.L20Rules = rules;
  var T = window.NXTable;
  if (T && typeof T.registerRules === 'function') T.registerRules('lucky20', rules);
  else if (T && T.rules && T.rules.shared) T.rules.shared.lucky20 = rules; // until the core has registerRules
})();
