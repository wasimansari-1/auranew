/* Tiger Chase 3D — the whole round as pure functions of the round time τ (seconds).
 *   τ < 0   betting (-6 = betting opens): the stalk. The tiger lies flat in the tall grass, the stag grazes
 *           and looks up in the last seconds; the tiger bursts out at T_T, the stag bolts at T_S, so that
 *           both are at full gallop at τ = 0 (1.00x).
 *   τ > 0   multiplier = e^(0.06 τ) (the engine's curve). The chase runs along +X at V m/s, the tiger always
 *           close behind: the gap breathes between ~3.8 and ~5.6 m (centre to centre — the tiger's nose never
 *           closer than ~1.7 m to the stag's rump) but it never catches before the crash. The place follows the
 *           distance run: the golden meadow → the sal forest → the river crossing → the rocky ridge (which repeats
 *           seamlessly every P metres, for long rounds). The light follows τ: morning → golden hour (never dark).
 *   τc      the crash IS the catch (the client only learns τc when it happens, so the catch is planned from
 *           wherever the two are at τc): a burst of speed closes the gap, the tiger pounces (take-off at
 *           τc+uP), lands on the stag's haunches at τc+uI (uI ≈ 0.8–1.0 s), a big dust-and-grass burst hides the
 *           moment, both slide to a stop, the stag lies down in the grass, the tiger stands beside it and roars.
 *           Everything has finished by τc + uI + END_HOLD (≈ 3 s). No blood, no wounds — nothing shown.
 * Nothing here keeps state between frames (the catch plan is a cache keyed by τc): a player who joins at any
 * moment computes exactly the same picture. No three.js in this file (the Node motion check imports it too).
 *
 * World axes: +X the way of the chase, +Y up, +Z towards the camera's side; metres.
 * Animals: body frame u (forward), y (up); every joint angle is a rotation in the body's sagittal plane
 * (about +Z of the body, counter-clockwise seen from the camera's side), plus a few yaw/roll extras. */

export const D2R = Math.PI / 180;
export const GROWTH = 0.06;
export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function S5(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
export function lerp(a, b, k) { return a + (b - a) * k; }
function I5(u) { return u <= 0 ? 0 : u >= 1 ? u - 0.5 : u * u * u * u * (u * u - 3 * u + 2.5); }   // ∫0..u S5
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function multAt(t) { return t <= 0 ? 1 : Math.exp(GROWTH * t); }

// ------------------------------------------------------------------ the chase
export const V = 13.0;                 // m/s at full gallop
export const T_T = -1.5, R_T = 1.5;    // the tiger bursts out (start, ramp to full speed)
export const T_S = -1.0, R_S = 1.0;    // the stag bolts
export const GAP0 = 8.45;              // the stag grazes this far ahead (centre to centre); 3.8–5.6 m in the chase
// the catch: the tiger's centre lands DHIT behind the stag's; both then slide to a stop (time constants TS_*)
export const CATCH = { DHIT: 1.25, TS_T: 0.2, TS_S: 0.24, LIFT: 0.32, HOLD: 2.1 };

// the places along X (m)
export const PL = { forest0: 92, forest1: 202, river: 221, riverHalf: 7.5, water: -0.17, ridge0: 240, XR: 280, P: 120 };
const W1 = 2 * Math.PI / PL.P;
export function wrapX(x) { return x > PL.XR + PL.P ? PL.XR + ((x - PL.XR) % PL.P) : x; }

// ------------------------------------------------------------------ the ground
export function riverDist(x, z) { return Math.abs(x - PL.river - 3.0 * Math.sin(z / 19)); }
export function baseGround(x, z) {
  x = wrapX(x);
  const kr = S5(236, 276, x);
  const m = 0.42 * Math.sin(x / 23 + 0.5) * Math.sin(z / 31 + 1.2) + 0.2 * Math.sin(x / 9.5 + 2.0) * Math.cos(z / 13 + 0.3) + 0.06 * Math.sin(x / 4.1 + z / 5.3);
  const r = 4.6 + 0.9 * Math.sin(W1 * x + 1.0) * Math.cos(z / 27) + 0.42 * Math.sin(2 * W1 * x + z / 11 + 0.7) + 0.12 * Math.sin(5 * W1 * x - z / 6) + 0.05 * Math.sin(9 * W1 * x + z / 3.1);
  let h = m + (r - m) * kr;
  // the river: a flat valley floor and a shallow channel
  const dr = riverDist(x, z);
  const flat = 1 - S5(10, 27, dr);
  h = h * (1 - flat) - 0.05 * flat - 0.42 * (1 - S5(PL.riverHalf - 3, PL.riverHalf + 3, dr));
  // hills on the far side, a gentle rise behind the camera
  const far = -z;
  h += S5(38, 170, far) * (5 + 2.5 * Math.sin(W1 * x + 2) + 1.2 * Math.sin(2 * W1 * x + 0.3)) * (1 - 0.7 * flat)
    + S5(150, 420, far) * (7 + 3 * Math.sin(W1 * x * 0.5 + 1));
  h += S5(26, 80, z) * 3.5;
  return h;
}
export const groundAt = baseGround;

// the line both animals run along
export function pathZ(x) { return S5(4, 34, x) * (1.7 * Math.sin(W1 * x + 0.4) + 0.6 * Math.sin(3 * W1 * x + 2.0)); }

// ------------------------------------------------------------------ the bodies and their gaits
// The models move with their own clips (models.js); here only what the clips cannot know: where each body is,
// its heading and pitch on the ground, the gait phase (the clips step in time with the prints) and the prints.
// hStand/hRun/hLow: mid-spine heights; front/rear: nose and rump from the centre; lat: paw/hoof side offsets.
export const RIG = {
  tiger: { name: 'tiger', front: 1.42, rear: -0.95, lat: [0.14, 0.125] },
  stag: { name: 'stag', front: 1.02, rear: -0.6, lat: [0.085, 0.09] },
};
// gaits: legs 0 FL, 1 FR, 2 HL, 3 HR. td: touch-down phase; d: duty; L: stride (m) at full speed, shorter (L·(1−k)) at the start
function gait(o) {
  o.k = 1 - o.L0 / o.L;
  o.st = o.td.map((td) => { let s = (td - (1 - o.d)) % 1; if (s < 0) s += 1; while (s < o.P0) s += 1; return s; }); // each leg's first lift, in gait order
  return o;
}
const TG = gait({ L: 4.6, L0: 1.9, s0: 4, d: 0.22, P0: 0.5, td: [0.6, 0.5, 0.0, 0.09], offF: 0.6, offH: -0.58, biasF: 0.1, biasH: 0.14 });
const SG = gait({ L: 4.2, L0: 1.6, s0: 3, d: 0.2, P0: 0.5, td: [0.56, 0.48, 0.0, 0.06], offF: 0.4, offH: -0.4, biasF: 0.05, biasH: 0.1 });
export const GAITS = { tiger: TG, stag: SG };

function phiD(G, s) { // gait phase after s metres (strides lengthen from L0 to L)
  if (s <= 0) return G.P0;
  const e = Math.exp(-s / G.s0);
  return G.P0 + (s + G.s0 * Math.log((1 - G.k * e) / (1 - G.k))) / G.L;
}
function phiDinv(G, p) {
  if (p <= G.P0) return 0;
  let s = (p - G.P0) * G.L * 0.6 + 0.3;
  for (let i = 0; i < 9; i++) { const e = Math.exp(-s / G.s0); s = Math.max(0, s - (phiD(G, s) - p) * G.L * (1 - G.k * e)); }
  return s;
}
function strideD(G, s) { return G.L * (1 - G.k * Math.exp(-Math.max(0, s) / G.s0)); }

// ------------------------------------------------------------------ the chase and the catch (the plan is a cache keyed by τc)
// the gap breathes (the tiger surges to ~3.8 m and drops back to ~5.6 m) but never closes before the crash
function osc(t) { const k = S5(1, 4.5, t); return k * (-0.5 + 0.62 * Math.sin((t - 1) * 2 * Math.PI / 7.3) + 0.3 * Math.sin(t * 2 * Math.PI / 3.1 + 1)); }
function stagRun(t) { return V * R_S * I5((t - T_S) / R_S) + osc(t); }      // metres run by the stag (the chase)
function stagTimeAt(s) { // inverse of stagRun (monotonic)
  let a = T_S, b = Math.max(1, s / V + 2);
  if (s <= 0) return T_S;
  for (let i = 0; i < 40; i++) { const m = 0.5 * (a + b); if (stagRun(m) < s) a = m; else b = m; }
  return 0.5 * (a + b);
}
function tigerRun0(t) { return V * R_T * I5((t - T_T) / R_T); }
function tigerTime0(x) {
  if (x >= V * R_T / 2) return T_T + R_T / 2 + x / V;
  if (x <= 0) return T_T;
  let a = T_T, b = T_T + R_T;
  for (let i = 0; i < 40; i++) { const m = 0.5 * (a + b); if (tigerRun0(m) < x) a = m; else b = m; }
  return 0.5 * (a + b);
}
export function chaseGap(t) { return GAP0 + stagRun(t) - tigerRun0(t); }   // centre to centre, as long as there is no catch
// EP: u* are seconds after τc. uP: the take-off of the pounce, uI: the landing (the catch), uEnd: all still.
const EP = { on: 0, tc: NaN, uP: 0.5, uI: 1, uEnd: 3, D: 0, xTI: 0, xSI: 0, vSI: V, tEnd: 3 };
function planEnd(tc) {
  const g0 = chaseGap(tc);
  const uI = clamp(0.8 + 0.06 * (g0 - 3.8), 0.8, 0.95);   // a longer gap: a slightly longer burst
  EP.uI = uI; EP.uP = uI - 0.42;
  EP.D = chaseGap(tc + uI) - CATCH.DHIT;                 // what the burst + pounce must make up on the stag
  EP.xTI = tigerRun0(tc + uI) + EP.D; EP.xSI = GAP0 + stagRun(tc + uI);
  EP.vSI = (stagRun(tc + uI + 1e-3) - stagRun(tc + uI - 1e-3)) / 2e-3;
  EP.uEnd = uI + CATCH.HOLD; EP.tEnd = EP.uEnd;
  EP.tc = tc;
}
// call before anything else in a frame (also the Node check): which ending (if any) the functions below describe
export function setRound(tau, tc) {
  if (tc == null) { EP.on = 0; return; }
  if (EP.tc !== tc) planEnd(tc);
  EP.on = 1;
}
export function endPlan() { return EP; }
export function endLength(tc) { if (EP.tc !== tc) { const on = EP.on; planEnd(tc); EP.on = on; } return EP.tEnd; }
function catchU(t) { return EP.on && t > EP.tc ? t - EP.tc : -1; }

// ------------------------------------------------------------------ where the two bodies are
export function tigerX(t) {
  const u = catchU(t);
  if (u < 0) return tigerRun0(t);
  if (u < EP.uI) return tigerRun0(t) + EP.D * S5(0, EP.uI, u);          // the burst (the extra speed peaks mid-pounce)
  return EP.xTI + V * CATCH.TS_T * (1 - Math.exp(-(u - EP.uI) / CATCH.TS_T));
}
export function stagX(t) {
  const u = catchU(t);
  if (u < EP.uI) return GAP0 + stagRun(t);
  return EP.xSI + EP.vSI * CATCH.TS_S * (1 - Math.exp(-(u - EP.uI) / CATCH.TS_S)); // knocked down: the slide
}
// lateral places in the catch: the tiger ends beside the stag (on the far side, so both stay in sight)
export function tigerZ(x, t) { const u = catchU(t); return pathZ(x) - (u < 0 ? 0 : 0.72 * S5(EP.uI - 0.1, EP.uI + 0.6, u)); }
export function stagZ(x, t) { const u = catchU(t); return pathZ(x) + (u < 0 ? 0 : 0.22 * S5(EP.uI, EP.uI + 0.5, u)); }
function tigerTimeAtX(x) { // when the tiger's centre passed x (the burst included)
  if (!EP.on || x <= tigerRun0(EP.tc)) return tigerTime0(x);
  let a = EP.tc, b = EP.tc + EP.uI;
  for (let i = 0; i < 30; i++) { const m = 0.5 * (a + b); if (tigerX(m) < x) a = m; else b = m; }
  return 0.5 * (a + b);
}

// ------------------------------------------------------------------ the prints
const PRINT = { x: 0, z: 0 };
function footfall(A, i, k, out) { // the k-th print of leg i (body x along the path at that phase → the paw / hoof)
  const G = A.G, R = A.R, front = i < 2, lat = (i & 1 ? 1 : -1) * R.lat[front ? 0 : 1];
  const pt = k + G.st[i] + (1 - G.d), s = phiDinv(G, pt), Ls = strideD(G, s), xb = A.x0 + s;
  out.x = xb + (front ? G.offF : G.offH) + 0.5 * G.d * Ls + (front ? G.biasF : G.biasH) * Math.min(1, Ls / G.L);
  out.z = pathZ(xb) + lat;
  return xb;
}
const AN = { tiger: { R: RIG.tiger, G: TG, x0: 0 }, stag: { R: RIG.stag, G: SG, x0: GAP0 } };

// ------------------------------------------------------------------ poses
export function newPose() { return { x: 0, z: 0, gy: 0, psi: 0, pitch: 0, lift: 0, phase: 0, speed: 0, go: 0, alert: 0, u: -1 }; }
function dPath(x) { return (pathZ(x + 0.25) - pathZ(x - 0.25)) / 0.5; }
function onGround(P, x, z, psi, half) { // the body on the ground: its height and its pitch along the slope
  const cs = Math.cos(psi), sn = Math.sin(psi);
  const gF = baseGround(x + half * cs, z + half * sn), gH = baseGround(x - half * cs, z - half * sn);
  P.x = x; P.z = z; P.psi = psi; P.gy = 0.5 * (gF + gH); P.pitch = 0.8 * Math.atan2(gF - gH, 2 * half);
}
function bump(a, b, u) { const k = clamp((u - a) / (b - a), 0, 1); return Math.sin(Math.PI * k); }

// the tiger at τ. P.u: seconds since the crash (−1: no catch); P.lift: extra height in the pounce
export function tigerAt(t, w, P) {
  const x = tigerX(t), e = 1e-3, u = catchU(t);
  onGround(P, x, tigerZ(x, t), Math.atan(dPath(x)) + (u < 0 ? 0 : 0.5 * S5(EP.uI + 0.3, EP.uI + 1.0, u)), 0.6);
  P.speed = (tigerX(t + e) - tigerX(t - e)) / (2 * e);
  P.phase = phiD(TG, x);
  P.go = S5(T_T - 0.02, T_T + 0.5, t);                    // up out of the crouch
  P.u = u;
  P.lift = u < 0 ? 0 : CATCH.LIFT * bump(EP.uP - 0.05, EP.uI + 0.2, u);
  return P;
}
// the stag at τ
export function stagAt(t, w, P) {
  const x = stagX(t), e = 1e-3, u = catchU(t);
  onGround(P, x, stagZ(x, t), Math.atan(dPath(x)) + (u < EP.uI ? 0 : 0.4 * S5(EP.uI - 0.05, EP.uI + 0.5, u)), 0.45);
  P.speed = (stagX(t + e) - stagX(t - e)) / (2 * e);
  P.phase = phiD(SG, Math.min(x, EP.on ? EP.xSI : x) - GAP0);
  P.go = S5(T_S - 0.05, T_S + 0.4, t);
  P.alert = S5(-2.6, -2.0, t);                             // grazing → head up, alert
  P.u = u;
  P.lift = 0;
  return P;
}
// the clips' schedule in the catch (u: seconds after τc) — shared by the renderer and the checks
export function catchClips(u) {
  const uP = EP.uP, uI = EP.uI;
  return {
    run: 1 - S5(uP - 0.2, uP - 0.06, u),
    jumpStart: S5(uP - 0.2, uP - 0.06, u) * (1 - S5(uI - 0.1, uI, u)),
    jumpStartT: u < uP ? 0.32 + (u - (uP - 0.2)) * 1.4 : 0.6 + (u - uP) * 1.3,     // take-off at 0.6 s of the clip
    land: S5(uI - 0.1, uI, u) * (1 - S5(uI + 0.25, uI + 0.42, u)),
    landT: clamp(0.05 + (u - (uI - 0.1)) * 1.1, 0, 0.42),
    stand: S5(uI + 0.25, uI + 0.42, u) * (1 - S5(uI + 0.38, uI + 0.52, u)) + S5(uI + 1.75, uI + 2.05, u),
    roar: S5(uI + 0.38, uI + 0.52, u) * (1 - S5(uI + 1.18, uI + 1.25, u)),
    roarT: Math.max(0, u - (uI + 0.4)),
    roarEnd: S5(uI + 1.18, uI + 1.25, u) * (1 - S5(uI + 1.75, uI + 2.05, u)),
    roarEndT: clamp(u - (uI + 1.2), 0, 0.82),
    // the stag: the run, then knocked down (the fall clip from its stumble on, held lying)
    fall: S5(uI - 0.1, uI + 0.02, u),
    fallT: clamp(0.88 + (u - (uI - 0.1)) * 1.6, 0.88, 1.82),
  };
}

// ------------------------------------------------------------------ dust, splashes, the catch's burst
// out: Float32Array of N × 6: x, y, z, age (s), kind (0 dust, 1 water, 2 the big cloud, 3 grass bits), size/seed. Returns the count.
function put(out, n, x, y, z, age, kind, size) { const o = n * 6; out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = age; out[o + 4] = kind; out[o + 5] = size; return n + 1; }
export function puffsAt(t, out, max) {
  let n = 0;
  const u = catchU(t);
  for (let a = 0; a < 2; a++) {
    const A = a ? AN.stag : AN.tiger, G = A.G;
    // prints count until the tiger leaves the ground / the stag is knocked down
    const xEnd = EP.on ? (a ? EP.xSI : tigerX(EP.tc + EP.uP)) : Infinity;
    const xNow = Math.min(a ? stagX(t) : tigerX(t), xEnd);
    const PHI = phiD(G, xNow - A.x0);
    for (let i = 0; i < 4; i++) {
      const q = PHI - G.st[i]; if (q < 0) continue;
      const kNow = Math.floor(q), uu = q - kNow, landed = uu >= 1 - G.d ? kNow : kNow - 1;
      for (let k = landed; k > landed - 3 && k >= 0; k--) {
        const xb = footfall(A, i, k, PRINT);
        const ttd = a ? stagTimeAt(xb - GAP0) : tigerTimeAtX(xb), age = t - ttd;
        if (age < 0 || age > 1.3 || n >= max) continue;
        const gy = groundAt(PRINT.x, PRINT.z), wet = gy < PL.water - 0.02 ? 1 : 0;
        n = put(out, n, PRINT.x, wet ? PL.water : gy, PRINT.z, age, wet, (a ? 0.75 : 1) * (0.7 + 0.6 * hash1(k * 4 + i + a * 17)));
      }
    }
  }
  if (u > EP.uI - 0.05) { // the catch: a big cloud of dust and grass where they come down, then the slide
    const ui = u - EP.uI, xc = EP.xSI - 0.35, zc = pathZ(xc), gy = groundAt(xc, zc), wet = gy < PL.water - 0.02;
    for (let i = 0; i < 8 && n < max; i++) {
      const ang = i * 2.39996, r = 0.25 + 0.6 * hash1(i * 3.1), dl = 0.025 * i;
      if (ui - dl < 0) continue;
      n = put(out, n, xc + Math.cos(ang) * r + 0.05 * i, gy, zc - 0.5 + Math.sin(ang) * r * 0.6, ui - dl, wet ? 1 : 2, 1.2 + 0.8 * hash1(i * 7.7) + (wet ? 1 : 0));
    }
    for (let i = 0; i < 14 && n < max && ui >= 0; i++) n = put(out, n, xc + 0.3 * (hash1(i) - 0.5), gy + 0.3, zc, ui, 3, i + 0.5);
    for (let i = 1; i <= 5 && n < max; i++) { // the slide's trail
      const s = i / 5, sx = EP.xSI + EP.vSI * CATCH.TS_S * s * 0.95, age = ui + CATCH.TS_S * Math.log(1 - s * 0.95);
      if (age < 0) continue;
      const sz = pathZ(sx);
      n = put(out, n, sx, groundAt(sx, sz), sz + 0.1, age, 0, 1.0 + 0.3 * s);
    }
  }
  return n;
}

// ------------------------------------------------------------------ the camera
// A tracking camera beside and a little behind the pair, low and close (the tiger's nose and the stag's rump
// both in the picture). Its aim sits between the two animals; its distance is fitted so the pair spans a set
// share of the play area's width. It sways gently with the gallop. In the catch it pushes in with the burst,
// gives a short knock at the landing, then swings round in front of the pair, low: the hero shot of the roar.
let TAN_H = Math.tan(23.5 * D2R), FILL = 0.76, PORTRAIT = true;
export function setView(tanH, portrait) { TAN_H = tanH; PORTRAIT = portrait; FILL = portrait ? 0.86 : 0.56; }
const L_SAT = 9;
export function cameraAt(t, tc, w, C) {
  const tx = tigerX(t), tz = tigerZ(tx, t), sx = stagX(t), sz = stagZ(sx, t);
  const dx = sx - tx, dz = sz - tz, dist = Math.max(0.5, Math.hypot(dx, dz)), ux = dx / dist, uz = dz / dist;
  const l = L_SAT * Math.tanh(dist / (2 * L_SAT));
  let fx = tx + ux * l, fz = tz + uz * l;
  const u = tc == null ? -1 : t - tc, uI = EP.uI;
  const push = u < 0 ? 0 : S5(0, uI, u);                                   // the burst: closer, lower
  const end = u < 0 ? 0 : S5(uI - 0.2, uI + 1.5, u);                       // round to the front, low
  const chase = S5(T_T - 0.2, 1.3, t);
  const idle = 1 - S5(-2.5, -1.2, t);
  const run = chase * (1 - end);
  let al = lerp(lerp(52, 30, chase), PORTRAIT ? -10 : -8, end) * D2R + 0.012 * Math.sin(w * 0.23) * idle + 0.035 * Math.sin(t * 0.31) * run;
  if (!PORTRAIT) al -= 6 * D2R * run;
  const rx = Math.cos(al), rz = Math.sin(al);              // the picture's right
  const vx = Math.sin(al), vz = -Math.cos(al);             // the view direction (level)
  const span = 2 * l + 2.9, proj = Math.abs(span * (ux * rx + uz * rz));
  const dFit = Math.max(6.2, proj / (2 * FILL * TAN_H)) * (1 + 0.012 * Math.sin(w * 0.17) * idle) * (1 - 0.14 * push);
  const dEnd = Math.max(4.2, 3.6 / (2 * FILL * TAN_H));                     // the two fill the width
  const d = lerp(dFit, dEnd, end);
  const h = lerp(lerp(1.05, 1.4, chase) - 0.25 * push, 1.2, end);
  // the aim: between the two; in the end between the tiger's head and the stag
  const ex = 0.5 * (tx + sx), ez = 0.5 * (tz + sz);
  fx = lerp(fx, ex, end); fz = lerp(fz, ez, end);
  C.x = fx - vx * d; C.z = fz - vz * d;
  const gF = baseGround(fx, fz);
  C.y = Math.max(baseGround(C.x, C.z), gF - 0.4) + h;
  C.ax = fx; C.az = fz; C.ay = gF + lerp(0.62, 0.72, chase) - 0.12 * end;
  // the gallop's sway, the landing's knock (deterministic)
  const sway = 0.035 * run * (1 - push);
  C.y += sway * Math.sin(t * 2 * Math.PI * 2.83); C.ay += sway * 0.6 * Math.sin(t * 2 * Math.PI * 2.83 - 0.6);
  if (u > uI) { const k = Math.exp(-(u - uI) / 0.16) * 0.09; C.y += k * Math.sin((u - uI) * 52); C.ay += k * 0.7 * Math.sin((u - uI) * 47 + 1); }
  C.fx = fx; C.fz = fz; C.d = d; C.al = al;
  C.tx = tx; C.tz = tz; C.sx = sx; C.sz = sz;
  return C;
}

// ------------------------------------------------------------------ the light: bright morning → warm golden hour (never dark)
const MORNING = { el: 34, az: 30, zen: [0.20, 0.44, 0.86], hor: [0.76, 0.86, 0.94], glow: [1.0, 0.9, 0.7], ground: [0.42, 0.44, 0.30], fogSun: [1.0, 0.94, 0.8], sun: [1.0, 0.95, 0.86], sunI: 3.6, hs: [0.66, 0.8, 1.0], hg: [0.44, 0.42, 0.28], exp: 0.7, haze: 0.62, warm: 0 };
const GOLDEN = { el: 14, az: -30, zen: [0.26, 0.42, 0.76], hor: [1.0, 0.8, 0.56], glow: [1.0, 0.68, 0.34], ground: [0.46, 0.38, 0.26], fogSun: [1.0, 0.78, 0.5], sun: [1.0, 0.78, 0.5], sunI: 3.9, hs: [0.78, 0.8, 0.94], hg: [0.5, 0.4, 0.26], exp: 0.72, haze: 0.9, warm: 1 };
const SKY_KEYS = [
  { t: -99, ...MORNING }, { t: 6, ...MORNING },
  { t: 18, el: 23, az: 2, zen: [0.22, 0.43, 0.82], hor: [0.9, 0.86, 0.76], glow: [1.0, 0.8, 0.5], ground: [0.44, 0.41, 0.28], fogSun: [1.0, 0.86, 0.64], sun: [1.0, 0.88, 0.68], sunI: 3.75, hs: [0.72, 0.8, 0.98], hg: [0.47, 0.41, 0.27], exp: 0.71, haze: 0.75, warm: 0.5 },
  { t: 32, ...GOLDEN }, { t: 1e9, ...GOLDEN },
];
const SKY_FIELDS = ['el', 'az', 'zen', 'hor', 'glow', 'ground', 'fogSun', 'sun', 'sunI', 'hs', 'hg', 'exp', 'haze', 'warm'];
export function skyAt(t, out) {
  out = out || {};
  let i = 0; while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].t <= t) i++;
  const A = SKY_KEYS[i], Bk = SKY_KEYS[i + 1], k = S5(A.t, Bk.t, t);
  for (let q = 0; q < SKY_FIELDS.length; q++) {
    const f = SKY_FIELDS[q], a = A[f], b = Bk[f];
    if (Array.isArray(a)) { const o = out[f] || (out[f] = [0, 0, 0]); o[0] = lerp(a[0], b[0], k); o[1] = lerp(a[1], b[1], k); o[2] = lerp(a[2], b[2], k); }
    else out[f] = lerp(a, b, k);
  }
  return out;
}
