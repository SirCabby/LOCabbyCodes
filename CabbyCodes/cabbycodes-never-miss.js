//=============================================================================
// CabbyCodes Never Miss
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Never Miss - Party attacks always land
 * @author CabbyCodes
 * @help
 * Adds a "Never Miss Attacks" toggle to the Options menu. When enabled, any
 * action taken by a party actor is guaranteed to hit: the physical/magical hit
 * roll is forced to 1.0 and the target's evasion (physical + magical) is
 * treated as 0. Enemy actions resolve normally.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Never Miss requires CabbyCodes core.');
        return;
    }

    const settingKey = 'neverMissAttacks';

    CabbyCodes.registerSetting(
        settingKey,
        'Never Miss Attacks',
        {
            defaultValue: false,
            order: 37
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Never Miss Attacks ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isNeverMissActive = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Determines if the battler is a party actor (so the cheat only buffs the
     * player's side and leaves enemy accuracy untouched).
     * @param {Game_BattlerBase} battler
     * @returns {boolean}
     */
    function isActorBattler(battler) {
        if (!battler || typeof battler.isActor !== 'function') {
            return false;
        }
        return battler.isActor();
    }

    CabbyCodes.override(
        Game_Action.prototype,
        'itemHit',
        function(target) {
            if (isNeverMissActive() && isActorBattler(this.subject())) {
                return 1;
            }
            return CabbyCodes.callOriginal(
                Game_Action.prototype,
                'itemHit',
                this,
                [target]
            );
        }
    );

    CabbyCodes.override(
        Game_Action.prototype,
        'itemEva',
        function(target) {
            if (isNeverMissActive() && isActorBattler(this.subject())) {
                return 0;
            }
            return CabbyCodes.callOriginal(
                Game_Action.prototype,
                'itemEva',
                this,
                [target]
            );
        }
    );

    CabbyCodes.log('[CabbyCodes] Never Miss module loaded');
})();
