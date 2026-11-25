/* Trio Towers — the table rules (same as nexorng-engine/internal/tables/triotowers.go; checked
 * against its test vectors testdata/draw-triotowers.json by TestTableClientJS).
 *
 * Every round three balls are drawn, one from each glass tower (ten balls 0–9 in each), so the
 * three digits are independent and uniform: 1,000 equally likely draws. Pays are RETURN
 * multipliers of the stake (stake included). Every spot returns 95.63–96.03 % (RTP 96 %).
 *
 * Spots (77): big small odd even · bigodd bigeven smallodd smalleven · anytriple · sum:N (0–27) ·
 * ball:B:D (ball B = 1–3 shows digit D = 0–9) · triple:D (D D D).
 * Outcome: { balls: [d1, d2, d3], total }. Deal steps: { at, kind: 'ball', to: '1'|'2'|'3', value }.
 */
(function () {
  'use strict';
  var WAYS = [], SUM_PAY = [], s, a, b;
  for (s = 0; s <= 27; s++) WAYS[s] = 0;
  for (a = 0; a < 10; a++) for (b = 0; b < 10; b++) for (s = 0; s < 10; s++) WAYS[a + b + s]++;
  for (s = 0; s <= 27; s++) SUM_PAY[s] = Math.floor(960 / WAYS[s] * 10 + 1e-9) / 10; // ×960 … ×12.8
  var FIXED = { big: 1.92, small: 1.92, odd: 1.92, even: 1.92, bigodd: 4.15, smalleven: 4.15, bigeven: 3.57, smallodd: 3.57, anytriple: 96 };
  var BALL_PAY = 9.6, TRIPLE_PAY = 960, BIG_FROM = 14;
  var STEP_AT = [1200, 3200, 5200], DEAL_MS = 6600;

  function num(str, lo, hi) { return /^(0|[1-9]\d*)$/.test(str) && +str >= lo && +str <= hi; }
  function validSpot(spot) {
    if (Object.prototype.hasOwnProperty.call(FIXED, spot)) return true;
    var p = String(spot).split(':');
    if (p.length === 2 && p[0] === 'sum') return num(p[1], 0, 27);
    if (p.length === 2 && p[0] === 'triple') return num(p[1], 0, 9);
    if (p.length === 3 && p[0] === 'ball') return num(p[1], 1, 3) && num(p[2], 0, 9);
    return false;
  }
  function wins(o, spot) {
    var d = o.balls, t = o.total, big = t >= BIG_FROM, odd = t % 2 === 1, triple = d[0] === d[1] && d[1] === d[2];
    switch (spot) {
      case 'big': return big; case 'small': return !big; case 'odd': return odd; case 'even': return !odd;
      case 'bigodd': return big && odd; case 'bigeven': return big && !odd;
      case 'smallodd': return !big && odd; case 'smalleven': return !big && !odd;
      case 'anytriple': return triple;
    }
    var p = String(spot).split(':');
    if (p[0] === 'sum') return +p[1] === t;
    if (p[0] === 'ball') return d[+p[1] - 1] === +p[2];
    if (p[0] === 'triple') return triple && d[0] === +p[1];
    return false;
  }
  function payOf(spot) {
    if (FIXED[spot]) return FIXED[spot];
    var p = String(spot).split(':');
    if (p[0] === 'sum') return SUM_PAY[+p[1]];
    if (p[0] === 'ball') return BALL_PAY;
    if (p[0] === 'triple') return TRIPLE_PAY;
    return 0;
  }
  var R = {
    deal: function (src) {
      var d = [src.intn(10), src.intn(10), src.intn(10)];
      return {
        outcome: { balls: d, total: d[0] + d[1] + d[2] },
        steps: d.map(function (v, i) { return { at: STEP_AT[i], kind: 'ball', to: String(i + 1), value: v }; }),
      };
    },
    validSpot: validSpot,
    pay: function (o, spot) { return o && o.balls && validSpot(spot) && wins(o, spot) ? payOf(spot) : 0; },
    dealMs: function () { return DEAL_MS; },
    // for the board and the rules page
    payOf: payOf, wins: wins, WAYS: WAYS, SUM_PAY: SUM_PAY, FIXED: FIXED, BALL_PAY: BALL_PAY, TRIPLE_PAY: TRIPLE_PAY, BIG_FROM: BIG_FROM,
  };
  window.TrioRules = R;
  NXTable.registerRules('triotowers', R);
})();
