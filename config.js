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

const MAX_PLAYER_PROJS = 160;
const MAX_ENEMY_PROJS = 48;
const MAX_PARTICLES = 64;

// ── tunable combat / layout ──────────────────────────────
const BOSS_HP = 200;
const HALL_TILES = 6;           // walkable corridor thickness in tiles (was 4 — too tight)
const HALL_THICKNESS = HALL_TILES * 16; // 96px — matches DOOR_W
const HALL_ENEMY_CHANCE = 0.18; // rare chance a hallway has 1 enemy
const BOSS_SPAWN_DELAY = 60;    // frames (~1s) before boss appears after entering
const ENEMY_SPAWN_DELAY = 40;   // frames (~0.65s) before room enemies wake up after you enter
const HALL_WALL_SIDE = 1;       // vertical halls: 1 tile wall each side
const HALL_WALL_TOP = 1;        // horizontal halls: 1 tile on top (was 2 — caused offset)
const HALL_WALL_BOTTOM = 1;     // horizontal halls: 1 tile on bottom
// Columns & hazards & shapes
const COLUMN_TILES = 4;         // column size in tiles (2x previous → 4x4)

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

const SPRITE_PATHS = {
  player:     'assets/sprites/astronaut.png',
  slime:      'assets/sprites/martian_crawler.png',
  shooter:    'assets/sprites/martian_gunner.png',
  barrel:     'assets/sprites/explosive_barrel.png',
  chest:      'assets/sprites/chest.png',
  health:     'assets/sprites/health.png',
  heart:      'assets/sprites/Heart.png',
  emptyHeart: 'assets/sprites/EmptyHeart.png',
  ammo:       'assets/sprites/ammo.png',
  ammobullet: 'assets/sprites/ammobullet.png',
  projectile: 'assets/sprites/projectile.png',
  key:        'assets/sprites/key.png',
  bossSkull:  'assets/bosses/boss1.png',
  boss1:      'assets/bosses/boss1.png',
  boss2:      'assets/bosses/boss2.png',
  boss3:      'assets/bosses/boss3.png',
  boss4:      'assets/bosses/boss4.png',
  boss5:      'assets/bosses/boss5.png',
  boss6:      'assets/bosses/boss6.png',
  boss7:      'assets/bosses/boss7.png',
  boss8:      'assets/bosses/boss8.png',
  boss9:      'assets/bosses/boss9.png',
  bosstile:   'assets/sprites/bosstile.png',
  particleRed:  'assets/sprites/Redparticle.png',
  particleBlue: 'assets/sprites/BluePartical.png',
  // Relic icons (16×16)
  relic_harden:    'assets/sprites/relics/harden.png',
  relic_moonboots: 'assets/sprites/relics/moonboots.png',
  relic_pockets:   'assets/sprites/relics/pockets.png',
  relic_gunoil:    'assets/sprites/relics/gunoil.png',
  relic_magnet:    'assets/sprites/relics/magnet.png',
  relic_pierce:    'assets/sprites/relics/pierce.png',
  relic_laser:     'assets/sprites/relics/laser.png'
};
const AMMO_ICON_MAX = 10;
const AMMO_ICON_REF = 30;

const RARITY = {
  common:    { label: 'COMMON',    color: '#c7ccd6', weight: 10 },
  uncommon:  { label: 'UNCOMMON',  color: '#7fd88f', weight: 5  },
  rare:      { label: 'RARE',      color: '#7fb0ff', weight: 2  },
  legendary: { label: 'LEGENDARY', color: '#f4c430', weight: 1  }
};

const GUNS = [
  { id: 'pistol', name: 'PISTOL', file: 'assets/guns/AutoGun.png', frameW: 32, frameH: 32, frames: 3,
    rarity: null, dmg: 2, cooldown: 14, speed: 10, pr: 4, pellets: 1, auto: false,
    ammoCost: 1, magSize: 12, reloadTime: 40,
    color: '#eef2f8', sfx: 'pistol' },

  { id: 'shotgun', name: 'SHOTGUN', file: 'assets/guns/Shotgun.png', frameW: 88, frameH: 48, frames: 3,
    rarity: 'common', dmg: 2, cooldown: 34, speed: 8, pr: 4, pellets: 6, spread: 0.5, auto: false,
    ammoCost: 1, magSize: 6, reloadTime: 55,
    color: '#f4a05a', sfx: 'shotgun' },

  { id: 'rifle', name: 'RIFLE', file: 'assets/guns/Rifle.png', frameW: 88, frameH: 48, frames: 4,
    rarity: 'uncommon', dmg: 3, cooldown: 9, speed: 11, pr: 4.5, pellets: 1, auto: true,
    ammoCost: 1, magSize: 30, reloadTime: 50,
    color: '#f4e8b0', sfx: 'rifle' },

  // Slow rocket — 1 in the tube, explodes on impact
  { id: 'rocket', name: 'ROCKET LAUNCHER', file: 'assets/guns/RPG.png', frameW: 88, frameH: 48, frames: 3,
    rarity: 'rare', dmg: 8, cooldown: 20, speed: 4.2, pr: 5, pellets: 1, auto: false,
    ammoCost: 1, magSize: 1, reloadTime: 70,
    explosive: true, splashR: 90, splashDmg: 8, color: '#f4e08a', sfx: 'explosion' },

  // Special / scarce
  { id: 'minigun', name: 'MINIGUN', file: 'assets/guns/Minigun.png', frameW: 88, frameH: 48, frames: 3,
    rarity: 'legendary', dmg: 2, cooldown: 4, speed: 10, pr: 4, pellets: 1, auto: true,
    ammoCost: 1, magSize: 80, reloadTime: 90,
    color: '#ff8f6b', sfx: 'rifle' }
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

const HEALTH_PICKUP_HEAL = 4;

const AMMO_GRANT = {
  pistol: 30,
  shotgun: 30,
  rifle: 60,
  rocket: 7,
  minigun: 75
};
const AMMO_MAX = {
  pistol: 9999,
  shotgun: 9999,
  rifle: 9999,
  rocket: 9999,
  minigun: 9999
};
// Legacy aliases
const STARTING_AMMO = 100; // deploy start reserve target
const PLAYER_MAX_AMMO = 75;
const AMMO_PICKUP_AMOUNT = 30;
