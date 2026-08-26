// ════════════════════════════════════════
// MISSION 1 — Flight to the Moon (vertical approach)
// Scrolling space · growing moon · enemies dive from top
// Enemy ships drawn flipped (nose toward player)
// ════════════════════════════════════════
const inv = {
  aliens: [], bullets: [], enemyBullets: [],
  spawnTimer: 0, score: 0, kills: 0,
  moonProgress: 0, stars: null,
  shipFrame: 0, shipAnim: 0,
  scroll: 0,
  duration: 90 * 60,
  elapsed: 0,
  maxAlive: 8
};

const SHIP_FW = 62, SHIP_FH = 69, SHIP_FRAMES = 3;
const ESHIP_FW = 62, ESHIP_FH = 69, ESHIP_FRAMES = 4;

function initInvaders() {
  inv.aliens.length = 0;
  inv.bullets.length = 0;
  inv.enemyBullets.length = 0;
  inv.spawnTimer = 40;
  inv.score = 0; inv.kills = 0;
  inv.moonProgress = 0; inv.elapsed = 0; inv.scroll = 0;
  inv.shipFrame = 0; inv.shipAnim = 0;
  if (!inv.stars) {
    inv.stars = new Array(20);
    for (let i = 0; i < 20; i++) {
      inv.stars[i] = {
        x: Math.random() * W,
        y: Math.random() * H,
        s: 1 + (i % 3),
        sp: 1.2 + (i % 5) * 0.55
      };
    }
  }
  player.x = W / 2;
  player.y = H - 70;
  player.invuln = 20;
}

function spawnEnemyShip() {
  if (inv.aliens.length >= inv.maxAlive) return;
  const kind = Math.random() < 0.45 ? 'red' : 'green';
  inv.aliens.push({
    x: 40 + Math.random() * (W - 80),
    y: -30 - Math.random() * 40,
    r: 16,
    kind,
    frame: 0,
    anim: 0,
    vy: 1.2 + Math.random() * 1.4 + inv.moonProgress * 0.8,
    vx: (Math.random() - 0.5) * 1.2,
    hp: kind === 'red' ? 2 : 1,
    shootCd: 40 + Math.random() * 50
  });
}

function updateInvaders() {
  if (gameOver || !started || paused) return;

  inv.elapsed++;
  inv.moonProgress = Math.min(1, inv.elapsed / inv.duration);
  inv.scroll += 2 + inv.moonProgress * 2;

  for (let i = 0; i < inv.stars.length; i++) {
    const st = inv.stars[i];
    st.y += st.sp * (1.5 + inv.moonProgress * 2);
    if (st.y > H) { st.y = -4; st.x = Math.random() * W; }
  }

  let mx = 0, my = 0;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (mx || my) {
    const len = Math.hypot(mx, my);
    mx /= len; my /= len;
  }
  const spd = (player.speed || 4.8) + 1.2;
  player.x = Math.max(24, Math.min(W - 24, player.x + mx * spd));
  player.y = Math.max(H * 0.35, Math.min(H - 28, player.y + my * spd));

  if (player.shootCooldown > 0) player.shootCooldown--;
  if ((mouse.down || keys[' '] || keys['space']) && player.shootCooldown <= 0) {
    if (inv.bullets.length < 14) {
      inv.bullets.push({ x: player.x - 6, y: player.y - 16, dy: -11 });
      inv.bullets.push({ x: player.x + 6, y: player.y - 16, dy: -11 });
    }
    player.shootCooldown = 7;
    inv.shipFrame = 1;
    inv.shipAnim = 12;
    if (typeof playSfx === 'function') playSfx('playerShip');
  }
  if (inv.shipAnim > 0) {
    inv.shipAnim--;
    if (inv.shipAnim === 8) inv.shipFrame = 2;
    if (inv.shipAnim <= 0) inv.shipFrame = 0;
  }
  if (player.invuln > 0) player.invuln--;

  for (let i = inv.bullets.length - 1; i >= 0; i--) {
    const b = inv.bullets[i];
    b.y += b.dy;
    if (b.y < -10) { inv.bullets.splice(i, 1); continue; }
    for (let j = inv.aliens.length - 1; j >= 0; j--) {
      const a = inv.aliens[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx * dx + dy * dy < 22 * 22) {
        a.hp--;
        inv.bullets.splice(i, 1);
        if (a.hp <= 0) {
          inv.aliens.splice(j, 1);
          inv.score += a.kind === 'red' ? 20 : 10;
          inv.kills++;
          if (typeof spawnParticles === 'function') spawnParticles(a.x, a.y, '#7fb0ff', 5, 'blue');
          if (typeof playSfx === 'function') playSfx('explosion');
        }
        break;
      }
    }
  }

  for (let i = inv.enemyBullets.length - 1; i >= 0; i--) {
    const b = inv.enemyBullets[i];
    b.x += b.dx || 0;
    b.y += b.dy;
    if (b.y > H + 10 || b.x < -10 || b.x > W + 10) {
      inv.enemyBullets.splice(i, 1);
      continue;
    }
    const dx = b.x - player.x, dy = b.y - player.y;
    if (dx * dx + dy * dy < 18 * 18 && player.invuln <= 0) {
      player.hp--;
      player.invuln = 40;
      inv.enemyBullets.splice(i, 1);
      if (typeof playSfx === 'function') playSfx('hurt');
      if (player.hp <= 0) {
        gameOver = true;
        if (typeof playSfx === 'function') playSfx('gameover');
        const el = document.getElementById('msg');
        el.style.display = 'flex';
        el.innerHTML = 'APPROACH FAILED<button>RETRY</button><button>MAIN MENU</button>';
      }
    }
  }

  inv.spawnTimer--;
  if (inv.spawnTimer <= 0) {
    spawnEnemyShip();
    inv.spawnTimer = Math.max(18, 55 - inv.moonProgress * 35 - (inv.kills * 0.15));
  }

  for (let i = inv.aliens.length - 1; i >= 0; i--) {
    const a = inv.aliens[i];
    a.x += a.vx;
    a.y += a.vy;
    if (a.x < 24) { a.x = 24; a.vx = Math.abs(a.vx); }
    if (a.x > W - 24) { a.x = W - 24; a.vx = -Math.abs(a.vx); }

    a.shootCd--;
    if (a.shootCd <= 0 && inv.enemyBullets.length < 12) {
      a.shootCd = 50 + Math.random() * 40;
      a.frame = 1;
      a.anim = 15;
      const dx = player.x - a.x, dy = player.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      inv.enemyBullets.push({
        x: a.x, y: a.y + 12,
        dx: (dx / len) * 1.2,
        dy: Math.max(2.5, (dy / len) * 4.2),
        color: a.kind === 'green' ? '#6dff8a' : '#ff5a5a'
      });
      if (typeof playSfx === 'function') {
        playSfx(a.kind === 'green' ? 'enemyShip2' : 'enemyShip1');
      }
    }
    if (a.anim > 0) {
      a.anim--;
      if (a.anim === 10) a.frame = 2;
      else if (a.anim === 5) a.frame = 3;
      else if (a.anim <= 0) a.frame = 0;
    }

    if (Math.hypot(a.x - player.x, a.y - player.y) < a.r + player.r && player.invuln <= 0) {
      player.hp--;
      player.invuln = 40;
      inv.aliens.splice(i, 1);
      if (typeof playSfx === 'function') playSfx('hurt');
      if (player.hp <= 0) {
        gameOver = true;
        if (typeof playSfx === 'function') playSfx('gameover');
        const el = document.getElementById('msg');
        el.style.display = 'flex';
        el.innerHTML = 'APPROACH FAILED<button>RETRY</button><button>MAIN MENU</button>';
        return;
      }
      continue;
    }
    if (a.y > H + 40) inv.aliens.splice(i, 1);
  }

  if (inv.moonProgress >= 1) {
    gameOver = true;
    if (typeof awardSkillPoints === 'function') awardSkillPoints(2, 'FLIGHT');
    const el = document.getElementById('msg');
    el.style.display = 'flex';
    el.innerHTML = 'MOON REACHED<button>CONTINUE (MISSION 2)</button><button>MAIN MENU</button>';
    return;
  }

  if (particles.length > 40) particles.length = 40;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.dx; p.y += p.dy; p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawInvaders() {
  const p = inv.moonProgress;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(200,210,230,0.55)';
  for (let i = 0; i < inv.stars.length; i++) {
    const st = inv.stars[i];
    ctx.fillRect(st.x | 0, st.y | 0, st.s, st.s);
  }

  const r = 12 + (Math.min(W, H) * 0.48 - 12) * (p * p);
  const cx = W / 2;
  const cy = H * 0.22 - p * 20;
  if (typeof spriteReady === 'function' && spriteReady('moon')) {
    const size = r * 2;
    ctx.drawImage(SPRITES.moon, cx - size / 2, cy - size / 2, size, size);
  } else {
    ctx.fillStyle = '#c8c4b0';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  const km = Math.max(0, Math.round((1 - p) * 384000));
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(km > 0 ? km.toLocaleString() + ' km' : 'ORBIT', cx, cy + r + 14);

  const hasRed = typeof spriteReady === 'function' && spriteReady('enemyShip');
  const hasGreen = typeof spriteReady === 'function' && spriteReady('enemyShip2');
  for (let i = 0; i < inv.aliens.length; i++) {
    const a = inv.aliens[i];
    const key = a.kind === 'green' ? 'enemyShip2' : 'enemyShip';
    const ok = a.kind === 'green' ? hasGreen : hasRed;
    if (ok) {
      const fr = Math.max(0, Math.min(ESHIP_FRAMES - 1, a.frame | 0));
      const scale = 36 / ESHIP_FH;
      const dw = (ESHIP_FW * scale) | 0, dh = (ESHIP_FH * scale) | 0;
      ctx.save();
      ctx.translate(a.x | 0, a.y | 0);
      ctx.scale(1, -1); // flip vertically — nose toward player
      ctx.drawImage(
        SPRITES[key],
        fr * ESHIP_FW, 0, ESHIP_FW, ESHIP_FH,
        (-dw / 2) | 0, (-dh / 2) | 0, dw, dh
      );
      ctx.restore();
    } else {
      ctx.fillStyle = a.kind === 'green' ? '#6dff8a' : '#ff5a5a';
      ctx.fillRect(a.x - 14, a.y - 10, 28, 20);
    }
  }

  ctx.fillStyle = '#eef2f8';
  for (let i = 0; i < inv.bullets.length; i++) {
    const b = inv.bullets[i];
    ctx.fillRect((b.x - 1) | 0, (b.y - 8) | 0, 3, 14);
  }
  for (let i = 0; i < inv.enemyBullets.length; i++) {
    const b = inv.enemyBullets[i];
    ctx.fillStyle = b.color || '#ff5a5a';
    ctx.fillRect((b.x - 1) | 0, (b.y - 6) | 0, 3, 12);
  }

  ctx.save();
  if (player.invuln > 0 && ((player.invuln / 4) | 0) % 2 === 0) ctx.globalAlpha = 0.4;
  if (typeof spriteReady === 'function' && spriteReady('ship')) {
    const fr = Math.max(0, Math.min(SHIP_FRAMES - 1, inv.shipFrame | 0));
    const scale = 42 / SHIP_FH;
    const dw = (SHIP_FW * scale) | 0, dh = (SHIP_FH * scale) | 0;
    ctx.drawImage(
      SPRITES.ship,
      fr * SHIP_FW, 0, SHIP_FW, SHIP_FH,
      (player.x - dw / 2) | 0, (player.y - dh / 2) | 0, dw, dh
    );
  } else if (typeof spriteReady === 'function' && spriteReady('player')) {
    drawSpriteFit(SPRITES.player, player.x, player.y, 36);
  } else {
    ctx.fillStyle = '#eef2f8';
    ctx.beginPath(); ctx.arc(player.x, player.y, 14, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i];
    ctx.globalAlpha = pt.life / 16;
    if (pt.sprite && typeof spriteReady === 'function' && spriteReady(pt.sprite)) {
      ctx.drawImage(SPRITES[pt.sprite], pt.x - 4, pt.y - 4, 8, 8);
    } else {
      ctx.fillStyle = pt.color || '#fff';
      ctx.fillRect(pt.x - 2, pt.y - 2, 3, 3);
    }
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#fff';
  ctx.font = '13px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('SCORE ' + inv.score + '  KILLS ' + inv.kills, 12, 22);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(W - 140, 10, 120, 6);
  ctx.fillStyle = '#c8c4b0';
  ctx.fillRect(W - 140, 10, 120 * inv.moonProgress, 6);
}
