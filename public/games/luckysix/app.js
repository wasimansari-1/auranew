/* Lucky Six — an original NEXORNG instant dice game. One die: pick 1–5 numbers; win if the die
 * lands on one of them (pays RTP × 6 / k). The engine rolls (provably fair) and settles with the
 * wallet; this file is the look: the emerald table, the 3D die, the number gems, the bet panel.
 * Game logic: ../_core/instant-client.js (NXInstant). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXInstant.start({ event: '88.0035', rules: 'luckysix', onChange: render, onSignal: onSignal });
  var S = game.S;

  var MIN_ROLL_MS = 1150; // the die always tumbles this long before the result shows
  var THEME = '#04170f'; // browser bar = the top of the table

  // ---------------------------------------------------------------- choice (numbers picked)
  var picked = [6];
  try {
    var saved = JSON.parse(localStorage.getItem('luckysix-pick') || 'null');
    if (Array.isArray(saved) && saved.length >= 1 && saved.length <= 5 && saved.every(function (n) { return n >= 1 && n <= 6; })) picked = saved;
  } catch (e) { /* default: the lucky six */ }
  function choice() { return { numbers: picked.slice().sort() }; }
  function savePick() { try { localStorage.setItem('luckysix-pick', JSON.stringify(picked)); } catch (e) { /* ignore */ } }

  var clientSeed = '';
  try { clientSeed = localStorage.getItem('luckysix-client-seed') || ''; } catch (e) { /* new seed */ }
  if (!clientSeed) {
    var a = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(a);
    clientSeed = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  // ---------------------------------------------------------------- sound (generated, no files)
  var audio = null, soundOn = true, musicOn = true, music = null;
  try { soundOn = localStorage.getItem('luckysix-sound') !== 'off'; musicOn = localStorage.getItem('luckysix-music') !== 'off'; } catch (e) { /* on */ }
  function ac() {
    if (!audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === 'suspended') audio.resume().catch(function () {});
    return audio;
  }
  function tone(freq, dur, type, vol, when, glide) {
    var c = ac();
    if (!c || !soundOn) return;
    var t = c.currentTime + (when || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function rattle(n) { // dice clatter: short filtered noise ticks
    var c = ac();
    if (!c || !soundOn) return;
    for (var i = 0; i < n; i++) {
      var t = c.currentTime + i * (0.07 + Math.random() * 0.06), len = 0.03;
      var buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate), d = buf.getChannelData(0);
      for (var j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / d.length, 3);
      var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = buf;
      f.type = 'bandpass';
      f.frequency.value = 1800 + Math.random() * 1600;
      g.gain.value = 0.35;
      s.connect(f).connect(g).connect(c.destination);
      s.start(t);
    }
  }
  var sfx = {
    click: function () { tone(880, 0.05, 'triangle', 0.08); },
    pick: function () { tone(660, 0.07, 'sine', 0.12); tone(990, 0.06, 'sine', 0.06, 0.04); },
    roll: function () { rattle(9); tone(140, 0.25, 'triangle', 0.12, 0, 90); },
    land: function () { tone(110, 0.18, 'sine', 0.3, 0, 70); rattle(2); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.28, 'triangle', 0.16, 0.08 + i * 0.08); }); tone(1568, 0.5, 'sine', 0.06, 0.42); },
    lose: function () { tone(330, 0.22, 'sine', 0.1, 0.05, 220); tone(247, 0.3, 'sine', 0.08, 0.2, 165); },
  };

  // Ambient music: a soft generated progression (low pad + slow arpeggio), quiet.
  function startMusic() {
    var c = ac();
    if (!c || music || !musicOn) return;
    var master = c.createGain(), lp = c.createBiquadFilter();
    master.gain.value = 0.05;
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(master).connect(c.destination);
    var chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
    var step = 0, timer;
    function bar() {
      var ch = chords[Math.floor(step / 8) % chords.length], t = c.currentTime;
      if (step % 8 === 0) ch.forEach(function (f) { // pad
        var o = c.createOscillator(), g = c.createGain();
        o.type = 'sine';
        o.frequency.value = f / 2;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 1.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + 4.3);
      });
      var o2 = c.createOscillator(), g2 = c.createGain(); // arpeggio
      o2.type = 'triangle';
      o2.frequency.value = ch[step % 3] * (step % 4 === 3 ? 2 : 1);
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o2.connect(g2).connect(lp);
      o2.start(t);
      o2.stop(t + 0.5);
      step++;
    }
    bar();
    timer = setInterval(bar, 520);
    music = { stop: function () { clearInterval(timer); master.gain.setTargetAtTime(0.0001, c.currentTime, 0.2); } };
  }
  function stopMusic() { if (music) { music.stop(); music = null; } }
  function syncToggles() {
    $('sound').setAttribute('aria-pressed', String(soundOn));
    $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  // music tries to start at once (the tap that opened the game allows it); else on the first tap
  window.addEventListener('pointerdown', function () { if (musicOn) startMusic(); }, true);
  document.addEventListener('visibilitychange', function () {
    if (!audio) return;
    if (document.hidden) audio.suspend().catch(function () {}); else audio.resume().catch(function () {});
  });

  // ---------------------------------------------------------------- engine signals
  var WIN_LINES = ['Lucky!', 'Six sense!', 'Right on the money', 'Fortune smiles', 'Nailed it', 'Golden roll'];
  var LOSE_LINES = ['So close', 'Not this time', 'Next one’s yours', 'The die says no', 'Roll again'];
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function onSignal(name, d) {
    if (name === 'error') { stopRolling(); toast(d.text); }
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- build the panel (once)
  function pips(n) {
    var map = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
    var pos = { 1: '1 / 1', 3: '1 / 3', 4: '2 / 1', 5: '2 / 2', 6: '2 / 3', 7: '3 / 1', 9: '3 / 3' };
    return map[n].map(function (p) { return '<i style="grid-area:' + pos[p] + '"></i>'; }).join('');
  }

  var tiles = [];
  for (var n = 1; n <= 6; n++) {
    var t = document.createElement('button');
    t.type = 'button';
    t.className = 'tile';
    t.dataset.n = n;
    t.setAttribute('aria-label', 'Number ' + n);
    t.innerHTML = pips(n);
    t.onclick = (function (num) { return function () { togglePick(num); }; })(n);
    $('tiles').appendChild(t);
    tiles.push(t);
  }

  var gems = [];
  for (var g = 1; g <= 6; g++) {
    var gm = document.createElement('div');
    gm.className = 'gem';
    gm.innerHTML = '<span>' + g + '</span>';
    $('gems').appendChild(gm);
    gems.push(gm);
  }

  var PRESETS = [
    { label: 'Low 1–3', nums: [1, 2, 3] },
    { label: 'High 4–6', nums: [4, 5, 6] },
    { label: 'Odd', nums: [1, 3, 5] },
    { label: 'Even', nums: [2, 4, 6] },
    { label: 'Lucky 6', nums: [6] },
  ];
  PRESETS.forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.label;
    b.onclick = function () { if (busy()) return; sfx.pick(); picked = p.nums.slice(); savePick(); paintPick(); };
    $('presets').appendChild(b);
  });

  function togglePick(num) {
    if (busy()) return;
    var i = picked.indexOf(num);
    if (i >= 0) {
      if (picked.length === 1) return toast('Pick at least one number');
      picked.splice(i, 1);
    } else {
      if (picked.length >= 5) return toast('Up to 5 numbers — one must stay open');
      picked.push(num);
    }
    sfx.pick();
    savePick();
    paintPick();
  }

  function paintPick() {
    tiles.forEach(function (t, i) { var on = picked.indexOf(i + 1) >= 0; if (t.getAttribute('aria-pressed') !== String(on)) t.setAttribute('aria-pressed', String(on)); });
    gems.forEach(function (gm, i) { gm.classList.toggle('gem--on', picked.indexOf(i + 1) >= 0); });
    setText($('pickCount'), '(' + picked.length + ' of 5)');
    paintOdds();
  }

  // amount
  function readAmount() {
    var v = Number(String($('amount').value).replace(',', '.'));
    return isFinite(v) && v > 0 ? game.round2(v) : 0;
  }
  function setAmount(v) {
    var l = game.limit();
    v = Math.max(l.min, game.round2(v));
    if (l.max) v = Math.min(l.max, v);
    $('amount').value = v.toFixed(2);
    paintOdds();
  }
  function buildQuick() {
    var l = game.limit(), q = $('quick');
    q.innerHTML = '';
    [1, 2, 5, 10].forEach(function (k) {
      var v = game.round2(l.min * k);
      if (l.max && v > l.max) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = game.money(v).replace(/\.00$/, '');
      b.onclick = function () { if (busy()) return; sfx.click(); setAmount(v); };
      q.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { buildQuick(); setAmount(l.min); });
  $('minus').onclick = function () { if (busy()) return; sfx.click(); setAmount(readAmount() - game.limit().min); };
  $('plus').onclick = function () { if (busy()) return; sfx.click(); setAmount(readAmount() + game.limit().min); };
  $('amount').oninput = paintOdds;
  $('amount').onblur = function () { setAmount(readAmount() || game.limit().min); };

  function paintOdds() {
    var x = game.multiplier(choice()), amt = readAmount();
    setText($('oChance'), (picked.length / 6 * 100).toFixed(picked.length === 3 ? 0 : 1) + '%');
    setText($('oX'), x.toFixed(2) + 'x');
    setText($('oWin'), game.money(game.round2(amt * x)));
    updateButton();
  }

  // auto roll
  var AUTOS = [0, 10, 25, 50];
  var autoN = 0, autoLeft = 0;
  AUTOS.forEach(function (n) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = n ? String(n) : 'Off';
    b.setAttribute('aria-pressed', String(n === 0));
    b.onclick = function () {
      sfx.click();
      autoN = n;
      autoLeft = 0;
      Array.prototype.forEach.call($('autoSeg').children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      updateButton();
    };
    $('autoSeg').appendChild(b);
  });

  // ---------------------------------------------------------------- roll
  var rolling = false;
  function busy() { return rolling || autoLeft > 0; }

  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  function updateButton() {
    var btn = $('roll'), cls = 'roll', label = 'Roll', sub = game.money(readAmount()), disabled = false;
    if (autoLeft > 0) { cls = 'roll roll--stop'; label = 'Stop'; sub = autoLeft + ' left'; }
    else if (rolling) { label = 'Rolling…'; sub = ''; disabled = true; }
    else if (autoN) { sub = autoN + ' rolls · ' + game.money(readAmount()); }
    if (btn.className !== cls) btn.className = cls;
    if (btn.disabled !== disabled) btn.disabled = disabled;
    setText($('rollLabel'), label);
    setText($('rollSub'), sub);
  }

  $('roll').onclick = function () {
    startMusic();
    if (autoLeft > 0) { autoLeft = 0; sfx.click(); return updateButton(); }
    if (rolling) return;
    if (autoN) autoLeft = autoN;
    doRoll();
  };

  function doRoll() {
    var amount = readAmount();
    if (!amount) return toast('Enter a bet amount');
    rolling = true;
    hideResult();
    gems.forEach(function (gm) { gm.classList.remove('gem--hit', 'gem--miss'); });
    $('die').className = 'die';
    startRolling();
    sfx.roll();
    updateButton();
    var started = performance.now();
    var req = game.roll(amount, choice(), clientSeed);
    Promise.resolve(req).then(function (res) {
      if (!res || !res.dice) { stopRolling(); return; }
      var wait = Math.max(0, MIN_ROLL_MS - (performance.now() - started));
      setTimeout(function () { reveal(res, amount); }, wait);
    }, function () { stopRolling(); });
  }

  function reveal(res, amount) {
    var face = res.dice[0];
    settleTo(face, function () {
      game.reveal(); // the dice have landed: now the balance and lists show the result
      rolling = false;
      sfx.land();
      var won = !!res.won;
      $('die').className = 'die ' + (won ? 'die--win' : 'die--lose');
      var gm = gems[face - 1];
      gm.classList.add(won ? 'gem--hit' : 'gem--miss');
      showResult(won, won ? '+' + game.money(Number(res.win)) : 'Rolled ' + face, won ? pick(WIN_LINES) + ' · ' + Number(res.x).toFixed(2) + 'x' : pick(LOSE_LINES));
      if (won) { sfx.win(); burst(); } else { sfx.lose(); flash(); }
      lastFair = res;
      render();
      // auto roll: next one (stop on win if asked, or when the balance can't cover it)
      if (autoLeft > 0) {
        autoLeft--;
        if (won && $('stopWin').checked) autoLeft = 0;
        if (S.balance != null && S.balance < readAmount()) { autoLeft = 0; toast('Not enough balance for the next roll'); }
        if (autoLeft > 0) setTimeout(function () { if (autoLeft > 0 && !rolling) doRoll(); }, 1100);
      }
      updateButton();
    });
  }

  function showResult(won, amount, line) {
    var r = $('result');
    setText($('resultLine'), line);
    setText($('resultAmount'), amount);
    r.className = 'result ' + (won ? 'result--win' : 'result--lose');
  }
  function hideResult() { $('result').className = 'result result--hidden'; }

  // ---------------------------------------------------------------- the 3D die (rAF)
  var die = $('die'), hop = $('dieHop'), shadow = $('dieShadow');
  var rot = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
  var mode = 'idle', rollT0 = 0, settle = null, DIE = 120;
  // rotations that bring face n to the front (faces: 1 front, 6 back, 2 right, 5 left, 3 top, 4 bottom)
  var FACE_ROT = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };
  var TILT = 'rotateX(-14deg) rotateY(18deg)';

  (function initialFace() { var f = FACE_ROT[6]; rot.x = f[0]; rot.y = f[1]; })();

  function startRolling() {
    mode = 'roll';
    rollT0 = performance.now();
    var s = function () { return Math.random() < 0.5 ? -1 : 1; };
    vel = { x: s() * (560 + Math.random() * 260), y: s() * (420 + Math.random() * 240), z: s() * (180 + Math.random() * 160) };
  }
  function stopRolling() {
    if (mode === 'roll') settleTo(lastFace, function () { rolling = false; updateButton(); });
    else { rolling = false; updateButton(); }
    autoLeft = 0;
  }
  var lastFace = 6;
  function settleTo(face, done) {
    lastFace = face;
    var tgt = FACE_ROT[face];
    function ahead(cur, t, dir) { // the next angle ≡ t (mod 360) at least one turn further on
      var k = dir >= 0 ? Math.ceil((cur - t) / 360) + 1 : Math.floor((cur - t) / 360) - 1;
      return t + 360 * k;
    }
    settle = {
      t0: performance.now(), dur: 720,
      from: { x: rot.x, y: rot.y, z: rot.z },
      to: { x: ahead(rot.x, tgt[0], vel.x), y: ahead(rot.y, tgt[1], vel.y), z: ahead(rot.z, 0, vel.z) },
      done: done,
    };
    mode = 'settle';
  }
  function easeOutBack(k) { var c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }

  var lastT = 0;
  function frame(now) {
    var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
    lastT = now;
    var lift = 0;
    if (mode === 'roll') {
      rot.x += vel.x * dt; rot.y += vel.y * dt; rot.z += vel.z * dt;
      var t = (now - rollT0) / 1000;
      lift = Math.abs(Math.sin(t * Math.PI * 2.4)) * DIE * 0.55 * (0.55 + 0.45 * Math.exp(-t * 0.8));
    } else if (mode === 'settle') {
      var k = Math.min(1, (now - settle.t0) / settle.dur), e = easeOutBack(k);
      rot.x = settle.from.x + (settle.to.x - settle.from.x) * e;
      rot.y = settle.from.y + (settle.to.y - settle.from.y) * e;
      rot.z = settle.from.z + (settle.to.z - settle.from.z) * e;
      lift = Math.abs(Math.sin(k * Math.PI)) * DIE * 0.22 * (1 - k);
      if (k >= 1) { mode = 'idle'; rot.x = settle.to.x % 360; rot.y = settle.to.y % 360; rot.z = 0; var d = settle.done; settle = null; if (d) d(); }
    } else {
      lift = DIE * (0.04 + 0.03 * Math.sin(now / 700)); // gentle float while waiting
    }
    die.style.transform = 'rotateX(' + rot.x.toFixed(1) + 'deg) rotateY(' + rot.y.toFixed(1) + 'deg) rotateZ(' + rot.z.toFixed(1) + 'deg)';
    hop.style.transform = 'translateY(' + (-lift).toFixed(1) + 'px) ' + TILT;
    var sh = 1 - Math.min(0.55, lift / (DIE * 1.2));
    shadow.style.transform = 'scale(' + sh.toFixed(3) + ')';
    shadow.style.opacity = (0.35 + 0.65 * sh).toFixed(2);
    drawScene(now, dt);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- the table (canvas)
  var canvas = $('scene'), ctx = canvas.getContext('2d');
  var stageEl = document.querySelector('.stage'), playEl = $('play');
  var W = 0, H = 0, FULL_W = 0, FULL_H = 0, LEFT = 0, TOP = 0;
  var felt = null, dust = [], parts = [], flashAt = 0;
  for (var i0 = 0; i0 < 46; i0++) dust.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6, v: 6 + Math.random() * 14, p: Math.random() * 6 });

  function makeFelt() { // a fine velvet texture, tiled
    var c = document.createElement('canvas'), n = 96;
    c.width = c.height = n;
    var x = c.getContext('2d'), img = x.createImageData(n, n);
    for (var p = 0; p < img.data.length; p += 4) {
      var v = Math.random() * 26;
      img.data[p] = v * 0.2; img.data[p + 1] = v; img.data[p + 2] = v * 0.6; img.data[p + 3] = 22;
    }
    x.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  }

  function fit() {
    var r = stageEl.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    FULL_W = r.width; FULL_H = r.height;
    var bar = document.querySelector('.top').getBoundingClientRect();
    TOP = Math.max(0, bar.bottom - r.top + 6);
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    W = FULL_W - LEFT;
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    H = Math.max(160, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    stageEl.style.setProperty('--left', LEFT + 'px');
    var ps = playEl.style;
    ps.left = LEFT + 'px'; ps.top = TOP + 'px'; ps.width = W + 'px'; ps.height = H + 'px';
    DIE = Math.round(Math.max(78, Math.min(176, Math.min(W * 0.3, H * 0.34))));
    playEl.style.setProperty('--die', DIE + 'px');
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a round is added to it).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    felt = makeFelt();
  }

  function drawScene(now, dt) {
    if (!FULL_W) return;
    var cx = LEFT + W / 2, cy = TOP + H * 0.54;
    // velvet: a pool of light over the table, deep emerald around
    var g = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(FULL_W, FULL_H) * 0.75);
    g.addColorStop(0, '#13563f');
    g.addColorStop(0.45, '#0a3326');
    g.addColorStop(1, '#03120d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FULL_W, FULL_H);
    if (felt) { ctx.fillStyle = felt; ctx.fillRect(0, 0, FULL_W, FULL_H); }

    // slow golden light rays behind the die
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(now / 9000);
    var rayLen = Math.max(W, H) * 0.9;
    for (var i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      var rg = ctx.createLinearGradient(0, 0, rayLen, 0);
      rg.addColorStop(0, 'rgba(255,226,154,0.10)');
      rg.addColorStop(1, 'rgba(255,226,154,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(rayLen, -rayLen * 0.07);
      ctx.lineTo(rayLen, rayLen * 0.07);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // the dice tray: a gold-rimmed oval under the die
    var tw = Math.min(W * 0.82, DIE * 3.4), th = tw * 0.34, ty = cy + DIE * 0.62;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, ty, tw / 2, th / 2, 0, 0, Math.PI * 2);
    var tg = ctx.createRadialGradient(cx, ty - th * 0.2, 4, cx, ty, tw / 2);
    tg.addColorStop(0, 'rgba(14,74,54,0.95)');
    tg.addColorStop(1, 'rgba(4,24,17,0.95)');
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.lineWidth = Math.max(2, DIE * 0.035);
    var rim = ctx.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
    rim.addColorStop(0, '#8a611c'); rim.addColorStop(0.3, '#ffe29a'); rim.addColorStop(0.6, '#f2c25b'); rim.addColorStop(1, '#8a611c');
    ctx.strokeStyle = rim;
    ctx.shadowColor = 'rgba(242,194,91,0.45)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();

    // golden dust drifting up
    dust.forEach(function (d) {
      d.y -= (d.v * dt) / FULL_H;
      if (d.y < -0.02) { d.y = 1.02; d.x = Math.random(); }
      ctx.globalAlpha = 0.25 + 0.35 * Math.sin(now / 600 + d.p) * Math.sin(now / 600 + d.p);
      ctx.fillStyle = '#ffe29a';
      ctx.beginPath();
      ctx.arc(d.x * FULL_W, d.y * FULL_H, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // win burst
    for (var p = parts.length - 1; p >= 0; p--) {
      var q = parts[p];
      q.life -= dt;
      if (q.life <= 0) { parts.splice(p, 1); continue; }
      q.vy += 520 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      ctx.globalAlpha = Math.min(1, q.life * 1.6);
      ctx.fillStyle = q.c;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // lose: a brief ruby pulse around the edges of the play area
    if (flashAt) {
      var k = (now - flashAt) / 600;
      if (k >= 1) flashAt = 0;
      else {
        var vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.8);
        vg.addColorStop(0, 'rgba(255,77,109,0)');
        vg.addColorStop(1, 'rgba(255,77,109,' + (0.35 * (1 - k)).toFixed(3) + ')');
        ctx.fillStyle = vg;
        ctx.fillRect(LEFT, TOP, W, H);
      }
    }
  }

  function burst() {
    var cx = LEFT + W / 2, cy = TOP + H * 0.54, cols = ['#ffe29a', '#f2c25b', '#23e39a', '#9effd6', '#ffffff'];
    for (var i = 0; i < 70; i++) {
      var a = Math.random() * Math.PI * 2, sp = 160 + Math.random() * 360;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 260, r: 2 + Math.random() * 3.5, life: 0.9 + Math.random() * 0.7, c: cols[i % cols.length] });
    }
  }
  function flash() { flashAt = performance.now(); }

  // ---------------------------------------------------------------- render (state → DOM)
  var tab = 'all', lastFair = null;

  function render() {
    $('conn').hidden = S.connected || S.demo || !S.gotSnapshot;
    setText($('balance'), S.balance == null ? '—' : game.money(S.balance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    var h = $('history');
    h.innerHTML = '';
    if (!S.history.length) {
      var e = document.createElement('span');
      e.className = 'history__empty';
      e.textContent = 'Your rolls show here';
      h.appendChild(e);
    }
    S.history.forEach(function (r) {
      var c = document.createElement('span');
      c.className = 'chip ' + (r.won ? 'chip--win' : 'chip--lose');
      c.textContent = r.dice && r.dice[0] != null ? r.dice[0] : '?';
      h.appendChild(c);
    });

    renderList();

    if (lastFair) {
      setText($('fRound'), lastFair.round != null ? String(lastFair.round) : '—');
      setText($('fHash'), lastFair.hash || '—');
      setText($('fSeed'), lastFair.seed || '—');
    }
    if (!rolling && S.gotSnapshot === false && !S.demo) setText($('hint'), 'Connecting…');
    else setText($('hint'), rolling ? '' : picked.length + ' of 6 numbers · ' + game.multiplier(choice()).toFixed(2) + 'x');
    updateButton();
  }

  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }

  function renderList() {
    var list = $('list'), cols = $('cols');
    list.innerHTML = '';
    var rows = tab === 'all' ? S.bets : S.myBets;
    setText($('countLabel'), tab === 'all' ? 'All bets' : 'My bets');
    setText($('betCount'), String(rows.length));
    var head = tab === 'all' ? ['Player', 'Bet', 'Die', 'Win'] : ['Time', 'Bet', 'Die', 'Win'];
    if (cols.dataset.tab !== tab) {
      cols.dataset.tab = tab;
      cols.innerHTML = '';
      head.forEach(function (t) { cols.appendChild(cell(t)); });
    }
    if (!rows.length) list.appendChild(cell(tab === 'all' ? 'No rolls yet — be the first.' : 'Your rolls this visit show here.', 'empty'));
    rows.forEach(function (b) {
      var won = b.won != null ? b.won : Number(b.win) > 0;
      var row = document.createElement('div');
      row.className = 'row' + (won ? ' row--win' : '') + (b.mine ? ' row--mine' : '');
      row.appendChild(cell(tab === 'all' ? b.player : new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'row__user'));
      row.appendChild(cell(Number(b.amount).toFixed(2)));
      row.appendChild(cell(b.dice && b.dice[0] != null ? String(b.dice[0]) : '—', 'row__die'));
      row.appendChild(cell(won ? Number(b.win).toFixed(2) : '—', won ? 'row__win' : 'row__lose'));
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- controls
  $('back').onclick = function () { sfx.click(); game.back(); };
  $('sound').onclick = function () {
    soundOn = !soundOn;
    try { localStorage.setItem('luckysix-sound', soundOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncToggles();
    sfx.click();
  };
  $('music').onclick = function () {
    musicOn = !musicOn;
    try { localStorage.setItem('luckysix-music', musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    if (musicOn) startMusic(); else stopMusic();
    syncToggles();
  };
  $('fair').onclick = function () {
    var d = $('fairDetail');
    d.hidden = !d.hidden;
    $('fair').setAttribute('aria-expanded', String(!d.hidden));
  };
  $('clientSeed').value = clientSeed;
  $('clientSeed').onchange = function () {
    var v = $('clientSeed').value.trim().slice(0, 64);
    if (!v) { $('clientSeed').value = clientSeed; return; }
    clientSeed = v;
    try { localStorage.setItem('luckysix-client-seed', clientSeed); } catch (e) { /* ignore */ }
  };
  try { localStorage.setItem('luckysix-client-seed', clientSeed); } catch (e) { /* ignore */ }
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      sfx.click();
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      renderList();
    };
  });

  // ---------------------------------------------------------------- start
  syncToggles();
  if (musicOn) startMusic(); // allowed when the game was opened by a tap; else the first tap starts it
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    ['.history', '.bets', '.top'].forEach(function (sel) { var el = document.querySelector(sel); if (el) ro.observe(el); });
  }
  fit();
  hideResult();
  paintPick();
  render();
  game.theme(THEME);
  requestAnimationFrame(frame);
  // ready: the table is drawn and (for real players) the socket has its snapshot
  var announced = false;
  function maybeReady() { if (!announced && (S.demo || S.gotSnapshot)) { announced = true; game.ready(); } }
  var readyTimer = setInterval(function () { maybeReady(); if (announced) clearInterval(readyTimer); }, 150);
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000);
})();
