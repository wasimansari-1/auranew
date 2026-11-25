/* Digit Drum (88.0088) — the game's rules for the shared table client (demo play + provably-fair
 * verify), the SAME as the engine's nexorng-engine/internal/tables/digitdrum.go: one digit 0–9 per
 * round (one unbiased draw from the round's stream), published 5.5 s into the deal; a spot
 * "n:<digit>" returns 9× the stake. Checked against the engine's test vectors
 * (internal/tables/testdata/draw-digitdrum.json, check-table-client.mjs).
 * Load after ../_core/table-client.js and before NXTable.start.
 */
NXTable.registerRules('digitdrum', {
  deal: function (src) {
    var d = src.intn(10);
    return { outcome: { pocket: d }, steps: [{ at: 5500, kind: 'pocket', value: d }] };
  },
  validSpot: function (s) { return /^n:[0-9]$/.test(s); },
  pay: function (o, spot) { return spot === 'n:' + o.pocket ? 9 : 0; },
  dealMs: function () { return 9300; },
});
