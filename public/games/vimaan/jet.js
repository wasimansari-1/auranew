/* Vimaan 3D — the NEXORNG business jet, built in code (≈ 50k triangles): lofted fuselage, swept
 * wings with blended winglets, T-tail, rear engines with spinning fans, belly fairing, and real
 * landing gear (struts, oleos, twin wheels, doors) as separate nodes so it folds into the belly.
 * Livery: white clear-coated paint, royal-purple belly and tail, a gold pinstripe, glass with
 * reflections — painted analytically in the shaders (sharp at any distance); the NEXORNG
 * wordmark and the NX mark are our own logo files as decals that follow the curved skin. */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { withFog } from './common.js';
import { AXLE } from './timeline.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ shape functions
// fuselage cross-section at x: centre height c, half-height h, half-width w
export function fus(x) {
  let top = 1.3, bot = -1.3, w = 1.24;
  if (x > 5.2) {
    const t = Math.min(1, (x - 5.2) / 5.3);
    top = -0.38 + 1.68 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.8)));
    bot = -0.38 - 0.92 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.6)));
    w = 1.24 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.0)));
  } else if (x < -3.4) {
    const t = Math.min(1, (-3.4 - x) / 7.2);
    top = 1.3 - 0.48 * Math.pow(t, 1.8);
    bot = -1.3 + 1.6 * Math.pow(t, 1.4);
    w = 1.24 - 1.02 * Math.pow(t, 1.5);
    if (x < -10.6) { // the tail cone closes in a smooth rounded tip (no open end)
      const k = Math.sqrt(Math.max(0, 1 - Math.pow((-10.6 - x) / 0.55, 2)));
      const c = (top + bot) / 2, h = (top - bot) / 2;
      return { c, h: h * k, w: w * k };
    }
  }
  return { c: (top + bot) / 2, h: (top - bot) / 2, w };
}
const X_TAIL = -11.15, X_NOSE = 10.5;
function fusPoint(x, a, out) { // a: 0 = right side, π/2 = top
  const f = fus(x);
  return out.set(x, f.c + f.h * Math.sin(a), f.w * Math.cos(a));
}

// a parametric surface (u, v ∈ [0,1]) → indexed geometry with analytic normals and uv = (u, v)
function surface(fn, nu, nv, opts) {
  opts = opts || {};
  const pos = [], nor = [], uv = [], idx = [], P = new V3(), A = new V3(), B = new V3(), C = new V3(), D = new V3(), du = new V3(), dv = new V3(), n = new V3();
  const e = 1e-4;
  for (let i = 0; i <= nu; i++) {
    const u = opts.umap ? opts.umap(i / nu) : i / nu;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      fn(u, v, P);
      const uc = Math.min(1 - e, Math.max(e, u)), vc = Math.min(1 - e, Math.max(e, v));
      fn(Math.min(1, uc + e), v, A); fn(Math.max(0, uc - e), v, B); du.subVectors(A, B);
      fn(u, Math.min(1, vc + e), C); fn(u, Math.max(0, vc - e), D); dv.subVectors(C, D);
      if (opts.wrapV && (j === 0 || j === nv)) { fn(u, e, C); fn(u, 1 - e, D); dv.subVectors(C, D); }
      n.crossVectors(du, dv);
      if (n.lengthSq() < 1e-14) { // degenerate (a tip): step inward
        fn(Math.min(1 - 4 * e, Math.max(4 * e, u)) + (u > 0.5 ? -4 * e : 4 * e), v, A); n.subVectors(A, P);
        if (opts.tipNormal) opts.tipNormal(u, v, n);
      }
      n.normalize(); if (opts.flip) n.negate();
      pos.push(P.x, P.y, P.z); nor.push(n.x, n.y, n.z);
      uv.push(opts.uvFn ? opts.uvFn(u, v, P, 0) : u, opts.uvFn ? opts.uvFn(u, v, P, 1) : v);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    if (opts.flip) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// NACA 4-digit thickness (closed trailing edge) and a small camber
function thick(xc, th) { const s = Math.sqrt(Math.max(xc, 0)); return 5 * th * (0.2969 * s - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc * xc * xc - 0.1036 * xc * xc * xc * xc); }
function camber(xc, m) { const p = 0.4; return xc < p ? m / (p * p) * (2 * p * xc - xc * xc) : m / ((1 - p) * (1 - p)) * (1 - 2 * p + 2 * p * xc - xc * xc); }
// around the section: v 0 → 0.5 upper surface trailing edge → leading edge, 0.5 → 1 lower surface back
function airfoil(v, th, m, out) {
  const xc = (1 + Math.cos(TAU * v)) / 2, up = v < 0.5 ? 1 : -1;
  out.x = xc; out.y = camber(xc, m) + up * thick(xc, th);
  return out;
}

// A lifting surface swept along a spine in its own plane: spine(L) → {y, z, bend}, chord(L), xLE(L)
function lift(spec) {
  const af = { x: 0, y: 0 };
  return surface((u, v, P) => {
    const L = u * spec.len, s = spec.spine(L), c = spec.chord(L), th = spec.th(L);
    airfoil(v, th, spec.camber || 0, af);
    const nb = s.bend; // thickness direction: "up" rotated by the bend
    const ny = Math.cos(nb), nz = -Math.sin(nb);
    const ty = af.y * c;
    return P.set(spec.xLE(L) - af.x * c, s.y + ny * ty, s.z + nz * ty);
  }, spec.nu, spec.nv, { umap: spec.umap, flip: spec.flip, uvFn: (u, v, P, k) => (k === 0 ? u * spec.len : v) });
}
function mirrorZ(g) {
  const m = g.clone(); m.scale(1, 1, -1);
  const ix = m.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  m.index.needsUpdate = true;
  return m;
}
function cap(geom, ring, center, normal) { // fan-close an open end (tips) — merged later
  const pos = [], nor = [], uv = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    pos.push(center.x, center.y, center.z, a.x, a.y, a.z, b.x, b.y, b.z);
    for (let k = 0; k < 3; k++) { nor.push(normal.x, normal.y, normal.z); uv.push(0, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
function merge(geoms) { // non-indexed merge (small helper; three's BufferGeometryUtils is not vendored)
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; parts.forEach((g) => { n += g.attributes.position.count; });
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), T = new Float32Array(n * 2);
  let o = 0;
  parts.forEach((g) => { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); T.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(T, 2));
  return g;
}

// ------------------------------------------------------------------ materials
const C = {
  white: new THREE.Color('#f3f2f5'),
  purple: new THREE.Color('#4a228f'),
  gold: new THREE.Color('#d6a84a'),
  glass: new THREE.Color('#070910'),
  dark: new THREE.Color('#131318'),
  metal: new THREE.Color('#c9cdd3'),
  grey: new THREE.Color('#8d9096'),
};

export const RIM = { value: new THREE.Color(0.2, 0.15, 0.12) }; // a soft rim on the silhouette (set from the sky each frame)
const GLSL_LIVERY_COMMON = /* glsl */`
varying vec3 vObj; varying vec2 vP;
float band(float d, float a, float b) { float w = fwidth(d) * 0.75 + 1e-4; return smoothstep(a - w, a + w, d) * (1.0 - smoothstep(b - w, b + w, d)); }
float sdRBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float inside(float sd) { float w = fwidth(sd) * 0.75 + 1e-4; return 1.0 - smoothstep(-w, w, sd); }
uniform vec3 lvRim; uniform vec3 lvWhite; uniform vec3 lvPurple; uniform vec3 lvGold; uniform vec3 lvGlass; uniform vec3 lvDark; uniform vec3 lvMetal;
`;

// one physical material with a shader-painted livery; `paint` is GLSL that sets col/rough/metal/cc
function liveryMaterial(paint, opts) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1, side: opts && opts.side || THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lvWhite = { value: C.white }; sh.uniforms.lvPurple = { value: C.purple }; sh.uniforms.lvGold = { value: C.gold };
    sh.uniforms.lvRim = RIM;
    sh.uniforms.lvGlass = { value: C.glass }; sh.uniforms.lvDark = { value: C.dark }; sh.uniforms.lvMetal = { value: C.metal };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec2 vP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vP = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_LIVERY_COMMON)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 col = lvWhite; float rough = 0.3, metal = 0.0, cc = 1.0;
        ${paint}
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metal;')
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>')
      .replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * cc;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += lvRim * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0); // crisp silhouette');
  };
  m.customProgramCacheKey = () => 'livery:' + paint; // each paint is its own program
  return withFog(m);
}

// fuselage + belly fairing: vObj = object position, vP = (x, angle)
const PAINT_BODY = /* glsl */`
  float x = vObj.x, y = vObj.y, z = vObj.z;
  // cheat line: low along the cabin, sweeping up the tail cone into the purple fin, a lift at the nose
  float yl = -0.36 + 1.0 * smoothstep(-2.8, -9.2, x) + 0.16 * smoothstep(6.2, 10.0, x);
  float d = y - yl;
  float pw = fwidth(d) * 0.75 + 1e-4;
  float purple = 1.0 - smoothstep(-pw, pw, d);
  col = mix(col, lvPurple, purple); rough = mix(rough, 0.36, purple); metal = mix(metal, 0.1, purple);
  float g = band(d, 0.06, 0.095) + band(d, 0.125, 0.138) * 0.0;
  col = mix(col, lvGold, g); metal = mix(metal, 1.0, g); rough = mix(rough, 0.28, g);
  // cabin windows (6 a side)
  if (abs(z) > 0.55 && x > -1.2 && x < 5.2) {
    float k = clamp(floor((4.55 - x) / 0.98 + 0.5), 0.0, 5.0), cx = 4.55 - k * 0.98;
    float wi = inside(sdRBox(vec2(x - cx, y - 0.3), vec2(0.16, 0.205), 0.14));
    float fr = inside(sdRBox(vec2(x - cx, y - 0.3), vec2(0.19, 0.235), 0.16)) - wi;
    col = mix(col, vec3(0.62, 0.63, 0.66), fr * 0.6);
    col = mix(col, lvGlass, wi); rough = mix(rough, 0.04, wi); metal = mix(metal, 0.0, wi);
  }
  // cockpit: windscreen + side windows in (x, angle) space
  float a = vP.y; // 0 right side, pi/2 top, pi left
  float sa = abs(a - 1.5707963); // 0 on top, pi/2 at the sides
  if (x > 7.1 && x < 9.4) {
    float ws = inside(max(max(sa - (0.92 - (x - 8.1) * 0.18), x - 9.15 + sa * 0.15), 8.12 - x + sa * 0.10)) ;
    float mid = 1.0 - band(sa, -1.0, 0.018); // centre post
    ws *= mid;
    float post = inside(abs(sa - 0.5) - 0.025);
    ws *= 1.0 - post;
    float sw = inside(max(max(abs(sa - 1.02) - 0.17 + (x - 7.6) * 0.06, abs(x - 7.62) - 0.36), 0.0));
    float glass = max(ws, sw);
    col = mix(col, lvGlass, glass); rough = mix(rough, 0.03, glass); metal = mix(metal, 0.0, glass);
  }
  // panel lines: frames round the cabin, a lap joint along each side, the radome and the tail-cone joints
  float pl = 0.0;
  if (x > -3.4 && x < 5.4) pl += band(abs(fract((x + 0.3) / 1.16) - 0.5), 0.494, 0.5) * 0.6;
  pl += band(abs(y - 0.95), -1.0, 0.006) * step(-3.0, x) * step(x, 6.2) * 0.5;
  pl += band(x, 9.55, 9.565) + band(x, -3.4, -3.388) * 0.7 + band(x, -7.6, -7.588) * 0.7 + band(x, 6.6, 6.612) * 0.6;
  col *= 1.0 - 0.22 * clamp(pl, 0.0, 1.0) * (1.0 - purple * 0.4);
  // right-side over-wing emergency exit outline
  if (z > 0.6 && x > 0.3 && x < 1.5) { float de = abs(sdRBox(vec2(x - 0.91, y - 0.28), vec2(0.36, 0.5), 0.1)); col *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.01 + fwidth(de), de)); }
  // main entry door outline (left side) + gear wells (dark when the doors are open)
  if (z < -0.6 && x > 5.0 && x < 6.1) { float dd = abs(sdRBox(vec2(x - 5.55, y - 0.0), vec2(0.43, 0.88), 0.12)); col *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.012 + fwidth(dd), dd)); }
  float wellM = inside(sdRBox(vec2(x + 1.8, abs(z) - 0.74), vec2(0.6, 0.47), 0.12)) * step(y, -1.15);
  float wellN = inside(sdRBox(vec2(x - 7.75, z), vec2(0.88, 0.27), 0.08)) * step(y, -0.7);
  float well = max(wellM, wellN);
  col = mix(col, vec3(0.05, 0.05, 0.06), well); rough = mix(rough, 0.85, well); cc = 1.0 - well;
`;

// wings / stabiliser: vP = (L along the spine in m, v around the section); lenW = where the winglet starts
function paintWing(lenW, purpleTips) { return /* glsl */`
  float L = vP.x, v = vP.y;
  float xc = 0.5 + 0.5 * cos(6.2831853 * v);
  float le = 1.0 - smoothstep(0.03, 0.05, xc);
  col = mix(col, lvMetal, le); metal = mix(metal, 1.0, le); rough = mix(rough, 0.32, le); cc = 1.0 - le * 0.7;
  // control-surface lines (flaps, ailerons, spoilers)
  float ln = band(xc, 0.715, 0.722) * step(${(0.9).toFixed(2)}, L) * step(L, ${(lenW - 0.25).toFixed(2)});
  ln += band(L, 5.6, 5.63) * step(0.72, xc) + band(L, 7.7, 7.73) * step(0.72, xc);
  ln += band(xc, 0.55, 0.556) * step(v, 0.5) * step(2.0, L) * step(L, 5.6);
  col *= 1.0 - 0.45 * clamp(ln, 0.0, 1.0);
  ${purpleTips ? `float tip = smoothstep(${(lenW - 0.05).toFixed(2)}, ${(lenW + 0.15).toFixed(2)}, L);
  col = mix(col, lvPurple, tip * (1.0 - le)); metal = mix(metal, 0.25, tip * (1.0 - le));
  float gt = band(L, ${(lenW - 0.12).toFixed(2)}, ${(lenW - 0.06).toFixed(2)});
  col = mix(col, lvGold, gt); metal = mix(metal, 1.0, gt);` : ''}
`; }
const PAINT_FIN = /* glsl */`
  float L = vP.x, v = vP.y;
  float xc = 0.5 + 0.5 * cos(6.2831853 * v);
  col = lvPurple; metal = 0.1; rough = 0.36;
  float le = 1.0 - smoothstep(0.025, 0.045, xc);
  col = mix(col, lvMetal, le); metal = mix(metal, 1.0, le); rough = mix(rough, 0.3, le);
  float g = band(xc, 0.07, 0.085) * step(0.15, L);
  col = mix(col, lvGold, g); metal = mix(metal, 1.0, g); rough = mix(rough, 0.26, g);
  float rud = band(xc, 0.70, 0.707) * step(0.35, L) * (1.0 - step(0.75, L) * step(L, 1.9)); // the hinge line stops short of the NX
  col *= 1.0 - 0.4 * rud;
`;
const PAINT_NACELLE = /* glsl */`
  // vP.x = 0 lip .. 1 exhaust along the nacelle (from the lathe), vP.y = around
  float s = vP.y;
  float lip = 1.0 - smoothstep(0.035, 0.06, s);
  col = mix(col, lvMetal, lip); metal = mix(metal, 1.0, lip); rough = mix(rough, 0.18, lip); cc = 1.0 - lip;
  float inner = step(0.985, s);
  float ex = smoothstep(0.935, 0.95, s); // the exhaust collar: polished metal, part of a finished nacelle
  col = mix(col, lvMetal, ex); metal = mix(metal, 1.0, ex); rough = mix(rough, 0.22, ex); cc *= 1.0 - ex;
  float g = band(s, 0.80, 0.815);
  col *= 1.0 - 0.28 * (band(s, 0.285, 0.29) + band(s, 0.6, 0.605)); // cowl panel joints
  col = mix(col, lvGold, g); metal = mix(metal, 1.0, g);
`;

// ------------------------------------------------------------------ the jet
export function buildJet(opts) {
  const jet = new THREE.Group(); jet.name = 'jet';
  const body = new THREE.Group(); jet.add(body); // everything rigid
  const bodyMat = liveryMaterial(PAINT_BODY);

  // fuselage: denser rings at the nose and tail; angle seam at the bottom
  const fuseGeom = surface((u, v, P) => {
    const x = X_TAIL + (X_NOSE - X_TAIL) * u, a = -Math.PI / 2 + TAU * v;
    return fusPoint(x, a, P);
  }, 150, 64, {
    umap: (s) => { const k = 0.5 - 0.5 * Math.cos(Math.PI * s); return 0.55 * s + 0.45 * k; },
    uvFn: (u, v, P, k) => (k === 0 ? P.x : -Math.PI / 2 + TAU * v), wrapV: true,
    tipNormal: (u, v, n) => { n.set(u > 0.5 ? 1 : -1, 0, 0); },
  });
  body.add(new THREE.Mesh(fuseGeom, bodyMat));
  // tail-cone end (APU exhaust)
  // the closed tail cone ends in a tiny flush satin-metal APU tip (no cavity)
  const fe = fus(-10.6);
  const apuTip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 12), withFog(new THREE.MeshStandardMaterial({ color: 0xc4c6cb, metalness: 0.85, roughness: 0.3 })));
  apuTip.scale.set(0.8, 1, 1); apuTip.position.set(X_TAIL + 0.03, fe.c, 0); body.add(apuTip);

  // belly fairing (wing-to-body): an ellipsoid with the same livery (angle in vP.y)
  const FC = { x: -0.6, y: -1.0, rx: 3.8, ry: 0.5, rz: 1.4 };
  const fairGeom = surface((u, v, P) => {
    const th = Math.PI * u, ph = -Math.PI / 2 + TAU * v; // th: along x (0 = rear)
    const sx = -Math.cos(th), r = Math.sin(th);
    return P.set(FC.x + FC.rx * sx, FC.y + FC.ry * r * Math.sin(ph), FC.rz * r * Math.cos(ph));
  }, 48, 40, { uvFn: (u, v, P, k) => (k === 0 ? P.x : -Math.PI / 2 + TAU * v), wrapV: true, tipNormal: (u, v, n) => { n.set(u > 0.5 ? 1 : -1, 0, 0); } });
  body.add(new THREE.Mesh(fairGeom, bodyMat));

  // wings with blended winglets (one loft along a bending spine)
  const W = { root: 1.95, y0: -0.93, dih: 4 * Math.PI / 180, sweep: Math.tan(27 * Math.PI / 180), lw: 10.0, R: 0.42, bendA: 80 * Math.PI / 180, wl: 1.15 };
  const arc = W.R * W.bendA, wingLen = W.lw + arc + W.wl;
  const wingSpine = (L) => {
    if (L <= W.lw) return { y: W.y0 + L * Math.sin(W.dih), z: L * Math.cos(W.dih), bend: W.dih };
    const ty = W.y0 + W.lw * Math.sin(W.dih), tz = W.lw * Math.cos(W.dih);
    if (L <= W.lw + arc) {
      const b = (L - W.lw) / W.R; // bend angle so far
      const a0 = W.dih, a1 = W.dih + b;
      // circle centre above the tip
      const cy = ty + W.R * Math.cos(a0), cz = tz - W.R * Math.sin(a0);
      return { y: cy - W.R * Math.cos(a1), z: cz + W.R * Math.sin(a1), bend: a1 };
    }
    const a1 = W.dih + W.bendA, cy = ty + W.R * Math.cos(W.dih), cz = tz - W.R * Math.sin(W.dih);
    const by = cy - W.R * Math.cos(a1), bz = cz + W.R * Math.sin(a1), s = L - W.lw - arc;
    return { y: by + s * Math.sin(a1), z: bz + s * Math.cos(a1), bend: a1 };
  };
  const wingChord = (L) => (L <= W.lw ? 4.3 - (4.3 - 1.25) * (L / W.lw) : L <= W.lw + arc ? 1.25 - 0.1 * (L - W.lw) / arc : 1.15 - 0.7 * (L - W.lw - arc) / W.wl);
  const wingXLE = (L) => (L <= W.lw ? W.root - L * W.sweep : W.root - W.lw * W.sweep - (L - W.lw) * 0.62 - (L > W.lw + arc ? (L - W.lw - arc) * 0.25 : 0));
  const wingTh = (L) => (L <= W.lw ? 0.155 - 0.05 * L / W.lw : 0.095);
  const wingSpec = { len: wingLen, spine: wingSpine, chord: wingChord, xLE: wingXLE, th: wingTh, camber: 0.018, nu: 46, nv: 44,
    umap: (s) => { const L = s * wingLen; return L; } };
  // spine samples: finer through the bend
  wingSpec.umap = (s) => {
    const k1 = 26 / 46, k2 = 38 / 46;
    const L = s < k1 ? (s / k1) * W.lw : s < k2 ? W.lw + ((s - k1) / (k2 - k1)) * arc : W.lw + arc + ((s - k2) / (1 - k2)) * W.wl;
    return L / wingLen;
  };
  const wingR = lift(wingSpec);
  const wingMat = liveryMaterial(paintWing(W.lw, true));
  body.add(new THREE.Mesh(wingR, wingMat), new THREE.Mesh(mirrorZ(wingR), wingMat));
  // winglet tip caps
  {
    const ring = [], af = { x: 0, y: 0 }, L = wingLen, s = wingSpine(L), c = wingChord(L);
    for (let j = 0; j < 20; j++) { airfoil(j / 20, wingTh(L), 0.018, af); ring.push(new V3(wingXLE(L) - af.x * c, s.y + Math.cos(s.bend) * af.y * c, s.z - Math.sin(s.bend) * af.y * c)); }
    const ctr = ring.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / ring.length);
    const nrm = new V3(0, Math.sin(s.bend), Math.cos(s.bend));
    const g = cap(null, ring, ctr, nrm);
    const capMat = withFog(new THREE.MeshPhysicalMaterial({ color: C.purple, roughness: 0.34, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }));
    const gm = g.clone(); gm.scale(1, 1, -1); const p = gm.attributes.position.array; for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
    const nn = gm.attributes.normal.array; for (let i = 2; i < nn.length; i += 3) nn[i] = -nn[i];
    body.add(new THREE.Mesh(g, capMat), new THREE.Mesh(gm, capMat));
  }

  // vertical fin (purple) — spine straight up, swept
  const FIN = { x0: -5.25, y0: 0.9, h: 3.55, sweep: 0.92 };
  const finSpec = { len: FIN.h, spine: (L) => ({ y: FIN.y0 + L, z: 0, bend: -Math.PI / 2 }), chord: (L) => 3.8 - 1.65 * L / FIN.h, xLE: (L) => FIN.x0 - L * FIN.sweep, th: () => 0.11, nu: 18, nv: 40 };
  // bend -π/2 → thickness along +z; spine along +y
  finSpec.flip = true;
  const finGeom = lift(finSpec);
  const finMat = liveryMaterial(PAINT_FIN);
  body.add(new THREE.Mesh(finGeom, finMat));
  // T-tail horizontal stabiliser (white, purple tips) on top of the fin
  const ST = { x0: FIN.x0 - FIN.h * FIN.sweep + 0.05, y0: FIN.y0 + FIN.h - 0.12, span: 3.45, sweep: Math.tan(30 * Math.PI / 180) };
  const stSpec = { len: ST.span, spine: (L) => ({ y: ST.y0 - L * 0.03, z: L, bend: -0.03 }), chord: (L) => 2.05 - 1.1 * L / ST.span, xLE: (L) => ST.x0 - L * ST.sweep, th: () => 0.1, nu: 16, nv: 36 };
  const stGeom = lift(stSpec), stMat = liveryMaterial(paintWing(ST.span - 0.35, true));
  body.add(new THREE.Mesh(stGeom, stMat), new THREE.Mesh(mirrorZ(stGeom), stMat));
  // fin-top bullet fairing
  const bullet = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), finMat);
  bullet.scale.set(1.35, 0.17, 0.17); bullet.position.set(ST.x0 - 0.85, ST.y0 + 0.02, 0);
  bullet.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(bullet.geometry.attributes.position.count * 2).fill(0.25), 2));
  body.add(bullet);
  // stabiliser tip caps (closed with small spheres)
  // engines: lathe nacelles (lip → outer → exhaust; inner duct back to the fan)
  const nacPts = [];
  const NL = 3.25, NR = 0.6;
  // outer surface from exhaust (s≈1) to lip (s≈0) — LatheGeometry wants (r, y): y = axial
  const prof = [];
  for (let i = 0; i <= 40; i++) { // outer: axial 0 (lip) .. NL (exhaust)
    const t = i / 40, ax = t * NL;
    const r = t < 0.28 ? 0.5 + 0.1 * Math.sin((t / 0.28) * Math.PI / 2) : 0.6 - 0.15 * Math.pow((t - 0.28) / 0.72, 1.6);
    prof.push([r, ax, t]);
  }
  // lip roundel + inner duct to the fan face
  const lip = [];
  for (let i = 1; i <= 8; i++) { const a = Math.PI / 2 + (i / 8) * Math.PI; lip.push([0.475 + 0.028 * Math.cos(a) + 0.0, -0.028 * Math.sin(a) * 1.4 + 0.035, 0]); }
  // build points in order: exhaust → lip outer → lip roundel → inner duct
  for (let i = prof.length - 1; i >= 0; i--) nacPts.push(prof[i]);
  lip.forEach((p) => nacPts.push(p));
  nacPts.push([0.455, 0.25, 0], [0.445, 0.42, 0]);
  const lpts = nacPts.map((p) => new THREE.Vector2(p[0], -p[1]));
  const nacGeom = new THREE.LatheGeometry(lpts, 48);
  // uv.y along the profile (0 exhaust → 1 inner); re-map so the shader gets s: 0 = lip … 1 = inner
  {
    const uvs = nacGeom.attributes.uv.array, P = nacGeom.attributes.position.array, cnt = nacGeom.attributes.position.count;
    for (let i = 0; i < cnt; i++) {
      const y = -P[i * 3 + 1], r = Math.hypot(P[i * 3], P[i * 3 + 2]);
      const innerSide = y < 0.45 && r < 0.476 ? 1 : 0;
      const s = innerSide ? 0.99 + 0.01 * Math.min(1, y / 0.42) : y < 0.04 ? 0.02 : 0.04 + 0.95 * (y / NL);
      uvs[i * 2] = 0; uvs[i * 2 + 1] = innerSide ? 0.99 : Math.min(0.97, s);
    }
  }
  nacGeom.rotateZ(-Math.PI / 2); // lathe axis (−y) → −x: the lip at x = 0 (front), the exhaust at −NL (rear)
  const nacMat = liveryMaterial(PAINT_NACELLE, { side: THREE.DoubleSide });
  const fanTex = fanTexture();
  const fanMat = withFog(new THREE.MeshStandardMaterial({ map: fanTex, color: 0xffffff, metalness: 0.45, roughness: 0.35, emissive: 0xffffff, emissiveMap: fanTex, emissiveIntensity: 0.22 }));
  // exhaust: a polished nozzle ring, a satin-metal nozzle (dark grey inside, never a black hole), the turbine cone
  const coneMat = withFog(new THREE.MeshStandardMaterial({ color: 0xb9b5ae, metalness: 0.55, roughness: 0.3, emissive: 0x2a2826 }));
  const nozzleMat = withFog(new THREE.MeshStandardMaterial({ color: 0xa29e97, metalness: 0.25, roughness: 0.45, side: THREE.DoubleSide, emissive: 0x24221f }));
  const ringMat = withFog(new THREE.MeshStandardMaterial({ color: 0xdcdee3, metalness: 1, roughness: 0.16 }));
  const backMat = withFog(new THREE.MeshStandardMaterial({ color: 0x86827b, metalness: 0.3, roughness: 0.5, emissive: 0x1c1b19 }));
  const fans = [];
  const pylonMat = liveryMaterial(paintWing(99, false));
  [-1, 1].forEach((side) => {
    const g = new THREE.Group();
    g.position.set(-4.85, 0.64, side * 2.06);
    g.rotation.y = side * 0.035; // slight toe-in
    const n = new THREE.Mesh(nacGeom, nacMat); g.add(n);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.445, 40).rotateY(Math.PI / 2), fanMat); fan.userData.dyn = true;
    fan.position.x = -0.42; g.add(fan); fans.push(fan);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 24).rotateZ(-Math.PI / 2), withFog(new THREE.MeshStandardMaterial({ color: 0xd8d8dc, metalness: 1, roughness: 0.2 })));
    spinner.position.x = -0.3; g.add(spinner);
    const plug = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.72, 32, 1, false).rotateZ(Math.PI / 2), coneMat);
    plug.position.x = -NL + 0.1; g.add(plug);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.405, 0.43, 0.56, 40, 1, true).rotateZ(Math.PI / 2), nozzleMat);
    nozzle.position.x = -NL + 0.28; g.add(nozzle);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.428, 0.027, 12, 56).rotateY(Math.PI / 2), ringMat);
    ring.position.x = -NL + 0.006; g.add(ring);
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.41, 40).rotateY(-Math.PI / 2), backMat); back.position.x = -NL + 0.56; g.add(back); // turbine face (no see-through)
    body.add(g);
    // pylon (short swept airfoil from the fuselage into the nacelle)
    // pylon: a thick swept fairing from deep inside the fuselage to deep inside the nacelle (no gap from any angle)
    const py = lift({ len: 1.45, spine: (L) => ({ y: 0.63, z: side * (0.45 + L), bend: 0 }), chord: (L) => 2.5 - 0.25 * L, xLE: (L) => -5.3 - L * 0.22, th: () => 0.19, nu: 6, nv: 28, flip: side < 0 });
    body.add(new THREE.Mesh(py, pylonMat));
  });

  // ------------------------------------------------------------ landing gear
  const strutMat = withFog(new THREE.MeshStandardMaterial({ color: 0x9da1a8, metalness: 0.7, roughness: 0.4 }));
  const chromeMat = withFog(new THREE.MeshStandardMaterial({ color: 0xe6e8ec, metalness: 1, roughness: 0.12 }));
  const tireMat = withFog(new THREE.MeshStandardMaterial({ color: 0x18181a, metalness: 0, roughness: 0.92 }));
  const hubMat = withFog(new THREE.MeshStandardMaterial({ color: 0xbfc3c9, metalness: 0.9, roughness: 0.3 }));
  const doorMat = bodyMat;

  function wheelPair(r, w, gap) { // twin tyres + hubs on one axle (axis along z): two meshes
    const pts = [];
    for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + Math.PI * i / 12; pts.push(new THREE.Vector2(r * 0.62 + (r * 0.38) * Math.cos(a) * 0.98, (w / 2) * Math.sin(a))); }
    const tires = [], hubs = [];
    [-1, 1].forEach((k) => {
      tires.push(new THREE.LatheGeometry(pts, 32).rotateX(Math.PI / 2).translate(0, 0, k * gap));
      hubs.push(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 0.92, 24).rotateX(Math.PI / 2).translate(0, 0, k * gap));
      for (let j = 0; j < 6; j++) { // lug bolts: show the spin
        const a = j * TAU / 6;
        hubs.push(new THREE.BoxGeometry(r * 0.12, r * 0.12, w * 0.98).translate(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, k * gap));
        hubs.push(new THREE.BoxGeometry(r * 0.5, r * 0.06, w * 0.95).rotateZ(a + 0.5).translate(0, 0, k * gap)); // spokes
      }
    });
    const g = new THREE.Group(); g.userData.dyn = true;
    g.add(new THREE.Mesh(merge(tires), tireMat), new THREE.Mesh(merge(hubs), hubMat));
    return g;
  }
  function cyl(r, len, mat) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat); return m; }

  const gear = { mains: [], nose: null, mainDoors: [], noseDoors: [], wheels: [], noseWheels: [] };
  const MAIN = { x: AXLE[0], pivotY: -1.0, z: 1.66, len: AXLE[1] - -1.0 };
  [-1, 1].forEach((side) => {
    const pivot = new THREE.Group(); pivot.position.set(MAIN.x, MAIN.pivotY, side * MAIN.z);
    const L = MAIN.len; // axle below the pivot (negative)
    const upper = cyl(0.085, 0.6, strutMat); upper.position.y = -0.3; pivot.add(upper);
    const oleo = new THREE.Group(); oleo.userData.dyn = true; pivot.add(oleo); // slides with the oleo extension
    const lower = cyl(0.062, 0.42, chromeMat); lower.position.y = L + 0.33; oleo.add(lower);
    const axle = new THREE.Group(); axle.position.y = L; oleo.add(axle);
    const ax = cyl(0.05, 0.5, strutMat); ax.rotation.x = Math.PI / 2; axle.add(ax);
    const wp = wheelPair(0.38, 0.19, 0.15); axle.add(wp); gear.wheels.push(wp);
    // torque links
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.04), strutMat); tl.position.set(0.11, L + 0.38, 0); tl.rotation.z = 0.35; oleo.add(tl);
    const tl2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.04), strutMat); tl2.position.set(0.11, -0.55, 0); tl2.rotation.z = -0.35; pivot.add(tl2);
    // side brace
    const br = cyl(0.03, 0.75, strutMat); br.position.set(0, -0.32, -side * 0.28); br.rotation.x = side * 0.62; pivot.add(br);
    // leg door (rides with the strut), on its outboard side
    const ld = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.025), doorMat); ld.position.set(0, -0.38, side * 0.13);
    ld.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ld.geometry.attributes.position.count * 2).fill(0), 2));
    pivot.add(ld);
    pivot.userData.dyn = true; body.add(pivot);
    gear.mains.push({ pivot, oleo, side });
    // wheel-well door: a patch of the fairing's bottom, hinged at its inboard edge
    const hingeZ = 0.27, doorG = surface((u, v, P) => {
      const x = -2.38 + 1.16 * u, z = hingeZ + 0.95 * v;
      const sx = (x - FC.x) / FC.rx, sz = z / FC.rz, q = Math.max(0, 1 - sx * sx - sz * sz);
      return P.set(x, FC.y - FC.ry * Math.sqrt(q) - 0.012, side * z);
    }, 6, 8, { flip: side < 0, uvFn: (u, v, P, k) => (k === 0 ? P.x : -Math.PI / 2) });
    // re-centre on the hinge so it can rotate
    const hy = FC.y - FC.ry * Math.sqrt(Math.max(0, 1 - Math.pow((-1.8 - FC.x) / FC.rx, 2) - Math.pow(hingeZ / FC.rz, 2))) - 0.012;
    doorG.translate(0, -hy, -side * hingeZ);
    const dh = new THREE.Group(); dh.position.set(0, hy, side * hingeZ); dh.userData.dyn = true;
    const dm = new THREE.Mesh(doorG, new THREE.MeshPhysicalMaterial()); dm.material = doorMat; dh.add(dm);
    body.add(dh);
    gear.mainDoors.push({ hinge: dh, side });
  });
  // nose gear
  {
    const pivot = new THREE.Group(); pivot.position.set(7.2, -0.85, 0);
    const len = 1.23;
    const upper = cyl(0.07, 0.7, strutMat); upper.position.y = -0.35; pivot.add(upper);
    const lower = cyl(0.052, 0.45, chromeMat); lower.position.y = -len + 0.3; pivot.add(lower);
    const axle = new THREE.Group(); axle.position.y = -len; pivot.add(axle);
    const ax = cyl(0.035, 0.36, strutMat); ax.rotation.x = Math.PI / 2; axle.add(ax);
    const wp = wheelPair(0.27, 0.15, 0.12); axle.add(wp); gear.noseWheels.push(wp);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.035), strutMat); tl.position.set(-0.09, -len + 0.32, 0); tl.rotation.z = -0.3; pivot.add(tl);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12).rotateZ(Math.PI / 2), chromeMat); lamp.position.set(0.09, -0.55, 0); pivot.add(lamp);
    pivot.userData.dyn = true; body.add(pivot);
    gear.nose = { pivot };
    [-1, 1].forEach((side) => { // two long doors, hinged at their outer edges
      const hz = 0.27;
      const g = surface((u, v, P) => {
        const x = 6.87 + 1.76 * u, a = -Math.PI / 2 + side * (v * 0.24);
        const f = fus(x); P.set(x, f.c + f.h * Math.sin(a) - 0.012, f.w * Math.cos(a) * 1.0);
        return P;
      }, 10, 3, { flip: side < 0, uvFn: (u, v, P, k) => (k === 0 ? P.x : -Math.PI / 2) });
      const fm = fus(7.75), ha = -Math.PI / 2 + side * 0.24;
      const hy = fm.c + fm.h * Math.sin(ha), hzz = fm.w * Math.cos(ha) * side;
      g.translate(0, -hy, -hzz);
      const h = new THREE.Group(); h.position.set(0, hy, hzz); h.userData.dyn = true;
      h.add(new THREE.Mesh(g, doorMat)); body.add(h);
      gear.noseDoors.push({ hinge: h, side });
    });
  }

  // ------------------------------------------------------------ lights (points; flashing in the shader)
  // kind: 0 steady nav, 1 strobe (double flash), 2 beacon (red), 3 landing/taxi (gear down)
  const wt = wingSpine(W.lw + arc * 0.15), wtx = wingXLE(W.lw);
  const L = [
    [wtx - 0.2, wt.y, wt.z + 0.05, 1, 0.12, 0.1, 0.9, 0], // right nav (green)
    [wtx - 0.2, wt.y, -wt.z - 0.05, 1, 0.1, 0.06, 0.9, 0], // left nav (red) — colours fixed below
    [wtx - 0.9, wt.y, wt.z + 0.08, 1, 1, 1, 1.2, 1],
    [wtx - 0.9, wt.y, -wt.z - 0.08, 1, 1, 1, 1.2, 1],
    [X_TAIL - 0.05, fe.c + 0.02, 0, 1, 1, 1, 0.6, 1],
    [-1.2, 1.33, 0, 1, 0.12, 0.08, 0.8, 2],
    [-0.6, -1.45, 0, 1, 0.12, 0.08, 0.8, 2],
    [7.33, -1.42, 0, 1, 0.95, 0.85, 1.4, 3],
    [1.2, -0.98, 1.0, 1, 0.95, 0.85, 1.0, 3],
    [1.2, -0.98, -1.0, 1, 0.95, 0.85, 1.0, 3],
  ];
  L[0].splice(3, 3, 0.1, 1, 0.35); L[1].splice(3, 3, 1, 0.08, 0.06);
  const lp = new Float32Array(L.length * 3), lc = new Float32Array(L.length * 3), ls = new Float32Array(L.length), lk = new Float32Array(L.length);
  L.forEach((l, i) => { lp.set(l.slice(0, 3), i * 3); lc.set(l.slice(3, 6), i * 3); ls[i] = l[6]; lk[i] = l[7]; });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  lg.setAttribute('size', new THREE.BufferAttribute(ls, 1));
  lg.setAttribute('kind', new THREE.BufferAttribute(lk, 1));
  const lights = new THREE.Points(lg, opts.lightMaterial);
  lights.frustumCulled = false; lights.renderOrder = 5;
  body.add(lights);

  // ------------------------------------------------------------ logos (decals on the curved skin)
  const decals = [];
  const decalMats = new Map();
  function decalMat(tex, metal) {
    if (!decalMats.has(tex)) { // printed logos: soft clear-coat so their colours hold at grazing angles
      const m = new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.15, envMapIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
      m.onBeforeCompile = (sh) => { // a slightly sharper mip choice for the logos (filtering only, no post blur)
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n vec4 sampledDiffuseColor = texture( map, vMapUv, -0.6 );\n diffuseColor *= sampledDiffuseColor;\n#endif');
      };
      m.customProgramCacheKey = () => 'decal-sharp';
      decalMats.set(tex, withFog(m));
    }
    return decalMats.get(tex);
  }
  function fuseDecal(tex, x0, x1, a0, a1, side) { // side +1 right, −1 left; reads nose→tail on the left, tail→nose on the right
    const g = surface((u, v, P) => {
      const x = x0 + (x1 - x0) * u, a = a0 + (a1 - a0) * v;
      const f = fus(x), n = 0.012;
      return P.set(x, f.c + (f.h + n) * Math.sin(a), side * (f.w + n) * Math.cos(a));
    }, 24, 6, { flip: side < 0, uvFn: (u, v, P, k) => (k === 0 ? (side > 0 ? u : 1 - u) : v) });
    const mesh = new THREE.Mesh(g, decalMat(tex, 0.1)); mesh.renderOrder = 2; body.add(mesh); decals.push(mesh);
  }
  function finDecal(tex, side) { // a patch of the fin's side, uv from x / height (no shear)
    const xs = [-9.0, -7.1], ys = [1.75, 2.7];
    const g = surface((u, v, P) => {
      const x = xs[0] + (xs[1] - xs[0]) * u, y = ys[0] + (ys[1] - ys[0]) * v;
      const L = y - FIN.y0, xle = FIN.x0 - L * FIN.sweep, c = 3.8 - 1.65 * L / FIN.h;
      const xc = Math.min(1, Math.max(0, (xle - x) / c));
      return P.set(x, y, side * (thick(xc, 0.11) * c + 0.01));
    }, 16, 8, { flip: side < 0, uvFn: (u, v, P, k) => (k === 0 ? (side > 0 ? u : 1 - u) : v) });
    const mesh = new THREE.Mesh(g, decalMat(tex, 0.15)); mesh.renderOrder = 2; body.add(mesh); decals.push(mesh);
  }
  if (opts.wordmark) {
    // above the cabin windows, 0.55 m tall
    const fm = fus(1), a0 = Math.asin((0.56 - fm.c) / fm.h), a1 = Math.asin((1.14 - fm.c) / fm.h);
    const len = 0.62 * opts.wordmarkAspect; // ≈ the arc height × the texture's aspect
    const xc = 2.7;
    fuseDecal(opts.wordmark, xc - len / 2, xc + len / 2, a0, a1, 1);
    fuseDecal(opts.wordmark, xc - len / 2, xc + len / 2, a0, a1, -1);
  }
  if (opts.mark) { finDecal(opts.mark, 1); finDecal(opts.mark, -1); }

  // ------------------------------------------------------------ per-frame pose
  const D = { main: 87 * Math.PI / 180, nose: 96 * Math.PI / 180, mainDoor: 92 * Math.PI / 180, noseDoor: 85 * Math.PI / 180 };
  function pose(st, time) {
    const f = st.fold, dr = st.doors;
    // main gear swings inboard (about x), nose gear forward (about z)
    gear.mains.forEach((m) => { m.pivot.rotation.x = m.side * f * D.main; m.oleo.position.y = -st.oleo * (1 - f); });
    gear.nose.pivot.rotation.z = f * D.nose;
    gear.mainDoors.forEach((d) => { d.hinge.rotation.x = d.side * dr * D.mainDoor; });
    gear.noseDoors.forEach((d) => { d.hinge.rotation.x = -d.side * dr * D.noseDoor; });
    for (let i = 0; i < gear.wheels.length; i++) gear.wheels[i].rotation.z = -st.spin;
    for (let i = 0; i < gear.noseWheels.length; i++) gear.noseWheels[i].rotation.z = -st.noseSpin;
    // fans: idle → take-off thrust
    const rpm = st.airborne || st.thrust ? 6 : 2.5; // ≤ 0.1 rad a frame: the blurred blades read as spinning, never strobing
    for (let i = 0; i < fans.length; i++) fans[i].rotation.x = -time * rpm;
    lights.material.uniforms.uGearDown.value = 1 - f;
  }

  // fewer draw calls: merge every rigid part by material (body; each strut's fixed pieces)
  mergeStatic(body);
  gear.mains.forEach((m) => { mergeStatic(m.pivot); mergeStatic(m.oleo); });
  mergeStatic(gear.nose.pivot);

  // triangles (for the budget check)
  let tris = 0;
  jet.traverse((o) => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  jet.userData.triangles = Math.round(tris);
  jet.userData.pose = pose;
  jet.userData.body = body;
  jet.userData.lights = lights;
  return jet;
}

// fan face: blades + dark hub (canvas, once)
function fanTexture() {
  // fan face, already motion-blurred along the spin (no wagon-wheel strobing at 60 fps); mid-grey metal, never black
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#55575d'; g.fillRect(0, 0, 512, 512);
  g.translate(256, 256);
  const N = 22, SMEAR = 9;
  for (let i = 0; i < N; i++) for (let k = 0; k < SMEAR; k++) {
    g.save(); g.rotate(i * TAU / N + (k / (SMEAR - 1) - 0.5) * 0.16);
    g.globalAlpha = 0.22;
    const gr = g.createLinearGradient(0, 0, 250, 0); gr.addColorStop(0, '#c4c6cc'); gr.addColorStop(1, '#8d9097');
    g.fillStyle = gr; g.beginPath(); g.moveTo(36, -12); g.quadraticCurveTo(140, -44, 252, -16); g.lineTo(252, 12); g.quadraticCurveTo(140, 0, 36, 12); g.closePath(); g.fill();
    g.restore();
  }
  g.globalAlpha = 1;
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, 252); rg.addColorStop(0.85, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(30,30,34,0.55)');
  g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 256, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Merge the rigid meshes under `root` (not inside a group marked userData.dyn) into one mesh per material.
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4(), byMat = new Map(), victims = [];
  (function walk(o) {
    o.children.forEach((c) => {
      if (c.userData.dyn) return;
      if (c.isMesh && !c.material.transparent && c.geometry.attributes.uv && c.geometry.attributes.normal) {
        M.multiplyMatrices(inv, c.matrixWorld);
        const g = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(M);
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(g); victims.push(c);
      } else if (!c.isMesh && !c.isPoints) walk(c);
    });
  })(root);
  victims.forEach((c) => c.parent.remove(c));
  byMat.forEach((gs, mat) => { const m = new THREE.Mesh(merge(gs), mat); root.add(m); });
}
