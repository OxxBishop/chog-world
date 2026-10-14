import * as THREE from 'three';

/*
 * The loading screen, and getting the first frame up fast.
 *
 * The load runs in steps, each given a share of the bar by how long it usually takes; within a step
 * the bar moves as its parts finish. Steps can overlap (the downloads all run at once). How long each
 * step took is logged to the console, and kept for ?debug.
 */
export function createLoader(el, steps) {
  const bar = el.querySelector('.load-bar i');
  const sub = el.querySelector('.sub');
  const t0 = performance.now();
  const state = steps.map(([id, share, label]) => ({ id, share, label, f: 0, start: null, end: null }));
  const total = state.reduce((s, x) => s + x.share, 0);
  let shown = 0;
  const render = () => {
    const f = state.reduce((s, x) => s + x.share * x.f, 0) / total;
    // Never runs backwards, even if a step finds more to do than it first thought.
    shown = Math.max(shown, f);
    if (bar) bar.parentElement.style.setProperty('--p', shown.toFixed(3));
    const now = state.find((x) => x.f < 1) ?? state[state.length - 1];
    sub.textContent = `${now.label}... ${Math.round(shown * 100)}%`;
  };
  render();
  const api = {
    times: {},
    // How far along a step is, 0 to 1.
    set(id, f) {
      const s = state.find((x) => x.id === id);
      const t = (performance.now() - t0) / 1000;
      s.start ??= t;
      s.f = Math.min(1, Math.max(s.f, f));
      if (s.f >= 1 && s.end === null) {
        s.end = t;
        api.times[id] = +(s.end - s.start).toFixed(2);
      }
      render();
    },
    // Lifts the loading screen (unless keep: the intro carries on from it). Returns the seconds from
    // start to the first frame.
    finish({ keep = false } = {}) {
      for (const s of state) api.set(s.id, 1);
      if (!keep) el.classList.add('done');
      api.times.total = +((performance.now() - t0) / 1000).toFixed(2);
      console.info('Load times (s):', JSON.stringify(api.times));
      return api.times.total;
    },
    // Marks something that finishes after the loading screen is gone (the clouds).
    mark(name) {
      api.times[name] = +((performance.now() - t0) / 1000).toFixed(2);
      console.info(`Load: ${name} at ${api.times[name]} s`);
    },
  };
  return api;
}

/**
 * Builds every shader a draw needs without stalling on any of them. The draw runs once with nothing
 * actually drawn, noting each object, material and render target it would have used. Each one is then
 * compiled where the browser can do it in the background (KHR_parallel_shader_compile), and the
 * promise settles once all are ready, so drawing for real afterwards finds every shader built.
 * Browsers without that extension still compile them all here, just not in the background.
 */
export async function prewarm(renderer, draw, onProgress) {
  const seen = new Map();
  const real = renderer.renderBufferDirect;
  const realRender = renderer.render;
  // Shadow maps are drawn with no scene of their own: their shaders take the lights of the scene being
  // drawn at the time, but no fog. They are compiled against that scene with its fog put aside.
  let drawing = null;
  renderer.render = function (scene, camera) {
    const outer = drawing;
    drawing = scene;
    try {
      return realRender.call(this, scene, camera);
    } finally {
      drawing = outer;
    }
  };
  renderer.renderBufferDirect = (camera, scene, geometry, material, object) => {
    const fogless = !scene;
    scene ??= drawing;
    const target = renderer.getRenderTarget();
    // The same material drawn into another scene (other lights, no fog) needs its own shader.
    let key = `${material.uuid}|${object.isInstancedMesh ? 'i' : object.isSkinnedMesh ? 's' : 'm'}|${target ? 'rt' : 'screen'}|${scene?.id}`;
    // Shadow maps reuse one depth material, reset for each object it draws: keep a copy of each state.
    if (material.isMeshDepthMaterial || material.isMeshDistanceMaterial) {
      key += `|${material.side}|${!!material.map}|${material.alphaTest > 0}|${!!material.alphaMap}|${!!material.displacementMap}`;
      if (!seen.has(key)) material = material.clone();
    }
    if (!seen.has(key)) seen.set(key, { camera, scene, material, object, target, fogless });
  };
  try {
    draw();
  } finally {
    renderer.renderBufferDirect = real;
    renderer.render = realRender;
  }
  // The dry run may have used up a pending shadow redraw without drawing it.
  if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;

  const prev = [renderer.getRenderTarget(), renderer.getActiveCubeFace(), renderer.getActiveMipmapLevel()];
  const empty = new THREE.Scene();
  const jobs = [];
  for (const { camera, scene = empty, material, object, target, fogless } of seen.values()) {
    renderer.setRenderTarget(target);
    // Compile the material on the very object that used it, so the shader matches exactly
    // (instancing, render target), then put back the object's own material.
    const own = object.material;
    const fog = scene.fog;
    object.material = material;
    if (fogless) scene.fog = null;
    try {
      jobs.push(renderer.compileAsync(object, camera, scene));
    } finally {
      object.material = own;
      scene.fog = fog;
    }
  }
  renderer.setRenderTarget(...prev);
  let done = 0;
  await Promise.all(jobs.map((p) => p.then(() => onProgress?.(++done / jobs.length))));
  return jobs.length;
}
