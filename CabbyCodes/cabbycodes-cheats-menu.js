//=============================================================================
// CabbyCodes Cheats Menu Entry
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Cheats Menu - Adds a "Cheats" entry to the in-game main menu
 * @author CabbyCodes
 * @help
 * Adds a "Cheats" command to the in-game main menu (alongside Item, Skill,
 * Options, etc.). Selecting it opens Scene_CabbyCodesCheats, which lists
 * every CabbyCodes-registered setting. The Options menu no longer holds
 * cabby cheats — they live in this dedicated menu instead.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Cheats menu requires CabbyCodes core.');
        return;
    }

    const COMMAND_SYMBOL = 'cabbycodes_cheats_menu';
    const COMMAND_LABEL = 'Cheats';

    function canShowCheatsEntry() {
        if (typeof CabbyCodes.canShowCabbyCodesOptions === 'function') {
            try {
                return Boolean(CabbyCodes.canShowCabbyCodesOptions());
            } catch (error) {
                CabbyCodes.warn(`[CabbyCodes][CheatsMenu] visibility check failed: ${error?.message || error}`);
                return false;
            }
        }
        return true;
    }

    CabbyCodes.override(Window_MenuCommand.prototype, 'addOriginalCommands', function () {
        CabbyCodes.callOriginal(Window_MenuCommand.prototype, 'addOriginalCommands', this, []);
        if (!canShowCheatsEntry()) {
            return;
        }
        this.addCommand(COMMAND_LABEL, COMMAND_SYMBOL, true);
    });

    CabbyCodes.override(Scene_Menu.prototype, 'createCommandWindow', function () {
        CabbyCodes.callOriginal(Scene_Menu.prototype, 'createCommandWindow', this, []);
        if (this._commandWindow && typeof this._commandWindow.setHandler === 'function') {
            this._commandWindow.setHandler(COMMAND_SYMBOL, this.commandCabbyCodesCheats.bind(this));
        }
    });

    Scene_Menu.prototype.commandCabbyCodesCheats = function () {
        if (typeof Scene_CabbyCodesCheats === 'undefined') {
            CabbyCodes.warn('[CabbyCodes][CheatsMenu] Scene_CabbyCodesCheats is not defined.');
            this._commandWindow.activate();
            return;
        }
        SceneManager.push(Scene_CabbyCodesCheats);
    };

    CabbyCodes.log('[CabbyCodes] Cheats menu entry loaded');
})();
