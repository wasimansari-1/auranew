/* Vimaan 3D — the whole round as pure functions of the round time τ (seconds).
 *   τ = 0   the round starts (1.00x): the wheels leave the runway (lift-off)
 *   τ < 0   betting (-6 = betting opens): the jet waits at the threshold, the take-off roll
 *           starts at ROLL0 (-3.4 s, the end of betting is known, so it is deterministic)
 *   τ > 0   multiplier = e^(0.06 τ) (the engine's curve)
 * Nothing here keeps state between frames: a player who joins at any moment computes exactly the
 * same picture. No three.js in this file (the Node motion check imports it too).
 *
 * World axes: +X = runway heading (east), +Y up, +Z = right of the runway. Metres.
 * Jet axes:   +X nose, +Y up, +Z right wing. */

export const GROWTH = 0.06;           // multiplier = e^(GROWTH τ)
export const TL = 0;                  // lift-off (main wheels leave the runway) = 1.00x
export const ROLL0 = -3.4;            // the take-off roll starts (last seconds of betting)
export const START_X = 96;            // main-gear axle at the line-up point (threshold markings behind)
export const WHEEL_R = 0.38, NOSE_WHEEL_R = 0.27;
export const AXLE = [-1.8, -1.97, 0]; // main-gear axle in jet coordinates (wheel contact = 0.38 below)
export const GEAR = { doorsOpen: [1.15, 1.75], fold: [1.55, 3.55], doorsClose: [3.55, 4.15] };
export const DECK = 390;              // cloud-deck altitude (m)

const D2R = Math.PI / 180;
export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function S5(a, b, x) { // smootherstep: C2, zero velocity and acceleration at both ends
  x = clamp((x - a) / (b - a), 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}
export function lerp(a, b, k) { return a + (b - a) * k; }

// ------------------------------------------------------------------ the flight path (integrated once)
const STEP = 1 / 240, KEEP = 2, TMAX = 260; // stored every 1/120 s up to 260 s (the multiplier is then 6 million)
const N = Math.ceil((TMAX - ROLL0) / (STEP * KEEP)) + 2;
const PX = new Float64Array(N), PY = new Float64Array(N), PZ = new Float64Array(N);
const PV = new Float64Array(N), PG = new Float64Array(N), PS = new Float64Array(N), PD = new Float64Array(N);

function accel(t) { // along the path (m/s²)
  const roll = 23 * S5(ROLL0, ROLL0 + 0.6, t) * (1 - S5(TL - 0.6, TL + 1.6, t));
  const climb = (6.2 * Math.exp(-Math.max(0, t - TL) / 9) + 0.55 * Math.exp(-Math.max(0, t - TL) / 60)) * S5(TL - 0.6, TL + 1.6, t);
  return t <= ROLL0 ? 0 : roll + climb;
}
export function gammaAt(t) { // flight-path angle (rad): steep climb-out, flattening above the clouds
  return D2R * (12.5 * S5(TL, TL + 3.6, t) - 5.5 * S5(15, 23, t) - 3.5 * S5(28, 58, t));
}
export function headingAt(t) { // rad, + = towards +Z (right). A left turn over the bay, then a slow weave
  return D2R * (-12 * S5(2.5, 12.5, t)) + 0.11 * Math.sin((t - 24) * 2 * Math.PI / 46) * S5(22, 32, t);
}
function headingRate(t) { const e = 1e-3; return (headingAt(t + e) - headingAt(t - e)) / (2 * e); }

(function integrate() {
  let x = START_X, y = WHEEL_R, z = 0, v = 0, d = 0, t = ROLL0, i = 0, k = 0;
  for (;;) {
    if (k % KEEP === 0) { PX[i] = x; PY[i] = y; PZ[i] = z; PV[i] = v; PG[i] = gammaAt(t); PS[i] = headingAt(t); PD[i] = d; i++; if (i >= N) break; }
    // midpoint (RK2) step
    const a1 = accel(t), vm = v + a1 * STEP / 2, tm = t + STEP / 2;
    const g = gammaAt(tm), s = headingAt(tm), c = Math.cos(g);
    x += vm * c * Math.cos(s) * STEP; z += vm * c * Math.sin(s) * STEP; y += vm * Math.sin(g) * STEP; d += vm * STEP;
    v += accel(tm) * STEP; t += STEP; k++;
  }
})();

function herm(u, h, p0, p1, m0, m1) { const u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1; }
// path sample at τ (τ ≤ 0: at the line-up point; beyond the table: straight on)
function sample(t, out) {
  if (t <= ROLL0) { out.x = START_X; out.y = WHEEL_R; out.z = 0; out.v = 0; out.g = 0; out.psi = 0; out.d = 0; return out; }
  const f = (t - ROLL0) / (STEP * KEEP);
  let i = Math.floor(f);
  if (i >= N - 2) { // extrapolate (never in practice)
    i = N - 2; const dt = t - ROLL0 - i * STEP * KEEP, v = PV[i], g = PG[i], s = PS[i];
    out.x = PX[i] + v * Math.cos(g) * Math.cos(s) * dt; out.z = PZ[i] + v * Math.cos(g) * Math.sin(s) * dt; out.y = PY[i] + v * Math.sin(g) * dt;
    out.v = v; out.g = g; out.psi = s; out.d = PD[i] + v * dt; return out;
  }
  const u = f - i, h = STEP * KEEP;
  // cubic Hermite on position with the path velocity as tangents: C1 between samples
  const v0 = PV[i], v1 = PV[i + 1], g0 = PG[i], g1 = PG[i + 1], s0 = PS[i], s1 = PS[i + 1];
  out.x = herm(u, h, PX[i], PX[i + 1], v0 * Math.cos(g0) * Math.cos(s0), v1 * Math.cos(g1) * Math.cos(s1));
  out.z = herm(u, h, PZ[i], PZ[i + 1], v0 * Math.cos(g0) * Math.sin(s0), v1 * Math.cos(g1) * Math.sin(s1));
  out.y = herm(u, h, PY[i], PY[i + 1], v0 * Math.sin(g0), v1 * Math.sin(g1));
  out.d = herm(u, h, PD[i], PD[i + 1], v0, v1);
  out.v = lerp(v0, v1, u); out.g = gammaAt(t); out.psi = headingAt(t);
  return out;
}

// ------------------------------------------------------------------ the jet at τ
// Returns the main-gear axle position, the attitude (yaw ψ, pitch θ, roll φ), gear state, wheel spin.
const tmp = { x: 0, y: 0, z: 0, v: 0, g: 0, psi: 0, d: 0 };
export function pitchAt(t, g) {
  const rot = 9.5 * D2R * S5(TL - 1.1, TL + 0.25, t);         // rotation on the runway (about the main wheels)
  const k = S5(TL + 0.4, TL + 4.2, t);
  return rot * (1 - k) + (g + 3.2 * D2R) * k;                   // then the flight path + angle of attack
}
export function gearFold(t) { return S5(GEAR.fold[0], GEAR.fold[1], t); } // 0 = down and locked, 1 = up
export function gearDoors(t) { return S5(GEAR.doorsOpen[0], GEAR.doorsOpen[1], t) * (1 - S5(GEAR.doorsClose[0], GEAR.doorsClose[1], t)); } // 0 closed, 1 open
function wheelSpin(t, d) { // wheel angle (rad): rolling on the runway, then braked to a stop after lift-off
  if (t <= TL) return d / WHEEL_R;
  sample(TL, tmp); const dl = tmp.d, vl = tmp.v;
  return dl / WHEEL_R + (vl / WHEEL_R) * 0.7 * (1 - Math.exp(-(t - TL) / 0.7));
}

// The flight normally; after a crash (the round ended at τc) the jet flies away: its own path
// played faster (a time warp — on the runway it rolls, lifts off and climbs sooner), plus extra
// thrust, a climbing left bank — while the camera stops and watches it go.
const FLY_WARP = 0.95, FLY_ACC = 34, FLY_CLIMB = 4.5, FLY_SIDE = 7, EASE = 0.6;
function ramp2(s) { return s * s * s / (s + EASE); }                 // ≈ s² later, but starts with zero acceleration (no lurch)
function ramp2d(s) { return (3 * s * s * (s + EASE) - s * s * s) / ((s + EASE) * (s + EASE)); }
function warp(tc, s) { return tc + s + FLY_WARP * ramp2(s); }
function liftAfter(tc) { // s after the crash at which the warped path lifts off (0 if already flying)
  if (tc >= TL) return 0;
  let a = 0, b = 10; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (warp(tc, m) < TL) a = m; else b = m; } return b;
}
// the camera (and a parachute in the air) glide to a stop after a crash: velocity eases out over GLIDE s
const GLIDE = 1.2;
export function glide(s) { const x = Math.min(1, s / GLIDE); return x < 1 ? s - GLIDE * (x * x * x - x * x * x * x / 2) : GLIDE / 2; }

export function jetAt(t, tc, out) {
  out = out || {};
  let tw = t, s = 0, fly = tc != null && t > tc;
  if (fly) { s = t - tc; tw = warp(tc, s); }
  sample(tw, tmp);
  let psi = tmp.psi, theta = pitchAt(tw, tmp.g);
  // coordinated turn: bank from the turn rate
  let phi = Math.atan(tmp.v * headingRate(tw) / 9.81);
  let x = tmp.x, y = tmp.y, z = tmp.z, v = tmp.v;
  if (fly) {
    const fx = Math.cos(psi), fz = Math.sin(psi);
    const sl = Math.max(0, s - liftAfter(tc));
    const fwd = FLY_ACC * ramp2(s), up = FLY_CLIMB * sl * sl * sl, side = -FLY_SIDE * sl * sl * sl;
    x += fx * fwd - fz * side; z += fz * fwd + fx * side; y += up;
    const fv = v * (1 + FLY_WARP * ramp2d(s)) + FLY_ACC * ramp2d(s);
    psi += Math.atan2(-3 * FLY_SIDE * sl * sl, Math.max(fv, 1));
    theta += Math.atan2(3 * FLY_CLIMB * sl * sl, Math.max(fv, 1)) * 0.8;
    phi += -38 * D2R * S5(0, 1.3, sl);
    v = fv;
  }
  out.x = x; out.y = y; out.z = z; out.v = v;
  out.psi = psi; out.theta = theta; out.phi = phi;
  out.alt = y - WHEEL_R;
  out.oleo = 0.09 * S5(TL - 0.25, TL + 0.45, tw);  // the main struts extend as the weight comes off
  out.fold = gearFold(tw); out.doors = gearDoors(tw);
  out.spin = wheelSpin(tw, tmp.d);
  out.noseSpin = out.spin * WHEEL_R / NOSE_WHEEL_R;
  out.airborne = tw > TL;
  return out;
}

// ------------------------------------------------------------------ the camera at τ
// Offsets from the jet in its heading frame: azimuth (° from straight behind, + = the right side),
// elevation (°), distance (m). Keyframes through a C1 spline; a slow weave above the clouds.
const CAM = {
  az:   [[-6.5, 128], [-5.2, 113], [-4.1, 88], [-3.4, 68], [-1.6, 42], [0, 27], [1.3, 15], [4.1, 13], [6.8, 18], [9.6, 21], [12.5, 18], [16, 16], [21, 22], [27, 30]],
  el:   [[-6.5, 8], [-5.2, 7.5], [-4.1, 7], [-3.4, 6], [-1.6, 3.2], [0, 0.5], [1.0, -8], [2.1, -19], [3.9, -19], [5.6, -8], [7.4, 0], [9.6, 5], [13, 6.5], [18, 8], [27, 8]],
  dist: [[-6.5, 31], [-5.2, 29.5], [-4.1, 28], [-3.4, 27], [-1.6, 26], [0, 24], [1.2, 22], [4.1, 21], [6.6, 25], [8.6, 28], [12, 31], [18, 33], [27, 33]],
  // portrait phones: camera distance × this (the jet spans ~75–85 % of the width, clear of the multiplier text)
  pz: [[-6.5, 1.05], [-3.4, 1.05], [-1.6, 1.0], [0, 1.18], [1.0, 1.46], [4.2, 1.46], [5.6, 1.28], [7.2, 1.07], [10, 1.0], [20, 0.97], [30, 0.94]],
  aimUp: [[-6.5, 1.2], [0, 1.2], [1.0, 0.1], [4.0, 0.1], [6.2, 1.2]],   // aim at the belly while the gear folds
  aimFwd: [[-6.5, 1.5], [0, 1.5], [1.0, 2.0], [4.0, 2.0], [6.2, 1.5]],
};
function tangent(keys, j) { // Catmull-Rom tangents (zero at the ends)
  if (j <= 0 || j >= keys.length - 1) return 0;
  return (keys[j + 1][1] - keys[j - 1][1]) / (keys[j + 1][0] - keys[j - 1][0]);
}
function spline(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (keys[i + 1][0] < t) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1];
  const h = t1 - t0, u = (t - t0) / h;
  return herm(u, h, p0, p1, tangent(keys, i), tangent(keys, i + 1));
}
export function camOffsetAt(t) {
  const w = S5(27, 36, t); // above the clouds: a slow swing from the right side, round behind, to the left (sun in view) and back
  const ph = (t - 36) * 2 * Math.PI / 64;
  const az = lerp(spline(CAM.az, t), 30 - 62 * (0.5 - 0.5 * Math.cos(ph)), w);
  const el = lerp(spline(CAM.el, t), 7 + 3 * Math.sin(ph * 1.7), w);
  const dist = lerp(spline(CAM.dist, t), 33 + 3 * Math.sin(ph * 0.8 + 1), w);
  let d = dist;
  if (PORTRAIT) { // phones: a distance per phase, and above the clouds one that follows how wide the jet looks from this side
    d = lerp(dist * spline(CAM.pz, t), planExtent(az * D2R) * PZ_K, S5(26, 34, t));
  }
  OFF.az = az * D2R; OFF.el = el * D2R; OFF.dist = d; OFF.up = spline(CAM.aimUp, t); OFF.fwd = spline(CAM.aimFwd, t);
  return OFF;
}
const OFF = { az: 0, el: 0, dist: 0, up: 1.2, fwd: 1.5 };
// framing: portrait phones get their own distances (set once per layout; a pure input like the aspect ratio)
let PORTRAIT = false;
// how wide the jet's plan (nose, tail, wing tips) looks across the view from azimuth a — a smooth max/min (no kinks)
const PLAN = [[10.5, 0], [-10.6, 0], [-3.6, 10.2], [-3.6, -10.2]];
function planExtent(a) {
  const rx = Math.sin(a), rz = Math.cos(a), k = 1.5;
  let sp = 0, sn = 0;
  for (let i = 0; i < PLAN.length; i++) { const d = PLAN[i][0] * rx + PLAN[i][1] * rz; sp += Math.exp(d / k); sn += Math.exp(-d / k); }
  return k * Math.log(sp) + k * Math.log(sn);
}
const PZ_K = 29.6 / planExtent(27 * D2R); // camera distance per metre of apparent width (≈ 80 % of a phone's width)
export function setPortrait(on) { PORTRAIT = !!on; }

// Camera + aim point (world). After a crash the camera glides to a stop (0.7 s) and watches the jet go.
const jA = {}, jB = {};
export function cameraAt(t, tc, out) {
  out = out || {};
  const tt = tc != null && t > tc ? tc : t;
  const s = tc != null && t > tc ? t - tc : 0;
  jetAt(tt, null, jA);
  const o = camOffsetAt(tt);
  const fx = Math.cos(jA.psi), fz = Math.sin(jA.psi), ce = Math.cos(o.el);
  // offset: behind (−forward), to the right (+right), up
  const bx = -fx * ce * Math.cos(o.az) + (-fz) * ce * Math.sin(o.az);
  const bz = -fz * ce * Math.cos(o.az) + fx * ce * Math.sin(o.az);
  let cx = jA.x + bx * o.dist, cy = jA.y + Math.sin(o.el) * o.dist + 0.6, cz = jA.z + bz * o.dist;
  let ax = jA.x + fx * o.fwd, ay = jA.y + o.up, az = jA.z + fz * o.fwd;
  if (s > 0) {
    // glide on with the velocity at the crash, easing to a stop
    const e = 1e-3; jetAt(tc - e, null, jB);
    const cB = camRaw(tc - e, CR1), cA = camRaw(tc, CR2);
    const g = glide(s);
    cx += (cA.x - cB.x) / e * g; cy += (cA.y - cB.y) / e * g; cz += (cA.z - cB.z) / e * g;
    // aim: along the flight path the jet was on (it pulls away along it, banking off to the left and up)
    jetAt(tc + glide(s) + 0.9 * ramp2(s), null, jB);
    ax = jB.x + Math.cos(jB.psi) * 1.5; ay = jB.y + 1.2 - (jB.y - jA.y) * 0.5 * S5(0, 1.2, s); az = jB.z + Math.sin(jB.psi) * 1.5;
  }
  // never below 1.3 m above the ground (soft, smooth floor)
  cy = softFloor(cy, 1.3, 1.2);
  out.x = cx; out.y = cy; out.z = cz; out.ax = ax; out.ay = ay; out.az = az;
  out.roll = 0.1 * jA.phi;
  return out;
}
const CR1 = { x: 0, y: 0, z: 0 }, CR2 = { x: 0, y: 0, z: 0 };
function camRaw(t, out) {
  jetAt(t, null, jB);
  const o = camOffsetAt(t), fx = Math.cos(jB.psi), fz = Math.sin(jB.psi), ce = Math.cos(o.el);
  out.x = jB.x + (-fx * ce * Math.cos(o.az) - fz * ce * Math.sin(o.az)) * o.dist;
  out.y = jB.y + Math.sin(o.el) * o.dist + 0.6;
  out.z = jB.z + (-fz * ce * Math.cos(o.az) + fx * ce * Math.sin(o.az)) * o.dist;
  return out;
}
function softFloor(y, floor, k) { // ≈ max(y, floor), smooth
  const d = (y - floor) / k;
  return floor + k * (d > 20 ? d : Math.log(1 + Math.exp(d)));
}

// ------------------------------------------------------------------ the parachute (my cash-out at τw)
// Relative to the flight (heading frame), drifting back and down; after a crash it hangs where it is.
export function chuteAt(t, tw, tc, out) {
  out = out || {};
  const s = t - tw;
  const ta = tc != null && t > tc ? tc : t;
  jetAt(ta, null, jA);
  if (tc != null && t > tc) { // after a crash the chute glides on with the camera (no jump)
    const e = 1e-3; jetAt(tc - e, null, jB); const g = glide(t - tc);
    jA.x += (jA.x - jB.x) / e * g; jA.y += (jA.y - jB.y) / e * g; jA.z += (jA.z - jB.z) / e * g;
  }
  const fx = Math.cos(jA.psi), fz = Math.sin(jA.psi);
  const back = 1.0 + 1.5 * s + 0.45 * s * s, down = 2.4 + 1.3 * s + 0.45 * s * s, side = -(0.6 + 0.9 * s); // drops away below, drifting back and out to the left
  out.x = jA.x - fx * back - fz * side; out.z = jA.z - fz * back + fx * side; out.y = jA.y - down;
  out.open = S5(0.05, 0.75, s);
  out.sway = Math.sin(s * 2.1) * 0.12;
  out.alpha = S5(0, 0.15, s) * (1 - S5(3.4, 4.2, s));
  out.psi = jA.psi;
  return out;
}

// ------------------------------------------------------------------ the sky by altitude band
// Keyframes over τ: sunset on the ground → through the golden clouds → above the clouds at sunset → a
// soft warm dusk. Always a bright, daylight sky (no night, no stars). Long rounds sway slowly between
// late golden light and the soft dusk, so the endless above-cloud flight never looks static.
// Colours are linear RGB (the renderer tone-maps).
export const SKY_KEYS = [
  // τ, sun elevation° / azimuth° (from the runway heading, − = left, over the bay), zenith, horizon, glow, fog towards the sun,
  // ground (below the horizon), sun colour + intensity, hemisphere sky / ground, dusk (0..1: window lights, lamps), cloud lit / shade, exposure
  { t: -99, el: 12, az: -38, zen: [0.07, 0.13, 0.36], hor: [0.95, 0.47, 0.24], glow: [1.0, 0.46, 0.16], fogSun: [1.0, 0.55, 0.26], ground: [0.35, 0.28, 0.26], sun: [1.0, 0.66, 0.4], sunI: 3.6, hs: [0.5, 0.48, 0.62], hg: [0.3, 0.22, 0.16], dusk: 0, lit: [1.18, 0.84, 0.56], shade: [0.52, 0.41, 0.48], exp: 1.0 },
  { t: 12, el: 11, az: -38, zen: [0.07, 0.13, 0.37], hor: [0.95, 0.49, 0.25], glow: [1.0, 0.47, 0.17], fogSun: [1.0, 0.56, 0.27], ground: [0.4, 0.32, 0.3], sun: [1.0, 0.67, 0.42], sunI: 3.6, hs: [0.5, 0.49, 0.64], hg: [0.34, 0.25, 0.2], dusk: 0, lit: [1.2, 0.86, 0.58], shade: [0.54, 0.43, 0.5], exp: 1.0 },
  { t: 24, el: 8, az: -38, zen: [0.06, 0.13, 0.42], hor: [0.98, 0.52, 0.27], glow: [1.05, 0.5, 0.18], fogSun: [1.0, 0.58, 0.3], ground: [0.95, 0.72, 0.55], sun: [1.0, 0.7, 0.45], sunI: 3.8, hs: [0.5, 0.52, 0.72], hg: [0.85, 0.62, 0.45], dusk: 0, lit: [1.3, 0.92, 0.62], shade: [0.6, 0.48, 0.56], exp: 0.95 },
  { t: 38, el: 3, az: -38, zen: [0.06, 0.1, 0.34], hor: [0.95, 0.42, 0.22], glow: [1.05, 0.38, 0.13], fogSun: [0.95, 0.45, 0.22], ground: [0.88, 0.55, 0.45], sun: [1.0, 0.54, 0.3], sunI: 3.1, hs: [0.44, 0.4, 0.64], hg: [0.72, 0.45, 0.36], dusk: 0.15, lit: [1.22, 0.72, 0.48], shade: [0.5, 0.36, 0.5], exp: 1.0 },
  { t: 52, el: -0.5, az: -38, zen: [0.07, 0.08, 0.27], hor: [0.86, 0.4, 0.32], glow: [0.95, 0.35, 0.2], fogSun: [0.86, 0.42, 0.3], ground: [0.62, 0.4, 0.44], sun: [0.92, 0.5, 0.4], sunI: 1.9, hs: [0.38, 0.33, 0.58], hg: [0.5, 0.33, 0.37], dusk: 0.5, lit: [1.0, 0.62, 0.54], shade: [0.4, 0.3, 0.46], exp: 1.08 },
];
const SKY_FIELDS = Object.keys(SKY_KEYS[0]).filter((k) => k !== 't');
const SWAY_FROM = 52, SWAY_PERIOD = 96; // long rounds: dusk → late golden → dusk …, seamless
export function skyAt(t, out) {
  out = out || {};
  let tt = t;
  if (t > SWAY_FROM) tt = SWAY_FROM - (SWAY_FROM - 38) * (0.5 - 0.5 * Math.cos((t - SWAY_FROM) * 2 * Math.PI / SWAY_PERIOD));
  let i = 0; while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].t <= tt) i++;
  const A = SKY_KEYS[i], B = SKY_KEYS[i + 1];
  const k = S5(A.t < -50 ? B.t - 14 : A.t, B.t, tt);
  for (let q = 0; q < SKY_FIELDS.length; q++) {
    const f = SKY_FIELDS[q], a = A[f], b = B[f];
    if (Array.isArray(a)) { const o = out[f] || (out[f] = [0, 0, 0]); o[0] = lerp(a[0], b[0], k); o[1] = lerp(a[1], b[1], k); o[2] = lerp(a[2], b[2], k); }
    else out[f] = lerp(a, b, k);
  }
  // the cloud deck closes in as the jet climbs to it; above it, it slowly opens and closes (never static)
  out.coverage = lerp(0.34, 0.82, S5(3, 13, t)) + (0.04 * Math.sin((t - 30) * 2 * Math.PI / 57) + 0.02 * Math.sin((t - 30) * 2 * Math.PI / 23)) * S5(26, 36, t); // stays closed: no dark ground through gaps
  out.haze = lerp(1, 0.35, S5(11, 21, t));          // thick low haze near the ground, clear above
  return out;
}

export function multAt(t) { return t <= 0 ? 1 : Math.exp(GROWTH * t); }
export function timeAtMult(m) { return Math.log(Math.max(1, m)) / GROWTH; }
