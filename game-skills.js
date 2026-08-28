
const RELIC_DEFS = [
  { id: 'harden',    name: 'HARDEN BULLETS', desc: '×2 Weapon Damage',           max: 1, icon: 'relic_harden' },
  { id: 'moonboots', name: 'MOON BOOTS',     desc: '×1.5 Move Speed',            max: 1, icon: 'relic_moonboots' },
  { id: 'pockets',   name: 'DEEP POCKETS',   desc: '×2 Magazine Size',           max: 1, icon: 'relic_pockets' },
  { id: 'gunoil',    name: 'GUN OIL',        desc: '+40% Fire Rate',             max: 1, icon: 'relic_gunoil' },
  { id: 'magnet',    name: 'MAGNET BELT',    desc: '×2 Pickup Radius',           max: 1, icon: 'relic_magnet' },
  { id: 'pierce',    name: 'PIERCING AMMO',  desc: 'Shots pass through enemies', max: 1, icon: 'relic_pierce' },
  { id: 'laser',     name: 'LASER SIGHT',    desc: 'Aim line to cursor',         max: 1, icon: 'relic_laser' }
];

const RELIC_MAP = {};
RELIC_DEFS.forEach(r => { RELIC_MAP[r.id] = r; });

const meta = {
  maxDepth: 1,
  unlockedWeapons: ['pistol'],
  unlockedRelics: [],
  relicRanks: {}               // id -> rank (from repeated extracts)
};

const runBag = {
  active: false,
  depth: 1,
  foundWeapons: [],   // gun ids found this run (not yet extracted)
  foundRelics: [],    // relic ids picked up this run
  loadoutGun: 'pistol',
  loadoutRelic: null,
  runRelicRanks: {},
  choices: [],        // { depth, id } story decisions this run (for depth 16 payoff)
  secretPath: false
};

// ── player stats (best times + lifetime totals) ──────────
const stats = {
  bestDepthTimes: {},   // depth (1-16) -> best clear time in ms (start-room-exit → boss death)
  totalRuns: 0,         // missions deployed (fresh runs, not mid-run continues)
  totalExtracts: 0,     // successful EXFILs
  totalDeaths: 0,
  totalKills: 0,
  totalBossKills: 0
};

function loadStats() {
  try {
    const raw = localStorage.getItem('itm_stats_v1');
    const data = JSON.parse(raw || 'null');
    if (data) {
      stats.bestDepthTimes = (data.bestDepthTimes && typeof data.bestDepthTimes === 'object') ? data.bestDepthTimes : {};
      stats.totalRuns = data.totalRuns | 0;
      stats.totalExtracts = data.totalExtracts | 0;
      stats.totalDeaths = data.totalDeaths | 0;
      stats.totalKills = data.totalKills | 0;
      stats.totalBossKills = data.totalBossKills | 0;
    }
  } catch (e) {}
}

function saveStats() {
  try {
    localStorage.setItem('itm_stats_v1', JSON.stringify({
      bestDepthTimes: stats.bestDepthTimes,
      totalRuns: stats.totalRuns,
      totalExtracts: stats.totalExtracts,
      totalDeaths: stats.totalDeaths,
      totalKills: stats.totalKills,
      totalBossKills: stats.totalBossKills
    }));
  } catch (e) {}
}

function resetStats() {
  stats.bestDepthTimes = {};
  stats.totalRuns = 0;
  stats.totalExtracts = 0;
  stats.totalDeaths = 0;
  stats.totalKills = 0;
  stats.totalBossKills = 0;
  saveStats();
}

/** Record a depth clear time (ms) if it beats the stored best for that depth. */
function recordDepthTime(depth, ms) {
  depth = depth | 0;
  ms = ms | 0;
  if (depth < 1 || !(ms > 0)) return;
  const cur = stats.bestDepthTimes[depth];
  if (cur == null || ms < cur) {
    stats.bestDepthTimes[depth] = ms;
    saveStats();
  }
}

function recordRunStart() {
  stats.totalRuns = (stats.totalRuns | 0) + 1;
  saveStats();
}

function recordExtract() {
  stats.totalExtracts = (stats.totalExtracts | 0) + 1;
  saveStats();
}

function recordDeath() {
  stats.totalDeaths = (stats.totalDeaths | 0) + 1;
  saveStats();
}

function recordKill(en) {
  stats.totalKills = (stats.totalKills | 0) + 1;
  if (en && en.type === 'boss') stats.totalBossKills = (stats.totalBossKills | 0) + 1;
  saveStats();
}

/** mm:ss.cc — shared by the in-game speedrun clock and the stats screen. */
function formatClock(ms) {
  ms = Math.max(0, ms | 0);
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (cs < 10 ? '0' : '') + cs;
}

function renderStatsUI() {
  const summaryEl = document.getElementById('statsSummary');
  const listEl = document.getElementById('statsList');
  if (summaryEl) {
    const cards = [
      ['BEST DEPTH', String(meta.maxDepth || 1)],
      ['RUNS', String(stats.totalRuns | 0)],
      ['EXTRACTS', String(stats.totalExtracts | 0)],
      ['DEATHS', String(stats.totalDeaths | 0)],
      ['KILLS', String(stats.totalKills | 0)],
      ['BOSSES', String(stats.totalBossKills | 0)]
    ];
    summaryEl.innerHTML = cards.map(c =>
      '<div class="stat-card"><div class="stat-card-val">' + c[1] + '</div><div class="stat-card-label">' + c[0] + '</div></div>'
    ).join('');
  }
  if (listEl) {
    let html = '';
    for (let d = 1; d <= 16; d++) {
      const ms = stats.bestDepthTimes[d];
      const band = (typeof depthBand === 'function') ? depthBand(d) : '';
      html += '<div class="time-row' + (ms == null ? ' empty' : '') + '">'
        + '<div class="time-row-depth">DEPTH ' + d + '<span class="time-row-band">' + (band ? band.toUpperCase() : '') + '</span></div>'
        + '<div class="time-row-val">' + (ms == null ? '--:--.--' : formatClock(ms)) + '</div>'
        + '</div>';
    }
    listEl.innerHTML = html;
  }
}

function loadMeta() {
  try {
    const raw = localStorage.getItem('itm_meta_v2');

    const legacy = !raw ? localStorage.getItem('itm_meta') : null;
    const data = JSON.parse(raw || legacy || 'null');
    if (data) {
      meta.maxDepth = Math.max(1, data.maxDepth | 0) || 1;
      if (Array.isArray(data.unlockedWeapons) && data.unlockedWeapons.length) {
        const valid = typeof ARSENAL_MAP !== 'undefined' ? ARSENAL_MAP : null;
        meta.unlockedWeapons = data.unlockedWeapons.filter(id => {
          if (typeof id !== 'string') return false;
          if (!valid) return true;
          return !!valid[id];
        });
      }
      if (!meta.unlockedWeapons.includes('pistol')) meta.unlockedWeapons.unshift('pistol');
      if (Array.isArray(data.unlockedRelics)) {
        meta.unlockedRelics = data.unlockedRelics.filter(id => RELIC_MAP[id]);
      } else if (data.relics && typeof data.relics === 'object') {

        meta.relicRanks = {};
        meta.unlockedRelics = [];
        Object.keys(data.relics).forEach(id => {
          const n = data.relics[id] | 0;
          if (n > 0 && RELIC_MAP[id]) {
            meta.unlockedRelics.push(id);
            meta.relicRanks[id] = n;
          }
        });
      }
      if (data.relicRanks && typeof data.relicRanks === 'object') {
        meta.relicRanks = data.relicRanks;
      }
    }
  } catch (e) {}
  RELIC_DEFS.forEach(r => {
    if (meta.relicRanks[r.id] == null) meta.relicRanks[r.id] = 0;
    meta.relicRanks[r.id] = Math.min(r.max, Math.max(0, meta.relicRanks[r.id] | 0));
    if (meta.relicRanks[r.id] > 0 && !meta.unlockedRelics.includes(r.id)) {
      meta.unlockedRelics.push(r.id);
    }
  });
}

function saveMeta() {
  try {
    localStorage.setItem('itm_meta_v2', JSON.stringify({
      maxDepth: meta.maxDepth,
      unlockedWeapons: meta.unlockedWeapons,
      unlockedRelics: meta.unlockedRelics,
      relicRanks: meta.relicRanks
    }));
  } catch (e) {}
}

// ── run bag helpers ──────────────────────────────────────
function resetRunBag() {
  runBag.active = false;
  runBag.depth = 1;
  runBag.foundWeapons = [];
  runBag.foundRelics = [];
  runBag.loadoutGun = 'pistol';
  runBag.loadoutRelic = null;
  runBag.runRelicRanks = {};
  runBag.choices = [];
  runBag.secretPath = false;
}

function availableStartDepths() {

  const max = Math.min(15, Math.max(1, meta.maxDepth | 0));
  const list = [];
  for (let d = 1; d <= max; d++) list.push(d);
  return list;
}

function isDepthUnlocked(d) {
  d = d | 0;
  if (d === 16) return false;
  return d >= 1 && d <= Math.max(1, meta.maxDepth | 0);
}

function beginRun(loadoutGun, loadoutRelic, startDepth) {
  runBag.active = true;
  let d = (startDepth | 0) || 1;
  if (!isDepthUnlocked(d)) d = 1;
  runBag.depth = d;
  runBag.foundWeapons = [];
  runBag.foundRelics = [];
  runBag.loadoutGun = loadoutGun || 'pistol';
  runBag.loadoutRelic = loadoutRelic || null;
  runBag.choices = [];
  runBag.secretPath = false;

  runBag.runRelicRanks = {};
  RELIC_DEFS.forEach(r => { runBag.runRelicRanks[r.id] = 0; });
  if (runBag.loadoutRelic && RELIC_MAP[runBag.loadoutRelic]) {
    runBag.runRelicRanks[runBag.loadoutRelic] = 1;
  }
}

function effectiveRelicRank(id) {
  if (runBag.active && runBag.runRelicRanks) {
    return runBag.runRelicRanks[id] | 0;
  }
  return meta.relicRanks[id] | 0;
}

function relicRank(id) {
  return effectiveRelicRank(id);
}

function findWeaponThisRun(gunId) {
  if (!gunId || gunId === 'pistol') return;
  if (!runBag.foundWeapons.includes(gunId)) runBag.foundWeapons.push(gunId);
}

function findRelicThisRun(preferredId) {
  let def = preferredId ? RELIC_MAP[preferredId] : null;
  if (!def) {

    const missing = RELIC_DEFS.filter(r => !(runBag.runRelicRanks[r.id] > 0));
    const pool = missing.length ? missing : RELIC_DEFS.slice();
    def = pool[Math.floor(Math.random() * pool.length)];
  }
  if (!def) return null;

  if (runBag.runRelicRanks[def.id] > 0) {

    if (!runBag.foundRelics.includes(def.id)) runBag.foundRelics.push(def.id);
    return def;
  }
  runBag.runRelicRanks[def.id] = 1;
  if (!runBag.foundRelics.includes(def.id)) runBag.foundRelics.push(def.id);
  applyRelicsToPlayer();
  if (typeof player !== 'undefined') {
    if (player.hp > player.maxHp) player.hp = player.maxHp;
    if (def.id === 'pockets' && typeof fillMagFromReserve === 'function') {
      fillMagFromReserve();
    }
  }
  return def;
}

function extractRunToProfile() {
  // Weapons
  runBag.foundWeapons.forEach(id => {
    if (id && !meta.unlockedWeapons.includes(id)) meta.unlockedWeapons.push(id);
  });
  if (!meta.unlockedWeapons.includes('pistol')) meta.unlockedWeapons.unshift('pistol');

  // Relics — add ranks from finds this run
  runBag.foundRelics.forEach(id => {
    if (!RELIC_MAP[id]) return;
    const runR = runBag.runRelicRanks[id] | 0;
    const prev = meta.relicRanks[id] | 0;
    const gained = Math.max(0, runR - prev);
    if (gained > 0 || runR > 0) {
      meta.relicRanks[id] = Math.min(RELIC_MAP[id].max, Math.max(prev, runR));
      if (!meta.unlockedRelics.includes(id)) meta.unlockedRelics.push(id);
    }
  });

  const next = Math.min(15, (runBag.depth | 0) + 1);
  if (next > meta.maxDepth) meta.maxDepth = next;
  saveMeta();
}

function abandonRunOnDeath() {
  const lostGuns = runBag.foundWeapons.slice();
  const lostRelics = runBag.foundRelics.slice();
  resetRunBag();
  return { lostGuns, lostRelics };
}

function applyRelicsToPlayer() {
  if (typeof player === 'undefined') return;

  player.maxHp = 6;
  const baseSpeed = 4.8;
  player.speed = effectiveRelicRank('moonboots') > 0 ? baseSpeed * 1.5 : baseSpeed;
}

function relicDamageMult() {
  return effectiveRelicRank('harden') > 0 ? 2 : 1;
}

function relicStartAmmo() {
  return typeof STARTING_AMMO !== 'undefined' ? STARTING_AMMO : 60;
}

function relicCooldownScale() {
  return effectiveRelicRank('gunoil') > 0 ? (1 / 1.4) : 1;
}

function relicMagSizeMult() {
  return effectiveRelicRank('pockets') > 0 ? 2 : 1;
}

function relicPickupRadiusMult() {
  return effectiveRelicRank('magnet') > 0 ? 2 : 1;
}

function relicPierce() {
  return effectiveRelicRank('pierce') > 0;
}

function relicLaserSight() {
  return effectiveRelicRank('laser') > 0;
}

function effectiveMagSize(w) {
  w = w || (typeof currentWeapon === 'function' ? currentWeapon() : null);
  const base = (w && w.magSize) ? w.magSize : 12;
  const mult = typeof relicMagSizeMult === 'function' ? relicMagSizeMult() : 1;
  return Math.max(1, Math.round(base * mult));
}

// ── depth / difficulty (uses run depth while active) ─────
function currentDepth() {
  return runBag.active ? runBag.depth : 1;
}

function depthBand(d) {
  d = d != null ? d : currentDepth();
  if (d <= 5) return 'easy';
  if (d <= 10) return 'medium';
  if (d <= 15) return 'hard';
  return 'nightmare';
}

function depthLabel(d) {
  d = d != null ? d : currentDepth();
  const names = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD', nightmare: 'NIGHTMARE' };
  return 'DEPTH ' + d + ' · ' + names[depthBand(d)];
}

function depthEnemyHpScale() {
  const d = currentDepth();
  if (d <= 5) return 1 + (d - 1) * 0.08;
  if (d <= 10) return 1.4 + (d - 6) * 0.12;
  if (d <= 15) return 2.0 + (d - 11) * 0.15;
  return 2.8 + (d - 16) * 0.2;
}

function depthEnemyCountBonus() {
  const d = currentDepth();
  if (d <= 5) return 0;
  if (d <= 10) return 1;
  if (d <= 15) return 2;
  return 2;
}

function depthBossHp() {
  const base = typeof BOSS_HP !== 'undefined' ? BOSS_HP : 1000;
  const d = currentDepth();
  if (d <= 5) return Math.round(base * (0.7 + d * 0.06));
  if (d <= 10) return Math.round(base * (1.0 + (d - 5) * 0.1));
  if (d <= 15) return Math.round(base * (1.5 + (d - 10) * 0.15));
  return Math.round(base * (2.3 + (d - 15) * 0.25));
}

function depthRoomCount() {
  const d = currentDepth();
  const base = 12 + Math.floor(Math.random() * 4);
  if (d <= 5) return base;
  if (d <= 10) return base + 2;
  if (d <= 15) return base + 3;
  return base + 4;
}

function recordDepthCleared() {
  const cleared = (runBag.depth | 0);
  const unlockTo = Math.min(15, cleared + 1);
  if (unlockTo > meta.maxDepth) {
    meta.maxDepth = unlockTo;
    saveMeta();
  } else {
    saveMeta();
  }
}


function debugUnlockAllWeapons() {
  const list = (typeof ARSENAL !== 'undefined' && ARSENAL.length) ? ARSENAL
    : (typeof GUNS !== 'undefined' ? GUNS : []);
  list.forEach(w => {
    if (w && w.id && !meta.unlockedWeapons.includes(w.id)) meta.unlockedWeapons.push(w.id);
  });
  if (!meta.unlockedWeapons.includes('pistol')) meta.unlockedWeapons.unshift('pistol');
  saveMeta();
}

function debugUnlockAllRelics() {
  RELIC_DEFS.forEach(r => {
    meta.relicRanks[r.id] = r.max | 0 || 1;
    if (!meta.unlockedRelics.includes(r.id)) meta.unlockedRelics.push(r.id);
  });
  saveMeta();
}

function debugUnlockAllLevels() {
  meta.maxDepth = 15;
  saveMeta();
}

function debugUnlockEverything() {
  debugUnlockAllWeapons();
  debugUnlockAllRelics();
  debugUnlockAllLevels();
}

function debugGodModeToggle() {
  if (typeof player === 'undefined') return false;
  player._god = !player._god;
  return !!player._god;
}

function debugHealFull() {
  if (typeof player === 'undefined') return;
  player.hp = player.maxHp;
}

function debugGiveAmmo() {
  if (typeof player === 'undefined') return;
  player.ammo = (player.ammo | 0) + 200;
  if (typeof fillMagFromReserve === 'function') fillMagFromReserve();
}

function debugKillBoss() {
  if (typeof rooms === 'undefined' || typeof curKey === 'undefined') return;
  const room = rooms[curKey];
  if (!room || !room.enemies) return;
  room.enemies.forEach(e => {
    if (e && e.type === 'boss' && e.alive) {
      e.hp = 0;
      e.alive = false;
      if (typeof triggerVictory === 'function') triggerVictory();
    }
  });
}

function debugSkipToBoss() {
  if (typeof bossKey === 'undefined' || !bossKey || typeof rooms === 'undefined') return;
  if (typeof player === 'undefined' || !rooms[bossKey]) return;
  player.hasBossKey = true;
  if (typeof rooms[curKey] !== 'undefined' && rooms[curKey]) rooms[curKey].visited = true;
  curKey = bossKey;
  rooms[bossKey].visited = true;
  player.x = (typeof W !== 'undefined' ? W : 800) / 2;
  player.y = (typeof H !== 'undefined' ? H : 544) / 2;
  if (typeof playerProjectiles !== 'undefined') playerProjectiles.length = 0;
  if (typeof enemyProjectiles !== 'undefined') enemyProjectiles.length = 0;
  if (typeof invalidateRoomCache === 'function') invalidateRoomCache();
  if (typeof updateRoomLabel === 'function') updateRoomLabel();
  if (typeof resolveColumnCollision === 'function') resolveColumnCollision(player);
}

function continueDeeper() {

  const cleared = runBag.depth | 0;
  const unlockTo = Math.min(15, cleared + 1);
  if (unlockTo > meta.maxDepth) meta.maxDepth = unlockTo;
  saveMeta();

  runBag.depth += 1;

  if (runBag.depth > 15 && !runBag.secretPath) {
    runBag.depth = 15;
  }
}

function getRunChoices() {
  return (runBag.choices || []).slice();
}

function hasRunChoice(id) {
  const list = runBag.choices || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return true;
  }
  return false;
}

function hasPeacefulPath() {
  return hasRunChoice('spare_child') && hasRunChoice('release_captive');
}

function getAvailableFinalEndings() {
  const data = (typeof STORY_DATA !== 'undefined') ? STORY_DATA : null;
  if (!data || !data.finalEndings || !data.finalEndings.options) return [];
  const peaceful = hasPeacefulPath();
  return data.finalEndings.options.filter(function (opt) {
    if (opt.always) return true;
    return peaceful;
  });
}

function formatRunRewardsSummary() {
  const guns = runBag.foundWeapons.map(id => {
    const g = (typeof ARSENAL_MAP !== 'undefined' && ARSENAL_MAP[id]) ? ARSENAL_MAP[id].name : id;
    return g;
  });
  const relics = runBag.foundRelics.map(id => {
    const d = RELIC_MAP[id];
    return d ? d.name : id;
  });
  return { guns, relics, depth: runBag.depth };
}

// ── profile UI (collection browser) ──────────────────────
function renderRelicUI() {
  const root = document.getElementById('skillList');
  const pts = document.getElementById('skillPoints');
  if (pts) {
    pts.textContent = 'ARSENAL ' + meta.unlockedWeapons.length +
      ' · RELICS ' + meta.unlockedRelics.length +
      ' · BEST DEPTH ' + meta.maxDepth;
  }
  if (!root) return;
  let html = '';
  html += '<div class="skill-row"><div class="skill-info"><div class="skill-name">EXTRACTION</div>';
  html += '<div class="skill-desc">Only items you EXFIL with are kept. Die and the run bag is gone.</div></div></div>';

  html += '<div class="skill-row" style="margin-top:8px;border-top:1px solid #333;padding-top:8px;">';
  html += '<div class="skill-info"><div class="skill-name">UNLOCKED GUNS</div>';
  html += '<div class="skill-desc">' + meta.unlockedWeapons.map(id => {
    const g = (typeof ARSENAL_MAP !== 'undefined' && ARSENAL_MAP[id]) ? ARSENAL_MAP[id].name : id;
    return g;
  }).join(', ') + '</div></div></div>';

  RELIC_DEFS.forEach(def => {
    const owned = meta.unlockedRelics.includes(def.id);
    let iconHtml = '';
    const src = 'assets/sprites/relics/' + def.id + '.png';
    iconHtml = '<img src="' + src + '" alt="" style="width:24px;height:24px;image-rendering:pixelated;'
      + (owned ? '' : 'opacity:0.35;filter:grayscale(1);') + '">';
    html += '<div class="skill-row" style="align-items:center;gap:10px;">';
    html += iconHtml;
    html += '<div class="skill-info" style="flex:1"><div class="skill-name">' + def.name + '</div>';
    html += '<div class="skill-desc">' + def.desc + (owned ? '' : ' · NOT EXTRACTED') + '</div></div>';
    html += '<button type="button" class="opt-toggle' + (owned ? '' : ' off') + '" disabled>' + (owned ? 'OWNED' : '—') + '</button>';
    html += '</div>';
  });
  root.innerHTML = html;
}

function applySkillsToPlayer() { applyRelicsToPlayer(); }
function skillDamageMult() { return relicDamageMult(); }
function skillStartAmmo() { return relicStartAmmo(); }
function skillCooldownScale() { return relicCooldownScale(); }
function renderSkillTreeUI() { renderRelicUI(); }
function awardSkillPoints() {}
function persistWeapons() {  }
function loadUnlockedWeaponsSet() {

  if (runBag.active) {
    const set = new Set([runBag.loadoutGun || 'pistol', ...runBag.foundWeapons]);
    set.add('pistol');
    return set;
  }
  const set = new Set(meta.unlockedWeapons || ['pistol']);
  set.add('pistol');
  return set;
}
function grantRelic(id) { return findRelicThisRun(id); }
function onDepthCleared() {  }

loadMeta();
loadStats();
