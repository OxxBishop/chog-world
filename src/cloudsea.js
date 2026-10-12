import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { WORLD, ISLANDS } from './layout.js';

/*
 * The sea of clouds the islands float on.
 *
 * Drawn as a real volume after the scene: every pixel that looks down marches through a layer of
 * cloud whose tops pile up in round heaps, lit by the sun or the moon with the same palette as the
 * sky. The scene's depth stops the march, so the rocky undersides sink into the clouds and fade out
 * instead of being cut off. Island shadows fall across the tops, and the far sea melts into the
 * exact colour of the sky at the horizon.
 *
 * The march runs at half resolution and is scaled back up along the edges of whatever is in front,
 * so islands stay crisp against the clouds. See-through things that hang over the clouds (the
 * waterfalls) live in a scene of their own, drawn on top afterwards against the scene's depth.
 */

const WIND = [2.4, 0.9];

// Shared with the waterfalls, so they fade out exactly where they meet the cloud tops.
export const CLOUD_TOP_GLSL = /* glsl */ `
vec4 cloudTex(sampler2D tex, vec2 uv) {
  // Smooth filtering of the 256px noise tile, so the heaps shade without facets.
  vec2 p = uv * 256.0 + 0.5;
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(tex, (i + f - 0.5) / 256.0, 0.0);
}
float cloudTop(sampler2D tex, vec2 xz, float time, float top) {
  vec2 q = (xz + vec2(${WIND[0].toFixed(2)}, ${WIND[1].toFixed(2)}) * time) / 1100.0;
  float r = cloudTex(tex, q).r;
  vec4 b = cloudTex(tex, q * 0.43 + vec2(0.37, 0.71));
  // Round heaps with soft creases between them, on broad swells.
  float x = clamp(abs(r - 0.5) * 3.0, 0.0, 1.0);
  float heap = 1.0 - (1.0 - x) * (1.0 - x);
  return top + (heap - 0.5) * 28.0 + (b.g - 0.5) * 16.0 + (b.b - 0.5) * 5.0;
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const MARCH = /* glsl */ `
uniform sampler2D depthTex;
uniform sampler2D noiseTex;
uniform sampler2D rgTex;
uniform vec2 fullRes;
uniform mat4 invProj;
uniform mat4 camWorld;
uniform vec3 lightDir;
uniform vec3 lightCol;
uniform vec3 ambTop;
uniform vec3 ambBot;
uniform vec3 fogCol;
uniform vec2 fogRange;
uniform float seaTop;
uniform float clock;
uniform float stepScale;
uniform vec4 islands[ISLAND_COUNT];
// From the sky, to match its colour below the horizon.
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uNight;

${CLOUD_TOP_GLSL}

// What the sky shows in a direction below the horizon (see sky.js).
vec3 skyBelow(vec3 d) {
  vec3 col = uHorizon;
  col += uSunColor * pow(max(dot(d, uSunDir), 0.0), 40.0) * 0.3 * (1.0 - uNight);
  col += vec3(0.45, 0.35, 0.9) * pow(max(dot(d, uMoonDir), 0.0), 60.0) * 0.25 * uNight;
  col += vec3(0.32, 0.14, 0.58) * exp(-abs(d.y) * 9.0) * uNight * 0.3;
  return col;
}

// 3D value noise from a 2D texture whose green channel is the red one shifted by (37, 17).
float vnoise(vec3 x) {
  vec3 p = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = p.xy + vec2(37.0, 17.0) * p.z + f.xy;
  vec2 rg = textureLod(rgTex, (uv + 0.5) / 256.0, 0.0).rg;
  return mix(rg.x, rg.y, f.z);
}

// Billowing detail that bulges and carves the tops, drifting and slowly boiling.
float puff(vec3 p, bool fine) {
  vec3 q = p * 0.07 + vec3(clock * 0.013, clock * 0.01, clock * 0.006);
  float n = vnoise(q);
  return fine ? n * 0.64 + vnoise(q * 2.17 + 4.3) * 0.36 : n;
}

// Light that never reaches a spot on the tops: island shadows, and heaps shading each other when the light is low.
float topShadow(vec3 p) {
  vec3 L = lightDir;
  float s = 1.0;
  if (L.y > 0.03) {
    for (int i = 0; i < ISLAND_COUNT; i++) {
      vec4 isl = islands[i];
      vec2 q = p.xz + L.xz * ((isl.w - p.y) / L.y);
      s *= mix(0.3, 1.0, smoothstep(isl.z * 0.7, isl.z * 1.02, length(q - isl.xy)));
    }
  }
  float h = 1.0;
  for (int k = 1; k <= 3; k++) {
    float d = float(k * k) * 7.0;
    vec3 q = p + L * d;
    h = min(h, 1.0 - smoothstep(0.0, 6.0, cloudTop(noiseTex, q.xz, clock, seaTop) - q.y));
  }
  return s * mix(0.5, 1.0, h);
}

void main() {
  // Each half-res texel stands for the full-res pixel at twice its coordinate.
  ivec2 fc = min(ivec2(gl_FragCoord.xy) * 2, ivec2(fullRes) - 1);
  float depth = texelFetch(depthTex, fc, 0).r;
  vec2 uv = (vec2(fc) + 0.5) / fullRes;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);

  vec4 vp = invProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 view = vp.xyz / vp.w;
  vec3 ro = camWorld[3].xyz;
  vec3 rd = normalize(mat3(camWorld) * view);
  if (rd.y > -0.0005) return;
  bool open = depth >= 0.9999999;
  float tEnd = min(open ? 1e9 : length(view), fogRange.y);
  float t = max((ro.y - (seaTop + 24.0)) / -rd.y, 0.0);
  if (t >= tEnd) return;

  // Skip through empty air to just above the cloud tops.
  float slope = -rd.y + 0.35 * length(rd.xz);
  for (int i = 0; i < 32; i++) {
    vec3 p = ro + rd * t;
    float gap = p.y - (cloudTop(noiseTex, p.xz, clock, seaTop) + 4.0);
    if (gap < 0.5) break;
    t += gap / slope;
  }
  if (t >= tEnd) return;

  // Then march into the cloud, front to back, in short steps: most of what you see is in the first few metres.
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float ds = clamp(t * 0.0025, 1.0, 4.0) * stepScale;
  t = max(t - ds * jit, 0.0);
  float detail = 4.5 * smoothstep(1000.0, 300.0, t);
  bool fine = t < 500.0;
  float phase = 0.75 + 1.2 * pow(max(dot(rd, lightDir), 0.0), 6.0);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float tHit = -1.0;
  float shade = 1.0, lift = 0.0;
  bool done = false;
  for (int i = 0; i < 28; i++) {
    if (t >= tEnd || T < 0.04) { done = true; break; }
    vec3 p = ro + rd * t;
    float d0 = cloudTop(noiseTex, p.xz, clock, seaTop) - p.y;
    if (d0 > -detail - 0.5) {
      float n = detail > 0.05 ? puff(p, fine) : 0.5;
      float d = d0 + (n - 0.5) * 2.0 * detail;
      float dens = smoothstep(0.0, 4.0, d);
      if (dens > 0.003) {
        if (tHit < 0.0) {
          tHit = t;
          shade = topShadow(p);
          // How the tops rise or fall toward the light, measured once.
          lift = cloudTop(noiseTex, p.xz + lightDir.xz * 3.0, clock, seaTop) - (d0 + p.y);
        }
        // Brighter where the cloud thins out toward the light: that is what gives the heaps their shape.
        float nl = detail > 0.05 ? puff(p + lightDir * 3.0, false) : 0.5;
        float densL = smoothstep(0.0, 4.0, d0 + lift - lightDir.y * 3.0 + (nl - 0.5) * 2.0 * detail);
        float dif = clamp((dens - densL) * 1.5 + 0.06, 0.0, 1.0);
        float inner = exp(-max(d, 0.0) * 0.14);
        // Low ground between the heaps sees less of the sky.
        float ao = mix(0.6, 1.0, smoothstep(seaTop - 20.0, seaTop + 10.0, d0 + p.y));
        vec3 S = (lightCol * (dif * phase * shade * (0.3 + 0.7 * inner)) + mix(ambBot, ambTop, inner)) * ao;
        float a = 1.0 - exp(-dens * 0.55 * ds);
        acc += T * a * S;
        T *= 1.0 - a;
      }
    }
    t += ds;
    ds = clamp(t * 0.0025, 1.0, 4.0) * stepScale;
  }
  // Out of steps while still in the cloud: close it off with the cloud's own colour.
  if (!done) {
    if (tHit < 0.0) { tHit = t; shade = 1.0; }
    acc += T * (ambTop + lightCol * 0.25 * shade);
    T = 0.0;
  }

  // Far clouds melt into the horizon: the sky's own colour where nothing is behind, fog over rock.
  float f = smoothstep(fogRange.x, fogRange.y, tHit);
  acc = mix(acc, (open ? skyBelow(rd) : fogCol) * (1.0 - T), f);
  gl_FragColor = vec4(acc, T);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D inputBuffer;
uniform sampler2D cloudTex;
uniform sampler2D depthTex;
uniform vec2 fullRes;
uniform vec2 lowRes;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;

float viewDepth(ivec2 p) {
  float d = texelFetch(depthTex, p, 0).r;
  return cameraNear * cameraFar / (cameraFar - d * (cameraFar - cameraNear));
}

void main() {
  vec4 src = texture2D(inputBuffer, vUv);
  ivec2 p = ivec2(gl_FragCoord.xy);
  float z = viewDepth(p);
  // Blend the four nearest half-res samples, trusting the ones that saw the same surface.
  vec2 lp = vec2(p) * 0.5;
  ivec2 b = ivec2(floor(lp));
  vec2 f = lp - vec2(b);
  ivec2 maxLow = ivec2(lowRes) - 1, maxFull = ivec2(fullRes) - 1;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 q = min(b + ivec2(i, j), maxLow);
      float zq = viewDepth(min(q * 2, maxFull));
      float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) + 1e-3;
      float w = wb / (1e-3 + abs(zq - z) / z);
      sum += texelFetch(cloudTex, q, 0) * w;
      wsum += w;
    }
  }
  vec4 c = sum / wsum;
  gl_FragColor = vec4(c.rgb + c.a * src.rgb, 1.0);
  // Hand the scene's depth on, so the see-through things drawn next sit at the right depth.
  gl_FragDepth = texelFetch(depthTex, p, 0).r;
}`;

// Random values in red, the same values shifted by (37, 17) in green: one fetch gives two noise slices.
function sliceNoise() {
  const S = 256;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const r = Uint8Array.from({ length: S * S }, () => Math.floor(rnd() * 256));
  const data = new Uint8Array(S * S * 2);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      data[i * 2] = r[i];
      data[i * 2 + 1] = r[((y + 17) & 255) * S + ((x + 37) & 255)];
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const WHITE = new THREE.Color(1, 1, 1);
const SUN = new THREE.Color('#fff6f2');
const SUN_LOW = new THREE.Color('#ff9ac0');
const MOON = new THREE.Color('#d6c8ff');
const NIGHT_TOP = new THREE.Color('#584893');
const NIGHT_BOT = new THREE.Color('#1e1542');

export class CloudSeaPass extends Pass {
  constructor(camera, sky) {
    super('CloudSeaPass');
    this.needsDepthTexture = true;
    this.view = camera;
    const su = sky.uniforms;
    this.sky = sky;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.depth = { value: null };
    this.fullRes = { value: new THREE.Vector2(1, 1) };
    this.u = {
      depthTex: this.depth,
      fullRes: this.fullRes,
      noiseTex: su.uNoise,
      rgTex: { value: sliceNoise() },
      invProj: { value: camera.projectionMatrixInverse },
      camWorld: { value: camera.matrixWorld },
      lightDir: { value: new THREE.Vector3(0, 1, 0) },
      lightCol: { value: new THREE.Color() },
      ambTop: { value: new THREE.Color() },
      ambBot: { value: new THREE.Color() },
      fogCol: { value: new THREE.Color() },
      fogRange: { value: new THREE.Vector2(500, 2000) },
      seaTop: { value: WORLD.cloudSeaY },
      clock: { value: 0 },
      stepScale: { value: 1 },
      // x, z, radius, and the height the island's shadow is cast from.
      islands: { value: ISLANDS.map((i) => new THREE.Vector4(i.x, i.z, i.r, WORLD.landH - 8)) },
      uHorizon: su.uHorizon,
      uSunDir: su.uSunDir,
      uMoonDir: su.uMoonDir,
      uSunColor: su.uSunColor,
      uNight: su.uNight,
    };
    this.march = new THREE.ShaderMaterial({
      uniforms: this.u,
      defines: { ISLAND_COUNT: ISLANDS.length },
      vertexShader: VERT,
      fragmentShader: MARCH,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        inputBuffer: { value: null },
        cloudTex: { value: this.target.texture },
        depthTex: this.depth,
        fullRes: this.fullRes,
        lowRes: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
      },
      vertexShader: VERT,
      fragmentShader: COMPOSITE,
      depthFunc: THREE.AlwaysDepth,
    });
    this.fullscreenMaterial = this.march;
    this.late = new THREE.Scene();
  }

  setDepthTexture(depthTexture) {
    this.depth.value = depthTexture;
  }

  setSize(width, height) {
    this.fullRes.value.set(width, height);
    const w = Math.ceil(width / 2), h = Math.ceil(height / 2);
    this.target.setSize(w, h);
    this.composite.uniforms.lowRes.value.set(w, h);
  }

  render(renderer, inputBuffer, outputBuffer) {
    this.fullscreenMaterial = this.march;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    this.composite.uniforms.inputBuffer.value = inputBuffer.texture;
    this.fullscreenMaterial = this.composite;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
    renderer.render(this.late, this.view);
  }

  /** Light and colour from the sky, once per frame. */
  setEnv(env, t) {
    const u = this.u;
    const su = this.sky.uniforms;
    const night = env.night;
    const low = 1 - THREE.MathUtils.smoothstep(env.sunElev, 0.05, 0.45);
    const useSun = env.sunElev > -0.04;
    u.lightDir.value.copy(useSun ? su.uSunDir.value : su.uMoonDir.value);
    if (useSun) u.lightCol.value.copy(SUN).lerp(SUN_LOW, low).multiplyScalar(3.0 * THREE.MathUtils.smoothstep(env.sunElev, -0.04, 0.2));
    else u.lightCol.value.copy(MOON).multiplyScalar(0.3 * night);
    // Lilac shade by day, deep violet at night: the same family as the clouds painted in the sky.
    u.ambTop.value.copy(su.uTop.value).lerp(WHITE, 0.6).multiplyScalar(0.55).lerp(su.uHorizon.value, low * 0.3).lerp(NIGHT_TOP, night);
    u.ambBot.value.copy(su.uTop.value).lerp(WHITE, 0.3).multiplyScalar(0.22).lerp(NIGHT_BOT, night);
    u.fogCol.value.copy(this.sky.fog.color);
    u.fogRange.value.set(this.sky.fog.near * 1.2, this.sky.fog.far);
    u.clock.value = t;
    this.composite.uniforms.cameraNear.value = this.view.near;
    this.composite.uniforms.cameraFar.value = this.view.far;
  }

  setQuality(q) {
    this.u.stepScale.value = [1.6, 1.25, 1][q];
  }
}
