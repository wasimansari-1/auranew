/* Sixer Sky — the scene and the sounds. window.SixerScene / window.SixerAudio are used by app.js.
 *
 * The scene is real-time 3D (three.js, module main.js): a sunny afternoon match. The batsman waits at
 * the crease with the wicketkeeper behind the stumps; the delivery comes down the pitch and the bat
 * meets it exactly at 1.00x. The camera turns with the ball and closes in behind it: out of the
 * stadium, over the town, through the clouds and above the cloud sea in golden light. The end: the
 * ball loses its lift and drops away; a soft veil cuts to the boundary, where a fielder takes it out
 * of the sky. With the next betting the veil brings the crease back. Every picture is a pure function
 * of the round time (timeline.js), so a player who joins mid-flight sees exactly the right moment.
 * This classic script loads the module and forwards app.js's calls; a smoothed round clock follows the
 * engine (its ticks jitter by tens of ms; the picture never does). My cash-out: a gold chip with the
 * win lifts off the ball.
 *   ?fps=1  on-screen frame rate + worst frame (real-device check)
 *   ?q=0|1|2 quality tier (default: 1 on phones, 2 elsewhere; steps down by itself if frames are slow)
 *   ?qa=1   clock-stepped rendering hooks for automated checks (window.__s3d) */
(function () {
  'use strict';

  var BASE = location.pathname.replace(/[^/]*$/, '');
  var QS = new URLSearchParams(location.search);
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function S5(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  var T_BOWL = 0.66;                 // the delivery (timeline.js)
  var CATCH_IN = 1.45;               // s into the catch shot: the ball reaches the fielder's hands (main.js: CATCH_AT − CATCH_FROM)
  var END_HOLD = 0.85, DIP_OUT = 0.32, DIP_IN = 0.5; // the end: the ball drops for END_HOLD, then the veil

  function create(cv, opts) {
    opts = opts || {};
    var audio = window.SixerAudio;
    var W = null, isReady = false, pendingView = null;
    // the 2D layer over the 3D picture: the cash-out chip
    var ov = document.createElement('canvas');
    ov.setAttribute('aria-hidden', 'true'); ov.className = 'ov';
    cv.parentNode.insertBefore(ov, cv.nextSibling);
    var ctx = ov.getContext('2d');

    // round state (scene side)
    var mode = 'idle';              // idle | ground | flight | away (the ball is dropping) | catch (the boundary)
    var tau = -3, tc = null, snapNext = true, hitPlayed = false, endAt = 0, catchAt = 0, caughtPlayed = false;
    var dip = null;                 // { at, to: 'catch' | 'ground', swapped }

    import(BASE + 'main.js').then(function (m) { return m.createScene(cv); }).then(function (w) {
      W = w;
      if (pendingView) W.resize(pendingView);
      isReady = true;
      if (QS.has('qa')) window.__s3d = { draw: W.draw, resize: W.resize, info: W.info, topColor: W.topColor, ballScreen: W.ballScreen, scene: api };
      if (opts.onLoad) opts.onLoad();
    }).catch(function (e) { if (window.console) console.error('Sixer Sky 3D:', e); isReady = true; if (opts.onLoad) opts.onLoad(); });

    var V = { W: 1, H: 1, TOP: 0, LEFT: 0, FULL_W: 1, FULL_H: 1, dpr: 1 };
    function resize(v) {
      V = v; pendingView = v;
      var w = Math.round(v.FULL_W * v.dpr), h = Math.round(v.FULL_H * v.dpr);
      if (ov.width !== w) ov.width = w;
      if (ov.height !== h) ov.height = h;
      if (W) W.resize(v);
    }

    function toGround() { mode = 'ground'; tc = null; snapNext = true; hitPlayed = false; caughtPlayed = false; chips.length = 0; }
    function onBetting(now) {
      if (mode === 'away' || mode === 'catch') { if (!dip || dip.to !== 'ground') { dip = { at: now, to: 'ground', swapped: false }; audio.whoosh(); } }
      else if (mode !== 'ground') toGround();
    }
    function onStart(now, midFlight, elapsedMs) {
      if (dip && dip.to === 'ground' && !dip.swapped) { dip.swapped = true; dip.at = now; toGround(); }
      else if (mode === 'away' || mode === 'catch' || mode === 'idle') toGround();
      mode = 'flight'; tc = null;
      if (midFlight) { tau = (elapsedMs || 0) / 1000; snapNext = false; hitPlayed = tau > 0.25; }
    }
    function onCrash(now) {
      if (mode === 'flight') { tc = Math.max(tau, 0.02); mode = 'away'; endAt = now; }
    }
    var chips = [];
    function onWin(now, text) { chips.push({ at: now, text: text }); audio.cash(); }

    // st: { phase, mult, rollIn (ms to the end of betting), flightMs }
    var fpsEl = null, fpsT = 0, fpsN = 0, worst = 0;
    var DS = { tau: 0, tc: null, wall: 0, dip: 0, shot: 'play', te: 0 }; // one draw state, reused every frame
    function frame(now, dt, st) {
      if (window.__s3dHold) return; // QA: frames are drawn by the clock-stepped harness
      var dts = clamp(dt, 0, 100) / 1000;
      // a first screen: in betting / flying / an ended round
      if (mode === 'idle') {
        if (st.phase === 'flying') onStart(now, true, st.flightMs);
        else if (st.phase === 'crashed') { mode = 'catch'; catchAt = now - 4000; caughtPlayed = true; } // joined after the end: he has the ball
        else toGround();
      }
      // the round clock: follow the engine, never jump (except to catch up a big gap: joining)
      var target = null;
      if (mode === 'ground' && st.phase === 'betting' && st.rollIn != null) target = -st.rollIn / 1000;
      else if (mode === 'flight' && st.phase === 'flying' && st.flightMs != null) target = st.flightMs / 1000;
      if (target != null) {
        var err = target - tau;
        if (snapNext || Math.abs(err) > 1.2) { tau = target; snapNext = false; }
        else tau += dts * (1 + clamp(err * 0.35, -0.12, 0.12));
      } else if (mode === 'away' || mode === 'flight') tau += dts;
      if (mode === 'ground' && target == null) tau = Math.min(tau, -T_BOWL - 0.6); // waiting for the next betting: in his stance
      // leather on willow at 1.00x
      if (!hitPlayed && (mode === 'flight' || mode === 'ground') && tau >= -0.03 && tau < 0.6) { hitPlayed = true; audio.hit(); }
      // the end: the ball drops, then the veil to the boundary
      if (mode === 'away' && !dip && now - endAt > END_HOLD * 1000) { dip = { at: now, to: 'catch', swapped: false }; audio.whoosh(); }
      var dipA = 0;
      if (dip) {
        var k = (now - dip.at) / 1000;
        if (!dip.swapped) {
          dipA = S5(0, DIP_OUT, k);
          if (k >= DIP_OUT) {
            dip.swapped = true; dip.at = now; dipA = 1;
            if (dip.to === 'catch') { mode = 'catch'; catchAt = now; caughtPlayed = false; chips.length = 0; }
            else toGround();
          }
        } else { dipA = 1 - S5(0, DIP_IN, k); if (k >= DIP_IN) dip = null; }
      }
      var te = mode === 'catch' ? (now - catchAt) / 1000 : 0;
      if (mode === 'catch' && !caughtPlayed && te >= CATCH_IN - 0.05) { caughtPlayed = true; audio.caught(0); }
      if (mode === 'ground' && st.phase === 'betting' && st.rollIn != null && dip && dip.swapped) tau = -st.rollIn / 1000;
      if (W) {
        DS.tau = tau; DS.tc = tc; DS.wall = now / 1000; DS.dip = dipA; DS.shot = mode === 'catch' ? 'catch' : 'play'; DS.te = te;
        W.perf(dt, now); // before drawing: a quality change sizes the canvas, which clears it — after the draw, this frame would show empty
        W.draw(DS);
      }
      overlays(now);
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
        fpsEl.textContent = Math.round(fpsN * 1000 / (now - fpsT)) + ' fps · worst ' + Math.round(worst) + ' ms · q' + i.tier + ' · ' + (i.pr || 0).toFixed(2) + 'x · ' + (i.calls || 0) + ' calls';
        fpsT = now; fpsN = 0; worst = 0;
      }
    }

    // ------------------------------------------------------------ my cash-out: a gold chip with the win lifts off the ball
    var drew = false, BP = { x: 0, y: 0, vis: false };
    function overlays(now) {
      if (!chips.length) { if (drew) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ov.width, ov.height); drew = false; } return; }
      drew = true;
      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      ctx.clearRect(0, 0, V.FULL_W, V.FULL_H);
      if (W) W.ballScreen(BP);
      var bx = BP.vis ? clamp(BP.x, V.LEFT + V.W * 0.2, V.LEFT + V.W * 0.8) : V.LEFT + V.W / 2, by = BP.vis ? clamp(BP.y, V.TOP + V.H * 0.3, V.TOP + V.H * 0.8) : V.TOP + V.H * 0.56;
      for (var i = chips.length - 1; i >= 0; i--) {
        var c = chips[i], t = (now - c.at) / 1000;
        if (t > 2.2) { chips.splice(i, 1); continue; }
        if (c.x == null) { c.x = bx; c.y = by; }                 // it lifts off where the ball was at the cash-out
        var fs = Math.round(clamp(V.W * 0.042, 15, 20));
        ctx.font = '800 ' + fs + 'px "Barlow", system-ui, sans-serif';
        var tw = ctx.measureText(c.text).width + fs * 1.4, th = fs * 1.75;
        var x = c.x + V.W * 0.08, y = c.y - V.H * 0.06 - easeOut(t / 2.2) * V.H * 0.12;
        var a = smooth(t / 0.25) * (1 - smooth((t - 1.5) / 0.7));
        ctx.globalAlpha = a;
        var g = ctx.createLinearGradient(0, y - th / 2, 0, y + th / 2);
        g.addColorStop(0, '#ffe39a'); g.addColorStop(1, '#e2a93a');
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - tw / 2, y - th / 2, tw, th, th / 2); else ctx.rect(x - tw / 2, y - th / 2, tw, th); ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#1d1204'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(c.text, x, y + 1);
        ctx.globalAlpha = 1;
      }
    }

    function topColor() { return W ? W.topColor() : '#bfdcf2'; }
    var api = { resize: resize, frame: frame, topColor: topColor, onStart: onStart, onCrash: onCrash, onBetting: onBetting, onWin: onWin,
      ready: function () { return isReady; },
      clock: function () { return { tau: tau, tc: tc, mode: mode, dip: dip ? dip.to + (dip.swapped ? ':in' : ':out') : '' }; }, // QA
      holding: function () { return mode === 'away' || mode === 'catch'; } }; // the end is still on screen (until the veil brings the crease back)
    return api;
  }

  window.SixerScene = { create: create };

  // ---------------------------------------------------------------- sounds + music
  // Real recordings (CC0, see LICENSES.txt), mixed in WebAudio: the crowd's murmur all match long
  // (it swells while the ball climbs), leather on willow at contact, the wind in flight, the
  // whoosh of the wipe, the catch with the crowd's roar, the cash-out, key clicks; the music streams
  // from an <audio> element.
  var A = null, sfx = null, buf = {}, soundOn = true, musicOn = true, loops = {}, music = null, unlocked = false;
  var SND = BASE + 'sounds/';
  var FILES = { crowd: 'crowd.mp3', bat: 'bat.mp3', wind: 'wind.mp3', whoosh: 'whoosh.mp3', catch: 'catch.mp3', cheer: 'cheer.mp3', click: 'click.mp3', cash: 'cash.mp3' };
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
  function one(name, vol, delay) {
    if (!A || !soundOn || !buf[name]) return null;
    var s = A.createBufferSource(), g = A.createGain();
    s.buffer = buf[name]; g.gain.value = vol == null ? 1 : vol;
    s.connect(g); g.connect(sfx); s.start(A.currentTime + Math.max(0, delay || 0));
    return { s: s, g: g };
  }
  function loop(name) { // a looping recording, its level set by level()
    if (loops[name] || !A || !buf[name]) return loops[name];
    var s = A.createBufferSource(), g = A.createGain();
    s.buffer = buf[name]; s.loop = true; s.loopStart = 0.06; s.loopEnd = buf[name].duration - 0.06; g.gain.value = 0; // skip the mp3 padding at both ends: no gap at the loop point
    s.connect(g); g.connect(sfx); s.start();
    loops[name] = { s: s, g: g };
    return loops[name];
  }
  function level(name, vol, tau) {
    var l = loop(name); if (!l) return;
    l.g.gain.setTargetAtTime(soundOn ? vol : 0, A.currentTime, tau || 0.3);
  }
  function syncMusic() {
    if (!music) { music = new Audio(SND + 'music.mp3'); music.loop = true; music.volume = 0.22; music.preload = 'auto'; }
    if (musicOn && unlocked && !document.hidden) { var p = music.play(); if (p && p.catch) p.catch(function () { unlocked = false; }); }
    else music.pause();
  }
  var hitTimer = 0, hitDone = false;

  window.SixerAudio = {
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
    click: function () { one('click', 0.45); },
    // the shot started `at` s into its clip: the crack of the bat lands on contact
    runup: function (at, hit) { clearTimeout(hitTimer); hitDone = false; hitTimer = setTimeout(function () { hitDone = true; one('bat', 1); one('cheer', 0.4, 0.12); }, Math.max(0, (hit - (at || 0)) * 1000)); },
    hit: function () { if (!hitDone) { clearTimeout(hitTimer); hitDone = true; one('bat', 1); } },
    whoosh: function () { one('whoosh', 0.5); },
    crash: function () { /* the catch sound comes with the catch clip */ },
    caught: function (at) { one('catch', 0.9, at); one('cheer', 0.7, (at || 0) + 0.1); },
    cash: function () { one('cash', 0.6); },
    // every frame: phase ('ground' | 'flying' | 'end'), the multiplier
    tick: function (phase, mult) {
      if (!A || !unlocked) return;
      var u = Math.log(Math.max(1, mult));
      level('crowd', phase === 'flying' ? Math.max(0.12, 0.42 - u * 0.12) : 0.32, 0.6); // the crowd falls away as the ball climbs
      level('wind', phase === 'flying' ? Math.min(0.55, 0.12 + u * 0.16) : 0, phase === 'flying' ? 0.6 : 0.25);
    },
  };
})();
