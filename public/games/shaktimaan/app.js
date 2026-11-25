/* Shaktimaan — NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is the look:
 * Shaktimaan hovers over the city while bets are open, spins (tornado) and flies up — the
 * camera climbs the tall sky (city → open sky → clouds → night with stars) — and at the crash a
 * villain (Kilvish, Tantrik or Shalaaka) flies in and strikes while he spins away. Shaktimaan
 * is a Spine 4.2 rig drawn with spine-canvas; the villains are sprite sheets. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0006', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- assets
  var VILLAINS = [
    { fly: 'kilvishFly', attack: 'kilvishAttack', sound: 'kilvishGlow' },
    { fly: 'tantrikFly', attack: 'tantrikAttack', sound: 'tantrikPower' },
    { fly: 'shalaakaFly', attack: 'shalaakaAttack', sound: 'shalakaPower' },
  ];
  var SHEETS = [];
  VILLAINS.forEach(function (v) { SHEETS.push(v.fly, v.attack); });
  var sheets = {};
  var sky = null, cloudsNear = null, cloudsFar = null;
  var hero = null; // { skeleton, state, renderer, anim }
  var assetsReady = false;

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  // Sprite sheet + the union of its frames' visible boxes (measured: body centre and feet).
  function loadSheet(name) {
    return Promise.all([
      fetch('assets/sprites/' + name + '.json').then(function (r) { return r.json(); }),
      loadImage('assets/sprites/' + name + '.webp'),
    ]).then(function (res) {
      var meta = res[0], x0 = 1e9, x1 = 0, y0 = 1e9, y1 = 0;
      meta.frames.forEach(function (f) {
        x0 = Math.min(x0, f[4]); x1 = Math.max(x1, f[4] + f[2]);
        y0 = Math.min(y0, f[5]); y1 = Math.max(y1, f[5] + f[3]);
      });
      sheets[name] = { meta: meta, img: res[1], cx: (x0 + x1) / 2, bottom: y1, h: y1 - y0 };
    });
  }

  // Shaktimaan: the Spine rig. Body size and feet come from the hover pose's bounds (the flying
  // poses carry speed lines that make their bounds bigger, so every pose uses the same scale).
  function loadHero() {
    var am = new spine.AssetManager('assets/spine/');
    am.loadText('character.json');
    am.loadTextureAtlas('character.atlas');
    return am.loadAll().then(function () {
      var data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(am.require('character.atlas'))).readSkeletonData(am.require('character.json'));
      var skeleton = new spine.Skeleton(data);
      var state = new spine.AnimationState(new spine.AnimationStateData(data));
      state.data.defaultMix = 0.15;
      state.setAnimation(0, 'Shaktiman', true);
      state.update(0.3); state.apply(skeleton); skeleton.updateWorldTransform(spine.Physics.update);
      var off = new spine.Vector2(), size = new spine.Vector2();
      skeleton.getBounds(off, size, []);
      var renderer = new spine.SkeletonRenderer(ctx);
      renderer.triangleRendering = true; // the rig uses meshes
      hero = { skeleton: skeleton, state: state, renderer: renderer, anim: 'Shaktiman', cx: off.x + size.x / 2, feet: off.y, h: size.y };
    });
  }

  Promise.all(SHEETS.map(loadSheet).concat(
    loadImage('assets/sky.webp').then(function (img) { sky = img; }),
    loadImage('assets/clouds-near.webp').then(function (img) { cloudsNear = img; }),
    loadImage('assets/clouds-far.webp').then(function (img) { cloudsFar = img; }),
    loadHero()))
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
  try { soundOn = localStorage.getItem('shaktimaan-sound') !== 'off'; } catch (e) { /* default on */ }
  var sounds = {};
  ['click', 'cashout', 'tornado', 'woosh_low', 'fly-loop', 'kilvishGlow', 'tantrikPower', 'shalakaPower'].forEach(function (n) {
    var a = new Audio('assets/sounds/' + n + '.mp3');
    a.preload = n === 'fly-loop' || n === 'click' || n === 'tornado' ? 'auto' : 'none';
    if (n === 'fly-loop') { a.loop = true; a.volume = 0.45; }
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
  try { musicOn = localStorage.getItem('shaktimaan-music') !== 'off'; } catch (e) { /* default on */ }
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
    try { localStorage.setItem('shaktimaan-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (!on) stop('fly-loop'); else if (S.phase === 'flying') play('fly-loop');
  }

  // ---------------------------------------------------------------- engine moments
  var scene = { startAt: 0, spinEnd: 0, crashAt: 0, crashFrom: null, villain: null, lastT: 0, alt: 0, drift: 0 };
  // The take-off spin lasts exactly as long as the tornado sound: its real length (audio.duration)
  // once known, the measured length until then; if the sound starts late, the spin's end moves
  // with it — sound and spin end together, then the flight loop starts.
  var TORNADO_MS = 2928; // measured length of tornado.mp3
  function tornadoMs() {
    var d = sounds.tornado && sounds.tornado.duration;
    return isFinite(d) && d > 0 ? Math.round(d * 1000) : TORNADO_MS;
  }
  var spinTimer = 0;
  function endSpinAt(t) {
    scene.spinEnd = t;
    clearTimeout(spinTimer);
    spinTimer = setTimeout(function () {
      stop('tornado');
      if (S.phase === 'flying') play('fly-loop');
    }, Math.max(0, t - performance.now()));
  }
  sounds.tornado.addEventListener('playing', function () { // started (maybe late): spin ends with it
    if (S.phase === 'flying' && performance.now() < scene.spinEnd) endSpinAt(performance.now() + (sounds.tornado.duration - sounds.tornado.currentTime) * 1000);
  });
  function onSignal(name, d) {
    if (name === 'start') {
      scene.startAt = performance.now();
      endSpinAt(scene.startAt + tornadoMs());
      play('tornado');
    }
    if (name === 'crash') {
      var n = performance.now();
      scene.crashAt = n;
      scene.crashFrom = scene.startAt ? heroPos(n) : null;
      clearTimeout(spinTimer);
      stop('tornado'); // a crash during the take-off ends the spin and its sound together
      scene.villain = VILLAINS[Math.floor(Math.random() * VILLAINS.length)];
      stop('fly-loop');
      play('woosh_low');
      var v = scene.villain;
      setTimeout(function () { if (S.phase === 'crashed' && scene.villain === v) play(v.sound); }, VILLAIN_IN_MS);
    }
    if (name === 'betting') { scene.startAt = 0; scene.crashAt = 0; scene.villain = null; }
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
  var AVATARS = 15, AV_COLS = 8; // avatars.webp: 15 faces in an 8×2 grid
  // Players in this round, on the scene (../_core/players.js), with this game's avatar faces.
  var playersStrip;
  function avatarStyle(av, name, cell) {
    var k = avatarIndex(name);
    av.style.backgroundSize = (AV_COLS * cell) + 'px ' + (2 * cell) + 'px';
    av.style.backgroundPosition = (-(k % AV_COLS) * cell) + 'px ' + (-Math.floor(k / AV_COLS) * cell) + 'px';
  }
  function playerFace(name) {
    var av = document.createElement('i');
    av.className = 'avatar';
    avatarStyle(av, name, 28);
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
    return h % AVATARS;
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
        avatarStyle(av, b.player, 34);
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
  // The scene fills the whole stage (under the floating top bar); Shaktimaan and the villains
  // are placed in the play area below the bar, so they keep their place.
  var TOP = 0, FULL_H = 0;
  // Wide screens: the scene also runs behind the bets list on the left; the play area starts to
  // its right (LEFT). The world is drawn from -LEFT so it fills the whole width.
  var LEFT = 0, FULL_W = 0;
  var RISE_MS = 1000, VILLAIN_IN_MS = 520, HERO_OFF_MS = 950;

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
    // The results row (and on wide screens the bet panels) float over the scene's lower part, so
    // the play area ends just above the results row (the scene fades out behind them).
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
  }

  // Draws frame i of a sprite sheet with its measured body centre x / feet at (x, y).
  function sprite(name, i, x, y, scale, alpha) {
    var s = sheets[name];
    if (!s || !s.img) return;
    var n = s.meta.frames.length, f = s.meta.frames[((i % n) + n) % n];
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(s.img, f[0], f[1], f[2], f[3], x - s.cx * scale + f[4] * scale, y - s.bottom * scale + f[5] * scale, f[2] * scale, f[3] * scale);
    ctx.globalAlpha = 1;
  }
  function frameAt(t, fps) { return Math.floor(t / (1000 / fps)); }
  function ease(t) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); }

  // ---- Shaktimaan (Spine) ---------------------------------------------------------------
  function heroAnim(name) {
    if (!hero || hero.anim === name) return;
    hero.anim = name;
    hero.state.setAnimation(0, name, true);
  }
  function heroScale() { return (H * 0.4) / (hero ? hero.h : 1772); }
  // Feet position: hovering over the city while bets are open; rises to the cruise height
  // after the spin and sways gently while flying.
  function heroPos(now) {
    var ground = { x: W * 0.5, y: H * 0.7 };
    if (S.phase !== 'flying' || !scene.startAt) return ground;
    var k = ease((now - scene.spinEnd) / RISE_MS);
    return {
      x: ground.x + Math.sin(now / 1100) * W * 0.05 * k,
      y: ground.y + (H * 0.5 - ground.y) * k + Math.sin(now / 520) * H * 0.012 * k,
    };
  }
  function drawHero(x, y, scale, alpha, dt) {
    if (!hero) return;
    hero.state.update(dt / 1000);
    hero.state.apply(hero.skeleton);
    hero.skeleton.updateWorldTransform(spine.Physics.update);
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    ctx.scale(scale, -scale); // Spine is y-up
    ctx.translate(-hero.cx, -hero.feet);
    hero.renderer.draw(hero.skeleton);
    ctx.restore();
  }

  // ---- the world: the camera climbs the tall sky with the multiplier --------------------
  // 1x the city at sunrise · ~1.5–3x open sky · ~3–10x clouds racing past, the sky darkening
  // · 10x+ the top of the sky: deep night with stars.
  // The sky picture's colour from top to bottom (41 samples, measured from the image).
  var SKY_COL = ('183c4f 183c4f 183c4f 193d4f 1c3e4e 1c3e4e 1b3d4d 1c3c4b 1c3c4b 1b3c47 1d3b47 1d3a48 1c3d4f 1d4255 1e495b 205062 235a6a ' +
    '276574 2a717d 2d7d86 318a91 359599 379c9f 3aa4a6 41acab 4db1ac 62b5ab 7bb7a6 99b9a2 b6bb9b cbbb94 dfbe8c ebc387 ecc282 debd85 ' +
    'd3b184 bc7c4c aa613c a35735 91472d 7b3925').split(' ');
  var stars = [];
  for (var si = 0; si < 80; si++) stars.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.4, t: Math.random() * 6 });

  function climb() { // 0 on the ground … 1 at about 10x
    if (S.phase === 'flying') return Math.min(1, Math.log(Math.max(1, game.currentMult())) / Math.log(10));
    if (S.phase === 'crashed') return Math.min(1, Math.log(Math.max(1, S.crashPoint)) / Math.log(10));
    return 0;
  }
  // Sky picture placement: it covers the whole stage; at 1x its bottom (the city) sits at the
  // stage bottom; the camera climbs until its top reaches the top edge.
  function skyBox() {
    var s = Math.max(FULL_W / 1400, FULL_H / 900);
    var iw = 1400 * s, ih = 2296 * s;
    var y0 = FULL_H - TOP - ih, rise = Math.max(0, ih - FULL_H);
    return { x: -LEFT + (FULL_W - iw) / 2, y: y0 + rise * scene.alt, w: iw, h: ih };
  }

  function tiles(img, scale, offY, offX, alpha) { // a transparent cloud layer, tiled over the stage
    if (!img) return;
    var w = img.width * scale, h = img.height * scale;
    var x0 = -LEFT - (((offX % w) + w) % w), y0 = -TOP - (((-offY % h) + h) % h);
    ctx.globalAlpha = alpha;
    for (var y = y0; y < FULL_H - TOP; y += h) for (var x = x0; x < W; x += w) ctx.drawImage(img, x, y, w, h);
    ctx.globalAlpha = 1;
  }

  function drawWorld(dt, now) {
    // Smoothly follow the target altitude (also glides back down for the next round).
    scene.alt += (climb() - scene.alt) * Math.min(1, dt / 350);
    var alt = scene.alt, b = skyBox();
    if (S.phase === 'flying') scene.drift += dt * (0.04 + alt * 0.12);
    if (sky) ctx.drawImage(sky, b.x, b.y, b.w, b.h);
    else { ctx.fillStyle = '#' + SKY_COL[20]; ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H); }
    // night: the top of the sky darkens further and stars come out
    var night = Math.max(0, Math.min(1, (alt - 0.62) / 0.33));
    if (night > 0) {
      ctx.fillStyle = 'rgba(6, 10, 26, ' + (night * 0.45) + ')';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.45 + 0.55 * Math.sin(now / 500 + st.t));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(st.x * FULL_W - LEFT, st.y * FULL_H * 0.8 - TOP, st.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    // clouds: they appear as he leaves the city and race down past him (far layer slower)
    var cloudAlpha = Math.max(0, Math.min(1, (alt - 0.08) / 0.18)) * (1 - night * 0.5);
    if (cloudAlpha > 0) {
      var cs = FULL_W / 1252;
      var rise = b.y - (FULL_H - TOP - b.h);
      tiles(cloudsFar, cs * 1.1, rise * 0.55, scene.drift * 0.4, cloudAlpha * 0.8);
      tiles(cloudsNear, cs * 1.4, rise * 1.1 + scene.drift * 0.6, scene.drift, cloudAlpha);
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

  // Bets open: Shaktimaan hovers over the city with the time-left bar under him.
  function drawBetting(now, dt) {
    var p0 = heroPos(now), s = heroScale();
    heroAnim('Shaktiman');
    drawHero(p0.x, p0.y, s, 1, dt);
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var p = S.phase === 'betting' ? Math.min(1, Math.max(0, (Date.now() - S.bettingStartsAt) / total)) : 0;
    var bw = Math.min(W * 0.46, H * 0.9), bh = Math.max(14, H * 0.042);
    var cx = W * 0.5, bx = cx - bw / 2, by = p0.y + H * 0.05;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    roundRect(bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(30, 8, 18, 0.6)';
    ctx.fill();
    ctx.restore();
    if (p > 0) {
      var inset = 3, fw = Math.max(bh - inset * 2, (bw - inset * 2) * p);
      roundRect(bx + inset, by + inset, fw, bh - inset * 2, (bh - inset * 2) / 2);
      var grad = ctx.createLinearGradient(0, by, 0, by + bh);
      grad.addColorStop(0, '#ffe680');
      grad.addColorStop(1, '#f5b82e');
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
      ctx.strokeStyle = 'rgba(60, 0, 20, 0.85)';
      ctx.fillStyle = '#fff';
      var label = S.bettingPhrase.toUpperCase();
      ctx.strokeText(label, cx, by + bh + H * 0.025);
      ctx.fillText(label, cx, by + bh + H * 0.025);
    }
  }

  // Flight: the tornado spin on the spot, then he flies up to cruise height.
  function drawFlight(now, dt) {
    if (!scene.startAt) { scene.startAt = now - TORNADO_MS - RISE_MS; scene.spinEnd = now - RISE_MS; } // joined mid-flight
    var p = heroPos(now);
    heroAnim(now < scene.spinEnd ? 'Shaktiman_tornado' : 'Shaktiman_flying');
    drawHero(p.x, p.y, heroScale(), 1, dt);
  }

  // Crash: a villain flies in from the right and strikes; Shaktimaan spins and is thrown off.
  function drawCrash(now, dt) {
    var t = now - scene.crashAt, s = heroScale();
    var from = scene.crashFrom || { x: W * 0.5, y: H * 0.5 };
    if (t < HERO_OFF_MS + 400) {
      heroAnim('Shaktiman_tornado4');
      var k = Math.pow(Math.max(0, (t - 350) / HERO_OFF_MS), 2);
      drawHero(from.x + (-W * 0.35 - from.x) * k, from.y + (-H * 0.5 - from.y) * k, s * (1 - 0.35 * k), 1 - 0.4 * k, dt);
    }
    var v = scene.villain;
    if (!v) return;
    var vs = sheets[v.attack], vScale = vs ? (H * 0.42) / vs.h : 1;
    var target = { x: W * 0.76, y: H * 0.66 };
    if (t < VILLAIN_IN_MS) {
      var kin = ease(t / VILLAIN_IN_MS);
      sprite(v.fly, frameAt(now, 24), W * 1.25 + (target.x - W * 1.25) * kin, target.y - H * 0.08 * (1 - kin), vScale);
    } else {
      sprite(v.attack, frameAt(t - VILLAIN_IN_MS, 20), target.x, target.y + Math.sin(now / 400) * H * 0.008, vScale);
    }
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0;
  function themeColour() {
    var b = skyBox(), frac = Math.min(1, Math.max(0, (-TOP - b.y) / b.h));
    var hex = SKY_COL[Math.round(frac * (SKY_COL.length - 1))];
    var c = [0, 2, 4].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
    var night = Math.max(0, Math.min(1, (scene.alt - 0.62) / 0.33)) * 0.45;
    c = c.map(function (v, i) { return v * (1 - night) + [6, 10, 26][i] * night; });
    if (S.phase !== 'flying') c = c.map(function (v, i) { return v * 0.72 + [10, 6, 20][i] * 0.28; }); // betting dim
    return '#' + c.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
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
        ctx.fillStyle = 'rgba(10, 6, 20, 0.28)'; // dim while bets are open / after the round
        ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      }
      if (S.phase === 'betting' || S.phase === 'waiting') drawBetting(now, dt);
      else if (S.phase === 'flying') drawFlight(now, dt);
      else if (S.phase === 'crashed') drawCrash(now, dt);
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
  try { localStorage.removeItem('shaktimaan-two-bets'); } catch (e) { /* old setting, no longer used */ }

  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); play('click'); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem('shaktimaan-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
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
