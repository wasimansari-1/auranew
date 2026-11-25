/* Vimaan 3D — the world: sky (sunset → soft dusk, always daylight), the ground (airport runway with painted
 * markings, grass, beach, the sea with sky reflections and sun glitter), the coastal city across
 * the bay, distant hills, the cloud deck and cumulus puffs, runway lights, and the parachute. */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { U, GLSL_SKY, GLSL_FOG } from './common.js';
import { DECK } from './timeline.js';

const TONE = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ------------------------------------------------------------------ sky dome
export function buildSky(forEnv) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...pick(U, ['uSunDir', 'uZenith', 'uHorizon', 'uGlow', 'uGround', 'uNoise', 'uTime']) },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: 'precision highp float; varying vec3 vDir; uniform sampler2D uNoise; uniform float uTime;' + GLSL_SKY + `
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        ${forEnv ? '' : `
        float sd = dot(d, uSunDir);
        c += uGlow * 22.0 * smoothstep(0.99990, 0.99996, sd) * smoothstep(-0.02, 0.01, d.y);
        // high cirrus, lit by the low sun
        if (d.y > 0.0) {
          vec2 q = d.xz / (d.y + 0.12) * 0.22 + vec2(uTime * 0.0015, 0.0);
          float n = texture2D(uNoise, q * vec2(0.55, 1.9)).g * 0.7 + texture2D(uNoise, q * 3.1).b * 0.3;
          float ci = smoothstep(0.52, 0.8, n) * smoothstep(0.02, 0.2, d.y) * (1.0 - smoothstep(0.45, 0.85, d.y));
          c = mix(c, c * 0.75 + uGlow * 0.55 + uHorizon * 0.25, ci * 0.55);
        }
`}
        gl_FragColor = vec4(c, 1.0);
        ${forEnv ? '' : TONE}
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: !forEnv,
  });
  m.toneMapped = !forEnv;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), m);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  if (!forEnv) mesh.scale.setScalar(60000);
  return mesh;
}
function pick(o, keys) { const r = {}; keys.forEach((k) => { r[k] = o[k]; }); return r; }

// ------------------------------------------------------------------ ground: land, sea, airport
export const RWY = { x0: 0, x1: 2400, half: 22.5 };
// ground textures (CC0, ambientCG) + the runway designation atlas + the jet's ground point for contact shading
export const GT = { asph: { value: null }, grass: { value: null }, num: { value: null }, jet: { value: new THREE.Vector4(0, 0, 0, 0) }, cheap: { value: 0 } };
export const SH = { tex: { value: null }, mat: { value: new THREE.Matrix4() }, on: { value: 0 }, c: { value: new THREE.Vector3() } };

export function buildGround() {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...pick(U, ['uSunDir', 'uZenith', 'uHorizon', 'uGlow', 'uGround', 'uFogSun', 'uFogDen', 'uFogH', 'uMist', 'uMistCol', 'uNoise', 'uTime']),
      uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uShadow: SH.tex, uShadowMat: SH.mat, uShadowOn: SH.on, uShadowC: SH.c, uAsph: GT.asph, uGrass: GT.grass, uNum: GT.num, uJetG: GT.jet, uCheap: GT.cheap },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'precision highp float; varying vec3 vW; uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunCol; uniform vec3 uAmb; uniform sampler2D uShadow; uniform mat4 uShadowMat; uniform float uShadowOn; uniform vec3 uShadowC; uniform sampler2D uAsph; uniform sampler2D uGrass; uniform sampler2D uNum; uniform vec4 uJetG; uniform float uCheap;' + GLSL_SKY + GLSL_FOG + /* glsl */`
      float bandAA(float d, float a, float b) { float w = fwidth(d) * 0.7 + 1e-3; return smoothstep(a - w, a + w, d) * (1.0 - smoothstep(b - w, b + w, d)); }
      float boxAA(vec2 p, vec2 c, vec2 h) { vec2 q = abs(p - c) - h; float d = max(q.x, q.y); float w = fwidth(d) * 0.7 + 1e-3; return 1.0 - smoothstep(-w, w, d); }
      float N(vec2 p, float s, int ch) { vec4 t = texture2D(uNoise, p / s); return ch == 0 ? t.r : ch == 1 ? t.g : ch == 2 ? t.b : t.a; }
      float landField(vec2 p) {
        float n1 = N(p, 6200.0, 0) - 0.5, n2 = N(p, 1500.0, 1) - 0.5, n3 = N(p, 400.0, 2) - 0.5;
        float near = min(p.y + 380.0 + n1 * 520.0 + n2 * 160.0 + n3 * 40.0, 2700.0 + n1 * 600.0 + n2 * 180.0 + n3 * 40.0 - p.x);
        float far = -5300.0 + n1 * 1100.0 + n2 * 260.0 + n3 * 50.0 - p.y;
        vec2 q = abs(p - vec2(1200.0, 180.0)) - vec2(1580.0, 470.0);
        float apt = -max(q.x, q.y);
        return max(max(near, far), apt);
      }
      float shadowAt(vec3 w) {
        vec4 s = uShadowMat * vec4(w, 1.0); vec2 uv = s.xy * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
        float o = 2.5 / 384.0, v = 0.0;
        v += texture2D(uShadow, uv).r * 0.2;
        v += (texture2D(uShadow, uv + vec2(o, 0.0)).r + texture2D(uShadow, uv - vec2(o, 0.0)).r + texture2D(uShadow, uv + vec2(0.0, o)).r + texture2D(uShadow, uv - vec2(0.0, o)).r) * 0.12;
        v += (texture2D(uShadow, uv + vec2(o, o)).r + texture2D(uShadow, uv - vec2(o, o)).r + texture2D(uShadow, uv + vec2(o, -o)).r + texture2D(uShadow, uv - vec2(o, -o)).r) * 0.08;
        return v * (1.0 - smoothstep(9.0, 42.0, length(w.xz - uShadowC.xz))); // long low-sun shadows fade out (penumbra)
      }
      void main() {
        vec2 p = vW.xz;
        float dist = length(vW - cameraPosition);
        float land = landField(p);
        vec3 V = normalize(vW - cameraPosition);
        vec3 col;
        if (land > 0.0) {
          // --- land: grass and fields, beach at the shore
          float f1 = N(p, 900.0, 1), f2 = N(p, 140.0, 2), f3 = N(p, 24.0, 3), f4 = N(p, 5.0, 2);
          // CC0 grass photo at two scales (no visible tiling) + large patches of greener / drier ground
          vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * p;
          vec3 gt = uCheap > 0.5 ? texture2D(uGrass, p / 9.0).rgb : texture2D(uGrass, p / 7.0).rgb * 0.55 + texture2D(uGrass, pr / 31.0).rgb * 0.45;
          vec3 alb = gt * mix(vec3(0.85, 0.95, 0.75), vec3(1.15, 1.0, 0.72), smoothstep(0.35, 0.7, f1));
          alb *= mix(1.0, 0.72, smoothstep(0.55, 0.8, f2) * 0.7);
          alb *= 0.85 + 0.3 * f3;
          // mown strips along the runway
          float verge = 1.0 - smoothstep(120.0, 160.0, abs(p.y - 60.0));
          alb *= 1.0 + 0.06 * verge * sign(fract(p.y / 14.0) - 0.5);
          // beach
          float beach = 1.0 - smoothstep(14.0, 40.0, land + (f2 - 0.5) * 20.0);
          alb = mix(alb, vec3(0.55, 0.47, 0.34), beach);
          // the airport: runway, taxiway, apron
          float onR = step(${(RWY.x0 - 62).toFixed(1)}, p.x) * step(p.x, ${(RWY.x1 + 62).toFixed(1)}) * step(abs(p.y), ${(RWY.half + 4).toFixed(1)});
          float u = p.x, v = p.y;
          float tw = boxAA(p, vec2(1200.0, 190.0), vec2(1230.0, 11.5));
          float con = max(max(boxAA(p, vec2(0.0, 106.0), vec2(11.5, 84.0)), boxAA(p, vec2(800.0, 106.0), vec2(11.5, 84.0))), max(boxAA(p, vec2(1600.0, 106.0), vec2(11.5, 84.0)), boxAA(p, vec2(2400.0, 106.0), vec2(11.5, 84.0))));
          float apron = boxAA(p, vec2(1050.0, 318.0), vec2(450.0, 115.0));
          float tarmac = max(tw, con);
          vec3 asph = texture2D(uAsph, p / 9.0).rgb * 3.6 * (0.9 + 0.25 * (N(p, 60.0, 2) - 0.5));
          alb = mix(alb, asph * 1.12, tarmac);
          alb = mix(alb, vec3(0.034, 0.03, 0.0) + vec3(0.6, 0.48, 0.1) * bandAA(abs(p.y - 190.0), -1.0, 0.25) * tw, 0.0);
          alb = mix(alb, vec3(0.62, 0.5, 0.12), bandAA(abs(p.y - 190.0), -1.0, 0.25) * step(abs(p.x - 1200.0), 1220.0));
          vec3 conc = vec3(0.28, 0.27, 0.26) * (0.85 + 0.25 * N(p, 30.0, 3));
          conc *= 1.0 - 0.25 * max(bandAA(fract(p.x / 7.5), -0.1, 0.03), bandAA(fract(p.y / 7.5), -0.1, 0.03));
          alb = mix(alb, conc, apron);
          if (onR > 0.0) {
            float inR = boxAA(p, vec2(1200.0, 0.0), vec2(1200.0, ${RWY.half.toFixed(1)}));
            float pad = boxAA(p, vec2(-30.0, 0.0), vec2(30.0, ${RWY.half.toFixed(1)})) + boxAA(p, vec2(2430.0, 0.0), vec2(30.0, ${RWY.half.toFixed(1)}));
            vec3 a = texture2D(uAsph, p / 6.0).rgb * 0.55 + texture2D(uAsph, pr / 14.0).rgb * 0.45;
            if (uCheap < 0.5) a *= mix(1.0, 0.55 + 0.9 * texture2D(uAsph, pr / 1.7).g / max(dot(a, vec3(0.333)), 0.02) * 0.5, 0.35 * (1.0 - smoothstep(25.0, 90.0, dist))); // fine grain close up
            a = mix(vec3(0.026, 0.026, 0.027), mix(vec3(dot(a, vec3(0.33))), a, 0.35), 0.55) * 3.1 * (0.92 + 0.22 * (N(p, 45.0, 2) - 0.5));
            a *= 1.0 - 0.12 * smoothstep(5.0, 0.5, abs(v)) * step(80.0, u); // darker centre (rubber, oil)
            // tyre marks in the touchdown zones
            float tdz = (1.0 - smoothstep(0.0, 450.0, abs(u - 500.0))) + (1.0 - smoothstep(0.0, 450.0, abs(u - 1900.0)));
            a *= 1.0 - 0.45 * tdz * (1.0 - smoothstep(2.0, 7.0, abs(abs(v) - 3.5))) * (0.6 + 0.4 * N(p * vec2(0.05, 1.0), 6.0, 3));
            float w = 0.0;
            float uu = u < 1200.0 ? u : 2400.0 - u; // both ends are painted the same
            // threshold "piano keys"
            float av = abs(v);
            float key = bandAA(uu, 6.0, 36.0) * step(1.8, av) * step(av, 20.0) * bandAA(fract((av - 1.8) / 3.6), -0.01, 0.5);
            w = max(w, key);
            w = max(w, bandAA(uu, 1.5, 3.3) * step(av, 22.5)); // threshold bar
            // centreline dashes
            w = max(w, bandAA(av, -1.0, 0.45) * bandAA(fract((u - 70.0) / 50.0), 0.0, 0.6) * step(70.0, u) * step(u, 2330.0));
            // edge lines
            w = max(w, bandAA(av, 21.6, 22.5) * bandAA(u, 0.0, 2400.0));
            // aiming point + touchdown-zone bars
            w = max(w, bandAA(uu, 400.0, 460.0) * bandAA(av, 6.0, 14.5));
            float bars3 = bandAA(av, 5.0, 6.8) + bandAA(av, 8.0, 9.8) + bandAA(av, 11.0, 12.8);
            float bars2 = bandAA(av, 5.0, 6.8) + bandAA(av, 8.0, 9.8);
            w = max(w, (bandAA(uu, 150.0, 172.5) + bandAA(uu, 300.0, 322.5)) * bars3);
            w = max(w, (bandAA(uu, 550.0, 572.5) + bandAA(uu, 700.0, 722.5)) * bars2);
            w = max(w, (bandAA(uu, 850.0, 872.5) + bandAA(uu, 1000.0, 1022.5)) * bandAA(av, 5.0, 6.8));
            // runway designation ("27" from this end, "09" from the far end), read from the approach
            {
              vec2 nq = vec2((u < 1200.0 ? v : -v) / 11.0 + 0.5, (uu - 47.0) / 9.0);
              if (nq.x > 0.0 && nq.x < 1.0 && nq.y > 0.0 && nq.y < 1.0) w = max(w, texture2D(uNum, vec2(nq.x * 0.5 + (u < 1200.0 ? 0.0 : 0.5), nq.y)).r);
            }
            vec3 paint = vec3(0.78, 0.78, 0.76) * (0.85 + 0.2 * N(p, 5.0, 3));
            a = mix(a, paint, w * inR);
            // blast pads: yellow chevrons
            float chev = bandAA(fract((abs(uu < 0.0 ? uu : (u > 2400.0 ? u - 2400.0 : 0.0)) + av * 0.75) / 15.0), 0.0, 0.1);
            vec3 padc = mix(vec3(0.1, 0.1, 0.1), vec3(0.62, 0.48, 0.1), chev);
            a = mix(a, padc, clamp(pad, 0.0, 1.0) * (1.0 - inR));
            alb = mix(alb, a, max(inR, clamp(pad, 0.0, 1.0)));
          }
          // contact shading under the jet on the ground (fuselage, main wheels, nose wheel)
          if (uJetG.w > 0.0) {
            vec2 d = p - uJetG.xy; float cs = cos(uJetG.z), sn = sin(uJetG.z);
            vec2 l = vec2(d.x * cs + d.y * sn, -d.x * sn + d.y * cs);
            float ao = exp(-pow((l.x - 2.0) / 10.0, 2.0) - pow(l.y / 2.6, 2.0)) * 0.42
                     + exp(-pow(l.x / 2.2, 2.0) - pow(l.y / 9.0, 2.0)) * 0.18
                     + exp(-(pow(l.x / 0.9, 2.0) + pow((abs(l.y) - 1.66) / 0.55, 2.0))) * 0.5
                     + exp(-(pow((l.x - 9.0) / 0.7, 2.0) + pow(l.y / 0.45, 2.0))) * 0.45;
            alb *= 1.0 - min(0.75, ao * uJetG.w);
          }
          // light: low sun on flat ground + sky light; the jet's shadow
          float sh = uShadowOn > 0.0 ? shadowAt(vW) * uShadowOn : 0.0;
          vec3 L = uSunCol * (0.12 + max(uSunDir.y, 0.0)) * (1.0 - 0.42 * sh) + uAmb;
          col = alb * L;
        } else {
          // --- sea: two scrolling normal layers, sky reflection, sun glitter, shallow water near the shore
          float t = uTime;
          vec2 q1 = p / 70.0 + vec2(t * 0.012, t * 0.007), q2 = p / 23.0 + vec2(-t * 0.02, t * 0.015);
          float e = 1.0 / 256.0;
          float c2 = uCheap > 0.5 ? 0.0 : 0.6; // the lean tier skips the second wave layer
          float h0 = texture2D(uNoise, q1).b + (c2 > 0.0 ? texture2D(uNoise, q2).a * c2 : 0.0);
          float hx = texture2D(uNoise, q1 + vec2(e, 0.0)).b + (c2 > 0.0 ? texture2D(uNoise, q2 + vec2(e, 0.0)).a * c2 : 0.0);
          float hz = texture2D(uNoise, q1 + vec2(0.0, e)).b + (c2 > 0.0 ? texture2D(uNoise, q2 + vec2(0.0, e)).a * c2 : 0.0);
          float k = mix(1.6, 0.2, smoothstep(300.0, 6000.0, dist));
          vec3 n = normalize(vec3(-(hx - h0) * k * 6.0, 1.0, -(hz - h0) * k * 6.0));
          vec3 r = reflect(V, n); r.y = abs(r.y);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-V, n), 0.0), 5.0);
          vec3 refl = skyColor(r);
          float shallow = 1.0 - smoothstep(-260.0, 0.0, land) ;
          vec3 deep = mix(vec3(0.012, 0.03, 0.05), vec3(0.03, 0.11, 0.11), shallow);
          vec3 body = deep * (uAmb * 1.6 + uSunCol * 0.25);
          col = mix(body, refl, fres);
          float sd = max(dot(r, uSunDir), 0.0);
          col += uSunCol * (pow(sd, 900.0) * 40.0 + pow(sd, 90.0) * 1.2) * smoothstep(-0.03, 0.04, uSunDir.y);
          // surf line at the beach
          col = mix(col, vec3(0.75, 0.72, 0.68) * (uAmb + uSunCol * 0.2), (1.0 - smoothstep(0.0, 10.0, -land)) * (0.4 + 0.6 * N(p + t * 3.0, 30.0, 3)) * 0.55);
        }
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }`,
  });
  const g = new THREE.PlaneGeometry(1, 1, 16, 16).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(140000, 1, 140000);
  mesh.frustumCulled = false; mesh.renderOrder = -5;
  return mesh;
}

// ------------------------------------------------------------------ the city across the bay (+ airport buildings)
export function buildCity(lowTier) {
  const r = rng(88034);
  const boxes = [];
  // skyline: clustered towers along the far shore
  const n = lowTier ? 170 : 280;
  for (let i = 0; i < n; i++) {
    const cx = -1200 + r() * 8200, core = Math.exp(-Math.pow((cx - 2600) / 2200, 2));
    const z = -5600 - r() * 1300 - (1 - core) * r() * 500;
    const tall = r() < 0.08 * core;
    const h = 18 + Math.pow(r(), 2.2) * (80 + 190 * core) + (tall ? 110 + r() * 90 : 0);
    const w = 20 + r() * 34, d = 20 + r() * 30, seed = r();
    boxes.push([cx, z, w, h, d, seed]);
    if (h > 60 && r() < 0.6) boxes.push([cx + (r() - 0.5) * 6, z + (r() - 0.5) * 6, w * (1.4 + r() * 0.6), 10 + r() * 14, d * (1.4 + r() * 0.5), (seed + 0.37) % 1]); // podium
    if (h > 90 && r() < 0.5) boxes.push([cx, z, w * 0.6, h + 8 + r() * 20, d * 0.6, (seed + 0.71) % 1]); // set-back crown
  }
  // airport: terminal, hangars, tower (right of the runway, behind the apron)
  boxes.push([1050, 470, 380, 16, 60, 0.95], [620, 470, 70, 22, 55, 0.9], [1480, 470, 80, 24, 60, 0.9], [1700, 330, 18, 34, 18, 0.97]);
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { ...pick(U, ['uSunDir', 'uZenith', 'uHorizon', 'uGlow', 'uGround', 'uFogSun', 'uFogDen', 'uFogH', 'uMist', 'uMistCol', 'uDusk']), uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() } },
    vertexShader: /* glsl */`
      attribute float aSeed; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vSeed;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz;
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vL = position * sc; vN = normalize(mat3(instanceMatrix) * normal); vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: 'precision highp float; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vSeed; uniform vec3 uSunCol; uniform vec3 uAmb; uniform float uDusk;' + GLSL_SKY + GLSL_FOG + /* glsl */`
      float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
      void main() {
        vec3 base = mix(mix(vec3(0.22, 0.2, 0.19), vec3(0.5, 0.45, 0.4), fract(vSeed * 7.13)), vec3(0.42, 0.36, 0.3), step(0.85, fract(vSeed * 4.1)));
        if (fract(vSeed * 3.7) > 0.62) base = vec3(0.1, 0.13, 0.17); // glass towers
        base *= 0.85 + 0.3 * fract(vL.y * 0.0 + vSeed * 13.1);
        float roof = step(0.5, vN.y);
        float hc = abs(vN.x) > 0.5 ? vL.z : vL.x;
        float cw = 2.6 + 2.2 * fract(vSeed * 5.31), ch = 3.2 + 0.9 * fract(vSeed * 9.7);
        vec2 cell = vec2(hc / cw, vL.y / ch);
        vec2 f = fract(cell) - 0.5;
        float strips = step(0.75, fract(vSeed * 2.9)); // ribbon windows on some buildings
        float win = mix(step(abs(f.x), 0.3) * step(abs(f.y), 0.27), step(abs(f.y), 0.3), strips) * (1.0 - roof) * step(2.0, vL.y);
        float lit = step(0.55, h21(floor(cell) + vSeed * 91.0));
        vec3 V = normalize(vW - cameraPosition);
        vec3 refl = skyColor(reflect(V, vN));
        float sunF = max(dot(vN, uSunDir), 0.0);
        vec3 col = base * (uSunCol * sunF * 0.9 + uAmb);
        col = mix(col, refl * 0.3 + uSunCol * pow(max(dot(reflect(V, vN), uSunDir), 0.0), 30.0) * 0.4, win * 0.35);
        col += vec3(1.0, 0.72, 0.42) * win * lit * (0.06 + 1.2 * uDusk);
        col *= mix(1.0, 0.7, roof);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, m, boxes.length);
  const seeds = new Float32Array(boxes.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  boxes.forEach((b, i) => { p.set(b[0], 0, b[1]); s.set(b[2], b[3], b[4]); M.compose(p, q, s); mesh.setMatrixAt(i, M); seeds[i] = b[5]; });
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  mesh.userData.total = boxes.length;
  return mesh;
}

// distant hills behind the city (a ring with a noisy ridge line)
export function buildHills() {
  const seg = 360, pos = [], idx = [], r = rng(7);
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    // high behind the city (−z), low elsewhere, none over the open sea ahead (+x)
    const behind = Math.max(0, -z), ahead = Math.max(0, x);
    const h = (60 + 520 * behind * behind + 180 * Math.max(0, -x)) * (1 - 0.95 * Math.pow(ahead, 1.5)) *
      (0.7 + 0.18 * Math.sin(a * 13 + ph[0]) + 0.1 * Math.sin(a * 37 + ph[1]) + 0.05 * Math.sin(a * 91 + ph[2]));
    const R = 13000 + 2500 * behind;
    pos.push(x * R + 1200, -60, z * R, x * R + 1200, Math.max(-40, h), z * R);
    if (i < seg) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: { ...pick(U, ['uSunDir', 'uZenith', 'uHorizon', 'uGlow', 'uGround', 'uFogSun', 'uFogDen', 'uFogH', 'uMist', 'uMistCol']), uAmb: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'precision highp float; varying vec3 vW; uniform vec3 uAmb;' + GLSL_SKY + GLSL_FOG + `void main(){ vec3 c = vec3(0.09, 0.1, 0.09) * (uAmb * 1.5 + 0.1); c = applyFog(c, vW); gl_FragColor = vec4(c, 1.0); ${TONE} }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -6;
  return mesh;
}

// ------------------------------------------------------------------ clouds: the deck + puffs
export const CL = { coverage: { value: 0.5 }, lit: { value: new THREE.Color() }, shade: { value: new THREE.Color() }, deckY: { value: DECK }, puffs: { value: null }, opacity: { value: 1 } };

export function buildDeck() {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...pick(U, ['uSunDir', 'uZenith', 'uHorizon', 'uGlow', 'uGround', 'uFogSun', 'uFogDen', 'uFogH', 'uMist', 'uMistCol', 'uNoise', 'uTime']), uCov: CL.coverage, uLit: CL.lit, uShade: CL.shade, uDeckY: CL.deckY },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'precision highp float; varying vec3 vW; uniform sampler2D uNoise; uniform float uTime; uniform float uCov; uniform vec3 uLit; uniform vec3 uShade; uniform float uDeckY;' + GLSL_SKY + GLSL_FOG + /* glsl */`
      float dens(vec2 p) {
        return texture2D(uNoise, p / 14000.0).r * 0.55 + texture2D(uNoise, p / 4200.0 + 0.37).g * 0.3 + texture2D(uNoise, p / 1500.0 + 0.71).b * 0.15;
      }
      void main() {
        vec2 p = vW.xz + vec2(uTime * 4.0, uTime * 1.0);
        float n = dens(p);
        float th = 1.0 - uCov;
        float a = smoothstep(th - 0.04, th + 0.16, n);
        vec2 sd = normalize(uSunDir.xz + 1e-4);
        float n2 = dens(p + sd * 260.0);
        float lit = clamp(0.55 + (n - n2) * 7.0, 0.0, 1.0);
        bool above = cameraPosition.y > uDeckY;
        vec3 V = normalize(vW - cameraPosition);
        float fw = pow(max(dot(V, uSunDir), 0.0), 4.0);
        // relief: a fake normal from the density gradient, lit by the low sun
        float e = 220.0;
        float nx = dens(p + vec2(e, 0.0)), nz = dens(p + vec2(0.0, e));
        vec3 N = normalize(vec3(-(nx - n) * 46.0, 1.0, -(nz - n) * 46.0));
        float thick = smoothstep(th, th + 0.3, n);
        vec3 col;
        if (above) {
          float l = clamp(dot(N, normalize(uSunDir + vec3(0.0, 0.25, 0.0))) * 0.75 + 0.35, 0.0, 1.2);
          float shadowed = smoothstep(0.0, 0.08, n2 - n);                 // the sun side of a billow hides the far side
          col = mix(uShade, uLit, clamp(0.12 + 0.95 * l - 0.35 * shadowed, 0.0, 1.0) * (0.65 + 0.35 * thick));
          col += uGlow * fw * (1.0 - a) * 0.9;
        } else {
          // seen from below: the low sun lights the undersides warm; thick parts stay grey-violet
          float l = clamp(0.25 + (n - n2) * 6.0, 0.0, 1.0);
          col = mix(uShade * 0.75, uLit * 1.05, mix(0.55, 0.2, thick) + l * 0.35);
          col += uGlow * fw * (1.0 - thick) * 1.2;
        }
        float cross = smoothstep(8.0, 70.0, abs(cameraPosition.y - uDeckY));
        col = applyFog(col, vW);
        if (above) { col = mix(uShade * 0.85, col, a); a = mix(0.94, 1.0, a); } // from above: a closed sea of clouds (thin parts read as shaded valleys, no dark ground)
        gl_FragColor = vec4(col, a * cross);
        ${TONE}
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 8, 8).rotateX(-Math.PI / 2), m);
  mesh.scale.set(120000, 1, 120000); mesh.position.y = DECK;
  mesh.frustumCulled = false; mesh.renderOrder = 1;
  return mesh;
}

export function buildPuffs(lowTier, sunDir) {
  const r = rng(424242), P = [];
  // a cloud = a few wide chunks side by side, slightly staggered in height and depth
  function cluster(cx, cy, cz, size, count, wrap) {
    const ang = r() * Math.PI;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) - 0.5 : 0;
      const along = t * size * 1.4 + (r() - 0.5) * size * 0.3, across = (r() - 0.5) * size * 0.6;
      const mid = 1 - Math.abs(t) * 1.2;
      const s = size * (0.55 + 0.35 * r()) * (0.75 + 0.4 * mid);
      P.push([cx + Math.cos(ang) * along - Math.sin(ang) * across, cy + s * 0.18 * mid + r() * size * 0.08, cz + Math.sin(ang) * along + Math.cos(ang) * across, s, Math.floor(r() * 4), 0.4 + 0.6 * mid, wrap, r() * 6.28]);
    }
  }
  // 1. scattered cumulus around the airport and the climb (not in the line of the sun from the runway)
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  for (let k = 0; k < (lowTier ? 5 : 8); k++) {
    const x = 2500 + r() * 7000, z = -6000 + r() * 8000;
    const az = Math.atan2(z, x - 100);
    if (Math.abs(az - sunAz) < 0.28 && x > 0) continue;
    cluster(x, 240 + r() * 60, z, 150 + r() * 160, lowTier ? 3 : 5, 0);
  }
  // 2. towering clouds far away on the horizon (seen from the side; wrap around the camera: endless)
  for (let k = 0; k < 10; k++) cluster(r() * 40000, DECK - 80, r() * 40000, 900 + r() * 900, 5, 2);

  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
  const a0 = new Float32Array(P.length * 4), a1 = new Float32Array(P.length * 4);
  P.forEach((p, i) => { a0.set([p[0], p[1], p[2], p[3]], i * 4); a1.set([p[4], p[5], p[6], p[7]], i * 4); });
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(a0, 4));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(a1, 4));
  g.instanceCount = P.length;
  const m = new THREE.ShaderMaterial({
    uniforms: { ...pick(U, ['uSunDir', 'uZenith', 'uHorizon', 'uGlow', 'uGround', 'uFogSun', 'uFogDen', 'uFogH', 'uMist', 'uMistCol']), uPuffs: CL.puffs, uLit: CL.lit, uShade: CL.shade, uOpacity: CL.opacity, uDeckY: CL.deckY },
    vertexShader: /* glsl */`
      attribute vec4 iA; attribute vec4 iB; varying vec2 vUv; varying vec3 vW; varying float vUp; varying float vFade;
      void main() {
        vec3 c = iA.xyz; float T = iB.z > 1.5 ? 40000.0 : 9000.0;
        if (iB.z > 0.5) c.xz = cameraPosition.xz + mod(c.xz - cameraPosition.xz + T * 0.5, T) - T * 0.5;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        float rot = (iB.w - 3.14) * 0.03;
        vec2 q = position.xy * mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
        mv.xy += q * iA.w * vec2(1.6, 0.8);
        vec2 cell = vec2(mod(iB.x, 2.0), floor(iB.x / 2.0));
        vUv = (uv + cell) * 0.5;
        vW = c; vUp = iB.y;
        float d = -mv.z;
        vFade = smoothstep(iA.w * 0.25, iA.w * 1.1, d);                 // no hard cut when the camera flies through
        if (iB.z > 0.5) vFade *= 1.0 - smoothstep(T * 0.36, T * 0.48, length(c.xz - cameraPosition.xz));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'precision highp float; varying vec2 vUv; varying vec3 vW; varying float vUp; varying float vFade; uniform sampler2D uPuffs; uniform vec3 uLit; uniform vec3 uShade; uniform float uOpacity; uniform float uDeckY;' + GLSL_SKY + GLSL_FOG + /* glsl */`
      void main() {
        vec4 t = texture2D(uPuffs, vUv);
        float a = t.a * vFade * uOpacity;
        if (a < 0.004) discard;
        // a normal from the density gradient (billboard plane → world), lit by the low sun: volume, not a cut-out
        float e = 1.0 / 128.0;
        float gx = texture2D(uPuffs, vUv + vec2(e, 0.0)).a - texture2D(uPuffs, vUv - vec2(e, 0.0)).a;
        float gy = texture2D(uPuffs, vUv + vec2(0.0, e)).a - texture2D(uPuffs, vUv - vec2(0.0, e)).a;
        vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 Up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 F = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 n = normalize(-R * gx * 2.2 - Up * gy * 2.2 + F * (0.35 + 0.65 * (1.0 - t.a)));
        vec3 V = normalize(vW - cameraPosition);
        float ndl = dot(n, uSunDir) * 0.5 + 0.5;
        float core = smoothstep(0.35, 1.0, t.a);
        float lit = clamp(ndl * (0.75 + 0.35 * t.r) - core * 0.22 + vUp * 0.12, 0.0, 1.0);
        float fw = pow(max(dot(V, uSunDir), 0.0), 4.0);            // looking towards the sun: dark cores, bright rims
        vec3 col = mix(uShade, uLit, lit * (1.0 - 0.4 * fw));
        col += uZenith * 0.25 * max(n.y, 0.0);
        col += uGlow * fw * pow(1.0 - t.a, 2.0) * 1.8;
        col *= 1.0 - 0.18 * (1.0 - smoothstep(uDeckY - 80.0, uDeckY + 30.0, vW.y));
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, a);
        ${TONE}
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 3;
  mesh.userData.count = P.length;
  return mesh;
}

// ------------------------------------------------------------------ point lights (jet + runway): one shader
export function lightMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...pick(U, ['uSunDir', 'uZenith', 'uHorizon', 'uGlow', 'uGround', 'uFogSun', 'uFogDen', 'uFogH', 'uMist', 'uMistCol', 'uTime']), uPx: { value: 800 }, uGearDown: { value: 1 }, uLevel: { value: 1 } },
    vertexShader: 'attribute vec3 color; attribute float size; attribute float kind; uniform float uTime; uniform float uPx; uniform float uGearDown; uniform float uLevel; varying vec3 vCol; varying float vI;' + GLSL_SKY + GLSL_FOG + /* glsl */`
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * w;
        gl_Position = projectionMatrix * mv;
        float I = 1.0;
        if (kind > 0.5 && kind < 1.5) { float t = mod(uTime, 1.3); I = (step(t, 0.05) + step(0.14, t) * step(t, 0.19)) * 3.0; }
        else if (kind > 1.5 && kind < 2.5) { float t = mod(uTime + 0.37 + position.y * 0.21, 1.15); I = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.1, 0.32, t)) * 2.2; }
        else if (kind > 2.5 && kind < 3.5) { I = uGearDown * 2.0; }
        else if (kind > 3.5) { I = 1.0; }
        float d = max(-mv.z, 0.1);
        float px = size * uPx / d;
        gl_PointSize = I > 0.01 ? clamp(px * 1.7, 2.0, 40.0) : 0.0;
        vI = I * uLevel * (1.0 - fogAmount(w.xyz)) * clamp(px * 1.2, 0.3, 1.0);
        vCol = color;
      }`,
    fragmentShader: 'precision highp float; varying vec3 vCol; varying float vI;' + /* glsl */`
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c) * 4.0;
        float a = exp(-r2 * 7.0) * 0.35 + exp(-r2 * 60.0) * 1.3;
        gl_FragColor = vec4(vCol * a * vI, 1.0);
        ${TONE}
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export function buildRunwayLights(mat) {
  const P = [], Cc = [], S = [], K = [];
  const add = (x, z, c, s) => { P.push(x, 0.35, z); Cc.push(...c); S.push(s); K.push(4); };
  for (let x = 0; x <= RWY.x1 + 0.1; x += 60) {
    const c = x > RWY.x1 - 600 ? [1, 0.75, 0.3] : [1, 0.92, 0.75];
    add(x, -RWY.half - 1.5, c, 0.5); add(x, RWY.half + 1.5, c, 0.5);
  }
  for (let z = -20; z <= 20; z += 3.3) { add(-1, z, [0.3, 1, 0.45], 0.3); add(RWY.x1 + 1, z, [1, 0.15, 0.1], 0.3); }
  for (let x = 30; x <= RWY.x1; x += 60) { add(x, 0, [0.9, 0.9, 1], 0.16); } // centreline
  for (let x = 0; x <= 2400; x += 120) { add(x, 202.5, [0.25, 0.5, 1], 0.25); add(x, 177.5, [0.25, 0.5, 1], 0.25); } // taxiway edge (blue)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  g.setAttribute('size', new THREE.Float32BufferAttribute(S, 1));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(K, 1));
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 4;
  return pts;
}

// ------------------------------------------------------------------ the parachute with my win
export function buildChute(fogPatch) {
  const g = new THREE.Group();
  // canopy: 16 gores, purple / white, gold crown band
  const seg = 16, rings = 10, pos = [], col = [], idx = [];
  const cP = new THREE.Color('#5b1fa8'), cW = new THREE.Color('#f4f1f8'), cG = new THREE.Color('#e0b04e');
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, th = t * 1.25, y = Math.cos(th) * 3.0, rr = Math.sin(th) * 3.4;
    for (let j = 0; j <= seg * 2; j++) {
      const a = (j / (seg * 2)) * Math.PI * 2, scal = 1 + 0.04 * Math.cos(a * seg) * t; // scalloped between lines
      pos.push(Math.cos(a) * rr * scal, y - (1 - Math.cos(a * seg)) * 0.06 * t, Math.sin(a) * rr * scal);
      const gore = Math.floor(j / 2) % 2, c = t < 0.18 ? cG : gore ? cP : cW;
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg * 2; j++) { const a = i * (seg * 2 + 1) + j, b = a + seg * 2 + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); cg.setIndex(idx); cg.computeVertexNormals();
  const canopyMat = fogPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, transparent: true }));
  const canopy = new THREE.Mesh(cg, canopyMat);
  g.add(canopy);
  // suspension lines to the payload
  const lp = [];
  for (let j = 0; j < seg; j++) { const a = (j / seg) * Math.PI * 2, th = 1.25; lp.push(Math.cos(a) * Math.sin(th) * 3.4, Math.cos(th) * 3.0, Math.sin(a) * Math.sin(th) * 3.4, 0, -4.2, 0); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xdedbe6, transparent: true, opacity: 0.8 });
  g.add(new THREE.LineSegments(lg, lineMat));
  // payload: a small gold case
  const caseMat = fogPatch(new THREE.MeshStandardMaterial({ color: 0xd9a845, metalness: 1, roughness: 0.3, transparent: true }));
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.6), caseMat); box.position.y = -4.55; g.add(box);
  // the win tag (canvas, redrawn per win)
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false });
  const tag = new THREE.Sprite(sm); tag.center.set(0.5, -0.25); tag.position.y = 3.1; tag.renderOrder = 20; g.add(tag); // the win, just above the canopy
  g.scale.setScalar(0.7);
  g.visible = false;
  g.userData = {
    canopy, tag, tex, cv, mats: [canopyMat, lineMat, caseMat, sm],
    setText(text) {
      const c = cv.getContext('2d');
      c.clearRect(0, 0, 512, 128);
      c.font = '800 64px "B612", "Barlow", system-ui, sans-serif';
      const w = Math.min(500, c.measureText(text).width + 64), x = (512 - w) / 2;
      const gr = c.createLinearGradient(0, 14, 0, 114); gr.addColorStop(0, '#f6d27a'); gr.addColorStop(1, '#c58a22');
      c.fillStyle = 'rgba(30,12,60,0.55)'; round(c, x + 3, 18, w, 96, 48); c.fill();
      c.fillStyle = gr; round(c, x, 12, w, 96, 48); c.fill();
      c.lineWidth = 4; c.strokeStyle = 'rgba(255,245,210,0.9)'; c.stroke();
      c.fillStyle = '#2a0f55'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, 256, 64, 460);
      tex.needsUpdate = true;
    },
  };
  return g;
}
function round(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

// full-screen colour dip (the cut back to the runway)
export function buildDip() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color() }, uA: { value: 0 } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
    fragmentShader: 'uniform vec3 uCol; uniform float uA; void main(){ gl_FragColor = vec4(uCol, uA); }',
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); mesh.frustumCulled = false; mesh.renderOrder = 100;
  return mesh;
}

// runway designation atlas: "27" (this end) | "09" (far end); white on black, read in the ground shader
export function runwayNumbers() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; // high resolution + mipmaps: crisp at phone distance
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 500px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  [['27', 256], ['09', 768]].forEach(([t, x]) => {
    g.save(); g.translate(x, 264); g.scale(0.62, 1.0);
    g.fillText(t[0], -190, 0); g.fillText(t[1], 190, 0);
    g.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// airport signs beside the taxiway connectors (black / yellow location and direction signs)
export function buildSigns(fogPatch) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const labels = [['A1', '27 →'], ['A2', '← 27'], ['A3', '09 →'], ['A', 'B →']];
  labels.forEach((l, i) => {
    const y = i * 64;
    g.fillStyle = '#111'; g.fillRect(0, y, 200, 64);
    g.fillStyle = '#f2c230'; g.fillRect(200, y, 312, 64);
    g.font = '700 46px Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = '#f2c230'; g.fillText(l[0], 100, y + 33);
    g.fillStyle = '#111'; g.fillText(l[1], 356, y + 33);
    g.strokeStyle = '#f2c230'; g.lineWidth = 4; g.strokeRect(4, y + 4, 192, 56);
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const fronts = [], backs = [];
  const spots = [[-14, 40, 0], [786, 40, 1], [1586, 40, 2], [2386, 40, 3], [400, 160, 3], [1200, 160, 0]];
  spots.forEach(([x, z, k]) => {
    const f = new THREE.PlaneGeometry(4.0, 1.0).translate(0, 1.15, 0.13);
    const uv = f.attributes.uv.array; for (let i = 1; i < uv.length; i += 2) uv[i] = (3 - k + uv[i]) / 4;
    f.rotateY(Math.PI).translate(x, 0, z); // faces the runway (−z)
    fronts.push(f);
    const b = new THREE.BoxGeometry(4.1, 1.1, 0.22).translate(0, 1.15, 0);
    const l1 = new THREE.BoxGeometry(0.12, 0.65, 0.12).translate(-1.6, 0.32, 0), l2 = new THREE.BoxGeometry(0.12, 0.65, 0.12).translate(1.6, 0.32, 0);
    [b, l1, l2].forEach((q) => { q.rotateY(Math.PI).translate(x, 0, z); backs.push(q); });
  });
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(mergeSimple(fronts), fogPatch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }))));
  grp.add(new THREE.Mesh(mergeSimple(backs), fogPatch(new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.7 }))));
  return grp;
}
function mergeSimple(geoms) {
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; parts.forEach((g) => { n += g.attributes.position.count; });
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), T = new Float32Array(n * 2);
  let o = 0;
  parts.forEach((g) => { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); T.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(T, 2));
  return g;
}
