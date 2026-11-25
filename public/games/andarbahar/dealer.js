/* Andar Bahar — the dealer: an original character drawn in SVG from layered parts (body + head
 * behind the felt, arms + hands in front of it). She breathes, blinks, looks where the action
 * is, and her hands move with every deal, flip, chip push and sweep (two-bone IK per arm).
 *
 *   var d = ABDealer.create(bodySvg, armsSvg);  // both use the table's 800 × 760 units
 *   d.gesture('deal' | 'dealQuick', {x, y}) → ms until the card leaves her hand · 'joker' · 'push' {x, y}
 *   · 'collect' {x, y} · 'close' · 'welcome' · 'clap' · 'sweep'
 *   d.look({x, y} | null (the player), ms) · d.react('happy' | 'wow' | 'nod' | 'talk')
 *   d.update(now) — once per animation frame
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var SKIN = '#c68456', SKIN_D = '#a86a40', HAIR = '#1b0d0b', GOLD = '#f3c35b', GOLD_D = '#b8862b';
  var SHOE = { x: 612, y: 366 }, TRAY = { x: 238, y: 338 }, DISCARD = { x: 96, y: 362 };
  var L1 = 98, L2 = 96; // upper arm, forearm

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(u) { return u * u * (3 - 2 * u); }

  function buildBody(svg) {
    svg.innerHTML =
      '<defs>' +
      '<radialGradient id="dGlow" cx="0.5" cy="0.62" r="0.62"><stop offset="0" stop-color="#ffcf7a" stop-opacity="0.95"/><stop offset="0.45" stop-color="#f07a3a" stop-opacity="0.75"/><stop offset="1" stop-color="#8a1f5a" stop-opacity="0.9"/></radialGradient>' +
      '<linearGradient id="dPillar" x1="0" x2="1"><stop offset="0" stop-color="#5a1236"/><stop offset="0.5" stop-color="#9a2a5c"/><stop offset="1" stop-color="#4a0f2e"/></linearGradient>' +
      '<linearGradient id="dBlouse" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c81f74"/><stop offset="1" stop-color="#6e0b41"/></linearGradient>' +
      '<linearGradient id="dDup" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffbe4a"/><stop offset="1" stop-color="#e2700a"/></linearGradient>' +
      '<radialGradient id="dFace" cx="0.42" cy="0.38" r="0.75"><stop offset="0" stop-color="#e0a676"/><stop offset="0.6" stop-color="' + SKIN + '"/><stop offset="1" stop-color="#a5663d"/></radialGradient>' +
      '<linearGradient id="dHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2019"/><stop offset="1" stop-color="' + HAIR + '"/></linearGradient>' +
      '<clipPath id="dEyeClip"><path d="M-12 0Q0-8.6 12 0Q0 7.4-12 0Z"/></clipPath>' +
      '</defs>' +
      // the carved arch (jharokha) behind her, with a warm lamp glow
      '<g id="dArch">' +
      '<path d="M226 306V154Q226 78 318 46Q376 28 400 2Q424 28 482 46Q574 78 574 154V306Z" fill="url(#dGlow)" stroke="' + GOLD + '" stroke-width="6"/>' +
      '<path d="M244 306V160Q244 94 326 64Q378 46 400 24Q422 46 474 64Q556 94 556 160V306" fill="none" stroke="' + GOLD + '" stroke-width="2" opacity="0.55"/>' +
      '<rect x="206" y="150" width="26" height="156" fill="url(#dPillar)" stroke="' + GOLD_D + '" stroke-width="2"/>' +
      '<rect x="568" y="150" width="26" height="156" fill="url(#dPillar)" stroke="' + GOLD_D + '" stroke-width="2"/>' +
      '<rect x="200" y="140" width="38" height="14" rx="3" fill="' + GOLD + '"/><rect x="562" y="140" width="38" height="14" rx="3" fill="' + GOLD + '"/>' +
      '<g fill="' + GOLD + '" opacity="0.75">' + dots(400, 0) + '</g>' +
      '</g>' +
      '<g id="dBodyG">' +
      '<g id="dTorso">' +
      '<path d="M384 172V216Q400 230 416 216V172Z" fill="#b5754a"/>' +
      '<path d="M258 372C258 300 272 262 318 246L372 228Q400 250 428 228L482 246C528 262 542 300 542 372Z" fill="url(#dBlouse)"/>' +
      '<path d="M372 228Q400 270 428 228Z" fill="#bf7d50"/>' +
      '<path d="M372 228Q400 270 428 228" fill="none" stroke="' + GOLD + '" stroke-width="7" stroke-linejoin="round"/>' +
      '<path d="M372 228Q400 270 428 228" fill="none" stroke="#fff3c4" stroke-width="2.4" stroke-dasharray="0.1 6" stroke-linecap="round"/>' +
      '<path d="M381 230Q400 256 419 230" fill="none" stroke="' + GOLD + '" stroke-width="2.4"/>' +
      '<path d="M400 252l-5 7 5 8 5-8z" fill="#d81b4a" stroke="' + GOLD + '" stroke-width="1.6"/>' +
      '<path d="M296 252C328 240 352 254 374 276L492 372H450L352 290C334 276 316 270 292 272Z" fill="url(#dDup)"/>' +
      '<path d="M296 252C328 240 352 254 374 276L492 372" fill="none" stroke="' + GOLD + '" stroke-width="3.5"/>' +
      '<path d="M292 272C316 270 334 276 352 290L450 372" fill="none" stroke="#a54a06" stroke-width="2"/>' +
      '<g fill="#fff0b8" opacity="0.85"><circle cx="340" cy="272" r="2.4"/><circle cx="372" cy="296" r="2.4"/><circle cx="404" cy="322" r="2.4"/><circle cx="436" cy="348" r="2.4"/></g>' +
      '<rect x="448" y="282" width="34" height="14" rx="4" fill="' + GOLD + '" stroke="' + GOLD_D + '"/>' +
      '<text x="465" y="293" font-family="Georgia,serif" font-size="10" font-weight="700" fill="#5a1036" text-anchor="middle">NX</text>' +
      '</g>' +
      '<g id="dHead">' +
      '<circle cx="360" cy="68" r="23" fill="url(#dHair)"/>' +
      '<g fill="#fffaf0" stroke="#e8dcb8" stroke-width="0.8">' + gajra() + '</g>' +
      '<ellipse cx="400" cy="120" rx="56" ry="60" fill="url(#dHair)"/>' +
      '<ellipse cx="352" cy="132" rx="7" ry="12" fill="' + SKIN_D + '"/><ellipse cx="448" cy="132" rx="7" ry="12" fill="' + SKIN_D + '"/>' +
      jhumka('dEarL', 351) + jhumka('dEarR', 449) +
      '<path d="M354 122C354 86 446 86 446 122C446 160 426 190 400 193C374 190 354 160 354 122Z" fill="url(#dFace)"/>' +
      '<ellipse cx="371" cy="149" rx="10" ry="6" fill="#e8637a" opacity="0.22"/><ellipse cx="429" cy="149" rx="10" ry="6" fill="#e8637a" opacity="0.22"/>' +
      eye('dEyeL', 381) + eye('dEyeR', 419) +
      '<path id="dBrowL" d="M367 110Q380 102 394 107" fill="none" stroke="' + HAIR + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<path id="dBrowR" d="M406 107Q420 102 433 110" fill="none" stroke="' + HAIR + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<path d="M400 128Q398 144 394 150Q400 155 406 150" fill="none" stroke="' + SKIN_D + '" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="394" cy="149.5" r="1.7" fill="#fff6c0"/>' +
      '<path id="dLips" fill="#b3454f"/><path id="dInner" fill="#5a1620"/><path id="dTeeth" fill="#fffaf2"/>' +
      '<circle cx="400" cy="101" r="2.8" fill="#c8102e"/>' +
      '<path d="M348 134C340 84 372 58 400 60C428 58 460 84 452 134C447 106 432 90 405 86Q400 78 395 86C368 90 353 106 348 134Z" fill="url(#dHair)"/>' +
      '<path d="M398 66Q394 76 395 86" fill="none" stroke="#c8102e" stroke-width="2" opacity="0.8"/>' +
      '</g>' +
      '</g>';
  }
  function dots(cx, cy) { // tiny bead line along the arch
    var s = '';
    for (var i = 0; i < 11; i++) { var a = Math.PI * (0.12 + 0.76 * i / 10); s += '<circle cx="' + (cx - Math.cos(a) * 160).toFixed(1) + '" cy="' + (cy + 150 - Math.sin(a) * 118).toFixed(1) + '" r="2.4"/>'; }
    return s;
  }
  function gajra() {
    var s = '';
    for (var i = 0; i < 9; i++) { var a = Math.PI * (0.25 + 0.95 * i / 8); s += '<circle cx="' + (360 + Math.cos(a) * 23).toFixed(1) + '" cy="' + (68 + Math.sin(a) * 23).toFixed(1) + '" r="4.4"/>'; }
    return s;
  }
  function jhumka(id, x) {
    return '<g id="' + id + '"><path d="M' + x + ' 142v5" stroke="' + GOLD + '" stroke-width="1.6"/>' +
      '<path d="M' + (x - 6) + ' 157Q' + (x - 6) + ' 147 ' + x + ' 147Q' + (x + 6) + ' 147 ' + (x + 6) + ' 157Z" fill="' + GOLD + '" stroke="' + GOLD_D + '" stroke-width="1"/>' +
      '<circle cx="' + (x - 4) + '" cy="159.5" r="1.4" fill="' + GOLD + '"/><circle cx="' + x + '" cy="160.5" r="1.6" fill="#d81b4a"/><circle cx="' + (x + 4) + '" cy="159.5" r="1.4" fill="' + GOLD + '"/></g>';
  }
  function eye(id, x) {
    return '<g transform="translate(' + x + ' 124)"><g id="' + id + '">' +
      '<path d="M-12 0Q0-8.6 12 0Q0 7.4-12 0Z" fill="#fbf4ec"/>' +
      '<g clip-path="url(#dEyeClip)"><g class="iris"><circle r="5.8" fill="#4a2a16"/><circle r="2.7" fill="#120806"/><circle cx="-1.9" cy="-1.9" r="1.5" fill="#fff"/></g></g>' +
      '<path d="M-13 0.6Q0-9.4 12.6-0.6L15-2.6" fill="none" stroke="#150a07" stroke-width="2.4" stroke-linecap="round"/>' +
      '</g></g>';
  }

  function buildArms(svg) {
    var arms = {};
    ['L', 'R'].forEach(function (k) {
      var g = el('g', {}, svg);
      arms[k] = {
        upper: el('line', { stroke: '#a3145c', 'stroke-width': 36, 'stroke-linecap': 'round' }, g),
        sleeve: el('line', { stroke: '#8c0f4f', 'stroke-width': 31, 'stroke-linecap': 'round' }, g),
        fore: el('line', { stroke: SKIN, 'stroke-width': 21, 'stroke-linecap': 'round' }, g),
        cuff: el('line', { stroke: GOLD, 'stroke-width': 32 }, g),
        b1: el('line', { stroke: GOLD, 'stroke-width': 23 }, g),
        b2: el('line', { stroke: '#d81b4a', 'stroke-width': 23 }, g),
        b3: el('line', { stroke: GOLD, 'stroke-width': 23 }, g),
        hand: el('g', {}, g),
      };
      var h = el('g', { transform: k === 'L' ? 'scale(1 -1)' : '' }, arms[k].hand);
      el('path', { d: 'M-2-9C6-12 16-12 24-10C32-9 40-8 44-5C47-3 47 2 44 3C38 5 30 7 24 8C16 11 6 11-2 9Z', fill: SKIN, stroke: SKIN_D, 'stroke-width': 1.2 }, h);
      el('path', { d: 'M8-8C12-16 22-18 27-14C24-11 18-9 14-7Z', fill: SKIN, stroke: SKIN_D, 'stroke-width': 1.2 }, h);
      el('path', { d: 'M30-5H42M30 0H44M30 4H40', stroke: SKIN_D, 'stroke-width': 0.9, opacity: 0.6 }, h);
      // mehndi on the back of the hand
      el('circle', { cx: 13, cy: 0, r: 3.4, fill: 'none', stroke: '#7a2e0c', 'stroke-width': 1.1, opacity: 0.85 }, h);
      el('path', { d: 'M13-6V-4M13 4V6M7 0H9M17 0H19M22-4L26-5M22 4L26 5', stroke: '#7a2e0c', 'stroke-width': 1.1, 'stroke-linecap': 'round', opacity: 0.85 }, h);
    });
    return arms;
  }

  function create(bodySvg, armsSvg) {
    buildBody(bodySvg);
    var parts = buildArms(armsSvg);
    var $ = function (id) { return bodySvg.querySelector('#' + id); };
    var bodyG = $('dBodyG'), torso = $('dTorso'), head = $('dHead');
    var eyes = [$('dEyeL'), $('dEyeR')], irises = [eyes[0].querySelector('.iris'), eyes[1].querySelector('.iris')];
    var brows = [$('dBrowL'), $('dBrowR')], ears = [$('dEarL'), $('dEarR')];
    var lips = $('dLips'), inner = $('dInner'), teeth = $('dTeeth');

    var arm = {
      L: { S: { x: 318, y: 262 }, rest: { x: 298, y: 328 }, pos: { x: 298, y: 328 }, g: null, side: -1 },
      R: { S: { x: 482, y: 262 }, rest: { x: 502, y: 328 }, pos: { x: 502, y: 328 }, g: null, side: 1 },
    };
    var lean = { x: 0, y: 0 };
    var look = { x: 0, y: 0.4, rot: 0, down: 0, focus: null, until: 0, idleAt: 0 };
    var face = { smile: 0.35, smileT: 0.35, open: 0, openT: 0, brow: 0, browT: 0, moodUntil: 0, talkUntil: 0, nodAt: -1e9 };
    var blink = { next: performance.now() + 1800, at: -1e9, double: false };
    var swing = { a: 0, v: 0, lastRot: 0 };
    var last = performance.now();

    function reachable(arm, p, slack) {
      var dx = p.x - arm.S.x - lean.x, dy = p.y - arm.S.y - lean.y, d = Math.hypot(dx, dy), max = (L1 + L2) * (slack || 0.97);
      if (d <= max) return p;
      return { x: arm.S.x + lean.x + dx / d * max, y: arm.S.y + lean.y + dy / d * max };
    }
    function start(a, dur, keys) { // keys: [[u, point]…]; the first segment starts where the hand is
      a.g = { t0: performance.now(), dur: dur, keys: [[0, { x: a.pos.x, y: a.pos.y }]].concat(keys) };
    }
    function along(a, from, to, k) { return reachable(a, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }); }

    function gesture(name, p) {
      var R = arm.R, Lf = arm.L;
      switch (name) {
        case 'deal': // pull a card from the shoe and push it on its way
          start(R, 620, [[0.24, SHOE], [0.34, { x: SHOE.x - 8, y: SHOE.y + 3 }], [0.62, along(R, SHOE, p, 0.5)], [1, R.rest]]);
          look.focus = p; look.until = performance.now() + 900;
          return 190;
        case 'dealQuick': // cards coming fast: a short flick from the shoe
          start(R, 380, [[0.28, SHOE], [0.6, along(R, SHOE, p, 0.3)], [1, R.rest]]);
          look.focus = p; look.until = performance.now() + 600;
          return 110;
        case 'joker': // deal it face down to the middle and turn it over there
          start(R, 1050, [[0.18, SHOE], [0.26, { x: SHOE.x - 8, y: SHOE.y + 3 }], [0.55, { x: 428, y: 378 }], [0.7, { x: 420, y: 352 }], [0.82, { x: 424, y: 372 }], [1, R.rest]]);
          look.focus = { x: 400, y: 380 }; look.until = performance.now() + 1700;
          return 150;
        case 'push': // pay: chips from the tray to the winning spot
          start(Lf, 950, [[0.25, TRAY], [0.62, reachable(Lf, p)], [0.74, reachable(Lf, { x: p.x + 12, y: p.y - 4 })], [1, Lf.rest]]);
          look.focus = p; look.until = performance.now() + 1100;
          return 240;
        case 'collect': // take the losing chips back to the tray
          start(Lf, 900, [[0.32, reachable(Lf, p)], [0.72, TRAY], [1, Lf.rest]]);
          look.focus = p; look.until = performance.now() + 800;
          return 300;
        case 'close': // "no more bets": a flat-hand wave over the table
          start(R, 1000, [[0.22, reachable(R, { x: 570, y: 420 })], [0.7, reachable(R, { x: 300, y: 420 })], [1, R.rest]]);
          face.talkUntil = performance.now() + 800;
          return 0;
        case 'welcome': // open palms: bets are open
          start(Lf, 1100, [[0.35, { x: 290, y: 350 }], [0.7, { x: 296, y: 356 }], [1, Lf.rest]]);
          start(R, 1100, [[0.35, { x: 510, y: 350 }], [0.7, { x: 504, y: 356 }], [1, R.rest]]);
          face.talkUntil = performance.now() + 900;
          look.focus = null; look.until = performance.now() + 1200;
          return 0;
        case 'clap':
          start(Lf, 1150, [[0.2, { x: 386, y: 300 }], [0.34, { x: 362, y: 296 }], [0.48, { x: 388, y: 300 }], [0.62, { x: 362, y: 296 }], [0.76, { x: 388, y: 300 }], [1, Lf.rest]]);
          start(R, 1150, [[0.2, { x: 414, y: 300 }], [0.34, { x: 438, y: 296 }], [0.48, { x: 412, y: 300 }], [0.62, { x: 438, y: 296 }], [0.76, { x: 412, y: 300 }], [1, R.rest]]);
          look.focus = null; look.until = performance.now() + 1600;
          return 0;
        case 'sweep': // gather the cards to the discard holder
          start(Lf, 1000, [[0.3, reachable(Lf, { x: 360, y: 470 })], [0.78, reachable(Lf, { x: DISCARD.x + 40, y: DISCARD.y })], [1, Lf.rest]]);
          start(R, 1000, [[0.3, reachable(R, { x: 470, y: 470 })], [0.78, reachable(R, { x: 330, y: 420 })], [1, R.rest]]);
          look.focus = { x: 300, y: 500 }; look.until = performance.now() + 900;
          return 260;
      }
      return 0;
    }

    function react(kind) {
      var t = performance.now();
      if (kind === 'happy') { face.smileT = 1; face.browT = 0.6; face.moodUntil = t + 2400; face.nodAt = t; }
      if (kind === 'wow') { face.smileT = 0.9; face.openT = 0.7; face.browT = 1; face.moodUntil = t + 1500; }
      if (kind === 'nod') face.nodAt = t;
      if (kind === 'talk') face.talkUntil = t + 900;
    }

    function handTarget(a, t) {
      var g = a.g;
      if (g) {
        var u = (t - g.t0) / g.dur;
        if (u >= 1) a.g = null;
        else {
          for (var i = 1; i < g.keys.length; i++) {
            if (u <= g.keys[i][0]) {
              var k0 = g.keys[i - 1], k1 = g.keys[i], s = smooth((u - k0[0]) / Math.max(0.001, k1[0] - k0[0]));
              return { x: k0[1].x + (k1[1].x - k0[1].x) * s, y: k0[1].y + (k1[1].y - k0[1].y) * s, live: true };
            }
          }
        }
      }
      return { x: a.rest.x + Math.sin(t / 900 + a.side) * 2.5, y: a.rest.y + Math.cos(t / 1100 + a.side) * 1.5 };
    }

    function drawArm(a, p) {
      var S = { x: a.S.x + lean.x, y: a.S.y + lean.y };
      var dx = p.x - S.x, dy = p.y - S.y, d = clamp(Math.hypot(dx, dy), 30, L1 + L2 - 0.5);
      var base = Math.atan2(dy, dx);
      var cosB = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), B = Math.acos(cosB);
      var c1 = base + B, c2 = base - B; // elbow out to the side, never across the body
      var e1 = { x: S.x + Math.cos(c1) * L1, y: S.y + Math.sin(c1) * L1 }, e2 = { x: S.x + Math.cos(c2) * L1, y: S.y + Math.sin(c2) * L1 };
      var E = (a.side < 0 ? e1.x < e2.x : e1.x > e2.x) ? e1 : e2;
      var fa = Math.atan2(p.y - E.y, p.x - E.x);
      var W = { x: E.x + Math.cos(fa) * L2, y: E.y + Math.sin(fa) * L2 };
      var P = a === arm.L ? parts.L : parts.R;
      function seg(line, k0, k1, A, Bp) {
        line.setAttribute('x1', (A.x + (Bp.x - A.x) * k0).toFixed(1)); line.setAttribute('y1', (A.y + (Bp.y - A.y) * k0).toFixed(1));
        line.setAttribute('x2', (A.x + (Bp.x - A.x) * k1).toFixed(1)); line.setAttribute('y2', (A.y + (Bp.y - A.y) * k1).toFixed(1));
      }
      seg(P.upper, 0, 1, S, E);
      seg(P.fore, 0, 0.98, E, W);
      seg(P.sleeve, 0, 0.2, E, W);
      seg(P.cuff, 0.2, 0.25, E, W);
      seg(P.b1, 0.76, 0.8, E, W);
      seg(P.b2, 0.81, 0.85, E, W);
      seg(P.b3, 0.86, 0.9, E, W);
      P.hand.setAttribute('transform', 'translate(' + W.x.toFixed(1) + ' ' + W.y.toFixed(1) + ') rotate(' + (fa * 180 / Math.PI).toFixed(1) + ')');
    }

    function mouthPath(s, o) {
      var lx = 388 - 2.5 * s, rx = 412 + 2.5 * s, y = 166 - 2.6 * s;
      var low = 170.5 + 3.5 * s + 7 * o;
      lips.setAttribute('d', 'M' + lx + ' ' + y + 'Q394 162 400 163.6Q406 162 ' + rx + ' ' + y + 'Q400 ' + low + ' ' + lx + ' ' + y + 'Z');
      var show = Math.max(clamp((s - 0.55) / 0.45, 0, 1), clamp(o / 0.3, 0, 1));
      if (show > 0.02) {
        var l2 = lx + 2.4, r2 = rx - 2.4, y2 = y + 0.8, in2 = 166.5 + 2.6 * s + 6.2 * o;
        inner.setAttribute('d', 'M' + l2 + ' ' + y2 + 'Q400 165.4 ' + r2 + ' ' + y2 + 'Q400 ' + in2 + ' ' + l2 + ' ' + y2 + 'Z');
        teeth.setAttribute('d', 'M' + l2 + ' ' + y2 + 'Q400 165.4 ' + r2 + ' ' + y2 + 'Q400 ' + (166.8 + 1.4 * s) + ' ' + l2 + ' ' + y2 + 'Z');
        inner.setAttribute('opacity', show.toFixed(2)); teeth.setAttribute('opacity', show.toFixed(2));
      } else { inner.setAttribute('opacity', 0); teeth.setAttribute('opacity', 0); }
    }

    var IDLE = [null, null, null, { x: 300, y: 520 }, { x: 300, y: 640 }, { x: 240, y: 340 }, { x: 610, y: 360 }];
    function update(t) {
      var dt = Math.min(80, t - last); last = t;
      var kFast = 1 - Math.exp(-dt / 45), kMid = 1 - Math.exp(-dt / 110), kSlow = 1 - Math.exp(-dt / 260);

      // hands (follow their targets smoothly, even when a new gesture interrupts)
      var tl = handTarget(arm.L, t), tr = handTarget(arm.R, t);
      arm.L.pos.x += (tl.x - arm.L.pos.x) * kFast; arm.L.pos.y += (tl.y - arm.L.pos.y) * kFast;
      arm.R.pos.x += (tr.x - arm.R.pos.x) * kFast; arm.R.pos.y += (tr.y - arm.R.pos.y) * kFast;
      // the body leans toward where the hands reach
      var hx = (arm.L.pos.x + arm.R.pos.x) / 2, hy = (arm.L.pos.y + arm.R.pos.y) / 2;
      lean.x += (clamp((hx - 400) * 0.07, -14, 14) - lean.x) * kMid;
      lean.y += (clamp((hy - 326) * 0.05, -3, 7) - lean.y) * kMid;
      var breath = Math.sin(t / 3800 * Math.PI * 2);
      bodyG.setAttribute('transform', 'translate(' + lean.x.toFixed(2) + ' ' + lean.y.toFixed(2) + ')');
      torso.setAttribute('transform', 'translate(0 ' + (breath * 1.3).toFixed(2) + ') translate(400 372) scale(1 ' + (1 + breath * 0.006).toFixed(4) + ') translate(-400 -372)');
      drawArm(arm.L, arm.L.pos);
      drawArm(arm.R, arm.R.pos);

      // where she looks: the action, the player, or an idle glance now and then
      if (t > look.until) {
        look.focus = null;
        if (t > look.idleAt) { look.idleAt = t + 1800 + Math.random() * 2600; look.focus = IDLE[Math.floor(Math.random() * IDLE.length)]; look.until = t + 900 + Math.random() * 900; }
      }
      var f = look.focus, tx = 0, ty = 0.4, trot = 0, tdown = 0;
      if (f) {
        tx = clamp((f.x - 400) / 55, -3.4, 3.4); ty = clamp((f.y - 124) / 120, -1.5, 2.8);
        trot = clamp((f.x - 400) * 0.013, -6, 6); tdown = clamp((f.y - 300) * 0.012, -2, 4.5);
      }
      look.x += (tx - look.x) * kFast; look.y += (ty - look.y) * kFast;
      look.rot += (trot - look.rot) * kSlow; look.down += (tdown - look.down) * kSlow;
      var nod = t - face.nodAt < 700 ? Math.sin((t - face.nodAt) / 700 * Math.PI * 2) * 3.5 : 0;
      head.setAttribute('transform', 'translate(' + (lean.x * 0.25).toFixed(2) + ' ' + (breath * 1.1 + look.down + Math.abs(nod)).toFixed(2) + ') rotate(' + (look.rot + Math.sin(t / 2700) * 0.8).toFixed(2) + ' 400 190)');
      irises.forEach(function (ir) { ir.setAttribute('transform', 'translate(' + look.x.toFixed(2) + ' ' + look.y.toFixed(2) + ')'); });

      // blink (sometimes twice)
      if (t > blink.next) { blink.at = t; blink.double = Math.random() < 0.2; blink.next = t + 2200 + Math.random() * 3200; }
      var bu = (t - blink.at) / 140, open = 1;
      if (bu < 1) open = 1 - Math.sin(bu * Math.PI) * 0.92;
      else if (blink.double && bu > 1.6 && bu < 2.6) open = 1 - Math.sin((bu - 1.6) * Math.PI) * 0.92;
      eyes.forEach(function (e) { e.setAttribute('transform', 'scale(1 ' + open.toFixed(3) + ')'); });

      // expression
      if (t > face.moodUntil) { face.smileT = 0.35; face.openT = 0; face.browT = 0; }
      var talk = t < face.talkUntil ? Math.max(0, Math.sin(t / 70)) * 0.35 : 0;
      face.smile += (face.smileT - face.smile) * kMid;
      face.open += (Math.max(face.openT, talk) - face.open) * kFast;
      face.brow += (face.browT - face.brow) * kMid;
      mouthPath(face.smile, face.open);
      brows.forEach(function (b) { b.setAttribute('transform', 'translate(0 ' + (-face.brow * 3.2).toFixed(2) + ')'); });

      // earrings swing with the head
      var rv = (look.rot - swing.lastRot) / Math.max(1, dt); swing.lastRot = look.rot;
      swing.v += (-swing.a * 0.02 - rv * 40 - swing.v * 0.12) * (dt / 16);
      swing.a += swing.v * (dt / 16);
      var ea = clamp(swing.a + Math.sin(t / 800) * 1.5, -16, 16);
      ears[0].setAttribute('transform', 'rotate(' + ea.toFixed(2) + ' 351 142)');
      ears[1].setAttribute('transform', 'rotate(' + ea.toFixed(2) + ' 449 142)');
    }

    return {
      gesture: gesture,
      react: react,
      look: function (p, ms) { look.focus = p; look.until = performance.now() + (ms || 1200); },
      update: update,
      SHOE: SHOE,
    };
  }

  window.ABDealer = { create: create };
})();
