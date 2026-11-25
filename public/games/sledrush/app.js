/* Sled Rush — NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is the look:
 * the penguin in the slingshot at the ice gate while bets are open, the launch, the ride on the
 * ice track through space past the Earth, the dive down to the snowy village (dusk, then night
 * as the multiplier climbs), the wipe-out at the crash, and the bet panel / bets list.
 * Penguin, gate and crash are Spine 4.3 rigs drawn with spine-canvas. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0014', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- assets
  var img = {};
  var rigs = {};
  var assetsReady = false;

  function loadImage(name, src) {
    return new Promise(function (resolve) {
      var i = new Image();
      i.onload = function () { img[name] = i; resolve(); };
      i.onerror = function () { resolve(); };
      i.src = src;
    });
  }

  // A Spine rig: skeleton + animation state; anchored at (ax, ay) in rig units (y-up), measured
  // from the bounds of a reference pose — the point placed on the screen.
  function loadRigs() {
    var am = new spine.AssetManager('assets/spine/');
    ['characters', 'start', 'crash'].forEach(function (n) { am.loadText(n + '.json'); am.loadTextureAtlas(n + '.atlas'); });
    return am.loadAll().then(function () {
      function make(name, pose, poseT) {
        var data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(am.require(name + '.atlas'))).readSkeletonData(am.require(name + '.json'));
        var skeleton = new spine.Skeleton(data);
        var state = new spine.AnimationState(new spine.AnimationStateData(data));
        state.data.defaultMix = 0.12;
        state.setAnimation(0, pose, true);
        state.update(poseT || 0); state.apply(skeleton); skeleton.updateWorldTransform(spine.Physics.update);
        var off = new spine.Vector2(), size = new spine.Vector2();
        skeleton.getBounds(off, size, []);
        var renderer = new spine.SkeletonRenderer(ctx);
        renderer.triangleRendering = true; // the rigs use meshes
        return { skeleton: skeleton, state: state, renderer: renderer, anim: pose, x: off.x, y: off.y, w: size.x, h: size.y };
      }
      rigs.penguin = make('characters', 'Idel'); // penguin on the snow tube (bounds: tube bottom → head)
      rigs.gate = make('start', '1 idle'); // the whole start scene: moon, ice cliff, gate, slingshot
      rigs.crash = make('crash', 'crash'); // the wipe-out (pose at 0 = penguin still on the tube)
    });
  }

  Promise.all([
    loadImage('space', 'assets/space.webp'), loadImage('stars', 'assets/stars.webp'), loadImage('earth', 'assets/earth.webp'),
    loadImage('track', 'assets/track-1.webp'), loadImage('village1', 'assets/village-1.webp'), loadImage('village2', 'assets/village-2.webp'),
  ].concat([2, 4, 5, 7].map(function (i) { return loadImage('rock' + i, 'assets/rocks/rock-' + i + '.webp'); }), loadRigs()))
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
  try { soundOn = localStorage.getItem('sledrush-sound') !== 'off'; } catch (e) { /* default on */ }
  var sounds = {};
  [['click', 'mp3'], ['cashout', 'mp3'], ['start', 'mp3'], ['slide', 'wav'], ['jump', 'wav'], ['land', 'wav'], ['descent', 'wav'], ['crash', 'mp3'], ['fall', 'wav']].forEach(function (s) {
    var a = new Audio('assets/sounds/' + s[0] + '.' + s[1]);
    a.preload = 'auto';
    if (s[0] === 'slide') { a.loop = true; a.volume = 0.45; }
    sounds[s[0]] = a;
  });
  function play(n) {
    if (!soundOn || !sounds[n]) return;
    try { sounds[n].currentTime = 0; var p = sounds[n].play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* blocked */ }
  }
  function stop(n) { try { sounds[n].pause(); } catch (e) { /* ignore */ } }

  // Background music: its own on/off (saved). Starts as the game opens (the tap that opened the
  // game allows it); where a browser still blocks it, it starts on the first tap in the game.
  var musicOn = true;
  try { musicOn = localStorage.getItem('sledrush-music') !== 'off'; } catch (e) { /* default on */ }
  var music = null, tapped = true;
  function syncMusic() {
    if (musicOn && tapped) {
      if (!music) { music = new Audio('assets/sounds/music.mp3'); music.loop = true; music.volume = 0.3; }
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
    try { localStorage.setItem('sledrush-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (!on) stop('slide'); else if (S.phase === 'flying' && scene.startAt && performance.now() > scene.launchEnd) play('slide');
  }

  // ---------------------------------------------------------------- engine moments
  // Launch: the slingshot pulls back and fires; it lasts exactly as long as the start sound.
  var LAUNCH_ANIM_S = 0.6 + 1.07; // '2 gulail back' + '3 gulail run'
  function launchMs() {
    var d = sounds.start && isFinite(sounds.start.duration) && sounds.start.duration > 0 ? sounds.start.duration : LAUNCH_ANIM_S;
    return d * 1000;
  }
  var SHIFT_AT = 2, SHIFT_MS = 1200; // dive down to the Earth when the multiplier reaches 2x
  var scene = { startAt: 0, launchEnd: 0, crashAt: 0, crashIn: 'space', crashPos: null, nextJump: 0, shiftAt: 0, world: 'space', trackX: 0, villageX: 0, lastT: 0, night: 0 };

  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') {
      scene.startAt = now; scene.launchEnd = now + launchMs(); scene.world = 'space'; scene.shiftAt = 0;
      scene.nextJump = scene.launchEnd + 2500 + Math.random() * 2500;
      if (rigs.gate) {
        rigs.gate.state.timeScale = (LAUNCH_ANIM_S * 1000) / launchMs(); // the shot ends with its sound
        rigs.gate.state.setAnimation(0, '2 gulail back', false);
        rigs.gate.state.addAnimation(0, '3 gulail run', false, 0);
      }
      play('start');
      setTimeout(function () { if (S.phase === 'flying' && scene.startAt === now) play('slide'); }, launchMs());
    }
    if (name === 'crash') {
      scene.crashAt = now;
      scene.crashIn = scene.world === 'village' ? 'village' : 'space';
      scene.crashPos = penguinPos(now);
      if (rigs.crash) rigs.crash.state.setAnimation(0, scene.crashIn === 'village' ? 'crash' : 'crash space', false);
      stop('slide');
      play('crash');
      if (scene.crashIn === 'space') play('fall');
    }
    if (name === 'betting') {
      scene.startAt = 0; scene.crashAt = 0; scene.world = 'space';
      if (rigs.gate) { rigs.gate.state.timeScale = 1; rigs.gate.state.setAnimation(0, '1 idle', true); }
    }
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
  var playersStrip; // players in this round, on the scene (../_core/players.js; initials as faces)

  function nameHue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function avatar(name) {
    var av = document.createElement('i');
    av.className = 'avatar';
    av.style.background = 'hsl(' + nameHue(name) + ', 55%, 45%)';
    av.textContent = (name.replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase();
    return av;
  }

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'));
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

  // ---- bet panels (slot 0 and 1; phone shows one, wide screens both) ---------------------
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
      '<button type="button" class="action"><span class="action__label">Launch</span><small class="action__sub"></small></button>' +
      // auto cash-out = how far the penguin slides before bailing out: switch · groove · flag
      '<div class="auto"><span class="auto__label">Auto bail-out</span>' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label>' +
      '<span class="auto__groove" aria-hidden="true"></span>' +
      '<input class="auto__x" inputmode="decimal" value="1.10" aria-label="Auto cash-out multiplier"></div>' +
      '</div>';
    $('panels').appendChild(el);
    var q = function (sel) { return el.querySelector(sel); };
    return { slot: slot, el: el, amount: q('.amount'), action: q('.action'), label: q('.action__label'), sub: q('.action__sub'), autoOn: q('.auto__on'), autoAt: q('.auto__x'), quick: q('.quick') };
  });

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
    // LAUNCH (bet) on the snow-tube button; during the run it becomes BAIL OUT (cash out)
    var my = S.my[p.slot], cls = 'action', label = 'Launch', sub = 'Bet ' + game.money(readAmount(p)), disabled = false;
    var mine = my && my.round === S.round;
    if (S.queued[p.slot]) {
      cls = 'action action--cancel'; label = 'Cancel'; sub = 'Waiting for next run';
    } else if (mine && my.status === 'pending') {
      cls = 'action action--waiting'; label = 'Placing bet…'; sub = ''; disabled = true;
    } else if (mine && my.status === 'placed' && S.phase === 'betting') {
      cls = 'action action--waiting'; label = 'Bet placed'; sub = game.money(my.amount); disabled = true;
    } else if (mine && (my.status === 'placed' || my.status === 'cashing') && S.phase === 'flying') {
      cls = 'action action--cashout'; label = 'Bail out'; sub = 'Cash out ' + game.money(game.round2(my.amount * game.currentMult())); disabled = my.status === 'cashing';
    }
    if (p.action.className !== cls) p.action.className = cls;
    if (p.action.disabled !== disabled) p.action.disabled = disabled;
    setText(p.label, label);
    setText(p.sub, sub);
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
        user.appendChild(avatar(b.player));
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
  // The scene fills the whole stage (under the floating top bar, behind the results row and, on
  // wide screens, behind the bets list and panels); the play area is W × H at (LEFT, TOP).
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
    // The results row (and on wide screens the panels) float over the scene's lower part: the
    // play area ends just above the results row (the scene melts away behind them).
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

  function ease(t) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // Draws a rig with its anchor point (ax, ay in rig units, y-up) at (x, y) on the screen.
  function drawRig(rig, x, y, scale, ax, ay, dt, alpha) {
    if (!rig) return;
    rig.state.update(dt / 1000);
    rig.state.apply(rig.skeleton);
    rig.skeleton.updateWorldTransform(spine.Physics.update);
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    ctx.scale(scale, -scale); // Spine is y-up
    ctx.translate(-ax, -ay);
    rig.renderer.draw(rig.skeleton);
    ctx.restore();
  }
  function setAnim(rig, name, loop) {
    if (!rig || rig.anim === name) return;
    rig.anim = name;
    rig.state.setAnimation(0, name, loop);
  }

  // Fills the play area with a picture (cover), centred on fx of its width.
  function cover(image, fx, alpha) {
    if (!image) return;
    var s = Math.max(FULL_W / image.width, FULL_H / image.height);
    var w = image.width * s, h = image.height * s;
    var x = -LEFT + Math.min(0, Math.max(FULL_W - w, FULL_W * 0.5 - w * fx)), y = -TOP + (FULL_H - h) / 2;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(image, x, y, w, h);
    ctx.globalAlpha = 1;
  }
  // A strip repeated across the whole width, scrolled by x0; (y, h) = its place and height.
  function strip(image, x0, y, h) {
    if (!image) return;
    var w = image.width * (h / image.height);
    for (var x = -(((x0 % w) + w) % w) - LEFT; x < W; x += w) ctx.drawImage(image, x, y, w, h);
  }

  // ---- penguin size and place ------------------------------------------------------------
  function penguinScale() { return (H * 0.3) / (rigs.penguin ? rigs.penguin.h : 1086); }
  function trackGeom() { // the ice track strip: its height and the y of its surface
    var th = H * 0.36, ty = H * 0.86 - th * 0.267; // surface (first opaque row) at 86 % of the play area
    return { y: ty, h: th, surface: H * 0.86 };
  }
  function villageGeom() { // the village strip: its ice road band is at 67–73 % of its height
    var vh = Math.max(H * 0.95, W * (521 / 2200)), vy = H * 1.0 - vh * 0.82;
    return { y: vy, h: vh, road: vy + vh * 0.705 };
  }
  function penguinPos(now) {
    var ground = scene.world === 'village' ? villageGeom().road : trackGeom().surface;
    return { x: W * 0.36, y: ground + Math.sin(now / 260) * H * 0.006 };
  }

  // ---- the world --------------------------------------------------------------------------
  var rocks = [];
  for (var ri = 0; ri < 4; ri++) rocks.push({ k: [2, 4, 5, 7][ri], x: ri / 4 + Math.random() * 0.2, y: 0.04 + Math.random() * 0.3, s: 0.05 + Math.random() * 0.05, v: 0.3 + Math.random() * 0.7, r: Math.random() * 6, rv: (Math.random() - 0.5) * 0.0012 });
  var stars = [];
  for (var si = 0; si < 60; si++) stars.push({ x: Math.random(), y: Math.random() * 0.7, r: 0.6 + Math.random() * 1.3, t: Math.random() * 6 });

  function drawSpace(dt, now, speed) {
    cover(img.space, 0.5);
    // star dust drifting slowly
    if (img.stars) {
      var sh = FULL_H, sw = img.stars.width * (sh / img.stars.height), sx = -(((now * 0.01) % sw) + sw) % sw - LEFT;
      ctx.globalAlpha = 0.8;
      for (var x = sx; x < W; x += sw) ctx.drawImage(img.stars, x, -TOP, sw, sh);
      ctx.globalAlpha = 1;
    }
    // the Earth below, getting closer as the multiplier climbs to the dive
    if (img.earth) {
      var m = S.phase === 'flying' ? game.currentMult() : 1;
      var near = clamp01((m - 1) / (SHIFT_AT - 1));
      var shift = scene.shiftAt ? ease((now - scene.shiftAt) / SHIFT_MS) : 0;
      var rad = H * (0.62 + 0.25 * near) * (1 + 3 * shift);
      ctx.save();
      ctx.translate(W * 0.72, H * 1.05 + rad * 0.2 - H * 0.25 * shift);
      ctx.rotate(now * 0.00004);
      ctx.drawImage(img.earth, -rad, -rad, rad * 2, rad * 2);
      ctx.restore();
    }
    // asteroids drifting past (behind the track)
    rocks.forEach(function (rk) {
      var im = img['rock' + rk.k];
      if (!im) return;
      rk.x -= (speed * 0.15 * rk.v * dt) / 1000 / FULL_W;
      rk.r += rk.rv * dt;
      if (rk.x < -0.25) { rk.x = 1.15 + Math.random() * 0.3; rk.y = 0.04 + Math.random() * 0.3; }
      var sz = H * rk.s * 1.6;
      ctx.save();
      ctx.translate(rk.x * FULL_W - LEFT, rk.y * H);
      ctx.rotate(rk.r);
      ctx.drawImage(im, -sz / 2, -sz / 2, sz, sz * (im.height / im.width));
      ctx.restore();
    });
    var tg = trackGeom();
    strip(img.track, scene.trackX, tg.y, tg.h);
  }

  function drawVillage(dt, now) {
    var vg = villageGeom();
    // sky: deep blue down to exactly the village picture's own sky colour at its top edge
    var g = ctx.createLinearGradient(0, -TOP, 0, vg.y + 2);
    g.addColorStop(0, 'rgb(2, 70, 190)');
    g.addColorStop(1, 'rgb(4, 119, 253)');
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, -TOP, FULL_W, vg.y + TOP + 2);
    // the village (two pictures in turn) scrolling past
    var w = img.village1 ? img.village1.width * (vg.h / img.village1.height) : W;
    var base = -(((scene.villageX % (2 * w)) + 2 * w) % (2 * w)) - LEFT;
    for (var x = base, i = 0; x < W; x += w, i++) {
      var im = i % 2 ? img.village2 : img.village1;
      if (im) ctx.drawImage(im, x, vg.y, w + 1, vg.h);
    }
    // dusk, then a starry night as the multiplier climbs (one tint over the whole scene)
    var m = S.phase === 'flying' ? game.currentMult() : S.crashPoint || 1;
    var target = clamp01((Math.log(Math.max(1, m)) / Math.LN10 - 0.6) / 0.48); // 4x → 0 (dusk starts), 12x → 1 (night)
    scene.night += (target - scene.night) * Math.min(1, dt / 400);
    var n = scene.night;
    if (n > 0.01) {
      var dusk = clamp01(n * 2), night = clamp01(n * 2 - 1);
      ctx.fillStyle = 'rgba(255, 110, 60, ' + (0.22 * dusk * (1 - night)) + ')';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      ctx.fillStyle = 'rgba(6, 12, 48, ' + (0.62 * night) + ')';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      if (night > 0) {
        stars.forEach(function (st) {
          ctx.globalAlpha = night * (0.5 + 0.5 * Math.sin(now / 500 + st.t));
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(st.x * FULL_W - LEFT, st.y * (vg.y + TOP) - TOP, st.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---- phases -------------------------------------------------------------------------------
  // The start scene's backdrop panel ('Layer 2', rig units, measured): it fills the play area.
  // The gate and slingshot sit in its left part (≈ 16 % across), so narrow screens crop the right.
  var GATE_BOX = { x: -877, y: -54, w: 1746, h: 1088 };
  function drawGate(dt, alpha) { // the start scene: penguin in the slingshot at the ice gate
    var g = rigs.gate;
    if (!g) return;
    var s = Math.max(W / GATE_BOX.w, (H + TOP) / GATE_BOX.h);
    drawRig(g, 0, H, s, GATE_BOX.x, GATE_BOX.y, dt, alpha); // backdrop's bottom-left at the play area's bottom-left
  }

  function drawCountdown() {
    if (S.phase !== 'betting') return;
    var left = Math.max(0, (S.bettingEndsAt - Date.now()) / 1000), n = Math.ceil(left);
    var pop = 1 + 0.25 * Math.max(0, n - left - 0.75) * 4; // a little pop as each number appears
    var fs = Math.round(Math.min(W * 0.24, H * 0.32) * Math.min(pop, 1.25));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + fs + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.lineWidth = Math.max(4, fs * 0.08);
    ctx.strokeStyle = '#0a3d7a';
    ctx.shadowColor = 'rgba(95, 211, 255, 0.8)';
    ctx.shadowBlur = 18;
    var gr = ctx.createLinearGradient(0, H * 0.4 - fs / 2, 0, H * 0.4 + fs / 2);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, '#8fe3ff');
    ctx.fillStyle = gr;
    if (n > 0) { ctx.strokeText(String(n), W * 0.62, H * 0.4); ctx.fillText(String(n), W * 0.62, H * 0.4); }
    ctx.shadowBlur = 0;
    var ps = Math.round(Math.max(13, H * 0.05));
    ctx.font = '800 ' + ps + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(4, 20, 60, 0.85)';
    ctx.fillStyle = '#fff';
    var label = S.bettingPhrase.toUpperCase();
    ctx.strokeText(label, W * 0.62, H * 0.4 + fs * 0.62);
    ctx.fillText(label, W * 0.62, H * 0.4 + fs * 0.62);
    ctx.restore();
  }

  function drawRun(dt, now) {
    if (!scene.startAt) { scene.startAt = now - 99999; scene.launchEnd = now - 1; } // joined mid-run
    var m = game.currentMult();
    if (scene.world === 'space' && !scene.shiftAt && m >= SHIFT_AT && now > scene.launchEnd) {
      scene.shiftAt = now; play('descent'); // the dive down to the Earth
      setAnim(rigs.penguin, 'shift to earth', false);
    }
    if (scene.shiftAt && now - scene.shiftAt > SHIFT_MS && scene.world !== 'village') {
      scene.world = 'village';
      setAnim(rigs.penguin, 'Idel', true);
    }
    if (scene.startAt < now - 99000 && m >= SHIFT_AT) scene.world = 'village';

    var speed = W * 0.45 * (1 + Math.log(Math.max(1, m)));
    scene.trackX += (speed * dt) / 1000;
    scene.villageX += (speed * 0.8 * dt) / 1000;
    if (scene.world === 'village') drawVillage(dt, now);
    else drawSpace(dt, now, speed);

    var launchK = clamp01((now - scene.startAt) / (scene.launchEnd - scene.startAt));
    if (launchK < 1) { drawGate(dt, 1); return; } // the slingshot shot, then the ride
    // a short white flash as the ride appears, and while diving into the Earth's sky
    var flash = clamp01(1 - (now - scene.launchEnd) / 350);
    if (scene.shiftAt) {
      var t = (now - scene.shiftAt) / SHIFT_MS;
      flash = Math.max(flash, t < 1 ? clamp01((t - 0.55) / 0.45) : clamp01(1 - (t - 1) * 3));
    }

    // jumps now and then (the rig lifts the penguin; it lands back on the track / road)
    if (now > scene.nextJump && rigs.penguin && rigs.penguin.anim === 'Idel' && (!scene.shiftAt || scene.world === 'village')) {
      scene.nextJump = now + 3500 + Math.random() * 3500;
      rigs.penguin.anim = 'jump';
      rigs.penguin.state.setAnimation(0, Math.random() < 0.5 ? 'jump' : 'jum and back down', false);
      rigs.penguin.state.addAnimation(0, 'Idel', true, 0).listener = { start: function () { rigs.penguin.anim = 'Idel'; play('land'); } };
      play('jump');
    }
    var p = penguinPos(now), ps = penguinScale(), pg = rigs.penguin;
    if (pg && !(scene.shiftAt && now - scene.shiftAt > SHIFT_MS * 0.9 && scene.world !== 'village')) {
      drawRig(pg, p.x, p.y, ps, pg.x + pg.w * 0.5, pg.y, dt);
    }
    if (flash > 0) { ctx.fillStyle = 'rgba(235, 248, 255, ' + flash + ')'; ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H); }
  }

  function drawCrashScene(dt, now) {
    if (scene.crashIn === 'village') drawVillage(dt, now); else drawSpace(dt, now, 0);
    var c = rigs.crash, p = scene.crashPos || penguinPos(now);
    if (!c) return;
    // the wipe-out, same size as the riding penguin (its first pose is the penguin on the tube)
    var s = (penguinScale() * (rigs.penguin ? rigs.penguin.h : 1086) * 0.9) / c.h;
    drawRig(c, p.x, p.y, s, c.x + c.w * 0.5, c.y, dt);
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0;
  function themeColour() {
    if (S.phase === 'flying' && scene.world === 'village') {
      var n = scene.night, c = [2, 70, 190];
      c = c.map(function (v, i) { return Math.round(v * (1 - 0.62 * clamp01(n * 2 - 1)) + [6, 12, 48][i] * 0.62 * clamp01(n * 2 - 1)); });
      return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    }
    return '#050b20'; // space / the start scene
  }

  function frame(now) {
    if (now - themeAt > 400) { themeAt = now; game.theme(themeColour()); }
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    if (W && H) {
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      ctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
      ctx.fillStyle = '#050b20';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
      if (S.phase === 'flying') drawRun(dt, now);
      else if (S.phase === 'crashed') drawCrashScene(dt, now);
      else { drawGate(dt, 1); drawCountdown(); }
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

  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); play('click'); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem('sledrush-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
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
