/* Tiger Chase 3D — the tiger and the chital stag: rigged models (made with Meshy; sources and the list of
 * movements are in the NEXORNG character library) with their movement clips. Nothing plays on its own
 * clock: every frame main.js says which clips show, at which second and with which weight — all taken
 * from the round time (timeline.js), so a player who joins at any moment sees exactly the same picture. */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { GLTFLoader } from '../_core/vendor/three-0.170.0/addons/GLTFLoader.js';

const loader = new GLTFLoader();

// o: { scale, foot (model units from its origin down to the soles), layer (shadow pass), withFog, levelBones }
export async function loadAnimal(url, o) {
  const g = await loader.loadAsync(url);
  const root = new THREE.Group(), tilt = new THREE.Group(), inner = g.scene;
  inner.scale.setScalar(o.scale); inner.position.y = o.foot * o.scale;
  tilt.add(inner); root.add(tilt);
  let tris = 0; const bones = {};
  inner.traverse((m) => {
    if (m.isBone) bones[m.name] = m;
    if (!m.isMesh) return;
    m.frustumCulled = false; m.layers.enable(o.layer);
    const mat = m.material;
    mat.metalness = 0; mat.metalnessMap = null; mat.roughness = 1; mat.envMapIntensity = 0.5;
    if (mat.map) mat.map.anisotropy = 8;
    if (mat.normalMap) mat.normalScale.set(0.8, 0.8);
    m.material = o.withFog(mat);
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  const mixer = new THREE.AnimationMixer(inner), act = {};
  for (const c of g.animations) { const a = mixer.clipAction(c); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0); act[c.name] = a; }
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  // the neck's and head's own carriage (as the model stands): some library clips let the neck droop or tip
  // the head back on this skeleton. levelBones: from the base of the neck to the head, in that order.
  const lev = (o.levelBones || []).map((n) => bones[n]).filter(Boolean).map((b) => ({ b, rest: new THREE.Quaternion() }));
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  if (lev.length) { inner.updateWorldMatrix(true, true); inner.getWorldQuaternion(qa).invert(); for (const l of lev) l.rest.copy(qa).multiply(l.b.getWorldQuaternion(qb)); }
  root.userData = {
    triangles: Math.round(tris), tilt, bones,
    dur: (name) => act[name].getClip().duration,
    // list: [[clip, seconds, weight, once], …] (weights are normalised; `once` clips hold their last frame)
    // extra: { bone: [rx, ry, rz] } small corrections added after the clips (radians, the bone's own axes)
    // level: 0..1 — how far the neck and head are brought back to their standing carriage (o.levelBones)
    set(list, extra, level) {
      for (const k in act) act[k].setEffectiveWeight(0);
      let s = 0; for (let i = 0; i < list.length; i++) s += Math.max(0, list[i][2]);
      for (let i = 0; i < list.length; i++) {
        const it = list[i]; if (!(it[2] > 0)) continue;
        const a = act[it[0]], d = a.getClip().duration;
        a.time = it[3] ? Math.min(Math.max(it[1], 0), d - 1e-3) : ((it[1] % d) + d) % d;
        a.setEffectiveWeight(it[2] / s);
      }
      mixer.update(0);
      if (level > 0) for (let i = 0; i < lev.length; i++) { // back towards the standing carriage (level: 0..1), parents first
        const l = lev[i];
        inner.getWorldQuaternion(qa).invert(); l.b.parent.getWorldQuaternion(qb);
        qb.premultiply(qa).invert().multiply(l.rest);           // the local rotation that gives the standing carriage
        l.b.quaternion.slerp(qb, level);
      }
      if (extra) for (const k in extra) { const b = bones[k], r = extra[k]; if (b) b.quaternion.multiply(q.setFromEuler(e.set(r[0], r[1], r[2]))); }
    },
  };
  return root;
}
