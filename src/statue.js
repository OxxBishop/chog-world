import * as THREE from 'three';
import { makeChog, CHOG_HEIGHT } from './chog.js';

/*
 * A gold Chog statue (the user, 10-23: the brass placeholders "do not look like chogs"): the Chog itself,
 * the plain body every wallet Chog wears, cast in gold mid-cheer, standing on whatever plinth it's given.
 * It comes in once its model has loaded; until then the plinth stands alone.
 *
 * goldChog(height) -> THREE.Group (its feet at the group's origin)
 */
const GOLD = new THREE.MeshStandardMaterial({ color: '#e9bd55', metalness: 0.92, roughness: 0.3, emissive: new THREE.Color('#3b2600'), emissiveIntensity: 0.35 });
const STILL = new THREE.PerspectiveCamera();

export function goldChog(height = 3) {
  const g = new THREE.Group();
  makeChog({ model: 'models/npcs/plain.glb', name: 'Statue', traits: {} })
    .then(async (c) => {
      await Promise.race([c.ready, new Promise((r) => setTimeout(r, 6000))]);
      // Struck in a pose: its cheer, run on a little and then held for good.
      c.play('cheer');
      for (let i = 0; i < 12; i++) c.update(0.05, STILL);
      c.root.traverse((o) => {
        if (o.isSprite) o.visible = false;
        else if (o.isMesh) {
          // (Never baked in with the room's merged meshes: it's skinned.)
          o.userData.keep = true;
          o.material = GOLD;
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      c.root.scale.setScalar(height / CHOG_HEIGHT);
      g.add(c.root);
    })
    .catch(() => {});
  return g;
}
