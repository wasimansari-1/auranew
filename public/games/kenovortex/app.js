/* Keno Vortex (88.0094) — a keno draw every 30 s, shared by every player (engine draw game "keno40":
 * nexorng-engine/internal/tables/keno40.go; client rules: rules.js).
 *   15 s betting → 10 s draw (the blower starts; one ball every 0.85 s flies up the riser into the
 *   rail) → 5 s result. A ticket is 1–10 numbers of 1–40; it pays by picks and hits (rules.js).
 * The player's tickets (one on a phone, two on a wide screen) go in ONE bet per draw: a ticket's
 * Bet button puts it in; when every ticket with numbers is in, they are sent at once (or 1.5 s
 * before betting closes). Settlement and the round protocol live in ../_core/table-client.js;
 * this file is the tickets, the round choreography and the layout; scene.js is the 3D machine.
 */
import { create as createScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0094';
const BETTING_MS = 15000;
const AUTO_SEND_MS = 1500;
const K = window.KENO;
const DEC = ['#7c3aed', '#f5a524', '#db2777', '#0ea5b7'];
const decColor = (n) => DEC[Math.floor((n - 1) / 10)];
const PH = {
  betting: ['Choose up to 10 lucky numbers', 'Bets are open — fill your ticket', 'Which ten will fly tonight?', 'Quick pick or your own numbers?', 'The vortex is warming up', 'Pick your numbers, pick your luck', 'Ten balls are coming — be ready'],
  last: ['Last seconds to bet…', 'Closing soon', 'Final call — tickets in!'],
  closed: ['No more bets — the blower is on!', 'Here come the balls…', 'Round and round they go…', 'Bets are closed — fingers crossed', 'The vortex picks ten…'],
  result: ['Draw complete — next one in a moment', 'Ten balls drawn — get ready for the next', 'That’s the draw!'],
  wait: ['Next draw in a moment', 'Get your ticket ready', 'A new draw is coming up', 'Balls are heading home'],
  noBet: ['Bets are closed — your numbers are kept for the next draw', 'Wait for the next draw — your picks stay on the ticket'],
  win: ['Lucky numbers!', 'Right on the balls!', 'That’s a winner!', 'Nicely picked!'],
  lose: ['So close — next draw in a moment', 'Not this time — the vortex spins again soon', 'Next draw could be yours'],
};

// ---------------------------------------------------------------- state
const sound = window.KVAudio.create();
let scene = null, game = null, S = null;
let quickVals = [0.1, 0.2, 0.5, 1];
let placed = null, placing = false;      // { round, tickets: [{id, picks, stake, spot}], total, maxWin, win, lines }
let round = 0, closedRound = 0, autoRound = 0, resultRound = 0, lastTick = -1;
let drawn = [];                           // balls landed this round, in order
let started = false, readySent = false, tab = 'all';
let bannerT = 0, lastSeed = null, pauseAt = 0;
const T = [mkTicket('A', [3, 8, 14, 19, 23, 31, 36]), mkTicket('B', [2, 12, 27, 40])];

function mkTicket(id, def) {
  const saved = safeLS('kenovortex:ticket' + id);
  const picks = saved && Array.isArray(saved.picks) && saved.picks.every((n) => n >= 1 && n <= 40) ? saved.picks.slice(0, 10) : def;
  return { id, picks: Array.from(new Set(picks)).sort((a, b) => a - b), stake: saved && saved.stake > 0 ? saved.stake : 0, armed: false, el: null };
}
function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function fx(x) { return '×' + (x >= 1000 ? x.toLocaleString('en-US') : String(x)); }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function safeLS(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return null; }
function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return null; }
function saveTicket(t) { safeLS('kenovortex:ticket' + t.id, { picks: t.picks, stake: t.stake }); }
function spotOf(picks) { return 'k:' + picks.slice().sort((a, b) => a - b).join(','); }
function visible() { return WIDE.matches ? T : T.slice(0, 1); }
function maxPay(k) { return k ? Math.max(...K.PAYS[k]) : 0; }

let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800); }
let statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  const el = $('status'); el.textContent = text || pick(PH[key] || ['']); el.dataset.kind = key;
}

// ---------------------------------------------------------------- tickets: built once
const ICON_QP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.2 5.3 1.9-5.3 1.9L12 16.7l-1.9-5.2L4.8 9.6l5.3-1.9z" fill="currentColor"/><path d="M18.5 14.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="currentColor" opacity=".8"/></svg>';
function buildTickets() {
  const wrap = $('tablewrap');
  T.forEach((t, ti) => {
    const sec = document.createElement('section');
    sec.className = 'ticket'; sec.setAttribute('aria-label', 'Ticket ' + t.id);
    if (ti === 1) sec.classList.add('ticket--b');
    sec.innerHTML = '<i class="notch notch--l"></i><i class="notch notch--r"></i>'
      + '<div class="t-head"><span class="t-tag">TICKET ' + t.id + '</span>'
      + '<div class="t-picks"><b><span class="t-k">0</span><small>/10 PICKED</small></b><div class="pips">' + '<i></i>'.repeat(10) + '</div></div>'
      + '<div class="t-tools"><button type="button" class="tool tool--qp">' + ICON_QP + 'QUICK PICK</button><button type="button" class="tool tool--clear">CLEAR</button></div></div>'
      + '<div class="tear"></div><div class="grid"></div><div class="pays"></div>'
      + '<div class="t-bottom"><div class="stake"><div class="stepper"><button type="button" class="st-minus" aria-label="Lower stake">−</button><div class="stepper__v"><small>STAKE</small><span class="st-v">—</span></div><button type="button" class="st-plus" aria-label="Raise stake">+</button></div><div class="quick"></div></div>'
      + '<button type="button" class="action"' + (ti === 0 ? ' id="action"' : '') + '><b></b><small></small></button></div>';
    const grid = sec.querySelector('.grid'), cells = [];
    for (let n = 1; n <= 40; n++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cell'; b.textContent = String(n); b.dataset.n = n;
      b.style.setProperty('--c', decColor(n));
      b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Number ' + n);
      grid.appendChild(b); cells[n] = b;
    }
    grid.addEventListener('click', (e) => { const b = e.target.closest('.cell'); if (b) toggleNumber(t, Number(b.dataset.n)); });
    const quick = sec.querySelector('.quick'), qb = [];
    [1, 2, 5, 10].forEach((x, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.innerHTML = '×' + x + '<small></small>';
      b.addEventListener('click', () => setStake(t, quickVals[i]));
      quick.appendChild(b); qb.push(b);
    });
    sec.querySelector('.tool--qp').addEventListener('click', () => quickPick(t));
    sec.querySelector('.tool--clear').addEventListener('click', () => clearTicket(t));
    sec.querySelector('.st-minus').addEventListener('click', () => stepStake(t, -1));
    sec.querySelector('.st-plus').addEventListener('click', () => stepStake(t, 1));
    const action = sec.querySelector('.action');
    action.addEventListener('click', () => pressBet(t));
    t.el = { sec, cells, k: sec.querySelector('.t-k'), pips: sec.querySelectorAll('.pips i'), pays: sec.querySelector('.pays'), stake: sec.querySelector('.st-v'),
      minus: sec.querySelector('.st-minus'), plus: sec.querySelector('.st-plus'), qb, qp: sec.querySelector('.tool--qp'), clear: sec.querySelector('.tool--clear'),
      action, label: action.querySelector('b'), sub: action.querySelector('small'), key: '', paysKey: '', cellKey: [] };
    wrap.appendChild(sec);
  });
}

// ---------------------------------------------------------------- tickets: logic
function bettingOpen() { return !!S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function inPlay(t) { return !!(placed && placed.round === round && placed.tickets.some((x) => x.id === t.id)); }
function roundLocked() { return !!(placed && placed.round === round) || placing; }
function editable(t) { return !inPlay(t) && !(placing && t.armed); }
function balanceNow() { return S && S.balance != null ? S.balance : null; }
function armedTotal() { return r2(visible().filter((t) => t.armed).reduce((s, t) => s + t.stake, 0)); }

function toggleNumber(t, n) {
  if (!editable(t)) { toast('Ticket ' + t.id + ' is in this draw — change it after the result.'); return; }
  const i = t.picks.indexOf(n);
  if (i >= 0) { t.picks.splice(i, 1); sound.play('unpick', n); }
  else {
    if (t.picks.length >= 10) { toast('Up to 10 numbers per ticket.'); sound.play('error'); return; }
    t.picks.push(n); t.picks.sort((a, b) => a - b); sound.play('pick', n);
  }
  if (t.armed) disarm(t);
  saveTicket(t); paintTicket(t); updateMine(); maybeSubmit();
}
function quickPick(t) {
  if (!editable(t)) return;
  const k = t.picks.length || 5, pool = [];
  for (let n = 1; n <= 40; n++) pool.push(n);
  const a = new Uint32Array(40); (window.crypto || window.msCrypto).getRandomValues(a);
  for (let i = 39; i > 0; i--) { const j = a[i] % (i + 1); const x = pool[i]; pool[i] = pool[j]; pool[j] = x; }
  t.picks = pool.slice(0, k).sort((x, y) => x - y);
  if (t.armed) disarm(t);
  sound.play('quick'); saveTicket(t); paintTicket(t); updateMine();
}
function clearTicket(t) {
  if (!editable(t) || !t.picks.length) return;
  t.picks = []; if (t.armed) disarm(t);
  sound.play('clear'); saveTicket(t); paintTicket(t); updateMine(); maybeSubmit();
}
function stakeLadder() {
  const l = game ? game.limit() : { min: 0.1, max: 0 }, min = l.min > 0 ? l.min : 0.1, out = [];
  [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((x) => { const v = r2(min * x); if (!(l.max > 0) || v <= l.max + 1e-9) out.push(v); });
  if (l.max > 0 && out[out.length - 1] < l.max - 1e-9) out.push(r2(l.max));
  return out;
}
function setStake(t, v) {
  if (!editable(t)) return;
  const l = game.limit();
  if (l.max > 0 && v > l.max + 1e-9) v = l.max;
  if (v === t.stake) return;
  t.stake = r2(v); if (t.armed) disarm(t);
  sound.play('chip'); saveTicket(t); paintTicket(t); render();
}
function stepStake(t, dir) {
  const L = stakeLadder();
  let i = L.findIndex((v) => v >= t.stake - 1e-9);
  if (i < 0) i = L.length - 1;
  if (dir > 0) i = L[i] > t.stake + 1e-9 ? i : i + 1; else i = i - 1;
  if (i < 0 || i >= L.length) return;
  setStake(t, L[i]);
}

function pressBet(t) {
  if (!S) return;
  if (inPlay(t)) return;
  if (!bettingOpen()) { toast(pick(PH.noBet)); sound.play('error'); return; }
  if (roundLocked()) { toast('Your bet for this draw is in — Ticket ' + t.id + ' can play the next draw.'); sound.play('error'); return; }
  if (!t.picks.length) { toast('Pick 1 to 10 numbers first (or Quick pick).'); sound.play('error'); return; }
  if (t.armed) { disarm(t); sound.play('clear'); render(); return; }
  const l = game.limit(), total = r2(armedTotal() + t.stake), bal = balanceNow();
  if (l.max > 0 && total > l.max + 1e-9) { toast('Max ' + money(l.max) + ' per draw (all tickets together).'); sound.play('error'); return; }
  if (bal != null && total > bal + 1e-9) { toast('Not enough balance.'); sound.play('error'); return; }
  t.armed = true; sound.play('chip');
  render();
  maybeSubmit();
}
function disarm(t) { t.armed = false; render(); }
// send when every ticket that has numbers is in (a phone has one ticket: at once)
function maybeSubmit() {
  if (!S || roundLocked() || !bettingOpen()) return;
  const vis = visible(), armed = vis.filter((t) => t.armed);
  if (armed.length && vis.every((t) => t.armed || !t.picks.length)) submit(false);
}
function submit(auto) {
  if (roundLocked()) return;
  const tickets = visible().filter((t) => t.armed && t.picks.length);
  if (!tickets.length) return;
  if (!bettingOpen() && !auto) return;
  const l = game.limit(), total = r2(tickets.reduce((s, t) => s + t.stake, 0));
  if (l.min > 0 && total < l.min - 1e-9) { toast('Minimum ' + money(l.min) + ' per draw.'); sound.play('error'); return; }
  // two identical tickets are one spot (the stakes add up)
  const bySpot = {};
  tickets.forEach((t) => { const s = spotOf(t.picks); bySpot[s] = r2((bySpot[s] || 0) + t.stake); });
  const bets = Object.keys(bySpot).map((s) => ({ spot: s, amount: bySpot[s] }));
  const r = round, snap = tickets.map((t) => ({ id: t.id, picks: t.picks.slice(), stake: t.stake, spot: spotOf(t.picks) }));
  placing = true; render();
  game.bet(bets).then((res) => {
    placing = false;
    tickets.forEach((t) => { t.armed = false; });
    placed = { round: r, tickets: snap, total, maxWin: res && res.maxWin != null ? Number(res.maxWin) : null };
    if (placed.maxWin > 0) setText($('rMaxWin'), money(placed.maxWin));
    safeSS('kenovortex:placed', placed);
    sound.play('placed');
    setStatus('placed', auto ? 'Your ticket' + (snap.length > 1 ? 's are' : ' is') + ' in — good luck!' : 'Bet accepted — good luck!');
    updateMine(); render();
  }).catch(() => { placing = false; tickets.forEach((t) => { t.armed = false; }); render(); });
}

// ---------------------------------------------------------------- painting (only what changed)
function hitsOf(picks) { let h = 0; for (const n of picks) if (drawn.indexOf(n) >= 0) h++; return h; }
function paintTicket(t) {
  const e = t.el; if (!e) return;
  const k = t.picks.length, mine = inPlay(t), showDraw = round && (S && (S.phase === 'dealing' || S.phase === 'result' || S.phase === 'pause') || drawn.length);
  setText(e.k, String(k));
  e.pips.forEach((p, i) => p.classList.toggle('on', i < k));
  for (let n = 1; n <= 40; n++) {
    const picked = t.picks.indexOf(n) >= 0, isDrawn = showDraw && drawn.indexOf(n) >= 0;
    const key = picked && isDrawn ? 'hit' : picked ? 'pick' : isDrawn ? 'drawn' : '';
    if (e.cellKey[n] === key) continue;
    const c = e.cells[n];
    c.classList.toggle('cell--pick', key === 'pick');
    c.classList.toggle('cell--hit', key === 'hit');
    c.classList.toggle('cell--drawn', key === 'drawn');
    c.setAttribute('aria-pressed', picked ? 'true' : 'false');
    if (key === 'hit' && e.cellKey[n] === 'pick' && mine) { c.classList.remove('cell--flash'); void c.offsetWidth; c.classList.add('cell--flash'); }
    e.cellKey[n] = key;
  }
  // the pays of this ticket size; the current hit count lights up during the draw
  const hits = showDraw ? hitsOf(t.picks) : -1;
  const pk = k + ':' + hits;
  if (pk !== e.paysKey) {
    e.paysKey = pk;
    if (!k) e.pays.innerHTML = '<div class="pays__empty">Pick 1–10 numbers to see the pays</div>';
    else {
      const row = K.PAYS[k];
      let h = '<div class="pays__h">HITS<br>PAY</div>';
      for (let i = 0; i <= k; i++) if (row[i] >= 1) h += '<div class="pay' + (i === hits ? ' pay--now' : '') + '"><span>' + i + ' hit' + (i > 1 ? 's' : '') + '</span><b>' + fx(row[i]) + '</b></div>';
      e.pays.innerHTML = h;
    }
  }
  const l = game ? game.limit() : { min: 0.1, max: 0 };
  setText(e.stake, money(t.stake));
  const ed = editable(t);
  e.minus.disabled = !ed || t.stake <= stakeLadder()[0] + 1e-9;
  e.plus.disabled = !ed || (l.max > 0 && t.stake >= l.max - 1e-9);
  e.qb.forEach((b, i) => { b.classList.toggle('on', Math.abs(quickVals[i] - t.stake) < 1e-9); b.disabled = !ed || (l.max > 0 && quickVals[i] > l.max + 1e-9); setText(b.querySelector('small'), money(quickVals[i])); });
  e.qp.disabled = !ed; e.clear.disabled = !ed || !k;
  e.sec.classList.toggle('ticket--locked', !ed);
  paintAction(t);
}
function paintAction(t) {
  const e = t.el, a = e.action, k = t.picks.length;
  let cls = '', label, sub = '', dis = false;
  const mine = placed && placed.round === round ? placed.tickets.find((x) => x.id === t.id) : null;
  const open = bettingOpen();
  if (mine) {
    const h = hitsOf(mine.picks), kk = mine.picks.length;
    if (resultRound === round && placed.lines) {
      const ln = placed.lines.find((x) => x.id === t.id);
      if (ln && ln.win > 0 && ln.x > 1) { cls = 'action--won'; label = 'WON ' + money(ln.win); sub = h + ' of ' + kk + ' hit · ' + fx(ln.x) + (ln.capped ? ' · max win' : ''); }
      else if (ln && ln.win > 0) { cls = 'action--in'; label = 'STAKE BACK ' + money(ln.win); sub = h + ' of ' + kk + ' hit · ×1'; }
      else { cls = 'action--wait'; label = 'NO WIN'; sub = h + ' of ' + kk + ' hit'; }
    } else if (S.phase === 'betting') { cls = 'action--in'; label = 'PLACED ' + money(mine.stake); sub = 'good luck!'; }
    else { cls = 'action--wait'; label = 'DRAWING…'; sub = h + ' hit' + (h === 1 ? '' : 's') + ' so far'; }
    dis = true;
  } else if (placing && t.armed) { cls = 'action--in'; label = 'PLACING…'; sub = money(t.stake); dis = true; }
  else if (open && roundLocked()) { cls = 'action--wait'; label = 'NEXT DRAW'; sub = 'one bet per draw'; }
  else if (open && t.armed) {
    cls = 'action--in'; label = 'IN · ' + money(t.stake);
    const other = visible().find((x) => x !== t && x.picks.length && !x.armed);
    sub = other ? 'goes with Ticket ' + other.id + ' · tap to remove' : 'tap to remove';
  } else if (open && !k) { cls = 'action--wait'; label = 'PICK NUMBERS'; sub = '1 to 10, or Quick pick'; }
  else if (open) { label = 'BET ' + money(t.stake); const mw = r2(t.stake * maxPay(k)); sub = 'win up to ' + money(placed && placed.maxWin > 0 ? Math.min(mw, placed.maxWin) : mw); }
  else { cls = 'action--wait'; label = S && S.phase === 'dealing' ? 'DRAWING…' : 'NEXT DRAW SOON'; sub = 'your numbers are kept'; }
  const key = cls + '|' + label + '|' + sub + '|' + dis;
  if (key === e.key) return;
  e.key = key;
  a.className = 'action' + (cls ? ' ' + cls : '');
  a.disabled = dis;
  setText(e.label, label); setText(e.sub, sub);
}
function paintAll() { T.forEach((t) => { t.el.cellKey = []; t.el.paysKey = ''; t.el.key = ''; paintTicket(t); }); }
function updateMine() {
  if (!scene) return;
  let set = [];
  if (placed && placed.round === round) placed.tickets.forEach((x) => { set = set.concat(x.picks); });
  else visible().forEach((t) => { set = set.concat(t.picks); });
  scene.mine(set);
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
  T.forEach((t) => { t.armed = false; });
  drawn = []; resultRound = 0; ballShown = 0;
  hideBanner();
  if (scene) { scene.win(false); scene.blow(false); scene.back(); }
  sound.play('blower-off');
  setTimeout(() => sound.play('return'), 100);
  setStatus('betting');
  $('drawpill').hidden = true; $('status').hidden = false;
  sound.play('open');
  updateMine(); paintAll(); render();
}

function closeRound() {
  closedRound = round;
  setStatus('closed');
  sound.play('closed'); sound.play('blower-on');
  const left = visible().filter((t) => t.armed);
  if (left.length && !placing) { left.forEach((t) => { t.armed = false; }); toast('Bets closed — your ticket was not placed.'); }
  if (scene) scene.blow(true);
  $('drawpill').hidden = false; $('status').hidden = true;
  paintBall(); updateMine(); render();
}

function onDeal(step) {
  if (!step || step.kind !== 'ball' || step.value == null) return;
  const r = step.round;
  if (r !== round) { round = r; }
  if (closedRound !== r) { // a draw we did not see open (reconnected): the old balls leave the rail first
    if (resultRound && resultRound !== r) { drawn = []; resultRound = 0; ballShown = 0; hideBanner(); if (scene) { scene.win(false); scene.back(true); } }
    closeRound();
  }
  if (scene) scene.draw(step.step, step.value);
  paintBall(step.step + 1);
}
let ballShown = 0;
function paintBall(n) {
  if (n) ballShown = n;
  setText($('ballNo'), Math.max(1, ballShown) + ' / 10');
  const mine = placed && placed.round === round ? placed.tickets : null;
  const em = $('hitNo');
  if (mine) { em.hidden = false; setText(em, (WIDE.matches && mine.length > 1 ? mine.map((x) => x.id + ' ' + hitsOf(x.picks)).join(' · ') : hitsOf(mine[0].picks)) + ' HIT' + (mine.length === 1 && hitsOf(mine[0].picks) === 1 ? '' : 'S')); }
  else em.hidden = true;
}
function landed(i, n) {
  if (drawn.indexOf(n) < 0) drawn.push(n);
  const mine = placed && placed.round === round ? placed.tickets.some((x) => x.picks.indexOf(n) >= 0) : false;
  sound.play(mine ? 'hit' : 'land');
  T.forEach(paintTicket);
  paintBall();
  if (pendingResult && drawn.length >= 10) finishResult();
}

let pendingResult = null;
function onResult(d) {
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, balls: d.outcome && d.outcome.balls };
  const balls = d.outcome && d.outcome.balls;
  if (!balls || balls.length !== 10) return;
  round = S.round;
  pendingResult = { round: S.round, balls, win: d.win };
  if (placed && placed.round === S.round) {
    safeSS('kenovortex:placed', null);
    if (placed.restored) setTimeout(refreshBalance, 800);
  }
  // the draw was missed (tab hidden, joined late): show it now
  if (drawn.length < 10 && (!scene || !scene.busy())) {
    if (scene) { scene.blow(true, true); scene.place(balls); }
    drawn = balls.slice();
  }
  if (drawn.length >= 10) finishResult();
  else setTimeout(() => { if (pendingResult && pendingResult.round === round) { drawn = balls.slice(); if (scene) scene.place(balls); finishResult(); } }, 1500);
}
function finishResult() {
  const R = pendingResult; pendingResult = null;
  if (!R || resultRound === R.round) return;
  resultRound = R.round;
  drawn = R.balls.slice();
  $('drawpill').hidden = true; $('status').hidden = false;
  if (scene) scene.blow(false);
  sound.play('blower-off');
  pauseAt = Date.now();
  let total = 0;
  if (placed && placed.round === R.round) {
    let raw = 0;
    placed.lines = placed.tickets.map((x) => { const h = hitsOf(x.picks), mult = K.PAYS[x.picks.length][h] || 0, w = r2(Math.floor(x.stake * mult * 100 + 1e-6) / 100); raw += w; return { id: x.id, h, k: x.picks.length, x: mult, win: w }; });
    raw = r2(raw); total = raw;
    if (placed.maxWin > 0 && raw > placed.maxWin) { total = placed.maxWin; placed.lines.forEach((ln) => { if (ln.win > 0) ln.capped = true; }); }
    const my = S.myBets[0];
    if (my && my.round === R.round && my.win != null) total = my.win; // the client's settlement (capped like the engine)
    placed.win = total;
    if (total > placed.total + 1e-9) {
      showBanner(total, placed.lines.filter((x) => x.win > 0), raw > total);
      setStatus('win', pick(PH.win));
      sound.play('win', total >= placed.total * 10);
      if (scene) scene.win(true);
    } else if (total > 0) { setStatus('back', 'Stake back — ' + money(total)); sound.play('land'); }
    else { setStatus('lose', pick(PH.lose)); sound.play('lose'); }
  } else setStatus('result', pick(PH.result));
  T.forEach(paintTicket); renderHistory(true); render();
}
function refreshBalance() {
  const tok = (() => { try { return localStorage.getItem('token'); } catch (e) { return null; } })();
  if (!tok || tok === 'demo' || !game) return;
  fetch(game.apiUrl('/playerBalance'), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } })
    .then((r) => r.json()).then((p) => { const b = p && p.data && p.data.balance; if (b != null) { S.balance = Number(b); render(); } }).catch(() => {});
}

function showBanner(win, lines, capped) {
  const b = $('banner');
  setText($('bannerTitle'), capped ? 'MAX WIN' : 'YOU WIN');
  setText($('bannerWin'), money(win));
  $('bannerLines').innerHTML = lines.map((x) => '<i>Ticket ' + x.id + ' · ' + x.h + '/' + x.k + ' <b>' + fx(x.x) + '</b></i>').join('');
  b.hidden = false; b.classList.remove('banner--in', 'banner--out'); void b.offsetWidth; b.classList.add('banner--in');
  bannerT = Date.now() + 4300; // hidden by tick() (the page clock)
  const bal = $('balance'); bal.classList.add('bump'); setTimeout(() => bal.classList.remove('bump'), 500);
}
function hideBanner() {
  const b = $('banner');
  bannerT = 0;
  if (b.hidden) return;
  b.classList.remove('banner--in'); b.classList.add('banner--out');
  setTimeout(() => { if (b.classList.contains('banner--out')) { b.hidden = true; b.classList.remove('banner--out'); } }, 400);
  if (scene) scene.win(false);
}

// ---------------------------------------------------------------- per frame: timer, auto-send, close
function tick() {
  if (S && started) {
    const now = Date.now(), timer = $('timer');
    if (S.phase === 'betting') {
      const left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000);
      if (left > 0) {
        if (timer.hidden) timer.hidden = false;
        $('timerRing').style.strokeDashoffset = String(100 - Math.min(1, left / BETTING_MS) * 100);
        if (secs !== lastTick) {
          timer.dataset.level = secs <= 3 ? 'red' : '';
          setText($('timerNum'), String(secs));
          if (secs <= 5 && lastTick !== -1) sound.play('tick', secs <= 2);
          if (secs <= 4 && statusKey === 'betting') setStatus('last');
          lastTick = secs; T.forEach(paintAction);
        }
        if (left <= AUTO_SEND_MS && autoRound !== round && !roundLocked() && visible().some((t) => t.armed)) { autoRound = round; submit(true); }
      } else {
        timer.hidden = true;
        if (closedRound !== round && round) closeRound();
      }
    } else if (!timer.hidden) timer.hidden = true;
    if (bannerT && now >= bannerT) hideBanner();
    if (S.phase === 'pause' && resultRound === round && pauseAt && now - pauseAt > 3000 && (statusKey === 'result' || statusKey === 'win' || statusKey === 'lose' || statusKey === 'back')) setStatus('wait');
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '', strip = null;
// after a reconnect (or a hidden tab) the rail catches up with the draw so far, at once
function reconcileDraw() {
  if (!scene || S.phase !== 'dealing' || closedRound !== S.round) return;
  const rail = scene.railBalls();
  let changed = false;
  (S.deals || []).forEach((d) => {
    if (d.kind !== 'ball' || d.value == null || d.round !== S.round || rail[d.step] === d.value) return;
    scene.draw(d.step, d.value, true);
    if (drawn.indexOf(d.value) < 0) drawn.push(d.value);
    changed = true;
  });
  if (changed) { paintBall(S.deals.length); T.forEach(paintTicket); }
}
function render() {
  if (!S || !started) return;
  reconcileDraw();
  let bal = S.balance;
  if (bal != null && !placing && !roundLocked()) bal = r2(bal - armedTotal());
  setText($('balance'), bal == null ? '—' : money(bal));
  setText($('mode'), S.demo ? 'Demo' : 'Balance');
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  setText($('fRound'), S.round ? String(S.round) : '—');
  setText($('fHash'), S.hash || '—');
  setText($('fSeed'), lastSeed && lastSeed.round === resultRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the round' : '—'));
  renderHistory(false);
  renderList();
  T.forEach(paintTicket);
  if (!strip && window.NXPlayers && !WIDE.matches) strip = window.NXPlayers.create($('stage'), { face: avatar });
  if (strip) strip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(name) { return NXPlayers.face(name, 'av', 'span'); } // a player's face (../_core/players.js)
function miniBall(n, me, fresh) { return '<span class="mb' + (me ? ' mb--me' : '') + (fresh ? ' mb--in' : '') + '" style="--c:' + decColor(n) + '">' + n + '</span>'; }
function shownDraw() {
  // the row shows this round's draw once it is complete, the previous one before
  const h = S.history.filter((x) => x.outcome && x.outcome.balls && !(x.round === round && resultRound !== round));
  return h[0] || null;
}
function renderHistory(fresh) {
  const d = shownDraw();
  const mine = new Set();
  if (d && placed && placed.round === d.round) placed.tickets.forEach((x) => x.picks.forEach((n) => mine.add(n)));
  const key = d ? d.round + ':' + (d.round === resultRound) + ':' + [...mine].join(',') : '-';
  if (key === histKey) return;
  histKey = key;
  if (!d) { $('history').innerHTML = '<span class="history__empty">The draws appear here</span>'; setText($('histRound'), '—'); return; }
  setText($('histLabel'), d.round === resultRound ? 'THIS DRAW' : 'LAST DRAW');
  setText($('histRound'), '#' + d.round);
  $('history').innerHTML = d.outcome.balls.map((n, i) => miniBall(n, mine.has(n), fresh)).join('');
  if (fresh) $('history').querySelectorAll('.mb').forEach((el, i) => { el.style.animationDelay = (i * 40) + 'ms'; });
}
function ticketsText(bets) {
  return (bets || []).map((b) => { const t = K.ticket(b.spot); return t ? t.length : '?'; }).join(' + ') || '—';
}
function renderList() {
  let rows, cols, count;
  if (tab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Picks</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && resultRound === S.round;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + (showWin && b.win > 0 ? ' row--won' : '') + '"><span>' + esc(b.player || 'Player') + '</span><span><span class="row__tk">' + esc(ticketsText(b.bets)) + '</span></span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Bets this round');
  } else if (tab === 'mine') {
    const mine = S.myBets.filter((m) => !(m.round === round && resultRound !== round));
    cols = '<span>Round</span><span>Hits</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => {
      const balls = (m.outcome && m.outcome.balls) || [];
      const hits = (m.bets || []).map((b) => { const t = K.ticket(b.spot) || []; return t.filter((n) => balls.indexOf(n) >= 0).length + '/' + t.length; }).join(' · ');
      return '<div class="row' + (m.win > 0 ? ' row--won' : '') + '"><span>#' + m.round + '</span><span>' + esc(hits) + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>';
    });
    setText($('countLabel'), 'My draws');
  } else {
    const hist = S.history.filter((h) => h.outcome && h.outcome.balls && !(h.round === round && resultRound !== round));
    const c = new Array(41).fill(0);
    hist.forEach((h) => h.outcome.balls.forEach((n) => { c[n]++; }));
    const order = []; for (let n = 1; n <= 40; n++) order.push(n);
    const byC = order.slice().sort((a, b) => c[b] - c[a] || a - b);
    const hot = new Set(hist.length ? byC.slice(0, 5) : []), cold = new Set(hist.length ? byC.slice(-5) : []);
    cols = '';
    count = hist.length;
    rows = ['<div class="heat">' + order.map((n) => '<div class="' + (hot.has(n) ? 'hot' : cold.has(n) ? 'cold' : '') + '">' + n + '<small>' + c[n] + '</small></div>').join('') + '</div><div class="heat__note">Hot = drawn most, cold = drawn least in the last ' + hist.length + ' draws. Every draw is independent — each number is always equally likely.</div>'];
    setText($('countLabel'), 'Draws counted');
  }
  const key = tab + '|' + rows.join('');
  if (key === listKey) return;
  listKey = key;
  $('cols').innerHTML = cols; $('cols').hidden = !cols;
  setText($('betCount'), String(count));
  $('list').innerHTML = rows.join('') || '<div class="empty">' + (tab === 'all' ? 'No bets yet this round' : 'Your draws will show here') + '</div>';
}

// ---------------------------------------------------------------- layout: play area + scene size
let layoutRaf = 0;
function layout() {
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    const stage = $('stage'), sr = stage.getBoundingClientRect(), hist = $('historyBox'), wide = WIDE.matches;
    T[1].el.sec.hidden = !wide;
    if (!wide) T[1].armed = false;
    const top = $('top').getBoundingClientRect();
    let A;
    if (wide) {
      const side = $('side').getBoundingClientRect(), tw = $('tablewrap').getBoundingClientRect();
      hist.style.top = Math.round(tw.top - sr.top - 48) + 'px';
      const L = side.right - sr.left + 10, T0 = top.bottom - sr.top + 2;
      A = { L, T: T0, W: sr.width - L - 10, H: Math.max(160, tw.top - sr.top - 52 - T0) };
    } else {
      hist.style.top = '';
      const hb = hist.getBoundingClientRect(), T0 = top.bottom - sr.top + 2;
      A = { L: 0, T: T0, W: sr.width, H: Math.max(150, hb.top - sr.top - T0 - 2) };
    }
    const play = $('play');
    play.style.left = A.L + 'px'; play.style.top = A.T + 'px'; play.style.width = A.W + 'px'; play.style.height = A.H + 'px';
    stage.style.setProperty('--below', Math.max(0, sr.height - A.T - A.H) + 'px');
    stage.style.setProperty('--left', A.L + 'px');
    if (scene) { scene.resize(sr.width, sr.height, A); placeTimer(A, wide); }
    if (scene && !readySent) { readySent = true; requestAnimationFrame(() => { game.ready(); game.theme(scene.topColor); }); }
  });
}

// the countdown sits beside the glass, left of the sphere (the returning balls come in on the right)
function placeTimer(A, wide) {
  const t = $('timer'), size = wide ? 112 : 92;
  const sp = scene && scene.sphere ? scene.sphere() : null;
  if (!sp) { t.style.left = ''; t.style.top = ''; t.style.transform = ''; return; }
  const room = sp.x - sp.r - A.L - 14;                  // free width left of the glass
  const k = Math.max(0.62, Math.min(1, room / size));
  const cx = Math.max(A.L + (size * k) / 2 + 6, sp.x - sp.r - 8 - (size * k) / 2);
  t.style.left = (cx - A.L) + 'px';
  t.style.top = (sp.y - A.T - sp.r * 0.15) + 'px';
  t.style.transform = k < 1 ? 'scale(' + k.toFixed(3) + ')' : '';
}

// ---------------------------------------------------------------- wiring
function wire() {
  $('back').addEventListener('click', () => game.back());
  const paintToggles = () => { $('music').setAttribute('aria-pressed', sound.music() ? 'true' : 'false'); $('sound').setAttribute('aria-pressed', sound.sound() ? 'true' : 'false'); };
  $('music').addEventListener('click', () => { sound.music(!sound.music()); paintToggles(); });
  $('sound').addEventListener('click', () => { sound.sound(!sound.sound()); paintToggles(); });
  paintToggles();
  document.querySelectorAll('.bets__tab').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.bets__tab').forEach((x) => { x.classList.toggle('bets__tab--on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    listKey = ''; render();
  }));
  const modal = (id, on) => { $(id).hidden = !on; };
  $('rulesBtn').addEventListener('click', () => modal('rules', true));
  $('rulesClose').addEventListener('click', () => modal('rules', false));
  $('rules').addEventListener('click', (e) => { if (e.target === $('rules')) modal('rules', false); });
  $('histMore').addEventListener('click', openDraws);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { modal('rules', false); const d = $('draws'); if (d) d.hidden = true; } });
  $('fair').addEventListener('click', () => { $('fairDetail').hidden = !$('fairDetail').hidden; });
  $('fCheckBtn').addEventListener('click', verifyLast);
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) { const ro = new ResizeObserver(layout); ro.observe($('stage')); ro.observe($('tablewrap')); }
  WIDE.addEventListener('change', () => { layout(); updateMine(); render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && game && scene) game.theme(scene.topColor); });
  // the pay table in the rules
  let h = '<table><tr><th>PICKS</th>' + Array.from({ length: 10 }, (_, i) => '<th>' + (i + 1) + ' HIT' + (i ? 'S' : '') + '</th>').join('') + '</tr>';
  for (let k = 1; k <= 10; k++) { h += '<tr><td>' + k + '</td>'; for (let i = 1; i <= 10; i++) h += '<td>' + (i <= k && K.PAYS[k][i] >= 1 ? '<b>' + fx(K.PAYS[k][i]) + '</b>' : i <= k ? '—' : '') + '</td>'; h += '</tr>'; }
  $('payTable').innerHTML = h + '</table>';
}
function openDraws() {
  let m = $('draws');
  if (!m) {
    m = document.createElement('div'); m.className = 'modal'; m.id = 'draws'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="modal__card"><button type="button" class="modal__close" aria-label="Close">×</button><h2>Last draws</h2><div id="drawsList"></div></div>';
    m.addEventListener('click', (e) => { if (e.target === m || e.target.classList.contains('modal__close')) m.hidden = true; });
    $('game').appendChild(m);
  }
  const hist = S ? S.history.filter((h) => h.outcome && h.outcome.balls && !(h.round === round && resultRound !== round)).slice(0, 20) : [];
  $('drawsList').innerHTML = hist.map((h) => '<div class="draws__row"><span>#' + h.round + '</span>' + h.outcome.balls.map((n) => miniBall(n, false, false)).join('') + '</div>').join('') || '<p class="muted">The draws appear here.</p>';
  m.hidden = false;
}

function hexBytes(hex) { const o = new Uint8Array(hex.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(hex.substr(i * 2, 2), 16); return o; }
function verifyLast() {
  const out = $('fCheck'); out.hidden = false;
  if (!lastSeed || !lastSeed.seed) { out.textContent = 'Wait for a draw to finish while you are at the table — its seed is revealed then.'; return; }
  out.textContent = 'Checking…';
  const L = lastSeed;
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: 'keno40', gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const b = res[1].outcome.balls;
    out.innerHTML = 'Round ' + L.round + ': <b>' + b.join(' · ') + '</b>. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (!L.balls || b.join() === L.balls.join() ? '✓ same balls as drawn' : '✗ balls differ');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

// first snapshot: put the machine in the state the round is in
function syncFromSnapshot() {
  started = true;
  round = S.round;
  const stored = safeSS('kenovortex:placed');
  if (stored && stored.round === S.round && (S.phase === 'betting' || S.phase === 'dealing')) { placed = stored; placed.restored = true; }
  if (S.phase === 'dealing') {
    closedRound = round;
    setStatus('closed'); $('drawpill').hidden = false; $('status').hidden = true;
    if (scene) scene.blow(true, true);
    sound.play('blower-on');
    (S.deals || []).filter((x) => x.kind === 'ball' && x.value != null).forEach((x) => { if (scene) scene.draw(x.step, x.value, true); if (drawn.indexOf(x.value) < 0) drawn.push(x.value); });
    paintBall(drawn.length);
  } else if (S.phase === 'betting') {
    setStatus('betting');
    if (Date.now() >= S.endsAt) closeRound();
  } else {
    const res = S.result && S.result.balls ? S.result.balls : null;
    if (res) { if (scene) scene.place(res); drawn = res.slice(); resultRound = round; }
    setStatus('wait');
  }
  updateMine(); paintAll(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
buildTickets(); wire();
setStatus('wait');
game = window.NXTable.start({
  event: EVENT, game: 'keno40',
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
  const min = l && l.min > 0 ? l.min : 0.1;
  quickVals = [1, 2, 5, 10].map((x) => r2(min * x));
  T.forEach((t) => { if (!(t.stake >= min - 1e-9) || (l.max > 0 && t.stake > l.max)) t.stake = min; });
  setText($('rMin'), money(min)); setText($('rMax'), money(l.max || 100));
  paintAll(); render();
});
T.forEach((t) => { if (!t.stake) t.stake = 0.1; });
createScene($('scene'), {
  landed,
  whoosh: () => sound.play('whoosh'),
}).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  window.__kv = { scene: sc, game, state: () => ({ round, closedRound, resultRound, started, placed, drawn: drawn.slice(), tickets: T.map((t) => ({ id: t.id, picks: t.picks, stake: t.stake, armed: t.armed })) }) }; // QA hook
  layout();
  updateMine();
  if (!started && S && S.gotSnapshot && S.phase !== 'waiting') syncFromSnapshot();
});
setTimeout(() => { if (!started && scene) syncFromSnapshot(); }, 5000);
paintAll();
layout();
requestAnimationFrame(tick);
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#0f0724'); } }, 6000);
