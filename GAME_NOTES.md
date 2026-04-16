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
| 81–101 | Named per-videogame sessions (`Super Jumplad`, `Catafalque`, etc.) | Arcade-cabinet state |

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

Recruitment flags (`recruitedDan`, `recruitedJoel`, `recruitedLeigh`,
`recruitedHellen`, `recruitedShadow`) live at IDs 27, 32–35 and are safe to
read for feature gating but should **not** be toggled by the mod.

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
