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
        'Enable Saving',
        {
            defaultValue: false,
            order: 61
        },
        newValue => {
            CabbyCodes.log(`[CabbyCodes] Save anywhere ${newValue ? 'enabled' : 'disabled'}`);
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);

    const applySaveAnywherePatch = () => {
        if (applySaveAnywherePatch._applied) {
            return;
        }
        applySaveAnywherePatch._applied = true;

        // Override isSaveEnabled to bypass difficulty-based save restrictions
        // The game uses $gameSystem.isSaveEnabled() to disable saving based on difficulty
        // When the cheat is enabled, we bypass this check while respecting other mechanics
        CabbyCodes.override(
            Window_MenuCommand.prototype,
            'isSaveEnabled',
            function() {
                const original = this._cabbycodesOriginals?.isSaveEnabled;
                const baseResult = original ? original.call(this) : false;

                // If cheat is disabled, use normal behavior
                if (!isFeatureEnabled()) {
                    return baseResult;
                }

                // If base result is true, saving is already enabled - use it
                if (baseResult) {
                    return baseResult;
                }

                // Base result is false - check if $gameSystem.isSaveEnabled() is the reason
                // The original isSaveEnabled checks: !DataManager.isEventTest() && $gameSystem.isSaveEnabled()
                // If $gameSystem.isSaveEnabled() is false, bypass it (difficulty restriction)
                // Other checks (like DataManager.isEventTest()) are still respected
                if (typeof $gameSystem !== 'undefined' && typeof $gameSystem.isSaveEnabled === 'function') {
                    if (!$gameSystem.isSaveEnabled()) {
                        // Save is disabled via $gameSystem - bypass the difficulty restriction
                        // But still respect other checks like event test mode
                        if (typeof DataManager !== 'undefined' && typeof DataManager.isEventTest === 'function') {
                            if (DataManager.isEventTest()) {
                                return false; // Still respect event test mode
                            }
                        }
                        return true; // Bypass difficulty restriction
                    }
                }

                // Fall back to base result for any other case
                return baseResult;
            },
            settingKey
        );

        // Override addSaveCommand to ensure save option always exists in the menu
        // When the feature is enabled, we bypass needsCommand('save') check which may be false
        // for higher difficulties, ensuring the save option is always added to the menu
        // Note: We don't pass settingKey here so the override is always active and can check dynamically
        CabbyCodes.override(
            Window_MenuCommand.prototype,
            'addSaveCommand',
            function() {
                // Check if save command already exists
                const commandList = Array.isArray(this._list) ? this._list : [];
                const existingCommand = commandList.find(command => command && command.symbol === 'save');

                // If feature is enabled, always add save command regardless of needsCommand('save')
                // Otherwise, use normal behavior (check needsCommand('save'))
                const shouldAddSave = isFeatureEnabled() || this.needsCommand('save');

                if (shouldAddSave) {
                    if (!existingCommand) {
                        // Command doesn't exist, add it with proper enabled state
                        const enabled = this.isSaveEnabled();
                        this.addCommand(TextManager.save, 'save', enabled);
                    } else {
                        // Command exists, update enabled state based on our override
                        const enabled = this.isSaveEnabled();
                        existingCommand.enabled = enabled;
                    }
                }
            }
        );

        // Also override Window_SavefileList.isEnabled to bypass difficulty restrictions
        // This ensures that when actually trying to save, the savefile is considered enabled
        CabbyCodes.override(
            Window_SavefileList.prototype,
            'isEnabled',
            function(savefileId) {
                const original = this._cabbycodesOriginals?.isEnabled;
                const baseResult = original ? original.call(this, savefileId) : false;

                // If cheat is disabled, use normal behavior
                if (!isFeatureEnabled()) {
                    return baseResult;
                }

                // If we're in save mode and base result would be false,
                // check if it's due to difficulty restrictions
                if (this._mode === 'save') {
                    // The normal check is just savefileId > 0, so baseResult should be true if valid
                    // But if $gameSystem.isSaveEnabled() is false, the window might disable it
                    // So we bypass the difficulty check here
                    if (typeof $gameSystem !== 'undefined' && typeof $gameSystem.isSaveEnabled === 'function') {
                        if (!$gameSystem.isSaveEnabled() && savefileId > 0) {
                            // Save is disabled via $gameSystem (difficulty) but savefileId is valid
                            // Bypass the difficulty restriction
                            return true;
                        }
                    }
                }

                // Fall back to base result
                return baseResult;
            },
            settingKey
        );
    };

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(applySaveAnywherePatch, 0);
    } else {
        applySaveAnywherePatch();
    }

    CabbyCodes.log('[CabbyCodes] Save anywhere patch loaded');
})();

