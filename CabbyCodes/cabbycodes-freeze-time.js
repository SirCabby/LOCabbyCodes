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
        21, // Door encounter time cost accumulator
        22, // Additional door encounter cost buckets (special cases)
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
    const freezeTimeApi = (CabbyCodes.freezeTime = CabbyCodes.freezeTime || {});
    const zeroTimeCommonEventIds =
        freezeTimeApi.zeroTimeCommonEventIds || new Set([4, 68, 69, videoGameCommonEventId]);
    freezeTimeApi.zeroTimeCommonEventIds = zeroTimeCommonEventIds;
    const zeroTimeScriptTriggers =
        freezeTimeApi.zeroTimeScriptTriggers || new Set(['grabDoorEncounter']);
    freezeTimeApi.zeroTimeScriptTriggers = zeroTimeScriptTriggers;
    const doorBattlerPrefix = 'DoorEncs/';
    const doorTroopDetectionCache =
        freezeTimeApi.doorTroopDetectionCache || new Map();
    freezeTimeApi.doorTroopDetectionCache = doorTroopDetectionCache;
    const explicitDoorTroopIds =
        freezeTimeApi.explicitDoorTroopIds || new Set();
    freezeTimeApi.explicitDoorTroopIds = explicitDoorTroopIds;
    const frontDoorMapId = 3;
    const frontDoorEventId = 9;
    const doorKnockSwitchId = 24;
    let doorZeroTimeDepth = 0;
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
        if (!trackedVariableIds.has(varId)) {
            trackedVariableIds.add(varId);
            freezeDebugLog(`Added variable ${varId} to freeze tracking set.`);
        }
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
        freezeDebugLog(`Captured frozen values for ${trackedVariableIds.size} variables.`);
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
        freezeDebugLog('Scheduled deferred freeze snapshot capture (game variables not ready).');
    }

    function canEnforceTimeLock() {
        return timeDataInitialized && isAnyTimeLockActive();
    }

    function isDoorZeroTimeActive() {
        return doorZeroTimeDepth > 0;
    }

    function activateDoorZeroTime(reason) {
        doorZeroTimeDepth += 1;
        freezeDebugLog(`Door zero-time activated (depth=${doorZeroTimeDepth}) - ${reason}`);
    }

    function deactivateDoorZeroTime(reason) {
        if (doorZeroTimeDepth > 0) {
            doorZeroTimeDepth -= 1;
            freezeDebugLog(`Door zero-time deactivated (depth=${doorZeroTimeDepth}) - ${reason}`);
        }
        if (doorZeroTimeDepth < 0) {
            doorZeroTimeDepth = 0;
        }
    }

    function isFrontDoorEventInstance(event) {
        if (!event) {
            return false;
        }
        const eventId = typeof event.eventId === 'function' ? event.eventId() : event._eventId;
        return event._mapId === frontDoorMapId && eventId === frontDoorEventId;
    }

    CabbyCodes.registerSetting(settingKey, 'Freeze Time', {
        defaultValue: false,
        order: 52,
        onChange: newValue => {
            freezeSessionId += 1;
            if (newValue) {
                freezeActivatedAt = nowMs();
                requestCaptureFrozenValues();
                freezeDebugLog('Freeze Time enabled - capturing current values.');
            } else {
                freezeActivatedAt = 0;
                trackedVariableIds.forEach(varId => {
                    delete frozenValues[varId];
                });
                freezeDebugLog('Freeze Time disabled - cleared frozen values cache.');
                if (doorZeroTimeDepth > 0) {
                    doorZeroTimeDepth = 0;
                    freezeDebugLog('Door zero-time state reset (freeze disabled).');
                }
            }
        }
    });

    const debugSettingKey = 'freezeTimeDebugLogging';
    CabbyCodes.registerSetting(debugSettingKey, 'Freeze Time Debug Logging', {
        defaultValue: false,
        order: 53,
        onChange: newValue => {
            CabbyCodes.log(
                `[CabbyCodes][FreezeTime] Debug logging ${newValue ? 'enabled' : 'disabled'}.`
            );
        }
    });
    if (CabbyCodes.getSetting(debugSettingKey, false)) {
        CabbyCodes.setSetting(debugSettingKey, false);
        CabbyCodes.log('[CabbyCodes][FreezeTime] Debug logging auto-disabled for this build.');
    }
    function isFreezeDebugEnabled() {
        return Boolean(CabbyCodes.getSetting(debugSettingKey, false));
    }

    function freezeDebugLog(message) {
        if (!isFreezeDebugEnabled()) {
            return;
        }
        CabbyCodes.log(`[CabbyCodes][FreezeTime] ${message}`);
    }

    function isWatchedVariable(varId) {
        return isFreezeDebugEnabled() && trackedVariableIds.has(varId);
    }

    function isFreezeSettingActive() {
        return CabbyCodes.getSetting(settingKey, false);
    }

    function isTrackingEnabled() {
        return isFreezeSettingActive();
    }

    freezeTimeApi.registerZeroTimeEvent = function(eventId) {
        const numericId = Number(eventId);
        if (Number.isFinite(numericId) && numericId > 0) {
            if (!zeroTimeCommonEventIds.has(numericId)) {
                zeroTimeCommonEventIds.add(numericId);
                freezeDebugLog(`Registered common event ${numericId} for zero-time handling.`);
            }
        }
    };

    freezeTimeApi.registerZeroTimeScriptTrigger = function(fragment) {
        if (typeof fragment !== 'string') {
            return;
        }
        const trimmed = fragment.trim();
        if (trimmed.length === 0) {
            return;
        }
        if (!zeroTimeScriptTriggers.has(trimmed)) {
            zeroTimeScriptTriggers.add(trimmed);
            freezeDebugLog(`Registered script trigger "${trimmed}" for zero-time handling.`);
        }
    };

    freezeTimeApi.registerDoorTroopId = function(troopId) {
        const numericId = Number(troopId);
        if (Number.isFinite(numericId) && numericId > 0) {
            explicitDoorTroopIds.add(numericId);
            doorTroopDetectionCache.delete(numericId);
            freezeDebugLog(`Registered troop ${numericId} as door encounter.`);
        }
    };

    function isAnyTimeLockActive() {
        return isFreezeEnabled();
    }

    function shouldApplyZeroTime(commonEventId) {
        if (!isFreezeSettingActive()) {
            return false;
        }
        const numericId = Number(commonEventId);
        if (!Number.isFinite(numericId)) {
            return false;
        }
        return zeroTimeCommonEventIds.has(numericId);
    }

    function interpreterMatchesFrontDoor(interpreter) {
        if (!interpreter) {
            return false;
        }
        if (typeof interpreter._mapId === 'number') {
            return interpreter._mapId === frontDoorMapId;
        }
        return false;
    }

    function isZeroTimeInterpreter(interpreter) {
        if (!interpreter) {
            return false;
        }
        if (interpreter._cabbycodesZeroTimeActive) {
            return true;
        }
        if (isDoorZeroTimeActive() && interpreterMatchesFrontDoor(interpreter)) {
            return true;
        }
        return false;
    }

    function markZeroTimeChild(parentInterpreter, childInterpreter, commonEventId) {
        if (!childInterpreter) {
            return;
        }
        const inheritsZeroTime = isZeroTimeInterpreter(parentInterpreter);
        childInterpreter._cabbycodesZeroTimeActive =
            inheritsZeroTime || shouldApplyZeroTime(commonEventId);
    }

    function shouldActivateZeroTimeForScript(scriptText) {
        if (!isFreezeSettingActive() || !scriptText) {
            return false;
        }
        for (const trigger of zeroTimeScriptTriggers) {
            if (scriptText.includes(trigger)) {
                return true;
            }
        }
        return false;
    }

    function getFullScriptText(interpreter) {
        if (!interpreter || !Array.isArray(interpreter._list)) {
            return '';
        }
        let scriptText = '';
        let idx = interpreter._index;
        let expecting655 = false;
        while (idx < interpreter._list.length) {
            const command = interpreter._list[idx];
            if (!command) {
                break;
            }
            const code = command.code;
            if (!expecting655 && code !== 355) {
                break;
            }
            if (expecting655 && code !== 655) {
                break;
            }
            const line = command.parameters[0];
            if (typeof line === 'string') {
                scriptText += line;
            }
            scriptText += '\n';
            idx += 1;
            if (!expecting655) {
                expecting655 = true;
            }
        }
        return scriptText.trim();
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

    function describeInterpreter(interpreter) {
        if (!interpreter) {
            return 'none';
        }
        const parts = [];
        if (typeof interpreter._eventId !== 'undefined') {
            parts.push(`event:${interpreter._eventId ?? 'null'}`);
        }
        if (typeof interpreter._mapId !== 'undefined') {
            parts.push(`map:${interpreter._mapId ?? 'null'}`);
        }
        if (typeof interpreter._commonEventId !== 'undefined') {
            parts.push(`common:${interpreter._commonEventId ?? 'null'}`);
        }
        parts.push(`index:${interpreter._index ?? 'n/a'}`);
        parts.push(`depth:${interpreterStack.length}`);
        return parts.join(', ');
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
            freezeDebugLog(`Snapshot stored for var ${varId} -> ${frozenValues[varId]}`);
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
            if (isWatchedVariable(varId)) {
                freezeDebugLog(
                    `Restoring var ${varId} back to ${restoreValue} after interpreter ${describeInterpreter(
                        interpreter
                    )}`
                );
            }
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

    function usesDoorBattler(troopId) {
        if (!Number.isFinite(troopId) || troopId <= 0) {
            return false;
        }
        if (doorTroopDetectionCache.has(troopId)) {
            return doorTroopDetectionCache.get(troopId);
        }
        if (
            !Array.isArray(window.$dataTroops) ||
            !Array.isArray(window.$dataEnemies)
        ) {
            return false;
        }
        const troop = $dataTroops[troopId];
        let result = false;
        if (troop && Array.isArray(troop.members)) {
            result = troop.members.some(member => {
                const enemyId = Number(member?.enemyId);
                if (!Number.isFinite(enemyId)) {
                    return false;
                }
                const enemy = $dataEnemies[enemyId];
                if (!enemy || typeof enemy.battlerName !== 'string') {
                    return false;
                }
                return enemy.battlerName.startsWith(doorBattlerPrefix);
            });
        }
        doorTroopDetectionCache.set(troopId, result);
        return result;
    }

    function logDoorTroopDetection(troopId, reason) {
        freezeDebugLog(`Door encounter detection: troop ${troopId} -> ${reason}`);
    }

    function isKnownDoorTroop(troopId) {
        if (!Number.isFinite(troopId) || troopId <= 0) {
            return false;
        }
        if (explicitDoorTroopIds.has(troopId)) {
            logDoorTroopDetection(troopId, 'explicitly registered');
            return true;
        }
        if (troopId >= 200 && explicitDoorTroopIds.has(troopId - 200)) {
            logDoorTroopDetection(troopId, 'explicit cursed variant of registered troop');
            return true;
        }
        if (usesDoorBattler(troopId)) {
            logDoorTroopDetection(troopId, 'battler name matches DoorEncs/');
            return true;
        }
        if (troopId >= 200 && usesDoorBattler(troopId - 200)) {
            logDoorTroopDetection(troopId, 'cursed variant battler match');
            return true;
        }
        return false;
    }

    function matchesActiveDoorEncounter(troopId) {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        const activeId = Number($gameVariables.value(51));
        if (!Number.isFinite(activeId) || activeId <= 0) {
            return false;
        }
        if (activeId === troopId) {
            logDoorTroopDetection(troopId, `matches active encounter id ${activeId}`);
            return true;
        }
        if (activeId >= 200 && activeId - 200 === troopId) {
            logDoorTroopDetection(
                troopId,
                `matches active cursed encounter id ${activeId} -> ${activeId - 200}`
            );
            return true;
        }
        if (troopId >= 200 && troopId - 200 === activeId) {
            logDoorTroopDetection(
                troopId,
                `is cursed variant of active encounter id ${activeId}`
            );
            return true;
        }
        return false;
    }

    function shouldApplyDoorBattleZeroTime(troopId) {
        if (!isFreezeSettingActive()) {
            freezeDebugLog(
                `Door zero-time skipped for troop ${troopId}: freeze setting disabled.`
            );
            return false;
        }
        if (!Number.isFinite(troopId) || troopId <= 0) {
            freezeDebugLog(`Door zero-time skipped for invalid troop id ${troopId}.`);
            return false;
        }
        if (matchesActiveDoorEncounter(troopId)) {
            freezeDebugLog(`Troop ${troopId} tagged as door encounter via active encounter.`);
            return true;
        }
        if (isKnownDoorTroop(troopId)) {
            return true;
        }
        freezeDebugLog(`Troop ${troopId} not recognized as door encounter.`);
        return false;
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
            freezeDebugLog(`Detection flagged variable ${varId} as time-related (capturing ${numericPrev}).`);
            return {
                newlyDetected: true,
                captureValue: numericPrev
            };
        }
        return null;
    }

    freezeDebugLog(
        `Debug instrumentation ready. Tracking variables: ${Array.from(trackedVariableIds)
            .sort((a, b) => a - b)
            .join(', ')}`
    );

    CabbyCodes.override(
        Game_Variables.prototype,
        'value',
        function(variableId) {
            const numericId = Number(variableId);
            if (shouldReturnFrozenValue(numericId)) {
                const owner = getOwningInterpreter();
                freezeDebugLog(
                    `value(${numericId}) -> frozen ${frozenValues[numericId]} (zeroTime=${isZeroTimeInterpreter(
                        owner
                    )}, interpreter=${describeInterpreter(owner)})`
                );
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
            const watchedVar = isWatchedVariable(numericId);
            if (watchedVar) {
                const owner = getOwningInterpreter();
                freezeDebugLog(
                    `setValue(${numericId}) requested -> ${value} (prev=${previousValue}, tracked=${trackedVariableIds.has(
                        numericId
                    )}, enforce=${canEnforceTimeLock()}, zeroTime=${isZeroTimeInterpreter(owner)}, interpreter=${describeInterpreter(
                        owner
                    )})`
                );
            }

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

            const thawEstablished = tryEstablishTemporaryThaw(numericId, previousValue);
            if (watchedVar) {
                freezeDebugLog(
                    `Tracked write to var ${numericId} ${thawEstablished ? 'allowed temporarily' : 'blocked'}`
                );
            }
            if (thawEstablished) {
                return callOriginal(Game_Variables.prototype, 'setValue', this, [
                    variableId,
                    value
                ]);
            }

            if (watchedVar) {
                freezeDebugLog(
                    `Suppressed update to var ${numericId}; frozen value remains ${frozenValues[numericId]}`
                );
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
        'command355',
        function() {
            const scriptText = getFullScriptText(this);
            if (shouldActivateZeroTimeForScript(scriptText)) {
                this._cabbycodesZeroTimeActive = true;
            }
            return callOriginal(Game_Interpreter.prototype, 'command355', this, [
                ...arguments
            ]);
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
            freezeDebugLog(
                `command122(start=${parameters?.[0]}, end=${parameters?.[1]}, op=${parameters?.[2]}, operandType=${parameters?.[3]}, operand=${parameters?.[4]}) on interpreter ${describeInterpreter(
                    this
                )} (zeroTime=${zeroTimeActive})`
            );
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
                freezeDebugLog(
                    `Restored variable 19 to ${minutesBefore} after zero-time command122 (interpreter ${describeInterpreter(
                        this
                    )}).`
                );
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
                    const watchedVar = isWatchedVariable(propNum);
                    if (watchedVar) {
                        freezeDebugLog(
                            `[Proxy] set raw var ${propNum} -> ${value} (prev=${previousValue}, enforce=${canEnforceTimeLock()})`
                        );
                    }
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
                        const thaw = tryEstablishTemporaryThaw(propNum, previousValue);
                        if (watchedVar) {
                            freezeDebugLog(
                                `[Proxy] ${thaw ? 'allowing' : 'blocking'} raw var ${propNum} update`
                            );
                        }
                        if (thaw) {
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

    CabbyCodes.after(BattleManager, 'setup', function(troopId) {
        if (typeof $gameTroop === 'undefined' || !$gameTroop) {
            return;
        }
        if (shouldApplyDoorBattleZeroTime(Number(troopId))) {
            $gameTroop._cabbycodesDoorZeroTime = true;
            freezeDebugLog(`Marked troop ${troopId} for zero-time battle handling.`);
        } else {
            delete $gameTroop._cabbycodesDoorZeroTime;
            freezeDebugLog(`Troop ${troopId} will not use door zero-time handling.`);
        }
    });

    CabbyCodes.before(Game_Troop.prototype, 'setupBattleEvent', function() {
        if (!this._cabbycodesDoorZeroTime || !isFreezeSettingActive()) {
            return;
        }
        if (this._interpreter) {
            this._interpreter._cabbycodesZeroTimeActive = true;
            freezeDebugLog(
                `Activated zero-time interpreter for troop ${this._troopId ?? 'unknown'}.`
            );
        }
    });

    CabbyCodes.after(Game_Event.prototype, 'start', function() {
        if (!isFreezeSettingActive()) {
            return;
        }
        if (!isFrontDoorEventInstance(this)) {
            return;
        }
        const tickets = Number(this._cabbycodesDoorZeroTimeTickets || 0) + 1;
        this._cabbycodesDoorZeroTimeTickets = tickets;
        activateDoorZeroTime(`Front door event ${this.eventId()} started (tickets=${tickets})`);
    });

    CabbyCodes.after(Game_Event.prototype, 'unlock', function() {
        const tickets = Number(this._cabbycodesDoorZeroTimeTickets || 0);
        if (tickets <= 0) {
            return;
        }
        this._cabbycodesDoorZeroTimeTickets = tickets - 1;
        deactivateDoorZeroTime(
            `Front door event ${this.eventId()} unlocked (remaining=${this._cabbycodesDoorZeroTimeTickets})`
        );
    });

    CabbyCodes.after(Game_Switches.prototype, 'setValue', function(switchId, value) {
        if (switchId === doorKnockSwitchId && !value && doorZeroTimeDepth > 0) {
            doorZeroTimeDepth = 0;
            freezeDebugLog('Door knock switch cleared; door zero-time state reset.');
        }
    });
})();



