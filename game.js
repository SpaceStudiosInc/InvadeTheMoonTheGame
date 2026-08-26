// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
const rooms = {};
let startKey, bossKey, curKey;
const player = {
  x: 400, y: 272, r: 14, speed: 4.8,
  hp: 6, maxHp: 6, invuln: 0, shootCooldown: 0,
  dx: 0, dy: -1, hasBossKey: false, ammo: STARTING_AMMO,
  hazardCD: 0
};
let unlockedWeapons = new Set(['pistol']);
let weaponIndex = 0; // pistol
let playerProjectiles = [];
let enemyProjectiles = [];
let particles = [];
let explosions = [];
let meleeSwing = null;
let pickups = [];
let gameOver = false;
let gunFrame = 0, gunAnimTimer = 0;
let started = false;
let paused = false;
let gameMode = 'dungeon';
const _roomCache = { key: null, canvas: null };
function invalidateRoomCache() { _roomCache.key = null; }

function startMission() {
  gameOver = false; paused = false; started = true;
  const m = (typeof MISSIONS !== 'undefined' && MISSIONS[currentMission]) ? MISSIONS[currentMission] : { mode: 'dungeon' };
  gameMode = m.mode || 'dungeon';
  const el = document.getElementById('msg');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  if (typeof applySkillsToPlayer === 'function') applySkillsToPlayer();
  else { player.maxHp = 6; player.speed = 4.8; }
  player.hp = player.maxHp;
  player.ammo = (typeof skillStartAmmo === 'function') ? skillStartAmmo() : STARTING_AMMO;
  player.hasBossKey = false; player.invuln = 0;
  unlockedWeapons = new Set(['pistol']); weaponIndex = 0;
  playerProjectiles.length = 0; enemyProjectiles.length = 0;
  particles.length = 0; explosions.length = 0;
  const miniEl = document.getElementById('minimap');
  if (gameMode === 'invaders') {
    if (typeof initInvaders === 'function') initInvaders();
    if (miniEl) miniEl.style.visibility = 'hidden';
  } else if (gameMode === 'openfield') {
    if (typeof initOpenField === 'function') initOpenField();
    if (miniEl) miniEl.style.visibility = 'hidden';
  } else {
    for (const k of Object.keys(rooms)) delete rooms[k];
    generateDungeon();
    invalidateRoomCache();
    updateRoomLabel();
    if (typeof setMinimapEnabled === 'function') setMinimapEnabled(minimapEnabled);
  }
  // music: boss track only when boss mission fight starts; otherwise game theme
  if (typeof playMusic === 'function') playMusic('game');
}

function currentWeapon() { return ARSENAL[weaponIndex]; }
function setWeapon(i) {
  const n = ARSENAL.length;
  const idx = ((i % n) + n) % n;
  if (!unlockedWeapons.has(ARSENAL[idx].id)) {
    flashToast(ARSENAL[idx].name + ' LOCKED');
    return;
  }
  weaponIndex = idx;
  document.getElementById('weaponLabel').textContent = currentWeapon().name;
}
function cycleWeapon(dir) {
  const n = ARSENAL.length;
  let idx = weaponIndex;
  for (let i = 0; i < n; i++) {
    idx = ((idx + dir) % n + n) % n;
    if (unlockedWeapons.has(ARSENAL[idx].id)) {
      weaponIndex = idx;
      document.getElementById('weaponLabel').textContent = currentWeapon().name;
      return;
    }
  }
}
setWeapon(0);

function key(x, y) { return x + ',' + y; }
function doorLocked(nk) { return nk === bossKey && !player.hasBossKey; }

function isHallType(room) {
  return room && (room.type === 'hallway' || room.type === 'bosshall');
}

/** Resolve hallway axis from room data / doors. */
function resolveHallAxis(room) {
  if (room.hallAxis) return room.hallAxis;
  const ds = Object.keys(room.doors || {});
  const hasV = ds.some(d => d === 'n' || d === 's');
  const hasH = ds.some(d => d === 'e' || d === 'w');
  if (hasV && hasH) return 'L';
  if (hasH) return 'h';
  return 'v';
}

/**
 * Walkable floor bounds for skinny door-to-door hallways.
 * Vertical: 1-tile wall each side of corridor.
 * Horizontal: 2-tile wall on top, 1-tile on bottom / sides.
 */
function getHallBounds(room) {
  const axis = resolveHallAxis(room);
  const half = HALL_THICKNESS / 2;

  if (axis === 'h') {
    // Horizontal corridor centered; top wall is 2 tiles, bottom 1 tile
    const structH = (HALL_WALL_TOP + HALL_TILES + HALL_WALL_BOTTOM) * TILE_SIZE;
    const topWall = H / 2 - structH / 2;
    const floorTop = topWall + HALL_WALL_TOP * TILE_SIZE;
    const floorBot = floorTop + HALL_THICKNESS;
    return {
      axis: 'h',
      left: WALL, right: W - WALL,
      top: floorTop, bottom: floorBot,
      // structure (including walls) for drawing
      structLeft: WALL, structRight: W - WALL,
      structTop: topWall, structBottom: topWall + structH,
      wallTop: HALL_WALL_TOP, wallBottom: HALL_WALL_BOTTOM, wallSide: HALL_WALL_SIDE
    };
  }
  if (axis === 'L') {
    const vHalf = HALL_THICKNESS / 2;
    const hStructH = (HALL_WALL_TOP + HALL_TILES + HALL_WALL_BOTTOM) * TILE_SIZE;
    const hTopWall = H / 2 - hStructH / 2;
    const hFloorTop = hTopWall + HALL_WALL_TOP * TILE_SIZE;
    const hFloorBot = hFloorTop + HALL_THICKNESS;
    return {
      axis: 'L',
      vLeft: W / 2 - vHalf, vRight: W / 2 + vHalf,
      hTop: hFloorTop, hBottom: hFloorBot,
      left: WALL, right: W - WALL, top: WALL, bottom: H - WALL,
      wallTop: HALL_WALL_TOP, wallBottom: HALL_WALL_BOTTOM, wallSide: HALL_WALL_SIDE
    };
  }
  // Vertical: 1-tile wall each side of corridor
  const structW = (HALL_WALL_SIDE + HALL_TILES + HALL_WALL_SIDE) * TILE_SIZE;
  const structLeft = W / 2 - structW / 2;
  const floorLeft = structLeft + HALL_WALL_SIDE * TILE_SIZE;
  const floorRight = floorLeft + HALL_THICKNESS;
  return {
    axis: 'v',
    left: floorLeft, right: floorRight,
    top: WALL, bottom: H - WALL,
    structLeft, structRight: structLeft + structW,
    structTop: WALL, structBottom: H - WALL,
    wallTop: HALL_WALL_SIDE, wallBottom: HALL_WALL_SIDE, wallSide: HALL_WALL_SIDE
  };
}

function inHallCorridor(x, y, room) {
  const b = getHallBounds(room);
  if (b.axis === 'v') return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  if (b.axis === 'h') return y >= b.top && y <= b.bottom && x >= b.left && x <= b.right;
  const inV = x >= b.vLeft && x <= b.vRight && y >= WALL && y <= H - WALL;
  const inH = y >= b.hTop && y <= b.hBottom && x >= WALL && x <= W - WALL;
  return inV || inH;
}

function hallSpawnPos(room) {
  const b = getHallBounds(room);
  if (b.axis === 'h') {
    return { x: WALL + 80 + Math.random() * (W - WALL * 2 - 160), y: (b.top + b.bottom) / 2 };
  }
  if (b.axis === 'L') {
    return { x: W / 2, y: H / 2 };
  }
  return { x: (b.left + b.right) / 2, y: WALL + 80 + Math.random() * (H - WALL * 2 - 160) };
}

/** Large column layouts (COLUMN_TILES x COLUMN_TILES) that break up room geometry. */
function generateColumns(roomType) {
  const s = TILE_SIZE * COLUMN_TILES; // 4x4 by default (2x previous size)
  const margin = WALL + 56;
  const layouts = [
    // single big center column
    () => [{ x: W / 2 - s / 2, y: H / 2 - s / 2, w: s, h: s }],
    // four near corners
    () => [
      { x: margin, y: margin, w: s, h: s },
      { x: W - margin - s, y: margin, w: s, h: s },
      { x: margin, y: H - margin - s, w: s, h: s },
      { x: W - margin - s, y: H - margin - s, w: s, h: s }
    ],
    // two offset pillars (diagonal)
    () => [
      { x: W * 0.30 - s / 2, y: H * 0.32 - s / 2, w: s, h: s },
      { x: W * 0.70 - s / 2, y: H * 0.68 - s / 2, w: s, h: s }
    ],
    // three: center-top + two bottom
    () => [
      { x: W / 2 - s / 2, y: margin + 10, w: s, h: s },
      { x: W * 0.26 - s / 2, y: H - margin - s - 6, w: s, h: s },
      { x: W * 0.74 - s / 2, y: H - margin - s - 6, w: s, h: s }
    ],
    // horizontal pair in middle band
    () => [
      { x: W * 0.28 - s / 2, y: H / 2 - s / 2, w: s, h: s },
      { x: W * 0.72 - s / 2, y: H / 2 - s / 2, w: s, h: s }
    ],
    // cross: center + four cardinal (boss chaos)
    () => [
      { x: W / 2 - s / 2, y: H / 2 - s / 2, w: s, h: s },
      { x: W / 2 - s / 2, y: margin + 16, w: s, h: s },
      { x: W / 2 - s / 2, y: H - margin - s - 16, w: s, h: s },
      { x: margin + 24, y: H / 2 - s / 2, w: s, h: s },
      { x: W - margin - s - 24, y: H / 2 - s / 2, w: s, h: s }
    ]
  ];
  let pool = layouts;
  if (roomType === 'boss') pool = layouts.slice(1);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return pick().map(c => ({
    x: Math.round(c.x / TILE_SIZE) * TILE_SIZE,
    y: Math.round(c.y / TILE_SIZE) * TILE_SIZE,
    w: c.w, h: c.h
  }));
}

/**
 * Build intentional kill-tile layouts from ROOM_LAYOUTS in config.js.
 * Returns an array of {x,y,w,h} hazard rects (tile-aligned). Non-blocking
 * hazards chip HP on contact; 'blocking' ones are impassable holes.
 * Door mouths are always kept clear so rooms stay traversable.
 */
function buildLayoutHazards(room, layout) {
  if (!layout || layout.kind === 'plain') return [];

  const hazards = [];
  const x0 = WALL, y0 = WALL, x1 = W - WALL, y1 = H - WALL;
  const cols = Math.floor((x1 - x0) / TILE_SIZE);
  const rows = Math.floor((y1 - y0) / TILE_SIZE);
  const cx = W / 2, cy = H / 2;

  const isDoorMouth = (tx, ty) => {
    const px = tx + TILE_SIZE / 2, py = ty + TILE_SIZE / 2;
    // Use full DOOR_W half-width + 1 tile padding so the player always fits
    const half = DOOR_W / 2 + TILE_SIZE;
    if (room.doors && room.doors.n && Math.abs(px - cx) < half && ty < y0 + TILE_SIZE * 4) return true;
    if (room.doors && room.doors.s && Math.abs(px - cx) < half && ty > y1 - TILE_SIZE * 4) return true;
    if (room.doors && room.doors.w && Math.abs(py - cy) < half && tx < x0 + TILE_SIZE * 4) return true;
    if (room.doors && room.doors.e && Math.abs(py - cy) < half && tx > x1 - TILE_SIZE * 4) return true;
    return false;
  };

  // Every non-plain layout tile is an impassable hole — blocks movement like
  // a wall, never damages the player. No tile in the game can hurt the player.
  const pushHole = (tx, ty) => {
    if (isDoorMouth(tx, ty)) return;
    hazards.push({ x: tx, y: ty, w: TILE_SIZE, h: TILE_SIZE, blocking: true });
  };

  // Safe corridors: full door width from wall to center (no narrow bridges)
  const corridorHalf = DOOR_W / 2 + TILE_SIZE * 1.5;
  const inDoorCorridor = (tx, ty) => {
    const px = tx + TILE_SIZE / 2, py = ty + TILE_SIZE / 2;
    if (room.doors && room.doors.n && Math.abs(px - cx) < corridorHalf && py <= cy + TILE_SIZE * 2) return true;
    if (room.doors && room.doors.s && Math.abs(px - cx) < corridorHalf && py >= cy - TILE_SIZE * 2) return true;
    if (room.doors && room.doors.w && Math.abs(py - cy) < corridorHalf && px <= cx + TILE_SIZE * 2) return true;
    if (room.doors && room.doors.e && Math.abs(py - cy) < corridorHalf && px >= cx - TILE_SIZE * 2) return true;
    return false;
  };

  const kind = layout.kind;

  if (kind === 'safe_circle') {
    // Solid disk + wide door spokes (no C-shaped bites into the pad)
    const R = (layout.radiusTiles || 13) * TILE_SIZE;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tx = x0 + col * TILE_SIZE;
        const ty = y0 + row * TILE_SIZE;
        const px = tx + TILE_SIZE / 2, py = ty + TILE_SIZE / 2;
        const d = Math.hypot(px - cx, py - cy);
        if (d <= R || inDoorCorridor(tx, ty)) continue;
        pushHole(tx, ty);
      }
    }
  } else if (kind === 'kill_border') {
    const b = layout.borderTiles || 3;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (col < b || row < b || col >= cols - b || row >= rows - b) {
          const tx = x0 + col * TILE_SIZE, ty = y0 + row * TILE_SIZE;
          if (!inDoorCorridor(tx, ty)) pushHole(tx, ty);
        }
      }
    }
  } else if (kind === 'cross') {
    const arm = layout.armTiles || 3;
    const midC = Math.floor(cols / 2), midR = Math.floor(rows / 2);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const inH = Math.abs(row - midR) < arm;
        const inV = Math.abs(col - midC) < arm;
        if (!inH && !inV) {
          const tx = x0 + col * TILE_SIZE, ty = y0 + row * TILE_SIZE;
          if (!inDoorCorridor(tx, ty)) pushHole(tx, ty);
        }
      }
    }
  } else if (kind === 'loop') {
    // Safe ring + door spokes to center; kill in the hole and outside the ring
    const path = layout.pathTiles || 3;
    const inner = (layout.innerRadiusTiles || 5) * TILE_SIZE;
    const outer = inner + path * TILE_SIZE;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tx = x0 + col * TILE_SIZE;
        const ty = y0 + row * TILE_SIZE;
        const d = Math.hypot(tx + TILE_SIZE / 2 - cx, ty + TILE_SIZE / 2 - cy);
        if ((d < inner || d > outer) && !inDoorCorridor(tx, ty)) pushHole(tx, ty);
      }
    }
  } else if (kind === 'islands') {
    // Default all kill, then punch safe pads + door corridors.
    // Each outer pad also gets a spoke bridge back to the center pad so
    // every island is actually walkable-to, not a stranded floating rock.
    const pads = [];
    const n = layout.count || 4;
    const padR = (layout.padTiles || 5) * TILE_SIZE;
    const spokeHalf = TILE_SIZE * 2.5; // wide bridges so pads stay connected
    pads.push({ x: cx, y: cy });
    for (let i = 1; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      pads.push({
        x: cx + Math.cos(a) * Math.min(W, H) * 0.28,
        y: cy + Math.sin(a) * Math.min(W, H) * 0.28
      });
    }
    const onSpoke = (px, py) => {
      for (let i = 1; i < pads.length; i++) {
        const p = pads[i];
        const dx = p.x - cx, dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const t = ((px - cx) * dx + (py - cy) * dy) / (len * len);
        if (t < 0 || t > 1) continue;
        const projX = cx + dx * t, projY = cy + dy * t;
        if (Math.hypot(px - projX, py - projY) < spokeHalf) return true;
      }
      return false;
    };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tx = x0 + col * TILE_SIZE;
        const ty = y0 + row * TILE_SIZE;
        const px = tx + TILE_SIZE / 2, py = ty + TILE_SIZE / 2;
        const safe = pads.some(p => Math.hypot(px - p.x, py - p.y) < padR) ||
          inDoorCorridor(tx, ty) || onSpoke(px, py);
        if (!safe) pushHole(tx, ty);
      }
    }
  } else if (kind === 'gauntlet') {
    // Kill tiles along the long edges of a hallway corridor
    if (!isHallType(room)) return hazards;
    const b = getHallBounds(room);
    const edge = layout.edgeTiles || 1;
    if (b.axis === 'v') {
      const leftEdge = b.left;
      const rightEdge = b.right - edge * TILE_SIZE;
      for (let y = b.top; y < b.bottom; y += TILE_SIZE) {
        for (let e = 0; e < edge; e++) {
          pushHole(Math.round((leftEdge + e * TILE_SIZE) / TILE_SIZE) * TILE_SIZE, Math.round(y / TILE_SIZE) * TILE_SIZE);
          pushHole(Math.round((rightEdge + e * TILE_SIZE) / TILE_SIZE) * TILE_SIZE, Math.round(y / TILE_SIZE) * TILE_SIZE);
        }
      }
    } else if (b.axis === 'h') {
      const topEdge = b.top;
      const botEdge = b.bottom - edge * TILE_SIZE;
      for (let x = b.left; x < b.right; x += TILE_SIZE) {
        for (let e = 0; e < edge; e++) {
          pushHole(Math.round(x / TILE_SIZE) * TILE_SIZE, Math.round((topEdge + e * TILE_SIZE) / TILE_SIZE) * TILE_SIZE);
          pushHole(Math.round(x / TILE_SIZE) * TILE_SIZE, Math.round((botEdge + e * TILE_SIZE) / TILE_SIZE) * TILE_SIZE);
        }
      }
    } else {
      // L: apply edge kills on both strips
      for (let y = WALL; y < H - WALL; y += TILE_SIZE) {
        for (let e = 0; e < edge; e++) {
          pushHole(Math.round((b.vLeft + e * TILE_SIZE) / TILE_SIZE) * TILE_SIZE, Math.round(y / TILE_SIZE) * TILE_SIZE);
          pushHole(Math.round((b.vRight - (e + 1) * TILE_SIZE) / TILE_SIZE) * TILE_SIZE, Math.round(y / TILE_SIZE) * TILE_SIZE);
        }
      }
      for (let x = WALL; x < W - WALL; x += TILE_SIZE) {
        for (let e = 0; e < edge; e++) {
          pushHole(Math.round(x / TILE_SIZE) * TILE_SIZE, Math.round((b.hTop + e * TILE_SIZE) / TILE_SIZE) * TILE_SIZE);
          pushHole(Math.round(x / TILE_SIZE) * TILE_SIZE, Math.round((b.hBottom - (e + 1) * TILE_SIZE) / TILE_SIZE) * TILE_SIZE);
        }
      }
    }
  }

  return hazards;
}

function pickLayoutForRoom(type) {
  const pool = LAYOUT_POOLS[type] || LAYOUT_POOLS.normal || ['plain'];
  const id = pool[Math.floor(Math.random() * pool.length)];
  const layout = ROOM_LAYOUTS[id] || ROOM_LAYOUTS.plain;
  return { id, layout };
}

function circleHitsColumn(cx, cy, cr, col) {
  // Clamp circle center to column AABB, then compare distance
  const nx = Math.max(col.x, Math.min(cx, col.x + col.w));
  const ny = Math.max(col.y, Math.min(cy, col.y + col.h));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < cr * cr;
}

function resolveColumnCollision(ent) {
  const room = rooms[curKey];
  if (!room || !room.columns) return;
  for (const col of room.columns) {
    if (!circleHitsColumn(ent.x, ent.y, ent.r, col)) continue;
    // Push out along the smallest penetration axis
    const nearestX = Math.max(col.x, Math.min(ent.x, col.x + col.w));
    const nearestY = Math.max(col.y, Math.min(ent.y, col.y + col.h));
    let dx = ent.x - nearestX;
    let dy = ent.y - nearestY;
    if (dx === 0 && dy === 0) {
      // Center inside: push toward nearest edge
      const left = ent.x - col.x;
      const right = col.x + col.w - ent.x;
      const top = ent.y - col.y;
      const bot = col.y + col.h - ent.y;
      const m = Math.min(left, right, top, bot);
      if (m === left) ent.x = col.x - ent.r;
      else if (m === right) ent.x = col.x + col.w + ent.r;
      else if (m === top) ent.y = col.y - ent.r;
      else ent.y = col.y + col.h + ent.r;
    } else {
      const dist = Math.hypot(dx, dy) || 1;
      const push = ent.r - dist + 0.5;
      ent.x += (dx / dist) * push;
      ent.y += (dy / dist) * push;
    }
  }
}

function resolveHazardBlockCollision(ent) {
  const room = rooms[curKey];
  if (!room || !room.hazards) return;
  for (const h of room.hazards) {
    if (!h.blocking) continue;
    if (!(ent.x + ent.r > h.x && ent.x - ent.r < h.x + h.w &&
          ent.y + ent.r > h.y && ent.y - ent.r < h.y + h.h)) continue;
    // Push out along the smallest penetration axis, same approach as columns
    const nearestX = Math.max(h.x, Math.min(ent.x, h.x + h.w));
    const nearestY = Math.max(h.y, Math.min(ent.y, h.y + h.h));
    let dx = ent.x - nearestX;
    let dy = ent.y - nearestY;
    if (dx === 0 && dy === 0) {
      const left = ent.x - h.x, right = h.x + h.w - ent.x;
      const top = ent.y - h.y, bot = h.y + h.h - ent.y;
      const m = Math.min(left, right, top, bot);
      if (m === left) ent.x = h.x - ent.r;
      else if (m === right) ent.x = h.x + h.w + ent.r;
      else if (m === top) ent.y = h.y - ent.r;
      else ent.y = h.y + h.h + ent.r;
    } else {
      const dist = Math.hypot(dx, dy) || 1;
      const push = ent.r - dist + 0.5;
      ent.x += (dx / dist) * push;
      ent.y += (dy / dist) * push;
    }
  }
}

/** Random free-ish point in a room that doesn't overlap columns / hazards / circle edge. */
function safeRoomPos(room, radius) {
  const cr = room.circleR || Math.min(W, H) / 2 - WALL - 8;
  for (let tries = 0; tries < 50; tries++) {
    const x = 120 + Math.random() * (W - 240);
    const y = 100 + Math.random() * (H - 200);
    let ok = true;
    for (const col of (room.columns || [])) {
      if (circleHitsColumn(x, y, radius + 4, col)) { ok = false; break; }
    }
    for (const h of (room.hazards || [])) {
      if (x + radius > h.x && x - radius < h.x + h.w && y + radius > h.y && y - radius < h.y + h.h) {
        ok = false; break;
      }
    }
    if (room.shape === 'circle' && Math.hypot(x - W / 2, y - H / 2) > cr - radius - 12) ok = false;
    // Keep clear of door zones
    if (Math.abs(x - W / 2) < DOOR_W && (y < WALL + 40 || y > H - WALL - 40)) ok = false;
    if (Math.abs(y - H / 2) < DOOR_W && (x < WALL + 40 || x > W - WALL - 40)) ok = false;
    if (ok) return { x, y };
  }
  return { x: W / 2, y: H / 2 + 60 };
}

function spawnBoss(room) {
  if (typeof playMusic === 'function') playMusic('boss');
  if (room.bossSpawned) return;
  room.bossSpawned = true;
  room.enemies.push({
    x: W / 2, y: H / 2 - 40, hp: BOSS_HP, maxHp: BOSS_HP, r: 42, speed: 1.1,
    type: 'boss', spriteBase: room.spriteBase || 'bossSkull', mode: 'chase', modeTimer: 90,
    shootTimer: 70, burstTimer: 200, dashTimer: 220, enraged: false, alive: true
  });
  // Nudge off columns if needed
  resolveColumnCollision(room.enemies[room.enemies.length - 1]);
  flashToast('BOSS AWAKENS');
  spawnParticles(W / 2, H / 2 - 40, '#c96b4f', 20);
}

function generateDungeon() {
  for (const k in rooms) delete rooms[k];
  const cx = Math.floor(GRID / 2), cy = Math.floor(GRID / 2);
  startKey = key(cx, cy);
  rooms[startKey] = { x: cx, y: cy, type: 'start', cleared: true, doors: {}, enemies: [], barrels: [], chests: [], keyItem: null, visited: true, pickups: [] };

  // Target a few more cells so intermediate hallways don't shrink the dungeon too much
  const roomCount = 12 + Math.floor(Math.random() * 4);
  const dirs = [[0, -1, 'n', 's'], [0, 1, 's', 'n'], [1, 0, 'e', 'w'], [-1, 0, 'w', 'e']];
  const placed = [[cx, cy]];
  const frontier = [[cx, cy]];

  while (placed.length < roomCount && frontier.length) {
    const idx = Math.floor(Math.random() * frontier.length);
    const [px, py] = frontier[idx];
    const shuffled = dirs.slice().sort(() => Math.random() - 0.5);
    let placedOne = false;
    for (const [dx, dy, d1, d2] of shuffled) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const nk = key(nx, ny);
      if (rooms[nk]) continue;

      // ~30%: insert an empty hallway between parent and the new content room
      // (two steps in the same direction when the far cell is free)
      const rx = nx + dx, ry = ny + dy;
      const canHall =
        Math.random() < 0.32 &&
        rx >= 0 && ry >= 0 && rx < GRID && ry < GRID &&
        !rooms[key(rx, ry)] &&
        placed.length + 1 < roomCount;

      if (canHall) {
        const hk = key(nx, ny);
        const rk = key(rx, ry);
        const axis = (d1 === 'n' || d1 === 's') ? 'v' : 'h';
        rooms[hk] = {
          x: nx, y: ny, type: 'hallway', cleared: true, doors: {},
          enemies: [], barrels: [], chests: [], keyItem: null, visited: false, pickups: [],
          hallAxis: axis
        };
        rooms[rk] = {
          x: rx, y: ry, type: 'normal', cleared: false, doors: {},
          enemies: [], barrels: [], chests: [], keyItem: null, visited: false, pickups: []
        };
        rooms[key(px, py)].doors[d1] = hk;
        rooms[hk].doors[d2] = key(px, py);
        rooms[hk].doors[d1] = rk;
        rooms[rk].doors[d2] = hk;
        placed.push([nx, ny], [rx, ry]);
        frontier.push([rx, ry]);
        placedOne = true;
        break;
      }

      rooms[nk] = {
        x: nx, y: ny, type: 'normal', cleared: false, doors: {},
        enemies: [], barrels: [], chests: [], keyItem: null, visited: false, pickups: []
      };
      rooms[key(px, py)].doors[d1] = nk;
      rooms[nk].doors[d2] = key(px, py);
      placed.push([nx, ny]);
      frontier.push([nx, ny]);
      placedOne = true;
      break;
    }
    if (!placedOne) frontier.splice(idx, 1);
  }

  const reachable = new Set();
  const q = [startKey];
  reachable.add(startKey);
  while (q.length) {
    const k = q.shift();
    for (const d in rooms[k].doors) {
      const nk = rooms[k].doors[d];
      if (!reachable.has(nk)) { reachable.add(nk); q.push(nk); }
    }
  }
  for (const k of Object.keys(rooms)) {
    if (!reachable.has(k)) delete rooms[k];
  }

  // --- boss + hallway antechamber ---
  // Farthest room becomes a short hallway; a new boss room is attached beyond it.
  // Door into the hallway looks like a boss door; door from hallway → boss requires the key.
  const dist = {}; dist[startKey] = 0;
  const qq = [startKey];
  while (qq.length) {
    const k = qq.shift();
    for (const d in rooms[k].doors) {
      const nk = rooms[k].doors[d];
      if (!(nk in dist)) { dist[nk] = dist[k] + 1; qq.push(nk); }
    }
  }
  let farthest = startKey, maxd = -1;
  for (const k in dist) if (dist[k] > maxd) { maxd = dist[k]; farthest = k; }

  const [fx, fy] = farthest.split(',').map(Number);
  const hallDirs = dirs.slice().sort(() => Math.random() - 0.5);
  let hallwayKey = farthest;
  bossKey = farthest;
  let placedHallway = false;
  for (const [dx, dy, d1, d2] of hallDirs) {
    const nx = fx + dx, ny = fy + dy;
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
    const nk = key(nx, ny);
    if (rooms[nk]) continue;
    // farthest becomes boss antechamber; new cell is the real boss room
    rooms[farthest].type = 'bosshall';
    rooms[farthest].cleared = true;
    rooms[farthest].enemies = [];
    rooms[farthest].barrels = [];
    rooms[farthest].chests = [];
    rooms[farthest].pickups = [];
    rooms[farthest].keyItem = null;
    // Straight corridor toward the boss only — L-shaped bosshalls looked broken
    // and misaligned doors. Extra side doors still work; player just walks the main strip.
    const towardBoss = (d1 === 'n' || d1 === 's') ? 'v' : 'h';
    rooms[farthest].hallAxis = towardBoss;
    rooms[nk] = {
      x: nx, y: ny, type: 'boss', cleared: false, doors: {},
      enemies: [], barrels: [], chests: [], keyItem: null, visited: false, pickups: []
    };
    rooms[farthest].doors[d1] = nk;
    rooms[nk].doors[d2] = farthest;
    bossKey = nk;
    hallwayKey = farthest;
    placedHallway = true;
    break;
  }
  if (!placedHallway) {
    // fallback: no free adjacent cell — classic single boss room
    rooms[bossKey].type = 'boss';
    hallwayKey = null;
  }

  const usedKeys = new Set([startKey, bossKey]);
  if (hallwayKey) usedKeys.add(hallwayKey);
  // Protect intermediate hallways from being converted into key/chest rooms
  for (const k in rooms) {
    if (rooms[k].type === 'hallway' || rooms[k].type === 'bosshall') usedKeys.add(k);
  }
  const deadEnds = Object.values(rooms).filter(r => {
    const k = key(r.x, r.y);
    return !usedKeys.has(k) && r.type === 'normal' && Object.keys(r.doors).length === 1;
  }).sort(() => Math.random() - 0.5);

  function claimRoom(type) {
    let room = deadEnds.find(r => !usedKeys.has(key(r.x, r.y)));
    if (!room) {
      const normals = Object.values(rooms).filter(r => r.type === 'normal' && !usedKeys.has(key(r.x, r.y)));
      room = normals[Math.floor(Math.random() * normals.length)];
    }
    if (room) {
      room.type = type;
      usedKeys.add(key(room.x, room.y));
    }
    return room;
  }
  claimRoom('key');
  claimRoom('chest');
  // At most one extra armory (still single chest each)
  if (Math.random() < 0.5) claimRoom('chest');

  for (const k in rooms) {
    const r = rooms[k];
    r.floorTile = 'floor' + (1 + Math.floor(Math.random() * 3));
    r.wallTile = 'wall' + (1 + Math.floor(Math.random() * 4));
    // --- authored layout (kill tiles, floor patterns) ---
    const picked = pickLayoutForRoom(r.type);
    r.layoutId = picked.id;
    r.layout = picked.layout;
    r.shape = 'rect';
    r.circleR = Math.min(W, H) / 2 - WALL - 8;
    // Visual circle wall only for safe_circle layouts (play space is still rectangular with kill rim)
    if (picked.layout.kind === 'safe_circle' || picked.layout.kind === 'loop') {
      r.shape = 'rect'; // collision uses hazards, not geometric circle clip
    }

    if (r.type === 'bosshall') {
      r.floorTile = 'floor3';
      r.cleared = true;
      r.enemies = [];
      r.barrels = [];
      r.chests = [];
      r.pickups = [];
      r.keyItem = null;
      r.columns = [];
      r.hazards = buildLayoutHazards(r, r.layout);
      continue;
    }
    if (r.type === 'hallway') {
      r.barrels = [];
      r.chests = [];
      r.pickups = [];
      r.keyItem = null;
      r.enemies = [];
      r.columns = [];
      r.hazards = buildLayoutHazards(r, r.layout);
      // Rarely a single enemy sitting in the corridor (on safe floor)
      if (Math.random() < HALL_ENEMY_CHANCE) {
        const isShooter = Math.random() < 0.4;
        const pos = hallSpawnPos(r);
        // Nudge off kill tiles
        if (!(r.hazards || []).some(h =>
          pos.x > h.x && pos.x < h.x + h.w && pos.y > h.y && pos.y < h.y + h.h)) {
          r.enemies.push({
            x: pos.x, y: pos.y,
            hp: isShooter ? 3 : 4, maxHp: isShooter ? 3 : 4, r: 16,
            speed: isShooter ? 0.55 : 1.4, type: isShooter ? 'shooter' : 'slime',
            cooldown: Math.random() * 60, alive: true
          });
        }
      }
      r.enemiesActive = r.enemies.length === 0;
      r.enemySpawnTimer = -1;
      r.cleared = r.enemies.length === 0;
      continue;
    }
    if (r.type === 'start') {
      r.cleared = true;
      r.hazards = [];
      r.columns = [];
      continue;
    }

    // --- columns (large pillars) — skip on heavy kill layouts so paths stay readable ---
    r.columns = [];
    const heavyKill = ['safe_circle', 'loop', 'islands', 'cross'].includes(picked.layout.kind);
    if (!heavyKill && (r.type === 'boss' || (r.type === 'normal' && Math.random() < 0.55) || (r.type === 'chest' && Math.random() < 0.4))) {
      r.columns = generateColumns(r.type);
    }

    // --- intentional kill-tile layout (not random scatter) ---
    r.hazards = buildLayoutHazards(r, r.layout);

    // --- enemies ---
    if (r.type === 'boss') {
      // Boss spawns after a short delay when the player enters (see enterDoor / update)
      r.bossSpawnTimer = -1; // not started yet
      r.bossSpawned = false;
      r.spriteBase = 'bossSkull'; // dedicated martian_boss art (see SPRITE_PATHS)
      r.cleared = false;
    } else {
      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const isShooter = Math.random() < 0.45;
        const pos = safeRoomPos(r, 16);
        r.enemies.push({
          x: pos.x, y: pos.y,
          hp: isShooter ? 3 : 4, maxHp: isShooter ? 3 : 4, r: 16,
          speed: isShooter ? 0.55 : 1.55, type: isShooter ? 'shooter' : 'slime',
          cooldown: Math.random() * 60, alive: true
        });
      }
      r.enemiesActive = r.enemies.length === 0;
      r.enemySpawnTimer = -1;
      r.cleared = r.enemies.length === 0;
    }

    // --- barrels ---
    if (r.type !== 'boss' && Math.random() < 0.6) {
      const bCount = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < bCount; i++) {
        const pos = safeRoomPos(r, 16);
        r.barrels.push({ x: pos.x, y: pos.y, r: 16, hp: 1, alive: true });
      }
    }

    // --- key ---
    if (r.type === 'key') {
      const pos = safeRoomPos(r, 14);
      r.keyItem = { x: pos.x, y: pos.y, r: 14, taken: false };
    }

    if (r.type === 'chest') {
      // Always a single chest per armory room
      const gun = weightedPick(CHEST_POOL);
      const pos = safeRoomPos(r, 22);
      r.chests = [{
        x: pos.x, y: pos.y,
        r: 22, open: false, weaponId: gun.id
      }];
    }

    if (r.type !== 'boss' && Math.random() < 0.55) {
      const kind = Math.random() < 0.45 ? 'health' : 'ammo';
      const pos = safeRoomPos(r, 12);
      r.pickups.push({
        x: pos.x, y: pos.y,
        r: 12, kind, taken: false
      });
    }
  }

  curKey = startKey;
  player.x = W / 2; player.y = H / 2;
  player.hp = player.maxHp;
  player.ammo = STARTING_AMMO;
  player.hasBossKey = false;
  unlockedWeapons = new Set(['pistol']);
  weaponIndex = 0;
  setWeapon(0);
}

// ════════════════════════════════════════
// INPUT
// ════════════════════════════════════════
const keys = {};
let DEBUG = false;
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') { e.preventDefault(); tryFire(); }
  if (e.key === '1') setWeapon(0);
  if (e.key === '`' || e.key === 'F3') { DEBUG = !DEBUG; flashToast(DEBUG ? 'DEBUG ON' : 'DEBUG OFF'); }
  if (e.key === 'Escape') { e.preventDefault(); togglePause(); }
});
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
let mouse = { x: W / 2, y: 0, down: false };
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});
canvas.addEventListener('mousedown', () => { mouse.down = true; tryFire(); });
canvas.addEventListener('mouseup', () => mouse.down = false);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cycleWeapon(e.deltaY > 0 ? 1 : -1);
}, { passive: false });
document.getElementById('msg').addEventListener('click', e => {
  if (e.target.tagName !== 'BUTTON') return;
  const t = (e.target.textContent || '').toUpperCase();
  if (t.includes('MENU')) location.reload();
  else if (t.includes('MISSION 2')) { currentMission = 2; startMission(); }
  else if (t.includes('MISSION 3') || t.includes('CONTINUE')) { currentMission = 3; startMission(); }
  else if (typeof startMission === 'function') startMission();
  else location.reload();
});

// ════════════════════════════════════════
// MENUS (title screen + pause)
// ════════════════════════════════════════
function togglePause() {
  if (!started || gameOver) return; // no pausing on the title screen or after death/victory
  paused = !paused;
  document.getElementById('pauseScreen').classList.toggle('show', paused);
}
document.getElementById('btnStart').addEventListener('click', () => {
  started = true;
  document.getElementById('titleScreen').classList.remove('show');
});
document.getElementById('btnResume').addEventListener('click', togglePause);
document.getElementById('btnRestart').addEventListener('click', () => location.reload());
document.getElementById('btnMainMenu').addEventListener('click', () => location.reload());

function tryFire() {
  if (gameOver || !started || paused || player.shootCooldown > 0) return;
  const w = currentWeapon();
  const dx = mouse.x - player.x, dy = mouse.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;

  const cdScale = (typeof skillCooldownScale === 'function') ? skillCooldownScale() : 1;
  const dmgMult = (typeof skillDamageMult === 'function') ? skillDamageMult() : 1;
  if (w.kind === 'melee') {
    player.shootCooldown = Math.max(4, Math.round(w.cooldown * cdScale));
    doMeleeAttack(w, nx, ny);
    return;
  }
  if (w.ammoCost > 0 && player.ammo < w.ammoCost) {
    flashToast('NO AMMO');
    return;
  }
  player.shootCooldown = Math.max(4, Math.round(w.cooldown * cdScale));
  if (w.ammoCost > 0) player.ammo -= w.ammoCost;
  gunAnimTimer = 8;
  gunFrame = 1;
  if (typeof playSfx === 'function') playSfx(gunSfxKey(w));

  const pellets = w.pellets || 1;
  const spread = w.spread || 0;
  const shotDmg = Math.max(1, Math.round(w.dmg * dmgMult));
  for (let i = 0; i < pellets; i++) {
    let ang = Math.atan2(ny, nx);
    if (pellets > 1) ang += (i - (pellets - 1) / 2) * (spread / pellets);
    const pdx = Math.cos(ang), pdy = Math.sin(ang);
    if (playerProjectiles.length >= (typeof MAX_PLAYER_PROJS !== 'undefined' ? MAX_PLAYER_PROJS : 28)) break;
    playerProjectiles.push({
      x: player.x + pdx * 18, y: player.y + pdy * 18,
      dx: pdx, dy: pdy, speed: w.speed, r: w.pr, life: 100,
      dmg: shotDmg, kind: w.explosive ? 'explosive' : 'ranged',
      color: w.color, pierce: !!w.pierce,
      splashR: w.splashR, splashDmg: w.splashDmg ? Math.round(w.splashDmg * dmgMult) : w.splashDmg
    });
  }
}

function doMeleeAttack(w, nx, ny) {
  const room = rooms[curKey];
  meleeSwing = { life: 14, maxLife: 14, ang: Math.atan2(ny, nx) };
  const facingAng = Math.atan2(ny, nx);
  const hitTarget = (ex, ey, er) => {
    const dx = ex - player.x, dy = ey - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > w.range + er) return false;
    let diff = Math.abs(Math.atan2(dy, dx) - facingAng);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    return diff < w.arc / 2;
  };
  room.enemies.forEach(en => {
    if (!en.alive) return;
    if (hitTarget(en.x, en.y, en.r)) {
      en.hp -= w.dmg;
      spawnParticles(en.x, en.y, '#d8dce8');
      if (en.hp <= 0) {
        en.alive = false;
        spawnParticles(en.x, en.y, '#8fe0c9', 14);
        grantKillAmmo(en);
        if (en.type === 'boss') triggerVictory();
      }
    }
  });
  room.barrels.forEach(b => {
    if (b.alive && hitTarget(b.x, b.y, b.r)) explodeBarrel(b);
  });
}

// ════════════════════════════════════════
// COLLISION / DOORS
// ════════════════════════════════════════
function checkWalls(ent) {
  const room = rooms[curKey];
  const enemyLocked = !room.cleared;
  const r = ent.r;
  const noteKeyLock = (dir) => {
    if (ent === player) {
      const doorTo = room.doors[dir];
      if (doorTo && !enemyLocked && doorLocked(doorTo)) maybeToastKeyLock();
    }
  };

  // Outer room bounds + door gaps
  if (ent.y - r < WALL) {
    const inGap = Math.abs(ent.x - W / 2) < DOOR_W / 2 && room.doors.n && !enemyLocked && !doorLocked(room.doors.n);
    if (!inGap) { ent.y = WALL + r; noteKeyLock('n'); }
    else if (ent === player && ent.y - r < 0) return 'n';
  }
  if (ent.y + r > H - WALL) {
    const inGap = Math.abs(ent.x - W / 2) < DOOR_W / 2 && room.doors.s && !enemyLocked && !doorLocked(room.doors.s);
    if (!inGap) { ent.y = H - WALL - r; noteKeyLock('s'); }
    else if (ent === player && ent.y + r > H) return 's';
  }
  if (ent.x - r < WALL) {
    const inGap = Math.abs(ent.y - H / 2) < DOOR_W / 2 && room.doors.w && !enemyLocked && !doorLocked(room.doors.w);
    if (!inGap) { ent.x = WALL + r; noteKeyLock('w'); }
    else if (ent === player && ent.x - r < 0) return 'w';
  }
  if (ent.x + r > W - WALL) {
    const inGap = Math.abs(ent.y - H / 2) < DOOR_W / 2 && room.doors.e && !enemyLocked && !doorLocked(room.doors.e);
    if (!inGap) { ent.x = W - WALL - r; noteKeyLock('e'); }
    else if (ent === player && ent.x + r > W) return 'e';
  }

  // Circular room boundary (leave door gaps at cardinal points)
  if (room.shape === 'circle' && !isHallType(room)) {
    const cr = (room.circleR || Math.min(W, H) / 2 - WALL - 8) - r;
    const dx = ent.x - W / 2, dy = ent.y - H / 2;
    const dist = Math.hypot(dx, dy);
    // Allow sliding out through door gaps
    const nearDoorN = room.doors.n && Math.abs(ent.x - W / 2) < DOOR_W / 2 && ent.y < H / 2;
    const nearDoorS = room.doors.s && Math.abs(ent.x - W / 2) < DOOR_W / 2 && ent.y > H / 2;
    const nearDoorW = room.doors.w && Math.abs(ent.y - H / 2) < DOOR_W / 2 && ent.x < W / 2;
    const nearDoorE = room.doors.e && Math.abs(ent.y - H / 2) < DOOR_W / 2 && ent.x > W / 2;
    const nearDoor = nearDoorN || nearDoorS || nearDoorW || nearDoorE;
    if (dist > cr && !nearDoor) {
      const nx = dx / (dist || 1), ny = dy / (dist || 1);
      ent.x = W / 2 + nx * cr;
      ent.y = H / 2 + ny * cr;
    }
  }

  // Skinny hallway corridor walls
  if (isHallType(room)) {
    const b = getHallBounds(room);
    if (b.axis === 'v') {
      if (ent.x - r < b.left) ent.x = b.left + r;
      if (ent.x + r > b.right) ent.x = b.right - r;
    } else if (b.axis === 'h') {
      if (ent.y - r < b.top) ent.y = b.top + r;
      if (ent.y + r > b.bottom) ent.y = b.bottom - r;
    } else if (b.axis === 'L') {
      // Allow movement only inside the plus-shaped corridor
      const inV = ent.x >= b.vLeft && ent.x <= b.vRight;
      const inH = ent.y >= b.hTop && ent.y <= b.hBottom;
      if (!inV && !inH) {
        // Push toward nearest strip
        const dxV = ent.x < b.vLeft ? b.vLeft - ent.x : ent.x - b.vRight;
        const dyH = ent.y < b.hTop ? b.hTop - ent.y : ent.y - b.hBottom;
        if (dxV < dyH) {
          ent.x = ent.x < b.vLeft ? b.vLeft + r : b.vRight - r;
        } else {
          ent.y = ent.y < b.hTop ? b.hTop + r : b.hBottom - r;
        }
      } else if (inV && !inH) {
        if (ent.x - r < b.vLeft) ent.x = b.vLeft + r;
        if (ent.x + r > b.vRight) ent.x = b.vRight - r;
      } else if (inH && !inV) {
        if (ent.y - r < b.hTop) ent.y = b.hTop + r;
        if (ent.y + r > b.hBottom) ent.y = b.hBottom - r;
      }
      // In the crossing: clamp to the plus outer edges only via the two strips
    }
  }

  // Solid columns + impassable hole tiles
  resolveColumnCollision(ent);
  resolveHazardBlockCollision(ent);
  return null;
}

function enterDoor(dir) {
  const room = rooms[curKey];
  const nk = room.doors[dir];
  if (!nk || doorLocked(nk)) return;
  rooms[curKey].visited = true;
  curKey = nk; invalidateRoomCache();
  rooms[curKey].visited = true;
  const dest = rooms[curKey];

  // Enter position: center on door; for hallways snap into corridor
  if (dir === 'n') { player.y = H - WALL - player.r - 4; player.x = W / 2; }
  if (dir === 's') { player.y = WALL + player.r + 4; player.x = W / 2; }
  if (dir === 'w') { player.x = W - WALL - player.r - 4; player.y = H / 2; }
  if (dir === 'e') { player.x = WALL + player.r + 4; player.y = H / 2; }
  if (isHallType(dest)) {
    const b = getHallBounds(dest);
    if (b.axis === 'v') player.x = (b.left + b.right) / 2;
    else if (b.axis === 'h') player.y = (b.top + b.bottom) / 2;
    else { player.x = W / 2; player.y = H / 2; }
  }
  resolveColumnCollision(player);
  resolveHazardBlockCollision(player);

  playerProjectiles = [];
  enemyProjectiles = [];
  if (dest.type === 'boss') {
    player.invuln = Math.max(player.invuln, 45);
    // Start boss spawn countdown (~1 second) the first time you enter
    if (!dest.bossSpawned && (dest.bossSpawnTimer === undefined || dest.bossSpawnTimer < 0)) {
      dest.bossSpawnTimer = BOSS_SPAWN_DELAY;
      flashToast('...');
    }
  } else if (dest.enemiesActive === false && dest.enemySpawnTimer < 0) {
    // Give regular room enemies a beat before they wake up
    dest.enemySpawnTimer = ENEMY_SPAWN_DELAY;
  }
  updateRoomLabel();
}

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
function grantKillAmmo(en) {
  const amt = 30;
  player.ammo += amt;
  flashToast('+' + amt + ' AMMO');
}
function spawnParticles(x, y, color, n = 6, kind) {
  if (typeof particlesEnabled !== 'undefined' && !particlesEnabled) return;
  const cap = typeof MAX_PARTICLES !== 'undefined' ? MAX_PARTICLES : 40;
  let sprite = null;
  if (kind === 'red' && typeof spriteReady === 'function' && spriteReady('particleRed')) sprite = 'particleRed';
  else if (kind === 'blue' && typeof spriteReady === 'function' && spriteReady('particleBlue')) sprite = 'particleBlue';
  for (let i = 0; i < n; i++) {
    if (particles.length >= cap) break;
    const spd = 2.5 + Math.random() * 5.5;
    const ang = Math.random() * Math.PI * 2;
    particles.push({
      x, y,
      dx: Math.cos(ang) * spd,
      dy: Math.sin(ang) * spd,
      life: 14 + Math.random() * 16,
      maxLife: 20,
      color: color || '#fff',
      sprite,
      size: 5 + Math.random() * 7
    });
  }
}
function explodeBarrel(b) {
  b.alive = false;
  explosions.push({ x: b.x, y: b.y, life: 22, maxLife: 22, maxR: 140 });
  spawnParticles(b.x, b.y, '#f4a05a', 36, 'red');
  if (typeof playSfx === 'function') playSfx('explosion');
  const room = rooms[curKey];
  room.enemies.forEach(en => {
    if (!en.alive) return;
    if (Math.hypot(en.x - b.x, en.y - b.y) < 150 + en.r) {
      en.hp -= 4;
      if (en.hp <= 0) {
        en.alive = false;
        spawnParticles(en.x, en.y, '#8fe0c9', 18);
        if (en.type === 'boss') triggerVictory();
      }
    }
  });
  if (Math.hypot(player.x - b.x, player.y - b.y) < 150 + player.r && player.invuln <= 0) {
    damagePlayer(2);
  }
}
function damagePlayer(n) {
  player.hp -= n;
  player.invuln = 55;
  spawnParticles(player.x, player.y, '#ff8f6b', 8);
  if (typeof playSfx === 'function') playSfx('hurt');
  if (player.hp <= 0 && !gameOver) {
    gameOver = true;
    if (typeof playSfx === 'function') playSfx('gameover');
    const el = document.getElementById('msg');
    el.style.display = 'flex';
    el.innerHTML = 'YOU DIED<button>RETRY</button><button>MAIN MENU</button>';
  }
}
function triggerVictory() {
  gameOver = true;
  if (typeof awardSkillPoints === 'function') awardSkillPoints(3, 'BOSS');
  const el = document.getElementById('msg');
  el.style.display = 'flex';
  el.innerHTML = 'Boss Defeated<button>PLAY AGAIN</button><button>MAIN MENU</button>';
}
let toastTimer = 0;
function flashToast(t) {
  const el = document.getElementById('toast');
  el.textContent = t;
  el.classList.add('show');
  toastTimer = 90;
}
function maybeToastKeyLock() {
  if (!player.hasBossKey) flashToast('BOSS KEY REQUIRED');
}
function updateRoomLabel() {
  const r = rooms[curKey];
  const labels = {
    start: 'START', boss: 'BOSS', key: 'KEY ROOM', chest: 'ARMORY',
    bosshall: 'BOSS HALL', hallway: 'HALLWAY', normal: 'CORRIDOR'
  };
  document.getElementById('roomLabel').textContent = labels[r.type] || 'CORRIDOR';
  const ks = document.getElementById('keyStatus');
  if (player.hasBossKey) ks.classList.add('have'); else ks.classList.remove('have');
}

// ════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════
function update() {
  if (gameOver || !started || paused) return;
  const room = rooms[curKey];

  // --- delayed boss spawn ---
  if (room.type === 'boss' && !room.bossSpawned && room.bossSpawnTimer >= 0) {
    room.bossSpawnTimer--;
    if (room.bossSpawnTimer <= 0) spawnBoss(room);
  }

  // --- movement ---
  let mx = 0, my = 0;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  if (mx || my) {
    const len = Math.hypot(mx, my);
    mx /= len; my /= len;
    player.x += mx * player.speed;
    player.y += my * player.speed;
  }
  const mdx = mouse.x - player.x, mdy = mouse.y - player.y;
  const mlen = Math.hypot(mdx, mdy) || 1;
  player.dx = mdx / mlen; player.dy = mdy / mlen;

  const door = checkWalls(player);
  if (door) enterDoor(door);

  if (mouse.down && currentWeapon().auto) tryFire();

  if (player.shootCooldown > 0) player.shootCooldown--;
  if (player.invuln > 0) player.invuln--;
  if (player.hazardCD > 0) player.hazardCD--;
  if (gunAnimTimer > 0) { gunAnimTimer--; if (gunAnimTimer === 0) gunFrame = 0; }
  if (toastTimer > 0) { toastTimer--; if (toastTimer === 0) document.getElementById('toast').classList.remove('show'); }
  if (meleeSwing) { meleeSwing.life--; if (meleeSwing.life <= 0) meleeSwing = null; }

  // --- hazard tiles ---
  // Every hazard tile is an impassable 'blocking' hole (see
  // resolveHazardBlockCollision) — none of them ever damage the player.

  // --- projectiles ---
  // Returns true to keep the projectile alive, false to remove it.
  // Entity hits run BEFORE wall kills so targets near/inside wall buffers remain shootable.
  const stepPlayerProjectile = p => {
    p.x += p.dx * p.speed; p.y += p.dy * p.speed; p.life--;
    if (p.life <= 0) return false;
    // enemies first
    for (const en of room.enemies) {
      if (!en.alive) continue;
      if (Math.hypot(p.x - en.x, p.y - en.y) < p.r + en.r) {
        en.hp -= p.dmg;
        spawnParticles(en.x, en.y, p.color);
        if (en.hp <= 0) {
          en.alive = false;
          spawnParticles(en.x, en.y, '#8fe0c9', 18);
          grantKillAmmo(en);
          if (en.type === 'boss') triggerVictory();
        }
        if (p.kind === 'explosive') {
          explosions.push({ x: p.x, y: p.y, life: 16, maxLife: 16, maxR: p.splashR || 70 });
          room.enemies.forEach(e2 => {
            if (!e2.alive) return;
            if (Math.hypot(e2.x - p.x, e2.y - p.y) < (p.splashR || 70) + e2.r) {
              e2.hp -= p.splashDmg || 3;
              if (e2.hp <= 0) { e2.alive = false; grantKillAmmo(e2); if (e2.type === 'boss') triggerVictory(); }
            }
          });
        }
        return !!p.pierce;
      }
    }
    // barrels
    for (const b of room.barrels) {
      if (!b.alive) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < p.r + b.r) {
        explodeBarrel(b);
        return false;
      }
    }
    // walls (including skinny hallway corridor sides) — after entity hits
    if (p.x < WALL || p.x > W - WALL || p.y < WALL || p.y > H - WALL) return false;
    if (isHallType(room) && !inHallCorridor(p.x, p.y, room)) return false;
    if (room.shape === 'circle') {
      const cr = room.circleR || Math.min(W, H) / 2 - WALL - 8;
      if (Math.hypot(p.x - W / 2, p.y - H / 2) > cr) return false;
    }
    if ((room.columns || []).some(col => circleHitsColumn(p.x, p.y, p.r, col))) return false;
    return true;
  };
  for (let i = playerProjectiles.length - 1; i >= 0; i--) {
    if (!stepPlayerProjectile(playerProjectiles[i])) playerProjectiles.splice(i, 1);
  }

  // --- enemy AI ---
  // Enemies steer around kill tiles but are not damaged by them.
  const pointOnHazard = (x, y, r) => {
    for (const h of (room.hazards || [])) {
      if (x + r > h.x && x - r < h.x + h.w && y + r > h.y && y - r < h.y + h.h) return true;
    }
    return false;
  };
  const moveEnemyAvoidHazards = (en, mx, my) => {
    const nx = en.x + mx, ny = en.y + my;
    if (!pointOnHazard(nx, ny, en.r)) {
      en.x = nx; en.y = ny;
    } else if (!pointOnHazard(nx, en.y, en.r)) {
      en.x = nx;
    } else if (!pointOnHazard(en.x, ny, en.r)) {
      en.y = ny;
    } else {
      // Slide perpendicular to try to get around the hazard
      const len = Math.hypot(mx, my) || 1;
      const px = -my / len * en.speed, py = mx / len * en.speed;
      if (!pointOnHazard(en.x + px, en.y + py, en.r)) {
        en.x += px; en.y += py;
      } else if (!pointOnHazard(en.x - px, en.y - py, en.r)) {
        en.x -= px; en.y -= py;
      }
    }
    // If somehow stuck on a hazard (spawn overlap), gently push toward room center
    if (pointOnHazard(en.x, en.y, en.r)) {
      const cx = W / 2 - en.x, cy = H / 2 - en.y;
      const cl = Math.hypot(cx, cy) || 1;
      const sx = en.x + (cx / cl) * en.speed;
      const sy = en.y + (cy / cl) * en.speed;
      if (!pointOnHazard(sx, sy, en.r)) { en.x = sx; en.y = sy; }
    }
  };

  room.enemies.forEach(en => {
    if (!en.alive) return;
    const dx = player.x - en.x, dy = player.y - en.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (en.type === 'slime' || (en.type === 'boss' && en.mode === 'chase')) {
      moveEnemyAvoidHazards(en, (dx / dist) * en.speed, (dy / dist) * en.speed);
      checkWalls(en);
    }
    if (en.type === 'shooter' || en.type === 'boss') {
      en.cooldown = (en.cooldown || 0) - 1;
      if (en.cooldown <= 0 && dist < 320) {
        en.cooldown = en.type === 'boss' ? 40 : 55;
        enemyProjectiles.push({
          x: en.x, y: en.y, dx: dx / dist, dy: dy / dist,
          speed: en.type === 'boss' ? 4.5 : 3.5, r: 5, life: 90
        });
        if (typeof playSfx === 'function') playSfx('enemyShot');
      }
    }
    if (en.type === 'boss') {
      en.modeTimer = (en.modeTimer || 0) - 1;
      if (en.modeTimer <= 0) {
        en.mode = en.mode === 'chase' ? 'shoot' : 'chase';
        en.modeTimer = 120 + Math.random() * 80;
      }
      if (en.hp < en.maxHp * 0.4) en.enraged = true;
      if (en.enraged) en.speed = 1.55;
    }
    if (dist < en.r + player.r && player.invuln <= 0) damagePlayer(1);
  });

  // Don't mark boss room clear until the boss has actually spawned and been killed
  const bossPending = room.type === 'boss' && !room.bossSpawned;
  if (!room.cleared && !bossPending && room.enemies.length > 0 && room.enemies.every(e => !e.alive)) {
    room.cleared = true;
    flashToast('ROOM CLEAR');
  }

  // --- enemy projectiles ---
  const stepEnemyProjectile = p => {
    p.x += p.dx * p.speed; p.y += p.dy * p.speed; p.life--;
    if (p.life <= 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) return false;
    if (isHallType(room) && !inHallCorridor(p.x, p.y, room)) return false;
    if ((room.columns || []).some(col => circleHitsColumn(p.x, p.y, p.r, col))) return false;
    if (Math.hypot(p.x - player.x, p.y - player.y) < p.r + player.r && player.invuln <= 0) {
      damagePlayer(1);
      return false;
    }
    return true;
  };
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    if (!stepEnemyProjectile(enemyProjectiles[i])) enemyProjectiles.splice(i, 1);
  }

  // --- pickups ---
  (room.pickups || []).forEach(pk => {
    if (pk.taken) return;
    if (Math.hypot(player.x - pk.x, player.y - pk.y) < player.r + pk.r) {
      pk.taken = true;
      if (typeof playSfx === 'function') playSfx('pickup');
      if (pk.kind === 'health') {
        player.hp = Math.min(player.maxHp, player.hp + HEALTH_PICKUP_HEAL);
        flashToast('+' + HEALTH_PICKUP_HEAL + ' HP');
      } else {
        const amt = AMMO_PICKUP_AMOUNT;
        player.ammo += amt;
        flashToast('+' + amt + ' AMMO');
      }
    }
  });

  // --- key ---
  if (room.keyItem && !room.keyItem.taken) {
    const k = room.keyItem;
    if (Math.hypot(player.x - k.x, player.y - k.y) < player.r + k.r) {
      k.taken = true;
      player.hasBossKey = true;
      if (typeof playSfx === 'function') playSfx('pickup');
      flashToast('BOSS KEY ACQUIRED');
      updateRoomLabel();
    }
  }

  // --- chests ---
  (room.chests || []).forEach(c => {
    if (c.open) return;
    if (Math.hypot(player.x - c.x, player.y - c.y) < player.r + c.r) {
      c.open = true;
      unlockedWeapons.add(c.weaponId);
      const g = ARSENAL_MAP[c.weaponId];
      if (typeof playSfx === 'function') playSfx('pickup');
      flashToast('GOT ' + g.name);
      
      weaponIndex = ARSENAL.findIndex(w => w.id === c.weaponId);
      setWeapon(weaponIndex);
    }
  });

  // --- particles ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.dx; pt.y += pt.dy; pt.life--;
    if (pt.life <= 0) particles.splice(i, 1);
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].life--;
    if (explosions[i].life <= 0) explosions.splice(i, 1);
  }
}

// ════════════════════════════════════════
// DRAW
// ════════════════════════════════════════
function drawTile(name, x, y, w, h) {
  const img = SPRITES[name];
  if (img && img.ok) {
    for (let ty = y; ty < y + h; ty += TILE_SIZE) {
      for (let tx = x; tx < x + w; tx += TILE_SIZE) {
        ctx.drawImage(img, tx, ty);
      }
    }
    return true;
  }
  return false;
}


function _paintStaticRoom(c, room) {
  const floorName = room.floorTile || 'floor1';
  const wallName = room.wallTile || 'wall1';
  const hall = isHallType(room);
  const dF = (x, y) => {
    const img = SPRITES[floorName];
    if (room.type === 'bosshall' && spriteReady('bosstile')) {
      const tx = ((x - WALL) / TILE_SIZE) | 0, ty = ((y - WALL) / TILE_SIZE) | 0;
      if ((tx + ty) % 2 === 0) { c.drawImage(SPRITES.bosstile, x, y); return; }
    }
    if (img && img.ok) c.drawImage(img, x, y);
    else { c.fillStyle = '#232833'; c.fillRect(x, y, TILE_SIZE, TILE_SIZE); }
  };
  const dW = (x, y) => {
    const img = SPRITES[wallName];
    if (img && img.ok) c.drawImage(img, x, y);
    else { c.fillStyle = '#3a4258'; c.fillRect(x, y, TILE_SIZE, TILE_SIZE); }
  };
  if (hall) {
    c.fillStyle = '#080a10'; c.fillRect(0, 0, W, H);
    const b = getHallBounds(room);
    const paint = (fL, fR, fT, fB, wS, wTop, wBot) => {
      const sL = fL - wS * TILE_SIZE, sR = fR + wS * TILE_SIZE;
      const sT = fT - wTop * TILE_SIZE, sB = fB + wBot * TILE_SIZE;
      for (let y = Math.max(0, sT); y < Math.min(H, sB); y += TILE_SIZE)
        for (let x = Math.max(0, sL); x < Math.min(W, sR); x += TILE_SIZE) {
          if (x >= fL && x < fR && y >= fT && y < fB) dF(x, y); else dW(x, y);
        }
    };
    if (b.axis === 'v') paint(b.left, b.right, 0, H, HALL_WALL_SIDE, 0, 0);
    else if (b.axis === 'h') paint(0, W, b.top, b.bottom, 0, HALL_WALL_TOP, HALL_WALL_BOTTOM);
    else { paint(b.vLeft, b.vRight, 0, H, HALL_WALL_SIDE, 0, 0); paint(0, W, b.hTop, b.hBottom, 0, HALL_WALL_TOP, HALL_WALL_BOTTOM); }
  } else if (room.shape === 'circle') {
    c.fillStyle = '#080a10'; c.fillRect(0, 0, W, H);
    const cr = room.circleR || Math.min(W, H) / 2 - WALL - 8;
    c.save(); c.beginPath(); c.arc(W/2, H/2, cr, 0, Math.PI*2); c.clip();
    for (let y = WALL; y < H - WALL; y += TILE_SIZE)
      for (let x = WALL; x < W - WALL; x += TILE_SIZE) dF(x, y);
    c.restore();
  } else {
    for (let y = WALL; y < H - WALL; y += TILE_SIZE)
      for (let x = WALL; x < W - WALL; x += TILE_SIZE) dF(x, y);
    for (let x = 0; x < W; x += TILE_SIZE) { dW(x, 0); dW(x, H - TILE_SIZE); }
    for (let y = TILE_SIZE; y < H - TILE_SIZE; y += TILE_SIZE) { dW(0, y); dW(W - TILE_SIZE, y); }
  }
  for (const h of (room.hazards || [])) {
    c.fillStyle = '#000'; c.fillRect(h.x, h.y, h.w, h.h);
  }
  for (const col of (room.columns || [])) {
    c.fillStyle = '#4a5568'; c.fillRect(col.x, col.y, col.w || 64, col.h || 64);
  }
}


function drawBossTileRect(x, y, w, h) {
  if (!spriteReady('bosstile')) return false;
  for (let ty = y; ty < y + h; ty += TILE_SIZE) {
    for (let tx = x; tx < x + w; tx += TILE_SIZE) {
      ctx.drawImage(SPRITES.bosstile, tx, ty, TILE_SIZE, TILE_SIZE);
    }
  }
  return true;
}
function drawRoom() {
  const room = rooms[curKey];
  // Cache static floor/walls — only rebuild when room changes
  if (_roomCache.key === curKey && _roomCache.canvas) {
    ctx.drawImage(_roomCache.canvas, 0, 0);
  } else {
    if (!_roomCache.canvas) {
      _roomCache.canvas = document.createElement('canvas');
      _roomCache.canvas.width = W;
      _roomCache.canvas.height = H;
    }
    const bctx = _roomCache.canvas.getContext('2d');
    bctx.imageSmoothingEnabled = false;
    // Snapshot by drawing to main canvas then copy is wrong if entities exist.
    // Instead: paint static into bctx via temporary context swap.
    const _saved = ctx;
    // Use a proxy: call internal painter that takes target
    _paintStaticRoom(bctx, room);
    _roomCache.key = curKey;
    ctx.drawImage(_roomCache.canvas, 0, 0);
  }
  // Dynamic overlays continue below (doors etc. redrawn each frame)
  _drawRoomDynamicStart(room);
}
function _drawRoomDynamicStart(room) {
  const floorName = room.floorTile || 'floor1';
  const wallName = room.wallTile || 'wall1';
  const hall = isHallType(room);
  // static floor/walls/hazards/columns come from cache
    // --- doors ---
  // doorClosed (solid black) shows for locked/uncleared doors, doorOpen
  // (solid white) shows otherwise. The boss door is the one exception — it
  // renders with the bosstile.png sprite plus a LOCKED label (below) so it
  // always reads as distinct from a normal door.
  const drawDoor = (dir, doorTo) => {
    if (!doorTo) return;
    const locked = doorLocked(doorTo);
    const enemyLocked = !room.cleared;
    const dest = rooms[doorTo];
    const isBossEntrance = doorTo === bossKey || (dest && dest.type === 'bosshall');
    const tileName = (locked || enemyLocked) ? 'doorClosed' : 'doorOpen';
    const paint = () => {
      ctx.fillStyle = locked || enemyLocked ? '#000000' : '#ffffff';
    };
    let dx = 0, dy = 0, dw = 0, dh = 0;
    // Snap to the 16px tile grid so the door tile always lines up with the
    // surrounding wall/floor tiles, even if DOOR_W or the canvas size changes.
    const snap = v => Math.round(v / TILE_SIZE) * TILE_SIZE;
    if (dir === 'n') { dx = snap(W / 2 - DOOR_W / 2); dy = 0; dw = DOOR_W; dh = WALL; }
    if (dir === 's') { dx = snap(W / 2 - DOOR_W / 2); dy = H - WALL; dw = DOOR_W; dh = WALL; }
    if (dir === 'w') { dx = 0; dy = snap(H / 2 - DOOR_W / 2); dw = WALL; dh = DOOR_W; }
    if (dir === 'e') { dx = W - WALL; dy = snap(H / 2 - DOOR_W / 2); dw = WALL; dh = DOOR_W; }

    if (isBossEntrance) {
      if (!drawBossTileRect(dx, dy, dw, dh)) { paint(); ctx.fillRect(dx, dy, dw, dh); }
    } else if (!drawTile(tileName, dx, dy, dw, dh)) {
      paint(); ctx.fillRect(dx, dy, dw, dh);
    }

    if (locked) {
      ctx.fillStyle = '#d8b34a';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      if (dir === 'n') ctx.fillText('LOCKED', W / 2, 15);
      if (dir === 's') ctx.fillText('LOCKED', W / 2, H - 8);
      if (dir === 'w') ctx.fillText('LOCKED', 12, H / 2);
      if (dir === 'e') ctx.fillText('LOCKED', W - 12, H / 2);
    }
  };
  for (const d of ['n', 's', 'e', 'w']) drawDoor(d, room.doors[d]);

  // --- barrels ---
  room.barrels.forEach(b => {
    if (!b.alive) return;
    if (spriteReady('barrel')) drawSpriteFit(SPRITES.barrel, b.x, b.y, 32);
    else {
      ctx.fillStyle = '#c96b4f';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
  });

  // --- key ---
  if (room.keyItem && !room.keyItem.taken) {
    const k = room.keyItem;
    if (spriteReady('key')) drawSpriteFit(SPRITES.key, k.x, k.y, k.r * 2.4);
    else {
      ctx.fillStyle = '#d8b34a';
      ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // --- chests ---
  (room.chests || []).forEach(c => {
    if (spriteReady('chest')) {
      const img = SPRITES.chest;
      const fw = img.width / 2, fh = img.height;
      const frame = c.open ? 1 : 0;
      const scale = 40 / fh;
      const dw = fw * scale, dh = fh * scale;
      ctx.drawImage(img, frame * fw, 0, fw, fh, c.x - dw / 2, c.y - dh / 2, dw, dh);
    } else {
      ctx.fillStyle = c.open ? '#3a4a3a' : '#8b6914';
      ctx.fillRect(c.x - 18, c.y - 14, 36, 28);
    }
  });

  // --- pickups ---
  (room.pickups || []).forEach(pk => {
    if (pk.taken) return;
    if (pk.kind === 'health') {
      if (spriteReady('health')) drawSpriteFit(SPRITES.health, pk.x, pk.y, 28);
      else {
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath(); ctx.arc(pk.x, pk.y, pk.r, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      if (spriteReady('ammo')) drawSpriteFit(SPRITES.ammo, pk.x, pk.y, 28);
      else {
        ctx.fillStyle = '#f4c430';
        ctx.beginPath(); ctx.arc(pk.x, pk.y, pk.r, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
}

function drawEntities() {
  const room = rooms[curKey];

  room.enemies.forEach(en => {
    if (!en.alive) return;
    const spriteKey = en.type === 'boss' ? en.spriteBase : en.type;
    if (spriteReady(spriteKey)) drawSpriteFit(SPRITES[spriteKey], en.x, en.y, en.r * 2.3);
    else {
      ctx.fillStyle = en.type === 'boss' ? '#c96b4f' : (en.type === 'shooter' ? '#7fb0d8' : '#8fd8b0');
      ctx.beginPath(); ctx.arc(en.x, en.y, en.r, 0, Math.PI * 2); ctx.fill();
    }
    // --- enemy hp bar ---
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(en.x - en.r, en.y - en.r - 10, en.r * 2, 4);
    ctx.fillStyle = '#8fe0c9';
    ctx.fillRect(en.x - en.r, en.y - en.r - 10, en.r * 2 * (en.hp / en.maxHp), 4);
    if (en.type === 'boss') {
      ctx.fillStyle = '#ff8f6b';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('MARTIAN OVERLORD', en.x, en.y - en.r - 16);
    }
  });

  // --- projectiles ---
  // Sprite is vertical (top = nose). Rotate so top points in travel direction.
  playerProjectiles.forEach(p => {
    const size = Math.max(42, p.r * 12); // 1.5x larger
    if (!drawProjectileFast(p.x, p.y, p.dx, p.dy, size)) {
      ctx.fillStyle = p.color || '#eef2f8';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  });
  enemyProjectiles.forEach(p => {
    const size = Math.max(33, p.r * 9); // 1.5x larger
    if (!drawProjectileFast(p.x, p.y, p.dx, p.dy, size, 0.85)) {
      ctx.fillStyle = '#ff8f6b';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  });

  particles.forEach(pt => {
    const a = Math.max(0, pt.life / (pt.maxLife || 20));
    ctx.globalAlpha = a;
    const sz = pt.size || 6;
    if (pt.sprite && typeof spriteReady === 'function' && spriteReady(pt.sprite)) {
      const img = SPRITES[pt.sprite];
      ctx.drawImage(img, pt.x - sz, pt.y - sz, sz * 2, sz * 2);
    } else {
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  });
  explosions.forEach(ex => {
    const t = 1 - ex.life / ex.maxLife;
    const r = ex.maxR * t;
    ctx.globalAlpha = (ex.life / ex.maxLife) * 0.55;
    ctx.fillStyle = '#f4a05a';
    ctx.beginPath(); ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  });

  // --- melee ---
  if (meleeSwing) {
    const w = WRENCH;
    const t = meleeSwing.life / meleeSwing.maxLife;
    ctx.strokeStyle = `rgba(159,216,255,${t})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(player.x, player.y, w.range, meleeSwing.ang - w.arc / 2, meleeSwing.ang + w.arc / 2);
    ctx.stroke();
  }

  // --- player ---
  ctx.save();
  if (player.invuln > 0 && Math.floor(player.invuln / 4) % 2 === 0) ctx.globalAlpha = 0.4;
  if (spriteReady('player')) {
    drawSpriteFit(SPRITES.player, player.x, player.y, player.r * 2.6);
  } else {
    ctx.fillStyle = '#eef2f8';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  const ang = Math.atan2(mouse.y - player.y, mouse.x - player.x);
  const flip = mouse.x < player.x;
  const wpn = currentWeapon();
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(ang);
  if (wpn.kind === 'melee') {
    ctx.strokeStyle = wpn.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(28, 0);
    ctx.stroke();
    ctx.fillStyle = wpn.color;
    ctx.fillRect(24, -5, 10, 10);
  } else {
    const drawn = drawGunFrame(wpn.id, gunFrame, 4, 0, 28, flip);
    if (!drawn) {
      ctx.fillStyle = wpn.color || '#ccc';
      ctx.fillRect(8, -4, 22, 8);
    }
  }
  ctx.restore();
}

function drawHearts() {
  const heartsRow = document.getElementById('heartsRow');
  if (heartsRow) {
    const full = (SPRITES.heart && SPRITES.heart.ok) ? SPRITES.heart.src
               : ((SPRITES.health && SPRITES.health.ok) ? SPRITES.health.src : '');
    const empty = (SPRITES.emptyHeart && SPRITES.emptyHeart.ok) ? SPRITES.emptyHeart.src : full;
    let html = '';
    for (let i = 0; i < player.maxHp; i++) {
      const src = i < player.hp ? full : empty;
      if (src) html += '<img src="' + src + '" alt="">';
      else html += i < player.hp ? '♥' : '♡';
    }
    if (heartsRow.dataset.sig !== html) {
      heartsRow.innerHTML = html;
      heartsRow.dataset.sig = html;
    }
  }

  const ammo = document.getElementById('ammoVal');
  if (ammo) ammo.textContent = player.ammo;

  const iconsEl = document.getElementById('ammoIcons');
  if (iconsEl) {
    const perIcon = Math.max(1, Math.ceil(AMMO_ICON_REF / AMMO_ICON_MAX));
    const filled = Math.min(AMMO_ICON_MAX, Math.ceil(player.ammo / perIcon));
    const src = (SPRITES.ammobullet && SPRITES.ammobullet.ok) ? SPRITES.ammobullet.src
              : ((SPRITES.ammo && SPRITES.ammo.ok) ? SPRITES.ammo.src : '');
    let html = '';
    for (let i = 0; i < AMMO_ICON_MAX; i++) {
      const cls = i < filled ? '' : ' class="empty"';
      if (src) html += '<img src="' + src + '"' + cls + ' alt="">';
      else html += i < filled ? '▪' : '▫';
    }
    if (iconsEl.dataset.sig !== String(filled) + src) {
      iconsEl.innerHTML = html;
      iconsEl.dataset.sig = String(filled) + src;
    }
  }

  const w = currentWeapon();
  const rl = document.getElementById('rarityLabel');
  if (rl) {
    if (w.rarity && RARITY[w.rarity]) {
      rl.textContent = RARITY[w.rarity].label;
      rl.style.color = RARITY[w.rarity].color;
    } else {
      rl.textContent = w.kind === 'melee' ? 'MELEE' : 'STARTER';
      rl.style.color = '#7d859c';
    }
  }
}

function drawMinimap() {
  if (typeof minimapEnabled !== 'undefined' && !minimapEnabled) return;
  mctx.fillStyle = '#0c0e15';
  mctx.fillRect(0, 0, 110, 110);
  const cell = 110 / GRID;
  for (const k in rooms) {
    const r = rooms[k];
    if (!r.visited) continue;
    let color = '#5a6178';
    if (r.type === 'boss') color = '#c96b4f';
    else if (r.type === 'bosshall') color = '#6b3a4a';
    else if (r.type === 'hallway') color = '#3a4258';
    else if (r.type === 'key') color = '#d8b34a';
    else if (r.type === 'chest') color = '#9fd8ff';
    mctx.fillStyle = k === curKey ? '#8fe0c9' : color;
    mctx.fillRect(r.x * cell + 2, r.y * cell + 2, cell - 4, cell - 4);
  }
}

function drawDebug() {
  if (!DEBUG) return;
  const room = rooms[curKey];
  
  ctx.strokeStyle = 'rgba(0,255,128,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.stroke();
  room.enemies.forEach(en => {
    if (!en.alive) return;
    ctx.strokeStyle = 'rgba(255,80,80,0.7)';
    ctx.beginPath(); ctx.arc(en.x, en.y, en.r, 0, Math.PI * 2); ctx.stroke();
  });
  room.barrels.forEach(b => {
    if (!b.alive) return;
    ctx.strokeStyle = 'rgba(255,160,40,0.8)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
  });
  (room.chests || []).forEach(c => {
    ctx.strokeStyle = 'rgba(255,220,80,0.6)';
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke();
  });
  (room.pickups || []).forEach(pk => {
    if (pk.taken) return;
    ctx.strokeStyle = 'rgba(100,200,255,0.7)';
    ctx.beginPath(); ctx.arc(pk.x, pk.y, pk.r, 0, Math.PI * 2); ctx.stroke();
  });
  
  ctx.strokeStyle = 'rgba(120,180,255,0.5)';
  for (const d of ['n','s','e','w']) {
    if (!room.doors[d]) continue;
    if (d === 'n') ctx.strokeRect(W/2 - DOOR_W/2, 0, DOOR_W, WALL);
    if (d === 's') ctx.strokeRect(W/2 - DOOR_W/2, H - WALL, DOOR_W, WALL);
    if (d === 'w') ctx.strokeRect(0, H/2 - DOOR_W/2, WALL, DOOR_W);
    if (d === 'e') ctx.strokeRect(W - WALL, H/2 - DOOR_W/2, WALL, DOOR_W);
  }
  
  const lines = [
    'DEBUG  [`/F3 toggle]',
    'room: ' + curKey + '  type: ' + room.type,
    'floor: ' + (room.floorTile || '?') + '  wall: ' + (room.wallTile || '?'),
    'enemies: ' + room.enemies.filter(e => e.alive).length + '/' + room.enemies.length +
      '  barrels: ' + room.barrels.filter(b => b.alive).length,
    'cleared: ' + room.cleared + '  doors: ' + Object.keys(room.doors).join(','),
    'hp: ' + player.hp + '/' + player.maxHp + '  ammo: ' + player.ammo,
    'weapon: ' + currentWeapon().id + '  unlocked: ' + unlockedWeapons.size,
    'pos: ' + player.x.toFixed(0) + ',' + player.y.toFixed(0),
    'key: ' + player.hasBossKey + '  boss: ' + bossKey
  ];
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(8, 8, 280, 12 + lines.length * 14);
  ctx.fillStyle = '#8fe0c9';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  lines.forEach((t, i) => ctx.fillText(t, 14, 22 + i * 14));
}

let _fpsFrames = 0, _fpsLast = performance.now(), _fpsValue = 0;
function loop() {
  ctx.imageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
  if (gameMode === 'invaders' && started && typeof updateInvaders === 'function') {
    updateInvaders(); drawInvaders();
  } else if (gameMode === 'openfield' && started && typeof updateOpenField === 'function') {
    updateOpenField(); drawOpenField();
  } else {
    update();
    drawRoom();
    drawEntities();
    drawDebug();
    drawMinimap();
  }
  drawHearts();
  if (typeof showFps !== 'undefined' && showFps) {
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsLast >= 500) {
      _fpsValue = Math.round((_fpsFrames * 1000) / (now - _fpsLast));
      _fpsFrames = 0;
      _fpsLast = now;
    }
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(_fpsValue + ' FPS', W - 10, 18);
  }
  requestAnimationFrame(loop);
}

generateDungeon();
updateRoomLabel();
if (typeof setMinimapEnabled === 'function') setMinimapEnabled(minimapEnabled);
loop();