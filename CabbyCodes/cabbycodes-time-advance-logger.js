//=============================================================================
// CabbyCodes Time Advance Logger
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Time Advance Logger - Debug minutes/hour drift
 * @author CabbyCodes
 * @help
 * Adds an Options toggle that records whenever critical time-of-day variables
 * change. The log captures which event/common event adjusted the value, the
 * current map, and the interpreter command that initiated the change so we can
 * trace unexpected hour jumps when returning home.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes][TimeLogger] CabbyCodes core missing.');
        return;
    }

    const MODULE_TAG = '[CabbyCodes][TimeLogger]';
    const SETTING_KEY = 'logTimeAdvances';
    const trackedVariables = new Map([
        [16, { label: 'HourOfDay' }],
        [17, { label: 'MinuteOfHour' }],
        [18, { label: 'TravelFatigue' }],
        [19, { label: 'PendingMinutes' }],
        [21, { label: 'StatSocial' }],
        [22, { label: 'StatCalm' }],
        [23, { label: 'StatVigor' }],
        [24, { label: 'StatFood' }],
        [25, { label: 'StatHygiene' }],
        [26, { label: 'StatMorale' }],
        [47, { label: 'MinutesExploring' }],
        [112, { label: 'DoorDangerBonus' }],
        [122, { label: 'TimeBucket' }]
    ]);

    let loggingEnabled = CabbyCodes.getSetting(SETTING_KEY, false);

    CabbyCodes.registerSetting(SETTING_KEY, 'Log Time Advance Events', {
        defaultValue: false,
        order: 120,
        onChange: value => {
            loggingEnabled = Boolean(value);
            CabbyCodes.log(
                `${MODULE_TAG} ${loggingEnabled ? 'Enabled' : 'Disabled'}`
            );
        }
    });

    loggingEnabled = CabbyCodes.getSetting(SETTING_KEY, false);

    const freezeTimeApi = CabbyCodes.freezeTime;
    if (
        !freezeTimeApi ||
        typeof freezeTimeApi.registerVariableWriteInterceptor !== 'function'
    ) {
        CabbyCodes.warn(
            `${MODULE_TAG} Freeze Time module not found; time logging disabled.`
        );
        return;
    }

    const interpreterStack = [];
    const listToCommonEventId = new WeakMap();
    let nextContextId = 1;

    function pushInterpreter(interpreter) {
        interpreterStack.push(interpreter);
    }

    function popInterpreter(expected) {
        if (interpreterStack.length === 0) {
            return;
        }
        const popped = interpreterStack.pop();
        if (popped !== expected) {
            interpreterStack.length = 0;
        }
    }

    function getActiveInterpreter() {
        for (let i = interpreterStack.length - 1; i >= 0; i -= 1) {
            const interpreter = interpreterStack[i];
            if (interpreter) {
                return interpreter;
            }
        }
        return null;
    }

    function resolveCommonEventIdFromList(list) {
        if (!Array.isArray(list)) {
            return NaN;
        }
        const cachedId = listToCommonEventId.get(list);
        if (Number.isFinite(cachedId)) {
            return cachedId;
        }
        if (!Array.isArray(window.$dataCommonEvents)) {
            return NaN;
        }
        for (const event of window.$dataCommonEvents) {
            if (event && event.list === list) {
                listToCommonEventId.set(list, Number(event.id));
                return Number(event.id);
            }
        }
        return NaN;
    }

    function currentMapId() {
        if (typeof $gameMap !== 'undefined' && $gameMap && typeof $gameMap.mapId === 'function') {
            return Number($gameMap.mapId());
        }
        return NaN;
    }

    function currentMapName(mapId) {
        if (!Number.isFinite(mapId)) {
            return null;
        }
        if (
            typeof $dataMap !== 'undefined' &&
            $dataMap &&
            Number(currentMapId()) === mapId &&
            typeof $dataMap.displayName === 'string' &&
            $dataMap.displayName.length > 0
        ) {
            return $dataMap.displayName;
        }
        return null;
    }

    function describeMapEvent(eventId) {
        if (
            !Number.isFinite(eventId) ||
            eventId <= 0 ||
            typeof $dataMap === 'undefined' ||
            !$dataMap ||
            !Array.isArray($dataMap.events)
        ) {
            return null;
        }
        const event = $dataMap.events[eventId];
        if (!event) {
            return null;
        }
        return typeof event.name === 'string' && event.name.length > 0
            ? event.name
            : null;
    }

    function describeCommonEvent(commonEventId) {
        if (
            !Number.isFinite(commonEventId) ||
            commonEventId <= 0 ||
            !Array.isArray(window.$dataCommonEvents)
        ) {
            return null;
        }
        const event = window.$dataCommonEvents[commonEventId];
        if (!event) {
            return null;
        }
        return typeof event.name === 'string' && event.name.length > 0
            ? event.name
            : null;
    }

    function buildInterpreterContext(interpreter, list, eventId, parentContext) {
        const context = {
            id: nextContextId++,
            mapId: currentMapId(),
            mapName: null,
            type: 'unknown'
        };

        if (Number.isFinite(context.mapId)) {
            context.mapName = currentMapName(context.mapId);
        } else if (parentContext && Number.isFinite(parentContext.mapId)) {
            context.mapId = parentContext.mapId;
            context.mapName = parentContext.mapName;
        }

        const numericEventId = Number(eventId);
        if (Number.isFinite(numericEventId) && numericEventId > 0) {
            context.type = 'mapEvent';
            context.eventId = numericEventId;
            context.eventName = describeMapEvent(numericEventId) || parentContext?.eventName || null;
        } else {
            const commonEventId = resolveCommonEventIdFromList(list);
            if (Number.isFinite(commonEventId) && commonEventId > 0) {
                context.type = 'commonEvent';
                context.commonEventId = commonEventId;
                context.commonEventName =
                    describeCommonEvent(commonEventId) ||
                    parentContext?.commonEventName ||
                    null;
            } else if (parentContext) {
                context.type = parentContext.type;
                context.eventId = parentContext.eventId;
                context.eventName = parentContext.eventName;
                context.commonEventId = parentContext.commonEventId;
                context.commonEventName = parentContext.commonEventName;
            }
        }

        interpreter._cabbycodesTimeLoggerContext = context;
        return context;
    }

    function wrapMethod(target, methodName, factory) {
        if (!target || typeof target[methodName] !== 'function') {
            CabbyCodes.warn(
                `${MODULE_TAG} Cannot wrap ${methodName} (missing function)`
            );
            return;
        }
        const original = target[methodName];
        const wrapped = factory(original);
        if (typeof wrapped === 'function') {
            target[methodName] = wrapped;
        }
    }

    wrapMethod(Game_Interpreter.prototype, 'setup', original => {
        return function(list, eventId) {
            const result = original.apply(this, arguments);
            buildInterpreterContext(this, list, eventId, null);
            return result;
        };
    });

    wrapMethod(Game_Interpreter.prototype, 'setupChild', original => {
        return function(list, eventId) {
            const result = original.apply(this, arguments);
            if (this._childInterpreter) {
                const parentContext = this._cabbycodesTimeLoggerContext || null;
                buildInterpreterContext(
                    this._childInterpreter,
                    list,
                    eventId,
                    parentContext
                );
            }
            return result;
        };
    });

    wrapMethod(Game_Interpreter.prototype, 'update', original => {
        return function() {
            pushInterpreter(this);
            try {
                return original.apply(this, arguments);
            } finally {
                popInterpreter(this);
            }
        };
    });

    function describeInterpreter(interpreter) {
        if (!interpreter) {
            return null;
        }
        const context = interpreter._cabbycodesTimeLoggerContext;
        if (!context) {
            return null;
        }
        const parts = [];
        if (context.type === 'mapEvent') {
            parts.push(
                `Event ${context.eventId ?? 'unknown'}${
                    context.eventName ? ` "${context.eventName}"` : ''
                }`
            );
        } else if (context.type === 'commonEvent') {
            parts.push(
                `CommonEvent ${context.commonEventId ?? 'unknown'}${
                    context.commonEventName ? ` "${context.commonEventName}"` : ''
                }`
            );
        } else {
            parts.push('Interpreter');
        }
        if (Number.isFinite(context.mapId)) {
            parts.push(
                `map ${context.mapId}${
                    context.mapName ? ` (${context.mapName})` : ''
                }`
            );
        }
        return parts.join(' | ');
    }

    function describeCommand(interpreter) {
        if (!interpreter || typeof interpreter.currentCommand !== 'function') {
            return null;
        }
        const command = interpreter.currentCommand();
        if (!command) {
            return null;
        }
        let snippet = '';
        if (Array.isArray(command.parameters) && command.parameters.length > 0) {
            try {
                snippet = JSON.stringify(command.parameters);
            } catch (error) {
                snippet = '[unserializable]';
            }
            if (snippet.length > 80) {
                snippet = `${snippet.slice(0, 77)}...`;
            }
        }
        return `cmd ${command.code}${snippet ? ` params=${snippet}` : ''}`;
    }

    function describeScene() {
        if (typeof SceneManager === 'undefined' || !SceneManager._scene) {
            return null;
        }
        const ctor = SceneManager._scene.constructor;
        if (!ctor || !ctor.name) {
            return null;
        }
        return `scene=${ctor.name}`;
    }

    function normalizeNumeric(value) {
        const number = Number(value);
        if (Number.isFinite(number)) {
            return number;
        }
        return null;
    }

    function formatValue(value) {
        if (value === null || typeof value === 'undefined') {
            return 'n/a';
        }
        return String(value);
    }

    function formatDelta(delta) {
        if (delta === null) {
            return '';
        }
        const prefix = delta > 0 ? '+' : '';
        return `${prefix}${delta}`;
    }

    function logVariableChange(varId, previousValue, pendingValue, interceptorContext) {
        if (!loggingEnabled || !trackedVariables.has(varId)) {
            return;
        }
        const prevNumeric = normalizeNumeric(previousValue);
        const nextNumeric = normalizeNumeric(pendingValue);
        if (
            prevNumeric !== null &&
            nextNumeric !== null &&
            Object.is(prevNumeric, nextNumeric)
        ) {
            return;
        }
        const metadata = trackedVariables.get(varId);
        const interpreter = getActiveInterpreter();
        const interpreterDesc = describeInterpreter(interpreter);
        const commandDesc = describeCommand(interpreter);
        const sceneDesc = interpreterDesc ? null : describeScene();
        const atHomeSwitch =
            typeof $gameSwitches !== 'undefined' &&
            $gameSwitches &&
            typeof $gameSwitches.value === 'function'
                ? $gameSwitches.value(63)
                : null;
        const mapId = currentMapId();
        const mapName = currentMapName(mapId);
        const delta =
            prevNumeric !== null && nextNumeric !== null
                ? nextNumeric - prevNumeric
                : null;
        const prevDisplay =
            prevNumeric !== null ? prevNumeric : formatValue(previousValue);
        const nextDisplay =
            nextNumeric !== null ? nextNumeric : formatValue(pendingValue);

        const segments = [
            `${MODULE_TAG} ${metadata.label || `Variable ${varId}`}: ${prevDisplay} -> ${nextDisplay}${
                delta !== null ? ` (${formatDelta(delta)})` : ''
            }`
        ];
        if (interpreterDesc) {
            segments.push(interpreterDesc);
        } else if (sceneDesc) {
            segments.push(sceneDesc);
        } else if (interceptorContext?.source) {
            segments.push(`source=${interceptorContext.source}`);
        }
        if (commandDesc) {
            segments.push(commandDesc);
        }
        if (Number.isFinite(mapId)) {
            segments.push(
                `currentMap=${mapId}${mapName ? ` (${mapName})` : ''}`
            );
        }
        if (typeof atHomeSwitch === 'boolean') {
            segments.push(`switch63=${atHomeSwitch ? 'ON' : 'OFF'}`);
        }
        if (
            typeof $gameVariables !== 'undefined' &&
            $gameVariables &&
            typeof $gameVariables.value === 'function' &&
            varId !== 19
        ) {
            const pendingMinutes = $gameVariables.value(19);
            if (Number.isFinite(pendingMinutes)) {
                segments.push(`pendingMinutes=${pendingMinutes}`);
            }
        }
        CabbyCodes.log(segments.join(' | '));
    }

    freezeTimeApi.registerVariableWriteInterceptor(
        (varId, previousValue, pendingValue, context) => {
            if (!loggingEnabled) {
                return;
            }
            logVariableChange(Number(varId), previousValue, pendingValue, context);
        }
    );

    CabbyCodes.log(`${MODULE_TAG} initialized`);
})();




