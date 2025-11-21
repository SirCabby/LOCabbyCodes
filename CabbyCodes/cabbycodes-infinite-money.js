//=============================================================================
// CabbyCodes Infinite Money
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Infinite Money - Prevents party money from decreasing.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that blocks any reduction to the party's money.
 * Players can still earn money normally through events, loot, or shops, but
 * once enabled the total will never drop when spending.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Infinite Money requires CabbyCodes core.');
        return;
    }

    const settingKey = 'infiniteMoney';

    CabbyCodes.registerSetting(
        settingKey,
        'Infinite Money',
        {
            defaultValue: false,
            order: 80
        },
        newValue => {
            CabbyCodes.log(`[CabbyCodes] Infinite money ${newValue ? 'enabled' : 'disabled'}`);
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Retrieves the original implementation replaced by CabbyCodes.override and
     * invokes it safely.
     * @param {Object} targetPrototype
     * @param {string} functionName
     * @param {Object} context
     * @param {Array} args
     * @returns {*}
     */
    function callOriginal(targetPrototype, functionName, context, args) {
        const originals = targetPrototype._cabbycodesOriginals;
        if (originals && typeof originals[functionName] === 'function') {
            return originals[functionName].apply(context, args);
        }
        return undefined;
    }

    CabbyCodes.override(
        Game_Party.prototype,
        'gainGold',
        function(amount) {
            const normalizedAmount = typeof amount === 'number' ? amount : 0;

            if (isFeatureEnabled() && normalizedAmount < 0) {
                // Skip any deductions so the current money amount never decreases.
                return;
            }

            return callOriginal(Game_Party.prototype, 'gainGold', this, [amount]);
        }
    );

    CabbyCodes.log('[CabbyCodes] Infinite money patch loaded');
})();

