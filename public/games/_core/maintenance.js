/* NEXORNG maintenance overlay — shared by every engine game (loaded by the _core clients).
 *
 * While the platform is in maintenance (the owner's switch in the back office):
 *   - the game's bet / spin / deal buttons are covered by a "Maintenance" lock (a play already in
 *     progress is never covered: a running round, an open hand or a spin finishes normally);
 *   - once nothing of the player's is in play — and, for shared-round games (crash, tables), once
 *     the running round has ended — a compact overlay covers the play area: the message, the
 *     expected end as a countdown in the player's own time, and "your balance and bets are safe";
 *   - when it is switched off, everything goes away by itself (no reload).
 *
 * The state comes from the game's live channel (the engine's "maintenance" message, sent when the
 * game starts and every few seconds; also in the snapshot). A play refused MAINTENANCE by an older
 * engine (the API refuses it) asks the player API's GET {apiBase}/status, and keeps asking every
 * 15 s while that says "on" — nothing is requested otherwise (silent with an older API).
 *
 * Client hooks (each _core client): NXMaint.attach({ api, round, busy }) once; NXMaint.engine(data)
 * for every "maintenance" message / snapshot entry; NXMaint.refused() on a MAINTENANCE refusal;
 * NXMaint.blocked() before starting a new play. Calls made before this file has loaded are queued
 * in window.NXMaintQ by the clients.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return; // a no-op under Node
  if (window.NXMaint) return;

  var POLL_MS = 15000;
  var opts = { api: '', round: false, busy: function () { return false; } };
  var engineState = null; // last "maintenance" message from the engine (null: none yet)
  var apiState = null;    // last GET /status answer
  var refused = false;    // a play was refused MAINTENANCE since the last engine message
  var pollTimer = 0, lastPosted = null;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- state
  function current() {
    var apiOn = !!(apiState && apiState.enabled);
    var eng = engineState;
    var enabled = eng ? (!!eng.enabled || (refused && apiOn)) : apiOn;
    var src = eng && eng.enabled ? eng : apiState || {};
    // Shared-round games pause once the running round has ended (the engine says so); without
    // the engine's word (older engine) the overlay shows at once.
    var paused = enabled && (!opts.round || (eng ? (eng.enabled ? !!eng.paused : false) : true));
    return { enabled: enabled, paused: paused, message: src.message || '', until: src.until || null };
  }

  function busy() {
    try { return !!opts.busy(); } catch (e) { return false; }
  }

  // GET /status is only asked after a play was refused MAINTENANCE (then the API certainly has it),
  // and again every 15 s while the API says "on" and the live channel has not spoken (an older
  // engine). Never otherwise: an older API without the endpoint gets no requests at all. Any
  // failure (network, non-2xx, not JSON) simply means "no maintenance".
  function fetchStatus() {
    if (!opts.api || !window.fetch) return;
    fetch(opts.api + '/status', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) {
        var m = b && b.maintenance;
        apiState = m && typeof m.enabled === 'boolean' ? m : { enabled: false };
        if (!apiState.enabled) refused = false;
        update();
      }, function () { apiState = { enabled: false }; refused = false; update(); })
      .then(schedulePoll, function () {});
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (apiState && apiState.enabled && (!engineState || refused)) pollTimer = setTimeout(fetchStatus, POLL_MS);
  }

  // ---------------------------------------------------------------- page
  var css = '' +
    '.nxm-layer{position:fixed;z-index:2147483000;pointer-events:none;display:flex;align-items:center;justify-content:center;' +
    'opacity:0;transition:opacity .35s ease;font-family:Outfit,"Plus Jakarta Sans",system-ui,sans-serif}' +
    '.nxm-layer.nxm-on{opacity:1;pointer-events:auto}' +
    '.nxm-dim{position:absolute;inset:0;background:radial-gradient(ellipse 80% 75% at 50% 50%,rgba(12,6,28,.86),rgba(6,4,17,.66) 70%,rgba(6,4,17,.45))}' +
    '@media (min-width:900px){.nxm-dim{-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}}' +
    '.nxm-card{position:relative;width:min(330px,calc(100% - 28px));max-height:calc(100% - 20px);overflow:hidden;box-sizing:border-box;' +
    'padding:16px 16px 14px;border-radius:20px;text-align:center;color:#f4f1ff;' +
    'background:linear-gradient(180deg,rgba(30,16,60,.94),rgba(12,7,26,.96));border:1px solid rgba(168,85,247,.38);' +
    'box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 0 1px rgba(255,187,96,.06) inset;transform:translateY(8px) scale(.98);transition:transform .4s cubic-bezier(.2,.8,.2,1)}' +
    '.nxm-on .nxm-card{transform:none}' +
    '.nxm-top{display:flex;align-items:center;justify-content:center;gap:10px}' +
    '.nxm-gear{width:34px;height:34px;flex:none}' +
    '.nxm-gear g{transform-box:fill-box;transform-origin:center;animation:nxm-turn 9s linear infinite}' +
    '.nxm-gear .nxm-g2{animation-duration:6.75s;animation-direction:reverse}' +
    '@keyframes nxm-turn{to{transform:rotate(360deg)}}' +
    '.nxm-pill{display:inline-block;padding:5px 11px;border-radius:99px;font:700 11px/1 Outfit,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;' +
    'color:#ffbb60;background:rgba(255,187,96,.1);border:1px solid rgba(255,187,96,.35)}' +
    '.nxm-title{margin:9px 0 0;font:800 21px/1.15 Outfit,system-ui,sans-serif;color:#fff}' +
    '.nxm-msg{margin:6px 0 0;font:500 13px/1.45 "Plus Jakarta Sans",system-ui,sans-serif;color:#c9bfe3;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}' +
    '.nxm-count{margin:10px auto 0;display:inline-flex;align-items:baseline;gap:8px;padding:7px 12px;border-radius:12px;background:rgba(6,4,17,.6);border:1px solid rgba(168,85,247,.25)}' +
    '.nxm-count b{font:800 19px/1 Outfit,system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#ffbb60}' +
    '.nxm-count span{font:600 11px/1.2 "Plus Jakarta Sans",system-ui,sans-serif;color:#a597c9}' +
    '.nxm-at{margin:6px 0 0;font:500 11.5px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;color:#9d8cc4}' +
    '.nxm-safe{margin:10px 0 0;display:flex;align-items:center;justify-content:center;gap:7px;font:600 12px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;color:#ffe3b8}' +
    '.nxm-safe svg{width:16px;height:16px;flex:none}' +
    '.nxm-lock{position:fixed;z-index:2147483001;display:flex;align-items:center;justify-content:center;gap:7px;box-sizing:border-box;' +
    'border-radius:14px;background:linear-gradient(180deg,#2e145c,#140a2a);border:1px solid rgba(168,85,247,.55);box-shadow:0 0 0 1px rgba(255,187,96,.12) inset;' +
    'color:#f1e8ff;font:800 14px/1 Outfit,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:not-allowed;' +
    'opacity:0;transition:opacity .25s ease;pointer-events:none}' +
    '.nxm-lock.nxm-on{opacity:1;pointer-events:auto}' +
    '.nxm-lock svg{width:16px;height:16px;flex:none}' +
    '.nxm-lock--small{flex-direction:column;gap:4px;font-size:10.5px;letter-spacing:.08em}' +
    '.nxm-lock--small svg{width:18px;height:18px}' +
    '.nxm-lock.nxm-shake{animation:nxm-shake .35s ease}' +
    '@keyframes nxm-shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}' +
    '.nxm-toast{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));z-index:2147483002;transform:translate(-50%,-10px);opacity:0;' +
    'padding:9px 14px;border-radius:12px;background:rgba(20,10,42,.96);border:1px solid rgba(255,187,96,.4);color:#ffe3b8;' +
    'font:600 13px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;transition:opacity .25s,transform .25s;pointer-events:none;max-width:calc(100% - 28px);text-align:center}' +
    '.nxm-toast.nxm-on{opacity:1;transform:translate(-50%,0)}' +
    '@media (prefers-reduced-motion:reduce){.nxm-gear g{animation:none}.nxm-layer,.nxm-card,.nxm-lock,.nxm-toast{transition:none}.nxm-lock.nxm-shake{animation:none}}';

  var GEAR = function (teeth, outer, inner) {
    var step = Math.PI * 2 / teeth, p = [];
    for (var i = 0; i < teeth; i++) {
      var a = i * step;
      [[a - step * .5, inner], [a - step * .22, inner], [a - step * .13, outer], [a + step * .13, outer], [a + step * .22, inner]].forEach(function (q) {
        p.push((Math.cos(q[0]) * q[1]).toFixed(2) + ',' + (Math.sin(q[0]) * q[1]).toFixed(2));
      });
    }
    return 'M' + p.join('L') + 'Z';
  };
  var GEAR_SVG = '<svg class="nxm-gear" viewBox="0 0 64 64" aria-hidden="true">' +
    '<defs><linearGradient id="nxmP" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c084fc"/><stop offset="1" stop-color="#6d28d9"/></linearGradient>' +
    '<linearGradient id="nxmG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe2ad"/><stop offset="1" stop-color="#e08f2e"/></linearGradient></defs>' +
    '<g transform="translate(25 36)"><g><path d="' + GEAR(10, 22, 17) + '" fill="url(#nxmP)"/><circle r="8" fill="#140a2a"/><circle r="3" fill="#ffbb60"/></g></g>' +
    '<g transform="translate(48.5 16.5) rotate(18)"><g class="nxm-g2"><path d="' + GEAR(8, 14, 10.5) + '" fill="url(#nxmG)"/><circle r="4" fill="#3a200a"/></g></g></svg>';
  var SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4.5 5.4v5.8c0 4.7 3.2 8.9 7.5 10.3 4.3-1.4 7.5-5.6 7.5-10.3V5.4L12 2.5Z" fill="rgba(255,187,96,.18)" stroke="#ffbb60" stroke-width="1.7" stroke-linejoin="round"/><path d="m8.4 12.2 2.5 2.5 4.8-5" fill="none" stroke="#ffbb60" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="#ffbb60"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="#ffbb60" stroke-width="2.2"/><circle cx="12" cy="15.5" r="1.6" fill="#2a1606"/></svg>';

  var layer = null, els = {}, locks = [], toast = null, toastTimer = 0, tickTimer = 0, posTimer = 0, rafPending = false;

  function build() {
    if (layer) return;
    // The NEXORNG fonts (the site's): only loaded once maintenance is actually on.
    var font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap';
    document.head.appendChild(font);
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    layer = document.createElement('div');
    layer.className = 'nxm-layer';
    layer.setAttribute('role', 'status');
    layer.setAttribute('aria-live', 'polite');
    layer.innerHTML = '<div class="nxm-dim"></div><div class="nxm-card">' +
      '<div class="nxm-top">' + GEAR_SVG + '<span class="nxm-pill">Maintenance</span></div>' +
      '<p class="nxm-title">We’ll be right back</p>' +
      '<p class="nxm-msg"></p>' +
      '<div class="nxm-count" hidden><span>Back in</span><b></b></div>' +
      '<p class="nxm-at" hidden></p>' +
      '<p class="nxm-safe">' + SHIELD + 'Your balance and bets are safe</p></div>';
    if (reduced) layer.style.transition = 'none';
    els = { msg: layer.querySelector('.nxm-msg'), count: layer.querySelector('.nxm-count'), left: layer.querySelector('.nxm-count b'), at: layer.querySelector('.nxm-at') };
    // The overlay is the play area's: taps on it never reach the game underneath.
    ['pointerdown', 'click', 'touchstart'].forEach(function (t) { layer.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });
    document.body.appendChild(layer);
  }

  // The play area: the first visible candidate of a useful size (crash: the round text box, which
  // the game keeps on the clear play area; tables / wheels / slots: their stage or machine).
  var AREAS = ['.stage__center', '.stage', '#stage', '#screen', '.screen', 'div.play', 'section.play', '#machine', '.machine', '#reelsBox', '.reels'];
  function playArea() {
    for (var i = 0; i < AREAS.length; i++) {
      var list = document.querySelectorAll(AREAS[i]);
      for (var j = 0; j < list.length; j++) {
        var r = list[j].getBoundingClientRect();
        if (r.width >= 200 && r.height >= 140) return r;
      }
    }
    var w = window.innerWidth, h = window.innerHeight;
    return { left: 0, top: h * 0.12, width: w, height: h * 0.5 };
  }

  // The game's own start buttons (bet / spin / roll / deal / place).
  var BUTTONS = '#action, .panels .action, .panel .action, button.action, #spin, #roll, #deal, #place, button#play';
  function buttons() {
    var out = [], seen = [];
    var list = document.querySelectorAll(BUTTONS);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (seen.indexOf(b) >= 0 || (layer && layer.contains(b))) continue;
      seen.push(b);
      var r = b.getBoundingClientRect();
      var cs = getComputedStyle(b);
      if (r.width >= 24 && r.height >= 18 && cs.visibility !== 'hidden') out.push({ el: b, r: r, radius: cs.borderRadius });
    }
    return out;
  }

  function place(el, r) {
    var s = el.style;
    s.left = Math.round(r.left) + 'px';
    s.top = Math.round(r.top) + 'px';
    s.width = Math.round(r.width) + 'px';
    s.height = Math.round(r.height) + 'px';
  }

  function makeLock() {
    var l = document.createElement('div');
    l.className = 'nxm-lock';
    l.setAttribute('role', 'button');
    l.setAttribute('aria-disabled', 'true');
    l.innerHTML = LOCK + '<span>Maintenance</span>';
    l.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!reduced) { l.classList.remove('nxm-shake'); void l.offsetWidth; l.classList.add('nxm-shake'); }
      say('Betting is paused for maintenance — back soon.');
    });
    document.body.appendChild(l);
    return l;
  }

  function say(text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'nxm-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('nxm-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('nxm-on'); }, 2600);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function leftText(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600);
    var t = pad(h) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60);
    return d > 0 ? d + 'd ' + t : t;
  }
  function endText(until) {
    try {
      var same = until.toDateString() === new Date().toDateString();
      var o = { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
      if (!same) { o.weekday = 'short'; o.day = 'numeric'; o.month = 'short'; }
      return (same ? 'Expected around ' : 'Expected ') + new Intl.DateTimeFormat(undefined, o).format(until);
    } catch (e) { return ''; }
  }

  function renderTexts(st) {
    els.msg.textContent = st.message || 'Scheduled maintenance is under way. Betting is paused for a short while.';
    var until = st.until ? new Date(st.until) : null;
    var left = until ? until.getTime() - Date.now() : 0;
    if (until && !isNaN(left)) {
      els.count.hidden = false;
      els.at.hidden = false;
      if (left > 0) {
        els.count.firstChild.textContent = 'Back in';
        els.left.textContent = leftText(left);
      } else {
        els.count.firstChild.textContent = 'Finishing up';
        els.left.textContent = 'any moment';
      }
      els.at.textContent = endText(until);
    } else {
      els.count.hidden = true;
      els.at.hidden = true;
    }
  }

  // ---------------------------------------------------------------- update loop
  var shown = false, locksOn = false;
  function update() {
    var st = current();
    if (st.enabled !== lastPosted) {
      lastPosted = st.enabled;
      // The game site confirms with the API at once (its own maintenance page for the lobby).
      if (window.parent !== window) try { window.parent.postMessage({ type: 'nexorng:maintenance', enabled: st.enabled }, location.origin); } catch (e) {}
    }
    var b = busy();
    var wantOverlay = st.enabled && st.paused && !b;
    var wantLocks = st.enabled && !b;
    if (wantOverlay || wantLocks) build();
    if (wantOverlay) renderTexts(st);
    if (layer && wantOverlay !== shown) layer.classList.toggle('nxm-on', wantOverlay);
    shown = wantOverlay;
    locksOn = wantLocks;
    position();
    var active = wantOverlay || wantLocks || st.enabled;
    clearInterval(tickTimer);
    if (active) tickTimer = setInterval(tick, 250);
  }

  // Every 250 ms while maintenance is on: the busy state changes as plays finish; countdown; layout.
  var lastBusy = null;
  function tick() {
    var b = busy();
    if (b !== lastBusy) { lastBusy = b; update(); return; }
    if (shown) renderTexts(current());
    position();
  }

  function position() {
    if (shown && layer) place(layer, playArea());
    var bs = locksOn ? buttons() : [];
    while (locks.length < bs.length) locks.push(makeLock());
    for (var i = 0; i < locks.length; i++) {
      var on = i < bs.length;
      if (on) {
        place(locks[i], bs[i].r);
        // the button's own shape (round spin buttons); a narrow button gets the stacked label
        if (locks[i].style.borderRadius !== bs[i].radius) locks[i].style.borderRadius = bs[i].radius;
        locks[i].classList.toggle('nxm-lock--small', bs[i].r.width < 170);
      }
      if (locks[i].classList.contains('nxm-on') !== on) locks[i].classList.toggle('nxm-on', on);
    }
  }
  function positionSoon() {
    if (rafPending || (!shown && !locksOn)) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; position(); });
  }
  window.addEventListener('scroll', positionSoon, { passive: true, capture: true });
  window.addEventListener('resize', positionSoon);

  // ---------------------------------------------------------------- hooks
  var NXMaint = {
    attach: function (o) {
      opts.api = o.api || opts.api;
      opts.round = !!o.round;
      if (typeof o.busy === 'function') opts.busy = o.busy;
    },
    engine: function (d) {
      if (!d || typeof d.enabled !== 'boolean') return;
      engineState = { enabled: d.enabled, paused: !!d.paused, message: d.message || '', until: d.until || null };
      refused = false;
      schedulePoll();
      update();
    },
    refused: function () { // the client shows its own error toast
      refused = true;
      fetchStatus();
    },
    blocked: function () { return current().enabled; },
    state: current,
  };
  window.NXMaint = NXMaint;
  var q = window.NXMaintQ || [];
  window.NXMaintQ = null;
  q.forEach(function (c) { try { NXMaint[c[0]](c[1]); } catch (e) {} });
})();
