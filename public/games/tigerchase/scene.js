/* Tiger Chase — the scene and the sounds. window.TigerScene / window.TigerAudio are used by app.js.
 *
 * The scene is real-time 3D (three.js, module main.js): a Bengal tiger stalking and chasing a chital stag
 * through Kanha — the golden meadow by an old shrine, the sal forest, the river crossing and the sandstone
 * ridge in the golden hour — and the end: the crash IS the catch — a burst of speed, the pounce, a cloud of dust
 * and grass hides the moment, the stag lies in the grass and the tiger stands beside it and roars (nothing
 * gory: no blood, no wounds). Every picture is a pure function of the round time (timeline.js), so a player who joins
 * mid-round sees exactly the right moment. This classic script loads the module and forwards app.js's calls;
 * a smoothed round clock follows the engine (ticks jitter by tens of ms; the picture never does). The 2D
 * canvas over the 3D one carries my cash-out (the "Safe" tag over the animals, the NX token walking to the
 * balance on gold pugmarks) and the warm-haze dip back to the stalk.
 *   ?fps=1  on-screen frame rate + worst frame (real-device check)
 *   ?q=0|1|2 quality (2 = full, the default; it adapts by itself: down after 3 s of slow frames, back up when fast)
 *   ?pr=…   force the pixel ratio
 *   ?qa=1   clock-stepped rendering hooks for automated checks (window.__t3d) */
(function () {
  'use strict';

  var BASE = location.pathname.replace(/[^/]*$/, '');
  var QS = new URLSearchParams(location.search);
  var GROWTH = 0.06;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function S5(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
  function easeInOut(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function loadImage(src) {
    return new Promise(function (res) { var i = new Image(); i.decoding = 'async'; i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; });
  }
  // a tiger's pugmark (4 toes + the pad), unit size, pointing up (-y)
  function pug(ctx, x, y, s, ang) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s / 100, s / 100); ctx.translate(-50, -55);
    [[20, 40, -25], [40, 22, -8], [62, 22, 8], [81, 40, 25]].forEach(function (t) {
      ctx.save(); ctx.translate(t[0], t[1]); ctx.rotate(t[2] * Math.PI / 180); ctx.beginPath(); ctx.ellipse(0, 0, 10, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    });
    ctx.beginPath(); ctx.moveTo(50, 46);
    ctx.bezierCurveTo(38, 46, 31, 54, 27, 62); ctx.bezierCurveTo(21, 70, 15, 78, 21, 88); ctx.bezierCurveTo(27, 96, 39, 93, 50, 91);
    ctx.bezierCurveTo(61, 93, 73, 96, 79, 88); ctx.bezierCurveTo(85, 78, 79, 70, 73, 62); ctx.bezierCurveTo(69, 54, 62, 46, 50, 46);
    ctx.fill(); ctx.restore();
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }

  function create(cv, opts) {
    opts = opts || {};
    var audio = window.TigerAudio;
    var ctx = cv.getContext('2d');
    var gl = document.createElement('canvas'); // the 3D picture, under the 2D overlay
    gl.className = 'gl'; gl.setAttribute('aria-hidden', 'true');
    cv.parentNode.insertBefore(gl, cv);
    var W = null, isReady = false, pendingView = null, nxImg = null, tl = null;
    var V = { W: 1, H: 1, TOP: 0, LEFT: 0, FULL_W: 1, FULL_H: 1, dpr: 1 };
    // round state (scene side)
    var mode = 'idle';          // idle | stalk | chase | end
    var tau = -6.5, tc = null, wins = [], dip = null, wantDip = false, snapNext = true, lastNow = 0;
    var DIP_OUT = 0.45, DIP_IN = 0.8, HAZE = [246, 226, 196];
    var cue = { alarm: false, burst: false, pounce: false, hit: false, roar: false };

    Promise.all([import(BASE + 'main.js'), import(BASE + 'timeline.js')]).then(function (m) { tl = m[1]; return m[0].createScene(gl); }).then(function (w) {
      W = w;
      if (pendingView) W.resize(pendingView);
      isReady = true;
      if (QS.has('qa')) window.__t3d = { draw: W.draw, resize: W.resize, info: W.info, topColor: W.topColor, poses: W.poses, project: W.project, anchor: W.anchor, timeline: tl, overlay: overlay, wins: wins, gl: gl };
      if (opts.onLoad) opts.onLoad();
    }).catch(function (e) { if (window.console) console.error('Tiger Chase 3D:', e); isReady = true; if (opts.onLoad) opts.onLoad(); });
    loadImage(BASE + 'assets/nx.webp').then(function (i) { nxImg = i; });

    function resize(v) { V = v; pendingView = v; if (W) W.resize(v); }

    function swap(now) { // under the dip: back to the meadow for the next round
      mode = 'stalk'; tc = null; snapNext = true; wantDip = false;
      cue.alarm = cue.burst = cue.pounce = cue.hit = cue.roar = false;
      if (dip) { dip.swapped = true; dip.at = now; }
    }
    function onBetting(now) {
      if (mode === 'end' || mode === 'chase') wantDip = true;          // the end plays out first (≤ ~1 s more), then the haze
      else if (mode !== 'stalk') { mode = 'stalk'; snapNext = true; }
    }
    function onStart(now, midRound, elapsedMs) {
      if (dip && !dip.swapped) swap(now);
      if (wantDip) { wantDip = false; mode = 'stalk'; tc = null; snapNext = true; cue.alarm = cue.burst = cue.pounce = cue.hit = cue.roar = false; }
      if (mode !== 'chase') { mode = 'chase'; tc = null; }
      if (midRound) { tau = (elapsedMs || 0) / 1000; snapNext = false; cue.alarm = cue.burst = true; }
    }
    function onCrash(now) {
      if (mode === 'chase') { tc = Math.max(0, tau); if (tau < -0.5) tau = 0; mode = 'end'; } // (a crash before this screen ever ran: the catch at once)
    }
    // my cash-out: the tag with the win over the animals, the NX token walks to the balance (to: stage px)
    function onWin(now, text, x, to) { wins.push({ at: now, text: text, x: x, to: to }); if (wins.length > 3) wins.shift(); audio.cash(); }

    // st: { phase, mult, rollIn (ms to the end of betting, may go negative), flightMs }
    var fpsEl = null, fpsT = 0, fpsN = 0, worst = 0;
    function frame(now, dt, st) {
      if (window.__t3dHold) return; // QA: frames are drawn by the clock-stepped harness
      var dts = clamp(dt, 0, 100) / 1000;
      lastNow = now;
      // the round clock: follow the engine, never jump (except to catch up a big gap: joining)
      var target = null;
      if (mode !== 'end' && !wantDip) {
        if (st.phase === 'betting' && st.rollIn != null) target = -st.rollIn / 1000;
        else if (st.phase === 'flying') target = st.flightMs != null ? st.flightMs / 1000 : Math.log(Math.max(1, st.mult)) / GROWTH;
      }
      if (mode === 'idle' && st.phase === 'betting') { mode = 'stalk'; snapNext = true; }
      if (mode === 'idle' && st.phase === 'flying') onStart(now, true, st.flightMs);
      // joined after a crash: the client only knows the crash point (not when it came), so straight to the catch's
      // last picture — the tiger beside the downed stag — the picture everyone holds until the next stalk
      if (mode === 'idle' && st.phase === 'crashed' && st.mult >= 1 && tl) {
        tc = Math.log(st.mult) / GROWTH; tau = tc + tl.endLength(tc); mode = 'end';
        cue.alarm = cue.burst = cue.pounce = cue.hit = cue.roar = true;
      }
      if (target != null && mode !== 'idle') {
        var err = target - tau;
        if (snapNext || Math.abs(err) > 1.2) { tau = target; snapNext = false; }
        else tau += dts * (1 + clamp(err * 0.35, -0.12, 0.12)); // engine ticks jitter ±50 ms: follow gently
      } else if (mode === 'end' || mode === 'chase') tau += dts;
      if (mode === 'idle' || (mode === 'stalk' && target == null)) tau = Math.min(tau, -6.5);
      // the haze back to the stalk: once the end has played out
      if (wantDip && !dip && (tc == null || !tl || tau - tc >= tl.endLength(tc) + 0.55)) dip = { at: now, swapped: false };
      var dipA = 0;
      if (dip) {
        var k = (now - dip.at) / 1000;
        if (!dip.swapped) { dipA = S5(0, DIP_OUT, k); if (k >= DIP_OUT) { swap(now); dipA = 1; } }
        else { dipA = 1 - S5(0, DIP_IN, k); if (k >= DIP_IN) dip = null; }
      }
      if (dip && dip.swapped && st.phase === 'betting' && st.rollIn != null) tau = -st.rollIn / 1000; // under the dip: the stalk at the right moment
      cues();
      if (W) {
        W.perf(dt, now); // before drawing: a quality change sizes the canvas, which clears it — after the draw, this frame would show empty
        W.draw({ tau: tau, tc: tc, wall: now / 1000 });
      }
      overlay(now, dipA);
      if (QS.has('fps')) fpsMeter(now, dt);
    }
    // sounds tied to the picture's own clock
    function cues() {
      if (!tl) return;
      if (mode === 'stalk' || mode === 'chase') {
        if (!cue.alarm && tau >= tl.T_S - 0.35 && tau < 1) { cue.alarm = true; audio.alarm(); }
        if (!cue.burst && tau >= tl.T_T && tau < 1) { cue.burst = true; audio.burst(); }
      }
      if (mode === 'end' && tc != null) {
        var e = tl.endPlan();
        if (e && e.tc === tc) {
          var u = tau - tc;
          if (!cue.pounce && u >= e.uP - 0.12) { cue.pounce = true; if (u < e.uP + 0.3) audio.pounce(); }
          if (!cue.hit && u >= e.uI) { cue.hit = true; if (u < e.uI + 0.4) audio.hit(); }
          if (!cue.roar && u >= e.uI + 0.42) { cue.roar = true; if (u < e.uI + 0.9) audio.roar(); }
        }
      }
      audio.gait(mode === 'chase' || (mode === 'end' && !cue.pounce) ? 1 : mode === 'stalk' && tau > tl.T_T ? clamp((tau - tl.T_T) / 1.2, 0, 1) : 0, tau, tc);
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
        fpsEl.textContent = Math.round(fpsN * 1000 / (now - fpsT)) + ' fps · worst ' + Math.round(worst) + ' ms · rung ' + i.tier + '/' + ((i.rungs || 1) - 1) + ' · DPR ' + (i.pr || 0).toFixed(2) + ' (' + (i.buffer || []).join('×') + ') · ' + (i.calls || 0) + ' calls · ' + Math.round((i.triangles || 0) / 1000) + 'k tris';
        fpsT = now; fpsN = 0; worst = 0;
      }
    }

    // ------------------------------------------------------------ overlays (2D canvas, only when needed)
    var drew = false, AN = { x: 0, y: 0 };
    function overlay(now, cover) {
      if (!wins.length && cover <= 0) { if (drew) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); drew = false; } return; }
      drew = true;
      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      ctx.clearRect(0, 0, V.FULL_W, V.FULL_H);
      drawWins(now);
      if (cover > 0) { // warm morning haze: soft, never a flash
        var g = ctx.createRadialGradient(V.LEFT + V.W * 0.5, V.TOP + V.H * 0.5, 0, V.LEFT + V.W * 0.5, V.TOP + V.H * 0.5, Math.max(V.FULL_W, V.FULL_H) * 0.8);
        g.addColorStop(0, 'rgba(' + HAZE.join(',') + ',' + cover + ')'); g.addColorStop(1, 'rgba(' + HAZE.map(function (v) { return Math.round(v * 0.9); }).join(',') + ',' + cover + ')');
        ctx.fillStyle = g; ctx.fillRect(0, 0, V.FULL_W, V.FULL_H);
      }
    }
    // the tag rises over the animals; after 0.5 s the gold NX token leaves it and walks to the balance
    // (to) on four gold pugmarks that fade behind it; it is gone in ~2.2 s, the tag in 3 s
    function drawWins(now) {
      if (!wins.length) return;
      var portrait = V.W / V.H < 1.15;
      if (W) W.anchor(AN); else { AN.x = V.LEFT + V.W / 2; AN.y = V.TOP + V.H * 0.45; }
      var fs = Math.round(clamp(Math.min(V.W, V.H * 1.3) * 0.06, 20, 30)), ks = Math.round(fs * 0.42);
      var cx = clamp(AN.x, V.LEFT + 90, V.LEFT + V.W - 90), cy = clamp(AN.y, V.TOP + Math.max(70, V.H * 0.3), V.TOP + V.H - 40);
      for (var i = wins.length - 1; i >= 0; i--) {
        var w = wins[i], t = (now - w.at) / 1000;
        if (t > 3.2) { wins.splice(i, 1); continue; }
        var a = smooth(t / 0.3) * (1 - smooth((t - 2.6) / 0.5));
        ctx.font = '700 ' + fs + 'px "Teko", "Hind", sans-serif';
        var tw = ctx.measureText(w.text).width;
        ctx.font = '600 ' + ks + 'px "Hind", sans-serif';
        var kw = ctx.measureText(w.x).width + ks * 2.4;
        var bw = Math.max(tw, kw) + fs * 1.5, bh = fs * 1.95, bx = cx - bw / 2, by = cy - bh / 2 - (1 - smooth(t / 0.4)) * 10 - i * (bh + 6);
        ctx.globalAlpha = a;
        ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
        var g = ctx.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, '#fbf1dc'); g.addColorStop(1, '#ead8b2');
        ctx.fillStyle = g; rr(ctx, bx, by, bw, bh, bh * 0.22); ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.strokeStyle = 'rgba(120,80,20,0.55)'; ctx.lineWidth = 2; // the tag's punched hole
        ctx.beginPath(); ctx.arc(bx + fs * 0.42, by + bh / 2, fs * 0.13, 0, Math.PI * 2); ctx.fillStyle = '#1c281e'; ctx.fill(); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#7a5a2a'; ctx.font = '600 ' + ks + 'px "Hind", sans-serif';
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0.16em';
        ctx.fillText(w.x, cx + fs * 0.2, by + bh * 0.36);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.fillStyle = '#16834a'; ctx.font = '700 ' + fs + 'px "Teko", "Hind", sans-serif';
        ctx.fillText(w.text, cx + fs * 0.2, by + bh * 0.86);
        if (w.to && t > 0.5) { // the token's walk
          var p = easeInOut((t - 0.5) / 1.3), from = { x: bx + bw - 4, y: by + 6 }, to = w.to;
          var ctl = { x: lerp(from.x, to.x, 0.85) + (portrait ? V.W * 0.12 : 0), y: Math.min(from.y, to.y) + (portrait ? (from.y - to.y) * 0.55 : 10) };
          var Bz = function (u) { return { x: (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * ctl.x + u * u * to.x, y: (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * ctl.y + u * u * to.y }; };
          var marks = [0.2, 0.4, 0.6, 0.8], ps = clamp(fs * 0.8, 16, 24);
          ctx.fillStyle = '#ffd27a';
          for (var m = 0; m < marks.length; m++) {
            if (p < marks[m]) break;
            var q = Bz(marks[m]), q2 = Bz(marks[m] + 0.02), ang = Math.atan2(q2.y - q.y, q2.x - q.x) + Math.PI / 2;
            var side = m % 2 ? 1 : -1, ma = (1 - smooth((t - 0.5 - marks[m] * 1.3) / 0.9)) * 0.85;
            if (ma <= 0) continue;
            ctx.globalAlpha = ma * a;
            pug(ctx, q.x + Math.cos(ang) * side * ps * 0.35, q.y + Math.sin(ang) * side * ps * 0.35, ps, ang);
          }
          if (p < 1) {
            var tp = Bz(p), r = clamp(fs * 0.85, 17, 24);
            ctx.globalAlpha = smooth((t - 0.5) / 0.2) * (1 - smooth((p - 0.9) / 0.1));
            var cg = ctx.createRadialGradient(tp.x - r * 0.3, tp.y - r * 0.35, r * 0.1, tp.x, tp.y, r);
            cg.addColorStop(0, '#fff2c4'); cg.addColorStop(0.4, '#f2c25a'); cg.addColorStop(0.8, '#b07a1e'); cg.addColorStop(1, '#7a4f10');
            ctx.shadowColor = 'rgba(255,205,100,0.8)'; ctx.shadowBlur = 18;
            ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2); ctx.fill();
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
            if (nxImg) { var nw = r * 1.4, nh = nw / 2; ctx.drawImage(nxImg, tp.x - nw / 2, tp.y - nh / 2, nw, nh); }
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    function topColor() {
      if (dip) return '#' + HAZE.map(function (v) { return ('0' + Math.round(v * 0.94).toString(16)).slice(-2); }).join('');
      return W ? W.topColor() : '#c8b7a5';
    }
    return { resize: resize, frame: frame, topColor: topColor, onStart: onStart, onCrash: onCrash, onBetting: onBetting, onWin: onWin,
      ready: function () { return isReady; },
      clock: function () { return { tau: tau, tc: tc, mode: mode, dip: dip ? (dip.swapped ? 'in' : 'out') : '' }; }, // QA
      holding: function () { return mode === 'end'; } }; // the end is still on screen (until the haze swaps to the stalk)
  }

  window.TigerScene = { create: create };

  // ---------------------------------------------------------------- sounds + music
  // Real recordings (CC0, see LICENSES.txt), mixed in WebAudio: the morning jungle while bets are open, the
  // chital's alarm call and the grass rush at the burst, paw / hoof beats on the gait's own rhythm + the wind
  // of the chase (level follows the multiplier), the river splash; in the catch the rush of the pounce, the thud
  // and the scatter of gravel as they come down, then the tiger's roar (made here: a low growl swelling into
  // a roar — filtered noise over a falling, rough tone); a wooden tok + chime on my cash-out; the music streams
  // from an <audio> element.
  var A = null, sfx = null, buf = {}, soundOn = true, musicOn = true, loops = {}, music = null, unlocked = false;
  var SND = BASE + 'sounds/';
  var FILES = { jungle: 'jungle.mp3', run: 'run.mp3', wind: 'wind.mp3', alarm: 'alarm.mp3', burst: 'burst.mp3', stop: 'stop.mp3', cash: 'cash.mp3', click: 'click.mp3', beat: 'beat.mp3', splash: 'splash.mp3', river: 'river.mp3' };
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
  function one(name, vol, rate) {
    if (!A || !soundOn || !buf[name] || A.state !== 'running') return null;
    var s = A.createBufferSource(), g = A.createGain();
    s.buffer = buf[name]; s.playbackRate.value = rate || 1; g.gain.value = vol == null ? 1 : vol;
    s.connect(g); g.connect(sfx); s.start();
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
  function level(name, vol, tau) {
    var l = loop(name); if (!l) return;
    l.g.gain.setTargetAtTime(soundOn ? vol : 0, A.currentTime, tau || 0.3);
  }
  function syncMusic() {
    if (!music) { music = new Audio(SND + 'music.mp3'); music.loop = true; music.volume = 0.25; music.preload = 'auto'; }
    if (musicOn && unlocked && !document.hidden) { var p = music.play(); if (p && p.catch) p.catch(function () { unlocked = false; }); }
    else music.pause();
  }
  // the beats of the gallop: the tiger's four paws (2.83 strides a second) and the stag's hooves (3.1), from
  // the picture's own clock; in the river crossing (τ 15.3–17.2 s) they splash
  var lastBeat = -1, lastHoof = -1, TD_T = [0.0, 0.09, 0.5, 0.6], TD_S = [0.0, 0.06, 0.48, 0.56];
  function gait(k, tau, tc) {
    if (!A || !unlocked || k <= 0 || A.state !== 'running') { lastBeat = lastHoof = -1; return; }
    var wetT = tau > 15.45 && tau < 16.75 && (tc == null || tc > 15.45), wetS = tau > 15.05 && tau < 16.35;
    var pt = Math.max(0, tau + 0.75) * 13 / 4.6, ps = Math.max(0, tau + 0.5) * 13 / 4.2;
    var bt = Math.floor(pt) * 4 + TD_T.filter(function (x) { return pt % 1 >= x; }).length, bs = Math.floor(ps) * 4 + TD_S.filter(function (x) { return ps % 1 >= x; }).length;
    if (lastBeat >= 0 && bt !== lastBeat) { if (wetT) one('splash', 0.34 * k, 0.9 + 0.3 * Math.random()); else one('beat', 0.5 * k, 0.72 + 0.1 * Math.random()); }
    if (lastHoof >= 0 && bs !== lastHoof) { if (wetS) one('splash', 0.22 * k, 1.2 + 0.3 * Math.random()); else one('beat', 0.2 * k, 1.25 + 0.15 * Math.random()); }
    lastBeat = bt; lastHoof = bs;
  }
  // a low thud (the landing) and the roar, synthesised (no recording needed; quiet when the sound is off)
  function noiseBuf() {
    if (buf._noise) return buf._noise;
    var n = A.sampleRate * 2, b = A.createBuffer(1, n, A.sampleRate), d = b.getChannelData(0), last = 0;
    for (var i = 0; i < n; i++) { last = 0.82 * last + 0.18 * (Math.random() * 2 - 1); d[i] = last * 2.2; } // brown-ish
    buf._noise = b; return b;
  }
  function thud() {
    if (!A || !soundOn || A.state !== 'running') return;
    var t = A.currentTime, o = A.createOscillator(), g = A.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(sfx); o.start(t); o.stop(t + 0.55);
  }
  function roar() {
    if (!A || !soundOn || A.state !== 'running') return;
    var t = A.currentTime, D = 1.5;
    // the rough voice: a sawtooth, its pitch rising then falling, shaken by a fast tremor (the growl)
    var o = A.createOscillator(), trem = A.createOscillator(), tg = A.createGain(), vg = A.createGain(), lp = A.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(62, t); o.frequency.linearRampToValueAtTime(118, t + 0.35); o.frequency.exponentialRampToValueAtTime(58, t + D);
    trem.type = 'square'; trem.frequency.setValueAtTime(26, t); trem.frequency.linearRampToValueAtTime(34, t + D); tg.gain.value = 0.35;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(1300, t + 0.3); lp.frequency.exponentialRampToValueAtTime(420, t + D); lp.Q.value = 3;
    vg.gain.setValueAtTime(0.0001, t); vg.gain.exponentialRampToValueAtTime(0.5, t + 0.18); vg.gain.setValueAtTime(0.5, t + 0.7); vg.gain.exponentialRampToValueAtTime(0.0001, t + D);
    trem.connect(tg); tg.connect(vg.gain);
    o.connect(lp); lp.connect(vg); vg.connect(sfx);
    // the breath: band-passed noise with the same swell
    var n = A.createBufferSource(), bp = A.createBiquadFilter(), ng = A.createGain();
    n.buffer = noiseBuf(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(900, t + 0.3); bp.frequency.exponentialRampToValueAtTime(300, t + D); bp.Q.value = 0.9;
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.7, t + 0.2); ng.gain.exponentialRampToValueAtTime(0.0001, t + D);
    n.connect(bp); bp.connect(ng); ng.connect(sfx);
    o.start(t); trem.start(t); n.start(t); o.stop(t + D + 0.05); trem.stop(t + D + 0.05); n.stop(t + D + 0.05);
  }
  window.TigerAudio = {
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
    click: function () { one('click', 0.5); },
    alarm: function () { one('alarm', 0.6); },         // the stag's alarm call, just before it bolts
    burst: function () { one('burst', 0.7); },         // the tiger bursting out of the grass
    pounce: function () { one('burst', 0.55, 1.3); },  // the rush of the pounce
    hit: function () { one('stop', 0.9, 0.8); thud(); }, // they come down: a thud + gravel
    roar: function () { roar(); },
    cash: function () { one('cash', 0.6); },
    gait: gait,
    // every frame: phase ('ground' | 'run' | 'end'), the multiplier
    tick: function (phase, mult) {
      if (!A || !unlocked) return;
      var u = Math.log(Math.max(1, mult)), t = u / GROWTH;
      var river = phase === 'run' ? clamp(1 - Math.abs(t - 16) / 3.2, 0, 1) : 0;
      level('jungle', phase === 'ground' ? 0.45 : phase === 'end' ? 0.3 : 0.16, 0.6);
      level('run', phase === 'run' ? Math.min(0.5, 0.26 + u * 0.07) * (1 - 0.6 * river) : 0, phase === 'end' ? 0.25 : 0.3);
      level('wind', phase === 'run' ? Math.min(0.45, 0.12 + u * 0.1) : 0, 0.5);
      level('river', 0.5 * river, 0.4);
    },
  };
})();
