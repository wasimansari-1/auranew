/* NEXORNG solo (arcade) game shell — the same file in every solo game folder.
 * Game logic: ../_core/solo-client.js. The look comes from this folder's scene.js
 * (window.Scene): it draws the world in play-area coordinates and makes its own sounds.
 *
 * Scene = {
 *   event, code,                         // game id, storage prefix
 *   draw(ctx, v),                        // ctx is translated to the play area (LEFT, TOP)
 *   topColour(v) → '#rrggbb',            // browser bar colour (top of the scene)
 *   onSignal(name, v, synth),            // 'start' | 'win' | 'bust' | 'error'
 *   musicStep(synth, step, time), stepDur // generated background music (optional)
 *   tick(v, synth)                        // every frame (optional): loops, bounce sounds…
 *   betLabel                              // the game's own word on the Bet button (optional)
 * }
 * v = { W, H, TOP, LEFT, FULL_W, FULL_H, now, dt, phase, mult, alt, startAt, endAt, crashPoint, S }
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var Scene = window.Scene;
  var game = NXSolo.start({ event: Scene.event, onChange: render, onSignal: onSignal });
  var S = game.S;

  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------------- sound (generated)
  var AC = window.AudioContext || window.webkitAudioContext;
  var soundOn = load(Scene.code + '-sound') !== 'off';
  var musicOn = load(Scene.code + '-music') !== 'off';
  var synth = { ctx: null };
  var noiseBuf = null;

  function audio() {
    if (synth.ctx || !AC) return synth.ctx;
    var ctx = synth.ctx = new AC();
    synth.master = ctx.createGain(); synth.master.gain.value = 0.9; synth.master.connect(ctx.destination);
    synth.sfx = ctx.createGain(); synth.sfx.gain.value = soundOn ? 1 : 0; synth.sfx.connect(synth.master);
    synth.music = ctx.createGain(); synth.music.gain.value = musicOn ? 0.32 : 0; synth.music.connect(synth.master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  // tone({ type, freq, freqEnd, dur, gain, attack, at, bus: 'music' })
  synth.tone = function (o) {
    var ctx = synth.ctx;
    if (!ctx) return;
    var t = (o.time != null ? o.time : ctx.currentTime) + (o.at || 0);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    env(g, t, o.gain || 0.25, o.attack || 0.01, o.dur);
    osc.connect(g); g.connect(o.bus === 'music' ? synth.music : synth.sfx);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  };
  // noise({ dur, gain, filter, freq, freqEnd, q, attack, at })
  synth.noise = function (o) {
    var ctx = synth.ctx;
    if (!ctx) return;
    var t = (o.time != null ? o.time : ctx.currentTime) + (o.at || 0);
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = o.filter || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    env(g, t, o.gain || 0.2, o.attack || 0.01, o.dur);
    src.connect(f); f.connect(g); g.connect(o.bus === 'music' ? synth.music : synth.sfx);
    src.start(t); src.stop(t + o.dur + 0.05);
  };
  // a looping noise bed (e.g. wind) with a live level: loop.set(level 0..1), loop.stop(fadeSec)
  synth.loop = function (o) {
    var ctx = synth.ctx;
    if (!ctx) return { set: function () {}, stop: function () {} };
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = o.filter || 'bandpass'; f.frequency.value = o.freq || 600; f.Q.value = o.q || 0.8;
    g.gain.value = 0.0001;
    src.connect(f); f.connect(g); g.connect(synth.sfx); src.start();
    return {
      set: function (level, freq) {
        var t = ctx.currentTime;
        g.gain.setTargetAtTime(Math.max(0.0001, (o.gain || 0.2) * level), t, 0.15);
        if (freq) f.frequency.setTargetAtTime(freq, t, 0.2);
      },
      stop: function (fade) {
        var t = ctx.currentTime;
        g.gain.setTargetAtTime(0.0001, t, Math.max(0.02, (fade || 0.2) / 3));
        src.stop(t + (fade || 0.2) + 0.1);
      },
    };
  };

  // music: the scene's generated loop, scheduled slightly ahead
  var step = 0, nextAt = 0;
  setInterval(function () {
    var ctx = synth.ctx;
    if (!ctx || !musicOn || !Scene.musicStep || ctx.state !== 'running') return;
    if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
    while (nextAt < ctx.currentTime + 0.25) {
      Scene.musicStep(synth, step++, nextAt);
      nextAt += Scene.stepDur || 0.25;
    }
  }, 60);

  // Sound starts as the game opens when the browser allows it (the tap that opened the game),
  // otherwise on the first tap in the game.
  function unlock() {
    var ctx = audio();
    if (ctx && ctx.state !== 'running') ctx.resume().catch(function () {});
  }
  unlock();
  window.addEventListener('pointerdown', unlock, true);
  document.addEventListener('visibilitychange', function () {
    if (!synth.ctx) return;
    if (document.hidden) synth.ctx.suspend().catch(function () {}); else unlock();
  });
  function setSound(on) {
    soundOn = on; save(Scene.code + '-sound', on ? 'on' : 'off');
    if (synth.sfx) synth.sfx.gain.value = on ? 1 : 0;
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  }
  function setMusic(on) {
    musicOn = on; save(Scene.code + '-music', on ? 'on' : 'off');
    if (synth.music) synth.music.gain.value = on ? 0.32 : 0;
    $('music').setAttribute('aria-pressed', String(on));
    $('music').setAttribute('aria-label', on ? 'Music on' : 'Music off');
  }
  function click() { synth.tone({ type: 'triangle', freq: 880, freqEnd: 660, dur: 0.06, gain: 0.12 }); }

  // ---------------------------------------------------------------- engine moments
  var v = { W: 0, H: 0, TOP: 0, LEFT: 0, FULL_W: 0, FULL_H: 0, now: 0, dt: 16, phase: 'idle', mult: 1, alt: 0, startAt: 0, endAt: 0, crashPoint: 0, S: S };
  var lastAmount = 0;
  function onSignal(name, d) {
    var now = performance.now();
    if (name === 'start') { v.startAt = now; v.endAt = 0; }
    if (name === 'win' || name === 'bust') v.endAt = now;
    if (name === 'win') toast(d.text, 'win');
    if (name === 'error') toast(d.text, 'error');
    if (Scene.onSignal) Scene.onSignal(name, v, synth, d);
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

  // ---------------------------------------------------------------- DOM (built once)
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  var tab = 'all';

  function render() {
    maybeReady();
    $('conn').hidden = S.connected || !S.gotSnapshot || S.demo;
    setText($('balance'), S.balance == null ? '—' : game.money(S.balance));
    setText($('mode'), S.demo ? 'Demo balance' : 'Balance');

    var h = $('history');
    var key = S.history.map(function (r) { return r.x + (r.busted ? 'b' : 'c'); }).join('|');
    if (h.dataset.key !== key) {
      h.dataset.key = key;
      h.innerHTML = '';
      S.history.forEach(function (r) {
        var s = document.createElement('span');
        s.className = 'chip' + (r.busted ? ' chip--bust' : r.x >= 10 ? ' chip--big' : '');
        s.textContent = r.x.toFixed(2) + 'x';
        h.appendChild(s);
      });
      if (!S.history.length) { var e = document.createElement('span'); e.className = 'chip chip--empty'; e.textContent = 'Your results show here'; h.appendChild(e); }
    }
    updateButton();
    renderList();
    setText($('fHash'), S.roundHash || '—');
    setText($('fSeed'), S.seed || 'revealed when your round ends');
  }

  function readAmount() {
    var n = Number(String($('amount').value).replace(',', '.'));
    return isFinite(n) && n > 0 ? game.round2(n) : 0;
  }
  function readAuto() {
    if (!$('autoOn').checked) return 0;
    var n = Number(String($('autoAt').value).replace(',', '.'));
    return isFinite(n) && n >= 1.01 ? Math.round(n * 100) / 100 : 0;
  }

  function updateButton() {
    var btn = $('action'), cls = 'action', label = Scene.betLabel || 'Bet', sub = game.money(readAmount()), disabled = false;
    if (S.phase === 'starting') { cls = 'action action--waiting'; label = 'Placing bet…'; sub = ''; disabled = true; }
    else if (S.phase === 'running') { cls = 'action action--cashout'; label = 'Cash Out'; sub = game.money(game.round2(lastAmount * game.currentMult())); }
    if (btn.className !== cls) btn.className = cls;
    if (btn.disabled !== disabled) btn.disabled = disabled;
    setText($('actionLabel'), label);
    setText($('actionSub'), sub);
  }

  function cell(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }
  function renderList() {
    var list = $('list'), rows = tab === 'all' ? S.bets : S.myBets;
    var key = tab + JSON.stringify(rows.map(function (b) { return [b.player || b.at, b.x, b.win, b.done]; }));
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.innerHTML = '';
    setText($('betCount'), String(rows.length));
    setText($('countLabel'), tab === 'all' ? 'Recent rounds' : 'My rounds');
    if (!rows.length) list.appendChild(cell(tab === 'all' ? 'No rounds yet — be the first!' : 'Your rounds this visit show here.', 'empty'));
    rows.forEach(function (b) {
      var row = document.createElement('div');
      var won = b.x > 0 && (tab === 'mine' || b.done);
      row.className = 'row' + (won ? ' row--cashed' : (tab === 'mine' || b.done) ? ' row--bust' : '') + (b.mine ? ' row--mine' : '');
      row.appendChild(cell(tab === 'all' ? b.player : new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'row__user'));
      row.appendChild(cell(Number(b.amount).toFixed(2)));
      row.appendChild(cell(b.x ? b.x.toFixed(2) + 'x' : (tab === 'all' && !b.done ? '…' : '—'), 'row__x'));
      row.appendChild(cell(b.win ? Number(b.win).toFixed(2) : '—', 'row__win'));
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- scene (canvas)
  var canvas = $('scene'), ctx = canvas.getContext('2d');
  var stageEl = document.querySelector('.stage');

  function fit() {
    var r = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    v.FULL_W = r.width; v.FULL_H = r.height;
    var bar = document.querySelector('.top').getBoundingClientRect();
    v.TOP = Math.max(0, bar.bottom - r.top + 6);
    var list = document.querySelector('.bets').getBoundingClientRect();
    // Only on wide screens is the bets list beside the scene. On a phone it is below, and when the page is
    // scrolled it slides under the scene (which stays on top) — that must not push the play area aside.
    v.LEFT = window.matchMedia('(min-width: 900px)').matches && list.right > r.left && list.top < r.bottom && list.left < r.left + r.width / 2 ? Math.max(0, list.right - r.left + 8) : 0;
    v.W = v.FULL_W - v.LEFT;
    var hist = document.querySelector('.history').getBoundingClientRect();
    var playBottom = hist.top > r.top && hist.top < r.bottom ? hist.top - r.top - 8 : v.FULL_H;
    v.H = Math.max(120, playBottom - v.TOP);
    stageEl.style.setProperty('--below', Math.max(0, v.FULL_H - playBottom) + 'px');
    stageEl.style.setProperty('--left', v.LEFT + 'px');
    var c = document.querySelector('.stage__center').style;
    c.left = v.LEFT + 'px'; c.top = v.TOP + 'px'; c.width = v.W + 'px'; c.height = v.H + 'px';
    // Only when the size really changed: setting a canvas size clears it, and the scene would blink
    // (this also runs when the bets list changes size — every time a round is added to it).
    var bufW = Math.round(v.FULL_W * dpr), bufH = Math.round(v.FULL_H * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) { canvas.width = bufW; canvas.height = bufH; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
  }

  var announced = false, firstFrame = false;
  function maybeReady() {
    if (announced || !firstFrame || !(S.gotSnapshot || S.demo)) return;
    announced = true;
    game.ready();
  }
  setTimeout(function () { if (!announced) { announced = true; game.ready(); } }, 6000);

  var themeAt = 0, lastT = 0;
  function frame(now) {
    v.dt = lastT ? Math.min(100, now - lastT) : 16;
    lastT = now;
    v.now = now;
    v.phase = S.phase;
    v.mult = S.phase === 'running' ? game.currentMult() : S.mult;
    v.crashPoint = S.crashPoint;
    var target = S.phase === 'running' || S.phase === 'cashed' || S.phase === 'busted'
      ? Math.min(1, Math.log(Math.max(1, S.phase === 'busted' ? 1 : v.mult)) / Math.log(10)) : 0;
    v.alt += (target - v.alt) * Math.min(1, v.dt / (S.phase === 'busted' ? 260 : 380));
    if (v.W && v.H) {
      ctx.save();
      ctx.translate(v.LEFT, v.TOP);
      ctx.clearRect(-v.LEFT, -v.TOP, v.FULL_W, v.FULL_H);
      Scene.draw(ctx, v);
      ctx.restore();
      if (!firstFrame) { firstFrame = true; maybeReady(); }
    }
    if (Scene.tick) Scene.tick(v, synth);
    if (now - themeAt > 400) { themeAt = now; game.theme(Scene.topColour(v)); }

    var mult = $('mult'), hint = $('hint'), flew = $('flew');
    var showFlew = S.phase === 'busted';
    if (flew.hidden === showFlew) flew.hidden = !showFlew;
    if (showFlew) setText(flew, S.crashPhrase);
    if (S.phase === 'running') {
      mult.className = 'mult'; setText(mult, v.mult.toFixed(2) + 'x'); setText(hint, '');
      updateButton(); // live cash-out amount
    } else if (S.phase === 'busted') {
      mult.className = 'mult mult--crashed'; setText(mult, (S.crashPoint || S.mult).toFixed(2) + 'x'); setText(hint, '');
    } else if (S.phase === 'cashed') {
      mult.className = 'mult mult--won'; setText(mult, S.mult.toFixed(2) + 'x'); setText(hint, 'Cashed out!');
    } else if (S.phase === 'starting') {
      mult.className = 'mult'; setText(mult, ''); setText(hint, 'Get ready…');
    } else {
      mult.className = 'mult'; setText(mult, ''); setText(hint, S.connected || S.demo ? S.bettingPhrase : 'Connecting…');
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- controls
  function setAmount(n) {
    var l = game.limit();
    n = Math.max(l.min, game.round2(n));
    if (l.max) n = Math.min(l.max, n);
    $('amount').value = n.toFixed(2);
    updateButton();
  }
  function buildQuick() { // 1×, 2×, 5×, 10× the min bet (within the max)
    var l = game.limit(), q = $('quick');
    q.innerHTML = '';
    [1, 2, 5, 10].forEach(function (k) {
      var n = game.round2(l.min * k);
      if (l.max && n > l.max) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = game.money(n).replace(/\.00$/, '');
      b.onclick = function () { click(); setAmount(n); };
      q.appendChild(b);
    });
  }
  game.limitsLoaded.then(function (l) { buildQuick(); setAmount(l.min); });
  $('minus').onclick = function () { click(); setAmount(readAmount() - game.limit().min); };
  $('plus').onclick = function () { click(); setAmount(readAmount() + game.limit().min); };
  $('amount').oninput = updateButton;
  $('amount').onblur = function () { setAmount(readAmount() || game.limit().min); };
  $('action').onclick = function () {
    click();
    if (S.phase === 'running') return game.cashOut();
    if (S.phase === 'starting') return;
    lastAmount = readAmount();
    game.play(lastAmount, readAuto());
  };
  $('back').onclick = function () { click(); game.back(); };
  $('sound').onclick = function () { setSound(!soundOn); click(); };
  $('music').onclick = function () { setMusic(!musicOn); click(); };
  $('fair').onclick = function () { $('fairDetail').hidden = !$('fairDetail').hidden; };
  Array.prototype.forEach.call(document.querySelectorAll('.bets__tab'), function (b) {
    b.onclick = function () {
      click();
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
  setMusic(musicOn);
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { fit(); }); ['.history', '.bets', '.top', '.stage'].forEach(function (sel) { var e = document.querySelector(sel); if (e) ro.observe(e); }); }
  fit();
  render();
  requestAnimationFrame(frame);
})();
