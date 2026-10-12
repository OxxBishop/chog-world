import * as THREE from 'three';

/**
 * ?debug in the address: frame stats and switches for the heavy parts (clouds, post-processing,
 * shadows), so the cost of each can be measured on any machine. Works in production builds.
 */
export function createDebug({ renderer, post, sky }) {
  const state = { clouds: true, post: true, shadows: renderer.shadowMap.enabled };
  renderer.info.autoReset = false;

  const el = document.createElement('div');
  el.className = 'debug';
  el.innerHTML =
    '<div class="debug-stats">--</div>' +
    ['clouds', 'post', 'shadows'].map((k) => `<label><input type="checkbox" data-k="${k}"> ${k}</label>`).join('');
  document.body.appendChild(el);
  const stats = el.querySelector('.debug-stats');
  const boxes = [...el.querySelectorAll('input')];

  const apply = () => {
    boxes.forEach((b) => (b.checked = state[b.dataset.k]));
    if (post.cloudPass) post.cloudPass.enabled = state.clouds;
    sky.light.castShadow = state.shadows;
    renderer.shadowMap.enabled = state.shadows;
    renderer.shadowMap.needsUpdate = true;
    // Without the post chain, tone map in the renderer so the picture stays comparable.
    renderer.toneMapping = state.post ? THREE.NoToneMapping : THREE.AgXToneMapping;
  };
  el.addEventListener('change', (e) => {
    state[e.target.dataset.k] = e.target.checked;
    apply();
  });
  apply();

  let frames = 0, time = 0, cpu = 0;
  const api = {
    state,
    last: null,
    set(next) {
      Object.assign(state, next);
      apply();
    },
    begin() {
      renderer.info.reset();
    },
    end(dt, cpuMs) {
      frames++;
      time += dt;
      cpu += cpuMs;
      if (time < 0.5) return;
      const { calls, triangles } = renderer.info.render;
      api.last = { fps: frames / time, cpu: cpu / frames, calls, triangles };
      stats.textContent = `${api.last.fps.toFixed(1)} fps · cpu ${api.last.cpu.toFixed(1)} ms · ${calls} calls · ${Math.round(triangles / 1000)}k tris`;
      frames = 0;
      time = 0;
      cpu = 0;
    },
  };
  return api;
}
