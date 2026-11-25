/* Teen Patti — every sound is made here with WebAudio (no sound files): card slide / flip, chips,
 * dealer chimes, countdown ticks, win chimes, and a soft ambient palace tune (tanpura-style drone,
 * santoor-like notes, light hand-drum pattern).
 *   var audio = TPAudio.create();  audio.play('chip'); audio.music(true|false); audio.sfx(true|false)
 */
(function () {
  'use strict';

  function create() {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master, sfxGain, musicGain, noise, musicOn = false, sfxOn = true, timer = null, nextBeat = 0, beat = 0, unlocked = false;

    function init() {
      if (ctx || !AC) return !!ctx;
      try { ctx = new AC(); } catch (e) { return false; }
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.8; sfxGain.connect(master);
      musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    }
    function running() { return ctx && ctx.state === 'running'; }
    function unlock() {
      if (!init()) return;
      if (ctx.state !== 'running') ctx.resume().then(function () { unlocked = true; syncMusic(); }).catch(function () {});
      else { unlocked = true; syncMusic(); }
    }
    // Starts as the game opens where the browser allows it; else on the first tap in the game.
    init();
    if (ctx && ctx.state === 'running') unlocked = true;
    ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { window.addEventListener(ev, unlock, true); });
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(function () {}); else if (unlocked) ctx.resume().catch(function () {});
    });

    // ---- building blocks
    function env(g, t, a, peak, dec) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    }
    function noiseHit(t, dur, type, f0, f1, q, peak, out) {
      var src = ctx.createBufferSource(); src.buffer = noise;
      var flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q || 1;
      flt.frequency.setValueAtTime(f0, t); if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
      var g = ctx.createGain(); env(g, t, 0.006, peak, dur);
      src.connect(flt); flt.connect(g); g.connect(out || sfxGain);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    }
    function tone(t, freq, dur, type, peak, out, attack) {
      var o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      var g = ctx.createGain(); env(g, t, attack || 0.004, peak, dur);
      o.connect(g); g.connect(out || sfxGain); o.start(t); o.stop(t + dur + 0.05);
      return o;
    }
    function bell(t, f, dur, peak, out) {
      tone(t, f, dur, 'sine', peak, out, 0.003);
      tone(t, f * 2.76, dur * 0.4, 'sine', peak * 0.25, out, 0.002);
      tone(t, f * 5.4, dur * 0.18, 'sine', peak * 0.1, out, 0.002);
    }
    // a soft vowel-like hum: the dealer's "voice" chime
    function hum(t, f0, f1, dur, peak) {
      var o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      var g = ctx.createGain(); env(g, t, 0.05, peak, dur);
      var f1n = ctx.createBiquadFilter(); f1n.type = 'bandpass'; f1n.frequency.value = 650; f1n.Q.value = 6;
      var f2n = ctx.createBiquadFilter(); f2n.type = 'bandpass'; f2n.frequency.value = 1100; f2n.Q.value = 8;
      var mix = ctx.createGain(); mix.gain.value = 1;
      o.connect(f1n); o.connect(f2n); f1n.connect(mix); f2n.connect(mix); mix.connect(g); g.connect(sfxGain);
      o.start(t); o.stop(t + dur + 0.1);
    }

    var SFX = {
      slide: function (t) { noiseHit(t, 0.2, 'bandpass', 3200, 1100, 1.2, 0.22); },
      flip: function (t) { noiseHit(t, 0.05, 'highpass', 2600, 0, 0.7, 0.3); tone(t, 190, 0.05, 'sine', 0.18); noiseHit(t + 0.03, 0.06, 'bandpass', 1800, 900, 1, 0.12); },
      chip: function (t) { [0, 0.035].forEach(function (d, i) { tone(t + d, 4200 - i * 700, 0.05, 'sine', 0.12); tone(t + d, 6900 - i * 900, 0.03, 'sine', 0.05); noiseHit(t + d, 0.025, 'highpass', 5000, 0, 0.7, 0.08); }); },
      chipdown: function (t) { [0, 0.045, 0.08].forEach(function (d, i) { tone(t + d, 3600 + i * 500, 0.04, 'triangle', 0.1); noiseHit(t + d, 0.02, 'highpass', 4500, 0, 0.7, 0.06); }); },
      sweep: function (t) { noiseHit(t, 0.32, 'bandpass', 900, 2600, 0.8, 0.12); },
      collect: function (t) { for (var i = 0; i < 6; i++) SFX.chipdown(t + i * 0.05); },
      clap: function (t) { noiseHit(t, 0.09, 'bandpass', 1500, 900, 0.9, 0.3); },
      tick: function (t) { tone(t, 1750, 0.04, 'sine', 0.12); tone(t, 880, 0.05, 'triangle', 0.05); },
      open: function (t) { bell(t, 659.3, 1.1, 0.16); bell(t + 0.16, 880, 1.3, 0.16); hum(t + 0.05, 220, 262, 0.42, 0.05); },
      closed: function (t) { bell(t, 880, 0.9, 0.15); bell(t + 0.16, 659.3, 1.2, 0.15); hum(t + 0.05, 262, 196, 0.45, 0.05); },
      result: function (t) { bell(t, 587.3, 1.2, 0.13); bell(t + 0.12, 740, 1.3, 0.12); },
      win: function (t) { [523.3, 659.3, 784, 1046.5].forEach(function (f, i) { bell(t + i * 0.09, f, 1.1, 0.14); }); },
      big: function (t) { [523.3, 659.3, 784, 1046.5, 1318.5, 1568].forEach(function (f, i) { bell(t + i * 0.08, f, 1.4, 0.15); }); for (var i = 0; i < 10; i++) tone(t + 0.5 + i * 0.05, 2400 + Math.random() * 2400, 0.25, 'sine', 0.03); },
      half: function (t) { bell(t, 659.3, 0.9, 0.12); bell(t + 0.12, 587.3, 1, 0.1); },
      error: function (t) { tone(t, 220, 0.18, 'triangle', 0.12); tone(t + 0.1, 180, 0.2, 'triangle', 0.1); },
      key: function (t) { tone(t, 1200, 0.03, 'sine', 0.06); },
    };
    function play(name) {
      if (!sfxOn || !running() || !SFX[name]) return;
      try { SFX[name](ctx.currentTime + 0.005); } catch (e) { /* ignore */ }
    }

    // ---- ambient music: drone + melody + light drum, scheduled ahead
    var SA = 146.83; // D3
    var SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // a bright pentatonic in semitones from Sa
    var BEAT = 60 / 76 / 2; // eighth notes at 76 bpm
    var DRUM = ['dha', '', 'na', 'ti', 'na', '', 'dhi', 'na', 'dha', '', 'na', 'ti', 'na', 'ka', 'dhi', 'na'];
    var phrase = [], deg = 3;
    function semi(n) { return SA * Math.pow(2, n / 12); }
    function string(t, f, out) { // a buzzy plucked drone string
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      var o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.003;
      var flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 4;
      flt.frequency.setValueAtTime(2400, t); flt.frequency.exponentialRampToValueAtTime(500, t + 2.6);
      var g = ctx.createGain(); env(g, t, 0.03, 0.05, 3.2);
      o.connect(flt); o2.connect(flt); flt.connect(g); g.connect(out);
      o.start(t); o2.start(t); o.stop(t + 3.4); o2.stop(t + 3.4);
    }
    function santoor(t, f, out) {
      [0, 0.09].forEach(function (d, i) { tone(t + d, f, 1.3 - i * 0.4, 'triangle', i ? 0.025 : 0.05, out, 0.002); tone(t + d, f * 2, 0.5, 'sine', 0.012, out, 0.002); });
    }
    function drum(t, b, out) {
      if (b === 'dha' || b === 'dhi') {
        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
        var g = ctx.createGain(); env(g, t, 0.004, 0.14, 0.3); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4);
      }
      if (b === 'na' || b === 'dha' || b === 'ti') tone(t, b === 'ti' ? 720 : 560, 0.12, 'sine', b === 'ti' ? 0.03 : 0.045, out, 0.002);
      if (b === 'ka') noiseHit(t, 0.04, 'bandpass', 1800, 0, 1.5, 0.05, out);
    }
    function schedule() {
      if (!musicOn || !running()) return;
      var now = ctx.currentTime;
      if (nextBeat < now) nextBeat = now + 0.05;
      while (nextBeat < now + 0.35) {
        var t = nextBeat, b = beat % 16;
        if (b % 4 === 0) string(t, [SA * 1.5 / 2, SA, SA, SA / 2][(beat / 4) % 4 | 0], musicGain);
        drum(t, DRUM[b], musicGain);
        if (!phrase.length && b === 0 && Math.random() < 0.6) {
          var n = 3 + Math.floor(Math.random() * 4);
          for (var i = 0; i < n; i++) { deg = Math.max(0, Math.min(SCALE.length - 1, deg + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)])); phrase.push(deg); }
        }
        if (phrase.length && (b % 2 === 0 || Math.random() < 0.25)) santoor(t, semi(SCALE[phrase.shift()]) * 2, musicGain);
        nextBeat += BEAT; beat++;
      }
    }
    function syncMusic() {
      if (!ctx) return;
      var t = ctx.currentTime;
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setTargetAtTime(musicOn ? 0.55 : 0, t, 0.4);
      if (musicOn && !timer) timer = setInterval(schedule, 120);
      if (!musicOn && timer) { clearInterval(timer); timer = null; }
    }

    return {
      play: play,
      music: function (on) { musicOn = on; syncMusic(); },
      sfx: function (on) { sfxOn = on; },
      unlock: unlock,
    };
  }

  window.TPAudio = { create: create };
})();
