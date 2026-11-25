/* Dragon Tiger — the dealer: an original character drawn in SVG with layered parts.
 * Body (hair, head, face, jacket) sits behind the table; the arms are a second SVG above the
 * table and cards, solved each frame with two-bone IK so the hands can reach the shoe, the
 * cards and the bet spots. Idle breathing, blinking, head and eye movement toward what she
 * looks at, mouth shapes for talking and smiling.
 *
 *   var dealer = NXDealer.create(bodySvg, armsSvg);
 *   dealer.setHand('L'|'R', x, y)   // world units (720×760 table world); L = viewer's left
 *   dealer.hand(side) → {x, y} · dealer.rest(side) → {x, y} · dealer.pose(side, 'rest'|'hold'|'flat'|'open')
 *   dealer.look(x, y, ms) · dealer.talk(syllables) · dealer.mood('big'|'wow'|'smile', ms) · dealer.update(now)
 */
(function () {
  'use strict';

  var SKIN = '#f1c4a2', SKIN_D = '#d99a78', HAIR = '#1b1213';
  var SLEEVE = '#a3162a', SLEEVE_HI = '#c8303f', GOLD = '#e2b04f';

  var BODY = [
    '<defs>',
    '<radialGradient id="dl-skin" cx="0.45" cy="0.42" r="0.62"><stop offset="0" stop-color="#f8d6bb"/><stop offset="0.7" stop-color="#efbf9b"/><stop offset="1" stop-color="#dfa47f"/></radialGradient>',
    '<linearGradient id="dl-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b2a28"/><stop offset="0.45" stop-color="#1b1213"/><stop offset="1" stop-color="#0d0909"/></linearGradient>',
    '<linearGradient id="dl-jacket" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6e0c18"/><stop offset="0.22" stop-color="#a3162a"/><stop offset="0.5" stop-color="#b91d31"/><stop offset="0.78" stop-color="#a3162a"/><stop offset="1" stop-color="#6e0c18"/></linearGradient>',
    '<linearGradient id="dl-jacketV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></linearGradient>',
    '<radialGradient id="dl-iris" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#7a4a30"/><stop offset="1" stop-color="#2a150c"/></radialGradient>',
    '<clipPath id="dl-eyeL"><path d="M330,100 C334,93.6 348,93.6 352,100 C348,104.6 334,104.6 330,100Z"/></clipPath>',
    '<clipPath id="dl-eyeR"><path d="M368,100 C372,93.6 386,93.6 390,100 C386,104.6 372,104.6 368,100Z"/></clipPath>',
    '</defs>',
    // torso (breathes; the table hides it below the waist)
    '<g id="dl-torso">',
    '<path d="M346,170 C330,180 312,184 296,190 C276,197 266,214 264,236 L256,340 L464,340 L456,236 C454,214 444,197 424,190 C408,184 390,180 374,170 Z" fill="url(#dl-jacket)"/>',
    '<path d="M346,170 C330,180 312,184 296,190 C276,197 266,214 264,236 L256,340 L464,340 L456,236 C454,214 444,197 424,190 C408,184 390,180 374,170 Z" fill="url(#dl-jacketV)"/>',
    '<g fill="none" stroke="' + GOLD + '" stroke-opacity="0.2" stroke-width="1.6" stroke-linecap="round">',
    '<path d="M282,262 c5,-8 13,-8 17,0 c4,-8 12,-8 16,0 M290,270 c4,5 10,5 14,0"/>',
    '<path d="M396,280 c5,-8 13,-8 17,0 c4,-8 12,-8 16,0 M404,288 c4,5 10,5 14,0"/>',
    '<path d="M318,306 c5,-8 13,-8 17,0 c4,-8 12,-8 16,0"/>',
    '</g>',
    '<path d="M372,184 C386,192 400,198 414,206" fill="none" stroke="' + GOLD + '" stroke-width="2.6" stroke-linecap="round"/>',
    '<path d="M414,206 C418,240 420,280 420,340" fill="none" stroke="' + GOLD + '" stroke-opacity="0.55" stroke-width="1.6"/>',
    '<g fill="' + GOLD + '" stroke="' + GOLD + '" stroke-width="1.6" stroke-linecap="round">',
    '<circle cx="386" cy="193" r="2.4"/><path d="M380,197 L392,190"/>',
    '<circle cx="402" cy="201" r="2.4"/><path d="M396,205 L408,198"/>',
    '<circle cx="417" cy="236" r="2.2"/><path d="M411,236 L423,236"/>',
    '<circle cx="419" cy="268" r="2.2"/><path d="M413,268 L425,268"/>',
    '</g>',
    '<path d="M346,150 L346,176 Q360,184 374,176 L374,150 Z" fill="' + SKIN_D + '"/>',
    '<path d="M346,160 Q360,170 374,160 L374,150 L346,150Z" fill="#c78564" opacity="0.55"/>',
    '<path d="M340,166 C350,173 370,173 380,166 L382,181 C369,189 351,189 338,181 Z" fill="#a3162a" stroke="' + GOLD + '" stroke-width="1.8"/>',
    '<path d="M341,175 C352,181 368,181 379,175" fill="none" stroke="' + GOLD + '" stroke-width="1" stroke-opacity="0.7"/>',
    '</g>',
    // head (turns toward what she looks at)
    '<g id="dl-head">',
    '<ellipse cx="360" cy="94" rx="52" ry="58" fill="url(#dl-hair)"/>',
    '<circle cx="360" cy="30" r="25" fill="url(#dl-hair)"/>',
    '<path d="M342,20 C350,12 366,10 376,16" fill="none" stroke="#5a4440" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>',
    '<path d="M326,14 L396,44" stroke="#39b38a" stroke-width="4" stroke-linecap="round"/>',
    '<circle cx="326" cy="14" r="3.4" fill="' + GOLD + '"/>',
    '<circle cx="390" cy="40" r="6" fill="' + GOLD + '"/><circle cx="390" cy="40" r="2.6" fill="#c8303f"/>',
    '<path d="M392,45 C395,54 393,62 397,70" fill="none" stroke="#c8303f" stroke-width="1.8" stroke-linecap="round"/>',
    '<ellipse cx="318" cy="102" rx="6.5" ry="11" fill="' + SKIN_D + '"/>',
    '<ellipse cx="402" cy="102" rx="6.5" ry="11" fill="' + SKIN_D + '"/>',
    '<circle cx="317" cy="116" r="2.6" fill="' + GOLD + '"/><circle cx="317" cy="123" r="3" fill="#39b38a"/>',
    '<circle cx="403" cy="116" r="2.6" fill="' + GOLD + '"/><circle cx="403" cy="123" r="3" fill="#39b38a"/>',
    '<path d="M318,88 C318,56 338,44 360,44 C382,44 402,56 402,88 C402,120 386,148 360,152 C334,148 318,120 318,88Z" fill="url(#dl-skin)"/>',
    '<ellipse cx="335" cy="121" rx="8.5" ry="4.6" fill="#f08a8a" opacity="0.3"/>',
    '<ellipse cx="385" cy="121" rx="8.5" ry="4.6" fill="#f08a8a" opacity="0.3"/>',
    '<path d="M329,96 C334,91 348,91 352,96" fill="none" stroke="#d58f86" stroke-width="3" opacity="0.35"/>',
    '<path d="M368,96 C372,91 386,91 391,96" fill="none" stroke="#d58f86" stroke-width="3" opacity="0.35"/>',
    // eyes
    '<g id="dl-eyes">',
    '<g id="dl-eyeLg"><path d="M330,100 C334,93.6 348,93.6 352,100 C348,104.6 334,104.6 330,100Z" fill="#fdf8f4"/>',
    '<g clip-path="url(#dl-eyeL)"><g class="dl-iris"><circle cx="341" cy="99.6" r="5" fill="url(#dl-iris)"/><circle cx="341" cy="99.6" r="2.3" fill="#120806"/><circle cx="342.7" cy="98" r="1.3" fill="#fff"/></g></g>',
    '<path d="M329.4,100 C334,93 348,93 352.6,99.4 L355.4,97.4" fill="none" stroke="#23140f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>',
    '<g id="dl-eyeRg"><path d="M368,100 C372,93.6 386,93.6 390,100 C386,104.6 372,104.6 368,100Z" fill="#fdf8f4"/>',
    '<g clip-path="url(#dl-eyeR)"><g class="dl-iris"><circle cx="379" cy="99.6" r="5" fill="url(#dl-iris)"/><circle cx="379" cy="99.6" r="2.3" fill="#120806"/><circle cx="380.7" cy="98" r="1.3" fill="#fff"/></g></g>',
    '<path d="M390.6,100 C386,93 372,93 367.4,99.4 L364.6,97.4" fill="none" stroke="#23140f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>',
    '<g id="dl-closed" fill="none" stroke="#23140f" stroke-width="2.2" stroke-linecap="round" style="display:none">',
    '<path d="M330,100 C334,104 348,104 352,100"/><path d="M368,100 C372,104 386,104 390,100"/></g>',
    '</g>',
    '<g id="dl-brows" fill="none" stroke="#2a1712" stroke-width="2.8" stroke-linecap="round">',
    '<path d="M329,88 C334,84 344,83 351,86"/><path d="M369,86 C376,83 386,84 391,88"/></g>',
    '<path d="M361,104 C360,110 358,115 356,118 C359,120.5 363,120.5 365,118.5" fill="none" stroke="#c98c6c" stroke-width="1.6" stroke-linecap="round"/>',
    // mouth
    '<path id="dl-mouthIn" fill="#6e1f2a"/>',
    '<path id="dl-teeth" fill="#fffaf4"/>',
    '<path id="dl-lips" fill="#d4646a" stroke="#b9454f" stroke-width="0.8" stroke-linejoin="round"/>',
    '<path id="dl-mline" fill="none" stroke="#8a2f36" stroke-width="1.2" stroke-linecap="round"/>',
    // hair in front: side-swept fringe and locks framing the face
    '<path d="M312,98 C306,56 332,34 360,34 C390,34 414,56 408,98 C402,74 386,58 366,56 C352,68 334,74 319,79 C315,85 313,92 312,98Z" fill="url(#dl-hair)"/>',
    '<path d="M366,56 C382,60 396,70 404,86" fill="none" stroke="#4a3634" stroke-width="2" stroke-linecap="round" opacity="0.8"/>',
    '<path d="M318,84 C312,104 312,128 320,146 C322,128 322,106 326,90Z" fill="url(#dl-hair)"/>',
    '<path d="M402,84 C408,104 408,128 400,146 C398,128 398,106 394,90Z" fill="url(#dl-hair)"/>',
    '</g>',
  ].join('');

  function armMarkup(id) {
    return '<g id="' + id + '">' +
      '<ellipse class="sh" rx="20" ry="9" fill="#000" opacity="0.22"/>' +
      '<path class="up" fill="' + SLEEVE + '"/>' +
      '<path class="fo" fill="' + SLEEVE + '"/>' +
      '<path class="upHi" fill="' + SLEEVE_HI + '" opacity="0.55"/>' +
      '<path class="foHi" fill="' + SLEEVE_HI + '" opacity="0.5"/>' +
      '<path class="cuff" fill="' + GOLD + '"/>' +
      '<g class="hand">' +
      '<line class="th" stroke="' + SKIN + '" stroke-width="6.5" stroke-linecap="round"/>' +
      '<path class="palm" d="M-2,-12 C10,-14 22,-12 26,-6 L26,6 C22,12 10,14 -2,12 Z" fill="' + SKIN + '" stroke="' + SKIN_D + '" stroke-width="1"/>' +
      '<line class="f f0" stroke="' + SKIN + '" stroke-width="5.6" stroke-linecap="round"/>' +
      '<line class="f f1" stroke="' + SKIN + '" stroke-width="5.8" stroke-linecap="round"/>' +
      '<line class="f f2" stroke="' + SKIN + '" stroke-width="5.6" stroke-linecap="round"/>' +
      '<line class="f f3" stroke="' + SKIN + '" stroke-width="5" stroke-linecap="round"/>' +
      '<path class="kn" d="M24,-9 L24,9" stroke="' + SKIN_D + '" stroke-width="0.9" opacity="0.6"/>' +
      '</g></g>';
  }

  // finger poses: [length, spread°] per finger (y offsets -8.4, -2.8, 2.8, 8)
  var POSES = {
    rest: { len: [15, 16, 15, 12], spread: [-4, -1, 1, 4], thumb: [8, 15], palm: SKIN },
    hold: { len: [10, 11, 10, 8], spread: [-2, 0, 0, 2], thumb: [16, 6], palm: SKIN },
    flat: { len: [19, 21, 20, 16], spread: [-2, -0.5, 0.5, 2], thumb: [12, 15], palm: SKIN },
    open: { len: [18, 20, 19, 15], spread: [-20, -7, 7, 20], thumb: [6, 19], palm: '#f7d6c0' },
  };
  var FY = [-8.4, -2.8, 2.8, 8];

  function create(body, arms) {
    body.innerHTML = BODY;
    arms.innerHTML = armMarkup('dl-armL') + armMarkup('dl-armR');
    var q = function (sel, root) { return (root || body).querySelector(sel); };
    var torso = q('#dl-torso'), head = q('#dl-head'), closed = q('#dl-closed');
    var eyeL = q('#dl-eyeLg'), eyeR = q('#dl-eyeRg'), brows = q('#dl-brows');
    var irises = body.querySelectorAll('.dl-iris');
    var mIn = q('#dl-mouthIn'), teeth = q('#dl-teeth'), lips = q('#dl-lips'), mline = q('#dl-mline');

    function arm(id, side, rx, ry) {
      var g = arms.querySelector('#' + id), el = {};
      ['sh', 'up', 'upHi', 'fo', 'foHi', 'cuff', 'hand', 'palm', 'th'].forEach(function (c) { el[c] = g.querySelector('.' + c); });
      el.f = [0, 1, 2, 3].map(function (i) { return g.querySelector('.f' + i); });
      return { side: side, x: rx, y: ry, rx: rx, ry: ry, pose: '', want: 'rest', el: el };
    }
    var H = { L: arm('dl-armL', -1, 286, 356), R: arm('dl-armR', 1, 434, 356) };

    var MOUTH = {
      smile: { lips: 'M349,132.5 Q355,130.8 360,132.4 Q365,130.8 371,132.5 Q366,140.4 360,140.4 Q354,140.4 349,132.5Z', line: 'M349.6,132.8 Q360,137.8 370.4,132.8', inner: '', teeth: '' },
      a: { lips: 'M349,132 Q360,127.6 371,132 Q366,145.5 360,145.5 Q354,145.5 349,132Z', line: '', inner: 'M350.6,132.6 Q360,129.6 369.4,132.6 Q365.4,143.4 360,143.4 Q354.6,143.4 350.6,132.6Z', teeth: 'M352,132.6 Q360,130.4 368,132.6 L367,134.8 Q360,133.4 353,134.8Z' },
      o: { lips: 'M353.4,133.4 Q360,126 366.6,133.4 Q360,143.4 353.4,133.4Z', line: '', inner: 'M355,133.4 Q360,128 365,133.4 Q360,141.2 355,133.4Z', teeth: '' },
      big: { lips: 'M346,130.6 Q360,132.6 374,130.6 Q368,148 360,148 Q352,148 346,130.6Z', line: '', inner: 'M347.8,131.4 Q360,134 372.2,131.4 Q367,146 360,146 Q353,146 347.8,131.4Z', teeth: 'M349.4,131.8 Q360,134.6 370.6,131.8 L369.2,135.4 Q360,137.4 350.8,135.4Z' },
    };
    MOUTH.wow = MOUTH.o; // a little "oh!"
    var mouthNow = '';
    function setMouth(k) {
      if (k === mouthNow) return;
      mouthNow = k;
      var m = MOUTH[k] || MOUTH.smile;
      lips.setAttribute('d', m.lips);
      lips.setAttribute('fill', m.inner ? 'none' : '#d4646a');
      lips.setAttribute('stroke-width', m.inner ? '2.2' : '0.8');
      lips.setAttribute('stroke', m.inner ? '#d4646a' : '#b9454f');
      mline.setAttribute('d', m.line || 'M0,0');
      mIn.setAttribute('d', m.inner || 'M0,0');
      teeth.setAttribute('d', m.teeth || 'M0,0');
    }
    setMouth('smile');

    var lookAt = { x: 360, y: 900, tx: 360, ty: 900, until: 0, next: 0 };
    var blink = { next: performance.now() + 1800, t: -1 };
    var talkQ = [], moodK = 'smile', moodUntil = 0, lean = 0, last = performance.now();
    var WANDER = [[360, 980], [360, 980], [134, 650], [586, 650], [360, 640], [250, 470], [470, 470], [640, 360], [360, 980]];

    function setPose(h, name) {
      if (h.pose === name) return;
      h.pose = name;
      var p = POSES[name] || POSES.rest;
      h.el.f.forEach(function (f, i) {
        var a = p.spread[i] * Math.PI / 180, y0 = FY[i];
        f.setAttribute('x1', 22); f.setAttribute('y1', y0);
        f.setAttribute('x2', (22 + Math.cos(a) * p.len[i]).toFixed(1));
        f.setAttribute('y2', (y0 + Math.sin(a) * p.len[i] * 1.6).toFixed(1));
      });
      var ty = -h.side * 12; // thumb toward the body
      h.el.th.setAttribute('x1', 6); h.el.th.setAttribute('y1', ty * 0.7);
      h.el.th.setAttribute('x2', p.thumb[0] + 8); h.el.th.setAttribute('y2', (ty < 0 ? -1 : 1) * p.thumb[1]);
      h.el.palm.setAttribute('fill', p.palm);
    }
    // a limb segment A→B, wa wide at A and wb at B, with round ends
    function limb(el, A, B, wa, wb) {
      var dx = B.x - A.x, dy = B.y - A.y, l = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / l, ny = dx / l, ra = wa / 2, rb = wb / 2;
      var pt = function (x, y) { return x.toFixed(1) + ',' + y.toFixed(1); };
      el.setAttribute('d', 'M' + pt(A.x + nx * ra, A.y + ny * ra) + 'L' + pt(B.x + nx * rb, B.y + ny * rb) +
        'A' + rb.toFixed(1) + ',' + rb.toFixed(1) + ' 0 0 0 ' + pt(B.x - nx * rb, B.y - ny * rb) +
        'L' + pt(A.x - nx * ra, A.y - ny * ra) +
        'A' + ra.toFixed(1) + ',' + ra.toFixed(1) + ' 0 0 0 ' + pt(A.x + nx * ra, A.y + ny * ra) + 'Z');
    }
    function persp(y) { return 1 + Math.max(0, y - 330) / 330 * 0.6; } // nearer the camera → bigger

    function solveArm(h, sx, sy) {
      var tx = h.x, ty = h.y, pw = persp(ty);
      var dx = tx - sx, dy = ty - sy, dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      var ux = dx / dist, uy = dy / dist;
      var wx = tx - ux * 15 * pw, wy = ty - uy * 15 * pw; // wrist behind the palm centre
      var d = Math.max(30, Math.sqrt((wx - sx) * (wx - sx) + (wy - sy) * (wy - sy)));
      // Segment lengths follow the reach (the arm also moves toward / away from the camera,
      // so its on-screen length changes); the elbow always keeps a natural bend outward.
      var L = Math.max(d, 110) * 0.565;
      var a = Math.atan2(wy - sy, wx - sx);
      var b = Math.acos(Math.min(1, Math.max(-1, d / (2 * L))));
      var e1 = { x: sx + Math.cos(a + b) * L, y: sy + Math.sin(a + b) * L };
      var e2 = { x: sx + Math.cos(a - b) * L, y: sy + Math.sin(a - b) * L };
      // the elbow bends outward; reaching across the body it drops low instead
      var across = h.side * (tx - 360) < 0;
      var score = function (e) { return across ? 0.3 * h.side * (e.x - sx) + (e.y - sy) : h.side * (e.x - sx) + 0.35 * (e.y - sy); };
      var E = score(e1) > score(e2) ? e1 : e2;
      var W = { x: wx, y: wy }, S = { x: sx, y: sy };
      var fa = Math.atan2(W.y - E.y, W.x - E.x), pe = persp(E.y);
      var el = h.el;
      // light from the upper left: highlights offset toward it
      var hiOff = function (p, q, off) { var nx = -(q.y - p.y), ny = q.x - p.x, nl = Math.sqrt(nx * nx + ny * ny) || 1; nx /= nl; ny /= nl; if (nx + ny > 0) { nx = -nx; ny = -ny; } return { x: nx * off, y: ny * off }; };
      var shift = function (p, o) { return { x: p.x + o.x, y: p.y + o.y }; };
      var cuffA = { x: W.x - Math.cos(fa) * 13 * pw, y: W.y - Math.sin(fa) * 13 * pw };
      var cuffB = { x: W.x - Math.cos(fa) * 2 * pw, y: W.y - Math.sin(fa) * 2 * pw };
      // the sleeve tapers from the shoulder and grows again as the forearm comes toward the camera
      limb(el.up, S, E, 33, 29 * pe);
      limb(el.fo, E, cuffA, 29 * pe, 25 * pw);
      var o1 = hiOff(S, E, 7 * pe), o2 = hiOff(E, W, 6 * pw);
      limb(el.upHi, shift(S, o1), shift(E, o1), 9, 7 * pe);
      limb(el.foHi, shift(E, o2), shift(cuffA, o2), 7 * pe, 6 * pw);
      limb(el.cuff, cuffA, cuffB, 28 * pw, 27 * pw);
      el.hand.setAttribute('transform', 'translate(' + W.x.toFixed(1) + ',' + W.y.toFixed(1) + ') rotate(' + (fa * 180 / Math.PI).toFixed(1) + ') scale(' + (pw * 1.06).toFixed(3) + ')');
      el.sh.setAttribute('cx', (tx + 8).toFixed(1)); el.sh.setAttribute('cy', (ty + 12).toFixed(1));
      el.sh.setAttribute('rx', (20 * pw).toFixed(1)); el.sh.setAttribute('ry', (9 * pw).toFixed(1));
      el.sh.setAttribute('opacity', ty > 300 ? 0.22 : 0);
    }

    function update(now) {
      var dt = Math.min(100, now - last); last = now;
      // breathing, idle sway, leaning in when a hand reaches far toward the player
      var br = Math.sin(now / 1150);
      var reach = Math.max(H.L.y, H.R.y);
      lean += (Math.min(1, Math.max(0, (reach - 470) / 260)) - lean) * (1 - Math.exp(-dt / 160));
      var ly = lean * 12;
      torso.setAttribute('transform', 'translate(0,' + (ly - br * 1.1).toFixed(2) + ') translate(360,340) scale(' + (1 + br * 0.006).toFixed(4) + ',' + (1 + br * 0.008).toFixed(4) + ') translate(-360,-340)');

      // where she looks: a focus target, else a wander between the table, the cards and you
      if (now > lookAt.until && now > lookAt.next) {
        var p = WANDER[Math.floor(Math.random() * WANDER.length)];
        lookAt.tx = p[0]; lookAt.ty = p[1]; lookAt.next = now + 1500 + Math.random() * 2600;
      }
      var lk = 1 - Math.exp(-dt / 140);
      lookAt.x += (lookAt.tx - lookAt.x) * lk; lookAt.y += (lookAt.ty - lookAt.y) * lk;
      var nx = Math.max(-1, Math.min(1, (lookAt.x - 360) / 300)), ny = Math.max(-0.5, Math.min(1, (lookAt.y - 420) / 420));
      var tilt = Math.sin(now / 2300) * 1.3 + nx * 5;
      head.setAttribute('transform', 'translate(' + (nx * 4).toFixed(2) + ',' + (ly * 1.2 - br * 1.5 + ny * 3.5).toFixed(2) + ') rotate(' + tilt.toFixed(2) + ' 360 150)');
      var ix = (nx * 3.2).toFixed(2), iy = (ny * 1.8 - 0.2).toFixed(2);
      for (var i = 0; i < irises.length; i++) irises[i].setAttribute('transform', 'translate(' + ix + ',' + iy + ')');

      // blink: half → closed → half → open
      if (blink.t < 0 && now > blink.next) blink.t = now;
      var s = 1, shut = false;
      if (blink.t >= 0) {
        var bt = now - blink.t;
        if (bt < 45) s = 0.45; else if (bt < 115) shut = true; else if (bt < 160) s = 0.45;
        else { blink.t = -1; blink.next = now + 2200 + Math.random() * 3600; if (Math.random() < 0.18) blink.next = now + 260; }
      }
      eyeL.style.display = eyeR.style.display = shut ? 'none' : '';
      closed.style.display = shut ? '' : 'none';
      if (!shut) {
        eyeL.setAttribute('transform', 'translate(0,100) scale(1,' + s + ') translate(0,-100)');
        eyeR.setAttribute('transform', 'translate(0,100) scale(1,' + s + ') translate(0,-100)');
      }

      // mouth: talking syllables first, then the mood
      var mk = moodUntil > now ? moodK : 'smile';
      while (talkQ.length && talkQ[0].end < now) talkQ.shift();
      if (talkQ.length && talkQ[0].start <= now) mk = talkQ[0].shape;
      setMouth(mk);
      var browUp = (moodUntil > now && (moodK === 'big' || moodK === 'wow')) ? -3.2 : (talkQ.length ? -1 : 0);
      brows.setAttribute('transform', 'translate(0,' + browUp + ')');

      // arms (shoulders follow breathing and the lean)
      var shy = 206 + ly - br * 1.1;
      ['L', 'R'].forEach(function (k) {
        var h = H[k];
        setPose(h, h.want);
        solveArm(h, k === 'L' ? 298 : 422, shy);
      });
    }

    return {
      update: update,
      setHand: function (side, x, y) { H[side].x = x; H[side].y = y; },
      hand: function (side) { return { x: H[side].x, y: H[side].y }; },
      rest: function (side) { return { x: H[side].rx, y: H[side].ry }; },
      pose: function (side, name) { H[side].want = name; },
      look: function (x, y, ms) { lookAt.tx = x; lookAt.ty = y; lookAt.until = performance.now() + (ms || 1200); },
      talk: function (n, gap) { // n syllables starting now
        var t = performance.now(); gap = gap || 150;
        for (var i = 0; i < n; i++) talkQ.push({ start: t + i * gap, end: t + i * gap + gap * 0.8, shape: i % 2 ? 'o' : 'a' });
      },
      mood: function (k, ms) { moodK = k; moodUntil = performance.now() + (ms || 1500); },
    };
  }

  window.NXDealer = { create: create };
})();
