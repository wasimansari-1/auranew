/* Orbit 36 (88.0099) — the game's rules for the shared table client (demo play + provably-fair
 * verify), the SAME as the engine's nexorng-engine/internal/tables/orbit36.go: 6 different balls of
 * 1–36 and a 7th, the bonus ball — a partial Fisher–Yates (j = i + intn(36 − i), i = 0..6), one
 * "ball" step per ball (0.8, 2.0 … 6.8 s; the bonus at 8.2 s, to: 'bonus'). Spots:
 *   t:a,b,c,d,e,f  a ticket (6 different numbers, ascending): 2 hits 1× · 3: 8× · 4: 80× · 5: 1,000×
 *                  · 5 + bonus: 12,000× · 6: 50,000×
 *   odd | even | low | high   the first ball: 1.92×
 * Checked against the engine's test vectors (internal/tables/testdata/draw-orbit36.json).
 * Load after ../_core/table-client.js and before NXTable.start.
 */
(function () {
  'use strict';
  var PAY = [0, 0, 1, 8, 80, 1000, 50000], BONUS_PAY = 12000, SIDE = 1.92;
  function ticket(spot) {
    if (typeof spot !== 'string' || spot.slice(0, 2) !== 't:') return null;
    var parts = spot.slice(2).split(','), out = [];
    if (parts.length !== 6) return null;
    for (var i = 0; i < 6; i++) {
      var p = parts[i];
      if (!/^[1-9][0-9]?$/.test(p)) return null;
      var n = Number(p);
      if (n > 36 || (out.length && n <= out[out.length - 1])) return null;
      out.push(n);
    }
    return out;
  }
  var RULES = {
    deal: function (src) {
      var a = [], steps = [], i;
      for (i = 0; i < 36; i++) a.push(i + 1);
      for (i = 0; i < 7; i++) {
        var j = i + src.intn(36 - i), t = a[i]; a[i] = a[j]; a[j] = t;
        steps.push(i < 6 ? { at: 800 + i * 1200, kind: 'ball', value: a[i] } : { at: 8200, kind: 'ball', to: 'bonus', value: a[i] });
      }
      return { outcome: { balls: a.slice(0, 6), bonus: a[6] }, steps: steps };
    },
    validSpot: function (s) { return s === 'odd' || s === 'even' || s === 'low' || s === 'high' || ticket(s) !== null; },
    pay: function (o, spot) {
      if (!o || !o.balls || o.balls.length !== 6 || o.bonus == null) return 0;
      var f = o.balls[0];
      switch (spot) {
        case 'odd': return f % 2 === 1 ? SIDE : 0;
        case 'even': return f % 2 === 0 ? SIDE : 0;
        case 'low': return f <= 18 ? SIDE : 0;
        case 'high': return f >= 19 ? SIDE : 0;
      }
      var t = ticket(spot);
      if (!t) return 0;
      var k = 0, bonus = false;
      for (var i = 0; i < 6; i++) {
        if (o.balls.indexOf(t[i]) >= 0) k++;
        else if (t[i] === o.bonus) bonus = true;
      }
      return k === 5 && bonus ? BONUS_PAY : PAY[k];
    },
    dealMs: function () { return 9300; },
  };
  RULES.ticket = ticket;
  NXTable.registerRules('orbit36', RULES);
})();
