/* Tiger Chase — NEXORNG crash game. Game logic: ../_core/crash-client.js (live rounds from the engine);
 * the look and the sounds: scene.js (window.TigerScene / TigerAudio: full-scene video clips). This file:
 * the pugmark bet panels (two bets per round; one on phones), the bets list, the results row, the texts
 * over the scene and the screen layout. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  // The catalogue game ID is set at deploy; until then a preview passes a live crash event as ?event=…
  var game = NXCrash.start({ event: '88.0101', onChange: render, onSignal: onSignal });
  var S = game.S;
  var audio = TigerAudio;
  var stageEl = document.querySelector('.stage');
  var scene = TigerScene.create($('scene'), { onLoad: function () { maybeReady(); } });

  // ---------------------------------------------------------------- engine moments
  var started = false; // a chase was seen starting on this screen (else it was joined mid-round)
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'betting') { scene.onBetting(now); started = false; }
    if (name === 'start') { started = true; scene.onStart(now, false); }
    if (name === 'crash') scene.onCrash(now);
    if (name === 'win') { scene.onWin(now, '+' + game.money(d.win), 'Safe at ' + d.x.toFixed(2) + 'x', balanceTarget()); glowBalance(); }
    if (name === 'error') toast(d.text, 'error');
  }
  function balanceTarget() { // where the NX token lands: the balance pill, in stage px
    var s = stageEl.getBoundingClientRect(), w = document.querySelector('.wallet').getBoundingClientRect();
    return { x: w.left - s.left + 30, y: w.bottom - s.top - 6 };
  }
  var glowTimer;
  function glowBalance() { // the pill glows once as the token arrives
    var w = document.querySelector('.wallet');
    clearTimeout(glowTimer);
    glowTimer = setTimeout(function () {
      w.classList.remove('wallet--glow'); void w.offsetWidth; w.classList.add('wallet--glow');
    }, 1650);
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
    if (!playersStrip) playersStrip = NXPlayers.create(stageEl);
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

  // ---------------------------------------------------------------- the pugmark bet panels
  // Built once (never re-rendered). Left: the stake on a tracking tag between brass − / + keys and the
  // auto cash-out (tiger-stripe switch + its multiplier). Right: a tiger's pugmark — the four toes are
  // the quick amounts, the pad is the Bet / Cash Out button.
  var CUR = (function () { var s = game.money(0).replace(/[\d.,\s ]/g, ''); return s || '€'; })();
  var PAD = 'M94 3C124 3 144 15 157 31C170 46 185 58 185 76C185 94 170 101 152 99C136 97 124 94 112 98C104 101 84 101 76 98C64 94 52 97 36 99C18 101 3 94 3 76C3 58 18 46 31 31C44 15 64 3 94 3Z';
  var panels = [0, 1].map(function (slot) {
    var el = document.createElement('section');
    el.className = 'panel' + (slot ? ' panel--mirror' : '');
    el.dataset.slot = slot;
    el.setAttribute('aria-label', 'Bet ' + (slot + 1));
    el.innerHTML =
      '<div class="panel__in">' +
      '<div class="lcol">' +
      '<div class="lbl">Stake</div>' +
      '<div class="step"><button type="button" class="brass" data-step="-1" aria-label="Decrease bet">−</button>' +
      '<label class="tag"><span class="tag__cur"></span><input class="amount" inputmode="decimal" value="1.00" aria-label="Bet amount"></label>' +
      '<button type="button" class="brass" data-step="1" aria-label="Increase bet">+</button></div>' +
      '<div class="lbl">Auto cash-out</div>' +
      '<div class="auto"><label class="stripe"><input type="checkbox" class="auto__on" aria-label="Auto cash out"><span class="stripe__knob"></span></label>' +
      '<label class="ax"><input class="auto__x" inputmode="decimal" value="2.00" aria-label="Auto cash-out multiplier"><span>x</span></label></div>' +
      '<span class="nxplate" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="paw"><div class="toes" aria-label="Quick amounts"></div>' +
      '<button type="button" class="pad action"><svg viewBox="0 0 188 102" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="pad__shape" d="' + PAD + '"/><path class="pad__shine" d="M40 28C56 12 76 8 94 8C112 8 132 12 148 28"/></svg>' +
      '<span class="pad__t"><b class="action__label">JOIN THE CHASE</b><small class="action__sub"></small></span></button></div>' +
      '</div>';
    $('panels').appendChild(el);
    var q = function (sel) { return el.querySelector(sel); };
    q('.tag__cur').textContent = CUR;
    return { slot: slot, el: el, amount: q('.amount'), action: q('.action'), label: q('.action__label'), sub: q('.action__sub'), autoOn: q('.auto__on'), autoAt: q('.auto__x'), toes: q('.toes') };
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
    var my = S.my[p.slot], state = 'bet', label = 'JOIN THE CHASE', sub = (S.phase === 'betting' ? '' : 'next · ') + game.money(readAmount(p)), disabled = false;
    var mine = my && my.round === S.round;
    if (S.queued[p.slot]) {
      state = 'cancel'; label = 'CANCEL'; sub = 'next chase';
    } else if (mine && my.status === 'pending') {
      state = 'wait'; label = 'JOINING…'; sub = ''; disabled = true;
    } else if (mine && my.status === 'placed' && S.phase === 'betting') {
      state = 'wait'; label = 'BET PLACED'; sub = game.money(my.amount) + ' · waiting'; disabled = true;
    } else if (mine && (my.status === 'placed' || my.status === 'cashing') && S.phase === 'flying') {
      state = 'cash'; label = 'CASH OUT'; sub = game.money(game.round2(my.amount * game.currentMult())); disabled = my.status === 'cashing';
    } else if (mine && my.status === 'cashed' && S.phase === 'flying') {
      state = 'safe'; label = 'SAFE'; sub = '+' + game.money(my.win); disabled = true;
    }
    var cls = 'pad action pad--' + state;
    if (p.action.className !== cls) p.action.className = cls;
    if (p.action.disabled !== disabled) p.action.disabled = disabled;
    setText(p.label, label);
    if (p.sub.textContent !== sub) { p.sub.textContent = sub; fitLabel(p); }
    if (p.fitFor !== label) { p.fitFor = label; fitLabel(p); }
  }
  // the pad's words never wrap or spill (phones 360–440 px wide)
  function fitLabel(p) {
    [p.label, p.sub].forEach(function (el) {
      el.style.fontSize = '';
      var max = p.action.clientWidth * 0.74;
      if (max <= 0) return;
      var w = el.scrollWidth, fs = parseFloat(getComputedStyle(el).fontSize);
      if (w > max) el.style.fontSize = Math.max(11, Math.floor(fs * max / w * 10) / 10) + 'px';
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
  var canvas = $('scene');
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
    view = { W: r.width - LEFT, H: Math.max(120, playBottom - TOP), TOP: TOP, LEFT: LEFT, FULL_W: r.width, FULL_H: r.height, dpr: dpr };
    stageEl.style.setProperty('--below', Math.max(0, r.height - playBottom) + 'px');
    stageEl.style.setProperty('--left', LEFT + 'px');
    // the texts: centred on the play area, at its top (the chase runs below them)
    var PH = TOP + view.H, textTop = wide ? Math.round(TOP + 4) : TOP + 2;
    var c = document.querySelector('.stage__center').style;
    c.left = LEFT + 'px'; c.top = textTop + 'px'; c.width = view.W + 'px'; c.height = (PH - textTop) + 'px';
    var m = Math.min(view.W * 1.1, PH), mf = Math.round(m * (wide ? 0.15 : 0.17)), tf = Math.max(13, Math.round(m * 0.036));
    stageEl.style.setProperty('--mf', mf + 'px');
    stageEl.style.setProperty('--tf', tf + 'px');
    var cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    scene.resize(view);
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
    var dt = lastT ? Math.min(100, now - lastT) : 16;
    lastT = now;
    draw(now, dt);
    requestAnimationFrame(frame);
  }
  function draw(now, dt) {
    drawn = true;
    var mult = S.phase === 'flying' ? game.currentMult() : S.mult;
    // joined a chase in progress (no start seen here): straight into it at the right moment
    if (S.phase === 'flying' && !started) { started = true; scene.onStart(now, true, Date.now() - S.flightStart); }
    var rollIn = S.phase === 'betting' ? S.bettingEndsAt - Date.now() : null;
    scene.frame(now, dt, { phase: S.phase, mult: mult, rollIn: rollIn });
    audio.tick(S.phase === 'flying' ? 'run' : S.phase === 'crashed' ? 'end' : 'ground', mult);
    if (now - themeAt > 400) { themeAt = now; game.theme(scene.topColor(now)); }

    var m = $('mult'), hint = $('hint'), end = $('end'), bar = $('bar');
    if (S.phase === 'flying') {
      setClass(m, 'mult');
      setText(m, mult.toFixed(2) + 'x'); swap(hint, ''); end.hidden = true; bar.hidden = true;
      if (S.my[0] || S.my[1]) updateButtons();
    } else if (S.phase === 'crashed' || (S.phase === 'betting' && scene.holding() && S.crashPoint)) { // the end stays until the haze
      setClass(m, 'mult mult--crashed');
      setText(m, S.crashPoint.toFixed(2) + 'x'); swap(hint, ''); bar.hidden = true;
      end.hidden = false; swap(end, S.crashPhrase);
    } else if (S.phase === 'betting') {
      setClass(m, 'mult mult--phrase'); end.hidden = true;
      swap(m, S.bettingPhrase);
      var left = Math.max(0, (S.bettingEndsAt - Date.now()) / 1000), total = Math.max(1, (S.bettingEndsAt - S.bettingStartsAt) / 1000 || 6);
      setText(hint, left > 0.05 ? 'The chase starts in ' + left.toFixed(1) + ' s' : 'Here it comes…');
      bar.hidden = false;
      var w = (100 * clamp01(1 - left / total)).toFixed(1) + '%';
      if (bar.firstChild.style.width !== w) bar.firstChild.style.width = w;
    } else {
      setClass(m, 'mult mult--phrase'); end.hidden = true; bar.hidden = true; setText(m, '');
      setText(hint, S.gotSnapshot ? 'Waiting for the next chase…' : 'Connecting…');
    }
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function setClass(el, c) { if (el.className !== c) el.className = c; }
  function swap(el, text) { // a new line eases in
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in');
  }

  // The NEXORNG loader stays up until the first screen (the stalk) is drawn and the round known.
  var announced = false, firstFrame = false;
  function maybeReady() {
    if (announced || !firstFrame || !scene.ready() || !S.gotSnapshot) return;
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
    Array.prototype.forEach.call(p.toes.children, function (b) { b.classList.toggle('toe--on', Number(b.dataset.v) === v); });
    updateButton(p);
  }
  function buildToes(p) { // 1×, 2×, 5×, 10× the min bet (within the max) on the four toes
    var l = game.limit();
    p.toes.innerHTML = '';
    [1, 2, 5, 10].forEach(function (k, i) {
      var v = game.round2(l.min * k);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'toe toe--' + i; b.dataset.v = v;
      b.innerHTML = '<span></span>';
      b.firstChild.textContent = game.money(v).replace(/\.00$/, '').replace(CUR, '').trim();
      b.setAttribute('aria-label', 'Bet ' + game.money(v));
      if (l.max && v > l.max) b.disabled = true;
      b.onclick = function () { audio.click(); setAmount(p, v); };
      p.toes.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { panels.forEach(function (p) { buildToes(p); setAmount(p, l.min); }); });

  panels.forEach(function (p) {
    Array.prototype.forEach.call(p.el.querySelectorAll('.brass'), function (b) {
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
  function pref(name, dflt) { try { var v = localStorage.getItem('tigerchase-' + name); return v == null ? dflt : v !== 'off'; } catch (e) { return dflt; } }
  function savePref(name, on) { try { localStorage.setItem('tigerchase-' + name, on ? 'on' : 'off'); } catch (e) { /* ignore */ } }
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

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { panels.forEach(function (p) { p.fitFor = ''; fitLabel(p); }); });
  syncAudio();
  fit();
  render();
  requestAnimationFrame(function (t) { firstFrame = true; frame(t); maybeReady(); });
})();
