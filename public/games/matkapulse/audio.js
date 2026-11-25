/* Matka Pulse — sounds. Recorded CC0 chips (Kenney "Casino Audio", sounds/LICENSES.txt) and a CC0
 * lounge music loop; the pot's air rush, the ball pop, the countdown tick, the "no more bets" chime
 * and the win chime are generated in code (WebAudio). Music and sound toggle separately; music starts
 * on the first touch (browsers block autoplay until then).
 */
(function () {
  'use strict';
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var FILES = {
    chip: ['chiplay1', 'chiplay2', 'chiplay3'],
    chips: ['chipstack1', 'chipstack2', 'chipstack3'],
    clack: ['chipcollide1'],
    handle: ['chiphandle1'],
  };

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master = null, sfx = null, mus = null, bufs = {}, musicEl = null, musicSrc = null;
    var soundOn = safeGet('matkapulse:sound') !== '0', musicOn = safeGet('matkapulse:music') !== '0';
    var unlocked = false;

    function init() {
      if (ctx || !AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
      mus = ctx.createGain(); mus.gain.value = musicOn ? 0.32 : 0; mus.connect(master);
      Object.keys(FILES).forEach(function (k) {
        bufs[k] = [];
        FILES[k].forEach(function (n) {
          fetch(BASE + 'sounds/' + n + '.mp3').then(function (r) { return r.arrayBuffer(); })
            .then(function (a) { return new Promise(function (ok, no) { ctx.decodeAudioData(a, ok, no); }); })
            .then(function (b) { bufs[k].push(b); }).catch(function () {});
        });
      });
    }
    function startMusic() {
      if (!ctx || musicEl) return;
      musicEl = new Audio(BASE + 'sounds/lounge2.mp3');
      musicEl.loop = true; musicEl.crossOrigin = 'anonymous';
      try { musicSrc = ctx.createMediaElementSource(musicEl); musicSrc.connect(mus); } catch (e) { musicEl.volume = musicOn ? 0.32 : 0; }
      var p = musicEl.play(); if (p && p.catch) p.catch(function () {});
    }
    function unlock() {
      if (unlocked) return;
      init();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      unlocked = true;
      startMusic();
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, unlock, { capture: true, passive: true }); });
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) { ctx.suspend(); if (musicEl) musicEl.pause(); }
      else { ctx.resume(); if (musicEl && musicOn) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); } }
    });

    function sample(k, vol, rate) {
      var list = bufs[k];
      if (!ctx || !list || !list.length) return;
      var s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = list[Math.floor(Math.random() * list.length)];
      s.playbackRate.value = rate || (0.95 + Math.random() * 0.1);
      g.gain.value = vol == null ? 0.7 : vol;
      s.connect(g); g.connect(sfx); s.start();
    }
    function tone(freq, t0, dur, vol, type) {
      var o = ctx.createOscillator(), g = ctx.createGain(), now = ctx.currentTime + (t0 || 0);
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(sfx); o.start(now); o.stop(now + dur + 0.05);
    }
    function noise(t0, dur, vol, freq, q) { // a soft filtered noise burst (the pot's air rush)
      var n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), ch = buf.getChannelData(0);
      for (var i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), at = ctx.currentTime + (t0 || 0);
      s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq || 700; f.Q.value = q || 0.8; g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(sfx); s.start(at);
    }
    function play(name, a) {
      if (!ctx || !soundOn) return;
      switch (name) {
        case 'chip': sample('chip', 0.6); break;
        case 'chips': sample('chips', 0.7); break;
        case 'clear': sample('handle', 0.6); break;
        case 'placed': sample('clack', 0.7); break;
        case 'rumble': noise(0, 1.6, 0.16, 520, 0.7); break;
        case 'pop': tone(520, 0, 0.12, 0.12, 'triangle'); tone(1040, 0.05, 0.25, 0.08); break;
        case 'tile': sample('clack', 0.45, 1.25); break;
        case 'sort': sample('chips', 0.35, 1.1); break;
        case 'tick': tone(a ? 1320 : 990, 0, 0.09, 0.12, 'triangle'); break;
        case 'open': tone(660, 0, 0.35, 0.1); tone(990, 0.12, 0.45, 0.1); break;
        case 'closed': tone(880, 0, 0.3, 0.12); tone(587, 0.16, 0.5, 0.12); break;
        case 'reveal': tone(392, 0, 0.5, 0.14, 'triangle'); tone(784, 0.02, 0.7, 0.08); tone(1175, 0.12, 0.6, 0.06); break;
        case 'win': [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.11, 0.7, a ? 0.16 : 0.12); }); if (a) tone(1568, 0.5, 1.1, 0.1); break;
        case 'lose': tone(330, 0, 0.4, 0.07, 'triangle'); break;
        case 'error': tone(220, 0, 0.18, 0.1, 'square'); break;
      }
    }
    function setSound(v) { soundOn = v; safeSet('matkapulse:sound', v ? '1' : '0'); if (sfx) sfx.gain.value = v ? 1 : 0; }
    function setMusic(v) {
      musicOn = v; safeSet('matkapulse:music', v ? '1' : '0');
      if (mus) mus.gain.value = v ? 0.32 : 0;
      if (musicEl && !musicSrc) musicEl.volume = v ? 0.32 : 0;
      if (v && musicEl && musicEl.paused) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); }
    }
    return {
      play: play,
      sound: function (v) { if (v === undefined) return soundOn; setSound(!!v); },
      music: function (v) { if (v === undefined) return musicOn; setMusic(!!v); },
    };
  }
  window.MPAudio = { create: create };
})();
