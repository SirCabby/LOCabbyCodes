# CabbyCodes — Architecture Reference

This document describes the runtime architecture of the CabbyCodes mod for *Look Outside* (RPG Maker MZ). It is intended as a durable reference for future contributors and AI assistants working on the codebase. Pair it with `AGENTS.md` (conventions for code changes) and `IMPROVEMENTS.md` (known issues and opportunities).

## 1. What this project is

CabbyCodes is a cheats / quality-of-life mod that hooks into a shipping RPG Maker MZ commercial title (`Look Outside`, Steam AppID `3373660`). It runs entirely at the JavaScript layer inside the game's NW.js host. No game files are modified on disk. Everything ships as a single loader plugin plus a folder of feature files that get registered into the stock MZ `plugins.js` array.

The architecture is deliberately additive: players copy files in, add one entry to `plugins.js`, and the mod boots alongside the game. Uninstallation is equally mechanical — delete the folder, remove the plugins.js entry.

## 2. Top-level layout

```
repo-root/
├── VERSION                       # Canonical version string (e.g. "0.0.1")
├── CabbyCodes.js                 # Loader plugin — registered in plugins.js
├── CabbyCodes/                   # All runtime mod files
│   ├── cabbycodes-core.js        # Namespace, settings store, logger shims
│   ├── cabbycodes-logger.js      # Appends CabbyCodes.log via NW.js fs
│   ├── cabbycodes-debug.js       # Recursion / stack-overflow instrumentation
│   ├── cabbycodes-patches.js     # override / before / after helpers
│   ├── cabbycodes-session-state.js  # Tracks "is game actually running"
│   ├── cabbycodes-settings.js    # Options-menu integration, slider/number UI
│   ├── cabbycodes-book-ui.js     # Shared drawing helpers for "book" windows
│   └── cabbycodes-<feature>.js   # One file per gameplay toggle / action
├── CommonEvents.json             # Reference dump of the game's common events
├── game_files/                   # Vanilla reference copies for diffing
├── scripts/                      # Node / Python helpers for data digs
├── Makefile                      # Windows-centric build / deploy (cmd + PowerShell)
├── README.md                     # Player-facing install guide
└── log.txt                       # Stray dev-time log
```

## 3. Runtime boot sequence

1. RPG Maker MZ loads `js/plugins.js`. The player has added a `CabbyCodes` entry with `status: true`.
2. MZ's `PluginManager.loadScript` injects `<script src="js/plugins/CabbyCodes.js">`.
3. `CabbyCodes.js` (the loader) waits up to 5 seconds for `PluginManager` to exist, then iterates a hard-coded `scripts` array and appends a `<script async=false>` tag for each feature file in order.
4. Each feature file is an IIFE that:
   - confirms `window.CabbyCodes` exists,
   - declares a `settingKey`,
   - calls `CabbyCodes.registerSetting(key, label, opts, onChange)`,
   - applies patches via `CabbyCodes.override / before / after(target, fnName, impl, settingKey)`.
5. `cabbycodes-core.js` eagerly calls `CabbyCodes.loadSettings()`, so persisted settings are already in memory by the time feature files register defaults.
6. `cabbycodes-session-state.js` hooks `DataManager.setupNewGame`, `Scene_Load.prototype.onLoadSuccess`, and `Scene_Title.prototype.start` to flip an "is game session active" flag, which gates when CabbyCodes options are shown.

Script injection order matters: `core → logger → debug → patches → session-state → settings → book-ui → feature modules`. Anything that calls `CabbyCodes.override` before `cabbycodes-patches.js` runs would no-op, so the explicit `scripts` list in `CabbyCodes.js` is the source of truth for load ordering.

## 4. Core subsystems

### 4.1 Namespace & settings store (`cabbycodes-core.js`)

- Declares the global `window.CabbyCodes` object. Every feature file extends it.
- Settings persist to `localStorage` under the key `CabbyCodes_Settings`.
- Exposes `CabbyCodes.getSetting(key, default)`, `setSetting(key, value)`, `loadSettings()`, `saveSettings()`.
- Provides log-level-gated `log / warn / error / debug` shims. Default minimum level is WARN; `CabbyCodes.debugLoggingEnabled = true` drops it to DEBUG.

### 4.2 File logger (`cabbycodes-logger.js`)

- Detects NW.js (`window.require` + `window.process`), then uses `fs.appendFileSync` to write to `CabbyCodes.log` in the game install root.
- Wraps the `log / warn / error` shims so anything written to them also lands on disk, with stack traces for ERROR.
- Silently no-ops in non-NW.js contexts (e.g. if the game is ever run in a pure browser).

### 4.3 Patching system (`cabbycodes-patches.js`)

Three public entry points, all of which take a `(target, functionName, impl, settingKey?)` signature:

- `CabbyCodes.override(target, fn, newFn, settingKey?)` — full replacement.
- `CabbyCodes.before(target, fn, hook, settingKey?)` — runs hook, then original.
- `CabbyCodes.after(target, fn, hook, settingKey?)` — runs original, then hook.

Bookkeeping:
- `target._cabbycodesOriginals[functionName]` stores the *true* original (set only on first `override`).
- Each override wrapper is tagged `_cabbycodesIsOverride = true` and points at the previous function via `_cabbycodesOriginal` to form a chain.
- Each override's `chainedFunction` pushes itself onto `CabbyCodes._overrideCallStack` on entry and pops on exit. `CabbyCodes.callOriginal` reads the top of that stack to learn *which link is currently executing* and delegates to *that link's* `_cabbycodesOriginal`. Walking `target[fn]` instead would always yield the outermost wrapper and cause middle overrides to recurse into themselves.
- `CabbyCodes.callTrueOriginal(...)` skips the chain and calls the original game function directly.
- `CabbyCodes.callPrevious(...)` is a thin alias for `callOriginal`.

A patch-tracking array (`CabbyCodes._appliedPatches`) logs every applied patch and warns once when the same `Class.fn` is patched multiple times.

**Gotchas (see `IMPROVEMENTS.md` for fixes):**
- `before / after` unconditionally overwrite `_cabbycodesOriginals[fn]`, which can clobber the true original stored by a previous `override`.
- `before / after` wrappers do not set `_cabbycodesIsOverride` and do not push onto `_overrideCallStack`, so `callOriginal` does not treat them as links in the chain. Inside a `before`/`after` hook body the stack is whatever outer override (if any) is running, not the hook itself.
- Many feature files bypass `CabbyCodes.callOriginal` and read `target._cabbycodesOriginals?.fn` directly. That works as long as the target is always patched exactly once — `_cabbycodesOriginals[fn]` is the *true* original, not the previous link, so it silently skips intermediate overrides when multiple modules patch the same method.

### 4.4 Debug instrumentation (`cabbycodes-debug.js`)

- Every `override / before / after` passes the produced wrapper through `CabbyCodes.debugWrap`, which:
  - records `new Error().stack` into a per-function ring buffer (`callStacks`) on entry,
  - increments a total-call counter,
  - warns once when depth hits the recursion threshold (default 10, overridden to 250 for `Game_Interpreter.update`),
  - logs a richly annotated report on `RangeError: Maximum call stack` inside the wrapped call and on any top-level `window.onerror` / `unhandledrejection` that looks like a stack overflow.
- Marks wrappers with `_cabbycodesDebugWrapped = true` and copies `_cabbycodesIsOverride` / `_cabbycodesOriginal` from the inner function so the outer debug wrapper looks like a normal chain link to `getPreviousInChain`. **Important:** because of that copy, a debug wrapper's `_cabbycodesOriginal` points at the *previous chain element*, not at the inner chainedFunction it wraps. Do not "unwrap debug wrappers" by walking `_cabbycodesOriginal` — it will skip an entire chain layer. `callOriginal` relies on `_overrideCallStack` to pick the right link instead.
- Exposes `CabbyCodes.getCallStats()`, `logCallStats()`, `clearCallStats()`, `getAppliedPatches()`, `logAppliedPatches()` for live diagnostics.

This module has measurable overhead — see performance notes below.

### 4.5 Options-menu integration (`cabbycodes-settings.js`)

- Maintains `CabbyCodes.settingsRegistry`, an array of setting definitions. Each definition carries: `{ key, displayName, defaultValue, onChange, type, min, max, step, maxDigits, formatValue, inputTitle, inputDescription, order, control, wrap, onActivate }`.
- Hooks into `Window_Options`:
  - `addGeneralOptions` — appends every registered setting as a command (prefixed `cabbycodes_`), but only after `shouldDisplayCabbyCodesOptions()` returns true (i.e. a save/new-game is loaded).
  - `getConfigValue / setConfigValue` — reads/writes our storage rather than the stock options store.
  - `statusText` — delegates to `formatValue(value)` for custom display, else renders boolean/numeric.
  - `processOk` — dispatches to `onActivate` (for "press-style" commands), or opens the CabbyCodes number-input scene for numeric/slider controls.
  - `cursorLeft / cursorRight` — adjusts sliders in place.
  - `drawItemBackground` — paints a subtle blue gradient so CabbyCodes entries are visually distinct.
- Defines `Scene_CabbyCodesNumberInput` + `Window_CabbyCodesNumberInput` for numeric entry with physical keyboard support (`keydown` listener added to `window`, removed in `destroy`).

### 4.6 Session state (`cabbycodes-session-state.js`)

- Tracks `CabbyCodes._gameSessionActive`.
- Exports `canShowCabbyCodesOptions()` used by the settings-options hook to hide CabbyCodes entries on the title screen. This prevents "press"-style actions from firing before `$gameParty` / `$gameVariables` exist.

### 4.7 Book UI helpers (`cabbycodes-book-ui.js`)

- Shared constants and drawing helpers for list/checkbox windows (cookbook, recipe book, oven checkbox overlays). Not all feature files use it; recipe-book, cookbook, and oven-checkboxes do.

## 5. Feature modules — common pattern

Every feature file follows the same skeleton:

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
        order: NN,                          // controls placement in the Options menu
        // optional: type: 'slider' | 'number', formatValue, min, max, step, onActivate, etc.
    }, newValue => { /* optional onChange */ });

    const isEnabled = () => CabbyCodes.getSetting(settingKey, false);

    CabbyCodes.override(TargetClass.prototype, 'methodName', function (...args) {
        if (!isEnabled()) {
            return CabbyCodes.callOriginal(TargetClass.prototype, 'methodName', this, args);
        }
        // cheat behavior
    });

    CabbyCodes.log('[CabbyCodes] <feature> module loaded');
})();
```

Feature categories currently shipped:

- **Combat / stats**: `invincibility`, `status-immunity`, `stamina`, `exp-rate`, `always-escape`, `enemy-health-bars`.
- **Inventory / economy**: `infinite-ammo`, `infinite-consumables`, `infinite-money`, `unbreakable-items`, `free-vending`, `free-merchants`, `money-editor`, `item-editor`, `item-giver`.
- **Time / needs**: `freeze-time`, `freeze-hygiene`, `time-advance-logger`, `refill-status`.
- **Visitors / doors**: `doorbell`, `friendly-door-visitors`.
- **Cooking**: `cookbook`, `recipe-book`, `max-cooking`, `oven-checkboxes`, `oven-navigation`.
- **Saves**: `save-anywhere`, `delete-save`.
- **HUD / diagnostics**: `clock-display`, `hidden-stats-display`, `version-display`, `debug`.

## 6. Data / tooling

### 6.1 `CommonEvents.json` & `game_files/`

- `CommonEvents.json` at the repo root is the modded / annotated version used for reference while developing time-freeze rules.
- `game_files/CommonEvents.json` is a pristine copy. `scripts/compare-common-events.py` diffs the two to show which events diverge.
- Both files are ~10–20 MB apiece. Keeping them in git has real repo-size cost (see `IMPROVEMENTS.md`).

### 6.2 Node / Python helper scripts (`scripts/`)

All one-off CLI tools that dig through the game's `data/` folder. They all read from the hard-coded absolute path `C:/Program Files (x86)/Steam/steamapps/common/Look Outside/data/...`. Portable alternatives would need a flag or env var.

- `compare-common-events.py` — BOM-aware JSON diff of common events.
- `dump-map-event.js` — dumps a specific page of a specific map event.
- `find-common-event-usage.js` — finds `code:117` references to a common-event id on a map.
- `find-common-time-writers.js` — finds `code:122` (Control Variables) writers to time variables within common events.
- `find-time-writers.js` — same, scoped to a specific map file.
- `find_endcraft_index.js` — locates the `endCraft` label inside common events.
- `list-map-events.js` — dumps (id, name) for every event on a map.
- `read-common-events.js` — prints the names of common events by id.
- `update-version.js` — keeps `cabbycodes-core.js` (`CabbyCodes.version = '...'`) and the README in sync with the `VERSION` file; invoked by `make rev`.

### 6.3 Makefile (Windows-only)

Targets (all assume `INSTALL_DIR = C:/Program Files (x86)/Steam/steamapps/common/Look Outside`):

- `make deploy` — hash-verified copy of `CabbyCodes.js` + `CabbyCodes/` into `$(PLUGIN_DIR)`.
- `make package` — stages loader + folder + README + LICENSE into `dist/stage/`, zips as `dist/LOCabbyCodes.v<ver>.zip`.
- `make rev X.Y.Z` — writes the new version to `VERSION`, core constant, and README.
- `make run` — `deploy`, `taskkill /f /im Game.exe`, delete `CabbyCodes.log`, launch Steam URL.
- `make clean-dist`, `make clean-log` — housekeeping.

The `SHELL := cmd` + inline PowerShell approach makes the Makefile Windows-only. Any CI or non-Windows contributor would need a parallel path.

## 7. Cross-cutting design principles

- **Additive patching only.** No game file is modified. Every behavior is reached via a `CabbyCodes.override / before / after` on a prototype.
- **Setting-gated.** The fourth argument to patch helpers lets the patch itself be skipped when disabled, but most features prefer a runtime check inside the wrapper (so toggling at runtime works without re-patching).
- **Defensive against boot order.** Every feature file checks for `window.CabbyCodes` before doing anything. Several check for optional globals (`$gameParty`, `SceneManager`, etc.) before using them.
- **Chatty logging.** Every feature logs `"[CabbyCodes] <feature> module loaded"` during boot and logs enable/disable transitions. The file logger means these persist to `CabbyCodes.log`.
- **No build step for runtime code.** Feature files are plain ES2019 IIFEs that run in MZ's NW.js runtime as-is.

## 8. Extension points

When adding a new cheat, prefer:

1. A new `cabbycodes-<feature>.js` file.
2. A single `settingKey` registered via `registerSetting`.
3. `CabbyCodes.override(...)` (or `before/after`) against the narrowest game prototype that still achieves the cheat.
4. An entry added to the `scripts` array in `CabbyCodes.js`.

When you need a whole new UI scene, follow the `Scene_CabbyCodesNumberInput` / `Scene_CabbyCodesExpRateSelect` patterns — subclass `Scene_MenuBase` or `Scene_ItemBase`, expose a `Scene_Cabby...` class on `window`, and push via `SceneManager`.

## 9. See also

- `AGENTS.md` — conventions AI assistants and contributors should follow when editing this repo.
- `IMPROVEMENTS.md` — catalogue of known bugs, performance concerns, and architectural opportunities with suggested fixes.
- `README.md` — player-facing install guide.
