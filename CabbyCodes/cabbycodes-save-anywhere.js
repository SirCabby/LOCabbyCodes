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
        {
            defaultValue: false,
            order: 61
        },
        newValue => {
            CabbyCodes.log(`[CabbyCodes] Save anywhere ${newValue ? 'enabled' : 'disabled'}`);
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    /**
     * Ensure the Save command is available in the menu when the feature is enabled,
     * while still respecting story-based save locks handled by Game_System.
     * We add the command only if the base game (or other plugins) didn't add it.
     */
    CabbyCodes.after(
        Window_MenuCommand.prototype,
        'addSaveCommand',
        function() {
            if (!isFeatureEnabled()) {
                return;
            }

            if (!this.needsCommand("save")) {
                return;
            }

            const hasSaveCommand = Array.isArray(this._list) && this._list.some(command => command.symbol === 'save');
            if (hasSaveCommand) {
                return;
            }

            const enabled = this.isSaveEnabled();
            this.addCommand(TextManager.save, "save", enabled);
        }
    );

    CabbyCodes.log('[CabbyCodes] Save anywhere patch loaded');
})();

