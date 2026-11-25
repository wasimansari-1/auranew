/* Baaz 3D — the falconer: a Meshy character (rigged by Meshy, biped with finger bones, 1.78 m; source and
 * task ids in the NEXORNG character library, "desert-falconer") in a sand robe, a dark wool cloak and a
 * head-wrap, a tan leather gauntlet on his left hand. He plays a calm stretch of Meshy's Idle clip (breathing, a
 * slight weight shift) on the wall clock; his left arm is posed here every frame by a two-bone IK: the gloved fist
 * held up at the glove point (timeline.GLOVE) for the falcon, lowered after the launch and raised again
 * when it comes home; the fingers close into a fist and his head follows the bird.
 * (Only a calm stretch of the Idle clip is used: the whole clip turns about.)
 * Everything comes from (τ, ret, wall clock, the falcon's position): a joining player sees the same. */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { GLTFLoader } from '../_core/vendor/three-0.170.0/addons/GLTFLoader.js';
import { GLOVE, S5, T_RET0, groundAt } from './timeline.js';

export const STAND = { x: -0.34, z: -0.24, yaw: 22 * Math.PI / 180 }; // where he stands, his facing (from +Z towards +X)

// how far the gloved arm is raised (0 down … 1 up for the bird): pure function of the round
export function armAt(tau, tc, ret) {
  if (tau >= 0) return 1 - S5(0.35, 1.9, tau);
  return ret ? S5(T_RET0 + 0.2, T_RET0 + 1.8, tau) : 1;
}

export async function loadFalconer(base, withFog) {
  const g = await new GLTFLoader().loadAsync(base + 'assets/falconer.glb');
  const root = new THREE.Group(), inner = g.scene;
  root.add(inner);
  root.position.set(STAND.x, groundAt(STAND.x, STAND.z), STAND.z);
  root.rotation.y = STAND.yaw;
  const bones = {}; let tris = 0;
  inner.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      m.metalness = 0; m.metalnessMap = null; m.roughness = 0.88; m.envMapIntensity = 0.6;
      if (m.map) m.map.anisotropy = 8;
      if (m.normalMap) m.normalScale.set(0.9, 0.9);
      o.material = withFog(m, 'falconer');
      tris += o.geometry.index.count / 3;
    }
  });
  const mixer = new THREE.AnimationMixer(inner);
  const clip = g.animations[0], idle = mixer.clipAction(clip); idle.play();
  const dur = clip.duration, IDLE_T = 1.0;

  const hfB = bones.headfront, UP = new THREE.Vector3(0, 1, 0), HF = hfB ? hfB.position.clone() : null;
  const sh = bones.LeftArm, el = bones.LeftForeArm, hand = bones.LeftHand, neck = bones.neck, headB = bones.Head;
  const fingers = ['Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((i) => bones['LeftHand' + f + i])).filter(Boolean);
  const thumb = [1, 2, 3].map((i) => bones['LeftHandThumb' + i]).filter(Boolean);
  root.updateMatrixWorld(true);
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const LA = v1.setFromMatrixPosition(sh.matrixWorld).distanceTo(v2.setFromMatrixPosition(el.matrixWorld));
  const LB = v1.setFromMatrixPosition(el.matrixWorld).distanceTo(v2.setFromMatrixPosition(hand.matrixWorld));
  // each finger bone's own bend axis (local), found on the rest pose: across the finger, curling towards the palm
  const W = (b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  const hp0 = W(hand), across = W(bones.LeftHandIndex1).sub(W(bones.LeftHandPinky1)).normalize();
  const along = W(bones.LeftHandMiddle1).sub(hp0).normalize();
  const palmSide = W(bones.LeftHandThumb2).sub(hp0); palmSide.addScaledVector(along, -palmSide.dot(along)).addScaledVector(across, -palmSide.dot(across)).normalize();
  const curl = [];
  for (const b of fingers.concat(thumb)) {
    const c = b.children.find((o) => o.isBone); if (!c) continue;
    const dw = W(c).sub(W(b)).normalize();
    const isThumb = thumb.indexOf(b) >= 0;
    const axW = new THREE.Vector3().crossVectors(dw, isThumb ? along : palmSide).normalize();
    // the sign: a small turn must bring the child towards the palm side (thumb: across the fingers' front)
    const test = dw.clone().applyAxisAngle(axW, 0.3);
    if (test.dot(isThumb ? along.clone().negate() : palmSide) < dw.dot(isThumb ? along.clone().negate() : palmSide)) axW.negate();
    const qw = b.getWorldQuaternion(new THREE.Quaternion()).invert();
    curl.push({ b, ax: axW.applyQuaternion(qw).normalize(), a: isThumb ? 0.45 : (/1$/.test(b.name) ? 1.35 : 1.45) });
  }
  const keep = { sh: new THREE.Quaternion(), el: new THREE.Quaternion(), hand: new THREE.Quaternion() };

  const qt = new THREE.Quaternion(), qw = new THREE.Quaternion();
  function turnWorld(b, axis, ang) {
    b.updateWorldMatrix(true, false);
    b.getWorldQuaternion(qw); qw.premultiply(qt.setFromAxisAngle(axis, ang));
    b.parent.getWorldQuaternion(qt).invert(); b.quaternion.copy(qt.multiply(qw));
    b.updateWorldMatrix(false, true);
  }
  // rotate bone b (world) so that the direction from its origin to `from` points at `to`
  function aim(b, from, to) {
    b.updateWorldMatrix(true, false);
    const o = v3.setFromMatrixPosition(b.matrixWorld);
    const d0 = from.clone().sub(o).normalize(), d1 = to.clone().sub(o).normalize();
    q1.setFromUnitVectors(d0, d1);                       // world delta
    b.getWorldQuaternion(q2); q2.premultiply(q1);         // new world rotation
    b.parent.getWorldQuaternion(q1).invert();
    b.quaternion.copy(q1.multiply(q2));
    b.updateWorldMatrix(false, true);
  }
  const T = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Vector3(), H = new THREE.Vector3(), pole = new THREE.Vector3(), tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3(Math.sin(STAND.yaw), 0, Math.cos(STAND.yaw)), left = new THREE.Vector3(Math.cos(STAND.yaw), 0, -Math.sin(STAND.yaw));
  const FIST = [0.07, 0.045], ROLL = 0.25; // wrist → the top of the fist (along the forearm, up), where the feet grip; the fist's roll
  const look = new THREE.Vector3();

  // st: { tau, tc, ret, wall, falcon: Vector3, curl (0..1) }
  const rest = Object.values(bones).map((b) => [b, b.quaternion.clone(), b.position.clone()]);
  function pose(tau, tc, ret, wall, falconPos) {
    for (let i = 0; i < rest.length; i++) { rest[i][0].quaternion.copy(rest[i][1]); rest[i][0].position.copy(rest[i][2]); } // (bones the clip leaves alone must not accumulate)
    // Meshy's Idle is a restless one (it turns about and shifts its weight): only a calm stretch of it plays,
    // swaying slowly back and forth round 1.0 s — breathing and a little weight shift
    idle.time = Math.min(dur, IDLE_T + 0.13 * Math.sin(wall * 0.55) + 0.05 * Math.sin(wall * 1.31 + 1));
    mixer.update(0);
    root.updateMatrixWorld(true);
    const up = armAt(tau, tc, ret);
    // a little recoil as the bird pushes off the fist
    const kick = tau > -0.05 && tau < 0.8 ? -0.035 * Math.sin(Math.PI * S5(-0.05, 0.8, tau)) : 0;
    if (up > 0.001) {
      keep.sh.copy(sh.quaternion); keep.el.copy(el.quaternion); keep.hand.copy(hand.quaternion);
      S.setFromMatrixPosition(sh.matrixWorld);
      T.set(GLOVE[0], GLOVE[1] + kick, GLOVE[2]);
      tmp.copy(T).sub(S); tmp.y = 0; tmp.normalize();
      T.addScaledVector(tmp, -FIST[0]); T.y -= FIST[1];
      const d = Math.min(T.distanceTo(S), (LA + LB) * 0.999);
      const dir = tmp.copy(T).sub(S).normalize();
      // the elbow: down and out to his left, in the plane of the reach
      pole.set(0, -1, 0).addScaledVector(left, 0.55).addScaledVector(fwd, -0.15);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const ca = (LA * LA + d * d - LB * LB) / (2 * LA * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
      E.copy(S).addScaledVector(dir, LA * ca).addScaledVector(pole, LA * sa);
      aim(sh, v1.setFromMatrixPosition(el.matrixWorld), E);
      aim(el, v1.setFromMatrixPosition(hand.matrixWorld), T);
      // the hand straight on from the forearm
      H.setFromMatrixPosition(hand.matrixWorld);
      const tip = bones.LeftHandMiddle1 || bones.LeftHand_End;
      const fdir = dir.copy(T).sub(E).normalize();
      if (tip) aim(hand, v1.setFromMatrixPosition(tip.matrixWorld), v2.copy(H).addScaledVector(fdir, 0.1));
      // roll the fist about the forearm: thumb side up (the bird stands across the index finger and thumb)
      const th = v1.setFromMatrixPosition(bones.LeftHandThumb1.matrixWorld).sub(H); th.addScaledVector(fdir, -th.dot(fdir)).normalize();
      const upv = v2.set(0, 1, 0).addScaledVector(fdir, -fdir.y).normalize();
      let ang = Math.acos(Math.max(-1, Math.min(1, th.dot(upv)))); if (v3.crossVectors(th, upv).dot(fdir) < 0) ang = -ang;
      q1.setFromAxisAngle(fdir, ang + ROLL); hand.getWorldQuaternion(q2); q2.premultiply(q1);
      hand.parent.getWorldQuaternion(q1).invert(); hand.quaternion.copy(q1.multiply(q2));
      if (up < 0.999) { for (const k of ['sh', 'el', 'hand']) { const b = k === 'sh' ? sh : k === 'el' ? el : hand; b.quaternion.copy(keep[k].slerp(b.quaternion, up)); } } // (from the clip's own arm)
    }
    // the gloved fist (closed)
    for (const c of curl) c.b.quaternion.multiply(q1.setFromAxisAngle(c.ax, c.a));
    // the head follows the falcon (at most ~50° aside, ~35° up/down): measured on the head's own facing (Head → headfront)
    if (falconPos && headB && hfB) {
      root.updateMatrixWorld(true);
      const hp = v1.setFromMatrixPosition(headB.matrixWorld), hf = v2.copy(HF).applyQuaternion(headB.getWorldQuaternion(q1)); // (the rest offset: the clip moves `headfront` itself)
      look.copy(falconPos).sub(hp);
      const yawNow = Math.atan2(hf.x, hf.z), yawTo = Math.atan2(look.x, look.z);
      let dy = yawTo - yawNow; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); dy = Math.max(-0.85, Math.min(0.85, dy));
      const pNow = Math.atan2(hf.y, Math.hypot(hf.x, hf.z)), pTo = Math.atan2(look.y, Math.hypot(look.x, look.z));
      const dp = Math.max(-0.6, Math.min(0.6, pTo - pNow));
      const r = v3.set(Math.cos(yawTo), 0, -Math.sin(yawTo)); // the look's horizontal right… (a turn about it by −dp raises the look)
      UP.set(0, 1, 0);
      turnWorld(neck, UP, dy * 0.45); turnWorld(neck, r, -dp * 0.4);
      turnWorld(headB, UP, dy * 0.5); turnWorld(headB, r, -dp * 0.5);
    }
  }
  root.userData = { pose, triangles: Math.round(tris), bones };
  return root;
}
