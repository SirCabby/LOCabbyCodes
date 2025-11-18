//=============================================================================
// CabbyCodes Refill Status
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Refill Status - One-press HP/MP + needs refill
 * @author CabbyCodes
 * @help
 * Adds a "Refill Status" press-style option to the CabbyCodes section of the
 * Options menu. Selecting it instantly restores every party member to full HP
 * and MP (if they are below their current maximums) and tops off all hidden
 * need meters such as hunger, energy, hygiene, morale, calm, social, and the
 * breath-odor tracker.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Refill Status requires the core module.');
        return;
    }

    const settingKey = 'refillStatus';
    const HIDDEN_NEED_VARIABLES = [
        { id: 21, maxValue: 100, label: 'Social' },
        { id: 22, maxValue: 100, label: 'Calm' },
        { id: 23, maxValue: 100, label: 'Energy' },
        { id: 24, maxValue: 100, label: 'Hunger' },
        { id: 25, maxValue: 100, label: 'Hygiene' },
        { id: 26, maxValue: 100, label: 'Morale' },
        { id: 117, maxValue: 100, targetValue: 0, label: 'Breath Odor' }
    ];
    const MAX_VALUE_FALLBACK = 100;
    const REFILL_TOLERANCE = 1e-4;

    CabbyCodes.registerSetting(settingKey, 'Refill Status', {
        defaultValue: false,
        order: 1,
        formatValue: () => 'Press',
        onChange: newValue => {
            if (!newValue) {
                return;
            }
            try {
                const partyResult = refillPartyMembers();
                const needsUpdated = refillHiddenNeeds();
                CabbyCodes.log(
                    `[CabbyCodes] Refill Status applied: HP restored on ${partyResult.hpRestored} actors, MP restored on ${partyResult.mpRestored} actors, ${needsUpdated} hidden needs maxed.`
                );
            } catch (error) {
                CabbyCodes.error(
                    `[CabbyCodes] Refill Status failed: ${error?.message || error}`
                );
            } finally {
                CabbyCodes.setSetting(settingKey, false);
            }
        }
    });

    /**
     * Retrieves the current playable party members.
     * @returns {Game_Actor[]}
     */
    function getPartyMembers() {
        if (typeof $gameParty === 'undefined' || !$gameParty) {
            return [];
        }
        if (typeof $gameParty.allMembers === 'function') {
            return $gameParty.allMembers().filter(Boolean);
        }
        if (typeof $gameParty.members === 'function') {
            return $gameParty.members().filter(Boolean);
        }
        return [];
    }

    /**
     * Restores HP/MP for every party member currently below max.
     * @returns {{hpRestored: number, mpRestored: number}}
     */
    function refillPartyMembers() {
        const members = getPartyMembers();
        let hpRestored = 0;
        let mpRestored = 0;
        for (const actor of members) {
            if (!isGameActor(actor)) {
                continue;
            }
            if (shouldRestoreHp(actor)) {
                actor.setHp(actor.mhp);
                hpRestored += 1;
            }
            if (shouldRestoreMp(actor)) {
                actor.setMp(actor.mmp);
                mpRestored += 1;
            }
        }
        return { hpRestored, mpRestored };
    }

    /**
     * Sets all hidden need variables to their configured maximum.
     * @returns {number} How many variables were adjusted
     */
    function refillHiddenNeeds() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            CabbyCodes.warn('[CabbyCodes] Refill Status: $gameVariables unavailable.');
            return 0;
        }
        if (typeof $gameVariables.setValue !== 'function' || typeof $gameVariables.value !== 'function') {
            CabbyCodes.warn('[CabbyCodes] Refill Status: $gameVariables accessors missing.');
            return 0;
        }
        let updated = 0;
        for (const stat of HIDDEN_NEED_VARIABLES) {
            const targetValue = determineTargetValue(stat);
            const currentValue = toNumber($gameVariables.value(stat.id));
            if (shouldUpdateNeed(currentValue, targetValue)) {
                $gameVariables.setValue(stat.id, targetValue);
                updated += 1;
            }
        }
        return updated;
    }

    function isGameActor(actor) {
        return (
            actor &&
            typeof actor.isActor === 'function' &&
            actor.isActor() &&
            typeof actor.setHp === 'function' &&
            typeof actor.setMp === 'function'
        );
    }

    function shouldRestoreHp(actor) {
        const maxHp = toNumber(actor?.mhp);
        return maxHp > 0 && toNumber(actor?.hp) < maxHp;
    }

    function shouldRestoreMp(actor) {
        const maxMp = toNumber(actor?.mmp);
        return maxMp > 0 && toNumber(actor?.mp) < maxMp;
    }

    function toNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    function determineTargetValue(stat) {
        if (Number.isFinite(stat.targetValue)) {
            return stat.targetValue;
        }
        if (Number.isFinite(stat.maxValue)) {
            return stat.maxValue;
        }
        return MAX_VALUE_FALLBACK;
    }

    function shouldUpdateNeed(currentValue, targetValue) {
        if (!Number.isFinite(currentValue)) {
            return true;
        }
        return Math.abs(currentValue - targetValue) > REFILL_TOLERANCE;
    }

    CabbyCodes.log('[CabbyCodes] Refill Status module loaded');
})();


