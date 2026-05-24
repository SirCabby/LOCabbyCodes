//=============================================================================
// CabbyCodes No Unfocus Pause
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes No Unfocus Pause - Keeps the game running when the window loses focus.
 * @author CabbyCodes
 * @help
 * Adds a "Don't Pause When Unfocused" option to the CabbyCodes section of the
 * Options menu. When enabled, SceneManager.isGameActive is forced to true so
 * the game keeps updating even when its window is not the foreground window.
 *
 * Technique credit: Caethyril
 * https://forums.rpgmakerweb.com/threads/disabling-auto-pause-screen-freeze-when-the-window-is-not-selected.135949/post-1184795
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] No Unfocus Pause requires CabbyCodes core.');
        return;
    }

    const settingKey = 'noUnfocusPause';

    CabbyCodes.registerSetting(
        settingKey,
        "Don't Pause When Unfocused",
        {
            defaultValue: false,
            order: 175,
            category: 'qol'
        },
        newValue => {
            CabbyCodes.log(
                `[CabbyCodes] No Unfocus Pause ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    const isCheatEnabled = () => CabbyCodes.getSetting(settingKey, false);

    CabbyCodes.override(
        SceneManager,
        'isGameActive',
        function (...args) {
            if (isCheatEnabled()) {
                return true;
            }
            return CabbyCodes.callOriginal(SceneManager, 'isGameActive', this, args);
        }
    );

    CabbyCodes.log('[CabbyCodes] No Unfocus Pause module loaded');
})();
