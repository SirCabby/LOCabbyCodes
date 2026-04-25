# Game Notes — *Look Outside*

Living reference for what we've learned about the vanilla game while building
CabbyCodes. Pair with `AGENTS.md` (project conventions) and `ARCHITECTURE.md`
(mod runtime).

> **Source of truth:** the local `game_files/` mirror (gitignored). Run
> `/refresh-game-files` (or `node scripts/refresh-game-files.js --check`)
> whenever Steam reports an update — numeric IDs below can shift between
> patches.

---

## 1. Meta

| Field | Value |
| --- | --- |
| Title | Look Outside |
| Engine | RPG Maker MZ (NW.js host) |
| Steam AppID | `3373660` |
| Current buildid (cache) | `22797627` (see `game_files/.manifest.json`) |
| `System.json` `versionId` | `74642914` — bumps every time the dev saves from MZ editor |
| `advanced.gameId` | `51778622` |
| Encryption | `hasEncryptedAudio: true`, `hasEncryptedImages: true`, `encryptionKey` in `data/System.json` |
| Currency symbol | `$` |

Install path hardcoded in `Makefile` + `scripts/refresh-game-files.js`:
`C:/Program Files (x86)/Steam/steamapps/common/Look Outside`.

---

## 2. `game_files/` layout (what we mirror)

Refreshed wholesale by `scripts/refresh-game-files.js`:

```
game_files/
├── .manifest.json    # buildid + fingerprints written on refresh
├── js/               # main.js, rmmz_*.js, plugins/, plugins.js
├── data/             # all JSON databases + Map*.json (~151 MB, 487 files)
└── package.json      # NW.js window config + chromium args
```

Data file inventory (by array length at last refresh):

| File | Entries |
| --- | --- |
| `Actors.json` | 46 |
| `Classes.json` | 42 |
| `Items.json` | 711 |
| `Weapons.json` | 301 |
| `Armors.json` | 501 |
| `Skills.json` | 1,161 |
| `States.json` | 401 |
| `Enemies.json` | 1,001 |
| `CommonEvents.json` | 301 |
| `System.variables` | 1,021 |
| `System.switches` | 1,401 |
| `MapInfos.json` | 475 |

---

## 3. Variables worth knowing (`data/System.json → variables`)

IDs 1–5 are `-Reserved N-`. Notable named slots used heavily by the engine:

| ID | Name | Purpose |
| --- | --- | --- |
| 9 | `code` | Generic scratch code slot used by common events |
| 10 | `ticktock` | Driven by the TickTock parallel — time heartbeat |
| 12 | `displayedTime` | What the clock HUD prints |
| 13 | `timeDay` | Day of week (0–6) |
| 14 | `calendarDay` | Absolute day counter |
| 15–17 | `currentDay` / `currentHour` / `currentMinute` | In-world clock |
| 18 | `roomsVisited` | Room-transition counter |
| 19 | `minutesPassCount` | Accumulator for the minute tick |
| 20 | `clockHour` | Rendered hour on HUDs |
| 21–27 | `statSocial` / `statCalm` / `statVigor` / `statFood` / `statHygiene` / `statMorale` / `statOverall` | **Hidden needs meters** |
| 29–35 | `warn*` (mirror of the stat names) | Threshold flags for HUD warnings |
| 36 | `offeringCount` | Shadow-offering counter |
| 38 | `partySize` | Current party size |
| 42–43 | `usingObject`, `playGameSequence` | Interaction state for playing a videogame / using object |
| 44 | `sinceLastTeethbrush` | Drives the bad-breath / hygiene check |
| 45 | `weaponBreakMulligans` | Freebies against durability loss |
| 48–60 | `currentKnock*`, `KnockEnc<1-3>_*` | Door-knock encounter queue (type / hour / index) |
| 61–65 | `playerPosX`, `playerPosY`, `playerRoom`, `playerDashing`, `regionId` | Player location state |
| 68–69 | `varmetaTag*` | Populated from `<varmetaTag:...>` note-tag reads |
| 70–79 | Crafting / oven state (`ItemCooking1/2`, `itemCreated`, `recipeIndex`, etc.) | Kitchen mini-game |
| 81–101 | Named per-videogame sessions (`Super Jumplad`, `Catafalque`, etc.) | Arcade-cabinet state. Each cartridge increments its own variable by 1 at the end of every play; the cartridge's CE (CE 21..39 `game:<TitleName>`) gates a `Game_Actor.code 318` skill grant on a comparator threshold. Mapping (var → triggerVar / comparator → skillId): 81 ==3 → 413, 82 ≥4 → 410, 83 ==1 → 401, 84 ==4 → 405, 85 ==3 → 418, 86 ==3 → 412, 87 ==4 → 402, 88 ==3 → 416, 89 ==11 → 409, 90 ==3 → 411, 91 ≥3 → 403, 92 ==5 → 417, 93 ==3 → 404, 94 ==4 → 406, 95 ==3 → 407, 96 ==3 → 408, 97 ==3 → 414, 98 ==3 → 415, 99 ==4 → 419. Skill is granted on the play that *enters* with the variable already at the threshold, so a cartridge sits at `triggerVar+1` once mastered. `cabbycodes-video-games.js` exposes "K Left" pickers backed by these IDs and a bulk "set unfinished to 1 left" action. CE 40 / 41 (`game:UnlabeledGame`, `game:Glitchy`) intentionally have no var/skill writes. |
| 187 | `armChoice` | Arm-sacrifice outcome: `0` = both arms, `1` = lost right hand, `2` = lost left hand. Enforced by `TunicateScripts.js` (also in `bunchastuff_old.js`): `canEquipWeapon` / `canEquipArmor` block gear, `Window_StatusBase.actorSlotName` renames the slot to "Gnawed Off", and `Game_Actor.setCharacterImage` / `Game_CharacterBase.setImage` append `_MissingRightarm` or `_MissingLeftarm` to actor 1's `_characterName`. Separately, States 33 ("Mangled right hand", code-54 sealing equipType 1) and 34 ("Mangled left hand", code-54 sealing equipType 2) seal the actual equip slot itself so the menu greys it out — the in-game arm-loss event applies these via a path not visible to static grep (no code-313, no skill/item effects, no plugin `addState` reference). Toggling var 187 via cheat needs four reconciles on actor 1: (a) `removeState(33)` + `removeState(34)` to unseal the slot, (b) `releaseUnequippableItems(false)` to drop now-illegal gear, (c) strip the `_Missing(Right\|Left)arm$` suffix and re-call `setCharacterImage(baseName, idx)` so the suffix matches the new value (the override only triggers when the input name is in `arm_change_sprites = ["Chara_Player"]`, so the suffixed name is sticky), and (d) `$gamePlayer.refresh()` + `$gamePlayer.followers().refresh()` to repaint the on-map sprite. |

Cross-check before writing: `cabbycodes-freeze-time.js`, `cabbycodes-doorbell.js`,
and `cabbycodes-hidden-stats-display.js` already hardcode these IDs. When a
patch shifts an ID, grep those files first.

---

## 4. Switches worth knowing (`data/System.json → switches`)

| ID | Name | Purpose |
| --- | --- | --- |
| 6 | `RELEASEMODE` | True in shipping builds |
| 7 | `CHEATMODE` | Dev flag. **Do not toggle** — game content gates on it |
| 8 / 13 / 31 | `HARDMODE` / `EASYMODE` / `NORMALMODE` | Difficulty selection |
| 9 | `IRONMAN` | Permadeath / no manual save |
| 10 | `ParallelRun` | Master parallel gate — feeds TickTock + StepSoundTrigger |
| 14 | `needDurabilityRoll` | Signals a weapon-break check is pending |
| 18–20 | `sleeping`, `startWakeup`, `wakeUpEnd` | Sleep scene phases |
| 21–23 | `havePower`, `haveHotWater`, `haveWater` | Utility availability (affects shower / cooking) |
| 24–25 | `someoneAtDoor`, `playerIsHome` | Doorbell + apartment state |
| 26, 37 | `TEMPSAVEDISABLE`, `ALLOWSAVE` | Save-anywhere gating — **both** are read, see `cabbycodes-save-anywhere.js` |
| 29 | `promptSave` | Triggers the autosave prompt |
| 40 | `primeNewDay` | Fires the daily rollover |
| 41 | `TesterCheats` | Internal QA flag |
| 68 | `needAmmoSpend` | Ammo-consume request from a skill |
| 78 | `DISABLEPARALLEL` | Global kill-switch for parallel common events |

### Recruit-tracking switches

The game gates each recruitable companion behind a `recruitedX` switch.
Flipping the switch ON does **not** add the actor to the party by itself —
the in-game recruit Common Event runs `code:121 Set Switch` *and then*
`code:129 Add Party Member`. The cheat (`cabbycodes-story-flags.js`)
mirrors that pairing so a toggle "actually" recruits.

IDs computed from `System.json` line numbers using offset 362 (`someoneAtDoor`
line 386 ↔ switch ID 24), cross-checked against the dev "Recruit ALL" menu
at `Map003.json:23690+` which labels each branch by character name.

| Switch ID | Name | Actor ID | Notes |
| --- | --- | --- | --- |
| 27  | `recruitedShadow`     | (none)        | Shadow is summoned, not a normal party actor |
| 32  | `recruitedDan`        | 6             | Dev menu confirms `"Recruit Dan"` → switch 32 |
| 33  | `recruitedJoel`       | 4             | High-traffic flag; gated by lots of dialogue |
| 34  | `recruitedLeigh`      | 5             | Dev menu confirms `"Recruit Leigh"` → switch 34 |
| 35  | `recruitedHellen`     | 7             | Dev menu confirms `"Recruit Hellen"` → switch 35 |
| 361 | `recruitedErnest`     | 11            | Pairs with `ErnestTempRecruit` (792, probationary) |
| 362 | `recruitedSophie`     | 12            | Dev menu confirms `"Recruit Sophie"` → switch 362. Pairs with `SophieBackHome` (364); the Sophie cheat exposes both as a single Off/Recruited/Home tri-state. |
| 363 | `recruitedGoths`      | (multi)       | Covers ≥2 goth actors (user-confirmed). Leave `actorId` unset in the cheat so only the switch flips. |
| 364 | `SophieBackHome`      | 12 (NPC)      | Set ON by the Harriet-reunion troop event in `Troops.json` (which simultaneously flips 362 OFF and removes actor 12). When ON, Sophie spawns as an NPC in `Apt22_Harriet` (Map334) instead of following Sam. |
| 369 | `recruitedRoaches`    | 10            | Canonical "is recruited" flag (most reads). The Roaches recruit cheat drives this in lockstep with 249 and 370 to mirror Troop 279's accept branch — see notes below. |
| 370 | `recruitedRoachesFull`| 10            | Companion flag. Read by CE 33 (`game:Screamatorium`) and CE 205 (`sqs`) to branch Roaches dialogue. Set ON alongside 369 by the natural recruit. |
| 371 | `recruitedMorton`     | 16            | |
| 372 | `recruitedKindface`   | —             | **Dead** (no matching actor). Skip. |
| 373 | `recruitedMelted`     | 18 (Melt)     | **Dead** switch — Melt is recruited via a different path |
| 374 | `recruitedAster`      | 3             | |
| 375 | `recruitedSpider`     | 19            | |
| 376 | `recruitedLyle`       | 2             | |
| 377 | `recruitedWretch`     | 9 (Wretch)    | **Dead** switch — Wretch is recruited via a different path |
| 378 | `recruitedPapineau`   | 13            | |
| 379 | `recruitedPhilippe`   | 26            | |
| 380 | `recruitedAudrey`     | 22            | |
| 792 | `ErnestTempRecruit`   | 11            | Probationary state; toggle does **not** call addActor |

Read flags freely for feature gating. Writes are now mod-managed via the
Story Flags cheat — when adding new features that mutate recruit state,
go through the same flag definitions to keep the switch + actor party
membership in sync.

### Roaches recruit chain (switches 249 + 369 + 370)

Troop 279 ("Roach Man") accept branch flips three switches in lockstep,
not just `recruitedRoaches`:

- `recruitedRoaches` (369) — canonical recruit flag, gates most downstream reads.
- `recruitedRoachesFull` (370) — branches Roaches dialogue in CE 33 / CE 205.
- `roachRecruit` (249) — gates the post-recruit Chara_Recruit2 NPC page in
  `Map004` (Sam's bathroom) that calls CE 137 "Talk Roaches". Without 249,
  Roaches never spawns in the bathroom and the in-dialog "Manage Party"
  choice (CE 137) is unreachable, so the player can't actually take him
  along even if 369 is on.

The Roaches cheat must drive all three together; flipping 369 alone
recreates the dev-menu shortcut state, not the post-recruit game state.

### Rat Child recruit chain (actor 8, two vars + three switches)

The rat child is **actor 8** (`RatChild` sprite, class 20). The natural
flow uses CE 94 `ratchildDay` to cascade through growth phases, but its
visible feedback is gated on `CHEATMODE` (switch 7) so a normal player
sees no on-screen change when CE 94 advances state — and the apartment
sprite (Map003 `ratbaby` event) only re-evaluates page conditions on
map refresh. The Rat Child cheat sets the end-state directly:

- `ratBabyIn` (switch 365) — "rat is in the apartment". All ratbaby
  page conditions in Map003 require this. Off = rat absent.
- `ratFollows` (switch 290) — gates the adult sprite page (RatChild#0)
  AND the joinable flag set in CE 94 block 6.
- `ratBabyGrown` (switch 366) — set ON in CE 94's intermediate→final
  step (line 156); branches downstream dialogue.
- `ratGrowth` (var 386) — daily input counter consumed by CE 94 in
  chunks (1/2/3/4) per phase. Cleared by the cheat.
- `ratShape` (var 388) — internal CE 94 state machine. End-state
  values 7 / 12-15 / 17-20 are the adult forms. The cheat writes 7
  ("Average Rat"), the CE 94 fallback when no disposition variable
  (387/389/390/392/393/394/396) dominates.

CE 92 `ratchild` is the in-apartment dialog that natively handles
Add/Remove actor 8 from party (code 129) and the "give the rat away"
branch that flips switch 365 OFF. The cheat skips it and writes
directly so toggles take effect without the player walking back home.

`peopleInAppt` (var 37) is incremented by +1 in CE 94 block 6 on first
baby→adult transition. The cheat intentionally does NOT touch var 37:
the natural game has no inverse and toggling Adult→Off→Adult would
double-count.

---

## 5. Common events (`data/CommonEvents.json`, 301 entries)

Hot parallels you will see patched or referenced by CabbyCodes:

| ID | Name | Trigger | Switch | Notes |
| --- | --- | --- | --- | --- |
| 1 | `TickTock` | Parallel | `ParallelRun` | Advances `ticktock` + clock vars |
| 2 | `Parallel` | Parallel | `ParallelRun` | General frame work |
| 3 | `return home` | Autorun | — | Teleports player home on certain failures |
| 4–6 | `TimePasses`, `HourPassed`, `newDay` | Call | — | Invoked by interpreter when clock thresholds cross |
| 7 | `updateKnockSound` | Call | — | Picks knock sfx/pitch |
| 8 | `StepSoundTrigger` | Parallel | `ParallelRun` | Per-step audio hook |
| 12 | `play videogame` | Call | — | Entry point for every arcade cabinet |
| 15 | `handleSnacks` | Call | — | Applies food effects to needs |
| 18 / 19 / 20 | `spendBullets` / `reload` / `meleeAttack` | Call | — | Combat plumbing — ammo mod hooks here |
| 21–39 | `game:<TitleName>` | Call | — | Per-cartridge videogame logic |

IDs beyond 40 are story / mission scripts. Treat them as read-only references.

---

## 6. Item schema quick-reference

`data/Items.json → itypeId` encodes the category:

| `itypeId` | Meaning |
| --- | --- |
| 1 | Regular item (consumables, crafting reagents) |
| 2 | Key item (non-consumable, quest-critical) |
| 3 | Mixed bucket — cooking ingredients **and** videogame cartridges |
| 4 | Game-mode "items" (e.g. `Explorer Mode`, difficulty selectors) |

`cabbycodes-item-giver.js::isKeyItemData` already excludes `itypeId === 2` from
the item-grant list; extend that filter if you need to hide type-4 entries.

### Note-tag vocabulary

The game uses `<tag:value>` metadata in the `note` field across several
databases. Tags seen in the current build:

- **Weapons:** `WD_Items`, `atkAnimShift`, `breakJnkAmnt`, `breakMsg`,
  `breakOb`, `breakSnd`, `fragile`, `reach`, `repairTo`, `safeHits`
- **Items:** `WD_Items`, `amnt`, `appraiseVal`, `breath`, `ckCode`, `coinval`,
  `food`, `ing1`, `ing2`, `morale`, `mxCode`, `res`, `teeth`, `vigor`
- **Armors:** `WD_Items`, `appraiseVal`, `bigburstNeed`, `burstNeed`,
  `emptyOb`, `maxAmmo`, `optimumBonus`, `wpnIndex`
- **Enemies:** `advice`, `altFrm`, `animFrms`, `animSpd`, `baseSprite`,
  `defaultPose`, `enemyType`, `glitchfrms`, `level`, `lore`, `moveCloseOb`,
  `normFrm`, `shiftX`, `shiftY`, `sineX(Rand|Spd)`, `sineY(Rand|Spd)`,
  `stealItem`, `trailCount`, `trailLagFrames`, `trailOpacity`, `transformOb`,
  `vocab`
- **Skills:** `ApplyState`, `DisableWithSwitch`, `DisableWithoutItem`,
  `RemoveState`, `RemoveWith(out)State1/2`, `ReqItem`, `ReqStateId`,
  `ReqStateIdAlt2/3`, `UseItemId`, `WithItemId`, `ammoUse`, `breakRate`,
  `hp_cost`, `hp_ratio`, `targetState`, `usePerShot`, `viewerChange`
- **States:** `healState`, `removeStateOnApply`, `timeoutState`

These are parsed by various third-party plugins (see §7) and by the game's
own scripts. A new tag appearing after a patch is a strong signal that new
mechanics were added.

---

## 7. Third-party plugin inventory

`js/plugins.js` carries 27 plugins. The ones we actually interact with:

| Plugin | Status | Why it matters to us |
| --- | --- | --- |
| `MUSH_Audio_Engine` | On | Owns all SFX/BGM playback |
| `PluginCommonBase` | On | Provides `<note-tag>` parsing — many of the tags in §6 |
| `ItemReqForSkill` | On | Reads `<ReqItem>`, `<UseItemId>`, etc. on skills |
| `bunchastuff` (+ `bunchastuff_old`) | On | Game-specific grab bag — needs/doorbell/weapon durability live here |
| `WD_ItemUse` / `WD_ConditionalChoice` | On | Item-selection prompts and conditional choices |
| `TLB_LimitedShopStock` | On | Shop stock caps (relevant to Free Merchants) |
| `HPConsumeSkill` | On | HP-cost skills (via `<hp_cost>` / `<hp_ratio>`) |
| `regenDamageResistFix` | On | Regen-vs-damage ordering fix |
| `TunicateScripts` | On | Shipping-game tweaks — always the last gameplay plugin before CabbyCodes |
| `Hendrix_Localization` | **Off** | CSV-driven text replacement; disabled in this build |
| `SuperFrontViewMZ` | **Off** | Battle-UI overhaul, disabled |

If we patch the same prototype methods as any of these, remember the
CabbyCodes loader runs *after* them (it's appended to the plugin list), so we
sit on top of their overrides. Use `CabbyCodes.callOriginal` to delegate.

---

## 8. Patch-watch checklist

When Steam patches the game, run `/refresh-game-files` and then re-validate
the following before shipping a new CabbyCodes build:

1. `System.versionId` changed → at minimum, variable/switch IDs may have
   shifted. Diff `game_files/data/System.json` against the prior snapshot.
2. `CommonEvents.json` size changed dramatically → story content added;
   re-skim the named events in §5 for moved IDs.
3. New note-tags appear on items/weapons/skills → a plugin behaviour changed
   or a new one shipped; scan `js/plugins.js` for additions.
4. `bunchastuff.js` or `TunicateScripts.js` hash changed → dev hand-edits
   gameplay regularly. Many of our overrides patch functions defined there;
   open them and re-confirm the signatures we hook.
5. Run `make deploy && make run` on a throwaway save to smoke-test every
   toggle before tagging a release.

---

## 9. How to keep this file useful

- Add new rows to the tables above as you discover more named variables,
  switches, note-tags, or plugin quirks. Keep entries short — one line per
  fact.
- When a fact becomes obsolete after a patch, **edit it in place** rather
  than leaving stale notes. This file exists because IDs drift.
- If you find a note-tag whose behaviour isn't obvious from the plugin that
  consumes it, drop a one-line clarification under §6 so the next person
  doesn't have to re-trace the plugin source.
- Don't paste large JSON blobs here. Point at `game_files/data/<file>.json`
  and describe the shape.
