/* NEXORNG phone fit — shared by every engine game.
 *
 * Phones (the one-column layout, narrower than 900 px): the game scene is sized to the phone's
 * screen so the first bet panel always fits on the first screen without scrolling. The scene
 * grows on tall phones (iPhone 17 Pro Max, Android XL) and shrinks on short ones (iPhone SE,
 * Display Zoom), and it refits whenever the screen size changes (rotation, browser bars,
 * display zoom, split view). Wide screens keep the game's own desktop layout untouched.
 *
 * Include after the game's own scripts: <script src="../_core/fit-screen.js"></script>
 */
(function () {
  'use strict';
  var WIDE = window.matchMedia('(min-width: 900px)');
  var MIN_SHARE = 0.4;  // the scene never gets smaller than 40 % of the screen …
  var MIN_PX = 300;     // … or 300 px, whichever is smaller
  var MAX_SHARE = 0.62; // and never taller than 62 % of the screen
  var GAP = 10;         // room left under the bet panel

  var stage = null, applied = 0, lastKey = '', kicking = false, watched = null, fitW = 0, waiting = false;

  function q(sel) { return document.querySelector(sel); }
  function betButton() {
    return q('#action') || q('#roll') || q('.panels .action') || q('.panel .action') || q('button.action');
  }
  function kick() { // the game's own fit() redraws the scene at the new size
    kicking = true;
    window.dispatchEvent(new Event('resize'));
    kicking = false;
  }
  function reset() {
    if (!stage || !applied) return;
    stage.style.height = '';
    stage.style.maxHeight = '';
    stage.style.minHeight = '';
    applied = 0;
    kick();
  }

  function fit(force) {
    stage = stage || q('.stage');
    var btn = betButton();
    if (!stage || !btn) return;
    if (WIDE.matches) return reset();
    var H = window.innerHeight, key = window.innerWidth + 'x' + H;
    if (!force && key === lastKey && applied) return;
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    // Scrolled down (the player is looking at the bets list): the browser's bars come and go and change
    // the screen height. The scene keeps its size until the page is back at the top — resizing it now
    // would move the page under the player's finger and redraw the scene. A turned phone still refits.
    if (y > 0 && applied && window.innerWidth === fitW) { waiting = true; return; }
    waiting = false;
    lastKey = key;
    fitW = window.innerWidth;
    // Measure from the top of the page (a scrolled page with a sticky scene gives wrong numbers),
    // then put the player back where they were.
    if (y) window.scrollTo(0, 0);

    var s = stage.getBoundingClientRect();
    var panel = btn.closest('section') || btn.closest('.panel') || btn;
    if (window.ResizeObserver && watched !== panel) { // the panel changes size (built late, fonts): refit
      watched = panel;
      new ResizeObserver(function () { later(true); }).observe(panel);
    }
    var auto = q('#autoAt') || q('#autoOn');
    var controlsBottom = Math.max(btn.getBoundingClientRect().bottom, auto && panel.contains(auto) ? auto.getBoundingClientRect().bottom : 0) + 8;
    var below = panel.getBoundingClientRect().bottom - s.bottom;    // results row + the whole panel
    var belowControls = controlsBottom - s.bottom;                    // … down to the bet button / auto
    var min = Math.round(Math.min(H * MIN_SHARE, MIN_PX));
    var max = Math.round(H * MAX_SHARE);
    var h = H - s.top - below - GAP;                                  // the whole panel on screen
    if (h < min) h = H - s.top - belowControls - GAP;                 // short phone: at least the bet button
    h = Math.round(Math.max(min, Math.min(max, h)));
    if (applied && Math.abs(h - s.height) < 3) { if (y) window.scrollTo(0, y); return; }
    stage.style.height = h + 'px';
    stage.style.maxHeight = 'none';
    stage.style.minHeight = '0';
    applied = h;
    kick();
    if (y) window.scrollTo(0, y);
  }

  var timer = 0;
  function later(force) { clearTimeout(timer); timer = setTimeout(function () { fit(force); }, 60); }

  window.addEventListener('resize', function () { if (!kicking) later(true); });
  window.addEventListener('orientationchange', function () { later(true); setTimeout(function () { fit(true); }, 400); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (!kicking) later(true); });
  if (WIDE.addEventListener) WIDE.addEventListener('change', function () { later(true); });
  window.addEventListener('scroll', function () { // back at the top: do the refit that waited
    if (waiting && (window.scrollY || document.documentElement.scrollTop || 0) <= 0) later(true);
  }, { passive: true });

  // The games build their bet panels in script and load fonts: fit after each settles.
  function start() {
    fit(true);
    [300, 1200, 2500, 5000].forEach(function (ms) { setTimeout(function () { fit(true); }, ms); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fit(true); });
  }
  if (document.readyState === 'complete') start();
  else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { fit(true); }, 0); });
    window.addEventListener('load', start);
  }
})();
