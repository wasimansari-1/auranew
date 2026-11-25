/* NEXORNG game phrases: the line shown while bets are open and the line shown when a round
 * ends change every round (random, never the same twice in a row) — no fixed wording.
 *   NXPhrases.pick('betting') / NXPhrases.pick('crash') */
(function () {
  'use strict';
  var LISTS = {
    betting: [
      'Bets are open', 'Make your move', 'Chips on the table', 'Feeling lucky?', 'Your call',
      'Ready, set, bet', 'Take your seat', 'Place your chips', 'Fortune is waiting', 'Get in the game',
      'The table is open', 'Back your luck',
    ],
    crash: [
      'Round over', 'Busted!', 'Gone!', 'That’s the limit', 'Out of luck', 'House wins this one',
      'End of the ride', 'Game over', 'All in, all out', 'The streak ends', 'Down it goes', 'Cashed or crashed',
    ],
  };
  var last = {};
  function pick(kind) {
    var list = LISTS[kind] || [''];
    var i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && list[i] === last[kind]) i = (i + 1) % list.length;
    last[kind] = list[i];
    return list[i];
  }
  window.NXPhrases = { pick: pick };
})();
