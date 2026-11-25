/* Gold Digger — the bet panel, lists, results and screen layout (the NEXORNG Arcade solo shell,
 * with Gold Digger's text placement and ready-after-first-screen). Game logic:
 * ../_core/solo-client.js (each player plays their own round). The look and the sounds:
 * scene.js (window.GameScene / window.GameAudio). The game id comes from <body data-event>. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var CFG = document.body.dataset; // event, key, and this game's button words (bet, cashout, won)
  var WORD = { bet: CFG.bet || 'Bet', cashout: CFG.cashout || 'Cash Out', won: CFG.won || 'You won' };
  var game = NXSolo.start({ event: CFG.event, onChange: render, onSignal: onSignal });
  var S = game.S;
  var scene = GameScene.create($('scene'), { onLoad: function () { maybeReady(); } });
  var audio = GameAudio;

  // ---------------------------------------------------------------- round timeline
  var betAmount = 0, lastWin = 0, wonAt = 0;
  var T = { startedAt: 0, endedAt: 0 }; // performance.now() of the round's start / end

  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') { T.startedAt = now; T.endedAt = 0; scene.onStart(now); audio.start(); }
    if (name === 'win') { T.endedAt = now; lastWin = d.win; wonAt = now; scene.onWin(now, d.x); audio.win(); } // the win shows in the scene (gold multiplier + the amount counting up)
    if (name === 'bust') { T.endedAt = now; scene.onBust(now, d.crashPoint); audio.bust(); }
    if (name === 'error') toast(d.text, 'error');
    render();
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

  // ---------------------------------------------------------------- panel
  function readAmount() {
    var v = Number(String($('amount').value).replace(',', '.'));
    return isFinite(v) && v > 0 ? game.round2(v) : 0;
  }
  function readAuto() {
    if (!$('autoOn').checked) return 0;
    var v = Number(String($('autoAt').value).replace(',', '.'));
    return isFinite(v) && v >= 1.01 ? Math.round(v * 100) / 100 : 0;
  }
  function setAmount(v) {
    var l = game.limit();
    v = Math.max(l.min, game.round2(v));
    if (l.max) v = Math.min(l.max, v);
    $('amount').value = v.toFixed(2);
    // the game's own stake display (gauge needle / dial) follows the amount: 0 at the min, 1 at the max
    var k = l.max > l.min ? Math.log(v / l.min) / Math.log(l.max / l.min) : 0;
    document.body.style.setProperty('--stake', Math.max(0, Math.min(1, k)).toFixed(3));
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
      b.innerHTML = '<span></span>';
      b.firstChild.textContent = game.money(v).replace(/\.00$/, '');
      b.onclick = function () { audio.click(); setAmount(v); };
      q.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { buildQuick(); setAmount(l.min); });

  // The button is built once; only its texts / class change (and only when they differ), so a
  // tap never lands on an element that is being replaced.
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function updateButton() {
    var cls = 'action', label = WORD.bet, sub = game.money(readAmount()), disabled = false;
    if (S.phase === 'starting') {
      cls = 'action action--waiting'; label = 'Placing bet…'; sub = ''; disabled = true;
    } else if (S.phase === 'running' && !T.startedAt) {
      cls = 'action action--waiting'; label = 'Get ready'; sub = game.money(betAmount); disabled = true;
    } else if (S.phase === 'running') {
      cls = 'action action--cashout'; label = WORD.cashout; sub = game.money(game.round2(betAmount * game.currentMult()));
    } else if (S.phase === 'busted') {
      cls = 'action action--lost'; label = S.crashPhrase || 'Round over'; sub = S.crashPoint ? S.crashPoint.toFixed(2) + 'x' : ''; disabled = true;
    } else if (S.phase === 'cashed') {
      cls = 'action action--won'; label = WORD.won; sub = game.money(lastWin); disabled = true;
    }
    var btn = $('action');
    if (btn.className !== cls) btn.className = cls;
    if (btn.disabled !== disabled) btn.disabled = disabled;
    setText($('actionLabel'), label);
    setText($('actionSub'), sub);
  }

  $('minus').onclick = function () { audio.click(); setAmount(readAmount() - game.limit().min); };
  $('plus').onclick = function () { audio.click(); setAmount(readAmount() + game.limit().min); };
  $('amount').oninput = updateButton;
  $('amount').onblur = function () { setAmount(readAmount() || game.limit().min); };
  $('action').onclick = function () {
    audio.unlock();
    audio.click();
    if (S.phase === 'running' && T.startedAt) return game.cashOut();
    if (S.phase !== 'idle') return;
    betAmount = readAmount();
    T.startedAt = 0; T.endedAt = 0;
    game.play(betAmount, readAuto());
  };

  // ---------------------------------------------------------------- lists
  var tab = 'all';
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
      setText($('countLabel'), 'All bets');
      setText($('betCount'), String(S.bets.length));
      $('cols').innerHTML = '<span>Player</span><span>Bet</span><span>X</span><span>Win</span>';
      if (!S.bets.length) list.appendChild(cell('Results from every player show here.', 'empty'));
      S.bets.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--won' : '') + (b.mine ? ' row--mine' : '');
        row.appendChild(cell(b.mine ? 'You' : b.player));
        row.appendChild(cell(Number(b.amount).toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : b.done ? '—' : '…', 'row__x'));
        row.appendChild(cell(b.x ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      setText($('countLabel'), 'My bets');
      setText($('betCount'), String(S.myBets.length));
      $('cols').innerHTML = '<span>Time</span><span>Bet</span><span>X</span><span>Win</span>';
      if (!S.myBets.length) list.appendChild(cell('Your rounds this visit show here.', 'empty'));
      S.myBets.forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--won' : '');
        row.appendChild(cell(new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
        row.appendChild(cell(b.amount.toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '-', 'row__x'));
        row.appendChild(cell(b.win ? b.win.toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    }
  }

  // ---------------------------------------------------------------- render (state changes)
  var histKey = '';
  function render() {
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot || S.demo;
    setText($('balance'), S.balance == null ? '—' : game.money(S.balance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    // results row: rebuilt only when it changes (the newest chip slides in once)
    var hk = S.history.length + ':' + (S.history[0] ? S.history[0].x : '');
    if (hk !== histKey) {
      var h = $('history'), fresh = histKey !== '';
      histKey = hk;
      h.innerHTML = '';
      if (!S.history.length) h.appendChild(cell('Your results show here', 'history__empty'));
      S.history.forEach(function (r, i) {
        h.appendChild(cell(r.x.toFixed(2) + 'x', 'chip' + (r.busted ? '' : ' chip--won') + (i === 0 && fresh ? ' chip--new' : '')));
      });
    }

    updateButton();
    renderList();
    setText($('fHash'), S.roundHash || '—');
    setText($('fSeed'), S.seed || 'revealed when your round ends');
  }

  // ---------------------------------------------------------------- layout (play area)
  // The scene fills the whole stage (under the floating top bar; on wide screens also behind
  // the bets list, the results row and the panel). The play area is the clear part: right of
  // the bets list (LEFT), below the bar (TOP), above the results row.
  var stageEl = document.querySelector('.stage'), canvas = $('scene');
  var view = { W: 0, H: 0, TOP: 0, LEFT: 0, FULL_W: 0, FULL_H: 0, dpr: 1 };
  function fit() {
    var r = stageEl.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var bar = document.querySelector('.top').getBoundingClientRect();
    var list = document.querySelector('.bets').getBoundingClientRect();
    var hist = document.querySelector('.history').getBoundingClientRect();
    var TOP = Math.max(0, bar.bottom - r.top + 6);
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    var LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : r.height;
    view = { W: r.width - LEFT, H: Math.max(120, playBottom - TOP), TOP: TOP, LEFT: LEFT, FULL_W: r.width, FULL_H: r.height, dpr: dpr };
    stageEl.style.setProperty('--below', Math.max(0, r.height - playBottom) + 'px');
    stageEl.style.setProperty('--left', LEFT + 'px');
    // texts: top-centre of the play area (phone: just under the bar; desktop: as high as the
    // design puts them — the bar's middle is free there), sized to the play area
    var PH = TOP + view.H, textTop = window.innerWidth >= 900 ? Math.round(PH * 0.05) : TOP - 2;
    var c = document.querySelector('.stage__center').style;
    c.left = LEFT + 'px'; c.top = textTop + 'px'; c.width = view.W + 'px'; c.height = (PH - textTop) + 'px';
    var m = Math.min(view.W * 1.1, PH), mf = Math.round(m * (window.innerWidth >= 900 ? 0.15 : 0.135)), tf = Math.max(13, Math.round(m * 0.045));
    stageEl.style.setProperty('--mf', mf + 'px');
    stageEl.style.setProperty('--tf', tf + 'px');
    view.TEXT_BOTTOM = textTop + Math.ceil(mf * 1.12 + tf * 1.2 + 4); // the miner's helmet stays below the text block
    var cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
    if (canvas.width !== cw) canvas.width = cw; // setting a canvas size clears it: only on a real change
    if (canvas.height !== ch) canvas.height = ch;
    scene.resize(view);
    if (started) draw(performance.now(), 0); // redraw now: a ResizeObserver runs after this frame's drawing
  }
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    ['.history', '.bets', '.top'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); });
  }

  // ---------------------------------------------------------------- frame loop
  var lastT = 0, themeAt = 0, started = false;
  function frame(now) {
    var dt = lastT ? Math.min(100, now - lastT) : 16;
    lastT = now;
    draw(now, dt);
    requestAnimationFrame(frame);
  }
  function draw(now, dt) {
    started = true;
    var phase = S.phase === 'running' && !T.startedAt ? 'launch' : S.phase;
    var mult = S.phase === 'running' ? game.currentMult() : S.mult;
    scene.frame(now, dt, { phase: phase, mult: mult, crashPoint: S.crashPoint, startedAt: T.startedAt, endedAt: T.endedAt });
    audio.loop(S.phase === 'running' && !!T.startedAt, mult);
    if (now - themeAt > 400) { themeAt = now; game.theme(scene.topColor()); }

    // texts: the multiplier fades in/out (keeping its last value while it fades), new lines ease in
    var m = $('mult'), hint = $('hint'), flew = $('flew');
    if (S.phase === 'running' && T.startedAt) {
      setClass(m, 'mult');
      setText(m, mult.toFixed(2) + 'x'); swap(hint, ''); flew.hidden = true;
      updateButton(); // the live cash-out amount
    } else if (S.phase === 'busted' || (S.phase === 'idle' && scene.caveIn())) { // the result stays until the cave-in has settled
      setClass(m, 'mult mult--lost');
      if (S.phase === 'busted') setText(m, (S.crashPoint || S.mult).toFixed(2) + 'x');
      swap(hint, '');
      flew.hidden = false; swap(flew, S.crashPhrase);
    } else if (S.phase === 'cashed') {
      setClass(m, 'mult mult--won');
      setText(m, S.mult.toFixed(2) + 'x'); flew.hidden = true;
      var k = Math.min(1, (now - wonAt) / 900); // the win counts up
      swap(hint, 'Cashed out +' + game.money(game.round2(lastWin * (1 - Math.pow(1 - k, 3)))), true);
    } else {
      setClass(m, 'mult mult--off');
      flew.hidden = true;
      swap(hint, S.phase === 'starting' || S.phase === 'running' ? 'Get ready…' : S.bettingPhrase);
    }
  }
  function setClass(el, c) { if (el.className !== c) el.className = c; }
  function swap(el, text, quiet) { // a new line eases in (not on every count-up step)
    if (el.textContent === text) return;
    var was = el.textContent;
    el.textContent = text;
    if (quiet && was) return;
    el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in');
  }

  // ---------------------------------------------------------------- ready / controls
  var announced = false, firstFrame = false;
  function maybeReady() {
    if (announced || !firstFrame || !scene.ready() || !(S.gotSnapshot || S.demo)) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 6000);

  var tabs = document.querySelectorAll('.bets__tab');
  Array.prototype.forEach.call(tabs, function (b) {
    b.onclick = function () {
      audio.click();
      tab = b.dataset.tab;
      Array.prototype.forEach.call(tabs, function (x) {
        var on = x === b;
        x.className = 'bets__tab' + (on ? ' bets__tab--on' : '');
        x.setAttribute('aria-selected', String(on));
      });
      renderList();
    };
  });
  $('back').onclick = function () { audio.click(); game.back(); };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };

  // sound + music: separate switches, remembered; music tries to start right away
  function pref(name, dflt) {
    try { var v = localStorage.getItem(CFG.key + '-' + name); return v == null ? dflt : v !== 'off'; } catch (e) { return dflt; }
  }
  function savePref(name, on) { try { localStorage.setItem(CFG.key + '-' + name, on ? 'on' : 'off'); } catch (e) { /* ignore */ } }
  var soundOn = pref('sound', true), musicOn = pref('music', true);
  function syncAudio() {
    audio.setSound(soundOn);
    audio.setMusic(musicOn);
    $('sound').setAttribute('aria-pressed', String(soundOn));
    $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  $('sound').onclick = function () { audio.unlock(); soundOn = !soundOn; savePref('sound', soundOn); syncAudio(); audio.click(); };
  $('music').onclick = function () { audio.unlock(); musicOn = !musicOn; savePref('music', musicOn); syncAudio(); };
  window.addEventListener('pointerdown', function () { audio.unlock(); }, true);
  document.addEventListener('visibilitychange', function () { audio.pause(document.hidden); });

  syncAudio();
  audio.unlock(); // the tap that opened the game usually allows sound; else the first tap does
  fit();
  render();
  requestAnimationFrame(function (t) { firstFrame = true; frame(t); maybeReady(); });
})();
