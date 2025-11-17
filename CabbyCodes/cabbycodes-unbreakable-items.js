//=============================================================================
// CabbyCodes Unbreakable Items
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Unbreakable Items - Prevents durability loss
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that prevents weapons (and other fragile gear)
 * from taking durability damage during combat or from special abilities.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Unbreakable Items requires CabbyCodes core.');
        return;
    }

    const settingKey = 'unbreakableItems';

    CabbyCodes.registerSetting(
        settingKey,
        'Unbreakable Items',
        {
            defaultValue: false,
            order: 58
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Unbreakable items ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Attempts to invoke a global helper function (provided by the base game
     * scripts) while guarding against missing references.
     * @param {string} functionName
     * @param {Array<*>} args
     */
    function tryInvoke(functionName, args = []) {
        const fn = window[functionName];
        if (typeof fn !== 'function') {
            return;
        }
        try {
            fn.apply(window, args);
        } catch (error) {
            CabbyCodes.warn(
                `[CabbyCodes] Failed to call ${functionName}(): ${error?.message || error}`
            );
        }
    }

    /**
     * Restores switches and variables that the original durabilityCheck()
     * touches so downstream event logic stays in sync even when the check is
     * suppressed.
     */
    function resetDurabilityState() {
        tryInvoke('sSw', [14, false]); // Clear the "primed" durability roll flag.
        tryInvoke('sSw', [1, false]);
        tryInvoke('sSw', [2, false]);
        tryInvoke('sVr', [145, 0]); // Reset the last durability result.
    }

    /**
     * Retrieves and executes the original implementation stored by the patching
     * system.
     * @param {Object} target
     * @param {string} functionName
     * @param {Object} context
     * @param {Array} args
     * @returns {*}
     */
    function callOriginal(target, functionName, context, args) {
        const originals = target._cabbycodesOriginals;
        if (originals && typeof originals[functionName] === 'function') {
            return originals[functionName].apply(context, args);
        }
        return undefined;
    }

    if (typeof window.durabilityCheck !== 'function') {
        CabbyCodes.warn(
            '[CabbyCodes] Unbreakable Items could not find durabilityCheck(); no changes applied.'
        );
        return;
    }

    CabbyCodes.override(
        window,
        'durabilityCheck',
        function(...args) {
            if (!isFeatureEnabled()) {
                return callOriginal(window, 'durabilityCheck', this, args);
            }

            resetDurabilityState();
            return undefined;
        }
    );

    CabbyCodes.log('[CabbyCodes] Unbreakable Items module loaded');
})();


