/* Lucky 0-9 (88.0102) — a 0–9 prize wheel drawn every 30 s, ONE draw shared by every player (engine
 * draw game "digitdrum": nexorng-engine/internal/tables/digitdrum.go; client rules: rules.js).
 *   15 s betting → 10 s draw (the wheel spins for everyone; the number is published 5.5 s into the
 *   deal and every viewer's wheel slows down onto it) → 5 s result. A winning number pays 1:9 — the
 *   stake back 9 times.
 * Chips are collected on the board and sent in ONE bet (PLACE BET, or automatically 1.5 s before
 * betting closes) — the same model as Digit Drum. Settlement and rules: ../_core/table-client.js.
 *
 * Pictures (img/, made once with an image model): the palace (bg-tall / bg-wide), the wheel face
 * without digits (disc), the gold rim with the peacock (rim), the swinging arrow (pointer), the hub,
 * the stand, a coin and the logo. Drawn here: the digits (exact, 0–9 clockwise), the spin, the fixed
 * light on the turning glass, the win glow, coins and sparkles. Sounds: CC0 recordings (sounds/). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var EVENT = '88.0102';
  var BETTING_MS = 15000, AUTO_SEND_MS = 1500;
  var TAU = Math.PI * 2;
  var N = 10, SEG = TAU / N;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
  function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function copy(o) { var c = {}; for (var k in o) if (o[k] > 0) c[k] = o[k]; return c; }
  function sum(o) { var s = 0; for (var k in o) s += o[k]; return r2(s + 1e-9); }
  function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  // ---------------------------------------------------------------- the ten jewels (as on the disc)
  var JEWELS = [
    { name: 'Ruby', c1: '#ff7a86', c2: '#d0142c', c3: '#7a0614' },
    { name: 'Sapphire', c1: '#7aa2ff', c2: '#1f4fd8', c3: '#0b2477' },
    { name: 'Emerald', c1: '#6ee69a', c2: '#11a04a', c3: '#05501f' },
    { name: 'Amethyst', c1: '#d39bff', c2: '#8e2fd0', c3: '#4a0f78' },
    { name: 'Topaz', c1: '#fff08a', c2: '#e8b414', c3: '#9a6200' },
    { name: 'Turquoise', c1: '#8ef3ff', c2: '#14b8c8', c3: '#06606e' },
    { name: 'Garnet', c1: '#e86a7a', c2: '#8a1024', c3: '#40040e' },
    { name: 'Amber', c1: '#ffc070', c2: '#f07a12', c3: '#8f3a00' },
    { name: 'Aquamarine', c1: '#dff4ff', c2: '#6cb9e8', c3: '#2a6f9c' },
    { name: 'Peridot', c1: '#e6ff8a', c2: '#8cbc16', c3: '#466605' },
  ];
  function paint3(el, i) {
    var j = JEWELS[i];
    el.style.setProperty('--c1', j.c1);
    el.style.setProperty('--c2', j.c2);
    el.style.setProperty('--c3', j.c3);
  }
  function spotOf(d) { return 'n:' + d; }
  function digitOf(spot) { return Number(String(spot).slice(2)); }
  function payOf(d) { return game ? game.pay({ pocket: d }, spotOf(d)) || 0 : 9; } // the rules' return (9 = 1:9)
  function xText(x) { return x ? '1:' + (Math.round(x * 100) / 100).toString() : '—'; }

  // ---------------------------------------------------------------- sound (CC0 recordings + a made whoosh)
  var soundOn = true;
  try { soundOn = localStorage.getItem('lucky09-sound') !== 'off'; } catch (e) { /* default on */ }
  var FILES = { tick: ['tick1', 'tick2', 'tick3'], chip: ['chiplay1', 'chiplay2'], land: ['land'], win: ['win'], bigwin: ['bigwin'],
    sparkle: ['sparkle1', 'sparkle2'], lose: ['lose'], error: ['error'], open: ['open'], closed: ['closed'] };
  var VOL = { tick: 0.35, count: 0.5, chip: 0.7, land: 0.5, win: 0.7, bigwin: 0.75, sparkle: 0.35, lose: 0.45, error: 0.5, click: 0.35, open: 0.45, closed: 0.55 };
  var AC = null, bus = null, bufs = {}, noise = null;
  function audio() {
    if (AC) return AC;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { AC = new C(); } catch (e) { return null; }
    bus = AC.createGain();
    bus.gain.value = 0.9;
    bus.connect(AC.destination);
    noise = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    Object.keys(FILES).forEach(function (k) {
      bufs[k] = [];
      FILES[k].forEach(function (n) {
        fetch('sounds/' + n + '.mp3').then(function (r) { return r.arrayBuffer(); })
          .then(function (a) { return new Promise(function (ok, no) { AC.decodeAudioData(a, ok, no); }); })
          .then(function (b) { bufs[k].push(b); }).catch(function () {});
      });
    });
    return AC;
  }
  function live() { return AC && AC.state === 'running'; }
  function shot(name, vol, rate) {
    var list = bufs[name];
    if (!list || !list.length) return;
    var s = AC.createBufferSource(), g = AC.createGain();
    s.buffer = pick(list);
    s.playbackRate.value = rate || 1;
    g.gain.value = vol;
    s.connect(g); g.connect(bus);
    s.start();
  }
  function whoosh() { // filtered noise sweeping up then away: the wheel thrown
    var t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    s.buffer = noise;
    f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(1900, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t); s.stop(t + 1);
  }
  var lastTickAt = 0;
  function play(name, arg) {
    if (!soundOn || !live()) return;
    try {
      if (name === 'whoosh') return whoosh();
      if (name === 'tick') { // the pointer flapping: quieter and less often at full speed
        var t = AC.currentTime;
        if (t - lastTickAt < 0.05) return;
        lastTickAt = t;
        return shot('tick', VOL.tick * (0.45 + 0.55 * (1 - clamp(arg || 0, 0, 1))), 0.9 + Math.random() * 0.25);
      }
      if (name === 'count') return shot('tick', VOL.count * (arg ? 1.2 : 1), arg ? 1.5 : 1.25); // the last seconds of betting
      if (name === 'click') return shot('sparkle', VOL.click, 1.6);
      shot(name, VOL[name] || 0.5);
    } catch (e) { /* audio hiccup */ }
  }
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('lucky09-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  }
  window.addEventListener('pointerdown', function () { // browsers start audio only after a tap
    if (audio() && AC.state === 'suspended') AC.resume().catch(function () {});
  }, true);

  // ---------------------------------------------------------------- phrases (random, our own)
  var PH = {
    betting: ['Place your bets', 'Pick your lucky number', 'Ten jewels — which one is yours?', 'Bets are open'],
    last: ['Last bets', 'Closing soon', 'Final call'],
    drawing: ['The wheel is spinning…', 'Round and round…', 'Watch the peacock…', 'Fortune is turning…', 'Here it comes…'],
    wait: ['Next round soon', 'Get your chips ready', 'A new draw is coming up'],
    win: ['Right on the money!', 'A royal win!', 'Lucky jewel!', 'Nicely picked!'],
    lose: ['So close — next draw soon', 'Not this time — the wheel turns again soon', 'Next round could be yours'],
  };
  var status = { key: '', text: '' };
  function setStatus(key, text) {
    if (key === status.key && !text) return;
    status.key = key;
    status.text = text || pick(PH[key] || ['']);
    $('status').dataset.kind = key;
    paintStatus();
  }
  var statusSecs = -1;
  function paintStatus() { // betting: "Place your bets · 12 s" + a bar running out; else the phrase
    var t = status.text, bar = $('statusBar');
    if ((status.key === 'betting' || status.key === 'last') && S && S.phase === 'betting') {
      var left = Math.max(0, S.endsAt - Date.now());
      t += ' · ' + Math.ceil(left / 1000) + ' s';
      bar.hidden = false;
      $('statusFill').style.transform = 'scaleX(' + Math.min(1, left / BETTING_MS).toFixed(3) + ')';
    } else bar.hidden = true;
    setText($('statusText'), t);
  }

  // ---------------------------------------------------------------- state
  var game = null, S = null;
  var chipValue = 0, chipValues = [];
  var pending = {}, stack = [], placed = null, placing = false, lastBets = null; // keys: digits 0–9
  var round = 0, closedRound = 0, autoRound = 0, revealRound = 0, landedRound = 0, wonRound = 0, lastSecs = -1;
  var landing = null, started = false, tab = 'all', lastSeed = null;
  var CHIP_COLOURS = ['#c8202e', '#1f4fc0', '#138a42', '#7a2bb8', '#c99a1c'];
  function chipLabel(v) {
    if (v >= 1000) return (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'K';
    return v % 1 ? v.toFixed(2).replace(/0$/, '') : String(v);
  }

  // ---------------------------------------------------------------- betting (chips collected, sent once)
  function bettingOpen() { return !!S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
  function locked() { return !!(placed && placed.round === round) || placing; }
  function free() { var b = S && S.balance != null ? S.balance : null; return b == null ? Infinity : r2(b - sum(pending)); }

  function addChip(d, el) {
    if (!bettingOpen()) { toast(S && (S.phase === 'dealing' || S.phase === 'betting') ? 'No more bets — wait for the next round.' : 'Wait for the next round.'); play('error'); return; }
    if (locked()) { toast('Your bets are placed for this round.'); return; }
    var lim = game.limit(), amt = chipValue, total = sum(pending);
    if (lim.max > 0 && total + amt > lim.max + 1e-9) {
      if (total >= lim.max - 1e-9) { toast('Max ' + money(lim.max) + ' per round.', 'error'); play('error'); return; }
      amt = r2(lim.max - total);
    }
    if (amt > free() + 1e-9) { toast('Not enough balance.', 'error'); play('error'); return; }
    pending[d] = r2((pending[d] || 0) + amt);
    stack.push([{ d: d, amt: amt }]);
    play('chip');
    flyChip(el);
    updateBoard(); render();
  }
  function undo() {
    if (locked() || !stack.length) return;
    stack.pop().forEach(function (e) { pending[e.d] = r2((pending[e.d] || 0) - e.amt); if (pending[e.d] <= 0.001) delete pending[e.d]; });
    play('click'); updateBoard(); render();
  }
  function clearBets() {
    if (locked() || !Object.keys(pending).length) return;
    pending = {}; stack = [];
    play('click'); updateBoard(); render();
  }
  function rebet() {
    if (locked() || !bettingOpen() || !lastBets) return;
    var add = Object.keys(lastBets).map(function (d) { return { d: +d, amt: lastBets[d] }; }), need = sum(lastBets), lim = game.limit();
    if (lim.max > 0 && sum(pending) + need > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.', 'error'); play('error'); return; }
    if (need > free() + 1e-9) { toast('Not enough balance to repeat.', 'error'); play('error'); return; }
    add.forEach(function (e) { pending[e.d] = r2((pending[e.d] || 0) + e.amt); });
    stack.push(add); play('chip'); updateBoard(); render();
  }
  function submit(auto) {
    if (locked() || !Object.keys(pending).length) return;
    if (!bettingOpen() && !auto) return;
    var lim = game.limit(), total = sum(pending);
    if (lim.min > 0 && total < lim.min - 1e-9) { toast('Minimum ' + money(lim.min) + ' per round.', 'error'); play('error'); return; }
    var r = round, snap = copy(pending);
    var bets = Object.keys(snap).sort().map(function (d) { return { spot: spotOf(+d), amount: snap[d] }; });
    placing = true; updateBoard();
    game.bet(bets).then(function (res) {
      placing = false;
      placed = { round: r, bets: snap, total: sum(snap), maxWin: res && res.maxWin != null ? Number(res.maxWin) : null };
      safeSS('lucky09:placed', placed);
      lastBets = snap; pending = {}; stack = [];
      play('sparkle');
      setStatus('betting', auto ? 'Your chips are in — good luck!' : 'Bets accepted — good luck!');
      updateBoard(); render();
    }).catch(function () { placing = false; updateBoard(); render(); });
  }

  function flyChip(numEl) { // a chip flies from the chip row to the number
    var src = document.querySelector('.chip-btn[aria-checked="true"] .cchip');
    if (!src || !numEl || !numEl.animate) return;
    var a = src.getBoundingClientRect(), b = numEl.getBoundingClientRect();
    var el = src.cloneNode(true);
    el.classList.add('fly');
    el.style.left = a.left + 'px'; el.style.top = a.top + 'px';
    el.style.width = a.width + 'px'; el.style.height = a.height + 'px';
    document.body.appendChild(el);
    var dx = b.right - 16 - a.left - a.width / 2, dy = b.top + 14 - a.top - a.height / 2;
    var anim = el.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: 'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - 40) + 'px) scale(0.85)', opacity: 1, offset: 0.5 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.45)', opacity: 0.2 },
    ], { duration: 320, easing: 'cubic-bezier(.3,.7,.4,1)' });
    anim.onfinish = function () { el.remove(); };
  }

  // ---- the number board (built once: two rows of five) ----
  var nums = [];
  (function buildBoard() {
    var board = $('board');
    for (var i = 0; i < N; i++) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'num';
      el.innerHTML = '<span class="num__d"></span><span class="num__x"></span><span class="num__bet" hidden></span>';
      el.querySelector('.num__d').textContent = String(i);
      paint3(el, i);
      el.onclick = (function (k, e) { return function () { addChip(k, e); }; })(i, el);
      board.appendChild(el);
      nums.push({ el: el, x: el.querySelector('.num__x'), bet: el.querySelector('.num__bet') });
    }
  })();

  function shownBets() { return placed && placed.round === round ? placed.bets : pending; }
  function possibleWin() { // only one number can hit: the best case is the biggest bet on one number
    var b = shownBets(), best = 0;
    for (var d in b) best = Math.max(best, r2(b[d] * payOf(+d) + 1e-9));
    if (placed && placed.round === round && placed.maxWin > 0) best = Math.min(best, placed.maxWin);
    return best;
  }
  function updateBoard() {
    if (!S) return;
    var open = bettingOpen(), lock = locked(), b = shownBets(), isPlaced = !!(placed && placed.round === round);
    var n = Object.keys(pending).length, total = sum(pending);
    nums.forEach(function (t, i) {
      var a = b[i] || 0, x = payOf(i);
      setText(t.x, xText(x));
      t.bet.hidden = !a;
      if (a) setText(t.bet, chipLabel(a));
      t.bet.classList.toggle('num__bet--pending', a > 0 && !isPlaced);
      t.el.setAttribute('aria-label', 'Number ' + i + ', pays ' + xText(x) + (a ? ', your bet ' + money(a) : ''));
    });
    setText($('stake'), money(sum(b)));
    setText($('maxwin'), money(possibleWin()));
    setText($('roundNo'), S.round ? 'Round #' + S.round : '');
    $('undo').disabled = !open || lock || !stack.length;
    $('clear').disabled = !open || lock || !n;
    $('rebet').disabled = !open || lock || !lastBets;
    var btn = $('action'), label, sub = '', cls = 'place';
    if (placing) { btn.disabled = true; label = 'Placing…'; sub = money(total); }
    else if (isPlaced) {
      btn.disabled = true;
      if (wonRound === round && landedRound === round) { cls += ' place--won'; label = 'You won ' + money(placed.win || 0); sub = 'next round soon'; }
      else if (landedRound === round) { cls += ' place--busy'; label = 'No win this round'; sub = money(placed.total) + ' · next round soon'; }
      else { cls += ' place--done'; label = 'Bet placed'; sub = money(placed.total) + (open ? ' · good luck!' : ' · drawing now'); }
    } else if (open && n) { btn.disabled = false; label = 'Place bet'; sub = money(total) + ' · auto-sent before the draw'; }
    else if (open) { btn.disabled = true; label = 'Place bet'; sub = 'Tap a number first'; }
    else { btn.disabled = true; cls += ' place--busy'; label = S.phase === 'betting' || S.phase === 'dealing' ? 'No more bets' : 'Next round soon'; }
    if (btn.className !== cls) btn.className = cls;
    setText($('placeLabel'), label); setText($('placeSub'), sub);
    $('board').classList.toggle('board--closed', !open || lock);
  }

  // ---- chips (1/5/10/50/100 × the min bet, within the max) ----
  var chipBtns = [], chipsKey = '';
  function buildChips(l) {
    var values = [1, 5, 10, 50, 100].map(function (k) { return r2(l.min * k + 1e-9); }).filter(function (v) { return !l.max || v <= l.max; });
    if (values.join() === chipsKey) return;
    chipsKey = values.join();
    chipValues = values;
    var box = $('chips');
    chipBtns.forEach(function (b) { b.el.remove(); });
    chipBtns = chipValues.map(function (v, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', 'Chip ' + money(v));
      var c = document.createElement('span');
      c.className = 'cchip';
      c.style.setProperty('--cc', CHIP_COLOURS[i]);
      var t = document.createElement('b');
      t.textContent = chipLabel(v);
      c.appendChild(t);
      b.appendChild(c);
      b.onclick = function () { selectChip(v); play('click'); };
      box.appendChild(b);
      return { el: b, v: v };
    });
    selectChip(chipValues[0]); // the min bet is preselected
  }
  function selectChip(v) {
    chipValue = v;
    chipBtns.forEach(function (b) { b.el.setAttribute('aria-checked', String(b.v === v)); });
  }

  // ---------------------------------------------------------------- the wheel's moves
  // rest: still (on the last result) · accel / free: spinning · decel: slowing onto a number ·
  // stopped: on the drawn number, its jewel glowing.
  var wheel = { angle: 0, vel: 0, mode: 'rest', t0: 0, v0: 0, from: 0, dist: 0, dur: 0, digit: -1, flap: 0, flapV: 0, done: null };
  var OMEGA = 9.5 / 1000; // full speed, rad per ms (about 1.5 turns a second)
  function spinning() { return wheel.mode === 'accel' || wheel.mode === 'free' || wheel.mode === 'decel'; }
  function spinUp(instant) { // the draw starts: thrown (or, joining mid-draw, already at full speed)
    if (spinning()) return;
    hideResult();
    wheel.mode = instant ? 'free' : 'accel';
    wheel.t0 = performance.now();
    wheel.v0 = wheel.vel;
    if (instant) wheel.vel = OMEGA;
    wheel.digit = -1;
    if (!instant) play('whoosh');
  }
  // Slow down onto a number: a cubic ease-out whose start speed is the spin's, about D0 ms long (±0.8 s:
  // the remaining part of a turn is added or taken off), resting on a random spot inside its jewel.
  function landOn(digit, D0, done) {
    if (wheel.mode !== 'free' && wheel.mode !== 'accel') spinUp(true);
    wheel.vel = Math.max(wheel.vel, OMEGA * 0.8);
    var jitter = (Math.random() - 0.5) * 0.56;
    var target = -(digit + jitter) * SEG; // segment i is centred at i·36° clockwise from the top
    var d0 = wheel.vel * D0 / 3;
    var delta = (((target - (wheel.angle + d0)) % TAU) + TAU) % TAU;
    if (delta > Math.PI) delta -= TAU;
    wheel.from = wheel.angle;
    wheel.dist = d0 + delta;
    wheel.dur = 3 * wheel.dist / wheel.vel;
    wheel.t0 = performance.now();
    wheel.mode = 'decel';
    wheel.digit = digit;
    wheel.done = done;
  }
  function restOn(digit) { // no motion: the wheel simply shows this number under the peacock
    wheel.mode = 'rest';
    wheel.vel = 0;
    wheel.digit = -1;
    wheel.angle = -digit * SEG;
  }

  // ---------------------------------------------------------------- round flow
  function onSignal(type, d) {
    if (!started) return;
    d = d || {};
    if (type === 'betting') onBetting();
    else if (type === 'deal') onDeal(d.step);
    else if (type === 'result') onResult(d);
    else if (type === 'error') { play('error'); toast(d.text || 'Something went wrong.', 'error'); }
  }
  function onBetting() {
    round = S.round; lastSecs = -1; landing = null;
    if (placed && placed.round !== round) placed = null;
    pending = {}; stack = [];
    hideResult();
    if (wheel.mode === 'stopped') wheel.mode = 'rest';
    $('closed').hidden = true;
    setStatus('betting');
    play('open');
    updateBoard(); render();
  }
  function closeRound() {
    closedRound = round;
    setStatus('drawing');
    play('closed');
    if (!placing && Object.keys(pending).length) { pending = {}; stack = []; } // chips never placed go back
    var c = $('closed');
    c.hidden = false; c.classList.remove('closed--in'); void c.offsetWidth; c.classList.add('closed--in');
    setTimeout(function () { if (closedRound === round) c.hidden = true; }, 1700);
    spinUp(false);
    updateBoard(); render();
  }
  function onDeal(step) {
    if (!step || step.kind !== 'pocket' || step.value == null) return;
    if (closedRound !== step.round) closeRound();
    revealRound = step.round;
    startLanding(step.round, step.value, 2900);
  }
  function startLanding(r, digit, ms) {
    if (landing && landing.round === r) return;
    landing = { round: r, digit: digit };
    landOn(digit, ms, function () { landed(r, digit); });
  }
  function myWin(digit) {
    if (!placed || placed.round !== round) return null;
    var w = r2((placed.bets[digit] || 0) * payOf(digit));
    if (placed.maxWin > 0 && w > placed.maxWin) w = placed.maxWin;
    return w;
  }
  var hitAt = 0;
  function landed(r, digit) {
    if (r !== round) return;
    landedRound = r;
    wheel.mode = 'stopped';
    hitAt = performance.now();
    play('land');
    var m = $('medal');
    paint3(m, digit);
    $('mBall').textContent = String(digit);
    m.hidden = false;
    var t = nums[digit];
    if (t) { t.el.classList.remove('num--hit'); void t.el.offsetWidth; t.el.classList.add('num--hit'); }
    nums.forEach(function (o, k) { o.el.classList.toggle('num--dim', k !== digit); });
    var w = myWin(digit), wl = $('winline');
    if (w != null) {
      placed.win = w;
      if (w > 0) {
        wonRound = r;
        wl.textContent = '+' + money(w);
        wl.hidden = false;
        var big = w >= placed.total * 4.5 - 1e-9; // most of the stake was on the winning number
        coinBurst(big ? 70 : 40);
        setTimeout(function () { play(big ? 'bigwin' : 'win'); }, 150);
        setTimeout(function () { play('sparkle'); }, 600);
        setStatus('win', 'Number ' + digit + ' wins — ' + pick(PH.win));
        var bal = $('balance'); bal.classList.remove('bump'); void bal.offsetWidth; bal.classList.add('bump');
      } else { setStatus('lose', 'Number ' + digit + ' wins. ' + pick(PH.lose)); setTimeout(function () { play('lose'); }, 250); }
    } else setStatus('result', 'Number ' + digit + ' wins!');
    updateBoard(); render();
  }
  function hideResult() {
    $('medal').hidden = true;
    $('winline').hidden = true;
    nums.forEach(function (o) { o.el.classList.remove('num--dim', 'num--hit'); });
  }
  function onResult(d) {
    if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, digit: d.outcome && d.outcome.pocket };
    if (placed && placed.round === S.round) {
      if (placed.restored) setTimeout(refreshBalance, 800); // reloaded mid-round: the client has no record of this bet
      safeSS('lucky09:placed', null);
      var my = S.myBets[0];
      if (my && my.round === S.round) placed.win = my.win; // the client's settlement (capped like the engine)
    }
    var digit = d.outcome && d.outcome.pocket;
    if (landedRound !== S.round && digit != null) {
      round = S.round;
      if (landing && landing.round === S.round) { /* still slowing down: landed() follows */ }
      else if (spinning()) { revealRound = S.round; startLanding(S.round, digit, 1400); } // the number step was missed: slow down onto the result
      else { restOn(digit); landing = { round: S.round, digit: digit }; landed(S.round, digit); } // the draw was missed (tab hidden): show it now
    }
    render();
  }
  function refreshBalance() {
    var tok = null;
    try { tok = localStorage.getItem('token'); } catch (e) { /* none */ }
    if (!tok || tok === 'demo' || !game) return;
    fetch(game.apiUrl('/playerBalance'), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } })
      .then(function (r) { return r.json(); }).then(function (p) { var b = p && p.data && p.data.balance; if (b != null) { S.balance = Number(b); render(); } }).catch(function () {});
  }

  // First snapshot: put the wheel in the state the round is in (a player who opens the page mid-draw
  // sees it already turning and landing on the same number as everyone else).
  function syncFromSnapshot() {
    started = true;
    round = S.round;
    var last = S.history[0];
    var stored = safeSS('lucky09:placed');
    if (stored && stored.round === S.round && (S.phase === 'betting' || S.phase === 'dealing')) { placed = stored; placed.restored = true; }
    if (S.phase === 'dealing') {
      closedRound = round;
      setStatus('drawing');
      if (last && last.round !== round) restOn(last.outcome.pocket);
      spinUp(true);
      var step = (S.deals || []).filter(function (x) { return x.kind === 'pocket' && x.value != null; }).pop();
      if (step) { revealRound = round; startLanding(round, step.value, 2200); }
    } else if (S.phase === 'betting') {
      if (last) restOn(last.outcome.pocket);
      setStatus('betting');
      if (Date.now() >= S.endsAt) closeRound();
    } else {
      var dg = S.result && S.result.pocket != null ? S.result.pocket : last && last.outcome.pocket;
      if (dg != null) restOn(dg);
      landedRound = S.round;
      setStatus('wait');
    }
    updateBoard(); render();
  }

  // ---------------------------------------------------------------- round clock: countdown, auto-send, close
  var pauseAt = 0, phaseSeen = '';
  function tickRound() {
    if (!S || !started) return;
    var now = Date.now();
    if (S.phase === 'betting') {
      var left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000);
      if (left > 0) {
        if (secs !== lastSecs) {
          if (secs <= 5 && lastSecs !== -1) play('count', secs <= 2);
          if (secs <= 4 && status.key === 'betting' && !locked()) setStatus('last');
          lastSecs = secs; updateBoard();
        }
        if (left <= AUTO_SEND_MS && autoRound !== round && Object.keys(pending).length && !locked()) { autoRound = round; submit(true); }
      } else if (closedRound !== round && round) closeRound();
    }
    if (S.phase !== phaseSeen) { phaseSeen = S.phase; if (S.phase === 'pause') pauseAt = now; }
    if (S.phase === 'pause' && (status.key === 'result' || status.key === 'win' || status.key === 'lose') && now - pauseAt > 2600) setStatus('wait');
    if (statusSecs !== Math.ceil((S.endsAt - now) / 250)) { statusSecs = Math.ceil((S.endsAt - now) / 250); paintStatus(); }
  }

  // ---------------------------------------------------------------- DOM render (on every client change)
  var toastTimer;
  function toast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  var strip = null;
  function render() {
    if (!S) return;
    maybeReady();
    $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
    var bal = S.balance;
    if (bal != null && Object.keys(pending).length && !placing) bal = r2(bal - sum(pending)); // chips on the board, not sent yet
    setText($('balance'), bal == null ? '—' : money(bal));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');
    setText($('fRound'), S.round ? String(S.round) : '—');
    setText($('fHash'), S.hash || '—');
    setText($('fSeed'), lastSeed && lastSeed.round === landedRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the round' : '—'));
    renderHistory();
    renderList();
    updateBoard();
    if (!strip && window.NXPlayers && !WIDE.matches) strip = window.NXPlayers.create($('stage'), { face: function (name) { return NXPlayers.face(name, 'av', 'span'); } });
    if (strip) strip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map(function (b) { return { player: String(b.player || 'Player'), x: 0 }; }) });
  }
  var WIDE = window.matchMedia('(min-width: 900px)');

  function ball(i, small) {
    var s = document.createElement('i');
    s.className = 'ball' + (small ? ' ball--sm' : '');
    if (i >= 0 && i < N) { paint3(s, i); s.textContent = String(i); }
    return s;
  }
  // the shared history, without the round still being drawn on this screen
  function visibleHistory() { return (S.history || []).filter(function (h) { return h.outcome && h.outcome.pocket != null && !(h.round === revealRound && landedRound < revealRound); }); }
  var histSig = '';
  function renderHistory() {
    var h = visibleHistory().slice(0, 30), sig = h.map(function (x) { return x.round; }).join(',');
    if (sig === histSig) return;
    var fresh = histSig !== '' && h.length;
    histSig = sig;
    var box = $('history');
    box.innerHTML = '';
    if (!h.length) {
      var e = document.createElement('span');
      e.className = 'history__empty';
      e.textContent = 'Last results show here';
      box.appendChild(e);
      return;
    }
    h.forEach(function (x, k) {
      var d = ball(x.outcome.pocket);
      d.title = 'Round ' + x.round;
      if (k === 0 && fresh) d.classList.add('ball--new');
      box.appendChild(d);
    });
  }

  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }
  function numbersOf(bets) { return (bets || []).map(function (b) { return digitOf(b.spot); }).sort(function (a, b) { return a - b; }).join(' · ') || '—'; }
  var listSig = '';
  function renderList() {
    var rows = [], heads, count;
    if (tab === 'all') {
      var all = (S.bets || []).slice().reverse();
      heads = ['Player', 'Numbers', 'Bet', 'Win'];
      count = all.length;
      rows = all.slice(0, 40).map(function (b) {
        var showWin = b.win != null && landedRound >= S.round;
        return { mine: !!b.mine, won: showWin && b.win > 0, user: String(b.player || 'Player'), nums: numbersOf(b.bets), stake: money(Number(b.total) || 0), win: showWin ? (b.win > 0 ? money(b.win) : '—') : '' };
      });
    } else {
      var mine = (S.myBets || []).filter(function (m) { return !(m.round === revealRound && landedRound < revealRound); });
      heads = ['Round', 'Numbers', 'Bet', 'Win'];
      count = mine.length;
      rows = mine.map(function (m) { return { won: m.win > 0, round: m.round, res: m.outcome ? m.outcome.pocket : -1, nums: numbersOf(m.bets), stake: money(m.stake), win: m.win > 0 ? money(m.win) : '—' }; });
    }
    var sig = tab + '|' + JSON.stringify(rows);
    if (sig === listSig) return;
    listSig = sig;
    var cols = $('cols');
    cols.innerHTML = '';
    heads.forEach(function (h) { cols.appendChild(cell(h)); });
    setText($('countLabel'), tab === 'all' ? 'Bets this round' : 'My rounds');
    setText($('betCount'), String(count));
    var list = $('list');
    list.innerHTML = '';
    if (!rows.length) list.appendChild(cell(tab === 'all' ? 'No bets yet this round' : 'Your rounds will show here', 'empty'));
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'row' + (r.won ? ' row--won' : '') + (r.mine ? ' row--mine' : '');
      if (tab === 'all') {
        var user = document.createElement('span');
        user.className = 'row__user';
        if (window.NXPlayers) user.appendChild(NXPlayers.face(r.user, 'av', 'span'));
        user.appendChild(cell(r.user));
        row.appendChild(user);
      } else {
        var rc = cell('#' + r.round + ' ', 'row__round');
        if (r.res >= 0) rc.appendChild(ball(r.res, true));
        row.appendChild(rc);
      }
      row.appendChild(cell(r.nums, 'row__nums'));
      row.appendChild(cell(r.stake));
      row.appendChild(cell(r.win, 'row__win'));
      list.appendChild(row);
    });
  }

  function hexBytes(hex) { var o = new Uint8Array(hex.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(hex.substr(i * 2, 2), 16); return o; }
  function verifyLast() {
    var out = $('fCheck'); out.hidden = false;
    if (!lastSeed || !lastSeed.seed) { out.textContent = 'Wait for a round to finish while you are at the table — its seed is revealed then.'; return; }
    out.textContent = 'Checking…';
    var L = lastSeed;
    Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: 'digitdrum', gameId: game.event, seed: L.seed, round: L.round })]).then(function (res) {
      var h = Array.prototype.map.call(new Uint8Array(res[0]), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      var d = res[1].outcome.pocket;
      out.textContent = 'Round ' + L.round + ': number ' + d + '. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (L.digit == null || d === L.digit ? '✓ same number as drawn' : '✗ number differs');
    }).catch(function () { out.textContent = 'Could not recompute in this browser.'; });
  }

  // ---------------------------------------------------------------- ready
  var announced = false;
  function maybeReady() {
    if (announced || !art.ready || !S || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 6000); // never hang the loader


  // ---------------------------------------------------------------- pictures
  var art = { ready: false };
  var ART = ['bg-tall', 'bg-wide', 'disc', 'rim', 'pointer', 'hub', 'stand', 'coin'];
  (function loadArt() {
    var left = ART.length;
    ART.forEach(function (n) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = im.onerror = function () {
        if (im.naturalWidth) art[n] = im;
        if (--left === 0) { art.ready = true; layoutKey = ''; fit(); maybeReady(); }
      };
      im.src = 'img/' + n + '.webp';
    });
  })();
  if (document.fonts && document.fonts.load) { // the digits are drawn in Cinzel: redraw the face once it is in
    document.fonts.load('900 64px Cinzel').then(function () { faceKey = ''; }).catch(function () {});
  }

  // Rim picture geometry (fractions of its square): centre, the disc under it, the arrow's hinge.
  var RIM = { cx: 0.4995, cy: 0.498, disc: 0.334, hub: 0.07, pivotY: 180.5 / 1024, pw: 61 / 1024, ph: 118 / 1024 * 0.6 };

  // ---------------------------------------------------------------- scene (canvas)
  var canvas = $('scene'), ctx = canvas.getContext('2d');
  var stageEl = document.querySelector('.stage');
  var FULL_W = 0, FULL_H = 0, LEFT = 0, TOP = 0, W = 0, H = 0, DPR = 1;
  var SZ = 300, CX = 0, CY = 0, DR = 100; // rim picture size, wheel centre, disc radius (play-area px)
  var back = document.createElement('canvas'), bctx = back.getContext('2d'); // palace + stand (pre-drawn)
  var face = document.createElement('canvas'), fctx = face.getContext('2d'); // disc + digits (turns)
  var layoutKey = '', faceKey = '';

  function fit() {
    var r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var wide = window.matchMedia('(min-width: 900px)').matches;
    var side = document.querySelector('.side').getBoundingClientRect();
    var left = wide && side.right > r.left && side.left < r.left + r.width / 2 ? Math.max(0, side.right - r.left + 8) : 0;
    var bar = document.querySelector('.top').getBoundingClientRect();
    var top = Math.max(0, bar.bottom - r.top + 4);
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 4 : r.height;
    var key = [r.width, r.height, DPR, left, top, playBottom, art.ready].join('|');
    if (key === layoutKey) return; // nothing moved: keep the canvas (setting a size clears it)
    layoutKey = key;
    FULL_W = r.width; FULL_H = r.height; LEFT = left; TOP = top;
    W = FULL_W - LEFT;
    H = Math.max(160, playBottom - TOP);
    stageEl.style.setProperty('--left', LEFT + 'px');
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // the wheel: as big as the play area allows (the peacock on top, the stand may go behind the results)
    SZ = Math.max(150, Math.min(W / 0.97, (H - 4) / 0.985));
    CX = W / 2;
    var group = 1.2 * SZ; // peacock top → stand foot: centred when the play area has room for it all
    CY = 0.503 * SZ + 2 + Math.max(0, (H - group) / 2);
    DR = RIM.disc * SZ;
    var c = $('center').style;
    c.left = LEFT + 'px'; c.top = TOP + 'px'; c.width = W + 'px'; c.height = H + 'px';
    c.setProperty('--wx', CX + 'px');
    c.setProperty('--wy', CY + 'px');
    c.setProperty('--mw', Math.round(DR * 0.64) + 'px');
    c.setProperty('--winy', (CY + DR * 0.36) + 'px');
    c.setProperty('--statusy', Math.min(H - 30, CY + SZ * 0.47 - 6) + 'px');
    var bufW = Math.round(FULL_W * DPR), bufH = Math.round(FULL_H * DPR);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    if (back.width !== bufW || back.height !== bufH) { back.width = bufW; back.height = bufH; }
    drawBack();
    paint(performance.now(), 0); // a resize clears the canvas: draw again at once (no blank frame)
  }

  // The palace (cover, its arch behind the wheel) + the wheel's shadow and stand: drawn once per layout.
  function drawBack() {
    var c = bctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, back.width, back.height);
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.fillStyle = '#efe2c9';
    c.fillRect(0, 0, FULL_W, FULL_H);
    var im = FULL_W / FULL_H > 1.05 ? art['bg-wide'] : art['bg-tall'];
    if (im) {
      var k = Math.max(FULL_W / im.naturalWidth, FULL_H / im.naturalHeight);
      var w = im.naturalWidth * k, h = im.naturalHeight * k;
      var ax = im === art['bg-wide'] ? 0.5 : 0.5, ay = im === art['bg-wide'] ? 0.5 : 0.36; // the arch's centre
      var x = clamp(LEFT + CX - ax * w, FULL_W - w, 0), y = clamp(TOP + CY - ay * h, FULL_H - h, 0);
      c.drawImage(im, x, y, w, h);
    }
    c.translate(LEFT, TOP);
    // soft daylight pooled behind the wheel
    var glow = c.createRadialGradient(CX, CY, SZ * 0.2, CX, CY, SZ * 0.85);
    glow.addColorStop(0, 'rgba(255,246,220,0.55)');
    glow.addColorStop(1, 'rgba(255,246,220,0)');
    c.fillStyle = glow;
    c.fillRect(CX - SZ, CY - SZ, SZ * 2, SZ * 2);
    // the stand (behind the wheel) and its shadow on the marble floor
    var st = art.stand;
    if (st) {
      var sw = SZ * 0.9, sh = sw * st.naturalHeight / st.naturalWidth, sy = CY + SZ * 0.13; // the cradle's inner curve hides behind the rim
      var fl = c.createRadialGradient(CX, sy + sh * 0.97, 0, CX, sy + sh * 0.97, sw * 0.6);
      fl.addColorStop(0, 'rgba(80,45,10,0.35)');
      fl.addColorStop(1, 'rgba(80,45,10,0)');
      c.save();
      c.translate(CX, sy + sh * 0.97);
      c.scale(1, 0.18);
      c.translate(-CX, -(sy + sh * 0.97));
      c.fillStyle = fl;
      c.fillRect(CX - sw, sy + sh * 0.97 - sw, sw * 2, sw * 2);
      c.restore();
      c.drawImage(st, CX - sw / 2, sy, sw, sh);
    }
    // the wheel's own shadow on the palace behind it (light from the upper left)
    var ds = c.createRadialGradient(CX + SZ * 0.03, CY + SZ * 0.045, SZ * 0.4, CX + SZ * 0.03, CY + SZ * 0.045, SZ * 0.53);
    ds.addColorStop(0, 'rgba(70,35,5,0.42)');
    ds.addColorStop(1, 'rgba(70,35,5,0)');
    c.fillStyle = ds;
    c.beginPath(); c.arc(CX + SZ * 0.03, CY + SZ * 0.045, SZ * 0.53, 0, TAU); c.fill();
  }

  // The turning face: the jewel disc with the ten digits in gold, 0–9 clockwise, 0 at the top at rest.
  function drawFace() {
    var px = Math.round(DR * 2 * DPR), key = px + '|' + (document.fonts && document.fonts.check ? document.fonts.check('900 20px Cinzel') : '');
    if (key === faceKey || !art.disc) return;
    faceKey = key;
    if (face.width !== px) { face.width = px; face.height = px; }
    var c = fctx, R = px / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, px, px);
    c.save();
    c.beginPath(); c.arc(R, R, R, 0, TAU); c.clip();
    c.drawImage(art.disc, 0, 0, px, px);
    c.restore();
    var fs = R * 0.31;
    c.font = '900 ' + fs + 'px Cinzel, "Trajan Pro", "Times New Roman", serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (var i = 0; i < N; i++) {
      c.save();
      c.translate(R, R);
      c.rotate(i * SEG);
      c.translate(0, -R * 0.635);
      var d = String(i), y = fs * 0.04;
      // cast shadow on the glass
      c.save();
      c.shadowColor = 'rgba(30,10,0,0.65)';
      c.shadowBlur = fs * 0.12;
      c.shadowOffsetY = fs * 0.06;
      c.fillStyle = '#3a1d00';
      c.fillText(d, 0, y);
      c.restore();
      // dark bevel edge, then the gold face
      c.lineJoin = 'round';
      c.lineWidth = fs * 0.11;
      c.strokeStyle = '#4a2600';
      c.strokeText(d, 0, y);
      c.lineWidth = fs * 0.05;
      c.strokeStyle = '#a8701c';
      c.strokeText(d, 0, y);
      var g = c.createLinearGradient(0, y - fs * 0.45, 0, y + fs * 0.45);
      g.addColorStop(0, '#fffbe2');
      g.addColorStop(0.35, '#ffe08c');
      g.addColorStop(0.55, '#e4a63a');
      g.addColorStop(0.75, '#ffd977');
      g.addColorStop(1, '#fff0bb');
      c.fillStyle = g;
      c.fillText(d, 0, y);
      c.restore();
    }
  }


  // ---------------------------------------------------------------- effects
  var coins = [], sparks = [], motes = [];
  for (var mi = 0; mi < 18; mi++) motes.push({ x: Math.random(), y: Math.random(), v: 0.006 + Math.random() * 0.012, s: 0.6 + Math.random() * 1.6, ph: Math.random() * TAU });
  function coinBurst(n) {
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 0.35 + Math.random() * 0.55;
      coins.push({ x: CX, y: CY, vx: Math.cos(a) * v * SZ / 1000 * 1.6, vy: Math.sin(a) * v * SZ / 1000 * 2.2 - 0.05,
        s: SZ * (0.045 + Math.random() * 0.035), ph: Math.random() * TAU, w: 0.006 + Math.random() * 0.01, t: -i * 12 });
    }
    for (var j = 0; j < 26; j++) sparks.push({ a: Math.random() * TAU, r: DR * (0.2 + Math.random() * 1.2), t: -j * 40, life: 700 + Math.random() * 500, s: SZ * (0.02 + Math.random() * 0.03) });
  }
  function star(c, x, y, s, alpha) {
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    var g = c.createRadialGradient(0, 0, 0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.25, 'rgba(255,230,150,0.8)');
    g.addColorStop(1, 'rgba(255,210,100,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, -s); c.quadraticCurveTo(0, 0, s, 0); c.quadraticCurveTo(0, 0, 0, s);
    c.quadraticCurveTo(0, 0, -s, 0); c.quadraticCurveTo(0, 0, 0, -s);
    c.fill();
    c.restore();
  }
  var glints = [];
  function stepGlints(now) { // little flashes on the rim's gems
    if (glints.length < 3 && Math.random() < 0.02) glints.push({ a: Math.random() * TAU, t: now, life: 700 + Math.random() * 500 });
    glints = glints.filter(function (g) { return now - g.t < g.life; });
  }

  // ---------------------------------------------------------------- the frame
  var lastT = 0;
  function frame(now) {
    var dt = lastT ? Math.min(60, now - lastT) : 16;
    lastT = now;
    stepWheel(now, dt);
    paint(now, dt);
    if (!S || !S.gotSnapshot) setText($('statusText'), 'Connecting…');
    requestAnimationFrame(frame);
  }

  function stepWheel(now, dt) {
    var w = wheel;
    if (w.mode === 'rest' || w.mode === 'stopped') {
      w.vel = 0;
    } else if (w.mode === 'accel') { // a fast start
      var k = clamp((now - w.t0) / 600, 0, 1);
      w.vel = w.v0 + (OMEGA - w.v0) * (1 - Math.pow(1 - k, 2));
      if (k >= 1) w.mode = 'free';
    } else if (w.mode === 'free') {
      w.vel = OMEGA;
    }
    var prev = w.angle;
    if (w.mode === 'decel') { // the long ease-out onto the published number
      var u = clamp((now - w.t0) / w.dur, 0, 1), e = 1 - Math.pow(1 - u, 3);
      w.angle = w.from + w.dist * e;
      w.vel = 3 * w.dist / w.dur * Math.pow(1 - u, 2);
      if (u >= 1) {
        w.angle = w.from + w.dist;
        w.vel = 0;
        w.mode = 'stopped';
        var done = w.done;
        w.done = null;
        if (done) done();
      }
    } else {
      w.angle += w.vel * dt;
    }
    if (w.angle > TAU * 1000) { w.angle -= TAU * 1000; prev -= TAU * 1000; w.from -= TAU * 1000; }
    // the peacock's arrow: kicked by every spoke that passes, springs back
    var p0 = Math.floor(prev / SEG + 0.5), p1 = Math.floor(w.angle / SEG + 0.5);
    if (p1 !== p0) {
      w.flap = Math.min(0.5, w.flap + 0.3);
      w.flapV = 0;
      if (w.vel > 0.0004) play('tick', w.vel / OMEGA);
    }
    var acc = -0.00011 * w.flap - 0.013 * w.flapV;
    w.flapV += acc * dt;
    w.flap = clamp(w.flap + w.flapV * dt, -0.12, 0.55);
  }

  function paint(now, dt) {
    var c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (!back.width) return;
    c.drawImage(back, 0, 0);
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    // drifting golden motes in the sunlight
    c.save();
    motes.forEach(function (m) {
      m.y -= m.v * dt / 1000;
      if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      var x = m.x * FULL_W + Math.sin(now / 2400 + m.ph) * 14, y = m.y * FULL_H;
      c.globalAlpha = 0.35 + 0.3 * Math.sin(now / 900 + m.ph);
      c.fillStyle = '#fff3c0';
      c.beginPath(); c.arc(x, y, m.s, 0, TAU); c.fill();
    });
    c.restore();
    c.translate(LEFT, TOP);
    if (art.ready) drawWheel(now, dt);
    drawCoins(c, now, dt);
  }

  function drawWheel(now, dt) {
    var c = ctx;
    drawFace();
    var rx = CX - RIM.cx * SZ, ry = CY - RIM.cy * SZ;
    // the turning face (a light trail when fast)
    var size = DR * 2, trail = wheel.vel > OMEGA * 0.4 ? 2 : 0;
    for (var t = trail; t >= 0; t--) {
      c.save();
      c.translate(CX, CY);
      c.rotate(wheel.angle - t * wheel.vel * 10);
      c.globalAlpha = t ? 0.3 : 1;
      if (face.width) c.drawImage(face, -size / 2, -size / 2, size, size);
      c.restore();
    }
    // fixed light on the glass: it does not turn with the wheel (that is what makes it look solid)
    c.save();
    c.beginPath(); c.arc(CX, CY, DR, 0, TAU); c.clip();
    var sh = c.createRadialGradient(CX, CY, DR * 0.72, CX, CY, DR * 1.02); // sunk into the rim
    sh.addColorStop(0, 'rgba(40,15,0,0)');
    sh.addColorStop(1, 'rgba(40,15,0,0.42)');
    c.fillStyle = sh;
    c.fillRect(CX - DR, CY - DR, DR * 2, DR * 2);
    var sp = c.createRadialGradient(CX - DR * 0.38, CY - DR * 0.5, 0, CX - DR * 0.38, CY - DR * 0.5, DR * 0.95);
    sp.addColorStop(0, 'rgba(255,255,255,0.26)');
    sp.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sp;
    c.fillRect(CX - DR, CY - DR, DR * 2, DR * 2);
    var lo = c.createLinearGradient(0, CY - DR, 0, CY + DR); // a little darker at the bottom
    lo.addColorStop(0.55, 'rgba(30,10,0,0)');
    lo.addColorStop(1, 'rgba(30,10,0,0.18)');
    c.fillStyle = lo;
    c.fillRect(CX - DR, CY - DR, DR * 2, DR * 2);
    // the result: the other jewels dim, the winning one glows
    if (wheel.mode === 'stopped' && wheel.digit >= 0) {
      var pulse = 0.5 + 0.5 * Math.sin((now - hitAt) / 210), fadeIn = clamp((now - hitAt) / 400, 0, 1);
      var a0 = -Math.PI / 2 + (wheel.digit - 0.5) * SEG + wheel.angle, a1 = a0 + SEG, RH = DR * 0.16;
      c.beginPath();
      c.arc(CX, CY, DR, a1, a0 + TAU);
      c.arc(CX, CY, RH, a0 + TAU, a1, true);
      c.closePath();
      c.fillStyle = 'rgba(30,10,0,' + (0.38 * fadeIn) + ')';
      c.fill();
      c.beginPath();
      c.arc(CX, CY, DR * 0.985, a0, a1);
      c.arc(CX, CY, RH, a1, a0, true);
      c.closePath();
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgba(255,240,190,' + ((0.1 + 0.16 * pulse) * fadeIn) + ')';
      c.fill();
      c.restore();
      c.lineWidth = Math.max(2, DR * 0.03);
      c.strokeStyle = 'rgba(255,244,190,' + fadeIn + ')';
      c.shadowColor = '#ffd75a';
      c.shadowBlur = DR * (0.08 + 0.1 * pulse);
      c.stroke();
      c.shadowBlur = 0;
    }
    c.restore();
    // the hub (still), the rim and the peacock
    if (art.hub) {
      var hs = SZ * RIM.hub * 2;
      c.save();
      c.shadowColor = 'rgba(40,15,0,0.5)';
      c.shadowBlur = hs * 0.15;
      c.shadowOffsetY = hs * 0.05;
      c.drawImage(art.hub, CX - hs / 2, CY - hs / 2, hs, hs);
      c.restore();
    }
    if (art.rim) c.drawImage(art.rim, rx, ry, SZ, SZ);
    stepGlints(now);
    glints.forEach(function (g) {
      var k = (now - g.t) / g.life, r = SZ * 0.4;
      star(c, CX + Math.sin(g.a) * r, CY - Math.cos(g.a) * r, SZ * 0.035 * Math.sin(k * Math.PI), 0.9 * Math.sin(k * Math.PI));
    });
    if (art.pointer) { // the arrow swings on its hinge under the peacock
      var px = rx + 0.5 * SZ, py = ry + RIM.pivotY * SZ, pw = RIM.pw * SZ, ph = RIM.ph * SZ;
      c.save();
      c.translate(px, py);
      c.rotate(-wheel.flap * 0.6);
      c.shadowColor = 'rgba(40,15,0,0.55)';
      c.shadowBlur = pw * 0.25;
      c.shadowOffsetX = pw * 0.06;
      c.shadowOffsetY = pw * 0.12;
      c.drawImage(art.pointer, -pw / 2, -ph * 0.04, pw, ph);
      c.restore();
    }
    // sparkles around a win
    sparks = sparks.filter(function (s) {
      s.t += dt;
      if (s.t < 0) return true;
      var k = s.t / s.life;
      if (k >= 1) return false;
      star(c, CX + Math.sin(s.a) * s.r, CY - Math.cos(s.a) * s.r, s.s * Math.sin(k * Math.PI), Math.sin(k * Math.PI));
      return true;
    });
  }

  function drawCoins(c, now, dt) {
    if (!coins.length || !art.coin) return;
    var g = SZ / 1000 * 0.0032;
    coins = coins.filter(function (o) {
      o.t += dt;
      if (o.t < 0) return true;
      o.vy += g * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.ph += o.w * dt;
      if (o.y > H + FULL_H * 0.2) return false;
      var sx = Math.abs(Math.cos(o.ph));
      c.save();
      c.translate(o.x, o.y);
      c.scale(Math.max(0.08, sx), 1);
      c.drawImage(art.coin, -o.s / 2, -o.s / 2, o.s, o.s);
      c.restore();
      return true;
    });
  }

  // ---------------------------------------------------------------- wiring + start
  var bootAt = Date.now();
  $('action').onclick = function () { submit(false); };
  $('undo').onclick = undo;
  $('clear').onclick = clearBets;
  $('rebet').onclick = rebet;
  $('back').onclick = function () { game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); if (soundOn) { audio(); play('click'); } };
  $('fair').onclick = function () {
    var d = $('fairDetail');
    d.hidden = !d.hidden;
    $('fair').setAttribute('aria-expanded', String(!d.hidden));
  };
  $('fCheckBtn').onclick = verifyLast;
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      play('click');
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      listSig = '';
      renderList();
    };
  });
  document.addEventListener('keydown', function (e) { // desktop: digits put a chip on a number, Enter places
    if (/INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) addChip(+e.key, nums[+e.key].el);
    else if (e.key === 'Enter' && document.activeElement === document.body) submit(false);
  });

  setSound(soundOn);
  game = window.NXTable.start({
    event: EVENT, game: 'digitdrum',
    onChange: function () {
      S = game ? game.S : S;
      if (!S) return;
      if (S.gotSnapshot && S.phase !== 'waiting' && !started) syncFromSnapshot();
      render();
    },
    onSignal: onSignal,
  });
  S = game.S;
  setText($('fGame'), game.event || EVENT);
  game.limitsLoaded.then(function (l) { buildChips(l); updateBoard(); });
  buildChips(game.limit());
  game.theme('#efe2c9');
  setStatus('wait');
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    ['.history', '.side', '.top', '.panel', '.stage'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); });
  }
  fit();
  render();
  requestAnimationFrame(frame);
  setInterval(tickRound, 100); // the round clock (countdown, auto-send, close) does not depend on the frame rate
})();
