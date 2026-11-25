/* Teen Patti — NEXORNG live-style table game (88.0080). Shared timed rounds from the table engine
 * (../_core/table-client.js): 15 s betting → six cards dealt A, B, A, B, A, B → result → pause.
 * This file is the game: chip rack, bets, results road, lists, rules and the round flow; the
 * table, dealer and animations are in scene.js, the sounds in audio.js. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var EVENT = '88.0080';
  var SPOT = { A: 'a', B: 'b' }; // the engine's spot ids
  var BET_MS = 15000; // the engine's betting window (spec)
  var PAY = 0.98, TIE_BACK = 0.5;

  // ---------------------------------------------------------------- sound + scene
  var audio = TPAudio.create();
  var soundOn = true, musicOn = true;
  try { soundOn = localStorage.getItem('teenpatti-sound') !== 'off'; musicOn = localStorage.getItem('teenpatti-music') !== 'off'; } catch (e) { /* defaults */ }
  audio.sfx(soundOn);
  audio.music(musicOn);
  function sfx(n) { audio.play(n); }

  var scene = TPScene.create({ table: $('table'), canvas: $('hall'), sound: sfx });

  var game = null, S = null;
  game = NXTable.start({ event: EVENT, game: 'teenpatti', onChange: render, onSignal: onSignal });
  S = game.S;

  // ---------------------------------------------------------------- cards + hands
  var RANKS = '23456789TJQKA';
  var SUITS = { S: 'S', H: 'H', D: 'D', C: 'C', '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
  function normRank(r) {
    if (r == null) return null;
    if (typeof r === 'number') return r === 1 || r === 14 ? 'A' : r >= 2 && r <= 9 ? String(r) : ({ 10: 'T', 11: 'J', 12: 'Q', 13: 'K' })[r] || null;
    r = String(r).toUpperCase();
    if (r === '10') return 'T';
    if (r === '1' || r === 'ACE') return 'A';
    if (r === 'JACK' || r === 'QUEEN' || r === 'KING') return r[0];
    return RANKS.indexOf(r) >= 0 && r.length === 1 ? r : null;
  }
  function normSuit(s) {
    if (s == null) return null;
    s = String(s);
    return SUITS[s] || SUITS[s[0].toUpperCase()] || null;
  }
  // A card from the engine: "KS", "10h", "T♦", { rank, suit } or 0..51.
  function parseCard(c) {
    if (c == null) return null;
    if (typeof c === 'number') return { rank: RANKS[c % 13], suit: 'SHDC'[Math.floor(c / 13) % 4] };
    if (typeof c === 'object') {
      var r = normRank(c.rank != null ? c.rank : c.r != null ? c.r : c.value), s = normSuit(c.suit != null ? c.suit : c.s);
      return r && s ? { rank: r, suit: s } : null;
    }
    var str = String(c).trim();
    var m = str.match(/^(10|[2-9TJQKA1]|[tjqka])\s*([SHDCshdc♠♥♦♣])$/) || null;
    if (m) return { rank: normRank(m[1]), suit: normSuit(m[2]) };
    m = str.match(/^([SHDCshdc♠♥♦♣])\s*(10|[2-9TJQKA]|[tjqka])$/);
    if (m) return { rank: normRank(m[2]), suit: normSuit(m[1]) };
    return null;
  }
  function stepCard(st) { return parseCard(st && (st.card != null ? st.card : st.c != null ? st.c : st.cards && st.cards[0])); }
  function sideOf(to, i) {
    if (to == null) return i % 2 ? 'B' : 'A';
    var s = String(to).toUpperCase();
    if (s === '0') return 'A';
    if (s === '1') return 'B';
    var last = s.slice(-1);
    return last === 'B' ? 'B' : last === 'A' ? 'A' : (i % 2 ? 'B' : 'A');
  }
  function val(c) { return RANKS.indexOf(c.rank) + 2; }
  var PLURAL = { A: 'Aces', K: 'Kings', Q: 'Queens', J: 'Jacks', T: '10s' };
  var NAME = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10' };
  function plural(v) { var r = RANKS[v - 2]; return PLURAL[r] || r + 's'; }
  function single(v) { var r = RANKS[v - 2]; return NAME[r] || r; }
  // Hand ranks: trail > pure sequence > sequence > colour > pair > high card (A-K-Q, then A-2-3 top sequences).
  function evalHand(cards) {
    var v = cards.map(val).sort(function (a, b) { return b - a; });
    var flush = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
    var seq = (v[0] - v[1] === 1 && v[1] - v[2] === 1) || (v[0] === 14 && v[1] === 3 && v[2] === 2);
    var sk = v[0] === 14 && v[1] === 13 ? 100 : v[0] === 14 && v[1] === 3 ? 99 : v[0];
    if (v[0] === v[2]) return { cat: 6, key: [6, v[0]], name: 'Trail of ' + plural(v[0]) };
    if (seq && flush) return { cat: 5, key: [5, sk], name: 'Pure sequence' };
    if (seq) return { cat: 4, key: [4, sk], name: 'Sequence' };
    if (flush) return { cat: 3, key: [3].concat(v), name: 'Colour' };
    if (v[0] === v[1]) return { cat: 2, key: [2, v[0], v[2]], name: 'Pair of ' + plural(v[0]) };
    if (v[1] === v[2]) return { cat: 2, key: [2, v[1], v[0]], name: 'Pair of ' + plural(v[1]) };
    return { cat: 1, key: [1].concat(v), name: single(v[0]) + ' high' };
  }
  function cmp(a, b) { for (var i = 0; i < Math.max(a.length, b.length); i++) { var d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; }
  function outcomeOf(x) {
    if (x == null) return null;
    if (typeof x === 'object') return outcomeOf(x.outcome != null ? x.outcome : x.winner != null ? x.winner : x.result);
    var s = String(x).toUpperCase().trim();
    if (/TIE|DRAW|PUSH|^T$/.test(s)) return 'T';
    var last = s.slice(-1);
    return last === 'A' || last === 'B' ? last : null;
  }

  // ---------------------------------------------------------------- phrases (random, every round)
  var PHRASES = {
    betting: ['Place your bets', 'Bets are open', 'Choose your side', 'A or B — your call', 'Chips on the table', 'Pick your player',
      'Feeling lucky?', 'The table is open', 'Back your hand', 'Who takes this one?', 'Fresh deck, fresh luck', 'Trust your instinct'],
    closed: ['No more bets', 'Bets are closed', 'Cards coming', 'Here we go', 'Dealing now', 'Hands are in', 'Watch the cards'],
    pause: ['Next round soon', 'Shuffling a fresh deck', 'New deck coming', 'Get ready', 'Next hand in a moment'],
  };
  var lastPhrase = {};
  function pick(kind) {
    var l = PHRASES[kind], i = Math.floor(Math.random() * l.length);
    if (l[i] === lastPhrase[kind]) i = (i + 1) % l.length;
    lastPhrase[kind] = l[i];
    return l[i];
  }

  // ---------------------------------------------------------------- toast
  var toastTimer;
  function toast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }

  // ---------------------------------------------------------------- chips + my bets
  var chipVals = [0.1, 0.2, 0.5, 1, 2.5], chipSel = 0;
  var pending = []; // chips placed this round, not sent yet: [{ spot, amount }]
  var confirmed = null; // { round, bets: { A, B } } once the engine took the bet
  var submitting = false;
  var lastBets = null; // last confirmed { A, B } for Rebet
  var R = { round: null, shown: 0, sides: { A: [], B: [] }, resultDone: false, settling: {}, win: null, settled: false }; // this round on the table
  function limits() {
    var l = game.limit() || {};
    return { min: Number(l.min) > 0 ? Number(l.min) : 0.1, max: Number(l.max) > 0 ? Number(l.max) : 100 };
  }
  function r2(n) { return game.round2 ? game.round2(n) : Math.floor(n * 100 + 1e-6) / 100; }
  function money(n) { return game.money(n); }
  function sums(list) {
    var s = { A: 0, B: 0 };
    list.forEach(function (p) { s[p.spot] = Math.round((s[p.spot] + p.amount) * 100) / 100; });
    return s;
  }
  function pendingTotal() { var s = sums(pending); return Math.round((s.A + s.B) * 100) / 100; }
  function chipLabel(v) { return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2).replace(/^0\./, '.'); }

  var chipBtns = chipVals.map(function (v, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rchip rchip--c' + (i + 1);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === chipSel));
    b.innerHTML = '<span></span>';
    b.addEventListener('click', function () { chipSel = i; sfx('key'); updateChips(); });
    $('chips').appendChild(b);
    return b;
  });
  function updateChips() {
    chipBtns.forEach(function (b, i) {
      var t = chipLabel(chipVals[i]);
      if (b.firstChild.textContent !== t) b.firstChild.textContent = t;
      b.setAttribute('aria-checked', String(i === chipSel));
      b.setAttribute('aria-label', 'Chip ' + money(chipVals[i]));
    });
  }
  function setChipValues() {
    var min = limits().min;
    chipVals = [1, 2, 5, 10, 25].map(function (m) { return Math.round(min * m * 100) / 100; });
    chipSel = 0; // the minimum bet preselected
    updateChips();
    drawStacks();
  }
  setChipValues();
  if (game.limitsLoaded && game.limitsLoaded.then) game.limitsLoaded.then(setChipValues, function () {});

  function canBet() { return S && S.phase === 'betting' && !submitting && !(confirmed && confirmed.round === S.round); }
  function chipPoint() {
    var r = chipBtns[chipSel].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function addChips(spot, amount, from) {
    var L = limits(), s = sums(pending);
    if (r2(s[spot] + amount) > L.max + 1e-9) return toast('Max ' + money(L.max) + ' on one player.', 'error');
    if (S.balance != null && r2(pendingTotal() + amount) > S.balance + 1e-9) return toast('Not enough balance.', 'error');
    pending.push({ spot: spot, amount: amount });
    scene.flyChip(spot, amount, from).then(function () { drawStacks(); });
    render();
    return true;
  }
  scene.onSpot(function (spot) {
    audio.unlock();
    if (!S || S.phase !== 'betting') return toast(S && S.phase === 'dealing' ? 'Bets are closed — next round soon.' : 'Bets open in a moment.');
    if (confirmed && confirmed.round === S.round) return toast('Your bet is in for this round. Good luck!');
    if (submitting) return;
    addChips(spot, chipVals[chipSel], chipPoint());
  });
  $('undo').addEventListener('click', function () {
    if (!canBet() || !pending.length) return;
    pending.pop(); sfx('chip'); render();
  });
  $('clear').addEventListener('click', function () {
    if (!canBet() || !pending.length) return;
    pending = []; sfx('sweep'); render();
  });
  $('double').addEventListener('click', function () {
    if (!canBet() || !pending.length) return;
    var L = limits(), s = sums(pending), total = pendingTotal();
    if (Math.max(s.A, s.B) * 2 > L.max + 1e-9) return toast('Max ' + money(L.max) + ' on one player.', 'error');
    if (S.balance != null && total * 2 > S.balance + 1e-9) return toast('Not enough balance to double.', 'error');
    ['A', 'B'].forEach(function (spot) {
      if (!s[spot]) return;
      pending.push({ spot: spot, amount: s[spot] });
      scene.flyChip(spot, chipVals.filter(function (v) { return v <= s[spot] + 1e-9; }).pop() || chipVals[0], chipPoint()).then(drawStacks);
    });
    render();
  });
  $('rebet').addEventListener('click', function () {
    if (!canBet() || pending.length || !lastBets) return;
    var L = limits(), total = r2((lastBets.A || 0) + (lastBets.B || 0));
    if (S.balance != null && total > S.balance + 1e-9) return toast('Not enough balance to rebet.', 'error');
    ['A', 'B'].forEach(function (spot) {
      var a = Math.min(L.max, lastBets[spot] || 0);
      if (!a) return;
      pending.push({ spot: spot, amount: a });
      scene.flyChip(spot, chipVals.filter(function (v) { return v <= a + 1e-9; }).pop() || chipVals[0], chipPoint()).then(drawStacks);
    });
    render();
  });
  $('place').addEventListener('click', function () { audio.unlock(); submit(); });

  function submit() {
    if (!canBet() || !pending.length) return;
    var s = sums(pending), round = S.round, L = limits();
    var bets = ['A', 'B'].filter(function (k) { return s[k] > 0; }).map(function (k) { return { spot: SPOT[k], amount: Number(s[k].toFixed(2)) }; });
    for (var i = 0; i < bets.length; i++) if (bets[i].amount < L.min - 1e-9) return toast('Min ' + money(L.min) + ' per player.', 'error');
    submitting = true;
    updateControls();
    var ok = function () {
      submitting = false;
      if (S.round !== round) { pending = []; render(); return; }
      confirmed = { round: round, bets: { A: s.A, B: s.B } };
      lastBets = { A: s.A, B: s.B };
      pending = [];
      sfx('chipdown');
      scene.look('tray', 900);
      render();
    };
    var fail = function () {
      submitting = false;
      if (S.phase !== 'betting' || S.round !== round) pending = [];
      render();
    };
    var p;
    try { p = game.bet(bets); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (res) { if (res && res.ok === false) fail(); else ok(); }, fail);
  }

  function myStake() {
    if (confirmed && confirmed.round === (R.round)) return confirmed.bets;
    return null;
  }
  function drawStacks() {
    var st = {};
    var c = myStake(), p = sums(pending);
    ['A', 'B'].forEach(function (k) {
      if (R.settling[k]) { st[k] = { amount: 0 }; return; }
      var amt = r2((c ? c[k] || 0 : 0) + p[k]);
      st[k] = { amount: amt, pending: p[k] > 0 };
    });
    scene.stacks(st, chipVals, money);
  }

  // ---------------------------------------------------------------- round flow on the table
  var live = false; // after the first snapshot: new steps animate
  function newRound() {
    var had = scene.cardCount() > 0;
    R = { round: S.round, shown: 0, sides: { A: [], B: [] }, resultDone: false, settling: {}, win: null, settled: false };
    pending = []; submitting = false; lastTick = 0;
    if (confirmed && confirmed.round !== S.round) confirmed = null;
    scene.banner('');
    if (had) scene.collect(live);
    drawStacks();
  }
  function syncTable() {
    if (S.round !== R.round && S.round) newRound();
    var deals = S.deals || [];
    while (R.shown < deals.length) {
      var st = deals[R.shown], n = R.shown;
      R.shown++;
      var card = stepCard(st);
      if (!card) continue;
      var side = sideOf(st.to != null ? st.to : st.side != null ? st.side : st.hand, n);
      var i = R.sides[side].length;
      if (i > 2) continue;
      R.sides[side].push(card);
      var done = scene.deal(side, i, card, live && S.phase !== 'betting');
      if (i === 2) (function (sd) { done.then(function () { if (!R.resultDone) scene.label(sd, evalHand(R.sides[sd]).name, ''); }); })(side);
    }
    if (!R.resultDone && (S.phase === 'result' || S.phase === 'pause') && R.sides.A.length === 3 && R.sides.B.length === 3) {
      R.resultDone = true;
      scene.hurry();
      var round = R.round;
      scene.dealsIdle().then(function () { if (R.round === round) showResult(); });
    }
  }
  function showResult() {
    var ha = evalHand(R.sides.A), hb = evalHand(R.sides.B), c = cmp(ha.key, hb.key);
    var out = R.outcome = outcomeOf(S.result) || (c > 0 ? 'A' : c < 0 ? 'B' : 'T');
    var win = out === 'A' ? ha : out === 'B' ? hb : ha, lose = out === 'A' ? hb : ha;
    scene.highlight(out);
    scene.label('A', ha.name, out === 'T' ? 'win' : out === 'A' ? 'win' : 'lose');
    scene.label('B', hb.name, out === 'T' ? 'win' : out === 'B' ? 'win' : 'lose');
    scene.banner(out === 'T' ? 'Tie' : 'Player ' + out + ' wins', out === 'T' ? 'half back' : win.name + (win.name === lose.name ? ', higher cards' : ''), out);
    scene.timer({ mode: 'winner', text: out === 'T' ? '=' : out, sub: out === 'T' ? 'TIE' : 'WINS', colour: out === 'A' ? '#ff9a2e' : out === 'B' ? '#4aa8ff' : '#b07cff' });
    sfx('result');
    if (out === 'T') scene.react('tie'); else if (win.cat >= 5) scene.react('wow');
    scene.sparkleSpot(out === 'T' ? 'A' : out);
    if (out === 'T') scene.sparkleSpot('B');
    addLocalHistory(R.round, out);
    var my = myStake();
    if (!my || !(my.A || my.B)) { if (out !== 'T') scene.gesture(out); R.settled = true; return; }
    var back = 0, list = ['A', 'B'].filter(function (k) { return my[k] > 0; }).map(function (k) {
      var kind = out === 'T' ? 'half' : k === out ? 'win' : 'lose';
      var ret = kind === 'win' ? r2(my[k] * (1 + PAY)) : kind === 'half' ? r2(my[k] * TIE_BACK) : 0;
      back += ret;
      return { spot: k, kind: kind, bet: my[k], back: ret };
    });
    var seq = scene.settle(list, function (k) { R.settling[k] = true; drawStacks(); });
    seq.catch(function () {}).then(function () {
      R.settled = true;
      var w = R.win ? Number(R.win.win) : r2(back);
      finishWin(w, r2((my.A || 0) + (my.B || 0)), out);
      render();
    });
  }
  function finishWin(w, stake, out) {
    if (R.toasted) return;
    R.toasted = true;
    if (w > 0 && out === 'T') { sfx('half'); toast('Tie — ' + money(w) + ' back to you'); return; }
    if (w > 0) {
      var big = w >= Math.max(5, limits().min * 50);
      sfx(big ? 'big' : 'win');
      scene.react(big ? 'big' : 'win');
      toast('You won ' + money(w), 'win');
    } else if (stake > 0) {
      scene.react('lose');
    }
  }

  // ---------------------------------------------------------------- engine moments
  function onSignal(name, d) {
    d = d || {};
    if (name === 'betting') {
      sfx('open');
      setTimeout(function () { scene.gesture('open'); }, 900);
    }
    if (name === 'win') { if (R) R.win = d; }
    if (name === 'error') { sfx('error'); toast(d.text || 'Something went wrong.', 'error'); }
  }

  // ---------------------------------------------------------------- history / road
  var localHistory = [];
  function addLocalHistory(round, out) {
    if (localHistory.length && localHistory[0].round === round) return;
    localHistory.unshift({ round: round, outcome: out });
    localHistory = localHistory.slice(0, 80);
  }
  function historyList() {
    var h = (S.history || []).map(function (x) { return { round: x && x.round, outcome: outcomeOf(x) }; }).filter(function (x) { return x.outcome; });
    if (!h.length) return localHistory;
    if (localHistory.length && localHistory[0].round != null && h[0].round != null && localHistory[0].round > h[0].round) h = [localHistory[0]].concat(h);
    return h;
  }
  var lastHistKey = '';
  function renderHistory() {
    var h = historyList(), key = h.slice(0, 40).map(function (x) { return x.outcome; }).join('') + ':' + (h[0] && h[0].round);
    if (key === lastHistKey) return;
    var isNew = lastHistKey !== '';
    lastHistKey = key;
    var track = $('history');
    track.innerHTML = '';
    h.slice(0, 40).forEach(function (x, i) {
      var b = document.createElement('span');
      b.className = 'bead bead--' + x.outcome + (i === 0 && isNew ? ' bead--new' : '');
      b.textContent = x.outcome;
      b.title = x.round ? 'Round ' + x.round : '';
      track.appendChild(b);
    });
    renderRoad(h);
  }
  function renderRoad(h) {
    var list = h.slice(0, 60).reverse(), n = { A: 0, B: 0, T: 0 };
    list.forEach(function (x) { n[x.outcome]++; });
    var tot = Math.max(1, list.length);
    $('roadStats').innerHTML = '';
    [['A', 'Player A'], ['B', 'Player B'], ['T', 'Tie']].forEach(function (p) {
      var s = document.createElement('span');
      s.innerHTML = '<span class="pill pill--' + p[0] + '">' + p[0] + '</span> ' + p[1] + ' ' + Math.round(n[p[0]] / tot * 100) + '% (' + n[p[0]] + ')';
      $('roadStats').appendChild(s);
    });
    var g = $('roadGrid');
    g.innerHTML = '';
    list.forEach(function (x) {
      var b = document.createElement('span');
      b.className = 'bead bead--' + x.outcome;
      b.textContent = x.outcome;
      g.appendChild(b);
    });
    g.scrollLeft = g.scrollWidth;
  }

  // ---------------------------------------------------------------- lists
  var tab = 'all';
  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }
  function pillEl(k) { var s = document.createElement('span'); s.innerHTML = '<span class="pill pill--' + k + '">' + k + '</span>'; return s; }
  function face(name) { return NXPlayers.face(name, 'avatar'); } // a player's face (../_core/players.js)
  // a bet from the engine: { player, bets: [{ spot, amount }], total, win } (one wallet bet, several spots)
  function betSpots(b) {
    if (b.bets && b.bets.length) return b.bets.map(function (x) { return { spot: sideOf(x.spot, 0), amount: Number(x.amount) || 0 }; });
    if (b.spot != null) return [{ spot: sideOf(b.spot, 0), amount: Number(b.amount) || 0 }];
    return [];
  }
  function allBets() {
    return (S.bets || []).map(function (b) {
      var sp = betSpots(b), total = b.total != null ? Number(b.total) : sp.reduce(function (t, x) { return t + x.amount; }, 0);
      return { player: String(b.player || 'Player'), spots: sp, total: total || 0, win: Number(b.win) || 0, mine: !!b.mine || b.player === 'You' };
    });
  }
  function myBets() {
    return (S.myBets || []).map(function (b) {
      var sp = betSpots(b), stake = b.stake != null ? Number(b.stake) : sp.reduce(function (t, x) { return t + x.amount; }, 0);
      return { round: b.round, at: b.at || Date.now(), spots: sp, stake: stake || 0, win: Number(b.win) || 0, outcome: outcomeOf(b.outcome) };
    });
  }
  function sidesCell(spots) {
    var s = document.createElement('span'), seen = {};
    spots.forEach(function (x) {
      if (seen[x.spot]) return;
      seen[x.spot] = 1;
      var p = document.createElement('span');
      p.className = 'pill pill--' + x.spot;
      p.textContent = x.spot;
      s.appendChild(p);
    });
    return s;
  }
  var lastListKey = '';
  function renderList() {
    var key = tab + ':' + (tab === 'all' ? JSON.stringify(S.bets || []) : tab === 'mine' ? (S.myBets || []).length + ':' + (S.myBets && S.myBets[0] && S.myBets[0].round) : lastHistKey);
    if (key === lastListKey) return;
    lastListKey = key;
    var list = $('list');
    list.innerHTML = '';
    $('road').hidden = tab !== 'road';
    list.hidden = tab === 'road';
    if (tab === 'all') {
      var bets = allBets();
      $('countLabel').textContent = 'All bets';
      $('betCount').textContent = bets.length;
      $('cols').innerHTML = '<span>Player</span><span>Side</span><span>Bet</span><span>Win</span>';
      if (!bets.length) list.appendChild(cell('No bets yet this round.', 'empty'));
      bets.slice().reverse().forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.win > 0 ? ' row--won' : '') + (b.mine ? ' row--mine' : '');
        var user = document.createElement('span');
        user.className = 'row__user';
        user.appendChild(face(b.player));
        user.appendChild(cell(b.player));
        row.appendChild(user);
        row.appendChild(sidesCell(b.spots));
        row.appendChild(cell(b.total.toFixed(2)));
        row.appendChild(cell(b.win > 0 ? b.win.toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else if (tab === 'mine') {
      var mine = myBets();
      $('countLabel').textContent = 'My bets';
      $('betCount').textContent = mine.length;
      $('cols').innerHTML = '<span>Time</span><span>Result</span><span>Bet</span><span>Win</span>';
      if (!mine.length) list.appendChild(cell('Your bets this visit show here.', 'empty'));
      mine.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.win > 0 ? ' row--won' : '');
        var first = cell(new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        first.title = 'Round ' + b.round;
        row.appendChild(first);
        row.appendChild(b.outcome ? pillEl(b.outcome) : cell('-'));
        var stake = cell(b.stake.toFixed(2));
        stake.title = b.spots.map(function (x) { return x.spot + ' ' + x.amount.toFixed(2); }).join(' · ');
        row.appendChild(stake);
        row.appendChild(cell(b.win > 0 ? b.win.toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      var h = historyList();
      $('countLabel').textContent = 'Last results';
      $('betCount').textContent = Math.min(60, h.length);
      $('cols').innerHTML = '';
    }
  }
  document.querySelectorAll('.bets__tab').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.dataset.tab;
      document.querySelectorAll('.bets__tab').forEach(function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      lastListKey = '';
      renderList();
    });
  });

  // ---------------------------------------------------------------- controls (built once)
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function setDis(el, d) { if (el.disabled !== d) el.disabled = d; }
  function updateControls() {
    if (!S) return;
    var betting = S.phase === 'betting', mine = confirmed && confirmed.round === S.round;
    var open = canBet(), total = pendingTotal();
    var cls = 'place', label = 'Place bet', sub = '', dis = false;
    if (mine && R.settled && R.round === S.round) { // the round is paid out
      var w = R.win ? Number(R.win.win) || 0 : 0;
      cls = w > 0 ? 'place place--placed' : 'place place--wait'; dis = true;
      label = w > 0 ? (R.outcome === 'T' ? 'Half back ' : 'You won ') + money(w) : 'Next round soon';
      sub = w > 0 ? 'Next round soon' : 'Better luck next hand';
    } else if (mine) {
      cls = 'place place--placed'; label = 'Bet placed';
      sub = money(r2((confirmed.bets.A || 0) + (confirmed.bets.B || 0))) + ' · good luck!'; dis = true;
    } else if (submitting) {
      cls = 'place place--wait'; label = 'Placing bet…'; dis = true;
    } else if (!betting) {
      cls = 'place place--wait'; dis = true;
      label = S.phase === 'dealing' ? 'Dealing…' : 'Next round soon';
      sub = S.phase === 'dealing' ? 'Bets open after this hand' : 'Pick your chip';
    } else if (total > 0) {
      label = 'Place bet'; sub = money(total);
    } else {
      cls = 'place place--wait'; label = 'Tap Player A or B'; sub = 'Chip ' + money(chipVals[chipSel]); dis = true;
    }
    if ($('place').className !== cls) $('place').className = cls;
    setDis($('place'), dis);
    setText($('placeLabel'), label);
    setText($('placeSub'), sub);
    setDis($('undo'), !open || !pending.length);
    setDis($('clear'), !open || !pending.length);
    setDis($('double'), !open || !pending.length);
    setDis($('rebet'), !open || !!pending.length || !lastBets);
    ['A', 'B'].forEach(function (k) {
      var players = {}, sum = 0;
      allBets().forEach(function (b) { b.spots.forEach(function (x) { if (x.spot === k) { players[b.player] = 1; sum += x.amount; } }); });
      var n = Object.keys(players).length;
      scene.spot(k, { open: open, text: n ? n + (n === 1 ? ' player · ' : ' players · ') + money(r2(sum)) : '' });
    });
  }

  // ---------------------------------------------------------------- render
  var shownBalance = null, phaseSeen = '';
  var playersStrip = null;
  function render() {
    if (!game || !S) return;
    maybeReady();
    if (S.gotSnapshot) {
      syncTable();
      live = true;
    }
    if (S.phase !== phaseSeen) {
      var was = phaseSeen;
      phaseSeen = S.phase;
      if (S.phase === 'betting') scene.phrase(pick('betting'));
      if (S.phase === 'dealing') {
        scene.phrase(pick('closed'));
        if (was === 'betting') { sfx('closed'); scene.gesture('close'); }
      }
      if (S.phase === 'pause') {
        setTimeout(function () {
          if (S.phase !== 'pause') return;
          scene.banner(''); scene.phrase(pick('pause'));
          scene.timer({ mode: 'pause', endsAt: S.endsAt });
        }, 2600);
      }
    }
    if (S.phase === 'betting') scene.timer({ mode: 'betting', endsAt: S.endsAt, total: BET_MS });
    else if (S.phase === 'dealing') scene.timer({ mode: 'vs' });
    if (!playersStrip && window.NXPlayers) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: face });
    if (playersStrip) playersStrip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: allBets().map(function (b) { return { player: b.player, x: 0 }; }) });

    $('conn').hidden = S.connected || !S.gotSnapshot || S.demo;
    // the win reaches the balance when the dealer has paid it out on the table
    var my = myStake(), freeze = my && (my.A || my.B) && !R.settled && (S.phase === 'result' || S.phase === 'pause');
    if (!freeze) shownBalance = S.balance;
    var bal = shownBalance;
    if (bal != null && pending.length && !submitting) bal = r2(bal - pendingTotal()); // chips on the table, not sent yet
    setText($('balance'), bal == null ? '—' : money(bal));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    renderHistory();
    updateControls();
    drawStacks();
    renderList();

    setText($('fRound'), S.round ? String(S.round) : '—');
    setText($('fHash'), S.hash || '—');
    setText($('fSeed'), S.seed || 'revealed when the round ends');
    var L = limits();
    setText($('rulesLimit'), money(L.min) + ' – ' + money(L.max));
  }

  // auto-send placed chips just before the window closes; countdown ticks
  var lastTick = 0;
  scene.onFrame(function () {
    if (!S || S.phase !== 'betting') return;
    var left = S.endsAt - Date.now();
    if (pending.length && canBet() && left < 1600 && left > 0) submit();
    var sec = Math.ceil(left / 1000);
    if (sec <= 5 && sec > 0 && sec !== lastTick) { lastTick = sec; sfx('tick'); }
  });

  // ---------------------------------------------------------------- page
  var announced = false;
  function maybeReady() {
    if (announced || !S || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced && game) { announced = true; game.ready(); } }, 10000); // never hang the loader

  $('back').addEventListener('click', function () { game.back(); });
  function syncToggles() {
    $('sound').setAttribute('aria-pressed', String(soundOn));
    $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  syncToggles();
  $('sound').addEventListener('click', function () {
    soundOn = !soundOn; audio.sfx(soundOn);
    try { localStorage.setItem('teenpatti-sound', soundOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncToggles();
  });
  $('music').addEventListener('click', function () {
    musicOn = !musicOn; audio.music(musicOn);
    try { localStorage.setItem('teenpatti-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncToggles();
  });
  $('fair').addEventListener('click', function () { $('fairDetail').hidden = !$('fairDetail').hidden; });
  $('fair').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fairDetail').hidden = !$('fairDetail').hidden; } });
  function rules(open) { $('rules').hidden = !open; if (open) $('rulesClose').focus(); }
  $('rulesBtn').addEventListener('click', function () { rules(true); });
  $('rulesClose').addEventListener('click', function () { rules(false); });
  $('rules').addEventListener('click', function (e) { if (e.target === $('rules')) rules(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('rules').hidden) rules(false); });

  // Browser bar colour: the hall's top colour (the scene does not change colour over a round).
  game.theme('#1e060c');
  window.addEventListener('pageshow', function () { game.theme('#1e060c'); });

  // ---------------------------------------------------------------- layout
  var stageEl = document.querySelector('.stage');
  function fit() {
    var r = stageEl.getBoundingClientRect();
    var wide = window.innerWidth >= 900;
    var list = document.querySelector('.bets').getBoundingClientRect();
    var left = wide && list.right > r.left && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    stageEl.style.setProperty('--left', left + 'px');
    var bar = document.querySelector('.top').getBoundingClientRect();
    var top = Math.max(0, bar.bottom - r.top + 4);
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 6 : r.height;
    stageEl.style.setProperty('--below', Math.max(0, r.height - playBottom) + 'px');
    scene.layout({ fullW: r.width, fullH: r.height, left: left, top: top, w: r.width - left, h: Math.max(120, playBottom - top) });
  }
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    ['.stage', '.history', '.bets', '.top', '.rack'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); });
  }
  fit();
  render();
})();
