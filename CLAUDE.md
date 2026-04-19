# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

CabbyCodes is a cheats / QoL mod for *Look Outside* (RPG Maker MZ, NW.js host, Steam AppID `3373660`). It ships as a loader plugin (`CabbyCodes.js`) plus a folder of feature IIFEs (`CabbyCodes/cabbycodes-*.js`) that the loader injects into the running game. No game files are modified on disk.

**There is no build step for runtime JS**, no `package.json`, no tests, no linter. Files ship as-is.

## Read these before making non-trivial changes

- `ARCHITECTURE.md` — runtime model (boot sequence, patch chain, settings registry, session-state, logger, debug instrumentation).
- `AGENTS.md` — authoritative conventions for editing this repo (file layout, patching rules, settings/logging rules, perf guardrails, known traps).
- `IMPROVEMENTS.md` — catalogue of known bugs/opportunities. Cross-check before "fixing" something that looks broken.
- `GAME_NOTES.md` — discovered variable/switch IDs and game-side behavior. Treat as potentially stale after a game patch.

## Common commands (Windows-only, requires Steam install of the game)

All `make` targets assume `INSTALL_DIR = C:/Program Files (x86)/Steam/steamapps/common/Look Outside` and use `SHELL := cmd` with inline PowerShell. Do not expect them to run on macOS/Linux.

- `make deploy` — hash-verified copy of `CabbyCodes.js` + `CabbyCodes/` into the game's `js/plugins/`.
- `make run` — `deploy`, then `taskkill /f /im Game.exe`, delete `CabbyCodes.log`, launch via `steam://rungameid/3373660`. **Force-kills the game** — save first.
- `make package` — build `dist/LOCabbyCodes.v<ver>.zip` (loader + folder + README + LICENSE only).
- `make rev X.Y.Z` — bump `VERSION`, `CabbyCodes.version` in `cabbycodes-core.js`, and README in one shot. Always run before `make package`.
- `make clean-log` — delete `CabbyCodes.log` from the install dir (no backup).
- `/refresh-game-files` skill (or `node scripts/refresh-game-files.js`) — resync the local `game_files/` vanilla reference mirror when Steam patches the game.

## Architecture in one screen

**Boot order (set by the `scripts` array in `CabbyCodes.js` — adding a new feature file means adding it here):**

```
core → logger → debug → patches → session-state → settings → book-ui → feature modules
```

**Patching** goes through `CabbyCodes.override / before / after(target, fn, impl, settingKey?)` in `cabbycodes-patches.js`. Do not hand-replace prototype methods — that breaks the chain bookkeeping, the duplicate-patch warning, and the `cabbycodes-debug.js` instrumentation that catches stack overflows.

- To delegate from inside an override, use `CabbyCodes.callOriginal(Target.prototype, 'fn', this, args)` (walks past debug wrappers and prior overrides). Several feature files read `target._cabbycodesOriginals?.fn` directly — that only works when *exactly one* module patches the method.
- The `settingKey` 4th argument gates at **registration time**, not runtime. For toggle-able features, apply unconditionally and check `CabbyCodes.getSetting(key, default)` inside the wrapper (prevailing pattern).
- `before`/`after` currently overwrite `_cabbycodesOriginals[fn]` every call (see traps in AGENTS.md §13) — prefer `override` + `callOriginal`.

**Settings** go through `CabbyCodes.registerSetting(key, displayName, optsOrDefault, onChange?)` in `cabbycodes-settings.js`. Keys are `camelCase`; always pass an explicit `order` (buckets in AGENTS.md §4). Persisted to `localStorage` under `CabbyCodes_Settings`.

**Logging** goes through `CabbyCodes.log / warn / error / debug` — never raw `console.*`. INFO-level `log` only hits disk when `CabbyCodes.debugLoggingEnabled = true`; use `warn`/`error` for things that must persist. The file logger (`cabbycodes-logger.js`) appends to `CabbyCodes.log` in the game install root via NW.js `fs.appendFileSync`.

**Session gating.** Anything touching `$gameParty` / `$gameActors` / `$gameVariables` / `$gameSwitches` must tolerate firing before a save loads. Options visibility is handled by `canShowCabbyCodesOptions()`; runtime access should use `CabbyCodes.isGameSessionActive()`.

## Feature file skeleton

```js
(() => {
    'use strict';
    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] <feature> requires CabbyCodes core.');
        return;
    }
    const settingKey = 'someCamelCaseKey';
    CabbyCodes.registerSetting(settingKey, 'UI Label', {
        defaultValue: false,
        order: NN,
    });
    const isEnabled = () => CabbyCodes.getSetting(settingKey, false);

    CabbyCodes.override(Target.prototype, 'method', function (...args) {
        if (!isEnabled()) return CabbyCodes.callOriginal(Target.prototype, 'method', this, args);
        // cheat behavior
    });

    CabbyCodes.log('[CabbyCodes] <feature> module loaded');
})();
```

Then **add the filename to the `scripts` array in `CabbyCodes.js`** — the loader's hard-coded list is the source of truth for load order.

## Performance guardrails

- `cabbycodes-debug.js` wraps every patched function and records `new Error().stack` on entry. Treat every `override` as non-trivial overhead.
- Do not patch hot loops (`Game_Interpreter.prototype.update`, `Scene_Map.prototype.update`, `Window_Base.prototype.update`, sprite `update`) or frequently-called accessors (`Game_Variables.prototype.value`).
- HUD refresh intervals should be ≥ 6–12 frames.
- Never spam `CabbyCodes.log(...)` at frame rate — keep per-frame lines behind `debug()`.

## Freeze-time / variable rules

- Base-game variable/switch IDs live in `cabbycodes-freeze-time.js` and `cabbycodes-doorbell.js`. Add comments when you discover new ones.
- Never write directly to `$gameVariables._data` — always `setValue(id, value)` so freeze-time interceptors fire.
- New "freeze" features should register via `freezeTimeApi.registerVariableWriteInterceptor(handler)` instead of wrapping `Game_Variables.prototype.setValue` themselves.

## Reference data

- `CommonEvents.json` at the repo root is the *annotated/modded* reference; `game_files/CommonEvents.json` is pristine. `scripts/compare-common-events.py` diffs them.
- `game_files/` is gitignored and refreshed by `/refresh-game-files`. Do not edit it, do not commit it.
- `scripts/` holds one-off Node/Python tools that hard-code the Steam install path — update the path at the top of the script, not inline.

## Editing etiquette

- Do not introduce new runtime dependencies or a build step.
- Do not modify `game_files/` or the root `CommonEvents.json` without a clear reason documented in the commit.
- When patching a method another module already patches, use `CabbyCodes.callOriginal` (not `_cabbycodesOriginals?.fn`) to preserve the chain.
- Keep commits scoped to one feature file where possible. No tests exist — changes must be readable and defensive on their own.
- **Keep the README's "Current Features" list in sync.** Any change that adds, removes, or renames a player-facing setting registered via `CabbyCodes.registerSetting` must also update the matching bullet in `README.md`. If you change a feature's behavior enough that the existing blurb is misleading, rewrite the blurb in the same commit. Support-only modules (`book-ui`, `item-editor`, `oven-navigation`, `version-display`, `time-advance-logger`, core/patches/settings/logger/session-state/debug) do not get README entries.
