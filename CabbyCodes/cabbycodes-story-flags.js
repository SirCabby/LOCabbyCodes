//=============================================================================
// CabbyCodes Story Flags
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Story Flags - Inspect and override story-decision variables, recruit toggles, and protagonist body state.
 * @author CabbyCodes
 * @help
 * Adds a press option that opens a three-submenu picker:
 *   <Sam>       - protagonist body state (arm state, spore head). The
 *                 label uses actor 1's live name, so it follows any
 *                 player rename.
 *   Recruits    - per-companion on/off (also adds/removes the actor from
 *                 the party so the toggle "actually" recruits them).
 *   Quest States - per-questline progression variables.
 *
 * Variable presets are tightened where the gameplay value range is known
 * (e.g. War Bomb State 0-6, Nestor 0/1/10/11). Where the encoding is
 * unknown the picker falls back to a 0..15 + landmarks list.
 *
 * Cooperates with Freeze Time by acquiring an exempt-from-restore token
 * across writes. A WARN-level log line names the flag and reports old/new
 * value on every apply so changes are easy to verify in CabbyCodes.log.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Story Flags requires CabbyCodes core.');
        return;
    }

    const SETTING_KEY = 'storyFlags';
    const LOG_PREFIX = '[CabbyCodes][StoryFlags]';

    //----------------------------------------------------------------------
    // Flag definitions
    //----------------------------------------------------------------------

    // Default preset list for variable flags whose value encoding is unknown.
    // Story-decision variables in this game empirically stay within 0..20 —
    // the earlier 0..100 list had landmarks (50, 100) that never correspond
    // to real game states, so we drop them to avoid misleading picker entries.
    const DEFAULT_VALUE_OPTIONS = numericRange(0, 20);

    const SWITCH_OPTIONS = [
        { value: 0, label: 'Off' },
        { value: 1, label: 'On' }
    ];

    function numericRange(min, max) {
        const out = [];
        for (let v = min; v <= max; v += 1) {
            out.push({ value: v, label: String(v) });
        }
        return out;
    }

    // Arm state lives in variable 187 (`armChoice`). Encoding confirmed by
    // gameplay: 0 = both arms, 1 = lost right hand, 2 = lost left hand.
    // See GAME_NOTES.md §3 for the full mechanism (sprite swap, equip seal
    // states, plugin overrides).
    const ARM_OPTIONS = [
        { value: 0, label: 'Both Arms' },
        { value: 1, label: 'Lost Right Hand' },
        { value: 2, label: 'Lost Left Hand' }
    ];

    // Per-flag shape:
    //   id, label                                - identity / display
    //   kind: 'variable' | 'switch'              - storage backing
    //   varId / switchId                         - target ID (matches kind)
    //   options                                  - picker values; defaults
    //                                              to DEFAULT_VALUE_OPTIONS
    //                                              for variables, SWITCH_OPTIONS
    //                                              for switches
    //   actorId (switch only, optional)          - actor to add/remove from
    //                                              party in sync with the
    //                                              switch (for recruits)
    //   onApplyExtra (optional)                  - callback (newValue) =>
    //                                              after-write side effects
    //                                              (e.g. arm sprite reconcile)

    // Value set for Spore Head = 'On'. Var 240 (dizzyshroom) is incremented
    // by 10..15 each Fungus Lair SporePop and decays by 1/step while
    // sporemotherDead (switch 199) is on, so 15 mirrors the in-game max and
    // gives a meaningful buffer if the decay loop is currently active. Any
    // value >= 1 triggers the mushroom sprite via CommonEvents.json CE 75
    // "updatePlayerAssets".
    const DIZZYSHROOM_ON_VALUE = 15;
    const DIZZYSHROOM_OPTIONS = [
        { value: 0, label: 'Off' },
        { value: DIZZYSHROOM_ON_VALUE, label: 'On' }
    ];

    const SACRIFICE_FLAGS = [
        { id: 'arm',        label: 'Arm State',       kind: 'variable', varId: 187, options: ARM_OPTIONS, onApplyExtra: (v) => reconcileSamAfterArmChange(v) },
        // Dizzyshroom (var 240): CE 75 swaps Chara_Player to index 1 (if
        // sporeControl switch 197 is on) or 2 (if off) whenever var 240 >= 1
        // AND switch 103 is off. Shown in the overworld AND save-slot preview.
        // Presented as On/Off via `displayAs: 'switch'` since the scalar value
        // has no gameplay meaning beyond "has spores" vs "doesn't".
        // readDisplayValue mirrors CE 75's visibility gate (var 240 >= 1 AND
        // switch 103 off) so the list row reports what's actually on-screen.
        // FungusFade (CE 82) decay is parallel-gated by switch 10, which is
        // only set on Fungus Lair maps — outside those maps var 240 can sit
        // at a residual nonzero value indefinitely without the sprite showing.
        { id: 'sporeHead',  label: 'Spore Head',      kind: 'variable', varId: 240, options: DIZZYSHROOM_OPTIONS, displayAs: 'switch', readDisplayValue: () => (readVar(240) >= 1 && !readSwitch(103)) ? 1 : 0, onApplyExtra: (v) => reconcileSamAfterDizzyshroomChange(v) },
    ];

    // Recruit switches verified via System.json line offsets AND cross-checked
    // with the dev "Recruit ALL" menu in Map003.json (which explicitly labels
    // each branch by character name). Offset is 362: switch ID = line - 362.
    // The earlier version of this file used offset 361 and had every switch
    // ID off by +1 (so e.g. toggling "Dan" actually flipped Joel's switch).
    //
    // Skipped as dead (0 reads, 0 writes per earlier usage scan, and the dev
    // menu omits them): recruitedKindface 372, recruitedMelted 373,
    // recruitedWretch 377, recruitedRoachesFull 370.
    //
    // `recruitedGoths` 363 covers multiple goth characters (user-confirmed:
    // 2 actors). We don't map a specific actorId here because the switch
    // logically represents a group; leaving actorId unset means the cheat
    // only flips the switch and leaves party membership to the game's own
    // event logic (or to the user toggling the individual recruit flags).
    //
    // Sophie has a third "Home" state in addition to Off/Recruited. After
    // the Harriet-reunion troop event in Troops.json the game flips
    // `recruitedSophie` (362) OFF and `SophieBackHome` (364) ON, then removes
    // actor 12 from the party — Sophie now stands as an NPC in
    // Apt22_Harriet (Map334) instead of following Sam. A pure on/off toggle
    // on switch 362 alone can't represent or restore that state, so the
    // Sophie entry uses custom readValue/applyValue that drive both
    // switches as a single tri-state and keep the party in sync.
    const SOPHIE_SWITCH_RECRUITED = 362;
    const SOPHIE_SWITCH_HOME = 364;
    const SOPHIE_ACTOR_ID = 12;
    const SOPHIE_OPTIONS = [
        { value: 0, label: 'Off' },
        { value: 1, label: 'Recruited' },
        { value: 2, label: 'Home' }
    ];

    // Roaches has three switches that the natural recruit (Troop 279 "Roach
    // Man" accept branch) flips together — and only flipping 369 leaves
    // Roaches missing from Sam's bathroom because the post-recruit NPC page
    // in Map004 (ApptBathroom) is gated on `roachRecruit` (249), not 369.
    //   - 369 `recruitedRoaches`     : canonical "is recruited?" flag (most
    //                                   reads in the data check this one)
    //   - 370 `recruitedRoachesFull` : companion flag read by CE 33
    //                                   (Screamatorium) and CE 205 (sqs) for
    //                                   dialogue branching
    //   - 249 `roachRecruit`         : gates the Chara_Recruit2 NPC page in
    //                                   Map004 that calls CE 137 "Talk
    //                                   Roaches" — without this, Roaches
    //                                   never appears in Sam's bathroom and
    //                                   the player can't use the in-dialog
    //                                   "Manage Party" option
    // The dev "Recruit ALL" menu in Map003 only flips 369 — that menu is a
    // quick-test convenience and is intentionally not a full recruit. The
    // cheat applies all three so toggling ON matches the post-recruit
    // game state the player would reach naturally.
    const ROACHES_SWITCH_RECRUITED = 369;
    const ROACHES_SWITCH_FULL = 370;
    const ROACHES_SWITCH_BATHROOM_NPC = 249;
    const ROACHES_ACTOR_ID = 10;

    // Rat Child recruit targets. See the flag descriptor in RECRUIT_FLAGS.
    // The rat lives in Sam's apartment (Map003 "ratbaby" event); switch 365
    // (`ratBabyIn`) is the gate for "rat is in the apartment at all". Adult
    // form additionally requires switch 290 (`ratFollows`, gates the adult
    // sprite page + joinable) and switch 366 (`ratBabyGrown`).
    // RATCHILD_SHAPE_ADULT_AVERAGE = 7 mirrors CE 94's else-branch in both
    // the intermediate-form selector (line 145) and the final-form selector
    // (line 240) — the value the natural growth lands on when no
    // disposition variable (387/389/390/392/393/394/396) dominates. Picking
    // this default keeps the cheat outcome stable regardless of how the
    // player interacted with the rat before toggling.
    //
    // We do NOT touch `peopleInAppt` (var 37) even though CE 94 block 6
    // increments it on first baby->adult: the natural game has no inverse
    // and toggling Adult->Off->Adult in the cheat would double-count. The
    // tradeoff is that taking the cheat shortcut to Adult skips that +1.
    const RATCHILD_VAR_GROWTH = 386;
    const RATCHILD_VAR_SHAPE = 388;
    const RATCHILD_SWITCH_IN_HOME = 365;
    const RATCHILD_SWITCH_FOLLOWS = 290;
    const RATCHILD_SWITCH_GROWN = 366;
    const RATCHILD_ACTOR_ID = 8;
    const RATCHILD_SHAPE_BABY = 0;
    const RATCHILD_SHAPE_ADULT_AVERAGE = 7;
    const RATCHILD_OPTIONS = [
        { value: 0, label: 'Off' },
        { value: 1, label: 'Baby' },
        { value: 2, label: 'Adult' }
    ];

    const RECRUIT_FLAGS = [
        { id: 'dan',        label: 'Dan',                   kind: 'switch', switchId: 32,  actorId: 6 },
        { id: 'joel',       label: 'Joel',                  kind: 'switch', switchId: 33,  actorId: 4 },
        { id: 'leigh',      label: 'Leigh',                 kind: 'switch', switchId: 34,  actorId: 5 },
        { id: 'hellen',     label: 'Hellen',                kind: 'switch', switchId: 35,  actorId: 7 },
        { id: 'ernest',     label: 'Ernest',                kind: 'switch', switchId: 361, actorId: 11 },
        { id: 'sophie',     label: 'Sophie',                kind: 'switch', switchId: SOPHIE_SWITCH_RECRUITED, actorId: SOPHIE_ACTOR_ID,
          options: SOPHIE_OPTIONS,
          targetLabel: `switches ${SOPHIE_SWITCH_RECRUITED}+${SOPHIE_SWITCH_HOME}`,
          readValue: () => readSophieRecruitState(),
          applyValue: (v) => applySophieRecruitState(v) },
        { id: 'goths',      label: 'Goths',                 kind: 'switch', switchId: 363 },
        { id: 'roaches',    label: 'Roaches',               kind: 'switch', switchId: ROACHES_SWITCH_RECRUITED, actorId: ROACHES_ACTOR_ID,
          targetLabel: `switches ${ROACHES_SWITCH_BATHROOM_NPC}+${ROACHES_SWITCH_RECRUITED}+${ROACHES_SWITCH_FULL}`,
          readValue: () => readRoachesRecruitState(),
          applyValue: (v) => applyRoachesRecruitState(v) },
        // Rat Child is a tri-state recruit: Off (not in the apartment),
        // Baby (in apartment but not joinable), Adult (joinable, sprite
        // swaps in Sam's apartment). Off lets the player remove the rat
        // from the home if they're already there. Tracked as `kind: 'switch'`
        // anchored on `ratBabyIn` (365) — the natural canonical "is the rat
        // around?" flag — but the read/apply pair drives all five targets
        // together (var 386, var 388, switches 290/365/366) so the row + picker
        // never fall out of step with the in-game state.
        { id: 'ratChild',   label: 'Rat Child',             kind: 'switch', switchId: RATCHILD_SWITCH_IN_HOME, actorId: RATCHILD_ACTOR_ID,
          options: RATCHILD_OPTIONS,
          targetLabel: `vars ${RATCHILD_VAR_GROWTH}+${RATCHILD_VAR_SHAPE} + switches ${RATCHILD_SWITCH_IN_HOME}+${RATCHILD_SWITCH_FOLLOWS}+${RATCHILD_SWITCH_GROWN}`,
          readValue: () => readRatChildState(),
          applyValue: (v) => applyRatChildState(v) },
        { id: 'morton',     label: 'Morton',                kind: 'switch', switchId: 371, actorId: 16 },
        { id: 'aster',      label: 'Aster',                 kind: 'switch', switchId: 374, actorId: 3 },
        { id: 'spider',     label: 'Spider',                kind: 'switch', switchId: 375, actorId: 19 },
        { id: 'lyle',       label: 'Lyle',                  kind: 'switch', switchId: 376, actorId: 2 },
        { id: 'papineau',   label: 'Papineau',              kind: 'switch', switchId: 378, actorId: 13 },
        { id: 'philippe',   label: 'Philippe',              kind: 'switch', switchId: 379, actorId: 26 },
        { id: 'audrey',     label: 'Audrey',                kind: 'switch', switchId: 380, actorId: 22 },
        { id: 'ernestTemp', label: 'Ernest (Temp Recruit)', kind: 'switch', switchId: 792 },
    ];

    // Hellen Garden Quest state. The natural progression lives in var 869
    // (`HellenQuestPhase`):
    //   0   Not Started
    //   3   Accepted (CE 235 `HellenQuest`)
    //   4-7 Early visit/dialog steps
    //   8   Visit 1 watered (CE 253 `HellenQuestPlantInteract`)
    //   9   Post-watering cutscene (Map293)
    //   10  Day 1 wait (newDay ticks 9->10)
    //   11/12/13, 14/15/16, 17 — same pattern through visits 2, 3, 4
    //   18  Fruit harvested (Map433)
    //   100 Complete (Map433)
    //   -1  Aborted (CE 235 bad dialog choice)
    //
    // The failure path layers on top via four switches; CE 6 newDay
    // (line 527-532) flips 1086 ON if a day passes while the player is in
    // a waiting phase without having watered, CE 254 `hellenSpawn` flips
    // 1087 ON to make Hellen appear stalking the player, and many `Maniac`
    // map events flip 1088 ON when the player kills the stalking Hellen.
    //
    // We expose 13 named states so the user can step through the natural
    // progression OR jump straight to any failure outcome. Switch 1085 is
    // a per-day transient — always reset to OFF on apply so a stale "you
    // watered today" doesn't suppress the next day-tick.
    const HELLEN_VAR_PHASE = 869;
    const HELLEN_SWITCH_WATERED = 1085;
    const HELLEN_SWITCH_MISSED_WATER = 1086;
    const HELLEN_SWITCH_SPAWNED = 1087;
    const HELLEN_SWITCH_CHASED_KILLED = 1088;
    const HELLEN_STATES = [
        // value is the picker ordinal; phase is the var 869 value to write.
        { value:  0, label: 'Not Started',     phase: 0,   missed: false, spawned: false, killed: false },
        { value:  1, label: 'Accepted',        phase: 3,   missed: false, spawned: false, killed: false },
        { value:  2, label: 'Pre-Watering',    phase: 7,   missed: false, spawned: false, killed: false },
        { value:  3, label: 'Day 1 Wait',      phase: 10,  missed: false, spawned: false, killed: false },
        { value:  4, label: 'Day 2 Wait',      phase: 13,  missed: false, spawned: false, killed: false },
        { value:  5, label: 'Day 3 Wait',      phase: 16,  missed: false, spawned: false, killed: false },
        { value:  6, label: 'Fruit Ripens',    phase: 17,  missed: false, spawned: false, killed: false },
        { value:  7, label: 'Fruit Harvested', phase: 18,  missed: false, spawned: false, killed: false },
        { value:  8, label: 'Complete',        phase: 100, missed: false, spawned: false, killed: false },
        { value:  9, label: 'Aborted',         phase: -1,  missed: false, spawned: false, killed: false },
        { value: 10, label: 'Missed Watering', phase: 13,  missed: true,  spawned: false, killed: false },
        { value: 11, label: 'Hellen Hostile',  phase: 13,  missed: true,  spawned: true,  killed: false },
        { value: 12, label: 'Hellen Killed',   phase: -1,  missed: true,  spawned: false, killed: true  }
    ];
    const HELLEN_OPTIONS = HELLEN_STATES.map(s => ({ value: s.value, label: s.label }));

    // Dan's NeoDuo quest. Phase var 896 (`danQuestState`) drives the
    // progression. Only the four states the player meaningfully controls
    // are exposed; the natural game ticks through intermediate phases
    // (3 at the Floor 2 apt door, 4 inside the apt, 5 with NeoDuo in hand,
    // 6 during Mom's confrontation, 10 on the way out — see Map007 EV058,
    // Map015 EV041/EV042, Map016 EV003) but those transitions all fire
    // automatically once the player is on the right map, and toggling them
    // mid-progression doesn't represent a useful intervention. Phase 1 is
    // the dead-end "I declined" branch — CE 237 has no branch for it, but
    // the cheat still exposes it so the user can drop into that state.
    const DAN_VAR_QUEST = 896;
    const DAN_STATES = [
        // value is the picker ordinal; phase is the var 896 value to write.
        { value: 0, label: 'Not Started',    phase: 0   },
        { value: 1, label: 'Declined',       phase: 1   },
        { value: 2, label: 'Accepted',       phase: 2   },
        { value: 3, label: 'Complete',       phase: 100 }
    ];
    const DAN_OPTIONS = DAN_STATES.map(s => ({ value: s.value, label: s.label }));

    // Roaches' political quest. Phase var 899 (`roachQuest`) plus switch
    // 1095 (`roachesSchism`) plus state 227 (`RoachSchism` on actor 10):
    //   0   Not Started
    //   1   Bickering Day 1 (set by CE 6 newDay once recruit switch 249 ON)
    //   2   After Day 1 chastisement (Map003 BickeringRoaches)
    //   3   Bickering Day 2 + schism flips ON (CE 6 newDay also adds state
    //       227 to actor 10 — the in-battle debuff that nerfs Roaches'
    //       element rates by 40-50% while he's politically split)
    //   4   After Day 2 chastisement (Map003 roachFriend)
    //   5   Decision Day (CE 6 newDay) — vote dialog branches in roachFriend
    //   100 Schism outcome — player declined to choose, switch 1095 stays
    //       ON, state 227 stays applied
    //   101 King outcome — Papier-Mâché Crown (armor 330) granted, state
    //       227 removed, switch 1095 OFF
    //   102 Prime Minister outcome — Official Sash (armor 331) granted,
    //       state 227 removed, switch 1095 OFF
    //
    // The cheat exposes six picker states covering the meaningful control
    // points; the in-progress phases 1-4 collapse to "Bickering" (the
    // intermediate phase is set by Map003 events the player interacts
    // with anyway). Armor rewards are NOT replicated — pick the outcome
    // here for state and use the item editor cheat for the crown/sash if
    // you want the actual gear.
    const ROACH_QUEST_VAR = 899;
    const ROACH_QUEST_SWITCH_SCHISM = 1095;
    const ROACH_QUEST_STATE_SCHISM = 227;
    const ROACH_QUEST_ACTOR = 10;
    const ROACH_QUEST_STATES = [
        // value: picker ordinal; phase: var 899; schism: switch 1095;
        // debuff: state 227 on actor 10.
        { value: 0, label: 'Not Started',       phase: 0,   schism: false, debuff: false },
        { value: 1, label: 'Bickering',         phase: 1,   schism: false, debuff: false },
        { value: 2, label: 'Decision Pending',  phase: 5,   schism: true,  debuff: true  },
        { value: 3, label: 'Schism',            phase: 100, schism: true,  debuff: true  },
        { value: 4, label: 'King',              phase: 101, schism: false, debuff: false },
        { value: 5, label: 'Prime Minister',    phase: 102, schism: false, debuff: false }
    ];
    const ROACH_QUEST_OPTIONS = ROACH_QUEST_STATES.map(s => ({ value: s.value, label: s.label }));

    // Juicebox's card-trick quest. Two variables drive it together:
    //   var 741 `juiceboxCardTrick` — the canonical card-trick state (0..3)
    //   var 287 `juiceboxTalk` — Juicebox's relationship-talk dialog stage,
    //                            which gates whether the trick can fire
    //
    // Natural progression:
    //   var 741 = 0  Not Started
    //   var 741 = 1  Card Trick Played — Map002 ev48 page 0 sets this when
    //                the player reaches dialog stage var 287 == 6: Juicebox
    //                shows the trick, the card "disappears" from the deck.
    //                The same dialog increments var 287 to 7.
    //   var 741 = 2  Card Retrieved — Map006 ev25 (Floor 1 vending machine)
    //                sets this when the player buys Cheese Stix (item 21)
    //                AND var 741 == 1; the trick card falls out alongside.
    //   var 741 = 3  Complete — Map002 ev48 page 0 top auto-advances 2 -> 3
    //                on the next bedroom visit; Juicebox bows and lets the
    //                player keep the card as a gift.
    //
    // To make "the trick can fire" a reachable state, the cheat manages
    // var 287 alongside var 741:
    //   - Not Started clamps var 287 down to <= 5 so the prerequisite isn't
    //     met (preserves any lower natural value).
    //   - Ready to Play sets var 287 = 6 exactly so the next bedroom visit
    //     fires the trick scene naturally.
    //   - Played / Retrieved / Complete bump var 287 to >= 7 (one past the
    //     trick stage), preserving any higher natural relationship arc the
    //     player has already reached.
    //
    // Vending-machine purchase (1 -> 2) is still bypassed when jumping
    // directly to "Card Retrieved" or "Complete" — the cheat doesn't grant
    // the Cheese Stix or the card item.
    const JUICEBOX_VAR_CARDTRICK = 741;
    const JUICEBOX_VAR_TALK = 287;
    const JUICEBOX_QUEST_STATES = [
        // talkClampMax: cap var 287 to this value if currently higher
        // talkExact:   set var 287 to exactly this value
        // talkMin:     bump var 287 up to this value if currently lower
        { value: 0, label: 'Not Started',       cardtrick: 0, talkClampMax: 5 },
        { value: 1, label: 'Ready to Play',     cardtrick: 0, talkExact: 6    },
        { value: 2, label: 'Card Trick Played', cardtrick: 1, talkMin: 7      },
        { value: 3, label: 'Card Retrieved',    cardtrick: 2, talkMin: 7      },
        { value: 4, label: 'Complete',          cardtrick: 3, talkMin: 7      }
    ];
    const JUICEBOX_QUEST_OPTIONS = JUICEBOX_QUEST_STATES.map(s => ({ value: s.value, label: s.label }));

    // Bedroom Plant quest. The plant lives at Map002 ev7 from the start;
    // CE 65 "Plant" runs each interaction, offering Talk / Water / Add soil /
    // Examine / Leave. Three flags drive the talk arc end-to-end:
    //   var 120 `nbTimesTalkedPlant` — the talk-progression counter (0..12+).
    //                                  Each value below has unique dialog and
    //                                  the counter increments by 1 per Talk:
    //     0  "Hey, plant! Any plans tonight?"   (only if switch 48 is OFF)
    //     1  "Hey, plant! Still growing?"
    //     2  "Pull it to the light?"            (offers a move choice that
    //                                            flips switch 79 plantMoved)
    //     3-5 routine greetings; branch on switch 79 (val 5 with sw 79 ON
    //         grants the `Misc_PlantMonster` achievement)
    //     5  (sw 79 OFF) "...uh, I wanted to tell you something..." chickens out
    //     6  "We need to talk... I love you. Do you... love me?"
    //     7  "...I understand. We're from different kingdoms."
    //         -> setAchievement("Misc_PlantRejection") fires HERE
    //     8  "I cried a little bit, but I'm okay." (friendship preserved)
    //     9  "I need more time. Maybe a succulent. Or a cactus."
    //     10 "Oh, you have someone else in mind?" (a lichen)
    //     11 routine
    //     12+ generic "What's up? Have a good day." (loops forever)
    //   switch 48 `tutorialPlant` — gates the val-0 first-talk tutorial; on
    //                                ON, the val-1+ branches run normally.
    //   switch 60 `talkedPlant`    — per-day "already talked" lock. CE 6
    //                                newDay clears it. We always reset to OFF
    //                                on apply so the next interaction reads
    //                                the new var-120 dialog without the
    //                                player having to wait a day.
    // CE 65 also gates the Talk choice itself behind switch 1004 via the
    // `WD_ConditionalChoice` plugin syntax: the first choice text in the
    // "What will you do?" menu is `(([s[1004]]))Talk.`, which the plugin
    // reads as "hide this choice when switch 1004 is ON". CE 65 turns sw1004
    // ON at the top of every interaction whenever var 37 (`peopleInAppt`)
    // >= 2 — i.e. whenever you have any companion or visitor in the
    // apartment. Saves with companions present therefore see only
    // Water / Add soil / Examine / Leave on the plant menu and the talk arc
    // is unreachable regardless of var 120 / sw 60. The cheat strips the
    // `(([s[1004]]))` prefix from the Talk choice text in $dataCommonEvents
    // on apply (idempotent — only if the prefix is still there) so Talk
    // shows even with a full apartment.
    //   switch 79 `plantMoved`     — whether the player pulled the plant to
    //                                the light at val-2. CE 65 has TWO
    //                                separate val-3+ dialog branches gated
    //                                on this switch: when sw79 is ON, the
    //                                tree only goes 3 -> 4 -> >=5
    //                                (PlantMonster achievement) and the
    //                                love/rejection content (vals 6..12+)
    //                                is unreachable. Saves where the player
    //                                pulled the plant to the light therefore
    //                                can't see rejection at all without
    //                                flipping sw79 OFF first. We force it
    //                                OFF on apply so the picker actually
    //                                lands on the rejection arc the labels
    //                                describe.
    //
    // The cheat collapses the 13 unique values onto 7 picker states focused
    // on the love/rejection arc since that's the meaningful storyline. The
    // intermediate vals 2..5 (light position, chickening out) all map onto
    // "Pre-Confession" because their dialog isn't load-bearing and the player
    // who wants to dial up rejection doesn't care which side-branch they're on.
    const PLANT_VAR_TALK = 120;
    const PLANT_SWITCH_TUTORIAL = 48;
    const PLANT_SWITCH_TALKED_TODAY = 60;
    const PLANT_SWITCH_PLANT_MOVED = 79;
    const PLANT_QUEST_STATES = [
        // value: picker ordinal; phase: var 120 to write; tutorial: switch 48
        // target state. Switch 60 is always cleared so the player can talk
        // immediately after applying.
        { value: 0, label: 'Not Started',     phase: 0,  tutorial: false },
        { value: 1, label: 'Tutorial Done',   phase: 1,  tutorial: true  },
        { value: 2, label: 'Pre-Confession',  phase: 5,  tutorial: true  },
        { value: 3, label: 'Confessing',      phase: 6,  tutorial: true  },
        { value: 4, label: 'Awaiting Reply',  phase: 7,  tutorial: true  },
        { value: 5, label: 'Rejected',        phase: 8,  tutorial: true  },
        { value: 6, label: 'Moving On',       phase: 12, tutorial: true  }
    ];
    const PLANT_QUEST_OPTIONS = PLANT_QUEST_STATES.map(s => ({ value: s.value, label: s.label }));

    // Lyle's "Mazes and Wizards" quest is a session-count quest: var 701
    // `sessionNb` is the number of completed sessions, incremented by CE 239
    // (MWCore) at the end of each tabletop session. Each value 1..6 maps to
    // one of the campaign's six adventures (each with distinct dialog and
    // location intros in CE 240); reaching 6 triggers the CE 247 CharaClosing
    // wrap-up branch. Var 700 (`MazesWizardsTalk`) and switch 1002
    // (`primeMWgame`) are transient setup mechanics — they cycle on/off
    // around each individual session start and don't represent quest
    // progression — so the picker leaves them alone.
    const MW_VAR_SESSION = 701;

    // The Masked Shadow questline. The "befriended" outcome was previously
    // exposed as a Recruits toggle on switch 27 (`recruitedShadow`), but
    // Shadow is not a normal recruit — it never joins the party, and the
    // natural game only flips switch 27 ON inside Troop 18's bedroom-
    // encounter "Can you behave?" branch, alongside switch 28 (`shadowGift`)
    // and var 150 = 20. The canonical progression variable is var 150
    // (`shadowState`); the supporting state lives in:
    //   var 150 `shadowState`     — questline phase (0..8, then 10/20/999)
    //   var 152 `shadowDispo`     — disposition counter (0..10+); newDay
    //                               advances phase 7 -> 8 once dispo >= 10
    //   switch 27  `recruitedShadow`
    //   switch 28  `shadowGift`
    //   switch 161 `shadowItemLeft` — gift parked outside Sam's apartment
    //                                 (Map006 EV040 page 1) waiting to be
    //                                 picked up
    //
    // Phase progression (verified against Troops.json troop 18 and
    // CommonEvents.json CE 6 newDay + CE 54 MaskedShadowSpawn):
    //   0   Not encountered yet
    //   1   First encounter triggered (intro dialog), advances to 2 next day
    //   2   Second encounter armed
    //   3   Second encounter triggered, advances to 4 next day
    //   4   Third encounter armed (Tongue gift dialog)
    //   5   Third encounter triggered, advances to 6 next day
    //   6   Fourth encounter armed (Shadow comes to the apartment door)
    //   7   Apartment-visit phase: switch 161 ON, gift parked at door,
    //       newDay bumps dispo +2 per day until dispo >= 10
    //   8   Bedroom encounter armed (Troop 18's "fifth encounter" branch)
    //   10  Bedroom encounter survived without befriending (the
    //       "Get out of here." / "Leave me alone." outcomes)
    //   20  Befriended — set by the "Can you behave?" sub-branch alongside
    //       sw 27 ON, sw 28 ON, achievement Recruit_Shadow
    //   999 Defeated — set by the overworld Shadow Man events (Map001 ev3
    //       et al) on battle win against troop 18
    //
    // The picker exposes 8 stable waypoints. Phase 10 reads as "Bedroom
    // Pending" since the natural game treats it as an end-state where
    // Shadow stops appearing (no further Troop 18 / Shadow_Gifts branch
    // matches), and the cheat user re-applying any state from there gets
    // a clean restart.
    const SHADOW_VAR_STATE = 150;
    const SHADOW_VAR_DISPO = 152;
    const SHADOW_SWITCH_RECRUITED = 27;
    const SHADOW_SWITCH_GIFT = 28;
    const SHADOW_SWITCH_ITEM_LEFT = 161;
    const SHADOW_STATES = [
        // value: picker ordinal; phase: var 150; dispo: var 152;
        // recruited/gift/itemLeft: switches 27/28/161.
        { value: 0, label: 'Not Started',         phase: 0,   dispo: 0,  recruited: false, gift: false, itemLeft: false },
        { value: 1, label: 'After 1st Encounter', phase: 2,   dispo: 0,  recruited: false, gift: false, itemLeft: false },
        { value: 2, label: 'After 2nd Encounter', phase: 4,   dispo: 0,  recruited: false, gift: false, itemLeft: false },
        { value: 3, label: 'After 3rd Encounter', phase: 6,   dispo: 1,  recruited: false, gift: false, itemLeft: false },
        { value: 4, label: 'Gift At Apartment',   phase: 7,   dispo: 5,  recruited: false, gift: false, itemLeft: true  },
        { value: 5, label: 'Bedroom Pending',     phase: 8,   dispo: 10, recruited: false, gift: false, itemLeft: false },
        { value: 6, label: 'Befriended',          phase: 20,  dispo: 10, recruited: true,  gift: true,  itemLeft: false },
        { value: 7, label: 'Defeated',            phase: 999, dispo: 0,  recruited: false, gift: false, itemLeft: false }
    ];
    const SHADOW_OPTIONS = SHADOW_STATES.map(s => ({ value: s.value, label: s.label }));

    // Frederic questline ("the painter's apartment"). The painter, Frederic,
    // made 9 self-portraits that came to life and now share a hive-mind with
    // him. Each portrait roams a specific map as a hostile NPC; killing one
    // in battle (a) sets its state var to 99, (b) flips a self switch on
    // its event so the dead-body page renders next time the map evaluates,
    // and (c) decrements `PortraitsLeft` (var 306). When the player visits
    // the Painter NPC (CE 327, the original Frederic / var 305 `PainterState`)
    // with `PortraitsLeft` below the matching threshold, the Painter hands
    // out a tiered reward. Once a single portrait remains alive, the final
    // reward branch fires (paint palette + thank-you cutscene).
    //
    // The Faceless / Portrait5 hat side-event (var 313, switch 535
    // `portrait5Friendly`, switches 523/524/525 part-kill flags) is a
    // separate beat layered on top of Portrait5's encounter; the cheat
    // sets var 313 to 99 / 0 to flip the wall painting + Painter dialog
    // gate, but does NOT touch Portrait5's roaming-NPC self switches
    // because the natural game spreads Faceless across many events on
    // Map119/Map042/Map217/Map236/Map237 with a multi-stage encounter
    // (parts split, hat clamp, body possession). Reviving Portrait5 from
    // the cheat reopens var 313 but leaves any partially-played hat events
    // in their existing self-switch state — the player may need to visit
    // the relevant maps to clean up if they had started the encounter.
    //
    // Per-portrait state encoding: each portrait has its own state variable
    // with its own alive-progression (Portrait1 0..8, Portrait2 1..5/90..93,
    // Portrait4 1..5/10, etc.) but ALL of them use 99 as the canonical
    // "dead" sentinel (verified by enumerating Code 122 writes across
    // CommonEvents.json + every Map*.json). So setting "dead" is uniform
    // even though "alive" varies; we write 0 for the survivor (= pre-
    // encounter / undisturbed) and let the player encounter that Frederic
    // naturally if they haven't already.
    //
    // Painter reward gate (CE 327 conditionals, verified):
    //   var 305 == 1 AND var 306 <= 8 -> turpentine
    //   var 305 == 2 AND var 306 <= 7 -> canvas carry bag
    //   var 305 == 3 AND var 306 <= 5 -> medical supplies
    //   var 305 == 4 AND var 306 <= 1 -> paint palette (final, sets var 305=5)
    // For "Last Alive" / "All Killed" cheat states we set var 305 = 4 so the
    // next visit to the Painter NPC fires the final reward branch directly;
    // intermediate rewards (turpentine/canvas/medical) are skipped — grab
    // them via the item editor cheat if you want them.
    //
    // Roaming-NPC mapping. Each portrait has one canonical map event whose
    // page-0 "alive" branch runs the battle and flips a specific self switch
    // ON to render the dead-body page on subsequent renders. Verified by
    // enumerating code 122 writes (var = 99) AND code 123 (self switch)
    // commands across every map. The cheat mirrors both halves of the
    // natural game's death write — set the state var AND flip the dead
    // self-switch — so the roaming NPC actually swaps to dead-body, and
    // the wall portrait in the painter's living room (Map217 events
    // 12/14/16/17/18/19/21/23, all gated on `state var == 99`) shows
    // the framed painting. Reviving instead clears the state var to 0
    // AND clears all four self switches (A/B/C/D) on the event so the
    // alive page wins again.
    const FREDERIC_PORTRAIT_VARS = {
        1: 304, // Portrait1_state
        2: 308, // Portrait2_state
        3: 309, // Portrait3_state
        4: 311, // Portrait4_state
        5: 313, // Portrait5_state (Faceless — also has the hat side-event)
        6: 315, // Portrait6_state
        7: 320, // Portrait7_state
        8: 302, // Portrait8
        9: 300  // Portrait9
    };
    // Roaming-NPC event for each portrait. `deadSelfSwitch` is the self
    // switch the natural battle-event flips ON to render the dead-body
    // page. Portrait5 is null because Faceless spans many events across
    // many maps and the multi-stage hat encounter doesn't reduce to one
    // self-switch flip — the cheat only manages var 313 for that one and
    // accepts that revival/death will be visually approximate until the
    // player actually re-engages or skips the side event.
    const FREDERIC_PORTRAIT_NPCS = {
        1: { mapId: 95,  eventId: 8,  deadSelfSwitch: 'C' },
        2: { mapId: 96,  eventId: 23, deadSelfSwitch: 'D' },
        3: { mapId: 236, eventId: 17, deadSelfSwitch: 'C' },
        4: { mapId: 238, eventId: 2,  deadSelfSwitch: 'C' },
        5: null,
        6: { mapId: 237, eventId: 16, deadSelfSwitch: 'B' },
        7: { mapId: 218, eventId: 2,  deadSelfSwitch: 'C' },
        8: { mapId: 97,  eventId: 25, deadSelfSwitch: 'C' },
        9: { mapId: 239, eventId: 6,  deadSelfSwitch: 'C' }
    };
    const FREDERIC_PORTRAIT_DEAD = 99;
    const FREDERIC_PORTRAIT_ALIVE = 0;
    const FREDERIC_SELF_SWITCH_KEYS = ['A', 'B', 'C', 'D'];
    const FREDERIC_PAINTER_VAR = 305;
    const FREDERIC_PORTRAITS_LEFT_VAR = 306;
    const FREDERIC_PAINTER_REWARD_READY = 4;
    const FREDERIC_PAINTER_INITIAL = 0;
    const FREDERIC_PAINTER_ACCEPTED = 1;
    // PortraitsLeft initial value seen in CE 327 line 98 — var 306 is set
    // to 10 on first meeting the Painter (10 = symbolic, the dialog itself
    // says "9 of them in total"). Decrements to 1 when only one survivor
    // remains, at which point the final-reward branch fires.
    const FREDERIC_PORTRAITS_INITIAL = 10;
    const FREDERIC_PAINTER_DEAD = 99;
    const FREDERIC_PAINTER_REWARD_GIVEN = 5;
    // Per-portrait labels reflect the most distinctive in-game trait so
    // the picker reads naturally instead of "Portrait 1..9". Sourced from
    // each portrait's troop dialog (Troops.json 328..336):
    //   1 var 304 Tumor    - shifting flesh mass; drops {Tumor Lumps}
    //   2 var 308 Ring     - claims a "red-gem ring"; gives a refrigerator
    //   3 var 309 Rage     - calm, gives {Rage Armor} companion gear
    //   4 var 311 Godly    - "WE ARE FREDERIC THE MANY" deity persona
    //   5 var 313 Hat      - parasitic hat / Faceless side-event; splits
    //                        in combat (this is the one we leave alone)
    //   6 var 315 Closet   - hides in closet, paranoid of the others
    //   7 var 320 Healer   - heals party HP; gives {Medic-in-a-jar}
    //   8 var 302 Shy      - "DON'T LOOK AT ME"; refuses to be seen
    //   9 var 300 Faceless - the original Frederic whose face was stolen;
    //                        accepts {Torn-Off Face} to paint gear duplicates
    const FREDERIC_QUEST_STATES = [
        // value: picker ordinal. Encoding:
        //   survivor: number 1..9         -> "<Name> Frederic Last Alive"
        //   survivor: 'painter'           -> "Painter Last Alive" (all 9 portraits dead, Painter NPC alive)
        //   survivor: null + allDead:true -> "All Killed" (all 10 Fredrics dead, Painter included)
        //   survivor: null                -> "Not Started" / "In Progress" (don't reconcile portraits)
        { value: 0,  label: 'Not Started',                  survivor: null,      allDead: false, painter: FREDERIC_PAINTER_INITIAL,      portraitsLeft: FREDERIC_PORTRAITS_INITIAL },
        { value: 1,  label: 'In Progress',                  survivor: null,      allDead: false, painter: FREDERIC_PAINTER_ACCEPTED,     portraitsLeft: 9 },
        { value: 2,  label: 'Tumor Frederic Last Alive',    survivor: 1,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        { value: 3,  label: 'Ring Frederic Last Alive',     survivor: 2,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        { value: 4,  label: 'Rage Frederic Last Alive',     survivor: 3,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        { value: 5,  label: 'Godly Frederic Last Alive',    survivor: 4,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        { value: 6,  label: 'Hat Frederic Last Alive',      survivor: 5,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        { value: 7,  label: 'Closet Frederic Last Alive',   survivor: 6,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        { value: 8,  label: 'Healer Frederic Last Alive',   survivor: 7,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        { value: 9,  label: 'Shy Frederic Last Alive',      survivor: 8,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        { value: 10, label: 'Faceless Frederic Last Alive', survivor: 9,         allDead: false, painter: FREDERIC_PAINTER_REWARD_READY, portraitsLeft: 1 },
        // Painter Last Alive: the natural "good ending". Player has killed
        // all 9 portrait copies; the Painter NPC is still around at his
        // post-reward state (var 305 = 5, paint palette given). Distinct
        // from "All Killed" — that one folds the Painter into the death
        // sweep too (var 305 = 99) for a "no Frederic survives" state.
        { value: 11, label: 'Painter Last Alive',           survivor: 'painter', allDead: true,  painter: FREDERIC_PAINTER_REWARD_GIVEN, portraitsLeft: 0 },
        { value: 12, label: 'All Killed',                   survivor: null,      allDead: true,  painter: FREDERIC_PAINTER_DEAD,         portraitsLeft: 0 }
    ];
    const FREDERIC_QUEST_OPTIONS = FREDERIC_QUEST_STATES.map(s => ({ value: s.value, label: s.label }));
    const FREDERIC_PORTRAIT_INDICES = Object.keys(FREDERIC_PORTRAIT_VARS).map(n => Number(n));

    // Charan questline (basement-pit big-friend arc). The player jumps in
    // the basement pit, lands on Charan (an enormous fleshy librarian-
    // creature) instead of dying, and works through a small social arc
    // culminating in the rose gift. State spans one disposition variable
    // and five switches:
    //   var 630  `CharanDispo`         — first-encounter flag. Troop 590
    //                                    page 0 flips this 0 -> 1 on the
    //                                    initial meet; subsequent pit
    //                                    visits skip the intro dialog.
    //   sw  677  `CharanLeaveEarly`    — set ON by CE 6 newDay the day
    //                                    after `gaveCharanRose` (680)
    //                                    flips ON. While ON, CE 213's
    //                                    pit-jump branches into the
    //                                    `goCave` -100 HP fall instead of
    //                                    the friendly `seeCharan` catch.
    //   sw  678  `shookCharanhand`     — set ON by the "(Shake hands)"
    //                                    choice on first encounter.
    //   sw  679  `CharanMentionedLove` — set ON by Troop 590's "Need any
    //                                    help?" branch (gated on day-of-
    //                                    week var 15 >= 5). Required to
    //                                    unlock the "About that gift..."
    //                                    choice that takes the rose.
    //   sw  680  `gaveCharanRose`      — set ON by handing over Rose
    //                                    (item 360) inside the gift
    //                                    sub-menu. Drives CE 6 newDay's
    //                                    leave-early write the next day.
    //   sw 1064  `charanGift`          — set ON by CE 213's seeCharan
    //                                    branch when sw 680 is already
    //                                    ON, representing the medieval-
    //                                    sword thank-you. Encoded as a
    //                                    switch only (no `code:126 Add
    //                                    Item` write — the dialog
    //                                    narrates the sword without
    //                                    actually placing one in
    //                                    inventory), so the cheat just
    //                                    mirrors the flag.
    //
    // The picker exposes 6 stable waypoints. Var 816 (`CharanLift`, set to
    // 100 on every seeCharan catch) and var 815 (`CharanJob`, 1..6 from
    // the chat job-recommendation choice) are written by the natural game
    // but nothing reads either, so they're cosmetic and the cheat leaves
    // them alone. Var 629 (`SmoochCount`) is similarly skipped.
    const CHARAN_VAR_DISPO = 630;
    const CHARAN_SWITCH_LEAVE_EARLY = 677;
    const CHARAN_SWITCH_SHOOK_HAND = 678;
    const CHARAN_SWITCH_MENTIONED_LOVE = 679;
    const CHARAN_SWITCH_GAVE_ROSE = 680;
    const CHARAN_SWITCH_SWORD_GIFT = 1064;
    const CHARAN_STATES = [
        // value: picker ordinal; dispo: var 630; leaveEarly/shookHand/
        // mentionedLove/gaveRose/swordGift: switches 677/678/679/680/1064.
        { value: 0, label: 'Not Started',     dispo: 0, leaveEarly: false, shookHand: false, mentionedLove: false, gaveRose: false, swordGift: false },
        { value: 1, label: 'Met Charan',      dispo: 1, leaveEarly: false, shookHand: true,  mentionedLove: false, gaveRose: false, swordGift: false },
        { value: 2, label: 'Mentioned Love',  dispo: 1, leaveEarly: false, shookHand: true,  mentionedLove: true,  gaveRose: false, swordGift: false },
        { value: 3, label: 'Rose Given',      dispo: 1, leaveEarly: false, shookHand: true,  mentionedLove: true,  gaveRose: true,  swordGift: false },
        { value: 4, label: 'Sword Received',  dispo: 1, leaveEarly: false, shookHand: true,  mentionedLove: true,  gaveRose: true,  swordGift: true  },
        { value: 5, label: 'Charan Left',     dispo: 1, leaveEarly: true,  shookHand: true,  mentionedLove: true,  gaveRose: true,  swordGift: true  }
    ];
    const CHARAN_OPTIONS = CHARAN_STATES.map(s => ({ value: s.value, label: s.label }));

    // Kevin questline (basement-worm Worm-Egg trader). Kevin lives at
    // Map094 ev43 (`footwormGrpBa`) and trades through Troop 560 — when
    // the player walks onto the event the troop's friendly-encounter
    // page hands out Worm Juice / Worm-Baked Pie / Worm-O'-Nine-Tails /
    // Wormskin Robe / Worm Crown in exchange for Worm Eggs (item 382).
    // The cheat does NOT track which trades have happened or grant any
    // of the reward items — those are inventory state the player can
    // grant directly via the item-editor cheat. This entry exists only
    // to make Kevin REACHABLE without grinding the prerequisite Nestor
    // questline.
    //
    // Natural appearance gate (Map094 ev43 page 0):
    //   • var 437 (`nestorBodyState`) >= 12, AND
    //   • self-switch C on the same event is OFF (page 1 takes over once
    //     C is ON and renders an empty post-encounter sprite).
    //
    // Var 437 is the Nestor-questline state machine. Worm body-part
    // events scattered across many maps (Map007/009/012/013/026/027/047/
    // 054/092/094/104/131/132/338) write 1..5 / 10 as the player whittles
    // down Nestor's anatomy; CE 6 newDay then increments the var by 1
    // each day while sw 448 (`wormBodyDead`) is OFF, walking it past
    // 10 -> 11 (foot-worm groups in Map013 + Map092 begin spawning) ->
    // 12 (Kevin's group becomes active in Map094). So var 437 == 12
    // represents "Nestor questline reached the body-part trickle phase
    // plus 2 in-game days of newDay ticks". There is no Kevin-specific
    // gate that doesn't also bump nestorBodyState — bumping the var
    // unavoidably touches the rest of the Nestor questline by however
    // many days are still missing, so the cheat does the smallest
    // possible bump (exactly to 12) and documents the trade-off.
    //
    // The picker is a 2-state Off / On toggle:
    //   Not Available -> if var 437 >= 12, clamp it back down to 11
    //                    (preserves the foot-worm threshold while
    //                    closing Kevin's gate). Self-switch C on the
    //                    Map094 event is left alone so a player who
    //                    organically engaged Kevin keeps that state.
    //   Available     -> var 437 = max(current, 12); the Map094 ev43
    //                    self-switch C is cleared so any prior post-
    //                    encounter state on the event flips back to
    //                    page 0 (the friendly-encounter trigger).
    //                    $gameMap.requestRefresh() runs at the end so
    //                    the sprite swap is visible immediately if the
    //                    player is currently on Map094.
    //
    // Var 735 (`WormDeal`) — the orthogonal "long-term coexistence"
    // deal outcome — is intentionally not managed: the natural game
    // grants the `Misc_WormyDeal` achievement via a setAchievement
    // script call inside Troop 560's deal sub-menu, so writing var 735
    // alone would not award the achievement. Var 734 (`WormKevin`,
    // trade-tier high-water mark) and switches 961/962 (`wormBoughtRobe`
    // / `wormBoughtCrown`, "already bought" hide-gates on the trade
    // menu) are similarly untouched — once Kevin is reachable the
    // player handles trades naturally through the in-game menu.
    const KEVIN_NESTOR_VAR = 437;
    const KEVIN_NESTOR_THRESHOLD = 12;
    const KEVIN_NESTOR_PRE_GATE = 11;
    const KEVIN_MAP_ID = 94;
    const KEVIN_EVENT_ID = 43;
    const KEVIN_POST_SELFSW = 'C';
    const KEVIN_STATES = [
        { value: 0, label: 'Not Available' },
        { value: 1, label: 'Available'     }
    ];
    const KEVIN_OPTIONS = KEVIN_STATES.map(s => ({ value: s.value, label: s.label }));

    // Marshall is the leg/foot member of Nestor's worm-anatomy chase. Pre-
    // mutation he's a disembodied voice in the Map054 (bathroom) StallDoor2
    // event (event 2; var 733 `MarshallStall` cycles his wisdom dialog 0..10).
    // After the player triggers the worm-spawn beat at Map094 ev11 `Nestor`
    // (var 281 `nestorState` == 10 → flips switch 422 `FirstWormPartsSpawned`
    // ON), Marshall ev41 on Map054 materializes as the foot-worm.
    //
    // Foot-chase progression lives in var 435 (`nestorFootChase`):
    //   0   Pre-mutation — Marshall ev41 has no matching page; no worm walks
    //   4   Chase armed — page 0 renders Chara_Worms idx 5 patrolling; collision
    //         flips selfSwitch B to escalate the encounter
    //   5   Battle armed — page 2 fires Troop 558 (Marshall, enemy 576 base
    //         Worm/WormLeg) on contact; on win sets switch 451 `wormfootDead` ON
    //   10  Stronger phase — a separate Map054 event fires Troop 559
    //         (Marshall2, enemy 577 Worm/WormLeg_Attack3) — same post-battle
    //         bookkeeping flips switch 451 ON, plus var 544 `bossesKilled` += 1
    //
    // switch 451 `wormfootDead` is the canonical "Marshall the worm has been
    // killed" sentinel; once it's ON, Marshall ev41's defeated page wins
    // (Chara_Worms idx 5 frozen) and the WormFoot battle ev30 is bypassed.
    //
    // We expose 4 picker states. The dialog-stage var 733 `MarshallStall` is
    // left alone — the natural game leaves the bathroom stall talkable forever
    // regardless of whether Marshall has mutated, and rewinding it would
    // discard any wisdom-progression the player has banked. Var 544
    // `bossesKilled` is also untouched — picking "Defeated" doesn't synthesize
    // a kill credit since that var is shared across every boss in the game.
    //
    // Side-effect note: switch 422 (`FirstWormPartsSpawned`) is shared across
    // Nestor's whole body-part fleet (head/hand/body/foot). Forcing it ON to
    // expose Marshall also exposes any other body-part NPC whose own chase
    // var (434/436/437) is already primed; conversely, clearing it for
    // In Stall hides every body-part NPC (page conditions on head/hand/body
    // worms also require sw 422 ON), effectively rewinding the post-Nestor
    // worm-spawn beat. The alternative (ID-walking the fleet to leave 422
    // alone) would either let other worms appear when picking In Stall or
    // silently mis-gate them when picking Mutated, so the cheat keeps
    // switch 422 in lock-step with Marshall's chosen state and documents
    // the trade-off here.
    const MARSHALL_VAR_FOOT_CHASE = 435;
    const MARSHALL_SWITCH_PARTS_SPAWNED = 422;
    const MARSHALL_SWITCH_FOOT_DEAD = 451;
    const MARSHALL_FOOT_CHASE_INITIAL = 0;
    const MARSHALL_FOOT_CHASE_BATTLE = 5;
    const MARSHALL_FOOT_CHASE_STRONGER = 10;
    const MARSHALL_STATES = [
        // value: picker ordinal; footChase: var 435; partsSpawned: switch 422;
        // footDead: switch 451.
        { value: 0, label: 'In Stall',           footChase: MARSHALL_FOOT_CHASE_INITIAL,  partsSpawned: false, footDead: false },
        { value: 1, label: 'Mutated',            footChase: MARSHALL_FOOT_CHASE_BATTLE,   partsSpawned: true,  footDead: false },
        { value: 2, label: 'Mutated (Stronger)', footChase: MARSHALL_FOOT_CHASE_STRONGER, partsSpawned: true,  footDead: false },
        { value: 3, label: 'Defeated',           footChase: MARSHALL_FOOT_CHASE_STRONGER, partsSpawned: true,  footDead: true  }
    ];
    const MARSHALL_OPTIONS = MARSHALL_STATES.map(s => ({ value: s.value, label: s.label }));

    // Fuzzy Quest — Joel's teddy bear (and the rat-child events that change
    // it). Seven weapon variants exist in $dataWeapons, all etypeId 1, all
    // exclusive to Joel (actor 4):
    //   91  Fuzzy           — Joel's starting weapon (Actors.json line 134).
    //   170 Fluff Ball      — set by CommonEvents.json CE 92 (`childTalk`)
    //                          var 614 (`ratInteractState`) == 2 branch:
    //                          rat shreds Fuzzy, Joel loses 91 / gains 170.
    //   171 Fuzzy's Remains — same CE, var 614 == 3 branch (gated on
    //                          switch 396 `ratCanTalk` ON): rat apologizes,
    //                          Joel loses 170 / gains 171.
    //   172 Repaired Fuzzy  — Eugene Shop (Troops.json troop 117) "check-up"
    //                          path; var 190 (`EugeneRepairingFuzzy`) walks
    //                          0→1→2→3→4 across CE 6 newDay ticks plus
    //                          repeated shop visits before this is granted.
    //   173 Mangled Fuzzy   — Sam sews Fuzzy himself at the Map333 (Eugene's
    //                          apt) sewing-machine event; gated on Joel
    //                          equipping 171, no var-190 progression.
    //   174 Renegade Fuzzy  — Xaria/Monty patch it (CommonEvents.json,
    //                          ~line 203959). Joel hands them 171 and gets
    //                          169 "Empty Handed" interim, then 174 later.
    //   175 Worm Fuzzy      — Nestor (Troops.json troop 118) "fixes" it,
    //                          sets var 190 = 6.
    //
    // The picker lets the player pick which variant Joel wields. We do NOT
    // try to replicate the var-190 state machine — its 0..6 progression
    // spans CE 6 daily ticks and three different troops, and writing
    // arbitrary intermediate values would mis-gate Eugene/Nestor dialog
    // unnecessarily. Instead we own only the part the player cares about:
    //   1. Inventory + equip slot. Add 1 of the target weapon, equip Joel
    //      slot 1 with it (which moves it from inventory to equipped via
    //      Game_Actor.tradeItemWithParty), then sweep all other Fuzzy
    //      variants out of inventory so the player ends up with exactly
    //      one Fuzzy on Joel and zero held copies.
    //   2. Var 614 (ratInteractState). For any state past Pristine, bump
    //      var 614 ≥ 3 so the natural shred event at var 614 == 2 cannot
    //      re-fire and overwrite the cheat. For Pristine, clamp var 614
    //      down to ≤ 1 so the natural shred can still play organically if
    //      the player wants to walk through the rat-Joel arc.
    //
    // Joel does not need to be in the party — `$gameActors.actor(4)` works
    // regardless, and the equip writes through to actor state that
    // persists when he later joins. Var 190 (`EugeneRepairingFuzzy`) is
    // intentionally untouched — applying "Repaired by Eugene" leaves
    // Eugene's dialog stuck on its current branch, but the player can
    // re-engage Eugene to nudge the conversation if they want it
    // resynced; bumping var 190 ourselves risks mis-gating Nestor's
    // var-190 == 6 path (Worm Fuzzy) and the CE 6 daily-tick rules.
    const FUZZY_ACTOR_ID = 4;
    const FUZZY_WEAPON_ETYPE = 1; // changeEquipById uses etypeId, not slotId
    const FUZZY_VAR_INTERACT = 614;
    const FUZZY_INTERACT_SHRED_PHASE = 2;
    const FUZZY_INTERACT_POST_APOLOGY = 3;
    const FUZZY_INTERACT_PRE_SHRED = 1;
    const FUZZY_STATES = [
        { value: 0, label: 'Pristine',           weaponId: 91  },
        { value: 1, label: 'Shredded',           weaponId: 170 },
        { value: 2, label: 'Remains',            weaponId: 171 },
        { value: 3, label: 'Repaired by Eugene', weaponId: 172 },
        { value: 4, label: 'Mangled by Sam',     weaponId: 173 },
        { value: 5, label: 'Renegade (Xaria)',   weaponId: 174 },
        { value: 6, label: 'Worm (Nestor)',      weaponId: 175 }
    ];
    const FUZZY_WEAPON_IDS = FUZZY_STATES.map(s => s.weaponId);
    const FUZZY_OPTIONS = FUZZY_STATES.map(s => ({ value: s.value, label: s.label }));

    // Quest-state variables. Each entry needs a real understanding of what
    // the variable drives in-game; speculative entries on under-investigated
    // variables previously lived here (Joel/Papineau/Lyle/Nestor/Goth/
    // WarBomb/RatHole/RatInteract/ErnestTimes/SpiderHusk/Sybil/Dan)
    // and were removed because their semantics weren't load-bearing for
    // any actual cheat workflow. Add new entries here only when there's a
    // verified mapping from option values to in-game state.
    const QUEST_FLAGS = [
        // Audrey's advice can stock (var 751 `vendingMachf1_Advice`). CE 216
        // sets the initial stock to 8, decrements by 1 per interaction, and
        // grants a one-shot +99 when the player completes the restock branch
        // ("I can restock whenever I want now!"). Game-side dialog branches
        // explicitly on 0/1/2/3/4+. There's no engine-enforced cap, so 999
        // is a generous practical max well beyond anything the natural game
        // produces.
        { id: 'audreyCans',    label: 'Audrey Advice Cans',   kind: 'variable', varId: 751, options: [0, 1, 2, 3, 4, 8, 99, 999].map(v => ({ value: v, label: String(v) })) },
        // Hellen's garden quest. Compound state covering the linear watering
        // progression plus the failure path (missed watering -> hostile
        // spawn -> killed). See the HELLEN_* constants block above.
        { id: 'hellenGarden',  label: 'Hellen Garden Quest',  kind: 'variable', varId: HELLEN_VAR_PHASE,
          options: HELLEN_OPTIONS,
          displayAs: 'switch',
          targetLabel: `var ${HELLEN_VAR_PHASE} + switches ${HELLEN_SWITCH_MISSED_WATER}+${HELLEN_SWITCH_SPAWNED}+${HELLEN_SWITCH_CHASED_KILLED}`,
          readValue: () => readHellenGardenState(),
          applyValue: (v) => applyHellenGardenState(v) },
        // Bedroom Plant quest — talk arc culminating in the love-confession
        // and rejection branch. See the PLANT_* constants block above.
        { id: 'plantQuest',    label: 'Plant Quest',          kind: 'variable', varId: PLANT_VAR_TALK,
          options: PLANT_QUEST_OPTIONS,
          displayAs: 'switch',
          targetLabel: `var ${PLANT_VAR_TALK} + switches ${PLANT_SWITCH_TUTORIAL}+${PLANT_SWITCH_TALKED_TODAY}+${PLANT_SWITCH_PLANT_MOVED}`,
          readValue: () => readPlantQuestState(),
          applyValue: (v) => applyPlantQuestState(v) },
        // Dan's NeoDuo retrieval quest. See the DAN_* constants block above.
        { id: 'danQuest',      label: 'Dan Quest',            kind: 'variable', varId: DAN_VAR_QUEST,
          options: DAN_OPTIONS,
          displayAs: 'switch',
          targetLabel: `var ${DAN_VAR_QUEST}`,
          readValue: () => readDanQuestState(),
          applyValue: (v) => applyDanQuestState(v) },
        // Roaches' political schism quest. See the ROACH_QUEST_* block above.
        { id: 'roachQuest',    label: 'Roaches Quest',        kind: 'variable', varId: ROACH_QUEST_VAR,
          options: ROACH_QUEST_OPTIONS,
          displayAs: 'switch',
          targetLabel: `var ${ROACH_QUEST_VAR} + switch ${ROACH_QUEST_SWITCH_SCHISM} + state ${ROACH_QUEST_STATE_SCHISM} on actor ${ROACH_QUEST_ACTOR}`,
          readValue: () => readRoachQuestState(),
          applyValue: (v) => applyRoachQuestState(v) },
        // Juicebox's card-trick quest. See the JUICEBOX_* block above.
        { id: 'juiceboxQuest', label: 'Juicebox Quest',       kind: 'variable', varId: JUICEBOX_VAR_CARDTRICK,
          options: JUICEBOX_QUEST_OPTIONS,
          displayAs: 'switch',
          targetLabel: `vars ${JUICEBOX_VAR_CARDTRICK}+${JUICEBOX_VAR_TALK}`,
          readValue: () => readJuiceboxQuestState(),
          applyValue: (v) => applyJuiceboxQuestState(v) },
        // The Masked Shadow questline. See the SHADOW_* constants block above.
        { id: 'shadowQuest',   label: 'Shadow Quest',         kind: 'variable', varId: SHADOW_VAR_STATE,
          options: SHADOW_OPTIONS,
          displayAs: 'switch',
          targetLabel: `vars ${SHADOW_VAR_STATE}+${SHADOW_VAR_DISPO} + switches ${SHADOW_SWITCH_RECRUITED}+${SHADOW_SWITCH_GIFT}+${SHADOW_SWITCH_ITEM_LEFT}`,
          readValue: () => readShadowQuestState(),
          applyValue: (v) => applyShadowQuestState(v) },
        // Frederic / Painter questline — pick which of the 9 portraits
        // survives, or set "All Killed" / "Not Started" / "In Progress".
        // See the FREDERIC_* constants block above.
        { id: 'fredericQuest', label: 'Frederic Quest',       kind: 'variable', varId: FREDERIC_PAINTER_VAR,
          options: FREDERIC_QUEST_OPTIONS,
          displayAs: 'switch',
          targetLabel: `vars ${FREDERIC_PAINTER_VAR}+${FREDERIC_PORTRAITS_LEFT_VAR} + 9 portrait state vars`,
          readValue: () => readFredericQuestState(),
          applyValue: (v) => applyFredericQuestState(v) },
        // Charan questline — basement-pit big-friend arc. See the CHARAN_*
        // constants block above.
        { id: 'charanQuest',   label: 'Charan Quest',         kind: 'variable', varId: CHARAN_VAR_DISPO,
          options: CHARAN_OPTIONS,
          displayAs: 'switch',
          targetLabel: `var ${CHARAN_VAR_DISPO} + switches ${CHARAN_SWITCH_LEAVE_EARLY}+${CHARAN_SWITCH_SHOOK_HAND}+${CHARAN_SWITCH_MENTIONED_LOVE}+${CHARAN_SWITCH_GAVE_ROSE}+${CHARAN_SWITCH_SWORD_GIFT}`,
          readValue: () => readCharanQuestState(),
          applyValue: (v) => applyCharanQuestState(v) },
        // Kevin questline — basement-worm trade availability. See the
        // KEVIN_* constants block above.
        { id: 'kevinQuest',    label: 'Kevin Quest',          kind: 'variable', varId: KEVIN_NESTOR_VAR,
          options: KEVIN_OPTIONS,
          displayAs: 'switch',
          targetLabel: `var ${KEVIN_NESTOR_VAR} + Map${KEVIN_MAP_ID} ev${KEVIN_EVENT_ID} self-sw ${KEVIN_POST_SELFSW}`,
          readValue: () => readKevinQuestState(),
          applyValue: (v) => applyKevinQuestState(v) },
        // Marshall questline — pre-mutation voice in the bathroom stall vs.
        // foot-worm chase phases vs. defeated. See the MARSHALL_* constants
        // block above.
        { id: 'marshallQuest', label: 'Marshall Quest',       kind: 'variable', varId: MARSHALL_VAR_FOOT_CHASE,
          options: MARSHALL_OPTIONS,
          displayAs: 'switch',
          targetLabel: `var ${MARSHALL_VAR_FOOT_CHASE} + switches ${MARSHALL_SWITCH_PARTS_SPAWNED}+${MARSHALL_SWITCH_FOOT_DEAD}`,
          readValue: () => readMarshallQuestState(),
          applyValue: (v) => applyMarshallQuestState(v) },
        // Fuzzy quest — pick which Fuzzy variant Joel wields (the rat-child
        // shred + apology + repair paths grant 7 different weapons). See
        // the FUZZY_* constants block above.
        { id: 'fuzzyQuest',    label: 'Fuzzy Quest',          kind: 'variable', varId: FUZZY_VAR_INTERACT,
          options: FUZZY_OPTIONS,
          displayAs: 'switch',
          targetLabel: `actor ${FUZZY_ACTOR_ID} weapon slot + var ${FUZZY_VAR_INTERACT}`,
          readValue: () => readFuzzyQuestState(),
          applyValue: (v) => applyFuzzyQuestState(v) },
        // Lyle's Mazes and Wizards campaign — sessions completed (var 701).
        // Each session is a distinct adventure; 6 = wrap-up.
        { id: 'mazesWizardsQuest', label: 'Mazes and Wizards', kind: 'variable', varId: MW_VAR_SESSION,
          options: [
              { value: 0, label: '0 / Not Started' },
              { value: 1, label: '1 / Tavern Village' },
              { value: 2, label: '2 / Wilderness' },
              { value: 3, label: '3 / Mysterious Temple' },
              { value: 4, label: '4 / City of Daggerback' },
              { value: 5, label: '5 / Death Barrens' },
              { value: 6, label: '6 / Complete' }
          ] },
        // David's sewer-rescue quest. Compound state spans 10 individual
        // savedKid* switches (770..779) plus 7 SewerKids_* "encountered"
        // vars (725..731) plus the global counters (var 723/724), so the
        // standard one-shot value picker can't represent it. Selecting the
        // row pushes a dedicated per-kid management scene instead — see
        // cabbycodes-sewer-kids.js for the scene + apply path. The row's
        // value text shows a live "saved/total" summary so the player can
        // see overall progress at a glance from the Quest States list.
        { id: 'sewerKidsQuest', label: 'Sewer Kids Quest', kind: 'variable', varId: 724,
          targetLabel: 'vars 723+724 + 7 SewerKids_* vars + 10 savedKid* switches',
          formatValue: () => (typeof CabbyCodes.getSewerKidsSummary === 'function')
              ? CabbyCodes.getSewerKidsSummary()
              : '?',
          onSelect: () => {
              if (typeof CabbyCodes.openSewerKidsScene === 'function') {
                  return CabbyCodes.openSewerKidsScene();
              }
              CabbyCodes.warn(`${LOG_PREFIX} Sewer Kids module unavailable.`);
              SoundManager.playBuzzer();
              return false;
          } },
    ];

    // The 'sacrifices' category label is rebuilt at menu-open time from the
    // protagonist's live actor-1 name (Sam by default, but renameable), so the
    // label here is just a placeholder that openCategoriesMenu overwrites.
    //
    // 'videoGames' is an external category: instead of rendering a flag list,
    // selecting it hands off to cabbycodes-video-games.js's own scene via
    // CabbyCodes.openVideoGamesScene(). The onSelect callback returns true on
    // a successful push and false if blocked (no session, module missing) so
    // the categories window can re-activate itself instead of stranding input.
    const CATEGORIES = [
        { id: 'sacrifices', label: 'Sam...',          helpText: 'Body state of the protagonist.', flags: SACRIFICE_FLAGS },
        { id: 'recruits',   label: 'Recruits...',     helpText: 'Toggle companions.', flags: RECRUIT_FLAGS },
        { id: 'quests',     label: 'Quest States...', helpText: 'Per-questline progression variables.', flags: QUEST_FLAGS },
        { id: 'videoGames', label: 'Video Games...',  helpText: 'Plays left and skill per cartridge.', onSelect: () => {
            if (typeof CabbyCodes.openVideoGamesScene === 'function') {
                return CabbyCodes.openVideoGamesScene();
            }
            CabbyCodes.warn(`${LOG_PREFIX} Video Games module unavailable.`);
            SoundManager.playBuzzer();
            return false;
        } },
    ];

    // Module-level state so popped scenes can be re-created without losing
    // their context. SceneManager.pop() rebuilds scenes from scratch, so
    // anything we passed via prepareNextScene is gone — closure constants
    // are the only reliable source.
    let _activeCategoryId = null;

    function findCategory(categoryId) {
        return CATEGORIES.find(c => c.id === categoryId) || null;
    }

    //----------------------------------------------------------------------
    // Setting registration + entry point
    //----------------------------------------------------------------------

    const PICKER_WIDTH = 480;
    const PICKER_SPACING = 12;
    const PICKER_MAX_ROWS = 10;

    CabbyCodes.registerSetting(SETTING_KEY, 'Story Flags', {
        defaultValue: 0,
        order: 104,
        formatValue: () => 'Press',
        onActivate: () => {
            openCategoriesMenu();
            return true;
        }
    });

    function isSessionReady() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function' && !CabbyCodes.isGameSessionActive()) {
            return false;
        }
        return true;
    }

    function readVar(varId) {
        const raw = Number($gameVariables.value(varId));
        return Number.isFinite(raw) ? raw : 0;
    }

    function readSwitch(switchId) {
        return $gameSwitches.value(switchId) ? 1 : 0;
    }

    function readFlag(flag) {
        if (flag && typeof flag.readValue === 'function') {
            return flag.readValue();
        }
        if (flag.kind === 'switch') {
            return readSwitch(flag.switchId);
        }
        return readVar(flag.varId);
    }

    // Some flags (e.g. Spore Head) have a visible in-game state that depends
    // on more than the single variable we write to. A `readDisplayValue()` on
    // the flag descriptor overrides `readFlag` for list rows and the value
    // picker's "Current:" line so the cheat reflects what the player sees
    // rather than the raw backing variable.
    function readFlagForDisplay(flag) {
        if (flag && typeof flag.readDisplayValue === 'function') {
            return flag.readDisplayValue();
        }
        return readFlag(flag);
    }

    function flagOptions(flag) {
        if (Array.isArray(flag.options) && flag.options.length > 0) {
            return flag.options;
        }
        return flag.kind === 'switch' ? SWITCH_OPTIONS : DEFAULT_VALUE_OPTIONS;
    }

    // A variable-backed flag may opt into switch-style On/Off rendering via
    // `displayAs: 'switch'`. The value itself is still stored as a number
    // (e.g. var 240 writes 0 or 15), but the list row and value-picker header
    // read "On"/"Off" instead of "= 15".
    function rendersAsSwitch(flag) {
        if (!flag) {
            return false;
        }
        return flag.kind === 'switch' || flag.displayAs === 'switch';
    }

    function flagTargetLabel(flag) {
        if (flag && typeof flag.targetLabel === 'string' && flag.targetLabel) {
            return flag.targetLabel;
        }
        return flag.kind === 'switch'
            ? `switch ${flag.switchId}`
            : `var ${flag.varId}`;
    }

    // Switch-style flags default to On/Off rendering, but when a custom
    // `options` list is supplied (e.g. Sophie's Off/Recruited/Home tri-state)
    // we want the row + picker header to show the matching option label
    // instead. Falls back to On/Off if no option matches the current value.
    function switchValueLabel(flag, value) {
        if (flag && Array.isArray(flag.options) && flag.options.length > 0) {
            const matched = flag.options.find(o => o.value === value);
            if (matched) {
                return matched.label;
            }
        }
        return value ? 'On' : 'Off';
    }

    // Resolve the protagonist's current display name. The default is "Sam",
    // but the player can rename actor 1 at the start of the game, so we read
    // the live name and fall back to "Sam" only if the actor isn't available.
    function resolvePlayerName() {
        if (typeof $gameActors !== 'undefined' && $gameActors) {
            const sam = $gameActors.actor(1);
            if (sam && typeof sam.name === 'function') {
                const name = sam.name();
                if (name) {
                    return name;
                }
            }
        }
        return 'Sam';
    }

    function openCategoriesMenu() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session.`);
            SoundManager.playBuzzer();
            return;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesStoryFlagsCategories === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or scene unavailable.`);
            return;
        }
        const playerCat = findCategory('sacrifices');
        if (playerCat) {
            playerCat.label = `${resolvePlayerName()}...`;
        }
        SceneManager.push(Scene_CabbyCodesStoryFlagsCategories);
    }

    function openFlagListFor(categoryId) {
        if (!isSessionReady()) {
            SoundManager.playBuzzer();
            return;
        }
        _activeCategoryId = categoryId;
        SceneManager.push(Scene_CabbyCodesStoryFlags);
    }

    function openValuePickerFor(flag) {
        if (!isSessionReady()) {
            SoundManager.playBuzzer();
            return;
        }
        SceneManager.push(Scene_CabbyCodesStoryFlagValue);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene({
                flag,
                initialValue: readFlag(flag),
                onSelect: (value) => applyFlag(flag, value)
            });
        }
    }

    //----------------------------------------------------------------------
    // Apply path
    //----------------------------------------------------------------------

    function applyFlag(flag, newValue) {
        if (!isSessionReady()) {
            return false;
        }
        if (flag && typeof flag.applyValue === 'function') {
            return flag.applyValue(newValue);
        }
        if (flag.kind === 'switch') {
            return applySwitchFlag(flag, newValue);
        }
        return applyVariableFlag(flag, newValue);
    }

    function applyVariableFlag(flag, newValue) {
        const oldValue = readVar(flag.varId);
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ variables: [flag.varId] })
            : { release: () => {} };
        try {
            $gameVariables.setValue(flag.varId, newValue);
            CabbyCodes.warn(`${LOG_PREFIX} ${flag.label} (var ${flag.varId}): ${oldValue} -> ${newValue}. Read-back: ${readVar(flag.varId)}.`);
            if (typeof flag.onApplyExtra === 'function') {
                flag.onApplyExtra(newValue);
            }
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for ${flag.label}: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    function applySwitchFlag(flag, newValue) {
        const wantOn = Boolean(newValue);
        const oldOn = Boolean(readSwitch(flag.switchId));
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ switches: [flag.switchId] })
            : { release: () => {} };
        try {
            $gameSwitches.setValue(flag.switchId, wantOn);
            const partyNote = syncActorParty(flag, wantOn);
            CabbyCodes.warn(`${LOG_PREFIX} ${flag.label} (switch ${flag.switchId}): ${oldOn} -> ${wantOn}. Read-back: ${Boolean(readSwitch(flag.switchId))}.${partyNote}`);
            if (typeof flag.onApplyExtra === 'function') {
                flag.onApplyExtra(wantOn ? 1 : 0);
            }
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for ${flag.label}: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Sophie tri-state (Off / Recruited / Home) ----
    //
    // Mirrors the Harriet-reunion troop event: when Sophie returns home the
    // game flips switch 362 OFF and switch 364 ON, then removes actor 12 from
    // the party. We expose all three states as a single picker value so
    // selecting "Home" reproduces the post-reunion state without the player
    // having to play through the encounter, and so a save with switch 364
    // already ON reads as "Home" in the list (instead of misleadingly "Off").

    function readSophieRecruitState() {
        if (readSwitch(SOPHIE_SWITCH_RECRUITED)) {
            return 1;
        }
        if (readSwitch(SOPHIE_SWITCH_HOME)) {
            return 2;
        }
        return 0;
    }

    function sophieStateLabel(value) {
        const opt = SOPHIE_OPTIONS.find(o => o.value === value);
        return opt ? opt.label : String(value);
    }

    function applySophieRecruitState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const wantRecruited = newValue === 1;
        const wantHome = newValue === 2;
        const oldState = readSophieRecruitState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ switches: [SOPHIE_SWITCH_RECRUITED, SOPHIE_SWITCH_HOME] })
            : { release: () => {} };
        try {
            $gameSwitches.setValue(SOPHIE_SWITCH_RECRUITED, wantRecruited);
            $gameSwitches.setValue(SOPHIE_SWITCH_HOME, wantHome);
            // Sophie is only in the party while "Recruited"; "Home" and "Off"
            // both leave actor 12 out (Home = standing in Apt22_Harriet,
            // Off = pre-recruit baseline).
            const partyNote = syncActorParty({ actorId: SOPHIE_ACTOR_ID, label: 'Sophie' }, wantRecruited);
            const readBack = readSophieRecruitState();
            CabbyCodes.warn(`${LOG_PREFIX} Sophie (switches ${SOPHIE_SWITCH_RECRUITED}+${SOPHIE_SWITCH_HOME}): ${sophieStateLabel(oldState)} -> ${sophieStateLabel(newValue)}. Read-back: ${sophieStateLabel(readBack)}.${partyNote}`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Sophie: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Roaches recruit (drives 3 switches + party) ----
    //
    // ON  = Troop 279's accept branch outcome: 249/369/370 all ON, actor 10
    //       in party (so Roaches stands as a talkable NPC in Sam's bathroom
    //       and the Talk Roaches "Manage Party" choice is reachable).
    // OFF = baseline: all three switches OFF, actor 10 not in party.
    //
    // Read state from the canonical `recruitedRoaches` (369). If a save has
    // 249 or 370 ON without 369 (would only happen via a manual flag edit),
    // the row reads OFF and toggling ON normalises all three.

    function readRoachesRecruitState() {
        return readSwitch(ROACHES_SWITCH_RECRUITED) ? 1 : 0;
    }

    function applyRoachesRecruitState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const wantOn = Boolean(newValue);
        const oldOn = Boolean(readRoachesRecruitState());
        const switchIds = [
            ROACHES_SWITCH_BATHROOM_NPC,
            ROACHES_SWITCH_RECRUITED,
            ROACHES_SWITCH_FULL
        ];
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ switches: switchIds })
            : { release: () => {} };
        try {
            switchIds.forEach(id => $gameSwitches.setValue(id, wantOn));
            const partyNote = syncActorParty({ actorId: ROACHES_ACTOR_ID, label: 'Roaches' }, wantOn);
            const readBack = readRoachesRecruitState();
            CabbyCodes.warn(`${LOG_PREFIX} Roaches (switches ${switchIds.join('+')}): ${oldOn} -> ${wantOn}. Read-back: ${Boolean(readBack)}.${partyNote}`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Roaches: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Rat Child recruit (Off / Baby / Adult) ----
    //
    // Off   = rat not in the apartment (switch 365 OFF). Removes the rat
    //         NPC from Sam's apartment and clears all growth state. Lets
    //         the player evict the rat without playing through CE 92's
    //         "give the rat away" branch.
    // Baby  = rat is in the apartment but not joinable. Switch 365 ON,
    //         growth state cleared (var 388 = 0, var 386 = 0), Follows/
    //         Grown switches OFF. Actor 8 not in party.
    // Adult = post-growth state. Switch 365 ON, switches 290 + 366 ON,
    //         var 388 = 7 (the average-rat default form). Actor 8 added
    //         to the party so the player doesn't need to walk back to the
    //         apartment and use CE 92's "Manage Party" choice to bring
    //         them along.
    //
    // CE 94 "ratchildDay" can cascade through every growth phase in a
    // single call when ratGrowth is high enough, but its growth messages
    // are gated on CHEATMODE (switch 7), so the cascade is silent for
    // normal players; the apartment sprite also only re-evaluates on map
    // refresh. We write the end-state directly and request a refresh so
    // the toggle has an immediate visible effect.

    function readRatChildState() {
        if (!readSwitch(RATCHILD_SWITCH_IN_HOME)) {
            return 0;
        }
        if (readSwitch(RATCHILD_SWITCH_FOLLOWS)) {
            return 2;
        }
        return 1;
    }

    function ratChildStateLabel(value) {
        const opt = RATCHILD_OPTIONS.find(o => o.value === value);
        return opt ? opt.label : String(value);
    }

    function applyRatChildState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const wantOff = newValue === 0;
        const wantAdult = newValue === 2;
        const oldState = readRatChildState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [RATCHILD_VAR_GROWTH, RATCHILD_VAR_SHAPE],
                switches: [RATCHILD_SWITCH_IN_HOME, RATCHILD_SWITCH_FOLLOWS, RATCHILD_SWITCH_GROWN]
            })
            : { release: () => {} };
        try {
            $gameSwitches.setValue(RATCHILD_SWITCH_IN_HOME, !wantOff);
            $gameSwitches.setValue(RATCHILD_SWITCH_FOLLOWS, wantAdult);
            $gameSwitches.setValue(RATCHILD_SWITCH_GROWN, wantAdult);
            $gameVariables.setValue(
                RATCHILD_VAR_SHAPE,
                wantAdult ? RATCHILD_SHAPE_ADULT_AVERAGE : RATCHILD_SHAPE_BABY
            );
            $gameVariables.setValue(RATCHILD_VAR_GROWTH, 0);
            // Actor 8 is only in the party as Adult; Off and Baby both
            // remove (Off = rat absent, Baby = present but not joinable).
            const partyNote = syncActorParty({ actorId: RATCHILD_ACTOR_ID, label: 'Rat Child' }, wantAdult);
            if (typeof $gameMap !== 'undefined' && $gameMap && typeof $gameMap.requestRefresh === 'function') {
                $gameMap.requestRefresh();
            }
            const readBack = readRatChildState();
            CabbyCodes.warn(`${LOG_PREFIX} Rat Child (vars ${RATCHILD_VAR_GROWTH}+${RATCHILD_VAR_SHAPE}, switches ${RATCHILD_SWITCH_IN_HOME}+${RATCHILD_SWITCH_FOLLOWS}+${RATCHILD_SWITCH_GROWN}): ${ratChildStateLabel(oldState)} -> ${ratChildStateLabel(newValue)}. Read-back: ${ratChildStateLabel(readBack)}.${partyNote}`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Rat Child: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Hellen Garden Quest (compound progression + failure outcomes) ----
    //
    // Read priority: failure switches dominate over var 869 because the
    // hostile/killed states layer on top of any waiting phase. Var 869's
    // natural progression spends time at every integer 0..18 plus 100 and
    // -1, but only a subset are stable "waypoints"; the rest are mid-step
    // transients (e.g. 4-6 in Map092/Map294 visit dialog, 8 just-watered,
    // 9 post-water cutscene). Range matching maps each transient to the
    // labeled state that owns its phase block so the row reflects "where
    // am I right now?" rather than snapping to a single magic value.

    function readHellenGardenState() {
        if (readSwitch(HELLEN_SWITCH_CHASED_KILLED)) {
            return 12;
        }
        if (readSwitch(HELLEN_SWITCH_SPAWNED)) {
            return 11;
        }
        if (readSwitch(HELLEN_SWITCH_MISSED_WATER)) {
            return 10;
        }
        const phase = readVar(HELLEN_VAR_PHASE);
        if (phase < 0) return 9;            // Aborted (-1)
        if (phase >= 100) return 8;         // Complete
        if (phase >= 18) return 7;          // Fruit Harvested (18..99)
        if (phase >= 17) return 6;          // Fruit Ripens (17)
        if (phase >= 14) return 5;          // Day 3 Wait covers 14, 15, 16
        if (phase >= 11) return 4;          // Day 2 Wait covers 11, 12, 13
        if (phase >= 8)  return 3;          // Day 1 Wait covers 8, 9, 10
        if (phase >= 7)  return 2;          // Pre-Watering (7)
        if (phase >= 3)  return 1;          // Accepted covers 3, 4, 5, 6
        return 0;                            // Not Started covers 0, 1, 2
    }

    function hellenGardenStateLabel(value) {
        const s = HELLEN_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyHellenGardenState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = HELLEN_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readHellenGardenState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [HELLEN_VAR_PHASE],
                switches: [
                    HELLEN_SWITCH_WATERED,
                    HELLEN_SWITCH_MISSED_WATER,
                    HELLEN_SWITCH_SPAWNED,
                    HELLEN_SWITCH_CHASED_KILLED
                ]
            })
            : { release: () => {} };
        try {
            $gameVariables.setValue(HELLEN_VAR_PHASE, target.phase);
            // Always reset 1085 so a stale "watered today" doesn't suppress
            // the next newDay tick the natural game uses to advance phase.
            $gameSwitches.setValue(HELLEN_SWITCH_WATERED, false);
            $gameSwitches.setValue(HELLEN_SWITCH_MISSED_WATER, target.missed);
            $gameSwitches.setValue(HELLEN_SWITCH_SPAWNED, target.spawned);
            $gameSwitches.setValue(HELLEN_SWITCH_CHASED_KILLED, target.killed);
            CabbyCodes.warn(`${LOG_PREFIX} Hellen Garden: ${hellenGardenStateLabel(oldValue)} -> ${hellenGardenStateLabel(newValue)}. var ${HELLEN_VAR_PHASE}=${target.phase}, sw ${HELLEN_SWITCH_MISSED_WATER}=${target.missed}/${HELLEN_SWITCH_SPAWNED}=${target.spawned}/${HELLEN_SWITCH_CHASED_KILLED}=${target.killed}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Hellen Garden: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Dan NeoDuo Quest (single-variable progression) ----
    //
    // Read uses range matching so the transient phase values the natural
    // game progresses through (3..99) all show as "Accepted" — toggling
    // back to "Accepted" from any of those would no-op the user-visible
    // state since the in-progress maps would still gate on their specific
    // phase value, but the row label still reflects "the player accepted
    // and is somewhere in the middle of doing it".

    function readDanQuestState() {
        const phase = readVar(DAN_VAR_QUEST);
        if (phase >= 100) return 3;       // Complete
        if (phase >= 2)   return 2;       // Accepted (covers 2..99)
        if (phase === 1)  return 1;       // Declined
        return 0;                          // Not Started
    }

    function danQuestStateLabel(value) {
        const s = DAN_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyDanQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = DAN_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readDanQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ variables: [DAN_VAR_QUEST] })
            : { release: () => {} };
        try {
            $gameVariables.setValue(DAN_VAR_QUEST, target.phase);
            CabbyCodes.warn(`${LOG_PREFIX} Dan Quest: ${danQuestStateLabel(oldValue)} -> ${danQuestStateLabel(newValue)}. var ${DAN_VAR_QUEST}=${target.phase}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Dan Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Roaches Quest (compound progression + 3 outcomes + debuff state) ----
    //
    // Read priority is exact phase match for the three terminal outcomes
    // (100/101/102) so the row reflects which decision was made; otherwise
    // range-collapse phases 1-4 onto "Bickering" since those transitions
    // are advanced by Map003 events the player interacts with anyway.

    function readRoachQuestState() {
        const phase = readVar(ROACH_QUEST_VAR);
        if (phase === 102) return 5;     // Prime Minister
        if (phase === 101) return 4;     // King
        if (phase === 100) return 3;     // Schism
        if (phase >= 5)    return 2;     // Decision Pending
        if (phase >= 1)    return 1;     // Bickering (covers 1..4)
        return 0;                         // Not Started
    }

    function roachQuestStateLabel(value) {
        const s = ROACH_QUEST_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyRoachQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = ROACH_QUEST_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readRoachQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [ROACH_QUEST_VAR],
                switches: [ROACH_QUEST_SWITCH_SCHISM]
            })
            : { release: () => {} };
        try {
            $gameVariables.setValue(ROACH_QUEST_VAR, target.phase);
            $gameSwitches.setValue(ROACH_QUEST_SWITCH_SCHISM, target.schism);
            // State 227 (`RoachSchism`) on actor 10 is the in-battle debuff
            // the natural game adds at phase 2->3 and removes at the King/PM
            // branches. Mirror it here so picking an outcome via the cheat
            // doesn't leave a stale debuff or a missing one. No-op if actor
            // 10 isn't loaded (Roaches not recruited yet).
            let stateNote = '';
            if (typeof $gameActors !== 'undefined' && $gameActors) {
                const roaches = $gameActors.actor(ROACH_QUEST_ACTOR);
                if (roaches) {
                    const isAffected = typeof roaches.isStateAffected === 'function' && roaches.isStateAffected(ROACH_QUEST_STATE_SCHISM);
                    if (target.debuff && !isAffected && typeof roaches.addState === 'function') {
                        roaches.addState(ROACH_QUEST_STATE_SCHISM);
                        stateNote = ` Added state ${ROACH_QUEST_STATE_SCHISM} to actor ${ROACH_QUEST_ACTOR}.`;
                    } else if (!target.debuff && isAffected && typeof roaches.removeState === 'function') {
                        roaches.removeState(ROACH_QUEST_STATE_SCHISM);
                        stateNote = ` Removed state ${ROACH_QUEST_STATE_SCHISM} from actor ${ROACH_QUEST_ACTOR}.`;
                    }
                }
            }
            CabbyCodes.warn(`${LOG_PREFIX} Roaches Quest: ${roachQuestStateLabel(oldValue)} -> ${roachQuestStateLabel(newValue)}. var ${ROACH_QUEST_VAR}=${target.phase}, sw ${ROACH_QUEST_SWITCH_SCHISM}=${target.schism}, state ${ROACH_QUEST_STATE_SCHISM}=${target.debuff}.${stateNote}`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Roaches Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Juicebox Quest (var 741 card-trick + var 287 prerequisite) ----
    //
    // Read priority: var 741 dominates because the card-trick variable has
    // unambiguous values (1..3 each map to one outcome). Only when var 741
    // is 0 do we look at var 287 to distinguish "Ready to Play" (>=6, the
    // dialog stage where the trick auto-fires) from "Not Started" (<6).

    function readJuiceboxQuestState() {
        const cardtrick = readVar(JUICEBOX_VAR_CARDTRICK);
        if (cardtrick >= 3) return 4;     // Complete
        if (cardtrick === 2) return 3;    // Card Retrieved
        if (cardtrick === 1) return 2;    // Card Trick Played
        const talk = readVar(JUICEBOX_VAR_TALK);
        if (talk >= 6) return 1;          // Ready to Play
        return 0;                          // Not Started
    }

    function juiceboxQuestStateLabel(value) {
        const s = JUICEBOX_QUEST_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyJuiceboxQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = JUICEBOX_QUEST_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readJuiceboxQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ variables: [JUICEBOX_VAR_CARDTRICK, JUICEBOX_VAR_TALK] })
            : { release: () => {} };
        try {
            $gameVariables.setValue(JUICEBOX_VAR_CARDTRICK, target.cardtrick);
            // Reconcile var 287 per the state's clamp/exact/min directive.
            const curTalk = readVar(JUICEBOX_VAR_TALK);
            let newTalk = curTalk;
            if (typeof target.talkExact === 'number') {
                newTalk = target.talkExact;
            } else if (typeof target.talkMin === 'number' && curTalk < target.talkMin) {
                newTalk = target.talkMin;
            } else if (typeof target.talkClampMax === 'number' && curTalk > target.talkClampMax) {
                newTalk = target.talkClampMax;
            }
            if (newTalk !== curTalk) {
                $gameVariables.setValue(JUICEBOX_VAR_TALK, newTalk);
            }
            CabbyCodes.warn(`${LOG_PREFIX} Juicebox Quest: ${juiceboxQuestStateLabel(oldValue)} -> ${juiceboxQuestStateLabel(newValue)}. var ${JUICEBOX_VAR_CARDTRICK}=${target.cardtrick}, var ${JUICEBOX_VAR_TALK}=${newTalk}${newTalk !== curTalk ? ` (was ${curTalk})` : ''}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Juicebox Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Plant Quest (talk arc -> love confession -> rejection) ----
    //
    // var 120 increments by 1 per Talk and never decrements. Map ranges
    // back to picker ordinals: vals 0,1 are uniquely named, 2..5 collapse
    // onto "Pre-Confession" (chickens out / side branches), 6 is the
    // confession, 7 is the rejection-fires-this-talk state, 8..11 are the
    // friend-zone aftermath, 12+ is the generic loop.

    function readPlantQuestState() {
        const phase = readVar(PLANT_VAR_TALK);
        if (phase >= 12)               return 6;   // Moving On
        if (phase >= 8 && phase <= 11) return 5;   // Rejected (friend zone)
        if (phase === 7)               return 4;   // Awaiting Reply
        if (phase === 6)               return 3;   // Confessing
        if (phase >= 2 && phase <= 5)  return 2;   // Pre-Confession
        if (phase === 1)               return 1;   // Tutorial Done
        return 0;                                   // Not Started
    }

    function plantQuestStateLabel(value) {
        const s = PLANT_QUEST_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    // CE 65's "What will you do?" choice command is at $dataCommonEvents[65]
    // .list[13] (code 102). Choice text 0 is the Talk option, prefixed with
    // `(([s[1004]]))` so the WD_ConditionalChoice plugin hides it whenever
    // sw1004 is ON. CE 65 itself flips sw1004 ON at the top of the interaction
    // when peopleInAppt >= 2, so any save with a companion present sees the
    // gate fire on every visit. Strip the prefix in-place; idempotent.
    function ensurePlantTalkChoiceVisible() {
        if (typeof $dataCommonEvents === 'undefined' || !$dataCommonEvents) {
            return 'no-data';
        }
        const ce = $dataCommonEvents[65];
        if (!ce || !Array.isArray(ce.list)) {
            return 'no-ce65';
        }
        for (let i = 0; i < ce.list.length; i += 1) {
            const cmd = ce.list[i];
            if (!cmd || cmd.code !== 102) {
                continue;
            }
            const params = cmd.parameters;
            if (!Array.isArray(params) || !Array.isArray(params[0])) {
                continue;
            }
            const choices = params[0];
            for (let c = 0; c < choices.length; c += 1) {
                if (typeof choices[c] === 'string' && /^Talk\.|\(\(\[s\[1004\]\]\)\)Talk\./.test(choices[c])) {
                    if (choices[c].startsWith('(([s[1004]]))')) {
                        choices[c] = choices[c].replace('(([s[1004]]))', '');
                        return 'stripped';
                    }
                    return 'already-clean';
                }
            }
        }
        return 'no-talk-choice';
    }

    function applyPlantQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = PLANT_QUEST_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readPlantQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [PLANT_VAR_TALK],
                switches: [PLANT_SWITCH_TUTORIAL, PLANT_SWITCH_TALKED_TODAY, PLANT_SWITCH_PLANT_MOVED]
            })
            : { release: () => {} };
        try {
            $gameVariables.setValue(PLANT_VAR_TALK, target.phase);
            $gameSwitches.setValue(PLANT_SWITCH_TUTORIAL, target.tutorial);
            // Always clear the daily talked-today lock so the next plant
            // interaction reads the new var-120 dialog without the player
            // having to wait until newDay (CE 6) clears it.
            $gameSwitches.setValue(PLANT_SWITCH_TALKED_TODAY, false);
            // Force the plant back to its default position. CE 65 only
            // renders the love/rejection branch (var 120 vals 6..12+) when
            // sw79 is OFF; saves where the player pulled the plant to the
            // light have it ON and would otherwise stay stuck on the
            // PlantMonster branch regardless of var 120.
            $gameSwitches.setValue(PLANT_SWITCH_PLANT_MOVED, false);
            // Strip the `(([s[1004]]))` hide-gate from CE 65's Talk choice so
            // the talk arc is reachable even with companions in the
            // apartment (var 37 >= 2). See the comment on
            // ensurePlantTalkChoiceVisible above for the full rationale.
            const talkChoiceFix = ensurePlantTalkChoiceVisible();
            // Read back through the public engine API so the log captures
            // what the next CE-65 conditional will actually see — not just
            // what we asked for. Diverging from `target.phase` here means
            // some other interceptor blocked or rewrote the value.
            const readbackVar = readVar(PLANT_VAR_TALK);
            const readbackSwTutorial = readSwitch(PLANT_SWITCH_TUTORIAL);
            const readbackSwTalked = readSwitch(PLANT_SWITCH_TALKED_TODAY);
            const readbackSwMoved = readSwitch(PLANT_SWITCH_PLANT_MOVED);
            // Also dump the gates that CE 65 checks before reaching the
            // var-120 dialog tree, so we can tell at a glance whether the
            // talk branch is even reachable from the player's current state.
            const introFinished = readVar(103);
            const peopleInAppt = readVar(37);
            const mapId = (typeof $gameMap !== 'undefined' && $gameMap && typeof $gameMap.mapId === 'function') ? $gameMap.mapId() : '?';
            CabbyCodes.warn(`${LOG_PREFIX} Plant Quest: ${plantQuestStateLabel(oldValue)} -> ${plantQuestStateLabel(newValue)}. wrote var ${PLANT_VAR_TALK}=${target.phase} sw ${PLANT_SWITCH_TUTORIAL}=${target.tutorial} sw ${PLANT_SWITCH_TALKED_TODAY}=false sw ${PLANT_SWITCH_PLANT_MOVED}=false. readback var ${PLANT_VAR_TALK}=${readbackVar} sw ${PLANT_SWITCH_TUTORIAL}=${!!readbackSwTutorial} sw ${PLANT_SWITCH_TALKED_TODAY}=${!!readbackSwTalked} sw ${PLANT_SWITCH_PLANT_MOVED}=${!!readbackSwMoved}. ce65-gates var 103 (introFinished)=${introFinished} var 37 (peopleInAppt)=${peopleInAppt} mapId=${mapId}. talk-choice=${talkChoiceFix}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Plant Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Shadow Quest (canonical phase var + 3 supporting switches) ----
    //
    // Read priority is exact phase match for the two terminal outcomes
    // (999 Defeated, 20 / sw27 ON Befriended) so a save that has been
    // resolved one way reads correctly. Otherwise the natural progression
    // collapses each transient odd value onto its preceding even waypoint
    // (e.g. phase 1 reads as "After 1st Encounter" because newDay will
    // tick it to 2 anyway). Phase 10 (escaped from the bedroom) folds
    // into Bedroom Pending — the cheat user can re-pick Befriended or
    // Defeated to resolve it cleanly.

    function readShadowQuestState() {
        const phase = readVar(SHADOW_VAR_STATE);
        if (phase === 999) return 7;                                          // Defeated
        if (readSwitch(SHADOW_SWITCH_RECRUITED) || phase === 20) return 6;    // Befriended
        if (phase >= 8) return 5;                                             // Bedroom Pending (covers 8, 10..19)
        if (phase >= 7 || readSwitch(SHADOW_SWITCH_ITEM_LEFT)) return 4;      // Gift At Apartment
        if (phase >= 5) return 3;                                             // After 3rd Encounter (covers 5, 6)
        if (phase >= 3) return 2;                                             // After 2nd Encounter (covers 3, 4)
        if (phase >= 1) return 1;                                             // After 1st Encounter (covers 1, 2)
        return 0;                                                              // Not Started
    }

    function shadowQuestStateLabel(value) {
        const s = SHADOW_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyShadowQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = SHADOW_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readShadowQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [SHADOW_VAR_STATE, SHADOW_VAR_DISPO],
                switches: [SHADOW_SWITCH_RECRUITED, SHADOW_SWITCH_GIFT, SHADOW_SWITCH_ITEM_LEFT]
            })
            : { release: () => {} };
        try {
            $gameVariables.setValue(SHADOW_VAR_STATE, target.phase);
            $gameVariables.setValue(SHADOW_VAR_DISPO, target.dispo);
            $gameSwitches.setValue(SHADOW_SWITCH_RECRUITED, target.recruited);
            $gameSwitches.setValue(SHADOW_SWITCH_GIFT, target.gift);
            $gameSwitches.setValue(SHADOW_SWITCH_ITEM_LEFT, target.itemLeft);
            CabbyCodes.warn(`${LOG_PREFIX} Shadow Quest: ${shadowQuestStateLabel(oldValue)} -> ${shadowQuestStateLabel(newValue)}. var ${SHADOW_VAR_STATE}=${target.phase}, var ${SHADOW_VAR_DISPO}=${target.dispo}, sw ${SHADOW_SWITCH_RECRUITED}=${target.recruited}, sw ${SHADOW_SWITCH_GIFT}=${target.gift}, sw ${SHADOW_SWITCH_ITEM_LEFT}=${target.itemLeft}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Shadow Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Frederic Quest (9 portrait state vars + Painter + counter) ----
    //
    // Read priority: count alive portraits (state var != 99) and bucket:
    //   0 portraits alive AND var 305 == 99 -> "All Killed" (state 12)
    //   0 portraits alive AND var 305 != 99 -> "Painter Last Alive" (state 11)
    //                                          natural good-ending state
    //                                          (palette given, all copies dead,
    //                                          original Frederic still alive)
    //   1 portrait alive  -> "Portrait N Last Alive" (state 2..10)
    //   2+ portraits alive -> "In Progress" if Painter has been engaged
    //                          (var 305 >= 1) or var 306 has been touched
    //                          (< initial), else "Not Started"
    // The Painter (var 305) participates in the alive-count for the 0-portrait
    // case so a save in the natural good-ending doesn't misleadingly read as
    // "All Killed" when the Painter NPC is still standing in his apartment.

    // Cache the previous bucketed result so we only log a diagnostic dump
    // when the read transitions states — not every frame the picker is
    // open. Cleared whenever the session resets so the first read of a
    // newly-loaded save logs once.
    let _fredericLastReadValue = null;

    function readFredericQuestState() {
        const portraitValues = FREDERIC_PORTRAIT_INDICES.map(idx => ({
            idx,
            varId: FREDERIC_PORTRAIT_VARS[idx],
            value: readVar(FREDERIC_PORTRAIT_VARS[idx])
        }));
        const aliveIndices = portraitValues
            .filter(p => p.value !== FREDERIC_PORTRAIT_DEAD)
            .map(p => p.idx);
        const painter = readVar(FREDERIC_PAINTER_VAR);
        const left = readVar(FREDERIC_PORTRAITS_LEFT_VAR);
        let result;
        if (aliveIndices.length === 0) {
            result = painter === FREDERIC_PAINTER_DEAD ? 12 : 11;
        } else if (aliveIndices.length === 1) {
            const survivor = aliveIndices[0];
            const state = FREDERIC_QUEST_STATES.find(s => s.survivor === survivor);
            result = state ? state.value : 1;
        } else if (painter >= 1 || (left > 0 && left < FREDERIC_PORTRAITS_INITIAL)) {
            result = 1; // In Progress
        } else {
            result = 0; // Not Started
        }
        // One-shot diagnostic dump: helps debug saves where the cheat row
        // disagrees with what the player sees in-game (e.g. an NPC that
        // looks alive on its map but reads as dead). Fires only when the
        // bucketed result changes so it doesn't spam the log.
        if (_fredericLastReadValue !== result) {
            _fredericLastReadValue = result;
            const summary = portraitValues.map(p => `P${p.idx}(v${p.varId})=${p.value}`).join(' ');
            CabbyCodes.warn(`${LOG_PREFIX} Frederic read -> ${fredericQuestStateLabel(result)} | painter(v${FREDERIC_PAINTER_VAR})=${painter} left(v${FREDERIC_PORTRAITS_LEFT_VAR})=${left} | ${summary}`);
        }
        return result;
    }

    function fredericQuestStateLabel(value) {
        const s = FREDERIC_QUEST_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    // Flip a portrait's roaming-NPC self switches to match its alive/dead
    // intent. Mirrors the natural battle-event's post-victory self-switch
    // flip (e.g. Portrait1's Map095 ev8 page 0 sets self switch C ON after
    // the troop 328 win) so the dead-body page renders without the player
    // having to win the fight. For revival, clears all four self switches
    // so the page-0 "alive" branch wins on the next refresh.
    //
    // Returns a short tag for the per-portrait log summary. No-op for
    // Portrait5 (Faceless, multi-event side encounter — see comment block
    // above) and silently no-ops if `$gameSelfSwitches` isn't loaded yet.
    function syncPortraitNpcSelfSwitches(idx, wantDead) {
        const npc = FREDERIC_PORTRAIT_NPCS[idx];
        if (!npc) {
            return idx === 5 ? 'P5:skip-faceless' : `P${idx}:no-npc`;
        }
        if (typeof $gameSelfSwitches === 'undefined' || !$gameSelfSwitches) {
            return `P${idx}:no-selfsw`;
        }
        try {
            if (wantDead) {
                $gameSelfSwitches.setValue([npc.mapId, npc.eventId, npc.deadSelfSwitch], true);
                return `P${idx}:dead-sw${npc.deadSelfSwitch}`;
            }
            FREDERIC_SELF_SWITCH_KEYS.forEach(ch => {
                $gameSelfSwitches.setValue([npc.mapId, npc.eventId, ch], false);
            });
            return `P${idx}:alive-cleared`;
        } catch (error) {
            CabbyCodes.warn(`${LOG_PREFIX} Self-switch sync failed for Portrait${idx}: ${error?.message || error}`);
            return `P${idx}:err`;
        }
    }

    function applyFredericQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = FREDERIC_QUEST_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const portraitVarIds = FREDERIC_PORTRAIT_INDICES.map(idx => FREDERIC_PORTRAIT_VARS[idx]);
        const oldValue = readFredericQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [
                    FREDERIC_PAINTER_VAR,
                    FREDERIC_PORTRAITS_LEFT_VAR,
                    ...portraitVarIds
                ]
            })
            : { release: () => {} };
        try {
            // Reconcile portrait state when the target picks a definite
            // configuration (specific portrait survives, Painter survives
            // alone, or all 10 Fredrics dead). Not Started clears all 9
            // to the pre-encounter baseline (vars + self switches). In
            // Progress is the only state that leaves portrait kill state
            // alone — it's a bookkeeping-only state for "the player is
            // mid-quest, leave their kill configuration as-is and just
            // ensure the Painter dialog is engaged".
            const npcSyncTags = [];
            const reconcilePortraits = target.survivor !== null || target.allDead;
            if (reconcilePortraits) {
                FREDERIC_PORTRAIT_INDICES.forEach(idx => {
                    const isSurvivorPortrait = typeof target.survivor === 'number' && idx === target.survivor;
                    const wantDead = target.allDead || !isSurvivorPortrait;
                    $gameVariables.setValue(
                        FREDERIC_PORTRAIT_VARS[idx],
                        wantDead ? FREDERIC_PORTRAIT_DEAD : FREDERIC_PORTRAIT_ALIVE
                    );
                    npcSyncTags.push(syncPortraitNpcSelfSwitches(idx, wantDead));
                });
            } else if (target.value === 0) {
                FREDERIC_PORTRAIT_INDICES.forEach(idx => {
                    $gameVariables.setValue(FREDERIC_PORTRAIT_VARS[idx], FREDERIC_PORTRAIT_ALIVE);
                    npcSyncTags.push(syncPortraitNpcSelfSwitches(idx, false));
                });
            }
            $gameVariables.setValue(FREDERIC_PAINTER_VAR, target.painter);
            $gameVariables.setValue(FREDERIC_PORTRAITS_LEFT_VAR, target.portraitsLeft);
            // Request a refresh so any portrait NPC or wall-painting event
            // on the current map re-evaluates its page conditions and the
            // sprite swap is visible immediately. Off-map events update
            // automatically when the player next visits.
            if (typeof $gameMap !== 'undefined' && $gameMap && typeof $gameMap.requestRefresh === 'function') {
                $gameMap.requestRefresh();
            }
            const portraitSummary = FREDERIC_PORTRAIT_INDICES
                .map(idx => `P${idx}=${readVar(FREDERIC_PORTRAIT_VARS[idx])}`)
                .join(',');
            const npcSummary = npcSyncTags.length ? ` npc[${npcSyncTags.join(',')}]` : '';
            CabbyCodes.warn(`${LOG_PREFIX} Frederic Quest: ${fredericQuestStateLabel(oldValue)} -> ${fredericQuestStateLabel(newValue)}. var ${FREDERIC_PAINTER_VAR}=${target.painter}, var ${FREDERIC_PORTRAITS_LEFT_VAR}=${target.portraitsLeft}, portraits[${portraitSummary}].${npcSummary}`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Frederic Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Charan Quest (basement-pit big-friend arc) ----
    //
    // Read priority: `CharanLeaveEarly` ON dominates because it's the gate
    // that locks Charan out (subsequent pit jumps die at -100 HP instead of
    // seeing him), so we report that as "Charan Left" regardless of which
    // mid-state the supporting switches were last in. Otherwise descend the
    // milestone chain newest-to-oldest. The handshake switch OR a non-zero
    // disposition var both indicate "Met Charan" because dispo flips to 1
    // on EITHER first-encounter choice (shake or refuse), so a save where
    // the player refused the handshake still reads as "Met Charan"; the
    // canonical apply path sets sw 678 ON to leave a clean state.

    function readCharanQuestState() {
        if (readSwitch(CHARAN_SWITCH_LEAVE_EARLY))    return 5; // Charan Left
        if (readSwitch(CHARAN_SWITCH_SWORD_GIFT))     return 4; // Sword Received
        if (readSwitch(CHARAN_SWITCH_GAVE_ROSE))      return 3; // Rose Given
        if (readSwitch(CHARAN_SWITCH_MENTIONED_LOVE)) return 2; // Mentioned Love
        if (readSwitch(CHARAN_SWITCH_SHOOK_HAND) || readVar(CHARAN_VAR_DISPO) >= 1) return 1; // Met Charan
        return 0;                                                // Not Started
    }

    function charanQuestStateLabel(value) {
        const s = CHARAN_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyCharanQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = CHARAN_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readCharanQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [CHARAN_VAR_DISPO],
                switches: [
                    CHARAN_SWITCH_LEAVE_EARLY,
                    CHARAN_SWITCH_SHOOK_HAND,
                    CHARAN_SWITCH_MENTIONED_LOVE,
                    CHARAN_SWITCH_GAVE_ROSE,
                    CHARAN_SWITCH_SWORD_GIFT
                ]
            })
            : { release: () => {} };
        try {
            $gameVariables.setValue(CHARAN_VAR_DISPO, target.dispo);
            $gameSwitches.setValue(CHARAN_SWITCH_LEAVE_EARLY, target.leaveEarly);
            $gameSwitches.setValue(CHARAN_SWITCH_SHOOK_HAND, target.shookHand);
            $gameSwitches.setValue(CHARAN_SWITCH_MENTIONED_LOVE, target.mentionedLove);
            $gameSwitches.setValue(CHARAN_SWITCH_GAVE_ROSE, target.gaveRose);
            $gameSwitches.setValue(CHARAN_SWITCH_SWORD_GIFT, target.swordGift);
            CabbyCodes.warn(`${LOG_PREFIX} Charan Quest: ${charanQuestStateLabel(oldValue)} -> ${charanQuestStateLabel(newValue)}. var ${CHARAN_VAR_DISPO}=${target.dispo}, sw ${CHARAN_SWITCH_LEAVE_EARLY}=${target.leaveEarly}, sw ${CHARAN_SWITCH_SHOOK_HAND}=${target.shookHand}, sw ${CHARAN_SWITCH_MENTIONED_LOVE}=${target.mentionedLove}, sw ${CHARAN_SWITCH_GAVE_ROSE}=${target.gaveRose}, sw ${CHARAN_SWITCH_SWORD_GIFT}=${target.swordGift}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Charan Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Kevin Quest (basement-worm trade availability) ----
    //
    // The natural game gates Kevin's appearance behind two conditions
    // on Map094 ev43 page 0: var 437 (`nestorBodyState`) >= 12 AND the
    // event's self-switch C is OFF. The cheat exposes a 2-state toggle
    // that flips both into a Kevin-reachable configuration without
    // exposing trade tiers — reward items (Worm Juice / Pie / Nine-
    // Tails / Robe / Crown) are inventory state the player can grant
    // directly via the item-editor cheat once Kevin is reachable.
    //
    // Read returns "Available" only if the natural appearance gate is
    // satisfied right now (var >= 12 AND selfSw C OFF). The post-fight
    // dead-state (selfSw C ON) reads as "Not Available" since Kevin's
    // event is no longer interactable in that state regardless of var
    // 437. If $gameSelfSwitches isn't loaded yet (pre-save state) the
    // helper returns false, so a Title-screen read is harmless.

    function readKevinSelfSwitchC() {
        if (typeof $gameSelfSwitches === 'undefined' || !$gameSelfSwitches) {
            return false;
        }
        try {
            return Boolean($gameSelfSwitches.value([KEVIN_MAP_ID, KEVIN_EVENT_ID, KEVIN_POST_SELFSW]));
        } catch (error) {
            return false;
        }
    }

    function readKevinQuestState() {
        if (readVar(KEVIN_NESTOR_VAR) >= KEVIN_NESTOR_THRESHOLD && !readKevinSelfSwitchC()) {
            return 1; // Available
        }
        return 0;     // Not Available
    }

    function kevinQuestStateLabel(value) {
        const s = KEVIN_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyKevinQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = KEVIN_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readKevinQuestState();
        const wantAvailable = newValue === 1;
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ variables: [KEVIN_NESTOR_VAR] })
            : { release: () => {} };
        try {
            const curVar = readVar(KEVIN_NESTOR_VAR);
            let varNote;
            if (wantAvailable) {
                if (curVar < KEVIN_NESTOR_THRESHOLD) {
                    $gameVariables.setValue(KEVIN_NESTOR_VAR, KEVIN_NESTOR_THRESHOLD);
                    varNote = `var ${KEVIN_NESTOR_VAR}=${KEVIN_NESTOR_THRESHOLD} (was ${curVar})`;
                } else {
                    varNote = `var ${KEVIN_NESTOR_VAR}=${curVar} (already at gate)`;
                }
            } else if (curVar >= KEVIN_NESTOR_THRESHOLD) {
                $gameVariables.setValue(KEVIN_NESTOR_VAR, KEVIN_NESTOR_PRE_GATE);
                varNote = `var ${KEVIN_NESTOR_VAR}=${KEVIN_NESTOR_PRE_GATE} (was ${curVar})`;
            } else {
                varNote = `var ${KEVIN_NESTOR_VAR}=${curVar} (already below gate)`;
            }
            // Self-switch C is only flipped on Available so any prior
            // post-encounter / dead-state on the event re-opens. Not
            // Available leaves it alone — clearing it could revive a
            // Kevin the player has organically engaged, while setting
            // it ON would permanently mark him as fought.
            let selfNote = `sw${KEVIN_MAP_ID}/${KEVIN_EVENT_ID}/${KEVIN_POST_SELFSW} unchanged`;
            if (wantAvailable && typeof $gameSelfSwitches !== 'undefined' && $gameSelfSwitches) {
                try {
                    if (readKevinSelfSwitchC()) {
                        $gameSelfSwitches.setValue([KEVIN_MAP_ID, KEVIN_EVENT_ID, KEVIN_POST_SELFSW], false);
                        selfNote = `sw${KEVIN_MAP_ID}/${KEVIN_EVENT_ID}/${KEVIN_POST_SELFSW} cleared`;
                    } else {
                        selfNote = `sw${KEVIN_MAP_ID}/${KEVIN_EVENT_ID}/${KEVIN_POST_SELFSW} already off`;
                    }
                } catch (error) {
                    CabbyCodes.warn(`${LOG_PREFIX} Self-switch clear failed for Kevin: ${error?.message || error}`);
                    selfNote = `sw${KEVIN_MAP_ID}/${KEVIN_EVENT_ID}/${KEVIN_POST_SELFSW} err`;
                }
            }
            // Refresh map so any sprite swap on Map094 takes effect
            // immediately; events on other maps re-evaluate page
            // conditions on next entry.
            if (typeof $gameMap !== 'undefined' && $gameMap && typeof $gameMap.requestRefresh === 'function') {
                $gameMap.requestRefresh();
            }
            CabbyCodes.warn(`${LOG_PREFIX} Kevin Quest: ${kevinQuestStateLabel(oldValue)} -> ${kevinQuestStateLabel(newValue)}. ${varNote}, ${selfNote}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Kevin Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Marshall Quest (bathroom-stall voice vs foot-worm chase phases) ----
    //
    // Read priority walks Defeated -> Stronger -> Mutated -> In Stall so a
    // save mid-progression always lands on the highest-step state currently
    // satisfied. switch 451 ON pins Defeated even if var 435 has been
    // re-zeroed, since the natural game treats `wormfootDead` as terminal —
    // Marshall ev41's defeated page wins regardless of var 435 once 451 is ON.
    // Mutated states require switch 422 (parts spawned) AND var 435 at the
    // chase-phase threshold; without 422 ON, Marshall ev41 has no matching
    // page and the worm doesn't appear, so a non-zero var 435 with sw 422
    // OFF reads as In Stall.

    function readMarshallQuestState() {
        if (readSwitch(MARSHALL_SWITCH_FOOT_DEAD)) {
            return 3; // Defeated
        }
        if (readSwitch(MARSHALL_SWITCH_PARTS_SPAWNED)) {
            const chase = readVar(MARSHALL_VAR_FOOT_CHASE);
            if (chase >= MARSHALL_FOOT_CHASE_STRONGER) {
                return 2; // Mutated (Stronger)
            }
            if (chase >= 4) {
                return 1; // Mutated
            }
        }
        return 0; // In Stall
    }

    function marshallQuestStateLabel(value) {
        const s = MARSHALL_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyMarshallQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = MARSHALL_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        const oldValue = readMarshallQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [MARSHALL_VAR_FOOT_CHASE],
                switches: [
                    MARSHALL_SWITCH_PARTS_SPAWNED,
                    MARSHALL_SWITCH_FOOT_DEAD
                ]
            })
            : { release: () => {} };
        try {
            $gameVariables.setValue(MARSHALL_VAR_FOOT_CHASE, target.footChase);
            $gameSwitches.setValue(MARSHALL_SWITCH_PARTS_SPAWNED, target.partsSpawned);
            $gameSwitches.setValue(MARSHALL_SWITCH_FOOT_DEAD, target.footDead);
            // Refresh map so any sprite swap on Map054 takes effect
            // immediately; events on other maps re-evaluate page conditions
            // on next entry.
            if (typeof $gameMap !== 'undefined' && $gameMap && typeof $gameMap.requestRefresh === 'function') {
                $gameMap.requestRefresh();
            }
            CabbyCodes.warn(`${LOG_PREFIX} Marshall Quest: ${marshallQuestStateLabel(oldValue)} -> ${marshallQuestStateLabel(newValue)}. var ${MARSHALL_VAR_FOOT_CHASE}=${target.footChase}, sw ${MARSHALL_SWITCH_PARTS_SPAWNED}=${target.partsSpawned}, sw ${MARSHALL_SWITCH_FOOT_DEAD}=${target.footDead}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Marshall Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // ---- Fuzzy Quest (Joel's teddy bear weapon swap) ----
    //
    // Read priority:
    //   1. Joel's currently equipped weapon (`actor 4 slot 0`). If it's
    //      one of the seven Fuzzy variants, return that state. This is the
    //      authoritative answer because the natural game and our cheat
    //      both write to this slot via code 319 / changeEquipById.
    //   2. Inventory fallback. If Joel has no Fuzzy variant equipped (e.g.
    //      he's holding 169 "Empty Handed" during the Xaria interim, or
    //      a manual unequip), surface the highest-tier Fuzzy variant we
    //      find in `$gameParty`. This matches the "Joel's Fuzzy is in
    //      Joel's possession even if not currently held" intent of the
    //      questline.
    //   3. Default to Pristine when nothing matches (pre-Joel saves where
    //      actor 4 hasn't been initialized yet).

    function readFuzzyQuestState() {
        if (typeof $gameActors !== 'undefined' && $gameActors) {
            const joel = $gameActors.actor(FUZZY_ACTOR_ID);
            if (joel && typeof joel.equips === 'function') {
                const equipped = joel.equips()[FUZZY_WEAPON_ETYPE - 1];
                if (equipped && typeof equipped.id === 'number') {
                    const matched = FUZZY_STATES.find(s => s.weaponId === equipped.id);
                    if (matched) {
                        return matched.value;
                    }
                }
            }
        }
        if (typeof $gameParty !== 'undefined' && $gameParty
                && typeof $gameParty.numItems === 'function'
                && typeof $dataWeapons !== 'undefined' && $dataWeapons) {
            // Walk states in reverse so the highest-tier variant wins
            // when multiple are somehow held simultaneously (shouldn't
            // happen post-cheat, but a save with mid-progression dupes
            // should still read sensibly).
            for (let i = FUZZY_STATES.length - 1; i >= 0; i -= 1) {
                const state = FUZZY_STATES[i];
                const w = $dataWeapons[state.weaponId];
                if (w && $gameParty.numItems(w) > 0) {
                    return state.value;
                }
            }
        }
        return 0;
    }

    function fuzzyQuestStateLabel(value) {
        const s = FUZZY_STATES.find(st => st.value === value);
        return s ? s.label : String(value);
    }

    function applyFuzzyQuestState(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const target = FUZZY_STATES.find(s => s.value === newValue);
        if (!target) {
            return false;
        }
        if (typeof $dataWeapons === 'undefined' || !$dataWeapons) {
            CabbyCodes.warn(`${LOG_PREFIX} Fuzzy Quest: $dataWeapons unavailable.`);
            return false;
        }
        if (typeof $gameActors === 'undefined' || !$gameActors) {
            CabbyCodes.warn(`${LOG_PREFIX} Fuzzy Quest: $gameActors unavailable.`);
            return false;
        }
        if (typeof $gameParty === 'undefined' || !$gameParty
                || typeof $gameParty.gainItem !== 'function'
                || typeof $gameParty.loseItem !== 'function') {
            CabbyCodes.warn(`${LOG_PREFIX} Fuzzy Quest: $gameParty inventory API unavailable.`);
            return false;
        }
        const joel = $gameActors.actor(FUZZY_ACTOR_ID);
        if (!joel || typeof joel.changeEquipById !== 'function') {
            CabbyCodes.warn(`${LOG_PREFIX} Fuzzy Quest: actor ${FUZZY_ACTOR_ID} (Joel) not ready.`);
            return false;
        }
        const targetWeapon = $dataWeapons[target.weaponId];
        if (!targetWeapon) {
            CabbyCodes.warn(`${LOG_PREFIX} Fuzzy Quest: weapon ${target.weaponId} not in $dataWeapons.`);
            return false;
        }
        const oldValue = readFuzzyQuestState();
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ variables: [FUZZY_VAR_INTERACT] })
            : { release: () => {} };
        try {
            // Game_Actor.tradeItemWithParty (called from changeEquip) needs
            // the target weapon to be in the party inventory before equip;
            // it then loses 1 from inventory and adds 1 of the previously-
            // equipped item back. So: gain → equip → sweep dupes.
            $gameParty.gainItem(targetWeapon, 1, false);
            joel.changeEquipById(FUZZY_WEAPON_ETYPE, target.weaponId);
            FUZZY_WEAPON_IDS.forEach(wid => {
                const w = $dataWeapons[wid];
                if (!w) return;
                const have = $gameParty.numItems(w);
                if (have > 0) {
                    $gameParty.loseItem(w, have, false);
                }
            });
            // Var 614 (ratInteractState). Gates the rat-child interaction
            // scene chain — val 2 triggers the shred event that overwrites
            // the equipped weapon. Bump past it for any non-Pristine state;
            // clamp down for Pristine so the player can still play through
            // the natural shred organically.
            const curInteract = readVar(FUZZY_VAR_INTERACT);
            let interactNote = `var ${FUZZY_VAR_INTERACT}=${curInteract} (unchanged)`;
            if (target.value === 0) {
                if (curInteract >= FUZZY_INTERACT_SHRED_PHASE) {
                    $gameVariables.setValue(FUZZY_VAR_INTERACT, FUZZY_INTERACT_PRE_SHRED);
                    interactNote = `var ${FUZZY_VAR_INTERACT}=${FUZZY_INTERACT_PRE_SHRED} (was ${curInteract})`;
                }
            } else if (curInteract < FUZZY_INTERACT_POST_APOLOGY) {
                $gameVariables.setValue(FUZZY_VAR_INTERACT, FUZZY_INTERACT_POST_APOLOGY);
                interactNote = `var ${FUZZY_VAR_INTERACT}=${FUZZY_INTERACT_POST_APOLOGY} (was ${curInteract})`;
            }
            const readBack = readFuzzyQuestState();
            CabbyCodes.warn(`${LOG_PREFIX} Fuzzy Quest: ${fuzzyQuestStateLabel(oldValue)} -> ${fuzzyQuestStateLabel(newValue)}. weapon ${target.weaponId} equipped on actor ${FUZZY_ACTOR_ID}, ${interactNote}. Read-back: ${fuzzyQuestStateLabel(readBack)}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed for Fuzzy Quest: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    // Recruit switches gate availability, but the in-game recruit Common
    // Events also call code:129 Add Party Member after flipping the switch.
    // Toggling the switch alone is insufficient to actually put the actor
    // in the party; we mirror the addActor / removeActor side effect here.
    function syncActorParty(flag, wantOn) {
        if (typeof flag.actorId !== 'number') {
            return '';
        }
        if (typeof $gameParty === 'undefined' || !$gameParty || typeof $gameParty.allMembers !== 'function') {
            return '';
        }
        const inParty = $gameParty.allMembers().some(m => m && typeof m.actorId === 'function' && m.actorId() === flag.actorId);
        try {
            if (wantOn && !inParty && typeof $gameParty.addActor === 'function') {
                $gameParty.addActor(flag.actorId);
                return ` Added actor ${flag.actorId} to party.`;
            }
            if (!wantOn && inParty && typeof $gameParty.removeActor === 'function') {
                $gameParty.removeActor(flag.actorId);
                return ` Removed actor ${flag.actorId} from party.`;
            }
        } catch (error) {
            CabbyCodes.warn(`${LOG_PREFIX} Party sync failed for ${flag.label}: ${error?.message || error}`);
        }
        return '';
    }

    //----------------------------------------------------------------------
    // Arm-specific reconcile (carried over from v1)
    //----------------------------------------------------------------------

    // States 33 ("Mangled right hand") and 34 ("Mangled left hand") each have
    // a code-54 (Equip Type Seal) trait sealing equipType 1 (Weapon) and
    // equipType 2 (Ranged) respectively. While applied, the equip menu greys
    // out and refuses selection on the corresponding slot — independent of
    // the canEquip* item-level filter, which only hides individual items.
    // We could not locate where the base game adds these states (no code 313
    // hits, no skill/item effects, no plugin addState reference), but the
    // user's symptom — sealed slot persisting after the slot rename clears —
    // matches exactly. Always erasing them is safe: removeState is a no-op
    // if not affected, and our cheat owns arm state via var 187 anyway.
    const ARM_LOCK_STATE_IDS = [33, 34];

    // TunicateScripts.js (and the older bunchastuff_old.js) ties Sam's gear
    // and sprite to variable 187. Three things must be reconciled when the
    // variable changes outside the normal arm-loss event flow: sprite name
    // suffix stickiness (strip + re-call setCharacterImage), released gear
    // (canEquip changes don't auto-unequip), and slot seal states. See
    // GAME_NOTES.md §3 for the full breakdown.
    function reconcileSamAfterArmChange(newValue) {
        if (typeof $gameActors === 'undefined' || !$gameActors) {
            return;
        }
        const sam = $gameActors.actor(1);
        if (!sam) {
            return;
        }
        try {
            const erasedStates = [];
            ARM_LOCK_STATE_IDS.forEach(stateId => {
                const wasAffected = typeof sam.isStateAffected === 'function' && sam.isStateAffected(stateId);
                if (wasAffected && typeof sam.removeState === 'function') {
                    sam.removeState(stateId);
                    erasedStates.push(stateId);
                } else if (wasAffected && typeof sam.eraseState === 'function') {
                    sam.eraseState(stateId);
                    erasedStates.push(stateId);
                }
            });

            const rawName = sam._characterName || '';
            const baseName = rawName
                .replace(/_MissingRightarm$/, '')
                .replace(/_MissingLeftarm$/, '');
            const idx = sam._characterIndex || 0;
            if (typeof sam.setCharacterImage === 'function') {
                sam.setCharacterImage(baseName, idx);
            }
            if (typeof sam.releaseUnequippableItems === 'function') {
                sam.releaseUnequippableItems(false);
            }
            if (typeof sam.refresh === 'function') {
                sam.refresh();
            }
            if (typeof $gamePlayer !== 'undefined' && $gamePlayer) {
                if (typeof $gamePlayer.refresh === 'function') {
                    $gamePlayer.refresh();
                }
                const followers = typeof $gamePlayer.followers === 'function' ? $gamePlayer.followers() : null;
                if (followers && typeof followers.refresh === 'function') {
                    followers.refresh();
                }
            }
            const erasedNote = erasedStates.length ? ` Erased states: ${erasedStates.join(', ')}.` : '';
            CabbyCodes.warn(`${LOG_PREFIX} Sam reconciled. base sprite="${baseName}", arm value=${newValue}, stored name now="${sam._characterName}".${erasedNote}`);
        } catch (error) {
            CabbyCodes.warn(`${LOG_PREFIX} reconcileSamAfterArmChange failed: ${error?.message || error}`);
        }
    }

    //----------------------------------------------------------------------
    // Dizzyshroom / Spore Head reconcile
    //----------------------------------------------------------------------

    // Mirrors the "normal" branch of CommonEvents.json CE 75
    // "updatePlayerAssets" so the change is visible immediately in the
    // overworld and the save-slot preview without waiting for the Fungus
    // Lair's FungusFade parallel event (CE 82, switch 10) to run. Cat mode
    // (var 28 == 2) and tree-transformation stages (var 467 >= 1) own their
    // own character sheet/index, so we leave Sam alone there — the game's
    // own logic will repaint him when those states clear. Also leaves the
    // character sheet at 'Chara_Player' (no suffix), which means a concurrent
    // arm-loss state's `_MissingRightarm`/`_MissingLeftarm` suffix will be
    // cleared; re-apply via Arm State if that combination is in play.
    //
    // We also reserve CE 75 itself as a belt-and-suspenders: when the player
    // returns to the map interpreter, the game's own updatePlayerAssets runs
    // and repaints the sprite from the authoritative path. Our direct call
    // above is needed anyway so the save-slot preview updates immediately.
    function reconcileSamAfterDizzyshroomChange(newValue) {
        if (typeof $gameActors === 'undefined' || !$gameActors) {
            return;
        }
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return;
        }
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return;
        }
        const sam = $gameActors.actor(1);
        if (!sam) {
            return;
        }
        const playerMode = Number($gameVariables.value(28)) || 0;
        const treeState = Number($gameVariables.value(467)) || 0;
        if (playerMode !== 0 || treeState >= 1) {
            CabbyCodes.warn(`${LOG_PREFIX} Spore sprite refresh skipped: playerMode=${playerMode}, treeState=${treeState}.`);
            reserveUpdatePlayerAssets();
            return;
        }
        const sw103 = Boolean($gameSwitches.value(103));
        const sw197 = Boolean($gameSwitches.value(197));
        let charIndex = 0;
        if (Number(newValue) >= 1 && !sw103) {
            charIndex = sw197 ? 1 : 2;
        }
        try {
            if (typeof sam.setCharacterImage === 'function') {
                sam.setCharacterImage('Chara_Player', charIndex);
            }
            if (typeof sam.setFaceImage === 'function') {
                sam.setFaceImage('Portrait_Player', 0);
            }
            if (typeof sam.refresh === 'function') {
                sam.refresh();
            }
            if (typeof $gamePlayer !== 'undefined' && $gamePlayer && typeof $gamePlayer.refresh === 'function') {
                $gamePlayer.refresh();
            }
            if (typeof $gameMap !== 'undefined' && $gameMap && typeof $gameMap.requestRefresh === 'function') {
                $gameMap.requestRefresh();
            }
            reserveUpdatePlayerAssets();
            CabbyCodes.warn(`${LOG_PREFIX} Sam spore sprite reconciled: Chara_Player index=${charIndex} for dizzyshroom=${newValue} (sw103=${sw103}, sw197=${sw197}). Stored name now="${sam._characterName}", index=${sam._characterIndex}.`);
        } catch (error) {
            CabbyCodes.warn(`${LOG_PREFIX} reconcileSamAfterDizzyshroomChange failed: ${error?.message || error}`);
        }
    }

    // CE 75 "updatePlayerAssets" has trigger: 0 (None), so it only runs when
    // explicitly invoked. Queue it on $gameTemp so the next map interpreter
    // tick re-runs the game's own sprite-selection logic against the new
    // var 240 value. No-op if $gameTemp is unavailable (pre-session).
    function reserveUpdatePlayerAssets() {
        reserveCommonEventSafe(75);
    }

    function reserveCommonEventSafe(eventId) {
        if (typeof $gameTemp === 'undefined' || !$gameTemp) {
            return;
        }
        if (typeof $gameTemp.reserveCommonEvent !== 'function') {
            return;
        }
        try {
            $gameTemp.reserveCommonEvent(eventId);
        } catch (error) {
            CabbyCodes.warn(`${LOG_PREFIX} reserveCommonEvent(${eventId}) failed: ${error?.message || error}`);
        }
    }

    //----------------------------------------------------------------------
    // Shared helpers for scene layout
    //----------------------------------------------------------------------

    function pickerLayoutFor(scene, rowCount) {
        const width = Math.min(PICKER_WIDTH, Graphics.boxWidth - 32);
        // 2 lines: heading + short body. Keep every body string short enough
        // to fit on one rendered line so nothing wraps and gets clipped.
        const helpHeight = scene.calcWindowHeight(2, false);
        const listHeight = scene.calcWindowHeight(Math.min(Math.max(rowCount, 1), PICKER_MAX_ROWS), true);
        const totalHeight = helpHeight + PICKER_SPACING + listHeight;
        const x = Math.max(0, Math.floor((Graphics.boxWidth - width) / 2));
        const baseY = Math.max(0, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        return { x, baseY, width, helpHeight, listHeight };
    }

    //----------------------------------------------------------------------
    // Scene_CabbyCodesStoryFlagsCategories - top-level category picker
    //----------------------------------------------------------------------

    function Scene_CabbyCodesStoryFlagsCategories() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesStoryFlagsCategories.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesStoryFlagsCategories.prototype.constructor = Scene_CabbyCodesStoryFlagsCategories;

    Scene_CabbyCodesStoryFlagsCategories.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesStoryFlagsCategories.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesStoryFlagsCategories.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, CATEGORIES.length);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText('Story Flags\nPick a category.');
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesStoryFlagsCategories.prototype.createListWindow = function() {
        const layout = pickerLayoutFor(this, CATEGORIES.length);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesStoryFlagsCategories(rect);
        this._listWindow.setHandler('ok', this.onCategoryOk.bind(this));
        this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
        // setHelpWindow drives the per-row help refresh through the
        // window's updateHelp() override (defined below). It must be
        // attached AFTER activate() so the initial callUpdateHelp() it
        // triggers passes the active-window guard.
        this._listWindow.setHelpWindow(this._helpWindow);
    };

    Scene_CabbyCodesStoryFlagsCategories.prototype.onCategoryOk = function() {
        const cat = this._listWindow.currentCategory();
        if (!cat) {
            this._listWindow.activate();
            return;
        }
        if (typeof cat.onSelect === 'function') {
            const pushed = cat.onSelect();
            if (!pushed) {
                this._listWindow.activate();
            }
            return;
        }
        openFlagListFor(cat.id);
    };

    Scene_CabbyCodesStoryFlagsCategories.prototype.onListCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesStoryFlagsCategories = Scene_CabbyCodesStoryFlagsCategories;

    //----------------------------------------------------------------------
    // Window_CabbyCodesStoryFlagsCategories
    //----------------------------------------------------------------------

    function Window_CabbyCodesStoryFlagsCategories() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesStoryFlagsCategories.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesStoryFlagsCategories.prototype.constructor = Window_CabbyCodesStoryFlagsCategories;

    Window_CabbyCodesStoryFlagsCategories.prototype.makeCommandList = function() {
        CATEGORIES.forEach((cat, index) => {
            this.addCommand(cat.label, `cat_${cat.id}`, true, index);
        });
    };

    Window_CabbyCodesStoryFlagsCategories.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesStoryFlagsCategories.prototype.currentCategory = function() {
        const ext = this.currentExt();
        if (typeof ext !== 'number') {
            return null;
        }
        return CATEGORIES[ext] || null;
    };

    Window_CabbyCodesStoryFlagsCategories.prototype.updateHelp = function() {
        if (!this._helpWindow) {
            return;
        }
        const cat = this.currentCategory();
        const body = cat ? cat.helpText : 'Pick a category.';
        this._helpWindow.setText(`Story Flags\n${body}`);
    };

    window.Window_CabbyCodesStoryFlagsCategories = Window_CabbyCodesStoryFlagsCategories;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesStoryFlags - flag list scoped to active category
    //----------------------------------------------------------------------

    function Scene_CabbyCodesStoryFlags() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesStoryFlags.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesStoryFlags.prototype.constructor = Scene_CabbyCodesStoryFlags;

    Scene_CabbyCodesStoryFlags.prototype.activeCategory = function() {
        return findCategory(_activeCategoryId);
    };

    Scene_CabbyCodesStoryFlags.prototype.activeFlags = function() {
        const cat = this.activeCategory();
        return cat && Array.isArray(cat.flags) ? cat.flags : [];
    };

    Scene_CabbyCodesStoryFlags.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesStoryFlags.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesStoryFlags.prototype.createHelpWindow = function() {
        const flags = this.activeFlags();
        const layout = pickerLayoutFor(this, flags.length || 1);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        const cat = this.activeCategory();
        const heading = cat ? cat.label.replace(/\.\.\.$/, '') : 'Story Flags';
        this._helpWindow.setText(`${heading}\nPick a flag to change its value.`);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesStoryFlags.prototype.createListWindow = function() {
        const flags = this.activeFlags();
        const layout = pickerLayoutFor(this, flags.length || 1);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesStoryFlagsList(rect);
        this._listWindow.setFlags(flags);
        this._listWindow.setHandler('ok', this.onFlagOk.bind(this));
        this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
    };

    Scene_CabbyCodesStoryFlags.prototype.onFlagOk = function() {
        const flag = this._listWindow.currentFlag();
        if (!flag) {
            this._listWindow.activate();
            return;
        }
        // Flag entries with an `onSelect` callback route to a dedicated
        // sub-scene (e.g. the per-kid Sewer Kids picker) instead of the
        // standard one-shot value picker. Returning false from onSelect
        // signals "scene push refused" so we can keep the flag list active
        // and the user isn't stranded with no input focus.
        if (typeof flag.onSelect === 'function') {
            const pushed = flag.onSelect();
            if (!pushed) {
                this._listWindow.activate();
            }
            return;
        }
        openValuePickerFor(flag);
    };

    Scene_CabbyCodesStoryFlags.prototype.onListCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesStoryFlags = Scene_CabbyCodesStoryFlags;

    //----------------------------------------------------------------------
    // Window_CabbyCodesStoryFlagsList - flag rows with live current values
    //----------------------------------------------------------------------

    function Window_CabbyCodesStoryFlagsList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesStoryFlagsList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesStoryFlagsList.prototype.constructor = Window_CabbyCodesStoryFlagsList;

    Window_CabbyCodesStoryFlagsList.prototype.initialize = function(rect) {
        this._flags = [];
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_CabbyCodesStoryFlagsList.prototype.setFlags = function(flags) {
        this._flags = Array.isArray(flags) ? flags : [];
        this.refresh();
    };

    Window_CabbyCodesStoryFlagsList.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesStoryFlagsList.prototype.makeCommandList = function() {
        (this._flags || []).forEach((flag, index) => {
            this.addCommand(flag.label, `flag_${flag.id}`, true, index);
        });
    };

    Window_CabbyCodesStoryFlagsList.prototype.currentFlag = function() {
        const index = this.currentExt();
        if (typeof index !== 'number') {
            return null;
        }
        return this._flags[index] || null;
    };

    Window_CabbyCodesStoryFlagsList.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        const flag = this._flags[index];
        if (!flag) {
            return;
        }
        // Flags that own a sub-scene (onSelect set) supply their own
        // formatValue() since the row's "value" is a derived summary
        // string ("5/10") rather than a single var/switch read.
        const valueText = (typeof flag.formatValue === 'function')
            ? flag.formatValue()
            : (rendersAsSwitch(flag)
                ? switchValueLabel(flag, readFlagForDisplay(flag))
                : `= ${readFlagForDisplay(flag)}`);
        const valueWidth = this.textWidth('= 000000');
        const labelWidth = Math.max(0, rect.width - valueWidth - 8);
        this.resetTextColor();
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(flag.label, rect.x, rect.y, labelWidth, 'left');
        this.resetTextColor();
        this.drawText(valueText, rect.x + rect.width - valueWidth, rect.y, valueWidth, 'right');
    };

    window.Window_CabbyCodesStoryFlagsList = Window_CabbyCodesStoryFlagsList;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesStoryFlagValue - per-flag value picker
    //----------------------------------------------------------------------

    function Scene_CabbyCodesStoryFlagValue() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesStoryFlagValue.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesStoryFlagValue.prototype.constructor = Scene_CabbyCodesStoryFlagValue;

    Scene_CabbyCodesStoryFlagValue.prototype.prepare = function(params = {}) {
        this._flag = params.flag || null;
        this._initialValue = Number(params.initialValue) || 0;
        this._onSelect = params.onSelect;
    };

    Scene_CabbyCodesStoryFlagValue.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createValueWindow();
    };

    Scene_CabbyCodesStoryFlagValue.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesStoryFlagValue.prototype.valueOptions = function() {
        return this._flag ? flagOptions(this._flag) : DEFAULT_VALUE_OPTIONS;
    };

    Scene_CabbyCodesStoryFlagValue.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, this.valueOptions().length);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        const label = this._flag ? this._flag.label : 'Story Flag';
        const target = this._flag ? flagTargetLabel(this._flag) : '?';
        const currentDisplay = rendersAsSwitch(this._flag)
            ? switchValueLabel(this._flag, this._flag ? readFlagForDisplay(this._flag) : 0)
            : this._initialValue;
        this._helpWindow.setText(`${label} (${target})\nCurrent: ${currentDisplay}`);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesStoryFlagValue.prototype.createValueWindow = function() {
        const layout = pickerLayoutFor(this, this.valueOptions().length);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._valueWindow = new Window_CabbyCodesStoryFlagValueList(rect);
        this._valueWindow.setOptions(this.valueOptions());
        this._valueWindow.setHandler('ok', this.onValueOk.bind(this));
        this._valueWindow.setHandler('cancel', this.onValueCancel.bind(this));
        this.addWindow(this._valueWindow);
        this._valueWindow.selectValue(this._initialValue);
        this._valueWindow.activate();
    };

    Scene_CabbyCodesStoryFlagValue.prototype.onValueOk = function() {
        const value = this._valueWindow.currentValue();
        if (typeof this._onSelect === 'function' && typeof value === 'number') {
            this._onSelect(value);
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesStoryFlagValue.prototype.onValueCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesStoryFlagValue = Scene_CabbyCodesStoryFlagValue;

    //----------------------------------------------------------------------
    // Window_CabbyCodesStoryFlagValueList - selectable values for one flag
    //----------------------------------------------------------------------

    function Window_CabbyCodesStoryFlagValueList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesStoryFlagValueList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesStoryFlagValueList.prototype.constructor = Window_CabbyCodesStoryFlagValueList;

    Window_CabbyCodesStoryFlagValueList.prototype.initialize = function(rect) {
        this._options = [];
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_CabbyCodesStoryFlagValueList.prototype.setOptions = function(options) {
        this._options = Array.isArray(options) ? options : [];
        this.refresh();
    };

    Window_CabbyCodesStoryFlagValueList.prototype.makeCommandList = function() {
        (this._options || []).forEach(opt => {
            this.addCommand(opt.label, `value_${opt.value}`, true, opt.value);
        });
    };

    Window_CabbyCodesStoryFlagValueList.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesStoryFlagValueList.prototype.currentValue = function() {
        const ext = this.currentExt();
        return typeof ext === 'number' ? ext : null;
    };

    // Selects the closest option at-or-below the current value so the picker
    // starts on something meaningful even when the live value is between or
    // beyond the preset entries.
    Window_CabbyCodesStoryFlagValueList.prototype.selectValue = function(value) {
        if (!this._options.length) {
            return;
        }
        let bestIndex = 0;
        for (let i = 0; i < this._options.length; i += 1) {
            if (this._options[i].value <= value) {
                bestIndex = i;
            }
        }
        this.select(bestIndex);
        this.ensureCursorVisible();
    };

    window.Window_CabbyCodesStoryFlagValueList = Window_CabbyCodesStoryFlagValueList;

    CabbyCodes.log('[CabbyCodes] Story Flags module loaded');
})();
