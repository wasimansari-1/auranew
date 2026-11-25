/* Lucky 7 — NEXORNG live-style table game (88.0081). Shared timed rounds from the table engine
 * (../_core/table-client.js); this file is the table: betting board, chips, timer ring, results
 * road, bets lists, rules, provably-fair panel, and it drives the host (scene.js) and the
 * WebAudio cues (audio.js). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXTable.start({ event: '88.0081', game: 'lucky7', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- rules
  var SPOTS = [
    { id: 'low', label: 'Low', sub: 'A – 6', pay: 1, big: true, wins: 'A, 2, 3, 4, 5, 6', rtp: '92.31%' },
    { id: 'seven', label: '7', name: 'Seven', sub: 'Lucky seven', pay: 11, big: true, wins: 'Any 7', rtp: '92.31%' },
    { id: 'high', label: 'High', sub: '8 – K', pay: 1, big: true, wins: '8, 9, 10, J, Q, K', rtp: '92.31%' },
    { id: 'red', label: 'Red', sub: '♥ ♦', pay: 0.95, wins: 'Hearts or diamonds', rtp: '97.50%' },
    { id: 'black', label: 'Black', sub: '♠ ♣', pay: 0.95, wins: 'Spades or clubs', rtp: '97.50%' },
    { id: 'odd', label: 'Odd', sub: 'A 3 5 9 J K', pay: 1, wins: 'A, 3, 5, 9, J, K (not 7)', rtp: '92.31%' },
    { id: 'even', label: 'Even', sub: '2 4 6 8 10 Q', pay: 1, wins: '2, 4, 6, 8, 10, Q', rtp: '92.31%' },
  ];
  var BY_ID = {};
  SPOTS.forEach(function (s) { BY_ID[s.id] = s; });
  function nameOf(id) { var s = BY_ID[id]; return s ? s.name || s.label : id; }
  function payText(p) { return (p === 0.95 ? '0.95' : String(p)) + ':1'; }

  var SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  var RANK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  // Cards may come as "7H" / "10D" / "TD" / "7♥", {rank, suit}, or 0–51.
  function parseCard(c) {
    if (c == null || c === '') return null;
    var r, s;
    if (typeof c === 'number') { r = (c % 13) + 1; s = 'SHDC'[Math.floor(c / 13) % 4]; }
    else if (typeof c === 'object') {
      if (c.card != null) return parseCard(c.card);
      r = c.rank != null ? c.rank : c.r != null ? c.r : c.value; s = c.suit != null ? c.suit : c.s;
      if (typeof r === 'string') r = rankOf(r);
      s = suitOf(String(s || ''));
    } else {
      var t = String(c).trim();
      s = suitOf(t.slice(-1)); r = rankOf(t.slice(0, -1));
      if (!s) { s = suitOf(t.charAt(0)); r = rankOf(t.slice(1)); } // "H7"
    }
    r = Number(r);
    if (!s || !(r >= 1 && r <= 13)) return null;
    return { r: r, s: s, label: RANK[r] || String(r), sym: SUIT[s], red: s === 'H' || s === 'D', key: r + s };
  }
  function rankOf(t) {
    t = String(t).trim().toUpperCase();
    if (t === 'A') return 1; if (t === 'J') return 11; if (t === 'Q') return 12; if (t === 'K') return 13; if (t === 'T') return 10;
    return Number(t);
  }
  function suitOf(ch) {
    ch = String(ch).toUpperCase();
    if ('SHDC'.indexOf(ch) >= 0 && ch) return ch;
    return { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C', '♤': 'S', '♡': 'H', '♢': 'D', '♧': 'C' }[ch] || '';
  }
  function band(c) { return c.r === 7 ? 'seven' : c.r < 7 ? 'low' : 'high'; }
  function localWinners(c) {
    var w = [band(c), c.red ? 'red' : 'black'];
    if (c.r !== 7) w.push(c.r % 2 ? 'odd' : 'even');
    return w;
  }
  // The engine's outcome decides; the local rules are the fallback when it only names the card.
  function returnOf(outcome, id) { // stake + win per unit staked (2 = 1:1, 0 = lost)
    if (typeof game.pay === 'function') { var v = Number(game.pay(outcome, id)); if (isFinite(v)) return v; }
    var c = cardOfResult(outcome);
    return c && localWinners(c).indexOf(id) >= 0 ? 1 + BY_ID[id].pay : 0;
  }
  function winnersOf(result, c) {
    if (typeof game.pay === 'function' && result) return SPOTS.filter(function (s) { return returnOf(result, s.id) > 1; }).map(function (s) { return s.id; });
    var o = result && (result.outcome != null ? result.outcome : result);
    var list = Array.isArray(o) ? o : o && (o.win || o.wins || o.winners || o.spots);
    if (Array.isArray(list) && list.length) return list.map(function (x) { return String(x).toLowerCase(); });
    return c ? localWinners(c) : [];
  }
  function cardOfResult(result) {
    if (!result) return null;
    var o = result.outcome;
    return parseCard(result.card) || (o && typeof o === 'object' ? parseCard(o.card || o) : null);
  }
  function cardOfHistory(h) {
    if (h == null) return null;
    if (typeof h !== 'object') return parseCard(h);
    return parseCard(h.card) || cardOfResult(h) || parseCard(h.outcome);
  }
  function lastDealCard() {
    var d = S.deals || [];
    for (var i = d.length - 1; i >= 0; i--) {
      if (d[i] && (d[i].round == null || d[i].round === S.round)) { var c = parseCard(d[i].card); if (c) return c; }
    }
    return null;
  }

  // ---------------------------------------------------------------- sound + music
  var soundOn = true, musicOn = true;
  try { soundOn = localStorage.getItem('lucky7-sound') !== 'off'; musicOn = localStorage.getItem('lucky7-music') !== 'off'; } catch (e) { /* defaults */ }
  L7Audio.setSound(soundOn); L7Audio.setMusic(musicOn);
  L7Audio.unlock(); // the tap that opened the game usually allows it; else the first tap here
  window.addEventListener('pointerdown', function () { L7Audio.unlock(); }, true);
  function cue(n) { L7Audio.cue(n); }
  function syncToggles() {
    $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    $('music').setAttribute('aria-pressed', String(musicOn)); $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  syncToggles();
  $('sound').onclick = function () {
    soundOn = !soundOn; L7Audio.setSound(soundOn); cue('click');
    try { localStorage.setItem('lucky7-sound', soundOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncToggles();
  };
  $('music').onclick = function () {
    musicOn = !musicOn; L7Audio.setMusic(musicOn); cue('click');
    try { localStorage.setItem('lucky7-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncToggles();
  };

  // ---------------------------------------------------------------- toast
  var toastTimer;
  function toast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- board (built once)
  var spotEls = {};
  SPOTS.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'spot spot--' + s.id + (s.big ? ' spot--big' : '');
    b.dataset.spot = s.id;
    b.setAttribute('aria-label', (s.name || s.label) + ' pays ' + payText(s.pay));
    b.innerHTML = '<span class="spot__others"></span><span class="spot__label"></span><span class="spot__sub"></span>' +
      '<span class="spot__pay"></span><span class="spot__stack"></span>';
    b.querySelector('.spot__label').textContent = s.label;
    b.querySelector('.spot__sub').textContent = s.sub;
    b.querySelector('.spot__pay').textContent = payText(s.pay);
    b.onclick = function () { addChip(s.id); };
    $('board').appendChild(b);
    spotEls[s.id] = { el: b, stack: b.querySelector('.spot__stack'), others: b.querySelector('.spot__others'), key: '', okey: '' };
  });
  // rules table
  SPOTS.forEach(function (s) {
    var tr = document.createElement('tr');
    [s.name || s.label, s.wins, payText(s.pay), s.rtp].forEach(function (v) { var td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
    $('paysBody').appendChild(tr);
  });

  // ---------------------------------------------------------------- chips
  var chipValues = [0.1, 0.2, 0.5, 1, 2.5], chipIdx = 0, chipBtns = [];
  function chipLabel(v) {
    if (v >= 1000) return (Math.round(v / 100) / 10) + 'K';
    return String(Math.round(v * 100) / 100);
  }
  function tierOf(v) { // colour by the chip value it is closest to (from below)
    var t = 0;
    for (var i = 0; i < chipValues.length; i++) if (v >= chipValues[i] - 1e-9) t = i;
    return t;
  }
  function chipEl(v, tier) {
    var el = document.createElement('span');
    el.className = 'chipc';
    el.dataset.t = String(tier == null ? tierOf(v) : tier);
    var s = document.createElement('span'); s.textContent = chipLabel(v); el.appendChild(s);
    return el;
  }
  function buildChips() {
    var box = $('chips');
    box.innerHTML = '';
    chipBtns = chipValues.map(function (v, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', 'Chip ' + game.money(v));
      b.appendChild(chipEl(v, i));
      b.onclick = function () { chipIdx = i; cue('click'); syncChips(); };
      box.appendChild(b);
      return b;
    });
    syncChips();
  }
  function syncChips() { chipBtns.forEach(function (b, i) { b.setAttribute('aria-checked', String(i === chipIdx)); }); }
  buildChips();
  game.limitsLoaded.then(function (l) {
    var min = Number(l && l.min) || 0.1, max = Number(l && l.max) || 100;
    chipValues = [1, 2, 5, 10, 25].map(function (m) { return game.round2(min * m); }).filter(function (v) { return v <= max + 1e-9; });
    chipIdx = 0; // the min bet is preselected
    buildChips();
    $('limitNote').textContent = 'Bets from ' + game.money(min) + ' to ' + game.money(max) + ' per spot.';
    renderBoard();
  });
  $('limitNote').textContent = 'Bets from ' + game.money(0.1) + ' to ' + game.money(100) + ' per spot.';

  // ---------------------------------------------------------------- my bet for the round
  var pending = []; // chips placed but not sent yet, in order (undo)
  var sent = null; // { round, bets: {spot: amount}, total, status: sending|placed }
  var lastLayout = null; // what I bet last round (rebet)
  function sum(map) { var t = 0; for (var k in map) t += map[k]; return game.round2(t + 1e-9); }
  function pendingMap() {
    var m = {};
    pending.forEach(function (p) { m[p.spot] = game.round2((m[p.spot] || 0) + p.amount + 1e-9); });
    return m;
  }
  function spotTotal(id) {
    var t = 0;
    pending.forEach(function (p) { if (p.spot === id) t += p.amount; });
    if (sent && sent.round === S.round && sent.bets[id]) t += sent.bets[id];
    return game.round2(t + 1e-9);
  }
  function bettingOpen() { return S.phase === 'betting' && (!S.endsAt || S.endsAt - Date.now() > 300); }
  function limitMax() { var l = game.limit(); return Number(l && l.max) || 100; }
  function limitMin() { var l = game.limit(); return Number(l && l.min) || 0.1; }
  function canAdd(id, v, quiet) {
    if (!bettingOpen()) { if (!quiet) toast('Bets are closed — wait for the next round'); return 0; }
    if (sent && sent.round === S.round) { if (!quiet) toast('Your bet is placed for this round'); return 0; }
    var room = game.round2(limitMax() - spotTotal(id) + 1e-9);
    if (room < limitMin() - 1e-9) { if (!quiet) toast('Max ' + game.money(limitMax()) + ' per spot'); return 0; }
    v = Math.min(v, room);
    var free = game.round2((S.balance == null ? Infinity : S.balance) - sum(pendingMap()) + 1e-9);
    if (v > free + 1e-9) { if (!quiet) { toast('Not enough balance', 'error'); cue('error'); } return 0; }
    return game.round2(v + 1e-9);
  }
  function addChip(id) {
    var v = canAdd(id, chipValues[chipIdx] || limitMin());
    if (!v) return;
    pending.push({ spot: id, amount: v });
    cue('chip');
    var src = centerOf(chipBtns[chipIdx] || $('chips'));
    flyChip(src, stackPoint(id), v, null, { dur: 380, lift: -40, done: function () { renderBoard(); } });
    renderBoard(true);
    updateButtons();
  }

  $('undo').onclick = function () { if (pending.length) { pending.pop(); cue('chip'); renderBoard(); updateButtons(); } };
  $('clear').onclick = function () { if (pending.length) { pending = []; cue('chips'); renderBoard(); updateButtons(); } };
  $('double').onclick = function () {
    var m = pendingMap(), any = false;
    Object.keys(m).forEach(function (id) {
      var v = canAdd(id, m[id], any);
      if (v) { pending.push({ spot: id, amount: v }); any = true; }
    });
    if (any) { cue('chips'); renderBoard(); updateButtons(); }
  };
  $('rebet').onclick = function () {
    if (!lastLayout) return;
    var any = false;
    Object.keys(lastLayout).forEach(function (id) {
      var v = canAdd(id, lastLayout[id], any);
      if (v) { pending.push({ spot: id, amount: v }); any = true; flyChip(centerOf($('rebet')), stackPoint(id), v, null, { dur: 420 }); }
    });
    if (any) { cue('chips'); renderBoard(); updateButtons(); }
  };
  $('place').onclick = function () { submit(false); };

  function submit(auto) {
    if (!pending.length || (sent && sent.round === S.round) || S.phase !== 'betting') return;
    var map = pendingMap(), list = Object.keys(map).map(function (id) { return { spot: id, amount: map[id] }; });
    var mine = sent = { round: S.round, bets: map, total: sum(map), status: 'sending', auto: auto };
    var keep = pending;
    pending = [];
    renderBoard(); updateButtons();
    var done = function (res) {
      if (sent !== mine) return;
      if (res && res.ok === false) {
        sent = null;
        if (bettingOpen()) pending = keep; // let the player try again
      } else {
        mine.status = 'placed';
        if (res && res.balance != null && S.balance == null) S.balance = Number(res.balance);
        lastLayout = JSON.parse(JSON.stringify(map));
        cue('chips');
        L7Scene.gesture('nod');
      }
      renderBoard(); updateButtons(); render();
    };
    var p;
    try { p = game.bet(list); } catch (e) { p = Promise.resolve({ ok: false }); }
    Promise.resolve(p).then(done, function () { done({ ok: false }); });
  }

  // ---------------------------------------------------------------- fly layer
  function centerOf(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function stackPoint(id) { var r = spotEls[id].el.getBoundingClientRect(); return { x: r.right - 10, y: r.top + 6 }; }
  function flyChip(from, to, v, tier, o) {
    o = o || {};
    var el = chipEl(v, tier);
    $('fly').appendChild(el);
    var mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2 + (o.lift == null ? -60 : o.lift);
    var a = el.animate([
      { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(' + (o.s0 || 1) + ')', opacity: 1 },
      { transform: 'translate(' + mx + 'px,' + my + 'px) scale(' + (o.sm || 1.15) + ')', opacity: 1, offset: 0.5 },
      { transform: 'translate(' + to.x + 'px,' + to.y + 'px) scale(' + (o.s1 || 0.9) + ')', opacity: o.fade ? 0 : 1 },
    ], { duration: o.dur || 480, delay: o.delay || 0, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
    a.onfinish = function () { el.remove(); if (o.done) o.done(); };
  }

  // ---------------------------------------------------------------- board render
  function stackHtml(el, amount, isSent) {
    el.innerHTML = '';
    if (!amount) return;
    var n = Math.min(4, 1 + Math.floor(Math.log(amount / limitMin() + 1) / Math.log(3)));
    for (var i = 0; i < n; i++) el.appendChild(chipEl(amount, tierOf(amount)));
    var amt = document.createElement('span');
    amt.className = 'spot__amt';
    amt.textContent = game.money(amount);
    el.appendChild(amt);
    el.classList.toggle('spot__stack--sent', !!isSent);
  }
  var resultSpots = null; // { win: [...] } while the result shows
  function renderBoard(skipLast) {
    var open = bettingOpen() && !(sent && sent.round === S.round);
    SPOTS.forEach(function (s) {
      var e = spotEls[s.id];
      var amt = spotTotal(s.id);
      if (skipLast && pending.length && pending[pending.length - 1].spot === s.id) amt = game.round2(amt - pending[pending.length - 1].amount + 1e-9); // the flying chip lands first
      var isSent = !!(sent && sent.round === S.round && sent.bets[s.id]);
      var key = amt + '|' + isSent + '|' + (sent && sent.status);
      if (key !== e.key) { e.key = key; stackHtml(e.stack, amt, isSent && sent.status === 'placed'); }
      e.el.classList.toggle('spot--closed', !open);
      e.el.classList.toggle('spot--mine', amt > 0);
      var win = resultSpots && resultSpots.indexOf(s.id) >= 0;
      e.el.classList.toggle('spot--win', !!win);
      e.el.classList.toggle('spot--lose', !!resultSpots && !win);
    });
  }
  function betsOf(b) { return Array.isArray(b.bets) ? b.bets : b.spot ? [{ spot: b.spot, amount: b.amount }] : []; }
  function renderOthers() {
    var tot = {}, who = {};
    (S.bets || []).forEach(function (b) {
      if (b.mine) return;
      betsOf(b).forEach(function (x) {
        tot[x.spot] = (tot[x.spot] || 0) + (Number(x.amount) || 0);
        who[x.spot] = who[x.spot] || {}; who[x.spot][b.player] = 1;
      });
    });
    SPOTS.forEach(function (s) {
      var e = spotEls[s.id], n = who[s.id] ? Object.keys(who[s.id]).length : 0;
      var t = n ? game.money(tot[s.id]) : '';
      e.others.title = n ? n + (n === 1 ? ' player' : ' players') + ' on ' + nameOf(s.id) : '';
      if (t !== e.okey) { e.okey = t; e.others.textContent = t; }
    });
  }

  // ---------------------------------------------------------------- buttons (built once)
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  function setDis(el, d) { if (el.disabled !== d) el.disabled = d; }
  function updateButtons() {
    var open = bettingOpen(), mine = sent && sent.round === S.round, pTot = sum(pendingMap());
    setDis($('undo'), !open || !pending.length);
    setDis($('clear'), !open || !pending.length);
    setDis($('double'), !open || !pending.length);
    setDis($('rebet'), !open || !!mine || !lastLayout || pending.length > 0);
    var place = $('place'), label = 'Place bet', sub = '', dis = true, cls = 'place';
    if (mine && sent.status === 'sending') { label = 'Placing bet…'; sub = game.money(sent.total); }
    else if (mine) { label = 'Bet placed'; sub = game.money(sent.total) + ' · good luck!'; cls = 'place place--sent'; }
    else if (open && pending.length) { label = 'Place bet'; sub = game.money(pTot); dis = false; }
    else if (open) { label = 'Tap a spot to bet'; sub = 'Chip ' + game.money(chipValues[chipIdx] || limitMin()); }
    else if (S.phase === 'betting') { label = 'Bets closing'; }
    else { label = S.phase === 'dealing' ? 'No more bets' : 'Next round soon'; sub = 'Choose your chip'; }
    if (place.className !== cls) place.className = cls;
    setDis(place, dis);
    setText($('placeLabel'), label); setText($('placeSub'), sub);
  }

  // ---------------------------------------------------------------- phrases
  var CLOSE = ['No more bets', 'Bets are closed', 'Here comes the card', 'Eyes on the shoe', 'Good luck, everyone', 'Card coming up'];
  var PAUSE = ['Fresh shoe for the next round', 'Shuffling a new shoe', 'Next round coming up', 'Get your chips ready', 'Stay at the table'];
  var lastPick = {};
  function pick(list, kind) {
    var i = Math.floor(Math.random() * list.length);
    if (list[i] === lastPick[kind]) i = (i + 1) % list.length;
    return (lastPick[kind] = list[i]);
  }
  function phrase(t) {
    var el = $('phrase');
    if (el.textContent === t) return;
    el.textContent = t;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }

  // ---------------------------------------------------------------- the round on the table
  var seenRound = 0, seenPhase = '', liveRound = 0, dealtRound = 0, dealDone = null, revealedRound = 0, closedRound = 0;
  var winQueue = null, payoutRound = 0, dealtDoneRound = 0, holdBalance = false, shownBalance = null, bettingTotal = 15000, lastCallRound = 0, tickSec = -1;

  function onPhase() {
    if (S.phase === 'betting') {
      liveRound = S.round;
      resultSpots = null; $('banner').hidden = true; $('phrase').hidden = false; pending = [];
      if (winQueue) { toast(winQueue, 'win'); winQueue = null; }
      if (sent && sent.round !== S.round) sent = null;
      if (L7Scene.cardOn()) L7Scene.discard();
      L7Scene.phase('betting');
      L7Scene.gesture('welcome');
      cue('open');
      phrase(NXPhrases.pick('betting'));
    } else if (S.phase === 'dealing') {
      closeBets();
    } else if (S.phase === 'result') {
      L7Scene.phase('result');
    } else if (S.phase === 'waiting') {
      phrase('Joining the table…');
    }
  }
  // Betting time is up (the engine deals about a second later): "no more bets".
  function closeBets() {
    if (closedRound === S.round) return;
    closedRound = S.round;
    L7Scene.phase('dealing');
    if (pending.length && !(sent && sent.round === S.round)) { pending = []; toast('Bets closed before your chips were sent'); }
    if (liveRound === S.round) { L7Scene.gesture('noMore'); cue('close'); }
    phrase(pick(CLOSE, 'close'));
    renderBoard(); updateButtons();
  }
  // After the payout the host clears the card to the discard tray while the next round gets ready.
  function afterRound(delay) {
    var r = S.round;
    setTimeout(function () {
      if (S.round !== r || S.phase !== 'result') return;
      L7Scene.discard();
      resultSpots = null; renderBoard();
      phrase(pick(PAUSE, 'pause'));
    }, delay);
  }

  function faceHtml(c) {
    return '<div class="card__ink' + (c.red ? ' red' : '') + '">' +
      '<span class="card__corner card__corner--tl"><b>' + c.label + '</b><i>' + c.sym + '</i></span>' +
      '<span class="card__mid"><b>' + c.label + '</b><i>' + c.sym + '</i></span>' +
      '<span class="card__corner card__corner--br"><b>' + c.label + '</b><i>' + c.sym + '</i></span></div>';
  }

  function syncDeal() {
    if (dealtRound === S.round) return;
    var c = lastDealCard() || (S.phase === 'result' ? cardOfResult(S.result) : null);
    if (!c) return;
    dealtRound = S.round;
    if (liveRound === S.round && (S.phase === 'dealing' || S.phase === 'result')) {
      dealDone = L7Scene.deal(c.key, faceHtml(c));
    } else {
      L7Scene.showCard(c.key, faceHtml(c));
      dealDone = Promise.resolve();
    }
    var r = S.round;
    dealDone.then(function () { dealtDoneRound = r; render(); });
  }

  function maybeReveal() {
    if (!S.result || revealedRound === S.round || dealtRound !== S.round) return;
    if (S.result.round != null && S.result.round !== S.round) return;
    revealedRound = S.round;
    var c = cardOfResult(S.result) || lastDealCard();
    if (!c) return;
    var win = winnersOf(S.result, c);
    resultSpots = win;
    renderBoard();
    showBanner(c, win);
    phrase(c.label === 'A' ? 'Ace of ' + SUIT_NAME[c.s] : c.r > 10 ? { 11: 'Jack', 12: 'Queen', 13: 'King' }[c.r] + ' of ' + SUIT_NAME[c.s] : c.label + ' of ' + SUIT_NAME[c.s]);
    cue(c.r === 7 ? 'seven' : 'reveal');
    var live = liveRound === S.round;
    var mine = sent && sent.round === S.round && sent.status === 'placed' ? sent : null;
    var myWin = 0;
    var back = function (id) { return game.round2(mine.bets[id] * returnOf(S.result, id) + 1e-9); }; // stake + win on a spot
    if (mine) Object.keys(mine.bets).forEach(function (id) { myWin += back(id); });
    myWin = game.round2(myWin + 1e-9);
    if (live) {
      if (c.r === 7) L7Scene.react('seven');
      else if (mine && myWin >= Math.max(5 * mine.total, 10)) L7Scene.react('bigwin');
      else if (myWin > 0) L7Scene.react('win');
      else { L7Scene.react('plain'); L7Scene.gesture('present'); }
    }
    if (!mine || !live) { holdBalance = false; payoutDone(); afterRound(2600); return; }
    // payout: losing chips go to the dealer's float, winners are paid from it, then to the balance
    var losers = Object.keys(mine.bets).filter(function (id) { return win.indexOf(id) < 0; });
    var winners = Object.keys(mine.bets).filter(function (id) { return win.indexOf(id) >= 0; });
    setTimeout(function () {
      if (losers.length) {
        L7Scene.gesture('sweep');
        losers.forEach(function (id, i) {
          var t = L7Scene.toScreen(430 + Math.random() * 60, 462);
          flyChip(stackPoint(id), t, mine.bets[id], null, { dur: 620, delay: i * 90, lift: -50, s1: 0.5 * t.k + 0.3, fade: true });
        });
        setTimeout(function () { L7Scene.collect(); losers.forEach(function (id) { delete mine.bets[id]; }); renderBoard(); cue('chips'); }, 650);
        if (!winners.length) cue('lose');
      }
    }, 700);
    if (winners.length) {
      setTimeout(function () {
        L7Scene.gesture('pay');
        winners.forEach(function (id, i) {
          var from = L7Scene.toScreen(570 + Math.random() * 50, 462), paid = game.round2(back(id) - mine.bets[id] + 1e-9);
          flyChip(from, stackPoint(id), paid, null, { dur: 640, delay: 250 + i * 110, lift: -30, s0: 0.5 * from.k + 0.3 });
        });
        L7Scene.payOut();
        setTimeout(function () { cue('chips'); }, 700);
      }, losers.length ? 1150 : 800);
      setTimeout(function () { // everything on the winning spots goes to the balance
        var bal = centerOf($('balance'));
        winners.forEach(function (id, i) {
          var amt = back(id);
          flyChip(stackPoint(id), bal, amt, null, { dur: 700, delay: i * 120, lift: -80, s1: 0.6 });
        });
        Object.keys(mine.bets).forEach(function (id) { delete mine.bets[id]; });
        renderBoard();
        setTimeout(function () {
          holdBalance = false; render();
          var b = $('balance'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
          cue('win');
          payoutDone();
        }, 750);
      }, losers.length ? 2200 : 1850);
      afterRound(losers.length ? 3300 : 2950);
    } else {
      setTimeout(function () { holdBalance = false; render(); payoutDone(); }, 1500);
      afterRound(2600);
    }
  }
  // The "You won" toast waits until the payout chips reach the balance.
  function payoutDone() {
    payoutRound = S.round;
    if (winQueue) { toast(winQueue, 'win'); winQueue = null; }
  }

  function showBanner(c, win) {
    var b = $('banner'), bandId = band(c);
    var parts = win.filter(function (id) { return id !== bandId; }).map(nameOf);
    if (c.r === 7) parts.push('pays 11 to 1');
    b.className = 'banner' + (c.r === 7 ? ' banner--seven' : '');
    b.innerHTML = '';
    var cd = document.createElement('div');
    cd.className = 'banner__card' + (c.red ? ' red' : '');
    cd.innerHTML = c.label + '<br>' + c.sym;
    var tx = document.createElement('div');
    tx.className = 'banner__text';
    var t1 = document.createElement('b'); t1.textContent = c.r === 7 ? 'Lucky Seven!' : nameOf(bandId);
    var t2 = document.createElement('span'); t2.textContent = parts.join(' · ');
    tx.appendChild(t1); tx.appendChild(t2);
    b.appendChild(cd); b.appendChild(tx);
    b.hidden = false;
    $('phrase').hidden = true; // the banner takes the phrase's place for a moment
    var r = S.round;
    setTimeout(function () { b.hidden = true; $('phrase').hidden = false; }, 3200);
  }

  // ---------------------------------------------------------------- engine moments
  function onSignal(name, d) {
    d = d || {};
    if (name === 'betting') bettingTotal = Number(d.bettingMs) || 15000;
    if (name === 'deal') setTimeout(render, 0);
    if (name === 'result') setTimeout(render, 0);
    if (name === 'win') {
      var text = d.text || ('You won ' + game.money(d.win || 0));
      if (payoutRound === S.round || !(sent && sent.round === S.round)) toast(text, 'win');
      else winQueue = text;
    }
    if (name === 'error') { toast(d.text || 'Something went wrong', 'error'); cue('error'); }
  }

  // ---------------------------------------------------------------- render
  var playersStrip;
  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'));
    playersStrip.update(S);
    maybeReady();
    if (S.round !== seenRound || S.phase !== seenPhase) { seenRound = S.round; seenPhase = S.phase; onPhase(); }
    syncDeal();
    if (dealtDoneRound === S.round) maybeReveal();
    if (S.phase === 'result' && sent && sent.round === S.round && revealedRound !== S.round && liveRound === S.round) holdBalance = true;

    $('conn').hidden = S.connected || !S.gotSnapshot;
    if (!holdBalance) shownBalance = S.balance;
    setText($('balance'), shownBalance == null ? '—' : game.money(shownBalance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    renderHistory();
    renderBoard();
    renderOthers();
    updateButtons();
    renderList();

    setText($('fRound'), S.round ? String(S.round) : '—');
    setText($('fHash'), S.hash || (S.result && S.result.hash) || '—');
    setText($('fSeed'), (S.result && S.result.round === S.round && S.result.seed) || S.seed || 'revealed when the card is dealt');
    setDis($('fVerifyBtn'), !(S.phase === 'result' && S.seed && S.hash) || verifying);
  }

  var histKey = '', histTop = '';
  function renderHistory() {
    // the new card joins the row once the host has shown it
    var list = (S.history || []).filter(function (h) { return !(h && h.round === S.round && revealedRound !== S.round); }).slice(0, 40);
    var cards = list.map(cardOfHistory);
    var key = cards.map(function (c) { return c ? c.key : '-'; }).join(',');
    if (key === histKey) return;
    var fresh = histKey && cards[0] && key.split(',')[0] !== histTop;
    histKey = key; histTop = key.split(',')[0];
    var h = $('history');
    h.innerHTML = '';
    cards.forEach(function (c, i) {
      if (!c) return;
      var s = document.createElement('span');
      s.className = 'hcard hcard--' + band(c) + (c.red ? ' red' : '') + (i === 0 && fresh ? ' hcard--new' : '');
      s.title = c.label + ' ' + SUIT_NAME[c.s];
      s.innerHTML = '<b>' + c.label + '</b><i>' + c.sym + '</i>';
      h.appendChild(s);
    });
  }

  // ---- bets list / my bets / road ----
  var tab = 'all', listKey = '';
  function cell(text, cls) { var s = document.createElement('span'); s.textContent = text; if (cls) s.className = cls; return s; }
  function renderList() {
    var cols = $('cols'), list = $('list');
    var road = tab === 'road';
    $('road').hidden = !road; cols.hidden = road; list.hidden = road;
    if (road) return renderRoad();
    if (tab === 'all') {
      var players = {}, order = [];
      (S.bets || []).forEach(function (b) {
        var name = b.mine ? 'You' : String(b.player || 'Player');
        var p = players[name];
        if (!p) { p = players[name] = { name: name, spots: [], amount: 0, win: null, mine: !!b.mine }; order.push(name); }
        betsOf(b).forEach(function (x) { if (p.spots.indexOf(x.spot) < 0) p.spots.push(x.spot); });
        p.amount += Number(b.total != null ? b.total : b.amount) || 0;
        if (b.win != null && b.win !== '') p.win = Number(b.win);
      });
      var rows = order.reverse().map(function (n) { return players[n]; });
      var total = rows.reduce(function (s, p) { return s + p.amount; }, 0);
      var key = 'all|' + JSON.stringify(rows);
      setText($('countLine'), rows.length + (rows.length === 1 ? ' player' : ' players') + ' · ' + game.money(total));
      if (key === listKey) return;
      listKey = key;
      setCols(['Player', 'Spots', 'Bet', 'Win']);
      list.innerHTML = '';
      if (!rows.length) { list.appendChild(cell('No bets yet this round', 'empty')); return; }
      rows.forEach(function (p) {
        var row = document.createElement('div');
        row.className = 'row' + (p.win > 0 ? ' row--won' : '') + (p.mine ? ' row--mine' : '');
        var u = document.createElement('span'); u.className = 'row__user';
        var av = NXPlayers.face(p.name, 'avatar'); // a player's face (../_core/players.js)
        u.appendChild(av); u.appendChild(cell(p.name));
        row.appendChild(u);
        row.appendChild(cell(p.spots.map(nameOf).join(' · '), 'row__spots'));
        row.appendChild(cell(game.money(p.amount)));
        row.appendChild(cell(p.win == null ? '—' : p.win > 0 ? game.money(p.win) : '0', 'row__win'));
        list.appendChild(row);
      });
    } else {
      var mine = (S.myBets || []).slice(0, 50);
      var cur = sent && sent.round === S.round && revealedRound !== S.round ? sent : null;
      var key2 = 'mine|' + JSON.stringify(mine) + '|' + (cur ? cur.total + cur.status : '');
      setText($('countLine'), mine.length + ' settled ' + (mine.length === 1 ? 'round' : 'rounds'));
      if (key2 === listKey) return;
      listKey = key2;
      setCols(['Round', 'Card', 'Bet', 'Win']);
      list.innerHTML = '';
      if (cur) {
        var r0 = document.createElement('div'); r0.className = 'row row--mine';
        r0.appendChild(cell('#' + cur.round)); r0.appendChild(cell('in play', 'row__spots')); r0.appendChild(cell(game.money(cur.total))); r0.appendChild(cell('—', 'row__win'));
        list.appendChild(r0);
      }
      if (!mine.length && !cur) { list.appendChild(cell('Your bets will show here', 'empty')); return; }
      mine.forEach(function (b) {
        var stake = Number(b.amount != null ? b.amount : b.stake != null ? b.stake : (b.bets || []).reduce(function (s, x) { return s + Number(x.amount || 0); }, 0)) || 0;
        var win = Number(b.win) || 0, c = cardOfHistory(b);
        var row = document.createElement('div'); row.className = 'row' + (win > 0 ? ' row--won' : '');
        row.appendChild(cell('#' + (b.round || '—')));
        var cc = document.createElement('span');
        if (c) { var m = document.createElement('b'); m.className = 'mini' + (c.red ? ' red' : ''); m.textContent = c.label + c.sym; cc.appendChild(m); } else cc.textContent = '—';
        row.appendChild(cc);
        row.appendChild(cell(game.money(stake)));
        row.appendChild(cell(win > 0 ? game.money(win) : '0', 'row__win'));
        list.appendChild(row);
      });
    }
  }
  function setCols(names) {
    var c = $('cols'), k = names.join('|');
    if (c.dataset.k === k) return;
    c.dataset.k = k; c.innerHTML = '';
    names.forEach(function (n) { c.appendChild(cell(n)); });
  }
  var roadKey = '';
  function renderRoad() {
    var cards = (S.history || []).slice(0, 96).map(cardOfHistory).filter(Boolean);
    var key = cards.map(function (c) { return c.key; }).join(',');
    setText($('countLine'), 'Last ' + cards.length + ' cards');
    if (key === roadKey && listKey === 'road') return;
    roadKey = key; listKey = 'road';
    var plate = $('plate');
    plate.innerHTML = '';
    var chron = cards.slice().reverse();
    chron = chron.slice(Math.max(0, chron.length - 72));
    chron.forEach(function (c) {
      var b = document.createElement('span'), bd = band(c);
      b.className = 'bead bead--' + bd + (c.red ? ' bead--red' : '');
      b.textContent = bd === 'seven' ? '7' : bd === 'low' ? 'L' : 'H';
      b.title = c.label + ' ' + SUIT_NAME[c.s];
      plate.appendChild(b);
    });
    plate.scrollLeft = plate.scrollWidth;
    var n = cards.length || 1, cnt = { low: 0, seven: 0, high: 0, red: 0, black: 0, odd: 0, even: 0 };
    cards.forEach(function (c) { localWinners(c).forEach(function (w) { cnt[w]++; }); });
    var since = cards.findIndex ? cards.findIndex(function (c) { return c.r === 7; }) : -1;
    var stats = [
      ['Low', cnt.low], ['Seven', cnt.seven], ['High', cnt.high], ['Red', cnt.red], ['Black', cnt.black], ['Odd / Even', null],
    ];
    var st = $('stats');
    st.innerHTML = '';
    stats.forEach(function (x) {
      var d = document.createElement('div'); d.className = 'stat';
      var v = document.createElement('b');
      v.textContent = x[1] == null ? Math.round(cnt.odd / n * 100) + '% / ' + Math.round(cnt.even / n * 100) + '%' : Math.round(x[1] / n * 100) + '%';
      d.appendChild(v); d.appendChild(document.createTextNode(x[0]));
      st.appendChild(d);
    });
    var last7 = document.createElement('div'); last7.className = 'stat'; last7.style.gridColumn = '1 / -1';
    last7.textContent = since < 0 ? 'No 7 in the last ' + cards.length + ' cards' : since === 0 ? 'The last card was a 7' : 'Last 7: ' + since + (since === 1 ? ' round ago' : ' rounds ago');
    st.appendChild(last7);
  }

  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      tab = b.dataset.tab; listKey = ''; cue('click');
      Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (x) {
        var on = x === b;
        x.classList.toggle('bets__tab--on', on);
        x.setAttribute('aria-selected', String(on));
      });
      renderList();
    };
  });
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  // Provably fair: SHA-256(seed) must equal the hash published before betting, and the seed must
  // deal the same card (recomputed here with the engine's own shuffle, NXTable.verify).
  var verifying = false;
  function hexToBytes(hx) { var o = new Uint8Array(hx.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(hx.substr(i * 2, 2), 16); return o; }
  $('fVerifyBtn').onclick = function () {
    var seed = S.seed, hash = S.hash, round = S.round, shown = cardOfResult(S.result), out = $('fVerify');
    if (!seed || !hash || !window.crypto || !crypto.subtle) return;
    verifying = true; setDis($('fVerifyBtn'), true); out.className = 'verify__out'; out.textContent = 'Checking…';
    var dealt = NXTable.verify ? NXTable.verify({ game: 'lucky7', gameId: game.event || '88.0081', seed: seed, round: round }) : Promise.resolve(null);
    Promise.all([crypto.subtle.digest('SHA-256', hexToBytes(seed)), dealt]).then(function (res) {
      var h = Array.prototype.map.call(new Uint8Array(res[0]), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      var c = res[1] && cardOfResult(res[1].outcome || res[1]);
      var ok = h === hash && (!c || !shown || c.key === shown.key);
      out.className = 'verify__out ' + (ok ? 'verify__out--ok' : 'verify__out--bad');
      out.textContent = ok ? 'Round ' + round + ' verified: hash matches' + (c ? ', the seed deals ' + c.label + c.sym : '') + '.' : 'Round ' + round + ' does not verify.';
    }).catch(function () { out.className = 'verify__out verify__out--bad'; out.textContent = 'Could not verify in this browser.'; })
      .then(function () { verifying = false; render(); });
  };
  $('back').onclick = function () { cue('click'); game.back(); };
  $('rules').onclick = function () { cue('click'); $('rulesModal').hidden = false; };
  $('rulesClose').onclick = function () { $('rulesModal').hidden = true; };
  $('rulesModal').onclick = function (e) { if (e.target === $('rulesModal')) $('rulesModal').hidden = true; };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('rulesModal').hidden = true; });

  // ---------------------------------------------------------------- ready
  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    requestAnimationFrame(function () { game.ready(); });
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 10000); // never hang the loader

  // ---------------------------------------------------------------- layout
  var stageEl = document.querySelector('.stage');
  function fit() {
    var r = stageEl.getBoundingClientRect();
    var FULL_W = r.width, FULL_H = r.height;
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    var LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    var W = FULL_W - LEFT;
    var bar = document.querySelector('.top').getBoundingClientRect();
    var TOP = Math.max(0, bar.bottom - r.top + 6);
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    var H = Math.max(120, playBottom - TOP);
    stageEl.style.setProperty('--left', LEFT + 'px');
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    var c = $('centre').style;
    c.left = LEFT + 'px'; c.top = TOP + 'px'; c.width = W + 'px'; c.height = H + 'px';
    L7Scene.fit({ LEFT: LEFT, TOP: TOP, W: W, H: H, FULL_W: FULL_W, FULL_H: FULL_H });
  }
  L7Scene.init(stageEl);
  fit();
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    ['.history', '.bets', '.top', '.stage', '.console'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); });
  }

  // ---------------------------------------------------------------- per-frame: timer ring, auto send, browser bar
  var C = 2 * Math.PI * 27, themeAt = 0, timerCls = '';
  function tick(t) {
    requestAnimationFrame(tick);
    if (t - themeAt > 400) { themeAt = t; game.theme(L7Scene.topColour()); }
    var timer = $('timer');
    if (S.phase !== 'betting' || !S.endsAt) { if (!timer.hidden) timer.hidden = true; return; }
    var left = Math.max(0, S.endsAt - Date.now());
    if (!left) { if (!timer.hidden) timer.hidden = true; closeBets(); return; }
    if (timer.hidden) timer.hidden = false;
    $('timerFg').style.strokeDashoffset = (C * (1 - Math.min(1, left / bettingTotal))).toFixed(2);
    var sec = Math.ceil(left / 1000);
    setText($('timerSec'), String(sec));
    var cls = 'timer' + (left <= 3000 ? ' timer--end' : left <= 7000 ? ' timer--mid' : '');
    if (cls !== timerCls) { timerCls = cls; timer.className = cls; }
    if (sec !== tickSec) {
      tickSec = sec;
      if (sec <= 5 && sec > 0) cue('tick');
      if (sec === 3 && lastCallRound !== S.round && liveRound === S.round) { lastCallRound = S.round; L7Scene.gesture('lastCall'); }
      updateButtons(); renderBoard();
    }
    if (left <= 1500 && pending.length && !(sent && sent.round === S.round)) submit(true); // chips left on the table are sent
  }
  requestAnimationFrame(tick);
  render();
})();
