# CabbyCodes — AGENTS.md

Guidelines for AI coding assistants (and human contributors) working in this repo. Read `ARCHITECTURE.md` first for the runtime model, then use this file as a checklist when making changes.

## 1. Environment facts you must know

- **Game:** *Look Outside* (RPG Maker MZ, NW.js host, Steam AppID `3373660`).
- **Install path (hardcoded in Makefile + scripts):** `C:/Program Files (x86)/Steam/steamapps/common/Look Outside`.
- **MZ plugin format:** All runtime files are standard MZ plugins (`/*: @target MZ ... */` header + IIFE).
- **Loader:** `CabbyCodes.js` (the one registered in `plugins.js`) dynamically injects every file in `CabbyCodes/` into `document.body`, preserving order via `async = false`.
- **Persistence:** Settings are in `localStorage` under `CabbyCodes_Settings`. A file log is appended to `CabbyCodes.log` in the game install root when running under NW.js.
- **No build step** for runtime JS. Files are shipped as-is. The only tooling is `node scripts/update-version.js` and PowerShell-driven `make` targets.

## 2. File conventions

- Feature files live in `CabbyCodes/cabbycodes-<kebab-name>.js`.
- Each feature file must be a single IIFE (`(() => { 'use strict'; ... })();`) with the MZ plugin docblock at the top.
- Start every feature file with a guard: `if (typeof window.CabbyCodes === 'undefined') { ... return; }`.
- End with `CabbyCodes.log('[CabbyCodes] <feature> module loaded');` so the load log stays uniform.
- **When you add a new file, you must also add it to the `scripts` array inside `CabbyCodes.js`.** Load order matters — list it after any module whose globals it depends on (typically `core`, `logger`, `debug`, `patches`, `session-state`, `settings` are sufficient).

## 3. Patching rules

- Use `CabbyCodes.override / before / after` from `cabbycodes-patches.js`. Do not manually replace prototype methods; you will break the patch-chain bookkeeping, the duplicate-patch warning, and the debug instrumentation.
- When your override needs to delegate, prefer `CabbyCodes.callOriginal(Target.prototype, 'fnName', this, args)` over reading `_cabbycodesOriginals` directly. The helper uses a per-call stack of the currently-executing chainedFunction to pick the correct previous link — chains of 2+ overrides on the same method now chain all the way through, where reading `_cabbycodesOriginals[fn]` would silently skip every intermediate override (it only stores the true original).
- If you pass a `settingKey` as the 4th argument, the patch is only applied when the setting is truthy **at registration time**. Toggling it at runtime will not add/remove the patch. For toggle-able features, apply the patch unconditionally and check `CabbyCodes.getSetting(key, default)` inside the wrapper (this is the prevailing pattern in the codebase).
- Patching the same function from multiple feature files is allowed but logs a one-shot duplicate-patch warning. Make sure every override calls through to the previous link (`callOriginal`) unless you genuinely want to short-circuit.

## 4. Settings rules

- Every user-visible toggle must go through `CabbyCodes.registerSetting(key, displayName, defaultOrOpts, onChange?)`.
- Keys are `camelCase`. Display names are Title Case.
- Give each setting an explicit `order` so the options menu stays deterministic. Rough buckets in use today:
  - `< 40` — combat / movement (invincibility, etc.)
  - `40–60` — saving / session (saveAnywhere, expRate)
  - `60–80` — QoL / inventory (infinite items, money, clock)
  - `80–100` — escape / always-succeed style toggles
  - `≥ 100` — misc / admin
- For numeric or slider controls: set `type: 'slider' | 'number'`, supply `min`, `max`, `step`, and a `formatValue(value)` function so `statusText` renders something meaningful.
- For "press to do a thing" actions: supply `onActivate: ({ key, definition, window }) => true` — return `true` to stop the default behavior, return `false` to fall through.
- `onChange(newValue, oldValue)` is great for log lines and for re-rendering active HUDs (see `enemy-health-bars` or `clock-display`).
- Never hide a setting's "default" behind an `if (CabbyCodes.getSetting(...))` before registration. `registerSetting` itself initialises the stored default if the key is missing.

## 5. Logging rules

- Use `CabbyCodes.log / warn / error / debug`. Do **not** call `console.*` directly in runtime code — it bypasses the file logger.
- `log` is INFO-level. Default minimum is WARN, so INFO lines are *only* written when `CabbyCodes.debugLoggingEnabled = true`. If you want a message to always land on disk, use `warn` or `error`.
- Keep every line prefixed `[CabbyCodes]` for greppability. Feature files often sub-prefix: `'[CabbyCodes][Clock]'`, `'[CabbyCodes][Doorbell]'`.
- Never log PII, save contents, or raw player-typed strings to `CabbyCodes.log`. The log ships with bug reports.

## 6. Session-state rules

- Anything that touches `$gameParty`, `$gameActors`, `$gameVariables`, or `$gameSwitches` should be gated behind `CabbyCodes.isGameSessionActive()` if it can fire before a save is loaded.
- For Options-menu visibility, rely on the existing `canShowCabbyCodesOptions()` hook; don't re-check session state in `addGeneralOptions`.

## 7. UI / rendering rules

- Follow the MZ scene conventions: subclass `Scene_MenuBase` (or similar), expose the constructor on `window` so `SceneManager.push(Scene_Cabby...)` works, and implement `prepare`, `create`, and a `helpAreaHeight`/rect pair.
- Use shared constants in `cabbycodes-book-ui.js` whenever you create a list/checkbox window (cookbook, recipe book, oven-checkboxes). Duplicating the palette leads to visual drift.
- Don't attach `window.addEventListener('keydown', ...)` without also removing it in `destroy`. `Window_CabbyCodesNumberInput` is the reference implementation.
- Keep HUD refresh intervals generous (≥ 6–12 frames between rebuilds). Rebuilding bitmaps every frame tanks framerate on low-end hardware.

## 8. Time / variable / switch rules

- Variable and switch IDs used by the base game are concentrated in `cabbycodes-freeze-time.js` and `cabbycodes-doorbell.js`. When you discover a new ID, add it there with a comment describing what the game uses it for.
- Never write directly to `$gameVariables._data` — always go through `$gameVariables.setValue(id, value)`. (Some freeze-time hooks intercept `setValue`; bypassing it defeats them.)
- If you add a new "freeze"-style feature, reuse `freezeTimeApi.registerVariableWriteInterceptor(handler)` instead of wrapping `Game_Variables.prototype.setValue` yourself.
- **The freeze-time snapshot covers more than clock vars.** It currently pins vars **10, 12–18, 20–22, 48–51, 67, 112, 122, 617** and switch **24** (door-knock pending). Before writing to any variable or switch from a new cheat, grep `FROZEN_VARIABLE_IDS` / `FROZEN_SWITCH_IDS` in `cabbycodes-freeze-time.js`. If your target is in the set, writes will be reverted by the restore loop within ~250 ms (debounced) / 500 ms (safety net).
- **Use `CabbyCodes.freezeTime.exemptFromRestore({ variables, switches })` for intentional writes to frozen IDs.** It returns a token with `.release()`. While held, the restore loop skips those IDs; on release the snapshot re-syncs to current values so freeze resumes from the post-event state (prevents stuck-value loops such as the same door visitor being re-summoned forever). Release on a deterministic game-driven signal — typically the switch/variable transition the game itself writes when the event ends — not on a timer.
- **`registerVariableWriteInterceptor` vs. `exemptFromRestore`:** the interceptor is for *blocking* writes (e.g. freeze-hygiene stopping stat decay); the exemption is for *keeping* writes (a cheat pushing a new state through freeze). Don't confuse them.
- **Diagnostic pattern.** If a cheat's effect fires momentarily and then vanishes while Freeze Time is on (knock triggers but no visitor, summoned item disappears, etc.), the first thing to check is whether the write targets an ID in the freeze set. The symptom is almost always the restore loop stomping the write within half a second.

## 9. Performance guardrails

- Do not put expensive work inside hot loops — `Game_Interpreter.prototype.update`, `Scene_Map.prototype.update`, `Window_Base.prototype.update`, sprite `update` methods. These run every frame or every interpreter tick.
- The debug module records `new Error().stack` on every entry into a patched function. Treat every `CabbyCodes.override` as having nontrivial overhead and reach for `after` / `before` (or skip the hook entirely) when you only need a side effect.
- Avoid patching `Game_Variables.prototype.value` or any method called hundreds of times per frame.
- File I/O: The logger uses `fs.appendFileSync`. Avoid spamming `CabbyCodes.log(...)` at frame rate — keep per-frame log lines behind `CabbyCodes.debug(...)`.

## 10. Versioning / release rules

- The canonical version lives in `VERSION` (single line, trimmed).
- `make rev X.Y.Z` updates:
  - `VERSION`,
  - `CabbyCodes.version = '...'` in `cabbycodes-core.js`,
  - the "Current Version" line in `README.md`.
- Always bump the version before building a distribution zip with `make package`.
- Packaging includes the loader, the `CabbyCodes/` folder, `README.md`, and `LICENSE`. It does **not** include `VERSION`, `CommonEvents.json`, `game_files/`, `scripts/`, or the Makefile.

## 11. Deploy / run rules

- `make deploy` removes the installed `CabbyCodes.js` and `CabbyCodes/` folder, copies fresh, and verifies every file's SHA-256. Always run it from the repo root.
- `make run` force-kills `Game.exe`. Save before invoking or a dirty shutdown can occur. Prefer quitting the game manually during development.
- `make clean-log` deletes `CabbyCodes.log` without backup. Keep a copy if you're about to file a diagnostic.

## 12. Editing etiquette for AI agents

- Treat `.cursorrules` as a companion to this file. It predates the patch-chain and debug systems but its style rules are still authoritative (IIFE, JSDoc, namespace guard, etc.).
- Do not introduce new runtime dependencies. The repo intentionally has no `package.json`, `npm install`, `eslint`, or build chain.
- Do not modify `game_files/` — it is a pristine reference mirror.
- Do not touch `CommonEvents.json` at the repo root unless you are updating the annotated reference (document any change in the commit message).
- When adding helper scripts under `scripts/`, mirror the existing style: tiny Node or Python CLI, documented usage in a leading comment, path to the game install configurable at the top.
- Prefer small, reviewable commits that touch one feature file at a time. Tests do not exist; your changes must be readable and defensive enough to merge without one.
- When in doubt about whether something is the "true original" vs. a wrapper, read `cabbycodes-patches.js` before writing more patches. Several subtle bugs listed in `IMPROVEMENTS.md` come from assuming otherwise.
- **Keep `README.md`'s "Current Features" list in sync.** Any change that adds, removes, or renames a player-facing setting registered via `CabbyCodes.registerSetting` must also update the matching bullet in `README.md`. If you change a feature's behavior enough that the existing blurb is misleading, rewrite the blurb in the same commit. Support-only modules (`book-ui`, `item-editor`, `oven-navigation`, `version-display`, `time-advance-logger`, and the core/patches/settings/logger/session-state/debug infrastructure) do not get README entries.

## 13. Known traps (read before you patch)

- `before` / `after` overwrite `_cabbycodesOriginals[fn]` every call. Using them *after* an `override` has been applied will corrupt the stored "true original". Prefer using `override` + `callOriginal` for everything until this is fixed.
- Several feature files hand-roll `callOriginal` by reading `target._cabbycodesOriginals?.fn`. That only works when *exactly one* module has patched that method, because that slot always holds the **true original** — not the previous link. If another override sits between you and the original, a hand-rolled helper will silently skip it. Use `CabbyCodes.callOriginal` when there are (or might later be) multiple overrides on the target.
- Do NOT try to "find the real override" by walking `_cabbycodesOriginal` off a debug wrapper. `debugWrap` inherits `_cabbycodesOriginal` from the function it wraps, so that pointer already jumps an entire chain layer; following it a second time silently skips a link. `CabbyCodes.callOriginal` picks the right link via `CabbyCodes._overrideCallStack` — the stack each chainedFunction push/pops itself onto while running. This design is what enables correct chain dispatch when two or more modules override the same method (e.g. `Game_Party.prototype.gainItem` is patched by both `infinite-consumables` and `infinite-ammo`, and `Game_Variables.prototype.value` is patched by `free-vending` and `freeze-time`). Historically this was broken — `infinite-ammo`'s delegation jumped straight to the rmmz original, bypassing `infinite-consumables` — so door-visitor gift items still decremented while "Infinite Items" was on. If you re-introduce any "unwrap the debug wrapper" logic, that regression will return.
- The options menu rebuilds only when `Scene_Options` is re-entered. If your feature unregisters or reorders settings at runtime, the player has to reopen Options to see the change.
- The loader's 5-second `setInterval` fallback is defensive but almost never needed — MZ guarantees `PluginManager` by the time plugin scripts are evaluated. If you find yourself racing against it, something else is wrong.
- Freeze-time's restore loop runs asynchronously on a debounce + safety-net tick. Any cheat that writes to a frozen var/switch and expects the value to persist past ~250 ms must hold an `exemptFromRestore` token across the write-to-game-reads-it window (see §8). This burned the doorbell's "Send Next Visitor" for a release — knock fired, but vars 50/51/67 + switch 24 were restored before the player reached the door.

## 14. Quick reference

- Core: `CabbyCodes.getSetting / setSetting / registerSetting / applySettingValue / normalizeSettingValue`.
- Patching: `CabbyCodes.override / before / after / restore / callOriginal / callTrueOriginal / callPrevious / getAppliedPatches / logAppliedPatches`.
- Session: `CabbyCodes.isGameSessionActive / setGameSessionActive / canShowCabbyCodesOptions`.
- Logging: `CabbyCodes.log / warn / error / debug / getLogFilePath`.
- Debug: `CabbyCodes.debugWrap / getCallStats / logCallStats / clearCallStats`.
- Book UI: `CabbyCodes.bookUi.defaults / getIncompleteHeaderColor / ...` (see `cabbycodes-book-ui.js`).

When you need more detail, `ARCHITECTURE.md` has the full map; `IMPROVEMENTS.md` has the "things to fix next" list.
