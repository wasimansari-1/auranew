/* Moto Jump — an original NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is
 * the look, all drawn in code: a stunt rider revs at the top of a desert canyon while the
 * tachometer climbs to the red line (the betting time), blasts up the kicker ramp and flies out
 * over a canyon that keeps getting wider — backflips, superman, no-hander, heel-clicker — as the
 * camera climbs from the golden desert past the city lights on the horizon up to the moon.
 * The round ends when the bike lands short and drops into the canyon in a cloud of dust.
 * Sounds and music are generated (WebAudio). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var GAME_ID = '88.0050';
  var game = NXCrash.start({ event: GAME_ID, onChange: render, onSignal: onSignal });
  var S = game.S;
  var KEY = 'motojump';

  // Everything is drawn in code: ready once the live round state has arrived.
  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 10000); // never hang the loader

  // ---------------------------------------------------------------- timings (sound = animation)
  var LAUNCH_AT = 850; // the bike rides up the ramp and leaves the lip (the rev-up sound lasts as long)
  var START_MS = 1300; // …then flies out to its cruise spot (the launch whoosh ends here)
  var CRASH_MS = 1500; // the bike drops into the canyon and the dust rises (the crash sound lasts as long)
  var IMPACT_AT = 620; // the bike hits the canyon floor (ms into the crash)
  var TRICK_MS = 1100; // one stunt (its whoosh lasts as long)
  var TRICK_EVERY = 3300; // a new stunt every …
  var BLIP_MS = 360; // a throttle blip while bets are open (sound and bike shake)
  var METRES_PER_S = 26; // jump distance shown under the multiplier

  // ---------------------------------------------------------------- sound (WebAudio, generated)
  var AC = window.AudioContext || window.webkitAudioContext;
  var ac = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  function audio() {
    if (ac || !AC) return ac;
    try {
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      var d = noiseBuf.getChannelData(0), b = 0;
      for (var i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = (Math.random() * 2 - 1) * 0.55 + b * 2.2; }
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
    return o;
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
  }
  var soundOn = true;
  try { soundOn = localStorage.getItem(KEY + '-sound') !== 'off'; } catch (e) { /* default on */ }
  var SFX = {
    click: function (t) { tone('square', 1300, t, 0.035, 0.05); tone('triangle', 700, t, 0.05, 0.08); },
    // throttle blip while bets are open (BLIP_MS = the bike's shake)
    blip: function (t) {
      var d = BLIP_MS / 1000;
      tone('sawtooth', 80, t, d * 0.5, 0.12, 190);
      tone('sawtooth', 190, t + d * 0.5, d * 0.5, 0.1, 85);
      noise(t, d, 0.12, 'lowpass', 700, 300, 0.02);
    },
    // rev-up along the ramp until LAUNCH_AT, then the launch whoosh until START_MS (= the animation)
    start: function (t) {
      var l = LAUNCH_AT / 1000, s = START_MS / 1000;
      tone('sawtooth', 70, t, l, 0.16, 260);
      tone('square', 35, t, l, 0.08, 130);
      noise(t, l, 0.18, 'lowpass', 500, 2200, 0.05);
      noise(t + l, s - l, 0.32, 'bandpass', 600, 2600, 0.03);
      tone('sine', 300, t + l, s - l, 0.12, 900);
    },
    // a stunt: an airy whoosh for TRICK_MS
    trick: function (t) {
      var d = TRICK_MS / 1000;
      noise(t, d, 0.16, 'bandpass', 500, 1800, d * 0.45);
      tone('sine', 520, t + d * 0.2, d * 0.6, 0.04, 780);
    },
    cashout: function (t) {
      [784, 988, 1175, 1568].forEach(function (f, i) { tone('triangle', f, t + i * 0.07, 0.24, 0.2); tone('sine', f * 2, t + i * 0.07, 0.1, 0.05); });
      noise(t, 0.35, 0.1, 'highpass', 3000, 7000, 0.01);
    },
    // the fall (whistle) until IMPACT_AT, the thud and the dust until CRASH_MS (= the animation)
    crash: function (t) {
      var c = CRASH_MS / 1000, hit = IMPACT_AT / 1000;
      tone('sine', 1100, t, hit, 0.1, 260);
      noise(t, hit, 0.14, 'bandpass', 1400, 400, hit * 0.6);
      tone('sine', 95, t + hit, c - hit, 0.85, 30);
      tone('square', 60, t + hit, 0.18, 0.18, 30);
      noise(t + hit, 0.22, 0.5, 'bandpass', 900, 220, 0.005);
      noise(t + hit, c - hit, 0.32, 'lowpass', 1200, 160, 0.03);
    },
  };
  function play(name) {
    if (!soundOn || !audio() || ac.state !== 'running' || !SFX[name]) return;
    SFX[name](ac.currentTime + 0.01);
  }

  // The engine while the bike flies: two buzzing oscillators, pitch follows the multiplier.
  var engine = null;
  function engineOn() {
    if (engine || !soundOn || !audio() || ac.state !== 'running') return;
    var t = ac.currentTime;
    var o1 = ac.createOscillator(), o2 = ac.createOscillator(), lfo = ac.createOscillator();
    var f = ac.createBiquadFilter(), g = ac.createGain(), am = ac.createGain(), lg = ac.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; lfo.type = 'sine';
    o1.frequency.value = 120; o2.frequency.value = 60; lfo.frequency.value = 21;
    f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 2;
    am.gain.value = 0.75; lg.gain.value = 0.25;
    lfo.connect(lg); lg.connect(am.gain);
    o1.connect(f); o2.connect(f); f.connect(am); am.connect(g); g.connect(sfxBus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.25);
    o1.start(t); o2.start(t); lfo.start(t);
    engine = { o1: o1, o2: o2, lfo: lfo, f: f, g: g };
  }
  function engineOff() {
    if (!engine) return;
    var e = engine, t = ac.currentTime;
    engine = null;
    e.g.gain.cancelScheduledValues(t);
    e.g.gain.setTargetAtTime(0.0001, t, 0.06);
    [e.o1, e.o2, e.lfo].forEach(function (o) { try { o.stop(t + 0.4); } catch (err) { /* stopped */ } });
  }
  function engineFollow(mult) {
    if (!engine) return;
    var t = ac.currentTime, base = 110 + 70 * Math.log(mult);
    engine.o1.frequency.setTargetAtTime(base, t, 0.15);
    engine.o2.frequency.setTargetAtTime(base / 2, t, 0.15);
    engine.f.frequency.setTargetAtTime(800 + 300 * Math.log(mult), t, 0.2);
  }

  // Background music: a desert-rock groove (generated, looped by a small scheduler).
  var musicOn = true;
  try { musicOn = localStorage.getItem(KEY + '-music') !== 'off'; } catch (e) { /* default on */ }
  var BPM = 124, STEP = 60 / BPM / 4, nextNote = 0, stepN = 0, musicTimer = null;
  var BASS = [82.41, 82.41, 98, 82.41, 110, 98, 82.41, 73.42]; // E minor riff, one note per 8th
  var LEAD = [329.63, 392, 440, 493.88, 587.33, 659.25];
  function scheduleMusic() {
    if (!ac) return;
    while (nextNote < ac.currentTime + 0.25) {
      var s = stepN % 16, bar = Math.floor(stepN / 16) % 4, t = nextNote;
      if (s === 0 || s === 8 || s === 10) tone('sine', 120, t, 0.16, 0.5, 45, musicBus); // kick
      if (s === 4 || s === 12) { noise(t, 0.12, 0.22, 'highpass', 1800, 0, 0.003, musicBus); tone('triangle', 190, t, 0.08, 0.12, 140, musicBus); } // snare
      if (s % 2 === 0) noise(t, s % 4 === 2 ? 0.08 : 0.03, 0.05, 'highpass', 7000, 0, 0.002, musicBus); // hats
      if (s % 2 === 0) tone('sawtooth', BASS[(s / 2) % 8] * (bar === 3 && s >= 8 ? 1.335 : 1), t, STEP * 1.7, 0.07, 0, musicBus); // bass
      if (bar % 2 === 1 && (s === 3 || s === 6 || s === 11 || s === 14)) tone('square', LEAD[(stepN + bar * 3) % LEAD.length], t, STEP * 1.5, 0.025, 0, musicBus);
      nextNote += STEP; stepN++;
    }
  }
  function syncMusic() {
    var on = musicOn && audio() && ac.state === 'running';
    if (on && !musicTimer) { nextNote = ac.currentTime + 0.05; musicTimer = setInterval(scheduleMusic, 80); }
    if (!on && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.2 : 0, ac.currentTime, 0.1);
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  // Starts as the game opens (the tap that opened it allows sound); else on the first tap here.
  function unlock() {
    if (!audio()) return;
    if (ac.state !== 'running') ac.resume().then(afterUnlock, function () {});
    else afterUnlock();
  }
  function afterUnlock() {
    syncMusic();
    if (S.phase === 'flying' && Date.now() - S.flightStart > LAUNCH_AT) engineOn();
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
    if (!on) engineOff(); else if (S.phase === 'flying' && Date.now() - S.flightStart > LAUNCH_AT) engineOn();
  }

  // ---------------------------------------------------------------- engine moments
  var scene = {
    alt: 0, scroll: 0, v: 0, lastT: 0, wheel: 0,
    crashAt: 0, crashFrom: null, crashDist: 0, impactDone: false,
    cutAt: 0, shakeAt: 0, revAt: 0, lastSec: -1, trickN: -1, smokeAt: 0,
  };
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') {
      scene.crashAt = 0; scene.trickN = -1;
      // round.start → the ramp run plays (sound with it); joined mid-flight → straight to the engine
      setTimeout(function () {
        var t = Date.now() - S.flightStart;
        if (t < 400) { play('start'); setTimeout(function () { if (S.phase === 'flying') engineOn(); }, Math.max(0, LAUNCH_AT - t)); }
        else engineOn();
      }, 0);
    }
    if (name === 'crash') {
      scene.crashAt = now; scene.impactDone = false;
      scene.crashFrom = S.flightStart ? bikeAt(now, Date.now() - S.flightStart) : null;
      scene.crashDist = S.flightStart ? Math.max(0, (Date.now() - S.flightStart) / 1000 * METRES_PER_S) : 0;
      engineOff(); play('crash');
    }
    if (name === 'betting') { scene.cutAt = now; scene.crashAt = 0; scene.crashFrom = null; scene.scroll = 0; scene.v = 0; scene.alt = 0; scene.lastSec = -1; engineOff(); }
    if (name === 'win') { play('cashout'); toast(d.text, 'win'); burst('win'); }
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

  // ---------------------------------------------------------------- DOM render
  var tab = 'all';
  function hue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return (h % 12) * 30;
  }
  // A rider's helmet on their own colour (bets list and players strip).
  function playerFace(name) {
    var av = document.createElement('i');
    av.className = 'avatar';
    av.style.setProperty('--h', hue(name));
    return av;
  }
  // Players in this round, on the scene (../_core/players.js), with this game's helmet faces.
  var playersStrip;

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
      s.className = 'chip' + (c >= 10 ? ' chip--big' : c >= 2 ? ' chip--mid' : '');
      s.textContent = c.toFixed(2) + 'x';
      h.appendChild(s);
    });

    updateButtons();
    renderList();

    $('fRound').textContent = S.round || '—';
    $('fHash').textContent = S.hash || '—';
    $('fSeed').textContent = S.seed || 'revealed when the round ends';
  }

  // ---- bet consoles (slot 0 and 1): built once, only texts / classes change ----------
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="panel__body">' +
      '<div class="panel__controls">' +
      '<div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<input class="amount" inputmode="decimal" value="' + game.limit().min.toFixed(2) + '" aria-label="Bet amount">' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '</div>' +
      '<button type="button" class="action"><span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      '</div>' +
      '<div class="auto"><span class="auto__label">Auto cash out</span><div class="auto__ctl">' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label>' +
      '<input class="auto__x" inputmode="decimal" value="2.00" aria-label="Auto cash-out multiplier"></div></div>';
    $('panels').appendChild(el);
    var q = function (sel) { return el.querySelector(sel); };
    return { slot: slot, el: el, amount: q('.amount'), action: q('.action'), label: q('.action__label'), sub: q('.action__sub'), autoOn: q('.auto__on'), autoAt: q('.auto__x'), quick: q('.quick'), quickBtns: [] };
  });
  // Phone: one bet console only; wide screens show both.

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
    var amt = readAmount(p);
    p.quickBtns.forEach(function (b) { var on = Math.abs(Number(b.dataset.v) - amt) < 0.001; if (b.classList.contains('is-on') !== on) b.classList.toggle('is-on', on); });
  }

  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }
  var lastCols = '';
  function setCols(html) { if (lastCols !== html) { lastCols = html; $('cols').innerHTML = html; } }

  function renderList() {
    var list = $('list');
    list.innerHTML = '';
    if (tab === 'all') {
      setText($('countLabel'), 'Riders this round');
      setText($('betCount'), String(S.bets.length));
      setCols('<span>User</span><span>Bet</span><span>X</span><span>Cash out</span>');
      if (!S.bets.length) list.appendChild(cell('No riders yet this round.', 'empty'));
      S.bets.slice().reverse().forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--cashed' : '') + (b.mine ? ' row--mine' : '');
        var user = document.createElement('span');
        user.className = 'row__user';
        user.appendChild(playerFace(b.player));
        user.appendChild(cell(b.player));
        row.appendChild(user);
        row.appendChild(cell(Number(b.amount).toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '-', 'row__x'));
        row.appendChild(cell(b.win ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      setText($('countLabel'), 'My bets');
      setText($('betCount'), String(S.myBets.length));
      setCols('<span>Time</span><span>Bet</span><span>X</span><span>Cash out</span>');
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

  // ---------------------------------------------------------------- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function smooth(e0, e1, x) { var k = clamp((x - e0) / (e1 - e0), 0, 1); return k * k * (3 - 2 * k); }
  function ease(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }
  function easeInOut(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function mixC(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function rgb(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')'; }
  function rng(seed) { // small seeded random (mulberry32): the same scenery every time
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- scene (canvas)
  var canvas = $('scene');
  var stageEl = document.querySelector('.stage');
  var ctx = canvas.getContext('2d');
  var DPR = 1;
  var W = 0, H = 0; // the play area (clear part of the scene)
  var TOP = 0, LEFT = 0, FULL_W = 0, FULL_H = 0; // the scene runs under the bar / behind the list
  var SC = 1; // bike scale
  var tilesKey = '';

  function fit() {
    var r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    FULL_W = r.width; FULL_H = r.height;
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    W = FULL_W - LEFT;
    stageEl.style.setProperty('--left', LEFT + 'px');
    var bar = document.querySelector('.top').getBoundingClientRect();
    TOP = Math.max(0, bar.bottom - r.top + 6);
    // The results row (and on wide screens the consoles) float over the scene's lower part,
    // so the play area ends just above the results row.
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(140, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // The multiplier / round texts are centred on the play area (not the whole scene).
    var centre = document.querySelector('.stage__center').style;
    centre.left = LEFT + 'px'; centre.top = TOP + 'px'; centre.width = W + 'px'; centre.height = H + 'px';
    centre.paddingTop = Math.round(H * 0.1) + 'px';
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a player joins the round).
    var bufW = Math.round(FULL_W * DPR), bufH = Math.round(FULL_H * DPR);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    SC = clamp(Math.min(H / 330, W / 380), 0.75, 2.1);
    var key = [Math.round(FULL_W), Math.round(H), DPR].join(':');
    if (key !== tilesKey) { tilesKey = key; buildScenery(); }
  }

  // ---- scenery, drawn once per size into seamless tiles --------------------------------
  // Every profile is a sum of sines with whole-number periods, so a tile's ends meet exactly.
  var T = {}; // tiles: far mesas, city, mid canyon walls, near spires (each a day + a night copy)
  var moonTex = null, stars = [], clouds = [], streaks = [];
  function wave(u, parts) {
    var v = 0;
    for (var i = 0; i < parts.length; i++) v += parts[i][0] * Math.sin(TAU * parts[i][1] * u + parts[i][2]);
    return v;
  }
  function sig(v) { return 1 / (1 + Math.exp(-v)); }

  function tile(w, h, prof, paint) {
    var c = document.createElement('canvas');
    c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
    var g = c.getContext('2d');
    g.scale(DPR, DPR);
    var top = function () {
      g.moveTo(0, prof(0));
      for (var x = 2; x < w; x += 2) g.lineTo(x, prof(x / w));
      g.lineTo(w, prof(1));
    };
    paint(g, w, h, top);
    return { c: c, w: w, h: h };
  }
  function rockPaint(cTop, cBot, strata, rim, seed) {
    return function (g, w, h, top) {
      g.beginPath(); top(); g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      var gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, rgb(cTop)); gr.addColorStop(1, rgb(cBot));
      g.fillStyle = gr; g.fill();
      if (strata) { // horizontal rock layers
        g.save(); g.clip();
        var r = rng(seed), y = 0;
        while (y < h) {
          var bh = 3 + r() * 9;
          g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,' + (strata * (0.4 + r() * 0.6)) + ')' : 'rgba(0,0,0,' + (strata * (0.5 + r() * 0.8)) + ')';
          g.fillRect(0, y, w, bh * 0.6);
          y += bh;
        }
        g.restore();
      }
      if (rim) { g.beginPath(); top(); g.lineWidth = 1.6; g.strokeStyle = rim; g.stroke(); }
    };
  }

  function buildScenery() {
    var u = H / 360;
    // far mesas: flat tops, steep sides (a sigmoid of a wave)
    var fw = Math.round(Math.max(700, FULL_W * 1.3)), fh = H * 0.36;
    var farProf = function (x) {
      var m = sig(wave(x, [[0.55, 2, 1.3], [0.3, 5, 0.4], [0.15, 11, 2.1]]) * 9);
      return fh * (0.92 - 0.62 * m) + fh * 0.012 * Math.sin(TAU * 37 * x);
    };
    T.farDay = tile(fw, fh, farProf, rockPaint([226, 150, 120], [182, 100, 88], 0.03, 'rgba(255,214,170,0.55)', 3));
    T.farNight = tile(fw, fh, farProf, rockPaint([54, 46, 96], [30, 26, 62], 0.02, 'rgba(140,130,220,0.12)', 3));
    // mid canyon walls: striated red rock
    var mw = Math.round(Math.max(800, FULL_W * 1.15)), mh = H * 0.55;
    var midProf = function (x) {
      var m = sig(wave(x, [[0.5, 3, 0.7], [0.3, 7, 2.0], [0.2, 13, 1.1]]) * 6);
      return mh * (0.85 - 0.55 * m) + mh * 0.01 * Math.sin(TAU * 53 * x) + mh * 0.008 * Math.sin(TAU * 29 * x + 1);
    };
    T.midDay = tile(mw, mh, midProf, rockPaint([214, 98, 54], [118, 42, 30], 0.07, 'rgba(255,196,140,0.8)', 7));
    T.midNight = tile(mw, mh, midProf, rockPaint([70, 42, 82], [32, 22, 50], 0.05, 'rgba(160,120,200,0.5)', 7));
    // near canyon spires (seen through the gap, far below the rims)
    var nw = Math.round(Math.max(700, FULL_W * 0.95)), nh = H * 0.7;
    var nearProf = function (x) {
      var m = sig(wave(x, [[0.6, 4, 0.2], [0.25, 9, 1.7], [0.15, 19, 0.9]]) * 5);
      return nh * (0.95 - 0.55 * m) + nh * 0.01 * Math.sin(TAU * 61 * x);
    };
    T.nearDay = tile(nw, nh, nearProf, rockPaint([168, 64, 38], [64, 22, 18], 0.08, 'rgba(255,170,110,0.6)', 11));
    T.nearNight = tile(nw, nh, nearProf, rockPaint([40, 24, 54], [14, 9, 24], 0.05, 'rgba(140,100,190,0.4)', 11));
    // the city on the horizon: towers with lit windows (shows as the sky darkens)
    var cw = Math.round(Math.max(700, FULL_W)), ch = H * 0.24;
    T.city = (function () {
      var c = document.createElement('canvas');
      c.width = Math.ceil(cw * DPR); c.height = Math.ceil(ch * DPR);
      var g = c.getContext('2d'), r = rng(42), x = 0;
      g.scale(DPR, DPR);
      while (x < cw) {
        var bw = (12 + r() * 26) * u;
        if (x + bw > cw - 10 * u) bw = cw - x;
        var tall = r() < 0.12, bh = ch * (tall ? 0.8 + r() * 0.18 : 0.2 + r() * 0.5);
        g.fillStyle = 'rgb(' + (20 + r() * 10) + ',' + (16 + r() * 8) + ',' + (40 + r() * 14) + ')';
        g.fillRect(x, ch - bh, bw, bh);
        if (tall) { // spire + aviation light
          g.fillRect(x + bw / 2 - 0.8, ch - bh - 10 * u, 1.6, 10 * u);
          g.fillStyle = '#ff4b4b'; g.beginPath(); g.arc(x + bw / 2, ch - bh - 10 * u, 1.6 * u, 0, TAU); g.fill();
        }
        for (var wy = ch - bh + 3 * u; wy < ch - 2 * u; wy += 5 * u) {
          for (var wx = x + 2 * u; wx < x + bw - 2.5 * u; wx += 4.5 * u) {
            if (r() < 0.42) {
              var k = r();
              g.fillStyle = k < 0.7 ? 'rgba(255,214,120,0.95)' : k < 0.92 ? 'rgba(255,244,214,0.9)' : 'rgba(120,236,224,0.9)';
              g.fillRect(wx, wy, 1.8 * u, 2.4 * u);
            }
          }
        }
        x += bw + (r() < 0.3 ? 3 * u : 0);
      }
      return { c: c, w: cw, h: ch };
    })();
    // the moon (craters drawn once)
    if (!moonTex) {
      moonTex = document.createElement('canvas');
      moonTex.width = moonTex.height = 256;
      var m = moonTex.getContext('2d'), mr = rng(9);
      var mg = m.createRadialGradient(100, 96, 10, 128, 128, 128);
      mg.addColorStop(0, '#fbf6e8'); mg.addColorStop(0.7, '#ddd6c8'); mg.addColorStop(1, '#b9b2a8');
      m.fillStyle = mg; m.beginPath(); m.arc(128, 128, 127, 0, TAU); m.fill();
      m.save(); m.beginPath(); m.arc(128, 128, 127, 0, TAU); m.clip();
      [[90, 110, 46, 30], [160, 80, 34, 24], [150, 170, 50, 34], [70, 180, 26, 18]].forEach(function (b) {
        m.fillStyle = 'rgba(128,124,136,0.32)';
        m.beginPath(); m.ellipse(b[0], b[1], b[2], b[3], mr() * 3, 0, TAU); m.fill();
      });
      for (var i = 0; i < 30; i++) {
        var cx = mr() * 256, cy = mr() * 256, cr = 3 + mr() * mr() * 22;
        m.fillStyle = 'rgba(90,84,96,0.28)'; m.beginPath(); m.arc(cx, cy, cr, 0, TAU); m.fill();
        m.strokeStyle = 'rgba(255,255,255,0.35)'; m.lineWidth = 1.4; m.beginPath(); m.arc(cx + 0.8, cy + 0.8, cr, Math.PI * 0.1, Math.PI * 0.9); m.stroke();
      }
      var sh = m.createLinearGradient(40, 40, 256, 256);
      sh.addColorStop(0, 'rgba(0,0,30,0)'); sh.addColorStop(1, 'rgba(10,10,40,0.35)');
      m.fillStyle = sh; m.fillRect(0, 0, 256, 256);
      m.restore();
    }
    var sr = rng(5);
    stars = [];
    for (var s = 0; s < 120; s++) stars.push({ x: sr(), y: sr() * 0.85, r: 0.5 + sr() * 1.4, t: sr() * 6 });
    clouds = [];
    for (var c = 0; c < 10; c++) clouds.push({ x: sr(), y: 0.25 + sr() * 1.9, s: 0.6 + sr() * 0.9, v: 0.4 + sr() * 0.5 });
    streaks = [];
    for (var k = 0; k < 16; k++) streaks.push({ x: sr(), y: 0.08 + sr() * 0.84, l: 0.4 + sr() * 0.8 });
  }

  // ---- the sky: golden desert → dusk with the city lights → night with the moon ---------
  var SKY = [ // [top, horizon]
    [[74, 120, 196], [255, 184, 122]],
    [[44, 32, 96], [236, 104, 92]],
    [[6, 7, 26], [30, 30, 76]],
  ];
  function skyAt(i, alt) {
    var st = alt < 0.5 ? 0 : 1, k = alt < 0.5 ? alt / 0.5 : (alt - 0.5) / 0.5;
    return mixC(SKY[st][i], SKY[st + 1][i], smooth(0, 1, k));
  }
  function climb() { // 0 on the rim … 1 at about 12x
    if (S.phase === 'flying') return clamp(Math.log(Math.max(1, game.currentMult())) / Math.log(12), 0, 1);
    if (S.phase === 'crashed') return clamp(Math.log(Math.max(1, S.crashPoint)) / Math.log(12), 0, 1);
    return 0;
  }

  // Draws a scenery tile row (x0: scroll in px), plus solid colour below it down to the bottom.
  function tileRow(day, night, nk, x0, y, bottomDay, bottomNight) {
    var w = day.w, x;
    var sx = -(((x0 % w) + w) % w) - LEFT;
    for (x = sx; x < W; x += w) ctx.drawImage(day.c, x, y, w, day.h);
    if (nk > 0.01) {
      ctx.globalAlpha = nk;
      for (x = sx; x < W; x += w) ctx.drawImage(night.c, x, y, w, night.h);
      ctx.globalAlpha = 1;
    }
    var by = y + day.h - 0.5;
    if (by < FULL_H - TOP) { ctx.fillStyle = rgb(mixC(bottomDay, bottomNight, nk)); ctx.fillRect(-LEFT, by, FULL_W, FULL_H - TOP - by + 1); }
  }

  function cloud(x, y, s, alpha, lit, shade) {
    ctx.save();
    ctx.globalAlpha = alpha;
    var g = ctx.createLinearGradient(0, y - 26 * s, 0, y + 16 * s);
    g.addColorStop(0, rgb(lit)); g.addColorStop(1, rgb(shade));
    ctx.fillStyle = g;
    [[0, 0, 1, 0.55], [-0.7, 0.18, 0.75, 0.42], [0.75, 0.15, 0.8, 0.45], [-0.25, -0.22, 0.6, 0.5], [0.3, -0.18, 0.55, 0.5], [1.3, 0.25, 0.5, 0.3]].forEach(function (b) {
      ctx.beginPath();
      ctx.ellipse(x + b[0] * 62 * s, y + b[1] * 30 * s, 52 * s * b[2], 40 * s * b[3], 0, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  // ---- layout of the rim, the ramp and the far side (play-area px) --------------------
  function layout() {
    var s = SC;
    var lipX = Math.max(W * 0.44 + 6 * s, 20 + 180 * s);
    var rampStart = lipX - 82 * s;
    return {
      s: s,
      groundY: H * 0.8,
      lipX: lipX,
      rampStart: rampStart,
      rampH: 30 * s,
      bikeX: rampStart - 52 * s,
      farX: Math.max(lipX + W * 0.3, W * 0.8),
      cruiseX: W * 0.44,
      cruiseY: H * 0.63,
    };
  }
  function rampHeight(L, x) { // the kicker's curved deck
    var k = clamp((x - L.rampStart) / (L.lipX - L.rampStart), 0, 1);
    return L.rampH * Math.pow(k, 1.6);
  }
  function rampSlope(L, x) {
    var k = clamp((x - L.rampStart) / (L.lipX - L.rampStart), 0, 1);
    return L.rampH * 1.6 * Math.pow(k, 0.6) / (L.lipX - L.rampStart);
  }

  // Where the bike is (x, y = between the axles, ang, plus the stunt) t ms into the round.
  function bikeAt(now, t) {
    var L = layout(), s = L.s, R = 15 * s;
    if (t < LAUNCH_AT) { // full throttle along the rim and up the ramp
      var u = Math.pow(t / LAUNCH_AT, 1.7);
      var x = lerp(L.bikeX, L.lipX, u);
      var h = rampHeight(L, x);
      return { x: x, y: L.groundY - h - R, ang: -Math.atan(rampSlope(L, x)) * 0.9, trick: null, k: 0, ground: h === 0 };
    }
    var lipY = L.groundY - L.rampH - R, launchAng = -Math.atan(rampSlope(L, L.lipX)) * 0.9;
    var cx = L.cruiseX + Math.sin(now / 1700) * W * 0.015, cy = L.cruiseY + Math.sin(now / 600) * H * 0.014;
    var cang = -0.1 + Math.sin(now / 900) * 0.05;
    if (t < START_MS) { // flies out to the cruise spot
      var k = ease((t - LAUNCH_AT) / (START_MS - LAUNCH_AT));
      return { x: lerp(L.lipX, cx, k), y: lerp(lipY, cy, k) - Math.sin(Math.PI * k) * H * 0.06, ang: lerp(launchAng, cang, k), trick: null, k: 0 };
    }
    // stunts, one after another
    var tt = t - START_MS - 700, n = Math.floor(tt / TRICK_EVERY), ph = tt - n * TRICK_EVERY;
    var trick = null, tk = 0;
    if (tt > 0 && ph < TRICK_MS) { trick = TRICKS[n % TRICKS.length]; tk = ph / TRICK_MS; }
    return { x: cx, y: cy, ang: cang, trick: trick, k: tk, n: n };
  }

  // ---- the rider: jointed, posed in code ---------------------------------------------
  // Bike-local coordinates (1 = 1px at scale 1): axles at (-32, 0) and (32, 0), wheel radius 15.
  var POSE = {
    ride: { hip: [-12, -30], knee: [6, -22], foot: [-4, -7], sh: [0, -50], elb: [10, -40], hand: [20, -37], head: [7, -60], fknee: [8, -21], ffoot: [-2, -7], felb: [12, -41], fhand: [21, -38] },
    tuck: { hip: [-10, -28], knee: [8, -27], foot: [-4, -8], sh: [4, -46], elb: [12, -38], hand: [20, -37], head: [11, -55], fknee: [10, -26], ffoot: [-2, -8], felb: [13, -39], fhand: [21, -38] },
    superman: { hip: [-17, -55], knee: [-36, -60], foot: [-54, -57], sh: [6, -50], elb: [14, -45], hand: [20, -37], head: [15, -57], fknee: [-34, -55], ffoot: [-52, -50], felb: [15, -46], fhand: [21, -38] },
    nohander: { hip: [-14, -28], knee: [5, -22], foot: [-4, -7], sh: [-8, -50], elb: [-14, -64], hand: [-8, -78], head: [-4, -61], fknee: [7, -21], ffoot: [-2, -7], felb: [2, -64], fhand: [10, -76] },
    heelclick: { hip: [-10, -36], knee: [10, -44], foot: [28, -46], sh: [-4, -56], elb: [8, -47], hand: [20, -37], head: [-1, -66], fknee: [12, -42], ffoot: [30, -43], felb: [9, -46], fhand: [21, -38] },
  };
  var TRICKS = ['backflip', 'superman', 'nohander', 'heelclick'];
  function blendPose(a, b, w) {
    var o = {};
    for (var k in a) o[k] = [lerp(a[k][0], b[k][0], w), lerp(a[k][1], b[k][1], w)];
    return o;
  }

  function limb(a, b, c, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    if (c) ctx.lineTo(c[0], c[1]);
    ctx.stroke();
  }
  function wheel(cx, cy, rot, front) {
    ctx.lineWidth = 4.4; ctx.strokeStyle = '#141015';
    ctx.beginPath(); ctx.arc(cx, cy, 12.8, 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.setLineDash([2.2, 2.4]); ctx.lineWidth = 2; ctx.strokeStyle = '#231b20'; // knobby tyre
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(200,206,214,0.85)';
    ctx.beginPath();
    for (var i = 0; i < 12; i++) { var a = i * TAU / 12; ctx.moveTo(Math.cos(a) * 2.4, Math.sin(a) * 2.4); ctx.lineTo(Math.cos(a + 0.3) * 10, Math.sin(a + 0.3) * 10); }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#d7dbe0';
    ctx.beginPath(); ctx.arc(cx, cy, 10.2, 0, TAU); ctx.stroke();
    if (front) { ctx.lineWidth = 1.2; ctx.strokeStyle = '#7d848e'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = '#e2e5ea'; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, TAU); ctx.fill();
  }
  function shape(pts, fill) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }

  // b: { x, y, ang, trick, k }, flying: wheels spin free and the exhaust glows.
  function drawBike(b, now, flying, alpha) {
    var s = SC, pose = POSE.ride, rot = b.ang;
    if (b.trick) {
      var w = b.k < 0.25 ? ease(b.k / 0.25) : b.k > 0.75 ? ease((1 - b.k) / 0.25) : 1;
      if (b.trick === 'backflip') { pose = blendPose(POSE.ride, POSE.tuck, w); rot -= TAU * easeInOut(b.k); }
      else pose = blendPose(POSE.ride, POSE[b.trick], w);
    }
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(b.x, b.y);
    ctx.rotate(rot);
    ctx.scale(s, s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var P = pose;
    // far side limbs (in shadow)
    limb(P.hip, P.fknee, P.ffoot, 7, '#1d1622');
    limb(P.sh, P.felb, P.fhand, 5, '#b8520f');
    // wheels, chassis
    wheel(-32, 0, scene.wheel, false);
    wheel(32, 0, scene.wheel * 1.02, true);
    limb([-32, 0], [-6, -12], null, 4.2, '#3a3f47'); // swing arm
    ctx.strokeStyle = '#ffc23a'; ctx.lineWidth = 2; ctx.beginPath(); // rear shock spring
    for (var i = 0; i <= 6; i++) { var sx = lerp(-20, -12, i / 6) + (i % 2 ? 1.6 : -1.6), sy = lerp(-8, -26, i / 6); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }
    ctx.stroke();
    ctx.fillStyle = '#2f3339'; ctx.fillRect(-12, -17, 18, 14); // engine
    ctx.strokeStyle = '#555c66'; ctx.lineWidth = 1;
    ctx.beginPath(); for (var f = 0; f < 4; f++) { ctx.moveTo(-10, -14 + f * 3); ctx.lineTo(4, -14 + f * 3); } ctx.stroke();
    limb([-2, -14], [-20, -21], [-36, -24], 3.4, '#c9ced6'); // exhaust pipe
    ctx.save(); ctx.translate(-40, -25.5); ctx.rotate(-0.12); // muffler
    ctx.fillStyle = '#9aa1ab'; ctx.fillRect(-6, -3, 14, 6.4); ctx.fillStyle = '#5c636d'; ctx.fillRect(-7, -2.4, 2, 4.8);
    ctx.restore();
    if (flying) { // exhaust glow
      var fl = 0.6 + 0.4 * Math.sin(now / 30);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var fg = ctx.createRadialGradient(-48, -26, 0, -48, -26, 9 * fl + 3);
      fg.addColorStop(0, 'rgba(255,240,180,0.95)'); fg.addColorStop(0.4, 'rgba(255,140,40,0.7)'); fg.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(-48, -26, 9 * fl + 3, 0, TAU); ctx.fill();
      ctx.restore();
    }
    limb([-6, -12], [14, -28], null, 3.6, '#3a3f47'); // frame
    limb([32, 0], [20, -34], null, 3.8, '#e8b13a'); // fork
    limb([30, -5], [22, -28], null, 2.2, '#f5d27a');
    shape([-16, -27, -48, -32, -46, -28, -22, -22], '#1fd6bb'); // rear fender
    shape([-38, -29, -6, -31, -1, -29, -2, -26, -30, -25], '#15121a'); // seat
    shape([-7, -29, 4, -35, 18, -33, 23, -27, 9, -18, -7, -22], '#1fd6bb'); // tank + shrouds
    shape([2, -31, 16, -32, 19, -28, 9, -22], '#0d8f7d');
    ctx.fillStyle = '#fff'; ctx.font = '900 7px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('50', 7, -27);
    shape([25, -19, 36, -25, 48, -17, 46, -15, 36, -20, 28, -16], '#1fd6bb'); // front fender
    shape([20, -36, 27, -38, 28, -30, 22, -28], '#f6f3ee'); // number plate
    limb([16, -38], [24, -41], null, 2.4, '#15121a'); // handlebar
    // rider: legs, torso, arm, helmet
    limb(P.hip, P.knee, P.foot, 7.5, '#2a2230');
    limb(P.hip, P.knee, null, 2, '#ff7a1a');
    shape([P.foot[0] - 3, P.foot[1] - 3, P.foot[0] + 6, P.foot[1] - 2, P.foot[0] + 6, P.foot[1] + 2, P.foot[0] - 4, P.foot[1] + 2], '#f2eee8'); // boot
    var tg = ctx.createLinearGradient(P.hip[0], P.hip[1], P.sh[0], P.sh[1]);
    tg.addColorStop(0, '#e2540a'); tg.addColorStop(1, '#ff9a3c');
    limb(P.hip, P.sh, null, 12, tg);
    limb([lerp(P.hip[0], P.sh[0], 0.3), lerp(P.hip[1], P.sh[1], 0.3)], [lerp(P.hip[0], P.sh[0], 0.8), lerp(P.hip[1], P.sh[1], 0.8)], null, 3.2, '#ffffff');
    limb(P.sh, P.elb, P.hand, 5.4, '#ff8a2a');
    ctx.fillStyle = '#15121a'; ctx.beginPath(); ctx.arc(P.hand[0], P.hand[1], 2.6, 0, TAU); ctx.fill();
    var ha = Math.atan2(P.sh[1] - P.hip[1], P.sh[0] - P.hip[0]) + Math.PI / 2;
    ctx.save(); ctx.translate(P.head[0], P.head[1]); ctx.rotate(ha * 0.6);
    ctx.fillStyle = '#f7f4ef'; ctx.beginPath(); ctx.arc(0, 0, 8.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(0, 0, 8.6, Math.PI * 1.05, Math.PI * 1.45); ctx.lineTo(0, 0); ctx.fill();
    shape([4, -5, 11, -3, 10, 1, 3, 1], '#ffffff'); // peak
    var vg = ctx.createLinearGradient(2, -3, 9, 4);
    vg.addColorStop(0, '#1d3c48'); vg.addColorStop(1, '#2de2c6');
    ctx.fillStyle = vg; ctx.beginPath(); ctx.ellipse(5.2, 0.8, 3.6, 3, 0.2, 0, TAU); ctx.fill();
    shape([2, 4, 9, 4, 7, 8, 1, 8], '#e9e4dc'); // chin guard
    ctx.restore();
    ctx.restore();
  }

  // ---- particles (dust, exhaust smoke, sparks) -------------------------------------------
  var parts = [];
  function puff(x, y, vx, vy, r, grow, life, col, par, a) {
    if (parts.length > 260) parts.shift();
    parts.push({ x: x, y: y, vx: vx, vy: vy, r: r, grow: grow, life: life, age: 0, col: col, par: par, a: a == null ? 0.6 : a });
  }
  function dustColour() { return mixC([232, 178, 126], [116, 96, 128], smooth(0.1, 0.8, scene.alt)); }
  function burst(kind) {
    if (kind === 'win' && W) { // teal nitro sparks off the bike
      var b = bikeAt(performance.now(), Date.now() - S.flightStart);
      for (var i = 0; i < 22; i++) {
        var a = Math.random() * TAU, sp = (60 + Math.random() * 160) * SC;
        puff(b.x, b.y - 20 * SC, Math.cos(a) * sp, Math.sin(a) * sp, 2 * SC, 1, 650, [120, 255, 230], 0.2, 0.95);
      }
    }
  }
  function updateParts(dt) {
    var k = dt / 1000;
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.x += (p.vx - scene.v * p.par) * k; p.y += p.vy * k;
      p.vy *= 1 - 0.8 * k; p.vx *= 1 - 0.9 * k;
      p.r += p.grow * k * 10;
    }
  }
  function drawParts() {
    parts.forEach(function (p) {
      var life = 1 - p.age / p.life, a = p.a * life * Math.min(1, p.age / 80);
      ctx.fillStyle = rgb(p.col, a);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      if (p.r > 6) { ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.18) + ')'; ctx.beginPath(); ctx.arc(p.x - p.r * 0.25, p.y - p.r * 0.3, p.r * 0.55, 0, TAU); ctx.fill(); }
    });
  }
  function muffler(b) { // the exhaust's tip in play-area px
    var lx = -46 * SC, ly = -26 * SC, c = Math.cos(b.ang), s = Math.sin(b.ang);
    return [b.x + lx * c - ly * s, b.y + lx * s + ly * c];
  }

  // ---- the world ----------------------------------------------------------------------
  function drawWorld(now) {
    var alt = scene.alt, A = alt * H * 1.7, nk = smooth(0.05, 0.75, alt);
    // sky (up to the very top, under the bar)
    var top = skyAt(0, alt), hor = skyAt(1, alt);
    var sg = ctx.createLinearGradient(0, -TOP, 0, H * 0.7 + A * 0.2);
    sg.addColorStop(0, rgb(top)); sg.addColorStop(0.62, rgb(mixC(top, hor, 0.55))); sg.addColorStop(1, rgb(hor));
    ctx.fillStyle = sg;
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    // stars + shooting star (night)
    var night = smooth(0.42, 0.75, alt);
    if (night > 0) {
      ctx.fillStyle = '#fff';
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.45 + 0.55 * Math.sin(now / 520 + st.t));
        ctx.beginPath(); ctx.arc(st.x * FULL_W - LEFT, st.y * FULL_H - TOP, st.r, 0, TAU); ctx.fill();
      });
      var sp = (now % 5200) / 900;
      if (sp < 1) {
        var sx = W * (0.15 + 0.5 * sp), sy = H * (0.08 + 0.18 * sp);
        var g = ctx.createLinearGradient(sx, sy, sx - 60, sy - 22);
        g.addColorStop(0, 'rgba(255,255,255,' + night * (1 - sp) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 60, sy - 22); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // the sun sets as the camera climbs; the moon rises and grows
    var sunA = 1 - smooth(0.05, 0.45, alt);
    if (sunA > 0) {
      var sx2 = W * 0.8, sy2 = H * 0.5 + alt * H * 0.6, sr = H * 0.07;
      var sgl = ctx.createRadialGradient(sx2, sy2, sr * 0.6, sx2, sy2, sr * 4);
      sgl.addColorStop(0, 'rgba(255,236,170,' + 0.75 * sunA + ')'); sgl.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = sgl; ctx.fillRect(sx2 - sr * 4, sy2 - sr * 4, sr * 8, sr * 8);
      ctx.fillStyle = 'rgba(255,246,214,' + sunA + ')';
      ctx.beginPath(); ctx.arc(sx2, sy2, sr, 0, TAU); ctx.fill();
    }
    var moonK = smooth(0.42, 1, alt);
    if (moonK > 0 && moonTex) {
      var mr = H * (0.06 + 0.2 * moonK), mx = W * 0.76, my = H * (0.62 - 0.36 * moonK);
      var mgl = ctx.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 2.4);
      mgl.addColorStop(0, 'rgba(220,220,255,' + 0.35 * moonK + ')'); mgl.addColorStop(1, 'rgba(200,200,255,0)');
      ctx.fillStyle = mgl; ctx.fillRect(mx - mr * 2.4, my - mr * 2.4, mr * 4.8, mr * 4.8);
      ctx.globalAlpha = smooth(0.42, 0.62, alt);
      ctx.drawImage(moonTex, mx - mr, my - mr, mr * 2, mr * 2);
      ctx.globalAlpha = 1;
    }
    // far mesas, then the city on the horizon (lights come on at dusk)
    tileRow(T.farDay, T.farNight, nk, scene.scroll * 0.06, H * 0.7 - T.farDay.h + A * 0.22, [182, 100, 88], [30, 26, 62]);
    var cityK = smooth(0.1, 0.2, alt); // fades in quickly, then stands solid on the horizon
    if (cityK > 0) {
      var cy = H * 0.72 - T.city.h + A * 0.24;
      var glow = ctx.createLinearGradient(0, cy, 0, cy + T.city.h);
      glow.addColorStop(0, 'rgba(255,150,90,0)'); glow.addColorStop(1, 'rgba(255,150,90,' + 0.35 * cityK + ')');
      ctx.fillStyle = glow; ctx.fillRect(-LEFT, cy - T.city.h * 0.6, FULL_W, T.city.h * 1.6);
      ctx.globalAlpha = cityK;
      var cw = T.city.w, x;
      for (x = -(((scene.scroll * 0.035) % cw + cw) % cw) - LEFT; x < W; x += cw) ctx.drawImage(T.city.c, x, cy, cw, T.city.h);
      ctx.globalAlpha = 1;
    }
    // clouds drift by as the camera climbs through them
    var cloudA = smooth(0.08, 0.3, alt) * (1 - 0.6 * smooth(0.8, 1, alt));
    if (cloudA > 0) {
      var lit = mixC([255, 236, 220], [150, 140, 190], nk), shade = mixC([240, 170, 150], [60, 56, 110], nk);
      clouds.forEach(function (c) {
        var span = FULL_W * 1.7;
        var cx = (((c.x * span - scene.scroll * 0.45 * c.v) % span) + span) % span - FULL_W * 0.35 - LEFT;
        var cyy = H * 0.55 - c.y * H + A * 0.9;
        if (cyy > -80 && cyy < H + 80) cloud(cx, cyy, c.s * (H / 380), cloudA * 0.85, lit, shade);
      });
    }
    // canyon walls and the spires far below
    tileRow(T.midDay, T.midNight, nk, scene.scroll * 0.3, H * 0.95 - T.midDay.h + A * 0.45, [118, 42, 30], [32, 22, 50]);
    tileRow(T.nearDay, T.nearNight, nk, scene.scroll, H * 1.3 - T.nearDay.h + A * 0.8, [64, 22, 18], [14, 9, 24]);
    return A;
  }

  function cactus(x, y, h, col) {
    ctx.strokeStyle = col; ctx.lineCap = 'round';
    ctx.lineWidth = h * 0.16;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
    ctx.lineWidth = h * 0.11;
    ctx.beginPath(); ctx.moveTo(x, y - h * 0.45); ctx.lineTo(x - h * 0.28, y - h * 0.45); ctx.lineTo(x - h * 0.28, y - h * 0.75); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - h * 0.6); ctx.lineTo(x + h * 0.25, y - h * 0.6); ctx.lineTo(x + h * 0.25, y - h * 0.85); ctx.stroke();
  }
  function cone(x, y, s) {
    shape([x - 5 * s, y, x + 5 * s, y, x + 1.6 * s, y - 12 * s, x - 1.6 * s, y - 12 * s], '#ff7a1a');
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 3.4 * s, y - 7 * s, 6.8 * s, 2.2 * s);
  }

  // The near rim with the kicker ramp (scrolls away) and the far rim (keeps drifting away).
  function drawRims(A) {
    var L = layout(), s = L.s, nk = smooth(0.05, 0.75, scene.alt);
    var sand = rgb(mixC([238, 176, 112], [92, 72, 112], nk));
    var rockT = rgb(mixC([196, 88, 48], [56, 36, 70], nk)), rockB = rgb(mixC([92, 34, 22], [22, 14, 34], nk));
    var dx = -scene.scroll, gy = L.groundY + A * 0.85, bottom = FULL_H - TOP + 2;
    // far rim (drifts away slower: the canyon keeps getting wider)
    var fx = Math.max(W * 0.62, L.farX - scene.scroll * 0.12), fy = gy - 4 * s + A * 0.05;
    if (fy < bottom) {
      var rg = ctx.createLinearGradient(0, fy, 0, fy + H * 0.5);
      rg.addColorStop(0, rockT); rg.addColorStop(1, rockB);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(fx, fy); ctx.lineTo(W + 10, fy); ctx.lineTo(W + 10, bottom);
      ctx.lineTo(fx + 6 * s, bottom); ctx.lineTo(fx - 8 * s, fy + 70 * s); ctx.lineTo(fx + 4 * s, fy + 40 * s); ctx.lineTo(fx - 6 * s, fy + 14 * s);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = sand; ctx.fillRect(fx - 4 * s, fy - 2 * s, W - fx + 14, 5 * s);
      // landing ramp + finish flag
      shape([fx + 4 * s, fy - 22 * s, fx + 14 * s, fy - 22 * s, fx + 86 * s, fy, fx + 4 * s, fy], rgb(mixC([206, 180, 140], [90, 80, 110], nk)));
      ctx.fillStyle = '#ffc23a'; ctx.fillRect(fx + 4 * s, fy - 24 * s, 10 * s, 3 * s);
      var px = fx + 100 * s;
      ctx.strokeStyle = '#e9e4f2'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(px, fy); ctx.lineTo(px, fy - 46 * s); ctx.stroke();
      for (var cy = 0; cy < 3; cy++) for (var cx = 0; cx < 4; cx++) {
        ctx.fillStyle = (cx + cy) % 2 ? '#15121a' : '#fff';
        var wv = Math.sin(performance.now() / 260 + cx * 0.8) * 1.5 * s;
        ctx.fillRect(px + 1 + cx * 5 * s, fy - 46 * s + cy * 5 * s + wv, 5 * s + 0.5, 5 * s + 0.5);
      }
      cactus(fx + 130 * s, fy + 1, 30 * s, rgb(mixC([62, 120, 72], [30, 40, 60], nk)));
    }
    // near rim: the start, the kicker ramp, cones and a cactus
    var lip = L.lipX + dx;
    if (lip + 30 * s > -LEFT && gy < bottom) {
      var ng = ctx.createLinearGradient(0, gy, 0, gy + H * 0.5);
      ng.addColorStop(0, rockT); ng.addColorStop(1, rockB);
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.moveTo(-LEFT - 10, gy); ctx.lineTo(lip + 16 * s, gy); ctx.lineTo(lip + 22 * s, gy + 12 * s);
      ctx.lineTo(lip + 12 * s, gy + 42 * s); ctx.lineTo(lip + 26 * s, gy + 84 * s); ctx.lineTo(lip + 10 * s, bottom);
      ctx.lineTo(-LEFT - 10, bottom); ctx.closePath(); ctx.fill();
      ctx.fillStyle = sand; ctx.fillRect(-LEFT - 10, gy - 2 * s, lip + 28 * s + LEFT, 5 * s);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (var t = 0; t < 4; t++) ctx.fillRect(-LEFT - 10, gy + (12 + t * 14) * s, lip + 14 * s + LEFT, 2 * s);
      cactus(L.bikeX + dx - 70 * s, gy + 1, 34 * s, rgb(mixC([62, 120, 72], [30, 40, 60], nk)));
      // the kicker: supports, deck, hazard lip
      var rs = L.rampStart + dx;
      ctx.strokeStyle = rgb(mixC([120, 84, 52], [50, 40, 60], nk)); ctx.lineWidth = 2.4 * s;
      ctx.beginPath();
      for (var k = 1; k <= 4; k++) { var bx = lerp(rs, lip, k / 4.2); ctx.moveTo(bx, gy); ctx.lineTo(bx, gy - rampHeight(L, bx - dx)); }
      ctx.moveTo(lerp(rs, lip, 0.3), gy); ctx.lineTo(lip - 2 * s, gy - L.rampH * 0.9);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rs, gy);
      for (var xx = 0; xx <= 1.0001; xx += 0.05) { var rx = lerp(rs, lip, xx); ctx.lineTo(rx, gy - rampHeight(L, rx - dx)); }
      ctx.lineTo(lip, gy - L.rampH + 5 * s);
      for (var x2 = 1; x2 >= -0.0001; x2 -= 0.05) { var rx2 = lerp(rs, lip, x2); ctx.lineTo(rx2, gy - rampHeight(L, rx2 - dx) + 5 * s); }
      ctx.closePath();
      ctx.fillStyle = rgb(mixC([232, 208, 164], [96, 88, 118], nk)); ctx.fill();
      ctx.save(); ctx.translate(lip - 3 * s, gy - L.rampH); ctx.rotate(-Math.atan(rampSlope(L, L.lipX)));
      for (var hz = 0; hz < 3; hz++) { ctx.fillStyle = hz % 2 ? '#15121a' : '#ffc23a'; ctx.fillRect(-9 * s + hz * 3 * s, -0.5 * s, 3 * s, 4 * s); }
      ctx.restore();
      cone(rs - 10 * s, gy + 1, s); cone(lip + 4 * s, gy + 1, s * 0.9);
    }
  }

  // ---- the betting time: a tachometer climbing to the red line ---------------------------
  function drawTacho(now) {
    var R = clamp(Math.min(W, H) * 0.17, 46, 120), cx = W * 0.5, cy = H * 0.3;
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var p = S.phase === 'betting' ? clamp((Date.now() - S.bettingStartsAt) / total, 0, 1) : 0;
    var left = S.phase === 'betting' ? Math.max(0, (S.bettingEndsAt - Date.now()) / 1000) : 0;
    var a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 16;
    var dg = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
    dg.addColorStop(0, 'rgba(48,36,44,0.92)'); dg.addColorStop(1, 'rgba(16,11,14,0.92)');
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.restore();
    var rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rim.addColorStop(0, '#f4f1ec'); rim.addColorStop(0.5, '#7d7480'); rim.addColorStop(1, '#d8d2cc');
    ctx.strokeStyle = rim; ctx.lineWidth = R * 0.07; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    // red line zone, then the lit sweep so far
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,61,61,0.9)'; ctx.lineWidth = R * 0.09;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.84, a0 + sweep * 0.8, a0 + sweep); ctx.stroke();
    if (p > 0) {
      var lg = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      lg.addColorStop(0, 'rgba(45,226,198,0.9)'); lg.addColorStop(0.7, 'rgba(255,194,58,0.95)'); lg.addColorStop(1, 'rgba(255,90,40,1)');
      ctx.strokeStyle = lg; ctx.lineWidth = R * 0.05;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.72, a0, a0 + sweep * p); ctx.stroke();
    }
    // ticks + numbers
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    for (var i = 0; i <= 40; i++) {
      var a = a0 + sweep * i / 40, major = i % 4 === 0;
      ctx.lineWidth = major ? R * 0.03 : R * 0.014;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * (major ? 0.76 : 0.8), cy + Math.sin(a) * R * (major ? 0.76 : 0.8));
      ctx.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '800 ' + Math.round(R * 0.15) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var n = 0; n <= 10; n += 2) { var an = a0 + sweep * n / 10; ctx.fillText(String(n), cx + Math.cos(an) * R * 0.6, cy + Math.sin(an) * R * 0.6); }
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '700 ' + Math.round(R * 0.1) + 'px system-ui, sans-serif';
    ctx.fillText('RPM ×1000', cx, cy - R * 0.3);
    // needle (with a little engine jitter)
    var blip = scene.revAt && now - scene.revAt < BLIP_MS ? Math.sin(Math.PI * (now - scene.revAt) / BLIP_MS) : 0;
    var na = a0 + sweep * clamp(p + Math.sin(now / 40) * 0.006 + blip * 0.06, 0, 1);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(na);
    ctx.shadowColor = 'rgba(255,90,30,0.7)'; ctx.shadowBlur = 8;
    shape([-R * 0.12, -R * 0.035, R * 0.82, -R * 0.01, R * 0.82, R * 0.01, -R * 0.12, R * 0.035], '#ff5a1f');
    ctx.restore();
    ctx.fillStyle = '#2b2127'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.1, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = R * 0.03; ctx.stroke();
    // seconds to launch
    if (S.phase === 'betting') {
      ctx.fillStyle = left < 1.5 ? '#ff6b5b' : '#ffd27a';
      ctx.font = '800 ' + Math.round(R * 0.28) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(left.toFixed(1), cx, cy + R * 0.42);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '800 ' + Math.round(R * 0.09) + 'px system-ui, sans-serif';
      ctx.fillText('LAUNCH IN', cx, cy + R * 0.64);
      // the round's phrase under the dial
      var fs = Math.round(clamp(H * 0.045, 13, 26));
      ctx.font = 'italic 900 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(26,18,22,0.85)'; ctx.fillStyle = '#fff';
      var label = S.bettingPhrase.toUpperCase();
      ctx.strokeText(label, cx, cy + R + fs * 1.1);
      ctx.fillText(label, cx, cy + R + fs * 1.1);
    }
  }

  // Browser bar colour = the top of the sky (sent at most every 0.4 s).
  var themeAt = 0;
  function themeColour() {
    return '#' + skyAt(0, scene.alt).map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }

  function frame(now) {
    if (now - themeAt > 400) { themeAt = now; game.theme(themeColour()); }
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    var t = Date.now() - S.flightStart; // ms into the flight (wall clock, as the engine counts)
    if (W && H) {
      // camera height and scroll speed follow the multiplier
      scene.alt += (climb() - scene.alt) * Math.min(1, dt / 400);
      var flyingOut = S.phase === 'flying' && t > LAUNCH_AT;
      var targetV = flyingOut ? H * 0.55 * (1 + scene.alt * 1.4) * smooth(0, 500, t - LAUNCH_AT) : 0;
      scene.v += (targetV - scene.v) * Math.min(1, dt / (flyingOut ? 120 : 380));
      scene.scroll += scene.v * dt / 1000;
      scene.wheel += (S.phase === 'flying' ? 0.03 : S.phase === 'crashed' ? 0.008 : 0.002) * dt;
      // a throttle blip on each of the last 3 seconds of betting
      if (S.phase === 'betting') {
        var sec = Math.ceil((S.bettingEndsAt - Date.now()) / 1000);
        if (sec !== scene.lastSec) { if (scene.lastSec !== -1 && sec >= 0 && sec <= 3) { scene.revAt = now; play('blip'); } scene.lastSec = sec; }
      }
      updateParts(dt);

      ctx.save();
      var sh = scene.shakeAt ? 1 - (now - scene.shakeAt) / 380 : 0;
      if (sh > 0) ctx.translate((Math.random() - 0.5) * 9 * sh, (Math.random() - 0.5) * 9 * sh);
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      ctx.clearRect(-LEFT - 10, -TOP - 10, FULL_W + 20, FULL_H + 20);
      var A = drawWorld(now);
      drawRims(A);
      var L = layout();

      if (S.phase === 'betting' || S.phase === 'waiting') {
        var blip = scene.revAt && now - scene.revAt < BLIP_MS ? Math.sin(Math.PI * (now - scene.revAt) / BLIP_MS) : 0;
        var bike = { x: L.bikeX, y: L.groundY - 15 * SC + Math.sin(now / 26) * (0.35 + blip) * SC, ang: -0.06 * blip, trick: null };
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(bike.x, L.groundY + 1, 52 * SC, 4 * SC, 0, 0, TAU); ctx.fill();
        if (now - scene.smokeAt > (blip ? 50 : 260)) { // idle exhaust
          scene.smokeAt = now;
          var m = muffler(bike);
          puff(m[0], m[1], -(20 + blip * 60) * SC, -8 * SC, 2.5 * SC, 0.6 * SC, 900, [210, 200, 196], 0, blip ? 0.45 : 0.22);
        }
        drawParts();
        drawBike(bike, now, false);
        if (S.phase === 'betting') drawTacho(now);
      } else if (S.phase === 'flying') {
        var b = bikeAt(now, t);
        if (t < LAUNCH_AT && b.ground && now - scene.smokeAt > 30) { // dust off the rear tyre
          scene.smokeAt = now;
          puff(b.x - 34 * SC, L.groundY, -(80 + Math.random() * 60) * SC, -(20 + Math.random() * 30) * SC, 3 * SC, 1.4 * SC, 700, dustColour(), 0, 0.55);
        }
        if (t >= LAUNCH_AT && now - scene.smokeAt > 45) { // exhaust trail
          scene.smokeAt = now;
          var mm = muffler(b);
          puff(mm[0], mm[1], -30 * SC, (Math.random() - 0.5) * 20, 2.2 * SC, 0.9 * SC, 650, mixC([240, 230, 224], [170, 170, 210], scene.alt), 0.55, 0.35);
        }
        if (b.trick && b.n !== scene.trickN) { scene.trickN = b.n; play('trick'); }
        // speed streaks
        var sk = smooth(1.08, 2, game.currentMult());
        if (sk > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,' + 0.22 * sk + ')'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
          ctx.beginPath();
          streaks.forEach(function (st) {
            var span = FULL_W + 200, x = (((st.x * span - scene.scroll * 2.2 * st.l) % span) + span) % span - LEFT - 100;
            ctx.moveTo(x, st.y * H); ctx.lineTo(x + 60 * st.l * SC, st.y * H);
          });
          ctx.stroke();
        }
        drawParts();
        drawBike(b, now, t >= LAUNCH_AT);
        engineFollow(game.currentMult());
      } else if (S.phase === 'crashed') {
        var ct = scene.crashAt ? now - scene.crashAt : 1e9, f = scene.crashFrom;
        if (f && ct < IMPACT_AT) { // lands short: nose drops and the bike falls into the canyon
          var k = ct / IMPACT_AT;
          var cb = { x: f.x + W * 0.1 * k, y: lerp(f.y, H + 40 * SC, k * k), ang: f.ang + 1.15 * k, trick: null };
          if (now - scene.smokeAt > 40) { scene.smokeAt = now; var m2 = muffler(cb); puff(m2[0], m2[1], -20 * SC, -10, 2.4 * SC, 1, 500, [120, 110, 120], 0, 0.4); }
          drawParts();
          drawBike(cb, now, false);
        } else {
          if (f && !scene.impactDone && ct < CRASH_MS) { // the impact: a big dust cloud rises out of the canyon
            scene.impactDone = true; scene.shakeAt = now;
            var ix = f.x + W * 0.1, dc = dustColour();
            for (var i = 0; i < 34; i++) {
              puff(ix + (Math.random() - 0.5) * 70 * SC, H + 10 * SC, (Math.random() - 0.5) * 150 * SC, -(70 + Math.random() * 190) * SC,
                (6 + Math.random() * 9) * SC, (1.5 + Math.random() * 2.5) * SC, 1400 + Math.random() * 900, dc, 0, 0.75);
            }
            for (var j = 0; j < 12; j++) puff(ix, H, (Math.random() - 0.5) * 260 * SC, -(150 + Math.random() * 200) * SC, 1.8 * SC, 0, 700, [90, 60, 50], 0, 0.9);
          }
          drawParts();
        }
      }
      // a quick cut back to the start rim when a new round opens
      var cut = scene.cutAt ? 1 - (now - scene.cutAt) / 450 : 0;
      if (cut > 0) { ctx.fillStyle = 'rgba(26,18,22,' + cut + ')'; ctx.fillRect(-LEFT - 10, -TOP - 10, FULL_W + 20, FULL_H + 20); }
      ctx.restore();
    }
    // texts over the scene
    var mult = $('mult'), hint = $('hint'), flew = $('flew'), dist = $('dist');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden) setText(flew, S.crashPhrase);
    if (S.phase === 'flying') {
      if (mult.className !== 'mult') mult.className = 'mult';
      setText(mult, game.currentMult().toFixed(2) + 'x'); setText(hint, '');
      setText(dist, Math.max(0, Math.floor(t / 1000 * METRES_PER_S)) + ' m jump');
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      if (mult.className !== 'mult mult--crashed') mult.className = 'mult mult--crashed';
      setText(mult, S.crashPoint.toFixed(2) + 'x'); setText(hint, '');
      setText(dist, scene.crashDist ? 'Landed short · ' + Math.floor(scene.crashDist) + ' m' : '');
    } else {
      if (mult.className !== 'mult') mult.className = 'mult';
      setText(mult, ''); setText(dist, '');
      setText(hint, S.phase === 'betting' ? '' : S.gotSnapshot ? 'Waiting for the next round…' : 'Connecting…');
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
  function buildQuick(p) { // 1×, 2×, 5×, 10× the min bet (within the max) — the four "gears"
    var l = game.limit();
    p.quick.innerHTML = '';
    p.quickBtns = [];
    [1, 2, 5, 10].forEach(function (k, i) {
      var v = game.round2(l.min * k);
      if (l.max && v > l.max) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = v;
      b.dataset.gear = String(i + 1);
      b.setAttribute('aria-label', 'Bet ' + game.money(v));
      b.textContent = game.money(v);
      b.onclick = function () { play('click'); setAmount(p, v); };
      p.quick.appendChild(b);
      p.quickBtns.push(b);
    });
  }
  game.limitsLoaded.then(function (l) { panels.forEach(function (p) { buildQuick(p); setAmount(p, l.min); }); });

  panels.forEach(function (p) {
    Array.prototype.forEach.call(p.el.querySelectorAll('.stepper__btn'), function (b) {
      b.onclick = function () { play('click'); setAmount(p, readAmount(p) + Number(b.dataset.step) * game.limit().min); };
    });
    p.amount.oninput = function () { updateButton(p); };
    p.amount.onblur = function () { setAmount(p, readAmount(p) || game.limit().min); };
    p.autoAt.onblur = function () {
      var v = Number(String(p.autoAt.value).replace(',', '.'));
      p.autoAt.value = (isFinite(v) && v >= 1.01 ? Math.round(v * 100) / 100 : 2).toFixed(2);
    };
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
  unlock(); // music autoplays where the browser allows it (else on the first tap)
  window.addEventListener('resize', fit);
  // The results row fills in after load (and the bets list / bar can change size): refit.
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
