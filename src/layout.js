// The world plan: floating islands in the sky. Downtown with Chog Hub in the middle,
// a neighbourhood of domes on each surrounding island, bridges between them.
export const WORLD = {
  landH: 2.2,
  cloudSeaY: -320,
};

export const DOWNTOWN = { x: 0, z: 0, r: 24 };
export const DOME_R = 17;

const DOWNTOWN_ISLAND_R = 58;
const HOOD_ISLAND_R = 78;
const BRIDGE_GAP = 42;
const HOOD_DIST = DOWNTOWN_ISLAND_R + BRIDGE_GAP + HOOD_ISLAND_R;
const HOOD_DOME_RING = 50;
const HOOD_LOOP_R = 26;

const BIOME_CYCLE = ['meadow', 'frost', 'grove', 'meadow', 'grove'];
const ACCENTS = ['#a78bfa', '#7cc7ff', '#f07fd8', '#b6f09c', '#ffb86b'];

export const HOODS = [Math.PI / 2, Math.PI / 2 + (Math.PI * 2) / 3, Math.PI / 2 + (Math.PI * 4) / 3].map((angle, h) => ({
  id: h,
  angle,
  x: Math.cos(angle) * HOOD_DIST,
  z: Math.sin(angle) * HOOD_DIST,
  loopR: HOOD_LOOP_R,
}));

/** Floating islands. depth is how far the rocky underside hangs below the surface. */
export const ISLANDS = [
  { id: 'downtown', x: 0, z: 0, r: DOWNTOWN_ISLAND_R, depth: 56, seed: 1 },
  ...HOODS.map((h) => ({ id: `hood${h.id}`, x: h.x, z: h.z, r: HOOD_ISLAND_R, depth: 70, seed: 3 + h.id * 2 })),
];

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

/** Bridges between downtown and each neighbourhood island; ends sit a little inside each rim. */
export const BRIDGES = HOODS.map((h) => {
  const ux = Math.cos(h.angle), uz = Math.sin(h.angle);
  const a = DOWNTOWN_ISLAND_R - 6, b = HOOD_DIST - HOOD_ISLAND_R + 6;
  return { ax: ux * a, az: uz * a, bx: ux * b, bz: uz * b, width: 5 };
});

/** Walkways on the islands. kind decides width and paving. */
export const ROADS = [];
// Downtown ring around the plaza, and a walk around the island near its edge.
ROADS.push({ kind: 'main', width: 5, closed: true, points: circle(0, 0, DOWNTOWN.r + 2.5, 56) });
ROADS.push({ kind: 'edge', width: 3.5, closed: true, points: circle(0, 0, DOWNTOWN_ISLAND_R - 12, 72) });
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

export const CAFE = { x: 0, z: -13 };
