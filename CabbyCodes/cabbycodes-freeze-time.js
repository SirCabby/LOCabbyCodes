//=============================================================================
// CabbyCodes Freeze Time
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Freeze Time - Stops the in-game time of day from advancing.
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that locks the game's time-of-day variable so
 * activities such as walking around, minigames, or scripted events can no longer
 * advance it. Other systems like battles or shop restocking continue running
 * normally because they do not rely on the time-of-day variable.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Freeze Time requires CabbyCodes core.');
        return;
    }

    const settingKey = 'freezeTimeOfDay';
    const timeVariableIds = [16]; // Variable 16 tracks the current in-game hour.

    CabbyCodes.registerSetting(settingKey, 'Freeze Time of Day', {
        defaultValue: false,
        order: 60,
        onChange: newValue => {
            CabbyCodes.log(
                `[CabbyCodes] Time of day ${newValue ? 'is now frozen' : 'can advance again'}.`
            );
        }
    });

    function shouldBlock(variableId) {
        if (!CabbyCodes.getSetting(settingKey, false)) {
            return false;
        }
        const numericId = Number(variableId);
        if (!Number.isFinite(numericId)) {
            return false;
        }
        return timeVariableIds.includes(numericId);
    }

    if (Game_Variables.prototype._cabbycodesFreezeTimeWrapped !== true) {
        Game_Variables.prototype._cabbycodesFreezeTimeWrapped = true;
        const previousSetValue = Game_Variables.prototype.setValue;

        Game_Variables.prototype.setValue = function(variableId, value) {
            if (shouldBlock(variableId)) {
                return this.value(Number(variableId));
            }
            return previousSetValue.apply(this, arguments);
        };
    } else {
        CabbyCodes.warn('[CabbyCodes] Freeze Time patch already applied; skipping duplicate wrap.');
    }

    CabbyCodes.log('[CabbyCodes] Freeze Time module loaded');
})();



