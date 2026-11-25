/* NEXORNG wheel client — shared by the roulette / wheel games. Each spin is drawn by the engine at
 * once (individual play), provably fair, and settled with the operator's wallet. Demo players
 * spin locally (crypto.getRandomValues) with €10 and the same config + payouts.
 *
 *   var game = NXWheel.start({ event: '88.0038', onChange: render, onSignal: sound });
 *   game.S = { demo, connected, gotSnapshot, config (the wheel JSON), rtp, spinning, balance,
 *              last: null | { results, boosts, bets, stake, win, round, hash, seed, clientSeed },
 *              history: [results…] (mine, newest first), myBets: [{ at, stake, win, results }],
 *              bets: [{ player, stake, win, results, mine }] (everyone's, newest first) }
 *   game.multiplier(pockets[, hits]) → payout multiplier for a pocket set (hits: Double Ball 1 or 2;
 *              Neon Boost straights return the un-boosted base — a boosted pocket pays its boost)
 *   game.spin(bets[, clientSeed]) → Promise<result> — bets: [{ pockets: [indices], amount }];
 *              fires 'spin' then 'result'; rejects after 'error'
 *   game.limit(), game.limitsLoaded, game.money(n), game.round2(n), game.back(), game.ready(), game.theme('#rrggbb')
 *   onSignal: 'spin' (start the wheel), 'result' { results, boosts, win, text }, 'error' { text }
 *
 * Pay rules (same as the engine, floored to 2 decimals), P = weight of the set / total weight:
 * normal RTP/P · two balls: x1 = RTP/(P1+3·P2), x2 = 3·x1 (P1 = 2P(1−P), P2 = P²) — if x1 < 1 one hit
 * is a push (1) and two hits pay (RTP−P1)/P2 · boost straights: boosted pocket pays its value, else
 * b = (RTP·N − q·E[m])/(1 − q), q = E[count]/N · zeroHalfBack even-money sets: (RTP − 0.5·P0)/P,
 * a zero gives 0.5 back.
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

  var ERRORS = {
    INVALID_BETS: 'Those bets aren’t valid — check your chips.',
    INVALID_AMOUNT: 'Enter a valid amount (max 2 decimals).',
    INSUFFICIENT_FUNDS: 'Not enough balance.',
    BET_LIMIT: 'Total bet is outside this game’s limits.',
    OPERATOR_LIMIT_REACHED: 'The casino’s limit is reached. Try a smaller bet.',
    PLAYER_BLOCKED: 'Your account can’t play right now.',
    MAINTENANCE: 'Betting is paused for maintenance — back soon.',
    SESSION_EXPIRED: 'Your session expired. Reopen the game.',
    WALLET_UNAVAILABLE: 'Wallet not reachable. Try again.',
    GAME_UNAVAILABLE: 'Game is restarting. Try again in a moment.',
    GAME_CLOSING: 'Game is restarting. Try again in a moment.',
    TOO_MANY_REQUESTS: 'Slow down a little.',
    NOT_SUBSCRIBED: 'Reconnecting… try again.',
  };
  var MAX_BETS = 40;

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function round2(n) { return Math.floor(n * 100 + 1e-6) / 100; }
  function floor2(v) { return Math.floor(v * 100 + 1e-9) / 100; }

  // ---------------------------------------------------------------- rules (engine: internal/wheel)
  function prepare(cfg) {
    cfg.balls = cfg.balls || 1;
    cfg._total = 0; cfg._zeros = {};
    cfg.pockets.forEach(function (p, i) {
      cfg._total += p.weight;
      if ((p.tags || []).indexOf('zero') >= 0) cfg._zeros[i] = true;
    });
    return cfg;
  }
  function weightOf(cfg, set) { var w = 0; set.forEach(function (i) { w += cfg.pockets[i].weight; }); return w; }
  function validSet(cfg, set) {
    if (!Array.isArray(set) || set.length < 1 || set.length >= cfg.pockets.length) return false;
    var seen = {};
    for (var i = 0; i < set.length; i++) {
      var v = set[i];
      if (v !== Math.floor(v) || v < 0 || v >= cfg.pockets.length || seen[v]) return false;
      seen[v] = true;
    }
    return true;
  }
  function halfBack(cfg, set) {
    if (!cfg.zeroHalfBack) return false;
    for (var i = 0; i < set.length; i++) if (cfg._zeros[set[i]]) return false;
    var zw = 0;
    Object.keys(cfg._zeros).forEach(function (i) { zw += cfg.pockets[i].weight; });
    return 2 * weightOf(cfg, set) === cfg._total - zw;
  }
  function boostBase(cfg, rtp) {
    var b = cfg.boost, n = cfg.pockets.length, q = (b.count[0] + b.count[1]) / 2 / n, em = 0;
    b.values.forEach(function (v) { em += v; });
    em /= b.values.length;
    return (rtp * n - q * em) / (1 - q);
  }
  function multiplier(cfg, set, hits, rtp) {
    if (!cfg || !validSet(cfg, set)) return 0;
    hits = hits || 1;
    var p = weightOf(cfg, set) / cfg._total;
    if (cfg.balls === 2) {
      var p1 = 2 * p * (1 - p), p2 = p * p, x1 = rtp / (p1 + 3 * p2);
      if (x1 >= 1) return hits === 2 ? floor2(3 * x1) : floor2(x1);
      return hits === 2 ? floor2((rtp - p1) / p2) : 1;
    }
    if (cfg.boost && set.length === 1) return floor2(boostBase(cfg, rtp));
    if (halfBack(cfg, set)) {
      var p0 = 0;
      Object.keys(cfg._zeros).forEach(function (i) { p0 += cfg.pockets[i].weight / cfg._total; });
      return floor2((rtp - 0.5 * p0) / p);
    }
    return floor2(rtp / p);
  }
  function payout(cfg, set, results, boosts, rtp) {
    var hits = 0;
    results.forEach(function (r) { if (set.indexOf(r) >= 0) hits++; });
    if (!hits) return halfBack(cfg, set) && cfg._zeros[results[0]] ? 0.5 : 0;
    if (cfg.boost && set.length === 1) {
      for (var i = 0; i < boosts.length; i++) if (boosts[i].pocket === set[0]) return boosts[i].x;
    }
    return multiplier(cfg, set, hits, rtp);
  }
  // demo draw: unbiased integers from crypto.getRandomValues (the engine uses its HMAC stream)
  function intn(n) {
    var a = new Uint32Array(1), limit = Math.floor(4294967296 / n) * n;
    for (;;) {
      crypto.getRandomValues(a);
      if (a[0] < limit) return a[0] % n;
    }
  }
  function demoDraw(cfg) {
    var boosts = [], results = [];
    if (cfg.boost) {
      var b = cfg.boost, count = b.count[0] + intn(b.count[1] - b.count[0] + 1), taken = {};
      while (boosts.length < count) {
        var p = intn(cfg.pockets.length);
        if (taken[p]) continue;
        taken[p] = true;
        boosts.push({ pocket: p, x: b.values[intn(b.values.length)] });
      }
    }
    for (var ball = 0; ball < cfg.balls; ball++) {
      var r = intn(cfg._total);
      for (var i = 0; i < cfg.pockets.length; i++) {
        if (r < cfg.pockets[i].weight) { results.push(i); break; }
        r -= cfg.pockets[i].weight;
      }
    }
    return { results: results, boosts: boosts };
  }

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

    var S = {
      demo: DEMO, connected: false, gotSnapshot: false, config: null, rtp: 0.97, spinning: false,
      balance: DEMO ? 10 : null, last: null, history: [], myBets: [], bets: [],
    };
    var LIMIT = { min: 0.1, max: 0 };
    var ws = null, reqId = 0, pending = {}, leaving = false, demoRound = 0;
    // Maintenance: a spin in progress finishes; then the overlay.
    maint('attach', { api: API, round: false, busy: function () { return S.spinning; } });

    function setConfig(c) {
      if (!c || !Array.isArray(c.pockets) || !c.pockets.length) return;
      S.config = prepare(JSON.parse(JSON.stringify(c)));
      change();
    }

    // ---------------------------------------------------------------- socket
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
        if (m.type === 'snapshot') {
          var by = (m.data && m.data.byType) || {};
          if (by['game.ready']) setConfig(by['game.ready'].data); // the engine's wheel (source of truth)
          if (by.maintenance) maint('engine', by.maintenance.data);
          S.gotSnapshot = true;
          return change();
        }
        if (m.event === EVENT && m.type === 'maintenance') return maint('engine', m.data || {});
        if (m.event === EVENT && m.type === 'game.ready') setConfig(m.data);
        if (m.event === EVENT && m.type === 'wheel.result') addBet(m.data || {});
      };
    }
    // Before the snapshot (or if the engine doesn't run the game yet): the app's own wheel.json.
    fetch('wheel.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { if (c && !S.config) setConfig(c); })
      .catch(function () {});

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

    // Everyone's results; my own spin's event and reply can come in either order (listed once, mine).
    var mineUnseen = [];
    function same(a, b) { return a.stake === b.stake && a.win === b.win && String(a.results) === String(b.results); }
    function addBet(d) {
      var row = { player: d.player, stake: d.stake, win: d.win, results: d.results || [], boosts: d.boosts || [], mine: false };
      for (var i = 0; i < mineUnseen.length; i++) if (same(mineUnseen[i], row)) { mineUnseen.splice(i, 1); return; }
      S.bets.unshift(row);
      S.bets = S.bets.slice(0, 30);
      change();
    }
    function markMine(r) {
      var key = { stake: r.stake, win: r.win, results: r.results };
      for (var i = 0; i < Math.min(S.bets.length, 10); i++) {
        if (!S.bets[i].mine && same(S.bets[i], key)) { S.bets[i].mine = true; return; }
      }
      S.bets.unshift({ player: 'You', stake: r.stake, win: r.win, results: r.results, boosts: r.boosts || [], mine: true });
      S.bets = S.bets.slice(0, 30);
      mineUnseen.push(key);
      if (mineUnseen.length > 10) mineUnseen.shift();
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
    var gameInfo = fetch(API + '/games', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (p) {
        var g = ((p.data && p.data.items) || []).filter(function (x) { return x.id === EVENT; })[0];
        if (g && Number(g.rtp) > 0 && Number(g.rtp) < 1) { S.rtp = Number(g.rtp); change(); }
        return g || null;
      })
      .catch(function () { return null; });
    function loadLimits() {
      var req = DEMO
        ? gameInfo.then(function (g) { return g && g.minBet ? { min: g.minBet, max: g.maxBet } : null; })
        : fetch(API + '/betLimit?game=' + encodeURIComponent(EVENT), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN } })
            .then(function (r) { return r.json(); }).then(function (p) { return p.data && p.data.limit; });
      return req.then(function (l) {
        if (l) LIMIT = { min: Number(l.min), max: Number(l.max) };
        return LIMIT;
      }).catch(function () { return LIMIT; });
    }

    // ---------------------------------------------------------------- spin
    function fail(code, fallback) {
      if (code === 'MAINTENANCE' && !maintBlocked()) maint('refused');
      S.spinning = false;
      var text = ERRORS[code] || code || fallback;
      signal('error', { text: text });
      change();
      return Promise.reject(new Error(text));
    }

    function settle(r) {
      S.last = { results: r.results, boosts: r.boosts || [], bets: r.bets || [], stake: r.stake, win: r.win,
        round: r.round || 0, hash: r.hash || '', seed: r.seed || '', clientSeed: r.clientSeed || '' };
      S.history.unshift(r.results);
      S.history = S.history.slice(0, 50);
      S.myBets.unshift({ at: Date.now(), stake: Number(r.stake), win: Number(r.win), results: r.results });
      S.myBets = S.myBets.slice(0, 50);
      S.spinning = false;
      if (!DEMO) markMine(r);
      var w = Number(r.win);
      var text = w > 0 ? 'You won ' + fmt.format(w) : 'No win this time';
      signal('result', { results: r.results, boosts: r.boosts || [], win: w, text: text });
      change();
      return S.last;
    }

    function spin(bets, clientSeed) {
      var cfg = S.config;
      if (S.spinning) return fail('TOO_MANY_REQUESTS');
      if (maintBlocked()) return fail('MAINTENANCE');
      if (!cfg) return fail('GAME_UNAVAILABLE');
      if (!Array.isArray(bets) || !bets.length || bets.length > MAX_BETS) return fail('INVALID_BETS');
      var clean = [], stake = 0;
      for (var i = 0; i < bets.length; i++) {
        var a = round2(Number(bets[i].amount) || 0);
        if (!validSet(cfg, bets[i].pockets)) return fail('INVALID_BETS');
        if (a < 0.01) return fail('INVALID_AMOUNT');
        clean.push({ pockets: bets[i].pockets.slice(), amount: a.toFixed(2) });
        stake = round2(stake + a);
      }
      S.spinning = true;
      signal('spin');
      change();
      if (DEMO) {
        if (stake > S.balance) return fail('INSUFFICIENT_FUNDS');
        S.balance = round2(S.balance - stake);
        var d = demoDraw(cfg), win = 0, out = [];
        clean.forEach(function (b) {
          var x = payout(cfg, b.pockets, d.results, d.boosts, S.rtp), bw = round2(Number(b.amount) * x);
          win = round2(win + bw);
          out.push({ pockets: b.pockets, amount: b.amount, x: x, win: bw.toFixed(2) });
        });
        S.balance = round2(S.balance + win);
        demoRound++;
        var r = { round: demoRound, results: d.results, boosts: d.boosts, bets: out, stake: stake.toFixed(2), win: win.toFixed(2), clientSeed: clientSeed || '' };
        S.bets.unshift({ player: 'You', stake: r.stake, win: r.win, results: r.results, boosts: r.boosts, mine: true });
        S.bets = S.bets.slice(0, 30);
        return Promise.resolve(settle(r));
      }
      return new Promise(function (resolve, reject) {
        act('spin', { token: TOKEN, bets: clean, clientSeed: clientSeed || '' }, function (res) {
          if (!res.ok) { fail(res.error, 'Spin failed').catch(reject); return; }
          var r = res.result || {};
          if (r.balance != null) S.balance = Number(r.balance); else setTimeout(loadBalance, 300);
          resolve(settle(r));
        });
      });
    }

    // ---------------------------------------------------------------- page
    function back() {
      if (window.parent !== window) return window.parent.postMessage({ type: 'nexorng:back' }, location.origin);
      location.href = '/lobby'; // the lobby; "Back to home" (the operator's site) is in the lobby's account menu
    }
    function ready() {
      if (window.parent !== window) window.parent.postMessage({ type: 'nexorng:ready' }, location.origin);
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
    window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; connect(); } });

    loadBalance();
    var limitsLoaded = loadLimits();
    connect();

    return {
      S: S,
      event: EVENT,
      spin: spin,
      multiplier: function (pockets, hits) { return multiplier(S.config, pockets, hits, S.rtp); },
      limit: function () { return LIMIT; },
      limitsLoaded: limitsLoaded,
      money: function (n) { return fmt.format(n); },
      round2: round2,
      back: back,
      ready: ready,
      theme: theme,
    };
  }

  window.NXWheel = { start: start };
})();
