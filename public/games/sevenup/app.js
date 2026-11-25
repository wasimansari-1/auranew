/* Seven Up — NEXORNG instant dice game (2 dice). Call Under 7 / Lucky 7 / Over 7 or an exact
 * total, roll, and the engine's provably fair dice decide. Game logic: ../_core/instant-client.js
 * (NXInstant); this file is the look: a night terrace dice table under string lights, two 3D
 * dice, the reveal, the bet panel and the lists. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var MIN_ROLL_MS = 1100; // the dice always tumble at least this long before the result shows
  var SETTLE_MS = 560;
  var FACES = [ // face value → the cube rotation that shows it in front (rx, ry), in degrees
    null, [0, 0], [-90, 0], [0, -90], [0, 90], [90, 0], [0, -180],
  ];
  var PIPS = [null, [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

  var game = NXInstant.start({ event: '88.0036', rules: 'sevenup', onChange: render, onSignal: onSignal });
  var S = game.S;

  // ---------------------------------------------------------------- my view of the results
  // The engine answers fast; what the player sees (dice, balance, lists) only changes when the
  // roll animation has finished, so nothing gives the result away early.
  var view = { rolling: false, balance: null, history: [], fair: null, revealed: 0 };
  var choice = { pick: 'over' };
  var auto = { left: 0, stopOnWin: false };

  function sumOf(d) { return d[0] + d[1]; }
  function band(total) { return total < 7 ? 'under' : total === 7 ? 'seven' : 'over'; }
  function bandLabel(total) { return total < 7 ? 'Under 7' : total === 7 ? 'Lucky Seven' : 'Over 7'; }
  function fmtX(x) { return (Math.floor(x * 100 + 1e-6) / 100).toFixed(2) + 'x'; }

  // ---------------------------------------------------------------- sound (WebAudio, generated)
  var audio = { ctx: null, sound: true, music: true, musicGain: null, musicTimer: 0, nextBar: 0, bar: 0 };
  try {
    audio.sound = localStorage.getItem('sevenup-sound') !== 'off';
    audio.music = localStorage.getItem('sevenup-music') !== 'off';
  } catch (e) { /* defaults on */ }

  function ac() {
    if (!audio.ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      audio.ctx = new C();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.9;
      audio.master.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(function () {});
    return audio.ctx;
  }

  function tone(freq, start, dur, type, vol, dest) {
    var c = audio.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(dest || audio.master);
    o.start(start); o.stop(start + dur + 0.05);
  }

  var noiseBuf = null;
  function noise(start, dur, freq, q, vol, dest) {
    var c = audio.ctx;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f); f.connect(g); g.connect(dest || audio.master);
    s.start(start, Math.random() * 0.3); s.stop(start + dur + 0.02);
  }

  function sfx(name, data) {
    if (!audio.sound || !ac()) return;
    var t = audio.ctx.currentTime;
    if (name === 'click') tone(1100, t, 0.05, 'square', 0.05);
    else if (name === 'rattle') { // dice shaken and tumbling: clicks for the whole roll
      for (var k = 0; k < (data || 14); k++) noise(t + k * (0.055 + Math.random() * 0.03), 0.05, 2200 + Math.random() * 1800, 6, 0.22);
    } else if (name === 'land') {
      noise(t, 0.08, 1800, 4, 0.5); tone(140, t, 0.12, 'sine', 0.35);
      noise(t + 0.09, 0.07, 2400, 5, 0.35); tone(170, t + 0.09, 0.1, 'sine', 0.25);
    } else if (name === 'win') {
      var big = data && data.x >= 5;
      var notes = big ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
      notes.forEach(function (f, i) { tone(f, t + i * 0.085, 0.35, 'triangle', 0.22); });
      if (big) notes.forEach(function (f, i) { tone(f * 2, t + 0.5 + i * 0.06, 0.25, 'sine', 0.08); });
    } else if (name === 'lose') {
      tone(330, t, 0.25, 'sine', 0.18); tone(247, t + 0.16, 0.38, 'sine', 0.16);
    } else if (name === 'push') {
      tone(523, t, 0.18, 'triangle', 0.15); tone(523, t + 0.16, 0.22, 'triangle', 0.12);
    }
  }

  // A soft generated lounge loop: jazzy chords, a walking bass and a light shaker.
  var CHORDS = [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [293.7, 349.2, 440, 523.3], [196, 246.9, 293.7, 349.2]];
  var BASS = [[130.8, 164.8, 196, 220], [110, 130.8, 164.8, 196], [146.8, 174.6, 220, 261.6], [98, 123.5, 146.8, 174.6]];
  var BAR = 2.4; // seconds per bar (100 bpm, 4 beats)
  function scheduleMusic() {
    var c = audio.ctx;
    if (!c || !audio.music) return;
    while (audio.nextBar < c.currentTime + 1.2) {
      var t = audio.nextBar, i = audio.bar % 4;
      CHORDS[i].forEach(function (f) { tone(f, t, BAR * 0.95, 'sine', 0.035, audio.musicGain); tone(f * 2, t + BAR / 2, BAR * 0.4, 'triangle', 0.012, audio.musicGain); });
      BASS[i].forEach(function (f, b) { tone(f / 2, t + b * BAR / 4, BAR / 4 * 0.9, 'triangle', 0.07, audio.musicGain); });
      for (var h = 0; h < 8; h++) noise(t + h * BAR / 8, 0.04, 7000, 1.2, h % 2 ? 0.02 : 0.035, audio.musicGain);
      audio.nextBar += BAR;
      audio.bar++;
    }
  }
  function syncMusic() {
    $('music').setAttribute('aria-pressed', String(audio.music));
    $('music').setAttribute('aria-label', audio.music ? 'Music on' : 'Music off');
    if (!audio.music) {
      if (audio.musicGain) audio.musicGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.2);
      return;
    }
    var c = ac();
    if (!c) return;
    if (!audio.musicGain) { audio.musicGain = c.createGain(); audio.musicGain.connect(audio.master); }
    audio.musicGain.gain.setTargetAtTime(1, c.currentTime, 0.3);
    if (audio.nextBar < c.currentTime) audio.nextBar = c.currentTime + 0.1;
    if (!audio.musicTimer) audio.musicTimer = setInterval(scheduleMusic, 300);
    scheduleMusic();
  }
  function setSound(on) {
    audio.sound = on;
    try { localStorage.setItem('sevenup-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  }
  // Music starts as the game opens where the browser allows it, else on the first tap.
  window.addEventListener('pointerdown', function () { if (audio.music) syncMusic(); else ac(); }, true);
  document.addEventListener('visibilitychange', function () {
    if (!audio.ctx) return;
    if (document.hidden) audio.ctx.suspend().catch(function () {});
    else audio.ctx.resume().catch(function () {});
  });

  // ---------------------------------------------------------------- dice (CSS 3D)
  var dieEls = [$('d0'), $('d1')], wrapEls = [$('dw0'), $('dw1')];
  dieEls.forEach(function (d) {
    var sides = [['front', 1, ''], ['back', 6, 'rotateY(180deg)'], ['right', 3, 'rotateY(90deg)'],
      ['left', 4, 'rotateY(-90deg)'], ['top', 2, 'rotateX(90deg)'], ['bottom', 5, 'rotateX(-90deg)']];
    sides.forEach(function (s) {
      var f = document.createElement('div');
      f.className = 'face face--' + s[1];
      f.style.transform = s[2] + ' translateZ(calc(var(--ds) / 2))';
      for (var i = 0; i < 9; i++) {
        var p = document.createElement('span');
        if (PIPS[s[1]].indexOf(i) >= 0) p.className = 'pip';
        f.appendChild(p);
      }
      d.appendChild(f);
    });
  });

  var dice = [mkDie(0), mkDie(1)];
  function mkDie(i) { return { i: i, x: 0, y: 0, rx: -18, ry: 24 + i * 40, rz: 0, vx: 0, vy: 0, vz: 0, face: i ? 4 : 3, from: null, to: null }; }
  var roll = { phase: 'rest', t0: 0, settleAt: 0, result: null }; // rest | rolling | settling

  function restPos(i) {
    var gap = ds * 0.85;
    return { x: W / 2 + (i ? gap : -gap) - ds / 2, y: H * 0.68 - ds / 2 };
  }

  function setFacesInstant(values) {
    dice.forEach(function (d, i) {
      var f = FACES[values[i]];
      d.rx = f[0] - 18; d.ry = f[1] + 22 * (i ? -1 : 1); d.rz = 0; d.face = values[i];
    });
  }

  function startRoll(now) {
    roll.phase = 'rolling'; roll.t0 = now; roll.result = null;
    dice.forEach(function (d, i) {
      d.vx = 760 + Math.random() * 420; d.vy = 900 + Math.random() * 500; d.vz = (Math.random() - 0.5) * 520;
      d.startX = W * (0.72 + i * 0.12); d.startY = H * 1.05;
    });
    $('dice').classList.remove('dice--seven');
  }

  function settle(values, now) {
    roll.phase = 'settling'; roll.settleAt = now; roll.values = values;
    dice.forEach(function (d, i) {
      var f = FACES[values[i]];
      var tx = f[0] + 360 * Math.ceil((d.rx + 360 - f[0]) / 360);
      var ty = f[1] + 360 * Math.ceil((d.ry + 360 - f[1]) / 360);
      var tz = 360 * Math.ceil((d.rz + 180) / 360);
      var p = restPos(i);
      d.from = { rx: d.rx, ry: d.ry, rz: d.rz, x: d.x, y: d.y };
      d.to = { rx: tx, ry: ty, rz: tz, x: p.x, y: p.y };
      d.face = values[i];
    });
  }

  function easeOut(t) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); }

  function stepDice(now, dt) {
    if (roll.phase === 'rolling') {
      var t = (now - roll.t0) / 1000;
      dice.forEach(function (d, i) {
        var p = restPos(i);
        var k = easeOut(t / 0.75); // thrown in from the bottom right, bouncing to the middle
        var bounce = Math.abs(Math.sin(t * 9 + i)) * H * 0.16 * Math.max(0, 1 - t / 1.2);
        var jiggleX = Math.sin(t * 7 + i * 2) * ds * 0.18 * (t > 0.75 ? 1 : 0);
        d.x = d.startX + (p.x - d.startX) * k + jiggleX;
        d.y = d.startY + (p.y - d.startY) * k - bounce;
        d.rx += d.vx * dt; d.ry += d.vy * dt; d.rz += d.vz * dt;
      });
    } else if (roll.phase === 'settling') {
      var s = easeOut((now - roll.settleAt) / SETTLE_MS);
      dice.forEach(function (d) {
        d.rx = d.from.rx + (d.to.rx - d.from.rx) * s;
        d.ry = d.from.ry + (d.to.ry - d.from.ry) * s;
        d.rz = d.from.rz + (d.to.rz - d.from.rz) * s;
        d.x = d.from.x + (d.to.x - d.from.x) * s;
        d.y = d.from.y + (d.to.y - d.from.y) * s - Math.sin(s * Math.PI) * ds * 0.35 * (1 - s);
      });
      if (now - roll.settleAt >= SETTLE_MS) { roll.phase = 'rest'; landed(); }
    } else {
      dice.forEach(function (d, i) { var p = restPos(i); d.x = p.x; d.y = p.y; });
    }
    dice.forEach(function (d, i) {
      wrapEls[i].style.transform = 'translate3d(' + d.x.toFixed(1) + 'px,' + d.y.toFixed(1) + 'px,0)';
      dieEls[i].style.transform = 'rotateX(' + d.rx.toFixed(1) + 'deg) rotateY(' + d.ry.toFixed(1) + 'deg) rotateZ(' + d.rz.toFixed(1) + 'deg)';
    });
  }

  // ---------------------------------------------------------------- rolling
  function readAmount() {
    var v = Number(String($('amount').value).replace(',', '.'));
    return isFinite(v) && v > 0 ? game.round2(v) : 0;
  }

  function doRoll() {
    if (view.rolling) return;
    var amount = readAmount();
    if (!amount) return toast('Enter a valid amount.');
    view.rolling = true;
    // shown balance: the stake is taken, the outcome waits until the dice land
    view.balance = S.balance == null ? null : game.round2(Math.max(0, S.balance - amount));
    hideReveal();
    $('hint').textContent = '';
    var now = performance.now(), started = now, sent = Object.assign({}, choice);
    startRoll(now);
    sfx('rattle', 18);
    updateButton();
    var seed = clientSeed();
    var p;
    try { p = game.roll(amount, sent, seed); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (res) {
      if (!res || !res.dice) throw new Error((res && res.error) || 'Roll failed');
      var wait = Math.max(0, MIN_ROLL_MS - (performance.now() - started));
      setTimeout(function () { settle(res.dice, performance.now()); roll.result = { res: res, choice: sent, amount: amount }; }, wait);
    }).catch(function (err) {
      // no result: the dice come back to their last faces, nothing was decided
      var last = dice.map(function (d) { return d.face; });
      settle(last, performance.now());
      roll.result = { error: true };
      if (err && err.message && !lastErrorShown) toast(err.message);
      lastErrorShown = false;
      auto.left = 0;
    });
  }
  var lastErrorShown = false;

  function landed() {
    var r = roll.result;
    game.reveal(); // the dice have landed: now the balance and lists show the result
    view.rolling = false;
    if (!r || r.error) { view.balance = null; render(); return; }
    var res = r.res, total = sumOf(res.dice);
    sfx('land');
    if (total === 7) $('dice').classList.add('dice--seven');
    view.history.unshift({ total: total, won: res.won });
    view.history = view.history.slice(0, 30);
    view.fair = res;
    view.balance = null; // show the real balance now
    view.revealed++;
    showReveal(res, total);
    setTimeout(function () { sfx(res.won ? 'win' : res.push ? 'push' : 'lose', res); }, 120);
    if (res.won) { scene.flash = performance.now(); burst(res.x); }
    render();
    if (auto.left > 0) {
      auto.left--;
      if (auto.stopOnWin && res.won) auto.left = 0;
      if (auto.left > 0) setTimeout(function () { if (!view.rolling && auto.left > 0) doRoll(); }, 900);
      else setAutoButtons(0);
      updateButton();
    }
  }

  function showReveal(res, total) {
    var el = $('reveal');
    $('total').textContent = String(total);
    $('totalLabel').textContent = bandLabel(total) + '  ·  ' + res.dice[0] + ' + ' + res.dice[1];
    $('winLine').textContent = res.won ? '+' + game.money(Number(res.win)) + '  ·  ' + fmtX(res.x)
      : res.push ? 'Stake back' : 'No win this time';
    el.className = 'reveal reveal--on reveal--' + band(total) + (res.won ? ' reveal--won' : res.push ? ' reveal--push' : ' reveal--lost');
  }
  function hideReveal() { $('reveal').className = 'reveal'; }

  // ---------------------------------------------------------------- the bet panel
  var zoneEls = Array.prototype.slice.call(document.querySelectorAll('.zone'));
  var sumEls = [];
  for (var s = 2; s <= 12; s++) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sum sum--' + band(s);
    b.dataset.sum = String(s);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', 'Exact total ' + s);
    b.innerHTML = '<b>' + s + '</b><small></small>';
    $('sums').appendChild(b);
    sumEls.push(b);
  }

  function choiceKey(c) { return c.pick === 'sum' ? 'sum' + c.sum : c.pick; }
  function selectChoice(c) {
    if (view.rolling) return;
    choice = c;
    var key = choiceKey(c);
    zoneEls.forEach(function (z) { z.setAttribute('aria-checked', String(z.dataset.pick === key)); });
    sumEls.forEach(function (e) { e.setAttribute('aria-checked', String('sum' + e.dataset.sum === key)); });
    updateButton();
  }
  zoneEls.forEach(function (z) { z.onclick = function () { sfx('click'); selectChoice({ pick: z.dataset.pick }); }; });
  sumEls.forEach(function (e) { e.onclick = function () { sfx('click'); selectChoice({ pick: 'sum', sum: Number(e.dataset.sum) }); }; });

  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  function updatePayouts() {
    document.querySelectorAll('[data-x]').forEach(function (el) { setText(el, fmtX(game.multiplier({ pick: el.dataset.x }))); });
    sumEls.forEach(function (e) { setText(e.querySelector('small'), fmtX(game.multiplier({ pick: 'sum', sum: Number(e.dataset.sum) }))); });
  }

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
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = game.money(v).replace(/\.00$/, '');
      btn.onclick = function () { sfx('click'); setAmount(v); };
      q.appendChild(btn);
    });
  }
  Promise.resolve(game.limitsLoaded).then(function () { buildQuick(); setAmount(game.limit().min); });
  $('minus').onclick = function () { sfx('click'); setAmount(readAmount() - game.limit().min); };
  $('plus').onclick = function () { sfx('click'); setAmount(readAmount() + game.limit().min); };
  $('amount').oninput = updateButton;
  $('amount').onblur = function () { setAmount(readAmount() || game.limit().min); };

  function updateButton() {
    var btn = $('roll'), label = btn.querySelector('.action__label'), x = game.multiplier(choice);
    var amount = readAmount();
    var autoOn = auto.left > 0;
    setText(label, autoOn ? 'Stop' : view.rolling ? 'Rolling…' : 'Roll');
    setText($('rollSub'), autoOn ? auto.left + ' rolls left' : 'win ' + game.money(game.round2(amount * x)) + ' · ' + fmtX(x));
    var cls = 'action' + (autoOn ? ' action--stop' : '');
    if (btn.className !== cls) btn.className = cls;
    var dis = view.rolling && !autoOn;
    if (btn.disabled !== dis) btn.disabled = dis;
  }

  $('roll').onclick = function () {
    if (auto.left > 0) { auto.left = 0; setAutoButtons(0); updateButton(); return; }
    sfx('click');
    var n = autoCount;
    if (n > 0) { auto.left = n; auto.stopOnWin = $('stopWin').checked; }
    doRoll();
  };

  var autoCount = 0;
  function setAutoButtons(n) {
    autoCount = n;
    document.querySelectorAll('#autoCounts button').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n)); });
  }
  document.querySelectorAll('#autoCounts button').forEach(function (b) {
    b.onclick = function () { sfx('click'); if (auto.left > 0) return; setAutoButtons(Number(b.dataset.n)); };
  });

  // ---------------------------------------------------------------- lists, history, fairness
  var tab = 'all';
  function cell(text, cls) { var s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; return s; }
  function renderList() {
    if (view.rolling) return; // my own row would give the result away
    var list = $('list');
    list.innerHTML = '';
    var rows = tab === 'all' ? S.bets || [] : S.myBets || [];
    setText($('countLabel'), tab === 'all' ? 'All bets' : 'My bets');
    setText($('betCount'), String(rows.length));
    if (!rows.length) list.appendChild(cell(tab === 'all' ? 'No rolls yet.' : 'Your rolls this visit show here.', 'empty'));
    rows.slice(0, 30).forEach(function (b) {
      var won = Number(b.win) > 0 && (b.won !== false);
      var row = document.createElement('div');
      row.className = 'row' + (won ? ' row--won' : '') + (b.mine ? ' row--mine' : '');
      row.appendChild(cell(tab === 'all' ? b.player || '—' : new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'row__player'));
      row.appendChild(cell(Number(b.amount).toFixed(2)));
      row.appendChild(cell(b.dice ? b.dice.join('+') + '=' + sumOf(b.dice) : '—', 'row__dice'));
      row.appendChild(cell(won ? Number(b.win).toFixed(2) : '—', 'row__win' + (won ? '' : ' row__win--lost')));
      list.appendChild(row);
    });
  }

  function renderHistory() {
    var h = $('history');
    var key = view.history.map(function (x) { return x.total + (x.won ? 'w' : ''); }).join(',');
    if (h.dataset.key === key) return;
    h.dataset.key = key;
    h.innerHTML = '';
    view.history.forEach(function (x) {
      var c = document.createElement('span');
      c.className = 'chip chip--' + band(x.total) + (x.won ? ' chip--won' : '');
      c.textContent = String(x.total);
      h.appendChild(c);
    });
  }

  function clientSeed() {
    var el = $('clientSeed');
    if (!el.value) {
      var v = '';
      try { v = localStorage.getItem('sevenup-client-seed') || ''; } catch (e) { /* ignore */ }
      if (!v) {
        var a = new Uint8Array(8);
        (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
        v = Array.prototype.map.call(a, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
      }
      el.value = v;
    }
    try { localStorage.setItem('sevenup-client-seed', el.value); } catch (e) { /* ignore */ }
    return el.value.slice(0, 64);
  }

  function renderFair() {
    var f = view.fair;
    setText($('fRound'), f && f.round ? String(f.round) : '—');
    setText($('fHash'), (f && f.hash) || '—');
    setText($('fSeed'), (f && f.seed) || (S.demo ? 'demo rolls are local' : 'revealed after your roll'));
  }

  function render() {
    var bal = view.balance != null ? view.balance : S.balance;
    setText($('balance'), bal == null ? '—' : game.money(bal));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');
    $('conn').hidden = S.connected || !S.gotSnapshot || S.demo;
    renderHistory();
    renderList();
    renderFair();
    updatePayouts();
    updateButton();
    maybeReady();
  }

  function onSignal(name, d) {
    if (name === 'error') { lastErrorShown = true; toast((d && d.text) || 'Something went wrong.'); }
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- the scene (canvas)
  var canvas = $('scene'), ctx = canvas.getContext('2d'), stageEl = document.querySelector('.stage');
  var W = 0, H = 0, TOP = 0, LEFT = 0, FULL_W = 0, FULL_H = 0, ds = 64;
  var scene = { flash: 0, sky: null, stars: [], skyline: [], bulbs: [], particles: [], lastT: 0 };

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
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    W = FULL_W - LEFT;
    H = Math.max(140, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    stageEl.style.setProperty('--left', LEFT + 'px');
    var play = $('play').style;
    play.left = LEFT + 'px'; play.top = TOP + 'px'; play.width = W + 'px'; play.height = H + 'px';
    ds = Math.round(Math.max(46, Math.min(112, H * 0.27, W * 0.17)));
    document.documentElement.style.setProperty('--ds', ds + 'px');
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a round is added to it).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildScene();
  }

  function rnd(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

  function buildScene() {
    var r = rnd(7);
    scene.stars = [];
    for (var i = 0; i < 70; i++) scene.stars.push({ x: r(), y: r() * 0.55, s: 0.6 + r() * 1.5, t: r() * 6 });
    scene.skyline = [];
    [0.55, 0.85].forEach(function (depth, layer) {
      var x = -20;
      while (x < FULL_W + 20) {
        var w = 22 + r() * 50 * depth, h = (0.08 + r() * 0.2) * H * depth;
        var wins = [];
        for (var wy = 6; wy < h - 6; wy += 9) for (var wx = 5; wx < w - 5; wx += 8) if (r() < 0.35) wins.push([wx, wy, r()]);
        scene.skyline.push({ x: x, w: w, h: h, layer: layer, wins: wins });
        x += w + r() * 6;
      }
    });
    scene.bulbs = [];
    var colours = ['#ffd36b', '#ff7ab8', '#7fe6ff', '#ffd36b', '#b98bff'];
    [0, 1].forEach(function (k) {
      var n = Math.max(8, Math.round(FULL_W / 46));
      for (var j = 0; j <= n; j++) scene.bulbs.push({ string: k, u: j / n, c: colours[(j + k * 2) % colours.length], t: r() * 6 });
    });
  }

  function horizon() { return TOP + H * 0.42; }
  function feltTop() { return TOP + H * 0.47; }

  function stringY(k, u) { // a sagging string of lights across the top of the play area
    var y0 = TOP + H * (k ? 0.1 : 0.02), sag = H * (k ? 0.12 : 0.09);
    return y0 + Math.sin(u * Math.PI) * sag;
  }

  function burst(x) {
    var n = Math.min(90, 30 + Math.round(x * 6));
    var cs = ['#ffd36b', '#ff7ab8', '#7fe6ff', '#ffffff', '#3ee08a'];
    for (var i = 0; i < n; i++) {
      scene.particles.push({ x: LEFT + W / 2 + (Math.random() - 0.5) * W * 0.3, y: TOP + H * 0.45, vx: (Math.random() - 0.5) * 520, vy: -260 - Math.random() * 420, r: Math.random() * 6, life: 1.6 + Math.random(), c: cs[i % cs.length], a: Math.random() * 6 });
    }
  }

  function draw(now, dt) {
    var w = FULL_W, h = FULL_H;
    if (!w || !h) return;
    // night sky with a warm city glow at the horizon
    var g = ctx.createLinearGradient(0, 0, 0, horizon());
    g.addColorStop(0, '#170a33'); g.addColorStop(0.55, '#2c1260'); g.addColorStop(1, '#6a1f6e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    scene.stars.forEach(function (s) {
      ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(now / 900 + s.t));
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x * w, s.y * horizon(), s.s, s.s);
    });
    ctx.globalAlpha = 1;
    // skyline (two depths) with lit windows
    scene.skyline.forEach(function (b) {
      var base = horizon() + (b.layer ? H * 0.04 : 0);
      ctx.fillStyle = b.layer ? '#1b0b3e' : '#2a1052';
      ctx.fillRect(b.x, base - b.h, b.w, b.h + H * 0.1);
      b.wins.forEach(function (wv) {
        ctx.fillStyle = wv[2] > 0.5 ? 'rgba(255, 211, 107, 0.75)' : 'rgba(127, 230, 255, 0.5)';
        ctx.fillRect(b.x + wv[0], base - b.h + wv[1], 3, 4);
      });
    });
    // the felt table, with a gold rail and a faint "7" in the middle
    var ft = feltTop();
    var fg = ctx.createLinearGradient(0, ft, 0, h);
    fg.addColorStop(0, '#13805f'); fg.addColorStop(0.5, '#0c5d45'); fg.addColorStop(1, '#073b2c');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(0, ft + H * 0.06);
    ctx.quadraticCurveTo(LEFT + W / 2, ft - H * 0.05, w, ft + H * 0.06);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffc94a'; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, ft + H * 0.06);
    ctx.quadraticCurveTo(LEFT + W / 2, ft - H * 0.05, w, ft + H * 0.06);
    ctx.stroke();
    ctx.globalAlpha = 0.25; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(LEFT + W / 2, TOP + H * 0.76, W * 0.36, H * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffe08a';
    ctx.font = '900 ' + Math.round(H * 0.42) + 'px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('7', LEFT + W / 2, TOP + H * 0.78);
    ctx.globalAlpha = 1;
    // strings of lights (they blaze gold for a moment after a win)
    var flash = Math.max(0, 1 - (now - scene.flash) / 1400);
    [0, 1].forEach(function (k) {
      ctx.strokeStyle = 'rgba(20, 10, 30, 0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var u = 0; u <= 1.001; u += 0.05) { var x = u * w, y = stringY(k, u); if (u === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    });
    scene.bulbs.forEach(function (bl) {
      var x = bl.u * w, y = stringY(bl.string, bl.u) + 6;
      var tw = 0.55 + 0.45 * Math.abs(Math.sin(now / 700 + bl.t));
      var col = flash > 0 && Math.floor(now / 120) % 2 ? '#fff3c4' : bl.c;
      var glow = ctx.createRadialGradient(x, y, 0, x, y, 16 + flash * 14);
      glow.addColorStop(0, col); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (0.35 + flash * 0.5) * tw;
      ctx.fillStyle = glow;
      ctx.fillRect(x - 32, y - 32, 64, 64);
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fill();
    });
    // confetti
    scene.particles = scene.particles.filter(function (p) {
      p.life -= dt; p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.a += dt * 8;
      if (p.life <= 0 || p.y > h) return false;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.c; ctx.fillRect(-3, -1.5 - p.r / 2, 6, 3 + p.r);
      ctx.restore();
      return true;
    });
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    var dt = scene.lastT ? Math.min(0.05, (now - scene.lastT) / 1000) : 0.016;
    scene.lastT = now;
    draw(now, dt);
    stepDice(now, dt);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- page
  var announced = false;
  function maybeReady() {
    if (announced || !(S.gotSnapshot || S.demo)) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 6000);

  $('back').onclick = function () { sfx('click'); game.back(); };
  $('sound').onclick = function () { setSound(!audio.sound); sfx('click'); };
  $('music').onclick = function () {
    audio.music = !audio.music;
    try { localStorage.setItem('sevenup-music', audio.music ? 'on' : 'off'); } catch (e) { /* ignore */ }
    syncMusic();
  };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  $('clientSeed').onchange = clientSeed;
  document.querySelectorAll('.bets__tab').forEach(function (b) {
    b.onclick = function () {
      sfx('click');
      tab = b.dataset.tab;
      document.querySelectorAll('.bets__tab').forEach(function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      renderList();
    };
  });

  window.addEventListener('resize', fit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    ['.history', '.bets', '.top', '.stage'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); });
  }
  game.theme('#170a33');
  clientSeed();
  setFacesInstant([3, 4]);
  setSound(audio.sound);
  syncMusic();
  selectChoice(choice);
  $('hint').textContent = 'Make your call — then roll';
  fit();
  render();
  requestAnimationFrame(frame);
})();
