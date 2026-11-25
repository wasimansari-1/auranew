/* Baaz — the scene and the sounds. window.BaazScene / window.BaazAudio are used by app.js.
 *
 * The scene is real-time 3D (three.js, module main.js) in bright daylight: the falconer (a Meshy character in
 * a sand robe and dark cloak) stands on a dune crest with a peregrine falcon (Meshy models) on his gloved
 * left fist. It springs off the glove exactly at 1.00x, the camera swings round into a chase over the
 * dunes and the oasis, up between the sandstone canyon walls (≈2.25x), through the white cumulus (≈3.6x)
 * and above the cloud sea under a deep blue sky with the sun's glare (≈5.9x, on and on); wind streaks
 * rush past as the multiplier grows. The end: the falcon tucks its wings and stoops away — a jolt, a
 * burst of wind and loose feathers — and the camera glides to a stop on the empty sky. With the next
 * betting it glides home through a soft veil and lands on the glove. Every picture is a pure function
 * of the round time (timeline.js), so a player who joins mid-flight sees exactly the right moment. This
 * classic script loads the module and forwards app.js's calls; a smoothed round clock follows the engine
 * (its ticks jitter by tens of ms; the picture never does). My cash-out: a gold-tipped feather slips
 * from the falcon and drifts down with the win, then turns into an NX token that flies to the balance.
 *   ?fps=1  on-screen frame rate + worst frame (real-device check)
 *   ?q=0|1|2 quality tier (default: 1 on phones, 2 elsewhere; steps down by itself if frames are slow)
 *   ?qa=1   clock-stepped rendering hooks for automated checks (window.__b3d) */
(function () {
  'use strict';

  var BASE = location.pathname.replace(/[^/]*$/, '');
  var QS = new URLSearchParams(location.search);
  var T_LAND = -3.0, LIFT_SND = 2.3, LAND_SND = -5.4; // launch.mp3: the feet leave the glove 2.3 s in
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function S5(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeInOut(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function loadImage(src) {
    return new Promise(function (res) { var i = new Image(); i.decoding = 'async'; i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; });
  }

  function create(cv, opts) {
    opts = opts || {};
    var audio = window.BaazAudio;
    var W = null, isReady = false, pendingView = null;
    // the 2D layer over the 3D picture: the cash-out feather + NX token
    var ov = document.createElement('canvas');
    ov.setAttribute('aria-hidden', 'true'); ov.className = 'ov';
    cv.parentNode.insertBefore(ov, cv.nextSibling);
    var ctx = ov.getContext('2d');
    var featherImg = null, nxImg = null;

    // round state (scene side)
    var mode = 'idle';           // idle | ground | flight | away
    var tau = -2, tc = null, ret = false, hide = false, dip = null, snapNext = true, launchPlayed = false, landPlayed = false;
    var DIP_OUT = 0.45, DIP_IN = 0.8;

    import(BASE + 'main.js').then(function (m) { return m.createScene(cv); }).then(function (w) {
      W = w;
      if (pendingView) W.resize(pendingView);
      isReady = true;
      if (QS.has('qa')) window.__b3d = { draw: W.draw, resize: W.resize, info: W.info, topColor: W.topColor, falconScreen: W.falconScreen, overlays: overlays, scene: api };
      if (opts.onLoad) opts.onLoad();
      loadImage(BASE + 'assets/feather.webp').then(function (i) { featherImg = i; });
      loadImage(BASE + 'assets/nx.webp').then(function (i) { nxImg = i; });
    }).catch(function (e) { if (window.console) console.error('Baaz 3D:', e); isReady = true; if (opts.onLoad) opts.onLoad(); });

    var V = { W: 1, H: 1, TOP: 0, LEFT: 0, FULL_W: 1, FULL_H: 1, dpr: 1 };
    function resize(v) {
      V = v; pendingView = v;
      var w = Math.round(v.FULL_W * v.dpr), h = Math.round(v.FULL_H * v.dpr);
      if (ov.width !== w) ov.width = w;
      if (ov.height !== h) ov.height = h;
      if (W) W.resize(v);
    }

    function swap() { // under the dip: back to the glove; the falcon glides home
      mode = 'ground'; tc = null; ret = true; hide = false; snapNext = true; launchPlayed = false; landPlayed = false;
      if (dip) { dip.swapped = true; dip.at = performance.now(); }
    }
    function onBetting(now) {
      if (mode === 'away') { if (!dip) dip = { at: now, swapped: false }; }
      else if (mode !== 'ground') { ret = false; mode = 'ground'; snapNext = true; } // (the falcon was on the glove already)
      launchPlayed = false;
    }
    function onStart(now, midFlight, elapsedMs) {
      if (dip && !dip.swapped) swap();
      if (mode !== 'flight') { mode = 'flight'; tc = null; hide = false; }
      if (midFlight) { tau = (elapsedMs || 0) / 1000; snapNext = false; }
      if (!launchPlayed && tau < 2.5) { launchPlayed = true; audio.launch(Math.max(0, LIFT_SND + tau)); }
    }
    function onCrash() {
      if (mode === 'flight') { tc = tau; mode = 'away'; audio.stoop(); }
    }
    var feathers = [];
    function onWin(now, text, mult) {
      var p = W ? W.falconScreen({}) : { x: V.LEFT + V.W / 2, y: V.TOP + V.H * 0.6 };
      feathers.push({ at: now, text: text, mult: mult, sway: rand(0, 6), dir: feathers.length % 2 ? 1 : -1, x0: p.x, y0: p.y });
      audio.feather();
    }

    // st: { phase, mult, crashPoint, rollIn (ms to the end of betting), flightMs }
    var fpsEl = null, fpsT = 0, fpsN = 0, worst = 0;
    var DS = { tau: 0, tc: null, wall: 0, ret: false, dip: 0, hide: false }; // one draw state, reused every frame
    function frame(now, dt, st) {
      if (window.__b3dHold) return; // QA: frames are drawn by the clock-stepped harness
      var dts = clamp(dt, 0, 100) / 1000;
      // a first screen: in betting / flying / an ended round
      if (mode === 'idle') {
        if (st.phase === 'betting' && st.rollIn != null) { mode = 'ground'; ret = true; snapNext = true; }   // joined while it comes home
        else if (st.phase === 'flying') onStart(now, true, st.flightMs);
        else if (st.phase === 'crashed') { mode = 'away'; tc = null; hide = true; }                         // the falcon is away: the empty glove
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
      if (mode === 'ground' && target == null) tau = Math.max(Math.min(tau, -0.7), T_LAND + 0.5); // waiting: on the glove
      if (mode === 'ground' && st.phase === 'betting' && st.rollIn != null) {
        if (!landPlayed && ret && tau >= LAND_SND && tau < T_LAND) { landPlayed = true; audio.land(Math.max(0, tau - LAND_SND)); }
        if (!launchPlayed && tau >= -LIFT_SND && tau < 0) { launchPlayed = true; audio.launch(tau + LIFT_SND); }
      }
      // the dip back to the glove
      var dipA = 0;
      if (dip) {
        var k = (now - dip.at) / 1000;
        if (!dip.swapped) { dipA = S5(0, DIP_OUT, k); if (k >= DIP_OUT) { swap(); dipA = 1; } }
        else { dipA = 1 - S5(0, DIP_IN, k); if (k >= DIP_IN) dip = null; }
      }
      if (dip && dip.swapped && st.phase === 'betting' && st.rollIn != null) tau = -st.rollIn / 1000;
      if (W) {
        var t = hide ? -9 : tau;
        DS.tau = t; DS.tc = tc; DS.wall = now / 1000; DS.ret = ret || hide; DS.dip = dipA; DS.hide = hide;
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

    // ------------------------------------------------------------ my cash-out: the golden feather
    // A gold-tipped feather slips from the falcon (where it is on the screen at that moment) and
    // drifts down in a slow pendulum fall with the win on a small leather tag; then it folds into an NX
    // token that arcs to the balance (opts.onToken).
    var FALL = 2.4, FLY = 0.9, drew = false;
    function overlays(now) {
      if (!feathers.length) { if (drew) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ov.width, ov.height); drew = false; } return; }
      drew = true;
      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      ctx.clearRect(0, 0, V.FULL_W, V.FULL_H);
      var s = Math.min(V.W, V.H * 1.2);
      for (var i = feathers.length - 1; i >= 0; i--) {
        var F = feathers[i], t = (now - F.at) / 1000;
        if (t > FALL + FLY + 0.1) { feathers.splice(i, 1); continue; }
        var ft = Math.min(t, FALL);
        var bx = clamp(F.x0, V.LEFT + s * 0.2, V.LEFT + V.W - s * 0.2), by = clamp(F.y0, V.TOP + s * 0.1, V.TOP + V.H * 0.7);
        var fw = clamp(s * 0.13, 44, 96), fh = featherImg ? fw * featherImg.naturalHeight / featherImg.naturalWidth : fw * 1.4;
        var x = bx + F.dir * s * (0.16 + 0.05 * ft) + Math.sin(ft * 2.3 + F.sway) * s * 0.035;
        var y = Math.min(by + s * (0.02 + 0.08 * ft + 0.01 * ft * ft), V.TOP + V.H - fh * 0.5 - s * 0.16);
        x = clamp(x, V.LEFT + fw, V.LEFT + V.W - fw);
        var fa = smooth(t / 0.25) * (1 - smooth((t - (FALL - 0.25)) / 0.3));
        if (fa > 0 && featherImg) {
          ctx.save(); ctx.globalAlpha = fa; ctx.translate(x, y);
          ctx.rotate(Math.sin(ft * 2.3 + F.sway) * 0.5 - 0.35 * F.dir);
          ctx.shadowColor = 'rgba(255, 214, 120, 0.55)'; ctx.shadowBlur = 10;
          ctx.drawImage(featherImg, -fw / 2, -fh / 2, fw, fh);
          ctx.restore();
          var fs = Math.round(clamp(s * 0.04, 13, 19)), sub = Math.round(fs * 0.62);
          ctx.font = '800 ' + fs + 'px "Barlow", system-ui, sans-serif';
          var tw = Math.max(ctx.measureText(F.text).width, 40) + fs * 1.1, th = fs * 1.95, tx = x - tw / 2, ty = y + fh * 0.42;
          ctx.globalAlpha = fa * smooth((t - 0.25) / 0.3);
          ctx.fillStyle = 'rgba(42, 19, 44, 0.94)'; ctx.strokeStyle = '#e2b85c'; ctx.lineWidth = 1.5;
          ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(tx, ty, tw, th, fs * 0.45); else ctx.rect(tx, ty, tw, th); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ffe19a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(F.text, x, ty + fs * 0.75);
          ctx.font = '700 ' + sub + 'px "Barlow Condensed", "Barlow", system-ui, sans-serif';
          ctx.fillStyle = '#d8c39b';
          ctx.fillText(F.mult, x, ty + fs * 1.5);
          ctx.globalAlpha = 1;
          F.end = [x, y];
        }
        if (t > FALL - 0.25 && F.end && nxImg) {
          var u = easeInOut((t - (FALL - 0.25)) / FLY), wal = V.WAL || { x: V.FULL_W - 60, y: 30 };
          var p0 = F.end, p2 = [wal.x, wal.y], p1 = [lerp(p0[0], p2[0], 0.5) + (p2[0] > p0[0] ? s * 0.25 : -s * 0.25), Math.min(p0[1], p2[1]) + s * 0.05];
          var qx = (1 - u) * (1 - u) * p0[0] + 2 * u * (1 - u) * p1[0] + u * u * p2[0];
          var qy = (1 - u) * (1 - u) * p0[1] + 2 * u * (1 - u) * p1[1] + u * u * p2[1];
          var r = clamp(s * 0.045, 14, 22) * (1 - 0.35 * u) * smooth((t - (FALL - 0.25)) / 0.2);
          ctx.save(); ctx.globalAlpha = 1 - smooth((u - 0.92) / 0.08);
          var g = ctx.createRadialGradient(qx - r * 0.3, qy - r * 0.35, r * 0.1, qx, qy, r);
          g.addColorStop(0, '#fff3c8'); g.addColorStop(0.5, '#e2b85c'); g.addColorStop(1, '#8a5d18');
          ctx.shadowColor = 'rgba(255, 210, 110, 0.8)'; ctx.shadowBlur = 14;
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(qx, qy, r, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          var iw = r * 1.45, ih = iw * nxImg.naturalHeight / nxImg.naturalWidth;
          ctx.drawImage(nxImg, qx - iw / 2, qy - ih / 2, iw, ih);
          ctx.restore();
          if (u >= 1 && !F.arrived) { F.arrived = true; if (opts.onToken) opts.onToken(); }
        }
      }
    }

    function topColor() { return W ? W.topColor() : '#4f8fd8'; }
    var api = { resize: resize, frame: frame, topColor: topColor, onStart: onStart, onCrash: onCrash, onBetting: onBetting, onWin: onWin,
      ready: function () { return isReady; },
      clock: function () { return { tau: tau, tc: tc, mode: mode, ret: ret, dip: dip ? (dip.swapped ? 'in' : 'out') : '' }; }, // QA
      holding: function () { return mode === 'away'; } }; // the end is still on screen (until the dip swaps to the glove)
    return api;
  }

  window.BaazScene = { create: create };

  // ---------------------------------------------------------------- sounds + music
  // Real recordings (CC0, see LICENSES.txt), mixed in WebAudio: the desert breeze on the ground, the
  // wingbeats + call at the launch, the wind in flight (level and pitch follow the multiplier), the
  // whoosh of the stoop, the flutter of the landing, the feather + coin at a cash-out, key clicks;
  // the music streams from an <audio> element.
  var A = null, sfx = null, buf = {}, soundOn = true, musicOn = true, loops = {}, music = null, unlocked = false;
  var SND = BASE + 'sounds/';
  var FILES = { breeze: 'breeze.mp3', launch: 'launch.mp3', wind: 'wind.mp3', stoop: 'stoop.mp3', land: 'land.mp3', feather: 'feather.mp3', cash: 'cash.mp3', click: 'click.mp3' };
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
  function loop(name) {
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
  var launchSrc = null;
  function syncMusic() {
    if (!music) { music = new Audio(SND + 'music.mp3'); music.loop = true; music.volume = 0.26; music.preload = 'auto'; }
    if (musicOn && unlocked && !document.hidden) { var p = music.play(); if (p && p.catch) p.catch(function () { unlocked = false; }); }
    else music.pause();
  }

  window.BaazAudio = {
    unlock: function (gesture) {
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
    launch: function (at) { if (launchSrc) return; launchSrc = one('launch', 0.85, 1, at); },
    stoop: function () { one('stoop', 0.7); },
    land: function (at) { one('land', 0.6, 1, at); },
    feather: function () { one('feather', 0.6); setTimeout(function () { one('cash', 0.5); }, 2500); },
    // every frame: phase ('ground' | 'flying' | 'away'), the multiplier
    tick: function (phase, mult) {
      if (!A || !unlocked) return;
      var u = Math.log(Math.max(1, mult));
      level('breeze', phase === 'flying' ? 0.08 : 0.32, 1, 0.6);
      level('wind', phase === 'flying' ? Math.min(0.6, 0.22 + u * 0.12) : 0, 0.95 + Math.min(0.3, u * 0.08), phase === 'away' ? 0.8 : 0.5);
      if (phase !== 'flying' && launchSrc && phase === 'ground') launchSrc = null;
    },
  };
})();
