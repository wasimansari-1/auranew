/* Sky Ace — NEXORNG original crash game. Game logic: ../_core/crash-client.js; this file is
 * the look and sound, all made in code: a fighter jet on the carrier's catapult while bets are
 * open, the catapult launch, the climb through clouds, sunset and the stratosphere into space,
 * and the stall and spiral at the crash. Sound effects and music are generated with WebAudio. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0022', onChange: render, onSignal: onSignal });
  var S = game.S;
  var KEY = 'skyace';

  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000); // never hang the loader

  // ---------------------------------------------------------------- timings (sound = animation)
  var LAUNCH_MS = 1400; // catapult run + pull-up (the launch sound lasts exactly this long)
  var STALL_MS = 300; // the engine coughs, then…
  var SPIRAL_MS = 1300; // …the jet spirals away (sound and animation end together)

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
    o.type = 'triangle';
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + 0.08);
  }

  // Catapult hiss + the engine spooling up: lasts exactly `ms`, like the launch animation.
  function sfxLaunch(ms) {
    if (!live()) return;
    var t = ac.currentTime, d = ms / 1000;
    var n = noiseSrc(), hp = ac.createBiquadFilter(), g = ac.createGain();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d * 0.6);
    n.connect(hp); hp.connect(g); g.connect(sfxBus);
    n.start(t); n.stop(t + d);
    var o = ac.createOscillator(), lp = ac.createBiquadFilter(), og = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(430, t + d);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(3200, t + d);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.22, t + d * 0.5);
    og.gain.setValueAtTime(0.22, t + d - 0.12);
    og.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(lp); lp.connect(og); og.connect(sfxBus);
    o.start(t); o.stop(t + d + 0.02);
  }

  // The jet's roar in flight; its whine rises with the multiplier.
  function engineStart() {
    if (!live() || engine) return;
    var t = ac.currentTime, n = noiseSrc(), bp = ac.createBiquadFilter(), g = ac.createGain();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.25);
    var o = ac.createOscillator(), og = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 430;
    og.gain.value = 0.035;
    n.connect(bp); bp.connect(g); o.connect(og); og.connect(g); g.connect(sfxBus);
    n.start(t); o.start(t);
    engine = { n: n, o: o, f: bp, g: g };
  }
  function engineSet(m) {
    if (!engine || !live()) return;
    var k = Math.log(Math.max(1, m));
    engine.f.frequency.setTargetAtTime(1400 + 420 * k, ac.currentTime, 0.2);
    engine.o.frequency.setTargetAtTime(430 + 90 * k, ac.currentTime, 0.2);
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

  // Engine cough, then the falling whine of the spiral: exactly STALL_MS + SPIRAL_MS.
  function sfxStall() {
    if (!live()) return;
    var t = ac.currentTime, st = STALL_MS / 1000, d = SPIRAL_MS / 1000;
    var n = noiseSrc(), lp = ac.createBiquadFilter(), g = ac.createGain();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + st + d);
    g.gain.setValueAtTime(0.0001, t);
    for (var i = 0; i < 4; i++) { // cough
      g.gain.setValueAtTime(0.3, t + i * st / 4);
      g.gain.setValueAtTime(0.03, t + i * st / 4 + st / 8);
    }
    g.gain.setValueAtTime(0.35, t + st);
    g.gain.exponentialRampToValueAtTime(0.0001, t + st + d);
    n.connect(lp); lp.connect(g); g.connect(sfxBus);
    n.start(t); n.stop(t + st + d + 0.02);
    var o = ac.createOscillator(), og = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(620, t + st);
    o.frequency.exponentialRampToValueAtTime(70, t + st + d);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.setValueAtTime(0.12, t + st);
    og.gain.exponentialRampToValueAtTime(0.0001, t + st + d);
    o.connect(og); og.connect(sfxBus);
    o.start(t + st); o.stop(t + st + d + 0.02);
  }

  function sfxWin() {
    if (!live() || !soundOn) return;
    var t = ac.currentTime;
    [784, 988, 1175, 1568].forEach(function (fr, i) {
      var o = ac.createOscillator(), g = ac.createGain(), s = t + i * 0.07;
      o.type = 'square';
      o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.07, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.35);
      o.connect(g); g.connect(sfxBus);
      o.start(s); o.stop(s + 0.4);
    });
  }

  // Generated flight music: driving bass pulse + bright arpeggio (D minor · B♭ · F · C).
  var CHORDS = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]];
  var BEAT = 0.42, musicNext = 0, musicStep = 0, musicTimer = null;
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function note(m, at, dur, type, vol, cutoff) {
    var o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = type;
    o.frequency.value = hz(m);
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(f); f.connect(g); g.connect(musicBus);
    o.start(at); o.stop(at + dur + 0.05);
  }
  function scheduleMusic() {
    if (!live()) return;
    if (musicNext < ac.currentTime) musicNext = ac.currentTime + 0.05;
    while (musicNext < ac.currentTime + 0.6) {
      var bar = Math.floor(musicStep / 8), chord = CHORDS[bar % CHORDS.length], s = musicStep % 8;
      note(chord[0] - 12, musicNext, BEAT * 0.45, 'square', 0.05, 500); // bass pulse on every eighth
      if (s % 2 === 0) note(chord[(s / 2) % 3] + 12, musicNext, BEAT * 0.9, 'triangle', 0.045, 2600);
      if (s === 0) chord.forEach(function (m) { note(m + 12, musicNext, BEAT * 8, 'sawtooth', 0.018, 1400); });
      if (s === 4 || s === 0) note(98 - 12, musicNext, 0.05, 'square', 0.025, 6000); // tick
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
    musicBus.gain.setTargetAtTime(musicOn ? 0.85 : 0, t, 0.3);
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
  var scene = { launchAt: 0, crashAt: 0, crashFrom: null, dist: 0, worldX: 0, lastT: 0 };
  var particles = []; // steam / contrail / smoke / embers
  var engineTimer = null;
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') {
      scene.launchAt = now;
      sfxLaunch(LAUNCH_MS);
      clearTimeout(engineTimer);
      engineTimer = setTimeout(function () { if (S.phase === 'flying') engineStart(); }, LAUNCH_MS);
    }
    if (name === 'crash') {
      scene.crashAt = now;
      scene.crashFrom = scene.launchAt ? jetAt(now) : null;
      clearTimeout(engineTimer);
      engineStop(60);
      sfxStall();
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
    el.innerHTML = // cockpit throttle panel: HUD stake readout with a rocker, preset keys, the throttle lever
      '<div class="cockpit">' +
      '<div class="hud"><span class="hud__label">STAKE</span>' +
      '<div class="stepper hud__row"><input class="amount" inputmode="decimal" value="1.00" aria-label="Bet amount">' +
      '<span class="hud__rocker"><button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">▲</button>' +
      '<button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">▼</button></span></div></div>' +
      '<div class="quick cockpit__presets" aria-label="Quick amounts"></div>' +
      '<button type="button" class="action"><span class="cockpit__grip" aria-hidden="true"></span><span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      '<div class="auto cockpit__eject"><span class="cockpit__eject-label">AUTO EJECT AT</span>' +
      '<input class="auto__x" inputmode="decimal" value="1.50" aria-label="Auto cash-out multiplier">' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label></div>' +
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
  function easeInOut(t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rgb(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')'; }

  // ---- sky: day over the ocean → clouds → sunset → dusk → stratosphere → space ----
  var SKY = [ // [height in screens, top colour, bottom colour]
    [0, [78, 146, 214], [196, 226, 244]],
    [1.3, [58, 112, 190], [160, 200, 236]],
    [2.6, [70, 54, 128], [255, 150, 90]],
    [4, [28, 30, 84], [150, 80, 120]],
    [5.6, [8, 14, 44], [34, 62, 120]],
    [7.4, [2, 4, 14], [8, 14, 40]],
  ];
  function skyAt(h) {
    for (var i = 0; i < SKY.length - 1; i++) {
      if (h <= SKY[i + 1][0]) {
        var k = (h - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
        return [0, 1].map(function (j) { return SKY[i][j + 1].map(function (v, c) { return Math.round(lerp(v, SKY[i + 1][j + 1][c], k)); }); });
      }
    }
    return [SKY[SKY.length - 1][1], SKY[SKY.length - 1][2]];
  }

  var CLOUDS = [];
  for (var ci = 0; ci < 30; ci++) CLOUDS.push({ h: rnd(0.35, 4.4), x: Math.random(), s: rnd(0.5, 1.4), seed: Math.random() * 10 });
  var STARS = [];
  for (var si = 0; si < 110; si++) STARS.push({ x: Math.random(), y: Math.random() * 0.9, r: rnd(0.5, 1.6), t: Math.random() * 6 });
  var STREAKS = [];
  for (var ki = 0; ki < 12; ki++) STREAKS.push({ x: Math.random(), y: Math.random(), l: rnd(0.08, 0.22) });

  function drawSky(h, now) {
    var c = skyAt(h);
    var g = ctx.createLinearGradient(0, -TOP, 0, H);
    g.addColorStop(0, rgb(c[0]));
    g.addColorStop(1, rgb(c[1]));
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    // stars above the stratosphere
    var starA = clamp01((h - 4.6) / 1.8);
    if (starA > 0) {
      STARS.forEach(function (s) {
        ctx.globalAlpha = starA * (0.55 + 0.45 * Math.sin(now / 700 + s.t));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(s.x * FULL_W - LEFT, s.y * FULL_H - TOP, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    // the sun sinking through the sunset band
    var sunA = clamp01(1 - Math.abs(h - 2.8) / 1.5);
    if (sunA > 0) {
      var sx = W * 0.78, sy = H * 0.5 + (h - 2.6) * H * 0.45, sr = H * 0.11;
      var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2);
      sg.addColorStop(0, 'rgba(255, 244, 214,' + sunA + ')');
      sg.addColorStop(0.28, 'rgba(255, 196, 110,' + sunA * 0.9 + ')');
      sg.addColorStop(0.32, 'rgba(255, 150, 80,' + sunA * 0.35 + ')');
      sg.addColorStop(1, 'rgba(255, 120, 60, 0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx - sr * 3.2, sy - sr * 3.2, sr * 6.4, sr * 6.4);
    }
    // the curve of the Earth below, glowing, once the jet is high enough
    var curveA = clamp01((h - 4.4) / 1.6);
    if (curveA > 0) {
      var cx = W * 0.5, r = Math.max(W, H) * 1.6, cy = H * (1.05 + 0.25 * (1 - curveA)) + r - H * 0.18;
      ctx.save();
      ctx.globalAlpha = curveA;
      var eg = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r);
      eg.addColorStop(0, '#071a3a'); eg.addColorStop(0.97, '#1f5fae'); eg.addColorStop(1, '#7fd0ff');
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(140, 210, 255, 0.7)';
      ctx.lineWidth = 6;
      ctx.shadowColor = 'rgba(120, 200, 255, 0.9)';
      ctx.shadowBlur = 24;
      ctx.beginPath(); ctx.arc(cx, cy, r + 2, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.restore();
    }
  }

  // Long flights keep changing in space: a satellite, a moon, auroras over the Earth and a
  // comet pass by, repeating every 8 screens of climb.
  var SPACE = [{ h: 6.6, kind: 'satellite', x: 0.72 }, { h: 8.6, kind: 'moon', x: 0.2 }, { h: 10.6, kind: 'aurora', x: 0.5 }, { h: 12.6, kind: 'comet', x: 0.8 }];
  function drawSpace(h, now) {
    if (h < 5.4) return;
    var cycle = Math.floor((h - 5.4) / 8);
    for (var k = Math.max(0, cycle - 1); k <= cycle + 1; k++) {
      SPACE.forEach(function (o) {
        var oh = o.h + k * 8, y = H * 0.32 - (oh - h) * H * 0.6, x = (k % 2 ? 1 - o.x : o.x) * W;
        if (y < -TOP - H * 0.6 || y > FULL_H + H * 0.6) return;
        if (o.kind === 'satellite') {
          ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(now / 3000) * 0.3);
          var u = H * 0.05;
          ctx.fillStyle = '#c9d4e0'; ctx.fillRect(-u * 0.5, -u * 0.35, u, u * 0.7);
          ctx.fillStyle = '#2b5fa8';
          ctx.fillRect(-u * 2.2, -u * 0.3, u * 1.5, u * 0.6); ctx.fillRect(u * 0.7, -u * 0.3, u * 1.5, u * 0.6);
          ctx.strokeStyle = 'rgba(160, 200, 255, 0.6)'; ctx.lineWidth = 1;
          for (var g = 1; g < 4; g++) { ctx.beginPath(); ctx.moveTo(-u * 2.2 + g * u * 0.37, -u * 0.3); ctx.lineTo(-u * 2.2 + g * u * 0.37, u * 0.3); ctx.moveTo(u * 0.7 + g * u * 0.37, -u * 0.3); ctx.lineTo(u * 0.7 + g * u * 0.37, u * 0.3); ctx.stroke(); }
          ctx.fillStyle = (Math.floor(now / 700) % 2) ? '#ff4a3a' : '#40ff9a'; ctx.beginPath(); ctx.arc(0, -u * 0.45, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } else if (o.kind === 'moon') {
          var r = H * 0.14, mg = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
          mg.addColorStop(0, '#fffaf0'); mg.addColorStop(0.7, '#cfc8bd'); mg.addColorStop(1, '#7c7784');
          ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(90, 86, 100, 0.3)';
          [[-0.3, -0.1, 0.18], [0.25, 0.3, 0.12], [0.2, -0.35, 0.1]].forEach(function (c) { ctx.beginPath(); ctx.arc(x + c[0] * r, y + c[1] * r, c[2] * r, 0, Math.PI * 2); ctx.fill(); });
        } else if (o.kind === 'aurora') {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          [['80, 255, 170', 0], ['80, 200, 255', 1.3], ['190, 110, 255', 2.4]].forEach(function (b, i) {
            // a soft curtain: it fades in from nothing at its wavy top and out again at its foot
            var top = y - H * 0.34 - i * H * 0.04, foot = y + H * 0.12;
            var ag = ctx.createLinearGradient(0, top, 0, foot);
            ag.addColorStop(0, 'rgba(' + b[0] + ', 0)'); ag.addColorStop(0.55, 'rgba(' + b[0] + ', 0.16)'); ag.addColorStop(1, 'rgba(' + b[0] + ', 0)');
            ctx.fillStyle = ag;
            ctx.beginPath(); ctx.moveTo(-LEFT, foot);
            for (var xx = -LEFT; xx <= FULL_W - LEFT + 20; xx += 20) ctx.lineTo(xx, top + H * 0.05 - Math.sin(xx / 90 + now / 900 + b[1]) * H * 0.05);
            ctx.lineTo(FULL_W - LEFT + 20, foot); ctx.closePath(); ctx.fill();
          });
          ctx.restore();
        } else if (o.kind === 'comet') {
          var cx = x + Math.sin(now / 4000) * W * 0.05, len = W * 0.45;
          var cg = ctx.createLinearGradient(cx, y, cx - len, y + len * 0.35);
          cg.addColorStop(0, 'rgba(255, 255, 255, 0.95)'); cg.addColorStop(0.15, 'rgba(160, 220, 255, 0.6)'); cg.addColorStop(1, 'rgba(160, 220, 255, 0)');
          ctx.strokeStyle = cg; ctx.lineWidth = H * 0.02; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx - len, y + len * 0.35); ctx.stroke(); ctx.lineCap = 'butt';
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, y, H * 0.014, 0, Math.PI * 2); ctx.fill();
        }
      });
    }
  }

  function cloudShape(x, y, s, col, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    [[0, 0, 1], [-0.6, 0.15, 0.72], [0.62, 0.12, 0.78], [-0.25, -0.28, 0.68], [0.28, -0.22, 0.62], [1.1, 0.25, 0.5], [-1.05, 0.28, 0.48]].forEach(function (b) {
      ctx.beginPath();
      ctx.ellipse(x + b[0] * 60 * s, y + b[1] * 30 * s, 44 * s * b[2], 26 * s * b[2], 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  function drawClouds(h, front) {
    var sunset = clamp01(1 - Math.abs(h - 2.7) / 1.4), night = clamp01((h - 3.8) / 1.5);
    var col = 'rgb(' + Math.round(lerp(lerp(255, 255, sunset), 120, night)) + ',' + Math.round(lerp(lerp(255, 196, sunset), 120, night)) + ',' + Math.round(lerp(lerp(255, 170, sunset), 160, night)) + ')';
    var span = FULL_W + 400;
    CLOUDS.forEach(function (c) {
      if ((c.s > 1.05) !== front) return; // big near clouds pass in front of the jet
      var y = H * 0.6 - (c.h - h) * H * 0.75;
      if (y < -TOP - 120 || y > FULL_H + 120) return;
      var par = 0.25 + c.s * 0.45;
      var x = ((c.x * span - scene.worldX * par) % span + span) % span - 200 - LEFT;
      var sc = c.s * (H / 420);
      cloudShape(x, y + 4 * sc, sc, 'rgba(60, 80, 120, 1)', 0.12); // soft shadow
      cloudShape(x, y, sc, col, front ? 0.92 : 0.8);
    });
  }

  // ---- the carrier on the ocean (drops away as the jet climbs) ----
  function deckY() { return H * 0.8 + scene.dist; }
  function drawSea(now) {
    var top = H * 0.72 + scene.dist;
    if (top > FULL_H) return;
    var g = ctx.createLinearGradient(0, top, 0, top + H * 0.4);
    g.addColorStop(0, '#2b6aa3'); g.addColorStop(1, '#0c2a4d');
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, top, FULL_W, FULL_H);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    for (var i = 0; i < 18; i++) {
      var y = top + 6 + (i % 6) * (H * 0.04) + Math.floor(i / 6) * 3;
      var x = ((i * 137 - scene.worldX * (0.6 + (i % 6) * 0.2)) % (FULL_W + 80) + FULL_W + 80) % (FULL_W + 80) - 40 - LEFT;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 14, y - 3, x + 28 + (i % 3) * 8, y); ctx.stroke();
    }
  }
  function drawCarrier(now, progress) {
    var dy = deckY();
    if (dy - H * 0.3 > FULL_H) return;
    var x0 = -LEFT - 20, x1 = W * 0.98, th = H * 0.035;
    // hull
    var hg = ctx.createLinearGradient(0, dy, 0, dy + H * 0.12);
    hg.addColorStop(0, '#4b5866'); hg.addColorStop(1, '#2a323c');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(x0, dy + th); ctx.lineTo(x1, dy + th); ctx.lineTo(x1 - W * 0.06, dy + H * 0.12); ctx.lineTo(x0, dy + H * 0.12);
    ctx.closePath(); ctx.fill();
    // flight deck
    ctx.fillStyle = '#3a434e';
    ctx.beginPath();
    ctx.moveTo(x0, dy); ctx.lineTo(x1 + W * 0.02, dy); ctx.lineTo(x1, dy + th); ctx.lineTo(x0, dy + th);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#566270';
    ctx.fillRect(x0, dy - 1, x1 - x0 + W * 0.02, 2);
    // deck markings + catapult track
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.setLineDash([14, 10]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W * 0.05, dy + th * 0.5); ctx.lineTo(W * 0.95, dy + th * 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 162, 58, 0.8)';
    ctx.beginPath(); ctx.moveTo(W * 0.2, dy + th * 0.25); ctx.lineTo(W * 0.82, dy + th * 0.25); ctx.stroke();
    // island tower with a turning radar and a beacon
    var ix = W * 0.74, iw = W * 0.1, ih = H * 0.16;
    ctx.fillStyle = '#56626f';
    ctx.fillRect(ix, dy - ih, iw, ih);
    ctx.fillStyle = '#7fc2ff';
    for (var wi = 0; wi < 3; wi++) ctx.fillRect(ix + iw * (0.12 + wi * 0.3), dy - ih * 0.82, iw * 0.2, ih * 0.1);
    ctx.fillStyle = '#4a5562';
    ctx.fillRect(ix + iw * 0.4, dy - ih * 1.35, iw * 0.12, ih * 0.35);
    var ra = now / 500;
    ctx.fillStyle = '#9aa7b5';
    ctx.beginPath(); ctx.ellipse(ix + iw * 0.46, dy - ih * 1.38, iw * 0.35 * Math.abs(Math.cos(ra)) + 1, ih * 0.05, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = (Math.floor(now / 600) % 2) ? '#ff4a3a' : '#5a1510';
    ctx.beginPath(); ctx.arc(ix + iw * 0.46, dy - ih * 1.5, 3, 0, Math.PI * 2); ctx.fill();
    // deck edge lights = time left to bet (they light up one by one)
    var n = 14;
    for (var li = 0; li < n; li++) {
      var lx = W * 0.08 + (W * 0.84 * li) / (n - 1), on = progress == null ? (Math.floor(now / 300 + li) % 2 === 0) : li < Math.round(progress * n);
      ctx.fillStyle = on ? '#ffb04a' : 'rgba(255, 176, 74, 0.18)';
      if (on) { ctx.shadowColor = '#ff9a2a'; ctx.shadowBlur = 10; }
      ctx.beginPath(); ctx.arc(lx, dy + th + 4, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ---- the jet ----
  function jetL() { return Math.min(W * 0.46, H * 0.62); }
  // Jet centre, angle and scale: on the catapult, the launch run + pull-up, then cruising.
  function jetAt(now) {
    var L = jetL(), parked = { x: W * 0.27, y: H * 0.8 - L * 0.1, a: 0, s: 1 };
    var cruise = { x: W * 0.47, y: H * 0.66, a: -0.05, s: 0.82 };
    if (!scene.launchAt) return { x: cruise.x, y: cruise.y, a: cruise.a, s: cruise.s };
    var t = now - scene.launchAt, run = LAUNCH_MS * 0.55;
    if (t < run) { // catapult run along the deck
      var k = easeIn(t / run);
      return { x: lerp(parked.x, W * 0.66, k), y: parked.y + scene.dist, a: 0, s: 1 };
    }
    if (t < LAUNCH_MS) { // pull-up to cruise
      var u = (t - run) / (LAUNCH_MS - run);
      return { x: lerp(W * 0.66, cruise.x, easeInOut(u)), y: lerp(parked.y, cruise.y, ease(u)), a: -0.42 * Math.sin(Math.PI * u) + cruise.a * u, s: lerp(1, cruise.s, ease(u)) };
    }
    var w = clamp01((t - LAUNCH_MS) / 700);
    return { x: cruise.x + Math.sin(now / 1300) * W * 0.02 * w, y: cruise.y + Math.sin(now / 800) * H * 0.012 * w, a: cruise.a + Math.sin(now / 1100) * 0.035 * w, s: cruise.s };
  }

  // Side view, facing right. (x, y) = centre; L = length; burn 0…1 (afterburner).
  function drawJet(x, y, L, ang, burn, now, roll) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (roll != null) ctx.scale(1, roll);
    var P = function (px, py) { return [px * L, py * L]; };
    // afterburner
    if (burn > 0) {
      var len = L * (0.22 + 0.14 * burn) * (0.92 + 0.08 * Math.sin(now / 30));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var ag = ctx.createLinearGradient(-L * 0.5, 0, -L * 0.5 - len, 0);
      ag.addColorStop(0, 'rgba(255, 250, 230, 0.95)');
      ag.addColorStop(0.3, 'rgba(255, 170, 60, 0.85)');
      ag.addColorStop(1, 'rgba(255, 90, 20, 0)');
      ctx.fillStyle = ag;
      ctx.beginPath();
      ctx.moveTo(-L * 0.49, -L * 0.035); ctx.quadraticCurveTo(-L * 0.5 - len * 0.6, -L * 0.03, -L * 0.5 - len, 0);
      ctx.quadraticCurveTo(-L * 0.5 - len * 0.6, L * 0.03, -L * 0.49, L * 0.035); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(120, 200, 255, 0.6)';
      for (var di = 1; di <= 3; di++) { ctx.beginPath(); ctx.arc(-L * 0.5 - len * 0.22 * di, 0, L * 0.012, 0, Math.PI * 2); ctx.fill(); } // shock diamonds
      ctx.restore();
    }
    // far wing (behind the body)
    ctx.fillStyle = '#4e5f72';
    var fw = [P(0.02, 0.0), P(-0.3, -0.13), P(-0.36, -0.13), P(-0.22, 0.0)];
    ctx.beginPath(); ctx.moveTo(fw[0][0], fw[0][1]); fw.slice(1).forEach(function (p) { ctx.lineTo(p[0], p[1]); }); ctx.closePath(); ctx.fill();
    // tail fin
    var tg = ctx.createLinearGradient(0, -L * 0.28, 0, 0);
    tg.addColorStop(0, '#b9c6d4'); tg.addColorStop(1, '#7f90a3');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.moveTo(-L * 0.26, -L * 0.06); ctx.lineTo(-L * 0.44, -L * 0.27); ctx.lineTo(-L * 0.5, -L * 0.27); ctx.lineTo(-L * 0.47, -L * 0.05); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff8a1f';
    ctx.beginPath(); ctx.moveTo(-L * 0.41, -L * 0.2); ctx.lineTo(-L * 0.47, -L * 0.2); ctx.lineTo(-L * 0.455, -L * 0.13); ctx.lineTo(-L * 0.37, -L * 0.13); ctx.closePath(); ctx.fill();
    // fuselage
    var fg = ctx.createLinearGradient(0, -L * 0.07, 0, L * 0.07);
    fg.addColorStop(0, '#eef3f9'); fg.addColorStop(0.45, '#aebccb'); fg.addColorStop(1, '#5b6d82');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0);
    ctx.quadraticCurveTo(L * 0.36, -L * 0.035, L * 0.26, -L * 0.055);
    ctx.lineTo(L * 0.05, -L * 0.07); ctx.lineTo(-L * 0.36, -L * 0.065); ctx.lineTo(-L * 0.5, -L * 0.04);
    ctx.lineTo(-L * 0.5, L * 0.04); ctx.lineTo(-L * 0.32, L * 0.065); ctx.lineTo(L * 0.24, L * 0.05);
    ctx.quadraticCurveTo(L * 0.38, L * 0.03, L * 0.5, 0);
    ctx.closePath(); ctx.fill();
    // orange speed stripe + nose tip
    ctx.fillStyle = '#ff8a1f';
    ctx.beginPath(); ctx.moveTo(L * 0.18, -L * 0.012); ctx.lineTo(-L * 0.3, -L * 0.006); ctx.lineTo(-L * 0.3, L * 0.012); ctx.lineTo(L * 0.18, L * 0.008); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a3442';
    ctx.beginPath(); ctx.moveTo(L * 0.5, 0); ctx.lineTo(L * 0.42, -L * 0.018); ctx.lineTo(L * 0.42, L * 0.016); ctx.closePath(); ctx.fill();
    // intake + nozzle
    ctx.fillStyle = '#1d2530';
    ctx.fillRect(L * 0.02, L * 0.015, L * 0.12, L * 0.04);
    ctx.fillStyle = '#323c49';
    ctx.fillRect(-L * 0.52, -L * 0.038, L * 0.04, L * 0.076);
    // canopy
    var cg = ctx.createLinearGradient(L * 0.1, -L * 0.12, L * 0.3, -L * 0.05);
    cg.addColorStop(0, '#d8f4ff'); cg.addColorStop(0.5, '#4fc3ff'); cg.addColorStop(1, '#13466e');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(L * 0.17, -L * 0.065, L * 0.12, L * 0.045, -0.05, Math.PI, Math.PI * 2); ctx.fill();
    // near wing + roundel (our own emblem: an orange star in a white ring)
    var wg = ctx.createLinearGradient(0, 0, 0, L * 0.2);
    wg.addColorStop(0, '#8d9db0'); wg.addColorStop(1, '#5d6e81');
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.moveTo(L * 0.06, L * 0.02); ctx.lineTo(-L * 0.3, L * 0.19); ctx.lineTo(-L * 0.37, L * 0.19); ctx.lineTo(-L * 0.2, L * 0.03); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff8a1f';
    ctx.beginPath(); ctx.moveTo(-L * 0.3, L * 0.19); ctx.lineTo(-L * 0.37, L * 0.19); ctx.lineTo(-L * 0.345, L * 0.165); ctx.lineTo(-L * 0.28, L * 0.165); ctx.closePath(); ctx.fill();
    var rx = -L * 0.16, ry = L * 0.09, rr = L * 0.028;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff8a1f';
    ctx.beginPath();
    for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? rr * 0.42 : rr * 0.9; ctx.lineTo(rx + Math.cos(a) * rad, ry + Math.sin(a) * rad); }
    ctx.closePath(); ctx.fill();
    // horizontal stabiliser
    ctx.fillStyle = '#7b8b9e';
    ctx.beginPath(); ctx.moveTo(-L * 0.34, L * 0.02); ctx.lineTo(-L * 0.47, L * 0.08); ctx.lineTo(-L * 0.5, L * 0.08); ctx.lineTo(-L * 0.46, L * 0.02); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---- particles: catapult steam, contrail, smoke, embers ----
  function spawn(p) { if (particles.length < 520) particles.push(p); }
  function stepParticles(dt) {
    var s = dt / 1000;
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= s;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += (p.g || 0) * s;
      p.x += p.vx * s; p.y += p.vy * s;
      p.r += (p.grow || 0) * s;
      var a = Math.min(1, p.life / p.max) * (p.alpha || 1);
      ctx.globalAlpha = a;
      if (p.kind === 'ember') ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }
  function tailOf(j) { var L = jetL() * j.s; return { x: j.x - Math.cos(j.a) * L * 0.5, y: j.y - Math.sin(j.a) * L * 0.5 }; }
  function contrail(j, dt, speed) {
    var t = tailOf(j), n = Math.max(1, Math.round(dt / 16));
    for (var i = 0; i < n; i++) spawn({ x: t.x - rnd(0, 12), y: t.y + rnd(-2, 2), vx: -speed * rnd(0.85, 1), vy: rnd(-6, 6), r: rnd(2, 4), grow: 9, life: rnd(0.6, 1.1), max: 1.1, col: '#ffffff', alpha: 0.55 });
  }
  function steam(x, y, dt, power) {
    var n = Math.round((dt / 16) * 2 * power);
    for (var i = 0; i < n; i++) spawn({ x: x + rnd(-20, 20), y: y - rnd(0, 6), vx: rnd(-80, -10), vy: rnd(-50, -10), r: rnd(6, 14), grow: 30, life: rnd(0.6, 1.2), max: 1.2, col: '#eef4fb', alpha: 0.7 });
  }
  function smokeTrail(j, dt) {
    var t = tailOf(j), n = Math.round((dt / 16) * 3);
    for (var i = 0; i < n; i++) {
      var ember = Math.random() < 0.35;
      spawn({ kind: ember ? 'ember' : 'smoke', x: t.x + rnd(-4, 4), y: t.y + rnd(-4, 4), vx: rnd(-40, 20), vy: rnd(-40, 10), r: ember ? rnd(1.5, 3) : rnd(5, 10), grow: ember ? 0 : 22, life: rnd(0.6, 1.2), max: 1.2, col: ember ? (Math.random() < 0.5 ? '#ffb04a' : '#ff5a2a') : 'rgba(70, 74, 84, 1)', alpha: ember ? 1 : 0.75 });
    }
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
  function bettingProgress() {
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    return S.phase === 'betting' ? clamp01((Date.now() - S.bettingStartsAt) / total) : 0;
  }
  function drawCountdown() {
    var p = bettingProgress(), left = S.phase === 'betting' ? Math.max(0, (S.bettingEndsAt - Date.now()) / 1000) : 0;
    var cx = W * 0.5, cy = H * 0.2, bw = Math.min(W * 0.56, 340), bh = Math.max(12, H * 0.034);
    ctx.font = 'italic 900 ' + Math.round(Math.max(13, H * 0.044)) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10, 30, 60, 0.6)';
    ctx.fillStyle = '#fff';
    var label = S.phase === 'betting' ? S.bettingPhrase.toUpperCase() : '';
    ctx.strokeText(label, cx, cy - H * 0.02);
    ctx.fillText(label, cx, cy - H * 0.02);
    roundRect(cx - bw / 2, cy, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(8, 18, 30, 0.6)';
    ctx.fill();
    if (p > 0) {
      var inset = 3, fw = Math.max(bh - inset * 2, (bw - inset * 2) * (1 - p));
      roundRect(cx - bw / 2 + inset, cy + inset, fw, bh - inset * 2, (bh - inset * 2) / 2);
      var g = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      g.addColorStop(0, '#ffd27a'); g.addColorStop(1, '#ff6a00');
      ctx.fillStyle = g;
      ctx.fill();
    }
    roundRect(cx - bw / 2, cy, bw, bh, bh / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    if (S.phase === 'betting') {
      ctx.font = '800 ' + Math.round(Math.max(12, H * 0.032)) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#fff';
      ctx.fillText('LAUNCH IN ' + left.toFixed(1) + 's', cx, cy + bh + H * 0.015);
    }
  }

  // ---- frame ----
  var themeAt = 0;
  function frame(now) {
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    var m = game.currentMult();
    var speed = W * 0.06;
    if (S.phase === 'flying') {
      var since = scene.launchAt ? now - scene.launchAt : LAUNCH_MS;
      var climbK = clamp01((since - LAUNCH_MS * 0.55) / LAUNCH_MS);
      speed = W * 0.55 * (1 + Math.log(Math.max(1, m)) * 0.8) * clamp01(since / LAUNCH_MS + 0.2);
      scene.dist += H * 0.3 * (1 + Math.log(Math.max(1, m)) * 0.85) * climbK * dt / 1000;
      engineSet(m);
    } else if (S.phase === 'crashed') {
      speed = W * 0.2;
    }
    scene.worldX += speed * dt / 1000;
    var h = scene.dist / Math.max(1, H);
    if (now - themeAt > 400) { themeAt = now; var tc = skyAt(h)[0]; if (S.phase !== 'flying') tc = tc.map(function (v) { return Math.round(v * 0.8); }); game.theme('#' + tc.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('')); }
    if (W && H) {
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      ctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
      drawSky(h, now);
      drawSpace(h, now);
      drawClouds(h, false);
      drawSea(now);
      var L = jetL();
      if (S.phase === 'betting' || S.phase === 'waiting') {
        drawCarrier(now, S.phase === 'betting' ? bettingProgress() : 0);
        var pj = { x: W * 0.27, y: H * 0.8 - L * 0.1 }; // on the catapult
        if (Math.random() < 0.3) steam(pj.x - L * 0.45, H * 0.8, dt, 0.3);
        stepParticles(dt);
        drawJet(pj.x, pj.y, L, 0, 0.15 + 0.1 * Math.sin(now / 90), now);
        drawClouds(h, true);
        ctx.fillStyle = 'rgba(8, 18, 30, 0.18)'; // calm while bets are open
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
        drawCountdown();
      } else if (S.phase === 'flying') {
        if (!scene.launchAt) scene.launchAt = now - LAUNCH_MS * 2; // joined mid-flight
        drawCarrier(now, null);
        var j = jetAt(now), t = now - scene.launchAt;
        if (t < LAUNCH_MS * 0.6) steam(j.x - L * 0.5, deckY(), dt, 1);
        if (t > LAUNCH_MS * 0.5) contrail(j, dt, speed * 0.9);
        stepParticles(dt);
        drawJet(j.x, j.y, L * j.s, j.a, 1, now);
        drawClouds(h, true);
        // speed streaks
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.5;
        STREAKS.forEach(function (s) {
          var x = ((s.x * FULL_W - scene.worldX * 1.6) % FULL_W + FULL_W) % FULL_W - LEFT, y = s.y * H;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s.l * W, y); ctx.stroke();
        });
      } else if (S.phase === 'crashed') {
        drawCarrier(now, null);
        var ct = now - scene.crashAt, cr = scene.crashFrom;
        if (cr) {
          var jj;
          if (ct < STALL_MS) { // the engine coughs: the nose pitches up, the jet slows
            var k = ct / STALL_MS;
            jj = { x: cr.x - k * W * 0.02, y: cr.y + k * H * 0.01, a: cr.a - 0.35 * k, s: cr.s };
            stepParticles(dt);
            drawJet(jj.x, jj.y, L * jj.s, jj.a, Math.floor(ct / 60) % 2 ? 0.1 : 0.5, now);
          } else if (ct < STALL_MS + SPIRAL_MS) { // stall → spiral down and away, trailing smoke
            var u = (ct - STALL_MS) / SPIRAL_MS;
            jj = { x: cr.x - W * 0.35 * easeIn(u) - Math.sin(u * 9) * W * 0.04, y: cr.y + (H * 0.75) * easeIn(u), a: cr.a - 0.35 + u * 7.5, s: cr.s * (1 - 0.55 * u) };
            smokeTrail(jj, dt);
            stepParticles(dt);
            drawJet(jj.x, jj.y, L * jj.s, jj.a, 0, now, Math.cos(u * 14));
          } else stepParticles(dt);
        }
        drawClouds(h, true);
        ctx.fillStyle = 'rgba(8, 18, 30, 0.16)';
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
      mult.textContent = ''; hint.textContent = S.gotSnapshot ? 'Waiting for the next sortie…' : 'Connecting…';
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
