/* Sixer Sky 3D — the whole round as pure functions of the round time τ (seconds; no three.js here).
 *   τ < 0   betting: the batsman waits at the crease. The delivery comes down the pitch in the last
 *           T_BOWL seconds (one bounce) and meets the bat exactly at τ = 0 (1.00x).
 *   τ > 0   the six: the ball climbs out of the stadium (≈1.2x), over the town, through the afternoon
 *           clouds (≈3.6x) and above the cloud sea in golden light (≈5.3x, on and on). The camera
 *           leaves the crease, turns with the ball and settles close behind it (the seam turning).
 *   τc      the end: the ball loses its lift and drops away under the camera, which glides to a stop.
 * Nothing keeps state between frames: a player who joins at any moment sees exactly the same picture.
 *
 * World: metres. The pitch runs along +Z: the striker's stumps at z = 0, the bowler's at z = PITCH.
 * +Y up, +X to the off side of a right-hander (the camera's left at the crease). */

export const D2R = Math.PI / 180;
export const PITCH = 20.12;                    // stumps to stumps
export const FIELD_R = 68;                     // the boundary rope
export const SEA = 196;                        // top of the cloud sea (m)
export const T_BOWL = 0.66;                    // the delivery: release → bat (s)
export const HIT = [0.22, 0.92, 1.05];         // where the bat meets the ball
export const RELEASE = [-0.35, 2.15, PITCH - 1.2];
export const BOUNCE_Z = 4.6;                   // the ball pitches here (a full length, to be driven)
export const BALL_R = 0.0364;

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function S5(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
export function lerp(a, b, k) { return a + (b - a) * k; }

// ------------------------------------------------------------------ the six: where the ball is
// height: a steep start (a real six leaves at ≈40°), a steady climb, levelling off above the cloud sea
function heightAt(t) {
  const g = t <= 24 ? 5 * t : 120 + 50 * (1 - Math.exp(-(t - 24) / 10));
  return HIT[1] + 60 * (1 - Math.exp(-t / 3.2)) + g;
}
function zAt(t) { return HIT[2] + 12 * t + 24 * (1 - Math.exp(-t / 1.5)); }
function xAt(t) { return HIT[0] + 0.9 * t + 26 * (1 - Math.cos(t * 0.045)); }   // a slow curl (the clouds drift across)
const PA = { x: 0, y: 0, z: 0 }, PB = { x: 0, y: 0, z: 0 };
function flight(t, o) { o.x = xAt(t); o.y = heightAt(t); o.z = zAt(t); return o; }
// position + heading on the flight (τ ≥ 0), for placing the clouds along it
export function pathPoint(t, out) {
  out = out || {};
  flight(t, PA); flight(t + 0.05, PB);
  out.x = PA.x; out.y = PA.y; out.z = PA.z;
  out.psi = Math.atan2(PB.z - PA.z, PB.x - PA.x);     // forward = (cos ψ, sin ψ) in (x, z)
  return out;
}

// the delivery (τ in [-T_BOWL, 0]): release → bounce → bat, straight lines in x/z, parabolas in y
const T_PITCH = -0.17;                                   // the bounce
function deliveryAt(t, o) {
  const u = clamp((t + T_BOWL) / T_BOWL, 0, 1);
  o.x = lerp(RELEASE[0], HIT[0], u);
  if (t < T_PITCH) {
    const k = (t + T_BOWL) / (T_PITCH + T_BOWL);
    o.z = lerp(RELEASE[2], BOUNCE_Z, k);
    o.y = lerp(RELEASE[1], BALL_R, k * k * 0.72 + k * 0.28);      // dipping onto the pitch
  } else {
    const k = (t - T_PITCH) / -T_PITCH;
    o.z = lerp(BOUNCE_Z, HIT[2], k);
    o.y = BALL_R + (HIT[1] - BALL_R) * (1.55 * k - 0.55 * k * k); // rising off the pitch, still climbing at the bat
  }
  return o;
}

// The ball: { x, y, z, vis, spin (rad, about its seam axis), fall (0..1 after the end) }
const G_END = 15;
export function ballAt(t, tc, out) {
  out = out || {};
  out.fall = 0;
  if (t < -T_BOWL) { out.x = RELEASE[0]; out.y = RELEASE[1]; out.z = RELEASE[2]; out.vis = 0; out.spin = 0; return out; }
  if (t < 0) { deliveryAt(t, out); out.vis = S5(-T_BOWL, -T_BOWL + 0.06, t); out.spin = -t * 38; return out; }
  if (tc != null && t > tc) {
    // the end: it carries on for a moment, then drops (the camera does not follow it down)
    const s = t - tc; flight(tc, PA); flight(tc + 0.02, PB);
    const vx = (PB.x - PA.x) / 0.02, vy = (PB.y - PA.y) / 0.02, vz = (PB.z - PA.z) / 0.02;
    const rise = (1 - Math.exp(-s * 2.2)) / 2.2;                    // its climb dies away
    out.x = PA.x + vx * s; out.z = PA.z + vz * s;                   // it carries on ahead of the camera (which glides to a stop)
    out.y = PA.y + vy * rise - G_END * Math.pow(s, 2.4) / 6;        // it hangs for a moment, then goes
    out.vis = 1; out.fall = S5(0, 0.5, s);
    out.spin = spinAt(tc) + s * 9;
    return out;
  }
  flight(t, out); out.vis = 1; out.spin = spinAt(t);
  return out;
}
function spinAt(t) { return 26 * (1 - Math.exp(-t / 1.2)) + 5.2 * t; }   // fast off the bat, then a steady turn

// ------------------------------------------------------------------ the camera
// At the crease: a low three-quarter view from the bowler's side (the batsman, the stumps and the
// keeper's end behind him). After the hit it turns with the ball and closes in behind it.
export const CREASE_CAM = { pos: [-2.1, 1.28, 5.0], aim: [-0.1, 1.02, 0.2] };
const CHASE_BACK = 0.8, CHASE_UP = 0.3, T_CHASE = 1.7;
const B = {};
const GLIDE = 1.1;
function glide(s) { const x = Math.min(1, s / GLIDE); return x < 1 ? s - GLIDE * (x * x * x - x * x * x * x / 2) : GLIDE / 2; }
function chase(t, out) {
  flight(t, PA); flight(t + 0.05, PB);
  let dx = PB.x - PA.x, dz = PB.z - PA.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  out.x = PA.x - dx * CHASE_BACK; out.y = PA.y + CHASE_UP; out.z = PA.z - dz * CHASE_BACK;
  // look past the ball, a little down: the horizon in the upper third, the world falling away below
  const down = 0.34 - 0.2 * S5(20, 30, t);
  out.ax = PA.x + dx * 3; out.ay = PA.y - down; out.az = PA.z + dz * 3;
  return out;
}
const CH = {};
// out: { x, y, z, ax, ay, az, roll, fov }
export function cameraAt(t, tc, w, out) {
  out = out || {};
  const P = CREASE_CAM.pos, A = CREASE_CAM.aim;
  // a hand-held breath at the crease, and a slow push-in while the bowler runs in
  const push = S5(-2.2, -0.1, t) * 0.5;
  const px = P[0] + Math.sin(w * 0.31) * 0.035 + 0.3 * push, py = P[1] + Math.sin(w * 0.23 + 1.3) * 0.02, pz = P[2] - push;
  if (t <= 0) {
    out.x = px; out.y = py; out.z = pz; out.ax = A[0]; out.ay = A[1]; out.az = A[2]; out.roll = 0; out.fov = 0;
    return out;
  }
  const te = tc != null && t > tc ? tc + glide(t - tc) : t;   // after the end the camera glides to a stop
  chase(te, CH);
  ballAt(Math.min(te, tc != null ? tc : te), null, B);
  const k = S5(0.04, T_CHASE, te);
  out.x = lerp(px, CH.x, k); out.y = lerp(py, CH.y, k); out.z = lerp(pz, CH.z, k);
  // the aim: crease → the ball itself (it passes overhead) → past the ball
  const a1 = S5(-0.02, 0.2, te), a2 = S5(0.55, T_CHASE + 0.4, te);
  const mx = lerp(A[0], B.x, a1), my = lerp(A[1], B.y, a1), mz = lerp(A[2], B.z, a1);
  out.ax = lerp(mx, CH.ax, a2); out.ay = lerp(my, CH.ay, a2); out.az = lerp(mz, CH.az, a2);
  out.roll = 0.05 * Math.sin(te * 0.21) * S5(3, 9, te);
  out.fov = 0;
  return out;
}

// ------------------------------------------------------------------ the light: a bright afternoon → gold above the clouds (never night)
function c3(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2)); }
export const SKY_KEYS = [
  { t: -99, el: 34, az: 118, zen: c3('#2f6fd0'), hor: c3('#bfdcf2'), glow: c3('#fff1d0'), fogSun: c3('#fff3dc'), ground: c3('#8fa37a'), sun: c3('#fff4e0'), sunI: 3.6, hs: c3('#a9c8f0'), hg: c3('#7c9160'), lit: c3('#ffffff'), shade: c3('#a9b6cc'), exp: 0.84, haze: 0.8 },
  { t: 6, el: 34, az: 118, zen: c3('#2f6fd0'), hor: c3('#bfdcf2'), glow: c3('#fff1d0'), fogSun: c3('#fff3dc'), ground: c3('#8fa37a'), sun: c3('#fff4e0'), sunI: 3.6, hs: c3('#a9c8f0'), hg: c3('#7c9160'), lit: c3('#ffffff'), shade: c3('#a9b6cc'), exp: 0.84, haze: 0.8 },
  { t: 18, el: 24, az: 110, zen: c3('#3a70c8'), hor: c3('#d6e0ea'), glow: c3('#ffe6b8'), fogSun: c3('#ffeccc'), ground: c3('#93a07c'), sun: c3('#ffeccb'), sunI: 3.6, hs: c3('#aec6ea'), hg: c3('#8a9468'), lit: c3('#fffaf0'), shade: c3('#a8b0c8'), exp: 0.86, haze: 0.9 },
  { t: 27, el: 14, az: 104, zen: c3('#3f68bc'), hor: c3('#f0d6b4'), glow: c3('#ffd08c'), fogSun: c3('#ffdca6'), ground: c3('#c9b48c'), sun: c3('#ffdca8'), sunI: 3.6, hs: c3('#a8bce4'), hg: c3('#c0a878'), lit: c3('#fff0d6'), shade: c3('#a89cb8'), exp: 0.9, haze: 0.6 },
  { t: 40, el: 8, az: 100, zen: c3('#4563b4'), hor: c3('#f6c690'), glow: c3('#ffb866'), fogSun: c3('#ffc88a'), ground: c3('#d2a884'), sun: c3('#ffc88c'), sunI: 3.4, hs: c3('#9eb0dc'), hg: c3('#c89c74'), lit: c3('#ffe2b8'), shade: c3('#a890ac'), exp: 0.94, haze: 0.5 },
  { t: 1e9, el: 8, az: 100, zen: c3('#4563b4'), hor: c3('#f6c690'), glow: c3('#ffb866'), fogSun: c3('#ffc88a'), ground: c3('#d2a884'), sun: c3('#ffc88c'), sunI: 3.4, hs: c3('#9eb0dc'), hg: c3('#c89c74'), lit: c3('#ffe2b8'), shade: c3('#a890ac'), exp: 0.94, haze: 0.5 },
];
const SKY_FIELDS = Object.keys(SKY_KEYS[0]).filter((k) => k !== 't');
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
export function multAt(t) { return t <= 0 ? 1 : Math.exp(0.06 * t); }
