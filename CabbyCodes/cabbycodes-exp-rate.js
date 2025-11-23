//=============================================================================
// CabbyCodes EXP Rate Slider
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Adds an EXP rate slider with 0x-10x multipliers plus an Instant Max option.
 * @author CabbyCodes
 * @help
 * Lets players scale experience gain or jump straight to the level cap on the
 * next EXP event.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] EXP Rate slider requires the CabbyCodes core module.');
        return;
    }

    const SETTING_KEY = 'expRateLevel';
    const DEFAULT_RATE = 1;
    const MAX_STANDARD_MULTIPLIER = 10;
    const INSTANT_MAX_VALUE = MAX_STANDARD_MULTIPLIER + 1;

    const EXP_RATE_PICKER_WIDTH = 360;
    const EXP_RATE_PICKER_SPACING = 12;
    const EXP_RATE_PICKER_MAX_ROWS = 6;
    const EXP_RATE_HELP_TEXT = 'EXP Rate';

    CabbyCodes.registerSetting(SETTING_KEY, 'EXP Rate', {
        type: 'slider',
        control: 'slider',
        defaultValue: DEFAULT_RATE,
        min: 0,
        max: INSTANT_MAX_VALUE,
        step: 1,
        order: 48,
        formatValue: formatExpRateSettingValue,
        inputTitle: 'EXP Rate',
        inputDescription: 'Use left/right to pick 0x-10x EXP or Instant Max.',
        wrap: false,
        onActivate: () => handleExpRateActivation()
    });

    ensureExpRateDefaultValue();

    const EXP_RATE_OPTIONS = buildExpRateOptions();

    function formatExpRateSettingValue(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return '1x';
        }
        if (numeric <= 0) {
            return '0x';
        }
        if (numeric >= INSTANT_MAX_VALUE) {
            return 'Instant Max';
        }
        return `${numeric}x`;
    }

    function sanitizeExpGain(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 0;
        }
        return numeric;
    }

    function resolveMultiplier(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return DEFAULT_RATE;
        }
        return Math.min(Math.max(numeric, 0), MAX_STANDARD_MULTIPLIER);
    }

    function grantInstantMax(actor) {
        const targetExp = actor.expForLevel(actor.maxLevel());
        actor.changeExp(targetExp, actor.shouldDisplayLevelUp());
    }

    function ensureExpRateDefaultValue() {
        if (!CabbyCodes.settings || !CabbyCodes.settings.hasOwnProperty(SETTING_KEY)) {
            CabbyCodes.setSetting(SETTING_KEY, DEFAULT_RATE);
            return;
        }
        const stored = CabbyCodes.getSetting(SETTING_KEY, DEFAULT_RATE);
        if (!Number.isFinite(stored)) {
            CabbyCodes.setSetting(SETTING_KEY, DEFAULT_RATE);
        }
    }

    function buildExpRateOptions() {
        const options = [];
        for (let rate = 0; rate <= MAX_STANDARD_MULTIPLIER; rate++) {
            options.push({
                value: rate,
                label: `${rate}x`
            });
        }
        options.push({
            value: INSTANT_MAX_VALUE,
            label: 'Instant Max'
        });
        return options;
    }

    function handleExpRateActivation() {
        const currentValue = CabbyCodes.getSetting(SETTING_KEY, DEFAULT_RATE);
        return openExpRateSelection(currentValue);
    }

    function openExpRateSelection(initialValue) {
        if (typeof SceneManager === 'undefined') {
            CabbyCodes.warn('[CabbyCodes] EXP Rate: SceneManager is unavailable.');
            return false;
        }
        if (typeof Scene_CabbyCodesExpRateSelect === 'undefined') {
            CabbyCodes.warn('[CabbyCodes] EXP Rate: selection scene is unavailable.');
            return false;
        }
        SceneManager.push(Scene_CabbyCodesExpRateSelect);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene({
                initialValue,
                onSelect: value => CabbyCodes.applySettingValue(SETTING_KEY, value),
                onCancel: () => {}
            });
        }
        return true;
    }

    CabbyCodes.override(Game_Actor.prototype, 'gainExp', function(exp) {
        try {
            const sliderValue = CabbyCodes.getSetting(SETTING_KEY, DEFAULT_RATE);
            const incomingGain = sanitizeExpGain(exp);

            if (incomingGain < 0) {
                return CabbyCodes.callOriginal(Game_Actor.prototype, 'gainExp', this, [exp]);
            }

            if (sliderValue >= INSTANT_MAX_VALUE) {
                if (incomingGain > 0 && !this.isMaxLevel()) {
                    grantInstantMax(this);
                    return;
                }
                return CabbyCodes.callOriginal(Game_Actor.prototype, 'gainExp', this, [exp]);
            }

            const multiplier = resolveMultiplier(sliderValue);
            const adjustedExp = Math.round(incomingGain * multiplier);
            return CabbyCodes.callOriginal(Game_Actor.prototype, 'gainExp', this, [adjustedExp]);
        } catch (error) {
            CabbyCodes.error(`[CabbyCodes] EXP Rate slider error: ${error?.message || error}`);
            return CabbyCodes.callOriginal(Game_Actor.prototype, 'gainExp', this, [exp]);
        }
    });

    //----------------------------------------------------------------------------
    // Scene_CabbyCodesExpRateSelect
    //----------------------------------------------------------------------------

    function Scene_CabbyCodesExpRateSelect() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesExpRateSelect.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesExpRateSelect.prototype.constructor = Scene_CabbyCodesExpRateSelect;

    Scene_CabbyCodesExpRateSelect.prototype.prepare = function(params = {}) {
        this._initialValue = Number(params.initialValue ?? DEFAULT_RATE);
        this._onSelect = params.onSelect;
        this._onCancel = params.onCancel;
    };

    Scene_CabbyCodesExpRateSelect.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createOptionsWindow();
    };

    Scene_CabbyCodesExpRateSelect.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesExpRateSelect.prototype.helpAreaHeight = function() {
        return this.calcWindowHeight(1, false);
    };

    Scene_CabbyCodesExpRateSelect.prototype.createHelpWindow = function() {
        const rect = this.helpWindowRect();
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText(EXP_RATE_HELP_TEXT);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesExpRateSelect.prototype.createOptionsWindow = function() {
        const rect = this.optionsWindowRect();
        this._optionsWindow = new Window_CabbyCodesExpRateSelect(rect);
        this._optionsWindow.setHandler('ok', this.onOptionOk.bind(this));
        this._optionsWindow.setHandler('cancel', this.onOptionCancel.bind(this));
        this.addWindow(this._optionsWindow);
        this._optionsWindow.selectValue(this._initialValue);
        this._optionsWindow.activate();
    };

    Scene_CabbyCodesExpRateSelect.prototype.expRateWindowLayout = function() {
        const width = Math.min(EXP_RATE_PICKER_WIDTH, Graphics.boxWidth - 32);
        const helpHeight = this.helpAreaHeight();
        const optionsHeight = this.calcWindowHeight(
            Math.min(EXP_RATE_OPTIONS.length, EXP_RATE_PICKER_MAX_ROWS),
            true
        );
        const totalHeight = helpHeight + EXP_RATE_PICKER_SPACING + optionsHeight;
        const x = Math.max(0, Math.floor((Graphics.boxWidth - width) / 2));
        const baseY = Math.max(0, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        return {
            x,
            helpHeight,
            optionsHeight,
            baseY,
            width
        };
    };

    Scene_CabbyCodesExpRateSelect.prototype.helpWindowRect = function() {
        const layout = this.expRateWindowLayout();
        return new Rectangle(
            layout.x,
            layout.baseY,
            layout.width,
            layout.helpHeight
        );
    };

    Scene_CabbyCodesExpRateSelect.prototype.optionsWindowRect = function() {
        const layout = this.expRateWindowLayout();
        return new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + EXP_RATE_PICKER_SPACING,
            layout.width,
            layout.optionsHeight
        );
    };

    Scene_CabbyCodesExpRateSelect.prototype.onOptionOk = function() {
        const value = this._optionsWindow.currentValue();
        if (typeof this._onSelect === 'function') {
            this._onSelect(value);
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesExpRateSelect.prototype.onOptionCancel = function() {
        if (typeof this._onCancel === 'function') {
            this._onCancel();
        }
        SceneManager.pop();
    };

    window.Scene_CabbyCodesExpRateSelect = Scene_CabbyCodesExpRateSelect;

    //----------------------------------------------------------------------------
    // Window_CabbyCodesExpRateSelect
    //----------------------------------------------------------------------------

    function Window_CabbyCodesExpRateSelect() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesExpRateSelect.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesExpRateSelect.prototype.constructor = Window_CabbyCodesExpRateSelect;

    Window_CabbyCodesExpRateSelect.prototype.initialize = function(rect) {
        Window_Command.prototype.initialize.call(this, rect);
        this._pendingValue = DEFAULT_RATE;
    };

    Window_CabbyCodesExpRateSelect.prototype.makeCommandList = function() {
        EXP_RATE_OPTIONS.forEach(option => {
            this.addCommand(option.label, `expRate_${option.value}`, true, option.value);
        });
    };

    Window_CabbyCodesExpRateSelect.prototype.numVisibleRows = function() {
        return Math.min(EXP_RATE_PICKER_MAX_ROWS, this.maxItems());
    };

    Window_CabbyCodesExpRateSelect.prototype.currentValue = function() {
        return this.currentExt();
    };

    Window_CabbyCodesExpRateSelect.prototype.selectValue = function(value) {
        const index = EXP_RATE_OPTIONS.findIndex(option => option.value === value);
        this.select(index >= 0 ? index : 0);
        this.ensureCursorVisible();
    };

    window.Window_CabbyCodesExpRateSelect = Window_CabbyCodesExpRateSelect;

    CabbyCodes.log('[CabbyCodes] EXP Rate slider loaded');
})();


