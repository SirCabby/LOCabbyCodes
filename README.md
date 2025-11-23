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
- **Always Escape Battles:** Guarantees that the Escape party command succeeds instantly, bypassing the normal escape ratio so you can bail out of encounters without relying on luck.
- **Stamina Control:** Prevents party actors from spending MP (stamina) when using skills, letting you cast freely without worrying about resource management.
- **Infinite Consumables:** Adds an option that keeps consumable item counts (healing items, ammo, thrown objects, cooking ingredients, etc.) from decreasing. You can still pick up more, but using them no longer consumes inventory.
- **Unbreakable Items:** Adds a toggle that stops weapons (and any other breakable gear) from losing durability when you attack or when enemies use weapon-breaking abilities. Keep your favorite equipment intact regardless of difficulty or special encounters.
- **Enemy Health Bars:** Displays sleek HP plates above every enemy (including bosses) whenever the new "Enemy Health Bars" option is enabled. The plates animate with delayed damage trails, show precise HP totals, and remain readable even when the battle screen tone changes.
- **Friendly Door Visitors:** Removes the pool of cursed/hostile door-knock visitors so answering the door never triggers those surprise fights. Disable the option again to restore the original encounter behavior.
- **Send Next Door Visitor:** Adds a one-press option that immediately schedules the next queued (or freshly rolled) knock visitor so you can trigger door events on demand.
- **Free Vending Machines:** Instantly bypass the coin slot mini-game so every vending machine interaction jumps right to the purchase menu with a price of zero.
- **Free Merchants:** Forces every shop menu entry to show a cost of zero, allowing you to buy gear, consumables, and upgrades without spending any gold while the toggle is enabled.
- **Money Editor Button:** Adds a pencil icon button to the gold display on the main menu. Click it to open the same inline editor UI used for inventory items (without the delete option) and instantly set the party's bankroll to any value up to the normal gold cap.
- **Freeze Time of Day:** Locks the in-game time variable so wandering, minigames, or scripted sequences no longer push the clock forward while enabled.
- **Video Games Cost No Time:** Lets you enjoy every console game in your apartment without advancing the in-game clock. The option automatically rewinds the time-of-day variable after each gaming session so the rest of the world remains in sync.
- **Freeze Hygiene / Needs:** Locks all of the hidden personal-need meters (hygiene, hunger, vigor, morale, social, calm, plus the bad-breath counter) so they can’t tick downward, while still allowing positive actions like eating or showering to raise them.
- **Hidden Needs HUD:** Adds a "Hidden Needs HUD" press option in the CabbyCodes settings. Select it to pop open a dedicated window with every hidden meter (hunger, fatigue, hygiene, morale, calm, social, and the breath-odor tracker), then press OK/Cancel to jump right back into the game.
- **Refill Status:** Adds a press-style option that immediately tops up every party member’s HP/MP and maxes out all hidden need meters (hunger, energy, hygiene, morale, calm, social, and breath odor) whenever you select it.
- **Max Cooking Skill:** Adds a press-style option that, after an explicit warning, permanently sets your Cooking skill to the game’s top rank (currently Level 8, Amateur Chef) so you can skip the recipe grind.
- **Oven Ingredient Checkboxes:** Overlays CabbyCodes-styled checkboxes onto the oven ingredient menus so you can instantly see which primary bases have every pairing finished and which secondary combinations you’ve already cooked (the "Nothing" option is always marked complete). Toggle it anytime from the CabbyCodes settings.

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

