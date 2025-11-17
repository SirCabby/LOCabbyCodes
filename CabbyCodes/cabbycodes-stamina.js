//=============================================================================
// CabbyCodes Stamina Control
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Stamina Control - Toggle stamina drain for party actors
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that prevents party actors from losing stamina
 * (MP) when using skills or from other stamina-draining effects.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Stamina Control requires CabbyCodes core.');
        return;
    }

    const settingKey = 'disableStaminaDrain';

    CabbyCodes.registerSetting(
        settingKey,
        'Infinite Stamina',
        {
            defaultValue: false,
            order: 54
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Stamina drain ${newValue ? 'disabled' : 'enabled'}`
            );
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Determines whether the battler belongs to the player's party.
     * @param {Game_BattlerBase} battler
     * @returns {boolean}
     */
    function isPlayerActor(battler) {
        if (!battler || typeof battler.isActor !== 'function' || !battler.isActor()) {
            return false;
        }
        if (typeof $gameParty === 'undefined' || !$gameParty) {
            return false;
        }
        if (typeof $gameParty.allMembers === 'function') {
            return $gameParty.allMembers().includes(battler);
        }
        if (typeof $gameParty.members === 'function') {
            return $gameParty.members().includes(battler);
        }
        return true;
    }

    /**
     * Checks whether stamina drain should be prevented for the battler.
     * @param {Game_BattlerBase} battler
     * @returns {boolean}
     */
    function shouldPreventDrain(battler) {
        return isFeatureEnabled() && isPlayerActor(battler);
    }

    /**
     * Safely calls the original implementation stored by CabbyCodes.override().
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

    /**
     * Ensures the battler has an action result object.
     * @param {Game_Battler} battler
     */
    function ensureActionResult(battler) {
        if (!battler._result) {
            battler._result = new Game_ActionResult();
        }
    }

    function overridePaySkillCost(targetPrototype) {
        CabbyCodes.override(
            targetPrototype,
            'paySkillCost',
            function(skill) {
                const previousMp = this._mp;
                const result = callOriginal(targetPrototype, 'paySkillCost', this, [skill]);

                if (shouldPreventDrain(this)) {
                    this._mp = previousMp;
                }

                return result;
            }
        );
    }

    overridePaySkillCost(Game_BattlerBase.prototype);
    overridePaySkillCost(Game_Actor.prototype);

    CabbyCodes.override(
        Game_Battler.prototype,
        'gainMp',
        function(value) {
            if (shouldPreventDrain(this) && value < 0) {
                ensureActionResult(this);
                return callOriginal(Game_Battler.prototype, 'gainMp', this, [0]);
            }
            return callOriginal(Game_Battler.prototype, 'gainMp', this, [value]);
        }
    );

    CabbyCodes.log('[CabbyCodes] Stamina Control module loaded');
})();


