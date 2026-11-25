/* Matka Pulse (88.0092) — an open + close panna draw every 30 s, shared by every player (engine draw
 * game "matkapulse": nexorng-engine/internal/tables/matkapulse.go; client rules: rules.js).
 *   15 s betting → 9.7 s draw (the OPEN pot draws three digits, then the CLOSE pot; each pot's tiles
 *   sort into its panna, its single coin flips, then the JODI coin) → 5.3 s result.
 * Bets: open / close single (9.6×), jodi (96×), open / close panna (single 160×, double 320×,
 * triple 960×). Chips are collected on the board and sent in ONE bet (Place bets, or automatically
 * 1.5 s before betting closes; up to 20 spots). Settlement and rules live in ../_core/table-client.js
 * and rules.js; this file is the board, the round choreography and the layout; scene.js is the 3D.
 */
import { create as createScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0092';
const BETTING_MS = 15000;
const AUTO_SEND_MS = 1500;
const MAX_SPOTS = 20;
const CHIP_X = [1, 2, 5, 10];
const MR = window.MatkaRules;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const PH = {
  betting: ['The pots are warm — pick your numbers', 'Bets are open — choose your singles', 'Which jodi is yours tonight?', 'Build a panna, chase the 960×', 'Open or close — where is your luck?', 'Fresh pots, fresh numbers', 'Spread your chips across the board'],
  last: ['Last chips…', 'Closing soon', 'Final call — place your bets'],
  closed: ['No more bets — the open pot is rolling', 'Bets are closed — here come the balls', 'The pots are spinning…', 'Fingers crossed for your numbers'],
  open: ['Open pot drawing…', 'First ball is rising…', 'The open panna is forming…'],
  close: ['Close pot drawing…', 'Now the close pot…', 'The jodi is almost here…'],
  wait: ['Next round soon', 'Get your chips ready', 'New pots in a moment', 'Warming up the pots'],
  noBet: ['Wait for the next round', 'Bets are closed — next round soon', 'Hold your chips for the next draw'],
  win: ['Right on the number!', 'That’s a winner!', 'Lucky pick!', 'Nicely picked!'],
  lose: ['So close — next draw in a moment', 'Not this time — new pots soon', 'Next round could be yours'],
};

// ---------------------------------------------------------------- state
const sound = window.MPAudio.create();
let scene = null, game = null, S = null;
let chipVals = CHIP_X.map((x) => r2(0.1 * x)), chipIdx = 0;
let pending = {}, stack = [], placed = null, placing = false, lastBets = null;
let round = 0, closedRound = 0, autoRound = 0, revealRound = 0, shownRound = 0, lastTick = -1;
let started = false, readySent = false, listTab = 'all', boardTab = 'single';
let resultFor = 0, wonRound = 0, lastSeed = null, drawIdx = 0, sceneRound = 0;
let jA = null, pDigits = [], pSide = 'op', pFlash = null;
const KEYS = {};   // spot → [button elements] (several views can show one spot)

function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function short(n) { if (n >= 1000) return r2(n / 1000) + 'K'; return Number.isInteger(r2(n)) ? String(r2(n)) : String(r2(n)).replace(/^0\./, '.'); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function sum(o) { let t = 0; for (const k in o) t += o[k]; return r2(t); }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function payOf(spot) {
  const k = spot.slice(0, 2);
  if (k === 'os' || k === 'cs') return 9.6;
  if (k === 'jo') return 96;
  return MR.kindPay[MR.kind(spot.slice(3))];
}
function spotLabel(spot) { // { tag: OPEN|CLOSE|JODI, text }
  const k = spot.slice(0, 2), v = spot.slice(spot.indexOf(':') + 1);
  if (k === 'os') return { tag: 'OPEN', cls: 'o', text: 'Single ' + v };
  if (k === 'cs') return { tag: 'CLOSE', cls: 'c', text: 'Single ' + v };
  if (k === 'jo') return { tag: 'JODI', cls: 'j', text: v };
  return { tag: k === 'op' ? 'OPEN' : 'CLOSE', cls: k === 'op' ? 'o' : 'c', text: 'Panna ' + v + ' · ' + MR.kind(v) };
}
function spotShort(spot) {
  const k = spot.slice(0, 2), v = spot.slice(spot.indexOf(':') + 1);
  return k === 'os' ? 'Open ' + v : k === 'cs' ? 'Close ' + v : k === 'jo' ? 'Jodi ' + v : (k === 'op' ? 'Open ' : 'Close ') + v;
}
let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
let statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  const el = $('status'); el.textContent = text || pick(PH[key] || ['']); el.dataset.kind = key;
}
function reg(spot, el) { (KEYS[spot] = KEYS[spot] || []).push(el); }

// ---------------------------------------------------------------- build once
function keyBtn(label, spot, cls) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'k' + (cls ? ' ' + cls : '');
  if (spot) { b.dataset.spot = spot; reg(spot, b); }
  b.innerHTML = '<span class="k__d">' + label + '</span><span class="k__chip" hidden></span><span class="k__gain" hidden></span>';
  return b;
}
function buildBoard() {
  for (const [box, side] of [['keysOS', 'os'], ['keysCS', 'cs']]) {
    const el = $(box);
    DIGITS.forEach((d) => {
      const b = keyBtn(String(d), side + ':' + d, side === 'cs' ? 'k--c' : '');
      b.setAttribute('aria-label', (side === 'os' ? 'Open' : 'Close') + ' single ' + d + ', pays 9.6 times');
      el.appendChild(b);
    });
    el.addEventListener('click', (e) => { const b = e.target.closest('.k'); if (b) addChip(b.dataset.spot, b); });
  }
  // desktop: the full jodi grid (rows = open single, columns = close single)
  const grid = $('jgrid');
  grid.appendChild(Object.assign(document.createElement('span'), { className: 'jg__hd' }));
  for (let c = 0; c < 10; c++) grid.appendChild(Object.assign(document.createElement('span'), { className: 'jg__hd jg__hd--c', textContent: String(c) }));
  for (let r = 0; r < 10; r++) {
    grid.appendChild(Object.assign(document.createElement('span'), { className: 'jg__hd jg__hd--o', textContent: String(r) }));
    for (let c = 0; c < 10; c++) {
      const spot = 'jodi:' + r + c, b = document.createElement('button');
      b.type = 'button'; b.className = 'jg'; b.dataset.spot = spot; b.setAttribute('aria-label', 'Jodi ' + r + c + ', pays 96 times');
      b.innerHTML = '<span class="k__d">' + r + c + '</span><span class="k__chip" hidden></span>';
      reg(spot, b); grid.appendChild(b);
    }
  }
  grid.addEventListener('click', (e) => { const b = e.target.closest('.jg'); if (b) addChip(b.dataset.spot, b); });
  // phone: the jodi builder (open digit, then close digit)
  DIGITS.forEach((d) => {
    const a = keyBtn(String(d), null, 'k--sm'); a.dataset.a = d; a.setAttribute('aria-label', 'Jodi open digit ' + d); $('keysJA').appendChild(a);
    const b = keyBtn(String(d), null, 'k--sm k--c'); b.dataset.b = d; b.setAttribute('aria-label', 'Jodi close digit ' + d); $('keysJB').appendChild(b);
  });
  $('keysJA').addEventListener('click', (e) => { const b = e.target.closest('.k'); if (!b) return; jA = jA === +b.dataset.a ? null : +b.dataset.a; sound.play('chip', 0); paintJodiPick(); });
  $('keysJB').addEventListener('click', (e) => {
    const b = e.target.closest('.k'); if (!b) return;
    if (jA == null) { toast('Pick the OPEN digit first'); sound.play('error'); $('keysJA').classList.remove('nudge'); void $('keysJA').offsetWidth; $('keysJA').classList.add('nudge'); return; }
    addChip('jodi:' + jA + b.dataset.b, b);
  });
  // panna builder
  DIGITS.forEach((d) => { const b = keyBtn(String(d), null, 'k--sm k--p'); b.dataset.p = d; b.setAttribute('aria-label', 'Panna digit ' + d); $('keysP').appendChild(b); });
  $('keysP').addEventListener('click', (e) => { const b = e.target.closest('.k'); if (b) pannaDigit(+b.dataset.p, b); });
  $('pBack').addEventListener('click', () => { if (pDigits.length) { pDigits.pop(); pFlash = null; paintPanna(); } });
  $('ptog').addEventListener('click', (e) => {
    const b = e.target.closest('.ptog__b'); if (!b) return;
    pSide = b.dataset.side; sound.play('chip', 0); paintPanna();
  });
  // tabs (phone)
  $('tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) setBoardTab(t.dataset.tab); });
  // slip: tap a pending pill to take it back
  $('slipTrack').addEventListener('click', (e) => { const p = e.target.closest('.pill'); if (p && p.dataset.spot) removeSpot(p.dataset.spot); });
}
function setBoardTab(t) {
  boardTab = t;
  document.querySelectorAll('.tab').forEach((x) => { const on = x.dataset.tab === t; x.classList.toggle('tab--on', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
  $('sections').dataset.tab = t;
  sound.play('chip', 0);
}
function buildChips() {
  const box = $('chips');
  CHIP_X.forEach((x, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip c' + i; b.setAttribute('role', 'radio'); b.dataset.i = i;
    b.innerHTML = '<span></span><small>' + x + '×</small>';
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

// ---------------------------------------------------------------- panna builder / jodi builder
function pannaDigit(d, el) {
  if (!bettingOpen() || locked()) { addChip(null, el); return; } // the same refusal messages
  if (pDigits.length >= 3) pDigits = [];
  pDigits.push(d); pFlash = null;
  sound.play('chip', 0);
  if (pDigits.length === 3) {
    const p = MR.panna(pDigits), spot = pSide + ':' + p;
    if (addChip(spot, $('ps1'))) { pFlash = { panna: p, at: Date.now() }; setTimeout(() => { if (pFlash && Date.now() - pFlash.at >= 1100) { pDigits = []; pFlash = null; paintPanna(); } }, 1150); }
    else pDigits = [];
  }
  paintPanna();
}
function paintPanna() {
  const ds = pDigits.length === 3 ? MR.panna(pDigits).split('').map(Number) : pDigits;
  for (let i = 0; i < 3; i++) { const el = $('ps' + i); setText(el, i < ds.length ? String(ds[i]) : ''); el.classList.toggle('ps--on', i < ds.length); el.classList.toggle('ps--done', pDigits.length === 3); }
  let kind = 'PICK 3 DIGITS', pay = 'any order · sorted for you';
  if (pDigits.length === 3) { const p = MR.panna(pDigits), k = MR.kind(p); kind = { SP: 'SINGLE PANNA', DP: 'DOUBLE PANNA', TP: 'TRIPLE PANNA' }[k] + ' ' + p; pay = (pSide === 'op' ? 'Open' : 'Close') + ' · pays ×' + MR.kindPay[k]; }
  else if (pDigits.length) pay = (3 - pDigits.length) + ' more digit' + (pDigits.length === 2 ? '' : 's');
  setText($('pKind'), kind); setText($('pPay'), pay);
  $('pBack').disabled = !pDigits.length;
  document.querySelectorAll('.ptog__b').forEach((b) => { const on = b.dataset.side === pSide; b.classList.toggle('ptog__b--on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
  $('sections').dataset.pside = pSide;
}
function paintJodiPick() {
  Array.prototype.forEach.call($('keysJA').children, (b) => b.classList.toggle('k--pick', +b.dataset.a === jA));
  setText($('jpA'), jA == null ? '?' : String(jA));
  setText($('jpickHint'), jA == null ? 'pick an open digit first' : 'each tap adds jodi ' + jA + '·');
  Array.prototype.forEach.call($('keysJB').children, (b) => {
    const spot = jA == null ? '' : 'jodi:' + jA + b.dataset.b, a = spot ? betsOf(spot).amt : 0;
    paintChipBadge(b, a, spot && placedHas(spot));
  });
}

// ---------------------------------------------------------------- betting
function bettingOpen() { return !!S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function locked() { return !!(placed && placed.round === round) || placing; }
function balanceNow() { return S && S.balance != null ? S.balance : null; }
function free() { const b = balanceNow(); return b == null ? Infinity : r2(b - sum(pending)); }
function placedHas(spot) { return !!(placed && placed.round === round && placed.bets[spot]); }

function addChip(spot, el) { // returns true when the chip went on
  sound.play('chip', 0);
  if (!bettingOpen()) { toast(pick(PH.noBet)); sound.play('error'); return false; }
  if (locked()) { toast('Your bets are placed for this round.'); return false; }
  if (!spot) return false;
  if (!pending[spot] && Object.keys(pending).length >= MAX_SPOTS) { toast('Up to ' + MAX_SPOTS + ' different bets per round.'); sound.play('error'); return false; }
  const lim = game.limit();
  let amt = chipVals[chipIdx];
  const total = sum(pending);
  if (lim.max > 0 && total + amt > lim.max + 1e-9) {
    if (total >= lim.max - 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return false; }
    amt = r2(lim.max - total);
  }
  if (amt > free() + 1e-9) { toast('Not enough balance.'); sound.play('error'); return false; }
  pending[spot] = r2((pending[spot] || 0) + amt);
  stack.push([{ spot, amt }]);
  fly(center($('chips').children[chipIdx]), center(el), 'c' + chipIdx, short(amt), 0, 260).then(() => paintSpot(spot));
  updateControls(); renderSlip(); render();
  return true;
}
function removeSpot(spot) {
  if (locked() || !pending[spot]) return;
  delete pending[spot];
  stack = stack.map((st) => st.filter((e) => e.spot !== spot)).filter((st) => st.length);
  sound.play('chip'); paintSpot(spot); updateControls(); renderSlip(); render();
}
function undo() {
  if (locked() || !stack.length) return;
  stack.pop().forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) - e.amt); if (pending[e.spot] <= 0.001) delete pending[e.spot]; paintSpot(e.spot); });
  sound.play('chip'); updateControls(); renderSlip(); render();
}
function clearBets() {
  if (locked()) return;
  const spots = Object.keys(pending);
  pending = {}; stack = [];
  spots.forEach(paintSpot);
  if (spots.length) sound.play('clear');
  updateControls(); renderSlip(); render();
}
function doubleBets() {
  if (locked() || !bettingOpen()) return;
  const lim = game.limit(), total = sum(pending);
  if (!total) return;
  if (lim.max > 0 && total * 2 > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (total > free() + 1e-9) { toast('Not enough balance to double.'); sound.play('error'); return; }
  const add = Object.keys(pending).map((s) => ({ spot: s, amt: pending[s] }));
  add.forEach((e) => { pending[e.spot] = r2(pending[e.spot] + e.amt); paintSpot(e.spot); });
  stack.push(add); sound.play('chips'); updateControls(); renderSlip(); render();
}
function rebet() {
  if (locked() || !bettingOpen() || !lastBets) return;
  const add = Object.keys(lastBets).map((s) => ({ spot: s, amt: lastBets[s] })), need = r2(add.reduce((t, e) => t + e.amt, 0));
  const lim = game.limit(), spots = new Set(Object.keys(pending).concat(Object.keys(lastBets)));
  if (spots.size > MAX_SPOTS) { toast('Up to ' + MAX_SPOTS + ' different bets per round.'); sound.play('error'); return; }
  if (lim.max > 0 && sum(pending) + need > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (need > free() + 1e-9) { toast('Not enough balance to repeat.'); sound.play('error'); return; }
  add.forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) + e.amt); paintSpot(e.spot); });
  stack.push(add); sound.play('chips'); updateControls(); renderSlip(); render();
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
    safeSS('matkapulse:placed', placed);
    lastBets = snap; pending = {}; stack = [];
    paintAll();
    sound.play('placed');
    setStatus('placed', auto ? 'Your chips are in — good luck!' : 'Bets accepted — good luck!');
    updateControls(); renderSlip(); render();
  }).catch(() => { placing = false; updateControls(); render(); });
}

function betsOf(spot) {
  const p = placed && placed.round === round ? placed.bets[spot] : 0;
  return { amt: p || pending[spot] || 0, placed: !!p };
}
function paintChipBadge(el, amt, isPlaced) {
  const chip = el.querySelector('.k__chip');
  const k = amt + ':' + isPlaced;
  if (el.dataset.ck === k) return;
  el.dataset.ck = k;
  el.classList.toggle('k--bet', amt > 0);
  if (amt > 0) { chip.hidden = false; chip.textContent = short(amt); chip.className = 'k__chip ' + chipClass(amt); }
  else chip.hidden = true;
}
function chipClass(n) { let c = 0; for (let i = 0; i < chipVals.length; i++) if (n + 1e-9 >= chipVals[i]) c = i; return 'c' + c; }
function paintSpot(spot) {
  const b = betsOf(spot);
  (KEYS[spot] || []).forEach((el) => paintChipBadge(el, b.amt, b.placed));
  if (spot.startsWith('jodi:')) paintJodiPick();
}
function paintAll() { Object.keys(KEYS).forEach(paintSpot); paintJodiPick(); renderSlip(); }

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
  const lim = game ? game.limit() : { min: 0 }, bal = balanceNow();
  if (placing) { place.disabled = true; label = 'Placing…'; sub = money(total); }
  else if (placed && placed.round === round) {
    place.disabled = true;
    if (wonRound === round && resultFor === round) { place.classList.add('place--won'); label = 'You won ' + money(placed.win || 0); sub = 'next round soon'; }
    else { place.classList.add('place--done'); label = 'Bets placed · ' + money(placed.total); sub = S.phase === 'betting' ? 'good luck!' : 'good luck — drawing now'; }
  } else if (open && n) { place.disabled = false; label = 'Place bets'; sub = n + (n === 1 ? ' bet · ' : ' bets · ') + money(total) + ' · sent before the draw'; }
  else if (open && bal != null && !S.demo && bal < (lim.min || 0.1) - 1e-9) { place.disabled = true; label = 'Not enough balance'; sub = 'minimum ' + money(lim.min || 0.1); }
  else if (open) { place.disabled = true; label = 'Tap a number to bet'; sub = 'Chip ' + money(chipVals[chipIdx]); }
  else { place.disabled = true; label = S.phase === 'betting' || S.phase === 'dealing' ? 'No more bets' : 'Next round soon'; }
  setText($('placeLabel'), label); setText($('placeSub'), sub);
  const shownTotal = placed && placed.round === round ? placed.total : total;
  setText($('total'), money(shownTotal));
  $('board').classList.toggle('board--closed', !open || lock);
}

// ---------------------------------------------------------------- slip
let slipKey = '';
function renderSlip() {
  const isPlaced = placed && placed.round === round, src = isPlaced ? placed.bets : pending;
  const res = resultFor === round && S && S.result ? S.result : null;
  const ORDER = { os: 0, cs: 1, jo: 2, op: 3, cp: 4 };
  const spots = Object.keys(src).sort((a, b) => (res ? (game.pay(res, b) > 0) - (game.pay(res, a) > 0) : 0) || ORDER[a.slice(0, 2)] - ORDER[b.slice(0, 2)] || (a < b ? -1 : 1));
  const k = spots.map((s) => s + src[s]).join() + '|' + !!isPlaced + '|' + (res ? resultFor : '');
  if (k === slipKey) return;
  slipKey = k;
  const html = spots.map((s) => {
    const L = spotLabel(s), x = res ? game.pay(res, s) : 0;
    const won = x > 0, gain = won ? r2(src[s] * x) : 0;
    return '<button type="button" class="pill pill--' + L.cls + (won ? ' pill--won' : res ? ' pill--lost' : '') + (isPlaced ? '' : ' pill--edit') + '" data-spot="' + (isPlaced ? '' : s) + '">' +
      '<i>' + L.tag + '</i>' + esc(L.text) + ' <em>' + (won ? '+' + money(gain) : money(src[s])) + '</em>' + (isPlaced ? '' : '<b aria-hidden="true">×</b>') + '</button>';
  }).join('');
  $('slipTrack').innerHTML = html || '<span class="slip__empty">Pick singles, a jodi or a panna — every bet shows here</span>';
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
  round = S.round; lastTick = -1; drawIdx = 0;
  if (placed && placed.round !== round) placed = null;
  pending = {}; stack = []; pDigits = []; pFlash = null;
  clearHighlights();
  if (scene && sceneRound !== round) { sceneRound = round; scene.reset(); }
  setStatus('betting');
  $('drawchip').hidden = true;
  sound.play('open');
  paintAll(); paintPanna(); updateControls(); render();
}

function closeRound() {
  closedRound = round;
  setStatus('closed');
  sound.play('closed');
  const back = Object.keys(pending); // chips that were never placed go back to the rack
  if (!placing && back.length) {
    const rack = center($('chips'));
    back.forEach((s, i) => { const el = (KEYS[s] || [])[0]; if (el && el.offsetParent) fly(center(el), rack, chipClass(pending[s]), short(pending[s]), i * 40, 380, { fadeOut: true }); });
    pending = {}; stack = []; paintAll();
  }
  pDigits = []; paintPanna();
  showDrawChip(0);
  if (scene && drawIdx === 0) { scene.startPot('open'); sound.play('rumble'); }
  updateControls(); render();
}
function showDrawChip(n, digits) { // n digits drawn so far: the pot's digits, big, as they are read
  const el = $('drawchip'); el.hidden = false; // hidden by showResult / the next betting
  setText($('drawLabel'), n < 3 ? 'OPEN' : 'CLOSE');
  const k = n < 3 ? n : n - 3, base = n < 3 ? 0 : 3, ds = digits || [];
  Array.prototype.forEach.call(el.querySelectorAll('.drawchip__dots i'), (d, i) => {
    const on = i < k; d.classList.toggle('on', on); setText(d, on && ds[base + i] != null ? String(ds[base + i]) : '–');
  });
}

function onDeal(step) {
  if (!step || step.kind !== 'digit' || step.value == null) return;
  const r = step.round, i = step.step;
  if (closedRound !== r) { round = r; closeRound(); }
  revealRound = r;
  if (!scene) return;
  if (i !== drawIdx) { // a missed step (tab hidden, reconnect): resync from what the client has
    const ds = (S.deals || []).filter((x) => x.kind === 'digit' && x.round === r).sort((a, b) => a.step - b.step).map((x) => x.value);
    drawIdx = ds.length; scene.show(ds, { drawing: true }); showDrawChip(drawIdx, ds);
    return;
  }
  drawIdx = i + 1;
  scene.digit(i, step.value);
  if (i === 0 || i === 3) setStatus(i === 0 ? 'open' : 'close');
  if (i === 2) setTimeout(() => sound.play('rumble'), 900);
  if (i === 3) showDrawChip(3, []); // the close pot starts: its three empty slots
  // the digit appears in the chip when its ball reaches the top of the neck
  setTimeout(() => { if (drawIdx === i + 1 && round === r) showDrawChip(drawIdx, scene.drawn()); }, 550);
}

function myResult(outcome) {
  if (!placed || placed.round !== round) return null;
  let w = 0;
  const lines = [];
  for (const s in placed.bets) {
    const x = game.pay(outcome, s);
    if (x > 0) { const g = r2(placed.bets[s] * x); w += g; lines.push({ spot: s, x, g }); }
  }
  w = r2(w);
  let capped = false;
  if (placed.maxWin > 0 && w > placed.maxWin) { w = placed.maxWin; capped = true; }
  return { win: w, lines, capped };
}
function onResult(d) {
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, digits: d.outcome && d.outcome.digits };
  const restored = placed && placed.round === S.round && placed.restored;
  if (restored) setTimeout(refreshBalance, 800); // reloaded mid-round: the client has no record of this bet
  if (placed && placed.round === S.round) {
    safeSS('matkapulse:placed', null);
    const my = S.myBets[0];
    if (my && my.round === S.round) placed.win = my.win; // the client's settlement (capped like the engine)
  }
  const digits = d.outcome && d.outcome.digits;
  if (!digits || digits.length !== 6) return;
  round = S.round;
  if (!scene) { showResult(); return; }
  const drawn = scene.drawn();
  const same = drawn.length === 6 && drawn.every((v, k) => v === digits[k]);
  if (!same) { // the draw was missed (tab hidden / joined late): show it now
    drawIdx = 6; scene.show(digits, {}); showResult();
  } else if (!revealedNow) { clearTimeout(revealT); revealT = setTimeout(showResult, 1600); } // the scene reveals any moment
  else showResult();
  render();
}
let revealedNow = false, revealT = 0;
function onRevealed() {
  revealedNow = true;
  sound.play('reveal');
  if (S && S.result && S.phase !== 'betting' && S.result.digits && resultFor !== S.round) showResult();
}
function showResult() {
  clearTimeout(revealT);
  if (!S || !S.result || resultFor === S.round) return;
  const o = S.result, R = MR.read(o);
  if (!R) return;
  resultFor = S.round; shownRound = S.round;
  $('drawchip').hidden = true;
  setText($('rOpen'), R.open); setText($('rJodi'), R.jodi); setText($('rClose'), R.close);
  $('play').classList.add('play--result');
  const res = $('result'); res.hidden = false; res.classList.remove('result--in'); void res.offsetWidth; res.classList.add('result--in');
  if (scene) scene.glow(true);
  // the board: the drawn spots get a gold ring; my winning spots turn gold with their gain
  const hits = ['os:' + R.so, 'cs:' + R.sc, 'jodi:' + R.jodi, 'op:' + R.open, 'cp:' + R.close];
  hits.forEach((s) => (KEYS[s] || []).forEach((el) => el.classList.add('k--res')));
  const my = myResult(o);
  if (my) {
    placed.win = my.capped ? my.win : (placed.win != null ? placed.win : my.win);
    my.lines.forEach((l) => (KEYS[l.spot] || []).forEach((el) => {
      el.classList.add('k--won');
      const g = el.querySelector('.k__gain'); if (g) { g.hidden = false; g.textContent = '+' + money(l.g); }
    }));
    if (my.win > 0) {
      wonRound = S.round;
      showWin(my);
      setStatus('win', R.open + '-' + R.jodi + '-' + R.close + ' — ' + pick(PH.win));
      sound.play('win', my.win >= placed.total * 8);
    } else { setStatus('lose', R.open + '-' + R.jodi + '-' + R.close + '. ' + pick(PH.lose)); sound.play('lose'); }
  } else setStatus('result', 'Result ' + R.open + '-' + R.jodi + '-' + R.close);
  renderSlip(); updateControls(); render();
}
function showWin(my) {
  setText($('winAmt'), money(my.win));
  $('winLines').innerHTML = my.lines.slice(0, 3).map((l) => '<span>' + esc(spotShort(l.spot)) + ' · ×' + l.x + ' <b>+' + money(l.g) + '</b></span>').join('') +
    (my.lines.length > 3 ? '<span>+' + (my.lines.length - 3) + ' more</span>' : '') + (my.capped ? '<span class="win__cap">Max win per round reached</span>' : '');
  const w = $('win'); w.hidden = false; w.classList.remove('win--in'); void w.offsetWidth; w.classList.add('win--in');
  const bal = $('balance'); bal.classList.add('bump'); setTimeout(() => bal.classList.remove('bump'), 500);
}
function clearHighlights() {
  $('win').hidden = true; $('result').hidden = true; revealedNow = false; $('play').classList.remove('play--result');
  if (scene) scene.glow(false);
  document.querySelectorAll('.k--res, .k--won').forEach((el) => el.classList.remove('k--res', 'k--won'));
  document.querySelectorAll('.k__gain').forEach((g) => { g.hidden = true; });
}
function refreshBalance() {
  const tok = (() => { try { return localStorage.getItem('token'); } catch (e) { return null; } })();
  if (!tok || tok === 'demo' || !game) return;
  fetch(game.apiUrl('/playerBalance'), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } })
    .then((r) => r.json()).then((p) => { const b = p && p.data && p.data.balance; if (b != null) { S.balance = Number(b); render(); } }).catch(() => {});
}

// ---------------------------------------------------------------- per frame: timer, auto-send, close
let timerShown = null;
function tick() {
  if (S && started) {
    const now = Date.now(), timer = $('timer');
    if (S.phase === 'betting') {
      const left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000);
      if (left > 0) {
        if (timerShown !== true) { timer.hidden = false; timerShown = true; }
        $('timerRing').style.strokeDashoffset = String(100 - Math.min(1, left / BETTING_MS) * 100);
        if (secs !== lastTick) {
          timer.dataset.level = secs <= 3 ? 'red' : secs <= 6 ? 'amber' : 'green';
          setText($('timerNum'), String(secs));
          if (secs <= 5 && lastTick !== -1) sound.play('tick', secs <= 2);
          if (secs <= 4 && statusKey === 'betting') setStatus('last');
          lastTick = secs; updateControls();
        }
        if (left <= AUTO_SEND_MS && autoRound !== round && Object.keys(pending).length && !locked()) { autoRound = round; submit(true); }
      } else {
        if (timerShown !== false) { timer.hidden = true; timerShown = false; }
        if (closedRound !== round && round) closeRound();
      }
    } else if (timerShown !== false) { timer.hidden = true; timerShown = false; }
    if (S.phase === 'pause' && (statusKey === 'result' || statusKey === 'win' || statusKey === 'lose') && now - lastPauseAt > 2600) setStatus('wait');
  }
  requestAnimationFrame(tick);
}
let lastPauseAt = 0, phaseSeen = '';

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '', strip = null;
function visibleHistory() { return S.history.filter((h) => h.outcome && h.outcome.digits && !(h.round === revealRound && shownRound < revealRound)); }
function render() {
  if (!S || !started) return;
  if (S.phase !== phaseSeen) { phaseSeen = S.phase; if (S.phase === 'pause') lastPauseAt = Date.now(); }
  let bal = S.balance;
  if (bal != null && Object.keys(pending).length && !placing) bal = r2(bal - sum(pending)); // chips on the board, not sent yet
  setText($('balance'), bal == null ? '—' : money(bal));
  setText($('mode'), S.demo ? 'Demo' : 'Balance');
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  setText($('fRound'), S.round ? String(S.round) : '—');
  setText($('fHash'), S.hash || '—');
  setText($('fSeed'), lastSeed && lastSeed.round === shownRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the round' : '—'));
  const hist = visibleHistory(), hk = hist.length + ':' + (hist[0] && hist[0].round);
  if (hk !== histKey) { histKey = hk; renderHistory(hist); renderStats(hist); }
  renderList();
  updateControls();
  if (!strip && window.NXPlayers && !WIDE.matches) strip = window.NXPlayers.create($('stage'), { face: avatar });
  if (strip) strip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(name) { return NXPlayers.face(name, 'av', 'span'); } // a player's face (../_core/players.js)
function tag(p) { const k = MR.kind(p); return k === 'SP' ? '' : '<i class="hd__t">' + k + '</i>'; }
function renderHistory(hist) {
  $('history').innerHTML = hist.slice(0, 24).map((h, i) => {
    const R = MR.read(h.outcome);
    return '<span class="hd' + (i === 0 && h.round === shownRound ? ' hd--new' : '') + '" title="Round ' + h.round + '">' + R.open + tag(R.open) + '<em>' + R.jodi + '</em>' + R.close + tag(R.close) + '</span>';
  }).join('') || '<span class="hd hd--empty">Results appear here</span>';
}
function renderStats(hist) {
  const n = hist.length, c = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let tpAgo = -1, dp = 0;
  hist.forEach((h, i) => {
    const R = MR.read(h.outcome); c[R.so]++; c[R.sc]++;
    if (tpAgo < 0 && (MR.kind(R.open) === 'TP' || MR.kind(R.close) === 'TP')) tpAgo = i;
    dp += (MR.kind(R.open) === 'DP') + (MR.kind(R.close) === 'DP');
  });
  setText($('statN'), String(n));
  const max = Math.max(1, ...c), hi = Math.max(...c);
  $('freq').innerHTML = c.map((v, d) => '<div class="fq"><i class="' + (n && v === hi ? 'hot' : '') + '" style="height:' + Math.round((v / max) * 100) + '%"></i><b>' + d + '</b></div>').join('');
  setText($('tpSeen'), !n ? '—' : tpAgo < 0 ? 'not in ' + n : tpAgo === 0 ? 'last round' : tpAgo + ' rounds ago');
  setText($('dpShare'), n ? Math.round((dp / (2 * n)) * 100) + '%' : '—');
}
function summary(bets) {
  const list = (bets || []).map((b) => spotShort(b.spot));
  return list.length <= 2 ? list.join(', ') || '—' : list.slice(0, 2).join(', ') + ' +' + (list.length - 2);
}
function renderList() {
  let rows, cols, count;
  if (listTab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && shownRound >= S.round;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + (showWin && b.win > 0 ? ' row--won' : '') + '"><span class="row__user">' + esc(b.player || 'Player') + '</span><span class="row__nums">' + esc(summary(b.bets)) + '</span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Players this round');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === revealRound && shownRound < revealRound));
    cols = '<span>Result</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => { const R = MR.read(m.outcome); return '<div class="row' + (m.win > 0 ? ' row--won' : '') + '"><span class="row__res">' + (R ? R.open + '-' + R.jodi + '-' + R.close : '#' + m.round) + '</span><span class="row__nums">' + esc(summary(m.bets)) + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>'; });
    setText($('countLabel'), 'My rounds');
  }
  const k = listTab + '|' + rows.join('');
  if (k === listKey) return;
  listKey = k;
  $('cols').innerHTML = cols;
  setText($('betCount'), String(count));
  $('list').innerHTML = rows.join('') || '<div class="empty">' + (listTab === 'all' ? 'No bets yet this round' : 'Your rounds will show here') + '</div>';
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
    listTab = b.dataset.tab;
    document.querySelectorAll('.bets__tab').forEach((x) => { x.classList.toggle('bets__tab--on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    render();
  }));
  $('rulesBtn').addEventListener('click', () => { $('rules').hidden = false; });
  $('rulesClose').addEventListener('click', () => { $('rules').hidden = true; });
  $('rules').addEventListener('click', (e) => { if (e.target === $('rules')) $('rules').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('rules').hidden = true; });
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
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: 'matkapulse', gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const o = res[1].outcome, R = MR.read(o), same = !L.digits || o.digits.join() === L.digits.join();
    out.innerHTML = 'Round ' + L.round + ': digits <b>' + o.digits.join(' ') + '</b> → <b>' + R.open + '-' + R.jodi + '-' + R.close + '</b>. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (same ? '✓ same draw' : '✗ draw differs');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

// first snapshot: put the pots in the state the round is in
function syncFromSnapshot() {
  started = true;
  round = S.round;
  const last = S.history[0];
  const stored = safeSS('matkapulse:placed');
  if (stored && stored.round === S.round && (S.phase === 'betting' || S.phase === 'dealing')) { placed = stored; placed.restored = true; }
  sceneRound = round;
  if (S.phase === 'dealing') {
    closedRound = round; revealRound = round;
    const ds = (S.deals || []).filter((x) => x.kind === 'digit' && x.value != null).sort((a, b) => a.step - b.step).map((x) => x.value);
    drawIdx = ds.length;
    setStatus(ds.length < 3 ? 'open' : 'close');
    showDrawChip(drawIdx, ds);
    if (scene) scene.show(ds, { drawing: true });
  } else if (S.phase === 'betting') {
    if (scene) scene.show([], {});
    setStatus('betting');
    if (Date.now() >= S.endsAt) closeRound();
  } else {
    const o = S.result && S.result.digits ? S.result : last && last.outcome;
    if (o && o.digits) { if (scene) scene.show(o.digits, {}); drawIdx = 6; showResult(); }
    shownRound = S.round;
    setStatus('wait');
  }
  paintAll(); paintPanna(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
buildBoard(); buildChips(); wire(); paintPanna(); setBoardTab('single');
setStatus('wait');
game = window.NXTable.start({
  event: EVENT, game: 'matkapulse',
  onChange() {
    S = game ? game.S : S;
    if (!S) return;
    if (!started && scene && S.gotSnapshot && S.phase !== 'waiting') syncFromSnapshot();
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
  pop: () => sound.play('pop'),
  tile: () => sound.play('tile'),
  sorted: () => sound.play('sort'),
  revealed: onRevealed,
}).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  window.__mp = { scene: sc, game, state: () => ({ round, closedRound, revealRound, shownRound, resultFor, drawIdx, started, placed, pending }) }; // QA hook
  layout();
  if (!started && S && S.gotSnapshot && S.phase !== 'waiting') syncFromSnapshot();
});
setTimeout(() => { if (!started && scene) syncFromSnapshot(); }, 5000);
layout();
requestAnimationFrame(tick);
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#0b0620'); } }, 6000);
