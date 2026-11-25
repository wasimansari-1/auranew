/* Vimaan — the scene and the sounds. window.VimaanScene / window.VimaanAudio are used by app.js.
 *
 * The scene is real-time 3D (three.js, module main.js): the NEXORNG jet on a sunset coastal runway,
 * the take-off roll, rotation and lift-off, the landing gear folding into the belly, the climb over
 * the bay and the city, through the golden clouds and on above them into a soft warm dusk. Every
 * picture is a pure function of the round time (timeline.js), so a player who joins mid-flight sees
 * exactly the right moment. This classic script loads the module and forwards app.js's calls; a
 * smoothed round clock follows the engine (ticks jitter by tens of ms; the picture never does).
 *   ?fps=1  on-screen frame rate + worst frame (real-device check)
 *   ?q=0|1|2 quality (2 = full, the default; it adapts by itself: down after 3 s of slow frames, back up when fast)
 *   ?pr=…   force the pixel ratio
 *   ?qa=1   clock-stepped rendering hooks for automated checks (window.__v3d) */
(function () {
  'use strict';

  var BASE = location.pathname.replace(/[^/]*$/, '');
  var ROLL0 = -3.4; // s before 1.00x: the take-off roll starts (timeline.js); lift-off = 1.00x
  var QS = new URLSearchParams(location.search);
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function S5(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }

  function create(cv, opts) {
    opts = opts || {};
    var audio = window.VimaanAudio;
    var W = null, isReady = false, pendingView = null;
    // round state (scene side)
    var mode = 'idle';          // idle | ground | flight | away
    var tau = -6.5, tc = null, wins = [], dip = null, lastNow = 0, snapNext = true, rollPlayed = false;
    var DIP_OUT = 0.45, DIP_IN = 0.8;

    import(BASE + 'main.js').then(function (m) { return m.createScene(cv, {}); }).then(function (w) {
      W = w;
      if (pendingView) W.resize(pendingView);
      isReady = true;
      if (QS.has('qa')) window.__v3d = { draw: W.draw, resize: W.resize, info: W.info, topColor: W.topColor, timeline: null };
      if (opts.onLoad) opts.onLoad();
    }).catch(function (e) { if (window.console) console.error('Vimaan 3D:', e); isReady = true; if (opts.onLoad) opts.onLoad(); });

    function resize(v) { pendingView = v; if (W) W.resize(v); }

    function swap(now) { // under the dip: back to the runway for the next round
      mode = 'ground'; tc = null; wins = []; snapNext = true; rollPlayed = false;
      if (dip) { dip.swapped = true; dip.at = now; }
    }
    function onBetting(now) {
      if (mode === 'away') { if (!dip) dip = { at: now, swapped: false }; }
      else if (mode !== 'ground') { mode = 'ground'; snapNext = true; }
      rollPlayed = false;
    }
    function onStart(now, midFlight, elapsedMs) {
      if (dip && !dip.swapped) swap(now);
      if (mode !== 'flight') { mode = 'flight'; tc = null; wins = []; }
      if (midFlight) { tau = (elapsedMs || 0) / 1000; snapNext = false; }
      if (!rollPlayed && tau < 3) { rollPlayed = true; audio.roll(Math.max(0, tau - ROLL0)); }
    }
    function onCrash(now) {
      if (mode === 'flight') { tc = tau; mode = 'away'; audio.flyaway(); }
    }
    function onWin(now, text) {
      if (mode !== 'flight') return;
      wins.push({ tw: tau, text: text });
      if (wins.length > 2) wins.shift();
      audio.chute();
    }

    // st: { phase, mult, crashPoint, rollIn (ms to the end of betting, may go negative), flightMs }
    var fpsEl = null, fpsT = 0, fpsN = 0, worst = 0;
    function frame(now, dt, st) {
      if (window.__v3dHold) return; // QA: frames are drawn by the clock-stepped harness
      var dts = clamp(dt, 0, 100) / 1000;
      // the round clock: follow the engine, never jump (except to catch up a big gap: joining)
      var target = null;
      if (mode !== 'away') {
        if (st.phase === 'betting' && st.rollIn != null) target = -st.rollIn / 1000;
        else if (st.phase === 'flying' && st.flightMs != null) target = st.flightMs / 1000;
      }
      if (mode === 'idle' && st.phase === 'betting') { mode = 'ground'; snapNext = true; }
      if (mode === 'idle' && st.phase === 'flying') onStart(now, true, st.flightMs);
      if (target != null) {
        var err = target - tau;
        if (snapNext || Math.abs(err) > 1.2) { tau = target; snapNext = false; }
        else tau += dts * (1 + clamp(err * 0.35, -0.12, 0.12)); // engine ticks jitter ±50 ms: follow gently
      } else if (mode === 'away' || mode === 'flight') tau += dts;
      if (mode === 'idle' || (mode === 'ground' && target == null)) tau = Math.min(tau, -6.5);
      if (mode === 'ground' && !rollPlayed && tau >= ROLL0 && tau < ROLL0 + 2) { rollPlayed = true; audio.roll(tau - ROLL0); }
      // the dip back to the runway
      var dipA = 0;
      if (dip) {
        var k = (now - dip.at) / 1000;
        if (!dip.swapped) { dipA = S5(0, DIP_OUT, k); if (k >= DIP_OUT) { swap(now); dipA = 1; } }
        else { dipA = 1 - S5(0, DIP_IN, k); if (k >= DIP_IN) dip = null; }
      }
      if (dip && dip.swapped && st.phase === 'betting' && st.rollIn != null) tau = -st.rollIn / 1000; // under the dip: the runway at the right moment
      if (W) {
        W.perf(dt, now); // before drawing: a quality change sizes the canvas, which clears it — after the draw, this frame would show empty
        W.draw({ tau: tau, tc: tc, wins: wins, wall: now / 1000, dip: dipA });
      }
      if (QS.has('fps')) fpsMeter(now, dt);
    }
    function fpsMeter(now, dt) {
      if (!fpsEl) {
        fpsEl = document.createElement('div');
        fpsEl.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99;font:12px/1.3 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.6);padding:4px 7px;border-radius:6px;pointer-events:none';
        document.body.appendChild(fpsEl);
      }
      fpsN++; if (dt > worst) worst = dt;
      if (now - fpsT > 1000) {
        var i = W ? W.info() : {};
        fpsEl.textContent = Math.round(fpsN * 1000 / (now - fpsT)) + ' fps · worst ' + Math.round(worst) + ' ms · rung ' + i.tier + '/' + ((i.rungs || 1) - 1) + ' · DPR ' + (i.pr || 0).toFixed(2) + ' (' + (i.buffer || []).join('×') + ') · ' + (i.calls || 0) + ' calls';
        fpsT = now; fpsN = 0; worst = 0;
      }
    }

    function topColor() { return W ? W.topColor() : '#c98a6a'; }
    return { resize: resize, frame: frame, topColor: topColor, onStart: onStart, onCrash: onCrash, onBetting: onBetting, onWin: onWin,
      ready: function () { return isReady; }, place: function () { return 'bay'; },
      clock: function () { return { tau: tau, tc: tc, mode: mode, dip: dip ? (dip.swapped ? 'in' : 'out') : '' }; }, // QA
      holding: function () { return mode === 'away'; } }; // the end is still on screen (until the dip swaps to the runway)
  }

  window.VimaanScene = { create: create };

  // ---------------------------------------------------------------- sounds + music
  // Real recordings (CC0, see LICENSES.txt), mixed in WebAudio: the jet's idle whine on the runway,
  // the take-off roar, the wind + engine in flight (pitch and level follow the multiplier), the
  // fly-by as it leaves, the parachute, switch clicks; the music streams from an <audio> element.
  var A = null, sfx = null, buf = {}, soundOn = true, musicOn = true, loops = {}, music = null, unlocked = false;
  var SND = BASE + 'sounds/';
  var FILES = { idle: 'engine-idle.mp3', roll: 'takeoff.mp3', cruise: 'cruise.mp3', flyby: 'flyby.mp3', chute: 'chute.mp3', click: 'click.mp3', cash: 'cash.mp3' };
  function ac() {
    if (A) return A;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    A = new C();
    sfx = A.createGain(); sfx.gain.value = soundOn ? 1 : 0; sfx.connect(A.destination);
    Object.keys(FILES).forEach(function (n) {
      fetch(SND + FILES[n]).then(function (r) {
        return r.ok && /audio|mpeg|octet/.test(r.headers.get('content-type') || '') ? r.arrayBuffer() : null;
      }).then(function (b) {
        if (!b) return null;
        return new Promise(function (res) { A.decodeAudioData(b, res, function () { res(null); }); });
      }).then(function (d) { if (d) buf[n] = d; }).catch(function () { /* missing: silent */ });
    });
    return A;
  }
  function one(name, vol, rate, at) {
    if (!A || !soundOn || !buf[name]) return null;
    var s = A.createBufferSource(), g = A.createGain();
    s.buffer = buf[name]; s.playbackRate.value = rate || 1; g.gain.value = vol == null ? 1 : vol;
    s.connect(g); g.connect(sfx); s.start(0, at || 0);
    return { s: s, g: g };
  }
  function loop(name) { // a looping recording, its level / pitch set by level()
    if (loops[name] || !A || !buf[name]) return loops[name];
    var s = A.createBufferSource(), g = A.createGain();
    s.buffer = buf[name]; s.loop = true; g.gain.value = 0;
    s.connect(g); g.connect(sfx); s.start();
    loops[name] = { s: s, g: g };
    return loops[name];
  }
  function level(name, vol, rate, tau) {
    var l = loop(name); if (!l) return;
    l.g.gain.setTargetAtTime(soundOn ? vol : 0, A.currentTime, tau || 0.25);
    if (rate) l.s.playbackRate.setTargetAtTime(rate, A.currentTime, 0.3);
  }
  var rollSrc = null;
  function syncMusic() {
    if (!music) { music = new Audio(SND + 'music.mp3'); music.loop = true; music.volume = 0.28; music.preload = 'auto'; }
    if (musicOn && unlocked && !document.hidden) { var p = music.play(); if (p && p.catch) p.catch(function () { unlocked = false; }); }
    else music.pause();
  }

  window.VimaanAudio = {
    unlock: function (gesture) { // gesture: a tap (sounds may start); else only the music is tried
      unlocked = true;
      syncMusic();
      if (!gesture && !A) return;
      if (!ac()) return;
      if (A.state === 'suspended') A.resume().catch(function () {});
    },
    pause: function (hidden) { if (A) { if (hidden) A.suspend().catch(function () {}); else A.resume().catch(function () {}); } if (music) { if (hidden) music.pause(); else syncMusic(); } },
    setSound: function (on) { soundOn = on; if (sfx) sfx.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.05); },
    setMusic: function (on) { musicOn = on; if (music || on) syncMusic(); },
    click: function () { one('click', 0.5); },
    roll: function (at) { if (rollSrc) return; rollSrc = one('roll', 0.9, 1, at); },
    flyaway: function () { one('flyby', 0.8); if (rollSrc) { try { rollSrc.g.gain.setTargetAtTime(0, A.currentTime, 0.4); } catch (e) { /* */ } } },
    chute: function () { one('chute', 0.7); one('cash', 0.55); },
    // every frame: phase ('ground' | 'roll' | 'flying' | 'away'), the multiplier
    tick: function (phase, mult) {
      if (!A || !unlocked) return;
      var u = Math.log(Math.max(1, mult));
      level('idle', phase === 'ground' ? 0.3 : 0, 1, 0.4);
      level('cruise', phase === 'flying' ? Math.min(0.75, 0.35 + u * 0.12) : 0, 0.92 + Math.min(0.35, u * 0.09), phase === 'away' ? 0.6 : 0.4);
      if (phase === 'ground' && rollSrc) { try { rollSrc.g.gain.setTargetAtTime(0, A.currentTime, 0.3); } catch (e) { /* */ } rollSrc = null; }
    },
  };
})();
