/* Nova Rocket — NEXORNG original crash game. Game logic: ../_core/crash-client.js; this file
 * is the look and sound, all made in code: a rocket on its launch pad while bets are open, the
 * lift-off, the climb past the moon, planets, nebulae and galaxies, and the flame-out explosion
 * at the crash. Sound effects and music are generated with WebAudio. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0031', onChange: render, onSignal: onSignal });
  var S = game.S;
  var KEY = 'novarocket';

  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000); // never hang the loader

  // ---------------------------------------------------------------- timings (sound = animation)
  var LIFTOFF_MS = 1500; // ignition + climb off the pad (the lift-off roar lasts exactly this long)
  var FLAMEOUT_MS = 350; // the engine dies, then…
  var BOOM_MS = 1300; // …the explosion (sound and sparks end together)

  // ---------------------------------------------------------------- sound (WebAudio, generated)
  var soundOn = true, musicOn = true;
  try { soundOn = localStorage.getItem(KEY + '-sound') !== 'off'; } catch (e) { /* default on */ }
  try { musicOn = localStorage.getItem(KEY + '-music') !== 'off'; } catch (e) { /* default on */ }
  var AC = window.AudioContext || window.webkitAudioContext;
  var ac = null, sfxBus = null, musicBus = null, noiseBuf = null, engine = null;

  function audio() {
    if (ac || !AC) return ac;
    ac = new AC();
    sfxBus = ac.createGain();
    sfxBus.gain.value = soundOn ? 0.9 : 0;
    sfxBus.connect(ac.destination);
    musicBus = ac.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }
  function live() { return ac && ac.state === 'running'; }
  function noiseSrc() { var s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }

  function sfxClick() {
    if (!live() || !soundOn) return;
    var t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(980, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.06);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + 0.09);
  }

  // Lift-off roar: lasts exactly `ms`, like the lift-off animation.
  function sfxLiftoff(ms) {
    if (!live()) return;
    var t = ac.currentTime, d = ms / 1000;
    var n = noiseSrc(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + d * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + d * 0.35);
    g.gain.setValueAtTime(0.55, t + d - 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    n.connect(f); f.connect(g); g.connect(sfxBus);
    n.start(t); n.stop(t + d + 0.02);
    var o = ac.createOscillator(), og = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(42, t);
    o.frequency.linearRampToValueAtTime(70, t + d);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.4, t + d * 0.3);
    og.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(og); og.connect(sfxBus);
    o.start(t); o.stop(t + d + 0.02);
  }

  // The engine's hum while flying; its pitch rises with the multiplier.
  function engineStart() {
    if (!live() || engine) return;
    var t = ac.currentTime, n = noiseSrc(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'bandpass';
    f.frequency.value = 520;
    f.Q.value = 0.9;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
    var o = ac.createOscillator(), og = ac.createGain();
    o.type = 'triangle';
    o.frequency.value = 64;
    og.gain.value = 0.12;
    n.connect(f); f.connect(g); o.connect(og); og.connect(g); g.connect(sfxBus);
    n.start(t); o.start(t);
    engine = { n: n, o: o, f: f, g: g };
  }
  function engineSet(m) {
    if (!engine || !live()) return;
    var k = Math.log(Math.max(1, m));
    engine.f.frequency.setTargetAtTime(520 + 260 * k, ac.currentTime, 0.2);
    engine.o.frequency.setTargetAtTime(64 + 22 * k, ac.currentTime, 0.2);
  }
  function engineStop(ms) {
    if (!engine) return;
    var e = engine, t = ac.currentTime, d = (ms || 80) / 1000;
    engine = null;
    e.g.gain.cancelScheduledValues(t);
    e.g.gain.setValueAtTime(Math.max(0.0001, e.g.gain.value), t);
    e.g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    e.n.stop(t + d + 0.02); e.o.stop(t + d + 0.02);
  }

  // Flame-out sputter then the explosion: together exactly FLAMEOUT_MS + BOOM_MS.
  function sfxCrash() {
    if (!live()) return;
    var t = ac.currentTime, fo = FLAMEOUT_MS / 1000, d = BOOM_MS / 1000;
    var n = noiseSrc(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t + fo);
    f.frequency.exponentialRampToValueAtTime(120, t + fo + d);
    g.gain.setValueAtTime(0.0001, t);
    for (var i = 0; i < 5; i++) { // sputter
      g.gain.setValueAtTime(0.18, t + i * fo / 5);
      g.gain.setValueAtTime(0.02, t + i * fo / 5 + fo / 10);
    }
    g.gain.setValueAtTime(0.95, t + fo);
    g.gain.exponentialRampToValueAtTime(0.0001, t + fo + d);
    n.connect(f); f.connect(g); g.connect(sfxBus);
    n.start(t); n.stop(t + fo + d + 0.02);
    var o = ac.createOscillator(), og = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t + fo);
    o.frequency.exponentialRampToValueAtTime(28, t + fo + 0.6);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.setValueAtTime(0.7, t + fo);
    og.gain.exponentialRampToValueAtTime(0.0001, t + fo + 0.7);
    o.connect(og); og.connect(sfxBus);
    o.start(t + fo); o.stop(t + fo + 0.75);
  }

  function sfxWin() {
    if (!live() || !soundOn) return;
    var t = ac.currentTime;
    [880, 1175, 1568, 2093].forEach(function (fr, i) {
      var o = ac.createOscillator(), g = ac.createGain(), s = t + i * 0.08;
      o.type = 'sine';
      o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.18, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.45);
      o.connect(g); g.connect(sfxBus);
      o.start(s); o.stop(s + 0.5);
    });
  }

  // Generated space music: slow pads + a soft arpeggio (A minor · F · C · G).
  var CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  var BEAT = 0.5, musicNext = 0, musicStep = 0, musicTimer = null;
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function note(m, at, dur, type, vol, cutoff) {
    var o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = type;
    o.frequency.value = hz(m);
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.4, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(f); f.connect(g); g.connect(musicBus);
    o.start(at); o.stop(at + dur + 0.05);
  }
  function scheduleMusic() {
    if (!live()) return;
    if (musicNext < ac.currentTime) musicNext = ac.currentTime + 0.05;
    while (musicNext < ac.currentTime + 0.6) {
      var bar = Math.floor(musicStep / 16), chord = CHORDS[bar % CHORDS.length], s = musicStep % 16;
      if (s === 0) chord.forEach(function (m) { note(m, musicNext, BEAT * 16, 'sawtooth', 0.035, 900); note(m + 12, musicNext, BEAT * 16, 'sine', 0.03, 2000); });
      if (s % 2 === 0) note(chord[(s / 2) % 3] + 24, musicNext, BEAT * 1.6, 'triangle', 0.03, 3000);
      if (s % 8 === 0) note(chord[0] - 12, musicNext, BEAT * 4, 'sine', 0.08, 400);
      musicNext += BEAT / 2;
      musicStep++;
    }
  }
  function syncMusic() {
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
    if (!ac) return;
    var t = ac.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setTargetAtTime(musicOn ? 0.9 : 0, t, 0.3);
    if (musicOn && !musicTimer) { musicTimer = setInterval(scheduleMusic, 200); scheduleMusic(); }
    if (!musicOn && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem(KEY + '-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.05);
  }
  // Music starts as the game opens (the tap that opened the game allows sound); where a browser
  // still blocks it, it starts on the first tap in the game.
  function wake() {
    if (!audio()) return;
    if (ac.state !== 'running') ac.resume().then(function () { syncMusic(); if (S.phase === 'flying') engineStart(); }).catch(function () {});
    syncMusic();
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, wake, true); });
  document.addEventListener('visibilitychange', function () {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else ac.resume().catch(function () {});
  });

  // ---------------------------------------------------------------- engine moments
  var scene = { launchAt: 0, crashAt: 0, crashFrom: null, dist: 0, lastT: 0, alt: 0, padSmokeAt: 0 };
  var particles = []; // exhaust / smoke / sparks / debris
  var engineTimer = null;
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') {
      scene.launchAt = now;
      sfxLiftoff(LIFTOFF_MS);
      clearTimeout(engineTimer);
      engineTimer = setTimeout(function () { if (S.phase === 'flying') engineStart(); }, LIFTOFF_MS);
    }
    if (name === 'crash') {
      scene.crashAt = now;
      scene.crashFrom = scene.launchAt ? rocketAt(now) : null;
      clearTimeout(engineTimer);
      engineStop(60);
      sfxCrash();
    }
    if (name === 'betting') { scene.launchAt = 0; scene.crashAt = 0; scene.crashFrom = null; scene.dist = 0; particles = []; }
    if (name === 'win') { sfxWin(); toast(d.text, 'win'); }
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
  function badge(name) { return NXPlayers.face(name, 'avatar'); } // a player's face (../_core/players.js)
  // Players in this round, on the scene (../_core/players.js).
  var playersStrip;

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: badge });
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

  // ---- bet panels (slot 0 and 1; phone shows one) ------------------------------------
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML = // mission-control console: LCD stake display, console keys, a hazard-ringed launch button
      '<div class="console">' +
      '<div class="console__head"><span class="console__led" aria-hidden="true"></span><span>BAY ' + (slot + 1) + ' · STAKE</span><span class="console__tag">MISSION CTRL</span></div>' +
      '<div class="stepper console__display"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<input class="amount" inputmode="decimal" value="1.00" aria-label="Bet amount">' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick console__keys" aria-label="Quick amounts"></div>' +
      '<div class="console__pad"><button type="button" class="action"><span class="action__label">Bet</span><small class="action__sub"></small></button></div>' +
      '<div class="auto console__abort"><span class="console__abort-label">AUTO CASH-OUT</span>' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label>' +
      '<input class="auto__x" inputmode="decimal" value="1.50" aria-label="Auto cash-out multiplier"><span class="console__x" aria-hidden="true">×</span></div>' +
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
  // The button is built once; only its texts / class change (and only when they differ), so a
  // tap never lands on an element that is being replaced.
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
        user.appendChild(badge(b.player));
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
  // Play area (W×H, right of the bets list on wide screens, below the floating bar, above the
  // results row); the world is drawn from -LEFT/-TOP so it fills the whole stage.
  var W = 0, H = 0, TOP = 0, FULL_H = 0, LEFT = 0, FULL_W = 0;

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
    var centre = document.querySelector('.stage__center').style; // texts centred on the play area
    centre.left = LEFT + 'px'; centre.top = TOP + 'px'; centre.width = W + 'px'; centre.height = H + 'px';
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a player joins the round).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function ease(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
  function easeIn(t) { t = clamp01(t); return t * t * t; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---- sky: atmosphere → space → nebula, by how far the rocket has climbed (dist / H) ----
  var SKY = [ // [height in screens, top colour, bottom colour]
    [0, [16, 28, 84], [58, 92, 176]], // twilight atmosphere over the pad
    [1.4, [8, 14, 46], [18, 30, 92]], // upper atmosphere
    [3.2, [3, 4, 16], [10, 10, 40]], // space
    [7, [12, 3, 34], [34, 8, 62]], // the nebula belt
    [11, [2, 8, 30], [6, 26, 66]], // deep blue
    [15, [3, 4, 16], [10, 10, 40]], // space again (then it repeats from 3.2)
  ];
  function skyAt(h) {
    if (h > 15) h = 3.2 + ((h - 3.2) % 11.8);
    for (var i = 0; i < SKY.length - 1; i++) {
      if (h <= SKY[i + 1][0]) {
        var k = (h - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
        return [0, 1].map(function (j) { return SKY[i][j + 1].map(function (v, c) { return Math.round(lerp(v, SKY[i + 1][j + 1][c], k)); }); });
      }
    }
    return [SKY[SKY.length - 1][1], SKY[SKY.length - 1][2]];
  }
  function rgb(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')'; }

  var STAR_LAYERS = [0.04, 0.12, 0.26].map(function (speed, li) {
    var stars = [];
    for (var i = 0; i < [70, 40, 18][li]; i++) stars.push({ x: Math.random(), y: Math.random(), r: [0.6, 1, 1.6][li] * rnd(0.7, 1.3), t: Math.random() * 6 });
    return { speed: speed, stars: stars };
  });

  // Planets and wonders passed on the way up (height in screens; repeat every 12 screens).
  var WONDERS = [
    { h: 2.2, kind: 'moon', x: 0.8, r: 0.17 },
    { h: 4.8, kind: 'ringed', x: 0.2, r: 0.13 },
    { h: 7.6, kind: 'nebula', x: 0.62, r: 0.75 },
    { h: 10.4, kind: 'giant', x: 0.82, r: 0.22 },
    { h: 13.6, kind: 'galaxy', x: 0.28, r: 0.3 },
  ];

  function drawSky(h, now) {
    var c = skyAt(h);
    var g = ctx.createLinearGradient(0, -TOP, 0, H);
    g.addColorStop(0, rgb(c[0]));
    g.addColorStop(1, rgb(c[1]));
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    // stars fade in above the atmosphere and stream down as the rocket climbs
    var starA = clamp01((h - 0.25) / 1.3);
    if (starA > 0) {
      STAR_LAYERS.forEach(function (L) {
        L.stars.forEach(function (s) {
          var y = ((s.y * FULL_H + scene.dist * L.speed) % FULL_H + FULL_H) % FULL_H - TOP;
          ctx.globalAlpha = starA * (0.55 + 0.45 * Math.sin(now / 600 + s.t));
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(s.x * FULL_W - LEFT, y, s.r, 0, Math.PI * 2);
          ctx.fill();
        });
      });
      ctx.globalAlpha = 1;
    }
  }

  function drawWonders(h, now) {
    var cycle = Math.max(0, Math.floor((h - 1) / 12));
    for (var k = Math.max(0, cycle - 1); k <= cycle + 1; k++) {
      WONDERS.forEach(function (o, i) {
        var oh = o.h + k * 12;
        var y = H * 0.35 - (oh - h) * H * 0.6; // they drift down past the rocket
        var x = (k % 2 ? 1 - o.x : o.x) * W, r = o.r * H;
        if (y < -TOP - r * 1.6 || y > FULL_H + r * 1.6) return;
        drawWonder(o.kind, x, y, r, now, i + k);
      });
    }
  }

  function drawWonder(kind, x, y, r, now, seed) {
    var g;
    if (kind === 'moon') {
      g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, '#f4f1ea'); g.addColorStop(0.7, '#b9b4ab'); g.addColorStop(1, '#6d6a72');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(80, 76, 90, 0.35)';
      [[-0.3, -0.1, 0.2], [0.25, 0.3, 0.14], [0.1, -0.4, 0.1], [-0.1, 0.45, 0.08], [0.45, -0.15, 0.09]].forEach(function (c) {
        ctx.beginPath(); ctx.arc(x + c[0] * r, y + c[1] * r, c[2] * r, 0, Math.PI * 2); ctx.fill();
      });
    } else if (kind === 'ringed') {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(-0.35);
      ctx.strokeStyle = 'rgba(255, 210, 150, 0.55)'; ctx.lineWidth = r * 0.12;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.9, r * 0.45, 0, Math.PI, Math.PI * 2); ctx.stroke(); // ring behind
      g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      g.addColorStop(0, '#ffd9a0'); g.addColorStop(0.6, '#e08b4a'); g.addColorStop(1, '#7a3a2a');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120, 50, 30, 0.25)';
      ctx.fillRect(-r, -r * 0.2, r * 2, r * 0.12); ctx.fillRect(-r, r * 0.25, r * 2, r * 0.08);
      ctx.strokeStyle = 'rgba(255, 220, 170, 0.75)';
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.9, r * 0.45, 0, 0, Math.PI); ctx.stroke(); // ring in front
      ctx.restore();
    } else if (kind === 'nebula') {
      [[0, 0, 1, '255, 63, 180'], [-0.35, 0.2, 0.7, '62, 240, 255'], [0.3, -0.25, 0.6, '140, 90, 255'], [0.15, 0.35, 0.45, '255, 160, 90']].forEach(function (b) {
        var gx = x + b[0] * r, gy = y + b[1] * r, gr = b[2] * r;
        g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        g.addColorStop(0, 'rgba(' + b[3] + ', 0.28)'); g.addColorStop(1, 'rgba(' + b[3] + ', 0)');
        ctx.fillStyle = g;
        ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      });
    } else if (kind === 'giant') {
      g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, '#bff4ff'); g.addColorStop(0.55, '#3a8fd8'); g.addColorStop(1, '#10285e');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'; ctx.lineWidth = r * 0.06;
      for (var b = -3; b <= 3; b++) { ctx.beginPath(); ctx.ellipse(x, y + b * r * 0.26, r * 1.1, r * 0.06, Math.sin(now / 4000 + b) * 0.05, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    } else if (kind === 'galaxy') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(now / 9000 + seed);
      for (var arm = 0; arm < 2; arm++) {
        for (var i = 0; i < 70; i++) {
          var t = i / 70, a = arm * Math.PI + t * 4.2, d = t * r;
          ctx.fillStyle = 'rgba(' + (arm ? '200, 160, 255' : '255, 200, 240') + ',' + (0.6 * (1 - t)) + ')';
          ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d * 0.55, (1 - t) * r * 0.05 + 1, 0, Math.PI * 2); ctx.fill();
        }
      }
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.25);
      g.addColorStop(0, 'rgba(255, 250, 230, 0.9)'); g.addColorStop(1, 'rgba(255, 250, 230, 0)');
      ctx.fillStyle = g; ctx.fillRect(-r * 0.25, -r * 0.25, r * 0.5, r * 0.5);
      ctx.restore();
    }
  }

  // ---- the launch site (falls away as the rocket climbs) ----
  function groundY() { return H * 0.9; }
  function drawGround(now) {
    var off = scene.dist; // the ground drops as the camera climbs
    var gy = groundY() + off;
    if (gy - H * 0.3 > FULL_H) return;
    // horizon glow
    var hg = ctx.createLinearGradient(0, gy - H * 0.35, 0, gy);
    hg.addColorStop(0, 'rgba(62, 240, 255, 0)');
    hg.addColorStop(1, 'rgba(120, 140, 255, 0.28)');
    ctx.fillStyle = hg;
    ctx.fillRect(-LEFT, gy - H * 0.35, FULL_W, H * 0.35);
    // far mountains
    ctx.fillStyle = '#141b45';
    ctx.beginPath();
    ctx.moveTo(-LEFT, gy);
    for (var i = 0; i <= 12; i++) {
      var x = -LEFT + (FULL_W * i) / 12;
      ctx.lineTo(x, gy - H * (0.08 + 0.07 * Math.abs(Math.sin(i * 1.7 + 0.4))) + off * 0.0);
    }
    ctx.lineTo(FULL_W - LEFT, gy); ctx.closePath(); ctx.fill();
    // ground
    var gg = ctx.createLinearGradient(0, gy, 0, gy + H * 0.3);
    gg.addColorStop(0, '#0d1233'); gg.addColorStop(1, '#05071a');
    ctx.fillStyle = gg;
    ctx.fillRect(-LEFT, gy - 1, FULL_W, Math.max(H * 0.3, FULL_H));
    // searchlights sweeping the sky
    if (off < H) {
      [[0.18, 0], [0.84, 2]].forEach(function (s) {
        var a = -Math.PI / 2 + Math.sin(now / 1800 + s[1]) * 0.45, x0 = s[0] * W, len = H * 1.2;
        var lg = ctx.createLinearGradient(x0, gy, x0 + Math.cos(a) * len, gy + Math.sin(a) * len);
        lg.addColorStop(0, 'rgba(160, 220, 255, 0.22)'); lg.addColorStop(1, 'rgba(160, 220, 255, 0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(x0, gy);
        ctx.lineTo(x0 + Math.cos(a - 0.06) * len, gy + Math.sin(a - 0.06) * len);
        ctx.lineTo(x0 + Math.cos(a + 0.06) * len, gy + Math.sin(a + 0.06) * len);
        ctx.closePath(); ctx.fill();
      });
    }
    // launch tower (lattice) to the left of the pad, with blinking warning lights
    var tx = W * 0.5 - rocketH() * 0.42, th = rocketH() * 1.12, tw = rocketH() * 0.1;
    ctx.strokeStyle = '#4b5694'; ctx.lineWidth = 2;
    ctx.strokeRect(tx - tw, gy - th, tw, th);
    ctx.beginPath();
    for (var k = 0; k < 9; k++) {
      var yy = gy - (th * k) / 9;
      ctx.moveTo(tx - tw, yy); ctx.lineTo(tx, yy - th / 9);
      ctx.moveTo(tx, yy); ctx.lineTo(tx - tw, yy - th / 9);
    }
    ctx.stroke();
    ctx.fillStyle = (Math.floor(now / 500) % 2) ? '#ff3f6a' : '#5a1022';
    ctx.beginPath(); ctx.arc(tx - tw / 2, gy - th - 4, 3.5, 0, Math.PI * 2); ctx.fill();
    // the pad
    ctx.fillStyle = '#2a3270';
    ctx.fillRect(W * 0.5 - rocketH() * 0.32, gy - H * 0.022, rocketH() * 0.64, H * 0.022);
    ctx.fillStyle = 'rgba(62, 240, 255, 0.6)';
    ctx.fillRect(W * 0.5 - rocketH() * 0.32, gy - H * 0.022, rocketH() * 0.64, 2);
  }

  // ---- the rocket ----
  function rocketH() { return Math.min(H * 0.34, W * 0.5); }
  function padBase() { return { x: W * 0.5, y: groundY() - H * 0.022 + scene.dist, s: 1, a: 0 }; }
  // Rocket base (nozzle) position: on the pad, then the lift-off climb to cruise, then a gentle sway.
  function rocketAt(now) {
    var cruise = { x: W * 0.5, y: H * 0.8, s: 0.86 };
    if (!scene.launchAt) return { x: cruise.x, y: cruise.y, s: cruise.s, a: 0 };
    var t = now - scene.launchAt, pad = { x: W * 0.5, y: groundY() - H * 0.022, s: 1 };
    var k = easeIn(Math.min(1, t / LIFTOFF_MS) * 0.999);
    var sway = clamp01((t - LIFTOFF_MS) / 800);
    return {
      x: lerp(pad.x, cruise.x, k) + Math.sin(now / 900) * W * 0.018 * sway,
      y: lerp(pad.y, cruise.y, ease(t / LIFTOFF_MS)) + Math.sin(now / 650) * H * 0.008 * sway,
      s: lerp(pad.s, cruise.s, ease(t / LIFTOFF_MS)),
      a: Math.sin(now / 1100) * 0.05 * sway,
    };
  }

  function drawFlame(w, len, now, alpha) {
    if (len <= 0) return;
    var j = Math.sin(now / 35) * 0.06 + Math.sin(now / 21) * 0.04;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';
    var outer = ctx.createLinearGradient(0, 0, 0, len);
    outer.addColorStop(0, 'rgba(255, 245, 210, 0.95)');
    outer.addColorStop(0.25, 'rgba(255, 190, 70, 0.9)');
    outer.addColorStop(0.6, 'rgba(255, 70, 150, 0.55)');
    outer.addColorStop(1, 'rgba(255, 63, 180, 0)');
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(-w * 0.36, 0);
    ctx.quadraticCurveTo(-w * 0.5, len * 0.45, 0, len * (1 + j));
    ctx.quadraticCurveTo(w * 0.5, len * 0.45, w * 0.36, 0);
    ctx.closePath(); ctx.fill();
    var core = ctx.createLinearGradient(0, 0, 0, len * 0.55);
    core.addColorStop(0, 'rgba(220, 250, 255, 1)');
    core.addColorStop(1, 'rgba(62, 240, 255, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(-w * 0.18, 0);
    ctx.quadraticCurveTo(-w * 0.2, len * 0.3, 0, len * (0.55 - j));
    ctx.quadraticCurveTo(w * 0.2, len * 0.3, w * 0.18, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // (x, y) = nozzle base; h = rocket height; flame 0…1.
  function drawRocket(x, y, h, ang, flame, now) {
    var w = h * 0.25;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    drawFlame(w, h * 0.62 * flame, now, Math.min(1, flame * 1.5));
    // fins (behind the body)
    var fg = ctx.createLinearGradient(-w, 0, w, 0);
    fg.addColorStop(0, '#9b1468'); fg.addColorStop(0.5, '#ff3fb4'); fg.addColorStop(1, '#9b1468');
    ctx.fillStyle = fg;
    [-1, 1].forEach(function (sd) {
      ctx.beginPath();
      ctx.moveTo(sd * w * 0.48, -h * 0.34);
      ctx.quadraticCurveTo(sd * w * 1.1, -h * 0.12, sd * w * 1.02, h * 0.02);
      ctx.lineTo(sd * w * 0.86, h * 0.03);
      ctx.lineTo(sd * w * 0.48, -h * 0.08);
      ctx.closePath(); ctx.fill();
    });
    // nozzle
    ctx.fillStyle = '#2d3150';
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h * 0.085); ctx.lineTo(w * 0.3, -h * 0.085); ctx.lineTo(w * 0.4, 0); ctx.lineTo(-w * 0.4, 0);
    ctx.closePath(); ctx.fill();
    // body
    var bodyPath = function () {
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h * 0.08);
      ctx.lineTo(-w / 2, -h * 0.7);
      ctx.quadraticCurveTo(-w / 2, -h * 0.92, 0, -h);
      ctx.quadraticCurveTo(w / 2, -h * 0.92, w / 2, -h * 0.7);
      ctx.lineTo(w / 2, -h * 0.08);
      ctx.closePath();
    };
    var bg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    bg.addColorStop(0, '#7d88bd'); bg.addColorStop(0.35, '#ffffff'); bg.addColorStop(0.65, '#d4dcfb'); bg.addColorStop(1, '#58639b');
    ctx.fillStyle = bg;
    bodyPath(); ctx.fill();
    ctx.save();
    bodyPath(); ctx.clip();
    var ng = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    ng.addColorStop(0, '#a0186f'); ng.addColorStop(0.4, '#ff6fcf'); ng.addColorStop(1, '#9b1468');
    ctx.fillStyle = ng;
    ctx.fillRect(-w, -h, w * 2, h * 0.2); // nose cone
    ctx.fillStyle = 'rgba(62, 240, 255, 0.85)';
    ctx.fillRect(-w, -h * 0.3, w * 2, h * 0.035); // stripe
    ctx.fillStyle = 'rgba(20, 24, 60, 0.25)';
    ctx.fillRect(-w, -h * 0.16, w * 2, h * 0.012);
    ctx.restore();
    // porthole
    var pw = ctx.createRadialGradient(-w * 0.07, -h * 0.57, 1, 0, -h * 0.55, w * 0.22);
    pw.addColorStop(0, '#e9feff'); pw.addColorStop(0.35, '#3ef0ff'); pw.addColorStop(1, '#0b4c7a');
    ctx.fillStyle = pw;
    ctx.beginPath(); ctx.arc(0, -h * 0.55, w * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c7cff5'; ctx.lineWidth = Math.max(1.5, w * 0.06);
    ctx.stroke();
    ctx.restore();
  }

  // ---- particles: exhaust, pad smoke, sparks, debris ----
  function spawn(p) { if (particles.length < 520) particles.push(p); }
  function stepParticles(dt, now) {
    var s = dt / 1000;
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= s;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += (p.g || 0) * s;
      p.x += p.vx * s; p.y += p.vy * s + (p.scroll ? p.scroll * s : 0);
      p.r += (p.grow || 0) * s;
      if (p.spin) p.rot += p.spin * s;
      var a = Math.min(1, p.life / p.max) * (p.alpha || 1);
      if (p.kind === 'smoke') {
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'spark' || p.kind === 'ember') {
        ctx.globalAlpha = a;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else if (p.kind === 'debris') {
        ctx.globalAlpha = a;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.moveTo(-p.r, -p.r * 0.5); ctx.lineTo(p.r, -p.r * 0.2); ctx.lineTo(p.r * 0.4, p.r * 0.7); ctx.lineTo(-p.r * 0.7, p.r * 0.4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function exhaust(r, now, dt, strength) {
    var h = rocketH() * r.s, w = h * 0.25, n = Math.round((dt / 16) * 3 * strength);
    for (var i = 0; i < n; i++) {
      var ox = Math.sin(r.a) * h * 0.02;
      spawn({ kind: i % 3 ? 'ember' : 'smoke', x: r.x + rnd(-w * 0.25, w * 0.25) + ox, y: r.y + h * rnd(0.2, 0.45), vx: rnd(-20, 20), vy: rnd(160, 320), r: i % 3 ? rnd(1.2, 2.4) : rnd(w * 0.25, w * 0.45),
        grow: i % 3 ? 0 : 26, life: rnd(0.35, 0.8), max: 0.8, col: i % 3 ? (Math.random() < 0.5 ? '#ffd27a' : '#ff6fcf') : 'rgba(190, 200, 255, 1)', alpha: i % 3 ? 1 : 0.8 });
    }
  }
  function padSmoke(x, y, w, dt, power) {
    var n = Math.round((dt / 16) * 2 * power);
    for (var i = 0; i < n; i++) {
      var dir = Math.random() < 0.5 ? -1 : 1;
      spawn({ kind: 'smoke', x: x + rnd(-w, w) * 0.3, y: y - rnd(0, 6), vx: dir * rnd(60, 220) * power, vy: rnd(-30, 10), r: rnd(w * 0.2, w * 0.4), grow: 40, life: rnd(0.8, 1.6), max: 1.6, col: 'rgba(205, 215, 255, 1)', alpha: 0.6 });
    }
  }
  function explode(r) {
    var h = rocketH() * r.s, cx = r.x, cy = r.y - h * 0.5;
    for (var i = 0; i < 110; i++) {
      var a = Math.random() * Math.PI * 2, v = rnd(80, 460);
      spawn({ kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 240, r: rnd(1.4, 3.2), life: rnd(0.55, 1.25), max: 1.25, col: ['#ffe9a8', '#ff6fcf', '#3ef0ff', '#ffb347'][i % 4] });
    }
    for (var j = 0; j < 22; j++) {
      var b = Math.random() * Math.PI * 2, u = rnd(30, 140);
      spawn({ kind: 'smoke', x: cx, y: cy, vx: Math.cos(b) * u, vy: Math.sin(b) * u, r: rnd(h * 0.06, h * 0.12), grow: 60, life: rnd(0.8, 1.3), max: 1.3, col: 'rgba(120, 110, 160, 1)', alpha: 0.7 });
    }
    ['#d4dcfb', '#ff3fb4', '#ff3fb4', '#7d88bd'].forEach(function (col) {
      var a = rnd(-Math.PI, 0);
      spawn({ kind: 'debris', x: cx, y: cy, vx: Math.cos(a) * rnd(80, 200), vy: Math.sin(a) * rnd(120, 260), g: 420, r: h * rnd(0.05, 0.09), spin: rnd(-9, 9), rot: 0, life: 1.25, max: 1.25, col: col });
    });
  }

  // ---- countdown while bets are open ----
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawCountdown() {
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var p = S.phase === 'betting' ? clamp01((Date.now() - S.bettingStartsAt) / total) : 0;
    var left = S.phase === 'betting' ? Math.max(0, (S.bettingEndsAt - Date.now()) / 1000) : 0;
    var cx = W * 0.5, cy = H * 0.2, bw = Math.min(W * 0.56, 340), bh = Math.max(12, H * 0.036);
    ctx.font = '900 ' + Math.round(Math.max(13, H * 0.042)) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(62, 240, 255, 0.8)';
    ctx.shadowBlur = 12;
    ctx.fillText(S.phase === 'betting' ? S.bettingPhrase.toUpperCase() : '', cx, cy - H * 0.02);
    ctx.shadowBlur = 0;
    roundRect(cx - bw / 2, cy, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(6, 10, 34, 0.75)';
    ctx.fill();
    if (p > 0) {
      var inset = 3, fw = Math.max(bh - inset * 2, (bw - inset * 2) * (1 - p));
      roundRect(cx - bw / 2 + inset, cy + inset, fw, bh - inset * 2, (bh - inset * 2) / 2);
      var g = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      g.addColorStop(0, '#3ef0ff'); g.addColorStop(1, '#ff3fb4');
      ctx.fillStyle = g;
      ctx.fill();
    }
    roundRect(cx - bw / 2, cy, bw, bh, bh / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(62, 240, 255, 0.8)';
    ctx.stroke();
    if (S.phase === 'betting') {
      ctx.font = '800 ' + Math.round(Math.max(12, H * 0.034)) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#a9f8ff';
      ctx.fillText('T-' + left.toFixed(1) + 's', cx, cy + bh + H * 0.015);
    }
  }

  // ---- frame ----
  var themeAt = 0;
  function frame(now) {
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    var m = game.currentMult();
    // how far the rocket has climbed: the camera speeds up with the multiplier
    if (S.phase === 'flying') {
      var since = scene.launchAt ? now - scene.launchAt : LIFTOFF_MS;
      var lift = clamp01((since - LIFTOFF_MS * 0.35) / LIFTOFF_MS);
      scene.dist += H * 0.32 * (1 + Math.log(Math.max(1, m)) * 0.9) * lift * dt / 1000;
      engineSet(m);
    } else if (S.phase === 'crashed') {
      scene.dist += H * 0.06 * dt / 1000;
    }
    var h = scene.dist / Math.max(1, H);
    if (now - themeAt > 400) { themeAt = now; var tc = skyAt(h)[0]; if (S.phase !== 'flying') tc = tc.map(function (v) { return Math.round(v * 0.75); }); game.theme('#' + tc.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('')); }
    if (W && H) {
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      ctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
      drawSky(h, now);
      drawWonders(h, now);
      drawGround(now);
      var rh = rocketH();
      if (S.phase === 'betting' || S.phase === 'waiting') {
        var pb = padBase();
        if (Math.random() < 0.25) padSmoke(pb.x, pb.y, rh * 0.25, dt, 0.25); // venting vapour
        stepParticles(dt, now);
        drawRocket(pb.x, pb.y, rh, 0, 0, now);
        ctx.fillStyle = 'rgba(4, 6, 20, 0.22)'; // calm dusk while bets are open
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
        drawCountdown();
      } else if (S.phase === 'flying') {
        if (!scene.launchAt) scene.launchAt = now - LIFTOFF_MS * 2; // joined mid-flight
        var r = rocketAt(now), t = now - scene.launchAt;
        var flame = t < 250 ? t / 250 : 1;
        if (t < LIFTOFF_MS) padSmoke(W * 0.5, groundY() - H * 0.022 + scene.dist, rh * 0.25, dt, 1 - t / LIFTOFF_MS);
        exhaust(r, now, dt, 1);
        stepParticles(dt, now);
        drawRocket(r.x, r.y, rh * r.s, r.a, flame * (0.9 + 0.1 * Math.sin(now / 60)), now);
      } else if (S.phase === 'crashed') {
        var ct = now - scene.crashAt, cr = scene.crashFrom;
        if (cr && ct < FLAMEOUT_MS) { // flame-out: the engine sputters and the rocket starts to tip
          var k = ct / FLAMEOUT_MS;
          stepParticles(dt, now);
          drawRocket(cr.x, cr.y + k * H * 0.02, rh * cr.s, cr.a + k * 0.5, (1 - k) * (Math.floor(ct / 50) % 2 ? 0.25 : 0.7), now);
        } else {
          if (cr && !cr.blown) { cr.blown = true; explode(cr); }
          var bt = ct - FLAMEOUT_MS;
          if (cr && bt < 500) { // flash + shock ring
            var fr = rh * cr.s, cx = cr.x, cy = cr.y - fr * 0.5;
            ctx.globalCompositeOperation = 'lighter';
            var fl = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr * (0.5 + bt / 400));
            fl.addColorStop(0, 'rgba(255, 245, 220,' + (1 - bt / 500) + ')');
            fl.addColorStop(1, 'rgba(255, 63, 180, 0)');
            ctx.fillStyle = fl;
            ctx.fillRect(cx - fr * 2, cy - fr * 2, fr * 4, fr * 4);
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(62, 240, 255,' + (1 - bt / 500) + ')';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(cx, cy, fr * (0.2 + bt / 300), 0, Math.PI * 2); ctx.stroke();
          }
          stepParticles(dt, now);
        }
        ctx.fillStyle = 'rgba(4, 6, 20, 0.2)';
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      }
      ctx.restore();
    }
    // texts over the scene
    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden && flew.textContent !== S.crashPhrase) flew.textContent = S.crashPhrase;
    if (S.phase === 'flying') {
      mult.className = 'mult'; mult.textContent = m.toFixed(2) + 'x'; hint.textContent = '';
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      mult.className = 'mult mult--crashed'; mult.textContent = S.crashPoint.toFixed(2) + 'x'; hint.textContent = '';
    } else if (S.phase === 'betting') {
      mult.textContent = ''; hint.textContent = '';
    } else {
      mult.textContent = ''; hint.textContent = S.gotSnapshot ? 'Waiting for the next launch…' : 'Connecting…';
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
      b.onclick = function () { sfxClick(); setAmount(p, v); };
      p.quick.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { panels.forEach(function (p) { buildQuick(p); setAmount(p, l.min); }); });

  panels.forEach(function (p) {
    Array.prototype.forEach.call(p.el.querySelectorAll('.stepper__btn'), function (b) {
      b.onclick = function () { sfxClick(); setAmount(p, readAmount(p) + Number(b.dataset.step) * game.limit().min); };
    });
    p.amount.oninput = function () { updateButton(p); };
    p.amount.onblur = function () { setAmount(p, readAmount(p) || game.limit().min); };
    p.action.onclick = function () {
      sfxClick();
      if (S.queued[p.slot]) return game.cancelQueued(p.slot);
      var my = S.my[p.slot];
      if (my && my.round === S.round && my.status === 'placed' && S.phase === 'flying') return game.cashOut(p.slot);
      if (my && my.round === S.round && my.status !== 'lost' && my.status !== 'cashed') return;
      game.bet(p.slot, readAmount(p), readAuto(p));
    };
  });

  $('back').onclick = function () { sfxClick(); game.back(); };
  $('sound').onclick = function () { wake(); setSound(!soundOn); sfxClick(); };
  $('music').onclick = function () {
    wake();
    musicOn = !musicOn;
    try { localStorage.setItem(KEY + '-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncMusic();
  };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      sfxClick();
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
  wake(); // try to start the music now (allowed when the game was opened with a tap)
  window.addEventListener('resize', fit);
  // The results row fills in after load (and the bets list / bar can change size): refit.
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
