import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/*
 * KayKit Space Base Bits by Kay Lousberg (CC0): the modular pods, tubes and towers the hub and
 * landmarks are built from. Its colour atlas is recoloured to the world's lilac and pink.
 */

const BASE = `${import.meta.env.BASE_URL}assets/kaykit/`;
const kit = new Map();
let shared = null;

export async function loadKit(names) {
  const loader = new GLTFLoader();
  await Promise.all(
    names.map(async (name) => {
      const gltf = await loader.loadAsync(`${BASE}${name}.gltf`);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        // One material for every piece, so merged pieces cost one draw call.
        shared ??= o.material;
        o.material = shared;
      });
      kit.set(name, gltf.scene);
    }),
  );
}

/** A fresh copy of a kit piece at the given scale, casting and receiving shadows. */
export function piece(name, scale = 1) {
  const src = kit.get(name);
  if (!src) throw new Error(`Kit piece not loaded: ${name}`);
  const g = src.clone(true);
  g.scale.setScalar(scale);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

export const kitMaterial = () => shared;
