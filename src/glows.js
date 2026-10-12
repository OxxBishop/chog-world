import * as THREE from 'three';

/*
 * Soft halos around lamp globes. Each is a point sprite that keeps a minimum size on screen, so a
 * far-off lamp stays a steady glow instead of a one-pixel spark that flickers as the camera
 * moves. Halos are depth tested: a lamp behind a tree or a wall is hidden by it.
 */

const vert = /* glsl */ `
uniform float uSize;
uniform float uMinPx;
uniform float uScale;
varying float vFade;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float px = uSize * uScale / -mvPosition.z;
  // Distant halos keep a few pixels but grow fainter, so they never read as sparks.
  vFade = clamp(px / uMinPx, 0.25, 1.0);
  gl_PointSize = max(px, uMinPx);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vFade;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float glow = exp(-r * 5.0) * 0.85 + exp(-r * 22.0) * 0.6;
  gl_FragColor = vec4(uColor * glow * uStrength * vFade, 1.0);
  #include <fog_fragment>
}`;

export function createGlows(positions, { color = '#ffd7a0', size = 2.2, minPx = 6 } = {}) {
  const geo = new THREE.BufferGeometry().setFromPoints(positions);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uColor: { value: new THREE.Color(color) }, uStrength: { value: 0 }, uSize: { value: size }, uMinPx: { value: minPx }, uScale: { value: 400 } },
  ]);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  return {
    points,
    // Halos only show as it gets dark; the pixel scale follows the canvas height.
    update(env, renderer) {
      uniforms.uStrength.value = Math.max(0, env.night - 0.15) * 1.1;
      uniforms.uScale.value = renderer.domElement.height / 2 / Math.tan(THREE.MathUtils.degToRad(21));
    },
  };
}
