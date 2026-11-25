/* Raptor Run — an original NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is
 * the look, all drawn in code: a raptor crouches at the start line while a big egg cracks open
 * (the betting time), bursts out with a roar and sprints through a prehistoric jungle — ferns,
 * a waterfall cliff, the river — while the day turns to a lava-red night and the volcano grows
 * and smokes; the round ends when the volcano erupts and the raptor trips into a tar pit.
 * Sounds and music are generated (WebAudio). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var GAME_ID = '88.0016';
  var game = NXCrash.start({ event: GAME_ID, onChange: render, onSignal: onSignal });
  var S = game.S;
  var KEY = 'raptorrun';

  // Everything is drawn in code: ready once the live round state has arrived.
  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 10000); // never hang the loader

  // ---------------------------------------------------------------- timings (sound = animation)
  var START_MS = 1100; // the egg bursts, the raptor roars and sprints off — the "start" sound lasts as long
  var ROAR_MS = 600; // the roar (then the first strides until START_MS)
  var CRASH_MS = 1300; // the volcano erupts and the raptor sinks into the tar — the "crash" sound lasts as long
  var TRIP_AT = 300; // the raptor trips (ms into the crash)

  // ---------------------------------------------------------------- sound (WebAudio, generated)
  var AC = window.AudioContext || window.webkitAudioContext;
  var ac = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  function audio() {
    if (ac || !AC) return ac;
    try {
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = 0.22; musicBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      var d = noiseBuf.getChannelData(0), b = 0;
      for (var i = 0; i < d.length; i++) { b = 0.98 * b + 0.02 * (Math.random() * 2 - 1); d[i] = (Math.random() * 2 - 1) * 0.6 + b * 2; }
    } catch (e) { ac = null; }
    return ac;
  }
  function tone(type, freq, t0, dur, vol, freqTo, bus) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, vol, filter, f1, f2, attack, bus) {
    var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = filter; f.frequency.setValueAtTime(f1, t0);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
    return { src: s, gain: g, filter: f };
  }
  var soundOn = true;
  try { soundOn = localStorage.getItem(KEY + '-sound') !== 'off'; } catch (e) { /* default on */ }
  var SFX = {
    click: function (t) { tone('triangle', 1100, t, 0.05, 0.12); },
    step: function (t) { tone('sine', 96, t, 0.09, 0.32, 46); noise(t, 0.05, 0.12, 'lowpass', 300); },
    // a roar until ROAR_MS, then strides speeding up until START_MS (= the animation)
    start: function (t) {
      var r = ROAR_MS / 1000;
      tone('sawtooth', 160, t, r, 0.16, 70);
      tone('square', 82, t + 0.03, r - 0.03, 0.08, 52);
      noise(t, r, 0.35, 'lowpass', 900, 260, 0.08);
      [0.7, 0.86, 0.98, 1.06].forEach(function (s) { if (s < START_MS / 1000) tone('sine', 100, t + s, 0.08, 0.34, 46); });
    },
    cashout: function (t) { [698, 880, 1047, 1397].forEach(function (f, i) { tone('sine', f, t + i * 0.075, 0.22, 0.24); tone('sine', f * 2, t + i * 0.075, 0.08, 0.06); }); },
    // the eruption: a deep boom and rumble for CRASH_MS, a "splat" into the tar at TRIP_AT
    crash: function (t) {
      var c = CRASH_MS / 1000, trip = t + TRIP_AT / 1000;
      tone('sine', 72, t, c, 0.9, 28);
      noise(t, c, 0.45, 'lowpass', 420, 120, 0.03);
      noise(trip, 0.2, 0.4, 'bandpass', 700, 300, 0.01);
      tone('sine', 230, trip, 0.16, 0.3, 90);
    },
  };
  function play(name) {
    if (!soundOn || !audio() || ac.state !== 'running' || !SFX[name]) return;
    SFX[name](ac.currentTime + 0.01);
  }

  // Background music: jungle drums and marimba (generated, looped by a small scheduler).
  var musicOn = true;
  try { musicOn = localStorage.getItem(KEY + '-music') !== 'off'; } catch (e) { /* default on */ }
  var BPM = 104, STEP = 60 / BPM / 2, nextNote = 0, stepN = 0, musicTimer = null;
  var MARIMBA = [293.66, 349.23, 392, 440, 523.25, 587.33]; // D minor pentatonic
  function scheduleMusic() {
    if (!ac) return;
    while (nextNote < ac.currentTime + 0.25) {
      var s = stepN % 8, bar = Math.floor(stepN / 8) % 4;
      if (s === 0 || s === 3 || s === 6) tone('sine', 110, nextNote, 0.2, 0.4, 66, musicBus); // low tom
      if (s === 2 || s === 7) tone('sine', 220, nextNote, 0.12, 0.2, 150, musicBus); // high tom
      if (s % 2 === 1) noise(nextNote, 0.035, 0.08, 'highpass', 6000, 0, 0.003, musicBus); // shaker
      if ((s === 1 || s === 4 || s === 5) && bar !== 3) tone('sine', MARIMBA[(stepN * 2 + bar) % MARIMBA.length], nextNote, 0.22, 0.12, 0, musicBus);
      nextNote += STEP; stepN++;
    }
  }
  function syncMusic() {
    var on = musicOn && audio() && ac.state === 'running';
    if (on && !musicTimer) { nextNote = ac.currentTime + 0.05; musicTimer = setInterval(scheduleMusic, 80); }
    if (!on && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.22 : 0, ac.currentTime, 0.1);
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  // Starts as the game opens (the tap that opened it allows sound); else on the first tap here.
  function unlock() {
    if (!audio()) return;
    if (ac.state !== 'running') ac.resume().then(syncMusic, function () {});
    else syncMusic();
  }
  window.addEventListener('pointerdown', unlock, true);
  document.addEventListener('visibilitychange', function () {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else unlock();
  });
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem(KEY + '-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');

  }

  // ---------------------------------------------------------------- engine moments
  var scene = { startAt: 0, crashAt: 0, x: 0, lastT: 0, alt: 0, step: 0, lastStep: 0 };
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') { scene.startAt = now; scene.step = 0; scene.lastStep = 0; play('start'); }
    if (name === 'crash') { scene.crashAt = now; startEruption(lastVolcano); play('crash'); }
    if (name === 'betting') { scene.startAt = 0; scene.crashAt = 0; }
    if (name === 'win') { play('cashout'); toast(d.text, 'win'); }
    if (name === 'error') toast(d.text, 'error');
  }

  var toastTimer;
  function toast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- generated avatars (7 × 2)
  var AV_CELL = 68, avatarUrl = '';
  (function makeAvatars() {
    var c = document.createElement('canvas');
    c.width = AV_CELL * 7; c.height = AV_CELL * 2;
    var g = c.getContext('2d');
    var HUES = [110, 30, 160, 75, 10, 190, 50, 140, 20, 95, 180, 60, 0, 125];
    for (var i = 0; i < 14; i++) {
      var x = (i % 7) * AV_CELL, y = Math.floor(i / 7) * AV_CELL, m = AV_CELL / 2, h = HUES[i];
      var bg = g.createRadialGradient(x + m * 0.7, y + m * 0.6, 4, x + m, y + m, m);
      bg.addColorStop(0, 'hsl(' + h + ',60%,52%)'); bg.addColorStop(1, 'hsl(' + h + ',60%,24%)');
      g.fillStyle = bg; g.fillRect(x, y, AV_CELL, AV_CELL);
      g.save(); g.translate(x + m, y + m);
      var k = i % 7;
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (k === 0) { // dino head
        g.fillStyle = '#5ec45a'; g.beginPath(); g.moveTo(-16, -6); g.quadraticCurveTo(4, -16, 20, -4); g.quadraticCurveTo(22, 4, 14, 8); g.lineTo(-14, 10); g.closePath(); g.fill();
        g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(0, -4, 4, 0, 7); g.fill(); g.fillStyle = '#111'; g.fillRect(-1, -7, 2, 6);
        g.fillStyle = '#fff'; for (var t = 0; t < 4; t++) { g.beginPath(); g.moveTo(-4 + t * 5, 8); g.lineTo(-2 + t * 5, 12); g.lineTo(0 + t * 5, 8); g.fill(); }
      } else if (k === 1) { // egg
        g.fillStyle = '#f6efcf'; g.beginPath(); g.ellipse(0, 2, 13, 18, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(110,140,60,0.7)'; [[-5, -4, 3], [4, 3, 2.5], [-2, 9, 2]].forEach(function (d) { g.beginPath(); g.arc(d[0], d[1], d[2], 0, 7); g.fill(); });
      } else if (k === 2) { // footprint
        g.fillStyle = '#f3e6c8'; g.beginPath(); g.ellipse(0, 8, 7, 9, 0, 0, 7); g.fill();
        [[-9, -8, -0.5], [0, -12, 0], [9, -8, 0.5]].forEach(function (d) { g.save(); g.translate(d[0], d[1]); g.rotate(d[2]); g.beginPath(); g.ellipse(0, 0, 3.5, 8, 0, 0, 7); g.fill(); g.restore(); });
      } else if (k === 3) { // leaf
        g.fillStyle = '#b6f24a'; g.beginPath(); g.moveTo(0, -18); g.quadraticCurveTo(16, -2, 0, 18); g.quadraticCurveTo(-16, -2, 0, -18); g.fill();
        g.strokeStyle = '#3c6e1e'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 16); g.stroke();
      } else if (k === 4) { // bone
        g.fillStyle = '#f7f1df'; g.save(); g.rotate(-0.6); g.fillRect(-12, -4, 24, 8);
        [[-14, -5], [-14, 5], [14, -5], [14, 5]].forEach(function (d) { g.beginPath(); g.arc(d[0], d[1], 5, 0, 7); g.fill(); }); g.restore();
      } else if (k === 5) { // volcano
        g.fillStyle = '#4a3434'; g.beginPath(); g.moveTo(-18, 14); g.lineTo(-5, -8); g.lineTo(5, -8); g.lineTo(18, 14); g.fill();
        g.fillStyle = '#ff8a3d'; g.beginPath(); g.moveTo(-5, -8); g.lineTo(0, -18); g.lineTo(5, -8); g.fill();
      } else { // tooth
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-9, -12); g.lineTo(9, -12); g.quadraticCurveTo(6, 6, 0, 16); g.quadraticCurveTo(-6, 6, -9, -12); g.fill();
      }
      g.restore();
    }
    avatarUrl = c.toDataURL('image/png');
  })();
  function avatarIndex(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 14;
  }
  function avatarEl(name, size) {
    var av = document.createElement('i'), k = avatarIndex(name);
    av.className = 'avatar';
    av.style.backgroundImage = 'url(' + avatarUrl + ')';
    av.style.backgroundSize = (7 * size) + 'px ' + (2 * size) + 'px';
    av.style.backgroundPosition = (-(k % 7) * size) + 'px ' + (-Math.floor(k / 7) * size) + 'px';
    return av;
  }

  // ---------------------------------------------------------------- DOM render
  var tab = 'all';
  // Players in this round, on the scene (../_core/players.js), with this game's avatar faces.
  var playersStrip;
  function playerFace(name) { return avatarEl(name, 28); }

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: playerFace });
    playersStrip.update(S);
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot;
    $('balance').textContent = S.balance == null ? '—' : game.money(S.balance);
    $('mode').textContent = S.demo ? 'Demo balance' : 'Balance';

    var h = $('history');
    h.innerHTML = '';
    S.history.forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'chip' + (c >= 10 ? ' chip--big' : '');
      s.textContent = c.toFixed(2) + 'x';
      h.appendChild(s);
    });

    updateButtons();
    renderList();

    $('fRound').textContent = S.round || '—';
    $('fHash').textContent = S.hash || '—';
    $('fSeed').textContent = S.seed || 'revealed when the round ends';
  }

  // ---- bet panels (slot 0 and 1): phone shows one, wide screens both -------------------
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    // A carved stone slab: the stake on a wooden log, bone buttons, pebble amounts, a lava stone.
    el.innerHTML =
      '<div class="slab">' +
      '<div class="slab__title">Stake ' + (slot + 1) + '</div>' +
      '<div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<input class="amount" inputmode="decimal" value="1.00" aria-label="Bet amount">' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<button type="button" class="action"><span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      '<div class="auto"><span>Auto cash out</span>' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label>' +
      '<input class="auto__x" inputmode="decimal" value="1.10" aria-label="Auto cash-out multiplier"></div>' +
      '</div>';
    $('panels').appendChild(el);
    var q = function (sel) { return el.querySelector(sel); };
    return { slot: slot, el: el, amount: q('.amount'), action: q('.action'), label: q('.action__label'), sub: q('.action__sub'), autoOn: q('.auto__on'), autoAt: q('.auto__x'), quick: q('.quick') };
  });

  function readAmount(p) {
    var v = Number(String(p.amount.value).replace(',', '.'));
    return isFinite(v) && v > 0 ? game.round2(v) : 0;
  }
  function readAuto(p) {
    if (!p.autoOn.checked) return 0;
    var v = Number(String(p.autoAt.value).replace(',', '.'));
    return isFinite(v) && v >= 1.01 ? Math.round(v * 100) / 100 : 0;
  }

  function updateButtons() { panels.forEach(updateButton); }
  // The button is built once; only its texts / class change (and only when they differ), so
  // a tap never lands on an element that is being replaced.
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function updateButton(p) {
    var my = S.my[p.slot], cls = 'action', label = 'Bet', sub = game.money(readAmount(p)), disabled = false;
    var mine = my && my.round === S.round;
    if (S.queued[p.slot]) {
      cls = 'action action--cancel'; label = 'Cancel'; sub = 'Waiting for next round';
    } else if (mine && my.status === 'pending') {
      cls = 'action action--waiting'; label = 'Placing bet…'; sub = ''; disabled = true;
    } else if (mine && my.status === 'placed' && S.phase === 'betting') {
      cls = 'action action--waiting'; label = 'Bet placed'; sub = game.money(my.amount); disabled = true;
    } else if (mine && (my.status === 'placed' || my.status === 'cashing') && S.phase === 'flying') {
      cls = 'action action--cashout'; label = 'Cash Out'; sub = game.money(game.round2(my.amount * game.currentMult())); disabled = my.status === 'cashing';
    }
    if (p.action.className !== cls) p.action.className = cls;
    if (p.action.disabled !== disabled) p.action.disabled = disabled;
    setText(p.label, label);
    setText(p.sub, sub);
  }

  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }

  function renderList() {
    var list = $('list');
    list.innerHTML = '';
    if (tab === 'all') {
      $('countLabel').textContent = 'All bets';
      $('betCount').textContent = S.bets.length;
      $('cols').innerHTML = '<span>User</span><span>Bet</span><span>X</span><span>Cash out</span>';
      if (!S.bets.length) list.appendChild(cell('No bets yet this round.', 'empty'));
      S.bets.slice().reverse().forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--cashed' : '') + (b.mine ? ' row--mine' : '');
        var user = document.createElement('span');
        user.className = 'row__user';
        user.appendChild(avatarEl(b.player, 34));
        user.appendChild(cell(b.player));
        row.appendChild(user);
        row.appendChild(cell(Number(b.amount).toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '-', 'row__x'));
        row.appendChild(cell(b.win ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      $('countLabel').textContent = 'My bets';
      $('betCount').textContent = S.myBets.length;
      $('cols').innerHTML = '<span>Time</span><span>Bet</span><span>X</span><span>Cash out</span>';
      if (!S.myBets.length) list.appendChild(cell('Your bets this visit show here.', 'empty'));
      S.myBets.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--cashed' : '');
        row.appendChild(cell(new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
        row.appendChild(cell(b.amount.toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '-', 'row__x'));
        row.appendChild(cell(b.win ? b.win.toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    }
  }

  // ---------------------------------------------------------------- scene (canvas)
  var canvas = $('scene');
  var stageEl = document.querySelector('.stage');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0;
  // The scene fills the whole stage (under the floating top bar, behind the bets list on wide
  // screens and behind the results row / panels); the play area is the clear part (LEFT, TOP,
  // W × H) and the world is drawn from -LEFT / -TOP so it fills everything.
  var TOP = 0, FULL_H = 0, LEFT = 0, FULL_W = 0;

  function fit() {
    var r = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    FULL_W = r.width; FULL_H = r.height;
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    W = FULL_W - LEFT;
    stageEl.style.setProperty('--left', LEFT + 'px');
    var bar = document.querySelector('.top').getBoundingClientRect();
    TOP = Math.max(0, bar.bottom - r.top + 6);
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(120, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // The multiplier / round texts are centred on the play area (not the whole scene).
    var centre = document.querySelector('.stage__center').style;
    centre.left = LEFT + 'px'; centre.top = TOP + 'px'; centre.width = W + 'px'; centre.height = H + 'px';
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a player joins the round).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function ease(t) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- the world --------------------------------------------------------------------------
  // prog (log10 of the multiplier): 0 a fresh jungle morning · ~0.5 the hot midday · ~1 a
  // lava-red sunset as the volcano wakes · 1.3+ a night lit by the smoking volcano and ash.
  function progress() {
    if (S.phase === 'flying') return Math.min(1.7, Math.log(Math.max(1, game.currentMult())) / Math.LN10);
    if (S.phase === 'crashed') return Math.min(1.7, Math.log(Math.max(1, S.crashPoint)) / Math.LN10);
    return 0;
  }
  var SKY = [ // [prog, top colour, horizon colour]
    [0, [118, 196, 232], [255, 226, 170]],
    [0.5, [70, 160, 222], [255, 210, 140]],
    [1.0, [108, 48, 96], [255, 138, 64]],
    [1.7, [26, 14, 32], [255, 92, 36]],
  ];
  function skyAt(p, i) {
    for (var k = 0; k < SKY.length - 1; k++) {
      if (p <= SKY[k + 1][0]) {
        var f = (p - SKY[k][0]) / (SKY[k + 1][0] - SKY[k][0]);
        var a = SKY[k][i], b = SKY[k + 1][i];
        return [Math.round(lerp(a[0], b[0], f)), Math.round(lerp(a[1], b[1], f)), Math.round(lerp(a[2], b[2], f))];
      }
    }
    return SKY[SKY.length - 1][i];
  }
  function rgb(c, a) { return a == null ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + a + ')'; }
  function shadeMix(c, to, k) { return [Math.round(lerp(c[0], to[0], k)), Math.round(lerp(c[1], to[1], k)), Math.round(lerp(c[2], to[2], k))]; }

  // fixed random layouts (generated once)
  var R = rng(16000016);
  var stars = [], ferns = [], pebbles = [], ash = [], crack = [];
  for (var i = 0; i < 80; i++) stars.push({ x: R(), y: R() * 0.6, r: 0.5 + R() * 1.3, t: R() * 6 });
  for (var f2 = 0; f2 < 9; f2++) ferns.push({ x: R(), s: 0.7 + R() * 0.7, lean: (R() - 0.5) * 0.5, tone: R() });
  for (var p2 = 0; p2 < 40; p2++) pebbles.push({ x: R(), y: R(), r: 1 + R() * 2.5 });
  for (var a2 = 0; a2 < 70; a2++) ash.push({ x: R(), y: R(), v: 0.4 + R() * 0.8, ember: R() < 0.35, ph: R() * 6 });
  (function makeCrack() { // a zig-zag crack across the egg, revealed as betting time runs out
    var x = -0.05, y = -0.32;
    crack.push([x, y]);
    for (var n = 0; n < 9; n++) { x += 0.055 + R() * 0.04; y = -0.32 + n * 0.075 + (n % 2 ? 0.05 : -0.04); crack.push([x * (n % 2 ? 1 : -1) * 0.9, y]); }
  })();
  // smooth ridge height (world x) — a sum of sines: seamless at any scroll position
  function ridge(x, seed) { return Math.sin(x * 0.007 + seed) * 0.5 + Math.sin(x * 0.019 + seed * 2) * 0.3 + Math.sin(x * 0.043 + seed * 3) * 0.2; }

  function ground() { return H * 0.84; }

  function drawSky(p, now) {
    var g = ctx.createLinearGradient(0, -TOP, 0, ground());
    g.addColorStop(0, rgb(skyAt(p, 1)));
    g.addColorStop(1, rgb(skyAt(p, 2)));
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    var night = clamp01((p - 1.05) / 0.35);
    if (night > 0) stars.forEach(function (st) {
      ctx.globalAlpha = night * (0.5 + 0.5 * Math.sin(now / 480 + st.t));
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(st.x * FULL_W - LEFT, st.y * FULL_H - TOP, st.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    // the sun sinks and reddens as the run goes on
    var sunK = clamp01(p / 1.2), sx = W * 0.82, sy = lerp(H * 0.14, ground() - H * 0.18, sunK), sr = Math.max(14, H * 0.07);
    if (p < 1.35) {
      ctx.save();
      ctx.globalAlpha = 1 - clamp01((p - 1.1) / 0.25);
      var sg = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 2.6);
      var core = shadeMix([255, 246, 196], [255, 120, 60], sunK);
      sg.addColorStop(0, rgb(core)); sg.addColorStop(0.35, rgb(core, 0.9)); sg.addColorStop(0.4, rgb(core, 0.3)); sg.addColorStop(1, rgb(core, 0));
      ctx.fillStyle = sg; ctx.fillRect(sx - sr * 2.6, sy - sr * 2.6, sr * 5.2, sr * 5.2);
      ctx.restore();
    }
  }

  // distant ridges (slow), tinted by the sky for depth
  function drawRidges(p) {
    var hor = skyAt(p, 2), G = ground();
    [[0.08, 0.3, 1.3, [96, 88, 140]], [0.16, 0.2, 2.1, [58, 92, 84]]].forEach(function (L) {
      var col = shadeMix(L[3], hor, 0.45 - L[0]), base = G - H * L[1];
      ctx.fillStyle = rgb(col);
      ctx.beginPath(); ctx.moveTo(-LEFT, G);
      for (var x = -LEFT; x <= W + 8; x += 8) ctx.lineTo(x, base - (ridge(x + scene.x * L[0], L[2]) + 1) * H * 0.07);
      ctx.lineTo(W + 8, G); ctx.closePath(); ctx.fill();
    });
  }

  // the volcano: grows, glows and smokes as the multiplier climbs
  function volcano(p, now, erupt) {
    var G = ground(), wake = clamp01(p / 1.4), h = H * (0.22 + 0.2 * wake), w = h * 1.5;
    var cx = W * 0.66, base = G - H * 0.12, top = base - h;
    var vg = ctx.createLinearGradient(0, top, 0, base);
    vg.addColorStop(0, '#5a3a3a'); vg.addColorStop(1, '#2d2530');
    ctx.fillStyle = vg;
    ctx.beginPath(); ctx.moveTo(cx - w, base); ctx.lineTo(cx - w * 0.16, top); ctx.lineTo(cx + w * 0.16, top); ctx.lineTo(cx + w, base); ctx.closePath(); ctx.fill();
    var glow = clamp01((p - 0.25) / 0.9) + erupt;
    if (glow > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var cg = ctx.createRadialGradient(cx, top, 2, cx, top, w * 0.6);
      cg.addColorStop(0, 'rgba(255, 140, 40,' + Math.min(1, glow) + ')'); cg.addColorStop(1, 'rgba(255, 60, 10, 0)');
      ctx.fillStyle = cg; ctx.fillRect(cx - w * 0.6, top - w * 0.6, w * 1.2, w * 1.2);
      if (p > 0.85 || erupt) { // lava streaks down the slopes
        ctx.strokeStyle = 'rgba(255, 110, 30,' + Math.min(1, glow) * 0.9 + ')'; ctx.lineWidth = 2.5;
        [-0.12, 0.05, 0.14].forEach(function (o, n) {
          ctx.beginPath(); ctx.moveTo(cx + w * o, top + 2);
          ctx.quadraticCurveTo(cx + w * (o * 2.2), top + h * 0.4, cx + w * (o * 3 + (n - 1) * 0.1), top + h * (0.55 + n * 0.12)); ctx.stroke();
        });
      }
      ctx.restore();
    }
    // smoke plume
    var puffs = 8 + Math.round(wake * 10);
    for (var n = 0; n < puffs; n++) {
      var life = ((now / 2600 + n / puffs) % 1), r = (6 + life * 30) * (H / 400) * (1 + wake);
      ctx.fillStyle = 'rgba(70, 60, 70,' + (0.45 * (1 - life)) * (0.4 + wake) + ')';
      ctx.beginPath(); ctx.arc(cx + Math.sin(n * 2.1 + now / 900) * 8 + life * w * 0.35, top - life * h * 0.9, r, 0, Math.PI * 2); ctx.fill();
    }
    return { x: cx, y: top, w: w };
  }

  // the jungle canopy (mid distance) with a waterfall cliff now and then, and the river
  function canopy(p, now) {
    var G = ground(), hor = skyAt(p, 2), speed = 0.35;
    var col = shadeMix([28, 92, 52], hor, 0.18);
    ctx.fillStyle = rgb(col);
    ctx.beginPath(); ctx.moveTo(-LEFT, G);
    for (var x = -LEFT; x <= W + 6; x += 6) {
      var wx = x + scene.x * speed;
      ctx.lineTo(x, G - H * 0.1 - (Math.abs(Math.sin(wx * 0.021)) * 0.6 + Math.abs(Math.sin(wx * 0.047 + 1)) * 0.4) * H * 0.09);
    }
    ctx.lineTo(W + 6, G); ctx.closePath(); ctx.fill();
    // waterfall cliff every ~1600 px of run
    var period = 1600, off = (scene.x * 0.5) % period, cx = W * 1.1 - off;
    for (var rep = 0; rep < 2; rep++, cx += period) {
      if (cx < -LEFT - 200 || cx > W + 200) continue;
      var cw = H * 0.32, ctop = G - H * 0.34;
      ctx.fillStyle = rgb(shadeMix([86, 98, 92], hor, 0.2));
      ctx.beginPath(); ctx.moveTo(cx - cw * 0.6, G); ctx.lineTo(cx - cw * 0.45, ctop + 10); ctx.lineTo(cx + cw * 0.45, ctop); ctx.lineTo(cx + cw * 0.62, G); ctx.fill();
      var fw = cw * 0.22, fg = ctx.createLinearGradient(0, ctop, 0, G);
      fg.addColorStop(0, 'rgba(210, 240, 255, 0.95)'); fg.addColorStop(1, 'rgba(160, 215, 255, 0.85)');
      ctx.fillStyle = fg; ctx.fillRect(cx - fw / 2, ctop + 4, fw, G - ctop - 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
      for (var l = 0; l < 4; l++) { var ly = ctop + ((now / 6 + l * 37) % (G - ctop)); ctx.beginPath(); ctx.moveTo(cx - fw / 2 + 3 + l * fw / 4, ly); ctx.lineTo(cx - fw / 2 + 3 + l * fw / 4, ly + 14); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(cx, G - H * 0.05, fw * 1.2, H * 0.025, 0, 0, Math.PI * 2); ctx.fill();
    }
    // river band with moving glints
    var rv = ctx.createLinearGradient(0, G - H * 0.065, 0, G - H * 0.02);
    rv.addColorStop(0, rgb(shadeMix([70, 170, 210], hor, 0.25))); rv.addColorStop(1, rgb(shadeMix([30, 110, 150], hor, 0.2)));
    ctx.fillStyle = rv; ctx.fillRect(-LEFT, G - H * 0.065, FULL_W, H * 0.045);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (var gx = -LEFT - ((scene.x * 0.8) % 60); gx < W; gx += 60) ctx.fillRect(gx, G - H * 0.05 + ((gx | 0) % 3) * 4, 16, 2);
  }

  // the trail the raptor runs on, with pebbles rushing by
  function path(p) {
    var G = ground(), dark = clamp01((p - 0.9) / 0.6);
    var pg = ctx.createLinearGradient(0, G - H * 0.025, 0, FULL_H - TOP);
    pg.addColorStop(0, rgb(shadeMix([150, 112, 62], [70, 40, 30], dark))); pg.addColorStop(1, rgb(shadeMix([92, 66, 36], [40, 22, 18], dark)));
    ctx.fillStyle = pg; ctx.fillRect(-LEFT, G - H * 0.025, FULL_W, FULL_H);
    ctx.fillStyle = rgb(shadeMix([86, 168, 60], [60, 70, 40], dark));
    for (var x = -LEFT - ((scene.x) % 14); x < W; x += 14) { ctx.beginPath(); ctx.moveTo(x, G - H * 0.02); ctx.lineTo(x + 5, G - H * 0.045); ctx.lineTo(x + 9, G - H * 0.02); ctx.fill(); }
    ctx.fillStyle = 'rgba(40, 26, 14, 0.5)';
    pebbles.forEach(function (pb) {
      var span = FULL_W + 40, x = (((pb.x * span - scene.x * 1.0) % span) + span) % span - LEFT - 20;
      ctx.beginPath(); ctx.ellipse(x, G + pb.y * H * 0.14, pb.r * 1.6, pb.r, 0, 0, Math.PI * 2); ctx.fill();
    });
  }

  // big ferns whipping past in the foreground (below the trail edge, never over the raptor)
  function foreground(p) {
    var G = ground(), span = FULL_W * 1.5, col = shadeMix([20, 70, 34], [12, 20, 16], clamp01((p - 0.9) / 0.6));
    ferns.forEach(function (f) {
      var x = (((f.x * span - scene.x * 1.7) % span) + span) % span - LEFT - FULL_W * 0.25;
      var y = G + H * 0.17, len = H * 0.22 * f.s;
      ctx.save(); ctx.translate(x, y); ctx.rotate(-0.9 + f.lean);
      ctx.strokeStyle = rgb(col); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -len * 0.1, len, len * 0.15); ctx.stroke();
      ctx.fillStyle = rgb(shadeMix(col, [40, 120, 50], f.tone * 0.5));
      for (var l = 1; l < 9; l++) {
        var t = l / 9, lx = len * t, ly = -len * 0.1 * Math.sin(t * Math.PI) + len * 0.15 * t * t, ll = len * 0.22 * (1 - t * 0.6);
        ctx.beginPath(); ctx.ellipse(lx, ly - ll * 0.5, ll * 0.18, ll * 0.55, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(lx, ly + ll * 0.5, ll * 0.18, ll * 0.55, 0.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });
  }

  // ash and embers drifting down once the volcano is awake
  function ashfall(p, now) {
    var a = clamp01((p - 0.85) / 0.4);
    if (a <= 0) return;
    ash.forEach(function (s) {
      var y = ((s.y * FULL_H + now * 0.03 * s.v) % FULL_H) - TOP, x = (((s.x * FULL_W - scene.x * 0.4 * s.v + Math.sin(now / 800 + s.ph) * 10) % FULL_W) + FULL_W) % FULL_W - LEFT;
      ctx.fillStyle = s.ember ? 'rgba(255, 150, 50,' + a + ')' : 'rgba(60, 50, 55,' + a * 0.7 + ')';
      ctx.fillRect(x, y, s.ember ? 2 : 3, s.ember ? 2 : 3);
    });
  }

  function drawWorld(dt, now, erupt) {
    scene.alt += (progress() - scene.alt) * Math.min(1, dt / 350);
    var p = scene.alt;
    if (S.phase === 'flying' && now - scene.startAt > ROAR_MS) {
      var ramp = clamp01((now - scene.startAt - ROAR_MS) / (START_MS - ROAR_MS));
      scene.x += H * 0.7 * (1 + p * 1.6) * ramp * dt / 1000;
    }
    drawSky(p, now);
    drawRidges(p);
    var v = volcano(p, now, erupt || 0);
    canopy(p, now);
    path(p);
    return v;
  }

  // ---- the raptor (side view, facing right; origin = between the feet on the ground) ----
  // pose: run 0..1 (cycle) or null, crouch 0..1, roar 0..1, tilt (radians), sink (0..1 into tar)
  function raptor(x, y, s, pose, now) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    if (pose.tilt) ctx.rotate(pose.tilt);
    var crouch = pose.crouch || 0, breathe = Math.sin(now / 420) * 1.5 * (pose.run == null ? 1 : 0);
    var hipY = -56 + crouch * 14 + breathe;
    var body = ctx.createLinearGradient(0, -90, 0, -40);
    body.addColorStop(0, '#5ec45a'); body.addColorStop(1, '#2f8a3a');
    // legs (back leg first)
    function leg(ph, front) {
      var sw = pose.run == null ? (front ? 0.15 : -0.15) : Math.sin(ph * Math.PI * 2) * 0.85;
      var lift = pose.run == null ? 0 : Math.max(0, Math.cos(ph * Math.PI * 2)) * 0.9;
      var th = 0.35 + sw - crouch * 0.4, kx = -4 + Math.sin(th) * 26, ky = hipY + Math.cos(th) * 26;
      var sh = th - 1.0 - lift, fx = kx + Math.sin(sh + 0.9) * 26, fy = ky + Math.cos(sh + 0.9) * 26;
      ctx.strokeStyle = front ? '#2f8a3a' : '#23662c'; ctx.lineWidth = front ? 11 : 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-4, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, Math.min(fy, 0)); ctx.stroke();
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(fx - 4, Math.min(fy, 0)); ctx.lineTo(fx + 12, Math.min(fy, 0)); ctx.stroke();
      ctx.fillStyle = '#f2f0dc'; ctx.beginPath(); ctx.moveTo(fx + 12, Math.min(fy, 0) - 2); ctx.lineTo(fx + 17, Math.min(fy, 0) + 1); ctx.lineTo(fx + 11, Math.min(fy, 0) + 2); ctx.fill();
    }
    var ph = pose.run == null ? 0 : pose.run;
    leg((ph + 0.5) % 1, false);
    // tail
    var sway = Math.sin(now / (pose.run == null ? 600 : 160)) * 6;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(-14, hipY - 18); ctx.quadraticCurveTo(-50, hipY - 22 + sway * 0.5, -88, hipY - 18 + sway);
    ctx.quadraticCurveTo(-50, hipY - 4 + sway * 0.5, -12, hipY + 4); ctx.closePath(); ctx.fill();
    // body + belly + stripes
    ctx.save(); ctx.translate(4, hipY - 8); ctx.rotate(pose.run == null ? -0.1 : -0.25);
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, 32, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d9f7a6'; ctx.beginPath(); ctx.ellipse(6, 8, 22, 8, 0, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = '#21602b'; ctx.lineWidth = 3.5;
    [-14, -2, 10].forEach(function (sx) { ctx.beginPath(); ctx.moveTo(sx, -17); ctx.quadraticCurveTo(sx + 5, -8, sx + 1, -2); ctx.stroke(); });
    ctx.restore();
    // neck + head (the head lifts and the jaw opens to roar)
    var roar = pose.roar || 0, hx = 40, hy = hipY - 34 - roar * 10 + breathe * 0.5;
    ctx.strokeStyle = '#3aa047'; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(20, hipY - 14); ctx.quadraticCurveTo(30, hipY - 22, hx - 6, hy + 4); ctx.stroke();
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(-roar * 0.35);
    ctx.fillStyle = '#4cb851';
    ctx.beginPath(); ctx.moveTo(-12, -10); ctx.quadraticCurveTo(10, -16, 30, -6); ctx.quadraticCurveTo(34, -1, 30, 2); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.rotate(roar * 0.55); // lower jaw
    ctx.fillStyle = '#3aa047'; ctx.beginPath(); ctx.moveTo(-8, 2); ctx.lineTo(28, 2); ctx.quadraticCurveTo(26, 9, 14, 10); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; for (var t = 0; t < 4; t++) { ctx.beginPath(); ctx.moveTo(4 + t * 6, 2); ctx.lineTo(7 + t * 6, -2); ctx.lineTo(10 + t * 6, 2); ctx.fill(); }
    ctx.restore();
    if (roar > 0.2) { ctx.fillStyle = '#7a1f2a'; ctx.beginPath(); ctx.moveTo(-4, 3); ctx.lineTo(26, 2); ctx.lineTo(10, 4 + roar * 6); ctx.fill(); }
    ctx.fillStyle = '#fff'; for (var u = 0; u < 4; u++) { ctx.beginPath(); ctx.moveTo(6 + u * 6, 2); ctx.lineTo(9 + u * 6, 6); ctx.lineTo(12 + u * 6, 2); ctx.fill(); }
    var blink = Math.floor(now / 140) % 31 === 0;
    ctx.fillStyle = '#ffd34a'; ctx.beginPath(); ctx.ellipse(6, -6, 5, blink ? 1 : 4, 0, 0, Math.PI * 2); ctx.fill();
    if (!blink) { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(5, -9, 2, 6); }
    ctx.strokeStyle = '#21602b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-2, -12); ctx.lineTo(12, -11); ctx.stroke();
    ctx.restore();
    // little arm, front leg
    ctx.strokeStyle = '#2f8a3a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(22, hipY - 6); ctx.lineTo(30, hipY + 2); ctx.lineTo(36, hipY - 2); ctx.stroke();
    leg(ph, true);
    ctx.restore();
  }

  // positions
  function spot() { return { x: W * 0.32, y: ground(), s: Math.max(0.55, H * 0.0032) }; }

  // the betting egg: cracks open as betting time runs out
  function egg(cx, cy, eh, p, now) {
    var ew = eh * 0.74, wob = Math.sin(now / (120 - p * 70)) * p * 0.06;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(wob);
    var g = ctx.createRadialGradient(-ew * 0.25, -eh * 0.25, 4, 0, 0, eh * 0.7);
    g.addColorStop(0, '#fffbe8'); g.addColorStop(1, '#d9cfa0');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -eh / 2);
    ctx.bezierCurveTo(ew * 0.62, -eh / 2, ew * 0.62, eh / 2, 0, eh / 2);
    ctx.bezierCurveTo(-ew * 0.62, eh / 2, -ew * 0.62, -eh / 2, 0, -eh / 2); ctx.fill();
    ctx.fillStyle = 'rgba(120, 140, 60, 0.55)';
    [[-0.2, -0.2, 6], [0.15, -0.05, 4], [-0.05, 0.2, 7], [0.22, 0.25, 4], [-0.25, 0.12, 3], [0.05, -0.32, 3]].forEach(function (d) { ctx.beginPath(); ctx.arc(d[0] * ew, d[1] * eh, d[2] * eh / 120, 0, Math.PI * 2); ctx.fill(); });
    var n = Math.floor(p * (crack.length - 1)), part = p * (crack.length - 1) - n;
    if (p > 0.02) {
      ctx.strokeStyle = '#4a3a1a'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(crack[0][0] * ew, crack[0][1] * eh);
      for (var k = 1; k <= n && k < crack.length; k++) ctx.lineTo(crack[k][0] * ew, crack[k][1] * eh);
      if (n + 1 < crack.length) ctx.lineTo(lerp(crack[n][0], crack[n + 1][0], part) * ew, lerp(crack[n][1], crack[n + 1][1], part) * eh);
      ctx.stroke();
    }
    ctx.restore();
  }

  function eggPlace() { var eh = Math.min(H * 0.32, 170); return { x: W * 0.64, y: H * 0.38, h: eh }; }

  function drawBetting(now) {
    var sp = spot();
    raptor(sp.x, sp.y, sp.s, { run: null, crouch: 0.6 }, now);
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var p = S.phase === 'betting' ? clamp01((Date.now() - S.bettingStartsAt) / total) : 0;
    var e = eggPlace();
    egg(e.x, e.y, e.h, p, now);
    var bw = e.h * 1.05, bh = Math.max(12, H * 0.04), bxp = e.x - bw / 2, by = e.y + e.h / 2 + H * 0.035;
    roundRect(bxp, by, bw, bh, bh / 2); ctx.fillStyle = 'rgba(10, 26, 14, 0.65)'; ctx.fill();
    if (p > 0) {
      roundRect(bxp + 3, by + 3, Math.max(bh - 6, (bw - 6) * p), bh - 6, (bh - 6) / 2);
      var gg = ctx.createLinearGradient(bxp, 0, bxp + bw, 0); gg.addColorStop(0, '#b6f24a'); gg.addColorStop(1, '#ffcf4a');
      ctx.fillStyle = gg; ctx.fill();
    }
    roundRect(bxp, by, bw, bh, bh / 2); ctx.lineWidth = 2; ctx.strokeStyle = '#f3fbe9'; ctx.stroke();
    if (S.phase === 'betting') {
      ctx.font = '800 ' + Math.round(Math.max(12, H * 0.04)) + 'px "Trebuchet MS", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10, 26, 14, 0.85)'; ctx.fillStyle = '#fff';
      var label = S.bettingPhrase.toUpperCase();
      ctx.strokeText(label, e.x, by + bh + H * 0.025);
      ctx.fillText(label, e.x, by + bh + H * 0.025);
    }
  }

  // dust puffs kicked up behind the running feet
  function dust(sp, now, k) {
    for (var d = 0; d < 6; d++) {
      var life = ((now / 420 + d / 6) % 1), x = sp.x - 30 * sp.s - life * W * 0.18, y = sp.y - life * H * 0.05;
      ctx.fillStyle = 'rgba(200, 170, 120,' + (0.45 * (1 - life) * k) + ')';
      ctx.beginPath(); ctx.arc(x, y, (6 + life * 16) * sp.s, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawFlight(now) {
    if (!scene.startAt) scene.startAt = now - START_MS; // joined mid-flight
    var t = now - scene.startAt, sp = spot();
    if (t < START_MS) {
      var e = eggPlace();
      if (t < ROAR_MS) { // the egg bursts, the raptor rises and roars
        var k = t / ROAR_MS;
        for (var n = 0; n < 9; n++) {
          var a = n / 9 * Math.PI * 2 - Math.PI / 2, r = k * H * 0.5;
          ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r + k * k * H * 0.4); ctx.rotate(k * 6 + n);
          ctx.fillStyle = '#f6efcf'; ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(12, -8); ctx.lineTo(6, 10); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        raptor(sp.x, sp.y, sp.s, { run: null, crouch: 0.6 * (1 - k), roar: Math.sin(k * Math.PI) }, now);
        return;
      }
    }
    var k2 = clamp01((t - ROAR_MS) / (START_MS - ROAR_MS));
    var cadence = 2.2 + scene.alt * 2.4; // strides per second (the footstep sound uses the same clock)
    var bob = Math.abs(Math.sin(scene.step * Math.PI)) * H * 0.012;
    dust(sp, now, k2);
    raptor(sp.x + k2 * W * 0.04, sp.y - bob, sp.s, { run: scene.step % 1, crouch: 0 }, now);
    return cadence;
  }

  // the end of the run: the volcano erupts (flash, shake, lava bombs); the raptor trips into a tar pit
  var bombs = [];
  function startEruption(v) {
    bombs = [];
    for (var i = 0; i < 18; i++) bombs.push({ vx: (Math.random() - 0.5) * 2.2, vy: -(1.4 + Math.random() * 1.6), r: 2 + Math.random() * 4, x: v.x, y: v.y });
  }
  function drawCrash(now, v) {
    var t = now - scene.crashAt, sp = spot();
    var k = clamp01(t / CRASH_MS), pitX = sp.x + W * 0.1, G = ground();
    // tar pit
    ctx.fillStyle = '#141018';
    ctx.beginPath(); ctx.ellipse(pitX, G + H * 0.01, W * 0.12 + H * 0.05, H * 0.035, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(80, 70, 100, 0.7)';
    for (var b = 0; b < 4; b++) { var bl = ((now / 700 + b / 4) % 1); ctx.beginPath(); ctx.arc(pitX - W * 0.08 + b * W * 0.05, G - bl * 6, 2 + bl * 3, 0, Math.PI * 2); ctx.fill(); }
    // the raptor: trips at TRIP_AT, tumbles forward into the tar and sinks
    var trip = clamp01((t - TRIP_AT) / 300), sink = clamp01((t - TRIP_AT - 250) / (CRASH_MS - TRIP_AT - 250));
    ctx.save();
    ctx.beginPath(); ctx.rect(-LEFT, -TOP, FULL_W, G + H * 0.012 + TOP); ctx.clip(); // under the tar surface it disappears
    raptor(sp.x + trip * W * 0.1, G + sink * H * 0.22, sp.s, { run: t < TRIP_AT ? (now / 300) % 1 : null, crouch: 0, roar: trip * 0.8, tilt: trip * 0.6 }, now);
    ctx.restore();
    // lava bombs arcing out of the volcano
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    bombs.forEach(function (bm) {
      var tt = t / 1000, x = bm.x + bm.vx * tt * H * 0.5, y = bm.y + (bm.vy * tt + 1.6 * tt * tt) * H * 0.5;
      ctx.fillStyle = 'rgba(255, 140, 40,' + (1 - k) + ')';
      ctx.beginPath(); ctx.arc(x, y, bm.r * (H / 400), 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
    // eruption flash
    var fl = Math.max(0, 1 - t / 500);
    if (fl > 0) { ctx.fillStyle = 'rgba(255, 150, 60,' + fl * 0.45 + ')'; ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H); }
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0;
  function themeColour() {
    var c = skyAt(scene.alt, 1);
    if (S.phase !== 'flying') c = c.map(function (v) { return Math.round(v * 0.85); });
    return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  var lastVolcano = { x: 0, y: 0, w: 0 };
  function frame(now) {
    if (now - themeAt > 400) { themeAt = now; game.theme(themeColour()); }
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    if (W && H) {
      ctx.save();
      // the eruption shakes the screen for half a second
      var shake = S.phase === 'crashed' ? Math.max(0, 1 - (now - scene.crashAt) / 500) * H * 0.012 : 0;
      ctx.translate(LEFT + (Math.random() - 0.5) * shake, TOP + (Math.random() - 0.5) * shake); // play-area coordinates; the world also fills above / to the left
      ctx.clearRect(-LEFT - 20, -TOP - 20, FULL_W + 40, FULL_H + 40);
      var erupt = S.phase === 'crashed' ? Math.max(0, 1 - (now - scene.crashAt) / 1500) : 0;
      lastVolcano = drawWorld(dt, now, erupt);
      if (S.phase !== 'flying') { // softer light between rounds
        ctx.fillStyle = 'rgba(10, 24, 14, 0.18)';
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      }
      if (S.phase === 'betting' || S.phase === 'waiting') drawBetting(now);
      else if (S.phase === 'flying') {
        var cadence = drawFlight(now);
        if (cadence) { // strides: the run cycle and the footstep sound share one clock
          scene.step += cadence * dt / 1000;
          if (Math.floor(scene.step * 2) > scene.lastStep) { scene.lastStep = Math.floor(scene.step * 2); play('step'); }
        }
      } else if (S.phase === 'crashed') drawCrash(now, lastVolcano);
      ashfall(scene.alt, now);
      foreground(scene.alt);
      ctx.restore();
    }
    // texts over the scene
    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden && flew.textContent !== S.crashPhrase) flew.textContent = S.crashPhrase;
    if (S.phase === 'flying') {
      mult.className = 'mult'; mult.textContent = game.currentMult().toFixed(2) + 'x'; hint.textContent = '';
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      mult.className = 'mult mult--crashed'; mult.textContent = S.crashPoint.toFixed(2) + 'x'; hint.textContent = '';
    } else if (S.phase === 'betting') {
      mult.textContent = ''; hint.textContent = '';
    } else {
      mult.textContent = ''; hint.textContent = S.gotSnapshot ? 'Waiting for the next round…' : 'Connecting…';
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- controls
  function setAmount(p, v) {
    var l = game.limit();
    v = Math.max(l.min, game.round2(v));
    if (l.max) v = Math.min(l.max, v);
    p.amount.value = v.toFixed(2);
    updateButton(p);
  }
  function buildQuick(p) { // 1×, 2×, 5×, 10× the min bet (within the max)
    var l = game.limit();
    p.quick.innerHTML = '';
    [1, 2, 5, 10].forEach(function (k) {
      var v = game.round2(l.min * k);
      if (l.max && v > l.max) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = game.money(v).replace(/\.00$/, '');
      b.onclick = function () { play('click'); setAmount(p, v); };
      p.quick.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { panels.forEach(function (p) { buildQuick(p); setAmount(p, l.min); }); });

  panels.forEach(function (p) {
    Array.prototype.forEach.call(p.el.querySelectorAll('.stepper__btn'), function (b) {
      b.onclick = function () { play('click'); setAmount(p, readAmount(p) + Number(b.dataset.step) * game.limit().min); };
    });
    p.amount.oninput = function () { updateButton(p); };
    p.amount.onblur = function () { setAmount(p, readAmount(p) || game.limit().min); };
    p.action.onclick = function () {
      play('click');
      if (S.queued[p.slot]) return game.cancelQueued(p.slot);
      var my = S.my[p.slot];
      if (my && my.round === S.round && my.status === 'placed' && S.phase === 'flying') return game.cashOut(p.slot);
      if (my && my.round === S.round && my.status !== 'lost' && my.status !== 'cashed') return;
      game.bet(p.slot, readAmount(p), readAuto(p));
    };
  });

  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); play('click'); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem(KEY + '-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    unlock();
    syncMusic();
  };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      play('click');
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      renderList();
    };
  });

  setSound(soundOn);
  unlock(); // try right away (allowed when the game was opened by a tap)
  syncMusic();
  window.addEventListener('resize', fit);
  // The results row fills in after load (and the bets list / bar can change size): refit.
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
