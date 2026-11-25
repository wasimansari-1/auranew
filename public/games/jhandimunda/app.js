/* Jhandi Munda (88.0103) — six symbol dice thrown every 30 s, shared by every player (engine shared
 * table "jhandimunda": nexorng-engine/internal/tables/jhandimunda.go; client rules: rules.js).
 *   15 s betting → 10 s throw (the brass cup collects the dice and shakes; the dice step arrives 2.7 s
 *   after betting closed: the cup tips and the dice tumble onto the engine's six faces, ~1.8 s; then
 *   the winning symbols light up and are counted) → 5 s result.
 * Bets (one or more of the six symbols) are collected on the board and sent in ONE bet (Place bets, or
 * automatically 1.5 s before betting closes). Settlement and rules live in ../_core/table-client.js +
 * rules.js (the pays: window.JMRules.PAYS); this file is the board, the round choreography and the
 * layout; scene.js is the 3D table.
 */
import { create as createScene, SYMBOLS, SYMBOL_NAMES, symbolImage } from './scene.js';

const $ = (id) => document.getElementById(id);
const WIDE = window.matchMedia('(min-width: 900px)');
const EVENT = '88.0103', KEY = 'jhandimunda';
const JM = window.JMRules;
const PAYS = JM.PAYS;
const BETTING_MS = 15000;
const AUTO_SEND_MS = 1500;
const CHIP_X = [1, 2, 5, 10, 25];
const PH = {
  betting: ['Pick your symbols — the cup is waiting', 'Bets are open — jhandi or munda?', 'Two of a kind pays 3×, six pays 100×', 'Back a symbol, or spread across a few', 'Which symbol will the dice love?', 'Place your chips on the board', 'Feeling lucky? Crown or flag?'],
  last: ['Last chips…', 'Closing soon', 'Final call — place your bets'],
  closed: ['No more bets — shaking the cup!', 'The dice are in the cup…', 'Shake, shake…', 'Bets are closed — here comes the throw'],
  rolling: ['The dice are rolling…', 'Here they come…', 'Tumbling…'],
  wait: ['Next throw soon', 'Get your symbols ready', 'A new throw is coming up', 'The cup is ready again'],
  noBet: ['Wait for the next throw', 'Bets are closed — next throw soon', 'Hold your chip for the next throw'],
  win: ['Shabash! You win!', 'The dice love you!', 'What a throw!', 'Nicely picked!'],
  lose: ['Not this time — next throw in a moment', 'So close — the cup shakes again soon', 'Next throw could be yours'],
};

// ---------------------------------------------------------------- state
const sound = window.JMAudio.create();
let scene = null, game = null, S = null;
let chipVals = CHIP_X.map((x) => r2(0.1 * x)), chipIdx = 0;
let pending = {}, stack = [], placed = null, placing = false, lastBets = null;
let round = 0, closedRound = 0, autoRound = 0, lastTick = -1;
let thrownRound = 0, throwDice = null, settledRound = 0, settleT = 0;
let started = false, readySent = false, listTab = 'all';
let bannerRound = 0, wonRound = 0, lastSeed = null, syncedEarly = false;
const TILES = {}; // symbol → { el, chip, badge }
const ICON = {};  // symbol → data URL (the dice-face art)

function r2(n) { return Math.round(n * 100) / 100; }
function money(n) { return game ? game.money(n) : '€' + Number(n).toFixed(2); }
function short(n) { if (n >= 1000) return r2(n / 1000) + 'K'; return Number.isInteger(r2(n)) ? String(r2(n)) : String(r2(n)).replace(/^0\./, '.'); }
function pickOne(list) { return list[Math.floor(Math.random() * list.length)]; }
function sum(o) { let t = 0; for (const k in o) t += o[k]; return r2(t); }
function chipClass(n) { let c = 0; for (let i = 0; i < chipVals.length; i++) if (n + 1e-9 >= chipVals[i]) c = i; return 'c' + c; }
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function safeSS(k, v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function fmtX(x) { return (Number.isInteger(x) ? String(x) : String(+x.toFixed(2))) + '×'; }
let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
let statusKey = '';
function setStatus(key, text) {
  if (key === statusKey && !text) return;
  statusKey = key;
  const el = $('status'); el.textContent = text || pickOne(PH[key] || ['']); el.dataset.kind = key;
}
function counts(dice) { const c = [0, 0, 0, 0, 0, 0, 0]; (dice || []).forEach((v) => { c[v]++; }); return c; }
function name(s) { return SYMBOL_NAMES[s][0]; }
function icon(s, cls) { return '<i class="si si--' + s + ' ' + (cls || 'ic') + '" role="img" aria-label="' + name(s) + '"></i>'; } // the art: one CSS rule per symbol

// ---------------------------------------------------------------- build once
function buildBoard() {
  SYMBOLS.forEach((s) => { ICON[s] = symbolImage(s, 128, true); });
  const css = document.createElement('style');
  css.textContent = SYMBOLS.map((s) => '.si--' + s + '{background-image:url(' + ICON[s] + ')}').join('');
  document.head.appendChild(css);
  $('paybar').innerHTML = '<span class="paybar__t">PAYS</span>' + [2, 3, 4, 5, 6].map((k) => '<span class="pb" data-k="' + k + '"><i>' + k + '<small>dice</small></i><b>' + fmtX(PAYS[k]) + '</b></span>').join('');
  $('payRows').innerHTML = [0, 1, 2, 3, 4, 5, 6].map((k) => '<tr><td>' + (k === 0 ? 'None' : k === 1 ? '1 die' : k + ' dice') + '</td><td>' + (PAYS[k] > 0 ? fmtX(PAYS[k]) : 'lost') + '</td></tr>').join('');
  const box = $('tiles');
  SYMBOLS.forEach((s) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tile tile--' + s; b.dataset.s = s;
    b.setAttribute('aria-label', name(s) + ' (' + SYMBOL_NAMES[s][1] + ')');
    b.innerHTML = '<span class="tile__face"><img src="' + ICON[s] + '" alt=""></span><span class="tile__name"><b>' + name(s) + '</b><small>' + SYMBOL_NAMES[s][1] + '</small></span><span class="tile__count" hidden></span>';
    const chip = document.createElement('span'); chip.className = 'bchip'; chip.hidden = true; b.appendChild(chip);
    b.addEventListener('click', () => addChip(s, b));
    box.appendChild(b);
    TILES[s] = { el: b, chip, badge: b.querySelector('.tile__count'), key: '' };
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
    b.hidden = max > 0 && chipVals[i] > max + 1e-9;
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
  fly(center($('chips').children[chipIdx]), center(TILES[spot].chip.hidden ? el : TILES[spot].chip), chipClass(amt), short(amt), 0, 260).then(paintAll);
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
  const lim = game.limit();
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
  const bets = SYMBOLS.filter((s) => snap[s]).map((s) => ({ spot: s, amount: snap[s] }));
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

function paintTile(s) {
  const t = TILES[s], amt = myBetsNow()[s] || 0, key = s + ':' + amt;
  if (key === t.key) return;
  t.key = key;
  t.el.classList.toggle('has', amt > 0);
  if (amt > 0) { t.chip.hidden = false; t.chip.className = 'bchip ' + chipClass(amt); t.chip.textContent = short(amt); }
  else t.chip.hidden = true;
}
function paintAll() { SYMBOLS.forEach((s) => { TILES[s].key = ''; paintTile(s); }); }

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
    if (wonRound === round && settledRound === round) { place.classList.add('place--won'); label = 'You won ' + money(placed.win || 0); sub = 'next throw soon'; }
    else if (settledRound === round) { place.classList.add('place--done'); label = 'Next throw soon'; sub = 'no win this time'; }
    else { place.classList.add('place--done'); label = (S.phase === 'betting' ? 'Bets placed · ' : 'Locked · ') + money(placed.total); sub = nb + (nb === 1 ? ' symbol' : ' symbols') + (S.phase === 'betting' ? ' · good luck!' : ' · throwing'); }
  } else if (open && n) { place.disabled = false; label = 'Place bets'; sub = n + (n === 1 ? ' symbol · ' : ' symbols · ') + money(total); }
  else if (open) { place.disabled = true; label = 'Pick a symbol'; sub = 'chip ' + money(chipVals[chipIdx]); }
  else { place.disabled = true; label = S.phase === 'betting' || S.phase === 'dealing' ? 'No more bets' : 'Next throw soon'; }
  setText($('placeLabel'), label); setText($('placeSub'), sub);
  const b = $('board');
  b.classList.toggle('board--closed', !open || lock);
  b.classList.toggle('board--result', settledRound === round && !!round);
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
  else if (type === 'deal') onDeal(d.step, 0);
  else if (type === 'result') onResult(d);
  else if (type === 'error') { toast(d.text); sound.play('error'); }
}

function lastResult() { const h = S && S.history.find((x) => x.outcome && x.outcome.dice && x.outcome.dice.length === 6); return h || null; }
function onBetting() {
  round = S.round; lastTick = -1;
  if (placed && placed.round !== round) placed = null;
  pending = {}; stack = [];
  clearHighlights();
  if (scene) scene.highlight(null);
  setStatus('betting');
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
    back.forEach((s, i) => fly(center(TILES[s].el), rack, chipClass(pending[s]), short(pending[s]), i * 40, 380, { fadeOut: true }));
    pending = {}; stack = []; paintAll();
  }
  if (scene && thrownRound !== round) { scene.gather(); sound.play('gather'); }
  updateControls(); render();
}

// the dice step: the cup tips and the dice tumble onto these faces (elapsed: ms since the step)
function onDeal(step, elapsed) {
  if (!step || step.kind !== 'dice' || !step.dice || step.dice.length !== 6) return;
  const r = step.round || S.round;
  if (r !== round) round = r;
  if (thrownRound === r) return;
  if (closedRound !== r) { closedRound = r; setStatus('closed'); pending = {}; stack = []; paintAll(); }
  thrownRound = r; throwDice = step.dice.slice();
  setStatus('rolling');
  clearTimeout(settleT);
  const ms = scene ? scene.throwDice(throwDice, r, elapsed) : 0;
  if (ms <= 0 || !scene || scene.kind !== 'webgl') { if (ms <= 0) settled(r); }
  else settleT = setTimeout(() => settled(r), ms + 600); // a safety net: the scene normally calls settled() itself
  updateControls(); render();
}
function settled(r) {
  if (r !== round || settledRound === r || !throwDice) return;
  clearTimeout(settleT);
  settledRound = r;
  const out = { dice: throwDice.slice() };
  if (scene) scene.highlight(out.dice);
  showCounts(out.dice);
  markBoard(out);
  const w = myWin(out), c = counts(out.dice), top = SYMBOLS.map((s, i) => [s, c[i + 1]]).filter((e) => e[1] >= 2).sort((a, b) => b[1] - a[1]);
  const what = top.length ? top.map((e) => name(e[0]) + ' ×' + e[1]).join(' · ') : 'all different';
  if (w != null) {
    placed.win = w;
    if (w > 0) {
      wonRound = r;
      showBanner(r, w, out);
      setStatus('win', what + ' — ' + pickOne(PH.win));
      sound.play('win', w >= placed.total * 10);
    } else { setStatus('lose', what + '. ' + pickOne(PH.lose)); sound.play('lose'); }
  } else { setStatus('result', top.length ? what + ' win' : 'All six different — no symbol wins'); sound.play('reveal'); }
  updateControls(); render();
}
function myWin(out) {
  if (!placed || placed.round !== round) return null;
  let w = 0;
  for (const s in placed.bets) w += r2(placed.bets[s] * game.pay(out, s));
  w = r2(w);
  if (placed.maxWin > 0 && w > placed.maxWin) { placed.capped = true; w = placed.maxWin; }
  return w;
}
function showCounts(dice) {
  const c = counts(dice), el = $('counts');
  const items = SYMBOLS.map((s, i) => [s, c[i + 1]]).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1] || SYMBOLS.indexOf(a[0]) - SYMBOLS.indexOf(b[0]));
  el.innerHTML = items.map(([s, n], i) => '<span class="cnt' + (n >= 2 ? ' cnt--win' : '') + '" style="animation-delay:' + (i * 0.12) + 's">' + icon(s) + '<b>×' + n + '</b>' + (n >= 2 ? '<em>' + fmtX(PAYS[n]) + '</em>' : '') + '</span>').join('');
  el.hidden = false;
}
function markBoard(out) {
  const bets = placed && placed.round === round ? placed.bets : {}, c = counts(out.dice);
  SYMBOLS.forEach((s, i) => {
    const t = TILES[s], n = c[i + 1], x = PAYS[n], mine = bets[s] || 0;
    t.el.classList.toggle('won', x > 0 && mine > 0);
    t.el.classList.toggle('drawn', x > 0 && !mine);
    t.el.classList.toggle('lost', mine > 0 && !x);
    t.el.classList.toggle('off', !x && !mine);
    t.badge.hidden = false;
    t.badge.innerHTML = n ? '<b>×' + n + '</b>' + (x > 0 ? '<em>' + (mine ? '+' + money(r2(mine * x)) : fmtX(x)) + '</em>' : '') : '<b class="zero">×0</b>';
  });
}
function clearHighlights() {
  $('banner').hidden = true;
  $('counts').hidden = true;
  SYMBOLS.forEach((s) => { const t = TILES[s]; t.el.classList.remove('won', 'drawn', 'lost', 'off'); t.badge.hidden = true; });
}

function onResult(d) {
  const o = d.outcome || {};
  if (S.seed) lastSeed = { round: S.round, seed: S.seed, hash: S.hash, dice: o.dice };
  if (placed && placed.round === S.round) {
    if (placed.restored) setTimeout(refreshBalance, 800); // reloaded mid-round: the client has no record of this bet
    safeSS(KEY + ':placed', null);
    const my = S.myBets[0];
    if (my && my.round === S.round) placed.win = my.win; // the client's settlement (capped like the engine)
  }
  if (o.dice && o.dice.length === 6 && settledRound !== S.round) {
    round = S.round; closedRound = round;
    if (thrownRound !== round) { // missed the throw (tab hidden / joined at the very end): show the dice lying there
      thrownRound = round; throwDice = o.dice.slice();
      if (scene) scene.rest(o.dice, round);
      settled(round);
    } else if (scene && scene.kind !== 'webgl') settled(round);
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
  const c = counts(out.dice);
  setText($('bannerTitle'), 'You win');
  setText($('bannerWin'), money(win));
  const lines = SYMBOLS.filter((s) => placed.bets[s] && PAYS[c[SYMBOLS.indexOf(s) + 1]] > 0)
    .map((s) => { const n = c[SYMBOLS.indexOf(s) + 1]; return '<span>' + icon(s) + ' ×' + n + ' <b>+' + money(r2(placed.bets[s] * PAYS[n])) + '</b></span>'; });
  if (placed.capped) lines.push('<span>Max win per round <b>' + money(placed.maxWin) + '</b></span>');
  $('bannerLines').innerHTML = lines.slice(0, 4).join('');
  const b = $('banner');
  b.hidden = false; b.classList.remove('banner--in'); void b.offsetWidth; b.classList.add('banner--in');
  clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, 5200);
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
function visibleHistory() { return S.history.filter((h) => h.outcome && h.outcome.dice && h.outcome.dice.length === 6 && !(h.round === round && settledRound < round)); }
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
  setText($('fSeed'), lastSeed && lastSeed.round === settledRound ? lastSeed.seed : (S.phase === 'betting' ? 'revealed after the round' : '—'));
  const hist = visibleHistory(), hk = hist.length + ':' + (hist[0] && hist[0].round);
  if (hk !== histKey) { histKey = hk; renderHistory(hist); renderHeat(hist); }
  renderList();
  updateControls();
  if (!playersStrip && window.NXPlayers && !WIDE.matches) playersStrip = window.NXPlayers.create($('stage'), { face: avatar });
  if (playersStrip) playersStrip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: (S.bets || []).map((b) => ({ player: String(b.player || 'Player'), x: 0 })) });
}
function avatar(n) { return NXPlayers.face(n, 'av', 'span'); } // a player's face (../_core/players.js)
function histItem(h, i) {
  const c = counts(h.outcome.dice);
  const top = SYMBOLS.map((s, k) => [s, c[k + 1]]).filter((e) => e[1] >= 2).sort((a, b) => b[1] - a[1]);
  const body = top.length ? top.slice(0, 3).map((e) => '<span class="hs">' + icon(e[0], 'hi') + '<b>' + e[1] + '</b></span>').join('') : '<span class="hs hs--none">no pair</span>';
  return '<span class="hr' + (i === 0 && h.round === settledRound ? ' hr--new' : '') + '" title="Round ' + h.round + ': ' + h.outcome.dice.map((v) => name(SYMBOLS[v - 1])).join(', ') + '">' + body + '</span>';
}
function renderHistory(hist) {
  $('history').innerHTML = hist.slice(0, 20).map(histItem).join('') || '<span class="hr hr--empty">Results appear here</span>';
}
function renderHeat(hist) {
  const wins = [0, 0, 0, 0, 0, 0];
  hist.forEach((h) => { const c = counts(h.outcome.dice); for (let k = 0; k < 6; k++) if (c[k + 1] >= 2) wins[k]++; });
  setText($('statN'), String(hist.length));
  const max = Math.max(1, ...wins);
  $('heat').innerHTML = SYMBOLS.map((s, k) => '<span class="hb" title="' + name(s) + ' won ' + wins[k] + ' of ' + hist.length + '">' + icon(s, 'hi') + '<i><em style="width:' + Math.round(4 + (wins[k] / max) * 96) + '%"></em></i><b>' + wins[k] + '</b></span>').join('');
}
function betsText(bets) { const l = (bets || []).map((b) => (SYMBOL_NAMES[b.spot] ? name(b.spot) : b.spot)); return l.length > 2 ? l.slice(0, 2).join(' · ') + ' +' + (l.length - 2) : l.join(' · ') || '—'; }
function renderList() {
  let rows, cols, count;
  if (listTab === 'all') {
    const bets = S.bets.slice().reverse();
    cols = '<span>Player</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = bets.length;
    rows = bets.slice(0, 40).map((b) => {
      const showWin = b.win != null && settledRound >= S.round;
      return '<div class="row' + (b.mine ? ' row--mine' : '') + '"><span class="row__who">' + avatar(b.player || 'Player').outerHTML + esc(b.player || 'Player') + '</span><span>' + esc(betsText(b.bets)) + '</span><span>' + money(Number(b.total) || 0) + '</span><span class="row__win">' + (showWin ? (b.win > 0 ? money(b.win) : '—') : '') + '</span></div>';
    });
    setText($('countLabel'), 'Bets this round');
  } else {
    const mine = S.myBets.filter((m) => !(m.round === round && settledRound < round));
    cols = '<span>Round</span><span>Bets</span><span>Stake</span><span>Win</span>';
    count = mine.length;
    rows = mine.map((m) => '<div class="row"><span>#' + m.round + '</span><span>' + esc(betsText(m.bets)) + '</span><span>' + money(m.stake) + '</span><span class="row__win">' + (m.win > 0 ? money(m.win) : '—') + '</span></div>');
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
  Promise.all([crypto.subtle.digest('SHA-256', hexBytes(L.seed)), window.NXTable.verify({ game: KEY, gameId: game.event, seed: L.seed, round: L.round })]).then((res) => {
    const h = Array.prototype.map.call(new Uint8Array(res[0]), (x) => ('0' + x.toString(16)).slice(-2)).join('');
    const d = res[1].outcome.dice;
    out.innerHTML = 'Round ' + L.round + ': ' + d.map((v) => name(SYMBOLS[v - 1])).join(', ') + '. ' + (h === L.hash ? '✓ hash matches' : '✗ hash mismatch') + ' · ' + (!L.dice || d.join('') === L.dice.join('') ? '✓ same dice as thrown' : '✗ dice differ');
  }).catch(() => { out.textContent = 'Could not recompute in this browser.'; });
}

// the dice step of the round in play (live state): how long ago it was, from its server time
function dealStep() { return (S.deals || []).filter((x) => x.kind === 'dice' && x.dice && x.dice.length === 6).pop(); }
function stepAge(st) { const t = Date.parse(st && st.time); return isFinite(t) ? clamp(Date.now() - t, 0, 6000) : 0; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// after a reconnect: events may have been missed — catch up without restarting what is on screen
let wasConnected = null, reconnectedAt = 0;
function catchUp() {
  if (S.round !== round) { reconnectedAt = 0; clearHighlights(); if (placed && placed.round !== S.round) placed = null; syncFromSnapshot(); return; }
  if (S.phase === 'dealing') {
    const st = dealStep();
    if (st && thrownRound !== round) onDeal(st, stepAge(st));
    else if (!st && closedRound !== round) closeRound();
  } else if ((S.phase === 'result' || S.phase === 'pause') && S.result && settledRound !== round) onResult({ outcome: S.result });
}

// first snapshot: put the table in the state the round is in (joining mid-round, reloads)
function syncFromSnapshot() {
  started = true;
  round = S.round;
  const last = lastResult();
  const stored = safeSS(KEY + ':placed');
  if (stored && stored.round === S.round && (S.phase === 'betting' || S.phase === 'dealing')) { placed = stored; placed.restored = true; }
  if (S.phase === 'dealing') {
    closedRound = round;
    if (last && scene) scene.rest(last.outcome.dice, last.round);
    const st = dealStep();
    if (st) onDeal(st, stepAge(st)); // joined mid-throw: the same throw, from where it is now
    else { setStatus('closed'); if (scene) scene.gather(); }
  } else if (S.phase === 'betting') {
    if (last && scene) scene.rest(last.outcome.dice, last.round);
    setStatus('betting');
    if (Date.now() >= S.endsAt) closeRound();
  } else {
    const d = S.result && S.result.dice ? S.result.dice : last && last.outcome.dice;
    if (d && scene) {
      scene.rest(d, S.round); thrownRound = S.round; throwDice = d.slice();
      settled(S.round);
    }
    setStatus('wait');
  }
  paintAll(); render();
}

// ---------------------------------------------------------------- start
const bootAt = Date.now();
buildBoard(); buildChips(); wire();
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
createScene($('scene'), {
  rattle: () => sound.play('rattle'),
  tip: () => sound.play('tip'),
  impact: (s) => sound.play('impact', s),
  settled: () => settled(thrownRound),
}).then((sc) => {
  scene = sc;
  document.documentElement.dataset.renderer = sc.kind;
  window.__jm = { scene: sc, game, state: () => ({ round, closedRound, thrownRound, settledRound, throwDice, started, placed, pending, phase: S && S.phase }) }; // QA hook
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
setTimeout(() => { if (!readySent) { readySent = true; game.ready(); game.theme('#c08a52'); } }, 6000);
