/* Domino Cascade — NEXORNG crash game. Game logic: ../_core/crash-client.js (live rounds from the
 * engine, RTP from the game's row — platform default 97 %); the 3D scene and the sounds: scene.js
 * (window.DominoScene / DominoAudio, three.js in vendor/). This file: the domino-case bet panels
 * (two bets per round; one on phones), the bets list, the results row, the texts over the scene and
 * the screen layout.
 *
 * The first tile is pushed, the cascade runs and the multiplier climbs with it; the round ends when
 * one tile takes the push and stays standing. Players cash out before that.
 */
(function () {
  'use strict';

  // This game's engine event (game ID). Set at deploy; ?event=… overrides it for previews.
  var EVENT = '88.0100';

  var $ = function (id) { return document.getElementById(id); };
  var game = NXCrash.start({ event: EVENT, onChange: render, onSignal: onSignal });
  var S = game.S;
  var audio = DominoAudio;
  var scene = DominoScene.create($('scene'), { onLoad: function () { maybeReady(); } });

  // our own lines (random, never the same twice in a row): while bets are open, and at the hit
  var BETTING = ['The tiles are set', 'Setting a new line', 'Every tile in place', 'Steady hands…', 'The line is ready', 'Place your stake', 'A long line awaits', 'Ivory and gold, all set'];
  var lastBetting = '', bettingLine = pick();
  function pick() {
    var p = BETTING.filter(function (x) { return x !== lastBetting; });
    lastBetting = p[Math.floor(Math.random() * p.length)];
    return lastBetting;
  }
  var crashLine = scene.endPhrase();

  // ---------------------------------------------------------------- engine moments
  var started = false, bettingSeen = false; // a flight was seen starting on this screen (else it was joined mid-flight)
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'betting') { scene.onBetting(now, S.round); started = false; bettingSeen = true; bettingLine = pick(); }
    if (name === 'start') { started = true; scene.onStart(now, false, S.round, 0); }
    if (name === 'crash') { crashLine = scene.endPhrase(); scene.onCrash(now, Math.log(Math.max(1, d.crashPoint)) / game.growth); }
    if (name === 'win') { scene.onWin(now, '+' + game.money(d.win), S.flightStart ? Date.now() - S.flightStart : null); toast(d.text, 'win'); }
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

  // ---------------------------------------------------------------- render (DOM)
  var tab = 'all';
  var playersStrip;
  function render() {
    if (!playersStrip) playersStrip = NXPlayers.create(document.querySelector('.stage'));
    playersStrip.update(S);
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot;
    setText($('balance'), S.balance == null ? '—' : game.money(S.balance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    var hk = S.history.slice(0, 30).join(',');
    if (hk !== histKey) {
      var h = $('history'), fresh = histKey !== '';
      histKey = hk;
      h.innerHTML = '';
      S.history.forEach(function (c, i) {
        var s = document.createElement('span');
        s.className = 'chip' + (c >= 10 ? ' chip--big' : c >= 2 ? ' chip--mid' : '') + (i === 0 && fresh ? ' chip--new' : '');
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
  var histKey = '';
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  // ---------------------------------------------------------------- the domino case
  // Built once (never re-rendered): walnut lid with brass corners, the stake on an ivory plate with
  // brass − / +, quick amounts as ivory tiles, auto cash-out (brass toggle + ebony value) and the
  // big ebony domino = Place bet / Cash out (gold) / Banked (ivory).
  var CUR = (function () { var s = game.money(0).replace(/[\d.,\s ]/g, ''); return s || '€'; })();
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel';
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="case">' +
      '<i class="corner corner--tl"></i><i class="corner corner--tr"></i><i class="corner corner--bl"></i><i class="corner corner--br"></i>' +
      '<div class="case__left">' +
      '<div class="lbl">Stake</div>' +
      '<div class="stake"><button type="button" class="brass key--sym" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<label class="ivory"><span class="ivory__cur"></span><input class="amount" inputmode="decimal" value="1.00" aria-label="Bet amount"></label>' +
      '<button type="button" class="brass key--sym" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="quick" aria-label="Quick amounts"></div>' +
      '<div class="auto"><span class="lbl auto__lbl">Auto<br>cash-out</span>' +
      '<label class="tog"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><i></i></label>' +
      '<label class="ebony"><input class="auto__x" inputmode="decimal" value="2.00" aria-label="Auto cash-out multiplier"><span>x</span></label></div>' +
      '</div>' +
      '<button type="button" class="action"><span class="action__line" aria-hidden="true"></span><span class="action__label">PLACE BET</span><small class="action__sub"></small></button>' +
      '</div>';
    $('panels').appendChild(el);
    var q = function (sel) { return el.querySelector(sel); };
    q('.ivory__cur').textContent = CUR;
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
  function updateButton(p) {
    var my = S.my[p.slot], cls = 'action', label = 'PLACE BET', sub = (S.phase === 'betting' ? '' : 'next · ') + game.money(readAmount(p)), disabled = false;
    var mine = my && my.round === S.round;
    if (S.queued[p.slot]) {
      cls = 'action action--cancel'; label = 'CANCEL'; sub = 'next round';
    } else if (mine && my.status === 'pending') {
      cls = 'action action--waiting'; label = 'PLACING…'; sub = ''; disabled = true;
    } else if (mine && my.status === 'placed' && S.phase === 'betting') {
      cls = 'action action--waiting'; label = 'BET PLACED'; sub = game.money(my.amount); disabled = true;
    } else if (mine && (my.status === 'placed' || my.status === 'cashing') && S.phase === 'flying') {
      cls = 'action action--cashout'; label = 'CASH OUT'; sub = game.money(game.round2(my.amount * game.currentMult())); disabled = my.status === 'cashing';
    } else if (mine && my.status === 'cashed' && S.phase === 'flying') {
      cls = 'action action--done'; label = 'BANKED'; sub = '+' + game.money(my.win || 0); disabled = true;
    }
    if (p.action.className !== cls) p.action.className = cls;
    if (p.action.disabled !== disabled) p.action.disabled = disabled;
    setText(p.label, label);
    if (p.sub.textContent !== sub) { p.sub.textContent = sub; fitLabel(p); }
    if (p.fitFor !== label) { p.fitFor = label; fitLabel(p); }
  }
  // the button's words never wrap or spill: shrink to fit (phones 360–440 px wide)
  function fitLabel(p) {
    [p.label, p.sub].forEach(function (el) {
      el.style.fontSize = '';
      var max = p.action.clientWidth - 16;
      if (max <= 0) return;
      var w = el.scrollWidth, fs = parseFloat(getComputedStyle(el).fontSize);
      if (w > max) el.style.fontSize = Math.max(9, Math.floor(fs * max / w * 10) / 10) + 'px';
    });
  }

  // ---------------------------------------------------------------- bets list
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
      if (!S.bets.length) list.appendChild(cell('No bets yet this round.', 'empty'));
      S.bets.slice().reverse().forEach(function (b) {
        var row = document.createElement('div');
        row.className = 'row' + (b.x ? ' row--cashed' : '') + (b.mine ? ' row--mine' : '');
        row.appendChild(cell(b.mine ? 'You' : b.player, 'row__user'));
        row.appendChild(cell(Number(b.amount).toFixed(2)));
        row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : '-', 'row__x'));
        row.appendChild(cell(b.win ? Number(b.win).toFixed(2) : '-', 'row__win'));
        list.appendChild(row);
      });
    } else {
      setText($('countLabel'), 'My bets');
      setText($('betCount'), String(S.myBets.length));
      $('cols').innerHTML = '<span>Time</span><span>Bet</span><span>X</span><span>Win</span>';
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

  // ---------------------------------------------------------------- layout
  var stageEl = document.querySelector('.stage');
  var view = { W: 0, H: 0, TOP: 0, LEFT: 0, FULL_W: 0, FULL_H: 0, dpr: 1 };
  function fit() {
    var r = stageEl.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var bar = document.querySelector('.top').getBoundingClientRect();
    var list = document.querySelector('.bets').getBoundingClientRect();
    var hist = document.querySelector('.history').getBoundingClientRect();
    var wide = window.innerWidth >= 900;
    var TOP = Math.max(0, bar.bottom - r.top + 6);
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    var LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : r.height;
    view = { W: r.width - LEFT, H: Math.max(120, playBottom - TOP), TOP: TOP, LEFT: LEFT, FULL_W: r.width, FULL_H: r.height, dpr: dpr, wide: wide };
    stageEl.style.setProperty('--below', Math.max(0, r.height - playBottom) + 'px');
    stageEl.style.setProperty('--left', LEFT + 'px');
    // the texts: centred on the play area, at its top (the line runs below them)
    var PH = TOP + view.H, textTop = wide ? Math.round(PH * 0.05) : TOP - 2;
    var c = document.querySelector('.stage__center').style;
    c.left = LEFT + 'px'; c.top = textTop + 'px'; c.width = view.W + 'px'; c.height = (PH - textTop) + 'px';
    var m = Math.min(view.W * 1.1, PH), mf = Math.round(m * (wide ? 0.14 : 0.15)), tf = Math.max(13, Math.round(m * 0.04));
    stageEl.style.setProperty('--mf', mf + 'px');
    stageEl.style.setProperty('--tf', tf + 'px');
    view.TEXT_BOTTOM = textTop + Math.ceil(mf * 1.1 + tf * 1.3 + 4);
    scene.resize(view); // the scene sizes its own canvas (quality tier: pixel ratio)
    panels.forEach(fitLabel);
    if (drawn) draw(performance.now(), 0);
  }
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { fit(); });
    ['.history', '.bets', '.top', '.stage'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); });
  }

  // ---------------------------------------------------------------- every frame
  var lastT = 0, themeAt = 0, drawn = false;
  function frame(now) {
    var dt = lastT ? Math.min(1000, now - lastT) : 16;
    lastT = now;
    draw(now, dt);
    requestAnimationFrame(frame);
  }
  function draw(now, dt) {
    drawn = true;
    var mult = S.phase === 'flying' ? game.currentMult() : S.mult;
    var elapsed = S.phase === 'flying' && S.flightStart ? Date.now() - S.flightStart : null;
    // joined a round in progress (no start seen here): straight into the cascade
    if (S.phase === 'flying' && !started) { started = true; scene.onStart(now, true, S.round, elapsed); }
    if (S.phase === 'betting' && !bettingSeen) { bettingSeen = true; scene.onBetting(now, S.round); }
    scene.frame(now, dt, { phase: S.phase, mult: mult, elapsed: elapsed, round: S.round });
    if (now - themeAt > 400) { themeAt = now; game.theme(scene.topColor()); }
    // my win tag over my gold tile
    var tp = scene.tagPos(now), tg = $('wintag');
    if (tp) { tg.hidden = false; setText(tg, tp.text); var tx = Math.max(view.LEFT + 50, Math.min(view.LEFT + view.W - 50, tp.x)), ty = Math.max(view.TOP + 40, Math.min(view.TOP + view.H - 10, tp.y - tp.k * 26)); tg.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px) translate(-50%,-100%)'; tg.style.opacity = String(1 - Math.max(0, tp.k - 0.75) * 4); }
    else if (!tg.hidden) tg.hidden = true;

    var m = $('mult'), hint = $('hint'), flew = $('flew');
    if (S.phase === 'flying') {
      setClass(m, 'mult');
      setText(m, mult.toFixed(2) + 'x');
      swap(hint, mult < 1.03 ? 'The first tile falls' : ''); flew.hidden = true;
      if (S.my[0] || S.my[1]) updateButtons();
    } else if (S.phase === 'crashed' || (S.phase === 'betting' && scene.holding() && S.crashPoint)) { // the end stays until the new line is set
      setClass(m, 'mult mult--crashed');
      setText(m, S.crashPoint.toFixed(2) + 'x'); swap(hint, '');
      flew.hidden = false; swap(flew, crashLine);
    } else if (S.phase === 'betting') {
      setClass(m, 'mult mult--phrase'); flew.hidden = true;
      swap(m, bettingLine);
      var left = Math.max(0, (S.bettingEndsAt - Date.now()) / 1000);
      setText(hint, left > 0.05 ? 'First tile falls in ' + left.toFixed(1) + ' s' : 'Here it goes…');
    } else {
      setClass(m, 'mult mult--phrase'); flew.hidden = true; setText(m, '');
      setText(hint, S.gotSnapshot ? 'Setting up the next line…' : 'Connecting…');
    }
  }
  function setClass(el, c) { if (el.className !== c) el.className = c; }
  function swap(el, text) { // a new line eases in
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in');
  }

  // The NEXORNG loader stays up until the first screen is drawn and the round known.
  var announced = false, firstFrame = false;
  var fontsIn = false;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fontsIn = true; panels.forEach(fitLabel); maybeReady(); }); else fontsIn = true;
  setTimeout(function () { fontsIn = true; maybeReady(); }, 3000);
  function maybeReady() {
    if (announced || !firstFrame || !fontsIn || !scene.ready() || !S.gotSnapshot) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 8000);

  // ---------------------------------------------------------------- controls
  function setAmount(p, v) {
    var l = game.limit();
    v = Math.max(l.min, game.round2(v));
    if (l.max) v = Math.min(l.max, v);
    p.amount.value = v.toFixed(2);
    Array.prototype.forEach.call(p.quick.children, function (b) { b.classList.toggle('tile--on', Number(b.dataset.v) === v); });
    updateButton(p);
  }
  function buildQuick(p) { // 1×, 2×, 5×, 10× the min bet (within the max)
    var l = game.limit();
    p.quick.innerHTML = '';
    [1, 2, 5, 10].forEach(function (k) {
      var v = game.round2(l.min * k);
      if (l.max && v > l.max) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tile'; b.dataset.v = v;
      b.textContent = game.money(v).replace(/\.00$/, '').replace(CUR, '').trim();
      b.setAttribute('aria-label', 'Bet ' + game.money(v));
      b.onclick = function () { audio.click(); setAmount(p, v); };
      p.quick.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { panels.forEach(function (p) { buildQuick(p); setAmount(p, l.min); }); });

  panels.forEach(function (p) {
    Array.prototype.forEach.call(p.el.querySelectorAll('.key--sym'), function (b) {
      b.onclick = function () { audio.click(); setAmount(p, readAmount(p) + Number(b.dataset.step) * game.limit().min); };
    });
    p.amount.oninput = function () { updateButton(p); };
    p.amount.onblur = function () { setAmount(p, readAmount(p) || game.limit().min); };
    p.autoOn.onchange = function () { audio.click(); p.el.classList.toggle('panel--auto', p.autoOn.checked); };
    p.autoAt.onblur = function () { var v = Number(String(p.autoAt.value).replace(',', '.')); p.autoAt.value = (isFinite(v) && v >= 1.01 ? v : 2).toFixed(2); };
    p.action.onclick = function () {
      audio.unlock(true); audio.click();
      if (S.queued[p.slot]) return game.cancelQueued(p.slot);
      var my = S.my[p.slot];
      if (my && my.round === S.round && my.status === 'placed' && S.phase === 'flying') return game.cashOut(p.slot);
      if (my && my.round === S.round && my.status !== 'lost' && my.status !== 'cashed') return;
      if (my && my.round === S.round && my.status === 'cashed' && S.phase === 'flying') return;
      game.bet(p.slot, readAmount(p), readAuto(p));
    };
  });

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

  // sound + music: separate switches, remembered; music starts as the game opens (or on the first tap)
  function pref(name, dflt) { try { var v = localStorage.getItem('dominocascade-' + name); return v == null ? dflt : v !== 'off'; } catch (e) { return dflt; } }
  function savePref(name, on) { try { localStorage.setItem('dominocascade-' + name, on ? 'on' : 'off'); } catch (e) { /* ignore */ } }
  var soundOn = pref('sound', true), musicOn = pref('music', true);
  function syncAudio() {
    audio.setSound(soundOn);
    audio.setMusic(musicOn);
    $('sound').setAttribute('aria-pressed', String(soundOn));
    $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    $('music').setAttribute('aria-pressed', String(musicOn));
    $('music').setAttribute('aria-label', musicOn ? 'Music on' : 'Music off');
  }
  $('sound').onclick = function () { audio.unlock(true); soundOn = !soundOn; savePref('sound', soundOn); syncAudio(); audio.click(); };
  $('music').onclick = function () { audio.unlock(true); musicOn = !musicOn; savePref('music', musicOn); syncAudio(); };
  window.addEventListener('pointerdown', function () { audio.unlock(true); }, true);
  document.addEventListener('visibilitychange', function () { audio.pause(document.hidden); });
  window.addEventListener('nexorng:ready', function () { audio.unlock(); }, { once: true });

  syncAudio();
  fit();
  render();
  requestAnimationFrame(function (t) { firstFrame = true; frame(t); maybeReady(); });
})();
