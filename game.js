// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
const rooms = {};
let startKey, bossKey, curKey, exitHubKey = null;
const player = {
  x: 400, y: 272, r: 14, speed: 4.8,
  hp: 6, maxHp: 6, invuln: 0, shootCooldown: 0,
  dx: 0, dy: -1, hasBossKey: false,
  ammo: 200,
  maxAmmo: 9999,
  mag: 12,
  reloadTimer: 0,
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
let bossDefeatedThisDepth = false; // boss dead → exit hub unlocked
let runTimerStart = 0;
let runTimerAccum = 0;
let runTimerRunning = false;
let runTimerArmed = false; // becomes true the first time the player leaves the depth's start room

let gunFrame = 0, gunAnimTimer = 0;
let started = false;
let paused = false;
let exitConfirmPending = null; // { action, label, detail }
let exitZoneCooldown = 0;
const _roomCache = { key: null, canvas: null };
function invalidateRoomCache() { _roomCache.key = null; }

/** Depths with special choice exit hubs. */
const CHOICE_EXIT_DEPTHS = [5, 10, 15];
/** Last normal depth; continue can open secret depth 16. */
const FINAL_NORMAL_DEPTH = 15;
const SECRET_DEPTH = 16;

function startMission(opts) {
  opts = opts || {};
  gameOver = false; paused = false; started = true;
  bossDefeatedThisDepth = false;
  exitConfirmPending = null;
  exitZoneCooldown = 0;
  if (typeof skipDialogue === 'function') skipDialogue();
  const el = document.getElementById('msg');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }

  if (typeof loadMeta === 'function') loadMeta();
  if (typeof loadStats === 'function') loadStats();
  if (!opts.continueRun && typeof recordRunStart === 'function') recordRunStart();

  const gunId = opts.gunId || (typeof runBag !== 'undefined' && runBag.loadoutGun) || 'pistol';
  const relicId = opts.relicId != null ? opts.relicId
    : (typeof runBag !== 'undefined' ? runBag.loadoutRelic : null);
  const startDepth = opts.depth != null ? opts.depth : 1;

  // Fresh run unless continuing deeper mid-run
  if (!opts.continueRun) {
    if (typeof beginRun === 'function') beginRun(gunId, relicId, startDepth);
  }

  if (typeof applyRelicsToPlayer === 'function') applyRelicsToPlayer();
  else { player.maxHp = 6; player.speed = 4.8; }
  player.hp = player.maxHp;
  player.reloadTimer = 0;
  player.hasBossKey = false; player.invuln = 0;

  // Only loadout gun + finds this run (not full profile)
  unlockedWeapons = new Set(['pistol']);
  if (gunId) unlockedWeapons.add(gunId);
  if (typeof runBag !== 'undefined' && runBag.foundWeapons) {
    runBag.foundWeapons.forEach(id => unlockedWeapons.add(id));
  }
  weaponIndex = 0;
  const prefer = gunId || 'pistol';
  const wi = ARSENAL.findIndex(w => w.id === prefer);
  if (wi >= 0 && unlockedWeapons.has(prefer)) weaponIndex = wi;

  playerProjectiles.length = 0; enemyProjectiles.length = 0;
  particles.length = 0; explosions.length = 0;
  for (const k of Object.keys(rooms)) delete rooms[k];
  generateDungeon();
  invalidateRoomCache();
  updateRoomLabel();
  player.ammo = 200;
  try {
    setWeapon(weaponIndex, { quiet: true, force: true });
  } catch (e) {
    console.warn('startMission: setWeapon failed', e);
  }
  giveDeployAmmo();
  if ((player.mag | 0) <= 0) {
    let size = 12;
    try {
      const w = currentWeapon();
      size = (typeof effectiveMagSize === 'function') ? effectiveMagSize(w) : 12;
    } catch (e) {}
    player.mag = (size | 0) > 0 ? (size | 0) : 12;
  }
  if (!((player.ammo | 0) > 0)) player.ammo = 200;
  if (typeof setMinimapEnabled === 'function') setMinimapEnabled(minimapEnabled);
  // Game music kicks in when the player leaves the start room (see enterDoor),
  // same trigger as the speedrun clock. Menu music keeps playing until then.
  if (typeof depthLabel === 'function') flashToast(depthLabel());
  setGameCursor();
  // Speedrun clock for this depth: armed (starts counting) the first time
  // the player leaves the starting room, not on mission deploy.
  runTimerStart = 0;
  runTimerAccum = 0;
  runTimerRunning = false;
  runTimerArmed = false;
  // Opening story beat (once per browser session unless you clear storiesPlayed)
  if (typeof playStory === 'function') {
    setTimeout(() => playStory('mission_start'), 400);
  }
}

function continueMissionDeeper() {
  if (typeof continueDeeper === 'function') continueDeeper();
  gameOver = false; paused = false; started = true;
  bossDefeatedThisDepth = false;
  exitConfirmPending = null;
  exitZoneCooldown = 0;
  const el = document.getElementById('msg');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  if (typeof applyRelicsToPlayer === 'function') applyRelicsToPlayer();
  player.hp = Math.min(player.maxHp, Math.max(player.hp, Math.ceil(player.maxHp * 0.5)));
  player.ammo = Math.max(player.ammo | 0, 80);
  player.hasBossKey = false; player.invuln = 30;
  playerProjectiles.length = 0; enemyProjectiles.length = 0;
  particles.length = 0; explosions.length = 0;
  for (const k of Object.keys(rooms)) delete rooms[k];
  generateDungeon();
  invalidateRoomCache();
  updateRoomLabel();
  setWeapon(weaponIndex, { quiet: true, force: true });
  if (player.mag <= 0) fillMagFromReserve(currentWeapon());
  // Game music keeps playing across the transition; if it ever isn't (e.g.
  // muted then unmuted), it re-syncs with the timer when this new depth's
  // start room is left, same as enterDoor's fresh-run case.
  if (typeof depthLabel === 'function') flashToast('CONTINUING · ' + depthLabel());
  // New depth = new speedrun split: reset and re-arm on leaving its start room.
  runTimerStart = 0;
  runTimerAccum = 0;
  runTimerRunning = false;
  runTimerArmed = false;
}

function extractAndEndRun() {
  const summary = (typeof formatRunRewardsSummary === 'function') ? formatRunRewardsSummary() : { guns: [], relics: [], depth: 1 };
  if (typeof extractRunToProfile === 'function') extractRunToProfile();
  if (typeof resetRunBag === 'function') resetRunBag();
  if (typeof recordExtract === 'function') recordExtract();
  gameOver = true;
  started = false;
  setGameCursor();
  const gunLine = summary.guns.length ? summary.guns.join(', ') : '—';
  const relicLine = summary.relics.length ? summary.relics.join(', ') : '—';
  const el = document.getElementById('msg');
  el.style.display = 'flex';
  el.innerHTML =
    '<div style="text-align:center;max-width:420px">' +
    '<div style="font-size:22px;letter-spacing:2px;color:#8fe0c9">EXTRACTION SUCCESS</div>' +
    '<div style="font-size:13px;opacity:.85;margin:10px 0 6px">DEPTH ' + summary.depth + ' COMPLETE · selectable next run</div>' +
    '<div style="font-size:12px;color:#9fd8ff;margin:4px 0">GUNS KEPT: ' + gunLine + '</div>' +
    '<div style="font-size:12px;color:#f4c430;margin:4px 0 14px">RELICS KEPT: ' + relicLine + '</div>' +
    '<button data-act="menu">MAIN MENU</button>' +
    '</div>';
  runTimerRunning = false;
  if (typeof playSfx === 'function') playSfx('pickup');
  if (typeof flashToast === 'function') flashToast('EXTRACTED · ITEMS SECURED');
}

function currentWeapon() { return ARSENAL[weaponIndex]; }

function updateWeaponLabel() {
  const w = currentWeapon();
  const el = document.getElementById('weaponLabel');
  if (!el || !w) return;
  const slot = weaponIndex + 1;
  el.textContent = slot + '  ' + w.name;
  el.style.display = '';
  const rl = document.getElementById('rarityLabel');
  if (rl) {
    if (w.rarity && typeof RARITY !== 'undefined' && RARITY[w.rarity]) {
      rl.textContent = RARITY[w.rarity].label;
      rl.style.color = RARITY[w.rarity].color;
      rl.style.display = '';
    } else {
      rl.textContent = 'STARTER';
      rl.style.color = '#7d859c';
      rl.style.display = '';
    }
  }
}

function isPistol(w) {
  w = w || (typeof currentWeapon === 'function' ? currentWeapon() : null);
  return !!(w && w.id === 'pistol');
}
function gunAmmoGrant(id) {
  if (typeof AMMO_GRANT !== 'undefined' && AMMO_GRANT[id] != null) return AMMO_GRANT[id];
  return 30;
}
function gunAmmoMax(id) { return 9999; }
function getWeaponReserve(id) { return player.ammo | 0; }
function setWeaponReserve(id, n) {
  player.ammo = Math.max(0, n | 0);
}

function giveDeployAmmo() {
  // Set reserve/mag defensively: if anything below throws (a relic hook,
  // a malformed weapon entry, etc.) we still guarantee the player deploys
  // with a full reserve and a usable mag instead of silently landing on 0/0.
  player.ammo = 200;
  player.maxAmmo = 9999;
  player.reloadTimer = 0;
  let size = 12;
  try {
    const w = (typeof currentWeapon === 'function') ? currentWeapon() : (typeof ARSENAL !== 'undefined' ? ARSENAL[weaponIndex] : null);
    if (w) {
      size = (typeof effectiveMagSize === 'function') ? effectiveMagSize(w) : (w.magSize || 12);
    }
  } catch (e) {
    console.warn('giveDeployAmmo: mag size calc failed, falling back to 12', e);
    size = 12;
  }
  size = size | 0;
  player.mag = size > 0 ? size : 12;
  if (!(player.ammo > 0)) player.ammo = 200; // absolute last-resort guard
}

function syncAmmoHud() {
  // player.ammo is the single source of truth for reserve
  player.maxAmmo = 9999;
  if (player.ammo == null || isNaN(player.ammo)) player.ammo = 0;
}

function fillMagFromReserve(w) {
  w = w || currentWeapon();
  if (!w) return;
  const size = (typeof effectiveMagSize === 'function') ? effectiveMagSize(w) : (w.magSize || 12);
  // Pistol: always full mag, never spends reserve
  if (isPistol(w)) {
    player.mag = size;
    return;
  }
  const need = size - (player.mag | 0);
  if (need <= 0) { player.mag = size; return; }
  const take = Math.min(need, player.ammo | 0);
  player.ammo = (player.ammo | 0) - take;
  player.mag = (player.mag | 0) + take;
}

function grantAmmoPickup() {
  // Flat restock to shared reserve
  const grant = 40;
  const before = player.ammo | 0;
  player.ammo = before + grant;
  return player.ammo - before;
}

function beginReload(silent) {
  const w = currentWeapon();
  const size = (typeof effectiveMagSize === 'function') ? effectiveMagSize(w) : (w.magSize || 12);
  if (player.reloadTimer > 0) return;
  if (player.mag >= size) return;
  if (isPistol(w)) {
    player.mag = size;
    return;
  }
  if ((player.ammo | 0) <= 0) {
    if (!silent) flashToast('NO RESERVE AMMO');
    return;
  }
  player.reloadTimer = w.reloadTime || 45;
  if (!silent) flashToast('RELOADING…');
}

function setWeapon(i, opts) {
  opts = opts || {};
  const n = ARSENAL.length;
  const idx = ((i % n) + n) % n;
  if (!unlockedWeapons.has(ARSENAL[idx].id)) {
    if (!opts.quiet) flashToast(ARSENAL[idx].name + ' LOCKED');
    return false;
  }
  if (weaponIndex === idx && !opts.force) {
    const w = currentWeapon();
    if (player.mag <= 0 && player.reloadTimer <= 0) fillMagFromReserve(w);
    updateWeaponLabel();
    return true;
  }
  player.reloadTimer = 0;
  weaponIndex = idx;
  const w = currentWeapon();
  if (isPistol(w)) {
    const size = (typeof effectiveMagSize === 'function') ? effectiveMagSize(w) : (w.magSize || 12);
    player.mag = size;
  } else {
    player.mag = 0;
    fillMagFromReserve(w);
    if ((player.mag | 0) <= 0 && (player.ammo | 0) > 0) fillMagFromReserve(w);
  }
  updateWeaponLabel();
  if (!opts.quiet) flashToast(w.name);
  return true;
}

function cycleWeapon(dir) {
  const n = ARSENAL.length;
  let idx = weaponIndex;
  for (let i = 0; i < n; i++) {
    idx = ((idx + dir) % n + n) % n;
    if (unlockedWeapons.has(ARSENAL[idx].id)) {
      setWeapon(idx);
      return;
    }
  }
}

function setWeaponBySlot(slot1toN) {
  const unlocked = ARSENAL.filter(w => unlockedWeapons.has(w.id));
  const i = slot1toN - 1;
  if (i < 0 || i >= unlocked.length) {
    flashToast('NO WEAPON ' + slot1toN);
    return;
  }
  const idx = ARSENAL.findIndex(w => w.id === unlocked[i].id);
  if (idx >= 0) setWeapon(idx);
}

setWeapon(0, { quiet: true, force: true });

function key(x, y) { return x + ',' + y; }
function doorLocked(nk) {
  if (!nk) return true;
  if (nk === bossKey && !player.hasBossKey) return true;
  // Exit hub sealed until boss is dead (by key or by room type)
  const dest = rooms[nk];
  if (dest && dest.type === 'exithub' && !bossDefeatedThisDepth) return true;
  if (exitHubKey && nk === exitHubKey && !bossDefeatedThisDepth) return true;
  return false;
}

function isChoiceExitDepth(d) {
  d = d != null ? d : (typeof currentDepth === 'function' ? currentDepth() : 1);
  return CHOICE_EXIT_DEPTHS.indexOf(d | 0) >= 0;
}

/**
 * Build walk-in pads for the exit hub.
 * Normal depths: EXFIL (left) + CONTINUE (right).
 * Choice depths (5/10/15): two story-choice pads on top + elevators below (elevators
 * stay inactive until a choice is confirmed).
 */
function buildExitHubZones(choiceMode, depth) {
  const zones = [];
  // Elevator pads (always present) — walk into these squares
  zones.push({
    id: 'exfil',
    kind: 'elevator',
    label: 'EXFIL',
    sub: 'LEAVE · SAVE RUN',
    x: W * 0.28, y: H * 0.58, w: 160, h: 110,
    color: '#8fe0c9'
  });
  zones.push({
    id: 'continue',
    kind: 'elevator',
    label: depth >= FINAL_NORMAL_DEPTH ? 'DEEPER' : 'CONTINUE',
    sub: depth >= FINAL_NORMAL_DEPTH ? 'SECRET PATH' : 'NEXT DEPTH',
    x: W * 0.72, y: H * 0.58, w: 160, h: 110,
    color: '#f4c430'
  });

  if (choiceMode) {
    const cfg = getExitChoiceConfig(depth);
    const opts = (cfg && cfg.options) ? cfg.options : [
      { id: 'a', label: 'OPTION A', sub: '' },
      { id: 'b', label: 'OPTION B', sub: '' }
    ];
    zones.push({
      id: 'choice_' + (opts[0].id || 'a'),
      kind: 'choice',
      choiceId: opts[0].id || 'a',
      label: opts[0].label || 'A',
      sub: opts[0].sub || '',
      x: W * 0.28, y: H * 0.28, w: 140, h: 70,
      color: '#9fd8ff'
    });
    zones.push({
      id: 'choice_' + (opts[1].id || 'b'),
      kind: 'choice',
      choiceId: opts[1].id || 'b',
      label: opts[1].label || 'B',
      sub: opts[1].sub || '',
      x: W * 0.72, y: H * 0.28, w: 140, h: 70,
      color: '#c96b4f'
    });
  }
  return zones;
}

function getExitChoiceConfig(depth) {
  const data = (typeof STORY_DATA !== 'undefined') ? STORY_DATA : null;
  if (!data || !data.exitChoices) return null;
  // Exact depth only (5, 10, 15) — no cascade
  const d = depth | 0;
  return data.exitChoices[d] || data.exitChoices[String(d)] || null;
}

/** Look up one option from the current depth's exitChoices. */
function getExitChoiceOption(choiceId, depth) {
  const cfg = getExitChoiceConfig(depth);
  if (!cfg || !cfg.options) return null;
  for (let i = 0; i < cfg.options.length; i++) {
    if (cfg.options[i].id === choiceId) return cfg.options[i];
  }
  return null;
}

/**
 * Always attach an exit hub to the boss room.
 * Prefers an empty cell; if the grid is full, reclaims a non-critical neighbor.
 */
function placeExitHubRoom(dirs) {
  if (!bossKey || !rooms[bossKey]) return;
  const [bx, by] = bossKey.split(',').map(Number);
  const depthNow = (typeof currentDepth === 'function') ? currentDepth() : 1;
  const choiceMode = isChoiceExitDepth(depthNow);

  function makeHub(x, y) {
    return {
      x: x, y: y,
      type: 'exithub',
      cleared: true,
      doors: {},
      enemies: [], barrels: [], chests: [], keyItem: null,
      visited: false, pickups: [],
      columns: [], hazards: [], hazardGrid: null,
      floorTile: 'floor3',
      wallTile: 'wall1',
      choiceMode: choiceMode,
      choiceMade: !choiceMode, // non-choice depths: elevators ready immediately
      zones: buildExitHubZones(choiceMode, depthNow)
    };
  }

  function tryLink(dx, dy, d1, d2, allowReclaim) {
    const nx = bx + dx, ny = by + dy;
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) return false;
    const nk = key(nx, ny);
    const existing = rooms[nk];
    if (existing) {
      if (!allowReclaim) return false;
      // Never reclaim start, boss, bosshall, or another exit
      if (nk === startKey || nk === bossKey) return false;
      if (existing.type === 'bosshall' || existing.type === 'boss' || existing.type === 'exithub') return false;
      // Detach neighbors pointing at this cell
      for (const k of Object.keys(rooms)) {
        const r = rooms[k];
        if (!r.doors) continue;
        for (const d of Object.keys(r.doors)) {
          if (r.doors[d] === nk) delete r.doors[d];
        }
      }
      delete rooms[nk];
    }
    rooms[nk] = makeHub(nx, ny);
    rooms[bossKey].doors[d1] = nk;
    rooms[nk].doors[d2] = bossKey;
    exitHubKey = nk;
    return true;
  }

  // 1) Empty cells first (prefer dirs the boss is not already using)
  const shuffled = (dirs || [
    [0, -1, 'n', 's'], [0, 1, 's', 'n'], [1, 0, 'e', 'w'], [-1, 0, 'w', 'e']
  ]).slice().sort(() => Math.random() - 0.5);
  for (const [dx, dy, d1, d2] of shuffled) {
    if (tryLink(dx, dy, d1, d2, false)) return;
  }
  // 2) Reclaim a normal neighbor if needed
  for (const [dx, dy, d1, d2] of shuffled) {
    if (tryLink(dx, dy, d1, d2, true)) return;
  }
  console.warn('placeExitHubRoom: could not place exit hub');
}

function pointInZone(px, py, z) {
  const hw = z.w / 2, hh = z.h / 2;
  return px >= z.x - hw && px <= z.x + hw && py >= z.y - hh && py <= z.y + hh;
}

function isHallType(room) {
  if (room && room.type === 'bosshall' && room.bossHub) return false;
  return room && (room.type === 'hallway' || room.type === 'bosshall');
}

function buildBossHubHazards(room) {
  const hazards = [];
  const x0 = WALL, y0 = WALL, x1 = W - WALL, y1 = H - WALL;
  const cols = Math.floor((x1 - x0) / TILE_SIZE);
  const rows = Math.floor((y1 - y0) / TILE_SIZE);
  const cx = W / 2, cy = H / 2;
  // Center pad ~7 tiles (small square)
  const padHalf = TILE_SIZE * 3.5;
  // Corridor half-width matches door
  const hallHalf = DOOR_W / 2 + TILE_SIZE * 0.5;

  const inCenter = (px, py) => Math.abs(px - cx) <= padHalf && Math.abs(py - cy) <= padHalf;
  const inN = (px, py) => Math.abs(px - cx) <= hallHalf && py <= cy;
  const inS = (px, py) => Math.abs(px - cx) <= hallHalf && py >= cy;
  const inW = (px, py) => Math.abs(py - cy) <= hallHalf && px <= cx;
  const inE = (px, py) => Math.abs(py - cy) <= hallHalf && px >= cx;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tx = x0 + col * TILE_SIZE;
      const ty = y0 + row * TILE_SIZE;
      const px = tx + TILE_SIZE / 2, py = ty + TILE_SIZE / 2;
      const safe = inCenter(px, py) || inN(px, py) || inS(px, py) || inW(px, py) || inE(px, py);
      if (!safe) {
        hazards.push({ x: tx, y: ty, w: TILE_SIZE, h: TILE_SIZE, blocking: true });
      }
    }
  }
  return hazards;
}

function resolveHallAxis(room) {
  if (room.hallAxis) return room.hallAxis;
  const ds = Object.keys(room.doors || {});
  const hasV = ds.some(d => d === 'n' || d === 's');
  const hasH = ds.some(d => d === 'e' || d === 'w');
  if (hasV && hasH) return 'L';
  if (hasH) return 'h';
  return 'v';
}

function getHallBounds(room) {
  const axis = resolveHallAxis(room);
  const half = HALL_THICKNESS / 2;

  if (axis === 'h') {
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

function buildHazardGrid(hazards) {
  if (!hazards || !hazards.length) return null;
  const cols = Math.floor((W - 2 * WALL) / TILE_SIZE);
  const rows = Math.floor((H - 2 * WALL) / TILE_SIZE);
  const data = new Uint8Array(cols * rows);
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    const c = ((h.x - WALL) / TILE_SIZE) | 0;
    const r = ((h.y - WALL) / TILE_SIZE) | 0;
    if (c >= 0 && c < cols && r >= 0 && r < rows) data[r * cols + c] = 1;
  }
  return { cols, rows, data };
}

function pointOnHazard(room, x, y, r) {
  const g = room.hazardGrid;
  if (g) {
    const minC = Math.max(0, ((x - r - WALL) / TILE_SIZE) | 0);
    const maxC = Math.min(g.cols - 1, ((x + r - WALL) / TILE_SIZE) | 0);
    const minR = Math.max(0, ((y - r - WALL) / TILE_SIZE) | 0);
    const maxR = Math.min(g.rows - 1, ((y + r - WALL) / TILE_SIZE) | 0);
    for (let row = minR; row <= maxR; row++) {
      const base = row * g.cols;
      for (let col = minC; col <= maxC; col++) {
        if (g.data[base + col]) return true;
      }
    }
    return false;
  }
  for (const h of (room.hazards || [])) {
    if (x + r > h.x && x - r < h.x + h.w && y + r > h.y && y - r < h.y + h.h) return true;
  }
  return false;
}

function buildLayoutHazards(room, layout) {
  if (!layout || layout.kind === 'plain') return [];

  const hazards = [];
  const x0 = WALL, y0 = WALL, x1 = W - WALL, y1 = H - WALL;
  const cols = Math.floor((x1 - x0) / TILE_SIZE);
  const rows = Math.floor((y1 - y0) / TILE_SIZE);
  const cx = W / 2, cy = H / 2;

  const isDoorMouth = (tx, ty) => {
    const px = tx + TILE_SIZE / 2, py = ty + TILE_SIZE / 2;
    const half = DOOR_W / 2 + TILE_SIZE;
    if (room.doors && room.doors.n && Math.abs(px - cx) < half && ty < y0 + TILE_SIZE * 4) return true;
    if (room.doors && room.doors.s && Math.abs(px - cx) < half && ty > y1 - TILE_SIZE * 4) return true;
    if (room.doors && room.doors.w && Math.abs(py - cy) < half && tx < x0 + TILE_SIZE * 4) return true;
    if (room.doors && room.doors.e && Math.abs(py - cy) < half && tx > x1 - TILE_SIZE * 4) return true;
    return false;
  };

  const pushHole = (tx, ty) => {
    if (isDoorMouth(tx, ty)) return;
    hazards.push({ x: tx, y: ty, w: TILE_SIZE, h: TILE_SIZE, blocking: true });
  };

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
  if (!room) return;
  const g = room.hazardGrid;
  if (g) {
    const minC = Math.max(0, ((ent.x - ent.r - WALL) / TILE_SIZE) | 0);
    const maxC = Math.min(g.cols - 1, ((ent.x + ent.r - WALL) / TILE_SIZE) | 0);
    const minR = Math.max(0, ((ent.y - ent.r - WALL) / TILE_SIZE) | 0);
    const maxR = Math.min(g.rows - 1, ((ent.y + ent.r - WALL) / TILE_SIZE) | 0);
    for (let row = minR; row <= maxR; row++) {
      const base = row * g.cols;
      for (let col = minC; col <= maxC; col++) {
        if (!g.data[base + col]) continue;
        const hx = WALL + col * TILE_SIZE;
        const hy = WALL + row * TILE_SIZE;
        const hw = TILE_SIZE, hh = TILE_SIZE;
        if (!(ent.x + ent.r > hx && ent.x - ent.r < hx + hw &&
              ent.y + ent.r > hy && ent.y - ent.r < hy + hh)) continue;
        const nearestX = Math.max(hx, Math.min(ent.x, hx + hw));
        const nearestY = Math.max(hy, Math.min(ent.y, hy + hh));
        let dx = ent.x - nearestX;
        let dy = ent.y - nearestY;
        if (dx === 0 && dy === 0) {
          const left = ent.x - hx, right = hx + hw - ent.x;
          const top = ent.y - hy, bot = hy + hh - ent.y;
          const m = Math.min(left, right, top, bot);
          if (m === left) ent.x = hx - ent.r;
          else if (m === right) ent.x = hx + hw + ent.r;
          else if (m === top) ent.y = hy - ent.r;
          else ent.y = hy + hh + ent.r;
        } else {
          const dist = Math.hypot(dx, dy) || 1;
          const push = ent.r - dist + 0.5;
          ent.x += (dx / dist) * push;
          ent.y += (dy / dist) * push;
        }
      }
    }
    return;
  }
  for (const h of (room.hazards || [])) {
    if (!h.blocking) continue;
    if (!(ent.x + ent.r > h.x && ent.x - ent.r < h.x + h.w &&
          ent.y + ent.r > h.y && ent.y - ent.r < h.y + h.h)) continue;
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

function safeRoomPos(room, radius, minDistFromCenter) {
  const cr = room.circleR || Math.min(W, H) / 2 - WALL - 8;
  const minD = minDistFromCenter || 0;
  for (let tries = 0; tries < 60; tries++) {
    const x = 120 + Math.random() * (W - 240);
    const y = 100 + Math.random() * (H - 200);
    let ok = true;
    if (minD > 0 && Math.hypot(x - W / 2, y - H / 2) < minD) ok = false;
    for (const col of (room.columns || [])) {
      if (circleHitsColumn(x, y, radius + 4, col)) { ok = false; break; }
    }
    if (pointOnHazard(room, x, y, radius)) ok = false;
    if (room.shape === 'circle' && Math.hypot(x - W / 2, y - H / 2) > cr - radius - 12) ok = false;
    // Keep clear of door zones
    if (Math.abs(x - W / 2) < DOOR_W && (y < WALL + 40 || y > H - WALL - 40)) ok = false;
    if (Math.abs(y - H / 2) < DOOR_W && (x < WALL + 40 || x > W - WALL - 40)) ok = false;
    if (ok) return { x, y };
  }
  // Fallback: far from center
  const a = Math.random() * Math.PI * 2;
  return { x: W / 2 + Math.cos(a) * 180, y: H / 2 + Math.sin(a) * 140 };
}

/**
 * Button / gate puzzle room.
 * Buttons toggle gates: B1→G1+G3, B2→G3, B3→G1+G2 (example).
 * All gates must be open to solve (unlock exits + reveal reward).
 */
function setupPuzzleRoom(r) {
  r.enemies = [];
  r.barrels = [];
  r.chests = [];
  r.columns = [];
  r.enemiesActive = true;
  r.enemySpawnTimer = -1;
  r.cleared = false;
  r.puzzleSolved = false;
  r.buttonCooldown = 0;

  // Vertical hallway — wider for movement
  const hallW = 192;
  const hallL = W / 2 - hallW / 2;
  const hallR = W / 2 + hallW / 2;
  const hazards = [];
  const wallTop = WALL + 48;
  const wallBot = H - WALL - 48;
  hazards.push({ x: WALL, y: wallTop, w: hallL - WALL, h: wallBot - wallTop, blocking: true });
  hazards.push({ x: hallR, y: wallTop, w: W - WALL - hallR, h: wallBot - wallTop, blocking: true });
  r.hazards = hazards;
  r.hazardGrid = buildHazardGrid(r.hazards);

  // Gates: full-width tile strips spanning the hallway
  const gateH = TILE_SIZE;
  const gx = hallL;
  const gw = hallW;
  r.puzzleGates = [
    { id: 0, x: gx, y: Math.round(H * 0.58 / TILE_SIZE) * TILE_SIZE, w: gw, h: gateH, open: false },
    { id: 1, x: gx, y: Math.round(H * 0.42 / TILE_SIZE) * TILE_SIZE, w: gw, h: gateH, open: false },
    { id: 2, x: gx, y: Math.round(H * 0.26 / TILE_SIZE) * TILE_SIZE, w: gw, h: gateH, open: false }
  ];
  r.puzzleMap = [
    [0, 2],
    [2],
    [0, 1]
  ];
  // Buttons: small elevator sprites at south end
  const by = H * 0.78;
  const bx = W / 2;
  r.puzzleButtons = [
    { id: 0, x: bx - 48, y: by, r: 14, label: '1', on: false },
    { id: 1, x: bx, y: by, r: 14, label: '2', on: false },
    { id: 2, x: bx + 48, y: by, r: 14, label: '3', on: false }
  ];
  r.pickups = [
    { x: W / 2 - 20, y: H * 0.14, r: 12, kind: 'health', taken: false },
    { x: W / 2 + 20, y: H * 0.14, r: 12, kind: 'ammo', taken: false }
  ];
}

function togglePuzzleButton(room, btnId) {
  if (!room || room.type !== 'puzzle' || room.puzzleSolved) return;
  const map = room.puzzleMap[btnId];
  if (!map) return;
  const btn = (room.puzzleButtons || []).find(b => b.id === btnId);
  if (btn) btn.on = !btn.on;
  for (let i = 0; i < map.length; i++) {
    const g = room.puzzleGates[map[i]];
    if (g) g.open = !g.open;
  }
  const allOpen = room.puzzleGates.every(g => g.open);
  if (allOpen) {
    room.puzzleSolved = true;
    room.cleared = true;
    if (typeof flashToast === 'function') flashToast('PUZZLE SOLVED');
    if (typeof playSfx === 'function') playSfx('pickup');
  } else if (typeof flashToast === 'function') {
    flashToast('GATES TOGGLED');
  }
}

function updatePuzzleRoom(room) {
  if (!room || room.type !== 'puzzle' || room.puzzleSolved) return;
  if (room.buttonCooldown > 0) { room.buttonCooldown--; return; }
  const buttons = room.puzzleButtons || [];
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (Math.hypot(player.x - b.x, player.y - b.y) < player.r + b.r) {
      togglePuzzleButton(room, b.id);
      room.buttonCooldown = 28;
      if (typeof playSfx === 'function') playSfx('pickup');
      return;
    }
  }
}

function resolvePuzzleGateCollision(ent) {
  const room = rooms[curKey];
  if (!room || room.type !== 'puzzle') return;
  const gates = room.puzzleGates || [];
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    if (g.open) continue;
    // AABB vs circle push-out
    const nearestX = Math.max(g.x, Math.min(ent.x, g.x + g.w));
    const nearestY = Math.max(g.y, Math.min(ent.y, g.y + g.h));
    const dx = ent.x - nearestX, dy = ent.y - nearestY;
    const dist = Math.hypot(dx, dy);
    if (dist < ent.r && dist > 0.001) {
      const push = (ent.r - dist) / dist;
      ent.x += dx * push;
      ent.y += dy * push;
    } else if (dist < ent.r) {
      // Center inside rect — push south (toward buttons)
      ent.y = g.y + g.h + ent.r + 1;
    }
  }
}

function drawPuzzleRoom(room) {
  if (!room || room.type !== 'puzzle') return;
  const gates = room.puzzleGates || [];
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (g.open) {
      ctx.globalAlpha = 0.3;
      if (!drawTile('floor3', g.x, g.y, g.w, g.h)) {
        ctx.fillStyle = 'rgba(143,224,201,0.15)';
        ctx.fillRect(g.x, g.y, g.w, g.h);
      }
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#8fe0c9';
      ctx.lineWidth = 2;
      ctx.strokeRect(g.x, g.y, g.w, g.h);
    } else {
      // Closed gate: wall tiles spanning full hallway width
      if (!drawTile('wall1', g.x, g.y, g.w, g.h)) {
        ctx.fillStyle = '#3a4558';
        ctx.fillRect(g.x, g.y, g.w, g.h);
      }
      ctx.strokeStyle = '#9fd8ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(g.x, g.y, g.w, g.h);
      ctx.fillStyle = '#c8d0e0';
      ctx.font = 'bold 12px "Pixelify Sans", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(g.id + 1), Math.round(g.x + g.w / 2), Math.round(g.y + g.h / 2));
    }
    ctx.restore();
  }
  const buttons = room.puzzleButtons || [];
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const size = 28;
    const isOn = !!b.on;
    if (spriteReady('elevator')) {
      ctx.globalAlpha = room.puzzleSolved ? 0.55 : (isOn ? 1 : 0.7);
      // pressed = shift down slightly + tint
      const dy = isOn ? 3 : 0;
      drawSpriteFit(SPRITES.elevator, b.x, b.y + dy, size);
      if (isOn) {
        ctx.fillStyle = 'rgba(244,196,48,0.35)';
        ctx.beginPath();
        ctx.arc(b.x, b.y + dy, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = room.puzzleSolved ? '#3a5a4a' : (isOn ? '#5a4a20' : '#1a2030');
      ctx.beginPath();
      ctx.arc(b.x, b.y + (isOn ? 3 : 0), b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = room.puzzleSolved ? '#8fe0c9' : (isOn ? '#ffe066' : '#f4c430');
    ctx.lineWidth = isOn ? 3 : 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y + (isOn ? 3 : 0), b.r + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px "Pixelify Sans", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, Math.round(b.x), Math.round(b.y + size / 2 + 8 + (isOn ? 3 : 0)));
    ctx.restore();
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '12px "Pixelify Sans", monospace';
  ctx.textAlign = 'center';
  if (room.puzzleSolved) {
    ctx.fillStyle = 'rgba(143,224,201,0.85)';
    ctx.fillText('GATES OPEN · EXITS UNLOCKED', Math.round(W / 2), 36);
  } else {
    ctx.fillText('STAND ON BUTTONS · OPEN ALL GATES', Math.round(W / 2), 36);
  }
  ctx.restore();
}

/** Map depth → boss type id (1–9). */
function pickBossTypeForDepth(d) {
  d = d | 0;
  if (d <= 4) return Math.random() < 0.5 ? 1 : 2;
  if (d === 5) return 3;
  if (d <= 9) return Math.random() < 0.5 ? 4 : 5;
  if (d === 10) return 6;
  if (d <= 14) return Math.random() < 0.5 ? 7 : 8;
  return 9; // depth 15+
}

const BOSS_TYPE_NAMES = {
  1: 'MOVER',
  2: 'NEST',
  3: 'PACK LEADER',
  4: 'BLINKER',
  5: 'ORBITER',
  6: 'TANK',
  7: 'STRIKER',
  8: 'OVERSEER',
  9: 'APEX'
};

function spawnBoss(room) {
  if (typeof playMusic === 'function') playMusic('boss');
  if (room.bossSpawned) return;
  room.bossSpawned = true;
  const d = (typeof currentDepth === 'function') ? currentDepth() : 1;
  const bossType = room.bossType || pickBossTypeForDepth(d);
  room.bossType = bossType;
  const bhp = (typeof depthBossHp === 'function') ? depthBossHp() : BOSS_HP;
  // Scale HP slightly by type
  const hpMul = ({ 2: 0.9, 5: 0.95, 6: 1.35, 7: 0.85, 9: 1.5 }[bossType]) || 1;
  const hp = Math.round(bhp * hpMul);
  const stationary = (bossType === 2);
  const en = {
    x: W / 2, y: H / 2 - 40, hp: hp, maxHp: hp, r: stationary ? 34 : 30,
    speed: stationary ? 0 : (bossType === 6 ? 0.7 : bossType === 7 ? 1.7 : 1.25),
    type: 'boss', spriteBase: room.spriteBase || ('boss' + bossType),
    bossType: bossType,
    mode: stationary ? 'sit' : 'chase', modeTimer: 70,
    flankSide: Math.random() < 0.5 ? 1 : -1,
    shootTimer: 40, burstTimer: 140, dashTimer: 160, spawnTimer: 90,
    enraged: false, alive: true, cooldown: 30, phase: 1
  };
  room.enemies.push(en);
  resolveColumnCollision(en);
  const name = BOSS_TYPE_NAMES[bossType] || 'BOSS';
  flashToast('BOSS · ' + name);
  spawnParticles(W / 2, H / 2 - 40, '#c96b4f', 20);
}

function generateDungeon() {
  for (const k in rooms) delete rooms[k];
  const cx = Math.floor(GRID / 2), cy = Math.floor(GRID / 2);
  startKey = key(cx, cy);
  rooms[startKey] = { x: cx, y: cy, type: 'start', cleared: true, doors: {}, enemies: [], barrels: [], chests: [], keyItem: null, visited: true, pickups: [] };

  const roomCount = (typeof depthRoomCount === 'function') ? depthRoomCount() : (12 + Math.floor(Math.random() * 4));
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
  // Prefer a non-start room as farthest; if only start exists, still force a boss
  if (farthest === startKey) {
    for (const k in rooms) {
      if (k !== startKey) { farthest = k; break; }
    }
  }

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
    rooms[farthest].type = 'bosshall';
    rooms[farthest].cleared = true;
    rooms[farthest].enemies = [];
    rooms[farthest].barrels = [];
    rooms[farthest].chests = [];
    rooms[farthest].pickups = [];
    rooms[farthest].keyItem = null;
    rooms[farthest].hallAxis = null;
    rooms[farthest].bossHub = true;
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
    // Always ensure a dedicated boss room exists
    if (farthest === startKey) {
      // Carve a boss cell next to start if dungeon is tiny
      for (const [dx, dy, d1, d2] of hallDirs) {
        const nx = fx + dx, ny = fy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const nk = key(nx, ny);
        if (rooms[nk]) continue;
        rooms[nk] = {
          x: nx, y: ny, type: 'boss', cleared: false, doors: {},
          enemies: [], barrels: [], chests: [], keyItem: null, visited: false, pickups: []
        };
        rooms[startKey].doors[d1] = nk;
        rooms[nk].doors[d2] = startKey;
        bossKey = nk;
        hallwayKey = null;
        placedHallway = true;
        break;
      }
    }
    if (!placedHallway) {
      rooms[bossKey].type = 'boss';
      rooms[bossKey].cleared = false;
      hallwayKey = null;
    }
  }
  // Final guarantee
  if (!bossKey || !rooms[bossKey]) {
    bossKey = farthest;
    rooms[bossKey].type = 'boss';
    rooms[bossKey].cleared = false;
  } else {
    rooms[bossKey].type = 'boss';
  }

  // --- exit hub always attached to boss (CONTINUE / EXFIL pads) ---
  exitHubKey = null;
  bossDefeatedThisDepth = false;
  exitConfirmPending = null;
  placeExitHubRoom(dirs);

  const usedKeys = new Set([startKey, bossKey]);
  if (hallwayKey) usedKeys.add(hallwayKey);
  if (exitHubKey) usedKeys.add(exitHubKey);
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
  // Exactly 1 chest per level (weapon only). Relics only drop from bosses.
  claimRoom('chest');
  claimRoom('puzzle');

  for (const k in rooms) {
    const r = rooms[k];
    r.floorTile = 'floor' + (1 + Math.floor(Math.random() * 3));
    r.wallTile = 'wall' + (1 + Math.floor(Math.random() * 4));
    // --- authored layout (kill tiles, floor patterns) ---
    const picked = pickLayoutForRoom(r.type === 'relic' ? 'chest' : r.type);
    r.layoutId = picked.id;
    r.layout = picked.layout;
    r.shape = 'rect';
    r.circleR = Math.min(W, H) / 2 - WALL - 8;
    if (picked.layout.kind === 'safe_circle' || picked.layout.kind === 'loop') {
      r.shape = 'rect'; // collision uses hazards, not geometric circle clip
    }

    if (r.type === 'bosshall') {
      r.floorTile = 'floor3';
      r.cleared = true;
      r.enemies = [];
      r.barrels = [];
      r.chests = [];
      r.keyItem = null;
      r.columns = [];
      r.hazards = buildBossHubHazards(r);
      r.hazardGrid = buildHazardGrid(r.hazards);
      r.pickups = [
        { x: W / 2 - 28, y: H / 2, r: 12, kind: 'health', taken: false },
        { x: W / 2 + 28, y: H / 2, r: 12, kind: 'ammo', taken: false }
      ];
      continue;
    }
    if (r.type === 'exithub') {
      r.floorTile = 'floor3';
      r.wallTile = 'wall1';
      r.cleared = true;
      r.enemies = [];
      r.barrels = [];
      r.chests = [];
      r.keyItem = null;
      r.columns = [];
      r.hazards = [];
      r.hazardGrid = null;
      r.pickups = [];
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
      r.hazardGrid = buildHazardGrid(r.hazards);
      const hallCount = Math.random() < HALL_ENEMY_CHANCE ? (Math.random() < 0.4 ? 2 : 1) : 0;
      for (let hi = 0; hi < hallCount; hi++) {
        const isShooter = Math.random() < 0.45;
        const pos = hallSpawnPos(r);
        if (!pointOnHazard(r, pos.x, pos.y, 16)) {
          const hs = (typeof depthEnemyHpScale === 'function') ? depthEnemyHpScale() : 1;
          const baseHp = isShooter ? 3 : 4;
          const hp = Math.max(1, Math.round(baseHp * hs));
          r.enemies.push({
            x: pos.x, y: pos.y,
            hp, maxHp: hp, r: 16,
            speed: isShooter ? 0.9 : 1.4, type: isShooter ? 'shooter' : 'slime',
            cooldown: Math.random() * 60, alive: true, strafeDir: Math.random() < 0.5 ? 1 : -1
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
      r.hazardGrid = null;
      r.columns = [];
      continue;
    }

    r.columns = [];
    const heavyKill = ['safe_circle', 'loop', 'islands', 'cross'].includes(picked.layout.kind);
    if (!heavyKill && (r.type === 'boss' || (r.type === 'normal' && Math.random() < 0.55))) {
      r.columns = generateColumns(r.type);
    }
    if (r.type === 'chest' || r.type === 'puzzle') {
      r.columns = [];
    }

    r.hazards = buildLayoutHazards(r, r.layout);
    r.hazardGrid = buildHazardGrid(r.hazards);

    // --- enemies ---
    const hpScale = (typeof depthEnemyHpScale === 'function') ? depthEnemyHpScale() : 1;
    const countBonus = (typeof depthEnemyCountBonus === 'function') ? depthEnemyCountBonus() : 0;
    function pickEnemyType() {
      const roll = Math.random();
      if (roll < 0.32) return 'slime';
      if (roll < 0.55) return 'shooter';
      if (roll < 0.72) return 'charger';
      if (roll < 0.88) return 'tank';
      return 'spitter';
    }
    function makeEnemyAt(pos, type) {
      const t = type || pickEnemyType();
      let baseHp = 4, speed = 1.4, rad = 16;
      if (t === 'shooter') { baseHp = 3; speed = 0.9; }
      else if (t === 'charger') { baseHp = 3; speed = 2.1; rad = 12; } // drone
      else if (t === 'tank') { baseHp = 9; speed = 0.65; rad = 14; } // heavy drone
      else if (t === 'spitter') { baseHp = 4; speed = 0.45; rad = 14; }
      else { baseHp = 4; speed = 1.55; }
      const hp = Math.max(1, Math.round(baseHp * hpScale));
      const isDrone = (t === 'charger' || t === 'tank');
      return {
        x: pos.x, y: pos.y, hp, maxHp: hp, r: rad, speed, type: t,
        cooldown: Math.random() * 50, alive: true,
        // drones: long initial wind-up before first charge
        dashTimer: isDrone ? (90 + Math.random() * 60) : 0,
        wakeTimer: isDrone ? (50 + Math.random() * 40) : 0,
        fly: isDrone,
        strafeDir: Math.random() < 0.5 ? 1 : -1
      };
    }
    function spawnEnemyInRoom(roomRef) {
      const t = pickEnemyType();
      const minD = (t === 'charger' || t === 'tank') ? 160 : 80;
      return makeEnemyAt(safeRoomPos(roomRef, 16, minD), t);
    }
    if (r.type === 'boss') {
      r.bossSpawnTimer = -1;
      r.bossSpawned = false;
      r.bossType = pickBossTypeForDepth(typeof currentDepth === 'function' ? currentDepth() : 1);
      r.spriteBase = 'boss' + r.bossType;
      r.cleared = false;
    } else if (r.type === 'relic') {
      const count = 2 + Math.floor(Math.random() * 2) + Math.min(1, countBonus);
      for (let i = 0; i < count; i++) r.enemies.push(spawnEnemyInRoom(r));
      r.enemiesActive = r.enemies.length === 0;
      r.enemySpawnTimer = -1;
      r.cleared = r.enemies.length === 0;
    } else if (r.type === 'chest') {
      // Small quiet armory — chest only, doors open immediately
      r.enemies = [];
      r.barrels = [];
      r.columns = [];
      r.hazards = [];
      r.hazardGrid = null;
      r.enemiesActive = true;
      r.enemySpawnTimer = -1;
      r.cleared = true;
      r.pickups = [];
    } else if (r.type === 'puzzle') {
      setupPuzzleRoom(r);
    } else if (r.type !== 'start' && r.type !== 'exithub' && r.type !== 'bosshall' && r.type !== 'hallway') {
      // normal + key rooms — fewer enemies so rooms feel less cramped
      const count = 2 + Math.floor(Math.random() * 3) + Math.min(2, countBonus);
      for (let i = 0; i < count; i++) r.enemies.push(spawnEnemyInRoom(r));
      r.enemiesActive = r.enemies.length === 0;
      r.enemySpawnTimer = -1;
      r.cleared = r.enemies.length === 0;
    }

    // --- barrels ---
    if (r.type !== 'boss' && r.type !== 'exithub' && r.type !== 'chest' && r.type !== 'puzzle' && Math.random() < 0.55) {
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
      // Single centered chest — quiet room
      const gun = weightedPick(CHEST_POOL);
      r.chests = [{
        x: W / 2, y: H / 2,
        r: 22, open: false, weaponId: gun.id
      }];
    }

    if (r.type !== 'boss' && r.type !== 'bosshall' && r.type !== 'exithub' && r.type !== 'chest' && r.type !== 'puzzle' && Math.random() < 0.75) {
      const n = 1 + (Math.random() < 0.35 ? 1 : 0);
      for (let pi = 0; pi < n; pi++) {
        const kind = Math.random() < 0.4 ? 'health' : 'ammo';
        const pos = safeRoomPos(r, 12);
        r.pickups.push({ x: pos.x, y: pos.y, r: 12, kind, taken: false });
      }
    }
  }

  curKey = startKey;
  player.x = W / 2; player.y = H / 2;
  if (player.hp <= 0) player.hp = player.maxHp;
  player.hasBossKey = false;
  // Rebuild in-run unlock set from bag
  unlockedWeapons = new Set(['pistol']);
  if (typeof runBag !== 'undefined') {
    if (runBag.loadoutGun) unlockedWeapons.add(runBag.loadoutGun);
    (runBag.foundWeapons || []).forEach(id => unlockedWeapons.add(id));
  }
  if (!unlockedWeapons.has(ARSENAL[weaponIndex]?.id)) {
    weaponIndex = 0;
    if (runBag && runBag.loadoutGun) {
      const i = ARSENAL.findIndex(w => w.id === runBag.loadoutGun);
      if (i >= 0) weaponIndex = i;
    }
  }
  // weapon + ammo applied by caller
}

// ════════════════════════════════════════
// INPUT
// ════════════════════════════════════════
const keys = {};
let DEBUG = false;
window.addEventListener('keydown', e => {
  // Dialogue captures input first
  if (dialogueActive) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advanceDialogue(); return; }
    if (e.key === 'Escape') { e.preventDefault(); skipDialogue(); return; }
    // Block game controls while talking
    return;
  }
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') { e.preventDefault(); tryFire(); }
  // 1-5 = unlocked weapon slots; Q/E cycle; R reload
  if (e.key >= '1' && e.key <= '5') setWeaponBySlot(parseInt(e.key, 10));
  if (e.key === 'q' || e.key === 'Q') cycleWeapon(-1);
  if (e.key === 'e' || e.key === 'E') cycleWeapon(1);
  if (e.key === 'r' || e.key === 'R') beginReload(false);
  if (e.key === '`' || e.key === 'F3') { DEBUG = !DEBUG; flashToast(DEBUG ? 'DEBUG ON' : 'DEBUG OFF'); }
  if (e.key === 'Escape') { e.preventDefault(); togglePause(); }
});
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
let mouse = { x: W / 2, y: 0, down: false };

/** Always show the system cursor — there's no in-game crosshair without the
 *  Laser Sight relic, so hiding it left players with no aim reference. */
function setGameCursor() {
  document.body.style.cursor = 'default';
  document.body.classList.add('show-cursor');
  const c = document.getElementById('game');
  if (c) c.style.cursor = 'default';
}

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});
canvas.addEventListener('mousedown', () => {
  if (dialogueActive) { advanceDialogue(); return; }
  mouse.down = true; tryFire();
});
canvas.addEventListener('mouseup', () => mouse.down = false);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cycleWeapon(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

// ── Responsive scale (keep internal 800×544, CSS-scale the stack) ──
function updateGameScale() {
  const wrap = document.getElementById('wrap');
  if (!wrap) return;
  const portrait = window.innerHeight > window.innerWidth;
  const inGame = document.body.classList.contains('in-game');
  const touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    ('ontouchstart' in window);
  // Reserve space for HUD + virtual controls so game doesn't sit under them
  const bottomReserve = inGame ? (touch ? (portrait ? 150 : 100) : 48) : 24;
  const topReserve = inGame ? 56 : 16;
  const padX = portrait ? 8 : 12;
  const vw = Math.max(200, window.innerWidth - padX * 2);
  const vh = Math.max(160, window.innerHeight - topReserve - bottomReserve);
  let scale = Math.min(vw / W, vh / H);
  scale = Math.max(0.38, Math.min(1.25, scale));
  wrap.style.setProperty('--scale', String(scale));
  wrap.style.setProperty('--game-w', String(W));
  wrap.style.setProperty('--game-h', String(H));
}
window.addEventListener('resize', updateGameScale);
window.addEventListener('orientationchange', () => setTimeout(updateGameScale, 120));
// Initial + after fonts/layout
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateGameScale);
} else {
  updateGameScale();
}
setTimeout(updateGameScale, 300);

// ── Touch / pointer aim on canvas ──
function setMouseFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  mouse.x = (clientX - rect.left) * (canvas.width / rect.width);
  mouse.y = (clientY - rect.top) * (canvas.height / rect.height);
}

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return; // mouse already handled
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  setMouseFromClient(e.clientX, e.clientY);
  if (dialogueActive) { advanceDialogue(); return; }
  mouse.down = true;
  tryFire();
}, { passive: false });
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') return;
  if (!mouse.down && e.buttons === 0) return;
  setMouseFromClient(e.clientX, e.clientY);
}, { passive: true });
canvas.addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') return;
  mouse.down = false;
}, { passive: true });
canvas.addEventListener('pointercancel', e => {
  if (e.pointerType === 'mouse') return;
  mouse.down = false;
}, { passive: true });

// Prevent page scroll / pinch-zoom while playing
document.addEventListener('touchmove', e => {
  if (document.body.classList.contains('in-game')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());

// ── Mobile virtual joystick + buttons ──
const touchMove = { active: false, mx: 0, my: 0 };
let showMobileControls = false;

function isCoarsePointer() {
  try {
    return window.matchMedia('(pointer: coarse)').matches ||
      ('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0);
  } catch (_) {
    return 'ontouchstart' in window;
  }
}

function setMobileControlsVisible(on) {
  showMobileControls = !!on;
  document.body.classList.toggle('show-mobile-controls', showMobileControls);
}

function setupMobileControls() {
  const stick = document.getElementById('mcJoystick');
  const knob = document.getElementById('mcKnob');
  const fireBtn = document.getElementById('mcFire');
  const reloadBtn = document.getElementById('mcReload');
  const weaponBtn = document.getElementById('mcWeapon');
  if (!stick || !fireBtn) return;

  // Show controls on touch devices when in-game
  const refresh = () => {
    const want = isCoarsePointer() && document.body.classList.contains('in-game');
    setMobileControlsVisible(want);
    document.querySelectorAll('.ctrl-desktop').forEach(el => { el.style.display = isCoarsePointer() ? 'none' : ''; });
    document.querySelectorAll('.ctrl-mobile').forEach(el => { el.style.display = isCoarsePointer() ? '' : 'none'; });
    try {
      if (isCoarsePointer() && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_) {}
  };
  // Observe in-game class changes
  const obs = new MutationObserver(refresh);
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', refresh);
  refresh();

  // Joystick
  let stickId = null;
  function stickPos(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = r.width * 0.38;
    const len = Math.hypot(dx, dy) || 1;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    if (knob) {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    // Normalize for movement (deadzone)
    const ndx = dx / max;
    const ndy = dy / max;
    const dead = 0.18;
    touchMove.mx = Math.abs(ndx) < dead ? 0 : ndx;
    touchMove.my = Math.abs(ndy) < dead ? 0 : ndy;
  }
  function stickEnd() {
    stickId = null;
    touchMove.active = false;
    touchMove.mx = 0;
    touchMove.my = 0;
    if (knob) knob.style.transform = 'translate(0,0)';
  }
  stick.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    stickId = e.pointerId;
    touchMove.active = true;
    try { stick.setPointerCapture(e.pointerId); } catch (_) {}
    stickPos(e.clientX, e.clientY);
  }, { passive: false });
  stick.addEventListener('pointermove', e => {
    if (stickId !== e.pointerId) return;
    stickPos(e.clientX, e.clientY);
  }, { passive: true });
  stick.addEventListener('pointerup', e => {
    if (stickId === e.pointerId) stickEnd();
  }, { passive: true });
  stick.addEventListener('pointercancel', e => {
    if (stickId === e.pointerId) stickEnd();
  }, { passive: true });

  // Fire button (hold for auto)
  fireBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (dialogueActive) { advanceDialogue(); return; }
    mouse.down = true;
    fireBtn.classList.add('active');
    tryFire();
  }, { passive: false });
  const fireUp = () => { mouse.down = false; fireBtn.classList.remove('active'); };
  fireBtn.addEventListener('pointerup', fireUp, { passive: true });
  fireBtn.addEventListener('pointercancel', fireUp, { passive: true });
  fireBtn.addEventListener('pointerleave', fireUp, { passive: true });

  if (reloadBtn) {
    reloadBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof beginReload === 'function') beginReload(false);
    }, { passive: false });
  }
  if (weaponBtn) {
    weaponBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof cycleWeapon === 'function') cycleWeapon(1);
    }, { passive: false });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMobileControls);
} else {
  setupMobileControls();
}
// Expose touch movement vector for the update loop
window.__touchMove = touchMove;
document.getElementById('msg').addEventListener('click', e => {
  if (e.target.tagName !== 'BUTTON') return;
  const act = (e.target.getAttribute('data-act') || '').toLowerCase();
  const t = (e.target.textContent || '').toUpperCase();
  if (act === 'confirm-exit') {
    if (typeof confirmExitAction === 'function') confirmExitAction();
    return;
  }
  if (act === 'cancel-exit') {
    if (typeof cancelExitConfirm === 'function') cancelExitConfirm();
    return;
  }
  if (act === 'exfil' || t.includes('EXFIL')) {
    if (typeof extractAndEndRun === 'function') extractAndEndRun();
    return;
  }
  if (act === 'continue' || t.includes('CONTINUE')) {
    if (typeof continueMissionDeeper === 'function') continueMissionDeeper();
    return;
  }
  if (act === 'loadout' || t.includes('NEW RUN') || t.includes('RETRY')) {
    if (typeof openMissionSelect === 'function') openMissionSelect();
    else if (typeof openLoadoutScreen === 'function') openLoadoutScreen();
    else if (typeof startMission === 'function') startMission();
    return;
  }
  if (act === 'menu' || t.includes('MENU')) {
    location.reload();
    return;
  }
  // fallback
  if (typeof openMissionSelect === 'function') openMissionSelect();
  else if (typeof openLoadoutScreen === 'function') openLoadoutScreen();
  else if (typeof startMission === 'function') startMission();
});

// ════════════════════════════════════════
// MENUS (title screen + pause)
// ════════════════════════════════════════
function togglePause() {
  if (!started || gameOver || dialogueActive) return; // no pausing on title, death, or mid-dialogue
  if (!paused) {
    // entering pause — freeze timer
    if (runTimerRunning) {
      runTimerAccum += performance.now() - runTimerStart;
      runTimerRunning = false;
    }
  } else {
    // resuming
    runTimerStart = performance.now();
    runTimerRunning = true;
  }
  paused = !paused;
  document.getElementById('pauseScreen').classList.toggle('show', paused);
  setGameCursor();
}
document.getElementById('btnStart').addEventListener('click', () => {
  started = true;
  document.getElementById('titleScreen').classList.remove('show');
});
document.getElementById('btnResume').addEventListener('click', togglePause);
document.getElementById('btnRestart').addEventListener('click', () => location.reload());
document.getElementById('btnMainMenu').addEventListener('click', () => location.reload());

// Click dialogue box to advance
(function () {
  const box = document.getElementById('dialogueBox');
  if (box) box.addEventListener('click', () => { if (dialogueActive) advanceDialogue(); });
})();

function tryFire() {
  if (gameOver || !started || paused || dialogueActive || player.shootCooldown > 0) return;
  if (player.reloadTimer > 0) return; // can't shoot while reloading
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

  const cost = w.ammoCost != null ? w.ammoCost : 1;

  if (isPistol(w)) {
    const magSize = (typeof effectiveMagSize === 'function') ? effectiveMagSize(w) : (w.magSize || 12);
    player.mag = magSize;
  } else {
    if (player.mag < cost) {
      beginReload(false);
      return;
    }
    player.mag -= cost;
  }

  player.shootCooldown = Math.max(4, Math.round(w.cooldown * cdScale));
  gunAnimTimer = 8;
  gunFrame = 1;
  if (typeof playSfx === 'function') playSfx(gunSfxKey(w));

  const pellets = w.pellets || 1;
  const spread = w.spread || 0;
  const shotDmg = Math.max(1, Math.round(w.dmg * dmgMult));
  const maxP = typeof MAX_PLAYER_PROJS !== 'undefined' ? MAX_PLAYER_PROJS : 160;
  const life = w.explosive ? 150 : 90;
  const size = w.explosive ? Math.max(18, w.pr * 4) : Math.max(42, w.pr * 12);
  for (let i = 0; i < pellets; i++) {
    let ang = Math.atan2(ny, nx);
    if (pellets > 1) ang += (i - (pellets - 1) / 2) * (spread / pellets);
    const pdx = Math.cos(ang), pdy = Math.sin(ang);
    if (playerProjectiles.length >= maxP) break;
    playerProjectiles.push({
      x: player.x + pdx * 18, y: player.y + pdy * 18,
      dx: pdx, dy: pdy, speed: w.speed, r: w.pr, life,
      dmg: shotDmg, kind: w.explosive ? 'explosive' : 'ranged',
      color: w.color, pierce: !!(w.pierce || (typeof relicPierce === 'function' && relicPierce())),
      splashR: w.splashR, splashDmg: w.splashDmg ? Math.round(w.splashDmg * dmgMult) : w.splashDmg,
      rotIdx: typeof projRotIndex === 'function' ? projRotIndex(pdx, pdy) : 0,
      size,
      r2: (w.pr + 2) * (w.pr + 2)
    });
  }

  if (!isPistol(w) && player.mag < cost) beginReload(true);
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
        if (typeof recordKill === 'function') recordKill(en);
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

  // Speedrun clock (and game music) start the moment the player leaves the
  // depth's start room.
  if (!runTimerArmed) {
    runTimerArmed = true;
    runTimerStart = performance.now();
    runTimerRunning = true;
    if (typeof playMusic === 'function') playMusic('game');
  }

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
    if (!dest.bossSpawned && (dest.bossSpawnTimer === undefined || dest.bossSpawnTimer < 0)) {
      dest.bossSpawnTimer = BOSS_SPAWN_DELAY;
      flashToast('...');
    }
    if (typeof playStory === 'function') playStory('enter_boss');
  } else if (dest.type === 'chest' || dest.type === 'armory') {
    // No dialogue on enter — lines fire when the chest is actually opened
  } else {
    // First combat room of this depth (rooms that actually have enemies)
    const hasEnemies = (dest.enemies && dest.enemies.length) || dest.type === 'normal' || dest.type === 'key';
    if (hasEnemies && typeof playStory === 'function') playStory('enter_combat_room');
    if (dest.enemiesActive === false && dest.enemySpawnTimer < 0) {
      // Give regular room enemies a beat before they wake up
      dest.enemySpawnTimer = ENEMY_SPAWN_DELAY;
    }
  }
  updateRoomLabel();
}

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
function grantKillAmmo(en) {
  if (isPistol()) return;
  const amt = (en && en.type === 'boss') ? 15 : 1;
  player.ammo = (player.ammo | 0) + amt;
  if (en && en.type === 'boss') flashToast('+' + amt + ' AMMO');
}
function spawnParticles(x, y, color, n = 3, kind) {
  if (typeof particlesEnabled !== 'undefined' && !particlesEnabled) return;
  const cap = typeof MAX_PARTICLES !== 'undefined' ? MAX_PARTICLES : 64;
  let sprite = null;
  if (particles.length < cap * 0.5) {
    if (kind === 'red' && typeof spriteReady === 'function' && spriteReady('particleRed')) sprite = 'particleRed';
    else if (kind === 'blue' && typeof spriteReady === 'function' && spriteReady('particleBlue')) sprite = 'particleBlue';
  }
  const count = Math.min(n, cap - particles.length);
  for (let i = 0; i < count; i++) {
    const spd = 2.2 + Math.random() * 4.5;
    const ang = Math.random() * Math.PI * 2;
    particles.push({
      x, y,
      dx: Math.cos(ang) * spd,
      dy: Math.sin(ang) * spd,
      life: 10 + Math.random() * 10,
      maxLife: 16,
      color: color || '#fff',
      sprite,
      size: 3 + Math.random() * 4
    });
  }
}
function explodeBarrel(b) {
  b.alive = false;
  explosions.push({ x: b.x, y: b.y, life: 18, maxLife: 18, maxR: 120 });
  spawnParticles(b.x, b.y, '#f4a05a', 8, 'red');
  if (typeof playSfx === 'function') playSfx('explosion');
  const room = rooms[curKey];
  room.enemies.forEach(en => {
    if (!en.alive) return;
    if (Math.hypot(en.x - b.x, en.y - b.y) < 150 + en.r) {
      en.hp -= 4;
      if (en.hp <= 0) {
        en.alive = false;
        spawnParticles(en.x, en.y, '#8fe0c9', 18);
        if (typeof recordKill === 'function') recordKill(en);
        if (en.type === 'boss') triggerVictory();
      }
    }
  });
  if (Math.hypot(player.x - b.x, player.y - b.y) < 150 + player.r && player.invuln <= 0) {
    damagePlayer(2);
  }
}
function damagePlayer(n) {
  if (player._god) return;

  player.hp -= n;
  player.invuln = 55;
  spawnParticles(player.x, player.y, '#ff8f6b', 8);
  if (typeof playSfx === 'function') playSfx('hurt');
  if (player.hp <= 0 && !gameOver) {
    gameOver = true;
    setGameCursor();
    if (typeof playSfx === 'function') playSfx('gameover');
    if (runTimerRunning) {
      runTimerAccum += performance.now() - runTimerStart;
      runTimerRunning = false;
    }
    if (typeof recordDeath === 'function') recordDeath();
    const lost = (typeof abandonRunOnDeath === 'function') ? abandonRunOnDeath() : { lostGuns: [], lostRelics: [] };
    const gunLine = (lost.lostGuns && lost.lostGuns.length)
      ? lost.lostGuns.map(id => (ARSENAL_MAP[id] && ARSENAL_MAP[id].name) || id).join(', ')
      : 'none';
    const relicLine = (lost.lostRelics && lost.lostRelics.length)
      ? lost.lostRelics.map(id => (typeof RELIC_MAP !== 'undefined' && RELIC_MAP[id] && RELIC_MAP[id].name) || id).join(', ')
      : 'none';
    const el = document.getElementById('msg');
    el.style.display = 'flex';
    el.innerHTML =
      '<div style="text-align:center;max-width:420px">' +
      '<div style="font-size:22px;letter-spacing:2px;color:#ff6b6b">YOU DIED</div>' +
      '<div style="font-size:12px;opacity:.9;margin:10px 0 4px;color:#c96b4f">RUN BAG LOST</div>' +
      '<div style="font-size:11px;color:#aaa;margin:2px 0">Guns lost: ' + gunLine + '</div>' +
      '<div style="font-size:11px;color:#aaa;margin:2px 0 14px">Relics lost: ' + relicLine + '</div>' +
      '<button data-act="loadout">NEW RUN</button><button data-act="menu">MAIN MENU</button>' +
      '</div>';
    if (typeof flashToast === 'function') flashToast('NOTHING EXTRACTED');
  }
}
function spawnBossRelicDrop(room) {
  if (!room) return;
  const pool = (typeof RELIC_DEFS !== 'undefined' && RELIC_DEFS.length)
    ? RELIC_DEFS
    : [{ id: 'harden' }, { id: 'moonboots' }, { id: 'pockets' }, { id: 'gunoil' },
       { id: 'magnet' }, { id: 'pierce' }, { id: 'laser' }];
  const offerId = pool[Math.floor(Math.random() * pool.length)].id;
  // Drop near center of boss room (slightly offset so not on corpse)
  const pos = (typeof safeRoomPos === 'function')
    ? safeRoomPos(room, 18)
    : { x: W / 2, y: H / 2 + 30 };
  room.relicItem = {
    x: pos.x, y: pos.y, r: 18, taken: false, relicId: offerId
  };
}

function grantBossRewardToBag() {
  // Relic is a ground pickup — player must walk onto it
  const room = rooms[curKey] || (bossKey && rooms[bossKey]);
  spawnBossRelicDrop(room);
  player.hp = Math.min(player.maxHp, (player.hp | 0) + 2);
  flashToast('RELIC DROPPED · PICK IT UP');
}

function triggerVictory() {
  // Unlock exit door — player walks into the hub and stands on a pad. No popup.
  if (bossDefeatedThisDepth) return;
  bossDefeatedThisDepth = true;
  grantBossRewardToBag();
  if (typeof recordDepthCleared === 'function') recordDepthCleared();

  // Freeze this depth's speedrun split and record it if it's a new best.
  if (runTimerRunning) {
    runTimerAccum += performance.now() - runTimerStart;
    runTimerRunning = false;
  }
  if (typeof recordDepthTime === 'function') {
    const depthNow = (typeof currentDepth === 'function') ? currentDepth() : 1;
    recordDepthTime(depthNow, Math.round(runTimerAccum));
  }

  const room = rooms[curKey];
  if (room) room.cleared = true;
  playerProjectiles.length = 0;
  enemyProjectiles.length = 0;

  // Guarantee hub exists even if gen failed earlier
  if (!exitHubKey || !rooms[exitHubKey]) {
    placeExitHubRoom();
  }
  if (exitHubKey && rooms[exitHubKey]) {
    const depth = (typeof currentDepth === 'function') ? currentDepth() : 1;
    const choiceMode = isChoiceExitDepth(depth);
    rooms[exitHubKey].choiceMode = choiceMode;
    rooms[exitHubKey].choiceMade = !choiceMode; // elevators ready unless choice depth
    rooms[exitHubKey].zones = buildExitHubZones(choiceMode, depth);
    rooms[exitHubKey].cleared = true;
  }
  invalidateRoomCache();
  updateRoomLabel();

  if (typeof playStory === 'function') playStory('boss_defeated');
  if (typeof playSfx === 'function') playSfx('pickup');
  if (typeof flashToast === 'function') {
    flashToast(exitHubKey ? 'EXIT OPEN · WALK THROUGH' : 'BOSS DOWN');
  }
}

/** Confirm for choices and elevators (EXFIL / CONTINUE). */
function showExitConfirm(zone) {
  if (exitConfirmPending || gameOver) return;
  const depth = (typeof currentDepth === 'function') ? currentDepth() : 1;
  let title = zone.label || 'CONFIRM';
  let detail = zone.sub || '';
  let action = null;

  if (zone.kind === 'choice') {
    const opt = getExitChoiceOption(zone.choiceId, depth);
    const cfg = getExitChoiceConfig(depth);
    title = zone.label || 'CHOICE';
    detail = (opt && opt.confirm) ? opt.confirm
      : (cfg && cfg.prompt) ? cfg.prompt
      : (zone.sub || 'This decision is remembered.');
    action = 'choice:' + zone.choiceId;
  } else if (zone.kind === 'elevator') {
    if (zone.id === 'exfil') {
      title = 'EXFIL';
      detail = 'Leave the complex and keep this run\'s guns and relics. Are you sure?';
      action = 'exfil';
    } else {
      title = zone.label || 'CONTINUE';
      detail = depth >= FINAL_NORMAL_DEPTH
        ? 'Push into the secret path. Are you sure?'
        : 'Descend to the next depth without extracting. Are you sure?';
      action = 'continue';
    }
  } else {
    return;
  }

  exitConfirmPending = { action: action, label: title, detail: detail, zoneId: zone.id };
  const el = document.getElementById('msg');
  el.style.display = 'flex';
  el.innerHTML =
    '<div style="text-align:center;max-width:420px">' +
    '<div style="font-size:18px;letter-spacing:2px;color:#fff">' + title + '</div>' +
    '<div style="font-size:12px;opacity:.85;margin:12px 0 16px;line-height:1.5">' + detail + '</div>' +
    '<button data-act="confirm-exit" style="background:#fff;color:#111">CONFIRM</button>' +
    '<button data-act="cancel-exit" style="margin-left:8px">CANCEL</button>' +
    '</div>';
}

function cancelExitConfirm() {
  exitConfirmPending = null;
  const el = document.getElementById('msg');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  exitZoneCooldown = 40;
}

function confirmExitAction() {
  if (!exitConfirmPending) return;
  const act = exitConfirmPending.action;
  exitConfirmPending = null;
  const el = document.getElementById('msg');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }

  if (act.indexOf('choice:') === 0) {
    const choiceId = act.slice(7);
    recordRunChoice(choiceId);
    const room = rooms[curKey];
    if (room && room.type === 'exithub') room.choiceMade = true;
    if (typeof flashToast === 'function') flashToast('CHOICE LOCKED');
    const depth = (typeof currentDepth === 'function') ? currentDepth() : 1;
    const opt = getExitChoiceOption(choiceId, depth);
    if (opt && opt.dialogue && opt.dialogue.length) startDialogue(opt.dialogue);
    exitZoneCooldown = 30;
  } else if (act === 'exfil') {
    if (typeof flashToast === 'function') flashToast('EXFIL');
    if (typeof extractAndEndRun === 'function') extractAndEndRun();
  } else if (act === 'continue') {
    if (typeof flashToast === 'function') flashToast('CONTINUING');
    doContinueFromExitHub();
  }
}

function recordRunChoice(choiceId) {
  if (typeof runBag === 'undefined') return;
  if (!runBag.choices) runBag.choices = [];
  const depth = (typeof currentDepth === 'function') ? currentDepth() : 1;
  runBag.choices.push({ depth: depth, id: choiceId, t: Date.now() });
}

function doContinueFromExitHub() {
  const depth = (typeof currentDepth === 'function') ? currentDepth() : 1;
  if (depth >= FINAL_NORMAL_DEPTH && typeof runBag !== 'undefined') {
    runBag.secretPath = true;
  }
  if (typeof continueMissionDeeper === 'function') continueMissionDeeper();
  else if (typeof continueDeeper === 'function') {
    continueDeeper();
    if (typeof startMission === 'function') startMission({ continueRun: true });
  }
}

/** Walk onto pads in the exit hub. Elevators fire immediately; choices ask once. */
function updateExitHubZones(room) {
  if (!room || room.type !== 'exithub' || gameOver || exitConfirmPending) return;
  if (dialogueActive) return;
  if (exitZoneCooldown > 0) { exitZoneCooldown--; return; }
  if (!bossDefeatedThisDepth) return;

  const zones = room.zones || [];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!pointInZone(player.x, player.y, z)) continue;

    if (z.kind === 'elevator') {
      if (room.choiceMode && !room.choiceMade) {
        if (typeof flashToast === 'function') flashToast('MAKE A CHOICE FIRST');
        exitZoneCooldown = 45;
        return;
      }
      exitZoneCooldown = 50;
      showExitConfirm(z);
      return;
    }

    if (z.kind === 'choice') {
      if (room.choiceMade) continue;
      showExitConfirm(z);
      return;
    }
  }
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
    puzzle: 'PUZZLE ROOM',
    bosshall: 'BOSS HALL', hallway: 'HALLWAY', normal: 'CORRIDOR', relic: 'RELIC VAULT',
    exithub: (r.choiceMode ? 'DECISION CHAMBER' : 'ELEVATOR BAY')
  };
  const depthTag = (typeof depthLabel === 'function') ? (' · ' + depthLabel()) : '';
  document.getElementById('roomLabel').textContent = (labels[r.type] || 'CORRIDOR') + depthTag;
  const ks = document.getElementById('keyStatus');
  if (player.hasBossKey) ks.classList.add('have'); else ks.classList.remove('have');
}

// ════════════════════════════════════════
// DIALOGUE / STORY
// ════════════════════════════════════════
// Usage:
//   startDialogue([
//     { speaker: 'COMMAND', text: 'Drop in 30 seconds.' },
//     { speaker: 'YOU', text: 'Copy.' }
//   ]);
// Or play a named story once:
//   playStory('mission_start');
//
let dialogueActive = false;
let dialogueQueue = [];
let dialogueTyping = false;
let dialogueCharIndex = 0;
let dialogueFullText = '';
let dialogueTypeTimer = 0;
const DIALOGUE_TYPE_SPEED = 2; // frames per character (higher = slower)
const storiesPlayed = new Set();

/**
 * Story content lives in story-data.js (STORY_DATA).
 *   STORY_DATA.levels[depth][trigger] = lines  — exact depth only, no cascade
 * No default fallback: if you didn't write it for that level, nothing plays.
 */
function resolveStoryLines(trigger, depth) {
  const data = (typeof STORY_DATA !== 'undefined') ? STORY_DATA : null;
  if (!data || !data.levels) return null;
  const d = depth != null ? depth
    : (typeof currentDepth === 'function' ? currentDepth()
      : (typeof runBag !== 'undefined' && runBag.depth) || 1);
  const block = data.levels[d] || data.levels[String(d)];
  if (!block) return null;
  const lines = block[trigger];
  return (Array.isArray(lines) && lines.length) ? lines : null;
}

/** Random short dialogue when looting a weapon or relic. */
function playPickupDialogue(kind, itemName) {
  const data = (typeof STORY_DATA !== 'undefined') ? STORY_DATA : null;
  if (!data) return false;
  const pool = kind === 'relic' ? data.pickupRelic : data.pickupWeapon;
  if (!pool || !pool.length) return false;
  const entry = pool[Math.floor(Math.random() * pool.length)];
  if (!entry || !entry.length) return false;
  const name = itemName || 'ITEM';
  const lines = entry.map(function (line) {
    return {
      speaker: line.speaker || '',
      text: String(line.text || '').split('{name}').join(name)
    };
  });
  startDialogue(lines);
  return true;
}

function startDialogue(lines) {
  if (!lines || !lines.length) return;
  if (dialogueActive) {
    // Append if already talking
    dialogueQueue = dialogueQueue.concat(lines);
    return;
  }
  dialogueQueue = lines.slice();
  dialogueActive = true;
  setGameCursor();
  // Close pause menu if it was open so dialogue owns the screen
  const pauseEl = document.getElementById('pauseScreen');
  if (pauseEl) pauseEl.classList.remove('show');
  paused = false;
  showNextDialogueLine();
}

/**
 * Play a named story for the current depth.
 * Once-per-run by default (key includes depth so depth 1 and depth 5 each play once).
 * playStory('mission_start', true) forces replay.
 */
function playStory(id, force) {
  const depth = (typeof currentDepth === 'function') ? currentDepth()
    : (typeof runBag !== 'undefined' && runBag.depth) || 1;
  const playKey = id + '@' + depth;
  if (!force && storiesPlayed.has(playKey)) return false;
  const lines = resolveStoryLines(id, depth);
  if (!lines || !lines.length) return false;
  storiesPlayed.add(playKey);
  startDialogue(lines);
  return true;
}

function showNextDialogueLine() {
  const box = document.getElementById('dialogueBox');
  const speakerEl = document.getElementById('dialogueSpeaker');
  const textEl = document.getElementById('dialogueText');
  if (!box || !speakerEl || !textEl) {
    dialogueActive = false;
    setGameCursor();
    return;
  }

  if (dialogueQueue.length === 0) {
    box.classList.remove('show');
    dialogueActive = false;
    dialogueTyping = false;
    dialogueFullText = '';
    setGameCursor();
    return;
  }

  const line = dialogueQueue.shift();
  speakerEl.textContent = line.speaker || '';
  dialogueFullText = line.text || '';
  dialogueCharIndex = 0;
  dialogueTyping = true;
  dialogueTypeTimer = 0;
  textEl.textContent = '';
  box.classList.add('show');
}

function advanceDialogue() {
  if (!dialogueActive) return;
  const textEl = document.getElementById('dialogueText');
  if (dialogueTyping) {
    // Instantly finish current line
    dialogueTyping = false;
    if (textEl) textEl.textContent = dialogueFullText;
    return;
  }
  showNextDialogueLine();
}

function skipDialogue() {
  if (!dialogueActive) return;
  dialogueQueue = [];
  dialogueTyping = false;
  showNextDialogueLine(); // empties and hides
}

function updateDialogue() {
  if (!dialogueActive || !dialogueTyping) return;
  dialogueTypeTimer++;
  if (dialogueTypeTimer < DIALOGUE_TYPE_SPEED) return;
  dialogueTypeTimer = 0;
  dialogueCharIndex++;
  const textEl = document.getElementById('dialogueText');
  if (textEl) textEl.textContent = dialogueFullText.slice(0, dialogueCharIndex);
  if (dialogueCharIndex >= dialogueFullText.length) {
    dialogueTyping = false;
  }
}

// ════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════
function update() {
  updateDialogue();
  if (gameOver || !started || paused || dialogueActive) return;
  const room = rooms[curKey];
  if (!room) return;
  if (!room.enemies) room.enemies = [];
  if (!room.barrels) room.barrels = [];
  if (!room.doors) room.doors = {};

  // --- delayed boss spawn ---
  if (room.type === 'boss' && !room.bossSpawned && room.bossSpawnTimer >= 0) {
    room.bossSpawnTimer--;
    if (room.bossSpawnTimer <= 0) spawnBoss(room);
  }

  // --- delayed regular-room enemy wake-up ---
  if (room.enemySpawnTimer >= 0) {
    room.enemySpawnTimer--;
    if (room.enemySpawnTimer <= 0) room.enemiesActive = true;
  }

  // --- movement ---
  let mx = 0, my = 0;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  // Virtual joystick (mobile)
  const tm = (typeof window !== 'undefined' && window.__touchMove) ? window.__touchMove : null;
  if (tm && tm.active && (tm.mx || tm.my)) {
    mx += tm.mx;
    my += tm.my;
  }
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
  resolveColumnCollision(player);
  resolveHazardBlockCollision(player);
  resolvePuzzleGateCollision(player);
  if (room.type === 'puzzle') updatePuzzleRoom(room);

  // Auto-reload progress
  // ammo safety — never start a frame with empty pistol mag
  if (started && !gameOver) {
    const _w = currentWeapon();
    if (isPistol(_w) && (player.mag | 0) <= 0) {
      const size = (typeof effectiveMagSize === 'function') ? effectiveMagSize(_w) : 12;
      player.mag = size;
    }
  }
  if (player.reloadTimer > 0) {
    player.reloadTimer--;
    if (player.reloadTimer <= 0) {
      fillMagFromReserve(currentWeapon());
      flashToast('RELOADED');
    }
  }
  // Mobile-only: auto-fire so player doesn't need to hold a button
  if (typeof isCoarsePointer === 'function' && isCoarsePointer() && started && !paused && !gameOver) {
    mouse.down = true;
  }
  if (mouse.down && currentWeapon().auto) tryFire();
  if (mouse.down && !currentWeapon().auto && player.shootCooldown <= 0) tryFire();

  if (player.shootCooldown > 0) player.shootCooldown--;
  if (player.invuln > 0) player.invuln--;
  if (player.hazardCD > 0) player.hazardCD--;
  if (gunAnimTimer > 0) { gunAnimTimer--; if (gunAnimTimer === 0) gunFrame = 0; }
  if (toastTimer > 0) { toastTimer--; if (toastTimer === 0) document.getElementById('toast').classList.remove('show'); }
  if (meleeSwing) { meleeSwing.life--; if (meleeSwing.life <= 0) meleeSwing = null; }
  if (room.type === 'exithub') updateExitHubZones(room);

  // --- hazard tiles ---
  // Every hazard tile is an impassable 'blocking' hole (see

  // --- projectiles ---
  const enemies = room.enemies || [];
  const barrels = room.barrels || [];
  const cols = room.columns || [];
  const hasCols = cols.length > 0;
  const isHall = isHallType(room);
  const isCircle = room.shape === 'circle';
  const circleR = isCircle ? (room.circleR || Math.min(W, H) / 2 - WALL - 8) : 0;
  const circleR2 = circleR * circleR;

  for (let i = playerProjectiles.length - 1; i >= 0; i--) {
    const p = playerProjectiles[i];
    if (!p || p.x == null) {
      playerProjectiles.splice(i, 1);
      continue;
    }
    p.x += p.dx * p.speed;
    p.y += p.dy * p.speed;
    p.life--;
    let dead = p.life <= 0;

    if (!dead) {
      // enemies first
      for (let ei = 0; ei < enemies.length; ei++) {
        const en = enemies[ei];
        if (!en || !en.alive) continue;
        const edx = p.x - en.x, edy = p.y - en.y;
        const hitR = p.r + en.r;
        if (edx * edx + edy * edy < hitR * hitR) {
          en.hp -= p.dmg;
          // 1 spark on hit — death still gets a fuller burst
          spawnParticles(en.x, en.y, p.color, 1);
          if (en.hp <= 0) {
            en.alive = false;
            spawnParticles(en.x, en.y, '#8fe0c9', 10);
            grantKillAmmo(en);
            if (typeof recordKill === 'function') recordKill(en);
            if (en.type === 'boss') triggerVictory();
          }
          if (p.kind === 'explosive') {
            explosions.push({ x: p.x, y: p.y, life: 16, maxLife: 16, maxR: p.splashR || 70 });
            const sr = (p.splashR || 70);
            const sr2 = sr * sr;
            for (let e2i = 0; e2i < enemies.length; e2i++) {
              const e2 = enemies[e2i];
              if (!e2.alive) continue;
              const sdx = e2.x - p.x, sdy = e2.y - p.y;
              if (sdx * sdx + sdy * sdy < (sr + e2.r) * (sr + e2.r)) {
                e2.hp -= p.splashDmg || 3;
                if (e2.hp <= 0) {
                  e2.alive = false;
                  grantKillAmmo(e2);
                  if (typeof recordKill === 'function') recordKill(e2);
                  if (e2.type === 'boss') triggerVictory();
                }
              }
            }
          }
          if (!p.pierce) dead = true;
          break;
        }
      }
    }

    if (!dead) {
      for (let bi = 0; bi < barrels.length; bi++) {
        const b = barrels[bi];
        if (!b.alive) continue;
        const bdx = p.x - b.x, bdy = p.y - b.y;
        const br = p.r + b.r;
        if (bdx * bdx + bdy * bdy < br * br) {
          explodeBarrel(b);
          dead = true;
          break;
        }
      }
    }

    if (!dead) {
      if (p.x < WALL || p.x > W - WALL || p.y < WALL || p.y > H - WALL) dead = true;
      else if (isHall && !inHallCorridor(p.x, p.y, room)) dead = true;
      else if (isCircle) {
        const cdx = p.x - W / 2, cdy = p.y - H / 2;
        if (cdx * cdx + cdy * cdy > circleR2) dead = true;
      }
      if (!dead && hasCols) {
        for (let ci = 0; ci < cols.length; ci++) {
          if (circleHitsColumn(p.x, p.y, p.r, cols[ci])) { dead = true; break; }
        }
      }
      if (!dead && room.type === 'puzzle') {
        const gates = room.puzzleGates || [];
        for (let gi = 0; gi < gates.length; gi++) {
          const g = gates[gi];
          if (g.open) continue;
          if (p.x + p.r > g.x && p.x - p.r < g.x + g.w && p.y + p.r > g.y && p.y - p.r < g.y + g.h) {
            dead = true; break;
          }
        }
      }
    }

    if (dead) {
      const last = playerProjectiles.length - 1;
      if (i !== last) playerProjectiles[i] = playerProjectiles[last];
      playerProjectiles.pop();
    }
  }

  // --- enemy AI ---
  const moveEnemyAvoidHazards = (en, mx, my) => {
    const nx = en.x + mx, ny = en.y + my;
    if (!pointOnHazard(room, nx, ny, en.r)) {
      en.x = nx; en.y = ny;
    } else if (!pointOnHazard(room, nx, en.y, en.r)) {
      en.x = nx;
    } else if (!pointOnHazard(room, en.x, ny, en.r)) {
      en.y = ny;
    } else {
      // Slide perpendicular to try to get around the hazard
      const len = Math.hypot(mx, my) || 1;
      const px = -my / len * en.speed, py = mx / len * en.speed;
      if (!pointOnHazard(room, en.x + px, en.y + py, en.r)) {
        en.x += px; en.y += py;
      } else if (!pointOnHazard(room, en.x - px, en.y - py, en.r)) {
        en.x -= px; en.y -= py;
      }
    }
    if (pointOnHazard(room, en.x, en.y, en.r)) {
      const cx = W / 2 - en.x, cy = H / 2 - en.y;
      const cl = Math.hypot(cx, cy) || 1;
      const sx = en.x + (cx / cl) * en.speed;
      const sy = en.y + (cy / cl) * en.speed;
      if (!pointOnHazard(room, sx, sy, en.r)) { en.x = sx; en.y = sy; }
    }
  };

  const enemiesAwake = room.enemiesActive !== false;
  (room.enemies || []).forEach(en => {
    if (!en) return;
    if (!en.alive) return;
    const dx = player.x - en.x, dy = player.y - en.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (!enemiesAwake) {
      if (dist < en.r + player.r && player.invuln <= 0) damagePlayer(1);
      return;
    }
    if (en.type === 'slime') {
      moveEnemyAvoidHazards(en, (dx / dist) * en.speed, (dy / dist) * en.speed);
      checkWalls(en);
    }
    if (en.type === 'shooter') {
      // Kite: keep mid-range and strafe
      const ideal = 180;
      let mx = 0, my = 0;
      const edx = dx / dist, edy = dy / dist;
      if (dist < ideal - 40) { mx = -edx * en.speed; my = -edy * en.speed; }
      else if (dist > ideal + 60) { mx = edx * en.speed * 0.7; my = edy * en.speed * 0.7; }
      else {
        const sx = -edy * en.speed * 0.85 * (en.strafeDir || 1);
        const sy = edx * en.speed * 0.85 * (en.strafeDir || 1);
        mx = sx; my = sy;
        if (Math.random() < 0.01) en.strafeDir = -(en.strafeDir || 1);
      }
      moveEnemyAvoidHazards(en, mx, my);
      checkWalls(en);
      en.cooldown = (en.cooldown || 0) - 1;
      if (en.cooldown <= 0 && dist < 340 && enemyProjectiles.length < (typeof MAX_ENEMY_PROJS !== 'undefined' ? MAX_ENEMY_PROJS : 48)) {
        en.cooldown = 50;
        enemyProjectiles.push({
          x: en.x, y: en.y, dx: edx, dy: edy,
          speed: 2.1, r: 5, life: 120,
          rotIdx: typeof projRotIndex === 'function' ? projRotIndex(edx, edy) : 0,
          size: Math.max(33, 5 * 9)
        });
        if (typeof playSfx === 'function') playSfx('enemyShot');
      }
    }
    if (en.type === 'charger' || en.type === 'tank') {
      // Drones: ignore walls/columns; soft clamp to room margin only
      if (en.wakeTimer > 0) {
        en.wakeTimer--;
        // hover drift while waking
        en.x += Math.sin(Date.now() / 200 + en.x) * 0.3;
        en.y += Math.cos(Date.now() / 240 + en.y) * 0.3;
      } else {
        en.dashTimer = (en.dashTimer || 0) - 1;
        if (en.type === 'charger') {
          if (en.dashTimer <= 0 && dist < 280) {
            en.dashTimer = 100;
            en._dashDx = dx / dist; en._dashDy = dy / dist;
            en._dashLeft = 20;
          }
          if ((en._dashLeft || 0) > 0) {
            en._dashLeft--;
            en.x += (en._dashDx || 0) * en.speed * 2.2;
            en.y += (en._dashDy || 0) * en.speed * 2.2;
          } else {
            en.x += (dx / dist) * en.speed * 0.55;
            en.y += (dy / dist) * en.speed * 0.55;
          }
        } else {
          en.x += (dx / dist) * en.speed;
          en.y += (dy / dist) * en.speed;
        }
      }
      // Soft room bounds only (can pass columns/walls)
      const m = 8;
      if (en.x < m) en.x = m;
      if (en.x > W - m) en.x = W - m;
      if (en.y < m) en.y = m;
      if (en.y > H - m) en.y = H - m;
    }
    if (en.type === 'spitter') {
      // Slow creep + lobbed slow projectiles
      if (dist > 100) moveEnemyAvoidHazards(en, (dx / dist) * en.speed, (dy / dist) * en.speed);
      checkWalls(en);
      en.cooldown = (en.cooldown || 0) - 1;
      if (en.cooldown <= 0 && dist < 280 && enemyProjectiles.length < (typeof MAX_ENEMY_PROJS !== 'undefined' ? MAX_ENEMY_PROJS : 48)) {
        en.cooldown = 70;
        const edx = dx / dist, edy = dy / dist;
        enemyProjectiles.push({
          x: en.x, y: en.y, dx: edx, dy: edy,
          speed: 1.5, r: 7, life: 140,
          rotIdx: typeof projRotIndex === 'function' ? projRotIndex(edx, edy) : 0,
          size: Math.max(36, 7 * 8)
        });
        if (typeof playSfx === 'function') playSfx('enemyShot');
      }
    }
    if (en.type === 'boss') {
      en.modeTimer = (en.modeTimer || 0) - 1;
      en.shootTimer = (en.shootTimer || 0) - 1;
      en.burstTimer = (en.burstTimer || 0) - 1;
      en.dashTimer = (en.dashTimer || 0) - 1;
      en.spawnTimer = (en.spawnTimer || 0) - 1;
      if (!en.enraged && en.hp < en.maxHp * 0.4) {
        en.enraged = true;
        en.phase = 2;
        flashToast('BOSS ENRAGED');
      }
      const bt = en.bossType || 1;
      const spd = en.enraged ? en.speed * 1.35 : en.speed;
      const maxP = (typeof MAX_ENEMY_PROJS !== 'undefined' ? MAX_ENEMY_PROJS : 48);

      function bossShoot(n, spread, speed, life) {
        if (enemyProjectiles.length >= maxP) return;
        const shots = n || 1;
        const edx = dx / dist, edy = dy / dist;
        for (let s = 0; s < shots; s++) {
          const spr = (s - (shots - 1) / 2) * (spread || 0.18);
          const c = Math.cos(spr), sn = Math.sin(spr);
          const px = edx * c - edy * sn, py = edx * sn + edy * c;
          enemyProjectiles.push({
            x: en.x, y: en.y, dx: px, dy: py,
            speed: speed || (en.enraged ? 3.0 : 2.6), r: 5, life: life || 130,
            rotIdx: typeof projRotIndex === 'function' ? projRotIndex(px, py) : 0,
            size: Math.max(33, 5 * 9)
          });
        }
        if (typeof playSfx === 'function') playSfx('enemyShot');
      }

      function spawnMinion(kind) {
        const ang = Math.random() * Math.PI * 2;
        const mx = en.x + Math.cos(ang) * 50;
        const my = en.y + Math.sin(ang) * 50;
        const isShooter = kind === 'shooter';
        room.enemies.push({
          x: mx, y: my,
          hp: isShooter ? 3 : 2, maxHp: isShooter ? 3 : 2,
          r: isShooter ? 14 : 16,
          speed: isShooter ? 0.55 : 1.4,
          type: isShooter ? 'shooter' : 'slime',
          alive: true, cooldown: 20, shootTimer: 40
        });
      }

      // --- type behaviors ---
      if (bt === 2) {
        // Sitting nest: stationary, spawns moontins, shoots
        if (en.spawnTimer <= 0) {
          const aliveMin = room.enemies.filter(e => e && e.alive && e.type !== 'boss').length;
          if (aliveMin < (en.enraged ? 6 : 4)) {
            spawnMinion(Math.random() < 0.35 ? 'shooter' : 'slime');
            spawnMinion('slime');
          }
          en.spawnTimer = en.enraged ? 70 : 110;
        }
        if (en.shootTimer <= 0 && dist < 400) {
          bossShoot(en.enraged ? 5 : 3, 0.22, 2.3, 140);
          en.shootTimer = en.enraged ? 32 : 48;
        }
      } else if (bt === 3) {
        // Pack leader: chase + spawn
        if (en.modeTimer <= 0) {
          en.mode = en.mode === 'chase' ? 'flank' : 'chase';
          en.modeTimer = 60 + Math.random() * 40;
        }
        let mx = (dx / dist) * spd, my = (dy / dist) * spd;
        if (en.mode === 'flank') {
          const ox = -dy / dist * en.flankSide, oy = dx / dist * en.flankSide;
          const tx = player.x + ox * 100, ty = player.y + oy * 100;
          const fdx = tx - en.x, fdy = ty - en.y, fd = Math.hypot(fdx, fdy) || 1;
          mx = (fdx / fd) * spd; my = (fdy / fd) * spd;
        }
        moveEnemyAvoidHazards(en, mx, my); checkWalls(en);
        if (en.spawnTimer <= 0) {
          const aliveMin = room.enemies.filter(e => e && e.alive && e.type !== 'boss').length;
          if (aliveMin < 3) spawnMinion('slime');
          en.spawnTimer = en.enraged ? 80 : 130;
        }
        if (en.shootTimer <= 0 && dist < 320) {
          bossShoot(1, 0, 2.7, 120);
          en.shootTimer = 36;
        }
      } else if (bt === 4) {
        // Blinker: dash/teleport twist
        if (en.dashTimer <= 0) {
          const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.2;
          en.x = Math.max(WALL + 40, Math.min(W - WALL - 40, player.x + Math.cos(ang) * 140));
          en.y = Math.max(WALL + 40, Math.min(H - WALL - 40, player.y + Math.sin(ang) * 140));
          resolveColumnCollision(en);
          spawnParticles(en.x, en.y, '#9fd8ff', 12);
          bossShoot(3, 0.25, 2.8, 110);
          en.dashTimer = en.enraged ? 55 : 85;
        } else {
          const mx = (dx / dist) * spd * 0.6, my = (dy / dist) * spd * 0.6;
          moveEnemyAvoidHazards(en, mx, my); checkWalls(en);
        }
        if (en.shootTimer <= 0 && dist < 300) {
          bossShoot(1, 0, 3.0, 100);
          en.shootTimer = 28;
        }
      } else if (bt === 5) {
        // Orbiter: circle player, radial shots
        en.orbitAng = (en.orbitAng || 0) + (en.enraged ? 0.045 : 0.03);
        const rad = 130;
        const tx = player.x + Math.cos(en.orbitAng) * rad;
        const ty = player.y + Math.sin(en.orbitAng) * rad;
        const fdx = tx - en.x, fdy = ty - en.y, fd = Math.hypot(fdx, fdy) || 1;
        moveEnemyAvoidHazards(en, (fdx / fd) * spd * 1.2, (fdy / fd) * spd * 1.2);
        checkWalls(en);
        if (en.shootTimer <= 0) {
          for (let a = 0; a < 8; a++) {
            if (enemyProjectiles.length >= maxP) break;
            const ang = a * Math.PI / 4 + en.orbitAng;
            const px = Math.cos(ang), py = Math.sin(ang);
            enemyProjectiles.push({
              x: en.x, y: en.y, dx: px, dy: py, speed: 2.1, r: 5, life: 120,
              rotIdx: typeof projRotIndex === 'function' ? projRotIndex(px, py) : 0,
              size: Math.max(33, 5 * 9)
            });
          }
          if (typeof playSfx === 'function') playSfx('enemyShot');
          en.shootTimer = en.enraged ? 40 : 60;
        }
      } else if (bt === 6) {
        // Tank: slow, heavy HP, big volleys
        const mx = (dx / dist) * spd, my = (dy / dist) * spd;
        moveEnemyAvoidHazards(en, mx, my); checkWalls(en);
        if (en.shootTimer <= 0 && dist < 380) {
          bossShoot(en.enraged ? 7 : 5, 0.14, 2.2, 150);
          en.shootTimer = en.enraged ? 45 : 60;
        }
        if (en.burstTimer <= 0 && dist < 300) {
          for (let a = -3; a <= 3; a++) {
            if (enemyProjectiles.length >= maxP) break;
            const ang = Math.atan2(dy, dx) + a * 0.18;
            const px = Math.cos(ang), py = Math.sin(ang);
            enemyProjectiles.push({
              x: en.x, y: en.y, dx: px, dy: py, speed: 1.9, r: 6, life: 140,
              rotIdx: typeof projRotIndex === 'function' ? projRotIndex(px, py) : 0,
              size: Math.max(36, 6 * 9)
            });
          }
          en.burstTimer = 130;
          if (typeof playSfx === 'function') playSfx('enemyShot');
        }
      } else if (bt === 7) {
        // Striker: fast glass cannon
        if (en.modeTimer <= 0) {
          en.mode = en.mode === 'chase' ? 'dash' : 'chase';
          en.modeTimer = 40 + Math.random() * 30;
        }
        let mx = (dx / dist) * spd, my = (dy / dist) * spd;
        if (en.mode === 'dash' && dist > 60) { mx *= 2.4; my *= 2.4; }
        moveEnemyAvoidHazards(en, mx, my); checkWalls(en);
        if (en.shootTimer <= 0 && dist < 280) {
          bossShoot(2, 0.12, 3.2, 100);
          en.shootTimer = 22;
        }
      } else if (bt === 8) {
        // Overseer: spawn + flank
        if (en.modeTimer <= 0) {
          en.flankSide = Math.random() < 0.5 ? 1 : -1;
          en.modeTimer = 50;
        }
        const ox = -dy / dist * en.flankSide, oy = dx / dist * en.flankSide;
        const tx = player.x + ox * 120, ty = player.y + oy * 120;
        const fdx = tx - en.x, fdy = ty - en.y, fd = Math.hypot(fdx, fdy) || 1;
        moveEnemyAvoidHazards(en, (fdx / fd) * spd, (fdy / fd) * spd);
        checkWalls(en);
        if (en.spawnTimer <= 0) {
          const aliveMin = room.enemies.filter(e => e && e.alive && e.type !== 'boss').length;
          if (aliveMin < 5) {
            spawnMinion('shooter');
            spawnMinion('slime');
          }
          en.spawnTimer = en.enraged ? 75 : 110;
        }
        if (en.shootTimer <= 0 && dist < 340) {
          bossShoot(3, 0.2, 2.5, 125);
          en.shootTimer = 34;
        }
      } else if (bt === 9) {
        // Apex: multi-phase everything
        if (en.modeTimer <= 0) {
          const modes = ['chase', 'flank', 'shoot', 'blink'];
          en.mode = modes[Math.floor(Math.random() * modes.length)];
          en.modeTimer = en.enraged ? 35 : 55;
          if (en.mode === 'flank') en.flankSide = Math.random() < 0.5 ? 1 : -1;
        }
        if (en.mode === 'blink' && en.dashTimer <= 0) {
          const ang = Math.random() * Math.PI * 2;
          en.x = Math.max(WALL + 40, Math.min(W - WALL - 40, player.x + Math.cos(ang) * 160));
          en.y = Math.max(WALL + 40, Math.min(H - WALL - 40, player.y + Math.sin(ang) * 160));
          resolveColumnCollision(en);
          bossShoot(5, 0.28, 2.9, 115);
          en.dashTimer = 70;
        } else {
          let mx = (dx / dist) * spd, my = (dy / dist) * spd;
          if (en.mode === 'flank') {
            const ox = -dy / dist * en.flankSide, oy = dx / dist * en.flankSide;
            const tx = player.x + ox * 110, ty = player.y + oy * 110;
            const fdx = tx - en.x, fdy = ty - en.y, fd = Math.hypot(fdx, fdy) || 1;
            mx = (fdx / fd) * spd; my = (fdy / fd) * spd;
          }
          if (en.dashTimer <= 0 && dist > 90 && dist < 260) {
            mx *= 2.6; my *= 2.6; en.dashTimer = 100;
          }
          moveEnemyAvoidHazards(en, mx, my); checkWalls(en);
        }
        if (en.spawnTimer <= 0) {
          const aliveMin = room.enemies.filter(e => e && e.alive && e.type !== 'boss').length;
          if (aliveMin < 4) spawnMinion(Math.random() < 0.5 ? 'shooter' : 'slime');
          en.spawnTimer = 90;
        }
        if (en.shootTimer <= 0 && dist < 360) {
          bossShoot(en.mode === 'shoot' || en.enraged ? 4 : 2, 0.16, 2.8, 130);
          en.shootTimer = en.enraged ? 24 : 34;
        }
      } else {
        // Type 1 default mover: chase / flank / shoot
        if (en.modeTimer <= 0) {
          if (en.mode === 'chase') en.mode = 'flank';
          else if (en.mode === 'flank') en.mode = 'shoot';
          else en.mode = 'chase';
          en.modeTimer = en.enraged ? (50 + Math.random() * 40) : (70 + Math.random() * 50);
          if (en.mode === 'flank') en.flankSide = Math.random() < 0.5 ? 1 : -1;
        }
        if (en.mode === 'chase' || en.mode === 'flank') {
          let mx, my;
          if (en.mode === 'flank') {
            const ox = -dy / dist * en.flankSide, oy = dx / dist * en.flankSide;
            const tx = player.x + ox * 110, ty = player.y + oy * 110;
            const fdx = tx - en.x, fdy = ty - en.y, fd = Math.hypot(fdx, fdy) || 1;
            mx = (fdx / fd) * spd; my = (fdy / fd) * spd;
          } else {
            mx = (dx / dist) * spd; my = (dy / dist) * spd;
          }
          if (en.dashTimer <= 0 && dist > 80 && dist < 280) {
            mx *= 2.8; my *= 2.8; en.dashTimer = en.enraged ? 90 : 140;
          }
          moveEnemyAvoidHazards(en, mx, my); checkWalls(en);
        }
        if (en.shootTimer <= 0 && dist < 360 && enemyProjectiles.length < maxP) {
          bossShoot((en.mode === 'shoot' || en.enraged) ? 3 : 1, 0.18, en.enraged ? 3.0 : 2.6, 130);
          en.shootTimer = en.enraged ? 28 : 38;
        }
        if (en.burstTimer <= 0 && dist < 300 && enemyProjectiles.length < maxP - 4) {
          for (let a = -2; a <= 2; a++) {
            const ang = Math.atan2(dy, dx) + a * 0.22;
            const px = Math.cos(ang), py = Math.sin(ang);
            enemyProjectiles.push({
              x: en.x, y: en.y, dx: px, dy: py, speed: 2.4, r: 5, life: 130,
              rotIdx: typeof projRotIndex === 'function' ? projRotIndex(px, py) : 0,
              size: Math.max(33, 5 * 9)
            });
          }
          en.burstTimer = en.enraged ? 100 : 150;
          if (typeof playSfx === 'function') playSfx('enemyShot');
        }
      }
    }
    if (dist < en.r + player.r && player.invuln <= 0) damagePlayer(1);
  });

  const bossPending = room.type === 'boss' && !room.bossSpawned;
  if (!room.cleared && !bossPending && enemies.length > 0 && enemies.every(e => e && !e.alive)) {
    room.cleared = true;
    flashToast('ROOM CLEAR');
  }

  // --- enemy projectiles ---
  const playerHitR = player.r;
  const playerHitR2 = (5 + playerHitR) * (5 + playerHitR); // enemy proj r is 5
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    if (!p || p.x == null) {
      enemyProjectiles.splice(i, 1);
      continue;
    }
    p.x += p.dx * p.speed;
    p.y += p.dy * p.speed;
    p.life--;
    let dead = p.life <= 0 || p.x < WALL || p.x > W - WALL || p.y < WALL || p.y > H - WALL;
    if (!dead && isHall && !inHallCorridor(p.x, p.y, room)) dead = true;
    if (!dead && hasCols) {
      for (let ci = 0; ci < cols.length; ci++) {
        if (circleHitsColumn(p.x, p.y, p.r, cols[ci])) { dead = true; break; }
      }
    }
    // Shots cannot pass kill tiles / solid hazards
    if (!dead && pointOnHazard(room, p.x, p.y, p.r)) dead = true;
    // Closed puzzle gates block shots
    if (!dead && room.type === 'puzzle') {
      const gates = room.puzzleGates || [];
      for (let gi = 0; gi < gates.length; gi++) {
        const g = gates[gi];
        if (g.open) continue;
        if (p.x + p.r > g.x && p.x - p.r < g.x + g.w && p.y + p.r > g.y && p.y - p.r < g.y + g.h) {
          dead = true; break;
        }
      }
    }
    if (!dead && player.invuln <= 0) {
      const pdx = p.x - player.x, pdy = p.y - player.y;
      const pr = p.r + playerHitR;
      if (pdx * pdx + pdy * pdy < pr * pr) {
        damagePlayer(1);
        dead = true;
      }
    }
    if (dead) {
      const last = enemyProjectiles.length - 1;
      if (i !== last) enemyProjectiles[i] = enemyProjectiles[last];
      enemyProjectiles.pop();
    }
  }

  // --- pickups ---
  const pickRMult = (typeof relicPickupRadiusMult === 'function') ? relicPickupRadiusMult() : 1;
  (room.pickups || []).forEach(pk => {
    if (pk.taken) return;
    if (Math.hypot(player.x - pk.x, player.y - pk.y) < (player.r + pk.r) * pickRMult) {
      pk.taken = true;
      if (typeof playSfx === 'function') playSfx('pickup');
      if (pk.kind === 'health') {
        player.hp = Math.min(player.maxHp, player.hp + HEALTH_PICKUP_HEAL);
        flashToast('+' + HEALTH_PICKUP_HEAL + ' HP');
      } else {
        const gained = grantAmmoPickup();
        flashToast(gained > 0 ? ('+' + gained + ' AMMO') : 'AMMO FULL');
      }
    }
  });

  // --- key ---
  if (room.keyItem && !room.keyItem.taken) {
    const k = room.keyItem;
    if (Math.hypot(player.x - k.x, player.y - k.y) < (player.r + k.r) * pickRMult) {
      k.taken = true;
      player.hasBossKey = true;
      if (typeof playSfx === 'function') playSfx('pickup');
      flashToast('BOSS KEY ACQUIRED');
      if (typeof playStory === 'function') {
        const played = playStory('boss_key');
        if (!played) {
          startDialogue([{ speaker: 'SERENITY', text: 'Boss access key acquired. Proceed when ready.' }]);
        }
      }
      updateRoomLabel();
    }
  }

  // --- chests ---
  (room.chests || []).forEach(c => {
    if (c.open) return;
    if (Math.hypot(player.x - c.x, player.y - c.y) < (player.r + c.r) * pickRMult) {
      c.open = true;
      unlockedWeapons.add(c.weaponId);
      const g = ARSENAL_MAP[c.weaponId];
      // Guarantee the grant covers this weapon's own magazine so picking it
      // up never has to cannibalize your existing reserve just to load itself.
      const magNeed = (typeof effectiveMagSize === 'function') ? effectiveMagSize(g) : ((g && g.magSize) || 12);
      player.ammo = (player.ammo | 0) + Math.max(gunAmmoGrant(c.weaponId), magNeed);
      if (typeof findWeaponThisRun === 'function') findWeaponThisRun(c.weaponId);
      if (typeof playSfx === 'function') playSfx('pickup');
      flashToast('GOT ' + g.name + ' · EXFIL TO KEEP');
      weaponIndex = ARSENAL.findIndex(w => w.id === c.weaponId);
      setWeapon(weaponIndex, { force: true, quiet: true });
      // Story on open only (shiny + keep-reward). Fallback if no depth-specific lines.
      if (typeof playStory === 'function') {
        const played = playStory('open_chest');
        if (!played) {
          startDialogue([
            { speaker: 'YOU', text: 'Ooh, shiny.' },
            { speaker: 'SERENITY', text: 'Survive this level to keep your rewards.' }
          ]);
        }
      }
    }
  });

  // --- relics (permanent upgrades, no points) ---
  if (room.relicItem && !room.relicItem.taken) {
    const ri = room.relicItem;
    if (Math.hypot(player.x - ri.x, player.y - ri.y) < (player.r + ri.r) * pickRMult) {
      ri.taken = true;
      if (typeof playSfx === 'function') playSfx('pickup');
      const prefer = ri.relicId || null;
      const def = (typeof findRelicThisRun === 'function') ? findRelicThisRun(prefer)
        : (typeof grantRelic === 'function') ? grantRelic(prefer) : null;
      if (def) {
        flashToast('RELIC · ' + def.name + ' · EXFIL TO KEEP');
        player.hp = Math.min(player.maxHp, player.hp + 2);
        if (typeof playPickupDialogue === 'function') playPickupDialogue('relic', def.name);
      } else {
        const gained = grantAmmoPickup();
        flashToast(gained > 0 ? ('RELICS MAXED · +' + gained + ' AMMO') : 'RELICS MAXED · AMMO FULL');
      }
    }
  }

  // --- particles ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.dx; pt.y += pt.dy; pt.life--;
    if (pt.life <= 0) {
      const last = particles.length - 1;
      if (i !== last) particles[i] = particles[last];
      particles.pop();
    }
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].life--;
    if (explosions[i].life <= 0) {
      const last = explosions.length - 1;
      if (i !== last) explosions[i] = explosions[last];
      explosions.pop();
    }
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
    const _saved = ctx;
    // Use a proxy: call internal painter that takes target
    _paintStaticRoom(bctx, room);
    _roomCache.key = curKey;
    ctx.drawImage(_roomCache.canvas, 0, 0);
  }
  _drawRoomDynamicStart(room);
}
function _drawRoomDynamicStart(room) {
  const floorName = room.floorTile || 'floor1';
  const wallName = room.wallTile || 'wall1';
  const hall = isHallType(room);
  // static floor/walls/hazards/columns come from cache
    // --- doors ---
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
      const isExit = dest && dest.type === 'exithub';
      ctx.fillStyle = isExit ? '#8fe0c9' : '#d8b34a';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      const label = isExit ? 'EXIT SEALED' : 'LOCKED';
      if (dir === 'n') ctx.fillText(label, W / 2, 15);
      if (dir === 's') ctx.fillText(label, W / 2, H - 8);
      if (dir === 'w') ctx.fillText(label, 12, H / 2);
      if (dir === 'e') ctx.fillText(label, W - 12, H / 2);
    } else if (dest && dest.type === 'exithub' && bossDefeatedThisDepth) {
      ctx.fillStyle = '#8fe0c9';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      if (dir === 'n') ctx.fillText('EXIT', W / 2, 15);
      if (dir === 's') ctx.fillText('EXIT', W / 2, H - 8);
      if (dir === 'w') ctx.fillText('EXIT', 12, H / 2);
      if (dir === 'e') ctx.fillText('EXIT', W - 12, H / 2);
    }
  };
  for (const d of ['n', 's', 'e', 'w']) drawDoor(d, room.doors[d]);

  // --- exit hub pads ---
  if (room.type === 'exithub' && room.zones) {
    drawExitHubZones(room);
  }
  if (room.type === 'puzzle') drawPuzzleRoom(room);

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

  if (room.relicItem && !room.relicItem.taken) {
    const ri = room.relicItem;
    if (!ri.relicId && typeof RELIC_DEFS !== 'undefined' && RELIC_DEFS.length) {
      ri.relicId = RELIC_DEFS[Math.floor(Math.random() * RELIC_DEFS.length)].id;
    }
    const rid = ri.relicId;
    const pulse = 1 + 0.08 * Math.sin(Date.now() / 200);
    ctx.save();
    ctx.shadowColor = '#f4c430';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(244, 192, 48, 0.2)';
    ctx.beginPath();
    ctx.arc(ri.x, ri.y, 20 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    const sz = 40 * pulse;
    let drawn = false;
    if (rid && typeof drawRelicIcon === 'function') {
      drawn = drawRelicIcon(rid, ri.x, ri.y, sz);
    }
    if (!drawn && rid && typeof RELIC_IMAGES !== 'undefined' && RELIC_IMAGES[rid]) {
      const img = RELIC_IMAGES[rid];
      if (img.complete && img.naturalWidth > 0) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, ri.x - sz / 2, ri.y - sz / 2, sz, sz);
        drawn = true;
      }
    }
    if (!drawn) {
      // Still loading — empty glow only, never letter "R"
      ctx.strokeStyle = 'rgba(244, 200, 80, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ri.x, ri.y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
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

function drawExitHubZones(room) {
  const zones = room.zones || [];
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 280);
  const t = Date.now() / 1000;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const elevLocked = z.kind === 'elevator' && room.choiceMode && !room.choiceMade;
    const choiceDone = z.kind === 'choice' && room.choiceMade;
    const hw = z.w / 2, hh = z.h / 2;
    const left = Math.round(z.x - hw), top = Math.round(z.y - hh);
    const ww = Math.round(z.w), hh2 = Math.round(z.h);
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // Outer glow ring
    if (!elevLocked && !choiceDone) {
      ctx.globalAlpha = 0.25 + 0.2 * pulse;
      ctx.strokeStyle = z.color || '#fff';
      ctx.lineWidth = 4;
      ctx.strokeRect(left - 4, top - 4, ww + 8, hh2 + 8);
    }

    // Dark plate background
    ctx.globalAlpha = elevLocked || choiceDone ? 0.4 : 0.92;
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(left, top, ww, hh2);

    // Inner accent fill (gradient strip)
    ctx.globalAlpha = elevLocked || choiceDone ? 0.25 : (0.35 + 0.15 * pulse);
    ctx.fillStyle = z.color || '#fff';
    ctx.fillRect(left + 4, top + 4, ww - 8, 10);
    ctx.fillRect(left + 4, top + hh2 - 14, ww - 8, 10);

    // Corner brackets
    ctx.globalAlpha = elevLocked || choiceDone ? 0.4 : 1;
    ctx.strokeStyle = elevLocked ? '#555' : (z.color || '#fff');
    ctx.lineWidth = 2;
    const c = 14;
    // TL
    ctx.beginPath(); ctx.moveTo(left, top + c); ctx.lineTo(left, top); ctx.lineTo(left + c, top); ctx.stroke();
    // TR
    ctx.beginPath(); ctx.moveTo(left + ww - c, top); ctx.lineTo(left + ww, top); ctx.lineTo(left + ww, top + c); ctx.stroke();
    // BL
    ctx.beginPath(); ctx.moveTo(left, top + hh2 - c); ctx.lineTo(left, top + hh2); ctx.lineTo(left + c, top + hh2); ctx.stroke();
    // BR
    ctx.beginPath(); ctx.moveTo(left + ww - c, top + hh2); ctx.lineTo(left + ww, top + hh2); ctx.lineTo(left + ww, top + hh2 - c); ctx.stroke();

    // Elevator sprite or choice diamond
    if (z.kind === 'elevator' && spriteReady('elevator')) {
      ctx.globalAlpha = elevLocked ? 0.35 : 1;
      const es = 48 + (elevLocked ? 0 : 4 * pulse);
      drawSpriteFit(SPRITES.elevator, z.x, z.y - 6, es);
    } else if (!choiceDone) {
      ctx.globalAlpha = elevLocked ? 0.35 : (0.7 + 0.3 * pulse);
      ctx.fillStyle = z.color || '#fff';
      const ix = z.x, iy = z.y - 18;
      const is = 6;
      ctx.beginPath();
      ctx.moveTo(ix, iy - is); ctx.lineTo(ix + is, iy); ctx.lineTo(ix, iy + is); ctx.lineTo(ix - is, iy);
      ctx.closePath(); ctx.fill();
    }

    // Labels — integer coords for crisp text
    ctx.globalAlpha = elevLocked || choiceDone ? 0.45 : 1;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px "Pixelify Sans", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelY = z.kind === 'elevator' ? Math.round(z.y + 28) : Math.round(z.y + 2);
    ctx.fillText(z.label || '', Math.round(z.x), labelY);
    ctx.font = '11px "Pixelify Sans", monospace';
    ctx.fillStyle = elevLocked ? '#888' : '#b8c0d0';
    const sub = elevLocked ? 'LOCKED' : (choiceDone && z.kind === 'choice' ? 'DONE' : (z.sub || ''));
    ctx.fillText(sub, Math.round(z.x), labelY + 16);
    ctx.restore();
  }
  // Room hint
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.textAlign = 'center';
  ctx.font = '12px "Pixelify Sans", monospace';
  if (room.choiceMode && !room.choiceMade) {
    const depth = (typeof currentDepth === 'function') ? currentDepth() : 1;
    const cfg = getExitChoiceConfig(depth);
    if (cfg && cfg.prompt) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const prompt = cfg.prompt.length > 68 ? cfg.prompt.slice(0, 66) + '…' : cfg.prompt;
      ctx.fillText(prompt, Math.round(W / 2), 28);
      ctx.fillStyle = 'rgba(200,210,230,0.55)';
      ctx.fillText('STAND ON A CHOICE · CONFIRM · THEN ELEVATORS', Math.round(W / 2), 46);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('STAND ON A CHOICE · THEN USE AN ELEVATOR', Math.round(W / 2), 36);
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('STAND ON A PAD · CONFIRM TO PROCEED', Math.round(W / 2), 36);
  }
  ctx.restore();
}

function drawEntities() {
  const room = rooms[curKey];
  if (!room) return;

  const animTick = Math.floor(Date.now() / 16);
  (room.enemies || []).forEach(en => {
    if (!en || !en.alive) return;
    const spriteKey = en.type === 'boss' ? en.spriteBase : en.type;
    const maxSz = en.type === 'charger' || en.type === 'tank' ? en.r * 2.4 : en.r * 2.3;
    let drawn = false;
    if (en.type !== 'boss' && typeof drawEnemySprite === 'function') {
      drawn = drawEnemySprite(en.type, en.x, en.y, maxSz, animTick + (en.x | 0));
    }
    if (!drawn && spriteReady(spriteKey)) {
      drawSpriteFit(SPRITES[spriteKey], en.x, en.y, maxSz);
      drawn = true;
    }
    if (!drawn) {
      const colors = { boss: '#c96b4f', shooter: '#7fb0d8', slime: '#8fd8b0', charger: '#ff8a5c', tank: '#a0a8c0', spitter: '#c48cff' };
      ctx.fillStyle = colors[en.type] || '#8fd8b0';
      ctx.beginPath(); ctx.arc(en.x, en.y, en.r, 0, Math.PI * 2); ctx.fill();
    }
    // --- enemy hp bar ---
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(en.x - en.r, en.y - en.r - 10, en.r * 2, 4);
    ctx.fillStyle = '#8fe0c9';
    ctx.fillRect(en.x - en.r, en.y - en.r - 10, en.r * 2 * (en.hp / en.maxHp), 4);
  });

  // --- projectiles (faint red glow under each) ---
  function drawBulletGlow(x, y, r) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(6, r * 2.2), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(10, r * 3.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < playerProjectiles.length; i++) {
    const p = playerProjectiles[i];
    const size = p.size || 42;
    drawBulletGlow(p.x, p.y, p.r || 4);
    if (!drawProjectileFast(p.x, p.y, p.dx, p.dy, size, 1, p.rotIdx)) {
      ctx.fillStyle = p.color || '#eef2f8';
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
  }
  for (let i = 0; i < enemyProjectiles.length; i++) {
    const p = enemyProjectiles[i];
    const size = p.size || 33;
    drawBulletGlow(p.x, p.y, p.r || 5);
    if (!drawProjectileFast(p.x, p.y, p.dx, p.dy, size, 0.85, p.rotIdx)) {
      ctx.fillStyle = '#ff8f6b';
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
  }

  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i];
    const a = Math.max(0, pt.life / (pt.maxLife || 20));
    if (a < 0.02) continue;
    const sz = pt.size || 6;
    if (a < 0.99) ctx.globalAlpha = a;
    if (pt.sprite && typeof spriteReady === 'function' && spriteReady(pt.sprite)) {
      const img = SPRITES[pt.sprite];
      ctx.drawImage(img, pt.x - sz, pt.y - sz, sz * 2, sz * 2);
    } else {
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);
    }
    if (a < 0.99) ctx.globalAlpha = 1;
  }
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

  // Laser Sight relic — line from gun muzzle toward cursor
  if (typeof relicLaserSight === 'function' && relicLaserSight() && wpn.kind !== 'melee') {
    const muzzle = 26;
    const x0 = player.x + Math.cos(ang) * muzzle;
    const y0 = player.y + Math.sin(ang) * muzzle;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(mouse.x, mouse.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // cursor tip
    ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
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

  const w = currentWeapon();
  const magSize = (typeof effectiveMagSize === 'function') ? effectiveMagSize(w)
                : ((w && w.magSize) ? w.magSize : 12);
  const mag = player.mag | 0;
  const reserve = player.ammo | 0;

  const ammo = document.getElementById('ammoVal');
  if (ammo) {
    if (player.reloadTimer > 0) ammo.textContent = 'REL…';
    else ammo.textContent = mag + ' / ' + reserve;
  }

  const iconsEl = document.getElementById('ammoIcons');
  if (iconsEl) {
    const maxIcons = Math.min(typeof AMMO_ICON_MAX !== 'undefined' ? AMMO_ICON_MAX : 12, magSize);
    const perIcon = Math.max(1, Math.ceil(magSize / maxIcons));
    const filled = Math.min(maxIcons, Math.ceil(mag / perIcon));
    const total = maxIcons;
    const src = (SPRITES.ammobullet && SPRITES.ammobullet.ok) ? SPRITES.ammobullet.src
              : ((SPRITES.ammo && SPRITES.ammo.ok) ? SPRITES.ammo.src : '');
    let html = '';
    for (let i = 0; i < total; i++) {
      const cls = i < filled ? '' : ' class="empty"';
      if (src) html += '<img src="' + src + '"' + cls + ' alt="">';
      else html += i < filled ? '▪' : '▫';
    }
    const sig = filled + '/' + total + '/' + src + '/' + (player.reloadTimer > 0 ? 'R' : '');
    if (iconsEl.dataset.sig !== sig) {
      iconsEl.innerHTML = html;
      iconsEl.dataset.sig = sig;
    }
  }

  updateWeaponLabel();
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
    else if (r.type === 'exithub') color = '#8fe0c9';
    else if (r.type === 'hallway') color = '#3a4258';
    else if (r.type === 'key') color = '#d8b34a';
    else if (r.type === 'chest') color = '#9fd8ff';
    else if (r.type === 'relic') color = '#f4c430';
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
    'enemies: ' + (room.enemies || []).filter(e => e && e.alive).length + '/' + (room.enemies || []).length +
      '  barrels: ' + (room.barrels || []).filter(b => b && b.alive).length +
      '  exit: ' + exitHubKey + ' bossDead: ' + bossDefeatedThisDepth,
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
  update();
  drawRoom();
  drawEntities();
  drawDebug();
  drawMinimap();
  drawHearts();
  // Speedrun clock
  if (started && !gameOver && (typeof showSpeedrun === 'undefined' || showSpeedrun)) {
    let ms = runTimerAccum;
    if (runTimerRunning && !paused) ms += performance.now() - runTimerStart;
    const clock = (typeof formatClock === 'function') ? formatClock(ms) : (Math.floor(ms / 1000) + 's');
    ctx.fillStyle = '#8fe0c9';
    ctx.font = '12px "Pixelify Sans", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(clock, W - 10, 18);
  }
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
    ctx.fillText(_fpsValue + ' FPS', W - 10, 34);
  }
  requestAnimationFrame(loop);
}

generateDungeon();
updateRoomLabel();
if (typeof setMinimapEnabled === 'function') setMinimapEnabled(minimapEnabled);
loop();
