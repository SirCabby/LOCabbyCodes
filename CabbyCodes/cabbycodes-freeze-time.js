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
    const ZERO_TIME_WELLBEING_VARIABLE_IDS = new Set([
        21, // statSocial
        22, // statCalm
        23, // statVigor
        24, // statFood
        25, // statHygiene
        26, // statMorale
        117 // bad breath tracker used by hygiene logic
    ]);
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
    const parallelCommonEventId = 2;
    const videoGameCommonEventId = 12;
    const cookMealCommonEventId = 61;
    const cookPrepCommonEventId = 44;
    const changedRoomsCommonEventId = 11;
    const freezeTimeApi = (CabbyCodes.freezeTime = CabbyCodes.freezeTime || {});
    const debugSettingKey = 'freezeTimeDebugLogging';
    const ENABLE_FREEZE_TIME_DEBUG_LOGGING = false;
    const cabbyCodesSettings = CabbyCodes.settings || {};
    if (Object.prototype.hasOwnProperty.call(cabbyCodesSettings, debugSettingKey)) {
        delete cabbyCodesSettings[debugSettingKey];
        if (typeof CabbyCodes.saveSettings === 'function') {
            CabbyCodes.saveSettings();
        }
    }
    const timePassesCommonEventId = 4;
    const minuteBurnScopeCommonEventIds =
        freezeTimeApi.minuteBurnScopeCommonEventIds || new Set([videoGameCommonEventId]);
    freezeTimeApi.minuteBurnScopeCommonEventIds = minuteBurnScopeCommonEventIds;
    const defaultZeroTimeCommonEvents = [
        parallelCommonEventId, // Parallel (handles door timers etc)
        timePassesCommonEventId, // Time passes
        videoGameCommonEventId, // video game event
        16, // screenEffects (kitchen intro)
        cookPrepCommonEventId, // Cooking prep
        61, // eatCookedMeal
        68,
        69,
        145, // display / kitchen overlay
        changedRoomsCommonEventId // ChangedRooms (room transfer handler)
    ];
    const zeroTimeCommonEventIds =
        freezeTimeApi.zeroTimeCommonEventIds || new Set(defaultZeroTimeCommonEvents);
    defaultZeroTimeCommonEvents.forEach(id => zeroTimeCommonEventIds.add(id));
    freezeTimeApi.zeroTimeCommonEventIds = zeroTimeCommonEventIds;
    const zeroTimeCommonEventLists =
        freezeTimeApi.zeroTimeCommonEventLists || new WeakMap();
    freezeTimeApi.zeroTimeCommonEventLists = zeroTimeCommonEventLists;
    const zeroTimeMapEvents = freezeTimeApi.zeroTimeMapEvents || new Map();
    freezeTimeApi.zeroTimeMapEvents = zeroTimeMapEvents;
    const zeroTimeBattleTroopIds =
        freezeTimeApi.zeroTimeBattleTroopIds || new Set();
    freezeTimeApi.zeroTimeBattleTroopIds = zeroTimeBattleTroopIds;
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

    function applyVariableWriteInterceptors(varId, previousValue, pendingValue, context) {
        if (variableWriteInterceptors.length === 0) {
            return { blocked: false, value: pendingValue };
        }
        let adjustedValue = pendingValue;
        for (const handler of variableWriteInterceptors) {
            try {
                const result = handler(varId, previousValue, adjustedValue, context);
                if (result === false || (result && result.block === true)) {
                    return { blocked: true };
                }
                if (result && Object.prototype.hasOwnProperty.call(result, 'value')) {
                    adjustedValue = result.value;
                }
            } catch (error) {
                console.error('[CabbyCodes] Variable write interceptor error:', error);
            }
        }
        return { blocked: false, value: adjustedValue };
    }

    function zeroTimeMapEventKey(mapId, eventId) {
        return `${mapId}:${eventId}`;
    }

    function registerZeroTimeMapEvent(mapId, eventId, commonEventId = cookMealCommonEventId) {
        const numericMapId = Number(mapId);
        const numericEventId = Number(eventId);
        const numericCommonEventId = Number(commonEventId);
        if (
            !Number.isFinite(numericMapId) ||
            numericMapId <= 0 ||
            !Number.isFinite(numericEventId) ||
            numericEventId <= 0
        ) {
            return;
        }
        zeroTimeMapEvents.set(zeroTimeMapEventKey(numericMapId, numericEventId), numericCommonEventId);
    }

    freezeTimeApi.registerZeroTimeMapEvent = registerZeroTimeMapEvent;
    function registerZeroTimeBattleTroop(troopId) {
        const numericId = Number(troopId);
        if (!Number.isFinite(numericId) || numericId <= 0) {
            return;
        }
        if (!zeroTimeBattleTroopIds.has(numericId)) {
            zeroTimeBattleTroopIds.add(numericId);
            freezeDebugLog(`Registered troop ${numericId} for zero-time battle handling.`);
        }
    }

    freezeTimeApi.registerZeroTimeBattleTroop = registerZeroTimeBattleTroop;

    const frontDoorMapId = 3;
    const frontDoorEventId = 9;
    const doorKnockSwitchId = 24;

    registerZeroTimeMapEvent(frontDoorMapId, frontDoorEventId, timePassesCommonEventId);
    [21, 22, 46].forEach(eventId =>
        registerZeroTimeMapEvent(frontDoorMapId, eventId, cookMealCommonEventId)
    );
    registerZeroTimeMapEvent(4, 6, timePassesCommonEventId);
    registerZeroTimeMapEvent(4, 7, timePassesCommonEventId);
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

    function resolveCommonEventIdFromList(list) {
        if (!Array.isArray(list)) {
            return NaN;
        }
        const cachedId = zeroTimeCommonEventLists.get(list);
        if (Number.isFinite(cachedId)) {
            return cachedId;
        }
        if (!Array.isArray(window.$dataCommonEvents)) {
            return NaN;
        }
        for (const event of window.$dataCommonEvents) {
            if (event && Array.isArray(event.list)) {
                if (event.list === list) {
                    zeroTimeCommonEventLists.set(list, event.id);
                    return Number(event.id);
                }
                if (list.length > 0 && event.list.length > 0 && list.length === event.list.length) {
                    const firstCmd = list[0];
                    const eventFirstCmd = event.list[0];
                    if (firstCmd && eventFirstCmd && firstCmd.code === eventFirstCmd.code) {
                        zeroTimeCommonEventLists.set(list, event.id);
                        return Number(event.id);
                    }
                }
            }
        }
        return NaN;
    }

    function primeZeroTimeCommonEventList(commonEventId) {
        if (!Number.isFinite(commonEventId)) {
            return;
        }
        if (!Array.isArray(window.$dataCommonEvents)) {
            return;
        }
        const commonEvent = window.$dataCommonEvents[commonEventId];
        if (commonEvent && Array.isArray(commonEvent.list)) {
            zeroTimeCommonEventLists.set(commonEvent.list, commonEventId);
        }
    }

    zeroTimeCommonEventIds.forEach(primeZeroTimeCommonEventList);

    function markInterpreterZeroTimeFlag(interpreter, commonEventId, reason) {
        if (!interpreter) {
            return;
        }
        const numericId = Number(commonEventId);
        const shouldFlag =
            interpreter._cabbycodesZeroTimeActive ||
            (Number.isFinite(numericId) && zeroTimeCommonEventIds.has(numericId));
        if (!shouldFlag) {
            return;
        }
        interpreter._cabbycodesZeroTimeActive = true;
        if (Number.isFinite(numericId)) {
            interpreter._cabbycodesCommonEventId = numericId;
            if (minuteBurnScopeCommonEventIds.has(numericId)) {
                interpreter._cabbycodesMinuteBurnScope = true;
            }
        }
        if (reason) {
            freezeDebugLog(
                `Marked interpreter ${describeInterpreter(interpreter)} for zero-time (${reason}, event:${numericId})`
            );
        }
    }

    function tagInterpreterOwner(interpreter, mapId, eventId, eventName) {
        if (!interpreter) {
            return;
        }
        if (Number.isFinite(mapId)) {
            interpreter._cabbycodesOwnerMapId = mapId;
        }
        if (Number.isFinite(eventId)) {
            interpreter._cabbycodesOwnerEventId = eventId;
        }
        if (typeof eventName === 'string' && eventName.length > 0) {
            interpreter._cabbycodesOwnerEventName = eventName;
        }
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

    function isFreezeDebugEnabled() {
        return ENABLE_FREEZE_TIME_DEBUG_LOGGING;
    }

    function freezeDebugLog(message) {
        if (!isFreezeDebugEnabled()) {
            return;
        }
        CabbyCodes.log(`[CabbyCodes][FreezeTime] ${message}`);
    }

    freezeDebugLog(
        `Zero-time common events registered: ${Array.from(zeroTimeCommonEventIds)
            .sort((a, b) => a - b)
            .join(', ')}`
    );

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
                primeZeroTimeCommonEventList(numericId);
            }
        }
    };

    freezeTimeApi.registerMinuteBurnScopeEvent = function(eventId) {
        const numericId = Number(eventId);
        if (Number.isFinite(numericId) && numericId > 0 && !minuteBurnScopeCommonEventIds.has(numericId)) {
            minuteBurnScopeCommonEventIds.add(numericId);
            freezeDebugLog(`Registered common event ${numericId} for minute-burn scope inheritance.`);
        }
    };

    function findEventZeroTimeCommonEventId(gameEvent) {
        if (!isFreezeSettingActive() || !gameEvent || typeof gameEvent.list !== 'function') {
            return NaN;
        }
        const commands = gameEvent.list();
        if (!Array.isArray(commands)) {
            return NaN;
        }
        for (const command of commands) {
            if (command?.code === 117) {
                const candidateId = Number(command.parameters?.[0]);
                if (Number.isFinite(candidateId) && zeroTimeCommonEventIds.has(candidateId)) {
                    return candidateId;
                }
            }
        }
        return NaN;
    }

    function applyEventZeroTimeToInterpreter(gameEvent, reason) {
        if (!gameEvent || !gameEvent._interpreter) {
            return;
        }
        const eventId = Number(gameEvent._cabbycodesEventZeroTimeId);
        if (!Number.isFinite(eventId)) {
            return;
        }
        markInterpreterZeroTimeFlag(
            gameEvent._interpreter,
            eventId,
            `${reason} (event:${gameEvent.eventId?.() ?? gameEvent._eventId ?? 'unknown'})`
        );
    }

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
    registerZeroTimeBattleTroop(10);

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

    function isMinuteBurnScopeInterpreter(interpreter) {
        if (!interpreter) {
            return false;
        }
        if (interpreter._cabbycodesMinuteBurnScope) {
            return true;
        }
        const numericId = Number(interpreter._cabbycodesCommonEventId);
        return Number.isFinite(numericId) && minuteBurnScopeCommonEventIds.has(numericId);
    }

    function markZeroTimeChild(parentInterpreter, childInterpreter, commonEventId) {
        if (!childInterpreter) {
            return;
        }
        const inheritsZeroTime = isZeroTimeInterpreter(parentInterpreter);
        const zeroTimeActive = inheritsZeroTime || shouldApplyZeroTime(commonEventId);
        if (!zeroTimeActive) {
            return;
        }
        markInterpreterZeroTimeFlag(
            childInterpreter,
            Number.isFinite(commonEventId) ? Number(commonEventId) : NaN,
            'markZeroTimeChild'
        );
        if (!childInterpreter) {
            return;
        }
        if (
            isMinuteBurnScopeInterpreter(parentInterpreter) ||
            minuteBurnScopeCommonEventIds.has(Number(commonEventId))
        ) {
            childInterpreter._cabbycodesMinuteBurnScope = true;
        }
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

    const ZERO_TIME_RESTORE_MODES = {
        EXACT: 'exact',
        NON_DECREASE: 'nonDecrease'
    };

    function shouldSnapshotZeroTimeVariable(varId) {
        return ZERO_TIME_WELLBEING_VARIABLE_IDS.has(varId);
    }

    function snapshotZeroTimeVariable(varId, previousValue) {
        if (!shouldSnapshotZeroTimeVariable(varId) || !isFreezeEnabled()) {
            return;
        }
        const interpreter = getOwningInterpreter();
        if (!isZeroTimeInterpreter(interpreter)) {
            return;
        }
        const state = getInterpreterState(interpreter);
        if (!state) {
            return;
        }
        if (!state.variables.has(varId)) {
            const baseline = Number(previousValue);
            state.variables.set(varId, {
                baseline: Number.isFinite(baseline) ? baseline : 0,
                mode: ZERO_TIME_RESTORE_MODES.NON_DECREASE
            });
            freezeDebugLog(
                `Captured zero-time wellbeing var ${varId} baseline ${baseline} for ${describeInterpreter(
                    interpreter
                )}`
            );
        }
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
        const ownerEventId =
            typeof interpreter._eventId !== 'undefined'
                ? interpreter._eventId
                : interpreter._cabbycodesOwnerEventId;
        if (typeof ownerEventId !== 'undefined') {
            parts.push(`event:${ownerEventId ?? 'null'}`);
        }
        if (interpreter._cabbycodesOwnerEventName) {
            parts.push(`label:${interpreter._cabbycodesOwnerEventName}`);
        }
        const ownerMapId =
            typeof interpreter._mapId !== 'undefined'
                ? interpreter._mapId
                : interpreter._cabbycodesOwnerMapId;
        if (typeof ownerMapId !== 'undefined') {
            parts.push(`map:${ownerMapId ?? 'null'}`);
        }
        if (typeof interpreter._cabbycodesCommonEventId !== 'undefined') {
            parts.push(`common:${interpreter._cabbycodesCommonEventId ?? 'null'}`);
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
        state.variables.forEach((entry, varId) => {
            if (!Number.isFinite(varId)) {
                return;
            }
            let baselineValue = entry;
            let restoreMode = ZERO_TIME_RESTORE_MODES.EXACT;
            if (entry && typeof entry === 'object') {
                baselineValue = entry.baseline;
                restoreMode = entry.mode || ZERO_TIME_RESTORE_MODES.EXACT;
            }
            const restoreValue = Number.isFinite(baselineValue) ? baselineValue : 0;
            if (
                restoreMode === ZERO_TIME_RESTORE_MODES.NON_DECREASE &&
                typeof $gameVariables !== 'undefined' &&
                $gameVariables
            ) {
                const currentValue = getTrueOriginalValue($gameVariables, varId);
                if (Number.isFinite(currentValue) && currentValue >= restoreValue) {
                    return;
                }
            }
            const watchedVar = isWatchedVariable(varId);
            if (watchedVar) {
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
        if (zeroTimeBattleTroopIds.has(troopId)) {
            freezeDebugLog(`Troop ${troopId} tagged for zero-time via registry.`);
            return true;
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

    function enforceFrozenSnapshot(reason) {
        if (!canEnforceTimeLock()) {
            return false;
        }
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        let applied = 0;
        trackedVariableIds.forEach(varId => {
            if (!Object.prototype.hasOwnProperty.call(frozenValues, varId)) {
                return;
            }
            const targetValue = frozenValues[varId];
            const currentValue = getTrueOriginalValue($gameVariables, varId);
            if (Object.is(currentValue, targetValue)) {
                return;
            }
            try {
                callOriginal(Game_Variables.prototype, 'setValue', $gameVariables, [
                    varId,
                    targetValue
                ]);
                applied += 1;
            } catch (error) {
                console.error(
                    '[CabbyCodes] Failed to enforce frozen variable',
                    varId,
                    reason || 'unknown',
                    error
                );
            }
        });
        if (applied > 0) {
            freezeDebugLog(
                `Reapplied ${applied} frozen values${reason ? ` after ${reason}` : ''}.`
            );
        }
        return applied > 0;
    }

    function finalizeInterpreterSuspension(interpreter) {
        if (interpreter && interpreter._cabbycodesZeroTimeActive) {
            delete interpreter._cabbycodesZeroTimeActive;
        }
        if (interpreter && interpreter._cabbycodesMinuteBurnScope) {
            delete interpreter._cabbycodesMinuteBurnScope;
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

            snapshotZeroTimeVariable(numericId, previousValue);

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
            const commonEventId = Array.isArray(parameters) ? Number(parameters[0]) : NaN;
            freezeDebugLog(`command117 called with commonEventId=${commonEventId}, isZeroTime=${Number.isFinite(commonEventId) && zeroTimeCommonEventIds.has(commonEventId)}`);
            if (
                Number.isFinite(commonEventId) &&
                commonEventId === timePassesCommonEventId &&
                isMinuteBurnScopeInterpreter(this)
            ) {
                freezeDebugLog(
                    `command117: skipping timePasses common event ${commonEventId} for interpreter ${describeInterpreter(
                        this
                    )} (minute-burn scope).`
                );
                return true;
            }
            if (
                Number.isFinite(commonEventId) &&
                zeroTimeCommonEventIds.has(commonEventId) &&
                Array.isArray(window.$dataCommonEvents)
            ) {
                const commonEvent = window.$dataCommonEvents[commonEventId];
                if (commonEvent && Array.isArray(commonEvent.list)) {
                    zeroTimeCommonEventLists.set(commonEvent.list, commonEventId);
                    freezeDebugLog(`command117: primed list for common event ${commonEventId}`);
                }
            }
            if (Number.isFinite(commonEventId)) {
                this._cabbycodesPendingZeroTimeCommonEventId = commonEventId;
            }
            let result;
            try {
                result = callOriginal(Game_Interpreter.prototype, 'command117', this, [parameters]);
            } finally {
                this._cabbycodesPendingZeroTimeCommonEventId = undefined;
            }
            if (this._childInterpreter && Number.isFinite(commonEventId)) {
                freezeDebugLog(`command117: child interpreter created, marking with commonEventId ${commonEventId}`);
                markZeroTimeChild(this, this._childInterpreter, commonEventId);
            } else if (this._childInterpreter) {
                freezeDebugLog(`command117: child interpreter created but no valid commonEventId`);
            } else {
                freezeDebugLog(`command117: no child interpreter created yet`);
            }
            return result;
        }
    );

    CabbyCodes.override(
        Game_Interpreter.prototype,
        'setupChild',
        function(list, eventId) {
            let commonEventId = Number(this._cabbycodesPendingZeroTimeCommonEventId);
            this._cabbycodesPendingZeroTimeCommonEventId = undefined;
            freezeDebugLog(`setupChild called: pendingId=${commonEventId}, list.length=${Array.isArray(list) ? list.length : 'N/A'}`);
            if (!Number.isFinite(commonEventId) && typeof this.currentCommand === 'function') {
                const current = this.currentCommand();
                if (current && current.code === 117) {
                    commonEventId = Number(current.parameters?.[0]);
                    freezeDebugLog(`setupChild: extracted commonEventId ${commonEventId} from currentCommand`);
                }
            }
            if (!Number.isFinite(commonEventId)) {
                commonEventId = resolveCommonEventIdFromList(list);
                freezeDebugLog(`setupChild: resolved commonEventId ${commonEventId} from list`);
            }
            const result = callOriginal(Game_Interpreter.prototype, 'setupChild', this, [
                list,
                eventId
            ]);
            if (this._childInterpreter && Number.isFinite(commonEventId)) {
                freezeDebugLog(`setupChild: marking child interpreter with commonEventId ${commonEventId}`);
                markZeroTimeChild(this, this._childInterpreter, commonEventId);
            } else if (this._childInterpreter) {
                const fallbackId = resolveCommonEventIdFromList(list);
                freezeDebugLog(`setupChild: fallback marking child interpreter with resolvedId ${fallbackId}`);
                markInterpreterZeroTimeFlag(
                    this._childInterpreter,
                    fallbackId,
                    'setupChild-fallback'
                );
            } else {
                freezeDebugLog(`setupChild: no child interpreter created yet`);
            }
            return result;
        }
    );

    CabbyCodes.after(Game_Interpreter.prototype, 'setup', function(list, eventId) {
        const numericEventId = Number(eventId);
        this._cabbycodesOwnerEventId = Number.isFinite(numericEventId) ? numericEventId : 0;
        this._cabbycodesOwnerMapId = Number($gameMap?.mapId?.()) || this._mapId || 0;
        if (Number.isFinite(this._cabbycodesOwnerEventId) && this._cabbycodesOwnerEventId > 0) {
            const mapData = typeof $dataMap !== 'undefined' ? $dataMap : null;
            const eventData = mapData?.events?.[this._cabbycodesOwnerEventId];
            this._cabbycodesOwnerEventName =
                typeof eventData?.name === 'string' && eventData.name.length > 0
                    ? eventData.name
                    : undefined;
        } else {
            this._cabbycodesOwnerEventName = undefined;
        }

        if (!isFreezeSettingActive() || !Array.isArray(list)) {
            return;
        }
        const associatedId = resolveCommonEventIdFromList(list);
        if (!Number.isFinite(associatedId)) {
            return;
        }
        markInterpreterZeroTimeFlag(this, associatedId, 'interpreter.setup');
    });

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
                    const interceptorResult = applyVariableWriteInterceptors(
                        propNum,
                        previousValue,
                        value,
                        {
                            source: 'proxySet',
                            gameVariables: instance
                        }
                    );
                    if (interceptorResult.blocked) {
                        if (watchedVar) {
                            freezeDebugLog(`[Proxy] update to var ${propNum} blocked by interceptor.`);
                        }
                        return true;
                    }
                    value = interceptorResult.value;
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

                    snapshotZeroTimeVariable(propNum, previousValue);

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
                `Activated zero-time interpreter for troop ${this._troopId ?? 'unknown'} (pre-setup).`
            );
        }
    });

    CabbyCodes.after(Game_Troop.prototype, 'setupBattleEvent', function() {
        if (!this._cabbycodesDoorZeroTime || !isFreezeSettingActive()) {
            return;
        }
        if (this._interpreter) {
            this._interpreter._cabbycodesZeroTimeActive = true;
            freezeDebugLog(
                `Activated zero-time interpreter for troop ${this._troopId ?? 'unknown'} (post-setup).`
            );
        }
    });

    CabbyCodes.after(Game_Event.prototype, 'start', function() {
        if (!isFreezeSettingActive()) {
            return;
        }
        if (typeof $gameMap !== 'undefined' && $gameMap && $gameMap._interpreter) {
            tagInterpreterOwner(
                $gameMap._interpreter,
                this._mapId,
                this.eventId?.() ?? this._eventId,
                this.event?.().name
            );
        }
        if (isFrontDoorEventInstance(this)) {
            const tickets = Number(this._cabbycodesDoorZeroTimeTickets || 0) + 1;
            this._cabbycodesDoorZeroTimeTickets = tickets;
            activateDoorZeroTime(`Front door event ${this.eventId()} started (tickets=${tickets})`);
            if (this._interpreter) {
                this._interpreter._cabbycodesZeroTimeActive = true;
                freezeDebugLog(
                    `Marked front door interpreter (event:${this.eventId()}) for zero-time during start.`
                );
            }
        }

        const eventIdentifier = this.eventId?.() ?? this._eventId ?? 0;
        const forcedZeroTimeId = zeroTimeMapEvents.get(
            zeroTimeMapEventKey(this._mapId, eventIdentifier)
        );
        let eventZeroTimeId = findEventZeroTimeCommonEventId(this);
        if (!Number.isFinite(eventZeroTimeId) && Number.isFinite(forcedZeroTimeId)) {
            eventZeroTimeId = forcedZeroTimeId;
        }
        if (Number.isFinite(eventZeroTimeId)) {
            this._cabbycodesEventZeroTimeId = eventZeroTimeId;
            const eventLabel = eventIdentifier || 'unknown';
            freezeDebugLog(
                `Event ${eventLabel} flagged for zero-time (common event ${eventZeroTimeId}${
                    Number.isFinite(forcedZeroTimeId) ? ', registry' : ''
                }).`
            );
            if (typeof $gameMap !== 'undefined' && $gameMap && $gameMap._interpreter) {
                markInterpreterZeroTimeFlag(
                    $gameMap._interpreter,
                    eventZeroTimeId,
                    `event.start(pre-setup event:${eventLabel})`
                );
            }
        } else {
            this._cabbycodesEventZeroTimeId = undefined;
        }
    });

    CabbyCodes.after(Game_Event.prototype, 'unlock', function() {
        const tickets = Number(this._cabbycodesDoorZeroTimeTickets || 0);
        if (tickets > 0) {
            this._cabbycodesDoorZeroTimeTickets = tickets - 1;
            deactivateDoorZeroTime(
                `Front door event ${this.eventId()} unlocked (remaining=${this._cabbycodesDoorZeroTimeTickets})`
            );
        } else {
            this._cabbycodesDoorZeroTimeTickets = 0;
        }

        if (this._cabbycodesEventZeroTimeId) {
            freezeDebugLog(
                `Event ${this.eventId?.() ?? this._eventId ?? 'unknown'} cleared zero-time flag (unlock).`
            );
            this._cabbycodesEventZeroTimeId = undefined;
        }
    });

    CabbyCodes.after(Game_Map.prototype, 'setup', function(mapId) {
        let numericMapId = Number(mapId);
        if (!Number.isFinite(numericMapId) && this && typeof this.mapId === 'function') {
            numericMapId = Number(this.mapId());
        }
        const reason = Number.isFinite(numericMapId)
            ? `Game_Map.setup(${numericMapId})`
            : 'Game_Map.setup';
        enforceFrozenSnapshot(reason);
    });

    CabbyCodes.after(Game_Map.prototype, 'setupStartingMapEvent', function() {
        if (!isFreezeSettingActive()) {
            return;
        }
        const interpreter = this._interpreter;
        if (!interpreter || typeof interpreter.eventId !== 'function') {
            return;
        }
        const eventId = Number(interpreter.eventId());
        if (!Number.isFinite(eventId) || eventId <= 0) {
            return;
        }
        const gameEvent = this.event?.(eventId);
        if (!gameEvent) {
            return;
        }
        tagInterpreterOwner(interpreter, this.mapId(), eventId, gameEvent.event?.().name);
        if (!Number.isFinite(gameEvent._cabbycodesEventZeroTimeId)) {
            gameEvent._cabbycodesEventZeroTimeId = findEventZeroTimeCommonEventId(gameEvent);
        }
        if (Number.isFinite(gameEvent._cabbycodesEventZeroTimeId)) {
            markInterpreterZeroTimeFlag(
                interpreter,
                gameEvent._cabbycodesEventZeroTimeId,
                `map.setupStartingMapEvent(event:${eventId})`
            );
        }
    });

    CabbyCodes.after(Game_Map.prototype, 'setupStartingEvent', function() {
        if (!isFreezeSettingActive()) {
            return;
        }
        const interpreter = this._interpreter;
        if (!interpreter || isZeroTimeInterpreter(interpreter)) {
            return;
        }
        const list = interpreter._list;
        if (!Array.isArray(list)) {
            return;
        }
        let predictedId = NaN;
        if (typeof interpreter.eventId === 'function') {
            const eventId = Number(interpreter.eventId());
            if (Number.isFinite(eventId) && eventId > 0) {
                const event = this.event?.(eventId);
                if (event) {
                    tagInterpreterOwner(
                        interpreter,
                        this.mapId(),
                        eventId,
                        event.event?.().name || event.name
                    );
                }
                if (event && Number.isFinite(event._cabbycodesEventZeroTimeId)) {
                    predictedId = event._cabbycodesEventZeroTimeId;
                }
            }
        }
        if (!Number.isFinite(predictedId)) {
            predictedId = resolveCommonEventIdFromList(list);
        }
        if (Number.isFinite(predictedId)) {
            markInterpreterZeroTimeFlag(
                interpreter,
                predictedId,
                'map.setupStartingEvent(list)'
            );
        }
    });

    CabbyCodes.after(Game_Map.prototype, 'setupStartingMapEvent', function() {
        if (!isFreezeSettingActive()) {
            return;
        }
        if (!this._interpreter || typeof this._interpreter.eventId !== 'function') {
            return;
        }
        const eventId = Number(this._interpreter.eventId());
        if (!Number.isFinite(eventId) || eventId <= 0) {
            return;
        }
        const event = this.event?.(eventId);
        if (!event) {
            return;
        }
        if (!Number.isFinite(event._cabbycodesEventZeroTimeId)) {
            event._cabbycodesEventZeroTimeId = findEventZeroTimeCommonEventId(event);
        }
        if (Number.isFinite(event._cabbycodesEventZeroTimeId)) {
            markInterpreterZeroTimeFlag(
                this._interpreter,
                event._cabbycodesEventZeroTimeId,
                `map.setupStartingMapEvent(event:${eventId})`
            );
        }
    });

    CabbyCodes.after(Game_Switches.prototype, 'setValue', function(switchId, value) {
        if (switchId === doorKnockSwitchId && !value && doorZeroTimeDepth > 0) {
            doorZeroTimeDepth = 0;
            freezeDebugLog('Door knock switch cleared; door zero-time state reset.');
        }
    });
})();



