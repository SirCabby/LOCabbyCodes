//=============================================================================
// CabbyCodes Set Difficulty
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Set Difficulty - Pick the active game difficulty (Easy / Normal / Hard).
 * @author CabbyCodes
 * @help
 * Adds a press option that opens a picker for the current game difficulty.
 * The base game stores difficulty as three mutually-exclusive switches
 * (System.json: switch 13 EASYMODE, 31 NORMALMODE, 8 HARDMODE) which are
 * normally chosen once at the start of a new game. Picking a tier here
 * writes the chosen switch ON and clears the other two so existing logic
 * (escape ratios, weapon-break chance, save restrictions, etc.) reads the
 * new difficulty immediately.
 *
 * None of the difficulty switches are in the freeze-time snapshot, so the
 * write does not need an exempt-from-restore token.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Set Difficulty requires CabbyCodes core.');
        return;
    }

    const SETTING_KEY = 'setDifficulty';
    const LOG_PREFIX = '[CabbyCodes][SetDifficulty]';

    // Switch IDs from game_files/data/System.json (verified in GAME_NOTES.md §3).
    const EASY_SWITCH = 13;
    const NORMAL_SWITCH = 31;
    const HARD_SWITCH = 8;

    const DIFFICULTY_TIERS = [
        { value: EASY_SWITCH,   label: 'Easy' },
        { value: NORMAL_SWITCH, label: 'Normal' },
        { value: HARD_SWITCH,   label: 'Hard' }
    ];

    const PICKER_WIDTH = 360;
    const PICKER_SPACING = 12;
    const PICKER_MAX_ROWS = 4;

    CabbyCodes.registerSetting(SETTING_KEY, 'Set Difficulty', {
        defaultValue: 0,
        order: 30,
        formatValue: () => 'Press',
        onActivate: () => {
            openPickerScene();
            return true;
        }
    });

    function isSessionReady() {
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function' && !CabbyCodes.isGameSessionActive()) {
            return false;
        }
        return true;
    }

    function readCurrentDifficultySwitch() {
        for (const tier of DIFFICULTY_TIERS) {
            if ($gameSwitches.value(tier.value)) {
                return tier.value;
            }
        }
        return NORMAL_SWITCH;
    }

    function describeDifficulty(switchId) {
        const tier = DIFFICULTY_TIERS.find(t => t.value === switchId);
        return tier ? tier.label : 'Unknown';
    }

    function openPickerScene() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session.`);
            SoundManager.playBuzzer();
            return;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesSetDifficulty === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or picker scene unavailable.`);
            return;
        }
        SceneManager.push(Scene_CabbyCodesSetDifficulty);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene({
                initialValue: readCurrentDifficultySwitch(),
                onSelect: applyDifficulty,
                onCancel: () => {}
            });
        }
    }

    function applyDifficulty(chosenSwitchId) {
        if (!isSessionReady()) {
            return false;
        }
        try {
            DIFFICULTY_TIERS.forEach(tier => {
                $gameSwitches.setValue(tier.value, tier.value === chosenSwitchId);
            });
            CabbyCodes.log(`${LOG_PREFIX} Difficulty set to ${describeDifficulty(chosenSwitchId)} (switch ${chosenSwitchId}).`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed: ${error?.message || error}`);
            return false;
        }
    }

    //----------------------------------------------------------------------
    // Scene_CabbyCodesSetDifficulty
    //----------------------------------------------------------------------

    function Scene_CabbyCodesSetDifficulty() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesSetDifficulty.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesSetDifficulty.prototype.constructor = Scene_CabbyCodesSetDifficulty;

    Scene_CabbyCodesSetDifficulty.prototype.prepare = function(params = {}) {
        this._initialValue = Number(params.initialValue) || NORMAL_SWITCH;
        this._onSelect = params.onSelect;
        this._onCancel = params.onCancel;
    };

    Scene_CabbyCodesSetDifficulty.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createOptionsWindow();
    };

    Scene_CabbyCodesSetDifficulty.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesSetDifficulty.prototype.helpAreaHeight = function() {
        return this.calcWindowHeight(2, false);
    };

    Scene_CabbyCodesSetDifficulty.prototype.pickerLayout = function() {
        const width = Math.min(PICKER_WIDTH, Graphics.boxWidth - 32);
        const helpHeight = this.helpAreaHeight();
        const optionsHeight = this.calcWindowHeight(
            Math.min(DIFFICULTY_TIERS.length, PICKER_MAX_ROWS),
            true
        );
        const totalHeight = helpHeight + PICKER_SPACING + optionsHeight;
        const x = Math.max(0, Math.floor((Graphics.boxWidth - width) / 2));
        const baseY = Math.max(0, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        return { x, baseY, width, helpHeight, optionsHeight };
    };

    Scene_CabbyCodesSetDifficulty.prototype.createHelpWindow = function() {
        const layout = this.pickerLayout();
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText(`Set Difficulty\nCurrent: ${describeDifficulty(this._initialValue)}`);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesSetDifficulty.prototype.createOptionsWindow = function() {
        const layout = this.pickerLayout();
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.optionsHeight
        );
        this._optionsWindow = new Window_CabbyCodesSetDifficulty(rect);
        this._optionsWindow.setHandler('ok', this.onOptionOk.bind(this));
        this._optionsWindow.setHandler('cancel', this.onOptionCancel.bind(this));
        this.addWindow(this._optionsWindow);
        this._optionsWindow.selectValue(this._initialValue);
        this._optionsWindow.activate();
    };

    Scene_CabbyCodesSetDifficulty.prototype.onOptionOk = function() {
        const value = this._optionsWindow.currentValue();
        if (typeof this._onSelect === 'function') {
            this._onSelect(value);
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesSetDifficulty.prototype.onOptionCancel = function() {
        if (typeof this._onCancel === 'function') {
            this._onCancel();
        }
        SceneManager.pop();
    };

    window.Scene_CabbyCodesSetDifficulty = Scene_CabbyCodesSetDifficulty;

    //----------------------------------------------------------------------
    // Window_CabbyCodesSetDifficulty
    //----------------------------------------------------------------------

    function Window_CabbyCodesSetDifficulty() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSetDifficulty.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesSetDifficulty.prototype.constructor = Window_CabbyCodesSetDifficulty;

    Window_CabbyCodesSetDifficulty.prototype.makeCommandList = function() {
        DIFFICULTY_TIERS.forEach(tier => {
            this.addCommand(tier.label, `difficulty_${tier.value}`, true, tier.value);
        });
    };

    Window_CabbyCodesSetDifficulty.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems());
    };

    Window_CabbyCodesSetDifficulty.prototype.currentValue = function() {
        return this.currentExt();
    };

    Window_CabbyCodesSetDifficulty.prototype.selectValue = function(value) {
        const index = DIFFICULTY_TIERS.findIndex(tier => tier.value === value);
        this.select(index >= 0 ? index : 0);
        this.ensureCursorVisible();
    };

    window.Window_CabbyCodesSetDifficulty = Window_CabbyCodesSetDifficulty;

    CabbyCodes.log('[CabbyCodes] Set Difficulty module loaded');
})();
