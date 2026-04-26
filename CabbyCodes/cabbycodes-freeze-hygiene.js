//=============================================================================
// CabbyCodes Freeze Hygiene
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Freeze Hygiene - Prevent personal need stats from decreasing
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that stops the hidden personal need meters from
 * worsening. Hygiene, hunger, vigor, morale, social, and calm are prevented
 * from decreasing; the bad-breath counter (var 117, where higher is worse) is
 * prevented from increasing. Positive sources such as eating, resting, or
 * brushing teeth still work.
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
    // IDs where a *higher* value is the worsening direction. For these we
    // block increases instead of decreases (e.g. the Sleeping common event
    // adds 1 to var 117 each night — that's the change we need to catch).
    const INVERTED_STAT_IDS = new Set([
        117 // bad breath: 0 = fresh, 100 = rancid
    ]);
    const settingKey = 'freezeHygiene';
    const FLOAT_TOLERANCE = 1e-4;

    CabbyCodes.registerSetting(
        settingKey,
        'Freeze Needs / Hygiene',
        {
            defaultValue: false,
            order: 145
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
     * Determines whether the next value represents a worsening change that
     * should be blocked. For most protected stats that means a decrease; for
     * inverted stats (currently just var 117 / bad breath) it means an
     * increase.
     * @param {number} variableId
     * @param {*} previousValue
     * @param {*} pendingValue
     * @returns {boolean}
     */
    function shouldBlockStatWorsening(variableId, previousValue, pendingValue) {
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

        if (INVERTED_STAT_IDS.has(numericId)) {
            return next > current + FLOAT_TOLERANCE;
        }
        return next + FLOAT_TOLERANCE < current;
    }

    /**
     * Determines whether the incoming value change should be blocked via setValue.
     * @param {number} variableId
     * @param {*} rawValue
     * @returns {boolean}
     */
    function shouldPreventWorsening(variableId, rawValue) {
        const numericId = Number(variableId);
        if (!Number.isFinite(numericId)) {
            return false;
        }

        const currentValue =
            typeof this.value === 'function' ? this.value(numericId) : 0;

        return shouldBlockStatWorsening(numericId, currentValue, rawValue);
    }

    const freezeTimeApi = CabbyCodes.freezeTime;
    if (freezeTimeApi && typeof freezeTimeApi.registerVariableWriteInterceptor === 'function') {
        freezeTimeApi.registerVariableWriteInterceptor((variableId, previousValue, pendingValue) => {
            if (shouldBlockStatWorsening(variableId, previousValue, pendingValue)) {
                return { block: true };
            }
            return undefined;
        });
    }

    CabbyCodes.override(
        Game_Variables.prototype,
        'setValue',
        function(variableId, value) {
            if (shouldPreventWorsening.call(this, variableId, value)) {
                return;
            }

            return callOriginal(Game_Variables.prototype, 'setValue', this, [
                variableId,
                value
            ]);
        }
    );

    // Also patch operateVariable to catch the worsening direction for each
    // protected stat (Sub for normal stats, Add for inverted stats like
    // var 117). Belt-and-suspenders with the setValue interceptor above.
    if (typeof Game_Interpreter !== 'undefined' && Game_Interpreter.prototype.operateVariable) {
        CabbyCodes.override(
            Game_Interpreter.prototype,
            'operateVariable',
            function(variableId, operationType, value) {
                if (isFeatureEnabled()) {
                    const numericId = Number(variableId);
                    if (Number.isFinite(numericId) && PROTECTED_VARIABLE_IDS.has(numericId)) {
                        const oldValue = $gameVariables.value(numericId);
                        let pendingValue = oldValue;
                        switch (operationType) {
                            case 0: pendingValue = value; break;              // Set
                            case 1: pendingValue = oldValue + value; break;   // Add
                            case 2: pendingValue = oldValue - value; break;   // Sub
                            case 3: pendingValue = oldValue * value; break;   // Mul
                            case 4: pendingValue = oldValue / value; break;   // Div
                            case 5: pendingValue = oldValue % value; break;   // Mod
                            default: pendingValue = oldValue; break;
                        }
                        if (shouldBlockStatWorsening(numericId, oldValue, pendingValue)) {
                            return;
                        }
                    }
                }

                return callOriginal(Game_Interpreter.prototype, 'operateVariable', this, [
                    variableId,
                    operationType,
                    value
                ]);
            }
        );
    }

    CabbyCodes.log('[CabbyCodes] Freeze Hygiene module loaded');
})();


