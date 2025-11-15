//=============================================================================
// CabbyCodes Friendly Door Visitors
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes - Prevent hostile door visitors when enabled
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that removes the pool of cursed/hostile door
 * knock encounters. When enabled, the door encounter system will only schedule
 * non-hostile visitors by keeping the "allowed cursed encounters" variable
 * empty, while preserving the player's original data so it can be restored if
 * the option is turned off later.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Friendly Door Visitors requires CabbyCodes core.');
        return;
    }

    const settingKey = 'friendlyDoorVisitors';
    const DOOR_CURSED_VAR_ID = 168;
    const DEFAULT_CURSED_VISITORS = Object.freeze([49, 56, 59, 61, 68, 60]);

    let pendingMode = null;
    let friendlyModeApplied = false;

    const logPrefix = '[CabbyCodes]';

    const hasGameVariables = () =>
        typeof $gameVariables !== 'undefined' && $gameVariables !== null;

    const hasGameSystem = () =>
        typeof $gameSystem !== 'undefined' && $gameSystem !== null;

    const cloneList = list => (Array.isArray(list) ? list.slice() : null);

    function ensureBackup(sourceList) {
        if (!hasGameSystem()) {
            return;
        }

        const backup = $gameSystem._cabbycodesDoorCursedBackup;
        if (backup && backup._cabbycodesActive) {
            return;
        }

        $gameSystem._cabbycodesDoorCursedBackup = {
            _cabbycodesActive: true,
            list: cloneList(sourceList) ?? DEFAULT_CURSED_VISITORS.slice()
        };
    }

    function getBackup() {
        if (!hasGameSystem()) {
            return null;
        }

        const backup = $gameSystem._cabbycodesDoorCursedBackup;
        if (backup && backup._cabbycodesActive) {
            return cloneList(backup.list) ?? DEFAULT_CURSED_VISITORS.slice();
        }

        return null;
    }

    function clearBackup() {
        if (!hasGameSystem()) {
            return;
        }
        delete $gameSystem._cabbycodesDoorCursedBackup;
    }

    function enforceFriendlyList() {
        if (!hasGameVariables()) {
            pendingMode = true;
            return false;
        }

        const currentList = $gameVariables.value(DOOR_CURSED_VAR_ID);
        ensureBackup(currentList);

        if (!Array.isArray(currentList) || currentList.length > 0) {
            $gameVariables.setValue(DOOR_CURSED_VAR_ID, []);
            CabbyCodes.log(
                `${logPrefix} Friendly door visitors active - disabled cursed encounter pool.`
            );
        }

        friendlyModeApplied = true;
        return true;
    }

    function restoreCursedList() {
        if (!friendlyModeApplied) {
            pendingMode = null;
            return true;
        }

        if (!hasGameVariables()) {
            pendingMode = false;
            return false;
        }

        const backup = getBackup() ?? DEFAULT_CURSED_VISITORS.slice();
        $gameVariables.setValue(DOOR_CURSED_VAR_ID, backup);

        clearBackup();
        friendlyModeApplied = false;
        CabbyCodes.log(
            `${logPrefix} Friendly door visitors disabled - restored original cursed encounter pool.`
        );
        return true;
    }

    function applyFriendlyMode(forceState = null) {
        const desiredState =
            typeof forceState === 'boolean'
                ? forceState
                : CabbyCodes.getSetting(settingKey, false);

        const succeeded = desiredState ? enforceFriendlyList() : restoreCursedList();

        if (!succeeded) {
            pendingMode = desiredState;
        } else {
            pendingMode = null;
        }

        return succeeded;
    }

    function scheduleApply() {
        if (pendingMode === null) {
            pendingMode = CabbyCodes.getSetting(settingKey, false);
        }
        applyFriendlyMode(pendingMode);
    }

    CabbyCodes.registerSetting(
        settingKey,
        'Friendly Door Visitors',
        false,
        newValue => {
            applyFriendlyMode(newValue);
            CabbyCodes.log(
                `${logPrefix} Friendly door visitors ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    if (typeof DataManager !== 'undefined') {
        ['setupNewGame', 'loadGame'].forEach(methodName => {
            if (typeof DataManager[methodName] === 'function') {
                CabbyCodes.after(DataManager, methodName, scheduleApply);
            }
        });
    }

    if (typeof window.setupDoorEncounters === 'function') {
        CabbyCodes.after(window, 'setupDoorEncounters', () => {
            if (CabbyCodes.getSetting(settingKey, false)) {
                enforceFriendlyList();
            }
        });
    } else {
        CabbyCodes.warn(
            `${logPrefix} Friendly Door Visitors could not find setupDoorEncounters(); hostile visitors may still appear.`
        );
    }

    applyFriendlyMode();

    CabbyCodes.log('[CabbyCodes] Friendly Door Visitors module loaded');
})();


