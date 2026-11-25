/* Jewel Drum (88.0093) — a 20-jewel drum draw every 30 s, shared by every player (engine draw game
 * "jeweldrum": nexorng-engine/internal/tables/jeweldrum.go; client rules: rules.js).
 *   18 s betting → 7.4 s draw (the drum rolls; the jewel arrives 3.3 s after betting closed and the
 *   drum slows down onto it) → 4.3 s result. Bets: single jewels, a colour (column) or a family (row).
 * Chips are collected on the board and sent in ONE bet (Place bets, or automatically 1.5 s before
 * betting closes). Settlement and rules live in ../_core/table-client.js; this file is the board,
 * the round choreography and the layout; scene.js is the 3D drum.
 */
import { create as createScene, NAMES } from './scene.js';

const $ = (id) => document.getElementById(id);
const JR = window.JDRules;
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0093';
const BETTING_MS = 18000;
const AUTO_SEND_MS = 1500;
const CHIP_X = [1, 2, 5, 10];
const COLOURS = ['violet', 'gold', 'emerald', 'ruby'];
const FAMILIES = ['coin', 'gem', 'star', 'crown', 'orb'];
const COLOUR_UI = { violet: '#b06cff', gold: '#ffc35a', emerald: '#2fd59a', ruby: '#ff4d73' };
const FAMILY_NAME = { coin: 'Coins', gem: 'Gems', star: 'Stars', crown: 'Crowns', orb: 'Orbs + NX' };
const PH = {
  betting: ['Pick your jewels', 'Bets are open — tap a jewel, a colour or a row', 'Which jewel stops in the window?', 'Rare jewels pay big', 'The drum is waiting for your bets', 'Back a colour, a family or a single jewel', 'Feeling lucky? Choose your jewels'],
  last: ['Last chips…', 'Closing soon', 'Final call — place your bets'],
  closed: ['No more bets — the drum rolls', 'The drum is rolling…', 'Round and round the jewels go…', 'Bets are closed — fingers crossed', 'Rolling for the winning jewel…'],
  wait: ['Next round soon', 'Get your chips ready', 'A new draw is coming up', 'The drum rests a moment'],
  noBet: ['Wait for the next round', 'Bets are closed — next round soon', 'Hold your chip for the next draw'],
  win: ['A sparkling win!', 'That’s a winner!', 'Nicely picked!', 'The jewels are yours!'],
  lose: ['So close — next draw in a moment', 'Not this time — the drum turns again soon', 'Next round could be yours'],
};

// ---------------------------------------------------------------- state
const sound = window.JDAudio.create();
let scene = null, game = null, S = null, ICONS = {};
let chipVals = CHIP_X.map((x) => r2(0.1 * x)), chipIdx = 0;
let pending = {}, stack = [], placed = null, placing = false, lastBets = null;
let round = 0, closedRound = 0, autoRound = 0, revealRound = 0, landedRound = 0, lastTick = -1;
let landing = null;
let started = false, readySent = false, tab = 'all';
let bannerRound = 0, wonRound = 0, lastSeed = null, drumShown = false;
const SPOT = {}; // spot → { el, chip, gain, key }

function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function short(n) { if (n >= 1000) return r2(n / 1000) + 'K'; return Number.isInteger(r2(n)) ? String(r2(n)) : String(r2(n)).replace(/^0\./, '.'); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function sum(o) { let t = 0; for (const k in o) t += o[k]; return r2(t); }
function chipClass(n) { let c = 0; for (let i = 0; i < chipVals.length; i++) if (n + 1e-9 >= chipVals[i]) c = i; return 'c' + c; }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function cellId(c, f) { return c === 'gold' && f === 'orb' ? 'nx' : c + '-' + f; }
function sym(i) { return JR.DRUM[i]; }
function spotPay(spot) { const [k, v] = spot.split(':'); return k === 'sym' ? JR.DRUM.find((s) => s.id === v).pay : k === 'colour' ? JR.COLOUR_PAY[v] : JR.FAMILY_PAY[v]; }
function spotWins(spot, i) { return JR.pay({ pocket: i }, spot) > 0; }
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
// One grid for both layouts: phone = families in rows × colours in columns; desktop = colours in
// rows × families in columns (CSS reads --pr/--pc or --dr/--dc).
function buildBoard() {
  const box = $('grid');
  const add = (html, cls, spot, pr, pc, dr, dc, label) => {
    const b = document.createElement(spot ? 'button' : 'div');
    if (spot) { b.type = 'button'; b.dataset.spot = spot; b.setAttribute('aria-label', label); }
    b.className = cls;
    b.style.cssText = `--pr:${pr};--pc:${pc};--dr:${dr};--dc:${dc}`;
    b.innerHTML = html + (spot ? '<span class="bchip" hidden></span><span class="gain" hidden></span>' : '');
    box.appendChild(b);
    if (spot) SPOT[spot] = { el: b, chip: b.querySelector('.bchip'), gain: b.querySelector('.gain'), key: '' };
  };
  add('<span class="corner__p">Colour →<br>Family ↓</span><span class="corner__d">Family →<br>Colour ↓</span>', 'corner', null, 1, 1, 1, 1);
  COLOURS.forEach((c, ci) => add(`<i class="dot" style="--c:${COLOUR_UI[c]}"></i><span class="jh__n" style="color:${COLOUR_UI[c]}">${c}</span><span class="jh__x">×${JR.COLOUR_PAY[c]}</span>`,
    'jh jh--col', 'colour:' + c, 1, ci + 2, ci + 2, 1, c + ' colour, pays ' + JR.COLOUR_PAY[c] + ' times'));
  FAMILIES.forEach((f, fi) => add(`<span class="jh__n">${FAMILY_NAME[f]}</span><span class="jh__x">×${JR.FAMILY_PAY[f]}</span>`,
    'jh jh--fam', 'family:' + f, fi + 2, 1, 1, fi + 2, FAMILY_NAME[f] + ', pays ' + JR.FAMILY_PAY[f] + ' times'));
  FAMILIES.forEach((f, fi) => COLOURS.forEach((c, ci) => {
    const id = cellId(c, f), s = JR.DRUM.find((x) => x.id === id);
    add(`<img class="jc__ic" data-ic="${id}" alt=""><span class="jc__t"><span class="jc__n">${NAMES[id]}</span><span class="jc__x">×${s.pay}</span></span>`,
      'jc' + (id === 'nx' ? ' jc--nx' : ''), 'sym:' + id, fi + 2, ci + 2, ci + 2, fi + 2, NAMES[id] + ', pays ' + s.pay + ' times');
  }));
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-spot]'); if (b) addChip(b.dataset.spot, b); });
}
function setIcons(icons) {
  ICONS = icons || {};
  document.querySelectorAll('img[data-ic]').forEach((im) => { if (ICONS[im.dataset.ic]) im.src = ICONS[im.dataset.ic]; });
  histKey = ''; listKey = ''; render();
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
function buildPaytable() {
  const rows = FAMILIES.map((f) => `<tr><td>${FAMILY_NAME[f].replace(' + NX', '')}</td><td>×${JR.FAMILY[f][1]}</td><td>1 in ${(JR.TOTAL / JR.FAMILY[f][0]).toFixed(1)}</td><td>×${JR.FAMILY_PAY[f]}</td></tr>`).join('');
  $('paytable').innerHTML = '<thead><tr><th>Family</th><th>Each jewel</th><th>Chance (each)</th><th>Family bet</th></tr></thead><tbody>' + rows +
    '<tr><td>NX Emblem</td><td>×280</td><td>1 in 292</td><td>(Orbs)</td></tr></tbody>' +
    '<tfoot><tr><td colspan="4">Colour bets: Violet, Emerald, Ruby ×3.8 (1 in 3.9) · Gold ×4 (1 in 4.2)</td></tr></tfoot>';
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
  if (!pending[spot] && Object.keys(pending).length >= 20) { toast('Up to 20 spots per round.'); sound.play('error'); return; }
  if (lim.max > 0 && total + amt > lim.max + 1e-9) {
    if (total >= lim.max - 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
    amt = r2(lim.max - total);
  }
  if (amt > free() + 1e-9) { toast('Not enough balance.'); sound.play('error'); return; }
  pending[spot] = r2((pending[spot] || 0) + amt);
  stack.push([{ spot, amt }]);
  fly(center($('chips').children[chipIdx]), center(SPOT[spot].chip.hidden ? el : SPOT[spot].chip), chipClass(amt), short(amt), 0, 260).then(() => paintSpot(spot));
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
function doubleBets() {
  if (locked() || !bettingOpen()) return;
  const lim = game.limit(), total = sum(pending);
  if (!total) return;
  if (lim.max > 0 && total * 2 > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (total > free() + 1e-9) { toast('Not enough balance to double.'); sound.play('error'); return; }
  const add = Object.keys(pending).map((s) => ({ spot: s, amt: pending[s] }));
  add.forEach((e) => { pending[e.spot] = r2(pending[e.spot] + e.amt); paintSpot(e.spot); });
  stack.push(add); sound.play('chips'); updateControls(); render();
}
function rebet() {
  if (locked() || !bettingOpen() || !lastBets) return;
  const add = Object.keys(lastBets).map((s) => ({ spot: s, amt: lastBets[s] })), need = r2(add.reduce((t, e) => t + e.amt, 0));
  const lim = game.limit();
  if (lim.max > 0 && sum(pending) + need > lim.max + 1e-9) { toast('Max ' + money(lim.max) + ' per round.'); sound.play('error'); return; }
  if (need > free() + 1e-9) { toast('Not enough balance to repeat.'); sound.play('error'); return; }
  if (new Set(Object.keys(pending).concat(Object.keys(lastBets))).size > 20) { toast('Up to 20 spots per round.'); sound.play('error'); return; }
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
    safeSS('jeweldrum:placed', placed);
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
  const c = SPOT[spot]; if (!c) return;
  const b = betOf(spot), key = b.amt + ':' + b.placed;
  if (key === c.key) return;
  c.key = key;
  c.el.classList.toggle('has-bet', b.amt > 0);
  c.el.classList.toggle('is-pending', b.amt > 0 && !b.placed);
  if (b.amt > 0) { c.chip.hidden = false; c.chip.className = 'bchip ' + chipClass(b.amt); c.chip.textContent = short(b.amt); c.chip.title = money(b.amt); }
  else c.chip.hidden = true;
}
function paintAll() { for (const s in SPOT) { SPOT[s].key = ''; paintSpot(s); } }

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
    else { place.classList.add('place--done'); label = 'Bets placed · ' + money(placed.total); sub = S.phase === 'betting' ? 'good luck!' : 'good luck — the drum is rolling'; }
  } else if (open && n) { place.disabled = false; label = 'Place bets'; sub = n + (n === 1 ? ' spot' : ' spots') + ' · sent automatically before the draw'; }
  else if (open) { place.disabled = true; label = 'Tap a jewel to bet'; sub = 'Chip ' + money(chipVals[chipIdx]) + ' · a colour, a row or a jewel'; }
  else { place.disabled = true; label = S.phase === 'betting' || S.phase === 'dealing' ? 'No more bets' : 'Next round soon'; }
  setText($('placeLabel'), label); setText($('placeSub'), sub);
  setText($('total'), money(placed && placed.round === round ? placed.total : total));
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
    { transform: `translate(${to.x}px,${to.y}px) scale(${opts.s1 || 0.85})`, opacity: opts.fadeOut ? 0 : 1 },
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
  const back = Object.keys(pending); // chips never placed go back to the rack
  if (!placing && back.length) {
    const rack = center($('chips'));
    back.forEach((s, i) => { fly(center(SPOT[s].el), rack, chipClass(pending[s]), short(pending[s]), i * 40, 380, { fadeOut: true }); });
    pending = {}; stack = []; paintAll();
  }
  $('drawpill').hidden = false;
  if (scene) scene.spin();
  updateControls(); render();
}
function onDeal(step) {
  if (!step || step.kind !== 'pocket' || step.value == null) return;
  const r = step.round;
  if (closedRound !== r) closeRound();
  revealRound = r;
  startLanding(r, step.value, false);
}
function startLanding(r, idx, fromSnapshot) {
  if (landing && landing.round === r) return;
  drumShown = true;
  landing = { round: r, idx };
  if (!scene) return;
  if (!scene.spinning()) scene.spin();
  scene.onLanded(() => landed(r, idx));
  scene.land(idx, fromSnapshot ? { seconds: 2.2 } : { seconds: 3.0, min: 1.9, max: 4.0 }); // lands ≤ 7.3 s after betting closed; the result comes at 7.7 s
}
function myWin(idx) {
  if (!placed || placed.round !== round) return null;
  let w = 0;
  for (const s in placed.bets) w += Math.floor(placed.bets[s] * JR.pay({ pocket: idx }, s) * 100 + 1e-6) / 100;
  w = r2(w);
  if (placed.maxWin > 0 && w > placed.maxWin) w = placed.maxWin;
  return w;
}
function landed(r, idx) {
  if (r !== round) return;
  landedRound = r;
  $('drawpill').hidden = true;
  scene.win(true, idx);
  sound.play('land');
  const s = sym(idx);
  for (const spot in SPOT) {
    const w = spotWins(spot, idx);
    SPOT[spot].el.classList.toggle('is-win', w);
    SPOT[spot].el.classList.toggle('is-lose', !w);
  }
  const mine = placed && placed.round === r ? placed.bets : {};
  for (const spot in mine) if (spotWins(spot, idx)) { const g = SPOT[spot].gain; g.hidden = false; g.textContent = '+' + money(Math.floor(mine[spot] * spotPay(spot) * 100 + 1e-6) / 100); }
  const w = myWin(idx), name = NAMES[s.id];
  if (w != null) {
    placed.win = w;
    if (w > 0) {
      wonRound = r;
      showBanner(r, idx, w);
      setStatus('win', name + ' — ' + pick(PH.win));
      sound.play('win', w >= placed.total * 4);
    } else { showBanner(r, idx, 0); setStatus('lose', name + ' ×' + s.pay + '. ' + pick(PH.lose)); sound.play('lose'); }
  } else { showBanner(r, idx, null); setStatus('result', name + ' ×' + s.pay + '!'); }
  updateControls(); render();
}
function onResult(d) {
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, idx: d.outcome && d.outcome.pocket };
  const restored = placed && placed.round === S.round && placed.restored;
  if (restored) setTimeout(refreshBalance, 800); // reloaded mid-round: the client has no record of this bet
  if (placed && placed.round === S.round) {
    safeSS('jeweldrum:placed', null);
    const my = S.myBets[0];
    if (my && my.round === S.round) placed.win = my.win; // the client's settlement (capped like the engine)
  }
  const landingNow = landing && landing.round === S.round && scene && scene.spinning();
  if (landedRound !== S.round && !landingNow && d.outcome && d.outcome.pocket != null) { // the draw was missed (tab hidden): show it now
    round = S.round; drumShown = true;
    if (scene) scene.show(d.outcome.pocket);
    landing = { round: S.round, idx: d.outcome.pocket };
    landed(S.round, d.outcome.pocket);
  }
  render();
}
function refreshBalance() {
  const tok = (() => { try { return localStorage.getItem('token'); } catch (e) { return null; } })();
  if (!tok || tok === 'demo' || !game) return;
  fetch(game.apiUrl('/playerBalance'), { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } })
    .then((r) => r.json()).then((p) => { const b = p && p.data && p.data.balance; if (b != null) { S.balance = Number(b); render(); } }).catch(() => {});
}

let bannerT = 0, holdBanner = false; // holdBanner: QA stills only (window.__jd.hold())
function showBanner(r, idx, win) {
  if (bannerRound === r) return;
  bannerRound = r;
  const s = sym(idx), b = $('banner');
  $('bannerIc').src = ICONS[s.id] || '';
  setText($('bannerName'), NAMES[s.id]);
  setText($('bannerX'), '×' + s.pay);
  $('bannerWinBox').hidden = !(win > 0);
  b.classList.toggle('banner--win', win > 0);
  if (win > 0) {
    setText($('bannerTitle'), 'You win');
    setText($('bannerWin'), money(win));
    setText($('bannerSub'), placed && placed.maxWin > 0 && win >= placed.maxWin ? 'max win reached' : '');
    const bal = $('balance'); bal.classList.add('bump'); setTimeout(() => bal.classList.remove('bump'), 500);
  }
  b.hidden = false; b.classList.remove('banner--in'); void b.offsetWidth; b.classList.add('banner--in');
  clearTimeout(bannerT); if (!holdBanner) bannerT = setTimeout(() => { b.hidden = true; }, 4200);
}
function clearHighlights() {
  $('banner').hidden = true;
  for (const s in SPOT) { SPOT[s].el.classList.remove('is-win', 'is-lose'); SPOT[s].gain.hidden = true; }
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
    if (S.phase === 'pause' && (statusKey === 'result' || statusKey === 'win' || statusKey === 'lose') && now - lastPauseAt > 1800) setStatus('wait');
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- render (on every client change)
let histKey = '', listKey = '', strip = null;
function visibleHistory() { return S.history.filter((h) => !(h.round === revealRound && landedRound < revealRound)); }
function icon(id, cls) { return ICONS[id] ? '<img class="' + (cls || '') + '" src="' + ICONS[id] + '" alt="">' : '<i class="' + (cls || '') + ' noic"></i>'; }
function render() {
  if (!S || !started) return;
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
  const hist = visibleHistory(), hk = hist.length + ':' + (hist[0] && hist[0].round) + ':' + (ICONS.nx ? 1 : 0);
  if (hk !== histKey) { histKey = hk; renderHistory(hist); renderStats(hist); }
  renderList();
  updateControls();
  if (!strip && window.NXPlayers && !WIDE.matches) strip = window.NXPlayers.create($('stage'), { face: avatar });
  if (strip) strip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(name) { return NXPlayers.face(name, 'av', 'span'); } // a player's face (../_core/players.js)
function renderHistory(hist) {
  $('history').innerHTML = hist.slice(0, 24).map((h, i) => {
    const s = sym(h.outcome.pocket);
    return '<span class="hd' + (i === 0 ? ' hd--new' : '') + (s.id === 'nx' ? ' hd--nx' : '') + '" title="Round ' + h.round + ': ' + esc(NAMES[s.id]) + '">' + icon(s.id) + '<b>×' + s.pay + '</b></span>';
  }).join('') || '<span class="hd hd--empty">Results appear here</span>';
}
function renderStats(hist) {
  const n = hist.length, fam = {}, cnt = {};
  FAMILIES.forEach((f) => { fam[f] = 0; });
  hist.forEach((h) => { const s = sym(h.outcome.pocket); fam[s.family]++; cnt[s.id] = (cnt[s.id] || 0) + 1; });
  setText($('statN'), String(n));
  $('freq').innerHTML = FAMILIES.map((f) => {
    const w = f === 'orb' ? 16 : JR.FAMILY[f][0] * 4, exp = (w / JR.TOTAL) * 100, seen = n ? (fam[f] / n) * 100 : 0;
    return '<div class="fq">' + icon(f === 'orb' ? 'nx' : 'gold-' + f) + '<span class="fq__n">' + FAMILY_NAME[f] + '</span><span class="fq__bar"><i style="transform:scaleX(' + Math.min(1, seen / 60).toFixed(3) + ')"></i><em style="left:' + Math.min(100, (exp / 60) * 100).toFixed(1) + '%"></em></span><span class="fq__v">' + Math.round(seen) + '<small> / ' + exp.toFixed(0) + '%</small></span></div>';
  }).join('');
  // hot: seen most above its weight; cold: longest unseen among the common ones
  const ratio = JR.DRUM.map((s) => ({ s, r: n ? (cnt[s.id] || 0) / n / (s.weight / JR.TOTAL) : 0 }));
  const hot = n >= 5 ? ratio.filter((x) => cnt[x.s.id]).sort((a, b) => b.r - a.r).slice(0, 3) : [];
  const cold = n >= 5 ? ratio.filter((x) => x.s.weight >= 14 && !cnt[x.s.id]).slice(0, 3) : [];
  $('hot').innerHTML = hot.length ? hot.map((x) => icon(x.s.id, 'hc__ic')).join('') : '—';
  $('cold').innerHTML = cold.length ? cold.map((x) => icon(x.s.id, 'hc__ic')).join('') : '—';
}
function betIcons(bets) {
  return (bets || []).slice(0, 6).map((b) => {
    const [k, v] = String(b.spot).split(':');
    if (k === 'sym') return icon(v, 'bi');
    if (k === 'colour') return '<i class="bi bi--dot" style="--c:' + (COLOUR_UI[v] || '#fff') + '"></i>';
    return '<i class="bi bi--fam">' + esc((FAMILY_NAME[v] || v).slice(0, 2)) + '</i>';
  }).join('') + ((bets || []).length > 6 ? '<i class="bi bi--more">+' + (bets.length - 6) + '</i>' : '');
}
function renderList() {
  let rows, cols, count;
  if (tab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && landedRound >= S.round;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + (showWin && b.win > 0 ? ' row--won' : '') + '"><span class="row__user">' + esc(b.player || 'Player') + '</span><span class="row__bets">' + betIcons(b.bets) + '</span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Bets this round');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === revealRound && landedRound < revealRound));
    cols = '<span>Round</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => '<div class="row' + (m.win > 0 ? ' row--won' : '') + '"><span>#' + m.round + ' ' + (m.outcome ? icon(sym(m.outcome.pocket).id, 'bi') : '') + '</span><span class="row__bets">' + betIcons(m.bets) + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>');
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
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: 'jeweldrum', gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const i = res[1].outcome.pocket;
    out.innerHTML = 'Round ' + L.round + ': <b>' + esc(NAMES[sym(i).id]) + '</b>. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (L.idx == null || i === L.idx ? '✓ same jewel as drawn' : '✗ jewel differs');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

// first snapshot: put the drum in the state the round is in
function syncFromSnapshot() {
  started = true;
  round = S.round;
  const last = S.history[0];
  const stored = safeSS('jeweldrum:placed');
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
    const i = S.result && S.result.pocket != null ? S.result.pocket : last && last.outcome.pocket;
    if (i != null && scene) { scene.show(i); scene.win(true, i); }
    landedRound = S.round;
    setStatus('wait');
  }
  paintAll(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
buildBoard(); buildChips(); buildPaytable(); wire();
setStatus('wait');
game = window.NXTable.start({
  event: EVENT, game: 'jeweldrum',
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
  click: (speed) => sound.play('click', speed),
}).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  setIcons(sc.icons);
  window.__jd = { scene: sc, game, hold: () => { holdBanner = true; }, state: () => ({ round, closedRound, revealRound, landedRound, started, placed, pending }) }; // QA hook
  layout();
  if (!started && S && S.gotSnapshot && S.phase !== 'waiting') syncFromSnapshot();
});
setTimeout(() => { if (!started && scene) syncFromSnapshot(); }, 5000);
layout();
requestAnimationFrame(tick);
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#0d0622'); } }, 6000);
