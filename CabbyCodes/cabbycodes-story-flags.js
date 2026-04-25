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
        { id: 'shadow',     label: 'Shadow',                kind: 'switch', switchId: 27 },
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

    // Quest-state variables. Each entry needs a real understanding of what
    // the variable drives in-game; speculative entries on under-investigated
    // variables previously lived here (Joel/Shadow/Papineau/Lyle/Nestor/
    // Goth/WarBomb/RatHole/RatInteract/ErnestTimes/SpiderHusk/Sybil/Dan)
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
        const current = readFlagForDisplay(flag);
        const valueText = rendersAsSwitch(flag)
            ? switchValueLabel(flag, current)
            : `= ${current}`;
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
