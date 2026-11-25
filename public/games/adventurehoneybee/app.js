/* Adventure Honey Bee — NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is
 * the look: the honey tunnel while bets are open (Spine rig "scene2"), the bee flying off down
 * the honey road at take-off, then the side-scrolling flight over the meadow (bee + birds from
 * the Spine rig "honeybee2"; scrolling ground strip, clouds, sun → sunset → night), birds
 * swooping in (the bee dodges) and, at the crash, one bird catching the bee. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0023', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- assets
  var img = {};
  var rigs = {}; // name → { skeleton, state }
  var renderer = null;
  var assetsReady = false;

  function loadImage(name, src) {
    return new Promise(function (resolve) {
      var i = new Image();
      i.onload = function () { img[name] = i; resolve(); };
      i.onerror = function () { resolve(); };
      i.src = src;
    });
  }
  function loadRigs() {
    return new Promise(function (resolve) {
      var am = new spine.AssetManager('assets/spine/');
      ['honeybee2', 'scene2'].forEach(function (n) { am.loadText(n + '.json'); am.loadTextureAtlas(n + '.atlas'); });
      (function wait() {
        if (am.hasErrors()) return resolve();
        if (!am.isLoadingComplete()) return requestAnimationFrame(wait);
        ['honeybee2', 'scene2'].forEach(function (n) {
          var data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(am.require(n + '.atlas'))).readSkeletonData(am.require(n + '.json'));
          var skeleton = new spine.Skeleton(data);
          skeleton.scaleY = -1; // canvas is y-down
          var stateData = new spine.AnimationStateData(data);
          stateData.defaultMix = 0.15;
          rigs[n] = { skeleton: skeleton, state: new spine.AnimationState(stateData), anim: '' };
        });
        rigs.scene2.state.setAnimation(0, 'IDLE', true);
        rigs.honeybee2.state.setAnimation(0, 'idle', true);
        resolve();
      })();
    });
  }
  Promise.all([loadRigs(), loadImage('ground', 'assets/ground.webp'), loadImage('clouds', 'assets/clouds.webp'), loadImage('sun', 'assets/sun.webp')])
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
  try { soundOn = localStorage.getItem('honeybee-sound') !== 'off'; } catch (e) { /* default on */ }
  var sounds = {};
  var LOOPS = { 'wait-loop': 0.45, 'run-loop': 0.45 };
  ['crash', 'dodge_01', 'dodge_02', 'dodge_03', 'wait-loop', 'run-loop'].forEach(function (n) {
    var a = new Audio('assets/sounds/' + n + '.mp3');
    a.preload = LOOPS[n] ? 'none' : 'auto'; // the long loops download when first played
    if (LOOPS[n]) { a.loop = true; a.volume = LOOPS[n]; }
    sounds[n] = a;
  });
  function play(n) {
    if (!soundOn || !sounds[n]) return;
    try { sounds[n].volume = LOOPS[n] || 1; if (!LOOPS[n]) sounds[n].currentTime = 0; var p = sounds[n].play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* blocked */ }
  }
  function stop(n) { try { sounds[n].pause(); } catch (e) { /* ignore */ } }
  // A sound tied to an animation ends with it: fade it out over 150 ms.
  function fadeOut(n) {
    var a = sounds[n];
    if (!a || a.paused) return;
    var v = a.volume, steps = 6, i = 0;
    var t = setInterval(function () {
      i++;
      a.volume = Math.max(0, v * (1 - i / steps));
      if (i >= steps) { clearInterval(t); a.pause(); a.volume = v; }
    }, 25);
  }
  // The loop that belongs to the current phase: waiting (bets open) or running (flight).
  function syncLoops() {
    var want = !soundOn ? '' : S.phase === 'betting' ? 'wait-loop' : S.phase === 'flying' ? 'run-loop' : '';
    ['wait-loop', 'run-loop'].forEach(function (n) {
      if (n === want) { if (sounds[n].paused) play(n); } else if (!sounds[n].paused) stop(n);
    });
  }

  // Background music: its own on/off (saved). Starts as the game opens (the tap that opened the
  // game allows it); where a browser still blocks it, it starts on the first tap in the game.
  var musicOn = true;
  try { musicOn = localStorage.getItem('honeybee-music') !== 'off'; } catch (e) { /* default on */ }
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
  window.addEventListener('pointerdown', function () { if (!tapped) { tapped = true; syncMusic(); syncLoops(); } }, true);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (music) music.pause(); ['wait-loop', 'run-loop'].forEach(stop); } else { syncMusic(); syncLoops(); }
  });
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('honeybee-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    syncLoops();
  }

  // ---------------------------------------------------------------- engine moments
  // Timeline of a round (ms): the take-off down the honey road (scene2 "SCENE"), then the side
  // view: the bee flies in ("begining") and keeps flying ("idle"), birds swoop in now and then
  // ("… dodging"); at the crash a bird catches the bee ("… kill", as long as the crash sound).
  var ROAD_MS = 2670, ENTER_MS = 1670, DODGE_MS = 1670, CRASH_SOUND_MS = 2460;
  var BIRDS = [
    { dodge: 'blue dodging', kill: 'blue  kill', sound: 'dodge_01' },
    { dodge: 'green dodging', kill: 'green killing', sound: 'dodge_02' },
    { dodge: 'hunter dodging', kill: 'hunter kill', sound: 'dodge_03' },
  ];
  var scene = { startAt: 0, crashAt: 0, view: 'tunnel', dodgeAt: 0, dodge: null, lastT: 0, alt: 0, groundX: 0, cloudX: 0 };

  function setAnim(rig, name, loop, timeScale) {
    var r = rigs[rig];
    if (!r || r.anim === name) return;
    r.anim = name;
    var e = r.state.setAnimation(0, name, loop);
    e.timeScale = timeScale || 1;
  }

  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'betting') {
      scene.startAt = 0; scene.crashAt = 0; scene.view = 'tunnel'; scene.dodge = null;
      setAnim('scene2', 'IDLE', true);
    }
    if (name === 'start') {
      scene.startAt = now; scene.view = 'tunnel';
      setAnim('scene2', 'SCENE', false);
      scene.dodgeAt = now + ROAD_MS + ENTER_MS + 2500 + Math.random() * 3000;
    }
    if (name === 'crash') {
      scene.crashAt = now;
      if (scene.dodge) { fadeOut(scene.dodge.sound); }
      var bird = scene.dodge ? scene.dodge : BIRDS[Math.floor(Math.random() * BIRDS.length)];
      scene.dodge = null;
      scene.view = 'side';
      // the catch lasts exactly as long as the crash sound (they end together)
      setAnim('honeybee2', bird.kill, false, DODGE_MS / CRASH_SOUND_MS);
      play('crash');
    }
    if (name === 'win') { toast(d.text, 'win'); }
    if (name === 'error') toast(d.text, 'error');
    syncLoops();
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
    av.style.backgroundSize = (4 * cell) + 'px ' + cell + 'px';
    av.style.backgroundPosition = (-k * cell) + 'px 0';
    return av;
  }

  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'), { face: playerFace });
    playersStrip.update(S);
    maybeReady();
    syncLoops();
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

  // ---- bet panels (slot 0 and 1; the phone shows one) --------------------------------
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="panel__inner">' +
      '<div class="panel__label">Bet amount</div>' +
      '<div class="stepper"><button type="button" class="stepper__btn" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<input class="amount" inputmode="decimal" value="1.00" aria-label="Bet amount">' +
      '<button type="button" class="stepper__btn" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<button type="button" class="action"><span class="action__label">Bet</span><small class="action__sub"></small></button>' +
      '<div class="auto"><span>Auto Cash Out</span>' +
      '<label class="switch"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="switch__track"><span class="switch__knob"></span></span></label>' +
      '<input class="auto__x" inputmode="decimal" value="1.50" aria-label="Auto cash-out multiplier"></div>' +
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
    var amount = readAmount(p);
    Array.prototype.forEach.call(p.quick.children, function (b) {
      var on = Number(b.dataset.v) === amount;
      if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
    });
  }

  function avatarIndex(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 4;
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
        av.style.backgroundPosition = (-avatarIndex(b.player) * 34) + 'px 0';
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
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var W = 0, H = 0, DPR = 1;
  // The scene fills the whole stage (under the floating top bar, behind the bets list on wide
  // screens); the bee and the birds stay in the play area (LEFT / TOP offsets).
  var TOP = 0, FULL_H = 0, LEFT = 0, FULL_W = 0;

  function fit() {
    var r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    FULL_W = r.width; FULL_H = r.height;
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    W = FULL_W - LEFT;
    stageEl.style.setProperty('--left', LEFT + 'px');
    var bar = document.querySelector('.top').getBoundingClientRect();
    TOP = Math.max(0, bar.bottom - r.top + 6);
    // The results row (and on wide screens the bet panels) float over the scene's lower part:
    // the play area ends just above the results row; the scene fades out below it.
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(120, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // The multiplier / round texts are centred on the play area (not the whole scene).
    var centre = document.querySelector('.stage__center').style;
    centre.left = LEFT + 'px'; centre.top = TOP + 'px'; centre.width = W + 'px'; centre.height = H + 'px';
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a player joins the round).
    var bufW = Math.round(FULL_W * DPR), bufH = Math.round(FULL_H * DPR);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.imageSmoothingQuality = 'high';
    if (!renderer && window.spine) { renderer = new spine.SkeletonRenderer(ctx); renderer.triangleRendering = true; }
  }

  // Rig geometry (skeleton units, measured from the rendered pixels):
  // honeybee2 — the bee flies centred at (937, 840), 104 units tall; the meadow slots are ours
  // to replace (we draw a scrolling world instead); scene2 — the honey tunnel spans
  // x −1239…1328, y −1074…10, the bee hovering at about x 245.
  var BEE_X = 937, BEE_Y = 840, BEE_H = 104;
  var MEADOW = { 'mountain': 1, 'honey stone 1': 1, 'honeystone 2': 1, 'honeystone 3': 1 };
  var TUNNEL = { x0: -1239, x1: 1328, y0: -1074, y1: 10, focus: 150 };
  // ground strip: grass line at 66.2 % of its height (the honey road just below)
  var GRASS = 0.662;

  function drawRig(name, dt, hideMeadow) {
    var r = rigs[name];
    if (!r || !renderer) return;
    r.state.update(dt / 1000);
    r.state.apply(r.skeleton);
    r.skeleton.updateWorldTransform(spine.Physics.update);
    if (hideMeadow) r.skeleton.slots.forEach(function (sl) { if (MEADOW[sl.data.name]) sl.appliedPose.color.a = 0; });
    renderer.draw(r.skeleton);
  }

  // ---- the sky: day → sunset → night as the multiplier climbs ---------------------------
  var SKY = [ // [top, bottom]
    [[62, 168, 245], [178, 226, 255]], // day (matches the meadow's blue sky)
    [[236, 120, 72], [255, 206, 140]], // sunset
    [[16, 20, 64], [62, 52, 118]], // night
  ];
  var stars = [];
  for (var si = 0; si < 70; si++) stars.push({ x: Math.random(), y: Math.random() * 0.6, r: 0.6 + Math.random() * 1.4, t: Math.random() * 6 });
  function climb() { // 0 at 1x … 1 at about 10x
    if (S.phase === 'flying') return Math.min(1, Math.log(Math.max(1, game.currentMult())) / Math.log(10));
    if (S.phase === 'crashed') return Math.min(1, Math.log(Math.max(1, S.crashPoint)) / Math.log(10));
    return 0;
  }
  function mix(a, b, k) { return Math.round(a + (b - a) * k); }
  function skyRGB(i, alt) {
    var st = alt < 0.5 ? 0 : 1, k = alt < 0.5 ? alt / 0.5 : (alt - 0.5) / 0.5;
    var c0 = SKY[st][i], c1 = SKY[st + 1][i];
    return [mix(c0[0], c1[0], k), mix(c0[1], c1[1], k), mix(c0[2], c1[2], k)];
  }
  function rgb(c) { return 'rgb(' + c.join(',') + ')'; }

  function tile(im, x0, y, h) { // a strip repeated across the whole stage, scrolled by x0
    if (!im) return;
    var w = im.width * (h / im.height);
    var x = -(((x0 % w) + w) % w) - LEFT;
    for (; x < W; x += w) ctx.drawImage(im, x, y, w, h);
  }

  function drawSide(dt, now) {
    scene.alt += (climb() - scene.alt) * Math.min(1, dt / 350);
    var alt = scene.alt;
    var flying = S.phase === 'flying';
    if (flying) {
      var speed = H * 0.55 * (1 + alt * 1.5);
      scene.groundX += speed * dt / 1000;
      scene.cloudX += speed * 0.12 * dt / 1000;
    }
    // sky (all the way up under the bar and behind the bets list)
    var g = ctx.createLinearGradient(0, -TOP, 0, H * 0.75);
    g.addColorStop(0, rgb(skyRGB(0, alt)));
    g.addColorStop(1, rgb(skyRGB(1, alt)));
    ctx.fillStyle = g;
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    // sun by day, stars + moon by night
    var day = Math.max(0, 1 - alt / 0.55), night = Math.max(0, Math.min(1, (alt - 0.6) / 0.3));
    if (img.sun && day > 0) {
      var ss = H * 0.42;
      ctx.globalAlpha = day;
      ctx.drawImage(img.sun, W * 0.8 - ss / 2, H * 0.12 - ss / 2 + alt * H * 0.5, ss, ss * img.sun.height / img.sun.width);
      ctx.globalAlpha = 1;
    }
    if (night > 0) {
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.5 + 0.5 * Math.sin(now / 500 + st.t));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(st.x * FULL_W - LEFT, st.y * FULL_H - TOP, st.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = night;
      var mg = ctx.createRadialGradient(W * 0.8, H * 0.16, 2, W * 0.8, H * 0.16, H * 0.14);
      mg.addColorStop(0, 'rgba(255, 246, 220, 1)');
      mg.addColorStop(0.38, 'rgba(255, 238, 200, 0.95)');
      mg.addColorStop(0.45, 'rgba(255, 230, 180, 0.25)');
      mg.addColorStop(1, 'rgba(255, 230, 180, 0)');
      ctx.fillStyle = mg;
      ctx.fillRect(W * 0.6, 0, W * 0.4, H * 0.35);
      ctx.globalAlpha = 1;
    }
    // clouds (slow) and the ground strip (fast): the meadow, honey towers and the honey road
    ctx.globalAlpha = 0.95 - night * 0.5;
    tile(img.clouds, scene.cloudX, -TOP, (H + TOP) * 0.55);
    ctx.globalAlpha = 1;
    var G = H * 0.62, grassY = H * 0.72, groundBottom = grassY + (1 - GRASS) * G;
    tile(img.ground, scene.groundX, grassY - GRASS * G, G);
    // the earth continues below the strip (its own bottom colour, darkening) down into the fade
    var eg = ctx.createLinearGradient(0, groundBottom - 1, 0, FULL_H - TOP);
    eg.addColorStop(0, 'rgb(88, 47, 22)');
    eg.addColorStop(1, 'rgb(40, 20, 6)');
    ctx.fillStyle = eg;
    ctx.fillRect(-LEFT, groundBottom - 1, FULL_W, FULL_H - TOP - groundBottom + 1);
    // evening / night light over the land (no seams: one tint over everything)
    var dusk = Math.min(1, alt / 0.5) * 0.25 + night * 0.35;
    if (dusk > 0) {
      ctx.fillStyle = 'rgba(30, 20, 70,' + dusk.toFixed(3) + ')';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    }
    // the bee (and the birds), from the rig, flying just above the honey road
    var s = (Math.max(56, H * 0.22)) / BEE_H;
    var bx = W * 0.3, by = grassY + G * 0.04;
    ctx.save();
    ctx.translate(bx - BEE_X * s, by - BEE_Y * s);
    ctx.scale(s, s);
    drawRig('honeybee2', dt, true);
    ctx.restore();
  }

  function drawTunnel(dt) {
    // the honey tunnel covers the whole stage (stage coordinates)
    var tw = TUNNEL.x1 - TUNNEL.x0, th = TUNNEL.y1 - TUNNEL.y0;
    var s = Math.max(FULL_W / tw, FULL_H / th);
    var mid = LEFT + W / 2; // centred on the play area, still covering the whole stage
    var cx = Math.min(TUNNEL.x1 - (FULL_W - mid) / s, Math.max(TUNNEL.x0 + mid / s, TUNNEL.focus));
    ctx.save();
    ctx.translate(-LEFT, -TOP);
    ctx.translate(mid - cx * s, FULL_H - TUNNEL.y1 * s);
    ctx.scale(s, s);
    drawRig('scene2', dt, false);
    ctx.restore();
    if (S.phase === 'betting') { // a warm dim while bets are open (the countdown sits on top)
      ctx.fillStyle = 'rgba(30, 16, 0, 0.22)';
      ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    }
  }

  // Browser bar colour = the colour at the top of the scene (read from the canvas, ≤ every 0.4 s).
  var themeAt = 0;
  function themeColour() {
    try {
      var d = ctx.getImageData(Math.floor(canvas.width * 0.6), 2, 1, 1).data;
      return '#' + [d[0], d[1], d[2]].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    } catch (e) { return ''; }
  }

  function frame(now) {
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    if (W && H && renderer) {
      // which view: the tunnel while bets are open and during the take-off down the road
      if (S.phase === 'flying') {
        if (!scene.startAt) { scene.startAt = now - ROAD_MS - ENTER_MS; scene.dodgeAt = now + 2500; } // joined mid-flight
        var t = now - scene.startAt;
        if (t >= ROAD_MS && scene.view === 'tunnel') {
          scene.view = 'side';
          if (t < ROAD_MS + ENTER_MS) setAnim('honeybee2', 'begining', false); else setAnim('honeybee2', 'idle', true);
        }
        if (scene.view === 'side') {
          var r = rigs.honeybee2;
          if (r && r.anim === 'begining' && t >= ROAD_MS + ENTER_MS) setAnim('honeybee2', 'idle', true);
          // a bird swoops in now and then; its sound ends with the dodge
          if (!scene.dodge && now >= scene.dodgeAt) {
            scene.dodge = BIRDS[Math.floor(Math.random() * BIRDS.length)];
            scene.dodge.until = now + DODGE_MS;
            setAnim('honeybee2', scene.dodge.dodge, false);
            play(scene.dodge.sound);
          }
          if (scene.dodge && now >= scene.dodge.until) {
            fadeOut(scene.dodge.sound);
            scene.dodge = null;
            scene.dodgeAt = now + 3500 + Math.random() * 4000;
            setAnim('honeybee2', 'idle', true);
          }
        }
      } else if (S.phase === 'betting' || S.phase === 'waiting') {
        scene.view = 'tunnel';
        setAnim('scene2', 'IDLE', true);
      }
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, FULL_W, FULL_H);
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      if (scene.view === 'tunnel') drawTunnel(dt); else drawSide(dt, now);
      if (now - themeAt > 400) { themeAt = now; var c = themeColour(); if (c) game.theme(c); }
    }
    // texts over the scene
    var mult = $('mult'), hint = $('hint'), flew = $('flew'), cd = $('countdown');
    flew.hidden = S.phase !== 'crashed';
    if (!flew.hidden && flew.textContent !== S.crashPhrase) flew.textContent = S.crashPhrase;
    var off = S.phase !== 'betting'; // the pill + ring show only while bets are open
    if (cd.classList.contains('countdown--off') !== off) { cd.classList.toggle('countdown--off', off); cd.setAttribute('aria-hidden', String(off)); }
    if (S.phase === 'betting') {
      var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
      var left = Math.max(0, S.bettingEndsAt - Date.now());
      var secs = String(Math.ceil(left / 1000)).padStart(2, '0');
      if ($('secs').textContent !== secs) $('secs').textContent = secs;
      $('ring').style.strokeDashoffset = String(276.5 * (1 - left / total));
      if ($('phrase').textContent !== S.bettingPhrase) $('phrase').textContent = S.bettingPhrase;
      mult.textContent = ''; hint.textContent = '';
    } else if (S.phase === 'flying') {
      mult.className = 'mult'; mult.textContent = game.currentMult().toFixed(2) + 'x'; hint.textContent = '';
      if (S.my[0] || S.my[1]) updateButtons(); // live cash-out amounts
    } else if (S.phase === 'crashed') {
      mult.className = 'mult mult--crashed'; mult.textContent = S.crashPoint.toFixed(2) + 'x'; hint.textContent = '';
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
      b.dataset.v = String(v);
      b.textContent = game.money(v).replace(/\.00$/, '');
      b.onclick = function () { setAmount(p, v); };
      p.quick.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { panels.forEach(function (p) { buildQuick(p); setAmount(p, l.min); }); });

  panels.forEach(function (p) {
    Array.prototype.forEach.call(p.el.querySelectorAll('.stepper__btn'), function (b) {
      b.onclick = function () { setAmount(p, readAmount(p) + Number(b.dataset.step) * game.limit().min); };
    });
    p.amount.oninput = function () { updateButton(p); };
    p.amount.onblur = function () { setAmount(p, readAmount(p) || game.limit().min); };
    p.action.onclick = function () {
      if (S.queued[p.slot]) return game.cancelQueued(p.slot);
      var my = S.my[p.slot];
      if (my && my.round === S.round && my.status === 'placed' && S.phase === 'flying') return game.cashOut(p.slot);
      if (my && my.round === S.round && my.status !== 'lost' && my.status !== 'cashed') return;
      game.bet(p.slot, readAmount(p), readAuto(p));
    };
  });

  $('back').onclick = function () { game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem('honeybee-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
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
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
