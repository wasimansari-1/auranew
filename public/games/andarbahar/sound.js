/* Andar Bahar — every sound is made here with WebAudio (no sound files): table cues (card
 * slide / flip, chips, bangles, dealer chimes, win) and the ambient bazaar music (a tanpura-
 * style drone, soft plucked melody and a light hand-drum loop). Separate music / sound on-off. */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master, sfx, mus, verb, noiseBuf;
  var soundOn = true, musicOn = true, musicTimer = 0;

  function init() {
    if (ctx || !AC) return ctx;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(master);
    mus = ctx.createGain(); mus.gain.value = 0; mus.connect(master);
    // a small generated room for the music
    verb = ctx.createConvolver();
    var len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = ir.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    verb.buffer = ir;
    var wet = ctx.createGain(); wet.gain.value = 0.32;
    verb.connect(wet); wet.connect(mus);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var nd = noiseBuf.getChannelData(0);
    for (var k = 0; k < nd.length; k++) nd[k] = Math.random() * 2 - 1;
    return ctx;
  }

  function now() { return ctx.currentTime; }

  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  function tone(freq, t, dur, type, vol, out, bend) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur * 0.8);
    env(g, t, 0.005, vol, dur);
    o.connect(g); g.connect(out || sfx);
    o.start(t); o.stop(t + dur + 0.05);
    return g;
  }

  function noise(t, dur, vol, type, f0, f1, q, out) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, Math.min(0.02, dur * 0.3), vol, dur);
    s.connect(f); f.connect(g); g.connect(out || sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  function bell(freq, t, vol, dur) { // soft temple-bell: a few inharmonic partials
    [1, 2.01, 2.76, 4.07].forEach(function (p, i) { tone(freq * p, t, (dur || 1.2) / (1 + i * 0.6), 'sine', vol / (1 + i * 1.4)); });
  }

  var cues = {
    slide: function (t) { noise(t, 0.2, 0.22, 'bandpass', 1400, 3800, 0.9); },
    flip: function (t) { noise(t, 0.035, 0.35, 'highpass', 2200, 0, 0.7); tone(180, t, 0.06, 'sine', 0.18, null, 0.6); },
    chip: function (t) {
      noise(t, 0.03, 0.3, 'bandpass', 4200, 0, 3);
      noise(t + 0.045, 0.025, 0.22, 'bandpass', 5200, 0, 3);
      tone(2300 + Math.random() * 300, t, 0.08, 'sine', 0.06);
    },
    chips: function (t) { for (var i = 0; i < 4; i++) cues.chip(t + i * 0.06 + Math.random() * 0.02); },
    bangles: function (t) { for (var i = 0; i < 5; i++) tone(3400 + Math.random() * 1800, t + i * 0.04 + Math.random() * 0.03, 0.25, 'sine', 0.035); },
    open: function (t) { bell(784, t, 0.12); bell(1175, t + 0.18, 0.1); },
    close: function (t) { bell(1047, t, 0.1); bell(698, t + 0.2, 0.11); },
    tick: function (t) { tone(1250, t, 0.05, 'triangle', 0.08); },
    joker: function (t) { bell(587, t, 0.12, 1.6); bell(880, t + 0.08, 0.07, 1.4); },
    match: function (t) { [659, 880, 1319].forEach(function (f, i) { bell(f, t + i * 0.07, 0.1, 1.4); }); },
    win: function (t) { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, t + i * 0.08, 0.35, 'triangle', 0.09); bell(f * 2, t + i * 0.08, 0.03, 0.6); }); },
    bigwin: function (t) { cues.win(t); [1047, 1319, 1568, 2093].forEach(function (f, i) { bell(f, t + 0.45 + i * 0.09, 0.06, 1.6); }); cues.bangles(t + 0.5); },
    error: function (t) { tone(140, t, 0.25, 'square', 0.05); tone(110, t + 0.12, 0.25, 'square', 0.05); },
    click: function (t) { tone(900, t, 0.04, 'triangle', 0.06); },
  };

  function play(name) {
    if (!soundOn || !init() || ctx.state !== 'running' || !cues[name]) return;
    cues[name](now() + 0.01);
  }

  // ---------------------------------------------------------------- music
  // Key of D. Scale (raga-like, Kafi flavour): D E F G A B C.
  var SA = 146.83, BEAT = 60 / 88;
  var SCALE = [0, 2, 3, 5, 7, 9, 10];
  function note(deg, oct) {
    var n = SCALE.length, o = Math.floor(deg / n), s = SCALE[((deg % n) + n) % n];
    return SA * Math.pow(2, (s + 12 * (o + (oct || 0))) / 12);
  }
  function tanpura(freq, t) {
    var f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(700, t + 2.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    [0, 4, -3].forEach(function (cents) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = cents;
      o.connect(f); o.start(t); o.stop(t + 3.3);
    });
    f.connect(g); g.connect(mus); g.connect(verb);
  }
  function pluck(freq, t, vol) { // santoor-ish
    var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.006, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    o2.frequency.value = freq * 2;
    f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(1200, t + 0.6);
    env(g, t, 0.004, vol, 1.1);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(mus); g.connect(verb);
    o.start(t); o2.start(t); o.stop(t + 1.2); o2.stop(t + 1.2);
  }
  function drum(kind, t) {
    if (kind === 'dha' || kind === 'ge') { // bass drum: pitch swoops
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(kind === 'dha' ? 110 : 95, t);
      o.frequency.exponentialRampToValueAtTime(kind === 'dha' ? 70 : 58, t + 0.3);
      env(g, t, 0.004, 0.12, 0.38);
      o.connect(g); g.connect(mus);
      o.start(t); o.stop(t + 0.45);
    }
    if (kind === 'dha' || kind === 'na' || kind === 'tin') { // treble drum: ringing head
      var f = kind === 'tin' ? 620 : 520;
      tone(f, t, 0.22, 'sine', 0.05, mus);
      tone(f * 2.3, t, 0.08, 'sine', 0.02, mus);
      noise(t, 0.03, 0.05, 'bandpass', 3000, 0, 2, mus);
    }
    if (kind === 'ti' || kind === 'ka') noise(t, 0.045, kind === 'ti' ? 0.06 : 0.04, 'bandpass', kind === 'ti' ? 2600 : 1600, 0, 2.5, mus);
  }
  var TAAL = ['dha', 'ge', 'na', 'ti', 'na', 'ka', 'dha', 'na']; // an 8-beat folk cycle (half beats)
  var nextT = 0, step = 0, mel = 7;
  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    var t = now();
    if (nextT < t) nextT = t + 0.05;
    while (nextT < t + 0.35) {
      var half = step % 16; // two cycles of 8 half-beats = one 'bar'
      var bar = Math.floor(step / 16);
      if (half % 8 === 0) tanpura([note(4, -1), note(0), note(0), note(0, -1)][(half / 8 + bar * 2) % 4], nextT);
      if (bar % 4 !== 3 || half < 8) drum(TAAL[half % 8], nextT);
      // melody: a gentle random walk on the scale, resting now and then
      if (half % 2 === 0 && Math.random() < (bar % 2 ? 0.55 : 0.4)) {
        mel += [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
        if (mel < 4) mel = 5; if (mel > 13) mel = 11;
        pluck(note(mel), nextT, 0.05);
        if (Math.random() < 0.25) pluck(note(mel + 1), nextT + BEAT * 0.25, 0.03);
      }
      nextT += BEAT / 2;
      step++;
    }
  }
  function syncMusic() {
    if (!ctx) return;
    var on = musicOn && ctx.state === 'running' && !document.hidden;
    mus.gain.cancelScheduledValues(now());
    mus.gain.setTargetAtTime(on ? 0.75 : 0, now(), 0.4);
    if (on && !musicTimer) musicTimer = setInterval(schedule, 100);
    if (!on && musicTimer) { clearInterval(musicTimer); musicTimer = 0; }
  }

  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume().then(syncMusic, function () {});
    else syncMusic();
  }
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', function () { if (ctx) syncMusic(); });

  window.ABSound = {
    start: function () { unlock(); }, // as the game opens (the tap that opened it may allow it)
    play: play,
    setSound: function (on) { soundOn = on; if (ctx) sfx.gain.value = on ? 1 : 0; },
    setMusic: function (on) { musicOn = on; unlock(); syncMusic(); },
  };
})();
