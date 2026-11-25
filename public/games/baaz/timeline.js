/* Baaz 3D — the whole round as pure functions of the round time τ (seconds).
 *   τ = 0   the round starts (1.00x): the falcon's feet leave the glove (lift-off)
 *   τ < 0   betting (-6 = betting opens): the falcon glides home and lands on the glove (only when it
 *           was away: `ret`), waits on it, and crouches for the spring in the last 0.6 s
 *   τ > 0   multiplier = e^(0.06 τ) (the engine's curve); the place follows the multiplier:
 *           dunes + oasis → canyon (≈2.25x) → golden clouds (≈3.6x) → above the cloud sea (≈5.9x, on and on)
 *   τc      the crash: the falcon tucks its wings and stoops down out of the frame; the camera glides to
 *           a stop and holds on the empty sky
 * Nothing here keeps state between frames: a player who joins at any moment computes exactly the
 * same picture. No three.js in this file (the Node motion check imports it too).
 *
 * World axes: +X east, +Y up, +Z south; metres. The falconer stands on a dune crest at the origin.
 * Falcon axes: +X beak, +Y back, +Z right wing. Heading ψ: forward = (cos ψ, 0, sin ψ). */

// the places by round time (multiplier e^(0.06 τ)): canyon from 13.5 s (2.25x), clouds 21.3 s (3.6x), above 29.6 s (5.9x)
export const GLOVE = [0, 1.3, 0];                 // top of the gauntlet's fist (where the feet grip): the falconer's raised left fist
export const PSI0 = 22 * Math.PI / 180;           // the falcon's heading on the glove (a little towards the camera)
export const THETA_PERCH = 58 * Math.PI / 180;    // body pitch on the glove (upright)
export const HIP = [-0.035, -0.035, 0];           // hip joint in falcon coordinates (between the legs)
export const LEG = 0.072;                         // hip → foot (feathered thigh + tarsus)
export const CROUCH0 = -0.62;                     // the spring starts
export const T_LAND = -3.0;                       // home: the feet touch the glove
export const T_RET0 = -6.6;                       // the way home starts (far away, under the dip)
export const SEA = 196;                           // top of the cloud sea (m)
export const D2R = Math.PI / 180;
// the two models (perched: wings folded; flying: wings spread) hand over while the wings open / fold
export const SWAP_OUT = [-0.3, -0.17], SWAP_IN = [0.22, 0.36];
const LK = 1.8, LA = 1.2, TURN_PRE = 48, HOP = 0.4; // the launch: camera blend (s), aim blend (s), the turn on the glove before the spring (°), first hop (m)

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function S5(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
export function lerp(a, b, k) { return a + (b - a) * k; }
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// ------------------------------------------------------------------ the terrain (dunes) — also used by world.js
// A long crest under the falconer, falling away ahead; transverse dunes across the wind; a flat pan
// round the oasis and a sandy floor between the canyon walls.
export const OASIS = [118, 0, -58];
export function groundAt(x, z) {
  const wx = x * 0.866 + z * 0.5, wz = -x * 0.5 + z * 0.866; // wind frame
  // transverse dunes: asymmetric ridges (gentle stoss, steep lee)
  let r = 0;
  const p1 = wx / 74 + 0.35 * Math.sin(wz / 61) + 0.18 * Math.sin(wz / 23 + 1.3);
  const f1 = p1 - Math.floor(p1); r += 7.5 * (f1 < 0.78 ? S5(0, 0.78, f1) : 1 - S5(0.78, 1, f1));
  const p2 = wx / 31 + 0.5 * Math.sin(wz / 37 + 2.1);
  const f2 = p2 - Math.floor(p2); r += 2.2 * (f2 < 0.72 ? S5(0, 0.72, f2) : 1 - S5(0.72, 1, f2));
  r += 2.0 * Math.sin(x / 140 + 0.7) * Math.sin(z / 115 - 0.4) + 1.2 * Math.sin(x / 47 + z / 53);
  // big dunes on the horizon (beyond 600 m)
  const far = S5(450, 900, Math.hypot(x - 300, z + 200));
  r += far * (18 * (0.5 + 0.5 * Math.sin(wx / 160 + Math.sin(wz / 210) * 1.4)) + 6);
  // the falconer's crest: a broad hump at the origin, the ground falling away ahead (+X)
  const dc = Math.hypot(x / 1.4, z);
  r = lerp(r, 3.5 - 0.004 * dc * dc, Math.exp(-dc * dc / (2 * 26 * 26)));
  // the oasis pan (flat, a little lower)
  const doa = Math.hypot(x - OASIS[0], z - OASIS[2]);
  r = lerp(r, -0.8, Math.exp(-doa * doa / (2 * 30 * 30)));
  return r - 3.5; // the crest top (the falconer's feet) is at y = 0
}

// ------------------------------------------------------------------ the flight path (integrated once)
// Horizontal speed and heading are smooth functions of τ; the height is given directly.
function vhAt(t) {
  return 2.6 * S5(-0.12, 0.28, t) + 8.5 * S5(0.15, 1.8, t) + 6 * S5(1.2, 5.5, t) + 3.5 * S5(6, 14, t) + 3 * S5(14, 23, t) + 2.5 * S5(25, 36, t);
}
export function headingAt(t) {
  return PSI0 - TURN_PRE * D2R - (62 - TURN_PRE) * D2R * S5(1.2, 9.5, t)
    + 9 * D2R * Math.sin((t - 4) * 2 * Math.PI / 9) * S5(3, 6, t) * (1 - S5(10, 13, t))         // over the dunes: a gentle weave
    + 13 * D2R * Math.sin((t - 12) * 2 * Math.PI / 11) * S5(11, 14, t) * (1 - S5(23, 27, t))     // the canyon meanders
    + 0.14 * Math.sin((t - 34) * 2 * Math.PI / 41) * S5(30, 38, t);                             // above the clouds: slow S-turns
}
let Y_OFF = 0;
function heightAt(t) { // centre of mass, metres
  return Y_OFF
    + HOP * S5(-0.05, 1.1, t) + (15.2 - HOP) * S5(0.9, 5.6, t) - 3.5 * S5(6.5, 9, t) + 3 * S5(9.5, 12, t)   // dunes: up, down over the oasis, up
    + 0.6 * Math.sin(t * 2 * Math.PI / 3.1) * S5(3, 6, t) * (1 - S5(28, 33, t))
    + 58 * S5(12.5, 23.5, t) + 128 * S5(19.5, 33, t) + 55 * S5(31, 46, t)                          // canyon → clouds → above
    + 7 * Math.sin((t - 44) * 2 * Math.PI / 23) * S5(40, 48, t);                                    // long rounds: soaring swells
}
const STEP = 1 / 240, KEEP = 2, T0 = -0.2, TMAX = 330;
const N = Math.ceil((TMAX - T0) / (STEP * KEEP)) + 2;
const PX = new Float64Array(N), PZ = new Float64Array(N), PV = new Float64Array(N);
let X0 = 0, Z0 = 0; // set from the anchored perch at τ = T0 (below)
function integrate() {
  let x = X0, z = Z0, t = T0, i = 0, k = 0;
  for (;;) {
    if (k % KEEP === 0) { PX[i] = x; PZ[i] = z; PV[i] = vhAt(t); i++; if (i >= N) break; }
    const tm = t + STEP / 2, vm = vhAt(tm), s = headingAt(tm);
    x += vm * Math.cos(s) * STEP; z += vm * Math.sin(s) * STEP; t += STEP; k++;
  }
}
function herm(u, h, p0, p1, m0, m1) { const u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1; }
const PS = { x: 0, y: 0, z: 0, vh: 0, vy: 0, psi: 0 };
function pathAt(t, out) {
  t = Math.max(t, T0);
  const f = (t - T0) / (STEP * KEEP);
  let i = Math.min(Math.floor(f), N - 2);
  const u = f - i, h = STEP * KEEP, t0 = T0 + i * h, t1 = t0 + h;
  const s0 = headingAt(t0), s1 = headingAt(t1);
  out.x = herm(u, h, PX[i], PX[i + 1], PV[i] * Math.cos(s0), PV[i + 1] * Math.cos(s1));
  out.z = herm(u, h, PZ[i], PZ[i + 1], PV[i] * Math.sin(s0), PV[i + 1] * Math.sin(s1));
  out.y = heightAt(t);
  out.vh = vhAt(t);
  const e = 1e-3; out.vy = (heightAt(t + e) - heightAt(t - e)) / (2 * e);
  out.psi = headingAt(t);
  return out;
}
function headingRate(t) { const e = 1e-3; return (headingAt(t + e) - headingAt(t - e)) / (2 * e); }

// ------------------------------------------------------------------ poses
// Wing pose: e elevation (rad, + up), s sweep (rad, + forward), f fold (0 spread … 1 folded on the back),
// tw twist (rad, + leading edge down), sp primary spread (0 closed … 1 fanned). Blended linearly.
const POSE = {
  fold:  { e: 0, s: 0, f: 1, tw: 0, sp: 0 },
  glide: { e: 0.07, s: -0.26, f: 0.2, tw: 0.04, sp: 0.12 },
  stoop: { e: 0.12, s: -0.55, f: 0.74, tw: 0.05, sp: 0 },
  flare: { e: 0.45, s: 0.42, f: 0.04, tw: -0.42, sp: 1 },
  rouse: { e: 0.06, s: 0, f: 0.86, tw: 0, sp: 0.1 },
};
function setPose(w, p) { w.e = p.e; w.s = p.s; w.f = p.f; w.tw = p.tw; w.sp = p.sp; }
function mixPose(w, p, k) { if (k <= 0) return; w.e += (p.e - w.e) * k; w.s += (p.s - w.s) * k; w.f += (p.f - w.f) * k; w.tw += (p.tw - w.tw) * k; w.sp += (p.sp - w.sp) * k; }
const FLAP = { e: 0, s: 0, f: 0, tw: 0, sp: 0 };
// one wingbeat at phase φ (cycles; 0 = top of the stroke), amplitude a (0..1.3)
function flapPose(ph, a, out) {
  const c = Math.cos(2 * Math.PI * ph), sn = Math.sin(2 * Math.PI * ph); // sn > 0: downstroke
  const up = Math.max(0, -sn);
  out.e = 0.12 + 0.62 * a * c;
  out.s = 0.12 * a * sn - 0.06;
  out.f = 0.06 + 0.42 * a * up * up;              // the hand folds in on the upstroke
  out.tw = 0.28 * a * sn;                          // pronated on the downstroke
  out.sp = 0.3 + 0.6 * a * Math.max(0, sn) + 0.2 * a * up; // primaries spread on the downstroke
  return out;
}
export const FLAP_HZ = 4.0;

// flapping (1) / gliding (0) over the flight: hard work at the launch and in the climbs
export function flapAmount(t) {
  if (t < 0) return 0;
  const launch = 1.25 - 0.35 * S5(0.8, 2.4, t);
  // bouts: 2.2 s of beats then 1.4 s of gliding, every 3.6 s (from 2.6 s)
  const c = ((t - 2.6) % 3.6 + 3.6) % 3.6;
  const bout = t < 2.9 ? 1 : (c < 2.2 ? S5(0, 0.3, c) * (1 - S5(1.9, 2.2, c)) : 0);
  const climb = S5(13, 15, t) * (1 - S5(31, 34, t));
  const pattern = Math.max(bout, 0.75 * climb) * (t < 2.6 ? 1 : 1);
  return lerp(launch, 0.95 * pattern, S5(1.8, 2.8, t));
}

// legs: angle a (rad, from the body's down axis towards the tail) and length factor l (0 tucked … 1)
function footLocal(theta, a, l, out) {
  const L = LEG * (0.55 + 0.45 * l);
  out[0] = HIP[0] - Math.sin(a) * L; out[1] = HIP[1] - Math.cos(a) * L; out[2] = 0;
  return out;
}
const FL = [0, 0, 0];
// where the feet are (world) for a falcon state J (the perched model stands on them)
export function footWorld(J, out) {
  footLocal(J.theta, J.legA, J.legL, FL);
  const c = Math.cos(J.theta), s = Math.sin(J.theta);
  const bx = FL[0] * c - FL[1] * s, by = FL[0] * s + FL[1] * c;
  const cp = Math.cos(J.psi), sp = Math.sin(J.psi);
  out[0] = J.x + bx * cp; out[1] = J.y + by; out[2] = J.z + bx * sp;
  return out;
}
// the falcon's centre of mass so that its feet stand on the glove (heading ψ, pitch θ, roll 0)
function anchored(psi, theta, a, l, out) {
  footLocal(theta, a, l, FL);
  // rotate the foot offset by pitch θ (about Z), then heading (about Y: x' = x cosψ − z sinψ … with forward = (cos ψ, 0, sin ψ))
  const c = Math.cos(theta), s = Math.sin(theta);
  const bx = FL[0] * c - FL[1] * s, by = FL[0] * s + FL[1] * c, bz = FL[2];
  const cp = Math.cos(psi), sp = Math.sin(psi);
  const wx = bx * cp - bz * sp, wz = bx * sp + bz * cp;
  out.x = GLOVE[0] - wx; out.y = GLOVE[1] - by; out.z = GLOVE[2] - wz;
  return out;
}
(function init() { // the path starts where the perch is at τ = 0 (crouched, legs driving)
  const o = newFalcon(); perchAt(0, 0, false, o);
  Y_OFF = o.y - heightAt(0);
  integrate();
  pathAt(0, PS);
  const dx = o.x - PS.x, dz = o.z - PS.z;
  for (let i = 0; i < N; i++) { PX[i] += dx; PZ[i] += dz; }
})();

// idle life on the glove (wall clock w, s): head glances, breathing, an occasional rouse
function glance(w, period, amp, seed) { // quick head turns that hold (C2)
  const k = Math.floor(w / period), u = w - k * period;
  const a0 = (hash1(k - 1 + seed) - 0.5) * 2 * amp, a1 = (hash1(k + seed) - 0.5) * 2 * amp;
  return a0 + (a1 - a0) * S5(0, 0.28, u);
}
function rouseEnv(w) { const u = ((w % 11.5) + 11.5) % 11.5 - 6.0; return u < 0 ? 0 : S5(0, 0.25, u) * (1 - S5(0.85, 1.3, u)); }

// The perch: feet on the glove. τ in [T_LAND, 0) (or any time with no round), plus the crouch.
function perchAt(t, w, ret, J) {
  const crouch = S5(CROUCH0, -0.18, t);           // lean forward and sink
  const spring = S5(-0.2, 0.0, t);               // legs drive
  const sl = Math.max(0, t - T_LAND), settle = ret ? Math.exp(-sl * 3.2) * Math.sin(sl * 9) * S5(0, 0.15, sl) : 0; // the landing bob
  const live = (ret ? S5(T_LAND + 0.7, T_LAND + 1.4, t) : 1) * (1 - S5(CROUCH0 - 0.6, CROUCH0, t));
  const breath = Math.sin(w * 2 * Math.PI / 1.45);
  const rz = rouseEnv(w) * live;
  let theta = THETA_PERCH - 30 * D2R * crouch + 6 * D2R * settle + 0.012 * breath * live;
  const a = THETA_PERCH + (theta - THETA_PERCH) * 0.2 - 10 * D2R * crouch;
  const l = 1 - 0.32 * crouch + 0.32 * spring + 0.06 * settle;
  J.psi = PSI0 - TURN_PRE * D2R * S5(CROUCH0 - 0.35, -0.12, t); // it turns on the glove into its launch line
  J.theta = theta; J.phi = rz * 0.06 * Math.sin(w * 2 * Math.PI * 9);
  anchored(J.psi, theta, a, l, J);
  J.legA = a; J.legL = l; J.grip = 1 - 0.6 * spring; J.perch = 1;
  J.headYaw = glance(w, 2.7, 0.75, 3) * live; J.headPitch = glance(w + 1.3, 3.9, 0.18, 9) * live;
  J.headLevel = 1; // the head stays level (counter-pitch)
  J.breath = breath * live; J.puff = 0.06 * rz;
  setPose(J.wL, POSE.fold); mixPose(J.wL, POSE.rouse, rz);
  J.tailSp = 0.05 + 0.25 * rz; J.tailPitch = -0.08 * crouch + 0.05 * rz * Math.sin(w * 40);
}

// ------------------------------------------------------------------ the falcon at τ
// J: { x, y, z (centre of mass), psi, theta, phi, wL/wR wing poses, tailSp, tailPitch, legA, legL, grip,
//      headYaw, headPitch, headLevel, breath, puff, vis (0 hidden … 1) }
const P = { x: 0, y: 0, z: 0, vh: 0, vy: 0, psi: 0 }, Q = { x: 0, y: 0, z: 0, vh: 0, vy: 0, psi: 0 };
function newPose() { return { e: 0, s: 0, f: 0, tw: 0, sp: 0 }; }
export function newFalcon() { return { wL: newPose(), wR: newPose() }; }

function flightAt(t, J) {
  pathAt(t, P);
  const ph = FLAP_HZ * t, a = flapAmount(t);
  flapPose(ph, a, FLAP);
  setPose(J.wL, POSE.glide); mixPose(J.wL, FLAP, S5(0, 0.15, a)); // (flap amplitude 0 ≈ the glide pose)
  const bob = -0.012 * Math.sin(2 * Math.PI * ph) * a;              // the body rises on the downstroke
  const gam = Math.atan2(P.vy, Math.max(P.vh, 0.5));
  const lift = S5(0, 0.75, t);
  J.x = P.x; J.y = P.y + bob; J.z = P.z; J.psi = P.psi; J.perch = 0;
  J.theta = lerp(THETA_PERCH - 30 * D2R, gam * 0.75 + 5 * D2R, lift) + 0.05 * Math.sin(2 * Math.PI * ph - 0.6) * a;
  J.phi = clamp(Math.atan(P.vh * headingRate(t) / 9.81), -0.9, 0.9) * S5(0.6, 1.6, t);
  J.legA = lerp(THETA_PERCH - 16 * D2R, 100 * D2R, S5(0.05, 0.7, t)); J.legL = lerp(1.0, 0, S5(0.05, 0.8, t)); J.grip = 0.4 - 0.4 * S5(0.1, 0.6, t);
  J.headYaw = 0.12 * Math.sin(t * 0.7) * S5(2, 4, t); J.headPitch = 0; J.headLevel = 1;
  J.breath = 0; J.puff = 0;
  J.tailSp = lerp(0.9, 0.25, S5(0.6, 2.4, t)) + 0.4 * Math.min(1, Math.abs(J.phi)); J.tailPitch = 0.08 * Math.sin(t * 0.9) * S5(2, 4, t);
}

// after the crash at τc: the stoop — wings tucked, nose down, accelerating down and out of the frame
const STOOP_G = 14, EASE = 0.8;
const EARLY_G = 0.8; // a stoop just off the glove drops 80% softer (the tuck stays in view ≥ 0.6 s)
function ramp2(s) { return s * s * s / (s + EASE); }
const SB = { wL: newPose(), wR: newPose() };
function stoopAt(t, tc, w, ret, J) {
  const s = t - tc;
  baseAt(tc, w, ret, J);           // body where the crash found it …
  baseAt(t, w, ret, SB);           // … the wings carry on their beat while they tuck
  pathAt(tc, Q);
  const k = S5(0, 0.32, s);
  const vx = Q.vh * Math.cos(Q.psi), vz = Q.vh * Math.sin(Q.psi);
  const fx = Math.cos(Q.psi), fz = Math.sin(Q.psi);
  const boost = 3.2 * (1 - S5(0.4, 3, tc));                                // just off the glove: clear it first
  const early = 1 - S5(0.4, 2.6, tc);                                       // just off the glove: a gentler drop, the tuck stays in view
  const G = STOOP_G * (1 - EARLY_G * early);
  // relative to the camera (which glides to a stop with the same easing): it keeps flying on a little and
  // drops away, faster and faster — the same read in every place, and it never comes back into the frame
  const r2 = ramp2(s), gl = glide(s), gd = glideRate(s), on = 0.55 * Q.vh * (s - gl) + boost * r2 * 0.6;
  J.x += vx * gl + fx * on;
  J.z += vz * gl + fz * on;
  J.y += Q.vy * gl - G * r2;
  if (early > 0.001) { const g = groundAt(J.x, J.z) + 0.35, d = (J.y - g) / 0.4, fl = g + 0.4 * (d > 20 ? d : Math.log(1 + Math.exp(d))); J.y += (fl - J.y) * early; } // just off the glove: it skims the sand, never into it
  // the dive angle follows the velocity
  const vy = Q.vy * gd - G * (3 * s * s * (s + EASE) - s * s * s) / ((s + EASE) * (s + EASE));
  const vhh = Q.vh * gd + 0.55 * Q.vh * (1 - gd) + boost * 1.2 * s;
  const dive = Math.atan2(vy, Math.max(vhh, 1));
  J.theta = lerp(J.theta, dive, S5(0, 0.6, s));
  J.phi = J.phi * (1 - k) + 0.35 * Math.sin(Math.PI * S5(0, 0.9, s));     // a quick half-roll into the dive
  setPose(J.wL, SB.wL); mixPose(J.wL, POSE.stoop, k);
  J.tailSp = SB.tailSp * (1 - k); J.tailPitch = SB.tailPitch * (1 - k);
  J.legA = lerp(SB.legA, 100 * D2R, k); J.legL = SB.legL * (1 - k); J.grip = SB.grip * (1 - k);
  J.headYaw *= 1 - k;
}

// the way home: a glide in from the far left, a flare with braking beats, the feet on the glove at T_LAND
const H_START = [-20, 8, -50], H_V0 = 15; // (far behind the glove, in the betting camera's view)
function quintic(u, p0, v0, p1, v1, h) { // position with zero acceleration at both ends (C2 joins)
  const u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
  const h00 = 1 - 10 * u3 + 15 * u4 - 6 * u5, h10 = u - 6 * u3 + 8 * u4 - 3 * u5;
  const h01 = 10 * u3 - 15 * u4 + 6 * u5, h11 = -4 * u3 + 7 * u4 - 3 * u5;
  return h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
}
const LANDED = { wL: newPose(), wR: newPose() };
function homeAt(t, w, J) {
  perchAt(T_LAND, w, true, LANDED);
  const h = T_LAND - T_RET0, u = clamp((t - T_RET0) / h, 0, 1);
  // start: gliding towards the glove, a little from the left; end: slow, rising onto the glove along PSI0
  const dx = LANDED.x - H_START[0], dz = LANDED.z - H_START[2], dl = Math.hypot(dx, dz);
  const v0x = H_V0 * (dx / dl * 0.8 + 0.2 * Math.cos(PSI0 - 0.9)), v0z = H_V0 * (dz / dl * 0.8 + 0.2 * Math.sin(PSI0 - 0.9)), v0y = -1.6;
  const v1 = 0.3, v1x = v1 * Math.cos(PSI0), v1z = v1 * Math.sin(PSI0), v1y = 0.35;
  J.x = quintic(u, H_START[0], v0x, LANDED.x, v1x, h);
  J.y = quintic(u, H_START[1], v0y, LANDED.y, v1y, h);
  J.z = quintic(u, H_START[2], v0z, LANDED.z, v1z, h);
  const e = 1e-3, u2 = clamp(u + e / h, 0, 1);
  const x2 = quintic(u2, H_START[0], v0x, LANDED.x, v1x, h), z2 = quintic(u2, H_START[2], v0z, LANDED.z, v1z, h), y2 = quintic(u2, H_START[1], v0y, LANDED.y, v1y, h);
  let vx = (x2 - J.x) / e, vz = (z2 - J.z) / e; const vy = (y2 - J.y) / e;
  const vh = Math.hypot(vx, vz);
  // heading: along the flight, turning exactly onto PSI0 for the touch-down
  let psi = Math.atan2(vz, vx);
  const dpsi = Math.atan2(Math.sin(PSI0 - psi), Math.cos(PSI0 - psi));
  psi = PSI0 - dpsi * (1 - S5(0.55, 0.97, u));
  J.psi = psi;
  const flare = S5(0.7, 0.93, u), touch = S5(0.93, 1, u);
  const gam = Math.atan2(vy, Math.max(vh, 0.5));
  J.theta = lerp(gam * 0.6 + 4 * D2R, 62 * D2R, flare);
  J.theta = lerp(J.theta, LANDED.theta, touch);
  // bank into the curve (from the heading's turn rate)
  const u3 = clamp(u + 2 * e / h, 0, 1);
  const x3 = quintic(u3, H_START[0], v0x, LANDED.x, v1x, h), z3 = quintic(u3, H_START[2], v0z, LANDED.z, v1z, h);
  const psi2 = Math.atan2(z3 - z2, x3 - x2), turn = Math.atan2(Math.sin(psi2 - Math.atan2(vz, vx)), Math.cos(psi2 - Math.atan2(vz, vx))) / e;
  J.phi = clamp(Math.atan(vh * turn / 9.81), -0.6, 0.6) * (1 - flare);
  // wings: glide → flare with braking beats → fold on the glove
  setPose(J.wL, POSE.glide);
  const brake = S5(0.72, 0.8, u) * (1 - S5(0.96, 1, u));
  flapPose(FLAP_HZ * 1.1 * (t - T_LAND) + 0.5, 0.9, FLAP);
  mixPose(J.wL, POSE.flare, flare);
  if (brake > 0) { FLAP.s += 0.35; FLAP.tw -= 0.3; mixPose(J.wL, FLAP, brake * 0.75); }
  J.tailSp = 0.3 + 0.7 * flare; J.tailPitch = -0.35 * flare;
  J.legA = lerp(100 * D2R, 15 * D2R, S5(0.6, 0.85, u)); J.legA = lerp(J.legA, LANDED.legA, touch);
  J.legL = lerp(0, 1.1, S5(0.6, 0.85, u)); J.legL = lerp(J.legL, LANDED.legL, touch);
  J.grip = 0.2 + 0.8 * touch;
  J.headYaw = 0; J.headPitch = -0.1 * (1 - flare); J.headLevel = 1; J.breath = 0; J.puff = 0; J.perch = 0;
}

// after the touch-down: the wings fold (0.65 s) — continuous with homeAt at T_LAND. The hands fold first
// (h, 0.3 s) while the wings are still up, then the folded wings settle onto the back: a half-folded wing
// never swings its long primaries down past the glove.
function foldIn(t, J) {
  const k = S5(T_LAND, T_LAND + 0.65, t), kh = S5(T_LAND, T_LAND + 0.3, t);
  J.perch = S5(T_LAND + SWAP_IN[0], T_LAND + SWAP_IN[1], t); // the folding wings: the perched model takes over
  if (k >= 1) return;
  setPose(WKEEP, J.wL); setPose(J.wL, POSE.flare); mixPose(J.wL, WKEEP, k);
  J.wL.h = lerp(POSE.flare.f, WKEEP.f, kh); J.wL.sp = lerp(POSE.flare.sp, WKEEP.sp, kh);
  J.tailSp = lerp(1.0, J.tailSp, k); J.tailPitch = lerp(-0.35, J.tailPitch, k);
}

const PB = { wL: newPose(), wR: newPose() }, WKEEP = newPose(), TOP = newPose(); // (no allocation per frame)
const BODY = ['x', 'y', 'z', 'psi', 'theta', 'phi', 'legA', 'legL', 'grip', 'headYaw', 'headPitch', 'breath', 'puff'];
function baseAt(t, w, ret, J) {
  if (t >= 0) {
    flightAt(t, J);
    if (t < 0.32) { // the feet leave the glove at 1.00x: the body eases off the anchored perch
      perchAt(t, w, ret, PB);
      const k = 1 - S5(0, 0.32, t);
      for (let i = 0; i < BODY.length; i++) J[BODY[i]] += (PB[BODY[i]] - J[BODY[i]]) * k;
    }
  } else if (ret && t < T_LAND) homeAt(Math.max(t, T_RET0), w, J);
  else { perchAt(t, w, ret, J); if (ret) foldIn(t, J); }
  if (t >= CROUCH0 && t < 0.6) { launchWings(t, J); if (t < 0) J.perch = 1 - S5(SWAP_OUT[0], SWAP_OUT[1], t); }
  return J;
}
// st: τ, τc (or null), wall (s), ret (the falcon comes home this betting: it was away)
export function falconAt(t, tc, w, ret, J) {
  J = J || newFalcon();
  J.vis = 1; J.wL.h = -1; // (the hand folds with the shoulder, except in foldIn)
  if (tc != null && t > tc) stoopAt(t, tc, w, ret, J);
  else baseAt(t, w, ret, J);
  // right wing mirrors the left
  J.wR.e = J.wL.e; J.wR.s = J.wL.s; J.wR.f = J.wL.f; J.wR.tw = J.wL.tw; J.wR.sp = J.wL.sp; J.wR.h = J.wL.h;
  if (t >= 0) { // in a bank the inner wing works a little less
    const d = clamp(J.phi, -0.6, 0.6) * 0.12;
    J.wL.e -= d; J.wR.e += d;
  }
  return J;
}
// the spring: the wings open from the fold into the first downstroke (top of the stroke at τ = 0)
function launchWings(t, J) {
  const open = S5(-0.4, 0.0, t);
  if (t < 0) {
    flapPose(0, 1.25, FLAP);
    TOP.e = FLAP.e + 0.25; TOP.s = FLAP.s + 0.1; TOP.f = FLAP.f + 0.1; TOP.tw = FLAP.tw; TOP.sp = 0.6;
    mixPose(J.wL, TOP, open);
    J.tailSp = Math.max(J.tailSp, 0.9 * open);
  } else {
    // ease out of the "top" overshoot over the first beat
    const k = 1 - S5(0, 0.12, t);
    J.wL.e += 0.25 * k; J.wL.s += 0.1 * k; J.wL.f += 0.1 * k; J.wL.sp += 0.25 * k;
  }
}

// ------------------------------------------------------------------ the camera at τ
// On the glove: a fixed side view (the arm from the left, the falcon facing right, the sun behind on
// the right), a slow push-in, a hand-held drift. After the launch it swings round behind the falcon
// into a chase (offsets in the falcon's heading frame: azimuth from straight behind (+ = right side),
// elevation, distance; C1 splines), the perch view blending out over 3.4 s.
export const PERCH_CAM = { pos: [0.82, 1.5, 1.36], aim: [-0.08, 1.4, -0.05] }; // front-right: the falcon on the fist, the falconer beside it
const CAM = {
  az:   [[0, 70], [1.2, 52], [2.6, 32], [4.5, 22], [8, 14], [12, 26], [16, 30], [21, 18], [27, 12], [33, 20]],
  el:   [[0, 2], [1.0, 6], [3, 10], [7, 12], [12, 9], [17, 7], [22, 11], [28, 9], [34, 8]],
  dist: [[0, 1.15], [1.2, 1.3], [3, 1.45], [6, 1.55], [12, 1.62], [20, 1.7], [30, 1.78]],
};
function tangent(keys, j) { if (j <= 0 || j >= keys.length - 1) return 0; return (keys[j + 1][1] - keys[j - 1][1]) / (keys[j + 1][0] - keys[j - 1][0]); }
function spline(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (keys[i + 1][0] < t) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1];
  return herm((t - t0) / (t1 - t0), t1 - t0, p0, p1, tangent(keys, i), tangent(keys, i + 1));
}
function chaseRaw(t, out) {
  pathAt(t, P);
  const w = S5(30, 38, t), ph = (t - 38) * 2 * Math.PI / 52;
  const az = lerp(spline(CAM.az, t), 18 - 40 * (0.5 - 0.5 * Math.cos(ph)), w) * D2R;
  const el = lerp(spline(CAM.el, t), 4 + 2.5 * Math.sin(ph * 1.6), w) * D2R; // above the sea: a lower camera (more sky)
  const dist = lerp(spline(CAM.dist, t), 1.78 + 0.15 * Math.sin(ph * 0.7 + 1), w);
  const psi = P.psi, fx = Math.cos(psi), fz = Math.sin(psi), ce = Math.cos(el);
  out.x = P.x + (-fx * ce * Math.cos(az) - fz * ce * Math.sin(az)) * dist;
  out.z = P.z + (-fz * ce * Math.cos(az) + fx * ce * Math.sin(az)) * dist;
  out.y = P.y + Math.sin(el) * dist + 0.15;
  out.ax = P.x + fx * 0.25; out.ay = P.y + 0.02; out.az = P.z + fz * 0.25;
  out.roll = 0.22 * clamp(Math.atan(P.vh * headingRate(t) / 9.81), -0.9, 0.9) * S5(1, 3, t);
  return out;
}
function perchCam(t, w, out) {
  const push = S5(-6, 0, t) * 0.12; // slow push-in during betting
  const hx = 0.012 * Math.sin(w * 0.37) + 0.006 * Math.sin(w * 0.91 + 1), hy = 0.008 * Math.sin(w * 0.29 + 2) + 0.004 * Math.sin(w * 1.13);
  const p = PERCH_CAM.pos, a = PERCH_CAM.aim;
  out.x = p[0] + (a[0] - p[0]) * push + hx; out.y = p[1] + (a[1] - p[1]) * push + hy; out.z = p[2] + (a[2] - p[2]) * push;
  out.ax = a[0] + hx * 0.4; out.ay = a[1] + hy * 0.4; out.az = a[2];
  out.roll = 0.004 * Math.sin(w * 0.23);
  return out;
}
const CA = {}, CB = {}, CF = {}, CR = {};
function flightCam(t, w, out) {
  perchCam(Math.min(t, 0), w, CA);
  if (t <= -0.2) { Object.assign(out, CA); return out; }
  chaseRaw(t, CB);
  const k = S5(-0.2, LK, t);
  // the aim leaves the glove and follows the falcon at once (its own faster blend)
  const ka = S5(-0.05, LA, t);
  pathAt(t, P);
  out.x = lerp(CA.x, CB.x, k); out.y = lerp(CA.y, CB.y, k); out.z = lerp(CA.z, CB.z, k);
  const fx = lerp(CA.ax, P.x, ka), fy = lerp(CA.ay, P.y, ka), fz = lerp(CA.az, P.z, ka);
  out.ax = lerp(fx, CB.ax, k); out.ay = lerp(fy, CB.ay, k); out.az = lerp(fz, CB.az, k);
  out.roll = lerp(CA.roll, CB.roll, k);
  return out;
}
const GLIDE = 1.1;
export function glide(s) { const x = Math.min(1, s / GLIDE); return x < 1 ? s - GLIDE * (x * x * x - x * x * x * x / 2) : GLIDE / 2; }
function glideRate(s) { const x = Math.min(1, s / GLIDE); return 1 - 3 * x * x + 2 * x * x * x; }
// home: the perch view, the aim leaning towards the falcon gliding in
const HJ = newFalcon();
export function cameraAt(t, tc, w, ret, out) {
  out = out || {};
  if (tc != null && t > tc) {
    const s = t - tc, e = 1e-3;
    flightCam(tc - e, w, CR); flightCam(tc, w, CF);
    const g = glide(s);
    out.x = CF.x + (CF.x - CR.x) / e * g; out.y = CF.y + (CF.y - CR.y) / e * g; out.z = CF.z + (CF.z - CR.z) / e * g;
    // the aim glides on too, and lifts a little to the open sky as the falcon drops away
    const lift = 0.35 * S5(0.2, 1.6, s) * Math.hypot(CF.ax - CF.x, CF.az - CF.z, CF.ay - CF.y);
    out.ax = CF.ax + (CF.ax - CR.ax) / e * g; out.ay = CF.ay + (CF.ay - CR.ay) / e * g + lift; out.az = CF.az + (CF.az - CR.az) / e * g;
    out.roll = CF.roll * (1 - S5(0, 1.5, s));
    // for a moment the aim dips after the falcon as it tucks and drops, then lets it go
    const dip = 0.42 * S5(0, 0.8, s) * (1 - S5(0.9, 2.2, s)) * Math.hypot(CF.ax - CF.x, CF.az - CF.z, CF.ay - CF.y);
    out.ay -= dip;
    // the tuck: a short jolt of the camera (decays in ~0.6 s)
    const jolt = 0.018 * Math.hypot(CF.ax - CF.x, CF.az - CF.z, CF.ay - CF.y) * Math.exp(-s * 5) * S5(0, 0.05, s);
    out.x += jolt * Math.sin(s * 41); out.y += jolt * Math.sin(s * 53 + 1.3); out.roll += 0.5 * jolt * Math.sin(s * 37 + 0.4);
    return out;
  }
  flightCam(t, w, out);
  if (t < 0 && ret && t < T_LAND + 0.8) { // the aim leans towards the falcon gliding home
    falconAt(t, null, w, true, HJ);
    const dx = HJ.x - out.ax, dy = HJ.y - out.ay, dz = HJ.z - out.az, dl = Math.hypot(dx, dy, dz);
    const k = 0.32 * (1 - S5(T_LAND - 0.9, T_LAND + 0.6, t)) * 0.3 / Math.sqrt(dl * dl + 0.09); // at most ~0.1 m (≈5°) towards it, smoothly
    out.ax += dx * k; out.ay += dy * k; out.az += dz * k;
  }
  return out;
}

// ------------------------------------------------------------------ the sky by place
// Keyframes over τ (linear RGB; the renderer tone-maps): bright daylight all the way (a standing rule for the
// crash games): a high warm sun over the dunes and the canyon, crisp white clouds, a deep blue sky above the cloud sea.
function c3(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2)); }
export const SKY_KEYS = [
  { t: -99, el: 27, az: 64, zen: c3('#3b7dd8'), hor: c3('#d6e4ef'), glow: c3('#b8ad9c'), fogSun: c3('#fff3e0'), ground: c3('#d8b48c'), sun: c3('#fff3e0'), sunI: 3.3, hs: c3('#a9c8ee'), hg: c3('#d9b088'), lit: c3('#ffffff'), shade: c3('#b9c6da'), exp: 0.7, haze: 0.75 },
  { t: 10, el: 29, az: 62, zen: c3('#3a7cd8'), hor: c3('#d4e3f0'), glow: c3('#b8ad9c'), fogSun: c3('#fff3e0'), ground: c3('#d6b089'), sun: c3('#fff3e2'), sunI: 3.3, hs: c3('#a9c8ee'), hg: c3('#d6ac86'), lit: c3('#ffffff'), shade: c3('#b6c4da'), exp: 0.7, haze: 0.75 },
  { t: 19, el: 33, az: 58, zen: c3('#3677d6'), hor: c3('#d2e2f1'), glow: c3('#b8ad9c'), fogSun: c3('#fff4e4'), ground: c3('#d2ab86'), sun: c3('#fff4e6'), sunI: 3.4, hs: c3('#a6c6ee'), hg: c3('#cfa884'), lit: c3('#ffffff'), shade: c3('#b2c2da'), exp: 0.7, haze: 0.65 },
  { t: 27, el: 30, az: 20, zen: c3('#2f70d2'), hor: c3('#d8e6f3'), glow: c3('#b8ad9c'), fogSun: c3('#fff6ea'), ground: c3('#e6eef6'), sun: c3('#fff6ea'), sunI: 3.4, hs: c3('#a4c4ee'), hg: c3('#dfe6ee'), lit: c3('#ffffff'), shade: c3('#adbdd6'), exp: 0.8, haze: 0.5 },
  { t: 35, el: 25, az: -22, zen: c3('#2965cc'), hor: c3('#cfe0f2'), glow: c3('#b8ad9c'), fogSun: c3('#fff6ec'), ground: c3('#eef3f8'), sun: c3('#fff6ec'), sunI: 3.3, hs: c3('#9fc0ee'), hg: c3('#e8eef4'), lit: c3('#ffffff'), shade: c3('#a9bad6'), exp: 0.8, haze: 0.45 },
  { t: 48, el: 24, az: -30, zen: c3('#245cc4'), hor: c3('#cddff2'), glow: c3('#b8ad9c'), fogSun: c3('#fff5ea'), ground: c3('#eef3f8'), sun: c3('#fff5ea'), sunI: 3.3, hs: c3('#9bbdee'), hg: c3('#e8eef4'), lit: c3('#ffffff'), shade: c3('#a6b8d6'), exp: 0.8, haze: 0.45 },
];
const SKY_FIELDS = Object.keys(SKY_KEYS[0]).filter((k) => k !== 't');
export function skyAt(t, out) {
  out = out || {};
  let i = 0; while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].t <= t) i++;
  const A = SKY_KEYS[i], B = SKY_KEYS[i + 1];
  const k = S5(A.t < -50 ? B.t - 10 : A.t, B.t, t);
  for (let q = 0; q < SKY_FIELDS.length; q++) {
    const f = SKY_FIELDS[q], a = A[f], b = B[f];
    if (Array.isArray(a)) { const o = out[f] || (out[f] = [0, 0, 0]); o[0] = lerp(a[0], b[0], k); o[1] = lerp(a[1], b[1], k); o[2] = lerp(a[2], b[2], k); }
    else out[f] = lerp(a, b, k);
  }
  out.ground01 = 1 - S5(28, 33, t);   // the ground is under the cloud sea from here
  return out;
}

export function pathPoint(t, out) { return pathAt(t, out || {}); }
