/* Jewel Drum — sounds. Every sound is a real recording (CC0, sources in sounds/LICENSES.txt):
 * chips from Kenney "Casino Audio"; the drum's ratchet (a light metal tick per jewel passing the
 * pointer), the countdown (wood taps), the bells for "bets open", "no more bets", the landing and
 * the win (struck bells + a glass sparkle) from Kenney "Impact Sounds"; a CC0 lounge music loop.
 * No synthesized tones. Music and sound toggle separately; music starts on the first touch
 * (browsers block autoplay until then).
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
    ratchet: ['tick1', 'tick2', 'tick3'],
    wood: ['wood1', 'wood2'],
    bellOpen: ['bell3'],
    bellClose: ['bell4'],
    bellLand: ['bell1'],
    bellWin: ['bell2'],
    glass: ['glass1', 'glass2'],
    soft: ['soft1'],
  };

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master = null, sfx = null, mus = null, bufs = {}, musicEl = null, musicSrc = null;
    var soundOn = safeGet('jeweldrum:sound') !== '0', musicOn = safeGet('jeweldrum:music') !== '0';
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
      musicEl = new Audio(BASE + 'sounds/lounge1.mp3');
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

    function sample(k, vol, rate, delay) {
      var list = bufs[k];
      if (!ctx || !list || !list.length) return;
      var s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = list[Math.floor(Math.random() * list.length)];
      s.playbackRate.value = rate || (0.95 + Math.random() * 0.1);
      g.gain.value = vol == null ? 0.7 : vol;
      s.connect(g); g.connect(sfx); s.start(ctx.currentTime + (delay || 0));
    }
    var lastClick = 0;
    function click(speed) { // the drum's ratchet: one light metal tick per jewel passing the pointer
      var now = ctx.currentTime, v = Math.min(1, speed);
      if (now - lastClick < 0.05) return; // at full roll (~19 jewels/s) every jewel still ticks
      lastClick = now;
      sample('ratchet', 0.13 - 0.05 * v, 0.9 + 0.25 * v); // softer and a touch higher while fast
    }

    function play(name, a) {
      if (!ctx || !soundOn) return;
      switch (name) {
        case 'chip': sample('chip', 0.6); break;
        case 'chips': sample('chips', 0.7); break;
        case 'clear': sample('handle', 0.6); break;
        case 'placed': sample('clack', 0.7); break;
        case 'click': click(a || 0); break;
        case 'tick': sample('wood', a ? 0.34 : 0.24, a ? 1.12 : 1); break;
        case 'open': sample('bellOpen', 0.22, 1.12); break;
        case 'closed': sample('bellClose', 0.26, 0.9); break;
        case 'land': sample('bellLand', 0.36, 1); break;
        case 'win': sample('bellWin', a ? 0.5 : 0.4, 1.06); sample('glass', 0.2, 1.2, 0.14); if (a) { sample('glass', 0.18, 1.35, 0.32); sample('bellWin', 0.22, 1.33, 0.45); } break;
        case 'lose': sample('soft', 0.16, 0.9); break;
        case 'error': sample('soft', 0.22, 0.75); break;
      }
    }
    function setSound(v) { soundOn = v; safeSet('jeweldrum:sound', v ? '1' : '0'); if (sfx) sfx.gain.value = v ? 1 : 0; }
    function setMusic(v) {
      musicOn = v; safeSet('jeweldrum:music', v ? '1' : '0');
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
  window.JDAudio = { create: create };
})();
