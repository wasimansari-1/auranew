/* Orbit 36 — sounds. Every sound is a real recording (CC0, sources in sounds/LICENSES.txt); nothing
 * is synthesized. Music and sound toggle separately (remembered); music starts at once where the
 * browser allows autoplay (the site's launch tap), else on the first touch; both pause while the
 * tab is hidden.
 */
(function () {
  'use strict';
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var FILES = {
    pick: ['pick1', 'pick2', 'pick3'],          // a number marked on the ticket (glass tap)
    chip: ['chiplay1', 'chiplay2', 'chiplay3'], // a side-bet chip
    chips: ['chipstack1', 'chipstack2'],         // bets placed
    clear: ['chiphandle1'],
    placed: ['chipcollide1'],
    clink: ['clink1', 'clink2', 'clink3'],       // a ball settles in its cup
    tick: ['tick1', 'tick2'],                    // the last seconds of betting
    bonus: ['bell1'],                            // the bonus ball lands
    closed: ['bell2'],                           // no more bets
    open: ['open'],                              // bets open
    match: ['match'],                            // a drawn ball is on your ticket
    win: ['win1'], win2: ['win2'], bigwin: ['bigwin'],
    soft: ['soft1'],                             // refused / no win
  };
  var VOL = { pick: 0.45, chip: 0.6, chips: 0.7, clear: 0.55, placed: 0.7, clink: 0.5, tick: 0.35, bonus: 0.45, closed: 0.4, open: 0.4, match: 0.55, win: 0.7, win2: 0.75, bigwin: 0.8, soft: 0.45 };

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, sfx = null, mus = null, bufs = {}, musicEl = null, musicSrc = null;
    var soundOn = safeGet('orbit36:sound') !== '0', musicOn = safeGet('orbit36:music') !== '0';
    var unlocked = false;
    var MUSIC_VOL = 0.3;

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

    function play(name, delay, rate) {
      if (!ctx || !soundOn || ctx.state !== 'running') return;
      var list = bufs[name];
      if (!list || !list.length) return;
      var s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = list[Math.floor(Math.random() * list.length)];
      s.playbackRate.value = rate || (0.97 + Math.random() * 0.06);
      g.gain.value = VOL[name] == null ? 0.6 : VOL[name];
      s.connect(g); g.connect(sfx); s.start(ctx.currentTime + (delay || 0));
    }
    function setSound(v) { soundOn = v; safeSet('orbit36:sound', v ? '1' : '0'); if (sfx) sfx.gain.value = v ? 1 : 0; }
    function setMusic(v) {
      musicOn = v; safeSet('orbit36:music', v ? '1' : '0');
      if (mus) mus.gain.value = v ? MUSIC_VOL : 0;
      if (musicEl && !musicSrc) musicEl.volume = v ? MUSIC_VOL : 0;
      if (v && musicEl && musicEl.paused) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); }
      if (!v && musicEl && !musicEl.paused) musicEl.pause();
    }
    return {
      play: play,
      sound: function (v) { if (v === undefined) return soundOn; setSound(!!v); },
      music: function (v) { if (v === undefined) return musicOn; setMusic(!!v); },
    };
  }
  window.O36Audio = { create: create };
})();
