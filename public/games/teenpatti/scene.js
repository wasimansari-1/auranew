/* Teen Patti — the live table scene: palace hall (canvas), our dealer Anaya (layered SVG with
 * breathing, blinking, gaze, expressions and two-bone arms), the felt table (SVG), cards (DOM,
 * slide from the shoe + 3D flip) and chips (DOM). Everything on the table lives in one design
 * box (1000 × 860 units) scaled into the play area, so dealer, cards and spots keep their place.
 *
 *   var scene = TPScene.create({ table, canvas, sound(name) });
 *   scene.layout({ fullW, fullH, left, top, w, h })     — stage size + play area (px)
 *   scene.deal(side, index, card, animate) → Promise      — 'A' | 'B', 0..2, { rank, suit }
 *   scene.collect(animate) · scene.highlight(winner) · scene.label(side, text, state)
 *   scene.stacks({ A: { amount, pending }, B: … }, chipValues) · scene.flyChip(spot, value, fromPoint)
 *   scene.settle(spot, kind, bet, back) → Promise         — kind: win | lose | half
 *   scene.timer(info) · scene.phrase(text) · scene.banner(title, sub, side) · scene.react(kind)
 *   scene.look(target, ms) · scene.gesture(kind) · scene.onSpot(fn) · scene.spot(side, info)
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var DW = 1000, DH = 860, CW = 92, CH = 130;
  var P = {
    shoe: { x: 826, y: 398 },
    discard: { x: 140, y: 394 },
    tray: { x: 500, y: 404 },
    handoff: { x: 515, y: 470 },
    slots: { A: [[188, 510], [288, 510], [388, 510]], B: [[612, 510], [712, 510], [812, 510]] },
    stack: { A: { x: 420, y: 772 }, B: { x: 580, y: 772 } },
    payout: { A: { x: 352, y: 786 }, B: { x: 648, y: 786 } },
    spot: { A: { x: 270, y: 740 }, B: { x: 730, y: 740 } },
    shoulder: { R: { x: 404, y: 296 }, L: { x: 596, y: 296 } },
    rest: { R: { x: 412, y: 436 }, L: { x: 588, y: 436 } },
    medal: { x: 500, y: 510 },
  };
  var UPPER = 112, FORE = 126;
  var SKIN = '#c98a62', SKIN_D = '#a8694a', SKIN_O = '#6f3f2a', TEAL = '#0f6b6c', TEAL_D = '#0a4c4d', GOLD = '#e8b84a';
  // near rail: inner edge of the padded arm rest (an ellipse seen from the players' side)
  function railY(x, rx, ry) { var d = (x - 500) / rx; return 300 + ry * Math.sqrt(Math.max(0, 1 - d * d)); }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function div(cls, parent) { var d = document.createElement('div'); d.className = cls; if (parent) parent.appendChild(d); return d; }
  function f1(n) { return Math.round(n * 10) / 10; }

  // ------------------------------------------------------------------ suits (paths in a 100 box)
  var SUIT = {
    H: 'M50 90C22 68 4 50 4 31 4 15 16 5 30 5c10 0 17 6 20 14 3-8 10-14 20-14 14 0 26 10 26 26 0 19-18 37-46 59z',
    D: 'M50 3 88 50 50 97 12 50z',
    S: 'M50 4c12 18 46 36 46 58 0 16-12 26-26 26-8 0-14-4-17-9 1 9 5 15 11 19H36c6-4 10-10 11-19-3 5-9 9-17 9C16 88 4 78 4 62 4 40 38 22 50 4z',
    C: 'M50 6a21 21 0 0 1 17 33 21 21 0 1 1-12 34c1 10 5 17 12 23H33c7-6 11-13 12-23a21 21 0 1 1-12-34A21 21 0 0 1 50 6z',
  };
  function suitSvg(s, cls) { return '<svg class="' + cls + '" viewBox="0 0 100 100" aria-hidden="true"><path d="' + SUIT[s] + '"/></svg>'; }
  var RANK_TXT = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
  function rankText(r) { return RANK_TXT[r] || r; }

  // ------------------------------------------------------------------ the table art (SVG)
  function tableSvg() {
    var s = '';
    s += '<defs>' +
      '<radialGradient id="tpFelt" cx="500" cy="560" r="720" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1b8264"/><stop offset=".55" stop-color="#0f5644"/><stop offset="1" stop-color="#062b22"/></radialGradient>' +
      '<linearGradient id="tpWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b321b"/><stop offset=".5" stop-color="#43190d"/><stop offset="1" stop-color="#250b05"/></linearGradient>' +
      '<linearGradient id="tpLeather" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2216"/><stop offset=".35" stop-color="#3a110b"/><stop offset="1" stop-color="#1a0605"/></linearGradient>' +
      '<linearGradient id="tpGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".45" stop-color="#e8b84a"/><stop offset="1" stop-color="#9c6a1c"/></linearGradient>' +
      '<linearGradient id="tpFillA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,160,60,.30)"/><stop offset="1" stop-color="rgba(255,120,30,.12)"/></linearGradient>' +
      '<linearGradient id="tpFillB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(90,170,255,.30)"/><stop offset="1" stop-color="rgba(60,120,255,.12)"/></linearGradient>' +
      '<linearGradient id="tpBlouse" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16807f"/><stop offset="1" stop-color="#0a4a4b"/></linearGradient>' +
      '<linearGradient id="tpPallu" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3223f"/><stop offset="1" stop-color="#5e0f22"/></linearGradient>' +
      '<radialGradient id="tpFace" cx="490" cy="150" r="110" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#e0a982"/><stop offset=".7" stop-color="#cf9068"/><stop offset="1" stop-color="#b9774f"/></radialGradient>' +
      '<linearGradient id="tpHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c1812"/><stop offset="1" stop-color="#140906"/></linearGradient>' +
      '<clipPath id="tpEyeL"><ellipse cx="470" cy="172" rx="14.5" ry="10.5"/></clipPath>' +
      '<clipPath id="tpEyeR"><ellipse cx="530" cy="172" rx="14.5" ry="10.5"/></clipPath>' +
      '</defs>';

    // ---- dealer (behind the table) ----
    s += '<g id="tpDealer">';
    s += '<g id="tpBody">' +
      // bun with jasmine behind the neck
      '<circle cx="566" cy="226" r="34" fill="url(#tpHair)"/>' +
      jasmine(566, 226, 36) +
      '<path d="M470 205 C470 240 466 262 456 276 L544 276 C534 262 530 240 530 205 Z" fill="' + SKIN_D + '"/>' +
      '<path d="M474 232 C488 246 512 246 526 232 L528 262 C512 270 488 270 472 262 Z" fill="#9c5f42" opacity=".55"/>' +
      // blouse + shoulders
      '<path d="M372 300 C386 268 432 258 466 262 C480 280 520 280 534 262 C568 258 614 268 628 300 C646 340 652 392 646 440 L354 440 C348 392 354 340 372 300 Z" fill="url(#tpBlouse)"/>' +
      '<path d="M466 262 C480 284 520 284 534 262" fill="none" stroke="' + GOLD + '" stroke-width="4"/>' +
      '<path d="M462 262 C478 292 522 292 538 262 L534 262 C520 280 480 280 466 262 Z" fill="' + SKIN + '"/>' +
      // necklace
      necklace() +
      // saree pallu across the chest, over her left shoulder (viewer's right)
      '<path d="M546 262 C584 258 616 272 628 298 C634 318 630 330 624 338 L476 440 L404 440 Z" fill="url(#tpPallu)"/>' +
      '<path d="M546 262 L404 440 M628 298 C634 318 630 330 624 338 L476 440" fill="none" stroke="' + GOLD + '" stroke-width="5"/>' +
      '<path d="M556 270 L420 440 M620 326 L486 440" fill="none" stroke="' + GOLD + '" stroke-width="1.6" stroke-dasharray="3 5" opacity=".9"/>' +
      butis() +
      // name badge
      '<rect x="396" y="350" width="62" height="18" rx="4" fill="url(#tpGold)"/>' +
      '<text x="427" y="363.5" text-anchor="middle" font-size="11" font-weight="700" fill="#4a1a08" font-family="Georgia, "Times New Roman", serif" letter-spacing="1">ANAYA</text>' +
      '</g>';

    s += '<g id="tpHead">' +
      '<ellipse cx="500" cy="162" rx="86" ry="94" fill="url(#tpHair)"/>' +
      // ears + earrings
      '<ellipse cx="423" cy="178" rx="10" ry="18" fill="' + SKIN_D + '"/><ellipse cx="577" cy="178" rx="10" ry="18" fill="' + SKIN_D + '"/>' +
      '<g id="tpEarR">' + jhumka(422, 194) + '</g><g id="tpEarL">' + jhumka(578, 194) + '</g>' +
      // face
      '<path d="M500 90 C556 90 580 132 578 172 C576 216 544 250 500 252 C456 250 424 216 422 172 C420 132 444 90 500 90 Z" fill="url(#tpFace)"/>' +
      '<g id="tpFeat">' +
      '<ellipse cx="452" cy="204" rx="15" ry="8" fill="#e46a6a" opacity=".22"/><ellipse cx="548" cy="204" rx="15" ry="8" fill="#e46a6a" opacity=".22"/>' +
      eye('L', 470) + eye('R', 530) +
      '<g id="tpBrows" fill="none" stroke="#24120c" stroke-width="5" stroke-linecap="round"><path d="M450 152 Q468 141 488 149"/><path d="M512 149 Q532 141 550 152"/></g>' +
      '<path d="M501 176 Q499 194 492 200 Q500 205 509 200" fill="none" stroke="#9a5a3c" stroke-width="2.4" stroke-linecap="round"/>' +
      '<circle cx="508.5" cy="199" r="2.2" fill="#ffe08a"/>' +
      '<path id="tpMouthIn" fill="#5b1820"/><path id="tpTeeth" fill="#fff8f0"/><path id="tpLipU" fill="#b2384a"/><path id="tpLipD" fill="#c4485a"/>' +
      '<circle cx="500" cy="138" r="3.8" fill="#c8102e"/>' +
      '</g>' +
      // hair over the forehead with a centre parting + maang tikka
      '<path d="M420 176 C414 112 448 76 500 78 C552 76 586 112 580 176 C572 140 552 112 506 104 L500 97 L494 104 C448 112 428 140 420 176 Z" fill="url(#tpHair)"/>' +
      '<path d="M446 104 C462 90 482 84 496 86" fill="none" stroke="#5a382c" stroke-width="3" stroke-linecap="round" opacity=".7"/>' +
      '<path d="M500 97 L500 114" stroke="' + GOLD + '" stroke-width="1.8"/><circle cx="500" cy="118" r="5" fill="url(#tpGold)"/><circle cx="500" cy="118" r="2.2" fill="#c8102e"/>' +
      '</g>';
    s += '</g>';

    // ---- hall ledge shadow + table ----
    s += '<path d="M46 372 L954 372 C1040 520 1150 720 1320 1150 L-320 1150 C-150 720 -40 520 46 372 Z" fill="url(#tpFelt)"/>';
    // printed gold border on the felt
    s += '<path d="M76 396 L924 396 C1000 520 1080 660 1150 860" fill="none" stroke="' + GOLD + '" stroke-width="2" opacity=".45"/>' +
      '<path d="M76 396 C0 520 -80 660 -150 860" fill="none" stroke="' + GOLD + '" stroke-width="2" opacity=".45"/>';
    s += rosette(P.medal.x, P.medal.y);
    s += paisley(64, 470, 1) + paisley(936, 470, -1);
    // far rail (dealer side) with the chip float
    s += '<rect x="26" y="350" width="948" height="30" rx="15" fill="url(#tpWood)"/>' +
      '<line x1="44" y1="357" x2="956" y2="357" stroke="' + GOLD + '" stroke-width="2" opacity=".8"/>' +
      '<rect x="40" y="380" width="920" height="14" fill="#000" opacity=".22"/>';
    s += floatTray();
    s += shoe() + discardTray();
    // betting spots
    s += spotSvg('A') + spotSvg('B');
    s += '<text x="500" y="842" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="3" fill="' + GOLD + '" opacity=".75" font-family="Georgia, "Times New Roman", serif">TIE · HALF BACK</text>';
    // near rail: padded arm rest
    var outer = [], inner = [];
    for (var x = -420; x <= 1420; x += 40) { outer.push(x + ' ' + f1(railY(x, 1080, 615))); inner.push(x + ' ' + f1(railY(x, 1010, 548))); }
    s += '<path d="M' + inner.join(' L') + ' L1420 1300 L-420 1300 Z" fill="url(#tpLeather)"/>';
    s += '<path d="M' + inner.join(' L') + '" fill="none" stroke="' + GOLD + '" stroke-width="3"/>';
    s += '<path d="M' + outer.join(' L') + ' L1420 1300 L-420 1300 Z" fill="url(#tpWood)"/>';
    s += '<path d="M' + outer.join(' L') + '" fill="none" stroke="#ffcf7a" stroke-width="1.5" opacity=".55"/>';
    return s;
  }
  function jasmine(cx, cy, r) {
    var s = '';
    for (var i = 0; i < 9; i++) {
      var a = -1.3 + i * 0.36;
      s += '<circle cx="' + f1(cx + Math.cos(a) * r) + '" cy="' + f1(cy + Math.sin(a) * r) + '" r="5.5" fill="#fffaf0" stroke="#e8dcc0" stroke-width="1"/>';
    }
    return s;
  }
  function necklace() {
    var s = '<path d="M470 268 C484 290 516 290 530 268" fill="none" stroke="' + GOLD + '" stroke-width="3"/>';
    for (var i = 0; i <= 8; i++) {
      var t = i / 8, x = lerp(470, 530, t), y = 268 + Math.sin(t * Math.PI) * 17;
      s += '<circle cx="' + f1(x) + '" cy="' + f1(y + 3) + '" r="' + (i % 2 ? 2.6 : 3.4) + '" fill="' + (i % 2 ? '#c8102e' : 'url(#tpGold)') + '"/>';
    }
    return s + '<path d="M500 286 l7 9 -7 11 -7 -11z" fill="url(#tpGold)"/><circle cx="500" cy="296" r="3" fill="#1f8a5b"/>';
  }
  function butis() {
    var s = '';
    [[588, 292], [560, 322], [530, 352], [500, 382], [470, 412], [606, 318], [576, 350], [546, 380], [516, 410]].forEach(function (p) {
      s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="' + GOLD + '" opacity=".9"/>';
    });
    return s;
  }
  function jhumka(x, y) {
    return '<circle cx="' + x + '" cy="' + y + '" r="3.2" fill="url(#tpGold)"/>' +
      '<path d="M' + (x - 9) + ' ' + (y + 18) + ' C' + (x - 8) + ' ' + (y + 6) + ' ' + (x + 8) + ' ' + (y + 6) + ' ' + (x + 9) + ' ' + (y + 18) + ' Z" fill="url(#tpGold)"/>' +
      '<line x1="' + x + '" y1="' + (y + 3) + '" x2="' + x + '" y2="' + (y + 8) + '" stroke="' + GOLD + '" stroke-width="1.6"/>' +
      '<circle cx="' + (x - 6) + '" cy="' + (y + 21) + '" r="1.8" fill="#fffaf0"/><circle cx="' + x + '" cy="' + (y + 22) + '" r="1.8" fill="#fffaf0"/><circle cx="' + (x + 6) + '" cy="' + (y + 21) + '" r="1.8" fill="#fffaf0"/>';
  }
  function eye(side, cx) {
    var id = side === 'L' ? 'tpEyeL' : 'tpEyeR';
    return '<g class="tp-eye" id="tpEye' + side + '">' +
      '<ellipse cx="' + cx + '" cy="172" rx="14.5" ry="10.5" fill="#fbf6ef"/>' +
      '<g clip-path="url(#' + id + ')"><g id="tpIris' + side + '"><circle cx="' + cx + '" cy="172.5" r="8" fill="#5a3218"/><circle cx="' + cx + '" cy="172.5" r="5.6" fill="#3a1d0c"/><circle cx="' + cx + '" cy="172.5" r="3.4" fill="#0d0604"/><circle cx="' + (cx + 2.8) + '" cy="169.4" r="2" fill="#fff"/><circle cx="' + (cx - 2.4) + '" cy="175.4" r="1" fill="#fff" opacity=".7"/></g></g>' +
      '<path d="M' + (cx - 13) + ' 176 Q' + cx + ' 186 ' + (cx + 13) + ' 176" fill="none" stroke="#6a3a26" stroke-width="1.4" opacity=".6"/>' +
      '</g>' +
      '<path id="tpLash' + side + '" d="M' + (cx - 15.5) + ' 173 Q' + cx + ' 151 ' + (cx + 15.5) + ' 173 ' + (side === 'L' ? 'M' + (cx - 15) + ' 171 l-6 -4' : 'M' + (cx + 15) + ' 171 l6 -4') + '" fill="none" stroke="#1a0c07" stroke-width="3.4" stroke-linecap="round"/>';
  }
  function rosette(cx, cy) {
    var s = '<g opacity=".28" fill="none" stroke="' + GOLD + '" stroke-width="2">';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="112"/><circle cx="' + cx + '" cy="' + cy + '" r="98" stroke-dasharray="2 6"/>';
    for (var i = 0; i < 16; i++) {
      var a = i / 16 * Math.PI * 2, a2 = a + Math.PI / 16, a3 = a - Math.PI / 16;
      s += '<path d="M' + f1(cx + Math.cos(a3) * 62) + ' ' + f1(cy + Math.sin(a3) * 62 * 0.9) + ' Q' + f1(cx + Math.cos(a) * 112) + ' ' + f1(cy + Math.sin(a) * 104) + ' ' + f1(cx + Math.cos(a2) * 62) + ' ' + f1(cy + Math.sin(a2) * 62 * 0.9) + '"/>';
    }
    return s + '</g>';
  }
  function paisley(x, y, dir) {
    return '<g opacity=".3" fill="none" stroke="' + GOLD + '" stroke-width="2" transform="translate(' + x + ' ' + y + ') scale(' + dir + ' 1)">' +
      '<path d="M0 40 C-30 20 -24 -24 6 -30 C30 -34 40 -6 24 8 C14 18 2 14 4 2"/><circle cx="8" cy="-8" r="5"/><path d="M0 40 C18 36 34 24 40 8" stroke-dasharray="2 5"/></g>';
  }
  function floatTray() {
    var s = '<rect x="390" y="362" width="220" height="70" rx="10" fill="#160805" stroke="url(#tpGold)" stroke-width="3"/>';
    var cols = ['#f4ecd8', '#c62828', '#1f5fbf', '#1c1c1c', '#7b2fbf', '#c62828', '#1f5fbf', '#f4ecd8'];
    for (var i = 0; i < 8; i++) {
      var x = 400 + i * 25.5, h = 34 + ((i * 7) % 4) * 3, top = 426 - h;
      s += '<rect x="' + x + '" y="' + top + '" width="22" height="' + h + '" rx="3" fill="' + cols[i] + '"/>';
      for (var y = top + 4; y < 426; y += 4.5) s += '<line x1="' + x + '" y1="' + f1(y) + '" x2="' + (x + 22) + '" y2="' + f1(y) + '" stroke="#000" stroke-opacity=".28" stroke-width="1"/>';
      s += '<rect x="' + (x + 3) + '" y="' + top + '" width="4" height="' + h + '" fill="#fff" opacity=".18"/>';
    }
    return s;
  }
  function shoe() {
    return '<g>' +
      '<path d="M770 432 L912 432 L918 378 L786 364 Z" fill="#2a1009"/>' +
      '<path d="M786 364 L918 378 L904 344 L800 334 Z" fill="#5a2a16"/>' +
      '<path d="M800 344 L900 354 L898 348 L802 339 Z" fill="#7a1027"/>' +
      '<path d="M786 364 L918 378" stroke="url(#tpGold)" stroke-width="3"/>' +
      '<path d="M770 432 L786 364" stroke="url(#tpGold)" stroke-width="2"/>' +
      '<path d="M792 384 L858 392 L854 420 L796 414 Z" fill="#14070a"/>' +
      '<path d="M798 388 L850 394 L848 410 L800 406 Z" fill="#7a1027" stroke="' + GOLD + '" stroke-width="1"/>' +
      '<rect x="862" y="396" width="36" height="22" rx="4" fill="url(#tpGold)"/>' +
      '<text x="880" y="412" text-anchor="middle" font-size="13" font-weight="800" fill="#4a1a08" font-family="Georgia, "Times New Roman", serif">N</text>' +
      '</g>';
  }
  function discardTray() {
    return '<g>' +
      '<path d="M86 432 L196 432 L192 368 L92 368 Z" fill="rgba(255,255,255,.06)" stroke="rgba(255,240,210,.35)" stroke-width="2"/>' +
      '<g id="tpDiscard"></g>' +
      '<path d="M86 432 L196 432" stroke="url(#tpGold)" stroke-width="3"/>' +
      '</g>';
  }
  function spotPath(side) {
    var x0 = side === 'A' ? 88 : 514, x1 = side === 'A' ? 486 : 912;
    var bl = side === 'A' ? 62 : 516, br = side === 'A' ? 484 : 938; // bottom corners (perspective slant)
    var top = 668, r = 22;
    var yb = function (x) { return railY(x, 1010, 548) - 22; };
    var d = 'M' + (x0 + r) + ' ' + top + ' L' + (x1 - r) + ' ' + top + ' Q' + x1 + ' ' + top + ' ' + f1(x1 + (br - x1) * 0.12) + ' ' + (top + r);
    d += ' L' + f1(br - 2) + ' ' + f1(yb(br) - r);
    d += ' Q' + br + ' ' + f1(yb(br)) + ' ' + (br - r) + ' ' + f1(yb(br - r));
    for (var x = br - r - 20; x > bl + r; x -= 20) d += ' L' + x + ' ' + f1(yb(x));
    d += ' L' + (bl + r) + ' ' + f1(yb(bl + r)) + ' Q' + bl + ' ' + f1(yb(bl)) + ' ' + f1(bl + 2) + ' ' + f1(yb(bl) - r);
    d += ' L' + f1(x0 + (bl - x0) * 0.12) + ' ' + (top + r) + ' Q' + x0 + ' ' + top + ' ' + (x0 + r) + ' ' + top + ' Z';
    return d;
  }
  function spotSvg(side) {
    var c = P.spot[side], tx = side === 'A' ? 252 : 748;
    return '<g class="tp-spot" id="tpSpot' + side + '" role="button" tabindex="0" aria-label="Bet on Player ' + side + '">' +
      '<path class="tp-spot__glow" d="' + spotPath(side) + '"/>' +
      '<path class="tp-spot__shape" d="' + spotPath(side) + '" fill="url(#tpFill' + side + ')" stroke="url(#tpGold)" stroke-width="3.5"/>' +
      '<text class="tp-spot__name" x="' + tx + '" y="' + (c.y - 18) + '" text-anchor="middle">PLAYER ' + side + '</text>' +
      '<text class="tp-spot__pays" x="' + tx + '" y="' + (c.y + 14) + '" text-anchor="middle">PAYS 0.98 : 1</text>' +
      '<text class="tp-spot__info" id="tpInfo' + side + '" x="' + tx + '" y="' + (c.y + 46) + '" text-anchor="middle"></text>' +
      '</g>';
  }

  // ------------------------------------------------------------------ arms (SVG, above the cards)
  function armSvg(k) {
    var m = k === 'L' ? ' scale(1 -1)' : '';
    return '<g id="tpArm' + k + '">' +
      '<line class="o-u" stroke="' + TEAL_D + '" stroke-width="50" stroke-linecap="round"/>' +
      '<line class="o-f" stroke="' + SKIN_O + '" stroke-width="34" stroke-linecap="round"/>' +
      '<line class="s-f" stroke="' + SKIN + '" stroke-width="29" stroke-linecap="round"/>' +
      '<line class="h-f" stroke="#e0a982" stroke-width="7" stroke-linecap="round" opacity=".55"/>' +
      '<line class="sl-f" stroke="' + TEAL + '" stroke-width="38" stroke-linecap="round"/>' +
      '<line class="sl-u" stroke="url(#tpArmSleeve)" stroke-width="45" stroke-linecap="round"/>' +
      '<line class="cuff" stroke="' + GOLD + '" stroke-width="6" stroke-linecap="round"/>' +
      '<g class="hand"><g class="hand__in" transform="scale(1)' + m + '">' +
      '<ellipse cx="-10" cy="0" rx="4.5" ry="16.5" fill="none" stroke="url(#tpArmGold)" stroke-width="4"/>' +
      '<ellipse cx="-17" cy="0" rx="4.5" ry="16.5" fill="none" stroke="#b3243a" stroke-width="4"/>' +
      '<ellipse cx="-24" cy="0" rx="4.5" ry="16.5" fill="none" stroke="url(#tpArmGold)" stroke-width="4"/>' +
      '<g class="fingers" stroke-linecap="round">' +
      '<path d="M34 -9 L56 -11 M36 -3 L60 -3 M36 3 L58 4 M34 9 L52 11" stroke="' + SKIN_O + '" stroke-width="10.5"/>' +
      '<path d="M34 -9 L56 -11 M36 -3 L60 -3 M36 3 L58 4 M34 9 L52 11" stroke="' + SKIN + '" stroke-width="8"/>' +
      '<path d="M55 -11 L57 -11 M59 -3 L61 -3 M57 4 L59 4 M51 11 L53 11" stroke="#b3243a" stroke-width="5"/>' +
      '</g>' +
      '<path d="M-2 -13 C14 -17 30 -15 37 -10 L39 10 C30 15 12 16 -2 12 Z" fill="' + SKIN + '" stroke="' + SKIN_O + '" stroke-width="2.4"/>' +
      '<path d="M8 -12 L30 -22" stroke="' + SKIN_O + '" stroke-width="11" stroke-linecap="round"/>' +
      '<path d="M8 -12 L30 -22" stroke="' + SKIN + '" stroke-width="8.5" stroke-linecap="round"/>' +
      '<path d="M6 -4 C16 -6 26 -5 32 -2" stroke="' + SKIN_D + '" stroke-width="2" fill="none" opacity=".7"/>' +
      '</g></g>' +
      '</g>';
  }

  // ------------------------------------------------------------------ create
  function create(opts) {
    var root = opts.table, canvas = opts.canvas, sound = opts.sound || function () {};
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.innerHTML = '';
    var back = el('svg', { class: 'tp-art', viewBox: '0 0 ' + DW + ' ' + DH, width: DW, height: DH }, root);
    back.innerHTML = tableSvg();
    var cardsLayer = div('tp-cards', root);
    var stacksLayer = div('tp-stacks', root);
    var fx = div('tp-fx', root);
    var arms = el('svg', { class: 'tp-arms', viewBox: '0 0 ' + DW + ' ' + DH, width: DW, height: DH, 'aria-hidden': 'true' }, root);
    arms.innerHTML = '<defs><linearGradient id="tpArmSleeve" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16807f"/><stop offset="1" stop-color="#0b5455"/></linearGradient>' +
      '<linearGradient id="tpArmGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".5" stop-color="#e8b84a"/><stop offset="1" stop-color="#9c6a1c"/></linearGradient></defs>' +
      armSvg('R') + armSvg('L') +
      // the pallu drapes over her left shoulder, above the arm
      '<path id="tpDrape" d="M556 266 C590 262 618 274 630 300 C636 318 634 330 626 340 L604 352 C612 330 606 300 584 290 Z" fill="url(#tpArmPallu)"/>' +
      '<defs><linearGradient id="tpArmPallu" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3223f"/><stop offset="1" stop-color="#6e1428"/></linearGradient></defs>';
    var medal = div('tp-medal', root);
    medal.innerHTML = '<svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="64" fill="#2a0a12" stroke="url(#tpMedGold)" stroke-width="6"/>' +
      '<circle cx="70" cy="70" r="52" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="9"/>' +
      '<circle class="tp-medal__ring" cx="70" cy="70" r="52" fill="none" stroke-width="9" stroke-linecap="round" transform="rotate(-90 70 70)" stroke-dasharray="326.7" stroke-dashoffset="0"/>' +
      '<defs><linearGradient id="tpMedGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".5" stop-color="#e8b84a"/><stop offset="1" stop-color="#9c6a1c"/></linearGradient></defs></svg>' +
      '<span class="tp-medal__txt"></span><span class="tp-medal__sub"></span>';
    var medalRing = medal.querySelector('.tp-medal__ring'), medalTxt = medal.querySelector('.tp-medal__txt'), medalSub = medal.querySelector('.tp-medal__sub');
    var labels = { A: div('tp-label tp-label--A', root), B: div('tp-label tp-label--B', root) };
    labels.A.hidden = labels.B.hidden = true;
    var phraseEl = div('tp-phrase', root);
    var bannerEl = div('tp-banner', root);
    bannerEl.hidden = true;
    bannerEl.innerHTML = '<strong></strong><span></span>';

    var $b = function (id) { return back.querySelector('#' + id); };
    var dealer = {
      body: $b('tpBody'), head: $b('tpHead'), feat: $b('tpFeat'), brows: $b('tpBrows'),
      eyeL: $b('tpEyeL'), eyeR: $b('tpEyeR'), irisL: $b('tpIrisL'), irisR: $b('tpIrisR'), lashL: $b('tpLashL'), lashR: $b('tpLashR'),
      lipU: $b('tpLipU'), lipD: $b('tpLipD'), mouthIn: $b('tpMouthIn'), teeth: $b('tpTeeth'), earL: $b('tpEarL'), earR: $b('tpEarR'),
      drape: arms.querySelector('#tpDrape'),
    };
    var spotEls = { A: $b('tpSpotA'), B: $b('tpSpotB') }, spotInfo = { A: $b('tpInfoA'), B: $b('tpInfoB') };
    var discardG = $b('tpDiscard');
    function armParts(k) {
      var g = arms.querySelector('#tpArm' + k), q = function (c) { return g.querySelector('.' + c); };
      return { g: g, ou: q('o-u'), of: q('o-f'), sf: q('s-f'), hf: q('h-f'), slf: q('sl-f'), slu: q('sl-u'), cuff: q('cuff'), hand: q('hand'), handIn: q('hand__in'), fingers: q('fingers') };
    }
    var armEl = { R: armParts('R'), L: armParts('L') };

    // ---------------------------------------------------------------- motion state
    var hands = {
      R: { x: P.rest.R.x, y: P.rest.R.y, tw: null, curl: 0, lift: 0 },
      L: { x: P.rest.L.x, y: P.rest.L.y, tw: null, curl: 0, lift: 0 },
    };
    function moveHand(k, x, y, ms, lift) {
      var h = hands[k];
      if (h.tw && h.tw.resolve) h.tw.resolve(false);
      if (reduce) ms = Math.min(ms, 120);
      return new Promise(function (resolve) {
        h.tw = { fx: h.x, fy: h.y, tx: x, ty: y, t0: performance.now(), ms: Math.max(1, ms), lift: lift == null ? 16 : lift, resolve: resolve };
      });
    }
    function restHand(k, ms) { return moveHand(k, P.rest[k].x, P.rest[k].y, ms || 420, 10); }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, reduce ? Math.min(ms, 80) : ms); }); }

    var face = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, smile: 0.42, tSmile: 0.42, open: 0, tOpen: 0, brow: 0, tBrow: 0, tilt: 0, tTilt: 0,
      nextBlink: performance.now() + 2000, blinkAt: 0, ear: { a: 0, v: 0 }, lastYaw: 0, nodAt: 0, lookUntil: 0 };
    function lookAt(pt, ms) {
      face.tYaw = clamp((pt.x - 500) / 430, -1, 1);
      face.tPitch = clamp((pt.y - 420) / 480, -0.5, 0.9);
      face.lookUntil = performance.now() + (ms || 1400);
    }
    var CAMERA = { x: 500, y: 420 };
    var expr = { until: 0 };
    function express(smile, open, brow, ms, tilt) {
      face.tSmile = smile; face.tOpen = open; face.tBrow = brow; face.tTilt = tilt || 0;
      expr.until = performance.now() + (ms || 1500);
    }

    // ---------------------------------------------------------------- cards
    var cards = []; // { el, side, i, x, y, r, s, follow, faceUp }
    var dealQ = Promise.resolve(), backlog = 0;
    var busy = 0; // dealing / gathering / paying: the hands are working, no idle gestures
    var hurry = false; // the result is in while cards are still being dealt: deal the rest faster
    function working(p) { busy++; var done = function () { busy--; }; p.then(done, done); return p; }
    function cardEl(card) {
      var red = card.suit === 'H' || card.suit === 'D';
      var c = div('tp-card' + (red ? ' tp-card--red' : ''), cardsLayer);
      var court = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
      var r = rankText(card.rank);
      c.innerHTML = '<div class="tp-card__lift"><div class="tp-card__in">' +
        '<div class="tp-card__face tp-card__back"><i></i></div>' +
        '<div class="tp-card__face tp-card__front">' +
        '<span class="tp-card__tl"><b>' + r + '</b>' + suitSvg(card.suit, 'tp-card__s') + '</span>' +
        (court ? '<span class="tp-card__court"><b>' + r + '</b>' + suitSvg(card.suit, 'tp-card__cs') + '</span>' : suitSvg(card.suit, 'tp-card__mid')) +
        '<span class="tp-card__br"><b>' + r + '</b>' + suitSvg(card.suit, 'tp-card__s') + '</span>' +
        '</div></div></div>';
      c.setAttribute('aria-label', r + ' of ' + ({ H: 'hearts', D: 'diamonds', S: 'spades', C: 'clubs' })[card.suit]);
      return c;
    }
    function placeCard(c) {
      c.el.style.transform = 'translate(' + f1(c.x - CW / 2) + 'px,' + f1(c.y - CH / 2) + 'px) rotate(' + f1(c.r) + 'deg) scale(' + c.s.toFixed(3) + ')';
    }
    function flip(c, up) {
      c.faceUp = up;
      c.el.classList.toggle('tp-card--up', up);
      if (!reduce && c.el.animate) c.el.firstChild.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-16px) scale(1.1)' }, { transform: 'translateY(0) scale(1)' }], { duration: 420, easing: 'ease-out' });
    }
    // The engine deals a card every 700 ms: the left hand pulls each card from the shoe; Player B's
    // cards it slides and turns itself, Player A's it hands to the right hand at the middle of the
    // table — so the left hand is free for the next card while the right one is still turning.
    var rFree = Promise.resolve(); // the right hand's current card
    function deal(side, i, card, animate) {
      var slot = P.slots[side][i];
      if (!animate || document.hidden) {
        var c0 = { el: cardEl(card), side: side, i: i, x: slot[0], y: slot[1], r: 0, s: 1, faceUp: true };
        c0.el.classList.add('tp-card--up', 'tp-card--still');
        placeCard(c0); cards.push(c0);
        return Promise.resolve();
      }
      backlog++;
      var doneFn, done = new Promise(function (r) { doneFn = r; });
      dealQ = dealQ.then(function () {
        var k = hurry || backlog > 2 ? 0.5 : backlog > 1 ? 0.75 : 1;
        working(done);
        return animDeal(side, i, card, slot, k, doneFn);
      }).catch(function () { doneFn(); }).then(function () { backlog--; });
      return done;
    }
    function turnOver(c, hk, slot, k) {
      c.follow = null;
      c.x = slot[0]; c.y = slot[1]; c.r = 0; c.s = 1;
      c.el.classList.add('tp-card--settle'); placeCard(c);
      hands[hk].curl = 0;
      moveHand(hk, slot[0] + (hk === 'R' ? 26 : -26), slot[1] - 42, 160 * k, 6);
      flip(c, true);
      sound('flip');
      return wait(220 * k).then(function () { c.el.classList.remove('tp-card--settle'); });
    }
    function animDeal(side, i, card, slot, k, doneFn) {
      var c = { el: cardEl(card), side: side, i: i, x: P.shoe.x, y: P.shoe.y, r: -14, s: 0.8, faceUp: false, fromShoe: true };
      c.el.style.opacity = '0';
      placeCard(c); cards.push(c);
      lookAt(P.shoe, 700);
      return moveHand('L', P.shoe.x - 4, P.shoe.y - 6, 150 * k, 8).then(function () {
        c.el.style.opacity = '';
        hands.L.curl = 1;
        follow(c, 'L');
        sound('slide');
        if (side === 'B') {
          lookAt({ x: slot[0], y: slot[1] }, 1000);
          return moveHand('L', slot[0], slot[1] - 8, 330 * k, 20)
            .then(function () { return turnOver(c, 'L', slot, k); })
            .then(function () { restHand('L', 360 * k); doneFn(); });
        }
        var meet = rFree.then(function () { return moveHand('R', P.handoff.x - 46, P.handoff.y + 4, 200 * k, 12); });
        return moveHand('L', P.handoff.x, P.handoff.y - 8, 230 * k, 16).then(function () { return meet; }).then(function () {
          hands.L.curl = 0; hands.R.curl = 1;
          follow(c, 'R');
          restHand('L', 320 * k);
          lookAt({ x: slot[0], y: slot[1] }, 1000);
          rFree = moveHand('R', slot[0], slot[1] - 8, 260 * k, 16)
            .then(function () { return turnOver(c, 'R', slot, k); })
            .then(function () { restHand('R', 360 * k); doneFn(); });
        });
      });
    }
    function follow(c, k) {
      var h = hands[k];
      c.follow = { k: k, ox: c.x - h.x, oy: c.y - h.y, t0: performance.now() };
    }
    function updateFollowers(now) {
      cards.forEach(function (c) {
        if (!c.follow) return;
        var h = hands[c.follow.k], f = Math.exp(-(now - c.follow.t0) / 140);
        c.x = h.x + c.follow.ox * f; c.y = h.y + 8 + (c.follow.oy - 8) * f;
        var p = clamp((c.y - P.shoe.y) / (510 - P.shoe.y), 0, 1);
        if (c.fromShoe) { c.r = -14 * (1 - p); c.s = 0.8 + 0.2 * p; }
        placeCard(c);
      });
    }
    function collect(animate) { // runs in the dealing queue, so the next hand waits for it
      hurry = false;
      var run = function () { return rFree.then(function () { return working(gather(animate)); }); };
      dealQ = dealQ.then(run, run);
      return dealQ;
    }
    function gather(animate) {
      var old = cards; cards = [];
      labels.A.hidden = labels.B.hidden = true;
      highlight(null);
      if (!old.length) return Promise.resolve();
      if (!animate || document.hidden || reduce) { old.forEach(function (c) { c.el.remove(); }); addDiscard(old.length); return Promise.resolve(); }
      lookAt({ x: 300, y: 520 }, 1500);
      return Promise.all([moveHand('R', 300, 505, 320, 14), moveHand('L', 700, 505, 320, 14)]).then(function () {
        sound('sweep');
        old.forEach(function (c, n) {
          c.el.classList.add('tp-card--gather');
          c.el.style.transitionDelay = (n * 40) + 'ms';
          c.x = P.discard.x + (n % 3) * 2; c.y = P.discard.y - 8; c.r = 8; c.s = 0.66;
          placeCard(c);
          setTimeout(function () { flip(c, false); }, 60 + n * 40);
        });
        moveHand('R', P.discard.x + 70, P.discard.y + 10, 520, 10);
        moveHand('L', 560, 470, 400, 10).then(function () { restHand('L'); });
        return wait(720);
      }).then(function () {
        old.forEach(function (c) { c.el.remove(); });
        addDiscard(old.length);
        restHand('R', 460);
      });
    }
    var discarded = 0;
    function addDiscard(n) {
      discarded = (discarded + n) % 60;
      var h = Math.min(40, Math.round(discarded * 0.7));
      discardG.innerHTML = h ? '<rect x="102" y="' + (426 - h) + '" width="78" height="' + h + '" rx="3" fill="#6a0e22" stroke="' + GOLD + '" stroke-width="1"/>' +
        '<rect x="102" y="' + (426 - h) + '" width="78" height="4" fill="#f4ecd8" opacity=".5"/>' : '';
    }
    function highlight(winner) {
      cards.forEach(function (c) {
        c.el.classList.toggle('tp-card--win', !!winner && (winner === c.side || winner === 'T'));
        c.el.classList.toggle('tp-card--lose', !!winner && winner !== 'T' && winner !== c.side);
      });
      ['A', 'B'].forEach(function (s) {
        spotEls[s].classList.toggle('tp-spot--win', !!winner && (winner === s || winner === 'T'));
      });
    }
    function label(side, text, state) {
      var l = labels[side];
      l.hidden = !text;
      if (l.textContent !== text) l.textContent = text || '';
      l.className = 'tp-label tp-label--' + side + (state ? ' tp-label--' + state : '');
    }

    // ---------------------------------------------------------------- chips
    var CHIP_CLASS = ['c1', 'c2', 'c3', 'c4', 'c5'];
    var chipValues = [0.1, 0.2, 0.5, 1, 2.5];
    function chipLabel(v) { return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2).replace(/^0\./, '.'); }
    function chipEl(v, parent) {
      var i = chipValues.indexOf(v);
      if (i < 0) { i = 0; for (var j = 0; j < chipValues.length; j++) if (chipValues[j] <= v + 1e-9) i = j; }
      var c = div('tp-chip tp-chip--' + CHIP_CLASS[i], parent);
      c.innerHTML = '<span>' + chipLabel(v) + '</span>';
      return c;
    }
    function decompose(amount) {
      var out = [], left = Math.round(amount * 100);
      for (var i = chipValues.length - 1; i >= 0 && out.length < 9; i--) {
        var c = Math.round(chipValues[i] * 100);
        while (left >= c && out.length < 9) { out.push(chipValues[i]); left -= c; }
      }
      if (left > 0 && out.length < 9) out.push(chipValues[0]);
      return out.reverse().sort(function (a, b) { return b - a; });
    }
    var stackEls = {}, stackKey = {};
    function stackAt(spot, pos, amount, cls, money) {
      var key = spot + ':' + amount + ':' + cls;
      if (stackKey[spot] === key) return;
      stackKey[spot] = key;
      if (stackEls[spot]) stackEls[spot].remove();
      if (!amount) { stackEls[spot] = null; return; }
      var st = div('tp-stack' + (cls ? ' ' + cls : ''), stacksLayer);
      st.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px)';
      decompose(amount).forEach(function (v, n) {
        var c = chipEl(v, st);
        c.style.transform = 'translate(-50%,-50%) translateY(' + (-n * 8) + 'px)';
      });
      var lab = div('tp-stack__amt', st);
      lab.textContent = money ? money(amount) : amount.toFixed(2);
      lab.style.transform = 'translate(-50%,0) translateY(' + (-Math.min(9, decompose(amount).length) * 8 - 58) + 'px)';
      stackEls[spot] = st;
    }
    function stacks(st, values, money) {
      if (values) chipValues = values.slice();
      ['A', 'B'].forEach(function (s) {
        var v = st[s] || { amount: 0 };
        stackAt(s, P.stack[s], v.amount || 0, v.pending ? 'tp-stack--pending' : '', money);
      });
    }
    function toDesign(pt) {
      var r = root.getBoundingClientRect(), k = r.width / DW;
      return { x: (pt.x - r.left) / k, y: (pt.y - r.top) / k };
    }
    function flyChip(spot, value, from) {
      var to = P.stack[spot], start = from ? toDesign(from) : { x: to.x, y: DH + 120 };
      var c = chipEl(value, fx);
      c.classList.add('tp-chip--fly');
      sound('chip');
      if (!c.animate || reduce) { c.remove(); return Promise.resolve(); }
      lookAt(P.spot[spot], 900);
      var mid = { x: (start.x + to.x) / 2, y: Math.min(start.y, to.y) - 110 };
      var a = c.animate([
        { transform: 'translate(' + start.x + 'px,' + start.y + 'px) translate(-50%,-50%) scale(1.5)', opacity: 0.4 },
        { transform: 'translate(' + mid.x + 'px,' + mid.y + 'px) translate(-50%,-50%) scale(1.25)', opacity: 1, offset: 0.55 },
        { transform: 'translate(' + to.x + 'px,' + (to.y - 30) + 'px) translate(-50%,-50%) scale(1)', opacity: 1 },
      ], { duration: 420, easing: 'cubic-bezier(.3,.7,.35,1)' });
      return a.finished.catch(function () {}).then(function () { c.remove(); sound('chipdown'); });
    }
    // chips that slide between two points (dealer pushes / sweeps)
    function slideStack(amount, from, to, ms, cls) {
      var st = div('tp-stack tp-stack--moving' + (cls ? ' ' + cls : ''), fx);
      decompose(amount).forEach(function (v, n) { chipEl(v, st).style.transform = 'translate(-50%,-50%) translateY(' + (-n * 8) + 'px)'; });
      if (!st.animate || reduce) { st.remove(); return Promise.resolve(); }
      var a = st.animate([
        { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(' + (from.s || 1) + ')', opacity: from.o == null ? 1 : from.o },
        { transform: 'translate(' + to.x + 'px,' + to.y + 'px) scale(' + (to.s || 1) + ')', opacity: to.o == null ? 1 : to.o },
      ], { duration: ms, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' });
      return a.finished.catch(function () {}).then(function () { return st; });
    }
    var OFF = function (spot) { return { x: P.stack[spot].x + (spot === 'A' ? -80 : 80), y: DH + 140, s: 1.6, o: 0 }; };
    // Settles my chips: list = [{ spot, kind, bet, back }] — both hands at once (A: right, B: left), losing chips
    // swept first. Queued after the dealing, before the next round's gathering. onStart(spot) as each begins.
    function settle(list, onStart) {
      var run = function () {
        return rFree.then(function () {
          return working(Promise.all(list.map(function (x) {
            return wait(x.kind === 'lose' ? 0 : 260).then(function () { if (onStart) onStart(x.spot); return pay(x.spot, x.kind, x.bet, x.back); });
          })));
        });
      };
      dealQ = dealQ.then(run, run);
      return dealQ;
    }
    function pay(spot, kind, bet, back) {
      var hk = spot === 'A' ? 'R' : 'L', pos = P.stack[spot], tray = { x: P.tray.x + (spot === 'A' ? -40 : 40), y: P.tray.y };
      stackKey[spot] = ''; if (stackEls[spot]) { stackEls[spot].remove(); stackEls[spot] = null; }
      lookAt(P.spot[spot], 1800);
      if (kind === 'lose') {
        var stl;
        return slideStack(bet, pos, pos, 1).then(function (s0) {
          stl = s0;
          return moveHand(hk, pos.x + (spot === 'A' ? 30 : -30), pos.y - 70, 380, 14);
        }).then(function () {
          sound('sweep');
          stl.remove();
          moveHand(hk, tray.x, tray.y + 10, 500, 4);
          return slideStack(bet, pos, { x: tray.x, y: tray.y + 6, s: 0.55, o: 0 }, 500);
        }).then(function (s1) { s1.remove(); restHand(hk, 420); });
      }
      // win: the dealer pushes the payout next to the bet, then the player collects both
      var pay = kind === 'win' ? Math.max(0, back - bet) : 0;
      var keep = kind === 'win' ? bet : back; // tie: half comes back
      var lostHalf = kind === 'half' ? Math.max(0, bet - back) : 0;
      var keepSt, paySt;
      return slideStack(keep, pos, pos, 1).then(function (s0) {
        keepSt = s0;
        if (lostHalf > 0) {
          return moveHand(hk, pos.x + (spot === 'A' ? 30 : -30), pos.y - 70, 380, 14).then(function () {
            sound('sweep');
            moveHand(hk, tray.x, tray.y + 10, 520, 4);
            return slideStack(lostHalf, { x: pos.x + (spot === 'A' ? -60 : 60), y: pos.y }, { x: tray.x, y: tray.y, s: 0.55, o: 0 }, 520);
          }).then(function (s) { s.remove(); });
        }
        if (pay <= 0) return null;
        return moveHand(hk, tray.x, tray.y + 6, 320, 10).then(function () {
          sound('chip');
          moveHand(hk, P.payout[spot].x + (spot === 'A' ? 26 : -26), P.payout[spot].y - 66, 540, 24);
          return slideStack(pay, { x: tray.x, y: tray.y + 10, s: 0.7 }, P.payout[spot], 540);
        }).then(function (s) { paySt = s; sound('chipdown'); return wait(140); });
      }).then(function () {
        moveHand(hk, P.spot[spot].x + (spot === 'A' ? 60 : -60), 610, 380, 20).then(function (ok) { if (ok) wait(260).then(function () { restHand(hk, 480); }); });
        return wait(680);
      }).then(function () {
        sound('collect');
        var moves = [slideStack(keep, pos, OFF(spot), 620)];
        keepSt.remove();
        if (paySt) { moves.push(slideStack(pay, P.payout[spot], OFF(spot), 680)); paySt.remove(); }
        return Promise.all(moves);
      }).then(function (list) { list.forEach(function (s) { s.remove(); }); });
    }

    // ---------------------------------------------------------------- gestures + reactions
    var busyGesture = false;
    function all(list) { return Promise.all(list).then(function (r) { return r.every(Boolean); }); }
    // a gesture is a chain of hand moves; it stops as soon as a real move (deal, payout) takes a hand over
    function chain(steps) {
      busyGesture = true;
      var p = Promise.resolve(true);
      steps.forEach(function (st) { p = p.then(function (ok) { return ok ? st() : false; }); });
      return p.then(function () { busyGesture = false; });
    }
    function gesture(kind) {
      if (busyGesture || busy) return;
      if (kind === 'A' || kind === 'B') { // open palm towards a side
        var k = kind === 'A' ? 'R' : 'L';
        chain([function () { return moveHand(k, P.spot[kind].x + (kind === 'A' ? 60 : -60), 620, 420, 20); },
          function () { return wait(380).then(function () { return true; }); },
          function () { restHand(k, 520); return true; }]);
      }
      if (kind === 'open') { // "place your bets": both hands open over the spots
        lookAt(CAMERA, 1600); express(0.75, 0.15, 0.25, 1400);
        chain([function () { return all([moveHand('R', 360, 600, 460, 30), moveHand('L', 640, 600, 460, 30)]); },
          function () { return wait(420).then(function () { return true; }); },
          function () { restHand('R', 520); restHand('L', 560); return true; }]);
      }
      if (kind === 'close') { // "no more bets": a flat wave across the table
        lookAt({ x: 500, y: 700 }, 1400); express(0.3, 0, 0.1, 1200);
        chain([function () { return moveHand('R', 300, 600, 340, 20); },
          function () { return moveHand('R', 640, 610, 460, 8); },
          function () { restHand('R', 420); return true; }]);
      }
    }
    function react(kind) {
      var now = performance.now();
      if (kind === 'win') { express(0.9, 0.25, 0.35, 1800, 3); face.nodAt = now; }
      if (kind === 'big') {
        express(1, 0.55, 0.8, 2600, 4); face.nodAt = now;
        sparkle(500, 250, 26);
        if (!busyGesture && !busy) { // a little clap
          chain([function () { return all([moveHand('R', 468, 334, 300, 30), moveHand('L', 532, 334, 300, 30)]); },
            function () { sound('clap'); return all([moveHand('R', 490, 344, 110, 0), moveHand('L', 510, 344, 110, 0)]); },
            function () { return all([moveHand('R', 466, 334, 120, 0), moveHand('L', 534, 334, 120, 0)]); },
            function () { sound('clap'); return all([moveHand('R', 490, 344, 110, 0), moveHand('L', 510, 344, 110, 0)]); },
            function () { return wait(260).then(function () { return true; }); },
            function () { restHand('R', 520); restHand('L', 520); return true; }]);
        }
      }
      if (kind === 'wow') { express(0.1, 0.5, 0.9, 1300); }
      if (kind === 'tie') { express(0.5, 0.2, 0.6, 1500, -4); }
      if (kind === 'lose') { express(0.35, 0, -0.2, 1300, -2); }
    }
    function sparkle(x, y, n) {
      if (reduce) return;
      for (var i = 0; i < n; i++) {
        var sp = div('tp-spark', fx), a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 220;
        sp.style.left = x + 'px'; sp.style.top = y + 'px';
        if (sp.animate) sp.animate([
          { transform: 'translate(-50%,-50%) scale(.2) rotate(0deg)', opacity: 1 },
          { transform: 'translate(' + (Math.cos(a) * d - 50) + '%,' + (Math.sin(a) * d * 0.7 - 50) + '%) scale(' + (0.6 + Math.random()) + ') rotate(' + (Math.random() * 360) + 'deg)', opacity: 0 },
        ], { duration: 900 + Math.random() * 700, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
        (function (s) { setTimeout(function () { s.remove(); }, 1700); })(sp);
      }
    }
    function sparkleSpot(spot) {
      var c = P.spot[spot];
      for (var i = 0; i < 3; i++) setTimeout(function () { sparkle(c.x + (Math.random() - 0.5) * 300, c.y + (Math.random() - 0.5) * 80, 8); }, i * 220);
    }

    // ---------------------------------------------------------------- texts on the table
    function phrase(t) { if (phraseEl.textContent !== t) phraseEl.textContent = t; phraseEl.hidden = !t; }
    function banner(title, sub, side) {
      if (!title) { bannerEl.hidden = true; return; }
      bannerEl.className = 'tp-banner tp-banner--' + (side || 'T');
      bannerEl.firstChild.textContent = title;
      bannerEl.lastChild.textContent = sub ? ' · ' + sub : '';
      bannerEl.hidden = false;
      phrase('');
    }
    var tInfo = { mode: 'vs' };
    function timer(info) { tInfo = info; }
    function drawMedal(now) {
      var t = tInfo, txt = 'VS', sub = '', frac = 0, colour = '#e8b84a';
      if (t.mode === 'betting') {
        var left = Math.max(0, t.endsAt - Date.now());
        frac = clamp(left / t.total, 0, 1);
        txt = String(Math.ceil(left / 1000));
        sub = 'BETS';
        colour = frac > 0.5 ? '#3fe07a' : frac > 0.22 ? '#ffc23f' : '#ff4d3a';
      } else if (t.mode === 'winner') { txt = t.text; sub = t.sub || ''; frac = 1; colour = t.colour; }
      else if (t.mode === 'pause') { frac = 0.22; sub = 'NEXT'; colour = '#e8b84a'; }
      var spin = t.mode === 'pause' ? 'rotate(' + Math.round((now / 4) % 360 - 90) + ' 70 70)' : 'rotate(-90 70 70)';
      if (medalRing.getAttribute('transform') !== spin) medalRing.setAttribute('transform', spin);
      var off = (326.7 * (1 - frac)).toFixed(1);
      if (medalRing.getAttribute('stroke-dashoffset') !== off) medalRing.setAttribute('stroke-dashoffset', off);
      if (medalRing.getAttribute('stroke') !== colour) medalRing.setAttribute('stroke', colour);
      if (medalTxt.textContent !== txt) medalTxt.textContent = txt;
      if (medalSub.textContent !== sub) medalSub.textContent = sub;
      medal.classList.toggle('tp-medal--urgent', t.mode === 'betting' && frac < 0.22 && frac > 0);
    }
    var spotHandler = function () {};
    ['A', 'B'].forEach(function (s) {
      var go = function (e) { e.preventDefault(); spotHandler(s, e); };
      spotEls[s].addEventListener('click', go);
      spotEls[s].addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') go(e); });
    });
    function spot(side, info) {
      spotEls[side].classList.toggle('tp-spot--open', !!info.open);
      if (spotInfo[side].textContent !== info.text) spotInfo[side].textContent = info.text || '';
    }

    // ---------------------------------------------------------------- the hall (canvas)
    var ctx = canvas.getContext('2d'), cache = document.createElement('canvas'), cctx = cache.getContext('2d');
    var L = { fullW: 1, fullH: 1, s: 1, ox: 0, oy: 0, dpr: 1 };
    var bokeh = [];
    for (var bi = 0; bi < 34; bi++) bokeh.push({ x: Math.random(), y: Math.random(), r: 6 + Math.random() * 20, v: 4 + Math.random() * 10, a: 0.04 + Math.random() * 0.1, p: Math.random() * 6, hue: Math.random() < 0.5 ? '255,190,110' : '255,150,90' });
    function bounds() {
      return { x0: -L.ox / L.s, x1: (L.fullW - L.ox) / L.s, y0: -L.oy / L.s, y1: (L.fullH - L.oy) / L.s };
    }
    function layout(o) {
      var dpr = Math.min(window.devicePixelRatio || 1, o.fullW * o.fullH > 1100000 ? 1.25 : 2);
      var s = Math.min(o.w / DW, o.h / DH, 1.2);
      var ox = o.left + (o.w - DW * s) / 2, oy = o.top + Math.max(0, (o.h - DH * s) / 2);
      L = { fullW: o.fullW, fullH: o.fullH, s: s, ox: ox, oy: oy, dpr: dpr };
      root.style.transform = 'translate(' + f1(ox) + 'px,' + f1(oy) + 'px) scale(' + s.toFixed(4) + ')';
      var cw = Math.round(o.fullW * dpr), ch = Math.round(o.fullH * dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      cache.width = cw; cache.height = ch;
      cctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
      drawHall(cctx, bounds());
      return { scale: s, ox: ox, oy: oy, bottom: oy + DH * s };
    }
    function archPts(cx, spring, hw, apex, n) {
      var pts = [];
      for (var i = 0; i <= n; i++) {
        var t = i / n, side = t < 0.5 ? -1 : 1, u = t < 0.5 ? t * 2 : (1 - t) * 2; // u: 0 spring → 1 apex
        var a = u * Math.PI / 2;
        var x = cx + side * hw * Math.cos(a) * (1 - 0.12 * Math.sin(a));
        var y = spring - (spring - apex) * Math.pow(Math.sin(a), 1.25);
        pts.push([x, y]);
      }
      return pts;
    }
    function cusped(c, pts, depth) {
      c.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        c.quadraticCurveTo(mx + dy / len * depth, my - dx / len * depth, b[0], b[1]);
      }
    }
    function archShape(c, cx, spring, hw, apex, floor, scallop) {
      var pts = archPts(cx, spring, hw, apex, scallop ? 11 : 24);
      c.beginPath();
      c.moveTo(cx - hw, floor); c.lineTo(pts[0][0], pts[0][1]);
      if (scallop) cusped(c, pts, scallop); else pts.forEach(function (p) { c.lineTo(p[0], p[1]); });
      c.lineTo(cx + hw, floor); c.closePath();
    }
    function drawHall(c, b) {
      c.save();
      var g = c.createLinearGradient(0, b.y0, 0, 400);
      g.addColorStop(0, '#1e060c'); g.addColorStop(0.5, '#3e0e1a'); g.addColorStop(1, '#5e1b25');
      c.fillStyle = g; c.fillRect(b.x0 - 2, b.y0 - 2, b.x1 - b.x0 + 4, b.y1 - b.y0 + 4);
      var w = c.createRadialGradient(500, 210, 30, 500, 210, 640);
      w.addColorStop(0, 'rgba(255,176,96,.30)'); w.addColorStop(1, 'rgba(255,176,96,0)');
      c.fillStyle = w; c.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      // side arches with lamp-lit windows
      for (var k = -7; k <= 7; k++) {
        if (!k) continue;
        var cx = 500 + k * 470;
        if (cx + 260 < b.x0 || cx - 260 > b.x1) continue;
        archShape(c, cx, 150, 150, -50, 360, 0);
        var wg = c.createLinearGradient(0, -50, 0, 360);
        wg.addColorStop(0, '#ffb35c'); wg.addColorStop(0.55, '#c8582c'); wg.addColorStop(1, '#5a1a14');
        c.fillStyle = wg; c.fill();
        // lattice (jali)
        c.save(); c.clip();
        c.strokeStyle = 'rgba(60,14,10,.55)'; c.lineWidth = 3;
        for (var jx = cx - 160; jx < cx + 160; jx += 26) { c.beginPath(); c.moveTo(jx, -60); c.lineTo(jx + 220, 380); c.stroke(); c.beginPath(); c.moveTo(jx + 26, -60); c.lineTo(jx - 194, 380); c.stroke(); }
        c.restore();
        archShape(c, cx, 150, 150, -50, 360, 0);
        c.strokeStyle = '#d8a548'; c.lineWidth = 7; c.stroke();
        archShape(c, cx, 150, 168, -76, 360, 0);
        c.strokeStyle = 'rgba(232,184,74,.45)'; c.lineWidth = 3; c.stroke();
      }
      // pillars between the arches
      for (var q = -8; q <= 7; q++) {
        var px = 500 + 235 + q * 470;
        if (px + 60 < b.x0 || px - 60 > b.x1) continue;
        var pg = c.createLinearGradient(px - 26, 0, px + 26, 0);
        pg.addColorStop(0, '#3a0d16'); pg.addColorStop(0.5, '#7a2a30'); pg.addColorStop(1, '#2a0810');
        c.fillStyle = pg; c.fillRect(px - 24, 120, 48, 260);
        c.fillStyle = '#d8a548'; c.fillRect(px - 34, 112, 68, 12); c.fillRect(px - 30, 124, 60, 5); c.fillRect(px - 34, 330, 68, 10);
        c.strokeStyle = 'rgba(232,184,74,.35)'; c.lineWidth = 2;
        for (var fl = -14; fl <= 14; fl += 9) { c.beginPath(); c.moveTo(px + fl, 132); c.lineTo(px + fl, 326); c.stroke(); }
      }
      // the grand arch behind the dealer
      archShape(c, 500, 130, 232, -170, 372, 9);
      var ig = c.createLinearGradient(0, -170, 0, 372);
      ig.addColorStop(0, '#2a0812'); ig.addColorStop(0.6, '#4a1220'); ig.addColorStop(1, '#6a2228');
      c.fillStyle = ig; c.fill();
      c.save(); c.clip();
      var glow = c.createRadialGradient(500, 120, 10, 500, 120, 300);
      glow.addColorStop(0, 'rgba(255,190,110,.42)'); glow.addColorStop(1, 'rgba(255,190,110,0)');
      c.fillStyle = glow; c.fillRect(260, -180, 480, 560);
      c.strokeStyle = 'rgba(232,184,74,.18)'; c.lineWidth = 2;
      for (var ry = -150; ry < 372; ry += 34) for (var rx = 270 + ((ry / 34) % 2 ? 17 : 0); rx < 740; rx += 34) {
        c.beginPath(); c.moveTo(rx, ry - 12); c.lineTo(rx + 12, ry); c.lineTo(rx, ry + 12); c.lineTo(rx - 12, ry); c.closePath(); c.stroke();
      }
      c.restore();
      archShape(c, 500, 130, 232, -170, 372, 9);
      c.strokeStyle = '#e8b84a'; c.lineWidth = 8; c.stroke();
      archShape(c, 500, 130, 256, -200, 372, 0);
      c.strokeStyle = 'rgba(232,184,74,.55)'; c.lineWidth = 4; c.stroke();
      // frieze along the top
      c.fillStyle = '#2a0810'; c.fillRect(b.x0, -260, b.x1 - b.x0, 70);
      c.fillStyle = '#d8a548'; c.fillRect(b.x0, -192, b.x1 - b.x0, 5); c.fillRect(b.x0, -262, b.x1 - b.x0, 4);
      c.fillStyle = 'rgba(232,184,74,.55)';
      for (var dx = Math.floor((b.x0 - 500) / 40) * 40 + 500; dx < b.x1 + 40; dx += 40) {
        c.beginPath(); c.moveTo(dx, -246); c.lineTo(dx + 12, -226); c.lineTo(dx, -206); c.lineTo(dx - 12, -226); c.closePath(); c.fill();
      }
      // marigold garlands (toran)
      for (var gk = -9; gk <= 8; gk++) {
        var gx0 = 500 + gk * 235, gx1 = gx0 + 235;
        if (gx1 < b.x0 - 40 || gx0 > b.x1 + 40) continue;
        for (var t = 0; t <= 1.0001; t += 1 / 16) {
          var gx = lerp(gx0, gx1, t), gy = -186 + Math.sin(t * Math.PI) * 58;
          c.fillStyle = (Math.round(t * 16) % 2) ? '#ffb21a' : '#ff7a12';
          c.beginPath(); c.arc(gx, gy, 9, 0, Math.PI * 2); c.fill();
          c.fillStyle = 'rgba(120,40,0,.35)'; c.beginPath(); c.arc(gx + 2, gy + 2, 3, 0, Math.PI * 2); c.fill();
        }
        for (var tt = 0; tt < 5; tt++) { // hanging string at each joint
          c.fillStyle = tt % 2 ? '#ffb21a' : '#ff7a12';
          c.beginPath(); c.arc(gx0, -176 + tt * 17, 8, 0, Math.PI * 2); c.fill();
        }
        c.fillStyle = '#2f7a2a';
        c.beginPath(); c.moveTo(gx0, -96); c.quadraticCurveTo(gx0 + 12, -80, gx0, -62); c.quadraticCurveTo(gx0 - 12, -80, gx0, -96); c.fill();
      }
      // lamp ledge behind the table
      c.fillStyle = '#2a0b0e'; c.fillRect(b.x0, 334, b.x1 - b.x0, 40);
      c.fillStyle = '#d8a548'; c.fillRect(b.x0, 332, b.x1 - b.x0, 4);
      // lantern chains + bodies
      LANTERNS.forEach(function (lx) {
        if (lx < b.x0 - 80 || lx > b.x1 + 80) return;
        c.strokeStyle = '#8a6a2a'; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(lx, -190); c.lineTo(lx, -10); c.stroke();
        c.fillStyle = '#b8862e';
        c.beginPath(); c.moveTo(lx - 22, 0); c.quadraticCurveTo(lx, -34, lx + 22, 0); c.closePath(); c.fill();
        c.fillStyle = '#5a3a10'; c.fillRect(lx - 20, 0, 40, 46);
        c.fillStyle = '#ffd27a';
        for (var wy = 6; wy < 42; wy += 12) for (var wx = -14; wx <= 10; wx += 12) c.fillRect(lx + wx, wy, 6, 8);
        c.fillStyle = '#b8862e';
        c.beginPath(); c.moveTo(lx - 22, 46); c.lineTo(lx + 22, 46); c.lineTo(lx, 70); c.closePath(); c.fill();
        c.beginPath(); c.arc(lx, 76, 4, 0, Math.PI * 2); c.fill();
      });
      DIYAS.forEach(function (dx2) {
        if (dx2 < b.x0 - 30 || dx2 > b.x1 + 30) return;
        c.fillStyle = '#a3471c';
        c.beginPath(); c.moveTo(dx2 - 15, 324); c.quadraticCurveTo(dx2, 342, dx2 + 15, 324); c.closePath(); c.fill();
        c.fillStyle = '#e07a34'; c.fillRect(dx2 - 15, 322, 30, 3);
      });
      c.restore();
    }
    var LANTERNS = [], DIYAS = [];
    for (var li = -6; li <= 6; li++) if (li) LANTERNS.push(500 + li * 235);
    for (var di = -30; di <= 30; di++) { var dxx = 500 + di * 58; if (Math.abs(dxx - 500) > 170) DIYAS.push(dxx); }
    function flick(now, seed) { return 0.82 + 0.1 * Math.sin(now / 90 + seed * 7) + 0.08 * Math.sin(now / 37 + seed * 3); }
    function drawHallLive(now) {
      var dpr = L.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cache, 0, 0);
      ctx.setTransform(dpr * L.s, 0, 0, dpr * L.s, dpr * L.ox, dpr * L.oy);
      var b = bounds();
      ctx.globalCompositeOperation = 'lighter';
      LANTERNS.forEach(function (lx, n) {
        if (lx < b.x0 - 150 || lx > b.x1 + 150) return;
        var f = flick(now, n), gr = ctx.createRadialGradient(lx, 24, 4, lx, 24, 150 * f);
        gr.addColorStop(0, 'rgba(255,200,110,' + (0.5 * f).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = gr; ctx.fillRect(lx - 160, -130, 320, 320);
      });
      DIYAS.forEach(function (dx2, n) {
        if (dx2 < b.x0 - 40 || dx2 > b.x1 + 40) return;
        var f = flick(now, n + 20), gr = ctx.createRadialGradient(dx2, 312, 1, dx2, 312, 46 * f);
        gr.addColorStop(0, 'rgba(255,190,90,' + (0.55 * f).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = gr; ctx.fillRect(dx2 - 50, 262, 100, 100);
      });
      ctx.globalCompositeOperation = 'source-over';
      DIYAS.forEach(function (dx2, n) { // flames
        if (dx2 < b.x0 - 20 || dx2 > b.x1 + 20) return;
        var f = flick(now, n + 40), sway = Math.sin(now / 160 + n) * 1.6, hgt = 15 * f;
        ctx.fillStyle = '#ffb030';
        ctx.beginPath(); ctx.moveTo(dx2 - 5, 322); ctx.quadraticCurveTo(dx2 - 6 + sway, 316 - hgt * 0.5, dx2 + sway * 1.6, 320 - hgt); ctx.quadraticCurveTo(dx2 + 6 + sway, 316 - hgt * 0.5, dx2 + 5, 322); ctx.fill();
        ctx.fillStyle = '#fff4c8';
        ctx.beginPath(); ctx.ellipse(dx2 + sway * 0.6, 318, 2.4, 4.5 * f, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalCompositeOperation = 'lighter';
      bokeh.forEach(function (p) {
        var span = b.y1 - b.y0, y = b.y1 - (((p.y * span + now / 1000 * p.v) % span) + span) % span;
        var x = b.x0 + p.x * (b.x1 - b.x0) + Math.sin(now / 2400 + p.p) * 16;
        if (y > 380) return;
        ctx.fillStyle = 'rgba(' + p.hue + ',' + (p.a * (0.7 + 0.3 * Math.sin(now / 900 + p.p))).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---------------------------------------------------------------- per-frame dealer
    function ik(k, S0, T) {
      var dx = T.x - S0.x, dy = T.y - S0.y, d = Math.hypot(dx, dy) || 1;
      var reach = UPPER + FORE, st = d > reach * 0.98 ? d / (reach * 0.98) : 1;
      var a = UPPER * st, b = FORE * st, dd = Math.min(d, (a + b) * 0.999);
      var cosA = clamp((a * a + dd * dd - b * b) / (2 * a * dd), -1, 1), A = Math.acos(cosA);
      var base = Math.atan2(dy, dx), sign = k === 'R' ? 1 : -1; // elbows bend outwards
      var ang = base + sign * A;
      return { x: S0.x + Math.cos(ang) * a, y: S0.y + Math.sin(ang) * a };
    }
    function setLine(l, x1, y1, x2, y2) {
      l.setAttribute('x1', f1(x1)); l.setAttribute('y1', f1(y1)); l.setAttribute('x2', f1(x2)); l.setAttribute('y2', f1(y2));
    }
    function drawArm(k, sh, now) {
      var h = hands[k], e = armEl[k];
      var E = ik(k, sh, h);
      var fx2 = h.x - E.x, fy2 = h.y - E.y, fl = Math.hypot(fx2, fy2) || 1, ux = fx2 / fl, uy = fy2 / fl;
      var wrist = { x: h.x - ux * 4, y: h.y - uy * 4 };
      setLine(e.ou, sh.x, sh.y, E.x, E.y);
      setLine(e.slu, sh.x, sh.y, E.x, E.y);
      setLine(e.of, E.x, E.y, wrist.x, wrist.y);
      setLine(e.sf, E.x, E.y, wrist.x, wrist.y);
      setLine(e.hf, E.x + ux * fl * 0.45 - uy * 6, E.y + uy * fl * 0.45 + ux * 6, wrist.x - ux * 14 - uy * 6, wrist.y - uy * 14 + ux * 6);
      var cx = E.x + ux * fl * 0.38, cy = E.y + uy * fl * 0.38;
      setLine(e.slf, E.x, E.y, cx, cy);
      setLine(e.cuff, cx - uy * 19, cy + ux * 19, cx + uy * 19, cy - ux * 19);
      // the hand turns towards the table centre (fingers inwards) instead of only following the forearm
      var ang = Math.atan2(uy, ux) * 180 / Math.PI, rest = k === 'R' ? 15 : 165;
      var diff = ((rest - ang + 540) % 360) - 180;
      ang += diff * 0.45;
      var sc = clamp(1 + (h.y - 430) / 900, 0.95, 1.32);
      e.hand.setAttribute('transform', 'translate(' + f1(h.x) + ' ' + f1(h.y) + ') rotate(' + f1(ang) + ') scale(' + sc.toFixed(3) + ')');
      var curl = h.curlNow = lerp(h.curlNow || 0, h.curl, 0.25);
      e.fingers.setAttribute('transform', 'translate(34 0) scale(' + (1 - curl * 0.3).toFixed(3) + ' 1) translate(-34 0)');
    }
    function stepTweens(now) {
      ['R', 'L'].forEach(function (k) {
        var h = hands[k], tw = h.tw;
        if (!tw) return;
        var p = clamp((now - tw.t0) / tw.ms, 0, 1), e2 = ease(p);
        h.x = lerp(tw.fx, tw.tx, e2);
        h.y = lerp(tw.fy, tw.ty, e2) - Math.sin(p * Math.PI) * tw.lift;
        if (p >= 1) { h.tw = null; tw.resolve(true); }
      });
    }
    function idle(now) {
      if (now > face.lookUntil) {
        var r = Math.random();
        var pts = [CAMERA, CAMERA, P.spot.A, P.spot.B, P.medal, { x: 300, y: 510 }, { x: 700, y: 510 }];
        lookAt(pts[Math.floor(r * pts.length)], 1600 + Math.random() * 2600);
      }
      if (now > expr.until) { face.tSmile = 0.42; face.tOpen = 0; face.tBrow = 0; face.tTilt = 0; }
      if (now > face.nextBlink) {
        face.blinkAt = now;
        face.nextBlink = now + 2200 + Math.random() * 3200 + (Math.random() < 0.18 ? -1900 : 0);
      }
    }
    function drawDealer(now, dt) {
      idle(now);
      var kf = 1 - Math.exp(-dt / 140), kf2 = 1 - Math.exp(-dt / 220);
      face.yaw = lerp(face.yaw, face.tYaw, kf); face.pitch = lerp(face.pitch, face.tPitch, kf);
      face.smile = lerp(face.smile, face.tSmile, kf2); face.open = lerp(face.open, face.tOpen, kf2);
      face.brow = lerp(face.brow, face.tBrow, kf2); face.tilt = lerp(face.tilt, face.tTilt, kf2);
      var breath = Math.sin(now / 4400 * Math.PI * 2);
      // lean towards a far-reaching hand
      var reachR = Math.max(0, hands.R.y - 450), reachL = Math.max(0, hands.L.y - 450);
      var leanY = Math.min(44, Math.max(reachR, reachL) * 0.2), leanX = clamp((hands.R.x + hands.L.x - 1000) * 0.04, -18, 18);
      var by = breath * 1.6 + leanY, bx = leanX;
      dealer.body.setAttribute('transform', 'translate(' + f1(bx) + ' ' + f1(by) + ') translate(500 440) scale(' + (1 + breath * 0.004).toFixed(4) + ' ' + (1 + breath * 0.006).toFixed(4) + ') translate(-500 -440)');
      dealer.drape.setAttribute('transform', 'translate(' + f1(bx) + ' ' + f1(by) + ')');
      var nodP = clamp((now - face.nodAt) / 700, 0, 1), nod = face.nodAt && nodP < 1 ? Math.sin(nodP * Math.PI * 2) * 4 : 0;
      var hy = breath * 2 + leanY * 1.1 + face.pitch * 6 + nod, hx = bx * 1.2 + face.yaw * 6;
      var rot = face.yaw * 4 + face.tilt + leanX * 0.12;
      dealer.head.setAttribute('transform', 'translate(' + f1(hx) + ' ' + f1(hy) + ') rotate(' + f1(rot) + ' 500 250)');
      dealer.feat.setAttribute('transform', 'translate(' + f1(face.yaw * 10) + ' ' + f1(face.pitch * 5) + ')');
      dealer.brows.setAttribute('transform', 'translate(0 ' + f1(-face.brow * 6 + face.pitch * 1.5) + ')');
      var ix = face.yaw * 4.5, iy = face.pitch * 3.4;
      dealer.irisL.setAttribute('transform', 'translate(' + f1(ix) + ' ' + f1(iy) + ')');
      dealer.irisR.setAttribute('transform', 'translate(' + f1(ix) + ' ' + f1(iy) + ')');
      var bp = (now - face.blinkAt) / 150, blink = bp >= 0 && bp < 1 ? 1 - Math.sin(bp * Math.PI) * 0.92 : 1;
      var squint = 1 - face.smile * 0.14 + face.brow * 0.1 - Math.max(0, face.pitch) * 0.1;
      var sy = clamp(blink * squint, 0.06, 1.15);
      dealer.eyeL.setAttribute('transform', 'translate(0 172) scale(1 ' + sy.toFixed(3) + ') translate(0 -172)');
      dealer.eyeR.setAttribute('transform', 'translate(0 172) scale(1 ' + sy.toFixed(3) + ') translate(0 -172)');
      var ly = (1 - sy) * 10;
      dealer.lashL.setAttribute('transform', 'translate(0 ' + f1(ly) + ')');
      dealer.lashR.setAttribute('transform', 'translate(0 ' + f1(ly) + ')');
      mouth(face.smile, face.open);
      // earrings swing with the head
      var yv = (face.yaw - face.lastYaw) / Math.max(1, dt) * 1000; face.lastYaw = face.yaw;
      var e = face.ear; e.v += (-e.a * 0.02 - e.v * 0.12 - yv * 0.6) * (dt / 16); e.a += e.v * (dt / 16) * 0.5; e.a = clamp(e.a, -24, 24);
      dealer.earL.setAttribute('transform', 'rotate(' + f1(e.a - rot * 0.6) + ' 578 194)');
      dealer.earR.setAttribute('transform', 'rotate(' + f1(e.a - rot * 0.6) + ' 422 194)');
      // arms
      var shR = { x: P.shoulder.R.x + bx, y: P.shoulder.R.y + by }, shL = { x: P.shoulder.L.x + bx, y: P.shoulder.L.y + by };
      drawArm('R', shR, now); drawArm('L', shL, now);
    }
    function mouth(s, o) {
      var cx = 500, cy = 224, cw = 19 + s * 3, cyc = cy - s * 4.5;
      var mid = cy + 2 + s * 3.5, low = mid + 3 + o * 13;
      var up = 'M' + f1(cx - cw) + ' ' + f1(cyc) + ' Q' + f1(cx - 10) + ' ' + f1(cy - 7) + ' ' + cx + ' ' + f1(cy - 3.5) + ' Q' + f1(cx + 10) + ' ' + f1(cy - 7) + ' ' + f1(cx + cw) + ' ' + f1(cyc) +
        ' Q' + cx + ' ' + f1(mid + 1) + ' ' + f1(cx - cw) + ' ' + f1(cyc) + ' Z';
      dealer.lipU.setAttribute('d', up);
      if (o > 0.04) {
        dealer.mouthIn.setAttribute('d', 'M' + f1(cx - cw + 2) + ' ' + f1(cyc + 0.5) + ' Q' + cx + ' ' + f1(mid + 1) + ' ' + f1(cx + cw - 2) + ' ' + f1(cyc + 0.5) + ' Q' + cx + ' ' + f1(low + 2) + ' ' + f1(cx - cw + 2) + ' ' + f1(cyc + 0.5) + ' Z');
        dealer.teeth.setAttribute('d', 'M' + f1(cx - cw * 0.7) + ' ' + f1(cyc + 2) + ' Q' + cx + ' ' + f1(mid + 2.5) + ' ' + f1(cx + cw * 0.7) + ' ' + f1(cyc + 2) + ' L' + f1(cx + cw * 0.6) + ' ' + f1(cyc + 2 + 3.5 * o) + ' Q' + cx + ' ' + f1(mid + 2 + 4.5 * o) + ' ' + f1(cx - cw * 0.6) + ' ' + f1(cyc + 2 + 3.5 * o) + ' Z');
      } else { dealer.mouthIn.setAttribute('d', ''); dealer.teeth.setAttribute('d', ''); }
      dealer.lipD.setAttribute('d', 'M' + f1(cx - cw + 1) + ' ' + f1(cyc + 0.8) + ' Q' + cx + ' ' + f1(low + 1) + ' ' + f1(cx + cw - 1) + ' ' + f1(cyc + 0.8) + ' Q' + cx + ' ' + f1(low + 10 - s * 1.5) + ' ' + f1(cx - cw + 1) + ' ' + f1(cyc + 0.8) + ' Z');
    }

    // ---------------------------------------------------------------- loop
    var last = performance.now(), frameCb = null;
    function frame(now) {
      var dt = Math.min(64, now - last); last = now;
      stepTweens(now);
      updateFollowers(now);
      drawDealer(now, dt);
      drawMedal(now);
      drawHallLive(now);
      if (frameCb) frameCb(now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      layout: layout,
      deal: deal,
      dealsIdle: function () { return dealQ.then(function () { return rFree; }); },
      hurry: function () { if (backlog > 0) hurry = true; },
      collect: collect,
      highlight: highlight,
      label: label,
      stacks: stacks,
      flyChip: flyChip,
      settle: settle,
      sparkleSpot: sparkleSpot,
      timer: timer,
      phrase: phrase,
      banner: banner,
      react: react,
      gesture: gesture,
      look: function (target, ms) { lookAt(P[target] || P.spot[target] || target, ms); },
      onSpot: function (fn) { spotHandler = fn; },
      spot: spot,
      onFrame: function (fn) { frameCb = fn; },
      cardCount: function () { return cards.length; },
    };
  }

  window.TPScene = { create: create };
})();
