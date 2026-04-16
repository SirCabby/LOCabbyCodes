---
name: refresh-game-files
description: Detect whether the Look Outside game install has been patched and refresh the local game_files/ reference mirror when it has. Use when the user asks to refresh game files, check for a game patch, resync the vanilla reference copy, or says the game has been updated.
user-invocable: true
allowed-tools:
  - Read
  - Bash(node scripts/refresh-game-files.js*)
  - Bash(ls *)
  - Bash(cat *)
---

# /refresh-game-files — Resync the vanilla game reference mirror

`game_files/` is a local-only (gitignored) mirror of the relevant vanilla files
from the player's *Look Outside* Steam install. It exists so we can diff
against the shipping game while developing the CabbyCodes mod. It must **not**
be checked in — the binary/data volume is large and licensing is unclear.

Steam sometimes patches the game. When that happens our mirror is stale and
our diffs lie. This skill detects the drift and rebuilds the mirror from
scratch.

## What "patched" means here

The detector uses two independent signals — if either changes, we refresh:

1. **Steam `buildid`** read from
   `C:/Program Files (x86)/Steam/steamapps/appmanifest_3373660.acf`. This is
   the authoritative Steam-side version.
2. **SHA-256 fingerprints** of a handful of key files
   (`package.json`, `js/plugins.js`, `js/rmmz_objects.js`,
   `js/rmmz_managers.js`, `data/System.json`, `data/CommonEvents.json`).
   This catches hand-edits the user may have made locally.

Both signals are recorded in `game_files/.manifest.json` at every refresh.

## Steps

1. **Status check** — run the checker and report what it found:

   ```
   node scripts/refresh-game-files.js --check
   ```

   Exit code `0` → cache current, stop here.
   Exit code `2` → patch (or missing cache) detected, continue.

2. **Refresh** — run without `--check` to delete `game_files/` and recopy
   `js/`, `data/`, and `package.json` from the install:

   ```
   node scripts/refresh-game-files.js
   ```

   Add `--force` only if the user explicitly asks to rebuild even when the
   cache looks current.

3. **After refresh**, relay:
   - The new Steam buildid
   - Which fingerprinted files changed (the script prints this)
   - That `GAME_NOTES.md` should be re-skimmed for any stale references —
     variable IDs / switch IDs / plugin commands in that document can shift
     between patches.

## Guardrails

- The skill only touches `game_files/` and reads from the Steam install —
  it must never write into `C:/Program Files (x86)/Steam/.../Look Outside`.
- `game_files/` is in `.gitignore` (line 1). Don't untrack it.
- If the Steam install path has moved, update `GAME_INSTALL` at the top of
  `scripts/refresh-game-files.js` rather than hardcoding a new path in the
  skill.
- Large copy (~160 MB). Don't run in a loop.
