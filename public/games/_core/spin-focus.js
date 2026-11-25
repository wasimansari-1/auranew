/* NEXORNG spin focus — shared by the roulette / wheel games. While the wheel spins the place-bet area
 * slides down out of view and the scene takes the whole screen; once the result has been seen it slides
 * back up. A game only says what moves; the timing, the result hold, tap-to-skip and the scene morph
 * live here.
 *
 *   var focus = NXSpinFocus.create({
 *     root: document.querySelector('.game'),     // gets .nx-focus while the panel is (going) down
 *     panel: function (wide) { return ['.board-wrap', '#dock']; }, // the bet area: elements that slide away
 *     list: '.bets',                              // phone: the bets list under the panel goes too
 *     scene: {                                    // optional: the generic scene morph (below)
 *       canvas: $('scene'), relayout: fit,        // the game's own fit()
 *       wheel: function () { return { x, y, r }; }, // wheel centre + radius in stage px, current layout
 *       parts: [{ el: $('medal'), scale: true }, { el: $('ribbon') }], // result texts that follow the wheel
 *                                               // ({ fade: true }: a text away from the wheel waits at its new place)
 *     },
 *     measure: function () { … },                 // instead of panel/list: full control ({ movers, vars })
 *     onApply: function (p) {}, onUp: function (afterHold) {}, betTag: false (the game shows its own),
 *   });
 *   focus.down([stakeText])  — betting closed: the spin started
 *   focus.hold()             — the result is showing: the panel returns after HOLD ms (a tap skips)
 *   focus.release([instant]) — back up now (errors, the player reaching for the panel)
 *   focus.check(busy)        — safety from the game's render(): never left down without a spin
 *   focus.p(now), focus.isDown(), focus.moving(), focus.holding(), focus.offset(el), focus.refresh()
 *
 * Scene morph: at each slide the game re-fits ONCE into the other layout (the phone canvas reaches the
 * screen bottom while the panel is away). The last frame of the old layout is kept as a picture over
 * the live canvas and fades out; the first frame of the new one is kept under it (so the new layout
 * covers the scene even while the live canvas is scaled down). All are scaled and moved so their wheels
 * stay on one wheel growing / moving between the layouts; pictures are padded by stretching their edge
 * pixels. Only transform, opacity and clip-path change per frame.
 */
(function () {
  'use strict';

  var DURATION = 420; // ms for a full slide
  var HOLD = 2600;    // ms the result stays on the full-screen wheel
  var REDUCED = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var WIDE = window.matchMedia ? window.matchMedia('(min-width: 900px)') : { matches: false };
  var HAS_TRANSLATE = typeof document.documentElement.style.translate === 'string';
  var SKIP_IGNORE = '.top, .bets, .side, .lore, .toast, .nxr-sheet, .nxr-bets-btn, button, input, a';
  var CSS =
    '.stage::after { translate: 0 var(--nx-fy, 0px); }\n' +
    '.sticky::after { translate: 0 var(--nx-fy-edge, 0px); }\n' +
    '.nx-ext { overflow: visible !important; overflow-x: clip !important; }\n' +
    '.nx-ext canvas { pointer-events: none; }\n' +
    '.nx-snap { position: absolute; left: 0; top: 0; pointer-events: none; transform-origin: 0 0; }\n' +
    '.nx-has-bet { position: relative; }\n' +
    '.nx-bet { position: absolute; top: calc(100% + 6px); right: 4px; padding: 3px 10px; border-radius: 999px; ' +
    'background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(255, 255, 255, 0.28); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); ' +
    'font-size: 12px; line-height: 1.3; white-space: nowrap; pointer-events: none; color: inherit; }\n' +
    '.nx-bet b { font-variant-numeric: tabular-nums; }\n';

  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; } // ease-in-out (cubic)
  function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function fadeOf(p) { return 1 - smooth(0.2, 0.9, p); }
  function px(v) { return v.toFixed(2) + 'px'; }
  function setY(el, y) {
    if (HAS_TRANSLATE) el.style.translate = y ? '0 ' + px(y) : '';
    else el.style.transform = y ? 'translate3d(0,' + px(y) + ',0)' : '';
  }
  function $$(sel) { return typeof sel === 'string' ? Array.prototype.slice.call(document.querySelectorAll(sel)) : sel ? [sel] : []; }
  function injectCss() {
    if (document.getElementById('nx-spin-focus')) return;
    var s = document.createElement('style');
    s.id = 'nx-spin-focus';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ------------------------------------------------------------------ the scene morph
  function sceneMorph(cfg) {
    var canvas = cfg.canvas, stage = cfg.stage || canvas.closest('.stage') || canvas.parentNode;
    var run = null, extended = false, ext = 0;

    function look(focusOn, place) { // re-fit the game into one layout (movers at their place for it)
      place(focusOn ? 1 : 0);
      extended = focusOn && ext > 0;
      canvas.style.height = extended ? (stage.getBoundingClientRect().height + ext) + 'px' : '';
      if (extended || run) stage.classList.add('nx-ext');
      cfg.relayout();
      return cfg.wheel();
    }
    function copy(src) { // the frame now on screen, as a picture (sizes in canvas px)
      var c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      if (c.width && c.height) c.getContext('2d').drawImage(src, 0, 0);
      return c;
    }
    // Pad the picture (edge pixels stretched outwards) so that, moved and scaled with its wheel, it
    // still covers the visible scene all the way.
    function padded(pic, cssW, cssH, w, path) {
      var kx = pic.width / cssW || 1, ky = pic.height / cssH || 1, x0 = 0, x1 = cssW, y0 = 0, y1 = cssH;
      for (var i = 0; i <= 16; i++) {
        var g = path(i / 16), k = g.r / w.r;
        x0 = Math.min(x0, (0 - g.x) / k + w.x); x1 = Math.max(x1, (g.W - g.x) / k + w.x);
        y0 = Math.min(y0, (0 - g.y) / k + w.y); y1 = Math.max(y1, (g.B - g.y) / k + w.y);
      }
      var cap = function (v, d) { return Math.ceil(Math.min(Math.max(0, v) + (v > 0.5 ? 2 : 0), d * 0.75)); };
      var pl = cap(-x0, cssW), pr = cap(x1 - cssW, cssW), pt = cap(-y0, cssH), pb = cap(y1 - cssH, cssH);
      var c = document.createElement('canvas'), L = Math.round(pl * kx), T = Math.round(pt * ky);
      c.width = pic.width + L + Math.round(pr * kx); c.height = pic.height + T + Math.round(pb * ky);
      var g2 = c.getContext('2d'), W = pic.width, H = pic.height;
      g2.imageSmoothingEnabled = false;
      g2.drawImage(pic, L, T);
      if (T) g2.drawImage(pic, 0, 0, W, 1, L, 0, W, T);                                  // top row upwards
      if (c.height - T - H) g2.drawImage(pic, 0, H - 1, W, 1, L, T + H, W, c.height - T - H); // bottom row down
      if (L) g2.drawImage(c, L, 0, 1, c.height, 0, 0, L, c.height);                      // left column
      if (c.width - L - W) g2.drawImage(c, L + W - 1, 0, 1, c.height, L + W, 0, c.width - L - W, c.height);
      return { c: c, l: L / kx, t: T / ky, cssW: c.width / kx, cssH: c.height / ky };
    }
    function partsNow() { // result texts that follow the wheel (measured in the new layout)
      var out = [];
      (typeof cfg.parts === 'function' ? cfg.parts() : cfg.parts || []).forEach(function (pt) {
        var el = pt.el;
        if (!el || el.hidden || !el.getClientRects().length) return;
        clearPart(el);
        var r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(), d = { x: 0, y: 0 };
        var c = { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
        if (pt.scale) { // `scale` turns about the element's origin: measure how far its centre drifts
          el.style.scale = '2';
          var r2 = el.getBoundingClientRect();
          d = { x: r2.left + r2.width / 2 - s.left - c.x, y: r2.top + r2.height / 2 - s.top - c.y };
          el.style.scale = '';
        }
        out.push({ el: el, scale: !!pt.scale, fade: !!pt.fade, c: c, d: d });
      });
      return out;
    }
    function clearPart(el) { el.style.translate = ''; el.style.scale = ''; el.style.opacity = ''; }
    function layer(P, before) { // a picture layer in the stage, just before `before`
      P.c.className = 'nx-snap';
      P.c.setAttribute('aria-hidden', 'true');
      P.c.style.width = px(P.cssW); P.c.style.height = px(P.cssH);
      canvas.parentNode.insertBefore(P.c, before);
      return P;
    }
    // Scale + move a layer (whose wheel `w` sits at (w.x + pad.l, w.y + pad.t) in it) onto the wheel g,
    // cut at the scene's bottom edge B.
    function place2(el, g, w, pad, B, cssH) {
      var k = g.r / w.r, tx = g.x - k * (w.x + pad.l), ty = g.y - k * (w.y + pad.t);
      el.style.transform = 'translate(' + px(tx) + ',' + px(ty) + ') scale(' + k.toFixed(4) + ')';
      el.style.clipPath = 'inset(0 0 ' + px(Math.max(0, cssH - (B - ty) / k)) + ' 0)';
    }
    function clearLayer(el) { el.style.transform = ''; el.style.clipPath = ''; el.style.opacity = ''; el.style.transformOrigin = ''; }

    return {
      ext: function (v) { ext = v; },
      // A slide starts: keep the frame, switch the game to the other layout, prepare the morph.
      begin: function (target, at, place) {
        if (!HAS_TRANSLATE || REDUCED.matches) { look(target === 1, place); place(at); return; }
        this.settle(target);
        var s = stage.getBoundingClientRect(), H0 = s.height, W = s.width;
        var wA = cfg.wheel(), pic = copy(canvas), cssHA = canvas.getBoundingClientRect().height || H0;
        var wB = look(target === 1, place);
        place(at);
        var w0 = target === 1 ? wA : wB, w1 = target === 1 ? wB : wA;
        var path = function (v) {
          return { x: w0.x + (w1.x - w0.x) * v, y: w0.y + (w1.y - w0.y) * v, r: w0.r + (w1.r - w0.r) * v, W: W, B: H0 + ext * v };
        };
        run = { target: target, wA: wA, wB: wB, path: path, hB: canvas.getBoundingClientRect().height, W: W, parts: partsNow() };
        // The game may re-fit on its own while the slide runs (its ResizeObservers): it then measures the
        // canvas as it is in the new layout, not scaled by the morph.
        canvas.getBoundingClientRect = function () { var b = stage.getBoundingClientRect(); return new DOMRect(b.left, b.top, b.width, run ? run.hB : b.height); };
        run.A = layer(padded(pic, W, cssHA, wA, path), canvas.nextSibling); // the old layout, fading out on top
        canvas.style.transformOrigin = '0 0';
        stage.classList.add('nx-ext');
        this.apply(at);
      },
      // First frame drawn in the new layout: kept (padded) under the live canvas, so that the new layout
      // covers the whole scene even while the live canvas is smaller than it.
      capture: function () {
        if (!run || run.B) return;
        run.B = layer(padded(copy(canvas), run.W, run.hB, run.wB, run.path), canvas);
      },
      apply: function (v) {
        if (!run) return;
        var g = run.path(v), B = g.B, wB = run.wB, kB = g.r / wB.r;
        place2(canvas, g, wB, { l: 0, t: 0 }, B, run.hB);
        if (run.B) place2(run.B.c, g, wB, run.B, B, run.B.cssH);
        place2(run.A.c, g, run.wA, run.A, B, run.A.cssH);
        var wt = run.target === 1 ? v : 1 - v; // weight of the new layout
        run.A.c.style.opacity = String(Math.round((1 - smooth(0.05, 0.8, wt)) * 1000) / 1000);
        run.parts.forEach(function (pt) {
          if (pt.fade) { pt.el.style.opacity = String(Math.round(smooth(0.6, 1, wt) * 1000) / 1000); return; } // waits at its new place
          var x = g.x + (pt.c.x - wB.x) * kB - pt.c.x, y = g.y + (pt.c.y - wB.y) * kB - pt.c.y;
          if (pt.scale) { x -= pt.d.x * (kB - 1); y -= pt.d.y * (kB - 1); pt.el.style.scale = kB.toFixed(4); }
          pt.el.style.translate = px(x) + ' ' + px(y);
        });
      },
      settle: function (target) { // the slide ended: the live canvas alone, in its own layout
        if (!run) return;
        delete canvas.getBoundingClientRect;
        clearLayer(canvas);
        run.parts.forEach(function (pt) { clearPart(pt.el); });
        [run.A, run.B].forEach(function (L) { if (L && L.c.parentNode) L.c.parentNode.removeChild(L.c); });
        run = null;
        if (!(target === 1 && extended)) stage.classList.remove('nx-ext');
      },
      running: function () { return !!run; },
    };
  }

  // ------------------------------------------------------------------ the panel
  function create(opts) {
    injectCss();
    var root = opts.root || document.querySelector('.game') || document.documentElement;
    var stage = document.querySelector('.stage'), sticky = document.querySelector('.sticky');
    var hist = opts.history === undefined ? document.querySelector('.history') : opts.history;
    var from = 0, to = 0, t0 = 0, dur = 0, raf = 0, shown = -1, cur = 0, layout = { movers: [], vars: [] };
    var holdOn = false, holdTimer = 0, panelEls = [], tag = null;
    var scene = opts.scene ? sceneMorph(opts.scene) : null;
    var hold = opts.hold || HOLD;

    function p(now) {
      if (!dur) return to;
      var k = (now - t0) / dur;
      if (k >= 1) return to;
      return from + (to - from) * ease(Math.max(0, k));
    }
    function place(v) { // the panel, the results row and the fades at progress v
      cur = v;
      layout.movers.forEach(function (m) {
        setY(m.el, v * m.y);
        if (m.fade) m.el.style.opacity = v ? String(Math.round(fadeOf(v) * 1000) / 1000) : '';
      });
      layout.vars.forEach(function (x) { if (v) x.el.style.setProperty(x.name, px(v * x.y)); else x.el.style.removeProperty(x.name); });
    }
    function apply(v) {
      if (v === shown) return;
      shown = v;
      place(v);
      if (scene) scene.apply(v);
      if (tag) { tag.hidden = !v; tag.style.opacity = v ? String(Math.round(v * 1000) / 1000) : ''; }
      if (opts.onApply) opts.onApply(v);
    }
    function settle() {
      dur = 0;
      lockRects(false);
      if (scene) scene.settle(to);
      // In NEXOREEL the host fits the page around its blocks: let it measure again with the panel back.
      if (to === 0 && document.querySelector('[data-nxr-stage]')) setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 0);
    }
    function tick(now) {
      raf = 0;
      if (scene) scene.capture(); // the game has drawn its first frame in the new layout by now
      var v = p(now);
      apply(v);
      if (v !== to) raf = requestAnimationFrame(tick);
      else settle();
    }

    // What moves and how far (transform-independent: offsetHeight, untransformed boxes, the stage box).
    var rectOf = Element.prototype.getBoundingClientRect;
    function untransformedTop(el) { return rectOf.call(el).top - offset(el); }
    // While a slide runs the moved blocks report where they will be (a re-fit by the game then lays the
    // scene out for the layout the slide is heading to). Not for games that measure themselves.
    function lockRects(on) {
      if (opts.measure) return;
      layout.movers.forEach(function (m) {
        if (!on) { delete m.el.getBoundingClientRect; return; }
        m.el.getBoundingClientRect = function () { var r = rectOf.call(m.el), d = (to - cur) * m.y; return new DOMRect(r.left, r.top + d, r.width, r.height); };
      });
    }
    function standard() {
      var vh = window.innerHeight, wide = WIDE.matches, movers = [], vars = [];
      var ext = wide || !stage ? 0 : Math.max(0, Math.round(vh - stage.getBoundingClientRect().bottom));
      var drop = ext; // the results row goes to the screen bottom (with the scene's edge)
      if (hist && hist.getClientRects().length) drop = Math.max(0, Math.round(vh - (wide ? 12 : 10) - (untransformedTop(hist) + hist.offsetHeight)));
      if (hist) movers.push({ el: hist, y: drop });
      panelEls = [];
      var sels = typeof opts.panel === 'function' ? opts.panel(wide) : opts.panel || [];
      sels.forEach(function (sel) {
        $$(sel).forEach(function (el) {
          if (!el.getClientRects().length) return;
          var fixed = window.getComputedStyle(el).position === 'fixed';
          var y = fixed || wide ? Math.max(0, vh - untransformedTop(el)) + 24 : ext;
          movers.push({ el: el, y: y, fade: !fixed, panel: true });
          panelEls.push(el);
        });
      });
      if (!wide && opts.list) $$(opts.list).forEach(function (el) { // not when hidden or shown in a host's sheet (NEXOREEL)
        if (el.offsetParent && !el.closest('.nxr-sheet')) movers.push({ el: el, y: ext, fade: true });
      });
      if (stage) vars.push({ el: stage, name: '--nx-fy', y: wide ? drop : ext }); // the fade under the play area
      if (sticky && !wide) vars.push({ el: sticky, name: '--nx-fy-edge', y: ext });
      if (scene) scene.ext(ext);
      return { movers: movers, vars: vars };
    }
    function measure() {
      var m = (opts.measure || standard)() || {};
      layout = { movers: (m.movers || []).filter(function (x) { return x && x.el; }), vars: (m.vars || []).filter(function (x) { return x && x.el; }) };
      layout.movers.forEach(function (x) { if (x.panel && !x.el.__nxFocus) { x.el.__nxFocus = true; x.el.addEventListener('pointerdown', reach, true); } });
    }
    function reach() { if (dur && to === 0) go(0, true); } // the player reaches for the panel while it is coming up
    function offset(el) {
      for (var i = 0; i < layout.movers.length; i++) if (layout.movers[i].el === el) return cur * layout.movers[i].y;
      return 0;
    }
    function panelTaps(on) { panelEls.concat(layout.movers.filter(function (x) { return x.panel; }).map(function (x) { return x.el; })).forEach(function (el) { el.style.pointerEvents = on ? '' : 'none'; }); }

    function go(target, instant) {
      var now = performance.now(), at = p(now);
      if (target === to && !instant) return;
      if (dur && at !== to) { // reversing half-way: land where it was heading first
        at = to;
        apply(to);
        settle();
      }
      if (target === 1 && at === 0) measure(); // measured with the panel in place
      from = at; to = target; t0 = now;
      root.classList.toggle('nx-focus', to === 1);
      panelTaps(to === 0);
      if (!instant && at !== to) lockRects(true);
      if (scene && at !== to) scene.begin(to, at, place);
      dur = instant || REDUCED.matches || at === to ? 0 : DURATION * Math.abs(to - from);
      shown = -1;
      if (!dur) { cancelAnimationFrame(raf); raf = 0; apply(to); settle(); return; }
      apply(at);
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function release(instant) {
      clearTimeout(holdTimer);
      var was = holdOn;
      holdOn = false;
      if (to !== 1 && !(instant && dur)) return;
      go(0, !!instant);
      if (opts.onUp) opts.onUp(was);
    }
    // A tap on the scene while the result shows brings the panel back (not on the bar, lists, buttons).
    document.addEventListener('click', function (e) {
      if (holdOn && !(e.target && e.target.closest && e.target.closest(SKIP_IGNORE))) release(false);
    });

    if (opts.betTag !== false) { // the spin's stake stays in the top bar while the dock is away
      var wallet = document.querySelector('.wallet');
      if (wallet) {
        tag = document.createElement('span');
        tag.className = 'nx-bet';
        tag.hidden = true;
        wallet.classList.add('nx-has-bet');
        wallet.appendChild(tag);
      }
    }

    return {
      down: function (stake) {
        if (tag && stake != null) { tag.textContent = 'Bet '; var b = document.createElement('b'); b.textContent = stake; tag.appendChild(b); }
        clearTimeout(holdTimer);
        holdOn = false;
        go(1, false);
      },
      up: function (instant) { go(0, !!instant); },
      hold: function () {
        if (to !== 1) return;
        holdOn = true;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(function () { release(false); }, hold);
      },
      release: release,
      check: function (busy) { if (to === 1 && !busy && !holdOn) release(false); },
      p: p,
      isDown: function () { return to === 1; },
      moving: function () { return !!dur && p(performance.now()) !== to; },
      holding: function () { return holdOn; },
      offset: offset,
      refresh: function () {
        if (!to && !dur) return;
        var old = layout.movers.concat(layout.vars);
        measure();
        old.forEach(function (x) { // a block that is no longer moved goes back to its own place
          var still = layout.movers.concat(layout.vars).some(function (y) { return y.el === x.el && y.name === x.name; });
          if (still) return;
          if (x.name) x.el.style.removeProperty(x.name);
          else { setY(x.el, 0); x.el.style.opacity = ''; }
        });
        shown = -1;
        apply(p(performance.now()));
      },
    };
  }

  window.NXSpinFocus = { create: create, HOLD: HOLD, DURATION: DURATION };
})();
