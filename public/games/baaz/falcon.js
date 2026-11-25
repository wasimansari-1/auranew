/* Baaz 3D — the peregrine falcon: two Meshy models (made from reference pictures; sources, task ids and
 * notes in the NEXORNG character library, "peregrine-falcon"):
 *   perch.glb  standing, wings folded — on the falconer's glove (betting, the landing)
 *   fly.glb    wings spread — the flight, the launch and the stoop
 * Meshy's auto-rig is for people and four-legged animals only, so both are rigged here, at load: bones
 * are placed at the bird's joints (measured on the meshes) and every vertex is weighted by where it is.
 * The flight model: shoulder → elbow → wrist on each wing (flap, sweep, twist, fold, the hand folding
 * in on the upstroke), head, tail (pitch, fan). The perched model: feet (they keep their grip on the
 * glove), body (crouch, rouse, breath), head (the glances). Every frame both are posed from the same
 * state J (timeline.falconAt); J.perch says which one shows — they hand over in about 0.13 s while the
 * wings open at the launch or fold after the landing (a dithered cross-fade).
 * Falcon axes: +X beak, +Y back, +Z right wing; metres (wingspan ≈ 0.95 m). */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { GLTFLoader } from '../_core/vendor/three-0.170.0/addons/GLTFLoader.js';
import { footWorld, THETA_PERCH } from './timeline.js';

function sstep(a, b, x) { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); }

// ------------------------------------------------------------------ shading: sun back-light + rim
export const FU = { uSunView: { value: new THREE.Vector3(0, 0, 1) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.8) } };
function featherShading(mat, key) {
  mat.metalness = 0; mat.metalnessMap = null; mat.roughnessMap = null; mat.roughness = 0.78; mat.envMapIntensity = 0.7;
  if (mat.map) mat.map.anisotropy = 8;
  if (mat.normalMap) mat.normalScale.set(0.9, 0.9);
  mat.alphaHash = true; mat.transparent = false; mat.opacity = 1;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSunView = FU.uSunView; sh.uniforms.uSunCol = FU.uSunCol;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol;')
      .replace('#include <opaque_fragment>', `
        {
          vec3 Vc = normalize( vViewPosition );
          float back = pow( max( dot( -Vc, uSunView ), 0.0 ), 4.0 );
          float rim = pow( 1.0 - abs( dot( normal, Vc ) ), 3.0 );
          outgoingLight += uSunCol * diffuseColor.rgb * ( 0.35 * back + 0.4 * rim * ( 0.35 + 0.65 * back ) );
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'falcon-' + key;
  return mat;
}

// dequantised float copy of an attribute, baked by a matrix (positions) or its normal matrix (normals)
function bake(geo, m) {
  const out = new THREE.BufferGeometry();
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  const P = new Float32Array(p.count * 3), N = new Float32Array(p.count * 3), UV = new Float32Array(p.count * 2);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
    UV[i * 2] = uv.getX(i); UV[i * 2 + 1] = uv.getY(i);
  }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  out.setIndex(geo.index);
  return out;
}
// skin a baked geometry: weightsAt(x, y, z, out[4 pairs]) → up to 4 (bone, weight)
function skin(geo, bones, weightsAt) {
  const p = geo.attributes.position, n = p.count;
  const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4), w = [];
  for (let i = 0; i < n; i++) {
    w.length = 0; weightsAt(p.getX(i), p.getY(i), p.getZ(i), w);
    let s = 0; for (let k = 0; k < w.length; k += 2) s += w[k + 1];
    for (let k = 0, q = 0; k < w.length && q < 4; k += 2, q++) { SI[i * 4 + q] = w[k]; SW[i * 4 + q] = w[k + 1] / s; }
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  const mesh = new THREE.SkinnedMesh(geo, null);
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  return mesh;
}
function bone(parent, x, y, z) { const b = new THREE.Bone(); b.position.set(x, y, z); if (parent) parent.add(b); return b; }
async function firstMesh(url) {
  const g = await new GLTFLoader().loadAsync(url);
  let mesh = null; g.scene.updateMatrixWorld(true); g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  return mesh;
}

export async function loadFalcon(base) {
  const group = new THREE.Group(); group.name = 'falcon';
  const [flyM, perchM] = await Promise.all([firstMesh(base + 'assets/fly.glb'), firstMesh(base + 'assets/perch.glb')]);

  // ---------------------------------------------------------- the flying model
  // model: beak +Z, back +Y, left wing +X, span 1.9 → ours: ×0.5, beak +X, right wing +Z
  const mF = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5)).multiply(flyM.matrixWorld);
  const gF = bake(flyM.geometry, mF);
  const fRoot = bone(null, 0, 0, 0);
  const head = bone(fRoot, 0.11, 0.02, 0), tail = bone(fRoot, -0.08, 0.005, 0);
  const wing = (m) => { const sh = bone(fRoot, 0.05, 0.012, 0.05 * m), el = bone(sh, 0.012, 0, 0.13 * m), wr = bone(el, -0.025, 0, 0.1 * m); return { m, sh, el, wr }; };
  const WR = wing(1), WL = wing(-1);
  const fBones = [fRoot, head, tail, WR.sh, WR.el, WR.wr, WL.sh, WL.el, WL.wr];
  const flyMesh = skin(gF, fBones, (x, y, z, w) => {
    const a = Math.abs(z), side = z >= 0 ? 3 : 6;
    const kS = sstep(0.035, 0.08, a), kE = sstep(0.15, 0.21, a), kW = sstep(0.25, 0.31, a);
    if (kS > 0) {
      if (kS < 1) w.push(0, 1 - kS);
      if (kE < 1) w.push(side, kS * (1 - kE));
      if (kE > 0 && kW < 1) w.push(side + 1, kS * kE * (1 - kW));
      if (kW > 0) w.push(side + 2, kS * kE * kW);
      return;
    }
    const kH = sstep(0.1, 0.14, x), kT = sstep(-0.07, -0.11, x);
    if (kH > 0) { w.push(1, kH); if (kH < 1) w.push(0, 1 - kH); return; }
    if (kT > 0) { w.push(2, kT); if (kT < 1) w.push(0, 1 - kT); return; }
    w.push(0, 1);
  });
  flyMesh.material = featherShading(flyM.material, 'fly');
  group.add(flyMesh);

  // ---------------------------------------------------------- the perched model
  // model: beak +Z, up +Y, height 1.55, feet at y −0.777 under z 0.26 → ours: ×0.25, beak +X, origin at the feet
  const mP = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.25, 0.25, 0.25)).multiply(new THREE.Matrix4().makeTranslation(0, 0.777, -0.26)).multiply(perchM.matrixWorld);
  const gP = bake(perchM.geometry, mP);
  const pRoot = bone(null, 0, 0, 0);                  // the feet (they stay on the glove)
  const body = bone(pRoot, 0, 0.045, 0);              // the ankles: the body pitches / rouses about them
  const pHead = bone(body, 0.06, 0.225, 0);           // the base of the neck
  const pBones = [pRoot, body, pHead];
  const perchMesh = skin(gP, pBones, (x, y, z, w) => {
    const kF = x > -0.06 ? 1 - sstep(0.018, 0.05, y) : 0, kH = sstep(0.245, 0.285, y);
    if (kF > 0) { w.push(0, kF); if (kF < 1) w.push(1, 1 - kF); return; }
    if (kH > 0) { w.push(2, kH); if (kH < 1) w.push(1, 1 - kH); return; }
    w.push(1, 1);
  });
  perchMesh.material = featherShading(perchM.material, 'perch');
  const perch = new THREE.Group(); perch.add(perchMesh);
  group.add(perch);

  let tris = 0; for (const m of [flyMesh, perchMesh]) tris += m.geometry.index.count / 3;

  // ---------------------------------------------------------- pose (J from timeline.falconAt)
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
  const eul = new THREE.Euler(0, 0, 0, 'YZX'), F = [0, 0, 0];
  function mirrorQ(q, m) { if (m < 0) { q.x = -q.x; q.y = -q.y; } return q; }
  function poseWing(W, w) {
    const f = w.f, m = W.m, h = w.h >= 0 ? w.h : f;
    // shoulder: sweep (folding takes the arm back) · elevation · twist
    qa.setFromAxisAngle(AY, w.s - 0.95 * f); qb.setFromAxisAngle(AX, -w.e * (1 - 0.35 * f) + 0.1 * f); qc.setFromAxisAngle(AZ, -w.tw * (1 - f));
    W.sh.quaternion.copy(mirrorQ(qa.multiply(qb).multiply(qc), m));
    // elbow: the forearm folds back and droops a little; wrist: the hand folds back over it (upstroke, stoop)
    qa.setFromAxisAngle(AY, -0.3 * h); qb.setFromAxisAngle(AX, 0.22 * h);
    W.el.quaternion.copy(mirrorQ(qa.multiply(qb), m));
    qa.setFromAxisAngle(AY, -0.6 * h); qb.setFromAxisAngle(AX, 0.15 * h + 0.18 * Math.max(-0.4, Math.min(0.6, w.e)) * (1 - h));
    W.wr.quaternion.copy(mirrorQ(qa.multiply(qb), m));
  }
  function pose(J) {
    const wp = J.perch || 0;
    group.position.set(0, 0, 0); group.quaternion.identity();
    // flying model: the whole state
    flyMesh.visible = wp < 0.999;
    if (flyMesh.visible) {
      eul.set(J.phi, -J.psi, J.theta, 'YZX');
      fRoot.quaternion.setFromEuler(eul); fRoot.position.set(J.x, J.y, J.z);
      const lvl = (J.headLevel == null ? 1 : J.headLevel) * J.theta;
      eul.set(-0.6 * J.phi, J.headYaw || 0, -0.6 * lvl + (J.headPitch || 0), 'YZX');
      head.quaternion.setFromEuler(eul);
      poseWing(WR, J.wR); poseWing(WL, J.wL);
      tail.rotation.set(0, 0, J.tailPitch || 0); tail.scale.set(1, 1, 1 + 0.45 * (J.tailSp || 0));
      flyMesh.material.opacity = 1 - wp;
    }
    // perched model: stands on its feet (where timeline puts them), the body leans about the ankles
    perch.visible = wp > 0.001;
    if (perch.visible) {
      footWorld(J, F);
      perch.position.set(F[0], F[1], F[2]); perch.rotation.set(0, -J.psi, 0);
      eul.set(J.phi, 0, 0.55 * (J.theta - THETA_PERCH), 'YZX'); body.quaternion.setFromEuler(eul); // (this model leans about its ankles: a softer crouch)
      body.position.y = 0.045 + 0.04 * ((J.legL == null ? 1 : J.legL) - 1);
      const br = J.breath || 0, pf = 1 + (J.puff || 0) * 0.8;
      body.scale.set(1 + 0.008 * br, 1 + 0.004 * br, (1 + 0.012 * br) * pf);
      eul.set(-0.5 * J.phi, J.headYaw || 0, -(J.theta - THETA_PERCH) * 0.5 + (J.headPitch || 0), 'YZX');
      pHead.quaternion.setFromEuler(eul);
      perchMesh.material.opacity = wp;
    }
  }
  // the falcon's centre (camera, sun, the cash-out feather)
  group.userData = { pose, triangles: Math.round(tris), centre: fRoot };
  return group;
}
