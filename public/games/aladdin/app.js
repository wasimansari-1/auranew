/* Aladdin — NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is the look:
 * the market scene (Aladdin + the lamp while bets are open), the jump onto the carpet, the
 * flight over the scrolling city, and the bet panel / bets list. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0003', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- assets
  var SHEETS = ['alladinIdle', 'alladinJump', 'alladinFly', 'carpet', 'chirag'];
  var sheets = {};
  var city = null, skyline = null;
  var assetsReady = false;

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }
  Promise.all(SHEETS.map(function (name) {
    return Promise.all([
      fetch('assets/sprites/' + name + '.json').then(function (r) { return r.json(); }),
      loadImage('assets/sprites/' + name + '.webp'),
    ]).then(function (res) { sheets[name] = { meta: res[0], img: res[1] }; });
  }).concat(loadImage('assets/city.webp').then(function (img) { city = img; }),
    loadImage('assets/skyline.webp').then(function (img) { skyline = img; })))
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
  try { soundOn = localStorage.getItem('aladdin-sound') !== 'off'; } catch (e) { /* default on */ }
  var sounds = {};
  ['click', 'cashout', 'jump', 'woosh_low', 'fly-loop'].forEach(function (n) {
    var a = new Audio('assets/sounds/' + n + '.mp3');
    a.preload = 'auto';
    if (n === 'fly-loop') { a.loop = true; a.volume = 0.5; }
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
  try { musicOn = localStorage.getItem('aladdin-music') !== 'off'; } catch (e) { /* default on */ }
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
    try { localStorage.setItem('aladdin-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (!on) stop('fly-loop'); else if (S.phase === 'flying') play('fly-loop');
  }

  // ---------------------------------------------------------------- engine moments
  var scene = { jumpAt: 0, crashAt: 0, crashFrom: null, cityX: 0, lastT: 0, alt: 0 };
  function onSignal(name, d) {
    if (name === 'start') { scene.jumpAt = performance.now(); play('jump'); setTimeout(function () { if (S.phase === 'flying') play('fly-loop'); }, 700); }
    if (name === 'crash') { var n = performance.now(); scene.crashAt = n; scene.crashFrom = scene.jumpAt ? riderAt(n) : null; stop('fly-loop'); play('woosh_low'); }
    if (name === 'betting') { scene.jumpAt = 0; scene.crashAt = 0; }
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
  // Players in this round, on the scene (../_core/players.js), with this game's avatar faces.
  var playersStrip;
  function playerFace(name) {
    var av = document.createElement('i'), k = avatarIndex(name), cell = 28;
    av.className = 'avatar';
    av.style.backgroundSize = (7 * cell) + 'px ' + (2 * cell) + 'px';
    av.style.backgroundPosition = (-(k % 7) * cell) + 'px ' + (-Math.floor(k / 7) * cell) + 'px';
    return av;
  }

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: playerFace });
    playersStrip.update(S);
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot;
    $('balance').textContent = S.balance == null ? '—' : game.money(S.balance);
    $('mode').textContent = S.demo ? 'Demo balance' : 'Balance';

    var h = $('history');
    h.innerHTML = '';
    S.history.forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'chip' + (c >= 10 ? ' chip--big' : '');
      s.textContent = c.toFixed(2) + 'x';
      h.appendChild(s);
    });

    updateButtons();
    renderList();

    $('fRound').textContent = S.round || '—';
    $('fHash').textContent = S.hash || '—';
    $('fSeed').textContent = S.seed || 'revealed when the round ends';
  }

  // ---- bet panels (slot 0 and 1) ----------------------------------------------------
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
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<button type="button" class="action"><span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      '<div class="auto"><span>Auto Cash Out</span>' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label>' +
      '<input class="auto__x" inputmode="decimal" value="1.10" aria-label="Auto cash-out multiplier"></div>' +
      '</div>';
    $('panels').appendChild(el);
    var q = function (sel) { return el.querySelector(sel); };
    return { slot: slot, el: el, amount: q('.amount'), action: q('.action'), label: q('.action__label'), sub: q('.action__sub'), autoOn: q('.auto__on'), autoAt: q('.auto__x'), quick: q('.quick') };
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
  // The button is built once; only its texts / class change (and only when they differ), so
  // a tap never lands on an element that is being replaced.
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
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
    return h % 14;
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
      $('cols').innerHTML = '<span>User</span><span>Bet</span><span>X</span><span>Cash out</span>';
      if (!S.bets.length) list.appendChild(cell('No bets yet this round.', 'empty'));
      S.bets.slice().reverse().forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--cashed' : '') + (b.mine ? ' row--mine' : '');
        var user = document.createElement('span');
        user.className = 'row__user';
        var av = document.createElement('i');
        av.className = 'avatar';
        var k = avatarIndex(b.player);
        av.style.backgroundPosition = (-(k % 7) * 34) + 'px ' + (-Math.floor(k / 7) * 34) + 'px';
        user.appendChild(av);
        user.appendChild(cell(b.player));
        row.appendChild(user);
        row.appendChild(cell(Number(b.amount).toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '-', 'row__x'));
        row.appendChild(cell(b.win ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      $('countLabel').textContent = 'My bets';
      $('betCount').textContent = S.myBets.length;
      $('cols').innerHTML = '<span>Time</span><span>Bet</span><span>X</span><span>Cash out</span>';
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
  // The scene fills the whole stage (under the floating top bar); characters, lamp and carpet
  // are placed in the play area below the bar, so they keep their place.
  var TOP = 0, FULL_H = 0;
  // Wide screens: the scene also runs behind the bets list on the left; the play area starts to
  // its right (LEFT). The world is drawn from -LEFT so it fills the whole width.
  var LEFT = 0, FULL_W = 0;
  var JUMP_MS = 900, RISE_MS = 1300, FLYOFF_MS = 1000;

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
    // Wide screens: the results row and bet panels float over the scene's lower part, so the
    // play area ends just above the results row (the scene fades out behind them).
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(120, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // The multiplier / round texts are centred on the play area (not the whole scene).
    var centre = document.querySelector('.stage__center').style;
    centre.left = LEFT + 'px'; centre.top = TOP + 'px'; centre.width = W + 'px'; centre.height = H + 'px';
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a player joins the round).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    fade.width = canvas.width;
    fade.height = canvas.height;
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.translate(LEFT, TOP);
  }

  // Draws frame i of a sprite sheet; (x, y) = top-left of the full (untrimmed) frame.
  function sprite(name, i, x, y, scale, alpha) {
    var s = sheets[name];
    if (!s || !s.img) return;
    var f = s.meta.frames[((i % s.meta.frames.length) + s.meta.frames.length) % s.meta.frames.length];
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(s.img, f[0], f[1], f[2], f[3], x + f[4] * scale, y + f[5] * scale, f[2] * scale, f[3] * scale);
    ctx.globalAlpha = 1;
  }
  function frameAt(t, fps) { return Math.floor(t / (1000 / fps)); }
  function ease(t) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); }

  // Sprite geometry (in frame pixels, measured from the images): the kneeling Aladdin — last
  // jump frame and every fly frame are the same pose — sits in the middle of the carpet.
  var KNEEL_CX = 95, KNEEL_BOTTOM = 339; // kneeling body: centre x, knees (frame box 200×345)
  var CARPET_CX = 232, CARPET_SEAT = 56; // carpet: centre x, middle of its surface (box 430×130)

  // Aladdin's spot in the market (idle / jump): frame top-left and scale.
  function groundSpot() {
    var h = sheets.alladinIdle ? sheets.alladinIdle.meta.h : 345;
    var s = (H * 0.56) / h;
    return { x: W * 0.03, y: H * 0.97 - h * s, s: s };
  }
  // The rider (kneel centre x, kneel bottom y, scale): lands where the jump ends, then rises
  // to cruise height and bobs.
  function riderAt(now) {
    var g = groundSpot();
    var from = { x: g.x + KNEEL_CX * g.s, y: g.y + KNEEL_BOTTOM * g.s, s: g.s };
    var to = { x: W * 0.5, y: H * (0.44 - 0.08 * scene.alt), s: g.s * 0.8 };
    var k = ease((now - scene.jumpAt - JUMP_MS) / RISE_MS);
    return {
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k + Math.sin(now / 420) * H * 0.012 * k,
      s: from.s + (to.s - from.s) * k,
    };
  }

  // ---- the world: the camera climbs with the multiplier --------------------------------
  // 1x the market · ~1.5–3x the market drops away and the distant skyline shows · ~3–10x
  // clouds and dusk · 10x+ night sky with stars and the moon.
  var SKY = [ // [top, bottom] colours by altitude stage
    [[201, 108, 90], [232, 160, 106]], // sunset (matches the market picture's sky)
    [[120, 62, 110], [214, 124, 108]], // dusk
    [[24, 22, 64], [92, 58, 112]], // night
  ];
  var clouds = [], stars = [];
  for (var ci = 0; ci < 9; ci++) clouds.push({ x: Math.random(), y: 0.15 + Math.random() * 1.3, s: 0.6 + Math.random() * 0.9, v: 0.5 + Math.random() * 0.8 });
  for (var si = 0; si < 70; si++) stars.push({ x: Math.random(), y: Math.random() * 0.75, r: 0.6 + Math.random() * 1.4, t: Math.random() * 6 });

  function climb() { // 0 on the ground … 1 at about 10x
    if (S.phase === 'flying') return Math.min(1, Math.log(Math.max(1, game.currentMult())) / Math.log(10));
    if (S.phase === 'crashed') return Math.min(1, Math.log(Math.max(1, S.crashPoint)) / Math.log(10));
    return 0;
  }
  function mix(a, b, k) { return Math.round(a + (b - a) * k); }
  function skyColour(i, alt) { // i: 0 top, 1 bottom
    var st = alt < 0.5 ? 0 : 1, k = alt < 0.5 ? alt / 0.5 : (alt - 0.5) / 0.5;
    var c0 = SKY[st][i], c1 = SKY[st + 1][i];
    return 'rgb(' + mix(c0[0], c1[0], k) + ',' + mix(c0[1], c1[1], k) + ',' + mix(c0[2], c1[2], k) + ')';
  }
  // A layer picture whose own sky melts into ours: the same sky gradient is painted over the
  // picture's top part, fully at its top edge and fading out smoothly — no visible seam.
  var fade = document.createElement('canvas'), fctx = fade.getContext('2d');
  function skyGradient(c) { // covers the play area and the strip above it (under the bar)
    var g = c.createLinearGradient(0, -TOP, 0, H);
    g.addColorStop(0, skyColour(0, scene.alt));
    g.addColorStop(1, skyColour(1, scene.alt));
    return g;
  }
  function layer(img, x0, y, h, fadeTo) {
    if (!img) return;
    var w = img.width * (h / img.height);
    var x = -(((x0 % w) + w) % w) - LEFT;
    for (; x < W; x += w) ctx.drawImage(img, x, y, w, h);
    var fh = h * fadeTo, top = Math.max(0, y - 1), bottom = Math.min(H, y + fh);
    if (bottom <= top) return;
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
    fctx.fillStyle = skyGradient(fctx);
    fctx.fillRect(-LEFT, top, FULL_W, bottom - top);
    var m = fctx.createLinearGradient(0, y, 0, y + fh); // opaque at the top → clear
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(0.35, 'rgba(0,0,0,0.85)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.globalCompositeOperation = 'destination-in';
    fctx.fillStyle = m;
    fctx.fillRect(-LEFT, top, FULL_W, bottom - top);
    ctx.drawImage(fade, 0, 0, fade.width, fade.height, -LEFT, -TOP, FULL_W, FULL_H);
  }
  function cloud(x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff3ec';
    [[0, 0, 1], [-0.55, 0.12, 0.7], [0.55, 0.1, 0.75], [-0.2, -0.25, 0.65], [0.25, -0.2, 0.6]].forEach(function (b) {
      ctx.beginPath();
      ctx.ellipse(x + b[0] * 60 * s, y + b[1] * 30 * s, 42 * s * b[2], 24 * s * b[2], 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawWorld(dt, now) {
    // Smoothly follow the target altitude (also glides back down for the next round).
    scene.alt += (climb() - scene.alt) * Math.min(1, dt / 350);
    var alt = scene.alt, A = alt * H * 2.2; // camera height in px
    if (S.phase === 'flying') {
      scene.cityX += H * 0.22 * (1 + alt * 1.2) * dt / 1000;
    } else if (S.phase !== 'crashed') {
      var cw = city ? city.width * (H / city.height) : W;
      scene.cityX = (cw - W) / 2; // the market square in the middle
    }
    // sky (up to the top edge, behind the bar)
    ctx.fillStyle = skyGradient(ctx);
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    // stars + moon (night)
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
      var mg = ctx.createRadialGradient(W * 0.82, H * 0.18, 2, W * 0.82, H * 0.18, H * 0.16);
      mg.addColorStop(0, 'rgba(255, 244, 214, 1)');
      mg.addColorStop(0.35, 'rgba(255, 236, 190, 0.95)');
      mg.addColorStop(0.42, 'rgba(255, 220, 160, 0.25)');
      mg.addColorStop(1, 'rgba(255, 220, 160, 0)');
      ctx.fillStyle = mg;
      ctx.fillRect(W * 0.6, 0, W * 0.4, H * 0.4);
      ctx.globalAlpha = 1;
    }
    // distant skyline (behind the market; slower), then the market (moves with the camera)
    layer(skyline, scene.cityX * 0.35, H * 0.38 + A * 0.3, H * 0.62, 0.42);
    if (A < H * 1.05) layer(city, scene.cityX, A, H, 0.5);
    // clouds (in the sky above the market; faster than the skyline)
    var cloudAlpha = Math.max(0, Math.min(1, (alt - 0.15) / 0.2));
    if (cloudAlpha > 0) {
      clouds.forEach(function (c) {
        var span = FULL_W * 1.6;
        var cx = (((c.x * span - scene.cityX * 0.8 * c.v) % span) + span) % span - FULL_W * 0.3 - LEFT;
        var cy = H * (1 - c.y * 1.5) + A * 0.8 - H * 0.9;
        if (cy > -60 && cy < H + 60) cloud(cx, cy, c.s * (H / 360), cloudAlpha * 0.85);
      });
    }
  }

  // Lamp body inside its frame (frame pixels; the space above is for its sparkles).
  var LAMP_CX = 167, LAMP_CY = 257, LAMP_W = 314, LAMP_BOTTOM = 341;

  function drawMarket(now) {
    var g = groundSpot();
    sprite('alladinIdle', frameAt(now, 30), g.x, g.y, g.s);
    // The lamp, centred, with its loading bar (time left to bet) right under it.
    var ls = Math.min(W * 0.44, H * 0.5) / LAMP_W; // same size on phones; not oversized on wide screens
    var cx = W * 0.5, cy = H * 0.44;
    sprite('chirag', frameAt(now, 30), cx - LAMP_CX * ls, cy - LAMP_CY * ls, ls);
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var p = S.phase === 'betting' ? Math.min(1, Math.max(0, (Date.now() - S.bettingStartsAt) / total)) : 0;
    var bw = LAMP_W * ls * 1.05, bh = Math.max(14, H * 0.045);
    var bx = cx - bw / 2, by = cy + (LAMP_BOTTOM - LAMP_CY) * ls + H * 0.035;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    roundRect(bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(40, 20, 5, 0.6)';
    ctx.fill();
    ctx.restore();
    if (p > 0) {
      var inset = 3, fw = Math.max(bh - inset * 2, (bw - inset * 2) * p);
      roundRect(bx + inset, by + inset, fw, bh - inset * 2, (bh - inset * 2) / 2);
      var grad = ctx.createLinearGradient(0, by, 0, by + bh);
      grad.addColorStop(0, '#fff3a8');
      grad.addColorStop(1, '#ffd23f');
      ctx.fillStyle = grad;
      ctx.fill();
    }
    roundRect(bx, by, bw, bh, bh / 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    if (S.phase === 'betting') {
      ctx.font = '800 ' + Math.round(Math.max(12, H * 0.04)) + 'px "Trebuchet MS", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(90, 26, 10, 0.85)';
      ctx.fillStyle = '#fff';
      var label = S.bettingPhrase.toUpperCase();
      ctx.strokeText(label, cx, by + bh + H * 0.03);
      ctx.fillText(label, cx, by + bh + H * 0.03);
    }
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

  function drawCarpet(x, y, s, now, alpha) { // (x, y) = where the rider sits
    sprite('carpet', frameAt(now, 30), x - CARPET_CX * s, y - CARPET_SEAT * s, s, alpha);
  }

  function drawRider(r, now, alpha) {
    drawCarpet(r.x, r.y, r.s, now, alpha);
    sprite('alladinFly', frameAt(now, 30), r.x - KNEEL_CX * r.s, r.y - KNEEL_BOTTOM * r.s, r.s, alpha);
  }

  function drawFlight(now) {
    if (!scene.jumpAt) scene.jumpAt = now - JUMP_MS - RISE_MS; // joined mid-flight
    var t = now - scene.jumpAt;
    if (t < JUMP_MS) {
      // Aladdin jumps; the carpet slides in under him and is there as he lands kneeling.
      var g = groundSpot();
      var n = sheets.alladinJump ? sheets.alladinJump.meta.frames.length : 30;
      var land = { x: g.x + KNEEL_CX * g.s, y: g.y + KNEEL_BOTTOM * g.s };
      var k = ease(t / (JUMP_MS * 0.85));
      drawCarpet(-W * 0.6 + (land.x + W * 0.6) * k, land.y, g.s, now, 1);
      sprite('alladinJump', Math.min(n - 1, Math.floor((t / JUMP_MS) * n)), g.x, g.y, g.s);
      return;
    }
    drawRider(riderAt(now), now, 1);
  }

  function drawCrash(now) {
    var t = now - scene.crashAt;
    var r = scene.crashFrom;
    if (r && t < FLYOFF_MS) {
      var k = Math.pow(t / FLYOFF_MS, 2);
      drawRider({ x: r.x + (W * 1.4 - r.x) * k, y: r.y + (-H * 0.3 - r.y) * k, s: r.s * (1 - 0.3 * k) }, now, 1);
    }
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0;
  function themeColour() {
    var c = skyColour(0, scene.alt).match(/\d+/g).map(Number);
    if (S.phase !== 'flying') c = c.map(function (v, i) { return Math.round(v * 0.68 + [40, 16, 2][i] * 0.32); }); // dusk tint
    return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  function frame(now) {
    if (now - themeAt > 400) { themeAt = now; game.theme(themeColour()); }
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    if (W && H) {
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      ctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
      drawWorld(dt, now);
      if (S.phase !== 'flying') {
        ctx.fillStyle = 'rgba(40, 16, 2, 0.32)'; // dusk while bets are open / after the round
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      }
      if (S.phase === 'betting' || S.phase === 'waiting') drawMarket(now);
      else if (S.phase === 'flying') drawFlight(now);
      else if (S.phase === 'crashed') drawCrash(now);
      ctx.restore();
    }
    // texts over the scene
    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden && flew.textContent !== S.crashPhrase) flew.textContent = S.crashPhrase;
    if (S.phase === 'flying') {
      mult.className = 'mult'; mult.textContent = game.currentMult().toFixed(2) + 'x'; hint.textContent = '';
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      mult.className = 'mult mult--crashed'; mult.textContent = S.crashPoint.toFixed(2) + 'x'; hint.textContent = '';
    } else if (S.phase === 'betting') {
      mult.textContent = ''; hint.textContent = '';
    } else {
      mult.textContent = ''; hint.textContent = S.gotSnapshot ? 'Waiting for the next round…' : 'Connecting…';
    }
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
  function buildQuick(p) { // 1×, 2×, 5×, 10× the min bet (within the max)
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
  try { localStorage.removeItem('aladdin-two-bets'); } catch (e) { /* old setting, no longer used */ }

  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); play('click'); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem('aladdin-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
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
