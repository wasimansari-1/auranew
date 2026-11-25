/* Balloon — NEXORNG individual game (each player plays their own round). Game logic:
 * ../_core/solo-client.js; this file is the look: a hot-air balloon rising from one of three
 * landscapes into the sky — clouds, a plane, a comet, a satellite, a UFO and a car in orbit as
 * the multiplier climbs, then stars — until the player cashes out (sun rays, the balloon sails
 * away) or it pops. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXSolo.start({ event: '88.0019', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- assets
  var LOCATIONS = [ // landscape picture: its top (sky) colour and the ground colour below it
    { src: 'assets/location1.webp', top: [229, 194, 118], ground: '#210530' },
    { src: 'assets/location2.webp', top: [243, 214, 144], ground: '#012535' },
    { src: 'assets/location3.webp', top: [244, 213, 144], ground: '#34143f' },
  ];
  var LOC = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  var img = {};
  var assetsReady = false;

  function loadImage(src) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }
  var NAMES = { location: LOC.src, balloon: 'assets/balloon.webp', clouds: 'assets/clouds.webp', stars: 'assets/stars.webp', plane: 'assets/plane.webp', trail: 'assets/trail.webp', comet: 'assets/comet.webp', satellite: 'assets/satellite.webp', ufo: 'assets/ufo.webp', tesla: 'assets/tesla.webp' };
  Promise.all(Object.keys(NAMES).map(function (k) { return loadImage(NAMES[k]).then(function (im) { img[k] = im; }); }))
    .then(function () { assetsReady = true; maybeReady(); });

  var announced = false;
  function maybeReady() {
    if (announced || !assetsReady) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 10000); // never hang the loader

  // ---------------------------------------------------------------- sound
  var soundOn = true;
  try { soundOn = localStorage.getItem('balloon-sound') !== 'off'; } catch (e) { /* default on */ }
  var sounds = {};
  ['start', 'win', 'lose', 'tick', 'heat'].forEach(function (n) {
    var a = new Audio('assets/sounds/' + n + '.mp3');
    a.preload = 'auto';
    if (n === 'heat') { a.loop = true; a.volume = 0.6; }
    sounds[n] = a;
  });
  function play(n) {
    if (!soundOn || !sounds[n]) return;
    try { sounds[n].currentTime = 0; var p = sounds[n].play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* blocked */ }
  }
  function stop(n) { try { sounds[n].pause(); } catch (e) { /* ignore */ } }

  // Background music: its own on/off (saved). Starts as the game opens (the tap that opened the
  // game allows it); where a browser still blocks it, it starts on the first tap in the game.
  var musicOn = true;
  try { musicOn = localStorage.getItem('balloon-music') !== 'off'; } catch (e) { /* default on */ }
  var music = null, tapped = true;
  function syncMusic() {
    if (musicOn && tapped) {
      if (!music) { music = new Audio('assets/sounds/bg_music.mp3'); music.loop = true; music.volume = 0.3; }
      var p = music.play();
      if (p && p.catch) p.catch(function () { tapped = false; }); // blocked: wait for a tap
    } else if (music) music.pause();
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  window.addEventListener('pointerdown', function () { if (!tapped) { tapped = true; syncMusic(); } }, true);
  document.addEventListener('visibilitychange', function () {
    if (!music) return;
    if (document.hidden) music.pause(); else syncMusic();
  });
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('balloon-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (!on) stop('heat'); else if (scene.started && S.phase === 'running') play('heat');
  }

  // ---------------------------------------------------------------- round moments
  // started: the multiplier is climbing (after the short start pause); endAt: pop / cash-out time
  var scene = { started: false, endAt: 0, endKind: '', endFrom: null, alt: 0, wind: 0, lastT: 0, objects: [], spawned: {}, arriveAt: 0 };
  function onSignal(name, d) {
    if (name === 'start') { scene.started = true; play('heat'); }
    if (name === 'win') { endRound('win'); play('win'); toast(d.text, 'win'); }
    if (name === 'bust') { endRound('bust'); play('lose'); }
    if (name === 'error') toast(d.text, 'error');
  }
  function endRound(kind) {
    var now = performance.now();
    scene.endFrom = balloonPos(now);
    scene.endAt = now;
    scene.endKind = kind;
    scene.started = false;
    stop('heat');
  }

  var toastTimer;
  function toast(text, kind) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- DOM render
  var tab = 'all', lastPhase = 'idle';
  function render() {
    if (S.phase === 'idle' && lastPhase !== 'idle') { // a new balloon floats in for the next round
      scene.arriveAt = performance.now();
      scene.endAt = 0; scene.endKind = ''; scene.objects = []; scene.spawned = {};
    }
    if (S.phase === 'running' && lastPhase !== 'running') { scene.objects = []; scene.spawned = {}; scene.endAt = 0; scene.endKind = ''; play('start'); }
    lastPhase = S.phase;

    $('conn').hidden = S.connected || S.demo;
    $('balance').textContent = S.balance == null ? '—' : game.money(S.balance);
    $('mode').textContent = S.demo ? 'Demo balance' : 'Balance';

    var h = $('history');
    h.innerHTML = '';
    if (!S.history.length) {
      var e = document.createElement('span');
      e.className = 'history__empty';
      e.textContent = 'Your results show here';
      h.appendChild(e);
    }
    S.history.forEach(function (r) {
      var c = document.createElement('span');
      c.className = 'chip' + (r.busted ? ' chip--bust' : '');
      c.textContent = r.x.toFixed(2) + 'x';
      h.appendChild(c);
    });

    updateButton();
    renderList();

    $('fState').textContent = S.seed ? 'last round revealed' : S.roundHash ? 'round hash ready' : 'your next round';
    $('fHash').textContent = S.roundHash || '—';
    $('fSeed').textContent = S.seed || 'revealed when your round ends';
  }

  function readAmount() {
    var v = Number(String($('amount').value).replace(',', '.'));
    return isFinite(v) && v > 0 ? game.round2(v) : 0;
  }
  function readAuto() {
    if (!$('autoOn').checked) return 0;
    var v = Number(String($('autoAt').value).replace(',', '.'));
    return isFinite(v) && v >= 1.01 ? Math.round(v * 100) / 100 : 0;
  }

  // The button is built once; only its texts / class change (and only when they differ), so
  // a tap never lands on an element that is being replaced.
  var myAmount = 0;
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function updateButton() {
    var btn = $('action'), cls = 'action', label = 'Bet', sub = game.money(readAmount()), disabled = false;
    if (S.phase === 'starting') {
      cls = 'action action--waiting'; label = 'Placing bet…'; sub = ''; disabled = true;
    } else if (S.phase === 'running' && !scene.started) {
      cls = 'action action--waiting'; label = 'Heating up…'; sub = game.money(myAmount); disabled = true;
    } else if (S.phase === 'running') {
      cls = 'action action--cashout'; label = 'Cash Out'; sub = game.money(game.round2(myAmount * game.currentMult()));
    }
    if (btn.className !== cls) btn.className = cls;
    if (btn.disabled !== disabled) btn.disabled = disabled;
    setText($('actionLabel'), label);
    setText($('actionSub'), sub);
  }

  function initials(name) { return (String(name).replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase(); }
  function avatar(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    var a = document.createElement('i');
    a.className = 'avatar';
    a.style.background = 'hsl(' + (h % 360) + ', 62%, 48%)';
    a.textContent = initials(name);
    return a;
  }
  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }

  function renderList() {
    var list = $('list');
    list.innerHTML = '';
    if (tab === 'all') {
      $('countLabel').textContent = 'All bets';
      $('betCount').textContent = S.bets.length;
      $('cols').innerHTML = '<span>Player</span><span>Bet</span><span>X</span><span>Win</span>';
      if (!S.bets.length) list.appendChild(cell('No rounds yet.', 'empty'));
      S.bets.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.done ? (b.x ? ' row--won' : ' row--lost') : '') + (b.mine ? ' row--mine' : '');
        var user = document.createElement('span');
        user.className = 'row__user';
        user.appendChild(avatar(b.player));
        user.appendChild(cell(b.mine ? 'You' : b.player));
        row.appendChild(user);
        row.appendChild(cell(Number(b.amount).toFixed(2)));
        row.appendChild(cell(b.done ? (b.x ? Number(b.x).toFixed(2) + 'x' : '✕') : '…', 'row__x'));
        row.appendChild(cell(b.win ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      $('countLabel').textContent = 'My bets';
      $('betCount').textContent = S.myBets.length;
      $('cols').innerHTML = '<span>Time</span><span>Bet</span><span>X</span><span>Win</span>';
      if (!S.myBets.length) list.appendChild(cell('Your rounds this visit show here.', 'empty'));
      S.myBets.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--won' : ' row--lost');
        row.appendChild(cell(new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
        row.appendChild(cell(Number(b.amount).toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '✕', 'row__x'));
        row.appendChild(cell(b.win ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    }
  }

  // ---------------------------------------------------------------- scene (canvas)
  var canvas = $('scene');
  var ctx = canvas.getContext('2d');
  var stageEl = document.querySelector('.stage');
  var W = 0, H = 0;
  // The scene fills the whole stage (under the floating bar, behind the results row and, on
  // wide screens, behind the bets list); the balloon is placed in the play area (LEFT/TOP/W/H).
  var TOP = 0, FULL_H = 0, LEFT = 0, FULL_W = 0;

  function fit() {
    var r = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    FULL_W = r.width; FULL_H = r.height;
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    W = FULL_W - LEFT;
    stageEl.style.setProperty('--left', LEFT + 'px');
    var bar = document.querySelector('.top').getBoundingClientRect();
    TOP = Math.max(0, bar.bottom - r.top + 6);
    // the play area ends just above the results row (it floats over the scene's bottom)
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(140, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // the multiplier / round texts are centred on the play area (not the whole scene)
    var centre = document.querySelector('.stage__center').style;
    centre.left = LEFT + 'px'; centre.top = TOP + 'px'; centre.width = W + 'px'; centre.height = H + 'px';
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a round is added to it).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
  }

  function ease(t) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); }
  function easeIn(t) { t = Math.min(1, Math.max(0, t)); return t * t; }
  function mix(a, b, k) { return Math.round(a + (b - a) * k); }

  // Balloon geometry, measured from the picture (fractions of its height; 421×600):
  // the envelope's widest point (the multiplier sits there) and the burner mouth.
  var BAL_RATIO = 421 / 600, ENV_CY = 0.325, MOUTH_Y = 0.737;

  function balloonSize() { return Math.min(H * 0.56, W * 0.6 / BAL_RATIO); }
  // centre of the envelope sits on the centre of the play area; gentle sway while flying
  function balloonPos(now) {
    var bh = balloonSize(), bw = bh * BAL_RATIO;
    var x = W / 2, y = H / 2 - ENV_CY * bh;
    var sway = S.phase === 'running' || S.phase === 'starting' ? 1 : 0.4;
    return { x: x - bw / 2 + Math.sin(now / 900) * W * 0.008 * sway, y: y + Math.sin(now / 620) * H * 0.008 * sway, w: bw, h: bh, r: Math.sin(now / 1100) * 0.025 * sway };
  }

  // ---- the world: the camera climbs with the multiplier --------------------------------
  // Heights are in "screens" above the landscape's top edge. Sky: the landscape's own sky at
  // the bottom → day blue → deep blue → night.
  function skyStops() {
    return [[0, LOC.top], [0.5, [150, 206, 218]], [1.3, [44, 168, 227]], [3, [28, 111, 178]], [6, [16, 58, 124]], [10, [9, 22, 64]]];
  }
  function skyAt(h) { // h: height above the landscape top, in play-area heights
    var st = skyStops();
    if (h <= st[0][0]) return st[0][1];
    for (var i = 1; i < st.length; i++) {
      if (h <= st[i][0]) { var k = (h - st[i - 1][0]) / (st[i][0] - st[i - 1][0]); var a = st[i - 1][1], b = st[i][1]; return [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)]; }
    }
    return st[st.length - 1][1];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  function climbTarget() { // camera height in play-area heights
    var m = S.phase === 'running' ? game.currentMult() : S.phase === 'busted' || S.phase === 'cashed' ? S.mult : 1;
    return Math.log(Math.max(1, m)) * 1.7;
  }

  function locationGeom() {
    var im = img.location, s = im ? Math.max(FULL_W / im.width, (H * 0.8) / im.height) : 1;
    var lw = im ? im.width * s : FULL_W, lh = im ? im.height * s : H;
    return { s: s, w: lw, h: lh, top: H * 0.26 + scene.alt * H }; // y of the picture's top (play coords)
  }

  function drawWorld(now, dt) {
    var target = climbTarget();
    scene.alt += (target - scene.alt) * Math.min(1, dt / (S.phase === 'idle' ? 600 : 260));
    if (S.phase === 'running' && scene.started) scene.wind += dt * 0.012;
    var g = locationGeom();
    var x0 = -LEFT, y0 = -TOP;
    // sky: each screen row gets the colour of its height above the landscape's top edge, so the
    // sky meets the picture's own sky colour exactly there (no seam)
    var hTop = (g.top - y0) / H;
    var grad = ctx.createLinearGradient(0, y0, 0, y0 + FULL_H);
    for (var i = 0; i <= 12; i++) {
      var k = i / 12, yy = y0 + FULL_H * k;
      grad.addColorStop(k, rgb(skyAt(Math.max(0, (g.top - yy) / H))));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, FULL_W, FULL_H);
    // stars, high up
    var night = Math.max(0, Math.min(1, (hTop - 4.5) / 3));
    if (night > 0 && img.stars) {
      ctx.globalAlpha = night * (0.85 + 0.15 * Math.sin(now / 700));
      var sw = Math.max(FULL_W, img.stars.width), sh = img.stars.height * (sw / img.stars.width);
      for (var sy = y0 - ((scene.alt * H * 0.2) % sh); sy < y0 + FULL_H; sy += sh) ctx.drawImage(img.stars, x0, sy, sw, sh);
      ctx.globalAlpha = 1;
    }
    // clouds: two bands at fixed heights in the sky, drifting with the wind
    if (img.clouds) {
      var cw = FULL_W * 1.3, ch = img.clouds.height * (cw / img.clouds.width);
      [[0.55, 1, 0.9], [1.6, 1.15, 0.8], [2.8, 0.9, 0.6]].forEach(function (band, bi) {
        var y = g.top - band[0] * H - ch / 2;
        if (y > y0 + FULL_H || y + ch < y0) return;
        var off = ((scene.wind * band[1] + bi * 300) % cw + cw) % cw;
        ctx.globalAlpha = band[2] * Math.max(0, 1 - night);
        for (var cx = x0 - off; cx < x0 + FULL_W; cx += cw) ctx.drawImage(img.clouds, cx, y, cw, ch);
      });
      ctx.globalAlpha = 1;
    }
    // the landscape and the ground below it
    if (g.top < y0 + FULL_H) {
      if (img.location) ctx.drawImage(img.location, x0 + (FULL_W - g.w) / 2, g.top, g.w, g.h);
      // soft blend over the picture's top edge into the sky
      var fh = g.h * 0.07, fade = ctx.createLinearGradient(0, g.top - 1, 0, g.top + fh);
      fade.addColorStop(0, rgb(LOC.top));
      fade.addColorStop(1, 'rgba(' + LOC.top.join(',') + ',0)');
      ctx.fillStyle = fade;
      ctx.fillRect(x0, g.top - 1, FULL_W, fh + 1);
      ctx.fillStyle = LOC.ground;
      ctx.fillRect(x0, g.top + g.h - 1, FULL_W, Math.max(0, y0 + FULL_H - (g.top + g.h - 1)));
    }
    drawObjects(now);
    theme(hTop);
  }

  // Things passing by on the way up (as in the original): a plane at 1.4x, a comet at 2.4x,
  // a satellite at 5x, a UFO at 7.5x and a car in orbit at 10.8x.
  var OBJECTS = [
    { at: 1.4, kind: 'plane', ms: 5200 },
    { at: 2.4, kind: 'comet', ms: 1800 },
    { at: 5, kind: 'satellite', ms: 7000 },
    { at: 7.5, kind: 'ufo', ms: 5200 },
    { at: 10.8, kind: 'tesla', ms: 6500 },
  ];
  function spawnObjects(now) {
    if (S.phase !== 'running' || !scene.started) return;
    var m = game.currentMult();
    OBJECTS.forEach(function (o) {
      if (m >= o.at && !scene.spawned[o.kind]) {
        scene.spawned[o.kind] = true;
        scene.objects.push({ kind: o.kind, at: now, ms: o.ms, ltr: Math.random() < 0.5, y: 0.12 + Math.random() * 0.28 });
      }
    });
  }
  function drawObjects(now) {
    spawnObjects(now);
    scene.objects = scene.objects.filter(function (o) { return now - o.at < o.ms; });
    scene.objects.forEach(function (o) {
      var k = (now - o.at) / o.ms, im = img[o.kind];
      if (!im) return;
      var dir = o.ltr ? 1 : -1, span = FULL_W + 400;
      var x = o.ltr ? -LEFT - 200 + span * k : -LEFT + FULL_W + 200 - span * k;
      var y = H * o.y;
      ctx.save();
      if (o.kind === 'plane') {
        var ph = H * 0.07, pw = ph * (300 / 180);
        if (img.trail) { // the trail behind the plane
          var tw = pw * 4, th = tw * (140 / 1377);
          ctx.save(); ctx.translate(x, y + ph * 0.55); ctx.scale(dir, 1); ctx.globalAlpha = 0.8;
          ctx.drawImage(img.trail, -tw - pw * 0.35, -th / 2, tw, th); ctx.restore();
        }
        ctx.translate(x, y + ph / 2); ctx.scale(-dir, 1); // the picture faces left
        var frame = Math.floor(now / 70) % 2; // two propeller frames side by side
        ctx.drawImage(im, frame * 300, 0, 300, 180, -pw / 2, -ph / 2, pw, ph);
      } else if (o.kind === 'comet') {
        var cw = H * 0.16, ch = cw * (686 / 408);
        var cx = W * (o.ltr ? 0.85 : 0.15) - (o.ltr ? 1 : -1) * W * 0.5 * k, cy = -H * 0.2 + H * 0.9 * k;
        ctx.globalAlpha = Math.min(1, (1 - k) * 3);
        ctx.translate(cx, cy); ctx.scale(o.ltr ? 1 : -1, 1);
        ctx.drawImage(im, -cw / 2, -ch / 2, cw, ch);
      } else {
        var oh = H * (o.kind === 'satellite' ? 0.09 : 0.08), ow = oh * (im.width / im.height);
        var bob = o.kind === 'ufo' ? Math.sin(now / 260) * H * 0.02 : Math.sin(now / 900) * H * 0.008;
        ctx.translate(x, y + bob);
        if (o.kind === 'tesla') ctx.rotate(Math.sin(now / 700) * 0.15 + k * 0.6);
        if (o.kind === 'satellite') ctx.rotate(k * 0.5);
        ctx.scale(o.kind === 'tesla' ? dir : 1, 1);
        ctx.drawImage(im, -ow / 2, -oh / 2, ow, oh);
      }
      ctx.restore();
    });
  }

  // ---- the balloon ----------------------------------------------------------------------
  function drawFlame(b, now, power) {
    var fx = b.x + b.w / 2, fy = b.y + MOUTH_Y * b.h, fs = b.h * 0.09 * power * (0.85 + 0.15 * Math.sin(now / 45) + 0.08 * Math.sin(now / 17));
    var glow = ctx.createRadialGradient(fx, fy - fs * 0.6, 1, fx, fy - fs * 0.6, fs * 2.6);
    glow.addColorStop(0, 'rgba(255, 220, 120, 0.55)');
    glow.addColorStop(1, 'rgba(255, 140, 40, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(fx - fs * 3, fy - fs * 3.4, fs * 6, fs * 5);
    ctx.beginPath(); // the flame: a teardrop pointing up into the envelope
    ctx.moveTo(fx, fy - fs * 1.6);
    ctx.bezierCurveTo(fx + fs * 0.55, fy - fs * 0.6, fx + fs * 0.45, fy + fs * 0.2, fx, fy + fs * 0.25);
    ctx.bezierCurveTo(fx - fs * 0.45, fy + fs * 0.2, fx - fs * 0.55, fy - fs * 0.6, fx, fy - fs * 1.6);
    var fl = ctx.createLinearGradient(0, fy - fs * 1.6, 0, fy + fs * 0.25);
    fl.addColorStop(0, 'rgba(255, 245, 200, 0.95)');
    fl.addColorStop(0.5, 'rgba(255, 190, 60, 0.95)');
    fl.addColorStop(1, 'rgba(255, 90, 30, 0.9)');
    ctx.fillStyle = fl;
    ctx.fill();
  }

  function drawBalloonAt(b, alpha) {
    if (!img.balloon) return;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(b.x + b.w / 2, b.y + b.h);
    ctx.rotate(b.r || 0);
    ctx.drawImage(img.balloon, -b.w / 2, -b.h, b.w, b.h);
    ctx.restore();
  }

  function drawRays(now, k) { // sun rays behind the balloon when the player cashes out
    var cx = W / 2, cy = H / 2, R = Math.max(W, H) * 0.9;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 3) * (1 - Math.max(0, (k - 0.7) / 0.3)) * 0.55;
    ctx.translate(cx, cy);
    ctx.rotate(now / 3000);
    for (var i = 0; i < 18; i++) {
      ctx.rotate(Math.PI / 9);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(R, -R * 0.09);
      ctx.lineTo(R, R * 0.09);
      ctx.closePath();
      var g = ctx.createLinearGradient(0, 0, R, 0);
      g.addColorStop(0, 'rgba(255, 245, 190, 0.9)');
      g.addColorStop(1, 'rgba(255, 245, 190, 0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  var shards = [];
  function drawBalloon(now) {
    var b = balloonPos(now);
    var t = now - scene.endAt;
    if (scene.endKind === 'win') { // rays, and the balloon sails away up
      drawRays(now, t / 2200);
      var k = easeIn(t / 1400), f = scene.endFrom;
      drawBalloonAt({ x: f.x, y: f.y - (H + f.h) * k, w: f.w, h: f.h, r: f.r }, 1);
      return;
    }
    if (scene.endKind === 'bust') { // it pops: pieces fly out, the basket drops
      var f2 = scene.endFrom, q = Math.min(1, t / 1100);
      if (t < 120) drawBalloonAt({ x: f2.x - f2.w * 0.06 * (t / 120), y: f2.y - f2.h * 0.04 * (t / 120), w: f2.w * (1 + 0.12 * t / 120), h: f2.h * (1 + 0.08 * t / 120), r: f2.r }, 1);
      if (!shards.length || shards.at !== scene.endAt) {
        shards = [];
        shards.at = scene.endAt;
        for (var i = 0; i < 30; i++) {
          var a = Math.random() * Math.PI * 2;
          shards.push({ a: a, sp: 0.35 + Math.random() * 0.75, s: 0.05 + Math.random() * 0.07, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 10, c: ['#e8246f', '#ff5f9a', '#b3124f', '#ffd1e2'][i % 4] });
        }
      }
      var cx = f2.x + f2.w / 2, cy = f2.y + ENV_CY * f2.h;
      if (t < 380) { // the pop: a bright flash ring
        var fk = t / 380, fr = f2.h * (0.25 + 0.75 * ease(fk));
        var fg = ctx.createRadialGradient(cx, cy, fr * 0.2, cx, cy, fr);
        fg.addColorStop(0, 'rgba(255, 255, 255, ' + (0.85 * (1 - fk)) + ')');
        fg.addColorStop(0.6, 'rgba(255, 150, 200, ' + (0.5 * (1 - fk)) + ')');
        fg.addColorStop(1, 'rgba(255, 120, 180, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(cx, cy, fr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, ' + (1 - fk) + ')';
        ctx.lineWidth = Math.max(2, f2.h * 0.012);
        ctx.beginPath(); ctx.arc(cx, cy, fr * 0.9, 0, Math.PI * 2); ctx.stroke();
      }
      if (t >= 60) {
        shards.forEach(function (s) { // pieces of the envelope fly out and flutter down
          var d = s.sp * f2.h * ease(q), x = cx + Math.cos(s.a) * d, y = cy + Math.sin(s.a) * d + q * q * f2.h * 0.6;
          ctx.save(); ctx.globalAlpha = Math.max(0, 1 - q * 1.1); ctx.translate(x, y); ctx.rotate(s.rot + q * s.spin);
          ctx.fillStyle = s.c;
          ctx.beginPath();
          ctx.moveTo(-s.s * f2.h * 0.5, 0); ctx.lineTo(0, -s.s * f2.h * 0.35); ctx.lineTo(s.s * f2.h * 0.5, s.s * f2.h * 0.1); ctx.lineTo(0, s.s * f2.h * 0.4);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        });
        // the basket (with its ropes) drops away
        var fall = easeIn(t / 1000) * H * 1.1, bx = f2.x + f2.w / 2, by = f2.y + 0.74 * f2.h + fall;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t / 1200);
        ctx.translate(bx, by); ctx.rotate(Math.sin(t / 120) * 0.12);
        ctx.drawImage(img.balloon, img.balloon.width * 0.36, img.balloon.height * 0.74, img.balloon.width * 0.28, img.balloon.height * 0.26, -f2.w * 0.14, 0, f2.w * 0.28, f2.h * 0.26);
        ctx.restore();
      }
      return;
    }
    // a new balloon floats up into place for the next round
    var arrive = scene.arriveAt ? ease((now - scene.arriveAt) / 900) : 1;
    if (arrive < 1) b.y += (1 - arrive) * H * 0.7;
    if (S.phase === 'running' || S.phase === 'starting') drawFlame(b, now, scene.started ? 1 : 0.55);
    drawBalloonAt(b, arrive < 1 ? arrive : 1);
  }

  // ---- browser bar colour: the sky at the top of the screen (sent at most every 0.4 s) ----
  var themeAt = 0;
  function theme(hTop) {
    var now = performance.now();
    if (now - themeAt < 400) return;
    themeAt = now;
    var c = skyAt(Math.max(0, hTop));
    game.theme('#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''));
  }

  function frame(now) {
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    if (W && H) {
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      ctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
      drawWorld(now, dt);
      drawBalloon(now);
      ctx.restore();
    }
    // texts on the balloon (centre of the play area)
    var mult = $('mult'), hint = $('hint');
    if (S.phase === 'running' && scene.started) {
      setText(mult, game.currentMult().toFixed(2) + 'x'); mult.className = 'mult'; setText(hint, '');
      updateButton(); // live cash-out amount
    } else if (S.phase === 'running' || S.phase === 'starting') {
      setText(mult, '1.00x'); mult.className = 'mult'; setText(hint, '');
    } else if (S.phase === 'cashed') {
      setText(mult, S.mult.toFixed(2) + 'x'); mult.className = 'mult mult--win'; setText(hint, '');
    } else if (S.phase === 'busted') {
      setText(mult, S.mult.toFixed(2) + 'x'); mult.className = 'mult mult--bust'; setText(hint, S.crashPhrase);
    } else {
      setText(mult, ''); mult.className = 'mult'; setText(hint, S.bettingPhrase);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- controls
  function setAmount(v) {
    var l = game.limit();
    v = Math.max(l.min, game.round2(v));
    if (l.max) v = Math.min(l.max, v);
    $('amount').value = v.toFixed(2);
    updateButton();
  }
  function buildQuick() { // 1×, 2×, 5×, 10× the min bet (within the max)
    var l = game.limit(), q = $('quick');
    q.innerHTML = '';
    [1, 2, 5, 10].forEach(function (k) {
      var v = game.round2(l.min * k);
      if (l.max && v > l.max) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = game.money(v).replace(/\.00$/, '');
      b.onclick = function () { setAmount(v); };
      q.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { buildQuick(); setAmount(l.min); });

  $('minus').onclick = function () { setAmount(readAmount() - game.limit().min); };
  $('plus').onclick = function () { setAmount(readAmount() + game.limit().min); };
  $('amount').oninput = updateButton;
  $('amount').onblur = function () { setAmount(readAmount() || game.limit().min); };
  $('action').onclick = function () {
    if (S.phase === 'running') { if (scene.started) game.cashOut(); return; }
    if (S.phase === 'starting') return;
    myAmount = readAmount();
    scene.arriveAt = 0;
    game.play(myAmount, readAuto());
  };
  $('back').onclick = function () { game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem('balloon-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncMusic();
  };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      renderList();
    };
  });

  setSound(soundOn);
  // The music (a big file) starts once the game is on screen, so it never slows the loading.
  window.addEventListener('nexorng:ready', syncMusic, { once: true });
  window.addEventListener('resize', fit);
  // The results row fills in after load (and the bets list / bar can change size): refit.
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top', '.stage'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
