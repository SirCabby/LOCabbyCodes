//=============================================================================
// CabbyCodes Infinite Items
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Infinite Items - Prevents item loss
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that keeps item counts from decreasing.
 * Items can still be gained normally, but using them, handing them to
 * visitors, or otherwise spending them no longer reduces the party
 * inventory while the toggle is enabled. Weapons and armor are not
 * affected by this toggle.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Infinite Items requires CabbyCodes core.');
        return;
    }

    const settingKey = 'infiniteConsumables';

    CabbyCodes.registerSetting(
        settingKey,
        'Infinite Items',
        {
            defaultValue: false,
            order: 70
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Infinite items ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Determines whether the provided item is one of the temporary
     * gamemode selector tokens that the base game injects into the
     * inventory during the new-game difficulty picker.
     * Those items use the WD_ItemUse "gamemode" meta tag and should
     * never be protected by the infinite items toggle so that
     * the scripted cleanup can always remove them.
     * @param {RPG.Item | RPG.Weapon | RPG.Armor} item
     * @returns {boolean}
     */
    function isGamemodeSelectorItem(item) {
        if (!item || !item.meta) {
            return false;
        }

        const rawTag = item.meta.WD_Items;
        if (!rawTag) {
            return false;
        }

        const normalize = value => {
            if (Array.isArray(value)) {
                return value;
            }
            if (typeof value === 'string') {
                return [value];
            }
            return [];
        };

        const tags = normalize(rawTag);
        return tags.some(tag => {
            if (typeof tag !== 'string') {
                return false;
            }
            return tag.trim().toLowerCase() === 'gamemode';
        });
    }

    /**
     * Determines whether the provided item should be protected from
     * decreasing counts while the infinite items toggle is on.
     * @param {RPG.Item | RPG.Weapon | RPG.Armor} item
     * @returns {boolean}
     */
    function isProtectedItem(item) {
        if (!isFeatureEnabled()) {
            return false;
        }
        if (!item || typeof DataManager === 'undefined' || !DataManager) {
            return false;
        }
        try {
            if (!DataManager.isItem(item)) {
                return false;
            }
            if (isGamemodeSelectorItem(item)) {
                return false;
            }
            return true;
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

            if (normalizedAmount < 0 && isProtectedItem(item)) {
                return;
            }

            return callOriginal(Game_Party.prototype, 'gainItem', this, [
                item,
                amount,
                includeEquip
            ]);
        }
    );

    CabbyCodes.log('[CabbyCodes] Infinite Items module loaded');
})();


