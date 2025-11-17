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
        {
            defaultValue: false,
            order: 56
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Infinite consumables ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Tracks every item id that is referenced by the built-in recipe metadata.
     * Crafting stations consume those ingredients even if the items themselves
     * are not flagged as `consumable`, so we treat them as protected when the
     * infinite consumables option is enabled.
     * @type {Set<number>}
     */
    const craftingIngredientIds = new Set();
    let craftingCacheBuilt = false;
    const recipeIngredientKeys = ['ing1', 'ing2', 'ing3', 'ing4', 'ing5'];

    /**
     * Parses the recipe items (IDs 551-600 in the base game) to discover which
     * ingredients they reference. We only need to do this once per session and
     * only after the database has finished loading.
     */
    function ensureCraftingIngredientCache() {
        if (craftingCacheBuilt) {
            return;
        }

        const items = window.$dataItems;
        if (!Array.isArray(items) || items.length === 0) {
            return;
        }

        let sawValidEntry = false;
        craftingIngredientIds.clear();

        for (const recipe of items) {
            if (!recipe || !recipe.meta) {
                continue;
            }
            sawValidEntry = true;

            for (const key of recipeIngredientKeys) {
                if (!Object.prototype.hasOwnProperty.call(recipe.meta, key)) {
                    continue;
                }
                const rawValue = recipe.meta[key];
                const ingredientId = Number(rawValue);
                if (Number.isFinite(ingredientId) && ingredientId > 0) {
                    craftingIngredientIds.add(ingredientId);
                }
            }
        }

        if (sawValidEntry) {
            craftingCacheBuilt = true;
            if (craftingIngredientIds.size > 0) {
                CabbyCodes.log(
                    `[CabbyCodes] Tracked ${craftingIngredientIds.size} crafting ingredients for infinite consumables`
                );
            }
        }
    }

    /**
     * Determines whether the provided RPG item should be treated as a crafting
     * ingredient for the purposes of the infinite consumables toggle.
     * @param {RPG.Item | RPG.Weapon | RPG.Armor} item
     * @returns {boolean}
     */
    function isCraftingIngredient(item) {
        ensureCraftingIngredientCache();
        if (!item || typeof item.id !== 'number') {
            return false;
        }
        return craftingIngredientIds.has(item.id);
    }

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
            const isRpgItem = DataManager.isItem(item);
            if (!isRpgItem) {
                return false;
            }

            return !!item.consumable || isCraftingIngredient(item);
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


