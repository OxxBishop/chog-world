import * as THREE from 'three';

// Shared wind clock for every plant.
export const wind = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  // Chogs the grass bends away from (A, the user 10-18: "grass passes through my chog"): xyz at their feet,
  // w the reach (0 for none). src/travel.js fills them each frame.
  uPush: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
};

// Same normal chunk three.js uses, minus the back-face flip, so leaf cards shade as one soft canopy.
const NORMAL_NO_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, '');

const WIND_VERT = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 iOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vec3 iOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
  float ph = iOrigin.x * 0.21 + iOrigin.z * 0.17;
  float hf = smoothstep(uWindBase, uWindTop, position.y);
  hf *= hf;
  vSway = hf;
  float gust = 0.6 + 0.4 * sin(uTime * 0.35 + iOrigin.x * 0.02);
  transformed.x += (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25) * uWindAmp * hf * uWind * gust;
  transformed.z += (cos(uTime * 1.1 + ph * 1.3) * 0.5) * uWindAmp * hf * uWind * gust;
`;

// Low plants lean away from a Chog walking through them, the tips most, and spring back as it goes.
const PUSH_VERT = /* glsl */ `
#ifdef USE_INSTANCING
  mat4 pushM = modelMatrix * instanceMatrix;
#else
  mat4 pushM = modelMatrix;
#endif
  vec3 pw = (pushM * vec4(transformed, 1.0)).xyz;
  vec3 pushOff = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec4 P = uPush[i];
    if (P.w <= 0.0) continue;
    vec2 d = iOrigin.xz - P.xz;
    float dist = length(d);
    if (dist >= P.w || abs(iOrigin.y - P.y) > 2.5) continue;
    float k = 1.0 - dist / P.w;
    k *= k;
    float h = max(pw.y - iOrigin.y, 0.0);
    vec2 dir = dist > 1e-3 ? d / dist : vec2(0.0, 1.0);
    pushOff += vec3(dir.x, 0.0, dir.y) * k * h * 1.1 - vec3(0.0, k * h * 0.55, 0.0);
  }
  transformed += inverse(mat3(pushM)) * pushOff;
`;

/**
 * Patch a standard material for plants.
 * kind: 'canopy' (tree leaves), 'bark', 'low' (grass, flowers, ferns).
 */
export function patchPlant(material, { kind, base = 0, top = 7, amp = 0.25, translucency = 0.6, shade = [0.72, 1.06], tint = false, lumRef = 0.3 }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWind = wind.uWind;
    shader.uniforms.uWindBase = { value: base };
    shader.uniforms.uWindTop = { value: top };
    shader.uniforms.uWindAmp = { value: amp };
    shader.uniforms.uTranslucency = { value: translucency };
    shader.uniforms.uShade = { value: new THREE.Vector2(...shade) };
    shader.uniforms.uLumRef = { value: lumRef };

    shader.uniforms.uPush = wind.uPush;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime, uWind, uWindBase, uWindTop, uWindAmp;\nuniform vec4 uPush[6];\nvarying float vSway;',
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERT}${kind === 'low' ? PUSH_VERT : ''}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTranslucency, uLumRef;\nuniform vec2 uShade;\nvarying float vSway;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(uShade.x, uShade.y, vSway);');

    if (tint) {
      // Keep the texture's shape and light detail, take the colour from the per-instance tint.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float leafLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb = vec3(mix(1.0, leafLum / uLumRef, 0.55));`,
      );
    }

    if (kind !== 'bark') {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', NORMAL_NO_FLIP)
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `
#if NUM_DIR_LIGHTS > 0
  // Sun glowing through the leaves when you look toward it.
  float backlit = pow(clamp(dot(-normalize(vViewPosition), directionalLights[0].direction), 0.0, 1.0), 3.0);
  outgoingLight += diffuseColor.rgb * directionalLights[0].color * backlit * uTranslucency;
  // Soft wrap so shaded leaves stay lush instead of going black.
  outgoingLight += diffuseColor.rgb * directionalLights[0].color * 0.12 * uTranslucency;
#endif
#include <opaque_fragment>`,
        );
    }
  };
  material.customProgramCacheKey = () => `plant-${kind}-${tint}`;
  return material;
}

// Bend leaf-card normals outward from the canopy centre so the tree lights like a soft ball.
export function sphereNormals(geometry, amount = 0.85, centerYBias = -0.1) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const c = bb.getCenter(new THREE.Vector3());
  c.y += (bb.max.y - bb.min.y) * centerYBias;
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const v = new THREE.Vector3(), n = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    s.subVectors(v, c).normalize();
    n.lerp(s, amount).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  nor.needsUpdate = true;
}

// Point low plant normals mostly up so grass shades like the ground under it.
export function upNormals(geometry, amount = 0.7) {
  const nor = geometry.attributes.normal;
  const n = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i).lerp(up, amount).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  nor.needsUpdate = true;
}
