# Invade the Moon

Browser roguelite. Open `index.html` in a modern browser (or serve the folder locally).

## Controls

- **WASD** — move
- **Mouse** — aim
- **Click / Space** — fire
- **R** — reload
- **Q / E** — cycle weapons
- **Esc** — pause / skip dialogue

## Project layout

```
InvadeMoonHtml/
  index.html
  config.js          combat, guns, sprites, layouts
  assets.js          loading, audio, options persistence
  game.js            core loop, dungeon, combat, bosses
  game-skills.js     meta progress, relics, depth scaling
  story-data.js      story beats and exit choices
  relic-data.js      relic definitions
  assets/
    bosses/          boss1.png … boss9.png
    guns/
    music/
    sfx/
    sprites/
      relics/
```

Replace files under `assets/` to reskin. Paths are set in `config.js` (`SPRITE_PATHS`, `GUNS[].file`) and `assets.js` (SFX/music).

## Progression

- Clear the boss each depth to open the exit hub.
- **EXFIL** or **CONTINUE** both unlock the next selectable depth.
- Weapons and relics in the run bag are kept only on **EXFIL** (or when you extract). Dying loses the run bag.
- Mission Select only lists unlocked depths (1–15). Depth 16 is secret via CONTINUE after 15 with the right path.

## Loot

- **1 weapon chest** per depth.
- **No relic rooms.** Boss death drops a **relic on the floor** — walk onto it to pick up.
- Boss also restores a little HP.

## Boss types by depth

| Depths | Boss ids | Notes |
|--------|----------|--------|
| 1–4    | 1 or 2   | Mover / Nest (spawns minions) |
| 5      | 3        | Pack Leader |
| 6–9    | 4 or 5   | Blinker / Orbiter |
| 10     | 6        | Tank |
| 11–14  | 7 or 8   | Striker / Overseer |
| 15+    | 9        | Apex |

Sprites: `assets/bosses/boss1.png` … `boss9.png`. Logic: `pickBossTypeForDepth` and AI in `game.js`.

## Options

- SFX / Music + volumes
- Particles, Minimap, FPS, **Speedrun** timer
- Fullscreen
- **Reset** player data (clears localStorage meta)

## Tuning

Edit `config.js`:

- `BOSS_HP`, spawn delays, hall/column sizes
- `ROOM_LAYOUTS` / `LAYOUT_POOLS`
- `GUNS` and `RARITY` weights
- Pickup amounts

Depth scaling lives in `game-skills.js` (`depthBossHp`, `depthEnemyCountBonus`, etc.).

## Save data

localStorage keys:

- `itm_meta_v2` — max depth, unlocked guns/relics
- `itm_sfx`, `itm_music`, volumes, particles, minimap, fps, speedrun
