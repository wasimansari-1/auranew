/* Matka Pulse (88.0092) — the game's rules for the shared table client (demo play + provably-fair
 * verify), the SAME as the engine's nexorng-engine/internal/tables/matkapulse.go:
 *   six uniform digits per round (six intn(10) calls): OPEN d1 d2 d3, then CLOSE d1 d2 d3, published
 *   as "digit" steps at 1.0 / 2.2 / 3.4 s and 5.1 / 6.3 / 7.5 s of the deal (dealMs 9000).
 *   panna = a pot's three digits sorted in matka order (0 counts as 10: 7,1,0 → "170");
 *   single = the panna's digit sum mod 10; jodi = open single then close single.
 *   Spots (return multipliers): os:D / cs:D 9.6 · jodi:DD 96 · op:PPP / cp:PPP single panna 160,
 *   double panna 320, triple panna 960.
 * Checked against the engine's test vectors (internal/tables/testdata/draw-matkapulse.json).
 * Load after ../_core/table-client.js and before NXTable.start. Also exposed as window.MatkaRules.
 */
(function () {
  'use strict';
  var AT = [1000, 2200, 3400, 5100, 6300, 7500];
  function key(d) { return d === 0 ? 10 : d; }
  function panna(ds) { return ds.slice(0, 3).sort(function (a, b) { return key(a) - key(b); }).join(''); }
  function single(p) { return (+p[0] + +p[1] + +p[2]) % 10; }
  function kind(p) { return p[0] === p[1] && p[1] === p[2] ? 'TP' : (p[0] === p[1] || p[1] === p[2] || p[0] === p[2]) ? 'DP' : 'SP'; }
  var KIND_PAY = { SP: 160, DP: 320, TP: 960 };
  function validPanna(p) {
    if (!/^[0-9]{3}$/.test(p)) return false;
    return key(+p[0]) <= key(+p[1]) && key(+p[1]) <= key(+p[2]);
  }
  function validSpot(s) {
    if (/^(os|cs):[0-9]$/.test(s)) return true;
    if (/^jodi:[0-9]{2}$/.test(s)) return true;
    var m = /^(op|cp):([0-9]{3})$/.exec(s);
    return !!m && validPanna(m[2]);
  }
  // the round read from the outcome: { open, close, so, sc, jodi }
  function read(o) {
    if (!o || !o.digits || o.digits.length !== 6) return null;
    var op = panna(o.digits.slice(0, 3)), cp = panna(o.digits.slice(3));
    var so = single(op), sc = single(cp);
    return { open: op, close: cp, so: so, sc: sc, jodi: '' + so + sc };
  }
  function pay(o, spot) {
    var r = read(o);
    if (!r || !validSpot(spot)) return 0;
    var k = spot.slice(0, 2), v = spot.slice(spot.indexOf(':') + 1);
    if (k === 'os') return +v === r.so ? 9.6 : 0;
    if (k === 'cs') return +v === r.sc ? 9.6 : 0;
    if (k === 'jo') return v === r.jodi ? 96 : 0;
    if (k === 'op') return v === r.open ? KIND_PAY[kind(v)] : 0;
    if (k === 'cp') return v === r.close ? KIND_PAY[kind(v)] : 0;
    return 0;
  }
  var R = {
    deal: function (src) {
      var d = [], steps = [];
      for (var i = 0; i < 6; i++) {
        d.push(src.intn(10));
        steps.push({ at: AT[i], kind: 'digit', to: i < 3 ? 'open' : 'close', value: d[i] });
      }
      return { outcome: { digits: d }, steps: steps };
    },
    validSpot: validSpot,
    pay: pay,
    dealMs: function () { return 9000; },
  };
  if (typeof window !== 'undefined') window.MatkaRules = { panna: panna, single: single, kind: kind, kindPay: KIND_PAY, validPanna: validPanna, read: read, key: key };
  NXTable.registerRules('matkapulse', R);
})();
