/* Ali Baba — NEXORNG crash game. Game logic: ../_core/crash-client.js; this file is the look:
 * the cave at dusk while bets are open, the door opening as the round starts, Ali Baba and his
 * donkey running from the forty thieves across the desert (day → sunset → night as the
 * multiplier climbs), the fight when they are caught, and the bet panels / bets list. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: '88.0032', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- assets
  var SHEETS = ['alibabaRun', 'alibabaIdle', 'donkeyRun', 'donkeyIdle', 'thief1', 'thief2', 'thief3', 'thief4', 'fight', 'cave'];
  var sheets = {};
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
  Promise.all(SHEETS.map(function (name) {
    return Promise.all([
      fetch('assets/sprites/' + name + '.json').then(function (r) { return r.json(); }),
      loadImage('assets/sprites/' + name + '.webp'),
    ]).then(function (res) { sheets[name] = { meta: res[0], img: res[1] }; });
  }).concat(['desert', 'cactus', 'cactusLeft', 'cactusRight', 'logo'].map(function (n) {
    return loadImage('assets/' + n + '.webp').then(function (im) { img[n] = im; });
  })))
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
  try { soundOn = localStorage.getItem('alibaba-sound') !== 'off'; } catch (e) { /* default on */ }
  var sounds = {};
  ['click', 'cashout', 'caveOpen', 'khuljaaSimSim', 'fight', 'bodyFall', 'running'].forEach(function (n) {
    var a = new Audio('assets/sounds/' + n + '.mp3');
    a.preload = n === 'running' ? 'metadata' : 'auto';
    if (n === 'running') { a.loop = true; a.volume = 0.45; }
    sounds[n] = a;
  });
  var fading = {};
  function play(n) {
    if (!soundOn || !sounds[n]) return;
    clearInterval(fading[n]);
    try {
      sounds[n].volume = n === 'running' ? 0.45 : 1;
      sounds[n].currentTime = 0;
      var p = sounds[n].play(); if (p && p.catch) p.catch(function () {});
    } catch (e) { /* blocked */ }
  }
  function stop(n) { clearInterval(fading[n]); try { sounds[n].pause(); } catch (e) { /* ignore */ } }
  // A sound belongs to its scene: when the scene is over the sound goes with it (a short fade, not
  // a cut). The fight is 8.5 s of sound for 3 s of picture, the cave door 7.7 s.
  function fadeOut(n) {
    var a = sounds[n], steps = 6;
    clearInterval(fading[n]);
    if (!a || a.paused) return;
    fading[n] = setInterval(function () {
      steps--;
      try { a.volume = Math.max(0, a.volume * 0.6); } catch (e) { /* a phone keeps its own volume */ }
      if (steps <= 0) stop(n);
    }, 50);
  }

  // Background music: its own on/off (saved). Starts as the game opens (the tap that opened the
  // game allows it); where a browser still blocks it, it starts on the first tap in the game.
  var musicOn = true;
  try { musicOn = localStorage.getItem('alibaba-music') !== 'off'; } catch (e) { /* default on */ }
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
    try { localStorage.setItem('alibaba-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    if (!on) Object.keys(sounds).forEach(stop); else if (S.phase === 'flying') play('running');
  }

  // ---------------------------------------------------------------- engine moments
  var scene = { startAt: 0, crashAt: 0, worldX: 0, caveX: 0, speed: 0, lastT: 0, alt: 0 };
  function onSignal(name, d) {
    if (name === 'start') {
      scene.startAt = performance.now();
      stop('fight'); stop('bodyFall');
      play('khuljaaSimSim');
      setTimeout(function () { if (S.phase === 'flying') play('caveOpen'); }, 250);
      setTimeout(function () { if (S.phase === 'flying') play('running'); }, 900);
    }
    if (name === 'crash') {
      scene.crashAt = performance.now();
      stop('running'); stop('khuljaaSimSim'); fadeOut('caveOpen');
      play('fight');
      setTimeout(function () { if (S.phase === 'crashed') play('bodyFall'); }, 900);
    }
    if (name === 'betting') { scene.startAt = 0; scene.crashAt = 0; fadeOut('fight'); fadeOut('bodyFall'); }
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
    setText($('balance'), S.balance == null ? '—' : game.money(S.balance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    var h = $('history');
    h.innerHTML = '';
    S.history.forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'chip' + (c >= 10 ? ' chip--big' : c >= 2 ? ' chip--mid' : '');
      s.textContent = c.toFixed(2) + 'x';
      h.appendChild(s);
    });

    updateButtons();
    renderList();

    setText($('fRound'), String(S.round || '—'));
    setText($('fHash'), S.hash || '—');
    setText($('fSeed'), S.seed || 'revealed when the round ends');
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
      '<div class="minmax"><button type="button" data-limit="min">MIN</button><button type="button" data-limit="max">MAX</button></div>' +
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

  // Phone: one bet panel only (owner's choice for Alibaba); wide screens show both.
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
    var players = {};
    S.bets.forEach(function (b) { players[b.player] = 1; });
    setText($('playerCount'), String(Object.keys(players).length));
    if (tab === 'all') {
      setText($('countLabel'), 'Total bets');
      setText($('betCount'), String(S.bets.length));
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
        av.style.backgroundPosition = (-(k % 7) * 32) + 'px ' + (-Math.floor(k / 7) * 32) + 'px';
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
  var ctx = canvas.getContext('2d');
  var fade = document.createElement('canvas'), fctx = fade.getContext('2d');
  var stageEl = document.querySelector('.stage');
  // W × H = the play area (below the floating top bar, above the results row); the scene
  // itself fills the whole stage: TOP px above the play area, FULL_H in all.
  // Wide screens: the scene spans the whole width, behind the bets list too; the play area
  // starts right of the list (LEFT). The world is drawn from -LEFT so it fills the width.
  var W = 0, H = 0, TOP = 0, FULL_H = 0, LEFT = 0, FULL_W = 0;

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
    // The results row (phone) / results + panels (wide) float over the scene's lower part: the
    // play area ends just above the results row and the scene fades out behind them.
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(120, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    // The multiplier / round texts are placed on the play area (not the whole scene).
    var texts = document.querySelector('.stage__center').style;
    texts.left = LEFT + 'px'; texts.top = TOP + 'px'; texts.width = W + 'px'; texts.height = H + 'px';
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
  // Background position as a fraction of the whole stage (in play-area coordinates).
  function by(f) { return -TOP + f * FULL_H; }

  // Draws frame i of a sprite sheet; (x, y) = top-left of the full (untrimmed) frame.
  function sprite(name, i, x, y, scale, alpha) {
    var s = sheets[name];
    if (!s || !s.img) return;
    var n = s.meta.frames.length, f = s.meta.frames[((i % n) + n) % n];
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(s.img, f[0], f[1], f[2], f[3], x + f[4] * scale, y + f[5] * scale, f[2] * scale, f[3] * scale);
    ctx.globalAlpha = 1;
  }
  function frames(name) { return sheets[name] ? sheets[name].meta.frames.length : 1; }
  function frameAt(t, fps) { return Math.floor(t / (1000 / fps)); }
  function ease(t) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); }
  function clamp(v) { return Math.max(0, Math.min(1, v)); }

  // Geometry (frame pixels, measured from the sprites): every character's feet are on its frame
  // box's bottom edge, all drawn at one scale; Ali Baba runs beside his donkey (same left edge).
  var DONKEY_H = 250, DONKEY_W = 300; // donkey frame box (Ali Baba: 300×215, thief: 175×215)
  var CAVE_W = 618, CAVE_H = 376, CAVE_DOOR_X = 427; // cave frame box, door centre
  var FIGHT_W = 330, FIGHT_H = 237;
  var START_MS = 1200; // door opens, the run speeds up
  var THIEVES_AT = 900; // thieves come out of the cave
  var CATCH_MS = 450; // thieves reach Ali Baba after the crash

  function ground() { return H * 0.96; }
  function unit() { return (H * 0.46) / DONKEY_H; } // character scale
  // Ali Baba + donkey left edge: by the cave while bets are open, then a little to the right.
  function groupX(now) {
    var s = unit(), rest = W * 0.38 - 40 * s, run = W * 0.62 - 150 * s;
    if (S.phase === 'betting' || S.phase === 'waiting') return rest;
    if (!scene.startAt) return run;
    return rest + (run - rest) * ease((now - scene.startAt) / (START_MS * 1.3));
  }

  // ---- world: day → sunset → night as the multiplier climbs ---------------------------
  var SKY = [ // [top, horizon] colours by stage
    [[56, 116, 226], [150, 215, 200]], // day — the desert picture's own sky
    [[78, 70, 150], [246, 158, 96]], // sunset
    [[12, 16, 44], [70, 52, 104]], // night
  ];
  var stars = [];
  for (var si = 0; si < 70; si++) stars.push({ x: Math.random(), y: Math.random() * 0.45, r: 0.6 + Math.random() * 1.4, t: Math.random() * 6 });

  function climb() { // 0 at 1x … 1 at about 10x
    if (S.phase === 'flying') return clamp(Math.log(Math.max(1, game.currentMult())) / Math.log(10));
    if (S.phase === 'crashed') return clamp(Math.log(Math.max(1, S.crashPoint)) / Math.log(10));
    return 0;
  }
  function mix(a, b, k) { return Math.round(a + (b - a) * k); }
  function skyColour(i, alt) {
    var st = alt < 0.5 ? 0 : 1, k = alt < 0.5 ? alt / 0.5 : (alt - 0.5) / 0.5;
    var c0 = SKY[st][i], c1 = SKY[st + 1][i];
    return [mix(c0[0], c1[0], k), mix(c0[1], c1[1], k), mix(c0[2], c1[2], k)];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function skyGradient(c) {
    var g = c.createLinearGradient(0, by(0), 0, by(0.55));
    g.addColorStop(0, rgb(skyColour(0, scene.alt)));
    g.addColorStop(1, rgb(skyColour(1, scene.alt)));
    return g;
  }
  // A strip picture repeated across the stage, scrolled by x0.
  function strip(im, x0, y, h) {
    if (!im) return;
    var w = im.width * (h / im.height);
    var x = -(((x0 % w) + w) % w) - LEFT;
    for (; x < W; x += w) ctx.drawImage(im, x, y, w, h);
  }
  // The picture's own sky turns into the changing sky: the same gradient is painted over the
  // sky part, strongest at the top and fading out smoothly before the horizon (no seam).
  function skyOver(strength) {
    if (strength <= 0) return;
    var top = by(0), fh = FULL_H * 0.64; // down to (and softly over) the mountains on the horizon
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
    fctx.fillStyle = skyGradient(fctx);
    fctx.fillRect(-LEFT, top, FULL_W, fh);
    var m = fctx.createLinearGradient(0, top, 0, top + fh);
    m.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
    m.addColorStop(0.72, 'rgba(0,0,0,' + strength * 0.96 + ')');
    m.addColorStop(0.86, 'rgba(0,0,0,' + strength * 0.55 + ')');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.globalCompositeOperation = 'destination-in';
    fctx.fillStyle = m;
    fctx.fillRect(-LEFT, top, FULL_W, fh);
    ctx.drawImage(fade, 0, 0, fade.width, fade.height, -LEFT, -TOP, FULL_W, FULL_H);
  }

  function drawWorld(dt, now) {
    scene.alt += (climb() - scene.alt) * Math.min(1, dt / 350);
    var alt = scene.alt;
    // run speed: builds up as the door opens, grows with the multiplier, stops at the catch
    var target = 0;
    if (S.phase === 'flying') target = H * 0.9 * (1 + alt * 0.6) * (scene.startAt ? ease((now - scene.startAt) / START_MS) : 1);
    scene.speed += (target - scene.speed) * Math.min(1, dt / (S.phase === 'crashed' ? 120 : 200));
    var move = scene.speed * dt / 1000;
    scene.worldX += move;
    if (S.phase === 'betting' || S.phase === 'waiting') { scene.worldX = 0; scene.caveX = 0; } else scene.caveX -= move;

    strip(img.desert, scene.worldX * 0.35, by(0), FULL_H); // the whole stage, under the bar too
    skyOver(clamp(alt / 0.3)); // day: the picture's own sky; later the changing sky
    var night = clamp((alt - 0.6) / 0.3);
    if (night > 0) {
      stars.forEach(function (st) {
        ctx.globalAlpha = night * (0.5 + 0.5 * Math.sin(now / 500 + st.t));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(st.x * FULL_W - LEFT, by(st.y), st.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = night;
      var my = by(0.16), mr = FULL_H * 0.11;
      var mg = ctx.createRadialGradient(W * 0.84, my, 2, W * 0.84, my, mr);
      mg.addColorStop(0, 'rgba(255, 246, 220, 1)');
      mg.addColorStop(0.35, 'rgba(255, 238, 196, 0.95)');
      mg.addColorStop(0.42, 'rgba(255, 224, 170, 0.25)');
      mg.addColorStop(1, 'rgba(255, 224, 170, 0)');
      ctx.fillStyle = mg;
      ctx.fillRect(W * 0.84 - mr, my - mr, mr * 2, mr * 2);
      ctx.globalAlpha = 1;
    }
    strip(img.cactus, scene.worldX * 0.8, H * 0.52, H * 0.4);
  }

  // Light of the time of day over the land and characters (sunset warm, night blue). It fades
  // in softly from the sky downwards — no edge anywhere.
  function tintLayer(r, g, b, a) {
    var grad = ctx.createLinearGradient(0, by(0.3), 0, by(0.66));
    grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(-LEFT, by(0.3), FULL_W, FULL_H);
  }
  function drawTint() {
    var alt = scene.alt;
    if (alt <= 0.02) return;
    var sunset = clamp(alt / 0.5) * (1 - clamp((alt - 0.5) / 0.5));
    var night = clamp((alt - 0.5) / 0.5);
    if (sunset > 0) tintLayer(255, 110, 40, 0.18 * sunset);
    if (night > 0) tintLayer(14, 20, 62, 0.5 * night);
  }

  function drawCave(now) {
    var cs = (H * 0.88) / CAVE_H;
    var x = W * 0.02 - CAVE_DOOR_X * cs * 0.55 + scene.caveX;
    if (x + CAVE_W * cs < 0) return;
    var t = scene.startAt ? now - scene.startAt : 0;
    var n = frames('cave');
    var i = S.phase === 'betting' || S.phase === 'waiting' ? 0 : Math.min(n - 1, Math.floor((t / (START_MS * 0.75)) * n));
    sprite('cave', i, x, ground() + H * 0.02 - CAVE_H * cs, cs);
  }
  function caveDoorX() {
    var cs = (H * 0.88) / CAVE_H;
    return W * 0.02 - CAVE_DOOR_X * cs * 0.55 + scene.caveX + CAVE_DOOR_X * cs;
  }

  function drawGroup(now, running) {
    var s = unit(), x = groupX(now), g = ground();
    var bob = running ? Math.sin(now / 90) * H * 0.004 : 0;
    sprite(running ? 'donkeyRun' : 'donkeyIdle', frameAt(now, running ? 30 : 24), x, g - DONKEY_H * s + bob, s);
    sprite(running ? 'alibabaRun' : 'alibabaIdle', frameAt(now, running ? 30 : 24), x, g - 215 * s, s);
  }

  // Four thieves behind Ali Baba (farthest first); they come out of the cave door, then keep up.
  function thiefSpots(now) {
    var s = unit(), gx = groupX(now), spots = [];
    var out = scene.startAt ? clamp((now - scene.startAt - THIEVES_AT) / 900) : 1;
    var caught = scene.crashAt ? ease((now - scene.crashAt) / CATCH_MS) : 0;
    for (var k = 3; k >= 0; k--) {
      var chase = gx - 215 * s - k * 56 * s + Math.sin(now / 520 + k * 1.7) * 10 * s; // a gap behind Ali Baba
      var x = caveDoorX() - 80 * s + (chase - (caveDoorX() - 80 * s)) * ease(out);
      x += (gx - 40 * s - x) * caught;
      spots.push({ k: k, x: x, show: out > 0 || !scene.startAt });
    }
    return spots;
  }
  function drawThieves(now) {
    var s = unit(), g = ground();
    thiefSpots(now).forEach(function (t) {
      if (t.show) sprite('thief' + (t.k + 1), frameAt(now + t.k * 70, 30), t.x, g - 215 * s, s);
    });
  }

  function drawFight(now) {
    var t = now - scene.crashAt - CATCH_MS * 0.6;
    if (t < 0) return false;
    var s = unit() * 1.25, n = frames('fight');
    var i = Math.floor(t / 50);
    if (i >= n) i = n - 8 + ((i - n) % 8); // keep the dust going
    var cx = groupX(now) + 60 * unit();
    sprite('fight', i, cx - (FIGHT_W * s) / 2, ground() + H * 0.02 - FIGHT_H * s, s);
    return t > 200; // the cloud now covers everyone
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

  // Bets open: dusk over the cave, the Ali Baba logo with its loading bar and this round's line.
  function drawBetting() {
    ctx.fillStyle = 'rgba(14, 22, 52, 0.55)';
    ctx.fillRect(-LEFT, -TOP, FULL_W, FULL_H);
    var lg = img.logo, cx = W * 0.5;
    var lw = Math.min(W * 0.62, H * 0.95), lh = lg ? lw * (lg.height / lg.width) : lw * 0.36;
    var ly = H * 0.12;
    if (lg) ctx.drawImage(lg, cx - lw / 2, ly, lw, lh);
    var total = Math.max(1, S.bettingEndsAt - S.bettingStartsAt);
    var p = S.phase === 'betting' ? clamp((Date.now() - S.bettingStartsAt) / total) : 0;
    var bw = lw * 0.82, bh = Math.max(14, H * 0.045), bx = cx - bw / 2, by = ly + lh + H * 0.03;
    roundRect(bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(120, 130, 150, 0.55)';
    ctx.fill();
    if (p > 0) {
      var inset = 3, fw = Math.max(bh - inset * 2, (bw - inset * 2) * (1 - p));
      roundRect(bx + inset, by + inset, fw, bh - inset * 2, (bh - inset * 2) / 2);
      var grad = ctx.createLinearGradient(0, by, 0, by + bh);
      grad.addColorStop(0, '#7ef6ff');
      grad.addColorStop(1, '#14c6e6');
      ctx.fillStyle = grad;
      ctx.fill();
    }
    roundRect(bx, by, bw, bh, bh / 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    if (S.phase === 'betting') {
      ctx.font = '800 ' + Math.round(Math.max(12, H * 0.042)) + 'px "Trebuchet MS", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10, 30, 60, 0.85)';
      ctx.fillStyle = '#fff';
      var label = S.bettingPhrase.toUpperCase();
      ctx.strokeText(label, cx, by + bh + H * 0.03);
      ctx.fillText(label, cx, by + bh + H * 0.03);
    }
  }

  // Browser bar colour = the colour at the top of the scene (sent at most every 0.4 s).
  var themeAt = 0;
  function themeColour() {
    var c = skyColour(0, scene.alt * clamp(scene.alt / 0.3)); // day: the picture's own sky
    if (S.phase === 'betting' || S.phase === 'waiting') c = c.map(function (v, i) { return Math.round(v * 0.45 + [14, 22, 52][i] * 0.55); });
    return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  var shown = { mult: '', multCls: '', hint: '' };
  function frame(now) {
    if (now - themeAt > 400) { themeAt = now; game.theme(themeColour()); }
    var dt = scene.lastT ? Math.min(100, now - scene.lastT) : 16;
    scene.lastT = now;
    if (W && H) {
      ctx.save();
      ctx.translate(LEFT, TOP); // play-area coordinates; the world also fills above / to the left
      ctx.clearRect(-LEFT, -TOP, FULL_W, FULL_H);
      drawWorld(dt, now);
      var betting = S.phase === 'betting' || S.phase === 'waiting';
      if (S.phase === 'flying' && !scene.startAt) scene.startAt = now - 4000; // joined mid-run
      drawCave(now);
      if (betting) {
        drawGroup(now, false);
        drawTint();
        drawBetting();
      } else if (S.phase === 'flying') {
        drawThieves(now);
        drawGroup(now, true);
        strip(img.cactusLeft, scene.worldX * 1.5, H * 0.66, H * 0.36);
        drawTint();
      } else if (S.phase === 'crashed') {
        var covered = scene.crashAt && now - scene.crashAt > CATCH_MS * 0.6 + 200;
        if (!covered) { drawThieves(now); drawGroup(now, true); }
        if (scene.crashAt) drawFight(now);
        strip(img.cactusLeft, scene.worldX * 1.5, H * 0.66, H * 0.36);
        drawTint();
      }
      ctx.restore();
    }
    // texts over the scene (set only when they change)
    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    var crashed = S.phase === 'crashed';
    if (flew.hidden === crashed) flew.hidden = !crashed;
    if (crashed) setText(flew, S.crashPhrase);
    var m = '', cls = 'mult', h = '';
    if (S.phase === 'flying') { m = game.currentMult().toFixed(2) + 'x'; if (S.my[0] || S.my[1]) updateButtons(); }
    else if (crashed) { m = S.crashPoint.toFixed(2) + 'x'; cls = 'mult mult--crashed'; }
    else if (S.phase !== 'betting') h = S.gotSnapshot ? 'Waiting for the next round…' : 'Connecting…';
    if (shown.mult !== m) { mult.textContent = m; shown.mult = m; }
    if (shown.multCls !== cls) { mult.className = cls; shown.multCls = cls; }
    if (shown.hint !== h) { hint.textContent = h; shown.hint = h; }
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
  function buildQuick(p) { // coins: 1×, 2×, 5×, 10× the min bet (within the max)
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
    Array.prototype.forEach.call(p.el.querySelectorAll('.minmax button'), function (b) {
      b.onclick = function () {
        play('click');
        var l = game.limit();
        setAmount(p, b.dataset.limit === 'max' ? (l.max || readAmount(p) * 10) : l.min);
      };
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
  try { localStorage.removeItem('alibaba-two-bets'); } catch (e) { /* old setting, no longer used */ }

  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); play('click'); };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem('alibaba-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
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
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ro.observe(stageEl); ro.observe(document.querySelector('.history')); ro.observe(document.querySelector('.bets')); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
