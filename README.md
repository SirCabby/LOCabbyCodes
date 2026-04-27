# CabbyCodes

A cheats / quality-of-life mod for *Look Outside*, the RPG Maker MZ horror RPG. CabbyCodes adds a **Cheats** entry to the in-game menu with toggles and pickers for invincibility, infinite items, time control, story-flag editing, and dozens of other tweaks. It installs as a standard plugin — no game files are permanently modified, and uninstalling is just removing two files and one entry.

**Current version:** `1.0.0`

---

## Installation

CabbyCodes ships as one loader file (`CabbyCodes.js`) plus a folder of feature modules (`CabbyCodes/`). You drop both into the game's `js/plugins/` folder and add a single entry to `plugins.js`.

### 1. Find your game install folder

You need the folder that contains `Game.exe`. From here on this guide refers to it as `<game>`.

- **Steam (default location):** `C:\Program Files (x86)\Steam\steamapps\common\Look Outside\`
- **Steam (custom library / different drive):** open Steam → right-click *Look Outside* → *Manage* → *Browse local files*. The folder Steam opens is `<game>`.
- **Other distributions or manual installs:** wherever you placed the game folder. It will contain `Game.exe`, a `js/` subfolder, a `www/` or `data/` subfolder, etc.

### 2. Get the mod files

- Download the latest `LOCabbyCodes.v<version>.zip` from the releases page and unzip it

You should end up with a `CabbyCodes.js` file and a `CabbyCodes/` folder side by side.

### 3. Copy the mod into the plugins folder

Copy both `CabbyCodes.js` and the entire `CabbyCodes/` folder into `<game>/js/plugins/`. The result should look like:

```
<game>/
└── js/
    └── plugins/
        ├── CabbyCodes.js              ← loader (you added this)
        ├── CabbyCodes/                ← feature modules (you added this)
        │   ├── cabbycodes-core.js
        │   ├── cabbycodes-patches.js
        │   ├── cabbycodes-settings.js
        │   └── ...                    (many more cabbycodes-*.js files)
        ├── plugins.js                 ← you'll edit this next
        └── (existing plugin files)
```

### 4. Register the plugin in `plugins.js`

`<game>/js/plugins.js` tells the game which plugins to load. CabbyCodes needs one entry added to the list.

1. **Make a backup of `plugins.js` first** — right-click → *Copy*, then *Paste* in the same folder. If anything goes wrong you can restore it instantly.
2. Open `plugins.js` in a text editor.
3. Find the closing `];` at the end of the `var $plugins = [ ... ]` array. Add a comma after the last existing entry, then add this new entry just before the `];`:

   ```javascript
   {
       "name": "CabbyCodes",
       "status": true,
       "description": "CabbyCodes Mod Loader",
       "parameters": {}
   }
   ```

4. Save the file.

The end of the array should now look something like:

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

JSON syntax matters here — make sure there's a comma between every entry except the last one, no trailing comma after the CabbyCodes entry, and that every `{` has a matching `}`.

### 5. Verify it loaded

Launch the game. The mod loads automatically. To confirm it worked:

- Open loaded into a new or saved game, open the menu — there should be a new **Cheats** entry alongside Item, Skill, Options, etc.
- Open `<game>/CabbyCodes.log` in a text editor — recent `[CabbyCodes]` lines confirm the loader ran and that toggle changes are being recorded.

That's it. Open the Cheats menu in-game any time to enable, disable, or tweak features.

---

## Uninstalling

1. Delete `CabbyCodes.js` from `<game>/js/plugins/`.
2. Delete the `CabbyCodes/` folder from `<game>/js/plugins/`.
3. Open `<game>/js/plugins.js` and remove the `CabbyCodes` entry from the `$plugins` array (or restore the backup you made during install).

`<game>/CabbyCodes.log` is harmless if left behind, but you can delete it too.

---

## Troubleshooting

### The Cheats menu doesn't appear

- **Verify file locations.** `CabbyCodes.js` should be in `<game>/js/plugins/`, with the `CabbyCodes/` folder beside it. The folder must contain `cabbycodes-core.js` (plus the rest of the `cabbycodes-*.js` files).
- **Verify `plugins.js`.** Open it and search for "CabbyCodes". The entry must have `"status": true` (not `false`), and the surrounding JSON must be valid — commas between entries, no trailing comma after the last entry, balanced brackets.
- **Check the log.** Open `<game>/CabbyCodes.log`. Recent `[CabbyCodes]` lines confirm the loader ran. Warnings or errors there usually point straight at the problem.

### The game won't start after installing

This is almost always a `plugins.js` syntax error.

- **Restore your backup.** If you have one, swap it back in.
- **Use the platform's repair tool.** On Steam: right-click *Look Outside* → *Properties* → *Installed Files* → *Verify integrity of game files*. Other distributions usually offer a similar option.
- **Validate the JSON.** Paste the contents of `var $plugins = [ ... ];` (just the array) into an online JSON validator. Common offenders: missing commas between entries, trailing commas, unbalanced brackets, missing quotes around keys.

### Settings don't persist between launches

Settings are saved in the game's `localStorage` under the key `CabbyCodes_Settings`. If your game install lives on a network drive or a folder with restrictive write permissions, NW.js may silently fail to write to it. Move the install to a normal local-disk location.

### Sharing diagnostics

When reporting an issue, include `<game>/CabbyCodes.log`. Each line is timestamped and most modules log a load message at startup, so the file usually shows what was active at the time of the problem.

---

## Current Features

- **Invincibility Toggle:** When enabled, any actor currently in the player's party is prevented from losing HP through combat damage, poison/regen ticks, scripted damage, or other harmful effects. Carve-out for the Visitor final battle: once the party has been swapped to the Massacre Princess Catholicon cast, only Rush (and the original protagonist if he ends up in that party) keep invincibility, so the supporting MP cast still take damage normally.
- **One Hit Kill Enemies:** Amplifies any HP damage dealt to an enemy into a lethal blow, so a single hit drops even bosses.
- **Never Miss Attacks:** Forces every party attack to connect: the hit roll is treated as 100% and the target's evasion is treated as 0 while the option is on.
- **Status Immunity:** Blocks negative status effects from being applied to the party.
- **Always Escape Battles:** Guarantees that the Escape party command succeeds.
- **Stamina Control:** Prevents party from spending MP (stamina) when using skills, letting you cast freely without worrying about resource management.
- **EXP Rate Slider:** Scales all party EXP gains from 0x (no EXP) up through 10x, plus an "Instant Max" that gives enough EXP on the next event to hit the level cap immediately.
- **Infinite Items:** Keeps item counts from decreasing. Whether you use them, craft with them, or hand them to a visitor, the inventory count stays put. You can still pick up more; weapons, armor, key items, and a curated set of quest-triggered pseudo-key items (Rat Baby Thing, Dog Tags, Plumbing Tools, colored keys, etc.) are unaffected so scripted events can still progress. Planet / puzzle discs are an explicit exception — they stay in your inventory even after being inserted into a socket.
- **Unbreakable Items:** Stops weapons (and any other breakable gear) from losing durability when you attack or when enemies use weapon-breaking abilities.
- **Unstick Equipment:** Lets you unequip "stuck" gear directly from the standard Equip menu. While on, every equipment slot becomes selectable even when the slot would normally be class-locked or state-sealed; picking the blank "(no item)" entry sends the removed gear back to the party's inventory through the vanilla equip-change path.
- **Infinite Ammo:** Keeps every ranged weapon fully loaded and blocks all ammo item costs (magazines, marbles, gas cans, batteries, etc.) so you never have to reload or spend ammunition while the toggle is active.
- **Enemy Health Bars:** Displays sleek HP plates above every enemy. The plates animate with delayed damage trails, show precise HP totals, and remain readable even when the battle screen tone changes.
- **Friendly Door Visitors:** Removes the pool of cursed/hostile door-knock visitors so answering the door never triggers those surprise fights.
- **Send Next Door Visitor:** Choose from the possible visitors pool and send them immediately knocking at the door.
- **Free Merchants:** Forces every shop menu entry to show a cost of zero, including vending machines.
- **Floor 4 Always Available:** Keeps the apartment elevator's hidden Floor 4 choice permanently available.
- **Money Editor Button:** Adds a pencil icon button to the gold display on the main menu to edit current gold.
- **Infinite Money:** Blocks any reduction to the party's gold total. You still earn money normally from events, loot, and shop sales, but spending never lowers the balance while enabled.
- **Give Item:** You can browse every item, weapon, and armor in the game and grant any quantity directly to the party.
- **Give Missing Items:** Gives all missing items except key items to the player's inventory.  Can also give by item type.
- **Max Items in Inventory:** Tops every stack in your inventory up to the game's per-item limit.
- **Save Anywhere:** Bypasses difficulty-based save restrictions, letting you save from the main menu in situations where the game would normally forbid it.
- **Delete Save Buttons:** Adds an X button to every row of the Load and Save screens. Clicking it prompts for confirmation and then deletes the selected save file without needing to start a new game.
- **Freeze Time of Day:** Locks the in-world clock at its current value. Time-burning actions (cooking, opening the door, playing a videogame, etc.) still execute fully and any queued events run to completion, but the actual game time — not just the displayed clock — stays put, so hour/day side effects like stamina drain, day-segment shifts, and daily resets do not happen while the toggle is on.
- **Set Game Time:** Opens a picker for hour, minute (15-minute increments, matching the in-game clock), and absolute day. Forward jumps run the game's TimePasses event, so HourPassed (stat decay, quest timers, door spawns) and newDay (daily resets, shop refreshes, plant health) fire the same way they do after a crossword or other time-burning activity; multi-day jumps add an extra newDay for each 4 AM crossing. This works even when Freeze Time is on — Set Time opens a scoped advance-mode token that lets the cascade through for this one call, then re-freezes at the new moment. Normal time-burning activities (crossword, cooking, etc.) stay suppressed under freeze. Backward jumps fall back to a direct write with no cascade.
- **Set Danger Level:** Opens a picker for the time-based encounter danger bonus with five tiers (None 0, Low 60, Medium 160, High 300, Critical 500. Only available when the player is outside the apartment, since returning home zeroes the value.
- **Set Difficulty:** Adds a press option that opens a picker for the active difficulty (Easy / Normal / Hard). Writes the chosen mode to the game's three mutually-exclusive difficulty switches (EASYMODE / NORMALMODE / HARDMODE), so existing logic that branches on them — escape ratios, weapon-break chance, save restrictions, etc.
- **Freeze Hygiene / Needs:** Locks all of the hidden personal-need meters against worsening — hygiene, hunger, vigor, morale, social, and calm can't tick downward, and the bad-breath counter (where higher is worse, and the nightly Sleeping event adds +1) can't tick upward. Positive actions like eating, showering, or brushing teeth still move the meters in the good direction.
- **Hidden Needs HUD:** Select it to pop open a dedicated window with every hidden meter (hunger, fatigue, hygiene, morale, calm, social, and the breath-odor tracker).
- **Show Clock HUD:** Draws a compact clock panel in the top-right corner while you are on the map, showing the live in-game time so you can keep tabs on the schedule without opening menus.
- **Refill Status:** Tops up every party member’s HP/MP and maxes out all hidden need meters (hunger, energy, hygiene, morale, calm, social, and breath odor) whenever you select it.
- **Max Cooking Skill:** Permanently sets your Cooking skill to the game’s top rank (currently Level 8, Amateur Chef).
- **Oven Ingredient Checkboxes:** Overlays checkboxes onto the oven ingredient menus so you can instantly see which primary bases have every pairing finished and which secondary combinations you’ve already cooked.
- **Craft Ingredient Checkboxes:** Overlays checkboxes onto the crafting station’s ingredient menus so you can see at a glance which first ingredients still have undiscovered recipes and which (first + second) pairings you’ve already made. Ingredients or pairings that aren’t part of any recipe display a red dash instead of a checkbox.
- **Cook Book:** Opens a dedicated Cook Book scene listing every oven combination in the game, with completion state pulled straight from your save so you can see at a glance what you still need to cook.
- **Recipe Book:** Opens a dedicated Recipe Book scene listing every recipe the game tracks, marked off as you discover them so you can plan what to make next without digging through in-game menus.
- **Change Character Name:** Allows changing of the main character's name (default Sam). The hint window above the editor lists the three base-game names that branch behavior: `Ash` (also `Williams` / `evildead`) allows player to equip the Shotgun even after losing an arm, `Casanova` enables the April Fools Day smooch/kiss flag that 94 npc encounters across the cast (Sybil, Shadow, Pierre, Vincent, Grinning Beast, etc.) gate their kiss dialog branches on, and `lumpy` makes Sybil's intro hand the player a Straitjacket. `lumpy` is intro-only — the rename takes effect cosmetically but the Straitjacket only drops if the rename is in place on a new game before the Sybil intro fires.
- **Fast Credits Scroll:** Drops a contextual `Fast Credits: ON/OFF` toggle into the top-right of the screen, just under the CabbyCodes clock, whenever the player is on the end-credits scene. Click it to multiply the credits scroll speed by 20x so you can blow through and reach the post-credits portion quickly; click again to drop back to normal speed.
- **Story Flags:** Opens an editor for story-decision flags. Sections include Player flags, Recruits to toggle party member availability, Quest States, Friendly NPCs and Bosses allow changing alive states, Video Games allows for owning and completing video games without playing them, and Locked Doors

---

## Development

This section is for people working on the mod itself

### Repo layout

- `CabbyCodes.js` — loader plugin. The `scripts` array at the top is the **authoritative load order** for the feature modules; new feature files must be added there.
- `CabbyCodes/` — feature module IIFEs (`cabbycodes-*.js`). One file per cheat or supporting subsystem.
- `Makefile` — Windows-only automation (deploy / package / version bump / launch). Defaults assume a Steam install at `C:\Program Files (x86)\Steam\steamapps\common\Look Outside\`. Override `INSTALL_DIR` if your install lives elsewhere.
- `scripts/` — one-off Node and Python helpers (game-file refresh, version bump, common-events diff). Each script hard-codes the install path at the top — update it there, not inline.
- `game_files/` — gitignored vanilla mirror of the game's data files; refreshed by the `/refresh-game-files` skill or `node scripts/refresh-game-files.js`. Do not edit or commit contents placed inside this folder.

There is no build step for runtime JS, no `package.json`, no test suite, and no linter. Files ship as-is.

### Make targets (Windows)

All targets assume `INSTALL_DIR` points at the game's install folder. Override per-invocation if needed (e.g. `make INSTALL_DIR="D:\Games\Look Outside" deploy`).

| Target | What it does |
| --- | --- |
| `make deploy` | Hash-verified copy of `CabbyCodes.js` + `CabbyCodes/` into `<install>/js/plugins/`. Existing files are removed and re-verified before the new ones land. |
| `make package` | Build `dist/LOCabbyCodes.v<version>.zip` containing only the loader, the `CabbyCodes/` folder, the README, and the LICENSE. |
| `make rev X.Y.Z` | Bump the version everywhere: `VERSION`, `CabbyCodes.version` in `cabbycodes-core.js`, and the `Current version` line in this README. Run before packaging a release. |
| `make run` | Deploy, kill any running `Game.exe`, delete `CabbyCodes.log`, then launch via `steam://rungameid/3373660`. **Force-kills the game — save first.** |
| `make clean-log` | Delete `CabbyCodes.log` from the install dir. |

### Documentation for contributors

- `CLAUDE.md` — project guidance for Claude Code agents, including the rule that the **Current Features** list above stays in sync with registered settings.
- `ARCHITECTURE.md` — runtime model: boot sequence, patch chain, settings registry, session-state, logger, debug instrumentation.
- `AGENTS.md` — authoritative coding conventions (file layout, patching rules, settings/logging rules, perf guardrails, known traps).
- `IMPROVEMENTS.md` — known bugs and opportunities; cross-check before "fixing" something that looks broken.
- `GAME_NOTES.md` — discovered variable / switch IDs and game-side behavior. Treat as potentially stale after a game patch.

### Technical notes

- The mod uses the standard RPG Maker MZ plugin system on the NW.js host.
- Settings persist to `localStorage` under the key `CabbyCodes_Settings`.
- The loader plugin dynamically injects each `cabbycodes-*.js` script in the order listed in `CabbyCodes.js`'s `scripts` array.
- All mod functionality is contained within `CabbyCodes.js` and the `CabbyCodes/` folder — no game files are permanently modified.
- Diagnostic output is appended to `CabbyCodes.log` in the game's installation directory via NW.js `fs.appendFileSync`. INFO-level messages only persist when `CabbyCodes.debugLoggingEnabled = true`; WARN/ERROR always persist.
