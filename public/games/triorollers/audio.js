/* Trio Rollers — sounds. Every sound is a recorded CC0 sample (sounds/LICENSES.txt): Kenney casino
 * chips, interface clicks/chimes, metal impacts and a steel-drum jingle, plus a CC0 lounge music loop.
 * Music and sound toggle separately (remembered); music starts at once where the browser allows
 * autoplay (the site's launch tap), else on the first touch.
 */
(function () {
  'use strict';
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var FILES = {
    chip: ['chiplay1', 'chiplay2', 'chiplay3'], chips: ['chipstack1', 'chipstack2', 'chipstack3'],
    clack: ['chipcollide1'], handle: ['chiphandle1'],
    tick: ['tick1', 'tick2', 'tick3'], lock: ['lock1', 'lock2', 'lock3'],
    open: ['open'], closed: ['closed'], count: ['count1'], countHi: ['count2'],
    win: ['win'], sparkle: ['sparkle1', 'sparkle2'], bigwin: ['bigwin'], lose: ['lose'], error: ['error'],
  };
  var MUSIC_VOL = 0.3;

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, sfx = null, mus = null, bufs = {}, musicEl = null, musicSrc = null, unlocked = false;
    var soundOn = safeGet('triorollers:sound') !== '0', musicOn = safeGet('triorollers:music') !== '0';

    function init() {
      if (ctx || !AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      var master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
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
      if (musicOn) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); }
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
        case 'tick': { // a roller's ratchet: a soft click per digit, at most ~14 per second
          var now = ctx.currentTime;
          if (now - lastTick < 0.07) return;
          lastTick = now; sample('tick', 0.1 + 0.16 * (1 - Math.min(1, a || 0)), 0.9 + Math.random() * 0.2); break;
        }
        case 'lock': sample('lock', 0.75, a ? 0.92 : 1); break;
        case 'count': sample(a ? 'countHi' : 'count', 0.55); break;
        case 'open': sample('open', 0.35); break;
        case 'closed': sample('closed', 0.4); break;
        case 'win': sample('win', 0.7); sample('sparkle', 0.35, 1, 0.18); if (a) sample('bigwin', 0.6, 1, 0.1); break;
        case 'lose': sample('lose', 0.4); break;
        case 'error': sample('error', 0.5); break;
      }
    }
    function setSound(v) { soundOn = v; safeSet('triorollers:sound', v ? '1' : '0'); if (sfx) sfx.gain.value = v ? 1 : 0; }
    function setMusic(v) {
      musicOn = v; safeSet('triorollers:music', v ? '1' : '0');
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
  window.TRAudio = { create: create };
})();
