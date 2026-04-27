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

    // Massacre Princess Catholicon cast (Actors.json IDs 29-37: Rush, Blast,
    // Zonrath, Himiko, Zalatar, Rabu, Musashi, Mei, Maldark). The Visitor
    // final battle swaps the party to this MP cast; vanilla play never sees
    // these actor IDs in $gameParty, so their presence is the signal that
    // we're in MP form. Cheats that protect "the party" (invincibility,
    // status-immunity) consult this to carve out a not-trivialised final
    // boss fight - typically by keeping protection only for actor 29 (Rush)
    // and actor 1 (the renamable real protagonist).
    const MP_FORM_ACTOR_ID_MIN = 29;
    const MP_FORM_ACTOR_ID_MAX = 37;

    CabbyCodes.MASSACRE_PRINCESS_RUSH_ACTOR_ID = 29;
    CabbyCodes.PRIMARY_ACTOR_ID = 1;

    /**
     * Returns true when any current $gameParty member's actorId falls in
     * the MP-cast range [29..37], i.e. the party has been swapped to the
     * Massacre Princess Catholicon roster for the Visitor final battle.
     * @returns {boolean}
     */
    CabbyCodes.isMassacrePrincessForm = function() {
        if (typeof $gameParty === 'undefined' || !$gameParty) {
            return false;
        }
        const members =
            typeof $gameParty.allMembers === 'function'
                ? $gameParty.allMembers()
                : (typeof $gameParty.members === 'function' ? $gameParty.members() : []);
        for (let i = 0; i < members.length; i += 1) {
            const member = members[i];
            if (!member) {
                continue;
            }
            const id = typeof member.actorId === 'function' ? member.actorId() : member._actorId;
            if (id >= MP_FORM_ACTOR_ID_MIN && id <= MP_FORM_ACTOR_ID_MAX) {
                return true;
            }
        }
        return false;
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
    // Note: DataManager.setupNewGame also fires during Scene_Boot and from the
    // Hime_PreTitleEvents plugin (Scene_PretitleMap, a Scene_Map subclass shown
    // before the title). Hooking it directly would mark the session active during
    // the boot/pretitle window, which is before the player has actually entered a
    // save. Instead, hook the player-driven entry points.
    if (typeof Scene_Title !== 'undefined') {
        const _Scene_Title_commandNewGame = Scene_Title.prototype.commandNewGame;
        Scene_Title.prototype.commandNewGame = function() {
            _Scene_Title_commandNewGame.call(this);
            markSessionActive();
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




