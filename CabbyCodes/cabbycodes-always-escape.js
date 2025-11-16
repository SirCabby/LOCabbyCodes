//=============================================================================
// CabbyCodes Always Escape
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Always Escape - Forces battle escape attempts to succeed.
 * @author CabbyCodes
 * @help
 * Adds an "Always Escape Battles" option to the CabbyCodes section of the
 * Options menu. When enabled, choosing Escape during combat will always
 * succeed immediately, regardless of the normal escape ratio.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Always Escape requires CabbyCodes core.');
        return;
    }

    const settingKey = 'alwaysEscapeBattles';

    CabbyCodes.registerSetting(
        settingKey,
        'Always Escape Battles',
        {
            defaultValue: false,
            order: 52
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Always escape ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isCheatEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Calls the original BattleManager.processEscape implementation.
     * @param {BattleManager} context
     * @param {Array} args
     * @returns {*}
     */
    function callOriginalProcessEscape(context, args) {
        if (typeof CabbyCodes.callOriginal === 'function') {
            return CabbyCodes.callOriginal(BattleManager, 'processEscape', context, args);
        }
        const originals = BattleManager._cabbycodesOriginals;
        if (originals && typeof originals.processEscape === 'function') {
            return originals.processEscape.apply(context, args);
        }
        return undefined;
    }

    /**
     * Executes the steps required for a successful escape.
     * @param {BattleManager} manager
     */
    function performGuaranteedEscape(manager) {
        if ($gameParty && typeof $gameParty.performEscape === 'function') {
            $gameParty.performEscape();
        }
        if (typeof SoundManager !== 'undefined' && typeof SoundManager.playEscape === 'function') {
            SoundManager.playEscape();
        }
        if (typeof manager.onEscapeSuccess === 'function') {
            manager.onEscapeSuccess();
        }
    }

    CabbyCodes.override(
        BattleManager,
        'processEscape',
        function(...args) {
            if (!isCheatEnabled()) {
                return callOriginalProcessEscape(this, args);
            }

            try {
                performGuaranteedEscape(this);
            } catch (error) {
                CabbyCodes.error(
                    `[CabbyCodes] Always escape failed, falling back: ${error?.message || error}`
                );
                return callOriginalProcessEscape(this, args);
            }

            return true;
        }
    );

    CabbyCodes.log('[CabbyCodes] Always escape module loaded');
})();


