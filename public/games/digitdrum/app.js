/* Digit Drum (88.0088) — a 0–9 draw every 30 s, shared by every player (engine draw game
 * "digitdrum": nexorng-engine/internal/tables/digitdrum.go; client rules: rules.js).
 *   15 s betting → 10 s draw (the drum rolls; the digit arrives 5.8 s after betting closed and the
 *   drum slows down onto it) → 5 s result. A winning number pays 9× the stake on it.
 * Chips are collected on the board and sent in ONE bet (Place bets, or automatically 1.5 s before
 * betting closes). Settlement and rules live in ../_core/table-client.js; this file is the board,
 * the round choreography and the layout; scene.js is the 3D drum.
 */
import { create as createScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0088';
const BETTING_MS = 15000;
const AUTO_SEND_MS = 1500;
const CHIP_X = [1, 2, 5, 10, 25];
const PH = {
  betting: ['Pick your lucky digits', 'Bets are open — tap your numbers', 'Which number is yours tonight?', 'Spread your chips, spread your luck', 'One digit pays 9× — choose wisely', 'The drum is waiting for your bets', 'Feeling lucky? Pick a number'],
  last: ['Last chips…', 'Closing soon', 'Final call — place your bets'],
  closed: ['No more bets — here it rolls!', 'The drum is rolling…', 'Round and round it goes…', 'Bets are closed — fingers crossed', 'Rolling for the winning digit…'],
  wait: ['Next round soon', 'Get your chips ready', 'A new draw is coming up', 'Warming up the drum'],
  noBet: ['Wait for the next round', 'Bets are closed — next round soon', 'Hold your chip for the next draw'],
  win: ['Right on the money!', 'That’s a winner!', 'Lucky digit!', 'Nicely picked!'],
  lose: ['So close — next draw in a moment', 'Not this time — the drum turns again soon', 'Next round could be yours'],
};

// ---------------------------------------------------------------- state
const sound = window.DDAudio.create();
let scene = null, game = null, S = null;
let chipVals = CHIP_X.map((x) => r2(0.1 * x)), chipIdx = 0;
let pending = {}, stack = [], placed = null, placing = false, lastBets = null;
let round = 0, closedRound = 0, autoRound = 0, warnRound = 0, revealRound = 0, landedRound = 0, lastTick = -1;
let landing = null;                // { round, digit } being landed
let started = false, readySent = false, tab = 'all';
let bannerRound = 0, wonRound = 0, lastSeed = null, drumShown = false, syncedEarly = false, syncInfo = null;
const CELL = [];

function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function short(n) { if (n >= 1000) return r2(n / 1000) + 'K'; return Number.isInteger(r2(n)) ? String(r2(n)) : String(r2(n)).replace(/^0\./, '.'); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function sum(o) { let t = 0; for (const k in o) t += o[k]; return r2(t); }
function chipClass(n) { let c = 0; for (let i = 0; i < chipVals.length; i++) if (n + 1e-9 >= chipVals[i]) c = i; return 'c' + c; }
function digitOf(spot) { return Number(spot.slice(2)); }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
let statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  const el = $('status'); el.textContent = text || pick(PH[key] || ['']); el.dataset.kind = key;
}
function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

// ---------------------------------------------------------------- build once
function buildBoard() {
  const box = $('cells');
  for (let d = 0; d <= 9; d++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cell'; b.dataset.spot = 'n:' + d;
    b.setAttribute('aria-label', 'Number ' + d + ', pays 9 times');
    b.innerHTML = '<span class="cell__d">' + d + '</span><span class="cell__x">9×</span><span class="cell__stack"></span><span class="cell__amt" hidden></span><span class="cell__gain" hidden></span>';
    box.appendChild(b);
    CELL[d] = { el: b, stack: b.querySelector('.cell__stack'), amt: b.querySelector('.cell__amt'), gain: b.querySelector('.cell__gain'), key: '' };
  }
  box.addEventListener('click', (e) => { const b = e.target.closest('.cell'); if (b) addChip(b.dataset.spot, b); });
}
function buildChips() {
  const box = $('chips');
  CHIP_X.forEach((x, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip c' + i; b.setAttribute('role', 'radio'); b.dataset.i = i;
    b.innerHTML = '<span></span>';
    b.addEventListener('click', () => { chipIdx = i; sound.play('chip'); paintChips(); updateControls(); });
    box.appendChild(b);
  });
  paintChips();
}
function paintChips() {
  const max = game ? game.limit().max : 0;
  Array.prototype.forEach.call($('chips').children, (b, i) => {
    b.querySelector('span').textContent = short(chipVals[i]);
    b.setAttribute('aria-label', money(chipVals[i]));
    b.setAttribute('aria-checked', i === chipIdx ? 'true' : 'false');
    b.classList.toggle('chip--on', i === chipIdx);
    b.hidden = max > 0 && chipVals[i] > max + 1e-9;
  });
}

// ---------------------------------------------------------------- betting
function bettingOpen() { return !!S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function locked() { return !!(placed && placed.round === round) || placing; }
function balanceNow() { return S && S.balance != null ? S.balance : null; }
function free() { const b = balanceNow(); return b == null ? Infinity : r2(b - sum(pending)); }

function addChip(spot, el) {
  sound.play('chip', 0);
  if (!bettingOpen()) { toast(pick(PH.noBet)); sound.play('error'); return; }
  if (locked()) { toast('Your bets are placed for this round.'); return; }
  const lim = game.limit();
  let amt = chipVals[chipIdx];
  const total = sum(pending);
  if (lim.max > 0 && total + amt > lim.max + 1e-9) {
    if (total >= lim.max - 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
    amt = r2(lim.max - total);
  }
  if (amt > free() + 1e-9) { toast('Not enough balance.'); sound.play('error'); return; }
  pending[spot] = r2((pending[spot] || 0) + amt);
  stack.push([{ spot, amt }]);
  fly(center($('chips').children[chipIdx]), center(el), chipClass(amt), short(amt), 0, 260).then(() => { paintCell(digitOf(spot)); });
  updateControls(); render();
}
function undo() {
  if (locked() || !stack.length) return;
  stack.pop().forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) - e.amt); if (pending[e.spot] <= 0.001) delete pending[e.spot]; paintCell(digitOf(e.spot)); });
  sound.play('chip'); updateControls(); render();
}
function clearBets() {
  if (locked()) return;
  const spots = Object.keys(pending);
  pending = {}; stack = [];
  spots.forEach((s) => paintCell(digitOf(s)));
  if (spots.length) sound.play('clear');
  updateControls(); render();
}
function doubleBets() {
  if (locked() || !bettingOpen()) return;
  const lim = game.limit(), total = sum(pending);
  if (!total) return;
  if (lim.max > 0 && total * 2 > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (total > free() + 1e-9) { toast('Not enough balance to double.'); sound.play('error'); return; }
  const add = Object.keys(pending).map((s) => ({ spot: s, amt: pending[s] }));
  add.forEach((e) => { pending[e.spot] = r2(pending[e.spot] + e.amt); paintCell(digitOf(e.spot)); });
  stack.push(add); sound.play('chips'); updateControls(); render();
}
function rebet() {
  if (locked() || !bettingOpen() || !lastBets) return;
  const add = Object.keys(lastBets).map((s) => ({ spot: s, amt: lastBets[s] })), need = r2(add.reduce((t, e) => t + e.amt, 0));
  const lim = game.limit();
  if (lim.max > 0 && sum(pending) + need > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (need > free() + 1e-9) { toast('Not enough balance to repeat.'); sound.play('error'); return; }
  add.forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) + e.amt); paintCell(digitOf(e.spot)); });
  stack.push(add); sound.play('chips'); updateControls(); render();
}
function submit(auto) {
  if (locked() || !Object.keys(pending).length) return;
  if (!bettingOpen() && !auto) return;
  const lim = game.limit(), total = sum(pending);
  if (lim.min > 0 && total < lim.min - 1e-9) { toast('Minimum ' + money(lim.min) + ' per round.'); sound.play('error'); return; }
  const r = round, snap = Object.assign({}, pending);
  const bets = Object.keys(snap).sort().map((s) => ({ spot: s, amount: snap[s] }));
  placing = true; updateControls();
  game.bet(bets).then((res) => {
    placing = false;
    placed = { round: r, bets: snap, total: sum(snap), maxWin: res && res.maxWin != null ? Number(res.maxWin) : null };
    safeSS('digitdrum:placed', placed);
    lastBets = snap; pending = {}; stack = [];
    for (let d = 0; d <= 9; d++) paintCell(d);
    sound.play('placed');
    setStatus('placed', auto ? 'Your chips are in — good luck!' : 'Bets accepted — good luck!');
    updateControls(); render();
  }).catch(() => { placing = false; updateControls(); render(); });
}

function betsOf(d) {
  const spot = 'n:' + d, p = placed && placed.round === round ? placed.bets[spot] : 0;
  return { amt: p || pending[spot] || 0, placed: !!p };
}
function paintCell(d) {
  const c = CELL[d], b = betsOf(d);
  const key = b.amt + ':' + b.placed;
  if (key === c.key) return;
  c.key = key;
  c.el.classList.toggle('cell--bet', b.amt > 0);
  c.el.classList.toggle('cell--pending', b.amt > 0 && !b.placed);
  if (b.amt > 0) {
    // the stack: the amount broken into chips (largest first), at most 4 shown
    let left = b.amt, chips = [];
    for (let i = chipVals.length - 1; i >= 0 && chips.length < 4; i--) while (left + 1e-9 >= chipVals[i] && chips.length < 4) { chips.push(i); left = r2(left - chipVals[i]); }
    if (!chips.length) chips.push(0);
    c.stack.innerHTML = chips.reverse().map((i) => '<i class="schip c' + i + '"></i>').join('') + '';
    c.stack.lastChild.textContent = short(b.amt);
    c.amt.hidden = false; c.amt.textContent = money(b.amt);
  } else { c.stack.innerHTML = ''; c.amt.hidden = true; }
}
function paintAll() { for (let d = 0; d <= 9; d++) { CELL[d].key = ''; paintCell(d); } }

function updateControls() {
  if (!S) return;
  const open = bettingOpen(), lock = locked(), n = Object.keys(pending).length, total = sum(pending);
  $('undo').disabled = !open || lock || !stack.length;
  $('clear').disabled = !open || lock || !n;
  $('double').disabled = !open || lock || !n;
  $('rebet').disabled = !open || lock || !lastBets;
  const place = $('action');
  place.classList.remove('place--done', 'place--won');
  let label, sub = '';
  if (placing) { place.disabled = true; label = 'Placing…'; sub = money(total); }
  else if (placed && placed.round === round) {
    place.disabled = true;
    if (wonRound === round && landedRound === round) { place.classList.add('place--won'); label = 'You won ' + money(placed.win || 0); sub = 'next round soon'; }
    else { place.classList.add('place--done'); label = 'Bets placed · ' + money(placed.total); sub = S.phase === 'betting' ? 'good luck!' : 'good luck — drawing now'; }
  } else if (open && n) { place.disabled = false; label = 'Place bets'; sub = 'auto-sent before the draw'; }
  else if (open) { place.disabled = true; label = 'Tap a number'; sub = 'chip ' + money(chipVals[chipIdx]) + ' · pays 9×'; }
  else { place.disabled = true; label = S.phase === 'betting' || S.phase === 'dealing' ? 'No more bets' : 'Next round soon'; }
  setText($('placeLabel'), label); setText($('placeSub'), sub);
  const shownTotal = placed && placed.round === round ? placed.total : total;
  setText($('total'), money(shownTotal));
  $('board').classList.toggle('board--closed', !open || lock);
}

// ---------------------------------------------------------------- chip flights
function center(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function fly(from, to, cls, label, delay, dur, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'fchip ' + cls; el.textContent = label || '';
  $('fx').appendChild(el);
  const lift = Math.min(70, Math.hypot(to.x - from.x, to.y - from.y) * 0.25), mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - lift };
  const anim = el.animate([
    { transform: `translate(${from.x}px,${from.y}px) scale(1)`, opacity: opts.fadeIn ? 0 : 1 },
    { transform: `translate(${mid.x}px,${mid.y}px) scale(1.1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${to.x}px,${to.y}px) scale(${opts.s1 || 1})`, opacity: opts.fadeOut ? 0 : 1 },
  ], { duration: dur || 400, delay: delay || 0, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
  return new Promise((res) => { anim.onfinish = () => { el.remove(); res(); }; anim.oncancel = () => { el.remove(); res(); }; });
}

// ---------------------------------------------------------------- round flow
function onSignal(type, d) {
  if (type === 'betting') onBetting();
  else if (type === 'deal') onDeal(d.step);
  else if (type === 'result') onResult(d);
  else if (type === 'error') { toast(d.text); sound.play('error'); }
}

function onBetting() {
  round = S.round; lastTick = -1; landing = null;
  if (placed && placed.round !== round) placed = null;
  pending = {}; stack = [];
  clearHighlights();
  scene && scene.win(false);
  setStatus('betting');
  $('drawpill').hidden = true;
  sound.play('open');
  paintAll(); updateControls(); render();
}

function closeRound() {
  closedRound = round;
  setStatus('closed');
  sound.play('closed');
  // chips that were never placed go back to the rack
  const back = Object.keys(pending);
  if (!placing && back.length) {
    const rack = center($('chips'));
    back.forEach((s, i) => { fly(center(CELL[digitOf(s)].el), rack, chipClass(pending[s]), short(pending[s]), i * 40, 380, { fadeOut: true }); });
    pending = {}; stack = []; paintAll();
  }
  $('drawpill').hidden = false;
  if (scene) scene.spin();
  updateControls(); render();
}

function onDeal(step) {
  if (!step || step.kind !== 'pocket' || step.value == null) return;
  const r = step.round, digit = step.value;
  if (closedRound !== r) closeRound();
  revealRound = r;
  startLanding(r, digit, false);
}
function startLanding(r, digit, fromSnapshot) {
  if (landing && landing.round === r) return;
  drumShown = true;
  landing = { round: r, digit };
  if (!scene) return;
  if (!scene.spinning()) scene.spin();
  scene.onLanded(() => landed(r, digit));
  scene.land(digit, fromSnapshot ? { seconds: 2.2 } : { seconds: 3.2 });
}

function myWin(digit) {
  if (!placed || placed.round !== round) return null;
  let w = 0;
  for (const s in placed.bets) if (digitOf(s) === digit) w += r2(placed.bets[s] * 9);
  w = r2(w);
  if (placed.maxWin > 0 && w > placed.maxWin) w = placed.maxWin;
  return w;
}
function landed(r, digit) {
  if (r !== round) return;
  landedRound = r;
  $('drawpill').hidden = true;
  scene.win(true, digit);
  sound.play('land');
  CELL[digit].el.classList.add('cell--win');
  for (let d = 0; d <= 9; d++) if (d !== digit) CELL[d].el.classList.add('cell--lose');
  const w = myWin(digit);
  if (w != null) {
    placed.win = w;
    if (w > 0) {
      wonRound = r;
      CELL[digit].gain.hidden = false; CELL[digit].gain.textContent = '+' + money(w);
      showBanner(r, w, digit);
      setStatus('win', 'Number ' + digit + ' wins — ' + pick(PH.win));
      sound.play('win', w >= placed.total * 4);
    } else { setStatus('lose', 'Number ' + digit + ' wins. ' + pick(PH.lose)); sound.play('lose'); }
  } else setStatus('result', 'Number ' + digit + ' wins!');
  updateControls(); render();
}
function onResult(d) {
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, digit: d.outcome && d.outcome.pocket };
  const restored = placed && placed.round === S.round && placed.restored;
  if (restored) setTimeout(refreshBalance, 800); // reloaded mid-round: the client has no record of this bet
  if (placed && placed.round === S.round) {
    safeSS('digitdrum:placed', null);
    const my = S.myBets[0];
    if (my && my.round === S.round) placed.win = my.win; // the client's settlement (capped like the engine)
  }
  if (landedRound !== S.round && d.outcome && d.outcome.pocket != null) {
    round = S.round; drumShown = true;
    if (landing && landing.round === S.round) { /* still slowing down: landed() follows */ }
    else if (scene && scene.spinning()) { revealRound = S.round; startLanding(S.round, d.outcome.pocket, true); } // the digit step was missed: slow down onto the result
    else { // the draw was missed (tab hidden / joined late): show it now
      if (scene) scene.show(d.outcome.pocket);
      landing = { round: S.round, digit: d.outcome.pocket };
      landed(S.round, d.outcome.pocket);
    }
  }
  render();
}
function refreshBalance() {
  const tok = (() => { try { return localStorage.getItem('token'); } catch (e) { return null; } })();
  if (!tok || tok === 'demo' || !game) return;
  fetch(game.apiUrl('/playerBalance'), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } })
    .then((r) => r.json()).then((p) => { const b = p && p.data && p.data.balance; if (b != null) { S.balance = Number(b); render(); } }).catch(() => {});
}

let bannerT = 0;
function showBanner(r, win, digit) {
  if (bannerRound === r) return;
  bannerRound = r;
  const b = $('banner');
  setText($('bannerTitle'), 'Number ' + digit + ' · you win');
  setText($('bannerWin'), money(win));
  const stake = placed && placed.bets['n:' + digit];
  setText($('bannerSub'), stake ? money(stake) + ' on ' + digit + ' × 9' + (placed.maxWin > 0 && win >= placed.maxWin ? ' (max win)' : '') : '');
  b.hidden = false; b.classList.remove('banner--in'); void b.offsetWidth; b.classList.add('banner--in');
  $('play').classList.add('play--banner');
  clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; $('play').classList.remove('play--banner'); }, 4600);
  const bal = $('balance'); bal.classList.add('bump'); setTimeout(() => bal.classList.remove('bump'), 500);
}
function clearHighlights() {
  $('banner').hidden = true; $('play').classList.remove('play--banner');
  for (let d = 0; d <= 9; d++) { CELL[d].el.classList.remove('cell--win', 'cell--lose'); CELL[d].gain.hidden = true; }
}

// ---------------------------------------------------------------- per frame: timer, auto-send, close
function tick() {
  if (S && started) {
    const now = Date.now(), timer = $('timer');
    if (S.phase === 'betting') {
      const left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000);
      if (left > 0) {
        timer.hidden = false;
        $('timerRing').style.strokeDashoffset = String(100 - Math.min(1, left / BETTING_MS) * 100);
        timer.dataset.level = secs <= 3 ? 'red' : secs <= 6 ? 'amber' : 'green';
        if (secs !== lastTick) {
          setText($('timerNum'), String(secs));
          if (secs <= 5 && lastTick !== -1) sound.play('tick', secs <= 2);
          if (secs <= 4 && statusKey === 'betting') setStatus('last');
          lastTick = secs; updateControls();
        }
        if (left <= AUTO_SEND_MS && autoRound !== round && Object.keys(pending).length && !locked()) { autoRound = round; submit(true); }
      } else {
        timer.hidden = true;
        if (closedRound !== round && round) closeRound();
      }
    } else timer.hidden = true;
    if (S.phase === 'pause' && (statusKey === 'result' || statusKey === 'win' || statusKey === 'lose') && now - lastPauseAt > 2600) setStatus('wait');
  }
  requestAnimationFrame(tick);
}
let lastPauseAt = 0, phaseSeen = '';

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '', strip = null;
function visibleHistory() { return S.history.filter((h) => !(h.round === revealRound && landedRound < revealRound)); }
function render() {
  if (!S || !started) return;
  if (!drumShown && scene && !scene.spinning() && S.history[0]) { drumShown = true; scene.show(S.history[0].outcome.pocket); } // the last result in the window
  if (S.phase !== phaseSeen) { phaseSeen = S.phase; if (S.phase === 'pause') lastPauseAt = Date.now(); }
  let bal = S.balance;
  if (bal != null && Object.keys(pending).length && !placing) bal = r2(bal - sum(pending)); // chips on the board, not sent yet
  setText($('balance'), bal == null ? '—' : money(bal));
  setText($('mode'), S.demo ? 'Demo' : 'Balance');
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  setText($('fRound'), S.round ? String(S.round) : '—');
  setText($('fHash'), S.hash || '—');
  setText($('fSeed'), lastSeed && lastSeed.round === landedRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the round' : '—'));
  const hist = visibleHistory(), hk = hist.length + ':' + (hist[0] && hist[0].round);
  if (hk !== histKey) { histKey = hk; renderHistory(hist); renderStats(hist); }
  renderList();
  updateControls();
  if (!strip && window.NXPlayers && !WIDE.matches) strip = window.NXPlayers.create($('stage'), { face: avatar });
  if (strip) strip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(name) { return NXPlayers.face(name, 'av', 'span'); } // a player's face (../_core/players.js)
function renderHistory(hist) {
  $('history').innerHTML = hist.slice(0, 30).map((h, i) => '<span class="hd' + (i === 0 ? ' hd--new' : '') + '" title="Round ' + h.round + '">' + h.outcome.pocket + '</span>').join('') || '<span class="hd hd--empty">Results appear here</span>';
}
function renderStats(hist) {
  const n = hist.length, c = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  hist.forEach((h) => { if (h.outcome.pocket != null) c[h.outcome.pocket]++; });
  setText($('statN'), String(n));
  const max = Math.max(1, ...c), hi = Math.max(...c), lo = Math.min(...c);
  const hot = n ? c.map((v, d) => v === hi ? d : -1).filter((d) => d >= 0) : [], cold = n ? c.map((v, d) => v === lo ? d : -1).filter((d) => d >= 0) : [];
  $('freq').innerHTML = c.map((v, d) => '<div class="fq"><i class="' + (n && hot.length < 10 && v === hi ? 'hot' : n && cold.length < 10 && v === lo ? 'cold' : '') + '" style="height:' + Math.round((v / max) * 100) + '%"></i><b>' + d + '</b><small>' + v + '</small></div>').join('');
  setText($('hot'), n && hot.length < 10 ? hot.slice(0, 3).join(' · ') : '—');
  setText($('cold'), n && cold.length < 10 ? cold.slice(0, 3).join(' · ') : '—');
}
function nums(bets) { return (bets || []).map((b) => digitOf(b.spot)).sort((a, b) => a - b).join(' · ') || '—'; }
function renderList() {
  let rows, cols, count;
  if (tab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Numbers</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && landedRound >= S.round;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + (showWin && b.win > 0 ? ' row--won' : '') + '"><span class="row__user">' + esc(b.player || 'Player') + '</span><span class="row__nums">' + esc(nums(b.bets)) + '</span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Bets this round');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === revealRound && landedRound < revealRound));
    cols = '<span>Round</span><span>Numbers</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => '<div class="row' + (m.win > 0 ? ' row--won' : '') + '"><span>#' + m.round + ' <b class="row__res">' + (m.outcome ? m.outcome.pocket : '') + '</b></span><span class="row__nums">' + esc(nums(m.bets)) + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>');
    setText($('countLabel'), 'My rounds');
  }
  const key = tab + '|' + rows.join('');
  if (key === listKey) return;
  listKey = key;
  $('cols').innerHTML = cols;
  setText($('betCount'), String(count));
  $('list').innerHTML = rows.join('') || '<div class="empty">' + (tab === 'all' ? 'No bets yet this round' : 'Your rounds will show here') + '</div>';
}

// ---------------------------------------------------------------- layout: play area + scene size
let layoutRaf = 0;
function layout() {
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    const stage = $('stage'), sr = stage.getBoundingClientRect(), hist = $('historyBox'), wide = WIDE.matches;
    if (wide && hist.parentNode !== $('tablewrap')) $('tablewrap').insertBefore(hist, $('board'));
    if (!wide && hist.parentNode !== $('sticky')) $('sticky').appendChild(hist);
    const top = $('top').getBoundingClientRect();
    let A;
    if (wide) {
      const side = $('side').getBoundingClientRect(), tw = $('tablewrap').getBoundingClientRect();
      const L = side.right - sr.left + 10, T = top.bottom - sr.top + 2;
      A = { L, T, W: sr.width - L - 10, H: Math.max(160, tw.top - sr.top - T - 6) };
    } else {
      const hb = hist.getBoundingClientRect(), T = top.bottom - sr.top + 2;
      A = { L: 0, T, W: sr.width, H: Math.max(150, hb.top - sr.top - T - 2) };
    }
    const play = $('play');
    play.style.left = A.L + 'px'; play.style.top = A.T + 'px'; play.style.width = A.W + 'px'; play.style.height = A.H + 'px';
    stage.style.setProperty('--below', Math.max(0, sr.height - A.T - A.H) + 'px');
    stage.style.setProperty('--left', A.L + 'px');
    if (scene) scene.resize(sr.width, sr.height, A);
    if (scene && !readySent) { readySent = true; requestAnimationFrame(() => { game.ready(); game.theme(scene.topColor); }); }
  });
}

// ---------------------------------------------------------------- wiring
function wire() {
  $('back').addEventListener('click', () => game.back());
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', clearBets);
  $('double').addEventListener('click', doubleBets);
  $('rebet').addEventListener('click', rebet);
  $('action').addEventListener('click', () => submit(false));
  const paintToggles = () => { $('music').setAttribute('aria-pressed', sound.music() ? 'true' : 'false'); $('sound').setAttribute('aria-pressed', sound.sound() ? 'true' : 'false'); };
  $('music').addEventListener('click', () => { sound.music(!sound.music()); paintToggles(); });
  $('sound').addEventListener('click', () => { sound.sound(!sound.sound()); paintToggles(); });
  paintToggles();
  document.querySelectorAll('.bets__tab').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.bets__tab').forEach((x) => { x.classList.toggle('bets__tab--on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    render();
  }));
  $('rulesBtn').addEventListener('click', () => { $('rules').hidden = false; });
  $('rulesClose').addEventListener('click', () => { $('rules').hidden = true; });
  $('rules').addEventListener('click', (e) => { if (e.target === $('rules')) $('rules').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('rules').hidden = true;
    else if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && $('rules').hidden) addChip('n:' + e.key, CELL[+e.key].el);
  });
  $('fair').addEventListener('click', () => { $('fairDetail').hidden = !$('fairDetail').hidden; });
  $('fCheckBtn').addEventListener('click', verifyLast);
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) { const ro = new ResizeObserver(layout); ro.observe($('stage')); ro.observe($('tablewrap')); }
  WIDE.addEventListener('change', layout);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && game && scene) game.theme(scene.topColor); });
}

function hexBytes(hex) { const o = new Uint8Array(hex.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(hex.substr(i * 2, 2), 16); return o; }
function verifyLast() {
  const out = $('fCheck'); out.hidden = false;
  if (!lastSeed || !lastSeed.seed) { out.textContent = 'Wait for a round to finish while you are at the table — its seed is revealed then.'; return; }
  out.textContent = 'Checking…';
  const L = lastSeed;
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: 'digitdrum', gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const d = res[1].outcome.pocket;
    out.innerHTML = 'Round ' + L.round + ': digit <b>' + d + '</b>. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (L.digit == null || d === L.digit ? '✓ same digit as drawn' : '✗ digit differs');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

// first snapshot: put the drum in the state the round is in
function syncFromSnapshot() {
  started = true; syncInfo = { phase: S.phase, deals: (S.deals || []).length, left: S.endsAt - Date.now() };
  round = S.round;
  const last = S.history[0];
  const stored = safeSS('digitdrum:placed');
  if (stored && stored.round === S.round && (S.phase === 'betting' || S.phase === 'dealing')) { placed = stored; placed.restored = true; }
  if (S.phase === 'dealing') {
    closedRound = round;
    const step = (S.deals || []).filter((x) => x.kind === 'pocket' && x.value != null).pop();
    setStatus('closed'); $('drawpill').hidden = false;
    if (last && scene) scene.show(last.outcome.pocket);
    if (scene) scene.spin();
    if (step) { revealRound = round; startLanding(round, step.value, true); }
  } else if (S.phase === 'betting') {
    if (last && scene) scene.show(last.outcome.pocket);
    setStatus('betting');
    if (Date.now() >= S.endsAt) closeRound();
  } else {
    const d = S.result && S.result.pocket != null ? S.result.pocket : last && last.outcome.pocket;
    if (d != null && scene) scene.show(d);
    landedRound = S.round;
    setStatus('wait');
  }
  paintAll(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
buildBoard(); buildChips(); wire();
setStatus('wait');
game = window.NXTable.start({
  event: EVENT, game: 'digitdrum',
  onChange() {
    S = game ? game.S : S;
    if (!S) return;
    if (scene && S.gotSnapshot && S.phase !== 'waiting' && (!started || syncedEarly)) { syncedEarly = false; syncFromSnapshot(); }
    render();
  },
  onSignal(t, d) { if (!started) return; onSignal(t, d || {}); },
});
S = game.S;
setText($('fGame'), game.event || EVENT);
game.limitsLoaded.then((l) => {
  if (l && l.min > 0) chipVals = CHIP_X.map((x) => r2(l.min * x));
  setText($('rMin'), money(l.min || 0.1)); setText($('rMax'), money(l.max || 100));
  paintChips(); paintAll(); updateControls();
});
createScene($('scene'), {
  click: (speed) => sound.play('click', speed),
}).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  window.__dd = { scene: sc, game, state: () => ({ round, closedRound, revealRound, landedRound, started, placed, pending, syncInfo }) }; // QA hook
  layout();
  if (!started && S && S.gotSnapshot && S.phase !== 'waiting') syncFromSnapshot();
});
setTimeout(() => { if (!started && scene) { syncedEarly = true; syncFromSnapshot(); } }, 5000); // no live state yet: show the table, sync when it arrives
layout();
requestAnimationFrame(tick);
if (/[?&]fps=1/.test(location.search)) { // on-device check: ?fps=1 shows the frame rate
  const el = document.createElement('div'); el.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99;padding:3px 7px;border-radius:6px;background:#000a;font:700 11px monospace;color:#7f7;pointer-events:none';
  document.body.appendChild(el); let n = 0, t = performance.now(), worst = 0, last = t;
  (function f(now) { n++; worst = Math.max(worst, now - last); last = now; if (now - t >= 1000) { el.textContent = Math.round((n * 1000) / (now - t)) + ' fps · worst ' + Math.round(worst) + ' ms'; n = 0; t = now; worst = 0; } requestAnimationFrame(f); })(t);
}
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#12072a'); } }, 6000);
