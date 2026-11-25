/* NEXORNG crash client — shared by every crash game on the NEXORNG engine.
 *
 * Live rounds come from the engine through the socket (the game subscribes to its one event).
 * Real players bet / cash out through the socket (the engine settles with the operator's
 * wallet); demo players play locally with €10 against the same live rounds.
 *
 *   var game = NXCrash.start({ event: '88.0003', onChange: render, onSignal: sound });
 *   game.S            — state (phase, round, multipliers, bets, my bets, balance, …)
 *   game.bet(slot, amount, autoCashout) / game.cashOut(slot) / game.cancelQueued(slot)
 *   (slot 0 / 1: a player may hold two bets per round — two bet panels)
 *   game.currentMult(), game.limit(), game.money(n), game.back(), game.ready()
 *
 * onSignal(name, data) fires for moments a game may animate / play a sound on:
 * betting, start, crash, cashout (mine), win (mine), error.
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

  var GROWTH = 0.00006; // multiplier = e^(GROWTH · ms), the engine's curve
  var MAX_MULT = 10000; // the engine's cap on a round: no multiplier on screen is ever above it
  var BETTING_MS = 6000;
  // A dead connection often closes without telling the page (lost network, a phone that slept, a
  // tab kept in the background). While a round flies the engine sends a tick every 100 ms, so
  // FLIGHT_SILENT_MS without any message means the round on screen is no longer the live one:
  // it stops there (never counting up on its own) and the game reconnects. Outside a flight the
  // game asks the socket for a sign of life after PING_AFTER_MS of silence and reconnects when
  // that gets no answer within PONG_MS (a connection being opened gets SILENT_MS).
  var FLIGHT_SILENT_MS = 3000, PING_AFTER_MS = 5000, PONG_MS = 5000, SILENT_MS = 15000;

  var ERRORS = {
    BETTING_CLOSED: 'Betting is closed for this round.',
    ALREADY_BET: 'You already have a bet in this round.',
    NO_BET: 'No bet to cash out.',
    ALREADY_CASHED_OUT: 'Already cashed out.',
    TOO_LATE: 'Too late — the round ended.',
    INVALID_AMOUNT: 'Enter a valid amount (max 2 decimals).',
    INSUFFICIENT_FUNDS: 'Not enough balance.',
    BET_LIMIT: 'Bet is outside this game’s limits.',
    OPERATOR_LIMIT_REACHED: 'The casino’s limit is reached. Try a smaller bet.',
    PLAYER_BLOCKED: 'Your account can’t play right now.',
    MAINTENANCE: 'Betting is paused for maintenance — back soon.',
    SESSION_EXPIRED: 'Your session expired. Reopen the game.',
    WALLET_UNAVAILABLE: 'Wallet not reachable. Try again.',
    GAME_UNAVAILABLE: 'Game is restarting. Try again in a moment.',
    TOO_MANY_REQUESTS: 'Slow down a little.',
    NOT_SUBSCRIBED: 'Reconnecting… try again.',
  };

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function round2(n) { return Math.floor(n * 100 + 1e-6) / 100; }

  function start(opts) {
    var qs = new URLSearchParams(location.search);
    var EVENT = qs.get('event') || opts.event;
    var TOKEN = safeGet('token') || '';
    var DEMO = !TOKEN || TOKEN === 'demo';
    var AUTH = window.NXAuth || null; // socket sign-in (socket-auth.js)
    var CURRENCY = safeGet('currency') || 'EUR';
    var fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var change = opts.onChange || function () {};
    var signal = opts.onSignal || function () {};

    var phase = 'waiting', heardAt = Date.now(), pingAt = 0, dropping = false;
    var stale = null; // the flight that went silent { round, mult }, until the engine is heard live again
    var S = {
      demo: DEMO,
      connected: false,
      // waiting | betting | flying | crashed. Every read checks the connection first, so no game
      // ever draws a flight the engine has stopped telling us about.
      get phase() {
        if (phase === 'flying' && Date.now() - heardAt > FLIGHT_SILENT_MS) silent();
        return phase;
      },
      set phase(p) { phase = p; },
      round: 0,
      bettingStartsAt: 0,
      bettingEndsAt: 0,
      flightStart: 0,
      mult: 1, // last multiplier from the engine (ticks)
      crashPoint: 0,
      hash: '', seed: '', rtp: 0,
      history: [], // crash points, newest first
      bets: [], // this round's public bets { player, slot, amount, x, win, mine }
      my: [null, null], // per slot: { slot, round, amount, auto, status: pending|placed|cashing|cashed|lost, win, x }
      myBets: [], // this session's settled bets, newest first
      queued: [null, null], // per slot: bet for the next round { amount, auto }
      bettingPhrase: NXPhrases.pick('betting'), // changes every round (phrases.js)
      crashPhrase: NXPhrases.pick('crash'),
      balance: DEMO ? 10 : null,
      gotSnapshot: false,
    };
    var LIMIT = { min: 0.1, max: 0 };
    var ws = null, reqId = 0, pending = {}, leaving = false;
    // Maintenance: shared rounds — the overlay waits until the running round has ended; a player
    // with a bet in it keeps the game as it is (cash out) until then.
    maint('attach', { api: API, round: true, busy: function () {
      return (S.phase === 'betting' || S.phase === 'flying') && S.my.some(function (m) {
        return m && m.round === S.round && (m.status === 'pending' || m.status === 'placed' || m.status === 'cashing');
      });
    } });

    // ---------------------------------------------------------------- socket
    function connect() {
      var sock = ws = (window.NXSecure ? NXSecure.connect(SOCKET_URL, TOKEN) : new WebSocket(SOCKET_URL)) /* encrypted channel: secure-socket.js */;
      heardAt = Date.now(); pingAt = 0; // a new connection gets SILENT_MS to say something
      sock.onopen = function () {
        if (ws !== sock) return;
        S.connected = true;
        if (AUTH) AUTH.open(sock, TOKEN); // sign in first: the connection is this session's
        sock.send(JSON.stringify({ op: 'subscribe', event: EVENT }));
        change();
      };
      sock.onclose = function (e) {
        if (ws !== sock) return; // dropped by us: the new connection is already on its way
        S.connected = false;
        if (leaving) return;
        if (AUTH && AUTH.replaced(sock, e, connect)) { ws = null; change(); return; } // open in another tab / device: no reconnect by itself
        change();
        setTimeout(function () { if (!leaving && ws === sock) connect(); }, 1200);
      };
      sock.onmessage = function (e) {
        if (ws !== sock) return;
        heardAt = Date.now();
        var m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (AUTH && AUTH.read(sock, m)) return;
        if (m.type === 'reply') return onReply(m.id, m.data || {});
        if (m.type === 'snapshot') return onSnapshot(m.data || {});
        if (m.event === EVENT) onEvent(m.type, m.data || {});
      };
    }

    // silent: the flight on screen stopped being live. It ends where the engine last confirmed it
    // (S.mult), the game shows "waiting", and the connection is replaced; the snapshot of the new
    // one brings the real state back.
    function silent() {
      stale = { round: S.round, mult: S.mult };
      phase = 'waiting';
      if (dropping) return;
      dropping = true;
      setTimeout(function () { dropping = false; drop(); }, 0); // not from inside a game's render
    }
    function drop() {
      if (leaving) return;
      var old = ws;
      ws = null;
      S.connected = false;
      if (phase === 'flying') { stale = { round: S.round, mult: S.mult }; phase = 'waiting'; }
      if (old) { try { old.close(); } catch (e) { /* already gone */ } }
      connect();
      change();
    }
    // The watchdog (also run the moment the page is shown again after sleeping in the background).
    function checkAlive() {
      if (leaving || !ws) return;
      var now = Date.now(), quiet = now - heardAt;
      if (ws.readyState !== 1) { if (quiet > SILENT_MS) drop(); return; }
      if (phase === 'flying') { if (quiet > FLIGHT_SILENT_MS) drop(); return; }
      if (pingAt > heardAt) { if (now - pingAt > PONG_MS) drop(); } // asked, no answer
      else if (quiet > PING_AFTER_MS) { pingAt = now; ws.send('{"op":"ping"}'); }
    }
    setInterval(checkAlive, 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkAlive(); });
    window.addEventListener('online', checkAlive);

    function act(op, data, cb) {
      if (!ws || ws.readyState !== 1) return cb({ ok: false, error: 'GAME_UNAVAILABLE' });
      var id = 'r' + (++reqId);
      pending[id] = cb;
      setTimeout(function () { if (pending[id]) { delete pending[id]; cb({ ok: false, error: 'WALLET_UNAVAILABLE' }); } }, 10000);
      ws.send(AUTH ? AUTH.pack(ws, op, EVENT, id, data) : JSON.stringify({ op: op, event: EVENT, id: id, data: data }));
    }

    function onReply(id, data) {
      var cb = pending[id];
      if (!cb) return;
      delete pending[id];
      cb(data);
    }

    function onSnapshot(d) {
      S.history = (d.history || []).map(function (r) { return r.crashPoint; });
      // A reconnect rebuilds the list from the server; my own local rows (demo bets) are kept
      // when the round is still the same.
      var mine = S.bets.filter(function (b) { return b.mine; }), roundBefore = S.round;
      S.bets = [];
      (d.round || []).forEach(function (m) { onEvent(m.type, m.data, true); });
      var by = d.byType || {};
      if (by.maintenance) maint('engine', by.maintenance.data);
      if (by['round.betting']) { S.hash = by['round.betting'].data.hash; S.rtp = by['round.betting'].data.rtp; }
      if (d.latest) onEvent(d.latest.type, d.latest.data, true);
      if (mine.length && S.round === roundBefore) S.bets = S.bets.concat(mine);
      if (roundBefore && S.round !== roundBefore) loadBalance(); // a round ended while we were away
      // The socket is back but the flight has not moved on since it went silent: the engine itself
      // is not sending (it is restarting). Keep waiting; its next live message starts the game again.
      if (stale && phase === 'flying' && S.round === stale.round && S.mult <= stale.mult) phase = 'waiting';
      S.gotSnapshot = true;
      change();
    }

    function onEvent(type, d, fromSnapshot) {
      if (!fromSnapshot && type.indexOf('round.') === 0) stale = null; // the engine is heard live
      switch (type) {
        case 'round.betting':
          S.phase = 'betting';
          S.round = d.round; S.hash = d.hash; S.rtp = d.rtp; S.seed = '';
          S.bettingEndsAt = new Date(d.bettingEndsAt).getTime();
          S.bettingStartsAt = fromSnapshot ? S.bettingEndsAt - BETTING_MS : Date.now();
          S.mult = 1; S.bets = [];
          if (!fromSnapshot) S.bettingPhrase = NXPhrases.pick('betting');
          [0, 1].forEach(function (slot) {
            if (S.my[slot] && S.my[slot].round !== d.round) S.my[slot] = null;
          });
          if (!fromSnapshot) signal('betting');
          if (!fromSnapshot) [0, 1].forEach(function (slot) {
            var q = S.queued[slot];
            if (q) { S.queued[slot] = null; bet(slot, q.amount, q.auto); }
          });
          break;
        case 'round.start':
          S.phase = 'flying'; S.round = d.round; S.flightStart = Date.now(); S.mult = 1;
          if (!fromSnapshot) signal('start');
          break;
        case 'round.tick':
          if (d.round !== S.round) { S.round = d.round; S.mult = 1; } // joined mid-flight: not the old round's multiplier
          if (S.phase !== 'flying') { S.phase = 'flying'; S.round = d.round; if (!fromSnapshot) signal('start'); }
          S.flightStart = Date.now() - d.elapsedMs;
          S.mult = Math.max(S.mult, d.multiplier);
          autoCashedOut();
          break;
        case 'round.crash':
          S.phase = 'crashed'; S.crashPoint = d.crashPoint; S.mult = d.crashPoint; S.seed = d.seed; S.hash = d.hash;
          if (d.round) S.round = d.round; // (joined after this round opened: its number comes with its end)
          if (!fromSnapshot) S.crashPhrase = NXPhrases.pick('crash');
          if (!fromSnapshot) S.history.unshift(d.crashPoint);
          S.history = S.history.slice(0, 30);
          S.my.forEach(function (my) {
            if (!my || my.round !== d.round || (my.status !== 'placed' && my.status !== 'cashing')) return;
            if (!DEMO && my.auto && my.auto < d.crashPoint) settleMine(my, my.auto, round2(my.amount * my.auto));
            else { my.status = 'lost'; my.x = 0; my.win = 0; recordMine(my); }
          });
          if (!fromSnapshot) {
            signal('crash', { crashPoint: d.crashPoint });
            if (!DEMO) setTimeout(loadBalance, 800);
          }
          break;
        case 'maintenance':
          maint('engine', d);
          if (d.enabled) S.queued = [null, null]; // no bet waits for a round that won't open
          break;
        case 'round.bet':
          S.bets.push({ player: d.player, slot: d.slot || 0, amount: d.amount, x: 0, win: '' });
          break;
        case 'round.cashout':
          for (var i = 0; i < S.bets.length; i++) {
            var b = S.bets[i];
            if (b.player === d.player && (b.slot || 0) === (d.slot || 0) && !b.x) { b.x = d.multiplier; b.win = d.win; break; }
          }
          break;
      }
      if (!fromSnapshot) change();
    }

    // ---------------------------------------------------------------- money
    function loadBalance() {
      if (DEMO) return;
      fetch(API + '/playerBalance', { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN } })
        .then(function (r) { return r.json(); })
        .then(function (p) {
          var b = p && p.data && p.data.balance;
          if (b != null) { S.balance = Number(b); change(); }
        })
        .catch(function () {});
    }

    // Bet limit in the player's currency (demo: EUR). The game preselects the min bet.
    function loadLimits() {
      var req = DEMO
        ? fetch(API + '/games', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (p) {
            var g = ((p.data && p.data.items) || []).filter(function (x) { return x.id === EVENT; })[0];
            return g && g.minBet ? { min: g.minBet, max: g.maxBet } : null;
          })
        : fetch(API + '/betLimit?game=' + encodeURIComponent(EVENT), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN } })
            .then(function (r) { return r.json(); }).then(function (p) { return p.data && p.data.limit; });
      return req.then(function (l) {
        if (l) LIMIT = { min: Number(l.min), max: Number(l.max) };
        return LIMIT;
      }).catch(function () { return LIMIT; });
    }

    function error(code, fallback) {
      if (code === 'MAINTENANCE' && !maintBlocked()) maint('refused');
      signal('error', { text: ERRORS[code] || code || fallback });
    }

    function bet(slot, amount, auto) {
      if (maintBlocked()) return error('MAINTENANCE');
      amount = round2(amount || 0);
      if (!amount) return error('INVALID_AMOUNT');
      if (S.phase !== 'betting') { S.queued[slot] = { amount: amount, auto: auto }; return change(); }
      var round = S.round;
      if (DEMO) {
        if (amount > S.balance) return error('INSUFFICIENT_FUNDS');
        S.balance = round2(S.balance - amount);
        S.my[slot] = { slot: slot, round: round, amount: amount, auto: auto, status: 'placed' };
        S.bets.push({ player: 'You', slot: slot, amount: amount.toFixed(2), x: 0, win: '', mine: true });
        return change();
      }
      var my = S.my[slot] = { slot: slot, round: round, amount: amount, auto: auto, status: 'pending' };
      change();
      act('bet', { token: TOKEN, slot: slot, amount: amount.toFixed(2), autoCashout: auto || 0 }, function (res) {
        if (S.my[slot] !== my) return;
        if (!res.ok) { S.my[slot] = null; change(); return error(res.error, 'Bet failed'); }
        my.status = 'placed';
        if (res.result && res.result.balance != null) S.balance = Number(res.result.balance);
        change();
      });
    }

    function cashOut(slot) {
      var my = S.my[slot];
      if (!my || my.status !== 'placed' || S.phase !== 'flying') return;
      if (DEMO) return settleMine(my, currentMult(), null);
      my.status = 'cashing';
      change();
      act('cashout', { token: TOKEN, slot: slot }, function (res) {
        if (S.my[slot] !== my) return;
        if (!res.ok) {
          if (res.error === 'TOO_LATE') { my.status = 'lost'; recordMine(my); } else my.status = 'placed';
          change();
          return error(res.error, 'Cash out failed');
        }
        settleMine(my, res.result.multiplier, Number(res.result.win));
        if (res.result.balance != null) S.balance = Number(res.result.balance); else loadBalance();
        change();
      });
    }

    // settleMine: a bet of mine is cashed out at x (win computed when not given).
    function settleMine(my, x, win) {
      my.status = 'cashed'; my.x = x; my.win = win != null ? win : round2(my.amount * x);
      if (DEMO) {
        S.balance = round2(S.balance + my.win);
        S.bets.forEach(function (b) { if (b.mine && b.slot === my.slot && !b.x) { b.x = x; b.win = my.win.toFixed(2); } });
      }
      recordMine(my);
      signal('win', { slot: my.slot, x: x, win: my.win, text: 'You won ' + fmt.format(my.win) + ' at ' + x.toFixed(2) + 'x' });
      change();
    }

    function recordMine(my) {
      if (!my || my.recorded) return;
      my.recorded = true;
      S.myBets.unshift({ round: my.round, amount: my.amount, x: my.x || 0, win: my.win || 0, at: Date.now() });
      S.myBets = S.myBets.slice(0, 50);
    }

    // Auto cash-out: the engine pays at the first tick that reaches it, so once the live
    // multiplier gets there the bet is cashed out.
    function autoCashedOut() {
      S.my.forEach(function (my) {
        if (!my || my.status !== 'placed' || !my.auto || S.mult < my.auto) return;
        settleMine(my, my.auto, null);
        if (!DEMO) setTimeout(loadBalance, 700);
      });
    }

    // Between two ticks the multiplier is counted on from the last one — only while the engine
    // is heard (S.phase checks that), and never above the engine's cap.
    function currentMult() {
      if (S.phase !== 'flying') return S.mult;
      var m = Math.floor(Math.exp(GROWTH * (Date.now() - S.flightStart)) * 100) / 100;
      return Math.min(MAX_MULT, Math.max(S.mult, m));
    }

    // ---------------------------------------------------------------- page
    // Back: inside our game screen → tell it (lobby without a page load); alone → navigate.
    function back() {
      if (window.parent !== window) return window.parent.postMessage({ type: 'nexorng:back' }, location.origin);
      location.href = '/lobby'; // the lobby; "Back to home" (the operator's site) is in the lobby's account menu
    }
    // The game screen keeps the NEXORNG loader up until the game says it is ready.
    function ready() {
      if (window.parent !== window) window.parent.postMessage({ type: 'nexorng:ready' }, location.origin);
      window.dispatchEvent(new Event('nexorng:ready')); // the game's own late work (music) starts now
    }
    // Browser bar colour: the game's top colour, on its own page and on the game screen around it.
    var lastTheme = '';
    function theme(color) {
      if (!color || color === lastTheme) return;
      lastTheme = color;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', color);
      if (window.parent !== window) window.parent.postMessage({ type: 'nexorng:theme', color: color }, location.origin);
    }
    // Leaving the page (or it going into the back-forward cache) closes the connection, so the
    // player stops counting in the lobby at once; coming back reconnects.
    window.addEventListener('pagehide', function () { leaving = true; if (ws) ws.close(); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; drop(); } });

    loadBalance();
    var limitsLoaded = loadLimits();
    connect();

    return {
      S: S,
      event: EVENT,
      growth: GROWTH,
      bet: bet,
      cashOut: cashOut,
      cancelQueued: function (slot) { S.queued[slot] = null; change(); },
      currentMult: currentMult,
      limit: function () { return LIMIT; },
      limitsLoaded: limitsLoaded,
      money: function (n) { return fmt.format(n); },
      round2: round2,
      back: back,
      ready: ready,
      theme: theme,
    };
  }

  window.NXCrash = { start: start };
})();
