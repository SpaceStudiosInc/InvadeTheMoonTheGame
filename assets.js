function loadImage(path) {
  const img = new Image();
  img.ok = false;
  img.onload = () => { img.ok = true; };
  img.onerror = () => { img.ok = false; };
  img.src = path;
  if (img.complete && img.naturalWidth > 0) img.ok = true;
  return img;
}
function spriteReady(key) { return SPRITES[key] && SPRITES[key].ok; }

// ── Pre-rotated projectile sprites ───────────────────────
const PROJ_ROT_STEPS = 24;
const PROJ_CANVAS = 48; // padded bounding square so a rotated 32x32 sprite never clips corners
let _projRotSprites = null;
let _projPadRatio = 1;
function buildProjRotSprites() {
  const src = SPRITES.projectile;
  if (!src || !src.ok || _projRotSprites) return;
  _projPadRatio = PROJ_CANVAS / Math.max(src.width, src.height);
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

function projRotIndex(dx, dy) {
  const ang = Math.atan2(dy, dx) + Math.PI / 2;
  const norm = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(norm / (Math.PI * 2) * PROJ_ROT_STEPS) % PROJ_ROT_STEPS;
}

function drawProjectileFast(x, y, dx, dy, size, alpha, rotIdx) {
  if (!_projRotSprites) {
    buildProjRotSprites();
    if (!_projRotSprites) return false;
  }
  const idx = (rotIdx !== undefined && rotIdx !== null)
    ? rotIdx
    : projRotIndex(dx, dy);
  const img = _projRotSprites[idx];
  const dstSize = size * _projPadRatio;
  const half = dstSize * 0.5;
  if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = alpha;
  // |0 is faster than Math.round for canvas pixel snapping
  ctx.drawImage(img, (x - half) | 0, (y - half) | 0, dstSize, dstSize);
  if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = 1;
  return true;
}

const SPRITES = {};
for (const key in SPRITE_PATHS) SPRITES[key] = loadImage(SPRITE_PATHS[key]);

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
  hole:       [2, 2], // impassable pit — blocks movement like a wall
  doorOpen:   [3, 2]  // solid white — open / unlocked door
};
const tilesetImg = loadImage('assets/sprites/tileset.png');

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

const GUN_IMAGES = {};
ARSENAL.forEach(w => {
  if (w.kind === 'melee') return;
  GUN_IMAGES[w.id] = { img: loadImage(w.file), frameW: w.frameW, frameH: w.frameH, frames: w.frames };
});
const RELIC_IMAGES = {};
['harden','moonboots','pockets','gunoil','magnet','pierce','laser'].forEach(id => {
  const src = (typeof RELIC_DATA_URLS !== 'undefined' && RELIC_DATA_URLS[id])
    ? RELIC_DATA_URLS[id]
    : ('assets/sprites/relics/' + id + '.png');
  RELIC_IMAGES[id] = loadImage(src);
});
function relicSpriteReady(id) {
  const img = RELIC_IMAGES[id];
  return !!(img && (img.ok || (img.complete && img.naturalWidth > 0)));
}
function drawRelicIcon(id, x, y, size) {
  const img = RELIC_IMAGES[id];
  if (!img) return false;
  if (!img.ok && !(img.complete && img.naturalWidth > 0)) return false;
  img.ok = true;
  const sz = size || 36;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
  return true;
}

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

const SFX_PATHS = {
  pistol:      'assets/sfx/Pistol.wav',
  rifle:       'assets/sfx/Rifle.wav',
  shotgun:     'assets/sfx/Shotgun.wav',
  hurt:        'assets/sfx/hurt.wav',
  pickup:      'assets/sfx/pickup.wav',
  gameover:    'assets/sfx/gameover.wav',
  enemyShot:   'assets/sfx/Pistol.wav',
  explosion:   'assets/sfx/Explosion.wav'
};
const SFX_VOL = {
  pistol: 0.55, rifle: 0.5, shotgun: 0.55,
  hurt: 0.65, pickup: 0.55, gameover: 0.7,
  enemyShot: 0.35,
  explosion: 0.75
};

// Options (persisted in localStorage)
function _loadNum(key, def) {
  const v = parseFloat(localStorage.getItem(key));
  return Number.isFinite(v) ? v : def;
}
let sfxEnabled = localStorage.getItem('itm_sfx') !== '0';
let musicEnabled = localStorage.getItem('itm_music') !== '0';
let sfxVolume = Math.min(1, Math.max(0, _loadNum('itm_sfx_vol', 0.7)));
let musicVolume = Math.min(1, Math.max(0, _loadNum('itm_music_vol', 0.5)));
let particlesEnabled = localStorage.getItem('itm_particles') !== '0';
let minimapEnabled = localStorage.getItem('itm_minimap') !== '0';
let showFps = localStorage.getItem('itm_fps') === '1';
let showSpeedrun = localStorage.getItem('itm_speedrun') !== '0';
let debugMode = localStorage.getItem('itm_debug') === '1';

// ── Web Audio backend ─────────────────────────────────────

// of re-decoding on every play() call via cloneNode()'d <audio> elements,
// which is what was causing the frame lag whenever SFX fired rapidly
// (e.g. minigun fire, multiple enemy shots per frame).
let _actx = null;
const _sfxBuffers = {}; // key -> AudioBuffer | null (null while loading/failed)
let _sfxGain = null;

function _getAudioCtx() {
  if (_actx) return _actx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  _actx = new AC();
  _sfxGain = _actx.createGain();
  _sfxGain.gain.value = sfxVolume;
  _sfxGain.connect(_actx.destination);
  return _actx;
}

// the first interaction so the very first shot isn't silent/late.
function _resumeAudioCtx() {
  const ctx = _getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
window.addEventListener('pointerdown', _resumeAudioCtx, { once: false });
window.addEventListener('keydown', _resumeAudioCtx, { once: false });

function loadSfx(key, path) {
  _sfxBuffers[key] = null;
  fetch(path)
    .then(r => r.arrayBuffer())
    .then(buf => {
      const ctx = _getAudioCtx();
      if (!ctx) return;
      // decodeAudioData callback-style avoids a Safari promise quirk
      ctx.decodeAudioData(buf,
        decoded => { _sfxBuffers[key] = decoded; },
        () => { _sfxBuffers[key] = null; }
      );
    })
    .catch(() => { _sfxBuffers[key] = null; });
}
for (const k in SFX_PATHS) loadSfx(k, SFX_PATHS[k]);

const _sfxLast = {};
let _sfxGlobalLast = 0;
const SFX_MIN_GAP = {
  pistol: 80, rifle: 70, shotgun: 110, explosion: 140,
  hurt: 90, pickup: 70, enemyShot: 100, gameover: 0
};
const SFX_GLOBAL_GAP = 40;

function playSfx(key) {
  if (!sfxEnabled || sfxVolume <= 0) return;
  const buffer = _sfxBuffers[key];
  if (!buffer) return; // not decoded yet (or failed) — skip rather than stall
  const now = performance.now();
  if (now - _sfxGlobalLast < SFX_GLOBAL_GAP) return;
  const minGap = SFX_MIN_GAP[key] != null ? SFX_MIN_GAP[key] : 60;
  if (minGap > 0 && _sfxLast[key] && now - _sfxLast[key] < minGap) return;
  _sfxLast[key] = now;
  _sfxGlobalLast = now;
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, Math.max(0, SFX_VOL[key] != null ? SFX_VOL[key] : 0.5));
    src.connect(gain);
    gain.connect(_sfxGain);
    src.start(0);
    // Let the node GC itself once playback ends; no pooling/cloning needed
    // since BufferSource nodes are cheap, one-shot, and share the decoded buffer.
    src.onended = () => { try { src.disconnect(); gain.disconnect(); } catch (e) {} };
  } catch (e) {}
}

function setSfxEnabled(on) {
  sfxEnabled = !!on;
  localStorage.setItem('itm_sfx', sfxEnabled ? '1' : '0');
}

// ── Music (looping tracks) ───────────────────────────────
const MUSIC_PATHS = {
  title: 'assets/music/MENU.mp3',
  game:  'assets/music/GAME.mp3',
  boss:  'assets/music/GAME.mp3'
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
  if (_sfxGain) _sfxGain.gain.value = sfxVolume;
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
function setShowSpeedrun(on) {
  showSpeedrun = !!on;
  localStorage.setItem('itm_speedrun', showSpeedrun ? '1' : '0');
}
function setDebugMode(on) {
  debugMode = !!on;
  localStorage.setItem('itm_debug', debugMode ? '1' : '0');
}
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function gunSfxKey(w) {
  if (!w) return 'pistol';
  if (w.sfx && SFX_PATHS[w.sfx]) return w.sfx;
  if ((w.pellets || 1) > 1) return 'shotgun';
  if (w.explosive) return 'explosion';
  if (w.id === 'pistol') return 'pistol';
  return 'rifle';
}
