/* Trio Towers — shared timed draws, one every 30 s for the whole table.
 * Betting window (18 s) → the engine drops ball 1, 2, 3 (one "ball" deal step each, 2 s apart) →
 * the sum and the winning spots light up → pause → next window. Rules: rules.js (same as the
 * engine); live rounds and settlement: _core/table-client.js. This file is the board, the slip, the
 * overlays and the choreography around the 3D towers (scene.js).
 */
import { createScene } from './scene.js';

var $ = function (id) { return document.getElementById(id); };
var WIDE = window.matchMedia('(min-width: 900px)');
var ALL = window.matchMedia('(min-width: 1280px)'); // every bet group on the board at once
var BETTING_MS = 18000, MAX_SPOTS = 20;
var R = window.TrioRules;

// ---------------------------------------------------------------- spots
function spotName(s) {
  var N = { big: 'Big', small: 'Small', odd: 'Odd', even: 'Even', bigodd: 'Big·Odd', bigeven: 'Big·Even', smallodd: 'Small·Odd', smalleven: 'Small·Even', anytriple: 'Any triple' };
  if (N[s]) return N[s];
  var p = s.split(':');
  if (p[0] === 'sum') return 'Sum ' + p[1];
  if (p[0] === 'ball') return 'Ball ' + p[1] + ' = ' + p[2];
  if (p[0] === 'triple') return 'Triple ' + p[1] + p[1] + p[1];
  return s;
}
function sectionOf(s) { return s.indexOf('ball:') === 0 ? 'balls' : s === 'anytriple' || s.indexOf('triple:') === 0 ? 'tri' : 'sum'; }
function fx(x) { return '×' + (x >= 100 ? x.toFixed(0) : String(x)); }
var SPOT_EL = {}, SPOT_CHIP = {}, SPOT_WON = {};

function spotBtn(spot, cls, html) {
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'spot ' + cls; b.dataset.spot = spot;
  b.setAttribute('aria-label', spotName(spot) + ' pays ' + fx(R.payOf(spot)));
  b.innerHTML = html + '<span class="schip" hidden></span><span class="won" hidden></span>';
  SPOT_EL[spot] = b; SPOT_CHIP[spot] = b.querySelector('.schip'); SPOT_WON[spot] = b.querySelector('.won');
  return b;
}
function div(cls, html) { var d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; return d; }
function buildBoard() {
  var g = $('grid');
  // SUM
  var s = div('sec sec--sum sec--on'); s.dataset.sec = 'sum';
  s.appendChild(div('lbl', '<span>Sum of the 3 balls · 0–27</span><b>Big 14–27 · Small 0–13</b>'));
  var srow = div('srow'), main = div('row mainrow'), combos = div('row combos');
  main.append(
    spotBtn('small', 'spot--em spot--small', '<span class="l">SMALL</span><span class="r">0 – 13</span><span class="x">' + fx(R.FIXED.small) + '</span>'),
    spotBtn('odd', 'spot--em', '<span class="l">ODD</span><span class="x">' + fx(R.FIXED.odd) + '</span>'),
    spotBtn('even', 'spot--em', '<span class="l">EVEN</span><span class="x">' + fx(R.FIXED.even) + '</span>'),
    spotBtn('big', 'spot--em spot--big', '<span class="l">BIG</span><span class="r">14 – 27</span><span class="x">' + fx(R.FIXED.big) + '</span>'));
  [['smallodd', 'SMALL', 'ODD'], ['smalleven', 'SMALL', 'EVEN'], ['bigodd', 'BIG', 'ODD'], ['bigeven', 'BIG', 'EVEN']].forEach(function (c) {
    combos.appendChild(spotBtn(c[0], 'spot--combo', '<span class="l">' + c[1] + '<b>·</b>' + c[2] + '</span><span class="x">' + fx(R.FIXED[c[0]]) + '</span>'));
  });
  srow.append(main, combos); s.appendChild(srow);
  var sums = div('row sumgrid');
  for (var t = 0; t <= 27; t++) sums.appendChild(spotBtn('sum:' + t, 'spot--sum' + (t >= R.BIG_FROM ? ' spot--hi' : ''), '<span class="l">' + t + '</span><span class="x">' + fx(R.SUM_PAY[t]) + '</span>'));
  s.appendChild(sums);
  // BALLS
  var b = div('sec sec--balls'); b.dataset.sec = 'balls';
  b.appendChild(div('lbl', '<span>Pick one ball’s digit</span><b>Each ' + fx(R.BALL_PAY) + '</b>'));
  var blocks = div('bblocks');
  for (var k = 1; k <= 3; k++) {
    var blk = div('bblock');
    blk.appendChild(div('bblock__h', '<span>BALL <b>' + k + '</b></span><em>' + fx(R.BALL_PAY) + '</em>'));
    for (var d = 0; d <= 9; d++) blk.appendChild(spotBtn('ball:' + k + ':' + d, 'spot--ball', '<i class="ballico">' + d + '</i>'));
    blocks.appendChild(blk);
  }
  b.appendChild(blocks);
  // TRIPLES
  var tr = div('sec sec--tri'); tr.dataset.sec = 'tri';
  tr.appendChild(div('lbl', '<span>Triples · all three the same</span><b>Any ' + fx(R.FIXED.anytriple) + ' · Exact ' + fx(R.TRIPLE_PAY) + '</b>'));
  var tg = div('row tgrid');
  tg.appendChild(spotBtn('anytriple', 'spot--any', '<span class="l">ANY<span class="l2"> TRIPLE</span></span><span class="x">' + fx(R.FIXED.anytriple) + '</span>'));
  for (d = 0; d <= 9; d++) tg.appendChild(spotBtn('triple:' + d, 'spot--tri', '<span class="tb3"><i>' + d + '</i><i>' + d + '</i><i>' + d + '</i></span><span class="x">' + fx(R.TRIPLE_PAY) + '</span>'));
  tr.appendChild(tg);
  g.append(s, b, tr);
  g.addEventListener('click', function (e) { var el = e.target.closest('.spot'); if (el) addChip(el.dataset.spot, el); });
}
function buildPaytable() {
  var rows = [['Big (14–27) / Small (0–13)', R.FIXED.big, 500], ['Odd / Even', R.FIXED.odd, 500], ['Big·Odd / Small·Even', R.FIXED.bigodd, 231],
    ['Big·Even / Small·Odd', R.FIXED.bigeven, 269], ['Ball 1, 2 or 3 shows your digit', R.BALL_PAY, 100], ['Any triple', R.FIXED.anytriple, 10], ['Exact triple (e.g. 7 7 7)', R.TRIPLE_PAY, 1]];
  for (var t = 0; t <= 13; t++) rows.push(['Sum ' + t + ' or ' + (27 - t), R.SUM_PAY[t], R.WAYS[t]]);
  var h = '<table><thead><tr><th>Bet</th><th>Pays</th><th>Chance</th><th>RTP</th></tr></thead><tbody>';
  rows.forEach(function (r) { h += '<tr><td>' + r[0] + '</td><td>' + fx(r[1]) + '</td><td>' + (r[2] / 10).toFixed(1) + '%</td><td>' + (r[1] * r[2] / 10).toFixed(2) + '%</td></tr>'; });
  $('paytable').innerHTML = h + '</tbody></table>';
}

// ---------------------------------------------------------------- state
var sound = TrioAudio.create();
// QA only (?qa): a frame-cost probe on window, and ?qa&pr=0.5 renders at a lower resolution
var QA = /[?&]qa\b/.test(location.search), QA_PR = QA ? +new URLSearchParams(location.search).get('pr') || 0 : 0;
var scene = createScene($('scene'), { maxPR: QA_PR });
if (QA) window.__trioScene = scene;
var game = null, S = null;
var QUICK = [1, 2, 5, 10], LADDER_X = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
var minBet = 0.1, chipVal = 0.1;
var pending = {}, stack = [], placed = null, placing = false, lastBets = null;
var round = 0, closedRound = 0, autoRound = 0, revealRound = 0, shownRound = 0, lastTick = -1, lastRoll = 0;
var drawn = [null, null, null], pendingResult = null, held = null, lastSeed = null;
var started = false, readySent = false, listTab = 'all', boardTab = 'sum', bootAt = Date.now();
var players = window.NXPlayers ? NXPlayers.create($('stage')) : null;

function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function short(n) { n = r2(n); if (n >= 1000) return r2(n / 1000) + 'K'; return Number.isInteger(n) ? String(n) : String(n).replace(/^0\./, '.'); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function sum(o) { var t = 0; for (var k in o) t += o[k]; return r2(t); }
var toastT = 0;
function toast(text) { var el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 2400); }
var PH = {
  betting: ['Three towers, one lucky sum', 'Bets are open — pick your numbers', 'Big or small this time?', 'Call the sum', 'Pick a ball, pick a digit', 'Feeling a triple?', 'The towers are ready'],
  last: ['Last bets…', 'Closing in seconds', 'Final call'],
  closed: ['No more bets', 'The towers are mixing', 'Air on — good luck', 'Here come the balls'],
  ball: [['Ball one drops…', 'First ball on its way', 'Tower one opens…'], ['Ball two is rolling…', 'Second ball coming down', 'Tower two opens…'], ['Ball three decides…', 'Last ball — here it comes', 'Tower three opens…']],
  wait: ['Next draw soon', 'Towers refilling', 'Get your chips ready', 'A new draw is coming'],
  noBet: ['Wait for the next draw', 'Bets are closed — next draw soon', 'Hold that chip for the next draw'],
};
var statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  var t = text || (key === 'betting' && window.NXPhrases && Math.random() < 0.35 ? NXPhrases.pick('betting') : pick(PH[key] || ['']));
  $('status').textContent = t;
}

// ---------------------------------------------------------------- chips
function buildChips() {
  QUICK.forEach(function (x, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'cb c' + i; b.setAttribute('role', 'radio');
    b.addEventListener('click', function () { chipVal = r2(minBet * x); sound.play('chip'); paintChips(); updateControls(); });
    $('chips').appendChild(b);
  });
  paintChips();
}
function ladder() {
  var max = game ? game.limit().max : 0;
  return LADDER_X.map(function (x) { return r2(minBet * x); }).filter(function (v) { return !(max > 0) || v <= max + 1e-9; });
}
function stepChip(dir) {
  var L = ladder(), i = 0;
  for (var k = 0; k < L.length; k++) if (L[k] <= chipVal + 1e-9) i = k;
  i = Math.max(0, Math.min(L.length - 1, i + dir));
  chipVal = L[i]; sound.play('chip'); paintChips(); updateControls();
}
function paintChips() {
  var max = game ? game.limit().max : 0;
  Array.prototype.forEach.call($('chips').children, function (b, i) {
    var v = r2(minBet * QUICK[i]);
    b.textContent = short(v);
    b.setAttribute('aria-label', 'Chip ' + money(v));
    b.setAttribute('aria-checked', Math.abs(v - chipVal) < 1e-9 ? 'true' : 'false');
    b.hidden = max > 0 && v > max + 1e-9;
  });
  $('chipVal').textContent = money(chipVal);
  var L = ladder();
  $('less').disabled = chipVal <= L[0] + 1e-9;
  $('more').disabled = chipVal >= L[L.length - 1] - 1e-9;
}
function chipClass(n) { var c = 0; QUICK.forEach(function (x, i) { if (n + 1e-9 >= minBet * x) c = i; }); return 'c' + c; }

// ---------------------------------------------------------------- betting
function bettingOpen() { return S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function locked() { return !!(placed && placed.round === round) || placing; }
function free() { var b = S && S.balance != null ? S.balance : Infinity; return r2(b - sum(pending)); }

function addChip(spot, el) {
  if (!bettingOpen()) { toast(pick(PH.noBet)); sound.play('error'); return; }
  if (locked()) { toast('Your bets are placed for this draw.'); return; }
  var amt = chipVal, lim = game.limit(), cur = pending[spot] || 0;
  if (!cur && Object.keys(pending).length >= MAX_SPOTS) { toast('Up to ' + MAX_SPOTS + ' different bets per draw.'); sound.play('error'); return; }
  if (lim.max > 0 && cur + amt > lim.max + 1e-9) {
    if (cur >= lim.max - 1e-9) { toast('Max ' + money(lim.max) + ' on one bet.'); return; }
    amt = r2(lim.max - cur);
  }
  if (amt > free() + 1e-9) { toast('Not enough balance.'); sound.play('error'); return; }
  pending[spot] = r2(cur + amt);
  stack.push([{ spot: spot, amt: amt }]);
  var chipBtn = $('chips').querySelector('[aria-checked="true"]') || $('chipVal');
  fly(center(chipBtn), center(el), short(amt), 240).then(function () { sound.play('chip'); });
  paintSpot(spot); updateControls();
}
function removeSpot(spot) {
  if (locked() || !pending[spot]) return;
  delete pending[spot];
  stack = stack.map(function (g) { return g.filter(function (e) { return e.spot !== spot; }); }).filter(function (g) { return g.length; });
  paintSpot(spot); sound.play('chip'); updateControls();
}
function undo() {
  if (locked() || !stack.length) return;
  stack.pop().forEach(function (e) {
    pending[e.spot] = r2((pending[e.spot] || 0) - e.amt);
    if (pending[e.spot] <= 0.001) delete pending[e.spot];
    paintSpot(e.spot);
  });
  sound.play('chip'); updateControls();
}
function clearBets() {
  if (locked()) return;
  var spots = Object.keys(pending);
  pending = {}; stack = [];
  spots.forEach(paintSpot);
  if (spots.length) sound.play('chips', 3);
  updateControls();
}
function doubleBets() {
  if (locked() || !bettingOpen()) return;
  var lim = game.limit(), add = [], extra = 0;
  Object.keys(pending).forEach(function (s) {
    var cur = pending[s], to = lim.max > 0 ? Math.min(lim.max, cur * 2) : cur * 2, d = r2(to - cur);
    if (d > 0) { add.push({ spot: s, amt: d }); extra += d; }
  });
  if (!add.length) return;
  if (extra > free() + 1e-9) { toast('Not enough balance to double.'); sound.play('error'); return; }
  add.forEach(function (e) { pending[e.spot] = r2(pending[e.spot] + e.amt); paintSpot(e.spot); });
  stack.push(add); sound.play('chips', 4); updateControls();
}
function rebet() {
  if (locked() || !bettingOpen() || !lastBets || Object.keys(pending).length) return;
  var add = [], need = 0;
  Object.keys(lastBets).forEach(function (s) { add.push({ spot: s, amt: lastBets[s] }); need += lastBets[s]; });
  if (r2(need) > free() + 1e-9) { toast('Not enough balance to rebet.'); sound.play('error'); return; }
  add.forEach(function (e) { pending[e.spot] = e.amt; paintSpot(e.spot); });
  stack.push(add); sound.play('chips', 5); updateControls();
}
function submit(auto) {
  if (locked() || !Object.keys(pending).length) return;
  if (!bettingOpen() && !auto) return;
  var r = round, snap = Object.assign({}, pending);
  var bets = Object.keys(snap).map(function (s) { return { spot: s, amount: snap[s] }; });
  placing = true; updateControls();
  game.bet(bets).then(function () {
    placing = false;
    placed = { round: r, bets: snap, total: sum(snap) };
    lastBets = snap; pending = {}; stack = [];
    Object.keys(snap).forEach(paintSpot);
    sound.play('chips', 3);
    if (!auto) setStatus('placed', 'Bets accepted — good luck!');
    updateControls(); render();
  }).catch(function () { placing = false; updateControls(); });
}

function myBets() { return placed && placed.round === round ? placed.bets : pending; }
function paintSpot(s) {
  var c = SPOT_CHIP[s], el = SPOT_EL[s];
  var p = placed && placed.round === round ? placed.bets[s] : 0, amt = p || pending[s] || 0;
  if (amt > 0) { c.hidden = false; c.textContent = short(amt); c.className = 'schip' + (p ? '' : ' schip--pending'); }
  else c.hidden = true;
  el.classList.toggle('spot--bet', amt > 0);
}
function paintAllSpots() { Object.keys(SPOT_EL).forEach(paintSpot); }

function maxWin(bets) { // the best possible return of a set of bets over all 1,000 draws
  var spots = Object.keys(bets), best = 0;
  if (!spots.length) return 0;
  for (var a = 0; a < 10; a++) for (var b = 0; b < 10; b++) for (var c = 0; c < 10; c++) {
    var o = { balls: [a, b, c], total: a + b + c }, w = 0;
    for (var i = 0; i < spots.length; i++) w += bets[spots[i]] * R.pay(o, spots[i]);
    if (w > best) best = w;
  }
  return Math.floor(best * 100 + 1e-6) / 100;
}
var slipKey = '';
function renderSlip() {
  var bets = myBets(), spots = Object.keys(bets), isPlaced = !!(placed && placed.round === round);
  var res = shownRound === round && S && S.result && revealRound === round ? S.result : null;
  var key = spots.map(function (s) { return s + bets[s]; }).join() + '|' + isPlaced + '|' + !!res;
  if (key === slipKey) return;
  slipKey = key;
  if (!spots.length) { $('slip').innerHTML = '<span class="slip__empty">Pick a chip, tap the spots — up to ' + MAX_SPOTS + ' bets a draw</span>'; return; }
  var h = spots.map(function (s) {
    var won = res && R.pay(res, s) > 0;
    return '<span class="slip__b' + (isPlaced ? ' slip__b--placed' : '') + (won ? ' slip__b--won' : '') + '">' + spotName(s) + ' <b>' + money(bets[s]) + '</b>' +
      (isPlaced ? '' : '<button type="button" data-rm="' + s + '" aria-label="Remove ' + spotName(s) + '">×</button>') + '</span>';
  }).join('');
  h += '<span class="slip__tot">' + spots.length + ' bet' + (spots.length > 1 ? 's' : '') + ' · <b>' + money(sum(bets)) + '</b> · up to <b>' + money(maxWin(bets)) + '</b></span>';
  $('slip').innerHTML = h;
}

function updateControls() {
  if (!S) return;
  var open = bettingOpen(), lock = locked(), n = Object.keys(pending).length, total = sum(pending);
  $('undo').disabled = !open || lock || !stack.length;
  $('clear').disabled = !open || lock || !n;
  $('double').disabled = !open || lock || !n;
  $('rebet').disabled = !open || lock || !lastBets || n > 0;
  var a = $('action'), label = $('actionLabel'), sub = $('actionSub'), cls = '';
  var myWin = placed && placed.round === round && shownRound === round && placed.win > 0 ? placed.win : 0;
  if (placing) { a.disabled = true; label.textContent = 'Placing…'; sub.textContent = money(total); cls = 'action--done'; }
  else if (myWin) { a.disabled = true; label.textContent = 'You won ' + money(myWin); sub.textContent = 'Next draw soon'; cls = 'action--won'; }
  else if (placed && placed.round === round) { a.disabled = true; cls = 'action--done'; label.textContent = S.phase === 'betting' ? 'Bets placed' : 'Good luck'; sub.textContent = money(placed.total) + ' in play'; }
  else if (open && n) { a.disabled = false; label.textContent = 'Place bets'; sub.textContent = money(total) + ' on ' + n + ' spot' + (n > 1 ? 's' : ''); }
  else if (open) { a.disabled = true; cls = 'action--idle'; label.textContent = 'Pick your spots'; sub.textContent = 'Chip ' + money(chipVal); }
  else { a.disabled = true; cls = 'action--off'; label.textContent = S.phase === 'betting' || S.phase === 'dealing' ? 'Bets closed' : 'Next draw soon'; sub.textContent = ''; }
  a.className = 'action' + (cls ? ' ' + cls : '');
  $('board').classList.toggle('board--closed', !open || lock);
  paintTabs(); renderSlip();
}
function paintTabs() {
  var bets = myBets(), res = shownRound === round && S && S.result && revealRound === round ? S.result : null, cnt = { sum: 0, balls: 0, tri: 0 }, win = { sum: 0, balls: 0, tri: 0 };
  Object.keys(bets).forEach(function (s) { cnt[sectionOf(s)]++; if (res && R.pay(res, s) > 0) win[sectionOf(s)]++; });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    var k = t.dataset.tab, n = t.querySelector('.tab__n');
    n.hidden = !cnt[k]; n.textContent = win[k] ? 'WIN' : cnt[k]; n.classList.toggle('win', !!win[k]);
  });
}
function setBoardTab(k) {
  boardTab = k;
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { var on = t.dataset.tab === k; t.classList.toggle('tab--on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
  Array.prototype.forEach.call(document.querySelectorAll('.sec'), function (s) { s.classList.toggle('sec--on', s.dataset.sec === k); });
}

// ---------------------------------------------------------------- chip flights
function center(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function fly(from, to, label, dur) {
  var el = document.createElement('div');
  el.className = 'fchip'; el.textContent = label || '';
  $('fx').appendChild(el);
  var lift = Math.min(70, Math.hypot(to.x - from.x, to.y - from.y) * 0.25), mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - lift };
  var anim = el.animate([
    { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(1)' },
    { transform: 'translate(' + mid.x + 'px,' + mid.y + 'px) scale(1.12)', offset: 0.5 },
    { transform: 'translate(' + to.x + 'px,' + to.y + 'px) scale(.9)' },
  ], { duration: dur || 260, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
  return new Promise(function (res) { anim.onfinish = anim.oncancel = function () { el.remove(); res(); }; });
}

// ---------------------------------------------------------------- the round
function onSignal(type, d) {
  if (type === 'betting') onBetting();
  else if (type === 'deal') onDeal(d.step);
  else if (type === 'result') { pendingResult = { round: S.round, outcome: d.outcome, win: d.win }; if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, balls: d.outcome && d.outcome.balls }; }
  else if (type === 'error') { toast(d.text); sound.play('error'); }
}
function onBetting(quiet) {
  round = S.round; lastTick = -1;
  if (placed && placed.round !== round) placed = null;
  pending = {}; stack = []; drawn = [null, null, null]; pendingResult = null; held = null;
  clearResult(); paintAllSpots();
  scene.reset(); scene.mixing(false);
  setStatus('betting'); if (!quiet) sound.play('open');
  updateControls(); render();
}
function closeRound() {
  closedRound = round;
  setStatus('closed'); sound.play('close');
  scene.mixing(true);
  var back = Object.keys(pending);
  if (!placing && back.length) { pending = {}; stack = []; back.forEach(paintSpot); }
  updateControls();
}
function onDeal(step) {
  if (!step || step.kind !== 'ball') return;
  var i = +step.to - 1, v = step.value;
  if (!(i >= 0 && i < 3) || typeof v !== 'number') return;
  if (closedRound !== step.round) closeRound();
  if (!held) held = { round: step.round, balance: S.balance };
  revealRound = step.round;
  scene.mixing(true);
  drawn[i] = v;
  scene.drop(i, v);
  setStatus('ball', pick(PH.ball[i]));
  showSum();
}
var sumShown = false;
function showSum() {
  var el = $('sum');
  if (!sumShown) { sumShown = true; el.hidden = false; void el.offsetWidth; el.classList.add('sum--in'); }
  for (var i = 0; i < 3; i++) {
    var d = $('sd' + (i + 1)), seated = drawn[i] != null && scene.seated(i);
    var txt = seated ? String(drawn[i]) : '?';
    if (d.textContent !== txt) { d.textContent = txt; d.classList.toggle('q', !seated); if (seated) { d.classList.add('pop'); setTimeout(function (x) { x.classList.remove('pop'); }.bind(null, d), 300); } }
  }
}
function hideSum() {
  sumShown = false; $('sum').classList.remove('sum--in'); $('sum').hidden = true;
  for (var i = 1; i <= 3; i++) { $('sd' + i).textContent = '?'; $('sd' + i).classList.add('q'); }
  $('sumTotal').textContent = '?'; $('sumTotal').classList.add('q'); $('sumTags').innerHTML = '';
}
function tagsOf(o) {
  var d = o.balls, t = [];
  if (d[0] === d[1] && d[1] === d[2]) t.push(['TRIPLE', 'g']);
  t.push(o.total >= R.BIG_FROM ? ['BIG', 'g'] : ['SMALL', ''], o.total % 2 ? ['ODD', ''] : ['EVEN', '']);
  return t;
}
function showResult(r, o, paid) {
  pendingResult = null;
  if (r !== round) return;
  shownRound = r;
  scene.mixing(false); scene.glow(true);
  for (var i = 0; i < 3; i++) { if (drawn[i] == null) { drawn[i] = o.balls[i]; scene.place(i, o.balls[i]); } }
  showSum();
  $('sumTotal').textContent = o.total; $('sumTotal').classList.remove('q');
  $('sumTags').innerHTML = tagsOf(o).map(function (t) { return '<span class="' + t[1] + '">' + t[0] + '</span>'; }).join('');
  sound.play('sum');
  setStatus('result', o.balls.join(' + ') + ' = ' + o.total + ' · ' + tagsOf(o).map(function (t) { return t[0][0] + t[0].slice(1).toLowerCase(); }).join(' · '));
  var mine = placed && placed.round === r ? placed.bets : null, win = 0, stake = 0, nWon = 0, best = null;
  $('board').classList.add('board--result');
  Object.keys(SPOT_EL).forEach(function (s) {
    var x = R.pay(o, s);
    SPOT_EL[s].classList.toggle('spot--win', x > 0);
    if (mine && mine[s] && x > 0) {
      var w = Math.floor(mine[s] * x * 100 + 1e-9) / 100;
      SPOT_WON[s].textContent = '+' + money(w); SPOT_WON[s].hidden = false;
      win += w; nWon++; if (!best || x > best.x) best = { s: s, x: x };
    }
    if (mine && mine[s]) stake += mine[s];
  });
  if (mine) {
    win = r2(win);
    var capped = paid != null && paid < win; // the game's max win (engine_config maxWin) caps one bet's total
    if (capped) win = r2(paid);
    placed.win = win;
    if (win > 0) {
      var big = win >= stake * 10;
      $('bannerWin').textContent = money(win);
      $('bannerSub').textContent = capped ? 'Max win per draw reached' : nWon + ' of your ' + Object.keys(mine).length + ' bets won' + (best ? ' · ' + spotName(best.s) + ' pays ' + fx(best.x) : '');
      var b = $('banner'); b.hidden = false; void b.offsetWidth; b.classList.add('banner--in');
      setTimeout(function () { sound.play('win', big); }, 250);
    } else setTimeout(function () { sound.play('lose'); }, 300);
  }
  held = null;
  if (win > 0) { $('balance').classList.add('bump'); setTimeout(function () { $('balance').classList.remove('bump'); }, 400); }
  updateControls(); render();
}
function clearResult() {
  hideSum();
  var b = $('banner'); b.classList.remove('banner--in'); b.hidden = true;
  $('board').classList.remove('board--result');
  Object.keys(SPOT_EL).forEach(function (s) { SPOT_EL[s].classList.remove('spot--win'); SPOT_WON[s].hidden = true; });
}

// ---------------------------------------------------------------- per frame
function tick() {
  if (S && started) {
    var now = Date.now(), timer = $('timer');
    if (S.phase === 'betting') {
      var left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000);
      if (left > 0) {
        timer.hidden = false;
        $('timerRing').style.strokeDashoffset = String(100 - Math.min(1, left / BETTING_MS) * 100);
        timer.dataset.level = secs <= 3 ? 'last' : '';
        if (secs !== lastTick) {
          $('timerNum').textContent = secs;
          if (secs <= 3 && lastTick !== -1) sound.play('tick', secs <= 1);
          if (secs <= 3 && statusKey === 'betting') setStatus('last');
          lastTick = secs; updateControls();
        }
        if (left < 1100 && autoRound !== round && Object.keys(pending).length && !locked()) { autoRound = round; submit(true); }
      } else {
        timer.hidden = true;
        if (closedRound !== round && round) closeRound();
      }
    } else timer.hidden = true;
    if (sumShown) showSum();
    if (pendingResult && pendingResult.round === round) {
      var o = pendingResult.outcome, all = true;
      for (var i = 0; i < 3; i++) if (!(drawn[i] != null && scene.seated(i))) all = false;
      if (all || Date.now() - (pendingResult.at || (pendingResult.at = Date.now())) > 2500) showResult(pendingResult.round, o, pendingResult.win);
    }
    if (S.phase === 'pause' && statusKey === 'result') setStatus('wait');
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- render (every client change)
var histKey = '', listKey = '';
function visibleHistory() { return S.history.filter(function (h) { return !(h.round === revealRound && shownRound < revealRound); }); }
function render() {
  if (!S || !started) return;
  var bal = held && held.round === revealRound ? held.balance : S.balance;
  $('balance').textContent = bal == null ? '—' : money(bal);
  $('mode').textContent = S.demo ? 'Demo' : 'Balance';
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  $('fRound').textContent = S.round || '—';
  $('fHash').textContent = S.hash || '—';
  $('fSeed').textContent = lastSeed && lastSeed.round === shownRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the draw' : '—');
  var hist = visibleHistory(), hk = hist.length + ':' + (hist[0] && hist[0].round);
  if (hk !== histKey) { var grew = histKey && hist.length; histKey = hk; renderHistory(hist, grew); renderStats(hist); }
  renderList();
  if (players) players.update({ phase: S.phase, bets: S.bets.filter(function (b) { return !b.mine; }) });
  updateControls();
}
function ballsHtml(b, cls) { return b.map(function (v) { return '<i' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</i>'; }).join(''); }
function renderHistory(hist, animate) {
  $('history').innerHTML = hist.slice(0, 24).map(function (h, i) {
    var o = h.outcome, tri = o.balls[0] === o.balls[1] && o.balls[1] === o.balls[2], k = tri ? 'T' : o.total >= R.BIG_FROM ? 'B' : 'S';
    return '<div class="hist' + (i === 0 && animate ? ' hist--new' : '') + '" title="Draw ' + h.round + '">' + ballsHtml(o.balls) + '<b>' + o.total + '</b><u class="' + k + '">' + (tri ? '3' : k) + '</u></div>';
  }).join('') || '<div class="hist hist--empty">Draws appear here</div>';
}
function renderStats(hist) {
  var n = hist.length, c = { big: 0, small: 0, odd: 0, even: 0, tri: 0 }, f = [[], [], []];
  for (var k = 0; k < 3; k++) for (var d = 0; d < 10; d++) f[k][d] = 0;
  hist.forEach(function (h) {
    var o = h.outcome;
    c[o.total >= R.BIG_FROM ? 'big' : 'small']++; c[o.total % 2 ? 'odd' : 'even']++;
    if (o.balls[0] === o.balls[1] && o.balls[1] === o.balls[2]) c.tri++;
    o.balls.forEach(function (v, i) { f[i][v]++; });
  });
  function pct(v) { return n ? Math.round(v / n * 100) : 0; }
  $('statN').textContent = n;
  $('statBars').innerHTML =
    '<div class="sbar"><span>Small ' + pct(c.small) + '%</span><i><em style="width:' + pct(c.small) + '%"></em></i><span>' + pct(c.big) + '% Big</span></div>' +
    '<div class="sbar"><span>Odd ' + pct(c.odd) + '%</span><i><em style="width:' + pct(c.odd) + '%"></em></i><span>' + pct(c.even) + '% Even</span></div>' +
    (c.tri ? '<div class="sbar"><span>Triples</span><span></span><span>' + c.tri + '</span></div>' : '');
  $('hot').innerHTML = f.map(function (row, i) {
    var top = row.map(function (v, d) { return [v, d]; }).sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; }).slice(0, 3);
    return '<div class="hot"><span>BALL ' + (i + 1) + '</span>' + top.map(function (t) { return '<b title="' + t[0] + '×">' + t[1] + '</b><small>' + t[0] + '</small>'; }).join('') + '</div>';
  }).join('');
}
function betSummary(bets) {
  if (!bets || !bets.length) return '—';
  var names = bets.map(function (b) { return spotName(b.spot); });
  return names.length > 2 ? names.slice(0, 2).join(' · ') + ' +' + (names.length - 2) : names.join(' · ');
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function renderList() {
  var rows, cols, count;
  if (listTab === 'all') {
    var bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map(function (b) {
      var showWin = b.win != null && shownRound >= S.round;
      return '<div class="brow' + (b.mine ? ' brow--mine' : '') + (showWin && b.win > 0 ? ' brow--won' : '') + '"><span>' + esc(b.mine ? 'You' : b.player || 'Player') + '</span><span class="brow__b">' + esc(betSummary(b.bets)) + '</span><span class="brow__s">' + money(Number(b.total) || 0) + '</span><span class="brow__w">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    $('countLabel').textContent = 'Bets this draw';
  } else {
    var mine = S.myBets.filter(function (m) { return !(m.round === revealRound && shownRound < revealRound); });
    cols = '<span>Draw</span><span>Balls</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map(function (m) {
      return '<div class="brow' + (m.win > 0 ? ' brow--won' : '') + '"><span>#' + m.round + '</span><span class="brow__balls">' + (m.outcome ? ballsHtml(m.outcome.balls) : '') + '</span><span class="brow__s">' + money(m.stake) + '</span><span class="brow__w">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>';
    });
    $('countLabel').textContent = 'My draws';
  }
  var key = listTab + '|' + rows.join('');
  if (key === listKey) return;
  listKey = key;
  $('cols').innerHTML = cols; $('betCount').textContent = count;
  $('list').innerHTML = rows.join('') || '<div class="empty">' + (listTab === 'all' ? 'No bets yet this draw' : 'Your draws will show here') + '</div>';
}

// ---------------------------------------------------------------- layout: play area, scene, overlays
var layoutRaf = 0;
function layout() {
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(function () {
    var game_ = $('game'), stage = $('stage'), wide = WIDE.matches;
    if (wide) game_.style.setProperty('--boardH', Math.round($('board').getBoundingClientRect().height) + 'px');
    var sr = stage.getBoundingClientRect(), top = $('top').getBoundingClientRect(), hb = $('historyBox').getBoundingClientRect(), A;
    if (wide) {
      var side = $('side').getBoundingClientRect(), L = side.right - sr.left + 12, T = top.bottom - sr.top + 4;
      A = { L: L, T: T, W: sr.width - L - 12, H: Math.max(160, hb.top - sr.top - T - 6) };
    } else {
      var T2 = top.bottom - sr.top + 2;
      A = { L: 0, T: T2, W: sr.width, H: Math.max(150, hb.top - sr.top - T2 - 4) };
    }
    var play = $('play');
    play.style.left = A.L + 'px'; play.style.top = A.T + 'px'; play.style.width = A.W + 'px'; play.style.height = A.H + 'px';
    stage.style.setProperty('--below', Math.max(0, sr.height - A.T - A.H + 4) + 'px');
    stage.style.setProperty('--left', A.L + 'px');
    scene.resize(sr.width, sr.height, A);
    var an = scene.anchor();
    $('sum').style.top = Math.round(an.plate.y - A.T - 22) + 'px';
    $('banner').style.top = Math.round(an.plate.y - A.T + (wide ? 36 : 32)) + 'px';
    if (!readySent) { readySent = true; requestAnimationFrame(function () { game.ready(); game.theme(scene.topColor); }); }
  });
}

// ---------------------------------------------------------------- wiring
function wire() {
  $('back').addEventListener('click', function () { game.back(); });
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', clearBets);
  $('double').addEventListener('click', doubleBets);
  $('rebet').addEventListener('click', rebet);
  $('action').addEventListener('click', function () { submit(false); });
  $('less').addEventListener('click', function () { stepChip(-1); });
  $('more').addEventListener('click', function () { stepChip(1); });
  $('slip').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) removeSpot(b.dataset.rm); });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { if (boardTab !== t.dataset.tab) { setBoardTab(t.dataset.tab); sound.play('tab'); } });
  });
  function paintToggles() {
    $('music').setAttribute('aria-pressed', sound.music() ? 'true' : 'false');
    $('sound').setAttribute('aria-pressed', sound.sound() ? 'true' : 'false');
  }
  $('music').addEventListener('click', function () { sound.music(!sound.music()); paintToggles(); });
  $('sound').addEventListener('click', function () { sound.sound(!sound.sound()); paintToggles(); });
  paintToggles();
  Array.prototype.forEach.call(document.querySelectorAll('.seg__b'), function (b) {
    b.addEventListener('click', function () {
      listTab = b.dataset.list;
      Array.prototype.forEach.call(document.querySelectorAll('.seg__b'), function (x) { x.classList.toggle('seg__b--on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      render();
    });
  });
  $('rulesBtn').addEventListener('click', function () { $('rules').hidden = false; });
  $('rulesClose').addEventListener('click', function () { $('rules').hidden = true; });
  $('rules').addEventListener('click', function (e) { if (e.target === $('rules')) $('rules').hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('rules').hidden = true; });
  $('fair').addEventListener('click', function () { $('fairDetail').hidden = !$('fairDetail').hidden; });
  $('fCheckBtn').addEventListener('click', verifyLast);
  scene.hooks.release = function () { sound.play('release'); };
  scene.hooks.roll = function () { var now = Date.now(); if (now - lastRoll > 300) { lastRoll = now; sound.play('roll'); } };
  scene.hooks.land = function (i, d) { sound.play('land', d); };
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) { var ro = new ResizeObserver(layout); ro.observe($('stage')); ro.observe($('board')); }
  WIDE.addEventListener('change', layout);
  ALL.addEventListener('change', function () { setBoardTab(ALL.matches ? 'sum' : boardTab); layout(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && game) game.theme(scene.topColor); });
}
function hexBytes(hex) { var o = new Uint8Array(hex.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(hex.substr(i * 2, 2), 16); return o; }
function verifyLast() {
  var out = $('fCheck'); out.hidden = false;
  if (!lastSeed || !lastSeed.seed) { out.textContent = 'Wait for a draw to finish while you are at the table — its seed is revealed then.'; return; }
  out.textContent = 'Checking…';
  var L = lastSeed;
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), NXTable.verify({ game: 'triotowers', gameId: game.event, seed: L.seed, round: L.round })]).then(function (res) {
    var h = Array.prototype.map.call(new Uint8Array(res[0]), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    var b = res[1].outcome.balls, okHash = h === L.hash, okBalls = !L.balls || b.join() === L.balls.join();
    out.innerHTML = 'Draw ' + L.round + ': balls <b>' + b.join(' · ') + '</b> (sum ' + res[1].outcome.total + '). ' + (okHash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (okBalls ? '✓ same balls as drawn' : '✗ balls differ');
  }).catch(function () { out.textContent = 'Could not recompute in this browser.'; });
}

// first snapshot: put the towers in the state the round is in
// After a reconnect the client restores the table quietly (snapshot, no signals): catch up with a
// round, balls or a result this page did not see happen.
function catchUp() {
  if (S.round > round && S.phase !== 'waiting') {
    onBetting(true);
    if (S.phase !== 'betting') { closedRound = round; scene.mixing(true); setStatus('closed'); }
  }
  if (S.round !== round) return;
  S.deals.forEach(function (st) {
    var i = +st.to - 1;
    if (st.kind !== 'ball' || st.round !== round || !(i >= 0 && i < 3) || drawn[i] != null) return;
    if (closedRound !== round) closeRound();
    drawn[i] = st.value; revealRound = round; scene.place(i, st.value); showSum();
  });
  if (S.result && (S.phase === 'result' || S.phase === 'pause') && shownRound < round && !pendingResult) { revealRound = round; showResult(round, S.result); }
}
// (also when the first snapshot arrives late — a slow connection — after the 5 s fallback start)
var synced = false;
function syncFromSnapshot() {
  started = true;
  if (S.gotSnapshot) synced = true;
  round = S.round;
  shownRound = S.round;
  if (S.phase === 'betting') {
    setStatus('betting');
    if (Date.now() >= S.endsAt) closeRound();
  } else if (S.phase === 'dealing') {
    closedRound = round; scene.mixing(true); setStatus('closed');
    revealRound = round; shownRound = round - 1;
    S.deals.forEach(function (st) { if (st.kind === 'ball') { var i = +st.to - 1; drawn[i] = st.value; scene.place(i, st.value); } });
    showSum();
  } else if (S.result) {
    var o = S.result;
    for (var i = 0; i < 3; i++) { drawn[i] = o.balls[i]; scene.place(i, o.balls[i]); }
    revealRound = round; shownRound = round - 1;
    showResult(round, o);
    setStatus('wait');
  } else setStatus('wait');
  render();
}

var EVENT = new URLSearchParams(location.search).get('event') || '88.0090'; // the game's engine ID (catalogue)
$('fGame').textContent = EVENT;
buildBoard(); buildPaytable(); buildChips(); wire();
game = NXTable.start({
  event: EVENT, game: 'triotowers',
  onChange: function () {
    S = game ? game.S : S;
    if (!S) return;
    if (!synced && S.gotSnapshot) syncFromSnapshot();
    else if (synced) catchUp();
    render();
  },
  onSignal: function (t, d) { if (started) onSignal(t, d || {}); },
});
S = game.S;
if (QA) window.__trioGame = game; // QA: the live client state (real-round checks)
game.limitsLoaded.then(function (l) {
  if (l && l.min > 0) { minBet = l.min; chipVal = l.min; }
  $('rMin').textContent = money(minBet);
  $('rMax').textContent = money(l && l.max ? l.max : 100);
  paintChips(); updateControls();
});
setTimeout(function () { if (!started) syncFromSnapshot(); }, 5000);
layout();
setStatus('wait');
requestAnimationFrame(tick);
setTimeout(function () { if (!readySent) { readySent = true; game.ready(); game.theme(scene.topColor); } }, 6000);
