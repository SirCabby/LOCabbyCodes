//=============================================================================
// CabbyCodes Freeze Hygiene
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Freeze Hygiene - Prevent hygiene from decreasing
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that stops the hygiene variable from dropping.
 * Any increases (showering, brushing teeth, items, etc.) still apply normally,
 * but hourly decay or scripted penalties no longer reduce hygiene while the
 * toggle is enabled.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Freeze Hygiene requires CabbyCodes core.');
        return;
    }

    const PROTECTED_VARIABLE_IDS = new Set([25, 117]); // Hygiene & bad breath
    const settingKey = 'freezeHygiene';

    CabbyCodes.registerSetting(
        settingKey,
        'Freeze Hygiene Decay',
        false,
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Hygiene decay ${newValue ? 'frozen' : 'restored'}`
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

    /**
     * Determines whether the incoming value change should be blocked.
     * @param {number} variableId
     * @param {*} rawValue
     * @returns {boolean}
     */
    function shouldPreventDecrease(variableId, rawValue) {
        if (!isFeatureEnabled()) {
            return false;
        }

        if (!PROTECTED_VARIABLE_IDS.has(variableId)) {
            return false;
        }

        if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) {
            return false;
        }

        const currentValue =
            typeof this.value === 'function' ? this.value(variableId) : 0;
        const pendingValue = Math.floor(rawValue);

        return pendingValue < currentValue;
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


