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
    const respectStorySettingKey = 'saveAnywhereRespectStoryLocks';

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

    CabbyCodes.registerSetting(
        respectStorySettingKey,
        'Respect Story Save Locks',
        {
            defaultValue: true,
            order: 62
        }
    );

    const isFeatureEnabled = () => CabbyCodes.getSetting(settingKey, false);
    const shouldRespectStoryLocks = () => CabbyCodes.getSetting(respectStorySettingKey, true);

    const DifficultyState = {
        easySwitchId: 13,
        normalSwitchId: 31,
        hardSwitchId: 8,

        getSwitchValue(switchId) {
            if (typeof switchId !== 'number' || switchId < 1) {
                return false;
            }

            try {
                if (typeof window.gSw === 'function') {
                    return Boolean(window.gSw(switchId));
                }

                if (typeof $gameSwitches !== 'undefined' && typeof $gameSwitches.value === 'function') {
                    return Boolean($gameSwitches.value(switchId));
                }
            } catch (error) {
                console.warn('[CabbyCodes] Save Anywhere: failed to read switch', switchId, error);
            }

            return false;
        },

        isEasyMode() {
            return this.getSwitchValue(this.easySwitchId);
        },

        isNonEasyDifficulty() {
            if (this.isEasyMode()) {
                return false;
            }

            const knownModes = [
                this.normalSwitchId,
                this.hardSwitchId
            ].filter(id => typeof id === 'number' && id > 0);

            if (knownModes.length === 0) {
                return true;
            }

            return knownModes.some(id => this.getSwitchValue(id));
        }
    };

    const SaveAnywhereState = {
        canManipulate() {
            if (typeof $gameSystem === 'undefined') {
                return false;
            }
            if (typeof $gameParty === 'undefined') {
                return false;
            }
            if (typeof SceneManager === 'undefined') {
                return false;
            }
            if (typeof $gameParty.inBattle === 'function' && $gameParty.inBattle()) {
                return false;
            }
            return true;
        },

        determineLockType() {
            if (typeof $gameSystem === 'undefined' || typeof $gameSystem.isSaveEnabled !== 'function') {
                return 'unknown';
            }

            try {
                if ($gameSystem.isSaveEnabled()) {
                    return 'none';
                }
            } catch (error) {
                console.error('[CabbyCodes] Save Anywhere: failed to inspect Game_System', error);
                return 'unknown';
            }

            if (DifficultyState.isEasyMode()) {
                return 'story';
            }

            if (DifficultyState.isNonEasyDifficulty()) {
                return 'difficulty';
            }

            return 'unknown';
        },

        shouldForceEnable(baseEnabled) {
            if (baseEnabled) {
                return false;
            }

            if (!this.canManipulate()) {
                return false;
            }

            const lockType = this.determineLockType();
            if (lockType === 'story') {
                return !shouldRespectStoryLocks();
            }

            if (lockType === 'difficulty') {
                return true;
            }

            return !shouldRespectStoryLocks();
        },

        ensureSaveCommand(menuWindow) {
            const commandList = Array.isArray(menuWindow._list) ? menuWindow._list : [];
            const existingCommand = commandList.find(command => command.symbol === 'save');
            const baseEnabled = menuWindow.isSaveEnabled();
            const forceEnable = this.shouldForceEnable(baseEnabled);

            if (existingCommand) {
                if (forceEnable && !existingCommand.enabled) {
                    existingCommand.enabled = true;
                } else if (!forceEnable && existingCommand.enabled !== baseEnabled) {
                    existingCommand.enabled = baseEnabled;
                }
                return;
            }

            if (!forceEnable && !baseEnabled) {
                return;
            }

            menuWindow.addCommand(TextManager.save, "save", forceEnable ? true : baseEnabled);
        }
    };

    const applySaveAnywherePatch = () => {
        if (applySaveAnywherePatch._applied) {
            return;
        }
        applySaveAnywherePatch._applied = true;

        CabbyCodes.after(
            Window_MenuCommand.prototype,
            'addSaveCommand',
            function() {
                if (!isFeatureEnabled()) {
                    return;
                }

                SaveAnywhereState.ensureSaveCommand(this);
            }
        );
    };

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(applySaveAnywherePatch, 0);
    } else {
        applySaveAnywherePatch();
    }

    CabbyCodes.log('[CabbyCodes] Save anywhere patch loaded');
})();

