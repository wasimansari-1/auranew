/* Dragon Tiger — every sound is made here with WebAudio (no sound files): card slide, flip,
 * chips, the dealer's voice-like chime cues, the win chime and generative ambient music
 * (a warm pentatonic pad, plucked strings and a soft room murmur). Music and sound have their
 * own toggles; the context starts on the first tap where the browser requires one.
 *
 *   NXAudio.sfx(name, arg) · NXAudio.cue(kind) · NXAudio.setSound(on) · NXAudio.setMusic(on) */
(function () {
  'use strict';

  var ctx = null, master, sfxBus, musicBus, noise = null;
  var soundOn = true, musicOn = true, musicTimer = 0, musicNodes = null;

  function init() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = soundOn ? 1 : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    var len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function resume() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume().then(syncMusic).catch(function () {});
    else syncMusic();
  }
  window.addEventListener('pointerdown', resume, true);
  window.addEventListener('keydown', resume, true);
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(function () {}); else resume();
  });

  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function noiseHit(t, dur, type, freq, q, peak, out, sweepTo) {
    var s = ctx.createBufferSource(); s.buffer = noise;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    var g = ctx.createGain(); env(g, t, 0.008, peak, dur);
    s.connect(f); f.connect(g); g.connect(out || sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function tone(t, freq, dur, type, peak, out, a, glideTo) {
    var o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    var g = ctx.createGain(); env(g, t, a || 0.005, peak, dur);
    o.connect(g); g.connect(out || sfxBus);
    o.start(t); o.stop(t + (a || 0.005) + dur + 0.05);
  }
  function bell(t, f, peak, dur, out) { // struck metal: a few inharmonic partials
    tone(t, f, dur, 'sine', peak, out, 0.004);
    tone(t, f * 2.76, dur * 0.45, 'sine', peak * 0.35, out, 0.003);
    tone(t, f * 5.4, dur * 0.2, 'sine', peak * 0.12, out, 0.002);
  }

  var SFX = {
    slide: function (t) { noiseHit(t, 0.26, 'bandpass', 2600, 0.9, 0.22, null, 900); },
    flip: function (t) { noiseHit(t, 0.05, 'highpass', 2400, 0.7, 0.32); tone(t, 210, 0.08, 'sine', 0.22, null, 0.003, 120); },
    chip: function (t) {
      [0, 0.028].forEach(function (o, i) {
        noiseHit(t + o, 0.018, 'highpass', 3500, 1, 0.22 - i * 0.08);
        tone(t + o, 3600 - i * 700, 0.05, 'sine', 0.09 - i * 0.03, null, 0.002, 2600 - i * 500);
      });
    },
    chips: function (t, n) { for (var i = 0; i < (n || 4); i++) SFX.chip(t + i * 0.055 + Math.random() * 0.02); },
    sweep: function (t) { noiseHit(t, 0.32, 'bandpass', 1400, 0.6, 0.12, null, 600); },
    tick: function (t, last) { tone(t, last ? 1500 : 1180, 0.04, 'triangle', 0.12); noiseHit(t, 0.012, 'highpass', 4000, 1, 0.06); },
    click: function (t) { tone(t, 900, 0.03, 'triangle', 0.08); },
    win: function (t, big) {
      var notes = [1047, 1175, 1319, 1568, 1760, 2093];
      notes.forEach(function (f, i) { bell(t + i * 0.085, f, 0.11, 1.0); });
      if (big) {
        bell(t + 0.6, 2349, 0.1, 1.4); bell(t + 0.7, 2637, 0.09, 1.4);
        tone(t, 98, 2.4, 'sine', 0.25, null, 0.01); tone(t, 147, 2.0, 'sine', 0.1, null, 0.01); // gong body
        noiseHit(t, 0.6, 'bandpass', 520, 2, 0.08);
      }
    },
    clap: function (t) { noiseHit(t, 0.07, 'bandpass', 1300, 1.2, 0.3); noiseHit(t + 0.012, 0.05, 'highpass', 2500, 0.8, 0.12); },
    lose: function (t) { bell(t, 392, 0.06, 0.6); bell(t + 0.12, 330, 0.05, 0.7); },
  };

  // The dealer's "voice": soft sung syllables through two vowel formants, no speech files.
  var CUES = {
    open: [[392, 0.16], [494, 0.16], [587, 0.3]], // place your bets — rising
    close: [[587, 0.16], [494, 0.16], [392, 0.32]], // no more bets — falling
    dragon: [[330, 0.2], [262, 0.34]],
    tiger: [[392, 0.2], [523, 0.34]],
    tie: [[440, 0.5]],
    welcome: [[440, 0.14], [523, 0.14], [659, 0.3]],
  };
  function voice(t, f, dur) {
    var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.05);
    var vib = ctx.createOscillator(); vib.frequency.value = 5.5; var vg = ctx.createGain(); vg.gain.value = f * 0.012;
    vib.connect(vg); vg.connect(o.frequency);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
    g.gain.setValueAtTime(0.09, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 750; f1.Q.value = 6;
    var f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1220; f2.Q.value = 8;
    var mix = ctx.createGain(); mix.gain.value = 1.6;
    o.connect(g); g.connect(f1); g.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(sfxBus);
    o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    bell(t, f * 2, 0.025, dur * 1.4); // a little shimmer on top
  }
  function cue(kind) {
    if (!ctx || !soundOn || ctx.state !== 'running') return 0;
    var seq = CUES[kind] || [], t = ctx.currentTime + 0.02;
    seq.forEach(function (n) { voice(t, n[0], n[1]); t += n[1] + 0.03; });
    return seq.length;
  }
  function sfx(name, arg) {
    if (!ctx || !soundOn || ctx.state !== 'running' || !SFX[name]) return;
    SFX[name](ctx.currentTime + 0.005, arg);
  }

  // ---------------------------------------------------------------- ambient music
  // A minor pentatonic over a slow four-chord loop; plucks are random but in time.
  var CHORDS = [[110, 165, 220, 262], [87.3, 131, 175, 220], [98, 147, 196, 247], [82.4, 123.5, 165, 196]];
  var PLUCK = [440, 523, 587, 659, 784, 880, 1047, 1175];
  var beat = 60 / 76, nextT = 0, step = 0;
  function pad(t, freqs, dur) {
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = 0.4;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 1.4);
    g.gain.setValueAtTime(0.05, t + dur - 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.8);
    lp.connect(g); g.connect(musicBus);
    freqs.forEach(function (f) {
      [-5, 5].forEach(function (cents) {
        var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = cents;
        o.connect(lp); o.start(t); o.stop(t + dur + 1);
      });
    });
  }
  function pluck(t, f, peak) {
    var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f * 1.01, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    var g = ctx.createGain(); env(g, t, 0.004, peak, 1.3);
    var g2 = ctx.createGain(); env(g2, t, 0.003, peak * 0.4, 0.4);
    o.connect(g); o2.connect(g2); g.connect(musicBus); g2.connect(musicBus);
    o.start(t); o2.start(t); o.stop(t + 1.4); o2.stop(t + 0.5);
  }
  function schedule() {
    if (!ctx) return;
    var ahead = ctx.currentTime + 0.4;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;
    while (nextT < ahead) {
      var bar = Math.floor(step / 8), sub = step % 8;
      if (sub === 0 && bar % 2 === 0) pad(nextT, CHORDS[(bar / 2) % CHORDS.length], beat * 8);
      if (sub === 0) pluck(nextT, CHORDS[Math.floor(bar / 2) % CHORDS.length][0] * 2, 0.05);
      if (Math.random() < (sub % 2 ? 0.18 : 0.38)) pluck(nextT, PLUCK[Math.floor(Math.random() * PLUCK.length)], 0.035 + Math.random() * 0.025);
      nextT += beat / 2; step++;
    }
  }
  function startRoom() { // the murmur of a busy room, very low
    var s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    var bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 300; bp.gain.value = 6;
    var g = ctx.createGain(); g.gain.value = 0.05;
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.13; var lg = ctx.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain);
    s.connect(lp); lp.connect(bp); bp.connect(g); g.connect(musicBus);
    s.start(); lfo.start();
    return [s, lfo];
  }
  function syncMusic() {
    if (!ctx) return;
    var on = musicOn && ctx.state === 'running';
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(on ? 0.85 : 0, ctx.currentTime, 0.4);
    if (on && !musicTimer) {
      if (!musicNodes) musicNodes = startRoom();
      schedule();
      musicTimer = setInterval(schedule, 120);
    } else if (!on && musicTimer) { clearInterval(musicTimer); musicTimer = 0; }
  }

  window.NXAudio = {
    sfx: sfx,
    cue: cue,
    setSound: function (on) { soundOn = on; if (ctx) sfxBus.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05); },
    setMusic: function (on) { musicOn = on; if (ctx) syncMusic(); },
    start: resume,
  };
})();
