//=============================================================================
// CabbyCodes Session State
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Tracks CabbyCodes session state to determine when mod options should be visible.
 * @author CabbyCodes
 * @help
 * Keeps a lightweight flag that tells other modules whether the player is inside
 * an active game session. CabbyCodes options are only shown while a save/new game
 * is loaded, not from the title screen.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        window.CabbyCodes = {};
    }

    const DEFAULT_ACTIVE_STATE = false;

    /**
     * Internal session-active flag.
     * @type {boolean}
     */
    if (typeof CabbyCodes._gameSessionActive === 'undefined') {
        CabbyCodes._gameSessionActive = DEFAULT_ACTIVE_STATE;
    }

    /**
     * Sets whether the player currently has an active game session.
     * @param {boolean} active
     */
    CabbyCodes.setGameSessionActive = function(active) {
        CabbyCodes._gameSessionActive = Boolean(active);
    };

    /**
     * Returns true if a new/save game is currently loaded.
     * @returns {boolean}
     */
    CabbyCodes.isGameSessionActive = function() {
        return Boolean(CabbyCodes._gameSessionActive);
    };

    /**
     * Determines if CabbyCodes-specific settings should be shown in the
     * Options menu.
     * @returns {boolean}
     */
    CabbyCodes.canShowCabbyCodesOptions = function() {
        return CabbyCodes.isGameSessionActive();
    };

    function markSessionActive() {
        CabbyCodes.setGameSessionActive(true);
        CabbyCodes.log?.('[CabbyCodes] Game session marked active');
    }

    function markSessionInactive() {
        CabbyCodes.setGameSessionActive(false);
        CabbyCodes.log?.('[CabbyCodes] Game session marked inactive');
    }

    // Hook into core systems to toggle session state.
    if (typeof DataManager !== 'undefined') {
        const _DataManager_setupNewGame = DataManager.setupNewGame;
        DataManager.setupNewGame = function() {
            const result = _DataManager_setupNewGame.call(this);
            markSessionActive();
            return result;
        };
    }

    if (typeof Scene_Load !== 'undefined') {
        const _Scene_Load_onLoadSuccess = Scene_Load.prototype.onLoadSuccess;
        Scene_Load.prototype.onLoadSuccess = function() {
            _Scene_Load_onLoadSuccess.call(this);
            markSessionActive();
        };
    }

    if (typeof Scene_Title !== 'undefined') {
        const _Scene_Title_start = Scene_Title.prototype.start;
        Scene_Title.prototype.start = function() {
            markSessionInactive();
            _Scene_Title_start.call(this);
        };
    }

    CabbyCodes.log?.('[CabbyCodes] Session state tracker initialized');
})();




