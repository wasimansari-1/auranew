/* Bingo Orbit — sound: recorded CC0 effects (Kenney Casino Audio + Impact Sounds) and a CC0 lounge
 * track (see sounds/LICENSES.txt). Nothing is synthesized. Music and effects have separate switches
 * (remembered). Nothing plays before the first tap (browsers block it); the effects are decoded
 * then, the music streams and pauses while the page is hidden.
 *
 *   BOAudio.unlock() · .sound(on) · .music(on) · .soundOn · .musicOn
 *   BOAudio.tick(last) · .rattle(on) · .pop() · .land() · .daub(k) · .pattern(level) · .win(big) · .click() · .armed() · .refused()
 */
(function () {
  'use strict';
  var base = new URL('sounds/', document.currentScript ? document.currentScript.src : location.href).href;
  var FILES = ['tick1', 'tick2', 'tick3', 'wood1', 'wood2', 'bell1', 'bell2', 'bell3', 'glass1', 'glass2',
    'chiplay1', 'chiplay2', 'chiplay3', 'chipstack1', 'chipstack2', 'chipstack3', 'chipcollide1', 'chiphandle1', 'soft1'];
  var ctx = null, sfx = null, buf = {}, soundOn = true, musicOn = true, unlocked = false, music = null, rattleTimer = 0;
  try { soundOn = localStorage.getItem('bingoorbit-sound') !== 'off'; musicOn = localStorage.getItem('bingoorbit-music') !== 'off'; } catch (e) { /* defaults */ }

  function ac() {
    if (!unlocked) return null; // no context before the first tap
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      sfx = ctx.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(ctx.destination);
      FILES.forEach(function (name) { // decode every effect once
        fetch(base + name + '.mp3').then(function (r) { return r.arrayBuffer(); })
          .then(function (a) { return new Promise(function (ok, no) { ctx.decodeAudioData(a, ok, no); }); })
          .then(function (b) { buf[name] = b; }).catch(function () { /* that one stays silent */ });
      });
    }
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(function () {});
    return ctx;
  }
  // play a recorded effect: volume, playback rate (pitch), delay in seconds
  function play(name, vol, rate, when) {
    var c = ac();
    if (!c || !soundOn || !buf[name]) return;
    var s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf[name]; s.playbackRate.value = rate || 1;
    g.gain.value = vol == null ? 1 : vol;
    s.connect(g).connect(sfx);
    s.start(c.currentTime + (when || 0));
  }
  function any(prefix, n) { return prefix + (1 + Math.floor(Math.random() * n)); }

  // ---------------------------------------------------------------- music (streamed, looped)
  function syncMusic() {
    if (!unlocked) return;
    if (!music) {
      music = new Audio(); music.src = base + 'lounge2.mp3'; music.loop = true; music.preload = 'none'; music.volume = 0.28;
    }
    if (musicOn && !document.hidden) music.play().catch(function () {}); else music.pause();
  }
  document.addEventListener('visibilitychange', function () {
    if (ctx) { if (document.hidden) ctx.suspend().catch(function () {}); else ctx.resume().catch(function () {}); }
    syncMusic();
  });

  window.BOAudio = {
    get soundOn() { return soundOn; },
    get musicOn() { return musicOn; },
    unlock: function () { unlocked = true; ac(); syncMusic(); },
    sound: function (on) {
      soundOn = on;
      try { localStorage.setItem('bingoorbit-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
      if (ctx) sfx.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05);
      if (!on) this.rattle(false);
    },
    music: function (on) {
      musicOn = on;
      try { localStorage.setItem('bingoorbit-music', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
      syncMusic();
    },
    tick: function (last) { play(last ? 'wood2' : 'wood1', last ? 0.8 : 0.55); },
    // the cage rattle during the draw: scattered soft clicks of balls on balls and on the wires
    rattle: function (on) {
      clearInterval(rattleTimer);
      if (!on || !soundOn || !ac()) return;
      rattleTimer = setInterval(function () {
        if (Math.random() < 0.6) play(any('tick', 3), 0.08 + Math.random() * 0.06, 1.3 + Math.random() * 0.5, Math.random() * 0.1);
        if (Math.random() < 0.35) play('chipcollide1', 0.07 + Math.random() * 0.05, 1.4 + Math.random() * 0.4, Math.random() * 0.12);
      }, 140);
    },
    pop: function () { play(any('tick', 3), 0.45, 1.1); },
    land: function () { play(any('chiplay', 3), 0.6); },
    daub: function (k) { play(any('chipstack', 3), 0.75, 1 + Math.min(k, 10) * 0.02); },
    pattern: function (level) { play('bell3', 0.45 + level * 0.05); play(any('glass', 2), 0.5, 1, 0.05); },
    win: function (big) {
      play('bell2', 0.8); play('glass1', 0.55, 1, 0.12); play('glass2', 0.5, 1.1, 0.28);
      if (big) play('bell1', 0.7, 1, 0.35);
    },
    click: function () { play('chipcollide1', 0.4, 1.2); },
    armed: function () { play('chiphandle1', 0.7); },
    refused: function () { play('soft1', 0.6); },
  };
})();
