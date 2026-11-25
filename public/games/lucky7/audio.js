/* Lucky 7 — all sound is generated with WebAudio (no files): card slide / flip, chips, timer
 * ticks, the host's chime cues and a soft lounge loop for the studio.
 *   L7Audio.cue(name) · L7Audio.setSound(on) · L7Audio.setMusic(on) · L7Audio.unlock() */
(function () {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, sfx, mus, noise, soundOn = true, musicOn = true, timer = 0, nextT = 0, step = 0;

  function boot() {
    if (ctx || !AC) return ctx;
    try { ctx = new AC(); } catch (e) { return null; }
    var comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = soundOn ? 0.9 : 0; sfx.connect(comp);
    mus = ctx.createGain(); mus.gain.value = 0; mus.connect(comp);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function unlock() {
    if (!boot()) return;
    if (ctx.state === 'suspended') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
    syncMusic();
  }

  // ---------------------------------------------------------------- building blocks
  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function tone(type, f, t, a, peak, dec, out, f2) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
    env(g, t, a, peak, dec);
    o.connect(g); g.connect(out || sfx);
    o.start(t); o.stop(t + a + dec + 0.05);
  }
  function hiss(t, dur, peak, type, f1, f2, q, out) {
    var s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; fl.type = type; fl.Q.value = q || 1;
    fl.frequency.setValueAtTime(f1, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    env(g, t, Math.min(0.02, dur / 4), peak, dur);
    s.connect(fl); fl.connect(g); g.connect(out || sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function bell(f, t, peak, dec) { // soft FM bell: the host's chime "voice"
    var c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    c.type = 'sine'; m.type = 'sine';
    c.frequency.value = f; m.frequency.value = f * 2.01;
    mg.gain.setValueAtTime(f * 1.4, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dec);
    m.connect(mg); mg.connect(c.frequency);
    env(g, t, 0.008, peak, dec);
    c.connect(g); g.connect(sfx);
    c.start(t); m.start(t); c.stop(t + dec + 0.1); m.stop(t + dec + 0.1);
  }
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function chip(t, pitch) {
    tone('triangle', 2600 * pitch, t, 0.002, 0.18, 0.05);
    tone('sine', 3900 * pitch, t + 0.004, 0.002, 0.08, 0.04);
    hiss(t, 0.03, 0.12, 'highpass', 5000, 0, 0.7);
  }

  var CUES = {
    click: function (t) { tone('sine', 1400, t, 0.002, 0.12, 0.05); },
    chip: function (t) { chip(t, 0.9 + Math.random() * 0.2); chip(t + 0.035, 1.05 + Math.random() * 0.15); },
    chips: function (t) { for (var i = 0; i < 6; i++) chip(t + i * 0.045 + Math.random() * 0.02, 0.85 + Math.random() * 0.35); },
    slide: function (t) { hiss(t, 0.34, 0.32, 'bandpass', 2600, 700, 1.4); hiss(t + 0.05, 0.22, 0.12, 'lowpass', 900, 300, 0.8); },
    flip: function (t) { hiss(t, 0.06, 0.4, 'highpass', 2600, 0, 0.8); tone('sine', 190, t + 0.01, 0.003, 0.25, 0.07, sfx, 90); },
    tick: function (t) { tone('sine', 1250, t, 0.002, 0.14, 0.05); tone('sine', 2500, t, 0.002, 0.04, 0.03); },
    open: function (t) { [76, 79, 84].forEach(function (n, i) { bell(midi(n), t + i * 0.12, 0.16, 0.9); }); },
    close: function (t) { [84, 79, 72].forEach(function (n, i) { bell(midi(n), t + i * 0.14, 0.13, 0.8); }); },
    reveal: function (t) { bell(midi(79), t, 0.14, 0.7); bell(midi(86), t + 0.1, 0.12, 0.9); },
    seven: function (t) {
      [72, 76, 79, 84, 88, 91].forEach(function (n, i) { bell(midi(n), t + i * 0.08, 0.15, 1.1); });
      for (var i = 0; i < 10; i++) tone('sine', midi(96 + (i % 4) * 2), t + 0.5 + i * 0.05, 0.003, 0.04, 0.25);
    },
    win: function (t) {
      [79, 83, 86, 91].forEach(function (n, i) { bell(midi(n), t + i * 0.09, 0.16, 1); });
      for (var i = 0; i < 8; i++) tone('sine', midi(91 + (i % 3) * 3), t + 0.35 + i * 0.06, 0.003, 0.035, 0.3);
    },
    lose: function (t) { bell(midi(67), t, 0.08, 0.6); },
    error: function (t) { tone('square', 220, t, 0.004, 0.05, 0.18); },
  };
  function cue(name) {
    if (!soundOn || !ctx || ctx.state !== 'running' || !CUES[name]) return;
    CUES[name](ctx.currentTime + 0.01);
  }

  // ---------------------------------------------------------------- lounge loop (96 bpm)
  var CHORDS = [ // bass, pad voicing (midi)
    [41, [57, 60, 64, 67]], // Fmaj9
    [40, [55, 59, 62, 67]], // Em7
    [38, [53, 57, 60, 64]], // Dm9
    [36, [52, 55, 59, 62]], // Cmaj9
  ];
  var SIX = 60 / 96 / 4;
  function scheduleStep(t, s) {
    var bar = Math.floor(s / 16) % 4, pos = s % 16, ch = CHORDS[bar];
    if (pos === 0) { // pad for the bar
      ch[1].forEach(function (n) {
        [-6, 6].forEach(function (cents) {
          var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
          o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = cents;
          f.type = 'lowpass'; f.frequency.value = 820; f.Q.value = 0.4;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.012, t + 0.6);
          g.gain.setValueAtTime(0.012, t + 16 * SIX - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 16 * SIX + 0.5);
          o.connect(f); f.connect(g); g.connect(mus); o.start(t); o.stop(t + 16 * SIX + 0.6);
        });
      });
    }
    if (pos === 0 || pos === 6 || pos === 8 || pos === 14) { // bass
      var bn = pos === 8 ? ch[0] + 7 : ch[0];
      tone('sine', midi(bn), t, 0.01, pos === 0 ? 0.16 : 0.1, 0.45, mus);
      tone('triangle', midi(bn + 12), t, 0.01, 0.03, 0.25, mus);
    }
    if (pos === 0 || pos === 8) tone('sine', 95, t, 0.004, 0.12, 0.16, mus, 45); // soft kick
    if (pos % 4 === 2) hiss(t, 0.05, pos % 8 === 6 ? 0.03 : 0.018, 'highpass', 7000, 0, 0.7, mus); // shaker
    if (pos % 2 === 0 && Math.random() < 0.42) { // electric-piano notes over the chord
      var n = ch[1][Math.floor(Math.random() * 4)] + 12;
      var c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
      c.frequency.value = midi(n); m.frequency.value = midi(n);
      mg.gain.setValueAtTime(midi(n) * 0.9, t); mg.gain.exponentialRampToValueAtTime(midi(n) * 0.05, t + 0.8);
      m.connect(mg); mg.connect(c.frequency);
      env(g, t, 0.006, 0.045, 1.1);
      c.connect(g); g.connect(mus); c.start(t); m.start(t); c.stop(t + 1.2); m.stop(t + 1.2);
    }
  }
  function pump() {
    if (!ctx || ctx.state !== 'running') return;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;
    while (nextT < ctx.currentTime + 0.3) { scheduleStep(nextT, step++); nextT += SIX; }
  }
  function syncMusic() {
    if (!ctx) return;
    var on = musicOn && ctx.state === 'running' && !document.hidden;
    mus.gain.cancelScheduledValues(ctx.currentTime);
    mus.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.25);
    if (on && !timer) { step = step - (step % 16); timer = setInterval(pump, 90); pump(); }
    if (!on && timer) { clearInterval(timer); timer = 0; }
  }
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) { syncMusic(); ctx.suspend(); } else ctx.resume().then(syncMusic, function () {});
  });

  window.L7Audio = {
    unlock: unlock,
    cue: cue,
    setSound: function (on) { soundOn = on; if (ctx) sfx.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.02); },
    setMusic: function (on) { musicOn = on; syncMusic(); },
  };
})();
