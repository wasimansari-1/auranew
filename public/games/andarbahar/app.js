/* Andar Bahar — NEXORNG live-style table game (shared timed rounds). Game logic and money:
 * ../_core/table-client.js; this file is the look: the bazaar table, the dealer's moves, card
 * dealing, chips, payouts, the bet panel, results road and bets lists.
 * Table units: the table lives in an 800 × 760 box, scaled to the play area (fit()). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var VW = 800, VH = 760, CARD_W = 70, CARD_H = 98;
  var BET_MS = 15000;
  var JOKER = { left: 365, top: 326 };
  var DISCARD = { left: 58, top: 318 };
  var CARD_X0 = 236, CARD_SPAN = 454; // first card's left edge; room for the rest of the lane
  var LANE = {
    andar: { top: 455, el: $('laneAndar'), stack: $('stackAndar'), count: $('countAndar'), all: $('allAndar') },
    bahar: { top: 575, el: $('laneBahar'), stack: $('stackBahar'), count: $('countBahar'), all: $('allBahar') },
  };
  var PHRASES = {
    betting: ['Place your bets', 'Andar or Bahar?', 'Bets are open', 'Inside or outside?', 'Choose your side', 'The table is open'],
    closed: ['No more bets', 'Bets are closed', 'Here comes the joker', 'All set — dealing'],
    waiting: ['Next round soon', 'A fresh deck is coming', 'New round coming up'],
  };
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  var game = NXTable.start({ event: '88.0084', game: 'andarbahar', onChange: render, onSignal: onSignal });
  var S = game.S;
  var snd = function (n) { ABSound.play(n); };
  var dealer = ABDealer.create($('dealerBody'), $('dealerArms'));
  var scene = ABScene.create($('bg'), $('lights'));

  // ---------------------------------------------------------------- ready / theme
  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000); // never hang the loader
  game.theme(ABScene.TOP_COLOUR);

  // ---------------------------------------------------------------- the felt (drawn once)
  function buildFelt() {
    var mandala = '';
    for (var i = 0; i < 16; i++) {
      var a = i * 22.5;
      mandala += '<path d="M400 560m0-150q22 40 0 74q-22-34 0-74z" transform="rotate(' + a + ' 400 560)"/>';
      mandala += '<circle cx="400" cy="398" r="5" transform="rotate(' + (a + 11.25) + ' 400 560)"/>';
    }
    var studs = '';
    for (var s = 0; s <= 80; s++) {
      var t = s / 80, x = -1600 + 4000 * t, y = (1 - t) * (1 - t) * 612 + 2 * t * (1 - t) * 772 + t * t * 612;
      studs += '<circle cx="' + x.toFixed(1) + '" cy="' + (y + 30).toFixed(1) + '" r="3.2"/>';
    }
    $('felt').innerHTML =
      '<defs>' +
      '<radialGradient id="fFelt" cx="400" cy="520" r="980" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#18917a"/><stop offset="0.42" stop-color="#0d6556"/><stop offset="1" stop-color="#06352e"/></radialGradient>' +
      '<pattern id="fPat" width="64" height="64" patternUnits="userSpaceOnUse"><g fill="none" stroke="#f3c35b" stroke-width="1.2" opacity="0.13"><circle cx="32" cy="32" r="9"/><path d="M32 18q6 7 0 14q-6-7 0-14zM32 46q6-7 0-14q-6 7 0 14zM18 32q7 6 14 0q-7-6-14 0zM46 32q-7 6-14 0q7-6 14 0z"/><circle cx="0" cy="0" r="3"/><circle cx="64" cy="0" r="3"/><circle cx="0" cy="64" r="3"/><circle cx="64" cy="64" r="3"/></g></pattern>' +
      '<linearGradient id="fTrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset="0.5" stop-color="#e0a83a"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>' +
      '<linearGradient id="fRail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a3a1c"/><stop offset="0.35" stop-color="#5a1e0c"/><stop offset="1" stop-color="#2a0b04"/></linearGradient>' +
      '<linearGradient id="fWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a3a1a"/><stop offset="1" stop-color="#3a1408"/></linearGradient>' +
      '</defs>' +
      '<rect x="-1600" y="300" width="4000" height="460" fill="url(#fFelt)"/>' +
      '<rect x="-1600" y="300" width="4000" height="460" fill="url(#fPat)"/>' +
      '<g fill="none" stroke="#f3c35b" stroke-width="2" opacity="0.14"><circle cx="400" cy="560" r="168"/><circle cx="400" cy="560" r="110"/><circle cx="400" cy="560" r="60"/></g>' +
      '<g fill="#f3c35b" opacity="0.1">' + mandala + '</g>' +
      '<rect x="-1600" y="292" width="4000" height="12" fill="url(#fTrim)"/>' +
      '<rect x="-1600" y="304" width="4000" height="3" fill="rgba(0,0,0,0.35)"/>' +
      // dealer's chip float
      '<rect x="150" y="314" width="176" height="50" rx="10" fill="url(#fWood)" stroke="#f3c35b" stroke-width="2"/>' +
      [['#f39c12', 160], ['#d63384', 188], ['#1e7fb8', 216], ['#1f9d55', 244], ['#5b2a86', 272], ['#c8102e', 300]].map(function (c) {
        var g = '';
        for (var k = 0; k < 4; k++) g += '<rect x="' + c[1] + '" y="' + (322 + k * 9) + '" width="24" height="8" rx="3" fill="' + c[0] + '" stroke="rgba(0,0,0,0.35)"/><rect x="' + (c[1] + 9) + '" y="' + (322 + k * 9) + '" width="6" height="8" fill="rgba(255,255,255,0.75)"/>';
        return g;
      }).join('') +
      // discard holder
      '<rect x="48" y="312" width="90" height="112" rx="10" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>' +
      '<rect x="56" y="320" width="74" height="96" rx="7" fill="none" stroke="rgba(243,195,91,0.35)" stroke-width="1.5" stroke-dasharray="4 4"/>' +
      // the shoe
      '<path d="M600 324L742 316L752 394L606 400Z" fill="url(#fWood)" stroke="#f3c35b" stroke-width="2.5"/>' +
      '<path d="M612 334L730 328L736 384L616 388Z" fill="#7a0f3e" stroke="#f3c35b" stroke-width="1.5"/>' +
      '<g stroke="#fff6e8" stroke-width="1.2" opacity="0.8"><path d="M620 340L724 335M620 350L726 345M620 360L728 355M620 370L730 365M620 380L732 375"/></g>' +
      '<path d="M598 352L612 348L616 392L602 396Z" fill="#f3c35b"/>' +
      '<text x="676" y="415" font-family="Georgia,serif" font-size="13" font-weight="700" fill="#f3c35b" opacity="0.8" text-anchor="middle" letter-spacing="2">SHOE</text>' +
      // joker frame
      '<rect x="352" y="314" width="96" height="122" rx="12" fill="rgba(0,0,0,0.18)" stroke="#f3c35b" stroke-width="2.5"/>' +
      // rail
      '<path d="M-1600 612Q400 772 2400 612V760H-1600Z" fill="url(#fRail)"/>' +
      '<path d="M-1600 612Q400 772 2400 612" fill="none" stroke="url(#fTrim)" stroke-width="5"/>' +
      '<path d="M-1600 626Q400 786 2400 626" fill="none" stroke="rgba(255,220,170,0.18)" stroke-width="6"/>' +
      '<g fill="#f3c35b" opacity="0.9">' + studs + '</g>';
  }
  buildFelt();

  // ---------------------------------------------------------------- sound / music toggles
  function stored(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : v !== 'off'; } catch (e) { return def; } }
  function store(k, on) { try { localStorage.setItem(k, on ? 'on' : 'off'); } catch (e) { /* ignore */ } }
  var soundOn = stored('andarbahar-sound', true), musicOn = stored('andarbahar-music', true);
  function syncToggles() {
    ABSound.setSound(soundOn);
    ABSound.setMusic(musicOn);
    $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    $('music').setAttribute('aria-pressed', String(musicOn)); $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  $('sound').onclick = function () { soundOn = !soundOn; store('andarbahar-sound', soundOn); syncToggles(); snd('click'); };
  $('music').onclick = function () { musicOn = !musicOn; store('andarbahar-music', musicOn); syncToggles(); };
  syncToggles();
  ABSound.start();

  // ---------------------------------------------------------------- toast
  var toastTimer, lastErrorAt = 0;
  function toast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- normalising engine data
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
  function normRank(r) {
    if (typeof r === 'number') return RANKS[(r - 1 + 13) % 13];
    r = String(r).toUpperCase();
    if (r === 'T' || r === '10') return '10';
    if (r === '1' || r === 'ACE') return 'A';
    if (r === 'JACK') return 'J'; if (r === 'QUEEN') return 'Q'; if (r === 'KING') return 'K';
    return RANKS.indexOf(r) >= 0 ? r : r.slice(0, 2);
  }
  function normSuit(s) {
    s = String(s);
    var u = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C', '♤': 'S', '♡': 'H', '♢': 'D', '♧': 'C' }[s.charAt(0)];
    return u || s.charAt(0).toUpperCase();
  }
  function parseCard(c) {
    if (c == null) return null;
    var r, s;
    if (typeof c === 'number') { r = RANKS[c % 13]; s = 'SHDC'.charAt(Math.floor(c / 13) % 4); }
    else if (typeof c === 'object') { r = c.rank != null ? c.rank : c.r; s = c.suit != null ? c.suit : c.s; }
    else { var str = String(c).trim(); s = str.slice(-1); r = str.slice(0, -1); }
    r = normRank(r); s = normSuit(s);
    return { rank: r, suit: s, red: s === 'H' || s === 'D', glyph: GLYPH[s] || s };
  }
  function sideOf(v) { // 'andar' | 'bahar' from an outcome, a history row or a spot
    if (v == null) return null;
    if (typeof v === 'object') return sideOf(v.winner != null ? v.winner : v.outcome != null ? v.outcome : v.side);
    v = String(v).toLowerCase();
    return v.charAt(0) === 'a' ? 'andar' : v.charAt(0) === 'b' ? 'bahar' : null;
  }
  function destOf(d, i, prev) {
    var t = String(d.to == null ? '' : d.to).toLowerCase();
    if (t.charAt(0) === 'j' || (!t && i === 0)) return 'joker';
    if (t.charAt(0) === 'a') return 'andar';
    if (t.charAt(0) === 'b') return 'bahar';
    return prev === 'andar' ? 'bahar' : 'andar';
  }
  function cardText(c) { return c ? c.rank + c.glyph : ''; }

  // ---------------------------------------------------------------- table state (what is drawn)
  var T = {
    booted: false, round: null, phase: null, dealt: 0, lastDest: null, lastDealAt: 0,
    joker: null, cards: [], lanes: { andar: [], bahar: [] }, resultShown: false,
  };
  var cardsBox = $('cards');

  function cardEl(c) {
    var e = document.createElement('div');
    e.className = 'card';
    var court = c.rank === 'J' || c.rank === 'Q' || c.rank === 'K';
    var idx = '<b>' + c.rank + '</b><i>' + c.glyph + '</i>';
    e.innerHTML = '<div class="card__flip"><div class="card__face card__front' + (c.red ? ' card__front--red' : '') + '">' +
      '<span class="card__idx">' + idx + '</span><span class="card__idx card__idx--br">' + idx + '</span>' +
      (court ? '<span class="card__court"><b>' + c.rank + '</b><i>' + c.glyph + '</i></span>' : '<span class="card__pip">' + c.glyph + '</span>') +
      '</div><div class="card__face card__back"></div></div>';
    return e;
  }

  function laneStep(n) { return n <= 1 ? 0 : Math.min(54, CARD_SPAN / (n - 1)); }
  function slotPos(lane, i, n) { return { left: CARD_X0 + i * laneStep(n), top: LANE[lane].top + 6 }; }
  function place(e, p) { e.style.left = p.left + 'px'; e.style.top = p.top + 'px'; }

  function relayLane(lane) {
    var list = T.lanes[lane], n = list.length;
    list.forEach(function (e, i) { place(e, slotPos(lane, i, n)); e.style.zIndex = i + 1; });
    LANE[lane].count.textContent = n ? n + (n === 1 ? ' card' : ' cards') : '';
  }

  function spawnCard(d, i, animate) {
    var c = parseCard(d.card != null ? d.card : d.c);
    if (!c) return;
    var dest = destOf(d, i, T.lastDest);
    if (dest !== 'joker') T.lastDest = dest;
    var e = cardEl(c);
    e.dataset.rank = c.rank;
    var target;
    if (dest === 'joker') {
      T.joker = c;
      e.classList.add('card--joker');
      target = JOKER;
      place(e, target);
      $('slotLabel').hidden = true;
    } else {
      T.lanes[dest].push(e);
      cardsBox.appendChild(e);
      relayLane(dest);
      target = slotPos(dest, T.lanes[dest].length - 1, T.lanes[dest].length);
    }
    T.cards.push(e);
    if (!e.parentNode) cardsBox.appendChild(e);
    var matched = dest !== 'joker' && T.joker && c.rank === T.joker.rank;
    if (!animate) {
      if (matched) markMatch(e, dest, false);
      return;
    }
    var cx = target.left + CARD_W / 2, cy = target.top + CARD_H / 2;
    var nowMs = performance.now(), quick = nowMs - T.lastDealAt < 520; // cards coming fast: shorter moves
    T.lastDealAt = nowMs;
    var lead = dealer.gesture(dest === 'joker' ? 'joker' : quick ? 'dealQuick' : 'deal', { x: cx, y: cy });
    var from = { x: dealer.SHOE.x - CARD_W / 2 - target.left, y: dealer.SHOE.y - CARD_H / 2 - target.top };
    var rot = (Math.random() * 4 - 2).toFixed(1);
    var slide = dest === 'joker' ? 560 : quick ? 380 : 500;
    e.animate([
      { transform: 'translate(' + from.x + 'px,' + from.y + 'px) rotate(-22deg) scale(0.84)', opacity: 0.0 },
      { transform: 'translate(' + (from.x * 0.92) + 'px,' + (from.y * 0.92) + 'px) rotate(-18deg) scale(0.86)', opacity: 1, offset: 0.08 },
      { transform: 'translate(0,0) rotate(' + rot + 'deg) scale(1)', opacity: 1 },
    ], { duration: slide, delay: lead, easing: 'cubic-bezier(.22,.7,.28,1)', fill: 'backwards' });
    var flipAt = dest === 'joker' ? lead + slide + 160 : lead + slide * 0.45;
    e.firstChild.animate([
      { transform: 'rotateY(-180deg) translateZ(0)' },
      { transform: 'rotateY(-90deg) translateZ(14px)', offset: 0.5 },
      { transform: 'rotateY(0deg) translateZ(0)' },
    ], { duration: 340, delay: flipAt, easing: 'ease-in-out', fill: 'backwards' });
    setTimeout(function () { snd('slide'); }, lead);
    setTimeout(function () { snd('flip'); if (dest === 'joker') { snd('joker'); dealer.react('talk'); } }, flipAt + 150);
    if (matched) setTimeout(function () { markMatch(e, dest, true); }, flipAt + 360);
  }

  function markMatch(e, dest, live) {
    e.classList.add('card--match');
    var j = T.cards[0] && T.cards[0].classList.contains('card--joker') ? T.cards[0] : null;
    if (j) j.classList.add('card--match');
    if (live) { snd('match'); dealer.react('wow'); dealer.look({ x: parseFloat(e.style.left) + 35, y: LANE[dest].top + 55 }, 1400); }
  }

  function sweepCards() {
    if (!T.cards.length) return resetTableMarks();
    var cards = T.cards.slice();
    T.cards = []; T.lanes.andar = []; T.lanes.bahar = []; T.joker = null; T.lastDest = null;
    var lead = dealer.gesture('sweep');
    snd('slide');
    cards.forEach(function (e, i) {
      var l = parseFloat(e.style.left), t = parseFloat(e.style.top);
      e.classList.remove('card--match');
      var a = e.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: 'translate(' + (DISCARD.left - l) + 'px,' + (DISCARD.top - t) + 'px) rotate(-8deg) scale(0.96)', opacity: 1 },
      ], { duration: 520, delay: lead + i * 18, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'forwards' });
      e.firstChild.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], { duration: 300, delay: lead + i * 18, fill: 'forwards' });
      a.onfinish = function () { e.remove(); };
    });
    setTimeout(function () { $('discard').hidden = false; }, lead + 400);
    resetTableMarks();
  }
  function resetTableMarks() {
    LANE.andar.count.textContent = ''; LANE.bahar.count.textContent = '';
    $('slotLabel').hidden = false;
    LANE.andar.el.classList.remove('lane--win', 'lane--lose');
    LANE.bahar.el.classList.remove('lane--win', 'lane--lose');
    $('banner').hidden = true;
  }
  // the discard pile (appears after the first round is cleared away)
  var discard = document.createElement('div');
  discard.className = 'discard'; discard.id = 'discard'; discard.hidden = true;
  $('box').insertBefore(discard, cardsBox);

  // ---------------------------------------------------------------- chips and bets
  var CHIP_K = [1, 2, 5, 10, 25];
  var chipValues = [], sel = 0;
  var pending = [], placed = [], sending = false, lastBets = null; // pending/placed: [{spot, amount, c}]
  var settle = null; // this round's result animation state

  var chipBtns = CHIP_K.map(function (k, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chipbtn';
    b.setAttribute('role', 'radio');
    b.innerHTML = '<span class="chipc chipc--' + i + '"><span class="chipc__v"></span></span>';
    b.onclick = function () { sel = i; snd('click'); syncChips(); };
    $('chips').appendChild(b);
    return b;
  });
  function chipLabel(v) { return v >= 1000 ? game.round2(v / 1000) + 'K' : v.toFixed(2).replace(/\.?0+$/, ''); }
  function syncChips() {
    var l = game.limit();
    chipValues = CHIP_K.map(function (k) { return game.round2(l.min * k); });
    chipBtns.forEach(function (b, i) {
      var v = chipValues[i], off = !!(l.max && v > l.max);
      var lab = b.querySelector('.chipc__v');
      if (lab.textContent !== chipLabel(v)) lab.textContent = chipLabel(v);
      b.disabled = off;
      b.setAttribute('aria-checked', String(i === sel));
      b.setAttribute('aria-label', 'Chip ' + game.money(v));
      b.classList.toggle('chipbtn--on', i === sel);
    });
  }
  syncChips();
  game.limitsLoaded.then(function () { sel = 0; syncChips(); updateUI(); });

  function sum(list, spot) { return game.round2(list.reduce(function (a, b) { return a + (!spot || b.spot === spot ? b.amount : 0); }, 0)); }

  function renderStack(spot, win) {
    var el = LANE[spot].stack;
    var list = placed.concat(pending).filter(function (b) { return b.spot === spot; });
    el.innerHTML = '';
    el.className = 'stack' + (pending.some(function (b) { return b.spot === spot; }) ? ' stack--pending' : '') + (win ? ' stack--win' : '');
    var chips = win ? [{ c: 'w' }, { c: 'w' }, { c: 'w' }].concat(list.slice(-2)) : list.slice(-5);
    chips.forEach(function (b, i) {
      var d = document.createElement('span');
      d.className = 'chipc chipc--' + b.c;
      d.style.transform = 'translateY(' + (-i * 5) + 'px)';
      el.appendChild(d);
    });
    var total = win || sum(list);
    if (total > 0) {
      var amt = document.createElement('span');
      amt.className = 'stack__amt';
      amt.textContent = game.money(total);
      el.appendChild(amt);
    }
  }

  var fly = $('fly');
  function centre(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.width }; }
  function flyChip(fromEl, toEl, c, delay, opts) {
    opts = opts || {};
    var a = centre(fromEl.getBoundingClientRect()), b = centre(toEl.getBoundingClientRect());
    var size = 36, s0 = (opts.s0 || a.s) / size, s1 = (opts.s1 || b.s) / size;
    var d = document.createElement('span');
    d.className = 'chipc chipc--' + c + ' fchip';
    d.style.left = (a.x - size / 2) + 'px'; d.style.top = (a.y - size / 2) + 'px';
    fly.appendChild(d);
    var dx = b.x - a.x, dy = b.y - a.y, lift = Math.min(90, 30 + Math.abs(dx) * 0.15);
    var anim = d.animate([
      { transform: 'translate(0,0) scale(' + s0 + ')', opacity: 1 },
      { transform: 'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - lift) + 'px) scale(' + (s0 + s1) * 0.6 + ')', opacity: 1, offset: 0.5 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s1 + ')', opacity: opts.fade ? 0 : 1 },
    ], { duration: opts.ms || 420, delay: delay || 0, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'both' });
    return new Promise(function (resolve) { anim.onfinish = function () { d.remove(); resolve(); }; });
  }

  function canBet(silent) {
    var why = '';
    if (S.phase !== 'betting') why = 'Bets are closed — wait for the next round.';
    else if (placed.length) why = 'Your bet for this round is placed.';
    else if (sending) why = 'Placing your bet…';
    if (why && !silent) toast(why);
    return !why;
  }

  function addChip(spot, v, c, delay, from) {
    var l = game.limit();
    if (l.max && sum(pending, spot) + v > l.max + 1e-9) { toast('Max ' + game.money(l.max) + ' per bet position.', 'error'); return false; }
    if (S.balance != null && sum(pending) + v > S.balance + 1e-9) { toast('Not enough balance.', 'error'); return false; }
    var b = { spot: spot, amount: v, c: c };
    pending.push(b);
    flyChip(from || chipBtns[c], LANE[spot].stack, c, delay, { s1: LANE[spot].stack.getBoundingClientRect().width }).then(function () {
      snd('chip');
      renderStack(spot);
    });
    return true;
  }

  Object.keys(LANE).forEach(function (spot) {
    LANE[spot].el.onclick = function () {
      ABSound.start();
      if (!canBet()) return;
      if (addChip(spot, chipValues[sel], sel, 0)) {
        dealer.look({ x: 184, y: LANE[spot].top + 55 }, 900);
        if (Math.random() < 0.3) dealer.react('nod');
        updateUI();
      }
    };
  });

  function returnChips(list) {
    list.forEach(function (b, i) {
      flyChip(LANE[b.spot].stack, chipBtns[b.c] || chipBtns[0], b.c, i * 40, { fade: true, ms: 360 });
    });
  }

  $('undo').onclick = function () {
    if (!canBet() || !pending.length) return;
    var b = pending.pop();
    snd('chip');
    returnChips([b]);
    renderStack(b.spot);
    updateUI();
  };
  $('clear').onclick = function () {
    if (!canBet() || !pending.length) return;
    var list = pending; pending = [];
    snd('chips');
    returnChips(list);
    renderStack('andar'); renderStack('bahar');
    updateUI();
  };
  $('double').onclick = function () {
    if (!canBet() || !pending.length) return;
    var l = game.limit(), add = pending.slice();
    var over = ['andar', 'bahar'].some(function (s) { return l.max && sum(pending, s) * 2 > l.max + 1e-9; });
    if (over) return toast('Max ' + game.money(l.max) + ' per bet position.', 'error');
    if (S.balance != null && sum(pending) * 2 > S.balance + 1e-9) return toast('Not enough balance.', 'error');
    add.forEach(function (b, i) { addChip(b.spot, b.amount, b.c, i * 50); });
    updateUI();
  };
  $('rebet').onclick = function () {
    if (!canBet() || pending.length || !lastBets) return;
    var i = 0;
    lastBets.forEach(function (b) {
      var left = b.amount;
      for (var c = chipValues.length - 1; c >= 0 && left > 1e-9; c--) {
        while (left + 1e-9 >= chipValues[c] && i < 40) { if (!addChip(b.spot, chipValues[c], c, i++ * 60)) return; left = game.round2(left - chipValues[c]); }
      }
    });
    updateUI();
  };
  $('place').onclick = function () { if (canBet() && pending.length) submit(); };

  function submit() {
    if (sending || !pending.length || S.phase !== 'betting') return;
    var list = pending.slice(), round = S.round;
    var bets = ['andar', 'bahar'].map(function (s) { return { spot: s, amount: sum(list, s) }; }).filter(function (b) { return b.amount > 0; });
    sending = true;
    updateUI();
    var done = function (ok) {
      sending = false;
      if (S.round !== round) { pending = []; renderStack('andar'); renderStack('bahar'); return updateUI(); }
      if (ok) {
        placed = placed.concat(list);
        pending = pending.filter(function (b) { return list.indexOf(b) < 0; });
        lastBets = bets;
        snd('chips');
        dealer.react('nod');
      } else {
        pending = pending.filter(function (b) { return list.indexOf(b) < 0; });
        returnChips(list);
        if (Date.now() - lastErrorAt > 600) toast('Bet not placed. Try again.', 'error');
      }
      renderStack('andar'); renderStack('bahar');
      updateUI();
    };
    var p;
    try { p = game.bet(bets); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (res) { done(!(res && res.ok === false)); }, function () { done(false); });
  }

  // ---------------------------------------------------------------- engine moments
  var winSignal = null, resultSignal = null;
  function onSignal(name, d) {
    d = d || {};
    if (name === 'result') resultSignal = { round: S.round, win: Number(d.win) || 0 };
    if (name === 'win') {
      winSignal = { round: S.round, win: Number(d.win) || 0, text: d.text };
      if (settle && settle.round === S.round && settle.done) finishWinToast();
    }
    if (name === 'error') { lastErrorAt = Date.now(); snd('error'); toast(d.text || 'Something went wrong.', 'error'); }
  }

  function render() {
    maybeReady();
    if (S.gotSnapshot) {
      var first = !T.booted;
      T.booted = true;
      if (S.round !== T.round) newRound(first);
      if (S.phase !== T.phase) phaseChange(S.phase, first);
      syncDeals(first);
      if ((S.phase === 'result' || S.phase === 'pause') && S.result && !T.resultShown) showResult(first);
    }
    updateUI();
    renderHistory();
    renderList();
  }

  function newRound(first) {
    T.round = S.round;
    T.dealt = 0;
    T.resultShown = false;
    if (!first) sweepCards();
    if (pending.length && !first) { returnChips(pending); }
    pending = []; placed = []; sending = false; settle = null;
    renderStack('andar'); renderStack('bahar');
    T.bettingPhrase = pick(PHRASES.betting);
  }

  function phaseChange(phase, first) {
    T.phase = phase;
    if (first) return;
    if (phase === 'betting') {
      dealer.gesture('welcome');
      snd('open');
      lastTick = 0;
    } else if (phase === 'dealing') {
      T.closedPhrase = pick(PHRASES.closed);
      dealer.gesture('close');
      snd('close');
      if (pending.length && !sending) { returnChips(pending); pending = []; renderStack('andar'); renderStack('bahar'); }
    } else if (phase === 'pause') {
      T.waitPhrase = pick(PHRASES.waiting);
      clearAfterPay(S.round);
    }
  }
  // During the pause the dealer clears the cards away, once the pay-out has finished.
  function clearAfterPay(round) {
    setTimeout(function () {
      if (S.round !== round || S.phase !== 'pause') return;
      if (settle && settle.round === round && !settle.done) return clearAfterPay(round);
      sweepCards();
    }, 900);
  }

  function syncDeals(first) {
    var deals = (S.deals || []).filter(function (d) { return d.round == null || d.round === S.round; });
    if (deals.length < T.dealt) { sweepCards(); T.dealt = 0; }
    var fresh = deals.length - T.dealt;
    for (var i = T.dealt; i < deals.length; i++) spawnCard(deals[i], i, !first && deals.length - i <= 2 && fresh <= 3);
    T.dealt = deals.length;
  }

  // Joined late (or missed steps): lay the round's cards out from the outcome, no animation.
  function reconcile(o) {
    if (!o || !o.joker || !o.andar || !o.bahar) return;
    if (T.cards.length === 1 + o.andar.length + o.bahar.length && T.joker) return;
    T.cards.forEach(function (e) { e.remove(); });
    T.cards = []; T.lanes.andar = []; T.lanes.bahar = []; T.joker = null; T.lastDest = null;
    spawnCard({ to: 'joker', card: o.joker }, 0, false);
    var n = Math.max(o.andar.length, o.bahar.length), k = 1;
    for (var i = 0; i < n; i++) ['andar', 'bahar'].forEach(function (s) { if (o[s][i]) spawnCard({ to: s, card: o[s][i] }, k++, false); });
  }

  function showResult(first) {
    T.resultShown = true;
    reconcile(S.result);
    var out = sideOf(S.result) || T.lastDest;
    if (!out) return;
    var other = out === 'andar' ? 'bahar' : 'andar';
    LANE[out].el.classList.add('lane--win');
    LANE[other].el.classList.add('lane--lose');
    if (first) return;
    var b = $('banner');
    b.className = 'banner banner--' + out;
    b.innerHTML = '';
    var big = document.createElement('strong'); big.textContent = out === 'andar' ? 'Andar wins' : 'Bahar wins';
    var sub = document.createElement('span');
    var matchRank = T.joker ? T.joker.rank : '';
    sub.textContent = matchRank ? 'The ' + matchRank + ' matched the joker' : '';
    b.appendChild(big); b.appendChild(sub);
    b.hidden = false;
    setTimeout(function () { if (T.resultShown && S.round === T.round) b.hidden = true; }, 2600);
    dealer.react('happy');
    settleMine(out, other);
  }

  // The dealer takes the losing chips and pays the winning spot; the pay then goes to the balance.
  function settleMine(out, other) {
    var stake = sum(placed);
    if (!stake) return;
    var onWin = sum(placed, out), onLose = sum(placed, other);
    var win = resultSignal && resultSignal.round === S.round ? resultSignal.win : game.round2(onWin * game.pay(S.result, out));
    // the balance shown waits for the winning chips to reach it
    var st = settle = { round: S.round, win: win, stake: stake, done: false, frozen: win > 0 ? shownBalance : null };
    var tray = $('tray');
    var t = 700;
    if (onLose) {
      setTimeout(function () {
        if (settle !== st) return;
        var lead = dealer.gesture('collect', { x: 184, y: LANE[other].top + 55 });
        var chips = placed.filter(function (b) { return b.spot === other; }).slice(-4);
        chips.forEach(function (b, i) { flyChip(LANE[other].stack, tray, b.c, lead + i * 60, { s1: 26, fade: true, ms: 480 }); });
        setTimeout(function () { snd('chips'); placed = placed.filter(function (b) { return b.spot !== other; }); renderStack(other); }, lead + 80);
      }, t);
      t += 1000;
    }
    if (onWin) {
      setTimeout(function () {
        if (settle !== st) return;
        var lead = dealer.gesture('push', { x: 184, y: LANE[out].top + 55 });
        for (var i = 0; i < 4; i++) flyChip(tray, LANE[out].stack, 'w', lead + i * 70, { s0: 26, ms: 460 });
        setTimeout(function () { snd('chips'); renderStack(out, win); }, lead + 520);
        setTimeout(function () {
          if (settle !== st) return;
          var bal = $('balance');
          for (var j = 0; j < 5; j++) flyChip(LANE[out].stack, bal, j < 3 ? 'w' : (placed[0] ? placed[0].c : 0), j * 60, { s1: 22, ms: 620, fade: true });
          placed = placed.filter(function (b) { return b.spot !== out; });
          setTimeout(function () { renderStack(out); }, 60);
          setTimeout(function () {
            st.done = true;
            updateUI();
            var big = win >= Math.max(20 * game.limit().min, 2);
            snd(big ? 'bigwin' : 'win');
            petals(big ? 36 : 18);
            if (big) { dealer.gesture('clap'); dealer.react('wow'); setTimeout(function () { snd('bangles'); }, 250); }
            finishWinToast();
          }, 700);
        }, lead + 1500);
      }, t);
    } else st.done = true;
  }
  function finishWinToast() {
    if (!settle || settle.toasted) return;
    var w = winSignal && winSignal.round === settle.round ? winSignal.win : settle.win;
    if (!(w > 0)) return;
    settle.toasted = true;
    toast(winSignal && winSignal.round === settle.round && winSignal.text ? winSignal.text : 'You won ' + game.money(w), 'win');
  }

  function petals(n) { // marigold petals burst from the table
    var r = $('box').getBoundingClientRect();
    for (var i = 0; i < n; i++) {
      var p = document.createElement('span');
      p.className = 'petal' + (i % 3 === 0 ? ' petal--y' : i % 3 === 1 ? ' petal--p' : '');
      var x = r.left + r.width * (0.3 + Math.random() * 0.4), y = r.top + r.height * 0.62;
      p.style.left = x + 'px'; p.style.top = y + 'px';
      fly.appendChild(p);
      var dx = (Math.random() - 0.5) * r.width * 0.9, dy = -r.height * (0.25 + Math.random() * 0.4);
      var a = p.animate([
        { transform: 'translate(0,0) rotate(0) scale(0.6)', opacity: 0 },
        { transform: 'translate(' + dx * 0.6 + 'px,' + dy + 'px) rotate(' + (Math.random() * 360) + 'deg) scale(1)', opacity: 1, offset: 0.45 },
        { transform: 'translate(' + dx + 'px,' + (dy * 0.2 + r.height * 0.25) + 'px) rotate(' + (Math.random() * 720) + 'deg) scale(0.9)', opacity: 0 },
      ], { duration: 1500 + Math.random() * 700, delay: Math.random() * 200, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' });
      a.onfinish = (function (el) { return function () { el.remove(); }; })(p);
    }
  }

  // ---------------------------------------------------------------- UI (texts, buttons)
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  var shownBalance = null;
  function setDisabled(el, v) { if (el.disabled !== v) el.disabled = v; }

  function phaseText() {
    if (!S.gotSnapshot) return 'Connecting…';
    if (S.phase === 'betting') return T.bettingPhrase || 'Place your bets';
    if (S.phase === 'dealing') return T.joker ? 'Joker ' + cardText(T.joker) + ' — find its match' : (T.closedPhrase || 'No more bets');
    if (S.phase === 'result') { var o = sideOf(S.result); return o ? (o === 'andar' ? 'Andar wins' : 'Bahar wins') : 'Result'; }
    return T.waitPhrase || (T.waitPhrase = pick(PHRASES.waiting));
  }

  function updateUI() {
    $('conn').hidden = S.connected || !S.gotSnapshot;
    var bal = settle && !settle.done && settle.frozen != null ? settle.frozen : S.balance;
    if (bal !== shownBalance) shownBalance = bal;
    setText($('balance'), bal == null ? '—' : game.money(bal));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');
    var pt = phaseText();
    setText($('status'), pt);
    setText($('phase'), pt);
    var stakeAll = game.round2(sum(placed) + sum(pending));
    setText($('total'), game.money(stakeAll));
    var open = S.phase === 'betting' && !placed.length && !sending;
    setDisabled($('undo'), !(open && pending.length));
    setDisabled($('clear'), !(open && pending.length));
    setDisabled($('double'), !(open && pending.length));
    setDisabled($('rebet'), !(open && !pending.length && lastBets));
    var label = 'Place bet', sub = pending.length ? game.money(sum(pending)) : 'Tap Andar or Bahar', dis = !(open && pending.length), cls = 'place';
    if (sending) { label = 'Placing…'; sub = game.money(sum(pending)); dis = true; }
    else if (placed.length) { label = 'Bet placed'; sub = game.money(sum(placed)); dis = true; cls += ' place--done'; }
    else if (S.phase !== 'betting') { label = 'Bets closed'; sub = 'Next round soon'; dis = true; }
    setText($('placeLabel'), label); setText($('placeSub'), sub);
    setDisabled($('place'), dis);
    if ($('place').className !== cls) $('place').className = cls;
    ['andar', 'bahar'].forEach(function (s) {
      LANE[s].el.classList.toggle('lane--open', open);
      var n = 0, tot = 0;
      (S.bets || []).forEach(function (b) { spotsOf(b).forEach(function (x) { if (x.spot === s) { n++; tot += x.amount; } }); });
      setText(LANE[s].all, n ? 'Table ' + game.money(game.round2(tot)) + ' · ' + n + (n === 1 ? ' bet' : ' bets') : '');
    });
    $('fRound').textContent = S.round || '—';
    $('fHash').textContent = S.hash || (S.result && S.result.hash) || '—';
    $('fSeed').textContent = S.seed || (S.result && S.result.seed) || 'revealed when the round ends';
  }

  function spotsOf(b) { // a bet row's spots: [{spot, amount}]
    var list = b.bets || (b.spot ? [{ spot: b.spot, amount: b.amount }] : []);
    return list.map(function (x) { return { spot: sideOf(x.spot), amount: Number(x.amount) || 0 }; }).filter(function (x) { return x.spot; });
  }

  function historyList() {
    return (S.history || []).map(sideOf).filter(Boolean);
  }
  var histKey = '';
  function renderHistory() {
    var h = historyList(), key = h.slice(0, 40).join(',');
    if (key === histKey) return;
    histKey = key;
    var track = $('history');
    track.innerHTML = '';
    h.slice(0, 40).forEach(function (o, i) {
      var s = document.createElement('span');
      s.className = 'bead bead--' + o + (i === 0 ? ' bead--new' : '');
      s.textContent = o === 'andar' ? 'A' : 'B';
      track.appendChild(s);
    });
    if (tab === 'road') renderList(true);
  }

  // ---- bets list / my bets / road ---------------------------------------------------
  var tab = 'all', listKey = '';
  function cell(text, cls) { var s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; return s; }
  function hue(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return h % 360; }
  function sideCell(spot) { return cell(spot === 'andar' ? 'Andar' : spot === 'bahar' ? 'Bahar' : String(spot || '-'), 'side side--' + spot); }

  function renderList(force) {
    var bets = S.bets || [];
    var mine = S.myBets || [];
    var key = tab + '|' + bets.length + '|' + bets.map(function (b) { return b.win == null ? '' : b.win; }).join(',') + '|' + mine.length + '|' + histKey;
    if (!force && key === listKey) return;
    listKey = key;
    var list = $('list'), cols = $('cols');
    list.innerHTML = '';
    cols.hidden = tab === 'road';
    if (tab === 'all') {
      setText($('countLabel'), 'All bets'); setText($('betCount'), String(bets.length));
      cols.innerHTML = '<span>Player</span><span>Side</span><span>Bet</span><span>Win</span>';
      if (!bets.length) list.appendChild(cell('No bets yet this round.', 'empty'));
      bets.slice().reverse().forEach(function (b) {
        var row = document.createElement('div');
        var spots = spotsOf(b), won = Number(b.win) > 0;
        row.className = 'row' + (won ? ' row--won' : '') + (b.mine ? ' row--mine' : '');
        var user = document.createElement('span');
        user.className = 'row__user';
        var name = String(b.player || 'Player');
        var av = document.createElement('i');
        av.className = 'avatar';
        av.style.background = 'hsl(' + hue(name) + ' 70% 45%)';
        av.textContent = name.charAt(0).toUpperCase();
        user.appendChild(av); user.appendChild(cell(name));
        row.appendChild(user);
        row.appendChild(spots.length === 1 ? sideCell(spots[0].spot) : cell(spots.map(function (x) { return x.spot === 'andar' ? 'A' : 'B'; }).join(' + '), 'side'));
        row.appendChild(cell(Number(b.total != null ? b.total : b.amount).toFixed(2)));
        row.appendChild(cell(won ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else if (tab === 'mine') {
      setText($('countLabel'), 'My bets'); setText($('betCount'), String(mine.length));
      cols.innerHTML = '<span>Round</span><span>Side</span><span>Bet</span><span>Win</span>';
      if (!mine.length) list.appendChild(cell('Your bets this visit show here.', 'empty'));
      mine.forEach(function (m) {
        var row = document.createElement('div'), w = Number(m.win) || 0, o = sideOf(m.outcome);
        row.className = 'row' + (w > 0 ? ' row--won' : '');
        row.appendChild(cell('#' + m.round + ' · ' + new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })));
        row.appendChild(cell(spotsOf(m).map(function (x) { return (x.spot === o ? '✓' : '') + (x.spot === 'andar' ? 'A' : 'B'); }).join(' + '), 'side'));
        row.appendChild(cell(Number(m.stake).toFixed(2)));
        row.appendChild(cell(w > 0 ? w.toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      var h = historyList();
      setText($('countLabel'), 'Last rounds'); setText($('betCount'), String(h.length));
      var a = h.filter(function (x) { return x === 'andar'; }).length, n = h.length || 1;
      var stats = document.createElement('div');
      stats.className = 'road__stats';
      stats.innerHTML = '<span class="side side--andar"></span><span class="road__bar"><i></i></span><span class="side side--bahar"></span>';
      stats.children[0].textContent = 'Andar ' + Math.round(a / n * 100) + '%';
      stats.children[2].textContent = Math.round((h.length - a) / n * 100) + '% Bahar';
      stats.querySelector('i').style.width = (a / n * 100) + '%';
      list.appendChild(stats);
      // bead plate: oldest top-left, filling each column top to bottom, 6 rows
      var plate = document.createElement('div');
      plate.className = 'road';
      h.slice(0, 60).reverse().forEach(function (o) {
        var s = document.createElement('span');
        s.className = 'bead bead--' + o;
        s.textContent = o === 'andar' ? 'A' : 'B';
        plate.appendChild(s);
      });
      list.appendChild(plate);
      if (!h.length) list.appendChild(cell('Results show here.', 'empty'));
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      snd('click');
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      renderList(true);
    };
  });

  // ---------------------------------------------------------------- rules + fair
  (function rtp() { // exact: chance that the side receiving the first card after the joker wins
    var C = function (n, k) { if (k < 0 || k > n) return 0; var r = 1; for (var i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
    var first = 0;
    for (var k = 1; k <= 49; k += 2) first += C(51 - k, 2) / C(51, 3);
    // the first card always goes to Andar
    $('rtpA').textContent = (first * game.pay({ winner: 'andar' }, 'andar') * 100).toFixed(2) + '%';
    $('rtpB').textContent = ((1 - first) * game.pay({ winner: 'bahar' }, 'bahar') * 100).toFixed(2) + '%';
  })();
  function openRules(on) {
    var l = game.limit();
    $('limits').textContent = l.max ? game.money(l.min) + ' – ' + game.money(l.max) : 'from ' + game.money(l.min);
    $('rules').hidden = !on;
    if (on) $('rulesClose').focus();
  }
  $('rulesBtn').onclick = function () { snd('click'); openRules(true); };
  $('rulesClose').onclick = function () { snd('click'); openRules(false); };
  $('rules').onclick = function (e) { if (e.target === $('rules')) openRules(false); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('rules').hidden) openRules(false); });
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  $('back').onclick = function () { snd('click'); game.back(); };

  // ---------------------------------------------------------------- layout
  var stage = document.querySelector('.stage'), world = $('world'), box = $('box');
  var LEFT = 0, TOP = 0, W = 0, H = 0, K = 1;
  function fit() {
    var r = stage.getBoundingClientRect();
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    W = r.width - LEFT;
    var bar = document.querySelector('.top').getBoundingClientRect();
    TOP = Math.max(0, bar.bottom - r.top + 6);
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 4 : r.height;
    H = Math.max(160, playBottom - TOP);
    stage.style.setProperty('--left', LEFT + 'px');
    stage.style.setProperty('--below', Math.max(0, r.height - playBottom) + 'px');
    K = Math.min(W / VW, H / VH);
    var ox = (W - VW * K) / 2, oy = H - VH * K;
    world.style.left = LEFT + 'px'; world.style.top = TOP + 'px';
    world.style.width = W + 'px'; world.style.height = H + 'px';
    box.style.transform = 'translate(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px) scale(' + K.toFixed(4) + ')';
    scene.resize({ w: r.width, h: r.height, dpr: Math.min(window.devicePixelRatio || 1, 1.5), horizon: TOP + oy + 300 * K, k: K });
  }
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top', '.stage'].forEach(function (s) { var e = document.querySelector(s); if (e) ro.observe(e); }); }

  // ---------------------------------------------------------------- frame
  var C = 2 * Math.PI * 54, lastTick = 0, sceneAt = 0;
  function frame(now) {
    dealer.update(now);
    if (now - sceneAt > 38) { sceneAt = now; scene.draw(now); } // the bazaar's slow lights: ~25 fps is plenty
    // betting timer ring around the joker slot
    var ring = $('timerRing'), num = $('timerNum'), slot = $('jokerSlot');
    if (S.phase === 'betting' && S.endsAt) {
      var endsAt = typeof S.endsAt === 'number' ? S.endsAt : Date.parse(S.endsAt);
      var left = Math.max(0, endsAt - Date.now()), total = Math.max(BET_MS, left);
      var p = left / total, secs = Math.ceil(left / 1000);
      ring.style.strokeDashoffset = (C * (1 - p)).toFixed(1);
      ring.style.stroke = p > 0.5 ? '#3fe07a' : p > 0.2 ? '#ffcf3f' : '#ff5a3c';
      setText(num, left > 0 ? String(secs) : '');
      if (!slot.classList.contains('slot--timer')) slot.classList.add('slot--timer');
      if (secs <= 5 && secs > 0 && secs !== lastTick) { lastTick = secs; snd('tick'); }
      if (pending.length && !sending && !placed.length && left < 1300 && left > 0) submit(); // chips on the table are placed as betting closes
    } else if (slot.classList.contains('slot--timer')) { slot.classList.remove('slot--timer'); setText(num, ''); }
    requestAnimationFrame(frame);
  }

  fit();
  render();
  requestAnimationFrame(frame);
})();
