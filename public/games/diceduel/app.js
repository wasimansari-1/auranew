/* Dice Duel — NEXORNG original instant dice game (88.0037). Your die (teal) against the house
 * die (crimson): higher wins, a tie returns your bet. Game logic and money: ../_core/
 * instant-client.js (NXInstant); this file is the look, the dice and the sound. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXInstant.start({ event: '88.0037', rules: 'diceduel', onChange: render, onSignal: onSignal });
  var S = game.S;
  var MIN_ROLL_MS = 1100, HOUSE_DELAY_MS = 700, VERDICT_DELAY_MS = 420;

  // ---------------------------------------------------------------- sound (WebAudio)
  var soundOn = readFlag('diceduel-sound'), musicOn = readFlag('diceduel-music');
  var ac = null, master = null, musicGain = null, musicTimer = null;
  function readFlag(k) { try { return localStorage.getItem(k) !== 'off'; } catch (e) { return true; } }
  function saveFlag(k, on) { try { localStorage.setItem(k, on ? 'on' : 'off'); } catch (e) { /* ignore */ } }
  function audio() {
    if (!ac) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
      musicGain = ac.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
    }
    if (ac.state === 'suspended') ac.resume().catch(function () {});
    return ac;
  }
  function tone(freq, dur, type, vol, when, glideTo) {
    var a = audio(); if (!a) return;
    var t = a.currentTime + (when || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var noiseBuf = null;
  function noise(dur, freq, vol, when) {
    var a = audio(); if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t = a.currentTime + (when || 0), src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  var sfx = {
    click: function () { tone(1250, 0.05, 'triangle', 0.12); },
    rattle: function () { noise(0.05, 2200 + Math.random() * 1600, 0.35); tone(700 + Math.random() * 500, 0.03, 'square', 0.03); },
    thud: function () { tone(110, 0.22, 'sine', 0.5, 0, 55); noise(0.06, 900, 0.3); },
    clash: function () { tone(660, 0.35, 'square', 0.08); tone(990, 0.3, 'square', 0.06, 0.02); noise(0.2, 5200, 0.12); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.34, 'triangle', 0.22, i * 0.09); }); tone(1568, 0.6, 'sine', 0.1, 0.36); },
    lose: function () { tone(330, 0.5, 'sawtooth', 0.09, 0, 110); tone(220, 0.55, 'triangle', 0.12, 0.08, 90); },
    push: function () { tone(440, 0.22, 'triangle', 0.16); tone(440, 0.3, 'triangle', 0.14, 0.2); },
  };
  function play(name) { if (soundOn && sfx[name]) sfx[name](); }

  // Generated music: a slow minor pad with a soft pulse (only after a tap — browser rule).
  var CHORDS = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]];
  var chordAt = 0;
  function musicStep() {
    var a = audio(); if (!a) return;
    var t = a.currentTime, chord = CHORDS[chordAt++ % CHORDS.length];
    chord.forEach(function (f) {
      var o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = f / 2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.9);
      o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 4);
    });
    [0, 1, 2, 3].forEach(function (i) { // soft heartbeat pulse
      var o = a.createOscillator(), g = a.createGain();
      o.frequency.setValueAtTime(70, t + i); o.frequency.exponentialRampToValueAtTime(40, t + i + 0.25);
      g.gain.setValueAtTime(0.0001, t + i); g.gain.exponentialRampToValueAtTime(i % 2 ? 0.05 : 0.09, t + i + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i + 0.3);
      o.connect(g); g.connect(musicGain); o.start(t + i); o.stop(t + i + 0.35);
    });
  }
  function syncMusic() {
    var want = musicOn && !document.hidden;
    if (want && !musicTimer) {
      var a = audio(); if (!a) return;
      musicGain.gain.setTargetAtTime(0.9, a.currentTime, 0.6);
      musicStep();
      musicTimer = setInterval(musicStep, 4000);
    } else if (!want && musicTimer) {
      clearInterval(musicTimer); musicTimer = null;
      if (ac) musicGain.gain.setTargetAtTime(0, ac.currentTime, 0.2);
    }
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  // Browsers allow sound only after a tap: try at once, then start on the first tap.
  window.addEventListener('pointerdown', function first() {
    window.removeEventListener('pointerdown', first, true);
    audio(); syncMusic();
  }, true);
  document.addEventListener('visibilitychange', syncMusic);

  // ---------------------------------------------------------------- dice
  var PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  var FACE = { 1: 'rotateY(0deg)', 6: 'rotateY(180deg)', 2: 'rotateY(90deg)', 5: 'rotateY(-90deg)', 3: 'rotateX(90deg)', 4: 'rotateX(-90deg)' };
  var SHOW = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] }; // cube turn that faces a value to us
  var TILT = 'rotateX(-16deg) rotateY(20deg) ';
  function buildDie(el) {
    for (var v = 1; v <= 6; v++) {
      var f = document.createElement('div');
      f.className = 'die__face';
      f.style.transform = FACE[v] + ' translateZ(calc(var(--die) / 2))';
      for (var c = 1; c <= 9; c++) {
        var cell = document.createElement('span');
        if (PIPS[v].indexOf(c) >= 0) cell.className = 'pip';
        cell.style.gridArea = Math.ceil(c / 3) + ' / ' + (((c - 1) % 3) + 1);
        f.appendChild(cell);
      }
      el.appendChild(f);
    }
  }
  var dice = {
    you: { el: $('dieYou'), wrap: $('dieYou').parentNode, side: $('sideYou'), val: $('valYou'), spins: 0, value: 5 },
    house: { el: $('dieHouse'), wrap: $('dieHouse').parentNode, side: $('sideHouse'), val: $('valHouse'), spins: 0, value: 2 },
  };
  function show(d, v, instant) {
    d.value = v;
    d.spins += 2;
    var r = SHOW[v], t = TILT + 'rotateX(' + (r[0] + 360 * d.spins) + 'deg) rotateY(' + (r[1] + 360 * d.spins) + 'deg)';
    if (instant) { d.el.style.transition = 'none'; d.el.style.transform = t; void d.el.offsetWidth; d.el.style.transition = ''; return; }
    d.el.style.transform = t;
  }
  function tumble(d) {
    d.el.classList.add('die--tumble');
    d.wrap.classList.add('die-wrap--air');
    d.wrap.classList.remove('die-wrap--land');
  }
  function land(d, v) {
    // continue from where the tumble is right now, then settle on the value
    var now = getComputedStyle(d.el).transform;
    d.el.classList.remove('die--tumble');
    d.wrap.classList.remove('die-wrap--air');
    d.el.style.transition = 'none';
    d.el.style.transform = now === 'none' ? '' : now;
    void d.el.offsetWidth;
    d.el.style.transition = '';
    show(d, v);
    d.wrap.classList.add('die-wrap--land');
    play('thud');
  }
  buildDie(dice.you.el); buildDie(dice.house.el);
  show(dice.you, 5, true); show(dice.house, 2, true);

  // ---------------------------------------------------------------- the duel
  var busy = false, rattleTimer = null, shownBalance = null;
  var record = { w: 0, p: 0, l: 0, net: 0 };
  var auto = { pick: 0, left: 0 };
  var LINES = ['Higher die wins · a tie returns your bet', 'Step into the arena', 'Your die against the house', 'Roll when you are ready', 'Face the house'];
  var lineAt = 0;

  function clientSeed() {
    var v = $('clientSeed').value.trim().slice(0, 64);
    try { localStorage.setItem('diceduel-client-seed', v); } catch (e) { /* ignore */ }
    return v;
  }
  (function initSeed() {
    var v = '';
    try { v = localStorage.getItem('diceduel-client-seed') || ''; } catch (e) { /* ignore */ }
    if (!v) { var b = new Uint8Array(6); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.fill(7); v = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
    $('clientSeed').value = v;
  })();

  function readAmount() {
    var v = Number(String($('amount').value).replace(',', '.'));
    return isFinite(v) && v > 0 ? game.round2(v) : 0;
  }

  function startRoll() {
    if (busy) return;
    var amount = readAmount();
    if (!amount) return toast('Enter a valid amount.', 'error');
    busy = true;
    var t0 = Date.now();
    hideVerdict();
    [dice.you, dice.house].forEach(function (d) { d.side.classList.remove('side--winner', 'side--loser'); d.val.textContent = '?'; tumble(d); });
    $('hint').textContent = 'The dice are rolling…';
    if (soundOn) rattleTimer = setInterval(function () { play('rattle'); }, 85);
    scene.charge = 1;
    updateButton();
    var p;
    try { p = game.roll(amount, {}, clientSeed()); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (res) {
      if (!res || !res.dice) return abort();
      var wait = Math.max(0, t0 + MIN_ROLL_MS - Date.now());
      setTimeout(function () { reveal(res, amount); }, wait);
    }, function () { abort(); });
  }

  function stopRattle(playerOnly) {
    if (rattleTimer && !playerOnly) { clearInterval(rattleTimer); rattleTimer = null; }
  }

  function abort() {
    stopRattle();
    [dice.you, dice.house].forEach(function (d) { land(d, d.value); d.val.textContent = '?'; });
    busy = false;
    auto.left = 0;
    $('hint').textContent = LINES[0];
    scene.charge = 0;
    render();
  }

  function reveal(res, amount) {
    var you = res.dice[0], house = res.dice[1];
    land(dice.you, you);
    dice.you.val.textContent = you;
    setTimeout(function () {
      stopRattle();
      land(dice.house, house);
      dice.house.val.textContent = house;
      play('clash');
      var vs = document.querySelector('.vs');
      vs.classList.remove('vs--clash'); void vs.offsetWidth; vs.classList.add('vs--clash');
      setTimeout(function () { verdict(res, amount); }, VERDICT_DELAY_MS);
    }, HOUSE_DELAY_MS);
  }

  function verdict(res, amount) {
    var win = Number(res.win) || 0;
    var kind = res.push ? 'push' : res.won ? 'win' : 'lose';
    if (kind === 'win') {
      record.w++; record.net = game.round2(record.net + win - amount);
      showVerdict('win', 'YOU WIN', '+' + game.money(win) + ' · ' + Number(res.x).toFixed(2) + 'x');
      dice.you.side.classList.add('side--winner'); dice.house.side.classList.add('side--loser');
      play('win'); burst('win');
    } else if (kind === 'push') {
      record.p++;
      showVerdict('push', 'PUSH', 'Tie — your bet is returned');
      play('push'); burst('push');
    } else {
      record.l++; record.net = game.round2(record.net - amount);
      showVerdict('lose', 'HOUSE WINS', '−' + game.money(amount));
      dice.house.side.classList.add('side--winner'); dice.you.side.classList.add('side--loser');
      play('lose'); burst('lose');
    }
    game.reveal(); // the duel is decided on screen: now the balance and lists show the result
    fairFrom(res);
    scene.charge = 0;
    busy = false;
    shownBalance = S.balance;
    $('hint').textContent = LINES[(++lineAt) % LINES.length];
    render();
    if (auto.left > 0) {
      auto.left--;
      if (auto.left > 0 && !(kind === 'win' && $('stopOnWin').checked)) setTimeout(function () { if (auto.left > 0 && !busy) startRoll(); }, 1100);
      else auto.left = 0;
      render();
    }
  }

  function showVerdict(kind, title, sub) {
    var v = $('verdict');
    v.className = 'verdict verdict--' + kind;
    setText($('verdictTitle'), title);
    setText($('verdictSub'), sub);
    v.hidden = false;
    $('hint').hidden = true; // the verdict takes the hint's place
  }
  function hideVerdict() { $('verdict').hidden = true; $('hint').hidden = false; }

  function onSignal(name, d) {
    if (name === 'error') { toast((d && d.text) || 'Something went wrong.', 'error'); }
    // 'roll' and 'result': the duel animation is driven by the roll() promise above
  }

  // ---------------------------------------------------------------- render (no re-render of tapped controls)
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  var announced = false, tab = 'all';
  function render() {
    if (!announced && S.gotSnapshot) { announced = true; game.ready(); }
    $('conn').hidden = S.demo || S.connected || !S.gotSnapshot;
    if (!busy) shownBalance = S.balance; // during a roll the balance waits for the reveal
    setText($('balance'), shownBalance == null ? '—' : game.money(shownBalance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');
    renderHistory();
    updateButton();
    renderRecord();
    renderList();
  }

  function updateButton() {
    var btn = $('roll'), x = game.multiplier({}), amount = readAmount();
    setText($('payX'), x ? x.toFixed(2) + 'x' : '—');
    setText($('payWin'), amount && x ? game.money(game.round2(amount * x)) : '—');
    var cls = 'action', label = 'Roll', sub = amount ? 'Win ' + game.money(game.round2(amount * x)) : '', disabled = false;
    if (auto.left > 0) { cls = 'action action--stop'; label = 'Stop'; sub = auto.left + ' duel' + (auto.left === 1 ? '' : 's') + ' left'; }
    else if (busy) { label = 'Rolling…'; sub = ''; disabled = true; }
    else if (auto.pick > 0) sub = 'Auto · ' + auto.pick + ' duels';
    if (btn.className !== cls) btn.className = cls;
    if (btn.disabled !== disabled) btn.disabled = disabled;
    setText($('rollLabel'), label);
    setText($('rollSub'), sub);
  }

  function renderHistory() {
    var h = $('history'), key = JSON.stringify((S.history || []).slice(0, 20));
    if (h.dataset.key === key) return;
    h.dataset.key = key;
    h.innerHTML = '';
    if (!S.history || !S.history.length) {
      var e = document.createElement('span'); e.className = 'chip chip--empty'; e.textContent = 'Your duels show here'; h.appendChild(e); return;
    }
    S.history.slice(0, 20).forEach(function (r) {
      var c = document.createElement('span');
      c.className = 'chip ' + (r.push ? 'chip--push' : r.won ? 'chip--win' : 'chip--lose');
      c.textContent = r.dice ? r.dice[0] + ':' + r.dice[1] : '';
      h.appendChild(c);
    });
  }

  function renderRecord() {
    setText($('recW'), String(record.w));
    setText($('recP'), String(record.p));
    setText($('recL'), String(record.l));
    setText($('recNet'), (record.net > 0 ? '+' : record.net < 0 ? '−' : '') + Math.abs(record.net).toFixed(2));
    $('recNet').style.color = record.net > 0 ? 'var(--gold)' : record.net < 0 ? '#ff8a9c' : '';
  }

  function hue(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return h % 360; }
  function cell(text, cls) { var s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; return s; }
  function duelCell(d) {
    var s = document.createElement('span'); s.className = 'row__duel';
    if (!d || d.length < 2) { s.textContent = '-'; return s; }
    var b = document.createElement('b'); b.textContent = d[0];
    var i = document.createElement('i'); i.textContent = d[1];
    s.appendChild(b); s.appendChild(document.createTextNode(' : ')); s.appendChild(i);
    return s;
  }
  function renderList() {
    var rows = tab === 'all' ? (S.bets || []) : (S.myBets || []);
    var key = tab + JSON.stringify(rows.slice(0, 30));
    var list = $('list');
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.innerHTML = '';
    if (!rows.length) { list.appendChild(cell(tab === 'all' ? 'No duels yet — be the first.' : 'Your duels this visit show here.', 'empty')); return; }
    rows.slice(0, 30).forEach(function (r) {
      var won = r.won != null ? r.won : Number(r.win) > Number(r.amount);
      var row = document.createElement('div');
      row.className = 'row' + (won && Number(r.x) > 1 ? ' row--win' : '') + (r.mine ? ' row--mine' : '');
      var who = document.createElement('span'); who.className = 'row__player';
      var name = tab === 'all' ? (r.player || 'Player') : new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var av = document.createElement('i'); av.className = 'row__avatar';
      av.style.background = 'hsl(' + hue(String(name)) + ',55%,42%)';
      av.textContent = tab === 'all' ? String(name).replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?' : '•';
      who.appendChild(av); who.appendChild(cell(String(name)));
      row.appendChild(who);
      row.appendChild(cell(Number(r.amount).toFixed(2)));
      row.appendChild(duelCell(r.dice));
      row.appendChild(cell(Number(r.win) > 0 ? Number(r.win).toFixed(2) : '-', 'row__win'));
      list.appendChild(row);
    });
  }

  function fairFrom(res) {
    var last = S.last || {};
    var round = res.round != null ? res.round : last.round;
    setText($('fRound'), round != null ? String(round) : '—');
    setText($('fHash'), res.hash || last.hash || (S.demo ? 'demo roll (local)' : '—'));
    setText($('fSeed'), res.seed || last.seed || (S.demo ? 'demo roll (local)' : '—'));
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
      b.onclick = function () { play('click'); setAmount(v); };
      q.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { buildQuick(); setAmount(l.min); });

  $('minus').onclick = function () { play('click'); setAmount(readAmount() - game.limit().min); };
  $('plus').onclick = function () { play('click'); setAmount(readAmount() + game.limit().min); };
  $('amount').oninput = updateButton;
  $('amount').onblur = function () { setAmount(readAmount() || game.limit().min); };
  $('roll').onclick = function () {
    play('click');
    if (auto.left > 0) { auto.left = 0; return updateButton(); } // stop auto duels
    if (busy) return;
    if (auto.pick > 0) auto.left = auto.pick;
    startRoll();
  };
  [0, 5, 10, 25, 50].forEach(function (n) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = n ? String(n) : 'Off';
    b.setAttribute('aria-pressed', String(n === 0));
    b.onclick = function () {
      play('click');
      auto.pick = n;
      Array.prototype.forEach.call($('autoChips').children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      updateButton();
    };
    $('autoChips').appendChild(b);
  });
  $('back').onclick = function () { play('click'); game.back(); };
  $('sound').onclick = function () {
    soundOn = !soundOn; saveFlag('diceduel-sound', soundOn);
    $('sound').setAttribute('aria-pressed', String(soundOn));
    $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    play('click');
  };
  $('music').onclick = function () { musicOn = !musicOn; saveFlag('diceduel-music', musicOn); syncMusic(); };
  $('sound').setAttribute('aria-pressed', String(soundOn));
  $('fair').onclick = function () {
    var d = $('fairDetail'); d.hidden = !d.hidden;
    $('fair').setAttribute('aria-expanded', String(!d.hidden));
  };
  $('clientSeed').onchange = clientSeed;
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

  // ---------------------------------------------------------------- arena scene (canvas)
  var canvas = $('scene'), ctx = canvas.getContext('2d'), stageEl = document.querySelector('.stage'), arena = $('arena');
  var FULL_W = 0, FULL_H = 0, LEFT = 0, TOP = 0, W = 0, H = 0, youX = 0, houseX = 0, diceY = 0, dieSize = 96;
  var scene = { charge: 0, glow: 0, particles: [], embers: [] };
  for (var i = 0; i < 26; i++) scene.embers.push({ x: Math.random(), y: Math.random(), v: 0.02 + Math.random() * 0.05, r: 0.6 + Math.random() * 1.6, p: Math.random() * 6 });

  function fit() {
    var r = stageEl.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    FULL_W = r.width; FULL_H = r.height;
    var bar = document.querySelector('.top').getBoundingClientRect();
    TOP = Math.max(0, bar.bottom - r.top + 6);
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : FULL_H;
    W = FULL_W - LEFT; H = Math.max(160, playBottom - TOP);
    stageEl.style.setProperty('--below', Math.max(0, FULL_H - playBottom) + 'px');
    stageEl.style.setProperty('--left', LEFT + 'px');
    var a = arena.style;
    a.left = LEFT + 'px'; a.top = TOP + 'px'; a.width = W + 'px'; a.height = H + 'px';
    dieSize = Math.round(Math.max(54, Math.min(W * 0.22, H * 0.3, 220)));
    arena.style.setProperty('--die', dieSize + 'px');
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a round is added to it).
    var bufW = Math.round(FULL_W * dpr), bufH = Math.round(FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var ry = dice.you.wrap.getBoundingClientRect(), rh = dice.house.wrap.getBoundingClientRect();
    youX = ry.left + ry.width / 2 - r.left; houseX = rh.left + rh.width / 2 - r.left; diceY = ry.top + ry.height / 2 - r.top;
  }

  function burst(kind) {
    var x = kind === 'lose' ? houseX : kind === 'win' ? youX : (youX + houseX) / 2;
    var colors = kind === 'win' ? ['#ffc94d', '#fff1c2', '#2ee6c5', '#ffde85'] : kind === 'lose' ? ['#ff3d5a', '#ff8a9c', '#b3122e'] : ['#cbbcf0', '#a99ac8', '#fff'];
    var n = kind === 'win' ? 90 : 46;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, s = (kind === 'win' ? 3 : 2) + Math.random() * 4;
      scene.particles.push({ x: x, y: diceY, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3, life: 1, c: colors[i % colors.length], r: 2 + Math.random() * 3, rot: Math.random() * 6 });
    }
    scene.glow = kind === 'win' ? 1 : 0.6;
    scene.glowKind = kind;
  }

  function spot(x, y, color, alpha, spread) {
    var g = ctx.createRadialGradient(x, y + H * 0.15, 0, x, y + H * 0.15, spread);
    g.addColorStop(0, color.replace('A', alpha));
    g.addColorStop(1, color.replace('A', 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - spread, y - spread, spread * 2, spread * 2);
  }

  var lastT = 0;
  function frame(now) {
    var dt = lastT ? Math.min(60, now - lastT) : 16; lastT = now;
    if (FULL_W) {
      ctx.clearRect(0, 0, FULL_W, FULL_H);
      var sky = ctx.createLinearGradient(0, 0, 0, FULL_H);
      sky.addColorStop(0, '#0b0716'); sky.addColorStop(0.55, '#170d2c'); sky.addColorStop(1, '#0b0716');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, FULL_W, FULL_H);
      // arena floor: an ellipse with perspective rings, under the dice
      var cx = LEFT + W / 2, floorY = diceY + dieSize * 0.75;
      ctx.save();
      ctx.translate(cx, floorY);
      ctx.scale(1, 0.26);
      var fr = Math.max(W * 0.48, 200);
      var fg = ctx.createRadialGradient(0, 0, 0, 0, 0, fr);
      fg.addColorStop(0, 'rgba(70, 44, 120, 0.85)'); fg.addColorStop(0.7, 'rgba(36, 22, 64, 0.6)'); fg.addColorStop(1, 'rgba(11, 7, 22, 0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, fr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 201, 77, 0.18)'; ctx.lineWidth = 3;
      [0.45, 0.72, 0.95].forEach(function (k) { ctx.beginPath(); ctx.arc(0, 0, fr * k, 0, Math.PI * 2); ctx.stroke(); });
      ctx.restore();
      // spotlights (sway gently; brighter while the dice roll)
      var sway = Math.sin(now / 1400) * W * 0.02, boost = 0.16 + scene.charge * 0.12 + Math.sin(now / 90) * 0.03 * scene.charge;
      spot(youX + sway, diceY, 'rgba(46, 230, 197, A)', boost, Math.max(H * 0.55, 160));
      spot(houseX - sway, diceY, 'rgba(255, 61, 90, A)', boost, Math.max(H * 0.55, 160));
      spot(cx, diceY, 'rgba(255, 201, 77, A)', 0.12 + scene.charge * 0.1, Math.max(H * 0.3, 90));
      // win / lose glow on the winner's side
      if (scene.glow > 0) {
        var gx = scene.glowKind === 'lose' ? houseX : scene.glowKind === 'win' ? youX : cx;
        spot(gx, diceY, scene.glowKind === 'lose' ? 'rgba(255, 61, 90, A)' : scene.glowKind === 'win' ? 'rgba(255, 201, 77, A)' : 'rgba(203, 188, 240, A)', 0.45 * scene.glow, Math.max(H * 0.5, 150));
        scene.glow = Math.max(0, scene.glow - dt / 1600);
      }
      // drifting embers
      scene.embers.forEach(function (e) {
        e.y -= e.v * dt / 1000; if (e.y < -0.05) { e.y = 1.05; e.x = Math.random(); }
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(now / 600 + e.p);
        ctx.fillStyle = '#ffc94d';
        ctx.beginPath(); ctx.arc(LEFT + e.x * W, e.y * FULL_H, e.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      // result particles
      scene.particles = scene.particles.filter(function (p) {
        p.x += p.vx * dt / 16; p.y += p.vy * dt / 16; p.vy += 0.16 * dt / 16; p.life -= dt / 1300; p.rot += 0.2;
        if (p.life <= 0) return false;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
        return true;
      });
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- start
  game.theme('#0b0716'); // browser bar = the arena's top colour
  $('hint').textContent = LINES[0];
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    [stageEl, '.history', '.bets', '.top'].forEach(function (s) { var e = typeof s === 'string' ? document.querySelector(s) : s; if (e) ro.observe(e); });
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000); // never hang the loader
  fit();
  render();
  syncMusic();
  requestAnimationFrame(frame);
})();
