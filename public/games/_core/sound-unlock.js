/* NEXORNG sound unlock — shared by every game, loaded before the game's own scripts.
 *
 * Browsers keep a page silent until the player touches it. Each game starts its sound from its own
 * handler, and not every kind of touch counts for every browser (an iPhone unlocks sound on the END
 * of a tap — touchend / click — not on its start), so in some games the first taps, a bet included,
 * did not bring the sound. Here, once for all games:
 *   – every AudioContext a game makes and every play() the browser refused is remembered
 *   – on any touch, click or key — the tap on the Bet button like any other — the waiting sound is
 *     started inside that gesture, which is the moment the browser allows it
 * Sound a game stopped itself (music off, tab in the background) is left alone.
 */
(function () {
  'use strict';
  var contexts = [];  // every AudioContext of the game
  var blocked = [];   // media elements whose play() the browser refused (NotAllowedError)

  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Real = window[name];
    if (!Real || typeof Proxy !== 'function') return;
    window[name] = new Proxy(Real, {
      construct: function (target, args) {
        var c = new target(...args);
        contexts.push(c);
        return c;
      },
    });
    var proto = Real.prototype, suspend = proto.suspend, resume = proto.resume;
    if (suspend && !suspend.nx) {
      proto.suspend = function () { this.__nxHeld = true; return suspend.apply(this, arguments); };  // the game's own pause
      proto.suspend.nx = true;
      proto.resume = function () { this.__nxHeld = false; return resume.apply(this, arguments); };
    }
  });

  var mediaProto = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (mediaProto) {
    var play = mediaProto.play, pause = mediaProto.pause;
    var forget = function (el) { var i = blocked.indexOf(el); if (i >= 0) blocked.splice(i, 1); };
    mediaProto.play = function () {
      var el = this, p = play.apply(el, arguments);
      forget(el);
      if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError' && blocked.indexOf(el) < 0) blocked.push(el); });
      return p;
    };
    mediaProto.pause = function () { forget(this); return pause.apply(this, arguments); }; // the game changed its mind
  }

  // Inside a gesture: start everything that is waiting for one.
  function unlock() {
    if (document.hidden) return;
    contexts.forEach(function (c) {
      if (c.state !== 'suspended' || c.__nxHeld) return;
      try { var p = c.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* closed */ }
    });
    blocked.splice(0).forEach(function (el) {
      try { var p = el.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* removed */ }
    });
  }
  // The end of a tap is what an iPhone counts; its start is what Android and desktop count.
  ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'click', 'keydown'].forEach(function (type) {
    window.addEventListener(type, unlock, true);
  });
})();
