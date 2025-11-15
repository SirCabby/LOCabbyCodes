//=============================================================================
// CabbyCodes Infinite Consumables
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Infinite Consumables - Prevents consumable item loss
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that keeps consumable item counts from
 * decreasing. Items such as healing supplies, ammo, thrown weapons, and
 * cooking ingredients can still be gained normally, but using them no longer
 * reduces the party inventory while the toggle is enabled.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Infinite Consumables requires CabbyCodes core.');
        return;
    }

    const settingKey = 'infiniteConsumables';

    CabbyCodes.registerSetting(
        settingKey,
        'Infinite Consumables',
        false,
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Infinite consumables ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Determines whether the provided item is a consumable that should be
     * protected from decreasing counts.
     * @param {RPG.Item | RPG.Weapon | RPG.Armor} item
     * @returns {boolean}
     */
    function isProtectedConsumable(item) {
        if (!isFeatureEnabled()) {
            return false;
        }
        if (!item || typeof DataManager === 'undefined' || !DataManager) {
            return false;
        }
        try {
            return DataManager.isItem(item) && !!item.consumable;
        } catch (err) {
            CabbyCodes.warn(`[CabbyCodes] Failed to inspect item: ${err?.message || err}`);
            return false;
        }
    }

    /**
     * Retrieves the original implementation that was replaced by
     * CabbyCodes.override and invokes it safely.
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
        'gainItem',
        function(item, amount, includeEquip) {
            const normalizedAmount = typeof amount === 'number' ? amount : 0;

            if (normalizedAmount < 0 && isProtectedConsumable(item)) {
                // Skip the original logic so the inventory never decreases.
                return;
            }

            return callOriginal(Game_Party.prototype, 'gainItem', this, [
                item,
                amount,
                includeEquip
            ]);
        }
    );

    CabbyCodes.log('[CabbyCodes] Infinite Consumables module loaded');
})();


