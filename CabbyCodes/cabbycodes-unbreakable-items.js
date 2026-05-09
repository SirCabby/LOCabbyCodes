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

    // Variable 162 stores the per-weapon-id attack count array used by
    // durabilityCheck() to compute the safeHits grace.
    const ATTACK_COUNT_VAR_ID = 162;

    CabbyCodes.registerSetting(
        settingKey,
        'Unbreakable Items',
        {
            defaultValue: false,
            order: 120
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

    /**
     * Mirrors the subject-resolution logic at the top of vanilla
     * durabilityCheck() so we can read the actor's currently equipped weapon
     * around the original call.
     * @returns {Object|null}
     */
    function resolveDurabilitySubject() {
        let subject = (typeof window.gVr === 'function') ? window.gVr(148) : null;
        if (!subject || subject === 0) {
            subject = window.BattleManager && window.BattleManager._lastSubject;
        }
        return subject || null;
    }

    function equippedWeaponId(subject) {
        const slot = subject && subject._equips && subject._equips[0];
        return (slot && slot._itemId) || 0;
    }

    /**
     * Vanilla durabilityCheck() captures `equip = subject._equips[0]` then
     * calls forceChangeEquip on break, which mutates the same Game_Item via
     * setObject(). The trailing `atkCntArray[equip._itemId] = attackCount`
     * therefore writes 0 into the *replacement* weapon's slot, leaving the
     * broken weapon ID's counter at its high value. A second instance of the
     * same weapon type then inherits that stale counter and breaks
     * immediately. After delegating to the original, detect a break by
     * comparing the equipped weapon ID before vs after, and zero the broken
     * ID's slot explicitly.
     */
    function resetBrokenWeaponSafeHits(preWeaponId, preSubject) {
        if (preWeaponId <= 0) {
            return;
        }
        try {
            const postSubject = preSubject || resolveDurabilitySubject();
            const postWeaponId = postSubject ? equippedWeaponId(postSubject) : 0;
            if (postWeaponId === preWeaponId) {
                return;
            }
            if (typeof window.gVr !== 'function' || typeof window.sVr !== 'function') {
                return;
            }
            const counts = window.gVr(ATTACK_COUNT_VAR_ID);
            if (!Array.isArray(counts) || preWeaponId >= counts.length) {
                return;
            }
            counts[preWeaponId] = 0;
            window.sVr(ATTACK_COUNT_VAR_ID, counts);
            CabbyCodes.log(
                `[CabbyCodes] Reset safe hits for broken weapon ${preWeaponId}`
            );
        } catch (error) {
            CabbyCodes.warn(
                `[CabbyCodes] Safe-hits reset failed: ${error?.message || error}`
            );
        }
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
            if (isFeatureEnabled()) {
                resetDurabilityState();
                return undefined;
            }
            const preSubject = resolveDurabilitySubject();
            const preWeaponId = preSubject ? equippedWeaponId(preSubject) : 0;
            const result = callOriginal(window, 'durabilityCheck', this, args);
            resetBrokenWeaponSafeHits(preWeaponId, preSubject);
            return result;
        }
    );

    CabbyCodes.log('[CabbyCodes] Unbreakable Items module loaded');
})();
