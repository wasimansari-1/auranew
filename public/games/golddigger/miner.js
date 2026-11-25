/* Gold Digger — the miner, as one pluggable layer (window.MinerLayer).
 *
 * The miner is a green-screen video (miner/manifest.json: idle, drillStart → drillLoop, cash,
 * bust; 720×1280 H.264, muted) keyed in real time by a small WebGL shader into an offscreen
 * canvas that the scene draws. The photo still (assets/miner.webp) is the poster: it shows until
 * the first clip has a frame (then dissolves into it), and stays if there is no WebGL or video.
 *
 * No flicker: every player is "primed" (paused on its first frame, already decoded) before it is
 * shown, so a switch never shows a stale or empty frame; a clip that is seeking or buffering keeps
 * the last keyed frame on screen (never falls back to the poster); clips change with a crossfade,
 * and a looping clip with "crossfade" blends its end into its start with a second primed player.
 *
 * Placement is by the boots: draw(ctx, footX, footY, hf, now) puts the boots at footX/footY with
 * the standing miner hf tall (helmet → boots); every clip says where the boots are and how tall
 * the standing miner is in its frame. The miner is shot neutral; a per-place tint (multiply)
 * warms him to match the place's light. */
(function () {
  'use strict';

  // The still: assets/miner.webp (200×760): boots point, standing height, headlamp, bit (px).
  var STILL = { src: 'assets/miner.webp', foot: [68.85, 757.35], h: 754.6, lamp: [31.05, 37.1], bit: [18.9, 732.4] };
  var FADE = 0.2;        // seconds of crossfade when the clip changes
  var POSTER_FADE = 0.35; // the poster dissolving into the first video frame

  // ---------------------------------------------------------------- green-dominance key (WebGL)
  // alpha = 1 − (g − max(r,b) − threshold) × softness; despill: g ≤ max(r,b) + despill; tint.
  var VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
  var FS = [
    'precision mediump float;varying vec2 uv;uniform sampler2D ta,tb;uniform float k;uniform vec3 opt,tint;',
    'vec4 key(vec4 c){float m=max(c.r,c.b);float a=clamp(1.-(c.g-m-opt.x)*opt.y,0.,1.);',
    ' vec3 rgb=vec3(c.r,min(c.g,m+opt.z),c.b)*tint;return vec4(rgb*a,a);}',
    'void main(){vec4 a=key(texture2D(ta,uv));gl_FragColor=k>0.?mix(a,key(texture2D(tb,uv)),k):a;}',
  ].join('\n');

  function Keyer(opt, tint) {
    var cv = document.createElement('canvas'), gl = null;
    try { gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true }); } catch (e) { gl = null; }
    if (!gl) return null;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    function texture(unit) {
      var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (w) { gl.texParameteri(gl.TEXTURE_2D, w, gl.CLAMP_TO_EDGE); });
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    }
    var tex = [texture(0), texture(1)], last = [null, -1, null, -1];
    gl.uniform1i(gl.getUniformLocation(pr, 'ta'), 0); gl.uniform1i(gl.getUniformLocation(pr, 'tb'), 1);
    gl.uniform3f(gl.getUniformLocation(pr, 'opt'), opt.threshold / 255, opt.softness, opt.despill / 255);
    gl.uniform3f(gl.getUniformLocation(pr, 'tint'), tint[0], tint[1], tint[2]);
    var uK = gl.getUniformLocation(pr, 'k'), lastK = -1;
    function upload(unit, v) { // a texture changes only when its video shows a new frame
      if (last[unit * 2] === v && last[unit * 2 + 1] === v.currentTime) return false;
      last[unit * 2] = v; last[unit * 2 + 1] = v.currentTime;
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex[unit]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      return true;
    }
    return {
      canvas: cv,
      key: function (a, b, k) { // video a (and b mixed in by k) → keyed RGBA in cv; redraws only on change
        var w = a.videoWidth, h = a.videoHeight;
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); lastK = -1; }
        var changed = upload(0, a);
        if (b && k > 0 && upload(1, b)) changed = true;
        var kk = b ? k : 0;
        if (!changed && kk === lastK) return;
        lastK = kk;
        gl.uniform1f(uK, kk);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
    };
  }

  // the still, warmed by the same tint (multiply, keeping its alpha)
  function tinted(img, tint) {
    var c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(' + tint.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(img, 0, 0);
    return c;
  }

  function lerp(a, b, k) { return a + (b - a) * k; }
  // a point that may move over the clip's time: [x, y] or keyframes [[t, x, y], …]
  function pointAt(p, t) {
    if (!p || typeof p[0] === 'number') return p;
    if (t <= p[0][0]) return [p[0][1], p[0][2]];
    for (var i = 1; i < p.length; i++) {
      if (t <= p[i][0]) { var a = p[i - 1], b = p[i], k = (t - a[0]) / (b[0] - a[0]); k = k * k * (3 - 2 * k); return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
    }
    var z = p[p.length - 1]; return [z[1], z[2]];
  }

  // ---------------------------------------------------------------- the layer
  function create(base, opts) {
    var tint = (opts && opts.tint) || [1, 1, 1];
    var still = null, onLoad = null;
    var loaded = new Promise(function (res) { onLoad = res; });
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () { still = tinted(img, tint); onLoad(); };
    img.onerror = function () { onLoad(); };
    img.src = base + STILL.src;

    var M = null, keyer = null, clips = {}, want = 'idle';
    var cur = null, prev = null, fadeAt = 0, fadeLen = FADE; // on screen: { k: clip, p: its player } (+ the one fading out)
    var shownAt = 0; // when the first video frame was shown (the poster dissolves into it)

    // the clip list + the idle clip right away (it never holds up "ready"); the rest after ready
    var manifest = fetch(base + 'miner/manifest.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (!m || !m.clips || !Object.keys(m.clips).length) return null;
      var k = m.key || {};
      keyer = Keyer({ threshold: k.threshold != null ? k.threshold : 14, softness: k.softness != null ? k.softness : 9, despill: k.despill != null ? k.despill : 6 }, tint);
      if (!keyer) return null; // no WebGL: the still
      M = m;
      clip('idle');
      return m;
    }).catch(function () { return null; });
    function preload() { manifest.then(function (m) { if (m) Object.keys(m.clips).forEach(clip); }); }

    // A player: a muted inline video kept "primed" (paused on its start frame, decoded) when not on screen.
    function Player(src, from, loop) {
      var v = document.createElement('video'), P = { v: v, from: from, primed: false };
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = !!loop; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      v.addEventListener('seeked', function () { if (v.paused) P.primed = Math.abs(v.currentTime - from) < 0.05; });
      v.addEventListener('loadeddata', function () { prime(P); }, { once: true });
      v.src = src; v.load();
      // mobile browsers buffer a video only once it has played: a muted play → pause primes it
      var p = v.play();
      if (p && p.then) p.then(function () { if (!onScreen(P)) prime(P); }).catch(function () { /* primes on loadeddata */ });
      return P;
    }
    function onScreen(P) { return (cur && cur.p === P) || (prev && prev.p === P); }
    function prime(P) {
      var v = P.v;
      if (onScreen(P) || v.readyState < 1) return;
      v.pause();
      if (Math.abs(v.currentTime - P.from) < 0.01 && v.readyState >= 2 && !v.seeking) { P.primed = true; return; }
      P.primed = false;
      try { v.currentTime = P.from; } catch (e) { /* retried on loadeddata */ }
    }
    function ready(P) { return P.primed && P.v.readyState >= 2 && !P.v.seeking; }

    function clip(name) { // the clip's player(s), created once
      if (clips[name] || !M || !M.clips[name]) return clips[name];
      var c = M.clips[name], src = base + 'miner/' + c.src, from = c.start || 0;
      var xf = c.loop && c.crossfade ? c.crossfade : 0; // loop blend: two players take turns
      var ps = [Player(src, from, c.loop && !xf)];
      if (xf) ps.push(Player(src, from, false));
      clips[name] = { name: name, c: c, ps: ps, turn: 0, xf: xf, foot: c.foot || M.foot || [0.5, 0.932], miner: c.miner || M.miner || 0.85, lamp: c.lamp || null, bit: c.bit || null };
      return clips[name];
    }

    var blocked = false;
    function play(P) {
      P.primed = false;
      var p = P.v.play();
      if (p && p.catch) p.catch(function () { // autoplay blocked: retry on the first tap (the frame on screen stays)
        if (blocked) return; blocked = true;
        window.addEventListener('pointerdown', function () { blocked = false; if (cur) cur.p.v.play().catch(function () {}); }, { once: true, capture: true });
      });
    }
    function show(k, P, t, len) { // put a primed player on screen, crossfading from what was there
      play(P);
      if (prev && prev.p !== P) { var old = prev.p; prev = null; prime(old); }
      if (cur) { prev = cur; fadeAt = t; fadeLen = len; }
      cur = { k: k, p: P };
    }

    var cutNext = false;
    function setState(s, cut) { if (cut && s !== want) cutNext = true; want = s; } // cut: no crossfade (the scene hides the swap)
    var FIRST = { idle: 'idle', drill: 'drillStart', cash: 'cash', bust: 'bust' };
    function stateOf(name) { return name === 'drillStart' || name === 'drillLoop' ? 'drill' : name; }

    function tick(t) {
      if (!M) return;
      // the wanted state's first clip, as soon as it is primed (until then the current one stays)
      if (!cur || stateOf(cur.k.name) !== want) {
        var k = clip(FIRST[want] || 'idle');
        if (k && !ready(k.ps[k.turn]) && want === 'drill' && clip('drillLoop') && ready(clip('drillLoop').ps[clip('drillLoop').turn])) k = clip('drillLoop');
        if (k && ready(k.ps[k.turn])) { show(k, k.ps[k.turn], t, cutNext ? 0.001 : FADE); cutNext = false; }
      }
      if (cur) {
        var c = cur.k, v = cur.p.v, d = v.duration;
        if (c.c.next && d && v.currentTime >= d - FADE) { // drillStart hands over to drillLoop
          var n = clip(c.c.next);
          if (n && ready(n.ps[n.turn])) show(n, n.ps[n.turn], t, FADE);
        } else if (c.xf && d && v.currentTime >= d - c.xf) { // loop point: the other player takes over
          var other = c.ps[1 - c.turn];
          if (ready(other)) { c.turn = 1 - c.turn; show(c, other, t, c.xf); }
          else if (v.ended) { try { v.currentTime = c.c.start || 0; } catch (e) { /* */ } v.play().catch(function () {}); }
        }
      }
      if (prev && t - fadeAt >= fadeLen) { var old = prev.p; prev = null; if (!cur || cur.p !== old) prime(old); }
    }

    // where to draw: { img, sw, sh, k (px per source px), fx, fy (boots, source px), lamp, bit, a (alpha) }
    var lastSrc = null;
    function source(hf, now) {
      var t = now / 1000;
      tick(t);
      if (cur && cur.p.v.videoWidth) {
        var v = cur.p.v, w = v.videoWidth, h = v.videoHeight, c = cur.k;
        if (v.readyState >= 2 && !v.seeking) {
          var mix = prev && prev.p.v.readyState >= 2 && !prev.p.v.seeking ? Math.min(1, (t - fadeAt) / fadeLen) : 1;
          mix = mix * mix * (3 - 2 * mix);
          if (mix < 1) keyer.key(prev.p.v, v, mix); else keyer.key(v, null, 0);
          if (!shownAt) shownAt = t;
        } // else: seeking / buffering — the last keyed frame stays on screen
        if (shownAt) {
          var lamp = pointAt(c.lamp, v.currentTime), bit = pointAt(c.bit, v.currentTime);
          lastSrc = { img: keyer.canvas, sw: w, sh: h, k: hf / (c.miner * h), fx: c.foot[0] * w, fy: c.foot[1] * h,
            lamp: lamp ? [lamp[0] * w, lamp[1] * h] : null, bit: bit ? [bit[0] * w, bit[1] * h] : null };
          return lastSrc;
        }
      }
      return lastSrc || stillSrc(hf);
    }
    function stillSrc(hf) {
      return { img: still, sw: img.naturalWidth, sh: img.naturalHeight, k: hf / STILL.h, fx: STILL.foot[0], fy: STILL.foot[1], lamp: STILL.lamp, bit: STILL.bit };
    }

    function point(s, p, footX, footY) { return p ? { x: footX + (p[0] - s.fx) * s.k, y: footY + (p[1] - s.fy) * s.k } : null; }
    function put(ctx, s, footX, footY, alpha) {
      if (!s.img) return;
      if (alpha < 1) ctx.globalAlpha = alpha;
      ctx.drawImage(s.img, footX - s.fx * s.k, footY - s.fy * s.k, s.sw * s.k, s.sh * s.k);
      if (alpha < 1) ctx.globalAlpha = 1;
    }

    // draws the miner; returns the headlamp and bit points on screen
    function draw(ctx, footX, footY, hf, now) {
      var s = source(hf, now);
      var pk = shownAt ? Math.min(1, (now / 1000 - shownAt) / POSTER_FADE) : 1;
      if (shownAt && pk < 1) put(ctx, stillSrc(hf), footX, footY, 1 - pk); // the poster dissolves into the video
      put(ctx, s, footX, footY, shownAt && pk < 1 ? pk : 1);
      return { lamp: point(s, s.lamp, footX, footY) || { x: footX, y: footY - hf * 0.95 }, bit: point(s, s.bit, footX, footY) || { x: footX, y: footY } };
    }

    return {
      loaded: loaded, preload: preload, setState: setState, draw: draw,
      video: function () { return !!shownAt; }, // a clip moves by itself
    };
  }

  window.MinerLayer = { create: create };
})();
