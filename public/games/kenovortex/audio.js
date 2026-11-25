/* Keno Vortex — sounds. Recorded CC0 chips (Kenney "Casino Audio") and a CC0 chill music loop
 * ("Chill (Loopable)" by Pro Sensory) — see sounds/LICENSES.txt; the blower's air, the ball whoosh and
 * landing, the countdown tick and the chimes are generated in code (WebAudio). Music and sound toggle
 * separately; both start on the first touch (browsers block autoplay until then).
 */
(function () {
  'use strict';
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  var BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var FILES = { chip: ['chiplay1', 'chiplay2', 'chiplay3'], clack: ['chipcollide1', 'chipcollide2'], handle: ['chiphandle1'] };


  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master = null, sfx = null, mus = null, bufs = {}, noise = null, air = null, airGain = null, musicEl = null, musicSrc = null;
    var soundOn = safeGet('kenovortex:sound') !== '0', musicOn = safeGet('kenovortex:music') !== '0';
    var unlocked = false;

    function init() {
      if (ctx || !AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
      mus = ctx.createGain(); mus.gain.value = musicOn ? 0.3 : 0; mus.connect(master);
      var len = ctx.sampleRate * 2, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noise = nb;
      Object.keys(FILES).forEach(function (k) {
        bufs[k] = [];
        FILES[k].forEach(function (n) {
          fetch(BASE + 'sounds/' + n + '.mp3').then(function (r) { return r.arrayBuffer(); })
            .then(function (a) { return new Promise(function (ok, no) { ctx.decodeAudioData(a, ok, no); }); })
            .then(function (b) { bufs[k].push(b); }).catch(function () {});
        });
      });
    }
    function unlock() {
      if (unlocked) return;
      init();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      unlocked = true;
      startMusic();
      if (airWanted) blower(true);
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, unlock, { capture: true, passive: true }); });
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) { ctx.suspend(); if (musicEl) musicEl.pause(); }
      else { ctx.resume(); if (musicEl && musicOn) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); } }
    });

    // ---- music: the CC0 loop through the music gain (falls back to the element's own volume)
    function startMusic() {
      if (!ctx || musicEl) return;
      musicEl = new Audio(BASE + 'sounds/music.mp3');
      musicEl.loop = true; musicEl.crossOrigin = 'anonymous';
      try { musicSrc = ctx.createMediaElementSource(musicEl); musicSrc.connect(mus); } catch (e) { musicEl.volume = musicOn ? 0.3 : 0; }
      if (musicOn) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); }
    }

    // ---- effects
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
      var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + (t0 || 0);
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + 0.05);
    }
    function whoosh(rise) {
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
      s.buffer = noise; f.type = 'bandpass'; f.Q.value = 1.6;
      f.frequency.setValueAtTime(rise ? 500 : 1800, t); f.frequency.exponentialRampToValueAtTime(rise ? 2600 : 500, t + 0.55);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      s.connect(f); f.connect(g); g.connect(sfx); s.start(t, Math.random()); s.stop(t + 0.75);
    }
    var airWanted = false;
    function blower(on) { // the machine's air: a soft, filtered noise bed while the balls fly
      airWanted = on;
      if (!ctx) return;
      var t = ctx.currentTime;
      if (on && !air) {
        air = ctx.createBufferSource(); air.buffer = noise; air.loop = true;
        var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
        airGain = ctx.createGain(); airGain.gain.setValueAtTime(0.0001, t); airGain.gain.exponentialRampToValueAtTime(0.07, t + 1.1);
        air.connect(f); f.connect(airGain); airGain.connect(sfx); air.start(t);
      } else if (!on && air) {
        var a = air, g = airGain; air = null; airGain = null;
        g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        a.stop(t + 1.3);
      }
    }

    function play(name, a) {
      if (name === 'blower-on') return blower(true);
      if (name === 'blower-off') return blower(false);
      if (!ctx || !soundOn) return;
      switch (name) {
        case 'pick': tone(520 + (a || 0) * 9, 0, 0.16, 0.08, 'triangle'); break;
        case 'unpick': tone(330 + (a || 0) * 5, 0, 0.12, 0.06, 'triangle'); break;
        case 'quick': [784, 988, 1175, 1568].forEach(function (f, i) { tone(f, i * 0.05, 0.25, 0.06, 'triangle'); }); break;
        case 'chip': sample('chip', 0.55); break;
        case 'clear': sample('handle', 0.55); break;
        case 'placed': sample('clack', 0.7); tone(988, 0.04, 0.35, 0.06); break;
        case 'tick': tone(a ? 1320 : 990, 0, 0.09, 0.11, 'triangle'); break;
        case 'open': tone(660, 0, 0.35, 0.08); tone(990, 0.12, 0.45, 0.08); break;
        case 'closed': tone(880, 0, 0.3, 0.1); tone(587, 0.16, 0.5, 0.1); break;
        case 'whoosh': whoosh(true); break;
        case 'return': whoosh(false); break;
        case 'land': tone(1250, 0, 0.07, 0.09, 'square'); tone(620, 0.005, 0.12, 0.05, 'triangle'); break;
        case 'hit': tone(1047, 0, 0.5, 0.11, 'triangle'); tone(1568, 0.06, 0.6, 0.07); break;
        case 'win': [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.11, 0.7, a ? 0.15 : 0.11); }); if (a) tone(1568, 0.5, 1.1, 0.09); break;
        case 'lose': tone(330, 0, 0.4, 0.06, 'triangle'); break;
        case 'error': tone(220, 0, 0.18, 0.09, 'square'); break;
      }
    }
    function setSound(v) { soundOn = v; safeSet('kenovortex:sound', v ? '1' : '0'); if (sfx) sfx.gain.value = v ? 1 : 0; }
    function setMusic(v) {
      musicOn = v; safeSet('kenovortex:music', v ? '1' : '0');
      if (mus) mus.gain.value = v ? 0.3 : 0;
      if (musicEl && !musicSrc) musicEl.volume = v ? 0.3 : 0;
      if (v && musicEl && musicEl.paused) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); }
    }
    return {
      play: play,
      sound: function (v) { if (v === undefined) return soundOn; setSound(!!v); },
      music: function (v) { if (v === undefined) return musicOn; setMusic(!!v); },
    };
  }
  window.KVAudio = { create: create };
})();
