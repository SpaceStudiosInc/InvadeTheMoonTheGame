// ════════════════════════════════════════════════════════════════
// STORY / DIALOGUE DATA  —  edit this file only for story content
// ════════════════════════════════════════════════════════════════
//
// LORE (player-facing is incomplete on purpose)
// ---------------------------------------------
// SERENITY CORP
//   Charges people for the "right" to live on Earth. Debt is the leash.
//   Player is in the Debt Forgiveness Program: clear tasks, clear the number,
//   maybe see family again. Serenity frames the Moon as hostile territory.
//
// TITANIAN  (enemy faction — player does not know the truth at start)
//   Fights for freedom of the Moon and its inhabitants.
//   Serenity labels them terrorists / hostiles / "all that moves."
//
// CHOICE PATH → DEPTH 16
// ----------------------
// Level 5  — Martian child: KILL or SPARE
// Level 10 — Captive "hostile": EXECUTE or RELEASE
// Level 15 — Serenity's deal: ACCEPT "forgiveness" or REFUSE
// Level 16 — Survive phase (built later), then ending choice:
//   • NUKE THE MOON   — always available (Serenity's order)
//   • NUKE THE EARTH  — only if SPARE (5) + RELEASE (10)
//   • DO NOTHING      — only if SPARE (5) + RELEASE (10)
//
// Dialogue plays ONLY if written under levels[depth] for that trigger.
// Pickup lines are random and always available.
//
// ════════════════════════════════════════════════════════════════

const STORY_DATA = {

  // ── Per-level story (exact depth only) ────────────────────────
  levels: {

    1: {
      mission_start: [
        { speaker: 'SERENITY', text: 'Debt Forgiveness Program. Clear the debt.' }
      ],
      enter_combat_room: [
        { speaker: 'SERENITY', text: 'Kill all that moves.' }
      ],
      open_chest: [
        { speaker: 'SERENITY', text: 'Survive to keep it.' }
      ],
      boss_key: [
        { speaker: 'SERENITY', text: 'Boss key.' }
      ],
      enter_boss: [
        { speaker: 'SERENITY', text: 'Kill the big one.' }
      ],
      boss_defeated: [
        { speaker: 'SERENITY', text: 'Exfil or continue.' }
      ]
    },
    5: {
      boss_defeated: [
        { speaker: 'SERENITY', text: 'Decision chamber open.' }
      ]
    },
    10: {
      boss_defeated: [
        { speaker: 'SERENITY', text: 'One more decision.' }
      ]
    },
    15: {
      mission_start: [
        { speaker: 'SERENITY', text: 'Depth 15. End of contract zone.' }
      ],
      boss_defeated: [
        { speaker: 'SERENITY', text: 'Step into the chamber.' }
      ]
    }
  },

  pickupWeapon: [
    [ { speaker: 'SERENITY', text: '{name}.' } ],
    [ { speaker: 'YOU', text: 'New toy.' } ]
  ],

  pickupRelic: [
    [ { speaker: 'SERENITY', text: '{name}.' } ],
    [ { speaker: 'YOU', text: 'I\'ll take it.' } ]
  ],

  // ════════════════════════════════════════════════════════════════
  // EXIT HUB CHOICES — after boss on depths 5 / 10 / 15
  // Stand on a pad → confirm → optional dialogue → elevators unlock
  //
  // id values are stored on the run. Depth 16 checks:
  //   spare_child  (level 5)
  //   release_captive (level 10)
  // ════════════════════════════════════════════════════════════════
  exitChoices: {

    5: {
      prompt: 'Child marked hostile.',
      options: [
        {
          id: 'kill_child',
          label: 'KILL',
          sub: 'ELIMINATE',
          peaceful: false,
          confirm: 'Target eliminated.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Target neutralized.' }
          ]
        },
        {
          id: 'spare_child',
          label: 'SPARE',
          sub: 'LET LIVE',
          peaceful: true,
          confirm: 'Child flees.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Deviation logged.' }
          ]
        }
      ]
    },
    10: {
      prompt: 'Bound captive. Execute?',
      options: [
        {
          id: 'execute_captive',
          label: 'EXECUTE',
          sub: 'ORDERS',
          peaceful: false,
          confirm: 'Hostile removed.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Hostile removed.' }
          ]
        },
        {
          id: 'release_captive',
          label: 'RELEASE',
          sub: 'FREE THEM',
          peaceful: true,
          confirm: 'Released.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Unauthorized release.' }
          ]
        }
      ]
    },
    15: {
      prompt: 'Forgiveness deal?',
      options: [
        {
          id: 'accept_forgiveness',
          label: 'ACCEPT',
          sub: 'DEAL',
          peaceful: false,
          confirm: 'Deal accepted.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Partial forgiveness. Service continues.' }
          ]
        },
        {
          id: 'refuse_deal',
          label: 'REFUSE',
          sub: 'NO DEAL',
          peaceful: true,
          confirm: 'Refused.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Refusal noted.' }
          ]
        }
      ]
    }
  },

  finalEndings: {
    requirePeacefulFor: ['nuke_earth', 'do_nothing'],
    options: [
      {
        id: 'nuke_moon',
        label: 'NUKE THE MOON',
        sub: 'SERENITY\'S ORDER',
        always: true,
        confirm: 'Strike authorized.',
        dialogue: [
          { speaker: 'SERENITY', text: 'Strike package armed.' }
        ]
      },
      {
        id: 'nuke_earth',
        label: 'NUKE THE EARTH',
        sub: 'TURN AROUND',
        always: false,
        confirm: 'Target: Earth.',
        dialogue: [
          { speaker: 'YOU', text: 'No.' }
        ]
      },
      {
        id: 'do_nothing',
        label: 'DO NOTHING',
        sub: 'WALK AWAY',
        always: false,
        confirm: 'No strike.',
        dialogue: [
          { speaker: 'YOU', text: 'Done.' }
        ]
      }
    ]
  }
};

if (typeof window !== 'undefined') {
  window.STORY_DATA = STORY_DATA;
}
