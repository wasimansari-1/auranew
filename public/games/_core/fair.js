/* NEXORNG provably fair — one view for every game (loaded last on the game page).
 *
 * A badge ("Provably fair · round #4521 · tap to check") that opens one clear view:
 *   – what provably fair means, in three steps (hash before → the round → seed after)
 *   – the hash and the seed, each with a Copy button
 *   – a real check on the page: the browser works out SHA-256 of the seed and compares it with the hash
 *   – the last finished round stays, so there is time to look at it while the next one runs
 * The games are not rewritten for it: each keeps writing round, hash and seed into its own elements
 * (#fRound, #fHash, #fSeed); this file reads them, replaces the game's old line with the badge and
 * moves the game's own extras (its explanation, a client seed, a spin's stops) into the view.
 * No RTP and no list of past rounds are shown here.
 */
(function () {
  'use strict';
  var css = [
    '.nxf-badge{display:flex;align-items:center;gap:10px;width:100%;margin:12px 0 0;padding:10px 12px;border:1px solid rgba(255,255,255,.14);border-radius:14px;',
    'background:linear-gradient(135deg,rgba(47,211,107,.14),rgba(255,255,255,.04));color:#fff;font:600 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left;cursor:pointer}',
    '.nxf-badge:active{transform:scale(.99)}',
    '.nxf-badge__icon{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:rgba(47,211,107,.18);color:#3fe07f}',
    '.nxf-badge__text{display:flex;flex-direction:column;gap:2px;min-width:0;margin-right:auto}',
    '.nxf-badge__sub{font-weight:500;font-size:11.5px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.nxf-badge__go{flex:none;opacity:.6}',
    '.nxf{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center;background:rgba(4,2,10,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);',
    'font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f4f4f8;animation:nxf-fade .18s ease-out}',
    '.nxf[hidden]{display:none}',
    '.nxf__panel{width:100%;max-width:520px;max-height:92vh;max-height:92dvh;overflow:auto;padding:8px 18px calc(18px + env(safe-area-inset-bottom,0px));border-radius:22px 22px 0 0;',
    'background:linear-gradient(180deg,#1b1136,#0e0820);border:1px solid rgba(255,255,255,.12);border-bottom:0;box-shadow:0 -18px 50px rgba(0,0,0,.55);animation:nxf-up .24s cubic-bezier(.22,1,.36,1)}',
    '.nxf__grip{width:42px;height:4px;margin:2px auto 10px;border-radius:4px;background:rgba(255,255,255,.22)}',
    '.nxf__head{display:flex;align-items:center;gap:12px}',
    '.nxf__shield{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#2fd36b,#16a34a);color:#06240f;box-shadow:0 6px 18px rgba(47,211,107,.35)}',
    '.nxf__title{margin:0;font-size:19px;font-weight:800;letter-spacing:.01em}',
    '.nxf__game{font-size:12.5px;opacity:.7}',
    '.nxf__close{margin-left:auto;display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;cursor:pointer}',
    '.nxf__lead{margin:12px 0 14px;opacity:.86}',
    '.nxf__tabs{display:flex;gap:4px;padding:4px;border-radius:14px;background:rgba(0,0,0,.35);margin-bottom:14px}',
    '.nxf__tab{flex:1;min-width:0;padding:8px 6px;border:0;border-radius:11px;background:none;color:rgba(255,255,255,.7);font:inherit;font-weight:700;font-size:13px;cursor:pointer}',
    '.nxf__tab small{display:block;font-weight:500;font-size:11px;opacity:.75}',
    '.nxf__tab[aria-selected="true"]{background:rgba(255,255,255,.12);color:#fff}',
    '.nxf__steps{list-style:none;margin:0;padding:0}',
    '.nxf__step{position:relative;padding:0 0 16px 40px}',
    '.nxf__step:before{content:"";position:absolute;left:13px;top:28px;bottom:0;width:2px;background:rgba(255,255,255,.12)}',
    '.nxf__step:last-child{padding-bottom:4px}.nxf__step:last-child:before{display:none}',
    '.nxf__num{position:absolute;left:0;top:0;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.1);font-weight:800;font-size:13px}',
    '.nxf__step--done .nxf__num{background:#2fd36b;color:#06240f}',
    '.nxf__step h3{margin:3px 0 2px;font-size:14.5px;font-weight:700}',
    '.nxf__step p{margin:0;font-size:13px;opacity:.78}',
    '.nxf__box{display:flex;align-items:stretch;gap:8px;margin-top:8px}',
    '.nxf__code{flex:1;min-width:0;padding:9px 11px;border-radius:12px;background:rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.08);font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;-webkit-user-select:text;user-select:text}',
    '.nxf__code--wait{display:flex;align-items:center;gap:8px;font:13px/1.4 system-ui,sans-serif;opacity:.75}',
    '.nxf__copy{flex:none;align-self:flex-start;padding:9px 12px;border:0;border-radius:12px;background:rgba(255,255,255,.1);color:#fff;font:inherit;font-weight:700;font-size:12.5px;cursor:pointer}',
    '.nxf__verdict{display:flex;gap:12px;align-items:flex-start;margin:14px 0 4px;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05)}',
    '.nxf__verdict--ok{border-color:rgba(47,211,107,.5);background:rgba(47,211,107,.12)}',
    '.nxf__verdict--bad{border-color:rgba(255,92,138,.6);background:rgba(255,92,138,.12)}',
    '.nxf__verdict svg{flex:none;margin-top:1px}',
    '.nxf__verdict b{display:block;font-size:14.5px}',
    '.nxf__verdict span{font-size:12.5px;opacity:.82}',
    '.nxf__more{margin-top:10px;font-size:12.5px;opacity:.8}',
    '.nxf__more summary{cursor:pointer;font-weight:700;padding:6px 0}',
    '.nxf__more p{margin:6px 0 0}',
    '.nxf-badge--compact{display:inline-flex;width:auto;margin:0;padding:6px 10px 6px 6px;gap:8px;border-radius:999px;vertical-align:middle}',
    '.nxf-badge--compact .nxf-badge__icon{width:24px;height:24px;border-radius:50%}.nxf-badge--compact .nxf-badge__sub,.nxf-badge--compact .nxf-badge__go{display:none}',
    '.nxf-gone,.nxf__tabs[hidden]{display:none!important}',
    '.nxf__empty{margin:14px 0 4px;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);font-size:13px;opacity:.9}',
    '.nxf__own{display:block!important;position:static!important;margin:8px 0 0!important;padding:0!important;border:0!important;background:none!important;box-shadow:none!important;max-height:none!important;width:auto!important;color:#f4f4f8!important;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif!important;text-align:left!important}',
    '.nxf__own *{color:inherit!important;font-family:inherit!important;text-shadow:none!important}',
    '.nxf__own p,.nxf__own label,.nxf__own dt{display:block;margin:10px 0 4px!important;font-size:12.5px!important;opacity:.85}',
    '.nxf__own code,.nxf__own dd{display:block;margin:0!important;padding:9px 11px!important;border-radius:12px!important;background:rgba(0,0,0,.42)!important;border:1px solid rgba(255,255,255,.08)!important;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important;word-break:break-all;-webkit-user-select:text;user-select:text}',
    '.nxf__own dd code{padding:0!important;border:0!important;background:none!important}',
    '.nxf__own input{width:100%;box-sizing:border-box;margin:6px 0 0!important;padding:10px 12px!important;border-radius:12px!important;border:1px solid rgba(255,255,255,.16)!important;background:rgba(0,0,0,.42)!important;color:#fff!important;font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important}',
    '.nxf__own button{margin:8px 8px 0 0!important;padding:9px 14px!important;border:0!important;border-radius:12px!important;background:rgba(255,255,255,.12)!important;color:#fff!important;font:700 12.5px system-ui,sans-serif!important;cursor:pointer;width:auto!important;height:auto!important;min-height:0!important}',
    '.nxf__own svg{display:none}',
    '@keyframes nxf-up{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}',
    '@keyframes nxf-fade{from{opacity:0}to{opacity:1}}',
    '@media (min-width:900px){.nxf{align-items:center}.nxf__panel{border-radius:22px;border-bottom:1px solid rgba(255,255,255,.12);padding-top:16px}.nxf__grip{display:none}}',
    '@media (prefers-reduced-motion:reduce){.nxf,.nxf__panel{animation:none}}',
  ].join('');

  var ICON = {
    shield: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-2.9 8.3-7 10-4.100-1.700-7-5.400-7-10V6l7-3z"/><path d="M8.800 12.200l2.300 2.300 4.300-4.600"/></svg>',
    go: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    ok: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3fe07f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.300l2.700 2.700L16 9.500"/></svg>',
    bad: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff5c8a" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  };

  function hexBytes(hex) {
    if (!/^([0-9a-f]{2})+$/i.test(hex)) return null;
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  /** SHA-256(seed) worked out here, in the player's own browser. */
  function sha256Hex(seedHex) {
    var bytes = hexBytes(seedHex);
    if (!bytes || !window.crypto || !crypto.subtle) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', bytes).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }


  var NOUN = 'Round';

  function build(opts) {
    if (!document.getElementById('nxf-style')) {
      var st = document.createElement('style'); st.id = 'nxf-style'; st.textContent = css; document.head.appendChild(st);
    }
    var badge = document.createElement('button');
    badge.type = 'button'; badge.className = 'nxf-badge' + (opts.compact ? ' nxf-badge--compact' : '');
    badge.innerHTML = '<span class="nxf-badge__icon">' + ICON.shield + '</span><span class="nxf-badge__text"><span>Provably fair</span><span class="nxf-badge__sub"></span></span><span class="nxf-badge__go">' + ICON.go + '</span>';
    var badgeSub = badge.querySelector('.nxf-badge__sub');

    var sheet = document.createElement('div');
    sheet.className = 'nxf'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Provably fair');
    sheet.innerHTML = '<div class="nxf__panel"><div class="nxf__grip"></div>' +
      '<div class="nxf__head"><span class="nxf__shield">' + ICON.shield.replace(/20/g, '26') + '</span><div><h2 class="nxf__title">Provably fair</h2><div class="nxf__game"></div></div>' +
      '<button type="button" class="nxf__close" aria-label="Close">' + ICON.close + '</button></div>' +
      '<p class="nxf__lead"></p>' +
      '<div class="nxf__tabs" role="tablist"><button type="button" class="nxf__tab" role="tab" data-tab="last"></button><button type="button" class="nxf__tab" role="tab" data-tab="now"></button></div>' +
      '<ol class="nxf__steps"></ol><div class="nxf__result"></div>' +
      '<details class="nxf__more"><summary>How the result is made</summary><div class="nxf__how"></div></details></div>';
    document.body.appendChild(sheet);
    var q = function (s) { return sheet.querySelector(s); };
    var noun = NOUN.toLowerCase();
    q('.nxf__game').textContent = opts.game || '';
    q('.nxf__lead').innerHTML = 'The result of every ' + noun + ' is fixed <b>before</b> it starts. Nobody can change it afterwards — and you can check that yourself.';

    var now = { round: '', hash: '', seed: '' }, last = null, tab = 'last', sums = {}, lastKey = '';

    function text(el, t) { if (el.textContent !== t) el.textContent = t; }
    function box(value, wait) {
      if (!value) return '<div class="nxf__box"><div class="nxf__code nxf__code--wait">' + ICON.lock + '<span>' + wait + '</span></div></div>';
      return '<div class="nxf__box"><code class="nxf__code"></code><button type="button" class="nxf__copy">Copy</button></div>';
    }
    function name(r) { return r.round ? NOUN + ' #' + r.round : 'The last ' + noun; }
    // What the two tabs hold: a finished, checked round — and the one after it, whose seed is still hidden.
    function views() {
      var open = now.hash && (!last || now.hash !== last.hash) ? now : null;
      return { last: last, now: open };
    }
    function draw() {
      var v = views();
      if (!v[tab]) tab = v.last ? 'last' : 'now';
      var r = v[tab], tabs = sheet.querySelectorAll('.nxf__tab'), steps = q('.nxf__steps'), out = q('.nxf__result');
      q('.nxf__tabs').hidden = !(v.last && v.now);
      tabs[0].innerHTML = 'Last ' + noun + '<small>' + (v.last ? (v.last.round ? '#' + v.last.round + ' · ' : '') + 'checked' : '') + '</small>';
      tabs[1].innerHTML = 'This ' + noun + '<small>' + (v.now ? (v.now.round ? '#' + v.now.round + ' · ' : '') + 'seed still hidden' : '') + '</small>';
      tabs[0].setAttribute('aria-selected', String(tab === 'last')); tabs[1].setAttribute('aria-selected', String(tab === 'now'));
      if (!r) { // nothing played yet
        steps.innerHTML =
          '<li class="nxf__step"><span class="nxf__num">1</span><h3>Before the ' + noun + '</h3><p>We publish the <b>hash</b> — a locked fingerprint of the result.</p></li>' +
          '<li class="nxf__step"><span class="nxf__num">2</span><h3>The ' + noun + ' is played</h3><p>The result is already inside the hash. It cannot be changed.</p></li>' +
          '<li class="nxf__step"><span class="nxf__num">3</span><h3>After the ' + noun + '</h3><p>We reveal the <b>seed</b> the result was made from. Your browser checks it against the hash.</p></li>';
        out.innerHTML = '<div class="nxf__empty">Play a ' + noun + ' and its hash and seed show here, checked.</div>';
        return;
      }
      var done = r === last;
      steps.innerHTML =
        '<li class="nxf__step nxf__step--done"><span class="nxf__num">1</span><h3>Before the ' + noun + '</h3><p>We publish the <b>hash</b> — a locked fingerprint of the result.</p>' + box(r.hash, '') + '</li>' +
        '<li class="nxf__step' + (done ? ' nxf__step--done' : '') + '"><span class="nxf__num">2</span><h3>The ' + noun + ' is played</h3><p>The result is already inside the hash. It cannot be changed.</p></li>' +
        '<li class="nxf__step' + (done ? ' nxf__step--done' : '') + '"><span class="nxf__num">3</span><h3>After the ' + noun + '</h3><p>We reveal the <b>seed</b> the result was made from.</p>' + box(done ? r.seed : '', 'Shown when this ' + noun + ' ends') + '</li>';
      var vals = done ? [r.hash, r.seed] : [r.hash];
      Array.prototype.forEach.call(steps.querySelectorAll('code.nxf__code'), function (c, i) { c.textContent = vals[i]; });
      Array.prototype.forEach.call(steps.querySelectorAll('.nxf__copy'), function (b, i) {
        b.onclick = function () {
          var ok = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1400); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(vals[i]).then(ok, function () {}); else ok();
        };
      });
      out.innerHTML = done
        ? '<div class="nxf__verdict nxf__verdict--ok">' + ICON.ok + '<div><b>Checked — ' + name(r).toLowerCase() + ' was fair</b><span>Your browser worked out SHA-256 of the seed: it is exactly the hash published before the ' + noun + '.</span></div></div>'
        : '<div class="nxf__verdict">' + ICON.lock.replace(/16/g, '22') + '<div><b>' + (r.round ? NOUN + ' #' + r.round : 'This ' + noun) + ' — seed still hidden</b><span>The seed is revealed when the ' + noun + ' ends. Then it is checked here automatically.</span></div></div>';
    }

    function open() { tab = 'last'; sheet.hidden = false; draw(); q('.nxf__close').focus(); }
    function close() { sheet.hidden = true; badge.focus(); }
    badge.onclick = open;
    q('.nxf__close').onclick = close;
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    sheet.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    Array.prototype.forEach.call(sheet.querySelectorAll('.nxf__tab'), function (b) { b.onclick = function () { tab = b.dataset.tab; draw(); }; });

    // d = what the game shows right now. A seed counts only once the browser has confirmed that its
    // SHA-256 is the hash shown with it (some games show the next round's hash beside the last seed).
    function update(d) {
      now = { round: d.round || '', hash: d.hash || '', seed: d.seed || '' };
      var paint = function () {
        text(badgeSub, now.round ? NOUN + ' #' + now.round + ' · tap to check' : last ? 'Last ' + noun + ' checked · tap to see' : 'Tap to see how it works');
        var key = now.round + '|' + now.hash + '|' + (last ? last.hash : '');
        if (!sheet.hidden && key !== lastKey) draw();
        lastKey = key;
      };
      paint();
      if (!now.seed || !now.hash) return;
      var seed = now.seed, hash = now.hash.toLowerCase(), round = now.round;
      var settle = function (sum) { if (sum && sum === hash) { last = { round: round, hash: hash, seed: seed }; paint(); } };
      if (sums[seed] !== undefined) return settle(sums[seed]);
      sha256Hex(seed).then(function (sum) { sums = {}; sums[seed] = sum; settle(sum); });
    }
    return { badge: badge, update: update, own: q('.nxf__how'), open: open };
  }

  // ---------------------------------------------------------------- putting it into a game
  // The games keep writing the round, hash and seed into their own elements (#fRound, #fHash, #fSeed).
  // Those stay as the source; the game's old line and raw details are replaced by the badge and sheet.
  function hex(el, min) { var t = el ? (el.textContent || el.value || '').trim() : ''; return new RegExp('^[0-9a-f]{' + min + ',}$', 'i').test(t) ? t : ''; }
  function gone(el) { if (el) el.classList.add('nxf-gone'); }

  function mount() {
    var id = function (x) { return document.getElementById(x); };
    var hashEl = id('fHash'), seedEl = id('fSeed'), roundEl = id('fRound');
    if (!hashEl || !seedEl || document.querySelector('.nxf-badge')) return;
    // A game that already opens its own provably-fair dialog (some slots) keeps it.
    if (hashEl.closest('[role="dialog"], .modal, .sheet, .pop')) return;
    // the game's own details: its box when it has one, else the block that holds hash and seed
    var detail = id('fairDetail') || id('fairBody');
    if (!detail) { detail = hashEl.parentNode; while (detail && detail !== document.body && !detail.contains(seedEl)) detail = detail.parentNode; }
    if (!detail || detail === document.body) return;
    var trigger = null;
    ['fair', 'fairHead', 'fairBtn', 'fairLine'].forEach(function (x) { var e = id(x); if (!trigger && e && e !== detail && !e.contains(hashEl)) trigger = e; });
    if (trigger && /\bhand\b/i.test(trigger.textContent || '')) NOUN = 'Hand';

    var host = trigger || detail, parent = host.parentNode;
    var wide = !trigger || host.getBoundingClientRect().width >= parent.getBoundingClientRect().width * 0.6 || /^(P|DIV|SECTION)$/.test(host.tagName);
    var title = (document.title || '').split(/\s[—–|·-]\s/)[0].trim();
    var fair = build({ compact: !wide, game: title });
    parent.insertBefore(fair.badge, host);
    gone(trigger);

    // the game's own extras (its explanation, a client seed, the stops of a spin) go into the sheet;
    // the hash, seed and round shown above are not repeated there
    fair.own.appendChild(detail);
    detail.removeAttribute('hidden');
    detail.classList.add('nxf__own');
    [hashEl, seedEl, roundEl].forEach(function (el) {
      if (!el || !detail.contains(el)) return;
      var row = el.parentNode !== detail && /^(DD|P|LI)$/.test(el.parentNode.tagName) ? el.parentNode : el;
      var label = row.previousElementSibling;
      gone(row);
      if (label && /^(P|DT|LABEL|H3|H4)$/.test(label.tagName) && !label.querySelector('input,button,code')) gone(label);
    });
    Array.prototype.forEach.call(detail.querySelectorAll('h2'), gone); // "Provably fair" again
    var rest = detail.cloneNode(true); // what is left to show of the game's own block
    Array.prototype.forEach.call(rest.querySelectorAll('.nxf-gone, svg, script, style'), function (n) { n.parentNode.removeChild(n); });
    if (!(rest.textContent || '').trim() && !rest.querySelector('input')) {
      detail.classList.add('nxf-gone');
      fair.own.appendChild(document.createTextNode('The seed is the only input of the result. Check with any SHA-256 tool: the SHA-256 of the seed (as hex bytes) is the hash.'));
    }

    var read = function () {
      var r = roundEl ? (roundEl.textContent || '').replace(/[^0-9]/g, '') : '';
      fair.update({ round: r, hash: hex(hashEl, 64), seed: hex(seedEl, 32) });
    };
    var mo = new MutationObserver(read);
    [hashEl, seedEl, roundEl].forEach(function (el) { if (el) mo.observe(el, { childList: true, characterData: true, subtree: true }); });
    read();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
