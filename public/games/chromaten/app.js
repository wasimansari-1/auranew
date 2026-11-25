/* Chroma Ten (88.0098) — a colour-prediction draw every 30 s, shared by every player (engine draw
 * game "colorpredict": nexorng-engine/internal/tables/colorpredict.go; client rules: rules.js).
 *   20 s betting → the drum rolls (the digit arrives 1.8 s after betting closed and the drum slows
 *   down onto it, ~5 s) → result until the next round (30 s cycle).
 *   Green 2× (5: 1.6×) · Red 2× (0: 1.6×) · Violet 4.8× · Big / Small 1.92× · exact digit 9.6×.
 * Chips are collected on the board and sent in ONE bet (Place bets, or automatically 1.5 s before
 * betting closes). Settlement and rules live in ../_core/table-client.js; this file is the board,
 * the round choreography and the layout; scene.js is the 3D drum.
 */
import { create as createScene, KIND } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0098';
const GAME = 'colorpredict';
const BETTING_MS = 20000;
const AUTO_SEND_MS = 1500;
const QUICK_X = [1, 2, 5, 10];
const LADDER_X = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const MAXPAY = { green: 2, red: 2, violet: 4.8, big: 1.92, small: 1.92 };
const SPOT_NAME = { green: 'Green', red: 'Red', violet: 'Violet', big: 'Big', small: 'Small' };
const COLOR_NAME = { g: 'GREEN', r: 'RED', v: 'VIOLET' };
const PH = {
  betting: ['Pick a hue — the drum is waiting', 'Green, red or violet?', 'Bets are open — choose your colour', 'Big or small this time?', 'Feeling violet today?', 'Back a colour, a size or a digit', 'Colours are open — make your call'],
  last: ['Last chips…', 'Closing soon', 'Final call — place your bets'],
  closed: ['Rolling the colours…', 'No more bets — here it rolls!', 'Round and round the colours go…', 'Bets are closed — fingers crossed', 'Which colour lights up?'],
  wait: ['Next round soon', 'Get your chips ready', 'A new draw is coming up', 'The drum is warming up'],
  noBet: ['Wait for the next round', 'Bets are closed — next round soon', 'Hold your chip for the next draw'],
  win: ['That colour is yours!', 'Lit up!', 'Nicely called!', 'Colour match!'],
  lose: ['So close — next draw in a moment', 'Not this time — the drum turns again soon', 'Next colour could be yours'],
};

// ---------------------------------------------------------------- state
const sound = window.CTAudio.create();
let scene = null, game = null, S = null;
let minBet = 0.1, chipVal = 0.1;
let pending = {}, stack = [], placed = null, placing = false, lastBets = null;
let round = 0, closedRound = 0, autoRound = 0, revealRound = 0, landedRound = 0, lastTick = -1;
let landing = null;
let started = false, readySent = false, tab = 'all';
let bannerRound = 0, wonRound = 0, lastSeed = null, drumShown = false, syncedEarly = false, syncInfo = null, shownDigit = null;
const SPOTS = {}; // spot → { el, chip, gain, key }
const SPOT_LIST = ['green', 'violet', 'red', 'n:0', 'n:1', 'n:2', 'n:3', 'n:4', 'n:5', 'n:6', 'n:7', 'n:8', 'n:9', 'small', 'big'];

function r2(n) { return Math.round(n * 100) / 100; }
function fl2(n) { return Math.floor(n * 100 + 1e-6) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function short(n) { n = r2(n); if (n >= 1000) return r2(n / 1000) + 'K'; return Number.isInteger(n) ? String(n) : String(n).replace(/^0\./, '.'); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function sum(o) { let t = 0; for (const k in o) t += o[k]; return r2(t); }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function kindClass(d) { const k = KIND(d); return 'c-' + k.join(''); }
function digitOf(spot) { return spot.indexOf('n:') === 0 ? Number(spot.slice(2)) : -1; }
function spotLabel(spot) { const d = digitOf(spot); return d >= 0 ? 'Digit ' + d : SPOT_NAME[spot]; }
function maxPay(spot) { return digitOf(spot) >= 0 ? 9.6 : MAXPAY[spot]; }
function pay(spot, d) { return window.ChromaRules.pay({ pocket: d }, spot); }
let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
let statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  const el = $('status'); el.textContent = text || pick(PH[key] || ['']); el.dataset.kind = key;
}
function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function resultText(d) { const k = KIND(d); return k.map((x) => COLOR_NAME[x]).join(' + ') + ' · ' + (d >= 5 ? 'BIG' : 'SMALL'); }

// ---------------------------------------------------------------- build once
function buildBoard() {
  const box = $('digits');
  for (let d = 0; d <= 9; d++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'spot dg'; b.dataset.spot = 'n:' + d;
    b.setAttribute('aria-label', 'Digit ' + d + ', pays 9.6 times');
    b.innerHTML = '<span class="ball ' + kindClass(d) + '">' + d + '</span><em>9.6×</em>';
    box.appendChild(b);
  }
  document.querySelectorAll('.spot').forEach((el) => {
    const chip = document.createElement('span'); chip.className = 'pchip'; chip.hidden = true;
    const gain = document.createElement('span'); gain.className = 'gain'; gain.hidden = true;
    el.append(chip, gain);
    SPOTS[el.dataset.spot] = { el, chip, gain, key: '' };
  });
  $('board').addEventListener('click', (e) => { const b = e.target.closest('.spot'); if (b) addChip(b.dataset.spot, b); });
}
function buildQuick() {
  const box = $('quick');
  QUICK_X.forEach((x) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.x = x; b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { setChip(r2(minBet * x)); sound.play('chip'); });
    box.appendChild(b);
  });
  $('minus').addEventListener('click', () => stepChip(-1));
  $('plus').addEventListener('click', () => stepChip(1));
}
function ladder() {
  const max = game ? game.limit().max : 0;
  return LADDER_X.map((x) => r2(minBet * x)).filter((v) => !(max > 0) || v <= max + 1e-9);
}
function stepChip(dir) {
  const l = ladder();
  let i = l.findIndex((v) => v >= chipVal - 1e-9);
  if (i < 0) i = l.length - 1;
  if (dir < 0 && l[i] > chipVal + 1e-9) i--; // between two steps: − goes to the lower one
  i = Math.max(0, Math.min(l.length - 1, i + dir));
  setChip(l[i]); sound.play('chip');
}
function setChip(v) { chipVal = v; paintChips(); updateControls(); }
function paintChips() {
  setText($('chipVal'), money(chipVal));
  const max = game ? game.limit().max : 0;
  Array.prototype.forEach.call($('quick').children, (b) => {
    const v = r2(minBet * Number(b.dataset.x));
    setText(b, v < 10 ? v.toFixed(2) : short(v));
    b.setAttribute('aria-label', money(v));
    const on = Math.abs(v - chipVal) < 1e-9;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.hidden = max > 0 && v > max + 1e-9;
  });
  const l = ladder();
  $('minus').disabled = chipVal <= l[0] + 1e-9;
  $('plus').disabled = chipVal >= l[l.length - 1] - 1e-9;
}

// ---------------------------------------------------------------- betting
function bettingOpen() { return !!S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function locked() { return !!(placed && placed.round === round) || placing; }
function balanceNow() { return S && S.balance != null ? S.balance : null; }
function free() { const b = balanceNow(); return b == null ? Infinity : r2(b - sum(pending)); }

function addChip(spot, el) {
  if (!bettingOpen()) { toast(pick(PH.noBet)); sound.play('error'); return; }
  if (locked()) { toast('Your bets are placed for this round.'); return; }
  const lim = game.limit();
  let amt = chipVal;
  const total = sum(pending);
  if (lim.max > 0 && total + amt > lim.max + 1e-9) {
    if (total >= lim.max - 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
    amt = r2(lim.max - total);
  }
  if (amt > free() + 1e-9) { toast('Not enough balance.'); sound.play('error'); return; }
  sound.play('chip');
  pending[spot] = r2((pending[spot] || 0) + amt);
  stack.push([{ spot, amt }]);
  fly(center($('chipVal')), center(SPOTS[spot].chip.hidden ? el : SPOTS[spot].chip), short(amt), 0, 260).then(() => paintSpot(spot));
  updateControls(); render();
}
function undo() {
  if (locked() || !stack.length) return;
  stack.pop().forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) - e.amt); if (pending[e.spot] <= 0.001) delete pending[e.spot]; paintSpot(e.spot); });
  sound.play('chip'); updateControls(); render();
}
function clearBets() {
  if (locked()) return;
  const spots = Object.keys(pending);
  pending = {}; stack = [];
  spots.forEach(paintSpot);
  if (spots.length) sound.play('clear');
  updateControls(); render();
}
function rebet() {
  if (locked() || !bettingOpen() || !lastBets) return;
  const add = Object.keys(lastBets).map((s) => ({ spot: s, amt: lastBets[s] })), need = r2(add.reduce((t, e) => t + e.amt, 0));
  const lim = game.limit();
  if (lim.max > 0 && sum(pending) + need > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (need > free() + 1e-9) { toast('Not enough balance to repeat.'); sound.play('error'); return; }
  add.forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) + e.amt); paintSpot(e.spot); });
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
    safeSS('chromaten:placed', placed);
    if (placed.maxWin > 0) setText($('rMaxWin'), money(placed.maxWin));
    lastBets = snap; pending = {}; stack = [];
    paintAll();
    sound.play('placed');
    setStatus('placed', auto ? 'Your chips are in — good luck!' : 'Bets accepted — good luck!');
    updateControls(); render();
  }).catch(() => { placing = false; updateControls(); render(); });
}

function betOf(spot) {
  const p = placed && placed.round === round ? placed.bets[spot] : 0;
  return { amt: p || pending[spot] || 0, placed: !!p };
}
function paintSpot(spot) {
  const c = SPOTS[spot], b = betOf(spot);
  const key = b.amt + ':' + b.placed;
  if (key === c.key) return;
  c.key = key;
  c.el.classList.toggle('spot--bet', b.amt > 0);
  c.chip.classList.toggle('pchip--ok', b.placed);
  if (b.amt > 0) { c.chip.hidden = false; setText(c.chip, short(b.amt)); c.chip.setAttribute('aria-label', money(b.amt)); } else c.chip.hidden = true;
}
function paintAll() { SPOT_LIST.forEach((s) => { SPOTS[s].key = ''; paintSpot(s); }); renderSlip(); }

function updateControls() {
  if (!S) return;
  const open = bettingOpen(), lock = locked(), n = Object.keys(pending).length, total = sum(pending);
  $('undo').disabled = !open || lock || !stack.length;
  $('clear').disabled = !open || lock || !n;
  $('rebet').disabled = !open || lock || !lastBets;
  const place = $('action');
  place.classList.remove('place--done', 'place--won');
  let label, sub = '';
  if (placing) { place.disabled = true; label = 'Placing…'; sub = money(total); }
  else if (placed && placed.round === round) {
    place.disabled = true;
    if (wonRound === round && landedRound === round) { place.classList.add('place--won'); label = 'You won ' + money(placed.win || 0); sub = 'next round soon'; }
    else { place.classList.add('place--done'); label = 'Bets placed · ' + money(placed.total); sub = S.phase === 'betting' ? 'good luck!' : 'good luck — the drum is rolling'; }
  } else if (open && n) { place.disabled = false; label = 'Place bets · ' + money(total); sub = n + (n === 1 ? ' spot' : ' spots') + ' · auto-sent before the draw'; }
  else if (open) { place.disabled = true; label = 'Tap a colour to bet'; sub = 'chip ' + money(chipVal); }
  else { place.disabled = true; label = S.phase === 'betting' || S.phase === 'dealing' ? 'No more bets' : 'Next round soon'; }
  setText($('placeLabel'), label); setText($('placeSub'), sub);
  $('board').classList.toggle('board--closed', !open || lock);
  const res = landedRound === round && landing && landing.round === round;
  const title = open && !lock ? 'PLACE YOUR COLOURS' : lock && S.phase === 'betting' && Date.now() < S.endsAt ? 'BETS PLACED' : res && wonRound === round ? 'ROUND WON · ' + money(placed && placed.win || 0)
    : res ? 'RESULT · DIGIT ' + landing.digit : S.phase === 'dealing' || S.phase === 'betting' ? 'BETS CLOSED · DRAWING' : 'NEXT ROUND SOON';
  setText($('boardTitle'), title);
  renderSlip();
}

// the bet slip (desktop dock): each spot with what it returns if it wins (or what it won)
let slipKey = '';
function renderSlip() {
  const mine = placed && placed.round === round ? placed.bets : pending;
  const spots = SPOT_LIST.filter((s) => mine[s] > 0);
  const result = landedRound === round && landing && landing.round === round ? landing.digit : null;
  const key = spots.map((s) => s + mine[s]).join() + '|' + result + '|' + (placed && placed.round === round);
  if (key === slipKey) return;
  slipKey = key;
  const total = sum(mine);
  setText($('slipTotal'), spots.length ? money(total) : '—');
  $('slip').innerHTML = spots.map((s) => {
    const a = mine[s];
    let right;
    if (result != null) { const w = fl2(a * pay(s, result)); right = w > 0 ? '<b class="w">+' + money(w) + '</b>' : '<b class="l">—</b>'; }
    else right = '<b>wins ' + money(fl2(a * maxPay(s))) + '</b>';
    return '<div class="slip__row"><span><i class="dot dot--' + (digitOf(s) >= 0 ? 'd' : s) + '"></i>' + esc(spotLabel(s)) + ' · ' + money(a) + '</span>' + right + '</div>';
  }).join('') || '<div class="slip__empty">Tap a colour, a size or a digit. Every spot is paid on its own.</div>';
}

// ---------------------------------------------------------------- chip flights
function center(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function fly(from, to, label, delay, dur, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'fchip'; el.textContent = label || '';
  $('fx').appendChild(el);
  const lift = Math.min(70, Math.hypot(to.x - from.x, to.y - from.y) * 0.25), mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - lift };
  const anim = el.animate([
    { transform: `translate(${from.x}px,${from.y}px) scale(1)`, opacity: 1 },
    { transform: `translate(${mid.x}px,${mid.y}px) scale(1.1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${to.x}px,${to.y}px) scale(1)`, opacity: opts.fadeOut ? 0 : 1 },
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
  const back = Object.keys(pending); // chips that were never placed go back to the rack
  if (!placing && back.length) {
    const rack = center($('chipVal'));
    back.forEach((s, i) => { fly(center(SPOTS[s].el), rack, short(pending[s]), i * 40, 380, { fadeOut: true }); });
    pending = {}; stack = []; paintAll();
  }
  clearHighlights();
  $('drawpill').hidden = false;
  if (scene) { scene.win(false); scene.spin(); }
  updateControls(); render();
}

function onDeal(step) {
  if (!step || step.kind !== 'pocket' || step.value == null) return;
  const r = step.round, digit = step.value;
  if (r > round) round = r; // the betting signal was missed (reconnect)
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
  scene.land(digit, fromSnapshot ? { seconds: 2.0 } : { seconds: 3.0 });
}

function myWin(digit) {
  if (!placed || placed.round !== round) return null;
  let w = 0;
  for (const s in placed.bets) w += fl2(placed.bets[s] * pay(s, digit));
  w = r2(w);
  if (placed.maxWin > 0 && w > placed.maxWin) w = placed.maxWin;
  return w;
}
function landed(r, digit) {
  if (r !== round) return;
  landedRound = r; shownDigit = digit;
  $('drawpill').hidden = true;
  scene.win(true, digit);
  sound.play('land');
  SPOT_LIST.forEach((s) => {
    const c = SPOTS[s], p = pay(s, digit);
    c.el.classList.toggle('spot--win', p > 0); c.el.classList.toggle('spot--lose', !(p > 0));
    const a = betOf(s).placed ? placed.bets[s] : 0;
    if (p > 0 && a > 0) { c.gain.hidden = false; c.gain.textContent = '+' + money(fl2(a * p)); }
  });
  showResult(digit);
  const w = myWin(digit);
  if (w != null) {
    placed.win = w;
    if (w > 0) {
      wonRound = r;
      showBanner(r, w);
      setStatus('win', pick(PH.win));
      sound.play('win', w >= placed.total * 4);
    } else { setStatus('lose', 'Digit ' + digit + ' wins. ' + pick(PH.lose)); sound.play('lose'); }
  } else setStatus('result', 'Digit ' + digit + ' · ' + resultText(digit));
  updateControls(); render();
}
function showResult(d) {
  const k = KIND(d);
  const ball = $('rball'); ball.className = 'ball ' + kindClass(d); ball.textContent = String(d);
  setText($('rtext'), resultText(d));
  $('rpill').className = 'rpill rpill--' + k[0];
  const res = $('result'); res.hidden = false; res.classList.remove('result--in'); void res.offsetWidth; res.classList.add('result--in');
}
function onResult(d) {
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, digit: d.outcome && d.outcome.pocket };
  const restored = placed && placed.round === S.round && placed.restored;
  if (restored) setTimeout(refreshBalance, 800);
  if (placed && placed.round === S.round) {
    safeSS('chromaten:placed', null);
    const my = S.myBets[0];
    if (my && my.round === S.round) placed.win = my.win;
  }
  if (landedRound !== S.round && d.outcome && d.outcome.pocket != null) {
    round = S.round; drumShown = true;
    if (landing && landing.round === S.round) { /* still slowing down: landed() follows */ }
    else if (scene && scene.spinning()) { revealRound = S.round; startLanding(S.round, d.outcome.pocket, true); }
    else {
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
function showBanner(r, win) {
  if (bannerRound === r) return;
  bannerRound = r;
  const b = $('banner');
  setText($('bannerTitle'), 'You win');
  setText($('bannerWin'), '+' + money(win));
  setText($('bannerSub'), placed.maxWin > 0 && win >= placed.maxWin ? 'Max win reached' : '');
  b.hidden = false;
  $('play').classList.add('play--banner');
  clearTimeout(bannerT);
  const bal = $('balance'); bal.classList.add('bump'); setTimeout(() => bal.classList.remove('bump'), 500);
}
function clearHighlights() {
  clearTimeout(bannerT);
  $('result').hidden = true; $('banner').hidden = true; $('play').classList.remove('play--banner');
  SPOT_LIST.forEach((s) => { const c = SPOTS[s]; c.el.classList.remove('spot--win', 'spot--lose'); c.gain.hidden = true; });
}

// ---------------------------------------------------------------- per frame: timer, auto-send, close
let lastPauseAt = 0, phaseSeen = '';
let ticks = 0;
function tick() {
  ticks++;
  if (S && started) {
    const now = Date.now(), timer = $('timer');
    if (S.phase === 'betting') {
      const left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000);
      if (left > 0) {
        timer.hidden = false;
        $('timerRing').style.strokeDashoffset = String(100 - Math.min(1, left / BETTING_MS) * 100);
        if (secs !== lastTick) {
          timer.dataset.level = secs <= 3 ? 'red' : secs <= 6 ? 'amber' : 'green';
          setText($('timerNum'), String(secs));
          if (secs <= 5 && lastTick !== -1) sound.play('count', secs <= 2);
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

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '', strip = null;
function visibleHistory() { return S.history.filter((h) => !(h.round === revealRound && landedRound < revealRound)); }
function render() {
  if (!S || !started) return;
  if (S.phase === 'betting' && S.round > round) { onBetting(); return; } // a new round whose signal was missed (reconnect)
  if (S.phase === 'dealing' && S.round >= round && !(landing && landing.round === S.round) && landedRound !== S.round) { // deal steps came in a snapshot (reconnect)
    const step = (S.deals || []).filter((x) => x.kind === 'pocket' && x.value != null).pop();
    if (step) { round = S.round; if (closedRound !== round) closeRound(); revealRound = round; startLanding(round, step.value, true); }
  }
  if (!drumShown && scene && !scene.spinning() && S.history[0]) { drumShown = true; scene.show(S.history[0].outcome.pocket); }
  if (S.phase !== phaseSeen) { phaseSeen = S.phase; if (S.phase === 'pause') lastPauseAt = Date.now(); }
  let bal = S.balance;
  if (bal != null && Object.keys(pending).length && !placing) bal = r2(bal - sum(pending));
  setText($('balance'), bal == null ? '—' : money(bal));
  setText($('mode'), S.demo ? 'Demo' : 'Balance');
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  setText($('fRound'), S.round ? String(S.round) : '—');
  setText($('fHash'), S.hash || '—');
  setText($('fSeed'), lastSeed && lastSeed.round === landedRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the round' : '—'));
  const hist = visibleHistory(), hk = hist.length + ':' + (hist[0] && hist[0].round);
  if (hk !== histKey) { histKey = hk; renderHistory(hist); }
  renderList();
  updateControls();
  if (!strip && window.NXPlayers && !WIDE.matches) strip = window.NXPlayers.create($('stage'), { face: avatar });
  if (strip) strip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(name) { return NXPlayers.face(name, 'av', 'span'); } // a player's face (../_core/players.js)
function renderHistory(hist) {
  const h20 = hist.slice(0, 20);
  $('history').innerHTML = h20.map((h, i) => {
    const d = h.outcome.pocket;
    return '<span class="hcol' + (i === 0 ? ' hcol--new' : '') + '" title="Round ' + h.round + '"><span class="ball ' + kindClass(d) + '">' + d + '</span><i class="' + (d >= 5 ? 'B' : 'S') + '">' + (d >= 5 ? 'B' : 'S') + '</i></span>';
  }).join('') || '<span class="hd--empty">Results appear here</span>';
  const n = h20.length, cnt = (f) => h20.filter((h) => f(h.outcome.pocket)).length;
  const g = cnt((d) => d % 2 === 1), r = cnt((d) => d % 2 === 0), v = cnt((d) => d === 0 || d === 5), b = cnt((d) => d >= 5);
  $('hstats').innerHTML = n ? '<span class="st st--g">Green <b>' + g + '</b></span><span class="st st--r">Red <b>' + r + '</b></span><span class="st st--v">Violet <b>' + v + '</b></span><span class="st">Big / Small <b>' + b + ' / ' + (n - b) + '</b></span>' : '';
}
function tags(bets) {
  return (bets || []).map((b) => { const d = digitOf(b.spot); return '<i class="tag tag--' + (d >= 0 ? 'd' : b.spot) + '">' + (d >= 0 ? d : SPOT_NAME[b.spot] || b.spot) + '</i>'; }).join('') || '—';
}
function renderList() {
  let rows, cols, count;
  if (tab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Spots</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && landedRound >= S.round;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + (showWin && b.win > 0 ? ' row--won' : '') + '"><span class="row__user">' + esc(b.player || 'Player') + '</span><span class="row__tags">' + tags(b.bets) + '</span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Bets this round');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === revealRound && landedRound < revealRound));
    cols = '<span>Round</span><span>Spots</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => '<div class="row' + (m.win > 0 ? ' row--won' : '') + '"><span>#' + m.round + (m.outcome ? ' <b class="ball ball--xs ' + kindClass(m.outcome.pocket) + '">' + m.outcome.pocket + '</b>' : '') + '</span><span class="row__tags">' + tags(m.bets) + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>');
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
    else if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && $('rules').hidden) addChip('n:' + e.key, SPOTS['n:' + e.key].el);
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
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: GAME, gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
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
  const stored = safeSS('chromaten:placed');
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
    if (d != null && scene) { scene.show(d); scene.win(true, d); showResult(d); }
    landedRound = S.round;
    setStatus('wait');
  }
  paintAll(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
buildBoard(); buildQuick(); wire();
setStatus('wait');
game = window.NXTable.start({
  event: EVENT, game: GAME,
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
paintChips();
game.limitsLoaded.then((l) => {
  if (l && l.min > 0) { minBet = l.min; chipVal = l.min; }
  setText($('boardLim'), 'Min ' + money(l.min || 0.1) + (l.max ? ' · Max ' + money(l.max) : ''));
  setText($('rMin'), money(l.min || 0.1)); if (l.max) setText($('rMax'), money(l.max));
  paintChips(); paintAll(); updateControls();
});
createScene($('scene'), { tick: (speed) => sound.play('tick', speed) }).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  window.__ct = { scene: sc, game, state: () => ({ round, closedRound, revealRound, landedRound, started, placed, pending, syncInfo, shownDigit, ticks }) }; // QA hook
  layout();
  if (!started && S && S.gotSnapshot && S.phase !== 'waiting') syncFromSnapshot();
});
setTimeout(() => { if (!started && scene) { syncedEarly = true; syncFromSnapshot(); } }, 5000);
layout();
requestAnimationFrame(tick);
if (/[?&]fps=1/.test(location.search)) { // on-device check: ?fps=1 shows the frame rate
  const el = document.createElement('div'); el.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99;padding:3px 7px;border-radius:6px;background:#000a;font:700 11px monospace;color:#7f7;pointer-events:none';
  document.body.appendChild(el); let n = 0, t = performance.now(), worst = 0, last = t;
  (function f(now) { n++; worst = Math.max(worst, now - last); last = now; if (now - t >= 1000) { el.textContent = Math.round((n * 1000) / (now - t)) + ' fps · worst ' + Math.round(worst) + ' ms'; n = 0; t = now; worst = 0; } requestAnimationFrame(f); })(t);
}
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#12072a'); } }, 6000);
