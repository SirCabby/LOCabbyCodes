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
 * inventory while the toggle is enabled. Weapons, armor, and key items
 * are not affected by this toggle — key items are quest progression
 * currency and must be consumed for scripted events to advance.
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
            order: 110
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Infinite items ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    // Regular items (itypeId === 1) that the game treats as key-item-like:
    // given/taken by scripted events with counts that drive quest logic.
    // Protecting them breaks progression, so the Infinite Items toggle
    // must let their counts decrease normally.
    //
    // NOTE: narrower than the item-giver catalog exclusion on purpose —
    // Ice Melt Salt (286), Simple Key (320), Rat Tail (375), Worm Egg (382)
    // are collectibles the player wants refilled, so they stay protected.
    const PSEUDO_KEY_ITEM_IDS_UNPROTECTED = new Set([
        5,   // Rat Baby Thing
        41,  // Coffee — CE 6 newDay runs a "while Coffee in party, remove 1
             //   Coffee + add 1 Cold Coffee" loop (CommonEvents.json CE6
             //   cmd66-76). The loop exits on the in-party check, not a
             //   counter, so protecting Coffee makes newDay spin forever
             //   and hard-freeze the game the first time you sleep past
             //   midnight with a coffee in your inventory. Coffee is
             //   decremented nowhere else in the game data.
        128, // Marc-André (napping)
        170, // Roach — hitchhiker pest; must drain naturally. Max-all-items
             //   still tops it up because that path uses a positive delta.
        283, // Empty Lunchbox
        284, // Papineau's Lunch
        291, // Dog Tags
        354, // Eye
        359, // Cassette Tape
        361, // Four-Leaf Clover
        367, // Tickle's Gift
        372, // Tired Medic-in-a-Jar
        379, // Plumbing Tools
        381, // Potting Soil
        396, // Rebreather
        651, // green key
        652, // red key
        653, // yellow key
        654, // blue key
        655, // white key
        656  // black key
    ]);

    function hasWDItemsTag(item, tagName) {
        if (!item || !item.meta || !tagName) {
            return false;
        }
        const rawTag = item.meta.WD_Items;
        if (!rawTag) {
            return false;
        }
        const target = String(tagName).toLowerCase();
        const tags = Array.isArray(rawTag)
            ? rawTag
            : typeof rawTag === 'string'
                ? [rawTag]
                : [];
        return tags.some(tag => {
            if (typeof tag !== 'string') {
                return false;
            }
            return tag.trim().toLowerCase() === target;
        });
    }

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
        return hasWDItemsTag(item, 'gamemode');
    }

    // Planet / puzzle discs (<WD_Items: discObj>) are itypeId === 2 key
    // items but the disc-socket puzzle decrements them via gainItem(-1)
    // when inserted. Without protection, the Infinite Items toggle would
    // still let the inventory count drain — users expect collectible discs
    // to stay put. The socket state lives in variables 250–272, not the
    // inventory count, so protecting the discs does not break the puzzle.
    function isDiscObjItem(item) {
        return hasWDItemsTag(item, 'discobj');
    }

    /**
     * Determines whether the provided item should be protected from
     * decreasing counts while the infinite items toggle is on. Excludes
     * key items (itypeId === 2), the hidden gamemode selector tokens,
     * and a curated set of regular items that the game takes away by
     * event (PSEUDO_KEY_ITEM_IDS_UNPROTECTED) so quest scripting still
     * works. Planet / puzzle discs are re-included (despite being key
     * items) because they are inventory collectibles with no quest
     * counter semantics.
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
            if (isDiscObjItem(item)) {
                return true;
            }
            const typeId = Number(item.itypeId);
            if (Number.isFinite(typeId) && typeId === 2) {
                return false;
            }
            if (PSEUDO_KEY_ITEM_IDS_UNPROTECTED.has(item.id)) {
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

    // Counter so explicit user-driven edits (e.g. the item editor's delete /
    // decrease buttons) can bypass the protection without turning the feature
    // off. Uses a depth so nested bypasses work correctly.
    let bypassDepth = 0;
    CabbyCodes.infiniteConsumables = CabbyCodes.infiniteConsumables || {};
    CabbyCodes.infiniteConsumables.withBypass = function(fn) {
        if (typeof fn !== 'function') {
            return undefined;
        }
        bypassDepth++;
        try {
            return fn();
        } finally {
            bypassDepth--;
        }
    };

    CabbyCodes.override(
        Game_Party.prototype,
        'gainItem',
        function(item, amount, includeEquip) {
            const normalizedAmount = typeof amount === 'number' ? amount : 0;

            if (normalizedAmount < 0 && bypassDepth === 0 && isProtectedItem(item)) {
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


