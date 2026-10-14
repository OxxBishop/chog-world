/*
 * How a Chog's traits become its 3D look and its personality.
 *
 * Models: the rigged Chog models (.glb, from Tripo) go in public/models/chogs/, at the paths below.
 * Every trait value already has a slot. A file only loads once its path is listed in READY, so the
 * world never asks for models that aren't there yet; until then each Chog is built from the
 * stand-in in chog.js, coloured by the same traits. To add a model: drop the .glb at its path and
 * add the path to READY.
 *
 * Expected .glb setup: the base model is the whole Chog, rigged, facing +z, about 2.2 m tall, feet on
 * the origin; a mesh or material named "Skin" takes the Skin colour. Head items, outfits and
 * accessories are separate .glb files placed in the base model's space, each skinned to the same
 * skeleton or parented to a bone named in ATTACH. Animation clips are found by the names in CLIPS.
 */

export const MODEL_DIR = 'models/chogs/';

// Paths of the model files that exist so far. Empty until the first .glb lands.
export const READY = new Set([
  // 'base/chog.glb',
]);

const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const slots = (folder, values) => Object.fromEntries(values.map((v) => [v, `${folder}/${slug(v)}.glb`]));

// Base body, by the Base trait. Any value missing here, or not READY, falls back to the plain Chog.
export const BASE_MODELS = {
  Origin: 'base/chog.glb',
  Skull: 'base/skull.glb',
  Radioactive: 'base/radioactive.glb',
  '1:1': 'base/chog.glb',
};
export const FALLBACK_BASE = 'base/chog.glb';

export const HEAD_MODELS = slots('head', [
  '10k TPS Cap', '3rd Eye', '8 Ball Beanie', 'BOOB Cap', 'BTC Beanie', 'BTC Cap', 'Balls Cap', 'Blue Bucket Cap', 'Blue Laser',
  'Bob Hair', 'Boob Cap', 'Buttcoin Cap', 'Chog Cap', 'Choggie Beanie', 'Choggie Cap', 'Cloud Cap', 'Clown Nose', 'Crown',
  'Demon Horn', 'Diamond', 'Dollar Cap', 'Durag', 'ETH Cap', 'Gold Thorn', 'Gray Bucket Cap', 'Head Wrap', 'Holy Seal',
  'Horny Cap', 'JEET Cap', 'Japan Headband', 'Jeet Cap', 'MCGA', 'MCGA Cap', 'MEGA Chog', 'MMGA Cap', 'Mafia Hat',
  'Mon Beanie', 'Mon Cap', 'NEET', 'Orange Bucket Cap', 'Peace Cap', 'Peace hat', 'Plumber', 'Poison Shroom', 'Purple Horn',
  'RETARD Cap', 'RH Beanie', 'Rainbow Wig', 'Red Bandana', 'Red Headband', 'Red Horn', 'Red Peace Cap', 'Robber', 'Russian Hat',
  'Silver Thorn', 'Silver wreath', 'Spartan Helmet', 'Star Cap', 'TISM Cap', 'Taped Banana', 'Thunder Cap', 'Void Horn',
  'WAGMI Cap', 'Wizard Beanie', 'Wizard Hat', 'devil horn',
]);

export const BODY_MODELS = slots('body', [
  'Aqua Tuxedo', 'Army Vest', 'Astro Suit', 'BBC', 'Banana suit', 'Black Shirt', 'Black Trackset', 'Black Vest', 'Blue 143 Jersey',
  'Blue Chinese', 'Blue Holed Jacket', 'Blue Homeless Shirt', 'Blue Mafia', 'Blue Sleeveless', 'Blue jacket', 'Blue tuxedo', 'Boner',
  'Brown Homeless Shirt', 'CEO Vest', 'CWO', 'Chug Life', 'Cream Tuxedo', 'Cyan Shirt', 'Cyan tuxedo', 'Dragon suit', 'Duck Float',
  'Electro Hoodie', 'Farmer Shirt', 'Fire Shirt', 'Gangster suit', 'Glitch Hoodie', 'Gojo', 'Golden Armor', 'Grey Homeless Shirt',
  'Grey Shirt', 'Guko', 'Hawaiian Polo', 'Inmate', 'Jesus', 'Jesus Robe', 'Kings Robe', 'MILF Lover', 'Mon Hoodie', 'Mummy',
  'Orange Holed Jacket', 'Orange Hoodie', 'Orange Sleeveless', 'Peach Hoodie', 'Pink Shirt', 'Pink Tuxedo', 'Prisoner', 'Purple Shirt',
  'Purple Tank', 'Red 143 Jersey', 'Red Chinese', 'Red Sleeveless', 'Red Trackset', 'Red Tuxedo', 'Red jacket', 'Red shirt', 'Sci Fi',
  'Shark Suit', 'Six Seven', 'Sky Hoodie', 'Squid Game', 'Squid Game Guard', 'Stripe Shirt', 'Stripe shirts', 'Stripes', 'Tank Top',
  'Toad green Suit', 'Toad pink suit', 'Tuxedo', 'Virgin', 'White Pure Shirt', 'White Shirt', 'White Sleeveless', 'White Tank',
  'White Yukata', 'White tuxedo', 'Wizard', 'Wizard Cape', 'Yellow 143 Jersey', 'Yellow Hoodie', 'Yellow Shirt', 'Yellow Yukata',
  'Zero THOTS', 'blue tee', 'dark jacket', 'dark tee', 'dark vest', 'pink vest', 'purple vest', 'red tee', 'toad blue suit', 'white tee',
]);

export const ACCESSORY_MODELS = slots('accessory', ['Cigar', 'Coin', 'Fwog', 'Green Candle', 'Heart', 'Knife', 'PEPE', 'Red Candle', 'SB']);

// Eyes and mouths are faces, so they're textures for the head's face, not models.
export const FACE_DIR = 'faces/';

// Bones the separate pieces hang from, if they aren't skinned to the skeleton.
export const ATTACH = { head: 'Head', body: 'Spine', accessory: 'HandR' };

// Animation clip names in the rigged models, by what the world asks for.
export const CLIPS = { idle: 'Idle', walk: 'Walk', run: 'Run', wake: 'WakeUp', wave: 'Wave', talk: 'Talk', sing: 'Sing', sniff: 'Sniff', cheer: 'Cheer', sad: 'Sad' };

// Skin colours, for the "Skin" material and the stand-in.
export const SKIN = {
  Origin: '#f6ecdc', Pink: '#f7cdd6', Red: '#e0705f', Black: '#4b3838', Yellow: '#f2d56b', Beige: '#ead2ae', Blue: '#8fb6ef',
  Green: '#93d48c', Grey: '#bdb8c2', Jade: '#6fbf9b', Metal: '#c4c8d0', 'Multi Colored': '#e9a8ff', Purple: '#b48cf0', White: '#fbfbf6',
};

// Aura glow colours. Clean means no aura.
export const AURA = {
  'Aqua Aura': '#5fe0e6', 'Burning Aura': '#ff7a3a', 'Cool Aura': '#7fc8ff', 'Electric Shock': '#9fe8ff', 'Fiery Aura': '#ff5a2e',
  Fire: '#ff8a2a', 'Green Aura': '#6ee07a', 'Light Purple': '#d0b4ff', Mint: '#8ff0c8', 'Pink Mist': '#ffb0dc', Purple: '#a77bff',
  'Rose Aura': '#ff8fb0', 'Rose Scent': '#ffb6c8', 'Royal Aura': '#e8c060', 'Royal Blue': '#5a7cff', 'Royal Blue Aura': '#5a7cff',
  Smoke: '#b8b0c0', Violet: '#9a5cff', 'White Aura': '#ffffff', Wind: '#d8f0ff', 'Yellow Aura': '#ffe066',
};

// How brightly a Chog's aura shines, by rarity.
export const TIER_GLOW = { Common: 0.35, Uncommon: 0.5, Rare: 0.75, Epic: 0.95, Legendary: 1.2 };

const COLOUR_WORDS = [
  ['gold', '#e8b84a'], ['red', '#d9474f'], ['blue', '#4f7fe0'], ['sky', '#7fc0f0'], ['cyan', '#4fd0d8'], ['aqua', '#4fd0c8'],
  ['yellow', '#f0cf4a'], ['orange', '#f08a3a'], ['pink', '#f08ab8'], ['peach', '#f4b08a'], ['purple', '#9a6cf0'], ['mon', '#8b6cf0'],
  ['green', '#5fbf5f'], ['toad', '#5fbf5f'], ['white', '#f4f1ea'], ['cream', '#f0e4c8'], ['grey', '#9a98a4'], ['gray', '#9a98a4'],
  ['black', '#2e2a36'], ['dark', '#2e2a36'], ['brown', '#8a5a3a'], ['banana', '#f2d34a'], ['shark', '#7a8aa8'], ['mummy', '#e8e0cc'],
];

// A colour named in a trait value, or a steady pick from a palette for values that name none.
export function colourIn(value, fallback = ['#9a6cf0', '#e46a8a', '#4f9fe0', '#f0b84a', '#5fbf8a']) {
  const v = (value ?? '').toLowerCase();
  for (const [word, hex] of COLOUR_WORDS) if (v.includes(word)) return hex;
  let h = 0;
  for (const ch of v) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return fallback[h % fallback.length];
}

// What kind of thing a head trait is, for the stand-in.
export function headKind(value = '') {
  const v = value.toLowerCase();
  if (v.includes('crown') || v.includes('wreath') || v.includes('thorn')) return 'crown';
  if (v.includes('horn')) return 'horns';
  if (v.includes('bucket')) return 'bucket';
  if (v.includes('beanie') || v.includes('russian')) return 'beanie';
  if (v.includes('wizard')) return 'wizard';
  if (v.includes('helmet') || v.includes('plumber') || v.includes('robber')) return 'helmet';
  if (v.includes('hat')) return 'hat';
  if (v.includes('band') || v.includes('wrap') || v.includes('durag') || v.includes('bandana')) return 'band';
  if (v.includes('wig') || v.includes('hair')) return 'hair';
  if (v.includes('cap') || v.includes('mcga') || v.includes('neet') || v.includes('mega')) return 'cap';
  return value ? 'token' : null;
}

/** Which model files a Chog needs, given its traits, falling back to the plain base where none is ready. */
export function lookFor(traits = {}) {
  const ready = (p) => (p && READY.has(p) ? MODEL_DIR + p : null);
  const basePath = BASE_MODELS[traits.Base] ?? FALLBACK_BASE;
  return {
    base: ready(basePath) ?? ready(FALLBACK_BASE),
    head: ready(HEAD_MODELS[traits.Head]),
    body: ready(BODY_MODELS[traits.Body]),
    accessory: ready(ACCESSORY_MODELS[traits.Accessory]),
    skin: SKIN[traits.Skin] ?? SKIN.Origin,
    outfit: traits.Naked === 'Yes' || !traits.Body ? null : colourIn(traits.Body),
    headKind: headKind(traits.Head),
    headColour: colourIn(traits.Head, ['#8b6cf0', '#f4f1ea', '#e46a8a', '#4f7fe0']),
    aura: traits.Aura && traits.Aura !== 'Clean' ? AURA[traits.Aura] ?? '#d0b4ff' : null,
    glow: TIER_GLOW[traits.Tier] ?? 0.35,
    skull: traits.Form === 'Skull' || traits.Base === 'Skull',
  };
}

/**
 * A Chog's personality from its traits: how lively it is, its mood, and how far it wanders. The world
 * uses these for idle animation speed, how often it moves about, and the little reactions it makes.
 */
export function personalityFor(traits = {}) {
  let energy = 0.5;
  let mood = 'easygoing';
  const mouth = (traits.Mouth ?? '').toLowerCase();
  const eyes = (traits.Eyes ?? '').toLowerCase();
  if (/smile|gold tooth|lip bite/.test(mouth)) mood = 'cheerful';
  if (/sad|worried/.test(mouth)) (mood = 'gentle'), (energy -= 0.15);
  if (/drool|puke|bubblegum|clown/.test(mouth)) (mood = 'silly'), (energy += 0.15);
  if (/grit|flat/.test(mouth)) mood = 'cool';
  if (/laser|thug|angry|mog/.test(eyes)) energy += 0.2;
  if (/tired|dead|closed|teary|crying/.test(eyes)) energy -= 0.2;
  if (/happy|heart|xd/.test(eyes)) (energy += 0.1), mood === 'easygoing' && (mood = 'cheerful');
  if (/burning|fiery|fire|electric/.test((traits.Aura ?? '').toLowerCase())) energy += 0.15;
  energy = Math.min(1, Math.max(0.1, energy));
  return { energy, mood, wander: 1.5 + energy * 3.5, idleSpeed: 0.6 + energy * 0.9 };
}

/*
 * How a Chog shows a mood from a chat: the move it makes (a name chog.js plays, or a clip in CLIPS),
 * the little badge over its head, and for rigged models the face morph target to blend in.
 * Moods come from the brain: happy, excited, calm, curious, surprised, sleepy, sad.
 */
export const MOODS = {
  happy: { act: 'wave', badge: '♥', colour: '#ff8fb5', face: 'Happy' },
  excited: { act: 'cheer', badge: '!!', colour: '#ffd166', face: 'Excited' },
  calm: { act: 'idle', badge: '~', colour: '#9fd8ff', face: 'Calm' },
  curious: { act: 'sniff', badge: '?', colour: '#c8a2ff', face: 'Curious' },
  surprised: { act: 'cheer', badge: '!', colour: '#ffe066', face: 'Surprised' },
  sleepy: { act: 'sleepy', badge: 'z', colour: '#b8b0e0', face: 'Sleepy' },
  sad: { act: 'sad', badge: '…', colour: '#8fa8d8', face: 'Sad' },
};
