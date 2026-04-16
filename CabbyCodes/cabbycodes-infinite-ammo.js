//=============================================================================
// CabbyCodes Infinite Ammo
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Infinite Ammo - Keeps ranged weapons and ammo items full.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that prevents ranged weapons from spending
 * ammunition and blocks any ammo item costs (marbles, gas cans, special
 * magazines, etc.) while enabled. Guns stay fully loaded and any reload skill
 * simply swaps to the full variant without consuming items.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Infinite Ammo requires CabbyCodes core.');
        return;
    }

    const settingKey = 'infiniteAmmo';

    CabbyCodes.registerSetting(
        settingKey,
        'Infinite Ammo',
        {
            defaultValue: false,
            order: 76
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Infinite ammo ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    const ALWAYS_AMMO_ITEM_IDS = [162, 168, 203, 319];
    const DYNAMIC_AMMO_VARIABLE_ID = 938;
    const AMMO_META_KEYS = ['ammo', 'Ammo', 'ammoType', 'AmmoType'];

    const ammoItemKeys = new Set(
        ALWAYS_AMMO_ITEM_IDS.map(id => `item:${id}`)
    );
    let ammoItemCacheBuilt = false;

    function addAmmoItemId(itemId) {
        if (!Number.isFinite(itemId) || itemId <= 0) {
            return;
        }
        ammoItemKeys.add(`item:${itemId}`);
    }

    function ensureAmmoItemCache() {
        if (ammoItemCacheBuilt) {
            return;
        }
        const skills = window.$dataSkills;
        if (!Array.isArray(skills) || skills.length === 0) {
            return;
        }

        for (const skill of skills) {
            if (!skill || !skill.meta) {
                continue;
            }
            const withItemId = Number(skill.meta.WithItemId);
            if (Number.isFinite(withItemId) && withItemId > 0) {
                addAmmoItemId(withItemId);
            }

            const useItemId = Number(skill.meta.UseItemId);
            const ammoUse = Number(skill.meta.ammoUse);
            if (
                Number.isFinite(useItemId) &&
                useItemId > 0 &&
                Number.isFinite(ammoUse) &&
                ammoUse > 0
            ) {
                addAmmoItemId(useItemId);
            }
        }

        ammoItemCacheBuilt = true;
        if (typeof CabbyCodes.debug === 'function') {
            CabbyCodes.debug(
                `[CabbyCodes] Infinite ammo cached ${ammoItemKeys.size} ammo items`
            );
        }
    }

    function buildAmmoItemKey(item) {
        if (!item || typeof item.id !== 'number') {
            return null;
        }

        if (typeof DataManager !== 'undefined') {
            if (DataManager.isItem(item)) {
                return `item:${item.id}`;
            }
            if (DataManager.isWeapon(item)) {
                return `weapon:${item.id}`;
            }
            if (DataManager.isArmor(item)) {
                return `armor:${item.id}`;
            }
        }

        // Fallback: treat anything with an itypeId as an item
        if (typeof item.itypeId !== 'undefined') {
            return `item:${item.id}`;
        }

        return null;
    }

    function matchesDynamicAmmoVariable(item) {
        if (typeof window.gVr !== 'function') {
            return false;
        }
        const dynamicId = Number(window.gVr(DYNAMIC_AMMO_VARIABLE_ID));
        return Number.isFinite(dynamicId) && dynamicId > 0 && dynamicId === item.id;
    }

    function hasAmmoMeta(item) {
        if (!item || !item.meta) {
            return false;
        }
        return AMMO_META_KEYS.some(key => typeof item.meta[key] !== 'undefined');
    }

    function isAmmoItem(item) {
        if (!item) {
            return false;
        }

        ensureAmmoItemCache();
        const key = buildAmmoItemKey(item);
        if (!key) {
            return false;
        }

        if (ammoItemKeys.has(key)) {
            return true;
        }

        if (matchesDynamicAmmoVariable(item) || hasAmmoMeta(item)) {
            ammoItemKeys.add(key);
            return true;
        }

        return false;
    }

    function trackAmmoFromLastSkill() {
        if (
            typeof BattleManager === 'undefined' ||
            !Array.isArray(window.$dataSkills)
        ) {
            return;
        }

        const skillId = Number(BattleManager._lastSkill);
        if (!Number.isFinite(skillId) || skillId <= 0) {
            return;
        }
        const skill = $dataSkills[skillId];
        if (!skill || !skill.meta) {
            return;
        }

        let ammoItemId = Number(skill.meta.WithItemId);
        if (!Number.isFinite(ammoItemId) || ammoItemId <= 0) {
            return;
        }

        if (ammoItemId === 9999 && typeof window.gVr === 'function') {
            const dynamicId = Number(window.gVr(DYNAMIC_AMMO_VARIABLE_ID));
            if (Number.isFinite(dynamicId) && dynamicId > 0) {
                addAmmoItemId(dynamicId);
                return;
            }
        }

        addAmmoItemId(ammoItemId);
    }

    function getAmmoArray() {
        if (typeof window.gVr !== 'function') {
            return null;
        }
        const ammoArray = window.gVr(301);
        if (!Array.isArray(ammoArray)) {
            if (typeof window.ammoSetup === 'function') {
                try {
                    window.ammoSetup();
                } catch (err) {
                    CabbyCodes.warn(
                        `[CabbyCodes] ammoSetup failed while enabling infinite ammo: ${
                            err?.message || err
                        }`
                    );
                }
            }
            return window.gVr(301);
        }
        return ammoArray;
    }

    function ensureFullGunVariant(subject, currentArmor) {
        if (
            !subject ||
            !currentArmor ||
            !currentArmor.meta ||
            typeof subject.forceChangeEquip !== 'function'
        ) {
            return;
        }

        const baseId = Number(currentArmor.meta.emptyOb);
        if (!Number.isFinite(baseId)) {
            return;
        }

        let targetId = baseId + 1;
        if (typeof currentArmor.meta.bigburstNeed !== 'undefined') {
            targetId = baseId + 4;
        } else if (typeof currentArmor.meta.burstNeed !== 'undefined') {
            targetId = baseId + 3;
        } else {
            targetId = baseId + 2;
        }

        const targetArmor =
            Array.isArray(window.$dataArmors) && window.$dataArmors[targetId]
                ? window.$dataArmors[targetId]
                : null;

        if (!targetArmor) {
            return;
        }

        const equippedId = subject._equips?.[1]?._itemId;
        if (equippedId === targetId) {
            return;
        }

        subject.forceChangeEquip(1, targetArmor);
    }

    function refillEquippedGun(subject) {
        if (
            !subject ||
            !subject.isActor ||
            !subject.isActor() ||
            !subject._equips ||
            subject._equips.length < 2
        ) {
            return;
        }

        const slot = subject._equips[1];
        if (!slot || !slot._itemId) {
            return;
        }

        const armorData =
            Array.isArray(window.$dataArmors) && window.$dataArmors[slot._itemId]
                ? window.$dataArmors[slot._itemId]
                : null;
        if (!armorData || !armorData.meta) {
            return;
        }

        const meta = armorData.meta;
        const wpnIndex = Number(meta.wpnIndex);
        const ammoMax = Number(meta.maxAmmo);
        if (!Number.isFinite(wpnIndex) || wpnIndex < 0) {
            return;
        }
        if (!Number.isFinite(ammoMax) || ammoMax <= 0) {
            return;
        }

        const ammoArray = getAmmoArray();
        if (Array.isArray(ammoArray)) {
            ammoArray[wpnIndex] = ammoMax;
        }

        ensureFullGunVariant(subject, armorData);
    }

    if (typeof Game_Party !== 'undefined') {
        CabbyCodes.override(
            Game_Party.prototype,
            'gainItem',
            function(item, amount, includeEquip) {
                const normalizedAmount = typeof amount === 'number' ? amount : 0;

                if (
                    normalizedAmount < 0 &&
                    isFeatureEnabled() &&
                    isAmmoItem(item)
                ) {
                    return;
                }

                return CabbyCodes.callOriginal(
                    Game_Party.prototype,
                    'gainItem',
                    this,
                    Array.from(arguments)
                );
            }
        );
    }

    if (typeof window.reloadAmmo === 'function') {
        CabbyCodes.before(window, 'reloadAmmo', () => {
            trackAmmoFromLastSkill();
        });
    }

    if (typeof window.spendBullets === 'function') {
        CabbyCodes.override(
            window,
            'spendBullets',
            function(...args) {
                if (!isFeatureEnabled()) {
                    return CabbyCodes.callOriginal(window, 'spendBullets', this, args);
                }

                try {
                    const subject =
                        typeof BattleManager !== 'undefined'
                            ? BattleManager._lastSubject
                            : null;
                    if (subject && typeof subject.isActor === 'function' && subject.isActor()) {
                        refillEquippedGun(subject);
                    }
                } catch (err) {
                    CabbyCodes.warn(
                        `[CabbyCodes] Infinite ammo spendBullets override failed: ${
                            err?.message || err
                        }`
                    );
                }
            }
        );
    } else {
        CabbyCodes.warn(
            '[CabbyCodes] Infinite ammo could not hook spendBullets (function missing)'
        );
    }

    CabbyCodes.log('[CabbyCodes] Infinite ammo module loaded');
})();


