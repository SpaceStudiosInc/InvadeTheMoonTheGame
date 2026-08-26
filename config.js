const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.webkitImageSmoothingEnabled = false;
ctx.mozImageSmoothingEnabled = false;
ctx.msImageSmoothingEnabled = false;
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
mctx.imageSmoothingEnabled = false;
mctx.webkitImageSmoothingEnabled = false;
mctx.mozImageSmoothingEnabled = false;
const W = canvas.width, H = canvas.height;
const WALL = 16;
const DOOR_W = 96; // multiple of 16 — wider so doors line up with hall corridors
const GRID = 6;

const MISSIONS = {
  1: { id: 1, name: 'Flight to the Moon', mode: 'invaders', locked: false },
  2: { id: 2, name: 'Surface Base Assault', mode: 'openfield', locked: false },
  3: { id: 3, name: 'Lunar Complex', mode: 'dungeon', locked: false }
};
let currentMission = 1;
const MAX_PLAYER_PROJS = 28;
const MAX_ENEMY_PROJS = 18;
const MAX_PARTICLES = 140;

// ── tunable combat / layout ──────────────────────────────
const BOSS_HP = 1000;           // change this to retune boss health
const HALL_TILES = 6;           // walkable corridor thickness in tiles (was 4 — too tight)
const HALL_THICKNESS = HALL_TILES * 16; // 96px — matches DOOR_W
const HALL_ENEMY_CHANCE = 0.18; // rare chance a hallway has 1 enemy
const BOSS_SPAWN_DELAY = 60;    // frames (~1s) before boss appears after entering
const ENEMY_SPAWN_DELAY = 40;   // frames (~0.65s) before room enemies wake up after you enter
// Hallway wall borders (in tiles) — symmetric so floors/doors stay aligned
const HALL_WALL_SIDE = 1;       // vertical halls: 1 tile wall each side
const HALL_WALL_TOP = 1;        // horizontal halls: 1 tile on top (was 2 — caused offset)
const HALL_WALL_BOTTOM = 1;     // horizontal halls: 1 tile on bottom
// Columns & hazards & shapes
const COLUMN_TILES = 4;         // column size in tiles (2x previous → 4x4)
// (No hazard-damage tuning needed — all hazard tiles are impassable, not harmful.)

// ════════════════════════════════════════
// ROOM LAYOUTS (author these yourself)
// ─────────────────────────────────────────
// kind:
//   plain       – safe floor, no hazard tiles
//   safe_circle – circular island of floor; everything else is an impassable hole
//   kill_border – impassable holes around the outer rim (blocks, never hurts)
//   cross       – safe + shaped path; rest is impassable holes
//   loop        – safe ring path; impassable holes in the center (and outer corners)
//   islands     – a few safe pads; rest is impassable holes
//   gauntlet    – hallway: impassable holes on the long edges of the corridor
//
// Add new entries here, then put their id into LAYOUT_POOLS below.
// ════════════════════════════════════════
const ROOM_LAYOUTS = {
  plain:       { kind: 'plain' },
  arena:       { kind: 'safe_circle', radiusTiles: 13 },
  tight_arena: { kind: 'safe_circle', radiusTiles: 11 },
  rim_danger:  { kind: 'kill_border', borderTiles: 2 },
  thick_rim:   { kind: 'kill_border', borderTiles: 3 },
  cross:       { kind: 'cross', armTiles: 5 },
  loop:        { kind: 'loop', pathTiles: 5, innerRadiusTiles: 4 },
  islands:     { kind: 'islands', count: 3, padTiles: 5 },
  gauntlet:    { kind: 'gauntlet', edgeTiles: 1 }
};

// Prefer open / readable layouts; fewer awkward islands
const LAYOUT_POOLS = {
  start:    ['plain'],
  normal:   ['plain', 'plain', 'plain', 'arena', 'rim_danger', 'cross', 'loop'],
  chest:    ['plain', 'plain', 'rim_danger'],
  key:      ['plain', 'arena'],
  boss:     ['plain'],
  hallway:  ['plain'],
  bosshall: ['plain']
};

function drawSpriteFit(img, x, y, maxSize) {
  const scale = maxSize / Math.max(img.width, img.height);
  // Snap to whole pixels so scaled sprites stay crisp
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const dx = Math.round(x - w / 2);
  const dy = Math.round(y - h / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, dx, dy, w, h);
}

function seededRng(seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed += seedStr.charCodeAt(i) * (i + 1);
  return () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
}

// ════════════════════════════════════════
// SPRITES
// ════════════════════════════════════════
const SPRITE_PATHS = {
  player:     'sprites/astronaut.png',
  slime:      'sprites/martian_crawler.png',
  shooter:    'sprites/martian_gunner.png',
  barrel:     'sprites/explosive_barrel.png',
  chest:      'sprites/chest.png',
  health:     'sprites/health.png',
  heart:      'sprites/Heart.png',
  emptyHeart: 'sprites/EmptyHeart.png',
  ammo:       'sprites/ammo.png',
  ammobullet: 'sprites/ammobullet.png',
  projectile: 'sprites/projectile.png',
  key:        'sprites/key.png',
  bossSkull:  'sprites/martian_boss.png', // was boss_skull.png (missing) — use martian boss art
  bosstile:   'sprites/bosstile.png',
  spike:      'sprites/Spike.png',
  moon:       'sprites/moon.png',
  ship:       'sprites/Ship.png',
  enemyShip:  'sprites/EnemyShip.png',
  enemyShip2: 'sprites/EnemyShip2.png',
  particleRed:  'sprites/Redparticle.png',
  particleBlue: 'sprites/BluePartical.png',
  drill:      'sprites/Drill.png',
  truck:      'sprites/Truck.png',
  lifeSupport:'sprites/LifeSupport.png'
};
const AMMO_ICON_MAX = 10;
const AMMO_ICON_REF = 30;

// ════════════════════════════════════════
// RARITY
// ════════════════════════════════════════
const RARITY = {
  common:    { label: 'COMMON',    color: '#c7ccd6', weight: 10 },
  uncommon:  { label: 'UNCOMMON',  color: '#7fd88f', weight: 5  },
  rare:      { label: 'RARE',      color: '#7fb0ff', weight: 2  },
  legendary: { label: 'LEGENDARY', color: '#f4c430', weight: 1  }
};

// ════════════════════════════════════════
// GUNS
// ════════════════════════════════════════
const GUNS = [
  { id:'pistol', name:'PISTOL', file:'guns/pistol.png', frameW:32, frameH:32, frames:3,
    rarity:null, dmg:1, cooldown:16, speed:9, pr:4, pellets:1, auto:false, ammoCost:0, color:'#eef2f8' },

  // --- common ---
  { id:'mp5', name:'MP5', file:'guns/MP5.png', frameW:88, frameH:48, frames:3,
    rarity:'common', dmg:1, cooldown:8, speed:9, pr:4, pellets:1, auto:true, ammoCost:1, color:'#eef2f8' },
  { id:'mp7', name:'MP7', file:'guns/MP7.png', frameW:88, frameH:48, frames:3,
    rarity:'common', dmg:1, cooldown:7, speed:9.5, pr:4, pellets:1, auto:true, ammoCost:1, color:'#eef2f8' },
  { id:'m4a1', name:'M4A1', file:'guns/M4A1.png', frameW:88, frameH:48, frames:3,
    rarity:'common', dmg:2, cooldown:9, speed:9.5, pr:4.5, pellets:1, auto:true, ammoCost:1, color:'#f4e8b0' },
  { id:'aug', name:'AUG', file:'guns/AUG.png', frameW:88, frameH:48, frames:3,
    rarity:'common', dmg:2, cooldown:9, speed:9.5, pr:4.5, pellets:1, auto:true, ammoCost:1, color:'#f4e8b0' },
  { id:'ak74', name:'AK-74', file:'guns/AK74.png', frameW:88, frameH:48, frames:4,
    rarity:'common', dmg:2, cooldown:10, speed:9, pr:4.5, pellets:1, auto:true, ammoCost:1, color:'#f4e8b0' },
  { id:'autogun', name:'AUTOGUN', file:'guns/AutoGun.png', frameW:32, frameH:32, frames:3,
    rarity:'common', dmg:1, cooldown:6, speed:8.5, pr:4, pellets:1, auto:true, ammoCost:1, color:'#c9f4ff' },
  { id:'kriss', name:'KRISS VECTOR', file:'guns/KrissVectorSMG.png', frameW:88, frameH:48, frames:3,
    rarity:'common', dmg:1, cooldown:6, speed:9.5, pr:4, pellets:1, auto:true, ammoCost:1, color:'#eef2f8' },
  { id:'asval', name:'AS VAL', file:'guns/ASVAL.png', frameW:88, frameH:48, frames:4,
    rarity:'common', dmg:2, cooldown:8, speed:9.5, pr:4.5, pellets:1, auto:true, ammoCost:1, color:'#a0e8c0' },

  // --- uncommon ---
  { id:'p90', name:'P90', file:'guns/P90.png', frameW:88, frameH:48, frames:4,
    rarity:'uncommon', dmg:2, cooldown:6, speed:10, pr:4.5, pellets:1, auto:true, ammoCost:1, color:'#9fd8ff' },
  { id:'hk417', name:'HK417', file:'guns/HK417.png', frameW:88, frameH:48, frames:3,
    rarity:'uncommon', dmg:4, cooldown:16, speed:11, pr:5, pellets:1, auto:false, ammoCost:1, color:'#f4c98f' },
  { id:'siega', name:'SIEGA SHOTGUN', file:'guns/SiegaShotgun.png', frameW:88, frameH:48, frames:3,
    rarity:'uncommon', dmg:2, cooldown:34, speed:8, pr:4, pellets:6, spread:0.5, auto:false, ammoCost:2, color:'#f4a05a' },
  { id:'spas', name:'SPAS SHOTGUN', file:'guns/SpasShotgun.png', frameW:88, frameH:48, frames:3,
    rarity:'uncommon', dmg:2, cooldown:30, speed:8, pr:4, pellets:7, spread:0.55, auto:false, ammoCost:2, color:'#f4a05a' },

  // --- rare ---
  { id:'m110', name:'M110', file:'guns/M110.png', frameW:88, frameH:48, frames:3,
    rarity:'rare', dmg:5, cooldown:20, speed:12, pr:5, pellets:1, auto:false, ammoCost:1, color:'#9fd8ff' },
  { id:'sniper', name:'SNIPER RIFLE', file:'guns/SniperRifle1.png', frameW:88, frameH:48, frames:5,
    rarity:'rare', dmg:9, cooldown:50, speed:15, pr:5, pellets:1, auto:false, ammoCost:2, pierce:true, color:'#d8e8ff' },
  { id:'m240', name:'M240', file:'guns/M240.png', frameW:88, frameH:48, frames:3,
    rarity:'rare', dmg:2, cooldown:5, speed:9, pr:4.5, pellets:1, auto:true, ammoCost:1, color:'#f4c98f' },
  { id:'aa10', name:'AA-10', file:'guns/AA10.png', frameW:88, frameH:48, frames:3,
    rarity:'rare', dmg:2, cooldown:14, speed:8, pr:4, pellets:4, spread:0.35, auto:true, ammoCost:2, color:'#f4a05a' },

  // --- legendary ---
  { id:'moongun', name:'MOON GUN', file:'guns/MoonGun.png', frameW:88, frameH:48, frames:4,
    rarity:'legendary', dmg:3, cooldown:30, speed:7, pr:7, pellets:1, auto:false, ammoCost:3,
    explosive:true, splashR:80, splashDmg:4, color:'#f4e08a' },
  { id:'death', name:'DEATH', file:'guns/Death.png', frameW:32, frameH:32, frames:3,
    rarity:'legendary', dmg:6, cooldown:26, speed:16, pr:5, pellets:1, auto:false, ammoCost:3,
    pierce:true, color:'#ff5a5a' }
];
const GUN_MAP = {};
GUNS.forEach(g => GUN_MAP[g.id] = g);

const ARSENAL = [...GUNS];
const ARSENAL_MAP = {};
ARSENAL.forEach(w => ARSENAL_MAP[w.id] = w);

const CHEST_POOL = GUNS.filter(g => g.id !== 'pistol');

function weightedPick(list) {
  const total = list.reduce((s, g) => s + (RARITY[g.rarity] ? RARITY[g.rarity].weight : 1), 0);
  let roll = Math.random() * total;
  for (const g of list) {
    const w = RARITY[g.rarity] ? RARITY[g.rarity].weight : 1;
    if (roll < w) return g;
    roll -= w;
  }
  return list[list.length - 1];
}

// ════════════════════════════════════════
// PICKUPS
// ════════════════════════════════════════
const AMMO_PICKUP_AMOUNT = 30;
const HEALTH_PICKUP_HEAL = 4;
const STARTING_AMMO = 30;