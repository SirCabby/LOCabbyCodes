# CabbyCodes Mod Installation Guide

Current Version: **0.0.1** (tracked in the root `VERSION` file)

This guide will walk you through installing the CabbyCodes mod for "Look Outside". The installation process involves copying files and adding one entry to the game's plugin configuration.

## Prerequisites

- A copy of "Look Outside" installed via Steam
- Basic file navigation skills
- A text editor (Notepad, Notepad++, VS Code, etc.)

## Installation Location

The game is typically installed at:
```
C:\Program Files (x86)\Steam\steamapps\common\Look Outside
```

**Note:** If you installed Steam in a different location, navigate to your Steam installation folder and find `steamapps\common\Look Outside`.

## Developer Automation

- `make deploy` – replace the installed CabbyCodes files inside the Look Outside installation (defaults to `C:\Program Files (x86)\Steam\steamapps\common\Look Outside`). Existing files are removed and re-verified before copying new ones.
- `make package` – build `dist/LOCabbyCodes.v#.#.#.zip` containing only the files players need (no standalone `VERSION` file is included).
- `make rev X.Y.Z` – bump the project version everywhere (`VERSION`, runtime constant, README). Always run this before packaging a release.
- `make run` – run `make deploy`, stop any running game process, and launch the Steam build via `steam://rungameid/3373660`.

## Step-by-Step Installation

### Step 1: Locate the Game's Plugin Folder

1. Navigate to your game installation folder (see Installation Location above)
2. Open the `js` folder
3. Open the `plugins` folder inside `js`

You should now be at:
```
C:\Program Files (x86)\Steam\steamapps\common\Look Outside\js\plugins
```

### Step 2: Copy the CabbyCodes Loader Plugin

1. Copy the file `CabbyCodes.js` from this repository
2. Paste it into the `js\plugins` folder

The file should now be at:
```
C:\Program Files (x86)\Steam\steamapps\common\Look Outside\js\plugins\CabbyCodes.js
```

### Step 3: Copy the CabbyCodes Mod Folder

1. Copy the entire `CabbyCodes` folder from this repository (the folder containing `cabbycodes-core.js`, `cabbycodes-patches.js`, and `cabbycodes-settings.js`)
2. Paste it into the `js\plugins` folder

The folder structure should now look like:
```
C:\Program Files (x86)\Steam\steamapps\common\Look Outside\js\plugins\
├── CabbyCodes.js
├── CabbyCodes\
│   ├── cabbycodes-core.js
│   ├── cabbycodes-patches.js
│   └── cabbycodes-settings.js
├── (other plugin files...)
```

### Step 4: Register the Plugin in plugins.js

This is the most important step. You need to add the CabbyCodes plugin to the game's plugin list.

1. Navigate to:
   ```
   C:\Program Files (x86)\Steam\steamapps\common\Look Outside\js\plugins.js
   ```

2. **IMPORTANT:** Make a backup copy of `plugins.js` before editing (right-click → Copy, then Paste in the same folder)

3. Open `plugins.js` in a text editor (Notepad works, but Notepad++ or VS Code is recommended)

4. Find the `$plugins` array. It should look like this at the top:
   ```javascript
   var $plugins =
   [
       {
           "name": "MUSH_Audio_Engine",
           "status": true,
           ...
       },
       ...
   ];
   ```

5. You need to add a new entry to this array. Find the closing bracket `];` at the very end of the array (it should be near the end of the file, after all the plugin entries).

6. **BEFORE** the closing `];`, add a comma after the last plugin entry, then add this new entry:

   ```javascript
   {
       "name": "CabbyCodes",
       "status": true,
       "description": "CabbyCodes Mod Loader",
       "parameters": {}
   }
   ```

7. The end of your `$plugins` array should now look something like this:
   ```javascript
       {
           "name": "TunicateScripts",
           "status": true,
           "description": "",
           "parameters": {}
       },
       {
           "name": "CabbyCodes",
           "status": true,
           "description": "CabbyCodes Mod Loader",
           "parameters": {}
       }
   ];
   ```

   **Important Notes:**
   - Make sure there's a comma after the previous plugin entry
   - Make sure the JSON syntax is correct (quotes around keys, proper brackets)
   - The `"status": true` means the plugin is enabled

8. Save the file

### Step 5: Verify Installation

1. Launch "Look Outside"
2. The mod should load automatically when the game starts
3. You can verify it's working by:
   - Opening the game's Options menu
   - Looking for CabbyCodes options such as "Invincibility" near the bottom of the list
   - Opening the `CabbyCodes.log` file (created beside the game's executable) and confirming new `[CabbyCodes]` entries are being written when you toggle options

### Log Output

- Every CabbyCodes message is appended to `CabbyCodes.log` in the game's installation directory (next to `Look Outside.exe` / `Game.exe`).
- If you need to share diagnostics, include this file; it contains timestamps for each log entry.

## Current Features

- **Invincibility Toggle:** Adds an "Invincibility" option to the CabbyCodes section of the Options menu. When enabled, any actor currently in the player's party is prevented from losing HP through combat damage, poison/regen ticks, scripted deaths, or other harmful effects. Toggle it on/off at any time while playing.
- **One Hit Kill Enemies:** Adds a toggle that amplifies any HP damage dealt to an enemy battler into a lethal blow, so a single hit drops even bosses. Party actors are never affected — healing, regen, and friendly HP changes pass through unchanged.
- **Never Miss Attacks:** Adds a toggle that forces every party attack to connect: the hit roll is treated as 100% and the target's evasion is treated as 0 while the option is on. Enemy accuracy and evasion are untouched, so foes can still miss or be dodged normally.
- **Status Immunity:** Adds a toggle that blocks negative status effects from being applied to party actors, protecting them from action-restricting, parameter-reducing, or otherwise harmful states.
- **Always Escape Battles:** Guarantees that the Escape party command succeeds instantly, bypassing the normal escape ratio so you can bail out of encounters without relying on luck.
- **Stamina Control:** Prevents party actors from spending MP (stamina) when using skills, letting you cast freely without worrying about resource management.
- **EXP Rate Slider:** Adds a CabbyCodes options-slider that scales all party EXP gains from 0x (no EXP) up through 10x, plus an "Instant Max" stop that gives enough EXP on the next event to hit the level cap immediately.
- **Infinite Items:** Adds an option that keeps item counts from decreasing. Whether you use them, craft with them, or hand them to a visitor, the inventory count stays put. You can still pick up more; weapons, armor, key items, and a curated set of quest-triggered pseudo-key items (Rat Baby Thing, Dog Tags, Plumbing Tools, colored keys, etc.) are unaffected so scripted events can still progress. Planet / puzzle discs are an explicit exception — they stay in your inventory even after being inserted into a socket.
- **Unbreakable Items:** Adds a toggle that stops weapons (and any other breakable gear) from losing durability when you attack or when enemies use weapon-breaking abilities. Keep your favorite equipment intact regardless of difficulty or special encounters.
- **Unstick Equipment:** Adds a toggle that lets you unequip "stuck" gear directly from the standard Equip menu. While on, every equipment slot becomes selectable even when the slot would normally be class-locked or state-sealed; picking the blank "(no item)" entry sends the removed gear back to the party's inventory through the vanilla equip-change path. Only affects party actors, since the Equip menu only exposes party members.
- **Infinite Ammo:** Keeps every ranged weapon fully loaded and blocks all ammo item costs (magazines, marbles, gas cans, batteries, etc.) so you never have to reload or spend ammunition while the toggle is active.
- **Enemy Health Bars:** Displays sleek HP plates above every enemy (including bosses) whenever the new "Enemy Health Bars" option is enabled. The plates animate with delayed damage trails, show precise HP totals, and remain readable even when the battle screen tone changes.
- **Friendly Door Visitors:** Removes the pool of cursed/hostile door-knock visitors so answering the door never triggers those surprise fights. Disable the option again to restore the original encounter behavior.
- **Send Next Door Visitor:** Adds a one-press option that immediately schedules the next queued (or freshly rolled) knock visitor so you can trigger door events on demand.
- **Free Vending Machines:** Instantly bypass the coin slot mini-game so every vending machine interaction jumps right to the purchase menu with a price of zero.
- **Free Merchants:** Forces every shop menu entry to show a cost of zero, allowing you to buy gear, consumables, and upgrades without spending any gold while the toggle is enabled. Covers both the standard shop UI (Nestor, Trickster, etc.) and Eugene's custom event-driven shop, where picking "Buy." no longer deducts gold.
- **Floor 4 Always Available:** Keeps the apartment elevator's hidden Floor 4 choice permanently visible in the "Where to?" menu at Map074 (`DoorElevator`). The natural game gates that choice behind `(([v[817]<4]))Floor 4` — a `WD_ConditionalChoice` directive that hides it whenever var 817 (`elevatorGame`) is below 4 — and only advances var 817 to 4 when the player rides the elevator in a specific secret sequence (Ground Floor → Floor 3 → Floor 1 → Floor 2); picking any wrong floor along the way resets var 817 back to 0. While this toggle is enabled, every write to var 817 that would drop it below 4 is intercepted (via the freeze-time variable-write interceptor pipeline, so no extra hot-path patch is needed) and overridden to 4 instead, so the elevator's hide-gate never re-triggers. Toggling on also bumps var 817 to 4 immediately so Floor 4 unlocks without a "prime the pump" elevator ride first. Var 817 has no other read sites in the game data — every other 817 hit across CommonEvents, Map\*.json, and Troops.json is a skill or dataId in an unrelated context — so pinning it carries no other side effects, and toggling off simply stops intercepting writes (the natural sequence will then reset var 817 on the next wrong floor pick).
- **Money Editor Button:** Adds a pencil icon button to the gold display on the main menu. Click it to open the same inline editor UI used for inventory items (without the delete option) and instantly set the party's bankroll to any value up to the normal gold cap.
- **Infinite Money:** Adds a toggle that blocks any reduction to the party's gold total. You still earn money normally from events, loot, and shop sales, but spending never lowers the balance while enabled.
- **Give Item:** Adds a "Give Item" press option that opens an inline item-giver scene so you can browse every item, weapon, and armor in the game and grant any quantity directly to the party.
- **Give Missing Items:** Adds a press option that opens a category picker. The cursor starts on **All** so a single confirm still hands over every missing item, weapon, and armor in one shot, but you can also pick **All Items / All Weapons / All Armors** or drill into a specific sub-type (Medical, Snacks, Recipes, Crafting, Cooking, Coins, Disc Objects, Emails, Video Games, Valuables, Key Items, Regular; Simple / Bludgeon / Slashing / Piercing / Two-Handed / Ranged Weapons; Head / Body / Feet / Accessory / Jewelry) to fill in only that bucket. Anything you already own is skipped. Key items and quest-triggered pseudo-key items (Rat Baby Thing, Simple Key, colored keys, etc.) are skipped so event counters stay honest — you can still grant them individually from the Give Item menu. Planet / puzzle discs are included even though they are key items, so the full disc set is handed over when you pick All or All Items.
- **Max Items in Inventory:** Adds a one-press option that tops every stack in your inventory up to the game's per-item limit (after a confirmation prompt). Same key / pseudo-key exclusions as Give Missing Items (planet / puzzle discs are included the same way).
- **Save Anywhere:** Adds an "Enable Saving" toggle that bypasses difficulty-based save restrictions, letting you save from the main menu in situations where the game would normally forbid it.
- **Delete Save Buttons:** Adds an X button to every row of the Load and Save screens. Clicking it prompts for confirmation and then deletes the selected save file without needing to start a new game.
- **Freeze Time of Day:** Locks the in-world clock at its current value. Time-burning actions (cooking, opening the door, playing a videogame, etc.) still execute fully and any queued events run to completion, but the actual game time — not just the displayed clock — stays put, so hour/day side effects like stamina drain, day-segment shifts, and daily resets do not happen while the toggle is on.
- **Set Game Time:** Adds a press option that opens a picker for hour, minute (15-minute increments, matching the in-game clock), and absolute day, with a confirmation prompt before applying. Forward jumps run the game's TimePasses event, so HourPassed (stat decay, quest timers, door spawns) and newDay (daily resets, shop refreshes, plant health) fire the same way they do after a crossword or other time-burning activity; multi-day jumps add an extra newDay for each 4 AM crossing. This works even when Freeze Time is on — Set Time opens a scoped advance-mode token that lets the cascade through for this one call, then re-freezes at the new moment. Normal time-burning activities (crossword, cooking, etc.) stay suppressed under freeze. Backward jumps fall back to a direct write with no cascade.
- **Set Danger Level:** Adds a press option that opens a picker for the time-based encounter danger bonus with five tiers (None 0, Low 60, Medium 160, High 300, Critical 500 — the value at which the in-game danger meter finishes filling its final pip). Only available when the player is outside the apartment, since returning home zeroes the value. Cooperates with Freeze Time — picking a new tier while frozen re-freezes at the chosen value.
- **Set Difficulty:** Adds a press option that opens a picker for the active difficulty (Easy / Normal / Hard). Writes the chosen mode to the game's three mutually-exclusive difficulty switches (EASYMODE / NORMALMODE / HARDMODE), so existing logic that branches on them — escape ratios, weapon-break chance, save restrictions, etc. — picks up the new tier on the next read.
- **Video Games Cost No Time:** Lets you enjoy every console game in your apartment without advancing the in-game clock. The option automatically rewinds the time-of-day variable after each gaming session so the rest of the world remains in sync.
- **Freeze Hygiene / Needs:** Locks all of the hidden personal-need meters against worsening — hygiene, hunger, vigor, morale, social, and calm can't tick downward, and the bad-breath counter (where higher is worse, and the nightly Sleeping event adds +1) can't tick upward. Positive actions like eating, showering, or brushing teeth still move the meters in the good direction.
- **Hidden Needs HUD:** Adds a "Hidden Needs HUD" press option in the CabbyCodes settings. Select it to pop open a dedicated window with every hidden meter (hunger, fatigue, hygiene, morale, calm, social, and the breath-odor tracker), then press OK/Cancel to jump right back into the game.
- **Show Clock HUD:** Adds a toggle that draws a compact clock panel in the top-right corner while you are on the map, showing the live in-game time so you can keep tabs on the schedule without opening menus.
- **Refill Status:** Adds a press-style option that immediately tops up every party member’s HP/MP and maxes out all hidden need meters (hunger, energy, hygiene, morale, calm, social, and breath odor) whenever you select it.
- **Max Cooking Skill:** Adds a press-style option that, after an explicit warning, permanently sets your Cooking skill to the game’s top rank (currently Level 8, Amateur Chef) so you can skip the recipe grind.
- **Oven Ingredient Checkboxes:** Overlays CabbyCodes-styled checkboxes onto the oven ingredient menus so you can instantly see which primary bases have every pairing finished and which secondary combinations you’ve already cooked (the "Nothing" option is always marked complete). Toggle it anytime from the CabbyCodes settings.
- **Craft Ingredient Checkboxes:** Overlays CabbyCodes-styled checkboxes onto the crafting station’s ingredient menus so you can see at a glance which first ingredients still have undiscovered recipes and which (first + second) pairings you’ve already made. Ingredients or pairings that aren’t part of any recipe display a red dash instead of a checkbox, and the "Nothing" option shows no marker on either picker.
- **Cook Book:** Adds a press-style option that opens a dedicated Cook Book scene listing every oven combination in the game, with completion state pulled straight from your save so you can see at a glance what you still need to cook.
- **Recipe Book:** Adds a press-style option that opens a dedicated Recipe Book scene listing every recipe the game tracks, marked off as you discover them so you can plan what to make next without digging through in-game menus.
- **Fast Credits Scroll:** Drops a contextual `Fast Credits: ON/OFF` toggle into the top-right of the screen, just under the CabbyCodes clock, whenever the player is on the end-credits map. Click it to multiply the credits scroll speed by 20x so you can blow through and reach the post-credits portion quickly; click again to drop back to normal speed. The HUD is intentionally not in the Options menu — it only appears when relevant, and both the toggle and the multiplier auto-disable the moment the game transfers to the post-credits "End Results" scoring scroll so the scoring page always plays at normal speed.
- **Story Flags:** Adds a press-style option that opens a four-submenu editor for story-decision flags. **\<Player name\>** (labelled with the protagonist's live actor name — "Sam" by default, or whatever the player renamed actor 1 to) holds Arm State (Both Arms / Lost Right Hand / Lost Left Hand) and a Spore Head On/Off toggle that adds or removes the Fungus Lair mushroom sprite on the protagonist (visible on the overworld and save-slot preview). **Recruits** lists every recruitable companion (Joel, Lyle, Dan, Sophie, Aster, Spider, Morton, Hellen, Leigh, Ernest, Audrey, Philippe, Papineau, Roaches, Rat Child, Goths/Montgomery, plus Ernest's temp-recruit state) as Off/On toggles — flipping On also adds the actor to your party (and Off removes them) so the toggle "actually" recruits without needing to revisit the in-game NPC. Sophie has a third "Home" state that mirrors the post-Harriet-reunion layout (recruited switch off, "back home" switch on, actor removed from the party so she stands as an NPC in Apt22_Harriet) so a save where Sophie has already returned home reads correctly in the picker and you can re-enter that state without replaying the encounter. Rat Child is a tri-state Off / Baby / Adult: Off removes the rat from Sam's apartment entirely (clears `ratBabyIn`), Baby plants the baby rat in the apartment without joining the party, and Adult skips the CE 94 growth cascade by writing the average-rat end-state (`ratShape` 7, `ratFollows`, `ratBabyGrown`) and adding actor 8 to the party — necessary because CE 94's growth dialogs are gated on `CHEATMODE` so the natural cascade runs silently and the apartment sprite doesn't refresh. Switching states requests a map refresh so the rat sprite swaps without leaving the room. **Quest States** holds the verified questline pickers — currently Audrey Advice Cans (`vendingMachf1_Advice`, presets 0/1/2/3/4/8/99/999 covering the natural in-game thresholds plus a generous 999 cap), the Hellen Garden Quest 13-state compound picker covering the full happy-path progression (Not Started → Accepted → Pre-Watering → Day 1/2/3 Wait → Fruit Ripens → Fruit Harvested → Complete) plus the failure outcomes (Aborted, Missed Watering, Hellen Hostile, Hellen Killed), the Plant Quest 7-state picker for Sam's bedroom plant talk arc (Not Started, Tutorial Done, Pre-Confession, Confessing, Awaiting Reply, Rejected, Moving On) — drives `nbTimesTalkedPlant` (var 120), the `tutorialPlant` switch (48), and clears the per-day `talkedPlant` switch (60) on every apply so you can immediately walk up to the plant and trigger the next dialog beat without waiting for newDay; also forces `plantMoved` (switch 79) OFF because the love-confession and rejection branch (var 120 vals 6..12+) is gated inside CE 65's `sw79 OFF` arm and is unreachable on saves where the player pulled the plant into the light; and strips the `(([s[1004]]))` hide-gate off CE 65's Talk choice (a `WD_ConditionalChoice` directive that hides Talk whenever `peopleInAppt` >= 2) so the talk arc is reachable even when you have companions in the apartment; setting "Awaiting Reply" and then talking is the cheat path to the `Misc_PlantRejection` achievement, the Dan Quest 4-state picker covering the NeoDuo retrieval errand (Not Started, Declined, Accepted, Complete) — only the states the player can meaningfully drop into are exposed; the intermediate map-driven phases (apartment door, meeting Mom, retrieving the console, etc.) all read as "Accepted" since they're transient transitions the natural game advances through automatically — the Roaches Quest 6-state picker for the political schism (Not Started, Bickering, Decision Pending, Schism, King, Prime Minister) which drives `roachQuest` (var 899), `roachesSchism` (switch 1095), and the `RoachSchism` state 227 on actor 10 atomically; states with the schism debuff active (Decision Pending and Schism) re-add state 227 to Roaches if it's been cleared, and outcomes that resolve the schism (King / Prime Minister) remove it — the crown / sash armor rewards aren't replicated, grab those via the item editor cheat if you want the actual gear — and the Juicebox Quest 5-state picker for the card-trick errand (Not Started, Ready to Play, Card Trick Played, Card Retrieved, Complete) which drives both `juiceboxCardTrick` (var 741, the card-trick state) and `juiceboxTalk` (var 287, the relationship-talk dialog stage that gates whether Juicebox will offer the trick) — Ready to Play sets var 287 = 6 exactly so the next bedroom visit fires the trick scene; Not Started clamps var 287 down to ≤ 5 so the prerequisite isn't met; the post-trick states bump var 287 up to ≥ 7 so the natural relationship arc continues from where the trick scene leaves it. The vending-machine purchase that retrieves the card is bypassed when jumping directly to Card Retrieved or Complete — the Shadow Quest 8-state picker for the Masked Shadow questline (Not Started, After 1st/2nd/3rd Encounter, Gift At Apartment, Bedroom Pending, Befriended, Defeated) — drives `shadowState` (var 150) and `shadowDispo` (var 152) plus the three supporting switches `recruitedShadow` (27), `shadowGift` (28), and `shadowItemLeft` (161); the previous "Shadow" entry under Recruits has been removed because Shadow never actually joins the party (the natural game's "befriended" outcome is one branch of the bedroom encounter that flips switch 27 ON alongside `shadowState = 20`, so the cheat now exposes it as one ordinal of the questline picker rather than a recruit toggle), the Mazes and Wizards Quest session-count picker for Lyle's tabletop campaign (`sessionNb` / var 701) which exposes the six adventures Lyle runs (Tavern Village, Wilderness, Mysterious Temple, City of Daggerback, Death Barrens) plus 0 (Not Started) and 6 (Complete, the CE 247 CharaClosing wrap-up). Each value is the count of completed sessions; the picker writes var 701 directly and leaves the transient setup mechanics (var 700 `MazesWizardsTalk` and switch 1002 `primeMWgame`, which cycle around each session start) alone since they aren't quest-progression flags, and the Frederic Quest 13-state picker for the painter's apartment (Not Started, In Progress, Tumor / Ring / Rage / Godly / Hat / Closet / Healer / Shy / Faceless Frederic Last Alive, Painter Last Alive, All Killed) — labels reflect each portrait's distinctive trait sourced from its troop dialog (Tumor drops {Tumor Lumps}, Ring brags about a red-gem ring, Rage hands over the Rage Armor companion gear, Godly speaks like a god, Hat is the parasitic Faceless side-event hat, Closet hides in a closet, Healer heals party HP and gives {Medic-in-a-jar}, Shy refuses to be looked at, Faceless is the original Frederic whose face was stolen and who can paint gear duplicates after you return the {Torn-Off Face}) — the Painter has 9 self-portrait copies wandering specific maps as hostile NPCs and rewards the player with a tiered set of items as the count drops; each portrait has both a state variable (`Portrait1_state` / 304 on Map095, `Portrait2_state` / 308 on Map096, `Portrait3_state` / 309 on Map236, `Portrait4_state` / 311 on Map238, `Portrait5_state` / 313 on Map119+, `Portrait6_state` / 315 on Map237, `Portrait7_state` / 320 on Map218, `Portrait8` / 302 on Map097, `Portrait9` / 300 on Map239) using 99 as the canonical "dead" sentinel AND a self switch on its roaming-NPC event that controls which page renders (the dead-body sprite vs the alive sprite). The cheat mirrors both halves of the natural battle-event's death write so that picking a state actually swaps the in-world NPC visibility — survivor + Painter Last Alive + All Killed apply paths set the state var (99 dead, 0 alive) AND flip the matching dead self switch ON for portraits being killed / clear all four self switches A/B/C/D for the survivor; a `$gameMap.requestRefresh()` runs at the end so the sprite swap is visible immediately on the current map. Picking "Portrait N Last Alive" primes `PainterState` (var 305) to 4 + `PortraitsLeft` (var 306) to 1 so the next visit to the Painter NPC fires the final-reward dialog (paint palette) directly — intermediate rewards (turpentine, canvas carry bag, medical supplies) are skipped since they require multiple visits. "Painter Last Alive" is the natural good-ending state where the player has killed all 9 portrait copies and the original Frederic / Painter NPC is the surviving Frederic with `PainterState` set to 5 (paint palette already given) — distinct from "All Killed" which folds the Painter himself into the death sweep (`PainterState` = 99) for a "no Frederic survives" outcome; the read function distinguishes these by checking var 305 alongside the portrait count, so a save in the natural good-ending shows as "Painter Last Alive" rather than misleadingly reading as "All Killed". "Not Started" clears all 9 portraits to 0 with the Painter at his initial state, and "In Progress" leaves the kill configuration alone (so the cheat can re-engage Painter dialog mid-quest without disturbing the player's actual portrait progress). The Faceless / Portrait5 hat side-event (switch 535 `portrait5Friendly`, switches 523/524/525 part-kill flags, var 313's 1/10/12/40/45/46 phase values) is deliberately not managed here so the player can still play that beat naturally on top of any chosen survivor; Portrait5's wall painting and Painter dialog gate update from the var 313 write, but the multi-stage roaming-event self switches across Map119/Map042/Map217/Map236/Map237 are left alone — so reviving Portrait5 from the cheat reopens var 313 but any partially-played hat events keep their existing self-switch state, and the Charan Quest 6-state picker for the basement-pit big-friend arc (Not Started, Met Charan, Mentioned Love, Rose Given, Sword Received, Charan Left) — drives `CharanDispo` (var 630, the first-encounter flag flipped 0 -> 1 by Troop 590's intro page) plus five switches: `shookCharanhand` (678), `CharanMentionedLove` (679, gates the "About that gift..." choice that takes the rose), `gaveCharanRose` (680, set when the player hands over Rose / item 360 inside Troop 590's gift sub-menu), `charanGift` (1064, the medieval-sword thank-you flag CE 213's seeCharan branch flips ON when the player jumps back into the pit after handing over the rose — encoded as a switch only, with no `code:126 Add Item` write, so the cheat just mirrors the flag), and `CharanLeaveEarly` (677, set by CE 6 newDay the day after `gaveCharanRose` flips ON; while ON, CE 213's pit jump branches into the `goCave` -100 HP fall instead of the friendly `seeCharan` catch). Charan-flavor variables that nothing reads (`CharanLift` 816, `CharanJob` 815, `SmoochCount` 629) are deliberately not touched, and the Kevin Quest Off / On availability toggle (Not Available, Available) for the basement-worm Worm-Egg trader at Map094 ev43 — Kevin's appearance is gated in the natural game by the Nestor-questline state machine (`nestorBodyState` / var 437 must be >= 12, plus the event's self-switch C must be OFF), and reaching var 437 == 12 organically requires the player to whittle down Nestor's anatomy through ten-plus Worm body-part events scattered across many maps and then wait two in-game days for CE 6 newDay to tick the var past 10 -> 11 (foot-worm groups appear) -> 12 (Kevin's group becomes active). The toggle skips that wait: "Available" sets var 437 to max(current, 12) and clears the Map094 ev43 self-switch C so any prior post-encounter dead-state flips back to the friendly-encounter page, then requests a map refresh so the sprite swap is visible immediately; "Not Available" clamps var 437 back down to 11 if it's at or above 12 (preserving the foot-worm threshold while closing Kevin's gate), and leaves the self-switch alone so a player who organically engaged Kevin keeps that state. Trade-tier state (var 734 `WormKevin`) and the "already bought" hide-gates (sw 961 `wormBoughtRobe` / sw 962 `wormBoughtCrown`) are deliberately NOT tracked or written — once Kevin is reachable the player handles trades naturally through Troop 560's in-game menu, and reward items (Worm Juice, Worm-Baked Pie, Worm-O'-Nine-Tails, Wormskin Robe, Worm Crown) can be granted directly from the item-editor cheat if desired. The orthogonal `WormDeal` (var 735, 1/2/3 for the 80-/40-/70-year human-worm coexistence outcomes) is also not managed because the natural game grants the `Misc_WormyDeal` achievement via a `setAchievement(...)` script call inside the deal sub-menu — just writing var 735 from the cheat would not award the achievement, so the deal is left to natural play. The trade-off in flipping "Available" is that the var 437 bump unavoidably fast-forwards the rest of the Nestor questline by however many days are still missing (foot-worm groups in Map013 + Map092 will spawn alongside Kevin), since there is no Kevin-specific gate that doesn't also touch nestorBodyState — the cheat does the smallest possible bump (exactly to 12) to minimize the impact, the Marshall Quest 4-state picker for the bathroom-stall voice / foot-worm chase phases (In Stall, Mutated, Mutated (Stronger), Defeated) — Marshall is the leg/foot member of Nestor's worm-anatomy fleet, hiding as a disembodied wisdom-dispenser in the Map054 stall before mutating into the Worm/WormLeg foot-worm at Map054 ev41. The picker drives `nestorFootChase` (var 435), `FirstWormPartsSpawned` (switch 422), and `wormfootDead` (switch 451) atomically: In Stall zeroes var 435 and clears both switches so the worm doesn't appear; Mutated sets var 435 = 5 + sw 422 ON so contact with Marshall ev41 fires Troop 558 (Marshall, base Worm/WormLeg); Mutated (Stronger) sets var 435 = 10 + sw 422 ON for the Troop 559 (Marshall2, Worm/WormLeg_Attack3) fight that the natural game escalates to after the first kill; Defeated keeps var 435 = 10 + sw 422 ON and flips sw 451 ON so Marshall ev41's defeated page wins and the WormFoot battle event is bypassed. The dialog-stage var 733 (`MarshallStall`) that drives the stall's wisdom-progression dialog is left alone — the natural game keeps the stall talkable forever regardless of mutation, and var 544 `bossesKilled` is also untouched on Defeated since it's shared across every boss. Trade-off: switch 422 is the shared "all worm parts spawned" gate, so flipping a Mutated state also lets any other Nestor body-part NPC whose own chase var is already primed (var 434 `nestorHeadChase`, var 436 `nestorHandChase`, var 437 `nestorBodyState`) materialize alongside Marshall, and the Fuzzy Quest 7-state picker for Joel's teddy bear (Pristine, Shredded, Remains, Repaired by Eugene, Mangled by Sam, Renegade (Xaria), Worm (Nestor)) — each label corresponds to one of the seven Fuzzy variant weapons (`$dataWeapons` ids 91 / 170 / 171 / 172 / 173 / 174 / 175) the natural game grants Joel as the rat-child shred + apology + repair paths play out. Applying a state adds 1 of the chosen variant to inventory, calls `actor 4 changeEquipById` to put it in Joel's weapon slot (which moves it from inventory to equipped via the engine's `tradeItemWithParty`), then sweeps every other Fuzzy variant out of inventory so the player ends up with exactly one Fuzzy on Joel and zero held copies. Var 614 (`ratInteractState`) is bumped to >= 3 (post-apology) for any non-Pristine state so the natural rat-shreds-Fuzzy event at val 2 can't re-fire and overwrite the cheat, and clamped down to 1 when picking Pristine so the natural shred can still play through organically. Joel does not need to be in the party — `$gameActors.actor(4)` works regardless and the equip persists when he later joins. The deeper var 190 (`EugeneRepairingFuzzy`) state machine — which spans Eugene Shop / Nestor Shop / CE 6 daily ticks — is intentionally not synthesized for each variant because that progression is fragile; if you applied "Repaired by Eugene" but Eugene's dialog is mid-conversation, just re-engage Eugene to nudge the conversation forward naturally. Read priority is Joel's currently equipped weapon first, falling back to the highest-tier Fuzzy variant in `$gameParty` inventory, falling back to "Pristine" when nothing matches (so saves before Joel joins still read sensibly). The Hellen entry drives `HellenQuestPhase` (var 869) and the four supporting switches (`HellenWateredPlant`, `MissedHellenWatering`, `HellenSpawned`, `ChasingHellenKilled`) atomically so toggling between any two states leaves the in-game flag combination consistent; the Dan entry writes the canonical `danQuestState` (var 896) value for each label. **Video Games** lists every cartridge in Sam's apartment (Wake The Blood Knight, Wizard's Hell, Super Jumplad 1/3, Catafalque, Honko's Grand Journey, Madwheels 97, Wraithscourge, Massacre Princess, Kill To Shoot, Myrmidon I/XII, Screamatorium, Frogit About It, Blood Ghoul Orgy 3, Octocook, Space Truckerz, Reptile Football, Auntie Wilma's Crossword) with a per-cartridge "K Left" counter showing how many more plays remain before the skill is awarded (or "Earned" once it is), plus a top-of-list "Set all unfinished to..." action that lets you bulk-set every still-unlearned cartridge to either "1 Left" (next play awards the skill) or "Earned" (mark complete — pushes the counter past the trigger and grants the skill to actor 1 directly), with a Yes/No confirmation prompt before the writes go in. "Earned (skip)" on the per-cartridge picker uses the same direct skill-grant path so the equality-comparator games can be marked complete without leaving the variable in a state where the cabinet would never re-award the skill. The Sewer Kids Quest entry under Quest States is a compound that opens a dedicated per-kid screen (since the standard one-shot value picker can't capture all 10 individual kids plus the David counters at once) — the row in the Quest States list shows a live `X/10` saved-count so you can see overall progress at a glance, and selecting it pushes the management screen. That screen lists each of the 10 children David is searching for (Alice/Fly, Thomas/Eyestalk, Coralie/Cosmo, Florence/Eyeball, Victor/Game, Oliver/Spooky, Tristan/Tentacles, Charlie/Croco, Zachary/Centipede, Roxie/Service Dog) as a Saved / Not Saved toggle, with a "Set all kids to..." bulk action at the top (Save All / Reset All, behind a Yes/No confirmation). Each toggle flips the kid's individual `savedKid*` switch (770..779), recomputes the shared `SewerKids_*` "troop encountered" variable for paired groups (Thomas+Coralie share var 726, Florence+Victor share 727, Tristan+Charlie share 729) so the natural game's intro-skip gate stays honest, and re-derives `sewerKidsTotal` (var 724) from the six counting troop groups (Roxie's Service Dog group does not increment in the natural game) plus mirrors that count into `sewerKidsReported` (var 723) so David's "any news?" reward branch reads as already-reported instead of replaying. The screen header shows live `Saved X/10  -  Reported X/6` so you can see the global state at a glance. The `Misc_SewerKids` achievement is granted via a `setAchievement(...)` script call inside David's all-back dialog (not via a switch flip), so the cheat doesn't try to award it from here — visiting David after the cheat is a no-op since var 723 already equals var 724; players who want the achievement should save at least the last troop group (Centipede or any other counting group) by playing through the natural rescue dialog, since that path increments var 724 without touching var 723 and reopens the gap David's reward branch needs. The natural-game prerequisite that Zachary won't agree to leave the sewer until Roxie has been calmed with a chew toy is intentionally not enforced — the cheat applies switches directly so any combination of saved kids is reachable. Cooperates with Freeze Time and logs every change at WARN level so you can correlate in-game dialogue with the specific switch/variable.

## Troubleshooting

### The mod doesn't appear to be working

1. **Check file locations:**
   - Verify `CabbyCodes.js` is in `js\plugins\`
   - Verify the `CabbyCodes` folder is in `js\plugins\CabbyCodes\`
   - Verify all three files are inside the `CabbyCodes` folder

2. **Check plugins.js:**
   - Open `plugins.js` and search for "CabbyCodes"
   - Verify the entry is correctly formatted (proper JSON syntax)
   - Verify `"status": true` (not `false`)
   - Make sure there are no syntax errors (missing commas, brackets, etc.)

3. **Check the log:**
   - Open `CabbyCodes.log` in the game's installation folder
   - Look for recent lines that start with `[CabbyCodes]` to confirm the loader ran and to review any warnings/errors

### Game won't start after installation

1. **Restore from backup:**
   - If you made a backup of `plugins.js`, restore it
   - If not, you may need to verify game files through Steam (right-click game → Properties → Local Files → Verify integrity of game files)

2. **Check JSON syntax:**
   - The `plugins.js` file uses JSON format
   - Common errors:
     - Missing commas between entries
     - Missing quotes around keys
     - Extra commas at the end of arrays/objects
     - Mismatched brackets

3. **Use a JSON validator:**
   - Copy the contents of `plugins.js` (just the `$plugins` array part)
   - Paste it into an online JSON validator to check for syntax errors

### Settings don't appear in Options menu

- The settings menu will only show options if settings have been registered by mod features
- If no features are active yet, the menu section may not appear
- This is normal - the mod framework is still loaded and ready for features to be added

## Uninstallation

To remove the mod:

1. Delete `CabbyCodes.js` from `js\plugins\`
2. Delete the `CabbyCodes` folder from `js\plugins\`
3. Open `plugins.js` and remove the CabbyCodes entry from the `$plugins` array
4. Save the file

## File Structure Reference

After installation, your file structure should match this:

```
C:\Program Files (x86)\Steam\steamapps\common\Look Outside\
├── js\
│   ├── plugins\
│   │   ├── CabbyCodes.js          ← Loader plugin (you added this)
│   │   ├── CabbyCodes\            ← Mod folder (you added this)
│   │   │   ├── cabbycodes-core.js
│   │   │   ├── cabbycodes-logger.js
│   │   │   ├── cabbycodes-patches.js
│   │   │   ├── cabbycodes-settings.js
│   │   │   ├── cabbycodes-invincibility.js
│   │   │   ├── cabbycodes-stamina.js
│   │   │   └── cabbycodes-infinite-consumables.js
│   │   ├── plugins.js              ← You modified this file
│   │   └── (other existing plugins...)
│   └── (other game files...)
├── CabbyCodes.log                  ← Automatically generated runtime log
└── (other game folders...)
```

## Support

If you encounter issues not covered in this guide:

1. Double-check all file locations match the guide exactly
2. Verify the JSON syntax in `plugins.js` is correct
3. Make sure all files were copied completely (not corrupted)
4. Try removing and reinstalling following the steps again

## Technical Details

For developers or advanced users:

- The mod uses the standard RPG Maker MZ plugin system
- Settings are stored in browser localStorage under the key `CabbyCodes_Settings`
- The loader plugin dynamically loads scripts from the `CabbyCodes` folder
- All mod functionality is contained within the `CabbyCodes` folder - no game files are permanently modified
- Diagnostic logs are written to `CabbyCodes.log` in the game's installation directory

