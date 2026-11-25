/* NEXORNG solo client — shared by every INDIVIDUAL game on the NEXORNG engine (each player
 * plays their own round, e.g. Balloon). A bet starts the player's round at once; the
 * multiplier grows e^(0.00006·ms) until the player cashes out (or auto cash-out pays) or the
 * round busts. Results are provably fair: the round's seed hash comes with the start, the seed
 * when it ends. Real players play through the socket (the engine settles with the operator's
 * wallet); demo players play locally with €10.
 *
 *   var game = NXSolo.start({ event: '88.0019', onChange: render, onSignal: sound });
 *   game.S = { demo, connected, phase: 'idle'|'starting'|'running'|'busted'|'cashed', mult,
 *              crashPoint, roundHash, seed, balance, history [{x, busted}], myBets [{at, amount,
 *              x, win}], bets (others' recent results [{player, amount, x, win, mine}]),
 *              bettingPhrase, crashPhrase, gotSnapshot }
 *   game.play(amount, autoCashout) / game.cashOut() / game.currentMult()
 *   game.limit(), game.limitsLoaded, game.money(n), game.round2(n), game.back(), game.ready(),
 *   game.theme('#rrggbb')
 *   onSignal(name, data): 'start', 'win' {x, win, text}, 'bust' {crashPoint}, 'error' {text}
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

  var GROWTH = 0.00006; // the engine's curve
  var MAX_MULT = 10000; // the engine's cap on a round: no multiplier on screen is ever above it
  var MAX_MS = Math.ceil(Math.log(MAX_MULT) / GROWTH); // no round runs longer than this
  var LEAD_MS = 400; // demo: same short pause before the round starts as the engine
  // A dead connection often closes without telling the page (lost network, a phone that slept, a
  // tab kept in the background), and the end of my round then never arrives. So the game asks the
  // socket for a sign of life — every second while my round runs — and without an answer the
  // multiplier stops where the engine was last heard (never counting up on its own), the game
  // reconnects, and the round is looked up in the list of finished rounds.
  var RUN_SILENT_MS = 3000, PING_AFTER_MS = 5000, PONG_MS = 5000, SILENT_MS = 15000;

  var ERRORS = {
    ALREADY_PLAYING: 'Your round is still running.',
    NO_ROUND: 'No round to cash out.',
    NOT_STARTED: 'One moment — the round is starting.',
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
  function multiplier(ms) { return ms <= 0 ? 1 : Math.min(MAX_MULT, Math.floor(Math.exp(GROWTH * ms) * 100) / 100); }

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
    var phrase = window.NXPhrases ? NXPhrases.pick : function () { return ''; };

    var S = {
      demo: DEMO,
      connected: false,
      gotSnapshot: false,
      phase: 'idle',
      mult: 1,
      crashPoint: 0,
      roundHash: '',
      seed: '',
      balance: DEMO ? 10 : null,
      history: [],
      myBets: [],
      bets: [],
      bettingPhrase: phrase('betting'),
      crashPhrase: phrase('crash'),
    };
    var LIMIT = { min: 0.1, max: 0 };
    var ws = null, reqId = 0, pending = {}, leaving = false;
    var round = null; // my round: { id, number, amount, auto, startLocal, demoCrash, timer }
    var heardAt = Date.now(), pingAt = 0, connections = 0;
    // Maintenance: my running round finishes as normal; the overlay waits for it.
    maint('attach', { api: API, round: false, busy: function () { return S.phase === 'starting' || S.phase === 'running'; } });

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
        if (m.type === 'snapshot') {
          var by = (m.data && m.data.byType) || {};
          if (by.maintenance) maint('engine', by.maintenance.data);
          S.gotSnapshot = true;
          // Connected again while my round runs: its end may have been sent while I was away.
          if (++connections > 1 && live()) { round.suspect = true; check(round); }
          return change();
        }
        if (m.event === EVENT && m.type === 'maintenance') return maint('engine', m.data || {});
        if (m.event === EVENT) onEvent(m.type, m.data || {});
      };
    }

    // live: a real round of mine is running (a demo round ends by its own timer).
    function live() { return !DEMO && !!round && !round.ended && S.phase === 'running'; }

    function drop() {
      if (leaving) return;
      var old = ws;
      ws = null;
      S.connected = false;
      if (old) { try { old.close(); } catch (e) { /* already gone */ } }
      connect();
      change();
    }
    // The watchdog (also run the moment the page is shown again after sleeping in the background).
    function checkAlive() {
      if (leaving || !ws) return;
      var now = Date.now(), quiet = now - heardAt, run = live();
      if (ws.readyState !== 1) { if (quiet > SILENT_MS) drop(); return; }
      if (pingAt > heardAt) { // asked for a sign of life, no answer yet
        if (now - pingAt > (run ? RUN_SILENT_MS : PONG_MS)) drop();
      } else if (quiet > (run ? 1000 : PING_AFTER_MS)) { pingAt = now; ws.send('{"op":"ping"}'); }
      if (!run) return;
      var r = round, over = now - r.startLocal > MAX_MS + 3000; // past the longest a round can run
      if ((r.suspect || over) && now - (r.checkedAt || 0) > 4000) check(r, over);
    }
    setInterval(checkAlive, 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkAlive(); });
    window.addEventListener('online', checkAlive);

    // check: my round may have ended without its end reaching me. Every finished round is on the
    // public round list: when mine is there it is settled here the way the engine settled it
    // (auto cash-out before the crash point, else lost); when it is not, it is still running and
    // its end will arrive. last: the round cannot be running any more — close it either way.
    function check(r, last) {
      if (DEMO || !r || r.ended || r.checking) return;
      r.checking = true; r.checkedAt = Date.now(); r.checks = (r.checks || 0) + 1;
      fetch(API + '/game-rounds/' + encodeURIComponent(EVENT), { headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (p) {
          r.checking = false;
          if (round !== r || r.ended) return;
          var done = ((p.data && p.data.items) || []).filter(function (x) { return x.round === r.number; })[0];
          if (!done) { if (last || (r.gone && r.checks > 2)) closeUnknown(r); return; }
          var cp = Number(done.crashPoint);
          // A cash-out of mine that got no answer, or a cancelled round: the result is not known here.
          if (r.cashSent || done.cancelled || !(cp >= 1)) return closeUnknown(r);
          var won = !!r.auto && r.auto < cp, win = won ? round2(r.amount * r.auto) : 0;
          S.bets.forEach(function (b) { if (b.id === r.id) { b.x = won ? r.auto : 0; b.win = won ? win.toFixed(2) : ''; b.done = true; } });
          finishMine(!won, won ? r.auto : 0, win, cp, done.seed || '');
          change();
        })
        .catch(function () { r.checking = false; if (last) closeUnknown(r); });
    }
    // closeUnknown: my round is over on the engine but its result did not reach this page. Nothing
    // is guessed: the game is ready again and the balance (re-read from the wallet) shows it.
    function closeUnknown(r) {
      if (round !== r || r.ended) return;
      r.ended = true;
      round = null;
      S.bets = S.bets.filter(function (b) { return b.id !== r.id; });
      S.phase = 'idle'; S.mult = 1; S.bettingPhrase = phrase('betting');
      loadBalance();
      signal('error', { text: 'Connection was lost during your round. Your balance shows the result.' });
      change();
    }

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

    // Others' results (and mine) for the list: solo.start adds a row, solo.end fills it in.
    function onEvent(type, d) {
      if (type === 'solo.start') {
        S.bets.unshift({ id: d.roundId, player: d.player, amount: d.amount, x: 0, win: '', mine: !!(round && round.id === d.roundId) });
        S.bets = S.bets.slice(0, 30);
      } else if (type === 'solo.end') {
        var row = null;
        for (var i = 0; i < S.bets.length; i++) if (S.bets[i].id === d.roundId) { row = S.bets[i]; break; }
        if (!row) { row = { id: d.roundId, player: d.player, amount: d.amount }; S.bets.unshift(row); }
        row.x = d.busted ? 0 : d.x; row.win = d.busted ? '' : d.win; row.done = true;
        if (round && round.id === d.roundId) finishMine(d.busted, d.busted ? 0 : d.x, d.busted ? 0 : Number(d.win), d.crashPoint, d.seed);
      } else return;
      change();
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

    // ---------------------------------------------------------------- my round
    function begin(id, amount, auto, startLocal, number) {
      round = { id: id, number: number, amount: amount, auto: auto, startLocal: startLocal };
      S.phase = 'running'; S.mult = 1; S.crashPoint = 0; S.seed = '';
      setTimeout(function () { if (round && round.id === id) signal('start'); }, Math.max(0, startLocal - Date.now()));
    }

    function play(amount, auto) {
      if (maintBlocked()) return error('MAINTENANCE');
      amount = round2(amount || 0);
      if (!amount) return error('INVALID_AMOUNT');
      if (S.phase === 'starting' || S.phase === 'running') return error('ALREADY_PLAYING');
      auto = auto || 0;
      if (DEMO) {
        if (amount > S.balance) return error('INSUFFICIENT_FUNDS');
        S.balance = round2(S.balance - amount);
        // the same distribution as the engine (RTP 97 %): P(crash ≥ x) = 0.97 / x
        var u = Math.random(), crashAt = Math.max(1, Math.floor((0.97 / (1 - u)) * 100) / 100);
        var id = 'demo-' + Date.now();
        S.roundHash = '';
        begin(id, amount, auto, Date.now() + LEAD_MS);
        round.demoCrash = crashAt;
        S.bets.unshift({ id: id, player: 'You', amount: amount.toFixed(2), x: 0, win: '', mine: true });
        var endAt = auto && auto < crashAt ? auto : crashAt;
        var ms = endAt <= 1 ? 0 : Math.ceil(Math.log(endAt) / GROWTH);
        round.timer = setTimeout(function () { demoEnd(id, auto && auto < crashAt ? auto : 0); }, LEAD_MS + ms);
        return change();
      }
      S.phase = 'starting';
      change();
      act('play', { token: TOKEN, amount: amount.toFixed(2), autoCashout: auto }, function (res) {
        if (!res.ok) { S.phase = 'idle'; change(); return error(res.error, 'Bet failed'); }
        var r = res.result || {};
        var offset = (r.serverNow || Date.now()) - Date.now(); // server clock − my clock
        S.roundHash = r.hash || '';
        if (r.balance != null) S.balance = Number(r.balance);
        begin(r.roundId, amount, auto, (r.startAt || Date.now()) - offset, r.round);
        for (var i = 0; i < S.bets.length; i++) if (S.bets[i].id === r.roundId) S.bets[i].mine = true;
        change();
      });
    }

    function demoEnd(id, x) {
      if (!round || round.id !== id) return;
      var crashAt = round.demoCrash;
      var win = x ? round2(round.amount * x) : 0;
      if (x) S.balance = round2(S.balance + win);
      S.bets.forEach(function (b) { if (b.id === id) { b.x = x; b.win = x ? win.toFixed(2) : ''; b.done = true; } });
      finishMine(!x, x, win, crashAt, '');
      change();
    }

    function cashOut() {
      if (!round || S.phase !== 'running') return;
      if (Date.now() < round.startLocal) return error('NOT_STARTED');
      if (DEMO) {
        var m = currentMult();
        if (m >= round.demoCrash) return; // the round ends by itself
        clearTimeout(round.timer);
        return demoEnd(round.id, m);
      }
      var mine = round;
      mine.cashSent = true;
      act('cashout', { token: TOKEN }, function (res) {
        if (round !== mine) return; // already ended (the solo.end event got here first)
        if (!res.ok) {
          // (no answer at all — WALLET_UNAVAILABLE — may still have been paid: cashSent stays)
          if (res.error !== 'WALLET_UNAVAILABLE') mine.cashSent = false;
          // The engine no longer has my round: it ended while the connection was away.
          if (res.error === 'NO_ROUND') { mine.suspect = mine.gone = true; return check(mine); }
          if (res.error !== 'TOO_LATE') error(res.error, 'Cash out failed');
          return;
        }
        var r = res.result || {};
        if (r.balance != null) S.balance = Number(r.balance); else loadBalance();
        finishMine(false, r.multiplier, Number(r.win), 0, '');
        change();
      });
    }

    function finishMine(busted, x, win, crashPoint, seed) {
      var r = round;
      if (!r || r.ended) { if (crashPoint) S.crashPoint = crashPoint; if (seed) S.seed = seed; return; }
      r.ended = true;
      S.phase = busted ? 'busted' : 'cashed';
      S.mult = busted ? crashPoint : x;
      if (crashPoint) S.crashPoint = crashPoint;
      if (seed) S.seed = seed;
      S.history.unshift({ x: busted ? crashPoint : x, busted: busted });
      S.history = S.history.slice(0, 30);
      S.myBets.unshift({ at: Date.now(), amount: r.amount, x: busted ? 0 : x, win: busted ? 0 : win });
      S.myBets = S.myBets.slice(0, 50);
      if (busted) { S.crashPhrase = phrase('crash'); signal('bust', { crashPoint: crashPoint }); }
      else signal('win', { x: x, win: win, text: 'You won ' + fmt.format(win) + ' at ' + x.toFixed(2) + 'x' });
      if (!DEMO) setTimeout(loadBalance, 600);
      // back to "ready to play" after a short moment showing the result
      setTimeout(function () {
        if (round === r) { round = null; S.phase = 'idle'; S.bettingPhrase = phrase('betting'); change(); }
      }, 2200);
    }

    // The multiplier is counted from the round's start — a demo round never past its own crash
    // point, a real round only while the engine is heard (see the watchdog).
    function currentMult() {
      if (!round || S.phase !== 'running') return S.mult;
      if (DEMO) return Math.min(multiplier(Date.now() - round.startLocal), round.demoCrash);
      return multiplier(Math.min(Date.now(), heardAt + RUN_SILENT_MS) - round.startLocal);
    }

    // ---------------------------------------------------------------- page
    function back() {
      if (window.parent !== window) return window.parent.postMessage({ type: 'nexorng:back' }, location.origin);
      location.href = '/lobby'; // the lobby; "Back to home" (the operator's site) is in the lobby's account menu
    }
    function ready() {
      if (window.parent !== window) window.parent.postMessage({ type: 'nexorng:ready' }, location.origin);
      window.dispatchEvent(new Event('nexorng:ready')); // the game's own late work (music) starts now
    }
    var lastTheme = '';
    function theme(color) {
      if (!color || color === lastTheme) return;
      lastTheme = color;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', color);
      if (window.parent !== window) window.parent.postMessage({ type: 'nexorng:theme', color: color }, location.origin);
    }
    window.addEventListener('pagehide', function () { leaving = true; if (ws) ws.close(); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; drop(); } });

    loadBalance();
    var limitsLoaded = loadLimits();
    connect();

    return {
      S: S,
      event: EVENT,
      growth: GROWTH,
      play: play,
      cashOut: cashOut,
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

  window.NXSolo = { start: start };
})();
