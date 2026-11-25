/* NEXORNG instant client — shared by the instant dice games (Lucky Six, Seven Up, Dice Duel).
 * Each bet is rolled by the engine at once (individual play), provably fair, and settled with
 * the operator's wallet. Demo players roll locally (crypto.getRandomValues) with €10.
 *
 *   var game = NXInstant.start({ event: '88.0036', rules: 'sevenup', onChange: render, onSignal: sound });
 *   game.S = { demo, connected, gotSnapshot, rolling, balance, rtp,
 *              last: null | { dice, won, push, x, win, choice, round, hash, seed, clientSeed },
 *              history: [ { dice, won, push, x } ] (mine, newest first, ≤ 30),
 *              myBets: [ { at, amount, dice, x, win } ],
 *              bets: [ { player, amount, dice, x, win, won } ] (everyone's recent results, ≤ 30) }
 *   game.roll(amount, choice[, clientSeed]) → Promise<{round, dice, won, push, x, win, hash, seed,
 *              clientSeed, text}> (also signals; rejects after onSignal('error') when refused)
 *   S.bets rows: { player, amount, dice, x, win, won, push, mine } (mine: true for my own rolls)
 *   game.reveal() — call when the dice animation has LANDED: only then are the win credited to the shown
 *              balance and the history / My bets / All bets updated (auto after 10 s as a safety net)
 *   game.multiplier(choice) → what a winning choice pays at the current RTP (for the UI)
 *   game.limit(), game.limitsLoaded, game.money(n), game.round2(n), game.back(), game.ready(), game.theme('#rrggbb')
 *   onSignal: 'roll' (request sent — start the roll animation), 'result' {dice, won, push, x, win, text}, 'error' {text}
 *
 * Choices — luckysix: { numbers: [1..6] } (1–5 distinct) · sevenup: { pick: 'under'|'seven'|'over' }
 * or { pick: 'sum', sum: 2..12 } · diceduel: {} (dice[0] = player, dice[1] = house; tie = stake back).
 * Payouts (floored to 2 decimals): luckysix RTP·6/k · sevenup RTP·36/ways (under/over 15, seven 6,
 * sum s: 6 − |s − 7|) · diceduel win (36·RTP − 6)/15 (a tie returns the stake, so the return stays RTP).
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
    INVALID_CHOICE: 'Pick a valid choice first.',
    INVALID_AMOUNT: 'Enter a valid amount (max 2 decimals).',
    INSUFFICIENT_FUNDS: 'Not enough balance.',
    BET_LIMIT: 'Bet is outside this game’s limits.',
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

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function round2(n) { return Math.floor(n * 100 + 1e-6) / 100; }
  function floor2(v) { return Math.floor(v * 100 + 1e-9) / 100; }

  // The engine's payout rules (internal/instant: Multiplier). 0 = not a valid choice.
  function multiplierFor(rules, c, rtp) {
    c = c || {};
    if (rules === 'luckysix') {
      var nums = c.numbers || [], seen = {};
      if (nums.length < 1 || nums.length > 5) return 0;
      for (var i = 0; i < nums.length; i++) {
        var n = nums[i];
        if (!(n >= 1 && n <= 6) || n !== Math.floor(n) || seen[n]) return 0;
        seen[n] = true;
      }
      return floor2(rtp * 6 / nums.length);
    }
    if (rules === 'sevenup') {
      var ways = c.pick === 'under' || c.pick === 'over' ? 15 : c.pick === 'seven' ? 6
        : c.pick === 'sum' && c.sum >= 2 && c.sum <= 12 && c.sum === Math.floor(c.sum) ? 6 - Math.abs(c.sum - 7) : 0;
      return ways ? floor2(rtp * 36 / ways) : 0;
    }
    if (rules === 'diceduel') return floor2((36 * rtp - 6) / 15);
    return 0;
  }

  function outcome(rules, c, dice) { // { won, push }
    if (rules === 'luckysix') return { won: (c.numbers || []).indexOf(dice[0]) >= 0, push: false };
    if (rules === 'sevenup') {
      var s = dice[0] + dice[1];
      return { won: c.pick === 'under' ? s <= 6 : c.pick === 'seven' ? s === 7 : c.pick === 'over' ? s >= 8 : s === c.sum, push: false };
    }
    if (dice[0] === dice[1]) return { won: false, push: true };
    return { won: dice[0] > dice[1], push: false };
  }

  function demoDie() { // uniform 1–6 without modulo bias
    var a = new Uint32Array(1);
    for (;;) {
      crypto.getRandomValues(a);
      if (a[0] < 4294967292) return (a[0] % 6) + 1;
    }
  }

  function start(opts) {
    var qs = new URLSearchParams(location.search);
    var EVENT = qs.get('event') || opts.event;
    var RULES = opts.rules;
    var TOKEN = safeGet('token') || '';
    var DEMO = !TOKEN || TOKEN === 'demo';
    var AUTH = window.NXAuth || null; // socket sign-in (socket-auth.js)
    var CURRENCY = safeGet('currency') || 'EUR';
    var fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var change = opts.onChange || function () {};
    var signal = opts.onSignal || function () {};

    var S = {
      demo: DEMO, connected: false, gotSnapshot: false, rolling: false,
      balance: DEMO ? 10 : null, rtp: 0.97,
      last: null, history: [], myBets: [], bets: [],
    };
    var LIMIT = { min: 0.1, max: 0 };
    var ws = null, reqId = 0, pending = {}, leaving = false, demoRound = 0;
    // Maintenance: a roll in progress (and its reveal) finishes; then the overlay.
    maint('attach', { api: API, round: false, busy: function () { return S.rolling || !!held; } });

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
          if (by.maintenance) maint('engine', by.maintenance.data);
          S.gotSnapshot = true;
          return change();
        }
        if (m.event === EVENT && m.type === 'maintenance') return maint('engine', m.data || {});
        if (m.event === EVENT && m.type === 'instant.result') addBet(m.data || {});
      };
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

    // Everyone's results (instant.result). My own roll's event and reply can arrive in either
    // order: the row is added once and marked mine.
    var mineUnseen = []; // my results whose public event hasn't arrived yet
    function sameRoll(a, b) { return a.amount === b.amount && a.win === b.win && String(a.dice) === String(b.dice); }
    function addBet(d) {
      if (S.rolling || held) { heldEvents.push(d); return; } // shown with my result, after the reveal
      var row = { player: d.player, amount: d.amount, dice: d.dice || [], x: d.x || 0, win: d.win || '0.00', won: !!d.won, push: !!d.push, mine: false };
      for (var i = 0; i < mineUnseen.length; i++) if (sameRoll(mineUnseen[i], row)) { mineUnseen.splice(i, 1); return; } // already listed
      S.bets.unshift(row);
      S.bets = S.bets.slice(0, 30);
      change();
    }
    function markMine(amount, r) {
      var key = { amount: amount.toFixed(2), win: Number(r.win).toFixed(2), dice: r.dice };
      for (var i = 0; i < Math.min(S.bets.length, 10); i++) {
        if (!S.bets[i].mine && sameRoll(S.bets[i], key)) { S.bets[i].mine = true; return; }
      }
      S.bets.unshift({ player: 'You', amount: key.amount, dice: r.dice, x: r.x, win: key.win, won: !!r.won, push: !!r.push, mine: true });
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

    // The game's RTP (payouts) and, for demo players, its EUR bet limit come from the lobby list.
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

    // ---------------------------------------------------------------- roll
    // The result is HELD until the app's dice animation lands: the balance, history and bet lists
    // change only when the app calls game.reveal() (or after REVEAL_MAX_MS as a safety net).
    var held = null, heldEvents = [], heldTimer = 0, preBalance = null, REVEAL_MAX_MS = 10000;
    function reveal() {
      if (!held) return;
      var apply = held;
      held = null;
      clearTimeout(heldTimer);
      preBalance = null;
      apply();
      S.rolling = false;
      var queued = heldEvents;
      heldEvents = [];
      queued.forEach(addBet);
      change();
    }
    function settle(amount, choice, r, balance) {
      held = function () {
        if (balance != null) S.balance = balance; else if (!DEMO) loadBalance();
        S.last = { dice: r.dice, won: r.won, push: r.push, x: r.x, win: Number(r.win), choice: choice,
          round: r.round || 0, hash: r.hash || '', seed: r.seed || '', clientSeed: r.clientSeed || '' };
        S.history.unshift({ dice: r.dice, won: r.won, push: r.push, x: r.x });
        S.history = S.history.slice(0, 30);
        S.myBets.unshift({ at: Date.now(), amount: amount, dice: r.dice, x: r.x, win: Number(r.win) });
        S.myBets = S.myBets.slice(0, 50);
        if (DEMO) {
          S.bets.unshift({ player: 'You', amount: amount.toFixed(2), dice: r.dice, x: r.x, win: Number(r.win).toFixed(2), won: !!r.won, push: !!r.push, mine: true });
          S.bets = S.bets.slice(0, 30);
        } else markMine(amount, r);
      };
      heldTimer = setTimeout(reveal, REVEAL_MAX_MS);
      var text = r.push ? 'Tie — stake returned' : r.won ? 'You won ' + fmt.format(Number(r.win)) + ' at ' + r.x.toFixed(2) + 'x' : 'No win this time';
      var out = { round: r.round || 0, dice: r.dice, won: r.won, push: r.push, x: r.x, win: Number(r.win).toFixed(2),
        hash: r.hash || '', seed: r.seed || '', clientSeed: r.clientSeed || '', text: text };
      signal('result', out);
      change();
      return out;
    }

    function fail(code, fallback) {
      if (S.rolling && preBalance != null) S.balance = preBalance; // the stake wasn't taken
      preBalance = null;
      S.rolling = false;
      var queued = heldEvents;
      heldEvents = [];
      queued.forEach(addBet);
      if (code === 'MAINTENANCE' && !maintBlocked()) maint('refused');
      var text = ERRORS[code] || code || fallback;
      signal('error', { text: text });
      change();
      return Promise.reject(new Error(text));
    }

    function roll(amount, choice, clientSeed) {
      if (maintBlocked() && !S.rolling && !held) return fail('MAINTENANCE');
      amount = round2(amount || 0);
      choice = choice || {};
      if (S.rolling || held) return Promise.reject(new Error(ERRORS.TOO_MANY_REQUESTS || 'Please wait'));
      if (!amount) return fail('INVALID_AMOUNT');
      var x = multiplierFor(RULES, choice, S.rtp);
      if (!x) return fail('INVALID_CHOICE');
      if (DEMO && amount > S.balance) return fail('INSUFFICIENT_FUNDS');
      S.rolling = true;
      preBalance = S.balance;
      if (S.balance != null) S.balance = round2(Math.max(0, S.balance - amount)); // the stake shows as taken; the win waits for the reveal
      signal('roll');
      change();
      if (DEMO) {
        var dice = RULES === 'luckysix' ? [demoDie()] : [demoDie(), demoDie()];
        var o = outcome(RULES, choice, dice);
        var paid = o.won ? x : o.push ? 1 : 0;
        var win = o.won ? round2(amount * x) : o.push ? amount : 0;
        demoRound++;
        return Promise.resolve(settle(amount, choice, { round: demoRound, dice: dice, won: o.won, push: o.push, x: paid, win: win.toFixed(2), clientSeed: clientSeed || '' }, round2(preBalance - amount + win)));
      }
      return new Promise(function (resolve, reject) {
        act('roll', { token: TOKEN, amount: amount.toFixed(2), choice: choice, clientSeed: clientSeed || '' }, function (res) {
          if (!res.ok) { fail(res.error, 'Roll failed').catch(reject); return; }
          var r = res.result || {};
          resolve(settle(amount, choice, r, r.balance != null ? Number(r.balance) : null));
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
      rules: RULES,
      roll: roll,
      reveal: reveal,
      multiplier: function (choice) { return multiplierFor(RULES, choice, S.rtp); },
      limit: function () { return LIMIT; },
      limitsLoaded: limitsLoaded,
      money: function (n) { return fmt.format(n); },
      round2: round2,
      back: back,
      ready: ready,
      theme: theme,
    };
  }

  window.NXInstant = { start: start };
})();
