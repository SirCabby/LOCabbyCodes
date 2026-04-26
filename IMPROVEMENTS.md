# CabbyCodes — Improvements & Known Issues

A prioritised catalogue of bugs, performance concerns, and architectural opportunities found during a deep review of the codebase. Each entry names the file, describes the problem, and suggests a fix. Severity labels are qualitative (**critical / high / medium / low**).

Pair this with `ARCHITECTURE.md` (design reference) and `AGENTS.md` (coding conventions).

---

## A. Patching system bugs

### A0. `CabbyCodes.callOriginal` skipped chain links / recursed on 2+ overrides — **resolved**

*File:* `CabbyCodes/cabbycodes-patches.js`.

The previous implementation tried to "unwrap the debug wrapper" by walking `currentFunction._cabbycodesOriginal` while `_cabbycodesDebugWrapped` was set. But `debugWrap` copies `_cabbycodesOriginal` from the function it wraps, so on a debug wrapper that pointer already points at the *previous chain element*, not at the inner chainedFunction. The unwrap loop therefore hopped an entire chain layer each iteration and ended up calling the true original directly — middle overrides (e.g. `infinite-consumables` with `infinite-ammo` on top) were silently skipped. Naively removing the loop caused infinite recursion instead, because `target[fn]` is always the outermost wrapper, so a middle override's `callOriginal` would get back the same "previous" link no matter how deep the call.

**Fix (shipped):** every `chainedFunction` push/pops itself onto `CabbyCodes._overrideCallStack` while running. `callOriginal` reads the stack top to identify the currently-executing link and delegates to *that link's* `_cabbycodesOriginal`. Chain dispatch now works for any depth, and hand-rolled local `callOriginal` helpers that read `_cabbycodesOriginals[fn]` still reach the true original cleanly.

**Symptom this caused:** the door-visitor William event removed stimulants/meds despite "Infinite Items" being on, because infinite-ammo's override delegated straight to the rmmz original instead of through infinite-consumables. Any future "unwrap the debug wrapper" shortcut will bring the regression back.

### A1. `before` / `after` overwrite the stored "true original" — **high**

*File:* `CabbyCodes/cabbycodes-patches.js` (around lines 268–272 and 313–317).

Both `before` and `after` unconditionally execute:

```js
if (!target._cabbycodesOriginals) { target._cabbycodesOriginals = {}; }
target._cabbycodesOriginals[functionName] = original;
```

`original` is whatever `target[functionName]` currently is — which, if an `override` has already been applied, is the *override wrapper*, not the game's true original. Subsequent calls to `CabbyCodes.callTrueOriginal` will then invoke the override (or an earlier before/after wrapper) instead of the game function.

**Fix:** mirror `override`'s first-write policy.

```js
if (!target._cabbycodesOriginals[functionName]) {
    target._cabbycodesOriginals[functionName] = original;
}
```

…and keep the chain pointer (`wrappedFunction._cabbycodesOriginal = original`, `_cabbycodesIsOverride = true`) so `callOriginal` traverses before/after hooks correctly.

### A2. `before` / `after` wrappers are invisible to `callOriginal`'s chain walk — **medium**

*File:* `CabbyCodes/cabbycodes-patches.js`.

`callOriginal` traverses backwards by following `_cabbycodesIsOverride` / `_cabbycodesOriginal`. `before` and `after` wrappers never set those markers, so from `callOriginal`'s perspective a before/after hook does not exist. Combined with A1, this means any feature that uses `callOriginal` after a before/after hook can either skip the hook, re-run it, or infinitely recurse depending on surface shape.

**Fix:** apply the same chain markers to before/after wrappers; treat them as links like overrides.

### A3. Feature files hand-roll `callOriginal` by reading `_cabbycodesOriginals` — **medium**

*Files:* `cabbycodes-invincibility.js`, `cabbycodes-infinite-consumables.js`, `cabbycodes-infinite-money.js`, `cabbycodes-save-anywhere.js`, and more.

Each of these declares:

```js
function callOriginal(targetPrototype, fn, ctx, args) {
    const originals = targetPrototype._cabbycodesOriginals;
    if (originals && typeof originals[fn] === 'function') {
        return originals[fn].apply(ctx, args);
    }
}
```

That is fine while exactly one module patches the method, but it bypasses the chain walker and breaks when two features want to patch the same function. Invincibility + a hypothetical "revive on death" mod would silently disable each other.

**Fix:** replace every hand-rolled `callOriginal` with `CabbyCodes.callOriginal(target, fn, this, args)`. This is a sweeping but mechanical refactor.

### A4. `applySaveAnywherePatch` mixes styles — **low**

*File:* `CabbyCodes/cabbycodes-save-anywhere.js` (lines 38–82).

It uses `setTimeout(applySaveAnywherePatch, 0)` *and* sets a `_applied` flag to guard re-entry. It also reads `this._cabbycodesOriginals?.isSaveEnabled` directly. Once A3 is fixed, drop the local flag (override is idempotent via the duplicate-warning system) and drop the setTimeout — by the time this file is loaded, `Window_MenuCommand` is guaranteed to exist.

---

## B. Observability & logging

### B1. Synchronous file I/O on every log call — **high**

*File:* `CabbyCodes/cabbycodes-logger.js`.

`fs.appendFileSync` per call is fine for a handful of events but becomes a frame-time hazard when feature code logs inside hot paths. `time-advance-logger` and the verbose freeze-time code are plausible offenders.

**Fix options:**

1. Buffer lines and flush on `requestIdleCallback` / a 250–500 ms timer.
2. Switch to `fs.appendFile` (async) with a write-in-flight mutex.
3. Add a hard rate-limit: drop to `console.*` only if the queue exceeds N pending lines.

At minimum, downgrade any per-frame log line to `CabbyCodes.debug` (currently gated off by default) and audit current INFO lines for frame-rate usage.

### B2. Debug instrumentation captures stack traces on every patched call — **high**

*File:* `CabbyCodes/cabbycodes-debug.js` (lines 66–107).

`trackCallEntry` does `new Error().stack` on every entry into every patched function. `new Error().stack` in V8 is cheap-ish but not free (≈ a few hundred nanoseconds); wrapping `Game_Interpreter.update` means we collect a stack on every interpreter tick. The ring buffer caps memory usage (MAX_STACK_DEPTH = 50, 250 for interpreter), but CPU cost is constant per call.

**Fix:**
- Gate the whole `debugWrap` behind a runtime flag (`CabbyCodes.debugEnabled`). The module already defines it but always wraps.
- If always-on instrumentation is desired, skip the `Error` creation unless `callStacks[callId].length + 1 >= threshold / 2`. Collect stacks only when we're close to warning.
- Allow feature files to opt *out* of wrapping by passing a flag to `override / before / after`.

### B3. Recursion warnings only fire once per process — **low**

*File:* `CabbyCodes/cabbycodes-debug.js` (`recursionWarningsIssued`). Once `callId` is warned, we never warn again until stack length hits zero. Combined with `Game_Interpreter.update` getting a 250 threshold, the first warning is informative but there's no way to tell if the problem got worse later. Adding a periodic "still recursing" heartbeat (every 30 seconds, say) would help diagnose runaway interpreters.

### B4. `stackOverflowLogging` has a 0 ms reset — **low**

*File:* `CabbyCodes/cabbycodes-debug.js` (`STACK_OVERFLOW_RESET_DELAY_MS`). The rate-limit flag is cleared on the next microtask, which effectively gives no protection against repeated logs during a crash spiral.

**Fix:** set the delay to something meaningful (2000 ms) or key it off a persistent "already logged" flag.

### B5. Duplicate-patch warning only triggers the second time — **low**

*File:* `CabbyCodes/cabbycodes-patches.js`. The "NOTICE" branch exists but the first duplicate never prints the comparative list because it only calls `logPatch` after pushing. Cosmetic.

---

## C. Boot & loader issues

### C1. Loader's async-interval fallback is dead code — **low**

*File:* `CabbyCodes.js` (lines 83–99).

`PluginManager` is defined by `rpg_managers.js`, which loads before `plugins.js` in MZ. When `CabbyCodes.js` runs, `PluginManager` is guaranteed to exist. The 10 ms polling + 5 s timeout is defensive noise.

**Fix:** call `loadCabbyCodesScripts()` directly at module top, optionally with a one-line guard that no-ops if the global is missing.

### C2. Script loader order is fragile — **medium**

The 37-entry `scripts` array in `CabbyCodes.js` is the single source of truth for load order. It's easy to add a file to the folder and forget to register it (the loader won't find it). It's also easy to register two files in the wrong order and break dependencies.

**Fix options:**
- Enumerate files at runtime via `require('fs').readdirSync` (NW.js) and sort alphabetically with a manifest for the 6 "core-first" files.
- Or add a CI check (`node scripts/check-script-list.js`) that compares the array to the folder contents and fails if anything is missing/extra.

### C3. The loader adds `<script>` tags to `document.body`, not `<head>` — **low**

It works (`document.body` exists when MZ boots), but it's unusual. MZ itself appends to `document.body`, so parity is fine; just worth noting for anyone debugging DOM timing.

---

## D. Settings / options UI

### D1. `Window_Options` hooks assume no other plugin modifies `addGeneralOptions` — **low**

*File:* `CabbyCodes/cabbycodes-settings.js`.

The settings module calls the original `addGeneralOptions`, then appends every CabbyCodes setting. If another plugin *replaces* `addGeneralOptions` with a command-panel style menu (some QoL plugins do this), the CabbyCodes commands will be inserted into whatever structure that plugin left behind — sometimes with broken ordering. There is no fallback.

**Fix:** detect non-Window_Options command list structures before appending, or document the known-conflicting plugin styles.

### D2. `shouldDisplayCabbyCodesOptions` re-runs on every menu open — **low**

Minor: `$gameParty.members()` is cheap, but calling the user-overridable `CabbyCodes.canShowCabbyCodesOptions` wraps that in a try/catch. If a plugin monkey-patches it, we currently eat the error silently (`CabbyCodes.warn` once per menu open). Consider caching the last decision across the same scene.

### D3. `Window_CabbyCodesNumberInput` adds a global keydown listener — **medium**

*File:* `CabbyCodes/cabbycodes-settings.js` (lines 590–606).

The `window.addEventListener('keydown', ...)` runs before MZ's input handler (capture phase) and `preventDefault()`s digit / backspace / minus. If the player also has chat-style plugins or accessibility overlays that listen on capture, conflicts are possible. Also: `destroy` is called during scene teardown, but if `destroy` is never reached (e.g. due to an exception), the listener leaks across scene transitions.

**Fix:** hook `Scene_CabbyCodesNumberInput.prototype.terminate` as well, or wrap initialization in a try/finally that guarantees removal.

### D4. Number input silently coerces to 0 when `_textBuffer` is empty — **low**

If the user erases the last digit, `eraseDigit` leaves `'-'` or `'0'`; `updateValueFromBuffer` coerces to `0`. For settings with a nonzero `min`, `normalizeSettingValue` clamps up to `min`, but the displayed text briefly shows `0`. Minor UX nit.

---

## E. Performance

### E1. Feature files with 1k–4k lines are hard to review — **medium**

`cabbycodes-item-giver.js` (3685 lines), `cabbycodes-freeze-time.js` (1817), `cabbycodes-doorbell.js` (1548), `cabbycodes-cookbook.js` (1378), `cabbycodes-item-editor.js` (1096), `cabbycodes-recipe-book.js` (1007), `cabbycodes-oven-navigation.js` (999). Single-file feature modules with their own scene classes, window classes, caches, and helpers.

**Fix:** break the largest into sub-files (e.g. `cabbycodes-item-giver/index.js`, `.../window.js`, `.../scene.js`, `.../categories.js`) and register the top file in the loader. The IIFE pattern makes this straightforward — just move sections into separate IIFEs that share a sub-namespace (e.g. `CabbyCodes.itemGiver`).

### E2. Clock / HUD windows rebuild bitmaps frequently — **low**

*File:* `CabbyCodes/cabbycodes-clock-display.js`.

`refreshClock` calls `contents.clear()` + `drawText` on every update, then `adjustSizeForText` can call `createContents()` when the string changes. Current interval is every 12 frames; string rarely changes. Cache the last-used width/height and avoid `createContents()` when the time string length is stable.

### E3. `cabbycodes-infinite-consumables.js` iterates `$dataItems` once per session — **low**

OK but the "sawValidEntry" check can loop before the database is ready, re-triggering a full scan on the next `gainItem`. Switch to a `DataManager.isDatabaseLoaded`-style hook to build the cache exactly once.

### E4. `cabbycodes-enemy-health-bars.js` keeps per-enemy sprite state — **medium (audit)**

Battle sprites are hot-path territory. Without reading the whole file, the risk is a leaked `_cabbycodesEnemyGaugeManager` between battles. Verify that `terminate` on `Scene_Battle` cleans up all plate sprites and textures.

### E5. Freeze-time carries many Sets / Maps keyed by event lists — **medium (audit)**

`freezeTimeApi.zeroTimeCommonEventLists` is a `WeakMap<List, something>` and `zeroTimeMapEvents` is a `Map`. Long play sessions that visit many maps could accumulate entries. Consider periodic cleanup when the player leaves a map.

---

## F. Tooling & repo hygiene

### F1. ~~`CommonEvents.json` (20 MB) and `game_files/CommonEvents.json` (10 MB) are in git~~ — **resolved**

The root `CommonEvents.json` (a one-commit, never-updated 20 MB modder snapshot) was removed; pristine game data has always been gitignored at `game_files/` and is populated locally via `/refresh-game-files`. The 12 hand-added navigation labels worth keeping moved to `GAME_NOTES.md §5.1`. See `ARCHITECTURE.md §6.1` for the new policy: do not re-check-in derived game data.

Relatedly: `log.txt` in the repo root looks like a stray artifact; confirm it's intentional or add to `.gitignore`.

### F2. Scripts hardcode `C:/Program Files (x86)/...` — **medium**

*Files:* `scripts/dump-map-event.js`, `find-common-event-usage.js`, `find-common-time-writers.js`, `find-time-writers.js`, `list-map-events.js`, `read-common-events.js`.

Accept a path from env (`LOOK_OUTSIDE_PATH`) or `--root` arg so the scripts work on non-default Steam libraries, WSL, or macOS.

### F3. Makefile is Windows-only — **medium**

`SHELL := cmd`, inline PowerShell, and `taskkill` mean Linux / macOS contributors can't build or deploy. Consider a parallel `scripts/deploy.sh` or a small Node CLI (`scripts/deploy.js`) that replicates the Makefile targets cross-platform.

### F4. `make clean-log` deletes `CabbyCodes.log` unconditionally — **low**

Rename to `archive-log` and move the file to `CabbyCodes.<timestamp>.log` before discarding, or require a confirmation flag.

### F5. `make run` force-kills the game — **low**

`taskkill /f` with no grace period risks save corruption. At least try a non-force kill first and escalate after a timeout.

### F6. No automated tests, linting, or typechecking — **medium**

For a ~22k-LOC JS codebase, even a minimal `eslint` pass (no-unused-vars, no-undef against MZ globals) would catch a lot. Adding `package.json` with `eslint` + an MZ globals config is a couple hours of work and no runtime impact.

### F7. Version string duplicated in 3 places — **low**

`VERSION`, `cabbycodes-core.js` (`CabbyCodes.version`), and `README.md` all carry the version. `update-version.js` syncs them but any manual edit in any one place drifts silently. Consider generating the core constant at deploy time instead of checking it in.

---

## G. Security / correctness

### G1. `localStorage` settings are never versioned — **low**

If a future refactor changes a setting's shape (e.g. boolean → slider), stale saved values will be normalised — but anything that silently depends on the shape could misbehave. Add a `settingsSchemaVersion` key to `CabbyCodes.settings` and a one-time migration step in `loadSettings`.

### G2. JSON parse of saved settings is ungated — **low**

*File:* `CabbyCodes/cabbycodes-core.js`.

`JSON.parse(saved)` with a try/catch falls back to `{}` on error but does not validate that the parsed value is an object. A `'null'` or `'42'` would be assigned directly to `CabbyCodes.settings`, causing `hasOwnProperty` to throw later. Add `typeof parsed === 'object' && parsed !== null` guards.

### G3. The file logger writes to `rootDir / CabbyCodes.log` without size cap — **medium**

Long sessions with debug logging on can produce multi-MB logs. Add rotation: when `CabbyCodes.log` exceeds, say, 5 MB, rename it to `CabbyCodes.prev.log` and start fresh. The `fs.statSync` call adds negligible overhead when batched with the writes.

### G4. `window.onerror` is overwritten, not chained — **low**

*File:* `CabbyCodes/cabbycodes-debug.js` (line 278). We store the previous handler and call it after ours, which is correct. But if another plugin replaces `window.onerror` *after* CabbyCodes loads, our handler is lost. Use `window.addEventListener('error', ...)` instead, which composes.

---

## H. Documentation

### H1. No inline docs for "press-style" settings — **low**

The `onActivate` hook is used by cookbook, recipe-book, refill-status, max-cooking, etc., but isn't documented in `cabbycodes-settings.js` beyond the JSDoc on `registerSetting`. Add an example section.

### H2. Common Events reference is out of date — **medium**

The freeze-time module references dozens of common event IDs with inline comments. `GAME_NOTES.md §5` has a partial table of hot events; the rest could be auto-generated from `game_files/data/CommonEvents.json` via a new `scripts/dump-common-events-index.js` and merged into that section.

---

## Suggested ordering for the next few PRs

1. Fix A1 + A2 together (patch-chain correctness) — unlocks safe sharing of the hook points.
2. Sweep A3 (replace hand-rolled `callOriginal` calls) now that the chain is trustworthy.
3. Performance pass: B1 (async logging) + B2 (optional debug wrap) — measurable frame-time gains.
4. Repo hygiene: F6 (eslint). (F1 — large JSON out of git — is now resolved.)
5. Nice-to-have: F3 (cross-platform deploy), H2 (common-events index).

Each is isolated enough to ship on its own, and together they materially reduce the risk of adding new cheats without breaking existing ones.
