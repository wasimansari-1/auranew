/* Dragon Ascent — NEXORNG original crash game. Game logic: ../_core/crash-client.js; this file is
 * the look and sound, all made in code: a friendly jade dragon curled on a mountain monastery
 * while bets are open, the take-off, the climb through misty peaks, clouds, sunset, aurora and
 * stars, and the storm that strikes it at the crash (it tumbles away). Sound effects and the
 * music are generated with WebAudio. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0048', onChange: render, onSignal: onSignal });
  var S = game.S;
  var KEY = 'dragonascent';

  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000); // never hang the loader

  // ---------------------------------------------------------------- timings (sound = animation)
  var TAKEOFF_MS = 1200; // the dragon uncoils and leaps off the terrace (the whoosh lasts exactly this)
  var STRIKE_MS = 200; // the lightning strike (crack + flash)…
  var TUMBLE_MS = 1400; // …then it tumbles out of the sky (rumble + falling whistle end together)
  var MIST_MS = 700; // a mist wipe carries the scene back to the monastery for the next round

  // ---------------------------------------------------------------- sound (WebAudio, generated)
  var soundOn = true, musicOn = true;
  try { soundOn = localStorage.getItem(KEY + '-sound') !== 'off'; } catch (e) { /* default on */ }
  try { musicOn = localStorage.getItem(KEY + '-music') !== 'off'; } catch (e) { /* default on */ }
  var AC = window.AudioContext || window.webkitAudioContext;
  var ac = null, sfxBus = null, musicBus = null, noiseBuf = null, wind = null;

  function audio() {
    if (ac || !AC) return ac;
    try { ac = new AC(); } catch (e) { return null; }
    sfxBus = ac.createGain();
    sfxBus.gain.value = soundOn ? 0.9 : 0;
    sfxBus.connect(ac.destination);
    musicBus = ac.createGain();
    musicBus.gain.value = musicOn ? 0.55 : 0;
    musicBus.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }
  function live() { return ac && ac.state === 'running'; }
  function resume() {
    if (!audio()) return;
    if (ac.state !== 'running') { var p = ac.resume(); if (p && p.catch) p.catch(function () {}); }
  }
  audio();
  resume(); // the tap that opened the game usually allows it; otherwise the first tap here does
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, resume, true); });
  document.addEventListener('visibilitychange', function () {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else resume();
  });

  function tone(type, f0, f1, t, dur, gain, bus) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(type, f0, f1, t, dur, gain, q, attack) {
    var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type; f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t); s.stop(t + dur + 0.02);
  }
  function sfxOk() { return live() && soundOn; }

  function sfxClick() { // a little temple wood-block
    if (!sfxOk()) return;
    var t = ac.currentTime;
    tone('sine', 1250, 720, t, 0.06, 0.14);
    noise('bandpass', 3200, 3200, t, 0.025, 0.05, 2);
  }
  function sfxBet() { // two soft chimes
    if (!sfxOk()) return;
    var t = ac.currentTime;
    tone('triangle', 659.25, 659.25, t, 0.25, 0.07);
    tone('triangle', 987.77, 987.77, t + 0.08, 0.35, 0.06);
  }
  function sfxTakeoff() { // rising gust + a flute glide, exactly TAKEOFF_MS long
    if (!sfxOk()) return;
    var t = ac.currentTime, d = TAKEOFF_MS / 1000;
    noise('bandpass', 260, 2600, t, d, 0.3, 0.9, d * 0.3);
    tone('sine', 92, 48, t, 0.45, 0.25);
    var o = ac.createOscillator(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(392, t);
    o.frequency.exponentialRampToValueAtTime(784, t + d * 0.85);
    lfo.frequency.value = 6; lg.gain.value = 9;
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + d * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(sfxBus);
    o.start(t); lfo.start(t); o.stop(t + d + 0.02); lfo.stop(t + d + 0.02);
  }
  function sfxCashout() { // bell arpeggio (pentatonic)
    if (!sfxOk()) return;
    var t = ac.currentTime;
    [587.33, 739.99, 880, 1174.66].forEach(function (f, i) {
      tone('sine', f, f, t + i * 0.07, 0.9, 0.09);
      tone('sine', f * 2.76, f * 2.76, t + i * 0.07, 0.35, 0.025);
    });
  }
  function sfxStorm() { // crack (STRIKE_MS) then rumble + falling whistle (TUMBLE_MS)
    if (!sfxOk()) return;
    var t = ac.currentTime, s = STRIKE_MS / 1000, d = TUMBLE_MS / 1000;
    noise('highpass', 1800, 900, t, s + 0.05, 0.55, 0.7, 0.003);
    noise('lowpass', 260, 80, t + 0.04, s + d - 0.04, 0.5, 0.6, 0.06);
    tone('sine', 820, 140, t + s, d, 0.07);
  }
  function windStart() { // the air rushing by in flight
    if (!sfxOk() || wind) return;
    var t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = 'bandpass'; f.Q.value = 0.6; f.frequency.value = 480;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.5);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t);
    wind = { s: s, f: f, g: g };
  }
  function windTune(alt) {
    if (!wind || !live()) return;
    wind.f.frequency.setTargetAtTime(480 + alt * 900, ac.currentTime, 0.3);
  }
  function windStop() {
    if (!wind) return;
    var w = wind, t = ac.currentTime;
    wind = null;
    w.g.gain.cancelScheduledValues(t);
    w.g.gain.setTargetAtTime(0.0001, t, 0.08);
    w.s.stop(t + 0.5);
  }

  // Music: a gentle pentatonic pluck melody over a soft pad; a hand drum joins in flight.
  var SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880];
  var PROG = [[146.83, 220], [123.47, 185], [98, 146.83], [110, 164.81]]; // D · Bm · G · A
  var RHYTHMS = [[1, 0, 1, 0, 1, 1, 0, 1], [1, 0, 0, 1, 0, 1, 1, 0], [1, 1, 0, 1, 0, 0, 1, 0], [1, 0, 1, 1, 0, 1, 0, 0]];
  var mus = { next: 0, step: 0, note: 4, rhythm: RHYTHMS[0] };
  var STEP = 60 / 88 / 2;
  function pluck(f, t, gain) {
    var o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 2;
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(musicBus);
    o.start(t); o2.start(t); o.stop(t + 1.15); o2.stop(t + 1.15);
  }
  function pad(fs, t, dur) {
    fs.forEach(function (f) {
      var o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
      lp.type = 'lowpass'; lp.frequency.value = 700;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.8);
      g.gain.setValueAtTime(0.022, t + dur - 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
      o.connect(lp); lp.connect(g); g.connect(musicBus);
      o.start(t); o.stop(t + dur + 0.7);
    });
  }
  function drum(t, gain) {
    tone('sine', 140, 55, t, 0.28, gain, musicBus);
  }
  function musicTick() {
    if (!live() || !musicOn) { if (ac) mus.next = ac.currentTime + 0.05; return; }
    if (mus.next < ac.currentTime) mus.next = ac.currentTime + 0.05;
    while (mus.next < ac.currentTime + 0.25) {
      var t = mus.next, st = mus.step, inBar = st % 8, bar = Math.floor(st / 8);
      if (inBar === 0) {
        mus.rhythm = RHYTHMS[Math.floor(Math.random() * RHYTHMS.length)];
        var ch = PROG[bar % PROG.length];
        pluck(ch[0], t, 0.09);
        if (bar % 2 === 0) pad([ch[0] * 2, ch[1] * 2], t, STEP * 16);
      }
      if (mus.rhythm[inBar]) {
        mus.note = Math.max(0, Math.min(SCALE.length - 1, mus.note + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
        pluck(SCALE[mus.note], t, 0.05);
      }
      if (S.phase === 'flying' && (inBar === 0 || inBar === 3 || inBar === 6)) drum(t, inBar === 0 ? 0.12 : 0.07);
      mus.next += STEP; mus.step++;
    }
  }
  setInterval(musicTick, 90);

  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem(KEY + '-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.03);
    if (!on) windStop(); else if (S.phase === 'flying' && scene.takeoffAt && performance.now() - scene.takeoffAt > TAKEOFF_MS) windStart();
  }
  function setMusic(on) {
    musicOn = on;
    try { localStorage.setItem(KEY + '-music', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('music').setAttribute('aria-pressed', String(on));
    $('music').setAttribute('aria-label', on ? 'Music on' : 'Music off');
    if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.55 : 0, ac.currentTime, 0.1);
  }

  // ---------------------------------------------------------------- engine moments
  var scene = { takeoffAt: 0, crashAt: 0, crashFrom: null, mistAt: 0, x: 0, lastT: 0, alt: 0, bolt: null, boltAt: 0 };
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') {
      scene.takeoffAt = now; scene.crashAt = 0; scene.x = 0;
      burst(now);
      sfxTakeoff();
      setTimeout(function () { if (S.phase === 'flying') windStart(); }, TAKEOFF_MS);
    }
    if (name === 'crash') {
      scene.crashAt = now;
      scene.crashFrom = currentSpine(now);
      windStop();
      sfxStorm();
    }
    if (name === 'betting') { scene.mistAt = now; }
    if (name === 'win') { sfxCashout(); toast(d.text, 'win'); }
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

  // ---------------------------------------------------------------- avatars (drawn in SVG)
  // Sixteen little sky-spirit faces: a hue, a face and one of four crowns (horns, ears, sprout, flame).
  var AVATARS = [];
  (function () {
    for (var k = 0; k < 16; k++) {
      var hue = (k * 67 + 160) % 360;
      var bg = 'hsl(' + hue + ',48%,30%)', face = 'hsl(' + ((hue + 28) % 360) + ',72%,70%)', dark = 'hsl(' + hue + ',50%,16%)';
      var crown = [
        '<path d="M10 11 8 4l5 5zM22 11l2-7-5 5z" fill="#ffd77a"/>',
        '<circle cx="9.5" cy="9.5" r="3.6" fill="' + face + '"/><circle cx="22.5" cy="9.5" r="3.6" fill="' + face + '"/>',
        '<path d="M16 9c0-3 2-5 5-5-0 3-2 5-5 5z" fill="#7df0b8"/><path d="M16 10V6" stroke="#2f9a6c" stroke-width="1.2"/>',
        '<path d="M16 3c3 3 3 5 0 8-3-3-3-5 0-8z" fill="#ff8a63"/>',
      ][k % 4];
      var eyes = k % 3 === 0
        ? '<path d="M11 18q1.6-2 3.2 0M17.8 18q1.6-2 3.2 0" fill="none" stroke="' + dark + '" stroke-width="1.6" stroke-linecap="round"/>'
        : '<circle cx="12.6" cy="17.6" r="1.9" fill="' + dark + '"/><circle cx="19.4" cy="17.6" r="1.9" fill="' + dark + '"/><circle cx="13.2" cy="17" r=".6" fill="#fff"/><circle cx="20" cy="17" r=".6" fill="#fff"/>';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="' + bg + '"/>' + crown +
        '<ellipse cx="16" cy="19" rx="9.5" ry="8.6" fill="' + face + '"/>' + eyes +
        '<path d="M13.6 22q2.4 2 4.8 0" fill="none" stroke="' + dark + '" stroke-width="1.5" stroke-linecap="round"/>' +
        '<ellipse cx="10.6" cy="21.2" rx="1.8" ry="1.1" fill="#ff7f95" opacity=".55"/><ellipse cx="21.4" cy="21.2" rx="1.8" ry="1.1" fill="#ff7f95" opacity=".55"/></svg>';
      AVATARS.push('url("data:image/svg+xml,' + encodeURIComponent(svg) + '")');
    }
  })();
  function avatarIndex(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % AVATARS.length;
  }
  function playerFace(name) {
    var av = document.createElement('i');
    av.className = 'avatar';
    av.style.background = AVATARS[avatarIndex(name)] + ' center / cover no-repeat';
    return av;
  }

  // ---------------------------------------------------------------- DOM render
  var tab = 'all';
  // Players in this round, on the scene (../_core/players.js), with this game's faces.
  var playersStrip;
  var historyKey = '';

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: playerFace });
    playersStrip.update(S);
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot;
    $('balance').textContent = S.balance == null ? '—' : game.money(S.balance);
    $('mode').textContent = S.demo ? 'Demo balance' : 'Balance';

    var key = S.history.join(',');
    if (key !== historyKey) {
      historyKey = key;
      var h = $('history');
      h.innerHTML = '';
      S.history.forEach(function (c) {
        var s = document.createElement('span');
        s.className = 'chip' + (c >= 10 ? ' chip--big' : c >= 2 ? ' chip--mid' : '');
        s.textContent = c.toFixed(2) + 'x';
        h.appendChild(s);
      });
    }

    updateButtons();
    renderList();

    $('fRound').textContent = S.round || '—';
    $('fHash').textContent = S.hash || '—';
    $('fSeed').textContent = S.seed || 'revealed when the round ends';
  }

  // ---- bet shrines (slot 0 and 1) ---------------------------------------------------
  // A carved jade frame around black lacquer: the stake on a red lacquer plaque between two
  // jade beads, quick amounts as cash coins strung on a red cord, a hanging lantern that lights
  // up for auto cash-out (with a paper-scroll multiplier) and the dragon's pearl, held in its
  // claw, as the Bet / Cash Out button.
  var CLAW = // three scaly jade fingers with gold talons, gripping the pearl from below
    '<svg class="pearl__claw" viewBox="0 0 100 100" aria-hidden="true">' +
    '<g fill="none" stroke-linecap="round">' +
    '<path d="M46 93C30 94 16 86 12.5 70M54 93c16 1 30-7 33.5-23M50 95V84" stroke="#0a3f35" stroke-width="9"/>' +
    '<path d="M46 93C30 94 16 86 12.5 70M54 93c16 1 30-7 33.5-23M50 95V84" stroke="#1c8a72" stroke-width="6.4"/>' +
    '<path d="M44 91.6C31 92 20 86 15 74M56 91.6c13 .4 24-5.6 29-17.6" stroke="#7ff0c8" stroke-width="1.2" stroke-dasharray="2.4 3.2" opacity=".8"/>' +
    '</g>' +
    '<path d="M34 101c2-8 8-12 16-12s14 4 16 12z" fill="#1c8a72" stroke="#0a3f35" stroke-width="1.4"/>' +
    '<path d="M40 98q5-3.4 10-3.4t10 3.4" fill="none" stroke="#7ff0c8" stroke-width="1.1" opacity=".7"/>' +
    '<g fill="#ffd77a" stroke="#8a5410" stroke-width="1" stroke-linejoin="round">' +
    '<path d="M8.6 71.5C7 64 9.4 58.6 14.6 54.6 13 60 13.6 65 16.4 69.6z"/>' +
    '<path d="M91.4 71.5C93 64 90.6 58.6 85.4 54.6 87 60 86.4 65 83.6 69.6z"/>' +
    '<path d="M46.4 85.6C47 80.6 48.6 77 50 73.6c1.4 3.4 3 7 3.6 12z"/>' +
    '</g></svg>';
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="panel__inner">' +
      '<span class="panel__tag" aria-hidden="true">BET ' + (slot ? 'II' : 'I') + '</span>' +
      '<div class="panel__controls">' +
      '<div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<label class="plaque"><span class="plaque__cap">Stake</span><input class="amount" inputmode="decimal" value="0.10" aria-label="Bet amount"></label>' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<div class="auto">' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out">' +
      '<span class="lantern" aria-hidden="true"><span class="lantern__body"></span></span></label>' +
      '<span class="auto__label">Auto<br>cash-out</span>' +
      '<span class="scroll"><input class="auto__x" inputmode="decimal" value="2.00" aria-label="Auto cash-out multiplier"><i aria-hidden="true">×</i></span></div>' +
      '</div>' +
      '<div class="pearl">' +
      '<button type="button" class="action"><span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      CLAW +
      '</div>' +
      '</div>';
    $('panels').appendChild(el);
    var q = function (sel) { return el.querySelector(sel); };
    return { slot: slot, el: el, amount: q('.amount'), action: q('.action'), label: q('.action__label'), sub: q('.action__sub'), autoOn: q('.auto__on'), autoAt: q('.auto__x'), quick: q('.quick'), quickBtns: [] };
  });
  // Phone: one shrine only (CSS); wide screens show both.

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
    var amt = readAmount(p);
    p.quickBtns.forEach(function (b) {
      var on = Math.abs(b.value - amt) < 0.001;
      if (b.el.classList.contains('quick--on') !== on) b.el.classList.toggle('quick--on', on);
    });
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
      setText($('countLabel'), 'All bets');
      setText($('betCount'), String(S.bets.length));
      if (!S.bets.length) list.appendChild(cell('No bets yet this round.', 'empty'));
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
  function setCols() {
    var c = $('cols'), labels = tab === 'all' ? ['User', 'Bet', 'X', 'Cash out'] : ['Time', 'Bet', 'X', 'Cash out'];
    Array.prototype.forEach.call(c.children, function (s, i) { setText(s, labels[i]); });
  }

  // ---------------------------------------------------------------- scene (canvas)
  var canvas = $('scene');
  var stageEl = document.querySelector('.stage');
  var ctx = canvas.getContext('2d');
  // The scene fills the whole stage (under the floating top bar and, on wide screens, behind
  // the bets list); the play area is W×H at (LEFT, TOP). The world is drawn from -LEFT/-TOP.
  var W = 0, H = 0, TOP = 0, LEFT = 0, FULL_W = 0, FULL_H = 0, S0 = 300;

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
    // The results row (and on wide screens the panels) float over the scene's lower part: the
    // play area ends just above the results row.
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(120, playBottom - TOP);
    S0 = Math.max(160, Math.min(W * 0.75, H));
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

  // ---- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function mixC(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function rgb(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')'; }
  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join(''); }
  function rand(seed) { // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var R = rand(4848);

  // ---- the sky climbs with the multiplier: alt = log10(multiplier)
  // dawn mist (1x) · clear morning over the peaks (1.5x) · bright day above the clouds (2.6x) ·
  // sunset (4.6x) · dusk (8x) · aurora night (12x) · the stars (25x+)
  var SKY = [
    [0.00, [70, 124, 156], [250, 204, 170]],
    [0.18, [66, 146, 200], [200, 230, 236]],
    [0.42, [52, 118, 208], [236, 228, 206]],
    [0.66, [96, 66, 142], [255, 150, 98]],
    [0.90, [28, 36, 82], [96, 66, 118]],
    [1.10, [8, 24, 46], [18, 66, 82]],
    [1.40, [3, 5, 18], [16, 14, 44]],
  ];
  function sky(alt) {
    if (alt <= SKY[0][0]) return { top: SKY[0][1], bottom: SKY[0][2] };
    for (var i = 1; i < SKY.length; i++) {
      if (alt <= SKY[i][0]) {
        var k = smooth(SKY[i - 1][0], SKY[i][0], alt);
        return { top: mixC(SKY[i - 1][1], SKY[i][1], k), bottom: mixC(SKY[i - 1][2], SKY[i][2], k) };
      }
    }
    var l = SKY[SKY.length - 1];
    return { top: l[1], bottom: l[2] };
  }
  function climb() {
    if (S.phase === 'flying') return Math.log(Math.max(1, game.currentMult())) / Math.LN10;
    if (S.phase === 'crashed') return Math.log(Math.max(1, S.crashPoint)) / Math.LN10;
    return 0;
  }
  function cam() { return scene.alt * H * 2.4; } // how far the world has dropped (px)

  // ---- world objects (seeded, so every visit looks the same)
  var RIDGES = [ // far → near: parallax depth, base line (× H), peak height (× S0), colour, haze
    { d: 0.12, y0: 0.50, amp: 0.30, col: [92, 136, 168], haze: 0.62, s: [R() * 6, R() * 6, R() * 6] },
    { d: 0.26, y0: 0.60, amp: 0.30, col: [64, 108, 134], haze: 0.45, s: [R() * 6, R() * 6, R() * 6] },
    { d: 0.46, y0: 0.72, amp: 0.27, col: [40, 84, 98], haze: 0.28, s: [R() * 6, R() * 6, R() * 6] },
    { d: 0.72, y0: 0.88, amp: 0.22, col: [22, 58, 62], haze: 0.12, s: [R() * 6, R() * 6, R() * 6] },
  ];
  var clouds = [];
  for (var ci = 0; ci < 24; ci++) clouds.push({ a: 0.12 + R() * 0.95, d: 0.55 + R() * 0.8, x: R(), s: 0.55 + R() * 0.8, k: R() });
  var stars = [];
  for (var si = 0; si < 140; si++) stars.push({ x: R(), y: R(), r: 0.5 + R() * 1.4, t: R() * 6.28 });
  var lanterns = [];
  for (var li = 0; li < 12; li++) lanterns.push({ a: 0.5 + R() * 0.6, d: 0.45 + R() * 0.6, x: R(), t: R() * 6.28 });
  var cranes = [];
  for (var bi = 0; bi < 3; bi++) cranes.push({ a: 0.06 + R() * 0.32, x: R(), n: 3 + Math.floor(R() * 3), v: 0.02 + R() * 0.03, t: R() * 6 });
  var petals = [];
  for (var pi = 0; pi < 18; pi++) petals.push({ x: R(), y: R(), v: 0.4 + R() * 0.6, t: R() * 6.28, s: 0.6 + R() * 0.7 });
  var particles = []; // sparkles, wind streaks, dust, smoke
  var shooting = null;

  function ridgeY(L, x) { // ridge top height (px above the base) at world x
    var xs = x / S0;
    var h = 0.5 * Math.sin(xs * 2.3 + L.s[0]) + 0.32 * Math.sin(xs * 5.1 + L.s[1]) + 0.16 * Math.sin(xs * 11.7 + L.s[2]);
    h = (h + 1) / 2;
    return h * h * L.amp * S0 * 1.6;
  }

  function drawSky(sk, now) {
    var g = ctx.createLinearGradient(0, -TOP, 0, H);
    g.addColorStop(0, rgb(sk.top));
    g.addColorStop(1, rgb(sk.bottom));
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    var alt = scene.alt;
    // stars (night and above)
    var night = smooth(0.82, 1.12, alt);
    if (night > 0) {
      ctx.fillStyle = '#fff';
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.45 + 0.55 * Math.sin(now / 600 + st.t) * Math.sin(now / 600 + st.t));
        ctx.beginPath();
        ctx.arc(st.x * FULL_W - LEFT, st.y * FULL_H * 0.9 - TOP, st.r, 0, 6.283);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      // shooting star now and then
      if (!shooting && night > 0.6 && Math.random() < 0.006) shooting = { x: R() * W, y: R() * H * 0.3, at: now };
      if (shooting) {
        var k = (now - shooting.at) / 700;
        if (k > 1) shooting = null;
        else {
          var sx = shooting.x + k * S0 * 0.6, sy = shooting.y + k * S0 * 0.25;
          var sg = ctx.createLinearGradient(sx, sy, sx - S0 * 0.18, sy - S0 * 0.075);
          sg.addColorStop(0, 'rgba(255,255,255,' + (night * (1 - k)) + ')');
          sg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = sg; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - S0 * 0.18, sy - S0 * 0.075); ctx.stroke();
        }
      }
      // crescent moon
      var mx = W * 0.2, my = H * 0.2, mr = S0 * 0.06;
      ctx.globalAlpha = night;
      var mg = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3);
      mg.addColorStop(0, 'rgba(220,240,255,0.35)'); mg.addColorStop(1, 'rgba(220,240,255,0)');
      ctx.fillStyle = mg; ctx.fillRect(mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
      ctx.fillStyle = '#f4f8ff';
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.283); ctx.fill();
      ctx.fillStyle = rgb(sk.top);
      ctx.beginPath(); ctx.arc(mx + mr * 0.45, my - mr * 0.25, mr * 0.88, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // aurora ribbons
    var aur = smooth(0.92, 1.08, alt) * (1 - smooth(1.32, 1.55, alt));
    if (aur > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      [[0.22, [60, 255, 170], 0.0016, 0], [0.32, [120, 200, 255], 0.0023, 2], [0.15, [190, 120, 255], 0.0012, 4]].forEach(function (b) {
        var base = H * b[0], top = [], bot = [];
        for (var x = -LEFT; x <= W + 8; x += 8) {
          var y = base + Math.sin(x * b[2] * 340 / S0 + now / 2400 + b[3]) * H * 0.07 + Math.sin(x * 0.011 + now / 1300) * H * 0.02;
          top.push([x, y - H * (0.16 + 0.08 * Math.sin(x * 0.02 + now / 900 + b[3]))]);
          bot.push([x, y]);
        }
        // one curtain per ribbon: a soft band plus fine vertical rays, each with a single gradient
        var ag = ctx.createLinearGradient(0, base - H * 0.32, 0, base + H * 0.09);
        ag.addColorStop(0, rgb(b[1], 0));
        ag.addColorStop(0.7, rgb(b[1], aur * 0.26));
        ag.addColorStop(1, rgb(b[1], 0));
        ctx.fillStyle = ag; ctx.strokeStyle = ag; ctx.lineWidth = 2;
        ctx.beginPath();
        top.forEach(function (q, i) { if (!i) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); });
        for (var j = bot.length - 1; j >= 0; j--) ctx.lineTo(bot[j][0], bot[j][1]);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        top.forEach(function (q, i) { if ((i + Math.floor(now / 500)) % 3) return; ctx.moveTo(q[0], q[1]); ctx.lineTo(bot[i][0], bot[i][1]); });
        ctx.stroke();
      });
      ctx.restore();
    }
    // the sun: rises at dawn, high by day, sinks in the sunset
    var sunA = 1 - smooth(0.86, 1.0, alt);
    if (sunA > 0) {
      var sp = clamp(alt / 0.9, 0, 1);
      var sx2 = W * (0.78 - 0.18 * sp), sy2 = H * (0.56 - 0.42 * Math.sin(Math.PI * sp)) + smooth(0.6, 1, alt) * H * 0.3;
      var sr = S0 * (0.07 + 0.03 * smooth(0.5, 0.85, alt));
      var sc = mixC([255, 244, 214], [255, 140, 70], smooth(0.45, 0.8, alt));
      var gl = ctx.createRadialGradient(sx2, sy2, sr * 0.6, sx2, sy2, sr * 5);
      gl.addColorStop(0, rgb(sc, 0.55 * sunA)); gl.addColorStop(1, rgb(sc, 0));
      ctx.fillStyle = gl; ctx.fillRect(sx2 - sr * 5, sy2 - sr * 5, sr * 10, sr * 10);
      ctx.fillStyle = rgb(mixC(sc, [255, 255, 255], 0.35), sunA);
      ctx.beginPath(); ctx.arc(sx2, sy2, sr, 0, 6.283); ctx.fill();
    }
  }

  function drawRidges(sk, A) {
    RIDGES.forEach(function (L) {
      var base = H * L.y0 + A * L.d;
      var top = base - L.amp * S0 * 1.6;
      if (top > FULL_H - TOP) return;
      var off = scene.x * L.d;
      var col = mixC(L.col, sk.bottom, L.haze);
      var g = ctx.createLinearGradient(0, top, 0, base + H * 0.3);
      g.addColorStop(0, rgb(mixC(col, [255, 255, 255], 0.08)));
      g.addColorStop(1, rgb(mixC(col, [4, 16, 20], 0.35)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-LEFT, FULL_H);
      for (var x = -LEFT; x <= W + 6; x += 6) ctx.lineTo(x, base - ridgeY(L, x + off));
      ctx.lineTo(W + 6, FULL_H);
      ctx.closePath();
      ctx.fill();
      // snow / light on the crests
      ctx.strokeStyle = rgb(mixC(col, [255, 250, 240], 0.45), 0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var x2 = -LEFT; x2 <= W + 6; x2 += 6) {
        var y = base - ridgeY(L, x2 + off);
        if (x2 === -LEFT) ctx.moveTo(x2, y); else ctx.lineTo(x2, y);
      }
      ctx.stroke();
      // mist in the valleys
      var mg = ctx.createLinearGradient(0, base - L.amp * S0 * 0.5, 0, base + H * 0.1);
      mg.addColorStop(0, rgb(sk.bottom, 0));
      mg.addColorStop(1, rgb(mixC(sk.bottom, [255, 255, 255], 0.2), 0.6));
      ctx.fillStyle = mg;
      ctx.fillRect(-LEFT, base - L.amp * S0 * 0.5, FULL_W, FULL_H - TOP - base + L.amp * S0 * 0.5);
    });
  }

  function cloudPuff(x, y, s, light, shade, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.18, s * 1.25, s * 0.32, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = light;
    [[0, -0.1, 0.55], [-0.55, 0.05, 0.4], [0.55, 0.04, 0.45], [-0.22, -0.32, 0.42], [0.28, -0.3, 0.36], [0.95, 0.12, 0.28], [-0.95, 0.14, 0.26]].forEach(function (b) {
      ctx.beginPath(); ctx.arc(x + b[0] * s, y + b[1] * s, b[2] * s, 0, 6.283); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawClouds(sk, near) {
    var light = rgb(mixC([255, 255, 255], sk.bottom, 0.28)), shade = rgb(mixC(sk.bottom, sk.top, 0.5));
    clouds.forEach(function (c) {
      if ((c.d > 1) !== near) return;
      var y = H * 0.55 - (c.a - scene.alt) * H * 2.4 * c.d;
      var s = S0 * 0.13 * c.s * c.d;
      if (y < -TOP - s || y > FULL_H - TOP + s) return;
      var span = FULL_W + s * 4;
      var x = (((c.x * span - scene.x * c.d * 0.9 + c.k * 40) % span) + span) % span - s * 2 - LEFT;
      cloudPuff(x, y, s, light, shade, (near ? 0.38 : 0.88) * (1 - smooth(1.2, 1.45, scene.alt) * 0.6)); // near ones stay see-through: the dragon is never hidden
    });
  }

  function drawCloudSea(sk, now) {
    var a = smooth(0.3, 0.62, scene.alt);
    if (a <= 0) return;
    var y = H * (1.2 - 0.5 * a) + smooth(1.1, 1.5, scene.alt) * H * 0.28;
    var light = mixC([255, 246, 236], sk.bottom, 0.35), deep = mixC(sk.bottom, sk.top, 0.55);
    var bw = S0 * 0.12, off = (scene.x * 0.3) % (bw * 2);
    ctx.fillStyle = rgb(light, a);
    ctx.beginPath();
    for (var x = -LEFT - bw * 2 - off; x < W + bw * 2; x += bw * 1.1) {
      var k = Math.sin(x * 0.013 + 1.7) * 0.5 + Math.sin(x * 0.031) * 0.3;
      ctx.moveTo(x + bw, y + k * bw * 0.3);
      ctx.arc(x, y + k * bw * 0.3, bw * (0.8 + 0.25 * Math.sin(x * 0.05 + now / 3000)), 0, 6.283);
    }
    ctx.fill();
    var g = ctx.createLinearGradient(0, y - bw * 0.2, 0, y + H * 0.4);
    g.addColorStop(0, rgb(light, a));
    g.addColorStop(1, rgb(deep, a));
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, y, FULL_W, FULL_H);
  }

  function drawLanterns(now) {
    var vis = smooth(0.5, 0.7, scene.alt) * (1 - smooth(1.15, 1.35, scene.alt));
    if (vis <= 0) return;
    lanterns.forEach(function (l) {
      var y = H * 0.55 - (l.a - scene.alt) * H * 2.4 * l.d - ((now / 60) % (H * 2)) * 0.02 * l.d;
      var x = (((l.x * (FULL_W + 80) - scene.x * l.d * 0.6) % (FULL_W + 80)) + FULL_W + 80) % (FULL_W + 80) - 40 - LEFT + Math.sin(now / 1200 + l.t) * 6;
      if (y < -TOP - 30 || y > H + 30) return;
      var s = S0 * 0.022 * (0.6 + l.d);
      var g = ctx.createRadialGradient(x, y, 0, x, y, s * 4);
      g.addColorStop(0, 'rgba(255,190,90,' + (0.55 * vis) + ')'); g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g; ctx.fillRect(x - s * 4, y - s * 4, s * 8, s * 8);
      ctx.globalAlpha = vis;
      ctx.fillStyle = '#ffcf7a';
      ctx.beginPath(); ctx.moveTo(x - s * 0.7, y - s); ctx.lineTo(x + s * 0.7, y - s); ctx.lineTo(x + s * 0.55, y + s); ctx.lineTo(x - s * 0.55, y + s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff9a3c'; ctx.fillRect(x - s * 0.55, y + s * 0.6, s * 1.1, s * 0.4);
      ctx.globalAlpha = 1;
    });
  }

  function drawCranes(now, dt) {
    var vis = 1 - smooth(0.4, 0.6, scene.alt);
    if (vis <= 0) return;
    ctx.strokeStyle = 'rgba(20,40,50,' + (0.55 * vis) + ')';
    ctx.lineWidth = Math.max(1.2, S0 * 0.005);
    ctx.lineCap = 'round';
    cranes.forEach(function (c) {
      c.x -= c.v * dt / 1000;
      var y0 = H * 0.3 - (c.a - scene.alt) * H * 2.4 * 0.8;
      var span = (FULL_W + 200) / S0;
      var bx = ((((c.x - scene.x * 0.6 / S0) % span) + span) % span) * S0 - 100 - LEFT;
      for (var i = 0; i < c.n; i++) {
        var x = bx + i * S0 * 0.05, y = y0 + Math.abs(i - (c.n - 1) / 2) * S0 * 0.03 + i * S0 * 0.006;
        var w = S0 * 0.022, f = Math.sin(now / 180 + c.t + i) * w * 0.7;
        ctx.beginPath(); ctx.moveTo(x - w, y - f); ctx.quadraticCurveTo(x - w * 0.4, y - f * 0.3, x, y); ctx.quadraticCurveTo(x + w * 0.4, y - f * 0.3, x + w, y - f); ctx.stroke();
      }
    });
  }

  // ---- the monastery on its peak
  function monastery(A) { // terrace position (play-area coordinates)
    return { x: W * 0.5 - S0 * 0.12 - scene.x, y: H * 0.86 + A };
  }
  function drawMonastery(A, now) {
    var m = monastery(A), u = S0;
    if (m.y - u * 0.6 > FULL_H - TOP) return;
    var x = m.x, y = m.y;
    // the cliff
    var cg = ctx.createLinearGradient(0, y, 0, y + u * 0.6);
    cg.addColorStop(0, '#3e5e66'); cg.addColorStop(1, '#12272c');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(x - u * 0.62, FULL_H);
    ctx.lineTo(x - u * 0.55, y + u * 0.22); ctx.lineTo(x - u * 0.5, y + u * 0.06); ctx.lineTo(x - u * 0.42, y);
    ctx.lineTo(x + u * 0.62, y); ctx.lineTo(x + u * 0.7, y + u * 0.08); ctx.lineTo(x + u * 0.66, y + u * 0.2); ctx.lineTo(x + u * 0.76, FULL_H);
    ctx.closePath(); ctx.fill();
    // rock strata
    ctx.strokeStyle = 'rgba(160,200,200,0.12)'; ctx.lineWidth = 2;
    for (var i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x - u * 0.5, y + u * 0.06 * i + 6); ctx.lineTo(x + u * 0.6, y + u * 0.05 * i + 10); ctx.stroke(); }
    // moss + terrace stones
    ctx.fillStyle = '#4c9a6e';
    ctx.beginPath(); ctx.ellipse(x + u * 0.1, y + 2, u * 0.56, u * 0.03, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#c9c1aa';
    ctx.fillRect(x - u * 0.44, y - u * 0.02, u * 1.06, u * 0.026);
    ctx.fillStyle = '#8a8370';
    ctx.fillRect(x - u * 0.44, y + u * 0.006, u * 1.06, u * 0.012);
    // railing posts
    ctx.fillStyle = '#b23a26';
    for (var p = 0; p < 9; p++) ctx.fillRect(x + u * 0.2 + p * u * 0.05, y - u * 0.06, u * 0.009, u * 0.045);
    ctx.fillRect(x + u * 0.2, y - u * 0.064, u * 0.41, u * 0.01);
    // the pagoda (three tiers)
    var px = x - u * 0.2, base = y - u * 0.02;
    var tiers = [[0.27, 0.1], [0.22, 0.085], [0.17, 0.075]];
    var ty = base;
    tiers.forEach(function (t, k) {
      var w = u * t[0], h = u * t[1];
      // wall
      ctx.fillStyle = '#efe3c8'; ctx.fillRect(px - w * 0.38, ty - h, w * 0.76, h);
      ctx.fillStyle = '#b8321a';
      for (var c = 0; c < 4; c++) ctx.fillRect(px - w * 0.38 + c * w * 0.245, ty - h, w * 0.03, h);
      // glowing window
      var wg = ctx.createRadialGradient(px, ty - h * 0.5, 0, px, ty - h * 0.5, w * 0.25);
      wg.addColorStop(0, '#ffd27a'); wg.addColorStop(1, 'rgba(255,170,70,0.0)');
      ctx.fillStyle = wg; ctx.fillRect(px - w * 0.25, ty - h, w * 0.5, h);
      ctx.fillStyle = '#ffcf6e'; ctx.fillRect(px - w * 0.06, ty - h * 0.72, w * 0.12, h * 0.5);
      // roof with up-turned eaves
      var ry = ty - h, rw = w * 0.7, rh = u * 0.05;
      ctx.fillStyle = '#1f5f5a';
      ctx.beginPath();
      ctx.moveTo(px - rw, ry - rh * 0.5);
      ctx.quadraticCurveTo(px - rw * 0.6, ry + rh * 0.15, px - rw * 0.35, ry - rh * 0.55);
      ctx.lineTo(px - rw * 0.2, ry - rh * 1.3);
      ctx.lineTo(px + rw * 0.2, ry - rh * 1.3);
      ctx.lineTo(px + rw * 0.35, ry - rh * 0.55);
      ctx.quadraticCurveTo(px + rw * 0.6, ry + rh * 0.15, px + rw, ry - rh * 0.5);
      ctx.quadraticCurveTo(px + rw * 0.7, ry - rh * 0.35, px + rw * 0.45, ry - rh * 0.6);
      ctx.lineTo(px - rw * 0.45, ry - rh * 0.6);
      ctx.quadraticCurveTo(px - rw * 0.7, ry - rh * 0.35, px - rw, ry - rh * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#e3b04e'; ctx.lineWidth = Math.max(1, u * 0.005);
      ctx.beginPath();
      ctx.moveTo(px - rw, ry - rh * 0.5); ctx.quadraticCurveTo(px - rw * 0.6, ry + rh * 0.15, px - rw * 0.35, ry - rh * 0.55);
      ctx.moveTo(px + rw, ry - rh * 0.5); ctx.quadraticCurveTo(px + rw * 0.6, ry + rh * 0.15, px + rw * 0.35, ry - rh * 0.55);
      ctx.stroke();
      // hanging lanterns at the eave tips
      [-1, 1].forEach(function (sd) {
        var lx = px + sd * rw * 0.92, ly = ry - rh * 0.3 + u * 0.022, sw = Math.sin(now / 700 + k + sd) * u * 0.004;
        ctx.strokeStyle = 'rgba(40,20,10,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx, ry - rh * 0.4); ctx.lineTo(lx + sw, ly); ctx.stroke();
        var lg = ctx.createRadialGradient(lx + sw, ly + u * 0.01, 0, lx + sw, ly + u * 0.01, u * 0.04);
        lg.addColorStop(0, 'rgba(255,170,80,0.6)'); lg.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = lg; ctx.fillRect(lx + sw - u * 0.04, ly - u * 0.03, u * 0.08, u * 0.08);
        ctx.fillStyle = '#e8492a';
        ctx.beginPath(); ctx.ellipse(lx + sw, ly + u * 0.01, u * 0.011, u * 0.015, 0, 0, 6.283); ctx.fill();
      });
      ty = ry - rh * 1.3;
    });
    // finial
    ctx.fillStyle = '#e3b04e';
    ctx.fillRect(px - u * 0.004, ty - u * 0.07, u * 0.008, u * 0.07);
    ctx.beginPath(); ctx.arc(px, ty - u * 0.075, u * 0.012, 0, 6.283); ctx.fill();
    // prayer flags on a rope from the top roof to a pole at the railing's end
    var fx0 = px + u * 0.05, fy0 = ty + u * 0.02, fx1 = x + u * 0.62, fy1 = y - u * 0.16;
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(fx1 - u * 0.004, fy1, u * 0.008, u * 0.15);
    ctx.strokeStyle = 'rgba(60,40,20,0.7)'; ctx.lineWidth = 1;
    var sag = u * 0.06;
    ctx.beginPath(); ctx.moveTo(fx0, fy0); ctx.quadraticCurveTo((fx0 + fx1) / 2, Math.max(fy0, fy1) + sag, fx1, fy1); ctx.stroke();
    var FLAGS = ['#3e7bd6', '#f2efe4', '#e0532f', '#46b06e', '#f2c14e'];
    for (var f = 1; f < 12; f++) {
      var t = f / 12, qx = (1 - t) * (1 - t) * fx0 + 2 * (1 - t) * t * (fx0 + fx1) / 2 + t * t * fx1;
      var qy = (1 - t) * (1 - t) * fy0 + 2 * (1 - t) * t * (Math.max(fy0, fy1) + sag) + t * t * fy1;
      var wv = Math.sin(now / 260 + f * 0.9) * u * 0.008;
      ctx.fillStyle = FLAGS[f % FLAGS.length];
      ctx.beginPath(); ctx.moveTo(qx - u * 0.012, qy); ctx.lineTo(qx + u * 0.012, qy); ctx.lineTo(qx + u * 0.012 + wv, qy + u * 0.03); ctx.lineTo(qx - u * 0.012 + wv, qy + u * 0.03); ctx.closePath(); ctx.fill();
    }
  }

  // ---- the dragon: a spine of points, drawn as a tapered body with fins, belly, legs and head
  var N = 30;
  function bodyR() { return S0 * 0.04; }
  function radiusAt(u) { return bodyR() * (0.68 + 0.32 * smooth(0, 0.18, u)) * (1 - 0.8 * Math.pow(u, 1.4)); }
  function coilSpine(now, A) {
    var m = monastery(A), u = S0;
    var cx = m.x + u * 0.38, cy = m.y - u * 0.075, Rc = u * 0.16;
    var br = 1 + 0.025 * Math.sin(now / 900), pts = [];
    var bob = Math.sin(now / 1100) * u * 0.008;
    pts.push({ x: cx - Rc * 0.95, y: cy - Rc * 1.0 + bob });
    var lx = cx - Rc * 1.02, ly = cy - Rc * 0.02;
    for (var i = 1; i <= 4; i++) {
      var t = i / 5;
      pts.push({ x: pts[0].x + (lx - pts[0].x) * t - Math.sin(t * Math.PI) * Rc * 0.28, y: pts[0].y + (ly - pts[0].y) * t });
    }
    for (var j = 5; j < N; j++) {
      var k = (j - 5) / (N - 6);
      var th = Math.PI - k * Math.PI * 2 * 1.12;
      var rr = Rc * (1 - k * 0.42) * br;
      var y = cy + Math.sin(th) * rr * 0.36;
      if (j > N - 5) y -= (j - (N - 5)) * u * 0.012 * (1 + 0.5 * Math.sin(now / 400));
      pts.push({ x: cx + Math.cos(th) * rr, y: y });
    }
    return pts;
  }
  function flightSpine(now) {
    var hx = W * 0.5 + S0 * 0.3, hy = H * (0.66 - 0.05 * clamp(scene.alt, 0, 1)) + Math.sin(now / 650) * S0 * 0.02;
    var ang = Math.PI - 0.42 + Math.sin(now / 1500) * 0.06; // the body trails down-left
    var bx = Math.cos(ang), by = Math.sin(ang), nx = -by, ny = bx;
    var L = S0 * 0.88 / N, ph = now / 1000 * 5.2, pts = [];
    for (var i = 0; i < N; i++) {
      var a = bodyR() * 1.3 * Math.min(1, i / 5);
      var w = Math.sin(ph - i * 0.44) * a;
      pts.push({ x: hx + bx * L * i + nx * w, y: hy + by * L * i + ny * w });
    }
    return pts;
  }
  function currentSpine(now) {
    var A = cam();
    if (S.phase === 'flying' || (S.phase === 'crashed' && scene.takeoffAt)) {
      var t = now - scene.takeoffAt;
      if (t >= TAKEOFF_MS) return flightSpine(now);
      var c = coilSpine(now, A), f = flightSpine(now), out = [];
      for (var i = 0; i < N; i++) {
        var k = easeInOut((t - i * 18) / (TAKEOFF_MS - N * 18));
        out.push({ x: c[i].x + (f[i].x - c[i].x) * k, y: c[i].y + (f[i].y - c[i].y) * k - Math.sin(k * Math.PI) * S0 * 0.12 });
      }
      return out;
    }
    return coilSpine(now, A);
  }

  function catmull(pts) { // 3 sub-points per segment, with radius
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (var s = 0; s < 3; s++) {
        var t = s / 3, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    for (var j = 0; j < out.length; j++) {
      var a = out[Math.max(0, j - 1)], b = out[Math.min(out.length - 1, j + 1)];
      var tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
      out[j].tx = tx / l; out[j].ty = ty / l;
      out[j].nx = -out[j].ty; out[j].ny = out[j].tx; // dorsal side
      out[j].r = radiusAt(j / (out.length - 1));
    }
    return out;
  }

  var BODY = '#34c79e', BODY_D = '#0d5a4e', BELLY = '#ffd98a', BELLY_D = '#d99a3e', FIN = '#ff8a63', FIN_L = '#ffc27a', HORN = '#ffe08f';

  function drawDragon(pts, now, opt) {
    opt = opt || {};
    var P = catmull(pts), M = P.length, i, p;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // legs (behind the body), paddling in flight
    [8, 9, 21, 22].forEach(function (si, n) {
      var q = P[Math.min(M - 1, si * 3)], far = n % 2 === 0;
      var sw = Math.sin(now / 240 + n * 1.7) * (opt.paddle ? 0.6 : 0.15);
      var r = q.r, ax = q.x - q.nx * r * 0.5, ay = q.y - q.ny * r * 0.5;
      var dx = -q.nx * Math.cos(sw) + q.tx * Math.sin(sw) * 0.8 + q.tx * 0.4, dy = -q.ny * Math.cos(sw) + q.ty * Math.sin(sw) * 0.8 + q.ty * 0.4;
      var kx = ax + dx * r * 1.3, ky = ay + dy * r * 1.3;
      ctx.strokeStyle = far ? '#1f8a72' : BODY; ctx.lineWidth = r * 0.62;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(kx, ky); ctx.lineTo(kx - q.tx * r * 0.7, ky - q.ty * r * 0.7); ctx.stroke();
      ctx.strokeStyle = HORN; ctx.lineWidth = Math.max(1, r * 0.14);
      for (var c = -1; c <= 1; c++) {
        var cxp = kx - q.tx * r * 0.75, cyp = ky - q.ty * r * 0.75;
        ctx.beginPath(); ctx.moveTo(cxp, cyp); ctx.lineTo(cxp - q.tx * r * 0.32 - q.nx * c * r * 0.25, cyp - q.ty * r * 0.32 - q.ny * c * r * 0.25); ctx.stroke();
      }
    });
    // tail tuft
    var tl = P[M - 1], tp = P[M - 4];
    ctx.save();
    ctx.translate(tl.x, tl.y);
    ctx.rotate(Math.atan2(tl.y - tp.y, tl.x - tp.x));
    var tr = bodyR();
    [[-0.5, 1.5], [0, 1.9], [0.5, 1.4]].forEach(function (lb, k) {
      var wv = Math.sin(now / 200 + k) * 0.2;
      var g = ctx.createLinearGradient(0, 0, tr * lb[1], 0);
      g.addColorStop(0, FIN); g.addColorStop(1, FIN_L);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, -tr * 0.25);
      ctx.quadraticCurveTo(tr * lb[1] * 0.6, tr * (lb[0] + wv) - tr * 0.4, tr * lb[1], tr * (lb[0] + wv));
      ctx.quadraticCurveTo(tr * lb[1] * 0.5, tr * (lb[0] + wv) + tr * 0.3, 0, tr * 0.25);
      ctx.fill();
    });
    ctx.restore();
    // dorsal fins (behind the body)
    for (i = 6; i < M - 4; i += 3) {
      p = P[i];
      var fh = p.r * (0.7 + 0.15 * Math.sin(now / 300 + i * 0.4));
      var bx0 = p.x + p.nx * p.r * 0.8, by0 = p.y + p.ny * p.r * 0.8;
      var fg = ctx.createLinearGradient(bx0, by0, bx0 + p.nx * fh, by0 + p.ny * fh);
      fg.addColorStop(0, FIN); fg.addColorStop(1, FIN_L);
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(bx0 - p.tx * p.r * 0.5, by0 - p.ty * p.r * 0.5);
      ctx.quadraticCurveTo(bx0 + p.nx * fh * 0.9, by0 + p.ny * fh * 0.9, bx0 + p.nx * fh + p.tx * fh * 0.8, by0 + p.ny * fh + p.ty * fh * 0.8);
      ctx.lineTo(bx0 + p.tx * p.r * 0.9, by0 + p.ty * p.r * 0.9);
      ctx.closePath(); ctx.fill();
    }
    // body: chunks drawn tail → head so nearer coils sit on top
    var CH = 6;
    for (var end = M - 1; end > 0; end -= CH) {
      var start = Math.max(0, end - CH - 1);
      ctx.beginPath();
      for (i = start; i <= end; i++) { p = P[i]; if (i === start) ctx.moveTo(p.x + p.nx * p.r, p.y + p.ny * p.r); else ctx.lineTo(p.x + p.nx * p.r, p.y + p.ny * p.r); }
      for (i = end; i >= start; i--) { p = P[i]; ctx.lineTo(p.x - p.nx * p.r, p.y - p.ny * p.r); }
      ctx.closePath();
      ctx.fillStyle = BODY; ctx.fill();
      // outline: only the two sides (no seams between chunks)
      ctx.strokeStyle = BODY_D; ctx.lineWidth = Math.max(1.2, bodyR() * 0.12);
      [1, -1].forEach(function (sd) {
        ctx.beginPath();
        for (var j = start; j <= end; j++) { var q = P[j]; if (j === start) ctx.moveTo(q.x + sd * q.nx * q.r, q.y + sd * q.ny * q.r); else ctx.lineTo(q.x + sd * q.nx * q.r, q.y + sd * q.ny * q.r); }
        ctx.stroke();
      });
      // belly band with plates (one path each per chunk)
      ctx.strokeStyle = BELLY; ctx.lineWidth = P[start].r * 0.7;
      ctx.beginPath();
      for (i = start; i <= end; i++) { p = P[i]; if (i === start) ctx.moveTo(p.x - p.nx * p.r * 0.5, p.y - p.ny * p.r * 0.5); else ctx.lineTo(p.x - p.nx * p.r * 0.5, p.y - p.ny * p.r * 0.5); }
      ctx.stroke();
      ctx.strokeStyle = BELLY_D; ctx.lineWidth = Math.max(1, bodyR() * 0.07);
      ctx.beginPath();
      for (i = start; i <= end; i++) {
        if (i % 2) continue;
        p = P[i];
        ctx.moveTo(p.x - p.nx * p.r * 0.15, p.y - p.ny * p.r * 0.15); ctx.lineTo(p.x - p.nx * p.r * 0.85, p.y - p.ny * p.r * 0.85);
      }
      ctx.stroke();
      // shine along the back + scale marks
      ctx.strokeStyle = 'rgba(190,255,232,0.45)'; ctx.lineWidth = Math.max(1, bodyR() * 0.22);
      ctx.beginPath();
      for (i = start; i <= end; i++) { p = P[i]; if (i === start) ctx.moveTo(p.x + p.nx * p.r * 0.45, p.y + p.ny * p.r * 0.45); else ctx.lineTo(p.x + p.nx * p.r * 0.45, p.y + p.ny * p.r * 0.45); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(13,90,78,0.45)'; ctx.lineWidth = Math.max(1, bodyR() * 0.07);
      ctx.beginPath();
      for (i = start + 1; i <= end; i += 2) {
        p = P[i];
        var sxp = p.x + p.nx * p.r * 0.1, syp = p.y + p.ny * p.r * 0.1, ang = Math.atan2(p.ty, p.tx);
        ctx.moveTo(sxp + Math.cos(ang - 1.2) * p.r * 0.32, syp + Math.sin(ang - 1.2) * p.r * 0.32);
        ctx.arc(sxp, syp, p.r * 0.32, ang - 1.2, ang + 1.2);
      }
      ctx.stroke();
    }
    drawHead(P[0], P[3], now, opt);
  }

  function drawHead(p0, p1, now, opt) {
    var ang = Math.atan2(p0.y - p1.y, p0.x - p1.x);
    var hs = bodyR() * 1.15;
    ctx.save();
    ctx.translate(p0.x, p0.y);
    ctx.rotate(ang);
    if (Math.cos(ang) < 0) ctx.scale(1, -1); // keep the head upright
    // mane
    for (var m = 0; m < 5; m++) {
      var wv = Math.sin(now / 220 + m) * hs * 0.12;
      var g = ctx.createLinearGradient(0, 0, -hs * 1.8, 0);
      g.addColorStop(0, FIN); g.addColorStop(1, FIN_L);
      ctx.fillStyle = g;
      var oy = -hs * 0.7 + m * hs * 0.32;
      ctx.beginPath();
      ctx.moveTo(-hs * 0.2, oy);
      ctx.quadraticCurveTo(-hs * 0.9, oy - hs * 0.5 + wv, -hs * (1.5 + (m % 2) * 0.3), oy - hs * 0.15 + wv);
      ctx.quadraticCurveTo(-hs * 0.9, oy + hs * 0.25, -hs * 0.2, oy + hs * 0.3);
      ctx.fill();
    }
    // horns
    ctx.lineCap = 'round';
    [[0.5, '#d1a24a'], [1, HORN]].forEach(function (h, k) {
      ctx.strokeStyle = h[1]; ctx.lineWidth = hs * 0.2;
      var ox = k ? 0 : hs * 0.22;
      ctx.beginPath(); ctx.moveTo(-hs * 0.15 + ox, -hs * 0.7); ctx.quadraticCurveTo(-hs * 0.7 + ox, -hs * 1.5, -hs * 1.35 + ox, -hs * 1.55); ctx.stroke();
      ctx.lineWidth = hs * 0.13;
      ctx.beginPath(); ctx.moveTo(-hs * 0.6 + ox, -hs * 1.25); ctx.lineTo(-hs * 0.55 + ox, -hs * 1.7); ctx.stroke();
    });
    // head + snout
    ctx.fillStyle = BODY; ctx.strokeStyle = BODY_D; ctx.lineWidth = Math.max(1.2, hs * 0.08);
    ctx.beginPath(); ctx.ellipse(hs * 1.0, hs * 0.18, hs * 0.82, hs * 0.56, 0.05, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, hs * 1.0, hs * 0.86, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(hs * 0.95, hs * 0.18, hs * 0.74, hs * 0.48, 0.05, 0, 6.283); ctx.fill();
    // jaw (belly colour)
    ctx.fillStyle = BELLY;
    ctx.beginPath(); ctx.ellipse(hs * 0.85, hs * 0.5, hs * 0.72, hs * 0.22, 0.05, 0, 6.283); ctx.fill();
    // shine
    ctx.fillStyle = 'rgba(200,255,236,0.5)';
    ctx.beginPath(); ctx.ellipse(-hs * 0.1, -hs * 0.5, hs * 0.45, hs * 0.16, -0.2, 0, 6.283); ctx.fill();
    // nostril, smile, fang, blush
    ctx.fillStyle = BODY_D;
    ctx.beginPath(); ctx.ellipse(hs * 1.62, -hs * 0.02, hs * 0.08, hs * 0.05, 0.4, 0, 6.283); ctx.fill();
    ctx.strokeStyle = BODY_D; ctx.lineWidth = Math.max(1.2, hs * 0.08);
    ctx.beginPath(); ctx.moveTo(hs * 0.62, hs * 0.36); ctx.quadraticCurveTo(hs * 1.1, hs * 0.62, hs * 1.6, hs * 0.3); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(hs * 1.28, hs * 0.47); ctx.lineTo(hs * 1.38, hs * 0.66); ctx.lineTo(hs * 1.44, hs * 0.43); ctx.fill();
    ctx.fillStyle = 'rgba(255,120,140,0.5)';
    ctx.beginPath(); ctx.ellipse(hs * 0.25, hs * 0.38, hs * 0.2, hs * 0.11, 0, 0, 6.283); ctx.fill();
    // eye
    var ex = hs * 0.3, ey = -hs * 0.22;
    if (opt.dizzy) {
      ctx.strokeStyle = BODY_D; ctx.lineWidth = Math.max(1.4, hs * 0.08);
      ctx.beginPath();
      for (var a = 0; a < 14; a++) { var rr = hs * 0.03 * a, aa = a * 0.9 + now / 90; if (!a) ctx.moveTo(ex, ey); else ctx.lineTo(ex + Math.cos(aa) * rr, ey + Math.sin(aa) * rr); }
      ctx.stroke();
    } else {
      var blink = (now % 4200) < 140 ? 0.12 : 1;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(ex, ey, hs * 0.34, hs * 0.38 * blink, 0, 0, 6.283); ctx.fill();
      if (blink === 1) {
        ctx.fillStyle = '#0f4a52';
        ctx.beginPath(); ctx.arc(ex + hs * 0.09, ey + hs * 0.02, hs * 0.23, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#061c20';
        ctx.beginPath(); ctx.arc(ex + hs * 0.12, ey + hs * 0.03, hs * 0.13, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex + hs * 0.02, ey - hs * 0.09, hs * 0.07, 0, 6.283); ctx.fill();
      }
      ctx.strokeStyle = HORN; ctx.lineWidth = Math.max(1.2, hs * 0.08);
      ctx.beginPath(); ctx.moveTo(ex - hs * 0.28, ey - hs * 0.42); ctx.quadraticCurveTo(ex, ey - hs * 0.58, ex + hs * 0.3, ey - hs * 0.44); ctx.stroke();
    }
    // whiskers
    ctx.strokeStyle = HORN; ctx.lineWidth = Math.max(1, hs * 0.07);
    [0, 1].forEach(function (k) {
      ctx.beginPath();
      for (var s = 0; s <= 12; s++) {
        var x = hs * 1.45 - s * hs * 0.3, y = hs * (0.12 + k * 0.18) + s * hs * (0.06 + k * 0.04) + Math.sin(now / 260 + s * 0.6 + k) * hs * 0.018 * s;
        if (!s) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  // ---- particles
  function burst(now) { // take-off: a gust of petals and sparkles from the terrace
    var c = coilSpine(now, cam());
    for (var i = 0; i < 42; i++) {
      var p = c[Math.floor(Math.random() * N)];
      particles.push({ k: i % 3 ? 'petal' : 'spark', x: p.x, y: p.y, vx: (Math.random() - 0.3) * S0 * 0.9, vy: -Math.random() * S0 * 0.9, life: 1100, age: 0, r: S0 * (0.006 + Math.random() * 0.008), t: Math.random() * 6 });
    }
  }
  function emit(pts, dt, flying) {
    if (!flying) return;
    var n = Math.random() < dt / 30 ? 2 : 1;
    for (var i = 0; i < n; i++) {
      var p = pts[3 + Math.floor(Math.random() * (N - 4))];
      particles.push({ k: 'spark', x: p.x + (Math.random() - 0.5) * bodyR(), y: p.y + (Math.random() - 0.5) * bodyR(), vx: -S0 * (0.25 + Math.random() * 0.3), vy: S0 * (0.12 + Math.random() * 0.15), life: 900, age: 0, r: S0 * (0.004 + Math.random() * 0.006), t: Math.random() * 6 });
    }
    if (Math.random() < dt / 50) { // wind streaks
      particles.push({ k: 'streak', x: W + Math.random() * W * 0.3 - W * 0.2, y: -TOP + Math.random() * (H + TOP) * 0.8, vx: -S0 * 2.2, vy: S0 * 1.0, life: 700, age: 0, r: S0 * (0.08 + Math.random() * 0.1) });
    }
  }
  function drawParticles(dt) {
    var keep = [];
    ctx.save();
    particles.forEach(function (p) {
      p.age += dt;
      if (p.age > p.life) return;
      keep.push(p);
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000;
      var a = 1 - p.age / p.life;
      if (p.k === 'petal') {
        p.vy += S0 * 0.6 * dt / 1000;
        ctx.globalAlpha = a; ctx.fillStyle = '#ffb3c4';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 1.4, p.r * 0.7, p.t + p.age / 200, 0, 6.283); ctx.fill();
      } else if (p.k === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a; ctx.fillStyle = p.t > 3 ? '#ffe08f' : '#9ff7da';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + a * 0.6), 0, 6.283); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else if (p.k === 'streak') {
        ctx.globalAlpha = 0.35 * Math.sin(Math.PI * (1 - a));
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.r * 0.9, p.y - p.r * 0.42); ctx.stroke();
      } else if (p.k === 'smoke') {
        ctx.globalAlpha = a * 0.5; ctx.fillStyle = '#5a6470';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - a), 0, 6.283); ctx.fill();
      }
    });
    ctx.restore();
    particles = keep.length > 400 ? keep.slice(-400) : keep;
  }

  // ---- crash: the storm
  function makeBolt(x0, y0, x1, y1) {
    var pts = [{ x: x0, y: y0 }], n = 10;
    for (var i = 1; i < n; i++) {
      var t = i / n;
      pts.push({ x: x0 + (x1 - x0) * t + (Math.random() - 0.5) * S0 * 0.12, y: y0 + (y1 - y0) * t + (Math.random() - 0.5) * S0 * 0.03 });
    }
    pts.push({ x: x1, y: y1 });
    var branch = pts.slice(3, 4).concat([{ x: pts[3].x + S0 * 0.12, y: pts[3].y + S0 * 0.1 }, { x: pts[3].x + S0 * 0.18, y: pts[3].y + S0 * 0.22 }]);
    return [pts, branch];
  }
  function drawStorm(now) {
    if (!scene.crashAt) return;
    var t = now - scene.crashAt;
    var a = ease(t / 260);
    // storm clouds roll over the top
    for (var i = 0; i < 9; i++) {
      var x = -LEFT + (FULL_W) * (i / 8), y = -TOP + H * 0.05 + Math.sin(i * 1.7) * H * 0.05 + (1 - a) * -H * 0.3;
      var r = S0 * (0.16 + 0.05 * Math.sin(i * 2.3));
      ctx.fillStyle = 'rgba(34,38,58,' + (0.92 * a) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(70,76,104,' + (0.8 * a) + ')';
      ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.7, 0, 6.283); ctx.fill();
    }
    // rain
    ctx.strokeStyle = 'rgba(190,210,240,' + (0.35 * a) + ')'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var k = 0; k < 70; k++) {
      var rx = ((k * 97.3 + now * 0.5) % (FULL_W + 60)) - LEFT - 30, ry = ((k * 53.1 + now * 1.1) % (FULL_H)) - TOP;
      ctx.moveTo(rx, ry); ctx.lineTo(rx - S0 * 0.02, ry + S0 * 0.06);
    }
    ctx.stroke();
    // lightning (the strike, then two flickers)
    var on = t < STRIKE_MS || (t > 330 && t < 390) || (t > 520 && t < 560);
    if (on && scene.crashFrom) {
      if (!scene.bolt || now - scene.boltAt > 60) {
        var h0 = scene.crashFrom[0];
        scene.bolt = makeBolt(h0.x + S0 * 0.15, -TOP + H * 0.05, h0.x, h0.y);
        scene.boltAt = now;
      }
      ctx.save();
      ctx.shadowColor = '#bfe6ff'; ctx.shadowBlur = 18;
      scene.bolt.forEach(function (b, n) {
        ctx.strokeStyle = n ? 'rgba(220,240,255,0.7)' : '#ffffff';
        ctx.lineWidth = n ? 1.5 : Math.max(2.5, S0 * 0.009);
        ctx.beginPath();
        b.forEach(function (p, j) { if (!j) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
      });
      ctx.restore();
    }
    // flash
    var fl = Math.max(0, 1 - t / 320) * 0.55 + (t > 330 && t < 420 ? 0.2 : 0);
    if (fl > 0) { ctx.fillStyle = 'rgba(230,240,255,' + fl + ')'; ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H); }
  }
  function drawTumble(now, dt) {
    var r = scene.crashFrom, t = now - scene.crashAt;
    if (!r || t > STRIKE_MS + TUMBLE_MS) return;
    var cx = 0, cy = 0;
    r.forEach(function (p) { cx += p.x; cy += p.y; });
    cx /= r.length; cy /= r.length;
    var k = clamp((t - STRIKE_MS) / TUMBLE_MS, 0, 1);
    var rot = k * 3 + k * k * 3 + Math.sin(t / 40) * (t < STRIKE_MS ? 0.04 : 0);
    var fall = k * k * (H * 1.3 + TOP), drift = -k * W * 0.12;
    var sc = 1 - 0.25 * k;
    var pts = r.map(function (p) {
      var dx = (p.x - cx) * sc, dy = (p.y - cy) * sc;
      return { x: cx + drift + dx * Math.cos(rot) - dy * Math.sin(rot), y: cy + fall + dx * Math.sin(rot) + dy * Math.cos(rot) };
    });
    drawDragon(pts, now, { dizzy: true });
    if (t < STRIKE_MS) { // charged glow
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(pts[0].x, pts[0].y, 0, pts[0].x, pts[0].y, S0 * 0.25);
      g.addColorStop(0, 'rgba(200,235,255,0.7)'); g.addColorStop(1, 'rgba(200,235,255,0)');
      ctx.fillStyle = g; ctx.fillRect(pts[0].x - S0 * 0.25, pts[0].y - S0 * 0.25, S0 * 0.5, S0 * 0.5);
      ctx.restore();
    } else if (Math.random() < dt / 40) {
      particles.push({ k: 'smoke', x: pts[N >> 1].x, y: pts[N >> 1].y, vx: (Math.random() - 0.5) * S0 * 0.2, vy: -S0 * 0.15, life: 800, age: 0, r: S0 * 0.03 });
    }
    // dizzy stars around the head
    ctx.fillStyle = '#ffe08f';
    for (var s = 0; s < 3; s++) {
      var aa = now / 160 + s * 2.09;
      star(pts[0].x + Math.cos(aa) * S0 * 0.07, pts[0].y - S0 * 0.05 + Math.sin(aa) * S0 * 0.025, S0 * 0.014);
    }
  }
  function star(x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }

  // ---- betting: the incense countdown + the round's phrase
  function drawBetting(now) {
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var left = S.phase === 'betting' ? clamp((S.bettingEndsAt - Date.now()) / total, 0, 1) : 0;
    var cx = W * 0.5, cy = H * 0.2 + Math.max(0, S0 * 0.07 - H * 0.05), bw = Math.min(W * 0.62, S0 * 0.8), bh = Math.max(12, S0 * 0.036);
    ctx.save();
    ctx.font = '900 ' + Math.round(clamp(S0 * 0.06, 15, 30)) + 'px "Avenir Next", "Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(7,40,44,0.7)'; ctx.fillStyle = '#fff';
    var label = S.phase === 'betting' ? S.bettingPhrase.toUpperCase() : '';
    if (label) { ctx.strokeText(label, cx, cy - bh * 1.1); ctx.fillText(label, cx, cy - bh * 1.1); }
    // bar: a stick of incense burning down (time left to bet)
    var bx = cx - bw / 2, by = cy - bh / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10;
    rr(bx, by, bw, bh, bh / 2); ctx.fillStyle = 'rgba(7,21,24,0.6)'; ctx.fill();
    ctx.shadowBlur = 0;
    if (left > 0) {
      var fw = Math.max(bh, bw * left);
      var g = ctx.createLinearGradient(0, by, 0, by + bh);
      g.addColorStop(0, '#9ff7da'); g.addColorStop(1, '#1c9a80');
      rr(bx + 3, by + 3, fw - 6, bh - 6, (bh - 6) / 2); ctx.fillStyle = g; ctx.fill();
      // the glowing ember at the burning end + a curl of smoke
      var ex = bx + fw - bh / 2, ey = cy;
      var eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, bh * 1.6);
      eg.addColorStop(0, 'rgba(255,210,120,0.95)'); eg.addColorStop(0.4, 'rgba(255,120,60,0.6)'); eg.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = eg; ctx.fillRect(ex - bh * 1.6, ey - bh * 1.6, bh * 3.2, bh * 3.2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var s = 0; s < 16; s++) { var y = ey - bh * 0.6 - s * bh * 0.25, x = ex + Math.sin(now / 400 + s * 0.5) * bh * 0.25 * (s / 6); if (!s) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    rr(bx, by, bw, bh, bh / 2); ctx.strokeStyle = '#e3b04e'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPetals(now, dt) { // drifting blossom while the dragon rests
    if (S.phase !== 'betting' && S.phase !== 'waiting') return;
    ctx.fillStyle = 'rgba(255,190,205,0.8)';
    petals.forEach(function (p) {
      p.x -= p.v * 0.03 * dt / 1000; p.y += p.v * 0.05 * dt / 1000;
      if (p.y > 1) { p.y = 0; p.x = Math.random() * 1.2; }
      var x = ((p.x % 1.2) + 1.2) % 1.2 * FULL_W - LEFT, y = p.y * (H + TOP) - TOP;
      ctx.beginPath(); ctx.ellipse(x + Math.sin(now / 700 + p.t) * 10, y, S0 * 0.008 * p.s, S0 * 0.004 * p.s, now / 500 + p.t, 0, 6.283); ctx.fill();
    });
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0;

  function frame(now) {
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    // the mist wipe back to the monastery (next round)
    var mist = 0;
    if (scene.mistAt) {
      var mt = (now - scene.mistAt) / MIST_MS;
      if (mt >= 0.5 && scene.crashAt) { scene.alt = 0; scene.x = 0; scene.crashAt = 0; scene.crashFrom = null; scene.takeoffAt = 0; scene.bolt = null; }
      if (mt >= 1) scene.mistAt = 0; else mist = Math.sin(Math.PI * mt);
    }
    if (S.phase === 'betting' || S.phase === 'waiting') { if (!scene.mistAt) { scene.crashAt = 0; scene.crashFrom = null; scene.takeoffAt = 0; } }
    if (!scene.mistAt || mist === 0) scene.alt += (climb() - scene.alt) * Math.min(1, dt / 300);
    if (S.phase === 'flying') {
      if (!scene.takeoffAt) scene.takeoffAt = now - TAKEOFF_MS; // joined mid-flight
      scene.x += S0 * 0.35 * (1 + scene.alt) * dt / 1000;
      windTune(scene.alt);
    }
    var sk = sky(scene.alt);
    if (now - themeAt > 400) { themeAt = now; game.theme(hex(sk.top)); }
    if (W && H) {
      var A = cam();
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      drawSky(sk, now);
      drawRidges(sk, A);
      drawClouds(sk, false);
      drawCranes(now, dt);
      drawCloudSea(sk, now);
      drawLanterns(now);
      drawMonastery(A, now);
      drawPetals(now, dt);
      if (S.phase === 'flying') {
        var pts = currentSpine(now);
        emit(pts, dt, now - scene.takeoffAt > TAKEOFF_MS * 0.6);
        drawParticles(dt);
        drawDragon(pts, now, { paddle: true });
      } else if (S.phase === 'crashed') {
        drawParticles(dt);
        if (scene.crashAt) { drawTumble(now, dt); drawStorm(now); }
      } else {
        drawParticles(dt);
        drawDragon(coilSpine(now, A), now, {});
        drawBetting(now);
      }
      drawClouds(sk, true);
      if (mist > 0) {
        ctx.fillStyle = rgb(mixC(sk.bottom, [255, 255, 255], 0.5), mist * 0.95);
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      }
      ctx.restore();
    }
    // texts over the scene
    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden) setText(flew, S.crashPhrase);
    if (S.phase === 'flying') {
      if (mult.className !== 'mult') mult.className = 'mult';
      setText(mult, game.currentMult().toFixed(2) + 'x'); setText(hint, '');
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      if (mult.className !== 'mult mult--crashed') mult.className = 'mult mult--crashed';
      setText(mult, S.crashPoint.toFixed(2) + 'x'); setText(hint, '');
    } else if (S.phase === 'betting') {
      setText(mult, ''); setText(hint, '');
    } else {
      setText(mult, ''); setText(hint, S.gotSnapshot ? 'Waiting for the next round…' : 'Connecting…');
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
  function buildQuick(p) { // 1×, 2×, 5×, 10× the min bet (within the max) — built once
    var l = game.limit();
    p.quick.innerHTML = '';
    p.quickBtns = [];
    [1, 2, 5, 10].forEach(function (k) {
      var v = game.round2(l.min * k);
      if (l.max && v > l.max) return;
      var b = document.createElement('button');
      b.type = 'button';
      var coin = document.createElement('i'); // a cash coin threaded on the cord
      coin.className = 'coin';
      coin.setAttribute('aria-hidden', 'true');
      b.appendChild(coin);
      b.appendChild(cell(game.money(v).replace(/\.00$/, ''), 'coin__value'));
      b.onclick = function () { sfxClick(); setAmount(p, v); };
      p.quick.appendChild(b);
      p.quickBtns.push({ el: b, value: v });
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
      sfxBet();
      game.bet(p.slot, readAmount(p), readAuto(p));
    };
  });

  $('back').onclick = function () { sfxClick(); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); sfxClick(); };
  $('music').onclick = function () { setMusic(!musicOn); sfxClick(); };
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
      setCols();
      renderList();
    };
  });

  setSound(soundOn);
  setMusic(musicOn);
  window.addEventListener('resize', fit);
  // The results row fills in after load (and the bets list / bar can change size): refit.
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
