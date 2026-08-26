// ════════════════════════════════════════
// MISSION 2 — Lunar Surface Assault
// Defended outposts (floor1 / wall2) → clear → advance → dungeon
// ════════════════════════════════════════
const of = {
  zone: 0,
  phase: 'fight', // fight | transition
  camX: 0, camY: 0,
  walls: [],
  towers: [],
  enemies: [],
  barrels: [],
  props: [], // destructible base objects (ships, drills, trucks, life support)
  gate: null,
  exit: null,
  zones: [],
  transition: null,
  totalZones: 3,
  _clearToast: false,
  _exitToast: false,
  _floorCache: null
};

function ofEnsureFloorCache() {
  if (of._floorCache) return of._floorCache;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  const img = SPRITES.floor1;
  if (img && img.ok) {
    for (let y = 0; y < H; y += TILE_SIZE)
      for (let xx = 0; xx < W; xx += TILE_SIZE)
        x.drawImage(img, xx, y);
  } else {
    x.fillStyle = '#2a2e38';
    x.fillRect(0, 0, W, H);
  }
  of._floorCache = c;
  return c;
}

function initOpenField() {
  of.zone = 0;
  of.phase = 'fight';
  of.camX = 0; of.camY = 0;
  of.walls.length = 0;
  of.towers.length = 0;
  of.enemies.length = 0;
  of.barrels.length = 0;
  of.props.length = 0;
  of.gate = null;
  of.transition = null;
  of._clearToast = false;
  of._exitToast = false;
  of._floorCache = null;
  playerProjectiles.length = 0;
  enemyProjectiles.length = 0;
  particles.length = 0;
  explosions.length = 0;

  // Northbound path: Landing Pad → Housing Base → Complex Gate (Mission 3)
  of.zones = [
    { x: 0, y: 0, label: 'LANDING PAD' },
    { x: 0, y: -(H + 48), label: 'HOUSING BASE' },
    { x: 0, y: -2 * (H + 48), label: 'COMPLEX GATE' }
  ];
  of.exit = {
    x: W / 2,
    y: -2 * (H + 48) - 120,
    r: 36,
    open: false
  };

  loadZone(0);
  player.x = W / 2;
  player.y = H - 100;
  player.invuln = 30;
}

function ofMakeProp(x, y, kind) {
  // kind: 'ship' | 'drill' | 'truck' | 'lifeSupport' | 'barrel'
  const defs = {
    ship:        { sprite: 'enemyShip', frameW: 62, frames: 4, frame: 0, hp: 5, r: 22, size: 48 },
    drill:       { sprite: 'drill', frameW: 62, frames: 2, frame: 0, hp: 4, r: 20, size: 44 },
    truck:       { sprite: 'truck', frameW: 0, frames: 1, frame: 0, hp: 4, r: 18, size: 40 },
    lifeSupport: { sprite: 'lifeSupport', frameW: 0, frames: 1, frame: 0, hp: 3, r: 16, size: 36 },
    barrel:      { sprite: 'barrel', frameW: 0, frames: 1, frame: 0, hp: 1, r: 14, size: 28 }
  };
  const d = defs[kind] || defs.barrel;
  return {
    x, y, r: d.r, hp: d.hp, maxHp: d.hp, alive: true,
    kind, sprite: d.sprite, frameW: d.frameW, frames: d.frames, frame: d.frame,
    size: d.size, animTimer: 0
  };
}

function ofExplodeProp(prop) {
  prop.alive = false;
  if (typeof spawnParticles === 'function') {
    spawnParticles(prop.x, prop.y, '#f4a05a', prop.kind === 'barrel' ? 28 : 40, 'red');
  }
  if (typeof playSfx === 'function') playSfx('explosion');
  explosions.push({ x: prop.x, y: prop.y, life: 22, maxLife: 22, maxR: prop.kind === 'barrel' ? 100 : 130 });
  // splash damage to nearby enemies
  for (let k = 0; k < of.enemies.length; k++) {
    const en = of.enemies[k];
    if (en.alive && Math.hypot(en.x - prop.x, en.y - prop.y) < 120 + en.r) {
      en.hp -= 4;
      if (en.hp <= 0) {
        en.alive = false;
        if (typeof spawnParticles === 'function') spawnParticles(en.x, en.y, '#8fe0c9', 12, 'blue');
      }
    }
  }
  if (Math.hypot(player.x - prop.x, player.y - prop.y) < 110 + player.r && player.invuln <= 0) {
    if (typeof damagePlayer === 'function') damagePlayer(2);
  }
}

function loadZone(zi) {
  of.zone = zi;
  of.phase = 'fight';
  of.walls.length = 0;
  of.towers.length = 0;
  of.enemies.length = 0;
  of.barrels.length = 0;
  of.props.length = 0;
  of.gate = null;
  of._clearToast = false;
  playerProjectiles.length = 0;
  enemyProjectiles.length = 0;

  const z = of.zones[zi];
  const margin = 40;
  const left = z.x + margin;
  const right = z.x + W - margin;
  const top = z.y + margin;
  const bot = z.y + H - margin;
  const thick = TILE_SIZE; // 16 — matches wall2 tile
  const gateW = 80;

  // North wall with gate gap
  of.walls.push({ x: left, y: top, w: (right - left - gateW) / 2, h: thick });
  of.walls.push({
    x: left + (right - left - gateW) / 2 + gateW,
    y: top,
    w: (right - left - gateW) / 2,
    h: thick
  });
  // South, west, east
  of.walls.push({ x: left, y: bot - thick, w: right - left, h: thick });
  of.walls.push({ x: left, y: top, w: thick, h: bot - top });
  of.walls.push({ x: right - thick, y: top, w: thick, h: bot - top });

  of.gate = {
    x: left + (right - left - gateW) / 2,
    y: top,
    w: gateW,
    h: thick,
    open: false
  };

  // Corner towers (platforms) + gunners
  const tw = 32, th = 32;
  const spots = [
    { x: left + thick + 12, y: top + thick + 12 },
    { x: right - thick - tw - 12, y: top + thick + 12 },
    { x: left + thick + 12, y: bot - thick - th - 48 },
    { x: right - thick - tw - 12, y: bot - thick - th - 48 }
  ];
  spots.forEach((p, i) => {
    of.towers.push({ x: p.x, y: p.y, w: tw, h: th });
    of.enemies.push({
      x: p.x + tw / 2,
      y: p.y + th / 2,
      r: 14,
      hp: 3 + zi,
      maxHp: 3 + zi,
      type: 'tower',
      alive: true,
      cooldown: 25 + i * 12,
      speed: 0
    });
  });

  // Ground martians inside the yard
  const nGround = 6 + zi * 3;
  for (let i = 0; i < nGround; i++) {
    const type = Math.random() < 0.45 ? 'shooter' : 'slime';
    of.enemies.push({
      x: left + 70 + Math.random() * (right - left - 140),
      y: top + 70 + Math.random() * (bot - top - 160),
      r: 15,
      hp: type === 'shooter' ? 3 + zi : 2 + zi,
      maxHp: type === 'shooter' ? 3 + zi : 2 + zi,
      speed: type === 'shooter' ? 0.85 : 1.2,
      type,
      alive: true,
      cooldown: 25 + Math.random() * 40
    });
  }

  // Classic explosive barrels (scattered)
  for (let i = 0; i < 2 + zi; i++) {
    of.props.push(ofMakeProp(
      left + 90 + Math.random() * (right - left - 180),
      top + 90 + Math.random() * (bot - top - 180),
      'barrel'
    ));
  }

  // Themed base props by zone
  // 0 LANDING PAD  — parked ships on the pad
  // 1 HOUSING BASE — trucks + life support modules
  // 2 COMPLEX GATE — mixed debris + gate to Mission 3
  const midX = (left + right) / 2;
  const midY = (top + bot) / 2;
  if (zi === 0) {
    // Landing pad: enemy ships at rest + a couple barrels
    of.props.push(ofMakeProp(midX - 100, midY - 30, 'ship'));
    of.props.push(ofMakeProp(midX + 95, midY - 10, 'ship'));
    of.props.push(ofMakeProp(midX - 20, midY + 55, 'ship'));
    of.props.push(ofMakeProp(left + 100, bot - 95, 'barrel'));
    of.props.push(ofMakeProp(right - 110, midY + 40, 'barrel'));
  } else if (zi === 1) {
    // Housing base: trucks and life-support units
    of.props.push(ofMakeProp(midX - 110, midY - 20, 'truck'));
    of.props.push(ofMakeProp(midX + 90, midY + 10, 'truck'));
    of.props.push(ofMakeProp(midX - 30, midY + 65, 'truck'));
    of.props.push(ofMakeProp(left + 100, midY - 40, 'lifeSupport'));
    of.props.push(ofMakeProp(right - 115, midY - 30, 'lifeSupport'));
    of.props.push(ofMakeProp(midX + 20, midY - 55, 'lifeSupport'));
  } else {
    // Complex gate: last stand — trucks, life support, one ship, barrels
    of.props.push(ofMakeProp(midX - 100, midY - 40, 'truck'));
    of.props.push(ofMakeProp(midX + 95, midY, 'lifeSupport'));
    of.props.push(ofMakeProp(left + 105, midY + 20, 'lifeSupport'));
    of.props.push(ofMakeProp(right - 110, midY - 50, 'ship'));
    of.props.push(ofMakeProp(midX - 20, midY + 50, 'barrel'));
  }

  const tips = [
    'LANDING PAD — clear the ships',
    'HOUSING BASE — trucks & life support',
    'COMPLEX GATE — reach the dungeon entrance'
  ];
  if (typeof flashToast === 'function') flashToast(tips[zi] || (z.label + ' — CLEAR IT'));
}

function ofAliveCount() {
  let n = 0;
  for (let i = 0; i < of.enemies.length; i++) if (of.enemies[i].alive) n++;
  return n;
}

function ofCollideWalls(px, py, r) {
  for (let i = 0; i < of.walls.length; i++) {
    const w = of.walls[i];
    const cx = Math.max(w.x, Math.min(px, w.x + w.w));
    const cy = Math.max(w.y, Math.min(py, w.y + w.h));
    if ((px - cx) * (px - cx) + (py - cy) * (py - cy) < r * r) return true;
  }
  if (of.gate && !of.gate.open) {
    const w = of.gate;
    const cx = Math.max(w.x, Math.min(px, w.x + w.w));
    const cy = Math.max(w.y, Math.min(py, w.y + w.h));
    if ((px - cx) * (px - cx) + (py - cy) * (py - cy) < r * r) return true;
  }
  for (let i = 0; i < of.towers.length; i++) {
    const t = of.towers[i];
    const cx = Math.max(t.x, Math.min(px, t.x + t.w));
    const cy = Math.max(t.y, Math.min(py, t.y + t.h));
    if ((px - cx) * (px - cx) + (py - cy) * (py - cy) < r * r) return true;
  }
  return false;
}

function startTransitionTo(nextZone) {
  of.phase = 'transition';
  of.gate.open = true;
  const z = of.zones[nextZone];
  of.transition = {
    fromX: player.x, fromY: player.y,
    toX: z.x + W / 2, toY: z.y + H - 100,
    camFromX: of.camX, camFromY: of.camY,
    camToX: z.x, camToY: z.y,
    t: 0, dur: 90
  };
  playerProjectiles.length = 0;
  enemyProjectiles.length = 0;
  if (typeof flashToast === 'function') flashToast('MOVING OUT');
}

function updateOpenField() {
  if (gameOver || !started || paused) return;

  if (of.phase === 'transition' && of.transition) {
    const tr = of.transition;
    tr.t++;
    const u = Math.min(1, tr.t / tr.dur);
    const e = u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u;
    player.x = tr.fromX + (tr.toX - tr.fromX) * e;
    player.y = tr.fromY + (tr.toY - tr.fromY) * e;
    of.camX = tr.camFromX + (tr.camToX - tr.camFromX) * e;
    of.camY = tr.camFromY + (tr.camToY - tr.camFromY) * e;
    if (u >= 1) {
      of.transition = null;
      loadZone(of.zone + 1);
      of.camX = of.zones[of.zone].x;
      of.camY = of.zones[of.zone].y;
      player.x = of.zones[of.zone].x + W / 2;
      player.y = of.zones[of.zone].y + H - 100;
    }
    return;
  }

  if (of.exit.open && of.zone === of.totalZones - 1) {
    const targetY = Math.min(of.zones[of.zone].y, player.y - H * 0.55);
    of.camY += (targetY - of.camY) * 0.08;
    of.camX = of.zones[of.zone].x;
  } else if (of.zones[of.zone]) {
    of.camX = of.zones[of.zone].x;
    of.camY = of.zones[of.zone].y;
  }

  let mx = 0, my = 0;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  if (mx || my) {
    const len = Math.hypot(mx, my);
    const spd = player.speed || 4.8;
    const nx = player.x + (mx / len) * spd;
    const ny = player.y + (my / len) * spd;
    if (!ofCollideWalls(nx, player.y, player.r)) player.x = nx;
    if (!ofCollideWalls(player.x, ny, player.r)) player.y = ny;
  }

  const aimX = mouse.x + of.camX;
  const aimY = mouse.y + of.camY;
  const mdx = aimX - player.x, mdy = aimY - player.y;
  const mlen = Math.hypot(mdx, mdy) || 1;
  player.dx = mdx / mlen; player.dy = mdy / mlen;

  if (player.shootCooldown > 0) player.shootCooldown--;
  if (player.invuln > 0) player.invuln--;

  if (mouse.down && player.shootCooldown <= 0 && of.phase === 'fight') {
    const w = currentWeapon();
    if (!(w.ammoCost > 0 && player.ammo < w.ammoCost)) {
      const cdScale = (typeof skillCooldownScale === 'function') ? skillCooldownScale() : 1;
      const dmgMult = (typeof skillDamageMult === 'function') ? skillDamageMult() : 1;
      player.shootCooldown = Math.max(4, Math.round(w.cooldown * cdScale));
      if (w.ammoCost > 0) player.ammo -= w.ammoCost;
      if (typeof playSfx === 'function') playSfx(typeof gunSfxKey === 'function' ? gunSfxKey(w) : 'pistol');
      if (playerProjectiles.length < (MAX_PLAYER_PROJS || 28)) {
        playerProjectiles.push({
          x: player.x + player.dx * 16, y: player.y + player.dy * 16,
          dx: player.dx, dy: player.dy, speed: w.speed, r: w.pr, life: 80,
          dmg: Math.max(1, Math.round(w.dmg * dmgMult)),
          color: w.color, pierce: !!w.pierce
        });
      }
    }
  }

  for (let i = playerProjectiles.length - 1; i >= 0; i--) {
    const p = playerProjectiles[i];
    p.x += p.dx * p.speed; p.y += p.dy * p.speed; p.life--;
    if (p.life <= 0) {
      playerProjectiles.splice(i, 1);
      continue;
    }
    // Entity hits BEFORE wall kill so targets near walls remain shootable
    let hit = false;
    for (let j = 0; j < of.enemies.length; j++) {
      const en = of.enemies[j];
      if (!en.alive) continue;
      if (Math.hypot(p.x - en.x, p.y - en.y) < p.r + en.r) {
        en.hp -= p.dmg;
        if (en.hp <= 0) {
          en.alive = false;
          player.ammo += 4;
          if (typeof spawnParticles === 'function') spawnParticles(en.x, en.y, '#8fe0c9', 12, 'blue');
        }
        hit = !p.pierce;
        break;
      }
    }
    if (!hit) {
      for (let j = 0; j < of.props.length; j++) {
        const prop = of.props[j];
        if (!prop.alive) continue;
        if (Math.hypot(p.x - prop.x, p.y - prop.y) < p.r + prop.r) {
          prop.hp -= p.dmg;
          if (typeof spawnParticles === 'function') spawnParticles(prop.x, prop.y, '#f4a05a', 4, 'red');
          if (prop.hp <= 0) ofExplodeProp(prop);
          hit = true;
          break;
        }
      }
    }
    if (!hit && ofCollideWalls(p.x, p.y, p.r)) {
      playerProjectiles.splice(i, 1);
      continue;
    }
    if (hit) playerProjectiles.splice(i, 1);
  }

  for (let i = 0; i < of.enemies.length; i++) {
    const en = of.enemies[i];
    if (!en.alive) continue;
    const dx = player.x - en.x, dy = player.y - en.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (en.type === 'slime') {
      const nx = en.x + (dx / dist) * en.speed;
      const ny = en.y + (dy / dist) * en.speed;
      if (!ofCollideWalls(nx, en.y, en.r)) en.x = nx;
      if (!ofCollideWalls(en.x, ny, en.r)) en.y = ny;
    } else if (en.type === 'shooter') {
      if (dist > 110) {
        const nx = en.x + (dx / dist) * en.speed;
        const ny = en.y + (dy / dist) * en.speed;
        if (!ofCollideWalls(nx, en.y, en.r)) en.x = nx;
        if (!ofCollideWalls(en.x, ny, en.r)) en.y = ny;
      }
    }

    if (en.type === 'shooter' || en.type === 'tower') {
      en.cooldown--;
      if (en.cooldown <= 0 && dist < 380 && enemyProjectiles.length < (MAX_ENEMY_PROJS || 18)) {
        en.cooldown = en.type === 'tower' ? 32 : 48;
        enemyProjectiles.push({
          x: en.x, y: en.y,
          dx: dx / dist, dy: dy / dist,
          speed: en.type === 'tower' ? 4.2 : 3.2,
          r: 4, life: 90
        });
        if (typeof playSfx === 'function') playSfx('enemyShot');
      }
    }

    if (en.type !== 'tower' && dist < en.r + player.r && player.invuln <= 0) {
      player.hp--; player.invuln = 35;
      if (typeof playSfx === 'function') playSfx('hurt');
      if (player.hp <= 0) {
        gameOver = true;
        if (typeof playSfx === 'function') playSfx('gameover');
        const el = document.getElementById('msg');
        el.style.display = 'flex';
        el.innerHTML = 'SURFACE LOST<button>RETRY</button><button>MAIN MENU</button>';
      }
    }
  }

  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    p.x += p.dx * p.speed; p.y += p.dy * p.speed; p.life--;
    if (p.life <= 0 || ofCollideWalls(p.x, p.y, p.r)) {
      enemyProjectiles.splice(i, 1);
      continue;
    }
    if (Math.hypot(p.x - player.x, p.y - player.y) < p.r + player.r && player.invuln <= 0) {
      player.hp--; player.invuln = 35;
      enemyProjectiles.splice(i, 1);
      if (typeof playSfx === 'function') playSfx('hurt');
      if (player.hp <= 0) {
        gameOver = true;
        if (typeof playSfx === 'function') playSfx('gameover');
        const el = document.getElementById('msg');
        el.style.display = 'flex';
        el.innerHTML = 'SURFACE LOST<button>RETRY</button><button>MAIN MENU</button>';
      }
    }
  }

  if (of.phase === 'fight' && ofAliveCount() === 0) {
    of.gate.open = true;
    if (of.zone < of.totalZones - 1) {
      const g = of.gate;
      const gx = g.x + g.w / 2;
      if (player.y < g.y + g.h + 24 && player.y > g.y - 40 && Math.abs(player.x - gx) < g.w / 2 + 12) {
        startTransitionTo(of.zone + 1);
      } else if (!of._clearToast) {
        of._clearToast = true;
        if (typeof flashToast === 'function') flashToast('GATE OPEN — MOVE NORTH');
      }
    } else {
      of.exit.open = true;
      if (!of._exitToast) {
        of._exitToast = true;
        if (typeof flashToast === 'function') flashToast('DUNGEON ENTRANCE OPEN');
      }
    }
  }

  if (of.exit.open && Math.hypot(player.x - of.exit.x, player.y - of.exit.y) < of.exit.r + player.r) {
    gameOver = true;
    if (typeof awardSkillPoints === 'function') awardSkillPoints(2, 'SURFACE');
    const el = document.getElementById('msg');
    el.style.display = 'flex';
    el.innerHTML = 'DUNGEON ENTRANCE<button>CONTINUE (MISSION 3)</button><button>MAIN MENU</button>';
  }

  if (particles.length > (typeof MAX_PARTICLES !== 'undefined' ? MAX_PARTICLES : 140)) {
    particles.length = typeof MAX_PARTICLES !== 'undefined' ? MAX_PARTICLES : 140;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.x += p.dx; p.y += p.dy; p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].life--;
    if (explosions[i].life <= 0) explosions.splice(i, 1);
  }
}

function ofDrawWallTile(sx, sy, ww, hh) {
  const img = SPRITES.wall2;
  if (img && img.ok) {
    for (let y = sy; y < sy + hh; y += TILE_SIZE)
      for (let x = sx; x < sx + ww; x += TILE_SIZE)
        ctx.drawImage(img, x, y);
  } else {
    ctx.fillStyle = '#4a5568';
    ctx.fillRect(sx, sy, ww, hh);
  }
}

function drawOpenField() {
  // Moon surface floor (floor1) — cached full-screen blit
  const floor = ofEnsureFloorCache();
  ctx.drawImage(floor, 0, 0);

  const toS = (x, y) => ({ x: x - of.camX, y: y - of.camY });

  // Walls (wall2 tiles)
  for (let i = 0; i < of.walls.length; i++) {
    const w = of.walls[i];
    const s = toS(w.x, w.y);
    ofDrawWallTile(s.x, s.y, w.w, w.h);
  }

  // Gate
  if (of.gate) {
    const g = of.gate;
    const s = toS(g.x, g.y);
    if (g.open) {
      // open: faint floor strip + label
      ctx.fillStyle = 'rgba(143,224,201,0.15)';
      ctx.fillRect(s.x, s.y, g.w, g.h);
      ctx.fillStyle = '#8fe0c9';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('OPEN', s.x + g.w / 2, s.y + 12);
    } else {
      ofDrawWallTile(s.x, s.y, g.w, g.h);
      ctx.fillStyle = '#ff8f6b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SEALED', s.x + g.w / 2, s.y + 12);
    }
  }

  // Tower platforms (wall2 blocks)
  for (let i = 0; i < of.towers.length; i++) {
    const t = of.towers[i];
    const s = toS(t.x, t.y);
    ofDrawWallTile(s.x, s.y, t.w, t.h);
  }

  // Exit pad
  if (of.exit) {
    const s = toS(of.exit.x, of.exit.y);
    if (s.y > -60 && s.y < H + 60) {
      ctx.strokeStyle = of.exit.open ? '#8fe0c9' : '#555';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, of.exit.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = of.exit.open ? '#8fe0c9' : '#666';
      ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(of.exit.open ? 'DUNGEON' : 'LOCKED', s.x, s.y + 4);
    }
  }

  // Destructible base props (ships, drills, trucks, life support, barrels)
  for (let i = 0; i < of.props.length; i++) {
    const prop = of.props[i];
    if (!prop.alive) continue;
    const s = toS(prop.x, prop.y);
    // animate multi-frame sprites slowly
    if (prop.frames > 1) {
      prop.animTimer = (prop.animTimer || 0) + 1;
      if (prop.animTimer > 18) {
        prop.animTimer = 0;
        prop.frame = (prop.frame + 1) % prop.frames;
      }
    }
    const img = (typeof spriteReady === 'function' && spriteReady(prop.sprite)) ? SPRITES[prop.sprite] : null;
    if (img) {
      ctx.imageSmoothingEnabled = false;
      if (prop.frameW > 0 && prop.frames > 1) {
        const fw = prop.frameW;
        const fh = img.height;
        const scale = prop.size / Math.max(fw, fh);
        const dw = Math.round(fw * scale);
        const dh = Math.round(fh * scale);
        ctx.drawImage(img, prop.frame * fw, 0, fw, fh, Math.round(s.x - dw / 2), Math.round(s.y - dh / 2), dw, dh);
      } else {
        drawSpriteFit(img, s.x, s.y, prop.size);
      }
    } else {
      ctx.fillStyle = prop.kind === 'barrel' ? '#c96b4f' : '#8a9bb0';
      ctx.beginPath(); ctx.arc(s.x, s.y, prop.r, 0, Math.PI * 2); ctx.fill();
    }
    // HP bar for multi-hit props
    if (prop.maxHp > 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(s.x - prop.r, s.y - prop.r - 8, prop.r * 2, 3);
      ctx.fillStyle = '#f4a05a';
      ctx.fillRect(s.x - prop.r, s.y - prop.r - 8, prop.r * 2 * (prop.hp / prop.maxHp), 3);
    }
  }

  // Enemies — tower & shooter use martian_gunner, slime uses crawler
  for (let i = 0; i < of.enemies.length; i++) {
    const en = of.enemies[i];
    if (!en.alive) continue;
    const s = toS(en.x, en.y);
    const key = (en.type === 'tower' || en.type === 'shooter') ? 'shooter' : 'slime';
    if (typeof spriteReady === 'function' && spriteReady(key)) {
      drawSpriteFit(SPRITES[key], s.x, s.y, en.type === 'tower' ? 28 : 32);
    } else {
      ctx.fillStyle = en.type === 'tower' ? '#d8a060' : (en.type === 'shooter' ? '#7fb0d8' : '#8fd8b0');
      ctx.beginPath(); ctx.arc(s.x, s.y, en.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(s.x - en.r, s.y - en.r - 8, en.r * 2, 3);
    ctx.fillStyle = '#8fe0c9';
    ctx.fillRect(s.x - en.r, s.y - en.r - 8, en.r * 2 * (en.hp / en.maxHp), 3);
  }

  // Projectiles
  for (let i = 0; i < playerProjectiles.length; i++) {
    const p = playerProjectiles[i];
    const s = toS(p.x, p.y);
    if (typeof drawProjectileFast === 'function') {
      if (!drawProjectileFast(s.x, s.y, p.dx, p.dy, Math.max(28, p.r * 8))) {
        ctx.fillStyle = '#eef2f8'; ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
    } else {
      ctx.fillStyle = '#eef2f8'; ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
  }
  for (let i = 0; i < enemyProjectiles.length; i++) {
    const p = enemyProjectiles[i];
    const s = toS(p.x, p.y);
    if (typeof drawProjectileFast === 'function') {
      if (!drawProjectileFast(s.x, s.y, p.dx, p.dy, 24, 0.85)) {
        ctx.fillStyle = '#ff8f6b'; ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
    } else {
      ctx.fillStyle = '#ff8f6b'; ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
  }

  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i];
    const s = toS(pt.x, pt.y);
    const a = Math.max(0, pt.life / (pt.maxLife || 20));
    ctx.globalAlpha = a;
    const sz = pt.size || 7;
    if (pt.sprite && typeof spriteReady === 'function' && spriteReady(pt.sprite))
      ctx.drawImage(SPRITES[pt.sprite], s.x - sz, s.y - sz, sz * 2, sz * 2);
    else {
      ctx.fillStyle = pt.color || '#fff';
      ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
    }
  }
  ctx.globalAlpha = 1;

  // Player
  const ps = toS(player.x, player.y);
  ctx.save();
  if (player.invuln > 0 && ((player.invuln / 4) | 0) % 2 === 0) ctx.globalAlpha = 0.4;
  if (typeof spriteReady === 'function' && spriteReady('player'))
    drawSpriteFit(SPRITES.player, ps.x, ps.y, 34);
  else {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ps.x, ps.y, 14, 0, Math.PI * 2); ctx.fill();
  }
  // gun
  const ang = Math.atan2(player.dy, player.dx);
  const flip = player.dx < 0;
  const wpn = currentWeapon();
  ctx.translate(ps.x, ps.y);
  ctx.rotate(ang);
  if (typeof drawGunFrame === 'function' && wpn && wpn.kind !== 'melee') {
    drawGunFrame(wpn.id, 0, 4, 0, 26, flip);
  } else {
    ctx.fillStyle = '#ccc';
    ctx.fillRect(8, -3, 18, 6);
  }
  ctx.restore();

  // HUD
  ctx.fillStyle = '#fff';
  ctx.font = '13px monospace';
  ctx.textAlign = 'left';
  const label = of.zones[of.zone] ? of.zones[of.zone].label : '';
  ctx.fillText(label + '  ·  HOSTILES ' + ofAliveCount() + '  ·  ' + (of.zone + 1) + '/' + of.totalZones, 12, 22);
  if (of.phase === 'transition') {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('ADVANCING…', W / 2, H / 2);
  }
}
