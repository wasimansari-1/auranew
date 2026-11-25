/* Deep Dive — NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is the look:
 * a little submarine bobbing at a tropical surface while bets are open, the plunge, the dive
 * down a canyon (sunlit reef → twilight zone → midnight zone → glowing abyss → hadal trench),
 * the pressure crack when the round ends, and the bet consoles / bets list.
 * Everything is drawn in code (canvas 2D) and every sound is generated (WebAudio). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0051', onChange: render, onSignal: onSignal });
  var S = game.S;
  var TAU = Math.PI * 2;

  // Animation lengths — the matching sounds are generated with exactly these durations.
  var DIVE_MS = 1400; // plunge from the surface (splash + bubbles)
  var CRASH_MS = 1800; // pressure crack, bubble burst, the sub sinks away
  var SURFACE_MS = 1200; // a fresh sub surfaces for the next round
  var POD_MS = 1600; // cash-out pod rising to the surface

  var announced = false;
  function maybeReady() {
    if (announced || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 10000); // never hang the loader

  function store(k, v) { try { if (v == null) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private mode */ } return null; }

  // ---------------------------------------------------------------- sound (all generated)
  var soundOn = store('deepdive-sound') !== 'off';
  var musicOn = store('deepdive-music') !== 'off';
  var AC = window.AudioContext || window.webkitAudioContext;
  var ac = null, sfx = null, mus = null, echo = null, musEcho = null, musTone = null, noiseBuf = null, hum = null;

  function setupAudio() {
    if (ac || !AC) return;
    try { ac = new AC(); } catch (e) { ac = null; return; }
    var master = ac.createGain();
    master.gain.value = 0.9;
    master.connect(ac.destination);
    sfx = ac.createGain();
    sfx.gain.value = soundOn ? 1 : 0;
    sfx.connect(master);
    mus = ac.createGain();
    mus.gain.value = 0;
    mus.connect(master);
    // sonar echo for pings
    echo = ac.createDelay(1);
    echo.delayTime.value = 0.34;
    var fb = ac.createGain(); fb.gain.value = 0.38;
    var eLp = ac.createBiquadFilter(); eLp.type = 'lowpass'; eLp.frequency.value = 2200;
    echo.connect(eLp); eLp.connect(fb); fb.connect(echo); eLp.connect(sfx);
    // music: soft filter + long echo
    musTone = ac.createBiquadFilter(); musTone.type = 'lowpass'; musTone.frequency.value = 1300;
    musTone.connect(mus);
    musEcho = ac.createDelay(1.5);
    musEcho.delayTime.value = 0.48;
    var mfb = ac.createGain(); mfb.gain.value = 0.4;
    var mLp = ac.createBiquadFilter(); mLp.type = 'lowpass'; mLp.frequency.value = 1800;
    musEcho.connect(mLp); mLp.connect(mfb); mfb.connect(musEcho); mLp.connect(mus);
    // noise
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // engine hum while diving: low saw through a lowpass, chopped by the propeller (LFO)
    var o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 46;
    var o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = 92;
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 190;
    var chop = ac.createGain(); chop.gain.value = 0.6;
    var lfo = ac.createOscillator(); lfo.frequency.value = 6;
    var lfoAmt = ac.createGain(); lfoAmt.gain.value = 0.4;
    lfo.connect(lfoAmt); lfoAmt.connect(chop.gain);
    var hg = ac.createGain(); hg.gain.value = 0;
    o.connect(lp); o2.connect(lp); lp.connect(chop); chop.connect(hg); hg.connect(sfx);
    o.start(); o2.start(); lfo.start();
    hum = { gain: hg, lfo: lfo, on: false, low: lp };
  }
  function resumeAudio() {
    setupAudio();
    if (ac && ac.state === 'suspended') { var p = ac.resume(); if (p && p.catch) p.catch(function () {}); }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, resumeAudio, true); });
  document.addEventListener('visibilitychange', function () {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else resumeAudio();
  });
  function live() { return ac && ac.state === 'running'; }

  function tone(f, t0, dur, type, vol, f2, dest, attack) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    var a = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, type, f1, f2, vol, q, dest) {
    var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f1, t0);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.03, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfx);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }
  function blip(t0, f, vol) { tone(f, t0, 0.07, 'sine', vol, f * 2.4); } // one bubble

  var SFX = {
    click: function (t) { tone(1500, t, 0.06, 'sine', 0.12, 1050); },
    tick: function (t) { tone(900, t, 0.08, 'triangle', 0.08, 700); },
    ping: function (t, depth) { // sonar ping (lower in the deep), with echo
      var f = 1350 * (1 - Math.min(0.4, (depth || 0) * 0.07));
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(sfx); g.connect(echo);
      o.start(t); o.stop(t + 1);
    },
    dive: function (t) { // DIVE_MS: splash, whoosh, bubbles
      var D = DIVE_MS / 1000;
      noise(t, 0.55, 'bandpass', 2400, 380, 0.42, 0.8);
      noise(t + 0.05, D * 0.75, 'lowpass', 900, 160, 0.3, 0.7);
      tone(140, t, 0.5, 'sine', 0.25, 50);
      for (var i = 0; i < 16; i++) blip(t + 0.15 + Math.random() * (D - 0.3), 260 + Math.random() * 520, 0.05 + Math.random() * 0.05);
    },
    crash: function (t) { // CRASH_MS: crack, crack, thump, hull groan, bubble burst, rumble
      var D = CRASH_MS / 1000;
      noise(t, 0.14, 'highpass', 2600, 0, 0.55, 0.7);
      noise(t + 0.17, 0.1, 'highpass', 3400, 0, 0.4, 0.7);
      tone(95, t, 0.6, 'sine', 0.5, 32);
      tone(72, t + 0.08, D * 0.85, 'sawtooth', 0.09, 38, null, 0.08);
      noise(t, D, 'lowpass', 520, 90, 0.3, 0.6);
      for (var i = 0; i < 34; i++) {
        var k = Math.pow(Math.random(), 1.8); // denser at the start
        blip(t + 0.05 + k * (D - 0.15), 200 + Math.random() * 700, 0.04 + Math.random() * 0.06);
      }
    },
    win: function (t) { // cash-out: bright chime + bubbly tail (POD_MS)
      [1047, 1319, 1568, 2093].forEach(function (f, i) {
        tone(f, t + i * 0.08, 0.5, 'triangle', 0.14);
        tone(f * 2, t + i * 0.08, 0.25, 'sine', 0.04);
      });
      for (var i = 0; i < 8; i++) blip(t + 0.35 + i * ((POD_MS / 1000 - 0.45) / 8), 500 + i * 70, 0.04);
    },
    surface: function (t) { // SURFACE_MS: a fresh sub breaks the surface
      var D = SURFACE_MS / 1000;
      for (var i = 0; i < 10; i++) blip(t + Math.random() * D * 0.7, 300 + Math.random() * 400, 0.04);
      noise(t + D * 0.62, D * 0.38, 'bandpass', 1500, 600, 0.2, 0.9);
    },
    error: function (t) { tone(180, t, 0.14, 'square', 0.06); tone(150, t + 0.16, 0.16, 'square', 0.06); },
  };
  function play(name, arg) {
    if (!soundOn || !live() || !SFX[name]) return;
    try { SFX[name](ac.currentTime + 0.01, arg); } catch (e) { /* audio busy */ }
  }
  function setHum(on, rate) {
    if (!hum || !live()) return;
    var t = ac.currentTime;
    if (on !== hum.on) {
      hum.on = on;
      hum.gain.gain.cancelScheduledValues(t);
      hum.gain.gain.setTargetAtTime(on ? 0.11 : 0, t, on ? 0.35 : 0.08);
    }
    if (on && rate) hum.lfo.frequency.setTargetAtTime(rate, t, 0.3);
  }

  // Background music: slow aquatic pads + sparkling plinks, generated (own on/off, saved).
  var CHORDS = [[45, 52, 55, 59, 64], [41, 48, 52, 57, 60], [48, 55, 59, 64, 67], [43, 50, 55, 59, 62]];
  var PLINK = [69, 72, 74, 76, 79, 81, 84, 86];
  var CHORD_S = 6.4;
  var music = { next: 0, idx: 0 };
  function mtof(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function musicVoice(n, t0, dur, vol, type, detune) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = mtof(n); o.detune.value = detune || 0;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 1.8);
    g.gain.setValueAtTime(vol, t0 + dur - 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 1.6);
    o.connect(g); g.connect(musTone);
    o.start(t0); o.stop(t0 + dur + 1.7);
  }
  function musicTick() {
    if (!musicOn || !live() || document.hidden) return;
    var now = ac.currentTime;
    if (music.next < now) music.next = now + 0.1;
    while (music.next < now + 1.2) {
      var t0 = music.next, ch = CHORDS[music.idx % CHORDS.length];
      ch.forEach(function (n, i) {
        musicVoice(n, t0, CHORD_S, i === 0 ? 0.05 : 0.026, 'triangle', -5);
        if (i) musicVoice(n, t0, CHORD_S, 0.018, 'sine', 6);
      });
      musicVoice(ch[0] - 12, t0, CHORD_S, 0.05, 'sine', 0);
      for (var j = 0; j < 8; j++) {
        if (Math.random() < 0.45) continue;
        var n = PLINK[Math.floor(Math.random() * PLINK.length)], tt = t0 + j * (CHORD_S / 8) + Math.random() * 0.08;
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = mtof(n);
        g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.045, tt + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.4);
        o.connect(g); g.connect(mus); g.connect(musEcho);
        o.start(tt); o.stop(tt + 1.5);
      }
      music.next += CHORD_S;
      music.idx++;
    }
  }
  setInterval(musicTick, 300);
  function syncMusic() {
    if (mus && ac) {
      mus.gain.cancelScheduledValues(ac.currentTime);
      mus.gain.setTargetAtTime(musicOn ? 0.55 : 0, ac.currentTime, 0.4);
      if (musicOn) music.next = 0;
    }
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  function setSound(on) {
    soundOn = on;
    store('deepdive-sound', on ? 'on' : 'off');
    if (sfx && ac) { sfx.gain.cancelScheduledValues(ac.currentTime); sfx.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.05); }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  }

  // ---------------------------------------------------------------- engine moments
  var scene = {
    diveAt: 0, crashAt: 0, crashFrom: null, surfaceAt: 0, lastT: 0, P: 0, lastP: 0, lastPing: 0,
    crashCol: [4, 20, 50], cracks: null, glass: null, lastSecs: -1,
  };
  var bubbles = [], pods = [], seenCash = {};
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') { scene.diveAt = now; scene.crashAt = 0; play('dive'); burst(subPose(now), 26, 1); }
    if (name === 'crash') {
      scene.crashAt = now;
      scene.crashFrom = subPose(now - 1, 'flying'); // where the sub was when the hull gave way
      makeCracks();
      setHum(false);
      play('crash');
    }
    if (name === 'betting') {
      scene.surfaceAt = scene.crashAt ? now : 0;
      scene.diveAt = 0; scene.crashAt = 0; scene.crashFrom = null;
      pods.length = 0; seenCash = {};
      play('ping', 0);
      if (scene.surfaceAt) setTimeout(function () { play('surface'); }, 60);
    }
    if (name === 'win') {
      play('win');
      toast(d.text, 'win');
      if (S.phase === 'flying') addPod(true, '+' + game.money(d.win));
    }
    if (name === 'error') { play('error'); toast(d.text, 'error'); }
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

  // ---------------------------------------------------------------- avatars: little sea creatures
  var AV_KINDS = 8, AV_TINTS = [[38, 160, 200], [255, 140, 70], [150, 100, 240], [40, 190, 140]];
  var avatarCache = {};
  function nameHash(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h;
  }
  function avatarURL(name) {
    var k = nameHash(name) % (AV_KINDS * AV_TINTS.length);
    if (avatarCache[k]) return avatarCache[k];
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var tint = AV_TINTS[Math.floor(k / AV_KINDS)], kind = k % AV_KINDS;
    var bg = g.createRadialGradient(24, 18, 4, 32, 32, 40);
    bg.addColorStop(0, 'rgb(' + tint.map(function (v) { return Math.min(255, v + 60); }).join(',') + ')');
    bg.addColorStop(1, 'rgb(' + tint.map(function (v) { return Math.round(v * 0.45); }).join(',') + ')');
    g.fillStyle = bg; g.beginPath(); g.arc(32, 32, 32, 0, TAU); g.fill();
    var eye = function (x, y, r) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.fillStyle = '#0b1b2b'; g.beginPath(); g.arc(x + r * 0.2, y + r * 0.1, r * 0.55, 0, TAU); g.fill(); };
    var cols = ['#ffd23f', '#ff7aa2', '#ff6b3d', '#ffe08a', '#c8f7ff', '#5fd48a', '#8fd0ff', '#ffb347'];
    g.fillStyle = cols[kind];
    if (kind === 0) { // fish
      g.beginPath(); g.moveTo(14, 32); g.lineTo(6, 22); g.lineTo(6, 42); g.fill();
      g.beginPath(); g.ellipse(32, 32, 19, 13, 0, 0, TAU); g.fill();
      g.fillStyle = '#2a7bd6'; g.fillRect(24, 20, 5, 24); eye(40, 29, 4.5);
    } else if (kind === 1) { // octopus
      g.beginPath(); g.arc(32, 28, 15, Math.PI, 0); g.lineTo(47, 36); g.lineTo(17, 36); g.fill();
      for (var i = 0; i < 5; i++) { g.beginPath(); g.ellipse(19 + i * 6.5, 42, 3, 9, 0, 0, TAU); g.fill(); }
      eye(26, 29, 4); eye(38, 29, 4);
    } else if (kind === 2) { // crab
      g.beginPath(); g.ellipse(32, 36, 17, 11, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(13, 22, 6, 0, TAU); g.arc(51, 22, 6, 0, TAU); g.fill();
      g.fillRect(25, 21, 3, 9); g.fillRect(36, 21, 3, 9); eye(26.5, 21, 3.6); eye(37.5, 21, 3.6);
    } else if (kind === 3) { // puffer
      for (var j = 0; j < 12; j++) { var a = j / 12 * TAU; g.beginPath(); g.moveTo(32 + Math.cos(a) * 14, 32 + Math.sin(a) * 14); g.lineTo(32 + Math.cos(a + 0.13) * 21, 32 + Math.sin(a + 0.13) * 21); g.lineTo(32 + Math.cos(a + 0.26) * 14, 32 + Math.sin(a + 0.26) * 14); g.fill(); }
      g.beginPath(); g.arc(32, 32, 16, 0, TAU); g.fill(); eye(26, 28, 4); eye(38, 28, 4);
    } else if (kind === 4) { // jelly
      g.globalAlpha = 0.9; g.beginPath(); g.arc(32, 30, 15, Math.PI, 0); g.quadraticCurveTo(32, 40, 17, 30); g.fill();
      g.strokeStyle = cols[kind]; g.lineWidth = 2.4;
      for (var t = 0; t < 4; t++) { g.beginPath(); g.moveTo(22 + t * 6.5, 34); g.quadraticCurveTo(18 + t * 6.5, 44, 23 + t * 6.5, 54); g.stroke(); }
      g.globalAlpha = 1; eye(27, 26, 3.4); eye(37, 26, 3.4);
    } else if (kind === 5) { // turtle
      g.beginPath(); g.ellipse(48, 30, 7, 6, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(20, 44, 7, 4, 0.5, 0, TAU); g.ellipse(40, 46, 7, 4, -0.5, 0, TAU); g.fill();
      g.fillStyle = '#2f7a45'; g.beginPath(); g.ellipse(30, 34, 17, 12, 0, 0, TAU); g.fill();
      g.strokeStyle = '#8fdca0'; g.lineWidth = 1.6; g.beginPath(); g.arc(30, 34, 6, 0, TAU); g.stroke(); eye(50, 28, 2.6);
    } else if (kind === 6) { // whale
      g.beginPath(); g.ellipse(30, 36, 20, 13, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(10, 34); g.lineTo(4, 24); g.lineTo(14, 30); g.fill();
      g.fillStyle = '#e6f8ff'; g.beginPath(); g.ellipse(32, 44, 13, 4, 0, 0, Math.PI); g.fill();
      g.strokeStyle = '#c8f7ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(34, 22); g.quadraticCurveTo(31, 14, 26, 12); g.moveTo(34, 22); g.quadraticCurveTo(37, 14, 42, 12); g.stroke(); eye(42, 33, 3.2);
    } else { // starfish
      g.beginPath();
      for (var p = 0; p < 10; p++) { var r = p % 2 ? 9 : 22, an = -Math.PI / 2 + p * Math.PI / 5; g.lineTo(32 + Math.cos(an) * r, 34 + Math.sin(an) * r); }
      g.closePath(); g.fill(); eye(28, 32, 3.2); eye(36, 32, 3.2);
    }
    return (avatarCache[k] = c.toDataURL());
  }
  function avatarEl(name) {
    var img = document.createElement('img');
    img.className = 'avatar';
    img.alt = '';
    img.src = avatarURL(name);
    return img;
  }

  // ---------------------------------------------------------------- DOM render
  var tab = 'all';
  var playersStrip; // players in this round, on the scene (../_core/players.js), with our creature faces
  var historyKey = '', listKey = '';

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: avatarEl });
    playersStrip.update(S);
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot;
    setText($('balance'), S.balance == null ? '—' : game.money(S.balance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    var hk = S.history.join(',');
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

    // other players' cash-outs float up from the sub as little glowing pearls
    if (S.phase === 'flying') {
      S.bets.forEach(function (b) {
        var key = S.round + ':' + b.player + ':' + b.slot;
        if (b.x && !b.mine && !seenCash[key]) { seenCash[key] = true; addPod(false, ''); }
      });
    }

    updateButtons();
    renderList();

    setText($('fRound'), String(S.round || '—'));
    setText($('fHash'), S.hash || '—');
    setText($('fSeed'), S.seed || 'revealed when the round ends');
  }

  // ---- bet consoles (slot 0 and 1): built once, only texts / classes change -----------
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="panel__inner">' +
      '<span class="panel__tag" aria-hidden="true">Ballast ' + (slot + 1) + '</span>' +
      '<div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<input class="amount" inputmode="decimal" value="0.10" aria-label="Bet amount">' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<button type="button" class="action"><span class="action__bubbles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' +
      '<span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      '<div class="auto"><span>Auto Cash Out</span>' +
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
    if (p.action.classList.contains('action--burst')) cls += ' action--burst';
    if (p.action.className !== cls) p.action.className = cls;
    if (p.action.disabled !== disabled) p.action.disabled = disabled;
    setText(p.label, label);
    setText(p.sub, sub);
  }
  function bubbleBurst(p) {
    p.action.classList.remove('action--burst');
    void p.action.offsetWidth;
    p.action.classList.add('action--burst');
    clearTimeout(p.burstTimer);
    p.burstTimer = setTimeout(function () { p.action.classList.remove('action--burst'); }, 900);
  }

  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }
  function setCols(a) {
    var cols = $('cols');
    if (cols.dataset.k === a[0]) return;
    cols.dataset.k = a[0];
    cols.innerHTML = '';
    a.forEach(function (t) { cols.appendChild(cell(t)); });
  }

  function renderList() {
    var key = tab + '|' + (tab === 'all'
      ? S.bets.map(function (b) { return b.player + b.slot + ':' + b.amount + ':' + b.x + ':' + (b.mine ? 1 : 0); }).join(',')
      : S.myBets.length + ':' + (S.myBets[0] ? S.myBets[0].at : 0));
    if (key === listKey) return;
    listKey = key;
    var list = $('list');
    list.innerHTML = '';
    if (tab === 'all') {
      setText($('countLabel'), 'All bets');
      setText($('betCount'), String(S.bets.length));
      setCols(['User', 'Bet', 'X', 'Cash out']);
      if (!S.bets.length) list.appendChild(cell('No bets yet this round.', 'empty'));
      S.bets.slice().reverse().forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--cashed' : '') + (b.mine ? ' row--mine' : '');
        var user = document.createElement('span');
        user.className = 'row__user';
        user.appendChild(avatarEl(b.player));
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
      setCols(['Time', 'Bet', 'X', 'Cash out']);
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
  // Play area: W×H, offset LEFT/TOP inside the full scene (FULL_W×FULL_H). The world is drawn
  // from -LEFT/-TOP so it fills under the bar, behind the bets list and below the play area.
  var W = 0, H = 0, TOP = 0, LEFT = 0, FULL_W = 0, FULL_H = 0, SU = 1, drawn = false;

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
    // The multiplier / round texts sit on the play area (not the whole scene), in its upper
    // part so the sub below stays in view.
    var centre = document.querySelector('.stage__center').style;
    centre.left = LEFT + 'px'; centre.top = TOP + 'px'; centre.width = W + 'px'; centre.height = H + 'px';
    centre.paddingBottom = Math.round(H * 0.24) + 'px';
    SU = Math.max(0.6, Math.min(1.7, Math.min(W, H * 1.4) / 520));
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a player joins the round).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (drawn) draw(performance.now()); // resizing clears the canvas: paint it again at once
  }

  // ---- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function easeIO(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function mixC(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function rgb(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
  function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  function toHex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join(''); }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU); }

  // ---- depth: the camera descends with the multiplier
  // metres: 1x the surface, 2x 120 m, 10x 1 080 m, 50x 5 880 m, 93x ≈ 11 000 m (the trench).
  function metres(mult) { return Math.max(0, (mult - 1) * 120); }
  var KP = 4.2, AP = 0.3; // world depth in px from ln(multiplier): grows a bit faster than linear
  function depthPx(z) { return H * KP * (z + AP * z * z); }
  function zFromPx(p) { p = Math.max(0, p) / (H * KP); return (-1 + Math.sqrt(1 + 4 * AP * p)) / (2 * AP); }
  function metresAtPx(p) { return metres(Math.exp(zFromPx(p))); }
  var WATER = [ // metres, top colour, bottom colour (blended on a log scale: no visible steps)
    [0, [56, 186, 214], [16, 116, 164]],
    [150, [28, 136, 182], [10, 80, 132]],
    [400, [16, 82, 140], [8, 44, 96]],
    [1000, [10, 44, 100], [4, 22, 60]],
    [2500, [7, 24, 70], [2, 10, 38]],
    [5000, [6, 13, 46], [2, 5, 18]],
    [9000, [16, 9, 54], [4, 2, 20]],
  ];
  function waterAt(m, i) {
    var lm = Math.log(1 + Math.max(0, m));
    for (var k = 0; k < WATER.length - 1; k++) {
      var a = Math.log(1 + WATER[k][0]), b = Math.log(1 + WATER[k + 1][0]);
      if (lm <= b) return mixC(WATER[k][i + 1], WATER[k + 1][i + 1], clamp((lm - a) / (b - a), 0, 1));
    }
    return WATER[WATER.length - 1][i + 1];
  }
  var ZONES = [[0, 'Sunlit reef'], [200, 'Twilight zone'], [1000, 'Midnight zone'], [4000, 'The abyss'], [6000, 'Hadal trench']];
  function zoneName(m) { var z = ZONES[0][1]; ZONES.forEach(function (x) { if (m >= x[0]) z = x[1]; }); return z; }
  function darkness(m) { return clamp((Math.log(1 + m) - Math.log(201)) / (Math.log(3001) - Math.log(201)), 0, 1); }

  var SKY_TOP = [38, 128, 192], SKY_LOW = [168, 228, 242];
  function WL() { return H * 0.67; } // where the surface is (screen y) with the camera at the top

  function camTarget(now) {
    if (S.phase === 'flying') {
      var t = scene.diveAt ? now - scene.diveAt : DIVE_MS;
      return depthPx(Math.log(Math.max(1, game.currentMult()))) + H * 0.5 * easeIO(t / DIVE_MS);
    }
    if (S.phase === 'crashed') return depthPx(Math.log(Math.max(1, S.crashPoint || 1))) + H * 0.5;
    return 0;
  }

  // ---- the sub: where it is and how it sits
  function subScale() { return Math.min(W * 0.38, H * 0.5, 330) / 240; }
  function subPose(now, phase) {
    var s = subScale(), wl = WL();
    var float = { x: W * 0.5, y: wl - 8 * s + Math.sin(now / 700) * 3 * s, s: s, tilt: Math.sin(now / 900) * 0.04 };
    if ((phase || S.phase) !== 'flying') {
      if (scene.surfaceAt && now - scene.surfaceAt < SURFACE_MS) { // rising up to the surface
        var k = easeIO((now - scene.surfaceAt) / SURFACE_MS);
        float.y += (1 - k) * H * 0.55;
        float.tilt -= (1 - k) * 0.25;
      }
      return float;
    }
    var cy = H * 0.72;
    var cruise = { x: W * 0.47 + Math.sin(now / 1700) * W * 0.02, y: cy + Math.sin(now / 600) * H * 0.012, s: s, tilt: 0.16 + Math.sin(now / 800) * 0.03 };
    var t = scene.diveAt ? now - scene.diveAt : DIVE_MS;
    if (t >= DIVE_MS) return cruise;
    var k2 = t / DIVE_MS, e = easeIO(k2);
    return {
      x: lerp(float.x, cruise.x, e), y: lerp(float.y, cruise.y, e), s: s,
      tilt: lerp(0, cruise.tilt, e) + 0.34 * Math.sin(Math.PI * clamp(k2 * 1.15, 0, 1)),
    };
  }

  // ---- particles
  function burst(pose, n, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, d = Math.random() * 60 * pose.s;
      bubbles.push({
        x: pose.x + Math.cos(a) * d * 1.5, y: pose.y + Math.sin(a) * d * 0.7,
        r: (1.5 + Math.random() * 6) * SU * (0.6 + power * 0.5), vy: (40 + Math.random() * 120) * SU * power,
        vx: (Math.random() - 0.5) * 60 * SU * power, ph: Math.random() * TAU, life: 1600 + Math.random() * 1600, age: 0,
      });
    }
  }
  function trail(pose, dt) { // small bubbles from the propeller while diving
    scene.trailAcc = (scene.trailAcc || 0) + dt;
    while (scene.trailAcc > 55) {
      scene.trailAcc -= 55;
      var c = Math.cos(pose.tilt), s = Math.sin(pose.tilt), lx = -128 * pose.s, ly = (Math.random() - 0.5) * 22 * pose.s;
      bubbles.push({ x: pose.x + lx * c - ly * s, y: pose.y + lx * s + ly * c, r: (1 + Math.random() * 3) * SU, vy: (30 + Math.random() * 40) * SU, vx: -20 * SU, ph: Math.random() * TAU, life: 1500 + Math.random() * 900, age: 0 });
    }
  }
  function updateBubbles(dt, dP) {
    for (var i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i];
      b.age += dt;
      b.y -= b.vy * dt / 1000 + dP;
      b.x += (b.vx * dt / 1000) + Math.sin(b.age / 160 + b.ph) * 0.35 * SU;
      b.vx *= 0.985;
      if (b.age > b.life || b.y < -TOP - 30) bubbles.splice(i, 1);
    }
    if (bubbles.length > 260) bubbles.splice(0, bubbles.length - 260);
  }
  function drawBubbles() {
    ctx.lineWidth = Math.max(1, SU);
    bubbles.forEach(function (b) {
      var a = clamp(1 - b.age / b.life, 0, 1) * 0.85;
      circle(b.x, b.y, b.r);
      ctx.fillStyle = 'rgba(200, 245, 255, ' + (a * 0.18).toFixed(3) + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(220, 250, 255, ' + (a * 0.8).toFixed(3) + ')';
      ctx.stroke();
      if (b.r > 2.5) { circle(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28); ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'; ctx.fill(); }
    });
  }
  function addPod(mine, label) {
    var now = performance.now(), p = subPose(now);
    if (!mine && pods.filter(function (x) { return !x.mine; }).length > 10) return;
    pods.push({ x: p.x + (mine ? 0 : (Math.random() - 0.5) * 80 * p.s), y: p.y - 70 * p.s, t0: now, mine: mine, label: label, drift: (Math.random() - 0.5) * 40 * SU, s: p.s });
  }

  // ---- the world --------------------------------------------------------------------
  var glows = []; // things that shine in the dark: drawn after the darkness, additively
  var snow = [];
  for (var si = 0; si < 80; si++) snow.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6, v: 0.4 + Math.random() * 0.8 });
  var clouds = [];
  for (var ci = 0; ci < 6; ci++) clouds.push({ x: Math.random(), y: 0.08 + Math.random() * 0.4, s: 0.6 + Math.random() * 0.8, v: 0.4 + Math.random() * 0.8 });

  function wallEdge(side, p, far) { // inner edge x of a canyon wall at world depth p
    var y = p / H, o = side * 1.7 + far * 4.1;
    var n = 0.5 + 0.28 * Math.sin(y * 1.6 + o) + 0.14 * Math.sin(y * 4.1 + o * 1.9) + 0.07 * Math.sin(y * 10.3 + o * 3.3);
    var deep = clamp(zFromPx(p) / 3, 0, 1); // the canyon narrows a little as it gets deeper
    var e = ((far ? 0.15 : 0.05) + (far ? 0.14 : 0.11) * n + deep * 0.05) * W;
    return side < 0 ? e : W - e;
  }
  function drawWall(side, far, P, mid) {
    var par = far ? 0.55 : 1, wl = WL(), step = 10;
    var p0 = H * (far ? 0.02 : 0.1); // walls start just below the surface
    var yTop = Math.max(-TOP, wl - P * par + p0), yBot = FULL_H - TOP + 4;
    if (yTop >= yBot) return;
    var dk = darkness(mid);
    var base = waterAt(mid, 1);
    var col = far ? mixC(base, [2, 10, 24], 0.32) : mixC(base, [2, 8, 18], 0.62 + dk * 0.25);
    var outer = side < 0 ? -LEFT - 4 : W + 4;
    ctx.beginPath();
    ctx.moveTo(outer, yTop);
    for (var y = yTop; y <= yBot + step; y += step) {
      var p = y - wl + P * par, ramp = Math.sqrt(clamp((p - p0) / (H * 0.12), 0, 1));
      var e = wallEdge(side, p, far ? 1 : 0);
      ctx.lineTo(outer + (e - outer) * ramp, y);
    }
    ctx.lineTo(outer, yBot + step);
    ctx.closePath();
    var g = ctx.createLinearGradient(outer, 0, side < 0 ? W * 0.32 : W * 0.68, 0);
    g.addColorStop(0, rgb(mixC(col, [0, 0, 0], 0.35)));
    g.addColorStop(1, rgb(col));
    ctx.fillStyle = g;
    ctx.fill();
    if (!far) { // sunlit rim on the inner edge (fades in the dark)
      ctx.strokeStyle = rgba(mixC(waterAt(mid, 0), [255, 255, 255], 0.25), 0.35 * (1 - dk));
      ctx.lineWidth = 2 * SU;
      ctx.stroke();
    }
  }

  // decorations growing on the near walls — what grows depends on how deep it is
  var CORALS = [[255, 111, 145], [255, 159, 67], [197, 108, 240], [255, 209, 102], [78, 205, 196], [255, 92, 92]];
  function coral(x, y, dir, s, col, seed, now) {
    ctx.strokeStyle = rgb(col);
    ctx.fillStyle = rgb(mixC(col, [255, 255, 255], 0.3));
    ctx.lineCap = 'round';
    function branch(bx, by, ang, len, d, id) {
      var sway = Math.sin(now / 1500 + seed + d) * 0.06;
      var ex = bx + Math.cos(ang + sway) * len, ey = by + Math.sin(ang + sway) * len;
      ctx.lineWidth = Math.max(1, (4 - d) * 2.2 * s);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
      if (d >= 3) { circle(ex, ey, 2.6 * s); ctx.fill(); return; }
      var n = 2 + (hash(seed + id * 3.1) > 0.6 ? 1 : 0);
      for (var i = 0; i < n; i++) branch(ex, ey, ang + (i - (n - 1) / 2) * 0.62 + (hash(seed + id + i) - 0.5) * 0.3, len * 0.72, d + 1, id * 4 + i + 1);
    }
    branch(x, y, dir > 0 ? -0.75 : -Math.PI + 0.75, 26 * s, 0, 1);
  }
  function fan(x, y, dir, s, col, now, seed) {
    ctx.strokeStyle = rgba(col, 0.9);
    ctx.lineWidth = Math.max(1, 1.4 * s);
    var base = dir > 0 ? -0.9 : -Math.PI + 0.9, sway = Math.sin(now / 1800 + seed) * 0.05;
    for (var i = 0; i < 9; i++) {
      var a = base + (i - 4) * 0.17 + sway, l = (40 + hash(seed + i) * 14) * s;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a - 0.1) * l * 0.6, y + Math.sin(a - 0.1) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    for (var r = 1; r <= 3; r++) {
      ctx.beginPath(); ctx.arc(x, y, r * 13 * s, base - 0.75 + sway, base + 0.75 + sway); ctx.stroke();
    }
  }
  function anemone(x, y, dir, s, col, now, seed, glow) {
    var up = dir > 0 ? -0.6 : -Math.PI + 0.6;
    ctx.fillStyle = rgb(mixC(col, [0, 0, 0], 0.35));
    circle(x, y, 7 * s); ctx.fill();
    ctx.strokeStyle = rgb(col); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, 2.4 * s);
    var tips = [];
    for (var i = 0; i < 9; i++) {
      var a = up + (i - 4) * 0.28, w = Math.sin(now / 600 + seed + i * 0.7) * 0.25, l = 22 * s;
      var ex = x + Math.cos(a + w) * l, ey = y + Math.sin(a + w) * l;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 5 * s, y + Math.sin(a) * 5 * s);
      ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.6, y + Math.sin(a) * l * 0.6, ex, ey); ctx.stroke();
      tips.push([ex, ey]);
    }
    ctx.fillStyle = rgb(mixC(col, [255, 255, 255], 0.45));
    tips.forEach(function (t) { circle(t[0], t[1], 2.2 * s); ctx.fill(); });
    if (glow) glows.push(function () {
      var pulse = 0.6 + 0.4 * Math.sin(now / 700 + seed);
      tips.forEach(function (t) {
        var g = ctx.createRadialGradient(t[0], t[1], 0, t[0], t[1], 9 * s);
        g.addColorStop(0, rgba(col, 0.9 * pulse)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(t[0] - 9 * s, t[1] - 9 * s, 18 * s, 18 * s);
      });
    });
  }
  function sponge(x, y, dir, s, seed) {
    var col = [150, 128, 96];
    for (var i = 0; i < 3; i++) {
      var h = (18 + hash(seed + i) * 22) * s, w = 8 * s, bx = x + dir * (i * 9 - 2) * s;
      ctx.fillStyle = rgb(mixC(col, [40, 40, 60], i * 0.2));
      ctx.beginPath();
      ctx.moveTo(bx - w / 2, y); ctx.lineTo(bx - w * 0.62, y - h); ctx.lineTo(bx + w * 0.62, y - h); ctx.lineTo(bx + w / 2, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(20, 16, 24, 0.6)';
      ctx.beginPath(); ctx.ellipse(bx, y - h, w * 0.55, w * 0.22, 0, 0, TAU); ctx.fill();
    }
  }
  function crinoid(x, y, dir, s, now, seed) {
    ctx.strokeStyle = 'rgba(230, 200, 150, 0.85)'; ctx.lineWidth = Math.max(1, 1.2 * s); ctx.lineCap = 'round';
    var up = dir > 0 ? -0.8 : -Math.PI + 0.8;
    var sx = x + Math.cos(up) * 14 * s, sy = y + Math.sin(up) * 14 * s;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sx, sy); ctx.stroke();
    for (var i = 0; i < 6; i++) {
      var a = up + (i - 2.5) * 0.45 + Math.sin(now / 900 + seed + i) * 0.12, l = 20 * s;
      var ex = sx + Math.cos(a) * l, ey = sy + Math.sin(a) * l;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + Math.cos(a + 0.5) * l * 0.6, sy + Math.sin(a + 0.5) * l * 0.6, ex, ey); ctx.stroke();
      for (var k = 1; k < 5; k++) {
        var px = lerp(sx, ex, k / 5), py = lerp(sy, ey, k / 5);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a + 1.4) * 4 * s, py + Math.sin(a + 1.4) * 4 * s); ctx.stroke();
      }
    }
  }
  function vent(x, y, dir, s, now, seed) { // hydrothermal chimney with tube worms
    var cx = x + dir * 10 * s, h = 46 * s;
    ctx.fillStyle = '#1a1420';
    ctx.beginPath(); ctx.moveTo(cx - 12 * s, y + 8 * s); ctx.lineTo(cx - 5 * s, y - h); ctx.lineTo(cx + 5 * s, y - h); ctx.lineTo(cx + 12 * s, y + 8 * s); ctx.closePath(); ctx.fill();
    for (var i = 0; i < 9; i++) { // smoke
      var k = ((now / 2600 + i / 9 + seed) % 1);
      ctx.fillStyle = 'rgba(40, 34, 52, ' + (0.55 * (1 - k)).toFixed(3) + ')';
      circle(cx + Math.sin(k * 6 + seed + i) * 6 * s, y - h - k * 70 * s, (5 + k * 14) * s); ctx.fill();
    }
    for (var w = 0; w < 5; w++) { // tube worms
      var wx = cx + dir * (16 + w * 5) * s, wh = (12 + hash(seed + w) * 14) * s;
      ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 2.4 * s;
      ctx.beginPath(); ctx.moveTo(wx, y + 4 * s); ctx.lineTo(wx + Math.sin(now / 900 + w) * 2 * s, y - wh); ctx.stroke();
      ctx.fillStyle = '#e8343a'; circle(wx + Math.sin(now / 900 + w) * 2 * s, y - wh, 3 * s); ctx.fill();
    }
    glows.push(function () {
      var g = ctx.createRadialGradient(cx, y - h, 0, cx, y - h, 26 * s);
      var f = 0.7 + 0.3 * Math.sin(now / 230 + seed);
      g.addColorStop(0, 'rgba(255, 140, 60, ' + (0.8 * f).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255, 80, 30, 0)');
      ctx.fillStyle = g; ctx.fillRect(cx - 26 * s, y - h - 26 * s, 52 * s, 52 * s);
    });
  }
  function glowSpots(x, y, s, now, seed, col) {
    glows.push(function () {
      for (var i = 0; i < 6; i++) {
        var a = hash(seed + i * 1.7) * TAU, d = hash(seed + i * 2.3) * 22 * s;
        var px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, f = 0.5 + 0.5 * Math.sin(now / 400 + seed * 3 + i);
        var g = ctx.createRadialGradient(px, py, 0, px, py, 6 * s);
        g.addColorStop(0, rgba(col, 0.9 * f)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(px - 6 * s, py - 6 * s, 12 * s, 12 * s);
      }
    });
  }
  function drawDecor(P, now) {
    var wl = WL(), sp = H * 0.2, s = SU;
    var pMin = -TOP - wl + P - sp, pMax = FULL_H - TOP - wl + P + sp;
    for (var i = Math.max(1, Math.floor(pMin / sp)); i <= Math.ceil(pMax / sp); i++) {
      [-1, 1].forEach(function (side) {
        var seed = i * 7.3 + side * 3.1, pd = i * sp + hash(seed) * sp * 0.6;
        if (pd < H * 0.24) return; // the wall's rounded top is just above
        var m = metresAtPx(pd), y = wl + pd - P, x = wallEdge(side, pd, 0) - side * 2 * s;
        var dir = -side, r = hash(seed + 9);
        if (m < 220) {
          var col = CORALS[Math.floor(hash(seed + 2) * CORALS.length)];
          if (r < 0.45) coral(x, y, dir, s, col, seed, now);
          else if (r < 0.7) fan(x, y, dir, s, col, now, seed);
          else anemone(x, y, dir, s, col, now, seed, false);
        } else if (m < 1100) {
          if (r < 0.4) sponge(x, y, dir, s, seed);
          else if (r < 0.75) crinoid(x, y, dir, s, now, seed);
          else anemone(x, y, dir, s, [200, 120, 160], now, seed, false);
        } else if (m < 3500) {
          if (r < 0.5) anemone(x, y, dir, s, r < 0.25 ? [80, 240, 255] : [255, 90, 220], now, seed, true);
          else glowSpots(x + dir * 8 * s, y, s, now, seed, [120, 255, 230]);
        } else {
          if (r < 0.45) vent(x, y, dir, s, now, seed);
          else if (r < 0.75) anemone(x, y, dir, s, [170, 120, 255], now, seed, true);
          else glowSpots(x + dir * 8 * s, y, s, now, seed, [255, 120, 200]);
        }
      });
    }
  }

  // free swimmers in the canyon — sunlit fish → jellies & squid → anglers & glowing chains
  function fish(x, y, len, dir, body, stripe, now, ph) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
    var w = Math.sin(now / 110 + ph) * 0.3;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(-len * 0.4, 0); ctx.lineTo(-len * 0.78, (-0.3 + w * 0.3) * len); ctx.lineTo(-len * 0.78, (0.3 + w * 0.3) * len); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, len * 0.5, len * 0.27, 0, 0, TAU); ctx.fill();
    if (stripe) { ctx.fillStyle = stripe; ctx.beginPath(); ctx.ellipse(-len * 0.06, 0, len * 0.07, len * 0.24, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#fff'; circle(len * 0.27, -len * 0.05, len * 0.075); ctx.fill();
    ctx.fillStyle = '#071526'; circle(len * 0.29, -len * 0.05, len * 0.04); ctx.fill();
    ctx.restore();
  }
  function school(x, y, dir, s, now, seed, deep) {
    var cols = deep ? [['#2a3346', null]] : [['#ffd23f', '#2a7bd6'], ['#ff8c42', '#fff'], ['#4fd1ff', '#173a7a']];
    var c = cols[Math.floor(hash(seed) * cols.length)];
    for (var i = 0; i < 9; i++) {
      var fx = x + (hash(seed + i) - 0.5) * 90 * s + Math.sin(now / 900 + i) * 6 * s, fy = y + (hash(seed + i * 2) - 0.5) * 50 * s + Math.cos(now / 700 + i) * 4 * s;
      fish(fx, fy, (deep ? 11 : 14) * s, dir, c[0], c[1], now, seed + i);
      if (deep) glows.push((function (gx, gy) { return function () { // lantern fish: rows of light dots
        ctx.fillStyle = 'rgba(140, 240, 255, 0.9)';
        for (var k = 0; k < 3; k++) { circle(gx - dir * k * 3 * s, gy + 2 * s, 1.1 * s); ctx.fill(); }
      }; })(fx, fy));
    }
  }
  function turtle(x, y, dir, s, now) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s);
    var f = Math.sin(now / 420);
    ctx.fillStyle = '#4f8f5a';
    ctx.save(); ctx.translate(12, 10); ctx.rotate(0.5 + f * 0.4); ctx.beginPath(); ctx.ellipse(10, 0, 14, 5, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(-14, 10); ctx.rotate(-0.3 - f * 0.3); ctx.beginPath(); ctx.ellipse(-6, 0, 9, 4, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.ellipse(32, -2, 9, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2e6b3e'; ctx.beginPath(); ctx.ellipse(0, 0, 26, 15, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#94d6a2'; ctx.lineWidth = 1.5;
    [[-9, -3], [3, -5], [13, 0], [-3, 6]].forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, TAU); ctx.stroke(); });
    ctx.fillStyle = '#071526'; circle(36, -4, 1.8); ctx.fill();
    ctx.restore();
  }
  function jelly(x, y, r, col, now, ph, glow) {
    var pulse = 0.5 + 0.5 * Math.sin(now / 520 + ph), rw = r * (1 + 0.14 * pulse), rh = r * (0.85 - 0.15 * pulse);
    y += Math.sin(now / 520 + ph - 1.2) * r * 0.25;
    ctx.strokeStyle = rgba(col, glow ? 0.55 : 0.5); ctx.lineWidth = Math.max(1, r * 0.06);
    for (var i = 0; i < 6; i++) {
      var tx = x - rw * 0.7 + i * rw * 0.28;
      ctx.beginPath(); ctx.moveTo(tx, y);
      for (var k = 1; k <= 7; k++) ctx.lineTo(tx + Math.sin(now / 380 + ph + i + k * 0.8) * r * 0.16, y + k * r * 0.34);
      ctx.stroke();
    }
    var g = ctx.createRadialGradient(x, y - rh * 0.5, r * 0.1, x, y - rh * 0.3, rw);
    g.addColorStop(0, rgba(mixC(col, [255, 255, 255], 0.5), 0.9)); g.addColorStop(1, rgba(col, 0.35));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, Math.PI, TAU);
    for (var j = 0; j <= 6; j++) ctx.lineTo(x + rw - j * rw / 3, y + (j % 2 ? rh * 0.18 : 0));
    ctx.closePath(); ctx.fill();
    if (glow) glows.push(function () {
      var gg = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      gg.addColorStop(0, rgba(col, 0.45 + 0.3 * pulse)); gg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = gg; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    });
  }
  function squid(x, y, dir, s, now, ph) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s); ctx.rotate(-0.15);
    var jet = Math.sin(now / 600 + ph);
    ctx.strokeStyle = 'rgba(220, 120, 110, 0.7)'; ctx.lineWidth = 1.6;
    for (var i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-14, -3 + i * 1.2); ctx.quadraticCurveTo(-30, -6 + i * 2 + jet * 3, -44 - i * 2, -4 + i * 2.4 + jet * 4); ctx.stroke(); }
    ctx.fillStyle = 'rgba(214, 100, 92, 0.85)';
    ctx.beginPath(); ctx.moveTo(-14, -7); ctx.quadraticCurveTo(14, -10, 34, 0); ctx.quadraticCurveTo(14, 10, -14, 7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(26, -3); ctx.lineTo(38, -10); ctx.lineTo(34, 0); ctx.lineTo(38, 10); ctx.lineTo(26, 3); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; circle(-8, -1.5, 2.6); ctx.fill();
    ctx.restore();
  }
  function angler(x, y, sz, dir, now, ph) {
    var sway = Math.sin(now / 700 + ph) * sz * 0.12;
    var bx = x + dir * sz * 1.15, by = y - sz * 1.05 + sway;
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
    ctx.strokeStyle = '#3a2c48'; ctx.lineWidth = Math.max(1, sz * 0.05);
    ctx.beginPath(); ctx.moveTo(sz * 0.25, -sz * 0.6); ctx.quadraticCurveTo(sz * 0.6, -sz * 1.4, sz * 1.15, -sz * 1.05 + sway); ctx.stroke();
    ctx.fillStyle = '#231a30';
    ctx.beginPath(); ctx.moveTo(-sz * 0.85, 0); ctx.lineTo(-sz * 1.35, -sz * 0.45 + sway * 0.5); ctx.lineTo(-sz * 1.3, sz * 0.45 + sway * 0.5); ctx.closePath(); ctx.fill();
    var g = ctx.createRadialGradient(-sz * 0.2, -sz * 0.3, sz * 0.1, 0, 0, sz);
    g.addColorStop(0, '#4a3a5e'); g.addColorStop(1, '#17111f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.78, 0, 0, TAU); ctx.fill();
    var open = 0.25 + 0.15 * Math.sin(now / 900 + ph);
    ctx.fillStyle = '#0a0610';
    ctx.beginPath(); ctx.moveTo(sz * 0.98, -sz * open); ctx.lineTo(sz * 0.2, sz * 0.05); ctx.lineTo(sz * 0.98, sz * (0.2 + open)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#efe8d8';
    for (var t = 0; t < 5; t++) {
      var tx = sz * (0.4 + t * 0.13);
      ctx.beginPath(); ctx.moveTo(tx, -sz * open * (t / 5 + 0.2)); ctx.lineTo(tx + sz * 0.05, -sz * open * (t / 5 + 0.2) + sz * 0.14); ctx.lineTo(tx + sz * 0.1, -sz * open * (t / 5 + 0.2)); ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx, sz * (0.18 + open) * (t / 5 + 0.3)); ctx.lineTo(tx + sz * 0.05, sz * (0.18 + open) * (t / 5 + 0.3) - sz * 0.13); ctx.lineTo(tx + sz * 0.1, sz * (0.18 + open) * (t / 5 + 0.3)); ctx.fill();
    }
    ctx.fillStyle = '#c9f6ff'; circle(sz * 0.45, -sz * 0.38, sz * 0.09); ctx.fill();
    ctx.restore();
    glows.push(function () {
      var f = 0.75 + 0.25 * Math.sin(now / 160 + ph);
      var gg = ctx.createRadialGradient(bx, by, 0, bx, by, sz * 1.3);
      gg.addColorStop(0, 'rgba(210, 255, 255, ' + f.toFixed(3) + ')'); gg.addColorStop(0.12, 'rgba(120, 240, 255, ' + (0.7 * f).toFixed(3) + ')'); gg.addColorStop(1, 'rgba(60, 200, 255, 0)');
      ctx.fillStyle = gg; ctx.fillRect(bx - sz * 1.3, by - sz * 1.3, sz * 2.6, sz * 2.6);
    });
  }
  function chain(x, y, dir, s, now, ph) { // siphonophore: a long chain of glowing beads
    var pts = [];
    for (var k = 0; k < 15; k++) pts.push([x - dir * k * 9 * s, y + Math.sin(now / 800 + ph + k * 0.55) * 12 * s]);
    ctx.strokeStyle = 'rgba(120, 140, 200, 0.35)'; ctx.lineWidth = Math.max(1, s);
    ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke();
    glows.push(function () {
      pts.forEach(function (p, i) {
        var col = i % 2 ? [255, 110, 220] : [110, 230, 255], f = 0.5 + 0.5 * Math.sin(now / 300 - i * 0.6 + ph);
        var g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 8 * s);
        g.addColorStop(0, rgba(col, 0.95 * f)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(p[0] - 8 * s, p[1] - 8 * s, 16 * s, 16 * s);
      });
    });
  }
  function eel(x, y, dir, s, now, ph) { // gulper eel: huge mouth, whip tail with a glowing tip
    var pts = [];
    for (var k = 0; k < 22; k++) pts.push([x - dir * k * 8 * s, y + Math.sin(now / 500 + ph - k * 0.4) * k * 0.7 * s]);
    ctx.strokeStyle = '#1b1426'; ctx.lineCap = 'round';
    for (var i = 1; i < pts.length; i++) {
      ctx.lineWidth = Math.max(1, (9 - i * 0.38) * s);
      ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
    }
    ctx.fillStyle = '#120c1a';
    var open = 0.5 + 0.3 * Math.sin(now / 800 + ph);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dir * 26 * s, y - 14 * s * open); ctx.lineTo(x + dir * 26 * s, y + 14 * s * open); ctx.closePath(); ctx.fill();
    var tip = pts[pts.length - 1];
    glows.push(function () {
      var f = 0.5 + 0.5 * Math.sin(now / 200 + ph);
      var g = ctx.createRadialGradient(tip[0], tip[1], 0, tip[0], tip[1], 14 * s);
      g.addColorStop(0, 'rgba(255, 120, 180, ' + (0.9 * f).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255, 60, 140, 0)');
      ctx.fillStyle = g; ctx.fillRect(tip[0] - 14 * s, tip[1] - 14 * s, 28 * s, 28 * s);
    });
  }
  function drawSwimmers(P, now) {
    var wl = WL(), sp = H * 0.42, s = SU;
    var pMin = -TOP - wl + P - sp, pMax = FULL_H - TOP - wl + P + sp;
    for (var i = Math.max(0, Math.floor(pMin / sp)); i <= Math.ceil(pMax / sp); i++) {
      var seed = i * 13.7 + 1.3;
      if (hash(seed + 0.5) < 0.18) continue;
      var pd = i * sp + hash(seed + 1) * sp * 0.5 + H * 0.12;
      var m = metresAtPx(pd), y = wl + pd - P, dir = hash(seed + 2) < 0.5 ? -1 : 1;
      var span = FULL_W + 320 * s, speed = (14 + hash(seed + 3) * 26) * s;
      var x = ((hash(seed + 4) * span + dir * speed * now / 1000) % span + span) % span - LEFT - 160 * s;
      var r = hash(seed + 5);
      if (m < 220) {
        if (r < 0.75) school(x, y, dir, s, now, seed, false);
        else turtle(x, y, dir, s * 1.1, now);
      } else if (m < 1100) {
        if (r < 0.45) jelly(x, y, 15 * s, [255, 170, 210], now, seed, false);
        else if (r < 0.75) squid(x, y, dir, s, now, seed);
        else school(x, y, dir, s, now, seed, true);
      } else if (m < 4000) {
        if (r < 0.4) jelly(x, y, 14 * s, r < 0.2 ? [90, 240, 255] : [255, 100, 230], now, seed, true);
        else if (r < 0.7) angler(x, y, 26 * s, dir, now, seed);
        else chain(x, y, dir, s, now, seed);
      } else {
        if (r < 0.4) angler(x, y, 34 * s, dir, now, seed);
        else if (r < 0.7) eel(x, y, dir, s, now, seed);
        else jelly(x, y, 16 * s, [170, 120, 255], now, seed, true);
      }
    }
  }
  function drawEyes(P, now, m) { // something very big watches from the dark, far away
    var a = clamp((m - 2500) / 2000, 0, 1);
    if (a <= 0) return;
    var wl = WL(), sp = H * 1.6;
    var pMin = -TOP - wl + P * 0.3 - sp, pMax = FULL_H - TOP - wl + P * 0.3 + sp;
    for (var i = Math.floor(pMin / sp); i <= Math.ceil(pMax / sp); i++) {
      if (hash(i * 3.3) < 0.35) continue;
      (function (i) {
        var y = wl + i * sp + hash(i + 1) * sp * 0.5 - P * 0.3, x = W * (0.18 + hash(i + 2) * 0.64), gap = 26 * SU;
        var cyc = (now / 1000 + hash(i) * 9) % 6, open = cyc < 0.18 ? Math.abs(cyc - 0.09) / 0.09 : 1;
        glows.push(function () {
          [-1, 1].forEach(function (k) {
            var ex = x + k * gap, g = ctx.createRadialGradient(ex, y, 0, ex, y, 16 * SU);
            g.addColorStop(0, 'rgba(255, 236, 120, ' + (0.55 * a).toFixed(3) + ')'); g.addColorStop(1, 'rgba(200, 255, 80, 0)');
            ctx.save(); ctx.translate(ex, y); ctx.scale(1, Math.max(0.06, open)); ctx.translate(-ex, -y);
            ctx.fillStyle = g; ctx.fillRect(ex - 16 * SU, y - 16 * SU, 32 * SU, 32 * SU);
            ctx.fillStyle = 'rgba(30, 10, 0, ' + (0.7 * a).toFixed(3) + ')'; ctx.fillRect(ex - 1.2 * SU, y - 6 * SU, 2.4 * SU, 12 * SU);
            ctx.restore();
          });
        });
      })(i);
    }
  }

  // the surface: sky, a little island with palms, a striped lighthouse, gulls, waves
  function surfaceY(x, now) { return WL() + Math.sin(x * 0.03 + now * 0.002) * 3 * SU + Math.sin(x * 0.011 - now * 0.0013) * 4 * SU; }
  function drawSurface(P, now) {
    var wl = WL() - P;
    if (wl < -TOP - 20) return;
    var yTop = -TOP;
    var g = ctx.createLinearGradient(0, yTop, 0, wl);
    g.addColorStop(0, rgb(SKY_TOP)); g.addColorStop(1, rgb(SKY_LOW));
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, yTop, FULL_W, wl - yTop + 6);
    // sun
    var sx = W * 0.8, sy = yTop + (wl - yTop) * 0.32;
    var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.3);
    sg.addColorStop(0, 'rgba(255, 252, 230, 0.95)'); sg.addColorStop(0.12, 'rgba(255, 244, 200, 0.75)'); sg.addColorStop(1, 'rgba(255, 240, 200, 0)');
    ctx.fillStyle = sg; ctx.fillRect(sx - H * 0.3, sy - H * 0.3, H * 0.6, H * 0.6);
    // clouds
    clouds.forEach(function (c) {
      var span = FULL_W + 300;
      var cx = ((c.x * span + now * 0.006 * c.v) % span) - LEFT - 150, cy = yTop + (wl - yTop) * c.y;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
      [[0, 0, 1], [-0.6, 0.15, 0.7], [0.6, 0.12, 0.75], [-0.2, -0.3, 0.7], [0.3, -0.22, 0.6]].forEach(function (b) {
        ctx.beginPath(); ctx.ellipse(cx + b[0] * 50 * c.s * SU, cy + b[1] * 26 * c.s * SU, 34 * c.s * SU * b[2], 18 * c.s * SU * b[2], 0, 0, TAU); ctx.fill();
      });
    });
    // island with two palms
    var ix = W * 0.2, iw = Math.min(W * 0.34, 260 * SU), ih = 22 * SU;
    ctx.fillStyle = '#2d7a6e';
    ctx.beginPath(); ctx.moveTo(ix - iw / 2, wl + 2); ctx.quadraticCurveTo(ix - iw * 0.2, wl - ih * 1.3, ix + iw * 0.05, wl - ih); ctx.quadraticCurveTo(ix + iw * 0.3, wl - ih * 0.8, ix + iw / 2, wl + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f3dca0';
    ctx.beginPath(); ctx.ellipse(ix + iw * 0.05, wl, iw * 0.42, 4 * SU, 0, Math.PI, TAU); ctx.fill();
    [[-0.08, 1, -0.25], [0.12, 0.8, 0.2]].forEach(function (pl, k) {
      var px = ix + iw * pl[0], py = wl - ih * 0.9, ph = 44 * SU * pl[1], lean = pl[2];
      var tx = px + lean * ph, ty = py - ph;
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3.2 * SU; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + lean * ph * 0.2, py - ph * 0.6, tx, ty); ctx.stroke();
      ctx.strokeStyle = '#1f7a4a'; ctx.lineWidth = 3 * SU;
      for (var f = 0; f < 6; f++) {
        var a = -Math.PI / 2 + (f - 2.5) * 0.55 + Math.sin(now / 1100 + f + k) * 0.06, l = 22 * SU * pl[1];
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + Math.cos(a) * l * 0.6, ty + Math.sin(a) * l * 0.6 - 6 * SU, tx + Math.cos(a) * l, ty + Math.sin(a) * l + 8 * SU); ctx.stroke();
      }
    });
    // lighthouse on a rock
    var lx = W * 0.88, lh = 54 * SU, lw = 12 * SU;
    ctx.fillStyle = '#3c5560';
    ctx.beginPath(); ctx.ellipse(lx, wl + 2, 26 * SU, 9 * SU, 0, Math.PI, TAU); ctx.fill();
    for (var b = 0; b < 4; b++) {
      ctx.fillStyle = b % 2 ? '#e8463a' : '#f8f4ec';
      var y0 = wl - 6 * SU - b * lh / 4, y1 = y0 - lh / 4, w0 = lw * (1 - b * 0.08), w1 = lw * (1 - (b + 1) * 0.08);
      ctx.beginPath(); ctx.moveTo(lx - w0 / 2, y0); ctx.lineTo(lx - w1 / 2, y1); ctx.lineTo(lx + w1 / 2, y1); ctx.lineTo(lx + w0 / 2, y0); ctx.closePath(); ctx.fill();
    }
    var ly = wl - 6 * SU - lh;
    ctx.fillStyle = '#263b44'; ctx.fillRect(lx - lw * 0.42, ly - 9 * SU, lw * 0.84, 9 * SU);
    ctx.fillStyle = '#e8463a'; ctx.beginPath(); ctx.moveTo(lx - lw * 0.5, ly - 9 * SU); ctx.lineTo(lx, ly - 17 * SU); ctx.lineTo(lx + lw * 0.5, ly - 9 * SU); ctx.fill();
    var beam = (now / 2400) % 1, bOn = Math.abs(Math.sin(beam * Math.PI));
    ctx.fillStyle = 'rgba(255, 240, 170, ' + (0.6 + 0.4 * bOn).toFixed(3) + ')'; ctx.fillRect(lx - lw * 0.3, ly - 7.5 * SU, lw * 0.6, 6 * SU);
    var bd = Math.cos(beam * TAU) < 0 ? -1 : 1;
    var bg2 = ctx.createLinearGradient(lx, 0, lx + bd * 140 * SU, 0);
    bg2.addColorStop(0, 'rgba(255, 246, 190, ' + (0.5 * bOn).toFixed(3) + ')'); bg2.addColorStop(1, 'rgba(255, 246, 190, 0)');
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.moveTo(lx, ly - 4.5 * SU); ctx.lineTo(lx + bd * 140 * SU, ly - 18 * SU); ctx.lineTo(lx + bd * 140 * SU, ly + 9 * SU); ctx.closePath(); ctx.fill();
    // gulls
    ctx.strokeStyle = 'rgba(30, 50, 70, 0.75)'; ctx.lineWidth = 1.8 * SU; ctx.lineCap = 'round';
    for (var gi = 0; gi < 3; gi++) {
      var span2 = FULL_W + 200, gx = ((gi * 0.37 * span2 + now * 0.03 * (1 + gi * 0.2)) % span2) - LEFT - 100, gy = yTop + (wl - yTop) * (0.42 + gi * 0.12) + Math.sin(now / 900 + gi) * 6;
      var flap = Math.sin(now / 160 + gi * 2) * 4 * SU, gs = 8 * SU;
      ctx.beginPath(); ctx.moveTo(gx - gs, gy - flap); ctx.quadraticCurveTo(gx - gs * 0.4, gy - gs * 0.5, gx, gy); ctx.quadraticCurveTo(gx + gs * 0.4, gy - gs * 0.5, gx + gs, gy - flap); ctx.stroke();
    }
  }
  function drawWaves(P, now) { // the surface line (drawn over the sub so it sits in the water)
    var off = -P;
    if (WL() + off < -TOP - 20) return;
    var x0 = -LEFT, x1 = W, step = 8;
    var top = waterAt(0, 0);
    ctx.beginPath();
    ctx.moveTo(x0, surfaceY(x0, now) + off);
    for (var x = x0; x <= x1 + step; x += step) ctx.lineTo(x, surfaceY(x, now) + off);
    ctx.lineTo(x1 + step, WL() + off + 26 * SU); ctx.lineTo(x0, WL() + off + 26 * SU); ctx.closePath();
    var g = ctx.createLinearGradient(0, WL() + off - 6, 0, WL() + off + 26 * SU);
    g.addColorStop(0, rgba(mixC(top, [255, 255, 255], 0.35), 0.75)); g.addColorStop(1, rgba(top, 0));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; ctx.lineWidth = 2 * SU;
    ctx.beginPath();
    for (var x2 = x0; x2 <= x1 + step; x2 += step) { var y2 = surfaceY(x2, now) + off; if (x2 === x0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = 1.5 * SU;
    for (var k = 0; k < 14; k++) { // sparkles on the water
      var sx = -LEFT + hash(k) * FULL_W, sy = WL() + off + 6 * SU + hash(k + 3) * 18 * SU, a = Math.sin(now / 500 + k * 2);
      if (a < 0.3) continue;
      ctx.globalAlpha = a; ctx.beginPath(); ctx.moveTo(sx - 6 * SU, sy); ctx.lineTo(sx + 6 * SU, sy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawRays(P, now, m) { // sun rays reaching down into the water
    var a = clamp(1 - m / 420, 0, 1) * 0.16;
    if (a <= 0.005) return;
    var top = Math.max(-TOP, WL() - P);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 7; i++) {
      var x = -LEFT + FULL_W * (0.05 + i * 0.15) + Math.sin(now / 3000 + i * 1.3) * 30 * SU, w = (24 + hash(i) * 46) * SU, len = H * 1.3;
      var g = ctx.createLinearGradient(0, top, 0, top + len);
      g.addColorStop(0, 'rgba(210, 250, 255, ' + (a * (0.6 + 0.4 * Math.sin(now / 1400 + i))).toFixed(3) + ')'); g.addColorStop(1, 'rgba(210, 250, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + w, top); ctx.lineTo(x + w * 2.2 + len * 0.18, top + len); ctx.lineTo(x + w * 0.6 + len * 0.18, top + len); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawSnow(P, now, m) { // marine snow drifting down (the camera passes it on the way down)
    var a = clamp((m - 40) / 300, 0, 1) * 0.6;
    if (a <= 0) return;
    ctx.fillStyle = 'rgba(220, 240, 255, ' + a.toFixed(3) + ')';
    var span = FULL_H + 40;
    snow.forEach(function (p) {
      var y = ((p.y * span - P * 0.7 * p.v + now * 0.008 * p.v) % span + span) % span - TOP - 20, x = -LEFT + p.x * FULL_W + Math.sin(now / 1800 + p.y * 20) * 6;
      circle(x, y, p.r * SU); ctx.fill();
    });
  }
  function drawRuler(P, m) { // depth marks along the right edge
    var a = clamp(m / 60, 0, 1) * 0.4;
    if (a <= 0) return;
    var step = H * 0.1, x = W - 10 * SU;
    ctx.strokeStyle = 'rgba(200, 240, 255, ' + a.toFixed(3) + ')';
    ctx.lineWidth = 1.5;
    for (var i = Math.max(1, Math.floor((P - WL() - TOP) / step)); ; i++) {
      var y = WL() + i * step - P, l = i % 5 === 0 ? 14 : 6;
      if (y > FULL_H - TOP) break;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - l * SU, y); ctx.stroke();
    }
  }

  // ---- the sub "Pip": orange hull, brass portholes, its little captain in the dome --------
  function hullPath() {
    ctx.beginPath();
    ctx.moveTo(-96, -26);
    ctx.bezierCurveTo(-40, -45, 50, -46, 88, -30);
    ctx.bezierCurveTo(120, -16, 120, 18, 88, 32);
    ctx.bezierCurveTo(50, 44, -40, 42, -96, 24);
    ctx.bezierCurveTo(-112, 16, -112, -18, -96, -26);
    ctx.closePath();
  }
  function hullGrad(y0, y1) {
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#ffe08a'); g.addColorStop(0.35, '#ffa244'); g.addColorStop(0.72, '#ef6a2a'); g.addColorStop(1, '#b4401a');
    return g;
  }
  function porthole(x, y, r, lamp) {
    circle(x, y, r); ctx.fillStyle = '#e8c26a'; ctx.fill(); ctx.strokeStyle = '#6b3d0c'; ctx.lineWidth = 2; ctx.stroke();
    circle(x, y, r * 0.66);
    var g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r * 0.7);
    g.addColorStop(0, lamp > 0.05 ? 'rgba(255, 236, 160, ' + (0.4 + lamp * 0.6).toFixed(3) + ')' : '#5fd0e6'); g.addColorStop(1, '#0b3d55');
    ctx.fillStyle = g; ctx.fill();
    circle(x - r * 0.25, y - r * 0.25, r * 0.16); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  }
  function drawSub(o, now) {
    // o: x, y, s, tilt, spin, peri, lamp, crack, scared, alpha
    ctx.save();
    ctx.translate(o.x, o.y); ctx.rotate(o.tilt); ctx.scale(o.s, o.s);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // propeller (spins around the shaft)
    ctx.fillStyle = '#9b6a24'; ctx.fillRect(-114, -3, 14, 6);
    for (var b = 0; b < 3; b++) {
      var ang = o.spin + b * TAU / 3, hgt = Math.sin(ang) * 30, wid = Math.abs(Math.cos(ang)) * 6 + 2;
      ctx.fillStyle = Math.cos(ang) > 0 ? '#f3d48a' : '#c8933a';
      ctx.beginPath(); ctx.ellipse(-116, hgt / 2, wid, Math.abs(hgt) / 2 + 1, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#e8c26a'; circle(-116, 0, 6); ctx.fill();
    // tail fins
    ctx.fillStyle = '#d4562a'; ctx.strokeStyle = '#5a1f0c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-84, -22); ctx.lineTo(-104, -50); ctx.lineTo(-90, -52); ctx.lineTo(-68, -28); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-84, 20); ctx.lineTo(-104, 46); ctx.lineTo(-90, 48); ctx.lineTo(-68, 26); ctx.closePath(); ctx.fill(); ctx.stroke();
    // conning tower + periscope
    var pe = o.peri;
    if (pe > 0.02) {
      ctx.strokeStyle = '#a8742a'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(18, -70); ctx.lineTo(18, -70 - 28 * pe); ctx.lineTo(32, -70 - 28 * pe); ctx.stroke();
      ctx.fillStyle = '#2b2b33'; ctx.fillRect(31, -75 - 28 * pe, 6, 10);
    }
    ctx.beginPath();
    ctx.moveTo(-30, -36); ctx.lineTo(-22, -64); ctx.quadraticCurveTo(-19, -72, -10, -72); ctx.lineTo(30, -72); ctx.quadraticCurveTo(38, -72, 40, -64); ctx.lineTo(48, -36); ctx.closePath();
    ctx.fillStyle = hullGrad(-72, -30); ctx.fill(); ctx.strokeStyle = '#5a1f0c'; ctx.lineWidth = 3; ctx.stroke();
    porthole(9, -54, 8, o.lamp);
    var blink = (now / 900) % 1 < 0.5;
    ctx.fillStyle = blink ? '#ff4d3a' : '#7a1a10'; circle(-14, -74, 3.4); ctx.fill();
    // hull
    hullPath(); ctx.fillStyle = hullGrad(-46, 44); ctx.fill();
    ctx.save(); hullPath(); ctx.clip();
    ctx.fillStyle = '#17a3b6'; ctx.fillRect(-66, -50, 16, 100); // teal band
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'; ctx.fillRect(-66, -50, 3, 100);
    ctx.fillStyle = 'rgba(100, 20, 0, 0.22)'; ctx.beginPath(); ctx.ellipse(0, 40, 130, 22, 0, 0, TAU); ctx.fill(); // belly shade
    ctx.restore();
    hullPath(); ctx.strokeStyle = '#5a1f0c'; ctx.lineWidth = 3.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(-72, -30); ctx.bezierCurveTo(-30, -40, 30, -41, 66, -33); ctx.stroke(); // shine
    // rivets
    ctx.fillStyle = 'rgba(110, 40, 10, 0.75)';
    [[-80, -27], [-40, -37], [-14, -40], [52, -38], [76, -31], [-80, 22], [-40, 34], [0, 36], [40, 34]].forEach(function (p) { circle(p[0], p[1], 2); ctx.fill(); });
    // side dive plane
    ctx.fillStyle = '#d4562a'; ctx.strokeStyle = '#5a1f0c'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(24, 16); ctx.lineTo(54, 20); ctx.lineTo(48, 30); ctx.lineTo(20, 25); ctx.closePath(); ctx.fill(); ctx.stroke();
    // portholes
    porthole(-34, 2, 10, o.lamp);
    porthole(-6, 2, 10, o.lamp);
    // front dome with the captain
    var dx = 70, dy = -4, dr = 26;
    circle(dx, dy, dr + 4); ctx.fillStyle = '#e8c26a'; ctx.fill(); ctx.strokeStyle = '#6b3d0c'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.save(); circle(dx, dy, dr); ctx.clip();
    var gl = ctx.createRadialGradient(dx - 8, dy - 8, 2, dx, dy, dr);
    gl.addColorStop(0, '#2b7f9e'); gl.addColorStop(1, '#073046');
    ctx.fillStyle = gl; ctx.fillRect(dx - dr, dy - dr, dr * 2, dr * 2);
    var bob = Math.sin(now / 420) * 1.2, hx = dx - 2, hy = dy + 6 + bob;
    ctx.fillStyle = '#ffcf9e'; circle(hx, hy, 14); ctx.fill(); // head
    ctx.fillStyle = '#e23c3c'; ctx.beginPath(); ctx.arc(hx, hy - 2, 15, Math.PI, TAU); ctx.fill(); // beanie
    ctx.fillStyle = '#fff'; ctx.fillRect(hx - 15, hy - 4, 30, 4);
    circle(hx, hy - 18, 3.4); ctx.fill(); // pompom
    ctx.strokeStyle = '#3a4650'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx - 14, hy + 2); ctx.lineTo(hx + 14, hy + 2); ctx.stroke();
    [-5.5, 5.5].forEach(function (ox) { // goggles
      circle(hx + ox, hy + 2, 5.2); ctx.fillStyle = '#dfe9ef'; ctx.fill();
      circle(hx + ox, hy + 2, 3.6); ctx.fillStyle = o.scared ? '#fff' : '#0e4a62'; ctx.fill();
      if (o.scared) { circle(hx + ox, hy + 2, 1.2); ctx.fillStyle = '#071526'; ctx.fill(); }
      else { circle(hx + ox - 1.2, hy + 0.8, 1.2); ctx.fillStyle = '#fff'; ctx.fill(); }
    });
    ctx.fillStyle = 'rgba(255, 120, 120, 0.55)'; circle(hx - 9, hy + 8, 2.6); ctx.fill(); circle(hx + 9, hy + 8, 2.6); ctx.fill();
    ctx.strokeStyle = '#7a3a1a'; ctx.lineWidth = 1.8;
    if (o.scared) { circle(hx, hy + 10, 2.8); ctx.fillStyle = '#5a1a0a'; ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(hx, hy + 8, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = 'rgba(140, 230, 255, 0.16)'; ctx.fillRect(dx - dr, dy - dr, dr * 2, dr * 2); // glass tint
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(dx, dy, dr - 5, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
    // head lamp
    ctx.fillStyle = '#6b3d0c'; ctx.beginPath(); ctx.ellipse(104, 16, 6, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = o.lamp > 0.05 ? '#fff8d2' : '#f6e7b0'; ctx.beginPath(); ctx.ellipse(106, 16, 3.5, 5, 0, 0, TAU); ctx.fill();
    // pressure cracks
    if (o.crack > 0 && scene.cracks) {
      scene.cracks.forEach(function (line) {
        var n = Math.max(2, Math.ceil(line.length * o.crack));
        ctx.beginPath(); ctx.moveTo(line[0][0], line[0][1]);
        for (var i = 1; i < n; i++) ctx.lineTo(line[i][0], line[i][1]);
        ctx.strokeStyle = '#2a0a04'; ctx.lineWidth = 3.4; ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'; ctx.lineWidth = 1.3; ctx.stroke();
      });
    }
    ctx.restore();
    if (o.lamp > 0.02) glows.push(function () { // head-lamp beam + warm portholes
      ctx.save();
      ctx.translate(o.x, o.y); ctx.rotate(o.tilt); ctx.scale(o.s, o.s);
      var L = 640;
      [[0.2, 0.3], [0.32, 0.17], [0.46, 0.1]].forEach(function (w) { // soft-edged beam: nested wedges
        var g = ctx.createRadialGradient(106, 16, 4, 106, 16, L);
        g.addColorStop(0, 'rgba(255, 246, 200, ' + (w[1] * o.lamp).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255, 246, 200, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(106, 12); ctx.lineTo(106 + L, 16 + L * (0.05 - w[0])); ctx.lineTo(106 + L, 16 + L * (0.05 + w[0])); ctx.lineTo(106, 20); ctx.closePath(); ctx.fill();
      });
      [[-34, 2], [-6, 2], [9, -54]].forEach(function (p) {
        var h = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 22);
        h.addColorStop(0, 'rgba(255, 220, 130, ' + (0.5 * o.lamp).toFixed(3) + ')'); h.addColorStop(1, 'rgba(255, 220, 130, 0)');
        ctx.fillStyle = h; ctx.fillRect(p[0] - 22, p[1] - 22, 44, 44);
      });
      ctx.restore();
    });
  }
  function makeCracks() { // jagged crack lines on the hull and across the view (new every crash)
    var lines = [];
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * TAU + Math.random() * 0.6, x = 20, y = -6, pts = [[x, y]];
      for (var k = 0; k < 6; k++) { a += (Math.random() - 0.5) * 0.9; x += Math.cos(a) * (8 + Math.random() * 8); y += Math.sin(a) * (5 + Math.random() * 6); pts.push([x, y]); }
      lines.push(pts);
    }
    scene.cracks = lines;
    var glass = [];
    for (var j = 0; j < 11; j++) {
      var b = (j / 11) * TAU + Math.random() * 0.4, r = 0, gp = [[0, 0]];
      while (r < 1) { r += 0.08 + Math.random() * 0.1; var bb = b + (Math.random() - 0.5) * 0.25; gp.push([Math.cos(bb) * r, Math.sin(bb) * r]); }
      glass.push(gp);
    }
    scene.glass = glass;
  }

  function drawPods(now) {
    for (var i = pods.length - 1; i >= 0; i--) {
      var p = pods[i], t = (now - p.t0) / POD_MS;
      if (t >= 1) { pods.splice(i, 1); continue; }
      var e = ease(t), x = p.x + p.drift * e + Math.sin(t * 9) * 4 * SU, y = p.y - e * H * 0.36, a = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      if (p.mine) { // a yellow escape pod carrying the win up
        var s = p.s * 1.1;
        ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(Math.sin(t * 7) * 0.12);
        ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#7a4a05'; ctx.lineWidth = 2.5 * s;
        ctx.beginPath(); ctx.ellipse(0, 0, 18 * s, 13 * s, 0, 0, TAU); ctx.fill(); ctx.stroke();
        circle(0, 0, 6 * s); ctx.fillStyle = '#0b4a66'; ctx.fill();
        ctx.fillStyle = (now / 200) % 2 < 1 ? '#3dff9a' : '#0c7a40'; circle(0, -15 * s, 3 * s); ctx.fill();
        ctx.restore();
        if (p.label) {
          ctx.save(); ctx.globalAlpha = a;
          var fs = Math.round(clamp(16 * SU, 13, 22));
          ctx.font = '900 ' + fs + 'px "Trebuchet MS", system-ui, sans-serif';
          var tw = ctx.measureText(p.label).width + fs;
          ctx.fillStyle = 'rgba(14, 154, 104, 0.92)';
          roundRect(x - tw / 2, y - 26 * p.s - fs * 1.5, tw, fs * 1.5, fs * 0.75); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.label, x, y - 26 * p.s - fs * 0.75);
          ctx.restore();
        }
        if (Math.random() < 0.4) bubbles.push({ x: x, y: y + 12 * s, r: (1 + Math.random() * 2) * SU, vy: 20 * SU, vx: 0, ph: Math.random() * TAU, life: 700, age: 0 });
      } else (function (x, y, a) { // someone else cashed out: a pearl of light rises
        glows.push(function () {
          var g = ctx.createRadialGradient(x, y, 0, x, y, 14 * SU);
          g.addColorStop(0, 'rgba(220, 255, 245, ' + (0.95 * a).toFixed(3) + ')'); g.addColorStop(0.3, 'rgba(80, 255, 190, ' + (0.6 * a).toFixed(3) + ')'); g.addColorStop(1, 'rgba(80, 255, 190, 0)');
          ctx.fillStyle = g; ctx.fillRect(x - 14 * SU, y - 14 * SU, 28 * SU, 28 * SU);
        });
      })(x, y, a);
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // the dive timer while bets are open: a brass pressure gauge counting down to the plunge
  function drawGauge(now) {
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var left = clamp((S.bettingEndsAt - Date.now()) / total, 0, 1), secs = Math.max(0, Math.ceil((S.bettingEndsAt - Date.now()) / 1000));
    if (secs !== scene.lastSecs) { if (scene.lastSecs > secs && secs > 0 && secs <= 3) play('tick'); scene.lastSecs = secs; }
    var R = clamp(Math.min(W, H) * 0.11, 30, 64), cx = W * 0.5, cy = H * 0.19;
    var A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 20, 40, 0.45)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
    circle(cx, cy, R * 1.14);
    var bz = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    bz.addColorStop(0, '#fff1c4'); bz.addColorStop(0.5, '#e3ad4c'); bz.addColorStop(1, '#8f5c17');
    ctx.fillStyle = bz; ctx.fill();
    ctx.restore();
    circle(cx, cy, R * 0.98);
    var face = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
    face.addColorStop(0, '#0f4a6e'); face.addColorStop(1, '#03182a');
    ctx.fillStyle = face; ctx.fill();
    for (var i = 0; i <= 12; i++) { // ticks
      var a = A0 + SWEEP * i / 12, r1 = R * 0.86, r2 = R * (i % 3 ? 0.78 : 0.7);
      ctx.strokeStyle = i >= 10 ? '#ff6a4a' : 'rgba(200, 240, 255, 0.8)'; ctx.lineWidth = i % 3 ? 1.5 : 2.5;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    }
    if (left > 0) { // time left
      ctx.strokeStyle = '#3fe0f0'; ctx.lineWidth = R * 0.09; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(63, 224, 240, 0.8)'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, A0 + SWEEP * (1 - left), A0 + SWEEP); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    var na = A0 + SWEEP * (1 - left); // needle
    ctx.strokeStyle = '#ff6a4a'; ctx.lineWidth = Math.max(2, R * 0.06); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(na) * R * 0.14, cy - Math.sin(na) * R * 0.14); ctx.lineTo(cx + Math.cos(na) * R * 0.66, cy + Math.sin(na) * R * 0.66); ctx.stroke();
    circle(cx, cy, R * 0.1); ctx.fillStyle = '#e3ad4c'; ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.font = '900 ' + Math.round(R * 0.5) + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillText(String(secs), cx, cy + R * 0.42);
    ctx.font = '800 ' + Math.round(R * 0.17) + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = '#9ff4ff';
    ctx.fillText('DIVE IN', cx, cy - R * 0.38);
    // the round's betting phrase under the gauge
    var fs = Math.round(clamp(H * 0.045, 13, 24));
    ctx.font = '900 ' + fs + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(4, 40, 70, 0.85)'; ctx.fillStyle = '#fff';
    var label = S.bettingPhrase.toUpperCase();
    ctx.strokeText(label, cx, cy + R * 1.14 + fs * 0.95);
    ctx.fillText(label, cx, cy + R * 1.14 + fs * 0.95);
  }

  // ---- crash effects over the view
  function drawCrashFx(now, pose) {
    var t = now - scene.crashAt;
    if (t > CRASH_MS) return;
    if (t < 1200) { // red alarm pulses
      ctx.fillStyle = 'rgba(255, 40, 30, ' + (0.2 * Math.abs(Math.sin(t / 130)) * (1 - t / 1200)).toFixed(3) + ')';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    }
    if (scene.glass && pose) { // the view's glass cracks from the hull outward
      var grow = ease(t / 260), a = t < 900 ? 1 : 1 - (t - 900) / (CRASH_MS - 900), R = Math.min(W, H) * 0.55;
      ctx.save(); ctx.translate(pose.x, pose.y - 10 * pose.s);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      scene.glass.forEach(function (line) {
        var n = Math.max(2, Math.ceil(line.length * grow));
        ctx.beginPath(); ctx.moveTo(0, 0);
        for (var i = 1; i < n; i++) ctx.lineTo(line[i][0] * R, line[i][1] * R);
        ctx.strokeStyle = 'rgba(0, 10, 20, ' + (0.45 * a).toFixed(3) + ')'; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.strokeStyle = 'rgba(235, 252, 255, ' + (0.85 * a).toFixed(3) + ')'; ctx.lineWidth = 1.4; ctx.stroke();
      });
      [0.22, 0.42].forEach(function (rr, k) { // rings of the shatter
        ctx.beginPath();
        scene.glass.forEach(function (line, j) {
          var p = line[Math.min(line.length - 1, Math.round(line.length * rr) + k)];
          if (j) ctx.lineTo(p[0] * R * grow, p[1] * R * grow); else ctx.moveTo(p[0] * R * grow, p[1] * R * grow);
        });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(235, 252, 255, ' + (0.5 * a).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
      });
      ctx.restore();
    }
    if (t < 180) { // flash
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.45 * (1 - t / 180)).toFixed(3) + ')';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    }
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0, topColour = SKY_TOP;

  function frame(now) {
    draw(now);
    requestAnimationFrame(frame);
  }
  function draw(now) {
    var dt = scene.lastT ? clamp(now - scene.lastT, 0, 100) : 16;
    scene.lastT = now;
    if (W && H) {
      var target = camTarget(now);
      if (S.phase === 'flying' || S.phase === 'crashed') scene.P += (target - scene.P) * Math.min(1, dt / 90);
      else scene.P = 0;
      var P = scene.P, dP = P - scene.lastP;
      scene.lastP = P;
      var mid = metresAtPx(Math.max(0, P + H * 0.5 - WL()));
      var dk = darkness(mid);
      glows.length = 0;
      updateBubbles(dt, dP);

      ctx.save();
      ctx.translate(LEFT, TOP);
      var crashT = scene.crashAt ? now - scene.crashAt : 1e9;
      if (crashT < 500) { var sh = 7 * SU * (1 - crashT / 500); ctx.translate((Math.random() - 0.5) * sh * 2, (Math.random() - 0.5) * sh * 2); }
      ctx.clearRect(-LEFT - 20, -TOP - 20, FULL_W + 40, FULL_H + 40);

      // water (the whole scene), then the sky above the surface when it is in view
      var wt = waterAt(mid, 0), wb = waterAt(mid, 1);
      var wy = Math.max(-TOP, WL() - P);
      var g = ctx.createLinearGradient(0, wy, 0, FULL_H - TOP);
      g.addColorStop(0, rgb(wt)); g.addColorStop(1, rgb(wb));
      ctx.fillStyle = g;
      ctx.fillRect(-LEFT - 20, -TOP - 20, FULL_W + 40, FULL_H + 40);
      drawSurface(P, now);
      drawRays(P, now, mid);
      drawEyes(P, now, mid);
      drawWall(-1, true, P, mid); drawWall(1, true, P, mid);
      drawSnow(P, now, mid);
      drawSwimmers(P, now);
      drawWall(-1, false, P, mid); drawWall(1, false, P, mid);
      drawDecor(P, now);
      drawRuler(P, mid);

      // the sub
      var pose = null, lamp = clamp(dk * 1.3, 0, 1);
      if (S.phase === 'flying') {
        pose = subPose(now);
        trail(pose, dt);
        var m = game.currentMult();
        setHum(now - (scene.diveAt || 0) > DIVE_MS * 0.5, 5 + Math.log(m) * 3);
        if (now - scene.lastPing > 2800 && now - (scene.diveAt || 0) > DIVE_MS) { scene.lastPing = now; play('ping', Math.log(m)); }
        drawSub({ x: pose.x, y: pose.y, s: pose.s, tilt: pose.tilt, spin: now / (60 / (1 + Math.log(m))), peri: 1 - ease((now - (scene.diveAt || 0)) / 500), lamp: lamp, crack: 0 }, now);
      } else if (S.phase === 'crashed') {
        setHum(false);
        var cf = scene.crashFrom;
        if (cf && crashT < CRASH_MS) {
          var k = crashT / CRASH_MS, sink = Math.max(0, crashT - 200) / (CRASH_MS - 200);
          if (crashT < 120) burst(cf, 6, 1.6);
          else if (crashT < 900 && Math.random() < 0.6) burst({ x: cf.x, y: cf.y + sink * sink * H * 0.7, s: cf.s }, 1, 1.2);
          var flick = crashT < 700 ? (Math.random() < 0.5 ? lamp : 0) : 0;
          pose = { x: cf.x - sink * 30 * SU, y: cf.y + sink * sink * H * 0.7 + (crashT < 300 ? (Math.random() - 0.5) * 6 * SU : 0), s: cf.s, tilt: cf.tilt + sink * sink * 1.1 };
          drawSub({ x: pose.x, y: pose.y, s: pose.s, tilt: pose.tilt, spin: now / 300 * (1 - k), peri: 0, lamp: flick, crack: ease(crashT / 250), scared: true, alpha: clamp(1 - (k - 0.75) / 0.25, 0, 1) }, now);
        }
      } else {
        setHum(false);
        pose = subPose(now);
        drawSub({ x: pose.x, y: pose.y, s: pose.s, tilt: pose.tilt, spin: now / 400, peri: 1, lamp: 0, crack: 0 }, now);
      }

      // darkness of the deep: only the sub's light pool and glowing creatures stay bright
      if (dk > 0.01) {
        var lx = pose ? pose.x : W * 0.5, ly = pose ? pose.y : H * 0.6, big = Math.max(FULL_W, FULL_H);
        var dg = ctx.createRadialGradient(lx, ly, Math.min(W, H) * 0.18, lx, ly, big * 0.8);
        dg.addColorStop(0, 'rgba(0, 2, 10, 0)'); dg.addColorStop(1, 'rgba(0, 2, 10, ' + (0.55 * dk).toFixed(3) + ')');
        ctx.fillStyle = dg; ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glows.forEach(function (f) { f(); });
      ctx.restore();

      drawWaves(P, now);
      drawBubbles();
      drawPods(now);
      if (S.phase === 'flying' && scene.diveAt && now - scene.diveAt < DIVE_MS) drawSplash(now);

      if (S.phase === 'crashed' && scene.crashAt) drawCrashFx(now, scene.crashFrom);
      if (S.phase === 'betting') drawGauge(now);

      // a fresh sub surfaces: the deep fades away over the sunny surface
      var st = scene.surfaceAt ? now - scene.surfaceAt : 1e9;
      if (S.phase !== 'flying' && S.phase !== 'crashed' && st < SURFACE_MS * 0.6) {
        ctx.fillStyle = rgba(scene.crashCol, 1 - ease(st / (SURFACE_MS * 0.6)));
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
        if (st < 80) burst(subPose(now), 3, 1);
      }
      ctx.restore();

      if (S.phase === 'crashed') scene.crashCol = waterAt(mid, 1);
      topColour = WL() - P > -TOP + 2 ? SKY_TOP : (S.phase === 'crashed' && crashT < 600 ? mixC(wt, [120, 20, 16], 0.3) : wt);
      if (S.phase !== 'flying' && S.phase !== 'crashed' && st < SURFACE_MS * 0.6) topColour = mixC(SKY_TOP, scene.crashCol, 1 - ease(st / (SURFACE_MS * 0.6)));
    }
    if (now - themeAt > 400) { themeAt = now; game.theme(toHex(topColour)); }

    // texts over the scene
    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden) setText(flew, S.crashPhrase);
    if (S.phase === 'flying') {
      var cm = game.currentMult(), mm = metres(cm);
      if (mult.className !== 'mult') mult.className = 'mult';
      setText(mult, cm.toFixed(2) + 'x');
      setText(hint, zoneName(mm) + ' · ' + Math.round(mm).toLocaleString('en') + ' m');
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      if (mult.className !== 'mult mult--crashed') mult.className = 'mult mult--crashed';
      setText(mult, (S.crashPoint || 1).toFixed(2) + 'x');
      var cmm = metres(S.crashPoint || 1);
      setText(hint, 'Hull cracked at ' + Math.round(cmm).toLocaleString('en') + ' m');
    } else if (S.phase === 'betting') {
      if (mult.className !== 'mult') mult.className = 'mult';
      setText(mult, ''); setText(hint, '');
    } else {
      if (mult.className !== 'mult') mult.className = 'mult';
      setText(mult, ''); setText(hint, S.gotSnapshot ? 'Waiting for the next round…' : 'Connecting…');
    }
  }
  function drawSplash(now) { // the plunge: spray thrown up where the sub breaks the surface
    var t = (now - scene.diveAt) / DIVE_MS, P = scene.P;
    var ex = W * 0.5, ey = WL() - P;
    if (ey < -TOP - 40) return;
    var a = 1 - t;
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.8 * a).toFixed(3) + ')'; ctx.lineWidth = 3 * SU;
    ctx.beginPath(); ctx.ellipse(ex, ey, (40 + t * 140) * SU, (6 + t * 10) * SU, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(230, 250, 255, ' + (0.9 * a).toFixed(3) + ')';
    for (var j = 0; j < 18; j++) {
      var ang = -Math.PI / 2 + (hash(j + 1) - 0.5) * 2.2, v = (160 + hash(j + 7) * 220) * SU, tt = t * DIVE_MS / 1000;
      var x = ex + Math.cos(ang) * v * tt, y = ey + Math.sin(ang) * v * tt + 520 * SU * tt * tt;
      if (y > ey + 4) continue;
      circle(x, y, (2 + hash(j + 3) * 3) * SU); ctx.fill();
    }
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
    p.autoAt.onblur = function () {
      var v = Number(String(p.autoAt.value).replace(',', '.'));
      p.autoAt.value = (isFinite(v) && v >= 1.01 ? Math.round(v * 100) / 100 : 2).toFixed(2);
    };
    p.action.onclick = function () {
      play('click');
      if (S.queued[p.slot]) return game.cancelQueued(p.slot);
      var my = S.my[p.slot];
      if (my && my.round === S.round && my.status === 'placed' && S.phase === 'flying') { bubbleBurst(p); return game.cashOut(p.slot); }
      if (my && my.round === S.round && my.status !== 'lost' && my.status !== 'cashed') return;
      bubbleBurst(p);
      game.bet(p.slot, readAmount(p), readAuto(p));
    };
  });

  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () { resumeAudio(); setSound(!soundOn); play('click'); };
  $('music').onclick = function () {
    resumeAudio();
    musicOn = !musicOn;
    store('deepdive-music', musicOn ? 'on' : 'off');
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

  // Music starts as the game opens (the tap that opened it usually allows sound); where the
  // browser still holds it back, it starts on the first tap in the game.
  setupAudio();
  setSound(soundOn);
  syncMusic();
  window.addEventListener('resize', fit);
  // The results row fills in after load (and the bets list / bar can change size): refit.
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  drawn = true;
  requestAnimationFrame(frame);
})();
