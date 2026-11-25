/* Chroma Ten (88.0098) — the game's rules for the shared table client (demo play + provably-fair
 * verify), the SAME as the engine's nexorng-engine/internal/tables/colorpredict.go: one digit 0–9 per
 * round (one unbiased draw from the round's stream), published 1.5 s into the deal.
 *   green  1 3 7 9 → 2×, 5 → 1.6×      red  2 4 6 8 → 2×, 0 → 1.6×      violet  0 5 → 4.8×
 *   big 5–9 → 1.92×   small 0–4 → 1.92×   n:<digit> → 9.6×   (return multipliers; RTP 96 % each)
 * Checked against the engine's test vectors (internal/tables/testdata/draw-colorpredict.json).
 * Load after ../_core/table-client.js and before NXTable.start.
 */
(function () {
  'use strict';
  function color(d) { return d === 0 ? 'red-violet' : d === 5 ? 'green-violet' : d % 2 ? 'green' : 'red'; }
  function pay(o, spot) {
    var d = o && o.pocket;
    if (d == null) return 0;
    switch (spot) {
      case 'green': return d === 1 || d === 3 || d === 7 || d === 9 ? 2 : d === 5 ? 1.6 : 0;
      case 'red': return d === 2 || d === 4 || d === 6 || d === 8 ? 2 : d === 0 ? 1.6 : 0;
      case 'violet': return d === 0 || d === 5 ? 4.8 : 0;
      case 'big': return d >= 5 ? 1.92 : 0;
      case 'small': return d <= 4 ? 1.92 : 0;
    }
    return spot === 'n:' + d ? 9.6 : 0;
  }
  NXTable.registerRules('colorpredict', {
    deal: function (src) {
      var d = src.intn(10);
      return { outcome: { pocket: d, color: color(d) }, steps: [{ at: 1500, kind: 'pocket', value: d }] };
    },
    validSpot: function (s) { return /^(green|red|violet|big|small|n:[0-9])$/.test(s); },
    pay: pay,
    dealMs: function () { return 5000; },
  });
  window.ChromaRules = { color: color, pay: pay };
})();
