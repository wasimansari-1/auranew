/* Sixer Sky 3D — the players: rigged models (made with Meshy; sources and the list of movements are in
 * the NEXORNG character library) and their movement clips. Nothing plays on its own clock: every frame
 * main.js says which clips show, at which second and with which weight — all from the round time. */
import * as THREE from '../_core/vendor/three-0.170.0/three.module.min.js';
import { GLTFLoader } from '../_core/vendor/three-0.170.0/addons/GLTFLoader.js';

const loader = new GLTFLoader();

// o: { withFog, base: name for the clip inside the model's own file, clips: { name: url of a clip-only file } }
export async function loadActor(url, o) {
  const names = Object.keys(o.clips || {});
  const [g, ...extra] = await Promise.all([loader.loadAsync(url), ...names.map((n) => loader.loadAsync(o.clips[n]))]);
  const root = new THREE.Group(), inner = g.scene;
  root.add(inner);
  const bones = {};
  inner.traverse((m) => {
    if (m.isBone) bones[m.name] = m;
    if (!m.isMesh) return;
    m.frustumCulled = false; m.castShadow = true;
    const mat = m.material;
    mat.metalness = 0; mat.metalnessMap = null; mat.roughness = 1; mat.envMapIntensity = 0.6;
    if (mat.map) mat.map.anisotropy = 8;
    m.material = o.withFog(mat);
  });
  const mixer = new THREE.AnimationMixer(inner), act = {};
  const add = (clip, name) => { clip.name = name; const a = mixer.clipAction(clip); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0); act[name] = a; };
  if (g.animations[0]) add(g.animations[0], o.base || 'base');
  extra.forEach((x, i) => { if (x.animations[0]) add(x.animations[0], names[i]); });
  root.userData = {
    bones,
    dur: (name) => act[name].getClip().duration,
    // list: [[clip, seconds, weight, once], …] (weights are normalised; `once` clips hold their last frame)
    set(list) {
      for (const k in act) act[k].setEffectiveWeight(0);
      let s = 0; for (let i = 0; i < list.length; i++) s += Math.max(0, list[i][2]);
      for (let i = 0; i < list.length; i++) {
        const it = list[i]; if (!(it[2] > 0)) continue;
        const a = act[it[0]], d = a.getClip().duration;
        a.time = it[3] ? Math.min(Math.max(it[1], 0), d - 1e-3) : ((it[1] % d) + d) % d;
        a.setEffectiveWeight(it[2] / s);
      }
      mixer.update(0);
    },
  };
  return root;
}
