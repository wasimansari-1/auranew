/* Jhandi Munda (88.0103) — the game's rules for the shared table client (demo play + provably-fair
 * verify), the SAME as the engine's nexorng-engine/internal/tables/jhandimunda.go: six dice per round,
 * die 1 → die 6, each an unbiased draw 1–6 from the round's stream (1 heart · 2 spade · 3 diamond ·
 * 4 club · 5 flag · 6 crown), published in one "dice" step 2.4 s into the throw (the release from the
 * cup). A symbol pays by how many of the six dice show it (PAYS, index = matches). Checked against the
 * engine's test vectors (internal/tables/testdata/draw-jhandimunda.json, check-table-client.mjs).
 * Load after ../_core/table-client.js and before NXTable.start. app.js shows the pay table from
 * window.JMRules.PAYS — the only copy of the pays on the site.
 */
(function () {
  'use strict';
  var SYMBOLS = ['heart', 'spade', 'diamond', 'club', 'flag', 'crown'];
  var PAYS = [0, 0, 3, 5, 10, 25, 100]; // chosen 2026-11-25 — must equal JhandiMundaPays in the engine
  function count(o, v) { var n = 0; (o.dice || []).forEach(function (d) { if (d === v) n++; }); return n; }
  function pay(o, spot) {
    var v = SYMBOLS.indexOf(spot) + 1;
    if (!v || !o || !o.dice || o.dice.length !== 6) return 0;
    return PAYS[count(o, v)];
  }
  window.JMRules = { SYMBOLS: SYMBOLS, PAYS: PAYS, count: count, STEP_MS: 2400, DEAL_MS: 9300 };
  NXTable.registerRules('jhandimunda', {
    deal: function (src) {
      var d = [];
      for (var i = 0; i < 6; i++) d.push(src.intn(6) + 1);
      return { outcome: { dice: d }, steps: [{ at: 2400, kind: 'dice', dice: d }] };
    },
    validSpot: function (spot) { return SYMBOLS.indexOf(spot) >= 0; },
    pay: pay,
    dealMs: function () { return 9300; },
  });
})();
