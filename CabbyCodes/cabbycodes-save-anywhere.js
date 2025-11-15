//=============================================================================
// CabbyCodes Save Anywhere
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Save Anywhere - Allows saving anywhere regardless of game difficulty.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that allows saving anywhere in the game,
 * bypassing any difficulty-based save restrictions.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Save Anywhere requires CabbyCodes core.');
        return;
    }

    const settingKey = 'saveAnywhere';

    CabbyCodes.registerSetting(
        settingKey,
        'Save Anywhere',
        false,
        newValue => {
            CabbyCodes.log(`[CabbyCodes] Save anywhere ${newValue ? 'enabled' : 'disabled'}`);
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Override Game_System.isSaveEnabled to always return true when feature is enabled
     */
    CabbyCodes.override(
        Game_System.prototype,
        'isSaveEnabled',
        function() {
            if (isFeatureEnabled()) {
                return true;
            }
            // Call original implementation
            return CabbyCodes.callOriginal(Game_System.prototype, 'isSaveEnabled', this, []);
        }
    );

    /**
     * Override Window_SavefileList.isEnabled to always allow saving when feature is enabled
     */
    CabbyCodes.override(
        Window_SavefileList.prototype,
        'isEnabled',
        function(savefileId) {
            if (isFeatureEnabled() && this._mode === 'save') {
                // Always allow saving when feature is enabled
                return savefileId > 0;
            }
            // Call original implementation
            return CabbyCodes.callOriginal(Window_SavefileList.prototype, 'isEnabled', this, [savefileId]);
        }
    );

    /**
     * Override Window_MenuCommand.isSaveEnabled to always enable save menu option when feature is enabled
     */
    CabbyCodes.override(
        Window_MenuCommand.prototype,
        'isSaveEnabled',
        function() {
            if (isFeatureEnabled()) {
                // Always enable save menu option when feature is enabled
                return !DataManager.isEventTest();
            }
            // Call original implementation
            return CabbyCodes.callOriginal(Window_MenuCommand.prototype, 'isSaveEnabled', this, []);
        }
    );

    CabbyCodes.log('[CabbyCodes] Save anywhere patch loaded');
})();

