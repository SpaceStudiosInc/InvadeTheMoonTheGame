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
        { speaker: 'SERENITY', text: 'Welcome to Serenity Corp. Debt Forgiveness Program.' },
        { speaker: 'SERENITY', text: 'Your current balance is -$4,547,889.48.' },
        { speaker: 'SERENITY', text: 'Complete tasks to remove the negative amount.' },
        { speaker: 'SERENITY', text: 'Then you can see your family again.' },
        { speaker: 'SERENITY', text: 'Thank you for choosing Serenity Corp.' },
        { speaker: 'YOU', text: '...' }
      ],
      enter_combat_room: [
        { speaker: 'SERENITY', text: 'Kill all that moves.' }
      ],
      open_chest: [
        { speaker: 'SERENITY', text: 'You will have to survive this level to keep your rewards.' }
      ],
      boss_key: [
        { speaker: 'YOU', text: 'Ooh, shiny.' }
      ],
      enter_boss: [
        { speaker: 'SERENITY', text: 'Kill the big one.' },
        { speaker: 'YOU', text: 'Ok.' }
      ],
      boss_defeated: [
        { speaker: 'SERENITY', text: 'Exfil or continue to fulfill your debt.' }
      ]
    },

    // Optional story beats on choice depths (only if you want talk before the pads)
    5: {
      boss_defeated: [
        { speaker: 'SERENITY', text: 'Target down. Decision chamber is open. Do not hesitate.' }
      ]
    },
    10: {
      boss_defeated: [
        { speaker: 'SERENITY', text: 'Clear. One more operational decision before elevators.' }
      ]
    },
    15: {
      mission_start: [
        { speaker: 'SERENITY', text: 'Depth 15. End of the mapped contract zone.' },
        { speaker: 'SERENITY', text: 'Complete the objective. Your account review follows.' }
      ],
      boss_defeated: [
        { speaker: 'SERENITY', text: 'Mapped sector clear. Step into the chamber. Your status will be updated.' }
      ]
    }
  },

  // ════════════════════════════════════════════════════════════════
  // RANDOM PICKUP LINES
  // ════════════════════════════════════════════════════════════════
  pickupWeapon: [
    [ { speaker: 'SERENITY', text: 'Asset acquired: {name}. Survive to keep it.' } ],
    [ { speaker: 'YOU', text: 'New toy.' } ],
    [ { speaker: 'SERENITY', text: '{name} logged. Die and it goes back on the ledger.' } ],
    [ { speaker: 'SERENITY', text: 'Improved tools. Improved efficiency. Keep moving.' } ],
    [ { speaker: 'YOU', text: 'This\'ll do.' } ],
    [ { speaker: 'SERENITY', text: 'Equipment issued. Your debt does not care how it looks.' } ]
  ],

  pickupRelic: [
    [ { speaker: 'SERENITY', text: 'Anomaly secured: {name}. Extract or lose it.' } ],
    [ { speaker: 'YOU', text: 'What even is this...' } ],
    [ { speaker: 'SERENITY', text: '{name} registered. Corporate thanks you for your compliance.' } ],
    [ { speaker: 'SERENITY', text: 'Field upgrade applied. Performance metrics will improve.' } ],
    [ { speaker: 'YOU', text: 'I\'ll take it.' } ],
    [ { speaker: 'SERENITY', text: 'Relic logged. Family visitation still pending debt clearance.' } ]
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

    // LEVEL 5 — Martian child
    5: {
      prompt: 'A small Martian child is cornered in the bay. Serenity marks it hostile.',
      options: [
        {
          id: 'kill_child',
          label: 'KILL',
          sub: 'ELIMINATE TARGET',
          peaceful: false,
          confirm: 'Serenity orders elimination. The child will not leave this room.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Target neutralized. Efficiency noted.' },
            { speaker: 'YOU', text: '...' }
          ]
        },
        {
          id: 'spare_child',
          label: 'SPARE',
          sub: 'LET IT LIVE',
          peaceful: true,
          confirm: 'You ignore the mark. The child flees into the dark.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Deviation logged. Do not make a habit of mercy.' },
            { speaker: 'YOU', text: 'It was a kid.' }
          ]
        }
      ]
    },

    // LEVEL 10 — Titanian captive (still framed as "hostile" by Serenity)
    10: {
      prompt: 'A bound "hostile" kneels under the lights. Serenity wants a clean execution.',
      options: [
        {
          id: 'execute_captive',
          label: 'EXECUTE',
          sub: 'FOLLOW ORDERS',
          peaceful: false,
          confirm: 'One shot. The ledger stays clean. Serenity approves.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Hostile removed. Debt clock continues.' },
            { speaker: 'YOU', text: 'Done.' }
          ]
        },
        {
          id: 'release_captive',
          label: 'RELEASE',
          sub: 'CUT THE BINDINGS',
          peaceful: true,
          confirm: 'You cut them free. They do not thank you — they run toward the Moon dark.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Unauthorized release. Your file has been flagged.' },
            { speaker: 'YOU', text: 'They looked human enough.' }
          ]
        }
      ]
    },

    // LEVEL 15 — debt deal (tune this later if you want)
    15: {
      prompt: 'Serenity offers an accelerated forgiveness package. Sign, or walk.',
      options: [
        {
          id: 'accept_forgiveness',
          label: 'ACCEPT',
          sub: 'DEBT FORGIVEN?',
          peaceful: false,
          confirm: 'You take the deal. The number drops — and new terms attach to your name.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Partial forgiveness applied. Continued service required.' },
            { speaker: 'YOU', text: 'How much is left?' },
            { speaker: 'SERENITY', text: 'Enough.' }
          ]
        },
        {
          id: 'refuse_deal',
          label: 'REFUSE',
          sub: 'NO MORE TERMS',
          peaceful: true,
          confirm: 'You refuse the package. The debt stays. So does your name on the board.',
          dialogue: [
            { speaker: 'SERENITY', text: 'Refusal noted. Family visitation remains suspended.' },
            { speaker: 'YOU', text: 'I\'m not signing that.' }
          ]
        }
      ]
    }
  },

  // ════════════════════════════════════════════════════════════════
  // DEPTH 16 — final endings (survive phase comes later in code)
  // nuke_earth + do_nothing require peaceful path: spare_child + release_captive
  // ════════════════════════════════════════════════════════════════
  finalEndings: {
    requirePeacefulFor: ['nuke_earth', 'do_nothing'],
    options: [
      {
        id: 'nuke_moon',
        label: 'NUKE THE MOON',
        sub: 'SERENITY\'S ORDER',
        always: true,
        confirm: 'Serenity authorizes orbital strike on the lunar surface. Titanian is the target.',
        dialogue: [
          { speaker: 'SERENITY', text: 'Strike package armed. The Moon will be compliant.' },
          { speaker: 'YOU', text: '...' }
        ]
      },
      {
        id: 'nuke_earth',
        label: 'NUKE THE EARTH',
        sub: 'TURN THE GUN AROUND',
        always: false,
        confirm: 'You aim the package at Earth. At Serenity. At the ledger.',
        dialogue: [
          { speaker: 'SERENITY', text: 'Unauthorized target lock. Abort—' },
          { speaker: 'YOU', text: 'No.' }
        ]
      },
      {
        id: 'do_nothing',
        label: 'DO NOTHING',
        sub: 'WALK AWAY',
        always: false,
        confirm: 'You power down the package. No strike. No clean ending.',
        dialogue: [
          { speaker: 'YOU', text: 'I\'m done being their hands.' },
          { speaker: 'SERENITY', text: 'Silence on the channel is still a choice.' }
        ]
      }
    ]
  }
};

if (typeof window !== 'undefined') {
  window.STORY_DATA = STORY_DATA;
}
