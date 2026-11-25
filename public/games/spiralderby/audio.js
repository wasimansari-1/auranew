/* Spiral Derby — sounds. Only recorded CC0 sounds (sounds/LICENSES.txt): Kenney chips and impacts,
 * a marble-rolling loop and a CC0 music loop. Music and sound toggle separately; music starts at
 * once where the browser allows autoplay, else on the first touch.
 *   play(name, level)  chip | chips | clear | placed | tick | open | closed | gate | clack | bump |
 *                      cross (the winner crosses) | park | win | lose | error
 *   roll(level 0–1)    the rolling loop's level (smoothed; 0 = silent)
 */
(function () {
  'use strict';
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var FILES = {
    chip: ['chiplay1', 'chiplay2', 'chiplay3'], chips: ['chipstack1', 'chipstack2', 'chipstack3'], handle: ['chiphandle1'], collide: ['chipcollide1'],
    clack: ['clack1', 'clack2', 'clack3'], bump: ['bump1', 'bump2'], gate: ['gate'], park: ['park'], bell: ['bell'], win: ['win'],
    sparkle: ['sparkle1'], open: ['open'], closed: ['closed'], tick: ['tick1', 'tick2'], soft: ['soft'], roll: ['roll'],
  };
  var MUSIC_VOL = 0.28;

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master = null, sfx = null, mus = null, bufs = {}, musicEl = null, musicSrc = null, rollSrc = null, rollGain = null;
    var soundOn = safeGet('spiralderby:sound') !== '0', musicOn = safeGet('spiralderby:music') !== '0';
    var unlocked = false, rollTarget = 0;

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
            .then(function (b) { bufs[k].push(b); if (k === 'roll') startRoll(); }).catch(function () {});
        });
      });
    }
    function startRoll() { // one looping source; its gain follows the race
      if (rollSrc || !bufs.roll.length) return;
      rollSrc = ctx.createBufferSource(); rollSrc.buffer = bufs.roll[0]; rollSrc.loop = true;
      rollSrc.loopStart = 0.03; rollSrc.loopEnd = Math.max(0.1, rollSrc.buffer.duration - 0.03); // MP3 padding
      rollGain = ctx.createGain(); rollGain.gain.value = 0;
      rollSrc.connect(rollGain); rollGain.connect(sfx); rollSrc.start();
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

    var last = {};
    function sample(k, vol, rate, minGap) {
      var list = bufs[k];
      if (!ctx || !list || !list.length) return;
      var t = ctx.currentTime;
      if (minGap && last[k] && t - last[k] < minGap) return;
      last[k] = t;
      var s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = list[Math.floor(Math.random() * list.length)];
      s.playbackRate.value = rate || (0.95 + Math.random() * 0.1);
      g.gain.value = vol == null ? 0.7 : vol;
      s.connect(g); g.connect(sfx); s.start();
    }

    function play(name, a) {
      if (!ctx || !soundOn) return;
      switch (name) {
        case 'chip': sample('chip', 0.55); break;
        case 'chips': sample('chips', 0.65); break;
        case 'clear': sample('handle', 0.55); break;
        case 'placed': sample('collide', 0.7); break;
        case 'tick': sample('tick', a ? 0.6 : 0.42, a ? 1.15 : 1); break;
        case 'open': sample('open', 0.32); break;
        case 'closed': sample('closed', 0.38); break;
        case 'gate': sample('gate', 0.5); break;
        case 'clack': sample('clack', 0.18 + 0.32 * (a || 0.5), 0.9 + Math.random() * 0.3, 0.06); break;
        case 'bump': sample('bump', 0.22 + 0.2 * (a || 0.5), null, 0.18); break;
        case 'cross': sample('bell', 0.5); break;
        case 'park': sample('park', 0.28, 1.1 + Math.random() * 0.2, 0.05); break;
        case 'win': sample('win', a ? 0.75 : 0.6); setTimeout(function () { sample('sparkle', 0.45); }, 180); if (a) setTimeout(function () { sample('sparkle', 0.4, 1.25); }, 420); break;
        case 'lose': sample('soft', 0.35); break;
        case 'error': sample('soft', 0.5, 0.8); break;
      }
    }
    function roll(level) { // smoothed (no clicks): setTargetAtTime
      if (!rollGain || !ctx) return;
      var v = soundOn ? Math.max(0, Math.min(1, level || 0)) * 0.55 : 0;
      if (Math.abs(v - rollTarget) < 0.01) return;
      rollTarget = v;
      rollGain.gain.setTargetAtTime(v, ctx.currentTime, 0.12);
      if (rollSrc) rollSrc.playbackRate.setTargetAtTime(0.8 + 0.4 * Math.min(1, level || 0), ctx.currentTime, 0.2);
    }
    function setSound(v) { soundOn = v; safeSet('spiralderby:sound', v ? '1' : '0'); if (sfx) sfx.gain.value = v ? 1 : 0; }
    function setMusic(v) {
      musicOn = v; safeSet('spiralderby:music', v ? '1' : '0');
      if (mus) mus.gain.value = v ? MUSIC_VOL : 0;
      if (musicEl && !musicSrc) musicEl.volume = v ? MUSIC_VOL : 0;
      if (v && musicEl && musicEl.paused) { var p = musicEl.play(); if (p && p.catch) p.catch(function () {}); }
    }
    return {
      play: play, roll: roll,
      sound: function (v) { if (v === undefined) return soundOn; setSound(!!v); },
      music: function (v) { if (v === undefined) return musicOn; setMusic(!!v); },
    };
  }
  window.SDAudio = { create: create };
})();
