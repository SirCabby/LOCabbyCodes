//=============================================================================
// CabbyCodes Vanilla Bug Fix
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Vanilla Bug Fix - Patches base-game bugs
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that applies a bundle of small fixes for
 * bugs in the base game.
 *
 * Currently bundled:
 *   - Safe-hits reset on weapon break. Vanilla durabilityCheck() captures
 *     `equip = subject._equips[0]` then calls forceChangeEquip on break,
 *     which mutates the same Game_Item via setObject(). The trailing
 *     `atkCntArray[equip._itemId] = attackCount` therefore writes 0 into
 *     the *replacement* weapon's slot, leaving the broken weapon ID's
 *     counter at its high value. A second instance of the same weapon
 *     type then inherits that stale counter and breaks immediately.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Vanilla Bug Fix requires CabbyCodes core.');
        return;
    }

    const settingKey = 'vanillaBugFix';

    // Variable 162 stores the per-weapon-id attack count array used by
    // durabilityCheck() to compute the safeHits grace.
    const ATTACK_COUNT_VAR_ID = 162;

    CabbyCodes.registerSetting(
        settingKey,
        'Vanilla Bug Fix',
        {
            defaultValue: false,
            order: 121
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Vanilla bug fix ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

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
     * After delegating to the original, detect a break by comparing the
     * equipped weapon ID before vs after, and zero the broken ID's slot
     * explicitly so a fresh copy of the same weapon type starts at full
     * safe hits.
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
            '[CabbyCodes] Vanilla Bug Fix could not find durabilityCheck(); safe-hits reset not applied.'
        );
        return;
    }

    CabbyCodes.override(
        window,
        'durabilityCheck',
        function(...args) {
            if (!isFeatureEnabled()) {
                return CabbyCodes.callOriginal(window, 'durabilityCheck', this, args);
            }
            const preSubject = resolveDurabilitySubject();
            const preWeaponId = preSubject ? equippedWeaponId(preSubject) : 0;
            const result = CabbyCodes.callOriginal(window, 'durabilityCheck', this, args);
            resetBrokenWeaponSafeHits(preWeaponId, preSubject);
            return result;
        }
    );

    CabbyCodes.log('[CabbyCodes] Vanilla Bug Fix module loaded');
})();
