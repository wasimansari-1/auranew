/* Firework Fever — NEXORNG original crash game (88.0052). Game logic: ../_core/crash-client.js;
 * this file is the look and sound, all made in code: a riverside festival city at night, a
 * firework rocket on its launch crate with a burning fuse while bets are open, the launch, the
 * climb through bursting shells, festival smoke, aurora and a nebula sky as the multiplier
 * rises — and at the crash the rocket sputters, fizzles with a weak pop and tumbles away.
 * Sound effects and music are generated with WebAudio; no pictures or recordings are used. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0052', onChange: render, onSignal: onSignal });
  var S = game.S;

  // Animation lengths; the matching sounds use the same numbers.
  var LAUNCH_MS = 1100; // pad → flight height (launch roar)
  var POP_MS = 360; // sputter before the weak pop at the crash
  var FIZZLE_MS = 1300; // pop + tumble out of the sky (falling whistle)

  var announced = false, drawnOnce = false;
  function maybeReady() {
    if (announced || !drawnOnce || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 10000); // never hang the loader

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function hashName(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h;
  }

  // ================================================================ sound (WebAudio, generated)
  function readPref(k) { try { return localStorage.getItem(k) !== 'off'; } catch (e) { return true; } }
  function savePref(k, on) { try { localStorage.setItem(k, on ? 'on' : 'off'); } catch (e) { /* ignore */ } }
  var soundOn = readPref('fireworkfever-sound');
  var musicOn = readPref('fireworkfever-music');

  var AC = window.AudioContext || window.webkitAudioContext;
  var ax = null, sfx = null, mus = null, noiseBuf = null;
  function audio() {
    if (!AC) return null;
    if (!ax) {
      try { ax = new AC(); } catch (e) { AC = null; return null; }
      var comp = ax.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      comp.connect(ax.destination);
      sfx = ax.createGain(); sfx.gain.value = soundOn ? 0.9 : 0; sfx.connect(comp);
      mus = ax.createGain(); mus.gain.value = musicOn ? 0.26 : 0; mus.connect(comp);
      var len = ax.sampleRate * 2;
      noiseBuf = ax.createBuffer(1, len, ax.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ax.state === 'suspended' && !document.hidden) {
      var p = ax.resume();
      if (p && p.catch) p.catch(function () {});
    }
    return ax;
  }
  // Where the browser blocked autoplay, the first tap in the game starts the sound.
  window.addEventListener('pointerdown', function () { audio(); }, true);
  document.addEventListener('visibilitychange', function () {
    if (!ax) return;
    if (document.hidden) { var p = ax.suspend(); if (p && p.catch) p.catch(function () {}); } else audio();
  });

  function tone(type, f0, f1, t, dur, vol, dest, attack) {
    var o = ax.createOscillator(), g = ax.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfx);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function hiss(t, dur, vol, ftype, f0, f1, q, dest, attack) {
    var s = ax.createBufferSource(), f = ax.createBiquadFilter(), g = ax.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = ftype; f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q || 1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  function panTo(x) { // -1 … 1
    if (!ax.createStereoPanner) return sfx;
    var p = ax.createStereoPanner();
    p.pan.value = clamp(x, -1, 1);
    p.connect(sfx);
    return p;
  }
  function sfxReady() { var a = audio(); return a && soundOn && a.state === 'running' ? a : null; }

  var SND = {
    click: function () {
      var a = sfxReady(); if (!a) return;
      tone('triangle', 1600, 900, a.currentTime, 0.06, 0.16);
    },
    launch: function () { // LAUNCH_MS: thump, rising roar and whistle
      var a = sfxReady(); if (!a) return;
      var t = a.currentTime, d = LAUNCH_MS / 1000;
      tone('sine', 150, 42, t, 0.4, 0.75);
      hiss(t, d, 0.5, 'bandpass', 420, 3200, 1.1, sfx, 0.09);
      tone('sine', 520, 2300, t + 0.05, d, 0.05, sfx, 0.2);
    },
    burst: function (size, pan) { // boom + crackle tail
      var a = sfxReady(); if (!a) return;
      var t = a.currentTime + 0.02, out = panTo(pan || 0), v = clamp(size, 0.15, 1.8);
      tone('sine', 115, 38, t, 0.45, 0.5 * v, out);
      hiss(t, 0.45 + 0.3 * v, 0.32 * v, 'lowpass', 2600, 280, 0.7, out);
      var n = Math.round(5 + 9 * v);
      for (var i = 0; i < n; i++) {
        hiss(t + 0.22 + Math.random() * (0.5 + 0.6 * v), 0.025, (0.04 + Math.random() * 0.1) * v, 'highpass', 2800 + Math.random() * 3800, 0, 0.7, out, 0.001);
      }
    },
    big: function () { // milestone finale
      var a = sfxReady(); if (!a) return;
      tone('sine', 80, 28, a.currentTime, 0.9, 0.55);
      SND.burst(1.6, -0.4);
      setTimeout(function () { SND.burst(1.3, 0.45); }, 140);
    },
    cash: function () { // bright chime + sparkle (~0.9 s, the gold burst's flash)
      var a = sfxReady(); if (!a) return;
      var t = a.currentTime;
      [1046.5, 1318.5, 1568, 2093].forEach(function (f, i) { tone('triangle', f, 0, t + i * 0.07, 0.55, 0.2); });
      hiss(t + 0.05, 0.8, 0.09, 'highpass', 6500, 0, 0.7, sfx, 0.02);
    },
    fizzle: function () { // POP_MS sputter → weak pop → falling whistle to FIZZLE_MS
      var a = sfxReady(); if (!a) return;
      var t = a.currentTime, tp = t + POP_MS / 1000;
      for (var i = 0; i < 7; i++) hiss(t + Math.random() * (POP_MS / 1000 - 0.04), 0.045, 0.22, 'bandpass', 1500 + Math.random() * 1200, 0, 2, sfx, 0.002);
      tone('sine', 260, 70, tp, 0.25, 0.42);
      hiss(tp, 0.32, 0.3, 'lowpass', 1500, 380, 0.7);
      tone('sine', 1500, 240, tp + 0.04, (FIZZLE_MS - POP_MS) / 1000, 0.055, sfx, 0.05);
    },
  };

  // Loops: the fuse sizzle while bets are open, the rocket's roar while it climbs.
  var loops = {};
  function loopStart(name) {
    var a = sfxReady();
    if (!a || loops[name]) return;
    var t = a.currentTime, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), nodes = [s];
    s.buffer = noiseBuf; s.loop = true;
    f.type = 'bandpass';
    f.frequency.value = name === 'fuse' ? 4800 : 1900;
    f.Q.value = name === 'fuse' ? 0.9 : 0.6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(name === 'fuse' ? 0.03 : 0.07, t + 0.25);
    s.connect(f); f.connect(g); g.connect(sfx); s.start(t);
    var loop = { g: g, nodes: nodes };
    if (name === 'roar') { // a soft whistle on top, its pitch follows the climb
      var o = a.createOscillator(), og = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
      o.type = 'sine'; o.frequency.value = 820;
      lfo.frequency.value = 6; lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency);
      og.gain.value = 0.014;
      o.connect(og); og.connect(g);
      o.start(t); lfo.start(t);
      nodes.push(o, lfo);
      loop.osc = o;
    }
    loops[name] = loop;
  }
  function loopStop(name) {
    var l = loops[name];
    if (!l) return;
    delete loops[name];
    var t = ax.currentTime;
    l.g.gain.cancelScheduledValues(t);
    l.g.gain.setValueAtTime(Math.max(0.0001, l.g.gain.value), t);
    l.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    l.nodes.forEach(function (n) { try { n.stop(t + 0.2); } catch (e) { /* stopped */ } });
  }
  function crackle() { // a fuse spit
    var a = sfxReady(); if (!a) return;
    hiss(a.currentTime, 0.02, 0.06 + Math.random() * 0.06, 'highpass', 3500 + Math.random() * 3000, 0, 0.8, sfx, 0.001);
  }

  // Music: a festive pentatonic loop (pad, pluck arpeggio, soft bass and percussion) — generated.
  var BPM = 108, STEP = 60 / BPM / 2;
  var CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  var PENTA = [69, 72, 74, 76, 79, 81, 84];
  var ARP = [0, 1, 2, 1, 2, 0, 1, 2];
  var mstep = 0, mnext = 0, mtimer = 0;
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function musicStep(i, t) {
    var chord = CHORDS[Math.floor(i / 8) % 4], pos = i % 8, bar = Math.floor(i / 8);
    if (pos === 0) chord.forEach(function (n) { // pad
      [-6, 6].forEach(function (det) {
        var o = ax.createOscillator(), f = ax.createBiquadFilter(), g = ax.createGain(), len = STEP * 8;
        o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
        f.type = 'lowpass'; f.frequency.value = 750;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.022, t + 0.35);
        g.gain.setValueAtTime(0.022, t + len - 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.2);
        o.connect(f); f.connect(g); g.connect(mus);
        o.start(t); o.stop(t + len + 0.3);
      });
    });
    if (pos === 0 || pos === 4) {
      tone('sine', midi(chord[0] - 12), 0, t, STEP * 3.2, 0.24, mus, 0.01);
      tone('sine', 120, 48, t, 0.18, 0.2, mus);
    }
    var note = chord[ARP[pos]] + 12;
    if (bar % 2 === 1 && pos >= 5) note = PENTA[(bar * 3 + pos * 5) % PENTA.length];
    tone('triangle', midi(note), 0, t, STEP * 1.7, 0.075, mus, 0.004);
    if (pos % 2 === 1) hiss(t, 0.05, 0.028, 'highpass', 7200, 0, 0.7, mus, 0.002);
    if (pos === 2 || pos === 6) hiss(t, 0.13, 0.05, 'bandpass', 1600, 0, 1.1, mus, 0.003);
    if (pos === 7 && bar % 4 === 3) tone('sine', midi(PENTA[bar % PENTA.length] + 12), 0, t, 0.7, 0.03, mus, 0.01);
  }
  function musicTick() {
    if (!ax || ax.state !== 'running' || !musicOn) return;
    if (mnext < ax.currentTime) mnext = ax.currentTime + 0.05;
    while (mnext < ax.currentTime + 0.35) {
      musicStep(mstep, mnext);
      mnext += STEP;
      mstep = (mstep + 1) % 64;
    }
  }
  function syncMusic() {
    var a = audio();
    if (a) {
      mus.gain.cancelScheduledValues(a.currentTime);
      mus.gain.setTargetAtTime(musicOn ? 0.26 : 0, a.currentTime, 0.08);
    }
    clearInterval(mtimer);
    if (musicOn) mtimer = setInterval(musicTick, 120);
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  function setSound(on) {
    soundOn = on;
    savePref('fireworkfever-sound', on);
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    var a = audio();
    if (a) { sfx.gain.cancelScheduledValues(a.currentTime); sfx.gain.setTargetAtTime(on ? 0.9 : 0, a.currentTime, 0.05); }
    if (!on) { loopStop('roar'); loopStop('fuse'); } else syncLoops();
  }
  function syncLoops() {
    if (S.phase === 'flying' && scene.launchAt && performance.now() - scene.launchAt > LAUNCH_MS * 0.8) loopStart('roar');
    else loopStop('roar');
    if (S.phase === 'betting') loopStart('fuse'); else loopStop('fuse');
  }

  // ================================================================ engine moments
  var scene = { launchAt: 0, crashAt: 0, crashFrom: null, popped: false, cam: 0, alt: 0, lastT: 0, nextBurst: 0, nextBg: 0, ms: 0, light: 0, lightC: [255, 200, 120] };
  var MILESTONES = [2, 3, 5, 10, 20, 50, 100, 250, 500, 1000];
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'betting') { scene.launchAt = 0; scene.crashAt = 0; scene.crashFrom = null; scene.ms = 0; syncLoops(); }
    if (name === 'start') {
      scene.launchAt = now; scene.crashAt = 0; scene.ms = 0; scene.nextBurst = now + LAUNCH_MS + 300;
      loopStop('fuse');
      SND.launch();
      launchFx();
      setTimeout(syncLoops, LAUNCH_MS * 0.8);
    }
    if (name === 'crash') {
      scene.crashAt = now; scene.popped = false;
      var pad = padSpot(); // a round that ends at once fizzles on the crate
      scene.crashFrom = scene.launchAt ? rocketFlight(now) : { x: pad.x, y: pad.y, ang: 0, L: rocketLen(), k: 0 };
      loopStop('roar');
      SND.fizzle();
    }
    if (name === 'win') { SND.cash(); toast(d.text, 'win'); cashFx(); }
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

  // ================================================================ avatars (drawn in SVG)
  var AV_HUES = [330, 45, 190, 275, 125, 12, 210, 160, 300, 60];
  var AV_SHAPES = [
    '<svg viewBox="-12 -12 24 24" aria-hidden="true"><g stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M0-4V-10M0 4V10M-4 0H-10M4 0H10M2.8-2.8 7-7M-2.8 2.8-7 7M2.8 2.8 7 7M-2.8-2.8-7-7"/></g><circle r="2.6" fill="#fff"/></svg>',
    '<svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0-10 2.9-3.1 10.5-3.1 4.4 1.4 6.6 8.7 0 4.3-6.6 8.7-4.4 1.4-10.5-3.1-2.9-3.1Z" fill="#fff"/></svg>',
    '<svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0-11C1 -3 3 -1 11 0 3 1 1 3 0 11-1 3-3 1-11 0-3-1-1-3 0-11Z" fill="#fff"/></svg>',
  ];
  function avatar(name) {
    var h = hashName(name), hue = AV_HUES[h % AV_HUES.length];
    var el = document.createElement('i');
    el.className = 'avatar';
    el.style.background = 'radial-gradient(circle at 50% 35%, hsl(' + hue + ',95%,68%) 0%, hsl(' + hue + ',80%,42%) 58%, hsl(' + ((hue + 40) % 360) + ',70%,20%) 100%)';
    el.innerHTML = AV_SHAPES[(h >>> 4) % AV_SHAPES.length];
    return el;
  }

  // ================================================================ DOM render
  var tab = 'all';
  var playersStrip; // players in this round, on the scene (../_core/players.js) — phones only
  var historyKey = '', listKey = '';

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: avatar });
    playersStrip.update(S);
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot;
    $('balance').textContent = S.balance == null ? '—' : game.money(S.balance);
    $('mode').textContent = S.demo ? 'Demo balance' : 'Balance';

    var hk = S.history.join();
    if (hk !== historyKey) {
      historyKey = hk;
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

  // ---- bet panels (slot 0 and 1): built once; only texts / classes change ----
  var ICON = '<svg class="action__icon" viewBox="-12 -12 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M0-4.5V-10.5M0 4.5V10.5M-4.5 0H-10.5M4.5 0H10.5M3.2-3.2 7.4-7.4M-3.2 3.2-7.4 7.4M3.2 3.2 7.4 7.4M-3.2-3.2-7.4-7.4"/></g><circle r="2.4" fill="currentColor"/></svg>';
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="panel__inner">' +
      '<div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<input class="amount" inputmode="decimal" value="0.10" aria-label="Bet amount">' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<button type="button" class="action">' + ICON + '<span class="action__label">Bet</span><small class="action__sub"></small></button>' +
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
    var rows = tab === 'all' ? S.bets : S.myBets;
    var key = tab + '|' + rows.length + '|' + rows.map(function (b) { return (b.player || b.at) + ':' + b.amount + ':' + b.x; }).join();
    if (key === listKey) return;
    listKey = key;
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
        user.appendChild(avatar(b.player));
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

  // ================================================================ scene (canvas 2D)
  var canvas = $('scene');
  var stageEl = document.querySelector('.stage');
  var ctx = canvas.getContext('2d');
  // The scene fills the whole stage (under the floating bar, behind the bets list on wide
  // screens); the rocket, pad and texts sit in the play area (LEFT/TOP, W×H) and the world is
  // drawn from -LEFT/-TOP so it fills everything.
  var W = 0, H = 0, TOP = 0, LEFT = 0, FULL_W = 0, FULL_H = 0, DPR = 1, M = 1;
  var GROUND = 0; // the riverbank's top edge (play-area y)
  var layers = null, layerKey = '';

  function fit() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
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
    // The results row (and on wide screens the bet panels) float over the scene's lower part:
    // the play area ends just above the results row.
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(120, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // The multiplier / round texts are centred on the play area (not the whole scene).
    var centre = document.querySelector('.stage__center').style;
    centre.left = LEFT + 'px'; centre.top = TOP + 'px'; centre.width = W + 'px'; centre.height = H + 'px';
    var cw = Math.round(FULL_W * DPR), ch = Math.round(FULL_H * DPR);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    M = Math.min(W, H * 1.3);
    GROUND = H * 0.93;
    var key = [FULL_W, FULL_H, LEFT, TOP, H, DPR].join();
    if (key !== layerKey) { layerKey = key; buildLayers(); }
  }

  // ---- sprites made once: glow dots per colour, a soft smoke puff ----
  var PAL = {
    gold: [255, 206, 92], pink: [255, 84, 178], cyan: [86, 228, 255], lime: [160, 255, 120], violet: [176, 128, 255],
    red: [255, 92, 76], white: [255, 246, 232], orange: [255, 154, 64], teal: [70, 255, 206], silver: [214, 226, 255],
  };
  var COMBOS = [['pink', 'white'], ['cyan', 'violet'], ['gold', 'orange'], ['lime', 'teal'], ['violet', 'pink'], ['red', 'gold'], ['teal', 'cyan'], ['silver', 'cyan'], ['orange', 'red'], ['pink', 'gold']];
  var glowCache = {};
  function glowSprite(c) {
    var k = c.join();
    if (glowCache[k]) return glowCache[k];
    var s = document.createElement('canvas');
    s.width = s.height = 64;
    var g = s.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.16, 'rgba(' + c + ',0.95)');
    r.addColorStop(0.42, 'rgba(' + c + ',0.32)');
    r.addColorStop(1, 'rgba(' + c + ',0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    glowCache[k] = s;
    return s;
  }
  var flashCache = {};
  function flashSprite(c) { // a soft burst light, no hard core
    var k = c.join();
    if (flashCache[k]) return flashCache[k];
    var s = document.createElement('canvas');
    s.width = s.height = 64;
    var g = s.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,0.5)');
    r.addColorStop(0.22, 'rgba(' + c + ',0.32)');
    r.addColorStop(1, 'rgba(' + c + ',0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    flashCache[k] = s;
    return s;
  }
  var puff = (function () {
    var s = document.createElement('canvas');
    s.width = s.height = 96;
    var g = s.getContext('2d'), r = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    r.addColorStop(0, 'rgba(196,180,232,0.9)');
    r.addColorStop(0.5, 'rgba(150,130,200,0.45)');
    r.addColorStop(1, 'rgba(120,100,180,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 96, 96);
    return s;
  })();

  // ---- seeded random, so the city looks the same after every resize ----
  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function layerCanvas(h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(FULL_W * DPR));
    c.height = Math.max(1, Math.round(h * DPR));
    var g = c.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    return { c: c, g: g, h: h };
  }

  // The festival city: far skyline (with a needle tower), near rooftops with lit windows and
  // strings of bulbs, the riverbank with the crowd and lamps, and window reflections.
  function buildLayers() {
    var R = rng(52), L = rocketLen();
    layers = { bulbs: [], refl: [], sparklers: [], lamps: [] };

    // far skyline
    var fh = H * 0.62, far = layerCanvas(fh), g = far.g, base = fh + 2;
    var tower = W * 0.2 + LEFT;
    var fg = g.createLinearGradient(0, 0, 0, fh);
    fg.addColorStop(0, '#41257a'); fg.addColorStop(1, '#26134e');
    g.fillStyle = fg;
    for (var x = -10; x < FULL_W + 10;) {
      var bw = 14 + R() * M * 0.08, bh = H * (0.12 + R() * 0.26);
      g.fillRect(x, base - bh, bw + 1, bh);
      if (R() < 0.25) { g.beginPath(); g.arc(x + bw / 2, base - bh, bw * 0.45, Math.PI, 0); g.fill(); } // dome
      x += bw;
    }
    // the needle tower
    var th = H * 0.56, tw = Math.max(8, M * 0.025);
    g.beginPath();
    g.moveTo(tower - tw, base); g.lineTo(tower - tw * 0.35, base - th * 0.7); g.lineTo(tower + tw * 0.35, base - th * 0.7); g.lineTo(tower + tw, base);
    g.fill();
    g.beginPath(); g.ellipse(tower, base - th * 0.72, tw * 1.6, tw * 0.7, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(tower - 1.5, base - th, 3, th * 0.3);
    layers.towerTip = { x: tower - LEFT, y: base - th - fh }; // relative to the layer's bottom
    // faint windows
    g.fillStyle = 'rgba(255, 214, 140, 0.4)';
    for (var i = 0; i < FULL_W * 0.35; i++) g.fillRect(R() * FULL_W, base - R() * H * 0.3, 1.6, 2);
    layers.far = far;

    // near city
    var nh = H * 0.4, near = layerCanvas(nh);
    g = near.g; base = nh + 1;
    var tops = [], WIN = ['#ffd27a', '#ffb45e', '#ff9ad1', '#9fe9ff', '#fff0c0'];
    var win = Math.max(3, M * 0.011);
    for (x = -6; x < FULL_W + 6;) {
      bw = 22 + R() * M * 0.13; bh = H * (0.08 + R() * 0.22);
      var bx = x, by = base - bh, kind = R();
      var ng = g.createLinearGradient(bx, 0, bx + bw, 0);
      ng.addColorStop(0, '#2c1858'); ng.addColorStop(0.18, '#1d0e3e'); ng.addColorStop(1, '#150a30');
      g.fillStyle = ng;
      g.fillRect(bx, by, bw + 1, bh);
      var roofY = by;
      if (kind < 0.22) { // pointed roof
        g.beginPath(); g.moveTo(bx - 2, by); g.lineTo(bx + bw / 2, by - bw * 0.45); g.lineTo(bx + bw + 2, by); g.fill(); roofY = by - bw * 0.45;
      } else if (kind < 0.38) { // two-tier curved roof
        g.beginPath(); g.moveTo(bx - bw * 0.12, by); g.quadraticCurveTo(bx + bw / 2, by - bw * 0.3, bx + bw * 1.12, by); g.fill();
        g.fillRect(bx + bw * 0.25, by - bw * 0.42, bw * 0.5, bw * 0.3);
        g.beginPath(); g.moveTo(bx + bw * 0.12, by - bw * 0.4); g.quadraticCurveTo(bx + bw / 2, by - bw * 0.65, bx + bw * 0.88, by - bw * 0.4); g.fill();
        roofY = by - bw * 0.6;
      } else if (kind < 0.5) { // water tank
        g.fillRect(bx + bw * 0.6, by - bw * 0.3, bw * 0.25, bw * 0.3);
      }
      // windows
      for (var wy = by + win * 1.6; wy < base - win * 2; wy += win * 2.4) {
        for (var wx = bx + win; wx < bx + bw - win * 1.5; wx += win * 2) {
          if (R() < 0.34) {
            var wc = WIN[Math.floor(R() * WIN.length)];
            g.globalAlpha = 0.55 + R() * 0.45;
            g.fillStyle = wc;
            g.fillRect(wx, wy, win, win * 1.3);
            if (R() < 0.12) layers.refl.push({ x: wx - LEFT, w: win * 2.2, c: wc });
          }
        }
      }
      g.globalAlpha = 1;
      tops.push({ x: bx - LEFT, w: bw, y: roofY - nh, flat: by - nh });
      x += bw + (R() < 0.3 ? R() * 10 : 0);
    }
    // strings of bulbs between neighbouring rooftops
    for (i = 0; i < tops.length - 1; i++) {
      if (R() < 0.35) continue;
      var a = tops[i], b = tops[i + 1];
      var x0 = a.x + a.w * 0.5, y0 = a.flat + 2, x1 = b.x + b.w * 0.5, y1 = b.flat + 2;
      var sag = Math.abs(x1 - x0) * 0.18, n = Math.max(4, Math.floor(Math.abs(x1 - x0) / 9));
      for (var k = 1; k < n; k++) {
        var tt = k / n;
        layers.bulbs.push({
          x: x0 + (x1 - x0) * tt, y: y0 + (y1 - y0) * tt + Math.sin(tt * Math.PI) * sag,
          c: PAL[['gold', 'pink', 'cyan', 'lime', 'orange'][(i + k) % 5]], p: R() * 6,
        });
      }
      layers.bulbs.push({ wire: true, x0: x0, y0: y0, x1: x1, y1: y1, sag: sag });
    }
    layers.near = near;

    // riverbank: crowd, railing, lamps (front layer, moves with the camera)
    var crowdH = Math.max(22, H * 0.085), bankH = H * 0.04, frh = crowdH * 1.6 + bankH, front = layerCanvas(frh);
    g = front.g;
    var top = crowdH * 1.6; // bank top inside the layer
    var padX = W * 0.5 + LEFT, gap = L * 0.95;
    // crowd silhouettes
    for (x = -4; x < FULL_W + 4;) {
      var pw = crowdH * (0.42 + R() * 0.2);
      if (Math.abs(x + pw / 2 - padX) > gap) {
        var ph = crowdH * (0.7 + R() * 0.32), hx = x + pw / 2, hy = top - ph;
        g.fillStyle = '#0c0624';
        g.beginPath(); // shoulders
        g.moveTo(x, top); g.quadraticCurveTo(x, hy + ph * 0.38, hx, hy + ph * 0.34); g.quadraticCurveTo(x + pw, hy + ph * 0.38, x + pw, top);
        g.fill();
        g.beginPath(); g.arc(hx, hy + ph * 0.18, pw * 0.26, 0, Math.PI * 2); g.fill(); // head
        g.strokeStyle = 'rgba(255, 120, 200, 0.28)'; g.lineWidth = 1; // rim light from the bursts
        g.beginPath(); g.arc(hx, hy + ph * 0.18, pw * 0.26, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
        if (R() < 0.22) { // a raised arm with a sparkler
          var ax2 = hx + (R() < 0.5 ? -1 : 1) * pw * 0.45, ay2 = hy - ph * 0.15;
          g.strokeStyle = '#0c0624'; g.lineWidth = Math.max(2, pw * 0.16); g.lineCap = 'round';
          g.beginPath(); g.moveTo(hx, hy + ph * 0.45); g.lineTo(ax2, ay2); g.stroke();
          layers.sparklers.push({ x: ax2 - LEFT, y: ay2 - frh });
        }
      }
      x += pw * (0.7 + R() * 0.35);
    }
    // bank wall
    var bg2 = g.createLinearGradient(0, top, 0, frh);
    bg2.addColorStop(0, '#24124a'); bg2.addColorStop(1, '#130a2c');
    g.fillStyle = bg2;
    g.fillRect(0, top, FULL_W, bankH + 1);
    g.fillStyle = 'rgba(255, 140, 210, 0.35)';
    g.fillRect(0, top, FULL_W, 1.2);
    g.strokeStyle = 'rgba(0, 0, 0, 0.35)'; g.lineWidth = 1;
    for (x = 0; x < FULL_W; x += 26) { g.beginPath(); g.moveTo(x, top + bankH * 0.5); g.lineTo(x, frh); g.stroke(); }
    // railing (in front of the crowd)
    g.strokeStyle = '#3a2470'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(0, top - crowdH * 0.32); g.lineTo(FULL_W, top - crowdH * 0.32); g.stroke();
    for (x = 6; x < FULL_W; x += 18) { g.beginPath(); g.moveTo(x, top - crowdH * 0.32); g.lineTo(x, top); g.stroke(); }
    // lamps
    for (x = 30 + R() * 40; x < FULL_W; x += M * 0.28 + 60) {
      if (Math.abs(x - padX) < gap) continue;
      g.strokeStyle = '#2a1656'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, top - crowdH * 1.45); g.stroke();
      layers.lamps.push({ x: x - LEFT, y: top - crowdH * 1.45 - frh });
    }
    layers.front = front;
    layers.bankH = bankH;

    // the fuse: from the bank on the left, along the ground to the crate, up to the rocket
    var pad = padSpot(), pts = [], fx0 = Math.max(W * 0.06, pad.x - Math.min(W * 0.42, L * 3.4));
    for (k = 0; k <= 40; k++) {
      var u = k / 40, px = fx0 + (pad.x - L * 0.5 - fx0) * u;
      pts.push({ x: px, y: GROUND - 2 - Math.sin(u * Math.PI * 3) * H * 0.008 });
    }
    pts.push({ x: pad.x - L * 0.47, y: pad.crateTop + (GROUND - pad.crateTop) * 0.5 });
    pts.push({ x: pad.x - L * 0.2, y: pad.crateTop - 2 });
    pts.push({ x: pad.x - L * 0.05, y: pad.y });
    var total = 0;
    pts.forEach(function (p, j) { if (j) total += Math.hypot(p.x - pts[j - 1].x, p.y - pts[j - 1].y); p.d = total; });
    layers.fuse = { pts: pts, len: total };

    // haze clouds spread up through the climb
    layers.clouds = [];
    for (i = 0; i < 12; i++) layers.clouds.push({ x: R(), wy: R(), s: 0.7 + R() * 0.9 });
    layers.stars = [];
    for (i = 0; i < 170; i++) layers.stars.push({ x: R(), y: R(), r: 0.5 + R() * 1.3, t: R() * 6 });
  }

  // ---- particles ----
  var parts = [], bgParts = [], smoke = [];
  var MAX_PARTS = 1700;
  function add(list, p) {
    if (list.length >= MAX_PARTS) return;
    p.max = p.life;
    p.css = 'rgb(' + p.c + ')';
    list.push(p);
  }
  function addSmoke(x, y, r, life, par, dark) {
    if (smoke.length > 140) return;
    smoke.push({ x: x, y: y, vx: rand(-8, 8), vy: rand(-12, 6), r: r, gr: r * 0.9, life: life, max: life, par: par, dark: dark });
  }
  function stepParts(list, dt, camD) {
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) {
        if (p.split) p.split(p);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      var dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt + camD * p.par;
    }
  }
  function drawParts(list, alphaMul) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < list.length; i++) {
      var p = list[i], k = p.life / p.max, a = (k < 0.35 ? k / 0.35 : 1) * alphaMul;
      if (p.flick && Math.random() < 0.5) continue;
      var sz = p.s * (0.55 + 0.45 * k);
      if (p.tl) {
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = p.css;
        ctx.lineWidth = Math.max(1, sz * 0.32);
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * p.tl, p.y - p.vy * p.tl);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.drawImage(glowSprite(p.c), p.x - sz, p.y - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawSmoke(dt, camD) {
    for (var i = smoke.length - 1; i >= 0; i--) {
      var s = smoke[i];
      s.life -= dt;
      if (s.life <= 0) { smoke[i] = smoke[smoke.length - 1]; smoke.pop(); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt + camD * s.par; s.r += s.gr * dt;
      var k = s.life / s.max;
      ctx.globalAlpha = (s.dark ? 0.32 : 0.2) * k;
      ctx.drawImage(puff, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---- shells: the bursts ----
  var flashes = [];
  function shell(list, x, y, size, kind, par, dim) {
    var combo = pick(COMBOS), A = PAL[combo[0]], B = PAL[combo[1]];
    if (kind === 'willow' || kind === 'palm') { A = PAL.gold; B = PAL.orange; }
    if (kind === 'glitter') { A = PAL.silver; B = PAL.white; }
    var R = 0.25 * M * size, dot = clamp(M * 0.022, 5, 13) * (0.75 + 0.35 * size), grav = M * 0.13, i, n, a, sp, p;
    var cut = dim ? 0.55 : 1;
    function pt(vx, vy, o) {
      p = { x: x, y: y, vx: vx, vy: vy, life: 1.3, drag: 1.8, g: grav, c: A, s: dot, par: par, tl: 0.05 };
      for (var k in o) p[k] = o[k];
      add(list, p);
    }
    switch (kind) {
      case 'chrys':
        n = Math.round(58 * cut);
        for (i = 0; i < n; i++) { a = Math.random() * 6.283; sp = R * 1.8 * Math.sqrt(1 - Math.pow(Math.random(), 2)); pt(Math.cos(a) * sp, Math.sin(a) * sp, { life: rand(1.3, 1.8), s: dot * 0.8, tl: 0.14 }); }
        break;
      case 'willow':
        n = Math.round(46 * cut);
        for (i = 0; i < n; i++) { a = Math.random() * 6.283; sp = R * 1.45 * rand(0.85, 1.05); pt(Math.cos(a) * sp, Math.sin(a) * sp, { life: rand(2.1, 2.8), drag: 1.35, g: grav * 2.2, s: dot * 0.7, tl: 0.13, c: Math.random() < 0.7 ? A : B }); }
        break;
      case 'ring':
        n = Math.round(40 * cut);
        var tilt = Math.random() * Math.PI, e = rand(0.3, 0.75), ct = Math.cos(tilt), st = Math.sin(tilt);
        for (i = 0; i < n; i++) {
          a = (i / n) * 6.283; sp = R * 1.7;
          var vx = Math.cos(a) * sp, vy = Math.sin(a) * sp * e;
          pt(vx * ct - vy * st, vx * st + vy * ct, { life: rand(1.2, 1.5) });
        }
        for (i = 0; i < 14 * cut; i++) { a = Math.random() * 6.283; sp = R * 0.5 * Math.random(); pt(Math.cos(a) * sp, Math.sin(a) * sp, { c: B, life: rand(0.8, 1.2), s: dot * 0.8 }); }
        break;
      case 'palm':
        n = 8;
        for (i = 0; i < n; i++) { a = (i / n) * 6.283 + rand(-0.2, 0.2); sp = R * 1.9; pt(Math.cos(a) * sp, Math.sin(a) * sp - R * 0.3, { life: 1.6, s: dot * 1.5, tl: 0.22, g: grav * 2 }); }
        for (i = 0; i < 24 * cut; i++) { a = Math.random() * 6.283; sp = R * 1.2 * Math.random(); pt(Math.cos(a) * sp, Math.sin(a) * sp, { c: PAL.white, life: rand(0.9, 1.5), s: dot * 0.55, flick: true, tl: 0 }); }
        break;
      case 'crossette':
        n = Math.round(10 * cut) + 2;
        for (i = 0; i < n; i++) {
          a = (i / n) * 6.283; sp = R * 1.5;
          pt(Math.cos(a) * sp, Math.sin(a) * sp, {
            life: 0.55, tl: 0.1,
            split: (function (col) {
              return function (q) {
                var base = Math.random() * 1.57;
                for (var j = 0; j < 4; j++) {
                  var b = base + j * 1.5708;
                  add(list, { x: q.x, y: q.y, vx: q.vx * 0.3 + Math.cos(b) * R * 0.9, vy: q.vy * 0.3 + Math.sin(b) * R * 0.9, life: rand(0.6, 0.9), drag: 1.9, g: grav, c: col, s: dot * 0.8, par: q.par, tl: 0.1 });
                }
              };
            })(B),
          });
        }
        break;
      case 'glitter':
        n = Math.round(70 * cut);
        for (i = 0; i < n; i++) { a = Math.random() * 6.283; sp = R * 1.6 * Math.sqrt(Math.random()); pt(Math.cos(a) * sp, Math.sin(a) * sp, { life: rand(1.4, 2.1), drag: 2.2, g: grav * 0.8, s: dot * 0.7, flick: true, c: Math.random() < 0.5 ? A : B, tl: 0 }); }
        break;
      default: // peony
        n = Math.round(56 * cut);
        for (i = 0; i < n; i++) { a = Math.random() * 6.283; sp = R * 1.8 * Math.sqrt(1 - Math.pow(Math.random(), 2)) * rand(0.92, 1.05); pt(Math.cos(a) * sp, Math.sin(a) * sp, { life: rand(1.2, 1.7), c: Math.random() < 0.72 ? A : B }); }
    }
    flashes.push({ x: x, y: y, c: A, r: R * (dim ? 0.9 : 1.5), born: performance.now(), dur: dim ? 260 : 380, a: dim ? 0.4 : 0.95, par: par });
    var lv = (dim ? 0.12 : 0.32) * size;
    if (lv > scene.light) { scene.light = Math.min(0.8, lv); scene.lightC = A; }
  }
  // A small rising shell from the city that bursts high up (while bets are open, and behind the
  // rocket in the first part of the climb).
  function riser(x, yTo, size) {
    var y0 = GROUND - H * 0.08, T = rand(0.7, 1);
    add(bgParts, {
      x: x, y: y0, vx: rand(-10, 10), vy: (yTo - y0) / T, life: T, drag: 0, g: 0, c: PAL.orange, s: clamp(M * 0.012, 3, 7), par: 0.3, tl: 0.09,
      split: function (q) {
        shell(bgParts, q.x, q.y, size, pick(['peony', 'chrys', 'ring', 'willow', 'glitter']), 0.3, true);
        SND.burst(size * 0.45, (q.x - W / 2) / (W / 2) * 0.7);
      },
    });
  }

  // ---- the rocket ----
  function rocketLen() { return clamp(H * 0.2, 46, 130); }
  function padSpot() { // nozzle position on the launch crate
    var L = rocketLen(), crateTop = GROUND - L * 0.36;
    return { x: W * 0.5, y: crateTop - L * 0.02, crateTop: crateTop };
  }
  function rocketFlight(now) { // nozzle position / tilt in flight (and while launching)
    var L = rocketLen(), pad = padSpot();
    var t = now - scene.launchAt, k = ease(t / LAUNCH_MS);
    var tx = W * 0.5 + Math.sin(now / 1100) * Math.min(W * 0.05, L * 0.6) * k;
    var ty = H * 0.33 + Math.sin(now / 700) * H * 0.012 * k;
    return { x: pad.x + (tx - pad.x) * k, y: pad.y + (ty - pad.y) * k, ang: Math.cos(now / 1100) * 0.09 * k, L: L, k: k };
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // (x, y) = the nozzle; the rocket points up (ang = tilt); thrust 0…1 sizes the flame.
  function drawRocket(x, y, ang, L, thrust, charred) {
    var w = L * 0.25, top = -L * 0.76, bot = -L * 0.04;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    // guide stick (a long bamboo stick along one side)
    ctx.strokeStyle = charred ? '#4a3a2a' : '#c29a5e';
    ctx.lineWidth = Math.max(1.5, w * 0.13);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(w * 0.42, top * 0.6); ctx.lineTo(w * 0.42, L * 0.62); ctx.stroke();
    // flame
    if (thrust > 0) {
      var fl = L * (0.32 + Math.random() * 0.2) * thrust;
      ctx.globalCompositeOperation = 'lighter';
      var fg = ctx.createLinearGradient(0, 0, 0, fl);
      fg.addColorStop(0, 'rgba(255,255,235,0.95)'); fg.addColorStop(0.35, 'rgba(255,196,80,0.85)'); fg.addColorStop(1, 'rgba(255,80,40,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, 0); ctx.quadraticCurveTo(0, fl * 1.15, w * 0.3, 0); ctx.fill();
      var gs = L * 0.95 * thrust;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(glowSprite(PAL.gold), -gs / 2, -gs / 2 + L * 0.04, gs, gs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // clay nozzle
    ctx.fillStyle = '#3a2a32';
    roundRect(ctx, -w * 0.36, bot - 1, w * 0.72, L * 0.05 + 1, 2); ctx.fill();
    // tube
    var bg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    bg.addColorStop(0, '#6a0d26'); bg.addColorStop(0.35, '#ff4d72'); bg.addColorStop(0.6, '#de2752'); bg.addColorStop(1, '#4a061c');
    ctx.fillStyle = bg;
    roundRect(ctx, -w / 2, top, w, bot - top, w * 0.12);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ffd36b'; // spiral wrapper stripes
    for (var sy = top - w; sy < bot + w; sy += w * 0.95) {
      ctx.beginPath(); ctx.moveTo(-w / 2, sy); ctx.lineTo(w / 2, sy - w * 0.55); ctx.lineTo(w / 2, sy - w * 0.32); ctx.lineTo(-w / 2, sy + w * 0.23); ctx.fill();
    }
    var sh = ctx.createLinearGradient(-w / 2, 0, w / 2, 0); // round the tube
    sh.addColorStop(0, 'rgba(20,0,20,0.55)'); sh.addColorStop(0.38, 'rgba(255,255,255,0.18)'); sh.addColorStop(0.62, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(20,0,20,0.6)');
    ctx.fillStyle = sh;
    ctx.fillRect(-w / 2, top, w, bot - top);
    if (charred) { ctx.fillStyle = 'rgba(25,12,30,0.62)'; ctx.fillRect(-w / 2, top, w, bot - top); }
    ctx.restore();
    // gold bands
    ctx.fillStyle = charred ? '#6a5a3a' : '#ffc94a';
    ctx.fillRect(-w / 2, top, w, L * 0.035);
    ctx.fillRect(-w / 2, bot - L * 0.045, w, L * 0.035);
    // nose cone
    var cg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    cg.addColorStop(0, charred ? '#3a2a20' : '#b5701a'); cg.addColorStop(0.4, charred ? '#7a6040' : '#ffe38a'); cg.addColorStop(1, charred ? '#2a1a14' : '#a85a10');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(-w * 0.6, top + 1);
    ctx.quadraticCurveTo(-w * 0.4, top - L * 0.14, 0, -L);
    ctx.quadraticCurveTo(w * 0.4, top - L * 0.14, w * 0.6, top + 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPad() {
    var L = rocketLen(), pad = padSpot(), cw = L * 0.95, chh = GROUND - pad.crateTop, x = pad.x - cw / 2, y = pad.crateTop;
    var wg = ctx.createLinearGradient(0, y, 0, y + chh);
    wg.addColorStop(0, '#6b3f24'); wg.addColorStop(1, '#3d2014');
    ctx.fillStyle = wg;
    roundRect(ctx, x, y, cw, chh, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    for (var i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x, y + (chh * i) / 3); ctx.lineTo(x + cw, y + (chh * i) / 3); ctx.stroke(); }
    // festival cloth band
    ctx.save();
    roundRect(ctx, x, y + chh * 0.32, cw, chh * 0.36, 0); ctx.clip();
    for (var s = -chh; s < cw + chh; s += 12) {
      ctx.fillStyle = (s / 12) % 2 ? '#ff4f9a' : '#ffc94a';
      ctx.beginPath(); ctx.moveTo(x + s, y + chh * 0.68); ctx.lineTo(x + s + 6, y + chh * 0.68); ctx.lineTo(x + s + 6 + chh * 0.36, y + chh * 0.32); ctx.lineTo(x + s + chh * 0.36, y + chh * 0.32); ctx.fill();
    }
    ctx.restore();
    // star stencil
    ctx.fillStyle = 'rgba(255,230,170,0.9)';
    var sx = pad.x, sy2 = y + chh * 0.5, sr = chh * 0.16;
    ctx.beginPath();
    for (i = 0; i < 10; i++) { var ang = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? sr * 0.45 : sr; ctx.lineTo(sx + Math.cos(ang) * rr, sy2 + Math.sin(ang) * rr); }
    ctx.closePath(); ctx.fill();
    // top lip
    ctx.fillStyle = '#2a140c';
    ctx.fillRect(x - 2, y - 2, cw + 4, 4);
  }

  function drawFuse(now, p, lift) { // p: 0 … 1 burnt; lift: the ground's camera offset
    var f = layers.fuse, pts = f.pts, at = p * f.len, i;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(80, 70, 90, 0.55)'; ctx.lineWidth = 1.4; // ash behind the spark
    ctx.beginPath();
    for (i = 0; i < pts.length && pts[i].d <= at; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i].x, pts[i].y);
    ctx.stroke();
    var sp = pts[0];
    for (i = 1; i < pts.length; i++) {
      if (pts[i].d >= at) { var a0 = pts[i - 1], k = (at - a0.d) / Math.max(0.001, pts[i].d - a0.d); sp = { x: a0.x + (pts[i].x - a0.x) * k, y: a0.y + (pts[i].y - a0.y) * k }; break; }
      sp = pts[i];
    }
    ctx.strokeStyle = '#b97a3c'; ctx.lineWidth = Math.max(2.6, M * 0.008); // the cord still to burn
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y);
    for (i = 0; i < pts.length; i++) if (pts[i].d > at) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255, 220, 150, 0.5)'; ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    if (S.phase === 'betting') { // the spark
      var gs = M * (0.07 + Math.random() * 0.03);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite(PAL.gold), sp.x - gs / 2, sp.y - gs / 2, gs, gs);
      ctx.globalCompositeOperation = 'source-over';
      for (i = 0; i < 2; i++) {
        var a = -Math.PI / 2 + rand(-1.2, 1.2), v = rand(M * 0.15, M * 0.4);
        add(parts, { x: sp.x, y: sp.y + lift, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.15, 0.35), drag: 2, g: M * 0.8, c: Math.random() < 0.5 ? PAL.gold : PAL.white, s: clamp(M * 0.01, 2.5, 5), par: 1, tl: 0.03 });
      }
    }
  }

  // ---- the world: sky by altitude, city layers by camera height ----
  // 1× festival dusk over the city · ~2–3× smoky night above the bursts · ~5–10× aurora ·
  // 15×+ a deep nebula sky.
  var SKY = [
    [[30, 15, 72], [140, 46, 110]],
    [[15, 11, 56], [62, 32, 116]],
    [[4, 16, 40], [14, 62, 88]],
    [[10, 4, 26], [64, 16, 82]],
  ];
  function mix(a, b, k) { return Math.round(a + (b - a) * k); }
  function skyCol(i, alt) {
    var f = clamp(alt, 0, 1) * 3, seg = Math.min(2, Math.floor(f)), k = f - seg, c0 = SKY[seg][i], c1 = SKY[seg + 1][i];
    return [mix(c0[0], c1[0], k), mix(c0[1], c1[1], k), mix(c0[2], c1[2], k)];
  }
  // After the fizzle the view drifts back down to the festival for the next launch.
  function backDown() { return S.phase === 'crashed' && performance.now() - scene.crashAt > FIZZLE_MS + 200; }
  function climbTarget() {
    var m = S.phase === 'flying' ? game.currentMult() : S.phase === 'crashed' && !backDown() ? S.crashPoint : 1;
    return clamp(Math.log(Math.max(1, m)) / Math.log(20), 0, 1);
  }
  function camTarget() {
    if (S.phase === 'flying') { var l = Math.log(Math.max(1, game.currentMult())); return H * (2 * l + 0.5 * l * l); }
    if (S.phase === 'crashed' && !backDown()) return scene.cam;
    return 0;
  }

  function drawSky(now) {
    var alt = scene.alt, top = skyCol(0, alt), bot = skyCol(1, alt);
    var g = ctx.createLinearGradient(0, -TOP, 0, GROUND);
    g.addColorStop(0, 'rgb(' + top + ')');
    g.addColorStop(1, 'rgb(' + bot + ')');
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    // burst light on the whole sky
    if (scene.light > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(' + scene.lightC + ',' + (scene.light * 0.16).toFixed(3) + ')';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      ctx.globalCompositeOperation = 'source-over';
    }
    // stars (always a few — it is night; more as we climb)
    var sa = 0.3 + 0.7 * clamp(alt * 2.2, 0, 1), span = FULL_H;
    ctx.fillStyle = '#fff';
    layers.stars.forEach(function (st) {
      var y = (((st.y * span + scene.cam * 0.05) % span) + span) % span - TOP;
      if (y > GROUND - H * 0.2 && scene.cam < H * 0.5) return; // not over the city glow
      ctx.globalAlpha = sa * (0.45 + 0.55 * Math.sin(now / 520 + st.t));
      ctx.fillRect(st.x * FULL_W - LEFT, y, st.r, st.r);
    });
    ctx.globalAlpha = 1;
    // nebula (very high)
    var neb = clamp((alt - 0.7) / 0.25, 0, 1);
    if (neb > 0) {
      ctx.globalCompositeOperation = 'lighter';
      [[0.22, 0.3, 0.7, [255, 60, 170]], [0.78, 0.22, 0.6, [80, 120, 255]], [0.55, 0.62, 0.55, [170, 80, 255]]].forEach(function (n, j) {
        var cx = W * n[0] + Math.sin(now / 7000 + j) * W * 0.04, cy = H * n[1] + Math.cos(now / 9000 + j) * H * 0.03, r = Math.max(W, H) * n[2];
        var ng = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        ng.addColorStop(0, 'rgba(' + n[3] + ',' + (0.22 * neb).toFixed(3) + ')');
        ng.addColorStop(1, 'rgba(' + n[3] + ',0)');
        ctx.fillStyle = ng;
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      });
      ctx.globalCompositeOperation = 'source-over';
    }
    // aurora ribbons
    var au = clamp((alt - 0.38) / 0.22, 0, 1) * (1 - 0.5 * neb);
    if (au > 0) {
      ctx.globalCompositeOperation = 'lighter';
      for (var r = 0; r < 3; r++) {
        var base = H * (0.1 + r * 0.11), amp = H * 0.06, th = H * (0.2 - r * 0.035);
        var ag = ctx.createLinearGradient(0, base - amp, 0, base + th + amp);
        var col = r === 1 ? '130,150,255' : '80,255,190';
        ag.addColorStop(0, 'rgba(' + col + ',0)');
        ag.addColorStop(0.35, 'rgba(' + col + ',' + (0.24 * au).toFixed(3) + ')');
        ag.addColorStop(1, 'rgba(170,90,255,0)');
        ctx.fillStyle = ag;
        ctx.beginPath();
        var x, step = 24;
        for (x = -LEFT; x <= W + step; x += step) {
          var y = base + Math.sin(x * 0.006 + now * 0.0005 + r * 2) * amp + Math.sin(x * 0.013 - now * 0.0003) * amp * 0.4;
          if (x === -LEFT) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        for (x = W + step; x >= -LEFT - step; x -= step) ctx.lineTo(x, base + th + Math.sin(x * 0.008 + now * 0.0004 + r) * amp * 0.4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawHaze(now) {
    var hz = clamp(scene.alt / 0.12, 0, 1) * (1 - clamp((scene.alt - 0.75) / 0.2, 0, 1)) * 0.9 + 0.15;
    var span = H * 6;
    layers.clouds.forEach(function (c, j) {
      var y = (((c.wy * span + scene.cam * 0.6) % span) + span) % span - H * 1.4;
      if (y < -TOP - H * 0.4 || y > GROUND) return;
      var x = c.x * (FULL_W + 200) - 100 - LEFT + Math.sin(now / 9000 + j) * 30, s = c.s * M * 0.32;
      ctx.globalAlpha = 0.16 * hz;
      for (var b = 0; b < 4; b++) ctx.drawImage(puff, x + (b - 1.5) * s * 0.55 - s, y + (b % 2) * s * 0.12 - s * 0.6, s * 2, s * 1.2);
      if (scene.light > 0.02) { // lit by the bursts
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = scene.light * 0.35 * hz;
        ctx.drawImage(glowSprite(scene.lightC), x - s * 1.2, y - s * 0.7, s * 2.4, s * 1.4);
        ctx.globalCompositeOperation = 'source-over';
      }
    });
    ctx.globalAlpha = 1;
  }

  function drawCity(now) {
    var cam = scene.cam, lim = FULL_H - TOP;
    // the glow over the city
    var dyF = cam * 0.35;
    if (GROUND - H * 0.7 + dyF < lim) {
      var gg = ctx.createLinearGradient(0, GROUND - H * 0.55 + dyF, 0, GROUND + dyF);
      gg.addColorStop(0, 'rgba(255,90,170,0)');
      gg.addColorStop(1, 'rgba(255,120,120,0.32)');
      ctx.fillStyle = gg;
      ctx.fillRect(-LEFT, GROUND - H * 0.55 + dyF, FULL_W, H * 0.55);
    }
    var far = layers.far;
    if (GROUND - far.h + dyF < lim) {
      ctx.drawImage(far.c, -LEFT, GROUND - far.h + 2 + dyF, FULL_W, far.h);
      var tip = layers.towerTip; // the tower's beacon
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 400);
      var bs = M * 0.05;
      ctx.drawImage(glowSprite(PAL.red), tip.x - bs / 2, GROUND + 2 + tip.y + dyF - bs / 2, bs, bs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    drawWheel(now, cam * 0.5);
    var dyN = cam * 0.7, near = layers.near;
    if (GROUND - near.h + dyN < lim) {
      ctx.drawImage(near.c, -LEFT, GROUND - near.h + 1 + dyN, FULL_W, near.h);
      // strings of bulbs
      var bsz = clamp(M * 0.016, 4, 8);
      ctx.strokeStyle = 'rgba(20,10,40,0.9)'; ctx.lineWidth = 1;
      layers.bulbs.forEach(function (b) {
        if (!b.wire) return;
        ctx.beginPath();
        ctx.moveTo(b.x0, GROUND + b.y0 + dyN);
        ctx.quadraticCurveTo((b.x0 + b.x1) / 2, GROUND + (b.y0 + b.y1) / 2 + b.sag * 2 + dyN, b.x1, GROUND + b.y1 + dyN);
        ctx.stroke();
      });
      ctx.globalCompositeOperation = 'lighter';
      layers.bulbs.forEach(function (b) {
        if (b.wire) return;
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 300 + b.p);
        ctx.drawImage(glowSprite(b.c), b.x - bsz, GROUND + b.y + dyN - bsz, bsz * 2, bsz * 2);
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawWheel(now, dy) {
    var R = Math.min(H * 0.21, W * 0.17), cx = W * 0.84, cy = GROUND - R - H * 0.06 + dy;
    if (cy - R > FULL_H - TOP) return;
    var rot = now / 9000;
    ctx.strokeStyle = '#2c1658'; ctx.lineWidth = Math.max(2, R * 0.05);
    ctx.beginPath(); ctx.moveTo(cx - R * 0.55, GROUND + dy); ctx.lineTo(cx, cy); ctx.lineTo(cx + R * 0.55, GROUND + dy); ctx.stroke();
    ctx.lineWidth = Math.max(1, R * 0.018); ctx.strokeStyle = '#3d2078';
    for (var i = 0; i < 12; i++) {
      var a = rot + (i / 12) * 6.283;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
    }
    ctx.lineWidth = Math.max(1.5, R * 0.035);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, 0, 6.283); ctx.stroke();
    // gondolas
    for (i = 0; i < 8; i++) {
      a = rot + (i / 8) * 6.283;
      var gx = cx + Math.cos(a) * R, gy = cy + Math.sin(a) * R, gw = R * 0.16;
      ctx.fillStyle = ['#ff4f9a', '#ffc94a', '#63e6ff', '#9c7bff'][i % 4];
      ctx.globalAlpha = 0.85;
      roundRect(ctx, gx - gw / 2, gy + 2, gw, gw * 0.8, 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // chasing rim lights
    ctx.globalCompositeOperation = 'lighter';
    var ls = clamp(R * 0.09, 3, 9), chase = Math.floor(now / 160);
    for (i = 0; i < 24; i++) {
      a = rot + (i / 24) * 6.283;
      ctx.globalAlpha = (i + chase) % 3 === 0 ? 1 : 0.35;
      ctx.drawImage(glowSprite(i % 2 ? PAL.pink : PAL.cyan), cx + Math.cos(a) * R - ls, cy + Math.sin(a) * R - ls, ls * 2, ls * 2);
    }
    ctx.globalAlpha = 0.9;
    ctx.drawImage(glowSprite(PAL.gold), cx - ls * 1.5, cy - ls * 1.5, ls * 3, ls * 3);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFront(now) {
    var dy = scene.cam, fr = layers.front, lim = FULL_H - TOP, topY = GROUND - fr.h + layers.bankH + dy;
    if (topY > lim) return;
    // water
    var wTop = GROUND + layers.bankH + dy;
    if (wTop < lim) {
      var wg = ctx.createLinearGradient(0, wTop, 0, lim);
      var bot = skyCol(1, scene.alt);
      wg.addColorStop(0, 'rgb(' + mix(bot[0], 20, 0.55) + ',' + mix(bot[1], 10, 0.55) + ',' + mix(bot[2], 50, 0.55) + ')');
      wg.addColorStop(1, '#0a0620');
      ctx.fillStyle = wg;
      ctx.fillRect(-LEFT, wTop, FULL_W, lim - wTop);
      // reflections of the windows
      var rows = Math.min(16, Math.ceil((lim - wTop) / 4));
      layers.refl.forEach(function (r, i) {
        ctx.fillStyle = r.c;
        for (var k = 0; k < rows; k++) {
          ctx.globalAlpha = 0.32 * (1 - k / rows);
          var off = Math.sin(now / 420 + k * 0.8 + i) * 3, wid = r.w * (1 - (k / rows) * 0.5);
          ctx.fillRect(r.x + off - wid / 2, wTop + 2 + k * 4, wid, 1.6);
        }
      });
      ctx.globalAlpha = 1;
      // reflections of the bursts
      ctx.globalCompositeOperation = 'lighter';
      flashes.forEach(function (f) {
        var age = (now - f.born) / 1400;
        if (age >= 1) return;
        var a = (1 - age) * 0.45 * f.a;
        var rg = ctx.createLinearGradient(0, wTop, 0, lim);
        rg.addColorStop(0, 'rgba(' + f.c + ',' + a.toFixed(3) + ')');
        rg.addColorStop(1, 'rgba(' + f.c + ',0)');
        ctx.fillStyle = rg;
        for (var k = 0; k < 6; k++) {
          var off = Math.sin(now / 300 + k) * 4;
          ctx.fillRect(f.x - f.r * 0.25 + off, wTop + k * ((lim - wTop) / 6), f.r * 0.5, (lim - wTop) / 6 - 1.5);
        }
      });
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(fr.c, -LEFT, topY, FULL_W, fr.h);
    // lamps
    ctx.globalCompositeOperation = 'lighter';
    var ls = clamp(M * 0.05, 10, 26);
    layers.lamps.forEach(function (l) {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(glowSprite(PAL.gold), l.x - ls / 2, GROUND + layers.bankH + l.y + dy - ls / 2, ls, ls);
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // sparklers in the crowd
    if (S.phase !== 'crashed') {
      layers.sparklers.forEach(function (s) {
        if (Math.random() > 0.55) return;
        var a = rand(0, 6.283), v = rand(M * 0.05, M * 0.18);
        add(parts, { x: s.x + rand(-1, 1), y: GROUND + layers.bankH + s.y + dy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.12, 0.3), drag: 2, g: M * 0.3, c: Math.random() < 0.6 ? PAL.white : PAL.gold, s: clamp(M * 0.008, 2, 4), par: 1, tl: 0.03 });
      });
    }
  }

  function drawFlashes(now) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = flashes.length - 1; i >= 0; i--) {
      var f = flashes[i], age = (now - f.born) / f.dur;
      if (now - f.born > 1500) { flashes.splice(i, 1); continue; }
      if (age >= 1) continue;
      ctx.globalAlpha = (1 - age) * f.a;
      var r = f.r * (0.6 + age * 0.6);
      ctx.drawImage(flashSprite(f.c), f.x - r, f.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- effects at the engine's moments ----
  function launchFx() {
    var pad = padSpot(), L = rocketLen();
    for (var i = 0; i < 10; i++) addSmoke(pad.x + rand(-L * 0.4, L * 0.4), pad.crateTop + rand(-4, 8), L * rand(0.2, 0.35), rand(1.2, 1.8), 1);
    flashes.push({ x: pad.x, y: pad.y, c: PAL.gold, r: L * 1.2, born: performance.now(), dur: 420, a: 1, par: 1 });
    scene.light = 0.5; scene.lightC = PAL.gold;
  }
  function cashFx() {
    if (S.phase !== 'flying' || !scene.launchAt) return;
    var r = rocketFlight(performance.now());
    shell(parts, r.x + rand(-0.2, 0.2) * W, r.y - r.L * 0.6, 1.25, pick(['willow', 'palm']), 0.5, false);
  }

  function flightFx(now, dt) {
    var r = rocketFlight(now), t = now - scene.launchAt;
    // tail sparks + smoke
    var n = Math.min(16, Math.round(dt * (W > 700 ? 340 : 260)));
    for (var i = 0; i < n; i++) {
      var a = Math.PI / 2 + r.ang + rand(-0.35, 0.35), v = M * rand(0.25, 0.6);
      add(parts, { x: r.x + rand(-1, 1) * r.L * 0.05, y: r.y + r.L * 0.04, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.35, 0.75), drag: 1.3, g: M * 0.35, c: pick([PAL.gold, PAL.orange, PAL.white, PAL.gold]), s: clamp(M * 0.013, 3.5, 7), par: 1, tl: 0.05 });
    }
    if (Math.random() < dt * 18) addSmoke(r.x, r.y + r.L * 0.1, r.L * 0.22, rand(1, 1.5), 1);
    if (t < LAUNCH_MS * 0.9) return;
    // the showers it bursts as it climbs
    if (now > scene.nextBurst) {
      var alt = scene.alt, size = (0.65 + alt * 0.75) * rand(0.85, 1.15);
      var bx = r.x + rand(-0.36, 0.36) * W, by = r.y + rand(-0.22, 0.2) * H;
      shell(parts, clamp(bx, W * 0.08, W * 0.92), clamp(by, H * 0.08, H * 0.75), size, pick(['peony', 'chrys', 'willow', 'ring', 'palm', 'crossette', 'glitter']), 0.5, false);
      SND.burst(size * 0.8, (bx - W / 2) / (W / 2) * 0.7);
      scene.nextBurst = now + (1400 - 750 * alt) * rand(0.7, 1.3);
    }
    // milestones: a finale of three shells around the rocket
    var m = game.currentMult();
    if (scene.ms < MILESTONES.length && m >= MILESTONES[scene.ms]) {
      while (scene.ms < MILESTONES.length && m >= MILESTONES[scene.ms]) scene.ms++;
      for (i = 0; i < 3; i++) {
        var ang = -Math.PI / 2 + (i - 1) * 1.1;
        shell(parts, r.x + Math.cos(ang) * M * 0.32, clamp(r.y + Math.sin(ang) * M * 0.22 + H * 0.1, H * 0.08, H * 0.7), 1.35, pick(['peony', 'chrys', 'ring', 'glitter']), 0.5, false);
      }
      SND.big();
    }
    // a light background show while the city is still in view
    if (scene.cam < H * 1.2 && now > scene.nextBg) {
      riser(rand(0.08, 0.92) * W, H * rand(0.15, 0.45), rand(0.35, 0.55));
      scene.nextBg = now + rand(1400, 2600);
    }
  }

  function drawCrash(now, dt) {
    var r = scene.crashFrom;
    if (!r) return;
    var t = now - scene.crashAt;
    if (t < POP_MS) { // sputters in place
      var flick = Math.random() < 0.45 ? Math.random() * 0.55 : 0;
      if (Math.random() < 0.4) add(parts, { x: r.x, y: r.y + r.L * 0.04, vx: rand(-1, 1) * M * 0.2, vy: M * rand(0.1, 0.3), life: rand(0.2, 0.4), drag: 1.5, g: M * 0.5, c: PAL.orange, s: clamp(M * 0.01, 3, 5), par: 1, tl: 0.03 });
      drawRocket(r.x + rand(-1.5, 1.5), r.y, r.ang + Math.sin(t / 25) * 0.05, r.L, flick, false);
      return;
    }
    if (!scene.popped) { // the weak pop: a puff of grey smoke and a few dull sparks
      scene.popped = true;
      for (var i = 0; i < 7; i++) addSmoke(r.x + rand(-r.L * 0.3, r.L * 0.3), r.y - r.L * rand(0.2, 0.8), r.L * rand(0.25, 0.4), rand(1.3, 2), 1, true);
      for (i = 0; i < 16; i++) { var a = Math.random() * 6.283, v = M * rand(0.1, 0.3); add(parts, { x: r.x, y: r.y - r.L * 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, 0.8), drag: 2.2, g: M * 0.5, c: PAL.red, s: clamp(M * 0.012, 3, 6), par: 1, tl: 0.04 }); }
      flashes.push({ x: r.x, y: r.y - r.L * 0.5, c: PAL.orange, r: r.L * 0.7, born: now, dur: 220, a: 0.6, par: 1 });
    }
    var tt = (t - POP_MS) / 1000;
    if (t > FIZZLE_MS + 300) return;
    var dir = r.ang >= 0 ? 1 : -1;
    var x = r.x + dir * r.L * 0.9 * tt, y = r.y - H * 0.25 * tt + H * 1.2 * tt * tt;
    if (Math.random() < dt * 22) addSmoke(x, y - r.L * 0.4, r.L * 0.16, 0.9, 1, true);
    drawRocket(x, y, r.ang + dir * tt * 7, r.L, 0, true);
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0;
  function themeHex() {
    return '#' + skyCol(0, scene.alt).map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  var multTier = '';
  function frame(now) {
    var dt = scene.lastT ? Math.min(0.1, (now - scene.lastT) / 1000) : 0.016;
    scene.lastT = now;
    if (W && H && layers) {
      // camera + sky follow the multiplier (and glide back to the city for the next round)
      // coming back from a very high round: skip the empty sky above ~2 screens (only stars there)
      if (S.phase !== 'flying' && camTarget() === 0 && scene.cam > H * 2.2) scene.cam = H * 2.2;
      var target = camTarget(), before = scene.cam;
      scene.cam += (target - scene.cam) * Math.min(1, dt * (S.phase === 'flying' ? 8 : 5.5));
      if (Math.abs(target - scene.cam) < 0.5) scene.cam = target;
      var camD = scene.cam - before;
      scene.alt += (climbTarget() - scene.alt) * Math.min(1, dt * (S.phase === 'flying' ? 3 : 1.4));
      scene.light *= Math.exp(-dt * 3.2);

      if ((S.phase === 'betting' || S.phase === 'waiting') && now > scene.nextBg) {
        riser(rand(0.08, 0.92) * W, H * rand(0.12, 0.42), rand(0.35, 0.6));
        scene.nextBg = now + rand(900, 2000);
      }
      if (S.phase === 'betting' && Math.random() < dt * 7) crackle();
      if (S.phase === 'flying' && !scene.launchAt) scene.launchAt = now - LAUNCH_MS * 2; // joined mid-flight

      stepParts(parts, dt, camD);
      stepParts(bgParts, dt, camD);

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      drawSky(now);
      drawHaze(now);
      drawParts(bgParts, 0.8);
      drawCity(now);
      drawFront(now);
      drawSmoke(dt, camD);
      drawFlashes(now);
      if (S.phase === 'flying') flightFx(now, dt);
      drawParts(parts, 1);
      if (S.phase === 'betting' || S.phase === 'waiting' || (S.phase === 'flying' && now - scene.launchAt < LAUNCH_MS + 400) || (S.phase === 'crashed' && scene.cam < H * 0.3)) {
        var lift = scene.cam; // the pad moves away with the ground
        ctx.save();
        ctx.translate(0, lift);
        if (S.phase === 'betting' || S.phase === 'waiting') {
          var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
          var p = S.phase === 'betting' ? clamp((Date.now() - S.bettingStartsAt) / total, 0, 1) : 0;
          drawFuse(now, p, lift);
          var pad = padSpot();
          drawRocket(pad.x, pad.y, 0, rocketLen(), 0, false);
        }
        drawPad();
        ctx.restore();
      }
      if (S.phase === 'flying') {
        var fr = rocketFlight(now);
        drawRocket(fr.x, fr.y, fr.ang, fr.L, 0.75 + 0.25 * fr.k, false);
      } else if (S.phase === 'crashed') drawCrash(now, dt);
      if (!drawnOnce) { drawnOnce = true; maybeReady(); }
    }
    if (now - themeAt > 400) {
      themeAt = now;
      game.theme(themeHex());
      if (loops.roar && loops.roar.osc) loops.roar.osc.frequency.setTargetAtTime(760 + 700 * scene.alt, ax.currentTime, 0.2); // whistle rises with the climb
    }

    // texts over the scene
    var mult = $('mult'), hint = $('hint'), count = $('count'), flew = $('flew');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden) setText(flew, S.crashPhrase);
    if (S.phase === 'flying') {
      var m = game.currentMult(), tier = m >= 10 ? 'mult mult--t3' : m >= 2 ? 'mult mult--t2' : 'mult';
      if (tier !== multTier) { multTier = tier; mult.className = tier; }
      setText(mult, m.toFixed(2) + 'x'); setText(hint, ''); setText(count, '');
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      if (multTier !== 'mult mult--crashed') { multTier = 'mult mult--crashed'; mult.className = multTier; }
      setText(mult, S.crashPoint.toFixed(2) + 'x'); setText(hint, ''); setText(count, '');
    } else if (S.phase === 'betting') {
      setText(mult, '');
      setText(hint, S.bettingPhrase);
      var left = Math.max(0, (S.bettingEndsAt - Date.now()) / 1000);
      setText(count, 'Launch in ' + left.toFixed(1) + 's');
    } else {
      setText(mult, ''); setText(count, '');
      setText(hint, S.gotSnapshot ? 'Waiting for the next round…' : 'Connecting…');
    }
    requestAnimationFrame(frame);
  }

  // ================================================================ controls
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
    [1, 2, 5, 10].forEach(function (k) {
      var v = game.round2(l.min * k);
      if (l.max && v > l.max) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = game.money(v).replace(/\.00$/, '');
      b.onclick = function () { SND.click(); setAmount(p, v); };
      p.quick.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { panels.forEach(function (p) { buildQuick(p); setAmount(p, l.min); }); });

  panels.forEach(function (p) {
    Array.prototype.forEach.call(p.el.querySelectorAll('.stepper__btn'), function (b) {
      b.onclick = function () { SND.click(); setAmount(p, readAmount(p) + Number(b.dataset.step) * game.limit().min); };
    });
    p.amount.oninput = function () { updateButton(p); };
    p.amount.onblur = function () { setAmount(p, readAmount(p) || game.limit().min); };
    p.autoAt.onblur = function () {
      var v = Number(String(p.autoAt.value).replace(',', '.'));
      p.autoAt.value = (isFinite(v) && v >= 1.01 ? v : 2).toFixed(2);
    };
    p.action.onclick = function () {
      SND.click();
      if (S.queued[p.slot]) return game.cancelQueued(p.slot);
      var my = S.my[p.slot];
      if (my && my.round === S.round && my.status === 'placed' && S.phase === 'flying') return game.cashOut(p.slot);
      if (my && my.round === S.round && my.status !== 'lost' && my.status !== 'cashed') return;
      game.bet(p.slot, readAmount(p), readAuto(p));
    };
  });

  $('back').onclick = function () { SND.click(); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); SND.click(); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    savePref('fireworkfever-music', musicOn);
    syncMusic();
  };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      SND.click();
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
  syncMusic();
  window.addEventListener('resize', fit);
  // The results row fills in after load (and the bets list / bar can change size): refit.
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); });
  }
  fit();
  render();
  requestAnimationFrame(frame);
})();
