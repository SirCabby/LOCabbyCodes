//=============================================================================
// CabbyCodes Freeze Time
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Freeze Time - Stops the in-game time of day from advancing.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that locks the game's time-of-day variable so
 * activities such as walking around, minigames, or scripted events can no longer
 * advance it. Other systems like battles or shop restocking continue running
 * normally because they do not rely on the time-of-day variable.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Freeze Time requires CabbyCodes core.');
        return;
    }

    const settingKey = 'freezeTimeOfDay';
    const defaultTimeVariableIds = [
        10, // Clock pendulum / animation state
        12, // Time display string (HH:MM)
        13, // Day segment tracker
        16, // Hour of day
        17, // Minute of day
        18, // Travel fatigue accumulator
        19, // Minutes to advance
        48, // Door event timer
        49, // Door event label
        50, // Door hour slot
        51, // Door minute slot
        67, // Door encounter type
        112, // Encounter danger modifier (time-based)
        122, // Time-of-day bucket
        617 // Door cooldown tracker
    ];
    const defaultTimeSwitchIds = [
        24 // Door knock pending flag
    ];
    const sentinelVariableIds = [16, 17, 122];
    const trackedVariableIds = new Set(defaultTimeVariableIds);
    const frozenValues = {};

    const detectionConfig = {
        minValue: 0,
        maxValue: 2880,
        increments: [1, 5, 6, 10, 12, 15, 20, 30, 45, 60],
        requiredHits: 1
    };

    const detectionState = {
        hits: Object.create(null)
    };

    const interpreterStack = [];
    const interpreterThawStates = new WeakMap();
    const videoGameCommonEventId = 12;
    const zeroTimeCommonEventIds = new Set([68, 69, videoGameCommonEventId]);
    let timeDataInitialized = false;
    let pendingFreezeCaptureTimer = null;
    let freezeCaptureRequested = false;
    let freezeSessionId = 0;

    const initializationWindowMs = 5000;
    let freezeActivatedAt = 0;

    function nowMs() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    function addTimeVariableId(varId) {
        if (!Number.isFinite(varId) || varId <= 0) {
            return;
        }
        trackedVariableIds.add(varId);
    }

    function captureFrozenValues() {
        if (!timeDataInitialized) {
            return false;
        }
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        trackedVariableIds.forEach(varId => {
            frozenValues[varId] = getTrueOriginalValue($gameVariables, varId);
        });
        return true;
    }

    function requestCaptureFrozenValues() {
        freezeCaptureRequested = true;
        if (captureFrozenValues()) {
            freezeCaptureRequested = false;
            return;
        }
        if (pendingFreezeCaptureTimer !== null) {
            return;
        }
        pendingFreezeCaptureTimer = setTimeout(() => {
            pendingFreezeCaptureTimer = null;
            requestCaptureFrozenValues();
        }, 250);
    }

    function canEnforceTimeLock() {
        return timeDataInitialized && isAnyTimeLockActive();
    }

    CabbyCodes.registerSetting(settingKey, 'Freeze Time of Day', {
        defaultValue: false,
        order: 60,
        onChange: newValue => {
            freezeSessionId += 1;
            if (newValue) {
                freezeActivatedAt = nowMs();
                requestCaptureFrozenValues();
            } else {
                freezeActivatedAt = 0;
                trackedVariableIds.forEach(varId => {
                    delete frozenValues[varId];
                });
            }
        }
    });

    function isFreezeSettingActive() {
        return CabbyCodes.getSetting(settingKey, false);
    }

    function isTrackingEnabled() {
        return isFreezeSettingActive();
    }

    function isAnyTimeLockActive() {
        return isFreezeEnabled();
    }

    function shouldApplyZeroTime(commonEventId) {
        return isFreezeSettingActive() && zeroTimeCommonEventIds.has(commonEventId);
    }

    function isZeroTimeInterpreter(interpreter) {
        return Boolean(interpreter && interpreter._cabbycodesZeroTimeActive);
    }

    function markZeroTimeChild(parentInterpreter, childInterpreter, commonEventId) {
        if (!childInterpreter) {
            return;
        }
        const inheritsZeroTime = isZeroTimeInterpreter(parentInterpreter);
        childInterpreter._cabbycodesZeroTimeActive =
            inheritsZeroTime || shouldApplyZeroTime(commonEventId);
    }

    function isZeroTimeInterpreter(interpreter) {
        return Boolean(interpreter && interpreter._cabbycodesZeroTimeActive);
    }

    function markZeroTimeChild(parent, child, commonEventId) {
        if (!child) {
            return;
        }
        const parentZero = isZeroTimeInterpreter(parent);
        child._cabbycodesZeroTimeActive =
            zeroTimeCommonEventIds.has(commonEventId) || parentZero;
    }

    function shouldBlock(variableId) {
        if (!canEnforceTimeLock()) {
            return false;
        }
        const numericId = Number(variableId);
        if (!Number.isFinite(numericId)) {
            return false;
        }
        return trackedVariableIds.has(numericId);
    }

    const callOriginal = (typeof CabbyCodes.callOriginal === 'function')
        ? CabbyCodes.callOriginal
        : (target, functionName, context, args) => {
            const originals = target._cabbycodesOriginals;
            if (originals && typeof originals[functionName] === 'function') {
                return originals[functionName].apply(context, args);
            }
            return undefined;
        };

    const getTrueOriginalValue = (function() {
        const originalValue = Game_Variables.prototype.value;
        return function(instance, variableId) {
            if (instance && instance._cabbycodesRawVariables) {
                const raw = instance._cabbycodesRawVariables;
                const index = Number(variableId);
                if (Number.isFinite(index)) {
                    const stored = raw[index];
                    return typeof stored === 'undefined' ? 0 : stored;
                }
            }
            return originalValue.call(instance, variableId);
        };
    })();

    function isFreezeEnabled() {
        return isFreezeSettingActive();
    }

    function getOwningInterpreter() {
        if (interpreterStack.length === 0) {
            return null;
        }
        return interpreterStack[interpreterStack.length - 1];
    }

    function getInterpreterState(interpreter) {
        if (!interpreter) {
            return null;
        }
        let state = interpreterThawStates.get(interpreter);
        if (!state || state.sessionId !== freezeSessionId) {
            state = {
                sessionId: freezeSessionId,
                variables: new Map()
            };
            interpreterThawStates.set(interpreter, state);
        }
        return state;
    }

    function ensureFrozenValue(varId, fallbackValue) {
        if (!Number.isFinite(varId)) {
            return 0;
        }
        if (!Object.prototype.hasOwnProperty.call(frozenValues, varId)) {
            if (Number.isFinite(fallbackValue)) {
                frozenValues[varId] = fallbackValue;
            } else if (typeof $gameVariables !== 'undefined' && $gameVariables) {
                frozenValues[varId] = getTrueOriginalValue($gameVariables, varId);
            } else {
                frozenValues[varId] = 0;
            }
        }
        return frozenValues[varId];
    }

    function updateTimeInitializationStatus(varId, value) {
        if (timeDataInitialized) {
            return;
        }
        if (!sentinelVariableIds.includes(varId)) {
            return;
        }
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return;
        }
        if (numericValue <= 0) {
            return;
        }
        timeDataInitialized = true;
        if (freezeCaptureRequested) {
            requestCaptureFrozenValues();
        }
    }

    function tryEstablishTemporaryThaw(varId, previousValue) {
        const interpreter = getOwningInterpreter();
        if (!interpreter) {
            return false;
        }
        const state = getInterpreterState(interpreter);
        if (!state) {
            return false;
        }
        if (!state.variables.has(varId)) {
            state.variables.set(varId, ensureFrozenValue(varId, previousValue));
        }
        return true;
    }

    function hasActiveThaw(varId) {
        for (let i = interpreterStack.length - 1; i >= 0; i--) {
            const interpreter = interpreterStack[i];
            const state = interpreterThawStates.get(interpreter);
            if (state && state.sessionId === freezeSessionId && state.variables.has(varId)) {
                return true;
            }
        }
        return false;
    }

    function shouldReturnFrozenValue(numericId) {
        if (!Number.isFinite(numericId)) {
            return false;
        }
        if (!canEnforceTimeLock()) {
            return false;
        }
        if (!trackedVariableIds.has(numericId)) {
            return false;
        }
        if (!Object.prototype.hasOwnProperty.call(frozenValues, numericId)) {
            return false;
        }
        return !hasActiveThaw(numericId);
    }

    function releaseInterpreterState(interpreter) {
        const state = interpreterThawStates.get(interpreter);
        if (!state) {
            return;
        }
        interpreterThawStates.delete(interpreter);
        if (state.sessionId !== freezeSessionId || !isFreezeEnabled()) {
            return;
        }
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return;
        }
        state.variables.forEach((baseline, varId) => {
            if (!Number.isFinite(varId)) {
                return;
            }
            const restoreValue = Number.isFinite(baseline) ? baseline : 0;
            try {
                callOriginal(Game_Variables.prototype, 'setValue', $gameVariables, [
                    varId,
                    restoreValue
                ]);
            } catch (error) {
                console.error('[CabbyCodes] Failed to restore frozen variable', varId, error);
            }
        });
    }

    function captureTrackedValuesSnapshot() {
        const snapshot = new Map();
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return snapshot;
        }
        trackedVariableIds.forEach(varId => {
            snapshot.set(varId, getTrueOriginalValue($gameVariables, varId));
        });
        return snapshot;
    }

    function captureTimeSwitchSnapshot() {
        const snapshot = new Map();
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return snapshot;
        }
        defaultTimeSwitchIds.forEach(switchId => {
            snapshot.set(switchId, $gameSwitches.value(switchId));
        });
        return snapshot;
    }

    function restoreSwitchSnapshot(snapshot) {
        if (!snapshot || snapshot.size === 0) {
            return;
        }
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return;
        }
        snapshot.forEach((value, switchId) => {
            try {
                $gameSwitches.setValue(switchId, value);
            } catch (error) {
                console.error('[CabbyCodes] Failed to restore switch', switchId, error);
            }
        });
    }

    function applySnapshot(snapshot) {
        if (!snapshot || snapshot.size === 0) {
            return;
        }
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return;
        }
        if (snapshot.size > 0) {
            timeDataInitialized = true;
        }
        snapshot.forEach((value, varId) => {
            if (!Number.isFinite(varId)) {
                return;
            }
            try {
                callOriginal(Game_Variables.prototype, 'setValue', $gameVariables, [varId, value]);
                frozenValues[varId] = value;
            } catch (error) {
                console.error('[CabbyCodes] Failed to apply freeze snapshot', varId, error);
            }
        });
    }

    function finalizeInterpreterSuspension(interpreter) {
        if (interpreter && interpreter._cabbycodesZeroTimeActive) {
            delete interpreter._cabbycodesZeroTimeActive;
        }
    }

    function detectTimeVariableCandidate(varId, previousValue, newValue) {
        if (trackedVariableIds.has(varId)) {
            return null;
        }
        const numericPrev = Number(previousValue);
        const numericNew = Number(newValue);
        if (!Number.isFinite(numericPrev) || !Number.isFinite(numericNew)) {
            return null;
        }
        if (
            numericNew < detectionConfig.minValue ||
            numericNew > detectionConfig.maxValue ||
            numericPrev < detectionConfig.minValue ||
            numericPrev > detectionConfig.maxValue
        ) {
            return null;
        }
        if (
            freezeActivatedAt > 0 &&
            nowMs() - freezeActivatedAt < initializationWindowMs &&
            numericPrev === 0 &&
            numericNew > 0
        ) {
            return null;
        }
        const diff = Math.abs(numericNew - numericPrev);
        if (diff === 0) {
            return null;
        }
        const matchesIncrement = detectionConfig.increments.some(inc => diff % inc === 0);
        if (!matchesIncrement) {
            return null;
        }
        detectionState.hits[varId] = (detectionState.hits[varId] || 0) + 1;
        if (detectionState.hits[varId] >= detectionConfig.requiredHits) {
            detectionState.hits[varId] = 0;
            return {
                newlyDetected: true,
                captureValue: numericPrev
            };
        }
        return null;
    }

    CabbyCodes.override(
        Game_Variables.prototype,
        'value',
        function(variableId) {
            const numericId = Number(variableId);
            if (shouldReturnFrozenValue(numericId)) {
                return frozenValues[numericId];
            }
            return callOriginal(Game_Variables.prototype, 'value', this, [variableId]);
        }
    );

    CabbyCodes.override(
        Game_Variables.prototype,
        'setValue',
        function(variableId, value) {
            const numericId = Number(variableId);
            const previousValue = Number.isFinite(numericId)
                ? getTrueOriginalValue(this, numericId)
                : undefined;

            if (Number.isFinite(numericId) && isTrackingEnabled()) {
                const detectionResult = detectTimeVariableCandidate(numericId, previousValue, value);
                if (detectionResult?.newlyDetected) {
                    addTimeVariableId(numericId);
                    if (!Object.prototype.hasOwnProperty.call(frozenValues, numericId)) {
                        frozenValues[numericId] = detectionResult.captureValue;
                    }
                    detectionState.hits[numericId] = 0;
                }
            }

            if (
                !Number.isFinite(numericId) ||
                !canEnforceTimeLock() ||
                !trackedVariableIds.has(numericId)
            ) {
                return callOriginal(Game_Variables.prototype, 'setValue', this, [
                    variableId,
                    value
                ]);
            }

            ensureFrozenValue(numericId, previousValue);

            if (tryEstablishTemporaryThaw(numericId, previousValue)) {
                return callOriginal(Game_Variables.prototype, 'setValue', this, [
                    variableId,
                    value
                ]);
            }

            return;
        }
    );

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'command117',
        function(parameters) {
            const result = callOriginal(Game_Interpreter.prototype, 'command117', this, [parameters]);
            const commonEventId = Array.isArray(parameters) ? parameters[0] : undefined;
            if (this._childInterpreter && Number.isFinite(commonEventId)) {
                markZeroTimeChild(this, this._childInterpreter, Number(commonEventId));
            }
            return result;
        }
    );

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'setupReservedCommonEvent',
        function() {
            if ($gameTemp.isCommonEventReserved()) {
                const commonEvent = $gameTemp.retrieveCommonEvent();
                if (commonEvent) {
                    this.setup(commonEvent.list);
                    markZeroTimeChild(null, this, Number(commonEvent.id));
                    return true;
                }
            }
            return false;
        }
    );

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'update',
        function() {
            interpreterStack.push(this);
            try {
                return callOriginal(Game_Interpreter.prototype, 'update', this, [
                    ...arguments
                ]);
            } finally {
                interpreterStack.pop();
            }
        }
    );

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'command122',
        function(parameters) {
            const zeroTimeActive = isZeroTimeInterpreter(this);
            let minutesBefore = null;
            if (zeroTimeActive && typeof $gameVariables !== 'undefined' && $gameVariables) {
                const startId = Number(parameters[0]);
                const endId = Number(parameters[1]);
                if (
                    Number.isFinite(startId) &&
                    Number.isFinite(endId) &&
                    startId <= 19 &&
                    19 <= endId
                ) {
                    minutesBefore = $gameVariables.value(19);
                }
            }
            const result = callOriginal(Game_Interpreter.prototype, 'command122', this, [
                parameters
            ]);
            if (minutesBefore !== null && typeof $gameVariables !== 'undefined' && $gameVariables) {
                $gameVariables.setValue(19, minutesBefore);
            }
            return result;
        }
    );

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'terminate',
        function() {
            releaseInterpreterState(this);
            finalizeInterpreterSuspension(this);
            return callOriginal(Game_Interpreter.prototype, 'terminate', this, [
                ...arguments
            ]);
        }
    );

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'clear',
        function() {
            releaseInterpreterState(this);
            finalizeInterpreterSuspension(this);
            return callOriginal(Game_Interpreter.prototype, 'clear', this, [
                ...arguments
            ]);
        }
    );

    function wrapDataWithProxy(instance) {
        if (!instance._data || instance._cabbycodesDataProxy) {
            return;
        }
        const originalData = instance._data;
        instance._cabbycodesRawVariables = originalData;
        instance._data = new Proxy(originalData, {
            set(target, property, value) {
                const propNum = Number(property);
                if (Number.isFinite(propNum)) {
                    const previousValue = target[property];
                    if (isTrackingEnabled()) {
                        const detectionResult = detectTimeVariableCandidate(
                            propNum,
                            previousValue,
                            value
                        );
                        if (detectionResult?.newlyDetected) {
                            addTimeVariableId(propNum);
                            if (!Object.prototype.hasOwnProperty.call(frozenValues, propNum)) {
                                frozenValues[propNum] = detectionResult.captureValue;
                            }
                            detectionState.hits[propNum] = 0;
                        }
                    }

                    if (canEnforceTimeLock() && trackedVariableIds.has(propNum)) {
                        ensureFrozenValue(propNum, previousValue);
                        if (tryEstablishTemporaryThaw(propNum, previousValue)) {
                            return Reflect.set(target, property, value);
                        }
                        return true;
                    }
                }
                return Reflect.set(target, property, value);
            },
            get(target, property) {
                const propNum = Number(property);
                if (shouldReturnFrozenValue(propNum)) {
                    return frozenValues[propNum];
                }
                return Reflect.get(target, property);
            }
        });
        instance._cabbycodesDataProxy = true;
    }

    function resetTimeInitializationState() {
        timeDataInitialized = false;
        freezeCaptureRequested = false;
        if (pendingFreezeCaptureTimer !== null) {
            clearTimeout(pendingFreezeCaptureTimer);
            pendingFreezeCaptureTimer = null;
        }
    }

    const originalInitialize = Game_Variables.prototype.initialize;
    Game_Variables.prototype.initialize = function() {
        originalInitialize.call(this);
        resetTimeInitializationState();
        wrapDataWithProxy(this);
    };

    const originalClear = Game_Variables.prototype.clear;
    Game_Variables.prototype.clear = function() {
        originalClear.call(this);
        resetTimeInitializationState();
        wrapDataWithProxy(this);
    };

    if (typeof $gameVariables !== 'undefined' && $gameVariables) {
        wrapDataWithProxy($gameVariables);
    }
})();



