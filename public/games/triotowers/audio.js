/* Trio Towers — sounds, all generated with WebAudio (no audio files): the air in the towers, a ball
 * released through the gate, rolling down the glass chute and seating in its gold cradle, chips,
 * timer ticks, the sum chime, win chimes and an ambient studio music loop (soft pads and a slow
 * arpeggio). Music and sound toggle separately and are remembered.
 *
 *   var a = TrioAudio.create(); a.play('chip'); a.music(true|false); a.sound(true|false)
 */
(function () {
  'use strict';
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master = null, sfx = null, mus = null, noiseBuf = null, verb = null;
    var soundOn = safeGet('triotowers:sound') !== '0', musicOn = safeGet('triotowers:music') !== '0';
    var musicTimer = 0, nextBar = 0, bar = 0;

    function init() {
      if (ctx || !AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
      mus = ctx.createGain(); mus.gain.value = musicOn ? 0.42 : 0; mus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      verb = ctx.createDelay(); verb.delayTime.value = 0.13;
      var fb = ctx.createGain(); fb.gain.value = 0.36;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      var wet = ctx.createGain(); wet.gain.value = 0.45;
      verb.connect(lp); lp.connect(fb); fb.connect(verb); lp.connect(wet); wet.connect(master);
      if (musicOn) startMusic();
    }
    function unlock() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
    ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { window.addEventListener(ev, unlock, { passive: true }); });
    try { init(); } catch (e) {}

    function ok() { return ctx && ctx.state === 'running'; }
    function tone(o) {
      var t = ctx.currentTime + (o.at || 0), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      osc.connect(g); g.connect(o.dest || sfx);
      if (o.verb) g.connect(verb);
      osc.start(t); osc.stop(t + o.dur + 0.05);
    }
    function noise(o) {
      var t = ctx.currentTime + (o.at || 0), src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuf; bp.type = o.type || 'bandpass'; bp.frequency.setValueAtTime(o.f || 3000, t); bp.Q.value = o.q || 1.5;
      if (o.to) bp.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.attack || 0.003));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(bp); bp.connect(g); g.connect(o.dest || sfx);
      if (o.verb) g.connect(verb);
      src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
    }
    // a pentatonic scale in D (the digit picks the note of a seated ball)
    var SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880, 987.77];

    var P = {
      chip: function () {
        noise({ f: 4200, q: 3, dur: 0.05, gain: 0.22 });
        tone({ f: 2500, dur: 0.06, gain: 0.07, at: 0.004 });
      },
      chips: function (n) {
        n = n || 4;
        for (var i = 0; i < n; i++) noise({ f: 3000 + Math.random() * 2000, q: 4, dur: 0.04, gain: 0.1 + Math.random() * 0.06, at: i * 0.05 });
      },
      tick: function (last) { tone({ f: last ? 1320 : 990, dur: 0.07, gain: last ? 0.12 : 0.07, type: 'triangle' }); },
      open: function () { // betting opens: two soft bells
        tone({ f: 784, dur: 0.9, gain: 0.08, type: 'sine', verb: true });
        tone({ f: 1175, dur: 1.1, gain: 0.06, type: 'sine', at: 0.12, verb: true });
      },
      close: function () { // bets closed: a low glassy chord and the air pumps rising
        tone({ f: 220, dur: 1.4, gain: 0.07, type: 'triangle', verb: true });
        tone({ f: 330, dur: 1.4, gain: 0.05, type: 'sine', verb: true });
        noise({ f: 500, to: 1600, q: 0.7, dur: 1.2, gain: 0.05, attack: 0.4, type: 'bandpass' });
      },
      release: function () { // the gate opens: a puff of air and a glass clack
        noise({ f: 1800, to: 700, q: 0.9, dur: 0.35, gain: 0.09, attack: 0.02 });
        tone({ f: 2100, dur: 0.05, gain: 0.07, at: 0.08, type: 'triangle' });
      },
      roll: function () { // rolling down the glass chute
        noise({ f: 380, to: 900, q: 2.2, dur: 0.75, gain: 0.07, attack: 0.08, type: 'bandpass' });
        for (var i = 0; i < 5; i++) tone({ f: 1700 + i * 90, dur: 0.03, gain: 0.025, at: 0.08 + i * 0.12, type: 'triangle' });
      },
      land: function (digit) { // seated in the cradle: a clack and the ball's own note
        noise({ f: 2600, q: 3, dur: 0.05, gain: 0.16 });
        tone({ f: SCALE[digit % 10], dur: 0.9, gain: 0.11, type: 'sine', at: 0.03, verb: true });
        tone({ f: SCALE[digit % 10] * 2, dur: 0.5, gain: 0.03, type: 'sine', at: 0.03 });
      },
      sum: function () { // the total shows
        [587.33, 739.99, 880].forEach(function (f, i) { tone({ f: f, dur: 0.6, gain: 0.07, at: i * 0.07, verb: true }); });
      },
      win: function (big) {
        var notes = big ? [587.33, 739.99, 880, 1174.66, 1479.98, 1760] : [587.33, 739.99, 880, 1174.66];
        notes.forEach(function (f, i) { tone({ f: f, dur: 0.5, gain: 0.09, at: i * 0.09, type: 'triangle', verb: true }); });
        if (big) noise({ f: 6000, q: 0.8, dur: 1.2, gain: 0.03, attack: 0.2, at: 0.3, type: 'highpass' });
      },
      lose: function () { tone({ f: 330, to: 262, dur: 0.5, gain: 0.05, type: 'sine' }); },
      error: function () { tone({ f: 220, dur: 0.12, gain: 0.08, type: 'square' }); },
      tab: function () { tone({ f: 1500, dur: 0.04, gain: 0.04, type: 'triangle' }); },
    };

    // ambient loop: Dmaj7 / Bm9 / Gmaj7 / A6 pads + a slow arpeggio, one bar every 3.2 s
    var CHORDS = [[146.83, 220, 277.18, 369.99], [123.47, 185, 293.66, 277.18], [98, 196, 246.94, 369.99], [110, 220, 277.18, 369.99]];
    function playBar(t0) {
      var ch = CHORDS[bar % CHORDS.length];
      ch.forEach(function (f) {
        var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 650;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.022, t0 + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.5);
        o.connect(lp); lp.connect(g); g.connect(mus); o.start(t0); o.stop(t0 + 3.6);
      });
      for (var i = 0; i < 4; i++) {
        var f = ch[(i + bar) % 4] * 4, t = t0 + 0.4 + i * 0.7, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.018, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        o.connect(g); g.connect(mus); g.connect(verb); o.start(t); o.stop(t + 1.2);
      }
      bar++;
    }
    function startMusic() {
      if (!ctx || musicTimer) return;
      nextBar = ctx.currentTime + 0.1;
      musicTimer = setInterval(function () {
        if (!ctx || ctx.state !== 'running') return;
        while (nextBar < ctx.currentTime + 0.6) { playBar(nextBar); nextBar += 3.2; }
      }, 250);
    }
    function stopMusic() { clearInterval(musicTimer); musicTimer = 0; }
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });

    return {
      play: function (name, a) { if (!ok() || !soundOn || !P[name]) return; try { P[name](a); } catch (e) {} },
      sound: function (on) {
        if (on === undefined) return soundOn;
        soundOn = !!on; safeSet('triotowers:sound', soundOn ? '1' : '0');
        unlock(); if (sfx) sfx.gain.value = soundOn ? 1 : 0;
      },
      music: function (on) {
        if (on === undefined) return musicOn;
        musicOn = !!on; safeSet('triotowers:music', musicOn ? '1' : '0');
        unlock();
        if (mus) mus.gain.value = musicOn ? 0.42 : 0;
        if (musicOn) startMusic(); else stopMusic();
      },
    };
  }
  window.TrioAudio = { create: create };
})();
