//=============================================================================
// CabbyCodes Freeze Time
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Freeze Time - Locks the in-world clock at its current value.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that locks the in-world clock and all related
 * time-of-day state. Time-burning actions (cooking, opening the door, playing
 * a videogame, etc.) still execute fully and any queued events run to
 * completion — the actual game time, the displayed clock, and all hour/day
 * side effects (stamina drain, day-segment changes, daily resets) simply do
 * not advance.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Freeze Time requires CabbyCodes core.');
        return;
    }

    const settingKey = 'freezeTimeOfDay';

    // ----- Game-side constants -----
    // Variables held to their snapshot value while the cheat is on. Var 19
    // (minutesPassCount) is intentionally absent — we drain it to 0 instead so
    // events polling "wait until minutes burned" can complete in one tick.
    const FROZEN_VARIABLE_IDS = [
        10,  // Clock pendulum / animation state
        12,  // Displayed time string (HH:MM)
        13,  // timeDay (day-segment tracker)
        14,  // calendarDay (absolute day counter)
        15,  // currentDay (in-world day)
        16,  // currentHour
        17,  // currentMinute
        18,  // roomsVisited / travel fatigue accumulator
        20,  // clockHour (rendered hour)
        21,  // statSocial
        22,  // statCalm
        48,  // Door event timer
        49,  // Door event label
        50,  // Door hour slot
        51,  // Door minute slot
        67,  // Door encounter type
        112, // Encounter danger modifier (time-based)
        122, // Time-of-day bucket
        617  // Door cooldown tracker
    ];
    const FROZEN_SWITCH_IDS = [
        24   // someoneAtDoor (door-knock pending flag)
    ];
    // Variables whose first nonzero write tells us the save data has loaded
    // and the snapshot is now safe to capture.
    const SENTINEL_VARIABLE_IDS = [16, 17, 122];

    const MINUTES_PASS_VAR = 19;
    const TIME_PASSES_COMMON_EVENT = 4;
    const HOUR_PASSED_COMMON_EVENT = 5;
    const NEW_DAY_COMMON_EVENT = 6;

    const RESTORE_DEBOUNCE_MS = 250;
    const SAFETY_NET_INTERVAL_MS = 500;
    const DEFERRED_CAPTURE_RETRY_MS = 250;

    // ----- Public API surface (used by freeze-hygiene + time-advance-logger) -----
    const freezeTimeApi = (CabbyCodes.freezeTime = CabbyCodes.freezeTime || {});
    const variableWriteInterceptors =
        freezeTimeApi.variableWriteInterceptors || [];
    freezeTimeApi.variableWriteInterceptors = variableWriteInterceptors;

    function registerVariableWriteInterceptor(handler) {
        if (typeof handler !== 'function') {
            return;
        }
        if (!variableWriteInterceptors.includes(handler)) {
            variableWriteInterceptors.push(handler);
        }
    }
    freezeTimeApi.registerVariableWriteInterceptor = registerVariableWriteInterceptor;

    // ----- State -----
    const frozenVariableValues = Object.create(null);
    const frozenSwitchValues = Object.create(null);

    let timeDataInitialized = false;
    let snapshotCaptured = false;
    let captureRequested = false;
    let pendingCaptureTimer = null;

    let lastRestoreAt = 0;
    let pendingRestoreTimer = null;

    let drainingVar19 = false;
    let restoringSnapshot = false;

    function nowMs() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    function isFreezeEnabled() {
        return CabbyCodes.getSetting(settingKey, false);
    }

    // ----- callOriginal helper (walks past wrappers to the true original) -----
    function callOriginal(target, fnName, ctx, args) {
        if (typeof CabbyCodes.callOriginal === 'function') {
            return CabbyCodes.callOriginal(target, fnName, ctx, args);
        }
        const originals = target._cabbycodesOriginals;
        if (originals && typeof originals[fnName] === 'function') {
            return originals[fnName].apply(ctx, args);
        }
        return undefined;
    }

    function readVariableRaw(varId) {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return 0;
        }
        return callOriginal(Game_Variables.prototype, 'value', $gameVariables, [varId]);
    }

    // ----- Snapshot primitives -----
    function checkSentinelInitialized() {
        if (timeDataInitialized) {
            return true;
        }
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        for (const id of SENTINEL_VARIABLE_IDS) {
            const value = Number(readVariableRaw(id));
            if (Number.isFinite(value) && value > 0) {
                timeDataInitialized = true;
                return true;
            }
        }
        return false;
    }

    function captureSnapshot() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        FROZEN_VARIABLE_IDS.forEach(id => {
            frozenVariableValues[id] = readVariableRaw(id);
        });
        if (typeof $gameSwitches !== 'undefined' && $gameSwitches) {
            FROZEN_SWITCH_IDS.forEach(id => {
                frozenSwitchValues[id] = $gameSwitches.value(id);
            });
        }
        snapshotCaptured = true;
        lastRestoreAt = nowMs();
        return true;
    }

    function clearSnapshot() {
        for (const key of Object.keys(frozenVariableValues)) {
            delete frozenVariableValues[key];
        }
        for (const key of Object.keys(frozenSwitchValues)) {
            delete frozenSwitchValues[key];
        }
        snapshotCaptured = false;
        if (pendingRestoreTimer !== null) {
            clearTimeout(pendingRestoreTimer);
            pendingRestoreTimer = null;
        }
    }

    function requestCaptureSnapshot() {
        captureRequested = true;
        if (checkSentinelInitialized() && captureSnapshot()) {
            captureRequested = false;
            return;
        }
        if (pendingCaptureTimer !== null) {
            return;
        }
        pendingCaptureTimer = setTimeout(() => {
            pendingCaptureTimer = null;
            if (!captureRequested || !isFreezeEnabled()) {
                captureRequested = false;
                return;
            }
            requestCaptureSnapshot();
        }, DEFERRED_CAPTURE_RETRY_MS);
    }

    function enforceSnapshot() {
        if (!isFreezeEnabled() || !snapshotCaptured) {
            return false;
        }
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        let applied = 0;
        restoringSnapshot = true;
        try {
            FROZEN_VARIABLE_IDS.forEach(id => {
                const target = frozenVariableValues[id];
                if (typeof target === 'undefined') {
                    return;
                }
                const current = readVariableRaw(id);
                if (Object.is(current, target)) {
                    return;
                }
                try {
                    callOriginal(Game_Variables.prototype, 'setValue', $gameVariables, [id, target]);
                    applied += 1;
                } catch (err) {
                    CabbyCodes.error('[CabbyCodes][FreezeTime] Failed to restore variable', id, err);
                }
            });
            if (typeof $gameSwitches !== 'undefined' && $gameSwitches) {
                FROZEN_SWITCH_IDS.forEach(id => {
                    const target = frozenSwitchValues[id];
                    if (typeof target === 'undefined') {
                        return;
                    }
                    const current = $gameSwitches.value(id);
                    if (current === target) {
                        return;
                    }
                    try {
                        $gameSwitches.setValue(id, target);
                        applied += 1;
                    } catch (err) {
                        CabbyCodes.error('[CabbyCodes][FreezeTime] Failed to restore switch', id, err);
                    }
                });
            }
        } finally {
            restoringSnapshot = false;
        }
        lastRestoreAt = nowMs();
        return applied > 0;
    }

    function scheduleRestore() {
        if (!isFreezeEnabled() || !snapshotCaptured) {
            return;
        }
        const elapsed = nowMs() - lastRestoreAt;
        if (elapsed >= RESTORE_DEBOUNCE_MS) {
            enforceSnapshot();
            return;
        }
        if (pendingRestoreTimer !== null) {
            return;
        }
        const wait = Math.max(0, RESTORE_DEBOUNCE_MS - elapsed);
        pendingRestoreTimer = setTimeout(() => {
            pendingRestoreTimer = null;
            enforceSnapshot();
        }, wait);
    }

    // ----- Variable-write interceptor pipeline (preserves existing API) -----
    function applyInterceptors(varId, previousValue, pendingValue, source) {
        if (variableWriteInterceptors.length === 0) {
            return { blocked: false, value: pendingValue };
        }
        let value = pendingValue;
        for (const handler of variableWriteInterceptors) {
            try {
                const result = handler(varId, previousValue, value, { source });
                if (result === false || (result && result.block === true)) {
                    return { blocked: true };
                }
                if (result && Object.prototype.hasOwnProperty.call(result, 'value')) {
                    value = result.value;
                }
            } catch (err) {
                CabbyCodes.error('[CabbyCodes][FreezeTime] interceptor error:', err);
            }
        }
        return { blocked: false, value };
    }

    // ----- Setting registration -----
    CabbyCodes.registerSetting(settingKey, 'Freeze Time', {
        defaultValue: false,
        order: 55,
        onChange: newValue => {
            if (newValue) {
                requestCaptureSnapshot();
                CabbyCodes.log('[CabbyCodes][FreezeTime] Time locked at current value.');
            } else {
                clearSnapshot();
                timeDataInitialized = false;
                CabbyCodes.log('[CabbyCodes][FreezeTime] Time unlocked.');
            }
        }
    });

    // ----- Game_Variables.setValue: interceptors + var-19 instant drain -----
    CabbyCodes.override(Game_Variables.prototype, 'setValue', function(variableId, value) {
        const numericId = Number(variableId);
        if (!Number.isFinite(numericId)) {
            return callOriginal(Game_Variables.prototype, 'setValue', this, [variableId, value]);
        }

        // Sentinel: notice when the save's clock data first becomes nonzero.
        if (!timeDataInitialized && SENTINEL_VARIABLE_IDS.indexOf(numericId) !== -1) {
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric > 0) {
                timeDataInitialized = true;
                if (captureRequested && isFreezeEnabled() && !snapshotCaptured) {
                    setTimeout(() => requestCaptureSnapshot(), 0);
                }
            }
        }

        let writtenValue = value;
        if (!restoringSnapshot && variableWriteInterceptors.length > 0) {
            const previousValue = callOriginal(Game_Variables.prototype, 'value', this, [numericId]);
            const result = applyInterceptors(numericId, previousValue, value, 'setValue');
            if (result.blocked) {
                return;
            }
            writtenValue = result.value;
        }

        const writeResult = callOriginal(
            Game_Variables.prototype,
            'setValue',
            this,
            [numericId, writtenValue]
        );

        if (
            !drainingVar19 &&
            !restoringSnapshot &&
            numericId === MINUTES_PASS_VAR &&
            isFreezeEnabled() &&
            snapshotCaptured
        ) {
            const numericValue = Number(writtenValue);
            if (Number.isFinite(numericValue) && numericValue > 0) {
                drainingVar19 = true;
                try {
                    callOriginal(Game_Variables.prototype, 'setValue', this, [MINUTES_PASS_VAR, 0]);
                } finally {
                    drainingVar19 = false;
                }
            }
        }

        return writeResult;
    });

    // ----- command117: suppress HourPassed / newDay ONLY when cascading from TimePasses.
    //       Direct calls from story events (e.g. Map 3 event 9) still fire normally. -----
    CabbyCodes.override(Game_Interpreter.prototype, 'command117', function(parameters) {
        const ceId = Number(Array.isArray(parameters) ? parameters[0] : NaN);

        if (
            isFreezeEnabled() &&
            (ceId === HOUR_PASSED_COMMON_EVENT || ceId === NEW_DAY_COMMON_EVENT) &&
            this._cabbycodesInTimePasses
        ) {
            return true;
        }

        const result = callOriginal(Game_Interpreter.prototype, 'command117', this, [parameters]);

        if (Number.isFinite(ceId) && this._childInterpreter) {
            if (ceId === TIME_PASSES_COMMON_EVENT || this._cabbycodesInTimePasses) {
                this._childInterpreter._cabbycodesInTimePasses = true;
            }
        }

        return result;
    });

    // ----- Restore on interpreter terminate (debounced) -----
    CabbyCodes.after(Game_Interpreter.prototype, 'terminate', function() {
        if (!isFreezeEnabled() || !snapshotCaptured) {
            return;
        }
        scheduleRestore();
    });

    // ----- Safety-net: low-frequency drift check on the map update -----
    CabbyCodes.after(Game_Map.prototype, 'update', function() {
        if (!isFreezeEnabled() || !snapshotCaptured) {
            return;
        }
        const elapsed = nowMs() - lastRestoreAt;
        if (elapsed < SAFETY_NET_INTERVAL_MS) {
            return;
        }
        for (const id of FROZEN_VARIABLE_IDS) {
            const target = frozenVariableValues[id];
            if (typeof target === 'undefined') {
                continue;
            }
            const current = readVariableRaw(id);
            if (!Object.is(current, target)) {
                scheduleRestore();
                return;
            }
        }
    });

    // ----- Save-load: recapture snapshot from the loaded save's clock -----
    if (typeof Scene_Load !== 'undefined' && Scene_Load.prototype) {
        CabbyCodes.after(Scene_Load.prototype, 'onLoadSuccess', function() {
            if (!isFreezeEnabled()) {
                return;
            }
            clearSnapshot();
            timeDataInitialized = false;
            requestCaptureSnapshot();
        });
    }

    // ----- Game_Variables.initialize / clear: re-arm sentinel detection -----
    const originalInitialize = Game_Variables.prototype.initialize;
    Game_Variables.prototype.initialize = function() {
        originalInitialize.call(this);
        timeDataInitialized = false;
        if (isFreezeEnabled()) {
            clearSnapshot();
            requestCaptureSnapshot();
        }
    };

    const originalClear = Game_Variables.prototype.clear;
    Game_Variables.prototype.clear = function() {
        originalClear.call(this);
        timeDataInitialized = false;
        if (isFreezeEnabled()) {
            clearSnapshot();
            requestCaptureSnapshot();
        }
    };

    CabbyCodes.log('[CabbyCodes] Freeze Time module loaded');
})();
