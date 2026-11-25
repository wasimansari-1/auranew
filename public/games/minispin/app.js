/* Mini Spin — NEXORNG roulette (13 pockets 0–12). Game logic: ../_core/wheel-client.js (the engine
 * draws every result and pays; this file never decides anything). This file is the look: the toy
 * wheel with its wind-up key, the marble, Pip the mascot, the betting board and the bets list. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXWheel.start({ event: '88.0039', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- wheel layout
  // Pocket index = number (wheel.json); this is the order the numbers sit around the wheel
  // (colours alternate after the zero).
  var ORDER = [0, 1, 10, 8, 3, 5, 6, 12, 11, 4, 2, 9, 7];
  var N = ORDER.length, SEG = Math.PI * 2 / N, TAU = Math.PI * 2;
  var RED = { 1: 1, 4: 1, 5: 1, 8: 1, 9: 1, 12: 1 };
  function builtinTags(n) { // same as wheel.json (used only until the config arrives)
    if (n === 0) return ['zero'];
    return [n % 2 ? 'odd' : 'even', n <= 6 ? 'low' : 'high', 'street' + Math.ceil(n / 3), 'row' + (((n - 1) % 3) + 1)];
  }
  function pockets() {
    var c = S.config;
    if (c && c.pockets && c.pockets.length) return c.pockets;
    if (!pockets.fallback) {
      pockets.fallback = [];
      for (var n = 0; n < N; n++) pockets.fallback.push({ label: String(n), color: n === 0 ? 'green' : RED[n] ? 'red' : 'black', weight: 1, tags: builtinTags(n) });
    }
    return pockets.fallback;
  }
  function labelOf(i) { var p = pockets()[i]; return p ? p.label : String(i); }
  function colorOf(i) { var p = pockets()[i]; return p ? p.color : 'black'; }
  function slotOf(i) { var k = ORDER.indexOf(Number(labelOf(i))); return k < 0 ? 0 : k; }
  function resultOf(h) { return Array.isArray(h) ? h[0] : h && h.results ? h.results[0] : h; }

  // ---------------------------------------------------------------- bets on the board
  // Each board spot is a set of pocket indices (found from the config's labels, tags and colours).
  var DEFS = [];
  for (var dn = 0; dn <= 12; dn++) DEFS.push({ key: 'n' + dn, num: dn, label: String(dn) });
  [1, 2, 3, 4].forEach(function (k) { DEFS.push({ key: 'street' + k, tag: 'street' + k, label: (k * 3 - 2) + '–' + (k * 3), kind: 'line', col: k + 1, row: 4 }); });
  [3, 2, 1].forEach(function (k, i) { DEFS.push({ key: 'row' + k, tag: 'row' + k, label: 'Row', kind: 'line', col: 6, row: i + 1 }); });
  [['low', '1–6'], ['even', 'Even'], ['red', ''], ['black', ''], ['odd', 'Odd'], ['high', '7–12']].forEach(function (o, i) {
    DEFS.push({ key: o[0], tag: o[0] === 'red' || o[0] === 'black' ? null : o[0], color: o[0] === 'red' || o[0] === 'black' ? o[0] : null, label: o[1], kind: 'out', col: i + 1, row: 5 });
  });
  var DEF = {};
  DEFS.forEach(function (d) { DEF[d.key] = d; });

  function setFor(key) {
    var d = DEF[key], ps = pockets(), out = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (d.num != null ? p.label === String(d.num) : d.color ? p.color === d.color : (p.tags || []).indexOf(d.tag) >= 0) out.push(i);
    }
    return out;
  }

  // Stakes in cents (no float drift). bets: key → cents.
  var bets = {}, undoStack = [], lastBets = null;
  var chipIdx = 0, chipCents = [10, 20, 50, 100, 250];
  var CHIP_COLOURS = ['#1fb894', '#3d8bff', '#ff8a3d', '#a35cff', '#ff3d6e'];
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function totalOf(b) { var t = 0; for (var k in b) t += b[k]; return t; }
  function isEmpty(b) { for (var k in b) return false; return true; }
  function limitCents() { var l = game.limit(); return { min: Math.round(l.min * 100), max: l.max ? Math.round(l.max * 100) : 0 }; }
  function money(c) { return game.money(c / 100); }
  function short(c) { return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2); }
  function xOf(key) { return game.multiplier(setFor(key)) || 0; }

  // Highest total this board can pay (the best pocket for these bets).
  function possibleWin(b) {
    var per = {}, best = 0;
    for (var k in b) {
      var x = xOf(k);
      setFor(k).forEach(function (i) { per[i] = (per[i] || 0) + Math.floor(b[k] * x + 1e-6); });
    }
    for (var i in per) best = Math.max(best, per[i]);
    return best;
  }

  // ---------------------------------------------------------------- sound (WebAudio, generated)
  var soundOn = true, musicOn = true;
  try { soundOn = localStorage.getItem('minispin-sound') !== 'off'; musicOn = localStorage.getItem('minispin-music') !== 'off'; } catch (e) { /* defaults */ }
  var AC = null, sfx = null, mus = null, noise = null;
  function audio() {
    if (AC) return AC;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { AC = new C(); } catch (e) { return null; }
    sfx = AC.createGain(); sfx.gain.value = soundOn ? 0.9 : 0; sfx.connect(AC.destination);
    mus = AC.createGain(); mus.gain.value = musicOn ? 0.11 : 0; mus.connect(AC.destination);
    noise = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return AC;
  }
  function tone(f, dur, type, vol, at, to, out) {
    var a = audio();
    if (!a) return;
    var t = (at || a.currentTime) + 0.005, o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || sfx);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function burst(dur, freq, q, vol, at, out) {
    var a = audio();
    if (!a) return;
    var t = (at || a.currentTime) + 0.005, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out || sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  var SND = {
    click: function () { tone(900, 0.06, 'triangle', 0.08, 0, 1300); },
    chip: function () { tone(2600, 0.03, 'square', 0.025); tone(1500, 0.07, 'triangle', 0.09, AC && AC.currentTime + 0.018, 1100); burst(0.04, 4000, 3, 0.05); },
    launch: function () { burst(0.35, 1200, 0.8, 0.12); tone(300, 0.3, 'sine', 0.05, 0, 900); },
    clack: function (v) { burst(0.035, 3200, 2.5, 0.22 * v); tone(1900, 0.05, 'triangle', 0.08 * v, 0, 1100); },
    win: function (big) {
      var a = audio();
      if (!a) return;
      var notes = big ? [523, 659, 784, 1047, 1319, 1568] : [587, 740, 880, 1175], t = a.currentTime;
      notes.forEach(function (f, i) { tone(f, 0.32, 'triangle', 0.13, t + i * 0.085); tone(f * 2, 0.2, 'sine', 0.03, t + i * 0.085); });
    },
    lose: function () { var a = audio(); if (!a) return; tone(392, 0.22, 'sine', 0.07, a.currentTime); tone(311, 0.32, 'sine', 0.07, a.currentTime + 0.14); },
  };
  function play(n, v) { if (soundOn && audio() && SND[n]) SND[n](v); }

  // The marble's rolling hum (filtered noise; loudness and pitch follow its speed).
  var roll = null;
  function rollLevel(speed) { // speed 0…1
    var a = AC;
    if (!a || a.state !== 'running') return;
    if (!roll) {
      if (!speed) return;
      var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 1.4; g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(sfx); s.start();
      roll = { f: f, g: g };
    }
    var t = a.currentTime;
    roll.g.gain.setTargetAtTime(soundOn ? speed * 0.16 : 0, t, 0.06);
    roll.f.frequency.setTargetAtTime(420 + speed * 1500, t, 0.08);
  }

  // Background music: a light generated marimba loop (C – Am – F – G), its own on/off.
  var CHORDS = [[48, 55, 64, 67, 72, 76], [45, 52, 60, 64, 69, 72], [41, 48, 57, 60, 65, 69], [43, 50, 59, 62, 67, 71]];
  var step = 0, nextAt = 0, STEP = 60 / 112 / 2;
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function scheduleMusic() {
    var a = AC;
    if (!a || a.state !== 'running' || !musicOn || document.hidden) { nextAt = 0; return; }
    if (!nextAt || nextAt < a.currentTime) nextAt = a.currentTime + 0.05;
    while (nextAt < a.currentTime + 0.3) {
      var bar = Math.floor(step / 8) % 4, beat = step % 8, ch = CHORDS[bar];
      if (beat === 0 || beat === 4) tone(midi(ch[0] - 12), 0.42, 'sine', 0.5, nextAt, 0, mus);
      if (beat === 6) tone(midi(ch[1] - 12), 0.22, 'sine', 0.32, nextAt, 0, mus);
      if (Math.random() < (beat % 2 ? 0.45 : 0.8)) {
        var n = ch[2 + Math.floor(Math.random() * 4)] + (Math.random() < 0.3 ? 12 : 0);
        tone(midi(n), 0.28, 'sine', 0.26, nextAt, 0, mus);
        tone(midi(n) * 4, 0.06, 'sine', 0.04, nextAt, 0, mus);
      }
      if (beat % 2) burst(0.03, 8000, 1, 0.05, nextAt, mus);
      step++;
      nextAt += STEP;
    }
  }
  setInterval(scheduleMusic, 100);
  window.addEventListener('pointerdown', function () { var a = audio(); if (a && a.state === 'suspended') a.resume(); }, true);
  document.addEventListener('visibilitychange', function () { if (AC) { if (document.hidden) AC.suspend(); else AC.resume(); } });
  audio(); // starts as the game opens where the browser allows it; else on the first tap

  function syncToggles() {
    if (sfx) sfx.gain.value = soundOn ? 0.9 : 0;
    if (mus) mus.gain.value = musicOn ? 0.11 : 0;
    $('sound').setAttribute('aria-pressed', String(soundOn));
    $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
    try { localStorage.setItem('minispin-sound', soundOn ? 'on' : 'off'); localStorage.setItem('minispin-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- phrases
  var PHRASES = {
    idle: ['Thirteen pockets, one tiny marble', 'Chips down — Pip is ready!', 'Pick a number, any number', 'Small wheel, big smiles', 'The golden zero sparkles brightest', 'Tap the board to drop a chip'],
    spin: ['Round and round it goes…', 'Rolling, rolling…', 'Where will it stop?', 'Pip is holding its breath…', 'Wind-up wheel, full speed!'],
    win: ['Pocket perfect!', 'Mini spin, mega grin!', 'Nailed it!', 'That marble likes you'],
    lose: ['So close!', 'The marble had other plans', 'Next one is yours', 'Pip says: again!'],
  };
  function phrase(kind) { var l = PHRASES[kind]; return l[Math.floor(Math.random() * l.length)]; }
  var hintText = phrase('idle'), hintAt = 0;
  function setHint(t) { hintText = t; hintAt = performance.now(); var h = $('hint'); if (h.textContent !== t) h.textContent = t; }

  // ---------------------------------------------------------------- toast
  var toastTimer;
  function toast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }

  // ---------------------------------------------------------------- board (built once)
  var cells = {};
  (function buildBoard() {
    var board = $('board');
    DEFS.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      var col = d.num != null ? (d.num === 0 ? 'green' : RED[d.num] ? 'red' : 'black') : '';
      b.className = 'cell' + (d.num === 0 ? ' cell--zero cell--green' : d.num != null ? ' cell--' + col : ' cell--' + d.kind);
      if (d.num > 0) { b.style.gridColumn = String(1 + Math.ceil(d.num / 3)); b.style.gridRow = String(3 - ((d.num - 1) % 3)); }
      if (d.col) { b.style.gridColumn = String(d.col); b.style.gridRow = String(d.row); }
      var lab = document.createElement('span');
      if (d.color) { lab.className = 'cell__dot cell__dot--' + d.color; } else lab.textContent = d.label;
      b.appendChild(lab);
      var x = null;
      if (d.kind) { x = document.createElement('small'); x.className = 'cell__x'; b.appendChild(x); }
      var chip = document.createElement('span');
      chip.className = 'cell__chip';
      chip.hidden = true;
      b.appendChild(chip);
      b.setAttribute('aria-label', (d.num != null ? 'Number ' + d.label : d.color ? d.color : d.kind === 'line' && d.label === 'Row' ? 'Row ' + d.key.slice(3) : d.label));
      b.onclick = function () { place(d.key); };
      board.appendChild(b);
      cells[d.key] = { el: b, x: x, chip: chip, cls: b.className };
    });
  })();

  var chipBtns = chipCents.map(function (c, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chipbtn';
    b.setAttribute('role', 'radio');
    b.style.setProperty('--chip', CHIP_COLOURS[i]);
    b.onclick = function () { chipIdx = i; play('click'); updateChips(); };
    $('chips').appendChild(b);
    return b;
  });
  function updateChips() {
    chipBtns.forEach(function (b, i) {
      var t = short(chipCents[i]);
      if (b.textContent !== t) b.textContent = t;
      b.setAttribute('aria-checked', String(i === chipIdx));
      b.setAttribute('aria-label', 'Chip ' + money(chipCents[i]));
    });
  }
  game.limitsLoaded.then(function () { // chips 1/2/5/10/25 × the min bet; the min chip preselected
    var l = limitCents();
    if (l.min > 0) chipCents = [1, 2, 5, 10, 25].map(function (k) { return l.min * k; });
    chipIdx = 0;
    updateChips();
    updateBoard();
  });

  // Result shown on the board until the next chip: the spun bets + the winning pocket.
  var shown = null; // { bets, result }
  function chipColour(c) { var k = 0; for (var i = 0; i < chipCents.length; i++) if (c >= chipCents[i]) k = i; return CHIP_COLOURS[k]; }

  function updateBoard() {
    var view = isEmpty(bets) && shown ? shown.bets : bets;
    var hitSet = null;
    if (shown && isEmpty(bets)) hitSet = shown.result;
    DEFS.forEach(function (d) {
      var c = cells[d.key], amt = view[d.key] || 0, cls = c.cls;
      if (hitSet != null) {
        var has = setFor(d.key).indexOf(hitSet) >= 0;
        if (has) cls += ' cell--hit'; else if (!amt) cls += ' cell--dim';
        if (has && amt) cls += ' cell--won';
      }
      if (c.el.className !== cls) c.el.className = cls;
      if (amt) {
        var t = short(amt);
        if (c.chip.textContent !== t) c.chip.textContent = t;
        c.chip.style.setProperty('--chip', chipColour(amt));
      }
      if (c.chip.hidden !== !amt) c.chip.hidden = !amt;
      if (c.x) { var x = xOf(d.key), xt = x ? x.toFixed(2) + '×' : ''; if (c.x.textContent !== xt) c.x.textContent = xt; }
    });
    var locked = busy();
    $('board').classList.toggle('board--locked', locked);
    updateControls();
  }

  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  function updateControls() {
    var locked = busy(), tot = totalOf(bets), empty = isEmpty(bets);
    setText($('total'), money(tot));
    setText($('maxWin'), money(possibleWin(bets)));
    $('undo').disabled = locked || !undoStack.length;
    $('clear').disabled = locked || empty;
    $('double').disabled = locked || empty;
    $('rebet').disabled = locked || !lastBets;
    var sp = $('spin'), label = 'Spin', sub = '', dis = false, cls = 'spin';
    if (locked) { label = 'Spinning'; dis = true; cls = 'spin spin--busy'; }
    else if (!empty) sub = money(tot);
    else if (lastBets) sub = 'Rebet ' + money(totalOf(lastBets));
    else { sub = 'Place chips'; dis = true; }
    if (sp.className !== cls) sp.className = cls;
    if (sp.disabled !== dis) sp.disabled = dis;
    setText($('spinLabel'), label);
    setText($('spinSub'), sub);
  }

  // A change of the board: checked against the limits and the balance first.
  function tryBets(next, quiet) {
    var l = limitCents(), tot = totalOf(next), n = 0;
    for (var k in next) n++;
    if (n > 40) { if (!quiet) toast('Up to 40 bets per spin.', 'error'); return false; }
    if (l.max && tot > l.max) { if (!quiet) toast('Max total bet is ' + money(l.max) + '.', 'error'); return false; }
    var bal = shownBalance();
    if (bal != null && tot > Math.round(bal * 100) + 0.5) { if (!quiet) toast('Not enough balance.', 'error'); return false; }
    return true;
  }
  function commit(next) {
    undoStack.push(copy(bets));
    if (undoStack.length > 60) undoStack.shift();
    bets = next;
    shown = null;
    hidePop();
    updateBoard();
  }
  function place(key) {
    if (busy()) return;
    var next = copy(bets);
    next[key] = (next[key] || 0) + chipCents[chipIdx];
    if (!tryBets(next)) return;
    play('chip');
    commit(next);
  }
  function doubleBets() {
    if (busy() || isEmpty(bets)) return;
    var next = {};
    for (var k in bets) next[k] = bets[k] * 2;
    if (!tryBets(next)) return;
    play('chip');
    commit(next);
  }
  function rebet() {
    if (busy() || !lastBets) return false;
    if (!tryBets(lastBets)) return false;
    play('chip');
    commit(copy(lastBets));
    return true;
  }

  // ---------------------------------------------------------------- spinning
  // While the wheel turns, the screen keeps showing the balance / history / lists from before the
  // spin (minus the stake), so nothing tells the result before the marble lands.
  var hold = null, waiting = false;
  function busy() { return waiting || anim.mode === 'free' || anim.mode === 'land'; }
  function shownBalance() { return hold ? hold.balance : S.balance; }

  function doSpin() {
    if (busy()) return;
    if (isEmpty(bets) && !rebet()) return;
    var list = [];
    for (var k in bets) list.push({ pockets: setFor(k), amount: (bets[k] / 100).toFixed(2) });
    var tot = totalOf(bets);
    if (!tryBets(bets)) return;
    hold = { balance: S.balance == null ? null : game.round2(S.balance - tot / 100), history: S.history.slice(), myBets: S.myBets.slice(), bets: S.bets.slice(), last: S.last };
    lastBets = copy(bets);
    var spun = copy(bets);
    waiting = true;
    hidePop();
    updateBoard();
    render();
    var p;
    try { p = game.spin(list, clientSeed()); } catch (e) { p = Promise.reject(e); }
    p.then(function (r) {
      var res = resultOf(r && r.results);
      if (res == null && S.last) res = resultOf(S.last.results);
      anim.target = { result: res, win: Number((r && r.win) || 0), bets: spun };
      if (anim.mode !== 'free' && anim.mode !== 'land') startSpin(); // the client did not signal 'spin'
    }).catch(function () {
      focus.release();
      waiting = false;
      hold = null;
      if (anim.mode === 'free') anim.abort = true;
      updateBoard();
      render();
    });
  }

  function onSignal(name, d) {
    if (name === 'spin') { startSpin(); focus.down(lastBets ? game.money(totalOf(lastBets) / 100) : null); }
    if (name === 'error' && d && d.text) toast(d.text, 'error');
  }

  // After the marble has landed: show it all.
  function landed(t) {
    waiting = false;
    hold = null;
    bets = {};
    undoStack = [];
    shown = { bets: t.bets, result: t.result };
    var win = t.win, stake = totalOf(t.bets) / 100;
    showPop(t.result, win);
    focus.hold();
    if (win > 0) {
      var big = win >= stake * 8;
      play('win', big);
      fx.confetti(big ? 140 : 70);
      pip.cheer();
      setHint(phrase('win'));
    } else {
      play('lose');
      pip.sigh();
      setHint(phrase('lose'));
    }
    updateBoard();
    render();
  }

  var popTimer;
  function showPop(res, win) {
    var pop = $('pop'), ball = $('popBall'), w = $('popWin');
    ball.textContent = labelOf(res);
    ball.className = 'pop__ball pop__ball--' + colorOf(res);
    w.className = 'pop__win' + (win > 0 ? '' : ' pop__win--lose');
    w.textContent = win > 0 ? '+' + game.money(win) : '';
    pop.hidden = true;
    void pop.offsetWidth; // restart the pop-in
    pop.hidden = false;
    clearTimeout(popTimer);
    popTimer = setTimeout(hidePop, win > 0 ? 3600 : 2800);
  }
  function hidePop() { clearTimeout(popTimer); $('pop').hidden = true; }

  // ---------------------------------------------------------------- DOM render (S changed)
  var tab = 'all', histKey = '', listKey = '', statsKey = null;
  var announced = false, drewFrame = false;
  function maybeReady() {
    if (announced || !drewFrame || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000); // never hang the loader

  function view() { return hold || S; }

  function render() {
    maybeReady();
    if (focus) focus.check(busy()); // never left down without a spin
    $('conn').hidden = S.connected || !S.gotSnapshot;
    var bal = shownBalance();
    setText($('balance'), bal == null ? '—' : game.money(bal));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');
    var v = view();
    renderHistory(v.history || []);
    renderStats(v.history || []);
    renderList(v);
    var last = v.last || {};
    setText($('fRound'), last.round ? String(last.round) : '—');
    setText($('fHash'), last.hash || '—');
    setText($('fSeed'), last.seed || (S.demo && last.round ? 'demo spins are drawn in your browser' : 'revealed after your first spin'));
    updateBoard();
  }

  function ballEl(i, extra) {
    var s = document.createElement('span');
    s.className = 'ball ball--' + colorOf(i) + (extra ? ' ' + extra : '');
    s.textContent = labelOf(i);
    return s;
  }

  function renderHistory(h) {
    var key = h.length + ':' + h.slice(0, 30).map(resultOf).join(',');
    if (key === histKey) return;
    var fresh = histKey !== '' && h.length > 0;
    histKey = key;
    var el = $('history');
    el.textContent = '';
    if (!h.length) {
      var e = document.createElement('span');
      e.className = 'history__empty';
      e.textContent = 'Your results show here';
      el.appendChild(e);
      return;
    }
    h.slice(0, 30).forEach(function (r, i) { el.appendChild(ballEl(resultOf(r), i === 0 && fresh ? 'ball--new' : '')); });
  }

  // Hot / cold numbers and the red · zero · black share of this player's recent spins.
  function renderStats(h) {
    var list = h.slice(0, 100).map(resultOf).filter(function (r) { return r != null; });
    var key = list.join(',');
    if (key === statsKey) return;
    statsKey = key;
    var count = [], lastSeen = [], ps = pockets();
    for (var i = 0; i < ps.length; i++) { count[i] = 0; lastSeen[i] = 1e9; }
    list.forEach(function (r, k) { count[r]++; if (lastSeen[r] === 1e9) lastSeen[r] = k; });
    var idx = ps.map(function (p, i) { return i; });
    var hot = idx.slice().sort(function (a, b) { return count[b] - count[a] || lastSeen[a] - lastSeen[b]; }).filter(function (i) { return count[i] > 0; }).slice(0, 4);
    var cold = idx.slice().sort(function (a, b) { return count[a] - count[b] || lastSeen[b] - lastSeen[a]; }).slice(0, 4);
    fillBalls($('hot'), list.length ? hot : [], count);
    fillBalls($('cold'), list.length ? cold : [], count);
    var red = 0, zero = 0, black = 0;
    list.forEach(function (r) { var c = colorOf(r); if (c === 'red') red++; else if (c === 'black') black++; else zero++; });
    var n = Math.max(1, list.length), bar = $('ratio').children;
    bar[0].style.width = (list.length ? red / n * 100 : 0) + '%';
    bar[1].style.width = (list.length ? zero / n * 100 : 0) + '%';
    bar[2].style.width = (list.length ? black / n * 100 : 0) + '%';
    setText($('statsNote'), list.length ? 'Your last ' + list.length + ' spin' + (list.length > 1 ? 's' : '') + ' · red ' + Math.round(red / n * 100) + '% · zero ' + Math.round(zero / n * 100) + '% · black ' + Math.round(black / n * 100) + '%' : 'Spin to see your hot & cold numbers');
  }
  function fillBalls(el, items, count) {
    el.textContent = '';
    if (!items.length) { el.textContent = '—'; return; }
    items.forEach(function (i) {
      el.appendChild(ballEl(i, 'ball--sm'));
      var c = document.createElement('small');
      c.textContent = '×' + count[i];
      el.appendChild(c);
    });
  }

  function faceColour(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 75%, 68%)';
  }
  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }
  function amountText(v) { var n = Number(v); return isFinite(n) ? n.toFixed(2) : '—'; }

  function renderList(v) {
    var rows = tab === 'all' ? v.bets || [] : v.myBets || [];
    var key = tab + ':' + rows.length + ':' + rows.slice(0, 30).map(function (b) { return (b.player || b.at) + '/' + b.stake + '/' + b.win + '/' + resultOf(b.results); }).join('|');
    if (key === listKey) return;
    listKey = key;
    var cols = $('cols'), list = $('list');
    cols.textContent = '';
    [tab === 'all' ? 'Player' : 'Time', 'Bet', 'Result', 'Win'].forEach(function (t) { cols.appendChild(cell(t)); });
    list.textContent = '';
    if (!rows.length) list.appendChild(cell(tab === 'all' ? 'No bets yet — be the first!' : 'Your spins this visit show here.', 'empty'));
    rows.slice(0, 30).forEach(function (b) {
      var row = document.createElement('div'), win = Number(b.win) || 0;
      row.className = 'row' + (win > 0 ? ' row--win' : '') + (b.mine ? ' row--mine' : '');
      if (tab === 'all') {
        var user = document.createElement('span');
        user.className = 'row__user';
        var f = document.createElement('i');
        f.className = 'face';
        f.style.setProperty('--face', faceColour(String(b.player || '?')));
        user.appendChild(f);
        user.appendChild(cell(String(b.player || '—')));
        row.appendChild(user);
      } else {
        row.appendChild(cell(new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      }
      row.appendChild(cell(amountText(b.stake)));
      var r = resultOf(b.results), rc = document.createElement('span');
      if (r != null) rc.appendChild(ballEl(r, 'ball--sm')); else rc.textContent = '—';
      row.appendChild(rc);
      row.appendChild(cell(win > 0 ? win.toFixed(2) : '—', 'row__win' + (win > 0 ? '' : ' row__win--zero')));
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- scene (canvas)
  var canvas = $('scene'), stageEl = document.querySelector('.stage'), playEl = $('play');
  var ctx = canvas.getContext('2d');
  var FULL_W = 0, FULL_H = 0, W = 0, H = 0, LEFT = 0, TOP = 0, DPR = 1;
  var WX = 0, WY = 0, R = 100; // the wheel, in play-area coordinates
  var wheelCache = null;

  function fit() {
    var r = canvas.getBoundingClientRect(); // the stage box (the whole screen while the panel is away)
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    FULL_W = r.width; FULL_H = r.height;
    var bar = document.querySelector('.top').getBoundingClientRect();
    TOP = Math.max(0, bar.bottom - r.top + 6);
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    W = FULL_W - LEFT;
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(160, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    stageEl.style.setProperty('--left', LEFT + 'px');
    var ps = playEl.style;
    ps.left = LEFT + 'px'; ps.top = TOP + 'px'; ps.width = W + 'px'; ps.height = H + 'px';
    var hintH = 22;
    R = Math.max(70, Math.min(W * 0.42, (H - hintH) / 2 - 6, 330));
    WX = W / 2 + (W > R * 3.2 ? R * 0.12 : 0);
    WY = (H - hintH) / 2 + 2;
    playEl.style.setProperty('--wx', WX + 'px');
    playEl.style.setProperty('--wy', WY + 'px');
    playEl.style.setProperty('--wr', R + 'px');
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a round is added to it).
    var bufW = Math.round(FULL_W * DPR), bufH = Math.round(FULL_H * DPR);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    wheelCache = null;
    pip.place();
    paint(performance.now(), 0);
  }

  // Spin focus (../_core/spin-focus.js): the bet area slides away while the wheel turns and the scene
  // takes the screen; the result stays 2.6 s on the big wheel (a tap skips), then the bet area returns.
  var focus = NXSpinFocus.create({
    panel: ['.panels'],
    list: '.bets',
    scene: {
      canvas: canvas, relayout: fit,
      wheel: function () { return { x: LEFT + WX, y: TOP + WY, r: R }; },
      parts: [{ el: $('pop') }, { el: $('hint'), fade: true }],
    },
  });

  function shade(hex, k) { // k < 0 darker, > 0 lighter
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var t = k < 0 ? 0 : 255, p = Math.abs(k);
    return 'rgb(' + Math.round(r + (t - r) * p) + ',' + Math.round(g + (t - g) * p) + ',' + Math.round(b + (t - b) * p) + ')';
  }
  var POCKET = { red: '#ff5470', black: '#2a3470', green: '#ffc93c' };
  var FONT = 'ui-rounded, "SF Pro Rounded", "Avenir Next", "Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif';

  // The turning part of the wheel (pockets, numbers, frets, cone) drawn once per size.
  function buildWheel() {
    var size = Math.ceil(R * 2 * DPR) + 4, c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d'), m = size / 2;
    g.translate(m, m);
    g.scale(DPR, DPR);
    var r0 = R * 0.79, r1 = R * 0.655, r2 = R * 0.53;
    for (var s = 0; s < N; s++) {
      var n = ORDER[s], col = POCKET[n === 0 ? 'green' : RED[n] ? 'red' : 'black'];
      var cfgIdx = -1, ps = pockets();
      for (var q = 0; q < ps.length; q++) if (ps[q].label === String(n)) cfgIdx = q;
      if (cfgIdx >= 0 && POCKET[ps[cfgIdx].color]) col = POCKET[ps[cfgIdx].color];
      var a0 = s * SEG - SEG / 2 - Math.PI / 2, a1 = a0 + SEG;
      // number band
      var gr = g.createRadialGradient(0, 0, r1, 0, 0, r0);
      gr.addColorStop(0, shade(col, -0.08));
      gr.addColorStop(1, shade(col, 0.16));
      g.beginPath(); g.arc(0, 0, r0, a0, a1); g.arc(0, 0, r1, a1, a0, true); g.closePath();
      g.fillStyle = gr; g.fill();
      // pocket well (darker, where the marble rests)
      var gw = g.createRadialGradient(0, 0, r2, 0, 0, r1);
      gw.addColorStop(0, shade(col, -0.45));
      gw.addColorStop(1, shade(col, -0.22));
      g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(0, 0, r2, a1, a0, true); g.closePath();
      g.fillStyle = gw; g.fill();
      // number
      g.save();
      g.rotate(s * SEG);
      g.fillStyle = n === 0 ? '#5a3200' : '#fff';
      g.font = '900 ' + Math.round(R * 0.095) + 'px ' + FONT;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), 0, -(r0 + r1) / 2);
      if (n === 0) { star(g, 0, -(r1 + r2) / 2, R * 0.035, '#fff7d1'); }
      g.restore();
    }
    // frets between pockets
    for (var f = 0; f < N; f++) {
      var a = f * SEG - SEG / 2 - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      g.strokeStyle = '#fff3df'; g.lineWidth = Math.max(1.5, R * 0.014); g.lineCap = 'round';
      g.beginPath(); g.moveTo(ca * r2, sa * r2); g.lineTo(ca * r0, sa * r0); g.stroke();
      g.fillStyle = '#ffe2b0';
      g.beginPath(); g.arc(ca * r0, sa * r0, R * 0.018, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(255, 243, 223, 0.9)'; g.lineWidth = Math.max(1.5, R * 0.012);
    g.beginPath(); g.arc(0, 0, r0, 0, TAU); g.stroke();
    // the cone: mint with soft candy stripes and rivets
    var cg = g.createRadialGradient(-R * 0.12, -R * 0.14, R * 0.05, 0, 0, r2);
    cg.addColorStop(0, '#9dfde0'); cg.addColorStop(0.6, '#2ee6b8'); cg.addColorStop(1, '#13a383');
    g.beginPath(); g.arc(0, 0, r2, 0, TAU); g.fillStyle = cg; g.fill();
    for (var k = 0; k < N; k++) {
      var b0 = k * SEG - Math.PI / 2, b1 = b0 + SEG / 2;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r2, b0, b1); g.closePath();
      g.fillStyle = 'rgba(255, 255, 255, 0.10)'; g.fill();
      g.fillStyle = '#fff3df';
      g.beginPath(); g.arc(Math.cos(b0 + SEG / 4) * r2 * 0.78, Math.sin(b0 + SEG / 4) * r2 * 0.78, R * 0.014, 0, TAU); g.fill();
    }
    g.beginPath(); g.arc(0, 0, r2, 0, TAU); g.strokeStyle = 'rgba(0, 60, 50, 0.35)'; g.lineWidth = R * 0.02; g.stroke();
    wheelCache = { c: c, size: size };
  }
  function star(g, x, y, r, col) {
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath(); g.fillStyle = col; g.fill();
  }

  // ---- the spin: wheel angle + marble (free roll, then an exact landing) ----------------
  var IDLE_V = 0.32, SPIN_V = 1.6, FREE_MIN = 900, LAND_MS = 2100;
  var anim = { mode: 'rest', wheelA: 0, wheelV: IDLE_V, a: 0, r: 0, v: 0, slot: 0, t0: 0, plan: null, target: null, abort: false, glowAt: 0, glowSlot: -1, bounce: 0 };
  function trackR() { return R * 0.845; }
  function pocketR() { return R * 0.595; }

  function startSpin() {
    if (anim.mode === 'free' || anim.mode === 'land') return;
    var now = performance.now();
    anim.mode = 'free';
    anim.t0 = now;
    anim.v = -10.5;
    anim.r = trackR();
    anim.target = null;
    anim.abort = false;
    anim.glowSlot = -1;
    play('launch');
    pip.excite();
    setHint(phrase('spin'));
    updateBoard();
  }

  function planLanding(now) {
    var t = anim.target, slot = slotOf(t.result);
    var rel0 = anim.a - anim.wheelA, vrel = anim.v - anim.wheelV; // rad/s, negative
    var want = vrel * (LAND_MS / 1000) / 3;
    var base = slot * SEG - rel0;
    base = ((base % TAU) + TAU) % TAU - TAU;
    var d = base - TAU * Math.round((base - want) / TAU);
    if (d > -2) d -= TAU;
    var k = Math.max(2.2, Math.min(4, vrel * (LAND_MS / 1000) / d));
    anim.plan = { t: now, D: k * d / vrel * 1000, rel0: rel0, d: d, k: k, slot: slot, bounces: 0, dropped: false, wv0: anim.wheelV };
    anim.mode = 'land';
  }

  function stepSpin(now, dt) {
    var s = dt / 1000;
    if (anim.mode === 'free') {
      anim.wheelV += (SPIN_V - anim.wheelV) * Math.min(1, s * 3);
      anim.wheelA += anim.wheelV * s;
      anim.v *= 1 - s * 0.06;
      anim.a += anim.v * s;
      anim.r = trackR() + Math.sin(now / 37) * R * 0.004;
      if (anim.abort) { anim.mode = 'rest'; anim.abort = false; rollLevel(0); setHint(phrase('idle')); updateBoard(); return; }
      if (anim.target && now - anim.t0 >= FREE_MIN) planLanding(now);
      rollLevel(Math.min(1, Math.abs(anim.v - anim.wheelV) / 12));
      return;
    }
    if (anim.mode === 'land') {
      var p = anim.plan, u = Math.min(1, (now - p.t) / p.D), e = 1 - Math.pow(1 - u, p.k);
      anim.wheelV = IDLE_V + (p.wv0 - IDLE_V) * (1 - e);
      anim.wheelA += anim.wheelV * s;
      var jitter = u > 0.45 ? Math.sin(u * 46) * 0.05 * Math.pow(1 - u, 3) : 0;
      anim.a = anim.wheelA + p.rel0 + p.d * e + jitter;
      // the marble rolls on the track, drops over the frets, and hops a few times into its pocket
      var tr = trackR(), pr = pocketR(), DROP = 0.42, IN = 0.6;
      if (u < DROP) anim.r = tr;
      else if (u < IN) { var q = (u - DROP) / (IN - DROP); anim.r = tr + (pr - tr) * q * q; if (!p.dropped) { p.dropped = true; play('clack', 0.9); } }
      else {
        var b = (u - IN) / 0.085, nb = Math.floor(b);
        anim.r = pr + (tr - pr) * 0.2 * Math.abs(Math.sin(b * Math.PI)) * Math.exp(-(u - IN) * 9);
        if (nb > p.bounces && nb < 5) { p.bounces = nb; play('clack', Math.exp(-nb * 0.6)); }
      }
      rollLevel(Math.min(1, Math.abs(p.d * p.k * Math.pow(1 - u, p.k - 1) / (p.D / 1000)) / 12) * (u < IN ? 1 : 0.4));
      if (u >= 1) {
        anim.mode = 'rest';
        anim.slot = p.slot;
        anim.glowSlot = p.slot;
        anim.glowAt = now;
        rollLevel(0);
        play('clack', 0.35);
        var t = anim.target;
        anim.target = null;
        landed(t);
      }
      return;
    }
    // resting: the marble rides in its pocket while the wheel idles
    anim.wheelV += (IDLE_V - anim.wheelV) * Math.min(1, s * 1.5);
    anim.wheelA += anim.wheelV * s;
    anim.a = anim.wheelA + anim.slot * SEG;
    anim.r = pocketR();
  }

  // ---- the toy wheel -----------------------------------------------------------------
  function drawWheel(now) {
    if (!wheelCache) buildWheel();
    var cx = WX, cy = WY;
    // soft shadow on the "table"
    var sh = ctx.createRadialGradient(cx, cy + R * 0.12, R * 0.6, cx, cy + R * 0.12, R * 1.18);
    sh.addColorStop(0, 'rgba(0, 10, 20, 0.55)'); sh.addColorStop(1, 'rgba(0, 10, 20, 0)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(cx, cy + R * 0.12, R * 1.18, 0, TAU); ctx.fill();
    // tangerine toy rim
    var rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rim.addColorStop(0, '#ffc48a'); rim.addColorStop(0.45, '#ff8a3d'); rim.addColorStop(1, '#d4520c');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = rim; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.985, 0, TAU); ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'; ctx.lineWidth = R * 0.012; ctx.stroke();
    // rim bulbs: chase while spinning, all flash on a win
    var spinning = anim.mode === 'free' || anim.mode === 'land', glow = anim.glowSlot >= 0 ? Math.max(0, 1 - (now - anim.glowAt) / 3500) : 0;
    for (var i = 0; i < 26; i++) {
      var a = i / 26 * TAU - Math.PI / 2, bx = cx + Math.cos(a) * R * 0.945, by = cy + Math.sin(a) * R * 0.945;
      var on = spinning ? ((i + Math.floor(now / 70)) % 4 === 0 ? 1 : 0.25) : glow > 0 ? (Math.floor(now / 160) % 2 ? 1 : 0.35) : 0.55 + 0.25 * Math.sin(now / 600 + i);
      ctx.beginPath(); ctx.arc(bx, by, R * 0.026, 0, TAU);
      ctx.fillStyle = 'rgba(255, 246, 214, ' + (0.35 + 0.65 * on) + ')'; ctx.fill();
      if (on > 0.9) { ctx.beginPath(); ctx.arc(bx, by, R * 0.05, 0, TAU); ctx.fillStyle = 'rgba(255, 220, 120, 0.25)'; ctx.fill(); }
    }
    // cream ball track with a dip towards the pockets
    var tg = ctx.createRadialGradient(cx, cy, R * 0.78, cx, cy, R * 0.905);
    tg.addColorStop(0, '#d9b98f'); tg.addColorStop(0.35, '#fff3df'); tg.addColorStop(1, '#f1d2a6');
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.905, 0, TAU); ctx.fillStyle = tg; ctx.fill();
    // little deflector studs on the track
    for (var dI = 0; dI < 8; dI++) {
      var da = dI / 8 * TAU + Math.PI / 8 - Math.PI / 2, dx = cx + Math.cos(da) * R * 0.8, dy = cy + Math.sin(da) * R * 0.8;
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(da);
      ctx.beginPath(); ctx.moveTo(0, -R * 0.022); ctx.lineTo(R * 0.012, 0); ctx.lineTo(0, R * 0.022); ctx.lineTo(-R * 0.012, 0); ctx.closePath();
      ctx.fillStyle = '#ff8a3d'; ctx.fill();
      ctx.restore();
    }
    // the turning part
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(anim.wheelA);
    var sz = wheelCache.size / DPR;
    ctx.drawImage(wheelCache.c, -sz / 2, -sz / 2, sz, sz);
    if (glow > 0) { // the winning pocket glows
      var g0 = anim.glowSlot * SEG - SEG / 2 - Math.PI / 2;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.79, g0, g0 + SEG); ctx.arc(0, 0, R * 0.53, g0 + SEG, g0, true); ctx.closePath();
      ctx.fillStyle = 'rgba(255, 246, 200, ' + (0.25 + 0.35 * glow * (0.5 + 0.5 * Math.sin(now / 90))) + ')';
      ctx.fill();
      ctx.lineWidth = R * 0.02; ctx.strokeStyle = 'rgba(255, 255, 255, ' + glow + ')'; ctx.stroke();
    }
    ctx.restore();
    // the wind-up key in the middle (turns with the wheel, a little faster)
    drawKey(cx, cy, anim.wheelA * 1.6);
    drawMarble(cx, cy);
  }

  function drawKey(cx, cy, a) {
    var hr = R * 0.2;
    var hg = ctx.createRadialGradient(cx - hr * 0.3, cy - hr * 0.3, hr * 0.1, cx, cy, hr);
    hg.addColorStop(0, '#fff3df'); hg.addColorStop(1, '#e8c48e');
    ctx.beginPath(); ctx.arc(cx, cy, hr, 0, TAU); ctx.fillStyle = hg; ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    // two rounded wings of the key
    [-1, 1].forEach(function (side) {
      var kg = ctx.createLinearGradient(0, -hr, 0, hr);
      kg.addColorStop(0, '#ffd56b'); kg.addColorStop(1, '#ff8a3d');
      ctx.beginPath();
      ctx.ellipse(side * hr * 0.95, 0, hr * 0.62, hr * 0.48, 0, 0, TAU);
      ctx.fillStyle = kg; ctx.fill();
      ctx.lineWidth = R * 0.012; ctx.strokeStyle = '#b84a0a'; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(side * hr * 0.95, 0, hr * 0.24, hr * 0.17, 0, 0, TAU);
      ctx.fillStyle = 'rgba(11, 45, 59, 0.55)'; ctx.fill();
    });
    ctx.fillStyle = '#ffb84a';
    ctx.fillRect(-hr * 0.42, -hr * 0.16, hr * 0.84, hr * 0.32);
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, hr * 0.32, 0, TAU);
    var cg = ctx.createRadialGradient(cx - hr * 0.1, cy - hr * 0.1, 1, cx, cy, hr * 0.32);
    cg.addColorStop(0, '#fff'); cg.addColorStop(1, '#2ee6b8');
    ctx.fillStyle = cg; ctx.fill();
    ctx.lineWidth = R * 0.01; ctx.strokeStyle = '#0b3a4a'; ctx.stroke();
  }

  function marblePos(cx, cy) { var a = anim.a - Math.PI / 2; return { x: cx + Math.cos(a) * anim.r, y: cy + Math.sin(a) * anim.r }; }
  function drawMarble(cx, cy) {
    if (!anim.r) anim.r = pocketR();
    var p = marblePos(cx, cy), br = Math.max(5, R * 0.047);
    ctx.beginPath(); ctx.ellipse(p.x + br * 0.25, p.y + br * 0.4, br * 1.05, br * 0.75, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; ctx.fill();
    var g = ctx.createRadialGradient(p.x - br * 0.35, p.y - br * 0.4, br * 0.1, p.x, p.y, br);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#e9f4ff'); g.addColorStop(1, '#9fb6cc');
    ctx.beginPath(); ctx.arc(p.x, p.y, br, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x - br * 0.35, p.y - br * 0.38, br * 0.28, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
  }

  // ---- Pip: the little lilac critter watching the marble ----------------------------------
  var pip = {
    x: 0, y: 0, s: 40, mood: 'idle', moodAt: 0, blinkAt: 2000,
    place: function () {
      this.s = Math.max(34, Math.min(98, R * 0.36));
      this.x = Math.max(this.s * 0.62 + 6, WX - R - this.s * 0.08);
      this.y = WY + R * 0.74;
    },
    cheer: function () { this.mood = 'cheer'; this.moodAt = performance.now(); },
    sigh: function () { this.mood = 'sigh'; this.moodAt = performance.now(); },
    excite: function () { this.mood = 'spin'; this.moodAt = performance.now(); },
    draw: function (now) {
      var s = this.s, t = now - this.moodAt, mood = this.mood;
      if ((mood === 'cheer' && t > 2400) || (mood === 'sigh' && t > 1600)) { this.mood = mood = 'idle'; }
      if (mood === 'spin' && !(anim.mode === 'free' || anim.mode === 'land')) { this.mood = mood = 'idle'; }
      var hop = 0, squash = 1 + Math.sin(now / 520) * 0.03, arms = 0.2;
      if (mood === 'spin') { hop = Math.abs(Math.sin(now / 150)) * s * 0.12; squash = 1 + Math.sin(now / 75) * 0.05; arms = 0.5 + Math.sin(now / 120) * 0.3; }
      if (mood === 'cheer') { var c = t % 800 / 800; hop = Math.sin(c * Math.PI) * s * 0.55; squash = c < 0.1 || c > 0.9 ? 0.86 : 1.06; arms = 1.3 + Math.sin(now / 90) * 0.25; }
      if (mood === 'sigh') { squash = 0.9; arms = -0.2; }
      var x = this.x, y = this.y - hop, w = s * 0.5 / Math.sqrt(squash), h = s * 0.46 * squash;
      // shadow
      ctx.beginPath(); ctx.ellipse(x, this.y + s * 0.44, s * 0.42 * (1 - hop / s * 0.6), s * 0.09, 0, 0, TAU);
      ctx.fillStyle = 'rgba(0, 10, 20, 0.35)'; ctx.fill();
      // feet
      ctx.fillStyle = '#7d5fd6';
      ctx.beginPath(); ctx.ellipse(x - w * 0.45, y + h * 0.92, s * 0.13, s * 0.07, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + w * 0.45, y + h * 0.92, s * 0.13, s * 0.07, 0, 0, TAU); ctx.fill();
      // arms
      ctx.strokeStyle = '#9b7cf0'; ctx.lineWidth = s * 0.09; ctx.lineCap = 'round';
      [-1, 1].forEach(function (side) {
        var ax = x + side * w * 0.9, ay = y + h * 0.15, ang = -arms;
        ctx.beginPath(); ctx.moveTo(ax, ay);
        ctx.lineTo(ax + side * Math.cos(ang) * s * 0.24, ay + Math.sin(ang) * s * 0.24);
        ctx.stroke();
      });
      // antenna with a tiny spinning-top knob
      var wob = Math.sin(now / 200) * 0.25 + (mood === 'spin' ? Math.sin(now / 60) * 0.3 : 0);
      var tx = x + Math.sin(wob) * s * 0.28, ty = y - h - Math.cos(wob) * s * 0.26;
      ctx.lineWidth = s * 0.035; ctx.strokeStyle = '#7d5fd6';
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.9); ctx.quadraticCurveTo(x, y - h - s * 0.12, tx, ty); ctx.stroke();
      ctx.beginPath(); ctx.arc(tx, ty, s * 0.075, 0, TAU); ctx.fillStyle = '#ffc93c'; ctx.fill();
      // body
      var bg = ctx.createRadialGradient(x - w * 0.35, y - h * 0.4, s * 0.05, x, y, w * 1.2);
      bg.addColorStop(0, '#e6dbff'); bg.addColorStop(0.55, '#b59cff'); bg.addColorStop(1, '#8566e0');
      ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, TAU); ctx.fillStyle = bg; ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, y + h * 0.35, w * 0.6, h * 0.45, 0, 0, TAU); ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'; ctx.fill();
      // eyes follow the marble
      var m = marblePos(WX, WY), look = Math.atan2(m.y - (y - h * 0.15), m.x - x);
      var blink = (now % 3800) < 130 || mood === 'sigh';
      [-1, 1].forEach(function (side) {
        var ex = x + side * w * 0.36, ey = y - h * 0.18, er = s * 0.12;
        ctx.beginPath(); ctx.ellipse(ex, ey, er, blink ? er * 0.18 : er * 1.15, 0, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        if (!blink) {
          var px = ex + Math.cos(look) * er * 0.42, py = ey + Math.sin(look) * er * 0.5;
          ctx.beginPath(); ctx.arc(px, py, er * 0.55, 0, TAU); ctx.fillStyle = '#1b1640'; ctx.fill();
          ctx.beginPath(); ctx.arc(px - er * 0.2, py - er * 0.22, er * 0.18, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        }
      });
      // cheeks + mouth
      ctx.fillStyle = 'rgba(255, 110, 150, 0.45)';
      ctx.beginPath(); ctx.ellipse(x - w * 0.62, y + h * 0.12, s * 0.07, s * 0.045, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + w * 0.62, y + h * 0.12, s * 0.07, s * 0.045, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3b2470'; ctx.lineWidth = s * 0.035;
      ctx.beginPath();
      if (mood === 'cheer') { ctx.arc(x, y + h * 0.12, s * 0.12, 0.1, Math.PI - 0.1); ctx.closePath(); ctx.fillStyle = '#3b2470'; ctx.fill(); }
      else if (mood === 'sigh') { ctx.arc(x, y + h * 0.32, s * 0.06, Math.PI + 0.3, -0.3); ctx.stroke(); }
      else if (mood === 'spin') { ctx.ellipse(x, y + h * 0.22, s * 0.05, s * 0.07, 0, 0, TAU); ctx.fillStyle = '#3b2470'; ctx.fill(); }
      else { ctx.arc(x, y + h * 0.1, s * 0.09, 0.3, Math.PI - 0.3); ctx.stroke(); }
    },
  };

  // ---- the room: drifting sky, slow sunburst, bubbles and toy confetti --------------------
  var bubbles = [], toys = [];
  for (var bi = 0; bi < 22; bi++) bubbles.push({ x: Math.random(), y: Math.random(), r: 3 + Math.random() * 12, v: 0.012 + Math.random() * 0.03, ph: Math.random() * 6 });
  for (var ti = 0; ti < 16; ti++) toys.push({ x: Math.random(), y: Math.random(), k: ti % 4, s: 6 + Math.random() * 9, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 0.008, c: ['#ff8a3d', '#2ee6b8', '#ffc93c', '#b59cff', '#ff5470'][ti % 5] });
  var SKY_A = [11, 58, 74], SKY_B = [30, 44, 96];
  function skyTop(now) { var k = 0.5 - 0.5 * Math.cos(now / 30000); return SKY_A.map(function (v, i) { return Math.round(v + (SKY_B[i] - v) * k); }); }
  function drawRoom(now, dt) {
    var top = skyTop(now);
    var g = ctx.createLinearGradient(0, -TOP, 0, FULL_H - TOP);
    g.addColorStop(0, 'rgb(' + top.join(',') + ')');
    g.addColorStop(0.65, '#0e3a4b');
    g.addColorStop(1, '#0b2d3b');
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    // a warm pool of light + slow sunburst behind the wheel
    var spinning = anim.mode === 'free' || anim.mode === 'land';
    var lg = ctx.createRadialGradient(WX, WY, R * 0.4, WX, WY, R * 2.2);
    lg.addColorStop(0, 'rgba(46, 230, 184, 0.28)'); lg.addColorStop(0.5, 'rgba(46, 230, 184, 0.08)'); lg.addColorStop(1, 'rgba(46, 230, 184, 0)');
    ctx.fillStyle = lg; ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    drawRoom.rays = (drawRoom.rays || 0) + dt / 1000 * (spinning ? 0.5 : 0.06);
    ctx.save();
    ctx.translate(WX, WY);
    ctx.rotate(drawRoom.rays);
    var len = Math.max(FULL_W, FULL_H) * 1.2;
    ctx.fillStyle = 'rgba(255, 243, 223, 0.045)';
    for (var i = 0; i < 16; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, len, i * TAU / 16, i * TAU / 16 + TAU / 40);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // bubbles rise slowly (faster while spinning)
    var sp = dt / 1000 * (spinning ? 2.2 : 1);
    bubbles.forEach(function (b) {
      b.y -= b.v * sp;
      if (b.y < -0.05) { b.y = 1.05; b.x = Math.random(); }
      var bx = b.x * FULL_W - LEFT + Math.sin(now / 1400 + b.ph) * 12, by = b.y * FULL_H - TOP;
      ctx.beginPath(); ctx.arc(bx, by, b.r, 0, TAU);
      ctx.strokeStyle = 'rgba(200, 250, 255, 0.22)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(bx - b.r * 0.35, by - b.r * 0.35, b.r * 0.22, 0, TAU);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'; ctx.fill();
    });
    // toy confetti drifting about
    toys.forEach(function (t) {
      t.rot += t.vr * dt / 1000;
      t.x = (t.x + t.vx * dt / 1000 + 1) % 1;
      var tx = t.x * FULL_W - LEFT, ty = (t.y * FULL_H) - TOP + Math.sin(now / 2000 + t.rot) * 8;
      ctx.save(); ctx.translate(tx, ty); ctx.rotate(t.rot);
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = ctx.fillStyle = t.c; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath();
      if (t.k === 0) { ctx.arc(0, 0, t.s * 0.6, 0, TAU); ctx.stroke(); }
      else if (t.k === 1) { ctx.moveTo(0, -t.s * 0.7); ctx.lineTo(t.s * 0.6, t.s * 0.45); ctx.lineTo(-t.s * 0.6, t.s * 0.45); ctx.closePath(); ctx.fill(); }
      else if (t.k === 2) { ctx.moveTo(-t.s, 0); ctx.quadraticCurveTo(-t.s / 2, -t.s * 0.6, 0, 0); ctx.quadraticCurveTo(t.s / 2, t.s * 0.6, t.s, 0); ctx.stroke(); }
      else { ctx.rect(-t.s * 0.4, -t.s * 0.4, t.s * 0.8, t.s * 0.8); ctx.fill(); }
      ctx.restore();
    });
    ctx.globalAlpha = 1;
    return top;
  }

  // ---- win confetti ---------------------------------------------------------------
  var fx = {
    parts: [],
    confetti: function (n) {
      var cols = ['#ff8a3d', '#2ee6b8', '#ffc93c', '#b59cff', '#ff5470', '#fff3df'];
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, v = R * (1.2 + Math.random() * 2.2);
        this.parts.push({ x: WX, y: WY, vx: Math.cos(a) * v, vy: Math.sin(a) * v - R * 1.5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, s: Math.max(4, R * (0.025 + Math.random() * 0.03)), c: cols[i % cols.length], life: 1.6 + Math.random() * 0.9 });
      }
    },
    draw: function (dt) {
      var s = dt / 1000;
      this.parts = this.parts.filter(function (p) {
        p.life -= s;
        if (p.life <= 0) return false;
        p.vy += R * 2.6 * s; p.vx *= 1 - s * 0.8;
        p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, p.life * 1.5);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s * 0.3, p.s, p.s * 0.6);
        ctx.restore();
        return true;
      });
      ctx.globalAlpha = 1;
    },
  };

  // ---------------------------------------------------------------- frame loop
  var lastT = 0, themeAt = 0;
  function hex(c) { return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); }
  function frame(now) {
    var dt = lastT ? Math.min(80, now - lastT) : 16;
    lastT = now;
    stepSpin(now, dt);
    paint(now, dt);
    if (!busy() && now - hintAt > 7000) setHint(phrase('idle'));
    requestAnimationFrame(frame);
  }
  function paint(now, dt) { // also right after a resize (a resized canvas is blank until drawn)
    if (FULL_W && FULL_H) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.translate(LEFT, TOP); // play-area coordinates; the room also fills above / to the left
      var top = drawRoom(now, dt);
      drawWheel(now);
      pip.draw(now);
      fx.draw(dt);
      if (now - themeAt > 400) { themeAt = now; game.theme(hex(top)); }
      if (!drewFrame) { drewFrame = true; maybeReady(); }
    }
  }

  // ---------------------------------------------------------------- controls
  function clientSeed() {
    var el = $('clientSeed'), v = String(el.value || '').trim();
    if (!v) { v = randomSeed(); el.value = v; }
    try { localStorage.setItem('minispin-seed', v); } catch (e) { /* ignore */ }
    return v;
  }
  function randomSeed() { var a = new Uint8Array(8); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  (function () { var v = ''; try { v = localStorage.getItem('minispin-seed') || ''; } catch (e) { /* none */ } $('clientSeed').value = v || randomSeed(); })();

  $('spin').onclick = function () { play('click'); doSpin(); };
  $('undo').onclick = function () {
    if (busy() || !undoStack.length) return;
    play('click');
    bets = undoStack.pop();
    shown = null;
    updateBoard();
  };
  $('clear').onclick = function () { if (busy() || isEmpty(bets)) return; play('click'); commit({}); };
  $('double').onclick = doubleBets;
  $('rebet').onclick = rebet;
  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () { soundOn = !soundOn; syncToggles(); play('click'); if (!soundOn) rollLevel(0); };
  $('music').onclick = function () { musicOn = !musicOn; syncToggles(); play('click'); };
  $('fair').onclick = function () {
    var d = $('fairDetail');
    d.hidden = !d.hidden;
    $('fair').setAttribute('aria-expanded', String(!d.hidden));
  };
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      play('click');
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      renderList(view());
    };
  });

  syncToggles();
  updateChips();
  setHint(hintText);
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top', '.stage'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
