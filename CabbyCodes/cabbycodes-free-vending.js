//=============================================================================
// CabbyCodes Free Vending Machines
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Free Vending Machines - Skip coin costs for vending machines.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that drops the price of vending machines to zero.
 * When enabled, vending interactions immediately jump to the purchase phase and
 * never demand coins.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Free Vending Machines requires CabbyCodes core.');
        return;
    }

    const settingKey = 'freeVendingMachines';
    const COST_VARIABLE_ID = 229;
    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);
    const callOriginal = (target, functionName, context, args) => {
        const originals = target._cabbycodesOriginals;
        if (originals && typeof originals[functionName] === 'function') {
            return originals[functionName].apply(context, args);
        }
        return undefined;
    };

    CabbyCodes.registerSetting(
        settingKey,
        'Free Vending Machines',
        false,
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Free vending machines ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    CabbyCodes.override(
        Game_Variables.prototype,
        'setValue',
        function(variableId, value) {
            let nextValue = value;

            if (variableId === COST_VARIABLE_ID && isFeatureEnabled()) {
                nextValue = 0;
            }

            return callOriginal(Game_Variables.prototype, 'setValue', this, [
                variableId,
                nextValue
            ]);
        }
    );

    CabbyCodes.log('[CabbyCodes] Free Vending Machines module loaded');
})();


