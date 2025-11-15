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
    const defaultTimeVariableIds = [];
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
        trackedVariableIds.forEach(varId => {
            if (typeof $gameVariables !== 'undefined' && $gameVariables) {
                frozenValues[varId] = getTrueOriginalValue($gameVariables, varId);
            }
        });
    }

    CabbyCodes.registerSetting(settingKey, 'Freeze Time of Day', {
        defaultValue: false,
        order: 60,
        onChange: newValue => {
            if (newValue) {
                freezeActivatedAt = nowMs();
                setTimeout(() => captureFrozenValues(), 0);
            } else {
                freezeActivatedAt = 0;
                trackedVariableIds.forEach(varId => {
                    delete frozenValues[varId];
                });
            }
        }
    });

    function shouldBlock(variableId) {
        if (!CabbyCodes.getSetting(settingKey, false)) {
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
            return originalValue.call(instance, variableId);
        };
    })();

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
            if (
                shouldBlock(variableId) &&
                Object.prototype.hasOwnProperty.call(frozenValues, numericId)
            ) {
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

            if (Number.isFinite(numericId) && CabbyCodes.getSetting(settingKey, false)) {
                const detectionResult = detectTimeVariableCandidate(numericId, previousValue, value);
                if (detectionResult?.newlyDetected) {
                    addTimeVariableId(numericId);
                    if (!Object.prototype.hasOwnProperty.call(frozenValues, numericId)) {
                        frozenValues[numericId] = detectionResult.captureValue;
                    }
                    return;
                }
            }

            const shouldPrevent = (() => {
                if (!CabbyCodes.getSetting(settingKey, false)) {
                    return false;
                }
                if (!Number.isFinite(numericId)) {
                    return false;
                }
                return trackedVariableIds.has(numericId);
            })();

            if (shouldPrevent) {
                if (!Object.prototype.hasOwnProperty.call(frozenValues, numericId)) {
                    const currentValue = Number.isFinite(previousValue)
                        ? previousValue
                        : getTrueOriginalValue(this, numericId);
                    frozenValues[numericId] = currentValue;
                }
                return;
            }

            return callOriginal(Game_Variables.prototype, 'setValue', this, [
                variableId,
                value
            ]);
        }
    );

    function wrapDataWithProxy(instance) {
        if (!instance._data || instance._cabbycodesDataProxy) {
            return;
        }
        const originalData = instance._data;
        instance._data = new Proxy(originalData, {
            set(target, property, value) {
                const propNum = Number(property);
                if (
                    Number.isFinite(propNum) &&
                    CabbyCodes.getSetting(settingKey, false) &&
                    !trackedVariableIds.has(propNum)
                ) {
                    const detectionResult = detectTimeVariableCandidate(propNum, target[property], value);
                    if (detectionResult?.newlyDetected) {
                        addTimeVariableId(propNum);
                        if (!Object.prototype.hasOwnProperty.call(frozenValues, propNum)) {
                            frozenValues[propNum] = detectionResult.captureValue;
                        }
                        return true;
                    }
                }
                if (Number.isFinite(propNum) && shouldBlock(propNum)) {
                    if (!Object.prototype.hasOwnProperty.call(frozenValues, propNum)) {
                        const currentValue = target[property];
                        frozenValues[propNum] =
                            currentValue !== undefined && currentValue !== null ? currentValue : 0;
                    }
                    return true;
                }
                return Reflect.set(target, property, value);
            },
            get(target, property) {
                const propNum = Number(property);
                if (
                    Number.isFinite(propNum) &&
                    shouldBlock(propNum) &&
                    Object.prototype.hasOwnProperty.call(frozenValues, propNum)
                ) {
                    return frozenValues[propNum];
                }
                return Reflect.get(target, property);
            }
        });
        instance._cabbycodesDataProxy = true;
    }

    const originalInitialize = Game_Variables.prototype.initialize;
    Game_Variables.prototype.initialize = function() {
        originalInitialize.call(this);
        wrapDataWithProxy(this);
    };

    const originalClear = Game_Variables.prototype.clear;
    Game_Variables.prototype.clear = function() {
        originalClear.call(this);
        wrapDataWithProxy(this);
    };

    if (typeof $gameVariables !== 'undefined' && $gameVariables) {
        wrapDataWithProxy($gameVariables);
    }
})();



