/* Jewel Drum (88.0093) — the game's rules for the shared table client (demo play + provably-fair
 * verify), the SAME as the engine's nexorng-engine/internal/tables/jeweldrum.go: a drum of 20 jewel
 * symbols (5 families × 4 colours, the NX emblem in the gold-orb place); one unbiased intn(292) per
 * round, then a walk through the weights in drum order; the symbol is published 3 s into the deal.
 * Spots: "sym:<colour>-<family>" / "sym:nx", "colour:<colour>", "family:<family>"; pays are return
 * multipliers. Checked against the engine's test vectors (internal/tables/testdata/draw-jeweldrum.json).
 * Also exposes the table as window.JDRules for the page. Load after ../_core/table-client.js.
 */
(function () {
  'use strict';
  var FAMILY = { coin: [28, 10], gem: [20, 14], star: [14, 20], crown: [7, 40], orb: [5, 56] }; // weight, symbol pay
  var FAMILY_PAY = { coin: 2.5, gem: 3.5, star: 5, crown: 10, orb: 17.5 };
  var COLOUR_PAY = { violet: 3.8, gold: 4, emerald: 3.8, ruby: 3.8 };
  var IDS = ['nx', 'violet-coin', 'emerald-gem', 'ruby-star', 'gold-coin', 'violet-crown', 'emerald-coin',
    'ruby-gem', 'gold-star', 'violet-orb', 'ruby-coin', 'gold-gem', 'emerald-star', 'ruby-crown',
    'violet-gem', 'gold-crown', 'emerald-orb', 'violet-star', 'ruby-orb', 'emerald-crown'];
  var DRUM = IDS.map(function (id) {
    if (id === 'nx') return { id: id, colour: 'gold', family: 'orb', weight: 1, pay: 280 };
    var p = id.split('-');
    return { id: id, colour: p[0], family: p[1], weight: FAMILY[p[1]][0], pay: FAMILY[p[1]][1] };
  });
  var TOTAL = 292;

  function deal(src) {
    var r = src.intn(TOTAL), idx = 0;
    for (var i = 0; i < DRUM.length; i++) {
      if (r < DRUM[i].weight) { idx = i; break; }
      r -= DRUM[i].weight;
    }
    return { outcome: { pocket: idx }, steps: [{ at: 3000, kind: 'pocket', value: idx }] };
  }
  function validSpot(s) {
    var m = /^(sym|colour|family):(.+)$/.exec(String(s));
    if (!m) return false;
    if (m[1] === 'sym') return IDS.indexOf(m[2]) >= 0;
    if (m[1] === 'colour') return Object.prototype.hasOwnProperty.call(COLOUR_PAY, m[2]);
    return Object.prototype.hasOwnProperty.call(FAMILY_PAY, m[2]);
  }
  function pay(o, spot) {
    if (!o || o.pocket == null || o.pocket < 0 || o.pocket >= DRUM.length) return 0;
    var s = DRUM[o.pocket], i = String(spot).indexOf(':'), kind = String(spot).slice(0, i), v = String(spot).slice(i + 1);
    if (kind === 'sym') return v === s.id ? s.pay : 0;
    if (kind === 'colour') return v === s.colour ? COLOUR_PAY[v] : 0;
    if (kind === 'family') return v === s.family ? FAMILY_PAY[v] : 0;
    return 0;
  }

  NXTable.registerRules('jeweldrum', { deal: deal, validSpot: validSpot, pay: pay, dealMs: function () { return 7000; } });
  window.JDRules = { DRUM: DRUM, IDS: IDS, TOTAL: TOTAL, FAMILY: FAMILY, FAMILY_PAY: FAMILY_PAY, COLOUR_PAY: COLOUR_PAY, pay: pay, validSpot: validSpot };
})();
