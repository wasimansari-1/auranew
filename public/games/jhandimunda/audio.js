/* Jhandi Munda — sounds. Dice, chips and interface sounds are recorded CC0 samples
 * (sounds/LICENSES.txt: Kenney Casino Audio dice shake / throw / single-die clatter, chips, interface
 * clicks and chimes). The music is generated here with WebAudio: a festive mela loop — a tanpura-like
 * drone on Sa–Pa, santoor-like plucks in raag Bilawal's major scale and a tabla-like dha/na/ge pattern.
 * Music and sound toggle separately (remembered); music starts at once where the browser allows
 * autoplay (the site's launch tap), else on the first touch (../_core/sound-unlock.js).
 */
(function () {
  'use strict';
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var FILES = {
    chip: ['chiplay1', 'chiplay2', 'chiplay3'], chips: ['chipstack1', 'chipstack2'], clack: ['chipcollide1'], handle: ['chiphandle1'],
    shake: ['dice-shake-1', 'dice-shake-2', 'dice-shake-3'], pour: ['dice-throw-1', 'dice-throw-2', 'dice-throw-3'],
    die: ['die-throw-1', 'die-throw-2', 'die-throw-3', 'die-throw-4'], grab: ['dice-grab-1', 'dice-grab-2'],
    open: ['open'], closed: ['closed'], count: ['count1'], countHi: ['count2'],
    win: ['win'], sparkle: ['sparkle1', 'sparkle2'], bigwin: ['bigwin'], lose: ['lose'], error: ['error'],
  };
  var MUSIC_VOL = 0.34;

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, sfx = null, mus = null, verb = null, bufs = {}, musicTimer = 0, nextBar = 0, bar = 0;
    var soundOn = safeGet('jhandimunda:sound') !== '0', musicOn = safeGet('jhandimunda:music') !== '0';

    function init() {
      if (ctx || !AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      var master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
      mus = ctx.createGain(); mus.gain.value = musicOn ? MUSIC_VOL : 0; mus.connect(master);
      verb = ctx.createDelay(); verb.delayTime.value = 0.13; // a courtyard echo for the music
      var fb = ctx.createGain(); fb.gain.value = 0.3;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      var wet = ctx.createGain(); wet.gain.value = 0.45;
      verb.connect(lp); lp.connect(fb); fb.connect(verb); lp.connect(wet); wet.connect(mus);
      Object.keys(FILES).forEach(function (k) {
        bufs[k] = [];
        FILES[k].forEach(function (n) {
          fetch(BASE + 'sounds/' + n + '.mp3').then(function (r) { return r.arrayBuffer(); })
            .then(function (a) { return new Promise(function (ok, no) { ctx.decodeAudioData(a, ok, no); }); })
            .then(function (b) { bufs[k].push(b); }).catch(function () {});
        });
      });
      if (musicOn) startMusic();
    }
    function unlock() {
      init();
      if (ctx && ctx.state === 'suspended') { var r = ctx.resume(); if (r && r.catch) r.catch(function () {}); }
    }
    ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { window.addEventListener(ev, unlock, { capture: true, passive: true }); });
    try { unlock(); } catch (e) {}
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });

    function ok() { return ctx && ctx.state === 'running'; }
    function sample(k, vol, rate, delay) {
      var list = bufs[k];
      if (!ok() || !list || !list.length) return 0;
      var s = ctx.createBufferSource(), g = ctx.createGain(), b = list[Math.floor(Math.random() * list.length)];
      s.buffer = b; s.playbackRate.value = rate || (0.95 + Math.random() * 0.1);
      g.gain.value = vol == null ? 0.7 : vol;
      s.connect(g); g.connect(sfx); s.start(ctx.currentTime + (delay || 0));
      return b.duration / s.playbackRate.value;
    }
    var rattleUntil = 0, lastDie = 0;
    var S = {
      chip: function () { sample('chip', 0.6); },
      chips: function () { sample('chips', 0.7); },
      clear: function () { sample('handle', 0.6); },
      placed: function () { sample('clack', 0.7); },
      gather: function () { sample('grab', 0.75); },
      rattle: function () { // the cup shaking: one shake sample after the other
        if (!ok() || ctx.currentTime < rattleUntil) return;
        rattleUntil = ctx.currentTime + sample('shake', 0.7, 0.98 + Math.random() * 0.08) * 0.8;
      },
      tip: function () { rattleUntil = 0; sample('pour', 0.85); },
      impact: function (s) { // a die landing / knocking: soft, at most ~10 per second
        if (!ok() || ctx.currentTime - lastDie < 0.09) return;
        lastDie = ctx.currentTime; sample('die', 0.12 + 0.4 * (s || 0.5), 1 + Math.random() * 0.15);
      },
      count: function (hi) { sample(hi ? 'countHi' : 'count', 0.55); },
      open: function () { sample('open', 0.32); },
      closed: function () { sample('closed', 0.38); },
      reveal: function () { sample('sparkle', 0.3); },
      win: function (big) { sample('win', 0.7); sample('sparkle', 0.35, 1, 0.18); if (big) sample('bigwin', 0.6, 1, 0.1); },
      lose: function () { sample('lose', 0.4); },
      error: function () { sample('error', 0.5); },
    };

    // ---------------------------------------------------------------- music: a festive mela loop (generated)
    // Sa = D (146.8 Hz); Bilawal (major) scale over two octaves; 8 beats per bar at 112 bpm.
    var SA = 146.8, SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19].map(function (s) { return SA * Math.pow(2, s / 12); });
    var BEAT = 60 / 112, mel = 4;
    function drone(t, dur) { // tanpura: Pa – Sa – Sa – low Sa, with a buzzy shimmer
      [SA * 0.75, SA, SA, SA / 2].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), at = t + i * dur / 4;
        o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, at); lp.frequency.exponentialRampToValueAtTime(400, at + dur * 0.9);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.03, at + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.95);
        o.connect(lp); lp.connect(g); g.connect(mus); o.start(at); o.stop(at + dur);
      });
    }
    function santoor(f, t, g) { // hammered strings: two slightly detuned partials, bright attack, ringing decay
      [1, 1.003, 2.01].forEach(function (m, i) {
        var o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = i === 2 ? 'sine' : 'triangle'; o.frequency.value = f * m;
        gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g * (i === 2 ? 0.35 : 0.6), t + 0.004); gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        o.connect(gn); gn.connect(mus); gn.connect(verb); o.start(t); o.stop(t + 1.2);
      });
    }
    function tabla(kind, t, g) { // dha (bass + ring), na (ring), ge (bass glide), ti (click)
      if (kind === 'dha' || kind === 'ge') {
        var o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(kind === 'ge' ? 95 : 120, t); o.frequency.exponentialRampToValueAtTime(kind === 'ge' ? 140 : 75, t + 0.22);
        gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g * 1.6, t + 0.004); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(gn); gn.connect(mus); o.start(t); o.stop(t + 0.32);
      }
      if (kind === 'dha' || kind === 'na') {
        var r = ctx.createOscillator(), gr = ctx.createGain();
        r.type = 'sine'; r.frequency.value = SA * 4;
        gr.gain.setValueAtTime(0.0001, t); gr.gain.exponentialRampToValueAtTime(g * 0.7, t + 0.002); gr.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        r.connect(gr); gr.connect(mus); r.start(t); r.stop(t + 0.27);
      }
      if (kind === 'ti') {
        var c = ctx.createOscillator(), gc = ctx.createGain();
        c.type = 'square'; c.frequency.value = 1900;
        gc.gain.setValueAtTime(0.0001, t); gc.gain.exponentialRampToValueAtTime(g * 0.2, t + 0.001); gc.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        c.connect(gc); gc.connect(mus); c.start(t); c.stop(t + 0.04);
      }
    }
    var THEKA = ['dha', 'ti', 'na', 'dha', 'ge', 'na', 'dha', 'ti']; // a lively keherwa-like cycle
    function scheduleBar(t) {
      drone(t, BEAT * 8);
      for (var b = 0; b < 8; b++) {
        tabla(THEKA[b], t + b * BEAT, 0.05);
        if (b % 2 === 1 && Math.random() < 0.5) tabla('ti', t + (b + 0.5) * BEAT, 0.05);
        if (Math.random() < (b % 2 ? 0.45 : 0.8)) {
          mel = Math.max(0, Math.min(SCALE.length - 1, mel + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
          santoor(SCALE[mel], t + b * BEAT, 0.05 + Math.random() * 0.02);
          if (Math.random() < 0.35) santoor(SCALE[mel], t + (b + 0.5) * BEAT, 0.03); // the santoor's quick repeat
        }
      }
      if (bar % 4 === 3) santoor(SCALE[7], t + BEAT * 7.5, 0.05);
      bar++;
    }
    function startMusic() {
      if (!ctx || musicTimer) return;
      nextBar = ctx.currentTime + 0.2;
      musicTimer = setInterval(function () {
        if (!ctx || ctx.state !== 'running') return;
        if (nextBar < ctx.currentTime) nextBar = ctx.currentTime + 0.05;
        while (nextBar < ctx.currentTime + 1.5) { scheduleBar(nextBar); nextBar += BEAT * 8; }
      }, 300);
    }
    function stopMusic() { clearInterval(musicTimer); musicTimer = 0; }

    return {
      play: function (name, a) { if (soundOn && S[name]) try { S[name](a); } catch (e) {} },
      sound: function (v) {
        if (v === undefined) return soundOn;
        soundOn = !!v; safeSet('jhandimunda:sound', v ? '1' : '0');
        if (sfx) sfx.gain.value = v ? 1 : 0;
      },
      music: function (v) {
        if (v === undefined) return musicOn;
        musicOn = !!v; safeSet('jhandimunda:music', v ? '1' : '0');
        unlock();
        if (mus && ctx) mus.gain.setTargetAtTime(v ? MUSIC_VOL : 0, ctx.currentTime, 0.2);
        if (v) startMusic(); else stopMusic();
      },
    };
  }
  window.JMAudio = { create: create };
})();
