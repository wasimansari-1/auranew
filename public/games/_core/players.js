/* NEXORNG players strip — who is in this round, shown on the scene (shared by every crash game).
 *
 * Two faces: the two players with the latest activity — a new bet (joins) or a cash-out
 * (exits, green ring + multiplier). Each time, that face rises in from below, the previous one
 * slides to second place and the older one leaves — the only animation.
 * The strip never grows (no "+N"); the count shows everyone.
 * Text:
 * "N players · joined this round". Flight: "N still in · M cashed out"; a player who cashes out
 * gets a green ring and their multiplier. Only real bets from the engine (round.bet /
 * round.cashout); one face per player, however many panels they bet on.
 *
 *   var strip = NXPlayers.create(stageElement);   // faces: the shared portraits (NXPlayers.face)
 *   …or { face: function (name) { return <element>; } } for a game with its own themed faces
 *   strip.update(S);   // in the game's render(): needs S.phase and S.bets [{ player, x }]
 *
 * Phones only (wide screens already show the full bets list). Placement: bottom-right of the play
 * area, just above the results row (CSS var --below on the stage, set by the game).
 */
(function () {
  'use strict';

  var MAX_FACES = 2;
  var css = [
    '.nxp{position:absolute;z-index:3;right:10px;bottom:calc(var(--below,0px) + 8px);',
    'display:flex;align-items:center;gap:8px;max-width:calc(100% - var(--left,0px) - 20px);padding:5px 12px 5px 6px;',
    'border-radius:999px;background:rgba(10,8,22,.42);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);',
    'color:#fff;font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:none;',
    'box-shadow:0 4px 14px rgba(0,0,0,.25);transition:opacity .3s}',
    '.nxp[hidden]{display:flex!important;opacity:0}',
    '.nxp__faces{display:flex;flex-shrink:0}',
    '.nxp__face{position:relative;width:28px;height:28px;margin-left:-9px;border-radius:50%;box-shadow:0 0 0 2px rgba(10,8,22,.8)}',
    '.nxp__face:first-child{margin-left:0}',
    '.nxp__pic{display:block;width:100%!important;height:100%!important;border-radius:50%;box-sizing:border-box}',
    '.nxp__face--won{box-shadow:0 0 0 2px #2fd36b}',
    '.nxp__x{position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);padding:0 4px;border-radius:6px;',
    'background:#18b24f;color:#fff;font-size:9px;font-weight:800;line-height:13px;white-space:nowrap}',
    '.nxp__text{display:flex;flex-direction:column;min-width:0}',
    '.nxp__count{font-size:13px;font-weight:800;white-space:nowrap}',
    '.nxp__sub{opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.nxp__faces{padding:2px}',
    '.nxp__faces--turn .nxp__face:first-child{animation:nxp-up .5s cubic-bezier(.22,1,.36,1) both}',
    '.nxp__faces--turn .nxp__face:nth-child(2){animation:nxp-slide .5s cubic-bezier(.22,1,.36,1) both}',
    '@keyframes nxp-up{from{transform:translateY(70%);opacity:0}to{transform:none;opacity:1}}',
    '@keyframes nxp-slide{from{transform:translateX(-19px)}to{transform:none}}',
    '@media (prefers-reduced-motion:reduce){.nxp__faces--turn .nxp__face{animation:none}}',
    // Wide screens show the full bets list beside the game: the strip is for phones only.
    '@media (min-width:900px){.nxp,.nxp[hidden]{display:none!important}}',
  ].join('');

  // A player's face: one of the shared portraits (faces.webp, 15 in an 8×2 grid), always the same
  // one for the same name. For the strip and for a game's own bets list:
  //   NXPlayers.face(name, 'avatar')  →  <i class="avatar"> with the picture as its background
  // The element takes its size and shape from the game's own class.
  var FACES = 15, FACE_COLS = 8, FACE_ROWS = 2;
  // (a list built as an HTML string uses the style alone: style="background:' + NXPlayers.faceStyle(name) + '")
  function faceStyle(name) {
    name = String(name);
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    var k = h % FACES;
    return '#2a1d45 url(../_core/faces.webp) ' + ((k % FACE_COLS) / (FACE_COLS - 1) * 100) + '% ' +
      (Math.floor(k / FACE_COLS) / (FACE_ROWS - 1) * 100) + '% / ' + FACE_COLS * 100 + '% ' + FACE_ROWS * 100 + '% no-repeat';
  }
  function face(name, cls, tag) {
    var el = document.createElement(tag || 'i');
    if (cls) el.className = cls;
    el.style.background = faceStyle(name);
    return el;
  }

  function create(stage, opts) {
    opts = opts || {};
    if (!document.getElementById('nxp-style')) {
      var st = document.createElement('style');
      st.id = 'nxp-style';
      st.textContent = css;
      document.head.appendChild(st);
    }
    var faceOf = opts.face || face;
    var el = document.createElement('div');
    el.className = 'nxp';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="nxp__faces"></div><div class="nxp__text"><strong class="nxp__count"></strong><span class="nxp__sub"></span></div>';
    stage.appendChild(el);
    var faces = el.querySelector('.nxp__faces'), count = el.querySelector('.nxp__count'), sub = el.querySelector('.nxp__sub');
    var lastKey = '', lastNewest = '';
    var activity = [], cashedSeen = {}; // players by latest activity (bet or cash-out), this round

    function text(node, t) { if (node.textContent !== t) node.textContent = t; }

    function update(S) {
      var players = {}, order = [];
      (S.bets || []).forEach(function (b) {
        var p = players[b.player];
        if (!p) { p = players[b.player] = { x: 0 }; order.push(b.player); }
        if (b.x) p.x = Math.max(p.x, b.x);
      });
      var n = order.length;
      var live = S.phase === 'betting' || S.phase === 'flying';
      el.hidden = !live || n === 0;
      if (el.hidden) { lastNewest = ''; lastKey = ''; activity = []; cashedSeen = {}; return; } // next round: start fresh
      // latest activity first: a player moves to the front when they bet or when they cash out
      order.forEach(function (p) {
        var cashedNow = players[p].x > 0;
        if (activity.indexOf(p) < 0) activity.push(p);
        else if (cashedNow && !cashedSeen[p]) { activity.splice(activity.indexOf(p), 1); activity.push(p); }
        if (cashedNow) cashedSeen[p] = true;
      });

      var cashed = order.filter(function (p) { return players[p].x; }).length;
      text(count, n.toLocaleString('en') + (n === 1 ? ' player' : ' players'));
      text(sub, S.phase === 'betting' ? 'joined this round'
        : (n - cashed) + ' still in' + (cashed ? ' · ' + cashed + ' cashed out' : ''));

      var recent = activity.slice(-MAX_FACES).reverse(); // latest activity first
      var front = recent[0] + ':' + (players[recent[0]].x > 0);
      var joined = front !== lastNewest; // someone joined or cashed out: animate (only then)
      lastNewest = front;
      var key = recent.map(function (p) { return p + ':' + players[p].x; }).join('|');
      if (key === lastKey) return;
      lastKey = key;
      faces.innerHTML = '';
      faces.classList.remove('nxp__faces--turn');
      if (joined) { void faces.offsetWidth; faces.classList.add('nxp__faces--turn'); }
      recent.forEach(function (p) {
        var b = document.createElement('span');
        b.className = 'nxp__face' + (players[p].x ? ' nxp__face--won' : '');
        b.title = p;
        var pic = faceOf(p);
        pic.classList.add('nxp__pic'); // the game's avatar element, sized to the bubble
        b.appendChild(pic);
        if (players[p].x) {
          var x = document.createElement('span');
          x.className = 'nxp__x';
          x.textContent = players[p].x.toFixed(2) + 'x';
          b.appendChild(x);
        }
        faces.appendChild(b);
      });
    }

    return { update: update };
  }

  window.NXPlayers = { create: create, face: face, faceStyle: faceStyle };
})();
