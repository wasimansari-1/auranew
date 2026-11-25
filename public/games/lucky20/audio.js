/* Lucky 20 — sounds, all generated with WebAudio (no audio files): a soft studio-lounge music loop
 * (electric-piano chords, round bass, light shaker), the LED tile flip "blip" for every ball (pitch
 * follows the number), chips, countdown ticks, the doors-closed chime, win / no-win cues.
 * Music and sound toggle separately (remembered per device).
 */
(function () {
  'use strict';
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master = null, sfx = null, mus = null, verb = null, noiseBuf = null;
    var soundOn = safeGet('lucky20:sound') !== '0', musicOn = safeGet('lucky20:music') !== '0';
    var musicTimer = 0, nextBar = 0, bar = 0;

    function init() {
      if (ctx || !AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
      mus = ctx.createGain(); mus.gain.value = musicOn ? 0.42 : 0; mus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      verb = ctx.createDelay(); verb.delayTime.value = 0.13;
      var fb = ctx.createGain(); fb.gain.value = 0.3;
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
      src.buffer = noiseBuf; bp.type = o.type || 'bandpass'; bp.frequency.value = o.f || 3000; bp.Q.value = o.q || 1.5;
      if (o.to) bp.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.attack || 0.003));
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(bp); bp.connect(g); g.connect(o.dest || sfx);
      if (o.verb) g.connect(verb);
      src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
    }

    // pentatonic pitches for the balls: 1 → low, 80 → high (two octaves of A minor pentatonic)
    var PENTA = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3, 784, 880];
    var S = {
      chip: function () {
        if (!ok()) return;
        noise({ f: 4200, q: 3, dur: 0.05, gain: 0.22 });
        tone({ f: 2600, dur: 0.06, gain: 0.07, at: 0.004 });
      },
      chips: function (n) {
        if (!ok()) return;
        n = n || 4;
        for (var i = 0; i < n; i++) noise({ f: 3000 + Math.random() * 2200, q: 4, dur: 0.04, gain: 0.1 + Math.random() * 0.06, at: i * 0.05 });
      },
      ball: function (n, last) { // the LED tile flips on: a soft glassy blip + a tiny flap
        if (!ok()) return;
        var f = PENTA[Math.min(PENTA.length - 1, Math.floor((n - 1) / 80 * PENTA.length))];
        noise({ f: 1800, q: 1.2, dur: 0.05, gain: 0.05 });
        tone({ f: f * 2, dur: 0.5, gain: last ? 0.11 : 0.075, at: 0.02, verb: true });
        tone({ f: f * 4.01, dur: 0.18, gain: 0.02, at: 0.02 });
      },
      tick: function (last) { if (ok()) tone({ f: last ? 1320 : 990, dur: 0.07, gain: last ? 0.09 : 0.05, type: 'triangle' }); },
      open: function () { // betting opens
        if (!ok()) return;
        [659.3, 880, 1318.5].forEach(function (f, i) { tone({ f: f, dur: 0.8, gain: 0.05, at: i * 0.09, verb: true }); });
      },
      close: function () { // no more bets: a low two-note chime
        if (!ok()) return;
        [440, 329.6].forEach(function (f, i) { tone({ f: f, dur: 1.1, gain: 0.07, at: i * 0.16, type: 'triangle', verb: true }); });
        noise({ f: 700, to: 2200, q: 0.8, dur: 0.35, gain: 0.04, attack: 0.1 });
      },
      reset: function () { if (ok()) noise({ f: 900, to: 3200, q: 0.7, dur: 0.6, gain: 0.035, attack: 0.2 }); },
      win: function (big) {
        if (!ok()) return;
        var notes = big ? [523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093] : [659.3, 784, 1046.5, 1318.5];
        notes.forEach(function (f, i) { tone({ f: f, dur: 0.7, gain: 0.075, at: i * 0.075, verb: true }); tone({ f: f * 3, dur: 0.22, gain: 0.012, at: i * 0.075 }); });
      },
      done: function () { if (ok()) [523.3, 392].forEach(function (f, i) { tone({ f: f, dur: 0.5, gain: 0.05, at: i * 0.12, type: 'triangle', verb: true }); }); },
      lose: function () { if (ok()) tone({ f: 330, to: 262, dur: 0.45, gain: 0.045, type: 'triangle' }); },
      error: function () { if (ok()) tone({ f: 220, dur: 0.16, gain: 0.07, type: 'square' }); },
    };

    // ---------------------------------------------------------------- music: studio lounge
    // Am9 – Fmaj7 – Cmaj7 – Em7 (original voicings), 96 bpm, electric-piano chords, round bass, shaker.
    var CH = [[220, 261.6, 329.6, 392, 493.9], [174.6, 220, 261.6, 329.6, 392], [130.8, 196, 246.9, 329.6, 392], [164.8, 196, 246.9, 293.7, 392]];
    var BASS = [110, 87.3, 65.4, 82.4], BEAT = 60 / 96;
    function ep(f, t, dur, g) { // electric piano: sine + soft bell partial, gentle decay
      var o = ctx.createOscillator(), o2 = ctx.createOscillator(), gn = ctx.createGain(), g2 = ctx.createGain();
      o.type = 'sine'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 4.0;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g2.gain.value = 0.12;
      o.connect(gn); o2.connect(g2); g2.connect(gn); gn.connect(mus); gn.connect(verb);
      o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    }
    function bass(f, t, dur) {
      var o = ctx.createOscillator(), gn = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 380;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.12, t + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp); lp.connect(gn); gn.connect(mus); o.start(t); o.stop(t + dur + 0.05);
    }
    function shaker(t, g) {
      var src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), gn = ctx.createGain();
      src.buffer = noiseBuf; hp.type = 'highpass'; hp.frequency.value = 6500;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(hp); hp.connect(gn); gn.connect(mus); src.start(t, Math.random() * 0.5); src.stop(t + 0.1);
    }
    function scheduleBar(t) {
      var c = CH[bar % 4], b = BASS[bar % 4];
      c.forEach(function (f, i) { ep(f, t + i * 0.012, BEAT * 3.4, 0.028); });
      ep(c[2], t + BEAT * 2.5, BEAT * 1.4, 0.02); ep(c[4], t + BEAT * 2.5, BEAT * 1.4, 0.016);
      bass(b, t, BEAT * 1.6); bass(b, t + BEAT * 2, BEAT * 0.8); bass(b * 1.5, t + BEAT * 3, BEAT * 0.8);
      for (var k = 0; k < 8; k++) shaker(t + k * BEAT / 2, k % 2 ? 0.012 : 0.02);
      if (bar % 2 === 1) { // a small melodic answer
        var m = [659.3, 784, 880, 987.8][Math.floor(Math.random() * 4)];
        ep(m, t + BEAT * 1.5, BEAT * 1.2, 0.022); ep(m * 0.89, t + BEAT * 2, BEAT * 1.6, 0.018);
      }
      bar++;
    }
    function startMusic() {
      if (!ctx || musicTimer) return;
      nextBar = ctx.currentTime + 0.2;
      musicTimer = setInterval(function () {
        if (!ctx || ctx.state !== 'running') return;
        if (nextBar < ctx.currentTime) nextBar = ctx.currentTime + 0.1;
        while (nextBar < ctx.currentTime + 1.2) { scheduleBar(nextBar); nextBar += BEAT * 4; }
      }, 300);
    }
    function stopMusic() { clearInterval(musicTimer); musicTimer = 0; }
    document.addEventListener('visibilitychange', function () { if (ctx) { if (document.hidden) ctx.suspend(); else ctx.resume(); } });

    return {
      play: function (name, a, b) { if (soundOn && S[name]) try { S[name](a, b); } catch (e) {} },
      sound: function (v) {
        if (v === undefined) return soundOn;
        soundOn = v; safeSet('lucky20:sound', v ? '1' : '0');
        if (sfx) sfx.gain.value = v ? 1 : 0;
      },
      music: function (v) {
        if (v === undefined) return musicOn;
        musicOn = v; safeSet('lucky20:music', v ? '1' : '0');
        unlock();
        if (mus && ctx) mus.gain.setTargetAtTime(v ? 0.42 : 0, ctx.currentTime, 0.2);
        if (v) startMusic(); else stopMusic();
      },
    };
  }
  window.L20Audio = { create: create };
})();
