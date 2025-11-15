//=============================================================================
// CabbyCodes Invincibility
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Invincibility - Prevent HP loss for party actors
 * @author CabbyCodes
 * @help
 * Adds an "Invincibility" toggle to the Options menu. When enabled, actors in
 * the player's party cannot lose HP from damage or instant-death effects.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Invincibility requires CabbyCodes core.');
        return;
    }

    const settingKey = 'invincibilityEnabled';

    CabbyCodes.registerSetting(
        settingKey,
        'Invincibility',
        false,
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Invincibility ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isInvincibilityActive = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Determines if the battler belongs to the player's party.
     * @param {Game_BattlerBase} battler
     * @returns {boolean}
     */
    function isProtectedActor(battler) {
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
        return false;
    }

    /**
     * Helper to determine whether an HP change should be prevented.
     * @param {Game_Battler} battler
     * @param {number} value
     * @returns {boolean}
     */
    function shouldPreventDamage(battler, value) {
        return isInvincibilityActive() && value < 0 && isProtectedActor(battler);
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
     * Ensures the battler has an action result object available.
     * @param {Game_Battler} battler
     */
    function ensureActionResult(battler) {
        if (!battler._result) {
            battler._result = new Game_ActionResult();
        }
    }

    CabbyCodes.override(
        Game_Battler.prototype,
        'gainHp',
        function(value) {
            if (shouldPreventDamage(this, value)) {
                ensureActionResult(this);
                this._result.hpDamage = 0;
                this._result.hpAffected = true;
                return;
            }
            return callOriginal(Game_Battler.prototype, 'gainHp', this, [value]);
        }
    );

    CabbyCodes.override(
        Game_BattlerBase.prototype,
        'setHp',
        function(hp) {
            if (isInvincibilityActive() && isProtectedActor(this)) {
                const safeHp = Math.max(hp, this.hp);
                return callOriginal(Game_BattlerBase.prototype, 'setHp', this, [safeHp]);
            }
            return callOriginal(Game_BattlerBase.prototype, 'setHp', this, [hp]);
        }
    );

    CabbyCodes.override(
        Game_BattlerBase.prototype,
        'die',
        function() {
            if (isInvincibilityActive() && isProtectedActor(this)) {
                ensureActionResult(this);
                this._result.hpDamage = 0;
                this._result.hpAffected = false;
                callOriginal(Game_BattlerBase.prototype, 'setHp', this, [Math.max(this.hp, 1)]);
                return;
            }
            return callOriginal(Game_BattlerBase.prototype, 'die', this, []);
        }
    );

    CabbyCodes.log('[CabbyCodes] Invincibility module loaded');
})();


