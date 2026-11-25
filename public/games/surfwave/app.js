/* Surf Wave — NEXORNG original crash game. Game logic: ../_core/crash-client.js; this file is
 * the look and sound, all made in code: a surfer waiting in the lineup while bets are open, the
 * swell that lifts the board and the pop-up, the ride on a wave that keeps rising (tropical day →
 * golden hour → glowing night sea) and the wipeout when the lip closes out. Sound effects and the
 * music are generated with WebAudio; every picture is drawn on the canvas. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0049', onChange: render, onSignal: onSignal });
  var S = game.S;
  var KEY = 'surfwave';

  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000); // never hang the loader

  // ---------------------------------------------------------------- timings (sound = animation)
  var RISE_MS = 1400; // the swell lifts the board and the surfer pops up (the swell whoosh lasts as long)
  var HIT_MS = 520; // wipeout: the lip pitches over and lands on the surfer…
  var WIPE_MS = 1600; // …the whole wipeout with its splash (the crash sound ends with it)

  // ---------------------------------------------------------------- sound (WebAudio, generated)
  var soundOn = true, musicOn = true;
  try { soundOn = localStorage.getItem(KEY + '-sound') !== 'off'; } catch (e) { /* default on */ }
  try { musicOn = localStorage.getItem(KEY + '-music') !== 'off'; } catch (e) { /* default on */ }
  var AC = window.AudioContext || window.webkitAudioContext;
  var ac = null, sfxBus = null, musicBus = null, noiseBuf = null, surf = null;

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
  function env(g, t, peak, attack, end) { // quick envelope helper
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  // A water-drop "bloop" for taps.
  function sfxClick() {
    if (!live() || !soundOn) return;
    var t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(380, t);
    o.frequency.exponentialRampToValueAtTime(1150, t + 0.07);
    env(g, t, 0.16, 0.006, t + 0.11);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + 0.12);
  }

  // The swell lifting the board: a rising rush that lasts exactly `ms` (the rise animation).
  function sfxRise(ms) {
    if (!live()) return;
    var t = ac.currentTime, d = ms / 1000;
    var n = noiseSrc(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(240, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + d * 0.85);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    n.connect(f); f.connect(g); g.connect(sfxBus);
    n.start(t); n.stop(t + d + 0.02);
    var o = ac.createOscillator(), og = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(62, t);
    o.frequency.exponentialRampToValueAtTime(130, t + d);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.28, t + d * 0.55);
    og.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(og); og.connect(sfxBus);
    o.start(t); o.stop(t + d + 0.02);
  }

  // The roar of the wave while riding; it brightens as the wave grows.
  function surfStart() {
    if (!live() || surf) return;
    var t = ac.currentTime, n = noiseSrc(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'lowpass';
    f.frequency.value = 650;
    f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.3);
    var lfo = ac.createOscillator(), lg = ac.createGain(); // the wash rolling in and out
    lfo.frequency.value = 0.4;
    lg.gain.value = 0.07;
    lfo.connect(lg); lg.connect(g.gain);
    var hs = noiseSrc(), hf = ac.createBiquadFilter(), hg = ac.createGain(); // spray hiss
    hf.type = 'highpass';
    hf.frequency.value = 5200;
    hg.gain.value = 0.05;
    n.connect(f); f.connect(g); hs.connect(hf); hf.connect(hg); hg.connect(g); g.connect(sfxBus);
    n.start(t); hs.start(t, 0.7); lfo.start(t);
    surf = { n: n, hs: hs, lfo: lfo, f: f, g: g };
  }
  function surfSet(m) {
    if (!surf || !live()) return;
    var k = Math.log(Math.max(1, m));
    surf.f.frequency.setTargetAtTime(650 + 520 * k, ac.currentTime, 0.25);
    surf.lfo.frequency.setTargetAtTime(0.4 + 0.25 * k, ac.currentTime, 0.4);
  }
  function surfStop(ms) {
    if (!surf) return;
    var e = surf, t = ac.currentTime, d = (ms || 80) / 1000;
    surf = null;
    e.g.gain.cancelScheduledValues(t);
    e.g.gain.setValueAtTime(Math.max(0.0001, e.g.gain.value), t);
    e.g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    e.n.stop(t + d + 0.02); e.hs.stop(t + d + 0.02); e.lfo.stop(t + d + 0.02);
  }

  // Wipeout: the lip pitching (HIT_MS), the thundering closeout and the bubbling wash — the whole
  // sound lasts exactly WIPE_MS, like the animation.
  function sfxWipe() {
    if (!live()) return;
    var t = ac.currentTime, hit = HIT_MS / 1000, d = WIPE_MS / 1000;
    var n1 = noiseSrc(), f1 = ac.createBiquadFilter(), g1 = ac.createGain();
    f1.type = 'bandpass';
    f1.Q.value = 0.7;
    f1.frequency.setValueAtTime(700, t);
    f1.frequency.exponentialRampToValueAtTime(2800, t + hit);
    g1.gain.setValueAtTime(0.04, t);
    g1.gain.exponentialRampToValueAtTime(0.35, t + hit);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + hit + 0.08);
    n1.connect(f1); f1.connect(g1); g1.connect(sfxBus);
    n1.start(t); n1.stop(t + hit + 0.1);
    var n2 = noiseSrc(), f2 = ac.createBiquadFilter(), g2 = ac.createGain();
    f2.type = 'lowpass';
    f2.frequency.setValueAtTime(5200, t + hit);
    f2.frequency.exponentialRampToValueAtTime(160, t + d);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.setValueAtTime(0.0001, t + hit - 0.01);
    g2.gain.exponentialRampToValueAtTime(0.95, t + hit + 0.03);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + d);
    n2.connect(f2); f2.connect(g2); g2.connect(sfxBus);
    n2.start(t + 0.2, 0.3); n2.stop(t + d + 0.02);
    var o = ac.createOscillator(), og = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(96, t + hit);
    o.frequency.exponentialRampToValueAtTime(30, t + hit + 0.6);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.setValueAtTime(0.0001, t + hit - 0.01);
    og.gain.exponentialRampToValueAtTime(0.75, t + hit + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + hit + 0.7);
    o.connect(og); og.connect(sfxBus);
    o.start(t + hit - 0.02); o.stop(t + hit + 0.72);
    for (var i = 0; i < 7; i++) { // bubbles in the wash
      var s = t + hit + 0.35 + i * (d - hit - 0.5) / 7, b = ac.createOscillator(), bg = ac.createGain();
      b.type = 'sine';
      b.frequency.setValueAtTime(300 + Math.random() * 400, s);
      b.frequency.exponentialRampToValueAtTime(900 + Math.random() * 700, s + 0.06);
      env(bg, s, 0.05, 0.005, s + 0.08);
      b.connect(bg); bg.connect(sfxBus);
      b.start(s); b.stop(s + 0.09);
    }
  }

  // Cash-out: a bright marimba run with a splash of shimmer.
  function sfxWin() {
    if (!live() || !soundOn) return;
    var t = ac.currentTime;
    [72, 76, 79, 84, 88].forEach(function (m, i) { marimba(m, t + i * 0.07, 0.5, 0.2, sfxBus); });
    var n = noiseSrc(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'highpass';
    f.frequency.value = 6500;
    env(g, t + 0.25, 0.05, 0.02, t + 0.8);
    n.connect(f); f.connect(g); g.connect(sfxBus);
    n.start(t + 0.25, 0.1); n.stop(t + 0.82);
  }

  // Generated island music: marimba arpeggios, a round bass and a shaker (C · Am · F · G, swung).
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function marimba(m, at, dur, vol, bus) {
    var o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), g2 = ac.createGain();
    o.type = 'sine';
    o.frequency.value = hz(m);
    o2.type = 'sine';
    o2.frequency.value = hz(m) * 4;
    env(g, at, vol, 0.006, at + dur);
    env(g2, at, vol * 0.22, 0.003, at + dur * 0.25);
    o.connect(g); o2.connect(g2); g.connect(bus); g2.connect(bus);
    o.start(at); o2.start(at); o.stop(at + dur + 0.02); o2.stop(at + dur + 0.02);
  }
  function bass(m, at, dur) {
    var o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'triangle';
    o.frequency.value = hz(m);
    f.type = 'lowpass';
    f.frequency.value = 520;
    env(g, at, 0.12, 0.015, at + dur);
    o.connect(f); f.connect(g); g.connect(musicBus);
    o.start(at); o.stop(at + dur + 0.02);
  }
  function shaker(at, vol) {
    var n = noiseSrc(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'highpass';
    f.frequency.value = 7000;
    env(g, at, vol, 0.004, at + 0.05);
    n.connect(f); f.connect(g); g.connect(musicBus);
    n.start(at, Math.random()); n.stop(at + 0.06);
  }
  var CHORDS = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
  var ARP = [0, 1, 2, 1, 0, 2, 1, 2];
  var EIGHTH = 60 / 104 / 2, musicNext = 0, musicStep = 0, musicTimer = null;
  function scheduleMusic() {
    if (!live()) return;
    if (musicNext < ac.currentTime) musicNext = ac.currentTime + 0.05;
    while (musicNext < ac.currentTime + 0.6) {
      var bar = Math.floor(musicStep / 8), chord = CHORDS[bar % CHORDS.length], s = musicStep % 8;
      var at = musicNext + (s % 2 ? EIGHTH * 0.18 : 0); // swing
      marimba(chord[ARP[s]] + 12, at, 0.42, s % 2 ? 0.035 : 0.05, musicBus);
      if (s === 0 || s === 4) bass(chord[0] - 12, at, EIGHTH * 3);
      if (s === 6) bass(chord[0] - 5, at, EIGHTH * 1.5);
      shaker(at, s % 2 ? 0.03 : 0.012);
      if (bar % 2 === 1 && s === 7) marimba(chord[2] + 24, at, 0.6, 0.025, musicBus);
      musicNext += EIGHTH;
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
    if (ac.state !== 'running') ac.resume().then(function () { syncMusic(); if (S.phase === 'flying' && performance.now() - scene.riseAt > RISE_MS) surfStart(); }).catch(function () {});
    syncMusic();
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, wake, true); });
  document.addEventListener('visibilitychange', function () {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else ac.resume().catch(function () {});
  });

  // ---------------------------------------------------------------- engine moments
  var scene = { riseAt: 0, crashAt: 0, crash: null, lastT: 0, alt: 0, h: 0, r: 0, k: 0, scroll: 0, shake: 0, paddleIn: 0 };
  var particles = []; // spray / splash droplets / foam / night sparkles
  var surfTimer = null;
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') {
      scene.riseAt = now;
      scene.crash = null;
      sfxRise(RISE_MS);
      clearTimeout(surfTimer);
      surfTimer = setTimeout(function () { if (S.phase === 'flying') surfStart(); }, RISE_MS);
    }
    if (name === 'crash') {
      clearTimeout(surfTimer);
      surfStop(60);
      sfxWipe();
      scene.crashAt = now;
      scene.crash = { h: scene.h, k: scene.k, r: scene.r, p: rideP(now), hit: false, pose: scene.riseAt ? poseAt(now) : STAND };
    }
    if (name === 'betting') { scene.riseAt = 0; scene.crashAt = 0; scene.crash = null; scene.paddleIn = now; }
    if (name === 'win') { sfxWin(); toast(d.text, 'win'); burstWin(); }
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

  // ---- bet panels: resin surfboard decks (slot 0 and 1; phone shows one) -------------
  var FIN = '<svg class="deck__fin" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 14C4 8 7 3 13 2c-2 4-2 8 0 12z" fill="currentColor"/></svg>';
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="deck">' +
      '<div class="deck__head">' + FIN + '<span>BOARD ' + (slot + 1) + ' · STAKE</span>' + FIN + '</div>' +
      '<div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<input class="amount" inputmode="decimal" value="1.00" aria-label="Bet amount">' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<button type="button" class="action"><span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      '<div class="auto"><span>Auto cash out</span>' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label>' +
      '<input class="auto__x" inputmode="decimal" value="2.00" aria-label="Auto cash-out multiplier"></div>' +
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
      $('countLabel').textContent = 'In the lineup';
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
  // results row); the world is drawn from -LEFT/-TOP so it fills the whole stage. U = the
  // surfer's size, so the figure keeps its place and proportions on every screen.
  var W = 0, H = 0, TOP = 0, FULL_H = 0, LEFT = 0, FULL_W = 0, U = 50;

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
    U = Math.max(34, Math.min(H * 0.17, W * 0.19));
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a player joins the round).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- helpers ------------------------------------------------------------------------
  function clamp(v, a, b) { return Math.min(b == null ? 1 : b, Math.max(a == null ? 0 : a, v)); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function easeIO(t) { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  var STOPS = [0, 0.45, 0.72, 1]; // tropical day · golden hour · dusk · glowing night
  function mix3(st, a) { // the colour of a palette at sky height a (0 … 1), blended between its stops
    var i = 0;
    while (i < STOPS.length - 2 && a > STOPS[i + 1]) i++;
    var k = clamp((a - STOPS[i]) / (STOPS[i + 1] - STOPS[i]));
    return [0, 1, 2].map(function (c) { return lerp(st[i][c], st[i + 1][c], k); });
  }
  function mixc(c1, c2, k) { return [0, 1, 2].map(function (i) { return lerp(c1[i], c2[i], k); }); }
  function rgb(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')'; }
  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join(''); }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- palettes: day · golden hour · dusk · night --------------------------------------------
  var SKY_TOP = [[31, 159, 224], [236, 110, 90], [92, 46, 128], [8, 16, 46]];
  var SKY_BOT = [[176, 238, 255], [255, 206, 128], [238, 122, 140], [32, 54, 112]];
  var FAR_TOP = [[70, 196, 224], [240, 160, 120], [192, 104, 142], [26, 50, 96]];
  var FAR_BOT = [[10, 108, 160], [36, 76, 114], [38, 30, 86], [4, 20, 44]];
  var FACE_TOP = [[138, 250, 238], [176, 232, 206], [130, 204, 226], [46, 214, 222]];
  var DEEP = [[5, 62, 106], [18, 46, 80], [24, 24, 72], [2, 14, 32]];
  var ISLE = [[58, 132, 128], [118, 62, 92], [72, 34, 82], [10, 22, 46]];
  var CLOUD = [[255, 255, 255], [255, 196, 176], [236, 146, 176], [64, 84, 136]];
  var CLOUD_SH = [[190, 226, 246], [214, 120, 120], [124, 62, 124], [30, 44, 88]];
  var FOAM = [[255, 255, 255], [255, 244, 228], [255, 228, 242], [168, 255, 250]];

  // ---- the world's random bits ----------------------------------------------------------
  var clouds = [], stars = [], gulls = [], glints = [];
  for (var ci = 0; ci < 7; ci++) clouds.push({ x: Math.random(), y: 0.04 + Math.random() * 0.34, s: 0.6 + Math.random() * 0.8, v: 0.45 + Math.random() * 0.7, seed: Math.random() * 10 });
  for (var si = 0; si < 90; si++) stars.push({ x: Math.random(), y: Math.random() * 0.8, r: 0.5 + Math.random() * 1.3, t: Math.random() * 6 });
  for (var gi = 0; gi < 3; gi++) gulls.push({ x: Math.random(), y: 0.12 + Math.random() * 0.2, s: 0.7 + Math.random() * 0.5, ph: Math.random() * 6, v: 0.6 + Math.random() * 0.5 });
  for (var li = 0; li < 40; li++) glints.push({ y: Math.random(), x: Math.random() * 2 - 1, t: Math.random() * 6, w: 0.4 + Math.random() });

  // ---- how high: the camera climbs with the multiplier ------------------------------------
  function mNow() { return S.phase === 'flying' ? game.currentMult() : S.phase === 'crashed' ? S.crashPoint || 1 : 1; }
  function skyTarget() { // 0 tropical day … 0.5 golden hour (~3.2x) … 1 night sea (10x+)
    if (S.phase !== 'flying' && S.phase !== 'crashed') return 0;
    return clamp(Math.log(Math.max(1, mNow())) / Math.log(10));
  }
  function waveK(m) { // wave growth: steady to 10x, then still a little more
    var g = Math.log(Math.max(1, m)) / Math.log(10);
    return g < 1 ? g : 1 + (1 - Math.exp(-(g - 1) * 1.5)) * 0.5;
  }

  // ---- wave geometry ---------------------------------------------------------------------
  var P0 = 0.36; // where on the face the surfer rides (0 crest … 1 trough)
  function rideP(now) { return P0 + 0.05 * Math.sin(now / 1100) * scene.r; }
  function geom(now) {
    var p = scene.crash ? scene.crash.p : rideP(now), r = scene.r, h = scene.h;
    var sx = W * (0.5 + 0.08 * r);
    var sy = H * (0.74 - r * (0.02 + 0.12 * Math.min(1, scene.k)));
    var faceW = h * 1.15 + U * 0.9;
    var ys = sy + h * (1 - p) * (1 - p);
    return { p: p, h: h, sx: sx, sy: sy, ys: ys, faceW: faceW, cx: sx - p * faceW, backW: h * 1.5 + U * 1.2, t: now / 1000 };
  }
  function heightCap(r) { // the crest always stays on screen
    var sy = H * (0.74 - r * (0.02 + 0.12 * Math.min(1, scene.k)));
    return Math.max(U, (sy - H * 0.07) / (1 - (1 - P0) * (1 - P0)));
  }
  function waveY(x, g) {
    var dx = x - g.cx, y;
    if (dx >= 0) { var u = dx / g.faceW; y = u < 1 ? g.ys - g.h * (1 - u) * (1 - u) : g.ys; } else { var b = dx / g.backW; y = g.ys - g.h * Math.exp(-b * b * 2.2); }
    var calm = 1 - Math.min(1, g.h / (U * 3)) * 0.6, q = x / U;
    return y + (Math.sin(q * 1.15 + g.t * 1.4) * U * 0.05 + Math.sin(q * 2.9 - g.t * 2.3) * U * 0.018) * calm;
  }
  function slopeAt(x, g) { return (waveY(x + 2, g) - waveY(x - 2, g)) / 4; }

  // ---- the surfer: a procedural rig (joint positions in U, y up = negative) ----------------
  var STAND = { fB: [-0.24, 0], fF: [0.2, 0], kB: [-0.1, -0.24], kF: [0.3, -0.25], hip: [0.02, -0.45], sh: [0.12, -0.78], hd: [0.17, -0.93], eB: [-0.12, -0.74], hB: [-0.3, -0.86], eF: [0.32, -0.68], hF: [0.5, -0.6] };
  var CROUCH = { fB: [-0.24, 0], fF: [0.16, 0], kB: [-0.04, -0.16], kF: [0.3, -0.2], hip: [-0.02, -0.26], sh: [0.2, -0.48], hd: [0.31, -0.58], eB: [0.16, -0.26], hB: [0.12, -0.02], eF: [0.36, -0.3], hF: [0.36, -0.02] };
  var SIT = { fB: [0.04, 0.26], fF: [0.12, 0.24], kB: [0.1, 0.02], kF: [0.17, 0.0], hip: [-0.06, -0.07], sh: [-0.03, -0.42], hd: [-0.01, -0.56], eB: [0.05, -0.24], hB: [0.15, -0.1], eF: [0.1, -0.25], hF: [0.21, -0.1] };
  var TUMBLE = { fB: [-0.3, -0.1], fF: [0.25, 0.05], kB: [-0.2, -0.3], kF: [0.15, -0.2], hip: [0, -0.45], sh: [0.05, -0.78], hd: [0.06, -0.93], eB: [-0.25, -0.9], hB: [-0.35, -1.1], eF: [0.3, -0.95], hF: [0.42, -1.15] };
  var JOINTS = Object.keys(STAND);
  function blend(a, b, k) {
    var o = {};
    JOINTS.forEach(function (j) { o[j] = [lerp(a[j][0], b[j][0], k), lerp(a[j][1], b[j][1], k)]; });
    return o;
  }
  function poseAt(now) { // sit → crouch (pop-up) → stand over the rise
    var t = scene.riseAt ? (now - scene.riseAt) / RISE_MS : 1;
    if (t < 0.42) return SIT;
    if (t < 0.7) return blend(SIT, CROUCH, easeIO((t - 0.42) / 0.28));
    return blend(CROUCH, STAND, easeIO((t - 0.7) / 0.3));
  }

  function boardPath(L, T) { // deck at y = 0, nose to the right with a little rocker
    ctx.beginPath();
    ctx.moveTo(-L, T * 0.2);
    ctx.quadraticCurveTo(-L * 0.4, -T * 0.25, L * 0.62, -T * 0.1);
    ctx.quadraticCurveTo(L * 0.95, -T * 0.2, L * 1.06, -T * 1.6);
    ctx.quadraticCurveTo(L * 0.9, T * 0.75, L * 0.5, T * 0.95);
    ctx.quadraticCurveTo(-L * 0.4, T * 1.25, -L * 0.96, T * 0.85);
    ctx.quadraticCurveTo(-L * 1.06, T * 0.6, -L, T * 0.2);
    ctx.closePath();
  }
  function drawBoard(night) {
    var L = U * 0.56, T = U * 0.075;
    ctx.fillStyle = '#0b8fc0'; // fin
    ctx.beginPath();
    ctx.moveTo(-L * 0.62, T * 0.9);
    ctx.quadraticCurveTo(-L * 0.7, T * 2.6, -L * 0.86, T * 2.9);
    ctx.lineTo(-L * 0.84, T * 0.95);
    ctx.fill();
    boardPath(L, T);
    var g = ctx.createLinearGradient(-L, 0, L, 0);
    g.addColorStop(0, '#ff7a3d');
    g.addColorStop(0.55, '#ffcf5a');
    g.addColorStop(1, '#fff1b0');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = night > 0.3 ? '#7ff6ff' : '#0b8fc0'; // stripe (glows at night)
    ctx.fillRect(-L * 0.2, -T * 2, L * 0.12, T * 4);
    ctx.fillRect(-L * 0.02, -T * 2, L * 0.04, T * 4);
    ctx.fillStyle = 'rgba(120, 40, 0, 0.25)';
    ctx.fillRect(-L * 1.1, T * 0.55, L * 2.3, T);
    ctx.restore();
    boardPath(L, T);
    ctx.lineWidth = Math.max(1, U * 0.018);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.stroke();
  }

  function limb(a, b, w, col) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a[0] * U, a[1] * U);
    ctx.lineTo(b[0] * U, b[1] * U);
    ctx.stroke();
  }
  function limb3(a, b, c, w1, c1, w2, c2) { limb(a, b, w1, c1); limb(b, c, w2, c2); }

  // The surfer on the board at (x, y), tilted with the water; the upper body leans back towards
  // upright (lean) so a steep face does not tip the figure over.
  function drawSurfer(x, y, ang, pose, o) {
    o = o || {};
    var night = o.night || 0, now = o.now || 0, lean = o.lean || 0;
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (o.scale) ctx.scale(o.scale, o.scale);
    if (night > 0.05) { // a soft moonlit aura (a gradient: cheaper than shadowBlur on every limb)
      var au = ctx.createRadialGradient(U * 0.05, -U * 0.45, 0, U * 0.05, -U * 0.45, U * 0.85);
      au.addColorStop(0, 'rgba(127, 246, 255, ' + 0.28 * night + ')');
      au.addColorStop(1, 'rgba(127, 246, 255, 0)');
      ctx.fillStyle = au;
      ctx.fillRect(-U, -U * 1.4, U * 2, U * 2);
    }
    if (!o.noBoard) drawBoard(night);
    // upper body around the hip
    var hip = pose.hip, cs = Math.cos(lean), sn = Math.sin(lean);
    function up(j) {
      var dx = pose[j][0] - hip[0], dy = pose[j][1] - hip[1];
      return [hip[0] + dx * cs - dy * sn, hip[1] + dx * sn + dy * cs];
    }
    var sh = up('sh'), hd = up('hd'), eB = up('eB'), hB = up('hB'), eF = up('eF'), hF = up('hF');
    var sway = o.ride ? Math.sin(now / 380) * 0.04 : 0;
    hF = [hF[0], hF[1] + sway]; hB = [hB[0], hB[1] - sway];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var SKIN = '#c98557', SKIN_B = '#a86a42', SHORTS = '#0b8fc0', SHORTS_B = '#086a92', RASH = '#ff5a6e', RASH_B = '#d63d55';
    limb(sh, eB, U * 0.075, RASH_B); // back arm (behind)
    limb(eB, hB, U * 0.06, SKIN_B);
    limb3(hip, pose.kB, pose.fB, U * 0.12, SHORTS_B, U * 0.085, SKIN_B); // back leg
    limb(hip, sh, U * 0.2, RASH); // torso (rash guard)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; // its stripe
    ctx.lineWidth = U * 0.035;
    ctx.beginPath();
    ctx.moveTo(lerp(hip[0], sh[0], 0.35) * U - U * 0.02, lerp(hip[1], sh[1], 0.35) * U);
    ctx.lineTo(lerp(hip[0], sh[0], 0.62) * U + U * 0.01, lerp(hip[1], sh[1], 0.62) * U);
    ctx.stroke();
    limb3(hip, pose.kF, pose.fF, U * 0.125, SHORTS, U * 0.09, SKIN); // front leg
    // head + hair blown back + shades
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(hd[0] * U, hd[1] * U, U * 0.1, 0, Math.PI * 2);
    ctx.fill();
    var wind = o.ride ? 1 : 0.3;
    ctx.fillStyle = '#3b2412';
    ctx.beginPath();
    ctx.arc(hd[0] * U, hd[1] * U, U * 0.105, Math.PI * 0.95, Math.PI * 1.95);
    ctx.fill();
    ctx.strokeStyle = '#5a3a1c';
    ctx.lineWidth = U * 0.035;
    for (var i = 0; i < 3; i++) {
      var hy = hd[1] * U - U * 0.08 + i * U * 0.035, wav = Math.sin(now / 140 + i * 1.7) * U * 0.03 * wind;
      ctx.beginPath();
      ctx.moveTo(hd[0] * U - U * 0.05, hy);
      ctx.quadraticCurveTo(hd[0] * U - U * 0.16, hy - U * 0.02 + wav, hd[0] * U - U * (0.16 + 0.1 * wind), hy + U * 0.02 - wav);
      ctx.stroke();
    }
    ctx.fillStyle = '#10202e';
    ctx.fillRect(hd[0] * U + U * 0.01, hd[1] * U - U * 0.03, U * 0.1, U * 0.035);
    limb(sh, eF, U * 0.075, RASH); // front arm
    limb(eF, hF, U * 0.062, SKIN);
    ctx.restore();
  }

  // ---- particles ----------------------------------------------------------------------
  function emit(x, y, vx, vy, life, r, kind) {
    if (particles.length > 520) return;
    particles.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, r: r, kind: kind || 'drop' });
  }
  function burstWin() { // a fan of sparkling spray off the board when a bet cashes out
    if (S.phase !== 'flying' || !W) return;
    var g = geom(performance.now());
    for (var i = 0; i < 26; i++) {
      var a = -Math.PI * (0.15 + Math.random() * 0.7), sp = U * (2 + Math.random() * 3);
      emit(g.sx, g.sy - U * 0.5, Math.cos(a) * sp, Math.sin(a) * sp, 0.7 + Math.random() * 0.5, U * (0.03 + Math.random() * 0.03), 'gold');
    }
  }
  function stepParticles(dt) {
    var grav = U * 4.2;
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'foam') { p.r += U * 0.3 * dt; p.vx *= 0.97; p.vy *= 0.97; } else p.vy += grav * dt * (p.kind === 'mist' ? 0.15 : 1);
    }
  }
  function drawParticles(night) {
    var foam = FOAM_C, glow = night > 0.3;
    particles.forEach(function (p) {
      var a = clamp(p.life / p.max);
      if (p.kind === 'foam') {
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, rgb(foam, 0.8 * a));
        g.addColorStop(0.6, rgb(foam, 0.45 * a));
        g.addColorStop(1, rgb(foam, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.fillStyle = p.kind === 'gold' ? 'rgba(255, 226, 120, ' + a + ')' : rgb(foam, (p.kind === 'mist' ? 0.3 : 0.9) * a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (p.kind === 'mist' ? 1 + (1 - a) * 0.5 : 1), 0, Math.PI * 2);
      ctx.fill();
    });
    if (glow) { // bioluminescent sparkle on the droplets at night
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      particles.forEach(function (p) {
        if (p.kind !== 'drop') return;
        ctx.fillStyle = 'rgba(80, 255, 240, ' + (0.35 * night * clamp(p.life / p.max)) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
  }
  var FOAM_C = FOAM[0];

  // ---- the sky --------------------------------------------------------------------------
  function cloud(x, y, s, col, shade, alpha) { // flat-bottomed cumulus, shaded underneath
    var w = U * 1.6 * s, h = U * 0.55 * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    var g = ctx.createLinearGradient(0, y - h, 0, y);
    g.addColorStop(0, rgb(col));
    g.addColorStop(1, rgb(shade));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.5, y);
    ctx.arc(x - w * 0.3, y - h * 0.25, h * 0.35, Math.PI, Math.PI * 1.6);
    ctx.arc(x - w * 0.08, y - h * 0.5, h * 0.55, Math.PI * 1.1, Math.PI * 1.85);
    ctx.arc(x + w * 0.2, y - h * 0.38, h * 0.45, Math.PI * 1.25, Math.PI * 1.95);
    ctx.arc(x + w * 0.38, y - h * 0.15, h * 0.28, Math.PI * 1.4, Math.PI * 2);
    ctx.lineTo(x + w * 0.5, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function gull(x, y, s, flap, col) {
    var w = U * 0.22 * s, f = Math.sin(flap) * w * 0.5;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.2, U * 0.025 * s);
    ctx.beginPath();
    ctx.moveTo(x - w, y - f);
    ctx.quadraticCurveTo(x - w * 0.45, y - w * 0.45 - f * 0.3, x, y);
    ctx.quadraticCurveTo(x + w * 0.45, y - w * 0.45 - f * 0.3, x + w, y - f);
    ctx.stroke();
  }
  function island(x, base, w, h, col, palms, now) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, base + 1);
    ctx.bezierCurveTo(x - w * 0.32, base - h, x + w * 0.18, base - h * 1.15, x + w / 2, base + 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineCap = 'round';
    palms.forEach(function (pm, i) {
      var bx = x + pm[0] * w, by = base - h * 0.75 * (1 - Math.pow(pm[0] * 2, 2)), ph = h * pm[1], lean = pm[2];
      var tx = bx + lean * ph, ty = by - ph, sway = Math.sin(now / 900 + i) * ph * 0.03;
      ctx.lineWidth = Math.max(1.5, w * 0.012);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - lean * ph * 0.3, by - ph * 0.6, tx + sway, ty);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.5, w * 0.014);
      [-2.7, -2.1, -1.4, -0.7, -0.2].forEach(function (a) {
        var len = ph * 0.5, ex = tx + sway + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.5 + len * 0.45;
        ctx.beginPath();
        ctx.moveTo(tx + sway, ty);
        ctx.quadraticCurveTo(tx + sway + Math.cos(a) * len * 0.6, ty + Math.sin(a) * len * 0.6, ex, ey);
        ctx.stroke();
      });
    });
  }

  function drawWorld(g, now) {
    var alt = scene.alt, night = clamp((alt - 0.62) / 0.28), golden = clamp(1 - Math.abs(alt - 0.5) / 0.3);
    var top = -TOP, bottom = FULL_H - TOP, fl = -LEFT, fw = FULL_W;
    var hy = H * 0.5 + Math.max(0, g.ys - H * 0.74) * 1.1; // the horizon drops as the wave lifts us
    var lift = hy - H * 0.5;
    var skyT = mix3(SKY_TOP, alt), skyB = mix3(SKY_BOT, alt);
    // sky
    var sg = ctx.createLinearGradient(0, top, 0, hy);
    sg.addColorStop(0, rgb(skyT));
    sg.addColorStop(1, rgb(skyB));
    ctx.fillStyle = sg;
    ctx.fillRect(fl, top, fw, bottom - top);
    // stars
    if (night > 0) {
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.45 + 0.55 * Math.sin(now / 520 + st.t));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(fl + st.x * fw, top + st.y * (hy - top) + lift * 0.25, st.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    // sun: high in the tropical day, sinking big and orange at golden hour, gone at night
    var sk = clamp(alt / 0.62), sunX = W * lerp(0.8, 0.7, sk), sunY = lerp(H * 0.13, hy - U * 0.15, easeIO(sk)), sunR = U * lerp(0.32, 0.55, sk);
    var sunA = 1 - clamp((alt - 0.62) / 0.12);
    if (sunA > 0) {
      var sc = mixc([255, 252, 220], [255, 150, 70], sk);
      var halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.5, sunX, sunY, sunR * 5);
      halo.addColorStop(0, rgb(sc, 0.55 * sunA));
      halo.addColorStop(1, rgb(sc, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(sunX - sunR * 5, sunY - sunR * 5, sunR * 10, sunR * 10);
      ctx.fillStyle = rgb(mixc([255, 255, 240], [255, 196, 110], sk), sunA);
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
      ctx.fill();
    }
    // moon
    var moonX = W * 0.24, moonY = H * 0.16 + lift * 0.3, moonR = U * 0.28;
    if (night > 0) {
      var mg = ctx.createRadialGradient(moonX, moonY, moonR * 0.8, moonX, moonY, moonR * 4);
      mg.addColorStop(0, 'rgba(200, 240, 255, ' + 0.35 * night + ')');
      mg.addColorStop(1, 'rgba(200, 240, 255, 0)');
      ctx.fillStyle = mg;
      ctx.fillRect(moonX - moonR * 4, moonY - moonR * 4, moonR * 8, moonR * 8);
      ctx.fillStyle = 'rgba(240, 250, 255, ' + night + ')';
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(180, 200, 225, ' + 0.5 * night + ')';
      [[-0.3, -0.2, 0.18], [0.25, 0.15, 0.13], [-0.05, 0.35, 0.1]].forEach(function (c) {
        ctx.beginPath();
        ctx.arc(moonX + c[0] * moonR, moonY + c[1] * moonR, c[2] * moonR, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // clouds (drift past faster while riding; they sink a little as we rise)
    var span = fw + U * 6;
    var cc = mix3(CLOUD, alt), cs = mix3(CLOUD_SH, alt);
    clouds.forEach(function (c) {
      var x = (((c.x * span - scene.scroll * 0.3 * c.v) % span) + span) % span - U * 3 + fl;
      var y = top + (hy - top) * c.y + lift * 0.6;
      if (y < hy) cloud(x, y, c.s * (0.85 + U / 140), cc, cs, 0.92 - night * 0.45);
    });
    // gulls (day and golden hour)
    if (night < 1) {
      var gc = rgb(mixc([40, 70, 90], [70, 30, 50], clamp(alt / 0.5)), 1 - night);
      gulls.forEach(function (b) {
        var gx = (((b.x * span + now * 0.03 * U / 50 * b.v - scene.scroll * 0.1) % span) + span) % span - U * 3 + fl;
        gull(gx, top + (hy - top) * b.y + lift * 0.45 + Math.sin(now / 1300 + b.ph) * U * 0.1, b.s, now / 150 + b.ph, gc);
      });
    }
    // far sea below the horizon
    var seaT = mix3(FAR_TOP, alt), seaB = mix3(FAR_BOT, alt);
    var fg = ctx.createLinearGradient(0, hy, 0, Math.max(hy + 1, bottom));
    fg.addColorStop(0, rgb(seaT));
    fg.addColorStop(1, rgb(seaB));
    ctx.fillStyle = fg;
    ctx.fillRect(fl, hy, fw, Math.max(0, bottom - hy));
    // islands on the horizon (hazy, slow parallax)
    var iz = mixc(mix3(ISLE, alt), skyB, 0.3 - night * 0.2), ispan = fw + U * 8;
    [[0.18, 3.4, 0.42, [[-0.15, 1.3, 0.12], [0.05, 1.6, -0.1], [0.18, 1.1, 0.2]]], [0.7, 2.4, 0.3, [[0, 1.5, 0.15]]]].forEach(function (is) {
      var ix = (((is[0] * ispan - scene.scroll * 0.08) % ispan) + ispan) % ispan - U * 4 + fl;
      if (hy < bottom + 4) island(ix, hy, U * is[1], U * is[2], rgb(iz), is[3], now);
    });
    // seamless horizon: a soft haze band in the sky's bottom colour
    var hz = ctx.createLinearGradient(0, hy - U * 0.35, 0, hy + U * 0.3);
    hz.addColorStop(0, rgb(skyB, 0));
    hz.addColorStop(0.5, rgb(skyB, 0.55));
    hz.addColorStop(1, rgb(skyB, 0));
    ctx.fillStyle = hz;
    ctx.fillRect(fl, hy - U * 0.35, fw, U * 0.65);
    // sun / moon glitter path on the far sea
    var gx = sunA > 0.05 ? sunX : moonX, ga = sunA > 0.05 ? sunA * (0.35 + golden * 0.5) : night * 0.6;
    if (ga > 0.02 && hy < bottom) {
      var gcol = sunA > 0.05 ? mixc([255, 255, 230], [255, 190, 110], sk) : [210, 240, 255];
      glints.forEach(function (gl) {
        var y = hy + 3 + Math.pow(gl.y, 1.5) * (bottom - hy), spread = U * (0.2 + gl.y * 1.6);
        var a = ga * (0.5 + 0.5 * Math.sin(now / 260 + gl.t));
        ctx.fillStyle = rgb(gcol, a);
        ctx.fillRect(gx + gl.x * spread, y, U * 0.22 * gl.w * (0.4 + gl.y), Math.max(1, U * 0.02));
      });
    }
    return { night: night, golden: golden, hy: hy, bottom: bottom };
  }

  // ---- the wave -------------------------------------------------------------------------
  function surfacePath(g, fl, x1, bottom, close) {
    ctx.beginPath();
    var step = Math.max(3, U * 0.07);
    ctx.moveTo(fl, waveY(fl, g));
    for (var x = fl + step; x < x1 + step; x += step) ctx.lineTo(x, waveY(Math.min(x, x1), g));
    if (close) { ctx.lineTo(x1, bottom); ctx.lineTo(fl, bottom); ctx.closePath(); }
  }
  function lipShape(g, closeK) { // the curling lip: grows with the wave; a wipeout pitches it onto the rider
    var lk = clamp((g.h / U - 0.9) / 2.6);
    if (lk <= 0.02 && !closeK) return null;
    var crX = g.cx, crY = g.ys - g.h;
    var tx = crX + g.h * 0.5 * lk, ty = crY + g.h * 0.3 * lk;
    if (closeK) { tx = lerp(tx, g.sx + U * 0.7, closeK); ty = lerp(ty, g.sy + U * 0.45, closeK); }
    var ix = crX + g.h * 0.06 + (tx - crX) * 0.12;
    return { lk: Math.max(lk, closeK || 0), crX: crX, crY: crY, tx: tx, ty: ty, ix: ix, iy: waveY(ix, g), bx: crX - g.h * 0.08 - U * 0.1 };
  }
  function lipPath(L, g) {
    var dx = L.tx - L.crX, dy = L.ty - L.crY;
    ctx.beginPath();
    ctx.moveTo(L.bx, waveY(L.bx, g));
    ctx.bezierCurveTo(L.crX + dx * 0.45, L.crY - g.h * 0.13 * L.lk - U * 0.06, L.tx + dx * 0.28, L.crY + dy * 0.2, L.tx, L.ty);
    ctx.bezierCurveTo(L.tx - dx * 0.04, L.ty - dy * 0.5, L.crX + dx * 0.55, L.crY + dy * 0.22 + g.h * 0.03, L.ix, L.iy);
    ctx.closePath();
  }

  var waterFill = '#0a6c9a'; // the near water's gradient (this frame)
  function drawWave(g, w, now, closeK) {
    var fl = -LEFT, x1 = W, bottom = w.bottom, alt = scene.alt, night = w.night;
    var faceTop = mix3(FACE_TOP, alt), farAt = mixc(mix3(FAR_TOP, alt), mix3(FAR_BOT, alt), clamp((g.ys - w.hy) / Math.max(1, bottom - w.hy)));
    var deep = mix3(DEEP, alt), wk = clamp(g.h / (U * 1.6));
    var crest = g.ys - g.h - U * 0.1, y1 = Math.max(crest + 2, Math.max(g.ys + U * 0.2, bottom));
    var bg = ctx.createLinearGradient(0, crest, 0, y1);
    bg.addColorStop(0, rgb(mixc(farAt, faceTop, wk)));
    bg.addColorStop(clamp((g.ys - crest) / (y1 - crest), 0.05, 0.95), rgb(mixc(farAt, deep, 0.15 + 0.25 * wk)));
    bg.addColorStop(1, rgb(deep));
    surfacePath(g, fl, x1, y1, true);
    ctx.fillStyle = waterFill = bg;
    ctx.fill();
    ctx.save();
    surfacePath(g, fl, x1, y1, true);
    ctx.clip();
    if (g.h > U * 0.3) {
      // light shining through the thin water near the crest
      var lx = g.cx + g.faceW * 0.12, ly = g.ys - g.h * 0.78;
      var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, g.h * 0.8);
      lg.addColorStop(0, rgb(faceTop, 0.5 * wk));
      lg.addColorStop(1, rgb(faceTop, 0));
      ctx.fillStyle = lg;
      ctx.fillRect(lx - g.h, ly - g.h, g.h * 2, g.h * 2);
      // the barrel's shadow under the lip
      var L = lipShape(g, closeK);
      if (L) {
        var bx = lerp(L.crX, L.tx, 0.55), by = lerp(L.crY, L.ty, 0.6) + g.h * 0.05;
        var shg = ctx.createRadialGradient(bx, by, 0, bx, by, g.h * 0.42);
        shg.addColorStop(0, 'rgba(0, 24, 50, ' + 0.5 * L.lk + ')');
        shg.addColorStop(1, 'rgba(0, 24, 50, 0)');
        ctx.fillStyle = shg;
        ctx.fillRect(bx - g.h, by - g.h, g.h * 2, g.h * 2);
      }
    }
    // streaks of water drawn up the face (they flow, so the wave feels alive)
    ctx.lineWidth = Math.max(1, U * 0.02);
    for (var i = 0; i < 7 && wk > 0.05; i++) {
      var d = ((i / 7 + now / 5200) % 1), off = U * 0.12 + d * (g.h * 0.9 + U * 0.8);
      ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.16 * Math.sin(d * Math.PI) * wk) + ')';
      ctx.beginPath();
      var xa = g.cx - g.backW * 0.5, xb = g.cx + g.faceW * 1.1, first = true;
      for (var x = xa; x <= xb; x += U * 0.12) {
        var y = waveY(x, g) + off * (0.4 + 0.6 * clamp((x - g.cx) / g.faceW + 0.5));
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // bioluminescent plankton on the night sea
    if (night > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      for (var j = 0; j < 36; j++) {
        var px = fl + ((j * 97.3 + now * 0.01 * (1 + j % 3)) % (W + LEFT)), py = waveY(px, g) + U * (0.15 + (j * 37 % 19) / 19 * 2.4);
        ctx.fillStyle = 'rgba(90, 255, 235, ' + night * (0.25 + 0.25 * Math.sin(now / 300 + j)) + ')';
        ctx.beginPath();
        ctx.arc(px, py, U * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    // the surface line
    surfacePath(g, fl, x1, y1, false);
    ctx.lineWidth = Math.max(1.2, U * 0.025);
    ctx.strokeStyle = night > 0.3 ? 'rgba(120, 255, 245, ' + (0.4 + 0.4 * night) + ')' : 'rgba(255, 255, 255, 0.45)';
    ctx.stroke();
    if (night > 0.3) glowStroke(U * 0.16, 'rgba(80, 255, 240, ' + 0.22 * night + ')');
  }
  // A soft glow along the current path (cheaper than shadowBlur): wide faint strokes.
  function glowStroke(width, col) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.lineWidth = width * 0.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawLip(g, w, now, closeK, fade) {
    var L = lipShape(g, closeK);
    if (!L) return;
    var alt = scene.alt, faceTop = mix3(FACE_TOP, alt), foam = mix3(FOAM, alt), night = w.night;
    var dx = L.tx - L.crX, dy = L.ty - L.crY;
    ctx.save();
    ctx.globalAlpha = fade == null ? 1 : fade;
    if (!closeK || closeK < 0.6) { // the barrel: the wave's inside wall under the lip
      ctx.beginPath();
      ctx.moveTo(L.tx, L.ty);
      ctx.bezierCurveTo(L.tx - dx * 0.04, L.ty - dy * 0.5, L.crX + dx * 0.55, L.crY + dy * 0.22 + g.h * 0.03, L.ix, L.iy);
      for (var bx = L.ix; bx < L.tx; bx += Math.max(3, U * 0.08)) ctx.lineTo(bx, waveY(bx, g));
      ctx.lineTo(L.tx, waveY(L.tx, g));
      ctx.closePath();
      var tg = ctx.createLinearGradient(L.ix, L.iy, L.tx, L.ty);
      var wall = mixc(faceTop, mix3(DEEP, alt), 0.55);
      tg.addColorStop(0, rgb(wall, 0.95 * (1 - (closeK || 0))));
      tg.addColorStop(1, rgb(mixc(wall, faceTop, 0.5), 0.75 * (1 - (closeK || 0))));
      ctx.fillStyle = tg;
      ctx.fill();
    }
    lipPath(L, g);
    var lg = ctx.createLinearGradient(L.crX, L.crY, L.tx, L.ty);
    lg.addColorStop(0, rgb(mixc(faceTop, foam, 0.15), 0.92));
    lg.addColorStop(0.6, rgb(mixc(faceTop, foam, 0.55), 0.92));
    lg.addColorStop(1, rgb(foam, 0.95));
    ctx.fillStyle = lg;
    ctx.fill();
    // the lip's underside: a darker line where it hangs over the barrel
    ctx.beginPath();
    ctx.moveTo(L.tx, L.ty);
    ctx.bezierCurveTo(L.tx - dx * 0.04, L.ty - dy * 0.5, L.crX + dx * 0.55, L.crY + dy * 0.22 + g.h * 0.03, L.ix, L.iy);
    ctx.lineWidth = Math.max(1.5, U * 0.035);
    ctx.strokeStyle = night > 0.3 ? 'rgba(0, 60, 80, 0.5)' : 'rgba(0, 50, 90, 0.35)';
    ctx.stroke();
    // foam along the lip's edge
    ctx.beginPath();
    ctx.moveTo(L.bx, waveY(L.bx, g));
    ctx.bezierCurveTo(L.crX + dx * 0.45, L.crY - g.h * 0.13 * L.lk - U * 0.06, L.tx + dx * 0.28, L.crY + dy * 0.2, L.tx, L.ty);
    ctx.lineWidth = Math.max(2, U * 0.06);
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgb(foam, 0.95);
    ctx.stroke();
    if (night > 0.3) glowStroke(U * 0.26, 'rgba(90, 255, 240, ' + 0.2 * night + ')');
    ctx.restore();
    // feathering spray off the crest and the lip tip
    if (S.phase === 'flying' || (closeK && closeK < 1)) {
      var n = Math.random() < 0.6 + 0.4 * L.lk ? 2 : 1;
      for (var i = 0; i < n; i++) {
        emit(L.tx + (Math.random() - 0.5) * U * 0.1, L.ty, -U * (0.4 + Math.random() * 1.2), -U * (0.2 + Math.random() * 0.8), 0.5 + Math.random() * 0.5, U * (0.02 + Math.random() * 0.03));
        var cxp = L.crX + (Math.random() - 0.6) * g.h * 0.3;
        emit(cxp, waveY(cxp, g) - U * 0.05, -U * (0.6 + Math.random() * 1.0), -U * (0.3 + Math.random() * 0.5), 0.4 + Math.random() * 0.35, U * (0.015 + Math.random() * 0.02), 'mist');
      }
    }
  }

  // ---- phases ---------------------------------------------------------------------------
  function drawLineup(g, w, now) {
    // the surfer waits on the board, bobbing on the swell
    var a = scene.paddleIn ? clamp((now - scene.paddleIn) / 700) : 1;
    var x = g.sx, y = waveY(x, g), ang = Math.atan(slopeAt(x, g)) * 0.8;
    drawSurfer(x, y, ang, SIT, { night: w.night, now: now, alpha: a });
    ctx.save(); // the legs hang in the water: veil them below the surface
    ctx.beginPath();
    ctx.rect(x - U, y - U * 0.2, U * 2, U * 0.8);
    ctx.clip();
    ctx.translate(0, U * 0.04);
    surfacePath(g, x - U, x + U, y + U, true);
    ctx.globalAlpha = 0.62 * a;
    ctx.fillStyle = waterFill;
    ctx.fill();
    ctx.restore();
    if (S.phase !== 'betting') return;
    // the swell meter: the next wave is on its way
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt), left = Math.max(0, S.bettingEndsAt - Date.now());
    var p = clamp(1 - left / total);
    var bw = Math.min(W * 0.66, U * 5.4, 340), bh = Math.max(16, U * 0.28), cx = W / 2, by = H * 0.3;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 30, 60, 0.35)';
    ctx.shadowBlur = 10;
    roundRect(cx - bw / 2, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(3, 30, 52, 0.5)';
    ctx.fill();
    ctx.restore();
    var ins = 3, iw = bw - ins * 2, ih = bh - ins * 2;
    if (p > 0) {
      ctx.save();
      roundRect(cx - bw / 2 + ins, by + ins, iw, ih, ih / 2);
      ctx.clip();
      var fx = cx - bw / 2 + ins + iw * p;
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, by);
      for (var yy = 0; yy <= ih + 0.5; yy += 2) ctx.lineTo(fx + Math.sin(yy / ih * Math.PI * 2 + now / 140) * ih * 0.35, by + ins + yy);
      ctx.lineTo(cx - bw / 2, by + bh);
      ctx.closePath();
      var fgr = ctx.createLinearGradient(cx - bw / 2, 0, fx, 0);
      fgr.addColorStop(0, '#0b8fc0');
      fgr.addColorStop(0.75, '#34e0f0');
      fgr.addColorStop(1, '#e9fbff');
      ctx.fillStyle = fgr;
      ctx.fill();
      ctx.restore();
    }
    roundRect(cx - bw / 2, by, bw, bh, bh / 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    var fs = Math.round(clamp(U * 0.34, 14, 28));
    ctx.font = 'italic 900 ' + fs + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(4, 50, 90, 0.75)';
    ctx.fillStyle = '#fff';
    var label = S.bettingPhrase.toUpperCase();
    ctx.strokeText(label, cx, by - fs * 0.35);
    ctx.fillText(label, cx, by - fs * 0.35);
    ctx.font = '800 ' + Math.round(fs * 0.55) + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    var sub = 'Next wave in ' + Math.ceil(left / 1000) + 's';
    ctx.strokeText(sub, cx, by + bh + fs * 0.3);
    ctx.fillText(sub, cx, by + bh + fs * 0.3);
  }

  function boardOnFace(g) {
    var x = g.sx, y = waveY(x, g), ang = Math.atan(slopeAt(x, g));
    return { x: x, y: y, ang: ang * 0.72 };
  }

  function drawRide(g, w, now) {
    var b = boardOnFace(g), t = (now - scene.riseAt) / RISE_MS, pose = poseAt(now);
    var stand = clamp((t - 0.42) / 0.58);
    // the board's spray: a fan off the tail, bigger as the wave grows
    var rate = stand * (1 + scene.k * 2.5);
    for (var i = 0; i < Math.round(rate + Math.random()); i++) {
      var tail = -U * 0.5, tx = b.x + Math.cos(b.ang) * tail, ty = b.y + Math.sin(b.ang) * tail;
      emit(tx, ty, -U * (1 + Math.random() * 1.8) * (1 + scene.k * 0.5), -U * (1.2 + Math.random() * 2) * (0.6 + scene.k * 0.5), 0.45 + Math.random() * 0.4, U * (0.02 + Math.random() * 0.035));
    }
    drawSurfer(b.x, b.y, b.ang, pose, { night: w.night, now: now, lean: -b.ang * 0.6 * stand, ride: stand > 0.9 });
  }

  function drawWipeout(g, w, now) {
    var c = scene.crash, t = now - scene.crashAt;
    if (!c) return;
    var b = boardOnFace(g);
    if (t < HIT_MS) { // still riding as the lip throws over
      drawSurfer(b.x, b.y, b.ang, c.pose, { night: w.night, now: now, lean: -b.ang * 0.6, ride: true });
      return;
    }
    if (!c.hit) {
      c.hit = true;
      c.from = { x: b.x, y: b.y, ang: b.ang };
      scene.shake = 1;
      var ix = g.sx + U * 0.6, iy = g.sy + U * 0.1;
      for (var i = 0; i < 150; i++) {
        var a = -Math.PI * (0.06 + Math.random() * 0.88), sp = U * (1.5 + Math.random() * 4.5), pre = Math.random() * 0.06;
        emit(ix + (Math.random() - 0.5) * U * 0.8 + Math.cos(a) * sp * pre, iy + (Math.random() - 0.5) * U * 0.3 + Math.sin(a) * sp * pre, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + Math.random() * 0.6, U * (0.018 + Math.random() * 0.04));
      }
      for (var j = 0; j < 16; j++) {
        emit(ix + (Math.random() - 0.5) * U * 2.2, iy + (Math.random() - 0.3) * U * 0.8, (Math.random() - 0.3) * U * 0.8, -Math.random() * U * 0.4, 1.1 + Math.random() * 0.5, U * (0.3 + Math.random() * 0.35), 'foam');
      }
    }
    var k = (t - HIT_MS) / 1000, f = c.from, fade = 1 - clamp((t - HIT_MS) / ((WIPE_MS - HIT_MS) * 0.8));
    if (fade <= 0) return;
    // the rider tumbles into the wash; the board flips away
    drawSurfer(f.x + U * 1.1 * k, f.y - U * 0.3 + (-U * 1.4 * k + U * 3.2 * k * k), f.ang + k * 7, TUMBLE, { night: w.night, now: now, alpha: fade, noBoard: true, scale: 1 - 0.2 * clamp(k) });
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(f.x + U * 2.1 * k, f.y - U * 2.6 * k + U * 3.4 * k * k);
    ctx.rotate(f.ang - k * 9);
    drawBoard(w.night);
    ctx.restore();
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0;

  function frame(now) {
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    // ---- state of the wave, the camera and the sky
    scene.alt += (skyTarget() - scene.alt) * Math.min(1, dt / 400);
    if (now - themeAt > 400) { themeAt = now; game.theme(hex(mix3(SKY_TOP, scene.alt))); }
    var closeK = 0, lipFade = 1;
    if (S.phase === 'flying') {
      if (!scene.riseAt) scene.riseAt = now - RISE_MS; // joined mid-ride
      var rk = easeIO((now - scene.riseAt) / RISE_MS), m = game.currentMult();
      scene.k = waveK(m);
      scene.r = rk;
      scene.h = Math.min(heightCap(rk), U * (1.2 + 4.0 * scene.k)) * rk;
      surfSet(m);
      scene.scroll += U * (1.4 + scene.k * 2.2) * dt / 1000 * (0.3 + 0.7 * rk);
    } else if (S.phase === 'crashed') {
      if (!scene.crashAt) { scene.crashAt = now - WIPE_MS; scene.crash = { h: scene.h, k: scene.k, r: scene.r, p: P0, hit: true, from: null, pose: STAND }; }
      var c = scene.crash, tc = now - scene.crashAt;
      closeK = Math.pow(clamp(tc / HIT_MS), 1.6); // the lip throws, gathering speed
      lipFade = 1 - clamp((tc - HIT_MS) / 500);
      scene.h = c.h * (1 - 0.65 * easeIO((tc - HIT_MS) / (WIPE_MS - HIT_MS + 1600))); // the wave slowly collapses
      scene.scroll += U * 0.8 * dt / 1000;
    } else {
      scene.h += (0 - scene.h) * Math.min(1, dt / 500);
      scene.r += (0 - scene.r) * Math.min(1, dt / 500);
      scene.k += (0 - scene.k) * Math.min(1, dt / 500);
      scene.scroll += U * 0.35 * dt / 1000;
    }
    stepParticles(dt / 1000);
    scene.shake = Math.max(0, scene.shake - dt / 420);
    FOAM_C = mix3(FOAM, scene.alt);

    if (W && H) {
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      if (scene.shake > 0) ctx.translate((Math.random() - 0.5) * U * 0.12 * scene.shake, (Math.random() - 0.5) * U * 0.12 * scene.shake);
      ctx.clearRect(-LEFT - 20, -TOP - 20, FULL_W + 40, FULL_H + 40);
      var g = geom(now);
      var w = drawWorld(g, now);
      drawWave(g, w, now, closeK);
      if (S.phase === 'flying') { drawLip(g, w, now, 0); drawRide(g, w, now); } else if (S.phase === 'crashed') {
        if (lipFade > 0) drawLip(g, w, now, closeK, lipFade);
        drawWipeout(g, w, now);
      } else drawLineup(g, w, now);
      drawParticles(w.night);
      ctx.restore();
    }
    // texts over the scene
    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden && flew.textContent !== S.crashPhrase) flew.textContent = S.crashPhrase;
    if (S.phase === 'flying') {
      if (mult.className !== 'mult') mult.className = 'mult';
      setText(mult, game.currentMult().toFixed(2) + 'x'); setText(hint, '');
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      if (mult.className !== 'mult mult--crashed') mult.className = 'mult mult--crashed';
      setText(mult, (S.crashPoint || 1).toFixed(2) + 'x'); setText(hint, '');
    } else if (S.phase === 'betting') {
      setText(mult, ''); setText(hint, '');
    } else {
      setText(mult, ''); setText(hint, S.gotSnapshot ? 'Waiting for the next wave…' : 'Paddling out…');
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
