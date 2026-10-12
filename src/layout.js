// The world plan: floating islands in the sky. Downtown with the Chog Hub in the middle, the
// biggest and highest; a neighbourhood of domes on each island around it, each at its own height
// and its own distance, joined to downtown by bridges that slope or step between the levels.
export const WORLD = {
  landH: 2.2,
  cloudSeaY: -40,
};

export const DOME_R = 17;
const HOOD_DOME_RING = 46;
const HOOD_LOOP_R = 26;
const TERRACE_H = 5;

const BIOME_CYCLE = ['meadow', 'frost', 'grove', 'meadow', 'grove'];
const ACCENTS = ['#a78bfa', '#7cc7ff', '#f07fd8', '#b6f09c', '#ffb86b'];

/*
 * Islands. r is the island's inner outline; its lobes reach further out (see terrain.js).
 * y lifts the whole island. under picks its underside: crystal, roots, chains or falls.
 * landmark is the one thing you spot it by from afar.
 */
const HUB = { id: 'downtown', x: 0, z: 0, r: 110, y: 16, depth: 96, seed: 1, under: 'crystal', landmark: 'hub', falls: 1 };
const HOOD_SPECS = [
  { angle: 1.62, gap: 46, r: 72, y: 0, depth: 56, seed: 3, under: 'roots', landmark: 'tree', falls: 0 },
  { angle: 1.62 + 2.17, gap: 54, r: 70, y: 7, depth: 64, seed: 5, under: 'chains', landmark: 'turbine', falls: 0 },
  { angle: 1.62 + 4.22, gap: 42, r: 74, y: -6, depth: 74, seed: 7, under: 'falls', landmark: 'beacon', falls: 2 },
];

export const HOODS = HOOD_SPECS.map((s, h) => {
  const dist = HUB.r + s.gap + s.r;
  return { id: h, ...s, x: Math.cos(s.angle) * dist, z: Math.sin(s.angle) * dist, loopR: HOOD_LOOP_R };
});

export const ISLANDS = [HUB, ...HOODS.map((h) => ({ ...h, id: `hood${h.id}` }))];

/** Ground level of an island before hills and terraces. */
export const baseY = (isl) => isl.y + WORLD.landH;

// The hub's plaza and building.
export const DOWNTOWN = { x: 0, z: 0, r: 52, y: baseY(HUB) };
export const CAFE = { x: 0, z: 0 };

// Raised plateaus with cliff edges: one in the middle of each neighbourhood (its landmark stands
// on it), two garden terraces downtown between the bridge roads.
export const TERRACES = [];
for (const h of HOODS) TERRACES.push({ isl: `hood${h.id}`, x: h.x, z: h.z, r: 17, h: TERRACE_H });
{
  const a = HOODS.map((h) => h.angle).sort((p, q) => p - q);
  const mids = a.map((v, i) => (i === a.length - 1 ? (v + a[0] + Math.PI * 2) / 2 : (v + a[i + 1]) / 2));
  for (const m of mids.slice(0, 2)) TERRACES.push({ isl: 'downtown', x: Math.cos(m) * 75, z: Math.sin(m) * 75, r: 12, h: 4 });
}

// Five domes per neighbourhood, spread around the side facing away from downtown.
export const DOMES = HOODS.flatMap((hood) =>
  [0, 1, 2, 3, 4].map((k) => {
    const theta = hood.angle + (k - 2) * 0.92;
    const x = hood.x + Math.cos(theta) * HOOD_DOME_RING;
    const z = hood.z + Math.sin(theta) * HOOD_DOME_RING;
    // Door faces the neighbourhood loop.
    const facing = Math.atan2(hood.x - x, hood.z - z);
    const doorX = x + Math.sin(facing) * (DOME_R + 1.5);
    const doorZ = z + Math.cos(facing) * (DOME_R + 1.5);
    return {
      hood: hood.id,
      y: baseY(hood),
      biome: BIOME_CYCLE[(k + hood.id * 2) % BIOME_CYCLE.length],
      accent: ACCENTS[(k + hood.id) % ACCENTS.length],
      x, z, facing, doorX, doorZ,
      loopX: hood.x + Math.cos(theta) * HOOD_LOOP_R,
      loopZ: hood.z + Math.sin(theta) * HOOD_LOOP_R,
    };
  }),
);

function circle(cx, cz, r, n = 64) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return pts;
}

function line(ax, az, bx, bz, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
  return pts;
}

/**
 * Bridges between downtown and each neighbourhood; ends sit a little inside each rim. ay and by
 * are the ground heights at the two ends, so a bridge between different levels slopes or steps.
 */
export const BRIDGES = HOODS.map((h) => {
  const ux = Math.cos(h.angle), uz = Math.sin(h.angle);
  const a = HUB.r - 6, b = HUB.r + h.gap + 6;
  return { hood: h.id, angle: h.angle, ax: ux * a, az: uz * a, bx: ux * b, bz: uz * b, ay: baseY(HUB) - 1.6, by: baseY(h) - 1.6, width: 5 };
});

/** Walkways on the islands. kind decides width and paving. */
export const ROADS = [];
// Downtown ring around the plaza, and a walk around the island near its edge.
ROADS.push({ kind: 'main', width: 5, closed: true, points: circle(0, 0, DOWNTOWN.r + 2.5, 64) });
ROADS.push({ kind: 'edge', width: 3.5, closed: true, points: circle(0, 0, HUB.r - 14, 80) });
for (const h of HOODS) {
  const ux = Math.cos(h.angle), uz = Math.sin(h.angle);
  const br = BRIDGES[h.id];
  // Downtown ring out to the bridge.
  ROADS.push({ kind: 'main', width: 5, closed: false, points: line(ux * (DOWNTOWN.r + 2.5), uz * (DOWNTOWN.r + 2.5), br.ax, br.az) });
  // Bridge landing to the neighbourhood loop.
  ROADS.push({ kind: 'main', width: 5, closed: false, points: line(br.bx, br.bz, h.x - ux * h.loopR, h.z - uz * h.loopR) });
  ROADS.push({ kind: 'main', width: 4.5, closed: true, points: circle(h.x, h.z, h.loopR, 48) });
}
// A drive from every dome door to its loop.
for (const d of DOMES) ROADS.push({ kind: 'drive', width: 3, closed: false, points: [[d.doorX, d.doorZ], [d.loopX, d.loopZ]] });

// Segment grid for fast "how far to the nearest walkway" queries (bridges included).
const CELL = 16;
const REACH = 22;
const grid = new Map();
function addSegment(ax, az, bx, bz, half) {
  const s = { ax, az, bx, bz, half };
  const x0 = Math.floor((Math.min(ax, bx) - REACH) / CELL), x1 = Math.floor((Math.max(ax, bx) + REACH) / CELL);
  const z0 = Math.floor((Math.min(az, bz) - REACH) / CELL), z1 = Math.floor((Math.max(az, bz) + REACH) / CELL);
  for (let gx = x0; gx <= x1; gx++) {
    for (let gz = z0; gz <= z1; gz++) {
      const key = gx * 100003 + gz;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(s);
    }
  }
}
for (const road of ROADS) {
  const p = road.points;
  const n = road.closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) addSegment(p[i][0], p[i][1], p[(i + 1) % p.length][0], p[(i + 1) % p.length][1], road.width / 2);
}
for (const b of BRIDGES) addSegment(b.ax, b.az, b.bx, b.bz, b.width / 2);

/** Distance from a point to the edge of the nearest walkway (negative inside it). Capped at REACH. */
export function roadDistance(x, z) {
  const list = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
  if (!list) return REACH;
  let best = REACH;
  for (const s of list) {
    const vx = s.bx - s.ax, vz = s.bz - s.az;
    const t = Math.min(1, Math.max(0, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(x - (s.ax + vx * t), z - (s.az + vz * t)) - s.half;
    if (d < best) best = d;
  }
  return best;
}

export function nearDome(x, z, pad = 0) {
  for (const d of DOMES) if (Math.hypot(x - d.x, z - d.z) < DOME_R + pad) return d;
  return null;
}
