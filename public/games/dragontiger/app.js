/* Dragon Tiger — NEXORNG live-style table game (88.0083). Game logic and the live rounds come from
 * ../_core/table-client.js (NXTable); this file is the table: the temple scene, the felt, cards
 * dealt from the shoe and flipped in 3D, chips, the dealer's moves (dealer.js), sounds (audio.js),
 * the chip bar / bet tools, results road, bets lists, rules and the provably-fair panel. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var booted = false;
  var game = NXTable.start({ event: '88.0083', game: 'dragontiger', onChange: function () { if (booted) render(); }, onSignal: function (n, d) { if (booted) onSignal(n, d); } });
  var S = game.S;

  var DECKS = 8, BET_SECS = 15;
  // Bet spots (engine spot ids) in table-world units (the world is 720×760). ax/ay: chip stack
  // anchor; px: where the dealer puts the payout next to it; hand: which dealer hand serves it.
  var SPOTS = [
    { id: 'dragon', label: 'Dragon', pay: 1, x: 14, y: 560, w: 240, h: 186, ax: 214, ay: 730, px: -76, hand: 'L', big: true },
    { id: 'tie', label: 'Tie', pay: 8, x: 266, y: 560, w: 188, h: 88, ax: 410, ay: 634, px: -74, hand: 'R' },
    { id: 'suitedTie', label: 'Suited Tie', pay: 50, x: 266, y: 658, w: 188, h: 88, ax: 410, ay: 732, px: -74, hand: 'R' },
    { id: 'tiger', label: 'Tiger', pay: 1, x: 466, y: 560, w: 240, h: 186, ax: 506, ay: 730, px: 76, hand: 'R', big: true },
  ];
  var SPOT = {};
  SPOTS.forEach(function (s) { SPOT[s.id] = s; });
  var SLOT = { dragon: { x: 248, y: 476 }, tiger: { x: 472, y: 476 } };
  var SHOE = { x: 610, y: 362 }, RACK = { x: 360, y: 336 }, TRAY = { x: 80, y: 368 };
  var CHIP_MULT = [1, 2, 5, 10, 25];
  var CHIP_COL = [ // base, edge, text, side
    ['#efe8da', '#2f6fb8', '#1d2a44', '#b9b0a0'],
    ['#c8202f', '#fff3e0', '#fff', '#7e0f1a'],
    ['#14936a', '#fff3e0', '#fff', '#0b5c41'],
    ['#2b4fb3', '#f3cf7a', '#fff', '#1a3070'],
    ['#1c1b20', '#e2b04f', '#f3cf7a', '#050506'],
  ];
  var PHRASES = {
    open: ['Place your chips', 'The table is open', 'Dragon or Tiger?', 'Choose your side', 'Pick your beast', 'Who rules this round?', 'Fortune favours the bold', 'Bets are welcome'],
    close: ['No more bets', 'Bets are closed', 'Here come the cards', 'Cards on the way', 'All set, dealing'],
    pause: ['Next round coming up', 'A fresh shoe is ready', 'Get your chips ready', 'Shuffling for the next round'],
  };
  var lastPhrase = {};
  function pick(kind) {
    var l = PHRASES[kind], i = Math.floor(Math.random() * l.length);
    if (l[i] === lastPhrase[kind]) i = (i + 1) % l.length;
    return (lastPhrase[kind] = l[i]);
  }

  // ---------------------------------------------------------------- cards and rules
  var RANKS = 'A23456789TJQK';
  function normCard(r, s) {
    var rank = typeof r === 'number' ? r : null;
    if (rank == null) {
      r = String(r).toUpperCase();
      rank = /^\d+$/.test(r) ? Number(r) : r === 'T' ? 10 : RANKS.indexOf(r) + 1;
    }
    if (rank === 14) rank = 1;
    var su = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' }[s] || String(s).toUpperCase().charAt(0);
    return rank >= 1 && rank <= 13 && 'SHDC'.indexOf(su) >= 0 ? { r: rank, s: su } : null;
  }
  function parseCard(c) { // "KH", "10s", "A♠", "S10", {rank, suit} or 0..51
    if (c == null || c === '') return null;
    if (typeof c === 'number') return { r: (c % 13) + 1, s: 'SHDC'.charAt(Math.floor(c / 13) % 4) };
    if (typeof c === 'object') return normCard(c.rank != null ? c.rank : c.r != null ? c.r : c.value, c.suit != null ? c.suit : c.s);
    var t = String(c).trim(), m = t.match(/^(10|[2-9TJQKA1])\s*([SHDC♠♥♦♣])/i);
    if (m) return normCard(m[1], m[2]);
    m = t.match(/^([SHDC♠♥♦♣])\s*(10|[2-9TJQKA1])$/i);
    return m ? normCard(m[2], m[1]) : null;
  }
  function rankLabel(r) { return r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r); }
  function outcomeOf(d, t) {
    if (!d || !t) return '';
    if (d.r === t.r) return d.s === t.s ? 'suitedTie' : 'tie';
    return d.r > t.r ? 'dragon' : 'tiger';
  }
  function normOutcome(o) {
    if (o && typeof o === 'object') o = o.outcome || o.result || o.winner || '';
    o = String(o || '').toLowerCase().replace(/[\s_-]/g, '');
    return { suitedtie: 'suitedTie', suited: 'suitedTie', tie: 'tie', draw: 'tie', dragon: 'dragon', d: 'dragon', tiger: 'tiger', t: 'tiger' }[o] || '';
  }
  function resultOutcome(r) { // a result {dragon, tiger, winner}: from its cards (suited tie too)
    if (r && typeof r === 'object' && r.outcome && typeof r.outcome === 'object') r = r.outcome;
    return (r && typeof r === 'object' && outcomeOf(parseCard(r.dragon), parseCard(r.tiger))) || normOutcome(r);
  }
  // total paid back on a spot (stake included): the client's rules (game.pay, same as the engine)
  // for the live result, else Dragon/Tiger 1:1, Tie 8:1, Suited Tie 50:1, Dragon/Tiger lose half
  // on a tie, a suited tie is also a tie.
  function paidBack(spot, amount) {
    var r = S.result;
    if (game.pay && r && typeof r === 'object') return game.round2(amount * game.pay(r, spot));
    return game.round2(payout(spot, amount, outcome));
  }
  function betsOf(b) { // the spots of a public bet: {player, bets:[{spot, amount}], total, win}
    if (b && b.bets && b.bets.length) return b.bets.map(function (x) { return { spot: x.spot, amount: Number(x.amount) || 0 }; });
    return b && b.spot ? [{ spot: b.spot, amount: Number(b.amount) || 0 }] : [];
  }
  function payout(spot, amount, oc) {
    if (spot === oc) return amount * (1 + SPOT[spot].pay);
    if (spot === 'tie' && oc === 'suitedTie') return amount * 9;
    if ((spot === 'dragon' || spot === 'tiger') && (oc === 'tie' || oc === 'suitedTie')) return amount / 2;
    return 0;
  }
  function rtp() {
    var n = 52 * DECKS, same = (4 * DECKS - 1) / (n - 1), suited = (DECKS - 1) / (n - 1), win = (1 - same) / 2;
    var dt = 2 * win + same / 2;
    return { dragon: dt, tiger: dt, tie: 9 * same, suitedTie: 51 * suited };
  }

  // ---------------------------------------------------------------- art: emblems, card faces, felt
  var EMBLEM = {
    tiger: [
      ['f', 'M18,30 C13,15 23,9 33,18 Z M82,30 C87,15 77,9 67,18 Z'],
      ['s', 'M50,14 C68,14 80,22 86,34 C92,37 96,45 94,55 C93,71 82,86 50,90 C18,86 7,71 6,55 C4,45 8,37 14,34 C20,22 32,14 50,14 Z'],
      ['f', 'M50,18 L45,31 L50,37 L55,31 Z'],
      ['l', 'M37,21 C40,27 42,31 39,35 M63,21 C60,27 58,31 61,35 M8,49 L22,52 L10,57 M10,63 L24,61 L14,69 M92,49 L78,52 L90,57 M90,63 L76,61 L86,69'],
      ['f', 'M27,46 C32,39 40,40 44,46 C40,51 32,51 27,46 Z M73,46 C68,39 60,40 56,46 C60,51 68,51 73,46 Z'],
      ['s', 'M38,62 C38,56 46,54 50,58 C54,54 62,56 62,62 C62,70 56,74 50,74 C44,74 38,70 38,62 Z'],
      ['f', 'M44,58 L56,58 L50,65 Z'],
      ['l', 'M50,65 L50,70 M44,72 C47,75 53,75 56,72'],
    ],
    dragon: [
      ['l', 'M34,24 C29,13 22,8 12,6 M27,15 C23,17 18,17 13,14 M66,24 C71,13 78,8 88,6 M73,15 C77,17 82,17 87,14'],
      ['l', 'M26,38 C16,32 9,24 11,13 M74,38 C84,32 91,24 89,13'],
      ['s', 'M50,18 C64,18 72,26 74,36 C82,38 88,46 86,56 C84,66 74,70 68,72 C66,82 58,90 50,90 C42,90 34,82 32,72 C26,70 16,66 14,56 C12,46 18,38 26,36 C28,26 36,18 50,18 Z'],
      ['l', 'M30,41 C36,34 42,36 46,43 M70,41 C64,34 58,36 54,43 M44,28 Q50,24 56,28 M46,32.5 Q50,29.5 54,32.5'],
      ['f', 'M31,47 C35,42 42,43 45,49 C40,51 35,51 31,47 Z M69,47 C65,42 58,43 55,49 C60,51 65,51 69,47 Z'],
      ['s', 'M40,62 C40,56 46,54 50,56 C54,54 60,56 60,62 C60,70 56,76 50,76 C44,76 40,70 40,62 Z'],
      ['f', 'M43,62 a2.2,2.2 0 1,0 4.4,0 a2.2,2.2 0 1,0 -4.4,0 Z M52.6,62 a2.2,2.2 0 1,0 4.4,0 a2.2,2.2 0 1,0 -4.4,0 Z'],
      ['l', 'M40,66 C28,70 18,80 10,92 M60,66 C72,70 82,80 90,92 M44,81 L50,85 L56,81'],
    ],
  };
  function emblemSVG(kind) {
    return '<svg viewBox="0 0 100 100" aria-hidden="true">' + EMBLEM[kind].map(function (p) {
      if (p[0] === 'f') return '<path d="' + p[1] + '" fill="currentColor"/>';
      if (p[0] === 's') return '<path d="' + p[1] + '" fill="rgba(0,0,0,0.22)" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/>';
      return '<path d="' + p[1] + '" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';
    }).join('') + '</svg>';
  }
  var emblemPaths = {};
  function drawEmblem(c, kind, cx, cy, size, color) {
    if (!emblemPaths[kind]) emblemPaths[kind] = EMBLEM[kind].map(function (p) { return [p[0], new Path2D(p[1])]; });
    c.save();
    c.translate(cx - size / 2, cy - size / 2);
    c.scale(size / 100, size / 100);
    c.fillStyle = color; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
    emblemPaths[kind].forEach(function (p) {
      if (p[0] === 'f') c.fill(p[1]);
      else { c.lineWidth = p[0] === 's' ? 3.4 : 2.6; c.stroke(p[1]); }
    });
    c.restore();
  }

  var SUIT = {
    H: 'M50,90 C20,68 4,50 4,31 C4,15 16,5 29,5 C39,5 46,11 50,19 C54,11 61,5 71,5 C84,5 96,15 96,31 C96,50 80,68 50,90 Z',
    D: 'M50,3 L86,50 L50,97 L14,50 Z',
    S: 'M50,4 C70,26 94,40 94,60 C94,74 84,82 72,82 C64,82 58,78 54,72 C55,82 59,90 66,96 L34,96 C41,90 45,82 46,72 C42,78 36,82 28,82 C16,82 6,74 6,60 C6,40 30,26 50,4 Z',
    C: 'M50,6 a21,21 0 1,1 -0.01,0 Z M27,40 a21,21 0 1,1 -0.01,0 Z M73,40 a21,21 0 1,1 -0.01,0 Z M45,52 C46,74 42,86 33,96 L67,96 C58,86 54,74 55,52 Z',
  };
  function suit(s, x, y, size, col) {
    return '<path transform="translate(' + x + ',' + y + ') scale(' + size / 100 + ')" d="' + SUIT[s] + '" fill="' + col + '"/>';
  }
  var FACE_FONT = 'font-family="Georgia, \'Liberation Serif\', serif"';
  function faceSVG(c) {
    var col = c.s === 'H' || c.s === 'D' ? '#c4142b' : '#18181f', lab = rankLabel(c.r), ten = lab === '10';
    var corner = '<text x="13" y="26" text-anchor="middle" font-size="' + (ten ? 18 : 22) + '" font-weight="700"' + (ten ? ' letter-spacing="-1.5"' : '') + ' fill="' + col + '" ' + FACE_FONT + '>' + lab + '</text>' + suit(c.s, 6, 30, 14, col);
    var centre = c.r >= 11
      ? '<rect x="22" y="32" width="48" height="64" rx="5" fill="#f4e9cf" stroke="#c99a3c" stroke-width="1.4"/>' +
        '<path d="M34,43 L38,37 L42,43 L46,35 L50,43 L54,37 L58,43 Z" fill="#d9a441"/>' +
        '<text x="46" y="80" text-anchor="middle" font-size="34" font-weight="700" fill="' + col + '" ' + FACE_FONT + '>' + lab + '</text>' + suit(c.s, 40, 83, 12, col)
      : suit(c.s, 21, 39, 50, col);
    return '<svg viewBox="0 0 92 128" aria-hidden="true"><rect x="0.5" y="0.5" width="91" height="127" rx="8" fill="#fbf7ee"/>' +
      '<rect x="4.5" y="4.5" width="83" height="119" rx="5.5" fill="none" stroke="#e0c27a" stroke-width="1"/>' +
      corner + '<g transform="rotate(180 46 64)">' + corner + '</g>' + centre + '</svg>';
  }

  function buildFelt() {
    var s = '<defs>' +
      '<radialGradient id="ft-felt" cx="360" cy="560" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#15806a"/><stop offset="0.55" stop-color="#0c5242"/><stop offset="1" stop-color="#06302a"/></radialGradient>' +
      '<linearGradient id="ft-rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a3420"/><stop offset="0.012" stop-color="#4a1a0e"/><stop offset="0.03" stop-color="#2a0d07"/><stop offset="1" stop-color="#1a0704"/></linearGradient>' +
      '<linearGradient id="ft-lip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="ft-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a1c10"/><stop offset="1" stop-color="#1e0805"/></linearGradient>' +
      '<pattern id="ft-cloud" width="140" height="90" patternUnits="userSpaceOnUse"><path d="M10,56 c0,-12 16,-14 20,-6 c2,-12 22,-12 24,0 c8,-6 18,0 14,8 M80,22 c0,-10 14,-12 17,-5 c2,-10 18,-10 20,0" fill="none" stroke="#f3cf7a" stroke-width="2.2" stroke-linecap="round"/></pattern>' +
      '</defs>';
    var inner = 'M-126,340 Q-126,312 -94,312 L814,312 Q846,312 846,340 L1060,1600 L-340,1600 Z';
    s += '<path d="M-176,366 Q-176,302 -112,302 L832,302 Q896,302 896,366 L1140,1600 L-420,1600 Z" fill="#000" opacity="0.4"/>';
    s += '<path d="M-150,336 Q-150,290 -100,290 L820,290 Q870,290 870,336 L1090,1600 L-370,1600 Z" fill="url(#ft-rail)"/>';
    s += '<path d="M-140,334 Q-140,298 -98,298 L818,298 Q860,298 860,334 L1076,1600 M-140,334 L-356,1600" fill="none" stroke="#e2b04f" stroke-width="2" opacity="0.75"/>';
    s += '<path d="' + inner + '" fill="url(#ft-felt)"/>';
    s += '<path d="' + inner + '" fill="url(#ft-cloud)" opacity="0.07"/>';
    s += '<path d="M-126,312 L846,312 L846,348 L-126,348 Z" fill="url(#ft-lip)"/>';
    s += '<path d="M30,404 H170 M550,404 H690" stroke="#f3cf7a" stroke-width="1.5" opacity="0.3"/>';
    s += '<rect x="172" y="394" width="376" height="164" rx="22" fill="none" stroke="#f3cf7a" stroke-width="1.6" opacity="0.3"/>';
    s += '<path d="M190,394 Q360,372 530,394" fill="none" stroke="#f3cf7a" stroke-width="1.2" opacity="0.25"/>';
    // chip rack in front of the dealer
    s += '<rect x="262" y="314" width="196" height="44" rx="8" fill="url(#ft-wood)" stroke="#e2b04f" stroke-width="1.2" stroke-opacity="0.7"/>';
    for (var i = 0; i < 8; i++) {
      var x = 270 + i * 23.4, col = CHIP_COL[i % 5];
      s += '<rect x="' + x + '" y="319" width="19" height="34" rx="3" fill="' + col[0] + '"/>';
      for (var j = 0; j < 9; j++) s += '<path d="M' + x + ',' + (321.5 + j * 3.6) + ' h19" stroke="' + col[3] + '" stroke-width="1" opacity="0.8"/>';
      s += '<rect x="' + (x + 2) + '" y="319" width="4" height="34" fill="#fff" opacity="0.12"/>';
    }
    // the shoe (right) and the discard tray (left)
    s += '<path d="M590,318 L696,318 L696,404 L608,404 Z" fill="#1a0b09" stroke="#e2b04f" stroke-width="1.6"/>';
    s += '<path d="M590,318 L696,318 L692,327 L596,327 Z" fill="#3a1a12"/>';
    s += '<path d="M594,332 L620,332 L632,398 L608,398 Z" fill="#a3162a" stroke="#fbf2dc" stroke-width="1.2"/>';
    s += '<path d="M600,340 L622,340 M602,352 L624,352 M604,364 L626,364 M606,376 L628,376 M608,388 L630,388" stroke="#fbf2dc" stroke-width="0.8" opacity="0.5"/>';
    s += '<circle cx="664" cy="360" r="14" fill="none" stroke="#e2b04f" stroke-width="1.4" opacity="0.7"/>';
    s += '<path d="M24,322 L136,322 L142,402 L18,402 Z" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.28)" stroke-width="1.4"/>';
    s += '<g id="discard"></g>';
    s += '<path d="M24,322 L136,322 L138,334 L22,334 Z" fill="rgba(255,255,255,0.08)"/>';
    $('felt').innerHTML = s;
  }
  var discardCount = 6;
  function drawDiscard() {
    var n = Math.min(18, discardCount), s = '';
    for (var i = 0; i < n; i++) s += '<rect x="' + (34 + (i % 3) * 0.8) + '" y="' + (386 - i * 2.4) + '" width="92" height="13" rx="2" fill="#8e1426" stroke="#fbf2dc" stroke-width="1"/>';
    $('discard').innerHTML = s;
  }

  // ---------------------------------------------------------------- sound toggles
  var soundOn = true, musicOn = true;
  try { soundOn = localStorage.getItem('dragontiger-sound') !== 'off'; musicOn = localStorage.getItem('dragontiger-music') !== 'off'; } catch (e) { /* defaults */ }
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('dragontiger-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    NXAudio.setSound(on);
  }
  function setMusic(on) {
    musicOn = on;
    try { localStorage.setItem('dragontiger-music', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('music').setAttribute('aria-pressed', String(on));
    $('music').setAttribute('aria-label', on ? 'Music on' : 'Music off');
    NXAudio.setMusic(on);
  }
  var sfx = NXAudio.sfx;

  // ---------------------------------------------------------------- tweens (one clock for all motion)
  var tweens = [], epoch = 0;
  function easeInOut(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function easeOut(k) { return 1 - Math.pow(1 - k, 3); }
  function tween(ms, fn, ease) {
    return new Promise(function (res) { tweens.push({ el: 0, ms: ms, fn: fn, ease: ease || easeInOut, res: res, ep: epoch }); });
  }
  function wait(ms) { return tween(ms, function () {}); }
  // Motion runs on elapsed time; when the table falls behind the live round (moments waiting in
  // the queue) it plays faster until it has caught up.
  function runTweens(dt) {
    var speed = queued >= 3 ? 2 : queued === 2 ? 1.35 : 1;
    for (var i = 0; i < tweens.length; i++) {
      var t = tweens[i];
      t.el += dt * speed;
      var k = t.ep !== epoch ? 1 : Math.min(1, t.el / t.ms);
      t.fn(t.ease(k), k);
      if (k >= 1) { tweens.splice(i--, 1); t.res(); }
    }
  }
  // a queue for the table's moments (each card, then the result + payouts + sweep), cancelled on a new round
  var chain = Promise.resolve(), queued = 0;
  function queue(fn) {
    var ep = epoch;
    queued++;
    chain = chain.then(function () { if (ep === epoch) return fn(); })
      .catch(function (e) { if (window.console) console.warn(e); })
      .then(function () { if (ep === epoch) queued--; });
  }
  function live(ep) { return ep === epoch; }

  // ---------------------------------------------------------------- dealer
  var dealer = NXDealer.create($('dealer'), $('arms'));
  var handTok = { L: 0, R: 0 };
  function handTo(side, x, y, ms, pose, lift) {
    var tok = ++handTok[side], h = dealer.hand(side), x0 = h.x, y0 = h.y;
    if (pose) dealer.pose(side, pose);
    return tween(ms, function (k) {
      if (handTok[side] !== tok) return;
      dealer.setHand(side, x0 + (x - x0) * k, y0 + (y - y0) * k - (lift ? Math.sin(Math.PI * k) * lift : 0));
    });
  }
  function handRest(side, ms) { var r = dealer.rest(side); return handTo(side, r.x, r.y, ms || 420, 'rest'); }
  function grab(side, pose) { if (pose) dealer.pose(side, pose); return ++handTok[side]; }
  function follow(side, tok, x, y) { if (handTok[side] === tok) dealer.setHand(side, x, y); }

  // ---------------------------------------------------------------- world placement + temple scene
  var stageEl = document.querySelector('.stage'), world = $('world');
  var canvas = $('scene'), ctx = canvas.getContext('2d'), fxc = $('fx'), fctx = fxc.getContext('2d');
  var bgCache = document.createElement('canvas'), bctx = bgCache.getContext('2d');
  var K = 1, OX = 0, OY = 0, FULL_W = 0, FULL_H = 0, DPR = 1, LEFT = 0, fitKey = '';

  function fit() {
    var r = stageEl.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    FULL_W = r.width; FULL_H = r.height;
    var list = document.querySelector('.bets').getBoundingClientRect();
    LEFT = window.innerWidth >= 900 && list.right > r.left && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    var bar = document.querySelector('.top').getBoundingClientRect();
    var top = Math.max(0, bar.bottom - r.top + 4);
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 6 : FULL_H;
    var pw = FULL_W - LEFT, ph = Math.max(160, playBottom - top);
    K = Math.min(pw / 720, ph / 760);
    OX = LEFT + (pw - 720 * K) / 2;
    OY = top + (ph - 760 * K) / 2;
    world.style.transform = 'translate(' + OX.toFixed(1) + 'px,' + OY.toFixed(1) + 'px) scale(' + K.toFixed(4) + ')';
    stageEl.style.setProperty('--left', LEFT + 'px');
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // Same place and size as before: leave the canvases alone. This also runs when the bets list
    // changes size (every time a player joins), and sizing a canvas clears it — the table would blink.
    var key = [FULL_W, FULL_H, DPR, K, OX, OY].join(',');
    if (key === fitKey) return;
    fitKey = key;
    [canvas, fxc, bgCache].forEach(function (c) { c.width = Math.round(FULL_W * DPR); c.height = Math.round(FULL_H * DPR); });
    drawStatic();
  }
  function toWorld(c) { c.setTransform(DPR * K, 0, 0, DPR * K, DPR * OX, DPR * OY); }
  function bounds() { return { x0: -OX / K, y0: -OY / K, x1: (FULL_W - OX) / K, y1: (FULL_H - OY) / K }; }
  function worldToScreen(x, y) {
    var r = stageEl.getBoundingClientRect();
    return { x: r.left + OX + x * K, y: r.top + OY + y * K };
  }

  function drawStatic() {
    var c = bctx, b = bounds();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, bgCache.width, bgCache.height);
    toWorld(c);
    var x0 = b.x0 - 2, x1 = b.x1 + 2, w = x1 - x0;
    // ceiling: dark carved beams
    var g = c.createLinearGradient(0, Math.min(b.y0, -90), 0, -8);
    g.addColorStop(0, '#140605'); g.addColorStop(1, '#2e0f0a');
    c.fillStyle = g; c.fillRect(x0, b.y0 - 2, w, -6 - b.y0);
    c.fillStyle = '#3a150d'; c.fillRect(x0, -70, w, 16); c.fillRect(x0, -34, w, 20);
    c.strokeStyle = 'rgba(226,176,79,0.7)'; c.lineWidth = 1.5;
    [-54, -14].forEach(function (y) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); });
    for (var bx = Math.floor(x0 / 120) * 120; bx < x1; bx += 120) {
      c.beginPath(); c.moveTo(bx - 22, -54); c.quadraticCurveTo(bx, -30, bx + 22, -54); c.stroke();
      c.fillStyle = 'rgba(226,176,79,0.55)'; c.fillRect(bx - 3, -34, 6, 20);
    }
    // lacquered wall
    g = c.createLinearGradient(0, -14, 0, 240);
    g.addColorStop(0, '#86181b'); g.addColorStop(1, '#560c10');
    c.fillStyle = g; c.fillRect(x0, -14, w, 254);
    for (var px = -1200; px < 1920; px += 240) { // tall panels with thin gold frames
      if (px > 60 && px < 660) continue;
      c.strokeStyle = 'rgba(226,176,79,0.22)'; c.lineWidth = 2;
      c.strokeRect(px + 18, 28, 204, 196);
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.strokeRect(px + 26, 36, 188, 180);
    }
    // key-fret frieze under the beams
    c.fillStyle = '#3e090c'; c.fillRect(x0, -14, w, 26);
    c.strokeStyle = 'rgba(226,176,79,0.75)'; c.lineWidth = 1.3;
    for (var fx = Math.floor(x0 / 28) * 28; fx < x1; fx += 28) { c.strokeRect(fx + 4, -9, 20, 16); c.strokeRect(fx + 9, -4.5, 10, 7); }
    [-14, 12].forEach(function (y) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); });
    // wainscot
    c.fillStyle = '#2b0f0a'; c.fillRect(x0, 236, w, 60);
    c.strokeStyle = 'rgba(226,176,79,0.6)'; c.beginPath(); c.moveTo(x0, 236); c.lineTo(x1, 236); c.stroke();
    c.strokeStyle = 'rgba(226,176,79,0.18)';
    for (var wx = Math.floor(x0 / 120) * 120; wx < x1; wx += 120) c.strokeRect(wx + 10, 246, 100, 40);
    // the moon gate behind the dealer: warm light through a lattice
    var mx = 360, my = 150, mr = 172;
    c.save(); c.beginPath(); c.arc(mx, my, mr, 0, Math.PI * 2); c.clip();
    var rg = c.createRadialGradient(mx, my - 30, 10, mx, my, mr);
    rg.addColorStop(0, '#ffe2a6'); rg.addColorStop(0.42, '#f2a650'); rg.addColorStop(0.8, '#a8441c'); rg.addColorStop(1, '#5a160c');
    c.fillStyle = rg; c.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    c.strokeStyle = 'rgba(70,18,8,0.5)'; c.lineWidth = 3;
    for (var d = -2 * mr; d < 2 * mr; d += 30) {
      c.beginPath(); c.moveTo(mx + d - mr, my - mr); c.lineTo(mx + d + mr, my + mr); c.stroke();
      c.beginPath(); c.moveTo(mx + d + mr, my - mr); c.lineTo(mx + d - mr, my + mr); c.stroke();
    }
    c.strokeStyle = 'rgba(70,18,8,0.65)'; c.lineWidth = 5;
    c.beginPath(); c.arc(mx, my, mr * 0.62, 0, Math.PI * 2); c.stroke();
    var vg = c.createRadialGradient(mx, my, mr * 0.6, mx, my, mr);
    vg.addColorStop(0, 'rgba(60,10,6,0)'); vg.addColorStop(1, 'rgba(60,10,6,0.55)');
    c.fillStyle = vg; c.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    c.restore();
    var ring = c.createLinearGradient(mx - mr, my - mr, mx + mr, my + mr);
    ring.addColorStop(0, '#f6d47c'); ring.addColorStop(0.5, '#a8701e'); ring.addColorStop(1, '#f1c45a');
    c.strokeStyle = ring; c.lineWidth = 13; c.beginPath(); c.arc(mx, my, mr + 4, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(40,8,4,0.7)'; c.lineWidth = 3; c.beginPath(); c.arc(mx, my, mr - 3, 0, Math.PI * 2); c.stroke();
    // medallions: dragon (left), tiger (right)
    [[96, 'dragon', '#0f4a3d', '#062820'], [624, 'tiger', '#5a2a0a', '#2a1205']].forEach(function (m) {
      var cx = m[0], cy = 150, r = 62;
      var dg = c.createRadialGradient(cx, cy - 16, 6, cx, cy, r);
      dg.addColorStop(0, m[2]); dg.addColorStop(1, m[3]);
      c.fillStyle = dg; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = ring; c.lineWidth = 7; c.stroke();
      c.strokeStyle = 'rgba(243,207,122,0.45)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, r - 9, 0, Math.PI * 2); c.stroke();
      drawEmblem(c, m[1], cx, cy + 2, 92, '#e9bd5c');
    });
    // pillars (seen on wide screens)
    [-60, 780, -480, 1200].forEach(function (cx) {
      var pg = c.createLinearGradient(cx - 34, 0, cx + 34, 0);
      pg.addColorStop(0, '#4a0a0e'); pg.addColorStop(0.45, '#a52226'); pg.addColorStop(1, '#4a0a0e');
      c.fillStyle = pg; c.fillRect(cx - 34, -14, 68, 310);
      c.fillStyle = '#c99a3c'; c.fillRect(cx - 38, 12, 76, 10); c.fillRect(cx - 38, 214, 76, 10);
      c.fillStyle = '#1a0806'; c.fillRect(cx - 40, 270, 80, 26);
    });
    // floor around the table
    g = c.createLinearGradient(0, 296, 0, Math.max(400, b.y1));
    g.addColorStop(0, '#22100b'); g.addColorStop(1, '#0b0302');
    c.fillStyle = g; c.fillRect(x0, 296, w, Math.max(10, b.y1 - 294));
    // incense burners on the ledge
    [176, 544].forEach(function (cx) {
      c.fillStyle = '#7a5520';
      c.fillRect(cx - 12, 228, 3, 10); c.fillRect(cx + 9, 228, 3, 10);
      var bg = c.createLinearGradient(cx - 16, 0, cx + 16, 0);
      bg.addColorStop(0, '#5a3a14'); bg.addColorStop(0.5, '#c99a3c'); bg.addColorStop(1, '#5a3a14');
      c.fillStyle = bg; c.beginPath(); c.ellipse(cx, 224, 16, 9, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3a2508'; c.beginPath(); c.ellipse(cx, 216, 11, 3.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#c99a3c'; c.fillRect(cx - 1.5, 209, 3, 6);
    });
  }

  var LANTERNS = [[170, 22, 1, 0], [550, 22, 1, 1.7], [-150, 4, 1.15, 0.6], [870, 4, 1.15, 2.4], [-470, -6, 1.25, 1.1], [1190, -6, 1.25, 3]];
  var motes = [];
  for (var mi = 0; mi < 38; mi++) motes.push({ x: 220 + Math.random() * 280, y: Math.random() * 300, v: 0.004 + Math.random() * 0.01, a: Math.random() * 6.3, s: 0.8 + Math.random() * 1.6 });
  function lantern(c, x, y, s, now, ph, ytop) {
    var sw = Math.sin(now / 1500 + ph) * 0.05;
    c.strokeStyle = '#2a0c08'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, ytop); c.lineTo(x, y); c.stroke();
    c.save(); c.translate(x, y); c.rotate(sw); c.scale(s, s);
    var fl = 0.82 + 0.18 * Math.sin(now / 130 + ph) * Math.sin(now / 370 + ph * 2);
    c.globalCompositeOperation = 'lighter';
    var gl = c.createRadialGradient(0, 32, 0, 0, 32, 120);
    gl.addColorStop(0, 'rgba(255,130,60,' + (0.34 * fl).toFixed(3) + ')'); gl.addColorStop(1, 'rgba(255,90,40,0)');
    c.fillStyle = gl; c.fillRect(-120, -88, 240, 240);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#c99a3c'; c.fillRect(-12, 0, 24, 6); c.fillRect(-12, 58, 24, 6);
    var bg = c.createRadialGradient(-4, 28, 2, 0, 32, 30);
    bg.addColorStop(0, '#ffe08a'); bg.addColorStop(0.35, '#ff6a3a'); bg.addColorStop(0.78, '#c0141f'); bg.addColorStop(1, '#6e0810');
    c.fillStyle = bg; c.beginPath(); c.ellipse(0, 32, 27, 27, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(90,10,10,0.45)'; c.lineWidth = 1.3;
    [9, 18].forEach(function (rx) { c.beginPath(); c.ellipse(0, 32, rx, 27, 0, 0, Math.PI * 2); c.stroke(); });
    c.strokeStyle = '#d8333f'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, 64); c.quadraticCurveTo(Math.sin(now / 700 + ph) * 3, 76, 0, 90); c.stroke();
    c.fillStyle = '#c99a3c'; c.beginPath(); c.arc(0, 70, 3, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  function drawScene(now) {
    var c = ctx, b = bounds();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(bgCache, 0, 0);
    toWorld(c);
    // the moon light breathes; dust drifts in it
    c.globalCompositeOperation = 'lighter';
    var a = 0.07 + 0.03 * Math.sin(now / 1700);
    var mg = c.createRadialGradient(360, 130, 0, 360, 130, 200);
    mg.addColorStop(0, 'rgba(255,205,130,' + a.toFixed(3) + ')'); mg.addColorStop(1, 'rgba(255,205,130,0)');
    c.fillStyle = mg; c.fillRect(160, -70, 400, 400);
    c.fillStyle = '#ffe2a8';
    motes.forEach(function (m) {
      m.y -= m.v * 16; if (m.y < -10) { m.y = 300; m.x = 220 + Math.random() * 280; }
      c.globalAlpha = 0.25 + 0.25 * Math.sin(now / 600 + m.a);
      c.beginPath(); c.arc(m.x + Math.sin(now / 1800 + m.a) * 8, m.y, m.s, 0, Math.PI * 2); c.fill();
    });
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    // incense smoke
    [176, 544].forEach(function (cx, bi) {
      for (var i = 0; i < 3; i++) {
        var t = now / 1000 + i * 2.1 + bi;
        c.strokeStyle = 'rgba(240,228,214,' + (0.06 + i * 0.015).toFixed(3) + ')';
        c.lineWidth = 5 - i * 1.3;
        c.beginPath(); c.moveTo(cx, 208);
        for (var sgi = 1; sgi <= 5; sgi++) {
          var yy = 208 - sgi * 32, xx = cx + Math.sin(t * 0.9 + sgi * 0.9) * (4 + sgi * 4);
          c.quadraticCurveTo(cx + Math.sin(t * 1.3 + sgi) * (6 + sgi * 3), yy + 16, xx, yy);
        }
        c.stroke();
      }
    });
    LANTERNS.forEach(function (l) { if (l[0] > b.x0 - 150 && l[0] < b.x1 + 150) lantern(c, l[0], l[1], l[2], now, l[3], b.y0 - 2); });
  }

  // coins and sparkles for wins (fx canvas, world units)
  var coins = [];
  function coinBurst(x, y, n) {
    for (var i = 0; i < n; i++) coins.push({ x: x + (Math.random() - 0.5) * 40, y: y, vx: (Math.random() - 0.5) * 0.55, vy: -(0.55 + Math.random() * 0.55), r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.03, life: 0, max: 1300 + Math.random() * 700, s: 8 + Math.random() * 6 });
  }
  var fxClear = true;
  function drawFx(dt) {
    if (!coins.length) { if (!fxClear) { fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fxc.width, fxc.height); fxClear = true; } return; }
    fxClear = false;
    fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fxc.width, fxc.height);
    toWorld(fctx);
    for (var i = coins.length - 1; i >= 0; i--) {
      var c = coins[i];
      c.vy += 0.0016 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.life += dt;
      if (c.life > c.max) { coins.splice(i, 1); continue; }
      fctx.globalAlpha = Math.min(1, 2 * (1 - c.life / c.max));
      var rx = Math.max(1.2, Math.abs(Math.cos(c.r)) * c.s);
      fctx.fillStyle = Math.cos(c.r) > 0 ? '#ffd56a' : '#d99a2a';
      fctx.beginPath(); fctx.ellipse(c.x, c.y, rx, c.s, 0, 0, Math.PI * 2); fctx.fill();
      fctx.strokeStyle = '#a8620f'; fctx.lineWidth = 1.2; fctx.stroke();
    }
    fctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- chips
  // per-spot bet limit (the table's €0.10–€100 when the casino sets none)
  function minBet() { return Number(game.limit().min) || 0.1; }
  function maxBet() { return Number(game.limit().max) || 100; }
  function chipValues() { var m = minBet(); return CHIP_MULT.map(function (k) { return game.round2(m * k); }); }
  function chipText(v) { return v >= 1 && Math.round(v) === v ? String(v) : String(Number(v.toFixed(2))); }
  function chipColour(el, i) {
    var col = CHIP_COL[i];
    el.style.setProperty('--c', col[0]); el.style.setProperty('--e', col[1]); el.style.setProperty('--t', col[2]); el.style.setProperty('--d', col[3]);
  }
  var sel = 0, chipBtns = [];
  CHIP_MULT.forEach(function (m, i) { // built once; values follow the bet limit
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'cbtn'; b.setAttribute('role', 'radio');
    chipColour(b, i);
    b.onclick = function () { sel = i; sfx('click'); updateChipBar(); };
    $('chipBar').appendChild(b);
    chipBtns.push(b);
  });
  function updateChipBar() {
    var vals = chipValues(), max = maxBet();
    chipBtns.forEach(function (b, i) {
      var t = chipText(vals[i]);
      if (b.textContent !== t) b.textContent = t;
      b.hidden = !!(max && vals[i] > max);
      b.setAttribute('aria-checked', String(i === sel));
      b.setAttribute('aria-label', 'Chip ' + game.money(vals[i]));
    });
  }
  function decompose(amount) { // chip colours for a stack, largest at the bottom
    var vals = chipValues(), out = [], left = Math.round(amount * 100);
    for (var i = vals.length - 1; i >= 0 && out.length < 5; i--) {
      var v = Math.round(vals[i] * 100);
      while (left >= v && out.length < 5) { out.push(i); left -= v; }
    }
    if (!out.length) out.push(0);
    return out;
  }
  function makeStack(amount, x, y, cls) {
    var el = document.createElement('div');
    el.className = 'stack' + (cls ? ' ' + cls : '');
    $('chips').appendChild(el);
    var st = { el: el, x: x, y: y, s: 1, amount: 0 };
    setStack(st, amount);
    placeStack(st);
    return st;
  }
  function setStack(st, amount) {
    st.amount = game.round2(amount);
    var list = decompose(st.amount), html = '';
    list.forEach(function (ci, i) {
      var col = CHIP_COL[ci];
      html += '<i class="schip" style="--c:' + col[0] + ';--e:' + col[1] + ';--d:' + col[3] + ';top:' + (-16 - i * 5.4).toFixed(1) + 'px"></i>';
    });
    html += '<b class="stack__amt" style="top:' + (-50 - list.length * 5.4).toFixed(1) + 'px">' + game.money(st.amount) + '</b>';
    st.el.innerHTML = html;
  }
  function placeStack(st) { st.el.style.transform = 'translate(' + st.x.toFixed(1) + 'px,' + st.y.toFixed(1) + 'px) scale(' + st.s.toFixed(3) + ')'; }

  // ---------------------------------------------------------------- my bets this round
  var pending = {}, undoStack = [], confirmed = null, placing = false, lastBets = null;
  var stacks = {}, extraStacks = [], settling = false;
  function total(m) { var t = 0; for (var k in m) t += m[k] || 0; return game.round2(t); }
  function copy(m) { var o = {}; for (var k in m) if (m[k] > 0) o[k] = m[k]; return o; }
  function canBet() { return S.phase === 'betting' && !confirmed && !placing && S.gotSnapshot; }

  function renderStacks() {
    if (settling) return;
    var mine = confirmed || pending;
    SPOTS.forEach(function (sp) {
      var a = mine[sp.id] || 0, st = stacks[sp.id];
      if (!a) { if (st) { st.el.remove(); delete stacks[sp.id]; } return; }
      if (!st) st = stacks[sp.id] = makeStack(a, sp.ax, sp.ay);
      else if (st.amount !== a) setStack(st, a);
      var cls = 'stack ' + (confirmed ? 'stack--placed' : 'stack--pending');
      if (st.el.className !== cls) st.el.className = cls;
    });
  }
  function flyChip(ci, spotId, done) {
    var from = chipBtns[ci].getBoundingClientRect(), sp = SPOT[spotId];
    var n = stacks[spotId] ? decompose(stacks[spotId].amount).length : 0;
    var to = worldToScreen(sp.ax, sp.ay - 16 - n * 5.4 + 15);
    var el = document.createElement('i');
    el.className = 'fchip'; chipColour(el, ci);
    $('fly').appendChild(el);
    var sx = from.left + from.width / 2 - 25, sy = from.top + from.height / 2 - 25, s = (48 * K) / 50;
    if (!el.animate) { el.remove(); done(); return; }
    var an = el.animate([
      { transform: 'translate(' + sx + 'px,' + sy + 'px) scale(1)' },
      { transform: 'translate(' + ((sx + to.x - 25) / 2) + 'px,' + (Math.min(sy, to.y) - 60) + 'px) scale(' + ((1 + s) / 2) + ')', offset: 0.45 },
      { transform: 'translate(' + (to.x - 25) + 'px,' + (to.y - 25) + 'px) scale(' + s + ',' + (s * 0.65) + ')' },
    ], { duration: 420, easing: 'cubic-bezier(.3,.6,.4,1)' });
    an.onfinish = function () { el.remove(); done(); };
  }

  var errorAt = 0;
  function toastErr(text) { errorAt = Date.now(); toast(text, 'error'); }
  function placeChip(spotId) {
    if (!canBet()) return;
    var v = chipValues()[sel], max = maxBet(), cur = pending[spotId] || 0;
    if (cur + v > max + 1e-9) {
      v = game.round2(max - cur);
      if (v < minBet()) return toastErr('Max ' + game.money(max) + ' on ' + SPOT[spotId].label + '.');
    }
    if (S.balance != null && total(pending) + v > S.balance + 1e-9) return toastErr('Not enough balance.');
    undoStack.push(copy(pending));
    pending[spotId] = game.round2(cur + v);
    dealer.look(SPOT[spotId].ax, SPOT[spotId].ay, 900);
    updateControls(); renderBalance();
    flyChip(sel, spotId, function () { sfx('chip'); renderStacks(); });
  }
  function setPending(next) {
    undoStack.push(copy(pending));
    pending = next;
    sfx('chips', 3);
    renderStacks(); updateControls(); renderBalance();
  }
  function canAfford(m) {
    for (var k in m) if (m[k] > maxBet() + 1e-9) return 'Max ' + game.money(maxBet()) + ' per spot.';
    if (S.balance != null && total(m) > S.balance + 1e-9) return 'Not enough balance.';
    return '';
  }
  function doubled() { var o = {}; for (var k in pending) o[k] = game.round2(pending[k] * 2); return o; }

  function confirmBets() {
    if (!canBet()) return;
    var bets = SPOTS.filter(function (s) { return pending[s.id] > 0; }).map(function (s) { return { spot: s.id, amount: game.round2(pending[s.id]) }; });
    if (!bets.length) return;
    var round = S.round, placed = copy(pending);
    placing = true; updateControls();
    var fail = function (res) {
      placing = false;
      if (Date.now() - errorAt > 600) toastErr((res && (res.text || res.message)) || 'Bet failed. Try again.');
      if (S.phase !== 'betting' || S.round !== round) { pending = {}; undoStack = []; renderStacks(); }
      updateControls(); renderBalance();
    };
    Promise.resolve().then(function () { return game.bet(bets); }).then(function (res) {
      if (res && res.ok === false) return fail(res);
      placing = false;
      if (S.round !== round) return fail(null);
      confirmed = placed; lastBets = copy(placed); pending = {}; undoStack = [];
      sfx('chips', 3);
      dealer.mood('smile', 800);
      renderStacks(); updateControls(); renderBalance(); renderList();
    }, fail);
  }

  // ---------------------------------------------------------------- the table's moments
  var cards = { dragon: null, tiger: null };
  var curRound = null, prevPhase = null, dealt = 0, dealtSide = {}, resultQueued = false, joined = false, outcome = '', autoTried = false;
  // The client knows the result (and pays it) the moment the engine sends it; the table only
  // reveals it after the cards are dealt and flipped. Until then the balance, the newest road
  // bead, other players' wins and the win message are held back.
  var revealed = true, holdBal = null, winToast = '';
  function release() {
    if (holdBal != null) { holdBal = null; renderBalance(); flashBalance(); }
    if (winToast) { toast(winToast, 'win'); winToast = ''; }
  }
  var lane = $('lane'), laneText = $('laneText'), laneSub = $('laneSub');
  function setLane(text, sub, kind) {
    lane.className = 'lane' + (text ? ' lane--pop' : ' lane--empty') + (kind ? ' lane--' + kind : '');
    void lane.offsetWidth; // restart the pop animation
    laneText.textContent = text || '';
    laneSub.textContent = sub || '';
    laneText.style.fontSize = '';
    var room = lane.clientWidth - 16;
    if (laneText.scrollWidth > room) laneText.style.fontSize = Math.floor(30 * room / laneText.scrollWidth) + 'px';
  }

  function makeCard(c) {
    var el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<div class="card__in"><div class="card__face card__back"></div><div class="card__face card__front">' + (c ? faceSVG(c) : '') + '</div></div>';
    $('cards').appendChild(el);
    return { el: el, inner: el.firstChild, x: SHOE.x, y: SHOE.y, r: 0, s: 1, f: 0, lift: 0, c: c };
  }
  function placeCard(o) {
    o.el.style.transform = 'translate(' + (o.x - 46).toFixed(1) + 'px,' + (o.y - 64 - o.lift).toFixed(1) + 'px) rotate(' + o.r.toFixed(2) + 'deg) scale(' + o.s.toFixed(3) + ')';
    o.inner.style.transform = 'perspective(700px) rotateY(' + o.f.toFixed(1) + 'deg)';
  }
  function slotOf(d, i) {
    var to = normOutcome(d && (d.to || d.side || d.hand));
    return to === 'dragon' || to === 'tiger' ? to : i === 0 ? 'dragon' : 'tiger';
  }
  function cardOf(d) { return parseCard(d && typeof d === 'object' && !('rank' in d) ? (d.card != null ? d.card : d.value) : d); }

  function showCard(side, c) { // joined mid-round: the card is already on the table, face up
    if (cards[side]) return;
    var o = cards[side] = makeCard(c);
    o.x = SLOT[side].x; o.y = SLOT[side].y; o.f = 180;
    placeCard(o);
  }

  async function dealCard(side, c) {
    if (cards[side]) return;
    var ep = epoch, slot = SLOT[side];
    var o = cards[side] = makeCard(c);
    o.x = SHOE.x - 4; o.y = SHOE.y + 2; o.r = -12; o.s = 0.86; o.el.style.opacity = '0'; placeCard(o);
    dealer.look(SHOE.x, SHOE.y, 900);
    await handTo('R', SHOE.x + 2, SHOE.y - 34, 220, 'hold');
    if (!live(ep)) return;
    o.el.style.opacity = '1';
    sfx('slide');
    var tok = grab('R', 'hold'), x0 = o.x, y0 = o.y, r0 = o.r, s0 = o.s;
    dealer.look(slot.x, slot.y, 1700);
    await tween(470, function (k) {
      o.x = x0 + (slot.x - x0) * k; o.y = y0 + (slot.y - y0) * k;
      o.r = r0 * (1 - k) + Math.sin(k * Math.PI) * 5; o.s = s0 + (1 - s0) * k;
      placeCard(o);
      follow('R', tok, o.x + 4, o.y - 56);
    }, easeOut);
    await wait(70);
    if (!live(ep)) return;
    // the flip: the hand lifts the card's edge and turns it over
    tok = grab('R', 'flat');
    var flipped = false;
    await tween(400, function (k) {
      o.f = 180 * k; o.lift = Math.sin(Math.PI * k) * 16; o.s = 1 + Math.sin(Math.PI * k) * 0.1;
      placeCard(o);
      if (!flipped && k > 0.45) { flipped = true; sfx('flip'); }
      follow('R', tok, o.x + 50 * Math.cos(Math.PI * k), o.y - 18 - o.lift);
    });
    handRest('R', 460);
    await wait(60);
  }

  async function gestureOpen() {
    var ep = epoch;
    dealer.talk(3, 170); NXAudio.cue('open');
    dealer.look(360, 640, 1700);
    await handTo('R', 560, 520, 420, 'open');
    if (!live(ep)) return;
    await handTo('R', 290, 530, 900, 'open');
    if (!live(ep)) return;
    await handRest('R', 480);
  }
  async function gestureClose() {
    var ep = epoch;
    dealer.talk(3, 170); NXAudio.cue('close');
    dealer.look(360, 560, 1200);
    await Promise.all([handTo('L', 318, 470, 240, 'flat'), handTo('R', 402, 470, 240, 'flat')]);
    if (!live(ep)) return;
    await Promise.all([handTo('L', 160, 500, 380, 'flat'), handTo('R', 560, 500, 380, 'flat')]);
    handRest('L', 400); handRest('R', 400);
  }

  async function showResult(oc) {
    var ep = epoch, d = cards.dragon, t = cards.tiger;
    outcome = oc; revealed = true;
    renderHistory(); renderList();
    var tie = oc === 'tie' || oc === 'suitedTie';
    if (d) d.el.classList.add(oc === 'tiger' ? 'card--lose' : 'card--win');
    if (t) t.el.classList.add(oc === 'dragon' ? 'card--lose' : 'card--win');
    var title = { dragon: 'Dragon wins', tiger: 'Tiger wins', tie: 'Tie', suitedTie: 'Suited tie' }[oc] || '';
    var sub = d && t ? rankLabel(d.c.r) + ' vs ' + rankLabel(t.c.r) + (oc === 'suitedTie' ? ', same suit' : '') : '';
    setLane(title, sub, tie ? 'tie' : oc);
    SPOTS.forEach(function (sp) { sp.el.classList.toggle('spot--win', sp.id === oc || (sp.id === 'tie' && oc === 'suitedTie')); });
    NXAudio.cue(tie ? 'tie' : oc);
    dealer.talk(tie ? 1 : 2, 220);
    var side = oc === 'tiger' ? 'R' : 'L', target = tie ? { x: 360, y: 476 } : SLOT[oc];
    dealer.look(target.x, target.y, 1400);
    await handTo(side, target.x + (side === 'L' ? -10 : 10), target.y - 86, 320, 'open');
    if (!live(ep)) return;
    dealer.mood(tie ? 'wow' : 'big', 1000);
    await wait(480);
    handRest(side, 400);
    await wait(80);
  }

  async function settle(oc) {
    var ep = epoch, mine = confirmed || {}, jobs = { L: [], R: [] }, back = 0, staked = 0;
    settling = true;
    var others = {};
    (S.bets || []).forEach(function (b) { if (!b.mine) betsOf(b).forEach(function (x) { if (SPOT[x.spot]) others[x.spot] = (others[x.spot] || 0) + x.amount; }); });
    SPOTS.forEach(function (sp) {
      var a = mine[sp.id], st = stacks[sp.id];
      if (a && st) {
        staked += a;
        var r = paidBack(sp.id, a);
        back += r;
        if (r === 0) jobs[sp.hand].push(function (side) { return collect(st, side); });
        else if (r < a) jobs[sp.hand].push(function (side) { setStack(st, r); return collect(makeStack(a - r, st.x, st.y), side); });
        else jobs[sp.hand].push(function (side) { return pay(sp, st, r - a, side); });
      } else if (others[sp.id]) { // other players' bets: the same motions, without our chips
        var win = payout(sp.id, 1, oc) > 1;
        jobs[sp.hand].push(function (side) { return ghost(sp, side, win); });
      }
    });
    while (jobs.R.length > jobs.L.length + 1) jobs.L.push(jobs.R.splice(1, 1)[0]); // share the work
    await Promise.all(['L', 'R'].map(async function (side) {
      for (var i = 0; i < jobs[side].length && live(ep); i++) await jobs[side][i](side);
      if (jobs[side].length && live(ep)) await handRest(side, 380);
    }));
    if (!live(ep)) return;
    back = game.round2(back);
    if (back > 0) {
      await wait(150);
      var big = back >= staked * 10 || (oc === 'suitedTie' && mine.suitedTie);
      var all = extraStacks.slice();
      for (var k in stacks) all.push(stacks[k]);
      sfx('chips', 5);
      var from = all.map(function (st) { return { x: st.x, y: st.y }; });
      all.forEach(function (st) { coinBurst(st.x, st.y - 40, big ? 26 : back > staked ? 8 : 0); });
      await tween(480, function (k) {
        all.forEach(function (st, i) { st.y = from[i].y + 170 * k; st.s = 1 - 0.2 * k; st.el.style.opacity = String(1 - k); placeStack(st); });
      }, easeInOut);
      all.forEach(function (st) { st.el.remove(); });
      release();
      if (back > staked) { sfx('win', big); if (big) await clap(); else { dealer.mood('big', 1400); dealer.look(360, 1000, 1400); } }
    } else if (staked) {
      sfx('lose');
      dealer.mood('wow', 900);
    }
    stacks = {}; extraStacks = [];
    $('chips').innerHTML = '';
    settling = false;
    release();
  }

  async function collect(st, side) {
    var ep = epoch;
    await handTo(side, st.x + 4, st.y - 40, 300, 'flat');
    if (!live(ep)) return;
    sfx('sweep');
    var tok = grab(side, 'hold'), x0 = st.x, y0 = st.y, tx = RACK.x + (side === 'L' ? -50 : 50), ty = RACK.y + 14;
    await tween(440, function (k) {
      st.x = x0 + (tx - x0) * k; st.y = y0 + (ty - y0) * k; st.s = 1 - 0.3 * k;
      placeStack(st);
      follow(side, tok, st.x + 4, st.y - 40 * st.s);
    });
    sfx('chips', 2);
    await tween(120, function (k) { st.el.style.opacity = String(1 - k); });
    st.el.remove();
    for (var key in stacks) if (stacks[key] === st) delete stacks[key];
  }
  async function pay(sp, st, amount, side) {
    var ep = epoch, sx = RACK.x + (side === 'L' ? -50 : 50), sy = RACK.y + 14;
    await handTo(side, sx, sy - 30, 260, 'hold');
    if (!live(ep)) return;
    var p = makeStack(amount, sx, sy, 'stack--placed');
    p.s = 0.75; placeStack(p);
    extraStacks.push(p);
    sfx('chips', 3);
    var tok = grab(side, 'flat'), tx = sp.ax + sp.px, ty = sp.ay;
    await tween(500, function (k) {
      p.x = sx + (tx - sx) * k; p.y = sy + (ty - sy) * k; p.s = 0.75 + 0.25 * k;
      placeStack(p);
      follow(side, tok, p.x + 2, p.y - 44 * p.s);
    });
    sfx('chip');
    await wait(60);
  }
  async function ghost(sp, side, win) {
    var ep = epoch, near = { x: sp.ax - (sp.big ? 60 : 30), y: sp.ay - 60 }, rack = { x: RACK.x + (side === 'L' ? -50 : 50), y: RACK.y - 10 };
    var a = win ? rack : near, b = win ? near : rack;
    await handTo(side, a.x, a.y, 320, win ? 'hold' : 'flat');
    if (!live(ep)) return;
    if (!win) sfx('sweep');
    await handTo(side, b.x, b.y, 420, win ? 'flat' : 'hold');
  }
  async function clap() {
    var ep = epoch;
    dealer.mood('big', 2200); dealer.look(360, 1000, 2000);
    await Promise.all([handTo('L', 334, 292, 300, 'flat'), handTo('R', 386, 292, 300, 'flat')]);
    for (var i = 0; i < 3 && live(ep); i++) {
      await Promise.all([handTo('L', 352, 290, 90), handTo('R', 368, 290, 90)]);
      sfx('clap');
      await Promise.all([handTo('L', 332, 288, 120), handTo('R', 388, 288, 120)]);
    }
    if (live(ep)) await Promise.all([handRest('L', 420), handRest('R', 420)]);
  }

  async function sweepCards() { // one hand gathers both cards and slides them into the discard tray
    var ep = epoch, d = cards.dragon, t = cards.tiger, pile = [d, t].filter(Boolean);
    if (!pile.length) return;
    await wait(250);
    if (!live(ep)) return;
    var first = pile[pile.length - 1];
    await handTo('L', first.x + 8, first.y - 52, 300, 'flat');
    if (!live(ep)) return;
    sfx('slide');
    var tk = grab('L', 'flat');
    if (d && t) {
      var x0 = t.x, y0 = t.y;
      await tween(340, function (k) { t.x = x0 + (d.x + 6 - x0) * k; t.y = y0 + (d.y - 4 - y0) * k; t.r = 4 * k; placeCard(t); follow('L', tk, t.x + 8, t.y - 52); });
      if (!live(ep)) return;
    }
    sfx('sweep');
    var from = pile.map(function (o) { return { x: o.x, y: o.y, r: o.r }; });
    await tween(520, function (k) {
      pile.forEach(function (o, i) {
        o.x = from[i].x + (TRAY.x - from[i].x) * k; o.y = from[i].y + (TRAY.y - from[i].y) * k;
        o.r = from[i].r + (-90 - from[i].r) * k; o.s = 1 - 0.45 * k; placeCard(o);
      });
      follow('L', tk, first.x + 10, first.y - 40);
    });
    await tween(140, function (k) { pile.forEach(function (o) { o.el.style.opacity = String(1 - k); }); });
    pile.forEach(function (o) { o.el.remove(); });
    cards.dragon = cards.tiger = null;
    discardCount += 2; drawDiscard();
    handRest('L', 420);
    if (S.phase !== 'betting') setLane(pick('pause'), '', '');
  }

  function clearTable() {
    epoch++; // stops every running motion of the old round
    $('cards').innerHTML = ''; $('chips').innerHTML = '';
    cards.dragon = cards.tiger = null;
    stacks = {}; extraStacks = []; settling = false;
    SPOTS.forEach(function (sp) { sp.el.classList.remove('spot--win'); });
    chain = Promise.resolve(); queued = 0;
    revealed = true;
    release();
  }

  function onNewRound() {
    var first = curRound === null;
    curRound = S.round;
    dealt = 0; dealtSide = {}; resultQueued = false; outcome = ''; autoTried = false;
    joined = first && S.phase !== 'betting';
    clearTable();
    confirmed = null; placing = false; pending = {}; undoStack = [];
    renderStacks();
  }

  function onPhase(ph, was) {
    if (ph === 'betting') {
      setLane(pick('open'), '', '');
      if (was !== null) gestureOpen();
    } else if (ph === 'dealing') {
      if (!confirmed && total(pending) > 0 && !placing) {
        pending = {}; undoStack = []; renderStacks(); renderBalance();
        toastErr('Time ran out: your chips were not placed.');
      }
      setLane(pick('close'), '', '');
      if (!joined) gestureClose();
    } else if (ph === 'pause' && !cards.dragon && !cards.tiger && !resultQueued) {
      setLane(pick('pause'), '', '');
    } else if (ph === 'waiting') {
      setLane('The table opens soon', '', '');
    }
  }

  function syncTable() {
    var deals = S.deals || [];
    while (dealt < deals.length) {
      var d = deals[dealt], side = slotOf(d, dealt), c = cardOf(d);
      dealt++;
      if (!c || dealtSide[side]) continue;
      dealtSide[side] = true;
      if (joined) showCard(side, c);
      else queue(dealCard.bind(null, side, c));
    }
    var res = S.result;
    if (res && !resultQueued && S.phase !== 'betting' && (res.round == null || res.round === S.round)) {
      resultQueued = true;
      var dc = parseCard(res.dragon) || (cards.dragon && cards.dragon.c), tc = parseCard(res.tiger) || (cards.tiger && cards.tiger.c);
      ['dragon', 'tiger'].forEach(function (side) { // cards only in the result: deal them now
        var c = side === 'dragon' ? dc : tc;
        if (!c || dealtSide[side]) return;
        dealtSide[side] = true;
        if (joined) showCard(side, c); else queue(dealCard.bind(null, side, c));
      });
      var oc = outcomeOf(dc, tc) || resultOutcome(res);
      if (joined) {
        queue(function () { outcome = oc; return showResultQuiet(oc); });
      } else {
        queue(async function () { await showResult(oc); await settle(oc); await sweepCards(); });
      }
    }
  }
  function showResultQuiet(oc) {
    var d = cards.dragon, t = cards.tiger;
    if (d) d.el.classList.add(oc === 'tiger' ? 'card--lose' : 'card--win');
    if (t) t.el.classList.add(oc === 'dragon' ? 'card--lose' : 'card--win');
    setLane({ dragon: 'Dragon wins', tiger: 'Tiger wins', tie: 'Tie', suitedTie: 'Suited tie' }[oc] || '', '', oc === 'suitedTie' ? 'tie' : oc);
    return sweepCards();
  }

  // ---------------------------------------------------------------- signals
  function onSignal(name, d) {
    if (name === 'result' && !joined && S.phase === 'result') { // demo balances are paid at once, real ones a moment later: show the balance from before the win
      revealed = false;
      if (S.balance != null) holdBal = game.round2(S.balance - (S.demo ? Number(d && d.win) || 0 : 0));
    }
    if (name === 'win' && d && d.text) { if (revealed) toast(d.text, 'win'); else winToast = d.text; }
    if (name === 'error' && d && d.text) toastErr(d.text);
  }

  var toastTimer;
  function toast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    var at = worldToScreen(360, 250); // over the dealer's chest (not her face), centred on the play area
    t.style.top = Math.max(62, Math.round(at.y)) + 'px';
    t.style.left = Math.round(at.x) + 'px';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- render
  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000); // never hang the loader

  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  function renderBalance() {
    var b = holdBal != null ? holdBal : S.balance == null ? null : game.round2(S.balance - (confirmed ? 0 : total(pending)));
    setText($('balance'), b == null ? '—' : game.money(b));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');
  }
  var flashTimer;
  function flashBalance() {
    var el = $('balance');
    el.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('flash'); }, 900);
  }

  function render() {
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot;
    if (S.gotSnapshot) {
      if (S.round !== curRound) onNewRound();
      if (S.phase !== prevPhase) { var was = prevPhase; prevPhase = S.phase; onPhase(S.phase, was); }
      syncTable();
      if (S.phase === 'betting') joined = false;
    }
    renderBalance();
    renderSpots();
    updateControls();
    renderHistory();
    renderList();
    setText($('fRound'), S.round ? String(S.round) : '—');
    var hash = S.hash || (S.result && S.result.hash) || '', seed = S.seed || (S.result && S.result.seed) || '';
    setText($('fHash'), hash || '—');
    setText($('fSeed'), seed || 'revealed when the round ends');
  }

  function renderSpots() {
    var live = canBet(), sums = {}, counts = {};
    (S.bets || []).forEach(function (b) {
      if (b.mine) return;
      betsOf(b).forEach(function (x) {
        if (!SPOT[x.spot]) return;
        sums[x.spot] = (sums[x.spot] || 0) + x.amount;
        counts[x.spot] = (counts[x.spot] || 0) + 1;
      });
    });
    SPOTS.forEach(function (sp) {
      var cls = 'spot spot--' + sp.id + (live ? ' spot--live' : '') + (sp.el.classList.contains('spot--win') ? ' spot--win' : '');
      if (sp.el.className !== cls) sp.el.className = cls;
      if (sp.el.disabled === live) sp.el.disabled = !live;
      setText(sp.othersEl, counts[sp.id] ? counts[sp.id] + (sp.big ? (counts[sp.id] === 1 ? ' bet · ' : ' bets · ') : ' · ') + game.money(game.round2(sums[sp.id])) : '');
    });
  }

  var tools = { undo: $('undo'), clear: $('clear'), double: $('double'), rebet: $('rebet') };
  function updateControls() {
    var betting = S.phase === 'betting', pt = total(pending), ct = confirmed ? total(confirmed) : 0, open = canBet();
    var label, sub, cls = 'confirm', dis = true;
    if (!S.gotSnapshot) { label = 'Connecting…'; sub = ''; }
    else if (placing) { label = 'Placing bet…'; sub = game.money(pt); }
    else if (ct) { label = betting ? 'Bet placed' : S.phase === 'dealing' ? 'Good luck!' : 'Your bet'; sub = game.money(ct); cls += ' confirm--placed'; }
    else if (betting && pt) { label = 'Place bet'; sub = 'Total ' + game.money(pt); cls += ' confirm--go'; dis = false; }
    else if (betting) { label = 'Place bet'; sub = 'Tap a spot to add chips'; }
    else { label = 'Bets closed'; sub = 'Next round soon'; }
    var btn = $('confirm');
    if (btn.className !== cls) btn.className = cls;
    if (btn.disabled !== dis) btn.disabled = dis;
    setText($('confirmLabel'), label);
    setText($('confirmSub'), sub);
    var state = {
      undo: open && undoStack.length > 0,
      clear: open && pt > 0,
      double: open && pt > 0 && !canAfford(doubled()),
      rebet: open && !pt && !!lastBets && !canAfford(lastBets),
    };
    for (var k in tools) if (tools[k].disabled === state[k]) tools[k].disabled = !state[k];
  }

  var histSig = '';
  function renderHistory() {
    var hist = S.history || [];
    if (!revealed && hist[0] && hist[0].round === S.round) hist = hist.slice(1);
    var list = hist.map(resultOutcome).filter(Boolean);
    var sig = list.slice(0, 90).join(',');
    if (sig === histSig) return;
    histSig = sig;
    var LET = { dragon: 'D', tiger: 'T', tie: 'TIE', suitedTie: 'ST' };
    var NAME = { dragon: 'Dragon', tiger: 'Tiger', tie: 'Tie', suitedTie: 'Suited tie' };
    var h = $('history');
    h.innerHTML = '';
    list.slice(0, 40).forEach(function (o) {
      var s = document.createElement('span');
      s.className = 'bead bead--' + o;
      s.textContent = LET[o].length > 1 ? (o === 'tie' ? '=' : 'S') : LET[o];
      s.title = NAME[o];
      h.appendChild(s);
    });
    // bead road: oldest top-left, columns of six
    var road = $('road'), recent = list.slice(0, 84).reverse();
    road.innerHTML = '';
    recent.forEach(function (o) {
      var s = document.createElement('span');
      s.className = 'bead bead--' + o;
      s.textContent = o === 'dragon' ? 'D' : o === 'tiger' ? 'T' : o === 'tie' ? '=' : 'S';
      road.appendChild(s);
    });
    road.scrollLeft = road.scrollWidth;
    var n = { dragon: 0, tiger: 0, tie: 0 };
    list.slice(0, 100).forEach(function (o) { n[o === 'suitedTie' ? 'tie' : o]++; });
    var all = Math.max(1, n.dragon + n.tiger + n.tie);
    $('roadStats').innerHTML = '';
    [['dragon', 'Dragon'], ['tiger', 'Tiger'], ['tie', 'Tie']].forEach(function (p) {
      var s = document.createElement('span');
      s.className = 't-' + p[0];
      s.textContent = p[1] + ' ' + Math.round((n[p[0]] / all) * 100) + '%';
      $('roadStats').appendChild(s);
    });
  }

  var tab = 'all', listSig = '';
  var ABBR = { dragon: 'D', tiger: 'T', tie: 'Tie', suitedTie: 'ST' };
  function cell(text, cls) { var s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; return s; }
  function spotsText(bets) { return bets.map(function (x) { return (ABBR[x.spot] || x.spot) + ' ' + x.amount.toFixed(2); }).join(' · '); }
  function renderList() {
    var rows = tab === 'all'
      ? (S.bets || []).map(function (b) {
          var bets = betsOf(b), stake = b.total != null ? Number(b.total) : bets.reduce(function (t, x) { return t + x.amount; }, 0);
          var win = !revealed ? null : b.win != null && b.win !== '' ? Number(b.win) : outcome ? bets.reduce(function (t, x) { return t + paidBack(x.spot, x.amount); }, 0) : null;
          return { who: b.player, bets: bets, stake: stake, win: win, mine: !!b.mine };
        })
      : (S.myBets || []).map(function (b) {
          return { who: new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), bets: betsOf(b), stake: Number(b.stake || b.total || 0), win: Number(b.win || 0) };
        });
    var sig = tab + '|' + JSON.stringify(rows);
    if (sig === listSig) return;
    listSig = sig;
    var list = $('list'), cols = $('cols');
    list.innerHTML = ''; cols.innerHTML = '';
    [tab === 'all' ? 'Player' : 'Time', 'Bets', 'Stake', 'Win'].forEach(function (t) { cols.appendChild(cell(t)); });
    setText($('countLabel'), tab === 'all' ? 'All bets' : 'My bets');
    setText($('betCount'), String(rows.length));
    if (!rows.length) list.appendChild(cell(tab === 'all' ? 'No bets yet this round.' : 'Your bets this visit show here.', 'empty'));
    (tab === 'all' ? rows.slice().reverse() : rows).forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'row' + (r.win > r.stake ? ' row--won' : '') + (r.mine ? ' row--mine' : '');
      row.appendChild(cell(r.who));
      row.appendChild(cell(spotsText(r.bets)));
      row.appendChild(cell(r.stake.toFixed(2)));
      row.appendChild(cell(r.win == null ? '-' : game.round2(r.win).toFixed(2), 'row__win'));
      list.appendChild(row);
    });
  }

  // betting timer ring; tick in the last seconds; chips left on the table are placed for you
  var timerEl = $('timer'), ring = $('timerRing'), secEl = $('timerSec'), lastSec = -1;
  function endsAtMs() { var e = S.endsAt; return typeof e === 'number' ? e : e ? new Date(e).getTime() : 0; }
  function updateTimer() {
    var on = S.phase === 'betting' && endsAtMs() > 0;
    var cls = 'timer' + (on ? ' timer--on' : '');
    if (!on) { if (timerEl.className !== cls) timerEl.className = cls; return; }
    var left = Math.min(BET_SECS, Math.max(0, (endsAtMs() - Date.now()) / 1000)), frac = left / BET_SECS;
    ring.style.strokeDashoffset = (100 * (1 - frac)).toFixed(2);
    ring.style.stroke = frac > 0.5 ? '#3fd08a' : frac > 0.25 ? '#f3c24a' : '#ff5a4a';
    var sec = Math.ceil(left);
    setText(secEl, String(sec));
    if (left <= 5) cls += ' timer--hurry';
    if (timerEl.className !== cls) timerEl.className = cls;
    if (sec >= 1 && sec <= 5 && sec !== lastSec) { lastSec = sec; sfx('tick', sec === 1); }
    if (left < 1.4 && left > 0 && total(pending) > 0 && !autoTried && canBet()) { autoTried = true; confirmBets(); }
  }

  var themeAt = 0, lastT = 0;
  function frame(now) {
    requestAnimationFrame(frame); // first: one bad frame must never stop the table
    var dt = lastT ? Math.min(250, now - lastT) : 16; // a slow frame still moves the table on time
    lastT = now;
    if (now - themeAt > 400) { themeAt = now; game.theme('#140605'); }
    runTweens(dt);
    dealer.update(now);
    if (FULL_W) drawScene(now);
    drawFx(Math.min(dt, 50));
    updateTimer();
  }

  // ---------------------------------------------------------------- build once
  buildFelt();
  drawDiscard();
  ['dragon', 'tiger'].forEach(function (k) { document.querySelector('.slot--' + k + ' .slot__emblem').innerHTML = emblemSVG(k); });
  SPOTS.forEach(function (sp) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'spot spot--' + sp.id; b.dataset.spot = sp.id;
    b.style.left = sp.x + 'px'; b.style.top = sp.y + 'px'; b.style.width = sp.w + 'px'; b.style.height = sp.h + 'px';
    b.innerHTML = (sp.big ? '<i class="spot__emblem">' + emblemSVG(sp.id) + '</i><span class="spot__name"></span><span class="spot__pay"></span>'
      : '<span class="spot__txt"><span class="spot__name"></span><span class="spot__pay"></span><span class="spot__others"></span></span>') + (sp.big ? '<span class="spot__others"></span>' : '');
    b.querySelector('.spot__name').textContent = sp.label;
    b.querySelector('.spot__pay').textContent = sp.pay + ' : 1';
    b.setAttribute('aria-label', 'Bet on ' + sp.label + ', pays ' + sp.pay + ' to 1');
    b.onclick = function () { placeChip(sp.id); };
    $('spots').appendChild(b);
    sp.el = b; sp.othersEl = b.querySelector('.spot__others');
  });

  tools.undo.onclick = function () { if (!undoStack.length) return; pending = undoStack.pop(); sfx('click'); renderStacks(); updateControls(); renderBalance(); };
  tools.clear.onclick = function () { if (total(pending)) setPending({}); };
  tools.double.onclick = function () { var m = doubled(), err = canAfford(m); if (err) return toastErr(err); setPending(m); };
  tools.rebet.onclick = function () { if (!lastBets) return; var err = canAfford(lastBets); if (err) return toastErr(err); setPending(copy(lastBets)); };
  $('confirm').onclick = function () { sfx('click'); confirmBets(); };
  $('back').onclick = function () { sfx('click'); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); sfx('click'); };
  $('music').onclick = function () { setMusic(!musicOn); };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  $('rulesBtn').onclick = function () {
    var r = rtp();
    Array.prototype.forEach.call(document.querySelectorAll('[data-rtp]'), function (td) { td.textContent = (r[td.dataset.rtp] * 100).toFixed(2) + '%'; });
    $('rDecks').textContent = String(DECKS); $('rSecs').textContent = String(BET_SECS);
    $('rLimits').textContent = game.money(minBet()) + ' – ' + game.money(maxBet());
    $('rules').hidden = false;
    $('rulesClose').focus();
  };
  $('rulesClose').onclick = function () { $('rules').hidden = true; };
  $('rules').onclick = function (e) { if (e.target === $('rules')) $('rules').hidden = true; };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('rules').hidden = true; });
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      sfx('click');
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      renderList();
    };
  });

  game.limitsLoaded.then(function () { sel = 0; updateChipBar(); updateControls(); });
  updateChipBar();
  setSound(soundOn);
  setMusic(musicOn);
  NXAudio.start();
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top', '.stage'].forEach(function (s) { var e = document.querySelector(s); if (e) ro.observe(e); }); }
  fit();
  booted = true;
  render();
  requestAnimationFrame(frame);
})();
