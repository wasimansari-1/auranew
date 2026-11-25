/* Spiral Derby (88.0095) — 8 marbles race every 30 s, the same race for every player (engine draw
 * game "ballrace": nexorng-engine/internal/tables/ballrace.go; client rules: rules.js; track and
 * keyframe playback: race.js; 3D: scene.js).
 *   12 s betting → 13.5 s race (the "race" step carries the engine's keyframes; the gate lifts at
 *   0.4 s, the winner crosses at 10.4 s, one "ball" step per finisher) → result (3.8 s) → the lift
 *   carries the marbles back to the gate while the next bets are open.
 * The race card builds ONE ticket (up to 20 bets) sent in one bet call (Place bets, or automatically
 * 1.5 s before the gate lifts). Settlement lives in ../_core/table-client.js.
 */
import { create as createScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0095';
const BETTING_MS = 12000;
const AUTO_SEND_MS = 1500;
const LIFT_DELAY = 0.6, LIFT_S = 3.1, LIFT_GAP = 0.22;
const MAX_LINES = 20;
const Q_X = [1, 2, 5, 10];
const LADDER = [1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 400, 500, 1000];
const RULES = window.SDRules;
const PLACE = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'];
const GROUPS = [['fire', 'FIRE', [1, 2]], ['citrus', 'CITRUS', [3, 4]], ['ocean', 'OCEAN', [5, 6]], ['royal', 'ROYAL', [7, 8]]];
const GNAME = { fire: 'FIRE', citrus: 'CITRUS', ocean: 'OCEAN', royal: 'ROYAL' };
const KINDS = [
  { k: 'win', label: 'WIN', pays: '7.70×', need: 1, hint: 'Pick the marble that finishes <b>1st</b>' },
  { k: 'top2', label: 'TOP 2', pays: '27×', need: 2, hint: 'Pick <b>two</b> marbles for 1st and 2nd, any order' },
  { k: 'exacta', label: 'EXACTA', pays: '54×', need: 2, hint: 'Pick the <b>1st</b>, then the <b>2nd</b> — exact order' },
  { k: 'top3', label: 'TOP 3', pays: '54×', need: 3, hint: 'Pick <b>three</b> marbles for the podium, any order' },
  { k: 'oddeven', label: 'ODD/EVEN', pays: '1.93×', need: 0, hint: 'The <b>winner’s number</b> is odd or even' },
  { k: 'colour', label: 'COLOUR', pays: '3.86×', need: 0, hint: 'The winner is in your <b>colour pair</b>' },
];
const PH = {
  betting: ['Pick your marble', 'Bets are open — back a marble', 'Who takes the spiral tonight?', 'Eight marbles, one winner', 'Gates lift soon — place your ticket', 'Feeling lucky? Pick a runner'],
  last: ['Last bets…', 'Gates lift in a moment', 'Final call — place your ticket'],
  closed: ['And they’re off!', 'Gates up — here they roll!', 'Down the ramp they go…', 'Into the spiral…'],
  wait: ['Next race soon', 'The lift is bringing them back', 'Get your ticket ready', 'A new race is coming up'],
  noBet: ['Wait for the next race', 'The race is on — next race soon', 'Bets open again in a moment'],
  win: ['What a finish!', 'Your marble came through!', 'Winner, winner!', 'Right on the line!'],
  lose: ['So close — next race in a moment', 'Not this time — they race again soon', 'Next race could be yours'],
};

// ---------------------------------------------------------------- state
const sound = window.SDAudio.create();
let scene = null, game = null, S = null;
let minBet = 0.5, stake = 0.5, kind = 'win', picks = [];
let lines = [];                     // [{ spot, amt }] — the ticket being built
let placed = null, placing = false, lastBets = null;
let round = 0, closedRound = 0, autoRound = 0, raceRound = 0, resultRound = 0, wonRound = 0, lastTick = -1;
let race = null, raceT0 = 0, rank = null, rankKey = '', lastOrder = null, liftedRound = 0;
let started = false, readySent = false, tab = 'all', lastSeed = null, syncedEarly = false, clockSkew = 0, winnerShown = 0;
const PICK = {}, ORDER_EL = {};

function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function perf() { return performance.now() / 1000; }
function ball(n, cls) { return '<span class="ball c' + n + (n === 6 ? ' u6' : '') + (cls ? ' ' + cls : '') + '"><b>' + n + '</b></span>'; }
function total() { return r2(lines.reduce((t, l) => t + l.amt, 0)); }
let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
let statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  const el = $('status'); el.textContent = text || pick(PH[key] || ['']); el.dataset.kind = key;
}
function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

// ---------------------------------------------------------------- the race card (built once)
function buildCard() {
  const tabs = $('tabs');
  KINDS.forEach((K) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.dataset.k = K.k; b.setAttribute('role', 'tab');
    b.innerHTML = '<b>' + K.label + '</b><i>' + K.pays + '</i>';
    b.addEventListener('click', () => { if (kind !== K.k) { kind = K.k; picks = []; sound.play('chip'); paintCard(); } });
    tabs.appendChild(b);
  });
  const quick = $('quick');
  Q_X.forEach((x) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'q'; b.dataset.x = x; b.textContent = x + '×';
    b.addEventListener('click', () => { setStake(r2(minBet * x)); sound.play('chip'); });
    quick.appendChild(b);
  });
  $('minus').addEventListener('click', () => stepStake(-1));
  $('plus').addEventListener('click', () => stepStake(1));
  $('pick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-n],[data-spot]');
    if (!b) return;
    if (b.dataset.spot) addLine(b.dataset.spot, b);
    else tapBall(+b.dataset.n, b);
  });
  $('ticketRows').addEventListener('click', (e) => { const x = e.target.closest('.tl__x'); if (x) removeLine(x.dataset.spot); });
}
function stakeSteps() { const max = game ? game.limit().max : 0; return LADDER.map((x) => r2(minBet * x)).filter((v) => !max || v <= max + 1e-9); }
function setStake(v) { stake = v; paintStake(); }
function stepStake(d) {
  const st = stakeSteps(); let i = st.findIndex((v) => v >= stake - 1e-9); if (i < 0) i = st.length - 1;
  if (st[i] > stake + 1e-9 && d < 0) i--; else i += d;
  setStake(st[Math.max(0, Math.min(st.length - 1, i))]); sound.play('chip');
}
function paintStake() {
  setText($('amount'), money(stake));
  Array.prototype.forEach.call($('quick').children, (b) => { b.classList.toggle('q--on', Math.abs(r2(minBet * +b.dataset.x) - stake) < 1e-9); });
  const st = stakeSteps(), lock = locked();
  $('minus').disabled = lock || stake <= st[0] + 1e-9; $('plus').disabled = lock || stake >= st[st.length - 1] - 1e-9;
}
function lineOf(spot) { return lines.find((l) => l.spot === spot); }
function amtOn(n) { return lines.filter((l) => l.spot === 'win:' + n).reduce((t, l) => t + l.amt, 0); }
function paintCard() {
  const K = KINDS.find((x) => x.k === kind);
  Array.prototype.forEach.call($('tabs').children, (b) => {
    b.classList.toggle('tab--on', b.dataset.k === kind);
    b.setAttribute('aria-selected', b.dataset.k === kind ? 'true' : 'false');
    const k = b.dataset.k;
    b.classList.toggle('tab--has', (placedLines() || lines).some((l) => kindOf(l.spot) === k));
  });
  const box = $('pick');
  if (K.need) {
    if (box.dataset.mode !== 'balls') {
      box.dataset.mode = 'balls'; box.innerHTML = '';
      for (let n = 1; n <= 8; n++) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pk'; b.dataset.n = n; b.setAttribute('aria-label', 'Marble ' + n);
        b.innerHTML = ball(n) + '<span class="pk__badge" hidden></span><span class="pk__amt" hidden></span>';
        box.appendChild(b);
        PICK[n] = { el: b, badge: b.querySelector('.pk__badge'), amt: b.querySelector('.pk__amt') };
      }
    }
    const show = placedLines() || lines;
    for (let n = 1; n <= 8; n++) {
      const P = PICK[n], i = picks.indexOf(n);
      P.el.classList.toggle('pk--sel', i >= 0);
      const on = show.some((l) => RULES.parse(l.spot) && RULES.parse(l.spot).n.indexOf(n) >= 0 && RULES.parse(l.spot).kind === kind);
      P.el.classList.toggle('pk--on', on && i < 0);
      const badge = i < 0 ? '' : kind === 'exacta' ? PLACE[i] : String(i + 1);
      P.badge.hidden = !badge; setText(P.badge, badge);
      const a = kind === 'win' ? show.filter((l) => l.spot === 'win:' + n).reduce((t, l) => t + l.amt, 0) : 0;
      P.amt.hidden = !a; setText(P.amt, a ? money(a) : '');
    }
  } else {
    const mode = kind;
    if (box.dataset.mode !== mode) {
      box.dataset.mode = mode;
      box.innerHTML = mode === 'oddeven'
        ? '<div class="bigs"><button type="button" class="big" data-spot="odd">ODD ' + [1, 3, 5, 7].map((n) => ball(n)).join('') + '</button><button type="button" class="big" data-spot="even">EVEN ' + [2, 4, 6, 8].map((n) => ball(n)).join('') + '</button></div>'
        : '<div class="bigs">' + GROUPS.map((g) => '<button type="button" class="big" data-spot="colour:' + g[0] + '">' + ball(g[2][0]) + ball(g[2][1]) + '<small>' + g[1] + '</small></button>').join('') + '</div>';
    }
    const show = placedLines() || lines;
    box.querySelectorAll('.big').forEach((b) => b.classList.toggle('big--on', show.some((l) => l.spot === b.dataset.spot)));
  }
  const hint = K.hint + (picks.length && K.need > 1 ? ' · <b>' + picks.join(kind === 'exacta' ? ' → ' : ' + ') + '</b>' : '');
  $('hint').innerHTML = '<span>' + hint + '</span><span>pays <b>' + K.pays + '</b></span>';
  paintTicket(); paintStake(); updateControls();
}
function kindOf(spot) { const p = RULES.parse(spot); return !p ? '' : p.kind === 'odd' || p.kind === 'even' ? 'oddeven' : p.kind; }
function placedLines() { return placed && placed.round === round ? placed.lines : null; }

// ---------------------------------------------------------------- betting
function bettingOpen() { return !!S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function locked() { return !!(placed && placed.round === round) || placing; }
function free() { const b = S && S.balance != null ? S.balance : null; return b == null ? Infinity : r2(b - total()); }

function tapBall(n, el) {
  sound.play('chip');
  if (!bettingOpen()) { toast(pick(PH.noBet)); sound.play('error'); return; }
  if (locked()) { toast('Your ticket is placed for this race.'); return; }
  const K = KINDS.find((x) => x.k === kind);
  if (K.need === 1) return addLine('win:' + n, el);
  const i = picks.indexOf(n);
  if (i >= 0) { picks.splice(i, 1); paintCard(); return; }
  picks.push(n);
  if (picks.length < K.need) { paintCard(); return; }
  const p = picks.slice(); picks = [];
  const spot = kind === 'exacta' ? 'exacta:' + p[0] + '-' + p[1] : kind + ':' + p.sort((a, b) => a - b).join('-');
  addLine(spot, el);
}
function addLine(spot, el) {
  if (!bettingOpen()) { toast(pick(PH.noBet)); sound.play('error'); paintCard(); return; }
  if (locked()) { toast('Your ticket is placed for this race.'); paintCard(); return; }
  if (!game.validSpot(spot)) { sound.play('error'); paintCard(); return; }
  const lim = game.limit(), have = lineOf(spot);
  let amt = stake;
  if (!have && lines.length >= MAX_LINES) { toast('A ticket holds up to ' + MAX_LINES + ' bets.'); sound.play('error'); paintCard(); return; }
  if (lim.max > 0 && total() + amt > lim.max + 1e-9) {
    if (total() >= lim.max - 1e-9) { toast('Max ' + money(lim.max) + ' per race.'); sound.play('error'); paintCard(); return; }
    amt = r2(lim.max - total());
  }
  if (amt > free() + 1e-9) { toast('Not enough balance.'); sound.play('error'); paintCard(); return; }
  if (have) have.amt = r2(have.amt + amt); else lines.push({ spot, amt });
  sound.play('chips');
  if (el) flyTo(el, spot);
  paintCard(); render();
}
function removeLine(spot) {
  if (locked()) return;
  lines = lines.filter((l) => l.spot !== spot);
  sound.play('clear'); paintCard(); render();
}
function repeatLast() {
  if (locked() || !bettingOpen() || !lastBets) return;
  const need = r2(lastBets.reduce((t, l) => t + l.amt, 0)), lim = game.limit();
  if (lim.max > 0 && need > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per race.'); return; }
  if (need > free() + 1e-9) { toast('Not enough balance to repeat.'); sound.play('error'); return; }
  lines = lastBets.map((l) => ({ spot: l.spot, amt: l.amt }));
  sound.play('chips'); paintCard(); render();
}
function submit(auto) {
  if (locked() || !lines.length) return;
  if (!bettingOpen() && !auto) return;
  const lim = game.limit(), t = total();
  if (lim.min > 0 && t < lim.min - 1e-9) { if (!auto) { toast('Minimum ' + money(lim.min) + ' per race.'); sound.play('error'); } return; }
  const r = round, snap = lines.map((l) => ({ spot: l.spot, amt: l.amt }));
  placing = true; updateControls();
  game.bet(snap.map((l) => ({ spot: l.spot, amount: l.amt }))).then((res) => {
    placing = false;
    placed = { round: r, lines: snap, total: t, maxWin: res && res.maxWin != null ? Number(res.maxWin) : null };
    safeSS('spiralderby:placed', placed);
    if (placed.maxWin > 0) { setText($('rCap'), money(placed.maxWin)); $('rCapLine').hidden = false; }
    lastBets = snap; lines = [];
    sound.play('placed');
    setStatus('placed', auto ? 'Your ticket is in — good luck!' : 'Bets accepted — good luck!');
    paintCard(); render();
  }).catch(() => { placing = false; updateControls(); render(); });
}

// ticket rows (built lines, placed lines with live status, settled lines with wins)
let ticketKey = '';
function spotLabel(spot) {
  const p = RULES.parse(spot);
  if (!p) return { k: spot, sel: '' };
  const K = { win: 'WIN', top2: 'TOP 2', exacta: 'EXACTA', top3: 'TOP 3', odd: 'ODD/EVEN', even: 'ODD/EVEN', colour: 'COLOUR' }[p.kind];
  let sel;
  if (p.kind === 'odd' || p.kind === 'even') sel = '<span class="tl__tag">' + p.kind.toUpperCase() + ' WINNER</span>';
  else if (p.kind === 'colour') sel = ball(p.n[0]) + ball(p.n[1]) + '<span class="tl__tag">' + GNAME[p.group] + '</span>';
  else sel = p.n.map((n) => ball(n)).join(p.kind === 'exacta' ? '<i>→</i>' : '');
  return { k: K, sel };
}
function liveOf(spot) { // during the race: is this bet in the money right now?
  if (!rank) return null;
  const p = RULES.parse(spot), pos = (n) => rank.indexOf(n) + 1, w = rank[0];
  switch (p.kind) {
    case 'win': return pos(p.n[0]) === 1 ? ['on', 'LEADING'] : ['off', 'P' + pos(p.n[0])];
    case 'top2': return p.n.every((n) => pos(n) <= 2) ? ['on', 'IN'] : ['off', 'CHASING'];
    case 'exacta': return pos(p.n[0]) === 1 && pos(p.n[1]) === 2 ? ['on', 'IN'] : ['off', 'CHASING'];
    case 'top3': return p.n.every((n) => pos(n) <= 3) ? ['on', 'IN'] : ['off', 'CHASING'];
    case 'odd': return w % 2 ? ['on', 'ON'] : ['off', 'OFF'];
    case 'even': return w % 2 ? ['off', 'OFF'] : ['on', 'ON'];
    case 'colour': return p.n.indexOf(w) >= 0 ? ['on', 'ON'] : ['off', 'OFF'];
  }
  return null;
}
function paintTicket() {
  const pl = placedLines(), show = pl || lines, settled = pl && resultRound === round && S && S.result;
  const rows = show.map((l) => {
    const L = spotLabel(l.spot);
    let right = '', cls = '';
    if (settled) {
      const x = game.pay(S.result, l.spot);
      cls = x > 0 ? ' tl--won' : ' tl--lost';
      right = '<span class="tl__r">' + (x > 0 ? '+' + money(game.round2(l.amt * x)) : '—') + '</span>';
    } else if (pl && raceRound === round && rank) {
      const lv = liveOf(l.spot);
      right = '<span class="tl__r" data-live="' + lv[0] + '">' + lv[1] + '</span>';
    } else if (pl) right = '<span class="tl__r">pays ' + money(game.round2(l.amt * game.pay(fakeWin(l.spot), l.spot))) + '</span>';
    else right = '<span class="tl__r">pays ' + money(game.round2(l.amt * game.pay(fakeWin(l.spot), l.spot))) + '</span><button type="button" class="tl__x" data-spot="' + esc(l.spot) + '" aria-label="Remove">×</button>';
    return '<div class="tl' + cls + '"><span class="tl__k">' + L.k + '</span><span class="tl__sel">' + L.sel + '</span><span class="tl__amt">' + money(l.amt) + '</span>' + right + '</div>';
  }).join('');
  const key = rows;
  if (key !== ticketKey) { ticketKey = key; $('ticketRows').innerHTML = rows; }
  $('ticketEmpty').hidden = show.length > 0;
  const st = $('stamp');
  if (settled) { st.hidden = false; st.dataset.kind = 'paid'; setText(st, 'PAID'); }
  else if (pl) { st.hidden = false; st.dataset.kind = ''; setText(st, raceRound === round ? 'RACING' : 'PLACED'); }
  else st.hidden = true;
}
function fakeWin(spot) { // an outcome where this spot wins (to show what it pays)
  const p = RULES.parse(spot), o = [];
  if (p.kind === 'odd') o.push(1); else if (p.kind === 'even') o.push(2); else if (p.kind === 'colour') o.push(p.n[0]); else p.n.forEach((n) => o.push(n));
  for (let n = 1; n <= 8; n++) if (o.indexOf(n) < 0) o.push(n);
  return { balls: o };
}

function updateControls() {
  if (!S) return;
  const open = bettingOpen(), lock = locked(), t = total();
  const place = $('action');
  place.classList.remove('place--done', 'place--won');
  let label, sub = '';
  if (placing) { place.disabled = true; label = 'Placing…'; sub = money(t); }
  else if (placed && placed.round === round) {
    place.disabled = true;
    if (wonRound === round && resultRound === round) { place.classList.add('place--won'); label = 'You won ' + money(placed.win || 0); sub = 'next race soon'; }
    else { place.classList.add('place--done'); label = 'Bets placed · ' + money(placed.total); sub = S.phase === 'betting' ? 'good luck!' : 'racing — good luck'; }
  } else if (open && lines.length) { place.disabled = false; label = 'Place bets · ' + money(t); sub = 'auto-placed before the gate lifts'; }
  else if (open && lastBets) { place.disabled = false; label = 'Repeat last ticket · ' + money(r2(lastBets.reduce((a, l) => a + l.amt, 0))); sub = 'or tap a marble'; }
  else if (open) { place.disabled = true; label = 'Tap a marble to bet'; sub = 'stake ' + money(stake); }
  else { place.disabled = true; label = S.phase === 'betting' || S.phase === 'dealing' ? 'Race on · bets closed' : 'Next race soon'; }
  setText($('placeLabel'), label); setText($('placeSub'), sub);
  setText($('cardSub'), placed && placed.round === round ? placed.lines.length + ' bet' + (placed.lines.length > 1 ? 's' : '') + ' · ' + money(placed.total) : lines.length ? lines.length + ' bet' + (lines.length > 1 ? 's' : '') + ' · ' + money(t) : 'pick a bet, tap the marbles');
  $('card').classList.toggle('card--closed', !open || lock);
}

// chip flight from the tapped marble to the ticket
function center(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function flyTo(el) {
  const from = center(el), to = center($('ticket')), f = document.createElement('div');
  f.className = 'fchip'; f.style.background = 'radial-gradient(circle at 40% 35%, #fff3cf, #ffbb60 60%, #c07a20)';
  $('fx').appendChild(f);
  const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 30 };
  const a = f.animate([{ transform: `translate(${from.x}px,${from.y}px) scale(.8)`, opacity: 1 }, { transform: `translate(${mid.x}px,${mid.y}px) scale(1)`, opacity: 1, offset: 0.5 }, { transform: `translate(${to.x}px,${to.y}px) scale(.6)`, opacity: 0 }], { duration: 380, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
  a.onfinish = a.oncancel = () => f.remove();
}

// ---------------------------------------------------------------- round flow
function onSignal(type, d) {
  if (type === 'betting') onBetting(false);
  else if (type === 'deal') onDeal(d.step, false);
  else if (type === 'result') onResult(d);
  else if (type === 'error') { toast(d.text); sound.play('error'); }
}
function gateEndsPerf() { return perf() + (S.endsAt - Date.now()) / 1000; }
function onBetting(fromSnapshot) {
  round = S.round; lastTick = -1; winnerShown = 0; rank = null; race = null;
  if (placed && placed.round !== round) placed = null;
  lines = []; picks = [];
  hideResult();
  setStatus('betting');
  if (!fromSnapshot) sound.play('open');
  // the lift brings the last race's marbles back to the gate
  const since = (S.endsAt - BETTING_MS - Date.now()) / 1000; // ≤ 0: minus the seconds since betting opened
  const order = S.history[0] && S.history[0].outcome && S.history[0].outcome.balls;
  if (scene) {
    if (order && liftedRound !== round && -since < LIFT_DELAY + LIFT_S + 8 * LIFT_GAP) { liftedRound = round; scene.lift(order, perf() + since + LIFT_DELAY); }
    else scene.idle(gateEndsPerf());
    scene.setGateEnds(gateEndsPerf());
  }
  $('order').hidden = true; $('live').hidden = true;
  paintCard(); render();
}
function closeRound() {
  closedRound = round;
  setStatus('closed');
  sound.play('closed');
  if (!placing && lines.length) { lines = []; paintCard(); } // never placed: back off the ticket
  updateControls(); render();
}
function onDeal(step, fromSnapshot) {
  if (!step) return;
  if (closedRound !== step.round) closeRound();
  if (step.kind === 'race' && step.data && raceRound !== step.round) {
    const r = window.SDRace.decode(step.data);
    if (!r) return;
    let elapsed = 0;
    if (step.time) {
      const sv = Date.parse(step.time);
      if (!fromSnapshot) clockSkew = Date.now() - sv; // our clock vs the server's, from a live step
      else elapsed = Math.max(0, (Date.now() - clockSkew - sv) / 1000);
    }
    race = r; raceRound = step.round; raceT0 = perf() - elapsed;
    if (scene) scene.race(r, raceT0);
    if (elapsed < 0.3) setTimeout(() => sound.play('gate'), 120);
    $('order').hidden = false; buildOrder(r.balls);
  }
}
function myWin(outcome) {
  if (!placed || placed.round !== round) return null;
  let w = 0;
  placed.lines.forEach((l) => { w += game.round2(l.amt * game.pay(outcome, l.spot)); }); // floored per bet, like the engine
  w = r2(w);
  if (placed.maxWin > 0 && w > placed.maxWin) w = placed.maxWin;
  return w;
}
function onResult(d) {
  const o = d.outcome;
  if (!o || !o.balls) return;
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, balls: o.balls };
  round = S.round; resultRound = S.round; lastOrder = o.balls;
  const restored = placed && placed.round === S.round && placed.restored;
  if (restored) setTimeout(refreshBalance, 800);
  if (placed && placed.round === S.round) { safeSS('spiralderby:placed', null); const my = S.myBets[0]; if (my && my.round === S.round) placed.win = my.win; }
  const finish = () => {
    if (round !== S.round || resultRound !== round) return;
    if (scene) scene.parked(o.balls, true);
    showResult(o);
    $('order').hidden = true; $('live').hidden = true;
    render();
  };
  // the race may still be finishing on this screen (late join): let it end first
  const left = scene && scene.racing() ? Math.max(0, 13.45 - scene.raceTime()) : 0;
  if (left > 0.05) setTimeout(finish, left * 1000); else finish();
}
function showResult(o) {
  const b = o.balls, w = b[0];
  $('podium').innerHTML = '<div>' + ball(b[1]) + '2ND</div><div>' + ball(w) + 'WINNER</div><div>' + ball(b[2]) + '3RD</div>';
  const grp = GROUPS.find((g) => g[2].indexOf(w) >= 0);
  $('tags').innerHTML = '<span class="tag">' + (w % 2 ? 'ODD' : 'EVEN') + '</span><span class="tag" style="border-color:var(--b' + grp[2][0] + ')">' + grp[1] + '</span>';
  setText($('resTitle'), 'RACE #' + S.round + ' RESULT');
  $('play').classList.add('play--result');
  const res = $('result'); res.hidden = false; res.classList.remove('result--in'); void res.offsetWidth; res.classList.add('result--in');
  const win = myWin(o);
  const ban = $('banner');
  if (win != null && win > 0) {
    wonRound = round; placed.win = win;
    setText($('bannerTitle'), 'You win'); setText($('bannerWin'), money(win));
    setText($('bannerSub'), placed.maxWin > 0 && win >= placed.maxWin ? 'max win per race' : '');
    ban.hidden = false; ban.classList.remove('banner--in'); void ban.offsetWidth; ban.classList.add('banner--in');
    setStatus('win', 'Marble ' + w + ' wins — ' + pick(PH.win));
    sound.play('win', win >= placed.total * 5);
    const bal = $('balance'); bal.classList.add('bump'); setTimeout(() => bal.classList.remove('bump'), 500);
  } else {
    ban.hidden = true;
    if (win != null) { setStatus('lose', 'Marble ' + w + ' wins. ' + pick(PH.lose)); sound.play('lose'); }
    else setStatus('result', 'Marble ' + w + ' wins!');
  }
  paintCard();
}
function hideResult() { $('result').hidden = true; $('banner').hidden = true; $('play').classList.remove('play--result'); }
function refreshBalance() {
  const tok = (() => { try { return localStorage.getItem('token'); } catch (e) { return null; } })();
  if (!tok || tok === 'demo' || !game) return;
  fetch(game.apiUrl('/playerBalance'), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } })
    .then((r) => r.json()).then((p) => { const b = p && p.data && p.data.balance; if (b != null) { S.balance = Number(b); render(); } }).catch(() => {});
}

// running order strip (balls slide between places; DOM only touched when the order changes)
function buildOrder(balls) {
  const box = $('order');
  if (box.dataset.built !== '1') {
    box.dataset.built = '1';
    box.innerHTML = PLACE.map((p) => '<div class="pl"><em>' + p + '</em></div>').join('');
    for (let n = 1; n <= 8; n++) {
      const s = document.createElement('span'); s.className = 'ball c' + n + (n === 6 ? ' u6' : ''); s.innerHTML = '<b>' + n + '</b>';
      s.style.position = 'absolute'; s.style.top = '5px'; s.style.left = '8px'; s.style.transition = 'transform .3s cubic-bezier(.3,.7,.3,1), box-shadow .3s';
      box.appendChild(s); ORDER_EL[n] = s;
    }
  }
  rankKey = '';
}
function myBalls() {
  const pl = placedLines(); if (!pl) return [];
  const out = [];
  pl.forEach((l) => { const p = RULES.parse(l.spot); if (p && p.kind !== 'odd' && p.kind !== 'even' && p.kind !== 'colour') p.n.forEach((n) => { if (out.indexOf(n) < 0) out.push(n); }); });
  return out;
}
function paintOrder() {
  if (!race || raceRound !== round || !scene || !scene.racing()) return;
  const t = perf() - raceT0, pos = race.at(t);
  const r = pos.slice().sort((a, b) => b.s - a.s).map((p) => p.ball);
  const key = r.join('');
  if (key === rankKey) return;
  rankKey = key; rank = r;
  const box = $('order'), slots = box.querySelectorAll('.pl'), mine = myBalls();
  const x0 = box.getBoundingClientRect().left;
  r.forEach((n, i) => {
    const sl = slots[i].getBoundingClientRect();
    ORDER_EL[n].style.transform = 'translateX(' + (sl.left - x0 + (sl.width - ORDER_EL[n].offsetWidth) / 2 - 8) + 'px)';
    ORDER_EL[n].style.boxShadow = mine.indexOf(n) >= 0 ? '0 0 0 2px var(--gold), 0 0 10px rgba(255,187,96,.7)' : '';
  });
  const live = $('live');
  if (mine.length) {
    live.hidden = false;
    live.innerHTML = mine.slice(0, 2).map((n) => 'Your <b>' + n + '</b> is <b>' + PLACE[r.indexOf(n)] + '</b>').join(' · ');
  } else { live.hidden = false; live.innerHTML = '<b>' + r[0] + '</b> leads · <b>' + r[1] + '</b> second'; }
  paintTicket();
}

// ---------------------------------------------------------------- per frame
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
          if (secs <= 5 && lastTick !== -1) sound.play('tick', secs <= 2);
          if (secs <= 4 && statusKey === 'betting') setStatus('last');
          lastTick = secs; updateControls();
        }
        if (left <= AUTO_SEND_MS && autoRound !== round && lines.length && !locked()) { autoRound = round; submit(true); }
      } else {
        timer.hidden = true;
        if (closedRound !== round && round) closeRound();
      }
    } else timer.hidden = true;
    const racingNow = !!(race && raceRound === round && S.phase === 'dealing' && scene && scene.racing());
    if ($('order').hidden === racingNow) { $('order').hidden = !racingNow; $('live').hidden = !racingNow; if (racingNow) rankKey = ''; }
    paintOrder();
    // the winner crosses: announce it at once (the full result follows when the race is settled)
    if (race && raceRound === round && winnerShown !== round && scene && scene.racing() && (perf() - raceT0) * 1000 >= race.cross[0]) {
      winnerShown = round; setStatus('winner', 'Marble ' + race.balls[0] + ' wins the race!');
    }
    if (S.phase === 'pause' && (statusKey === 'result' || statusKey === 'win' || statusKey === 'lose') && now - lastPauseAt > 2600) setStatus('wait');
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '', strip = null;
// after a reconnect the client replays the round quietly (no signals): catch up from the state
function catchUp() {
  if (!scene) return;
  if (S.phase === 'betting' && round !== S.round) onBetting(true);
  else if (S.phase === 'dealing' && raceRound !== S.round) {
    if (round !== S.round) round = S.round;
    const step = (S.deals || []).filter((x) => x.kind === 'race' && x.data && x.round === S.round).pop();
    if (step) onDeal(step, true);
  } else if ((S.phase === 'result' || S.phase === 'pause') && resultRound !== S.round && S.result && S.result.balls) onResult({ outcome: S.result });
}
function render() {
  if (!S || !started) return;
  catchUp();
  if (S.phase !== phaseSeen) { phaseSeen = S.phase; if (S.phase === 'pause') lastPauseAt = Date.now(); }
  let bal = S.balance;
  if (bal != null && lines.length && !placing && !locked()) bal = r2(bal - total());
  setText($('balance'), bal == null ? '—' : money(bal));
  setText($('mode'), S.demo ? 'Demo' : 'Balance');
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  setText($('fRound'), S.round ? String(S.round) : '—');
  setText($('fHash'), S.hash || '—');
  setText($('fSeed'), lastSeed && lastSeed.round === resultRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the race' : '—'));
  const hist = S.history.filter((h) => h.outcome && h.outcome.balls && !(h.round === raceRound && resultRound < raceRound));
  const hk = hist.length + ':' + (hist[0] && hist[0].round) + ':' + resultRound;
  if (hk !== histKey) { histKey = hk; renderHistory(hist); renderStats(hist); }
  renderList();
  updateControls();
  if (!strip && window.NXPlayers && !WIDE.matches) strip = window.NXPlayers.create($('stage'), { face: avatar });
  if (strip) strip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(name) { return NXPlayers.face(name, 'av', 'span'); } // a player's face (../_core/players.js)
function renderHistory(hist) {
  $('history').innerHTML = hist.slice(0, 24).map((h, i) => '<span class="hr' + (i === 0 && h.round === resultRound ? ' hr--new' : '') + '" title="Race ' + h.round + ': ' + h.outcome.balls.join(' ') + '">' + ball(h.outcome.balls[0]) + ball(h.outcome.balls[1]) + ball(h.outcome.balls[2]) + '</span>').join('') || '<span class="hd--empty">Results appear here</span>';
}
function renderStats(hist) {
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  hist.forEach((h) => { c[h.outcome.balls[0]]++; });
  setText($('statN'), String(hist.length));
  const max = Math.max(1, ...c.slice(1));
  let html = '';
  for (let n = 1; n <= 8; n++) html += '<div class="fq"><i style="--c:var(--b' + n + ');height:' + Math.round((c[n] / max) * 100) + '%"></i><b>' + n + '</b><small>' + c[n] + '</small></div>';
  $('freq').innerHTML = html;
}
function betSummary(bets) {
  return (bets || []).slice(0, 3).map((b) => {
    const p = RULES.parse(b.spot); if (!p) return '';
    const k = { win: 'W', top2: 'T2', exacta: 'EX', top3: 'T3', odd: 'ODD', even: 'EVEN', colour: GNAME[p.group] }[p.kind];
    return '<i>' + k + '</i>' + (p.kind === 'colour' || p.kind === 'odd' || p.kind === 'even' ? '' : p.n.map((n) => ball(n)).join(''));
  }).join(' ') + ((bets || []).length > 3 ? ' <i>+' + (bets.length - 3) + '</i>' : '');
}
function renderList() {
  let rows, cols, count;
  if (tab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && resultRound >= S.round;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + '"><span class="row__user">' + esc(b.player || 'Player') + '</span><span class="row__bets">' + betSummary(b.bets) + '</span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Bets this race');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === raceRound && resultRound < raceRound));
    cols = '<span>Race</span><span>Result</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => '<div class="row"><span>#' + m.round + '</span><span class="row__bets">' + (m.outcome && m.outcome.balls ? m.outcome.balls.slice(0, 3).map((n) => ball(n)).join('') : '') + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>');
    setText($('countLabel'), 'My races');
  }
  const key = tab + '|' + rows.join('');
  if (key === listKey) return;
  listKey = key;
  $('cols').innerHTML = cols;
  setText($('betCount'), String(count));
  $('list').innerHTML = rows.join('') || '<div class="empty">' + (tab === 'all' ? 'No bets yet this race' : 'Your races will show here') + '</div>';
}

// ---------------------------------------------------------------- layout: play area + scene size
let layoutRaf = 0;
function layout() {
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    const stage = $('stage'), sr = stage.getBoundingClientRect(), hist = $('historyBox'), wide = WIDE.matches;
    if (wide && hist.parentNode !== $('tablewrap')) $('tablewrap').insertBefore(hist, $('card'));
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
    rankKey = '';
    if (scene && !readySent) { readySent = true; requestAnimationFrame(() => { game.ready(); game.theme(scene.topColor); }); }
  });
}

// ---------------------------------------------------------------- wiring
function wire() {
  $('back').addEventListener('click', () => game.back());
  $('action').addEventListener('click', () => { if (!lines.length && lastBets && !locked()) repeatLast(); else submit(false); });
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
    else if (/^[1-8]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && $('rules').hidden && PICK[+e.key] && KINDS.find((k) => k.k === kind).need) tapBall(+e.key, PICK[+e.key].el);
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
  if (!lastSeed || !lastSeed.seed) { out.textContent = 'Wait for a race to finish while you are at the table — its seed is revealed then.'; return; }
  out.textContent = 'Checking…';
  const L = lastSeed;
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: 'ballrace', gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const b = res[1].outcome.balls;
    out.innerHTML = 'Race ' + L.round + ': order <b>' + b.join(' · ') + '</b>. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (b.join('') === L.balls.join('') ? '✓ same order as raced' : '✗ order differs');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

// first snapshot: put the machine in the state the round is in
function syncFromSnapshot() {
  started = true;
  round = S.round;
  const last = S.history[0];
  const stored = safeSS('spiralderby:placed');
  if (stored && stored.round === S.round && (S.phase === 'betting' || S.phase === 'dealing')) { placed = stored; placed.restored = true; }
  if (S.phase === 'dealing') {
    closedRound = round; setStatus('closed');
    const step = (S.deals || []).filter((x) => x.kind === 'race' && x.data).pop();
    if (step) onDeal(step, true);
    else if (scene) scene.idle(0);
  } else if (S.phase === 'betting') {
    onBetting(true);
    if (Date.now() >= S.endsAt) closeRound();
  } else {
    const o = S.result && S.result.balls ? S.result : last && last.outcome;
    if (o && o.balls && scene) scene.parked(o.balls, false);
    resultRound = S.round; lastOrder = o && o.balls;
    setStatus('wait');
  }
  paintCard(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
buildCard(); wire();
setStatus('wait');
game = window.NXTable.start({
  event: EVENT, game: 'ballrace',
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
  if (l && l.min > 0) { minBet = l.min; stake = l.min; }
  setText($('rMin'), money(l.min || 0.5)); setText($('rMax'), money(l.max || 500));
  paintCard();
});
paintCard();
createScene($('scene'), {
  roll: (v) => sound.roll(v),
  clack: (v) => sound.play('clack', v),
  bump: (v) => sound.play('bump', v),
  cross: (p) => { if (p === 0) sound.play('cross'); setTimeout(() => sound.play('park'), 450 + p * 30); },
}).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  window.__sd = { scene: sc, game, state: () => ({ round, closedRound, raceRound, resultRound, started, placed, lines, rank, clockSkew }) }; // QA hook
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
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#140830'); } }, 6000);
