function loadImage(path) {
  const img = new Image();
  img.ok = false;
  img.onload = () => { img.ok = true; };
  img.onerror = () => { img.ok = false; };
  img.src = path;
  return img;
}
function spriteReady(key) { return SPRITES[key] && SPRITES[key].ok; }

// ── Pre-rotated projectile sprites ───────────────────────
// Rotating via ctx.save()/rotate()/restore() on every single bullet, every
// frame, is one of the more expensive Canvas2D calls — with the bullet cap
// (28 player + 18 enemy = 46) that's up to 46 transform ops every frame just
// for projectiles. Instead, bake a ring of pre-rotated copies once when the
// sprite loads, then just drawImage() the closest one — no transform math
// at draw time.
const PROJ_ROT_STEPS = 24;
const PROJ_CANVAS = 48; // padded bounding square so a rotated 32x32 sprite never clips corners
let _projRotSprites = null;
let _projPadRatio = 1;
function buildProjRotSprites() {
  const src = SPRITES.projectile;
  if (!src || !src.ok || _projRotSprites) return;
  _projPadRatio = PROJ_CANVAS / Math.max(src.width, src.height); // compensates for the padding below
  _projRotSprites = [];
  for (let i = 0; i < PROJ_ROT_STEPS; i++) {
    const c = document.createElement('canvas');
    c.width = PROJ_CANVAS; c.height = PROJ_CANVAS;
    const cctx = c.getContext('2d');
    cctx.imageSmoothingEnabled = false;
    cctx.translate(PROJ_CANVAS / 2, PROJ_CANVAS / 2);
    cctx.rotate((i / PROJ_ROT_STEPS) * Math.PI * 2);
    cctx.drawImage(src, -src.width / 2, -src.height / 2);
    _projRotSprites.push(c);
  }
}
/** Draw a bullet sprite pointed along (dx,dy) without any per-call canvas transform.
 *  `size` is the intended visible sprite size (same meaning as the old rotate-per-call code). */
function drawProjectileFast(x, y, dx, dy, size, alpha) {
  if (!_projRotSprites) {
    buildProjRotSprites();
    if (!_projRotSprites) return false; // sprite not loaded yet — caller falls back to a dot
  }
  const ang = Math.atan2(dy, dx) + Math.PI / 2;
  const norm = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const idx = Math.round(norm / (Math.PI * 2) * PROJ_ROT_STEPS) % PROJ_ROT_STEPS;
  const img = _projRotSprites[idx];
  const dstSize = size * _projPadRatio; // scale up to offset the canvas padding, so the visible sprite is still `size`
  if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(img, Math.round(x - dstSize / 2), Math.round(y - dstSize / 2), dstSize, dstSize);
  if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = 1;
  return true;
}

const SPRITES = {};
for (const key in SPRITE_PATHS) SPRITES[key] = loadImage(SPRITE_PATHS[key]);

// ════════════════════════════════════════
// TILESET (16x16, 4 columns x 3 rows; [col, row], 0-indexed)
// The sheet is only 3 rows tall (64×48px) — there is no 4th row.
// Legend (as authored):
//   row1 (y0): floor1, floor2, floor3, (reserved)
//              4th slot (old "hole edge" tile) is no longer used — holes
//              render as a single plain 'hole' tile now, no separate rim tile
//   row2 (y1): wall1, wall2, wall3, wall4        — all 4 are plain wall variants
//   row3 (y2): (reserved), (reserved), hole, doorOpen
//              col1 = no longer used — the boss door now renders with the
//                     bosstile.png sprite instead of a tileset tile
//              col2 = reserved, NOT wired into TILE_MAP — no spikes/hazard
//                     tile is used anywhere in the game anymore
//              col3 = 'hole' — an impassable pit tile that blocks movement
//                     like a wall (never damages or kills the player)
//              col4 = 'doorOpen' — solid white, was reserved/unused
//   doorClosed reuses [3, 0] (solid black, was reserved/unused) since
//   there's no dedicated closed-door art in the sheet.
//   NOTE: a previous version pointed doorLock at [0, 3] — a 4th row that
//   doesn't exist in this image — so every door silently drew nothing.
// ════════════════════════════════════════
const TILE_SIZE = 16;
const TILE_MAP = {
  floor1:     [0, 0],
  floor2:     [1, 0],
  floor3:     [2, 0],
  doorClosed: [3, 0], // solid black — closed / locked door
  wall1:      [0, 1],
  wall2:      [1, 1],
  wall3:      [2, 1],
  wall4:      [3, 1],
  // [0, 2] reserved / unused — old boss door tile, retired (see bosstile.png)
  // [1, 2] reserved — spikes/hazard tile, intentionally never wired up
  hole:       [2, 2], // impassable pit — blocks movement like a wall
  doorOpen:   [3, 2]  // solid white — open / unlocked door
};
const tilesetImg = loadImage('sprites/tileset.png');

function makeTileCanvas(col, row) {
  const c = document.createElement('canvas');
  c.width = TILE_SIZE; c.height = TILE_SIZE;
  const cctx = c.getContext('2d');
  cctx.imageSmoothingEnabled = false;
  c.ok = false;
  c.draw = () => {
    cctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    cctx.drawImage(
      tilesetImg,
      col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE,
      0, 0, TILE_SIZE, TILE_SIZE
    );
    c.ok = true;
  };
  return c;
}

for (const name in TILE_MAP) {
  const [col, row] = TILE_MAP[name];
  SPRITES[name] = makeTileCanvas(col, row);
}
tilesetImg.onload = () => {
  tilesetImg.ok = true;
  for (const name in TILE_MAP) SPRITES[name].draw();
};

// ════════════════════════════════════════
// GUN SHEETS
// ════════════════════════════════════════
const GUN_IMAGES = {};
ARSENAL.forEach(w => {
  if (w.kind === 'melee') return;
  GUN_IMAGES[w.id] = { img: loadImage(w.file), frameW: w.frameW, frameH: w.frameH, frames: w.frames };
});
function gunSpriteReady(id) {
  const g = GUN_IMAGES[id];
  return g && g.img.ok;
}
function drawGunFrame(id, frame, x, y, targetH, flipX) {
  const g = GUN_IMAGES[id];
  if (!g || !g.img.ok) return false;
  const f = Math.max(0, Math.min(g.frames - 1, frame));
  const scale = targetH / g.frameH;
  const w = g.frameW * scale, h = g.frameH * scale;
  ctx.save();
  ctx.translate(x, y);
  if (flipX) ctx.scale(1, -1);
  ctx.drawImage(g.img, f * g.frameW, 0, g.frameW, g.frameH, 0, -h / 2, w, h);
  ctx.restore();
  return true;
}

// ════════════════════════════════════════
// SFX
// ════════════════════════════════════════
const SFX_PATHS = {
  pistol:      'sfx/Pistol.wav',
  rifle:       'sfx/Rifle.wav',
  shotgun:     'sfx/Shotgun.wav',
  hurt:        'sfx/hurt.wav',
  pickup:      'sfx/pickup.wav',
  gameover:    'sfx/gameover.wav',
  enemyShot:   'sfx/Pistol.wav',
  playerShip:  'sfx/PlayerShip.wav',
  enemyShip1:  'sfx/EnemyShip1.wav',
  enemyShip2:  'sfx/EnemyShip2.wav',
  explosion:   'sfx/Explosion.wav'
};
const SFX = {};
const SFX_VOL = {
  pistol: 0.55, rifle: 0.5, shotgun: 0.55,
  hurt: 0.65, pickup: 0.55, gameover: 0.7,
  enemyShot: 0.35,
  playerShip: 0.6, enemyShip1: 0.45, enemyShip2: 0.45,
  explosion: 0.75
};

// Options (persisted in localStorage)
function _loadNum(key, def) {
  const v = parseFloat(localStorage.getItem(key));
  return Number.isFinite(v) ? v : def;
}
let sfxEnabled = localStorage.getItem('itm_sfx') !== '0';
let musicEnabled = localStorage.getItem('itm_music') !== '0'; // reserved for music later
let sfxVolume = Math.min(1, Math.max(0, _loadNum('itm_sfx_vol', 0.7)));
let musicVolume = Math.min(1, Math.max(0, _loadNum('itm_music_vol', 0.5)));
let particlesEnabled = localStorage.getItem('itm_particles') !== '0';
let minimapEnabled = localStorage.getItem('itm_minimap') !== '0';
let showFps = localStorage.getItem('itm_fps') === '1';

function loadSfx(path) {
  const a = new Audio(path);
  a.preload = 'auto';
  return a;
}
for (const k in SFX_PATHS) SFX[k] = loadSfx(SFX_PATHS[k]);

/** Play SFX via small pool (avoids cloneNode GC spikes). */
const _sfxPool = {};
const _sfxLast = {};
function playSfx(key) {
  if (!sfxEnabled || sfxVolume <= 0) return;
  const src = SFX[key];
  if (!src) return;
  // throttle very spammy keys
  const now = performance.now();
  const minGap = (key === 'playerShip' || key === 'enemyShip1' || key === 'enemyShip2') ? 40
    : (key === 'pistol' || key === 'rifle' || key === 'shotgun') ? 55 : 0;
  if (minGap && _sfxLast[key] && now - _sfxLast[key] < minGap) return;
  _sfxLast[key] = now;
  try {
    if (!_sfxPool[key]) _sfxPool[key] = [];
    const pool = _sfxPool[key];
    let a = null;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].paused || pool[i].ended) { a = pool[i]; break; }
    }
    if (!a) {
      if (pool.length >= 4) a = pool[0];
      else { a = src.cloneNode(); pool.push(a); }
    }
    const base = SFX_VOL[key] != null ? SFX_VOL[key] : 0.5;
    a.volume = Math.min(1, Math.max(0, base * sfxVolume));
    try { a.currentTime = 0; } catch (e) {}
    a.play().catch(() => {});
  } catch (e) {}
}

function setSfxEnabled(on) {
  sfxEnabled = !!on;
  localStorage.setItem('itm_sfx', sfxEnabled ? '1' : '0');
}

// ── Music (looping tracks) ───────────────────────────────
const MUSIC_PATHS = {
  title: 'music/INVADE.mp3', // use INVADE until MENU.mp3 is added
  game:  'music/INVADE.mp3',
  boss:  'music/TAKE.mp3'
};
const MUSIC = {};
let currentMusicKey = null;
function loadMusic(path) {
  const a = new Audio(path);
  a.preload = 'auto';
  a.loop = true;
  a.volume = 0;
  return a;
}
for (const k in MUSIC_PATHS) MUSIC[k] = loadMusic(MUSIC_PATHS[k]);

function _applyMusicVol() {
  const v = (musicEnabled && musicVolume > 0) ? musicVolume : 0;
  for (const k in MUSIC) if (MUSIC[k]) MUSIC[k].volume = Math.min(1, Math.max(0, v));
}

function playMusic(key) {
  if (!MUSIC[key]) return;
  if (currentMusicKey === key && MUSIC[key] && !MUSIC[key].paused) {
    _applyMusicVol();
    return;
  }
  for (const k in MUSIC) {
    if (k !== key && MUSIC[k] && !MUSIC[k].paused) {
      try { MUSIC[k].pause(); } catch (e) {}
    }
  }
  currentMusicKey = key;
  _applyMusicVol();
  if (!musicEnabled || musicVolume <= 0) return;
  try {
    MUSIC[key].currentTime = 0;
  } catch (e) {}
  const p = MUSIC[key].play();
  if (p && p.catch) p.catch(() => {});
}

function stopMusic() {
  for (const k in MUSIC) {
    if (MUSIC[k] && !MUSIC[k].paused) {
      try { MUSIC[k].pause(); MUSIC[k].currentTime = 0; } catch (e) {}
    }
  }
  currentMusicKey = null;
}

function setMusicEnabled(on) {
  musicEnabled = !!on;
  localStorage.setItem('itm_music', musicEnabled ? '1' : '0');
  if (!musicEnabled) {
    for (const k in MUSIC) {
      if (MUSIC[k] && !MUSIC[k].paused) try { MUSIC[k].pause(); } catch (e) {}
    }
  } else if (currentMusicKey) {
    playMusic(currentMusicKey);
  }
  _applyMusicVol();
}
function setSfxVolume(v) {
  sfxVolume = Math.min(1, Math.max(0, Number(v) || 0));
  localStorage.setItem('itm_sfx_vol', String(sfxVolume));
}
function setMusicVolume(v) {
  musicVolume = Math.min(1, Math.max(0, Number(v) || 0));
  localStorage.setItem('itm_music_vol', String(musicVolume));
  _applyMusicVol();
}
function setParticlesEnabled(on) {
  particlesEnabled = !!on;
  localStorage.setItem('itm_particles', particlesEnabled ? '1' : '0');
}
function setMinimapEnabled(on) {
  minimapEnabled = !!on;
  localStorage.setItem('itm_minimap', minimapEnabled ? '1' : '0');
  const mini = document.getElementById('minimap');
  if (mini) mini.style.visibility = minimapEnabled ? 'visible' : 'hidden';
}
function setShowFps(on) {
  showFps = !!on;
  localStorage.setItem('itm_fps', showFps ? '1' : '0');
}
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

/** Map current weapon → gun SFX category. */
function gunSfxKey(w) {
  if (!w) return 'pistol';
  if ((w.pellets || 1) > 1) return 'shotgun';
  if (w.id === 'pistol' || w.id === 'autogun' || w.id === 'death') return 'pistol';
  return 'rifle';
}
