/* Trio Rollers (88.0096) — the game's rules for the shared table client (demo play + provably-fair
 * verify), the SAME as the engine's nexorng-engine/internal/tables/triorollers.go: three digits per
 * round, left → middle → right (three unbiased draws 0–9 from the round's stream), published 2.5 s,
 * 4.7 s and 7.0 s into the deal. Every bet returns 96 % (exact sums 95.95–96 %). Checked against the
 * engine's test vectors (internal/tables/testdata/draw-triorollers.json, check-table-client.mjs).
 * Load after ../_core/table-client.js and before NXTable.start.
 */
(function () {
  'use strict';
  var STEPS = [2500, 4700, 7000];
  var WAYS = [];
  for (var s = 0; s <= 27; s++) WAYS.push(0);
  for (var n = 0; n < 1000; n++) WAYS[Math.floor(n / 100) + Math.floor(n / 10) % 10 + n % 10]++;
  function sumPay(s) { return Math.floor(96000 / WAYS[s]) / 100; }
  function digits(v, n) { return new RegExp('^[0-9]{' + n + '}$').test(v) ? v.split('').map(Number) : null; }
  function valid(spot) {
    if (/^(small|big|odd|even|triple)$/.test(spot)) return true;
    var m = /^(straight|box|front|back|d1|d2|d3|sum):(.*)$/.exec(spot);
    if (!m) return false;
    var k = m[1], v = m[2];
    if (k === 'straight') return !!digits(v, 3);
    if (k === 'box') { var d = digits(v, 3); return !!d && !(d[0] === d[1] && d[1] === d[2]); }
    if (k === 'front' || k === 'back') return !!digits(v, 2);
    if (k === 'sum') return /^(0|[1-9][0-9]?)$/.test(v) && Number(v) <= 27;
    return !!digits(v, 1);
  }
  function pay(o, spot) {
    var D = o && o.digits;
    if (!D || D.length !== 3 || !valid(spot)) return 0;
    var a = D[0], b = D[1], c = D[2], sum = a + b + c;
    switch (spot) {
      case 'small': return sum <= 13 ? 1.92 : 0;
      case 'big': return sum >= 14 ? 1.92 : 0;
      case 'odd': return sum % 2 === 1 ? 1.92 : 0;
      case 'even': return sum % 2 === 0 ? 1.92 : 0;
      case 'triple': return a === b && b === c ? 96 : 0;
    }
    var k = spot.slice(0, spot.indexOf(':')), v = spot.slice(spot.indexOf(':') + 1), d;
    if (k === 'straight') { d = digits(v, 3); return d[0] === a && d[1] === b && d[2] === c ? 960 : 0; }
    if (k === 'box') {
      d = digits(v, 3);
      if (d.slice().sort().join('') !== [a, b, c].sort().join('')) return 0;
      return d[0] !== d[1] && d[1] !== d[2] && d[0] !== d[2] ? 160 : 320;
    }
    if (k === 'front') { d = digits(v, 2); return d[0] === a && d[1] === b ? 96 : 0; }
    if (k === 'back') { d = digits(v, 2); return d[0] === b && d[1] === c ? 96 : 0; }
    if (k === 'sum') return Number(v) === sum ? sumPay(sum) : 0;
    return D[Number(k[1]) - 1] === Number(v) ? 9.6 : 0; // d1 d2 d3
  }
  NXTable.registerRules('triorollers', {
    deal: function (src) {
      var d = [src.intn(10), src.intn(10), src.intn(10)];
      return { outcome: { digits: d, total: d[0] + d[1] + d[2] }, steps: d.map(function (v, i) { return { at: STEPS[i], kind: 'digit', value: v }; }) };
    },
    validSpot: valid,
    pay: pay,
    dealMs: function () { return 9300; },
  });
})();
