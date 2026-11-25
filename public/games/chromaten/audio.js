/* Chroma Ten — sounds. Only real recordings, all CC0 (sounds/LICENSES.txt): Kenney casino chips,
 * Kenney impact (drum ratchet, bells) and interface sounds (countdown, win, error), and a CC0 lo-fi
 * music loop. Music and sound toggle separately; music starts at once where the browser allows
 * autoplay, else on the first touch.
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
    tick: ['tick1', 'tick2', 'tick3'],
    count: ['count1'], count2: ['count2'],
    open: ['open'], closed: ['closed'], land: ['land'],
    win: ['win'], sparkle: ['sparkle1', 'sparkle2'],
    lose: ['lose'], error: ['error'],
  };
  var MUSIC_VOL = 0.28;

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master = null, sfx = null, mus = null, bufs = {}, musicEl = null, musicSrc = null;
    var soundOn = safeGet('chromaten:sound') !== '0', musicOn = safeGet('chromaten:music') !== '0';
    var unlocked = false;

    function init() {
      if (ctx || !AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
      mus = ctx.createGain(); mus.gain.value = musicOn ? MUSIC_VOL : 0; mus.connect(master);
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
      musicEl = new Audio(BASE + 'sounds/music.mp3');
      musicEl.loop = true; musicEl.crossOrigin = 'anonymous';
      try { musicSrc = ctx.createMediaElementSource(musicEl); musicSrc.connect(mus); } catch (e) { musicEl.volume = musicOn ? MUSIC_VOL : 0; }
      var p = musicEl.play(); if (p && p.catch) p.catch(function () {});
    }
    function unlock() {
      if (unlocked) return;
      init();
      if (!ctx) return;
      if (ctx.state === 'suspended') { var r = ctx.resume(); if (r && r.catch) r.catch(function () {}); }
      startMusic();
      if (musicEl && musicEl.paused && musicOn) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); }
      unlocked = ctx.state === 'running' && !!musicEl && (!musicEl.paused || !musicOn);
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, unlock, { capture: true, passive: true }); });
    unlock();
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) { ctx.suspend(); if (musicEl) musicEl.pause(); }
      else { ctx.resume(); if (musicEl && musicOn) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); } }
    });

    function sample(k, vol, rate, delay) {
      var list = bufs[k];
      if (!ctx || !list || !list.length) return;
      var s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = list[Math.floor(Math.random() * list.length)];
      s.playbackRate.value = rate || (0.96 + Math.random() * 0.08);
      g.gain.value = vol == null ? 0.7 : vol;
      s.connect(g); g.connect(sfx); s.start(ctx.currentTime + (delay || 0));
    }
    var lastTick = 0;
    function play(name, a) {
      if (!ctx || !soundOn) return;
      switch (name) {
        case 'chip': sample('chip', 0.6); break;
        case 'chips': sample('chips', 0.7); break;
        case 'clear': sample('handle', 0.6); break;
        case 'placed': sample('clack', 0.7); break;
        case 'tick': { // the drum ratchet: one tick per tile passing the pointers, softer at full speed
          var now = ctx.currentTime;
          if (now - lastTick < 0.045) return;
          lastTick = now;
          var sp = Math.min(1, a || 0);
          sample('tick', 0.42 - 0.22 * sp, 0.9 + 0.35 * sp);
          break;
        }
        case 'count': sample(a ? 'count2' : 'count', a ? 0.55 : 0.45, 1); break;
        case 'open': sample('open', 0.32, 1.1); break;
        case 'closed': sample('closed', 0.4); break;
        case 'land': sample('land', 0.5, 1); break;
        case 'win': sample('win', 0.55, 1); sample('sparkle', 0.35, 1, 0.18); if (a) sample('sparkle', 0.35, 1.2, 0.42); break;
        case 'lose': sample('lose', 0.35, 1); break;
        case 'error': sample('error', 0.4, 1); break;
      }
    }
    function setSound(v) { soundOn = v; safeSet('chromaten:sound', v ? '1' : '0'); if (sfx) sfx.gain.value = v ? 1 : 0; }
    function setMusic(v) {
      musicOn = v; safeSet('chromaten:music', v ? '1' : '0');
      if (mus) mus.gain.value = v ? MUSIC_VOL : 0;
      if (musicEl && !musicSrc) musicEl.volume = v ? MUSIC_VOL : 0;
      if (v && musicEl && musicEl.paused) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); }
    }
    return {
      play: play,
      sound: function (v) { if (v === undefined) return soundOn; setSound(!!v); },
      music: function (v) { if (v === undefined) return musicOn; setMusic(!!v); },
    };
  }
  window.CTAudio = { create: create };
})();
