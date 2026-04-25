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
- **Infinite Ammo:** Keeps every ranged weapon fully loaded and blocks all ammo item costs (magazines, marbles, gas cans, batteries, etc.) so you never have to reload or spend ammunition while the toggle is active.
- **Enemy Health Bars:** Displays sleek HP plates above every enemy (including bosses) whenever the new "Enemy Health Bars" option is enabled. The plates animate with delayed damage trails, show precise HP totals, and remain readable even when the battle screen tone changes.
- **Friendly Door Visitors:** Removes the pool of cursed/hostile door-knock visitors so answering the door never triggers those surprise fights. Disable the option again to restore the original encounter behavior.
- **Send Next Door Visitor:** Adds a one-press option that immediately schedules the next queued (or freshly rolled) knock visitor so you can trigger door events on demand.
- **Free Vending Machines:** Instantly bypass the coin slot mini-game so every vending machine interaction jumps right to the purchase menu with a price of zero.
- **Free Merchants:** Forces every shop menu entry to show a cost of zero, allowing you to buy gear, consumables, and upgrades without spending any gold while the toggle is enabled. Covers both the standard shop UI (Nestor, Trickster, etc.) and Eugene's custom event-driven shop, where picking "Buy." no longer deducts gold.
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
- **Story Flags:** Adds a press-style option that opens a four-submenu editor for story-decision flags. **\<Player name\>** (labelled with the protagonist's live actor name — "Sam" by default, or whatever the player renamed actor 1 to) holds Arm State (Both Arms / Lost Right Hand / Lost Left Hand) and a Spore Head On/Off toggle that adds or removes the Fungus Lair mushroom sprite on the protagonist (visible on the overworld and save-slot preview). **Recruits** lists every recruitable companion (Joel, Lyle, Dan, Sophie, Aster, Spider, Morton, Hellen, Leigh, Ernest, Audrey, Philippe, Papineau, Roaches, Rat Child, Goths/Montgomery, Shadow, plus Ernest's temp-recruit state) as Off/On toggles — flipping On also adds the actor to your party (and Off removes them) so the toggle "actually" recruits without needing to revisit the in-game NPC. Sophie has a third "Home" state that mirrors the post-Harriet-reunion layout (recruited switch off, "back home" switch on, actor removed from the party so she stands as an NPC in Apt22_Harriet) so a save where Sophie has already returned home reads correctly in the picker and you can re-enter that state without replaying the encounter. Rat Child is a tri-state Off / Baby / Adult: Off removes the rat from Sam's apartment entirely (clears `ratBabyIn`), Baby plants the baby rat in the apartment without joining the party, and Adult skips the CE 94 growth cascade by writing the average-rat end-state (`ratShape` 7, `ratFollows`, `ratBabyGrown`) and adding actor 8 to the party — necessary because CE 94's growth dialogs are gated on `CHEATMODE` so the natural cascade runs silently and the apartment sprite doesn't refresh. Switching states requests a map refresh so the rat sprite swaps without leaving the room. **Quest States** holds the 15 known questline progression variables (Joel State, Nestor State 0/1/10/11, War Bomb State 0–6, Dan Quest 0–100, Audrey Advice Cans 0/1/2/3/4/8/99/999, Hellen Garden Quest, etc.) with tightened presets where the value range is gameplay-verified. The Hellen Garden Quest entry is a 13-state compound picker covering the full happy-path progression (Not Started → Accepted → Pre-Watering → Day 1/2/3 Wait → Fruit Ripens → Fruit Harvested → Complete) plus the failure outcomes (Aborted, Missed Watering, Hellen Hostile, Hellen Killed) — it drives `HellenQuestPhase` (var 869) and the four supporting switches (`HellenWateredPlant`, `MissedHellenWatering`, `HellenSpawned`, `ChasingHellenKilled`) atomically so toggling between any two states leaves the in-game flag combination consistent. **Video Games** lists every cartridge in Sam's apartment (Wake The Blood Knight, Wizard's Hell, Super Jumplad 1/3, Catafalque, Honko's Grand Journey, Madwheels 97, Wraithscourge, Massacre Princess, Kill To Shoot, Myrmidon I/XII, Screamatorium, Frogit About It, Blood Ghoul Orgy 3, Octocook, Space Truckerz, Reptile Football, Auntie Wilma's Crossword) with a per-cartridge "K Left" counter showing how many more plays remain before the skill is awarded (or "Earned" once it is), plus a top-of-list "Set all unfinished to..." action that lets you bulk-set every still-unlearned cartridge to either "1 Left" (next play awards the skill) or "Earned" (mark complete — pushes the counter past the trigger and grants the skill to actor 1 directly), with a Yes/No confirmation prompt before the writes go in. "Earned (skip)" on the per-cartridge picker uses the same direct skill-grant path so the equality-comparator games can be marked complete without leaving the variable in a state where the cabinet would never re-award the skill. Cooperates with Freeze Time and logs every change at WARN level so you can correlate in-game dialogue with the specific switch/variable.

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

