/* Lucky 20 — a live shared draw every 30 s: 15 s of bets → 20 numbers of 1–80 light up on the LED
 * board one by one (0.45 s apart) → result and pays → next round. Rules and settlement: rules.js +
 * _core/table-client.js (the same rules as the engine); this file is the console, the meters, the
 * lists and the choreography around the 3D board (scene.js).
 */
import { L20Scene, BOARD_RATIO } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const R = window.L20Rules;
const BETTING_MS = 15000, PAUSE_AFTER_RESULT = 5000, MAX_SPOTS = 20;
const COLOUR_CSS = ['#b26bff', '#ffc455', '#2fd9c4', '#ff5d8f'];
const COLOUR_NAMES = ['Purple 1–20', 'Gold 21–40', 'Teal 41–60', 'Rose 61–80'];
const RTP = { over: '96.57%', odd: '96.41%', draw: '96.54%', colour: '96.46%', range: '96.25%', first: '96.25%' };

// ---------------------------------------------------------------- state
const sound = L20Audio.create();
let scene = null, game = null, S = null, playersStrip = null;
const CHIP_X = [1, 2, 5, 10, 20, 50, 100];
let chipVals = CHIP_X.map((x) => r2(0.1 * x)), chipIdx = 0;
let pending = {}, stack = [], placed = null, placing = false, lastBets = null;
let round = 0, closedRound = 0, autoRound = 0, shownRound = 0, resultAt = 0, lastTick = -1;
let drawnShown = [];       // balls on the board this round, in draw order
let lastSeed = null, started = false, readySent = false, tab = 'all';
const SPOT_EL = {};

// ---------------------------------------------------------------- helpers
function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function short(n) {
  n = r2(n);
  if (n >= 1000) return r2(n / 1000) + 'K';
  if (n < 1) return Math.round(n * 100) + 'c';
  return Number.isInteger(n) ? '€' + n : '€' + n.toFixed(2).replace(/0$/, '');
}
function sum(o) { let t = 0; for (const k in o) t += o[k]; return r2(t); }
function text(el, t) { if (el.textContent !== String(t)) el.textContent = t; }
let toastT = 0;
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
const PH = {
  betting: ['Twenty lights tonight — call the board', 'The board is dark — place your bets', 'Over or under? Your call', 'Pick a colour, pick a half', 'Which number lights first?', 'Fortune flips twenty tiles', 'Bets are open'],
  last: ['Last bets…', 'Closing in a moment', 'Final call'],
  closed: ['No more bets — lights on', 'Here come the twenty', 'The board wakes up…', 'Drawing the numbers'],
  wait: ['Next draw in a moment', 'The board resets soon', 'Get your chips ready'],
  noBet: ['Wait for the next draw', 'Bets are closed — next draw soon'],
};
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
let statusKey = '';
function setStatus(key, html) {
  if (key === statusKey && !html) return;
  statusKey = key;
  const el = $('status');
  if (html) el.innerHTML = html;
  else el.textContent = key === 'betting' && window.NXPhrases && Math.random() < 0.3 ? NXPhrases.pick('betting') : pick(PH[key] || ['']);
  el.dataset.kind = key;
}
function spotName(s) {
  const m = /^(colour|firstrange|first):(.+)$/.exec(s);
  if (!m) return { over: 'Over', under: 'Under', odd: 'Odd', even: 'Even', 'oddeven:draw': 'Odd–Even 10–10', top: 'Top', bottom: 'Bottom', 'topbottom:draw': 'Top–Bottom 10–10' }[s] || s;
  if (m[1] === 'colour') return COLOUR_NAMES[R.COLOURS.indexOf(m[2])].split(' ')[0];
  if (m[1] === 'firstrange') return '1st ' + ((+m[2] - 1) * 10 + 1) + '–' + (+m[2] * 10);
  return '1st #' + m[2];
}

// ---------------------------------------------------------------- build once
function buildKeys() {
  const dec = $('decades');
  for (let k = 1; k <= 8; k++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'key key--dk'; b.dataset.spot = 'firstrange:' + k;
    b.style.setProperty('--c', COLOUR_CSS[Math.floor((k - 1) / 2)]);
    b.setAttribute('aria-label', 'First ball ' + ((k - 1) * 10 + 1) + ' to ' + k * 10);
    b.textContent = ((k - 1) * 10 + 1) + '–' + k * 10;
    dec.appendChild(b);
  }
  document.querySelectorAll('#keys [data-spot]').forEach((el) => {
    const c = document.createElement('span'); c.className = 'kchip'; c.hidden = true; el.appendChild(c);
    const w = document.createElement('span'); w.className = 'wintag'; w.hidden = true; el.appendChild(w);
    SPOT_EL[el.dataset.spot] = { el, chip: c, tag: w, key: '' };
  });
  $('keys').addEventListener('click', (e) => { const b = e.target.closest('[data-spot]'); if (b) addChip(b.dataset.spot, b); });
}
function buildQuick() {
  const box = $('quick');
  box.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.i = i;
    b.addEventListener('click', () => { chipIdx = i; sound.play('chip'); paintChip(); });
    box.appendChild(b);
  }
  paintChip();
}
function paintChip() {
  const max = game ? game.limit().max : 0;
  Array.prototype.forEach.call($('quick').children, (b, i) => {
    text(b, short(chipVals[i]));
    b.setAttribute('aria-checked', i === chipIdx ? 'true' : 'false');
    b.disabled = max > 0 && chipVals[i] > max + 1e-9;
  });
  text($('chipVal'), money(chipVals[chipIdx]));
  $('less').disabled = chipIdx === 0;
  $('more').disabled = chipIdx === chipVals.length - 1 || (max > 0 && chipVals[chipIdx + 1] > max + 1e-9);
}
function buildPaytable() {
  const rows = [
    ['Over (sum 811+) / Under (sum 809 or less)', '×1.94', RTP.over],
    ['Odd / Even — 11 or more of the 20', '×2.42', RTP.odd],
    ['Odd–Even 10–10', '×4.75', RTP.draw],
    ['Top (1–40) / Bottom (41–80) — 11 or more', '×2.42', RTP.odd],
    ['Top–Bottom 10–10', '×4.75', RTP.draw],
    ['Most balls: one colour alone has the most', '×4.95', RTP.colour],
    ['First ball in a range of 10', '×7.7', RTP.range],
    ['First ball is your number', '×77', RTP.first],
  ];
  $('paytable').innerHTML = '<table><thead><tr><th>Bet</th><th>Pays</th><th>RTP</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</tbody></table>';
}

// ---------------------------------------------------------------- betting
function bettingOpen() { return S && S.phase === 'betting' && Date.now() < S.endsAt - 250; }
function locked() { return !!(placed && placed.round === round) || placing; }
function free() { const b = S && S.balance != null ? S.balance : Infinity; return r2(b - sum(pending)); }

function addChip(spot, el) {
  if (!bettingOpen()) { toast(pick(PH.noBet)); sound.play('error'); return; }
  if (locked()) { toast('Your bets are in for this draw.'); return; }
  if (!R.validSpot(spot)) return;
  if (!pending[spot] && Object.keys(pending).length >= MAX_SPOTS) { toast('Up to ' + MAX_SPOTS + ' bets per draw.'); return; }
  let amt = chipVals[chipIdx];
  const lim = game.limit(), cur = pending[spot] || 0;
  if (lim.max > 0 && cur + amt > lim.max + 1e-9) {
    if (cur >= lim.max - 1e-9) { toast('Max ' + money(lim.max) + ' on one bet.'); return; }
    amt = r2(lim.max - cur);
  }
  if (amt > free() + 1e-9) { toast('Not enough balance.'); sound.play('error'); return; }
  pending[spot] = r2(cur + amt);
  stack.push([{ spot, amt }]);
  sound.play('chip');
  paintSpot(spot, true);
  updateControls();
}
function undo() {
  if (locked() || !stack.length) return;
  stack.pop().forEach((e) => {
    pending[e.spot] = r2((pending[e.spot] || 0) - e.amt);
    if (pending[e.spot] <= 0.001) delete pending[e.spot];
    paintSpot(e.spot);
  });
  sound.play('chip'); updateControls();
}
function clearBets() {
  if (locked()) return;
  const spots = Object.keys(pending);
  pending = {}; stack = [];
  spots.forEach((s) => paintSpot(s));
  updateControls();
}
function rebet() {
  if (locked() || !bettingOpen() || !lastBets) return;
  const add = [];
  let need = 0;
  Object.keys(lastBets).forEach((s) => { add.push({ spot: s, amt: lastBets[s] }); need += lastBets[s]; });
  if (r2(need) > free() + 1e-9) { toast('Not enough balance to rebet.'); sound.play('error'); return; }
  add.forEach((e) => { pending[e.spot] = r2((pending[e.spot] || 0) + e.amt); paintSpot(e.spot, true); });
  stack.push(add); sound.play('chips', 4); updateControls();
}
function submit(auto) {
  if (locked() || !Object.keys(pending).length) return;
  if (!bettingOpen() && !auto) return;
  const r = S.round, snap = Object.assign({}, pending); // the round the table client bets on
  const bets = Object.keys(snap).map((s) => ({ spot: s, amount: snap[s] }));
  placing = true; updateControls();
  game.bet(bets).then(() => {
    placing = false;
    placed = { round: r, bets: snap, total: sum(snap) };
    lastBets = snap; pending = {}; stack = [];
    paintAllSpots();
    sound.play('chips', 3);
    if (!auto) setStatus('placed', 'Bets in — <b>good luck!</b>');
    updateControls(); render();
  }).catch(() => { placing = false; updateControls(); });
}

function amountOn(s) {
  const p = placed && placed.round === round ? placed.bets[s] : 0;
  return { amt: p || pending[s] || 0, placedAmt: p || 0 };
}
function paintSpot(s, pop) {
  const { amt, placedAmt } = amountOn(s);
  const o = SPOT_EL[s];
  if (o) {
    if (amt > 0) {
      o.chip.hidden = false; text(o.chip, short(amt));
      o.chip.className = 'kchip' + (placedAmt ? '' : ' kchip--pending') + (pop ? ' pop' : '');
    } else o.chip.hidden = true;
    o.el.classList.toggle('has', amt > 0);
  }
  if (s.indexOf('first:') === 0) paintMarks();
}
function paintAllSpots() { Object.keys(SPOT_EL).forEach((s) => paintSpot(s)); paintMarks(); }

// chip markers on the board for exact first-ball bets
let marksKey = '';
function paintMarks(force) {
  if (!scene) return;
  const spots = {};
  Object.keys(pending).forEach((s) => { if (s.indexOf('first:') === 0) spots[s] = { amt: pending[s], placed: false }; });
  if (placed && placed.round === round) Object.keys(placed.bets).forEach((s) => { if (s.indexOf('first:') === 0) spots[s] = { amt: placed.bets[s], placed: true }; });
  const res = S && S.result && shownRound === round && resultShown ? S.result : null;
  const key = JSON.stringify(spots) + '|' + (res ? res.balls[0] : '') + '|' + layoutKey;
  if (key === marksKey && !force) return;
  marksKey = key;
  const box = $('chipmarks');
  box.innerHTML = '';
  Object.keys(spots).forEach((s) => {
    const n = +s.slice(6), p = scene.tilePoint(n, true), m = document.createElement('span');
    m.className = 'chipmark' + (spots[s].placed ? '' : ' chipmark--pending') + (res ? (res.balls[0] === n ? ' chipmark--win' : ' chipmark--lose') : '');
    m.style.left = p.x + 'px'; m.style.top = p.y + 'px';
    m.textContent = short(spots[s].amt);
    box.appendChild(m);
  });
}

function updateControls() {
  if (!S) return;
  const open = bettingOpen(), lock = locked(), n = Object.keys(pending).length, total = sum(pending);
  $('undo').disabled = !open || lock || !stack.length;
  $('clear').disabled = !open || lock || !n;
  $('rebet').disabled = !open || lock || !lastBets || n > 0;
  const place = $('action');
  place.classList.remove('done');
  if (placing) { place.disabled = true; text($('placeT'), 'PLACING…'); text($('placeS'), money(total)); }
  else if (placed && placed.round === round) {
    place.disabled = true; place.classList.add('done');
    const won = resultShown && shownRound === round ? lastWin : null;
    text($('placeT'), won != null ? (won > 0 ? 'WON ' + money(won) : 'NO WIN THIS TIME') : 'BETS IN');
    text($('placeS'), money(placed.total) + ' on ' + Object.keys(placed.bets).length + (Object.keys(placed.bets).length === 1 ? ' bet' : ' bets'));
  } else if (open && n) { place.disabled = false; text($('placeT'), 'PLACE BETS'); text($('placeS'), money(total) + ' on ' + n + (n === 1 ? ' bet' : ' bets')); }
  else if (open) { place.disabled = true; text($('placeT'), 'TAP A BET'); text($('placeS'), 'chip ' + money(chipVals[chipIdx])); }
  else { place.disabled = true; text($('placeT'), S.phase === 'betting' || S.phase === 'dealing' ? 'NO MORE BETS' : 'NEXT DRAW SOON'); text($('placeS'), ''); }
  $('console').classList.toggle('closed', !open || lock);
}

// ---------------------------------------------------------------- round flow
let resultShown = false, lastWin = null;
function onSignal(type, d) {
  if (type === 'betting') onBetting();
  else if (type === 'deal') onDeal(d.step);
  else if (type === 'result') onResult(d.outcome, d.win);
  else if (type === 'error') { toast(d.text); sound.play('error'); }
}

function onBetting(late) {
  round = S.round; lastTick = -1; resultShown = false; lastWin = null;
  if (placed && placed.round !== round) placed = null;
  pending = {}; stack = [];
  drawnShown = [];
  clearResult();
  paintAllSpots();
  const flipped = scene.reset();
  if (flipped) sound.play('reset');
  meters([]);
  $('ballnow').hidden = true; $('banner').hidden = true;
  if (!late) { setStatus('betting'); sound.play('open'); }
  updateControls(); render();
}

function closeRound() {
  closedRound = round;
  setStatus('closed');
  sound.play('close');
  if (!placing && Object.keys(pending).length) { // chips never placed go back to the rack
    const spots = Object.keys(pending);
    pending = {}; stack = [];
    spots.forEach((s) => paintSpot(s));
  }
  updateControls();
}

function onDeal(step) {
  if (!step || step.kind !== 'ball' || !step.value) return;
  if (step.round !== S.round) return;
  if (step.round !== round) onBetting(true); // a missed betting signal: start this round's board now
  if (closedRound !== round) closeRound();
  const n = step.value, idx = step.step != null ? step.step : drawnShown.length;
  if (drawnShown.indexOf(n) >= 0) return;
  // missed steps (a hidden tab): catch up from the client's list
  const all = S.deals.filter((d) => d.kind === 'ball').map((d) => d.value);
  if (all.length > drawnShown.length + 1) { drawnShown = all.slice(0, -1); scene.setDrawn(drawnShown); }
  drawnShown.push(n);
  scene.draw(n, idx);
  showBall(n, drawnShown.length);
  meters(drawnShown);
  sound.play('ball', n, drawnShown.length === 20);
  if (statusKey !== 'drawing') setStatus('drawing', 'Drawing · <b>ball <span id="sIdx">1</span> of 20</b>');
  const si = $('sIdx'); if (si) text(si, drawnShown.length);
}

function showBall(n, count) {
  const box = $('ballnow'), orb = $('ballOrb');
  box.hidden = false;
  const s = Math.floor((n - 1) / 20);
  orb.style.setProperty('--oc', COLOUR_CSS[s]);
  orb.style.setProperty('--od', ['#6d28d9', '#d98a1c', '#0f8a7c', '#c0164e'][s]);
  text($('ballNum'), n); text($('ballIdx'), count);
  orb.classList.remove('in'); void orb.offsetWidth; orb.classList.add('in');
  const rail = $('rail');
  const i = document.createElement('i');
  i.style.setProperty('--c', COLOUR_CSS[s]); i.textContent = n;
  if (count === 1) { rail.innerHTML = ''; i.className = 'first'; }
  rail.appendChild(i);
}
function fillRail(balls) {
  const rail = $('rail'); rail.innerHTML = '';
  balls.forEach((n, k) => { const i = document.createElement('i'); i.style.setProperty('--c', COLOUR_CSS[Math.floor((n - 1) / 20)]); i.textContent = n; if (!k) i.className = 'first'; rail.appendChild(i); });
}

function meters(balls) {
  const st = R.stats(balls), n = balls.length;
  text($('mSum'), st.sum);
  const pace = $('mPace');
  if (!n) { text(pace, 'line ' + R.LINE); pace.className = ''; }
  else if (n === 20) { const d = st.sum - R.LINE; text(pace, d > 0 ? 'OVER ▲ +' + d : d < 0 ? 'UNDER ▼ ' + d : '810 — both lose'); pace.className = d < 0 ? 'under' : ''; }
  else { const p = Math.round(st.sum / n * 20); text(pace, 'on pace ' + p + (p > R.LINE ? ' ▲' : p < R.LINE ? ' ▼' : '')); pace.className = p < R.LINE ? 'under' : ''; }
  $('mSumFill').style.transform = 'scaleX(' + Math.min(1, st.sum / (2 * R.LINE)).toFixed(4) + ')';
  text($('mOdd'), st.odd); text($('mEven'), st.even); text($('mTop'), st.top); text($('mBot'), st.bottom);
  $('mOddFill').style.transform = 'scaleX(' + (n ? st.odd / n : 0.5).toFixed(4) + ')';
  $('mTopFill').style.transform = 'scaleX(' + (n ? st.top / n : 0.5).toFixed(4) + ')';
  const splits = document.querySelectorAll('.split');
  splits[0].classList.toggle('lead-a', st.odd > st.even); splits[0].classList.toggle('lead-b', st.even > st.odd);
  splits[1].classList.toggle('lead-a', st.top > st.bottom); splits[1].classList.toggle('lead-b', st.bottom > st.top);
  document.querySelectorAll('#mCols .cc').forEach((el, i) => { text(el.querySelector('b'), st.colours[i]); el.classList.toggle('lead', st.leader === i); });
}

function summary(o) {
  const st = R.stats(o.balls), d = st.sum - R.LINE, parts = [];
  parts.push((d > 0 ? 'Over' : d < 0 ? 'Under' : 'Exactly') + ' · sum ' + st.sum);
  parts.push(st.odd === 10 ? 'Odd–Even 10–10' : (st.odd > 10 ? 'Odd ' + st.odd + '–' + st.even : 'Even ' + st.even + '–' + st.odd));
  parts.push(st.top === 10 ? 'Top–Bottom 10–10' : (st.top > 10 ? 'Top ' + st.top + '–' + st.bottom : 'Bottom ' + st.bottom + '–' + st.top));
  parts.push(st.leader >= 0 ? COLOUR_NAMES[st.leader].split(' ')[0] + ' most' : 'Colours tied');
  parts.push('First ' + o.balls[0]);
  return { st, parts };
}

function onResult(o, win) {
  if (!o || !o.balls || o.balls.length !== 20) return;
  if (S.round !== round) round = S.round;
  shownRound = round; resultShown = true; resultAt = Date.now(); lastWin = win || 0;
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, balls: o.balls.slice() };
  // every ball on the board (a missed step is filled in at once)
  if (drawnShown.length !== 20 || drawnShown.some((n, i) => n !== o.balls[i])) {
    drawnShown = o.balls.slice(); scene.setDrawn(drawnShown); fillRail(drawnShown);
    $('ballnow').hidden = false; text($('ballNum'), o.balls[19]); text($('ballIdx'), 20);
  }
  meters(o.balls);
  const { st, parts } = summary(o);
  scene.result({ balls: o.balls, leader: st.leader });
  setStatus('result', '<b>' + parts.slice(0, 2).join(' · ') + '</b> · ' + parts.slice(2).join(' · '));
  // keys: winners gold, losing bets dimmed, winning outcomes nobody bet on outlined
  const mine = placed && placed.round === round ? placed.bets : {};
  Object.keys(SPOT_EL).forEach((s) => {
    const o2 = SPOT_EL[s], x = game.pay(o, s), amt = mine[s] || 0;
    o2.el.classList.toggle('win', x > 0 && amt > 0);
    o2.el.classList.toggle('lit', x > 0 && !amt);
    o2.el.classList.toggle('lose', x === 0 && amt > 0);
    o2.tag.hidden = !(x > 0 && amt > 0);
    if (x > 0 && amt > 0) text(o2.tag, '+' + money(Math.floor(amt * x * 100 + 1e-6) / 100)); // floored like the settlement
  });
  paintMarks(true);
  const any = Object.keys(mine).length > 0;
  if (any) {
    const b = $('banner');
    b.classList.toggle('banner--lose', !(win > 0));
    if (win > 0) {
      text(b.querySelector('small'), 'You win'); text($('bannerWin'), money(win));
      const hits = Object.keys(mine).filter((s) => game.pay(o, s) > 0).map(spotName);
      $('bannerSub').innerHTML = hits.slice(0, 2).join(' · ') + (hits.length > 2 ? '<br>' + hits.slice(2, 4).join(' · ') : '');
      sound.play('win', win >= placed.total * 8);
      $('balance').classList.add('bump'); setTimeout(() => $('balance').classList.remove('bump'), 450);
    } else {
      text(b.querySelector('small'), 'No win this draw'); text($('bannerWin'), parts[0]);
      $('bannerSub').innerHTML = parts.slice(1, 3).join('<br>');
      sound.play('lose');
    }
    b.hidden = false; b.classList.remove('in'); void b.offsetWidth; b.classList.add('in');
    $('play').classList.add('has-banner');
  } else sound.play('done');
  updateControls(); render();
}
function clearResult() {
  $('banner').hidden = true; $('play').classList.remove('has-banner');
  Object.keys(SPOT_EL).forEach((s) => { const o = SPOT_EL[s]; o.el.classList.remove('win', 'lit', 'lose'); o.tag.hidden = true; });
}

// ---------------------------------------------------------------- per frame: timer, close, auto-place, pause countdown
function tick() {
  if (S && started) {
    const now = Date.now(), timer = $('timer');
    if (S.phase === 'betting' && S.round === round) {
      const left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000);
      if (left > 0) {
        if (timer.hidden) timer.hidden = false;
        $('timerRing').style.strokeDashoffset = String(100 - Math.min(1, left / BETTING_MS) * 100);
        if (secs !== lastTick) {
          text($('timerNum'), secs);
          timer.dataset.level = secs <= 3 ? 'red' : 'gold';
          if (secs <= 5 && lastTick !== -1) sound.play('tick', secs <= 1);
          if (secs <= 3 && statusKey === 'betting') setStatus('last');
          lastTick = secs;
          updateControls();
        }
        if (left < 1100 && autoRound !== round && Object.keys(pending).length && !locked()) { autoRound = round; submit(true); }
      } else {
        timer.hidden = true;
        if (closedRound !== round && round) closeRound();
      }
    } else if (!timer.hidden) timer.hidden = true;
    if (resultShown && (S.phase === 'result' || S.phase === 'pause')) {
      const s = Math.max(0, Math.ceil((resultAt + PAUSE_AFTER_RESULT - now) / 1000));
      if (now - resultAt > 3200) { if (statusKey !== 'pause' || lastTick !== -10 - s) { lastTick = -10 - s; setStatus('pause', s > 0 ? 'Next draw in <b>' + s + ' s</b>' : 'Next draw…'); } }
    }
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '';
function render() {
  if (!S || !started) return;
  text($('balance'), S.balance == null ? '—' : money(S.balance));
  text($('mode'), S.demo ? 'Demo' : 'Balance');
  $('game').classList.toggle('is-demo', !!S.demo);
  $('conn').hidden = S.connected || Date.now() - bootAt < 2500;
  text($('fRound'), S.round || '—');
  text($('fHash'), S.hash || '—');
  text($('fSeed'), lastSeed && lastSeed.round === shownRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the draw' : '—'));
  const hist = S.history.filter((h) => h.outcome && h.outcome.balls && !(h.round === round && !resultShown));
  const hk = hist.length + ':' + (hist[0] && hist[0].round);
  if (hk !== histKey) { const isNew = !!histKey; histKey = hk; renderHistory(hist, isNew); }
  renderList();
  if (playersStrip) playersStrip.update({ phase: S.phase === 'dealing' ? 'betting' : S.phase, bets: S.bets }); // a table round: everyone is in until the result
  updateControls();
}
function renderHistory(hist, isNew) {
  $('history').innerHTML = hist.slice(0, 24).map((h, i) => {
    const b = h.outcome.balls, t = h.outcome.total != null ? h.outcome.total : R.stats(b).sum;
    const ou = t > R.LINE ? ['o', 'O'] : t < R.LINE ? ['u', 'U'] : ['e', '='];
    return '<div class="hchip' + (i === 0 && isNew ? ' hchip--new' : '') + '" title="Draw ' + h.round + ': first ball ' + b[0] + ', sum ' + t + '">' +
      '<span class="hb" style="--c:' + COLOUR_CSS[Math.floor((b[0] - 1) / 20)] + '">' + b[0] + '</span>' + t +
      '<span class="ou ou--' + ou[0] + '">' + ou[1] + '</span></div>';
  }).join('') || '<div class="hchip hchip--empty">Draw results appear here</div>';
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function avatar(name) { return '<span class="av" style="background:' + NXPlayers.faceStyle(name) + '"></span>'; } // a player's face (../_core/players.js)
function renderList() {
  let rows, count;
  if (tab === 'all') {
    const bets = S.bets.slice().reverse();
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && resultShown && shownRound === S.round;
      return '<div class="srow' + (b.mine ? ' srow--me' : '') + '">' + avatar(b.player || 'P') + '<span><b>' + esc(b.mine ? 'You' : b.player || 'Player') + '</b><small>' +
        esc((b.bets || []).map((x) => spotName(x.spot)).join(' · ')) + '</small></span><span class="amt">' + money(Number(b.total) || 0) +
        (showWin && b.win > 0 ? '<em>+' + money(b.win) + '</em>' : '') + '</span></div>';
    });
    text($('countLabel'), 'Bets this round');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === round && !resultShown));
    count = mine.length;
    rows = mine.map((m) => '<div class="srow">' + '<span class="av" style="background:#2a1850">#</span><span><b>Draw ' + m.round + '</b><small>' +
      esc((m.bets || []).map((x) => spotName(x.spot)).join(' · ')) + '</small></span><span class="amt">' + money(m.stake) +
      (m.win > 0 ? '<em>+' + money(m.win) + '</em>' : '') + '</span></div>');
    text($('countLabel'), 'My draws');
  }
  const key = tab + '|' + rows.join('');
  if (key === listKey) return;
  listKey = key;
  text($('betCount'), count);
  $('list').innerHTML = rows.join('') || '<div class="empty">' + (tab === 'all' ? 'No bets yet this round' : 'Your draws will show here') + '</div>';
}

// ---------------------------------------------------------------- layout: play area, board, meters
let layoutRaf = 0, layoutKey = '';
function layout() {
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    if (!scene) return;
    const stage = $('stage'), sr = stage.getBoundingClientRect(), W = sr.width, Hs = sr.height;
    const play = $('play'), meters = $('meters'), hist = $('historyBox');
    let A, board, M;
    if (WIDE.matches) {
      const L = $('side').getBoundingClientRect().right + 16, T = 64;
      const ct = $('console').getBoundingClientRect().top;
      const histTop = ct - 40, PW = W - L - 16, PH = histTop - T - 8;
      A = { L, T, W: PW, H: PH };
      const avail = PW - 170 - 260 - 40;
      const bw = Math.max(260, Math.min((PH - 66) * BOARD_RATIO, avail)), bh = bw / BOARD_RATIO;
      const bx = L + 20 + 170 + (avail - bw) / 2;
      board = { cx: bx + bw / 2, cy: T + 52 + (PH - 52) / 2 - 6, w: bw };
      if (board.cy - bh / 2 < T + 50) board.cy = T + 50 + bh / 2;
      M = { left: bx + bw + 24, top: T + 120, width: Math.min(250, L + PW - (bx + bw + 24)) };
      hist.style.left = L + 'px'; hist.style.top = histTop + 'px'; hist.style.width = PW + 'px';
      play.style.setProperty('--gapx', Math.max(70, (bx - L) / 2) + 'px');
      meters.classList.remove('slim');
    } else {
      hist.style.left = ''; hist.style.top = ''; hist.style.width = '';
      const slim = Hs < 520;
      meters.classList.toggle('slim', slim);
      const mh = slim ? 44 : 54, metersTop = Hs - 40 - mh;
      const top = 104, bottom = metersTop - (Hs < 560 ? 34 : 46); // a band for the players strip between board and meters
      const bw = Math.max(200, Math.min(W - 22, (bottom - top) * BOARD_RATIO));
      board = { cx: W / 2, cy: top + (bottom - top) / 2 + 4, w: bw };
      A = { L: 0, T: 56, W, H: 46 };
      M = { left: 10, top: metersTop, width: W - 20 };
      stage.style.setProperty('--below', (Hs - metersTop + 2) + 'px');
    }
    play.style.left = A.L + 'px'; play.style.top = A.T + 'px'; play.style.width = A.W + 'px'; play.style.height = A.H + 'px';
    meters.style.left = M.left + 'px'; meters.style.top = M.top + 'px'; meters.style.width = M.width + 'px';
    scene.resize(W, Hs, board);
    layoutKey = W + 'x' + Hs + ':' + Math.round(board.w);
    paintMarks(true);
    if (!readySent) {
      readySent = true;
      requestAnimationFrame(() => { game.ready(); game.theme(scene.topColor); });
    }
  });
}

// ---------------------------------------------------------------- wiring
function wire() {
  $('back').addEventListener('click', () => game.back());
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', clearBets);
  $('rebet').addEventListener('click', rebet);
  $('action').addEventListener('click', () => submit(false));
  $('less').addEventListener('click', () => { if (chipIdx > 0) { chipIdx--; sound.play('chip'); paintChip(); } });
  $('more').addEventListener('click', () => { if (chipIdx < chipVals.length - 1) { chipIdx++; sound.play('chip'); paintChip(); } });
  const paintToggles = () => {
    $('music').setAttribute('aria-pressed', sound.music() ? 'true' : 'false');
    $('sound').setAttribute('aria-pressed', sound.sound() ? 'true' : 'false');
  };
  $('music').addEventListener('click', () => { sound.music(!sound.music()); paintToggles(); });
  $('sound').addEventListener('click', () => { sound.sound(!sound.sound()); paintToggles(); });
  paintToggles();
  document.querySelectorAll('.side__tab').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.side__tab').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    render();
  }));
  $('rulesBtn').addEventListener('click', () => { $('rules').hidden = false; });
  $('rulesClose').addEventListener('click', () => { $('rules').hidden = true; });
  $('rules').addEventListener('click', (e) => { if (e.target === $('rules')) $('rules').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('rules').hidden = true; });
  $('fair').addEventListener('click', () => { $('fairDetail').hidden = !$('fairDetail').hidden; });
  $('fCheckBtn').addEventListener('click', verifyLast);
  // tap a number on the board: exact first-ball bet
  let down = null;
  const cv = $('scene');
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  cv.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12 || Date.now() - down.t > 600) { down = null; return; }
    down = null;
    const r = cv.getBoundingClientRect(), n = scene.pick(e.clientX - r.left, e.clientY - r.top);
    if (n) addChip('first:' + n);
  });
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) { const ro = new ResizeObserver(layout); ro.observe($('stage')); ro.observe($('console')); }
  WIDE.addEventListener('change', layout);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !game) return;
    game.theme(scene.topColor);
    resyncBoard(); // frames were paused while hidden: snap the board to the round as it is now
  });
}

function hexBytes(hex) { const o = new Uint8Array(hex.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(hex.substr(i * 2, 2), 16); return o; }
function verifyLast() {
  const out = $('fCheck'); out.hidden = false;
  if (!lastSeed || !lastSeed.seed) { out.textContent = 'Stay for one draw — its seed is revealed when it ends.'; return; }
  out.textContent = 'Checking…';
  const L = lastSeed;
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), NXTable.verify({ game: 'lucky20', gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const balls = res[1].outcome.balls, okHash = h === L.hash, okBalls = balls.join() === L.balls.join();
    out.innerHTML = 'Draw ' + L.round + ': <b>' + balls.join(' · ') + '</b> (sum ' + res[1].outcome.total + '). ' +
      (okHash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (okBalls ? '✓ same numbers as drawn' : '✗ numbers differ');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

function resyncBoard() {
  if (!S || !started) return;
  if (S.phase === 'betting') { if (drawnShown.length) { drawnShown = []; scene.setDrawn([]); meters([]); } return; }
  const balls = S.result && resultShown && shownRound === round ? S.result.balls : S.deals.filter((d) => d.kind === 'ball').map((d) => d.value);
  const st = R.stats(balls);
  drawnShown = balls.slice();
  scene.setDrawn(balls, { latest: S.phase === 'dealing', complete: balls.length === 20 && resultShown, leader: balls.length === 20 && resultShown ? st.leader : null });
  meters(balls); fillRail(balls);
}

// first snapshot: put the board in the state the round is in
let synced = false; // the board was set from the socket snapshot (an early demo start is redone then)
function syncFromSnapshot() {
  started = true; synced = S.gotSnapshot;
  round = S.round;
  const balls = S.deals.filter((d) => d.kind === 'ball').map((d) => d.value);
  if (S.phase === 'betting') {
    scene.setDrawn([]); meters([]);
    setStatus('betting');
    if (Date.now() >= S.endsAt) closeRound();
  } else if (S.phase === 'dealing' && balls.length) {
    closedRound = round;
    drawnShown = balls.slice(); scene.setDrawn(balls, { latest: true }); meters(balls); fillRail(balls);
    $('ballnow').hidden = false; text($('ballNum'), balls[balls.length - 1]); text($('ballIdx'), balls.length);
    setStatus('drawing', 'Drawing · <b>ball <span id="sIdx">' + balls.length + '</span> of 20</b>');
  } else if (S.result && S.result.balls) {
    const o = S.result, st = R.stats(o.balls);
    closedRound = round; shownRound = round; resultShown = true; resultAt = Date.now() - 3300;
    drawnShown = o.balls.slice(); scene.setDrawn(o.balls, { complete: true, leader: st.leader }); meters(o.balls); fillRail(o.balls);
    setStatus('wait');
  } else { scene.setDrawn([]); meters([]); setStatus('wait'); }
  render();
}

// ---------------------------------------------------------------- boot
const bootAt = Date.now();
buildKeys(); buildPaytable(); buildQuick(); wire();
setStatus('wait');
meters([]);
scene = await L20Scene($('scene'));
window.__l20 = { scene, get S() { return S; }, get round() { return round; }, get placed() { return placed; } }; // QA hooks (read-only use)
playersStrip = window.NXPlayers ? NXPlayers.create($('stage')) : null;
game = NXTable.start({
  event: '88.0091', game: 'lucky20',
  onChange() {
    S = game ? game.S : S;
    if (!S) return;
    if (!synced && S.gotSnapshot) syncFromSnapshot();
    else if (!started && S.demo && Date.now() - bootAt > 4000) syncFromSnapshot();
    render();
  },
  onSignal(t, d) { if (!started) return; onSignal(t, d || {}); },
});
S = game.S;
game.limitsLoaded.then((l) => {
  const min = l && l.min > 0 ? l.min : 0.1;
  chipVals = CHIP_X.map((x) => r2(min * x));
  text($('rMin'), money(min)); text($('rMax'), money(l && l.max ? l.max : 100));
  paintChip(); updateControls();
});
setTimeout(() => { if (!started) syncFromSnapshot(); }, 5000);
layout();
requestAnimationFrame(tick);
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme(scene.topColor); } }, 6000);
