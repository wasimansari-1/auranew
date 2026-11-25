/* NEXORNG table client — shared by the live-style table games (88.0078–88.0087).
 *
 * Shared tables (Baccarat, Teen Patti, Lucky 7, Dragon Tiger, Andar Bahar, Dealer Roulette, Sic Bo):
 * one deal per round for everyone — betting window → the dealer deals (each card / dice / ball step
 * arrives live with its moment) → result → settlement. Own tables (Blackjack, Hi-Lo, Three Card
 * Poker): the player against the dealer, action by action. Real players play through the socket
 * (the engine settles with the operator's wallet); demo players watch the live shared rounds and
 * settle demo bets locally, and play own tables locally — with the SAME rules as the engine
 * (NXTable.rules; shared test vectors prove it).
 *
 *   var game = NXTable.start({ event: '88.0083', game: 'dragontiger', onChange: render, onSignal: sound });
 *   game.S = { demo, connected, gotSnapshot, kind: 'shared'|'own', phase, round, endsAt, hash, seed,
 *              deals, result, myBets, bets, history, balance, hand, options, done, win, stake }
 *     shared phases: waiting | betting | dealing | result | pause ; own phases: idle | playing | done
 *   game.bet([{spot, amount}])            (shared — during betting)
 *   game.deal([{spot, amount}]) / game.act('hit'|'stand'|'double'|'split'|'insurance'|
 *        'higher'|'lower'|'cashout'|'play'|'fold')   (own) → Promise
 *   game.pay(outcome, spot) → return multiplier of a spot for an outcome (2 = 1:1, 1 = push, 0 = lost)
 *   game.validSpot(spot), game.limit(), game.limitsLoaded, game.money(n), game.round2(n),
 *   game.back(), game.ready(), game.theme('#rrggbb')
 *   onSignal: 'betting', 'deal' {step}, 'result' {outcome, win}, 'win' {win, text}, 'error' {text}
 *   NXTable.verify({ game, gameId, seed, round, bets?, actions? }) → Promise of the provably fair
 *     deal (shared: {outcome, steps}; own: the final hand) recomputed from a revealed seed.
 *
 * Cards are strings: rank + suit, e.g. "AS", "TD" (ten), "7H", "KC".
 */
(function () {
  'use strict';

  // API + live-socket addresses: /nexorng-config.js (loaded before this file) — same origin by
  // default, or the API / socket load balancer on another host.
  var NXC = window.NEXORNG_CONFIG || {};
  var API = new URL(NXC.apiBase || '/ogh', location.href).href.replace(/\/+$/, '');
  var SOCKET_URL = new URL(NXC.socketUrl || '/socket/ws', location.href).href.replace(/^http/, 'ws');

  // Maintenance overlay (_core/maintenance.js, shared by every game): loaded once by whichever
  // client runs; calls made before it has loaded are queued (window.NXMaintQ).
  (function () {
    // Browser only: a no-op wherever there is no real DOM (the engine's Node checks of this file).
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.currentScript ||
      typeof document.createElement !== 'function' || !document.head) return;
    try {
      if (window.NXMaint || document.querySelector('script[data-nxm]')) return;
      var s = document.createElement('script');
      s.src = new URL('maintenance.js', document.currentScript.src).href;
      s.setAttribute('data-nxm', '');
      document.head.appendChild(s);
    } catch (e) { /* no overlay: the API still refuses bets during maintenance */ }
  })();
  function maint(fn, arg) {
    if (typeof window === 'undefined') return;
    if (window.NXMaint) return window.NXMaint[fn](arg);
    (window.NXMaintQ = window.NXMaintQ || []).push([fn, arg]);
  }
  function maintBlocked() { return typeof window !== 'undefined' && !!(window.NXMaint && window.NXMaint.blocked()); }

  // ================================================================ rules (same as the engine)
  var RANKS = 'A23456789TJQK', SUITS = 'SHDC';
  function card(r, s) { return RANKS[r - 1] + SUITS[s]; }
  function rankOf(c) { return RANKS.indexOf(c[0]) + 1; }
  function suitOf(c) { return SUITS.indexOf(c[1]); }
  function isRed(c) { var s = c[1]; return s === 'H' || s === 'D'; }
  function floor2(v) { return Math.floor(v * 100 + 1e-9) / 100; }
  function money2(v) { return Math.floor(v * 100 + 1e-6) / 100; }
  function fixed2(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function has(list, s) { return list.indexOf(s) >= 0; }

  // Sources: crypto (demo) or a precomputed provably-fair stream (verify).
  function cryptoSource() {
    var buf = new Uint32Array(64), i = 64;
    function u32() {
      if (i >= 64) { crypto.getRandomValues(buf); i = 0; }
      return buf[i++];
    }
    return { intn: function (n) { return intn(u32, n); } };
  }
  function intn(u32, n) {
    if (n <= 1) return 0;
    var limit = Math.floor(4294967296 / n) * n;
    for (;;) { var v = u32(); if (v < limit) return v % n; }
  }

  // HMAC-SHA256(seed, gameId:round:counter) blocks read as big-endian uint32s (the engine's Stream).
  function hexBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function makeStream(seedHex, gameId, round, blocks) {
    blocks = blocks || 160;
    var enc = new TextEncoder(), prefix = gameId + ':' + round + ':';
    return crypto.subtle.importKey('raw', hexBytes(seedHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']).then(function (key) {
      var jobs = [];
      for (var c = 0; c < blocks; c++) jobs.push(crypto.subtle.sign('HMAC', key, enc.encode(prefix + c)));
      return Promise.all(jobs);
    }).then(function (sigs) {
      var words = [];
      sigs.forEach(function (sig) {
        var dv = new DataView(sig);
        for (var k = 0; k < 32; k += 4) words.push(dv.getUint32(k, false));
      });
      var i = 0;
      var u32 = function () { if (i >= words.length) throw new Error('stream exhausted'); return words[i++]; };
      return { intn: function (n) { return intn(u32, n); } };
    });
  }

  // A shoe of `decks` decks, dealt by a lazy Fisher–Yates (identical to the engine's).
  function Shoe(decks, src) {
    var cards = [];
    for (var d = 0; d < decks; d++) for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) cards.push(card(r, s));
    var n = cards.length;
    return {
      draw: function () {
        var j = src.intn(n); n--;
        var t = cards[j]; cards[j] = cards[n]; cards[n] = t;
        return cards[n];
      },
      left: function () { return n; },
    };
  }

  function ace14(r) { return r === 1 ? 14 : r; }
  function compareRank(c1, k1, c2, k2) {
    if (c1 !== c2) return c1 > c2 ? 1 : -1;
    for (var i = 0; i < k1.length; i++) if (k1[i] !== k2[i]) return k1[i] > k2[i] ? 1 : -1;
    return 0;
  }
  function sortedDesc(cs) {
    return cs.map(function (c) { return ace14(rankOf(c)); }).sort(function (a, b) { return b - a; });
  }

  // ---- Baccarat
  function bacValue(c) { var r = rankOf(c); return r >= 10 ? 0 : r; }
  function bacTotal(cs) { return cs.reduce(function (t, c) { return t + bacValue(c); }, 0) % 10; }
  function bankerDraws(b, playerDrew, p3) {
    if (!playerDrew) return b <= 5;
    switch (b) {
      case 0: case 1: case 2: return true;
      case 3: return p3 !== 8;
      case 4: return p3 >= 2 && p3 <= 7;
      case 5: return p3 >= 4 && p3 <= 7;
      case 6: return p3 === 6 || p3 === 7;
    }
    return false;
  }
  var baccarat = {
    deal: function (src) {
      var shoe = Shoe(8, src), o = { player: [], banker: [] }, steps = [], at = 500;
      function give(to) {
        var c = shoe.draw();
        steps.push({ at: at, kind: 'card', to: to, card: c }); at += 900;
        o[to].push(c);
        return c;
      }
      give('player'); give('banker'); give('player'); give('banker');
      var p = bacTotal(o.player), b = bacTotal(o.banker);
      if (p < 8 && b < 8) {
        var drew = false, p3 = -1;
        if (p <= 5) { p3 = bacValue(give('player')); drew = true; }
        if (bankerDraws(b, drew, p3)) give('banker');
      }
      p = bacTotal(o.player); b = bacTotal(o.banker);
      o.playerTotal = p; o.bankerTotal = b;
      o.winner = p > b ? 'player' : b > p ? 'banker' : 'tie';
      return { outcome: o, steps: steps };
    },
    validSpot: function (s) { return has(['player', 'banker', 'tie', 'playerPair', 'bankerPair'], s); },
    pay: function (o, spot) {
      switch (spot) {
        case 'player': return o.winner === 'player' ? 2 : o.winner === 'tie' ? 1 : 0;
        case 'banker': return o.winner === 'banker' ? 1.95 : o.winner === 'tie' ? 1 : 0;
        case 'tie': return o.winner === 'tie' ? 9 : 0;
        case 'playerPair': return o.player.length >= 2 && o.player[0][0] === o.player[1][0] ? 12 : 0;
        case 'bankerPair': return o.banker.length >= 2 && o.banker[0][0] === o.banker[1][0] ? 12 : 0;
      }
      return 0;
    },
    dealMs: function (o) { return 500 + 900 * (o.player.length + o.banker.length); },
  };

  // ---- Teen Patti
  var TP_NAMES = ['', 'high', 'pair', 'colour', 'sequence', 'pureSequence', 'trail'];
  function teenPattiRank(cs) {
    var r = sortedDesc(cs);
    var flush = cs[0][1] === cs[1][1] && cs[1][1] === cs[2][1];
    var seq = false, key = 0;
    if (r[0] === 14 && r[1] === 13 && r[2] === 12) { seq = true; key = 16; }
    else if (r[0] === 14 && r[1] === 3 && r[2] === 2) { seq = true; key = 15; }
    else if (r[0] - 1 === r[1] && r[1] - 1 === r[2]) { seq = true; key = r[0]; }
    if (r[0] === r[1] && r[1] === r[2]) return [6, [r[0]]];
    if (seq && flush) return [5, [key]];
    if (seq) return [4, [key]];
    if (flush) return [3, r];
    if (r[0] === r[1]) return [2, [r[0], r[2]]];
    if (r[1] === r[2]) return [2, [r[1], r[0]]];
    return [1, r];
  }
  var teenpatti = {
    deal: function (src) {
      var shoe = Shoe(1, src), o = { a: [], b: [] }, steps = [], at = 500;
      for (var i = 0; i < 3; i++) ['a', 'b'].forEach(function (to) {
        var c = shoe.draw();
        steps.push({ at: at, kind: 'card', to: to, card: c }); at += 700;
        o[to].push(c);
      });
      var ra = teenPattiRank(o.a), rb = teenPattiRank(o.b);
      o.handA = TP_NAMES[ra[0]]; o.handB = TP_NAMES[rb[0]];
      var c = compareRank(ra[0], ra[1], rb[0], rb[1]);
      o.winner = c > 0 ? 'a' : c < 0 ? 'b' : 'tie';
      return { outcome: o, steps: steps };
    },
    validSpot: function (s) { return s === 'a' || s === 'b'; },
    pay: function (o, spot) { return o.winner === 'tie' ? 0.5 : o.winner === spot ? 1.98 : 0; },
    dealMs: function () { return 500 + 6 * 700; },
  };

  // ---- Lucky 7
  var lucky7 = {
    deal: function (src) {
      var c = Shoe(8, src).draw();
      return { outcome: { card: c }, steps: [{ at: 800, kind: 'card', to: 'card', card: c }] };
    },
    validSpot: function (s) { return has(['low', 'seven', 'high', 'red', 'black', 'odd', 'even'], s); },
    pay: function (o, spot) {
      var r = rankOf(o.card);
      switch (spot) {
        case 'low': return r <= 6 ? 2 : 0;
        case 'high': return r >= 8 ? 2 : 0;
        case 'seven': return r === 7 ? 12 : 0;
        case 'red': return isRed(o.card) ? 1.95 : 0;
        case 'black': return !isRed(o.card) ? 1.95 : 0;
        case 'odd': return r !== 7 && r % 2 === 1 ? 2 : 0;
        case 'even': return r % 2 === 0 ? 2 : 0;
      }
      return 0;
    },
    dealMs: function () { return 800; },
  };

  // ---- Dragon Tiger
  var dragontiger = {
    deal: function (src) {
      var shoe = Shoe(8, src), d = shoe.draw(), t = shoe.draw();
      var o = { dragon: d, tiger: t, winner: rankOf(d) > rankOf(t) ? 'dragon' : rankOf(t) > rankOf(d) ? 'tiger' : 'tie' };
      return { outcome: o, steps: [{ at: 600, kind: 'card', to: 'dragon', card: d }, { at: 1600, kind: 'card', to: 'tiger', card: t }] };
    },
    validSpot: function (s) { return has(['dragon', 'tiger', 'tie', 'suitedTie'], s); },
    pay: function (o, spot) {
      switch (spot) {
        case 'dragon': case 'tiger': return o.winner === spot ? 2 : o.winner === 'tie' ? 0.5 : 0;
        case 'tie': return o.winner === 'tie' ? 9 : 0;
        case 'suitedTie': return o.winner === 'tie' && o.dragon[1] === o.tiger[1] ? 51 : 0;
      }
      return 0;
    },
    dealMs: function () { return 1600; },
  };

  // ---- Andar Bahar (always Andar first)
  var andarbahar = {
    deal: function (src) {
      var shoe = Shoe(1, src), j = shoe.draw(), o = { joker: j, andar: [], bahar: [] };
      var steps = [{ at: 600, kind: 'joker', to: 'joker', card: j }], side = 'andar', at = 1600;
      while (shoe.left() > 0) {
        var c = shoe.draw();
        steps.push({ at: at, kind: 'card', to: side, card: c });
        o[side].push(c);
        if (c[0] === j[0]) { o.winner = side; break; }
        at += o.andar.length + o.bahar.length < 6 ? 600 : 350;
        side = side === 'andar' ? 'bahar' : 'andar';
      }
      return { outcome: o, steps: steps };
    },
    validSpot: function (s) { return s === 'andar' || s === 'bahar'; },
    pay: function (o, spot) { return o.winner !== spot ? 0 : spot === 'andar' ? 1.9 : 2; },
    dealMs: function (o) {
      var n = o.andar.length + o.bahar.length;
      return n <= 6 ? 1600 + (n - 1) * 600 : 1600 + 5 * 600 + (n - 6) * 350;
    },
  };

  // ---- Dealer Roulette (European)
  var RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  function rouletteSpot(spot) {
    var set = [], n;
    function add(f) { for (n = 1; n <= 36; n++) if (f(n)) set.push(n); }
    switch (spot) {
      case 'red': add(function (x) { return has(RED, x); }); return set;
      case 'black': add(function (x) { return !has(RED, x); }); return set;
      case 'odd': add(function (x) { return x % 2 === 1; }); return set;
      case 'even': add(function (x) { return x % 2 === 0; }); return set;
      case 'low': add(function (x) { return x <= 18; }); return set;
      case 'high': add(function (x) { return x >= 19; }); return set;
      case 'dozen1': case 'dozen2': case 'dozen3':
        var d = +spot[5]; add(function (x) { return Math.floor((x - 1) / 12) + 1 === d; }); return set;
      case 'col1': case 'col2': case 'col3':
        var c = +spot[3]; add(function (x) { return (x - 1) % 3 + 1 === c; }); return set;
    }
    var i = spot.indexOf(':');
    if (i < 0) return null;
    var size = { straight: 1, split: 2, street: 3, trio: 3, basket: 3, corner: 4, line: 6 }[spot.slice(0, i)];
    if (!size) return null;
    var parts = spot.slice(i + 1).split(','), seen = {};
    for (var k = 0; k < parts.length; k++) {
      if (!/^\d+$/.test(parts[k])) return null;
      n = +parts[k];
      if (n < 0 || n > 36 || seen[n]) return null;
      seen[n] = true; set.push(n);
    }
    return set.length === size ? set : null;
  }
  var dealerroulette = {
    deal: function (src) {
      var p = src.intn(37);
      return { outcome: { pocket: p, color: p === 0 ? 'green' : has(RED, p) ? 'red' : 'black' }, steps: [{ at: 6000, kind: 'pocket', value: p }] };
    },
    validSpot: function (s) { return rouletteSpot(s) !== null; },
    pay: function (o, spot) { var set = rouletteSpot(spot) || []; return has(set, o.pocket) ? 36 / set.length : 0; },
    dealMs: function () { return 6000; },
    spot: rouletteSpot,
  };

  // ---- Sic Bo
  var SB_TOTAL = { 4: 51, 17: 51, 5: 19, 16: 19, 6: 15, 15: 15, 7: 13, 14: 13, 8: 9, 13: 9, 9: 7, 12: 7, 10: 7, 11: 7 };
  function arg(spot, prefix) { return spot.indexOf(prefix) === 0 && /^\d+$/.test(spot.slice(prefix.length)) ? +spot.slice(prefix.length) : null; }
  var sicbo = {
    deal: function (src) {
      var d = [src.intn(6) + 1, src.intn(6) + 1, src.intn(6) + 1];
      return { outcome: { dice: d, total: d[0] + d[1] + d[2] }, steps: [{ at: 3500, kind: 'dice', dice: d }] };
    },
    validSpot: function (s) {
      if (has(['small', 'big', 'odd', 'even', 'anytriple'], s)) return true;
      var n = arg(s, 'total:');
      if (n !== null) return n >= 4 && n <= 17;
      for (var p of ['triple:', 'double:', 'single:']) { n = arg(s, p); if (n !== null) return n >= 1 && n <= 6; }
      var m = /^combo:([1-6])-([1-6])$/.exec(s);
      return !!m && +m[1] < +m[2];
    },
    pay: function (o, spot) {
      var d = o.dice, t = o.total, triple = d[0] === d[1] && d[1] === d[2];
      var count = function (n) { return d.filter(function (v) { return v === n; }).length; };
      switch (spot) {
        case 'small': return !triple && t >= 4 && t <= 10 ? 2 : 0;
        case 'big': return !triple && t >= 11 && t <= 17 ? 2 : 0;
        case 'odd': return !triple && t % 2 === 1 ? 2 : 0;
        case 'even': return !triple && t % 2 === 0 ? 2 : 0;
        case 'anytriple': return triple ? 25 : 0;
      }
      var n;
      if ((n = arg(spot, 'total:')) !== null) return t === n ? SB_TOTAL[n] : 0;
      if ((n = arg(spot, 'triple:')) !== null) return triple && d[0] === n ? 151 : 0;
      if ((n = arg(spot, 'double:')) !== null) return count(n) >= 2 ? 11 : 0;
      if ((n = arg(spot, 'single:')) !== null) { var c = count(n); return c > 0 ? 1 + c : 0; }
      var m = /^combo:(\d)-(\d)$/.exec(spot);
      if (m) return count(+m[1]) > 0 && count(+m[2]) > 0 ? 6 : 0;
      return 0;
    },
    dealMs: function () { return 3500; },
  };

  var SHARED = { baccarat: baccarat, teenpatti: teenpatti, lucky7: lucky7, dragontiger: dragontiger, andarbahar: andarbahar, dealerroulette: dealerroulette, sicbo: sicbo };

  // ---- Blackjack (6 decks, S17, 3:2, DAS, split once, insurance 2:1, peek)
  function bjValue(cs) {
    var t = 0, aces = 0;
    cs.forEach(function (c) { var v = Math.min(rankOf(c), 10); if (v === 1) aces++; t += v; });
    if (aces > 0 && t + 10 <= 21) return [t + 10, true];
    return [t, false];
  }
  function bjTen(c) { return Math.min(rankOf(c), 10); }
  function Blackjack(bet, src) {
    var b = this;
    b.shoe = Shoe(6, src); b.dealer = []; b.cur = 0; b.insuranceBet = 0; b.insuranceOpen = false;
    b.dealerBJ = false; b.isDone = false; b.win = 0; b.outcomes = [];
    var h = { cards: [], bet: bet, doubled: false, splitAces: false, stood: false, fromSplit: false };
    b.hands = [h];
    h.cards.push(b.shoe.draw()); b.dealer.push(b.shoe.draw()); h.cards.push(b.shoe.draw()); b.dealer.push(b.shoe.draw());
    var up = b.dealer[0];
    if (rankOf(up) === 1) b.insuranceOpen = true;
    else if (bjTen(up) === 10) b.peek();
    if (!b.isDone && !b.insuranceOpen && b.natural(h)) b.finish();
  }
  Blackjack.prototype.natural = function (h) { return !h.fromSplit && h.cards.length === 2 && bjValue(h.cards)[0] === 21; };
  Blackjack.prototype.peek = function () { if (bjValue(this.dealer)[0] === 21) { this.dealerBJ = true; this.finish(); } };
  Blackjack.prototype.options = function () {
    if (this.isDone) return [];
    var h = this.hands[this.cur], out = [];
    if (this.insuranceOpen) out.push('insurance');
    if (this.natural(h)) return out.concat('stand');
    out.push('hit', 'stand');
    if (h.cards.length === 2 && !h.splitAces) out.push('double');
    if (this.hands.length === 1 && h.cards.length === 2 && bjTen(h.cards[0]) === bjTen(h.cards[1])) out.push('split');
    return out;
  };
  Blackjack.prototype.cost = function (a) {
    if (!has(this.options(), a)) return null;
    if (a === 'insurance') return floor2(this.hands[0].bet / 2);
    if (a === 'double' || a === 'split') {
      if (this.insuranceOpen && bjValue(this.dealer)[0] === 21) return 0;
      return this.hands[this.cur].bet;
    }
    return 0;
  };
  Blackjack.prototype.apply = function (a) {
    var b = this;
    if (b.insuranceOpen) {
      b.insuranceOpen = false;
      if (a === 'insurance') b.insuranceBet = floor2(b.hands[0].bet / 2);
      b.peek();
      if (b.isDone) return;
      if (b.natural(b.hands[0])) { b.finish(); return; }
      if (a === 'insurance') return;
    }
    var h = b.hands[b.cur];
    if (a === 'hit') { h.cards.push(b.shoe.draw()); if (bjValue(h.cards)[0] >= 21) { h.stood = true; b.advance(); } }
    else if (a === 'stand') { h.stood = true; b.advance(); }
    else if (a === 'double') { h.bet = h.bet * 2; h.doubled = true; h.cards.push(b.shoe.draw()); h.stood = true; b.advance(); }
    else if (a === 'split') {
      var second = { cards: [h.cards[1]], bet: h.bet, doubled: false, splitAces: false, stood: false, fromSplit: true };
      h.cards = [h.cards[0]]; h.fromSplit = true; b.hands.push(second);
      var aces = rankOf(h.cards[0]) === 1;
      b.hands.forEach(function (x) {
        x.cards.push(b.shoe.draw());
        if (aces) { x.splitAces = true; x.stood = true; } else if (bjValue(x.cards)[0] === 21) x.stood = true;
      });
      b.advance();
    }
  };
  Blackjack.prototype.advance = function () {
    while (this.cur < this.hands.length && this.hands[this.cur].stood) this.cur++;
    if (this.cur >= this.hands.length) { this.cur = this.hands.length - 1; this.finish(); }
  };
  Blackjack.prototype.finish = function () {
    var b = this;
    if (b.isDone) return;
    b.isDone = true;
    var win = 0;
    if (b.dealerBJ) {
      if (b.insuranceBet > 0) win += b.insuranceBet * 3;
      b.hands.forEach(function (h) { if (b.natural(h)) { win += h.bet; b.outcomes.push('push'); } else b.outcomes.push('lose'); });
      b.win = money2(win); return;
    }
    if (b.hands.length === 1 && b.natural(b.hands[0])) { b.win = floor2(b.hands[0].bet * 2.5); b.outcomes = ['blackjack']; return; }
    var live = b.hands.some(function (h) { return bjValue(h.cards)[0] <= 21; });
    if (live) while (bjValue(b.dealer)[0] < 17) b.dealer.push(b.shoe.draw());
    var d = bjValue(b.dealer)[0];
    b.hands.forEach(function (h) {
      var t = bjValue(h.cards)[0];
      if (t > 21) b.outcomes.push('bust');
      else if (d > 21 || t > d) { win += h.bet * 2; b.outcomes.push('win'); }
      else if (t === d) { win += h.bet; b.outcomes.push('push'); }
      else b.outcomes.push('lose');
    });
    b.win = money2(win);
  };
  Blackjack.prototype.done = function () { return this.isDone; };
  Blackjack.prototype.timeoutAction = function () { return 'stand'; };
  Blackjack.prototype.view = function () {
    var b = this, dealer = b.isDone ? b.dealer : b.dealer.slice(0, 1), dv = bjValue(dealer);
    var v = { dealer: dealer, dealerTotal: dv[0], dealerSoft: dv[1], holeHidden: !b.isDone, current: b.cur, insuranceOffered: b.insuranceOpen };
    v.hands = b.hands.map(function (h, i) {
      var hv = bjValue(h.cards), o = { cards: h.cards.slice(), bet: fixed2(h.bet), total: hv[0], done: h.stood || b.isDone };
      if (hv[1]) o.soft = true;
      if (h.doubled) o.doubled = true;
      if (h.splitAces) o.splitAces = true;
      if (b.isDone && i < b.outcomes.length) o.outcome = b.outcomes[i];
      return o;
    });
    if (b.insuranceBet > 0) v.insurance = fixed2(b.insuranceBet);
    if (b.isDone) v.dealerBlackjack = b.dealerBJ;
    return v;
  };

  // ---- Hi-Lo
  var HILO_RTP = 0.97, HILO_MAX = 10000;
  function hiloPay(r, pick) {
    var n = pick === 'higher' ? 13 - r : pick === 'lower' ? r - 1 : 0;
    return n <= 0 ? 0 : floor2(HILO_RTP * 13 / n);
  }
  function drawUniform(src) { var i = src.intn(52); return card(i % 13 + 1, Math.floor(i / 13)); }
  function HiLo(stake, src) {
    this.src = src; this.stake = stake; this.card = drawUniform(src); this.mult = 1; this.history = [];
    this.isDone = false; this.cashed = false; this.win = 0;
  }
  HiLo.prototype.options = function () {
    if (this.isDone) return [];
    var r = rankOf(this.card), out = [];
    if (r < 13) out.push('higher');
    if (r > 1) out.push('lower');
    if (this.history.length) out.push('cashout');
    return out;
  };
  HiLo.prototype.cost = function (a) { return has(this.options(), a) ? 0 : null; };
  HiLo.prototype.apply = function (a) {
    if (a === 'cashout') return this.cashOut();
    var r = rankOf(this.card), x = hiloPay(r, a), next = drawUniform(this.src), nr = rankOf(next);
    var won = (a === 'higher' && nr > r) || (a === 'lower' && nr < r);
    this.history.push({ from: this.card, pick: a, card: next, won: won, x: x });
    this.card = next;
    if (!won) { this.isDone = true; this.win = 0; return; }
    this.mult = floor2(this.mult * x);
    if (this.mult >= HILO_MAX) { this.mult = HILO_MAX; this.cashOut(); }
  };
  HiLo.prototype.cashOut = function () { this.isDone = true; this.cashed = true; this.win = money2(this.stake * this.mult); };
  HiLo.prototype.done = function () { return this.isDone; };
  HiLo.prototype.timeoutAction = function () {
    if (!this.history.length) { this.isDone = true; this.cashed = true; this.win = this.stake; return ''; }
    return 'cashout';
  };
  HiLo.prototype.view = function () {
    var r = rankOf(this.card);
    return { card: this.card, multiplier: this.mult, history: this.history.length ? this.history : null, cashedOut: this.cashed,
      pays: { higher: hiloPay(r, 'higher'), lower: hiloPay(r, 'lower') } };
  };

  // ---- Three Card Poker
  var TCP_NAMES = ['', 'high', 'pair', 'flush', 'straight', 'trips', 'straightFlush'];
  var PAIR_PLUS = { 2: 2, 3: 5, 4: 7, 5: 31, 6: 41 }, ANTE_BONUS = { 4: 1, 5: 4, 6: 5 };
  function threeCardRank(cs) {
    var r = sortedDesc(cs);
    var flush = cs[0][1] === cs[1][1] && cs[1][1] === cs[2][1], straight = false, top = 0;
    if (r[0] === 14 && r[1] === 3 && r[2] === 2) { straight = true; top = 3; }
    else if (r[0] - 1 === r[1] && r[1] - 1 === r[2]) { straight = true; top = r[0]; }
    if (straight && flush) return [6, [top]];
    if (r[0] === r[1] && r[1] === r[2]) return [5, [r[0]]];
    if (straight) return [4, [top]];
    if (flush) return [3, r];
    if (r[0] === r[1]) return [2, [r[0], r[2]]];
    if (r[1] === r[2]) return [2, [r[1], r[0]]];
    return [1, r];
  }
  function dealerQualifies(cs) { var k = threeCardRank(cs); return k[0] >= 2 || k[1][0] >= 12; }
  function ThreeCard(ante, pairPlus, src) {
    var shoe = Shoe(1, src);
    this.ante = ante; this.pairPlus = pairPlus || 0; this.play = 0; this.player = []; this.dealer = [];
    for (var i = 0; i < 3; i++) this.player.push(shoe.draw());
    for (i = 0; i < 3; i++) this.dealer.push(shoe.draw());
    this.isDone = false; this.win = 0; this.result = '';
  }
  ThreeCard.prototype.options = function () { return this.isDone ? [] : ['play', 'fold']; };
  ThreeCard.prototype.cost = function (a) { return has(this.options(), a) ? (a === 'play' ? this.ante : 0) : null; };
  ThreeCard.prototype.apply = function (a) {
    this.isDone = true;
    var pr = threeCardRank(this.player), win = 0;
    if (this.pairPlus > 0 && PAIR_PLUS[pr[0]]) win += this.pairPlus * PAIR_PLUS[pr[0]];
    if (a === 'fold') { this.result = 'fold'; this.win = money2(win); return; }
    this.play = this.ante;
    if (ANTE_BONUS[pr[0]]) win += this.ante * ANTE_BONUS[pr[0]];
    if (!dealerQualifies(this.dealer)) { this.result = 'noqualify'; win += this.ante * 2 + this.play; }
    else {
      var dr = threeCardRank(this.dealer), c = compareRank(pr[0], pr[1], dr[0], dr[1]);
      if (c > 0) { this.result = 'win'; win += this.ante * 2 + this.play * 2; }
      else if (c === 0) { this.result = 'push'; win += this.ante + this.play; }
      else this.result = 'lose';
    }
    this.win = money2(win);
  };
  ThreeCard.prototype.done = function () { return this.isDone; };
  ThreeCard.prototype.timeoutAction = function () { return 'fold'; };
  ThreeCard.prototype.view = function () {
    var v = { player: this.player, playerHand: TCP_NAMES[threeCardRank(this.player)[0]], ante: fixed2(this.ante) };
    if (this.pairPlus > 0) v.pairPlus = fixed2(this.pairPlus);
    if (this.isDone) {
      v.dealer = this.dealer; v.dealerHand = TCP_NAMES[threeCardRank(this.dealer)[0]];
      v.dealerQualifies = dealerQualifies(this.dealer); v.result = this.result;
      if (this.play > 0) v.play = fixed2(this.play);
    }
    return v;
  };

  var OWN = { blackjack: true, hilo: true, threecardpoker: true };
  function ownValidSpot(game, spot) {
    if (game === 'blackjack' || game === 'hilo') return spot === 'main';
    if (game === 'threecardpoker') return spot === 'ante' || spot === 'pairPlus';
    return false;
  }
  function newHand(game, bets, src) {
    var amt = {};
    bets.forEach(function (b) { amt[b.spot] = Number(b.amount); });
    if (game === 'blackjack') return new Blackjack(amt.main, src);
    if (game === 'hilo') return new HiLo(amt.main, src);
    if (game === 'threecardpoker') return amt.ante > 0 ? new ThreeCard(amt.ante, amt.pairPlus || 0, src) : null;
    return null;
  }

  var rules = {
    shared: SHARED, own: OWN, Shoe: Shoe, card: card, rankOf: rankOf, suitOf: suitOf, isRed: isRed,
    teenPattiRank: teenPattiRank, threeCardRank: threeCardRank, compareRank: compareRank, bjValue: bjValue,
    hiloPay: hiloPay, rouletteSpot: rouletteSpot, newHand: newHand, ownValidSpot: ownValidSpot,
    TP_NAMES: TP_NAMES, TCP_NAMES: TCP_NAMES,
  };

  // Draw games bring their own rules from their game folder (rules.js, loaded after this file and
  // before NXTable.start): NXTable.registerRules('digitdrum', { deal(src) → {outcome, steps},
  // validSpot(spot), pay(outcome, spot) → return multiplier, dealMs(outcome) }) — the same rules as
  // the engine (nexorng-engine/internal/tables/DRAWGAMES.md); used for demo play and verify().
  function registerRules(name, r) {
    if (!/^[a-z0-9]{2,32}$/.test(name) || SHARED[name] || OWN[name]) throw new Error('NXTable.registerRules: bad or duplicate name ' + name);
    ['deal', 'validSpot', 'pay', 'dealMs'].forEach(function (k) { if (typeof r[k] !== 'function') throw new Error('NXTable.registerRules(' + name + '): ' + k + ' missing'); });
    SHARED[name] = r;
  }

  // Provably fair check: recompute a round from its revealed seed.
  function verify(p) {
    return makeStream(p.seed, p.gameId, p.round).then(function (src) {
      if (SHARED[p.game]) return SHARED[p.game].deal(src);
      var h = newHand(p.game, p.bets || [], src);
      (p.actions || []).forEach(function (a) { if (!h.done()) h.apply(a); });
      return { hand: h.view(), win: h.win, done: h.done() };
    });
  }

  // ================================================================ client
  var ERRORS = {
    BETTING_CLOSED: 'Bets are closed for this round.',
    ALREADY_BET: 'Your bets are already placed this round.',
    ALREADY_PLAYING: 'Finish your current hand first.',
    NO_HAND: 'No hand in play.',
    INVALID_SPOT: 'That bet isn’t available.',
    INVALID_ACTION: 'That move isn’t available now.',
    INVALID_AMOUNT: 'Enter a valid amount (max 2 decimals).',
    INSUFFICIENT_FUNDS: 'Not enough balance.',
    BET_LIMIT: 'Bet is outside this table’s limits.',
    OPERATOR_LIMIT_REACHED: 'The casino’s limit is reached. Try a smaller bet.',
    PLAYER_BLOCKED: 'Your account can’t play right now.',
    MAINTENANCE: 'Betting is paused for maintenance — back soon.',
    SESSION_EXPIRED: 'Your session expired. Reopen the game.',
    WALLET_UNAVAILABLE: 'Wallet not reachable. Try again.',
    GAME_UNAVAILABLE: 'The table is restarting. Try again in a moment.',
    GAME_CLOSING: 'The table is restarting. Try again in a moment.',
    TOO_MANY_REQUESTS: 'Slow down a little.',
    NOT_SUBSCRIBED: 'Reconnecting… try again.',
  };
  var RESULT_MS = 3000;
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function start(opts) {
    var qs = new URLSearchParams(location.search);
    var EVENT = qs.get('event') || opts.event, GAME = opts.game;
    var TOKEN = safeGet('token') || '', DEMO = !TOKEN || TOKEN === 'demo';
    var AUTH = window.NXAuth || null; // socket sign-in (socket-auth.js)
    var CURRENCY = safeGet('currency') || 'EUR';
    var fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var change = opts.onChange || function () {}, signal = opts.onSignal || function () {};
    var kind = OWN[GAME] ? 'own' : 'shared', R = SHARED[GAME];
    var S = {
      demo: DEMO, connected: false, gotSnapshot: false, kind: kind, game: GAME,
      phase: kind === 'own' ? 'idle' : 'waiting', round: 0, endsAt: 0, hash: '', seed: '',
      deals: [], result: null, history: [], myBets: [], bets: [], balance: DEMO ? 10 : null,
      hand: null, options: [], done: false, win: 0, stake: 0,
    };
    var LIMIT = { min: 0.1, max: 0 }, ws = null, reqId = 0, pending = {}, leaving = false;
    var myRound = null; // shared: { round, bets, total } placed this round
    var local = null;   // own demo hand
    // Maintenance: a shared table's round plays out (the overlay waits until it has ended); a
    // player with chips on it, or an own hand in play, keeps the table as it is until it is over.
    maint('attach', { api: API, round: kind === 'shared', busy: function () {
      return kind === 'own' ? S.phase === 'playing'
        : !!(myRound && myRound.round === S.round && (S.phase === 'betting' || S.phase === 'dealing'));
    } });

    function connect() {
      ws = (window.NXSecure ? NXSecure.connect(SOCKET_URL, TOKEN) : new WebSocket(SOCKET_URL)) /* encrypted channel: secure-socket.js */;
      ws.onopen = function () {
        S.connected = true;
        if (AUTH) AUTH.open(ws, TOKEN); // sign in first: the connection is this session's
        ws.send(JSON.stringify({ op: 'subscribe', event: EVENT }));
        change();
      };
      ws.onclose = function (e) {
        if (this !== ws) return; // an older connection: the current one is not touched
        S.connected = false;
        if (leaving) return;
        if (AUTH && AUTH.replaced(this, e, connect)) { ws = null; change(); return; } // open in another tab / device: no reconnect by itself
        change();
        setTimeout(function () { if (!leaving && (!ws || ws.readyState > 1)) connect(); }, 1200);
      };
      ws.onmessage = function (e) {
        var m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (AUTH && AUTH.read(ws, m)) return;
        if (m.type === 'reply') return onReply(m.id, m.data || {});
        if (m.type === 'snapshot') return onSnapshot(m.data || {});
        if (m.event === EVENT) onEvent(m.type, m.data || {}, false);
      };
    }
    function act(op, data) {
      return new Promise(function (resolve) {
        if (!ws || ws.readyState !== 1) return resolve({ ok: false, error: 'GAME_UNAVAILABLE' });
        var id = 'r' + (++reqId);
        pending[id] = resolve;
        setTimeout(function () { if (pending[id]) { delete pending[id]; resolve({ ok: false, error: 'WALLET_UNAVAILABLE' }); } }, 10000);
        ws.send(AUTH ? AUTH.pack(ws, op, EVENT, id, data) : JSON.stringify({ op: op, event: EVENT, id: id, data: data }));
      });
    }
    function onReply(id, data) { var cb = pending[id]; if (cb) { delete pending[id]; cb(data); } }
    function fail(code, fallback) {
      if (code === 'MAINTENANCE' && !maintBlocked()) maint('refused');
      var text = ERRORS[code] || code || fallback;
      signal('error', { text: text });
      return Promise.reject(new Error(text));
    }

    function onSnapshot(d) {
      S.gotSnapshot = true;
      var by = d.byType || {};
      if (by.maintenance) maint('engine', by.maintenance.data);
      if (kind === 'own' && !DEMO) { // a reload / reconnect: restore my open hand (the engine keeps it)
        act('act', { token: TOKEN, action: 'resume' }).then(function (res) {
          if (res.ok && res.result && !res.result.done) ownState(res.result);
        });
      }
      if (kind === 'shared') {
        // history: table.result data, newest first (when the gateway keeps it); else the last result
        var hist = (d.history || []).filter(function (r) { return r && r.outcome; });
        if (!hist.length && by['table.result']) hist = [by['table.result'].data];
        S.history = hist.slice(0, 60).map(function (r) { return { round: r.round, outcome: r.outcome }; });
        var last = hist[0], bet = by['table.betting'] && by['table.betting'].data;
        if (last) { S.round = last.round; S.phase = 'result'; S.result = last.outcome; S.seed = last.seed; S.hash = last.hash; }
        if (bet && (!last || bet.round > last.round)) {
          var mine = S.bets.filter(function (b) { return b.mine && bet.round === S.round; });
          onEvent('table.betting', bet, true);
          // the current round so far (bets, deal steps) when the gateway keeps it
          (d.round || []).forEach(function (m) { if (m.data && m.data.round === bet.round || m.type === 'table.bet' || m.type === 'table.win') onEvent(m.type, m.data, true); });
          if (S.deals.length) S.phase = 'dealing';
          S.bets = S.bets.concat(mine);
        }
      }
      change();
    }

    function onEvent(type, d, quiet) {
      switch (type) {
        case 'maintenance':
          maint('engine', d);
          break;
        case 'table.betting':
          if (d.round < S.round) break;
          S.phase = 'betting'; S.round = d.round; S.hash = d.hash; S.seed = '';
          S.endsAt = new Date(d.endsAt).getTime(); S.deals = []; S.result = null; S.bets = [];
          if (myRound && myRound.round !== d.round) myRound = null;
          if (!quiet) signal('betting', d);
          break;
        case 'table.bet':
          S.bets.push({ player: d.player, bets: d.bets, total: Number(d.total), win: null });
          break;
        case 'table.deal':
          if (d.round !== S.round) break;
          S.phase = 'dealing'; S.deals.push(d);
          if (!quiet) signal('deal', { step: d });
          break;
        case 'table.result':
          if (d.round < S.round) break;
          S.round = d.round; S.phase = 'result'; S.result = d.outcome; S.seed = d.seed; S.hash = d.hash;
          S.history.unshift({ round: d.round, outcome: d.outcome }); S.history = S.history.slice(0, 60);
          settleMine(d);
          // the result stays up a moment, then the table pauses until the next betting window
          setTimeout(function () { if (S.phase === 'result' && S.round === d.round) { S.phase = 'pause'; change(); } }, RESULT_MS);
          break;
        case 'table.win':
          for (var i = 0; i < S.bets.length; i++) if (S.bets[i].player === d.player && S.bets[i].win === null) { S.bets[i].win = Number(d.win); break; }
          break;
        case 'table.hand':
          S.bets.unshift({ player: d.player, total: Number(d.stake), win: Number(d.win), game: d.game });
          S.bets = S.bets.slice(0, 30);
          break;
        default:
          return;
      }
      if (!quiet) change();
    }

    function settleMine(d) {
      var win = 0;
      if (myRound && myRound.round === d.round) {
        myRound.bets.forEach(function (b) { win += money2(Number(b.amount) * R.pay(d.outcome, b.spot)); });
        win = money2(win);
        if (myRound.maxWin > 0 && win > myRound.maxWin) win = myRound.maxWin; // capped like the engine pays it
        if (DEMO) S.balance = money2(S.balance + win); else setTimeout(loadBalance, 700);
        S.myBets.unshift({ at: Date.now(), round: d.round, stake: myRound.total, win: win, bets: myRound.bets, outcome: d.outcome });
        S.myBets = S.myBets.slice(0, 50);
        if (DEMO) S.bets.forEach(function (b) { if (b.mine) b.win = win; });
      }
      signal('result', { outcome: d.outcome, win: win });
      if (win > 0) signal('win', { win: win, text: 'You won ' + fmt.format(win) });
      myRound = null;
    }

    function loadBalance() {
      if (DEMO) return;
      fetch(API + '/playerBalance', { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN } })
        .then(function (r) { return r.json(); })
        .then(function (p) { var b = p && p.data && p.data.balance; if (b != null) { S.balance = Number(b); change(); } })
        .catch(function () {});
    }
    function loadLimits() {
      var req = DEMO
        ? fetch(API + '/games', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (p) {
            var g = ((p.data && p.data.items) || []).filter(function (x) { return x.id === EVENT; })[0];
            return g && g.minBet ? { min: g.minBet, max: g.maxBet } : null;
          })
        : fetch(API + '/betLimit?game=' + encodeURIComponent(EVENT), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN } })
            .then(function (r) { return r.json(); }).then(function (p) { return p.data && p.data.limit; });
      return req.then(function (l) { if (l) LIMIT = { min: Number(l.min), max: Number(l.max) }; return LIMIT; }).catch(function () { return LIMIT; });
    }

    function checkBets(bets, valid) {
      if (!bets || !bets.length || bets.length > 20) return 'INVALID_AMOUNT';
      var seen = {}, total = 0;
      for (var i = 0; i < bets.length; i++) {
        var b = bets[i], a = Number(b.amount);
        if (!valid(b.spot) || seen[b.spot]) return 'INVALID_SPOT';
        seen[b.spot] = true;
        if (!(a > 0) || Math.round(a * 100) !== a * 100 && Math.abs(Math.round(a * 100) - a * 100) > 1e-6) return 'INVALID_AMOUNT';
        total += a;
      }
      return money2(total);
    }
    function norm(bets) { return bets.map(function (b) { return { spot: b.spot, amount: Number(b.amount).toFixed(2) }; }); }

    // ---- shared tables
    function bet(bets) {
      if (kind !== 'shared') return fail('INVALID_ACTION');
      if (maintBlocked()) return fail('MAINTENANCE');
      var total = checkBets(bets, R.validSpot);
      if (typeof total === 'string') return fail(total);
      if (S.phase !== 'betting' || Date.now() > S.endsAt) return fail('BETTING_CLOSED');
      if (myRound && myRound.round === S.round) return fail('ALREADY_BET');
      bets = norm(bets);
      if (DEMO) {
        if (total > S.balance) return fail('INSUFFICIENT_FUNDS');
        S.balance = money2(S.balance - total);
        myRound = { round: S.round, bets: bets, total: total };
        S.bets.push({ player: 'You', bets: bets, total: total, win: null, mine: true });
        change();
        return Promise.resolve({ round: S.round, total: total });
      }
      var round = S.round;
      myRound = { round: round, bets: bets, total: total, pending: true };
      change();
      return act('bet', { token: TOKEN, round: round, bets: bets }).then(function (res) {
        if (!res.ok) { if (myRound && myRound.round === round) myRound = null; change(); return fail(res.error, 'Bet failed'); }
        myRound.pending = false;
        if (res.result && res.result.maxWin != null) myRound.maxWin = Number(res.result.maxWin); // the game's max-win cap
        if (res.result && res.result.balance != null) S.balance = Number(res.result.balance);
        change();
        return res.result;
      });
    }

    // ---- own tables
    function ownState(st) {
      S.round = st.round; S.hand = st.hand; S.options = st.options || []; S.done = !!st.done; S.stake = Number(st.stake);
      S.hash = st.hash || S.hash; S.seed = st.seed || '';
      S.phase = S.done ? 'done' : 'playing';
      if (st.balance != null) S.balance = Number(st.balance);
      if (S.done) {
        S.win = Number(st.win || 0);
        S.myBets.unshift({ at: Date.now(), round: st.round, stake: S.stake, win: S.win, hand: st.hand });
        S.myBets = S.myBets.slice(0, 50);
        signal('result', { hand: st.hand, win: S.win });
        if (S.win > 0) signal('win', { win: S.win, text: 'You won ' + fmt.format(S.win) });
        if (!DEMO) setTimeout(loadBalance, 700);
      }
      change();
      return st;
    }
    function localState() {
      return { round: S.round + 1, hand: local.view(), options: local.options(), done: local.done(), stake: local.stakeSum, win: local.done() ? local.win : 0, hash: '', seed: '' };
    }
    function deal(bets) {
      if (kind !== 'own') return fail('INVALID_ACTION');
      if (maintBlocked() && S.phase !== 'playing') return fail('MAINTENANCE');
      var total = checkBets(bets, function (s) { return ownValidSpot(GAME, s); });
      if (typeof total === 'string') return fail(total);
      if (S.phase === 'playing') return fail('ALREADY_PLAYING');
      bets = norm(bets);
      if (DEMO) {
        if (total > S.balance) return fail('INSUFFICIENT_FUNDS');
        local = newHand(GAME, bets, cryptoSource());
        if (!local) return fail('INVALID_SPOT');
        local.stakeSum = total;
        S.balance = money2(S.balance - total);
        var st = localState();
        if (local.done()) S.balance = money2(S.balance + local.win);
        return Promise.resolve(ownState(st));
      }
      return act('deal', { token: TOKEN, bets: bets }).then(function (res) {
        if (!res.ok) return fail(res.error, 'Deal failed');
        return ownState(res.result);
      });
    }
    function action(a) {
      if (kind !== 'own') return fail('INVALID_ACTION');
      if (DEMO) {
        if (!local || local.done()) return fail('NO_HAND');
        var extra = local.cost(a);
        if (extra === null) return fail('INVALID_ACTION');
        if (extra > S.balance) return fail('INSUFFICIENT_FUNDS');
        S.balance = money2(S.balance - extra);
        local.stakeSum = money2(local.stakeSum + extra);
        local.apply(a);
        var st = localState();
        st.round = S.round;
        if (local.done()) S.balance = money2(S.balance + local.win);
        return Promise.resolve(ownState(st));
      }
      return act('act', { token: TOKEN, action: a }).then(function (res) {
        if (!res.ok) return fail(res.error, 'Action failed');
        return ownState(res.result);
      });
    }

    // ---- page
    function back() {
      if (window.parent !== window) return window.parent.postMessage({ type: 'nexorng:back' }, location.origin);
      location.href = '/lobby'; // the lobby; "Back to home" (the operator's site) is in the lobby's account menu
    }
    function ready() { if (window.parent !== window) window.parent.postMessage({ type: 'nexorng:ready' }, location.origin); }
    var lastTheme = '';
    function theme(color) {
      if (!color || color === lastTheme) return;
      lastTheme = color;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', color);
      if (window.parent !== window) window.parent.postMessage({ type: 'nexorng:theme', color: color }, location.origin);
    }
    window.addEventListener('pagehide', function () { leaving = true; if (ws) ws.close(); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; connect(); } });

    loadBalance();
    var limitsLoaded = loadLimits();
    if (kind === 'shared' || !DEMO) connect(); else { S.connected = true; S.gotSnapshot = true; }

    return {
      S: S, event: EVENT, game: GAME, kind: kind,
      bet: bet, deal: deal, act: action,
      pay: function (outcome, spot) { return R ? R.pay(outcome, spot) : 0; },
      validSpot: function (spot) { return R ? R.validSpot(spot) : ownValidSpot(GAME, spot); },
      dealMs: function (outcome) { return R ? R.dealMs(outcome) : 0; },
      limit: function () { return LIMIT; }, limitsLoaded: limitsLoaded,
      money: function (n) { return fmt.format(n); }, round2: money2,
      apiUrl: function (path) { return API + path; }, // e.g. game.apiUrl('/playerBalance')
      back: back, ready: ready, theme: theme,
    };
  }

  window.NXTable = { start: start, rules: rules, verify: verify, registerRules: registerRules };
})();
