import * as THREE from 'three';

/*
 * The Chog World planet (B25): an Earth-like world gone purple, what the islands are part of. Oceans,
 * continents, clouds, ice caps, city lights on the night side, a sky glowing round its rim; but the
 * land and the light are the alien in it. Three looks for the user's pick (style):
 *
 *   amethyst   Earth's shape in purple: violet forests and lilac plains over most of the land, a few
 *              green regions left, pink lagoons in the shallows, a violet sky, a faint ring
 *   bloom      the most alien: magenta jungles, deep purple forests and gold deserts on island chains,
 *              teal seas, glowing pink crystal ranges, a great violet storm, wide pink and lilac
 *              rings, two moons
 *   dusk       always near dusk: dusky violet land, indigo seas, coasts that glow cyan and violet in
 *              the dark, lavender clouds, pink ice, strong aurora
 *
 * The surface is painted once, at load, by the GPU into two maps (an equirectangular picture of the
 * planet: colour and sea; clouds, city lights, height and a glow), in tiles a frame at a time so no
 * one GPU job runs long on a weak laptop (B12). After that it is a few texture reads a pixel.
 *
 * createPlanet() returns { group, bake(), baked, update(dt), radius, sun }: group goes in the world
 * seen from space (src/space.js); sun is the direction the light comes from.
 */

export const RADIUS = 600;
export const STYLES = { amethyst: 0, bloom: 1, dusk: 2 };

// ---------- the painting ----------
const NOISE = /* glsl */ `
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
// Gradient noise, -1 to 1, with a quintic fade so the continents have no grid in them.
float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(dot(hash3(i), f), dot(hash3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), u.x),
                 mix(dot(hash3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)), dot(hash3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), u.x), u.y),
             mix(mix(dot(hash3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)), dot(hash3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), u.x),
                 mix(dot(hash3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)), dot(hash3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 9; i++) {
    if (i >= oct) break;
    s += a * gnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
// Ridged: sharp crests, for the mountain ranges.
float ridged(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(gnoise(p));
    s += a * n * n;
    p = p * 2.1 + vec3(5.3, 1.1, 7.7);
    a *= 0.5;
  }
  return s;
}
// p turned round axis by angle (for the storm's swirl).
vec3 turn(vec3 p, vec3 axis, float a) {
  return p * cos(a) + cross(axis, p) * sin(a) + axis * dot(axis, p) * (1.0 - cos(a));
}
`;

const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// One pass paints both maps: uPass 0 is colour (rgb, sRGB) and sea (a); uPass 1 is clouds (r), city
// lights (g), height over the sea (b) and the glow (a: the bloom's crystal ranges, the dusk's coasts).
const BAKE_FRAG = /* glsl */ `
uniform int uPass;
varying vec2 vUv;
${NOISE}
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
vec3 hex(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
const vec3 STORM = vec3(0.42, -0.5, 0.76);

void main() {
  // The direction from the middle of the planet for this point of the map.
  float lon = (vUv.x - 0.5) * 6.2831853;
  float lat = (vUv.y - 0.5) * 3.1415927;
  vec3 p = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float alat = abs(lat) / 1.5707963;

  // Continents: warped noise, so the coasts wander and bays and peninsulas form. The bloom's are
  // broken into island chains along ridges.
  vec3 w = vec3(fbm(p * 0.9 + 1.7, 4), fbm(p * 0.9 + 9.2, 4), fbm(p * 0.9 + 3.3, 4));
#if STYLE == 1
  float h = fbm(p * 1.6 + w * 0.9, 8) + 0.22 * ridged(p * 2.6 + w, 5) - 0.12;
  float sea = 0.04;
#elif STYLE == 0
  float h = fbm(p * 1.25 + w * 0.75, 8) + 0.12 * ridged(p * 3.2 + w, 5) - 0.04;
  float sea = 0.02;
#else
  float h = fbm(p * 1.25 + w * 0.75, 8) + 0.12 * ridged(p * 3.2 + w, 5) - 0.04;
  float sea = 0.07;
#endif
  float land = smoothstep(sea - 0.004, sea + 0.004, h);
  float hl = max(0.0, h - sea);
  // Wet near the equator and at 50-60 degrees, dry in the belts between.
  float rain = 0.5 + 0.38 * cos(alat * 9.4) + 0.6 * fbm(p * 2.2 + 5.1, 5);
  float temp = 1.0 - alat * 1.15 - hl * 2.2 + 0.08 * fbm(p * 3.0 + 2.0, 3);
  // Regions: where the land goes its own way.
  float region = fbm(p * 0.75 + vec3(21.0, 4.0, 13.0), 4);
  float ice = smoothstep(0.12, 0.02, temp + 0.04 * gnoise(p * 9.0));
  float wet = clamp(rain, 0.0, 1.4);
  float mount = smoothstep(0.16, 0.34, hl + 0.1 * ridged(p * 6.0, 4));
  float peak = smoothstep(0.32, 0.44, hl + 0.06 * gnoise(p * 30.0));

  if (uPass == 0) {
    float depth = clamp((sea - h) / 0.35, 0.0, 1.0);
    vec3 deep, mid, shallow, lagoon, desert, steppe, grass, forest, tundra, rock, snow, iceCol;
    float lagoonK;
#if STYLE == 0
    deep = hex(48.0, 14.0, 104.0); mid = hex(96.0, 44.0, 178.0); shallow = hex(150.0, 112.0, 232.0); lagoon = hex(238.0, 112.0, 204.0);
    // Most of the land violet and lilac; a few regions still green, the hint of an Earth.
    float green = smoothstep(0.2, 0.36, region);
    desert = mix(hex(206.0, 150.0, 224.0), hex(214.0, 178.0, 118.0), green);
    steppe = mix(hex(170.0, 104.0, 200.0), hex(160.0, 156.0, 88.0), green);
    grass = mix(hex(132.0, 70.0, 206.0), hex(88.0, 150.0, 66.0), green);
    forest = mix(hex(70.0, 26.0, 140.0), hex(34.0, 92.0, 52.0), green);
    tundra = hex(170.0, 150.0, 186.0); rock = hex(116.0, 96.0, 128.0); snow = hex(244.0, 236.0, 255.0);
    iceCol = mix(hex(240.0, 234.0, 255.0), hex(210.0, 190.0, 250.0), 0.5 + 0.5 * gnoise(p * 14.0));
    lagoonK = smoothstep(-0.05, 0.2, fbm(p * 1.3 + 50.0, 3));
#elif STYLE == 1
    deep = hex(40.0, 20.0, 96.0); mid = hex(40.0, 70.0, 150.0); shallow = hex(60.0, 176.0, 200.0); lagoon = hex(150.0, 236.0, 224.0);
    float gold = smoothstep(0.05, 0.25, region);
    desert = mix(hex(236.0, 170.0, 84.0), hex(250.0, 206.0, 120.0), gold);
    steppe = hex(220.0, 118.0, 124.0);
    grass = hex(206.0, 66.0, 152.0);
    forest = mix(hex(112.0, 30.0, 124.0), hex(150.0, 40.0, 110.0), gold);
    tundra = hex(186.0, 140.0, 190.0); rock = hex(140.0, 90.0, 150.0); snow = hex(255.0, 200.0, 240.0);
    iceCol = mix(hex(255.0, 230.0, 250.0), hex(236.0, 190.0, 255.0), 0.5 + 0.5 * gnoise(p * 14.0));
    lagoonK = 0.6;
#else
    deep = hex(34.0, 10.0, 72.0); mid = hex(66.0, 30.0, 136.0); shallow = hex(110.0, 76.0, 196.0); lagoon = hex(150.0, 70.0, 214.0);
    float teal = smoothstep(0.1, 0.3, region);
    desert = mix(hex(170.0, 130.0, 186.0), hex(150.0, 150.0, 170.0), teal);
    steppe = mix(hex(128.0, 100.0, 168.0), hex(96.0, 128.0, 150.0), teal);
    grass = mix(hex(96.0, 76.0, 160.0), hex(58.0, 118.0, 132.0), teal);
    forest = mix(hex(52.0, 36.0, 112.0), hex(30.0, 72.0, 92.0), teal);
    tundra = hex(150.0, 130.0, 180.0); rock = hex(96.0, 84.0, 120.0); snow = hex(255.0, 220.0, 244.0);
    iceCol = mix(hex(255.0, 214.0, 240.0), hex(230.0, 196.0, 250.0), 0.5 + 0.5 * gnoise(p * 14.0));
    lagoonK = smoothstep(0.0, 0.3, fbm(p * 1.3 + 50.0, 3));
#endif
    // The sea: deep far out, the shelves lighter, some shallows (the lagoons) in their own colour.
    vec3 water = mix(mix(shallow, lagoon, lagoonK), mid, smoothstep(0.0, 0.045, depth));
    water = mix(water, deep, smoothstep(0.06, 0.55, depth));
    // The land: by wetness and warmth.
    vec3 col = mix(desert, steppe, smoothstep(0.1, 0.28, wet));
    col = mix(col, grass, smoothstep(0.28, 0.48, wet));
    col = mix(col, forest, smoothstep(0.55, 0.82, wet));
    col = mix(col, tundra, smoothstep(0.38, 0.18, temp));
    // Fine detail, so close up it's never flat.
    col *= 0.76 + 0.48 * (fbm(p * 24.0, 4) + 0.5);
    col = mix(col, rock, mount * 0.8);
    col = mix(col, snow, peak);
    // A pale beach line.
    col = mix(mix(desert, vec3(1.0), 0.3), col, smoothstep(0.0, 0.012, hl));
    vec3 surf = mix(water, col, land);
    surf = mix(surf, iceCol, ice);
    gl_FragColor = vec4(toSrgb(surf), (1.0 - land) * (1.0 - ice));
  } else {
    // Clouds: swirls on a warped field, banded by latitude (fewest over the dry belts).
    vec3 q = p;
#if STYLE == 1
    // The great storm: the clouds wound round an eye in the south.
    float sd = acos(clamp(dot(p, normalize(STORM)), -1.0, 1.0));
    q = turn(p, normalize(STORM), 7.0 * exp(-sd / 0.16));
#endif
    vec3 cw = vec3(fbm(q * 1.6 + 30.0, 4), fbm(q * 1.6 + 41.0, 4), fbm(q * 1.6 + 52.0, 4));
    float c = fbm(q * vec3(1.0, 2.2, 1.0) * 2.4 + cw * 1.6, 8);
    float band = 0.55 + 0.45 * cos(alat * 9.4 + 0.4);
    float cover = smoothstep(-0.03, 0.28, c + 0.2 * band - 0.08);
#if STYLE == 1
    cover = max(cover, smoothstep(0.42, 0.06, sd) * smoothstep(0.018, 0.05, sd) * (0.75 + 0.25 * c));
    cover *= smoothstep(0.012, 0.03, sd);
#endif
    cover *= 0.85 + 0.15 * fbm(p * 18.0, 3);
    // City lights: sparse clusters on the land, most along the coasts and in the warm, wet parts.
    float coast = smoothstep(0.09, 0.0, hl) * land;
    float town = smoothstep(0.62, 0.9, gnoise(p * 60.0) * 0.5 + 0.5) + 0.6 * smoothstep(0.7, 0.95, gnoise(p * 150.0) * 0.5 + 0.5);
    float lights = town * land * (1.0 - ice) * smoothstep(0.0, 0.4, temp) * (0.25 + 1.0 * coast) * smoothstep(-0.1, 0.25, fbm(p * 4.0 + 77.0, 3));
    // The glow: the bloom's crystal ranges, the dusk's shores.
#if STYLE == 1
    float glow = smoothstep(0.24, 0.4, hl + 0.08 * ridged(p * 9.0, 3)) * land;
#elif STYLE == 2
    float glow = exp(-abs(h - sea) / 0.006) * (0.6 + 0.4 * gnoise(p * 40.0));
#else
    float glow = 0.0;
#endif
    gl_FragColor = vec4(cover, clamp(lights, 0.0, 1.0), clamp(hl * 2.0, 0.0, 1.0), clamp(glow, 0.0, 1.0));
  }
}`;

// ---------- the drawing ----------
const SURF_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vWorld;
void main() {
  vObjN = normalize(position);
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const COMMON = /* glsl */ `
uniform sampler2D uColor;
uniform sampler2D uData;
uniform vec3 uSun;
uniform float uSpin;
uniform float uCloudSpin;
uniform vec3 uCentre;
uniform vec3 uRingN;
uniform vec2 uRingR;
const float PI = 3.1415927;
vec2 uvOf(vec3 n, float spin) {
  float lon = atan(n.x, n.z) - spin;
  float lat = asin(clamp(n.y, -1.0, 1.0));
  return vec2(fract(lon / (2.0 * PI) + 0.5), lat / PI + 0.5);
}
vec3 fromSrgb(vec3 c) { return pow(c, vec3(2.2)); }
// The maps wrap round at the back: take the slope of the longitude from whichever side of the seam
// is smooth here, so the mipmaps never pick a blurry level along it (no seam line).
vec4 tex(sampler2D s, vec2 uv) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) {
    dx = dx2;
    dy = dy2;
  }
  return textureGrad(s, uv, dx, dy);
}
// The rings' density across them, x from the inner edge (0) to the outer (1): bands and a gap.
float ringDensity(float x) {
  if (x < 0.0 || x > 1.0) return 0.0;
  float d = 0.6 + 0.24 * sin(x * 23.0) + 0.12 * sin(x * 61.0 + 1.3) + 0.05 * sin(x * 151.0 + 0.7);
  d *= smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.9, x);
  d *= 1.0 - 0.9 * smoothstep(0.56, 0.575, x) * smoothstep(0.64, 0.625, x);
  d *= 0.7 + 0.3 * smoothstep(0.2, 0.3, x);
  return clamp(d, 0.0, 1.0);
}
// How much of the sun the rings take away from point P (world).
float ringShade(vec3 P, vec3 L) {
  if (uRingR.y <= 0.0) return 0.0;
  float den = dot(L, uRingN);
  if (abs(den) < 1e-4) return 0.0;
  float t = dot(uCentre - P, uRingN) / den;
  if (t <= 0.0) return 0.0;
  float r = length(P + L * t - uCentre);
  return ringDensity((r - uRingR.x) / (uRingR.y - uRingR.x)) * 0.8;
}
`;

const SURF_FRAG = /* glsl */ `
${COMMON}
uniform float uTime;
uniform vec3 uHaze;
uniform vec3 uCityA;
uniform vec3 uCityB;
uniform vec3 uGlow;
uniform float uGlowDay;
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vObjN);
  vec2 uv = uvOf(n, uSpin);
  vec4 c = tex(uColor, uv);
  vec4 d = tex(uData, uv);
  vec3 albedo = fromSrgb(c.rgb);
  float water = c.a;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSun);
  float nl = dot(N, L);
  // A little relief from the height map: the slopes catch the low sun near the terminator.
  vec2 px = 1.0 / vec2(textureSize(uData, 0));
  float hx = tex(uData, uv + vec2(px.x, 0.0)).b - tex(uData, uv - vec2(px.x, 0.0)).b;
  float hy = tex(uData, uv + vec2(0.0, px.y)).b - tex(uData, uv - vec2(0.0, px.y)).b;
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-4));
  vec3 north = cross(N, east);
  vec3 Nb = normalize(N - (east * hx + north * hy) * 1.8 * (1.0 - water));
  float lit = clamp((dot(Nb, L) + 0.18) / 1.18, 0.0, 1.0);
  // The clouds' shadows, cast a little away from the sun; the rings' shadow, a band across.
  vec2 cuv = uvOf(normalize(n - L * 0.006), uCloudSpin);
  float shadow = tex(uData, cuv).r;
  float rings = ringShade(vWorld, L);
  vec3 sunCol = vec3(1.0, 0.95, 0.92);
  vec3 col = albedo * sunCol * lit * (1.0 - 0.45 * shadow) * (1.0 - rings) * 1.35;
  // The terminator glows, the alien dusk: a narrow band.
  // The sun on the sea: a tight glint and a soft sheen.
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
  float glint = pow(nh, 700.0) * 0.18 + pow(nh, 48.0) * 0.02;
  col += sunCol * water * glint * (0.8 + fres) * smoothstep(0.0, 0.2, nl) * (1.0 - shadow * 0.8) * (1.0 - rings);
  // Night: the cities, where the sun has gone.
  float dark = smoothstep(0.08, -0.18, nl);
  float city = d.g;
  vec3 cityCol = mix(uCityA, uCityB, step(0.7, fract(dot(n, vec3(91.7, 37.3, 53.1)))));
  col += cityCol * city * dark * 1.6 * (1.0 - shadow * 0.6);
  // The glow: crystal ranges by day and night, glowing shores in the dark.
  col += uGlow * d.a * (uGlowDay + (1.0 - uGlowDay) * dark) * (0.75 + 0.25 * sin(uTime * 1.3 + dot(n, vec3(40.0))));
  // A whisper of light on the night side, so it never reads as a hole.
  col += albedo * vec3(0.06, 0.04, 0.14) * dark * 0.4;
  // The air: a haze toward the rim, on the lit side.
  float rim = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 2.6);
  col = mix(col, uHaze * (0.35 + 0.65 * lit), rim * 0.5 * smoothstep(-0.3, 0.4, nl));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const CLOUD_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uCloud;
uniform vec3 uCloudDusk;
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vObjN);
  float cover = tex(uData, uvOf(n, uCloudSpin)).r;
  vec3 N = normalize(vN);
  vec3 L = normalize(uSun);
  vec3 V = normalize(cameraPosition - vWorld);
  float nl = dot(N, L);
  float lit = clamp((nl + 0.25) / 1.25, 0.0, 1.0) * (1.0 - ringShade(vWorld, L));
  vec3 col = uCloud * lit * 1.25;
  // The cloud tops at dusk catch the last light.
  float dusk = smoothstep(-0.12, 0.02, nl) * smoothstep(0.22, 0.0, nl);
  col = mix(col, uCloudDusk, dusk * 0.4);
  // Thinner toward the rim, so the limb stays soft.
  float edge = smoothstep(0.0, 0.35, max(dot(N, V), 0.0));
  float a = cover * edge * (0.25 + 0.75 * smoothstep(-0.25, 0.1, nl)) * 0.92;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// The sky seen from space: a shell a little bigger than the planet, drawn from inside, glowing where
// the line of sight grazes it.
const SKY_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uCentre;
uniform float uR;
uniform float uTime;
uniform vec3 uDay;
uniform vec3 uDuskSky;
uniform vec3 uNight;
uniform vec3 uAurora;
uniform float uAuroraK;
varying vec3 vWorld;
void main() {
  vec3 V = normalize(vWorld - cameraPosition);
  // How close the line of sight passes to the planet's middle, from its surface (0) to the shell (1).
  vec3 oc = cameraPosition - uCentre;
  float b = dot(oc, V);
  float closest = sqrt(max(0.0, dot(oc, oc) - b * b));
  float x = clamp((closest - uR) / (uR * 0.055), -1.0, 1.0);
  // Brightest just above the surface, gone at the shell's edge; over the planet's disc, a thin veil.
  float glow = x > 0.0 ? pow(1.0 - x, 2.6) : smoothstep(-0.25, 0.0, x) * 0.9;
  vec3 P = cameraPosition + V * -b - uCentre;
  P *= inversesqrt(max(dot(P, P), 1e-12));
  float sd = dot(P, normalize(uSun));
  vec3 col = mix(uDuskSky, uDay, smoothstep(-0.05, 0.55, sd));
  col = mix(uNight * 0.35, col, smoothstep(-0.45, -0.05, sd));
  float a = glow * (0.12 + 0.88 * smoothstep(-0.5, 0.25, sd));
  // The aurora: curtains over the poles on the night side, slowly moving.
  float pole = smoothstep(0.7, 0.88, abs(P.y)) * smoothstep(0.05, -0.3, sd);
  float curtain = 0.5 + 0.5 * sin(atan(P.x, P.z) * 9.0 + uTime * 0.35 + sin(uTime * 0.21) * 2.0);
  col += uAurora * pole * curtain * 1.4 * uAuroraK;
  a = max(a, pole * curtain * glow * 0.8 * uAuroraK);
  gl_FragColor = vec4(col * 1.25, a);
  #include <colorspace_fragment>
}`;

const RING_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// The rings: bands of dust, lilac to pink to gold across, lit from either side, in the planet's
// shadow where it falls on them.
const RING_FRAG = /* glsl */ `
${COMMON}
uniform float uRingK;
varying vec3 vWorld;
void main() {
  float r = length(vWorld - uCentre);
  float x = (r - uRingR.x) / (uRingR.y - uRingR.x);
  float d = ringDensity(x);
  vec3 L = normalize(uSun);
  vec3 o = vWorld - uCentre;
  float ol = dot(o, L);
  float disc = ol * ol - (dot(o, o) - ${RADIUS.toFixed(1)} * ${RADIUS.toFixed(1)});
  float inShadow = (ol < 0.0 && disc > 0.0) ? 1.0 : 0.0;
  vec3 col = mix(vec3(0.62, 0.42, 1.0), vec3(1.0, 0.45, 0.8), smoothstep(0.15, 0.55, x));
  col = mix(col, vec3(1.0, 0.8, 0.5), smoothstep(0.72, 1.0, x));
  float lit = 0.55 + 0.45 * abs(dot(normalize(uRingN), L));
  col *= lit * (1.0 - 0.85 * inShadow) * 1.6;
  gl_FragColor = vec4(col, d * uRingK);
  #include <colorspace_fragment>
}`;

const MOON_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uTint;
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vWorld;
float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 N = normalize(vN);
  float lit = clamp((dot(N, normalize(uSun)) + 0.05) / 1.05, 0.0, 1.0);
  vec3 n = normalize(vObjN);
  // A few soft craters.
  float cr = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 c = normalize(vec3(h(vec3(float(i), 1.0, 2.0)) - 0.5, h(vec3(float(i), 3.0, 1.0)) - 0.5, h(vec3(float(i), 2.0, 5.0)) - 0.5));
    cr += smoothstep(0.22, 0.12, distance(n, c)) * 0.25;
  }
  vec3 col = mix(uTint, uTint * 0.75, cr) * lit * 1.2;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Each look's light and air.
const C = (h) => new THREE.Color(h);
const LOOK = {
  amethyst: {
    dusk: C('#e0389a'), haze: C('#8f74ff'), cityA: C('#ffc46a'), cityB: C('#b98cff'), glow: C('#000000'), glowDay: 0,
    cloud: C('#f6eeff'), cloudDusk: C('#ff8fd0'),
    day: C('#7d63ff'), duskSky: C('#ff3fa8'), night: C('#5a2ab0'), aurora: C('#b070ff'), auroraK: 1,
    ring: { inner: 1.32, outer: 1.62, k: 0.32 }, moons: [C('#c9b4ec')], sun: [-0.55, 0.3, 0.78],
  },
  bloom: {
    dusk: C('#ff4fa0'), haze: C('#c27cff'), cityA: C('#ffd27a'), cityB: C('#7ff6ff'), glow: C('#ff6ad0'), glowDay: 0.45,
    cloud: C('#fff3fb'), cloudDusk: C('#ffa0d8'),
    day: C('#a477ff'), duskSky: C('#ff4fb0'), night: C('#6a2ad0'), aurora: C('#ff7ae0'), auroraK: 0.8,
    ring: { inner: 1.28, outer: 1.95, k: 0.9 }, moons: [C('#d8c2f2'), C('#8fe8d8')], sun: [-0.55, 0.3, 0.78],
  },
  dusk: {
    dusk: C('#ff4f9a'), haze: C('#7a6cff'), cityA: C('#ffd27a'), cityB: C('#a77bff'), glow: C('#5ff0ff'), glowDay: 0,
    cloud: C('#efe6ff'), cloudDusk: C('#ff9ad6'),
    day: C('#6f6cff'), duskSky: C('#ff4fa8'), night: C('#4a2aa0'), aurora: C('#9a6bff'), auroraK: 1.6,
    ring: null, moons: [C('#d4c0ee')], sun: [-0.85, 0.3, 0.42],
  },
};

/**
 * quality: 'low' paints the maps at half the size. style: one of STYLES. The maps are painted by
 * bake(), a few tiles at a time: call it once a frame until baked (it returns true when done).
 */
export function createPlanet({ renderer, quality = 'high', style = 'amethyst' }) {
  const look = LOOK[style] ?? LOOK.amethyst;
  const STYLE = STYLES[style] ?? 0;
  // Phones paint the smaller maps too: two big ones would crowd a phone's memory.
  const phone = window.matchMedia?.('(pointer: coarse)').matches;
  const W = quality === 'low' || phone ? 2048 : 4096, H = W / 2;
  const opts = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false };
  const colorRT = new THREE.WebGLRenderTarget(W, H, opts);
  const dataRT = new THREE.WebGLRenderTarget(W, H, opts);
  colorRT.texture.anisotropy = dataRT.texture.anisotropy = 4;

  const bakeMat = new THREE.ShaderMaterial({ defines: { STYLE }, uniforms: { uPass: { value: 0 } }, vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMat);
  quad.frustumCulled = false;
  const bakeScene = new THREE.Scene();
  bakeScene.add(quad);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // Tiles: 8 x 4 a map, both maps, so each GPU job is a small one.
  const TX = 8, TY = 4;
  const tiles = [];
  for (const pass of [0, 1]) for (let y = 0; y < TY; y++) for (let x = 0; x < TX; x++) tiles.push({ pass, x, y });
  let next = 0;

  const sun = new THREE.Vector3(...look.sun).normalize();
  const group = new THREE.Group();
  const ring = look.ring;
  // The rings' plane: tipped toward the camera's side, so they cross in front of the planet's lower half.
  const ringN = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.32).applyAxisAngle(new THREE.Vector3(0, 0, 1), -0.18).normalize();
  const shared = {
    uColor: { value: colorRT.texture },
    uData: { value: dataRT.texture },
    uSun: { value: sun },
    uSpin: { value: 0 },
    uCloudSpin: { value: 0 },
    uCentre: { value: new THREE.Vector3() },
    uRingN: { value: ringN },
    uRingR: { value: ring ? new THREE.Vector2(ring.inner * RADIUS, ring.outer * RADIUS) : new THREE.Vector2(0, 0) },
  };
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 192, 96),
    new THREE.ShaderMaterial({
      uniforms: { ...shared, uTime: { value: 0 }, uHaze: { value: look.haze }, uCityA: { value: look.cityA }, uCityB: { value: look.cityB }, uGlow: { value: look.glow }, uGlowDay: { value: look.glowDay } },
      vertexShader: SURF_VERT, fragmentShader: SURF_FRAG,
    }),
  );
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 1.008, 160, 80),
    new THREE.ShaderMaterial({ uniforms: { ...shared, uCloud: { value: look.cloud }, uCloudDusk: { value: look.cloudDusk } }, vertexShader: SURF_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false }),
  );
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 1.07, 128, 64),
    new THREE.ShaderMaterial({
      uniforms: { uSun: shared.uSun, uCentre: shared.uCentre, uR: { value: RADIUS }, uTime: { value: 0 }, uDay: { value: look.day }, uDuskSky: { value: look.duskSky }, uNight: { value: look.night }, uAurora: { value: look.aurora }, uAuroraK: { value: look.auroraK } },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  clouds.renderOrder = 1;
  sky.renderOrder = 2;
  const parts = [ground, clouds, sky];
  if (ring) {
    const rings = new THREE.Mesh(
      new THREE.RingGeometry(ring.inner * RADIUS, ring.outer * RADIUS, 256, 1),
      new THREE.ShaderMaterial({ uniforms: { ...shared, uRingK: { value: ring.k } }, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    // RingGeometry lies in xy, facing +z: turn it to face along the rings' normal.
    rings.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ringN);
    rings.renderOrder = 3;
    parts.push(rings);
  }
  const moons = look.moons.map((tint, i) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * (i ? 0.07 : 0.12), 48, 24),
      new THREE.ShaderMaterial({ uniforms: { uSun: shared.uSun, uTint: { value: tint } }, vertexShader: SURF_VERT, fragmentShader: MOON_FRAG }),
    );
    parts.push(m);
    return m;
  });
  for (const m of parts) m.frustumCulled = false;
  group.add(...parts);
  let t = 0;
  // The moons' orbits: tilted, far out, slow.
  const moonOrbit = (i, a, out) => {
    const R = RADIUS * (i ? 2.5 : 3.4);
    return out.set(Math.cos(a) * R, RADIUS * (i ? -0.5 : 0.9) + Math.sin(a * 0.5) * RADIUS * 0.3, Math.sin(a) * R);
  };
  moons.forEach((m, i) => moonOrbit(i, 2.2 + i * 2.4, m.position));

  return {
    group,
    radius: RADIUS,
    sun,
    style,
    // The rings, if it has them: { outer (radii), normal }.
    ring: ring ? { outer: ring.outer, normal: ringN } : null,
    get baked() {
      return next >= tiles.length;
    },
    /** Paints the next n tiles of the maps. Returns true once both are done. */
    bake(n = 1) {
      if (next >= tiles.length) return true;
      const target0 = renderer.getRenderTarget();
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      for (let k = 0; k < n && next < tiles.length; k++, next++) {
        const { pass, x, y } = tiles[next];
        const rt = pass ? dataRT : colorRT;
        bakeMat.uniforms.uPass.value = pass;
        rt.scissor.set((x * W) / TX, (y * H) / TY, W / TX, H / TY);
        rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.render(bakeScene, bakeCam);
        rt.scissorTest = false;
      }
      renderer.setRenderTarget(target0);
      renderer.autoClear = auto;
      // Done (each render has rebuilt the maps' mipmaps, for a clean planet from far off).
      if (next >= tiles.length) {
        bakeMat.dispose();
        quad.geometry.dispose();
        return true;
      }
      return false;
    },
    // Each frame while it shows: the planet turns, its clouds a little faster, the moons go round.
    update(dt) {
      t += dt;
      // A turn about every three minutes, so it's plainly turning; the weather drifts over the land.
      shared.uSpin.value = t * 0.035;
      shared.uCloudSpin.value = t * 0.05;
      ground.material.uniforms.uTime.value = t;
      sky.material.uniforms.uTime.value = t;
      shared.uCentre.value.copy(group.position);
      moons.forEach((m, i) => moonOrbit(i, 2.2 + i * 2.4 + t * (i ? 0.016 : 0.01), m.position));
    },
  };
}
