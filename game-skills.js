// ════════════════════════════════════════
// SKILL TREE — permanent upgrades (localStorage)
// ════════════════════════════════════════
const SKILL_DEFS = [
  { id: 'vitality',  name: 'VITALITY',  desc: '+1 Max HP',           max: 3, cost: [1, 2, 3], apply: (r) => { player.maxHp = 6 + r; } },
  { id: 'thrusters', name: 'THRUSTERS', desc: '+0.4 Move Speed',     max: 3, cost: [1, 2, 3], apply: (r) => { player.speed = 4.8 + r * 0.4; } },
  { id: 'firepower', name: 'FIREPOWER', desc: '+15% Weapon Damage',  max: 3, cost: [1, 2, 4], apply: null },
  { id: 'reserves',  name: 'RESERVES',  desc: '+12 Start Ammo',      max: 3, cost: [1, 2, 3], apply: null },
  { id: 'quickdraw', name: 'QUICKDRAW', desc: 'Faster Fire Rate',    max: 2, cost: [2, 3],    apply: null }
];

const skills = {
  ranks: {},
  points: 0
};

function loadSkills() {
  try {
    const raw = localStorage.getItem('itm_skills');
    if (raw) {
      const data = JSON.parse(raw);
      skills.ranks = data.ranks || {};
      skills.points = data.points | 0;
    }
  } catch (e) {}
  SKILL_DEFS.forEach(s => {
    if (skills.ranks[s.id] == null) skills.ranks[s.id] = 0;
  });
}

function saveSkills() {
  try {
    localStorage.setItem('itm_skills', JSON.stringify({
      ranks: skills.ranks,
      points: skills.points
    }));
  } catch (e) {}
}

function skillRank(id) {
  return skills.ranks[id] | 0;
}

function skillCost(def) {
  const r = skillRank(def.id);
  if (r >= def.max) return null;
  return def.cost[r] != null ? def.cost[r] : (r + 1);
}

function canBuySkill(id) {
  const def = SKILL_DEFS.find(s => s.id === id);
  if (!def) return false;
  const c = skillCost(def);
  return c != null && skills.points >= c;
}

function buySkill(id) {
  const def = SKILL_DEFS.find(s => s.id === id);
  if (!def) return false;
  const c = skillCost(def);
  if (c == null || skills.points < c) return false;
  skills.points -= c;
  skills.ranks[id] = (skills.ranks[id] | 0) + 1;
  saveSkills();
  applySkillsToPlayer();
  return true;
}

function applySkillsToPlayer() {
  // base then rank
  const vit = skillRank('vitality');
  const thr = skillRank('thrusters');
  player.maxHp = 6 + vit;
  player.speed = 4.8 + thr * 0.4;
  // hp only raised to max if starting / not mid-damage
}

function skillDamageMult() {
  return 1 + skillRank('firepower') * 0.15;
}

function skillStartAmmo() {
  return (typeof STARTING_AMMO !== 'undefined' ? STARTING_AMMO : 30) + skillRank('reserves') * 12;
}

function skillCooldownScale() {
  // lower = faster
  return 1 - skillRank('quickdraw') * 0.12;
}

function awardSkillPoints(n, reason) {
  skills.points += n;
  saveSkills();
  if (typeof flashToast === 'function') flashToast('+' + n + ' SKILL PT' + (reason ? ' · ' + reason : ''));
}

function renderSkillTreeUI() {
  const root = document.getElementById('skillList');
  const pts = document.getElementById('skillPoints');
  if (pts) pts.textContent = skills.points + ' POINTS';
  if (!root) return;
  let html = '';
  SKILL_DEFS.forEach(def => {
    const r = skillRank(def.id);
    const c = skillCost(def);
    const maxed = r >= def.max;
    const can = !maxed && c != null && skills.points >= c;
    html += '<div class="skill-row">';
    html += '<div class="skill-info"><div class="skill-name">' + def.name + '  ' + r + '/' + def.max + '</div>';
    html += '<div class="skill-desc">' + def.desc + '</div></div>';
    if (maxed) {
      html += '<button type="button" class="opt-toggle off" disabled>MAX</button>';
    } else {
      html += '<button type="button" class="opt-toggle' + (can ? '' : ' off') + '" data-skill="' + def.id + '">' + c + ' PT</button>';
    }
    html += '</div>';
  });
  root.innerHTML = html;
  root.querySelectorAll('[data-skill]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (buySkill(btn.getAttribute('data-skill'))) renderSkillTreeUI();
    });
  });
}

loadSkills();
