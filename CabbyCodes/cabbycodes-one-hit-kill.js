//=============================================================================
// CabbyCodes One Hit Kill
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes One Hit Kill - Any damage dealt to an enemy is lethal
 * @author CabbyCodes
 * @help
 * Adds a "One Hit Kill Enemies" toggle to the Options menu. When enabled, any
 * damage dealt to an enemy battler is amplified to be lethal. Party actors are
 * never affected by this cheat.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] One Hit Kill requires CabbyCodes core.');
        return;
    }

    const settingKey = 'oneHitKillEnemies';

    CabbyCodes.registerSetting(
        settingKey,
        'One Hit Kill Enemies',
        {
            defaultValue: false,
            order: 80
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] One Hit Kill Enemies ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isOneHitKillActive = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Determines if the battler is an enemy (and therefore not part of the
     * player's party).
     * @param {Game_BattlerBase} battler
     * @returns {boolean}
     */
    function isEnemyBattler(battler) {
        if (!battler || typeof battler.isEnemy !== 'function') {
            return false;
        }
        return battler.isEnemy();
    }

    CabbyCodes.override(
        Game_Battler.prototype,
        'gainHp',
        function(value) {
            if (isOneHitKillActive() && value < 0 && isEnemyBattler(this)) {
                const lethal = -Math.max(this.hp, 1);
                return CabbyCodes.callOriginal(
                    Game_Battler.prototype,
                    'gainHp',
                    this,
                    [lethal]
                );
            }
            return CabbyCodes.callOriginal(
                Game_Battler.prototype,
                'gainHp',
                this,
                [value]
            );
        }
    );

    CabbyCodes.log('[CabbyCodes] One Hit Kill module loaded');
})();
