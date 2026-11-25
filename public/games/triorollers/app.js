/* Trio Rollers (88.0096) — a 000–999 draw every 30 s, shared by every player (engine draw game
 * "triorollers": nexorng-engine/internal/tables/triorollers.go; client rules: rules.js).
 *   15 s betting → 10 s draw (the three rollers spin; the digits arrive 2.8 s, 5.0 s and 7.3 s after
 *   betting closed and each roller slows down and locks on its digit, left to right) → 5 s result.
 * Bets (Straight, Box, Front/Back pair, single digit, sum, Small/Big/Odd/Even, any triple) are
 * collected on the console and sent in ONE bet (Place bets, or automatically 1.5 s before betting
 * closes). Settlement and rules live in ../_core/table-client.js + rules.js; this file is the
 * console, the round choreography and the layout; scene.js is the 3D machine.
 */
import { create as createScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0096', KEY = 'triorollers';
const BETTING_MS = 15000;
const AUTO_SEND_MS = 1500;
const MAX_SPOTS = 20;
const CHIP_X = [1, 2, 5, 10, 25];
const LAND_S = [1.3, 1.4, 1.8];        // each roller's slow-down (the third one teases a little longer)
const POS = ['1st', '2nd', '3rd'];
const PH = {
  betting: ['Three rollers, one number — pick yours', 'Bets are open — choose your number', 'Straight pays 960× — feeling exact?', 'Box it: any order wins', 'Which digits will lock tonight?', 'Back a pair, a digit or the sum', 'Spread your chips across the rollers'],
  last: ['Last chips…', 'Closing soon', 'Final call — place your bets'],
  closed: ['No more bets — the rollers are spinning!', 'Here they go…', 'Rolling for your number…', 'Bets are closed — fingers crossed'],
  rolling: ['{p} roller locked on {d}… two to go', 'Second roller locked… one to go', 'And the last roller…'],
  wait: ['Next draw soon', 'Get your number ready', 'A new draw is coming up', 'The rollers reset…'],
  noBet: ['Wait for the next draw', 'Bets are closed — next draw soon', 'Hold your chip for the next draw'],
  win: ['Right on the number!', 'That’s a winner!', 'The rollers love you!', 'Nicely picked!'],
  lose: ['So close — next draw in a moment', 'Not this time — the rollers turn again soon', 'Next draw could be yours'],
};

// ---------------------------------------------------------------- state
const sound = window.TRAudio.create();
const RULES = { pay: null, sumPay: null };
let scene = null, game = null, S = null;
let chipVals = CHIP_X.map((x) => r2(0.1 * x)), chipIdx = 0;
let pending = {}, stack = [], placed = null, placing = false, lastBets = null;
let round = 0, closedRound = 0, autoRound = 0, lastTick = -1;
let landedDigits = [null, null, null], landedRound = 0, resultRound = 0, startedLand = [0, 0, 0];
let started = false, readySent = false, tab = 'number', listTab = 'all';
let bannerRound = 0, wonRound = 0, lastSeed = null, syncedEarly = false;
let pick = loadPick();
const CELLS = [];  // { el, spot() , chip }

function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function short(n) { if (n >= 1000) return r2(n / 1000) + 'K'; return Number.isInteger(r2(n)) ? String(r2(n)) : String(r2(n)).replace(/^0\./, '.'); }
function pickOne(list) { return list[Math.floor(Math.random() * list.length)]; }
function sum(o) { let t = 0; for (const k in o) t += o[k]; return r2(t); }
function chipClass(n) { let c = 0; for (let i = 0; i < chipVals.length; i++) if (n + 1e-9 >= chipVals[i]) c = i; return 'c' + c; }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function safeLS(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function loadPick() { const p = safeLS(KEY + ':pick'); return Array.isArray(p) && p.length === 3 && p.every((d) => d >= 0 && d <= 9) ? p : [4, 7, 2]; }
let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
let statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  const el = $('status'); el.textContent = text || pickOne(PH[key] || ['']); el.dataset.kind = key;
}

// ---------------------------------------------------------------- spots
function isTriple(d) { return d[0] === d[1] && d[1] === d[2]; }
function spotLabel(s) {
  const [k, v] = s.split(':');
  switch (k) {
    case 'straight': return 'Straight ' + v;
    case 'box': return 'Box ' + v;
    case 'front': return 'Front ' + v;
    case 'back': return 'Back ' + v;
    case 'd1': case 'd2': case 'd3': return POS[+k[1] - 1] + ' = ' + v;
    case 'sum': return 'Sum ' + v;
    case 'triple': return 'Any triple';
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function spotTab(s) { if (/^(straight|box|front|back):/.test(s)) return 'number'; if (/^d[123]:/.test(s)) return 'digits'; return 'sum'; }
function fmtX(x) { return (x >= 100 ? String(Math.round(x)) : String(+x.toFixed(2))) + '×'; }

// ---------------------------------------------------------------- build once
function bindCell(el, spotFn) {
  const chip = document.createElement('span'); chip.className = 'bchip'; chip.hidden = true; el.appendChild(chip);
  const c = { el, spot: spotFn, chip, key: '' };
  CELLS.push(c);
  el.addEventListener('click', () => { const s = c.spot(); if (s) addChip(s, el); });
  return c;
}
function buildPicker() {
  const box = $('minis');
  for (let i = 0; i < 3; i++) {
    const w = document.createElement('div'); w.className = 'mw';
    w.innerHTML = '<span>' + POS[i].toUpperCase() + '</span>';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mini'; b.dataset.i = i;
    b.setAttribute('aria-label', POS[i] + ' digit');
    b.innerHTML = '<span class="mini__col"><i></i><i></i><b></b><i></i><i></i></span>';
    b.addEventListener('click', (e) => { const r = b.getBoundingClientRect(); stepPick(i, e.clientY < r.top + r.height / 2 ? -1 : 1); });
    b.addEventListener('wheel', (e) => { e.preventDefault(); stepPick(i, e.deltaY > 0 ? 1 : -1); }, { passive: false });
    b.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); stepPick(i, -1); } else if (e.key === 'ArrowDown') { e.preventDefault(); stepPick(i, 1); } else if (/^[0-9]$/.test(e.key)) setPick(i, +e.key); });
    w.appendChild(b); box.appendChild(w);
  }
  $('lucky').addEventListener('click', () => { pick = [0, 1, 2].map(() => Math.floor(Math.random() * 10)); sound.play('chip'); paintPicker([1, 1, 1]); savePick(); });
  $('lastNum').addEventListener('click', () => { const h = S && S.history[0]; if (!h || !h.outcome.digits) return toast('No draw yet'); pick = h.outcome.digits.slice(); sound.play('chip'); paintPicker([1, 1, 1]); savePick(); });
}
function stepPick(i, dir) { pick[i] = (pick[i] + dir + 10) % 10; sound.play('tick', 0); paintPicker(i === 0 ? [dir, 0, 0] : i === 1 ? [0, dir, 0] : [0, 0, dir]); savePick(); }
function setPick(i, d) { pick[i] = d; paintPicker([0, 0, 0]); savePick(); }
function savePick() { safeLS(KEY + ':pick', pick); }
function paintPicker(dirs) {
  document.querySelectorAll('.mini').forEach((b, i) => {
    const v = pick[i], cells = b.querySelectorAll('.mini__col > *');
    [(v + 8) % 10, (v + 9) % 10, v, (v + 1) % 10, (v + 2) % 10].forEach((d, k) => { cells[k].textContent = String(d); });
    if (dirs && dirs[i]) { b.classList.remove('mini--roll', 'mini--rollup'); void b.offsetWidth; b.classList.add(dirs[i] > 0 ? 'mini--roll' : 'mini--rollup'); }
  });
  setText($('pickShow'), pick.join(' · '));
  paintKeys();
}
function buildKeys() {
  const box = $('keys');
  const defs = [
    { k: 'straight', t: 'STRAIGHT', v: () => pick.join(''), x: () => 960, sub: () => 'exact order' },
    { k: 'box', t: 'BOX', v: () => pick.join(''), x: () => isTriple(pick) ? 0 : new Set(pick).size === 3 ? 160 : 320, sub: () => isTriple(pick) ? 'not on a triple' : new Set(pick).size === 3 ? '6-way · any order' : '3-way · any order' },
    { k: 'front', t: 'FRONT', v: () => '' + pick[0] + pick[1] + '·', x: () => 96, sub: () => '1st + 2nd' },
    { k: 'back', t: 'BACK', v: () => '·' + pick[1] + pick[2], x: () => 96, sub: () => '2nd + 3rd' },
  ];
  defs.forEach((d) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'key';
    b.innerHTML = '<span class="key__t">' + d.t + '<b></b></span><span class="key__x"><span></span><small></small></span>';
    box.appendChild(b);
    const c = bindCell(b, () => {
      if (d.k === 'box' && isTriple(pick)) return null;
      return d.k + ':' + (d.k === 'front' ? '' + pick[0] + pick[1] : d.k === 'back' ? '' + pick[1] + pick[2] : pick.join(''));
    });
    c.def = d;
  });
}
function paintKeys() {
  CELLS.forEach((c) => {
    if (!c.def) return;
    const d = c.def, x = d.x();
    setText(c.el.querySelector('.key__t b'), d.v());
    setText(c.el.querySelector('.key__x span'), x ? fmtX(x) : '—');
    setText(c.el.querySelector('.key__x small'), d.sub());
    c.el.disabled = d.k === 'box' && isTriple(pick);
    c.el.setAttribute('aria-label', d.t + ' ' + d.v() + (x ? ', pays ' + x + ' times' : ''));
    c.key = ''; paintCell(c);
  });
}
function buildDigits() {
  const box = $('dgrid');
  for (let r = 1; r <= 3; r++) {
    const lab = document.createElement('span'); lab.textContent = POS[r - 1].toUpperCase(); box.appendChild(lab);
    for (let d = 0; d <= 9; d++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'dk'; b.textContent = String(d);
      b.setAttribute('aria-label', POS[r - 1] + ' roller ' + d + ', pays 9.6 times');
      box.appendChild(b); const spot = 'd' + r + ':' + d; bindCell(b, () => spot);
    }
  }
}
function buildSums() {
  const box = $('sgrid');
  for (let s = 0; s <= 27; s++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk';
    const x = RULES.sumPay(s);
    b.innerHTML = '<b>' + s + '</b><small>' + fmtX(x) + '</small>';
    b.setAttribute('aria-label', 'Sum ' + s + ', pays ' + x + ' times');
    box.appendChild(b); const spot = 'sum:' + s; bindCell(b, () => spot);
  }
  const spec = $('spec');
  [['small', 'SMALL', '1.92× · 0–13'], ['big', 'BIG', '1.92× · 14–27'], ['odd', 'ODD', '1.92×'], ['even', 'EVEN', '1.92×'], ['triple', 'TRIPLE', 'any · 96×']].forEach(([spot, t, sub]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk';
    b.innerHTML = '<b>' + t + '</b><small>' + sub + '</small>';
    spec.appendChild(b); bindCell(b, () => spot);
  });
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
    b.hidden = (max > 0 && chipVals[i] > max + 1e-9) || (!WIDE.matches && i === 4);
  });
}

// ---------------------------------------------------------------- betting
function bettingOpen() { return !!S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function locked() { return !!(placed && placed.round === round) || placing; }
function balanceNow() { return S && S.balance != null ? S.balance : null; }
function free() { const b = balanceNow(); return b == null ? Infinity : r2(b - sum(pending)); }
function myBetsNow() { return placed && placed.round === round ? placed.bets : pending; }

function addChip(spot, el) {
  sound.play('chip');
  if (!bettingOpen()) { toast(pickOne(PH.noBet)); sound.play('error'); return; }
  if (locked()) { toast('Your bets are placed for this round.'); return; }
  if (!pending[spot] && Object.keys(pending).length >= MAX_SPOTS) { toast('Up to ' + MAX_SPOTS + ' different bets per round.'); sound.play('error'); return; }
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
  fly(center($('chips').children[chipIdx]), center(el), chipClass(amt), short(amt), 0, 260).then(paintAll);
  updateControls(); render();
}
function undo() {
  if (locked() || !stack.length) return;
  stack.pop().forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) - e.amt); if (pending[e.spot] <= 0.001) delete pending[e.spot]; });
  sound.play('chip'); paintAll(); updateControls(); render();
}
function clearBets() {
  if (locked()) return;
  const n = Object.keys(pending).length;
  pending = {}; stack = [];
  if (n) sound.play('clear');
  paintAll(); updateControls(); render();
}
function doubleBets() {
  if (locked() || !bettingOpen()) return;
  const lim = game.limit(), total = sum(pending);
  if (!total) return;
  if (lim.max > 0 && total * 2 > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (total > free() + 1e-9) { toast('Not enough balance to double.'); sound.play('error'); return; }
  const add = Object.keys(pending).map((s) => ({ spot: s, amt: pending[s] }));
  add.forEach((e) => { pending[e.spot] = r2(pending[e.spot] + e.amt); });
  stack.push(add); sound.play('chips'); paintAll(); updateControls(); render();
}
function rebet() {
  if (locked() || !bettingOpen() || !lastBets) return;
  const add = Object.keys(lastBets).map((s) => ({ spot: s, amt: lastBets[s] })), need = r2(add.reduce((t, e) => t + e.amt, 0));
  const lim = game.limit(), spots = new Set(Object.keys(pending).concat(Object.keys(lastBets)));
  if (spots.size > MAX_SPOTS) { toast('Up to ' + MAX_SPOTS + ' different bets per round.'); sound.play('error'); return; }
  if (lim.max > 0 && sum(pending) + need > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (need > free() + 1e-9) { toast('Not enough balance to repeat.'); sound.play('error'); return; }
  add.forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) + e.amt); });
  stack.push(add); sound.play('chips'); paintAll(); updateControls(); render();
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
    safeSS(KEY + ':placed', placed);
    lastBets = snap; pending = {}; stack = [];
    paintAll();
    sound.play('placed');
    setStatus('placed', auto ? 'Your chips are in — good luck!' : 'Bets accepted — good luck!');
    updateControls(); render();
  }).catch(() => { placing = false; updateControls(); render(); });
}

function paintCell(c) {
  const s = c.spot(), bets = myBetsNow(), amt = s ? bets[s] || 0 : 0;
  const key = s + ':' + amt;
  if (key === c.key) return;
  c.key = key;
  c.el.classList.toggle('has', amt > 0);
  if (amt > 0) { c.chip.hidden = false; c.chip.className = 'bchip ' + chipClass(amt); c.chip.textContent = short(amt); }
  else c.chip.hidden = true;
}
function paintAll() { CELLS.forEach((c) => { c.key = ''; paintCell(c); }); paintSlip(); }

function paintSlip() {
  const bets = myBetsNow(), spots = Object.keys(bets), done = resultRound === round && landedRound === round && placed && placed.round === round;
  const out = done ? S.result || { digits: landedDigits } : null;
  const html = spots.map((s) => {
    let cls = 'tk' + (placed && placed.round === round ? ' tk--placed' : ''), val = money(bets[s]);
    if (out) { const x = RULES.pay(out, s); if (x > 0) { cls += ' tk--won'; val = '+' + money(r2(bets[s] * x)); } else cls += ' tk--lost'; }
    return '<span class="' + cls + '">' + esc(spotLabel(s)) + ' <b>' + val + '</b></span>';
  }).join('') || '<span class="slip__empty">' + (bettingOpen() ? 'Tap a bet — your slip shows here' : 'Your bets for the next draw show here') + '</span>';
  if ($('slip').innerHTML !== html) $('slip').innerHTML = html;
}

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
    const nb = Object.keys(placed.bets).length;
    if (wonRound === round && landedRound === round) { place.classList.add('place--won'); label = 'You won ' + money(placed.win || 0); sub = 'next draw soon'; }
    else { place.classList.add('place--done'); label = (S.phase === 'betting' ? 'Bets placed · ' : 'Locked · ') + money(placed.total); sub = nb + (nb === 1 ? ' bet' : ' bets') + (S.phase === 'betting' ? ' · good luck!' : ' · drawing'); }
  } else if (open && n) { place.disabled = false; label = 'Place bets'; sub = n + (n === 1 ? ' bet · ' : ' bets · ') + money(total); }
  else if (open) { place.disabled = true; label = 'Tap a bet'; sub = 'chip ' + money(chipVals[chipIdx]); }
  else { place.disabled = true; label = S.phase === 'betting' || S.phase === 'dealing' ? 'No more bets' : 'Next draw soon'; }
  setText($('placeLabel'), label); setText($('placeSub'), sub);
  const con = $('board');
  con.classList.toggle('console--closed', !open || lock);
  con.classList.toggle('console--result', resultRound === round && landedRound === round);
}

// ---------------------------------------------------------------- chip flights (transform / opacity only)
function center(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function fly(from, to, cls, label, delay, dur, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'fchip ' + cls; el.textContent = label || '';
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
  round = S.round; lastTick = -1;
  if (placed && placed.round !== round) placed = null;
  pending = {}; stack = [];
  landedDigits = [null, null, null]; startedLand = [0, 0, 0];
  clearHighlights();
  if (scene) { scene.win(false); scene.unlock(); }
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
    const rack = center($('chips'));
    back.forEach((s, i) => { const c = CELLS.find((x) => x.spot() === s); if (c) fly(center(c.el), rack, chipClass(pending[s]), short(pending[s]), i * 40, 380, { fadeOut: true }); });
    pending = {}; stack = []; paintAll();
  }
  drawPill(0);
  if (scene) scene.spin();
  updateControls(); render();
}
function drawPill(n) { $('drawpill').hidden = false; setText($('drawText'), 'DRAWING ' + n + '/3'); }

function onDeal(step) {
  if (!step || step.kind !== 'digit' || step.value == null) return;
  const r = step.round, i = step.step != null ? step.step : (S.deals || []).filter((x) => x.kind === 'digit').length - 1;
  if (r !== round) round = r;
  if (closedRound !== r) closeRound();
  startLanding(r, i, step.value, LAND_S[i] || 1.4);
}
function startLanding(r, i, d, seconds) {
  if (startedLand[i] === r || !scene) return;
  startedLand[i] = r;
  if (!scene.spinning(i)) scene.spin([i]);
  scene.onLanded(i, () => rollerLanded(r, i, d));
  scene.land(i, d, { seconds });
}
function rollerLanded(r, i, d) {
  if (r !== round) return;
  landedDigits[i] = d;
  sound.play('lock', i === 2);
  const n = landedDigits.filter((x) => x != null).length;
  CELLS.forEach((c) => { if (c.spot() === 'd' + (i + 1) + ':' + d) c.el.classList.add('drawn'); });
  if (n < 3) { drawPill(n); setStatus('rolling', i === 0 ? '1st roller locked on ' + d + '… two to go' : '2nd roller locked on ' + d + '… one to go'); return; }
  allLanded(r);
}
function outcomeOf(d) { return { digits: d.slice(), total: d[0] + d[1] + d[2] }; }
function myWin(out) {
  if (!placed || placed.round !== round) return null;
  let w = 0;
  for (const s in placed.bets) w += r2(placed.bets[s] * RULES.pay(out, s));
  w = r2(w);
  if (placed.maxWin > 0 && w > placed.maxWin) { placed.capped = true; w = placed.maxWin; }
  return w;
}
function allLanded(r) {
  landedRound = r;
  $('drawpill').hidden = true;
  const out = outcomeOf(landedDigits), num = landedDigits.join('');
  if (scene) scene.win(true);
  markBoard(out);
  const w = myWin(out);
  if (w != null) {
    placed.win = w;
    if (w > 0) {
      wonRound = r;
      showBanner(r, w, out);
      setStatus('win', num + ' — ' + pickOne(PH.win));
      sound.play('win', w >= placed.total * 10);
    } else { setStatus('lose', num + ' it is. ' + pickOne(PH.lose)); sound.play('lose'); }
  } else setStatus('result', 'The number is ' + num + ' · sum ' + out.total);
  resultRound = r;
  paintSlip(); updateControls(); render();
}
function markBoard(out) {
  const bets = placed && placed.round === round ? placed.bets : {};
  const tabWin = { number: 0, digits: 0, sum: 0 };
  CELLS.forEach((c) => {
    const s = c.spot(); if (!s) return;
    const x = RULES.pay(out, s), mine = bets[s] || 0;
    c.el.classList.toggle('won', x > 0 && mine > 0);
    c.el.classList.toggle('drawn', x > 0 && !mine);
    c.el.classList.toggle('lost', mine > 0 && !x);
    let tag = c.el.querySelector('.wtag');
    if (x > 0 && mine > 0) { if (!tag) { tag = document.createElement('span'); tag.className = 'wtag'; c.el.appendChild(tag); } tag.textContent = '+' + money(r2(mine * x)); }
    else if (tag) tag.remove();
  });
  for (const s in bets) { const x = RULES.pay(out, s); if (x > 0) tabWin[spotTab(s)] += r2(bets[s] * x); }
  document.querySelectorAll('.tab').forEach((t) => { const w = tabWin[t.dataset.tab], b = t.querySelector('.tab__win'); b.hidden = !(w > 0); if (w > 0) b.textContent = '+' + money(r2(w)); });
}
function clearHighlights() {
  $('banner').hidden = true;
  CELLS.forEach((c) => { c.el.classList.remove('won', 'drawn', 'lost'); const t = c.el.querySelector('.wtag'); if (t) t.remove(); });
  document.querySelectorAll('.tab__win').forEach((b) => { b.hidden = true; });
}

function onResult(d) {
  const o = d.outcome || {};
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, digits: o.digits };
  if (placed && placed.round === S.round) {
    if (placed.restored) setTimeout(refreshBalance, 800); // reloaded mid-round: the client has no record of this bet
    safeSS(KEY + ':placed', null);
    const my = S.myBets[0];
    if (my && my.round === S.round) placed.win = my.win; // the client's settlement (capped like the engine)
  }
  if (landedRound !== S.round && o.digits && o.digits.length === 3) {
    round = S.round;
    closedRound = round;
    // rollers still spinning: land them now (a missed step); never spun (tab hidden / joined late): show
    let anyLanding = false;
    for (let i = 0; i < 3; i++) {
      if (landedDigits[i] != null) continue;
      if (startedLand[i] === round) { anyLanding = true; continue; }
      if (scene && scene.spinning(i)) { anyLanding = true; startLanding(round, i, o.digits[i], 1 + 0.25 * i); }
    }
    if (!anyLanding) {
      if (scene) scene.show(o.digits, true);
      landedDigits = o.digits.slice();
      allLanded(round);
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
function showBanner(r, win, out) {
  if (bannerRound === r) return;
  bannerRound = r;
  setText($('bannerTitle'), out.digits.join(' · ') + ' · you win');
  setText($('bannerWin'), money(win));
  const lines = Object.keys(placed.bets).map((s) => [s, RULES.pay(out, s)]).filter((e) => e[1] > 0)
    .map((e) => '<span>' + esc(spotLabel(e[0])) + ' <b>+' + money(r2(placed.bets[e[0]] * e[1])) + '</b></span>');
  if (placed.capped) lines.push('<span>Max win per round <b>' + money(placed.maxWin) + '</b></span>');
  $('bannerLines').innerHTML = lines.slice(0, 4).join('');
  const b = $('banner');
  b.hidden = false; b.classList.remove('banner--in'); void b.offsetWidth; b.classList.add('banner--in');
  clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, 4800);
  const bal = $('balance'); bal.classList.add('bump'); setTimeout(() => bal.classList.remove('bump'), 500);
}

// ---------------------------------------------------------------- per frame: timer, auto-send, close
let lastPauseAt = 0, phaseSeen = '';
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
    if (S.phase === 'pause' && /^(result|win|lose)$/.test(statusKey) && now - lastPauseAt > 2600) setStatus('wait');
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '', playersStrip = null;
function visibleHistory() { return S.history.filter((h) => h.outcome && h.outcome.digits && !(h.round === round && landedRound < round)); }
function render() {
  if (!S || !started) return;
  if (S.phase !== phaseSeen) { phaseSeen = S.phase; if (S.phase === 'pause') lastPauseAt = Date.now(); }
  let bal = S.balance;
  if (bal != null && Object.keys(pending).length && !placing) bal = r2(bal - sum(pending)); // chips on the console, not sent yet
  setText($('balance'), bal == null ? '—' : money(bal));
  setText($('mode'), S.demo ? 'Demo' : 'Balance');
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  setText($('fRound'), S.round ? String(S.round) : '—');
  setText($('fHash'), S.hash || '—');
  setText($('fSeed'), lastSeed && lastSeed.round === landedRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the round' : '—'));
  const hist = visibleHistory(), hk = hist.length + ':' + (hist[0] && hist[0].round);
  if (hk !== histKey) { histKey = hk; renderHistory(hist); renderHeat(hist); }
  renderList();
  paintSlip();
  updateControls();
  if (!playersStrip && window.NXPlayers && !WIDE.matches) playersStrip = window.NXPlayers.create($('stage'), { face: avatar });
  if (playersStrip) playersStrip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(name) { return NXPlayers.face(name, 'av', 'span'); } // a player's face (../_core/players.js)
function renderHistory(hist) {
  $('history').innerHTML = hist.slice(0, 24).map((h, i) => '<span class="hr' + (i === 0 && h.round === landedRound ? ' hr--new' : '') + '" title="Round ' + h.round + '"><span>' +
    h.outcome.digits.map((d) => '<i>' + d + '</i>').join('') + '</span><em>Σ' + (h.outcome.total != null ? h.outcome.total : h.outcome.digits.reduce((a, b) => a + b, 0)) + '</em></span>').join('') ||
    '<span class="hr hr--empty">Results appear here</span>';
}
function renderHeat(hist) {
  const c = [0, 1, 2].map(() => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  hist.forEach((h) => h.outcome.digits.forEach((d, i) => { c[i][d]++; }));
  setText($('statN'), String(hist.length));
  const max = Math.max(1, ...c.flat());
  $('heat').innerHTML = c.map((row, i) => '<span>' + POS[i].toUpperCase() + '</span>' + row.map((v, d) => '<span class="hb" title="' + POS[i] + ' roller: ' + d + ' × ' + v + '"><i style="height:' + Math.round(3 + (v / max) * 21) + 'px"></i><em>' + d + '</em></span>').join('')).join('');
}
function betsText(bets) { const l = (bets || []).map((b) => spotLabel(b.spot)); return l.length > 2 ? l.slice(0, 2).join(' · ') + ' +' + (l.length - 2) : l.join(' · ') || '—'; }
function renderList() {
  let rows, cols, count;
  if (listTab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && landedRound >= S.round;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + '"><span>' + esc(b.player || 'Player') + '</span><span>' + esc(betsText(b.bets)) + '</span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Bets this round');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === round && landedRound < round));
    cols = '<span>Round</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => '<div class="row"><span>#' + m.round + ' <b class="row__res">' + (m.outcome && m.outcome.digits ? m.outcome.digits.join('') : '') + '</b></span><span>' + esc(betsText(m.bets)) + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>');
    setText($('countLabel'), 'My rounds');
  }
  const key = listTab + '|' + rows.join('');
  if (key === listKey) return;
  listKey = key;
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
      const L = side.right - sr.left + 10, T = top.bottom - sr.top + 4;
      A = { L, T, W: sr.width - L - 10, H: Math.max(160, tw.top - sr.top - T - 6) };
    } else {
      const hb = hist.getBoundingClientRect(), T = top.bottom - sr.top + 2;
      A = { L: 0, T, W: sr.width, H: Math.max(150, hb.top - sr.top - T - 2) };
    }
    const play = $('play');
    play.style.left = A.L + 'px'; play.style.top = A.T + 'px'; play.style.width = A.W + 'px'; play.style.height = A.H + 'px';
    stage.style.setProperty('--below', Math.max(0, sr.height - A.T - A.H) + 'px');
    stage.style.setProperty('--left', A.L + 'px');
    paintChips();
    if (scene) scene.resize(sr.width, sr.height, A);
    if (scene && !readySent) { readySent = true; requestAnimationFrame(() => { game.ready(); game.theme(scene.topColor); }); }
  });
}

// ---------------------------------------------------------------- wiring
function setTab(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('tab--on', x.dataset.tab === t); x.setAttribute('aria-selected', x.dataset.tab === t ? 'true' : 'false'); });
  document.querySelectorAll('.sec').forEach((x) => x.classList.toggle('sec--on', x.dataset.sec === t));
}
function wire() {
  $('back').addEventListener('click', () => game.back());
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', clearBets);
  $('double').addEventListener('click', doubleBets);
  $('rebet').addEventListener('click', rebet);
  $('action').addEventListener('click', () => submit(false));
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { sound.play('chip'); setTab(b.dataset.tab); }));
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
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: KEY, gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const d = res[1].outcome.digits.join('');
    out.innerHTML = 'Round ' + L.round + ': number <b>' + d + '</b>. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (!L.digits || d === L.digits.join('') ? '✓ same number as drawn' : '✗ number differs');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

// after a reconnect: events may have been missed — catch up without restarting what is on screen
let wasConnected = null, reconnectedAt = 0;
function catchUp() {
  if (S.round !== round) { reconnectedAt = 0; clearHighlights(); landedDigits = [null, null, null]; startedLand = [0, 0, 0]; if (placed && placed.round !== S.round) placed = null; syncFromSnapshot(); return; }
  if (S.phase === 'dealing') {
    if (closedRound !== round) closeRound();
    (S.deals || []).filter((x) => x.kind === 'digit' && x.value != null).forEach((st, i) => startLanding(round, st.step != null ? st.step : i, st.value, 1.1));
  } else if ((S.phase === 'result' || S.phase === 'pause') && S.result && landedRound !== round) onResult({ outcome: S.result });
}

// show digits: rollers that are still spinning (a missed draw after a reconnect) slow down onto them, the rest are set
function settleTo(d, lockedNow) {
  if (!scene.spinning()) { scene.show(d, lockedNow); return; }
  for (let i = 0; i < 3; i++) {
    if (scene.spinning(i)) { scene.onLanded(i, () => { if (!lockedNow) scene.unlock(); }); scene.land(i, d[i], { seconds: 0.9 + 0.2 * i }); }
    else scene.show([i === 0 ? d[0] : null, i === 1 ? d[1] : null, i === 2 ? d[2] : null], lockedNow);
  }
}

// first snapshot: put the machine in the state the round is in (joining mid-round, reloads)
function syncFromSnapshot() {
  started = true;
  round = S.round;
  const last = S.history[0], lastD = last && last.outcome && last.outcome.digits;
  const stored = safeSS(KEY + ':placed');
  if (stored && stored.round === S.round && (S.phase === 'betting' || S.phase === 'dealing')) { placed = stored; placed.restored = true; }
  if (S.phase === 'dealing') {
    closedRound = round;
    const steps = (S.deals || []).filter((x) => x.kind === 'digit' && x.value != null);
    setStatus('closed');
    const shown = [0, 1, 2].map((i) => (steps[i] ? steps[i].value : lastD ? lastD[i] : 0));
    if (scene) {
      scene.show(shown, [0, 1, 2].map((i) => !!steps[i]));
      const spinning = [0, 1, 2].filter((i) => !steps[i]);
      if (spinning.length) scene.spin(spinning);
    }
    steps.forEach((st, i) => { landedDigits[i] = st.value; startedLand[i] = round; CELLS.forEach((c) => { if (c.spot() === 'd' + (i + 1) + ':' + st.value) c.el.classList.add('drawn'); }); });
    drawPill(steps.length);
    if (steps.length === 3) allLanded(round);
  } else if (S.phase === 'betting') {
    if (lastD && scene) settleTo(lastD, false);
    setStatus('betting');
    if (Date.now() >= S.endsAt) closeRound();
  } else {
    const d = S.result && S.result.digits ? S.result.digits : lastD;
    if (d && scene) { settleTo(d, true); scene.win(true); landedDigits = d.slice(); landedRound = resultRound = S.round; markBoard(outcomeOf(d)); }
    setStatus('wait');
  }
  paintAll(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
const SUMPAY = (s) => { const w = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 63, 69, 73, 75]; return Math.floor(96000 / w[s <= 13 ? s : 27 - s]) / 100; };
RULES.sumPay = SUMPAY;
RULES.pay = (o, s) => (game ? game.pay(o, s) : 0);
buildPicker(); buildKeys(); buildDigits(); buildSums(); buildChips(); wire();
paintPicker(null);
setStatus('wait');
game = window.NXTable.start({
  event: EVENT, game: KEY,
  onChange() {
    S = game ? game.S : S;
    if (!S) return;
    if (scene && S.gotSnapshot && S.phase !== 'waiting' && (!started || syncedEarly)) { syncedEarly = false; syncFromSnapshot(); }
    else if (started && wasConnected === false && S.connected && S.gotSnapshot) { reconnectedAt = Date.now(); }
    if (reconnectedAt && started && S.gotSnapshot && S.phase !== 'waiting' && Date.now() - reconnectedAt < 8000) catchUp();
    wasConnected = S.connected;
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
createScene($('scene'), { tick: (speed) => sound.play('tick', speed) }).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  sc.show([pick[0], pick[1], pick[2]], false);
  window.__tr = { scene: sc, game, state: () => ({ round, closedRound, landedRound, resultRound, landedDigits, startedLand, started, placed, pending }) }; // QA hook
  layout();
  if (!started && S && S.gotSnapshot && S.phase !== 'waiting') syncFromSnapshot();
});
setTimeout(() => { if (!started && scene) { syncedEarly = true; syncFromSnapshot(); } }, 5000); // no live state yet: show the machine, sync when it arrives
layout();
requestAnimationFrame(tick);
if (/[?&]fps=1/.test(location.search)) { // on-device check: ?fps=1 shows the frame rate
  const el = document.createElement('div'); el.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99;padding:3px 7px;border-radius:6px;background:#000a;font:700 11px monospace;color:#7f7;pointer-events:none';
  document.body.appendChild(el); let n = 0, t = performance.now(), worst = 0, last = t;
  (function f(now) { n++; worst = Math.max(worst, now - last); last = now; if (now - t >= 1000) { el.textContent = Math.round((n * 1000) / (now - t)) + ' fps · worst ' + Math.round(worst) + ' ms'; n = 0; t = now; worst = 0; } requestAnimationFrame(f); })(t);
}
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#130a29'); } }, 6000);
