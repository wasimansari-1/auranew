/* Sindbad — NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is the look:
 * the ship at rest with the spinning wheel while bets are open, the voyage over the scrolling
 * sea (day → sunset → starry night as the multiplier climbs), and the sea dragon that ends
 * the round with a blast of fire. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0007', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- assets
  var SHEETS = ['shipIdle', 'shipMove', 'shipShock', 'shipBurn', 'shipBurnIdle', 'dragon', 'dragonIdle', 'fire', 'dolphin'];
  var SEA_FRAMES = 10;
  var sheets = {}, sea = [], wheel = null;
  var assetsReady = false;

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }
  function loadSheet(name) {
    return fetch('assets/sprites/' + name + '.json').then(function (r) { return r.json(); }).then(function (meta) {
      var imgs = [];
      for (var i = 0; i < meta.sheets; i++) imgs.push(loadImage('assets/sprites/' + name + '-' + i + '.webp'));
      return Promise.all(imgs).then(function (list) { sheets[name] = { meta: meta, imgs: list }; });
    });
  }
  var seaLoads = [];
  for (var si0 = 0; si0 < SEA_FRAMES; si0++) {
    (function (i) { seaLoads.push(loadImage('assets/sea/sea-' + i + '.webp').then(function (img) { sea[i] = img; })); })(si0);
  }
  Promise.all(SHEETS.map(loadSheet).concat(seaLoads, loadImage('assets/wheel.webp').then(function (img) { wheel = img; })))
    .catch(function () {})
    .then(function () { assetsReady = true; maybeReady(); });

  var announced = false;
  function maybeReady() {
    if (announced || !assetsReady || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 10000); // never hang the loader

  // ---------------------------------------------------------------- sound
  var soundOn = true;
  try { soundOn = localStorage.getItem('sindbad-sound') !== 'off'; } catch (e) { /* default on */ }
  var sounds = {};
  ['click', 'cashout', 'boat', 'dragonRoar', 'fire-spell', 'thudSound'].forEach(function (n) {
    var a = new Audio('assets/sounds/' + n + '.mp3');
    a.preload = n === 'boat' ? 'none' : 'auto';
    if (n === 'boat') { a.loop = true; a.volume = 0.45; }
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
  try { musicOn = localStorage.getItem('sindbad-music') !== 'off'; } catch (e) { /* default on */ }
  var music = null, tapped = true;
  function syncMusic() {
    if (musicOn && tapped) {
      if (!music) { music = new Audio('assets/sounds/bgMusic.mp3'); music.loop = true; music.volume = 0.3; }
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
    try { localStorage.setItem('sindbad-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (!on) stop('boat'); else if (S.phase === 'flying') play('boat');
  }

  // ---------------------------------------------------------------- engine moments
  var scene = { startAt: 0, crashAt: 0, seaX: 0, lastT: 0, alt: 0, dolphinAt: 0, dolphinX: 0.6, crashTimers: [] };
  function onSignal(name, d) {
    if (name === 'start') { scene.startAt = performance.now(); scene.dolphinAt = performance.now() + 2500 + Math.random() * 3000; play('boat'); }
    if (name === 'crash') {
      scene.crashAt = performance.now();
      stop('boat');
      play('dragonRoar');
      scene.crashTimers.forEach(clearTimeout);
      scene.crashTimers = [
        setTimeout(function () { play('fire-spell'); }, FIRE_AT),
        setTimeout(function () { play('thudSound'); }, BURN_AT),
      ];
    }
    if (name === 'betting') { scene.startAt = 0; scene.crashAt = 0; }
    if (name === 'win') { play('cashout'); toast(d.text, 'win'); }
    if (name === 'error') toast(d.text, 'error');
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
  var tab = 'all';
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  var historyKey = '';
  // Players in this round, on the scene (../_core/players.js), with this game's avatar faces.
  var playersStrip;
  function playerFace(name) {
    var av = document.createElement('i'), k = avatarIndex(name), cell = 28;
    av.className = 'avatar';
    av.style.backgroundSize = (8 * cell) + 'px ' + (2 * cell) + 'px';
    av.style.backgroundPosition = (-(k % 8) * cell) + 'px ' + (-Math.floor(k / 8) * cell) + 'px';
    return av;
  }

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: playerFace });
    playersStrip.update(S);
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot;
    setText($('balance'), S.balance == null ? '—' : game.money(S.balance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    var key = S.history.join(',');
    if (key !== historyKey) { // the chips are rebuilt only when the results change
      historyKey = key;
      var h = $('history');
      h.innerHTML = '';
      S.history.forEach(function (c) {
        var s = document.createElement('span');
        s.className = 'chip' + (c >= 10 ? ' chip--big' : c >= 2 ? ' chip--mid' : '');
        s.textContent = c.toFixed(2) + 'x';
        h.appendChild(s);
      });
    }

    updateButtons();
    renderList();

    setText($('fRound'), String(S.round || '—'));
    setText($('fHash'), S.hash || '—');
    setText($('fSeed'), S.seed || 'revealed when the round ends');
  }

  // ---- bet panels (slot 0 and 1) ----------------------------------------------------
  // Everything a player taps is built once; later updates only change class / text.
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="panel__inner">' +
      '<div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<input class="amount" inputmode="decimal" value="1.00" aria-label="Bet amount">' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="minmax"><button type="button" class="min">MIN</button><button type="button" class="max">MAX</button>' +
      '</div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<button type="button" class="action"><span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      '<div class="auto"><span>Auto Cash Out</span>' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label>' +
      '<input class="auto__x" inputmode="decimal" value="1.10" aria-label="Auto cash-out multiplier"></div>' +
      '</div>';
    $('panels').appendChild(el);
    var q = function (sel) { return el.querySelector(sel); };
    return {
      slot: slot, el: el, amount: q('.amount'), action: q('.action'), label: q('.action__label'), sub: q('.action__sub'),
      autoOn: q('.auto__on'), autoAt: q('.auto__x'), quick: q('.quick'), min: q('.min'), max: q('.max'),
    };
  });

  // Phone: one bet panel only (owner's choice); wide screens show both.

  function readAmount(p) {
    var v = Number(String(p.amount.value).replace(',', '.'));
    return isFinite(v) && v > 0 ? game.round2(v) : 0;
  }
  function readAuto(p) {
    if (!p.autoOn.checked) return 0;
    var v = Number(String(p.autoAt.value).replace(',', '.'));
    return isFinite(v) && v >= 1.01 ? Math.round(v * 100) / 100 : 0;
  }

  function updateButtons() { panels.forEach(updateButton); }
  function updateButton(p) {
    var my = S.my[p.slot], cls = 'action', label = 'Bet', sub = game.money(readAmount(p)), disabled = false;
    var mine = my && my.round === S.round;
    if (S.queued[p.slot]) {
      cls = 'action action--cancel'; label = 'Cancel'; sub = 'Waiting for next round';
    } else if (mine && my.status === 'pending') {
      cls = 'action action--waiting'; label = 'Placing bet…'; sub = ''; disabled = true;
    } else if (mine && my.status === 'placed' && S.phase === 'betting') {
      cls = 'action action--waiting'; label = 'Bet placed'; sub = game.money(my.amount); disabled = true;
    } else if (mine && (my.status === 'placed' || my.status === 'cashing') && S.phase === 'flying') {
      cls = 'action action--cashout'; label = 'Cash Out'; sub = game.money(game.round2(my.amount * game.currentMult())); disabled = my.status === 'cashing';
    }
    if (p.action.className !== cls) p.action.className = cls;
    if (p.action.disabled !== disabled) p.action.disabled = disabled;
    setText(p.label, label);
    setText(p.sub, sub);
  }

  function avatarIndex(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 15;
  }

  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }

  function renderList() { // read-only rows (nothing here is tapped)
    var list = $('list');
    list.innerHTML = '';
    if (tab === 'all') {
      setText($('countLabel'), 'Total bets');
      setText($('betCount'), String(S.bets.length));
      setText($('cols'), '');
      ['User', 'Bet', 'X', 'Cash out'].forEach(function (t) { $('cols').appendChild(cell(t)); });
      if (!S.bets.length) list.appendChild(cell('No bets yet this round.', 'empty'));
      S.bets.slice().reverse().forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--cashed' : '') + (b.mine ? ' row--mine' : '');
        var user = document.createElement('span');
        user.className = 'row__user';
        var av = document.createElement('i');
        av.className = 'avatar';
        var k = avatarIndex(b.player);
        av.style.backgroundPosition = (-(k % 8) * 32) + 'px ' + (-Math.floor(k / 8) * 32) + 'px';
        user.appendChild(av);
        user.appendChild(cell(b.player));
        row.appendChild(user);
        row.appendChild(cell(Number(b.amount).toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '-', 'row__x'));
        row.appendChild(cell(b.win ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      setText($('countLabel'), 'My bets');
      setText($('betCount'), String(S.myBets.length));
      setText($('cols'), '');
      ['Time', 'Bet', 'X', 'Cash out'].forEach(function (t) { $('cols').appendChild(cell(t)); });
      if (!S.myBets.length) list.appendChild(cell('Your bets this visit show here.', 'empty'));
      S.myBets.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--cashed' : '');
        row.appendChild(cell(new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
        row.appendChild(cell(b.amount.toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '-', 'row__x'));
        row.appendChild(cell(b.win ? b.win.toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    }
  }

  // ---------------------------------------------------------------- scene (canvas)
  var canvas = $('scene');
  var stageEl = document.querySelector('.stage');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0;
  // The scene fills the whole stage (under the floating top bar); the ship, wheel and dragon
  // are placed in the play area below the bar (H tall), so they keep their place.
  var TOP = 0, FULL_H = 0;
  // Wide screens: the scene spans the whole screen, also behind the bets list; the play area
  // starts right of the list (LEFT). The world is drawn from -LEFT so it fills the full width.
  var LEFT = 0, FULL_W = 0;

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
    // The results row (phone) / results + bet panels (wide screens) float over the scene's
    // lower part: the play area ends just above the results row; below it the scene melts away.
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(120, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // The multiplier / round texts are placed on the play area (not the whole scene).
    var texts = document.querySelector('.stage__top').style;
    texts.left = LEFT + 'px'; texts.top = TOP + 'px'; texts.width = W + 'px'; texts.height = H + 'px';
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a player joins the round).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
  }

  // Draws frame i of a sprite sheet; (x, y) = top-left of the full (untrimmed) frame box.
  function sprite(name, i, x, y, scale, alpha, clamp) {
    var s = sheets[name];
    if (!s) return;
    var n = s.meta.frames.length;
    var f = s.meta.frames[clamp ? Math.max(0, Math.min(n - 1, i)) : ((i % n) + n) % n];
    var img = s.imgs[f[0]];
    if (!img) return;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(img, f[1], f[2], f[3], f[4], x + f[5] * scale, y + f[6] * scale, f[3] * scale, f[4] * scale);
    ctx.globalAlpha = 1;
  }
  function frameAt(t, fps) { return Math.floor(t / (1000 / fps)); }
  function frames(name) { return sheets[name] ? sheets[name].meta.frames.length : 1; }

  // Sprite geometry, measured from the images (frame pixels at the packed scale):
  var SHIP_W = 474, SHIP_CX = 240, SHIP_WATER = 372; // ship box 481×396: visible width, centre, hull at the water
  var SHIP_FIRE_Y = 235; // middle of the hull + sails, where the dragon's fire hits
  var DRAGON_CX = 190, DRAGON_H = 280, DRAGON_BOTTOM = 419; // dragon box 359×420 (rises out of the water)
  var FIRE_CX = 171, FIRE_CY = 98, FIRE_W = 326; // fire box 338×193
  var DOLPHIN_CX = 72, DOLPHIN_BOTTOM = 141; // dolphin box 150×143
  // crash timeline (ms after the crash): the dragon rises, breathes fire, the ship burns
  var RISE_MS = 1150, FIRE_AT = 850, BURN_AT = 1050;

  function seaLine() { return H * 0.9; } // where the ship's hull meets the water
  function shipScale() { return Math.min((W * 0.62) / SHIP_W, (H * 0.58) / 390); }
  function shipX() { return S.phase === 'flying' || S.phase === 'crashed' ? W * 0.34 : W * 0.27; }

  // ---- the voyage: the sea scrolls; the day turns to sunset and a starry night as the
  // multiplier climbs (≈1x day · 3x sunset · 10x+ night). One full-scene tint plus soft
  // vertical glows — no layer edges, so nothing shows a seam.
  var TINT = [[255, 255, 255], [255, 196, 160], [92, 104, 168]]; // multiply: day, sunset, night
  var GLOW = [ // sky glow over the top (rgba top, rgba at the horizon)
    [[0, 0, 0, 0], [0, 0, 0, 0]],
    [[118, 70, 150, 0.45], [255, 140, 70, 0.4]],
    [[6, 10, 40, 0.75], [40, 52, 120, 0.35]],
  ];
  var stars = [], birds = [];
  for (var s1 = 0; s1 < 70; s1++) stars.push({ x: Math.random(), y: Math.random() * 0.5, r: 0.6 + Math.random() * 1.3, t: Math.random() * 6 });
  for (var b1 = 0; b1 < 5; b1++) birds.push({ x: Math.random(), y: 0.12 + Math.random() * 0.25, s: 0.7 + Math.random() * 0.6, v: 0.6 + Math.random() * 0.6, p: Math.random() * 6 });

  function climb() { // 0 at the start … 1 at about 10x
    if (S.phase === 'flying') return Math.min(1, Math.log(Math.max(1, game.currentMult())) / Math.log(10));
    if (S.phase === 'crashed') return Math.min(1, Math.log(Math.max(1, S.crashPoint)) / Math.log(10));
    return 0;
  }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function stage(list, alt) { // mix between day/sunset (0–0.5) and sunset/night (0.5–1)
    var i = alt < 0.5 ? 0 : 1, k = alt < 0.5 ? alt / 0.5 : (alt - 0.5) / 0.5;
    return list[i].map(function (v, j) { return Array.isArray(v) ? v.map(function (c, n) { return lerp(c, list[i + 1][j][n], k); }) : lerp(v, list[i + 1][j], k); });
  }
  function rgba(c) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (c[3] == null ? 1 : c[3]) + ')'; }

  function drawSea(now, dt) {
    scene.alt += (climb() - scene.alt) * Math.min(1, dt / 400);
    var alt = scene.alt;
    if (S.phase === 'flying') scene.seaX += H * 0.3 * (1 + alt * 1.6) * dt / 1000;
    var img = sea[frameAt(now, 8) % SEA_FRAMES] || sea[0];
    if (!img) { ctx.fillStyle = '#3fa9d8'; ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H); return; }
    // the panorama fills the whole stage (also the strip under the bar); it is tiled with
    // every other copy mirrored, so the joins always match
    var w = img.width * (FULL_H / img.height);
    var k0 = Math.floor(scene.seaX / w);
    for (var k = k0; k * w - scene.seaX - LEFT < W; k++) {
      var x = k * w - scene.seaX - LEFT;
      if (k % 2) {
        ctx.save();
        ctx.translate(x + w, -TOP);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, w, FULL_H);
        ctx.restore();
      } else ctx.drawImage(img, x, -TOP, w, FULL_H);
    }
    var horizon = -TOP + FULL_H * 0.6;
    // birds by day
    var day = Math.max(0, 1 - alt * 2.2);
    if (day > 0 && S.phase === 'flying') {
      ctx.strokeStyle = 'rgba(30, 50, 70, ' + (0.7 * day) + ')';
      ctx.lineWidth = 1.6;
      birds.forEach(function (b) {
        var bx = ((b.x * W * 1.4 - scene.seaX * 0.5 * b.v) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * 0.2;
        var by = b.y * H, sz = 6 * b.s * (H / 360), flap = Math.sin(now / 160 + b.p) * sz * 0.5;
        ctx.beginPath();
        ctx.moveTo(bx - sz, by - flap);
        ctx.quadraticCurveTo(bx - sz * 0.4, by - sz * 0.2, bx, by);
        ctx.quadraticCurveTo(bx + sz * 0.4, by - sz * 0.2, bx + sz, by - flap);
        ctx.stroke();
      });
    }
    if (alt < 0.01) return;
    // time of day: one tint over the whole scene, then a soft glow over the sky
    var t = stage(TINT, alt);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = rgba(t);
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    ctx.restore();
    var g = stage(GLOW, alt), glowEnd = horizon + FULL_H * 0.12;
    var grad = ctx.createLinearGradient(0, -TOP, 0, glowEnd);
    grad.addColorStop(0, rgba(g[0]));
    grad.addColorStop(0.8, rgba(g[1]));
    grad.addColorStop(1, rgba([g[1][0], g[1][1], g[1][2], 0]));
    ctx.fillStyle = grad;
    ctx.fillRect(-LEFT, -TOP, FULL_W, glowEnd + TOP);
    // stars and the moon (with its glitter on the water)
    var night = Math.max(0, Math.min(1, (alt - 0.6) / 0.3));
    if (night > 0) {
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.5 + 0.5 * Math.sin(now / 500 + st.t));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(st.x * FULL_W - LEFT, st.y * FULL_H - TOP, st.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = night;
      var mx = W * 0.82, my = -TOP + FULL_H * 0.24, mr = FULL_H * 0.045;
      var mg = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 3);
      mg.addColorStop(0, 'rgba(255, 248, 225, 1)');
      mg.addColorStop(0.33, 'rgba(255, 244, 210, 0.95)');
      mg.addColorStop(0.38, 'rgba(255, 240, 200, 0.25)');
      mg.addColorStop(1, 'rgba(255, 240, 200, 0)');
      ctx.fillStyle = mg;
      ctx.fillRect(mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
      var rg = ctx.createLinearGradient(0, horizon, 0, H);
      rg.addColorStop(0, 'rgba(255, 240, 200, 0.35)');
      rg.addColorStop(1, 'rgba(255, 240, 200, 0)');
      ctx.fillStyle = rg;
      for (var i = 0; i < 9; i++) {
        var yy = horizon + (H - horizon) * (0.03 + i * 0.1), ww = mr * (1.2 + i * 0.5) * (0.7 + 0.3 * Math.sin(now / 300 + i));
        ctx.fillRect(mx - ww / 2, yy, ww, H * 0.012);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawDolphin(now) {
    if (S.phase !== 'flying' || !scene.dolphinAt || now < scene.dolphinAt) return;
    var t = now - scene.dolphinAt, n = frames('dolphin'), dur = n * 50;
    if (t > dur) { scene.dolphinAt = now + 3500 + Math.random() * 5000; scene.dolphinX = 0.55 + Math.random() * 0.35; return; }
    // It jumps out of the open sea between the horizon and the ship (not at the horizon, where
    // it looked like jumping into the clouds); the whole arc stays below the horizon.
    var horizon = -TOP + FULL_H * 0.6, water = horizon + (seaLine() - horizon) * 0.6;
    var ds = Math.min(H * 0.16, (water - horizon) * 1.05) / (DOLPHIN_BOTTOM - 20);
    sprite('dolphin', Math.floor(t / 50), W * scene.dolphinX - DOLPHIN_CX * ds, water - DOLPHIN_BOTTOM * ds, ds, 1, true);
  }

  function drawShip(name, now, fps, clampFrame) {
    var s = shipScale(), cx = shipX();
    var bob = S.phase === 'flying' ? Math.sin(now / 520) * H * 0.006 : 0;
    var f = clampFrame == null ? frameAt(now, fps) : clampFrame;
    sprite(name, f, cx - SHIP_CX * s, seaLine() - SHIP_WATER * s + bob, s, 1, clampFrame != null);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // While bets are open: the ship rests, the captain's wheel spins and the bar fills.
  function drawHarbour(now) {
    drawShip('shipIdle', now, 15);
    if (S.phase !== 'betting') return;
    var size = Math.min(H * 0.28, W * 0.24), cx = W * 0.73, cy = H * 0.3;
    if (wheel) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(now / 900);
      ctx.drawImage(wheel, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var p = Math.min(1, Math.max(0, (Date.now() - S.bettingStartsAt) / total));
    var bw = Math.min(size * 1.7, W * 0.44), bh = Math.max(12, H * 0.04), bx = cx - bw / 2, by = cy + size / 2 + H * 0.04;
    roundRect(bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(6, 31, 51, 0.7)';
    ctx.fill();
    if (p > 0) {
      var inset = 3, fw = Math.max(bh - inset * 2, (bw - inset * 2) * (1 - p)); // time left
      roundRect(bx + inset, by + inset, fw, bh - inset * 2, (bh - inset * 2) / 2);
      var grad = ctx.createLinearGradient(0, by, 0, by + bh);
      grad.addColorStop(0, '#bff3ff');
      grad.addColorStop(1, '#38c6f0');
      ctx.fillStyle = grad;
      ctx.fill();
    }
    roundRect(bx, by, bw, bh, bh / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(191, 243, 255, 0.9)';
    ctx.stroke();
    ctx.font = '800 ' + Math.round(Math.max(12, H * 0.042)) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(6, 31, 51, 0.85)';
    ctx.fillStyle = '#fff';
    var label = S.bettingPhrase.toUpperCase();
    ctx.strokeText(label, cx, by + bh + H * 0.03);
    ctx.fillText(label, cx, by + bh + H * 0.03);
  }

  // The round ends: the sea dragon rises, breathes fire, the ship burns.
  function drawDragonAttack(now) {
    var t = scene.crashAt ? now - scene.crashAt : RISE_MS + 2000; // joined after the crash: final picture
    var ds = (H * 0.62) / DRAGON_H, dx = W * 0.78 - DRAGON_CX * ds, dy = H * 0.97 - DRAGON_BOTTOM * ds;
    if (t < RISE_MS) sprite('dragon', Math.floor((t / RISE_MS) * frames('dragon')), dx, dy, ds, 1, true);
    else sprite('dragonIdle', frameAt(t, 15), dx, dy, ds);
    if (t < BURN_AT) drawShip('shipShock', now, 15);
    else if (t < BURN_AT + 1000) drawShip('shipBurn', now, 15, Math.floor(((t - BURN_AT) / 1000) * frames('shipBurn')));
    else drawShip('shipBurnIdle', now, 15);
    if (t >= FIRE_AT && t < FIRE_AT + frames('fire') * 42) {
      var s = shipScale(), fs = (SHIP_W * s * 0.7) / FIRE_W;
      var fx = shipX() + (240 - SHIP_CX) * s, fy = seaLine() - (SHIP_WATER - SHIP_FIRE_Y) * s;
      sprite('fire', Math.floor((t - FIRE_AT) / 42), fx - FIRE_CX * fs, fy - FIRE_CY * fs, fs, 1, true);
    }
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var SKY_TOP = [45, 128, 249]; // measured: top row of the sea picture
  var themeAt = 0;
  function themeColour() {
    var alt = scene.alt, c = SKY_TOP.slice();
    if (alt >= 0.01) {
      var t = stage(TINT, alt), g = stage(GLOW, alt)[0];
      c = c.map(function (v, i) { return v * t[i] / 255; });
      c = c.map(function (v, i) { return v * (1 - g[3]) + g[i] * g[3]; });
    }
    if (S.phase === 'betting' || S.phase === 'waiting') c = c.map(function (v, i) { return v * 0.55 + [2, 22, 40][i] * 0.45; });
    return '#' + c.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }

  function frame(now) {
    if (now - themeAt > 400) { themeAt = now; game.theme(themeColour()); }
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    if (W && H) {
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the scene also fills above / to the left
      ctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
      drawSea(now, dt);
      if (S.phase === 'betting' || S.phase === 'waiting') {
        ctx.fillStyle = 'rgba(2, 22, 40, 0.45)'; // evening calm while bets are open
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
        drawHarbour(now);
      } else if (S.phase === 'flying') {
        drawDolphin(now);
        drawShip('shipMove', now, 15);
      } else if (S.phase === 'crashed') drawDragonAttack(now);
      ctx.restore();
    }
    // texts over the scene (only changed when different)
    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    var crashed = S.phase === 'crashed';
    if (flew.hidden !== !crashed) flew.hidden = !crashed;
    if (crashed) setText(flew, S.crashPhrase);
    var mt = '', mc = 'mult', ht = '';
    if (S.phase === 'flying') {
      mt = game.currentMult().toFixed(2) + 'x';
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (crashed) {
      mt = S.crashPoint.toFixed(2) + 'x'; mc = 'mult mult--crashed';
    } else if (S.phase !== 'betting') {
      ht = S.gotSnapshot ? 'Waiting for the next round…' : 'Connecting…';
    }
    if (mult.className !== mc) mult.className = mc;
    setText(mult, mt);
    setText(hint, ht);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- controls
  function setAmount(p, v) {
    var l = game.limit();
    v = Math.max(l.min, game.round2(v));
    if (l.max) v = Math.min(l.max, v);
    p.amount.value = v.toFixed(2);
    updateButton(p);
  }
  function buildQuick(p) { // 1×, 2×, 5×, 10× the min bet (within the max) — built once
    var l = game.limit();
    p.quick.innerHTML = '';
    [1, 2, 5, 10].forEach(function (k) {
      var v = game.round2(l.min * k);
      if (l.max && v > l.max) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = game.money(v).replace(/\.00$/, '');
      b.onclick = function () { play('click'); setAmount(p, v); };
      p.quick.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { panels.forEach(function (p) { buildQuick(p); setAmount(p, l.min); }); });

  panels.forEach(function (p) {
    Array.prototype.forEach.call(p.el.querySelectorAll('.stepper__btn'), function (b) {
      b.onclick = function () { play('click'); setAmount(p, readAmount(p) + Number(b.dataset.step) * game.limit().min); };
    });
    p.min.onclick = function () { play('click'); setAmount(p, game.limit().min); };
    p.max.onclick = function () {
      play('click');
      var l = game.limit(), cap = l.max || readAmount(p);
      setAmount(p, S.balance != null ? Math.min(cap, S.balance) : cap);
    };
    p.amount.oninput = function () { updateButton(p); };
    p.amount.onblur = function () { setAmount(p, readAmount(p) || game.limit().min); };
    p.action.onclick = function () {
      play('click');
      if (S.queued[p.slot]) return game.cancelQueued(p.slot);
      var my = S.my[p.slot];
      if (my && my.round === S.round && my.status === 'placed' && S.phase === 'flying') return game.cashOut(p.slot);
      if (my && my.round === S.round && my.status !== 'lost' && my.status !== 'cashed') return;
      game.bet(p.slot, readAmount(p), readAuto(p));
    };
  });
  try { localStorage.removeItem('sindbad-two-bets'); } catch (e) { /* old setting, no longer used */ }

  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); play('click'); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem('sindbad-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncMusic();
  };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      play('click');
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
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
