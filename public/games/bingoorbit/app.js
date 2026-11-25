/* Bingo Orbit — an original NEXORNG draw game. A shared draw every 30 s: cards on sale for 10 s,
 * then 30 balls from the orbit cage (one every 500 ms), result, a short pause, next round.
 * Players play 1–4 cards (phone: one rack; desktop: two racks of two, each with its own price);
 * the cards are sent together in ONE bet just before sales close, daubed automatically as the balls
 * land, and each pays its highest pattern (rules.js). The engine runs the shared round
 * (tables runner, rules "bingoorbit"); ../_core/table-client.js is the client. */
import { createScene, BALL_COLORS } from './scene.js';

const R = window.BORules;
const EVENT = '88.0089'; // the game's catalogue ID (?event=… overrides)
const SEND_LEAD = 1500;  // ms before sales close: the armed cards are sent together
const LAND_MS = 400;     // a ball lands in the cup this long after its deal step
const PAUSE_MS = 4000;   // the runner's pause after the result
const $ = (id) => document.getElementById(id);
let held = false, heldDirty = false; // QA hold (see hold())
const heldQ = [];
const wide = window.matchMedia('(min-width: 900px)');
const stage = $('stage');

// ---------------------------------------------------------------- engine client (started at the end of this file)
let game = null, S = null;
const money = (n) => game.money(n);
const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- the player's cards (remembered)
const STORE = 'bingoorbit-state';
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { /* fresh */ }
const slots = [0, 1, 2, 3].map((i) => {
  const s = saved && saved.slots && saved.slots[i];
  const card = s && Array.isArray(s.card) && R.parse(R.spot(s.card)) ? s.card : R.newCard();
  return { on: s ? !!s.on : i === 0, card };
});
slots[0].on = true;
const panels = [0, 1].map((p) => ({ price: (saved && saved.prices && +saved.prices[p]) || 0, auto: !!(saved && saved.auto && saved.auto[p]), armed: false }));
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ slots: slots.map((s) => ({ on: s.on, card: s.card })), prices: panels.map((p) => p.price), auto: panels.map((p) => p.auto) })); } catch (e) { /* ignore */ }
}
const panelOf = (i) => (wide.matches ? (i < 2 ? 0 : 1) : 0);
const priceOf = (i) => panels[panelOf(i)].price;
const removable = (i) => (wide.matches ? i % 2 === 1 : i !== 0);
const visibleSlot = (i) => wide.matches || slots[i].on;
const cardNo = (i) => (wide.matches ? i + 1 : slots.slice(0, i + 1).filter((s) => s.on).length);
const activeIn = (p) => slots.map((s, i) => i).filter((i) => slots[i].on && panelOf(i) === p);

// limits: min per card preselected; the round total (all cards) must stay within the max
const STEPS = [0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000];
let LIM = { min: 0.1, max: 100 };
function clampPrice(v) { v = Math.max(LIM.min, v || LIM.min); if (LIM.max > 0) v = Math.min(v, LIM.max); return round2(v); }
panels.forEach((p) => { p.price = clampPrice(p.price || LIM.min); });

// ---------------------------------------------------------------- the round as the player sees it
let uiRound = 0, dealt = 0, landed = [], sent = null, lastBallOfPrev = 0, roundPhrase = '', resultAt = 0;
let bestSeen = {}, winShown = false;
const landTimers = [];
function clearLanding() { landTimers.splice(0).forEach(clearTimeout); }

function newRound() {
  clearLanding();
  const prev = S.history && S.history[0] && S.history[0].outcome && S.history[0].outcome.balls;
  lastBallOfPrev = prev && prev.length ? prev[prev.length - 1] : landed[landed.length - 1] || 0;
  uiRound = S.round; dealt = 0; landed = []; bestSeen = {}; winShown = false; resultAt = 0;
  if (sent && sent.round !== S.round) sent = null;
  roundPhrase = window.NXPhrases ? NXPhrases.pick('betting') : 'Cards on sale';
  panels.forEach((p) => { if (p.auto && activeIn(panels.indexOf(p)).length) p.armed = true; });
  armSendTimer();
  scene.refill(lastBallOfPrev);
  scene.energy(0); scene.win(false);
  hideBanner();
  railReset(true);
  render();
}
function snapTo() { // joined mid-round (or missed steps): show what has been drawn so far, no animation
  clearLanding();
  uiRound = S.round;
  const balls = S.result && S.result.balls ? S.result.balls.slice() : S.deals.map((d) => d.value);
  dealt = S.phase === 'result' || S.phase === 'pause' ? balls.length : S.deals.length;
  landed = balls.slice(0, Math.max(dealt, S.deals.length));
  if (S.phase === 'result' || S.phase === 'pause') landed = balls;
  scene.setRound(landed);
  scene.energy(S.phase === 'dealing' ? 1 : 0);
  railReset(false);
  snapCells = true;
  render();
}
function onSignal(type, d) {
  if (held) { heldQ.push(() => onSignal(type, d)); return; }
  if (type === 'betting') { newRound(); if (BOAudio.soundOn) BOAudio.rattle(false); return; }
  if (type === 'deal') {
    const st = d.step;
    if (S.round !== uiRound || st.step !== dealt) { snapTo(); return; }
    dealt++;
    scene.energy(1);
    scene.draw(st.value);
    BOAudio.pop();
    if (dealt === 1) BOAudio.rattle(true);
    landTimers.push(setTimeout(() => land(st.value), LAND_MS));
    return;
  }
  if (type === 'result') {
    resultAt = Date.now();
    const balls = (d.outcome && d.outcome.balls) || [];
    if (landed.length < balls.length) { // let the last ball land, then settle the picture
      landTimers.push(setTimeout(() => finish(d), Math.max(0, LAND_MS + 60)));
    } else finish(d);
    return;
  }
  if (type === 'error') { BOAudio.refused(); toast(d.text); }
}
function land(n) {
  if (held) { heldQ.push(() => land(n)); return; }
  if (landed.indexOf(n) >= 0) return;
  landed.push(n);
  BOAudio.land();
  railPush(n);
  const k = updateCards(true);
  if (k.daubs) BOAudio.daub(landed.length / 3);
  if (k.level) BOAudio.pattern(k.level);
  if (landed.length >= R.BALLS) scene.energy(0);
  render();
}
function finish(d) {
  if (held) { heldQ.push(() => finish(d)); return; }
  const balls = (d.outcome && d.outcome.balls) || [];
  balls.forEach((n) => { if (landed.indexOf(n) < 0) { landed.push(n); railPush(n); } });
  scene.energy(0);
  BOAudio.rattle(false);
  updateCards(true);
  const w = myWin();
  if (w.total > 0) { showBanner(w); scene.win(true); BOAudio.win(w.best === 'four' || w.best === 'bigx'); }
  render();
}

// ---------------------------------------------------------------- my cards in play this round
function inPlay(i) {
  return !!(sent && sent.round === S.round && sent.cards[i] && sameCard(sent.cards[i], slots[i].card));
}
function sameCard(a, b) { for (let k = 0; k < 25; k++) if (a[k] !== b[k]) return false; return true; }
function drawnSet() { const o = {}; landed.forEach((n) => { o[n] = true; }); return o; }
function myWin() {
  let total = 0, best = null, cards = 0, bestCard = -1;
  if (!sent || sent.round !== S.round) return { total, best, cards, bestCard };
  const ds = drawnSet();
  slots.forEach((s, i) => {
    if (!inPlay(i)) return;
    const e = R.evaluate(s.card, ds);
    if (e.best) {
      cards++; total += round2(sent.prices[i] * R.PAY[e.best]);
      if (!best || R.PAY[e.best] > R.PAY[best]) { best = e.best; bestCard = i; }
    }
  });
  total = round2(total);
  if (sent.maxWin > 0 && total > sent.maxWin) total = sent.maxWin; // the game's max-win cap (engine pays the same)
  return { total, best, cards, bestCard };
}

// ---------------------------------------------------------------- scene
const QA = /[?&]qa=1/.test(location.search); // headless QA on a software GPU
const scene = createScene($('scene'), { phone: !wide.matches, preserve: QA, maxFps: QA ? 0.5 : 0 });
let play = { x: 0, y: 56, w: 300, h: 200 };
function layout() {
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  let rail;
  if (wide.matches) {
    const bl = document.querySelector('.bets').getBoundingClientRect();
    const ld = $('ladder').getBoundingClientRect();
    const pn = $('panels').getBoundingClientRect();
    const railTop = pn.top - 48;
    play = { x: bl.right + 16, y: 64, w: Math.max(200, ld.left - 16 - (bl.right + 16)), h: Math.max(160, railTop - 8 - 64) };
    rail = { left: play.x, top: railTop, width: (ld.bottom > railTop - 4 ? ld.left - 16 : W - 16) - play.x }; // never under the pays
    stage.style.setProperty('--below', Math.max(0, H - pn.top + 40) + 'px');
  } else {
    const railH = 46;
    play = { x: 0, y: 56, w: W, h: Math.max(120, H - 56 - railH) };
    rail = { left: 12, top: H - railH + 4, width: W - 24 };
    stage.style.setProperty('--below', railH + 8 + 'px');
  }
  stage.style.setProperty('--left', play.x + 'px');
  Object.assign($('rail').style, { left: rail.left + 'px', top: rail.top + 'px', width: rail.width + 'px', right: 'auto' });
  Object.assign($('phase').style, { left: play.x + 'px', width: play.w + 'px', top: play.y + (wide.matches ? 14 : 4) + 'px' });
  Object.assign($('banner').style, { left: play.x + 'px', width: play.w + 'px', top: play.y + 'px', height: play.h + 'px' });
  scene.resize(W, H, play);
  railFit();
}
let layoutQ = 0;
function relayout() { cancelAnimationFrame(layoutQ); layoutQ = requestAnimationFrame(layout); }
window.addEventListener('resize', relayout);
if (window.ResizeObserver) new ResizeObserver(relayout).observe(stage);
wide.addEventListener('change', () => { placeSlots(); relayout(); render(); });

// ---------------------------------------------------------------- pay ladder
const TIER_CELLS = { line: [10, 11, 12, 13, 14], corners: [0, 4, 20, 24], two: [0, 1, 2, 3, 4, 7, 12, 17, 22], bigx: [0, 6, 12, 18, 24, 4, 8, 16, 20], four: [0, 1, 2, 3, 4, 20, 21, 22, 23, 24, 5, 10, 15, 9, 14, 19] };
const tiers = {};
(function buildLadder() {
  const L = $('ladder');
  L.innerHTML = '<div class="ladder__cap">Pays per card</div>';
  R.ORDER.forEach((t) => {
    const el = document.createElement('div');
    el.className = 'tier';
    const on = new Set(TIER_CELLS[t].concat(12));
    el.innerHTML = `<div class="tier__pat">${Array.from({ length: 25 }, (_, i) => `<i class="${on.has(i) ? 'on' : ''}"></i>`).join('')}</div>
      <div class="tier__nm"></div><div class="tier__mx">×${R.PAY[t]}</div><div class="tier__eu"></div>`;
    L.appendChild(el);
    tiers[t] = { el, nm: el.querySelector('.tier__nm'), eu: el.querySelector('.tier__eu') };
  });
  $('rulesPays').innerHTML = R.ORDER.map((t) => `<tr><td>${R.NAMES[t]} <small>${{ four: 'any 4 lines', bigx: 'both diagonals', two: 'any 2 lines', corners: 'the 4 corners', line: 'any row, column or diagonal' }[t]}</small></td><td>×${R.PAY[t]}</td></tr>`).join('');
})();

// ---------------------------------------------------------------- card racks (built once)
const COLS = ['B', 'I', 'N', 'G', 'O'];
const ICON_SHUF = '<svg viewBox="0 0 24 24"><path d="M4 7h11l-3-3m3 3-3 3M20 17H9l3 3m-3-3 3-3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
const panelEls = [], slotEls = [], addEls = [];
function buildPanels() {
  const host = $('panels');
  [0, 1].forEach((p) => {
    const sec = document.createElement('section');
    sec.className = 'panel';
    sec.setAttribute('aria-label', p ? 'Cards 3 and 4' : 'Your cards');
    sec.innerHTML = `<div class="panel__head"><span>${p ? 'Cards 3–4' : 'Cards 1–2'}</span><button type="button" class="auto" aria-pressed="false">Every round <span class="sw"></span></button></div>
      <div class="rack"></div>
      <div class="ctrl">
        <div class="step"><button type="button" class="dec" aria-label="Lower card price">−</button><div class="step__v"><small>Per card</small><b class="price">—</b></div><button type="button" class="inc" aria-label="Higher card price">+</button></div>
        <button type="button" class="auto" aria-pressed="false"><span class="sw"></span>Every<br>round</button>
        <div class="quick">${[1, 2, 5, 10].map((q) => `<button type="button" data-q="${q}">${q}×</button>`).join('')}</div>
        <button type="button" class="buy"${p ? '' : ' id="action"'}><b></b><small></small></button>
      </div>`;
    host.appendChild(sec);
    const el = {
      sec, rack: sec.querySelector('.rack'), price: sec.querySelector('.price'), dec: sec.querySelector('.dec'), inc: sec.querySelector('.inc'),
      autos: sec.querySelectorAll('.auto'), quick: sec.querySelectorAll('.quick button'), buy: sec.querySelector('.buy'),
      buyB: sec.querySelector('.buy b'), buyS: sec.querySelector('.buy small'),
    };
    el.dec.onclick = () => stepPrice(p, -1);
    el.inc.onclick = () => stepPrice(p, 1);
    el.quick.forEach((b) => { b.onclick = () => setPrice(p, LIM.min * +b.dataset.q); });
    el.autos.forEach((b) => { b.onclick = () => toggleAuto(p); });
    el.buy.onclick = () => buy(p);
    panelEls.push(el);
  });
  for (let i = 0; i < 4; i++) {
    const c = document.createElement('div');
    c.className = 'card';
    let cells = '';
    for (let k = 0; k < 25; k++) cells += k === 12 ? '<div class="cell free"><img src="../../logo.webp" alt=""></div>' : '<div class="cell"><span></span></div>';
    c.innerHTML = `<div class="card__h"><span class="card__no">Card ${i + 1}</span><span class="card__st"></span>
        <button type="button" class="cbtn shuf" aria-label="New numbers">${ICON_SHUF}</button><button type="button" class="cbtn rm" aria-label="Remove card">${ICON_X}</button></div>
      <div class="card__hd">${COLS.map((L, j) => `<span style="background:${BALL_COLORS[j]}">${L}</span>`).join('')}</div>
      <div class="card__cells">${cells}<svg class="card__lines" viewBox="0 0 5 5" preserveAspectRatio="none"></svg></div>`;
    const el = { c, no: c.querySelector('.card__no'), st: c.querySelector('.card__st'), shuf: c.querySelector('.shuf'), rm: c.querySelector('.rm'), cells: [...c.querySelectorAll('.cell')], lines: c.querySelector('.card__lines'), key: '', lineKey: '', status: '' };
    el.nums = el.cells.map((x) => x.querySelector('span'));
    el.shuf.onclick = () => { if (locked()) return; slots[i].card = R.newCard(); save(); BOAudio.click(); paintNumbers(i); render(); };
    el.rm.onclick = () => { if (locked() || !removable(i)) return; slots[i].on = false; save(); BOAudio.click(); render(); fitSoon(); };
    slotEls.push(el);
    const a = document.createElement('button');
    a.type = 'button'; a.className = 'card add';
    a.innerHTML = `<span><b>+</b><i>Add card ${i + 1}</i></span>`;
    a.onclick = () => { if (locked()) return; slots[i].on = true; slots[i].card = R.newCard(); save(); BOAudio.click(); paintNumbers(i); render(); fitSoon(); };
    addEls.push(a);
    paintNumbers(i);
  }
  placeSlots();
}
function placeSlots() { // phone: all four slots in rack 1; desktop: two per rack
  for (let i = 0; i < 4; i++) {
    const rack = panelEls[panelOf(i)].rack;
    rack.appendChild(slotEls[i].c);
    rack.appendChild(addEls[i]);
  }
}
function paintNumbers(i) {
  const card = slots[i].card, el = slotEls[i];
  card.forEach((n, k) => { if (k !== 12) el.nums[k].textContent = n; });
  el.key = '';
}
let fitT = 0;
function fitSoon() { clearTimeout(fitT); fitT = setTimeout(() => window.dispatchEvent(new Event('resize')), 30); }

// ---------------------------------------------------------------- prices, auto, buy
function setPrice(p, v) {
  if (sentFor(p)) return;
  v = clampPrice(v);
  if (!wide.matches) panels.forEach((x) => { x.price = v; }); else panels[p].price = v;
  save(); BOAudio.click(); render();
}
function stepPrice(p, dir) {
  const cur = panels[p].price;
  let v = cur;
  if (dir > 0) v = STEPS.find((s) => s > cur + 1e-9) || cur;
  else v = [...STEPS].reverse().find((s) => s < cur - 1e-9) || LIM.min;
  setPrice(p, v);
}
function toggleAuto(p) {
  const v = !panels[p].auto;
  if (!wide.matches) panels.forEach((x) => { x.auto = v; }); else panels[p].auto = v;
  if (v && S.phase === 'betting' && !sent && activeIn(p).length) panels.forEach((x, k) => { if (!wide.matches || k === p) x.armed = true; });
  save(); BOAudio.click(); render();
}
const sentFor = (p) => !!(sent && sent.round === S.round && sent.panels.indexOf(p) >= 0 && (S.phase === 'betting' || S.phase === 'dealing'));
const locked = () => !!(sent && sent.round === S.round && (S.phase === 'betting' || S.phase === 'dealing'));
function cardsFor(p) { return wide.matches ? activeIn(p) : activeIn(0); }
function buy(p) {
  BOAudio.unlock();
  const pList = wide.matches ? [p] : [0, 1];
  if (sentFor(p)) return;
  if (!cardsFor(p).length) return;
  const on = !(panels[p].armed || (panels[p].auto && S.phase !== 'betting'));
  if (on && S.balance != null) { // the whole bet (both racks when armed) must fit the balance
    const need = round2((wide.matches ? [0, 1] : [0]).reduce((t, k) => t + (k === p || panels[k].armed ? cardsFor(k).length * panels[k].price : 0), 0));
    if (need > S.balance + 1e-9) { BOAudio.refused(); toast('Not enough balance for ' + money(need) + '.'); return; }
  }
  pList.forEach((k) => { panels[k].armed = on; if (!on) panels[k].auto = false; }); // cancelling also stops "every round"
  save();
  if (on) BOAudio.armed(); else BOAudio.click();
  if (on && S.phase === 'betting' && !sent && S.endsAt - Date.now() < SEND_LEAD + 200) sendNow(); else armSendTimer();
  render();
}
let sending = false, sendT = 0;
// the armed cards go out SEND_LEAD before sales close — a timer, so a slow or hidden page still sends
function armSendTimer() {
  clearTimeout(sendT);
  if (S.phase !== 'betting' || sent) return;
  sendT = setTimeout(sendNow, Math.max(0, S.endsAt - SEND_LEAD - Date.now()));
}
function sendNow() {
  if (sending || sent || S.phase !== 'betting' || Date.now() >= S.endsAt) return;
  const armedPanels = wide.matches ? [0, 1].filter((p) => panels[p].armed && activeIn(p).length) : (panels[0].armed ? [0] : []);
  if (!armedPanels.length) return;
  const idx = [], seen = {};
  armedPanels.forEach((p) => activeIn(p).forEach((i) => { const sp = R.spot(slots[i].card); if (!seen[sp]) { seen[sp] = 1; idx.push(i); } }));
  const total = round2(idx.reduce((t, i) => t + priceOf(i), 0));
  if (LIM.max > 0 && total > LIM.max + 1e-9) { toast('Total ' + money(total) + ' is above the limit of ' + money(LIM.max) + ' per round.'); return; }
  const bets = idx.map((i) => ({ spot: R.spot(slots[i].card), amount: priceOf(i) }));
  const round = S.round, cards = {}, prices = {};
  idx.forEach((i) => { cards[i] = slots[i].card.slice(); prices[i] = priceOf(i); });
  sending = true;
  game.bet(bets).then((res) => {
    sent = { round, cards, prices, panels: armedPanels.slice(), total, n: idx.length, maxWin: res && res.maxWin != null ? Number(res.maxWin) : 0 };
    panels.forEach((x) => { x.armed = false; });
    BOAudio.armed();
  }).catch(() => { /* the client showed the error */ }).finally(() => { sending = false; render(); });
}

// ---------------------------------------------------------------- per-card view
let snapCells = false;
function updateCards(live) {
  const ds = drawnSet(), out = { daubs: 0, level: 0 };
  const last = landed[landed.length - 1];
  const showing = S.phase === 'dealing' || S.phase === 'result' || S.phase === 'pause' || (S.phase === 'betting' && Date.now() > S.endsAt);
  slots.forEach((s, i) => {
    const el = slotEls[i], ip = inPlay(i) && landed.length > 0;
    const e = ip ? R.evaluate(s.card, ds) : null;
    // daubs
    for (let k = 0; k < 25; k++) {
      if (k === 12) continue;
      const cell = el.cells[k], d = !!(e && e.hit[k]);
      if (d !== cell.classList.contains('d')) {
        cell.classList.toggle('d', d);
        cell.classList.toggle('snap', d && (snapCells || !live));
        if (d && live && !snapCells) out.daubs++;
      }
      cell.classList.toggle('just', !!(d && s.card[k] === last && S.phase === 'dealing'));
      const want = !!(e && S.phase === 'dealing' && e.togo === 1 && e.want.indexOf(k) >= 0);
      cell.classList.toggle('want', want);
      cell.classList.toggle('wl', !!(e && (e.done.some((li) => R.LINES[li].indexOf(k) >= 0) || (e.best === 'corners' && R.CORNERS.indexOf(k) >= 0))));
    }
    // completed lines
    const lk = e ? e.done.join(',') : '';
    if (lk !== el.lineKey) {
      const prev = el.lineKey ? el.lineKey.split(',') : [];
      el.lines.innerHTML = '';
      (e ? e.done : []).forEach((li) => {
        const L = R.LINES[li], a = L[0], b = L[4];
        const ax = a % 5 + 0.5, ay = Math.floor(a / 5) + 0.5, bx = b % 5 + 0.5, by = Math.floor(b / 5) + 0.5;
        const dx = (bx - ax) * 0.06, dy = (by - ay) * 0.06;
        const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ln.setAttribute('x1', ax - dx); ln.setAttribute('y1', ay - dy); ln.setAttribute('x2', bx + dx); ln.setAttribute('y2', by + dy);
        ln.setAttribute('pathLength', '1'); ln.setAttribute('vector-effect', 'non-scaling-stroke');
        if (!live || snapCells || prev.indexOf(String(li)) >= 0) ln.classList.add('snap');
        el.lines.appendChild(ln);
      });
      el.lineKey = lk;
    }
    // a new best pattern on this card: one glow + chime
    if (e && e.best && live && !snapCells) {
      const lvl = R.ORDER.length - R.ORDER.indexOf(e.best);
      if (!bestSeen[i] || lvl > bestSeen[i]) {
        bestSeen[i] = lvl; out.level = Math.max(out.level, lvl);
        el.c.classList.remove('flash'); void el.c.offsetWidth; el.c.classList.add('flash');
      }
    } else if (e && e.best) bestSeen[i] = R.ORDER.length - R.ORDER.indexOf(e.best);
    // state + status label
    const won = !!(e && e.best), resultView = S.phase === 'result' || S.phase === 'pause';
    el.c.classList.toggle('won', won);
    el.c.classList.toggle('out', showing && !inPlay(i));
    el.c.classList.toggle('lose', resultView && inPlay(i) && !won);
    let st = '', cls = '';
    if (showing && !inPlay(i)) { st = 'Not in play'; cls = 'idle'; }
    else if (won) { st = R.SHORT[e.best] + ' ×' + R.PAY[e.best]; cls = 'won'; }
    else if (e && resultView) { st = 'No win'; }
    else if (e) { st = e.togo + ' to go'; cls = e.togo === 1 ? 'go' : ''; }
    else st = money(priceOf(i));
    const key = st + '|' + cls;
    if (el.status !== key) { el.st.textContent = st; el.st.className = 'card__st' + (cls ? ' ' + cls : ''); el.status = key; }
  });
  snapCells = false;
  return out;
}

// ---------------------------------------------------------------- results row (called balls)
const railBox = $('railBalls'), railCnt = $('railCnt');
const railBalls = document.createElement('div');
railBalls.className = 'rail__track';
railBox.appendChild(railBalls);
let railShown = [], railMax = 10;
function railFit() {
  const w = railBox.clientWidth;
  railMax = wide.matches ? 30 : Math.max(4, Math.floor((w + 6) / 36));
}
function ballEl(n, cls) {
  const b = document.createElement('div');
  b.className = 'b2d' + (cls ? ' ' + cls : '');
  b.style.setProperty('--c', BALL_COLORS[Math.floor((n - 1) / 15)]);
  b.innerHTML = '<i>' + n + '</i>';
  return b;
}
function railReset(betting) {
  railBalls.innerHTML = ''; railShown = [];
  if (betting) {
    const prev = S.history && S.history[0] && S.history[0].outcome && S.history[0].outcome.balls;
    if (prev) prev.slice().reverse().slice(0, railMax).forEach((n) => railBalls.appendChild(ballEl(n, 'dim')));
    railCnt.innerHTML = 'Last<br>draw'; railCnt.className = 'rail__cnt last';
    railCnt.hidden = !prev;
    return;
  }
  railCnt.hidden = false;
  landed.slice().reverse().forEach((n, k) => { if (k < railMax) railBalls.appendChild(ballEl(n, k === 0 ? 'new' : '')); });
  railShown = landed.slice();
  if (wide.matches) for (let k = landed.length; k < R.BALLS; k++) railBalls.appendChild(ballEl(1, 'slot'));
  railCount();
}
function railCount() {
  railCnt.className = 'rail__cnt';
  railCnt.innerHTML = landed.length + '<small>/' + R.BALLS + '</small>';
}
function railPush(n) {
  if (railShown.indexOf(n) >= 0) return;
  if (!railShown.length) { railBalls.innerHTML = ''; if (wide.matches) for (let k = 0; k < R.BALLS; k++) railBalls.appendChild(ballEl(1, 'slot')); }
  railShown.push(n);
  const first = railBalls.querySelector('.new');
  if (first) first.classList.remove('new');
  const mine = slots.some((s, i) => inPlay(i) && s.card.indexOf(n) >= 0);
  railBalls.insertBefore(ballEl(n, 'new' + (mine ? ' mine' : '')), railBalls.firstChild);
  // keep the row's length: drop an empty slot (desktop) or the oldest ball (phone)
  const kids = railBalls.children;
  if (kids.length > (wide.matches ? R.BALLS : railMax)) railBalls.removeChild(kids[kids.length - 1]);
  // slide in: the row starts one ball to the left and eases back (transform only)
  railBalls.style.transition = 'none';
  railBalls.style.transform = 'translateX(-36px)';
  void railBalls.offsetWidth;
  railBalls.style.transition = 'transform .28s cubic-bezier(.2,.8,.3,1)';
  railBalls.style.transform = 'none';
  railCnt.hidden = false;
  railCount();
}

// ---------------------------------------------------------------- banner, toast
function showBanner(w) {
  if (winShown) return;
  winShown = true;
  $('bannerK').textContent = w.cards > 1 ? w.cards + ' cards won' : 'You won';
  $('bannerP').textContent = R.NAMES[w.best];
  $('bannerX').textContent = 'card ' + cardNo(w.bestCard) + ' · ×' + R.PAY[w.best];
  $('bannerAmt').textContent = '+' + money(w.total);
  $('banner').hidden = false;
}
function hideBanner() { $('banner').hidden = true; scene.win(false); }
let toastT = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastT);
  const hide = () => { if (held) { toastT = setTimeout(hide, 500); return; } t.hidden = true; }; // (stays up while a QA screenshot is held)
  toastT = setTimeout(hide, 2600);
}

// ---------------------------------------------------------------- phase chip (updated every frame, writes only on change)
const ringFg = $('ringFg'), phaseEl = $('phase');
let chip = { t1: '', t2: '', num: '', frac: -1, cls: '', hot: false, hidden: false };
function setChip(t1, t2, num, frac, cls, hot, hidden) {
  if (chip.t1 !== t1) $('phaseT1').textContent = chip.t1 = t1;
  if (chip.t2 !== t2) $('phaseT2').textContent = chip.t2 = t2;
  if (chip.num !== num) $('ringNum').textContent = chip.num = num;
  const f = Math.round(frac * 200) / 200;
  if (chip.frac !== f) { ringFg.style.strokeDasharray = (f * 94.25).toFixed(2) + ' 94.25'; chip.frac = f; }
  if (chip.cls !== cls) { phaseEl.className = 'phase ' + cls; chip.cls = cls; }
  if (chip.hot !== hot) { $('phaseT2').classList.toggle('hot', hot); chip.hot = hot; }
  if (chip.hidden !== hidden) { phaseEl.classList.toggle('off', hidden); chip.hidden = hidden; }
}
let lastTick = -1;
const DRAW_LINES = ['The orbit is spinning', 'Eyes on your cards', 'Here comes the next one', 'Daubing for you', 'Thirty balls, one orbit'];
const MISS_LINES = ['No pattern this time', 'So close', 'The orbit rests', 'Next draw is coming', 'Fresh cards, fresh luck'];
let drawLine = DRAW_LINES[0], missLine = MISS_LINES[0];
function myStatus() {
  if (!sent || sent.round !== S.round) return null;
  const ds = drawnSet();
  let best = null, bestCard = -1, togo = 9, togoCard = -1;
  slots.forEach((s, i) => {
    if (!inPlay(i)) return;
    const e = R.evaluate(s.card, ds);
    if (e.best && (!best || R.PAY[e.best] > R.PAY[best])) { best = e.best; bestCard = i; }
    if (e.togo < togo) { togo = e.togo; togoCard = i; }
  });
  return { best, bestCard, togo, togoCard };
}
function frame() {
  const now = Date.now();
  if (S.phase === 'betting') {
    const left = Math.max(0, S.endsAt - now), secs = Math.ceil(left / 1000), total = 10000;
    if (left > 0 && left <= 3000 && secs !== lastTick) { lastTick = secs; BOAudio.tick(secs === 1); }
    if (!sent && !sending && left <= SEND_LEAD && left > 150) sendNow();
    if (left === 0) { scene.energy(1); setChip('Sales closed', 'The draw starts…', '', 0, 'draw', false, false); return; }
    const armedN = [0, 1].reduce((t, p) => t + (panels[p].armed && (wide.matches || p === 0) ? cardsFor(p).length : 0), 0);
    const t2 = sent && sent.round === S.round ? 'Your ' + sent.n + (sent.n > 1 ? ' cards are' : ' card is') + ' in — good luck!'
      : armedN ? armedN + (armedN > 1 ? ' cards' : ' card') + ' · sent at 0:01' : roundPhrase;
    setChip('Cards on sale', t2, String(secs), left / total, '', !!(sent && sent.round === S.round), false);
    return;
  }
  if (S.phase === 'dealing' || (S.phase === 'result' && !resultAt)) {
    const k = landed.length, st = myStatus();
    let t2 = drawLine, hot = false;
    if (st && st.best) { t2 = 'Card ' + cardNo(st.bestCard) + ' · ' + R.NAMES[st.best] + ' ×' + R.PAY[st.best] + '!'; hot = true; }
    else if (st && st.togo === 1) { t2 = '1 to go on card ' + cardNo(st.togoCard) + '!'; hot = true; }
    else if (st && st.togo <= 4) t2 = st.togo + ' to go on card ' + cardNo(st.togoCard);
    setChip(k ? 'Ball ' + k + ' of ' + R.BALLS : 'Drawing…', t2, String(k), k / R.BALLS, 'draw', hot, false);
    return;
  }
  if (S.phase === 'result' || S.phase === 'pause') {
    const nextIn = resultAt ? Math.max(0, Math.ceil((resultAt + PAUSE_MS - now) / 1000)) : 0;
    const t1 = nextIn ? 'Next draw in ' + nextIn + ' s' : 'Next draw soon';
    const st = myStatus();
    const t2 = st ? (st.best ? 'Your cards won' : missLine) : 'Buy cards for the next draw';
    setChip(t1, t2, nextIn ? String(nextIn) : '', resultAt ? Math.max(0, (resultAt + PAUSE_MS - now) / PAUSE_MS) : 0, '', false, !$('banner').hidden);
    return;
  }
  setChip(S.connected ? 'Joining the table' : 'Connecting…', 'One moment', '', 0, '', false, false);
}
scene.onFrame(() => { if (!held) frame(); maybeReady(); });

// ---------------------------------------------------------------- render (state → DOM; light, no rebuilds)
let renderQ = 0;
function schedule() { if (held) { heldDirty = true; return; } if (!renderQ) renderQ = requestAnimationFrame(() => { renderQ = 0; render(); }); }
let shownBal = null, betsKey = '', mineKey = '', tab = 'all', playersStrip = null, lastPhase = '';
function render() {
  // round bookkeeping (snapshot, reconnect, missed steps)
  if (S.round && S.round !== uiRound) {
    if (S.phase === 'betting') newRound(); else snapTo();
    return;
  }
  if ((S.phase === 'dealing') && S.deals.length > dealt + 1) { snapTo(); return; }
  if (S.phase !== lastPhase) {
    if (S.phase === 'dealing') drawLine = DRAW_LINES[Math.floor(Math.random() * DRAW_LINES.length)];
    if (S.phase === 'result') missLine = MISS_LINES[Math.floor(Math.random() * MISS_LINES.length)];
    lastPhase = S.phase;
  }
  $('conn').hidden = S.connected || !S.gotSnapshot;
  // balance
  if (S.balance !== shownBal) { shownBal = S.balance; $('balance').textContent = S.balance == null ? '—' : money(S.balance); }
  $('mode').textContent = S.demo ? 'Demo' : 'Balance';
  // slots: visible + editable
  const lock = locked();
  let phoneAddShown = false;
  let ordinal = 0;
  for (let i = 0; i < 4; i++) {
    const el = slotEls[i], s = slots[i];
    const show = wide.matches ? (s.on || i % 2 === 0) : s.on;
    if (show) ordinal++;
    const label = 'Card ' + (wide.matches ? i + 1 : ordinal);
    if (el.no.textContent !== label) el.no.textContent = label;
    addEls[i].querySelector('i').textContent = 'Add card ' + (wide.matches ? i + 1 : ordinal + 1);
    if (wide.matches && i % 2 === 0) s.on = true;
    el.c.hidden = !show;
    let addShow = false;
    if (!show) { addShow = wide.matches ? true : !phoneAddShown; if (!wide.matches && addShow) phoneAddShown = true; }
    addEls[i].hidden = !addShow;
    addEls[i].disabled = lock;
    el.shuf.disabled = lock;
    el.shuf.hidden = false;
    el.rm.hidden = !removable(i);
    el.rm.disabled = lock;
  }
  updateCards(false);
  // panels
  [0, 1].forEach((p) => {
    const el = panelEls[p], P = panels[p];
    el.price.textContent = money(P.price);
    el.dec.disabled = P.price <= LIM.min + 1e-9 || sentFor(p);
    el.inc.disabled = (LIM.max > 0 && P.price >= LIM.max - 1e-9) || sentFor(p);
    el.quick.forEach((b) => b.classList.toggle('on', Math.abs(P.price - LIM.min * +b.dataset.q) < 1e-9));
    el.autos.forEach((b) => b.setAttribute('aria-pressed', P.auto ? 'true' : 'false'));
    const n = cardsFor(p).length, cost = round2(n * P.price);
    let b = '', sm = '', cls = '', dis = false;
    if (sentFor(p) && S.phase === 'betting') { b = 'In · ' + n + (n > 1 ? ' cards' : ' card'); sm = money(sent.total) + ' · good luck'; cls = 'wait'; dis = true; }
    else if (sentFor(p)) { b = (wide.matches ? 'Playing ' : 'Playing ') + n + (n > 1 ? ' cards' : ' card'); sm = P.auto ? 'Every round: on' : wide.matches ? 'Good luck' : 'Buy again for the next draw'; cls = 'wait'; dis = true; }
    else if (S.phase === 'betting' && Date.now() < S.endsAt) {
      if (P.armed) { b = 'Cancel'; sm = wide.matches ? money(cost) + ' · at 0:01' : n + (n > 1 ? ' cards' : ' card') + ' · ' + money(cost) + ' · sent at 0:01'; cls = 'armed'; }
      else { b = 'Buy ' + n + (n > 1 ? ' cards' : ' card'); sm = money(cost); }
    } else {
      if (P.armed || P.auto) { b = 'Next draw: on'; sm = P.auto ? 'Every round · ' + money(cost) : 'Tap to cancel'; cls = 'armed'; }
      else { b = wide.matches ? 'Next draw' : 'Buy for next draw'; sm = n + (n > 1 ? ' cards · ' : ' card · ') + money(cost); }
    }
    if (!n) { b = 'Add a card'; sm = ''; dis = true; }
    if (el.buyB.textContent !== b) el.buyB.textContent = b;
    if (el.buyS.textContent !== sm) el.buyS.textContent = sm;
    const c = 'buy' + (cls ? ' ' + cls : '');
    if (el.buy.className !== c) el.buy.className = c;
    el.buy.disabled = dis;
  });
  // ladder: my best pattern this round lights its tier
  const st = myStatus();
  R.ORDER.forEach((t) => {
    const T = tiers[t];
    T.el.classList.toggle('hit', !!(st && st.best === t));
    const nm = wide.matches ? R.NAMES[t] : R.SHORT[t];
    if (T.nm.textContent !== nm) T.nm.textContent = nm;
    const eu = money(round2(R.PAY[t] * panels[0].price)) + ' on ' + money(panels[0].price);
    if (T.eu.textContent !== eu) T.eu.textContent = eu;
  });
  // bets list
  renderBets();
  // players strip (phones)
  if (!playersStrip && window.NXPlayers && !wide.matches) playersStrip = NXPlayers.create(stage, {});
  if (playersStrip) playersStrip.update({ phase: S.phase === 'betting' ? 'betting' : 'closed', bets: S.bets.map((b) => ({ player: b.player, x: 0 })) });
  // provably fair
  $('fRound').textContent = S.round ? '#' + S.round : '—';
  $('fHash').textContent = S.hash || '—';
  $('fSeed').textContent = S.seed || 'revealed after the draw';
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderBets() {
  const all = S.bets || [];
  const cards = all.reduce((t, b) => t + ((b.bets && b.bets.length) || 0), 0), staked = all.reduce((t, b) => t + (b.total || 0), 0);
  $('betCount').textContent = all.length;
  if (tab === 'all') {
    const key = 'a' + all.length + ':' + all.map((b) => b.win).join(',') + S.phase;
    if (key === betsKey) return;
    betsKey = key; mineKey = '';
    $('betSum').innerHTML = `<span>${all.length} player${all.length === 1 ? '' : 's'} · ${cards} card${cards === 1 ? '' : 's'}</span><b>${money(staked)}</b>`;
    const rows = all.slice().reverse().slice(0, 60).map((b) => {
      const n = (b.bets && b.bets.length) || 0, me = b.mine || b.player === 'You', w = b.win;
      return `<div class="brow${me ? ' me' : ''}${w > 0 ? ' winr' : ''}"><div class="av" style="background:${NXPlayers.faceStyle(b.player)}"></div>
        <div class="nm"><b>${esc(me ? 'You' : b.player)}</b><small>${n} card${n === 1 ? '' : 's'}</small></div><div class="stk">${money(b.total)}</div>
        <div class="wn${w > 0 ? '' : ' no'}">${w > 0 ? '+' + money(w) : (S.phase === 'result' || S.phase === 'pause') ? '—' : ''}</div></div>`;
    }).join('');
    $('list').innerHTML = rows || '<div class="empty">No cards yet this round</div>';
  } else {
    const mine = S.myBets || [];
    const key = 'm' + mine.length + ':' + (mine[0] ? mine[0].round : '');
    if (key === mineKey) return;
    mineKey = key; betsKey = '';
    $('betSum').innerHTML = `<span>Your last draws</span><b>${money(mine.reduce((t, b) => t + b.win - b.stake, 0))}</b>`;
    $('list').innerHTML = mine.map((b) => `<div class="brow${b.win > 0 ? ' winr' : ''}"><div class="av" style="background:#6d28d9">#</div>
      <div class="nm"><b>Round ${b.round}</b><small>${b.bets.length} card${b.bets.length === 1 ? '' : 's'}</small></div><div class="stk">${money(b.stake)}</div>
      <div class="wn${b.win > 0 ? '' : ' no'}">${b.win > 0 ? '+' + money(b.win) : '—'}</div></div>`).join('') || '<div class="empty">Your draws will show here</div>';
  }
}
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    tab = t.dataset.tab; betsKey = mineKey = '';
    document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('on', x === t); x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
    renderBets();
  };
});

// ---------------------------------------------------------------- page controls
$('back').onclick = () => game.back();
function syncAudioBtns() {
  $('music').setAttribute('aria-pressed', BOAudio.musicOn ? 'true' : 'false');
  $('sound').setAttribute('aria-pressed', BOAudio.soundOn ? 'true' : 'false');
}
$('music').onclick = () => { BOAudio.music(!BOAudio.musicOn); syncAudioBtns(); };
$('sound').onclick = () => { BOAudio.sound(!BOAudio.soundOn); syncAudioBtns(); };
syncAudioBtns();
window.addEventListener('pointerdown', () => BOAudio.unlock(), { once: true, capture: true });
document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { $(b.dataset.open).hidden = false; }; });
document.querySelectorAll('.sheet').forEach((sh) => { sh.addEventListener('click', (e) => { if (e.target === sh || e.target.closest('[data-close]')) sh.hidden = true; }); });

// ---------------------------------------------------------------- start
let readySent = false;
const t0 = Date.now();
function maybeReady() {
  if (readySent) return;
  if (S.gotSnapshot || Date.now() - t0 > 4000) { readySent = true; game.ready(); window.__boReady = true; }
}
game = NXTable.start({ event: EVENT, game: 'bingoorbit', onChange: () => schedule(), onSignal });
S = game.S;
game.theme(scene.topColor);
game.limitsLoaded.then((l) => {
  if (l && l.min > 0) LIM = { min: Number(l.min), max: Number(l.max) || 0 };
  panels.forEach((p) => { p.price = clampPrice(p.price || LIM.min); });
  $('rulesLimit').textContent = money(LIM.min) + (LIM.max ? ' – ' + money(LIM.max) : '');
  render();
});
buildPanels();
layout();
render();
document.fonts && document.fonts.ready.then(() => { relayout(); });
// QA only (?qa=1, headless on a software GPU where a screenshot can take seconds): hold the picture
// still while it is taken, then replay what arrived meanwhile.
function hold(on) {
  if (!QA) return;
  held = !!on; scene.freeze(held);
  if (!held) { heldQ.splice(0).forEach((f) => f()); if (heldDirty) { heldDirty = false; render(); } }
}
window.__bo = { S, slots, panels, scene, hold, get sent() { return sent; }, get landed() { return landed; } }; // QA hooks
