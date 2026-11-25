/* Orbit 36 (88.0099) — a lotto 6/36 draw every 30 s, shared by every player (engine draw game
 * "orbit36": nexorng-engine/internal/tables/orbit36.go; client rules: rules.js).
 *   15 s betting → 10 s draw (6 balls at 0.8, 2.0 … 6.8 s after the draw starts, the bonus ball at
 *   8.2 s; each one rises out of the drum, shows big, then settles in its cup) → 5 s result.
 * Tickets (6 numbers each, up to 10) and first-ball side bets are sent in ONE bet call (Bet, or
 * automatically 1.5 s before betting closes when the slip was changed in this window). Tickets
 * stay on the slip for the next draws. Settlement and the socket live in ../_core/table-client.js;
 * this file is the slip, the round choreography and the layout; scene.js is the 3D draw machine.
 */
import { create as createScene, colorOf } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0099';
const BETTING_MS = 15000;
const AUTO_SEND_MS = 1500;
const MAX_TICKETS = 10;
const QUICK_X = [1, 2, 5, 10];
const STEP_X = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const SIDES = [['odd', 'ODD'], ['even', 'EVEN'], ['low', '1–18'], ['high', '19–36']];
const PAYS = [[6, false, 50000], [5, true, 12000], [5, false, 1000], [4, false, 80], [3, false, 8], [2, false, 1]];
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PH = {
  betting: ['Pick your six — the drum is spinning', 'Bets are open — fill your tickets', 'Six numbers, one orbit', 'Which six will fly tonight?', 'Quick pick or lucky numbers?', 'The drum is warming up — pick your six'],
  last: ['Last call — place your tickets', 'Closing soon', 'Final seconds to bet'],
  closed: ['No more bets — here they come!', 'The drum is at full spin…', 'Bets closed — watch the balls fly', 'Here comes the first ball…'],
  wait: ['Next draw soon', 'Get your tickets ready', 'A new draw is coming up', 'The drum is resetting'],
  win: ['Winning ticket!', 'Your numbers came up!', 'That’s a hit!', 'Nicely picked!'],
  lose: ['Not this time — next draw soon', 'So close — the drum spins again soon', 'Your tickets stay ready for the next draw'],
  noBet: ['Bets are closed — your slip goes to the next draw', 'Wait for the next draw'],
};

// ---------------------------------------------------------------- state
const sound = window.O36Audio.create();
let scene = null, game = null, S = null;
let minBet = 0.1, maxBet = 0;
let tickets = [], cur = 0, sides = {}, sideAmt = 0.1;
let placed = null, placing = false, queued = false, armed = 0;
let round = 0, closedRound = 0, lastTick = -1, started = false, readySent = false, syncedEarly = false, tab = 'all';
let drawRound = 0, drawn = [], bonusBall = null, landed = 0, landedBonus = false, pendingResult = null, resultShown = 0, lastSeed = null;
const CELL = [], SIDE_A = {}, SIDE_B = {};

function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function safeLS(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function spotOf(nums) { return 't:' + nums.slice().sort((a, b) => a - b).join(','); }
let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
let statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  setText($('status'), text || pick(PH[key] || ['']));
}
function rand36() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % 36; }

// ---------------------------------------------------------------- the slip (persisted)
function saveSlip() { safeLS('orbit36:slip', { tickets: tickets.map((t) => ({ nums: t.nums, amt: t.amt })), cur, sides, sideAmt }); }
function loadSlip() {
  const s = safeLS('orbit36:slip');
  if (s && Array.isArray(s.tickets) && s.tickets.length) {
    tickets = s.tickets.slice(0, MAX_TICKETS).map((t) => ({ nums: (t.nums || []).filter((n) => n >= 1 && n <= 36).slice(0, 6).sort((a, b) => a - b), amt: Number(t.amt) || 0.1 }));
    cur = Math.min(Math.max(0, s.cur | 0), tickets.length - 1);
    sides = {}; for (const k in (s.sides || {})) if (SIDES.some((x) => x[0] === k) && s.sides[k] > 0) sides[k] = Number(s.sides[k]);
    sideAmt = Number(s.sideAmt) || 0.1;
  } else { tickets = [{ nums: [], amt: 0.1 }]; cur = 0; }
}
function ladder() {
  const out = STEP_X.map((x) => r2(minBet * x)).filter((v) => !maxBet || v <= maxBet + 1e-9);
  return out.length ? out : [minBet];
}
function clampAmt(v) { let a = Math.max(minBet, r2(v)); if (maxBet > 0) a = Math.min(a, maxBet); return a; }

function lockedSlip() { return placing || !!(placed && placed.round === round && S && S.phase !== 'pause') || !!(placed && placed.round === round && resultShown !== round); }
function bettingOpen() { return !!S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function touched() { if (bettingOpen()) armed = round; }

function toggleNum(n) {
  if (lockedSlip()) { toast('Your tickets are in this draw — edit them for the next one.'); sound.play('soft'); return; }
  const t = tickets[cur], i = t.nums.indexOf(n);
  if (i >= 0) t.nums.splice(i, 1);
  else {
    if (t.nums.length >= 6) { toast('A ticket has 6 numbers — tap one to change it.'); sound.play('soft'); return; }
    t.nums.push(n); t.nums.sort((a, b) => a - b);
  }
  sound.play('pick', 0, 0.9 + t.nums.length * 0.05);
  queued = queued && valid().ok; touched(); saveSlip(); paintSlip();
}
let qpTimer = 0;
function quickPick() {
  if (lockedSlip()) { toast('Your tickets are in this draw — edit them for the next one.'); sound.play('soft'); return; }
  clearTimeout(qpTimer);
  const set = new Set();
  while (set.size < 6) set.add(rand36() + 1);
  const nums = [...set];
  tickets[cur].nums = [];
  let i = 0;
  const add = () => {
    if (lockedSlip()) return;
    tickets[cur].nums.push(nums[i]); tickets[cur].nums.sort((a, b) => a - b);
    sound.play('pick', 0, 0.95 + i * 0.06);
    paintSlip();
    if (++i < 6) qpTimer = setTimeout(add, 70); else { saveSlip(); }
  };
  touched(); add();
}
function clearTicket() {
  if (lockedSlip()) return;
  if (!tickets[cur].nums.length && tickets.length > 1) { removeTicket(cur); return; }
  tickets[cur].nums = []; sound.play('clear'); touched(); saveSlip(); paintSlip();
}
function newTicket() {
  if (lockedSlip()) return;
  if (tickets.length >= MAX_TICKETS) { toast('Up to ' + MAX_TICKETS + ' tickets per draw.'); sound.play('soft'); return; }
  const empty = tickets.findIndex((t) => !t.nums.length);
  if (empty >= 0) { cur = empty; paintSlip(); return; }
  tickets.push({ nums: [], amt: tickets[cur] ? tickets[cur].amt : minBet }); cur = tickets.length - 1;
  sound.play('chip'); saveSlip(); paintSlip();
}
function removeTicket(i) {
  if (lockedSlip() || tickets.length <= 1) return;
  tickets.splice(i, 1); cur = Math.min(cur, tickets.length - 1);
  sound.play('clear'); touched(); saveSlip(); paintSlip();
}
function setTicketAmt(v) {
  if (lockedSlip()) return;
  tickets[cur].amt = clampAmt(v); touched(); saveSlip(); paintSlip(); sound.play('chip');
}
function stepTicket(dir) {
  const L = ladder(), a = tickets[cur].amt;
  let i = L.findIndex((x) => x >= a - 1e-9); if (i < 0) i = L.length - 1;
  if (dir > 0) i = L[i] > a + 1e-9 ? i : Math.min(L.length - 1, i + 1); else i = Math.max(0, (L[i] > a + 1e-9 ? i : i) - 1);
  setTicketAmt(L[i]);
}
function toggleSide(k, amt) {
  if (lockedSlip()) { toast('Your bets are in this draw.'); sound.play('soft'); return; }
  if (sides[k]) delete sides[k]; else sides[k] = clampAmt(amt);
  sound.play('chip'); touched(); saveSlip(); paintSlip();
}
function setSideAmt(v) {
  if (lockedSlip()) return;
  sideAmt = clampAmt(v);
  for (const k in sides) sides[k] = sideAmt; // panel B: one stake for its side bets
  touched(); saveSlip(); paintSlip(); sound.play('chip');
}
function stepSide(dir) {
  const L = ladder();
  let i = L.findIndex((x) => x >= sideAmt - 1e-9); if (i < 0) i = L.length - 1;
  if (dir > 0) i = L[i] > sideAmt + 1e-9 ? i : Math.min(L.length - 1, i + 1); else i = Math.max(0, i - 1);
  setSideAmt(L[i]);
}

// the bets the slip would send, or why not. skipPartial (auto-send): tickets without 6 numbers are
// left out (they stay on the slip, unsent); a Bet press asks for them to be finished instead.
function valid(skipPartial) {
  const full = tickets.filter((t) => t.nums.length === 6), part = skipPartial ? -1 : tickets.findIndex((t) => t.nums.length > 0 && t.nums.length < 6);
  const bets = full.map((t) => ({ spot: spotOf(t.nums), amount: t.amt }));
  for (const k in sides) bets.push({ spot: k, amount: sides[k] });
  const total = r2(bets.reduce((s, b) => s + b.amount, 0));
  const out = { ok: false, bets, total, tickets: full.length, why: '' };
  if (part >= 0) { out.why = 'Pick ' + (6 - tickets[part].nums.length) + ' more on T' + (part + 1); return out; }
  if (!bets.length) { out.why = 'Pick 6 numbers'; return out; }
  const seen = new Set();
  for (const b of bets) { if (seen.has(b.spot)) { out.why = 'Two tickets have the same numbers'; return out; } seen.add(b.spot); }
  if (total < minBet - 1e-9) { out.why = 'Minimum ' + money(minBet) + ' per draw'; return out; }
  if (maxBet > 0 && total > maxBet + 1e-9) { out.why = 'Max ' + money(maxBet) + ' per draw'; return out; }
  const bal = S && S.balance != null ? S.balance : null;
  if (bal != null && total > bal + 1e-9) { out.why = 'Not enough balance'; out.funds = true; return out; }
  out.ok = true; return out;
}

function submit(auto) {
  if (placing || (placed && placed.round === round)) return;
  const v = valid(!!auto);
  const partial = tickets.map((t, i) => (t.nums.length > 0 && t.nums.length < 6 ? 'T' + (i + 1) : null)).filter(Boolean);
  if (auto && partial.length) toast(partial.join(', ') + (partial.length > 1 ? ' are' : ' is') + ' not complete — not sent, still on your slip.');
  if (!v.ok) { if (!auto) { toast(v.why); sound.play('soft'); } return; }
  if (!bettingOpen() && !auto) { queued = !queued; paintSlip(); if (queued) { toast('Your slip goes to the next draw.'); sound.play('chip'); } return; }
  const r = round, snap = { tickets: tickets.filter((t) => t.nums.length === 6).map((t) => ({ nums: t.nums.slice(), amt: t.amt, id: tickets.indexOf(t) + 1 })), sides: Object.assign({}, sides) };
  placing = true; queued = false; paintSlip();
  game.bet(v.bets).then((res) => {
    placing = false;
    placed = { round: r, bets: v.bets, total: v.total, snap, maxWin: res && res.maxWin != null ? Number(res.maxWin) : null };
    if (placed.maxWin > 0) setText($('rMaxWin'), money(placed.maxWin));
    safeSS('orbit36:placed', placed);
    sound.play('chips');
    setStatus('placed', auto ? 'Your tickets are in — good luck!' : 'Bets accepted — good luck!');
    paintSlip(); render();
  }).catch(() => { placing = false; paintSlip(); render(); });
}

// ---------------------------------------------------------------- build once
function buildGrid() {
  const box = $('grid');
  for (let n = 1; n <= 36; n++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cell'; b.style.setProperty('--c', colorOf(n));
    b.setAttribute('aria-label', 'Number ' + n);
    b.innerHTML = '<span>' + n + '</span><i class="cell__ok">' + CHECK + '</i>';
    b.addEventListener('click', () => toggleNum(n));
    box.appendChild(b);
    CELL[n] = { el: b, key: '' };
  }
}
function buildSides() {
  for (const [boxId, map, fromB] of [['sidesA', SIDE_A, false], ['sidesB', SIDE_B, true]]) {
    const box = $(boxId);
    SIDES.forEach(([k, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'side-t';
      b.setAttribute('aria-label', 'First ball ' + label + ', pays 1.92 times');
      b.innerHTML = '<b>' + label + '</b><small>1.92×</small><span class="side-t__chip" hidden></span>';
      b.addEventListener('click', () => toggleSide(k, fromB ? sideAmt : tickets[cur].amt));
      box.appendChild(b);
      map[k] = { el: b, chip: b.querySelector('.side-t__chip'), key: '' };
    });
  }
}
function buildStake(boxId, label, onStep, onQuick) {
  const box = $(boxId);
  box.innerHTML = '<div class="stepper"><button type="button" aria-label="Less">−</button><div class="stepper__v"><small>' + label + '</small><b>—</b></div><button type="button" aria-label="More">+</button></div><div class="quick"></div>';
  const [minus, plus] = box.querySelectorAll('.stepper button');
  minus.addEventListener('click', () => onStep(-1)); plus.addEventListener('click', () => onStep(1));
  const q = box.querySelector('.quick');
  QUICK_X.forEach((x) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.x = x; b.addEventListener('click', () => onQuick(r2(minBet * x))); q.appendChild(b); });
  return { minus, plus, v: box.querySelector('.stepper__v b'), quick: [...q.children] };
}
let stakeA = null, stakeB = null;
function buildPays() {
  $('paytable').innerHTML = '<div class="pt__h">Pays × stake</div>' + PAYS.map(([m, b, x], i) => '<div class="pt__row" data-i="' + i + '"><span class="pt__m"><small>match</small>' + m + (b ? ' +' + STAR : '') + '</span><span class="pt__x">' + x.toLocaleString('en-US') + '×</span></div>').join('') +
    '<div class="pt__foot">2 matches = stake back · ' + STAR + ' = bonus ball (7th) · first ball odd / even / low / high pays 1.92×</div>';
  $('paystrip').innerHTML = PAYS.map(([m, b, x], i) => '<div class="ps__cell" data-i="' + i + '"><span class="ps__m">' + m + (b ? ' +' + STAR : '') + '</span><span class="ps__x">' + x.toLocaleString('en-US') + '×</span></div>').join('');
}
function payRows(i) { // highlight the paid tier (-1: none)
  document.querySelectorAll('.pt__row, .ps__cell').forEach((el) => el.classList.toggle('hit', Number(el.dataset.i) === i));
}

// ---------------------------------------------------------------- paint the slip (class toggles only)
function hitsOf(nums) { return nums.filter((n) => drawn.includes(n)).length; }
function myRound() { return placed && placed.round === round ? placed : null; }
function paintSlip() {
  if (!S) return;
  const lock = lockedSlip(), mine = myRound(), live = drawRound === round && drawn.length > 0;
  $('slipA').classList.toggle('slip--locked', lock);
  // tickets row
  const showT = mine ? mine.snap.tickets : null;
  const t = tickets[cur];
  const html = tickets.map((tk, i) => {
    const pl = showT && showT.find((x) => spotOf(x.nums) === spotOf(tk.nums) && tk.nums.length === 6);
    const h = pl && live ? hitsOf(tk.nums) : 0;
    const nn = tk.nums.length ? tk.nums.map((n) => (pl && live && drawn.includes(n) ? '<b>' + n + '</b>' : n)).join('·') : '<i>empty</i>';
    let tail = (tk.nums.length > 0 && tk.nums.length < 6 ? '<span class="tkt__cnt">' + tk.nums.length + '/6</span>' : '') + '<span class="tkt__eu">' + money(tk.amt) + '</span>';
    if (pl && resultShown === round && pl.win > 0) tail = '<span class="tkt__win">+' + money(pl.win) + '</span>';
    else if (pl && live && h) tail = '<span class="tkt__hits">' + h + ' hit' + (h > 1 ? 's' : '') + '</span>';
    const x = !lock && tickets.length > 1 && i === cur ? '<span class="tkt__x" data-x="' + i + '" aria-label="Remove ticket">×</span>' : '';
    return '<button type="button" class="tkt' + (i === cur ? ' tkt--on' : '') + '" data-i="' + i + '"><span class="tkt__id">T' + (i + 1) + '</span><span class="tkt__nn">' + nn + '</span>' + tail + x + '</button>';
  }).join('') + (!lock && tickets.length < MAX_TICKETS ? '<button type="button" class="tkt tkt--add" data-add="1">+ New</button>' : '');
  const box = $('tickets');
  if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; const on = box.querySelector('.tkt--on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  setText($('tktName'), 'T' + (cur + 1));
  setText($('cntN'), t.nums.length + '/6');
  [...$('cntDots').children].forEach((d, i) => d.classList.toggle('on', i < t.nums.length));
  // grid
  const placedCur = mine && t.nums.length === 6 && mine.snap.tickets.some((x) => spotOf(x.nums) === spotOf(t.nums));
  for (let n = 1; n <= 36; n++) {
    const sel = t.nums.includes(n), dr = live && (drawn.includes(n) || (bonusBall === n && landedBonus));
    const hit = sel && placedCur && live && drawn.includes(n);
    const key = (sel ? 's' : '') + (hit ? 'h' : dr ? 'd' : '');
    const c = CELL[n];
    if (c.key === key) continue;
    c.key = key;
    c.el.classList.toggle('cell--sel', sel); c.el.classList.toggle('cell--hit', hit); c.el.classList.toggle('cell--drawn', dr && !hit);
  }
  // side tiles
  const first = live ? drawn[0] : null, sidesShown = mine ? mine.snap.sides : sides;
  for (const [k] of SIDES) {
    const amt = sidesShown[k] || 0;
    const won = mine && amt && first != null && window.NXTable.rules.shared.orbit36.pay({ balls: [first, 0, 0, 0, 0, 0], bonus: 0 }, k) > 0;
    const lost = mine && amt && first != null && !won;
    const key = amt + ':' + won + ':' + lost;
    for (const map of [SIDE_A, SIDE_B]) {
      const s = map[k];
      if (s.key === key) continue;
      s.key = key;
      s.el.classList.toggle('side-t--on', amt > 0 && !won); s.el.classList.toggle('side-t--won', !!won); s.el.classList.toggle('side-t--lost', !!lost);
      s.chip.hidden = !amt; s.chip.textContent = amt ? short(amt) : '';
    }
  }
  // stakes
  const L = ladder();
  if (stakeA) {
    setText(stakeA.v, money(t.amt));
    stakeA.minus.disabled = lock || t.amt <= L[0] + 1e-9; stakeA.plus.disabled = lock || t.amt >= L[L.length - 1] - 1e-9;
    stakeA.quick.forEach((b) => { const v = r2(minBet * Number(b.dataset.x)); setText(b, short(v, true)); b.classList.toggle('on', Math.abs(v - t.amt) < 1e-9); b.disabled = lock || (maxBet > 0 && v > maxBet + 1e-9); });
  }
  if (stakeB) {
    setText(stakeB.v, money(sideAmt));
    stakeB.minus.disabled = lock || sideAmt <= L[0] + 1e-9; stakeB.plus.disabled = lock || sideAmt >= L[L.length - 1] - 1e-9;
    stakeB.quick.forEach((b) => { const v = r2(minBet * Number(b.dataset.x)); setText(b, short(v, true)); b.classList.toggle('on', Math.abs(v - sideAmt) < 1e-9); b.disabled = lock || (maxBet > 0 && v > maxBet + 1e-9); });
  }
  $('qp').disabled = lock; $('clear').disabled = lock || (!t.nums.length && tickets.length <= 1);
  paintButtons();
}
function short(v, withCurrency) {
  if (withCurrency) return money(v).replace(/[.,]00(?!\d)/, '');
  return Number.isInteger(r2(v)) ? String(r2(v)) : r2(v).toFixed(2).replace(/^0\./, '.');
}
function paintButtons() {
  const A = $('action'), B = $('actionB'), mine = myRound(), v = valid();
  let label, sub = '', cls = '', dis = false;
  const what = (v.tickets ? v.tickets + ' ticket' + (v.tickets > 1 ? 's' : '') : '') + (Object.keys(sides).length ? (v.tickets ? ' + ' : '') + 'first ball ' + Object.keys(sides).join(' / ') : '');
  if (placing) { label = 'Placing…'; sub = money(v.total); dis = true; }
  else if (mine) {
    if (resultShown === round) {
      if (mine.win > 0) { cls = 'place--won'; label = 'Won ' + money(mine.win); sub = WIDE.matches ? 'Next draw soon' : 'Next draw soon · your tickets stay ready'; }
      else { cls = 'place--done'; label = 'No win this time'; sub = WIDE.matches ? 'Tickets stay ready' : 'Your tickets stay ready for the next draw'; }
    } else { cls = 'place--done'; label = 'In the draw · ' + money(mine.total); sub = S.phase === 'betting' ? 'Good luck!' : 'Drawing now…'; }
    dis = true;
  } else if (bettingOpen()) {
    if (v.ok) { label = 'Bet · ' + money(v.total); sub = what; }
    else { label = v.why; dis = true; sub = v.funds ? money(v.total) + ' needed' : ''; }
  } else {
    if (queued && v.ok) { cls = 'place--queued'; label = 'Queued · ' + money(v.total); sub = WIDE.matches ? 'Tap to cancel' : 'Sent when bets open · tap to cancel'; }
    else if (v.ok) { label = 'Bet next draw · ' + money(v.total); sub = what; }
    else { label = S.phase === 'betting' || S.phase === 'dealing' ? 'No more bets' : v.why; dis = true; }
  }
  for (const [btn, lab, sb] of [[A, 'placeLabel', 'placeSub'], [B, 'placeLabelB', 'placeSubB']]) {
    btn.classList.remove('place--done', 'place--won', 'place--queued'); if (cls) btn.classList.add(cls);
    btn.disabled = dis; setText($(lab), label); setText($(sb), sub);
  }
}

// ---------------------------------------------------------------- round flow
function onSignal(type, d) {
  if (type === 'betting') onBetting();
  else if (type === 'deal') onDeal(d.step);
  else if (type === 'result') onResult(d);
  else if (type === 'error') { toast(d.text); sound.play('soft'); }
}

function resetDraw(r) {
  drawRound = r; drawn = []; bonusBall = null; landed = 0; landedBonus = false; pendingResult = null;
  paintDots();
}
function onBetting() {
  round = S.round; lastTick = -1;
  if (placed && placed.round !== round) { placed = null; safeSS('orbit36:placed', null); }
  hideBanner(); payRows(-1);
  if (scene) { scene.highlight(new Set(), false); scene.collect(); scene.mix(0.45); }
  resetDraw(0);
  setStatus('betting');
  sound.play('open');
  CELL.forEach((c) => { if (c) c.key = null; });
  paintSlip(); render();
  if (queued) { queued = false; armed = round; setTimeout(() => submit(false), 150); }
}
function closeRound() {
  if (closedRound === round) return;
  closedRound = round;
  setStatus('closed'); sound.play('closed');
  $('ring').hidden = true; $('phase').classList.add('phase--noring'); $('dots').hidden = false;
  setText($('phaseTop'), 'Draw #' + round + ' · bets closed');
  if (scene) scene.mix(1);
  if (drawRound !== round) resetDraw(round);
  paintSlip(); render();
}
function cupOf(step, idx) { return step.to === 'bonus' ? 6 : idx; }
function onDeal(step) {
  if (!step || step.kind !== 'ball' || step.value == null) return;
  const r = step.round;
  if (r !== round) round = r;
  if (closedRound !== r) closeRound();
  if (drawRound !== r) resetDraw(r);
  const n = step.value;
  if (step.to === 'bonus') bonusBall = n; else if (!drawn.includes(n)) drawn.push(n);
  const idx = step.to === 'bonus' ? 6 : drawn.length - 1;
  setPhaseDraw(idx);
  if (scene) scene.draw(n, cupOf(step, idx));
}
function onLanded(n, cup) { // a ball settled in its cup (hook from the scene)
  if (cup === 6) { landedBonus = true; sound.play('bonus'); } else { landed = Math.max(landed, cup + 1); sound.play('clink'); }
  const mine = myRound();
  if (mine && cup < 6 && mine.snap.tickets.some((t) => t.nums.includes(n))) { scene && scene.ring(n); sound.play('match', 0.12); }
  paintDots(); paintSlip(); render();
  if (landedBonus && landed >= 6 && pendingResult) { const p = pendingResult; pendingResult = null; showResult(p); }
}
function setPhaseDraw(idx) {
  $('ring').hidden = true; $('phase').classList.add('phase--noring'); $('dots').hidden = false;
  setText($('phaseTop'), 'Draw #' + round + (idx >= 6 ? ' · bonus ball' : ' · ball ' + (idx + 1) + ' of 6'));
  setStatus('drawing', '');
  setText($('status'), '');
}
function paintDots() { [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i < 6 ? i < landed : landedBonus)); }

function onResult(d) {
  const o = d.outcome || (S && S.result);
  if (!o || !o.balls) return;
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, outcome: o };
  round = S.round;
  if (drawRound !== round) resetDraw(round);
  // any ball we did not see drawn (tab hidden, joined late): put it in its cup now
  const missing = [];
  o.balls.forEach((n, i) => { if (!drawn.includes(n)) { drawn.splice(i, 0, n); missing.push({ n, cup: i }); } });
  if (bonusBall == null) { bonusBall = o.bonus; missing.push({ n: o.bonus, cup: 6 }); }
  drawn = o.balls.slice();
  const onRail = scene ? scene.drawn() : [];
  const notThere = missing.filter((m) => !onRail.some((x) => x.n === m.n));
  if (notThere.length && scene) scene.place(notThere);
  if (notThere.length || !scene) { landed = 6; landedBonus = true; }
  const p = { outcome: o, win: d.win };
  if (landedBonus && landed >= 6) showResult(p); else pendingResult = p;
  // safety: never leave the result unshown (e.g. a flight interrupted)
  setTimeout(() => { if (pendingResult === p) { pendingResult = null; landed = 6; landedBonus = true; showResult(p); } }, 2500);
}
function showResult(p) {
  if (resultShown === round) return;
  resultShown = round;
  const o = p.outcome, mine = myRound();
  paintDots();
  setText($('phaseTop'), 'Draw #' + round + ' · complete');
  if (scene) scene.mix(0.25);
  if (mine) {
    const R = window.NXTable.rules.shared.orbit36;
    let total = 0, best = -1, bestT = null, sideWin = 0;
    mine.snap.tickets.forEach((t) => {
      const x = R.pay(o, spotOf(t.nums)); t.win = r2(t.amt * x); t.x = x; total += t.win;
      const tier = PAYS.findIndex(([m, b, px]) => px === x);
      if (x > 0 && (best < 0 || tier < best)) { best = tier; bestT = t; }
    });
    for (const k in mine.snap.sides) { const w = r2(mine.snap.sides[k] * R.pay(o, k)); sideWin += w; }
    total = r2(total + sideWin);
    let capped = false;
    if (mine.maxWin > 0 && total > mine.maxWin) { total = mine.maxWin; capped = true; }
    const my = S.myBets[0];
    if (my && my.round === round && Math.abs(my.win - total) > 0.009) total = my.win; // the client's settlement wins
    mine.win = total;
    if (capped) mine.snap.tickets.forEach((t) => { if (t.win > total) t.win = total; }); // a ticket never shows more than is paid
    safeSS('orbit36:placed', null);
    if (mine.restored) setTimeout(refreshBalance, 800);
    const set = new Set();
    mine.snap.tickets.forEach((t) => t.nums.forEach((n) => { if (o.balls.includes(n)) set.add(n); }));
    if (mine.snap.tickets.some((t) => t.x === 12000)) set.add(o.bonus);
    if (scene) scene.highlight(set, true);
    payRows(best);
    if (total > 0) {
      const wins = mine.snap.tickets.filter((t) => t.win > 0);
      let sub = '';
      if (bestT) sub = 'T' + bestT.id + ' · <b>' + (bestT.x === 12000 ? '5 + bonus' : PAYS[best][0] + ' matches') + ' · ' + bestT.x.toLocaleString('en-US') + '×</b>' + (wins.length > 1 ? ' + ' + (wins.length - 1) + ' more' : '');
      if (sideWin > 0) sub += (sub ? ' &nbsp;+&nbsp; ' : '') + 'first ball <b>' + o.balls[0] + '</b>';
      if (capped) sub += ' (max win)';
      if (total > mine.total + 1e-9) {
        showBanner(total, sub);
        setStatus('win', pick(PH.win));
        sound.play(total >= mine.total * 100 ? 'bigwin' : total >= mine.total * 10 ? 'win2' : 'win');
      } else { setStatus('lose', money(total) + ' back — next draw soon'); sound.play('chip'); }
    } else { setStatus('lose', pick(PH.lose)); }
  } else { setStatus('result', 'Balls ' + o.balls.join(' · ') + ' · bonus ' + o.bonus); if (scene) scene.highlight(new Set(), false); }
  paintSlip(); render();
}
function refreshBalance() {
  const tok = (() => { try { return localStorage.getItem('token'); } catch (e) { return null; } })();
  if (!tok || tok === 'demo' || !game) return;
  fetch(game.apiUrl('/playerBalance'), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } })
    .then((r) => r.json()).then((p) => { const b = p && p.data && p.data.balance; if (b != null) { S.balance = Number(b); render(); } }).catch(() => {});
}

let bannerUntil = 0; // page clock (performance.now): the banner fades out at this time (checked in tick)
function showBanner(win, sub) {
  const b = $('banner');
  setText($('bannerWin'), money(win));
  $('bannerSub').innerHTML = sub || '';
  b.hidden = false; b.classList.remove('banner--in', 'banner--out'); void b.offsetWidth; b.classList.add('banner--in');
  $('play').classList.add('play--banner');
  bannerUntil = performance.now() + 4300;
  const bal = $('balance'); bal.classList.add('bump'); setTimeout(() => bal.classList.remove('bump'), 500);
}
function hideBanner() {
  const b = $('banner');
  bannerUntil = 0;
  if (b.hidden || b.classList.contains('banner--out')) return;
  b.classList.remove('banner--in'); b.classList.add('banner--out');
  b.addEventListener('animationend', () => { b.hidden = true; b.classList.remove('banner--out'); $('play').classList.remove('play--banner'); }, { once: true });
}

// ---------------------------------------------------------------- per frame: timer, auto-send, close
function tick() {
  if (bannerUntil && performance.now() >= bannerUntil) hideBanner();
  if (S && started) {
    const now = Date.now();
    if (S.phase === 'betting') {
      const left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000);
      if (left > 0) {
        if ($('ring').hidden) { $('ring').hidden = false; $('phase').classList.remove('phase--noring'); $('dots').hidden = true; setText($('phaseTop'), 'Draw #' + round + ' · bets open'); }
        $('ringFg').style.strokeDashoffset = String(100 - Math.min(1, left / BETTING_MS) * 100);
        if (secs !== lastTick) {
          setText($('ringNum'), String(secs));
          $('ring').dataset.level = secs <= 3 ? 'red' : '';
          if (secs <= 5 && lastTick !== -1) sound.play('tick');
          if (secs <= 4 && statusKey === 'betting') setStatus('last');
          lastTick = secs; paintButtons();
        }
        if (left <= AUTO_SEND_MS && armed === round && !placing && !(placed && placed.round === round)) { armed = 0; submit(true); }
      } else if (closedRound !== round && round) closeRound();
    }
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '', strip = null, phaseSeen = '';
function visibleHistory() { return S.history.filter((h) => h.outcome && h.outcome.balls && !(h.round === round && resultShown !== round)); }
function render() {
  if (!S || !started) return;
  if (S.phase !== phaseSeen) { phaseSeen = S.phase; if (S.phase === 'pause' && resultShown === round) { setTimeout(() => { if (S.phase === 'pause') { setStatus('wait'); paintSlip(); } }, 1800); } }
  setText($('balance'), S.balance == null ? '—' : money(S.balance));
  setText($('mode'), S.demo ? 'Demo' : 'Balance');
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  setText($('fRound'), S.round ? String(S.round) : '—');
  setText($('fHash'), S.hash || '—');
  setText($('fSeed'), lastSeed && lastSeed.round === resultShown ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the draw' : '—'));
  const hist = visibleHistory(), hk = hist.length + ':' + (hist[0] && hist[0].round);
  if (hk !== histKey) { histKey = hk; renderHistory(hist); }
  renderList();
  paintButtons();
  if (!strip && window.NXPlayers && !WIDE.matches) strip = window.NXPlayers.create($('stage'), { face: avatar });
  if (strip) strip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(name) { return NXPlayers.face(name, 'av', 'span'); } // a player's face (../_core/players.js)
function mb(n, bonus, hit) { return '<span class="mb' + (bonus ? ' mb--bonus' : '') + (hit ? ' mb--hit' : '') + '" style="--c:' + colorOf(n) + '">' + n + '</span>'; }
function renderHistory(hist) {
  $('history').innerHTML = hist.slice(0, 12).map((h, i) => '<span class="draw' + (i === 0 ? ' draw--new' : '') + '" title="Draw ' + h.round + '">' + h.outcome.balls.map((n) => mb(n)).join('') + '<span class="draw__sep"></span>' + mb(h.outcome.bonus, true) + '</span>').join('') || '<span class="draw draw--empty">Draws appear here</span>';
}
function describe(bets) {
  let t = 0; const s = [];
  (bets || []).forEach((b) => { if (b.spot && b.spot.slice(0, 2) === 't:') t++; else if (b.spot) s.push(b.spot); });
  return (t ? t + ' ticket' + (t > 1 ? 's' : '') : '') + (s.length ? (t ? ' + ' : '') + s.join(' / ') : '') || '—';
}
function renderList() {
  let rows, cols, count;
  const done = resultShown === S.round;
  if (tab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && done;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + (showWin && b.win > 0 ? ' row--won' : '') + '"><span>' + esc(b.player || 'Player') + '</span><span>' + esc(describe(b.bets)) + '</span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Bets this draw');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === S.round && !done));
    cols = '<span>Draw</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => '<div class="row' + (m.win > 0 ? ' row--won' : '') + '"><span>#' + m.round + '</span><span>' + esc(describe(m.bets)) + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>');
    setText($('countLabel'), 'My draws');
  }
  const key = tab + '|' + rows.join('');
  if (key === listKey) return;
  listKey = key;
  $('cols').innerHTML = cols;
  setText($('betCount'), String(count));
  $('list').innerHTML = rows.join('') || '<div class="empty">' + (tab === 'all' ? 'No bets yet this draw' : 'Your draws will show here') + '</div>';
}

// ---------------------------------------------------------------- layout: play area + scene size
let layoutRaf = 0;
function layout() {
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    const stage = $('stage'), sr = stage.getBoundingClientRect(), hist = $('historyBox'), wide = WIDE.matches;
    if (wide && hist.parentNode !== $('tablewrap')) $('tablewrap').insertBefore(hist, $('panels'));
    if (!wide && hist.parentNode !== $('foot')) $('foot').appendChild(hist);
    const tk = $('tickets'), head = document.querySelector('#slipA .slip__head'); // phone: the tickets row shares the head row with Quick pick
    if (!wide && tk.parentNode !== head) head.insertBefore(tk, $('qp'));
    if (wide && tk.parentNode === head) head.after(tk);
    const top = $('top').getBoundingClientRect();
    let A;
    if (wide) {
      const side = $('side').getBoundingClientRect(), tw = $('tablewrap').getBoundingClientRect(), pt = $('paytable').getBoundingClientRect();
      const L = side.right - sr.left + 10, T = top.bottom - sr.top + 2;
      A = { L, T, W: Math.max(200, pt.left - sr.left - 12 - L), H: Math.max(160, tw.top - sr.top - T - 6) };
    } else {
      const fb = $('foot').getBoundingClientRect(), T = top.bottom - sr.top + 2;
      A = { L: 0, T, W: sr.width, H: Math.max(150, fb.top - sr.top - T - 4) };
    }
    const play = $('play');
    play.style.left = A.L + 'px'; play.style.top = A.T + 'px'; play.style.width = A.W + 'px'; play.style.height = A.H + 'px';
    stage.style.setProperty('--below', Math.max(0, sr.height - A.T - A.H) + 'px');
    stage.style.setProperty('--left', A.L + 'px');
    stage.style.setProperty('--cx', ((A.L + A.W / 2) / sr.width * 100).toFixed(2) + '%');
    stage.style.setProperty('--cy', ((A.T + A.H * 0.48) / sr.height * 100).toFixed(2) + '%');
    if (scene) {
      const ph = $('phase').getBoundingClientRect(), pad = A.H < 260 ? 18 : Math.max(0, ph.bottom - sr.top - A.T + 4); // the drum sits under the phase pill (short phones: mostly behind it)
      scene.resize(sr.width, sr.height, { L: A.L, T: A.T + pad, W: A.W, H: Math.max(140, A.H - pad) });
      const b = scene.bonusAnchor(), lab = $('bonusLab');
      if (b) { lab.hidden = false; lab.style.transform = 'translate(' + Math.round(b.x - lab.offsetWidth / 2) + 'px,' + Math.round(b.y + 2) + 'px)'; }
    }
    if (scene && !readySent) { readySent = true; requestAnimationFrame(() => { game.ready(); game.theme(scene.topColor); }); }
  });
}

// ---------------------------------------------------------------- wiring
function wire() {
  $('back').addEventListener('click', () => game.back());
  $('qp').addEventListener('click', quickPick);
  $('clear').addEventListener('click', clearTicket);
  $('action').addEventListener('click', () => submit(false));
  $('actionB').addEventListener('click', () => submit(false));
  $('tickets').addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]'); if (x) { removeTicket(Number(x.dataset.x)); return; }
    const add = e.target.closest('[data-add]'); if (add) { newTicket(); return; }
    const t = e.target.closest('.tkt'); if (t && t.dataset.i != null) { cur = Number(t.dataset.i); sound.play('pick'); saveSlip(); paintSlip(); }
  });
  stakeA = buildStake('stakeA', 'per ticket', stepTicket, setTicketAmt);
  stakeB = buildStake('stakeB', 'stake', stepSide, setSideAmt);
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
  if (!lastSeed || !lastSeed.seed) { out.textContent = 'Wait for a draw to finish while you are at the table — its seed is revealed then.'; return; }
  out.textContent = 'Checking…';
  const L = lastSeed;
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: 'orbit36', gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const o = res[1].outcome, same = o.balls.join(',') === L.outcome.balls.join(',') && o.bonus === L.outcome.bonus;
    out.innerHTML = 'Draw ' + L.round + ': <b>' + o.balls.join(' · ') + '</b> + bonus <b>' + o.bonus + '</b>. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (same ? '✓ same balls as drawn' : '✗ balls differ');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

// first snapshot: put the machine in the state the round is in
function syncFromSnapshot() {
  started = true;
  round = S.round;
  const stored = safeSS('orbit36:placed');
  if (stored && stored.round === S.round && (S.phase === 'betting' || S.phase === 'dealing')) { placed = stored; placed.restored = true; }
  if (S.phase === 'dealing') {
    closedRound = round; resetDraw(round);
    setStatus('closed');
    if (scene) scene.mix(1);
    const steps = (S.deals || []).filter((x) => x.kind === 'ball' && x.value != null);
    const list = [];
    steps.forEach((st) => { if (st.to === 'bonus') { bonusBall = st.value; list.push({ n: st.value, cup: 6 }); } else { drawn.push(st.value); list.push({ n: st.value, cup: drawn.length - 1 }); } });
    if (scene && list.length) scene.place(list);
    landed = drawn.length; landedBonus = bonusBall != null;
    setPhaseDraw(bonusBall != null ? 6 : Math.max(0, drawn.length - 1)); paintDots();
  } else if (S.phase === 'betting') {
    setStatus('betting'); if (scene) scene.mix(0.45);
    if (Date.now() >= S.endsAt) closeRound();
  } else {
    const o = S.result || (S.history[0] && S.history[0].outcome);
    if (o && o.balls) {
      resetDraw(round); drawn = o.balls.slice(); bonusBall = o.bonus; landed = 6; landedBonus = true;
      if (scene) { scene.place(o.balls.map((n, i) => ({ n, cup: i })).concat([{ n: o.bonus, cup: 6 }])); scene.mix(0.25); }
      resultShown = round; paintDots(); setText($('phaseTop'), 'Draw #' + round + ' · complete'); $('ring').hidden = true; $('dots').hidden = false; $('phase').classList.add('phase--noring');
    }
    setStatus('wait');
  }
  paintSlip(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
loadSlip();
buildGrid(); buildSides(); buildPays(); wire();
setStatus('wait');
game = window.NXTable.start({
  event: EVENT, game: 'orbit36',
  onChange() {
    S = game ? game.S : S;
    if (!S) return;
    if (scene && S.gotSnapshot && S.phase !== 'waiting' && (!started || syncedEarly)) { syncedEarly = false; syncFromSnapshot(); }
    else if (started && S.round > round && S.phase !== 'waiting') { // a reconnect skipped a round: catch up quietly
      if (S.phase === 'betting') onBetting(); else { if (scene) { scene.highlight(new Set(), false); scene.collect(); } syncFromSnapshot(); }
    }
    render(); paintButtons();
  },
  onSignal(t, d) { if (!started) return; onSignal(t, d || {}); },
});
S = game.S;
setText($('fGame'), game.event || EVENT);
paintSlip();
game.limitsLoaded.then((l) => {
  if (l && l.min > 0) minBet = Number(l.min);
  if (l && l.max > 0) maxBet = Number(l.max);
  tickets.forEach((t) => { t.amt = clampAmt(t.amt || minBet); });
  sideAmt = clampAmt(sideAmt || minBet);
  for (const k in sides) sides[k] = clampAmt(sides[k]);
  if (!safeLS('orbit36:slip')) { tickets.forEach((t) => { t.amt = minBet; }); sideAmt = minBet; }
  setText($('rMin'), money(minBet)); setText($('rMax'), money(maxBet || 100));
  paintSlip();
});
createScene($('scene'), { landed: (n, cup) => onLanded(n, cup) }).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  window.__o36 = { scene: sc, game, state: () => ({ round, closedRound, drawRound, drawn: drawn.slice(), bonusBall, landed, landedBonus, resultShown, placed, queued, armed, tickets, sides }) }; // QA hook
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
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#0b0620'); } }, 6000);
