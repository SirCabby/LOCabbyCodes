//=============================================================================
// CabbyCodes Cheats Menu Entry
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Cheats Menu - Adds "Quality of Life" and "Cheats" entries to the in-game main menu
 * @author CabbyCodes
 * @help
 * Adds two commands to the in-game main menu (alongside Item, Skill,
 * Options, etc.): "Quality of Life" and "Cheats". Each opens a dedicated
 * scene that lists the CabbyCodes-registered settings tagged with that
 * category. The Options menu no longer holds cabby cheats — they live in
 * these dedicated menus instead.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Cheats menu requires CabbyCodes core.');
        return;
    }

    const CHEATS_SYMBOL = 'cabbycodes_cheats_menu';
    const CHEATS_LABEL = 'Cheats';
    const QOL_SYMBOL = 'cabbycodes_qol_menu';
    const QOL_LABEL = 'QoL';

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
        this.addCommand(QOL_LABEL, QOL_SYMBOL, true);
        this.addCommand(CHEATS_LABEL, CHEATS_SYMBOL, true);
    });

    CabbyCodes.override(Scene_Menu.prototype, 'createCommandWindow', function () {
        CabbyCodes.callOriginal(Scene_Menu.prototype, 'createCommandWindow', this, []);
        if (this._commandWindow && typeof this._commandWindow.setHandler === 'function') {
            this._commandWindow.setHandler(QOL_SYMBOL, this.commandCabbyCodesQoL.bind(this));
            this._commandWindow.setHandler(CHEATS_SYMBOL, this.commandCabbyCodesCheats.bind(this));
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

    Scene_Menu.prototype.commandCabbyCodesQoL = function () {
        if (typeof Scene_CabbyCodesQoL === 'undefined') {
            CabbyCodes.warn('[CabbyCodes][CheatsMenu] Scene_CabbyCodesQoL is not defined.');
            this._commandWindow.activate();
            return;
        }
        SceneManager.push(Scene_CabbyCodesQoL);
    };

    CabbyCodes.log('[CabbyCodes] Cheats menu entry loaded');
})();
