//=============================================================================
// CabbyCodes Set Danger Level
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Set Danger Level - Pick the current outside-apartment danger tier.
 * @author CabbyCodes
 * @help
 * Adds a press option that opens a picker for the time-based encounter danger
 * bonus (variable 112). The game normally accumulates this while the player
 * is outside the apartment, so this cheat is only available when the player
 * is not home. Returning home zeroes the bonus, which is why we gate on the
 * `playerIsHome` switch.
 *
 * Cooperates with Freeze Time by acquiring an exempt-from-restore token
 * across the write — picking a new tier while frozen re-freezes at the
 * chosen value instead of snapping back to the old snapshot.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Set Danger Level requires CabbyCodes core.');
        return;
    }

    const SETTING_KEY = 'setDangerLevel';
    const LOG_PREFIX = '[CabbyCodes][SetDanger]';

    // Game-side IDs. `dangerBonus` (112) and `playerIsHome` (25) are documented
    // in GAME_NOTES.md §3 and §4. Low/Medium/High come from CE 11 ChangedRooms'
    // escalating encounter-roll branches (60 / 160 / 300). Critical is 500 —
    // CE 145 draws the danger meter as 25 pips in 20-point increments, so 500
    // is where the final pip finishes filling (480 only starts it).
    const DANGER_BONUS_VAR = 112;
    const PLAYER_IS_HOME_SWITCH = 25;

    const DANGER_TIERS = [
        { value: 0,   label: 'None (0)' },
        { value: 60,  label: 'Low (60)' },
        { value: 160, label: 'Medium (160)' },
        { value: 300, label: 'High (300)' },
        { value: 500, label: 'Critical (500)' }
    ];

    const PICKER_WIDTH = 360;
    const PICKER_SPACING = 12;
    const PICKER_MAX_ROWS = 6;

    CabbyCodes.registerSetting(SETTING_KEY, 'Set Danger Level', {
        defaultValue: 0,
        order: 25,
        formatValue: () => 'Press',
        onActivate: () => {
            openPickerScene();
            return true;
        }
    });

    function isSessionReady() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function' && !CabbyCodes.isGameSessionActive()) {
            return false;
        }
        return true;
    }

    function isPlayerHome() {
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return true;
        }
        return Boolean($gameSwitches.value(PLAYER_IS_HOME_SWITCH));
    }

    function readCurrentDanger() {
        const raw = Number($gameVariables.value(DANGER_BONUS_VAR));
        return Number.isFinite(raw) ? raw : 0;
    }

    function openPickerScene() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session.`);
            SoundManager.playBuzzer();
            return;
        }
        if (isPlayerHome()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: player is at home (danger level is only meaningful outside the apartment).`);
            SoundManager.playBuzzer();
            return;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesSetDanger === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or picker scene unavailable.`);
            return;
        }
        SceneManager.push(Scene_CabbyCodesSetDanger);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene({
                initialValue: readCurrentDanger(),
                onSelect: applyDanger,
                onCancel: () => {}
            });
        }
    }

    function applyDanger(newValue) {
        if (!isSessionReady()) {
            return false;
        }
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ variables: [DANGER_BONUS_VAR] })
            : { release: () => {} };
        try {
            $gameVariables.setValue(DANGER_BONUS_VAR, newValue);
            CabbyCodes.log(`${LOG_PREFIX} Danger bonus set to ${newValue}.`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    //----------------------------------------------------------------------
    // Scene_CabbyCodesSetDanger
    //----------------------------------------------------------------------

    function Scene_CabbyCodesSetDanger() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesSetDanger.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesSetDanger.prototype.constructor = Scene_CabbyCodesSetDanger;

    Scene_CabbyCodesSetDanger.prototype.prepare = function(params = {}) {
        this._initialValue = Number(params.initialValue) || 0;
        this._onSelect = params.onSelect;
        this._onCancel = params.onCancel;
    };

    Scene_CabbyCodesSetDanger.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createOptionsWindow();
    };

    Scene_CabbyCodesSetDanger.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesSetDanger.prototype.helpAreaHeight = function() {
        return this.calcWindowHeight(2, false);
    };

    Scene_CabbyCodesSetDanger.prototype.pickerLayout = function() {
        const width = Math.min(PICKER_WIDTH, Graphics.boxWidth - 32);
        const helpHeight = this.helpAreaHeight();
        const optionsHeight = this.calcWindowHeight(
            Math.min(DANGER_TIERS.length, PICKER_MAX_ROWS),
            true
        );
        const totalHeight = helpHeight + PICKER_SPACING + optionsHeight;
        const x = Math.max(0, Math.floor((Graphics.boxWidth - width) / 2));
        const baseY = Math.max(0, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        return { x, baseY, width, helpHeight, optionsHeight };
    };

    Scene_CabbyCodesSetDanger.prototype.createHelpWindow = function() {
        const layout = this.pickerLayout();
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText(`Set Danger Level\nCurrent bonus: ${this._initialValue}`);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesSetDanger.prototype.createOptionsWindow = function() {
        const layout = this.pickerLayout();
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.optionsHeight
        );
        this._optionsWindow = new Window_CabbyCodesSetDanger(rect);
        this._optionsWindow.setHandler('ok', this.onOptionOk.bind(this));
        this._optionsWindow.setHandler('cancel', this.onOptionCancel.bind(this));
        this.addWindow(this._optionsWindow);
        this._optionsWindow.selectValue(this._initialValue);
        this._optionsWindow.activate();
    };

    Scene_CabbyCodesSetDanger.prototype.onOptionOk = function() {
        const value = this._optionsWindow.currentValue();
        if (typeof this._onSelect === 'function') {
            this._onSelect(value);
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesSetDanger.prototype.onOptionCancel = function() {
        if (typeof this._onCancel === 'function') {
            this._onCancel();
        }
        SceneManager.pop();
    };

    window.Scene_CabbyCodesSetDanger = Scene_CabbyCodesSetDanger;

    //----------------------------------------------------------------------
    // Window_CabbyCodesSetDanger
    //----------------------------------------------------------------------

    function Window_CabbyCodesSetDanger() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSetDanger.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesSetDanger.prototype.constructor = Window_CabbyCodesSetDanger;

    Window_CabbyCodesSetDanger.prototype.makeCommandList = function() {
        DANGER_TIERS.forEach(tier => {
            this.addCommand(tier.label, `danger_${tier.value}`, true, tier.value);
        });
    };

    Window_CabbyCodesSetDanger.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems());
    };

    Window_CabbyCodesSetDanger.prototype.currentValue = function() {
        return this.currentExt();
    };

    // Selects the closest tier at-or-below the current danger bonus so the
    // picker lands on a meaningful starting row even when the live value is
    // between named thresholds.
    Window_CabbyCodesSetDanger.prototype.selectValue = function(value) {
        let bestIndex = 0;
        for (let i = 0; i < DANGER_TIERS.length; i += 1) {
            if (DANGER_TIERS[i].value <= value) {
                bestIndex = i;
            }
        }
        this.select(bestIndex);
        this.ensureCursorVisible();
    };

    window.Window_CabbyCodesSetDanger = Window_CabbyCodesSetDanger;

    CabbyCodes.log('[CabbyCodes] Set Danger Level module loaded');
})();
