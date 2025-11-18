//=============================================================================
// CabbyCodes Freeze Hygiene
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Freeze Hygiene - Prevent personal need stats from decreasing
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that stops the hidden personal need meters from
 * dropping. Hygiene, hunger, vigor, morale, social, and calm (along with the
 * separate bad-breath counter) are all prevented from decreasing while the
 * toggle is enabled, but positive sources such as eating or resting still work.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Freeze Hygiene requires CabbyCodes core.');
        return;
    }

    const PROTECTED_VARIABLE_IDS = new Set([
        21, // statSocial (prevents Lonely)
        22, // statCalm  (covers stress-related events)
        23, // statVigor (prevents Tired / Exhausted)
        24, // statFood  (prevents Hungry / Starving)
        25, // statHygiene
        26, // statMorale (prevents Depressed)
        117 // bad breath tracker
    ]);
    const settingKey = 'freezeHygiene';
    const FLOAT_TOLERANCE = 1e-4;

    CabbyCodes.registerSetting(
        settingKey,
        'Freeze Needs / Hygiene',
        {
            defaultValue: false,
            order: 57
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Personal need decay ${newValue ? 'frozen' : 'restored'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Safely invokes the original implementation that was overridden.
     * Uses CabbyCodes.callOriginal if available for proper chaining support.
     * @param {Object} targetPrototype
     * @param {string} functionName
     * @param {Object} context
     * @param {Array} args
     * @returns {*}
     */
    function callOriginal(targetPrototype, functionName, context, args) {
        // Use CabbyCodes.callOriginal if available (supports chained overrides)
        if (typeof CabbyCodes.callOriginal === 'function') {
            return CabbyCodes.callOriginal(targetPrototype, functionName, context, args);
        }
        // Fallback to manual lookup
        const originals = targetPrototype._cabbycodesOriginals;
        if (originals && typeof originals[functionName] === 'function') {
            return originals[functionName].apply(context, args);
        }
        return undefined;
    }

    function normalizeValue(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    /**
     * Determines whether the next value represents a decrease that should be blocked.
     * @param {number} variableId
     * @param {*} previousValue
     * @param {*} pendingValue
     * @returns {boolean}
     */
    function shouldBlockStatDecrease(variableId, previousValue, pendingValue) {
        if (!isFeatureEnabled()) {
            return false;
        }

        const numericId = Number(variableId);
        if (!Number.isFinite(numericId) || !PROTECTED_VARIABLE_IDS.has(numericId)) {
            return false;
        }

        const current = normalizeValue(previousValue);
        const next = normalizeValue(pendingValue);

        if (current === null || next === null) {
            return false;
        }

        return next + FLOAT_TOLERANCE < current;
    }

    /**
     * Determines whether the incoming value change should be blocked via setValue.
     * @param {number} variableId
     * @param {*} rawValue
     * @returns {boolean}
     */
    function shouldPreventDecrease(variableId, rawValue) {
        const numericId = Number(variableId);
        if (!Number.isFinite(numericId)) {
            return false;
        }

        const currentValue =
            typeof this.value === 'function' ? this.value(numericId) : 0;

        return shouldBlockStatDecrease(numericId, currentValue, rawValue);
    }

    const freezeTimeApi = CabbyCodes.freezeTime;
    if (freezeTimeApi && typeof freezeTimeApi.registerVariableWriteInterceptor === 'function') {
        freezeTimeApi.registerVariableWriteInterceptor((variableId, previousValue, pendingValue) => {
            if (shouldBlockStatDecrease(variableId, previousValue, pendingValue)) {
                return { block: true };
            }
            return undefined;
        });
    }

    CabbyCodes.override(
        Game_Variables.prototype,
        'setValue',
        function(variableId, value) {
            if (shouldPreventDecrease.call(this, variableId, value)) {
                return;
            }

            return callOriginal(Game_Variables.prototype, 'setValue', this, [
                variableId,
                value
            ]);
        }
    );

    CabbyCodes.log('[CabbyCodes] Freeze Hygiene module loaded');
})();


